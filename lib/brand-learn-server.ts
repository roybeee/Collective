// 브랜드 자동 학습 서버(에픽 G1): 공개 웹 페이지 1회 GET → lib/brand-learn.ts 추출 → 실행 기록(brand_learn_run) → 사람이 '후보로 저장'하면 사실 원장 후보(brand_fact candidate).
// 스위치 brand_autolearn(기본 꺼짐)이 꺼져 있으면 모든 쓰기는 409다. 확정은 사람이 원장에서 한다(기존 confirm 흐름). 로고·색은 실행 기록의 제안으로만 남고,
// 브랜드 색 적용(apply_visual)은 관리자가 따로 누른다(브랜드 레코드를 새 객체로 바꾸고 출처를 남긴다). 원문 HTML은 저장하지 않는다(추출 요약만).
// 가져오기 안전: http(s)·공개 호스트만, 사설·루프백·링크로컬 주소 거부(리다이렉트마다 다시 검사), 10초 제한, 본문 1MB 상한(lib/http-limits.ts), robots 무시 단일 GET.
import {ApiError,str,stamp,uid,readRecord,listRecords,recordStatement,database,type Actor} from './server';
import type {Brand} from './agency';
import type {BrandFact} from './brand-facts';
import {isEnabled} from './feature-flags';
import {planImport} from './fact-import';
import {HttpBodyError,readBoundedText} from './http-limits';
import {learnBrandFromHtml,learnedFactCandidates,type BrandLearnResult,type LearnedCandidate} from './brand-learn';

export const BRAND_AUTOLEARN_OFF='브랜드 자동 학습 스위치가 꺼져 있습니다.';
export const FETCH_LIMITS={timeoutMs:10_000,maxBytes:1_000_000,redirects:3,runsPerBrand:50} as const;
export type VisualProvenance={runId:string;url:string;observedAt:string;appliedBy:{id:string;email:string|null};appliedAt:string;previousColor:string};
export type BrandLearnRun={id:string;brandId:string;url:string;finalUrl:string;status:'previewed'|'saved';fixture?:true;observedAt:string;bytes:number;result:BrandLearnResult;candidates:LearnedCandidate[];imported?:number;skipped?:{key:string;reason:string}[];appliedVisual?:VisualProvenance;by:{id:string;email:string|null};version:number;createdAt:string;updatedAt:string};
export type LearnSourceInput={kind:'fetch'}|{kind:'fixture';html:string};

// 공개 http(s) 주소만 통과한다. 사용자 정보(user:pass@), 루프백·사설·링크로컬·.local·숫자형 사설 IPv4/IPv6을 거부한다(기본 SSRF 가드).
export function assertPublicHttpUrl(raw:string):URL{
 let u:URL;
 try{u=new URL(raw.trim())}catch{throw new ApiError(400,'주소 형식을 확인해 주세요(https://…).')}
 if(u.protocol!=='http:'&&u.protocol!=='https:')throw new ApiError(400,'http(s) 주소만 읽습니다.');
 if(u.username||u.password)throw new ApiError(400,'계정 정보가 든 주소는 읽지 않습니다.');
 const host=u.hostname.toLowerCase().replace(/^\[|\]$/g,'');
 if(!host||host==='localhost'||host.endsWith('.localhost')||host.endsWith('.local')||host.endsWith('.internal'))throw new ApiError(400,'내부 주소는 읽지 않습니다.');
 const v4=/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
 if(v4){
  const [a,b]=v4.slice(1).map(Number);
  if(a===10||a===127||a===0||(a===172&&b>=16&&b<=31)||(a===192&&b===168)||(a===169&&b===254)||a>=224)throw new ApiError(400,'사설·내부 IP 주소는 읽지 않습니다.');
 }
 if(host.includes(':')){
  if(host==='::1'||host==='::'||/^(fc|fd|fe[89ab])/i.test(host)||host.startsWith('::ffff:'))throw new ApiError(400,'사설·내부 IP 주소는 읽지 않습니다.');
 }
 return u;
}
type FetchLike=(input:string,init:RequestInit)=>Promise<Response>;
// 단일 GET(리다이렉트는 손으로 최대 3번 따라가며 매번 가드). HTML만 받고 본문은 1MB에서 끊는다.
export async function fetchBrandHtml(raw:string,{fetchImpl=fetch as FetchLike,timeoutMs=FETCH_LIMITS.timeoutMs,maxBytes=FETCH_LIMITS.maxBytes}:{fetchImpl?:FetchLike;timeoutMs?:number;maxBytes?:number}={}):Promise<{html:string;finalUrl:string;bytes:number}>{
 let url=assertPublicHttpUrl(raw);
 for(let hop=0;hop<=FETCH_LIMITS.redirects;hop++){
  let res:Response;
  try{res=await fetchImpl(url.href,{method:'GET',redirect:'manual',signal:AbortSignal.timeout(timeoutMs),headers:{accept:'text/html,application/xhtml+xml;q=0.9,*/*;q=0.1','user-agent':'COLLECTIVE-BrandLearn/1 (+single GET, no crawl)'}})}
  catch(e){throw new ApiError(502,e instanceof Error&&e.name==='TimeoutError'?'페이지 응답이 10초를 넘어 읽지 못했습니다.':'페이지를 읽지 못했습니다. 주소를 확인해 주세요.')}
  if([301,302,303,307,308].includes(res.status)){
   const location=res.headers.get('location');
   if(!location||hop===FETCH_LIMITS.redirects)throw new ApiError(502,'페이지가 너무 많이 이동해 읽지 못했습니다.');
   url=assertPublicHttpUrl(new URL(location,url).href);continue;
  }
  if(!res.ok)throw new ApiError(502,`페이지가 ${res.status} 응답을 보냈습니다.`);
  const type=(res.headers.get('content-type')||'').toLowerCase();
  if(!type.startsWith('text/html')&&!type.startsWith('application/xhtml+xml'))throw new ApiError(400,'웹 페이지(HTML)만 읽습니다. 이미지·PDF·API 주소는 읽지 않습니다.');
  try{const html=await readBoundedText(res,maxBytes);return {html,finalUrl:url.href,bytes:new TextEncoder().encode(html).byteLength}}
  catch(e){throw e instanceof HttpBodyError?new ApiError(e.status===413?413:502,e.status===413?'페이지가 1MB를 넘어 읽지 않습니다.':'페이지 본문을 읽지 못했습니다.'):e}
 }
 throw new ApiError(502,'페이지를 읽지 못했습니다.');
}
async function requireOn(owner:string){if(!await isEnabled(owner,'brand_autolearn'))throw new ApiError(409,BRAND_AUTOLEARN_OFF)}
const actorRef=(who:Pick<Actor,'id'|'email'>)=>({id:who.id,email:who.email});
// 1단계 미리보기: 가져오기·추출만 하고 실행 기록을 남긴다(사실 원장에는 아직 쓰지 않는다). 호출자는 가져오기(네트워크)가 끝난 뒤 소유자 잠금 안에서 저장 부분만 부른다.
export async function learnBrandPage(owner:string,input:Record<string,unknown>,source:LearnSourceInput,fetchOptions:Parameters<typeof fetchBrandHtml>[1]={}){
 await requireOn(owner);
 const brandId=str(input.brandId,'브랜드',100,true),url=str(input.url,'주소',2000,true);
 await readRecord<Brand>(owner,'brand',brandId);
 const page=source.kind==='fixture'?{html:source.html,finalUrl:assertUrlShape(url),bytes:new TextEncoder().encode(source.html).byteLength}:await fetchBrandHtml(url,fetchOptions);
 const observedAt=stamp(),result=learnBrandFromHtml(page.html,page.finalUrl);
 const run:BrandLearnRun={id:uid(),brandId,url,finalUrl:page.finalUrl,status:'previewed',...(source.kind==='fixture'?{fixture:true as const}:{}),observedAt,bytes:page.bytes,result,candidates:learnedFactCandidates(result,page.finalUrl,observedAt),by:{id:'',email:null},version:1,createdAt:observedAt,updatedAt:observedAt};
 return run;
}
// 고정물 주소는 네트워크를 타지 않으므로 사설 가드 대신 형식만 본다.
function assertUrlShape(raw:string){try{return new URL(raw).href}catch{throw new ApiError(400,'주소 형식을 확인해 주세요(https://…).')}}
export async function saveLearnRun(owner:string,run:BrandLearnRun,who:Pick<Actor,'id'|'email'>){
 const existing=await listRecords<BrandLearnRun>(owner,'brand_learn_run',run.brandId);
 if(existing.length>=FETCH_LIMITS.runsPerBrand)throw new ApiError(409,`브랜드마다 학습 기록은 ${FETCH_LIMITS.runsPerBrand}개까지 보관합니다. 오래된 기록을 정리하세요.`);
 const saved:BrandLearnRun={...run,by:actorRef(who)};
 await recordStatement(owner,'brand_learn_run',saved.id,saved,saved.brandId).run();
 return saved;
}
// 2단계 후보 저장: 실행 기록의 후보를 사실 원장 후보(candidate)로 쓴다. 같은 범위·같은 항목이 있으면 건너뛰고 보고한다(lib/fact-import.ts planImport). 확정은 하지 않는다.
export async function saveLearnedCandidates(owner:string,input:Record<string,unknown>,who:Pick<Actor,'id'|'email'>){
 await requireOn(owner);
 const run=await readRecord<BrandLearnRun>(owner,'brand_learn_run',str(input.runId,'학습 기록',100,true));
 if(run.status==='saved')return {run,imported:run.imported??0,skipped:run.skipped??[]};
 const facts=await listRecords<BrandFact>(owner,'brand_fact',run.brandId);
 const {candidates,skipped}=planImport(run.candidates.map(c=>({key:c.key,value:c.value,source:c.source})),facts);
 const room=Math.max(0,200-facts.length),accepted=candidates.slice(0,room),now=stamp();
 const limited=candidates.slice(room).map(c=>({key:c.key,reason:'브랜드 사실 보관 한도 200개에 도달했습니다.'}));
 const next:BrandLearnRun={...run,status:'saved',imported:accepted.length,skipped:[...skipped.map(s=>({key:s.key,reason:s.reason})),...limited],version:run.version+1,updatedAt:now};
 const writes=[...accepted.map(c=>{const id=uid();return recordStatement(owner,'brand_fact',id,{id,brandId:run.brandId,key:c.key,value:c.value,status:'candidate',source:c.source,verifiedAt:'',validUntil:'',version:1,updatedAt:now,importedBy:actorRef(who)},run.brandId)}),recordStatement(owner,'brand_learn_run',next.id,next,next.brandId)];
 await database().batch(writes);
 return {run:next,imported:next.imported??0,skipped:next.skipped??[]};
}
// 색 적용(순수): 브랜드를 바꾸지 않고 새 객체를 돌려준다. 출처(어느 기록·주소·관측 시각·누가·언제·이전 색)를 브랜드에 함께 남긴다.
export function brandWithVisual<T extends Brand>(brand:T,hex:string,provenance:VisualProvenance):T&{visualProvenance:VisualProvenance}{
 return {...brand,color:hex,visualProvenance:provenance};
}
const HEX=/^#[0-9a-f]{6}$/;
// 3단계(관리자 전용) apply_visual: 실행 기록이 제안한 색 중 하나를 브랜드 색으로 쓴다. 제안에 없는 색은 받지 않는다. 로고는 제안으로만 남는다(브랜드에 로고 칸이 없다).
export async function applyLearnedVisual(owner:string,input:Record<string,unknown>,who:Pick<Actor,'id'|'email'|'role'>){
 await requireOn(owner);
 if(who.role!=='owner'&&who.role!=='admin')throw new ApiError(403,'브랜드 색 적용은 관리자만 할 수 있습니다.');
 const run=await readRecord<BrandLearnRun>(owner,'brand_learn_run',str(input.runId,'학습 기록',100,true));
 const hex=str(input.hex,'색',7,true).toLowerCase();
 if(!HEX.test(hex)||!run.result.colors.some(c=>c.hex===hex))throw new ApiError(400,'학습 기록이 제안한 색 중에서 고르세요.');
 const brand=await readRecord<Brand>(owner,'brand',run.brandId);
 const provenance:VisualProvenance={runId:run.id,url:run.finalUrl,observedAt:run.observedAt,appliedBy:actorRef(who),appliedAt:stamp(),previousColor:brand.color};
 const nextBrand=brandWithVisual(brand,hex,provenance),nextRun:BrandLearnRun={...run,appliedVisual:provenance,version:run.version+1,updatedAt:provenance.appliedAt};
 await database().batch([recordStatement(owner,'brand',nextBrand.id,nextBrand),recordStatement(owner,'brand_learn_run',nextRun.id,nextRun,nextRun.brandId)]);
 return {brand:nextBrand,run:nextRun};
}
export async function listLearnRuns(owner:string,brandId:string){
 await readRecord<Brand>(owner,'brand',brandId);
 return (await listRecords<BrandLearnRun>(owner,'brand_learn_run',brandId)).slice(0,10);
}
