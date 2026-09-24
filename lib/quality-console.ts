// B2 1단계 품질 콘솔의 순수 집계(LLM·네트워크·DB 없음). lib/quality-console-server.ts가 D1 레코드를 모양 그대로 넘기고 화면·주간 다이제스트(lib/quality-digest.ts)·로컬 스크립트(scripts/quality-digest.mjs)가 같은 결과를 쓴다.
// 정의는 가져다 쓴다: 1차 승인율 = B1 firstPassApproval, 사유 = B1 REVIEW_REASONS, 재질문 = isQuestionOnly(워크스페이스 숫자 lib/workspace-metrics.ts의 artifactUsable과 같은 함수), 과거 사람 수정본 = legacyHumanEdit,
// 채점 실패 = campaignGradings failed(fail·grader_error), 토큰 = 토큰 예산 누계 규칙(총 토큰, 없으면 입력+출력, 둘 다 모르면 0으로 채우지 않고 따로 센다).
// 새 정의(판 단위 집계·프롬프트 버전 축·폐기 사유·미연결·회의 완주율·주 경계)와 표본 규칙은 docs/QUALITY-CONSOLE.ko.md.
// 출력에는 역할·버전·보고 모델·건수·토큰만 싣는다. 작업물 본문·검토 메모·채점 상세·회의 안건·이메일·계정 id는 넣지 않는다. 입력은 바꾸지 않는다.
import {roles,type Artifact} from './agency';
import {isQuestionOnly} from './role-output';
import {REVIEW_DECISIONS,REVIEW_REASONS,firstPassApproval,legacyHumanEdit,type ReasonCode,type ReviewDecision,type ReviewTargetKind} from './review-decisions';
import type {ProviderUsage} from './usage-ledger';
import type {Grading,ComplianceHold} from './online-grading';
import type {Meeting} from './meetings';

export const QUALITY_CONSOLE_VERSION='quality-console-v1';
// 비율의 최소 표본. 표본이 이보다 작으면 비율은 null('표본 부족')이고 n은 항상 같이 낸다.
export const MIN_SAMPLE=5;
// 입력: 각 필드는 D1 레코드 모양 그대로의 배열이다. decisions는 기록 순서(rowid). jobs는 jobs 표 행(선택)으로, 조인 키가 없는 F2a 이전 사용량을 provider_id로 잇는다.
// complianceHold는 checkedAt이 없으면(필드를 줄여 읽은 경우) 작업물 작성 시각으로 센다. A2는 저장 직후 점검한다. promptVersion은 F3a가 역할·회의 작업물에 남긴 실행 버전이다.
export type ConsoleArtifact=Pick<Artifact,'id'|'role'|'content'|'status'|'version'|'origin'|'createdAt'>&{skillVersion?:string|null;promptVersion?:string|null;meetingId?:string|null;
 aiSource?:{version?:number|null;skillVersion?:string|null}|null;complianceHold?:Partial<Pick<ComplianceHold,'checkedAt'>>|null};
// history(선택): kind 'history' 레코드(작업물 이전 판). 새 판 저장·회의 개선·outdated 처리 때 남긴 복사본이고 id는 이력 id, originalId가 작업물 id다. 본문은 쓰지 않는다.
export type ConsoleHistory=Omit<ConsoleArtifact,'id'|'content'>&{originalId:string;content?:string};
export type ConsoleUsage=Pick<ProviderUsage,'providerRunId'|'model'|'inputTokens'|'outputTokens'|'totalTokens'|'observedAt'|'domainOutcome'|'jobId'|'kind'|'role'|'artifactId'|'promptVersion'>;
export type ConsoleMeeting=Pick<Meeting,'id'|'status'|'createdAt'>;
export type ConsoleGrading=Pick<Grading,'artifactId'|'role'|'status'|'gradedAt'>&{artifactVersion?:number|null;jobId?:string|null;graders?:readonly {id:string;status:string}[]};
// jobs 행은 D1 열 이름(provider_id) 그대로든 camelCase 별칭(providerId)이든 받는다.
export type ConsoleJob={id:string;role:string;provider_id?:string|null;providerId?:string|null};
export type ConsoleInput={artifacts:readonly ConsoleArtifact[];history?:readonly ConsoleHistory[];decisions:readonly ReviewDecision[];usage:readonly ConsoleUsage[];meetings:readonly ConsoleMeeting[];gradings:readonly ConsoleGrading[];jobs?:readonly ConsoleJob[]};

// 폐기 사유. 한 사용량에는 하나만 붙고 우선순위는 형식 오류 실행 > 재질문만 남긴 작업물 > 수정 요청을 받은 AI 판 > 이전 버전(outdated)이다. 목록은 표시 순서다.
export type DiscardReason='invalid_output'|'question_only'|'revision'|'outdated';
export const DISCARD_REASONS:readonly DiscardReason[]=['question_only','revision','outdated','invalid_output'];
export type GradingCounts={graded:number;grader_error:number;not_run:number;failedGraders:number};
export type ConsoleMetrics={artifacts:number;n:number;approvedFirst:number;editedFirst:number;firstPassRate:number|null;revisions:number;reasons:Record<ReasonCode,number>;
 discardedTokens:number;discarded:Record<DiscardReason,number>;unlinkedTokens:number;unknownTokenRuns:number;gradings:GradingCounts;holds:number};
// 행 = 역할×스킬 버전×프롬프트 버전×보고 모델. promptVersion은 레지스트리 버전이고 코드 상수 실행이면 null이다. promptVersions는 그 행 사용량의 원래 promptVersion 목록이다.
export type ConsoleRow={role:string;skillVersion:string|null;promptVersion:string|null;reportedModel:string|null;promptVersions:string[]}&ConsoleMetrics;
export type FirstPassView={role:string;skillVersion:string|null;n:number;approvedFirst:number;editedFirst:number;rate:number|null};
export type ReasonCount={code:ReasonCode;label:string;total:number}&Record<ReviewTargetKind,number>;
export type MeetingCompletion={started:number;completed:number;failed:number;cancelled:number;inProgress:number;rate:number|null};
export type WeekPoint={week:string;from:string;to:string;meetings:MeetingCompletion}&ConsoleMetrics;
export type ConsoleSummary={version:string;from:string;to:string;minSample:number;rows:ConsoleRow[];totals:ConsoleMetrics&{otherKindTokens:number};firstPass:FirstPassView[];
 reasons:ReasonCount[];decisions:Record<ReviewTargetKind,number>;failedGraders:{id:string;count:number}[];meetings:MeetingCompletion;weeks:WeekPoint[]};

// ── 기간과 주(한국 시간, ISO 주: 월요일 00:00 KST 시작) ──
const KST_MS=9*3600e3,DAY_MS=864e5,WEEK_MS=7*DAY_MS,DATE=/^\d{4}-\d{2}-\d{2}$/;
type Range={from:number;to:number};
const iso=(t:number)=>new Date(t).toISOString();
export const kstDate=(instant:string)=>iso(Date.parse(instant)+KST_MS).slice(0,10);
const mondayIndex=(t:number)=>(new Date(t).getUTCDay()+6)%7;
export function isoWeekOf(instant:string):string{
 const t=Date.parse(instant);if(!Number.isFinite(t))throw new RangeError('시각을 확인하세요.');
 const local=Math.floor((t+KST_MS)/DAY_MS)*DAY_MS,thursday=local+(3-mondayIndex(local))*DAY_MS,year=new Date(thursday).getUTCFullYear();
 const jan4=Date.UTC(year,0,4),week1=jan4-mondayIndex(jan4)*DAY_MS;
 return `${year}-W${String(Math.floor((thursday-week1)/WEEK_MS)+1).padStart(2,'0')}`;
}
// 'YYYY-Www' → [월요일 00:00 KST, 다음 월요일 00:00 KST)의 UTC 시각. 없는 주(W00·W54·그해에 없는 W53)는 null.
export function weekRange(week:string):{from:string;to:string}|null{
 const m=/^(\d{4})-W(\d{2})$/.exec(week);if(!m)return null;
 const jan4=Date.UTC(Number(m[1]),0,4),monday=jan4-mondayIndex(jan4)*DAY_MS+(Number(m[2])-1)*WEEK_MS,from=iso(monday-KST_MS);
 return Number(m[2])>=1&&isoWeekOf(from)===week?{from,to:iso(monday+WEEK_MS-KST_MS)}:null;
}
export const previousWeek=(week:string)=>{const r=weekRange(week);return r?isoWeekOf(iso(Date.parse(r.from)-1)):null};
// from·to: 한국 시간 날짜(YYYY-MM-DD, 둘 다 포함) 또는 ISO 시각(from 포함·to 제외).
function instantOf(value:string,end:boolean){
 if(!DATE.test(value))return Date.parse(value);
 const t=Date.parse(value+'T00:00:00+09:00');
 return Number.isFinite(t)&&kstDate(iso(t))===value?t+(end?DAY_MS:0):NaN;
}
function periodOf(p:{from:string;to:string}):Range{
 const from=instantOf(String(p.from),false),to=instantOf(String(p.to),true);
 if(!Number.isFinite(from)||!Number.isFinite(to)||from>=to)throw new RangeError('기간(from·to)을 확인하세요.');
 return {from,to};
}
const within=(t:number,r:Range)=>t>=r.from&&t<r.to;
function weeksOf(r:Range):(Range&{week:string})[]{
 const out:(Range&{week:string})[]=[];
 for(let week=isoWeekOf(iso(r.from));;){
  const w=weekRange(week)!,from=Math.max(Date.parse(w.from),r.from),to=Math.min(Date.parse(w.to),r.to);
  if(from>=r.to)return out;
  out.push({week,from,to});week=isoWeekOf(w.to);
 }
}

// ── 조인: 작업물 판·회의·jobs·채점 기록으로 사용량과 판정을 역할×스킬 버전×프롬프트 버전×보고 모델 행에 잇는다 ──
type Key=readonly [role:string,skillVersion:string|null,promptVersion:string|null,model:string|null];
const AI_ORIGINS=['ai','ai_edited'];
const FAILED_OUTCOMES=['provider_failed','cancelled','storage_failed'];
const meetingIdOf=(jobId:string|null|undefined)=>{const i=jobId?jobId.lastIndexOf(':meeting:'):-1;return i>=0?jobId!.slice(i+9):null};
// promptVersion '<스킬 버전>:<지시 해시>'의 스킬 버전. 인라인 지시('inline:')·레지스트리 버전·빈 값은 null.
const skillOfPrompt=(p:string|null|undefined)=>{const i=p?p.lastIndexOf(':'):-1,s=i>0?p!.slice(0,i):null;return s&&s!=='inline'&&!s.includes('@')?s:null};
// 프롬프트 레지스트리(F3a) 버전 'role.<역할>@<sha12>+channel.<채널>@<sha12>'. 코드 상수 실행의 '<스킬 버전>:<지시 해시>'는 null이다.
export const registryPromptVersion=(p:string|null|undefined)=>typeof p==='string'&&p.includes('@')?p:null;
// 레지스트리 실행은 프롬프트 버전으로 묶고 스킬 버전 칸은 비운다(사용량 원장에 스킬 버전이 남지 않아, 넣으면 같은 실행이 작업물 행과 사용량 행으로 갈린다). 코드 상수 실행은 스킬 버전으로 묶는다.
const keyOf=(role:string,skill:string|null|undefined,prompt:string|null|undefined,model:string|null|undefined):Key=>{const p=registryPromptVersion(prompt);return [role,p?null:skill??null,p,model??null]};
const vkey=(id:string,version:number|null|undefined)=>JSON.stringify([id,version??null]);
const aiDraft=(a:ConsoleArtifact)=>a.origin==='ai'&&!legacyHumanEdit(a);
function tokensOf(u:ConsoleUsage){
 if(typeof u.totalTokens==='number')return u.totalTokens;
 return typeof u.inputTokens==='number'&&typeof u.outputTokens==='number'?u.inputTokens+u.outputTokens:null;
}
const firstMap=<T,>(list:readonly T[],key:(x:T)=>string|null|undefined,value:(x:T)=>string|null|undefined)=>
 list.reduce((m,x)=>{const k=key(x),v=value(x);return k&&v&&!m.has(k)?m.set(k,v):m},new Map<string,string>());
// 판 목록: 현재 작업물 레코드와 이력의 이전 판을 (작업물 id, 버전)마다 하나로 모은다. 같은 판이 둘 다 있으면 현재 레코드를 쓴다.
function versionsOf(input:ConsoleInput){
 const current=input.artifacts.map(a=>[vkey(a.id,a.version),a] as const);
 const earlier=(input.history||[]).filter(h=>h.originalId).map(h=>[vkey(h.originalId,h.version),{...h,id:h.originalId,content:h.content??''}] as const);
 return [...current,...earlier].reduce((m,[k,a])=>m.has(k)?m:m.set(k,a),new Map<string,ConsoleArtifact>());
}
// 열린 수정 요청: 사람이 고치지 않은 AI 판(origin ai)에 revision이 기록됐고 그 뒤 같은 판에 approved가 없는 (작업물 id, 버전).
function revisedDrafts(decisions:readonly ReviewDecision[]){
 const open=new Set<string>();
 for(const d of decisions)if(d.targetKind==='artifact'){
  const k=vkey(d.targetId,d.version);
  if(d.decision==='revision'&&d.origin==='ai')open.add(k);else if(d.decision==='approved')open.delete(k);
 }
 return open;
}
const runOf=(j:ConsoleJob)=>j.provider_id??j.providerId??null;
function buildIndex(input:ConsoleInput){
 const jobs=input.jobs||[],usage=input.usage,meetingRole=(u:ConsoleUsage)=>{const m=meetingIdOf(u.jobId);return m?`${m}|${u.role??''}`:null};
 return {
  artifacts:new Map(input.artifacts.map(a=>[a.id,a])),versions:versionsOf(input),meetings:new Set(input.meetings.map(m=>m.id)),
  jobs:new Map(jobs.map(j=>[j.id,j])),jobsByRun:new Map(jobs.filter(runOf).map(j=>[runOf(j)!,j])),
  artifactByJob:firstMap(input.gradings,g=>g.jobId,g=>g.artifactId),jobByArtifact:firstMap(input.gradings,g=>g.artifactId,g=>g.jobId),
  modelByArtifact:firstMap(usage,u=>u.artifactId,u=>u.model),skillByArtifact:firstMap(usage,u=>u.artifactId,u=>skillOfPrompt(u.promptVersion)),promptByArtifact:firstMap(usage,u=>u.artifactId,u=>u.promptVersion),
  modelByJob:firstMap(usage,u=>u.jobId,u=>u.model),modelByRun:firstMap(usage,u=>u.providerRunId,u=>u.model),
  modelByMeetingRole:firstMap(usage,meetingRole,u=>u.model),promptByMeetingRole:firstMap(usage,meetingRole,u=>u.promptVersion),
  revised:revisedDrafts(input.decisions),
 };
}
type Index=ReturnType<typeof buildIndex>;
// (작업물 id, 버전) 판의 AI 원본 판: AI 판은 자기 자신, 사람이 고친 판(ai_edited)은 aiSource.version의 판이다. 판 기록이 없거나 과거 사람 수정본이면 null(역할 실행으로 본다).
function sourceOf(ix:Index,id:string,version:number|null|undefined){
 const rec=ix.versions.get(vkey(id,version));
 if(!rec)return null;
 if(rec.origin==='ai_edited')return ix.versions.get(vkey(id,rec.aiSource?.version))??null;
 return legacyHumanEdit(rec)?null:rec;
}
const meetingRoleOf=(src:ConsoleArtifact|null)=>src?.meetingId?`${src.meetingId}|${src.role}`:null;
// 보고 모델: 회의가 쓴 판(AI 원본 판에 meetingId)은 그 회의·역할의 사용량을 먼저, 그 밖(역할 실행 1판)은 작업물 사용량(artifactId)을 먼저 본다.
// 회의 개선은 역할 작업물 id를 재사용하므로(lib/meeting-execution.ts) 버전으로 가른다. 다음은 채점 기록의 jobId(또는 jobs.provider_id)로 찾은 사용량이다. 못 찾으면 null.
function modelOf(ix:Index,id:string,version:number|null|undefined,jobId?:string|null){
 const meeting=meetingRoleOf(sourceOf(ix,id,version)),job=jobId??ix.jobByArtifact.get(id),row=job?ix.jobs.get(job):undefined,run=row?runOf(row):null;
 return (meeting?ix.modelByMeetingRole.get(meeting):undefined)??ix.modelByArtifact.get(id)??(job?ix.modelByJob.get(job):undefined)??(run?ix.modelByRun.get(run):undefined)??null;
}
// 프롬프트 버전: AI 원본 판의 promptVersion(F3a) → 넘겨받은 값(B1 판정의 promptVersion) → 회의 판은 그 회의·역할 사용량, 그 밖은 역할 실행 사용량의 promptVersion.
function promptOf(ix:Index,id:string,version:number|null|undefined,given?:string|null){
 const src=sourceOf(ix,id,version),meeting=meetingRoleOf(src);
 return src?.promptVersion??given??(meeting?ix.promptByMeetingRole.get(meeting):ix.promptByArtifact.get(id))??null;
}
// 스킬 버전은 B1 판정 기록과 같은 기준이다: 사람이 고친 판은 AI 원본의 aiSource.skillVersion, 그 밖은 판의 skillVersion. 없으면 그 작업물 사용량 promptVersion의 앞부분.
const skillOf=(ix:Index,a:ConsoleArtifact)=>(a.origin==='ai_edited'?a.aiSource?.skillVersion:a.skillVersion)??ix.skillByArtifact.get(a.id)??null;
const versionKey=(ix:Index,a:ConsoleArtifact):Key=>keyOf(a.role,skillOf(ix,a),promptOf(ix,a.id,a.version),modelOf(ix,a.id,a.version));
// 역할 실행 사용량의 폐기 사유. 역할 실행은 1판을 만들고(lib/role-execution.ts version:1) 회의 개선은 같은 id에 새 판을 쓴다.
// 그래서 재질문과 B1 이전 상태 revision은 현재 레코드가 그 1판(사람·회의가 바꾸지 않은 AI 판)일 때만 보고, 수정 요청은 1판에 열린 revision만 센다. outdated는 작업물 현재 상태다.
function roleRunDiscard(a:ConsoleArtifact,ix:Index):DiscardReason|null{
 const own=a.version===1&&!a.meetingId&&aiDraft(a);
 if(own&&isQuestionOnly(a.content))return 'question_only';
 if(ix.revised.has(vkey(a.id,1))||own&&a.status==='revision')return 'revision';
 return a.status==='outdated'?'outdated':null;
}

// ── 사건: 레코드마다 시각·행 키·지표 변화를 한 번 만들고 기간마다 걸러 접는다 ──
type Ev={at:number;key:Key|null}&({t:'artifact'}|{t:'hold'}|{t:'first';d:ReviewDecision}|{t:'decision';d:ReviewDecision;ai:boolean}
 |{t:'usage';tokens:number|null;reason:DiscardReason|null;unlinked:boolean;other:boolean;promptVersion:string|null}|{t:'grading';status:Grading['status'];failed:string[]});
function decisionEvents(decisions:readonly ReviewDecision[],ix:Index):Ev[]{
 const seen=new Set<string>();
 return decisions.flatMap(d=>{
  // 판정은 B1 기록의 역할·스킬 버전을 쓰고, 프롬프트 버전·보고 모델은 판정한 판(버전) 기준이다.
  const ai=d.targetKind==='artifact'&&AI_ORIGINS.includes(d.origin??''),at=Date.parse(d.createdAt);
  const key:Key|null=ai?keyOf(d.role||'',d.skillVersion,promptOf(ix,d.targetId,d.version,d.promptVersion),modelOf(ix,d.targetId,d.version)):null;
  // 1차 판정은 B1과 같이 대상별 기록 순서상 첫 작업물 판정이다(출처와 무관하게 먼저 정하고 AI 판정만 센다).
  const first=d.targetKind==='artifact'&&!seen.has(d.targetId);if(first)seen.add(d.targetId);
  return [{t:'decision' as const,at,key,d,ai},...(first&&ai?[{t:'first' as const,at,key,d}]:[])];
 });
}
function usageEvent(u:ConsoleUsage,ix:Index):Ev{
 const job=u.jobId?ix.jobs.get(u.jobId):ix.jobsByRun.get(u.providerRunId),jobId=u.jobId??job?.id??null;
 const kind=u.kind??(job?(job.role==='meeting'?'meeting':'role'):null),invalid=u.domainOutcome==='invalid_output';
 const base={t:'usage' as const,at:Date.parse(u.observedAt),tokens:tokensOf(u),promptVersion:u.promptVersion??null,other:false};
 const role=u.role??(job&&job.role!=='meeting'?job.role:null),roleKey=role?keyOf(role,skillOfPrompt(u.promptVersion),u.promptVersion,u.model):null;
 if(kind&&kind!=='role'&&kind!=='meeting')return {...base,key:null,reason:null,unlinked:false,other:true};
 if(kind==='meeting')return {...base,key:roleKey,reason:invalid?'invalid_output':null,unlinked:!invalid&&!ix.meetings.has(meetingIdOf(jobId)??'')};
 // 역할 실행이거나 종류를 모르는(F2a 이전) 행: artifactId, 없으면 채점 기록의 jobId로 작업물을 찾는다. 역할 실행은 1판이라 스킬 버전은 1판 기준이다.
 const artifact=ix.artifacts.get(u.artifactId??ix.artifactByJob.get(jobId??'')??''),first=artifact?ix.versions.get(vkey(artifact.id,1)):undefined;
 const key=artifact?keyOf(artifact.role,(first?skillOf(ix,first):null)??skillOfPrompt(u.promptVersion)??skillOf(ix,artifact),u.promptVersion??first?.promptVersion,u.model):roleKey;
 const failed=kind==='role'&&FAILED_OUTCOMES.includes(u.domainOutcome??'');
 return {...base,key,reason:invalid?'invalid_output':artifact?roleRunDiscard(artifact,ix):null,unlinked:!invalid&&!artifact&&!failed};
}
// 채점은 채점한 판(artifactVersion) 기준이다. 그 판 기록이 없으면 현재 작업물로 역할·스킬 버전을 정한다.
function gradingEvent(g:ConsoleGrading,ix:Index):Ev{
 const a=ix.versions.get(vkey(g.artifactId,g.artifactVersion))??ix.artifacts.get(g.artifactId),version=g.artifactVersion??a?.version;
 const key=keyOf(a?.role??g.role,a?skillOf(ix,a):null,promptOf(ix,g.artifactId,version),modelOf(ix,g.artifactId,version,g.jobId));
 return {t:'grading',at:Date.parse(g.gradedAt),key,status:g.status,failed:(g.graders||[]).filter(x=>x.status==='fail'||x.status==='grader_error').map(x=>x.id)};
}
// 작업물·규제 보류는 판(작업물 id·버전)마다 만든 시각·점검 시각에 센다. 이전 판은 이력(history)에 남아 새 판을 저장해도 지난 주 수치가 바뀌지 않는다.
function eventsOf(input:ConsoleInput):Ev[]{
 const ix=buildIndex(input),versions=[...ix.versions.values()];
 return [
  ...versions.filter(a=>AI_ORIGINS.includes(a.origin)).map(a=>({t:'artifact' as const,at:Date.parse(a.createdAt),key:versionKey(ix,a)})),
  ...versions.flatMap(a=>a.complianceHold?[{t:'hold' as const,at:Date.parse(a.complianceHold.checkedAt??a.createdAt),key:versionKey(ix,a)}]:[]),
  ...decisionEvents(input.decisions,ix),...input.usage.map(u=>usageEvent(u,ix)),...input.gradings.map(g=>gradingEvent(g,ix)),
 ];
}

// ── 접기 ──
const zeroReasons=()=>Object.fromEntries(REVIEW_REASONS.map(r=>[r.code,0])) as Record<ReasonCode,number>;
const zeroDiscards=()=>Object.fromEntries(DISCARD_REASONS.map(r=>[r,0])) as Record<DiscardReason,number>;
const emptyMetrics=():ConsoleMetrics=>({artifacts:0,n:0,approvedFirst:0,editedFirst:0,firstPassRate:null,revisions:0,reasons:zeroReasons(),discardedTokens:0,discarded:zeroDiscards(),unlinkedTokens:0,unknownTokenRuns:0,gradings:{graded:0,grader_error:0,not_run:0,failedGraders:0},holds:0});
function applyUsage(m:ConsoleMetrics,e:Extract<Ev,{t:'usage'}>):ConsoleMetrics{
 if(e.other)return m;
 const t=e.tokens??0;
 return {...m,unknownTokenRuns:m.unknownTokenRuns+Number(e.tokens===null),unlinkedTokens:m.unlinkedTokens+(e.unlinked?t:0),
  ...(e.reason?{discardedTokens:m.discardedTokens+t,discarded:{...m.discarded,[e.reason]:m.discarded[e.reason]+t}}:{})};
}
function apply(m:ConsoleMetrics,e:Ev):ConsoleMetrics{
 if(e.t==='artifact')return {...m,artifacts:m.artifacts+1};
 if(e.t==='hold')return {...m,holds:m.holds+1};
 if(e.t==='usage')return applyUsage(m,e);
 if(e.t==='grading')return {...m,gradings:{...m.gradings,[e.status]:(m.gradings[e.status]??0)+1,failedGraders:m.gradings.failedGraders+e.failed.length}};
 if(e.t==='first'){const r=firstPassApproval([e.d])[0];return r?{...m,n:m.n+r.artifacts,approvedFirst:m.approvedFirst+r.approvedFirst,editedFirst:m.editedFirst+r.editedFirst}:m}
 if(!e.ai)return m;
 const codes=e.d.reasonCodes||[];
 return {...m,revisions:m.revisions+Number(e.d.decision==='revision'),reasons:Object.fromEntries(Object.entries(m.reasons).map(([c,n])=>[c,n+Number(codes.includes(c as ReasonCode))])) as Record<ReasonCode,number>};
}
const rateOf=(k:number,n:number)=>n>=MIN_SAMPLE?k/n:null;
const totalsOf=(events:readonly Ev[]):ConsoleMetrics=>{const m=events.reduce(apply,emptyMetrics());return {...m,firstPassRate:rateOf(m.approvedFirst,m.n)}};
const roleIndex=(role:string)=>{const i=roles.findIndex(r=>r.id===role);return i<0?roles.length:i};
const nullLast=(a:string|null,b:string|null)=>a===b?0:a===null?1:b===null?-1:a.localeCompare(b);
function rowsOf(events:readonly Ev[]):ConsoleRow[]{
 const groups=new Map<string,Ev[]>();
 for(const e of events)if(e.key&&!(e.t==='decision'&&!e.ai)){const k=JSON.stringify(e.key),list=groups.get(k);if(list)list.push(e);else groups.set(k,[e])}
 return [...groups.values()].map(list=>{
  const [role,skillVersion,promptVersion,reportedModel]=list[0].key!;
  return {role,skillVersion,promptVersion,reportedModel,promptVersions:[...new Set(list.flatMap(e=>e.t==='usage'&&e.promptVersion?[e.promptVersion]:[]))].sort(),...totalsOf(list)};
 }).sort((a,b)=>roleIndex(a.role)-roleIndex(b.role)||a.role.localeCompare(b.role)||nullLast(a.skillVersion,b.skillVersion)||nullLast(a.promptVersion,b.promptVersion)||nullLast(a.reportedModel,b.reportedModel));
}
const firstPassView=(events:readonly Ev[]):FirstPassView[]=>firstPassApproval(events.flatMap(e=>e.t==='first'?[e.d]:[]))
 .map(r=>({role:r.role,skillVersion:r.skillVersion,n:r.artifacts,approvedFirst:r.approvedFirst,editedFirst:r.editedFirst,rate:rateOf(r.approvedFirst,r.artifacts)}));
const TARGET_KINDS=Object.keys(REVIEW_DECISIONS) as ReviewTargetKind[];
const decisionsIn=(events:readonly Ev[])=>events.flatMap(e=>e.t==='decision'?[e.d]:[]);
function reasonCounts(events:readonly Ev[]):ReasonCount[]{
 const ds=decisionsIn(events);
 return REVIEW_REASONS.map(r=>{
  const by=Object.fromEntries(TARGET_KINDS.map(k=>[k,ds.filter(d=>d.targetKind===k&&(d.reasonCodes||[]).includes(r.code)).length])) as Record<ReviewTargetKind,number>;
  return {code:r.code,label:r.label,...by,total:TARGET_KINDS.reduce((s,k)=>s+by[k],0)};
 });
}
const decisionCounts=(events:readonly Ev[])=>{const ds=decisionsIn(events);return Object.fromEntries(TARGET_KINDS.map(k=>[k,ds.filter(d=>d.targetKind===k).length])) as Record<ReviewTargetKind,number>};
function graderFailures(events:readonly Ev[]){
 const ids=events.flatMap(e=>e.t==='grading'?e.failed:[]);
 return [...new Set(ids)].map(id=>({id,count:ids.filter(x=>x===id).length})).sort((a,b)=>b.count-a.count||a.id.localeCompare(b.id));
}
// 회의 완주율 = 기간 안에 시작한(createdAt) 회의 중 completed. 진행 중(running·uncertain)도 분모에 남기고 따로 보인다.
function meetingCompletion(meetings:readonly ConsoleMeeting[],r:Range):MeetingCompletion{
 const list=meetings.filter(m=>within(Date.parse(m.createdAt),r)),count=(...s:string[])=>list.filter(m=>s.includes(m.status)).length;
 const started=list.length,completed=count('completed');
 return {started,completed,failed:count('failed'),cancelled:count('cancelled'),inProgress:count('running','uncertain'),rate:rateOf(completed,started)};
}
const otherTokens=(events:readonly Ev[])=>events.reduce((s,e)=>s+(e.t==='usage'&&e.other?e.tokens??0:0),0);

export function consoleSummary(input:ConsoleInput,opts:{from:string;to:string}):ConsoleSummary{
 const range=periodOf(opts),events=eventsOf(input),inside=events.filter(e=>within(e.at,range));
 const weeks=weeksOf(range).map(w=>({week:w.week,from:iso(w.from),to:iso(w.to),...totalsOf(events.filter(e=>within(e.at,w))),meetings:meetingCompletion(input.meetings,w)}));
 return {version:QUALITY_CONSOLE_VERSION,from:iso(range.from),to:iso(range.to),minSample:MIN_SAMPLE,rows:rowsOf(inside),totals:{...totalsOf(inside),otherKindTokens:otherTokens(inside)},
  firstPass:firstPassView(inside),reasons:reasonCounts(inside),decisions:decisionCounts(inside),failedGraders:graderFailures(inside),meetings:meetingCompletion(input.meetings,range),weeks};
}
