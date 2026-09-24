// B2 품질 콘솔 서버 조회(GET /api/quality-console). 소유자(owner) 범위로 기간 안의 레코드와 그 집계에 필요한 이력만 읽어 순수 집계(lib/quality-console.ts consoleSummary)·
// 기준별 κ(lib/quality-kappa.ts criterionKappa, 단위는 B1 criterionUnits와 같은 unitsFromDecisions)·주간 묶음과 다이제스트(lib/quality-digest.ts weeklyPayload·digestMarkdown)에 넘긴다. 쓰기·잠금·모델(HERMES·OpenAI) 호출이 없다.
// 기간: 한국 시간(KST) 날짜 from~to(양 끝 포함). 기본은 오늘까지 최근 28일, 최대 180일. 주간은 ISO 주(월요일 00:00 KST 시작)다.
// 함께 읽는 이력: 기간 안에 판정한 작업물의 기간 전 판정(1차 판정을 B1 기록 순서로 정한다), 기간 안의 판정·사용량·채점·보류가 가리키는 작업물과 그 이전 판(kind 'history'),
// 기간 안에 판정·작성·채점·보류 점검한 작업물과 기간 안 이전 판의 사용량, 그 판을 쓴 회의의 사용량(보고 모델·버전), 기간 안 회의 사용량의 회의, 사용량·채점이 가리키는 jobs 행(F2a 이전 사용량을 provider_id로 잇는다).
// 기간 밖 사건은 집계가 기간으로 걸러 세지 않는다.
// D1 한도: IN 하위 쿼리만 써서 쿼리마다 바인드 값 수가 고정이고, 종류별로 최근 MAX_ROWS행만 읽는다(κ 라벨 포함). 넘으면 최근 행만 집계하고 partial에 종류를 남긴다(화면 '일부만 집계').
// 큰 본문은 읽지 않는다: 작업물 본문은 재질문 판정(isQuestionOnly는 2,500자 이하만 해당)에 필요한 길이만, 이전 판·회의·채점은 집계에 쓰는 필드만 읽는다.
import {ApiError,database,readRecord} from './server';
import {kstDayStart} from './usage-summary';
import type {CriterionUnit} from './review-decisions-server';
import type {ReviewDecision} from './review-decisions';
import {consoleSummary,isoWeekOf,previousWeek,weekRange,type ConsoleArtifact,type ConsoleGrading,type ConsoleHistory,type ConsoleInput,type ConsoleJob,type ConsoleMeeting,type ConsoleUsage} from './quality-console';
import {criterionKappa,unitsFromDecisions} from './quality-kappa';
import {digestFileName,digestMarkdown,weeklyPayload} from './quality-digest';

const DAY=86400000,DAY_RE=/^\d{4}-\d{2}-\d{2}$/;
export const DEFAULT_DAYS=28,MAX_DAYS=180,MAX_ROWS=5000;
const dayMs=(day:string)=>Date.parse(day+'T00:00:00Z');
const dayOf=(ms:number)=>new Date(ms).toISOString().slice(0,10);
const validDay=(day:string)=>DAY_RE.test(day)&&Number.isFinite(dayMs(day))&&dayOf(dayMs(day))===day;
export const kstToday=(now=Date.now())=>dayOf(now+9*3600000);
export const addDays=(day:string,n:number)=>dayOf(dayMs(day)+n*DAY);
// 지난주: 오늘(KST)이 속한 ISO 주의 바로 앞 주.
export const lastFullWeek=(now=Date.now())=>previousWeek(isoWeekOf(new Date(now).toISOString()))!;
export type ConsolePeriod={from:string;to:string;days:number;start:string;end:string};
export function consolePeriod(params:URLSearchParams,now=Date.now()):ConsolePeriod{
 const from=params.get('from')||null,to=params.get('to')||kstToday(now);
 if(!validDay(to)||(from!==null&&!validDay(from)))throw new ApiError(400,'기간은 YYYY-MM-DD 형식의 한국 시간 날짜로 입력하세요.');
 const start=from??addDays(to,1-DEFAULT_DAYS);
 if(start>to)throw new ApiError(400,'시작일은 종료일보다 늦을 수 없습니다.');
 const days=(dayMs(to)-dayMs(start))/DAY+1;
 if(days>MAX_DAYS)throw new ApiError(400,`기간은 최대 ${MAX_DAYS}일까지 조회할 수 있습니다.`);
 return {from:start,to,days,start:kstDayStart(start),end:kstDayStart(addDays(to,1))};
}
function digestWeeks(week:string){
 const range=weekRange(week);
 if(!range)throw new ApiError(400,'주간은 2026-W39처럼 ISO 주(YYYY-Www) 형식으로 입력하세요.');
 return {range,previousRange:weekRange(previousWeek(week)!)!};
}

type Scope={owner:string;start:string;end:string;campaignId:string|null};
type Sql={sql:string;binds:unknown[]};
type Kind='decisions'|'artifacts'|'history'|'usage'|'meetings'|'gradings'|'jobs'|'units';
const field=(path:string)=>`json_extract(data,'$.${path}')`;
const pick=(paths:string[])=>paths.map(p=>`'${p}',${field(p)}`).join(',');
// 작업물 판 필드(현재 레코드·이전 판 공통). promptVersion은 F3a 실행 버전, aiSource.version은 사람 수정본의 AI 원본 판이다.
const VERSION_FIELDS=['role','status','version','origin','createdAt','skillVersion','promptVersion','meetingId'];
const VERSION_OBJECTS=`'aiSource',json(CASE WHEN ${field('aiSource')} IS NULL THEN NULL ELSE json_object('version',${field('aiSource.version')},'skillVersion',${field('aiSource.skillVersion')}) END),`
 +`'complianceHold',json(CASE WHEN ${field('complianceHold')} IS NULL THEN NULL ELSE json_object('checkedAt',${field('complianceHold.checkedAt')},'block',${field('complianceHold.block')}) END)`;
const ARTIFACT_JSON=`json_object(${pick(['id','campaignId',...VERSION_FIELDS])},'content',CASE WHEN length(${field('content')})<=2500 THEN ${field('content')} ELSE '' END,${VERSION_OBJECTS})`;
const HISTORY_JSON=`json_object(${pick(['originalId',...VERSION_FIELDS])},${VERSION_OBJECTS})`;
const MEETING_JSON=`json_object(${pick(['id','campaignId','status','createdAt'])})`;
const GRADING_JSON=`json_object(${pick(['id','artifactId','artifactVersion','role','status','gradedAt','jobId'])},'graders',json(${field('graders')}))`;
// 같은 소유자·기간(캠페인 범위면 그 캠페인)의 records 한 필드 목록. IN 하위 쿼리로 쓴다.
const inPeriod=(s:Scope,kind:string,select:string,at:string,campaign:string,extra=''):Sql=>({sql:`SELECT ${select} FROM records WHERE owner=? AND kind='${kind}' AND ${at}>=? AND ${at}<?${extra}${s.campaignId?` AND ${campaign}=?`:''}`,binds:[s.owner,s.start,s.end,...(s.campaignId?[s.campaignId]:[])]});
const decided=(s:Scope)=>inPeriod(s,'review_decision',field('targetId'),field('createdAt'),field('campaignId'),` AND ${field('targetKind')}='artifact'`);
const used=(s:Scope,select:string)=>inPeriod(s,'provider_usage',select,field('observedAt'),field('campaignId'));
const graded=(s:Scope,select:string)=>inPeriod(s,'grading',select,field('gradedAt'),'parent_id');
const created=(s:Scope)=>inPeriod(s,'artifact',field('id'),field('createdAt'),'parent_id');
const held=(s:Scope)=>inPeriod(s,'artifact',field('id'),field('complianceHold.checkedAt'),'parent_id');
const holdChecked=(s:Scope):Sql=>({sql:`${field('complianceHold.checkedAt')}>=? AND ${field('complianceHold.checkedAt')}<?`,binds:[s.start,s.end]});
// 기간 안에 만들었거나 보류 점검한 이전 판의 작업물 id.
const historyIn=(s:Scope):Sql=>({sql:`SELECT ${field('originalId')} FROM records WHERE owner=? AND kind='history' AND ((${field('createdAt')}>=? AND ${field('createdAt')}<?) OR (${holdChecked(s).sql}))${s.campaignId?' AND parent_id=?':''}`,
 binds:[s.owner,s.start,s.end,...holdChecked(s).binds,...(s.campaignId?[s.campaignId]:[])]});
// 회의 판(현재·이전 판, meetingId 있음)을 기간 안에 만들었거나 판정했으면 그 회의 사용량의 jobId(소유자+':meeting:'+회의 id, lib/meeting-execution.ts jobId). 앞부분은 값 하나로 바인드한다.
function meetingJobs(s:Scope):Sql{
 const d=decided(s);
 return {sql:`SELECT ?||${field('meetingId')} FROM records WHERE owner=? AND kind IN ('artifact','history') AND ${field('meetingId')} IS NOT NULL AND ((${field('createdAt')}>=? AND ${field('createdAt')}<?) OR COALESCE(${field('originalId')},${field('id')}) IN (${d.sql}))`,
  binds:[s.owner+':meeting:',s.owner,s.start,s.end,...d.binds]};
}
const isIn=(column:string,sub:Sql,before:unknown[]=[]):Sql=>({sql:`${column} IN (${sub.sql})`,binds:[...before,...sub.binds]});
// 기간 조건 또는 이력 조건 중 하나. 캠페인 범위는 모든 행에 건다.
function either(s:Scope,at:string,campaign:string,history:Sql[]):Sql{
 const parts=[{sql:`${at}>=? AND ${at}<?`,binds:[s.start,s.end]},...history];
 return {sql:`(${parts.map(p=>`(${p.sql})`).join(' OR ')})${s.campaignId?` AND ${campaign}=?`:''}`,binds:[...parts.flatMap(p=>p.binds),...(s.campaignId?[s.campaignId]:[])]};
}
async function readRecords<T>(s:Scope,kind:string,select:string,order:string,where:Sql){
 const rows=(await database().prepare(`SELECT ${select} AS data FROM records WHERE owner=? AND kind=? AND ${where.sql} ORDER BY ${order} LIMIT ?`).bind(s.owner,kind,...where.binds,MAX_ROWS+1).all<{data:string}>()).results;
 // 최근 행부터 읽고 오래된 순(판정은 기록 순서)으로 되돌린다.
 return {rows:rows.slice(0,MAX_ROWS).map(r=>JSON.parse(r.data) as T).reverse(),truncated:rows.length>MAX_ROWS};
}
function priorDecisions(s:Scope):Sql{
 const sub=isIn(field('targetId'),decided(s));
 return {sql:`${field('targetKind')}='artifact' AND ${field('createdAt')}<? AND ${sub.sql}`,binds:[s.start,...sub.binds]};
}
const readDecisions=(s:Scope)=>readRecords<ReviewDecision>(s,'review_decision','data','rowid DESC',either(s,field('createdAt'),field('campaignId'),[priorDecisions(s)]));
const readArtifacts=(s:Scope)=>readRecords<ConsoleArtifact>(s,'artifact',ARTIFACT_JSON,`${field('createdAt')} DESC`,either(s,field('createdAt'),'parent_id',[
 holdChecked(s),isIn(field('id'),decided(s)),isIn(field('id'),used(s,field('artifactId'))),isIn(field('id'),graded(s,field('artifactId')))]));
// 이전 판(kind 'history', 본문 없이): 기간 안에 만들었거나 보류 점검한 판(새 판을 저장해도 그 주 수치가 남는다), 기간 안에 판정·채점했거나 만든 작업물의 이전 판(판정한 판·사람 수정본의 AI 원본 판).
const readHistory=(s:Scope)=>{
 const w=either(s,field('createdAt'),'parent_id',[holdChecked(s),isIn(field('originalId'),decided(s)),isIn(field('originalId'),graded(s,field('artifactId'))),isIn(field('originalId'),created(s))]);
 return readRecords<ConsoleHistory>(s,'history',HISTORY_JSON,`${field('createdAt')} DESC`,{sql:`${field('originalId')} IS NOT NULL AND ${w.sql}`,binds:w.binds});
};
// 사용량: 기간 안 사용량과, 기간 안 사건이 가리키는 작업물·회의의 기간 밖 사용량(보고 모델·스킬·프롬프트 버전을 찾는다).
const readUsage=(s:Scope)=>readRecords<ConsoleUsage>(s,'provider_usage','data',`${field('observedAt')} DESC`,either(s,field('observedAt'),field('campaignId'),[
 isIn(field('artifactId'),decided(s)),isIn(field('artifactId'),created(s)),isIn(field('artifactId'),graded(s,field('artifactId'))),isIn(field('artifactId'),held(s)),isIn(field('artifactId'),historyIn(s)),isIn(field('jobId'),meetingJobs(s))]));
// 회의 사용량의 jobId는 소유자+':meeting:'+회의 id(lib/meeting-execution.ts jobId, 레코드 id가 아니다)다. 앞부분을 값 하나로 바인드한다.
const readMeetings=(s:Scope)=>readRecords<ConsoleMeeting>(s,'team_meeting',MEETING_JSON,`${field('createdAt')} DESC`,either(s,field('createdAt'),'parent_id',[isIn(`(?||${field('id')})`,used(s,field('jobId')),[s.owner+':meeting:'])]));
const readGradings=(s:Scope)=>readRecords<ConsoleGrading>(s,'grading',GRADING_JSON,`${field('gradedAt')} DESC`,either(s,field('gradedAt'),'parent_id',[]));
async function readJobs(s:Scope){
 const where=either(s,'created_at','campaign_id',[isIn('provider_id',used(s,field('providerRunId'))),isIn('id',used(s,field('jobId'))),isIn('id',graded(s,field('jobId')))]);
 const rows=(await database().prepare(`SELECT id,role,provider_id FROM jobs WHERE owner=? AND ${where.sql} ORDER BY created_at DESC LIMIT ?`).bind(s.owner,...where.binds,MAX_ROWS+1).all<ConsoleJob>()).results;
 return {rows:rows.slice(0,MAX_ROWS).reverse(),truncated:rows.length>MAX_ROWS};
}
// 캠페인 범위를 주면 그 소유자의 캠페인이어야 한다(다른 워크스페이스·없는 캠페인은 404).
async function campaignScope(owner:string,params:URLSearchParams){
 const id=params.get('campaignId');
 if(!id)return null;
 if(id.length>100||!/^[A-Za-z0-9_-]+$/.test(id))throw new ApiError(400,'캠페인 입력을 확인해 주세요.');
 await readRecord(owner,'campaign',id);
 return id;
}
export type ConsoleRead={input:ConsoleInput&{history:ConsoleHistory[];jobs:ConsoleJob[]};truncated:Kind[]};
export async function readConsoleRecords(owner:string,period:{start:string;end:string},campaignId:string|null):Promise<ConsoleRead>{
 const s={owner,start:period.start,end:period.end,campaignId};
 const [decisions,artifacts,history,usage,meetings,gradings,jobs]=await Promise.all([readDecisions(s),readArtifacts(s),readHistory(s),readUsage(s),readMeetings(s),readGradings(s),readJobs(s)]);
 const read={decisions,artifacts,history,usage,meetings,gradings,jobs};
 return {input:{decisions:decisions.rows,artifacts:artifacts.rows,history:history.rows,usage:usage.rows,meetings:meetings.rows,gradings:gradings.rows,jobs:jobs.rows},truncated:(Object.keys(read) as (keyof typeof read)[]).filter(kind=>read[kind].truncated)};
}
const partialOf=(truncated:Kind[])=>truncated.length?{kinds:truncated,limit:MAX_ROWS}:null;
// 집계에 넘긴 기록 수(종류별, 함께 읽은 이력 포함)와 기간 안 κ 라벨 수. 화면이 '읽은 기록'으로 보여 준다.
const readCounts=(input:ConsoleRead['input'],units:readonly CriterionUnit[])=>({decisions:input.decisions.length,artifacts:input.artifacts.length,history:input.history.length,usage:input.usage.length,meetings:input.meetings.length,gradings:input.gradings.length,jobs:input.jobs.length,units:units.length});
// 주간 누적 κ 라벨: 주 끝 전의 기준별 판정(criteria가 있는 작업물 판정)을 최근 MAX_ROWS건까지만 기록 순서로 읽는다. 넘으면 partial에 'units'를 남긴다.
async function cumulativeUnits(owner:string,campaignId:string|null,end:string){
 const rows=(await database().prepare(`SELECT data FROM records WHERE owner=? AND kind='review_decision' AND ${field('targetKind')}='artifact' AND json_type(data,'$.criteria')='array' AND ${field('createdAt')}<?${campaignId?` AND ${field('campaignId')}=?`:''} ORDER BY rowid DESC LIMIT ?`)
  .bind(owner,end,...(campaignId?[campaignId]:[]),MAX_ROWS+1).all<{data:string}>()).results;
 return {units:unitsFromDecisions(rows.slice(0,MAX_ROWS).map(r=>JSON.parse(r.data) as ReviewDecision).reverse()),truncated:rows.length>MAX_ROWS};
}
export const CONSOLE_NOTICE='사람 판정·사용량·채점 기록을 LLM 없이 센 집계입니다. 자동 판정이 아니며 작업물을 합격·불합격 처리하지 않습니다. 비율은 표본 5건 미만이면 표본 부족, κ는 기준별 라벨 20건 미만이면 보정 불가로 표시합니다.';
export async function consoleView(owner:string,params:URLSearchParams,now=Date.now()){
 const period=consolePeriod(params,now),campaignId=await campaignScope(owner,params),read=await readConsoleRecords(owner,period,campaignId);
 // κ 단위는 상한 안에서 이미 읽은 판정으로 만들고 기간 안 라벨만 쓴다(판정이 잘렸으면 partial 'decisions'가 알린다).
 const units=unitsFromDecisions(read.input.decisions).filter(u=>u.createdAt>=period.start&&u.createdAt<period.end);
 return {period:{from:period.from,to:period.to,days:period.days,timezone:'Asia/Seoul'},campaignId,summary:consoleSummary(read.input,{from:period.from,to:period.to}),kappa:criterionKappa(units),
  partial:partialOf(read.truncated),read:readCounts(read.input,units),digestWeek:lastFullWeek(now),notice:CONSOLE_NOTICE};
}
// 주간 묶음 {week,summary,previous,kappa,campaignId,partial,notice}: lib/quality-digest.ts weeklyPayload(그 주·전주 요약과 주 끝까지 누적한 κ 라벨).
// 로컬 스크립트(scripts/quality-digest.mjs)가 이 JSON을 그대로 읽어 같은 마크다운을 낸다. 기본 주는 지난주(KST)다.
export async function consoleWeek(owner:string,params:URLSearchParams,now=Date.now()){
 const week=params.get('week')||lastFullWeek(now),{range,previousRange}=digestWeeks(week),campaignId=await campaignScope(owner,params);
 const [read,labels]=await Promise.all([readConsoleRecords(owner,{start:previousRange.from,end:range.to},campaignId),cumulativeUnits(owner,campaignId,range.to)]);
 return {...weeklyPayload(read.input,week,labels.units),campaignId,partial:partialOf([...read.truncated,...(labels.truncated?['units' as const]:[])]),notice:CONSOLE_NOTICE};
}
export async function consoleDigest(owner:string,params:URLSearchParams,now=Date.now()){
 const payload=await consoleWeek(owner,params,now),name=digestFileName(payload.week);
 return {markdown:digestMarkdown(payload),filename:payload.campaignId?name.replace(/\.md$/,`-${payload.campaignId}.md`):name};
}
