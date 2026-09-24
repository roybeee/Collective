// 비차단 온라인 채점(F2b). 기능 스위치 online_grading(lib/feature-flags.ts, 기본 꺼짐)이 켜져 있으면 역할·회의 작업물이 저장된 직후
// lib/graders 13종(runGraders)과 규제 가드레일(checkCompliance)로 채점해 grading 레코드(id=<작업물 id>:<버전>, parent=캠페인)로 남긴다.
// 비차단: 작업물 저장·job 상태·사용량 결과(domainOutcome)가 모두 끝나고 소유자 변경 잠금(acquireLock)을 푼 뒤에 부르며 어떤 예외도 던지지 않는다.
// 채점하는 동안 같은 소유자의 다른 변경을 막지 않는다. 잠금 밖이라 grading 행은 캠페인이 아직 있을 때만 쓴다(saveGrading).
// 채점기 하나의 예외는 runGraders가 그 채점기의 grader_error 1줄로 격리한다. 채점·저장 자체가 실패하면 status grader_error 기록 1건과 로그 1줄('online_grading_grader_error')만 남긴다.
// 입력 상한: 일부 채점기는 줄 수가 늘면 비례 이상으로 느려진다. MAX_GRADED_LINES줄을 넘는 작업물은 채점기를 부르지 않고 status not_run(reason too_many_lines, 줄 수)만 남긴다.
// 두 스위치(online_grading·a2_downgrade)가 모두 꺼져 있으면 스위치 2행만 읽고 채점기·규제 점검을 한 번도 부르지 않는다. 채점 맥락: 사실 원장(역할=현재 확정·거절 사실, 회의=회의 시작 스냅샷), 지점 캠페인 여부,
// 공급자가 보고한 입력 토큰. 업종(industry)·큐레이션 금지 표현은 운영 캠페인에 없어 비워 둔다(해당 채점기는 not_applicable).
// A2 런타임 하향: 기능 스위치 a2_downgrade(기본 꺼짐)가 켜져 있으면 같은 작업물에 규제 점검(checkCompliance)을 적용한다(online_grading이 켜져 있으면 그 결과를 재사용).
// block이 있으면 작업물에 complianceHold를, 품질 검수 저장이면 현재 작업물(검수 자신 포함)의 hold로 판정을 ready_for_review→revise로만 내린다. 하향만 하고 hold를 지우지 않는다.
// 작업물 쓰기는 compare-and-set이다(저장 뒤 버전이 바뀌었거나 review가 아니면 쓰지 않음). 쓰기가 적용되면 캠페인 updatedAt을 올리고, 판정을 내렸으면 캠페인 review를 revision으로 내린다.
// 입력 상한(MAX_GRADED_LINES)을 넘는 작업물은 점검하지 않는다(로그 'a2_downgrade_not_run'). 예외는 삼키고 로그 'a2_downgrade_error' 1줄만 남긴다.
import {database,readRecord,listRecords,stamp,ApiError} from './server';
import {isEnabled} from './feature-flags';
import {evidenceContext} from './ai-context';
import {runGraders,GRADERS_VERSION,type FactLedger,type GradeContext,type GraderResult,type GraderStatus} from './graders/index';
import {bodyOf} from './graders/text';
import {checkCompliance,downgradeVerdict,COMPLIANCE_NOTICE,type ComplianceReport} from './graders/compliance';
import {qualityMarkdown,type QualityReview} from './quality';
import {roles,type Artifact,type Campaign} from './agency';
import type {Meeting} from './meetings';

export type GradingSource='role'|'meeting';
type GradedArtifact=Pick<Artifact,'id'|'version'|'role'|'content'|'campaignId'|'campaignVersion'|'outputContractVersion'>;
// usageId: 사용량 원장 행 id('<공급자>:<실행 번호>'). 있으면 보고된 입력 토큰을 input_budget 채점에 쓴다.
export type GradingTarget={artifact:GradedArtifact;source:GradingSource;jobId?:string|null;meetingId?:string|null;usageId?:string|null};
type FactSource='current'|'snapshot'|'none';
export type GradingContext={facts:FactSource;confirmedFacts:number;prohibitedFacts:number;industry:null;localStore:boolean;inputTokens:number|null};
// 저장 한도(40,000자) 안에서 줄 수로 채점 시간을 묶는다. 로컬 실측: 2,000줄 이하 합성 최악 입력 약 110ms 이하, 빈 줄 20,000줄 약 0.5초·40,000줄 약 2.3초.
export const MAX_GRADED_LINES=2000;
type ComplianceSummary={version:string;block:number;warn:number;info:number;issues:{category:string;ruleId:string;severity:string}[]};
export type Grading={id:string;artifactId:string;artifactVersion:number;campaignId:string;campaignVersion:number|null;role:string;source:GradingSource;jobId:string|null;meetingId:string|null;
 status:'graded'|'grader_error'|'not_run';gradersVersion:string;graders:GraderResult[];summary:Record<GraderStatus,number>|null;compliance:ComplianceSummary|null;context:GradingContext;durationMs:number|null;gradedAt:string;error?:string;reason?:'too_many_lines';lines?:number};

const emptySummary=():Record<GraderStatus,number>=>({pass:0,fail:0,not_applicable:0,grader_error:0});
// 순수 채점: 저장된 본문(사용자가 보는 렌더본)을 채점한다. 규제 점검은 발췌(excerpt) 없이 분류·규칙·심각도만 남긴다.
export function gradeArtifact(artifact:GradedArtifact,ctx:GradeContext,inputTokens:number|null){return scoreArtifact(artifact,ctx,inputTokens).result}
// report: A2 하향이 재사용하는 규제 점검 원본(발췌 포함). grading 기록에는 넣지 않는다.
function scoreArtifact(artifact:GradedArtifact,ctx:GradeContext,inputTokens:number|null){
 const started=Date.now();
 const item={id:artifact.id,kind:'role' as const,role:artifact.role,text:artifact.content,contract:!!artifact.outputContractVersion,inputTokens};
 const graders=runGraders(item,ctx).map(g=>({id:g.id,status:g.status,...(g.detail?{detail:g.detail.slice(0,200)}:{})}));
 const report=checkCompliance(bodyOf(item),{facts:ctx.facts}),count=(s:string)=>report.issues.filter(i=>i.severity===s).length;
 const summary=graders.reduce((acc,g)=>({...acc,[g.status]:acc[g.status]+1}),emptySummary());
 return {report,result:{graders,summary,compliance:{version:report.version,block:count('block'),warn:count('warn'),info:count('info'),issues:report.issues.map(i=>({category:i.category,ruleId:i.ruleId,severity:i.severity}))},durationMs:Date.now()-started}};
}
async function usageInputTokens(owner:string,usageId:string|null|undefined){
 if(!usageId)return null;
 try{const usage=await readRecord<{inputTokens?:number|null}>(owner,'provider_usage',usageId);return typeof usage.inputTokens==='number'?usage.inputTokens:null}
 catch(error){if(error instanceof ApiError&&error.status===404)return null;throw error}
}
const ledgerOf=(facts:{confirmed?:unknown[];prohibited?:unknown[]}|null|undefined):FactLedger|null=>facts?{confirmed:(facts.confirmed||[]) as FactLedger['confirmed'],prohibited:(facts.prohibited||[]) as FactLedger['prohibited']}:null;
const gradingOf=(t:GradingTarget,campaignId:string,context:GradingContext):Omit<Grading,'status'|'graders'|'summary'|'compliance'|'durationMs'|'gradedAt'>=>({
 id:`${t.artifact.id}:${t.artifact.version}`,artifactId:t.artifact.id,artifactVersion:t.artifact.version,campaignId,campaignVersion:t.artifact.campaignVersion??null,role:t.artifact.role,source:t.source,jobId:t.jobId??null,meetingId:t.meetingId??null,gradersVersion:GRADERS_VERSION,context,
});
// 잠금 밖에서 쓰므로 그사이 캠페인이 지워졌으면 쓰지 않는다(캠페인과 함께 지운다는 grading 보존 정책). 같은 id는 덮어쓴다(recordStatement와 같은 규칙).
const saveGrading=(owner:string,g:Grading)=>database().prepare('INSERT INTO records(id,owner,kind,parent_id,data,updated_at) SELECT ?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM records WHERE id=? AND owner=? AND kind=?) ON CONFLICT(id) DO UPDATE SET data=excluded.data,updated_at=excluded.updated_at WHERE records.owner=excluded.owner')
 .bind(`${owner}:grading:${g.id}`,owner,'grading',g.campaignId,JSON.stringify(g),stamp(),`${owner}:campaign:${g.campaignId}`,owner,'campaign').run();
async function gradeOne(owner:string,campaign:Pick<Campaign,'id'|'storeId'>,t:GradingTarget,facts:{ledger:FactLedger|null;source:FactSource}){
 const context:GradingContext={facts:facts.source,confirmedFacts:facts.ledger?.confirmed.length??0,prohibitedFacts:facts.ledger?.prohibited.length??0,industry:null,localStore:!!campaign.storeId,inputTokens:null};
 try{
  const lines=t.artifact.content.split('\n').length;
  if(lines>MAX_GRADED_LINES){await saveGrading(owner,{...gradingOf(t,campaign.id,context),status:'not_run',graders:[],summary:null,compliance:null,durationMs:null,gradedAt:stamp(),reason:'too_many_lines',lines});return}
  const inputTokens=await usageInputTokens(owner,t.usageId),base=gradingOf(t,campaign.id,{...context,inputTokens});
  const {result,report}=scoreArtifact(t.artifact,{facts:facts.ledger,industry:null,localStore:context.localStore},inputTokens);
  await saveGrading(owner,{...base,status:'graded',...result,gradedAt:stamp()} satisfies Grading);
  return report;
 }catch(error){
  console.error('online_grading_grader_error');
  const base=gradingOf(t,campaign.id,context),failed:Grading={...base,status:'grader_error',graders:[],summary:null,compliance:null,durationMs:null,gradedAt:stamp(),error:String((error as Error)?.message||error).slice(0,200)};
  await saveGrading(owner,failed).catch(()=>undefined);
 }
}
async function switchedOn(owner:string){
 try{return await isEnabled(owner,'online_grading')}catch{console.error('online_grading_flag_unreadable');return false}
}
async function downgradeOn(owner:string){
 try{return await isEnabled(owner,'a2_downgrade')}catch{console.error('a2_downgrade_flag_unreadable');return false}
}
type Switches={grading:boolean;downgrade:boolean};
const switches=async(owner:string):Promise<Switches>=>({grading:await switchedOn(owner),downgrade:await downgradeOn(owner)});
async function factsFor(owner:string,campaign:Campaign,snapshot?:{confirmed?:unknown[];prohibited?:unknown[]}|null){
 if(snapshot)return {ledger:ledgerOf(snapshot),source:'snapshot' as const};
 try{return {ledger:ledgerOf((await evidenceContext(database(),owner,campaign)).facts),source:'current' as const}}
 catch{return {ledger:null,source:'none' as const}}
}
type SnapshotFacts={confirmed?:unknown[];prohibited?:unknown[]}|null|undefined;
async function gradeTargets(owner:string,campaign:Campaign,targets:GradingTarget[],snapshotFacts:SnapshotFacts,on:Switches,a2Targets=targets){
 const facts=await factsFor(owner,campaign,snapshotFacts),reports=new Map<string,ComplianceReport>();
 if(on.grading)for(const target of targets){const report=await gradeOne(owner,campaign,target,facts);if(report)reports.set(target.artifact.id,report)}
 if(on.downgrade)await holdAndDowngrade(owner,campaign.id,a2Targets,facts.ledger,reports);
 return on.grading?targets.length:0;
}
// 역할 실행(lib/role-execution.ts)·회의(gradeMeetingArtifacts)가 저장하고 잠금을 푼 뒤 부른다. 반환값은 채점한 작업물 수(online_grading 꺼짐이면 0). 예외를 던지지 않는다.
export async function gradeSavedArtifacts(owner:string,campaign:Campaign,targets:GradingTarget[],snapshotFacts?:SnapshotFacts){
 try{
  if(!targets.length)return 0;
  const on=await switches(owner);
  if(!on.grading&&!on.downgrade)return 0;
  return await gradeTargets(owner,campaign,targets,snapshotFacts,on);
 }catch{console.error('online_grading_grader_error');return 0}
}
// 회의가 저장한 작업물(m.artifactIds)을 저장된 그대로 읽어 채점한다. 사실 원장은 회의 시작 스냅샷을 쓴다.
export async function gradeMeetingArtifacts(owner:string,m:Meeting){
 try{
  if(!m.artifactIds.length)return 0;
  const on=await switches(owner);
  if(!on.grading&&!on.downgrade)return 0;
  const saved=(await listRecords<Artifact&{meetingId?:string}>(owner,'artifact',m.campaignId)).filter(a=>m.artifactIds.includes(a.id));
  const targets=saved.map(artifact=>({artifact,source:'meeting' as const,meetingId:m.id}));
  // A2는 이 회의가 저장한 레코드만 대상으로 한다. 잠금이 풀린 뒤 사람이 저장한 새 버전은 meetingId가 없다(채점 대상은 기존 그대로).
  return await gradeTargets(owner,m.snapshot.campaign,targets,m.snapshot.evidence?.facts??null,on,targets.filter(t=>t.artifact.meetingId===m.id));
 }catch{console.error('online_grading_grader_error');return 0}
}

// ── A2 런타임 하향 ──
// complianceHold: 저장된 작업물 버전의 block 위반(최대 MAX_HOLD_ISSUES건). 사람이 새 버전을 저장하면 새 작업물에는 이 필드가 없다.
export type ComplianceHold={version:string;block:number;issues:{category:string;ruleId:string;title:string;excerpt:string}[];checkedAt:string;notice:string};
type HeldArtifact=Artifact&{complianceHold?:ComplianceHold;qualityReview?:QualityReview};
const MAX_HOLD_ISSUES=20,MAX_ARTIFACT_CHARS=40000;
function complianceHoldOf(report:ComplianceReport,checkedAt:string):ComplianceHold|null{
 const blocks=report.issues.filter(i=>i.severity==='block');
 return blocks.length?{version:report.version,block:blocks.length,issues:blocks.slice(0,MAX_HOLD_ISSUES).map(({category,ruleId,title,excerpt})=>({category,ruleId,title,excerpt})),checkedAt,notice:report.notice}:null;
}
// 채점(scoreArtifact)과 같은 본문·사실 원장으로 점검한다.
const complianceOf=(a:GradedArtifact,ledger:FactLedger|null)=>checkCompliance(bodyOf({id:a.id,kind:'role',role:a.role,text:a.content}),{facts:ledger});
const a2Guarded=async<T>(task:()=>Promise<T>)=>{try{return await task()}catch{console.error('a2_downgrade_error');return null}};
// A2 쓰기가 실제로 적용된 캠페인 버전과, 품질 검수 판정을 ready_for_review→revise로 내렸는지.
type A2Change={campaignVersion:number;revise:boolean};
// compare-and-set: 저장 뒤 사람이 고쳤거나(버전) 승인·outdated로 바뀌었으면(상태) 쓰지 않는다. 읽은 본문이 그사이 바뀌었으면(다른 표시) 한 번만 다시 읽어
// 버전·상태가 그대로일 때 그 본문 위에 다시 쓴다(표시 보존). 두 번째도 changes 0이면 조용히 넘긴다. 반환값은 실제로 썼는지다.
async function casArtifact(owner:string,id:string,version:number,next:(a:HeldArtifact)=>HeldArtifact|null){
 const key=`${owner}:artifact:${id}`;
 for(let attempt=0;attempt<2;attempt++){
  const row=await database().prepare("SELECT data FROM records WHERE id=? AND owner=? AND kind='artifact'").bind(key,owner).first<{data:string}>();
  if(!row)return false;
  const current=JSON.parse(row.data) as HeldArtifact;
  if(current.version!==version||current.status!=='review')return false;
  const data=next(current);
  if(!data)return false;
  const result=await database().prepare("UPDATE records SET data=? WHERE id=? AND owner=? AND kind='artifact' AND json_extract(data,'$.version')=? AND json_extract(data,'$.status')='review' AND data=?").bind(JSON.stringify(data),key,owner,version,row.data).run();
  if(result.meta.changes)return true;
 }
 return false;
}
// 캠페인 표시: A2가 작업물을 실제로 바꿨으면 캠페인 updatedAt을 올려 상세 화면이 다시 읽게 한다. 품질 판정을 ready_for_review→revise로 내렸으면
// 저장 규칙(판정이 ready_for_review가 아니면 캠페인 revision)과 맞게 review만 revision으로 내린다. 같은 캠페인 버전일 때만 쓴다(compare-and-set).
async function touchCampaign(owner:string,campaignId:string,campaignVersion:number,revise:boolean){
 const at=stamp(),key=`${owner}:campaign:${campaignId}`,where="WHERE id=? AND owner=? AND kind='campaign' AND json_extract(data,'$.version')=?";
 if(revise&&(await database().prepare(`UPDATE records SET data=json_set(data,'$.status','revision','$.updatedAt',?),updated_at=? ${where} AND json_extract(data,'$.status')='review'`).bind(at,at,key,owner,campaignVersion).run()).meta.changes)return;
 await database().prepare(`UPDATE records SET data=json_set(data,'$.updatedAt',?),updated_at=? ${where}`).bind(at,at,key,owner,campaignVersion).run();
}
const roleOrder=(a:Artifact)=>roles.findIndex(r=>r.id===a.role);
const holdLine=(a:Artifact,h:ComplianceHold)=>`A2 규제 점검: ${a.title} — ${h.issues[0]?.title??'차단 규칙'}${h.block>1?` 외 ${h.block-1}건`:''}`;
// 판정은 downgradeVerdict로 하향만 한다(ready_for_review→revise). checks·taskChecks·reportedVerdict는 그대로이고 이미 있는 문구는 다시 더하지 않는다.
function downgradedReview(q:QualityReview,lines:string[]):QualityReview|null{
 const existing=Array.isArray(q.gateIssues)?q.gateIssues:q.findings.split('\n'),fresh=lines.filter(l=>!existing.includes(l));
 const verdict=downgradeVerdict(q.verdict,[{severity:'block'}]);
 if(!fresh.length&&verdict===q.verdict)return null;
 return Array.isArray(q.gateIssues)?{...q,verdict,gateIssues:[...q.gateIssues,...fresh]}:{...q,verdict,findings:[q.findings,...fresh].join('\n')};
}
// 품질 검수 저장: 같은 캠페인·같은 캠페인 버전의 현재 작업물(검수 자신 포함) 중 hold가 있거나 이번 점검에서 block이 나온 것이 있으면 하향한다.
// 저장된 hold(화면에 보이는 것)를 먼저 쓰고, 없을 때만 같은 버전의 이번 점검 결과를 쓴다. 쓰기가 적용되면 캠페인 버전과 판정을 내렸는지를 돌려준다.
async function downgradeQuality(owner:string,campaignId:string,target:GradedArtifact,blocked:Map<string,{version:number;hold:ComplianceHold}>):Promise<A2Change|null>{
 const list=await listRecords<HeldArtifact>(owner,'artifact',campaignId),quality=list.find(a=>a.id===target.id);
 if(!quality?.qualityReview||quality.version!==target.version||quality.status!=='review')return null;
 const held=list.filter(a=>a.status!=='outdated'&&a.campaignVersion===quality.campaignVersion).sort((a,b)=>roleOrder(a)-roleOrder(b)||a.id.localeCompare(b.id))
  .flatMap(a=>{const now=blocked.get(a.id),hold=a.complianceHold??(now&&now.version===a.version?now.hold:undefined);return hold?[holdLine(a,hold)]:[]});
 if(!held.length)return null;
 let revise=false;
 const written=await casArtifact(owner,quality.id,quality.version,a=>{
  const review=a.qualityReview&&downgradedReview(a.qualityReview,[...held,COMPLIANCE_NOTICE]);
  revise=!!review&&review.verdict!==a.qualityReview?.verdict;
  return review?{...a,qualityReview:review,content:qualityMarkdown(review).slice(0,MAX_ARTIFACT_CHARS)}:null;
 });
 return written&&quality.campaignVersion!==undefined?{campaignVersion:quality.campaignVersion,revise}:null;
}
// 작업물 하나를 점검해 block이면 hold를 쓴다(이번 점검 결과는 blocked에 남긴다).
async function holdOne(owner:string,artifact:GradedArtifact,ledger:FactLedger|null,reports:Map<string,ComplianceReport>,checkedAt:string,blocked:Map<string,{version:number;hold:ComplianceHold}>):Promise<A2Change|null>{
 // 입력 상한은 온라인 채점과 같다. 넘는 작업물은 점검하지 않는다(hold 없음, 미탐 위험). 로그에는 이름만 남긴다.
 if(artifact.content.split('\n').length>MAX_GRADED_LINES){console.error('a2_downgrade_not_run');return null}
 const hold=complianceHoldOf(reports.get(artifact.id)??complianceOf(artifact,ledger),checkedAt);
 if(!hold)return null;
 blocked.set(artifact.id,{version:artifact.version,hold});
 // 이미 hold가 있으면 그대로 둔다(하향만, 지우거나 줄이지 않는다).
 const written=await casArtifact(owner,artifact.id,artifact.version,a=>a.complianceHold?null:{...a,complianceHold:hold});
 return written&&artifact.campaignVersion!==undefined?{campaignVersion:artifact.campaignVersion,revise:false}:null;
}
async function holdAndDowngrade(owner:string,campaignId:string,targets:GradingTarget[],ledger:FactLedger|null,reports:Map<string,ComplianceReport>){
 const checkedAt=stamp(),blocked=new Map<string,{version:number;hold:ComplianceHold}>(),changes:A2Change[]=[];
 for(const {artifact} of targets){const change=await a2Guarded(()=>holdOne(owner,artifact,ledger,reports,checkedAt,blocked));if(change)changes.push(change)}
 for(const {artifact} of targets.filter(t=>t.artifact.role==='quality')){const change=await a2Guarded(()=>downgradeQuality(owner,campaignId,artifact,blocked));if(change)changes.push(change)}
 // 품질 검수 하향이 있으면 마지막 항목이 그 캠페인 버전이다.
 if(changes.length)await a2Guarded(()=>touchCampaign(owner,campaignId,changes[changes.length-1].campaignVersion,changes.some(c=>c.revise)));
}
// 캠페인 상세 작업물 옆 표시용(GET /api/usage?grading=<캠페인>). 없는 캠페인·다른 소유자는 404다.
export async function campaignGradings(owner:string,campaignId:string){
 await readRecord<Campaign>(owner,'campaign',campaignId);
 return (await listRecords<Grading>(owner,'grading',campaignId)).map(({id,artifactId,artifactVersion,role,source,status,reason,lines,summary,compliance,durationMs,gradedAt,graders})=>({id,artifactId,artifactVersion,role,source,status,reason,lines,summary,compliance:compliance?{block:compliance.block,warn:compliance.warn,info:compliance.info}:null,durationMs,gradedAt,failed:graders.filter(g=>g.status==='fail'||g.status==='grader_error').map(g=>g.id)}));
}
