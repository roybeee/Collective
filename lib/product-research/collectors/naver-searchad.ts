// 네이버 검색광고 키워드 도구 수집기(GET /keywordstool). 월간 검색수(PC·모바일)·경쟁 지수 → 관측.
// 서명은 lib/connectors/naver-ads.ts와 같다: base64(HMAC-SHA256(secretKey, `${timestamp}.${method}.${path}`)), 경로에 쿼리는 넣지 않는다.
// 호스트는 고정 상수다. 사용자 입력은 힌트 키워드뿐이고, 인코딩해서 쿼리에만 들어간다.
import type {NaverSearchadCredential} from '../credentials';
import type {Observation} from '../types';
import {fetchSourceJson,hasControl,inputError,list,record,text} from './http';
import {kstDayKey,unitsFor} from './quota';
import type {CollectDeps,CollectResult} from './index';

export const SEARCHAD_BASE='https://api.searchad.naver.com';
const PATH='/keywordstool';
// 공식 키워드 도구는 hintKeywords를 한 번에 5개까지 받는다.
export const MAX_HINT_KEYWORDS=5;
// 연관 키워드는 최대 1,000개 안팎이다. 행당 300B 남짓이라 2MB면 넉넉하고, 그 이상은 이상 응답으로 본다.
const MAX_BYTES=2_000_000;
const LABEL='네이버 검색광고 키워드 도구';

export async function signSearchad(secretKey:string,timestamp:string,method:string,path:string):Promise<string>{
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secretKey),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 const mac=await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(`${timestamp}.${method}.${path}`));
 return btoa(String.fromCharCode(...new Uint8Array(mac)));
}

// 월간 검색수. 검색량이 아주 적으면 숫자 대신 "< 10" 문자열이 온다. 이것은 0이 아니라 '10 미만(정확한 값 모름)'이므로 null로 둔다.
export function parseQcCnt(value:unknown):number|null{
 if(typeof value==='number')return Number.isFinite(value)&&value>=0?value:null;
 if(typeof value==='string'&&/^\d[\d,]*$/.test(value.trim())){const n=Number(value.trim().replace(/,/g,''));return Number.isFinite(n)?n:null}
 return null;
}

// 경쟁 지수: 낮음 0 · 중간 0.5 · 높음 1. 다른 값(빈 값·영문 등)은 미확인이다.
export function compIdxValue(value:unknown):number|null{
 const v=typeof value==='string'?value.trim():'';
 return v==='낮음'?0:v==='중간'?0.5:v==='높음'?1:null;
}

// 키워드 도구는 공백이 있는 힌트를 거절한다. 네이버 검색량도 띄어쓰기를 무시하고 합산하므로 공백을 지운 형태로 보낸다.
function hintList(keywords:readonly string[]):string[]{
 const out:string[]=[];
 for(const raw of keywords){
  if(typeof raw!=='string')inputError('힌트 키워드는 글자로 입력하세요.');
  const k=raw.replace(/\s+/g,'');
  if(!k)continue;
  if(k.length>40)inputError('힌트 키워드는 40자 이내로 입력하세요.');
  if(k.includes(',')||hasControl(k))inputError('힌트 키워드에 쉼표나 제어 문자를 넣을 수 없습니다.');
  if(!out.some(o=>o.toLowerCase()===k.toLowerCase()))out.push(k);
 }
 if(!out.length)inputError('힌트 키워드를 1개 이상 입력하세요.');
 if(out.length>MAX_HINT_KEYWORDS)inputError(`힌트 키워드는 한 번에 ${MAX_HINT_KEYWORDS}개까지입니다.`);
 return out;
}

export async function collectSearchadKeywords(credential:NaverSearchadCredential,hintKeywords:readonly string[],deps:CollectDeps):Promise<CollectResult>{
 const hints=hintList(hintKeywords);
 const now=deps.now();
 const timestamp=String(now.getTime());
 const signature=await signSearchad(credential.secretKey,timestamp,'GET',PATH);
 const query=`?hintKeywords=${encodeURIComponent(hints.join(','))}&showDetail=1`;
 const res=await fetchSourceJson('naver_searchad_keyword',SEARCHAD_BASE+PATH+query,{method:'GET',headers:{
  'X-Timestamp':timestamp,'X-API-KEY':credential.apiKey,'X-Customer':credential.customerId,'X-Signature':signature,'Content-Type':'application/json',
 }},deps,{label:LABEL,maxBytes:MAX_BYTES});

 // 월간 검색수는 최근 30일 집계다. 기준 날짜는 수집 시점 한국 날짜의 전날로 두고 30일을 거슬러 잡는다(근사, limitations에 적음).
 const today=Date.parse(`${kstDayKey(now)}T00:00:00Z`);
 const to=new Date(today-86400_000).toISOString().slice(0,10),from=new Date(today-30*86400_000).toISOString().slice(0,10);
 const period={from,to};
 const rows=list(record(res.json).keywordList);
 const observations:Observation[]=[];
 const seen=new Set<string>();
 let skipped=0,underTen=0,unknownComp=0;
 for(const item of rows){
  const row=record(item);
  const keyword=text(row.relKeyword,100);
  if(!keyword){skipped++;continue}
  const key=keyword.replace(/\s+/g,'').toLowerCase();
  if(seen.has(key))continue;
  seen.add(key);
  const subject={type:'keyword' as const,text:keyword};
  const pc=parseQcCnt(row.monthlyPcQcCnt),mobile=parseQcCnt(row.monthlyMobileQcCnt),comp=compIdxValue(row.compIdx);
  if(pc===null||mobile===null)underTen++;
  if(comp===null)unknownComp++;
  observations.push(
   {subject,metric:'search_volume_pc',value:pc,period},
   {subject,metric:'search_volume_mobile',value:mobile,period},
   // 합계는 둘 다 알 때만 낸다. 한쪽이 "< 10"이면 합계도 미확인이다.
   {subject,metric:'search_volume_month',value:pc!==null&&mobile!==null?pc+mobile:null,period},
   {subject,metric:'ad_competition',value:comp,period},
  );
 }
 const missingHints=hints.filter(h=>!seen.has(h.toLowerCase()));
 const limitations=[
  '검색광고 월간 검색수는 최근 30일 집계이며 통계 반영이 지연됩니다. 기간 경계는 수집일 전날 기준 근사입니다.',
  '경쟁 지수는 광고 입찰 경쟁(낮음·중간·높음)이며 판매 경쟁과 같지 않습니다.',
 ];
 if(underTen)limitations.push(`검색수가 "< 10"으로 표시된 키워드 ${underTen}개는 0이 아니라 미확인(null)으로 두었습니다.`);
 if(unknownComp)limitations.push(`경쟁 지수를 확인하지 못한 키워드 ${unknownComp}개는 미확인으로 두었습니다.`);
 if(skipped)limitations.push(`키워드 이름이 없는 응답 행 ${skipped}개를 건너뛰었습니다.`);
 if(missingHints.length)limitations.push(`힌트 키워드 ${missingHints.join(', ')}의 행이 응답에 없습니다.`);
 if(!seen.size)limitations.push('반환된 키워드가 없습니다.');
 return {
  draft:{
   sourceId:'naver_searchad_keyword',method:'api',
   request:{hintKeywords:hints.join(','),showDetail:true},
   fetchedAt:res.fetchedAt,bodyDigest:res.bodyDigest,bodyBytes:res.bodyBytes,
   status:skipped||missingHints.length||!seen.size?'partial':'ok',
   limitations,observations,
  },
  unitsUsed:unitsFor('naver_searchad_keyword','keywordstool'),
 };
}
