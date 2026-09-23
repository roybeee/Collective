// 비차단 온라인 채점(F2b). 기능 스위치 online_grading(lib/feature-flags.ts, 기본 꺼짐)이 켜져 있으면 역할·회의 작업물이 저장된 직후
// lib/graders 13종(runGraders)과 규제 가드레일(checkCompliance)로 채점해 grading 레코드(id=<작업물 id>:<버전>, parent=캠페인)로 남긴다.
// 비차단: 작업물 저장·job 상태·사용량 결과(domainOutcome)가 모두 끝난 뒤 부르며 어떤 예외도 던지지 않는다. 채점기 하나의 예외는 runGraders가 그 채점기의
// grader_error 1줄로 격리한다. 채점·저장 자체가 실패하면 status grader_error 기록 1건과 로그 1줄('online_grading_grader_error')만 남긴다.
// 꺼져 있으면 스위치 1행만 읽고 채점기를 한 번도 부르지 않는다. 채점 맥락: 사실 원장(역할=현재 확정·거절 사실, 회의=회의 시작 스냅샷), 지점 캠페인 여부,
// 공급자가 보고한 입력 토큰. 업종(industry)·큐레이션 금지 표현은 운영 캠페인에 없어 비워 둔다(해당 채점기는 not_applicable).
import {database,readRecord,listRecords,recordStatement,stamp,ApiError} from './server';
import {isEnabled} from './feature-flags';
import {evidenceContext} from './ai-context';
import {runGraders,GRADERS_VERSION,type FactLedger,type GradeContext,type GraderResult,type GraderStatus} from './graders/index';
import {bodyOf} from './graders/text';
import {checkCompliance} from './graders/compliance';
import type {Artifact,Campaign} from './agency';
import type {Meeting} from './meetings';

export type GradingSource='role'|'meeting';
type GradedArtifact=Pick<Artifact,'id'|'version'|'role'|'content'|'campaignId'|'campaignVersion'|'outputContractVersion'>;
// usageId: 사용량 원장 행 id('<공급자>:<실행 번호>'). 있으면 보고된 입력 토큰을 input_budget 채점에 쓴다.
export type GradingTarget={artifact:GradedArtifact;source:GradingSource;jobId?:string|null;meetingId?:string|null;usageId?:string|null};
type FactSource='current'|'snapshot'|'none';
export type GradingContext={facts:FactSource;confirmedFacts:number;prohibitedFacts:number;industry:null;localStore:boolean;inputTokens:number|null};
type ComplianceSummary={version:string;block:number;warn:number;info:number;issues:{category:string;ruleId:string;severity:string}[]};
export type Grading={id:string;artifactId:string;artifactVersion:number;campaignId:string;campaignVersion:number|null;role:string;source:GradingSource;jobId:string|null;meetingId:string|null;
 status:'graded'|'grader_error';gradersVersion:string;graders:GraderResult[];summary:Record<GraderStatus,number>|null;compliance:ComplianceSummary|null;context:GradingContext;durationMs:number|null;gradedAt:string;error?:string};

const emptySummary=():Record<GraderStatus,number>=>({pass:0,fail:0,not_applicable:0,grader_error:0});
// 순수 채점: 저장된 본문(사용자가 보는 렌더본)을 채점한다. 규제 점검은 발췌(excerpt) 없이 분류·규칙·심각도만 남긴다.
export function gradeArtifact(artifact:GradedArtifact,ctx:GradeContext,inputTokens:number|null){
 const started=Date.now();
 const item={id:artifact.id,kind:'role' as const,role:artifact.role,text:artifact.content,contract:!!artifact.outputContractVersion,inputTokens};
 const graders=runGraders(item,ctx).map(g=>({id:g.id,status:g.status,...(g.detail?{detail:g.detail.slice(0,200)}:{})}));
 const report=checkCompliance(bodyOf(item),{facts:ctx.facts}),count=(s:string)=>report.issues.filter(i=>i.severity===s).length;
 const summary=graders.reduce((acc,g)=>({...acc,[g.status]:acc[g.status]+1}),emptySummary());
 return {graders,summary,compliance:{version:report.version,block:count('block'),warn:count('warn'),info:count('info'),issues:report.issues.map(i=>({category:i.category,ruleId:i.ruleId,severity:i.severity}))},durationMs:Date.now()-started};
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
async function gradeOne(owner:string,campaign:Pick<Campaign,'id'|'storeId'>,t:GradingTarget,facts:{ledger:FactLedger|null;source:FactSource}){
 const context:GradingContext={facts:facts.source,confirmedFacts:facts.ledger?.confirmed.length??0,prohibitedFacts:facts.ledger?.prohibited.length??0,industry:null,localStore:!!campaign.storeId,inputTokens:null};
 try{
  const inputTokens=await usageInputTokens(owner,t.usageId),base=gradingOf(t,campaign.id,{...context,inputTokens});
  const result=gradeArtifact(t.artifact,{facts:facts.ledger,industry:null,localStore:context.localStore},inputTokens);
  await recordStatement(owner,'grading',base.id,{...base,status:'graded',...result,gradedAt:stamp()} satisfies Grading,campaign.id).run();
 }catch(error){
  console.error('online_grading_grader_error');
  const base=gradingOf(t,campaign.id,context),failed:Grading={...base,status:'grader_error',graders:[],summary:null,compliance:null,durationMs:null,gradedAt:stamp(),error:String((error as Error)?.message||error).slice(0,200)};
  await recordStatement(owner,'grading',base.id,failed,campaign.id).run().catch(()=>undefined);
 }
}
async function switchedOn(owner:string){
 try{return await isEnabled(owner,'online_grading')}catch{console.error('online_grading_flag_unreadable');return false}
}
async function factsFor(owner:string,campaign:Campaign,snapshot?:{confirmed?:unknown[];prohibited?:unknown[]}|null){
 if(snapshot)return {ledger:ledgerOf(snapshot),source:'snapshot' as const};
 try{return {ledger:ledgerOf((await evidenceContext(database(),owner,campaign)).facts),source:'current' as const}}
 catch{return {ledger:null,source:'none' as const}}
}
// 역할 실행(lib/role-execution.ts)·회의(gradeMeetingArtifacts)가 저장 직후 부른다. 반환값은 채점한 작업물 수(꺼짐이면 0).
export async function gradeSavedArtifacts(owner:string,campaign:Campaign,targets:GradingTarget[],snapshotFacts?:{confirmed?:unknown[];prohibited?:unknown[]}|null){
 if(!targets.length||!(await switchedOn(owner)))return 0;
 const facts=await factsFor(owner,campaign,snapshotFacts);
 for(const target of targets)await gradeOne(owner,campaign,target,facts);
 return targets.length;
}
// 회의가 저장한 작업물(m.artifactIds)을 저장된 그대로 읽어 채점한다. 사실 원장은 회의 시작 스냅샷을 쓴다.
export async function gradeMeetingArtifacts(owner:string,m:Meeting){
 try{
  if(!m.artifactIds.length||!(await switchedOn(owner)))return 0;
  const saved=(await listRecords<Artifact>(owner,'artifact',m.campaignId)).filter(a=>m.artifactIds.includes(a.id));
  return await gradeSavedArtifacts(owner,m.snapshot.campaign,saved.map(artifact=>({artifact,source:'meeting',meetingId:m.id})),m.snapshot.evidence?.facts??null);
 }catch{console.error('online_grading_grader_error');return 0}
}
// 캠페인 상세 작업물 옆 표시용(GET /api/usage?grading=<캠페인>). 없는 캠페인·다른 소유자는 404다.
export async function campaignGradings(owner:string,campaignId:string){
 await readRecord<Campaign>(owner,'campaign',campaignId);
 return (await listRecords<Grading>(owner,'grading',campaignId)).map(({id,artifactId,artifactVersion,role,source,status,summary,compliance,durationMs,gradedAt,graders})=>({id,artifactId,artifactVersion,role,source,status,summary,compliance:compliance?{block:compliance.block,warn:compliance.warn,info:compliance.info}:null,durationMs,gradedAt,failed:graders.filter(g=>g.status==='fail'||g.status==='grader_error').map(g=>g.id)}));
}
