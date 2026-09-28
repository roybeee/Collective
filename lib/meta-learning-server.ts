import type {Campaign} from './agency';
import {getExecution} from './execution-server';
import {metaPerformanceReport,type MetaPerformanceSnapshot,type MetaPerformanceReport} from './meta-performance-report';
import {candidateInput,learningEvidence,metaDecisionLabels,type MetaLearningDecision} from './meta-learning';
import {storefrontDigest} from './storefront-orders';
import {ApiError,database,readRecord,recordStatement,stamp,str} from './server';

async function history<T>(owner:string,kind:string,id:string){
 const rows=await database().prepare("SELECT data FROM records WHERE owner=? AND kind=? AND parent_id=? ORDER BY CAST(json_extract(data,'$.version') AS INTEGER) DESC LIMIT 20").bind(owner,kind,id).all<{data:string}>();
 return rows.results.map(r=>JSON.parse(r.data) as T);
}
async function snapshotStatus(owner:string,c:Campaign,s:MetaPerformanceSnapshot,cached?:MetaPerformanceReport){
 if(s.campaignId!==c.id||s.report.campaign.id!==c.id)throw new ApiError(409,'보고 범위가 일치하지 않습니다.');
 const current=cached??await metaPerformanceReport(owner,c,s.report.period);
 return {id:s.id,version:s.version,period:s.report.period,digest:s.digest,stale:s.digest!==current.basisDigest||s.report.campaign.version!==c.version,evidenceStatus:learningEvidence(s)};
}
export async function metaLearningView(owner:string,c:Campaign,canEdit:boolean){
 const [records,saved,execution]=await Promise.all([history<MetaLearningDecision>(owner,'meta_ads_learning_decision',c.id),history<MetaPerformanceSnapshot>(owner,'meta_ads_report',c.id),getExecution(owner,c)]);
 // Include old decision references outside the latest report page.
 const refs=[...new Set([...saved.map(s=>s.id),...records.map(r=>r.snapshotId)])];
 const snapshots:Awaited<ReturnType<typeof snapshotStatus>>[]=[];
 let periodReports:Record<string,MetaPerformanceReport>={};
 for(const id of refs){
  const s=saved.find(x=>x.id===id)??await readRecord<MetaPerformanceSnapshot>(owner,'meta_ads_report',id),key=s.report.period.since+':'+s.report.period.until;
  const current=periodReports[key]??await metaPerformanceReport(owner,c,s.report.period);
  periodReports={...periodReports,[key]:current};snapshots.push(await snapshotStatus(owner,c,s,current));
 }
 const creativeStale=(r:MetaLearningDecision)=>!!r.candidate&&!execution.creatives.some(v=>v.current&&v.id===r.candidate?.creativeId&&v.version===r.candidate.creativeVersion&&v.pngHash===r.candidate.creativeHash);
 return {records:records.map(r=>({...r,stale:(snapshots.find(s=>s.id===r.snapshotId)?.stale??true)||creativeStale(r)})),snapshots,version:records[0]?.version??0,canEdit:canEdit&&c.status!=='archived',creatives:execution.creatives.filter(v=>v.current).map(v=>({id:v.id,title:v.title||'확인 사실 소재',version:v.version,pngHash:v.pngHash})),mayActivate:false};
}
export async function recordMetaLearning(owner:string,actorId:string,c:Campaign,b:Record<string,unknown>){
 if(c.status==='archived')throw new ApiError(409,'보관된 캠페인은 판정을 추가할 수 없습니다.');
 if(b.action!=='record'||b.confirmed!==true||!Object.hasOwn(metaDecisionLabels,String(b.decision)))throw new ApiError(400,'판정과 확인 여부를 지정하세요.');
 const source=await readRecord<MetaPerformanceSnapshot>(owner,'meta_ads_report',str(b.snapshotId,'보고',100,true)),status=await snapshotStatus(owner,c,source);
 if(status.stale||b.expectedDigest!==status.digest)throw new ApiError(409,'주문·성과가 변경되었습니다. 성과 대조에서 새 보고를 기록하세요.');
 const input=candidateInput(b.candidate),note=str(b.note,'판단 근거',1500,true);
 if(b.decision==='retest'&&!input)throw new ApiError(400,'재실험에는 실험 후보를 함께 입력하세요.');
 const execution=input?await getExecution(owner,c):null,creative=execution?.creatives.find(v=>v.id===input?.creativeId&&v.current);
 if(input&&(!creative||creative.version!==input.creativeVersion||creative.pngHash!==input.creativeHash))throw new ApiError(409,'소재가 변경되었습니다. 현재 캠페인의 유효한 소재를 다시 선택하세요.');
 const candidate=input&&creative?{...input,creativeVersion:creative.version,creativeHash:creative.pngHash,status:'draft' as const}:null;
 const payload={snapshotId:source.id,sourceDigest:source.digest,sourceVersion:source.version,campaignVersion:c.version,decision:b.decision as MetaLearningDecision['decision'],note,candidate};
 const requestDigest=await storefrontDigest(payload),records=await history<MetaLearningDecision>(owner,'meta_ads_learning_decision',c.id);
 if(records.some(r=>r.requestDigest===requestDigest))return {...await metaLearningView(owner,c,true),duplicate:true};
 if(b.expectedVersion!==(records[0]?.version??0))throw new ApiError(409,'판정 이력이 변경되었습니다. 다시 불러오세요.');
 const version=(records[0]?.version??0)+1,record:MetaLearningDecision={...payload,id:c.id+':'+version,campaignId:c.id,brandId:c.brandId,version,requestDigest,evidenceStatus:learningEvidence(source),mayActivate:false,actorId,recordedAt:stamp()};
 await recordStatement(owner,'meta_ads_learning_decision',record.id,record,c.id).run();
 return {...await metaLearningView(owner,c,true),duplicate:false};
}
