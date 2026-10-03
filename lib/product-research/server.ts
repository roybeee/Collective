// 상품 리서치·MD 에이전트 서버(P4·P5). 화면 응답(GET)과 쓰기 작업 12종(api.ts RESEARCH_ACTIONS)을 처리한다.
// 권한: 조회·쓰기는 대표·관리자, 출처 연결·해제·즉시 수집은 소유자만. 모든 쓰기는 기능 스위치 product_research가 켜져 있어야 하고 requestId(uuid v4)로 멱등이다.
// 하지 않는 것: 발주·결제·오퍼·카탈로그 가격·공급자 연락(mayOrder:false). 승인 결정은 성장2 캠페인의 시장 근거(growth_signal)로만 넘긴다.
import type {Campaign} from '../agency';
import {ApiError,database,readRecord,recordStatement,type Actor} from '../server';
import {requireGrowthRunning} from '../growth-stop-server';
import {parseSignalInput,signalEvidence,GrowthMarketError,type SignalInput} from '../growth-market';
import type {GrowthRecord} from '../growth-workspace-server';
import {storefrontDigest} from '../storefront-orders';
import {CREDENTIAL_KEYS,RESEARCH_ACTIONS,type CredentialKey,type ResearchAction,type ResearchViewResponse} from './api';
import {SOURCES,IMPORTABLE_SOURCES,sourceSpec} from './sources';
import {CREDENTIAL_FOR_SOURCE,CredentialError,parseResearchCredential,type ResearchCredential} from './credentials';
import {collectSearchadKeywords,collectDatalabSearch,trackYoutubeVideos,collectCoupangSearch,parseImport,CollectorError,kstDayKey,quotaDayKey,type CollectDeps,type ImportSourceId} from './collectors/index';
import {buildBrief} from './analytics/brief';
import {cleanTitle} from './analytics/match';
import {shortId} from './analytics/hash';
import {timeOf} from './analytics/series';
import {normalizeKeyword} from './analytics/normalize';
import {K,MAX_PRODUCTS,UUID_V4,appendStatement,bulkPut,collectEnabled,countKind,credentialStatus,ensureRequestRoom,ensureSnapshotRoom,optional,parseSettings,putStatement,readMany,readSettings,recentSnapshots,refundQuota,requestStatement,requireResearch,researchEnabled,reserveQuota,sealCredential,snapshotStatement,type RequestRow,type StoredCredential} from './server-store';
import {backtest,isPinned,latestDecisions,loadDecisions,loadGroups,loadMaterial,loadProducts,loadScores,material,recompute,referencedSnapshots,RECOMPUTE_WINDOW_DAYS,RECOMPUTE_MAX_SNAPSHOTS,type StoredProduct} from './server-pipeline';
import {collectNow,defaultDeps,readCollectState} from './server-collect';
import {briefInputs,modelBrief,templateBrief,ResearchError,type ModelJob} from './server-brief';
import type {BacktestResult,MdBrief,MdDecision,ScoreCard,Series,Snapshot,SourceId} from './types';

export {ResearchError} from './server-brief';
export {runProductResearchQueue} from './server-collect';
const DAY=86400000;
const VIEW_PRODUCTS=500,SERIES_WEEKS=104,MAX_BRIEFS=2000,MAX_DECISIONS=5000,MAX_BACKTESTS=200;
const TIER_LABEL:Record<ScoreCard['tier'],string>={adopt:'도입 검토',watch:'관찰',needs_data:'자료 보강',reject:'제외'};
const TIER_ORDER:Record<ScoreCard['tier'],number>={adopt:0,watch:1,needs_data:2,reject:3};

// ── 조회
type SnapshotMeta={id:string;sourceId:SourceId;fetchedAt:string;status:Snapshot['status']};
async function sourceRows(owner:string,creds:Awaited<ReturnType<typeof credentialStatus>>,now:Date){
 return Promise.all(SOURCES.map(async s=>{
  const last=await database().prepare("SELECT json_extract(data,'$.fetchedAt') f,json_extract(data,'$.status') st FROM records WHERE owner=? AND kind=? AND parent_id=? ORDER BY updated_at DESC LIMIT 1").bind(owner,K.snapshot,s.id).first<{f:string|null;st:Snapshot['status']|null}>();
  const key=CREDENTIAL_FOR_SOURCE[s.id];
  const connected=s.method==='manual'?true:s.method==='internal'?false:!!creds.find(c=>c.key===key)?.connected;
  const used=s.autoFetch?((await optional<{used:number}>(owner,K.quota,`${s.id}:${quotaDayKey(s.id,now)}`))?.used??0):null;
  return {id:s.id,label:s.label,method:s.method,connected,lastFetchedAt:last?.f??null,lastStatus:last?.st??null,quotaUsedToday:used,dailyQuota:s.dailyQuota};
 }));
}
async function snapshotMeta(owner:string,ids:readonly string[]):Promise<SnapshotMeta[]>{
 const out:SnapshotMeta[]=[],uniq=[...new Set(ids)];
 for(let i=0;i<uniq.length;i+=300){
  const r=await database().prepare("SELECT json_extract(data,'$.id') id,json_extract(data,'$.sourceId') s,json_extract(data,'$.fetchedAt') f,json_extract(data,'$.status') st FROM records WHERE owner=? AND kind=? AND id IN (SELECT value FROM json_each(?))").bind(owner,K.snapshot,JSON.stringify(uniq.slice(i,i+300).map(x=>`${owner}:${K.snapshot}:${x}`))).all<{id:string;s:SourceId;f:string;st:Snapshot['status']}>();
  for(const x of r.results)out.push({id:x.id,sourceId:x.s,fetchedAt:x.f,status:x.st});
 }
 return out;
}
// 상품별 '지난주' 점수표: 현재 판보다 6일 이상 먼저 계산된 판 중 가장 최근 것. 작은 열만 읽는다(momentum은 SUB_SCORES 두 번째).
async function previousScores(owner:string,current:Map<string,ScoreCard>){
 const r=await database().prepare("SELECT parent_id p,json_extract(data,'$.id') id,json_extract(data,'$.total') t,json_extract(data,'$.subScores[1].value') m,json_extract(data,'$.computedAt') c FROM records WHERE owner=? AND kind=? ORDER BY updated_at DESC LIMIT 50000").bind(owner,K.score).all<{p:string;id:string;t:number|null;m:number|null;c:string}>();
 const out=new Map<string,{total:number|null;momentum:number|null;computedAt:string}>();
 const byProduct=new Map([...current.values()].map(c=>[c.productId,c]));
 for(const x of r.results){
  const cur=byProduct.get(x.p);if(!cur||x.id===cur.id||out.has(x.p))continue;
  if(timeOf(x.c)<=timeOf(cur.computedAt)-6*DAY)out.set(x.p,{total:x.t??null,momentum:x.m??null,computedAt:x.c});
 }
 return out;
}
function emptyView(settings:Awaited<ReturnType<typeof readSettings>>):ResearchViewResponse{
 return {enabled:false,collectEnabled:false,focus:{temperature:settings.temperatures,categories:settings.categories},sources:[],products:[],keywordGroups:[],briefs:[],backtests:[],canEdit:false,mayOrder:false,
  settings,credentials:CREDENTIAL_KEYS.map(key=>({key,connected:false,account:null,updatedAt:null})),imports:[],collect:{lastRunAt:null,nextRunAt:null,lastErrors:[]},campaigns:[],canConnect:false,series:[],snapshots:[]};
}

export async function researchView(who:Actor,now=new Date()):Promise<ResearchViewResponse>{
 const owner=who.owner,[enabled,collect,settings,creds]=await Promise.all([researchEnabled(owner),collectEnabled(owner),readSettings(owner),credentialStatus(owner)]);
 const sources=await sourceRows(owner,creds,now);
 // 스위치가 꺼져 있어도 화면이 설명 상태를 그릴 수 있게 같은 모양을 준다(조사 방향·출처 연결은 그대로, 결과 목록은 비움).
 if(!enabled)return {...emptyView(settings),collectEnabled:collect,sources,credentials:creds,canConnect:who.role==='owner'};
 const [products,decisions,groups,briefs,backtests,state,campaigns,imports]=await Promise.all([
  loadProducts(owner),loadDecisions(owner),loadGroups(owner),
  database().prepare('SELECT data FROM records WHERE owner=? AND kind=? ORDER BY updated_at DESC LIMIT 50').bind(owner,K.brief).all<{data:string}>().then(r=>r.results.map(x=>JSON.parse(x.data) as MdBrief)),
  database().prepare('SELECT data FROM records WHERE owner=? AND kind=? ORDER BY updated_at DESC LIMIT 20').bind(owner,K.backtest).all<{data:string}>().then(r=>r.results.map(x=>JSON.parse(x.data) as BacktestResult)),
  readCollectState(owner),
  database().prepare("SELECT data FROM records WHERE owner=? AND kind='campaign' ORDER BY updated_at DESC LIMIT 501").bind(owner).all<{data:string}>().then(r=>r.results.map(x=>JSON.parse(x.data) as Campaign)),
  database().prepare("SELECT json_extract(data,'$.id') id,json_extract(data,'$.sourceId') s,json_extract(data,'$.importedBy.fileName') f,json_extract(data,'$.request.rows') n,json_extract(data,'$.fetchedAt') at,json_extract(data,'$.importedBy.email') e,json_extract(data,'$.importedBy.id') u FROM records WHERE owner=? AND kind=? AND json_extract(data,'$.importedBy') IS NOT NULL ORDER BY updated_at DESC LIMIT 50").bind(owner,K.snapshot).all<{id:string;s:SourceId;f:string;n:number;at:string;e:string|null;u:string}>(),
 ]);
 const scores=await loadScores(owner,products.map(p=>p.scoreId??''));
 const latest=latestDecisions(decisions);
 const listed=products.map(p=>({p,score:p.scoreId?scores.get(p.scoreId)??null:null}))
  .sort((a,b)=>(a.score?TIER_ORDER[a.score.tier]:9)-(b.score?TIER_ORDER[b.score.tier]:9)||(b.score?.total??-1)-(a.score?.total??-1)||(a.p.id<b.p.id?-1:1)).slice(0,VIEW_PRODUCTS);
 const prev=await previousScores(owner,new Map(listed.flatMap(x=>x.score?[[x.p.id,x.score] as const]:[])));
 // 시계열: 화면에 실린 상품의 키워드 묶음·목록 대상만, 시계열마다 최근 104주.
 const m=material(await recentSnapshots(owner,new Date(now.getTime()-RECOMPUTE_WINDOW_DAYS*DAY).toISOString(),RECOMPUTE_MAX_SNAPSHOTS));
 const wanted=new Set<string>();
 for(const {p} of listed){for(const l of p.listings)wanted.add(`ls:${l.sourceId}:${l.externalId}`);for(const g of groups.filter(g=>p.keywordGroupIds.includes(g.id)))for(const k of g.keywords)wanted.add(`kw:${normalizeKeyword(k)}`)}
 const keyNorm=new Set(m.clusters.filter(c=>listed.some(x=>x.p.keywordGroupIds.includes(c.id))).map(c=>`kw:${c.normalized}`));
 const cutoff=now.getTime()-SERIES_WEEKS*7*DAY;
 const series:Series[]=m.series.filter(s=>wanted.has(s.subjectKey)||keyNorm.has(s.subjectKey)).map(s=>({...s,points:s.points.filter(p=>timeOf(p.at)>=cutoff)})).filter(s=>s.points.length);
 const evidence=[...listed.flatMap(x=>x.score?x.score.subScores.flatMap(s=>s.evidence):[]),...briefs.flatMap(b=>b.claims.flatMap(c=>c.citations))];
 const recent=await database().prepare('SELECT id FROM records WHERE owner=? AND kind=? ORDER BY updated_at DESC LIMIT 50').bind(owner,K.snapshot).all<{id:string}>();
 const snapshots=await snapshotMeta(owner,[...evidence,...recent.results.map(r=>r.id.slice(`${owner}:${K.snapshot}:`.length))]);
 const errors=Object.entries(state.errors).filter(([,e])=>!!e).map(([sourceId,e])=>({sourceId:sourceId as SourceId,message:e!.message,at:e!.at}));
 return {
  enabled,collectEnabled:collect,focus:{temperature:settings.temperatures,categories:settings.categories},sources,
  products:listed.map(({p,score})=>{const {scoreId:_s,brandFit:_b,...rest}=p;void _s;void _b;return {...rest,score,decision:latest.get(p.id)??null,previousScore:prev.get(p.id)??null}}),
  keywordGroups:groups,briefs,backtests,canEdit:who.role!=='member',mayOrder:false,
  settings,credentials:creds,
  imports:imports.results.map(r=>({snapshotId:r.id,sourceId:r.s,fileName:r.f,rows:Number(r.n)||0,importedAt:r.at,importedBy:r.e??r.u??null})),
  collect:{lastRunAt:state.lastRunAt,nextRunAt:state.nextRunAt,lastErrors:errors},
  campaigns:campaigns.filter(c=>c.status!=='archived').slice(0,500).map(c=>({id:c.id,title:c.title,version:c.version,brandId:c.brandId})),
  canConnect:who.role==='owner',series,snapshots,
 };
}

// ── 쓰기 공용
const text=(v:unknown,label:string,min:number,max:number)=>{if(typeof v!=='string')throw new ApiError(400,`${label}을 입력하세요.`);const t=v.trim();if(t.length<min||t.length>max||[...t].some(c=>{const n=c.charCodeAt(0);return n<32&&n!==10||n===127}))throw new ApiError(400,`${label}은 ${min}~${max}자로 입력하세요.`);return t};
const idOf=(v:unknown,label:string)=>{if(typeof v!=='string'||!/^[A-Za-z0-9_-]{1,100}$/.test(v))throw new ApiError(400,`${label} 형식을 확인하세요.`);return v};
const OWNER_ONLY:readonly ResearchAction[]=['connect_source','disconnect_source','collect_now'];
type Outcome={writes:D1PreparedStatement[];resultId:string|null;after?:()=>Promise<unknown>;pending?:ModelJob;request?:Partial<RequestRow>};

// 출처 연결 검증: 수집기로 가장 싼 실제 호출 1번(검색광고 힌트 1개, 데이터랩 7일, YouTube 공개 영상 1개, 쿠팡 검색 1개). 결과는 저장하지 않고 쿼터만 센다.
export const VERIFY_VIDEO_ID='jNQXAC9IVRw';
async function verifyCredential(owner:string,c:ResearchCredential,deps:CollectDeps){
 const now=deps.now();
 const plan:{source:SourceId;run:()=>Promise<unknown>}|null=c.kind==='naver_searchad'?{source:'naver_searchad_keyword',run:()=>collectSearchadKeywords(c,['마라소스'],deps)}
  :c.kind==='naver_developers'?{source:'naver_datalab_search',run:()=>{const end=new Date(Date.parse(`${kstDayKey(now)}T00:00:00Z`)-DAY),start=new Date(end.getTime()-6*DAY);return collectDatalabSearch(c,{startDate:start.toISOString().slice(0,10),endDate:end.toISOString().slice(0,10),timeUnit:'date',keywordGroups:[{groupName:'연결확인',keywords:['마라소스']}]},deps)}}
  :c.kind==='youtube'?{source:'youtube_data',run:()=>trackYoutubeVideos(c,[VERIFY_VIDEO_ID],deps)}
  :c.kind==='coupang_partners'?{source:'coupang_partners',run:()=>collectCoupangSearch(c,'라면',deps,1)}
  :null;
 // 계약 데이터는 계약 전이라 부를 고정 호스트가 없다. 형식만 확인하고 저장한다(자동 수집 경로 없음).
 if(!plan)return;
 if(!await reserveQuota(owner,plan.source,1,now))throw new ApiError(409,`${sourceSpec(plan.source).label} 오늘 쿼터를 다 써서 연결 확인 호출을 하지 않았습니다. 내일 다시 시도하세요.`);
 try{await plan.run()}catch(e){
  if(e instanceof CollectorError){
   if(e.code==='input'||e.code==='not_allowed')await refundQuota(owner,plan.source,1,now);
   if(e.code==='auth')throw new ApiError(400,`연결 확인 호출이 거절돼 저장하지 않았습니다. ${e.message}`);
   if(e.code==='quota')throw new ApiError(409,`연결 확인 호출이 쿼터에 막혀 저장하지 않았습니다. ${e.message}`);
   throw new ApiError(502,`연결 확인 호출이 실패해 저장하지 않았습니다. ${e.message}`);
  }
  throw e;
 }
}

async function productOf(owner:string,id:unknown){const p=await optional<StoredProduct>(owner,K.product,idOf(id,'상품 ID'));if(!p)throw new ApiError(404,'상품을 찾을 수 없습니다. 화면을 새로 고치세요.');return p}
const listingKeyOf=(l:{sourceId:string;externalId:string})=>`${l.sourceId}:${l.externalId}`;

async function confirmMatch(who:Actor,b:Record<string,unknown>,now:Date):Promise<Outcome>{
 const owner=who.owner,target=await productOf(owner,b.productId),decision=b.decision;
 if(decision!=='merge'&&decision!=='split')throw new ApiError(400,'확인 방식은 merge(묶기)·split(나누기) 중 하나입니다.');
 const keys=Array.isArray(b.listingKeys)?[...new Set(b.listingKeys)]:[];
 if(!keys.length||keys.length>50||!keys.every(k=>typeof k==='string'&&/^[a-z_]+:.{1,120}$/.test(k)))throw new ApiError(400,'목록 키(출처:외부ID)를 1~50개 고르세요.');
 const by={id:who.id,email:who.email},at=now.toISOString(),pinned=(p:StoredProduct,listings:StoredProduct['listings']):StoredProduct=>({...p,listings,match:{method:'manual',confidence:1,confirmedBy:by},updatedAt:at});
 const writes:D1PreparedStatement[]=[];
 if(decision==='split'){
  const mine=new Set(target.listings.map(listingKeyOf));
  if(!(keys as string[]).every(k=>mine.has(k)))throw new ApiError(400,'이 상품에 묶인 목록만 나눌 수 있습니다.');
  if(keys.length>=target.listings.length)throw new ApiError(400,'모든 목록을 나눌 수는 없습니다. 이 상품에 남길 목록이 1개 이상 있어야 합니다.');
  if(await countKind(owner,K.product)>=MAX_PRODUCTS)throw new ApiError(409,`상품은 ${MAX_PRODUCTS.toLocaleString('ko-KR')}개까지 저장할 수 있습니다.`);
  const moved=target.listings.filter(l=>keys.includes(listingKeyOf(l))),kept=target.listings.filter(l=>!keys.includes(listingKeyOf(l)));
  const id=shortId('prp',{split:[...(keys as string[])].sort(),from:target.id}),head=moved[0];
  const fresh:StoredProduct={...pinned(target,moved),id,name:cleanTitle(head.title,null),brand:null,keywordGroupIds:[],createdAt:at,scoreId:null,brandFit:null};
  writes.push(putStatement(owner,K.product,target.id,pinned(target,kept)),putStatement(owner,K.product,id,fresh));
  return {writes,resultId:id,after:async()=>recompute(owner,now,(await readCollectState(owner)).videos)};
 }
 // merge: 목록을 이 상품으로 옮긴다. 다른 상품에서 빼 오며, 결정이 있는 상품의 목록은 옮기지 않는다.
 const [products,decisions]=await Promise.all([loadProducts(owner),loadDecisions(owner)]),decided=new Set(decisions.map(d=>d.productId));
 const m=await loadMaterial(owner,now),add:StoredProduct['listings']=[];
 for(const k of keys as string[]){
  if(target.listings.some(l=>listingKeyOf(l)===k))continue;
  const holder=products.find(p=>p.id!==target.id&&p.listings.some(l=>listingKeyOf(l)===k)),obs=m.listings.get(k);
  const entry=holder?.listings.find(l=>listingKeyOf(l)===k)??(obs?{sourceId:obs.sourceId,externalId:obs.externalId,title:obs.title,url:obs.url}:null);
  if(!entry)throw new ApiError(404,`관측에 없는 목록입니다: ${k.slice(0,60)}`);
  if(holder){
   if(decided.has(holder.id))throw new ApiError(409,'선정 결정이 있는 상품의 목록은 옮길 수 없습니다. 그 상품을 먼저 정리하세요.');
   holder.listings=holder.listings.filter(l=>listingKeyOf(l)!==k);
   if(isPinned(holder))writes.push(holder.listings.length?putStatement(owner,K.product,holder.id,{...holder,updatedAt:at}):database().prepare('DELETE FROM records WHERE id=? AND owner=? AND kind=?').bind(`${owner}:${K.product}:${holder.id}`,owner,K.product));
  }
  add.push(entry);
 }
 writes.push(putStatement(owner,K.product,target.id,pinned(target,[...target.listings,...add])));
 return {writes,resultId:target.id,after:async()=>recompute(owner,now,(await readCollectState(owner)).videos)};
}

async function decide(who:Actor,b:Record<string,unknown>,now:Date):Promise<Outcome>{
 const owner=who.owner,p=await productOf(owner,b.productId),scoreCardId=idOf(b.scoreCardId,'점수표 ID');
 const status=b.status;if(status!=='approved'&&status!=='hold'&&status!=='rejected')throw new ApiError(400,'결정은 승인·보류·제외 중 하나입니다.');
 const reason=text(b.reason,'결정 사유(한 문장 이상)',5,500);
 if(p.scoreId!==scoreCardId)throw new ApiError(409,'점수표가 새 판으로 바뀌었습니다. 최신 점수표를 확인한 뒤 다시 결정하세요.');
 const card=await optional<ScoreCard>(owner,K.score,scoreCardId);if(!card||card.productId!==p.id)throw new ApiError(404,'점수표를 찾을 수 없습니다.');
 if(status==='approved'&&card.blocked)throw new ApiError(409,`선정 금지 상품은 승인할 수 없습니다: ${card.blocked.reason}`);
 let briefId:string|null=null;
 if(b.briefId!==null&&b.briefId!==undefined){briefId=idOf(b.briefId,'선정 메모 ID');const brief=await optional<MdBrief>(owner,K.brief,briefId);if(!brief||!brief.productIds.includes(p.id))throw new ApiError(404,'이 상품을 다룬 선정 메모가 아닙니다.')}
 if(await countKind(owner,K.decision)>=MAX_DECISIONS)throw new ApiError(409,'선정 결정 기록 한도에 도달했습니다.');
 const d:MdDecision={id:crypto.randomUUID(),productId:p.id,scoreCardId,briefId,status,reason,decidedBy:{id:who.id,email:who.email},decidedAt:now.toISOString(),handoff:null};
 return {writes:[appendStatement(owner,K.decision,d.id,d,p.id)],resultId:d.id};
}

// 공개 https 주소 후보: 입력 → 목록 주소 그대로 → 쿼리·조각을 뺀 주소. 성장 신호 형식 검사(parseSignalInput)를 통과하는 첫 주소를 쓴다.
function signalUrl(candidate:string,base:Omit<SignalInput,'sourceUrl'>){try{return parseSignalInput({...base,sourceUrl:candidate}).sourceUrl}catch{return null}}
async function handoff(who:Actor,b:Record<string,unknown>,now:Date):Promise<Outcome>{
 const owner=who.owner,d=await optional<MdDecision>(owner,K.decision,idOf(b.decisionId,'결정 ID'));
 if(!d)throw new ApiError(404,'선정 결정을 찾을 수 없습니다.');
 if(d.status!=='approved')throw new ApiError(409,'승인한 결정만 성장2로 넘길 수 있습니다.');
 if(d.handoff)throw new ApiError(409,'이미 캠페인으로 넘긴 결정입니다.');
 const latest=latestDecisions(await loadDecisions(owner)).get(d.productId);
 if(latest&&latest.id!==d.id)throw new ApiError(409,'이 상품에 더 최근 결정이 있습니다. 최신 결정으로 다시 시도하세요.');
 let c:Campaign;try{c=await readRecord<Campaign>(owner,'campaign',idOf(b.campaignId,'캠페인 ID'))}catch(e){if(e instanceof ApiError&&e.status===404)throw new ApiError(404,'캠페인을 찾을 수 없습니다.');throw e}
 if(b.campaignVersion!==c.version)throw new ApiError(409,'캠페인이 변경되었습니다. 다시 불러오세요.');
 if(c.status==='archived')throw new ApiError(409,'보관한 캠페인에는 넘길 수 없습니다.');
 await requireGrowthRunning(owner);
 const p=await optional<StoredProduct>(owner,K.product,d.productId),card=await optional<ScoreCard>(owner,K.score,d.scoreCardId);
 if(!p||!card)throw new ApiError(409,'결정이 가리키는 상품·점수표를 찾을 수 없습니다.');
 const evidenceIds=[...new Set(card.subScores.flatMap(s=>s.evidence))];
 const [snaps,groups]=await Promise.all([readMany<Snapshot>(owner,K.snapshot,evidenceIds),loadGroups(owner)]);
 const brief=buildBrief({question:`상품 리서치 승인: ${p.name}`,products:[p],cards:[card],snapshots:[...snaps.values()],keywordGroups:groups,createdAt:now.toISOString(),maxProducts:1,claimsPerProduct:6});
 if(!brief.claims.length||!brief.citationCheck.passed)throw new ApiError(409,'인용할 수 있는 관측값이 없어 시장 근거로 넘기지 않았습니다. 수집·가져오기 뒤 재계산하고 다시 결정하세요.');
 const cited=[...new Set(brief.claims.flatMap(x=>x.citations))],observed=cited.map(id=>snaps.get(id)!.fetchedAt).sort().pop()!;
 const expiresAt=new Date(timeOf(observed)+30*DAY).toISOString();
 if(timeOf(expiresAt)<=now.getTime())throw new ApiError(409,'근거 관측이 30일보다 오래돼 넘기지 않았습니다. 다시 수집한 뒤 재계산·결정하세요.');
 const summaryParts=[`점수표 분류 ${TIER_LABEL[card.tier]}. 인용한 관측:`];
 for(const cl of brief.claims){if([...summaryParts,cl.text].join(' ').length>3600)break;summaryParts.push(`${cl.text}.`)}
 summaryParts.push('발주·가격 승인 없음.');
 const base:Omit<SignalInput,'sourceUrl'>={title:`상품 리서치: ${p.name}`.slice(0,200),observedAt:observed,expiresAt,sourceType:'market',summary:summaryParts.join(' '),sampleSize:null};
 const given=b.sourceUrl===undefined||b.sourceUrl===null||b.sourceUrl===''?null:String(b.sourceUrl);
 let sourceUrl:string|null=null;
 if(given){sourceUrl=signalUrl(given,base);if(!sourceUrl)throw new ApiError(400,'근거 주소는 인증정보·쿼리·내부 주소가 없는 공개 https 주소여야 합니다.')}
 else for(const l of p.listings){if(!l.url)continue;sourceUrl=signalUrl(l.url,base);if(sourceUrl)break;try{const u=new URL(l.url);sourceUrl=signalUrl(u.origin+u.pathname,base)}catch{sourceUrl=null}if(sourceUrl)break}
 if(!sourceUrl)throw new ApiError(409,'상품 목록에 공개 https 주소가 없어(또는 쿼리·추적 값만 있는 주소라) 시장 근거의 출처로 쓸 수 없습니다. 상품 판매 페이지 주소를 sourceUrl로 함께 보내 주세요.');
 let input:SignalInput;try{input=parseSignalInput({...base,sourceUrl})}catch(e){throw new ApiError(400,e instanceof GrowthMarketError?e.message:'시장 근거 형식을 확인하세요.')}
 if(signalEvidence(input,now).status!=='usable')throw new ApiError(409,'근거 유효기한을 확인하세요.');
 const signalId='pr_'+(await storefrontDigest({campaignId:c.id,decisionId:d.id})).slice(0,40);
 if(await optional(owner,'growth_signal',signalId))throw new ApiError(409,'이미 이 캠페인에 넘긴 결정입니다.');
 const cap=async(kind:string,max:number,label:string)=>{const r=await database().prepare('SELECT COUNT(*) n FROM records WHERE owner=? AND kind=? AND parent_id=?').bind(owner,kind,c.id).first<{n:number}>();if((r?.n??0)>=max)throw new ApiError(409,`${label} 한도에 도달했습니다.`)};
 await cap('growth_signal',500,'이 캠페인의 시장 신호');await cap('growth_history',10000,'이 캠페인의 성장 기록');
 const at=now.toISOString(),digest=await storefrontDigest({decisionId:d.id,campaignId:c.id,campaignVersion:c.version,input});
 const record:GrowthRecord<SignalInput>={id:signalId,campaignId:c.id,brandId:c.brandId,campaignVersion:c.version,version:1,input,updatedAt:at,updatedBy:who.id,requestDigest:digest,
  productResearch:{decisionId:d.id,scoreCardId:card.id,productId:p.id,snapshotIds:cited}};
 const history=database().prepare('INSERT INTO records(id,owner,kind,parent_id,data,updated_at) VALUES(?,?,?,?,?,?)').bind(`${owner}:growth_history:signal:${signalId}:1`,owner,'growth_history',c.id,JSON.stringify({...record,entity:'signal'}),at);
 const next:MdDecision={...d,handoff:{campaignId:c.id,signalId,needId:null}};
 return {writes:[recordStatement(owner,'growth_signal',signalId,record,c.id),history,putStatement(owner,K.decision,d.id,next,d.productId)],resultId:signalId};
}

// ── 쓰기 진입점. 반환: 새 화면 + resultId(+duplicate·pending).
export async function researchAction(who:Actor,b:Record<string,unknown>,deps:CollectDeps=defaultDeps()){
 const owner=who.owner,action=b.action as ResearchAction,now=deps.now();
 if(!RESEARCH_ACTIONS.includes(action))throw new ApiError(400,'지원하지 않는 상품 리서치 작업입니다.');
 if(typeof b.requestId!=='string'||!UUID_V4.test(b.requestId))throw new ApiError(400,'요청 번호(UUID v4)를 확인하세요.');
 if(OWNER_ONLY.includes(action)&&who.role!=='owner')throw new ApiError(403,'소유자만 출처 연결·해제와 즉시 수집을 할 수 있습니다.');
 await requireResearch(owner);
 const requestId=b.requestId.toLowerCase();
 // 자격증명 입력은 해시로도 기록하지 않는다(요청 지문에서 뺀다).
 const digest=await storefrontDigest(action==='connect_source'?{action,credentialKey:b.credentialKey}:b);
 const prior=await optional<RequestRow>(owner,K.request,requestId);
 if(prior){
  if(prior.digest!==digest)throw new ApiError(409,'같은 요청 번호로 다른 내용을 보냈습니다. 새 요청 번호로 다시 시도하세요.');
  if(prior.status==='rejected'&&prior.error)throw new ResearchError(prior.error.status,prior.error.message,prior.error.unsupported?{unsupported:prior.error.unsupported}:{});
  if(prior.status!=='pending')return {...await researchView(who,now),resultId:prior.resultId,duplicate:true};
 }else await ensureRequestRoom(owner,now);
 const row=(extra:Partial<RequestRow>):RequestRow=>({id:requestId,action,digest,resultId:null,at:now.toISOString(),status:'done',...extra});
 let out:Outcome;
 try{out=await perform(who,action,b,now,deps,requestId,prior)}catch(e){
  // 모델 메모가 인용 검사에서 거절되면 같은 요청을 다시 보내도 다시 실행하지 않게 거절 결과를 남긴다(저장되는 메모는 없다).
  if(e instanceof ResearchError&&action==='generate_brief'&&b.mode==='model')await requestStatement(owner,row({status:'rejected',error:{status:e.status,message:e.message,unsupported:(e.extra.unsupported as string[]|undefined)}})).run();
  throw e;
 }
 if(out.pending){await requestStatement(owner,row({status:'pending',job:out.pending as unknown as Record<string,unknown>})).run();return {...await researchView(who,now),resultId:null,pending:true}}
 await database().batch([...out.writes,requestStatement(owner,row({resultId:out.resultId,...out.request}))]);
 if(out.after)await out.after();
 return {...await researchView(who,now),resultId:out.resultId,duplicate:false};
}

async function perform(who:Actor,action:ResearchAction,b:Record<string,unknown>,now:Date,deps:CollectDeps,requestId:string,prior:RequestRow|null):Promise<Outcome>{
 const owner=who.owner;
 switch(action){
  case 'save_settings':{
   const cur=await readSettings(owner);
   if(b.expectedVersion!==cur.version)throw new ApiError(409,'조사 방향이 그사이 바뀌었습니다. 새로 불러온 뒤 다시 저장하세요.');
   const next={...parseSettings(b.settings),version:cur.version+1,updatedAt:now.toISOString()};
   return {writes:[putStatement(owner,K.settings,'current',next)],resultId:'current'};
  }
  case 'connect_source':{
   const key=b.credentialKey as CredentialKey;if(!CREDENTIAL_KEYS.includes(key))throw new ApiError(400,'연결할 출처를 확인하세요.');
   const input=b.input&&typeof b.input==='object'&&!Array.isArray(b.input)?b.input as Record<string,unknown>:null;
   if(!input||!Object.values(input).every(v=>typeof v==='string'||v===null||v===undefined))throw new ApiError(400,'자격증명 입력 형식을 확인하세요.');
   let credential:ResearchCredential;try{credential=parseResearchCredential(key,input)}catch(e){if(e instanceof CredentialError)throw new ApiError(400,e.message);throw e}
   await verifyCredential(owner,credential,deps);
   return {writes:[await sealCredential(owner,credential,await optional<StoredCredential>(owner,K.credential,key))],resultId:key};
  }
  case 'disconnect_source':{
   const key=b.credentialKey as CredentialKey;if(!CREDENTIAL_KEYS.includes(key))throw new ApiError(400,'해제할 출처를 확인하세요.');
   return {writes:[database().prepare('DELETE FROM records WHERE id=? AND owner=? AND kind=?').bind(`${owner}:${K.credential}:${key}`,owner,K.credential)],resultId:key};
  }
  case 'import_file':{
   const sourceId=b.sourceId as SourceId;if(!IMPORTABLE_SOURCES.includes(sourceId))throw new ApiError(400,'가져오기를 받는 출처가 아닙니다.');
   const r=await parseImport({sourceId:sourceId as ImportSourceId,fileName:String(b.fileName??''),text:typeof b.text==='string'?b.text:'',scope:String(b.scope??''),observedDate:String(b.observedDate??'')},deps);
   if(!r.ok){
    const issues=r.errors.map(e=>({row:e.row,...(e.field?{field:e.field}:{}),message:e.reason}));
    throw new ResearchError(400,`파일을 가져오지 않았습니다(전부 아니면 전무). 문제 ${issues.length}건을 고친 뒤 다시 올려 주세요.`,{issues});
   }
   const snap:Snapshot={...r.draft,id:crypto.randomUUID(),importedBy:{id:who.id,email:who.email,fileName:String(r.draft.request.fileName)}};
   await ensureSnapshotRoom(owner,1,now,()=>referencedSnapshots(owner));
   return {writes:[snapshotStatement(owner,snap)],resultId:snap.id,after:async()=>recompute(owner,now,(await readCollectState(owner)).videos)};
  }
  case 'collect_now':{
   const sourceId=b.sourceId===undefined||b.sourceId===null?undefined:b.sourceId as SourceId;
   if(sourceId!==undefined&&!SOURCES.some(s=>s.id===sourceId))throw new ApiError(400,'출처를 확인하세요.');
   const r=await collectNow(owner,sourceId,deps);
   return {writes:[],resultId:null,request:{job:{calls:r.calls,stored:r.stored,remaining:r.remaining}}};
  }
  case 'recompute':{const r=await recompute(owner,now,(await readCollectState(owner)).videos);return {writes:[],resultId:null,request:{job:r}}}
  case 'confirm_match':return confirmMatch(who,b,now);
  case 'set_brand_fit':{
   const p=await productOf(owner,b.productId),value=b.value;
   if(typeof value!=='number'||!Number.isFinite(value)||value<0||value>100)throw new ApiError(400,'브랜드 적합성은 0~100 사이 숫자로 입력하세요.');
   const reason=text(b.reason,'판정 사유',5,300);
   const next:StoredProduct={...p,brandFit:{value:Math.round(value*10)/10,reason,by:{id:who.id,email:who.email},at:now.toISOString()},updatedAt:now.toISOString()};
   return {writes:[putStatement(owner,K.product,p.id,next)],resultId:p.id,after:async()=>recompute(owner,now,(await readCollectState(owner)).videos)};
  }
  case 'generate_brief':{
   const ids=Array.isArray(b.productIds)?[...new Set(b.productIds)]:[];
   if(!ids.length||ids.length>20)throw new ApiError(400,'비교할 상품을 1~20개 고르세요.');
   const productIds=ids.map(x=>idOf(x,'상품 ID'));
   const q=typeof b.question==='string'&&b.question.trim()?b.question:(await readSettings(owner)).question;
   const question=text(q,'조사 질문',1,200);
   if(b.mode!=='template'&&b.mode!=='model')throw new ApiError(400,'작성 방식은 template·model 중 하나입니다.');
   if(await countKind(owner,K.brief)>=MAX_BRIEFS)throw new ApiError(409,'선정 메모 기록 한도에 도달했습니다.');
   const at=now.toISOString();
   if(b.mode==='template'){const brief=templateBrief(question,await briefInputs(owner,productIds),at);return {writes:bulkPut(owner,K.brief,[{key:brief.id,data:brief,at}],'insert_only'),resultId:brief.id}}
   const job=prior?.status==='pending'?prior.job as unknown as ModelJob:null;
   const r=await modelBrief(owner,{question,productIds,requestId},job,at);
   if('pending' in r)return {writes:[],resultId:null,pending:r.pending};
   return {writes:bulkPut(owner,K.brief,[{key:r.brief.id,data:r.brief,at}],'insert_only'),resultId:r.brief.id,request:{job:r.job as unknown as Record<string,unknown>}};
  }
  case 'decide':return decide(who,b,now);
  case 'handoff':return handoff(who,b,now);
  case 'run_backtest':{
   const h=b.horizonWeeks;if(h!==4&&h!==8&&h!==12)throw new ApiError(400,'관측 기간은 4·8·12주 중 하나입니다.');
   // 화면은 정답 기준을 퍼센트(기본 20)로 보낸다. 분석 계층은 비율(0.2)을 쓴다.
   const pct=b.labelThreshold;if(typeof pct!=='number'||!Number.isFinite(pct)||pct<1||pct>500)throw new ApiError(400,'정답 기준은 1~500% 사이로 입력하세요.');
   const result=await backtest(owner,h,pct/100,now,(await readCollectState(owner)).videos);
   const writes=[putStatement(owner,K.backtest,result.id,result)];
   if(await countKind(owner,K.backtest)>=MAX_BACKTESTS)writes.unshift(database().prepare('DELETE FROM records WHERE id IN (SELECT id FROM records WHERE owner=? AND kind=? ORDER BY updated_at ASC LIMIT 20)').bind(owner,K.backtest));
   return {writes,resultId:result.id};
  }
 }
}
