// B2 2단계 워커 tick 'digest' 큐(주 1회 품질 집계 레코드와 드리프트 경보). 워커 tick(lib/research-worker.ts)이 차례마다 부르고, 스위치 b2_digest_queue가 꺼져 있으면 스위치 1행만 읽고 끝난다.
// 켜져 있으면 지난 ISO 주(KST)의 quality_digest가 없을 때만 1회 만든다: 1단계 주간 묶음(lib/quality-console-server.ts consoleWeek, 같은 정의·표본 규칙)과
// 드리프트 판정(lib/quality-drift.ts)에 기존 경보(model_change·gateway_change)·역할 실행 사용량·active 평가 run·토큰 예산·비식별 신호 만료일을 넘긴다.
// LLM·HERMES·외부 호출 0회. 쓰기는 quality_digest 1행과 새 quality_drift_alarm 행(INSERT OR IGNORE)뿐이고 캠페인·작업물·프롬프트·경보 확인 상태는 바꾸지 않는다.
// 멱등: 행 id가 주(YYYY-Www)라 같은 주에 두 번째 tick은 읽기 1회로 끝난다. 실패하면 status failed와 retryAt(1시간 뒤)을 남기고 그 뒤 차례에 다시 만든다.
// 처리 시간: 시작부터 기록 직전까지 durationMs를 남긴다. 워커 HTTP 타임아웃은 60초이고, DIGEST_TIME_BUDGET_MS를 넘으면 withinBudget false로 표시한다.
import {database,stamp} from './server';
import {isEnabled} from './feature-flags';
import {consoleWeek,lastFullWeek} from './quality-console-server';
import {weekRange} from './quality-console';
import {tokenBudgetSummary,kstMonth} from './token-budget';
import {DRIFT_VERSION,budgetCheck,driftAlarms,goldenCheck,invalidRateChecks,retentionSuggestion,usageTable,INVALID_BASELINE_N,type DriftAlarm,type GoldenRun,type RoleRun,type UsageTableRow} from './quality-drift';
import type {ModelChange} from './usage-model-alarm';
import type {GatewayChange} from './gateway-snapshot';

export const DIGEST_TIME_BUDGET_MS=30000,DIGEST_RETRY_MS=3600000,GOLDEN_RUNS=10,MAX_RUNS=5000,MAX_CHANGES=100;
export const DIGEST_NOTICE='기록된 사람 판정·사용량·채점·평가 결과를 LLM 없이 센 주간 집계입니다. 자동 판정이 아니며 캠페인·작업물 상태를 바꾸지 않습니다. 차이는 나란히 센 숫자일 뿐 그 이유를 말하지 않습니다. 비율은 표본 5건 미만이면 표본 부족, 잴 기록이 없으면 미측정입니다.';
type Range={from:string;to:string};
type KappaLine={criterion:string;label:string;n:number;status:string;kappa:number|null;needed:number};
export type QualityDigest={id:string;week:string;status:'completed'|'failed';version:string;generatedAt:string;durationMs:number;withinBudget:boolean;range:Range;
 table:UsageTableRow[];totals:{artifacts:number;n:number;approvedFirst:number;firstPassRate:number|null;revisions:number;discardedTokens:number;unlinkedTokens:number;unknownTokenRuns:number};
 meetings:{started:number;completed:number;rate:number|null};kappa:KappaLine[];partial:unknown;drift:Record<string,unknown>;alarms:{id:string;type:string;detail:string}[];retention:ReturnType<typeof retentionSuggestion>;notice:string;
 attempts?:number;retryAt?:string;error?:string};
const field=(p:string)=>`json_extract(data,'$.${p}')`;
const digestId=(owner:string,week:string)=>`${owner}:quality_digest:${week}`;

async function savedDigest(owner:string,week:string){
 const row=await database().prepare("SELECT data FROM records WHERE id=? AND owner=? AND kind='quality_digest'").bind(digestId(owner,week),owner).first<{data:string}>();
 return row?JSON.parse(row.data) as Pick<QualityDigest,'status'|'retryAt'|'attempts'>:null;
}
// 기존 경보는 다시 판정하지 않고 그 주에 관측된 행을 읽기만 한다(lib/usage-model-alarm.ts·lib/gateway-snapshot.ts).
async function changesIn<T>(owner:string,kind:'model_change'|'gateway_change',at:string,r:Range){
 const rows=await database().prepare(`SELECT data FROM records WHERE owner=? AND kind=? AND ${field(at)}>=? AND ${field(at)}<? ORDER BY ${field(at)},rowid LIMIT ?`).bind(owner,kind,r.from,r.to,MAX_CHANGES).all<{data:string}>();
 return rows.results.map(x=>JSON.parse(x.data) as T);
}
// 역할 실행 사용량: 이번 주 행과, 역할마다 주 시작 전 최근 INVALID_BASELINE_N행(창 함수). 필요한 세 필드만 읽는다.
const ROLE_RUN=`json_extract(data,'$.role') AS role,json_extract(data,'$.domainOutcome') AS outcome,json_extract(data,'$.observedAt') AS at`;
const ROLE_WHERE=`owner=? AND kind='provider_usage' AND json_extract(data,'$.kind')='role' AND json_extract(data,'$.role') IS NOT NULL`;
async function roleRuns(owner:string,r:Range):Promise<RoleRun[]>{
 const db=database();
 const [current,baseline]=await Promise.all([
  db.prepare(`SELECT ${ROLE_RUN} FROM records WHERE ${ROLE_WHERE} AND json_extract(data,'$.observedAt')>=? AND json_extract(data,'$.observedAt')<? ORDER BY json_extract(data,'$.observedAt') DESC LIMIT ?`).bind(owner,r.from,r.to,MAX_RUNS).all<RoleRun>(),
  db.prepare(`SELECT role,outcome,at FROM (SELECT ${ROLE_RUN},ROW_NUMBER() OVER (PARTITION BY json_extract(data,'$.role') ORDER BY json_extract(data,'$.observedAt') DESC,rowid DESC) AS rn FROM records WHERE ${ROLE_WHERE} AND json_extract(data,'$.observedAt')<?) WHERE rn<=?`).bind(owner,r.from,INVALID_BASELINE_N).all<RoleRun>(),
 ]);
 return [...current.results,...baseline.results];
}
// active 평가 run(쌍·심사·삭제 제외)의 케이스별 상태와 채점 요약 건수만 읽는다(출력·채점 상세는 읽지 않는다).
async function goldenRuns(owner:string,end:string):Promise<GoldenRun[]>{
 const cases=`(SELECT json_group_array(json_object('caseId',json_extract(r.value,'$.caseId'),'status',json_extract(r.value,'$.status'),'fail',json_extract(r.value,'$.summary.fail'),'graderError',json_extract(r.value,'$.summary.grader_error'))) FROM json_each(records.data,'$.results') r)`;
 const rows=await database().prepare(`SELECT ${field('id')} AS id,${field('updatedAt')} AS finishedAt,${cases} AS cases FROM records WHERE owner=? AND kind='eval_run' AND ${field('variant')}='active' AND ${field('status')}='completed' AND ${field('deleted')} IS NULL AND ${field('updatedAt')}<? ORDER BY ${field('updatedAt')} DESC LIMIT ?`)
  .bind(owner,end,GOLDEN_RUNS).all<{id:string;finishedAt:string;cases:string}>();
 return rows.results.map(x=>({id:x.id,finishedAt:x.finishedAt,cases:JSON.parse(x.cases||'[]')}));
}
async function signalExpiries(owner:string){
 const rows=await database().prepare(`SELECT ${field('expiresAt')} AS at FROM records WHERE owner=? AND kind='deidentified_signal'`).bind(owner).all<{at:string|null}>();
 return rows.results.flatMap(x=>x.at?[x.at]:[]);
}
async function budgetChecks(owner:string,now:number){
 const s=await tokenBudgetSummary(database(),owner,new Date(now));
 return [{scope:'workspace' as const,campaignId:null,limit:s.workspace.limit,used:s.workspace.used},...s.campaigns.map(c=>({scope:'campaign' as const,campaignId:c.campaignId,limit:c.limit,used:c.used}))].map(budgetCheck);
}

async function driftOf(owner:string,week:string,range:Range,now:number){
 const [modelChanges,gatewayChanges,runs,golden,budgets]=await Promise.all([changesIn<ModelChange>(owner,'model_change','observedAt',range),changesIn<GatewayChange>(owner,'gateway_change','detectedAt',range),roleRuns(owner,range),goldenRuns(owner,range.to),budgetChecks(owner,now)]);
 const invalidRates=invalidRateChecks(runs,range),goldenResult=goldenCheck(golden,range),month=kstMonth(new Date(now)).month;
 const alarms=driftAlarms({week,month,modelChanges,gatewayChanges,invalidRates,golden:goldenResult,budgets});
 return {alarms,drift:{version:DRIFT_VERSION,month,modelChanges:modelChanges.length,gatewayChanges:gatewayChanges.length,invalidRates,golden:goldenResult,budgets}};
}
const kappaLines=(rows:readonly KappaLine[]):KappaLine[]=>rows.map(({criterion,label,n,status,kappa,needed})=>({criterion,label,n,status,kappa,needed}));
// 1단계 주간 묶음 조회(consoleWeek)는 요청 쿼리를 받는다. 워커에는 요청이 없어 같은 모양의 쿼리를 만든다(캠페인 범위 없음).
const weekParams=(week:string)=>new URL('?week='+encodeURIComponent(week),'https://digest.invalid').searchParams;
async function buildDigest(owner:string,week:string,now:number,started:number){
 const range=weekRange(week)!,[payload,drift,expiries]=await Promise.all([consoleWeek(owner,weekParams(week),now),driftOf(owner,week,range,now),signalExpiries(owner)]);
 const t=payload.summary.totals,m=payload.summary.meetings,durationMs=Date.now()-started;
 const digest:QualityDigest={id:week,week,status:'completed',version:DRIFT_VERSION,generatedAt:stamp(),durationMs,withinBudget:durationMs<=DIGEST_TIME_BUDGET_MS,range,table:usageTable(payload.summary.rows),
  totals:{artifacts:t.artifacts,n:t.n,approvedFirst:t.approvedFirst,firstPassRate:t.firstPassRate,revisions:t.revisions,discardedTokens:t.discardedTokens,unlinkedTokens:t.unlinkedTokens,unknownTokenRuns:t.unknownTokenRuns},
  meetings:{started:m.started,completed:m.completed,rate:m.rate},kappa:kappaLines(payload.kappa),partial:payload.partial,drift:drift.drift,alarms:drift.alarms.map(({id,type,detail})=>({id,type,detail})),
  retention:retentionSuggestion(expiries,now),notice:DIGEST_NOTICE};
 return {digest,alarms:drift.alarms};
}
// 완료 행은 덮지 않는다(동시 tick·재실행에도 1행). 실패 행만 완료로 바꾼다. 경보는 같은 id가 있으면 무시한다.
const UPSERT="INSERT INTO records(id,owner,kind,parent_id,data,updated_at) VALUES(?,?,'quality_digest','',?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data,updated_at=excluded.updated_at WHERE records.owner=excluded.owner AND json_extract(records.data,'$.status')!='completed'";
const ALARM="INSERT OR IGNORE INTO records(id,owner,kind,parent_id,data,updated_at) VALUES(?,?,'quality_drift_alarm','',?,?)";
async function saveDigest(owner:string,digest:QualityDigest,alarms:readonly DriftAlarm[]){
 const db=database(),at=digest.generatedAt;
 await db.batch([db.prepare(UPSERT).bind(digestId(owner,digest.week),owner,JSON.stringify(digest),at),...alarms.map(a=>db.prepare(ALARM).bind(`${owner}:quality_drift_alarm:${a.id}`,owner,JSON.stringify({...a,createdAt:at}),at))]);
}
async function saveFailure(owner:string,week:string,attempts:number,started:number){
 const at=stamp(),failed={id:week,week,status:'failed',version:DRIFT_VERSION,generatedAt:at,durationMs:Date.now()-started,attempts,retryAt:new Date(Date.now()+DIGEST_RETRY_MS).toISOString(),error:'주간 품질 집계를 만들지 못했습니다.'};
 await database().prepare(UPSERT).bind(digestId(owner,week),owner,JSON.stringify(failed),at).run();
}
// 워커 tick용. 반환 status는 tick 규약('idle'·'processed'·'retry')을 따른다. 어떤 예외도 tick의 다른 큐를 막지 않는다.
export async function runDigestQueue(owner:string,now=Date.now()):Promise<{status:'idle'|'processed'|'retry';week?:string;durationMs?:number}>{
 if(!(await isEnabled(owner,'b2_digest_queue').catch(()=>false)))return {status:'idle'};
 const week=lastFullWeek(now),saved=await savedDigest(owner,week);
 if(saved?.status==='completed'||saved?.retryAt&&Date.parse(saved.retryAt)>Date.now())return {status:'idle'};
 const started=Date.now();
 try{
  const {digest,alarms}=await buildDigest(owner,week,now,started);
  await saveDigest(owner,digest,alarms);
  return {status:'processed',week,durationMs:digest.durationMs};
 }catch{
  console.error('quality_digest_failed');
  await saveFailure(owner,week,(saved?.attempts??0)+1,started).catch(()=>console.error('quality_digest_failure_write_failed'));
  return {status:'retry',week};
 }
}
// 사용량 화면(GET /api/usage qualityTable): 마지막 완료 주간 집계의 역할×프롬프트 버전×보고 모델 표와 그 주 경보. 행 1개만 읽는다.
export async function latestQualityTable(owner:string){
 const row=await database().prepare(`SELECT data FROM records WHERE owner=? AND kind='quality_digest' AND ${field('status')}='completed' ORDER BY ${field('week')} DESC LIMIT 1`).bind(owner).first<{data:string}>();
 if(!row)return null;
 const d=JSON.parse(row.data) as QualityDigest;
 return {week:d.week,range:d.range,generatedAt:d.generatedAt,durationMs:d.durationMs,rows:d.table,totals:d.totals,alarms:d.alarms,retention:d.retention,notice:d.notice};
}
