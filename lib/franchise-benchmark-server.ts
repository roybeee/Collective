// 트랙 R R7a 공공 벤치마크 서버(토큰 0): /api/franchise 작업 3개(benchmark_key_save·benchmark_key_clear·benchmark_load, 대표·관리자)와 GET 보기 benchmark(모든 역할).
// 적재는 사람이 버튼을 눌렀을 때만 한다(결정 19, 주기 모니터링 없음). 공정위 API 호출은 lib/connectors/ftc-franchise.ts, 검사·정규화·파생 지표는 순수 모듈 lib/franchise-benchmark.ts가 한다.
// 공공데이터 키는 환경 변수가 아니라 브랜드별 benchmark_credential 암호문(AES-GCM v1, AAD = 레코드 id)으로만 저장한다. 키 값은 응답·감사·로그·오류 문구에 싣지 않는다.
// 키가 없으면 적재는 409이고 외부 호출이 0이다. 적재는 자기 잠금(owner+':franchise-benchmark')을 쥐어 같은 적재 중복 실행을 409로 막는다(lib/franchise-server.ts NO_LOCK).
// 기록: benchmark_fetch(적재마다 한 행: 상태·시도 횟수·마지막 활동·실패 원인·원자료 해시), franchise_benchmark(성공한 적재의 선별 행, 30개 이하).
// 모델 경계(DP-10): 모델 경로가 이 모듈에 닿지 않는다(tests/franchise-model-boundary.test.mjs FORBIDDEN). LLM 0. 결과는 COLLECTIVE 휴리스틱 · 법률 자문 아님.
import {ApiError,database,readRecord,listRecords,recordStatement,encrypt,decrypt,acquireLock,releaseLock,stamp} from './server';
import {recordAad} from './credential-crypto';
import {isEnabled} from './feature-flags';
import {toKstDate} from './franchise-rules';
import {GATE_DISCLAIMER} from './franchise-gates';
import {FRANCHISE_ERRORS,type FranchiseErrorKey,type AuditAction} from './franchise';
import {FranchiseRecruitmentError} from './franchise-recruitment-server';
import {ftcFetchPage} from './connectors/ftc-franchise';
import {BENCHMARK_VERSION,BENCHMARK_NOTICE,BENCHMARK_LIMITS,BENCHMARK_DATASET,BENCHMARK_FORMULAS,BENCHMARK_STATUS_LABELS,BENCHMARK_FAILURE_MESSAGES,BENCHMARK_INPUT_MESSAGES,
 readLoadInput,readServiceKey,parseEnvelope,normalizeItem,isCandidate,selectRows,selectionComplete,derivedMetrics,benchmarkRef,
 type BenchmarkLoadInput,type BenchmarkRow,type BenchmarkStatus,type BenchmarkInputCode} from './franchise-benchmark';

type Json=Record<string,unknown>;
type ActorLite={id:string;role:string};
export const BENCHMARK_ACTIONS=['benchmark_key_save','benchmark_key_clear','benchmark_load'] as const;
export type BenchmarkAction=typeof BENCHMARK_ACTIONS[number];
// 스위치가 꺼져도 되는 작업: 키 삭제(보호 방향). 키 저장·적재는 켜져야 한다.
export const BENCHMARK_OFF_EXEMPT:readonly string[]=['benchmark_key_clear'];
// 적재는 외부 호출이 길어 가맹 잠금·영수증 재생을 건너뛰고 자기 잠금과 요청 번호 재생(적재 id bf-<영수증 id>)을 쓴다.
export const BENCHMARK_NO_LOCK:readonly string[]=['benchmark_load'];
export type BenchmarkAuditExtra={recordId?:string;reasonCode?:string;count?:number};
export type BenchmarkPort={commit:(stmts:D1PreparedStatement[],stale:FranchiseErrorKey)=>Promise<unknown>;receipt:(action:AuditAction,result:Json,extra:BenchmarkAuditExtra,target:string|null)=>D1PreparedStatement};
export type BenchmarkArgs={owner:string;brandId:string;now:string;rid:string;actor:ActorLite;input:Json;action:BenchmarkAction;port:BenchmarkPort};
type Outcome={result:Json;extra?:Json};
type Failure={code:string;httpStatus:number|null};
export type FetchRow={id:string;brandId:string;status:BenchmarkStatus;request:BenchmarkLoadInput&{pageSize:number};startedAt:string;finishedAt:string|null;lastActivityAt:string;attempts:number;pages:number;
 failure:Failure|null;rawSha256:string|null;apiModifiedAt:string|null;rowCount:number;scan:{items:number;skipped:number;capped:boolean}|null;by:ActorLite;ruleVersion:string};
export type BenchmarkRecord={id:string;brandId:string;fetchId:string;dataset:string;baseYear:number;performanceYear:number;request:BenchmarkLoadInput;rows:BenchmarkRow[];missing:string[];truncated:boolean;
 rawSha256:string;collectedAt:string;apiModifiedAt:string|null;ruleVersion:string};
type CredentialRow={brandId:string;sealed:string;savedAt:string;savedBy:ActorLite;version:number};
// franchise-server의 오류 응답(franchiseFailure)이 사유 코드·면책을 그대로 싣도록 모집 코드 오류 클래스를 잇는다.
export class FranchiseBenchmarkError extends FranchiseRecruitmentError{}

function fail(key:FranchiseErrorKey):never{const e=FRANCHISE_ERRORS[key];throw new FranchiseBenchmarkError(e.status,e.text)}
const inputError=(code:BenchmarkInputCode)=>new FranchiseBenchmarkError(FRANCHISE_ERRORS.BENCHMARK_INPUT.status,FRANCHISE_ERRORS.BENCHMARK_INPUT.text,{reasons:[{code,message:BENCHMARK_INPUT_MESSAGES[code]}],disclaimer:GATE_DISCLAIMER});
const lockKey=(owner:string)=>owner+':franchise-benchmark';
const credentialAad=(owner:string,brandId:string)=>recordAad(owner,'benchmark_credential',brandId);
const hexOf=(b:ArrayBuffer)=>Array.from(new Uint8Array(b),x=>x.toString(16).padStart(2,'0')).join('');
const sha256Hex=async(s:string)=>hexOf(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)));
async function optionalRecord<T>(owner:string,kind:string,id:string):Promise<T|null>{try{return await readRecord<T>(owner,kind,id)}catch(e){if(e instanceof ApiError&&e.status===404)return null;throw e}}
const fetchStmt=(owner:string,row:FetchRow)=>recordStatement(owner,'benchmark_fetch',row.id,row,row.brandId);
// 재시도 횟수: 쪽마다 첫 시도를 뺀 시도 수. 끝나지 못한 쪽도 첫 시도 1회를 뺀다.
const retriesOf=(r:Pick<FetchRow,'attempts'|'pages'|'status'>)=>Math.max(0,r.attempts-r.pages-(r.status==='success'||r.status==='running'?0:1));
const summaryOf=(r:FetchRow):Json=>({fetchId:r.id,status:r.status,attempts:r.attempts,retries:retriesOf(r),rowCount:r.rowCount,failure:r.failure?{...r.failure,message:BENCHMARK_FAILURE_MESSAGES[r.failure.code]??r.failure.code}:null});
const commonExtra={notice:BENCHMARK_NOTICE,ruleVersion:BENCHMARK_VERSION,disclaimer:GATE_DISCLAIMER};

// ── 작업 ──
export function runBenchmarkAction(x:BenchmarkArgs):Promise<Outcome>{
 switch(x.action){
  case 'benchmark_key_save':return saveKey(x);
  case 'benchmark_key_clear':return clearKey(x);
  case 'benchmark_load':return load(x);
  default:return fail('UNKNOWN_ACTION');
 }
}
async function saveKey(x:BenchmarkArgs):Promise<Outcome>{
 const key=readServiceKey(x.input.apiKey);
 if(!key)fail('BENCHMARK_KEY_INVALID');
 const old=await optionalRecord<CredentialRow>(x.owner,'benchmark_credential',x.brandId);
 const row:CredentialRow={brandId:x.brandId,sealed:await encrypt(key,{aad:credentialAad(x.owner,x.brandId)}),savedAt:x.now,savedBy:{id:x.actor.id,role:x.actor.role},version:(old?.version??0)+1};
 const res={saved:true,version:row.version};
 await x.port.commit([recordStatement(x.owner,'benchmark_credential',x.brandId,row,x.brandId),x.port.receipt('benchmark_key_save',res,{recordId:x.brandId},null)],'STALE');
 return {result:res,extra:{disclaimer:GATE_DISCLAIMER}};
}
async function clearKey(x:BenchmarkArgs):Promise<Outcome>{
 const res={saved:false};
 const del=database().prepare("DELETE FROM records WHERE owner=? AND kind='benchmark_credential' AND id=?").bind(x.owner,`${x.owner}:benchmark_credential:${x.brandId}`);
 await x.port.commit([del,x.port.receipt('benchmark_key_clear',res,{recordId:x.brandId},null)],'STALE');
 return {result:res,extra:{disclaimer:GATE_DISCLAIMER}};
}
async function readKey(owner:string,brandId:string):Promise<string>{
 const row=await optionalRecord<CredentialRow>(owner,'benchmark_credential',brandId);
 if(!row)fail('BENCHMARK_KEY_MISSING');
 try{return await decrypt(row.sealed,credentialAad(owner,brandId))}
 catch(e){if(e instanceof ApiError&&e.status===503)throw e;return fail('BENCHMARK_KEY_UNREADABLE')}
}
async function load(x:BenchmarkArgs):Promise<Outcome>{
 const parsed=readLoadInput(x.input,Number(toKstDate(x.now).slice(0,4)));
 if(!parsed.ok)throw inputError(parsed.code);
 let token='';
 try{token=await acquireLock(lockKey(x.owner))}catch(e){if(e instanceof ApiError&&e.status===409)fail('BENCHMARK_RUNNING');throw e}
 try{
  const fetchId='bf-'+x.rid,prior=await optionalRecord<FetchRow>(x.owner,'benchmark_fetch',fetchId);
  if(prior){if(prior.brandId!==x.brandId)fail('REQUEST_REUSED');return {result:summaryOf(prior),extra:{replayed:true,...commonExtra}}}
  const key=await readKey(x.owner,x.brandId);
  const started:FetchRow={id:fetchId,brandId:x.brandId,status:'running',request:{...parsed.value,pageSize:BENCHMARK_LIMITS.pageSize},startedAt:x.now,finishedAt:null,lastActivityAt:x.now,attempts:0,pages:0,
   failure:null,rawSha256:null,apiModifiedAt:null,rowCount:0,scan:null,by:{id:x.actor.id,role:x.actor.role},ruleVersion:BENCHMARK_VERSION};
  await x.port.commit([fetchStmt(x.owner,started)],'STALE');
  const out=await scan(key,parsed.value),finishedAt=stamp();
  const done:FetchRow={...started,status:out.status,finishedAt,lastActivityAt:finishedAt,attempts:out.attempts,pages:out.pages,failure:out.status==='success'?null:out.failure,
   rawSha256:out.status==='success'?out.rawSha256:null,apiModifiedAt:out.status==='success'?out.apiModifiedAt:null,rowCount:out.status==='success'?out.rows.length:0,scan:{items:out.items,skipped:out.skipped,capped:out.status==='success'&&out.capped}};
  const res=summaryOf(done),stmts=[fetchStmt(x.owner,done)];
  if(out.status==='success'){
   const mark:BenchmarkRecord={id:fetchId,brandId:x.brandId,fetchId,dataset:BENCHMARK_DATASET.key,baseYear:parsed.value.year,performanceYear:parsed.value.year-1,request:parsed.value,rows:out.rows,missing:out.missing,truncated:out.truncated,
    rawSha256:out.rawSha256,collectedAt:finishedAt,apiModifiedAt:out.apiModifiedAt,ruleVersion:BENCHMARK_VERSION};
   stmts.push(recordStatement(x.owner,'franchise_benchmark',fetchId,mark,x.brandId));
  }
  stmts.push(x.port.receipt('benchmark_load',res,{recordId:fetchId,reasonCode:done.status,count:done.rowCount},null));
  await x.port.commit(stmts,'STALE');
  return {result:res,extra:commonExtra};
 }finally{await releaseLock(lockKey(x.owner),token)}
}

// ── 쪽 넘김 적재. 예외를 던지지 않고 결과로 돌려준다(적재 행을 끝낼 수 있게) ──
type Scanned={attempts:number;pages:number;items:number;skipped:number};
type ScanResult=(Scanned&{status:'success';rows:BenchmarkRow[];missing:string[];truncated:boolean;rawSha256:string;apiModifiedAt:string|null;capped:boolean})|(Scanned&{status:'failed'|'blocked'|'timeout';failure:Failure});
async function scan(key:string,input:BenchmarkLoadInput):Promise<ScanResult>{
 const deadlineAt=Date.now()+BENCHMARK_LIMITS.deadlineMs,size=BENCHMARK_LIMITS.pageSize,hashes:string[]=[],candidates:BenchmarkRow[]=[];
 const s:Scanned={attempts:0,pages:0,items:0,skipped:0};
 let apiModifiedAt:string|null=null,capped=false;
 const stop=(status:'failed'|'blocked'|'timeout',code:string,httpStatus:number|null=null):ScanResult=>({...s,status,failure:{code,httpStatus}});
 try{
  for(let pageNo=1;;pageNo++){
   const r=await ftcFetchPage({serviceKey:key,year:input.year,pageNo,numOfRows:size,deadlineAt});
   s.attempts+=r.attempts;
   if(!r.ok)return stop(r.kind,r.code,r.httpStatus);
   s.pages++;hashes.push(await sha256Hex(r.text));apiModifiedAt=apiModifiedAt??r.lastModified;
   const env=parseEnvelope(r.json);
   if(!env.ok)return stop('failed','SCHEMA_MISMATCH');
   let valid=0;
   for(const it of env.value.items){s.items++;const row=normalizeItem(it);if(!row){s.skipped++;continue}valid++;if(isCandidate(row,input))candidates.push(row)}
   if(env.value.items.length&&!valid)return stop('failed','SCHEMA_MISMATCH');
   const last=env.value.items.length<size||(env.value.totalCount!==null&&pageNo*size>=env.value.totalCount);
   if(last||selectionComplete(candidates,input))break;
   if(pageNo>=BENCHMARK_LIMITS.maxPages){capped=true;break}
  }
 }catch{return stop('failed','INTERNAL')}
 return {...s,status:'success',...selectRows(candidates,input),rawSha256:await sha256Hex(hashes.join('\n')),apiModifiedAt,capped};
}

// ── GET 보기 benchmark(모든 역할, 스위치가 꺼져도 읽는다). 키 값·암호문은 싣지 않는다 ──
type Viewer={owner:string;id:string;role:string};
// 마지막 활동 뒤 5분 넘게 '적재 중'이면 멈춘 것으로 보인다(행은 바꾸지 않는다).
const settled=(r:FetchRow,now:string):FetchRow=>r.status==='running'&&Date.parse(now)-Date.parse(r.lastActivityAt)>BENCHMARK_LIMITS.staleMs?{...r,status:'failed',failure:{code:'INTERRUPTED',httpStatus:null}}:r;
const newest=<T extends {id:string}>(at:(x:T)=>string)=>(a:T,b:T)=>Date.parse(at(b))-Date.parse(at(a))||(a.id<b.id?1:-1);
export async function benchmarkView(who:Viewer,brandId:string,now:string):Promise<Json>{
 const owner=who.owner;
 const [enabled,credential,fetchRows,marks]=await Promise.all([isEnabled(owner,'r_franchise'),optionalRecord<CredentialRow>(owner,'benchmark_credential',brandId),
  listRecords<FetchRow>(owner,'benchmark_fetch',brandId),listRecords<BenchmarkRecord>(owner,'franchise_benchmark',brandId)]);
 const fetches=fetchRows.filter(r=>r.brandId===brandId).map(r=>settled(r,now)).sort(newest<FetchRow>(r=>r.startedAt)).slice(0,BENCHMARK_LIMITS.history);
 const blocked=!enabled?{code:'switch_off',message:'기능 스위치 r_franchise가 꺼져 있어 적재할 수 없습니다. 기록은 읽을 수 있습니다.'}
  :!credential?{code:'credential_missing',message:FRANCHISE_ERRORS.BENCHMARK_KEY_MISSING.text}
  :fetches.some(r=>r.status==='running')?{code:'running',message:FRANCHISE_ERRORS.BENCHMARK_RUNNING.text}:null;
 const latest=marks.filter(m=>m.brandId===brandId).sort(newest<BenchmarkRecord>(m=>m.collectedAt))[0]??null;
 return {enabled,role:who.role,notice:BENCHMARK_NOTICE,disclaimer:GATE_DISCLAIMER,dataset:BENCHMARK_DATASET,formulas:BENCHMARK_FORMULAS,statusLabels:BENCHMARK_STATUS_LABELS,
  limits:{brands:BENCHMARK_LIMITS.brands,minRateDenominator:BENCHMARK_LIMITS.minRateDenominator},today:toKstDate(now),
  credential:{saved:!!credential,savedAt:credential?.savedAt??null},readiness:{canLoad:!blocked,blocked},
  fetches:fetches.map(r=>({id:r.id,status:r.status,statusLabel:BENCHMARK_STATUS_LABELS[r.status],request:r.request,startedAt:r.startedAt,finishedAt:r.finishedAt,lastActivityAt:r.lastActivityAt,
   attempts:r.attempts,retries:retriesOf(r),rowCount:r.rowCount,failure:r.failure?{...r.failure,message:BENCHMARK_FAILURE_MESSAGES[r.failure.code]??r.failure.code}:null,by:r.by})),
  latest:latest?{...latest,ref:benchmarkRef(latest.id),rows:latest.rows.map(r=>({...r,derived:derivedMetrics(r)}))}:null,ruleVersion:BENCHMARK_VERSION};
}
