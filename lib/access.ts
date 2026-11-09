// G7 브랜드·점포 범위 역할 권한 표(순수 모듈). 데이터 소유는 그대로 워크스페이스(records.owner)이고, 이 표는 그 위에 얹는 권한 판단이다.
// 대표(owner)·관리자(admin)·직원(member)은 범위 없이 기존 그대로다. 각 경로의 기존 검사(소유자 전용 등)는 이 표보다 엄격하면 그대로 남는다.
// 범위 역할(brand_manager·store_manager·reviewer)은 계정 역할이 직원(member)인 사람에게 멤버십(records kind 'membership')으로 얹는다.
// 범위가 맞지 않거나 자원(브랜드·지점)을 모르면 거절한다(닫힌 기본값). 문서: docs/ROLES.ko.md.

export const ACCESS_ACTIONS=['read_campaign','edit_campaign','run_ai','approve_artifact','publish','spend','send_customer','manage_connections','manage_flags','manage_accounts','view_usage','export_data'] as const;
export type AccessAction=typeof ACCESS_ACTIONS[number];
export const BASE_ROLES=['owner','admin','member'] as const;
export const SCOPED_ROLES=['brand_manager','store_manager','reviewer'] as const;
export type BaseRole=typeof BASE_ROLES[number];
export type ScopedRole=typeof SCOPED_ROLES[number];
export type AccessRole=BaseRole|ScopedRole;
export type AccessPrincipal={readonly role:AccessRole;readonly brandIds:readonly string[];readonly storeIds:readonly string[]};
export type AccessResource={readonly brandId?:string|null;readonly storeId?:string|null;readonly campaignId?:string|null};
// all 범위 없이 허용 · brand 자원 브랜드가 배정 브랜드 안 · store 자원 지점이 배정 지점 안 · brand_store 배정 브랜드 안이고 지점 자원이면 배정 지점 안 · none 거절
export type AccessScope='all'|'brand'|'store'|'brand_store'|'none';

const row=(scope:AccessScope,overrides:Partial<Record<AccessAction,AccessScope>>={}):Readonly<Record<AccessAction,AccessScope>>=>Object.freeze({...Object.fromEntries(ACCESS_ACTIONS.map(a=>[a,scope])) as Record<AccessAction,AccessScope>,...overrides});

export const ROLE_MATRIX:Readonly<Record<AccessRole,Readonly<Record<AccessAction,AccessScope>>>>=Object.freeze({
 owner:row('all'),
 // 기능 스위치는 소유자만 바꾼다(app/api/feature-flags requireOwnerActor).
 admin:row('all',{manage_flags:'none'}),
 // 직원: 모든 브랜드를 보고 작성·AI 실행은 하지만 승인·발행·지출·발송·연결·계정은 못 한다(기존 403 그대로).
 member:row('none',{read_campaign:'all',edit_campaign:'all',run_ai:'all',view_usage:'all'}),
 // 본사 브랜드 매니저: 배정 브랜드 안에서 작성·AI 실행·승인·발행. 지출·고객 발송·연결·스위치·계정·사용량·내보내기는 워크스페이스 전체 권한이라 없다.
 brand_manager:row('none',{read_campaign:'brand',edit_campaign:'brand',run_ai:'brand',approve_artifact:'brand',publish:'brand'}),
 // 점주(점포 매니저): 배정 지점의 브랜드 캠페인을 보고(다른 지점 캠페인은 안 보임), 배정 지점 단위의 초안·승인·제출 표시만 한다. AI 실행 없음.
 store_manager:row('none',{read_campaign:'brand_store',edit_campaign:'store',approve_artifact:'store',publish:'store'}),
 // 외부 검토자: 배정 브랜드를 읽고 작업물 검토 결정(승인·수정 요청)만 남긴다. 실행 없음.
 reviewer:row('none',{read_campaign:'brand',approve_artifact:'brand'}),
});

export const isScopedRole=(value:unknown):value is ScopedRole=>typeof value==='string'&&(SCOPED_ROLES as readonly string[]).includes(value);
export const isAccessAction=(value:unknown):value is AccessAction=>typeof value==='string'&&(ACCESS_ACTIONS as readonly string[]).includes(value);
const within=(list:readonly string[],value:string|null|undefined)=>typeof value==='string'&&value!==''&&list.includes(value);

export function can(principal:AccessPrincipal,action:AccessAction,resource:AccessResource={}):boolean{
 const scope=ROLE_MATRIX[principal.role]?.[action]??'none';
 if(scope==='all')return true;
 if(scope==='brand')return within(principal.brandIds,resource.brandId);
 if(scope==='store')return within(principal.storeIds,resource.storeId);
 if(scope==='brand_store')return within(principal.brandIds,resource.brandId)&&(!resource.storeId||within(principal.storeIds,resource.storeId));
 return false;
}
// 범위 역할인지(목록을 걸러야 하는지). 범위 없는 역할은 모든 브랜드를 본다.
export const isScoped=(principal:AccessPrincipal)=>isScopedRole(principal.role);
// 자원 판단이 필요 없는 역할(범위 없음)은 자원을 읽지 않고 역할만으로 판단한다. 기존 경로의 403·404 순서를 바꾸지 않기 위해서다.
export const roleOnly=(principal:AccessPrincipal,action:AccessAction)=>{const scope=ROLE_MATRIX[principal.role]?.[action]??'none';return scope==='all'||scope==='none'};

export const scopedRoleLabels:Readonly<Record<ScopedRole,string>>=Object.freeze({brand_manager:'브랜드 매니저',store_manager:'점포 매니저',reviewer:'검토자'});
export const scopedRoleDescriptions:Readonly<Record<ScopedRole,string>>=Object.freeze({
 brand_manager:'배정한 브랜드 안에서만 작성·AI 실행·작업물 승인·발행합니다. 지출·고객 발송·연결·계정은 못 합니다.',
 store_manager:'배정한 지점의 캠페인만 보고, 그 지점의 플레이스 초안·승인·제출 표시를 합니다. 다른 브랜드는 보이지 않습니다.',
 reviewer:'배정한 브랜드의 캠페인을 읽고 작업물 검토 결정(승인·수정 요청)만 남깁니다. 실행은 없습니다.',
});

// 멤버십 입력 정리(순수): 중복 제거·문자열만·최대 50개. 서버가 존재 여부를 따로 확인한다.
export const MEMBERSHIP_LIMIT=50;
export function cleanIds(value:unknown):string[]|null{
 if(value===undefined||value===null)return [];
 if(!Array.isArray(value)||value.length>MEMBERSHIP_LIMIT)return null;
 if(!value.every(v=>typeof v==='string'&&v.length>0&&v.length<=100&&!/[\x00-\x1f\x7f]/.test(v)))return null;
 return [...new Set(value as string[])];
}
// 저장된 멤버십을 읽어 권한 주체로 바꾼다. 모양이 깨졌으면 아무 브랜드도 없는 검토자로 본다(닫힌 기본값).
export type StoredMembership={userId:string;role:ScopedRole;brandIds:string[];storeIds:string[];updatedAt:string;updatedBy:{id:string;email:string|null}};
export function principalOfMembership(data:unknown):AccessPrincipal{
 const value=data&&typeof data==='object'?data as Record<string,unknown>:{};
 const brandIds=cleanIds(value.brandIds),storeIds=cleanIds(value.storeIds);
 if(!isScopedRole(value.role)||!brandIds||!storeIds)return {role:'reviewer',brandIds:[],storeIds:[]};
 return {role:value.role,brandIds,storeIds};
}
