// 상품 리서치 자동 수집 계획·실행(서버). 공식 API만, 출처별 하루 쿼터 안에서만 호출한다(collectors/*가 레지스트리 밖 호스트를 막는다).
// 한국 날짜(KST)로 하루 1번 계획을 세우고(pr_collect_state.plan), 워커 tick마다 정해진 수만큼 호출해 이어 간다. 한 출처의 실패는 다른 출처를 멈추지 않는다.
// 하루 상한: 검색광고 키워드 40개(호출당 5개), 데이터랩 검색어 트렌드 묶음 40개(호출당 5개, 최근 104주 주간), 쇼핑 검색 키워드 20개,
// YouTube 발견 3개(search.list 100단위씩)와 추적 영상 200개(videos.list 50개씩), 쿠팡 파트너스 식품 베스트 1회. 계획을 다 돌면 재계산한다.
import {ApiError,stamp} from '../server';
import {CATEGORIES} from './categories';
import {CREDENTIAL_FOR_SOURCE} from './credentials';
import type {CredentialKey} from './api';
import {sourceSpec} from './sources';
import {collectSearchadKeywords,collectDatalabSearch,collectShopSearch,discoverYoutubeVideos,trackYoutubeVideos,collectCoupangBestCategory,CollectorError,kstDayKey,unitsFor,type CollectDeps,type CollectResult,type QuotaOperation} from './collectors/index';
import type {NaverSearchadCredential,NaverDevelopersCredential,YoutubeCredential,CoupangPartnersCredential,ResearchCredential} from './credentials';
import {normalizeKeyword} from './analytics/normalize';
import {K,collectEnabled,ensureSnapshotRoom,loadCredential,optional,pruneQuota,putStatement,readSettings,refundQuota,reserveQuota,researchEnabled,snapshotStatement} from './server-store';
import {loadGroups,loadProducts,recompute,referencedSnapshots,type CollectVideo} from './server-pipeline';
import {database} from '../server';
import type {Snapshot,SourceId} from './types';

export const DAILY={keywords:40,datalabGroups:40,shopKeywords:20,youtubeDiscover:3,trackedVideos:200,videosPerKeyword:10,keywordsPerHint:5,groupsPerDatalab:5,keepRelated:100};
export const STEPS_PER_TICK=12,STEPS_PER_COLLECT_NOW=30;
// 쿠팡 파트너스 카테고리 베스트의 식품 분류 번호(파트너스 문서 기준, 수집기 주석과 같다). 상온 식품 카테고리를 고르면 이것 하나로 본다.
export const COUPANG_FOOD_CATEGORY='1012';
const DAY=86400000;

export type CollectStep=
 |{sourceId:'naver_searchad_keyword';op:'keywordstool';keywords:string[]}
 |{sourceId:'naver_datalab_search';op:'datalab';groups:{groupName:string;keywords:string[]}[]}
 |{sourceId:'naver_shop_search';op:'shop';keyword:string}
 |{sourceId:'youtube_data';op:'yt_search';keyword:string}
 |{sourceId:'youtube_data';op:'yt_track';chunk:number}
 |{sourceId:'coupang_partners';op:'coupang_best';categoryId:string};
export type CollectError={message:string;at:string;code:string};
export type CollectState={day:string|null;plan:CollectStep[];cursor:number;done:boolean;lastRunAt:string|null;nextRunAt:string|null;errors:Partial<Record<SourceId,CollectError>>;skip:SourceId[];videos:CollectVideo[];youtubeCursor:number};
export const emptyCollectState=():CollectState=>({day:null,plan:[],cursor:0,done:false,lastRunAt:null,nextRunAt:null,errors:{},skip:[],videos:[],youtubeCursor:0});
export async function readCollectState(owner:string){return {...emptyCollectState(),...(await optional<CollectState>(owner,K.collectState,'current')??{})}}
const saveState=(owner:string,s:CollectState)=>putStatement(owner,K.collectState,'current',s).run();
export const defaultDeps=():CollectDeps=>({fetch:(input:RequestInfo|URL,init?:RequestInit)=>fetch(input,init),now:()=>new Date()});
const nextKstMidnight=(now:Date)=>new Date(Date.parse(`${kstDayKey(new Date(now.getTime()+DAY))}T00:00:00+09:00`)).toISOString();
const opOf=(s:CollectStep):QuotaOperation=>({keywordstool:'keywordstool',datalab:'datalab_search',shop:'shop_search',yt_search:'youtube_search',yt_track:'youtube_videos',coupang_best:'coupang_bestcategories'} as const)[s.op];
const chunk=<T>(xs:readonly T[],n:number)=>{const out:T[][]=[];for(let i=0;i<xs.length;i+=n)out.push(xs.slice(i,i+n));return out};
const cleanKeyword=(k:string)=>k.replace(/[\s,]+/g,'').slice(0,40);

// 오늘 계획. 연결된 출처만, 조사 방향의 카테고리 씨앗 키워드와 상품이 많이 붙은 키워드 묶음 순서다.
export async function buildPlan(owner:string,state:CollectState,only?:SourceId):Promise<CollectStep[]>{
 const settings=await readSettings(owner),[groups,products]=await Promise.all([loadGroups(owner),loadProducts(owner)]);
 const linked=new Map<string,number>();for(const p of products)for(const g of p.keywordGroupIds)linked.set(g,(linked.get(g)??0)+1);
 const ranked=[...groups].sort((a,b)=>(linked.get(b.id)??0)-(linked.get(a.id)??0)||(a.label<b.label?-1:1));
 const seeds=CATEGORIES.filter(c=>settings.categories.includes(c.id)).flatMap(c=>c.seedKeywords);
 const keywords:string[]=[],seen=new Set<string>();
 for(const k of [...seeds,...ranked.map(g=>g.label)]){const c=cleanKeyword(k),n=normalizeKeyword(c);if(!c||!n||seen.has(n))continue;seen.add(n);keywords.push(c);if(keywords.length>=DAILY.keywords)break}
 const dlGroups:{groupName:string;keywords:string[]}[]=[];const dlSeen=new Set<string>();
 for(const g of ranked){const name=g.label.slice(0,50),n=normalizeKeyword(name);if(!n||dlSeen.has(n))continue;dlSeen.add(n);dlGroups.push({groupName:name,keywords:g.keywords.map(k=>k.slice(0,50)).slice(0,20)});if(dlGroups.length>=DAILY.datalabGroups)break}
 for(const k of keywords){if(dlGroups.length>=DAILY.datalabGroups)break;const n=normalizeKeyword(k);if(dlSeen.has(n))continue;dlSeen.add(n);dlGroups.push({groupName:k,keywords:[k]})}
 const connected=async(key:CredentialKey)=>!!await optional(owner,K.credential,key);
 const steps:CollectStep[]=[];
 const want=(id:SourceId)=>!only||only===id;
 if(want('naver_searchad_keyword')&&await connected('naver_searchad'))for(const part of chunk(keywords,DAILY.keywordsPerHint))steps.push({sourceId:'naver_searchad_keyword',op:'keywordstool',keywords:part});
 if(await connected('naver_developers')){
  if(want('naver_datalab_search'))for(const part of chunk(dlGroups,DAILY.groupsPerDatalab))steps.push({sourceId:'naver_datalab_search',op:'datalab',groups:part});
  if(want('naver_shop_search'))for(const k of keywords.slice(0,DAILY.shopKeywords))steps.push({sourceId:'naver_shop_search',op:'shop',keyword:k});
 }
 if(want('youtube_data')&&await connected('youtube')){
  for(let i=0;i<DAILY.youtubeDiscover&&keywords.length;i++)steps.push({sourceId:'youtube_data',op:'yt_search',keyword:keywords[(state.youtubeCursor+i)%keywords.length]});
  for(let c=0;c<Math.ceil(DAILY.trackedVideos/50);c++)steps.push({sourceId:'youtube_data',op:'yt_track',chunk:c});
 }
 if(want('coupang_partners')&&await connected('coupang_partners')&&CATEGORIES.some(c=>settings.categories.includes(c.id)&&c.group==='food'))steps.push({sourceId:'coupang_partners',op:'coupang_best',categoryId:COUPANG_FOOD_CATEGORY});
 return steps;
}

// 검색광고 응답은 연관 키워드가 최대 1,000개라 힌트와 검색수 상위 100개만 저장한다(본문 해시·크기는 원래 응답 그대로).
function trimRelated(r:CollectResult,hints:readonly string[]):CollectResult{
 const vol=new Map<string,number>();
 for(const o of r.draft.observations)if(o.subject.type==='keyword'&&o.metric==='search_volume_month')vol.set(o.subject.text,o.value??-1);
 if(vol.size<=DAILY.keepRelated+hints.length)return r;
 const h=new Set(hints.map(x=>x.toLowerCase())),keep=new Set([...vol.keys()].filter(k=>h.has(k.replace(/\s+/g,'').toLowerCase())));
 for(const [k] of [...vol.entries()].sort((a,b)=>b[1]-a[1]||(a[0]<b[0]?-1:1)))if(keep.size<DAILY.keepRelated+hints.length)keep.add(k);
 return {...r,draft:{...r.draft,observations:r.draft.observations.filter(o=>o.subject.type==='keyword'&&keep.has(o.subject.text)),limitations:[...r.draft.limitations,`연관 키워드 ${vol.size}개 중 힌트와 검색수 상위 ${DAILY.keepRelated}개만 저장했습니다(나머지는 버림, 본문 해시는 원래 응답 기준).`]}};
}

type Creds=Partial<Record<CredentialKey,ResearchCredential|null>>;
async function credFor(owner:string,cache:Creds,sourceId:SourceId){
 const key=CREDENTIAL_FOR_SOURCE[sourceId] as CredentialKey|null;if(!key)return null;
 if(!(key in cache))cache[key]=await loadCredential(owner,key);
 return cache[key]??null;
}
async function call(step:CollectStep,cred:ResearchCredential,state:CollectState,deps:CollectDeps):Promise<{results:CollectResult[];videoIds?:string[];skipped?:boolean}>{
 const now=deps.now();
 switch(step.op){
  case 'keywordstool':return {results:[trimRelated(await collectSearchadKeywords(cred as NaverSearchadCredential,step.keywords,deps),step.keywords)]};
  case 'datalab':{
   const end=new Date(Date.parse(`${kstDayKey(now)}T00:00:00Z`)-DAY),start=new Date(end.getTime()-(104*7-1)*DAY);
   return {results:[await collectDatalabSearch(cred as NaverDevelopersCredential,{startDate:start.toISOString().slice(0,10),endDate:end.toISOString().slice(0,10),timeUnit:'week',keywordGroups:step.groups},deps)]};
  }
  case 'shop':return {results:[await collectShopSearch(cred as NaverDevelopersCredential,step.keyword,deps)]};
  case 'yt_search':{const r=await discoverYoutubeVideos(cred as YoutubeCredential,{keyword:step.keyword,publishedAfter:new Date(now.getTime()-30*DAY).toISOString(),maxResults:DAILY.videosPerKeyword},deps);return {results:[r],videoIds:r.videoIds}}
  case 'yt_track':{const ids=state.videos.slice(step.chunk*50,step.chunk*50+50).map(v=>v.id);if(!ids.length)return {results:[],skipped:true};return {results:[await trackYoutubeVideos(cred as YoutubeCredential,ids,deps)]}}
  case 'coupang_best':return {results:[await collectCoupangBestCategory(cred as CoupangPartnersCredential,step.categoryId,deps,50)]};
 }
}

// 계획의 다음 단계들을 실행한다. 단계마다: 쿼터 예약 → 호출 → 스냅샷 저장. 인증·쿼터 오류는 그 출처의 오늘 남은 단계를 건너뛴다.
export async function runSteps(owner:string,state:CollectState,budget:number,deps:CollectDeps):Promise<{calls:number;stored:number}>{
 const cache:Creds={};let calls=0,stored=0;
 while(state.cursor<state.plan.length&&calls<budget){
  const step=state.plan[state.cursor++],src=step.sourceId,now=deps.now(),at=now.toISOString();
  if(state.skip.includes(src))continue;
  const fail=(code:string,message:string,skip=false)=>{state.errors[src]={code,message,at};if(skip&&!state.skip.includes(src))state.skip.push(src)};
  let cred:ResearchCredential|null;
  try{cred=await credFor(owner,cache,src)}catch(e){fail('credential',e instanceof ApiError?e.message:'저장된 자격증명을 읽지 못했습니다.',true);continue}
  if(!cred){fail('not_connected',`${sourceSpec(src).label} 연결이 없어 건너뛰었습니다.`,true);continue}
  if(step.op==='yt_track'&&!state.videos.slice(step.chunk*50,step.chunk*50+50).length)continue;
  const units=unitsFor(src,opOf(step));
  if(!await reserveQuota(owner,src,units,now)){fail('quota',`${sourceSpec(src).label} 오늘 쿼터(${sourceSpec(src).dailyQuota?.toLocaleString('ko-KR')}단위)를 넘게 돼 호출하지 않았습니다.`,true);continue}
  calls++;
  try{
   const out=await call(step,cred,state,deps);
   const snaps:Snapshot[]=out.results.map(r=>({...r.draft,id:crypto.randomUUID(),importedBy:null}));
   if(snaps.length){await ensureSnapshotRoom(owner,snaps.length,now,()=>referencedSnapshots(owner));await database().batch(snaps.map(s=>snapshotStatement(owner,s)));stored+=snaps.length}
   if(out.videoIds&&step.op==='yt_search'){
    const known=new Set(state.videos.map(v=>v.id));
    for(const id of out.videoIds)if(!known.has(id)){state.videos.push({id,keyword:step.keyword,addedAt:at});known.add(id)}
    if(state.videos.length>DAILY.trackedVideos)state.videos=state.videos.slice(state.videos.length-DAILY.trackedVideos);
    state.youtubeCursor++;
   }
   delete state.errors[src];
  }catch(e){
   if(e instanceof CollectorError){
    if(e.code==='input'||e.code==='not_allowed')await refundQuota(owner,src,units,now);
    fail(e.code,e.message,e.code==='auth'||e.code==='quota'||e.code==='not_allowed');
   }else fail('storage',e instanceof ApiError?e.message:'수집 결과를 저장하지 못했습니다.');
  }
 }
 return {calls,stored};
}

async function finishIfDone(owner:string,state:CollectState,deps:CollectDeps,force:boolean){
 const now=deps.now();state.lastRunAt=now.toISOString();
 if(state.cursor>=state.plan.length){state.done=true;state.nextRunAt=nextKstMidnight(now)}
 await saveState(owner,state);
 if(state.done||force)await recompute(owner,now,state.videos);
}

// 워커 큐(product_research). 두 스위치가 모두 켜졌을 때만 일한다. 반환 status는 'idle'|'processed'(파이썬 워커 허용값 안).
export async function runProductResearchQueue(owner:string,deps:CollectDeps=defaultDeps()):Promise<{status:'idle'|'processed'}>{
 if(!await researchEnabled(owner)||!await collectEnabled(owner))return {status:'idle'};
 const now=deps.now(),today=kstDayKey(now);
 let state=await readCollectState(owner);
 if(state.day===today&&state.done)return {status:'idle'};
 if(state.day!==today){
  await pruneQuota(owner,now);
  state={...state,day:today,cursor:0,done:false,skip:[],plan:[]};
  state.plan=await buildPlan(owner,state);
  if(!state.plan.length){state.done=true;state.lastRunAt=now.toISOString();state.nextRunAt=nextKstMidnight(now);await saveState(owner,state);return {status:'idle'}}
 }
 await runSteps(owner,state,STEPS_PER_TICK,deps);
 await finishIfDone(owner,state,deps,false);
 return {status:'processed'};
}

// 워커 라우트용: 두 스위치가 모두 켜진 소유자에게만 큐 콜백을 준다(꺼져 있으면 undefined → 워커 순환에 큐가 없다). 스위치를 못 읽으면 꺼짐으로 본다.
export async function productResearchQueue(owner:string):Promise<((owner:string)=>Promise<{status:'idle'|'processed'}>)|undefined>{
 return await researchEnabled(owner)&&await collectEnabled(owner)?(o:string)=>runProductResearchQueue(o):undefined;
}

// 소유자 즉시 수집(collect_now): 하루 1회 제한 없이 새 계획을 세워 바로 실행한다(쿼터 원장이 하루 한도를 지킨다). 남은 단계는 워커가 이어 간다.
export async function collectNow(owner:string,sourceId:SourceId|undefined,deps:CollectDeps=defaultDeps()){
 if(!await collectEnabled(owner))throw new ApiError(409,'자동 수집 스위치(product_research_collect)가 꺼져 있습니다. 소유자가 켠 뒤 다시 시도하세요.');
 if(sourceId&&!sourceSpec(sourceId).autoFetch)throw new ApiError(400,'자동 수집을 하지 않는 출처입니다. 운영자 가져오기를 쓰세요.');
 const now=deps.now(),state=await readCollectState(owner);
 state.day=kstDayKey(now);state.cursor=0;state.done=false;state.skip=[];
 state.plan=await buildPlan(owner,state,sourceId);
 if(!state.plan.length)throw new ApiError(409,'연결된 자동 수집 출처가 없습니다. 출처 연결에서 키를 먼저 등록하세요.');
 const r=await runSteps(owner,state,STEPS_PER_COLLECT_NOW,deps);
 await finishIfDone(owner,state,deps,true);
 return {...r,remaining:state.plan.length-state.cursor,at:stamp()};
}
