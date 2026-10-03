// 상품 리서치 자동 수집 계획·실행(서버). 공식 API만, 출처별 하루 쿼터 안에서만 호출한다(collectors/*가 레지스트리 밖 호스트를 막는다).
// 한국 날짜(KST)로 하루 1번 계획을 세우고(pr_collect_state.plan), 워커 tick마다 정해진 수만큼 호출해 이어 간다. 한 출처의 실패는 다른 출처를 멈추지 않는다.
// 계획 한 번의 크기: 검색광고 키워드 40개(호출당 5개), 데이터랩 검색어 트렌드 묶음 40개(호출당 5개, 최근 104주 주간), 쇼핑 검색 키워드 20개,
// YouTube 발견 3개(search.list 100단위씩)와 추적 영상 200개(videos.list 50개씩), 쿠팡 파트너스 식품 베스트 1회. 계획을 다 돌면 재계산한다.
// 하루 상한은 계획과 별개로 쿼터 원장(collectors/quota.ts APP_DAILY_CAPS)이 지킨다. 즉시 수집은 한국 날짜 하루 3번까지, 남은 상한 안에서만 쓴다(평가 1회차 H4).
// 일시 오류(네트워크·시간 초과·5xx·429)는 그 출처만 물러났다가(5분·20분) 다음 작업자 순환에서 다시 시도한다. 하루 3번 실패하면 그 출처는 내일 다시 한다(⑪).
// 모든 실행은 상품 리서치 잠금(server-store.ts researchLockKey) 안에서 한다. 화면 쓰기와 작업자 수집이 같은 키를 쓴다(H5).
import {ApiError,stamp} from '../server';
import {COLLECT_NOW_PER_DAY} from './api';
import {CATEGORIES} from './categories';
import {CREDENTIAL_FOR_SOURCE} from './credentials';
import type {CredentialKey} from './api';
import {sourceSpec} from './sources';
import {collectSearchadKeywords,collectDatalabSearch,collectShopSearch,discoverYoutubeVideos,trackYoutubeVideos,collectCoupangBestCategory,CollectorError,kstDayKey,unitsFor,type CollectDeps,type CollectResult,type QuotaOperation} from './collectors/index';
import {dailyCap,kstWeekKey} from './collectors/quota';
import type {NaverSearchadCredential,NaverDevelopersCredential,YoutubeCredential,CoupangPartnersCredential,ResearchCredential} from './credentials';
import {normalizeKeyword} from './analytics/normalize';
import {K,RESEARCH_LOCK_BUSY,RESEARCH_LOCK_LOST,ResearchLockLost,acquireResearchLock,collectEnabled,ensureSnapshotRoom,loadCredential,markQuotaOk,optional,pruneQuota,putStatement,readSettings,refundQuota,releaseResearchLock,renewResearchLock,reserveQuota,researchEnabled,snapshotStatement} from './server-store';
import {loadGroups,loadProducts,referencedSnapshots,type CollectVideo} from './server-pipeline';
import {refreshScores,weeklyReport,type DerivedState} from './server-ops';
import {database} from '../server';
import type {Snapshot,SourceId} from './types';

export const DAILY={keywords:40,datalabGroups:40,shopKeywords:20,youtubeDiscover:3,trackedVideos:200,videosPerKeyword:10,keywordsPerHint:5,groupsPerDatalab:5,keepRelated:100};
export const STEPS_PER_TICK=12,STEPS_PER_COLLECT_NOW=30;
// 실행 시간 상한(평가 2회차 M4): 잠금 만료(120초)보다 짧게 90초. 단계마다 주입한 시계(deps.now)로 재고, 넘으면 남은 단계는 두고 진행 상태를 저장한 뒤 멈춘다.
// 단계마다 잠금도 갱신한다(server-store.ts renewResearchLock). 잠금을 잃었으면(만료 뒤 다른 실행이 가져감) 상태를 저장하지 않고 멈춘다(두 실행이 수집 상태를 덮어쓰지 않게).
export const RUN_TIME_BUDGET_MS=90_000;
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
// pending: 일시 오류로 물러난 단계(출처별 nextAttemptAt 뒤 다시 시도). attempts: 출처별 오늘 일시 오류 횟수(하루 3번이면 그 출처는 오늘 멈춤).
// failures: 출처별 연속 실패(성공하면 지움) — 화면 경보(alerts)의 since. manualRuns: 오늘 즉시 수집 횟수. weekly: 마지막 주간 MD 리포트.
export type CollectFailure={since:string;message:string;count:number};
export type WeeklyReportState={week:string;briefId:string|null;at:string;reason:string|null};
// calibration·outcomes(평가 2회차): 마지막 재계산의 데이터랩 보정 보고와 출시 뒤 결과(server-ops.ts refreshScores가 채운다). stoppedAt: 시간 상한으로 멈춘 마지막 시각.
export type CollectState={day:string|null;plan:CollectStep[];cursor:number;done:boolean;lastRunAt:string|null;nextRunAt:string|null;errors:Partial<Record<SourceId,CollectError>>;skip:SourceId[];videos:CollectVideo[];youtubeCursor:number;
 pending:CollectStep[];nextAttemptAt:Partial<Record<SourceId,string>>;attempts:Partial<Record<SourceId,{day:string;count:number}>>;failures:Partial<Record<SourceId,CollectFailure>>;manualRuns:{day:string;count:number}|null;weekly:WeeklyReportState|null;
 calibration?:DerivedState['calibration']|null;outcomes?:DerivedState['outcomes']|null;stoppedAt?:string|null};
export const emptyCollectState=():CollectState=>({day:null,plan:[],cursor:0,done:false,lastRunAt:null,nextRunAt:null,errors:{},skip:[],videos:[],youtubeCursor:0,pending:[],nextAttemptAt:{},attempts:{},failures:{},manualRuns:null,weekly:null,calibration:null,outcomes:null,stoppedAt:null});
export const MAX_ATTEMPTS_PER_DAY=3,RETRY_BACKOFF_MS=[5*60000,20*60000] as const;
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

// 일시 오류: 같은 요청을 조금 뒤 다시 보내면 성공할 수 있는 실패(네트워크·시간 초과·5xx·429). 인증·형식·입력·하루 쿼터 소진은 아니다.
export function isTransient(e:unknown){return e instanceof CollectorError&&(e.code==='network'||e.code==='timeout'||(e.code==='http'&&(e.status??0)>=500)||(e.code==='quota'&&e.status===429))}
const due=(state:CollectState,src:SourceId,now:Date)=>{const at=state.nextAttemptAt[src];return !at||Date.parse(at)<=now.getTime()};
// 다음에 실행할 단계: 물러났다가 때가 된 단계가 먼저, 그다음 계획 순서. 아직 물러나 있는 출처의 계획 단계는 pending으로 옮긴다.
function nextStep(state:CollectState,now:Date):CollectStep|null{
 const i=state.pending.findIndex(p=>!state.skip.includes(p.sourceId)&&due(state,p.sourceId,now));
 if(i>=0)return state.pending.splice(i,1)[0];
 while(state.cursor<state.plan.length){
  const step=state.plan[state.cursor++];
  if(state.skip.includes(step.sourceId))continue;
  if(!due(state,step.sourceId,now)){state.pending.push(step);continue}
  return step;
 }
 return null;
}
export const planDone=(s:CollectState)=>s.cursor>=s.plan.length&&!s.pending.some(p=>!s.skip.includes(p.sourceId));
const hasDueWork=(s:CollectState,now:Date)=>s.plan.slice(s.cursor).some(p=>!s.skip.includes(p.sourceId))||s.pending.some(p=>!s.skip.includes(p.sourceId)&&due(s,p.sourceId,now));

// 계획의 다음 단계들을 실행한다. 단계마다: 쿼터 예약 → 호출 → 스냅샷 저장. 인증·하루 쿼터 오류는 그 출처의 오늘 남은 단계를 건너뛴다.
// 시간 상한(RUN_TIME_BUDGET_MS)을 넘으면 다음 단계를 꺼내지 않고 멈춘다(stopped='time'). 단계마다 잠금을 갱신하고, 잃었으면 ResearchLockLost를 던진다(호출자는 상태를 저장하지 않는다).
export async function runSteps(owner:string,state:CollectState,budget:number,deps:CollectDeps):Promise<{calls:number;stored:number;stopped:'time'|null}>{
 const cache:Creds={},deadline=deps.now().getTime()+RUN_TIME_BUDGET_MS;let calls=0,stored=0,stopped:'time'|null=null;
 while(calls<budget){
  if(deps.now().getTime()>=deadline){if(hasDueWork(state,deps.now()))stopped='time';break}
  if(await renewResearchLock(owner)===false)throw new ResearchLockLost();
  const now=deps.now(),step=nextStep(state,now);if(!step)break;
  const src=step.sourceId,at=now.toISOString(),today=kstDayKey(now);
  const fail=(code:string,message:string,skip=false)=>{
   state.errors[src]={code,message,at};const f=state.failures[src];state.failures[src]={since:f?.since??at,message,count:(f?.count??0)+1};
   if(skip&&!state.skip.includes(src))state.skip.push(src);
   if(skip)state.pending=state.pending.filter(p=>p.sourceId!==src);
  };
  let cred:ResearchCredential|null;
  try{cred=await credFor(owner,cache,src)}catch(e){fail('credential',e instanceof ApiError?e.message:'저장된 자격증명을 읽지 못했습니다.',true);continue}
  if(!cred){fail('not_connected',`${sourceSpec(src).label} 연결이 없어 건너뛰었습니다.`,true);continue}
  if(step.op==='yt_track'&&!state.videos.slice(step.chunk*50,step.chunk*50+50).length)continue;
  const units=unitsFor(src,opOf(step));
  if(!await reserveQuota(owner,src,units,now)){fail('quota',`${sourceSpec(src).label} 오늘 쿼터 상한(${dailyCap(src).toLocaleString('ko-KR')}단위)을 넘게 돼 호출하지 않았습니다.`,true);continue}
  calls++;
  try{
   const out=await call(step,cred,state,deps);
   const snaps:Snapshot[]=out.results.map(r=>({...r.draft,id:crypto.randomUUID(),importedBy:null}));
   if(snaps.length){await ensureSnapshotRoom(owner,snaps.length,now,()=>referencedSnapshots(owner));await database().batch(snaps.map(s=>snapshotStatement(owner,s)));stored+=snaps.length}
   // 정상 수집(30일 성공률의 분자)은 저장까지 끝난 호출만 센다. 저장 실패는 성공이 아니다.
   await markQuotaOk(owner,src,now);
   if(out.videoIds&&step.op==='yt_search'){
    const known=new Set(state.videos.map(v=>v.id));
    for(const id of out.videoIds)if(!known.has(id)){state.videos.push({id,keyword:step.keyword,addedAt:at});known.add(id)}
    if(state.videos.length>DAILY.trackedVideos)state.videos=state.videos.slice(state.videos.length-DAILY.trackedVideos);
    state.youtubeCursor++;
   }
   delete state.errors[src];delete state.failures[src];delete state.nextAttemptAt[src];
  }catch(e){
   if(isTransient(e)){
    const err=e as CollectorError,prev=state.attempts[src],n=(prev?.day===today?prev.count:0)+1;state.attempts[src]={day:today,count:n};
    if(n>=MAX_ATTEMPTS_PER_DAY){delete state.nextAttemptAt[src];fail(err.code,`${err.message} 오늘 ${n}번 실패해 이 출처는 내일 다시 시도합니다.`,true)}
    else{const wait=RETRY_BACKOFF_MS[Math.min(n-1,RETRY_BACKOFF_MS.length-1)];state.nextAttemptAt[src]=new Date(now.getTime()+wait).toISOString();state.pending.push(step);fail(err.code,`${err.message} ${Math.round(wait/60000)}분 뒤 다음 작업자 순환에서 다시 시도합니다(오늘 ${n}/${MAX_ATTEMPTS_PER_DAY}번째 실패).`)}
   }else if(e instanceof CollectorError){
    if(e.code==='input'||e.code==='not_allowed')await refundQuota(owner,src,units,now);
    fail(e.code,e.message,e.code==='auth'||e.code==='quota'||e.code==='not_allowed');
   }else fail('storage',e instanceof ApiError?e.message:'수집 결과를 저장하지 못했습니다.');
  }
 }
 return {calls,stored,stopped};
}

async function finishIfDone(owner:string,state:CollectState,deps:CollectDeps,force:boolean,stopped:'time'|null=null){
 const now=deps.now();state.lastRunAt=now.toISOString();
 if(stopped)state.stoppedAt=now.toISOString();
 if(planDone(state)){state.done=true;state.nextRunAt=nextKstMidnight(now)}
 else if(state.cursor>=state.plan.length){
  // 계획은 다 돌았고 물러난 단계만 남았다: 다음 실행 시각은 가장 이른 재시도 시각이다.
  const waits=state.pending.filter(p=>!state.skip.includes(p.sourceId)).map(p=>state.nextAttemptAt[p.sourceId]).filter((x):x is string=>!!x).sort();
  state.nextRunAt=waits[0]??state.nextRunAt;
 }
 if(await renewResearchLock(owner)===false)throw new ResearchLockLost();
 await saveState(owner,state);
 // 즉시 수집이 시간 상한으로 멈췄으면 재계산은 작업자가 계획을 마칠 때로 미룬다. 재계산이 남긴 파생 값(보정 보고·출시 뒤 결과)은 메모리 상태에도 옮긴다(뒤의 저장이 덮어쓰지 않게).
 if(state.done||(force&&!stopped)){const r=await refreshScores(owner,now,state.videos);state.calibration=r.derived.calibration;state.outcomes=r.derived.outcomes}
}
// 주간 MD 리포트: 오늘 계획을 마친 뒤, 한국 날짜 기준 이번 주(월요일 시작)에 아직 만들지 않았으면 한 번 만든다(보통 월요일).
async function weeklyIfDue(owner:string,state:CollectState,now:Date){
 const week=kstWeekKey(now);
 if(!state.done||state.weekly?.week===week)return false;
 const r=await weeklyReport(owner,now);
 state.weekly={week,briefId:r.briefId,at:now.toISOString(),reason:r.reason};
 if(await renewResearchLock(owner)===false)throw new ResearchLockLost();
 await saveState(owner,state);
 return true;
}
const startDay=(state:CollectState,today:string):CollectState=>({...state,day:today,cursor:0,done:false,skip:[],plan:[],pending:[],nextAttemptAt:{},attempts:{}});

// 워커 큐(product_research). 두 스위치가 모두 켜졌을 때만 일한다. 반환 status는 'idle'|'processed'(파이썬 워커 허용값 안).
// 화면 쓰기가 상품 리서치 잠금을 잡고 있으면 기다리지 않고 idle로 넘긴다(다음 tick에 이어 간다).
export async function runProductResearchQueue(owner:string,deps:CollectDeps=defaultDeps()):Promise<{status:'idle'|'processed'}>{
 if(!await researchEnabled(owner)||!await collectEnabled(owner))return {status:'idle'};
 let token:string;
 try{token=await acquireResearchLock(owner,0)}catch(e){if(e instanceof ApiError&&e.message===RESEARCH_LOCK_BUSY)return {status:'idle'};throw e}
 try{
  const now=deps.now(),today=kstDayKey(now);
  let state=await readCollectState(owner);
  if(state.day===today&&state.done)return {status:await weeklyIfDue(owner,state,now)?'processed':'idle'};
  if(state.day!==today){
   await pruneQuota(owner,now);
   state=startDay(state,today);
   state.plan=await buildPlan(owner,state);
   if(!state.plan.length){state.done=true;state.lastRunAt=now.toISOString();state.nextRunAt=nextKstMidnight(now);await saveState(owner,state);await weeklyIfDue(owner,state,now);return {status:'idle'}}
  }
  // 물러난 출처만 남았고 아직 때가 아니면 호출 없이 쉰다.
  if(!hasDueWork(state,now))return {status:'idle'};
  const r=await runSteps(owner,state,STEPS_PER_TICK,deps);
  await finishIfDone(owner,state,deps,false,r.stopped);
  await weeklyIfDue(owner,state,deps.now());
  return {status:'processed'};
 }catch(e){
  // 잠금을 잃었으면 다른 실행이 수집 상태를 이어 쓴다. 이 실행은 아무것도 저장하지 않고 쉰다.
  if(e instanceof ResearchLockLost)return {status:'idle'};
  throw e;
 }finally{await releaseResearchLock(owner,token)}
}

// 워커 라우트용: 두 스위치가 모두 켜진 소유자에게만 큐 콜백을 준다(꺼져 있으면 undefined → 워커 순환에 큐가 없다). 스위치를 못 읽으면 꺼짐으로 본다.
export async function productResearchQueue(owner:string):Promise<((owner:string)=>Promise<{status:'idle'|'processed'}>)|undefined>{
 return await researchEnabled(owner)&&await collectEnabled(owner)?(o:string)=>runProductResearchQueue(o):undefined;
}

// 소유자 즉시 수집(collect_now): 한국 날짜 하루 COLLECT_NOW_PER_DAY(3)번까지. 호출자(server.ts)가 상품 리서치 잠금을 잡고 부른다.
// 출처를 고르지 않으면 오늘 계획을 이어서(끝났으면 새로) 30단계까지 실행하고, 남은 단계는 워커가 이어 간다.
// 출처를 고르면 그 출처의 계획만 30단계까지 실행하고 오늘 계획의 위치는 건드리지 않는다. 어느 쪽이든 쿼터 원장의 남은 상한 안에서만 호출한다.
export async function collectNow(owner:string,sourceId:SourceId|undefined,deps:CollectDeps=defaultDeps()){
 if(!await collectEnabled(owner))throw new ApiError(409,'자동 수집 스위치(product_research_collect)가 꺼져 있습니다. 소유자가 켠 뒤 다시 시도하세요.');
 if(sourceId&&!sourceSpec(sourceId).autoFetch)throw new ApiError(400,'자동 수집을 하지 않는 출처입니다. 운영자 가져오기를 쓰세요.');
 const now=deps.now(),today=kstDayKey(now);
 let state=await readCollectState(owner);
 const used=state.manualRuns?.day===today?state.manualRuns.count:0;
 if(used>=COLLECT_NOW_PER_DAY)throw new ApiError(409,`즉시 수집은 한국 날짜 기준 하루 ${COLLECT_NOW_PER_DAY}번까지입니다. 오늘은 모두 썼습니다. 남은 단계는 작업자가 이어 갑니다.`);
 let r:{calls:number;stored:number;stopped:'time'|null},remaining:number;
 try{
 if(!sourceId){
  if(state.day!==today){await pruneQuota(owner,now);state=startDay(state,today);state.plan=await buildPlan(owner,state)}
  else if(state.done||!state.plan.length){state={...state,cursor:0,done:false,skip:[],pending:[]};state.plan=await buildPlan(owner,state)}
  if(!state.plan.length)throw new ApiError(409,'연결된 자동 수집 출처가 없습니다. 출처 연결에서 키를 먼저 등록하세요.');
  r=await runSteps(owner,state,STEPS_PER_COLLECT_NOW,deps);
  remaining=state.plan.length-state.cursor+state.pending.length;
 }else{
  const plan=await buildPlan(owner,state,sourceId);
  if(!plan.length)throw new ApiError(409,'연결된 자동 수집 출처가 없습니다. 출처 연결에서 키를 먼저 등록하세요.');
  const daily={plan:state.plan,cursor:state.cursor,pending:state.pending,skip:state.skip};
  state.plan=plan;state.cursor=0;state.pending=[];state.skip=[];
  r=await runSteps(owner,state,STEPS_PER_COLLECT_NOW,deps);
  remaining=plan.length-state.cursor+state.pending.length;
  // 고른 출처에서 생긴 건너뛰기(인증·상한)는 오늘 계획에도 이어진다(같은 키·같은 상한). 물러난 단계는 버린다(작업자가 오늘 계획으로 다시 부른다).
  state.skip=[...new Set([...daily.skip,...state.skip])];
  state.plan=daily.plan;state.cursor=daily.cursor;state.pending=daily.pending;
 }
 state.manualRuns={day:today,count:used+1};
 await finishIfDone(owner,state,deps,true,r.stopped);
 }catch(e){if(e instanceof ResearchLockLost)throw new ApiError(409,RESEARCH_LOCK_LOST);throw e}
 // stopped='time': 90초 상한으로 남은 단계를 두고 멈췄다(작업자가 이어 간다).
 return {...r,remaining,runsToday:used+1,at:stamp()};
}
