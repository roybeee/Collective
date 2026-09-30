import type {Campaign} from './agency';
import type {DemandRecord} from './growth-demand-server';
import {stepDigest} from './growth-demand-evidence-server';
import {collaborationWarnings,parseCollaborationPlan,parseStageReceipt,type CollaborationPlan,type CollaborationStage,type StageReceipt} from './growth-collaboration';
import {campaignRows,inCampaign,optionalRecord,versionedMutation,type Versioned} from './growth-ledger-server';
import {ApiError,database,str,type Actor} from './server';
const kinds={current:'growth_collaboration',history:'growth_collaboration_history',request:'growth_collaboration_request'} as const;
export type CollaborationRecord=Versioned&{plan:CollaborationPlan;stage:CollaborationStage;receipts:StageReceipt[];snapshot:{stepDigest:string;plannedCost:number|null};createdAt:string;updatedAt:string;updatedBy:string};
type Order={id:string;storeId:string;orderDate:string;status:string;paidAmount:number;refundAmount:number;costs:Record<string,number|null>;codeAttribution?:{codeId:string}};
async function step(owner:string,c:Campaign,plan:CollaborationPlan){
 const seq=await optionalRecord<DemandRecord>(owner,'growth_demand',plan.sequenceId);if(!seq||!inCampaign(seq,c))return null;
 const s=seq.input.steps.find(x=>x.id===plan.stepId);return s?{seq,step:s,digest:await stepDigest(s)}:null;
}
async function performance(owner:string,c:Campaign,r:CollaborationRecord){
 const published=r.receipts.find(x=>x.stage==='published');if(!r.plan.trackingCodeId)return {status:'no_tracking' as const,orders:null,netRevenue:null,contribution:null};
 if(!published)return {status:'not_published' as const,orders:null,netRevenue:null,contribution:null};
 const code=await optionalRecord<{storeId:string;campaignId:string}>(owner,'tracking_code',r.plan.trackingCodeId);if(!code||code.campaignId!==c.id||code.storeId!==c.storeId)return {status:'held' as const,orders:null,netRevenue:null,contribution:null};
 const res=await database().prepare("SELECT data FROM records WHERE owner=? AND kind='store_order' AND parent_id=? AND json_extract(data,'$.codeAttribution.codeId')=? LIMIT 5001").bind(owner,c.storeId,r.plan.trackingCodeId).all<{data:string}>();
 if(res.results.length>5000)return {status:'held' as const,orders:null,netRevenue:null,contribution:null};
 const since=published.at.slice(0,10),orders=res.results.map(x=>JSON.parse(x.data) as Order).filter(o=>o.orderDate>=since&&o.storeId===c.storeId);
 const net=orders.reduce((n,o)=>n+o.paidAmount-o.refundAmount,0),costs=orders.map(o=>Object.values(o.costs??{}).some(v=>v===null)?null:Object.values(o.costs).reduce<number>((n,v)=>n+(v??0),0));
 return {status:'observed' as const,orders:orders.length,netRevenue:net,contribution:costs.every(v=>v!==null)?net-(costs as number[]).reduce((a,b)=>a+b,0):null};
}
export async function growthCollaborationView(who:Actor,c:Campaign){
 const [rows,history,sequences]=await Promise.all([campaignRows<CollaborationRecord>(who.owner,c,kinds.current,200),campaignRows<CollaborationRecord>(who.owner,c,kinds.history,2000),campaignRows<DemandRecord>(who.owner,c,'growth_demand',500)]);
 const today=new Date().toISOString().slice(0,10);
 const collaborations=await Promise.all(rows.filter(r=>inCampaign(r,c)).map(async r=>{const s=await step(who.owner,c,r.plan);const held=!s||s.digest!==r.snapshot.stepDigest;return {...r,sourceStatus:held?'held' as const:'current' as const,sourceReasons:held?['연결한 수요 단계가 바뀌었거나 없습니다. 계획을 다시 확인하세요.']:[],warnings:collaborationWarnings(r.plan,r.stage,r.receipts,r.snapshot.plannedCost,today),performance:await performance(who.owner,c,r)}}));
 const steps=sequences.filter(s=>inCampaign(s,c)).flatMap(s=>s.input.steps.filter(x=>x.placement==='creator'||x.placement==='partner').map(x=>({sequenceId:s.id,sequenceVersion:s.version,title:s.input.title,stepId:x.id,placement:x.placement,plannedCost:x.plannedCost})));
 return {campaignId:c.id,campaignVersion:c.version,collaborations,history:history.filter(h=>inCampaign(h,c)),steps,canEdit:who.role!=='member'&&c.status!=='archived',mayContact:false as const,mayPay:false as const,causalStatus:'not_measured' as const};
}
export type GrowthCollaborationView=Awaited<ReturnType<typeof growthCollaborationView>>;
export async function saveGrowthCollaboration(who:Actor,c:Campaign,b:Record<string,unknown>){
 const id=str(b.id,'협업 ID',100,true),action=String(b.action??'');
 if(action==='save_plan'){
  if(c.status==='archived')throw new ApiError(409,'보관한 캠페인은 변경할 수 없습니다.');const plan=parseCollaborationPlan(b.plan);
  return versionedMutation<CollaborationRecord>(who,c,b,kinds,id,{action,plan},async(old,at)=>{
   if(old&&old.stage!=='proposed')throw new ApiError(409,'합의 이후 계획은 바꿀 수 없습니다. 취소 후 새 협업을 만드세요.');
   const s=await step(who.owner,c,plan);if(!s)throw new ApiError(404,'현재 캠페인의 수요 단계가 아닙니다.');if(s.seq.version!==plan.sequenceVersion)throw new ApiError(409,'수요 시퀀스가 변경되었습니다. 최신 판을 선택하세요.');
   if(s.step.placement!==plan.partnerKind)throw new ApiError(409,'단계의 게재 방식(크리에이터/파트너)과 협업 종류가 같아야 합니다.');
   if(plan.trackingCodeId){const code=await optionalRecord<{storeId:string;campaignId:string}>(who.owner,'tracking_code',plan.trackingCodeId);if(!code||code.campaignId!==c.id||code.storeId!==c.storeId)throw new ApiError(409,'현재 캠페인·지점의 추적 코드를 선택하세요.');}
   return {next:{id,brandId:c.brandId,campaignId:c.id,version:(old?.version??0)+1,plan,stage:'proposed',receipts:[],snapshot:{stepDigest:s.digest,plannedCost:s.step.plannedCost},createdAt:(old as CollaborationRecord|null)?.createdAt??at,updatedAt:at,updatedBy:who.id},limit:200};
  });
 }
 if(action==='record_stage'){
  return versionedMutation<CollaborationRecord>(who,c,b,kinds,id,{action,receipt:b.receipt},async(old,at)=>{
   if(!old)throw new ApiError(404,'협업을 찾지 못했습니다.');
   let receipt;try{receipt=parseStageReceipt(old.stage,b.receipt)}catch(e){throw new ApiError(409,e instanceof Error?e.message:'단계를 확인하세요.')}
   if(c.status==='archived'&&!['settled','cancelled'].includes(receipt.stage))throw new ApiError(409,'보관한 캠페인에서는 정산·취소 기록만 할 수 있습니다.');
   const last=old.receipts.at(-1);if(last&&Date.parse(receipt.at)<Date.parse(last.at))throw new ApiError(409,'단계 시각은 이전 단계 이후여야 합니다.');
   if(['agreed','delivered','approved','published'].includes(receipt.stage)){const s=await step(who.owner,c,old.plan);if(!s||s.digest!==old.snapshot.stepDigest)throw new ApiError(409,'연결한 수요 단계가 바뀌었습니다. 새 협업으로 다시 계획하세요.')}
   return {next:{...old,version:old.version+1,stage:receipt.stage,receipts:[...old.receipts,{...receipt,recordedAt:at,recordedBy:who.id}],updatedAt:at,updatedBy:who.id}};
  });
 }
 throw new ApiError(400,'지원하지 않는 협업 작업입니다.');
}
