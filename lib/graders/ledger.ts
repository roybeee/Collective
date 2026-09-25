import {claimGuard} from '../campaign-policy';
import {verdict,outputObject,proseValues,briefPlanValues,type Grader,type EvalItem,type GradeContext} from './types';
import {isText,bodyOf,sentences,compact,excerpt,blocks} from './text';
import {mentions,usesTerm,negatedAt,neutralize} from './negation';
import {outsideProhibition,withoutBannedLists} from './prohibition';
import {FR_CONTEXT,FR_EDU_LABEL,FR_ROYALTY_FORM,FR_ROYALTY_LABEL,FR_STARTUP_AMOUNT_FIRST,FR_STARTUP_LABEL,FR_STORE_COUNT} from './compliance-lexicon';

// 사실 원장 대조(fact_conflict)와 미확정 구체 값 단정(unconfirmed_value_assertion). 원장이 없으면 둘 다 not_applicable이다.
const factText=(v:unknown)=>typeof v==='string'?v:'';
const hitsVerdict=(hits:string[])=>hits.length?verdict('fail',[...new Set(hits)]):verdict('pass');
// 동 이름 길이에 상한을 둬 긴 한글 연속 입력에서도 선형 시간에 끝난다.
const ADDRESS=/[가-힣]{1,12}동\s?\d+(?:-\d+)?[^\n]{0,8}?[A-Z]동\s?\d+\s?호/g;
// 판매가가 아닌 금액(예산·비용·객단가·매출 목표 등)이 있는 문장은 가격으로 보지 않는다.
const NON_PRICE=/예산|비용|한도|객단가|매출|목표|광고비|제작비|촬영비|수수료|인건비|임대료|월세|보증금|원가|마진|이익|손익|투자|지원금|배송비|최소\s?주문|이상\s?주문|결제\s?금액|판매액|상금/;
const num=(s:string)=>Number(s.replace(/,/g,''));
export const amounts=(s:string)=>[...s.matchAll(/(\d{1,3}(?:,\d{3})+|\d{4,})\s?원|(\d+(?:\.\d+)?)\s?만\s?원/g)].map(m=>String(m[1]?num(m[1]):Math.round(num(m[2])*10000)));
// 가맹 금액(트랙 R): '870만원'→8700000, '5천만원'→50000000, '1억 2천만원'·'1억 2,000만원'→120000000, '1.2억'→120000000, '5,500,000원'→5500000. 채점기(valueChecks·unconfirmedValueAssertion)는 가맹 종류를 쓰지 않는다.
// 범위('4,000~5,000만원', '3-4만원')는 앞 수에 뒤 단위를 붙여 두 값으로 읽는다(아래 값만 틀린 범위를 놓치지 않는다).
const KRW=/(\d[\d,]*(?:\.\d+)?)\s?억(?:\s?(\d[\d,]*(?:\.\d+)?)\s?(천)?\s?만)?(?:\s?원)?|(\d[\d,]*(?:\.\d+)?)\s?(천)?\s?만\s?원|(\d[\d,]*(?:\.\d+)?)\s?천\s?원|(\d[\d,]*)\s?원/g;
const krwOf=(m:RegExpMatchArray)=>m[1]!==undefined?num(m[1])*1e8+(m[2]!==undefined?num(m[2])*(m[3]?1e7:1e4):0):m[4]!==undefined?num(m[4])*(m[5]?1e7:1e4):m[6]!==undefined?num(m[6])*1e3:num(m[7]);
const BARE_LOWER=/(\d[\d,]*(?:\.\d+)?)(\s?[~∼〜～–-]\s?)(?=\d[\d,]*(?:\.\d+)?\s?(억|천\s?만|만|천)?\s?원)/g;
// 아래 값에 단위만 있고 '원'이 없는 범위('4,500만~5,500만원', '1억~1억 2천만원')도 두 값이다.
const UNIT_LOWER=/(\d[\d,]*(?:\.\d+)?\s?(?:억|천\s?만|만|천))(\s?[~∼〜～–-]\s?)(?=\d[\d,]*(?:\.\d+)?\s?(?:억|천\s?만|만|천)?[^\n~∼〜～–-]{0,8}?원)/g;
const withLowerUnit=(s:string)=>s.replace(UNIT_LOWER,'$1원$2').replace(BARE_LOWER,(_m,a:string,sep:string,unit:string|undefined)=>`${a}${unit??''}원${sep}`);
export const krwAmounts=(s:string)=>[...withLowerUnit(s).matchAll(KRW)].map(m=>String(Math.round(krwOf(m))));
const monthDay=(m:string,d:string)=>`${Number(m)}-${Number(d)}`;
export const dates=(s:string)=>[...s.matchAll(/(\d{1,2})월\s?(\d{1,2})일|\d{4}[-./](\d{1,2})[-./](\d{1,2})/g)].map(m=>m[1]?monthDay(m[1],m[2]):monthDay(m[3],m[4]));
const OPEN_DATE=/오픈(?:일)?\s?(?:은|는|:)?\s?\d{1,2}월\s?\d{1,2}일|\d{1,2}월\s?\d{1,2}일\s?(?:에\s?)?(?:오픈|개업|개점)|\d{4}[-.]\d{1,2}[-.]\d{1,2}\s?(?:오픈|개업|개점)/g;
const minutes=(s:string)=>[...s.matchAll(/(\d+)\s?분/g)].map(m=>String(Number(m[1])));
const counts=(s:string)=>[...s.matchAll(/(\d[\d,]*(?:\.\d+)?)\s?(만|천)?/g)].map(m=>String(Math.round(num(m[1])*(m[2]==='만'?10000:m[2]==='천'?1000:1))));
// 매장 수 주장(트랙 R R2): 규제 사전의 매장 수 정규식(FR_STORE_COUNT)과 같은 문장을 본다. 수, 가리키는 매장(가맹점·직영점·전체), 비교 방식을 함께 돌려준다.
// '가맹점·가맹 매장 N개'는 가맹점 수, '직영점·직영 매장 N개'는 직영점 수, '매장·점포·지점·N호점·전국 N개'와 '가맹점과 직영점 합계 N개'는 전체 매장 수와 대조한다. '오픈 예정 N개'는 원장 항목이 없어 값을 내지 않는다.
// 비교 방식: 'N여 개'는 N 이상·다음 자릿수 단위 미만(approx: '40여 개'는 40~49, '1,200여 개'는 1,200~1,299), 'N개 이상·넘는·넘은·N+·N호점 돌파·달성·시대'는 N 이상(gte), 나머지('N호점 눈앞·임박' 포함)는 같은 값(eq). '전국 100여 매장'처럼 개·곳 없이 매장 명사가 바로 붙은 수도 센다.
// '2호점 오픈 기념'·'한정 12개'·'전국 5개 매장에서 한정 판매'는 매장 수 주장이 아니다. '오픈 대기 N곳'은 '오픈 예정'과 같다. '1년 만에 50호점'은 50호점이다.
export type StoreCountClaim={n:string;of:'franchise'|'direct'|'total';cmp:'eq'|'gte'|'approx'};
const STORE_COUNT=new RegExp(FR_STORE_COUNT,'g');
export const storeCountClaimList=(s:string):StoreCountClaim[]=>[...s.matchAll(STORE_COUNT)].flatMap(m=>{
 const t=m[0];
 if(/^오픈\s?(?:예정|대기)/.test(t))return [];
 // '가맹점 수 벌써 120'처럼 '수' 라벨 뒤 단위 없는 수는 마지막 수를 쓴다.
 const n=/\d[\d,]*(?=\s?(?:여\s?)?(?:개|곳|호점|\+|매장|점포|가맹점|직영점|지점|가맹\s?(?:매장|점포)|직영\s?(?:매장|점포)))/.exec(t)??(/수/.test(t)?/\d[\d,]*(?![\d,])(?!.*\d)/.exec(t):null);
 if(!n)return [];
 const of:StoreCountClaim['of']=/호점/.test(t)||/직영/.test(t)&&/가맹/.test(t)?'total':/직영/.test(t)?'direct':/가맹/.test(t)?'franchise':'total';
 const cmp:StoreCountClaim['cmp']=/\d\s?여/.test(t)?'approx':/이상|넘|초과|\+|돌파|달성|시대/.test(t)||/호점/.test(t)&&!/눈앞|임박/.test(t)?'gte':'eq';
 return [{n:String(num(n[0])),of,cmp}];
});
// 주장 값 n이 확정 값 v를 참으로 말하는가(비교 방식별).
export function storeCountHolds(c:Pick<StoreCountClaim,'n'|'cmp'>,v:string):boolean{
 const n=Number(c.n),x=Number(v);
 if(c.cmp==='eq')return n===x;
 if(c.cmp==='gte')return x>=n;
 const zeros=(String(n).match(/0+$/)?.[0].length??0),step=10**Math.max(1,zeros);
 return x>=n&&x<n+step;
}
export const storeCountClaims=(s:string)=>storeCountClaimList(s).map(c=>c.n);
const firstInteger=(v:string)=>{const m=/\d[\d,]*/.exec(v);return m?[String(num(m[0]))]:[]};
// 가맹 비용 라벨 뒤 금액: 라벨 뒤 20자 안의 첫 금액부터, 끊는 기호(쉼표·마침표·줄바꿈·괄호·가운뎃점·빗금·등호·더하기·세미콜론·띄운 줄표) 또는 다음 비용 라벨 전까지.
// '가맹비 870만원, 교육비 550만원'·'가맹비 550만원 · 교육비 220만원'·'창업비용 6,500만원(가맹비 550만원 …)'에서 가맹비·창업비용은 첫 금액만이다. 숫자 사이 쉼표·소수점은 끊지 않고, 범위('4,000~5,000만원')는 두 값이다.
// 소비자 문장과 겹치는 낱말은 가맹 문맥만 본다('베이킹 클래스 교육비', '로열티 카드', '일회용컵 보증금', '멤버십 가입비'는 가맹 비용이 아니다).
// shared: 교육비·로열티·인테리어 비는 같은 문장에 가맹 문맥(규제 사전 FR_CONTEXT)이 있거나(모집 범위는 문맥이 이미 있다: context) 라벨 뒤 금액이 100만원 이상일 때만 값을 낸다
// (로열티는 월 정액·매출 비율 형식도 가맹 비용). 우리 매장에 들인 금액('인테리어 비용 1억 원 들인 리뉴얼')은 100만원 이상이어도 가맹 비용이 아니다.
const COST_CUT=/[\n.。](?!\d)|[,，](?!\d)|[(（)）·ㆍ/=+|;；→]|\s[-–—]\s/,FRANCHISE_CONTEXT=new RegExp(FR_CONTEXT),ROYALTY_FORM=new RegExp('^'+FR_ROYALTY_FORM);
const COST_LABEL=new RegExp(`${FR_STARTUP_LABEL}|가맹비|가맹\\s?가입비|(?:가맹|계약\\s?이행)\\s?보증금|${FR_EDU_LABEL}|${FR_ROYALTY_LABEL}|인테리어\\s?(?:비|비용|공사비)|주방\\s?설비|임차\\s?보증금|권리금`);
const SPENT=/^[^.\n]{0,20}?(?:들인|들여|들였|투자한|투자해|쏟|썼|사용한)/;
export type CostBodyOptions={context?:boolean};
function segmentAfter(s:string,from:number):{seg:string;at:number}|null{
 const rest=s.slice(from,from+60),digit=rest.search(/\d/);
 if(digit<0||digit>20)return null;
 const lead=rest.slice(0,digit);
 if(/[\n.。]/.test(lead.replace(/\.(?=\d)/g,''))||COST_LABEL.test(lead))return null;
 let seg=rest.slice(digit);
 const cut=seg.search(COST_CUT),label=seg.search(COST_LABEL);
 const end=Math.min(cut<0?seg.length:cut,label<0?seg.length:label);
 seg=seg.slice(0,end);
 return {seg,at:from+digit};
}
// 금액 위치(at: 금액 조각이 시작하는 문장 안 위치, seg: 금액 조각). 판정기는 위치로 그 금액의 절·매장 유형·부가세를, 조각으로 3.3㎡당 단가를 본다. 범위의 두 값은 같은 위치다.
export type AmountSpan={v:string;at:number;seg:string};
function amountSpans(label:RegExp,shared=false){
 const g=new RegExp(label.source,'g');
 return (s:string,o:CostBodyOptions={}):AmountSpan[]=>[...s.matchAll(g)].flatMap(m=>{
  const x=segmentAfter(s,m.index!+m[0].length);
  if(!x)return [];
  const values=krwAmounts(x.seg);
  if(shared&&!o.context&&!FRANCHISE_CONTEXT.test(s)&&!ROYALTY_FORM.test(s.slice(m.index!))&&!(values.some(v=>Number(v)>=1_000_000)&&!SPENT.test(s.slice(x.at))))return [];
  return values.map(v=>({v,at:x.at,seg:x.seg}));
 });
}
const values=(f:(s:string,o?:CostBodyOptions)=>AmountSpan[])=>(s:string,o?:CostBodyOptions)=>f(s,o).map(x=>x.v);
export const STARTUP_COST_LABEL=new RegExp(FR_STARTUP_LABEL);
const STARTUP_AMOUNT_FIRST=new RegExp(FR_STARTUP_AMOUNT_FIRST,'g'),startupAfter=amountSpans(STARTUP_COST_LABEL);
// 창업비용: 라벨 뒤 금액과 금액이 먼저 오는 '4,000만원으로 창업 가능'의 금액.
const startupSpans=(s:string,o?:CostBodyOptions):AmountSpan[]=>[...startupAfter(s,o),...[...s.matchAll(STARTUP_AMOUNT_FIRST)].flatMap(m=>krwAmounts(m[0]).slice(0,1).map(v=>({v,at:m.index!,seg:m[0]})))];
const feeSpans=amountSpans(/가맹비|가맹\s?가입비/),eduSpans=amountSpans(new RegExp(FR_EDU_LABEL),true),depositSpans=amountSpans(/(?:가맹|계약\s?이행)\s?보증금/);
const interiorSpans=amountSpans(/인테리어\s?(?:비용|공사비|비(?!포))/,true),royaltySpans=amountSpans(new RegExp(FR_ROYALTY_LABEL),true);
// 원장이 확정할 수 있는 구체 값. body: 본문 문장에서 찾은 값(정규화), ledger: 원장 값에서 찾은 값. 브리프 지시 위반(brief.ts)도 같은 추출을 쓴다.
// franchise: 가맹 모집 값(트랙 R R2). 가맹 규칙 판정기(lib/franchise-compliance.ts)만 쓰고 채점기는 건너뛴다(채점 결과·GRADERS_VERSION 불변). ruleId: 이 값을 대조하는 가맹 규칙.
type ValueKind={kind:string;key:RegExp;body:(s:string,o?:CostBodyOptions)=>string[];spans?:(s:string,o?:CostBodyOptions)=>AmountSpan[];ledger:(v:string)=>string[];franchise?:true;ruleId?:string};
export const VALUE_KINDS:ValueKind[]=[
 {kind:'가격',key:/가격|판매가|price|메뉴/i,body:s=>NON_PRICE.test(s)?[]:amounts(s),ledger:amounts},
 {kind:'오픈일',key:/오픈|개점|개업|open/i,body:s=>[...s.matchAll(OPEN_DATE)].flatMap(m=>dates(m[0])),ledger:dates},
 {kind:'도보 시간',key:/도보|거리|접근/,body:s=>[...s.matchAll(/도보\s?\d+\s?분/g)].flatMap(m=>minutes(m[0])),ledger:minutes},
 {kind:'유동인구',key:/유동|상권/,body:s=>[...s.matchAll(/유동\s?인구[^\n.]{0,10}?\d[\d,]*(?:\.\d+)?\s?(?:만|천)?/g)].flatMap(m=>counts(m[0]).slice(-1)),ledger:counts},
 {kind:'매장 수',key:/^(?:franchise_store_count|direct_store_count)$/,body:storeCountClaims,ledger:firstInteger,franchise:true,ruleId:'kr.fr.store_count_claims'},
 {kind:'창업비용',key:/^startup_cost_total$/,body:values(startupSpans),spans:startupSpans,ledger:krwAmounts,franchise:true,ruleId:'kr.fr.startup_cost_claims'},
 {kind:'가맹비',key:/^franchise_fee$/,body:values(feeSpans),spans:feeSpans,ledger:krwAmounts,franchise:true,ruleId:'kr.fr.startup_cost_claims'},
 {kind:'교육비',key:/^education_fee$/,body:values(eduSpans),spans:eduSpans,ledger:krwAmounts,franchise:true,ruleId:'kr.fr.startup_cost_claims'},
 {kind:'가맹 보증금',key:/^franchise_deposit$/,body:values(depositSpans),spans:depositSpans,ledger:krwAmounts,franchise:true,ruleId:'kr.fr.startup_cost_claims'},
 {kind:'인테리어 비용',key:/^interior_cost$/,body:values(interiorSpans),spans:interiorSpans,ledger:krwAmounts,franchise:true,ruleId:'kr.fr.startup_cost_claims'},
 {kind:'로열티',key:/^royalty_fee$/,body:values(royaltySpans),spans:royaltySpans,ledger:krwAmounts,franchise:true,ruleId:'kr.fr.startup_cost_claims'},
];
// 채점기가 쓰는 값 종류(가맹 종류 제외).
const GRADED_KINDS=VALUE_KINDS.filter(k=>!k.franchise);
// 예시·확인 필요·미확정 표시가 있는 문장은 단정이 아니다.
export const MARKED=/\[[^\]]*(?:확인|예시|실제|확정)[^\]]*\]|확인\s?필요|미확정|자료\s?필요|예시/;
export function confirmedFacts(ctx:GradeContext){
 return (ctx.facts?.confirmed||[]).map(f=>({key:factText(f.key),value:factText(f.value)})).filter(f=>f.value);
}
// 종류별 원장 확정값. 키가 맞아도 값에서 구체 값을 찾지 못하면 확정값이 없는 것으로 본다.
const ledgerValues=(kind:ValueKind,confirmed:{key:string;value:string}[])=>new Set(confirmed.filter(f=>kind.key.test(f.key)).flatMap(f=>kind.ledger(f.value)));
const bodySentences=(text:string)=>text.split('\n').flatMap(sentences);
type Check={hit?:string};

function addressChecks(text:string,confirmed:{key:string;value:string}[]):Check[]{
 const address=confirmed.find(f=>/주소|address/i.test(f.key));
 if(!address)return [];
 return [...text.matchAll(ADDRESS)].map(m=>compact(address.value).includes(compact(m[0]))?{}:{hit:`주소 불일치: ${m[0]}`});
}
function valueChecks(lines:string[],confirmed:{key:string;value:string}[]):Check[]{
 return GRADED_KINDS.flatMap(kind=>{
  const known=ledgerValues(kind,confirmed);
  if(!known.size)return [];
  return lines.filter(s=>!MARKED.test(s)).flatMap(s=>kind.body(s).map(v=>known.has(v)?{}:{hit:`${kind.kind} 불일치: ${excerpt(s)}`}));
 });
}
// 거절값은 문장에 나오면 대조 대상이고, 부정·배제 없이 쓰이면 fail이다.
// allowed: 금지·보류 맥락 밖 문장. 그 안의 언급은 대조는 하되(적용됨) 사용으로 세지 않는다.
// allowed는 거절 사실 언급이 있을 때만 계산한다(대부분의 출력은 언급이 없다).
function rejectedChecks(lines:string[],facts:NonNullable<GradeContext['facts']>,allowed:()=>Set<string>):Check[]{
 const rejected=claimGuard({confirmed:facts.confirmed||[],prohibited:facts.prohibited||[]}).prohibited;
 return rejected.flatMap(t=>lines.filter(s=>mentions(s,t)).map(s=>allowed().has(s)&&usesTerm(s,t)?{hit:`거절 사실 사용: ${excerpt(s)}`}:{}));
}
// 원장에 있는 항목만 대조한다. 원장에 없는 항목은 세지 않고, 대조할 항목이 하나도 없으면 not_applicable(합격률 분모에서 제외).
export const factConflict:Grader={id:'fact_conflict',content:true,grade(item,ctx){
 if(!isText(item))return verdict('not_applicable');
 if(!ctx.facts)return verdict('not_applicable','원장 없음');
 const text=bodyOf(item),lines=bodySentences(text),confirmed=confirmedFacts(ctx);
 // 거절 사실은 금지·보류 맥락(제목·라벨·금지 표 칸·금지 리드 아래 인용 목록) 밖 문장만 본다. 그 안은 쓰지 않을 표현의 목록이다(R3 기준선 S6 실측).
 const checks=[...addressChecks(text,confirmed),...valueChecks(lines,confirmed),...rejectedChecks(lines,ctx.facts,allowedSentences(text))];
 return checks.length?hitsVerdict(checks.flatMap(c=>c.hit?[c.hit]:[])):verdict('not_applicable','원장 항목을 다루지 않음');
}};

// 원장이 확정하지 않은 가격·오픈일·도보 시간·유동인구 수치를 [확인 필요]·[예시]·미확정 표시 없이 단정하면 fail(factPolicy).
// 금지·보류 맥락 밖 문장 집합. 처음 부를 때 한 번만 계산한다.
function allowedSentences(text:string){
 let cached:Set<string>|null=null;
 return ()=>cached??=new Set(outsideProhibition(blocks(withoutBannedLists(text))).filter(b=>!b.isLabel).flatMap(b=>sentences(b.line)));
}
// 문장 속 값(가격·오픈일)의 원문 위치마다 부정·배제를 본다. 하나라도 부정되지 않으면 단정이다.
const VALUE_SPAN=/(\d{1,3}(?:,\d{3})+|\d{4,})\s?원|(\d+(?:\.\d+)?)\s?만\s?원/g;
function assertsValue(s:string){
 const n=neutralize(s),spans=[...n.matchAll(VALUE_SPAN),...n.matchAll(OPEN_DATE)];
 return !spans.length||spans.some(m=>!negatedAt(n,m.index!,m.index!+m[0].length));
}
export const unconfirmedValueAssertion:Grader={id:'unconfirmed_value_assertion',content:true,grade(item,ctx){
 if(!isText(item))return verdict('not_applicable');
 if(!ctx.facts)return verdict('not_applicable','원장 없음');
 const confirmed=confirmedFacts(ctx),open=GRADED_KINDS.filter(k=>!ledgerValues(k,confirmed).size);
 // 금지·보류 맥락 안 값과 부정·배제된 값('금지된 ‘월 순수익 500만 원 보장’ … 표현은 사용하지 않는다')은 단정이 아니다(R3 기준선 S7 실측).
 const text=bodyOf(item),allowed=allowedSentences(text);
 const found=bodySentences(text).flatMap(s=>open.filter(k=>k.body(s).length).map(k=>({kind:k.kind,s})));
 if(!found.length)return verdict('not_applicable','미확정 항목의 구체 값 없음');
 return hitsVerdict(found.filter(x=>!MARKED.test(x.s)&&allowed().has(x.s)&&assertsValue(x.s)).map(x=>`미확정 ${x.kind} 단정: ${excerpt(x.s)}`));
}};

// 미확인 브랜드 소개(brand.brandIntro)를 '확인 사실' 구역에 적으면 fail(원장 구역 규칙, G3. docs/EVAL.ko.md 결정론 불가 유형의 v1.1 후보를 옮겼다).
// 확인 사실 구역: 가장 가까운 라벨(인라인 라벨 우선)이 확인·확정·검증된 사실(사항·정보)이고 미확인·확인 필요·후보·가정·가설·추정이 섞이지 않은 블록, 또는 첫 칸이 그런 라벨인 표 행.
// 구역 문장이 소개문과 공백·문장부호를 뺀 8자(한국어 두세 어절)를 글자 그대로 공유하고 그 조각이 확정 사실 값·브랜드 이름 안에 없으면 소개문을 사실로 옮긴 것이다.
// [확인 필요]·미확인 표시 문장은 면제한다. 소개문을 바꿔 쓴 문장, '소개문에 그렇게 적혀 있다'는 서술과 상품 사실의 구분은 판단하지 않는다(심사 대상).
// 대상: 역할 산출물, 회의 단계(출력 JSON의 사람이 읽는 값), 브리프(렌더본, 없으면 summary·제안 값). 소개문이 없거나 확인 사실 구역이 없으면 not_applicable.
const INTRO_WINDOW=8;
const FACT_ZONE=/(?:확인|확정|검증)(?:된|한)?\s?(?:사실|사항|정보)|^확정$|^사실(?:\s?근거)?$/,NOT_FACT=/미확인|미확정|확인\s?(?:필요|전|대기)|후보|가정|가설|추정|추론|요청/;
const UNVERIFIED=new RegExp(`${MARKED.source}|미확인|(?:검증|확인)\\s?전`);
const plainText=(s:string)=>s.normalize('NFKC').replace(/[\s\p{P}\p{S}]/gu,'').toLowerCase();
const factLabel=(label:string)=>FACT_ZONE.test(label.trim())&&!NOT_FACT.test(label);
function factZoneSentences(text:string){
 return blocks(text).flatMap(b=>{
  if(b.isLabel)return [];
  const cells=b.line.trim().startsWith('|')?b.line.split('|').map(c=>c.trim()).filter(Boolean):[];
  // 표 행은 첫 칸이 라벨이다: 미확인·후보 행은 구역 밖, 확인 사실 행은 나머지 칸이 구역이다.
  if(cells.length>1&&NOT_FACT.test(cells[0]))return [];
  if(cells.length>1&&factLabel(cells[0]))return cells.slice(1);
  return factLabel(b.inline??b.label)?sentences(b.line):[];
 });
}
// 소개문의 8자 조각 가운데 확정 사실 값·브랜드 이름 안에 없는 것.
function introWindows(intro:string,allowed:string[]){
 const p=plainText(intro),allow=allowed.map(plainText).filter(Boolean),out=new Set<string>();
 for(let i=0;i+INTRO_WINDOW<=p.length;i++){const w=p.slice(i,i+INTRO_WINDOW);if(!allow.some(a=>a.includes(w)))out.add(w)}
 return out;
}
function copiesIntro(sentence:string,windows:Set<string>){
 const p=plainText(sentence);
 for(let i=0;i+INTRO_WINDOW<=p.length;i++)if(windows.has(p.slice(i,i+INTRO_WINDOW)))return true;
 return false;
}
function zoneText(item:EvalItem){
 if(item.kind==='role')return bodyOf(item);
 const x=outputObject(item);
 if(item.kind==='brief')return item.text??(x?briefPlanValues(x).join('\n'):'');
 return x?proseValues(x).join('\n'):bodyOf(item);
}
export const brandIntroAsFact:Grader={id:'brand_intro_as_fact',content:true,grade(item,ctx){
 if(!['role','meeting_step','brief'].includes(item.kind))return verdict('not_applicable');
 if(!ctx.brandIntro?.trim())return verdict('not_applicable','브랜드 소개 없음');
 const zone=factZoneSentences(zoneText(item));
 if(!zone.length)return verdict('not_applicable','확인 사실 구역 없음');
 const windows=introWindows(ctx.brandIntro,[...confirmedFacts(ctx).map(f=>f.value),ctx.brandName||'']);
 return hitsVerdict(zone.filter(s=>!UNVERIFIED.test(s)&&copiesIntro(s,windows)).map(s=>`소개문을 확인 사실로 씀: ${excerpt(s)}`));
}};

// 역할·회의 단계 호출의 입력 토큰 절대 상한. 제안값 32,000은 대표 결정 사항이며 설정으로 바꾼다(ctx.inputTokenCap).
export const INPUT_TOKEN_CAP=32000;
// 회의 단계(발언·합의·개선본·재검토) 상한. R3 기준선(2026-09-25) 실측 최대 52,268(운영 MAPDAL 회의 재검토: 개선본 전체와 후보 24,000자를 읽는다)의 약 1.2배다.
// 역할 최대 23,701은 32,000 안이라 역할 상한은 그대로 둔다(대표 위임 결정 2026-09-25, QUALITY-ROADMAP 승인 기록).
export const MEETING_INPUT_TOKEN_CAP=64000;
export const inputBudget:Grader={id:'input_budget',grade(item,ctx){
 const tokens=item.inputTokens;
 if(typeof tokens!=='number'||!Number.isFinite(tokens))return verdict('not_applicable','토큰 미확인');
 if(item.kind==='brief'||/^(?:brief|research)/.test(item.role||''))return verdict('not_applicable','브리프 초안·조사 호출(대상 여부 결정 전)');
 const cap=ctx.inputTokenCap??(item.meetingId?MEETING_INPUT_TOKEN_CAP:INPUT_TOKEN_CAP);
 return tokens>cap?verdict('fail',`${tokens} > ${cap}`):verdict('pass',`${tokens} (${Math.round(tokens/cap*100)}%)`);
}};
