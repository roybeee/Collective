// 상품 리서치·MD 에이전트 서버(P4·P5). 화면 응답(GET)과 쓰기 작업 16종(api.ts RESEARCH_ACTIONS)을 처리한다.
// 권한: 조회·쓰기는 대표·관리자, 출처 연결·해제·즉시 수집은 소유자만. 모든 쓰기는 기능 스위치 product_research가 켜져 있어야 하고 requestId(uuid v4)로 멱등이며,
// 상품 리서치 잠금(`${owner}:product-research`, 작업자 수집과 같은 키) 안에서 한다.
// 하지 않는 것: 발주·결제·오퍼 가격 승인·게시·카탈로그 가격·공급자 연락(mayOrder:false). 승인 결정은 성장2 캠페인의 시장 근거(growth_signal)와 사람이 채울 초안(고객 기회·소싱 후보·판매 오퍼)으로만 넘긴다.
import type {Campaign} from '../agency';
import {ApiError,database,readRecord,recordStatement,type Actor} from '../server';
import {requireGrowthRunning} from '../growth-stop-server';
import {parseSignalInput,parseNeedInput,signalEvidence,GrowthMarketError,type NeedInput,type SignalInput} from '../growth-market';
import type {GrowthRecord} from '../growth-workspace-server';
import {emptyCandidateInput,parseCandidateInput,GrowthSourcingError} from '../growth-sourcing';
import {emptyOfferInput,parseOfferInput,GrowthCatalogError,type OfferInput} from '../growth-catalog';
import type {CandidateRecord} from '../growth-sourcing-server';
import {storefrontDigest} from '../storefront-orders';
import {BACKTEST_HORIZONS,BRAND_FIT_MAX,BRAND_FIT_MIN,BRAND_FIT_REASON_MAX,BRIEF_PRODUCTS_MAX,CLEAR_REASON_MAX,COLLECT_NOW_PER_DAY,CREDENTIAL_KEYS,HANDOFF_EVIDENCE_MAX_DAYS,LABEL_THRESHOLD_MAX,LABEL_THRESHOLD_MIN,MATCH_KEYS_MAX,QUESTION_MAX,REASON_MAX,REASON_MIN,RESEARCH_ACTIONS,RISK_NOTE_MAX,RISK_RULE_MAX,RISK_RULES_MAX,type CredentialKey,type CampaignCatalogItem,type QuarantineEntry,type ResearchAction,type ResearchViewResponse,type RiskReview,type RiskRule} from './api';
import {SOURCES,IMPORTABLE_SOURCES,sourceSpec} from './sources';
import {researchSourcePolicy,snapshotResearchPolicy} from './source-policy';
import {scoreResearchPolicy,briefResearchPolicy,briefResearchPolicies,productResearchPolicy,requireResearchPolicy,SOURCE_POLICY_VERSION} from './server-policy';
import {credentialKeyForSource,CredentialError,parseResearchCredential,type ResearchCredential} from './credentials';
import {collectSearchadKeywords,collectDatalabSearch,collectDatalabShoppingCategories,trackYoutubeVideos,collectCoupangSearch,parseImport,CollectorError,kstDayKey,quotaDayKey,type CollectDeps,type CollectResult,type ImportSourceId} from './collectors/index';
import {dailyCap} from './collectors/quota';
import {buildBrief} from './analytics/brief';
import * as scoring from './analytics/score';
import {cleanTitle} from './analytics/match';
import {shortId} from './analytics/hash';
import {buildSeries,timeOf} from './analytics/series';
import {normalizeKeyword} from './analytics/normalize';
import {K,MAX_PRODUCTS,RESEARCH_LOCK_LOST,RESEARCH_LOCK_WAIT_MS,ResearchLockLost,UUID_V4,acquireResearchLock,activeQuarantine,appendStatement,applyQuarantine,bulkPut,collectEnabled,countKind,credentialStatus,ensureRequestRoom,ensureSnapshotRoom,markQuotaOk,optional,parseSettings,putStatement,readMany,readSettings,readSnapshots,refundQuota,releaseResearchLock,renewOrThrow,requestStatement,requireResearch,researchEnabled,reserveQuota,sealCredential,snapshotStatement,type QuarantineRow,type RequestRow,type StoredCredential} from './server-store';
import {backtest,isPinned,latestDecisions,loadDecisions,loadGroups,loadMaterial,loadProducts,loadScores,referencedSnapshots,type StoredProduct} from './server-pipeline';
import {collectNow,defaultDeps,readCollectState} from './server-collect';
import {briefInputs,modelBrief,templateBrief,ResearchError,type ModelJob} from './server-brief';
import {freshnessView,previousFromIndex,refreshScores,type ScoreIndex} from './server-ops';
import type {BacktestResult,MdBrief,MdDecision,ScoreCard,Series,Snapshot,SourceId} from './types';

export {ResearchError} from './server-brief';
export {runProductResearchQueue} from './server-collect';
const DAY=86400000;
const VIEW_PRODUCTS=500,SERIES_WEEKS=104,MAX_BRIEFS=2000,MAX_DECISIONS=5000,MAX_BACKTESTS=200,MAX_RISK_REVIEWS=20000;
const TIER_LABEL:Record<ScoreCard['tier'],string>={adopt:'도입 검토',watch:'관찰',needs_data:'자료 보강',reject:'제외'};
const TIER_ORDER:Record<ScoreCard['tier'],number>={adopt:0,watch:1,needs_data:2,reject:3};

// ── 조회
// 화면 응답이 읽는 양의 상한(평가 1회차 H6): 전체 스냅샷·점수표를 읽지 않는다. 시계열은 상위 상품의 점수표가 인용한 스냅샷(최대 120개)과 같은 출처의 104주 안 이전 스냅샷을 합쳐 최대 200개로 만들고,
// '지난주' 점수는 상품별 점수표 색인(pr_score_index)에서, 스냅샷 요약은 인용된 것(최대 1,000개)과 최근 50개만 작은 열로 읽는다.
const VIEW_SERIES_PRODUCTS=60,VIEW_SERIES_SNAPSHOTS=200,VIEW_SERIES_CITED=120,VIEW_META_SNAPSHOTS=1000,VIEW_QUARANTINES=100,VIEW_FLAGS=50,VIEW_RISK_REVIEWS=1000;
type SnapshotMeta={id:string;sourceId:SourceId;fetchedAt:string;status:Snapshot['status'];request:Snapshot['request']|null;limitations:string[];rows:number};
async function sourceRows(owner:string,creds:Awaited<ReturnType<typeof credentialStatus>>,now:Date){
 return Promise.all(SOURCES.map(async s=>{
  const last=await database().prepare("SELECT json_extract(data,'$.fetchedAt') f,json_extract(data,'$.status') st FROM records WHERE owner=? AND kind=? AND parent_id=? ORDER BY updated_at DESC LIMIT 1").bind(owner,K.snapshot,s.id).first<{f:string|null;st:Snapshot['status']|null}>();
  const ok=!last||last.st!=='failed'?last:await database().prepare("SELECT json_extract(data,'$.fetchedAt') f,json_extract(data,'$.status') st FROM records WHERE owner=? AND kind=? AND parent_id=? AND json_extract(data,'$.status')!='failed' ORDER BY updated_at DESC LIMIT 1").bind(owner,K.snapshot,s.id).first<{f:string|null;st:Snapshot['status']|null}>();
  const key=credentialKeyForSource(s.id,creds.filter(c=>c.connected).map(c=>c.key));
  const connected=s.method==='manual'?true:s.method==='internal'||s.id==='naver_shop_search'?false:!!creds.find(c=>c.key===key)?.connected;
  const used=s.autoFetch?((await optional<{used:number}>(owner,K.quota,`${s.id}:${quotaDayKey(s.id,now)}`))?.used??0):null;
  // dailyQuota: 이 앱이 원장으로 지키는 하루 상한(collectors/quota.ts dailyCap). 자동 수집이 아닌 출처는 null.
  return {id:s.id,label:s.label,method:s.method,connected,policy:researchSourcePolicy(s.id),lastFetchedAt:last?.f??null,lastStatus:last?.st??null,quotaUsedToday:used,dailyQuota:s.autoFetch?dailyCap(s.id):null,lastOkAt:ok?.f??null};
 }));
}
async function snapshotMeta(owner:string,ids:readonly string[]):Promise<SnapshotMeta[]>{
 const out:SnapshotMeta[]=[],uniq=[...new Set(ids)];
 for(let i=0;i<uniq.length;i+=300){
  // 요청 범위(키워드·카테고리·기간·가져오기 범위)와 해석 한계, 관측 행 수만 작은 열로 읽는다. 관측 본문은 싣지 않는다.
  const r=await database().prepare("SELECT json_extract(data,'$.id') id,json_extract(data,'$.sourceId') s,json_extract(data,'$.fetchedAt') f,json_extract(data,'$.status') st,json_extract(data,'$.request') q,json_extract(data,'$.limitations') l,json_array_length(data,'$.observations') n FROM records WHERE owner=? AND kind=? AND id IN (SELECT value FROM json_each(?))").bind(owner,K.snapshot,JSON.stringify(uniq.slice(i,i+300).map(x=>`${owner}:${K.snapshot}:${x}`))).all<{id:string;s:SourceId;f:string;st:Snapshot['status'];q:string|null;l:string|null;n:number|null}>();
  for(const x of r.results)out.push({id:x.id,sourceId:x.s,fetchedAt:x.f,status:x.st,request:parseJson<Snapshot['request']>(x.q),limitations:parseJson<string[]>(x.l)??[],rows:Number(x.n)||0});
 }
 return out;
}
// 캠페인별 카탈로그 상품(평가 3회차 M6): 화면 캠페인의 성장2 카탈로그를 한 번에 작은 열로 읽는다. 캠페인·브랜드가 같은 것만, 캠페인마다 최대 CATALOG_PER_CAMPAIGN개(최근 수정 순).
const CATALOG_PER_CAMPAIGN=50,CATALOG_READ_MAX=5000;
async function campaignCatalogs(owner:string,campaigns:readonly Campaign[]):Promise<Record<string,CampaignCatalogItem[]>>{
 if(!campaigns.length)return {};
 const r=await database().prepare("SELECT parent_id c,json_extract(data,'$.id') id,json_extract(data,'$.version') v,json_extract(data,'$.brandId') b,json_extract(data,'$.campaignId') ci,json_extract(data,'$.input.title') t,json_extract(data,'$.input.sku') sku FROM records WHERE owner=? AND kind='growth_catalog' AND parent_id IN (SELECT value FROM json_each(?)) ORDER BY updated_at DESC, id DESC LIMIT ?").bind(owner,JSON.stringify(campaigns.map(c=>c.id)),CATALOG_READ_MAX).all<{c:string;id:string|null;v:number|null;b:string|null;ci:string|null;t:string|null;sku:string|null}>();
 const byId=new Map(campaigns.map(c=>[c.id,c])),out:Record<string,CampaignCatalogItem[]>={};
 for(const x of r.results){
  const c=byId.get(x.c);if(!c||x.ci!==c.id||x.b!==c.brandId||typeof x.id!=='string'||typeof x.v!=='number')continue;
  const list=out[c.id]??(out[c.id]=[]);if(list.length>=CATALOG_PER_CAMPAIGN)continue;
  list.push({id:x.id,version:x.v,title:(typeof x.t==='string'?x.t.trim():'').slice(0,200),sku:(typeof x.sku==='string'?x.sku.trim():'').slice(0,80)});
 }
 return out;
}
function parseJson<T>(v:string|null):T|null{if(!v)return null;try{return JSON.parse(v) as T}catch{return null}}
function emptyView(settings:Awaited<ReturnType<typeof readSettings>>):ResearchViewResponse{
 return {enabled:false,collectEnabled:false,focus:{temperature:settings.temperatures,categories:settings.categories},sources:[],products:[],keywordGroups:[],briefs:[],backtests:[],canEdit:false,mayOrder:false,
  settings,credentials:CREDENTIAL_KEYS.map(key=>({key,connected:false,account:null,updatedAt:null})),imports:[],collect:{lastRunAt:null,nextRunAt:null,lastErrors:[]},campaigns:[],canConnect:false,series:[],snapshots:[]};
}
const IMPORT_SOURCE_IDS=JSON.stringify(IMPORTABLE_SOURCES);

export async function researchView(who:Actor,now=new Date()):Promise<ResearchViewResponse>{
 const owner=who.owner,[enabled,collect,settings,creds]=await Promise.all([researchEnabled(owner),collectEnabled(owner),readSettings(owner),credentialStatus(owner)]);
 const rows=await sourceRows(owner,creds,now),sources=rows.map(({lastOkAt:_l,...s})=>{void _l;return s});
 // 스위치가 꺼져 있어도 화면이 설명 상태를 그릴 수 있게 같은 모양을 준다(조사 방향·출처 연결은 그대로, 결과 목록은 비움).
 if(!enabled)return {...emptyView(settings),collectEnabled:collect,sources,credentials:creds,canConnect:who.role==='owner'};
 const [products,decisions,groups,storedBriefs,backtests,state,campaigns,imports]=await Promise.all([
  loadProducts(owner),loadDecisions(owner),loadGroups(owner),
  database().prepare('SELECT data FROM records WHERE owner=? AND kind=? ORDER BY updated_at DESC LIMIT 50').bind(owner,K.brief).all<{data:string}>().then(r=>r.results.map(x=>JSON.parse(x.data) as MdBrief)),
  database().prepare('SELECT data FROM records WHERE owner=? AND kind=? ORDER BY updated_at DESC LIMIT 20').bind(owner,K.backtest).all<{data:string}>().then(r=>r.results.map(x=>JSON.parse(x.data) as BacktestResult)),
  readCollectState(owner),
  database().prepare("SELECT data FROM records WHERE owner=? AND kind='campaign' ORDER BY updated_at DESC LIMIT 501").bind(owner).all<{data:string}>().then(r=>r.results.map(x=>JSON.parse(x.data) as Campaign)),
  // 가져오기 스냅샷은 출처(parent_id)가 가져오기 출처인 것만 색인으로 읽는다(전체 스냅샷을 훑지 않음).
  database().prepare("SELECT json_extract(data,'$.id') id,json_extract(data,'$.sourceId') s,json_extract(data,'$.importedBy.fileName') f,json_extract(data,'$.request.rows') n,json_extract(data,'$.fetchedAt') at,json_extract(data,'$.importedBy.email') e,json_extract(data,'$.importedBy.id') u,json_extract(data,'$.request.scope') sc,json_extract(data,'$.request.observedDate') od FROM records WHERE owner=? AND parent_id IN (SELECT value FROM json_each(?)) AND kind=? AND json_extract(data,'$.importedBy') IS NOT NULL ORDER BY updated_at DESC LIMIT 50").bind(owner,IMPORT_SOURCE_IDS,K.snapshot).all<{id:string;s:SourceId;f:string;n:number;at:string;e:string|null;u:string;sc:string|null;od:string|null}>(),
 ]);
 // 주간 리포트가 가리키는 메모가 최근 50개 밖이면 그 한 건을 더 읽어 화면이 본문을 보이게 한다.
 const weeklyId=state.weekly?.briefId;
 if(weeklyId&&!storedBriefs.some(b=>b.id===weeklyId)){const w=await optional<MdBrief>(owner,K.brief,weeklyId);if(w)storedBriefs.push(w)}
 const briefPolicies=await briefResearchPolicies(owner,storedBriefs,now.getTime());
 const briefs=storedBriefs.filter(b=>briefPolicies.get(b.id)?.allowed);
 const storedScores=await loadScores(owner,products.map(p=>p.scoreId??''));
 const scores=await usableViewScores(owner,storedScores,now);
 const latest=latestDecisions(decisions);
 // 조사 방향의 보관 온도 밖 상품(filtered.temperature, 분석 계층이 붙임)은 지우지 않고 목록 뒤로 보낸다.
 const offTemp=(p:StoredProduct)=>(p as StoredProduct&{filtered?:{temperature?:boolean}|null}).filtered?.temperature?1:0;
 const listed=products.filter(p=>!p.listings.length||p.listings.every(l=>researchSourcePolicy(l.sourceId).allowed)).map(p=>({p,score:p.scoreId?scores.get(p.scoreId)??null:null}))
  .sort((a,b)=>offTemp(a.p)-offTemp(b.p)||(a.score?TIER_ORDER[a.score.tier]:9)-(b.score?TIER_ORDER[b.score.tier]:9)||(b.score?.total??-1)-(a.score?.total??-1)||(a.p.id<b.p.id?-1:1)).slice(0,VIEW_PRODUCTS);
 const index=await readMany<ScoreIndex>(owner,K.scoreIndex,listed.filter(x=>x.score).map(x=>x.p.id));
 const pastIds=listed.flatMap(({p,score})=>{if(!score)return [];const previous=previousFromIndex(index.get(p.id)?.entries,score);return previous?(index.get(p.id)?.entries.filter(e=>e.computedAt===previous.computedAt).slice(0,1).map(e=>e.id)??[]):[]});
 const past=await usableViewScores(owner,await loadScores(owner,pastIds),now);
 // 시계열: 상위 상품의 점수표가 인용한 스냅샷만 읽어(격리 적용) 그 상품의 키워드 묶음·목록 대상 시계열을 만든다. 시계열마다 최근 104주.
 const top=listed.slice(0,VIEW_SERIES_PRODUCTS),seriesIds=new Set<string>();
 for(const {score} of top){for(const id of score?.subScores.flatMap(s=>s.evidence)??[]){if(seriesIds.size>=VIEW_SERIES_CITED)break;seriesIds.add(id)}}
 const cutoff=now.getTime()-SERIES_WEEKS*7*DAY;
 const [cited,quarantine]=await Promise.all([readSnapshots(owner,[...seriesIds]),activeQuarantine(owner)]);
 // 점수표는 출처마다 최신 스냅샷만 인용하므로, 같은 출처의 104주 안 이전 스냅샷을 남은 한도만큼 더 읽어 추세 막대가 이전 주를 보이게 한다.
 const citedSources=[...new Set([...cited.values()].map(x=>x.sourceId))],room=VIEW_SERIES_SNAPSHOTS-cited.size;
 const older=citedSources.length&&room>0?await database().prepare("SELECT id FROM records WHERE owner=? AND kind=? AND parent_id IN (SELECT value FROM json_each(?)) AND json_extract(data,'$.status')!='failed' AND json_extract(data,'$.fetchedAt')>=? ORDER BY updated_at DESC LIMIT ?").bind(owner,K.snapshot,JSON.stringify(citedSources),new Date(cutoff).toISOString(),room+cited.size).all<{id:string}>().then(r=>r.results.map(x=>x.id.slice(`${owner}:${K.snapshot}:`.length)).filter(id=>!cited.has(id)).slice(0,room)):[];
 const seriesSnaps=[...cited.values(),...(older.length?(await readSnapshots(owner,older)).values():[])];
 const groupSnapshots=await readSnapshots(owner,[...new Set(groups.filter(g=>g.sourcePolicyVersion===SOURCE_POLICY_VERSION).flatMap(g=>g.sourceSnapshotIds??[]))]);
 const safeGroups=groups.filter(g=>g.sourcePolicyVersion===SOURCE_POLICY_VERSION&&!!g.sourceSnapshotIds?.length&&g.sourceSnapshotIds.every(id=>snapshotResearchPolicy(groupSnapshots.get(id),now.getTime()).allowed));
 const wanted=new Set<string>();
 for(const {p} of top){for(const l of p.listings)wanted.add(`ls:${l.sourceId}:${l.externalId}`);for(const g of safeGroups.filter(g=>p.keywordGroupIds.includes(g.id))){wanted.add(`kw:${normalizeKeyword(g.label)}`);for(const k of g.keywords)wanted.add(`kw:${normalizeKeyword(k)}`)}}
 const series:Series[]=buildSeries(applyQuarantine(seriesSnaps.filter(s=>snapshotResearchPolicy(s,now.getTime()).allowed),quarantine)).filter(s=>wanted.has(s.subjectKey)).map(s=>({...s,points:s.points.filter(p=>timeOf(p.at)>=cutoff)})).filter(s=>s.points.length);
 const evidence=[...new Set([...listed.flatMap(x=>x.score?x.score.subScores.flatMap(s=>s.evidence):[]),...briefs.flatMap(b=>b.claims.flatMap(c=>c.citations))])].slice(0,VIEW_META_SNAPSHOTS);
 const recent=await database().prepare('SELECT id FROM records WHERE owner=? AND kind=? ORDER BY updated_at DESC LIMIT 50').bind(owner,K.snapshot).all<{id:string}>();
 const entry=(q:QuarantineRow):QuarantineEntry=>({id:q.id,sourceId:q.sourceId,snapshotId:q.snapshotId,subjectKey:q.subjectKey,metric:q.metric,periodTo:q.periodTo,value:q.value,median:q.median,robustZ:q.robustZ,createdAt:q.createdAt,status:q.status==='flagged'?'flagged':'active',basis:q.basis??null});
 const quarantined=(status:'active'|'flagged',limit:number)=>database().prepare("SELECT data FROM records WHERE owner=? AND kind=? AND json_extract(data,'$.status')=? ORDER BY updated_at DESC LIMIT ?").bind(owner,K.quarantine,status,limit).all<{data:string}>().then(r=>r.results.map(x=>entry(JSON.parse(x.data) as QuarantineRow)));
 const [snapshots,fresh,quarantines,flags,reviews]=await Promise.all([
  snapshotMeta(owner,[...evidence,...recent.results.map(r=>r.id.slice(`${owner}:${K.snapshot}:`.length))]),
  freshnessView(owner,now,rows),
  quarantined('active',VIEW_QUARANTINES),quarantined('flagged',VIEW_FLAGS),
  database().prepare('SELECT data FROM records WHERE owner=? AND kind=? ORDER BY updated_at DESC LIMIT ?').bind(owner,K.riskReview,VIEW_RISK_REVIEWS).all<{data:string}>().then(r=>r.results.map(x=>JSON.parse(x.data) as RiskReview)),
 ]);
 const current=new Set(listed.flatMap(x=>x.score?[x.score.id]:[])),riskReviews:RiskReview[]=[],reviewed=new Set<string>();
 for(const rv of reviews)if(current.has(rv.scoreCardId)&&!reviewed.has(rv.scoreCardId)){reviewed.add(rv.scoreCardId);riskReviews.push(rv)}
 const shown=campaigns.filter(c=>c.status!=='archived').slice(0,500);
 const errors=Object.entries(state.errors).filter(([,e])=>!!e).map(([sourceId,e])=>({sourceId:sourceId as SourceId,message:e!.message,at:e!.at}));
 const alerts=[...Object.entries(state.failures??{}).filter(([,f])=>!!f).map(([sourceId,f])=>({sourceId:sourceId as SourceId,message:f!.message,since:f!.since})),...fresh.quarantineAlerts];
 return {
  enabled,collectEnabled:collect,focus:{temperature:settings.temperatures,categories:settings.categories},sources,
  products:listed.map(({p,score})=>{const {scoreId:_s,brandFit:_b,...rest}=p;void _s;void _b;return {...rest,listings:rest.listings.filter(l=>researchSourcePolicy(l.sourceId).allowed),score,policyHeld:!!p.scoreId&&!score,decision:score?latest.get(p.id)??null:null,previousScore:score?previousFromIndex(index.get(p.id)?.entries.filter(e=>past.has(e.id)),score):null}}),
  keywordGroups:safeGroups,briefs,backtests:backtests.filter(b=>b.sourcePolicyVersion===SOURCE_POLICY_VERSION),canEdit:who.role!=='member',mayOrder:false,
  settings,credentials:creds,
  imports:imports.results.map(r=>({snapshotId:r.id,sourceId:r.s,fileName:r.f,rows:Number(r.n)||0,importedAt:r.at,importedBy:r.e??r.u??null,scope:r.sc??null,observedDate:r.od??null})),
  collect:{lastRunAt:state.lastRunAt,nextRunAt:state.nextRunAt,lastErrors:errors},
  campaigns:shown.map(c=>({id:c.id,title:c.title,version:c.version,brandId:c.brandId})),
  canConnect:who.role==='owner',series,snapshots:snapshots.filter(s=>researchSourcePolicy(s.sourceId).allowed),
  alerts,freshness:fresh.freshness,rankingStatus:fresh.rankingStatus,quarantines:quarantines.filter(q=>researchSourcePolicy(q.sourceId).allowed),riskReviews,
  collectNow:{usedToday:state.manualRuns?.day===kstDayKey(now)?state.manualRuns.count:0,maxPerDay:COLLECT_NOW_PER_DAY},
  weeklyReport:state.weekly&&(!state.weekly.briefId||briefs.some(b=>b.id===state.weekly?.briefId))?state.weekly:null,
  // 평가 2회차: 승인에 세는 리스크 필수 항목, 데이터랩 보정 보고·출시 뒤 결과(마지막 재계산 기준, 수집 상태에서 읽음), 표시만 한 상대값 급등.
  riskChecklists:listed.flatMap(({score})=>score&&needsReview(score)?[{scoreCardId:score.id,items:riskRules(score)}]:[]),
  calibration:state.calibration?.sourcePolicyVersion===SOURCE_POLICY_VERSION?state.calibration:null,launchOutcomes:state.outcomes?.sourcePolicyVersion===SOURCE_POLICY_VERSION?state.outcomes.rows:[],anomalyFlags:flags.filter(q=>researchSourcePolicy(q.sourceId).allowed),
  // 평가 3회차: 넘기기 칸의 캠페인별 카탈로그 상품, 가중치 재보정 후보(제안만, 마지막 재계산 기준).
  campaignCatalogs:await campaignCatalogs(owner,shown),weightsProposal:state.recalibration?.sourcePolicyVersion===SOURCE_POLICY_VERSION?state.recalibration:null,
 };
}

async function usableViewScores(owner:string,cards:Map<string,ScoreCard>,now:Date){
 const ids=[...new Set([...cards.values()].flatMap(c=>c.subScores.flatMap(s=>s.evidence)))];
 const snapshots=await readSnapshots(owner,ids);
 return new Map([...cards].filter(([,card])=>{const refs=card.subScores.flatMap(s=>s.evidence);return refs.length>0&&refs.every(id=>snapshotResearchPolicy(snapshots.get(id),now.getTime()).allowed)}));
}

// ── 쓰기 공용
const text=(v:unknown,label:string,min:number,max:number)=>{if(typeof v!=='string')throw new ApiError(400,`${label}을 입력하세요.`);const t=v.trim();if(t.length<min||t.length>max||[...t].some(c=>{const n=c.charCodeAt(0);return n<32&&n!==10||n===127}))throw new ApiError(400,`${label}은 ${min}~${max}자로 입력하세요.`);return t};
const idOf=(v:unknown,label:string)=>{if(typeof v!=='string'||!/^[A-Za-z0-9_-]{1,100}$/.test(v))throw new ApiError(400,`${label} 형식을 확인하세요.`);return v};
const OWNER_ONLY:readonly ResearchAction[]=['connect_source','disconnect_source','collect_now'];
type Outcome={writes:D1PreparedStatement[];resultId:string|null;after?:()=>Promise<unknown>;pending?:ModelJob;request?:Partial<RequestRow>};
// 재계산 경로는 모두 자사 판매 스냅샷·이상치 격리·점수표 색인을 함께 갱신한다(server-ops.ts refreshScores).
// 단계 사이마다 잠금을 갱신하고(평가 3회차 M4), 잃었으면 남은 단계를 저장하지 않고 409로 알린다.
const refresh=(owner:string,now:Date,token:string)=>async()=>{
 try{return await refreshScores(owner,now,(await readCollectState(owner)).videos,{renew:()=>renewOrThrow(owner,token)})}
 catch(e){if(e instanceof ResearchLockLost)throw new ApiError(409,RESEARCH_LOCK_LOST);throw e}
};
// 검토 필요 점수표(분석 계층이 붙이는 선택 필드). 아직 필드가 없는 점수표는 false다.
type ReviewCard=ScoreCard&{needsReview?:boolean;review?:{rules:string[];reasons:string[];terms:string[]}|null};
const needsReview=(c:ScoreCard)=>(c as ReviewCard).needsReview===true;
// 리스크 필수 항목(평가 2회차 H1): 서버가 점수표의 review(높음 항목)에서 만든다. 화면이 보낸 자유 문장은 승인에 세지 않는다.
// text=위험 사유 문장(화면 체크리스트와 같은 200자 자르기), id=규칙 id(규칙과 사유가 1:1일 때) 또는 'review_번호'. 검토 필요인데 review가 없으면 일반 항목 하나.
const GENERIC_RULE:RiskRule={id:'risk_review',text:'리스크 높음 사유를 확인했습니다.'};
export function riskRules(card:ScoreCard):RiskRule[]{
 if(!needsReview(card))return [];
 const rv=(card as ReviewCard).review,reasons=[...new Set((rv?.reasons??[]).map(x=>x.trim().slice(0,RISK_RULE_MAX)).filter(Boolean))];
 if(!rv||!reasons.length)return [GENERIC_RULE];
 const aligned=rv.rules.length===reasons.length&&new Set(rv.rules).size===rv.rules.length;
 return reasons.map((text,i)=>({id:aligned?rv.rules[i]:`review_${i+1}`,text}));
}
// 체크리스트 항목 → 필수 항목 id(없으면 null=운영자 추가 항목). ruleId를 주면 그것만 본다.
const ruleOf=(rules:readonly RiskRule[],x:{rule:string;ruleId?:string|null})=>x.ruleId?rules.find(r=>r.id===x.ruleId)??null:rules.find(r=>r.text===x.rule.trim()||r.id===x.rule.trim())??null;
// 저장한 검토로 승인할 수 있는지: 필수 항목이 모두 확인됐고, 확인하지 않은 운영자 항목이 없어야 한다. 막는 항목 이름 목록(없으면 빈 배열).
function openRiskItems(rules:readonly RiskRule[],review:RiskReview):string[]{
 const missing=rules.filter(r=>!review.checklist.some(x=>x.checked&&ruleOf(rules,x)?.id===r.id)).map(r=>r.text);
 const extra=review.checklist.filter(x=>!x.checked&&!ruleOf(rules,x)).map(x=>x.rule);
 return [...missing,...extra];
}
// 확인 표시·사유 검사: 분석 계층의 reviewApprovalError(analytics/score.ts)가 있으면 그것을, 없으면 같은 규칙의 지역 검사를 쓴다.
type ReviewCheck=(card:ReviewCard,reason:string,acknowledged:boolean)=>string|null;
function reviewError(card:ReviewCard,reason:string,acknowledged:boolean):string|null{
 const shared=(scoring as unknown as {reviewApprovalError?:ReviewCheck}).reviewApprovalError;
 if(shared&&card.review)return shared(card,reason,acknowledged);
 if(!acknowledged)return '위험을 확인했다는 표시(riskAcknowledged)가 없습니다.';
 const terms=card.review?.terms??[];
 return terms.length&&!terms.some(t=>reason.includes(t))?`승인 사유에 확인한 위험을 적어 주세요. 예: ${terms.slice(0,4).join('·')} 중 하나를 넣어 무엇을 확인했는지 씁니다.`:null;
}
type SourcingLink={campaignId:string;candidateId:string;candidateVersion:number};
type LinkedProduct=StoredProduct&{sourcing?:SourcingLink};

// 출처 연결 검증: 수집기로 가장 싼 실제 호출 1번(검색광고 힌트 1개, 데이터랩 7일, YouTube 공개 영상 1개, 쿠팡 검색 1개). 결과는 저장하지 않고 쿼터만 센다.
export const VERIFY_VIDEO_ID='jNQXAC9IVRw';
async function verifyCredential(owner:string,c:ResearchCredential,deps:CollectDeps){
 const now=deps.now();
 const plan:{source:SourceId;run:()=>Promise<CollectResult>}|null=c.kind==='naver_searchad'?{source:'naver_searchad_keyword',run:()=>collectSearchadKeywords(c,['마라소스'],deps)}
  :(c.kind==='naver_developers'||c.kind==='naver_api_hub')?{source:'naver_datalab_search',run:()=>{const end=new Date(Date.parse(`${kstDayKey(now)}T00:00:00Z`)-DAY),start=new Date(end.getTime()-6*DAY);return collectDatalabSearch(c,{startDate:start.toISOString().slice(0,10),endDate:end.toISOString().slice(0,10),timeUnit:'date',keywordGroups:[{groupName:'연결확인',keywords:['마라소스']}]},deps)}}
  :c.kind==='youtube'?{source:'youtube_data',run:()=>trackYoutubeVideos(c,[VERIFY_VIDEO_ID],deps)}
  :c.kind==='coupang_partners'?{source:'coupang_partners',run:()=>collectCoupangSearch(c,'라면',deps,1)}
  :null;
 // 계약 데이터는 계약 전이라 부를 고정 호스트가 없다. 형식만 확인하고 저장한다(자동 수집 경로 없음).
 if(!plan)return;
 const plans=[plan];
 if(c.kind==='naver_api_hub'){const end=new Date(Date.parse(`${kstDayKey(now)}T00:00:00Z`)-DAY),start=new Date(end.getTime()-6*DAY);plans.push({source:'naver_datalab_shopping',run:()=>collectDatalabShoppingCategories(c,{startDate:start.toISOString().slice(0,10),endDate:end.toISOString().slice(0,10),timeUnit:'date',categories:[{name:'식품',code:'50000006'}]},deps)})}
 for(const plan of plans){
 if(!await reserveQuota(owner,plan.source,1,now))throw new ApiError(409,`${sourceSpec(plan.source).label} 오늘 상한을 다 써서 연결 확인 호출을 하지 않았습니다. 내일 다시 시도하세요.`);
 try{const out=await plan.run();if(c.kind==='naver_api_hub'&&!out.draft.observations.some(o=>o.value!==null))throw new CollectorError('format','연결 확인 응답에 유효한 관측값이 없습니다.');await markQuotaOk(owner,plan.source,now)}catch(e){
  if(e instanceof CollectorError){
   if(e.code==='input'||e.code==='not_allowed')await refundQuota(owner,plan.source,1,now);
   if(e.code==='auth')throw new ApiError(400,`연결 확인 호출이 거절돼 저장하지 않았습니다. ${e.message}`);
   if(e.code==='quota')throw new ApiError(409,`연결 확인 호출이 쿼터에 막혀 저장하지 않았습니다. ${e.message}`);
   throw new ApiError(502,`연결 확인 호출이 실패해 저장하지 않았습니다. ${e.message}`);
  }
  throw e;
 }
 }
}

async function productOf(owner:string,id:unknown){const p=await optional<LinkedProduct>(owner,K.product,idOf(id,'상품 ID'));if(!p)throw new ApiError(404,'상품을 찾을 수 없습니다. 화면을 새로 고치세요.');return p}
async function campaignOf(owner:string,id:unknown){try{return await readRecord<Campaign>(owner,'campaign',idOf(id,'캠페인 ID'))}catch(e){if(e instanceof ApiError&&e.status===404)throw new ApiError(404,'캠페인을 찾을 수 없습니다.');throw e}}
const listingKeyOf=(l:{sourceId:string;externalId:string})=>`${l.sourceId}:${l.externalId}`;

async function confirmMatch(who:Actor,b:Record<string,unknown>,now:Date,token:string):Promise<Outcome>{
 const owner=who.owner,target=await productOf(owner,b.productId),decision=b.decision;
 if(decision!=='merge'&&decision!=='split')throw new ApiError(400,'확인 방식은 merge(묶기)·split(나누기) 중 하나입니다.');
 const keys=Array.isArray(b.listingKeys)?[...new Set(b.listingKeys)]:[];
 if(!keys.length||keys.length>MATCH_KEYS_MAX||!keys.every(k=>typeof k==='string'&&/^[a-z_]+:.{1,120}$/.test(k)))throw new ApiError(400,`목록 키(출처:외부ID)를 1~${MATCH_KEYS_MAX}개 고르세요.`);
 const by={id:who.id,email:who.email},at=now.toISOString(),pinned=(p:StoredProduct,listings:StoredProduct['listings']):StoredProduct=>({...p,listings,match:{method:'manual',confidence:1,confirmedBy:by},updatedAt:at});
 const writes:D1PreparedStatement[]=[];
 if(decision==='split'){
  const mine=new Set(target.listings.map(listingKeyOf));
  if(!(keys as string[]).every(k=>mine.has(k)))throw new ApiError(400,'이 상품에 묶인 목록만 나눌 수 있습니다.');
  if(keys.length>=target.listings.length)throw new ApiError(400,'모든 목록을 나눌 수는 없습니다. 이 상품에 남길 목록이 1개 이상 있어야 합니다.');
  if(await countKind(owner,K.product)>=MAX_PRODUCTS)throw new ApiError(409,`상품은 ${MAX_PRODUCTS.toLocaleString('ko-KR')}개까지 저장할 수 있습니다.`);
  const moved=target.listings.filter(l=>keys.includes(listingKeyOf(l))),kept=target.listings.filter(l=>!keys.includes(listingKeyOf(l)));
  const id=shortId('prp',{split:[...(keys as string[])].sort(),from:target.id}),head=moved[0];
  // 나눈 새 상품에는 소싱 연결·조사 방향 표시를 옮기지 않는다(새 상품의 재계산이 다시 정한다).
  const {sourcing:_s,filtered:_f,...base}=target as LinkedProduct&{filtered?:unknown};void _s;void _f;
  const fresh:StoredProduct={...pinned(base,moved),id,name:cleanTitle(head.title,null),brand:null,keywordGroupIds:[],createdAt:at,scoreId:null,brandFit:null};
  writes.push(putStatement(owner,K.product,target.id,pinned(target,kept)),putStatement(owner,K.product,id,fresh));
  return {writes,resultId:id,after:refresh(owner,now,token)};
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
 return {writes,resultId:target.id,after:refresh(owner,now,token)};
}

async function latestRiskReview(owner:string,productId:string,scoreCardId:string){
 const r=await database().prepare("SELECT data FROM records WHERE owner=? AND parent_id=? AND kind=? AND json_extract(data,'$.scoreCardId')=? ORDER BY updated_at DESC, id DESC LIMIT 1").bind(owner,productId,K.riskReview,scoreCardId).first<{data:string}>();
 return r?JSON.parse(r.data) as RiskReview:null;
}

// 승인 관문(⑫): 선정 금지 → 409, 검토 필요 점수표에 저장된 리스크 검토가 없거나 확인하지 않은 항목이 있음 → 409.
async function decide(who:Actor,b:Record<string,unknown>,now:Date):Promise<Outcome>{
 const owner=who.owner,p=await productOf(owner,b.productId),scoreCardId=idOf(b.scoreCardId,'점수표 ID');
 const status=b.status;if(status!=='approved'&&status!=='hold'&&status!=='rejected')throw new ApiError(400,'결정은 승인·보류·제외 중 하나입니다.');
 const reason=text(b.reason,'결정 사유(한 문장 이상)',REASON_MIN,REASON_MAX);
 if(p.scoreId!==scoreCardId)throw new ApiError(409,'점수표가 새 판으로 바뀌었습니다. 최신 점수표를 확인한 뒤 다시 결정하세요.');
 const card=await optional<ScoreCard>(owner,K.score,scoreCardId);if(!card||card.productId!==p.id)throw new ApiError(404,'점수표를 찾을 수 없습니다.');
 if(status==='approved'){requireResearchPolicy(await productResearchPolicy(owner,p,now.getTime()));const policy=await scoreResearchPolicy(owner,card,now.getTime());if(!policy.allowed)throw new ApiError(409,policy.reason??'근거 사용이 정책 검토로 보류되었습니다.')}
 if(status==='approved'&&card.blocked)throw new ApiError(409,`선정 금지 상품은 승인할 수 없습니다: ${card.blocked.reason}`);
 if(status==='approved'&&needsReview(card)){
  // 둘 중 하나가 있어야 한다: ① 이 판에 저장한 리스크 체크리스트(서버 필수 항목을 모두 확인), ② 위험 확인 표시(riskAcknowledged)와 확인한 위험을 적은 사유.
  // 저장한 체크리스트에 확인하지 않은 항목이 있으면 ②로 넘어가지 않고 막는다(사람이 '아직'이라고 적은 것이다). 필수 항목은 저장한 문장이 아니라 점수표에서 다시 만든다(H1).
  const review=await latestRiskReview(owner,p.id,card.id);
  if(review){
   const open=openRiskItems(riskRules(card),review);
   if(open.length)throw new ApiError(409,`리스크 체크리스트에 확인하지 않은 항목이 ${open.length}개 있어 승인할 수 없습니다: ${open.slice(0,3).join(', ')}`);
  }else{
   const err=reviewError(card as ReviewCard,reason,b.riskAcknowledged===true);
   if(err)throw new ApiError(409,`이 점수표는 사람 리스크 검토가 필요합니다. ${err} 또는 리스크 체크리스트를 확인해 저장(save_risk_review)한 뒤 승인하세요.`);
  }
 }
 let briefId:string|null=null;
 if(b.briefId!==null&&b.briefId!==undefined){briefId=idOf(b.briefId,'선정 메모 ID');const brief=await optional<MdBrief>(owner,K.brief,briefId);if(!brief||!brief.productIds.includes(p.id))throw new ApiError(404,'이 상품을 다룬 선정 메모가 아닙니다.');requireResearchPolicy(await briefResearchPolicy(owner,brief,now.getTime()))}
 if(await countKind(owner,K.decision)>=MAX_DECISIONS)throw new ApiError(409,'선정 결정 기록 한도에 도달했습니다.');
 const d:MdDecision={id:crypto.randomUUID(),productId:p.id,scoreCardId,briefId,status,reason,decidedBy:{id:who.id,email:who.email},decidedAt:now.toISOString(),handoff:null};
 return {writes:[appendStatement(owner,K.decision,d.id,d,p.id)],resultId:d.id};
}

// 근거 관측 시각(평가 1회차 M1): 가져오기는 파일 기준일, 수집은 관측 기간의 끝을 한국 날짜 0시로 본다. 수집·가져온 시각보다 늦을 수 없다.
export function observedAtOf(s:Snapshot):string{
 const fetched=timeOf(s.fetchedAt),req=typeof s.request.observedDate==='string'?s.request.observedDate:null;
 const day=s.importedBy&&req?req:s.observations.map(o=>o.period.to).filter(Boolean).sort().pop()??null;
 const t=day?(/^\d{4}-\d{2}-\d{2}$/.test(day)?Date.parse(`${day}T00:00:00+09:00`):timeOf(day)):fetched;
 return new Date(Math.min(Number.isFinite(t)?t:fetched,fetched)).toISOString();
}
// 공개 https 주소 후보: 입력 → 목록 주소 그대로 → 쿼리·조각을 뺀 주소. 성장 신호 형식 검사(parseSignalInput)를 통과하는 첫 주소를 쓴다.
function signalUrl(candidate:string,base:Omit<SignalInput,'sourceUrl'>){try{return parseSignalInput({...base,sourceUrl:candidate}).sourceUrl}catch{return null}}
const NEED_DRAFT='초안 — 사람이 채움';
// 넘기기(⑩): 같은 batch에 시장 신호(growth_signal) + 그 신호를 잇는 고객 기회 초안(growth_need) + 각 성장 이력 + 소싱 후보 초안(growth_sourcing_candidate, 카탈로그 상품이 정해질 때)
// + 판매 오퍼 초안(growth_offer, 평가 3회차: 단가 null·가격 승인 false) + 결정의 넘기기 연결. 카탈로그·주문은 만들지 않고, 후보 초안은 원가 미확인·발주 권한 없음(mayOrder:false)이다.
async function handoff(who:Actor,b:Record<string,unknown>,now:Date):Promise<Outcome>{
 const owner=who.owner,d=await optional<MdDecision>(owner,K.decision,idOf(b.decisionId,'결정 ID'));
 if(!d)throw new ApiError(404,'선정 결정을 찾을 수 없습니다.');
 if(d.status!=='approved')throw new ApiError(409,'승인한 결정만 성장2로 넘길 수 있습니다.');
 if(d.handoff)throw new ApiError(409,'이미 캠페인으로 넘긴 결정입니다.');
 const latest=latestDecisions(await loadDecisions(owner)).get(d.productId);
 if(latest&&latest.id!==d.id)throw new ApiError(409,'이 상품에 더 최근 결정이 있습니다. 최신 결정으로 다시 시도하세요.');
 const c=await campaignOf(owner,b.campaignId);
 if(b.campaignVersion!==c.version)throw new ApiError(409,'캠페인이 변경되었습니다. 다시 불러오세요.');
 if(c.status==='archived')throw new ApiError(409,'보관한 캠페인에는 넘길 수 없습니다.');
 await requireGrowthRunning(owner);
 const p=await optional<StoredProduct>(owner,K.product,d.productId),card=await optional<ScoreCard>(owner,K.score,d.scoreCardId);
 if(!p||!card)throw new ApiError(409,'결정이 가리키는 상품·점수표를 찾을 수 없습니다.');
 requireResearchPolicy(await productResearchPolicy(owner,p,now.getTime()));
 const policy=await scoreResearchPolicy(owner,card,now.getTime());if(!policy.allowed)throw new ApiError(409,policy.reason??'근거 사용이 정책 검토로 보류되었습니다.');
 const evidenceIds=[...new Set(card.subScores.flatMap(s=>s.evidence))];
 const [snaps,groups]=await Promise.all([readMany<Snapshot>(owner,K.snapshot,evidenceIds),loadGroups(owner)]);
 // 관측 기간·기준일로 30일이 지난 근거는 인용하지 않는다.
 const maxAge=HANDOFF_EVIDENCE_MAX_DAYS*DAY,usable=[...snaps.values()].filter(s=>now.getTime()-timeOf(observedAtOf(s))<maxAge);
 const brief=buildBrief({question:`상품 리서치 승인: ${p.name}`,products:[p],cards:[card],snapshots:usable,keywordGroups:groups,createdAt:now.toISOString(),maxProducts:1,claimsPerProduct:6});
 if(!brief.claims.length||!brief.citationCheck.passed){
  if(usable.length<snaps.size)throw new ApiError(409,`근거 관측이 ${HANDOFF_EVIDENCE_MAX_DAYS}일보다 오래돼(관측 기간·가져오기 기준일 기준) 넘기지 않았습니다. 다시 수집·가져오기 뒤 재계산·결정하세요.`);
  throw new ApiError(409,'인용할 수 있는 관측값이 없어 시장 근거로 넘기지 않았습니다. 수집·가져오기 뒤 재계산하고 다시 결정하세요.');
 }
 const byId=new Map(usable.map(s=>[s.id,s]));
 const cited=[...new Set(brief.claims.flatMap(x=>x.citations))],observed=cited.map(id=>observedAtOf(byId.get(id)!)).sort()[0];
 const expiresAt=new Date(timeOf(observed)+HANDOFF_EVIDENCE_MAX_DAYS*DAY).toISOString();
 if(timeOf(expiresAt)<=now.getTime())throw new ApiError(409,`근거 관측이 ${HANDOFF_EVIDENCE_MAX_DAYS}일보다 오래돼 넘기지 않았습니다. 다시 수집한 뒤 재계산·결정하세요.`);
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
 await cap('growth_signal',500,'이 캠페인의 시장 신호');await cap('growth_need',500,'이 캠페인의 고객 기회');await cap('growth_history',10000,'이 캠페인의 성장 기록');
 const at=now.toISOString(),digest=await storefrontDigest({decisionId:d.id,campaignId:c.id,campaignVersion:c.version,input});
 const provenance={decisionId:d.id,scoreCardId:card.id,productId:p.id,snapshotIds:cited};
 const record:GrowthRecord<SignalInput>={id:signalId,campaignId:c.id,brandId:c.brandId,campaignVersion:c.version,version:1,input,updatedAt:at,updatedBy:who.id,requestDigest:digest,productResearch:provenance};
 const historyRow=(entity:'signal'|'need'|'offer',id:string,data:unknown)=>database().prepare('INSERT INTO records(id,owner,kind,parent_id,data,updated_at) VALUES(?,?,?,?,?,?)').bind(`${owner}:growth_history:${entity}:${id}:1`,owner,'growth_history',c.id,JSON.stringify({...data as object,entity}),at);
 // 고객 기회 초안: 성장 화면의 니즈 형식(parseNeedInput)을 그대로 통과해야 만든다. 상황·원하는 결과·장애물은 사람이 채운다고 적어 둔다(준비 점검이 '입력 필요'로 남긴다).
 let need:GrowthRecord<NeedInput>|null=null,needSkipped:string|null=null;
 try{
  const needInput=parseNeedInput({title:`상품 리서치: ${p.name}`.slice(0,200),situation:NEED_DRAFT,desiredOutcome:NEED_DRAFT,alternative:'',barrier:NEED_DRAFT,counterEvidence:'',signalIds:[signalId],deadline:'',nextAction:`${NEED_DRAFT}: 고객 상황·원하는 결과·장애물을 확인하고 소싱 검토 여부를 정합니다.`,assignee:''});
  const needId='prn_'+(await storefrontDigest({campaignId:c.id,decisionId:d.id,entity:'need'})).slice(0,40);
  if(await optional(owner,'growth_need',needId))throw new ApiError(409,'이미 이 캠페인에 넘긴 결정입니다.');
  need={id:needId,campaignId:c.id,brandId:c.brandId,campaignVersion:c.version,version:1,input:needInput,updatedAt:at,updatedBy:who.id,requestDigest:await storefrontDigest({decisionId:d.id,campaignId:c.id,campaignVersion:c.version,needInput}),evidenceRefs:[{id:signalId,version:1}],productResearch:provenance};
 }catch(e){if(e instanceof ApiError)throw e;needSkipped=e instanceof GrowthMarketError?`고객 기회 초안을 만들지 않았습니다: ${e.message}`:'고객 기회 초안을 만들지 않았습니다.'}
 // 소싱 후보 초안(평가 2회차 M6): 성장2 소싱 후보 형식(parseCandidateInput)을 그대로 통과하는 초안을 같은 batch에 만든다. 원가·MOQ·납기는 미확인(null), 공급처는 미정, 발주 권한 없음.
 // 후보는 카탈로그 상품 하나를 가리켜야 하므로 이 캠페인의 카탈로그 상품(catalogId, 또는 하나뿐인 상품)이 있을 때만 만들고, 없으면 까닭을 남긴다(카탈로그는 만들지 않는다).
 const linked=(p as LinkedProduct).sourcing;
 // 카탈로그 상품은 요청의 catalogId(이 캠페인·브랜드 것이어야 함, 아니면 404) 또는 하나뿐인 상품이다. 소싱 후보 초안과 판매 오퍼 초안이 같은 상품을 가리킨다.
 const catalog=await campaignCatalog(owner,c,b.catalogId);
 let candidate:SourcingDraft|null=null,candidateSkipped:string|null=null;
 if(linked&&linked.campaignId===c.id){
  const existing=await optional<CandidateRecord>(owner,'growth_sourcing_candidate',linked.candidateId);
  if(!existing||existing.id!==linked.candidateId||existing.campaignId!==c.id||existing.brandId!==c.brandId||existing.version!==linked.candidateVersion||
   typeof catalog==='string'||existing.input.catalogId!==catalog.id||existing.input.catalogVersion!==catalog.version)
   throw new ApiError(409,'연결된 소싱 후보와 선택한 카탈로그 상품·판이 일치하지 않습니다. 소싱 연결과 카탈로그를 확인한 뒤 다시 시도하세요.');
  candidateSkipped='상품에 이 캠페인의 소싱 후보가 이미 연결돼 있어 초안을 만들지 않았습니다.';
 }
 else{
  if(typeof catalog==='string')candidateSkipped=catalog.replace('초안을','소싱 후보 초안을');
  else try{
   const candidateInput=parseCandidateInput({...emptyCandidateInput(),catalogId:catalog.id,catalogVersion:catalog.version,supplierCode:'unassigned',evidenceRef:`상품 리서치 시장 근거 ${signalId}`.slice(0,160),
    note:`${NEED_DRAFT}: 공급처·단위 원가·MOQ·납기·세금 기준을 확인해 채웁니다. 발주·결제·공급자 연락 권한 없음.`});
   const candidateId='prc_'+(await storefrontDigest({campaignId:c.id,decisionId:d.id,entity:'sourcing_candidate'})).slice(0,40);
   if(await optional(owner,'growth_sourcing_candidate',candidateId))throw new ApiError(409,'이미 이 캠페인에 넘긴 결정입니다.');
   await cap('growth_sourcing_candidate',100,'이 캠페인의 소싱 후보');await cap('growth_sourcing_history',1000,'이 캠페인의 소싱 이력');
   candidate={id:candidateId,brandId:c.brandId,campaignId:c.id,campaignVersion:c.version,version:1,input:candidateInput,createdAt:at,updatedAt:at,status:'draft',mayOrder:false,productResearch:provenance};
  }catch(e){if(e instanceof ApiError)throw e;candidateSkipped=e instanceof GrowthSourcingError?`소싱 후보 초안을 만들지 않았습니다: ${e.message}`:'소싱 후보 초안을 만들지 않았습니다.'}
 }
 // 판매 오퍼 초안(평가 3회차 ⑩ 결정 연결): 성장2 오퍼 형식(growth-catalog.ts parseOfferInput)을 그대로 통과하는 초안을 같은 batch에 만든다.
 // 오퍼 단가 null·가격 승인 false·구매 링크 비움이라 준비 점검(offerReadiness)이 '가격 승인 필요'로 남기고, 미션·게시는 이 오퍼로 진행할 수 없다(사람이 채운다).
 // 고객 기회 초안과 카탈로그 상품이 모두 있어야 만든다(오퍼는 둘을 가리킨다).
 let offer:GrowthRecord<OfferInput>|null=null,offerSkipped:string|null=null;
 if(typeof catalog==='string')offerSkipped=catalog.replace('초안을','판매 오퍼 초안을');
 else if(!need)offerSkipped='고객 기회 초안이 없어 판매 오퍼 초안을 만들지 않았습니다(오퍼는 고객 기회를 가리켜야 합니다).';
 else try{
  const offerInput=parseOfferInput({...emptyOfferInput(),title:`상품 리서치: ${p.name}`.slice(0,200),catalogId:catalog.id,catalogVersion:catalog.version,needId:need.id,price:null,quantity:1,landingUrl:'',
   purchaseReason:`${NEED_DRAFT}: 구매 이유·오퍼 단가·구매 링크를 확인해 채웁니다. 가격 승인·게시·발주 없음.`,priceApproved:false});
  const offerId='pro_'+(await storefrontDigest({campaignId:c.id,decisionId:d.id,entity:'offer'})).slice(0,40);
  if(await optional(owner,'growth_offer',offerId))throw new ApiError(409,'이미 이 캠페인에 넘긴 결정입니다.');
  await cap('growth_offer',500,'이 캠페인의 판매 오퍼');
  offer={id:offerId,campaignId:c.id,brandId:c.brandId,campaignVersion:c.version,version:1,input:offerInput,updatedAt:at,updatedBy:who.id,requestDigest:await storefrontDigest({decisionId:d.id,campaignId:c.id,campaignVersion:c.version,offerInput}),evidenceRefs:[{id:need.id,version:1}],productResearch:provenance};
 }catch(e){if(e instanceof ApiError)throw e;offerSkipped=e instanceof GrowthCatalogError?`판매 오퍼 초안을 만들지 않았습니다: ${e.message}`:'판매 오퍼 초안을 만들지 않았습니다.'}
 // handoff.candidateId·at(추가 필드): 만든 소싱 후보 초안과 넘긴 시각. 출시 뒤 결과(server-ops.ts launchOutcomes)가 이 후보 → 카탈로그 SKU로 자사 판매를 잇는다.
 const link:NonNullable<MdDecision['handoff']>&{candidateId:string|null;offerId:string|null;at:string}={campaignId:c.id,signalId,needId:need?.id??null,candidateId:candidate?.id??(linked&&linked.campaignId===c.id?linked.candidateId:null),offerId:offer?.id??null,at};
 const next:MdDecision={...d,handoff:link};
 const sourcingWrites=candidate?[recordStatement(owner,'growth_sourcing_candidate',candidate.id,candidate,c.id),
  database().prepare('INSERT INTO records(id,owner,kind,parent_id,data,updated_at) VALUES(?,?,?,?,?,?)').bind(`${owner}:growth_sourcing_history:${crypto.randomUUID()}`,owner,'growth_sourcing_history',c.id,JSON.stringify(candidate),at),
  // 상품에 소싱 연결이 없으면 초안을 잇는다(견적이 채워지면 재계산이 수익성·실행 가능성에 쓴다).
  ...(linked?[]:[putStatement(owner,K.product,p.id,{...p,sourcing:{campaignId:c.id,candidateId:candidate.id,candidateVersion:1},updatedAt:at})])]:[];
 const offerWrites=offer?[recordStatement(owner,'growth_offer',offer.id,offer,c.id),historyRow('offer',offer.id,offer)]:[];
 return {writes:[recordStatement(owner,'growth_signal',signalId,record,c.id),historyRow('signal',signalId,record),...(need?[recordStatement(owner,'growth_need',need.id,need,c.id),historyRow('need',need.id,need)]:[]),...sourcingWrites,...offerWrites,putStatement(owner,K.decision,d.id,next,d.productId)],
  resultId:signalId,request:{job:{signalId,needId:need?.id??null,needSkipped,candidateId:candidate?.id??null,candidateSkipped,offerId:offer?.id??null,offerSkipped}}};
}
// 소싱 후보 초안을 이을 카탈로그 상품: 넘기기 요청의 catalogId(이 캠페인·브랜드 것이어야 함, 아니면 404), 없으면 캠페인 카탈로그 상품이 하나일 때 그것. 못 고르면 까닭 문장.
type SourcingDraft=CandidateRecord&{status:'draft';mayOrder:false;productResearch:{decisionId:string;scoreCardId:string;productId:string;snapshotIds:string[]}};
async function campaignCatalog(owner:string,c:Campaign,given:unknown):Promise<{id:string;version:number}|string>{
 type Row={id:string;version:number;campaignId:string;brandId:string};
 if(given!==undefined&&given!==null&&given!==''){
  const row=await optional<Row>(owner,'growth_catalog',idOf(given,'카탈로그 상품 ID'));
  if(!row||row.campaignId!==c.id||row.brandId!==c.brandId)throw new ApiError(404,'이 캠페인의 카탈로그 상품을 찾을 수 없습니다.');
  return {id:row.id,version:row.version};
 }
 const r=await database().prepare('SELECT data FROM records WHERE owner=? AND kind=? AND parent_id=? LIMIT 2').bind(owner,'growth_catalog',c.id).all<{data:string}>();
 if(r.results.length!==1)return r.results.length?'캠페인 카탈로그 상품이 여러 개라 초안을 만들지 않았습니다. 넘길 때 카탈로그 상품을 고르세요.':'캠페인에 카탈로그 상품이 없어 초안을 만들지 않았습니다(카탈로그는 만들지 않습니다).';
 const row=JSON.parse(r.results[0].data) as Row;
 return row.brandId===c.brandId&&row.campaignId===c.id?{id:row.id,version:row.version}:'캠페인 카탈로그 상품의 브랜드가 달라 초안을 만들지 않았습니다.';
}

// ── 쓰기 진입점. 반환: 새 화면 + resultId(+duplicate·pending).
// 모든 쓰기는 상품 리서치 잠금(`${owner}:product-research`) 안에서 한다. 작업자 수집과 같은 키라 수집·재계산·가져오기·결정·넘기기가 겹치지 않는다(평가 1회차 H5).
// lockWaitMs: 잠금을 기다리는 최대 시간(기본 3초). 넘으면 409 '다른 상품 리서치 작업이 진행 중입니다'.
export type ActionDeps=CollectDeps&{lockWaitMs?:number};
export async function researchAction(who:Actor,b:Record<string,unknown>,deps:ActionDeps=defaultDeps()){
 const owner=who.owner,action=b.action as ResearchAction,now=deps.now();
 if(!RESEARCH_ACTIONS.includes(action))throw new ApiError(400,'지원하지 않는 상품 리서치 작업입니다.');
 if(typeof b.requestId!=='string'||!UUID_V4.test(b.requestId))throw new ApiError(400,'요청 번호(UUID v4)를 확인하세요.');
 if(OWNER_ONLY.includes(action)&&who.role!=='owner')throw new ApiError(403,'소유자만 출처 연결·해제와 즉시 수집을 할 수 있습니다.');
 await requireResearch(owner);
 const token=await acquireResearchLock(owner,deps.lockWaitMs??RESEARCH_LOCK_WAIT_MS);
 let out:{resultId:string|null;duplicate?:boolean;pending?:boolean};
 try{out=await execute(who,action,b,now,deps,b.requestId.toLowerCase(),token)}
 catch(e){if(e instanceof ResearchLockLost)throw new ApiError(409,RESEARCH_LOCK_LOST);throw e}
 finally{await releaseResearchLock(owner,token)}
 return {...await researchView(who,deps.now()),...out};
}
async function execute(who:Actor,action:ResearchAction,b:Record<string,unknown>,now:Date,deps:CollectDeps,requestId:string,token:string):Promise<{resultId:string|null;duplicate?:boolean;pending?:boolean}>{
 const owner=who.owner;
 // 자격증명 입력은 해시로도 기록하지 않는다(요청 지문에서 뺀다).
 const digest=await storefrontDigest(action==='connect_source'?{action,credentialKey:b.credentialKey}:b);
 const prior=await optional<RequestRow>(owner,K.request,requestId);
 if(prior){
  if(prior.digest!==digest)throw new ApiError(409,'같은 요청 번호로 다른 내용을 보냈습니다. 새 요청 번호로 다시 시도하세요.');
  if(prior.status==='rejected'&&prior.error)throw new ResearchError(prior.error.status,prior.error.message,prior.error.unsupported?{unsupported:prior.error.unsupported}:{});
  if(prior.status!=='pending')return {resultId:prior.resultId,duplicate:true};
 }else await ensureRequestRoom(owner,now);
 const row=(extra:Partial<RequestRow>):RequestRow=>({id:requestId,action,digest,resultId:null,at:now.toISOString(),status:'done',...extra});
 let out:Outcome;
 try{out=await perform(who,action,b,now,deps,requestId,prior,token)}catch(e){
  // 모델 메모가 인용 검사에서 거절되면 같은 요청을 다시 보내도 다시 실행하지 않게 거절 결과를 남긴다(저장되는 메모는 없다).
  if(e instanceof ResearchError&&action==='generate_brief'&&b.mode==='model')await requestStatement(owner,row({status:'rejected',error:{status:e.status,message:e.message,unsupported:(e.extra.unsupported as string[]|undefined)}})).run();
  throw e;
 }
 await renewOrThrow(owner,token);
 if(out.pending){await requestStatement(owner,row({status:'pending',job:out.pending as unknown as Record<string,unknown>})).run();return {resultId:null,pending:true}}
 await database().batch([...out.writes,requestStatement(owner,row({resultId:out.resultId,...out.request}))]);
 if(out.after)await out.after();
 return {resultId:out.resultId,duplicate:false};
}

async function perform(who:Actor,action:ResearchAction,b:Record<string,unknown>,now:Date,deps:CollectDeps,requestId:string,prior:RequestRow|null,token:string):Promise<Outcome>{
 const owner=who.owner,by={id:who.id,email:who.email};
 switch(action){
  case 'save_settings':{
   const cur=await readSettings(owner);
   if(b.expectedVersion!==cur.version)throw new ApiError(409,'조사 방향이 그사이 바뀌었습니다. 새로 불러온 뒤 다시 저장하세요.');
   const next={...parseSettings(b.settings),version:cur.version+1,updatedAt:now.toISOString()};
   return {writes:[putStatement(owner,K.settings,'current',next)],resultId:'current'};
  }
  case 'connect_source':{
   const key=b.credentialKey as CredentialKey;if(!CREDENTIAL_KEYS.includes(key))throw new ApiError(400,'연결할 출처를 확인하세요.');
   const policy=key==='youtube'?researchSourcePolicy('youtube_data'):key==='naver_searchad'?researchSourcePolicy('naver_searchad_keyword'):null;
   if(policy&&!policy.allowed)throw new ApiError(409,policy.reason??'상품 리서치 연결이 정책 검토로 보류되었습니다.');
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
   return {writes:[snapshotStatement(owner,snap)],resultId:snap.id,after:()=>refresh(owner,deps.now(),token)()};
  }
  case 'collect_now':{
   const sourceId=b.sourceId===undefined||b.sourceId===null?undefined:b.sourceId as SourceId;
   if(sourceId!==undefined&&!SOURCES.some(s=>s.id===sourceId))throw new ApiError(400,'출처를 확인하세요.');
   const r=await collectNow(owner,sourceId,deps,token);
   return {writes:[],resultId:null,request:{job:{calls:r.calls,stored:r.stored,remaining:r.remaining,runsToday:r.runsToday}}};
  }
  case 'recompute':{const {derived:_d,...r}=await refresh(owner,now,token)();void _d;return {writes:[],resultId:null,request:{job:r}}}
  case 'confirm_match':return confirmMatch(who,b,now,token);
  case 'set_brand_fit':{
   const p=await productOf(owner,b.productId),value=b.value;
   if(typeof value!=='number'||!Number.isFinite(value)||value<BRAND_FIT_MIN||value>BRAND_FIT_MAX)throw new ApiError(400,'브랜드 적합성은 0~100 사이 숫자로 입력하세요.');
   const reason=text(b.reason,'판정 사유',REASON_MIN,BRAND_FIT_REASON_MAX);
   const next:StoredProduct={...p,brandFit:{value:Math.round(value*10)/10,reason,by,at:now.toISOString()},updatedAt:now.toISOString()};
   return {writes:[putStatement(owner,K.product,p.id,next)],resultId:p.id,after:refresh(owner,now,token)};
  }
  case 'generate_brief':{
   const ids=Array.isArray(b.productIds)?[...new Set(b.productIds)]:[];
   if(!ids.length||ids.length>BRIEF_PRODUCTS_MAX)throw new ApiError(400,`비교할 상품을 1~${BRIEF_PRODUCTS_MAX}개 고르세요.`);
   const productIds=ids.map(x=>idOf(x,'상품 ID'));
   const q=typeof b.question==='string'&&b.question.trim()?b.question:(await readSettings(owner)).question;
   const question=text(q,'조사 질문',1,QUESTION_MAX);
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
   const h=b.horizonWeeks;if(!BACKTEST_HORIZONS.includes(h as 4|8|12))throw new ApiError(400,'관측 기간은 4·8·12주 중 하나입니다.');
   // 화면은 정답 기준을 퍼센트(기본 20)로 보낸다. 분석 계층은 비율(0.2)을 쓴다.
   const pct=b.labelThreshold;if(typeof pct!=='number'||!Number.isFinite(pct)||pct<LABEL_THRESHOLD_MIN||pct>LABEL_THRESHOLD_MAX)throw new ApiError(400,'정답 기준은 1~500% 사이로 입력하세요.');
   const result=await backtest(owner,h as 4|8|12,pct/100,now,(await readCollectState(owner)).videos);
   const writes=[putStatement(owner,K.backtest,result.id,result)];
   if(await countKind(owner,K.backtest)>=MAX_BACKTESTS)writes.unshift(database().prepare('DELETE FROM records WHERE id IN (SELECT id FROM records WHERE owner=? AND kind=? ORDER BY updated_at ASC LIMIT 20)').bind(owner,K.backtest));
   return {writes,resultId:result.id};
  }
  case 'clear_quarantine':{
   const id=idOf(b.quarantineId,'격리 ID'),q=await optional<QuarantineRow>(owner,K.quarantine,id);
   if(!q)throw new ApiError(404,'격리 기록을 찾을 수 없습니다. 화면을 새로 고치세요.');
   if(q.status!=='active')throw new ApiError(409,'이미 해제한 격리입니다.');
   const reason=text(b.reason,'해제 사유',REASON_MIN,CLEAR_REASON_MAX);
   const next:QuarantineRow={...q,status:'cleared',cleared:{by,at:now.toISOString(),reason}};
   return {writes:[putStatement(owner,K.quarantine,id,next,q.sourceId)],resultId:id,after:refresh(owner,now,token)};
  }
  case 'link_sourcing':{
   const p=await productOf(owner,b.productId),c=await campaignOf(owner,b.campaignId);
   if(c.status==='archived')throw new ApiError(409,'보관한 캠페인의 소싱 후보는 연결할 수 없습니다.');
   const candidateId=idOf(b.candidateId,'소싱 후보 ID');
   const cand=await optional<{id:string;brandId:string;campaignId:string;version:number}>(owner,'growth_sourcing_candidate',candidateId);
   if(!cand||cand.campaignId!==c.id||cand.brandId!==c.brandId)throw new ApiError(404,'이 캠페인·브랜드의 소싱 후보를 찾을 수 없습니다.');
   const next:LinkedProduct={...p,sourcing:{campaignId:c.id,candidateId:cand.id,candidateVersion:cand.version},updatedAt:now.toISOString()};
   return {writes:[putStatement(owner,K.product,p.id,next)],resultId:p.id,after:refresh(owner,now,token)};
  }
  case 'unlink_sourcing':{
   const p=await productOf(owner,b.productId);
   if(!p.sourcing)throw new ApiError(409,'연결된 소싱 후보가 없습니다.');
   const {sourcing:_s,...rest}=p;void _s;
   return {writes:[putStatement(owner,K.product,p.id,{...rest,updatedAt:now.toISOString()})],resultId:p.id,after:refresh(owner,now,token)};
  }
  case 'save_risk_review':{
   const p=await productOf(owner,b.productId),scoreCardId=idOf(b.scoreCardId,'점수표 ID');
   if(p.scoreId!==scoreCardId)throw new ApiError(409,'점수표가 새 판으로 바뀌었습니다. 최신 점수표로 다시 검토하세요.');
   const card=await optional<ScoreCard>(owner,K.score,scoreCardId);if(!card||card.productId!==p.id)throw new ApiError(404,'점수표를 찾을 수 없습니다.');
   requireResearchPolicy(await productResearchPolicy(owner,p,now.getTime()));
   const list=Array.isArray(b.checklist)?b.checklist:null;
   if(!list||!list.length||list.length>RISK_RULES_MAX)throw new ApiError(400,`리스크 체크리스트 항목을 1~${RISK_RULES_MAX}개 보내세요.`);
   // 필수 항목은 서버가 점수표에서 만든다(H1). rule이 필수 항목 문장·id와 같으면 그 항목, ruleId를 주면 필수 항목 id여야 한다(모르면 400). 나머지는 운영자 추가 항목(승인에 세지 않음).
   const rules=riskRules(card);
   const checklist=list.map(x=>{
    if(!x||typeof x!=='object'||Array.isArray(x)||typeof (x as {checked?:unknown}).checked!=='boolean')throw new ApiError(400,'체크리스트 항목은 {rule, checked(참·거짓)} 형식이어야 합니다.');
    const given=(x as {ruleId?:unknown}).ruleId,ruleId=given===undefined||given===null||given===''?null:idOf(given,'필수 항목 ID');
    if(ruleId&&!rules.some(r=>r.id===ruleId))throw new ApiError(400,`이 점수표의 필수 리스크 항목이 아닙니다: ${ruleId}. 화면을 새로 고쳐 최신 항목으로 다시 저장하세요.`);
    const item={rule:text((x as {rule?:unknown}).rule,'체크 항목',1,RISK_RULE_MAX),checked:(x as {checked:boolean}).checked,ruleId};
    return {...item,ruleId:ruleOf(rules,item)?.id??null};
   });
   if(new Set(checklist.map(x=>x.rule)).size!==checklist.length||new Set(checklist.flatMap(x=>x.ruleId?[x.ruleId]:[])).size!==checklist.filter(x=>x.ruleId).length)throw new ApiError(400,'같은 체크 항목이 두 번 있습니다.');
   const note=b.note===undefined||b.note===null||b.note===''?'':text(b.note,'검토 메모',1,RISK_NOTE_MAX);
   if(await countKind(owner,K.riskReview)>=MAX_RISK_REVIEWS)throw new ApiError(409,'리스크 검토 기록 한도에 도달했습니다.');
   const draft:RiskReview={id:crypto.randomUUID(),productId:p.id,scoreCardId,checklist,note,by,at:now.toISOString()};
   const row:RiskReview={...draft,complete:!openRiskItems(rules,draft).length};
   return {writes:[appendStatement(owner,K.riskReview,row.id,row,p.id,row.at)],resultId:row.id};
  }
 }
}
