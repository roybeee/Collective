'use client';

import {createContext,useContext} from 'react';
import {bootFetch} from '@/lib/ui/boot-fetch';

export type AccountRole = 'owner'|'admin'|'member';
export type AccountUser = {id:string;email:string;role:AccountRole};
export type AuthState = {mode:'legacy'|'email';user:AccountUser|null};

// AuthGate가 로그인 상태를 내려 준다. legacy 모드는 user가 null이고 요청자가 곧 워크스페이스 소유자다.
export const AuthContext=createContext<AuthState|null>(null);
export const useAuthState=()=>useContext(AuthContext);
export const roleLabel=(role:AccountRole)=>role==='owner'?'소유자':role==='admin'?'관리자':'직원';
// 관리자 전용 작업 버튼을 보여 줄지 정한다. legacy는 요청자가 곧 소유자다. 판정은 서버가 하고(직원은 403) 화면은 보조 수단이다.
export const useCanManage=()=>{const state=useAuthState();return !state||state.mode==='legacy'||state.user?.role!=='member'};
export const adminRequestNote='관리자에게 요청하세요.';

export async function authRequest<T>(path:string,input?:Record<string,unknown>,signal?:AbortSignal):Promise<T>{
 const timeout=AbortSignal.timeout(20_000);
 // 첫 로그인 확인은 머리 스크립트가 미리 시작한 응답을 넘겨받는다(lib/ui/boot-fetch.ts).
 const response=await (!input&&path==='/api/auth'?bootFetch:fetch)(path as '/api/auth',{method:input?'POST':'GET',credentials:'same-origin',cache:'no-store',signal:signal?AbortSignal.any([signal,timeout]):timeout,
  ...(input?{headers:{'Content-Type':'application/json'},body:JSON.stringify(input)}:{})});
 const data:unknown=await response.json();
 if(!response.ok)throw new Error(data&&typeof data==='object'&&'error' in data&&typeof data.error==='string'?data.error:'요청을 처리하지 못했습니다. 다시 시도해 주세요.');
 return data as T;
}
