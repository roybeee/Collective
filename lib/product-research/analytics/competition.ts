// 경쟁 강도(순수). 계획 4.2 '경쟁 강도'·⑤. 점수가 높을수록 들어가기 어렵다(점수표에서는 뒤집어 쓴다).
// 각 요소를 0~100으로 바꾼 뒤 있는 것만 가중 평균한다. 없는 요소는 0이 아니라 빠진다.
import type {Series,Snapshot,SourceId} from '../types';
import {buildSeries,sliceAsOf,latestValue,subjectKey,timeOf,DAY_MS} from './series';
import {groupDigits} from './format';

export type CompetitionListing={key:string;rank:number|null;reviewCount:number|null;price:number|null;firstSeenAt:string|null};
export type CompetitionInput={asOf:string;sellerCount:number|null;productCount:number|null;adCompetition:number|null;listings:CompetitionListing[];
 // 가장 이른 관측 시각. 신규 진입 판단은 관측 이력이 8주 이상일 때만 한다(처음 본 상품을 모두 신규로 오해하지 않게).
 historyStart:string|null;evidence:string[]};
export type CompetitionResult={score:number|null;components:{key:'sellers'|'products'|'ad'|'concentration'|'dispersion'|'new_entrants';value:number;metric:number;weight:number}[];
 sellerCount:number|null;productCount:number|null;top10Hhi:number|null;priceDispersion:number|null;newEntrantShare:number|null;reasons:string[];evidence:string[]};
export const COMPETITION_WEIGHTS={sellers:0.25,products:0.2,ad:0.2,concentration:0.15,dispersion:0.05,new_entrants:0.15};
const clamp=(v:number)=>Math.max(0,Math.min(100,v));
const quantile=(xs:number[],q:number)=>{const s=[...xs].sort((a,b)=>a-b),pos=(s.length-1)*q,lo=Math.floor(pos),hi=Math.ceil(pos);return s[lo]+(s[hi]-s[lo])*(pos-lo)};

// 상위 10개 리뷰 집중도(HHI): Σ(점유율²). 0.1이면 고르게 나뉨, 1이면 한 상품 독식. 순위가 있으면 순위 상위 10, 없으면 리뷰 수 상위 10.
export function top10Hhi(listings:readonly CompetitionListing[]):number|null{
 const withReviews=listings.filter(l=>l.reviewCount!==null&&l.reviewCount>=0);
 const ranked=withReviews.some(l=>l.rank!==null)?withReviews.filter(l=>l.rank!==null).sort((a,b)=>(a.rank as number)-(b.rank as number)):[...withReviews].sort((a,b)=>(b.reviewCount as number)-(a.reviewCount as number));
 const top=ranked.slice(0,10),total=top.reduce((s,l)=>s+(l.reviewCount as number),0);
 if(top.length<3||total<=0)return null;
 return top.reduce((s,l)=>s+((l.reviewCount as number)/total)**2,0);
}
// 가격 분산: IQR/중앙값. 상품 4개 미만이면 null.
export function priceDispersion(listings:readonly CompetitionListing[]):number|null{
 const ps=listings.map(l=>l.price).filter((p):p is number=>p!==null&&p>0);if(ps.length<4)return null;
 const med=quantile(ps,0.5);return med>0?(quantile(ps,0.75)-quantile(ps,0.25))/med:null;
}
// 신규 진입 속도: 상위 20개(순위 기준, 없으면 전체) 중 기준 시점 8주 안에 처음 보인 상품 비율.
export function newEntrantShare(input:Pick<CompetitionInput,'asOf'|'listings'|'historyStart'>,weeks=8):number|null{
 const T=timeOf(input.asOf),cut=T-weeks*7*DAY_MS;
 if(!input.historyStart||timeOf(input.historyStart)>cut)return null;
 const ranked=input.listings.filter(l=>l.firstSeenAt);const top=(ranked.some(l=>l.rank!==null)?ranked.filter(l=>l.rank!==null).sort((a,b)=>(a.rank as number)-(b.rank as number)):ranked).slice(0,20);
 if(top.length<5)return null;
 return top.filter(l=>timeOf(l.firstSeenAt as string)>cut).length/top.length;
}

export function assessCompetition(input:CompetitionInput):CompetitionResult{
 const W=COMPETITION_WEIGHTS,comps:CompetitionResult['components']=[],reasons:string[]=[];
 const hhi=top10Hhi(input.listings),disp=priceDispersion(input.listings),fresh=newEntrantShare(input);
 // 판매처 10곳=20, 100곳=45, 1,000곳=70, 10,000곳=95(로그 척도).
 if(input.sellerCount!==null){comps.push({key:'sellers',metric:input.sellerCount,value:clamp(20+25*Math.log10(Math.max(1,input.sellerCount)/10)),weight:W.sellers});reasons.push(`판매처 ${groupDigits(input.sellerCount)}곳`)}
 // 쇼핑 검색 상품 100개=20, 10만 개=80.
 if(input.productCount!==null){comps.push({key:'products',metric:input.productCount,value:clamp(20*Math.log10(Math.max(1,input.productCount))-20),weight:W.products});reasons.push(`검색 상품 ${groupDigits(input.productCount)}개`)}
 if(input.adCompetition!==null){comps.push({key:'ad',metric:input.adCompetition,value:clamp(input.adCompetition*100),weight:W.ad});reasons.push(`광고 경쟁 지수 ${input.adCompetition.toFixed(2)}`)}
 // 상위 집중도가 높으면 기존 강자가 리뷰를 쥐고 있어 들어가기 어렵다.
 if(hhi!==null){comps.push({key:'concentration',metric:hhi,value:clamp((hhi-0.1)/0.4*100),weight:W.concentration});reasons.push(`상위 10개 리뷰 집중도 ${hhi.toFixed(2)}`)}
 // 가격이 한곳에 몰리면(분산 작음) 가격 경쟁이 굳은 시장이다.
 if(disp!==null){comps.push({key:'dispersion',metric:disp,value:clamp((1-Math.min(disp,1))*100),weight:W.dispersion});reasons.push(`가격 분산(IQR/중앙값) ${disp.toFixed(2)}`)}
 // 최근 8주 신규 진입 비율이 높으면 진입 장벽이 낮다(쉬움).
 if(fresh!==null){comps.push({key:'new_entrants',metric:fresh,value:clamp((1-fresh)*100),weight:W.new_entrants});reasons.push(`상위 20개 중 최근 8주 신규 ${Math.round(fresh*100)}%`)}
 const wsum=comps.reduce((s,c)=>s+c.weight,0),score=wsum>0?Math.round(comps.reduce((s,c)=>s+c.value*c.weight,0)/wsum*10)/10:null;
 if(score===null)reasons.push('경쟁 지표가 없어 경쟁 강도를 판단하지 않았습니다.');
 return {score,components:comps,sellerCount:input.sellerCount,productCount:input.productCount,top10Hhi:hhi,priceDispersion:disp,newEntrantShare:fresh,reasons,evidence:[...input.evidence]};
}

// 시계열에서 기준 시점의 경쟁 입력을 만든다. keywordKey의 seller_count·product_count·ad_competition과,
// 'ls:'로 시작하는 목록 시계열(rank·review_count·price_min)을 쓴다. 기준 시점 뒤의 점은 쓰지 않는다.
export function competitionInputFromSeries(all:readonly Series[],keywordKey:string,asOf:string,listingSources?:readonly SourceId[]):CompetitionInput{
 const frozen=all.map(s=>sliceAsOf(s,asOf)).filter(s=>s.points.length),evidence=new Set<string>();
 const kw=(metric:'seller_count'|'product_count'|'ad_competition')=>{const s=frozen.find(x=>x.subjectKey===keywordKey&&x.metric===metric);const p=s?latestValue(s.points):null;if(p)evidence.add(p.snapshotId);return p?p.value:null};
 const byListing=new Map<string,Series[]>();
 for(const s of frozen)if(s.subjectKey.startsWith('ls:')&&(!listingSources||listingSources.includes(s.sourceId))&&(s.metric==='rank'||s.metric==='review_count'||s.metric==='price_min'))byListing.set(s.subjectKey,[...(byListing.get(s.subjectKey)??[]),s]);
 const listings:CompetitionListing[]=[];let historyStart:string|null=null;
 for(const s of frozen){const first=s.points[0]?.at;if(first&&(!historyStart||timeOf(first)<timeOf(historyStart)))historyStart=first}
 for(const [key,ss] of byListing){
  const pick=(m:string)=>{const s=ss.find(x=>x.metric===m);const p=s?latestValue(s.points):null;if(p)evidence.add(p.snapshotId);return p?p.value:null};
  const first=ss.flatMap(s=>s.points.filter(p=>p.value!==null).map(p=>p.at)).sort((a,b)=>timeOf(a)-timeOf(b))[0]??null;
  listings.push({key,rank:pick('rank'),reviewCount:pick('review_count'),price:pick('price_min'),firstSeenAt:first});
 }
 return {asOf,sellerCount:kw('seller_count'),productCount:kw('product_count'),adCompetition:kw('ad_competition'),listings:listings.sort((a,b)=>a.key<b.key?-1:1),historyStart,evidence:[...evidence].sort()};
}
// 스냅샷 묶음에서 바로 만들 때(네이버 쇼핑·쿠팡·랭킹 관측). buildSeries를 거쳐 같은 규칙(실패 스냅샷 제외·재수집 우선)을 쓴다.
export function competitionFromSnapshots(snapshots:readonly Snapshot[],keyword:string,asOf:string,listingSources?:readonly SourceId[]):CompetitionResult{
 return assessCompetition(competitionInputFromSeries(buildSeries(snapshots),subjectKey({type:'keyword',text:keyword}),asOf,listingSources));
}
