// 네이버 데이터랩 수집기: 검색어 트렌드(POST /v1/datalab/search), 쇼핑인사이트 분야(/v1/datalab/shopping/categories)·분야 내 키워드(/category/keywords).
// 데이터랩은 요청 하나 안에서 최댓값을 100으로 둔 상대값만 준다. 다른 요청끼리 크기를 비교할 수 없어 검색광고 절대값으로 보정한다(P2 정규화).
// 인증은 개발자센터 X-Naver-Client-Id·X-Naver-Client-Secret 헤더다. 호스트는 고정 상수다.
import type {NaverDevelopersCredential} from '../credentials';
import type {Observation,SourceId} from '../types';
import {fetchSourceJson,inputError,isoDay,keywordInput,list,nonNegative,record,text} from './http';
import {unitsFor} from './quota';
import type {QuotaOperation} from './quota';
import type {CollectDeps,CollectResult} from './index';

export const DATALAB_BASE='https://openapi.naver.com';
export type DatalabTimeUnit='date'|'week'|'month';
export type DatalabSearchInput={startDate:string;endDate:string;timeUnit:DatalabTimeUnit;keywordGroups:{groupName:string;keywords:string[]}[]};
export type DatalabCategoryInput={startDate:string;endDate:string;timeUnit:DatalabTimeUnit;categories:{name:string;code:string}[]};
export type DatalabCategoryKeywordInput={startDate:string;endDate:string;timeUnit:DatalabTimeUnit;categoryCode:string;keywords:{name:string;keyword:string}[]};

// 공식 한도: 검색어 트렌드 주제어 묶음 5개·묶음당 키워드 20개. 쇼핑인사이트 분야 3개, 분야 내 키워드 5개(각 1개 키워드).
// 쇼핑인사이트 한도는 개발자센터 문서 기준이며 바뀌면 여기만 고친다.
const MAX_GROUPS=5,MAX_KEYWORDS_PER_GROUP=20,MAX_CATEGORIES=3,MAX_CATEGORY_KEYWORDS=5;
// 일 단위로 수년을 요청해도 묶음 5개 × 3,000점 안팎이다. 1MB면 충분하다.
const MAX_BYTES=1_000_000;
// 데이터랩 검색어 트렌드는 2016-01-01부터, 쇼핑인사이트는 2017-08-01부터 자료가 있다.
const SEARCH_FROM='2016-01-01',SHOPPING_FROM='2017-08-01';

function dateWindow(input:{startDate:string;endDate:string;timeUnit:DatalabTimeUnit},earliest:string){
 const startDate=isoDay(input.startDate,'시작일'),endDate=isoDay(input.endDate,'종료일');
 if(startDate>endDate)inputError('시작일이 종료일보다 늦습니다.');
 if(startDate<earliest)inputError(`데이터랩 자료는 ${earliest}부터 있습니다.`);
 if(!['date','week','month'].includes(input.timeUnit))inputError('구간 단위는 date·week·month 중 하나입니다.');
 return {startDate,endDate,timeUnit:input.timeUnit};
}

// 주 단위 창 고정(평가 1회차 M2): 매일 '어제까지 N주'를 하루씩 밀어 요청하면 주 구간 시작일이 매일 바뀌어 같은 주가 다른 기간 키·다른 정규화로 쌓인다.
// 그래서 주 단위 검색어 트렌드 요청은 끝을 종료일 이전 마지막 일요일(그 주가 끝난 날)로, 시작을 그보다 (주 수×7−1)일 앞의 월요일로 맞춘다(길이 고정).
// 날짜는 수집 계획이 넘긴 한국 날짜(KST) 문자열 그대로 계산한다. 같은 주 안에서 며칠에 걸쳐 수집해도 요청 창·기간 키가 같다.
const DAY_MS=86400_000;
const dayOf=(t:number)=>new Date(t).toISOString().slice(0,10);
export function anchorWeekWindow(w:{startDate:string;endDate:string},earliest=SEARCH_FROM):{startDate:string;endDate:string;weeks:number;moved:boolean}{
 const s=Date.parse(`${w.startDate}T00:00:00Z`),e=Date.parse(`${w.endDate}T00:00:00Z`);
 const days=Math.round((e-s)/DAY_MS)+1,weeks=Math.max(1,Math.floor(days/7));
 const dow=(new Date(e).getUTCDay()+6)%7; // 월=0 … 일=6
 let end=e-((dow+1)%7)*DAY_MS,start=end-(weeks*7-1)*DAY_MS;
 const floor=Date.parse(`${earliest}T00:00:00Z`);
 while(start<floor)start+=7*DAY_MS;
 if(start>end){end=start+6*DAY_MS}
 const out={startDate:dayOf(start),endDate:dayOf(end)};
 return {...out,weeks:Math.round((end-start+DAY_MS)/(7*DAY_MS)),moved:out.startDate!==w.startDate||out.endDate!==w.endDate};
}

// 한 점이 가리키는 기간: 일=그날, 주=시작일부터 6일 뒤, 월=그 달 말일. 요청 종료일을 넘지 않게 자른다.
function periodOf(start:string,timeUnit:DatalabTimeUnit,endDate:string){
 const t=Date.parse(`${start}T00:00:00Z`);
 let to=start;
 if(timeUnit==='week')to=new Date(t+6*86400_000).toISOString().slice(0,10);
 else if(timeUnit==='month'){const d=new Date(t);to=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,0)).toISOString().slice(0,10)}
 return {from:start,to:to>endDate?endDate:to};
}

// 결과 묶음 → 관측. 비율이 없는(검색량이 적어 빠진) 구간은 0으로 채우지 않고 묶음을 partial로 표시한다.
function observe(results:unknown,expected:{name:string;scope?:string}[],metric:'search_trend'|'shopping_click_trend',timeUnit:DatalabTimeUnit,endDate:string){
 const observations:Observation[]=[];
 const counts=new Map<string,number>();
 let invalid=0;
 for(const item of list(results)){
  const row=record(item);
  const title=text(row.title,100);
  const target=expected.find(e=>e.name===title);
  if(!title||!target)continue;
  let n=0;
  for(const point of list(row.data)){
   const p=record(point);
   const period=typeof p.period==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(p.period)?p.period:null;
   if(!period){invalid++;continue}
   const ratio=nonNegative(p.ratio);
   const value=ratio!==null&&ratio<=100?ratio:null;
   if(value===null)invalid++;
   observations.push({subject:{type:'keyword',text:title},metric,value,period:periodOf(period,timeUnit,endDate),...(target.scope?{scope:target.scope}:{})});
   n++;
  }
  counts.set(title,n);
 }
 const most=Math.max(0,...counts.values());
 const missing=expected.filter(e=>!counts.has(e.name)).map(e=>e.name);
 const short=expected.filter(e=>counts.has(e.name)&&(counts.get(e.name)??0)<most).map(e=>e.name);
 const limitations=['데이터랩 값은 요청 기간·묶음 안에서 최댓값을 100으로 둔 상대값입니다. 다른 요청끼리 크기를 직접 비교할 수 없고, 절대 검색량은 검색광고 값으로 보정해야 합니다.'];
 if(missing.length)limitations.push(`응답에 없는 묶음: ${missing.join(', ')}. 검색량이 기준보다 적으면 데이터랩이 값을 주지 않습니다(미확인).`);
 if(short.length)limitations.push(`일부 구간이 빠진 묶음: ${short.join(', ')}. 빠진 구간은 0이 아니라 미확인입니다.`);
 if(invalid)limitations.push(`형식이 맞지 않는 점 ${invalid}개는 미확인으로 두거나 건너뛰었습니다.`);
 return {observations,limitations,partial:Boolean(missing.length||short.length||invalid)};
}

async function post(sourceId:SourceId,path:string,operation:QuotaOperation,credential:NaverDevelopersCredential,body:unknown,deps:CollectDeps,label:string){
 return {res:await fetchSourceJson(sourceId,DATALAB_BASE+path,{method:'POST',headers:{
  'X-Naver-Client-Id':credential.clientId,'X-Naver-Client-Secret':credential.clientSecret,'Content-Type':'application/json',
 },body:JSON.stringify(body)},deps,{label,maxBytes:MAX_BYTES}),units:unitsFor(sourceId,operation)};
}

function names(values:string[],label:string){
 if(new Set(values).size!==values.length)inputError(`${label} 이름이 겹칩니다. 묶음마다 다른 이름을 쓰세요.`);
}

export async function collectDatalabSearch(credential:NaverDevelopersCredential,input:DatalabSearchInput,deps:CollectDeps):Promise<CollectResult>{
 const given=dateWindow(input,SEARCH_FROM);
 const anchored=given.timeUnit==='week'?anchorWeekWindow(given):null;
 const w=anchored?{startDate:anchored.startDate,endDate:anchored.endDate,timeUnit:given.timeUnit}:given;
 const groups=Array.isArray(input.keywordGroups)?input.keywordGroups:[];
 if(!groups.length||groups.length>MAX_GROUPS)inputError(`주제어 묶음은 1~${MAX_GROUPS}개입니다.`);
 const keywordGroups=groups.map(g=>{
  const keywords=[...new Set((Array.isArray(g.keywords)?g.keywords:[]).map(k=>keywordInput(k,'키워드',50)))];
  if(!keywords.length||keywords.length>MAX_KEYWORDS_PER_GROUP)inputError(`묶음마다 키워드는 1~${MAX_KEYWORDS_PER_GROUP}개입니다.`);
  return {groupName:keywordInput(g.groupName,'묶음 이름',50),keywords};
 });
 names(keywordGroups.map(g=>g.groupName),'묶음');
 const {res,units}=await post('naver_datalab_search','/v1/datalab/search','datalab_search',credential,{...w,keywordGroups},deps,'네이버 데이터랩 검색어 트렌드');
 const out=observe(record(res.json).results,keywordGroups.map(g=>({name:g.groupName})),'search_trend',w.timeUnit,w.endDate);
 return {
  draft:{
   sourceId:'naver_datalab_search',method:'api',
   request:{...w,keywordGroups:keywordGroups.map(g=>`${g.groupName}:${g.keywords.join('|')}`).join(';')},
   fetchedAt:res.fetchedAt,bodyDigest:res.bodyDigest,bodyBytes:res.bodyBytes,
   status:out.partial?'partial':'ok',limitations:[...out.limitations,...(anchored?.moved?[`주 단위 요청은 월요일 시작·일요일 끝 온전한 ${anchored.weeks}주로 맞췄습니다(요청 ${given.startDate}~${given.endDate} → ${w.startDate}~${w.endDate}).`]:[])],observations:out.observations,
  },
  unitsUsed:units,
 };
}

// 쇼핑 분야 코드는 숫자 8자리 안팎이다(예: 50000006 식품). 코드는 쇼핑인사이트 화면 주소에서 확인한다.
function categoryCode(value:unknown){
 if(typeof value!=='string'||!/^\d{4,12}$/.test(value.trim()))inputError('쇼핑 분야 코드는 숫자입니다(예: 50000006).');
 return value.trim();
}

export async function collectDatalabShoppingCategories(credential:NaverDevelopersCredential,input:DatalabCategoryInput,deps:CollectDeps):Promise<CollectResult>{
 const w=dateWindow(input,SHOPPING_FROM);
 const given=Array.isArray(input.categories)?input.categories:[];
 if(!given.length||given.length>MAX_CATEGORIES)inputError(`쇼핑 분야는 1~${MAX_CATEGORIES}개입니다.`);
 const categories=given.map(c=>({name:keywordInput(c.name,'분야 이름',50),code:categoryCode(c.code)}));
 names(categories.map(c=>c.name),'분야');
 const {res,units}=await post('naver_datalab_shopping','/v1/datalab/shopping/categories','datalab_shopping_categories',credential,{...w,category:categories.map(c=>({name:c.name,param:[c.code]}))},deps,'네이버 데이터랩 쇼핑인사이트');
 const out=observe(record(res.json).results,categories.map(c=>({name:c.name,scope:`category:${c.code}`})),'shopping_click_trend',w.timeUnit,w.endDate);
 return {
  draft:{
   sourceId:'naver_datalab_shopping',method:'api',
   request:{...w,endpoint:'categories',categories:categories.map(c=>`${c.name}:${c.code}`).join(';')},
   fetchedAt:res.fetchedAt,bodyDigest:res.bodyDigest,bodyBytes:res.bodyBytes,
   status:out.partial?'partial':'ok',limitations:[...out.limitations,'쇼핑인사이트는 네이버쇼핑 클릭 기준이며 실제 판매량이 아닙니다.'],observations:out.observations,
  },
  unitsUsed:units,
 };
}

export async function collectDatalabShoppingKeywords(credential:NaverDevelopersCredential,input:DatalabCategoryKeywordInput,deps:CollectDeps):Promise<CollectResult>{
 const w=dateWindow(input,SHOPPING_FROM);
 const code=categoryCode(input.categoryCode);
 const given=Array.isArray(input.keywords)?input.keywords:[];
 if(!given.length||given.length>MAX_CATEGORY_KEYWORDS)inputError(`분야 안 키워드는 1~${MAX_CATEGORY_KEYWORDS}개입니다.`);
 const keywords=given.map(k=>({name:keywordInput(k.name,'키워드 이름',50),keyword:keywordInput(k.keyword,'키워드',50)}));
 names(keywords.map(k=>k.name),'키워드');
 const {res,units}=await post('naver_datalab_shopping','/v1/datalab/shopping/category/keywords','datalab_shopping_keywords',credential,{...w,category:code,keyword:keywords.map(k=>({name:k.name,param:[k.keyword]}))},deps,'네이버 데이터랩 쇼핑인사이트');
 const out=observe(record(res.json).results,keywords.map(k=>({name:k.name,scope:`category:${code}`})),'shopping_click_trend',w.timeUnit,w.endDate);
 return {
  draft:{
   sourceId:'naver_datalab_shopping',method:'api',
   request:{...w,endpoint:'category_keywords',categoryCode:code,keywords:keywords.map(k=>`${k.name}:${k.keyword}`).join(';')},
   fetchedAt:res.fetchedAt,bodyDigest:res.bodyDigest,bodyBytes:res.bodyBytes,
   status:out.partial?'partial':'ok',limitations:[...out.limitations,'쇼핑인사이트는 네이버쇼핑 클릭 기준이며 실제 판매량이 아닙니다.'],observations:out.observations,
  },
  unitsUsed:units,
 };
}
