// 트랙 R R7a 공공 벤치마크(토큰 0) 순수 모듈: 적재 입력 검사, 공공데이터 키 형식, 공정위 응답 스키마 검사·정규화(단위·0 변환·개인 필드 미적재), 선별(30개 상한), 파생 지표.
// 외부 응답은 시스템 경계라 여기서 형식을 검사하고 정해 둔 필드만 옮긴다(허용 목록). 대표자명·사업자등록번호·법인등록번호·가맹본부명은 옮기지 않는다.
// LLM·모델 호출이 없다(결정론). 벤치마크 값은 타 브랜드 공개 수치이고 자사 예상매출 근거가 아니다(원칙 7). 판정·표시는 COLLECTIVE 휴리스틱 · 법률 자문 아님.
// 필드 이름·단위(천원)·기준년도 해석은 2차 자료([D6])로만 봤다. 대표의 real 적재 1회로 확인하고, 다르면 BENCHMARK_FIELDS만 고친다.
import {scanText} from './pii-scan';

export const BENCHMARK_VERSION='fr-benchmark@2026-09-27.1';
export const BENCHMARK_NOTICE='타 브랜드 공개 수치. 자사 예상매출 근거가 아님';
// brands: 한 번에 적재하는 브랜드 상한. pageSize·maxPages·deadlineMs: 한 번 적재의 쪽 크기·쪽 상한·전체 마감(잠금 120초 안). staleMs: 이 시간 넘게 '적재 중'이면 중단으로 본다.
export const BENCHMARK_LIMITS={brands:30,nameMax:60,industryMax:40,minYear:2000,pageSize:400,maxPages:30,deadlineMs:100000,staleMs:300000,history:20,minRateDenominator:20} as const;
export const BENCHMARK_DATASET={key:'ftc_brand_frcs_stats',label:'공정위 가맹정보 브랜드별 가맹점 현황(공공데이터포털)',source:'https://www.data.go.kr/data/15125467/openapi.do',
 unitNote:'금액은 API 원값(천원, 확인 필요)과 원 단위 변환값을 함께 저장합니다. 금액 0은 미기재로 보고 비워 둡니다. 건수 0은 그대로 둡니다.',
 yearNote:'기준년도 N의 수치는 N−1년 실적으로 봅니다(확인 필요, 2차 자료).'} as const;
// 공정위 응답 필드 이름(허용 목록). 앞 이름부터 찾는다. 이 밖의 필드는 저장하지 않는다.
export const BENCHMARK_FIELDS={year:['yr','jngBizCrtraYr','crtrYr'],brandName:['brandNm','brndNm'],industryLarge:['indutyLclasNm'],industryMiddle:['indutyMlsfcNm'],
 stores:['frcsCnt'],newStores:['newFrcsRgsCnt'],contractEnded:['ctrtEndCnt'],contractTerminated:['ctrtCncltnCnt'],ownerChanged:['nmChgCnt'],avgSales:['avrgSlsAmt'],avgSalesPerArea:['arUnitAvrgSlsAmt']} as const;
export const BENCHMARK_STATUS_LABELS={running:'적재 중',success:'성공',failed:'실패',blocked:'막힘',timeout:'시간 초과'} as const;
export type BenchmarkStatus=keyof typeof BENCHMARK_STATUS_LABELS;
export const BENCHMARK_FAILURE_MESSAGES:Readonly<Record<string,string>>={
 SERVICE_NOT_REGISTERED:'공공데이터포털에서 이 API 활용 신청이 승인되지 않았거나 키가 등록되지 않았습니다(SERVICE_NOT_REGISTERED). 포털의 활용 신청 상태와 키를 확인하세요.',
 SERVICE_KEY_EXPIRED:'공공데이터 키의 활용 기간이 끝났습니다. 포털에서 연장한 뒤 다시 적재하세요.',
 QUOTA_EXCEEDED:'공공데이터포털 일일 호출 한도를 넘었습니다. 내일 다시 적재하세요.',
 RATE_LIMITED:'공공데이터포털이 잠시 호출을 제한했습니다. 잠시 후 다시 적재하세요.',
 TOO_LARGE:'응답이 허용 크기(200KB)를 넘어 읽지 않았습니다.',
 NOT_JSON:'응답이 JSON이 아니어서 읽지 않았습니다.',
 API_ERROR:'공공데이터포털이 오류 코드를 돌려줬습니다.',
 REQUEST_REJECTED:'공공데이터포털이 요청을 거절했습니다.',
 UPSTREAM_5XX:'공공데이터포털 서버 오류가 재시도 뒤에도 계속됐습니다.',
 NETWORK:'공공데이터포털에 연결하지 못했습니다(재시도 뒤).',
 TIMEOUT:'호출이 20초 안에 끝나지 않았습니다(재시도 뒤).',
 DEADLINE:'적재 전체 제한 시간 안에 끝나지 않아 저장하지 않았습니다.',
 SCHEMA_MISMATCH:'응답 형식이 예상과 달라 저장하지 않았습니다(필드 이름 확인 필요).',
 INTERRUPTED:'적재가 끝나지 않고 멈췄습니다. 다시 적재하세요.',
 INTERNAL:'적재를 마치지 못했습니다. 다시 적재하세요.',
};
export const BENCHMARK_INPUT_MESSAGES={
 scope_missing:'비교할 브랜드 이름이나 업종 검색어를 하나 이상 입력하세요.',
 too_many_brands:`브랜드는 한 번에 ${BENCHMARK_LIMITS.brands}개까지 적재합니다.`,
 year_invalid:'기준년도는 2000년부터 올해까지의 네 자리 연도입니다.',
 personal_data:'브랜드 이름·업종 검색어에 전화번호·이메일 같은 개인정보를 넣지 않습니다.',
 name_invalid:`브랜드 이름은 ${BENCHMARK_LIMITS.nameMax}자, 업종 검색어는 ${BENCHMARK_LIMITS.industryMax}자까지 입력하세요.`,
} as const;
export type BenchmarkInputCode=keyof typeof BENCHMARK_INPUT_MESSAGES;
export const BENCHMARK_FORMULAS={netChange:'순증감 = 신규 개점 − (계약 종료 + 계약 해지)',closureRate:'폐점률 = (계약 종료 + 계약 해지) ÷ 연말 가맹점 수'} as const;
export const benchmarkRef=(id:string)=>'franchise_benchmark:'+id;

type Json=Record<string,unknown>;
const isRecord=(v:unknown):v is Json=>!!v&&typeof v==='object'&&!Array.isArray(v);
const fold=(s:string)=>s.normalize('NFKC').replace(/\s+/g,'').toLowerCase();

// ── 적재 입력 ──
export type BenchmarkLoadInput={year:number;brands:string[];industry:string|null};
type Checked<T>={ok:true;value:T}|{ok:false;code:BenchmarkInputCode};
const bad=(code:BenchmarkInputCode):{ok:false;code:BenchmarkInputCode}=>({ok:false,code});
function readName(v:unknown,max:number):string|BenchmarkInputCode{
 if(typeof v!=='string')return 'name_invalid';
 const s=v.normalize('NFKC').trim();
 if(s.length>max)return 'name_invalid';
 if(s&&scanText(s).length)return 'personal_data';
 return s;
}
export function readLoadInput(input:Json,nowYear:number):Checked<BenchmarkLoadInput>{
 const year=input.year;
 if(typeof year!=='number'||!Number.isInteger(year)||year<BENCHMARK_LIMITS.minYear||year>nowYear)return bad('year_invalid');
 const rawBrands=input.brands??[];
 if(!Array.isArray(rawBrands)||rawBrands.length>BENCHMARK_LIMITS.brands*2)return bad('name_invalid');
 const brands:string[]=[],seen=new Set<string>();
 for(const raw of rawBrands){
  const name=readName(raw,BENCHMARK_LIMITS.nameMax);
  if(name==='name_invalid'||name==='personal_data')return bad(name);
  if(name&&!seen.has(fold(name))){seen.add(fold(name));brands.push(name)}
 }
 if(brands.length>BENCHMARK_LIMITS.brands)return bad('too_many_brands');
 const industryRaw=input.industry===undefined||input.industry===null?'':input.industry;
 const industry=readName(industryRaw,BENCHMARK_LIMITS.industryMax);
 if(industry==='name_invalid'||industry==='personal_data')return bad(industry);
 if(!brands.length&&!industry)return bad('scope_missing');
 return {ok:true,value:{year,brands,industry:industry||null}};
}

// ── 공공데이터 키 ──
// 포털의 일반 인증키(Decoding)를 받는다. 인코딩된 키(%2B 등)를 붙여 넣으면 한 번 풀어 저장한다. 공백·그 밖의 문자가 있으면 거부한다.
export function readServiceKey(raw:unknown):string|null{
 if(typeof raw!=='string')return null;
 let key=raw.trim();
 if(/%[0-9A-Fa-f]{2}/.test(key)){try{key=decodeURIComponent(key)}catch{return null}}
 return /^[A-Za-z0-9+/=_-]{16,400}$/.test(key)?key:null;
}

// ── 응답 스키마 ──
export type FtcEnvelope={items:unknown[];totalCount:number|null;pageNo:number|null;numOfRows:number|null};
const count=(v:unknown):number|null=>{
 const n=typeof v==='number'?v:typeof v==='string'&&/^\s*\d[\d,]*\s*$/.test(v)?Number(v.replace(/[,\s]/g,'')):NaN;
 return Number.isSafeInteger(n)&&n>=0?n:null;
};
function itemsOf(v:unknown):unknown[]|null{
 if(v===''||v===null||v===undefined)return [];
 if(Array.isArray(v))return v;
 if(isRecord(v)&&'item' in v){const it=v.item;return Array.isArray(it)?it:isRecord(it)?[it]:it===''||it===null||it===undefined?[]:null}
 return null;
}
// 두 봉투를 받는다: 평평한 {resultCode,…,items} 와 {response:{header,body:{items:{item}}}}. 결과 코드 오류는 커넥터가 먼저 분류했다.
export function parseEnvelope(json:unknown):{ok:true;value:FtcEnvelope}|{ok:false;code:'schema_mismatch'}{
 const body=isRecord(json)&&isRecord(json.response)?json.response.body:isRecord(json)&&'items' in json?json:null;
 if(!isRecord(body))return {ok:false,code:'schema_mismatch'};
 const items=itemsOf(body.items);
 if(!items)return {ok:false,code:'schema_mismatch'};
 return {ok:true,value:{items,totalCount:count(body.totalCount),pageNo:count(body.pageNo),numOfRows:count(body.numOfRows)}};
}
type Money={rawThousandKrw:number|null;krw:number|null};
export type BenchmarkRow={brandName:string;industryLarge:string|null;industryMiddle:string|null;apiYear:string|null;stores:number|null;newStores:number|null;contractEnded:number|null;contractTerminated:number|null;ownerChanged:number|null;avgSales:Money;avgSalesPerArea:Money};
type FieldKey=keyof typeof BENCHMARK_FIELDS;
const pick=(item:Json,key:FieldKey)=>{for(const name of BENCHMARK_FIELDS[key])if(item[name]!==undefined&&item[name]!==null)return item[name];return undefined};
const label=(v:unknown,max=100)=>typeof v==='string'&&v.trim()&&v.trim().length<=max?v.normalize('NFKC').trim():typeof v==='number'&&Number.isFinite(v)?String(v):null;
// 금액: 천원 원값과 원 단위 값. 0은 미기재로 보고 null이다(공정위 공개 자료의 0은 값 없음과 구분되지 않는다).
const money=(v:unknown):Money=>{const n=count(v);return n?{rawThousandKrw:n,krw:n*1000}:{rawThousandKrw:null,krw:null}};
export function normalizeItem(item:unknown):BenchmarkRow|null{
 if(!isRecord(item))return null;
 const brandName=label(pick(item,'brandName'));
 if(!brandName||typeof pick(item,'brandName')!=='string')return null;
 return {brandName,industryLarge:label(pick(item,'industryLarge'),60),industryMiddle:label(pick(item,'industryMiddle'),60),apiYear:label(pick(item,'year'),10),
  stores:count(pick(item,'stores')),newStores:count(pick(item,'newStores')),contractEnded:count(pick(item,'contractEnded')),contractTerminated:count(pick(item,'contractTerminated')),ownerChanged:count(pick(item,'ownerChanged')),
  avgSales:money(pick(item,'avgSales')),avgSalesPerArea:money(pick(item,'avgSalesPerArea'))};
}

// ── 선별 ──
const industryMatch=(r:BenchmarkRow,industry:string|null)=>!industry||fold(r.industryMiddle??'').includes(fold(industry))||fold(r.industryLarge??'').includes(fold(industry));
// 이 쪽에서 남길 후보(이름 목록이 있으면 이름, 없으면 업종). 쪽마다 걸러 메모리를 줄인다.
export function isCandidate(r:BenchmarkRow,input:BenchmarkLoadInput){
 return industryMatch(r,input.industry)&&(!input.brands.length||input.brands.some(b=>fold(b)===fold(r.brandName)));
}
export type Selection={rows:BenchmarkRow[];missing:string[];truncated:boolean};
export function selectRows(rows:readonly BenchmarkRow[],input:BenchmarkLoadInput):Selection{
 const first=new Map<string,BenchmarkRow>();
 for(const r of rows)if(isCandidate(r,input)&&!first.has(fold(r.brandName)))first.set(fold(r.brandName),r);
 if(input.brands.length){
  const picked=input.brands.map(b=>first.get(fold(b))).filter((r):r is BenchmarkRow=>!!r);
  return {rows:picked,missing:input.brands.filter(b=>!first.has(fold(b))),truncated:false};
 }
 const sorted=[...first.values()].sort((a,b)=>(b.stores??-1)-(a.stores??-1)||(a.brandName<b.brandName?-1:a.brandName>b.brandName?1:0));
 return {rows:sorted.slice(0,BENCHMARK_LIMITS.brands),missing:[],truncated:sorted.length>BENCHMARK_LIMITS.brands};
}
// 이름 목록의 브랜드를 모두 찾았으면 남은 쪽을 읽지 않는다. 업종만 주면 끝까지(쪽 상한까지) 읽는다.
export function selectionComplete(rows:readonly BenchmarkRow[],input:BenchmarkLoadInput){
 return input.brands.length>0&&selectRows(rows,input).missing.length===0;
}

// ── 파생 지표(읽을 때 계산, 공식과 분모를 함께) ──
export type Derived={netChange:{value:number|null;formula:string;note:string};closureRate:{value:number|null;numerator:number|null;denominator:number|null;hidden:boolean;formula:string;note:string}};
export function derivedMetrics(r:BenchmarkRow):Derived{
 const closures=r.contractEnded!==null&&r.contractTerminated!==null?r.contractEnded+r.contractTerminated:null;
 const net=r.newStores!==null&&closures!==null?r.newStores-closures:null;
 const d=r.stores,hidden=d!==null&&d<BENCHMARK_LIMITS.minRateDenominator;
 const value=closures!==null&&d!==null&&d>0&&!hidden?closures/d:null;
 const note=hidden?`표본 부족: 분모(연말 가맹점 수)가 ${d}개로 ${BENCHMARK_LIMITS.minRateDenominator}개 미만이라 비율을 숨깁니다.`:d===null||closures===null?'값이 비어 계산하지 않았습니다.':'분모는 공정위가 공개한 연말 가맹점 수입니다(확인 필요).';
 return {netChange:{value:net,formula:BENCHMARK_FORMULAS.netChange,note:'명의 변경은 폐점으로 세지 않습니다.'},closureRate:{value,numerator:closures,denominator:d,hidden,formula:BENCHMARK_FORMULAS.closureRate,note}};
}
