// G7 서버 권한 가드. 행위자(lib/server.ts actor)에 멤버십(records kind 'membership', id `${owner}:membership:${userId}`)을 얹어 lib/access.ts 표로 판단한다.
// 멤버십은 이메일 모드의 직원(member) 계정에만 얹는다. 대표·관리자·legacy 헤더 사용자는 멤버십을 읽지 않고 기존 역할 그대로다.
// 범위 없는 역할은 자원을 읽지 않고 역할만으로 판단하고, 거절 문구도 기존 requireAdminActor·requireOwnerActor와 같다(상태·순서 불변).
// 기능 스위치 scoped_roles는 새 역할의 배정만 막는다. 이미 배정된 범위는 스위치와 무관하게 계속 적용한다(끄면 범위가 풀려 넓어지지 않게).
import {ApiError,actor,database,type Actor} from './server';
import {authMode} from './auth-session';
import {can,isScoped,principalOfMembership,roleOnly,type AccessAction,type AccessPrincipal,type AccessResource} from './access';

export type Access={actor:Actor;principal:AccessPrincipal};
export const SCOPE_DENIED='배정된 브랜드·지점 밖이거나 이 역할로 할 수 없는 작업입니다. 대표나 관리자에게 범위를 요청하세요.';
const membershipId=(owner:string,userId:string)=>`${owner}:membership:${userId}`;
const parse=(text:string):unknown=>{try{return JSON.parse(text)}catch{return null}};

export async function membershipPrincipal(owner:string,userId:string):Promise<AccessPrincipal|null>{
 const row=await database().prepare("SELECT data FROM records WHERE id=? AND owner=? AND kind='membership'").bind(membershipId(owner,userId),owner).first<{data:string}>();
 return row?principalOfMembership(parse(row.data)):null;
}
async function load(req:Request):Promise<Access>{
 const who=await actor(req),base:AccessPrincipal={role:who.role,brandIds:[],storeIds:[]};
 if(who.role!=='member'||authMode()!=='email')return {actor:who,principal:base};
 return {actor:who,principal:(await membershipPrincipal(who.owner,who.id))??base};
}
// 한 요청 안에서 여러 가드가 같은 판단을 쓰도록 요청 객체별로 한 번만 읽는다.
const cache=new WeakMap<Request,Promise<Access>>();
export function accessOf(req:Request):Promise<Access>{
 const known=cache.get(req);if(known)return known;
 const next=load(req);cache.set(req,next);next.catch(()=>cache.delete(req));return next;
}
function denied(principal:AccessPrincipal,action:AccessAction){
 if(isScoped(principal))return new ApiError(403,SCOPE_DENIED);
 return new ApiError(403,action==='manage_flags'?'소유자만 변경할 수 있습니다.':'관리자만 변경할 수 있습니다.');
}
export type ResourceInput=AccessResource|(()=>Promise<AccessResource>);
// 자원은 범위 판단이 필요할 때만(범위 역할) 읽는다. 함수로 넘기면 그때 호출한다.
export async function requireAccess(req:Request,action:AccessAction,resource:ResourceInput={}):Promise<Access>{
 const access=await accessOf(req),{principal}=access;
 if(roleOnly(principal,action)){if(can(principal,action))return access;throw denied(principal,action)}
 const target=typeof resource==='function'?await resource():resource;
 if(can(principal,action,target))return access;
 throw denied(principal,action);
}

// 자원 해석. 없는 항목은 빈 자원으로 돌려 범위 역할에는 403이 된다(다른 브랜드 항목의 존재를 404로 드러내지 않는다).
async function recordData(owner:string,kind:string,id:unknown):Promise<Record<string,unknown>|null>{
 if(typeof id!=='string'||!id||id.length>200)return null;
 const row=await database().prepare('SELECT data FROM records WHERE id=? AND owner=? AND kind=?').bind(`${owner}:${kind}:${id}`,owner,kind).first<{data:string}>();
 const data=row?parse(row.data):null;
 return data&&typeof data==='object'?data as Record<string,unknown>:null;
}
const text=(value:unknown)=>typeof value==='string'&&value?value:null;
export async function campaignResource(owner:string,campaignId:unknown):Promise<AccessResource>{
 const c=await recordData(owner,'campaign',campaignId);
 return c?{brandId:text(c.brandId),storeId:text(c.storeId),campaignId:text(c.id)}:{};
}
export async function artifactResource(owner:string,artifactId:unknown):Promise<AccessResource>{
 const a=await recordData(owner,'artifact',artifactId);
 return a?campaignResource(owner,a.campaignId):{};
}
export async function storeResource(owner:string,storeId:unknown):Promise<AccessResource>{
 const s=await recordData(owner,'store',storeId);
 return s?{brandId:text(s.brandId),storeId:text(s.id)}:{};
}
export async function placeDraftResource(owner:string,draftId:unknown):Promise<AccessResource>{
 const d=await recordData(owner,'place_draft',draftId);
 return d?storeResource(owner,d.storeId):{};
}

// 워크스페이스 화면 거르기(순수). 범위 역할은 볼 수 있는 캠페인에 이어진 항목만 받는다. 범위 없는 역할은 입력 그대로다.
type WithCampaign={campaignId?:unknown};
export type WorkspaceLists={brands:readonly {id?:unknown}[];campaigns:readonly {id?:unknown;brandId?:string;storeId?:string|null}[];artifacts:readonly WithCampaign[];metrics:readonly WithCampaign[];events:readonly WithCampaign[];runs:readonly WithCampaign[];sequences:readonly WithCampaign[];meetings:readonly WithCampaign[];publications:readonly WithCampaign[]};
export function scopeWorkspace<T extends WorkspaceLists>(principal:AccessPrincipal,lists:T):T{
 if(!isScoped(principal))return lists;
 const campaigns=lists.campaigns.filter(c=>can(principal,'read_campaign',{brandId:c.brandId??null,storeId:c.storeId??null}));
 const ids=new Set(campaigns.map(c=>c.id)),keep=<R extends WithCampaign>(rows:readonly R[])=>rows.filter(r=>ids.has(r.campaignId));
 return {...lists,brands:lists.brands.filter(b=>typeof b.id==='string'&&principal.brandIds.includes(b.id)),campaigns,artifacts:keep(lists.artifacts),metrics:keep(lists.metrics),events:keep(lists.events),runs:keep(lists.runs),sequences:keep(lists.sequences),meetings:keep(lists.meetings),publications:keep(lists.publications)} as T;
}
// 브랜드만 가진 항목(브리프 초안 등)을 배정 브랜드로 거른다. 범위 없는 역할은 입력 그대로다.
export const scopeByBrand=<R extends {brandId?:unknown}>(principal:AccessPrincipal,rows:readonly R[]):readonly R[]=>isScoped(principal)?rows.filter(r=>typeof r.brandId==='string'&&principal.brandIds.includes(r.brandId)):rows;
// 화면에 알려 줄 범위(범위 역할만). 범위 없는 역할은 null이다.
export const accessSummary=(principal:AccessPrincipal)=>isScoped(principal)?{role:principal.role,brandIds:[...principal.brandIds],storeIds:[...principal.storeIds]}:null;
// 응답 마무리: 범위 역할에는 워크스페이스 전체 항목(가맹 모집 할 일)을 빼고 access(역할·브랜드·지점)를 더한다. 범위 없는 역할은 같은 객체를 돌려준다.
const WORKSPACE_WIDE_KEYS:readonly string[]=['franchiseTasks'];
export function scopePayload<T extends Record<string,unknown>>(principal:AccessPrincipal,payload:T):T{
 if(!isScoped(principal))return payload;
 return {...Object.fromEntries(Object.entries(payload).filter(([key])=>!WORKSPACE_WIDE_KEYS.includes(key))),access:accessSummary(principal)} as unknown as T;
}

// ── 조회 가드(경로별 범위 가드, docs/ROLES.ko.md '경로별 범위 가드') ──
// 모두 범위 없는 역할(대표·관리자·직원·legacy)에는 자원을 읽지 않고 통과한다(requireAccess의 roleOnly). 응답·상태·순서는 이전과 같다.
// 범위 역할은 자원을 읽어 배정 밖이거나 없는 항목이면 403 SCOPE_DENIED다(다른 브랜드 항목의 존재를 404로 드러내지 않는다).
const ownerOf=async(req:Request)=>(await accessOf(req)).actor.owner;
export async function requireCampaignRead(req:Request,campaignId:unknown):Promise<Access>{
 return requireAccess(req,'read_campaign',async()=>campaignResource(await ownerOf(req),campaignId));
}
export async function requireArtifactRead(req:Request,artifactId:unknown):Promise<Access>{
 return requireAccess(req,'read_campaign',async()=>artifactResource(await ownerOf(req),artifactId));
}
export async function requireBrandRead(req:Request,brandId:unknown):Promise<Access>{
 return requireAccess(req,'read_campaign',{brandId:text(brandId)});
}
// 캠페인에 이어진 기록(소재·발행 등, data.campaignId)의 캠페인으로 판단한다.
export async function requireLinkedCampaignRead(req:Request,kind:string,id:unknown):Promise<Access>{
 return requireAccess(req,'read_campaign',async()=>{const owner=await ownerOf(req),d=await recordData(owner,kind,id);return d?campaignResource(owner,d.campaignId):{}});
}
// 브랜드에 이어진 기록(브랜드 자료 등, data.brandId)의 브랜드로 판단한다.
export async function requireLinkedBrandRead(req:Request,kind:string,id:unknown):Promise<Access>{
 return requireAccess(req,'read_campaign',async()=>{const d=await recordData(await ownerOf(req),kind,id);return d?{brandId:text(d.brandId)}:{}});
}
// 지점 운영 자료(장부·진단·점검·주문·수신 연결): 브랜드 매니저는 브랜드, 점포 매니저는 배정 지점, 검토자는 지점을 배정받았을 때만 읽는다.
export function canReadStore(principal:AccessPrincipal,resource:AccessResource):boolean{
 if(!isScoped(principal))return true;
 if(!can(principal,'read_campaign',resource))return false;
 return principal.role!=='reviewer'||(typeof resource.storeId==='string'&&principal.storeIds.includes(resource.storeId));
}
export async function requireStoreRead(req:Request,storeId:unknown):Promise<Access>{
 const access=await accessOf(req);
 if(!isScoped(access.principal))return requireAccess(req,'read_campaign');
 const target=await storeResource(access.actor.owner,storeId);
 if(target.storeId&&canReadStore(access.principal,target))return access;
 throw new ApiError(403,SCOPE_DENIED);
}
// 브랜드를 가로지르는 워크스페이스 집계(학습·예약 실행·가맹 모집 등): 범위 역할에는 403, 범위 없는 역할은 그대로다.
export async function denyScoped(req:Request):Promise<Access>{
 const access=await accessOf(req);
 if(isScoped(access.principal))throw new ApiError(403,SCOPE_DENIED);
 return access;
}
// 목록 거르기. 범위 없는 역할은 null(거르지 않음)을 돌려 호출자가 입력을 그대로 쓴다.
export type CampaignLike={id?:unknown;brandId?:unknown;storeId?:unknown};
export const canReadCampaign=(principal:AccessPrincipal,c:CampaignLike)=>can(principal,'read_campaign',{brandId:text(c.brandId),storeId:text(c.storeId)});
export async function readableCampaigns(req:Request):Promise<((c:CampaignLike)=>boolean)|null>{
 const {principal}=await accessOf(req);
 return isScoped(principal)?(c:CampaignLike)=>canReadCampaign(principal,c):null;
}
export async function readableCampaignIds(req:Request):Promise<ReadonlySet<string>|null>{
 const {actor:who,principal}=await accessOf(req);
 if(!isScoped(principal))return null;
 const rows=await database().prepare("SELECT data FROM records WHERE owner=? AND kind='campaign' LIMIT 5000").bind(who.owner).all<{data:string}>();
 const ids=rows.results.map(r=>parse(r.data) as CampaignLike|null).filter(c=>!!c&&typeof c.id==='string'&&canReadCampaign(principal,c)).map(c=>(c as CampaignLike).id as string);
 return new Set(ids);
}
// 범위 역할이면 권한 주체를, 아니면 null을 돌려준다(목록 응답을 거를지 정할 때 쓴다).
export async function scopedPrincipal(req:Request):Promise<AccessPrincipal|null>{
 const {principal}=await accessOf(req);
 return isScoped(principal)?principal:null;
}
// 브랜드·지점을 가진 항목(사실·자료 요청·조사 등)을 거른다. 지점 항목은 지점 운영 자료와 같은 규칙(canReadStore)이다. 범위 없는 역할은 입력 그대로다.
export const scopeByBrandStore=<R extends {brandId?:unknown;storeId?:unknown}>(principal:AccessPrincipal,rows:readonly R[]):R[]=>isScoped(principal)?rows.filter(r=>text(r.storeId)?canReadStore(principal,{brandId:text(r.brandId),storeId:text(r.storeId)}):canReadCampaign(principal,r)):[...rows];
// ── 쓰기 가드(경로별 범위 가드의 쓰기 표, docs/ROLES.ko.md) ──
// 조회 가드와 같이 범위 없는 역할은 자원을 읽지 않고 역할만으로 판단한다(대표·관리자·직원은 edit_campaign·run_ai 모두 전체라 그대로 통과).
export async function requireCampaignAction(req:Request,action:AccessAction,campaignId:unknown):Promise<Access>{
 return requireAccess(req,action,async()=>campaignResource(await ownerOf(req),campaignId));
}
export async function requireBrandAction(req:Request,action:AccessAction,brandId:unknown):Promise<Access>{
 return requireAccess(req,action,{brandId:text(brandId)});
}
export async function requireStoreAction(req:Request,action:AccessAction,storeId:unknown):Promise<Access>{
 return requireAccess(req,action,async()=>storeResource(await ownerOf(req),storeId));
}
// 입력이 가리키는 범위: 캠페인 → 지점 → 브랜드 순으로 가장 좁은 것을 쓴다. 아무것도 없으면 빈 자원(범위 역할 403).
export async function requireInputAction(req:Request,action:AccessAction,input:{campaignId?:unknown;storeId?:unknown;brandId?:unknown}):Promise<Access>{
 return requireAccess(req,action,async()=>{
  const owner=await ownerOf(req);
  if(text(input.campaignId))return campaignResource(owner,input.campaignId);
  if(text(input.storeId)){const s=await storeResource(owner,input.storeId);return text(input.brandId)&&s.brandId!==input.brandId?{}:s}
  return {brandId:text(input.brandId)};
 });
}
// 저장된 기록(회의·조사·초안·학습 기록·사실 등)이 가리키는 범위. 캠페인 → 지점 → 브랜드 순이고, 브리프 초안처럼 input 안에 둔 기록도 읽는다.
async function linkedResource(owner:string,kind:string,id:unknown):Promise<AccessResource>{
 const d=await recordData(owner,kind,id);if(!d)return {};
 const nested=d.input&&typeof d.input==='object'?d.input as Record<string,unknown>:{};
 if(text(d.campaignId))return campaignResource(owner,d.campaignId);
 const storeId=text(d.storeId)??text(nested.storeId),brandId=text(d.brandId)??text(nested.brandId);
 if(storeId){const s=await storeResource(owner,storeId);return brandId&&s.brandId!==brandId?{}:s}
 return {brandId};
}
export async function requireRecordAction(req:Request,action:AccessAction,kind:string,id:unknown):Promise<Access>{
 return requireAccess(req,action,async()=>linkedResource(await ownerOf(req),kind,id));
}
// 같은 id로 다시 시작하면 기존 기록을 돌려주는 경로(브리프 초안 시작)용: 기록이 이미 있으면 그 범위도 본다. 없으면 통과(새로 만드는 범위는 호출자가 따로 본다).
export async function requireExistingRecordAction(req:Request,action:AccessAction,kind:string,id:unknown):Promise<Access>{
 const access=await accessOf(req);
 if(!isScoped(access.principal)||!await recordData(access.actor.owner,kind,id))return access;
 return requireAccess(req,action,()=>linkedResource(access.actor.owner,kind,id));
}
// 역할 실행 작업(jobs 표)의 캠페인.
export async function requireJobAction(req:Request,action:AccessAction,jobId:unknown):Promise<Access>{
 return requireAccess(req,action,async()=>{
  if(typeof jobId!=='string'||!jobId||jobId.length>500)return {};
  const owner=await ownerOf(req),row=await database().prepare('SELECT campaign_id FROM jobs WHERE id=? AND owner=?').bind(jobId,owner).first<{campaign_id:string}>();
  return row?campaignResource(owner,row.campaign_id):{};
 });
}
// 한 브랜드 화면 안의 지점 항목(자료·관찰·조사 등, storeId가 있으면 지점 항목)을 지점 운영 규칙으로 거른다. 브랜드는 이미 가드한 요청 브랜드다.
export const scopeStoreRows=<R extends {storeId?:unknown}>(principal:AccessPrincipal,brandId:string,rows:readonly R[]):R[]=>isScoped(principal)?rows.filter(r=>!text(r.storeId)||canReadStore(principal,{brandId,storeId:text(r.storeId)})):[...rows];
export const scopeStores=<R extends {id?:unknown;brandId?:unknown}>(principal:AccessPrincipal,rows:readonly R[]):R[]=>isScoped(principal)?rows.filter(r=>canReadStore(principal,{brandId:text(r.brandId),storeId:text(r.id)})):[...rows];
