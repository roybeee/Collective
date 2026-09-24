// 전송 전 개인정보 패턴 검사·가림(docs/DATA-PROCESSING.ko.md DP-3·DP-4, 레인 A 입력 최소화). 순수 모듈: import가 없고 서버·네트워크에 의존하지 않는다.
// 결과는 종류·건수(maskFields는 필드 경로 포함)뿐이다. 탐지한 값은 돌려주지도, 오류 문구에 싣지도 않는다(DP-4). 예외: contactAllowValues는 허용 목록을 만들 때만 쓴다.
// 정규화: 글자마다 NFKC(전각 숫자·기호)를 적용하고 여러 대시를 '-'로, 폭 없는 문자를 없는 것으로 본다. 원문 위치를 기억해 가린 부분 밖의 원문은 바꾸지 않는다.
// 한계는 docs/INPUT-MINIMIZATION.ko.md '알려진 한계'에 적는다(사람 이름·민감정보·짧은 도로명·대표번호 등은 패턴으로 잡지 않는다).
export type PiiKind='phone'|'email'|'address'|'payment'|'national_id'|'customer_id';
export type PiiFinding={kind:PiiKind;count:number};
export type PiiFieldFinding={field:string;kind:PiiKind;count:number};
// allow: 원문과 정확히 같은(정규화 후) 부분은 가리지 않는다(확정 사실·지점 주소·사업장 전화). 4자 미만 항목은 무시한다.
// failClosed: 탐지되면 가리지 않고 PiiBlockedError를 던진다(B3-2 Reflector 전용 전송 차단). 오류에는 필드·종류·건수만 있다.
export type MaskOptions={allow?:readonly unknown[];failClosed?:boolean};
export const PII_KINDS:readonly PiiKind[]=['phone','email','address','payment','national_id','customer_id'];
export const PII_PLACEHOLDER:Readonly<Record<PiiKind,string>>={phone:'[전화번호]',email:'[이메일]',address:'[주소]',payment:'[결제정보]',national_id:'[고유식별번호]',customer_id:'[고객식별자]'};
const KIND_LABEL:Readonly<Record<PiiKind,string>>={phone:'전화번호',email:'이메일',address:'주소',payment:'결제정보',national_id:'고유식별번호',customer_id:'고객식별자'};
const MIN_ALLOW_LENGTH=4;

export class PiiBlockedError extends Error{
 readonly findings:PiiFieldFinding[];
 constructor(findings:PiiFieldFinding[]){
  super('개인정보로 보이는 값이 있어 전송하지 않았습니다: '+findings.map(f=>`${f.field} ${KIND_LABEL[f.kind]} ${f.count}건`).join(', '));
  this.name='PiiBlockedError';this.findings=findings;
 }
}

// 정규화 본문과, 정규화 본문의 UTF-16 위치마다 원문 [start,end) 위치.
type Normalized={text:string;start:number[];end:number[]};
const DASH=/^[\u2010-\u2015\u2212\uFE58\uFE63\uFF0D]$/,INVISIBLE=/^[\u00AD\u200B-\u200D\u2060\uFEFF]$/;
function normalize(source:string):Normalized{
 const start:number[]=[],end:number[]=[];let text='',at=0;
 for(const ch of source){
  const n=INVISIBLE.test(ch)?'':DASH.test(ch)?'-':ch.normalize('NFKC');
  for(let k=0;k<n.length;k++){start.push(at);end.push(at+ch.length)}
  text+=n;at+=ch.length;
 }
 return {text,start,end};
}

// 탐지기: 우선순위 순서다. 앞선 탐지기가 잡은 구간과 겹치는 뒤 탐지는 버린다(해시 속 숫자열, 이메일 속 번호, 주민번호 13자리 등).
type Detector={kind:PiiKind;pattern:RegExp;accept?:(m:RegExpMatchArray)=>boolean};
const CC='(?:\\+ ?82[ -]?(?:\\(0\\)|0)?|0)',SEP='[ .-]?';
// 도로명·지번 뒤에 오는 수량 단위: 수량 표현(무료로 100개, 추가로 2 종)을 주소로 보지 않는다.
const COUNTER='(?![0-9A-Za-z가-힣%])(?!\\s?(?:개월|시간|단계|가지|종류|개|명|회|원|배|번|건|일|주|분|초|위|등|종|곳|장|잔|세|년|월|차|권|편|점|이상|이하|미만|초과)(?![가-힣]))';
// 조사 '(으)로'·흔한 명사를 도로명·동네 이름으로 보지 않는다.
const NOT_ROAD=/(?:으|[율률수배량액비회개명건분초순등])$|^(?:추가|무료|별도|실제|정도|최대|최소|기본|필수|단독|우선|순서|스스|그대|이대|제대|대체|절대|정말|마음대|멋대)$/;
const NOT_PLACE=new Set(['행동','활동','이동','운동','변동','연동','자동','공동','작동','감동','노동','진동','가동','수동','출동','충동','파동','발동','능동','관리','처리','거리','요리','조리','소리','자리','정리','분리','수리','원리','심리','논리','대리','편리','무리','우리','유리','머리','다리','도리','경리','교리','합리','실리','의리','진리']);
const digits=(s:string)=>s.replace(/\D/g,'').length;
const DETECTORS:readonly Detector[]=[
 {kind:'customer_id',pattern:/(?<![0-9A-Fa-f])[0-9A-Fa-f]{64}(?![0-9A-Fa-f])/g},
 {kind:'email',pattern:/(?<![A-Za-z0-9._%+-])[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}(?![A-Za-z0-9-])/g},
 // 주민등록·외국인등록(생년월일 6자리 + 성별 1~8 + 6자리), 운전면허(2-2-6-2), 여권 후보(영문 1자 + 8자리, 신형 3자리+영문+4자리).
 {kind:'national_id',pattern:/(?<!\d)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01]) ?- ?[1-8]\d{6}(?!\d)|(?<!\d)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])[1-8]\d{6}(?!\d)/g},
 {kind:'national_id',pattern:/(?<!\d)\d{2}[ -]\d{2}[ -]\d{6}[ -]\d{2}(?!\d)/g},
 {kind:'national_id',pattern:/(?<![A-Za-z0-9])[MSRGDmsrgd](?:\d{8}|\d{3}[A-Za-z]\d{4})(?![A-Za-z0-9])/g},
 // 휴대폰(lib/order-import.ts PHONE의 상위 집합)·지역번호·인터넷전화 070·안심번호 050x·수신자부담 080. 괄호 지역번호 허용.
 {kind:'phone',pattern:new RegExp(`(?<!\\d)\\(?${CC}(?:1[016789]|2|[3-6][1-5]|70|80|50[2-8])\\)?${SEP}\\d{3,4}${SEP}\\d{4}(?!\\d)`,'g')},
 // 은행명(…은행·…뱅크·농협 등)이나 '계좌' 뒤의 숫자 묶음(10~16자리). 카드보다 먼저 봐서 은행명까지 한 번에 가린다.
 {kind:'payment',pattern:/(?<![가-힣A-Za-z])(?:[가-힣A-Za-z]{0,10}(?:은행|뱅크)|농협|신협|새마을금고|우체국|IBK|KB|계좌(?:번호)?)(?:\s*계좌(?:번호)?)?\s*[:：]?\s*(?<!\d)\d{2,6}(?:[ -]\d{1,8}){1,4}(?!\d)/g,accept:m=>{const n=digits(m[0]);return n>=10&&n<=16}},
 // 카드번호: lib/order-import.ts CARD와 같은 규칙(13~19자리, 숫자 사이 공백·하이픈 1개).
 {kind:'payment',pattern:/(?<!\d)\d(?:[ -]?\d){12,18}(?!\d)/g},
 // 동·호수: '101동 1203호'·'B동 201호', 단독 '101동', 단독 3자리 이상 '1203호'. 노선(2호선)·지점(3호점)은 뺀다(lib/brief.ts unitPatterns 참고).
 {kind:'address',pattern:/(?<![가-힣A-Za-z0-9])(?:[A-Za-z]|\d{1,4}|[가나다라마바사]) ?동 ?\d{1,5} ?호(?![선점차기가-힣])|(?<![가-힣A-Za-z0-9])\d{2,4}동(?![가-힣])|(?<!\d)\d{3,5} ?호(?![선점차기가-힣])/g},
 // 도로명: 두 글자 이상 이름 + 로/길(+ '12번길'), 건물번호(-부번).
 {kind:'address',pattern:new RegExp(`(?<![가-힣A-Za-z0-9])(?<road>[가-힣]{2,12})(?:로|길)(?: ?\\d{1,4}번?(?:길|가길))? ?\\d{1,4}(?:-\\d{1,4})?${COUNTER}`,'g'),accept:m=>!NOT_ROAD.test(m.groups!.road)},
 // 지번: 동·리 이름(이문2동 포함) + 번지(-부번, '번지').
 {kind:'address',pattern:new RegExp(`(?<![가-힣A-Za-z0-9])(?<place>[가-힣]{1,10}\\d{0,2}(?:동|리)) ?\\d{1,5}(?:-\\d{1,5})?(?: ?번지)?${COUNTER}`,'g'),accept:m=>!NOT_PLACE.has(m.groups!.place)},
];

type Span={start:number;end:number;kind:PiiKind};
const allowStrings=(allow:readonly unknown[]=[])=>[...new Set(allow.filter((v):v is string=>typeof v==='string').map(v=>normalize(v.trim()).text).filter(v=>v.length>=MIN_ALLOW_LENGTH))];
function protectedRanges(text:string,allow:readonly unknown[]){
 const ranges:[number,number][]=[];
 for(const a of allowStrings(allow))for(let i=text.indexOf(a);i>=0;i=text.indexOf(a,i+1))ranges.push([i,i+a.length]);
 return ranges;
}
// 정규화 본문에서 탐지 구간을 찾는다. 허용 구간에 완전히 들어간 탐지는 버리고, 걸치기만 하면 가린다.
function detect(text:string,allow:readonly unknown[]=[]):Span[]{
 const safe=protectedRanges(text,allow),taken:Span[]=[];
 for(const d of DETECTORS)for(const m of text.matchAll(d.pattern)){
  const start=m.index!,end=start+m[0].length;
  if(d.accept&&!d.accept(m))continue;
  if(safe.some(([a,b])=>a<=start&&end<=b)||taken.some(t=>start<t.end&&t.start<end))continue;
  taken.push({start,end,kind:d.kind});
 }
 return taken.sort((a,b)=>a.start-b.start);
}
const countKinds=(spans:readonly Span[]):PiiFinding[]=>PII_KINDS.map(kind=>({kind,count:spans.filter(s=>s.kind===kind).length})).filter(f=>f.count>0);

export function scanText(text:string,opts:Pick<MaskOptions,'allow'>={}):PiiFinding[]{return countKinds(detect(normalize(text).text,opts.allow))}

// 탐지 구간을 자리표시로 바꾼다. 탐지가 없으면 같은 문자열을 그대로 돌려준다.
export function maskText(text:string,opts:MaskOptions={}):{text:string;findings:PiiFinding[]}{
 const n=normalize(text),spans=detect(n.text,opts.allow);
 if(!spans.length)return {text,findings:[]};
 const findings=countKinds(spans);
 if(opts.failClosed)throw new PiiBlockedError(findings.map(f=>({field:'text',...f})));
 let out='',cursor=0;
 for(const s of spans){const from=n.start[s.start],to=n.end[s.end-1];out+=text.slice(cursor,from)+PII_PLACEHOLDER[s.kind];cursor=to}
 return {text:out+text.slice(cursor),findings};
}

export function mergeFindings(...lists:readonly (readonly PiiFieldFinding[])[]):PiiFieldFinding[]{
 const total=new Map<string,PiiFieldFinding>();
 for(const f of lists.flat()){const key=f.field+'\u0000'+f.kind,had=total.get(key);total.set(key,{field:f.field,kind:f.kind,count:(had?.count??0)+f.count})}
 return [...total.values()];
}

// 필드 경로의 키 이름에 값이 섞이지 않게 한다(경로는 코드 상수와 고정 스키마 키만 쓴다).
const pathKey=(key:string)=>/^[A-Za-z0-9_]{1,40}$/.test(key)?key:'?';
const join=(field:string,key:string)=>field?`${field}.${key}`:key;
const isRecord=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
function maskAt(value:unknown,segments:readonly string[],field:string,opts:MaskOptions,out:PiiFieldFinding[]):unknown{
 if(!segments.length){
  if(typeof value!=='string')return value;
  const r=maskText(value,{allow:opts.allow});
  out.push(...r.findings.map(f=>({field,...f})));
  return r.text;
 }
 const [head,...rest]=segments;
 if(head==='*'){
  if(Array.isArray(value))return value.map((v,i)=>maskAt(v,rest,join(field,String(i)),opts,out));
  if(isRecord(value))return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,maskAt(v,rest,join(field,pathKey(k)),opts,out)]));
  return value;
 }
 if(!isRecord(value)||!Object.hasOwn(value,head))return value;
 return {...value,[head]:maskAt(value[head],rest,join(field,pathKey(head)),opts,out)};
}
// 경로('a.b', 배열·고정 키 객체는 '*')의 문자열 값만 가린 새 객체를 돌려준다. 없는 경로는 만들지 않고 키 순서를 지킨다(탐지 0이면 JSON 직렬화가 같다).
export function maskFields<T>(obj:T,fieldPaths:readonly string[],opts:MaskOptions={}):{value:T;findings:PiiFieldFinding[]}{
 const found:PiiFieldFinding[]=[];let value:unknown=obj;
 for(const path of fieldPaths)value=maskAt(value,path.split('.'),'',opts,found);
 const findings=mergeFindings(found);
 if(opts.failClosed&&findings.length)throw new PiiBlockedError(findings);
 return {value:value as T,findings};
}

// 허용 목록용: 사업장 기록(지점 레코드 등)에 적힌 전화번호·이메일 원문. 로그·이벤트에 쓰지 않는다.
export function contactAllowValues(texts:readonly unknown[]):string[]{
 const values:string[]=[];
 for(const t of texts){
  if(typeof t!=='string')continue;
  const n=normalize(t);
  for(const s of detect(n.text))if(s.kind==='phone'||s.kind==='email')values.push(t.slice(n.start[s.start],n.end[s.end-1]));
 }
 return [...new Set(values)];
}
