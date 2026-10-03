// 상품 리서치 재계산 파이프라인(서버, 외부 호출 없음). docs/PRODUCT-RESEARCH-PLAN.ko.md 4절.
// 저장된 스냅샷 → 시계열(buildSeries) → 키워드 묶음(groupKeywords) → 상품 매칭(matchListings, 사람 확인한 묶음은 고정) → 점수표(w1).
// 점수표 판은 불변이다: 입력 해시(inputDigest)가 같으면 같은 id라 새 판을 만들지 않는다. 상품 id는 목록이 겹치는 기존 상품 id를 이어 쓴다.
// 계산 범위(Workers 메모리·CPU 한도): 최근 120일 스냅샷 최대 3,000개, 키워드 최대 500개, 자동 매칭 목록 최대 400개.
import {ApiError,database,stamp} from '../server';
import {categorySpec,CATEGORIES} from './categories';
import {buildSeries,subjectKey,timeOf,DAY_MS} from './analytics/series';
import {groupKeywords,normalizeKeyword,toKeywordGroup,type KeywordCluster} from './analytics/normalize';
import {matchListings,classifyListing,listingKey,cleanTitle,listingBrand,type ListingInput,type Classification} from './analytics/match';
import {buildScoreInput,scoreCard,type ProductBundle} from './analytics/score';
import {runBacktest} from './analytics/backtest';
import {shortId} from './analytics/hash';
import {K,MAX_PRODUCTS,MAX_SCORES,bulkDelete,bulkPut,countKind,listKind,readMany,recentSnapshots} from './server-store';
import type {BacktestResult,KeywordGroup,MdDecision,MdBrief,ResearchProduct,RegulatoryClass,ScoreCard,Series,SeriesPoint,Snapshot,SourceId,Temperature} from './types';

export const RECOMPUTE_WINDOW_DAYS=120,RECOMPUTE_MAX_SNAPSHOTS=3000,MAX_KEYWORDS=500,MAX_AUTO_LISTINGS=400;
const RANK_SOURCES:readonly SourceId[]=['coupang_partners','licensed_ranking','coupang_ranking_manual','musinsa_ranking_manual','oliveyoung_ranking_manual'];

// 저장 형태: 화면 계약(ResearchProduct)에 현재 점수표 포인터와 사람 브랜드 적합성 판정을 더한다.
export type BrandFitJudgement={value:number;reason:string;by:{id:string;email:string|null};at:string};
export type StoredProduct=ResearchProduct&{scoreId:string|null;brandFit:BrandFitJudgement|null};
export type CollectVideo={id:string;keyword:string;addedAt:string};
export const isPinned=(p:Pick<ResearchProduct,'match'>)=>p.match.confirmedBy!==null;

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
function bundleFor(p:ResearchProduct,m:Material,videos:readonly CollectVideo[],brandFit:BrandFitJudgement|null,classification:Classification):Draft['bundle']&{asOf:string}{
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
 return {productId:p.id,keywords,keywordKeys,listingKeys,series,profit:null,
  feasibility:{moq:null,leadDays:null,needsCertification,temperature:p.temperature},
  risk:{regulatory:p.regulatory,regulatorySure:classification.regulatorySure,temperature:p.temperature,titles:p.listings.map(l=>l.title)},
  brandFit:brandFit?{value:brandFit.value,by:'대표·MD',evidence:[]}:null,asOf};
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
export function computeProducts(m:Material,existing:readonly StoredProduct[],videos:readonly CollectVideo[],keepIds:ReadonlySet<string>,at:string):Computed{
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
   match:{method:mp.method,confidence:mp.confidence,confirmedBy:null},createdAt:prev?.createdAt??at,updatedAt:at,scoreId:prev?.scoreId??null,brandFit:prev?.brandFit??null};
  drafts.push({product,classification:cls,...splitBundle(bundleFor(product,m,videos,product.brandFit,cls))});
 }
 // 사람이 확인한 상품: 목록 묶음은 그대로 두고 제목·가격만 최신 관측으로 새로 쓴다.
 for(const p of pinned){
  const ls=p.listings.map(l=>m.listings.get(`${l.sourceId}:${l.externalId}`)??{...l,brand:null,price:null,categoryPath:null});
  const prices=ls.map(l=>l.price).filter((x):x is number=>typeof x==='number'&&x>0);
  const groupIds=linkGroups(p.name,ls.map(listingKey),m),cls=withCategory(classify(ls,m.clusters),groupIds,m);
  const product:StoredProduct={...p,categoryId:cls.categoryId,temperature:cls.temperature,regulatory:cls.regulatory,priceBand:prices.length?{min:Math.min(...prices),max:Math.max(...prices)}:p.priceBand,
   listings:ls.map(l=>({sourceId:l.sourceId,externalId:l.externalId,title:l.title,url:l.url})),keywordGroupIds:groupIds,updatedAt:at};
  drafts.push({product,classification:cls,...splitBundle(bundleFor(product,m,videos,p.brandFit,cls))});
 }
 // 상품 한도: 결정·사람 확인이 있는 것은 남기고, 자동 상품 중 우선순위가 낮은 것부터 뺀다.
 let dropped:string[]=[];
 if(drafts.length>MAX_PRODUCTS){const keep=drafts.filter(d=>isPinned(d.product)||keepIds.has(d.product.id)),rest=drafts.filter(d=>!keep.includes(d));dropped=rest.slice(Math.max(0,MAX_PRODUCTS-keep.length)).map(d=>d.product.id);drafts.splice(0,drafts.length,...keep,...rest.slice(0,Math.max(0,MAX_PRODUCTS-keep.length)))}
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
 const c=computeProducts(m,existing,videos,decided,at);
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
export async function backtest(owner:string,horizonWeeks:4|8|12,threshold:number,now=new Date(),videos:readonly CollectVideo[]=[]):Promise<BacktestResult>{
 const snapshots=await recentSnapshots(owner,new Date(now.getTime()-800*DAY_MS).toISOString(),RECOMPUTE_MAX_SNAPSHOTS);
 const m=material(snapshots),existing=await loadProducts(owner),at=now.toISOString();
 const c=computeProducts(m,existing,videos,new Set(existing.map(p=>p.id)),at);
 let first=Infinity,last=0;
 for(const d of c.drafts)for(const s of d.bundle.series)for(const p of s.points)if(p.value!==null){const t=timeOf(p.at);if(t<first)first=t;if(t>last)last=t}
 const H=horizonWeeks*7*DAY_MS,asOfT=last-H;
 const empty=(reason:string):BacktestResult=>({id:shortId('prb',{reason,horizonWeeks,threshold,at:at.slice(0,10)}),weightsVersion:'w1',asOf:Number.isFinite(asOfT)&&asOfT>0?new Date(asOfT).toISOString():at,horizonWeeks,candidates:0,
  precisionAtK:[{k:10,value:null},{k:20,value:null}],spearman:null,baselines:(['current_top','momentum_only','random'] as const).map(name=>({name,precisionAtK:[{k:10,value:null},{k:20,value:null}]})),
  label:`기준 시점 뒤 ${horizonWeeks}주에 대표 키워드 검색 추세(없으면 순위)가 ${Math.round(threshold*100)}% 이상 오른 상품`,computedAt:at,reason});
 if(!c.drafts.length||!last)return empty('저장된 상품·시계열이 없어 백테스트를 계산하지 않았습니다. 수집이나 가져오기 뒤 다시 실행하세요.');
 if(first>asOfT-4*7*DAY_MS)return empty(`이력이 짧습니다. 기준 시점 이전 4주와 관측 기간 ${horizonWeeks}주가 필요하지만 저장된 시계열은 ${Math.max(0,Math.floor((last-first)/(7*DAY_MS)))}주입니다. 숫자를 만들지 않았습니다.`);
 const run=runBacktest({candidates:c.drafts.map(d=>d.bundle),asOf:new Date(asOfT).toISOString(),horizonWeeks,threshold,computedAt:at});
 const r=run.result;
 return r.candidates<10?{...r,reason:`평가 가능한 후보가 ${r.candidates}개라 정밀도@10·@20을 계산하지 않았습니다(최소 10개).`}:{...r,reason:null};
}

// 상품 확인 도구: 목록 키를 실제 관측에서 찾는다(병합 대상 확인용).
export function knownListing(m:Material,key:string){return m.listings.get(key)??null}
export function productTitle(l:ListingInput){return cleanTitle(l.title,listingBrand(l))}
export async function loadMaterial(owner:string,now=new Date()){return material(await recentSnapshots(owner,new Date(now.getTime()-RECOMPUTE_WINDOW_DAYS*DAY_MS).toISOString(),RECOMPUTE_MAX_SNAPSHOTS))}
export function assertProductRoom(count:number){if(count>MAX_PRODUCTS)throw new ApiError(409,`상품은 ${MAX_PRODUCTS.toLocaleString('ko-KR')}개까지 저장할 수 있습니다.`)}
export const nowIso=()=>stamp();
