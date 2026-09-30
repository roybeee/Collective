import type {Campaign} from './agency';
import type {DemandRecord} from './growth-demand-server';
import type {DemandStep} from './growth-demand';
import type {ExecutionIntent} from './growth-execution-server';
import {growthPublicationLinks,type GrowthPublicationLink} from './growth-publication-server';
import {growthPublicationObservation} from './growth-publication-observation-server';
import {assessDemandEvidence,parseDemandEvidenceInput,stepEligibility,type DemandEvidenceInput,type DemandEvidenceSnapshot} from './growth-demand-evidence';
import {storefrontDigest} from './storefront-orders';
import {ApiError,database,readRecord,recordStatement,stamp,type Actor} from './server';
const kinds={current:'growth_demand_evidence',history:'growth_demand_evidence_history',request:'growth_demand_evidence_request'} as const;
export type DemandEvidenceRecord={id:string;brandId:string;campaignId:string;version:number;status:'active'|'retired';input:DemandEvidenceInput;snapshot:DemandEvidenceSnapshot;source:'operator_linked';requestDigest:string;recordedAt:string;recordedBy:string};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
async function optional<T>(owner:string,kind:string,id:string){try{return await readRecord<T>(owner,kind,id)}catch(e){if(e instanceof ApiError&&e.status===404)return null;throw e}}
const scoped=(x:{brandId:string;campaignId:string},c:Campaign)=>x.brandId===c.brandId&&x.campaignId===c.id;
async function rows<T>(owner:string,c:Campaign,kind:string,limit:number){const r=await database().prepare('SELECT data FROM records WHERE owner=? AND kind=? AND parent_id=? LIMIT ?').bind(owner,kind,c.id,limit+1).all<{data:string}>();if(r.results.length>limit)throw new ApiError(409,'단계 근거 조회 한도를 넘었습니다.');return r.results.map(x=>JSON.parse(x.data) as T)}
async function capacity(owner:string,c:Campaign,kind:string,limit:number){const r=await database().prepare('SELECT COUNT(*) n FROM records WHERE owner=? AND kind=? AND parent_id=?').bind(owner,kind,c.id).first<{n:number}>();if((r?.n??0)>=limit)throw new ApiError(409,'단계 근거 보관 한도에 도달했습니다.')}
function append(owner:string,c:Campaign,kind:string,id:string,value:unknown,at:string){return database().prepare('INSERT INTO records(id,owner,kind,parent_id,data,updated_at) VALUES(?,?,?,?,?,?)').bind(`${owner}:${kind}:${id}`,owner,kind,c.id,JSON.stringify(value),at)}
/** Manual performance notes are excluded so an operator note never invalidates or fabricates server evidence. */
export function stepDigest(step:DemandStep){const plan:Record<string,unknown>={...step};for(const k of ['performanceStatus','performanceEvidence','performanceNote'])delete plan[k];return storefrontDigest(plan)}
const linkDigest=(link:GrowthPublicationLink)=>link.snapshotDigest;
export async function growthDemandEvidenceView(who:Actor,c:Campaign){
 const [sequences,links,evidence,history,observation]=await Promise.all([rows<DemandRecord>(who.owner,c,'growth_demand',500),growthPublicationLinks(who.owner,c),rows<DemandEvidenceRecord>(who.owner,c,kinds.current,200),rows<DemandEvidenceRecord>(who.owner,c,kinds.history,2000),growthPublicationObservation(who.owner,c)]);
 const own=sequences.filter(s=>scoped(s,c)),intents=new Map<string,ExecutionIntent|null>();
 for(const link of links)intents.set(link.intentId,await optional<ExecutionIntent>(who.owner,'growth_action_intent',link.intentId));
 const intentMission=(id:string)=>{const i=intents.get(id);return i&&i.brandId===c.brandId&&i.campaignId===c.id?i.input.missionId:null};
 const records=await Promise.all(evidence.filter(r=>scoped(r,c)).map(async r=>{
  const seq=own.find(s=>s.id===r.input.sequenceId),step=seq?.input.steps.find(s=>s.id===r.input.stepId),link=links.find(l=>l.id===r.input.publicationLinkId);
  const assessment=r.status==='retired'?null:assessDemandEvidence({snapshot:r.snapshot,current:{stepDigest:step?await stepDigest(step):null,sequenceOfferId:seq?.input.offerId??null,sequenceOfferVersion:seq?.input.offerVersion??null,sequenceMissionId:seq?.input.missionId??null,publicationSnapshotDigest:link?linkDigest(link):null,publicationLinkVersion:link?.version??null,intentMissionId:link?intentMission(link.intentId):null},observation:observation.rows.find(o=>o.linkId===r.input.publicationLinkId)??null});
  return {...r,assessment};
 }));
 const steps=own.map(s=>({sequenceId:s.id,sequenceVersion:s.version,title:s.input.title,missionId:s.input.missionId,offerId:s.input.offerId,offerVersion:s.input.offerVersion,steps:s.input.steps.map(step=>({stepId:step.id,channel:step.channel,placement:step.placement,message:step.message.slice(0,120),eligibility:stepEligibility(step),operatorNote:{status:step.performanceStatus,source:'operator_note' as const},evidence:records.filter(r=>r.status==='active'&&r.input.sequenceId===s.id&&r.input.stepId===step.id).map(r=>r.id)}))}));
 const candidates=links.map(l=>({id:l.id,version:l.version,status:l.status,publicationId:l.publicationId,intentId:l.intentId,missionId:intentMission(l.intentId),linkedTo:records.find(r=>r.id===l.id&&r.status==='active')?.input??null}));
 return {campaignId:c.id,campaignVersion:c.version,sequences:steps,publications:candidates,records,history:history.filter(r=>scoped(r,c)),canEdit:who.role!=='member'&&c.status!=='archived',mayExecute:false as const,causalStatus:'not_measured' as const};
}
export type GrowthDemandEvidenceView=Awaited<ReturnType<typeof growthDemandEvidenceView>>;
async function context(owner:string,c:Campaign,input:DemandEvidenceInput){
 const seq=await optional<DemandRecord>(owner,'growth_demand',input.sequenceId);
 if(!seq||!scoped(seq,c))throw new ApiError(404,'현재 캠페인의 수요 시퀀스가 아닙니다.');
 if(seq.version!==input.sequenceVersion)throw new ApiError(409,'수요 시퀀스가 변경되었습니다. 다시 불러오세요.');
 const step=seq.input.steps.find(s=>s.id===input.stepId),blocked=stepEligibility(step);if(blocked.length)throw new ApiError(409,blocked[0]);
 if(!seq.input.missionId||!seq.input.offerId)throw new ApiError(409,'시퀀스에 판매 미션과 오퍼를 먼저 연결하세요.');
 const link=await optional<GrowthPublicationLink>(owner,'growth_publication_link',input.publicationLinkId);
 if(!link||!scoped(link,c)||link.id!==input.publicationLinkId)throw new ApiError(404,'현재 캠페인의 발행 연결이 아닙니다.');
 if(link.version!==input.publicationLinkVersion)throw new ApiError(409,'발행 연결이 변경되었습니다. 다시 불러오세요.');
 const intent=await optional<ExecutionIntent>(owner,'growth_action_intent',link.intentId);
 if(!intent||intent.brandId!==c.brandId||intent.campaignId!==c.id||intent.storeId!==c.storeId)throw new ApiError(409,'발행의 실행 준비 범위를 확인하세요.');
 if(intent.input.missionId!==seq.input.missionId)throw new ApiError(409,'발행 실행 준비의 미션이 시퀀스 미션과 다릅니다.');
 if(intent.snapshot.mission.offerId!==seq.input.offerId||intent.snapshot.mission.offerVersion!==seq.input.offerVersion)throw new ApiError(409,'발행 당시 오퍼 판이 시퀀스 오퍼 판과 다릅니다.');
 if(intent.snapshot.mission.channel!=='organic')throw new ApiError(409,'자연 유입 미션 발행만 연결합니다.');
 const snapshot:DemandEvidenceSnapshot={sequenceVersion:seq.version,stepDigest:await stepDigest(step!),offerId:seq.input.offerId,offerVersion:seq.input.offerVersion,missionId:seq.input.missionId,missionVersion:seq.input.missionVersion,publicationLinkVersion:link.version,publicationSnapshotDigest:linkDigest(link),intentId:intent.id,intentMissionVersion:intent.input.missionVersion,publicationId:link.publicationId};
 return snapshot;
}
export async function saveGrowthDemandEvidence(who:Actor,c:Campaign,b:Record<string,unknown>){
 if(b.campaignVersion!==c.version)throw new ApiError(409,'캠페인이 변경되었습니다. 다시 불러오세요.');
 const requestId=String(b.requestId??'');if(!uuid.test(requestId)||!Number.isSafeInteger(b.expectedVersion)||Number(b.expectedVersion)<0)throw new ApiError(400,'요청 번호와 근거 연결 판을 확인하세요.');
 if(b.action!=='link'&&b.action!=='retire')throw new ApiError(400,'지원하지 않는 단계 근거 작업입니다.');
 const input=parseDemandEvidenceInput(b.input),id=input.publicationLinkId,digest=await storefrontDigest({action:b.action,campaignId:c.id,campaignVersion:c.version,input,expectedVersion:b.expectedVersion});
 const [request,old]=await Promise.all([optional<{digest:string;id:string;version:number}>(who.owner,kinds.request,requestId),optional<DemandEvidenceRecord>(who.owner,kinds.current,id)]),ack=(version:number,duplicate:boolean)=>({recorded:true as const,id,version,duplicate,mayExecute:false as const});
 if(request){if(request.digest!==digest)throw new ApiError(409,'같은 요청 번호의 내용이 다릅니다.');return ack(old?.version??request.version,true)}
 if(old&&!scoped(old,c))throw new ApiError(404,'다른 캠페인의 단계 근거입니다.');
 if(b.expectedVersion!==(old?.version??0))throw new ApiError(409,'단계 근거 연결이 변경되었습니다. 다시 불러오세요.');
 let record:DemandEvidenceRecord;const at=stamp();
 if(b.action==='retire'){
  if(!old||old.status==='retired')throw new ApiError(409,'해제할 활성 연결이 없습니다.');
  if(old.input.sequenceId!==input.sequenceId||old.input.stepId!==input.stepId)throw new ApiError(409,'해제할 정확한 단계를 확인하세요.');
  record={...old,version:old.version+1,status:'retired',requestDigest:digest,recordedAt:at,recordedBy:who.id};
 }else{
  if(c.status==='archived')throw new ApiError(409,'보관한 캠페인에는 새 근거를 연결할 수 없습니다.');
  const snapshot=await context(who.owner,c,input);
  if(!old)await capacity(who.owner,c,kinds.current,200);
  record={id,brandId:c.brandId,campaignId:c.id,version:(old?.version??0)+1,status:'active',input,snapshot,source:'operator_linked',requestDigest:digest,recordedAt:at,recordedBy:who.id};
 }
 await capacity(who.owner,c,kinds.history,2000);await capacity(who.owner,c,kinds.request,5000);
 await database().batch([recordStatement(who.owner,kinds.current,id,record,c.id),append(who.owner,c,kinds.history,`${id}:${record.version}`,record,at),append(who.owner,c,kinds.request,requestId,{digest,id,version:record.version},at)]);
 return ack(record.version,false);
}
