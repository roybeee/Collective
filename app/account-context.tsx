'use client';
// 로그인 계정·역할을 화면 전체에 내려 주는 공용 컨텍스트(ux-3). AuthGate가 AccountProvider로 감싼다.
// 판정은 서버가 한다(lib/server.ts actor·requireAdminActor·requireOwnerActor: 직원은 관리자 작업 403, 소유자 전용 작업은 관리자도 403).
// 화면은 같은 규칙으로 변경 버튼·폼을 숨기고 안내할 뿐이며 조회 정보는 그대로 보인다.
import {useMemo,type ReactNode} from 'react';
import {AuthContext,useAuthState,type AccountRole,type AuthState} from './auth-client';

export type Account={id:string;email:string|null;role:AccountRole;isAdmin:boolean;isOwner:boolean};
// legacy 모드는 요청자가 곧 워크스페이스 소유자다(서버 actor()와 같다). 화면은 헤더 id를 모르므로 고정 id를 쓴다.
export const LEGACY_ACCOUNT_ID='legacy';
export const accountRoleLabels:Record<AccountRole,string>={owner:'대표',admin:'관리자',member:'직원'};
const badges:Record<AccountRole,string>={owner:'OWNER',admin:'ADMIN',member:'MEMBER'};
// 응답의 역할이 세 값이 아니면 직원으로 본다(변경 버튼을 그리지 않는 쪽).
const roleOf=(role:unknown):AccountRole=>role==='owner'||role==='admin'?role:'member';

// 로그인 상태 → 계정. 로그인 전(email 모드에 user 없음)과 AuthGate 밖은 null이다.
export function accountOf(state:AuthState|null|undefined):Account|null{
 if(state?.mode==='legacy')return {id:LEGACY_ACCOUNT_ID,email:null,role:'owner',isAdmin:true,isOwner:true};
 const user=state?.user;if(!user)return null;
 const role=roleOf(user.role);
 return {id:user.id,email:user.email,role,isAdmin:role!=='member',isOwner:role==='owner'};
}
// owner면 소유자 전용(예산 상한·별칭 단가·기능 스위치), 아니면 관리자 이상. 계정을 모르면 막는다.
export const canChange=(account:Account|null,owner=false)=>!!account&&(owner?account.isOwner:account.isAdmin);
// 서버 403 문구와 같다.
export const adminOnlyNote=(owner=false)=>owner?'소유자만 변경할 수 있습니다.':'관리자만 변경할 수 있습니다.';
// 사이드바 프로필: 로그인 이메일과 역할 라벨. legacy는 이메일이 없어 '워크스페이스 소유자'로 보인다.
export function accountProfile(account:Account|null){
 if(!account)return {initial:'?',name:'계정 확인 전',hasEmail:false,label:'',badge:''};
 return {initial:account.email?account.email.slice(0,1).toUpperCase():'W',name:account.email||'워크스페이스 소유자',hasEmail:!!account.email,label:accountRoleLabels[account.role],badge:badges[account.role]};
}

export function AccountProvider({state,children}:{state:AuthState;children:ReactNode}){return <AuthContext.Provider value={state}>{children}</AuthContext.Provider>}
export function useAccount():Account|null{const state=useAuthState();return useMemo(()=>accountOf(state),[state])}

// 권한이 없으면 children 대신 fallback(읽기 전용 내용, 선택)과 안내를 보인다. note로 안내 문구를 바꿀 수 있다(조회 전용 화면 등).
export function AdminOnly({children,owner=false,fallback,note}:{children:ReactNode;owner?:boolean;fallback?:ReactNode;note?:string}){
 const account=useAccount();
 if(canChange(account,owner))return <>{children}</>;
 return <>{fallback}<p className="subtle-note admin-only-note" role="note">{note??adminOnlyNote(owner)}</p></>;
}

export function WorkspaceProfile(){
 const p=accountProfile(useAccount());
 return <div className="profile" role="group" aria-label="로그인 계정"><span aria-hidden="true">{p.initial}</span><div className="profile-text">{p.hasEmail?<b className="profile-email" title={p.name}>{p.name}</b>:<b>{p.name}</b>}{p.label&&<small>{p.label}</small>}</div>{p.badge&&<span className="profile-badge">{p.badge}</span>}</div>;
}
