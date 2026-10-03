// 운영자·계약 데이터 가져오기 해석기(순수 모듈, 네트워크 없음). 대상: 쿠팡·무신사·올리브영 랭킹(manual)과 계약 공급사 내보내기 파일(licensed).
// 운영자가 자기 계정으로 본 랭킹 화면을 CSV(UTF-8, BOM·따옴표·CRLF 허용) 또는 JSON 배열로 올리면 형식을 검사해 스냅샷 초안으로 만든다.
// 전부 아니면 전무: 잘못된 행이 하나라도 있으면 파일 전체를 거절하고 행 번호와 사유를 돌려준다(부분 저장 0, 계획 P1b 완료 조건).
// 머리글은 한국어·영어 별칭을 받는다. 알 수 없는 열(리뷰 작성자 등)은 저장하지 않는다. 원문은 해시·크기만 남긴다.
import {sourceSpec} from '../sources';
import type {MetricKey,Observation,Subject} from '../types';
import {hasControl,sha256Hex} from './http';
import {kstDayKey} from './quota';
import type {CollectDeps,SnapshotDraft} from './index';

export type ImportSourceId='coupang_ranking_manual'|'musinsa_ranking_manual'|'oliveyoung_ranking_manual'|'licensed_ranking';
export type ImportInput={sourceId:ImportSourceId;fileName:string;text:string;scope:string;observedDate:string;format?:'csv'|'json'};
// row: CSV는 머리글을 1행으로 센 줄 번호, JSON은 1부터 센 항목 번호. 파일 전체 문제는 null.
export type ImportIssue={row:number|null;field?:string;reason:string};
export type ImportOutcome={ok:true;draft:SnapshotDraft;unitsUsed:0;rows:number}|{ok:false;errors:ImportIssue[]};

export const IMPORT_MAX_BYTES=2*1024*1024;
export const IMPORT_MAX_ROWS=2000;
const MAX_REPORTED=100;
const IMPORT_SOURCES:readonly ImportSourceId[]=['coupang_ranking_manual','musinsa_ranking_manual','oliveyoung_ranking_manual','licensed_ranking'];

type Field='rank'|'title'|'brand'|'price'|'review_count'|'rating'|'category'|'sales_estimate'|'url'|'date'|'product_id';
// 머리글 정규화: 소문자, 공백·밑줄·하이픈·점·괄호 제거. '판매가(원)' → '판매가원'.
const norm=(h:string)=>h.normalize('NFC').toLowerCase().replace(/[\s_\-.()[\]/]/g,'');
const BASE_ALIASES:Record<Field,readonly string[]>={
 rank:['순위','랭킹','등수','rank','ranking','no'],
 title:['상품명','상품','제품명','상품이름','title','product','productname','name','itemname'],
 brand:['브랜드','브랜드명','제조사','brand','brandname','maker'],
 price:['가격','판매가','판매가격','할인가','최저가','가격원','판매가원','price','saleprice','lprice'],
 review_count:['리뷰수','리뷰','리뷰개수','후기수','후기','reviewcount','reviews'],
 rating:['평점','별점','rating','score','stars'],
 category:['카테고리','분류','category','categorypath'],
 sales_estimate:['판매량','예상판매량','추정판매량','월판매량','salesestimate','estimatedsales','sales'],
 url:['링크','주소','상품링크','상품주소','상품url','url','link'],
 date:['기준일','날짜','일자','수집일','date','observeddate'],
 product_id:['상품번호','상품id','상품코드','productid','itemid','id'],
};
// 출처별 추가 별칭(각 사이트 화면·내보내기에서 쓰는 이름).
const EXTRA_ALIASES:Record<ImportSourceId,Partial<Record<Field,readonly string[]>>>={
 coupang_ranking_manual:{product_id:['vendoritemid','쿠팡상품번호'],price:['쿠팡가','로켓가']},
 musinsa_ranking_manual:{product_id:['goodsno','무신사상품번호'],price:['무신사가','회원가']},
 oliveyoung_ranking_manual:{product_id:['goodsno','올리브영상품코드'],price:['올영가','세일가']},
 licensed_ranking:{sales_estimate:['예상월판매량','판매추정','30일판매량'],review_count:['누적리뷰수'],rank:['카테고리순위']},
};
// 열 → 지표. 출처 레지스트리 metrics에 없는 지표 열(예: 운영자 파일의 판매량)은 무시한다.
type NumberField='price'|'review_count'|'rating'|'sales_estimate';
const NUMBER_FIELDS:readonly NumberField[]=['price','review_count','rating','sales_estimate'];
const FIELD_METRIC:Record<NumberField,MetricKey>={price:'price_min',review_count:'review_count',rating:'rating',sales_estimate:'sales_estimate'};
const FIELD_LABEL:Record<NumberField,string>={price:'가격',review_count:'리뷰 수',rating:'평점',sales_estimate:'판매량'};

function aliasMap(sourceId:ImportSourceId){
 const map=new Map<string,Field>();
 for(const [field,names] of Object.entries(BASE_ALIASES) as [Field,readonly string[]][])for(const n of names)map.set(norm(n),field);
 for(const [field,names] of Object.entries(EXTRA_ALIASES[sourceId]) as [Field,readonly string[]][])for(const n of names)map.set(norm(n),field);
 return map;
}

class ParseError extends Error{constructor(public row:number|null,message:string){super(message)}}

// RFC 4180 CSV: 쉼표 구분, 큰따옴표 묶음(""는 따옴표 하나), 묶음 안 줄바꿈 허용, CRLF·LF. 각 행에 시작 줄 번호를 붙인다.
export function parseCsv(input:string):{line:number;cells:string[]}[]{
 const text=input.charCodeAt(0)===0xfeff?input.slice(1):input;
 const rows:{line:number;cells:string[]}[]=[];
 let cells:string[]=[],cell='',quoted=false,afterQuote=false,line=1,start=1,i=0;
 const endCell=()=>{cells.push(cell);cell='';afterQuote=false};
 const endRow=()=>{endCell();rows.push({line:start,cells});cells=[]};
 while(i<text.length){
  const c=text[i];
  if(quoted){
   if(c==='"'){
    if(text[i+1]==='"'){cell+='"';i+=2;continue}
    quoted=false;afterQuote=true;i++;continue;
   }
   if(c==='\n')line++;
   cell+=c;i++;continue;
  }
  if(c===','){endCell();i++;continue}
  if(c==='\r'||c==='\n'){
   endRow();
   i+=c==='\r'&&text[i+1]==='\n'?2:1;
   line++;start=line;continue;
  }
  if(afterQuote)throw new ParseError(start,'닫는 따옴표 뒤에 쉼표 없이 글자가 이어집니다.');
  if(c==='"'&&cell===''){quoted=true;i++;continue}
  cell+=c;i++;
 }
 if(quoted)throw new ParseError(start,'따옴표가 닫히지 않았습니다.');
 if(cell!==''||cells.length||afterQuote)endRow();
 return rows;
}

// 숫자: 쉼표·원·₩·개·건·위·공백·끝의 +를 지운다. '1.2만'은 12000. 빈 값·'-'는 미확인(null). 그 밖은 오류.
function parseNumber(raw:unknown):{value:number|null}|{error:string}{
 if(raw===null||raw===undefined)return {value:null};
 if(typeof raw==='number')return Number.isFinite(raw)?{value:raw}:{error:'숫자가 아닙니다'};
 if(typeof raw!=='string')return {error:'숫자가 아닙니다'};
 let s=raw.trim().replace(/[,\s₩원개건위]/g,'').replace(/(won|krw)$/i,'').replace(/\+$/,'');
 if(s===''||s==='-')return {value:null};
 let scale=1;
 if(s.endsWith('만')){scale=10000;s=s.slice(0,-1)}
 if(!/^\d+(\.\d+)?$/.test(s))return {error:`숫자로 읽을 수 없습니다(${String(raw).slice(0,20)})`};
 const n=Number(s)*scale;
 return Number.isFinite(n)?{value:Math.round(n*100)/100}:{error:'숫자가 너무 큽니다'};
}

function cellText(raw:unknown):string{
 if(raw===null||raw===undefined)return '';
 return typeof raw==='string'?raw.trim():typeof raw==='number'&&Number.isFinite(raw)?String(raw):'';
}

// 날짜: YYYY-MM-DD, YYYY.MM.DD, YYYY/MM/DD → YYYY-MM-DD. 실제 날짜가 아니면 null.
function day(value:string):string|null{
 const m=/^(\d{4})[-./](\d{1,2})[-./](\d{1,2})\.?$/.exec(value.trim());
 if(!m)return null;
 const iso=`${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`;
 const t=Date.parse(`${iso}T00:00:00Z`);
 return Number.isFinite(t)&&new Date(t).toISOString().slice(0,10)===iso?iso:null;
}

function fileBase(name:unknown):string|null{
 if(typeof name!=='string')return null;
 const base=name.split(/[\\/]/).pop()?.trim()??'';
 return base&&base.length<=200&&!hasControl(base)?base:null;
}

type RawRow={row:number;values:Map<Field,unknown>;extra:boolean};

function rowsFromCsv(text:string,aliases:Map<string,Field>,issues:ImportIssue[],ignored:Set<string>):RawRow[]|null{
 let records:{line:number;cells:string[]}[];
 try{records=parseCsv(text)}catch(error){issues.push({row:error instanceof ParseError?error.row:null,reason:error instanceof Error?error.message:'CSV를 읽지 못했습니다.'});return null}
 const nonBlank=records.filter(r=>r.cells.some(c=>c.trim()!==''));
 if(!nonBlank.length){issues.push({row:null,reason:'파일에 내용이 없습니다.'});return null}
 const [header,...body]=nonBlank;
 const fields:(Field|null)[]=header.cells.map(h=>{const f=aliases.get(norm(h))??null;if(!f&&h.trim())ignored.add(h.trim().slice(0,40));return f});
 if(!headerOk(fields,header.line,issues))return null;
 return body.map(r=>{
  const values=new Map<Field,unknown>();
  fields.forEach((f,i)=>{if(f)values.set(f,r.cells[i]??'')});
  return {row:r.line,values,extra:r.cells.slice(fields.length).some(c=>c.trim()!=='')};
 });
}

function rowsFromJson(text:string,aliases:Map<string,Field>,issues:ImportIssue[],ignored:Set<string>):RawRow[]|null{
 let data:unknown;
 try{data=JSON.parse(text.charCodeAt(0)===0xfeff?text.slice(1):text)}catch{issues.push({row:null,reason:'JSON 형식이 올바르지 않습니다.'});return null}
 if(!Array.isArray(data)){issues.push({row:null,reason:'JSON은 상품 객체의 배열이어야 합니다.'});return null}
 if(!data.length){issues.push({row:null,reason:'파일에 내용이 없습니다.'});return null}
 const out:RawRow[]=[];
 data.forEach((item,index)=>{
  if(!item||typeof item!=='object'||Array.isArray(item)){issues.push({row:index+1,reason:'항목이 객체가 아닙니다.'});return}
  const values=new Map<Field,unknown>();
  for(const [key,value] of Object.entries(item as Record<string,unknown>)){
   const f=aliases.get(norm(key));
   if(!f){if(key.trim())ignored.add(key.trim().slice(0,40));continue}
   if(values.has(f)){issues.push({row:index+1,field:f,reason:`같은 뜻의 열이 두 번 있습니다(${key}).`});continue}
   values.set(f,value);
  }
  out.push({row:index+1,values,extra:false});
 });
 const present=new Set(out.flatMap(r=>[...r.values.keys()]));
 if(!present.has('rank'))issues.push({row:null,field:'rank',reason:'순위(rank) 열이 없습니다.'});
 if(!present.has('title'))issues.push({row:null,field:'title',reason:'상품명(title) 열이 없습니다.'});
 return issues.length?null:out;
}

function headerOk(fields:(Field|null)[],line:number,issues:ImportIssue[]){
 const seen=new Set<Field>();
 for(const f of fields){
  if(!f)continue;
  if(seen.has(f))issues.push({row:line,field:f,reason:`같은 뜻의 머리글이 두 번 있습니다(${f}).`});
  seen.add(f);
 }
 if(!seen.has('rank'))issues.push({row:line,field:'rank',reason:'순위(순위·rank) 머리글이 없습니다.'});
 if(!seen.has('title'))issues.push({row:line,field:'title',reason:'상품명(상품명·title) 머리글이 없습니다.'});
 return !issues.length;
}

export async function parseImport(input:ImportInput,deps:Pick<CollectDeps,'now'>):Promise<ImportOutcome>{
 const issues:ImportIssue[]=[];
 const fail=(reason:string):ImportOutcome=>({ok:false,errors:[{row:null,reason}]});
 if(!IMPORT_SOURCES.includes(input.sourceId))return fail('가져오기를 받는 출처가 아닙니다.');
 const spec=sourceSpec(input.sourceId);
 if(spec.method!=='manual'&&spec.method!=='licensed')return fail('가져오기를 받는 출처가 아닙니다.');
 const fileName=fileBase(input.fileName);
 if(!fileName)return fail('파일 이름을 확인하세요(200자 이내).');
 const scope=typeof input.scope==='string'?input.scope.trim():'';
 if(!scope||scope.length>100||hasControl(scope))return fail('랭킹 범위(카테고리 이름)를 100자 이내로 입력하세요.');
 const observedDate=typeof input.observedDate==='string'?day(input.observedDate):null;
 if(!observedDate||observedDate!==input.observedDate.trim())return fail('기준일을 YYYY-MM-DD 형식으로 입력하세요.');
 const now=deps.now();
 if(observedDate>kstDayKey(now))return fail('기준일이 오늘(한국 시각)보다 늦습니다.');
 if(typeof input.text!=='string')return fail('파일 내용을 읽지 못했습니다.');
 const raw=input.text;
 const bytes=new TextEncoder().encode(raw);
 if(bytes.byteLength>IMPORT_MAX_BYTES)return fail(`파일이 ${IMPORT_MAX_BYTES/1024/1024}MB를 넘습니다. 나눠서 올려 주세요.`);
 // 엑셀 기본 CSV(CP949)를 UTF-8로 잘못 읽으면 대체 문자(U+FFFD)가 생긴다. 깨진 글자를 저장하지 않게 거절한다.
 if(raw.includes('\uFFFD'))return fail('UTF-8로 읽을 수 없는 글자가 있습니다. 엑셀에서 "CSV UTF-8(쉼표로 분리)"로 다시 저장해 주세요.');
 const format=input.format??(/\.json$/i.test(fileName)?'json':/\.(csv|txt)$/i.test(fileName)?'csv':raw.replace(/^\uFEFF/,'').trimStart().startsWith('[')?'json':'csv');
 const aliases=aliasMap(input.sourceId);
 const ignored=new Set<string>();
 const rows=format==='json'?rowsFromJson(raw,aliases,issues,ignored):rowsFromCsv(raw,aliases,issues,ignored);
 if(!rows)return {ok:false,errors:issues.slice(0,MAX_REPORTED)};
 if(!rows.length)return fail('머리글만 있고 상품 행이 없습니다.');
 if(rows.length>IMPORT_MAX_ROWS)return fail(`상품 행이 ${IMPORT_MAX_ROWS.toLocaleString('ko-KR')}개를 넘습니다(${rows.length}행). 나눠서 올려 주세요.`);

 const metrics=new Set(spec.metrics);
 const skippedMetricFields=new Set<NumberField>();
 const observations:Observation[]=[];
 const rankAt=new Map<string,number>();
 const ranksByDate=new Map<string,number[]>();
 const rowLabel=format==='json'?'번째 항목':'행';
 for(const r of rows){
  const bad=(field:Field|undefined,reason:string)=>issues.push({row:r.row,...(field?{field}:{}),reason:`${r.row}${rowLabel}: ${reason}`});
  if(r.extra)bad(undefined,'머리글보다 칸이 많습니다. 쉼표가 들어간 값은 큰따옴표로 묶어 주세요.');
  const get=(f:Field)=>r.values.get(f);
  // 순위: 1 이상 정수, 필수
  const rankN=parseNumber(get('rank'));
  const rank='value' in rankN?rankN.value:null;
  if('error' in rankN)bad('rank',`순위 ${rankN.error}`);
  else if(rank===null)bad('rank','순위가 비어 있습니다.');
  else if(!Number.isInteger(rank)||rank<1||rank>100000)bad('rank','순위는 1 이상의 정수여야 합니다.');
  // 상품명: 필수, 300자 이내
  // 화면에서 복사한 상품명은 칸 안 줄바꿈이 섞이기 쉽다. 공백 하나로 접는다.
  const title=cellText(get('title')).replace(/\s+/g,' ');
  if(!title)bad('title','상품명이 비어 있습니다.');
  else if(title.length>300||hasControl(title))bad('title','상품명은 300자 이내 한 줄로 입력하세요.');
  const numbers:Partial<Record<NumberField,number|null>>={};
  for(const f of NUMBER_FIELDS){
   if(!r.values.has(f))continue;
   const p=parseNumber(get(f));
   if('error' in p){bad(f,`${FIELD_LABEL[f]} ${p.error}`);continue}
   const v=p.value;
   if(v!==null){
    if(f==='price'&&v<=0){bad(f,'가격은 0보다 커야 합니다(모르면 비워 두세요).');continue}
    if((f==='review_count'||f==='sales_estimate')&&!Number.isInteger(v)){bad(f,`${FIELD_LABEL[f]}는 정수여야 합니다.`);continue}
    if(f==='rating'&&v>5){bad(f,'평점은 0~5 사이여야 합니다.');continue}
   }
   numbers[f]=v;
  }
  const brand=cellText(get('brand')).slice(0,100)||null;
  const category=cellText(get('category')).slice(0,200)||null;
  const productId=cellText(get('product_id'));
  if(productId.length>80)bad('product_id','상품번호는 80자 이내여야 합니다.');
  let url:string|null=null;
  const urlText=cellText(get('url'));
  if(urlText){
   try{const u=new URL(urlText);if((u.protocol!=='https:'&&u.protocol!=='http:')||urlText.length>1000)throw new Error('scheme');url=u.toString()}
   catch{bad('url','링크는 http(s) 주소여야 합니다.')}
  }
  // 기준일: 운영자 화면 저장은 한 시점이므로 파일 기준일과 같아야 한다. 계약 데이터 이력은 여러 날짜를 허용한다.
  let date=observedDate;
  const dateText=cellText(get('date'));
  if(dateText){
   const d=day(dateText);
   if(!d)bad('date','기준일을 YYYY-MM-DD로 입력하세요.');
   else if(d>kstDayKey(now))bad('date','기준일이 오늘보다 늦습니다.');
   else if(spec.method==='manual'&&d!==observedDate)bad('date',`기준일(${d})이 파일 기준일(${observedDate})과 다릅니다.`);
   else date=d;
  }
  if(rank!==null&&Number.isInteger(rank)&&rank>=1){
   const key=`${date}|${rank}`;
   const first=rankAt.get(key);
   if(first!==undefined)bad('rank',`순위 ${rank}이(가) ${first}${rowLabel}과 겹칩니다.`);
   else{rankAt.set(key,r.row);const list=ranksByDate.get(date);if(list)list.push(rank);else ranksByDate.set(date,[rank])}
  }
  if(issues.length>=MAX_REPORTED)break;
  if(rank===null||!title)continue;
  const subject:Subject={type:'listing',sourceId:input.sourceId,externalId:productId||`t:${title.toLowerCase().replace(/\s+/g,' ')}`,title,brand,price:numbers.price??null,url,categoryPath:category};
  const period={from:date,to:date};
  observations.push({subject,metric:'rank',value:rank,period,scope});
  for(const f of NUMBER_FIELDS){
   if(!r.values.has(f))continue;
   const metric=FIELD_METRIC[f];
   if(!metrics.has(metric)){skippedMetricFields.add(f);continue}
   observations.push({subject,metric,value:numbers[f]??null,period,scope});
  }
 }
 // 전부 아니면 전무: 하나라도 잘못되면 아무것도 돌려주지 않는다.
 if(issues.length){
  const errors=issues.slice(0,MAX_REPORTED);
  if(issues.length>=MAX_REPORTED)errors.push({row:null,reason:`오류가 많아 처음 ${MAX_REPORTED}개만 보여 줍니다. 파일 형식을 먼저 확인해 주세요.`});
  return {ok:false,errors};
 }

 const limitations:string[]=spec.method==='licensed'
  ?['계약 공급사 내보내기 자료입니다. 판매량은 공급사 추정치이며 실제 판매와 다를 수 있습니다.']
  :['운영자가 본 랭킹 화면을 옮긴 자료입니다. 화면 시점·로그인·개인화에 따라 순위가 다를 수 있습니다.'];
 let gaps=0;
 for(const [d,ranks] of ranksByDate){
  const have=new Set(ranks),max=Math.max(...ranks);
  const missing:number[]=[];
  for(let k=1;k<=max;k++)if(!have.has(k))missing.push(k);
  if(missing.length){gaps+=missing.length;limitations.push(`${d} 순위 중 ${missing.slice(0,10).join(', ')}${missing.length>10?` 외 ${missing.length-10}개`:''}가 빠졌습니다(미확인).`)}
 }
 const blankValues=observations.filter(o=>o.value===null).length;
 if(blankValues)limitations.push(`비어 있는 값 ${blankValues}개는 0이 아니라 미확인으로 두었습니다.`);
 if(skippedMetricFields.size)limitations.push(`이 출처의 지표가 아닌 열(${[...skippedMetricFields].map(f=>FIELD_LABEL[f]).join(', ')})은 저장하지 않았습니다.`);
 if(ignored.size)limitations.push(`인식하지 못한 열(${[...ignored].slice(0,10).join(', ')})은 저장하지 않았습니다.`);
 return {
  ok:true,rows:rows.length,unitsUsed:0,
  draft:{
   sourceId:input.sourceId,method:spec.method,
   request:{fileName,scope,observedDate,format,rows:rows.length},
   fetchedAt:now.toISOString(),bodyDigest:await sha256Hex(bytes),bodyBytes:bytes.byteLength,
   status:gaps?'partial':'ok',limitations,observations,
  },
 };
}
