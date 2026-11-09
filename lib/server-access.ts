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
