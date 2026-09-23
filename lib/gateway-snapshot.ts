// 게이트웨이 상태 스냅샷(F2b). 운영 HERMES 연결의 GET /v1/capabilities·/v1/toolsets·/v1/models 응답을 정규화해 sha256으로 남긴다.
// 주기: 워커 tick(lib/research-worker.ts)이 부르며 소유자당 UTC 하루 1회다. 마지막 스냅샷(gateway_snapshot 최신 행)의 시각이 오늘(UTC)이면 건너뛴다.
// 정규화: 객체 키 정렬, VOLATILE_FIELDS 이름의 키 제거(모든 깊이), 배열은 정규화한 원소의 JSON 문자열 순으로 정렬. 지운 키 이름은 removedFields에 남긴다.
// 저장: 응답 원문은 저장하지 않는다. 전체·섹션 해시와 섹션 요약(말단 경로 → 값 해시 앞 12자, 섹션당 MAX_PATHS개)만 남긴다. 연결 키·주소는 어디에도 쓰지 않는다.
// 경로에 쓰는 객체 키·배열 라벨도 응답에서 온다. 주소처럼 보이거나 긴 키는 해시 별칭으로, 그런 라벨은 순번으로 바꾼다(unsafeLabel).
// 변경: 직전 passed 스냅샷과 해시가 다르면 gateway_change 1건(바뀐 섹션의 추가·삭제·변경 경로), 같으면 0건. 첫 passed 스냅샷은 기준값만 남긴다.
// 막힘: 세 요청 중 하나라도 실패·타임아웃이면 status blocked(해시 없음, 경보 없음)로 그날 기록한다. 다음 UTC 날짜에 다시 잰다.
// 건너뜀: 연결이 없거나 OpenAI면 기록 없이 건너뛴다(not_run 기록 없음). 절차는 docs/RELIABILITY.ko.md '게이트웨이 상태 스냅샷'.
import {database,configuration,connection,ApiError,type Connection} from './server';
import {hermesRequest} from './hermes';

export const GATEWAY_SECTIONS=['capabilities','toolsets','models'] as const;
export type GatewaySection=typeof GATEWAY_SECTIONS[number];
// 요청마다 바뀌는 값(응답·생성 시각, 요청·추적 번호, 가동 시간). 설정이 같아도 달라지므로 해시에서 뺀다.
export const VOLATILE_FIELDS=['created','created_at','createdAt','updated_at','updatedAt','timestamp','time','now','server_time','serverTime','generated_at','generatedAt','expires_at','expiresAt','request_id','requestId','trace_id','traceId','uptime','uptime_seconds','started_at','startedAt'] as const;
// 호출당 타임아웃. 세 요청은 병렬이라 tick(60초 제한)에 더해지는 시간은 최대 이 값이다.
export const GATEWAY_TIMEOUT_MS=5000;
const MAX_PATHS=200,MAX_LISTED=20,VOLATILE=new Set<string>(VOLATILE_FIELDS);
type Json=null|boolean|number|string|Json[]|{[key:string]:Json};
type SectionPrint={hash:string;paths:Record<string,string>;truncated:boolean};
export type GatewayFingerprint={hash:string;sections:Record<GatewaySection,SectionPrint>;removedFields:string[]};
export type SectionChange={section:GatewaySection;added:string[];removed:string[];changed:string[];truncated:boolean};
export type GatewaySnapshot={id:string;date:string;takenAt:string;basis:'operational';status:'passed'|'blocked';hash:string|null;sections:Record<GatewaySection,SectionPrint>|null;removedFields:string[];durationMs:number;blockedReason?:string};
export type GatewayChange={id:string;detectedAt:string;fromHash:string;toHash:string;fromDate:string;toDate:string;sections:SectionChange[]};
type Capture={ok:true;fingerprint:GatewayFingerprint}|{ok:false;reason:string};

const order=(a:string,b:string)=>a<b?-1:a>b?1:0;
const sha256=async(text:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)))).map(x=>x.toString(16).padStart(2,'0')).join('');
// 순수 함수: 입력을 바꾸지 않고 새 값을 만든다.
export function normalizeGatewayResponse(value:unknown):{value:Json;removed:string[]}{
 if(Array.isArray(value)){
  const items=value.map(normalizeGatewayResponse);
  return {value:items.map(i=>i.value).sort((a,b)=>order(JSON.stringify(a),JSON.stringify(b))),removed:items.flatMap(i=>i.removed)};
 }
 if(value&&typeof value==='object'){
  const entries=Object.entries(value).sort(([a],[b])=>order(a,b)),kept=entries.filter(([k])=>!VOLATILE.has(k)).map(([k,v])=>[k,normalizeGatewayResponse(v)] as const);
  return {value:Object.fromEntries(kept.map(([k,n])=>[k,n.value])),removed:[...entries.filter(([k])=>VOLATILE.has(k)).map(([k])=>k),...kept.flatMap(([,n])=>n.removed)]};
 }
 return {value:typeof value==='string'||typeof value==='boolean'||typeof value==='number'&&Number.isFinite(value)?value:null,removed:[]};
}
// 주소처럼 보이는 문자열: 스킴(://)·사용자(@)·공백, host:port, IPv4, IPv6(::), 마지막 마디가 영문 2자 이상인 점 이은 이름(tools.example.net).
// 모델 id(gpt-4.1-mini·claude-3.5-sonnet)처럼 마지막 마디에 숫자가 있으면 주소로 보지 않는다. 80자를 넘는 값도 경로에 쓰지 않는다.
const ADDRESS=/:\/\/|@|\s|:\d{1,5}(?:[/\]]|$)|\b\d{1,3}(?:\.\d{1,3}){3}\b|::|(?:^|[/[])(?:[a-z0-9-]+\.)+[a-z]{2,}(?=[:/\]]|$)/i;
export const unsafeLabel=(label:string)=>label.length>80||ADDRESS.test(label);
// 배열 원소는 짧은 id·name이 있으면 그 값으로, 없으면 정렬 뒤 순번으로 경로를 만든다. 주소처럼 보이는 값은 경로에 쓰지 않는다.
const itemKey=(item:Json,index:number)=>{
 const o=item&&typeof item==='object'&&!Array.isArray(item)?item:null,label=typeof o?.id==='string'?o.id:typeof o?.name==='string'?o.name:null;
 return label&&!unsafeLabel(label)?label:String(index);
};
// 객체 키가 주소처럼 보이면 원문 대신 '(가림 <키 sha256 앞 8자>)'를 쓴다. 같은 키는 같은 별칭이라 날짜 사이 경로 비교가 유지된다.
const unsafeKeys=(value:Json):string[]=>Array.isArray(value)?value.flatMap(unsafeKeys):value&&typeof value==='object'?Object.entries(value).flatMap(([k,v])=>[...(unsafeLabel(k)?[k]:[]),...unsafeKeys(v)]):[];
async function keyAliases(value:Json){
 return new Map(await Promise.all([...new Set(unsafeKeys(value))].map(async k=>[k,`(가림 ${(await sha256(k)).slice(0,8)})`] as const)));
}
function leaves(value:Json,path:string,aliases:Map<string,string>):[string,Json][]{
 if(Array.isArray(value))return value.length?value.flatMap((item,i)=>leaves(item,`${path}[${itemKey(item,i)}]`,aliases)):[[path,value]];
 if(value&&typeof value==='object'){const entries=Object.entries(value).map(([k,v])=>[aliases.get(k)??k,v] as const);return entries.length?entries.flatMap(([k,v])=>leaves(v,path?`${path}.${k}`:k,aliases)):[[path,value]]}
 return [[path,value]];
}
async function sectionPrint(value:Json):Promise<SectionPrint>{
 const all=leaves(value,'',await keyAliases(value)),kept=all.slice(0,MAX_PATHS);
 const hashes=await Promise.all(kept.map(async([,v])=>(await sha256(JSON.stringify(v))).slice(0,12)));
 return {hash:await sha256(JSON.stringify(value)),paths:Object.fromEntries(kept.map(([p],i)=>[p||'(root)',hashes[i]])),truncated:all.length>kept.length};
}
export async function gatewayFingerprint(responses:Record<GatewaySection,unknown>):Promise<GatewayFingerprint>{
 const normalized=GATEWAY_SECTIONS.map(s=>normalizeGatewayResponse(responses[s]));
 const prints=await Promise.all(normalized.map(n=>sectionPrint(n.value)));
 return {hash:await sha256(JSON.stringify(Object.fromEntries(GATEWAY_SECTIONS.map((s,i)=>[s,normalized[i].value])))),sections:Object.fromEntries(GATEWAY_SECTIONS.map((s,i)=>[s,prints[i]])) as Record<GatewaySection,SectionPrint>,removedFields:[...new Set(normalized.flatMap(n=>n.removed))].sort(order)};
}
// 바뀐 섹션만 경로 단위로 요약한다. 목록은 종류별 MAX_LISTED개까지이며 잘리면 truncated다.
export function diffGatewayFingerprints(previous:Pick<GatewayFingerprint,'sections'>,next:Pick<GatewayFingerprint,'sections'>):SectionChange[]{
 return GATEWAY_SECTIONS.filter(s=>previous.sections[s]?.hash!==next.sections[s].hash).map(section=>{
  const before=previous.sections[section]?.paths||{},after=next.sections[section].paths;
  const added=Object.keys(after).filter(p=>!(p in before)).sort(order),removed=Object.keys(before).filter(p=>!(p in after)).sort(order),changed=Object.keys(after).filter(p=>p in before&&before[p]!==after[p]).sort(order);
  const cut=[added,removed,changed].some(l=>l.length>MAX_LISTED);
  return {section,added:added.slice(0,MAX_LISTED),removed:removed.slice(0,MAX_LISTED),changed:changed.slice(0,MAX_LISTED),truncated:cut||!!previous.sections[section]?.truncated||next.sections[section].truncated};
 });
}
// 세 섹션을 병렬로 읽는다(hermesRequest: 인증 헤더, 리다이렉트 거부, 응답 1MB 한도). 하나라도 실패하면 막힘 사유를 섹션 이름과 함께 돌려준다.
export async function captureGateway(cfg:Pick<Connection,'endpoint'|'key'>,timeoutMs=GATEWAY_TIMEOUT_MS):Promise<Capture>{
 const target:Connection={provider:'hermes',model:'gateway-snapshot',endpoint:cfg.endpoint,key:cfg.key};
 const results=await Promise.allSettled(GATEWAY_SECTIONS.map(s=>hermesRequest(target,'/v1/'+s,{},timeoutMs)));
 const failed=results.map((r,i)=>r.status==='rejected'?`${GATEWAY_SECTIONS[i]}: ${r.reason instanceof ApiError?r.reason.message:'응답을 확인하지 못했습니다.'}`:null).filter(Boolean);
 if(failed.length)return {ok:false,reason:failed.join(' / ').slice(0,500)};
 return {ok:true,fingerprint:await gatewayFingerprint(Object.fromEntries(GATEWAY_SECTIONS.map((s,i)=>[s,(results[i] as PromiseFulfilledResult<unknown>).value])) as Record<GatewaySection,unknown>)};
}

const insert='INSERT OR IGNORE INTO records(id,owner,kind,parent_id,data,updated_at) VALUES(?,?,?,?,?,?)';
async function latest<T>(owner:string,kind:'gateway_snapshot'|'gateway_change',passedOnly=false,limit=1){
 const where=passedOnly?" AND json_extract(data,'$.status')='passed'":'';
 const rows=await database().prepare(`SELECT data FROM records WHERE owner=? AND kind=?${where} ORDER BY updated_at DESC,rowid DESC LIMIT ?`).bind(owner,kind,limit).all<{data:string}>();
 return rows.results.map(r=>JSON.parse(r.data) as T);
}
async function operationalConnection(owner:string){
 if(!(await configuration(owner))?.secret)return null;
 const cfg=await connection(owner);
 return cfg.provider==='hermes'&&cfg.endpoint?cfg:null;
}
function changeOf(previous:GatewaySnapshot|undefined,next:GatewaySnapshot):GatewayChange|null{
 if(!previous?.sections||!previous.hash||!next.sections||!next.hash||previous.hash===next.hash)return null;
 return {id:next.date,detectedAt:next.takenAt,fromHash:previous.hash,toHash:next.hash,fromDate:previous.date,toDate:next.date,sections:diffGatewayFingerprints({sections:previous.sections},{sections:next.sections})};
}
// 반환 status: exists(오늘 이미 기록) · skipped(연결 없음·OpenAI) · passed · blocked. 같은 날짜 id는 INSERT OR IGNORE라 동시 실행에도 하루 1행이다.
export async function recordGatewaySnapshot(owner:string,{now=new Date(),timeoutMs=GATEWAY_TIMEOUT_MS}:{now?:Date;timeoutMs?:number}={}){
 const takenAt=now.toISOString(),date=takenAt.slice(0,10),[last]=await latest<GatewaySnapshot>(owner,'gateway_snapshot');
 if(last&&last.takenAt.slice(0,10)===date)return {status:'exists' as const};
 const cfg=await operationalConnection(owner);
 if(!cfg)return {status:'skipped' as const};
 const started=Date.now(),captured=await captureGateway(cfg,timeoutMs),durationMs=Date.now()-started;
 const snapshot:GatewaySnapshot=captured.ok?{id:date,date,takenAt,basis:'operational',status:'passed',hash:captured.fingerprint.hash,sections:captured.fingerprint.sections,removedFields:captured.fingerprint.removedFields,durationMs}
  :{id:date,date,takenAt,basis:'operational',status:'blocked',hash:null,sections:null,removedFields:[],durationMs,blockedReason:captured.reason};
 const change=captured.ok?changeOf((await latest<GatewaySnapshot>(owner,'gateway_snapshot',true))[0],snapshot):null,db=database();
 await db.batch([
  db.prepare(insert).bind(`${owner}:gateway_snapshot:${date}`,owner,'gateway_snapshot','',JSON.stringify(snapshot),takenAt),
  ...(change?[db.prepare(insert).bind(`${owner}:gateway_change:${change.id}`,owner,'gateway_change','',JSON.stringify(change),takenAt)]:[]),
 ]);
 return {status:snapshot.status,snapshot,change};
}
// 워커 tick용: 어떤 예외도 tick과 다른 작업을 막지 않는다(로그 1줄).
export async function recordGatewaySnapshotSafely(owner:string){
 try{return await recordGatewaySnapshot(owner)}
 catch{console.error('gateway_snapshot_failed');return null}
}
const publicSnapshot=(s:GatewaySnapshot)=>({date:s.date,takenAt:s.takenAt,basis:s.basis,status:s.status,hash:s.hash,durationMs:s.durationMs,blockedReason:s.blockedReason??null,sectionHashes:s.sections?Object.fromEntries(GATEWAY_SECTIONS.map(k=>[k,s.sections![k].hash])):null});
// GET /api/usage 노출: 마지막 스냅샷 상태(섹션 경로 요약은 빼고 해시만)와 최근 변경.
export async function gatewayStatus(owner:string,limit=5){
 const [[last],changes]=await Promise.all([latest<GatewaySnapshot>(owner,'gateway_snapshot'),latest<GatewayChange>(owner,'gateway_change',false,limit)]);
 return {snapshot:last?publicSnapshot(last):null,changes};
}
// 평가 run 시작 기준(F2b-C). operational: 운영 연결의 최신 passed 스냅샷(평가 연결 기준이 아님). eval: 같은 함수로 시작 시점에 잰 평가 연결 해시(기록 행은 만들지 않는다).
export async function gatewayBasis(owner:string,evalConn:Pick<Connection,'endpoint'|'key'>|null,timeoutMs=GATEWAY_TIMEOUT_MS){
 const [[passed],captured]=await Promise.all([latest<GatewaySnapshot>(owner,'gateway_snapshot',true),evalConn?captureGateway(evalConn,timeoutMs):Promise.resolve(null)]);
 return {
  operational:passed?{basis:'operational' as const,date:passed.date,takenAt:passed.takenAt,hash:passed.hash}:null,
  eval:!captured?null:captured.ok?{basis:'eval' as const,status:'passed' as const,hash:captured.fingerprint.hash,sectionHashes:Object.fromEntries(GATEWAY_SECTIONS.map(s=>[s,captured.fingerprint.sections[s].hash]))}:{basis:'eval' as const,status:'blocked' as const,hash:null,blockedReason:captured.reason},
 };
}
