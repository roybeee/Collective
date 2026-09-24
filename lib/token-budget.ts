// 토큰 예산 가드(loop-4). 소유자가 정한 월 토큰 상한(워크스페이스 1행 + 캠페인별 행)을 HERMES 제출 직전(lib/hermes.ts submitHermes)과 OpenAI 직접 요청 직전(reserveDirectCall)에 확인한다.
// 기본값은 미설정이다: 상한이 없으면 막지 않고 경고만 돌려준다. 단가를 몰라도 동작하도록 금액이 아니라 토큰으로 센다.
// 기간은 한국 시간(KST, UTC+9, 일광절약 없음) 달력 월이다. 워크스페이스와 캠페인 상한 모두 이번 달 누계를 본다.
// 누계 = provider_usage 이번 달 보고 토큰(모든 공급자, 관측 시각 기준, 캠페인은 campaignId 조인) + 진행 중 예약(token_reservation 중 토큰을 아는 종료 사용량이 아직 없는 제출의 예상 토큰).
// 한계(소프트 캡): 예약은 제출 시점의 예상일 뿐이라 이미 통과한 진행 중 실행의 실제 사용량 때문에 월 누계가 상한을 넘을 수 있다. 조사 1회 상한과 HERMES max_tokens 전달은 후속이다.
// 평가 실행(lib/eval-server.ts)은 별도 연결·별도 월 예산(결정 5, 1.5M)이고 submitHermes를 거치지 않으므로 여기서 다시 막지 않는다.
import {ApiError,str} from './server';
import type {UsageKind} from './usage-ledger';

type Db=D1Database;
type Who={id:string;email:string|null};
export type TokenBudget={scope:'workspace'|'campaign';campaignId:string|null;monthlyTokens:number;updatedAt:string;updatedBy:Who|null};
// 제출 1건의 예약. 요청 원문은 담지 않는다. keyHash: 멱등 키 sha256 앞 16자(같은 요청의 복구 재전송인지 가른다). OpenAI 직접 경로는 멱등 키가 없어 요청 본문 sha256 앞 16자이고 기록용이다(재전송 판정에 쓰지 않는다).
// estimatedTokens(누계에 세는 값) = max(estimatedInputTokens, 같은 종류(kind) 최근 실행의 평균 보고 토큰). A7 수리 요청은 estimatedInputTokens만 쓴다(estimateFor).
type Reservation={submissionId:string;campaignId:string|null;kind:UsageKind|null;estimatedInputTokens:number;estimatedTokens:number;keyHash:string;reservedAt:string;runId:string|null};
export type BudgetLine={limit:number|null;used:number;inProgress:number;remaining:number|null;unknownUsage:number};
const KST_MS=9*3600*1000,MAX_TOKENS=10_000_000_000;
export const UNSET_WARNING='월 토큰 상한이 미설정입니다. 제출을 막지 않지만 AI 사용량이 제한 없이 늘 수 있습니다. 소유자가 사용량 화면에서 상한을 정하세요.';
const comma=(n:number)=>n.toLocaleString('ko-KR');
// 예산 초과 409. 호출부가 '접수 불확실'과 구분해 확정 실패로 처리할 수 있게 따로 둔다(가드는 요청 전에 막으므로 이번 시도에서는 아무것도 보내지 않았다).
export class TokenBudgetExceeded extends ApiError{constructor(message:string){super(409,message)}}
export function kstMonth(now=new Date()){
 const k=new Date(now.getTime()+KST_MS),y=k.getUTCFullYear(),m=k.getUTCMonth();
 return {month:`${y}-${String(m+1).padStart(2,'0')}`,start:new Date(Date.UTC(y,m,1)-KST_MS).toISOString(),end:new Date(Date.UTC(y,m+1,1)-KST_MS).toISOString()};
}
type Period=ReturnType<typeof kstMonth>;
// 입력 토큰 추정(과대 쪽으로 보수적). 제출 본문(instructions·input·session_id JSON) 전체를 센다.
// 근거: 영어·JSON은 흔히 3~4자당 1토큰이라 문자 수/2는 넉넉하다. 한글은 토크나이저에 따라 1자당 1토큰 가까이 쓰일 수 있어
// UTF-8 바이트/3(한글 1자=3바이트 → 1자당 1토큰)과 비교해 큰 값을 쓴다. 예산 가드는 막는 쪽으로 틀리는 편이 안전하다.
// HERMES 에이전트 자체 지시·도구 호출·출력 토큰은 미리 알 수 없어 넣지 않는다. 종료 후 실제 사용량(provider_usage)이 이 추정을 대신한다.
export function estimateInputTokens(text:string){return Math.max(Math.ceil(text.length/2),Math.ceil(new TextEncoder().encode(text).length/3))}
async function sha16(value:string){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))).map(x=>x.toString(16).padStart(2,'0')).join('').slice(0,16)}
const reservationKey=(owner:string,submissionId:string)=>`${owner}:token_reservation:${submissionId}`;
async function readBudgets(db:Db,owner:string){
 const rows=await db.prepare("SELECT data FROM records WHERE owner=? AND kind='token_budget'").bind(owner).all<{data:string}>();
 return rows.results.map(r=>JSON.parse(r.data) as TokenBudget);
}
// 총 토큰을 모르면 입력+출력으로 센다. 둘 다 모르면 누계에서 빼고 따로 센다(0으로 바꾸지 않는다).
const tokensOf=(t:string)=>`COALESCE(json_extract(${t}.data,'$.totalTokens'),json_extract(${t}.data,'$.inputTokens')+json_extract(${t}.data,'$.outputTokens'))`;
type Part={sql:string;binds:unknown[]};
const byCampaign=(t:string,campaignId:string|null)=>campaignId?{sql:` AND json_extract(${t}.data,'$.campaignId')=?`,binds:[campaignId]}:{sql:'',binds:[]};
function usedSql(owner:string,p:Period,campaignId:string|null):Part{
 const c=byCampaign('x',campaignId);
 return {sql:`SELECT COALESCE(SUM(${tokensOf('x')}),0) FROM records x WHERE x.owner=? AND x.kind='provider_usage' AND json_extract(x.data,'$.observedAt')>=? AND json_extract(x.data,'$.observedAt')<?${c.sql}`,binds:[owner,p.start,p.end,...c.binds]};
}
// 진행 중 예약: 이번 달 예약 중 실행 번호의 종료 사용량(토큰을 아는 것)이 아직 없는 것. 접수 확인을 못 한 예약(runId 없음)과 토큰을 보고하지 않고 끝난 실행의 예약도 센다.
// 실행 번호는 HERMES 실행 번호 또는 OpenAI 응답 id(직접 경로)라 두 공급자의 사용량 행을 모두 본다.
function reservedSql(owner:string,p:Period,campaignId:string|null,excludeKey:string):Part{
 const c=byCampaign('r',campaignId);
 return {sql:`SELECT COALESCE(SUM(json_extract(r.data,'$.estimatedTokens')),0) FROM records r WHERE r.owner=? AND r.kind='token_reservation' AND r.id<>? AND json_extract(r.data,'$.reservedAt')>=? AND json_extract(r.data,'$.reservedAt')<?${c.sql} AND NOT EXISTS (SELECT 1 FROM records u WHERE u.id IN (r.owner||':provider_usage:hermes:'||json_extract(r.data,'$.runId'),r.owner||':provider_usage:openai:'||json_extract(r.data,'$.runId')) AND u.owner=r.owner AND u.kind='provider_usage' AND ${tokensOf('u')} IS NOT NULL)`,binds:[owner,excludeKey,p.start,p.end,...c.binds]};
}
async function usedTokens(db:Db,owner:string,p:Period,campaignId:string|null){
 const c=byCampaign('x',campaignId);
 const row=await db.prepare(`SELECT COALESCE(SUM(${tokensOf('x')}),0) AS used,COALESCE(SUM(${tokensOf('x')} IS NULL),0) AS unknown FROM records x WHERE x.owner=? AND x.kind='provider_usage' AND json_extract(x.data,'$.observedAt')>=? AND json_extract(x.data,'$.observedAt')<?${c.sql}`).bind(owner,p.start,p.end,...c.binds).first<{used:number;unknown:number}>();
 return {used:Number(row?.used)||0,unknown:Number(row?.unknown)||0};
}
async function reservedTokens(db:Db,owner:string,p:Period,campaignId:string|null,excludeKey:string){
 const q=reservedSql(owner,p,campaignId,excludeKey),row=await db.prepare(`SELECT (${q.sql}) AS n`).bind(...q.binds).first<{n:number}>();
 return Number(row?.n)||0;
}
async function budgetLine(db:Db,owner:string,p:Period,limit:number|null,campaignId:string|null,excludeKey=''):Promise<BudgetLine>{
 const [{used,unknown},inProgress]=await Promise.all([usedTokens(db,owner,p,campaignId),reservedTokens(db,owner,p,campaignId,excludeKey)]);
 return {limit,used,inProgress,remaining:limit===null?null:Math.max(0,limit-used-inProgress),unknownUsage:unknown};
}
const limitsOf=(budgets:TokenBudget[],campaignId:string|null)=>({workspace:budgets.find(b=>b.scope==='workspace')?.monthlyTokens??null,campaign:campaignId?budgets.find(b=>b.scope==='campaign'&&b.campaignId===campaignId)?.monthlyTokens??null:null});
// 제출 직전 가드(확인만). 상한이 하나도 없으면 통과(경고). 워크스페이스·캠페인 중 넘는 상한이 있으면 남은 예산이 가장 적은 쪽으로 409를 던진다.
export async function assertTokenBudget(db:Db,owner:string,campaignId:string|null,estimatedTokens:number,options:{now?:Date;excludeSubmissionId?:string}={}){
 const p=kstMonth(options.now),exclude=options.excludeSubmissionId?reservationKey(owner,options.excludeSubmissionId):'';
 const {workspace,campaign}=limitsOf(await readBudgets(db,owner),campaignId),warning=workspace===null?UNSET_WARNING:null;
 if(workspace===null&&campaign===null)return {status:'unset' as const,warning};
 const lines=[...(workspace!==null?[{label:'워크스페이스',...await budgetLine(db,owner,p,workspace,null,exclude)}]:[]),...(campaign!==null?[{label:'캠페인',...await budgetLine(db,owner,p,campaign,campaignId,exclude)}]:[])];
 const over=lines.filter(l=>l.used+l.inProgress+estimatedTokens>l.limit!).sort((a,b)=>a.remaining!-b.remaining!)[0];
 if(over)throw new TokenBudgetExceeded(`토큰 예산 초과: 남은 예산 ${comma(over.remaining!)}토큰 · ${over.label} ${p.month} 월 상한 ${comma(over.limit!)}토큰(한국 시간), 이번 요청 예상 ${comma(estimatedTokens)}토큰. 사용량 화면에서 상한과 진행 중 실행을 확인하세요.`);
 return {status:'within' as const,warning};
}
// 제출이 속한 캠페인. 사용량 조인 키(F2a)와 같은 규칙이다: 역할·회의는 제출 원문의 부모 캠페인, 브리프는 초안의 캠페인, 규칙 초안은 원천 실험의 캠페인, 조사·사례 학습은 없음.
async function submissionCampaign(db:Db,owner:string,submissionId:string){
 const parent=await db.prepare("SELECT s.parent_id AS id FROM records s JOIN records c ON c.id=s.owner||':campaign:'||s.parent_id AND c.owner=s.owner AND c.kind='campaign' WHERE s.id=? AND s.owner=? AND s.kind='hermes_submission'").bind(`${owner}:hermes_submission:${submissionId}`,owner).first<{id:string}>();
 if(parent?.id)return parent.id;
 if(submissionId.startsWith('brief-')){const draft=await db.prepare("SELECT json_extract(data,'$.campaignId') AS id FROM records WHERE id=? AND owner=? AND kind='brief_draft'").bind(`${owner}:brief_draft:${submissionId.slice(6)}`,owner).first<{id:string|null}>();return draft?.id??null}
 const guidance=await db.prepare("SELECT json_extract(e.data,'$.campaignId') AS id FROM jobs j JOIN records e ON e.id=j.owner||':viral_experiment:'||substr(j.campaign_id,10) AND e.owner=j.owner AND e.kind='viral_experiment' WHERE j.id=? AND j.owner=? AND j.campaign_id LIKE 'guidance:%'").bind(submissionId,owner).first<{id:string|null}>();
 return guidance?.id??null;
}
// 제출의 실행 종류(사용량 조인 키 kind와 같은 값). 브리프는 id 접두어, 역할·학습은 jobs 행의 역할, 회의는 캠페인을 부모로 둔 그 밖의 제출, 조사는 브랜드를 부모로 둔 제출이다. 모르면 null.
const LEARNING_ROLES=['viral_analysis','viral_discovery','viral_guidance'];
async function submissionKind(db:Db,owner:string,submissionId:string):Promise<UsageKind|null>{
 if(submissionId.startsWith('brief-'))return 'brief';
 const job=await db.prepare('SELECT role FROM jobs WHERE id=? AND owner=?').bind(submissionId,owner).first<{role:string}>();
 if(job)return LEARNING_ROLES.includes(job.role)?'learning':'role';
 const parent=await db.prepare("SELECT EXISTS(SELECT 1 FROM records c WHERE c.id=s.owner||':campaign:'||s.parent_id AND c.owner=s.owner AND c.kind='campaign') AS campaign,EXISTS(SELECT 1 FROM records b WHERE b.id=s.owner||':brand:'||s.parent_id AND b.owner=s.owner AND b.kind='brand') AS brand FROM records s WHERE s.id=? AND s.owner=? AND s.kind='hermes_submission'").bind(`${owner}:hermes_submission:${submissionId}`,owner).first<{campaign:number;brand:number}>();
 return parent?.campaign?'meeting':parent?.brand?'research':null;
}
// 같은 종류의 최근 종료 실행(토큰을 아는 것, 최대 RECENT_RUNS건)의 평균 보고 토큰. 제출 본문 추정은 에이전트 지시·도구 호출·출력을 빼므로 실제 사용량보다 크게 작을 수 있다(조사 1회 평균 약 339k).
// A7 수리 실행(사용량 역할 '<단계>_repair', lib/research-execution.ts)은 뺀다. 작은 수리 실행이 다음 전체 조사의 예약을 끌어내리지 않게 한다.
const RECENT_RUNS=20;
async function recentAverage(db:Db,owner:string,kind:UsageKind|null){
 if(!kind)return 0;
 const row=await db.prepare(`SELECT AVG(t) AS n FROM (SELECT ${tokensOf('x')} AS t FROM records x WHERE x.owner=? AND x.kind='provider_usage' AND json_extract(x.data,'$.kind')=? AND ${tokensOf('x')} IS NOT NULL AND COALESCE(substr(json_extract(x.data,'$.role'),-7),'')<>'_repair' ORDER BY json_extract(x.data,'$.observedAt') DESC LIMIT ${RECENT_RUNS})`).bind(owner,kind).first<{n:number|null}>();
 return Math.ceil(Number(row?.n)||0);
}
// 확인과 예약을 SQL 한 문장으로 한다(D1·SQLite는 한 문장을 원자적으로 실행). 동시 제출이 서로의 예약을 못 본 채 함께 통과하지 않는다.
// 적용되는 상한마다 '이번 달 보고 누계 + 다른 진행 중 예약 + 이번 예상 <= 상한'을 WHERE에 붙인다. 상한이 없으면 조건 없이 쓴다.
async function insertReservation(db:Db,owner:string,id:string,r:Reservation,limits:{limit:number;campaignId:string|null}[],p:Period){
 const conds=limits.map(l=>{const u=usedSql(owner,p,l.campaignId),q=reservedSql(owner,p,l.campaignId,id);return {sql:`(${u.sql})+(${q.sql})+?<=?`,binds:[...u.binds,...q.binds,r.estimatedTokens,l.limit]}});
 const result=await db.prepare(`INSERT INTO records(id,owner,kind,parent_id,data,updated_at) SELECT ?,?,'token_reservation','',?,? WHERE ${conds.map(c=>c.sql).join(' AND ')||'1'} ON CONFLICT(id) DO UPDATE SET data=excluded.data,updated_at=excluded.updated_at`).bind(id,owner,JSON.stringify(r),r.reservedAt,...conds.flatMap(c=>c.binds)).run();
 return result.meta.changes>0;
}
// 예상 토큰. A7 수리 요청(제출 id '<단계 id>:repair', lib/research-execution.ts startRepair)은 조사 종류 최근 평균(약 339k)이 아니라 입력 추정만 쓴다.
// 수리는 원래 응답의 형식만 고치고(새 조사·도구 없음) 입력 추정 60k 이하에서만 보낸다. 출력은 입력 original과 비슷한 크기라 실제 사용량이 추정보다 클 수 있다(소프트 캡, 종료 후 실제 사용량이 대신한다).
const REPAIR_SUBMISSION=':repair';
async function estimateFor(db:Db,owner:string,submissionId:string,kind:UsageKind|null,body:string){
 const estimatedInputTokens=estimateInputTokens(body);
 return {estimatedInputTokens,estimatedTokens:submissionId.endsWith(REPAIR_SUBMISSION)?estimatedInputTokens:Math.max(estimatedInputTokens,await recentAverage(db,owner,kind))};
}
const previousReservation=(db:Db,owner:string,submissionId:string)=>db.prepare("SELECT json_extract(data,'$.keyHash') AS keyHash,json_extract(data,'$.reservedAt') AS reservedAt FROM records WHERE id=? AND owner=? AND kind='token_reservation'").bind(reservationKey(owner,submissionId),owner).first<{keyHash:string;reservedAt:string}>();
// 새 요청이면 상한 안일 때만 예약을 남긴다(미설정이어도 남겨 나중에 정한 상한이 진행 중 실행을 센다). 예약을 못 쓰면 누계를 다시 읽어 409를 던지고 요청을 보내지 않는다.
async function reserve(db:Db,owner:string,r:Omit<Reservation,'reservedAt'|'runId'>,now:Date){
 const id=reservationKey(owner,r.submissionId),reservation:Reservation={...r,reservedAt:now.toISOString(),runId:null};
 const p=kstMonth(now),{workspace,campaign}=limitsOf(await readBudgets(db,owner),r.campaignId);
 const limits=[...(workspace!==null?[{limit:workspace,campaignId:null}]:[]),...(campaign!==null?[{limit:campaign,campaignId:r.campaignId}]:[])];
 // 다시 읽은 누계가 상한 안이면(그 사이 다른 예약이 풀린 드문 경우) 한 번 더 시도한다.
 for(let attempt=0;attempt<2;attempt++){
  if(await insertReservation(db,owner,id,reservation,limits,p))return {warning:workspace===null?UNSET_WARNING:null,created:true};
  await assertTokenBudget(db,owner,r.campaignId,reservation.estimatedTokens,{now,excludeSubmissionId:r.submissionId});
 }
 throw new TokenBudgetExceeded('토큰 예산 초과: 동시에 들어온 다른 제출이 남은 예산을 먼저 예약했습니다. 사용량 화면에서 진행 중 실행을 확인한 뒤 다시 시도하세요.');
}
// submitHermes가 요청 전에 부른다. 같은 멱등 키의 재전송(접수 확인 복구)은 이미 통과한 요청이라 다시 막거나 두 번 세지 않는다(created:false).
export async function reserveTokenBudget(db:Db,owner:string,submissionId:string,saved:{key:string;body:string},now=new Date()){
 const keyHash=await sha16(saved.key);
 if((await previousReservation(db,owner,submissionId))?.keyHash===keyHash)return {warning:null,created:false};
 const [campaignId,kind]=await Promise.all([submissionCampaign(db,owner,submissionId),submissionKind(db,owner,submissionId)]);
 return reserve(db,owner,{submissionId,campaignId,kind,...await estimateFor(db,owner,submissionId,kind,saved.body),keyHash},now);
}
// OpenAI 직접 경로(lib/role-execution.ts openai('responses'))가 요청 전에 부른다. 제출 원문(hermes_submission)이 없어 캠페인·종류는 호출부가 넘긴다. 확인·예약·409는 위와 같은 원자적 예약이다.
// OpenAI 요청에는 멱등 키가 없고 복구(recover)도 다시 보내지 않으므로, 같은 제출 id·같은 본문의 재호출은 곧 재실행(새 유료 요청)이다. 그래서 지름길 없이 매번 상한을 다시 확인한다(HERMES 재실행이 claim마다 새 키로 다시 확인받는 것과 같다).
// 자기 예약은 누계에서 빼고(reservedSql r.id<>?) 같은 1행을 바꾸므로(ON CONFLICT) 스스로 막히거나 두 번 세지 않는다. 막히면 앞 시도의 예약은 그대로 남는다.
// 정리는 HERMES 경로와 같은 규칙이다: 접수되면 markTokenReservationRun(응답 id), 종료 사용량 기록 뒤 settleTokenReservation(응답 id, 제출 id), 확정 거절(4xx, 429 제외)만 releaseDirectCall. 429·5xx·연결 오류는 예약을 남긴다.
export async function reserveDirectCall(db:Db,owner:string,input:{submissionId:string;campaignId:string|null;kind:UsageKind;body:string},now=new Date()):Promise<{warning:string|null;created:boolean}>{
 return reserve(db,owner,{submissionId:input.submissionId,campaignId:input.campaignId,kind:input.kind,...await estimateFor(db,owner,input.submissionId,input.kind,input.body),keyHash:await sha16(input.body)},now);
}
// 아래는 예약 정리다. 실패해도 이미 끝난 제출·조회를 되돌리지 않는다(남은 예약은 종료 사용량 조인이나 월 경계로 누계에서 빠진다).
async function quietly(label:string,task:()=>Promise<unknown>){try{await task()}catch{console.error(label)}}
// HERMES가 새 요청을 확정 거절(4xx, 429 제외)했다: 실행이 생기지 않았으므로 예약을 푼다. 호출부(submitHermes)가 이번에 만든 예약일 때만 부른다.
export const releaseTokenReservation=(db:Db,owner:string,submissionId:string)=>quietly('token_reservation_release_failed',()=>db.prepare("DELETE FROM records WHERE id=? AND owner=? AND kind='token_reservation'").bind(reservationKey(owner,submissionId),owner).run());
// OpenAI 직접 경로의 확정 거절용(위와 같은 삭제). 호출부가 이번에 만든 예약(created:true)일 때만 부른다. 사용자 미접수 확인(resolve_uncertain)은 5xx·연결 오류로 생긴 상태라 풀지 않는다.
export async function releaseDirectCall(db:Db,owner:string,submissionId:string):Promise<void>{await releaseTokenReservation(db,owner,submissionId)}
// 접수됐다: 실행 번호를 붙여 종료 사용량과 잇는다.
export const markTokenReservationRun=(db:Db,owner:string,submissionId:string,runId:string)=>quietly('token_reservation_run_failed',()=>db.prepare("UPDATE records SET data=json_set(data,'$.runId',?) WHERE id=? AND owner=? AND kind='token_reservation'").bind(runId,reservationKey(owner,submissionId),owner).run());
// 종료 사용량을 기록했다: 토큰을 아는 사용량이면 추정 대신 실제 사용량이 누계에 들어가므로 예약을 지운다. 토큰을 보고하지 않았으면 예약을 남겨 추정치로 계속 센다.
// 실행 번호 기록이 실패했어도(runId 없음) 제출 id(submissionId)로 찾는다. 다른 실행 번호가 붙은 예약(같은 id의 새 제출)은 건드리지 않는다.
// runId는 HERMES 실행 번호 또는 OpenAI 응답 id(직접 경로)다. 두 공급자의 사용량 행 중 토큰을 아는 것이 있으면 정리한다.
export const settleTokenReservation=(db:Db,owner:string,runId:string,submissionId?:string)=>quietly('token_reservation_settle_failed',()=>db.prepare(`DELETE FROM records WHERE owner=? AND kind='token_reservation' AND (json_extract(data,'$.runId')=? OR (id=? AND json_extract(data,'$.runId') IS NULL)) AND EXISTS (SELECT 1 FROM records u WHERE u.id IN (?,?) AND u.owner=? AND u.kind='provider_usage' AND ${tokensOf('u')} IS NOT NULL)`).bind(owner,runId,submissionId?reservationKey(owner,submissionId):'',`${owner}:provider_usage:hermes:${runId}`,`${owner}:provider_usage:openai:${runId}`,owner).run());

// 소유자 설정. monthlyTokens가 null이면 그 상한을 지워 미설정으로 되돌린다.
export async function setTokenBudget(db:Db,owner:string,input:Record<string,unknown>,by:Who){
 if(input.scope!=='workspace'&&input.scope!=='campaign')throw new ApiError(400,'예산 범위는 워크스페이스 또는 캠페인입니다.');
 const scope=input.scope,campaignId=scope==='campaign'?str(input.campaignId,'캠페인',100,true):null;
 if(campaignId&&!await db.prepare("SELECT id FROM records WHERE id=? AND owner=? AND kind='campaign'").bind(`${owner}:campaign:${campaignId}`,owner).first())throw new ApiError(404,'캠페인을 찾을 수 없습니다.');
 const id=`${owner}:token_budget:${campaignId?'campaign:'+campaignId:'workspace'}`;
 if(input.monthlyTokens===null){await db.prepare("DELETE FROM records WHERE id=? AND owner=? AND kind='token_budget'").bind(id,owner).run();return {scope,campaignId,monthlyTokens:null}}
 const n=input.monthlyTokens;
 if(typeof n!=='number'||!Number.isSafeInteger(n)||n<1||n>MAX_TOKENS)throw new ApiError(400,`월 토큰 상한은 1 이상 ${comma(MAX_TOKENS)} 이하의 정수로 입력하세요. 미설정으로 되돌리려면 비워 두세요.`);
 const budget:TokenBudget={scope,campaignId,monthlyTokens:n,updatedAt:new Date().toISOString(),updatedBy:by};
 await db.prepare('INSERT INTO records(id,owner,kind,parent_id,data,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data,updated_at=excluded.updated_at').bind(id,owner,'token_budget','',JSON.stringify(budget),budget.updatedAt).run();
 return {scope,campaignId,monthlyTokens:n};
}
// 사용량 화면 요약(GET /api/usage budget). 상한이 없어도 이번 달 누계를 보인다. 지워진 캠페인의 상한 행은 보이지 않는다.
export async function tokenBudgetSummary(db:Db,owner:string,now=new Date()){
 const p=kstMonth(now),budgets=await readBudgets(db,owner);
 const campaigns=(await db.prepare("SELECT json_extract(data,'$.id') AS id,json_extract(data,'$.title') AS title FROM records WHERE owner=? AND kind='campaign' ORDER BY updated_at DESC").bind(owner).all<{id:string;title:string}>()).results;
 const workspace=await budgetLine(db,owner,p,budgets.find(b=>b.scope==='workspace')?.monthlyTokens??null,null);
 const campaignLines=await Promise.all(budgets.filter(b=>b.scope==='campaign'&&campaigns.some(c=>c.id===b.campaignId)).map(async b=>({campaignId:b.campaignId!,title:campaigns.find(c=>c.id===b.campaignId)!.title,...await budgetLine(db,owner,p,b.monthlyTokens,b.campaignId)})));
 return {month:p.month,start:p.start,end:p.end,timeZone:'Asia/Seoul',workspace,campaigns:campaignLines,campaignOptions:campaigns,warning:workspace.limit===null?UNSET_WARNING:null};
}
