import type {Campaign} from './agency';
import type {DetectedSignalRecord} from './growth-detection-server';
import {parseNeedInput} from './growth-market';
import {executionSafeText} from './growth-execution';
import {readGrowthStop} from './growth-stop-server';
import {storefrontDigest} from './storefront-orders';
import {ApiError,acquireLock,releaseLock,database,readRecord,stamp,type Actor} from './server';

export type OpportunityDraftOrigin={sourceId:string;sourceVersion:number;sourceDigest:string;createdAt:string;kind:'detected_signal'};
const actions={demand_rise:'주문 증가의 행사·채널·가격 영향을 구분하고 고객 근거를 확인하세요.',demand_drop:'유입·결제 오류와 행사 종료 여부를 먼저 확인하세요.',stockout_risk:'실재고와 입고·배송 마감을 확인한 뒤 공급 가능 범위를 정하세요.',return_cluster:'반복 원인을 주문·상품 판과 대조하고 개선 가설을 작성하세요.',cs_recurring:'반복 문의를 상품 설명·옵션 안내와 대조하세요.',season:'행사 일정과 실제 구매 상황·준비 상품·배송 마감을 확인하세요.'} as const;
const kinds={need:'growth_need',history:'growth_history'} as const;
function proposal(signal:DetectedSignalRecord,now:number){
 const d=signal.detection;if(!Object.hasOwn(actions,d.kind)||!Number.isSafeInteger(signal.version)||signal.version<1)throw Error('invalid signal');
 const normalized=(v:string)=>v.normalize('NFKC').replace(/[\u00ad\u200b-\u200d\u2060\ufeff"']/g,'');
 executionSafeText(normalized(d.title),'감지 제목',180);executionSafeText(normalized(d.detail),'감지 내용',1800);
 const fallback=new Date(now+3*86400000).toISOString().slice(0,10);
 return parseNeedInput({title:`검토 초안: ${d.title}`,situation:d.detail,desiredOutcome:'',alternative:'',barrier:'',counterEvidence:'',signalIds:[],deadline:d.dueBy??fallback,nextAction:actions[d.kind],assignee:d.kind==='stockout_risk'?'상품·운영 담당':'성장 담당'});
}
/** Review-only drafts stay held until an operator supplies customer evidence. Never overwrite an existing draft. */
export async function createGrowthOpportunityDrafts(who:Actor,c:Campaign,now=Date.now()){
 if(who.role==='member')throw new ApiError(403,'관리자만 검토 초안을 만듭니다.');
 const token=await acquireLock(who.owner);
 try{
  const current=await readRecord<Campaign>(who.owner,'campaign',c.id);
  if(current.version!==c.version||current.brandId!==c.brandId||current.storeId!==c.storeId)throw new ApiError(409,'캠페인이 변경되었습니다.');
  if(current.status==='archived')return {created:0,reason:'archived' as const};
  if((await readGrowthStop(who.owner)).status!=='running')return {created:0,reason:'stopped' as const};
  const rows=await database().prepare("SELECT data FROM records WHERE owner=? AND kind='growth_detected_signal' AND parent_id=? ORDER BY id LIMIT 2001").bind(who.owner,c.id).all<{data:string}>();
  if(rows.results.length>2000)throw new ApiError(409,'감지 기록 한도를 확인하세요.');
  const count=await database().prepare('SELECT COUNT(*) n FROM records WHERE owner=? AND kind=? AND parent_id=?').bind(who.owner,kinds.need,c.id).first<{n:number}>();
  let created=0;const writes:D1PreparedStatement[]=[],at=stamp();
  for(const source of rows.results){
   if(created>=20||(count?.n??0)+created>=500)break;
   const signal=JSON.parse(source.data) as DetectedSignalRecord;
   if(signal.brandId!==c.brandId||signal.campaignId!==c.id||signal.status!=='new')continue;
   const id='auto-need-'+(await storefrontDigest({campaignId:c.id,sourceId:signal.id})).slice(0,32);
   if(await database().prepare('SELECT 1 FROM records WHERE id=?').bind(`${who.owner}:${kinds.need}:${id}`).first())continue;
   let input;try{input=proposal(signal,now)}catch{continue}
   const autoDraft:OpportunityDraftOrigin={kind:'detected_signal',sourceId:signal.id,sourceVersion:signal.version,sourceDigest:await storefrontDigest(signal.detection),createdAt:at};
   const row={id,campaignId:c.id,brandId:c.brandId,campaignVersion:c.version,version:1,input,autoDraft,evidenceRefs:[],updatedAt:at,updatedBy:who.id,requestDigest:await storefrontDigest({input,autoDraft})};
   for(const [kind,key,data] of [[kinds.need,id,row],[kinds.history,`need:${id}:1`,{...row,entity:'need'}]] as const)writes.push(database().prepare('INSERT INTO records(id,owner,kind,parent_id,data,updated_at) VALUES(?,?,?,?,?,?)').bind(`${who.owner}:${kind}:${key}`,who.owner,kind,c.id,JSON.stringify(data),at));
   created++;
  }
  if(writes.length)await database().batch(writes);
  return {created,reason:'review_only' as const};
 }finally{await releaseLock(who.owner,token)}
}
