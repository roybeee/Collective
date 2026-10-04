import type {Campaign} from './agency';
import {parseCandidate,type CandidateInput} from './growth-optimization';
import {campaignRows,inCampaign,appendRow} from './growth-ledger-server';
import {readGrowthStop} from './growth-stop-server';
import {storefrontDigest} from './storefront-orders';
import {ApiError,acquireLock,releaseLock,database,readRecord,stamp,type Actor} from './server';

export type FailureDraftOrigin={sourceDigest:string;sourceId:string;sourceVersion:number;kind:'experiment_result'|'lesson_application';createdAt:string};
type Failure={id:string;brandId:string;campaignId:string;designId?:string;analysisNumber?:number;version?:number;analysis?:{status:string};outcome?:{result:string}|null};
const failed=new Set(['invalid','rejected','inconclusive','aa_failed','insufficient']);
async function sources(owner:string,c:Campaign){
 const [results,applications]=await Promise.all([campaignRows<Failure>(owner,c,'growth_experiment_result',2000),campaignRows<Failure>(owner,c,'growth_lesson_application',1000)]);
 const own=results.filter(r=>inCampaign(r,c));
 const latest=own.filter(r=>r.designId&&Number.isSafeInteger(r.analysisNumber)&&!own.some(other=>other.designId===r.designId&&other.analysisNumber!>r.analysisNumber!));
 return [...latest.filter(r=>failed.has(r.analysis?.status??'')).map(row=>({row,kind:'experiment_result' as const})),...applications.filter(r=>inCampaign(r,c)&&['failure','invalid'].includes(r.outcome?.result??'')).map(row=>({row,kind:'lesson_application' as const}))];
}
function candidate(kind:FailureDraftOrigin['kind'],row:Failure):CandidateInput{
 return parseCandidate({failureKind:kind,failureId:row.id,failureVersion:row.version??1,candidateKind:'operating_rule',targetRef:'growth.evidence_review',
  failureSummary:kind==='experiment_result'?'최신 판매 실험에서 실패·무효·불확실 결과를 확인했습니다. 인과 결론을 재사용하지 않고 원인을 검토합니다.':'교훈 적용에서 실패·무효 결과를 회수했습니다. 적용 범위와 반례를 검토합니다.',
  proposal:kind==='experiment_result'?'배정·노출·비구매 추적과 비용 누락을 먼저 점검하고, 수정할 방법 하나와 반증 조건을 작성합니다. 같은 대상을 별도 평가한 뒤 새 판매 실험으로 확인합니다.':'원래 교훈의 적용 조건과 실제 조건 차이를 비교합니다. 유지할 방법과 바꿀 방법을 구분하고 반증 조건을 작성한 뒤 제한된 범위에서 재검증합니다.',tokenBudget:0,krwBudget:0});
}
/** Failure records create reviewable drafts only: no model calls, budget, freeze, adoption or registry mutation. */
export async function createGrowthFailureDrafts(who:Actor,c:Campaign){
 if(who.role==='member')throw new ApiError(403,'관리자만 방법 검토 초안을 만듭니다.');
 const token=await acquireLock(who.owner);
 try{
  const current=await readRecord<Campaign>(who.owner,'campaign',c.id);
  if(current.version!==c.version||current.brandId!==c.brandId||current.storeId!==c.storeId)throw new ApiError(409,'캠페인이 변경되었습니다.');
  if(current.status==='archived'||(await readGrowthStop(who.owner)).status!=='running')return {created:0};
  const count=await database().prepare("SELECT COUNT(*) n FROM records WHERE owner=? AND kind='growth_optimization' AND parent_id=?").bind(who.owner,c.id).first<{n:number}>();
  const history=await database().prepare("SELECT COUNT(*) n FROM records WHERE owner=? AND kind='growth_optimization_history' AND parent_id=?").bind(who.owner,c.id).first<{n:number}>();
  let created=0;const writes:D1PreparedStatement[]=[],at=stamp();
  for(const {row,kind} of await sources(who.owner,c)){
   if(created>=20||(count?.n??0)+created>=200||(history?.n??0)+created>=2000)break;
   const sourceVersion=row.version??row.analysisNumber??1;
   const id='failure-'+(await storefrontDigest({campaignId:c.id,kind,id:row.id,sourceVersion})).slice(0,32);
   if(await database().prepare('SELECT 1 FROM records WHERE id=?').bind(`${who.owner}:growth_optimization:${id}`).first())continue;
   let input;try{input=candidate(kind,row)}catch{continue}
   const autoDraft:FailureDraftOrigin={kind,sourceId:row.id,sourceVersion,sourceDigest:await storefrontDigest(row),createdAt:at};
   const record={id,brandId:c.brandId,campaignId:c.id,version:1,input,autoDraft,stage:'draft',frozen:null,offline:null,sales:null,adoption:null,rollback:null,createdAt:at,updatedAt:at,updatedBy:who.id};
   writes.push(appendRow(who.owner,c,'growth_optimization',id,record,at),appendRow(who.owner,c,'growth_optimization_history',`${id}:1`,record,at));created++;
  }
  if(writes.length)await database().batch(writes);
  return {created};
 }finally{await releaseLock(who.owner,token)}
}
