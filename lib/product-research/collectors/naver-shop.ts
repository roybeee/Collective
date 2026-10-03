// 네이버 검색 API 쇼핑 수집기(GET /v1/search/shop.json). 키워드 하나의 상품 수·최저가·중앙값·판매처 수와 상위 100개 목록.
// 상품 수(total)는 전체 검색 결과 수이고, 가격·판매처는 정확도순 상위 100개 표본에서만 센다(limitations에 적음).
// 인증은 개발자센터 키(데이터랩과 같은 앱)다. 호스트는 고정 상수이고, 목록의 link는 저장할 자료일 뿐 호출하지 않는다.
import type {NaverDevelopersCredential} from '../credentials';
import type {Observation,Subject} from '../types';
import {fetchSourceJson,keywordInput,list,median,nonNegative,record,text} from './http';
import {kstDayKey,unitsFor} from './quota';
import type {CollectDeps,CollectResult} from './index';

export const SHOP_BASE='https://openapi.naver.com';
const PATH='/v1/search/shop.json';
// display 최대 100. 상품 100개 응답은 100KB 안팎이다.
const DISPLAY=100;
const MAX_BYTES=600_000;
const LABEL='네이버 쇼핑 검색';

const ENTITIES:Record<string,string>={'&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&#39;':"'",'&apos;':"'"};
// 검색 API 제목은 검색어를 <b>로 감싸 준다. 태그를 지우고 흔한 HTML 엔티티만 되돌린다.
export function stripTags(value:string):string{
 return value.replace(/<\/?[a-zA-Z][^>]*>/g,'').replace(/&(amp|lt|gt|quot|#39|apos);/g,m=>ENTITIES[m]??m).replace(/\s+/g,' ').trim();
}

function link(value:unknown):string|null{
 const v=text(value,1000);
 if(!v)return null;
 try{const u=new URL(v);return u.protocol==='https:'||u.protocol==='http:'?u.toString():null}catch{return null}
}

export async function collectShopSearch(credential:NaverDevelopersCredential,searchQuery:string,deps:CollectDeps):Promise<CollectResult>{
 const q=keywordInput(searchQuery,'검색어',100);
 const res=await fetchSourceJson('naver_shop_search',`${SHOP_BASE}${PATH}?query=${encodeURIComponent(q)}&display=${DISPLAY}&start=1&sort=sim`,{method:'GET',headers:{
  'X-Naver-Client-Id':credential.clientId,'X-Naver-Client-Secret':credential.clientSecret,
 }},deps,{label:LABEL,maxBytes:MAX_BYTES});
 const day=kstDayKey(new Date(res.fetchedAt)),period={from:day,to:day};
 const body=record(res.json);
 const items=list(body.items);
 const observations:Observation[]=[];
 const prices:number[]=[],malls=new Set<string>();
 let skipped=0,noPrice=0,naverCatalog=0;
 for(const raw of items){
  const item=record(raw);
  const productId=text(item.productId,60),title=typeof item.title==='string'?stripTags(item.title).slice(0,300):'';
  if(!productId||!title){skipped++;continue}
  // lprice가 빈 값이거나 0이면 가격 미확인이다(0원 상품으로 보지 않는다).
  const lprice=nonNegative(item.lprice);
  const price=lprice!==null&&lprice>0?lprice:null;
  if(price===null)noPrice++;else prices.push(price);
  const mall=text(item.mallName,100);
  if(mall){malls.add(mall);if(mall==='네이버')naverCatalog++}
  const categoryPath=[item.category1,item.category2,item.category3,item.category4].map(c=>text(c,60)).filter(Boolean).join('>')||null;
  const brand=text(item.brand,100)??text(item.maker,100);
  const subject:Subject={type:'listing',sourceId:'naver_shop_search',externalId:productId,title,brand,price,url:link(item.link),categoryPath};
  observations.push({subject,metric:'price_min',value:price,period,scope:`search:${q}`});
 }
 const keyword:Subject={type:'keyword',text:q};
 const total=nonNegative(body.total);
 const minPrice=prices.length?Math.min(...prices):null;
 observations.unshift(
  {subject:keyword,metric:'product_count',value:total,period},
  {subject:keyword,metric:'price_min',value:minPrice,period},
  {subject:keyword,metric:'price_median',value:median(prices),period},
  // 판매처가 하나도 확인되지 않으면 0이 아니라 미확인이다.
  {subject:keyword,metric:'seller_count',value:malls.size?malls.size:null,period},
 );
 const limitations=[
  `가격·판매처 수는 정확도순 상위 ${DISPLAY}개 표본 기준입니다. 상품 수는 검색 결과 전체 수입니다.`,
  '최저가(lprice)는 판매처가 등록한 값이며 배송비·쿠폰을 반영하지 않습니다.',
 ];
 if(naverCatalog)limitations.push(`가격비교로 묶인 상품 ${naverCatalog}개는 판매처가 '네이버'로 표시돼 판매처 수가 적게 잡힙니다.`);
 if(noPrice)limitations.push(`가격이 없는 상품 ${noPrice}개는 가격 계산에서 뺐습니다(미확인).`);
 if(skipped)limitations.push(`상품 ID나 제목이 없는 응답 행 ${skipped}개를 건너뛰었습니다.`);
 if(total===null)limitations.push('전체 상품 수를 확인하지 못했습니다.');
 if(!items.length)limitations.push('검색 결과 상품이 없습니다.');
 return {
  draft:{
   sourceId:'naver_shop_search',method:'api',
   request:{query:q,display:DISPLAY,sort:'sim'},
   fetchedAt:res.fetchedAt,bodyDigest:res.bodyDigest,bodyBytes:res.bodyBytes,
   status:skipped||noPrice||total===null?'partial':'ok',
   limitations,observations,
  },
  unitsUsed:unitsFor('naver_shop_search','shop_search'),
 };
}
