// 홈 첫 화면 요청 미리 시작(UX-PLAN-3 ⑩ 4G LCP). app/layout.tsx의 머리 스크립트(BOOT_SCRIPT)가 HTML을 읽는 즉시
// 로그인 확인·워크스페이스·오늘 안건 GET을 동시에 시작한다. 화면 코드는 내려받은 뒤 bootFetch로 그 응답을 한 번만 넘겨받는다.
// 넘겨받지 못하면(이미 썼거나, 10초가 지났거나, 다른 요청 옵션) 평소처럼 새로 요청한다. 읽기 전용 GET만 미리 시작한다.
export const BOOT_PATHS=['/api/auth','/api/workspace','/api/agenda'] as const;
const MAX_AGE_MS=10_000;
// 머리 스크립트는 화면 코드보다 먼저 돌아야 하므로 문자열로 둔다. 같은 출처 쿠키를 보내고 캐시는 쓰지 않는다(authRequest·agenda와 같은 옵션).
export const BOOT_SCRIPT=`(function(){try{var t=Date.now(),b={};${JSON.stringify(BOOT_PATHS)}.forEach(function(p){var f=fetch(p,{credentials:'same-origin',cache:'no-store'});f.catch(function(){});b[p]={t:t,f:f}});window.__boot=b}catch(e){}})()`;
type Boot=Record<string,{t:number;f:Promise<Response>}|undefined>;
export function bootFetch(path:(typeof BOOT_PATHS)[number],init?:RequestInit):Promise<Response>{
 const boot=typeof window==='undefined'?undefined:(window as unknown as {__boot?:Boot}).__boot,hit=boot?.[path];
 if(hit&&boot){boot[path]=undefined;if(Date.now()-hit.t<MAX_AGE_MS&&!init?.signal?.aborted&&(!init?.method||init.method==='GET'))return hit.f.catch(()=>fetch(path,init))}
 return fetch(path,init);
}
