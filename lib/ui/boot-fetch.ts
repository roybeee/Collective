// 홈 첫 화면 요청 미리 시작(UX-PLAN-3 ⑩ 4G LCP). app/layout.tsx의 머리 스크립트(BOOT_SCRIPT)가 HTML을 읽는 즉시
// 로그인 확인·워크스페이스·오늘 안건 GET을 동시에 시작한다. 화면 코드는 내려받은 뒤 bootFetch로 그 응답을 한 번만 넘겨받는다.
// 넘겨받지 못하면(이미 썼거나, 10초가 지났거나, 다른 요청 옵션) 평소처럼 새로 요청한다. 읽기 전용 GET만 미리 시작한다.
export const BOOT_PATHS=['/api/auth','/api/workspace','/api/agenda'] as const;
const MAX_AGE_MS=10_000;
// 머리 스크립트는 화면 코드보다 먼저 돌아야 하므로 문자열로 둔다. 같은 출처 쿠키를 보내고 캐시는 쓰지 않는다(authRequest·agenda와 같은 옵션).
// 본문은 바로 끝까지 읽어 둔다. 홈이 아닌 화면처럼 아무도 넘겨받지 않으면 읽지 않은 응답이 열린 채 남아 네트워크가 쉬지 않았다.
// 다 읽은 본문(x)과 상태(s)도 남겨, 화면이 처음 그릴 때 이미 도착한 데이터를 바로 쓸 수 있게 한다(bootJsonNow).
export const BOOT_SCRIPT=`(function(){try{var t=Date.now(),b={};${JSON.stringify(BOOT_PATHS)}.forEach(function(p){var e={t:t};e.f=fetch(p,{credentials:'same-origin',cache:'no-store'}).then(function(r){return r.text().then(function(x){e.s=r.status;e.x=x;return new Response(x,{status:r.status,statusText:r.statusText,headers:r.headers})})});e.f.catch(function(){});b[p]=e});window.__boot=b}catch(e){}})()`;
type Boot=Record<string,{t:number;f:Promise<Response>;s?:number;x?:string}|undefined>;
// 미리 받은 응답이 이미 도착했고 성공(2xx)이면 그 JSON을 지금 바로 넘겨받는다(한 번만). 아직이면 null이고, 그때는 bootFetch로 기다린다.
// 워크스페이스는 이 값으로 첫 화면을 데이터와 함께 한 번에 그린다(빈 화면을 그린 뒤 다시 그리는 한 차례를 없앤다, 4G LCP).
export function bootJsonNow<T>(path:(typeof BOOT_PATHS)[number]):T|null{
 const boot=typeof window==='undefined'?undefined:(window as unknown as {__boot?:Boot}).__boot,hit=boot?.[path];
 if(!boot||!hit||hit.x===undefined||!hit.s||hit.s<200||hit.s>=300||Date.now()-hit.t>=MAX_AGE_MS)return null;
 try{const value=JSON.parse(hit.x) as T;boot[path]=undefined;return value}catch{return null}
}
export function bootFetch(path:(typeof BOOT_PATHS)[number],init?:RequestInit):Promise<Response>{
 const boot=typeof window==='undefined'?undefined:(window as unknown as {__boot?:Boot}).__boot,hit=boot?.[path];
 if(hit&&boot){boot[path]=undefined;if(Date.now()-hit.t<MAX_AGE_MS&&!init?.signal?.aborted&&(!init?.method||init.method==='GET'))return hit.f.catch(()=>fetch(path,init))}
 return fetch(path,init);
}
