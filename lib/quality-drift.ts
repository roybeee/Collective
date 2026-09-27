// B2 2단계 주간 드리프트 판정(순수 함수, LLM·네트워크·DB 없음). 서버(lib/quality-digest-queue-server.ts)가 워커 tick 'digest' 차례에 읽은 기록을 넘기고,
// 이 모듈이 경보 후보·보존 정리 제안·사용량 화면 표를 만든다. 경보는 사람이 확인할 기록일 뿐이며 캠페인·작업물·프롬프트 상태를 바꾸지 않는다.
// 경보 id는 같은 변경이면 같은 값이 되게 정한다(모델·게이트웨이는 원 경보 id, 무효율은 역할·주, 골든은 run, 예산은 달·범위·문턱). 저장은 INSERT OR IGNORE다.
// 모르는 값은 0으로 채우지 않는다: 잴 기록이 없으면 unmeasured('미측정'), 표본이 모자라면 insufficient('표본 부족')다. 정의는 docs/QUALITY-CONSOLE.ko.md '2단계'.
import {MIN_SAMPLE,type ConsoleRow} from './quality-console';
import type {ModelChange} from './usage-model-alarm';
import type {GatewayChange} from './gateway-snapshot';

export const DRIFT_VERSION='quality-drift-v1';
// 역할 무효율: 이번 주 역할 실행과 그 역할의 직전 INVALID_BASELINE_N건을 비교한다. 이번 주 비율이 직전 비율(0이면 1/INVALID_BASELINE_N로 본다)의 INVALID_RATIO배 이상이면 경보다.
export const INVALID_BASELINE_N=20,INVALID_RATIO=2;
// 토큰 예산 소진율 문턱(이번 달 사용/상한). 넘은 문턱 중 가장 높은 것 하나만 경보하고, 같은 달·범위·문턱은 다시 경보하지 않는다.
export const BUDGET_THRESHOLDS=[0.8,1] as const;
// 보존 정리 제안: 비식별 평가 신호가 이 기간 안에 만료되면 알린다.
export const RETENTION_NOTICE_DAYS=14;
const DAY_MS=864e5;

export type DriftStatus='alarm'|'ok'|'insufficient'|'unmeasured';
export type DriftType='model_change'|'gateway_change'|'invalid_rate'|'golden_drop'|'token_budget';
export type DriftAlarm={id:string;type:DriftType;week:string;detail:string;sources:string[]};

// ── 역할 무효율 ──
// 출력이 돌아온 실행(completed·thin_output·invalid_output)만 분모다. 공급자 실패·취소·저장 실패는 출력 형식과 무관해 뺀다.
const OUTPUT_OUTCOMES=['completed','thin_output','invalid_output'];
export type RoleRun={role:string;outcome:string|null;at:string};
export type RateCount={n:number;invalid:number;rate:number|null};
export type InvalidRateCheck={role:string;current:RateCount;baseline:RateCount;status:DriftStatus};
function countOf(runs:readonly RoleRun[]):RateCount{
 const out=runs.filter(r=>OUTPUT_OUTCOMES.includes(r.outcome??'')),invalid=out.filter(r=>r.outcome==='invalid_output').length;
 return {n:out.length,invalid,rate:out.length?invalid/out.length:null};
}
export function invalidRateCheck(role:string,current:readonly RoleRun[],baseline:readonly RoleRun[]):InvalidRateCheck{
 const now=countOf(current),before=countOf(baseline.slice(0,INVALID_BASELINE_N));
 if(!now.n)return {role,current:now,baseline:before,status:'unmeasured'};
 if(now.n<MIN_SAMPLE||before.n<INVALID_BASELINE_N)return {role,current:now,baseline:before,status:'insufficient'};
 const floor=Math.max(before.rate!,1/INVALID_BASELINE_N);
 return {role,current:now,baseline:before,status:now.invalid>0&&now.rate!>=INVALID_RATIO*floor?'alarm':'ok'};
}
// 역할마다 이번 주 실행(기간 안)과 직전 실행(기간 전, 최근 순)을 나눈다. 입력 순서와 무관하게 시각으로 가른다.
export function invalidRateChecks(runs:readonly RoleRun[],range:{from:string;to:string}):InvalidRateCheck[]{
 const roles=[...new Set(runs.map(r=>r.role))].sort();
 return roles.map(role=>{
  const mine=runs.filter(r=>r.role===role);
  const current=mine.filter(r=>r.at>=range.from&&r.at<range.to),baseline=mine.filter(r=>r.at<range.from).sort((a,b)=>b.at.localeCompare(a.at));
  return invalidRateCheck(role,current,baseline);
 });
}
const pct=(r:number|null)=>r===null?'미측정':(Math.round(r*1000)/10).toFixed(1)+'%';
const invalidAlarm=(c:InvalidRateCheck,week:string):DriftAlarm=>({id:`invalid_rate:${c.role}:${week}`,type:'invalid_rate',week,sources:[],
 detail:`${c.role}: 이번 주 형식 오류 ${c.current.invalid}/${c.current.n}(${pct(c.current.rate)}) · 직전 ${c.baseline.n}건 ${c.baseline.invalid}건(${pct(c.baseline.rate)})`});

// ── 기존 경보 재사용: 보고 모델 변경(model_change)·게이트웨이 변경(gateway_change) ──
// 이번 주에 관측된 원 경보를 전환(전→후)마다 한 건으로 묶는다. 같은 전환이 주 안에 반복돼도 1건이고, id는 그 전환의 첫 원 경보 id라 다시 돌려도 같다.
const modelKey=(m:{reported:string;actual:string|null})=>m.actual??'alias:'+m.reported.toLowerCase();
function grouped<T>(items:readonly T[],key:(x:T)=>string){
 return [...items.reduce((m,x)=>{const k=key(x),list=m.get(k);if(list)list.push(x);else m.set(k,[x]);return m},new Map<string,T[]>()).values()];
}
export function modelChangeAlarms(changes:readonly ModelChange[],week:string):DriftAlarm[]{
 const sorted=[...changes].sort((a,b)=>a.observedAt.localeCompare(b.observedAt)||a.id.localeCompare(b.id));
 return grouped(sorted,c=>`${c.provider}|${modelKey(c.from)}|${modelKey(c.to)}`).map(list=>({id:`model_change:${list[0].id}`,type:'model_change' as const,week,sources:list.map(c=>c.id),
  detail:`${list[0].provider}: ${list[0].from.reported} → ${list[0].to.reported}${list.length>1?` (같은 전환 ${list.length}회)`:''}`}));
}
export function gatewayChangeAlarms(changes:readonly GatewayChange[],week:string):DriftAlarm[]{
 const sorted=[...changes].sort((a,b)=>a.detectedAt.localeCompare(b.detectedAt)||a.id.localeCompare(b.id));
 return grouped(sorted,c=>`${c.fromHash}|${c.toHash}`).map(list=>({id:`gateway_change:${list[0].id}`,type:'gateway_change' as const,week,sources:list.map(c=>c.id),
  detail:`${list[0].fromHash.slice(0,12)} → ${list[0].toHash.slice(0,12)} (${[...new Set(list.flatMap(c=>c.sections.map(s=>s.section)))].join(', ')||'섹션 미상'})`}));
}

// ── 골든 스모크 하락 ──
// active 평가 run(쌍·심사 run 제외)의 케이스 결과. 통과 = 완료이고 fail·grader_error 0, 실패 = 완료인데 fail이 있거나 실행 실패(failed). 그 밖(막힘·미실행·취소·채점 오류)은 판정하지 않는다.
export type GoldenCase={caseId:string;status:string;fail:number|null;graderError:number|null};
export type GoldenRun={id:string;finishedAt:string;cases:GoldenCase[]};
export type GoldenCheck={status:DriftStatus;runId:string|null;previousRunId:string|null;compared:number;passed:number;previousPassed:number;regressed:string[]};
function verdict(c:GoldenCase):'pass'|'fail'|null{
 if(c.status==='failed')return 'fail';
 if(c.status!=='completed'||c.fail===null||(c.graderError??0)>0)return null;
 return c.fail>0?'fail':'pass';
}
// 이번 주에 끝난 마지막 run과 그 앞 run을 같은 케이스끼리 비교한다. 직전에 통과한 케이스가 이번에 실패하면 경보다(비율이 아니라 케이스 단위라 표본 규칙을 쓰지 않는다).
export function goldenCheck(runs:readonly GoldenRun[],range:{from:string;to:string}):GoldenCheck{
 const sorted=[...runs].sort((a,b)=>a.finishedAt.localeCompare(b.finishedAt)||a.id.localeCompare(b.id));
 const at=sorted.findLastIndex(r=>r.finishedAt>=range.from&&r.finishedAt<range.to),run=at>=0?sorted[at]:null,prev=at>0?sorted[at-1]:null;
 const empty={runId:run?.id??null,previousRunId:prev?.id??null,compared:0,passed:0,previousPassed:0,regressed:[]};
 if(!run)return {status:'unmeasured',...empty};
 if(!prev)return {status:'insufficient',...empty};
 const before=new Map(prev.cases.map(c=>[c.caseId,verdict(c)])),pairs=run.cases.map(c=>[c.caseId,before.get(c.caseId)??null,verdict(c)] as const).filter(([,a,b])=>a&&b);
 const regressed=pairs.filter(([,a,b])=>a==='pass'&&b==='fail').map(([id])=>id).sort();
 return {status:!pairs.length?'insufficient':regressed.length?'alarm':'ok',runId:run.id,previousRunId:prev.id,compared:pairs.length,passed:pairs.filter(p=>p[2]==='pass').length,previousPassed:pairs.filter(p=>p[1]==='pass').length,regressed};
}
const goldenAlarm=(g:GoldenCheck,week:string):DriftAlarm=>({id:`golden_drop:${g.runId}`,type:'golden_drop',week,sources:[g.runId!,g.previousRunId!],
 detail:`비교 ${g.compared}케이스 통과 ${g.previousPassed} → ${g.passed} · 직전 통과 뒤 실패 ${g.regressed.length}건`});

// ── 토큰 예산 소진율 ──
export type BudgetInput={scope:'workspace'|'campaign';campaignId:string|null;limit:number|null;used:number};
export type BudgetCheck=BudgetInput&{rate:number|null;threshold:number|null;status:DriftStatus};
export function budgetCheck(line:BudgetInput):BudgetCheck{
 if(line.limit===null||line.limit<=0)return {...line,rate:null,threshold:null,status:'unmeasured'};
 const rate=line.used/line.limit,threshold=[...BUDGET_THRESHOLDS].reverse().find(t=>rate>=t)??null;
 return {...line,rate,threshold,status:threshold===null?'ok':'alarm'};
}
const budgetAlarm=(b:BudgetCheck,month:string,week:string):DriftAlarm=>({id:`token_budget:${month}:${b.campaignId?'campaign:'+b.campaignId:'workspace'}:${Math.round(b.threshold!*100)}`,type:'token_budget',week,sources:[],
 detail:`${month} ${b.campaignId?'캠페인 '+b.campaignId:'워크스페이스'} 사용 ${b.used.toLocaleString('ko-KR')}/${b.limit!.toLocaleString('ko-KR')}토큰(${pct(b.rate)}) · 문턱 ${Math.round(b.threshold!*100)}%`});

// ── 모든 경보 후보 ──
export type DriftInput={week:string;month:string;modelChanges:readonly ModelChange[];gatewayChanges:readonly GatewayChange[];invalidRates:readonly InvalidRateCheck[];golden:GoldenCheck;budgets:readonly BudgetCheck[]};
export function driftAlarms(d:DriftInput):DriftAlarm[]{
 return [...modelChangeAlarms(d.modelChanges,d.week),...gatewayChangeAlarms(d.gatewayChanges,d.week),...d.invalidRates.filter(c=>c.status==='alarm').map(c=>invalidAlarm(c,d.week)),
  ...(d.golden.status==='alarm'?[goldenAlarm(d.golden,d.week)]:[]),...d.budgets.filter(b=>b.status==='alarm').map(b=>budgetAlarm(b,d.month,d.week))];
}

// ── F4b 보존 정리 제안 ──
// 비식별 평가 신호(90일 보관)의 건수만 센다. 지울지는 사람이 정하고, 제안은 기록을 바꾸지 않는다(정리는 워커의 하루 1회 purgeExpiredSignals가 한다).
export type RetentionSuggestion={signals:number;expiringSoon:number;expiredNotPurged:number;nextExpiry:string|null;suggestions:string[]};
export function retentionSuggestion(expiries:readonly string[],now:number):RetentionSuggestion{
 const valid=expiries.filter(e=>Number.isFinite(Date.parse(e))),expired=valid.filter(e=>Date.parse(e)<=now).length;
 const live=valid.filter(e=>Date.parse(e)>now).sort(),soon=live.filter(e=>Date.parse(e)-now<=RETENTION_NOTICE_DAYS*DAY_MS).length;
 const suggestions=[
  ...(expired?[`만료가 지났는데 남은 비식별 평가 신호 ${expired}건이 있습니다. 워커의 하루 1회 정리가 실패했는지 확인하세요.`]:[]),
  ...(soon?[`${RETENTION_NOTICE_DAYS}일 안에 만료되는 비식별 평가 신호 ${soon}건이 있습니다. 보정·비교에 더 필요하면 만료 전에 집계를 확인하세요.`]:[]),
 ];
 return {signals:valid.length,expiringSoon:soon,expiredNotPurged:expired,nextExpiry:live[0]??null,suggestions};
}

// ── 사용량 화면 표: 역할 × 프롬프트 버전 × 보고 모델 ──
// 품질 콘솔 행(역할×스킬 버전×프롬프트 버전×보고 모델)을 스킬 버전만 합쳐 다시 센다. 정의는 콘솔과 같고(data-truth-9 대응은 docs/QUALITY-CONSOLE.ko.md), 비율은 합친 뒤 다시 낸다.
// 1차 승인 표본이 0이면 미측정(firstPass null·n 0), 1~4건이면 표본 부족(rate null)이다.
export type UsageTableRow={role:string;promptVersion:string|null;reportedModel:string|null;artifacts:number;n:number;approvedFirst:number;firstPassRate:number|null;revisions:number;discardedTokens:number;unlinkedTokens:number;unknownTokenRuns:number;holds:number};
const rowKey=(r:Pick<ConsoleRow,'role'|'promptVersion'|'reportedModel'>)=>JSON.stringify([r.role,r.promptVersion,r.reportedModel]);
function addRow(a:UsageTableRow,r:ConsoleRow):UsageTableRow{
 return {...a,artifacts:a.artifacts+r.artifacts,n:a.n+r.n,approvedFirst:a.approvedFirst+r.approvedFirst,revisions:a.revisions+r.revisions,discardedTokens:a.discardedTokens+r.discardedTokens,
  unlinkedTokens:a.unlinkedTokens+r.unlinkedTokens,unknownTokenRuns:a.unknownTokenRuns+r.unknownTokenRuns,holds:a.holds+r.holds};
}
const emptyRow=(r:ConsoleRow):UsageTableRow=>({role:r.role,promptVersion:r.promptVersion,reportedModel:r.reportedModel,artifacts:0,n:0,approvedFirst:0,firstPassRate:null,revisions:0,discardedTokens:0,unlinkedTokens:0,unknownTokenRuns:0,holds:0});
export function usageTable(rows:readonly ConsoleRow[]):UsageTableRow[]{
 const merged=rows.reduce((m,r)=>m.set(rowKey(r),addRow(m.get(rowKey(r))??emptyRow(r),r)),new Map<string,UsageTableRow>());
 return [...merged.values()].map(r=>({...r,firstPassRate:r.n>=MIN_SAMPLE?r.approvedFirst/r.n:null}));
}
