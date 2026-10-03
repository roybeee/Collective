// 쿼터 계산(순수 모듈). 원장 저장은 서버(pr_quota)가 하고, 여기서는 단위·허용 여부·날짜 키만 정한다.
// 원칙: 쿼터 초과 0(계획 ⑪). 하루 한도를 모르는 출처(null)도 앱 상한(APP_DAILY_CAPS)으로 막고, 공급자의 429는 일시 오류로 다시 시도한다(server-collect.ts).
import {sourceSpec} from '../sources';
import type {SourceId} from '../types';

export type QuotaOperation='keywordstool'|'datalab_search'|'datalab_shopping_categories'|'datalab_shopping_keywords'|'shop_search'|'youtube_search'|'youtube_videos'|'coupang_bestcategories'|'coupang_search'|'licensed_fetch';

// 공급자 기준 단위. YouTube는 search.list 100, videos.list 1(공식 쿼터 표). 데이터랩은 호출 1회가 1회로 집계된다.
// 나머지 공식 API는 호출 1회=1. 자동 수집이 없는 manual·internal 출처는 0이다(쿼터를 쓰지 않는다).
export function unitsFor(sourceId:SourceId,operation:QuotaOperation):number{
 const spec=sourceSpec(sourceId);
 if(spec.method==='manual'||spec.method==='internal')return 0;
 if(sourceId==='youtube_data'){
  if(operation==='youtube_search')return 100;
  if(operation==='youtube_videos')return 1;
  // 모르는 YouTube 작업을 1로 세면 쿼터를 적게 잡아 초과할 수 있어 던진다.
  throw new Error(`YouTube 쿼터 단위를 모르는 작업입니다: ${operation}`);
 }
 return 1;
}

// 이 앱이 지키는 출처별 하루 상한(공급자 단위, 원장 pr_quota가 원자적으로 막는다). 평가 1회차 H4: 공급자가 한도를 공개하지 않은 출처도
// 보수적인 상한을 둔다(쿼터 초과 0). 공개 한도가 있으면 여유분을 남긴다. 데이터랩 쇼핑인사이트는 평가 3회차 ①부터 계획에 들어갔다(하루 계획 4회, 즉시 수집 포함해도 상한 50 안).
// docs/PRODUCT-RESEARCH.ko.md 3절 표가 이 값을 그대로 적는다.
export const APP_DAILY_CAPS:Readonly<Partial<Record<SourceId,number>>>={
 naver_searchad_keyword:200,  // 호출 수(공급자 미공개)
 naver_datalab_search:900,    // 호출 수(공급자 1,000)
 naver_datalab_shopping:50,   // 호출 수(공급자 1,000, 계획 하루 4회)
 naver_shop_search:2000,      // 호출 수(공급자 25,000)
 youtube_data:9000,           // 단위(공급자 10,000, 태평양 날짜)
 coupang_partners:100,        // 호출 수(공급자 승인 조건, 미공개)
};
// 원장이 쓰는 하루 상한. 자동 수집 출처가 아니거나 상한이 정해지지 않은 출처는 0(호출하지 않음)이다. 공급자 한도가 더 낮으면 그것을 쓴다.
export function dailyCap(sourceId:SourceId):number{
 const spec=sourceSpec(sourceId);
 if(!spec.autoFetch||spec.method==='manual'||spec.method==='internal')return 0;
 const app=APP_DAILY_CAPS[sourceId]??0;
 return spec.dailyQuota===null?app:Math.min(app,spec.dailyQuota);
}

// 오늘 쓴 단위(used)에 units를 더해도 하루 한도 안인지. 한도를 모르면(null) 막지 않는다.
export function canSpend(used:number,units:number,dailyQuota:number|null):boolean{
 if(!Number.isFinite(used)||used<0||!Number.isFinite(units)||units<0)return false;
 if(dailyQuota===null)return true;
 if(!Number.isFinite(dailyQuota)||dailyQuota<0)return false;
 return used+units<=dailyQuota;
}

// 한국 시각(UTC+9, 일광 절약 없음) 날짜 키 YYYY-MM-DD. 네이버 쿼터는 한국 자정에 초기화된다.
export function kstDayKey(now:Date):string{
 return new Date(now.getTime()+9*3600_000).toISOString().slice(0,10);
}

// 한국 날짜 기준 그 주 월요일(YYYY-MM-DD). 주간 MD 리포트·랭킹 '이번 주 가져오기' 판정에 쓴다.
export function kstWeekKey(now:Date):string{
 const day=kstDayKey(now),t=Date.parse(`${day}T00:00:00Z`),dow=(new Date(t).getUTCDay()+6)%7;
 return new Date(t-dow*86400000).toISOString().slice(0,10);
}

// 출처별 쿼터 날짜 키. YouTube Data API 쿼터는 태평양 시각 자정에 초기화되므로(공식 문서) 한국 날짜로 묶으면
// 한 한국 날짜 안에 태평양 날짜 둘이 걸쳐 실제 하루 한도를 넘길 수 있다. 그래서 YouTube만 태평양 날짜로 센다.
export function quotaDayKey(sourceId:SourceId,now:Date):string{
 if(sourceId!=='youtube_data')return kstDayKey(now);
 const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Los_Angeles',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now);
 const pick=(type:string)=>parts.find(p=>p.type===type)?.value??'';
 return `${pick('year')}-${pick('month')}-${pick('day')}`;
}
