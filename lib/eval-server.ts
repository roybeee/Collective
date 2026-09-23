import {ApiError,database,json,failure,str,stamp,uid,encrypt,decrypt,recordStatement,readRecord,listRecords,configuration,connection,acquireLock,releaseLock,type Actor} from './server';
import {hermesEndpoint,verifyHermes} from './hermes';
import {readBoundedJson} from './http-limits';
import {roleSources,roleRequestFor} from './role-execution';
import {buildRoleInput,buildRoleInstruction,type RoleRequest} from './role-instruction';
import {ROLE_OUTPUT_VERSION} from './role-output';
import {PRACTICE_VERSION} from './practice';
import {runGraders,type GraderResult,type GraderStatus,type FactLedger,type GradeContext,type EvalItem} from './graders/index';
import {bodyOf} from './graders/text';
import {checkCompliance} from './graders/compliance';
import {compareRuns} from './eval-stats';
import {gatewayBasis} from './gateway-snapshot';
import {roles,type Campaign,type Brand} from './agency';

// 서버 평가 실행(F1b-2). 골든셋 케이스(eval_case)를 평가 전용 HERMES 프로필에 보내고 lib/graders로 채점해 eval_run에 남긴다.
// 대표 결정 5: 스모크 1회 tokenBudget 250,000 이하, 이번 UTC 월 누적(사용+진행 중 예약) 1,500,000 절대 상한. 넘으면 소유자 건별 승인 사유가 있어야 한다.
// 대표 결정 6: 골든셋·결과는 D1 records가 정본이다. 운영 HERMES 연결(settings)과 같은 호스트는 평가 연결로 쓰지 않는다. 절차: docs/EVAL.ko.md '서버 평가 실행'.
// 케이스당 예약(EVAL_CASE_TOKEN_RESERVE): HERMES 제출에 토큰 상한이 없어 케이스 1건이 쓸 양을 미리 잡아 둔다. 실측 역할 1회 7,343~13,997토큰(docs/observations/2026-09-23-live-run.md)의 약 3.5배다.
// 제출 직전마다 run 예산과 월 상한에 이 예약을 더해 본다. 진행 중 평가 run은 소유자당 1개라 공정 큐에 평가 작업이 하나만 들어간다.
export const EVAL_SMOKE_TOKEN_CAP=250000,EVAL_MONTHLY_TOKEN_CAP=1500000,EVAL_CASE_TOKEN_RESERVE=50000,EVAL_MAX_ACTIVE_RUNS=1,EVAL_MAX_RUN_CASES=100,EVAL_CASE_TIMEOUT_MS=30*60*1000,EVAL_BODY_LIMIT=1000000;
const MAX_TOKEN_BUDGET=10000000,MAX_REQUEST_CHARS=900000,RUN_ID=/^[a-zA-Z0-9_-]{1,160}$/,ACTIVE=['queued','running'];
type Who={id:string;email:string|null};
type EvalSet='dev'|'sealed';
export type EvalExpectations={prohibitedTerms:string[];facts:FactLedger|null;industry:string|null;localStore:boolean;inputTokenCap?:number};
export type EvalCase={id:string;role:string;label:string;set:EvalSet;request:RoleRequest;expectations:EvalExpectations;campaignId:string|null;source:'capture'|'manual';capturedWith:{skillVersion:string;outputContractVersion:string};setChanges?:{from:EvalSet;to:EvalSet;at:string;by:Who}[];createdBy:Who;createdAt:string;updatedAt:string};
type StoredConnection={secret:string;host:string;isolationConfirmed:boolean;note:string;status:'ready'|'blocked';statusReason:string|null;model:string|null;checkedAt:string;updatedAt:string;updatedBy:Who};
type Conn={endpoint:string;key:string};
type Tokens={input:number|null;output:number|null;total:number|null};
type Compliance={version:string;block:number;warn:number;info:number;issues:{category:string;ruleId:string;severity:string}[]};
// variant: 제출 본문을 만든 프롬프트 변형. 지금은 현재 코드(active)만 있다. 후보 프롬프트(F3)가 이 자리를 쓴다.
// blocked: 제출했으나 연결·인증·격리 조건이 막혀 결과를 확인하지 못함(HERMES가 계속 실행했을 수 있다). failed(HERMES 실패·중단·시간 초과·출력 형식 오류)와 다르다.
export type EvalCaseResult={caseId:string;label:string;set:EvalSet;role:string;variant:'active';status:'pending'|'submitted'|'completed'|'failed'|'cancelled'|'blocked'|'not_run';idempotencyKey?:string;promptHash?:string;providerRunId?:string;model?:string|null;tokens?:Tokens;submittedAt?:string;completedAt?:string;durationMs?:number;graders?:GraderResult[];summary?:Record<GraderStatus,number>;compliance?:Compliance;error?:string};
type StopReason='budget_reached'|'monthly_cap_reached'|'usage_unreported';
// deleted: delete_run은 결과·출력만 지우고 예산 장부(usedTokens·tokenBudget·createdAt)와 감사 기록(overBudgetApproved·sealedUsed)을 남긴다. 월 누적이 줄지 않게 하려는 것이다.
export type EvalRun={gatewaySnapshot?:EvalGatewayBasis;id:string;label:string;variant:'active';set:EvalSet|null;caseIds:string[];tokenBudget:number;usedTokens:number;status:'queued'|'running'|'completed'|'cancelled'|'blocked';stopReason?:StopReason;blockedReason?:string;overBudgetApproved?:{reason:string;by:Who;at:string;exceeded:string[];monthCommitted:number};sealedUsed?:{by:Who;at:string;cases:number};host:string|null;createdBy:Who;createdAt:string;updatedAt:string;cancelledBy?:Who;deleted?:{by:Who;at:string;cases:number};results:EvalCaseResult[]};
type Step={run:EvalRun;writes?:D1PreparedStatement[]};
// 시작 시점 게이트웨이 기준(F2b): operational은 운영 연결의 최신 passed 스냅샷(평가 연결 기준이 아님), eval은 같은 스냅샷 함수로 잰 평가 연결 해시(막히면 blocked).
export type EvalGatewayBasis=Awaited<ReturnType<typeof gatewayBasis>>;
// 인증 실패·연결 불가는 실패(failed)가 아니라 막힘(blocked)으로 기록한다.
class EvalBlocked extends Error{}

const who=(a:Actor):Who=>({id:a.id,email:a.email});
const obj=(v:unknown)=>v!==null&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:null;
const comma=(n:number)=>String(n).replace(/\B(?=(\d{3})+(?!\d))/g,',');
const tokenCount=(v:unknown)=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0?v:null;
const shortText=(v:unknown)=>typeof v==='string'&&v.trim()&&v.length<=200?v.trim():null;
const hex=async(text:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)))).map(x=>x.toString(16).padStart(2,'0')).join('');
// 케이스마다 새 멱등 키: 평가 run id와 case id로만 만든다. 운영 키('collective-<uuid>')와 접두사가 달라 저장된 운영 키를 재사용할 수 없고,
// run마다 달라 같은 케이스를 다시 평가해도 HERMES가 이전 결과를 돌려주지 않는다. 같은 run·케이스의 재시도는 같은 키라 중복 실행을 막는다.
export const evalIdempotencyKey=async(runId:string,caseId:string)=>'collective-eval-'+(await hex(`${runId}:${caseId}`)).slice(0,40);
async function optionalRecord<T>(owner:string,kind:string,id:string){try{return await readRecord<T>(owner,kind,id)}catch(e){if(e instanceof ApiError&&e.status===404)return null;throw e}}

// ── 평가 연결 ──
const SAME_HOST='운영 HERMES 연결과 같은 주소는 평가에 쓸 수 없습니다. 메모리를 끈 평가 전용 프로필 주소를 등록하세요.';
// 호스트 비교 키: 소문자, 끝 점 제거. 'host.'(FQDN 표기)와 'host'는 같은 DNS 이름이라 같은 호스트로 본다.
const hostKey=(host:string)=>host.toLowerCase().replace(/\.+$/,'');
async function operationalHost(owner:string){
 if(!(await configuration(owner))?.secret)return null;
 const cfg=await connection(owner);
 return cfg.provider==='hermes'&&cfg.endpoint?hostKey(new URL(hermesEndpoint(cfg.endpoint)).hostname):null;
}
// 응답에는 설정 여부·호스트·상태만 담는다. 키와 전체 주소는 암호문(secret)에만 있다.
const publicConnection=(s:StoredConnection|null)=>s?{configured:true,host:s.host,isolationConfirmed:s.isolationConfirmed,note:s.note,status:s.status,statusReason:s.statusReason,model:s.model,checkedAt:s.checkedAt,updatedAt:s.updatedAt}:{configured:false};
// 저장할 때 GET /v1/capabilities(실행·조회·중지·영구 멱등)와 인증 보호를 확인한다. 실패해도 저장하되 status blocked로 두고, blocked 연결로는 실행하지 않는다.
async function verified(conn:Conn){
 try{return {status:'ready' as const,statusReason:null,model:await verifyHermes({provider:'hermes',endpoint:conn.endpoint,key:conn.key,model:'eval'})}}
 catch(e){return {status:'blocked' as const,statusReason:e instanceof ApiError?e.message:'평가 HERMES 연결을 확인하지 못했습니다.',model:null}}
}
async function storeConnection(owner:string,conn:Conn,meta:Pick<StoredConnection,'host'|'isolationConfirmed'|'note'>,by:Who){
 const check=await verified(conn),at=stamp(),record:StoredConnection={secret:await encrypt(JSON.stringify(conn)),...meta,...check,checkedAt:at,updatedAt:at,updatedBy:by};
 await recordStatement(owner,'eval_connection','current',record).run();
 return publicConnection(record);
}
async function saveConnection(owner:string,input:Record<string,unknown>,by:Who){
 const endpoint=hermesEndpoint(str(input.endpoint,'평가 HERMES 주소',500,true)),key=str(input.key,'평가 연결 키',2000,true),note=str(input.note??'','메모',1000);
 if(typeof input.isolationConfirmed!=='boolean')throw new ApiError(400,'평가 전용 프로필(메모리 off) 격리 확인(isolationConfirmed)을 true 또는 false로 입력하세요.');
 const host=new URL(endpoint).hostname;
 if(host.endsWith('.'))throw new ApiError(400,'평가 HERMES 주소 호스트 끝의 점(.)을 빼고 입력하세요.');
 if(hostKey(host)===await operationalHost(owner))throw new ApiError(400,SAME_HOST);
 return storeConnection(owner,{endpoint,key},{host,isolationConfirmed:input.isolationConfirmed,note},by);
}
async function checkConnection(owner:string,by:Who){
 const s=await readRecord<StoredConnection>(owner,'eval_connection','current');
 return storeConnection(owner,JSON.parse(await decrypt(s.secret)) as Conn,{host:s.host,isolationConfirmed:s.isolationConfirmed,note:s.note},by);
}
// 실행 직전마다 다시 본다: 연결 없음·격리 미확인·확인 실패·운영 연결이 같은 호스트로 바뀜이면 막는다.
async function connectionGate(owner:string):Promise<{conn:Conn;host:string}|{blocked:string;host:string|null}>{
 const s=await optionalRecord<StoredConnection>(owner,'eval_connection','current');
 if(!s)return {blocked:'평가 연결이 없습니다. 평가 전용 HERMES 연결을 먼저 저장하세요.',host:null};
 if(!s.isolationConfirmed)return {blocked:'평가 전용 프로필(메모리 off) 격리가 확인되지 않았습니다.',host:s.host};
 if(s.status!=='ready')return {blocked:'평가 연결 확인에 실패했습니다: '+(s.statusReason||'원인 미상'),host:s.host};
 if(hostKey(s.host)===await operationalHost(owner))return {blocked:SAME_HOST,host:s.host};
 return {conn:JSON.parse(await decrypt(s.secret)) as Conn,host:s.host};
}
// 막힌 run의 제출 중 실행을 멈출 때 쓴다. 저장된 연결이 이 run을 보낸 호스트일 때만 돌려준다(바뀐 연결에 옛 실행 번호를 보내지 않는다).
async function stopConnection(owner:string,host:string|null):Promise<Conn|null>{
 const s=host?await optionalRecord<StoredConnection>(owner,'eval_connection','current'):null;
 if(!s||!host||hostKey(s.host)!==hostKey(host))return null;
 try{return JSON.parse(await decrypt(s.secret)) as Conn}catch{return null}
}
async function evalRequest(conn:Conn,path:string,init:RequestInit={}):Promise<Record<string,unknown>>{
 let r:Response;
 try{r=await fetch(conn.endpoint+path,{...init,redirect:'manual',headers:{...init.headers,Authorization:`Bearer ${conn.key}`,'Content-Type':'application/json'},signal:AbortSignal.timeout(30000)})}
 catch{throw new EvalBlocked('평가 HERMES 연결에 실패했습니다(시간 초과 또는 연결 끊김).')}
 if(r.status===401||r.status===403)throw new EvalBlocked('평가 HERMES 인증에 실패했습니다. 평가 연결 키를 확인하세요.');
 if(r.status>=300&&r.status<400)throw new EvalBlocked('평가 HERMES 주소가 다른 주소로 이동합니다. 최종 HTTPS 주소로 연결을 다시 저장하세요.');
 if(!r.ok)throw new ApiError(r.status===429?429:r.status>=500?502:400,`평가 HERMES 요청을 처리하지 못했습니다 (${r.status}).`);
 try{return obj(await readBoundedJson(r,1000000))||{}}catch{throw new ApiError(502,'평가 HERMES 응답이 너무 크거나 형식이 올바르지 않습니다.')}
}

// ── 평가 케이스 ──
function roleId(v:unknown){const id=str(v,'담당',40,true);if(!roles.some(r=>r.id===id))throw new ApiError(400,'담당을 선택해 주세요.');return id}
function evalSet(v:unknown,fallback:EvalSet='dev'):EvalSet{if(v===undefined)return fallback;if(v!=='dev'&&v!=='sealed')throw new ApiError(400,'세트는 dev 또는 sealed만 쓸 수 있습니다.');return v}
function stringList(v:unknown,label:string){if(v===undefined)return [];if(!Array.isArray(v)||v.length>100)throw new ApiError(400,`${label} 목록을 확인하세요.`);return v.map(x=>str(x,label,100,true))}
function ledger(v:unknown):FactLedger|null{
 if(v===null)return null;
 const o=obj(v),list=(x:unknown)=>Array.isArray(x)&&x.length<=500&&x.every(i=>obj(i))?x as FactLedger['confirmed']:null,confirmed=list(o?.confirmed??[]),prohibited=list(o?.prohibited??[]);
 if(!o||!confirmed||!prohibited)throw new ApiError(400,'사실 원장(facts)은 {confirmed:[], prohibited:[]} 형식이어야 합니다.');
 return {confirmed,prohibited};
}
// 기대 판정 = lib/graders 채점 컨텍스트. facts를 주지 않으면 캡처한 요청의 확정·거절 사실을 원장으로 쓴다.
function expectationsOf(v:unknown,facts:FactLedger|null):EvalExpectations{
 const o=v===undefined?{}:obj(v),cap=o?.inputTokenCap;
 if(!o||o.localStore!==undefined&&typeof o.localStore!=='boolean')throw new ApiError(400,'기대 판정(expectations) 형식을 확인하세요.');
 if(cap!==undefined&&(typeof cap!=='number'||!Number.isSafeInteger(cap)||cap<1||cap>1000000))throw new ApiError(400,'입력 토큰 상한(inputTokenCap)을 확인하세요.');
 return {prohibitedTerms:stringList(o.prohibitedTerms,'금지 표현'),facts:o.facts===undefined?facts:ledger(o.facts),industry:o.industry===undefined||o.industry===null?null:str(o.industry,'업종',50,true),localStore:o.localStore===true,...(typeof cap==='number'?{inputTokenCap:cap}:{})};
}
// 직접 저장하는 요청은 운영 요청 구조여야 하고 현재 역할 지시문 조립기가 받아야 한다.
function frozenRequest(v:unknown,role:string):RoleRequest{
 const r=obj(v);
 if(!r||r.role!==role||!obj(r.campaign)||!obj(r.brand)||!obj(r.archive)||!obj(r.evidence)||!Array.isArray(r.previous))throw new ApiError(400,'역할 요청(request)은 role·campaign·brand·archive·evidence·previous를 갖춘 운영 요청 구조여야 합니다.');
 try{buildRoleInstruction(r as RoleRequest);buildRoleInput(r as RoleRequest)}catch{throw new ApiError(400,'역할 요청으로 지시문을 만들 수 없습니다. 형식을 확인하세요.')}
 if(JSON.stringify(r).length>MAX_REQUEST_CHARS)throw new ApiError(413,'역할 요청이 너무 큽니다.');
 return r as RoleRequest;
}
type CaseFields=Pick<EvalCase,'role'|'label'|'set'|'request'|'expectations'|'campaignId'|'source'>;
async function storeCase(owner:string,fields:CaseFields,by:Who){
 const at=stamp(),kase:EvalCase={id:uid(),...fields,capturedWith:{skillVersion:PRACTICE_VERSION,outputContractVersion:ROLE_OUTPUT_VERSION},createdBy:by,createdAt:at,updatedAt:at};
 await recordStatement(owner,'eval_case',kase.id,kase).run();
 return kase;
}
// 운영 역할 실행과 같은 DB 읽기(roleSources·roleRequestFor)로 요청을 만들어 JSON 그대로 동결한다. 실행 가능 여부 검사(409)는 적용하지 않는다.
async function captureCase(owner:string,input:Record<string,unknown>,by:Who){
 const role=roleId(input.role),c=await readRecord<Campaign>(owner,'campaign',str(input.campaignId,'캠페인',100,true)),sources=await roleSources(owner,c,role);
 const request=await roleRequestFor(owner,c,role,sources,await readRecord<Brand>(owner,'brand',c.brandId)),frozen=JSON.parse(JSON.stringify(request)) as RoleRequest;
 if(JSON.stringify(frozen).length>MAX_REQUEST_CHARS)throw new ApiError(413,'역할 요청이 너무 커서 평가 케이스로 저장할 수 없습니다.');
 const facts={confirmed:request.evidence.facts.confirmed,prohibited:request.evidence.facts.prohibited} as FactLedger,name=roles.find(r=>r.id===role)!.name;
 return storeCase(owner,{role,request:frozen,expectations:expectationsOf(input.expectations,facts),campaignId:c.id,source:'capture',set:evalSet(input.set),label:str(input.label??'','케이스 이름',200)||`${name} · ${c.title} · 브리프 v${c.version}`},by);
}
async function saveCase(owner:string,input:Record<string,unknown>,by:Who){
 const role=roleId(input.role),set=evalSet(input.set),request=frozenRequest(input.request,role),expectations=expectationsOf(input.expectations,null);
 const campaignId=typeof request.campaign.id==='string'?request.campaign.id:null;
 return storeCase(owner,{role,request,expectations,campaignId,source:'manual',set,label:str(input.label??'','케이스 이름',200)||`${role} 수동 케이스`},by);
}
// 요청(request)은 동결 대상이라 바꾸지 않는다. 이름·세트·기대 판정만 고치고, 세트 이동은 기록한다(봉인 세트를 보고 고친 케이스는 dev로 옮긴다).
async function updateCase(owner:string,input:Record<string,unknown>,by:Who){
 const kase=await readRecord<EvalCase>(owner,'eval_case',str(input.id,'평가 케이스',100,true)),set=evalSet(input.set,kase.set),at=stamp();
 const next:EvalCase={...kase,label:input.label===undefined?kase.label:str(input.label,'케이스 이름',200,true),set,expectations:input.expectations===undefined?kase.expectations:expectationsOf(input.expectations,kase.expectations.facts),...(set!==kase.set?{setChanges:[...(kase.setChanges||[]),{from:kase.set,to:set,at,by}]}:{}),updatedAt:at};
 await recordStatement(owner,'eval_case',kase.id,next).run();
 return next;
}
async function deleteCase(owner:string,input:Record<string,unknown>){
 const kase=await readRecord<EvalCase>(owner,'eval_case',str(input.id,'평가 케이스',100,true)),db=database();
 const inUse=await db.prepare("SELECT 1 FROM records WHERE owner=? AND kind='eval_run' AND json_extract(data,'$.status') IN ('queued','running') AND EXISTS (SELECT 1 FROM json_each(json_extract(data,'$.caseIds')) WHERE value=?) LIMIT 1").bind(owner,kase.id).first();
 if(inUse)throw new ApiError(409,'진행 중인 평가 실행이 이 케이스를 쓰고 있습니다. 실행을 끝내거나 취소한 뒤 삭제하세요.');
 await db.prepare("DELETE FROM records WHERE owner=? AND kind='eval_case' AND id=?").bind(owner,`${owner}:eval_case:${kase.id}`).run();
 return {id:kase.id,deleted:true};
}

// ── 예산 ──
// 그 UTC 월(기본 이번 달)에 만든 run의 보고 토큰 합(usedTokens)과, 진행 중 run이 아직 쓰지 않은 예산(reservedTokens). 둘의 합에 새 예산을 더해 월 상한과 비교한다.
// 삭제한 run도 행(deleted)이 남아 합에 들어간다. 월 누적은 run 생성 월 기준이다.
export async function evalMonthUsage(owner:string,at=new Date()){
 const start=new Date(Date.UTC(at.getUTCFullYear(),at.getUTCMonth(),1)).toISOString(),end=new Date(Date.UTC(at.getUTCFullYear(),at.getUTCMonth()+1,1)).toISOString();
 const rows=(await database().prepare("SELECT json_extract(data,'$.status') AS status,json_extract(data,'$.usedTokens') AS used,json_extract(data,'$.tokenBudget') AS budget FROM records WHERE owner=? AND kind='eval_run' AND json_extract(data,'$.createdAt')>=? AND json_extract(data,'$.createdAt')<?").bind(owner,start,end).all<{status:string;used:number|null;budget:number|null}>()).results;
 const usedTokens=rows.reduce((s,r)=>s+(Number(r.used)||0),0),reservedTokens=rows.filter(r=>ACTIVE.includes(r.status)).reduce((s,r)=>s+Math.max(0,(Number(r.budget)||0)-(Number(r.used)||0)),0);
 return {month:start.slice(0,7),usedTokens,reservedTokens,monthlyCap:EVAL_MONTHLY_TOKEN_CAP,smokeCap:EVAL_SMOKE_TOKEN_CAP};
}
async function budgetApproval(owner:string,tokenBudget:number,value:unknown,by:Who){
 const usage=await evalMonthUsage(owner),committed=usage.usedTokens+usage.reservedTokens;
 const exceeded=[...(tokenBudget>EVAL_SMOKE_TOKEN_CAP?['smoke_cap']:[]),...(committed+tokenBudget>EVAL_MONTHLY_TOKEN_CAP?['monthly_cap']:[])];
 if(!exceeded.length)return undefined;
 const approval=obj(value);
 if(!approval)throw new ApiError(409,`평가 토큰 상한을 넘습니다(1회 ${comma(EVAL_SMOKE_TOKEN_CAP)} · 이번 달 ${comma(committed)}+${comma(tokenBudget)} / ${comma(EVAL_MONTHLY_TOKEN_CAP)}). 대표 승인 사유(overBudgetApproved.reason)와 함께 다시 요청하세요.`);
 return {reason:str(approval.reason,'대표 승인 사유',500,true),by,at:stamp(),exceeded,monthCommitted:committed};
}
// 제출 직전 월 검사: run 생성 월의 보고 토큰 + 다른 진행 중 run의 남은 예산 + 이번 케이스 예약이 월 상한을 넘으면 제출하지 않는다.
// 앞 케이스가 예약보다 많이 써 월 누적이 늘어난 경우를 잡는다. 월 상한 승인을 받은 run은 자기 run 예산만 본다.
async function monthlyCapReached(owner:string,run:EvalRun){
 if(run.overBudgetApproved?.exceeded.includes('monthly_cap'))return false;
 const u=await evalMonthUsage(owner,new Date(run.createdAt)),own=Math.max(0,run.tokenBudget-run.usedTokens);
 return u.usedTokens+u.reservedTokens-own+EVAL_CASE_TOKEN_RESERVE>EVAL_MONTHLY_TOKEN_CAP;
}

// ── 평가 실행 ──
async function runCases(owner:string,input:Record<string,unknown>):Promise<EvalCase[]>{
 if(Array.isArray(input.caseIds)){
  const ids=[...new Set(input.caseIds.map(id=>str(id,'평가 케이스',100,true)))];
  if(!ids.length||ids.length>EVAL_MAX_RUN_CASES)throw new ApiError(400,`평가 케이스를 1~${EVAL_MAX_RUN_CASES}개 선택하세요.`);
  return Promise.all(ids.map(id=>readRecord<EvalCase>(owner,'eval_case',id)));
 }
 if(input.set===undefined)throw new ApiError(400,'평가 케이스(caseIds) 또는 세트(set: dev|sealed)를 지정하세요.');
 const set=evalSet(input.set);
 const cases=(await listRecords<EvalCase>(owner,'eval_case')).filter(c=>c.set===set).sort((a,b)=>a.createdAt.localeCompare(b.createdAt)||a.id.localeCompare(b.id));
 if(!cases.length)throw new ApiError(400,'이 세트에 평가 케이스가 없습니다.');
 if(cases.length>EVAL_MAX_RUN_CASES)throw new ApiError(400,`세트 케이스가 ${EVAL_MAX_RUN_CASES}개를 넘습니다. caseIds로 나눠 실행하세요.`);
 return cases;
}
// 막힘: 제출 전 케이스는 not_run, 제출 중 케이스는 blocked(결과 미확인, providerRunId 유지)로 둔다. stopNote는 중지 요청 결과다.
const blockRun=(run:EvalRun,reason:string,stopNote=''):EvalRun=>({...run,status:'blocked',blockedReason:reason,updatedAt:stamp(),results:run.results.map(r=>r.status==='pending'?{...r,status:'not_run',error:reason}:r.status==='submitted'?{...r,status:'blocked',error:`${reason} 결과를 확인하지 못했습니다.${stopNote}`}:r)});
// 막혀도 제출 중인 HERMES 실행은 계속 토큰을 쓸 수 있으므로, 이 run을 보낸 호스트의 저장된 연결로 중지를 요청하고 결과를 케이스 error에 남긴다.
async function blockWithStop(owner:string,run:EvalRun,reason:string){
 const inflight=run.results.find(r=>r.status==='submitted'&&r.providerRunId);
 if(!inflight)return blockRun(run,reason);
 const conn=await stopConnection(owner,run.host),stopped=conn?await stopProvider(conn,inflight.providerRunId!):false;
 return blockRun(run,reason,!conn?' 이 run을 보낸 평가 연결이 없어 HERMES 실행 중지를 요청하지 못했습니다.':stopped?' HERMES 실행 중지를 요청해 확인했습니다.':' HERMES 실행 중지를 요청했으나 확인하지 못했습니다.');
}
function budgetOf(v:unknown){
 if(typeof v!=='number'||!Number.isSafeInteger(v)||v<1||v>MAX_TOKEN_BUDGET)throw new ApiError(400,'토큰 예산(tokenBudget)을 1 이상의 정수로 입력하세요.');
 if(v<EVAL_CASE_TOKEN_RESERVE)throw new ApiError(400,`토큰 예산(tokenBudget)은 케이스 1건 예약량 ${comma(EVAL_CASE_TOKEN_RESERVE)} 이상이어야 합니다.`);
 return v;
}
// 진행 중 평가 run은 소유자당 EVAL_MAX_ACTIVE_RUNS개다. POST 라우트가 소유자 잠금 안에서 부르므로 검사와 저장 사이에 다른 시작이 끼지 않는다.
async function assertRunSlot(owner:string){
 const r=await database().prepare("SELECT COUNT(*) AS n FROM records WHERE owner=? AND kind='eval_run' AND json_extract(data,'$.status') IN ('queued','running')").bind(owner).first<{n:number}>();
 if(Number(r?.n)>=EVAL_MAX_ACTIVE_RUNS)throw new ApiError(409,`진행 중인 평가 실행이 있습니다(소유자당 ${EVAL_MAX_ACTIVE_RUNS}개). 끝나거나 취소한 뒤 시작하세요.`);
}
// 시작 거부 정책: 연결 없음·격리 미확인·연결 확인 실패·운영과 같은 호스트면 run을 blocked로 기록하고 409로 답한다(시도와 원인이 남는다).
async function startRun(owner:string,input:Record<string,unknown>,by:Who){
 const tokenBudget=budgetOf(input.tokenBudget);
 if((input.variant??'active')!=='active')throw new ApiError(400,'후보 프롬프트 변형은 아직 지원하지 않습니다. variant는 active만 쓸 수 있습니다.');
 const label=str(input.label??'','실행 이름',200),cases=await runCases(owner,input);
 await assertRunSlot(owner);
 const approval=await budgetApproval(owner,tokenBudget,input.overBudgetApproved,by);
 const gate=await connectionGate(owner),at=stamp(),sealed=cases.filter(c=>c.set==='sealed').length;
 const gatewaySnapshot=await gatewayBasis(owner,'conn' in gate?gate.conn:null);
 const run:EvalRun={id:uid(),label,variant:'active',set:Array.isArray(input.caseIds)?null:evalSet(input.set),caseIds:cases.map(c=>c.id),tokenBudget,usedTokens:0,status:'queued',...(approval?{overBudgetApproved:approval}:{}),gatewaySnapshot,host:gate.host,createdBy:by,createdAt:at,updatedAt:at,results:cases.map(c=>({caseId:c.id,label:c.label,set:c.set,role:c.role,variant:'active',status:'pending'}))};
 if('blocked' in gate){const blocked=blockRun(run,gate.blocked);await recordStatement(owner,'eval_run',run.id,blocked).run();return json({error:gate.blocked,run:blocked},409)}
 const queued={...run,...(sealed?{sealedUsed:{by,at,cases:sealed}}:{})};
 await recordStatement(owner,'eval_run',run.id,queued).run();
 return json(queued);
}
async function stopProvider(conn:Conn,id:string){return evalRequest(conn,`/v1/runs/${id}/stop`,{method:'POST',body:'{}'}).then(()=>true,()=>false)}
async function cancelRun(owner:string,input:Record<string,unknown>,by:Who){
 const run=await readRecord<EvalRun>(owner,'eval_run',str(input.id,'평가 실행',100,true));
 if(!ACTIVE.includes(run.status))throw new ApiError(409,'이미 끝난 평가 실행입니다.');
 const inflight=run.results.find(r=>r.status==='submitted'),gate=inflight?await connectionGate(owner):null;
 const stopped=inflight?.providerRunId&&gate&&'conn' in gate?await stopProvider(gate.conn,inflight.providerRunId):false,at=stamp();
 const next:EvalRun={...run,status:'cancelled',cancelledBy:by,updatedAt:at,results:run.results.map(r=>r.status==='submitted'?{...r,status:'cancelled',completedAt:at,error:stopped?'취소하며 HERMES 실행을 중지했습니다.':'취소했습니다. HERMES 실행 중지는 확인하지 못했습니다.'}:r.status==='pending'?{...r,status:'not_run',error:'평가 실행을 취소했습니다.'}:r)};
 await recordStatement(owner,'eval_run',run.id,next).run();
 return next;
}
// 소프트 삭제: 출력(eval_output)과 케이스 결과를 지우고, 결정 5 장부(usedTokens·tokenBudget·createdAt)와 승인·봉인 세트 기록은 남긴다.
async function deleteRun(owner:string,input:Record<string,unknown>,by:Who){
 const run=await readRecord<EvalRun>(owner,'eval_run',str(input.id,'평가 실행',100,true)),db=database(),at=stamp();
 if(ACTIVE.includes(run.status))throw new ApiError(409,'진행 중인 평가 실행은 취소한 뒤 삭제하세요.');
 if(run.deleted)throw new ApiError(409,'이미 삭제한 평가 실행입니다.');
 const tombstone:EvalRun={...run,results:[],deleted:{by,at,cases:run.results.length},updatedAt:at};
 await db.batch([db.prepare("DELETE FROM records WHERE owner=? AND kind='eval_output' AND parent_id=?").bind(owner,run.id),recordStatement(owner,'eval_run',run.id,tombstone)]);
 return {id:run.id,deleted:true};
}

// ── 워커 한 걸음: 제출 중인 케이스가 있으면 조회, 없으면 다음 케이스 제출. 한 tick에 조회·제출은 1건만 한다(시간 초과·막힘의 중지 요청만 더한다). ──
// 케이스를 하나라도 다룬 run은 queued에서 running으로 넘어간다. 끝남 판정은 settle이 한다.
const withResult=(run:EvalRun,at:number,result:EvalCaseResult):EvalRun=>({...run,status:run.status==='queued'?'running':run.status,updatedAt:stamp(),results:run.results.map((r,i)=>i===at?result:r)});
const STOP_TEXT:Record<StopReason,string>={budget_reached:`남은 토큰 예산이 케이스 1건 예약량(${comma(EVAL_CASE_TOKEN_RESERVE)})보다 작아 제출하지 않았습니다.`,monthly_cap_reached:`이번 달 평가 토큰 절대 상한(${comma(EVAL_MONTHLY_TOKEN_CAP)})에 닿아 제출하지 않았습니다. 넘기려면 대표 승인으로 새 실행을 시작하세요.`,usage_unreported:'HERMES가 토큰 사용량을 보고하지 않아 예산을 지킬 수 없으므로 제출하지 않았습니다.'};
// 제출한 케이스가 사용량 없이 끝나 예산을 확인할 수 없거나, 보고 토큰에 다음 케이스 예약을 더하면 run 예산을 넘으면 남은 케이스를 제출하지 않는다.
function stopReason(run:EvalRun):StopReason|undefined{
 if(run.results.some(r=>r.providerRunId&&r.status!=='submitted'&&(r.tokens?.total??null)===null))return 'usage_unreported';
 return run.usedTokens+EVAL_CASE_TOKEN_RESERVE>run.tokenBudget?'budget_reached':undefined;
}
const stopRun=(run:EvalRun,stop:StopReason):EvalRun=>({...run,status:'completed',stopReason:stop,updatedAt:stamp(),results:run.results.map(r=>r.status==='pending'?{...r,status:'not_run',error:STOP_TEXT[stop]}:r)});
function settle(run:EvalRun):EvalRun{
 if(run.results.some(r=>r.status==='submitted'))return run;
 const pending=run.results.some(r=>r.status==='pending'),stop=pending?stopReason(run):undefined;
 if(pending&&!stop)return run;
 return stop?stopRun(run,stop):{...run,status:'completed',updatedAt:stamp()};
}
function runStatus(v:unknown){
 const s=String(v);
 return s==='completed'?'completed':['cancelled','canceled','stopped','interrupted'].includes(s)?'cancelled':['failed','error','incomplete'].includes(s)?'failed':['started','queued','running','stopping','waiting','waiting_approval','waiting_for_approval','pending'].includes(s)?'in_progress':null;
}
function usageOf(res:Record<string,unknown>):Tokens{
 const u=obj(res.usage)||{},input=tokenCount(u.input_tokens??u.prompt_tokens),output=tokenCount(u.output_tokens??u.completion_tokens);
 return {input,output,total:tokenCount(u.total_tokens)??(input!==null&&output!==null?input+output:null)};
}
// lib/graders 13종과 규제 가드레일로 서버가 채점한다. run에는 판정·요약만, 발췌가 든 가드레일 상세는 eval_output에 둔다.
function gradeCase(kase:EvalCase,output:string,inputTokens:number|null){
 const e=kase.expectations,item:EvalItem={id:kase.id,kind:'role',role:kase.role,raw:output,contract:true,inputTokens};
 const ctx:GradeContext={prohibitedTerms:e.prohibitedTerms,facts:e.facts,industry:e.industry,localStore:e.localStore,...(e.inputTokenCap?{inputTokenCap:e.inputTokenCap}:{})};
 const graders=runGraders(item,ctx).map(g=>({id:g.id,status:g.status,...(g.detail?{detail:g.detail.slice(0,200)}:{})}));
 const report=checkCompliance(bodyOf(item),{facts:e.facts}),severity=(s:string)=>report.issues.filter(i=>i.severity===s).length;
 const summary=graders.reduce((acc,g)=>({...acc,[g.status]:acc[g.status]+1}),{pass:0,fail:0,not_applicable:0,grader_error:0} as Record<GraderStatus,number>);
 return {graders,summary,report,compliance:{version:report.version,block:severity('block'),warn:severity('warn'),info:severity('info'),issues:report.issues.map(i=>({category:i.category,ruleId:i.ruleId,severity:i.severity}))}};
}
async function submitCase(owner:string,run:EvalRun,conn:Conn,at:number):Promise<Step>{
 const r=run.results[at],kase=await optionalRecord<EvalCase>(owner,'eval_case',r.caseId);
 if(!kase)return {run:settle(withResult(run,at,{...r,status:'not_run',error:'평가 케이스가 삭제됐습니다.'}))};
 let instructions:string,input:string;
 try{instructions=buildRoleInstruction(kase.request);input=buildRoleInput(kase.request)}catch{return {run:settle(withResult(run,at,{...r,status:'failed',error:'동결한 요청으로 지시문을 만들지 못했습니다.'}))}}
 const key=await evalIdempotencyKey(run.id,kase.id),promptHash=(await hex(instructions+'\u0000'+input)).slice(0,16),submittedAt=stamp();
 let res:Record<string,unknown>;
 try{res=await evalRequest(conn,'/v1/runs',{method:'POST',headers:{'Idempotency-Key':key,'X-Hermes-Session-Key':key},body:JSON.stringify({instructions,input,session_id:key,conversation_history:[]})})}
 catch(e){if(e instanceof ApiError&&e.status===400)return {run:settle(withResult(run,at,{...r,status:'failed',idempotencyKey:key,promptHash,error:e.message}))};throw e}
 if(typeof res.run_id!=='string'||!RUN_ID.test(res.run_id))return {run:settle(withResult(run,at,{...r,status:'failed',idempotencyKey:key,promptHash,error:'HERMES 실행 번호를 확인하지 못했습니다.'}))};
 return {run:withResult(run,at,{...r,status:'submitted',idempotencyKey:key,promptHash,providerRunId:res.run_id,submittedAt})};
}
async function timeoutCase(run:EvalRun,conn:Conn,at:number):Promise<Step>{
 const r=run.results[at],stopped=await stopProvider(conn,r.providerRunId!);
 return {run:settle(withResult(run,at,{...r,status:'failed',completedAt:stamp(),error:`평가 케이스가 실행 시간 한도(${EVAL_CASE_TIMEOUT_MS/60000}분)를 넘어 ${stopped?'중지했습니다':'중지를 요청했으나 확인하지 못했습니다'}.`}))};
}
async function pollCase(owner:string,run:EvalRun,conn:Conn,at:number):Promise<Step>{
 const r=run.results[at],id=r.providerRunId!;
 let res:Record<string,unknown>;
 try{res=await evalRequest(conn,'/v1/runs/'+id)}catch(e){if(e instanceof ApiError&&e.status===400)return {run:settle(withResult(run,at,{...r,status:'failed',completedAt:stamp(),error:e.message}))};throw e}
 if(res.object!=='hermes.run'||res.run_id!==id)throw new ApiError(502,'평가 HERMES 실행 결과가 일치하지 않습니다.');
 const status=runStatus(res.status);
 if(!status)throw new ApiError(502,'평가 HERMES 실행 상태를 확인하지 못했습니다.');
 if(status==='in_progress')return Date.now()-Date.parse(r.submittedAt!)>EVAL_CASE_TIMEOUT_MS?timeoutCase(run,conn,at):{run};
 const tokens=usageOf(res),completedAt=stamp(),done={...r,model:shortText(res.model),tokens,completedAt,durationMs:Math.max(0,Date.parse(completedAt)-Date.parse(r.submittedAt!))};
 const used={...run,usedTokens:run.usedTokens+(tokens.total??0)},kase=await optionalRecord<EvalCase>(owner,'eval_case',r.caseId),output=res.output;
 if(status!=='completed'||typeof output!=='string'||output.length>300000||!kase)return {run:settle(withResult(used,at,{...done,status:'failed',error:!kase?'평가 케이스가 삭제됐습니다.':status==='completed'?'HERMES 출력이 텍스트가 아니거나 300,000자를 넘습니다.':`HERMES 실행이 완료되지 않았습니다(${status}).`}))};
 const {graders,summary,compliance,report}=gradeCase(kase,output,tokens.input);
 const write=recordStatement(owner,'eval_output',`${run.id}:${kase.id}`,{runId:run.id,caseId:kase.id,role:kase.role,providerRunId:id,model:done.model,output,compliance:report,createdAt:completedAt},run.id);
 return {run:settle(withResult(used,at,{...done,status:'completed',graders,summary,compliance})),writes:[write]};
}
async function evalStep(owner:string,run:EvalRun):Promise<Step>{
 const gate=await connectionGate(owner);
 if('blocked' in gate)return {run:await blockWithStop(owner,run,gate.blocked)};
 try{
  const inflight=run.results.findIndex(r=>r.status==='submitted');
  if(inflight>=0)return await pollCase(owner,run,gate.conn,inflight);
  const settled=settle(run),next=settled.results.findIndex(r=>r.status==='pending');
  if(settled.status==='completed'||next<0)return {run:settled};
  if(await monthlyCapReached(owner,settled))return {run:stopRun(settled,'monthly_cap_reached')};
  return await submitCase(owner,settled,gate.conn,next);
 }catch(e){if(e instanceof EvalBlocked)return {run:await blockWithStop(owner,run,e.message)};throw e}
}
// lib/background-execution.ts 공정 큐가 부른다. 소유자 잠금 안에서 한 걸음만 진행하고 run을 저장한다. 재시도할 오류(429·5xx)는 응답 상태로 돌려 큐의 백오프에 맡긴다.
export async function advanceEvalRun(owner:string,id:string){
 let lock='';
 try{
  lock=await acquireLock(owner);
  const run=await readRecord<EvalRun>(owner,'eval_run',id);
  if(!ACTIVE.includes(run.status))return json({id,status:run.status});
  const step=await evalStep(owner,run);
  await database().batch([...(step.writes||[]),recordStatement(owner,'eval_run',id,step.run)]);
  return json({id,status:step.run.status});
 }catch(e){return failure(e)}finally{if(lock)await releaseLock(owner,lock)}
}

// ── API 진입점(app/api/eval/route.ts). 권한 검사는 라우트가 한다(소유자만). ──
const caseSummary=(c:EvalCase)=>({id:c.id,role:c.role,label:c.label,set:c.set,campaignId:c.campaignId,source:c.source,capturedWith:c.capturedWith,prohibitedTerms:c.expectations.prohibitedTerms.length,setChanges:c.setChanges||[],createdBy:c.createdBy,createdAt:c.createdAt,updatedAt:c.updatedAt});
export async function evalRead(owner:string,params:URLSearchParams){
 const id=(name:string,label:string)=>str(params.get(name),label,200,true),compare=params.get('compare');
 if(compare){
  const [a,b]=compare.split(','),runs=[await readRecord<EvalRun>(owner,'eval_run',str(a,'기준 실행',100,true)),await readRecord<EvalRun>(owner,'eval_run',str(b,'비교 실행',100,true))];
  if(runs.some(r=>r.deleted))throw new ApiError(409,'삭제한 평가 실행은 결과가 없어 비교할 수 없습니다.');
  return compareRuns(runs[0],runs[1]);
 }
 if(params.has('run')&&params.has('caseId'))return readRecord(owner,'eval_output',`${id('run','평가 실행')}:${id('caseId','평가 케이스')}`);
 if(params.has('run'))return readRecord<EvalRun>(owner,'eval_run',id('run','평가 실행'));
 if(params.has('case'))return readRecord<EvalCase>(owner,'eval_case',id('case','평가 케이스'));
 const [conn,cases,runs,usage]=await Promise.all([optionalRecord<StoredConnection>(owner,'eval_connection','current'),listRecords<EvalCase>(owner,'eval_case'),listRecords<EvalRun>(owner,'eval_run'),evalMonthUsage(owner)]);
 return {connection:publicConnection(conn),cases:cases.map(caseSummary),runs,usage};
}
const ACTIONS:Record<string,(owner:string,input:Record<string,unknown>,by:Who)=>Promise<unknown>>={
 save_connection:saveConnection,check_connection:(owner,_input,by)=>checkConnection(owner,by),capture_case:captureCase,save_case:saveCase,update_case:updateCase,delete_case:deleteCase,cancel_run:cancelRun,delete_run:deleteRun,
};
export async function evalAction(owner:string,input:Record<string,unknown>,actor:Actor):Promise<Response>{
 const by=who(actor),name=String(input.action);
 if(name==='start_run')return startRun(owner,input,by);
 if(!Object.hasOwn(ACTIONS,name))throw new ApiError(400,'지원하지 않는 평가 작업입니다.');
 return json(await ACTIONS[name](owner,input,by));
}
