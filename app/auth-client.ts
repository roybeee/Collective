'use client';

export type AccountUser = {id:string;email:string;role:'admin'|'member'};
export type AuthState = {mode:'legacy'|'email';user:AccountUser|null};

export async function authRequest<T>(path:string,input?:Record<string,unknown>,signal?:AbortSignal):Promise<T>{
 const timeout=AbortSignal.timeout(20_000);
 const response=await fetch(path,{method:input?'POST':'GET',credentials:'same-origin',cache:'no-store',signal:signal?AbortSignal.any([signal,timeout]):timeout,
  ...(input?{headers:{'Content-Type':'application/json'},body:JSON.stringify(input)}:{})});
 const data:unknown=await response.json();
 if(!response.ok)throw new Error(data&&typeof data==='object'&&'error' in data&&typeof data.error==='string'?data.error:'요청을 처리하지 못했습니다. 다시 시도해 주세요.');
 return data as T;
}
