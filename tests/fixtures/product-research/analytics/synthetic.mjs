// 상품 리서치 분석 계층 합성 정답셋(결정형). 상온 식품 위주 40개 상품 × 78주.
// 정답(cls)은 생성 규칙에서 나온다: rising·seasonal_winter·seasonal_summer·fad·declining·steady. 모델 코드를 보지 않고 만든 '세계'이며,
// 점수 모델이 기준선을 못 이기면 모델을 고친다(이 파일을 모델에 맞춰 고치지 않는다). 가정:
// - 검색·영상·순위는 같은 실제 관심도(V)를 따라 움직인다(영상이 검색을 앞서는 식의 유리한 선행 관계는 넣지 않았다).
// - 판매처 수·가격·원가·MOQ는 상품 부류와 무관한 무작위다(경쟁·수익성은 정답과 상관없는 잡음 요인이다).
// - 데이터랩은 과거 전체를 한 번에 받은 스냅샷 1개(최댓값=100 정규화), 검색광고는 4주마다 최근 30일 실측(±3% 잡음).
import {createHash} from 'node:crypto';

export const START='2025-03-31'; // 1주차 월요일
export const WEEKS=78,AS_OF_WEEK=65,HORIZON=12;
const D=86400000,start=Date.parse(START+'T00:00:00Z');
export const weekStart=w=>new Date(start+w*7*D).toISOString().slice(0,10);
export const weekEnd=w=>new Date(start+(w*7+6)*D).toISOString().slice(0,10);
export const AS_OF=weekEnd(AS_OF_WEEK); // 2026-07-05
const sha=s=>createHash('sha256').update(s).digest('hex');

function rng(seed){let t=parseInt(sha(seed).slice(0,8),16)>>>0;const u=()=>{t=(t+0x6d2b79f5)>>>0;let r=Math.imul(t^(t>>>15),1|t);r=(r+Math.imul(r^(r>>>7),61|r))^r;return ((r^(r>>>14))>>>0)/4294967296};const n=()=>{const a=Math.max(u(),1e-12),b=u();return Math.sqrt(-2*Math.log(a))*Math.cos(2*Math.PI*b)};return {u,n,range:(lo,hi)=>lo+(hi-lo)*u()}}

// [id, 키워드, 카테고리, 부류, 브랜드, 특수]
const CATALOG=[
 ['p01','마라소스','food_sauce','rising','오뚜기'],['p02','불닭소스','food_sauce','steady','삼양'],['p03','떡볶이소스','food_sauce','steady','청정원'],['p04','쌈장','food_sauce','declining','해찬들'],
 ['p05','굴소스','food_sauce','steady','이금기'],['p06','트러플마요','food_sauce','rising','비비고'],['p07','스리라차','food_sauce','fad_old','후이펑'],['p08','고추장','food_sauce','steady','순창'],['p09','들기름','food_sauce','steady','오뚜기'],
 ['p10','김부각','food_snack','rising','오희숙'],['p11','약과','food_snack','fad_old','장인한과'],['p12','누룽지칩','food_snack','steady','엄마사랑'],['p13','쌀과자','food_snack','declining','기라성'],
 ['p14','두바이초콜릿','food_snack','fad_now','달콤상회'],['p15','버터떡','food_snack','fad_now','떡방앗간'],['p16','곤약젤리','food_snack','fad_later','이너젠'],['p17','곡물바','food_snack','rising','바른곡물','rank_only'],
 ['p18','비빔면','food_noodle','seasonal_summer','팔도'],['p19','냉면사리','food_noodle','seasonal_summer','칠갑'],['p20','마라탕면','food_noodle','rising','농심'],['p21','쌀국수','food_noodle','steady','백제'],['p22','짜파게티','food_noodle','steady','농심'],
 ['p23','즉석밥','food_instant','steady','햇반'],['p24','컵밥','food_instant','declining','오뚜기'],['p25','누룽지','food_instant','seasonal_winter','청원'],['p26','레토르트카레','food_instant','steady','3분'],
 ['p27','유자차','food_tea_drink','seasonal_winter','담터'],['p28','생강차','food_tea_drink','seasonal_winter','녹차원'],['p29','콤부차','food_tea_drink','steady','티젠'],['p30','식혜','food_tea_drink','seasonal_summer','비락'],
 ['p31','단백질쉐이크','food_tea_drink','rising','하이뮨'],['p32','보리차','food_tea_drink','steady','동서'],
 ['p33','황태채','food_dried','steady','바다원'],['p34','쥐포','food_dried','declining','삼천포'],['p35','건나물','food_dried','declining','정선'],['p36','김자반','food_dried','rising','광천'],
 ['p37','유산균젤리','food_health','rising','락토핏','hff'],['p38','냉동만두','food_frozen','rising','비비고','frozen'],
 ['p39','들기름막국수','food_noodle','rising','풀무원','no_anchor'],['p40','하이볼믹스','food_tea_drink','rising','진로','short'],
];
export const POSITIVE_CLASSES=new Set(['rising','seasonal_winter']);

function trueVolume(cls,r,special){
 const base=Math.exp(r.range(Math.log(3000),Math.log(60000))),V=[];
 const g=r.range(0.03,0.055),s=Math.round(r.range(36,56)),dg=r.range(0.012,0.03),ds=Math.round(r.range(10,40)),a=r.range(0.55,0.72);
 const f={fad_old:Math.round(r.range(22,42)),fad_now:AS_OF_WEEK-Math.round(r.range(1,2)),fad_later:AS_OF_WEEK+Math.round(r.range(3,5))}[cls],A=r.range(4,8),tau=r.range(1,1.8);
 let ar=0;
 for(let w=0;w<WEEKS;w++){
  ar=0.5*ar+r.n()*0.07; // 주간 잡음(AR(1), 약 8%)
  let v=base;
  if(cls==='rising')v=base*Math.exp(g*Math.max(0,w-(special==='short'?Math.min(s,54):s)));
  if(cls==='declining')v=base*Math.exp(-dg*Math.max(0,w-ds));
  if(cls==='seasonal_winter')v=base*(1+a*Math.cos(2*Math.PI*(w-41)/52)); // 1월 중순 정점
  if(cls==='seasonal_summer')v=base*(1+a*Math.cos(2*Math.PI*(w-67)/52)); // 7월 중순 정점
  if(cls.startsWith('fad')){const d=w-f;if(d>=0)v=base*(1+A*Math.exp(-d/tau));else if(d===-1)v=base*(1+A*0.35)}
  V.push(v*Math.exp(ar));
 }
 return V;
}

function snap(id,sourceId,method,fetchedAt,request,observations,importedBy=null){
 return {id,sourceId,method,request,fetchedAt,bodyDigest:sha(id),bodyBytes:200+observations.length*40,status:'ok',limitations:[],importedBy,observations};
}

export function makeFixture(seed='pr-analytics-v1'){
 const snapshots=[],products=[];
 const cats=new Map();
 for(const [id,keyword,categoryId,cls,brand,special] of CATALOG){
  const r=rng(seed+':'+id),V=trueVolume(cls,r,special);
  const firstWeek=special==='short'?52:0;
  const price=Math.round(r.range(8,25))*1000-100,hasProfit=r.u()<0.65,hasFeas=r.u()<0.75,hasVideo=r.u()<0.7&&special!=='rank_only',hasShop=r.u()<0.9;
  const p={id,keyword,categoryId,cls,brand,special:special??null,name:`${brand} ${keyword}`,price,V,firstWeek,
   titles:[`${brand} ${keyword} ${special==='frozen'?'냉동 ':''}${Math.round(r.range(2,10))*100}g`],
   profit:hasProfit?{price,unitCost:Math.round(price*r.range(0.3,0.6)),shipping:3000,packaging:Math.round(r.range(300,900)),channel:r.u()<0.5?'naver_smartstore':'coupang',returnRate:0.02}:null,
   feasibility:hasFeas?{moq:[50,100,300,500,1000,3000][Math.floor(r.u()*6)],leadDays:[3,7,14,21,30,60][Math.floor(r.u()*6)],needsCertification:special==='hff',temperature:special==='frozen'?'frozen':'ambient'}:null,
   brandFit:r.u()<0.15?{value:Math.round(r.range(40,90)),by:'대표',evidence:[]}:null,
   hasVideo,hasShop,adCompetition:Math.round(r.range(0.2,0.95)*100)/100,sellerBase:Math.exp(r.range(Math.log(40),Math.log(4000))),conv:Math.exp(r.n()*0.3)};
  products.push(p);
  if(!cats.has(categoryId))cats.set(categoryId,[]);cats.get(categoryId).push(p);
  const kw={type:'keyword',text:keyword};
  if(special!=='rank_only'){
   // 데이터랩: 과거 전체 1회(재수집 시 같은 값), 최댓값 100 정규화
   const obsW=V.map((v,w)=>w>=firstWeek?v:null),mx=Math.max(...obsW.filter(x=>x!==null));
   snapshots.push(snap(`dl-${id}`,'naver_datalab_search','api','2026-09-28T01:00:00Z',{keyword,timeUnit:'week',startDate:weekStart(firstWeek),endDate:weekEnd(WEEKS-1)},
    obsW.map((v,w)=>v===null?null:{subject:kw,metric:'search_trend',value:Math.round(100*v/mx*100)/100,period:{from:weekStart(w),to:weekEnd(w)}}).filter(Boolean)));
   // 검색광고: 4주마다 최근 30일 실측
   if(special!=='no_anchor')for(let w=Math.max(firstWeek+4,3);w<WEEKS;w+=4){
    let sum=0;for(let d=0;d<30;d++){const day=w*7+6-d,wk=Math.floor(day/7);sum+=(V[Math.max(firstWeek,wk)]??0)/7}
    const value=Math.round(sum*(1+r.n()*0.03));
    snapshots.push(snap(`sa-${id}-${w}`,'naver_searchad_keyword','api',new Date(start+(w*7+7)*D+3600000).toISOString(),{keyword},[
     {subject:kw,metric:'search_volume_month',value,period:{from:new Date(start+(w*7+6-29)*D).toISOString().slice(0,10),to:weekEnd(w)}},
     {subject:kw,metric:'ad_competition',value:p.adCompetition,period:{from:weekEnd(w),to:weekEnd(w)}}]));
   }
   // 네이버 쇼핑 검색: 4주마다 판매처·상품 수·가격
   if(p.hasShop)for(let w=Math.max(firstWeek,1);w<WEEKS;w+=4){
    const sellers=Math.round(p.sellerBase*(1+0.002*w)*Math.exp(r.n()*0.05));
    snapshots.push(snap(`ns-${id}-${w}`,'naver_shop_search','api',new Date(start+(w*7+7)*D+7200000).toISOString(),{query:keyword},[
     {subject:kw,metric:'seller_count',value:sellers,period:{from:weekEnd(w),to:weekEnd(w)}},
     {subject:kw,metric:'product_count',value:Math.round(sellers*r.range(8,30)),period:{from:weekEnd(w),to:weekEnd(w)}},
     {subject:kw,metric:'price_min',value:Math.round(price*r.range(0.6,0.85)/10)*10,period:{from:weekEnd(w),to:weekEnd(w)}}]));
   }
   // 유튜브: 추적 영상 묶음의 누적 조회수·영상 수(매주)
   if(p.hasVideo){let cum=Math.round(V[firstWeek]*20);const vk=r.range(0.5,3);
    for(let w=firstWeek;w<WEEKS;w++){cum+=Math.round(V[w]*vk*Math.exp(r.n()*0.15));
     snapshots.push(snap(`yt-${id}-${w}`,'youtube_data','api',new Date(start+(w*7+7)*D+10800000).toISOString(),{q:keyword},[
      {subject:kw,metric:'video_views',value:cum,period:{from:weekEnd(w),to:weekEnd(w)}},
      {subject:kw,metric:'video_count',value:Math.round(10+Math.sqrt(V[w])*0.8),period:{from:weekEnd(w),to:weekEnd(w)}}]));}
   }
  }
 }
 // 쿠팡 카테고리 랭킹(운영자 가져오기, 매주): 우리 후보 + 경쟁 상품 14개(일부는 중간에 새로 진입). 상위 20개만 기록.
 for(const [categoryId,members] of cats){
  const r=rng(seed+':rank:'+categoryId),medPop=members.map(p=>p.V[AS_OF_WEEK]*p.conv).sort((a,b)=>a-b)[members.length>>1];
  const comps=Array.from({length:14},(_,j)=>({key:`cp-${categoryId}-c${j}`,pop:medPop*Math.exp(r.n()*0.8),enter:r.u()<0.3?Math.round(r.range(20,75)):0,price:Math.round(r.range(6,22))*1000-100,reviews:Math.round(Math.exp(r.range(3,9)))}));
  for(let w=0;w<WEEKS;w++){
   const rows=[...members.filter(p=>w>=p.firstWeek).map(p=>({key:`cp-${p.id}`,title:p.titles[0],brand:p.brand,price:p.price,pop:p.V[w]*p.conv*Math.exp(r.n()*0.1),reviews:Math.round(50+p.V.slice(0,w+1).reduce((a,b)=>a+b,0)*0.002)})),
    ...comps.filter(c=>w>=c.enter).map(c=>({key:c.key,title:`경쟁상품 ${c.key}`,brand:null,price:c.price,pop:c.pop*Math.exp(r.n()*0.1),reviews:c.reviews+Math.round(w*c.reviews*0.01)}))].sort((a,b)=>b.pop-a.pop).slice(0,20);
   const obs=[];rows.forEach((x,i)=>{const subject={type:'listing',sourceId:'coupang_ranking_manual',externalId:x.key,title:x.title,brand:x.brand,price:x.price,url:null,categoryPath:categoryId};const period={from:weekEnd(w),to:weekEnd(w)},scope=`쿠팡 ${categoryId} 랭킹`;
    obs.push({subject,metric:'rank',value:i+1,period,scope},{subject,metric:'review_count',value:x.reviews,period,scope},{subject,metric:'price_min',value:x.price,period,scope})});
   snapshots.push(snap(`cr-${categoryId}-${w}`,'coupang_ranking_manual','manual',new Date(start+(w*7+7)*D+14400000).toISOString(),{category:categoryId},obs,{id:'op-1',email:null,fileName:`coupang-${categoryId}-${weekEnd(w)}.csv`}));
  }
 }
 return {snapshots,products,asOf:AS_OF,horizonWeeks:HORIZON};
}
