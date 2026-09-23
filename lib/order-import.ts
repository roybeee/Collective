// POS 주문 CSV 가져오기(A4). 순수 모듈: CSV 파싱·열 매핑·행 검증·파일 안 중복·개인정보 거부만 한다. 저장·귀속·권한은 lib/store-operations-server.ts.
// 개인정보 최소화: 고객 ID 열은 '식별 가능한 주문인지'만 세고 값은 돌려주지도 저장하지도 않는다(결정 11 전이라 해시도 저장하지 않음).
// 카드번호(13~19자리 숫자열)·휴대폰 번호가 보이는 파일은 통째로 거부한다. 주문번호 열은 긴 POS 번호가 흔해 카드번호 검사에서만 뺀다.
import {orderModes,orderSources} from './store-operations';

export class ImportError extends Error {}
// 행 상한은 확정 때 D1 batch 한 번(주문 행 + 가져오기 기록)에 담기는 문장 수를 보수적으로 잡은 값이다. 큰 매장은 주 단위로 나누어 올린다.
export const IMPORT_LIMITS={maxBytes:150000,maxRows:500,maxColumns:60,maxCell:500} as const;
export const importFields={orderNumber:'주문번호',orderedAt:'주문 일시',amount:'결제 금액(할인 후)',discount:'할인 금액',code:'쿠폰·추적 코드',channel:'주문 채널',customerId:'고객 ID(저장 안 함)',newCustomer:'신규 고객 여부'} as const;
export type ImportField=keyof typeof importFields;
export type ColumnMapping=Partial<Record<ImportField,string>>;
const REQUIRED:readonly ImportField[]=['orderNumber','orderedAt','amount'];
// 흔한 POS·배달앱 내보내기 열 이름. 공백·밑줄·하이픈·괄호·대소문자를 무시하고 정확히 같은 이름만 추천한다.
const ALIASES:Record<ImportField,readonly string[]>={
 orderNumber:['주문번호','영수증번호','거래번호','주문id','주문코드','ordernumber','orderno','orderid'],
 orderedAt:['주문일시','주문일자','주문일','주문시간','거래일시','결제일시','판매일시','일시','날짜','일자','orderedat','orderdate','date','datetime'],
 amount:['결제금액','실결제금액','실매출','실매출액','순매출','매출액','판매금액','금액','amount','paidamount','total'],
 discount:['할인','할인금액','할인액','쿠폰할인','discount'],
 code:['쿠폰','쿠폰코드','쿠폰번호','코드','추적코드','프로모션코드','pos태그','태그','utm','coupon','code','promocode'],
 channel:['채널','주문채널','판매채널','주문경로','주문유형','channel','source'],
 customerId:['고객id','고객번호','회원번호','회원id','적립고객','적립고객id','customer','customerid'],
 newCustomer:['신규','신규고객','신규여부','첫주문','newcustomer'],
};
const headerKey=(h:string)=>h.normalize('NFKC').toLowerCase().replace(/[\s_\-()]/g,'');

// 따옴표·쉼표·BOM·CRLF를 지원한다. 구조 오류(따옴표·열 수·상한)는 파일 전체를 거부한다.
// lines는 각 행이 시작하는 파일의 실제 줄 번호다(빈 줄·인용 안 줄바꿈을 센다). 오류 문구의 'N행'은 이 번호다.
export function parseCsv(text:string){
 if(typeof text!=='string'||!text.trim())throw new ImportError('가져올 CSV 내용이 없습니다.');
 if(new TextEncoder().encode(text).length>IMPORT_LIMITS.maxBytes)throw new ImportError(`CSV는 ${IMPORT_LIMITS.maxBytes/1000}KB 이하로 나누어 올려 주세요.`);
 const src=text.replace(/^﻿/,''),records:string[][]=[],starts:number[]=[];let row:string[]=[],cell='',quoted=false,afterQuote=false,line=1,start=1;
 const endRow=()=>{row.push(cell);if(row.some(x=>x.trim())){records.push(row);starts.push(start)}row=[];cell='';afterQuote=false};
 for(let i=0;i<src.length;i++){const c=src[i];
  if(quoted){if(c==='"'){if(src[i+1]==='"'){cell+='"';i++}else{quoted=false;afterQuote=true}}else{cell+=c;if(c==='\n'||(c==='\r'&&src[i+1]!=='\n'))line++}continue}
  if(c==='"'){if(cell.trim()||afterQuote)throw new ImportError('CSV 따옴표 형식을 확인하세요.');cell='';quoted=true}
  else if(c===','){row.push(cell);cell='';afterQuote=false}
  else if(c==='\n'||c==='\r'){if(c==='\r'&&src[i+1]==='\n')i++;endRow();line++;start=line}
  else if(afterQuote){if(c!==' '&&c!=='\t')throw new ImportError('CSV 닫는 따옴표 뒤의 구분자를 확인하세요.')}
  else cell+=c;
 }
 if(quoted)throw new ImportError('CSV 따옴표가 닫히지 않았습니다.');endRow();
 // 표 계산기가 붙이는 끝의 빈 머리글은 버린다.
 starts.shift();const raw=(records.shift()||[]).map(h=>h.trim()),headers=raw.slice(0,raw.map(Boolean).lastIndexOf(true)+1);
 if(!headers.length)throw new ImportError('머리글 행이 있는 CSV를 올려 주세요.');
 if(headers.length>IMPORT_LIMITS.maxColumns)throw new ImportError(`열은 ${IMPORT_LIMITS.maxColumns}개까지 가져올 수 있습니다.`);
 if(headers.some(h=>!h))throw new ImportError('이름이 비어 있는 열이 있습니다. 열 이름을 채워 주세요.');
 if(new Set(headers).size!==headers.length)throw new ImportError('같은 이름의 열이 있습니다. 열 이름을 고쳐 주세요.');
 if(!records.length)throw new ImportError('가져올 주문 행이 없습니다.');
 if(records.length>IMPORT_LIMITS.maxRows)throw new ImportError(`한 번에 ${IMPORT_LIMITS.maxRows.toLocaleString('ko-KR')}행까지 가져올 수 있습니다. 파일을 나누어 주세요.`);
 const rows=records.map((cells,i)=>{
  if(cells.length<headers.length||cells.slice(headers.length).some(x=>x.trim()))throw new ImportError(`${starts[i]}행의 열 수가 머리글과 다릅니다.`);
  if(cells.some(x=>x.length>IMPORT_LIMITS.maxCell))throw new ImportError(`${starts[i]}행에 ${IMPORT_LIMITS.maxCell}자를 넘는 칸이 있습니다.`);
  return cells.slice(0,headers.length);
 });
 return {headers,rows,lines:starts};
}
// 화면이 처음 보여 줄 추천 매핑. 한 열은 한 항목에만 쓴다.
export function suggestMapping(headers:readonly string[]):ColumnMapping{
 return (Object.keys(ALIASES) as ImportField[]).reduce<ColumnMapping>((out,field)=>{
  const taken=new Set(Object.values(out)),hit=headers.find(h=>!taken.has(h)&&ALIASES[field].includes(headerKey(h)));
  return hit?{...out,[field]:hit}:out;
 },{});
}
export function checkMapping(headers:readonly string[],mapping:unknown){
 if(!mapping||typeof mapping!=='object'||Array.isArray(mapping))throw new ImportError('열 매핑을 확인하세요.');
 const entries=Object.entries(mapping as Record<string,unknown>).filter(([,v])=>v!==undefined&&v!==null&&v!=='');
 const unknown=entries.find(([k])=>!Object.hasOwn(importFields,k));if(unknown)throw new ImportError(`알 수 없는 매핑 항목입니다: ${unknown[0].slice(0,40)}`);
 const missing=REQUIRED.filter(f=>!entries.some(([k])=>k===f));if(missing.length)throw new ImportError(`필수 열을 연결하세요: ${missing.map(f=>importFields[f]).join(', ')}`);
 const names=Object.fromEntries(entries) as ColumnMapping,values=Object.values(names);
 for(const [field,header] of entries){
  if(typeof header!=='string'||!headers.includes(header))throw new ImportError(`${importFields[field as ImportField]}에 연결한 열이 파일에 없습니다.`);
  if(values.indexOf(header)!==values.lastIndexOf(header))throw new ImportError(`'${header}' 열을 두 항목에 연결할 수 없습니다.`);
 }
 const index=Object.fromEntries(entries.map(([field,header])=>[field,headers.indexOf(header as string)])) as Partial<Record<ImportField,number>>;
 return {index,names};
}

const PHONE=/(^|\D)(?:\+82[ -]?|0)1[016789][ .-]?\d{3,4}[ .-]?\d{4}(?!\d)/;
const CARD=/(^|\D)\d(?:[ -]?\d){12,18}(?!\d)/;
export type PersonalData={column:string;kind:'phone'|'card'};
// 값 하나의 개인정보 패턴. card=false면 휴대폰 번호만 본다(긴 POS 주문번호).
export function personalDataKind(value:string,card=true):PersonalData['kind']|null{return PHONE.test(value)?'phone':card&&CARD.test(value)?'card':null}
// 모든 열을 본다. 매핑하지 않은 열도 파일에 실려 오므로 검사한다. cardExempt 열(주문번호)은 휴대폰 번호만 본다.
export function findPersonalData(headers:readonly string[],rows:readonly string[][],cardExempt:readonly number[]):PersonalData|null{
 for(let c=0;c<headers.length;c++){
  for(const cells of rows){const kind=personalDataKind(cells[c]||'',!cardExempt.includes(c));if(kind)return {column:headers[c],kind}}
 }
 return null;
}
const personalDataMessage=({column,kind}:PersonalData)=>`'${column}' 열에 ${kind==='phone'?'휴대폰 번호':'카드번호로 보이는 숫자열(13~19자리)'}가 있어 가져오지 않았습니다. 개인정보는 저장하지 않습니다. 이 열을 지우고 다시 올려 주세요.`;

// 시간대가 있는 ISO 시각은 한국 날짜로 바꾸고, 시간대가 없는 날짜·시각은 적힌 날짜를 그대로 쓴다(POS 내보내기는 매장 현지 시각).
export function parseOrderDate(raw:string){
 const v=raw.trim();
 if(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/.test(v)){const t=Date.parse(v);return Number.isFinite(t)?new Date(t).toLocaleDateString('en-CA',{timeZone:'Asia/Seoul'}):''}
 const m=/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})\.?(?:[ T]+\d{1,2}:\d{2}(?::\d{2})?)?$/.exec(v);if(!m)return '';
 const [y,mo,d]=[Number(m[1]),Number(m[2]),Number(m[3])],t=new Date(Date.UTC(y,mo-1,d));
 return t.getUTCFullYear()===y&&t.getUTCMonth()===mo-1&&t.getUTCDate()===d?`${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`:'';
}
// 원·쉼표·공백은 무시한다. 음수(-, 괄호)는 취소·환불 행이므로 받지 않는다.
export function parseAmount(raw:string,label:string,required:boolean){
 const v=raw.replace(/[,\s원₩]/g,'');
 if(!v){if(required)throw new ImportError(`${label}이 비어 있습니다.`);return null}
 if(/^[-−(]/.test(v))throw new ImportError(`${label}은 음수일 수 없습니다. 취소·환불 행은 빼고 올려 주세요.`);
 if(!/^\d+(\.\d{1,2})?$/.test(v)||Number(v)>1e12)throw new ImportError(`${label}을 숫자로 적어 주세요.`);
 return Number(v);
}
type Source=keyof typeof orderSources;type Mode=keyof typeof orderModes;
const SOURCE_PATTERNS:readonly (readonly [RegExp,Source])[]=[[/배달의\s*민족|배민|baemin/i,'baemin'],[/쿠팡|coupang/i,'coupang'],[/요기요|yogiyo/i,'yogiyo'],[/땡겨요|ddangyo/i,'ddangyo'],[/네이버|naver/i,'naver'],[/당근|daangn/i,'daangn'],[/직접|전화|direct/i,'direct'],[/pos|매장|홀|포장|키오스크|kiosk|테이블|table/i,'pos']];
const DELIVERY_APPS:readonly Source[]=['baemin','coupang','yogiyo','ddangyo'];
// 채널 열이 없거나 비면 POS 홀 주문으로 본다.
export function sourceOf(text:string):Source{const t=text.trim();if(!t)return 'pos';if(Object.hasOwn(orderSources,t))return t as Source;return SOURCE_PATTERNS.find(([re])=>re.test(t))?.[1]??'other'}
export function modeOf(text:string,source:Source):Mode{if(DELIVERY_APPS.includes(source))return 'delivery';if(/포장|픽업|pickup|takeout|테이크아웃/i.test(text))return 'pickup';if(/배달|delivery/i.test(text))return 'delivery';if(/단체|group|케이터링/i.test(text))return 'group';return 'hall'}
function newCustomerOf(raw:string){const v=raw.trim().toLowerCase();if(!v)return undefined;if(/^(y|yes|true|1|신규|첫\s*주문|new)$/.test(v))return true;if(/^(n|no|false|0|기존|재주문|재방문|returning)$/.test(v))return false;throw new ImportError('신규 고객 여부는 Y/N(신규/기존)으로 적어 주세요.')}

export type ImportRow={line:number;orderNumber:string;orderDate:string;amount:number;discount:number;codeCell:string;source:Source;mode:Mode;identifiable:boolean;newCustomer?:boolean};
export type RowError={line:number;message:string};
function readRow(get:(f:ImportField)=>string,line:number,today:string):ImportRow{
 const orderNumber=get('orderNumber');if(!orderNumber)throw new ImportError('주문번호가 비어 있습니다.');if(orderNumber.length>100)throw new ImportError('주문번호는 100자 이하여야 합니다.');
 const orderDate=parseOrderDate(get('orderedAt'));if(!orderDate)throw new ImportError('주문 일시를 읽을 수 없습니다. 2026-09-24 13:05 형식으로 적어 주세요.');if(orderDate>today)throw new ImportError('주문 일시가 미래 날짜입니다.');
 const amount=parseAmount(get('amount'),importFields.amount,true)!,discount=parseAmount(get('discount'),importFields.discount,false)??0;
 const channel=get('channel'),source=sourceOf(channel),newCustomer=newCustomerOf(get('newCustomer'));
 return {line,orderNumber,orderDate,amount,discount,codeCell:get('code'),source,mode:modeOf(channel,source),identifiable:!!get('customerId'),...(newCustomer===undefined?{}:{newCustomer})};
}
// 파일 구조·매핑·개인정보 문제는 ImportError로 전체를 거부한다. 행 문제는 errors에 모으고 나머지 행은 돌려준다(확정은 오류가 없을 때만).
// 파일 안 중복은 주문 장부 id와 같은 기준(주문 출처·주문일·주문번호)으로 본다. POS 주문번호는 날마다 다시 시작하는 경우가 많다.
export function prepareImport(text:string,mapping:unknown,today:string){
 const {headers,rows,lines}=parseCsv(text),{index,names}=checkMapping(headers,mapping);
 const personal=findPersonalData(headers,rows,[index.orderNumber!]);if(personal)throw new ImportError(personalDataMessage(personal));
 const seen=new Map<string,number>(),valid:ImportRow[]=[],errors:RowError[]=[];
 rows.forEach((cells,i)=>{
  const line=lines[i],get=(f:ImportField)=>index[f]===undefined?'':cells[index[f]!].trim();
  try{
   const row=readRow(get,line,today),key=[row.source,row.orderDate,row.orderNumber].join('\u0000'),first=seen.get(key);
   if(first)throw new ImportError(`같은 주문번호가 같은 날짜·채널로 파일 안에서 반복됩니다(${first}행과 같음).`);
   seen.set(key,line);valid.push(row);
  }catch(e){if(e instanceof ImportError)errors.push({line,message:e.message});else throw e}
 });
 return {headers,mapping:names,rows:valid,errors,identifiableOrders:valid.filter(r=>r.identifiable).length};
}
