import {ApiError,acquireLock,database,releaseLock,stamp,str,type Actor} from '../server';
import {storefrontDigest} from '../storefront-orders';
import {acquireResearchLock,optional,putStatement,releaseResearchLock,researchLockKey} from './server-store';
import {inheritRetention,retentionEntry,researchRetentionInventory,type Entry} from './server-retention';
import type {ExternalDeletionEvidence,RetentionPlan,RetentionReceipt,RetentionSettings} from './retention-types';
import {SOURCE_POLICY_VERSION} from './source-policy';

const kinds={settings:'pr_retention_settings',plan:'pr_retention_plan',receipt:'pr_retention_receipt',external:'pr_retention_external'} as const;
const PLAN_TTL=10*60000,DAY=86400000,MAX_SCOPE_BYTES=700000,MAX_SCOPE_ROWS=2000;
const SAFE=new Set(['pr_snapshot','pr_quarantine','pr_score','pr_brief','pr_keyword_group','pr_backtest']);
type ScopeRow={id:string;kind:string;parent_id:string;data:string;updated_at:string};
type StoredPlan=RetentionPlan&{scopeDigest:string;targetIds:string[]};
type Locks={owner:string;research:string};
const publicPlan=({scopeDigest:_scope,targetIds:_ids,...plan}:StoredPlan):RetentionPlan=>{void _scope;void _ids;return plan};
const settings=(owner:string)=>optional<RetentionSettings>(owner,kinds.settings,'current');
async function locked<T>(owner:string,fn:(locks:Locks)=>Promise<T>):Promise<T>{
 const outer=await acquireLock(owner);let inner='';
 try{inner=await acquireResearchLock(owner,0);return await fn({owner:outer,research:inner})}
 finally{if(inner)await releaseResearchLock(owner,inner);await releaseLock(owner,outer)}
}
async function scope(owner:string):Promise<{rows:ScopeRow[];complete:boolean}>{
 const result=await database().prepare("SELECT id,kind,parent_id,CASE WHEN SUM(length(CAST(data AS BLOB))) OVER (ORDER BY id)<=? THEN data ELSE NULL END data,updated_at FROM records WHERE owner=? AND substr(kind,1,13)!='pr_retention_' ORDER BY id LIMIT ?").bind(MAX_SCOPE_BYTES,owner,MAX_SCOPE_ROWS+1).all<ScopeRow>();
 const rows=result.results??[];
 return {rows,complete:(Reflect.get(result,'success') as unknown)!==false&&Array.isArray(result.results)&&rows.length<=MAX_SCOPE_ROWS&&rows.every(r=>typeof r.data==='string')&&new TextEncoder().encode(JSON.stringify(rows)).length<=MAX_SCOPE_BYTES};
}
function inspect(rows:ScopeRow[],now:number){
 const entries=rows.filter(r=>r.kind.startsWith('pr_')||r.kind.startsWith('growth_')||r.kind==='hermes_submission').map(r=>retentionEntry({...r,bytes:new TextEncoder().encode(r.data).length},now));
 const complete=entries.every(e=>e.valid)&&inheritRetention(entries),youtube=entries.filter(e=>e.youtube);
 const invalid=youtube.some(e=>e.invalidTime||!e.times.size),targets=youtube.filter(e=>[...e.times].some(t=>now-t>=30*DAY));
 const reasons:string[]=[];
 if(!complete)reasons.push('참조 누락 또는 해석할 수 없는 기록이 있어 삭제 범위를 확정할 수 없습니다.');
 if(invalid)reasons.push('YouTube 자료의 수집 시각이 없거나 잘못되어 삭제를 보류합니다.');
 if(targets.some(e=>!SAFE.has(e.row.kind)))reasons.push('사업·승인·작업 이력 또는 혼합 자료가 연결되어 자동으로 삭제할 수 없습니다.');
 if(entries.some(e=>e.row.kind==='pr_request'&&JSON.parse(e.row.data!).status==='pending'))reasons.push('진행 중인 상품 리서치 작업이 있어 삭제를 보류합니다.');
 // Unknown consumers are held rather than deleted. Match complete JSON string values, never a substring of an identifier.
 const ids=new Set(targets.flatMap(e=>[...e.aliases]));
 for(const row of rows){if(targets.some(e=>e.row.id===row.id))continue;if(mentions(row.data,ids))reasons.push('삭제 대상을 참조하는 보존 기록이 있어 삭제를 보류합니다.');}
 return {targets,reasons:[...new Set(reasons)],externalDeletion:youtube.some(e=>e.row.kind==='hermes_submission')?'unverified' as const:'not_applicable' as const};
}
function mentions(data:string,ids:Set<string>):boolean{
 let visits=0;
 const walk=(value:unknown,depth:number):boolean=>{
  if(++visits>20000||depth>20)return true;
  if(typeof value==='string'){if(ids.has(value)||ids.has(value.split('#')[0]))return true;if(/^\s*[\[{]/.test(value)){try{return walk(JSON.parse(value),depth+1)}catch{return true}}return false}
  if(Array.isArray(value))return value.some(v=>walk(v,depth+1));
  return !!value&&typeof value==='object'&&Object.values(value).some(v=>walk(v,depth+1));
 };
 try{return walk(JSON.parse(data),0)}catch{return true}
}
async function preview(owner:string,now:Date):Promise<StoredPlan>{
 const read=await scope(owner),analysis=read.complete?inspect(read.rows,now.getTime()):{targets:[] as Entry[],reasons:['조회 한도를 넘거나 저장 자료를 읽지 못해 삭제를 보류합니다.'],externalDeletion:'unverified' as const};
 const counts=new Map<string,number>();for(const e of analysis.targets)counts.set(e.row.kind,(counts.get(e.row.kind)??0)+1);
 const core={id:crypto.randomUUID(),policyVersion:SOURCE_POLICY_VERSION,createdAt:now.toISOString(),expiresAt:new Date(now.getTime()+PLAN_TTL).toISOString(),scopeDigest:await storefrontDigest(read.rows),targetIds:analysis.targets.map(e=>e.row.id).sort(),counts:[...counts].sort().map(([kind,records])=>({kind,records})),total:analysis.targets.length,heldReasons:analysis.reasons,externalDeletion:analysis.externalDeletion};
 const plan:StoredPlan={...core,status:analysis.reasons.length?'held':'ready',digest:await storefrontDigest(core)};
 await putStatement(owner,kinds.plan,'current',plan).run();return plan;
}
async function apply(owner:string,input:Record<string,unknown>,locks:Locks,mode:RetentionReceipt['mode'],now:Date){
 const planId=str(input.planId,'정리 계획',100,true),digest=str(input.digest,'정리 계획 해시',64,true);
 if(input.confirmed!==true)throw new ApiError(400,'삭제 계획을 명시적으로 확인해 주세요.');
 const prior=await optional<RetentionReceipt>(owner,kinds.receipt,planId);
 if(prior){if(prior.digest!==digest)throw new ApiError(409,'삭제 계획이 변경됐습니다.');return prior}
 const plan=await optional<StoredPlan>(owner,kinds.plan,'current');
 if(!plan||plan.id!==planId||plan.digest!==digest||plan.status!=='ready')throw new ApiError(409,'실행 가능한 최신 삭제 계획을 다시 확인해 주세요.');
 if(!Number.isFinite(Date.parse(plan.expiresAt))||!Number.isFinite(Date.parse(plan.createdAt))||Date.parse(plan.expiresAt)<=now.getTime()||Date.parse(plan.createdAt)>now.getTime()||Reflect.get(plan,'policyVersion')!==SOURCE_POLICY_VERSION)throw new ApiError(409,'삭제 계획이 만료됐습니다. 다시 미리보기를 확인하세요.');
 const read=await scope(owner);
 if(!read.complete||await storefrontDigest(read.rows)!==plan.scopeDigest)throw new ApiError(409,'삭제 범위가 변경됐습니다. 다시 미리보기를 확인하세요.');
 const current=inspect(read.rows,now.getTime());
 if(current.reasons.length||JSON.stringify(current.targets.map(e=>e.row.id).sort())!==JSON.stringify(plan.targetIds))throw new ApiError(409,'삭제 조건이 변경됐습니다. 다시 확인하세요.');
 const receipt:RetentionReceipt={id:planId,planId,digest,at:now.toISOString(),deleted:plan.targetIds.length,mode,externalDeletion:plan.externalDeletion};
 const db=database(),manifest=JSON.stringify(read.rows);
 // First statement is an assertion inside D1's atomic batch: NULL data violates records NOT NULL and rolls every statement back.
 const guard=db.prepare(`INSERT INTO records(id,owner,kind,parent_id,data,updated_at) VALUES(?,?,?,'',CASE WHEN
 (SELECT COUNT(*) FROM records WHERE owner=? AND substr(kind,1,13)!='pr_retention_')=?
 AND NOT EXISTS(SELECT 1 FROM records r LEFT JOIN json_each(?) e ON r.id=json_extract(e.value,'$.id') WHERE r.owner=? AND substr(r.kind,1,13)!='pr_retention_' AND (e.value IS NULL OR r.kind!=json_extract(e.value,'$.kind') OR r.parent_id!=json_extract(e.value,'$.parent_id') OR r.data!=json_extract(e.value,'$.data') OR r.updated_at!=json_extract(e.value,'$.updated_at')))
 AND EXISTS(SELECT 1 FROM mutation_locks WHERE owner=? AND token=? AND expires_at>(julianday('now')-2440587.5)*86400000)
 AND EXISTS(SELECT 1 FROM mutation_locks WHERE owner=? AND token=? AND expires_at>(julianday('now')-2440587.5)*86400000)
 THEN ? ELSE NULL END,?)`).bind(`${owner}:${kinds.receipt}:${planId}`,owner,kinds.receipt,owner,read.rows.length,manifest,owner,owner,locks.owner,researchLockKey(owner),locks.research,JSON.stringify(receipt),now.toISOString());
 try{await db.batch([guard,db.prepare('DELETE FROM records WHERE owner=? AND id IN (SELECT value FROM json_each(?))').bind(owner,JSON.stringify(plan.targetIds)),putStatement(owner,kinds.plan,'current',{...plan,status:'applied'})])}
 catch{throw new ApiError(409,'삭제 범위 또는 잠금이 변경되어 이번 삭제는 적용하지 않았습니다.')}
 return receipt;
}
export async function retentionView(owner:string){
 const [inventory,saved,plan,receipts,externalEvidence]=await Promise.all([researchRetentionInventory(owner),settings(owner),optional<StoredPlan>(owner,kinds.plan,'current'),list<RetentionReceipt>(owner,'receipt'),list<ExternalDeletionEvidence>(owner,'external')]);
 return {inventory,settings:saved??{automaticEnabled:false,updatedAt:null},latestPlan:plan?publicPlan(plan):null,receipts,externalEvidence};
}
async function list<T>(owner:string,kind:'receipt'|'external'):Promise<T[]>{const result=await database().prepare('SELECT data FROM records WHERE owner=? AND kind=? ORDER BY updated_at DESC,id DESC LIMIT 30').bind(owner,kinds[kind]).all<{data:string}>();return result.results.map(r=>JSON.parse(r.data) as T)}
export async function retentionAction(who:Actor,input:Record<string,unknown>){
 if(who.role!=='owner')throw new ApiError(403,'소유자만 보존 정리를 변경할 수 있습니다.');
 return locked(who.owner,async locks=>{
  if(input.action==='preview')return publicPlan(await preview(who.owner,new Date()));
  if(input.action==='apply')return apply(who.owner,input,locks,'manual',new Date());
  if(input.action==='configure'){
   if(typeof input.automaticEnabled!=='boolean'||input.confirmed!==true)throw new ApiError(400,'자동 정리 설정을 명시적으로 확인해 주세요.');
   const next:RetentionSettings={automaticEnabled:input.automaticEnabled,updatedAt:stamp(),confirmedBy:who.id,confirmationVersion:SOURCE_POLICY_VERSION};await putStatement(who.owner,kinds.settings,'current',next).run();return next;
  }
  if(input.action==='record_external_evidence'){
   if(input.confirmed!==true)throw new ApiError(400,'운영자가 제출하는 증빙임을 확인해 주세요.');
   const next:ExternalDeletionEvidence={id:crypto.randomUUID(),reference:str(input.reference,'외부 삭제 증빙 참조',500,true),note:str(input.note,'증빙 설명',1000,true),at:stamp(),recordedBy:who.id,verification:'operator_attested'};
   await putStatement(who.owner,kinds.external,next.id,next).run();return next;
  }
  throw new ApiError(400,'지원하지 않는 보존 정리 작업입니다.');
 });
}
export async function runRetentionQueue(owner:string):Promise<{status:'idle'|'processed'}>{
 const configured=await settings(owner),today=stamp().slice(0,10);
 if(!authorizedAutomatic(configured)||configured.lastAutomaticDay===today)return {status:'idle'};
 try{return await locked(owner,async locks=>{
  const current=await settings(owner);
  if(!authorizedAutomatic(current)||current.lastAutomaticDay===today)return {status:'idle' as const};
  const plan=await preview(owner,new Date());
  await putStatement(owner,kinds.settings,'current',{...current,lastAutomaticDay:today}).run();
  if(plan.status!=='ready'||!plan.total)return {status:'idle' as const};
  await apply(owner,{planId:plan.id,digest:plan.digest,confirmed:true},locks,'automatic',new Date());return {status:'processed' as const};
 })}catch(e){if(e instanceof ApiError&&e.status===409)return {status:'idle'};throw e}
}
function authorizedAutomatic(value:RetentionSettings|null):value is RetentionSettings{return value?.automaticEnabled===true&&!!value.confirmedBy&&value.confirmationVersion===SOURCE_POLICY_VERSION}
export async function automaticRetentionEnabled(owner:string):Promise<boolean>{try{return authorizedAutomatic(await settings(owner))}catch{return false}}
