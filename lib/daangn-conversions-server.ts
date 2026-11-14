// C8 후속 서버: 주문 장부의 당근 귀속 주문 → 전환 이벤트 대기열(워커 큐 'daangn_conversion') → 사람이 보냄(POST /api/daangn-ads send_conversions).
// 대기열 넣기는 스위치 daangn_ads가 켜져 있고 지점(또는 브랜드·워크스페이스 기본)에 당근 연결이 있을 때만 한다. 주문 1건당 1행(id=주문 id)이라 멱등이다.
// 전송은 레지스트리 daangn_ads.conversion.send(T4)라 자동이 없다: 자율성 conversion_send는 확인 후·금지만 되고(lib/autonomy.ts), 워커는 보내지 않는다.
// 보내기 전에 행을 'sending'으로 저장하고, 결과를 모르면 unknown으로 남겨 다시 보내지 않는다(lib/connectors/rate-queue.ts 규율).
import {ApiError,acquireLock,database,listRecords,recordStatement,releaseLock,stamp,str,uid,type Actor} from './server';
import {isEnabled} from './feature-flags';
import {assertAutonomy} from './autonomy-server';
import {loadExternalCredential} from './channel-credentials';
import {DAANGN_MAX_EVENTS,sendConversionEvents,type DaangnAdsCredential,type DaangnDeps} from './connectors/daangn-ads';
import {daangnScope,loadDaangnCredential,requireDaangn,requireDaangnAdmin} from './daangn-ads-server';
import {CONVERSION_QUEUE_PER_TICK,conversionEligible,conversionEvent,sendable,type ConversionStatus,type DaangnConversion} from './daangn-conversions';
import type {Store} from './store-marketing';
import type {StoreOrder} from './store-operations';

const kinds={conversion:'daangn_conversion'} as const;
const KIND=kinds.conversion;
const kstToday=(now:number)=>new Date(now+9*3600000).toISOString().slice(0,10);
const save=(owner:string,row:DaangnConversion)=>recordStatement(owner,KIND,row.id,row,row.storeId);

// 지점마다 당근 연결(지점 > 브랜드 > 워크스페이스 기본)이 있는지 보고, 새 당근 귀속 주문을 queued로 넣는다. 외부 호출 없음.
export async function queueDaangnConversions(owner:string,by='daangn_conversion_queue',now=Date.now()){
 if(!await isEnabled(owner,'daangn_ads').catch(()=>false))return {queued:0,stores:0};
 const stores=(await listRecords<Store>(owner,'store')).filter(s=>s.status!=='archived'),today=kstToday(now),at=stamp();
 let queued=0,connected=0;
 for(const store of stores){
  if(queued>=CONVERSION_QUEUE_PER_TICK)break;
  if(!await loadExternalCredential<DaangnAdsCredential>(owner,'daangn_ads',{brandId:store.brandId,storeId:store.id}))continue;
  connected++;
  const existing=new Set((await listRecords<DaangnConversion>(owner,KIND,store.id)).map(c=>c.id));
  const fresh=(await listRecords<StoreOrder>(owner,'store_order',store.id)).filter(o=>conversionEligible(o,today)&&!existing.has(o.id)).slice(0,CONVERSION_QUEUE_PER_TICK-queued);
  if(!fresh.length)continue;
  await database().batch(fresh.map(o=>save(owner,{id:o.id,orderId:o.id,storeId:store.id,brandId:store.brandId,event:conversionEvent(o),clickId:null,status:'queued',queuedAt:at,queuedBy:by,send:null,version:1,updatedAt:at})));
  queued+=fresh.length;
 }
 return {queued,stores:connected};
}
// 워커 순환에 넣을 큐. 스위치가 꺼져 있으면 undefined(순환에 큐 이름이 나타나지 않는다).
export async function daangnConversionQueue(owner:string):Promise<((owner:string)=>Promise<{status:string}>)|undefined>{
 if(!await isEnabled(owner,'daangn_ads').catch(()=>false))return undefined;
 return async current=>{if(current!==owner)return {status:'idle'};const r=await queueDaangnConversions(owner);return {status:r.queued?'processed':'idle'}};
}
export async function listDaangnConversions(owner:string,storeId:string|null){
 const rows=storeId?await listRecords<DaangnConversion>(owner,KIND,storeId):await listRecords<DaangnConversion>(owner,KIND);
 const counts=rows.reduce<Record<ConversionStatus,number>>((n,r)=>({...n,[r.status]:(n[r.status]??0)+1}),{queued:0,sending:0,sent:0,failed:0,unknown:0});
 return {counts,rows:rows.slice(0,200),clickId:'not_captured' as const};
}
const statusFor=(outcome:string):ConversionStatus=>outcome==='success'?'sent':outcome==='unknown'?'unknown':outcome==='fatal'?'failed':'queued';
// 사람이 누르는 전송: 지점 하나의 queued 행을 최대 50건 한 묶음으로 보낸다. 같은 행은 두 번 보내지 않는다(sending·sent·unknown·failed는 대상이 아니다).
export async function sendDaangnConversions(who:Actor,input:Record<string,unknown>,deps?:DaangnDeps){
 requireDaangnAdmin(who);await requireDaangn(who.owner);
 const decision=await assertAutonomy(who.owner,'conversion_send');
 const storeId=str(input.storeId,'지점',100,true),scope=await daangnScope(who.owner,{storeId});
 const lockKey=who.owner+':daangn-conversions',lock=await acquireLock(lockKey);
 try{
  const {credential}=await loadDaangnCredential(who.owner,scope);
  const rows=(await listRecords<DaangnConversion>(who.owner,KIND,storeId)).filter(sendable).slice(0,DAANGN_MAX_EVENTS);
  if(!rows.length)return {sent:0,status:'nothing_queued',autonomy:decision.mode};
  const batch=uid(),at=stamp(),sending=rows.map(r=>({...r,status:'sending' as const,send:{at,by:who.id,outcome:null,httpStatus:null,error:null,batch},version:r.version+1,updatedAt:at}));
  await database().batch(sending.map(r=>save(who.owner,r)));
  const result=await sendConversionEvents(credential,sending.map(r=>r.event),deps).catch(()=>({outcome:'unknown' as const,attempts:0,httpStatus:null,sent:sending.length,error:'전송 중 예외(결과 불명)'}));
  const status=statusFor(result.outcome),done=stamp();
  const next=sending.map(r=>({...r,status,send:{...r.send,outcome:result.outcome,httpStatus:result.httpStatus,error:result.error??null},version:r.version+1,updatedAt:done}));
  await database().batch(next.map(r=>save(who.owner,r)));
  return {sent:status==='sent'?next.length:0,status,outcome:result.outcome,httpStatus:result.httpStatus,error:result.error??null,batch,count:next.length,autonomy:decision.mode};
 }finally{await releaseLock(lockKey,lock)}
}
// 결과 미확인 행을 사람이 당근 광고 화면에서 확인한 뒤 닫는다(sent 또는 failed). 다시 보내지 않는다.
export async function resolveDaangnConversion(who:Actor,input:Record<string,unknown>){
 requireDaangnAdmin(who);
 const storeId=str(input.storeId,'지점',100,true),id=str(input.id,'전환 행',100,true),outcome=input.outcome;
 if(outcome!=='sent'&&outcome!=='failed')throw new ApiError(400,"확인 결과는 'sent' 또는 'failed'입니다.");
 const row=(await listRecords<DaangnConversion>(who.owner,KIND,storeId)).find(r=>r.id===id);
 if(!row)throw new ApiError(404,'전환 행을 찾을 수 없습니다.');
 if(row.status!=='unknown')throw new ApiError(409,'결과 미확인 행만 확인으로 닫을 수 있습니다.');
 const next:DaangnConversion={...row,status:outcome,version:row.version+1,updatedAt:stamp()};
 await save(who.owner,next).run();
 return next;
}
