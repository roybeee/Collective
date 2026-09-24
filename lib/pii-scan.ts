// 전송 전 개인정보 패턴 검사·가림(docs/DATA-PROCESSING.ko.md DP-3·DP-4, 레인 A 입력 최소화). 순수 모듈: import가 없고 서버·네트워크에 의존하지 않는다.
// 결과는 종류·건수(maskFields는 필드 경로 포함)뿐이다. 탐지한 값은 돌려주지도, 오류 문구에 싣지도 않는다(DP-4). 예외: contactAllowValues는 허용 목록을 만들 때만 쓴다.
// 정규화: 글자마다 NFKC(전각 숫자·기호)를 적용하고 여러 대시와 가운뎃점류(· ‧ • ∙ ㆍ ・ ㅡ)를 '-'로, 폭 없는 문자를 없는 것으로 본다. 원문 위치를 기억해 가린 부분 밖의 원문은 바꾸지 않는다.
// 한계는 docs/INPUT-MINIMIZATION.ko.md '알려진 한계'에 적는다(사람 이름·민감정보·짧은 도로명·대표번호 등은 패턴으로 잡지 않는다).
export type PiiKind='phone'|'email'|'address'|'payment'|'national_id'|'customer_id';
export type PiiFinding={kind:PiiKind;count:number};
export type PiiFieldFinding={field:string;kind:PiiKind;count:number};
// allow: 원문과 정확히 같은(정규화 후) 부분, 또는 허용 값 안에서 탐지되는 조각(도로명+건물번호, 전화번호 등)과 같은 탐지는 가리지 않는다(확정 사실·지점 주소·사업장 전화). 4자 미만 항목은 무시한다.
//  가리지 않은 탐지는 findings가 아니라 allowed에 종류·건수로 따로 센다(값 없음).
// failClosed: 탐지되면 가리지 않고 PiiBlockedError를 던진다(B3-2 Reflector 전용 전송 차단). 오류에는 필드·종류·건수만 있다. 허용 값은 막지 않는다.
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
// \uAD6C\uBD84\uC790\uB85C \uC4F0\uB294 \uAC00\uC6B4\uB383\uC810\uB958\uC640 \uD55C\uAE00 '\u3161'\uB294 NFKC\uAC00 \uB2E4\uB978 \uAE00\uC790\uB85C \uBC14\uAFB8\uAE30 \uC804\uC5D0 '-'\uB85C \uBCF8\uB2E4.
const DASH=/^[\u2010-\u2015\u2212\uFE58\uFE63\uFF0D\u00B7\u2022\u2027\u2219\u318D\u30FB\uFF65\u3161]$/,INVISIBLE=/^[\u00AD\u200B-\u200D\u2060\uFEFF]$/;
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
// afterAddress: 앞선 주소 탐지(도로명·지번) 바로 뒤(쉼표·층 표기만 사이에 둠)에 올 때만 탐지한다.
type Detector={kind:PiiKind;pattern:RegExp;accept?:(m:RegExpMatchArray)=>boolean;afterAddress?:true};
// 전화 구분자: 없음, 공백 1~2개, '-'·'.'(앞뒤 공백 0~2개), 붙여 쓴 '/'. 반복 상한이 있어 되추적이 커지지 않는다. 국가번호는 '+82'·'(+82)'·'82'.
const SP='[ \\t]',SEP=`(?:${SP}{0,2}[-.]${SP}{0,2}|/|${SP}{1,2})?`;
const CC=`(?:\\(?(?:\\+ ?)?82\\)?${SEP}(?:\\(0\\)|0)?|\\(?0)`;
const BIRTH='\\d{2} ?(?:0[1-9]|1[0-2]) ?(?:0[1-9]|[12]\\d|3[01])',BIRTH6='\\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\\d|3[01])';
// 카드 묶음 구분자: 공백 1~2개 또는 '-'·'.'(앞뒤 공백 0~2개). 같은 구분자를 되풀이한 묶음만 카드로 본다.
const CARD_SEP=`(${SP}{1,2}|${SP}{0,2}[-.]${SP}{0,2})`;
// 계좌 앞말: 은행명(…은행·…뱅크·농협·주요 은행 약칭)이나 '계좌(번호)'('입금계좌' 포함).
const BANK='(?<![가-힣A-Za-z])(?:[가-힣A-Za-z]{0,10}(?:은행|뱅크)|농협|신협|새마을금고|우체국|IBK|KB|신한|국민|우리|하나|수협|씨티|SC제일)';
const DATE=/(?:19|20)\d{2}[-.](?:0?[1-9]|1[0-2])[-.](?:0?[1-9]|[12]\d|3[01])(?!\d)/;
// 도로명·지번 뒤에 오는 수량 단위·천 단위 쉼표·소수점·비율(1:1): 수량 표현(무료로 100개, 추가로 2 종, 기존대로 8,000자)을 주소로 보지 않는다.
const COUNTER='(?![0-9A-Za-z가-힣%])(?![.,:/]\\d)(?!\\s?(?:개월|시간|단계|가지|종류|개|명|회|원|배|번|건|일|주|분|초|위|등|종|곳|장|잔|세|년|월|차|권|편|점|코스|구간|이상|이하|미만|초과)(?![가-힣]))';
// 조사 '(으)로'·흔한 명사·채널 이름·가격 명사를 도로명·동네 이름으로 보지 않는다.
const NOT_ROAD=/(?:으|[율률수배량액비회개명건분초순등])$|^(?:추가|무료|별도|실제|정도|최대|최소|기본|필수|단독|우선|순서|스스|곧바|대체|절대|정말)$|^(?:기존|예정|계획|원래|지금|마음|멋|그|이|저|요청|지시|약속|생각|뜻|말|규칙|원칙|기준|평소|사실|제|합의|결정|안내|권장|설명|브리프|가이드|매뉴얼|레시피|지침|양식|템플릿|시안|일정|초안|기획안)대$|^(?:인스타(?:그램)?|블로그|유튜브|틱톡|페이스북|스레드|트위터|릴스|쇼츠|쿠팡(?:이츠)?|요기요|배민|배달의민족|땡겨요|당근|네이버|카카오(?:톡)?|카톡|이메일|메일|문자|전화|메시지|링크|(?:할인|판매|소비자|공급|정|원|단|특)가)$/;
const NOT_PLACE=new Set(['행동','활동','이동','운동','변동','연동','자동','공동','작동','감동','노동','진동','가동','수동','출동','충동','파동','발동','능동','관리','처리','거리','요리','조리','소리','자리','정리','분리','수리','원리','심리','논리','대리','편리','무리','우리','유리','머리','다리','도리','경리','교리','합리','실리','의리','진리']);
// 나열(인스타로 60 / 블로그로 40, 피드 2, 스토리 3): 부번·번지 없는 'X로 N'·'X동 N'의 앞이나 뒤에 '이름 + 숫자' 항목이 ','·'/'·'|'·'-'(가운뎃점)로 이어지면 주소로 보지 않는다.
const ITEM='[가-힣A-Za-z]{1,12}[ \\t]?\\d{1,5}(?:[.,]\\d+)?%?';
const LIST_AFTER=new RegExp(`^[ \\t]*[,/|-][ \\t]*${ITEM}(?![0-9A-Za-z가-힣]|[-./:]\\d)`),LIST_BEFORE=new RegExp(`${ITEM}[ \\t]*[,/|-][ \\t]*$`);
function inList(m:RegExpMatchArray){const s=m.index!,e=s+m[0].length,t=m.input||'';return LIST_AFTER.test(t.slice(e,e+40))||LIST_BEFORE.test(t.slice(Math.max(0,s-40),s))}
// '…리 + 숫자'는 부번·번지가 있거나 읍·면 바로 뒤일 때만 지번이다(카테고리 1, 배터리 5000, 갤러리 3은 아니다).
function acceptPlace(m:RegExpMatchArray){
 const {place,sub,bunji}=m.groups!,strong=!!sub||!!bunji;
 if(NOT_PLACE.has(place))return false;
 if(place.endsWith('리')&&!strong&&!/(?:읍|면)[ \t]*$/.test((m.input||'').slice(Math.max(0,m.index!-12),m.index!)))return false;
 return strong||!inList(m);
}
function luhn(s:string){const d=s.replace(/\D/g,'');let sum=0;for(let i=0;i<d.length;i++){let x=Number(d[d.length-1-i]);if(i%2){x*=2;if(x>9)x-=9}sum+=x}return sum%10===0}
const digits=(s:string)=>s.replace(/\D/g,'').length;
const DETECTORS:readonly Detector[]=[
 {kind:'customer_id',pattern:/(?<![0-9A-Fa-f])[0-9A-Fa-f]{64}(?![0-9A-Fa-f])/g},
 {kind:'email',pattern:/(?<![A-Za-z0-9._%+-])[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}(?![A-Za-z0-9-])/g},
 // 주민등록·외국인등록(생년월일 6자리 + 성별 1~8 + 6자리, 구분자 '-'·'.'·공백, 생년월일 사이 공백 허용), 운전면허(2-2-6-2), 여권 후보(영문 1자 + 8자리, 신형 3자리+영문+4자리).
 {kind:'national_id',pattern:new RegExp(`(?<!\\d)${BIRTH}(?:${SP}{0,2}[-.]${SP}{0,2}|${SP})[1-8]\\d{6}(?!\\d)|(?<!\\d)${BIRTH6}[1-8]\\d{6}(?!\\d)`,'g')},
 {kind:'national_id',pattern:/(?<!\d)\d{2}[ -]\d{2}[ -]\d{6}[ -]\d{2}(?!\d)/g},
 {kind:'national_id',pattern:/(?<![A-Za-z0-9])[MSRGDmsrgd](?:\d{8}|\d{3}[A-Za-z]\d{4})(?![A-Za-z0-9])/g},
 // 휴대폰(lib/order-import.ts PHONE의 상위 집합)·지역번호·인터넷전화 070·안심번호 050x·수신자부담 080. 괄호 지역번호 허용.
 {kind:'phone',pattern:new RegExp(`(?<!\\d)${CC}(?:1[016789]|2|[3-6][1-5]|70|80|50[2-8])\\)?${SEP}\\d{3,4}${SEP}\\d{4}(?!\\d)`,'g')},
 // 계좌: 은행명·'계좌' 뒤의 숫자 10~16자리(이어 쓰기 또는 묶음). 날짜가 든 묶음(우체국 2026-09-24 14시)은 뺀다. 카드보다 먼저 봐서 은행명까지 한 번에 가린다.
 {kind:'payment',pattern:new RegExp(`(?:${BANK}(?:\\s*계좌(?:번호)?)?|계좌(?:번호)?)\\s*[:：]?\\s*(?<!\\d)(?<num>\\d{10,16}|\\d{2,6}(?:(?:${SP}?-${SP}?|[ .])\\d{1,8}){1,4})(?!\\d)`,'g'),accept:m=>{const num=m.groups!.num,n=digits(num);return n>=10&&n<=16&&!DATE.test(num)}},
 // 카드번호: 구분자 없는 13~19자리(lib/order-import.ts CARD와 같다), 또는 같은 구분자를 되풀이한 카드 묶음(4-4-4-1~7, 4-4-4-4-1~3, 4-6-4~5)이면서 Luhn 검사를 통과하는 것.
 // 날짜 목록(2026-09-24 2026-10-05)·수치 나열(120 135 150 180 210)은 카드 묶음이 아니다.
 {kind:'payment',pattern:new RegExp(`(?<!\\d)(?:\\d{13,19}|\\d{4}${CARD_SEP}\\d{4}\\1\\d{4}\\1(?:\\d{4}\\1\\d{1,3}|\\d{1,7})|\\d{4}${CARD_SEP}\\d{6}\\2\\d{4,5})(?!\\d)`,'g'),accept:m=>m[1]===undefined&&m[2]===undefined||luhn(m[0])},
 // 동·호수: '101동 1203호'·'B동 201호', 단독 '101동'. 노선(2호선)·지점(3호점)은 뺀다(lib/brief.ts unitPatterns 참고).
 {kind:'address',pattern:/(?<![가-힣A-Za-z0-9])(?:[A-Za-z]|\d{1,4}|[가나다라마바사]) ?동 ?\d{1,5} ?호(?![선점차기가-힣])|(?<![가-힣A-Za-z0-9])\d{2,4}동(?![가-힣])/g},
 // 단독 호수(3자리 이상)는 주거 건물(아파트·빌라·오피스텔 등) 바로 뒤에서만 본다. 몰 입점 호수(C107호)·가맹 호수(100호 매장)·발행 호수(102호)·인허가 번호(제2024-123호)는 주소가 아니다.
 {kind:'address',pattern:/(?<=(?:아파트|빌라|오피스텔|맨션|연립|주택|원룸|고시원|기숙사|레지던스)[ \t]?,?[ \t]?)\d{3,5} ?호(?![선점차기가-힣])/g},
 // 도로명: 두 글자 이상 이름 + 로/길(+ '12번길'), 건물번호(-부번).
 {kind:'address',pattern:new RegExp(`(?<![가-힣A-Za-z0-9])(?<road>[가-힣]{2,12})(?:로|길)(?: ?\\d{1,4}번?(?:길|가길))? ?\\d{1,4}(?<sub>-\\d{1,4})?${COUNTER}`,'g'),accept:m=>!NOT_ROAD.test(m.groups!.road)&&(!!m.groups!.sub||!inList(m))},
 // 지번: 동·리 이름(이문2동 포함) + 번지(-부번, '번지').
 {kind:'address',pattern:new RegExp(`(?<![가-힣A-Za-z0-9])(?<place>[가-힣]{1,10}\\d{0,2}(?:동|리)) ?\\d{1,5}(?<sub>-\\d{1,5})?(?<bunji> ?번지)?${COUNTER}`,'g'),accept:acceptPlace},
 // 도로명·지번 바로 뒤의 호수('가상로 12, 301호', '가상동 123-4 3층 301호').
 {kind:'address',pattern:/(?<![A-Za-z0-9-])\d{3,5} ?호(?![선점차기가-힣])/g,afterAddress:true},
];
const UNIT_GAP=/^,?[ \t]{0,2}(?:(?:지하[ \t]?)?\d{1,3}층[ \t]?)?$/;

type Span={start:number;end:number;kind:PiiKind;allowed:boolean};
// 기술 식별자(32자 이상 16진·UUID: 커밋 SHA, 작업물 id 등) 안의 숫자열은 전화·카드 등으로 보지 않는다. 64자리 16진은 고객 식별자로 먼저 잡힌다.
const TECH_ID=/(?<![0-9A-Za-z])(?:[0-9A-Fa-f]{32,}|[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12})(?![0-9A-Za-z])/g;
const techRanges=(text:string)=>[...text.matchAll(TECH_ID)].map(m=>[m.index!,m.index!+m[0].length] as [number,number]);
const inside=(ranges:readonly [number,number][],start:number,end:number)=>ranges.some(([a,b])=>a<=start&&end<=b);
// 허용 목록: 정규화한 허용 값(texts)과, 허용 값 안에서 탐지되는 조각의 비교 키(parts). 조각 키는 전화면 숫자(+82는 0으로), 그 밖은 공백·쉼표를 뺀 문자열이다.
type Allow={texts:string[];parts:Set<string>};
const NO_ALLOW:Allow={texts:[],parts:new Set()};
const phoneDigits=(s:string)=>{const d=s.replace(/\D/g,'');return /^\D*82/.test(s)?'0'+d.slice(2).replace(/^0/,''):d};
const partKey=(kind:PiiKind,s:string)=>kind+':'+(kind==='phone'?phoneDigits(s):s.replace(/[\s,]/g,'').toLowerCase());
function prepareAllow(allow:readonly unknown[]=[]):Allow{
 const texts=[...new Set(allow.filter((v):v is string=>typeof v==='string').map(v=>normalize(v.trim()).text).filter(v=>v.length>=MIN_ALLOW_LENGTH))];
 const parts=texts.flatMap(v=>detect(v,NO_ALLOW).map(s=>({kind:s.kind,part:v.slice(s.start,s.end)}))).filter(x=>x.part.length>=MIN_ALLOW_LENGTH);
 return {texts,parts:new Set(parts.map(x=>partKey(x.kind,x.part)))};
}
const occurrences=(text:string,a:string)=>{const out:[number,number][]=[];for(let i=text.indexOf(a);i>=0;i=text.indexOf(a,i+1))out.push([i,i+a.length]);return out};
// 정규화 본문에서 탐지 구간을 찾는다. 허용 값에 완전히 들어가거나 허용 조각과 같은 탐지는 allowed로 표시하고, 걸치기만 하면 가린다.
function detect(text:string,allow:Allow):Span[]{
 const safe=allow.texts.flatMap(a=>occurrences(text,a)),tech=techRanges(text),taken:Span[]=[];
 for(const d of DETECTORS)for(const m of text.matchAll(d.pattern)){
  const start=m.index!,end=start+m[0].length;
  if(d.accept&&!d.accept(m)||d.kind!=='customer_id'&&inside(tech,start,end)||taken.some(t=>start<t.end&&t.start<end))continue;
  if(d.afterAddress&&!taken.some(t=>t.kind==='address'&&t.end<=start&&UNIT_GAP.test(text.slice(t.end,start))))continue;
  taken.push({start,end,kind:d.kind,allowed:inside(safe,start,end)||allow.parts.has(partKey(d.kind,m[0]))});
 }
 return taken.sort((a,b)=>a.start-b.start);
}
const countKinds=(spans:readonly Span[]):PiiFinding[]=>PII_KINDS.map(kind=>({kind,count:spans.filter(s=>s.kind===kind).length})).filter(f=>f.count>0);

// 허용 값이라 가리지 않은 탐지는 세지 않는다(가린 것만 센다).
export function scanText(text:string,opts:Pick<MaskOptions,'allow'>={}):PiiFinding[]{return countKinds(detect(normalize(text).text,prepareAllow(opts.allow)).filter(s=>!s.allowed))}

type Masked={text:string;findings:PiiFinding[];allowed:PiiFinding[]};
function maskWith(text:string,allow:Allow,failClosed?:boolean):Masked{
 const n=normalize(text),spans=detect(n.text,allow),hidden=spans.filter(s=>!s.allowed),findings=countKinds(hidden),allowed=countKinds(spans.filter(s=>s.allowed));
 if(!hidden.length)return {text,findings,allowed};
 if(failClosed)throw new PiiBlockedError(findings.map(f=>({field:'text',...f})));
 let out='',cursor=0;
 for(const s of hidden){const from=n.start[s.start],to=n.end[s.end-1];out+=text.slice(cursor,from)+PII_PLACEHOLDER[s.kind];cursor=to}
 return {text:out+text.slice(cursor),findings,allowed};
}
// 탐지 구간을 자리표시로 바꾼다. 가릴 탐지가 없으면 같은 문자열을 그대로 돌려준다. allowed: 허용 값이라 가리지 않은 탐지의 종류·건수.
export function maskText(text:string,opts:MaskOptions={}):Masked{return maskWith(text,prepareAllow(opts.allow),opts.failClosed)}

export function mergeFindings(...lists:readonly (readonly PiiFieldFinding[])[]):PiiFieldFinding[]{
 const total=new Map<string,PiiFieldFinding>();
 for(const f of lists.flat()){const key=f.field+'\u0000'+f.kind,had=total.get(key);total.set(key,{field:f.field,kind:f.kind,count:(had?.count??0)+f.count})}
 return [...total.values()];
}

// 필드 경로의 키 이름에 값이 섞이지 않게 한다(경로는 코드 상수와 고정 스키마 키만 쓴다).
const pathKey=(key:string)=>/^[A-Za-z0-9_]{1,40}$/.test(key)?key:'?';
const join=(field:string,key:string)=>field?`${field}.${key}`:key;
const isRecord=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
// found: 가린 탐지, kept: 허용 값이라 가리지 않은 탐지(필드 경로·종류·건수).
type FieldOut={found:PiiFieldFinding[];kept:PiiFieldFinding[]};
function maskAt(value:unknown,segments:readonly string[],field:string,allow:Allow,out:FieldOut):unknown{
 if(!segments.length){
  if(typeof value!=='string')return value;
  const r=maskWith(value,allow);
  out.found.push(...r.findings.map(f=>({field,...f})));out.kept.push(...r.allowed.map(f=>({field,...f})));
  return r.text;
 }
 const [head,...rest]=segments;
 if(head==='*'){
  if(Array.isArray(value))return value.map((v,i)=>maskAt(v,rest,join(field,String(i)),allow,out));
  if(isRecord(value))return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,maskAt(v,rest,join(field,pathKey(k)),allow,out)]));
  return value;
 }
 if(!isRecord(value)||!Object.hasOwn(value,head))return value;
 return {...value,[head]:maskAt(value[head],rest,join(field,pathKey(head)),allow,out)};
}
// 경로('a.b', 배열·고정 키 객체는 '*')의 문자열 값만 가린 새 객체를 돌려준다. 없는 경로는 만들지 않고 키 순서를 지킨다(가릴 탐지 0이면 JSON 직렬화가 같다).
// allowed: 허용 값이라 가리지 않은 탐지의 필드·종류·건수(값 없음).
export function maskFields<T>(obj:T,fieldPaths:readonly string[],opts:MaskOptions={}):{value:T;findings:PiiFieldFinding[];allowed:PiiFieldFinding[]}{
 const out:FieldOut={found:[],kept:[]},allow=prepareAllow(opts.allow);let value:unknown=obj;
 for(const path of fieldPaths)value=maskAt(value,path.split('.'),'',allow,out);
 const findings=mergeFindings(out.found);
 if(opts.failClosed&&findings.length)throw new PiiBlockedError(findings);
 return {value:value as T,findings,allowed:mergeFindings(out.kept)};
}

// 허용 목록용: 지점 기록의 연락 동선(access 등)에 적힌 유선·대표 전화번호 원문. 휴대폰 대역(010·011·016~019)과 이메일은
// 사업장 값인지 알 수 없어 돌려주지 않는다(사업장 휴대폰·이메일은 확정 사실로 등록한다). 로그·이벤트에 쓰지 않는다.
export function contactAllowValues(texts:readonly unknown[]):string[]{
 const values:string[]=[];
 for(const t of texts){
  if(typeof t!=='string')continue;
  const n=normalize(t);
  for(const s of detect(n.text,NO_ALLOW))if(s.kind==='phone'&&!phoneDigits(n.text.slice(s.start,s.end)).startsWith('01'))values.push(t.slice(n.start[s.start],n.end[s.end-1]));
 }
 return [...new Set(values)];
}
