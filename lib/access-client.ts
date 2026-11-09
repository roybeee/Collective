// 화면용 권한 판정(레인 X-G, G7 범위 역할). 정본 표는 lib/access.ts ROLE_MATRIX이고 서버가 최종 판정한다(lib/server-access.ts requireAccess). 화면은 같은 규칙으로 버튼을 막고 이유를 보일 뿐이다.
// 범위 없는 역할(대표·관리자·직원·legacy)은 기존 화면 규칙(app/auth-client.ts useCanManage: 관리자 이상이면 변경 가능)을 그대로 쓴다. 그래서 대표·관리자·직원 화면은 이전과 같다.
// 범위 역할(브랜드 매니저·점포 매니저·검토자)은 GET /api/workspace의 access(역할·배정 브랜드·지점)로 표를 읽는다. access를 아직 모르면 직원처럼 막는다(닫힌 기본값).
import {can,isScopedRole,type AccessAction,type AccessResource,type ScopedRole} from './access';

export type ClientAccess={role:ScopedRole;brandIds:readonly string[];storeIds:readonly string[]};
// canManage: 기존 화면 규칙(useCanManage) 값. access: /api/workspace 응답의 access(범위 역할만, 아니면 null).
export function clientCan(canManage:boolean,access:ClientAccess|null,action:AccessAction,resource:AccessResource={}):boolean{
 if(!access)return canManage;
 return can({role:access.role,brandIds:access.brandIds,storeIds:access.storeIds},action,resource);
}
// 응답의 access 모양을 확인한다. 깨졌으면 null(범위 없음으로 보지 않고, 호출부가 직원 규칙으로 막는다).
export function parseClientAccess(value:unknown):ClientAccess|null{
 if(!value||typeof value!=='object')return null;
 const v=value as Record<string,unknown>,list=(x:unknown)=>Array.isArray(x)&&x.every(i=>typeof i==='string')?x as string[]:null;
 const brandIds=list(v.brandIds),storeIds=list(v.storeIds);
 return isScopedRole(v.role)&&brandIds&&storeIds?{role:v.role,brandIds,storeIds}:null;
}
// 거절 이유 문구의 종류. 범위 역할은 배정 범위 밖(scope), 범위 없는 역할은 관리자 전용(admin)이다. 문구는 화면 언어 사전(lib/i18n)에서 고른다.
export type DenyKind='scope'|'admin';
export const denyKind=(access:ClientAccess|null):DenyKind=>access?'scope':'admin';

// 범위 역할의 access는 워크스페이스 응답이 올 때마다 바뀐다(app/workspace.tsx가 넣는다). React 밖에서도 읽도록 작은 저장소로 둔다(lib/ui/theme.ts와 같은 방식).
let current:ClientAccess|null=null;
const listeners=new Set<()=>void>();
const same=(a:ClientAccess|null,b:ClientAccess|null)=>a===b||!!a&&!!b&&a.role===b.role&&a.brandIds.join('\n')===b.brandIds.join('\n')&&a.storeIds.join('\n')===b.storeIds.join('\n');
export function setWorkspaceAccess(value:unknown){const next=parseClientAccess(value);if(same(current,next))return;current=next;for(const l of listeners)l()}
export const workspaceAccess=()=>current;
export function subscribeWorkspaceAccess(listener:()=>void){listeners.add(listener);return()=>{listeners.delete(listener)}}
