// 상품 리서치 재계산 파이프라인(서버, 외부 호출 없음). docs/PRODUCT-RESEARCH-PLAN.ko.md 4절.
// 저장된 스냅샷 → 시계열(buildSeries) → 키워드 묶음(groupKeywords) → 상품 매칭(matchListings, 사람 확인한 묶음은 고정) → 점수표(w1).
// 점수표 판은 불변이다: 입력 해시(inputDigest)가 같으면 같은 id라 새 판을 만들지 않는다. 상품 id는 목록이 겹치는 기존 상품 id를 이어 쓴다.
// 계산 범위(Workers 메모리·CPU 한도): 최근 120일 스냅샷 최대 3,000개, 키워드 최대 500개, 자동 매칭 목록 최대 400개.
// 평가 1회차 반영: 조사 방향(보관 온도·가격 상한) 표시, 연결한 소싱 견적으로 수익성·실행 가능성 계산, 상표 보호 목록, 브랜드 아카이브 대조 힌트,
// 백테스트는 기준 시점 이전 관측만으로 후보·특징을 만든다(미래 정보로 후보를 고르지 않는다).
import {ApiError,database,stamp} from '../server';
import {effectiveBrandFacts,type BrandFact} from '../brand-facts';
import type {CandidateInput} from '../growth-sourcing';
import type {ResearchSettings} from './api';
import {categorySpec,CATEGORIES} from './categories';
import {buildSeries,subjectKey,timeOf,DAY_MS} from './analytics/series';
import {groupKeywords,normalizeKeyword,toKeywordGroup,type KeywordCluster} from './analytics/normalize';
import {matchListings,classifyListing,listingKey,cleanTitle,listingBrand,type ListingInput,type Classification} from './analytics/match';
import {buildScoreInput,scoreCard,type ProductBundle} from './analytics/score';
import {runBacktest} from './analytics/backtest';
import {shortId} from './analytics/hash';
import {groupDigits} from './analytics/format';
import {PROFIT_DEFAULTS,profitInputFromCandidate,type ProfitAssumption} from './analytics/profit';
import {protectedBrandList} from './analytics/protected-brands';
import {brandFitHint,type BrandFactLite,type BrandLite} from './analytics/brand-fit';
import {K,MAX_PRODUCTS,MAX_SCORES,bulkDelete,bulkPut,countKind,listKind,optional,readMany,readSettings,recentSnapshots} from './server-store';
import type {BacktestResult,KeywordGroup,MdDecision,MdBrief,ResearchProduct,RegulatoryClass,ScoreCard,Series,SeriesPoint,Snapshot,SourceId,Temperature} from './types';

export const RECOMPUTE_WINDOW_DAYS=120,RECOMPUTE_MAX_SNAPSHOTS=3000,MAX_KEYWORDS=500,MAX_AUTO_LISTINGS=400;
const RANK_SOURCES:readonly SourceId[]=['coupang_partners','licensed_ranking','coupang_ranking_manual','musinsa_ranking_manual','oliveyoung_ranking_manual'];

// 저장 형태: 화면 계약(ResearchProduct)에 현재 점수표 포인터와 사람 브랜드 적합성 판정을 더한다.
export type BrandFitJudgement={value:number;reason:string;by:{id:string;email:string|null};at:string};
export type StoredProduct=ResearchProduct&{scoreId:string|null;brandFit:BrandFitJudgement|null};
export type CollectVideo={id:string;keyword:string;addedAt:string};
export const isPinned=(p:Pick<ResearchProduct,'match'>)=>p.match.confirmedBy!==null;

// ── 계산 맥락(저장소에서 읽는 사람 입력). 순수 계산(computeProducts)은 이 값만 받는다. 없으면 그 기능을 쓰지 않는다.
export type SourcingQuote={ok:true;candidateId:string;candidateVersion:number;input:Pick<CandidateInput,'unitCost'|'moq'|'leadDays'|'shippingCost'|'extraCost'|'taxBasis'|'unit'>}|{ok:false;candidateId:string|null;reason:string};
export type PipelineContext={
 settings?:Pick<ResearchSettings,'temperatures'|'priceMax'>|null;
 // 상품 ID → 연결한 소싱 견적(또는 쓸 수 없는 까닭).
 sourcing?:ReadonlyMap<string,SourcingQuote>;
 protectedBrands?:readonly string[];ownBrands?:readonly string[];
 // 소유자 브랜드와 확정 사실(브랜드 적합성 힌트용, 읽기만 한다).
 brands?:readonly BrandLite[];brandFacts?:readonly BrandFactLite[];
};
export const SOURCING_NEEDED='소싱 견적 연결 필요';
const TEMP_LABEL:Record<Temperature,string>={ambient:'상온',chilled:'냉장',frozen:'냉동',unknown:'미확인'};
// 조사 방향 적용(M4): 보관 온도 설정 밖이면 temperature, 최저가가 가격 상한을 넘으면 priceMax. 지우지 않고 표시만 한다(목록·한도 정리에서 뒤로).
export function settingsFilter(p:Pick<ResearchProduct,'temperature'|'priceBand'>,settings:PipelineContext['settings']):ResearchProduct['filtered']{
 if(!settings)return null;
 const reasons:string[]=[];
 const temperature=p.temperature!=='unknown'&&settings.temperatures.length>0&&!settings.temperatures.includes(p.temperature);
 if(temperature)reasons.push(`보관 온도 설정(${settings.temperatures.map(t=>TEMP_LABEL[t]).join('·')}) 밖: ${TEMP_LABEL[p.temperature]}`);
 const priceMax=settings.priceMax!==null&&p.priceBand.min!==null&&p.priceBand.min>settings.priceMax;
 if(priceMax)reasons.push(`가격 상한 초과(최저가 ${groupDigits(p.priceBand.min as number)}원 > 상한 ${groupDigits(settings.priceMax as number)}원)`);
 return temperature||priceMax?{temperature,priceMax,reasons}:null;
}
const kstDay=(t:number)=>new Date(t+9*3600000).toISOString().slice(0,10);
type CandidateRow={campaignId:string;version:number;input:CandidateInput};
// 연결한 소싱 견적 읽기: 같은 캠페인·같은 판·유효기한 안일 때만 쓴다. 아니면 까닭을 돌려준다(수익성은 미확인으로 남는다).
export function quoteFrom(link:NonNullable<ResearchProduct['sourcing']>,row:CandidateRow|null,now:Date):SourcingQuote{
 if(!row)return {ok:false,candidateId:link.candidateId,reason:'연결한 소싱 견적을 찾을 수 없어 다시 연결 필요'};
 if(row.campaignId!==link.campaignId)return {ok:false,candidateId:link.candidateId,reason:'연결한 소싱 견적의 캠페인이 달라 다시 연결 필요'};
 if(row.version!==link.candidateVersion)return {ok:false,candidateId:link.candidateId,reason:`소싱 견적이 새 판(${row.version})으로 바뀌어 다시 연결 필요`};
 if(row.input.validUntil&&row.input.validUntil<kstDay(now.getTime()))return {ok:false,candidateId:link.candidateId,reason:`소싱 견적 유효기한(${row.input.validUntil})이 지나 새 견적 연결 필요`};
 const {unitCost,moq,leadDays,shippingCost,extraCost,taxBasis,unit}=row.input;
 return {ok:true,candidateId:link.candidateId,candidateVersion:row.version,input:{unitCost,moq,leadDays,shippingCost,extraCost,taxBasis,unit}};
}
// 저장소에서 맥락 읽기: 조사 방향, 소유자 브랜드(상표 보호·자사 상표), 브랜드 확정 사실, 상품별 소싱 견적.
export async function loadContext(owner:string,products:readonly StoredProduct[],now:Date):Promise<PipelineContext>{
 const [settings,brandRows,factRows]=await Promise.all([
  readSettings(owner),
  database().prepare("SELECT data FROM records WHERE owner=? AND kind='brand' ORDER BY id LIMIT 200").bind(owner).all<{data:string}>(),
  database().prepare("SELECT data FROM records WHERE owner=? AND kind='brand_fact' ORDER BY id LIMIT 5000").bind(owner).all<{data:string}>(),
 ]);
 const brands=brandRows.results.map(r=>JSON.parse(r.data) as {id:string;name?:string}).filter(b=>typeof b.id==='string').map(b=>({id:b.id,name:String(b.name??b.id)}));
 const all=factRows.results.map(r=>JSON.parse(r.data) as BrandFact);
 const facts=brands.flatMap(b=>effectiveBrandFacts(all,b.id,undefined,now.getTime())).map(f=>({id:f.id,brandId:f.brandId,key:f.key,value:f.value}));
 const sourcing=new Map<string,SourcingQuote>();
 for(const p of products){
  if(!p.sourcing)continue;
  const row=await optional<CandidateRow>(owner,'growth_sourcing_candidate',p.sourcing.candidateId);
  sourcing.set(p.id,quoteFrom(p.sourcing,row,now));
 }
 const names=brands.map(b=>b.name);
 return {settings,sourcing,protectedBrands:protectedBrandList(names),ownBrands:names,brands,brandFacts:facts};
}

export async function loadProducts(owner:string){return listKind<StoredProduct>(owner,K.product,MAX_PRODUCTS,'상품')}
export async function loadDecisions(owner:string){return listKind<MdDecision>(owner,K.decision,5000,'선정 결정')}
export async function loadGroups(owner:string){return listKind<KeywordGroup>(owner,K.keywordGroup,MAX_KEYWORDS+100,'키워드 묶음')}
export async function loadScores(owner:string,ids:readonly string[]){return readMany<ScoreCard>(owner,K.score,ids.filter(Boolean))}
export function latestDecisions(decisions:readonly MdDecision[]){
 const out=new Map<string,MdDecision>();
 for(const d of decisions){const prev=out.get(d.productId);if(!prev||d.decidedAt>prev.decidedAt||(d.decidedAt===prev.decidedAt&&d.id>prev.id))out.set(d.productId,d)}
 return out;
}

// ── 스냅샷 → 계산 재료
type Material={snapshots:Snapshot[];byId:Map<string,Snapshot>;series:Series[];clusters:KeywordCluster[];listings:Map<string,ListingInput&{priority:number}>;scope:Map<string,Set<string>>;maxTime:number};
const isListing=(s:Snapshot['observations'][number]['subject']):s is Extract<typeof s,{type:'listing'}>=>s.type==='listing';

export function material(snapshots:readonly Snapshot[]):Material{
 const sorted=[...snapshots].sort((a,b)=>timeOf(a.fetchedAt)-timeOf(b.fetchedAt)||(a.id<b.id?-1:1));
 const byId=new Map(sorted.map(s=>[s.id,s]));
 const series=buildSeries(sorted);
 // 키워드: 씨앗 + 일부러 추적한 키워드(쇼핑 검색·데이터랩·영상 발견) + 검색광고 검색수 상위.
 const seeds=CATEGORIES.flatMap(c=>c.seedKeywords),tracked=new Set<string>(),volume=new Map<string,number>();
 for(const s of sorted)for(const o of s.observations){
  if(o.subject.type!=='keyword')continue;
  if(s.sourceId==='naver_searchad_keyword'){if(o.metric==='search_volume_month'&&typeof o.value==='number')volume.set(o.subject.text,o.value)}
  else tracked.add(o.subject.text);
 }
 const byVolume=[...volume.entries()].sort((a,b)=>b[1]-a[1]||(a[0]<b[0]?-1:1)).map(e=>e[0]);
 const keywords=[...new Set([...seeds,...[...tracked].sort(),...byVolume.slice(0,200)])].slice(0,MAX_KEYWORDS);
 const clusters=groupKeywords(keywords);
 // 목록: 순위 출처(순위 100위 안)와 쇼핑 검색 상위 10개. 영상은 상품이 아니다. 같은 목록은 가장 최근 관측을 쓴다.
 const listings=new Map<string,ListingInput&{priority:number}>(),scope=new Map<string,Set<string>>();
 const lastShop=new Map<string,Snapshot>();
 for(const s of sorted)if(s.sourceId==='naver_shop_search'&&s.status!=='failed'){const q=typeof s.request.query==='string'?s.request.query:null;if(q)lastShop.set(normalizeKeyword(q),s)}
 for(const s of sorted){
  if(s.status==='failed'||s.sourceId==='youtube_data')continue;
  if(RANK_SOURCES.includes(s.sourceId))for(const o of s.observations){
   if(!isListing(o.subject)||o.metric!=='rank'||typeof o.value!=='number'||o.value>100)continue;
   listings.set(listingKey(o.subject),{...o.subject,priority:o.value});
  }
 }
 for(const [q,s] of lastShop){
  const keys=new Set<string>();let pos=0;
  for(const o of s.observations){
   if(!isListing(o.subject)||o.metric!=='price_min')continue;
   keys.add(subjectKey(o.subject));pos++;
   const k=listingKey(o.subject),prev=listings.get(k);
   if(pos<=10&&(!prev||prev.priority>=1000+pos))listings.set(k,{...o.subject,priority:prev&&prev.priority<1000?prev.priority:1000+pos});
  }
  scope.set(q,keys);
 }
 const maxTime=sorted.reduce((m,s)=>Math.max(m,timeOf(s.fetchedAt)),0);
 return {snapshots:sorted,byId,series,clusters,listings,scope,maxTime};
}

// 묶인 목록들의 분류: 더 보수적인 쪽(냉동>냉장>상온, 미확인 우선)을 쓴다(match.ts와 같은 규칙).
function classify(listings:readonly {title:string;categoryPath?:string|null}[],clusters:readonly KeywordCluster[]):Classification{
 const cls=listings.map(l=>classifyListing(l.title,l.categoryPath??null,clusters)),order:Temperature[]=['unknown','frozen','chilled','ambient'];
 const pick=[...cls].sort((a,b)=>order.indexOf(a.temperature)-order.indexOf(b.temperature)||(a.regulatorySure===b.regulatorySure?0:a.regulatorySure?1:-1))[0];
 const hff=cls.find(c=>c.regulatory==='health_functional_food');
 return hff?{...pick,regulatory:'health_functional_food',regulatorySure:true}:pick??{categoryId:null,temperature:'unknown',regulatory:'general',regulatorySure:false,reasons:[]};
}
const CERT_CLASSES:readonly RegulatoryClass[]=['health_functional_food','functional_cosmetics','kc_electrical','kc_children'];

// 누적 조회수 여러 영상 → 키워드 하나의 합성 누적 시계열. 영상마다 두 관측 사이 증가분만 더하므로(새로 추적한 영상의 누적값이 한꺼번에 더해지지 않음)
// 하루 증가 속도가 영상별 속도의 합이 된다. 점마다 그날 videos.list 스냅샷을 가리킨다. 값 자체는 관측값이 아니라 메모 주장에는 쓰지 않는다.
function videoSeries(primaryKey:string,videoIds:readonly string[],series:readonly Series[]):Series|null{
 const per=videoIds.map(id=>series.find(s=>s.subjectKey===`ls:youtube_data:${id}`&&s.metric==='video_views')).filter((s):s is Series=>!!s);
 if(!per.length)return null;
 const days=new Map<string,{inc:number;snap:string}>();
 for(const s of per){
  const pts=s.points.filter(p=>p.value!==null);
  for(let i=1;i<pts.length;i++){const d=(pts[i].value as number)-(pts[i-1].value as number);if(d<0)continue;const e=days.get(pts[i].at)??{inc:0,snap:pts[i].snapshotId};e.inc+=d;e.snap=pts[i].snapshotId>e.snap?pts[i].snapshotId:e.snap;days.set(pts[i].at,e)}
  if(pts[0]&&!days.has(pts[0].at))days.set(pts[0].at,{inc:0,snap:pts[0].snapshotId});
 }
 let total=0;const points:SeriesPoint[]=[...days.entries()].sort((a,b)=>timeOf(a[0])-timeOf(b[0])).map(([at,e])=>{total+=e.inc;return {at,value:total,snapshotId:e.snap}});
 return points.length>1?{subjectKey:primaryKey,metric:'video_views',sourceId:'youtube_data',points}:null;
}

type Draft={product:StoredProduct;bundle:ProductBundle;asOf:string;classification:Classification};
// 상품 하나의 계산 묶음(점수 입력 재료).
function bundleFor(p:ResearchProduct,m:Material,videos:readonly CollectVideo[],brandFit:BrandFitJudgement|null,classification:Classification,ctx:PipelineContext={}):Draft['bundle']&{asOf:string}{
 const groups=p.keywordGroupIds.map(id=>m.clusters.find(c=>c.id===id)).filter((c):c is KeywordCluster=>!!c);
 const hasTrend=(c:KeywordCluster)=>m.series.some(s=>s.subjectKey===`kw:${c.normalized}`&&s.metric==='search_trend');
 const primary=groups.find(hasTrend)??groups[0]??null;
 const ordered=primary?[primary,...groups.filter(g=>g!==primary)]:groups;
 const keywordKeys=[...new Set(ordered.flatMap(g=>[`kw:${g.normalized}`,...g.keywords.map(k=>`kw:${normalizeKeyword(k)}`)]))].filter(k=>k!=='kw:');
 const keywords=[...new Set(ordered.flatMap(g=>g.keywords))];
 const listingKeys=p.listings.map(l=>`ls:${l.sourceId}:${l.externalId}`);
 const market=new Set<string>();
 if(primary)for(const k of primary.keywords){const keys=m.scope.get(normalizeKeyword(k));if(keys)for(const x of keys)market.add(x)}
 const wanted=new Set([...keywordKeys,...listingKeys,...market]);
 const series:Series[]=m.series.filter(s=>wanted.has(s.subjectKey));
 if(primary&&!series.some(s=>s.subjectKey===`kw:${primary.normalized}`&&s.metric==='video_views')){
  const own=new Set(primary.keywords.map(normalizeKeyword));
  const v=videoSeries(`kw:${primary.normalized}`,videos.filter(x=>own.has(normalizeKeyword(x.keyword))).map(x=>x.id),m.series);
  if(v)series.push(v);
 }
 // 기준 시점: 이 상품 재료의 마지막 관측(기간 끝·수집 시각 중 늦은 것). 새 자료가 없으면 같은 값이라 점수표 입력 해시도 같다.
 let t=0;for(const s of series)for(const pt of s.points){t=Math.max(t,timeOf(pt.at)||0,timeOf(m.byId.get(pt.snapshotId)?.fetchedAt??'')||0)}
 const asOf=t?new Date(t).toISOString():'1970-01-01T00:00:00.000Z';
 const needsCertification=CERT_CLASSES.includes(classification.regulatory)?true:classification.regulatory==='general'?null:false;
 // 수익성·실행 가능성: 연결한 소싱 견적이 있으면 견적 원가(고정비는 MOQ로 나눔)·MOQ·납기를 쓴다. 판매가는 관측 최저가, 판매 배송비·포장·반품·광고·채널은 가정값(표시됨).
 const quote=ctx.sourcing?.get(p.id)??null,linked=quote&&p.sourcing&&quote.candidateId===p.sourcing.candidateId?quote:null;
 let profit:Draft['bundle']['profit']=null,profitAssumed:ProfitAssumption[]|undefined,profitReason:string|null=null,moq:number|null=null,leadDays:number|null=null;
 if(linked&&linked.ok){
  const D=PROFIT_DEFAULTS;
  profit=profitInputFromCandidate(linked.input,{price:p.priceBand.min,channel:D.channel,shippingPerOrder:D.shippingPerOrder,packaging:D.packaging,returnRate:D.returnRate,adCostPerOrder:D.adCostPerOrder}).input;
  profitAssumed=['price','channel','shipping','packaging','return_rate','ad_cost'];
  moq=linked.input.moq;leadDays=linked.input.leadDays;
 }else profitReason=linked&&!linked.ok?linked.reason:SOURCING_NEEDED;
 const hint=ctx.brands?brandFitHint({brands:ctx.brands,facts:ctx.brandFacts??[],productName:p.name,categoryLabel:categorySpec(p.categoryId)?.label??null,keywords}):undefined;
 return {productId:p.id,keywords,keywordKeys,listingKeys,series,profit,...(profitAssumed?{profitAssumed}:{}),profitReason,
  feasibility:{moq,leadDays,needsCertification,temperature:p.temperature},
  risk:{regulatory:p.regulatory,regulatorySure:classification.regulatorySure,temperature:p.temperature,titles:p.listings.map(l=>l.title),
   ...(ctx.protectedBrands?{protectedBrands:[...ctx.protectedBrands]}:{}),...(ctx.ownBrands?{ownBrands:[...ctx.ownBrands]}:{})},
  brandFit:brandFit?{value:brandFit.value,by:'대표·MD',evidence:[]}:null,...(hint?{brandFitHint:hint}:{}),asOf};
}

function linkGroups(name:string,listingKeys:readonly string[],m:Material):string[]{
 const ids:string[]=[],n=normalizeKeyword(name),lk=listingKeys.map(k=>`ls:${k}`);
 const byScope=new Set<string>();
 for(const [q,keys] of m.scope)if(lk.some(k=>keys.has(k))){const c=m.clusters.find(x=>x.keywords.some(k=>normalizeKeyword(k)===q));if(c)byScope.add(c.id)}
 ids.push(...[...byScope].sort());
 for(const c of [...m.clusters].sort((a,b)=>b.normalized.length-a.normalized.length||(a.id<b.id?-1:1)))if(c.normalized.length>=2&&n.includes(c.normalized)&&!ids.includes(c.id))ids.push(c.id);
 return ids.slice(0,5);
}

// 분류에 카테고리가 없으면 연결된 키워드 묶음의 카테고리로 채운다(묶음 씨앗 기준).
function withCategory(cls:Classification,groupIds:readonly string[],m:Material):Classification{
 if(cls.categoryId)return cls;
 const cat=groupIds.map(id=>m.clusters.find(c=>c.id===id)?.categoryId).find(Boolean)??null,spec=categorySpec(cat);
 if(!spec)return cls;
 return {...cls,categoryId:spec.id,temperature:cls.temperature==='unknown'?spec.temperature:cls.temperature,regulatory:cls.regulatorySure?cls.regulatory:spec.regulatory,regulatorySure:true,reasons:[...cls.reasons,'키워드 묶음 카테고리']};
}

export type Computed={drafts:Draft[];clusters:KeywordCluster[];groups:KeywordGroup[];material:Material;dropped:string[]};
// 순수 계산 부분(저장 없음). existing: 저장된 상품, videos: 수집 상태의 추적 영상.
export function computeProducts(m:Material,existing:readonly StoredProduct[],videos:readonly CollectVideo[],keepIds:ReadonlySet<string>,at:string,ctx:PipelineContext={}):Computed{
 const pinned=existing.filter(isPinned),pinnedKeys=new Set(pinned.flatMap(p=>p.listings.map(l=>`${l.sourceId}:${l.externalId}`)));
 const pool=[...m.listings.entries()].filter(([k])=>!pinnedKeys.has(k)).sort((a,b)=>a[1].priority-b[1].priority||(a[0]<b[0]?-1:1)).slice(0,MAX_AUTO_LISTINGS).map(([,l])=>{const {priority:_p,...rest}=l;void _p;return rest as ListingInput});
 const matched=matchListings(pool,m.clusters).products;
 // 기존 id 잇기: 목록이 가장 많이 겹치는 자동 상품의 id를 쓴다(한 id는 한 번만).
 const owner=new Map<string,StoredProduct>();for(const p of existing)if(!isPinned(p))for(const l of p.listings)owner.set(`${l.sourceId}:${l.externalId}`,p);
 const taken=new Set(pinned.map(p=>p.id)),byId=new Map(existing.map(p=>[p.id,p]));
 const drafts:Draft[]=[];
 for(const mp of matched){
  const votes=new Map<string,number>();for(const l of mp.listings){const o=owner.get(listingKey(l));if(o&&!taken.has(o.id))votes.set(o.id,(votes.get(o.id)??0)+1)}
  const best=[...votes.entries()].sort((a,b)=>b[1]-a[1]||((byId.get(a[0])?.createdAt??'')<(byId.get(b[0])?.createdAt??'')?-1:1)||(a[0]<b[0]?-1:1))[0]?.[0];
  let id=best??mp.key;if(taken.has(id)){let n=2;while(taken.has(`${mp.key}_${n}`))n++;id=`${mp.key}_${n}`}
  taken.add(id);
  const prev=byId.get(id)??null,listingKeys=mp.listings.map(listingKey),groupIds=linkGroups(mp.name,listingKeys,m),cls=withCategory(mp.classification,groupIds,m);
  const product:StoredProduct={id,name:mp.name,brand:mp.brand,categoryId:cls.categoryId,temperature:cls.temperature,regulatory:cls.regulatory,priceBand:mp.priceBand,
   listings:mp.listings.map(l=>({sourceId:l.sourceId,externalId:l.externalId,title:l.title,url:l.url})),keywordGroupIds:groupIds,
   match:{method:mp.method,confidence:mp.confidence,confirmedBy:null},createdAt:prev?.createdAt??at,updatedAt:at,scoreId:prev?.scoreId??null,brandFit:prev?.brandFit??null,
   ...(prev?.sourcing?{sourcing:prev.sourcing}:{})};
  product.filtered=settingsFilter(product,ctx.settings);
  drafts.push({product,classification:cls,...splitBundle(bundleFor(product,m,videos,product.brandFit,cls,ctx))});
 }
 // 사람이 확인한 상품: 목록 묶음은 그대로 두고 제목·가격만 최신 관측으로 새로 쓴다.
 for(const p of pinned){
  const ls=p.listings.map(l=>m.listings.get(`${l.sourceId}:${l.externalId}`)??{...l,brand:null,price:null,categoryPath:null});
  const prices=ls.map(l=>l.price).filter((x):x is number=>typeof x==='number'&&x>0);
  const groupIds=linkGroups(p.name,ls.map(listingKey),m),cls=withCategory(classify(ls,m.clusters),groupIds,m);
  const product:StoredProduct={...p,categoryId:cls.categoryId,temperature:cls.temperature,regulatory:cls.regulatory,priceBand:prices.length?{min:Math.min(...prices),max:Math.max(...prices)}:p.priceBand,
   listings:ls.map(l=>({sourceId:l.sourceId,externalId:l.externalId,title:l.title,url:l.url})),keywordGroupIds:groupIds,updatedAt:at};
  product.filtered=settingsFilter(product,ctx.settings);
  drafts.push({product,classification:cls,...splitBundle(bundleFor(product,m,videos,p.brandFit,cls,ctx))});
 }
 // 상품 한도: 결정·사람 확인이 있는 것은 남기고, 자동 상품 중 우선순위가 낮은 것부터 뺀다.
 let dropped:string[]=[];
 // 조사 방향 밖(filtered) 상품은 지우지 않지만 한도가 넘치면 먼저 뺀다.
 if(drafts.length>MAX_PRODUCTS){const keep=drafts.filter(d=>isPinned(d.product)||keepIds.has(d.product.id)),rest=drafts.filter(d=>!keep.includes(d)).sort((a,b)=>(a.product.filtered?1:0)-(b.product.filtered?1:0));dropped=rest.slice(Math.max(0,MAX_PRODUCTS-keep.length)).map(d=>d.product.id);drafts.splice(0,drafts.length,...keep,...rest.slice(0,Math.max(0,MAX_PRODUCTS-keep.length)))}
 const groups=m.clusters.map(c=>toKeywordGroup(c,at));
 return {drafts,clusters:m.clusters,groups,material:m,dropped};
}
function splitBundle(b:ProductBundle&{asOf:string}){const {asOf,...bundle}=b;return {bundle,asOf}}

export type RecomputeSummary={products:number;newScores:number;keywordGroups:number;snapshots:number;removedProducts:number};
// 재계산 + 저장. 같은 입력이면 점수표 판을 새로 만들지 않는다. 사람 확인 상품·결정이 있는 상품은 지우지 않는다.
export async function recompute(owner:string,now=new Date(),videos:readonly CollectVideo[]=[]):Promise<RecomputeSummary>{
 const snapshots=await recentSnapshots(owner,new Date(now.getTime()-RECOMPUTE_WINDOW_DAYS*DAY_MS).toISOString(),RECOMPUTE_MAX_SNAPSHOTS);
 const m=material(snapshots),at=now.toISOString();
 const [existing,decisions,oldGroups]=await Promise.all([loadProducts(owner),loadDecisions(owner),loadGroups(owner)]);
 const decided=new Set(decisions.map(d=>d.productId));
 const c=computeProducts(m,existing,videos,decided,at,await loadContext(owner,existing,now));
 const cards=c.drafts.map(d=>({d,card:scoreCard(buildScoreInput(d.bundle,d.asOf),{weightsVersion:'w1',computedAt:at})}));
 const known=await loadScores(owner,cards.map(x=>x.card.id));
 const fresh=cards.filter(x=>!known.has(x.card.id)).map(x=>x.card);
 for(const x of cards)x.d.product.scoreId=x.card.id;
 const produced=new Set(c.drafts.map(d=>d.product.id));
 const stale=existing.filter(p=>!produced.has(p.id)&&!isPinned(p)&&!decided.has(p.id)).map(p=>p.id);
 // 결정이 있지만 이번에 만들어지지 않은 상품은 마지막 점수표 그대로 남긴다.
 const groupCreated=new Map(oldGroups.map(g=>[g.id,g.createdAt]));
 const groups=c.groups.map(g=>({...g,createdAt:groupCreated.get(g.id)??g.createdAt}));
 const staleGroups=oldGroups.filter(g=>!groups.some(x=>x.id===g.id)).map(g=>g.id);
 await database().batch([
  ...bulkPut(owner,K.score,fresh.map(card=>({key:card.id,parent:card.productId,data:card,at})),'insert_only'),
  ...bulkPut(owner,K.product,c.drafts.map(d=>({key:d.product.id,data:d.product,at}))),
  ...bulkPut(owner,K.keywordGroup,groups.map(g=>({key:g.id,data:g,at}))),
  ...bulkDelete(owner,K.product,[...stale,...c.dropped]),
  ...bulkDelete(owner,K.keywordGroup,staleGroups),
 ].filter(Boolean));
 await pruneScores(owner,new Set([...c.drafts.map(d=>d.product.scoreId as string),...decisions.map(d=>d.scoreCardId)]));
 return {products:c.drafts.length,newScores:fresh.length,keywordGroups:groups.length,snapshots:snapshots.length,removedProducts:stale.length+c.dropped.length};
}
// 점수표 판이 너무 많으면 현재 포인터·결정이 가리키지 않는 오래된 판부터 지운다.
async function pruneScores(owner:string,keep:ReadonlySet<string>){
 const n=await countKind(owner,K.score);if(n<=MAX_SCORES)return;
 const r=await database().prepare('SELECT id FROM records WHERE owner=? AND kind=? ORDER BY updated_at ASC LIMIT ?').bind(owner,K.score,n-MAX_SCORES+keep.size).all<{id:string}>();
 const prefix=`${owner}:${K.score}:`,victims=r.results.map(x=>x.id.slice(prefix.length)).filter(id=>!keep.has(id)).slice(0,n-MAX_SCORES);
 if(victims.length)await database().batch(bulkDelete(owner,K.score,victims));
}

// 현재 점수표·결정·메모가 가리키는 스냅샷(정리 대상에서 뺀다).
export async function referencedSnapshots(owner:string):Promise<Set<string>>{
 const [products,decisions,briefs]=await Promise.all([loadProducts(owner),loadDecisions(owner),listKind<MdBrief>(owner,K.brief,2000,'선정 메모')]);
 const scores=await loadScores(owner,[...products.map(p=>p.scoreId??''),...decisions.map(d=>d.scoreCardId)]);
 const out=new Set<string>();
 for(const s of scores.values())for(const sub of s.subScores)for(const id of sub.evidence)out.add(id);
 for(const b of briefs)for(const cl of b.claims)for(const id of cl.citations)out.add(id);
 return out;
}

// ── 백테스트: 저장된 시계열로 기준 시점(마지막 관측 − 관측 기간)에 점수를 고정하고 그 뒤 실제 변화와 비교한다.
// 이력이 '기준 시점 이전 최소 4주 + 관측 기간'보다 짧으면 숫자를 만들지 않고 null과 사유를 돌려준다.
// 누설 차단(평가 1회차 H3): 후보 모집단과 모든 특징은 관측 기간 끝(period.to)이 기준 시점 이하인 관측만으로 만든다(truncateSnapshots).
//  - 지금의 쇼핑 상위·현재 순위·현재 검색수 상위로 후보를 고르지 않는다. 기준 시점 뒤에 처음 나타난 목록은 후보가 아니다.
//  - 사람이 지금 확인한 묶음·브랜드 적합성·소싱 연결·조사 방향은 쓰지 않는다(기준 시점에는 없던 판단). 추적 영상도 기준 시점 이전에 추가한 것만.
//  - 후보: 기준 시점 이전 관측으로 만든 상품 + 상품의 대표 묶음이 아닌 키워드 묶음(기준 시점 이전 검색 추세가 있는 것). 정답만 같은 대상의 전체 시계열로 잰다.
//  - 남은 한계: 데이터랩 상대값은 수집 때 요청 창 전체 최댓값으로 맞춘 값이라, 기준 시점 이전 점도 축척(배율)은 미래를 안다. 로그 기울기·보정 배율과는 무관하다.
export function truncateSnapshots(snapshots:readonly Snapshot[],asOf:string):Snapshot[]{
 const T=timeOf(asOf),out:Snapshot[]=[];
 for(const s of snapshots){const obs=s.observations.filter(o=>timeOf(o.period.to)<=T);if(obs.length)out.push(obs.length===s.observations.length?s:{...s,observations:obs})}
 return out;
}
// 키워드 묶음 후보(상품 목록 없이 수요만): 기준 시점 이전 검색 추세가 있는 묶음.
function keywordBundle(c:KeywordCluster,m:Material):ProductBundle|null{
 const keywordKeys=[...new Set([`kw:${c.normalized}`,...c.keywords.map(k=>`kw:${normalizeKeyword(k)}`)])].filter(k=>k!=='kw:');
 if(!m.series.some(s=>s.subjectKey===keywordKeys[0]&&s.metric==='search_trend'&&s.points.some(p=>p.value!==null)))return null;
 const market=new Set<string>();for(const k of c.keywords){const keys=m.scope.get(normalizeKeyword(k));if(keys)for(const x of keys)market.add(x)}
 const wanted=new Set([...keywordKeys,...market]),spec=categorySpec(c.categoryId);
 return {productId:`kg:${c.id}`,keywords:[...c.keywords],keywordKeys,listingKeys:[],series:m.series.filter(s=>wanted.has(s.subjectKey)),profit:null,
  feasibility:{moq:null,leadDays:null,needsCertification:spec?(CERT_CLASSES.includes(spec.regulatory)?true:spec.regulatory==='general'?null:false):null,temperature:spec?.temperature??'unknown'},
  risk:{regulatory:spec?.regulatory??'general',regulatorySure:!!spec,temperature:spec?.temperature??'unknown',titles:[]},brandFit:null};
}
export type BacktestUniverse={products:number;keywordGroups:number;excludedAfterAsOf:number;notes:string[]};
// 순수 계산(저장 없음): 스냅샷 → 누설 없는 후보 → 백테스트. 서버 backtest와 합성 하네스가 같이 쓴다.
export function backtestFromSnapshots(snapshots:readonly Snapshot[],horizonWeeks:number,threshold:number,at:string,videos:readonly CollectVideo[]=[],ctx:Pick<PipelineContext,'protectedBrands'|'ownBrands'>={}):{result:BacktestResult;universe:BacktestUniverse|null;candidates:ProductBundle[];rows:ReturnType<typeof runBacktest>['rows']}{
 const full=material(snapshots);
 let first=Infinity,last=0;
 for(const s of full.series)for(const p of s.points)if(p.value!==null){const t=timeOf(p.at);if(t<first)first=t;if(t>last)last=t}
 const H=horizonWeeks*7*DAY_MS,asOfT=last-H;
 const empty=(reason:string):BacktestResult=>({id:shortId('prb',{reason,horizonWeeks,threshold,at:at.slice(0,10)}),weightsVersion:'w1',asOf:Number.isFinite(asOfT)&&asOfT>0?new Date(asOfT).toISOString():at,horizonWeeks,candidates:0,
  precisionAtK:[{k:10,value:null},{k:20,value:null}],spearman:null,baselines:(['current_top','momentum_only','random'] as const).map(name=>({name,precisionAtK:[{k:10,value:null},{k:20,value:null}]})),
  label:`기준 시점 뒤 ${horizonWeeks}주에 대표 키워드 검색 추세(없으면 순위)가 ${Math.round(threshold*100)}% 이상 오른 상품·키워드 묶음`,computedAt:at,reason});
 const none={universe:null,candidates:[],rows:[]};
 if(!last)return {result:empty('저장된 상품·시계열이 없어 백테스트를 계산하지 않았습니다. 수집이나 가져오기 뒤 다시 실행하세요.'),...none};
 if(first>asOfT-4*7*DAY_MS)return {result:empty(`이력이 짧습니다. 기준 시점 이전 4주와 관측 기간 ${horizonWeeks}주가 필요하지만 저장된 시계열은 ${Math.max(0,Math.floor((last-first)/(7*DAY_MS)))}주입니다. 숫자를 만들지 않았습니다.`),...none};
 const asOf=new Date(asOfT).toISOString(),past=material(truncateSnapshots(snapshots,asOf));
 const c=computeProducts(past,[],videos.filter(v=>timeOf(v.addedAt)<=asOfT),new Set(),at,{protectedBrands:ctx.protectedBrands,ownBrands:ctx.ownBrands});
 const primaries=new Set(c.drafts.map(d=>d.bundle.keywordKeys[0]).filter(Boolean));
 const groupBundles=past.clusters.map(k=>keywordBundle(k,past)).filter((b):b is ProductBundle=>!!b&&!primaries.has(b.keywordKeys[0]));
 const candidates=[...c.drafts.map(d=>d.bundle),...groupBundles];
 if(!candidates.length)return {result:empty('기준 시점 이전에 관측된 상품·키워드 묶음이 없어 백테스트를 계산하지 않았습니다(기준 시점 뒤에 처음 나타난 상품은 후보가 아닙니다).'),...none};
 // 정답용 묶음: 같은 대상 키의 전체 시계열(기준 시점 뒤 포함). 점수에는 쓰지 않는다.
 const outcomes=new Map<string,ProductBundle>();
 for(const b of candidates){const keys=new Set([...b.keywordKeys,...b.listingKeys]);outcomes.set(b.productId,{...b,series:full.series.filter(s=>keys.has(s.subjectKey))})}
 const run=runBacktest({candidates,outcomes,asOf,horizonWeeks,threshold,computedAt:at});
 const excludedAfterAsOf=[...full.listings.keys()].filter(k=>!past.listings.has(k)).length;
 const universe:BacktestUniverse={products:c.drafts.length,keywordGroups:groupBundles.length,excludedAfterAsOf,
  notes:['후보·특징은 기준 시점 이전 관측만으로 만들었습니다.','데이터랩 상대값의 축척은 수집 때 요청 창 전체 기준이라 기준 시점 뒤 자료를 압니다(기울기·보정 배율에는 영향 없음).']};
 const r=run.result,result:BacktestResult={...r,label:r.label.replace(/상품$/,'상품·키워드 묶음'),universe,
  reason:r.candidates<10?`평가 가능한 후보가 ${r.candidates}개라 정밀도@10·@20을 계산하지 않았습니다(최소 10개).`:null};
 return {result,universe,candidates,rows:run.rows};
}
export async function backtest(owner:string,horizonWeeks:4|8|12,threshold:number,now=new Date(),videos:readonly CollectVideo[]=[]):Promise<BacktestResult>{
 const snapshots=await recentSnapshots(owner,new Date(now.getTime()-800*DAY_MS).toISOString(),RECOMPUTE_MAX_SNAPSHOTS);
 const ctx=await loadContext(owner,[],now);
 return backtestFromSnapshots(snapshots,horizonWeeks,threshold,now.toISOString(),videos,{protectedBrands:ctx.protectedBrands,ownBrands:ctx.ownBrands}).result;
}

// 상품 확인 도구: 목록 키를 실제 관측에서 찾는다(병합 대상 확인용).
export function knownListing(m:Material,key:string){return m.listings.get(key)??null}
export function productTitle(l:ListingInput){return cleanTitle(l.title,listingBrand(l))}
export async function loadMaterial(owner:string,now=new Date()){return material(await recentSnapshots(owner,new Date(now.getTime()-RECOMPUTE_WINDOW_DAYS*DAY_MS).toISOString(),RECOMPUTE_MAX_SNAPSHOTS))}
export function assertProductRoom(count:number){if(count>MAX_PRODUCTS)throw new ApiError(409,`상품은 ${MAX_PRODUCTS.toLocaleString('ko-KR')}개까지 저장할 수 있습니다.`)}
export const nowIso=()=>stamp();
