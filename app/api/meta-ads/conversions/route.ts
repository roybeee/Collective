import {META_CONVERSION_PURPOSE,type MetaConversionEvent} from '@/lib/meta-conversion';
import {conversionContext,conversionId,conversionView} from '@/lib/meta-conversion-server';
import {advanceMetaConversionWork,configureMetaCapi,disconnectMetaCapi,metaPixelEnvelope,queueMetaCapi,purgeMetaCapiMatching,limitMetaConversionMutation} from '@/lib/meta-capi-server';
import {ApiError,acquireLock,actor,body,database,failure,json,recordStatement,releaseLock,requireOwnerActor,secureMutation,stamp,str} from '@/lib/server';
export async function GET(req:Request){try{const who=await actor(req),{store}=await conversionContext(who.owner,str(new URL(req.url).searchParams.get('campaignId'),'캠페인',100,true));return json(await conversionView(who.owner,store,who.role==='owner'));}catch(e){return failure(e)}}
function validateContract(b:Record<string,unknown>,orderDate:string){
 if(b.confirmed!==true||b.consentGranted!==true||b.isTest!==false||b.purpose!==META_CONVERSION_PURPOSE)throw new ApiError(400,'실제 주문 여부와 고객의 별도 광고 전환 측정 동의·목적을 명시적으로 확인하세요.');
 if(typeof b.evidenceRef!=='string'||!/^consent-[A-Za-z0-9_-]{1,64}$/.test(b.evidenceRef))throw new ApiError(400,'동의 증빙 참조는 consent-로 시작하는 비식별 관리번호여야 합니다. 고객 정보를 입력하지 마세요.');
 if(typeof b.eventTime!=='number'||!Number.isSafeInteger(b.eventTime)||b.eventTime<=0||b.eventTime>Math.floor(Date.now()/1000))throw new ApiError(400,'실제 구매 시각을 입력하세요. 미래 시각은 사용할 수 없습니다.');
 const date=new Date(b.eventTime*1000);if(!Number.isFinite(date.getTime())||date.toLocaleDateString('en-CA',{timeZone:'Asia/Seoul'})!==orderDate)throw new ApiError(400,'구매 시각의 한국 날짜가 장부 주문일과 일치해야 합니다.');
}
export async function POST(req:Request){let owner='',lock='';try{
 const who=await requireOwnerActor(req);secureMutation(req);const b=await body(req);
 if(!['prepare','revoke','configure','disconnect','queue','advance','pixel'].includes(String(b.action)))throw new ApiError(400,'지원하지 않는 전환 작업입니다.');
 owner=who.owner;
 if(b.action!=='revoke')await limitMetaConversionMutation(owner);
 if(b.action==='advance'){if(b.confirmed!==true)throw new ApiError(400,'예약한 전환 전송 실행을 확인하세요.');const {store}=await conversionContext(owner,str(b.campaignId,'캠페인',100,true));await advanceMetaConversionWork(owner);return json(await conversionView(owner,store,true));}
 lock=await acquireLock(owner);const {campaign,store}=await conversionContext(owner,str(b.campaignId,'캠페인',100,true));
 if(b.action==='configure'){await configureMetaCapi(owner,store,b);return json(await conversionView(owner,store,true));}
 if(b.action==='disconnect'){if(b.confirmed!==true)throw new ApiError(400,'연결 해제를 확인하세요.');await disconnectMetaCapi(owner,store,b.expectedConnectionVersion);return json(await conversionView(owner,store,true));}
 if(b.action==='queue'){await queueMetaCapi(owner,campaign,store,b);return json(await conversionView(owner,store,true));}
 if(b.action==='pixel')return json({envelope:await metaPixelEnvelope(owner,store,str(b.eventId,'구매 이벤트',100,true))});
 const view=await conversionView(owner,store,true),orderId=str(b.orderId,'주문',100,true),order=view.orders.find(x=>x.id===orderId),previous=view.records.find(x=>x.orderId===orderId);
 if(b.expectedVersion!==(previous?.version??0))throw new ApiError(409,'전환 기록이 변경되었습니다. 다시 불러오세요.');
 if(b.action==='revoke'){
  if(b.confirmed!==true)throw new ApiError(400,'동의 철회를 확인하세요.');
  if(!previous)throw new ApiError(409,'철회할 동의 기록이 없습니다.');
  if(previous.consent==='revoked'){await purgeMetaCapiMatching(owner,previous.id);return json(await conversionView(owner,store,true));}
  const next={...previous,consent:'revoked' as const,version:previous.version+1,updatedAt:stamp(),actorId:who.id};
  await persist(owner,next);await purgeMetaCapiMatching(owner,next.id);return json(await conversionView(owner,store,true));
 }
 if(!order)throw new ApiError(404,'이 지점의 자사몰 연결 주문을 찾을 수 없습니다.');
 validateContract(b,order.orderDate);
 if(store.status!=='active'||campaign.status==='archived')throw new ApiError(409,'활성 지점과 캠페인에서 준비하세요.');
 if(b.expectedOrderVersion!==order.version||order.issues.length)throw new ApiError(409,'현재 주문을 다시 확인하세요. '+order.issues.join(' '));
 if(previous){if(previous.eventTime!==b.eventTime||previous.evidenceRef!==b.evidenceRef)throw new ApiError(409,'기존 구매 이벤트의 시각과 동의 증빙은 덮어쓸 수 없습니다.');return json({...view,duplicate:true})}
 const id=await conversionId(owner,store.brandId,store.id,order.id),now=stamp(),event:MetaConversionEvent={id,eventId:id,eventName:'Purchase',storeId:store.id,brandId:store.brandId,orderId:order.id,orderVersion:order.version,eventTime:b.eventTime as number,value:order.paidAmount,currency:'KRW',purpose:META_CONVERSION_PURPOSE,consent:'granted',evidenceRef:b.evidenceRef as string,isTest:false,version:1,recordedAt:now,updatedAt:now,actorId:who.id,externalTransmissions:0};
 await persist(owner,event);return json(await conversionView(owner,store,true));
 }catch(e){return failure(e)}finally{if(lock)await releaseLock(owner,lock)}}
async function persist(owner:string,event:MetaConversionEvent){await database().batch([recordStatement(owner,'meta_conversion_event',event.id,event,event.storeId),recordStatement(owner,'meta_conversion_audit',event.id+':'+event.version,{...event,id:event.id+':'+event.version},event.storeId)])}
