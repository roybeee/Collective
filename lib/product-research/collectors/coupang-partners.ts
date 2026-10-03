// 쿠팡 파트너스 Open API 수집기: 카테고리 베스트(bestcategories)와 상품 검색(search). 순위·판매가 → 관측.
// 서명: Authorization: CEA algorithm=HmacSHA256, access-key=…, signed-date=yyMMdd'T'HHmmss'Z'(UTC), signature=hex(HMAC-SHA256(secretKey, signedDate+method+path+query)).
// 주의: 파트너스 API는 가입·최종 승인(실적 조건) 뒤에만 열리고, 호출 제한이 낮다(검색은 시간당 횟수 제한이 있다고 안내됨).
//       승인 조건·호출 제한·limit 최댓값은 착수 전 파트너스 공식 문서(발급 화면)로 반드시 다시 확인한다. 아래 상수는 그 확인 전 보수값이다.
// 이 API 범위 밖의 쿠팡 랭킹 화면은 자동 수집하지 않는다(운영자 가져오기만, imports.ts).
import type {CoupangPartnersCredential} from '../credentials';
import type {Observation,Subject} from '../types';
import {CollectorError,fetchSourceJson,inputError,keywordInput,list,nonNegative,record,text} from './http';
import {kstDayKey,unitsFor} from './quota';
import type {CollectDeps,CollectResult} from './index';

export const COUPANG_BASE='https://api-gateway.coupang.com';
const API='/v2/providers/affiliate_open_api/apis/openapi/v1/products';
const LABEL='쿠팡 파트너스';
// 보수값(공식 문서로 재확인): 베스트 limit 최대 100, 검색 limit 최대 10.
const MAX_BEST_LIMIT=100,MAX_SEARCH_LIMIT=10;
const MAX_BYTES=600_000;

// yyMMdd'T'HHmmss'Z' (UTC)
export function coupangSignedDate(now:Date):string{
 const iso=now.toISOString();// YYYY-MM-DDTHH:mm:ss.sssZ
 return `${iso.slice(2,4)}${iso.slice(5,7)}${iso.slice(8,10)}T${iso.slice(11,13)}${iso.slice(14,16)}${iso.slice(17,19)}Z`;
}

// 서명 메시지의 query는 '?' 없이 실제로 보내는 인코딩 그대로다.
export async function signCoupang(secretKey:string,signedDate:string,method:string,path:string,query:string):Promise<string>{
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secretKey),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 const mac=await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(signedDate+method+path+query));
 return [...new Uint8Array(mac)].map(b=>b.toString(16).padStart(2,'0')).join('');
}

async function get(credential:CoupangPartnersCredential,path:string,query:string,deps:CollectDeps){
 const signedDate=coupangSignedDate(deps.now());
 const signature=await signCoupang(credential.secretKey,signedDate,'GET',path,query);
 const res=await fetchSourceJson('coupang_partners',`${COUPANG_BASE}${path}?${query}`,{method:'GET',headers:{
  Authorization:`CEA algorithm=HmacSHA256, access-key=${credential.accessKey}, signed-date=${signedDate}, signature=${signature}`,
  'Content-Type':'application/json;charset=UTF-8',
 }},deps,{label:LABEL,maxBytes:MAX_BYTES});
 const body=record(res.json);
 // 파트너스는 HTTP 200에도 rCode로 실패를 알린다. '0'이 아니면 값을 쓰지 않는다.
 if(String(body.rCode??'')!=='0')throw new CollectorError('http',`${LABEL} 요청이 거절됐습니다 (rCode ${text(String(body.rCode??''),20)??'없음'}). 승인 상태와 요청 값을 확인하세요.`,res.status);
 return {res,body};
}

function limitOf(value:number|undefined,max:number,fallback:number){
 const n=value??fallback;
 if(!Number.isInteger(n)||n<1||n>max)inputError(`가져올 상품 수는 1~${max}개입니다.`);
 return n;
}

// 상품 목록 → 순위·판매가 관측. rank가 없으면 응답 순서(1부터)를 순위로 쓴다.
function observe(rows:unknown[],scope:string,day:string){
 const observations:Observation[]=[];
 const period={from:day,to:day};
 let skipped=0,noPrice=0,positional=0;
 rows.forEach((raw,index)=>{
  const row=record(raw);
  const id=row.productId===undefined||row.productId===null?null:text(String(row.productId),40);
  const title=text(row.productName,300);
  if(!id||!title){skipped++;return}
  const given=nonNegative(row.rank);
  const hasRank=given!==null&&Number.isInteger(given)&&given>=1;
  if(!hasRank)positional++;
  const rank=hasRank?given:index+1;
  const p=nonNegative(row.productPrice);
  const price=p!==null&&p>0?p:null;
  if(price===null)noPrice++;
  let url:string|null=null;
  try{const u=new URL(String(row.productUrl??''));if(u.protocol==='https:')url=u.toString()}catch{url=null}
  const subject:Subject={type:'listing',sourceId:'coupang_partners',externalId:id,title,brand:null,price,url,categoryPath:text(row.categoryName,100)};
  observations.push({subject,metric:'rank',value:rank,period,scope},{subject,metric:'price_min',value:price,period,scope});
 });
 return {observations,skipped,noPrice,positional};
}

function finish(sourceRequest:Record<string,string|number>,res:{fetchedAt:string;bodyDigest:string;bodyBytes:number},out:ReturnType<typeof observe>,total:number,kind:'best'|'search'):CollectResult{
 const limitations=[
  '쿠팡 파트너스 API 결과는 제휴 노출용 목록이며 쿠팡 랭킹 화면과 순서가 다를 수 있습니다.',
  '승인 조건·호출 제한은 파트너스 공식 문서 기준으로 확인이 필요합니다.',
 ];
 if(kind==='search')limitations.push('검색 순위는 파트너스 검색 결과 순서이며 판매 순위가 아닙니다.');
 if(out.positional)limitations.push(`순위 값이 없는 상품 ${out.positional}개는 응답 순서를 순위로 썼습니다.`);
 if(out.noPrice)limitations.push(`판매가가 없는 상품 ${out.noPrice}개는 가격을 미확인으로 두었습니다.`);
 if(out.skipped)limitations.push(`상품 ID나 이름이 없는 응답 행 ${out.skipped}개를 건너뛰었습니다.`);
 if(!total)limitations.push('반환된 상품이 없습니다.');
 return {
  draft:{
   sourceId:'coupang_partners',method:'api',request:sourceRequest,
   fetchedAt:res.fetchedAt,bodyDigest:res.bodyDigest,bodyBytes:res.bodyBytes,
   status:out.skipped||out.noPrice||!total?'partial':'ok',limitations,observations:out.observations,
  },
  unitsUsed:unitsFor('coupang_partners',kind==='best'?'coupang_bestcategories':'coupang_search'),
 };
}

// 카테고리 베스트. categoryId는 파트너스 문서의 숫자 카테고리(예: 1012 식품).
export async function collectCoupangBestCategory(credential:CoupangPartnersCredential,categoryId:string,deps:CollectDeps,limit?:number):Promise<CollectResult>{
 if(typeof categoryId!=='string'||!/^\d{3,8}$/.test(categoryId.trim()))inputError('쿠팡 카테고리 ID는 숫자입니다(예: 1012).');
 const id=categoryId.trim(),n=limitOf(limit,MAX_BEST_LIMIT,50);
 const path=`${API}/bestcategories/${id}`,query=`limit=${n}`;
 const {res,body}=await get(credential,path,query,deps);
 const rows=list(body.data);
 const out=observe(rows,`coupang_best:${id}`,kstDayKey(new Date(res.fetchedAt)));
 return finish({endpoint:'bestcategories',categoryId:id,limit:n},res,out,rows.length,'best');
}

export async function collectCoupangSearch(credential:CoupangPartnersCredential,keyword:string,deps:CollectDeps,limit?:number):Promise<CollectResult>{
 const k=keywordInput(keyword,'검색어',50),n=limitOf(limit,MAX_SEARCH_LIMIT,MAX_SEARCH_LIMIT);
 const path=`${API}/search`,query=`keyword=${encodeURIComponent(k)}&limit=${n}`;
 const {res,body}=await get(credential,path,query,deps);
 const rows=list(record(body.data).productData);
 const out=observe(rows,`search:${k}`,kstDayKey(new Date(res.fetchedAt)));
 return finish({endpoint:'search',keyword:k,limit:n},res,out,rows.length,'search');
}
