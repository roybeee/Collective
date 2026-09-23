import {emptyPlan,planFields,type PlanKey,type BriefDraft} from './brief';
import { env } from 'cloudflare:workers';
import { brandDefaults, type Campaign, type Brand, type Artifact, type Metric } from './agency';
import {HttpBodyError,readBoundedJson} from './http-limits';
import {authMode,authPrincipal,authOrigin} from './auth-session';
import {AuthError} from './auth-errors';
import {campaignScopes,scopesSql,blockingScopes,campaignJobs,derivedLinks,freezeExperimentSummary,retireRuleOfDeletedCampaign,type SourceCampaignDeleted} from './record-kinds';
import type {LearningRule,ViralExperiment} from './learning';
export class ApiError extends Error {constructor(public status:number,message:string){super(message)}}
export const runtime=env as unknown as {DB?:D1Database;BUCKET?:R2Bucket;AGENCY_ENCRYPTION_KEY?:string;OPENAI_API_KEY?:string;RESEARCH_WORKER_GATE_TOKEN?:string;RESEARCH_WORKER_SITE_ORIGIN?:string;RESEARCH_WORKER_ADMIN_IDS?:string;AI_COPY_CAPTIONS?:string};
export function database(){if(!runtime.DB)throw new ApiError(503,'저장 공간에 연결하지 못했습니다. 잠시 후 다시 시도하세요.');return runtime.DB}
export async function identity(request:Request){if(authMode()==='email'){const principal=await authPrincipal(request);if(!principal)throw new ApiError(401,'로그인이 필요합니다.');return principal.owner;}const id=request.headers.get('oai-authenticated-user-id');if(id&&id.length<=200&&!/[\x00-\x1f\x7f]/.test(id))return id;if(!id&&process.env.NODE_ENV==='development')return 'local-preview';throw new ApiError(401,'로그인이 필요합니다. 페이지를 새로고침해 주세요.')}
// 행위자: 이메일 모드는 세션 계정, legacy는 헤더 id가 곧 소유자다. 소유자도 관리자 권한을 가진다.
export type Actor={owner:string;id:string;email:string|null;role:'owner'|'admin'|'member'};
export async function actor(request:Request):Promise<Actor>{if(authMode()!=='email'){const id=await identity(request);return {owner:id,id,email:null,role:'owner'}}const principal=await authPrincipal(request);if(!principal)throw new ApiError(401,'로그인이 필요합니다.');return {owner:principal.owner,id:principal.id,email:principal.email,role:principal.role}}
export async function requireAdminActor(request:Request):Promise<Actor>{const current=await actor(request);if(current.role==='member')throw new ApiError(403,'관리자만 변경할 수 있습니다.');return current}
export async function requireOwnerActor(request:Request):Promise<Actor>{const current=await actor(request);if(current.role!=='owner')throw new ApiError(403,'소유자만 변경할 수 있습니다.');return current}
export async function requireAdmin(request:Request){return (await requireAdminActor(request)).owner}
export async function isAdmin(request:Request){if(authMode()!=='email')return true;const role=(await authPrincipal(request))?.role;return role==='owner'||role==='admin'}
export function secureMutation(request:Request){const origin=request.headers.get('origin');if(authMode()==='email'?origin!==authOrigin(request):origin&&origin!==new URL(request.url).origin)throw new ApiError(403,'허용되지 않은 요청입니다.')}
export const stamp=()=>new Date().toISOString();
export const uid=()=>crypto.randomUUID();
export function json(data:unknown,status=200){return Response.json(data,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}})}
export function failure(e:unknown){if(e instanceof ApiError||e instanceof AuthError)return json({error:e.message},e.status);console.error('agency_request_failed',e instanceof Error?e.message:'unknown');return json({error:'처리하지 못했습니다. 입력한 내용을 유지한 채 다시 시도해 주세요.'},500)}
export async function body(req:Request){
 try{
  const value=await readBoundedJson<Record<string,any>>(req,200000);
  if(!value||typeof value!=='object'||Array.isArray(value))throw new ApiError(400,'입력 형식을 확인해 주세요.');
  return value;
 }catch(error){if(error instanceof HttpBodyError)throw new ApiError(error.status,error.message);throw error}
}
export function str(value:unknown,label:string,max=10000,required=false){if(typeof value!=='string'||value.length>max||(required&&!value.trim()))throw new ApiError(400,`${label} 입력을 확인해 주세요.`);return value.trim()}
export function num(value:unknown,label:string){if(typeof value!=='number'||!Number.isFinite(value)||value<0||value>1e12)throw new ApiError(400,`${label}은 0 이상의 숫자로 입력해 주세요.`);return value}
export function recordStatement(owner:string,kind:string,id:string,data:unknown,parentId=''){return database().prepare('INSERT INTO records(id,owner,kind,parent_id,data,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data, updated_at=excluded.updated_at WHERE records.owner=excluded.owner').bind(`${owner}:${kind}:${id}`,owner,kind,parentId,JSON.stringify(data),stamp())}
export async function readRecord<T>(owner:string,kind:string,id:string){const row=await database().prepare('SELECT data FROM records WHERE id=? AND owner=? AND kind=?').bind(`${owner}:${kind}:${id}`,owner,kind).first<{data:string}>();if(!row)throw new ApiError(404,'항목을 찾을 수 없습니다.');return JSON.parse(row.data) as T}
export async function listRecords<T>(owner:string,kind:string,parentId?:string){const q=parentId?database().prepare('SELECT data FROM records WHERE owner=? AND kind=? AND parent_id=? ORDER BY updated_at DESC').bind(owner,kind,parentId):database().prepare('SELECT data FROM records WHERE owner=? AND kind=? ORDER BY updated_at DESC').bind(owner,kind);const rows=await q.all<{data:string}>();return rows.results.map(r=>JSON.parse(r.data) as T)}
export type EventActor={id:string;email:string|null};
export function eventStatement(owner:string,campaignId:string,message:string,actor?:EventActor,detail?:Record<string,unknown>){const id=uid();return recordStatement(owner,'event',id,{...detail,id,campaignId,message,createdAt:stamp(),...(actor?{actor:{id:actor.id,email:actor.email}}:{})},campaignId)}
export async function seedBrands(owner:string){const initialCampaign:Campaign={id:'ofd-pilot-01',brandId:'ofd',title:'평일의 도넛 리추얼',goal:'올드페리도넛의 브랜드 매력을 유지하면서 평일 방문과 제품 구매를 늘리는 캠페인을 설계합니다. 상시 할인에 의존하지 않는 구매 이유를 검증합니다.',audience:'매장 인근 직장인과 평일 오후 디저트 고객 (검증할 가설)',channels:'Instagram, 매장 안내, 기존 고객 채널',stores:'파일럿 매장 선정 필요',products:'실제 판매 제품·가격 확인 필요',budget:null,startDate:'',endDate:'',constraints:'기존 로고·캐릭터·컬러 유지. 원가와 매장 운영 여력을 확인하고 실험 범위를 정하기.',sources:'초기 기획 제안 · 대표님과의 AI 마케팅 회사 설계 대화 기반. 실측 고객·매출 자료는 아직 연결되지 않았습니다.',status:'draft',version:1,createdAt:stamp(),updatedAt:stamp()};const rows=brandDefaults.map(b=>database().prepare('INSERT OR IGNORE INTO records(id,owner,kind,parent_id,data,updated_at) VALUES(?,?,?,?,?,?)').bind(`${owner}:brand:${b.id}`,owner,'brand','',JSON.stringify(b),stamp()));rows.push(database().prepare("INSERT OR IGNORE INTO records(id,owner,kind,parent_id,data,updated_at) SELECT ?,?,?,?,?,? WHERE NOT EXISTS (SELECT 1 FROM records WHERE owner=? AND kind='deleted_campaign' AND id=?)").bind(`${owner}:campaign:${initialCampaign.id}`,owner,'campaign','',JSON.stringify(initialCampaign),stamp(),owner,`${owner}:deleted_campaign:${initialCampaign.id}`));await database().batch(rows)}
// 예산: 빈 값은 미확정(null), 명시한 숫자(0 포함)는 확정. 확정 시각(budgetConfirmedAt)을 남겨 기존 '0=미확정' 기록과 구분한다.
export function validateCampaign(v:Record<string,unknown>){const fields=['brandId','title','goal','audience','channels','stores','products','startDate','endDate','constraints','sources'] as const;const out={} as Record<string,string|number|null|undefined>;for(const key of fields)out[key]=str(v[key]??'',key==='title'?'캠페인 이름':key==='goal'?'목표':key,key==='sources'?20000:5000,['brandId','title','goal'].includes(key));for(const date of [out.startDate,out.endDate])if(date&&(!/^\d{4}-\d{2}-\d{2}$/.test(String(date))||!Number.isFinite(Date.parse(String(date)))))throw new ApiError(400,'날짜를 확인해 주세요.');if(out.startDate&&out.endDate&&out.startDate>out.endDate)throw new ApiError(400,'종료일은 시작일 이후여야 합니다.');out.budget=v.budget===null||v.budget===undefined||v.budget===''?null:num(v.budget,'예산');out.budgetConfirmedAt=out.budget===null?undefined:stamp();if(v.storeId)out.storeId=str(v.storeId,'지점',100,true);const plan=emptyPlan();for(const k of Object.keys(planFields) as PlanKey[])plan[k]=str((v.plan as Record<string,unknown>)?.[k]??'',planFields[k],5000);(out as unknown as Record<string,unknown>).plan=plan;return out as unknown as Omit<Campaign,'id'|'status'|'version'|'createdAt'|'updatedAt'>}
async function cryptoKey(){if(!runtime.AGENCY_ENCRYPTION_KEY)throw new ApiError(503,'AI 연결 저장을 준비 중입니다. 관리자에게 문의해 주세요.');return crypto.subtle.importKey('raw',Uint8Array.from(atob(runtime.AGENCY_ENCRYPTION_KEY),c=>c.charCodeAt(0)),{name:'AES-GCM'},false,['encrypt','decrypt'])}
export async function encrypt(value:string){const iv=crypto.getRandomValues(new Uint8Array(12));const bytes=await crypto.subtle.encrypt({name:'AES-GCM',iv},await cryptoKey(),new TextEncoder().encode(value));return btoa(String.fromCharCode(...iv))+'.'+btoa(String.fromCharCode(...new Uint8Array(bytes)))}
export async function decrypt(value:string){const[iv,data]=value.split('.');const plain=await crypto.subtle.decrypt({name:'AES-GCM',iv:Uint8Array.from(atob(iv),c=>c.charCodeAt(0))},await cryptoKey(),Uint8Array.from(atob(data),c=>c.charCodeAt(0)));return new TextDecoder().decode(plain)}
export async function configuration(owner:string){return database().prepare('SELECT secret,model FROM settings WHERE owner=?').bind(owner).first<{secret:string|null;model:string}>()}
export type Connection={provider:'hermes'|'openai';key:string;model:string;endpoint?:string};
export async function connection(owner:string):Promise<Connection>{const c=await configuration(owner);if(!c?.secret)throw new ApiError(409,'연결 및 설정에서 HERMES를 연결해 주세요.');const value=await decrypt(c.secret);if(value.startsWith('{')){const h=JSON.parse(value);if(h.provider==='hermes')return {...h,model:c.model};}return {provider:'openai',key:value,model:c.model}}
export async function publicConnection(owner:string){const c=await configuration(owner);if(!c?.secret)return {configured:false,canConfigure:!!runtime.AGENCY_ENCRYPTION_KEY,provider:'hermes',model:'HERMES',endpoint:''};const cfg=await connection(owner);return {configured:true,canConfigure:!!runtime.AGENCY_ENCRYPTION_KEY,provider:cfg.provider,model:cfg.model,endpoint:cfg.endpoint||''}}


export async function acquireLock(owner:string){const token=uid();const r=await database().prepare('INSERT INTO mutation_locks(owner,token,expires_at) VALUES(?,?,?) ON CONFLICT(owner) DO UPDATE SET token=excluded.token,expires_at=excluded.expires_at WHERE mutation_locks.expires_at < ?').bind(owner,token,Date.now()+120000,Date.now()).run();if(!r.meta.changes)throw new ApiError(409,'다른 작업을 저장하고 있습니다. 잠시 후 다시 시도하세요.');return token}
export async function releaseLock(owner:string,token:string){await database().prepare('DELETE FROM mutation_locks WHERE owner=? AND token=?').bind(owner,token).run()}
// campaignId를 주면 그 캠페인의 작업만 본다. 다른 캠페인이 실행 중이라고 이 캠페인의 승인이 막히면
// 실행을 늘릴수록 사람 게이트가 막힌다. 연결·설정 변경은 전역 검사를 그대로 쓴다.
export async function assertNoActiveJobs(owner:string,campaignId?:string){
 if(!campaignId)await assertNoActiveBriefs(owner);
 const r=campaignId
  ?await database().prepare("SELECT id FROM jobs WHERE owner=? AND campaign_id=? AND status IN ('starting','queued','in_progress','uncertain') LIMIT 1").bind(owner,campaignId).first()
  :await database().prepare("SELECT id FROM jobs WHERE owner=? AND status IN ('starting','queued','in_progress','uncertain') LIMIT 1").bind(owner).first();
 if(r)throw new ApiError(409,'AI 작업이 진행 중입니다. 결과를 확인하거나 연결된 작업을 취소한 후 변경해 주세요.')}

export async function assertNoActiveBriefs(owner:string){const drafts=await listRecords<BriefDraft>(owner,'brief_draft');if(drafts.some(d=>['starting','queued','in_progress','uncertain'].includes(d.status)))throw new ApiError(409,'HERMES 초안을 작성 중입니다. 초안을 확인하거나 중지한 뒤 연결을 변경해 주세요.')}

// 캠페인 삭제를 막는 사유(없으면 null). 삭제와 삭제 영향 조회가 같은 판정을 쓴다. 보호 대상 kind는 lib/record-kinds.ts의 blocksDeletion이다.
async function campaignDeletionBlock(owner:string,id:string){
 const db=database(),blocking=scopesSql('SELECT id',owner,blockingScopes(owner,id));
 if(await db.prepare(blocking.sql+' LIMIT 1').bind(...blocking.binds).first())return '제작·발행 또는 주문 귀속 이력이 있어 삭제할 수 없습니다. 실행 기록을 보존하고 예약 취소는 Buffer에서 확인하세요.';
 const running=await db.prepare(`SELECT id FROM jobs WHERE owner=? AND ${campaignJobs.where} AND status IN ('starting','queued','in_progress','uncertain') LIMIT 1`).bind(owner,...campaignJobs.binds(owner,id)).first();
 if(running)return '진행 중인 AI 작업이 있습니다. 캠페인의 AI 팀에서 작업을 완료하거나 취소한 뒤 삭제해 주세요.';
 const drafts=(await listRecords<BriefDraft>(owner,'brief_draft')).filter(d=>d.campaignId===id||d.savedCampaignId===id);
 if(drafts.some(d=>['starting','queued','in_progress','uncertain'].includes(d.status)))return '이 캠페인의 HERMES 초안을 작성 중입니다. 초안을 완료하거나 중지한 뒤 삭제해 주세요.';
 return null;
}
// 결정 7(b): 캠페인 실험에서 나온 바이럴 규칙(retire_and_mark)과, 그 규칙을 낳은 실험. 점포 출처 규칙은 조건에서 빠진다.
async function retainedLearning(owner:string,id:string){
 const q=scopesSql('SELECT data',owner,campaignScopes('retire_and_mark',owner,id));
 const rules=(await database().prepare(q.sql).bind(...q.binds).all<{data:string}>()).results.map(r=>JSON.parse(r.data) as LearningRule);
 const sources=(await listRecords<ViralExperiment>(owner,'viral_experiment',id)).filter(e=>rules.some(r=>r.experimentId===e.id));
 return {rules,sources};
}
function retainedLearningWrites(owner:string,{rules,sources}:Awaited<ReturnType<typeof retainedLearning>>,mark:SourceCampaignDeleted){
 return [
  ...rules.map(r=>recordStatement(owner,'learning_rule',r.id,retireRuleOfDeletedCampaign(r,mark),r.brandId)),
  ...sources.map(e=>recordStatement(owner,'viral_experiment_summary',e.id,freezeExperimentSummary(e,rules.filter(r=>r.experimentId===e.id).map(r=>r.id),mark),e.brandId)),
 ];
}
async function countByKind(owner:string,policy:'delete'|'retain',id:string){
 const q=scopesSql('SELECT kind,COUNT(*) AS n',owner,campaignScopes(policy,owner,id));
 const rows=await database().prepare(q.sql+' GROUP BY kind').bind(...q.binds).all<{kind:string;n:number}>();
 return Object.fromEntries(rows.results.map(r=>[r.kind,Number(r.n)])) as Record<string,number>;
}
const total=(counts:Record<string,number>)=>Object.values(counts).reduce((sum,n)=>sum+n,0);
// 삭제 전 영향 조회. kind별 삭제·보존 건수와 삭제 가능 여부를 돌려주며 아무것도 쓰지 않는다.
export async function campaignDeletionPreview(owner:string,id:string){
 const campaign=await readRecord<Campaign>(owner,'campaign',id);
 const [deleted,linked,learning,jobs,blockedReason]=await Promise.all([countByKind(owner,'delete',id),countByKind(owner,'retain',id),retainedLearning(owner,id),database().prepare(`SELECT COUNT(*) AS n FROM jobs WHERE owner=? AND ${campaignJobs.where}`).bind(owner,...campaignJobs.binds(owner,id)).first<{n:number}>(),campaignDeletionBlock(owner,id)]);
 const retained={...linked,...(learning.rules.length?{learning_rule:learning.rules.length}:{}),...(learning.sources.length?{viral_experiment_summary:learning.sources.length}:{})};
 return {campaignId:id,version:campaign.version,deletable:!blockedReason,blockedReason,deleted,retained,jobs:Number(jobs?.n||0),totals:{deleted:total(deleted),retained:total(retained)}};
}

// Called under the same owner mutation lock used by campaign edits and AI jobs.
// 삭제 대상은 lib/record-kinds.ts의 정책에서 만든다. 순서: 규칙 종료 표시·요약 동결 → 초안·작업·실험을 참조하는 레코드 → 작업(jobs, 실험 참조) → 직접 연결 레코드와 캠페인.
export async function deleteCampaign(owner:string,input:Record<string,unknown>,by?:EventActor){
 const id=str(input.id,'캠페인',100,true);
 if(input.confirmed!==true)throw new ApiError(400,'삭제 내용을 확인해 주세요.');
 const db=database();
 const deleted=await db.prepare("SELECT id FROM records WHERE owner=? AND kind='deleted_campaign' AND id=?").bind(owner,`${owner}:deleted_campaign:${id}`).first();
 if(deleted)return {id,deleted:true};
 const campaign=await readRecord<Campaign>(owner,'campaign',id);
 if(input.version!==campaign.version)throw new ApiError(409,'캠페인이 변경됐습니다. 최신 내용을 확인한 뒤 다시 삭제해 주세요.');
 const blocked=await campaignDeletionBlock(owner,id);
 if(blocked)throw new ApiError(409,blocked);
 const mark:SourceCampaignDeleted={at:stamp(),by:by?{id:by.id,email:by.email}:null};
 const scopes=campaignScopes('delete',owner,id),remove=(derived:boolean)=>scopes.filter(s=>derivedLinks.has(s.link)===derived).map(s=>scopesSql('DELETE',owner,[s])).map(q=>db.prepare(q.sql).bind(...q.binds));
 await db.batch([
  ...retainedLearningWrites(owner,await retainedLearning(owner,id),mark),
  ...remove(true),
  db.prepare(`DELETE FROM jobs WHERE owner=? AND ${campaignJobs.where}`).bind(owner,...campaignJobs.binds(owner,id)),
  ...remove(false),
  // A minimal tombstone prevents starter reseeding and makes lost-response retries safe.
  recordStatement(owner,'deleted_campaign',id,{id,deletedAt:mark.at,...(by?{deletedBy:{id:by.id,email:by.email}}:{})}),
 ]);
 return {id,deleted:true};
}
