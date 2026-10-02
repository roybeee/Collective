import type {Campaign} from './agency';
import {parseDecisionInput,parseLessonInput,decisionAssessment,lessonAssessment,type DecisionInput,type LessonInput} from './growth-decisions';
import {parseMissionInput} from './growth-mission';
import {parseJourneyInput} from './growth-journey';
import type {JourneyRecord} from './growth-journey-server';
import {growthView} from './growth-workspace-server';
import {storefrontDigest} from './storefront-orders';
import {ApiError,database,readRecord,recordStatement,stamp,str,type Actor} from './server';
const kinds={decision:'growth_decision',lesson:'growth_lesson',decisionHistory:'growth_decision_history',lessonHistory:'growth_lesson_history'} as const;
type Kind=typeof kinds.decision|typeof kinds.lesson;
type Input=DecisionInput|LessonInput;
type Workspace=Awaited<ReturnType<typeof growthView>>;
type Snapshot={business:Workspace['business'];mission:{id:string;version:number;status:string;input:ReturnType<typeof parseMissionInput>}|null;journey:{id:string;version:number;input:ReturnType<typeof parseJourneyInput>}|null;decision:{id:string;version:number;input:DecisionInput;snapshotDigest:string}|null};
export type DecisionRecord<T extends Input=Input>={id:string;brandId:string;campaignId:string;campaignVersion:number;version:number;input:T;snapshot:Snapshot;snapshotDigest:string;requestDigest:string;createdAt:string;updatedAt:string;updatedBy:string};
type Context={workspace:Workspace;journeys:JourneyRecord[];decisions:DecisionRecord<DecisionInput>[];lessons:DecisionRecord<LessonInput>[]};
function scope<T extends {campaignId:string;brandId:string}>(row:T,c:Campaign){if(row.campaignId!==c.id||row.brandId!==c.brandId)throw new ApiError(404,'현재 캠페인의 기록을 찾지 못했습니다.');return row;}
async function records<T extends {campaignId:string;brandId:string}>(owner:string,c:Campaign,kind:string){
 const result=await database().prepare('SELECT data FROM records WHERE owner=? AND kind=? AND parent_id=? ORDER BY updated_at DESC LIMIT 501').bind(owner,kind,c.id).all<{data:string}>();
 if(result.results.length>500)throw new ApiError(409,'캠페인별 기록이 500건을 넘습니다. 전체 기록을 대사하세요.');
 return result.results.map(r=>scope(JSON.parse(r.data) as T,c));
}
async function context(who:Actor,c:Campaign):Promise<Context>{
 const [workspace,journeys,decisions,lessons]=await Promise.all([growthView(who.owner,c,who.role!=='member'),records<JourneyRecord>(who.owner,c,'growth_journey'),records<DecisionRecord<DecisionInput>>(who.owner,c,kinds.decision),records<DecisionRecord<LessonInput>>(who.owner,c,kinds.lesson)]);
 return {workspace,journeys,decisions,lessons};
}
function refs(input:Input,ctx:Context){return {mission:ctx.workspace.missions.find(r=>r.id===input.missionId),journey:ctx.journeys.find(r=>r.id===input.journeyId),decision:'decisionId' in input?ctx.decisions.find(r=>r.id===input.decisionId):undefined};}
function sameRefs(a:Input,b:Input){return a.missionId===b.missionId&&a.missionVersion===b.missionVersion&&a.journeyId===b.journeyId&&a.journeyVersion===b.journeyVersion;}
function missionLineage(mission:Workspace['missions'][number],c:Campaign,w:Workspace):string[]{
 const missing:string[]=[],input=mission.input;
 if(!input.offerId)return missing;
 const offer=w.offers.find(r=>r.id===input.offerId);
 if(!offer||offer.version!==input.offerVersion||offer.campaignVersion!==c.version)missing.push('판매 오퍼 변경 후 학습 근거 재검토');
 if(!offer)return missing;
 if(offer.input.catalogId){
  const catalog=w.catalogs.find(r=>r.id===offer.input.catalogId);
  if(!catalog||catalog.version!==offer.input.catalogVersion||catalog.campaignVersion!==c.version)missing.push('상품 변경 후 학습 근거 재검토');
  if(catalog?.factRefs?.some(ref=>!w.facts.some(f=>f.id===ref.id&&f.version===ref.version)))missing.push('상품 사실 변경·만료 후 학습 근거 재검토');
 }
 if(offer.input.needId){
  const need=w.needs.find(r=>r.id===offer.input.needId),captured=offer.evidenceRefs?.find(r=>r.id===offer.input.needId);
  if(!need||need.campaignVersion!==c.version||(captured&&captured.version!==need.version))missing.push('고객 기회 변경 후 학습 근거 재검토');
  if(need)for(const id of need.input.signalIds){
   const signal=w.signals.find(r=>r.id===id),evidence=need.evidenceRefs?.find(r=>r.id===id);
   if(signal?.sourceReadiness?.status==='held')missing.push('브랜드 아카이브 원본 변경·미확인 후 학습 근거 재검토');
   if(!signal||signal.campaignVersion!==c.version||(evidence&&evidence.version!==signal.version))missing.push('시장 근거 변경 후 학습 근거 재검토');
  }
 }
 return missing;
}
// Failed/unknown missions and incomplete operational readiness are valid learning sources.
// Only stale lineage is propagated here; execution readiness is deliberately not a learning gate.
function upstream(row:DecisionRecord,c:Campaign,ctx:Context):string[]{
 const input=row.input,{mission,journey,decision}=refs(input,ctx),missing:string[]=[];
 if(row.campaignVersion!==c.version)missing.push('캠페인 변경 후 재검토');
 if(input.missionId&&(!mission||mission.version!==input.missionVersion||mission.campaignVersion!==c.version))missing.push('미션 변경 후 재검토');
 if(mission)missing.push(...missionLineage(mission,c,ctx.workspace));
 if(input.journeyId&&(!journey||journey.version!==input.journeyVersion||journey.campaignVersion!==c.version))missing.push('구매 병목 변경 후 재검토');
 if(journey&&(journey.input.missionId!==input.missionId||journey.input.missionVersion!==input.missionVersion))missing.push('구매 병목과 미션 참조 일치 확인');
 if('decisionId' in input&&input.decisionId){
  if(!decision||decision.version!==input.decisionVersion)missing.push('결정 변경 후 재검토');
  if(decision){if(!sameRefs(input,decision.input))missing.push('결정과 교훈 참조 일치 확인');missing.push(...upstream(decision,c,ctx));}
 }
 return [...new Set(missing)];
}
function response(who:Actor,c:Campaign,ctx:Context){
 return {decisions:ctx.decisions.map(row=>({...row,assessment:decisionAssessment(row.input,upstream(row,c,ctx))})),lessons:ctx.lessons.map(row=>({...row,assessment:lessonAssessment(row.input,upstream(row,c,ctx))})),missions:ctx.workspace.missions,journeys:ctx.journeys,business:ctx.workspace.business,campaignVersion:c.version,canEdit:who.role!=='member'&&c.status!=='archived',mayExecute:false as const};
}
export async function growthDecisionsView(who:Actor,c:Campaign){return response(who,c,await context(who,c));}
async function existing(owner:string,kind:Kind,id:string){try{return await readRecord<DecisionRecord>(owner,kind,id);}catch(e){if(e instanceof ApiError&&e.status===404)return null;throw e;}}
function checkReferences(input:Input,ctx:Context){
 const {mission,journey,decision}=refs(input,ctx);
 for(const [id,version,row,label] of [[input.missionId,input.missionVersion,mission,'미션'],[input.journeyId,input.journeyVersion,journey,'구매 병목'],...('decisionId' in input?[[input.decisionId,input.decisionVersion,decision,'결정']]:[])] as const){
  if(id&&!row)throw new ApiError(404,`현재 캠페인의 ${label}을 선택하세요.`);
  if(row&&typeof row==='object'&&'version' in row&&row.version!==version)throw new ApiError(409,`${label}이 변경되었습니다. 최신 판을 선택하세요.`);
 }
 if(journey&&(journey.input.missionId!==input.missionId||journey.input.missionVersion!==input.missionVersion))throw new ApiError(409,'구매 병목에 연결된 같은 미션과 판을 선택하세요.');
 if(decision&&!sameRefs(input,decision.input))throw new ApiError(409,'결정에 연결된 같은 미션·구매 병목과 판을 선택하세요.');
}
function safeMissionInput(value:unknown){
 const input=parseMissionInput(value);
 for(const field of Object.values(input))if(typeof field==='string')parseDecisionInput({observation:field});
 return input;
}
function snapshot(input:Input,ctx:Context):Snapshot{
 const {mission,journey,decision}=refs(input,ctx);
 return {business:ctx.workspace.business,mission:mission?{id:mission.id,version:mission.version,status:['draft','staged','unknown','failed','observed','cancelled'].includes(mission.status??'')?mission.status!:'unknown',input:safeMissionInput(mission.input)}:null,journey:journey?{id:journey.id,version:journey.version,input:parseJourneyInput(journey.input)}:null,decision:decision?{id:decision.id,version:decision.version,input:parseDecisionInput(decision.input),snapshotDigest:decision.snapshotDigest}:null};
}
export async function saveGrowthDecision(who:Actor,c:Campaign,b:Record<string,unknown>){
 if(c.status==='archived')throw new ApiError(409,'보관한 캠페인은 변경할 수 없습니다.');
 if(b.action!=='save_decision'&&b.action!=='save_lesson')throw new ApiError(400,'지원하지 않는 결정·교훈 작업입니다.');
 if(b.campaignVersion!==c.version)throw new ApiError(409,'캠페인이 변경되었습니다.');
 const kind:Kind=b.action==='save_decision'?kinds.decision:kinds.lesson,id=str(b.id,'기록 ID',100,true);
 if(!/^[a-zA-Z0-9_-]+$/.test(id))throw new ApiError(400,'기록 ID 형식을 확인하세요.');
 const input=kind===kinds.decision?parseDecisionInput(b.input):parseLessonInput(b.input),old=await existing(who.owner,kind,id);if(old)scope(old,c);
 const digest=await storefrontDigest({input,expectedVersion:b.expectedVersion,campaignVersion:c.version});
 if(old?.requestDigest===digest)return {...await growthDecisionsView(who,c),duplicate:true};
 if(b.expectedVersion!==(old?.version??0))throw new ApiError(409,'결정·교훈이 변경되었습니다. 입력을 보존하고 최신 판과 비교하세요.');
 const ctx=await context(who,c),all=kind===kinds.decision?ctx.decisions:ctx.lessons;
 if(!old&&all.length>=500)throw new ApiError(409,'캠페인별 결정·교훈은 각각 500개까지 저장할 수 있습니다.');
 checkReferences(input,ctx);
 const captured=snapshot(input,ctx),at=stamp(),row:DecisionRecord={id,brandId:c.brandId,campaignId:c.id,campaignVersion:c.version,version:(old?.version??0)+1,input,snapshot:captured,snapshotDigest:await storefrontDigest(captured),requestDigest:digest,createdAt:old?.createdAt??at,updatedAt:at,updatedBy:who.id};
 const historyKind=kind===kinds.decision?kinds.decisionHistory:kinds.lessonHistory,historyId=`${id}:v${row.version}`;
 const history=database().prepare('INSERT INTO records(id,owner,kind,parent_id,data,updated_at) VALUES(?,?,?,?,?,?)').bind(`${who.owner}:${historyKind}:${historyId}`,who.owner,historyKind,c.id,JSON.stringify({...row,id:historyId,recordId:id}),at);
 await database().batch([recordStatement(who.owner,kind,id,row,c.id),history]);
 return {...await growthDecisionsView(who,c),duplicate:false};
}
