// 경쟁 강도(순수). 계획 4.2 '경쟁 강도'·⑤. 점수가 높을수록 들어가기 어렵다(점수표에서는 뒤집어 쓴다).
// 각 요소를 0~100으로 바꾼 뒤 있는 것만 가중 평균한다. 없는 요소는 0이 아니라 빠진다.
import type {Series,Snapshot,SourceId} from '../types';
import {buildSeries,sliceAsOf,latestValue,subjectKey,timeOf,DAY_MS} from './series';
import {groupDigits} from './format';

export type CompetitionListing={key:string;rank:number|null;reviewCount:number|null;price:number|null;firstSeenAt:string|null};
export type CompetitionInput={asOf:string;sellerCount:number|null;productCount:number|null;adCompetition:number|null;listings:CompetitionListing[];
 // 목록(상품) 시계열의 관측 시작 시각. 신규 진입 판단은 목록 관측 이력이 8주 이상일 때만 한다(처음 본 상품을 모두 신규로 오해하지 않게).
 // 평가 3회차 M2: 모든 목록 중 가장 이른 시각이 아니라, 신규 진입 판단에 쓰는 순위 목록의 범위(출처)마다 관측을 시작한 시각 중 가장 늦은 것이다.
 historyStart:string|null;evidence:string[];
 // 추가 필드(선택): 목록 범위(출처)별 관측 시작. 쇼핑 검색 범위는 이 키워드의 쇼핑 검색 관측(상품 수·판매처 수)이 시작된 시각을 쓴다.
 historyStartByScope?:Record<string,string>};
export type CompetitionResult={score:number|null;components:{key:'sellers'|'products'|'ad'|'concentration'|'dispersion'|'new_entrants';value:number;metric:number;weight:number}[];
 sellerCount:number|null;productCount:number|null;top10Hhi:number|null;priceDispersion:number|null;newEntrantShare:number|null;reasons:string[];evidence:string[];
 // 추가 필드: 가격 사분위(가격 있는 상품 4개 이상일 때)와 '비어 있는 자리' 한 문장(자료가 보여 줄 때만).
 priceBand?:{p25:number;p50:number;p75:number}|null;emptySlot?:string|null};
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
// 가격 사분위(원). 가격 있는 상품 4개 미만이면 null.
export function priceQuartiles(listings:readonly CompetitionListing[]):{p25:number;p50:number;p75:number}|null{
 const ps=listings.map(l=>l.price).filter((p):p is number=>p!==null&&p>0);if(ps.length<4)return null;
 return {p25:Math.round(quantile(ps,0.25)),p50:Math.round(quantile(ps,0.5)),p75:Math.round(quantile(ps,0.75))};
}
export const EMPTY_SLOT_RULES={minListings:8,bands:5,maxShare:0.1};
// 비어 있는 가격대: 가격 있는 상품 8개 이상에서 최저~최고가를 같은 폭 5칸으로 나눠, 가운데 3칸 중 상품 비율이 10% 이하이고 양옆 칸에는 상품이 있는 칸.
// 가장 비어 있는 칸 하나만 한 문장으로 말한다. 수요는 판단하지 않는다(그 가격대를 사람이 찾는지는 검색·판매 자료로 따로 확인).
export function emptyPriceSlot(listings:readonly CompetitionListing[]):string|null{
 const R=EMPTY_SLOT_RULES,ps=listings.map(l=>l.price).filter((p):p is number=>p!==null&&p>0).sort((a,b)=>a-b);
 if(ps.length<R.minListings)return null;
 const lo=ps[0],hi=ps[ps.length-1];if(!(hi>lo*1.5))return null;
 const w=(hi-lo)/R.bands,counts=new Array<number>(R.bands).fill(0);
 for(const p of ps)counts[Math.min(R.bands-1,Math.floor((p-lo)/w))]++;
 let best=-1;
 for(let i=1;i<R.bands-1;i++){if(counts[i]/ps.length>R.maxShare)continue;if(!counts.slice(0,i).some(Boolean)||!counts.slice(i+1).some(Boolean))continue;if(best<0||counts[i]<counts[best])best=i}
 if(best<0)return null;
 const from=Math.round((lo+w*best)/100)*100,to=Math.round((lo+w*(best+1))/100)*100;
 return `${groupDigits(from)}~${groupDigits(to)}원 가격대에는 관측 상품 ${groupDigits(ps.length)}개 중 ${groupDigits(counts[best])}개뿐이라 비어 있는 자리일 수 있습니다(그 가격대 수요는 따로 확인 필요).`;
}
// 신규 진입 속도: 순위 상위 20개 중 기준 시점 8주 안에 처음 보인 상품 비율.
// 순위가 없으면 '상위'를 정할 수 없어 계산하지 않는다(null, 평가 2회차 M2: 이름 순 20개를 상위로 오해하지 않게).
export function newEntrantShare(input:Pick<CompetitionInput,'asOf'|'listings'|'historyStart'>,weeks=8):number|null{
 const T=timeOf(input.asOf),cut=T-weeks*7*DAY_MS;
 if(!input.historyStart||timeOf(input.historyStart)>cut)return null;
 const top=input.listings.filter(l=>l.firstSeenAt&&l.rank!==null).sort((a,b)=>(a.rank as number)-(b.rank as number)).slice(0,20);
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
 return {score,components:comps,sellerCount:input.sellerCount,productCount:input.productCount,top10Hhi:hhi,priceDispersion:disp,newEntrantShare:fresh,reasons,evidence:[...input.evidence],
  priceBand:priceQuartiles(input.listings),emptySlot:emptyPriceSlot(input.listings)};
}

// 시계열에서 기준 시점의 경쟁 입력을 만든다. keywordKey의 seller_count·product_count·ad_competition과,
// 'ls:'로 시작하는 목록 시계열(rank·review_count·price_min)을 쓴다. 기준 시점 뒤의 점은 쓰지 않는다.
export function competitionInputFromSeries(all:readonly Series[],keywordKey:string,asOf:string,listingSources?:readonly SourceId[]):CompetitionInput{
 const frozen=all.map(s=>sliceAsOf(s,asOf)).filter(s=>s.points.length),evidence=new Set<string>();
 const kw=(metric:'seller_count'|'product_count'|'ad_competition')=>{const s=frozen.find(x=>x.subjectKey===keywordKey&&x.metric===metric);const p=s?latestValue(s.points):null;if(p)evidence.add(p.snapshotId);return p?p.value:null};
 const byListing=new Map<string,Series[]>();
 for(const s of frozen)if(s.subjectKey.startsWith('ls:')&&(!listingSources||listingSources.includes(s.sourceId))&&(s.metric==='rank'||s.metric==='review_count'||s.metric==='price_min'))byListing.set(s.subjectKey,[...(byListing.get(s.subjectKey)??[]),s]);
 const listings:CompetitionListing[]=[];
 // 관측 이력 시작은 목록 시계열(순위·리뷰·가격)에서만 잡는다. 데이터랩·검색광고 이력이 길어도 목록을 본 기간이 8주 미만이면 신규 진입은 미확인(null)이다(평가 2회차 M2).
 // 평가 3회차 M2: 범위(목록 출처)마다 따로 잡는다. 다른 출처·다른 키워드 목록을 오래 봤다고 이 범위의 신규 진입을 판단하지 않는다.
 const earliest=(ats:readonly string[])=>ats.reduce<string|null>((m,a)=>!m||timeOf(a)<timeOf(m)?a:m,null);
 const scopeStart=new Map<string,string>(),sourceOf=new Map<string,SourceId>();
 for(const [key,ss] of byListing){
  const pick=(m:string)=>{const s=ss.find(x=>x.metric===m);const p=s?latestValue(s.points):null;if(p)evidence.add(p.snapshotId);return p?p.value:null};
  const first=earliest(ss.flatMap(s=>s.points.filter(p=>p.value!==null).map(p=>p.at)));
  const src=ss[0].sourceId;sourceOf.set(key,src);
  if(first){const cur=scopeStart.get(src);if(!cur||timeOf(first)<timeOf(cur))scopeStart.set(src,first)}
  listings.push({key,rank:pick('rank'),reviewCount:pick('review_count'),price:pick('price_min'),firstSeenAt:first});
 }
 // 쇼핑 검색 범위는 키워드마다 다르다: 이 키워드의 쇼핑 검색 관측(상품 수·판매처 수)이 있으면 그 시작을 쓴다(다른 키워드 목록의 시작이 아니라).
 const shopKw=earliest(frozen.filter(x=>x.subjectKey===keywordKey&&x.sourceId==='naver_shop_search'&&(x.metric==='product_count'||x.metric==='seller_count')).flatMap(x=>x.points.filter(p=>p.value!==null).map(p=>p.at)));
 if(shopKw&&scopeStart.has('naver_shop_search'))scopeStart.set('naver_shop_search',shopKw);
 // 신규 진입 판단에 쓰는 범위: 순위가 있는 목록의 출처. 그 범위들의 시작 중 가장 늦은 것(모든 범위가 8주 이상 관측됐을 때만 판단). 순위 목록이 없으면 전체 목록 중 가장 이른 시작(표시용).
 const ranked=[...new Set(listings.filter(l=>l.rank!==null).map(l=>sourceOf.get(l.key)).filter((x):x is SourceId=>!!x))];
 const starts=ranked.map(src=>scopeStart.get(src)).filter((x):x is string=>!!x);
 const historyStart=starts.length?starts.reduce((m,a)=>timeOf(a)>timeOf(m)?a:m):earliest([...scopeStart.values()]);
 return {asOf,sellerCount:kw('seller_count'),productCount:kw('product_count'),adCompetition:kw('ad_competition'),listings:listings.sort((a,b)=>a.key<b.key?-1:1),historyStart,evidence:[...evidence].sort(),
  historyStartByScope:Object.fromEntries([...scopeStart.entries()].sort((a,b)=>a[0]<b[0]?-1:1))};
}
// 스냅샷 묶음에서 바로 만들 때(네이버 쇼핑·쿠팡·랭킹 관측). buildSeries를 거쳐 같은 규칙(실패 스냅샷 제외·재수집 우선)을 쓴다.
export function competitionFromSnapshots(snapshots:readonly Snapshot[],keyword:string,asOf:string,listingSources?:readonly SourceId[]):CompetitionResult{
 return assessCompetition(competitionInputFromSeries(buildSeries(snapshots),subjectKey({type:'keyword',text:keyword}),asOf,listingSources));
}
