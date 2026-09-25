// 트랙 R R2 가맹 모집 규제 가드레일 판정기(순수). 가맹 프로필이 있는 브랜드의 캡션·발행 게이트가 캡션 본문을 직접 판정한다.
// 기존 A2 경로(lib/graders/compliance.ts)의 원장 해소(ledgerKey)·[확인 필요] 면제(marked)·인용 강등(cited→info)을 거치지 않는다. 입력에 해제·우회 인자는 없다.
// 공식 규칙의 표현은 규제 사전(범주 franchise_recruit), 휴리스틱 표현·근거 조건·해제 불가 목록은 lib/franchise-rules.ts에 있다. 시계를 읽지 않는다(at·now 인자).
// 결정 20(법률 검토 보류)·결정 25(대표 기본값): 결과마다 공식 규정·휴리스틱 구분을 싣고, 휴리스틱은 'COLLECTIVE 휴리스틱 · 법률 자문 아님'을 붙인다. 법적 적합성을 주장하지 않는다.
// 모델 경계: lib/franchise.ts·lib/franchise-server.ts·lib/franchise-crypto.ts를 import하지 않는다(tests/franchise-model-boundary.test.mjs). 모델 입력(프롬프트)은 바꾸지 않는다.
import type {BrandFact,FranchiseCostDetail} from './brand-facts';
import {COMPLIANCE_LEXICON,FR_CONTEXT,FR_SHARED_COST,type ComplianceRule} from './graders/compliance-lexicon';
import {COMPLIANCE_NOTICE} from './graders/compliance';
import {VALUE_KINDS,krwAmounts,storeCountClaimList,storeCountHolds,type AmountSpan,type StoreCountClaim} from './graders/ledger';
import {FRANCHISE_CLAIMS_VERSION,FRANCHISE_CLAIM_EVIDENCE,FRANCHISE_CLAIM_LOGIC,FRANCHISE_CLAIM_MATCHERS,FRANCHISE_FIGURE_IDS,FRANCHISE_HARD_BLOCK_IDS,FRANCHISE_OFFICIAL_EXTENSIONS,FRANCHISE_REVIEW_NET,kstDateOf,rulesAt,type ClaimEvidence,type ClaimExtension,type FranchiseRule,type RuleBasis,type RuleScope} from './franchise-rules';
import {franchiseFactKey,franchiseItem} from './fact-catalog';
import {costDetailLine,versionStates,type VersionLite} from './franchise-facts';
import {GATE_DISCLAIMER} from './franchise-gates';

export type ClaimScope='consumer'|'recruitment';
// facts: 캠페인 범위의 유효 확정 사실(lib/brand-facts-server.ts confirmedFactContext, sourceRef 포함). at: 규칙 선택 시각(발행 예약 시각 등). now: 정보공개서 버전 상태 판정 시각.
export type FranchiseJudgeInput={text:string;at:string;now:string;scope:ClaimScope;brandId:string;facts:readonly BrandFact[];versions:readonly VersionLite[]};
export type FranchiseTier='hard_block'|'block'|'warn';
export type FranchiseReason='pattern'|'no_evidence'|'value_mismatch'|'details_missing'|'revenue_fact'|'review';
// extended: 공식 규칙의 휴리스틱 확장으로 걸린 이슈(basis는 heuristic, 근거 라벨에 확장 적용을 적는다).
// downgradedBy·downgradedFrom: 소비자 범위에서 캡션에 가맹 모집 문구가 없어 경고로 낮춘 이슈와 원래 등급(결정 25 기본값을 소비자 캠페인에 맞게 좁힌 것, COLLECTIVE 휴리스틱).
export type FranchiseIssue={ruleId:string;registryId:string;tier:FranchiseTier;basis:RuleBasis;registryScope:RuleScope;title:string;article:string;excerpt:string;reason:FranchiseReason;escalatedBy?:'h.headline_claim_block';extended?:true;downgradedBy?:'consumer_no_recruitment_context';downgradedFrom?:'hard_block'|'block';basisLabel:string;sources:readonly string[]};
// recruitmentContext: 모집 범위이거나 캡션에 가맹 모집 문구(RECRUITMENT_LIKE)가 있다. 소비자 범위에서 false면 모든 이슈가 경고다.
export type FranchiseJudgement={version:string;issues:FranchiseIssue[];hardBlocked:boolean;blocked:boolean;recruitmentContext:boolean;notice:string;disclaimer:string};

const H8='h.fact_opinion_labels',H9='h.headline_claim_block' as const,H6='h.revenue_figures_no_ad';
const H8_TITLE='가맹 수치 문장의 [사실] 표지·정보공개서 각주 없음(H8)';
const DOWNGRADED='consumer_no_recruitment_context' as const;
// 가맹사업법·시행령·고시 제2019-8호만 근거인 공식 규칙은 가맹희망자 정보제공 규정이다. 소비자 캠페인에 거는 것은 결정 25의 적용 범위 선택이라 휴리스틱 표시를 덧붙인다.
const FRANCHISE_LAW_SOURCES=new Set(['franchise_act','franchise_decree','franchise_false_info_notice']);
const STORE_COUNT_RULE='kr.fr.store_count_claims',STARTUP_COST_RULE='kr.fr.startup_cost_claims';
const VALUE_RULES=new Set([STORE_COUNT_RULE,STARTUP_COST_RULE]);
const COUNT_KEYS=['franchise_store_count','direct_store_count'];
const COST_KEYS=['startup_cost_total','franchise_fee','education_fee','franchise_deposit','interior_cost','royalty_fee'];
const FR_KINDS=VALUE_KINDS.filter(k=>k.franchise);
const EXCERPT=60;
// H9 수치 주장: 경고 표현 앞뒤 15자 안의 비율·거리와 가맹 값 종류 본문 값. 메뉴 가격('세트 12,000원')과 할인율('20% 할인')은 경고 표현의 수치가 아니다.
// 상품 구성·판촉 비율('카카오 70% 다크', '원두 100% 아라비카', '100% 우유 크림', '18% 증량')도 경고 표현의 수치가 아니다. 면적('33㎡'→'33m2')은 거리가 아니다.
const H9_NUMERIC=/(?<!(?:카카오|원두|우유|과즙|과육|아라비카|국산|유기농|함량|당도|설탕|버터|밀가루|쌀|생크림|원료|재료|과일|통밀|코코아)\s?)\d+(?:\.\d+)?\s?%(?!\s?(?:할인|OFF|off|세일|적립|쿠폰|페이백|증량|업|UP|up|더|함유|함량|원두|우유|아라비카|국산|유기농|과즙|과육|생크림|버터|크림|카카오|다크|초코|코코아|통밀|과일|원료|재료))|\d+(?:\.\d+)?\s?(?:km|㎞|m|미터)(?![A-Za-z\d])/;
const H9_WINDOW=15;

const compactText=(s:string)=>s.normalize('NFKC').replace(/\s+/g,'').toLowerCase();
// 한 줄에 한 글자씩 세로로 쓴 낱말('수\n익\n보\n장')은 한 줄로 붙인다(한글 한 음절만 있는 줄이 둘 이상 이어질 때만).
function joinVertical(t:string):string{
 const lines=t.split('\n'),out:string[]=[],one=/^[ \t]*[가-힣][ \t]*$/;
 for(let k=0;k<lines.length;){
  let e=k;while(e<lines.length&&one.test(lines[e]))e++;
  if(e-k>=2){out.push(lines.slice(k,e).map(l=>l.trim()).join(''));k=e}else{out.push(lines[k]);k++}
 }
 return out.join('\n');
}
// 판정 전에 NFKC로 정규화한다(전각 숫자 '４,２００만원'·'２０개', 'Ｎｏ．１', '№1'도 같은 표기다). 발췌는 정규화한 원문 문장이다.
const normalized=(t:unknown)=>typeof t==='string'?joinVertical(t.normalize('NFKC')):'';
// ── 판정용 문장 보기(view) ──
// 표현 정규식과 값 추출은 문장의 보기에서 한다. 발췌는 원문(raw)이다. 보기는 원문에서 다음만 바꾼다(COLLECTIVE 휴리스틱).
// 1) 글자 사이 구분 기호·이모지·폭 없는 문자: '수익-보장'·'수익/보장'·'수익💰보장'·'수익—보장'·'수익ㅡ보장'은 '수익 보장', '(가)계약금'·'수익(을)'의 한두 글자 괄호는 괄호를 뗀다.
//    결합 문자('수͏익'의 U+034F)는 지우고 한글 채움 문자(U+3164·U+115F·U+1160·U+FFA0, NFKC 뒤 U+1160)는 띄어쓰기로 본다. 한자 保障·保證·收益·賣出·特許·萬·千·億·月은 한글로 읽는다.
// 2) 한 글자씩 띄우거나 점을 찍은 낱말: '수 익 보 장'·'수.익.보.장'·'수·익·보·장'·'R O I'·'7 일 만 에'는 붙인다(한 글자 토큰이 둘 이상 이어질 때만).
// 3) 한글·혼합 수: '오백만원'→'500만원', '사천이백만 원'→'4200만 원', '4천2백만원'·'4천200만원'→'4200만원', '1.5천 개'→'1500 개', '2천여 개'→'2000여 개', '3억 2천'→'3억 2000만', '18프로'→'18%'.
// 가운뎃점·띄운 줄표·괄호 주석은 목록·절 경계라 이 보기에서 그대로 두고, 해제 불가 규칙만 보는 두 번째 보기(altView)에서 띄어쓰기로 본다.
const ZERO_WIDTH=/[­​-‏⁠﻿]/g,SYMBOLS=/[\p{Extended_Pictographic}\p{So}⃣️]/gu,PAREN_SHORT=/\(([가-힣]{1,2})\)/g;
const MARKS=/\p{M}/gu,FILLER=/[\u115F\u1160\u3164\uFFA0]/g;
const HANJA:Record<string,string>={保障:'보장',保證:'보증',收益:'수익',賣出:'매출',特許:'특허',萬:'만',千:'천',億:'억',月:'월'};
const HANJA_RE=new RegExp(Object.keys(HANJA).join('|'),'g');
// 'ㅡ'(U+3161, NFKC 뒤 U+1173)를 줄표로 쓴 경우도 구분 기호다.
const SEP='[.\\-_/*~|^\'’"‐‑‒–—―\\u3161\\u1173]+';
const INTRA_SEP=new RegExp(`(?<=[가-힣A-Za-z])${SEP}(?=[가-힣])|(?<=[가-힣])${SEP}(?=[A-Za-z])`,'g');
const SPACED_RUN=/(?<![\p{L}\p{N}])[\p{L}\p{N}](?:[ .·ㆍ\u119E・‧\-_/*~|]{1,3}[\p{L}\p{N}](?![\p{L}\p{N}]))+/gu;
const HDIGIT:Record<string,number>={일:1,이:2,삼:3,사:4,오:5,육:6,칠:7,팔:8,구:9};
const digitOf=(t:string)=>t===''?1:/\d/.test(t)?Number(t):HDIGIT[t]??NaN;
const HD='[일이삼사오육칠팔구]';
const ONE_EOK=new RegExp(`(?<![\\d가-힣])(${HD})(?=\\s?억|\\s?만\\s?원)`,'g'),EOK_CHEON=new RegExp(`억\\s?(\\d+(?:\\.\\d+)?|${HD})\\s?천(?!\\s?(?:만|원|\\d|${HD}))`,'g');
const SUB_MAN=new RegExp(`(?<![\\d가-힣.,])((?:\\d+(?:\\.\\d+)?|${HD})?천)?((?:\\d|${HD})?백)?((?:\\d|${HD})?십)?(\\d{1,3}|${HD})?(?=\\s?(?:만|억|원|개|곳|여|명|%|퍼센트|호점|배))`,'g');
const PERCENT_WORD=/(?<=\d)\s?프로(?=$|[^가-힣A-Za-z]|[가는의를이은도로만](?![가-힣]))/g;
function numerals(s:string){
 return s.replace(ONE_EOK,(_m,d:string)=>String(HDIGIT[d])).replace(EOK_CHEON,(_m,n:string)=>`억 ${Math.round(digitOf(n)*1000)}만`)
  .replace(SUB_MAN,(m,a:string|undefined,b:string|undefined,c:string|undefined,d:string|undefined)=>{
   if(!a&&!b&&!c)return m;
   const v=(a?digitOf(a.slice(0,-1))*1000:0)+(b?digitOf(b.slice(0,-1))*100:0)+(c?digitOf(c.slice(0,-1))*10:0)+(d?digitOf(d):0);
   return Number.isFinite(v)?String(Math.round(v)):m;
  }).replace(PERCENT_WORD,'%');
}
export function matchView(raw:string):string{
 const t=raw.replace(ZERO_WIDTH,'').replace(MARKS,'').replace(FILLER,' ').replace(HANJA_RE,h=>HANJA[h]).replace(SYMBOLS,' ').replace(PAREN_SHORT,'$1').replace(INTRA_SEP,' ')
  .replace(SPACED_RUN,m=>m.replace(/[ .·ㆍ\u119E・‧\-_/*~|]/g,''));
 return numerals(t).replace(/[ \t]{2,}/g,' ').trim();
}
// 해제 불가 규칙의 두 번째 보기: 한글 사이 가운뎃점('수익·보장'), 띄운 줄표·빗금('수익 — 보장', '수익 / 보장'), 짧은 괄호 주석('월 순수익(인건비·임대료 제외 기준) 550만원')을 띄어쓰기로 본다.
// 적중을 더하기만 한다(첫 보기의 적중은 그대로다).
const ALT_SEP=/(?<=[가-힣])\s?[·ㆍ\u119E・‧]\s?(?=[가-힣])|(?<=[가-힣])\s[-‐‑‒–—―/]\s(?=[가-힣])/g,ALT_PAREN=/\s?\([^()\n]{1,24}\)\s?/g;
const altView=(s:string)=>s.replace(ALT_SEP,' ').replace(ALT_PAREN,' ').replace(/[ \t]{2,}/g,' ').trim();
// parts: 이은 문장의 두 문장 보기. 이은 문장의 적중은 두 문장에 걸친 것만 센다(한 문장 안의 표현이 다른 문장의 낱말로 문맥을 얻지 않는다).
type Sentence={s:string;raw:string;line:number;parts?:readonly [string,string]};
function sentencesOf(text:string):Sentence[]{
 return text.split('\n').flatMap((l,line)=>l.split(/(?<=[.?!])\s+/).map(r=>r.trim()).filter(Boolean).map(raw=>({s:matchView(raw),raw,line})));
}
// 줄바꿈으로 끊은 해제 불가 표현('수익\n보장', '월 순수익\n\n550만원')을 보려고, 문장부호로 끝나지 않은 줄의 마지막 문장과 다음 줄(빈 줄 하나까지 건너뜀)의 첫 문장을 이은 문장.
// 같은 줄의 묻고 답하는 두 문장('투자금 N개월 회수? 저희는 10개월!')과, 문장부호가 있어도 이웃한 짧은 두 문장('월 순수익 걱정 끝.\n본사가 보장합니다.')도 잇는다. 해제 불가 규칙만 본다.
const BRIDGE_SHORT=20;
function bridgesOf(sentences:Sentence[]):Sentence[]{
 const out:Sentence[]=[];
 for(let k=0;k+1<sentences.length;k++){
  const a=sentences[k],b=sentences[k+1],near=b.line<=a.line+2;
  const broken=b.line>a.line&&near&&!/[.?!。…:：]$/.test(a.raw),asked=b.line===a.line&&/\?$/.test(a.raw),short=near&&a.s.length<=BRIDGE_SHORT&&b.s.length<=BRIDGE_SHORT;
  if(!broken&&!asked&&!short)continue;
  const raw=a.raw+' '+b.raw;out.push({s:matchView(raw),raw,line:a.line,parts:[a.s,b.s]});
 }
 return out;
}
// 이은 문장·두 번째 보기를 더한 해제 불가 규칙의 문장 풀.
function hardPool(sentences:Sentence[],bridges:Sentence[]):Sentence[]{
 const base=[...sentences,...bridges];
 return [...base,...base.flatMap(x=>{const s=altView(x.s);return s!==x.s?[{...x,s,...(x.parts?{parts:[altView(x.parts[0]),altView(x.parts[1])] as const}:{})}]:[]})];
}
type Matcher={match:string;also?:string;consumerAlso?:string;except?:string;cleared?:string};
type Hit={x:Sentence;start:number;end:number};
// ── 부정 ──
// 부정은 매치된 서술 자신을 부정할 때만 인정한다(COLLECTIVE 휴리스틱). 세 모양이다.
// 1) 바로 붙은 부정: '보장하지 않습니다', '보장은 없습니다', '보장할 수 없습니다', '가계약금은 받지 않습니다', '불이익을 주지 않습니다', '대출을 알선하지 않습니다', '가계약금 요구는 불법입니다'.
// 2) 같은 절 끝의 부정 서술: '우선협상권을 돈을 받고 드리지 않습니다', '가맹 계약은 14일 대기 없이 체결할 수 없습니다', '가입을 계약 조건으로 요구하지 않습니다', '… 단축은 하지 않습니다'.
//    나열 목적어의 부정: '가계약금, 상권 선점금, 우선협상 보증금을 받지 않습니다'. 표현을 가리키는 말의 부정: '수익을 보장하는 문구는 쓰지 않습니다', '수익 보장 광고는 법으로 금지돼 있습니다',
//    '최저 수익 보장 제도는 운영하지 않습니다', '정부 창업 지원 제도는 본사와 무관하며'.
// 3) 아니다: 뒤 절의 '인건비 제외·임대료 무관·환불 불가·외부 유출 금지·… 대신·걱정하지 마세요', 조건절('않으면'), 다른 브랜드와의 대비('보장하지 않는 브랜드와는 다릅니다', '보장이 없는 브랜드는 잊으세요',
//    '다른 곳에는 없습니다'), 표현을 꾸미는 부정('후회하지 않는 창업')은 매치를 부정하지 않는다(A2 채점의 40자 부정 창을 쓰지 않는다).
const NEG_STEM='(?:하|되|해\\s?드리|드리|받|두|주|쓰|넣|싣|올리|내세우|받으|요구하|요청하|약속하|제공하|지급하|책임지|알선하|가입하|운영하|사용하|광고하|진행하|체결하|계약하|권유하|제시하|안내하|적용하|허용하|판매하|모집하|표시하|표기하|보장하|수령하|도입하|시행하|단축하)';
const NEG_STEM_STRICT=NEG_STEM.replace('(?:하|되|','(?:(?<=[은는을를도]\\s?)하|');
const NOT_COND='(?!\\s?(?:으면|는다면|을\\s?경우|을\\s?때|게|도록|아도|더라도))';
const negTail=(stem:string)=>`(?:${stem}지\\s?(?:[는도]\\s?)?(?:않|못)${NOT_COND}|(?:할|될|드릴|받을|해\\s?드릴|쓸|줄|둘)\\s?수\\s?(?:는\\s?|도\\s?)?없|없|아닙|아니|(?:불법|위법)(?:입니다|이다|이에요|이며|행위)|금지(?:돼|되어|됩니다|입니다|된|되며|이며|하고|합니다)|무관|관계\\s?(?:가\\s?)?없|상관\\s?(?:이\\s?)?없)`;
const PARTICLE='(?:[은는을를이가도]|으로|로|에는|에서는|에|에서|에게)';
const DIRECT_NEG=new RegExp(`^\\s?(?:(?:요구|요청|수령|제시|약속)\\s?)?(?:${PARTICLE}\\s?)?${negTail(NEG_STEM)}|^(?:지|치)\\s?(?:[는도]\\s?)?(?:않|못)${NOT_COND}`);
// 같은 절 끝의 부정은 동사 부정만 본다('X 조건 없음'의 '없음'은 사이 낱말 '조건'을 부정한다).
const CLAUSE_NEG=new RegExp(`^([^,.;!?\\n·]{0,26}?)(?:${NEG_STEM_STRICT}지\\s?(?:[는도]\\s?)?(?:않|못)${NOT_COND}|(?:할|될|드릴|받을|해\\s?드릴|쓸|줄|둘)\\s?수\\s?(?:는\\s?|도\\s?)?없|(?:불법|위법)(?:입니다|이다|이에요|이며|행위)|금지(?:돼|되어|됩니다|입니다|된|되며|이며|하고|합니다))`);
const LIST_NEG=/^(?:\s?(?:,|·|ㆍ|\u119E|및|와|과|이나|나|또는|혹은)\s?[가-힣A-Za-z0-9]{1,10}(?:\s[가-힣A-Za-z0-9]{1,10}){0,2}?){1,5}?\s?(?:을|를|은|는|도)\s?(?:받|요구하|요청하|수령하|두|제공하|드리|약속하|지급하|보장하|책임지|알선하|운영하)지\s?(?:[는도]\s?)?(?:않|못)/;
const META_NEG=new RegExp(`^\\s?(?:(?:을|를|이|가)\\s?)?(?:하는|해\\s?주는|해\\s?드리는|되는|된|이라는|라는|같은|등의|류의|의|하겠다는|한다는|과\\s?같은|와\\s?같은)?\\s?(?:[가-힣A-Za-z0-9]{1,8}\\s){0,4}?(?:문구|표현|광고|문장|말|약속|제도|프로그램|방식|행위|내용|요구|제안|조항|정책|서비스|기간|단축|수치|숫자|자료|이야기)(?:은|는|을|를|도|이|가|으로|로)?\\s?([^,.;!?\\n]{0,24}?)(?:${negTail(NEG_STEM)}|금지|불법|위법)`);
const CONNECTIVE=/(?:면|으면|면서|는데|지만|니까|어서|아서|해서|하여|고서|며|려고|려면|도록)(?:\s|$)/,RHETORIC=/다른|타\s?(?:브랜드|사|업체)|경쟁|어디에도|어디서도|어디서나|오직|저희만|우리만|유일/;
const CONTRAST_AFTER=/^(?:는|은|던)\s?[가-힣]{1,8}(?:와|과|랑|하고)?(?:는|은|도)?\s?(?:[가-힣]{1,6}\s)?(?:다르|다릅|달라|달리|차원|비교|잊|말고|아니라|아닌)/,ADNOMINAL_AFTER=/^(?:는|은|던|을)\s?[가-힣]/;
function negatedAfter(s:string,end:number):boolean{
 const rest=s.slice(end);
 const direct=DIRECT_NEG.exec(rest);
 if(direct)return !CONTRAST_AFTER.test(rest.slice(direct[0].length));
 const list=LIST_NEG.exec(rest);
 if(list)return !CONTRAST_AFTER.test(rest.slice(list[0].length));
 for(const re of [CLAUSE_NEG,META_NEG]){
  const m=re.exec(rest);
  if(!m)continue;
  const gap=m[1]??'',after=rest.slice(m[0].length);
  if(CONNECTIVE.test(gap)||RHETORIC.test(gap)||ADNOMINAL_AFTER.test(after))continue;
  return true;
 }
 return false;
}
// 해제 불가 규칙의 except는 매치가 든 절(쉼표·가운뎃점·더하기·줄표·세미콜론·괄호 사이)만 본다. 다른 절이나 괄호 주석의 '구독 이벤트'·'매출 1% 기부'·'(탈퇴는 자유)'로 면제되지 않는다.
// 숫자 사이 쉼표('4,200')는 절 경계가 아니다.
const CLAUSE_CUT=/(?<!\d)[,，]|[,，](?!\d)|[;；·ㆍ\u119E+|!?()（）]|\s[-–—/]\s/g;
function clauseOf(s:string,start:number,end:number){
 let from=0,to=s.length;
 for(const m of s.matchAll(CLAUSE_CUT)){const at=m.index!;if(at<start)from=at+m[0].length;else if(at>=end){to=at;break}}
 return s.slice(from,to);
}
// 적중(문장·매치 위치). all이 아니면 첫 적중에서 멈춘다. figure: 수치 자체를 막는 규칙이라 부정 면제가 없다. clauseExcept: except를 매치가 든 절에서만 본다.
// consumerAlso는 소비자 범위에서만 본다(모집 범위는 캠페인 자체가 가맹 문맥이다).
function hitSentences(m:Matcher,sentences:Sentence[],o:{all:boolean;figure:boolean;clauseExcept:boolean;scope:ClaimScope}):Hit[]{
 const match=new RegExp(m.match,'g'),also=m.also?new RegExp(m.also):null,ctx=m.consumerAlso&&o.scope==='consumer'?new RegExp(m.consumerAlso):null,except=m.except?new RegExp(m.except):null,out:Hit[]=[];
 for(const x of sentences){
  if(also&&!also.test(x.s)||ctx&&!ctx.test(x.s)||except&&!o.clauseExcept&&except.test(x.s))continue;
  for(const hit of x.s.matchAll(match)){
   const start=hit.index!,end=start+hit[0].length;
   if(x.parts&&x.parts.some(p=>p.includes(hit[0])))continue;
   if(!o.figure&&negatedAfter(x.s,end))continue;
   if(except&&o.clauseExcept&&except.test(clauseOf(x.s,start,end)))continue;
   out.push({x,start,end});break;
  }
  if(out.length&&!o.all)break;
 }
 return out;
}
const lexiconRule=(id:string):ComplianceRule|undefined=>COMPLIANCE_LEXICON.rules.find(r=>r.category==='franchise_recruit'&&r.id===id);
// 규칙 레지스트리 id(또는 family) → 판정원(사전 규칙·휴리스틱 정규식·판정기 로직).
export function claimSourceOf(rule:Pick<FranchiseRule,'id'|'family'|'basis'>):{kind:'lexicon';rule:ComplianceRule}|{kind:'matcher'}|{kind:'logic'}|null{
 if((FRANCHISE_CLAIM_LOGIC as readonly string[]).includes(rule.id))return {kind:'logic'};
 if(rule.basis==='official'){const lex=lexiconRule(rule.family??rule.id);return lex?{kind:'lexicon',rule:lex}:null}
 return FRANCHISE_CLAIM_MATCHERS[rule.id]?{kind:'matcher'}:null;
}

// ── 사실 분할과 값 원장 ──
type Fact=BrandFact&{frKey:string};
function splitFacts(i:FranchiseJudgeInput){
 const states=versionStates(i.versions.filter(v=>v.brandId===i.brandId),i.now);
 const franchise=i.facts.flatMap(f=>{const frKey=f.brandId===i.brandId&&f.status==='confirmed'?franchiseFactKey(f.key):undefined;return frKey?[{...f,frKey}]:[]});
 // 정보공개서 항목은 현재 등록 버전 근거가 있어야 현재 사실이다. 비공개 항목(claim_basis 등)은 확정 사실이면 현재 사실이다.
 const current=(f:Fact)=>!franchiseItem(f.frKey)?.disclosure||(!!f.sourceRef&&states[f.sourceRef.disclosureVersionId]==='current');
 return {current:franchise.filter(current),stale:franchise.filter(f=>!current(f))};
}
const integerOf=(v:string)=>{const m=/\d[\d,]*/.exec(v.normalize('NFKC'));return m?String(Number(m[0].replace(/,/g,''))):null};
const addTo=(m:Map<string,Fact[]>,v:string,fs:Fact[])=>m.set(v,[...(m.get(v)??[]),...fs]);
// 매장 수 원장: 기준일(asOf)이 있는 가맹점 수·직영점 수. 전체('전국 N개 매장')는 둘 다 있으면 같은 기준일의 합만, 하나만 있으면 그 값이다.
// '가맹점 N개'는 가맹점 수만, '직영점 N개'는 직영점 수만과 대조한다(합계를 가맹점 수처럼 쓰면 부풀린 가맹점 현황이다, 고시 제2019-8호 Ⅱ.4.가).
type CountLedger=Record<StoreCountClaim['of'],Map<string,Fact[]>>;
function countLedgerOf(current:Fact[]):CountLedger{
 const counted=current.filter(f=>COUNT_KEYS.includes(f.frKey)&&!!f.sourceRef?.asOf);
 const franchised=counted.filter(f=>f.frKey==='franchise_store_count'),direct=counted.filter(f=>f.frKey==='direct_store_count');
 const byValue=(fs:Fact[])=>{const m=new Map<string,Fact[]>();for(const f of fs){const v=integerOf(f.value);if(v!==null)addTo(m,v,[f])}return m};
 const total=new Map<string,Fact[]>();
 if(franchised.length&&direct.length){for(const a of franchised)for(const b of direct){const x=integerOf(a.value),y=integerOf(b.value);if(x!==null&&y!==null&&a.sourceRef!.asOf===b.sourceRef!.asOf)addTo(total,String(Number(x)+Number(y)),[a,b])}}
 else for(const [v,fs] of byValue(counted))addTo(total,v,fs);
 return {franchise:byValue(franchised),direct:byValue(direct),total};
}
// 값 종류별 원장(비용): 값 → 그 값을 가진 현재 사실.
function ledgerOf(kind:typeof FR_KINDS[number],facts:Fact[]):Map<string,Fact[]>{
 const out=new Map<string,Fact[]>();
 for(const f of facts.filter(f=>kind.key.test(f.frKey)))for(const v of kind.ledger(f.value.normalize('NFKC')))addTo(out,v,[f]);
 return out;
}
type ValueFailure={reason:'no_evidence'|'value_mismatch'|'details_missing'};
// claim: 적중 문장이 실제 값 주장인가(H8 표지 경고 대상). failure: 대조 실패 사유.
type ValueResult={claim:boolean;failure:ValueFailure|null};
const NO_CLAIM:ValueResult={claim:false,failure:null};
// 본문에 적힌 기준일('2026년 9월 현재', '2026.06.30 기준', '2025년 말 기준')은 매장 수 사실의 기준일과 같아야 한다(연·월·일 중 적힌 것만 비교).
const DATE_REF=/(\d{4})\s?(?:[.\-/]|년)?\s?(?:(\d{1,2})\s?(?:[.\-/]|월)?\s?(?:(\d{1,2})\s?일?)?)?\s?(말\s?)?(?:기준|현재)/;
function statedDate(s:string):{y:number;m?:number;d?:number}|null{
 const m=DATE_REF.exec(s);
 if(!m)return null;
 return {y:Number(m[1]),...(m[2]?{m:Number(m[2])}:m[4]?{m:12}:{}),...(m[3]?{d:Number(m[3])}:{})};
}
const dateAgrees=(asOf:string,d:{y:number;m?:number;d?:number})=>{const [y,mo,da]=asOf.split('-').map(Number);return y===d.y&&(d.m===undefined||mo===d.m)&&(d.d===undefined||da===d.d)};
// 매장 수: 주장마다 가리키는 원장(가맹점·직영점·전체)에서 비교 방식(같은 값·이상·N여)으로 참인 사실이 있어야 한다. 원장이 비면 근거 없음.
// '오픈 예정 N개'는 원장 항목이 없어 모집 범위에서 근거 없음이고, 소비자 범위의 오픈 예고는 주장으로 보지 않는다.
function countResult(x:Sentence,current:Fact[],scope:ClaimScope):ValueResult{
 const claims=storeCountClaimList(x.s);
 if(!claims.length)return /오픈\s?예정/.test(x.s)&&scope==='recruitment'?{claim:true,failure:{reason:'no_evidence'}}:NO_CLAIM;
 const ledger=countLedgerOf(current),date=statedDate(x.s);
 for(const c of claims){
  const pool=ledger[c.of];
  if(!pool.size)return {claim:true,failure:{reason:'no_evidence'}};
  const held=[...pool].filter(([v])=>storeCountHolds(c,v)).flatMap(([,fs])=>fs);
  if(!held.length||(date&&!held.some(f=>dateAgrees(f.sourceRef!.asOf!,date))))return {claim:true,failure:{reason:'value_mismatch'}};
 }
 return {claim:true,failure:null};
}
// 비용 금액의 절(끊는 기호 사이)과 매장 유형. 유형은 금액이 든 절 → 문장에서 금액 앞 → 문장 전체 → 앞 두 줄 → 다음 줄 순으로 찾는다(가장 가까운 유형).
const SEG_CUT=/[,，](?!\d)|[;；·ㆍ\u119E/|]|\s[-–—]\s/g;
const PER_UNIT=/(?:3\.3\s?(?:m2|㎡)|평|m2|㎡|제곱\s?미터)\s?당/,VAT_RE=/(?:VAT|vat|부가세|부가가치세)\s?(포함|별도|제외|미포함|불포함)/;
const vatOf=(t:string)=>{const m=VAT_RE.exec(t);return m?(m[1]==='포함'?'incl':'excl'):null};
const typesIn=(t:string,types:string[])=>{const c=compactText(t);return types.filter(ty=>c.includes(compactText(ty)))};
function segmentAt(s:string,at:number){
 let from=0,to=s.length;
 for(const m of s.matchAll(SEG_CUT)){const k=m.index!;if(k<at)from=k+m[0].length;else{to=k;break}}
 return s.slice(from,to);
}
function typesAt(x:Sentence,at:number,types:string[],text:string):string[]{
 const seg=typesIn(segmentAt(x.s,at),types);
 if(seg.length)return seg;
 const before=x.s.slice(0,at);let best:{t:string;k:number}|null=null;
 for(const t of types){const k=compactText(before).lastIndexOf(compactText(t));if(k>=0&&(!best||k>best.k))best={t,k}}
 if(best)return [best.t];
 const all=typesIn(x.s,types);
 if(all.length)return all;
 const lines=text.split('\n');
 for(const k of [x.line-1,x.line-2,x.line+1]){if(k<0||k>=lines.length)continue;const t=typesIn(lines[k],types);if(t.length)return t}
 return [];
}
// 매장 유형이 앞에 선 절('테이크아웃형 창업비용 5,000만원 / 매장형 6,000만원'의 '매장형 6,000만원')은 같은 문장에 그 비용 라벨이 있으면 그 유형의 금액이다.
function typedSegments(x:Sentence,types:string[]):AmountSpan[]{
 if(!types.length)return [];
 const out:AmountSpan[]=[];let from=0;
 const parts=[...x.s.matchAll(SEG_CUT)].map(m=>m.index!).concat(x.s.length);
 for(const to of parts){
  const seg=x.s.slice(from,to),lead=/^\s?([^\d\s:：]{1,12})\s?[:：]?\s?(?=\d)/.exec(seg),type=lead&&types.find(t=>compactText(t)===compactText(lead[1]));
  if(type)for(const v of krwAmounts(seg))out.push({v,at:from+lead![0].length,seg:seg.slice(lead![0].length)});
  from=to+1;
 }
 return out;
}
// 창업비용 상세: 사실 카드의 포함·불포함·면적 줄이 그대로 있거나, 포함 항목·불포함 항목·전용면적이 본문에 모두 적혀 있고 항목마다 제자리에 있어야 한다
// ('포함: …'·'… 포함'이면 포함, '불포함: …'·'… 별도·제외'이면 불포함. 불포함 항목을 포함 목록에 적으면 비용을 줄인 표기다).
const DETAIL_MARK=/불포함|미포함|포함되지\s?않|포함\s?안|제외|별도|포함/g;
function listOf(line:string,at:number,len:number):'in'|'out'|null{
 const marks=[...line.matchAll(DETAIL_MARK)].map(m=>({k:m.index!,out:m[0]!=='포함',label:/^\s?[:：]/.test(line.slice(m.index!+m[0].length))}));
 const label=marks.filter(m=>m.label&&m.k<at).pop();
 if(label&&!marks.some(m=>m.k>label.k&&m.k<at))return label.out?'out':'in';
 const next=marks.find(m=>m.k>=at+len&&m.k-(at+len)<=30&&!m.label);
 return next?(next.out?'out':'in'):label?(label.out?'out':'in'):null;
}
function detailsStated(text:string,c:FranchiseCostDetail):boolean{
 if(compactText(text).includes(compactText(costDetailLine(c))))return true;
 const area=c.areaM2===null||new RegExp(`(?<![\\d.])${String(c.areaM2).replace('.','\\.')}\\s?(?:m2|㎡|제곱\\s?미터|평방\\s?미터)`).test(text);
 if(!area)return false;
 const lines=text.split('\n'),items=[...c.includes.map(w=>({w,want:'in'})),...c.excludes.map(w=>({w,want:'out'}))];
 // 항목 위치(더 긴 다른 항목 안의 위치는 빼고: '보증금'은 '임차보증금' 안이 아니다).
 return items.every(({w,want})=>lines.some(line=>{
  const spots=[...line.matchAll(new RegExp(w.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'g'))].map(m=>m.index!).filter(k=>!items.some(o=>o.w.length>w.length&&o.w.includes(w)&&line.slice(Math.max(0,k-o.w.length),k+o.w.length).includes(o.w)));
  return spots.length>0&&spots.every(k=>listOf(line,k,w.length)===want);
 }));
}
// 금액 없이 비용 라벨만 쓴 문장은 주장이 아니다('창업비용은 매장 유형에 따라 다르며 정보공개서에 적혀 있습니다', '순서: … 창업비용 표 …', '개설 비용 항목은 …').
// 평가하는 말('소자본', '업계 최저', '부담 없는', '만으로', '이면')이나 라벨 바로 뒤 금액·비율('로열티: 매출의 3%')이 있으면 주장이고, 그 종류의 현재 사실 값이 본문에 있어야 한다.
const COST_EVALUATIVE=/소자본|저렴|낮은|최저|최소|부담\s?(?:없|적|zero|제로|↓|다운)|걱정\s?(?:없|zero|제로|끝)|착한|합리적|적은|단돈|만으로|이면|으로\s?(?:창업|시작|오픈)|반값|절반|파격|[Zz]ero|제로|[Ll]ow|[Cc]heap/;
const FR_CONTEXT_RE=new RegExp(FR_CONTEXT);
// 비용: 금액마다 그 금액의 매장 유형 사실과 대조한다. 값이 같아도 원장 표기와 어긋나면 값 불일치다(3.3㎡당 단가를 총액처럼, 부가세 별도를 포함으로, 추정 범위를 한 값·한쪽 끝으로:
// 범위 사실은 상·하한을 모두 적어야 한다, 체크리스트 24행).
// 창업비용은 매장 유형이 있는 확정 사실이 있어야 하고(유형 없는 '창업비용 N원'은 체크리스트 24행 위반), 적힌 유형의 상세(포함·불포함·면적)가 본문에 있어야 한다.
function costResult(x:Sentence,hit:Hit,kinds:string[],current:Fact[],text:string,scope:ClaimScope):ValueResult{
 const types=[...new Set(current.flatMap(f=>f.cost?[f.cost.storeType]:[]))],context=scope==='recruitment'||FR_CONTEXT_RE.test(x.s);
 let claim=false;
 for(const kind of FR_KINDS.filter(k=>kinds.includes(k.kind)&&k.kind!=='매장 수')){
  const spans=kind.spans?kind.spans(x.s,{context}):kind.body(x.s,{context}).map(v=>({v,at:0,seg:x.s}));
  if(!spans.length)continue;
  const all=kind.kind==='창업비용'?[...spans,...typedSegments(x,types).filter(t=>!spans.some(p=>p.at===t.at))]:spans;
  claim=true;
  const facts=current.filter(f=>kind.key.test(f.frKey));
  if(!facts.length)return {claim,failure:{reason:'no_evidence'}};
  const typed=facts.filter(f=>!!f.cost),stated=new Set(all.map(p=>p.v));
  for(const p of all){
   const named=typed.filter(f=>typesAt(x,p.at,types,text).includes(f.cost!.storeType)),pool=named.length?named:facts;
   const clause=segmentAt(x.s,p.at),perUnit=PER_UNIT.test(p.seg)||PER_UNIT.test(x.s.slice(Math.max(0,p.at-10),p.at)),matched=ledgerOf(kind,pool).get(p.v)??[];
   const fits=matched.some(f=>{
    const fv=f.value.normalize('NFKC'),bounds=kind.ledger(fv),fvat=vatOf(fv),cvat=vatOf(clause);
    return PER_UNIT.test(fv)===perUnit&&!(fvat&&cvat&&fvat!==cvat)&&bounds.every(b=>stated.has(b));
   });
   if(!fits)return {claim,failure:{reason:'value_mismatch'}};
   if(kind.kind!=='창업비용')continue;
   if(!typed.length||!named.length)return {claim,failure:{reason:'details_missing'}};
   if(!matched.some(f=>!!f.cost&&detailsStated(text,f.cost)))return {claim,failure:{reason:'details_missing'}};
  }
 }
 if(claim)return {claim,failure:null};
 if(!/\d[\d,.]*\s?(?:만|천|억|원|%|퍼센트)/.test(x.s.slice(hit.start,hit.end+16))&&!COST_EVALUATIVE.test(x.s))return NO_CLAIM;
 const body=compactText(text);
 return {claim:true,failure:current.some(f=>COST_KEYS.includes(f.frKey)&&compactText(f.value).length>=2&&body.includes(compactText(f.value)))?null:{reason:'no_evidence'}};
}
function evidenceMet(e:ClaimEvidence,current:Fact[],text:string):boolean{
 const body=compactText(text),inText=(k:string)=>current.some(f=>f.frKey===k&&compactText(f.value).length>0&&body.includes(compactText(f.value)));
 if(e.kind==='fact_exists')return current.some(f=>e.factKeys.includes(f.frKey));
 if(e.kind==='fact_in_text')return (e.all?e.factKeys.every(inText):e.factKeys.some(inText))&&(!e.marker||new RegExp(e.marker).test(text));
 if(e.kind==='fact_value'){const ok=new RegExp(e.valuePattern),no=e.notPattern?new RegExp(e.notPattern):null;return current.some(f=>f.frKey===e.factKey&&ok.test(f.value)&&!(no&&no.test(f.value)))}
 return false;
}
// H6 수익 사실 값: 광고 불가(adUse:false) 사실의 금액·비율이 문장에 같은 수로 나오면 표현과 관계없이 막는다('가맹점 평균 4,200만원 달성', '이익률 18% 브랜드', '한 달 4천2백만원', '1년에 3억 2천 버셨어요').
// 개수·기간·순위 수('1억 개', '2025년', '1위')와 누적·조회수·팔로워 같은 셈('조회수 4,200만 돌파')은 금액이 아니다. 경품·상금·기부·장학금·할인 절의 금액('총 500만원 상당 경품', '장학금 1,000만원 전달')은 수익 금액이 아니고,
// 비용 라벨이 붙은 금액('가맹비 550만원', '공급가는 원가에 10%')은 그 비용의 값이다(수익 낱말이 같은 절에 없을 때). 비율은 같은 절에 수익·이익·마진·매출 같은 말이 있을 때만 수익률로 보고,
// 할인·증량·절감·함유율('18% 증량', '평균 15% 저렴', '카카오 30% 함유')은 아니다. 절 단위로 보므로 뒤 절의 경품 문구로 앞 절 금액이 빠지지 않는다.
// 수익 사실 값 문자열 그대로의 대조는 이름이 붙은 값('영업이익률 15%', '월 평균 3,850만원 (2025년)')만 하고, 숫자만인 값은 금액·비율 대조로만 본다.
const COUNTER=/\d[\d,.]*\s?(?:억|천|만)?\s?(?:개|명|잔|판|회|뷰|건|병|봉|장|마리|그릇|세트|박스|분|시간|일|주|년|개월|위|호점|km|m|미터)(?![가-힣])/g;
const COUNT_NOUN=/누적|조회|팔로워|구독|방문|관람|회원|다운로드|판매량|판매\s?(?:수|개수)|좋아요|이용자|사용자|참여자|관객|고객\s?수/;
const moneyTokens=(s:string)=>{const t=s.replace(COUNTER,' ');return krwAmounts(COUNT_NOUN.test(t)?t:t.replace(/(\d)(\s?)만(?!\s?원)/g,'$1$2만원'))};
const PCT=/(\d+(?:\.\d+)?)\s?(?:%|퍼센트)(?![^.,\n]{0,6}(?:할인|OFF|off|세일|적립|페이백|쿠폰|기부|후원|환원|전달|나눔|증정|낮|저렴|증량|업|UP|up|더|절감|감소|인하|함유|함량))/g;
const pctTokens=(s:string)=>[...s.matchAll(PCT)].map(m=>String(Number(m[1])));
const GIVEAWAY=/상당|경품|상금|기부|후원|적립|쿠폰|할인|증정|장학|기금|기탁|전달|급식|보호소|쓰입|쓰여|사용됩|사용합|사용해|지원금/,RATE_CONTEXT=/이익|수익|마진|영업|매출|순익|실적|ROI|이윤/i;
const COST_LABELED=/가맹비|가입비|교육비|보증금|로열티|인테리어|창업\s?비|개설\s?비|투자\s?(?:금|비)|공급가|원가|임대료|월세|권리금|가격|판매가|정가|할인가|설비/,REV_WORD=/매출|수익|이익|마진|순익|벌|번다|버셨|벌어|가져|소득|수입/;
function sentenceTokens(s:string){
 const money=new Set<string>(),pct=new Set<string>(),clauses:string[]=[];
 for(const c of s.split(CLAUSE_CUT)){
  if(GIVEAWAY.test(c))continue;
  clauses.push(compactText(c));
  if(!(COST_LABELED.test(c)&&!REV_WORD.test(c)))for(const v of moneyTokens(c))money.add(v);
  if(RATE_CONTEXT.test(c))for(const v of pctTokens(c))pct.add(v);
 }
 return {money,pct,clauses};
}
const namedValue=(v:string)=>v.replace(/[\d\s,.%~()（）\-:]|만|천|억|원|년|월|일|개|명|기준|약|이상|이하/g,'').length>=2;
function revenueFactSentence(facts:Fact[],sentences:Sentence[]):Sentence|undefined{
 const values=facts.filter(f=>franchiseItem(f.frKey)?.adUse===false).map(f=>{const v=matchView(f.value.normalize('NFKC'));return {compact:compactText(v),named:namedValue(v),money:moneyTokens(v),pct:pctTokens(v)}});
 if(!values.length)return undefined;
 const hits=(s:string)=>{const t=sentenceTokens(s);return values.some(v=>(v.named&&v.compact.length>=4&&t.clauses.some(c=>c.includes(v.compact)))||v.money.some(x=>t.money.has(x))||v.pct.some(x=>t.pct.has(x)))};
 return sentences.find(x=>hits(x.s))??(values.some(v=>v.named&&v.compact.length>=6&&compactText(sentences.map(x=>x.s).join('')).includes(v.compact))?sentences[0]:undefined);
}

// 안전망 문장: 절(끊는 기호 사이)마다 수익 낱말과 금액·비율(개수·기간 셈은 뺀다)이 함께 있는가. 경품·기부·할인 절과 비용 라벨 절('로열티는 매출액의 3%')은 빼고 본다.
const REVIEW_WORDS=new RegExp(FRANCHISE_REVIEW_NET.words),REVIEW_FIGURE=new RegExp(FRANCHISE_REVIEW_NET.figure),REVIEW_SKIP=new RegExp(FRANCHISE_REVIEW_NET.skip);
const revenueLikeFigure=(s:string)=>s.split(CLAUSE_CUT).some(c=>REVIEW_WORDS.test(c)&&!GIVEAWAY.test(c)&&!COST_LABELED.test(c)&&!REVIEW_SKIP.test(c)&&REVIEW_FIGURE.test(c.replace(COUNTER,' ')));

// ── 판정 ──
type Draft={rule:FranchiseRule;ruleId:string;title:string;lexicon?:ComplianceRule;extension?:ClaimExtension;reason:FranchiseReason;hit:Hit;tier:FranchiseTier;escalated?:boolean};
const tierOf=(r:FranchiseRule):FranchiseTier=>(FRANCHISE_HARD_BLOCK_IDS as readonly string[]).includes(r.id)?'hard_block':r.tier==='warn'?'warn':'block';
function basisLabelOf(d:Draft,scope:ClaimScope){
 if(d.extension)return `${d.extension.label} · ${GATE_DISCLAIMER}`;
 if(d.rule.basis==='heuristic')return GATE_DISCLAIMER;
 if(d.rule.basis==='platform')return '플랫폼 정책';
 const consumerNote=scope==='consumer'&&!!d.lexicon&&d.lexicon.sources.every(s=>FRANCHISE_LAW_SOURCES.has(s));
 return `공식 규정 · ${d.rule.article}`+(consumerNote?` · 소비자 캠페인 적용은 ${GATE_DISCLAIMER}`:'');
}
const TIER_ORDER:Record<FranchiseTier,number>={hard_block:0,block:1,warn:2};
const ascii=(a:string,b:string)=>a<b?-1:a>b?1:0;
// H9 수치 주장: 경고 표현(매치) 앞뒤 15자 안의 비율·거리·가맹 값 종류 본문 값.
const numericClaim=(h:Hit)=>{const w=h.x.s.slice(Math.max(0,h.start-H9_WINDOW),h.end+H9_WINDOW);return H9_NUMERIC.test(w)||FR_KINDS.some(k=>k.body(w).length>0)};
const HARD=new Set<string>(FRANCHISE_HARD_BLOCK_IDS),FIGURES=new Set<string>(FRANCHISE_FIGURE_IDS);
export function judgeFranchiseText(i:FranchiseJudgeInput):FranchiseJudgement{
 const text=normalized(i.text),sentences=sentencesOf(text),bridges=bridgesOf(sentences),hardSentences=hardPool(sentences,bridges),date=kstDateOf(i.at);
 // 소비자 범위는 캡션(본문 전체)에 가맹 모집 문구가 있을 때만 가맹 규칙이 막는다. 없으면 모든 이슈를 경고로 낮춰 승인 화면에만 보인다(결정 25 기본값을 소비자 캠페인에 맞게 좁힘).
 // '본사'·'창업 N주년'·'점포' 같은 느슨한 낱말은 모집 문구가 아니다(RECRUITMENT_LIKE). 모집 범위는 캠페인 자체가 모집이다.
 const context=i.scope==='recruitment'||RECRUITMENT_LIKE.test(text)||sentences.some(x=>RECRUITMENT_LIKE.test(x.s));
 const applicable=rulesAt(date).filter(r=>r.scope==='franchise_brand'||(r.scope==='objective_export'&&i.scope==='recruitment'));
 const applies=(id:string)=>applicable.some(r=>r.id===id);
 const {current,stale}=splitFacts(i);
 const drafts:Draft[]=[],valueHits:Sentence[]=[];
 for(const rule of applicable){
  const source=claimSourceOf(rule);
  if(!source||source.kind==='logic')continue;
  const lexicon=source.kind==='lexicon'?source.rule:undefined,base=lexicon??FRANCHISE_CLAIM_MATCHERS[rule.id];
  const ruleId=lexicon?lexicon.id:rule.id,title=lexicon?lexicon.title:FRANCHISE_CLAIM_MATCHERS[rule.id].title;
  // 모집 범위는 캠페인 자체가 가맹 문맥이라 소비자 문장과 겹치는 비용 라벨('교육비 50만원', '인테리어 비용 3.3㎡당 120만원')도 가맹 비용 주장이다.
  const matcher:Matcher=ruleId===STARTUP_COST_RULE&&i.scope==='recruitment'?{...base,match:`${base.match}|(?:${FR_SHARED_COST})\\s?(?:[^.\\n]|\\.(?=\\d)){0,14}?\\d[\\d,.]*\\s?(?:만|천|억|원)`}:base;
  if(matcher.cleared&&new RegExp(matcher.cleared).test(text))continue;
  const evidence=FRANCHISE_CLAIM_EVIDENCE[ruleId],values=evidence?.kind==='values',hard=HARD.has(rule.id),opts={figure:FIGURES.has(rule.id),clauseExcept:hard,scope:i.scope};
  // 해제 불가 규칙은 줄바꿈으로 끊은 표현도 본다(이은 문장은 뒤에 둔다).
  const pool=hard?hardSentences:sentences;
  const draft=(reason:FranchiseReason,hit:Hit,extension?:ClaimExtension)=>drafts.push({rule,ruleId,title,lexicon,extension,reason,hit,tier:tierOf(rule)});
  const hits=hitSentences(matcher,pool,{...opts,all:values});
  const met=!!evidence&&evidence.kind!=='values'&&hits.length>0&&evidenceMet(evidence,current,text);
  if(hits.length&&!met){
   if(!evidence){draft('pattern',hits[0]);continue}
   if(evidence.kind==='values'){
    let failed=false;
    for(const h of hits){
     const kinds=[...evidence.valueKinds],r=ruleId===STORE_COUNT_RULE?countResult(h.x,current,i.scope):costResult(h.x,h,kinds,current,text,i.scope);
     if(r.claim&&VALUE_RULES.has(ruleId))valueHits.push(h.x);
     if(r.failure&&!failed){draft(r.failure.reason,h);failed=true}
    }
    continue;
   }
   draft('no_evidence',hits[0]);continue;
  }
  // 공식 규칙의 휴리스틱 확장('가맹금 100% 안전'): 공식 표현이 없거나 근거로 성립한 경우에만 본다. 근거 사실(또는 textEvidence: 예치 사실과 예치를 말한 문장)은 사실 표현만 통과시키고,
  // 같은 문장에 strong 표현(괄호 안 포함)이 있으면 막는다.
  const extension=FRANCHISE_OFFICIAL_EXTENSIONS[ruleId];
  if(!extension)continue;
  const ext=hitSentences({match:extension.match},pool,{...opts,all:false});
  if(!ext.length)continue;
  const te=extension.textEvidence,textMet=!!te&&new RegExp(te.textPattern).test(ext[0].x.s)&&current.some(f=>f.frKey===te.factKey&&new RegExp(te.valuePattern).test(f.value));
  if(new RegExp(extension.strong).test(ext[0].x.s)||!((evidence&&evidenceMet(evidence,current,text))||textMet))draft('pattern',ext[0],extension);
 }
 // H6: 수익 항목(adUse:false) 사실의 값·금액·비율이 본문에 있으면 표현과 관계없이 해제 불가 차단이다(교체된 버전 사실 포함).
 const h6=applicable.find(r=>r.id===H6);
 if(h6&&!drafts.some(d=>d.ruleId===H6)){
  const x=revenueFactSentence([...current,...stale],sentences);
  if(x)drafts.push({rule:h6,ruleId:H6,title:FRANCHISE_CLAIM_MATCHERS[H6].title,reason:'revenue_fact',hit:{x,start:0,end:x.s.length},tier:tierOf(h6)});
 }
 // H8: 매장 수·창업비용 주장 문장이 있는데 [사실] 표지도 정보공개서 각주도 없으면 경고.
 const h8=applicable.find(r=>r.id===H8);
 if(h8&&valueHits.length&&!/\[사실/.test(text)&&!text.includes('※ 정보공개서')){
  const first=[...valueHits].sort((a,b)=>sentences.indexOf(a)-sentences.indexOf(b))[0];
  drafts.push({rule:h8,ruleId:H8,title:H8_TITLE,reason:'pattern',hit:{x:first,start:0,end:first.s.length},tier:'warn'});
 }
 // 안전망(모집 범위, COLLECTIVE 휴리스틱): 패턴 규칙은 완전하지 않다. 어느 규칙도 잡지 않은 문장에서 수익 낱말과 같은 절에 금액·비율이 있으면 경고로 승인자에게 보인다.
 const parent=applicable.find(r=>r.id===FRANCHISE_REVIEW_NET.parent);
 if(i.scope==='recruitment'&&parent){
  const caught=(x:Sentence)=>drafts.some(d=>d.hit.x.raw.includes(x.raw)||x.raw.includes(d.hit.x.raw));
  const x=[...sentences,...bridges].find(x=>!caught(x)&&revenueLikeFigure(x.s));
  if(x)drafts.push({rule:parent,ruleId:FRANCHISE_REVIEW_NET.id,title:FRANCHISE_REVIEW_NET.title,reason:'review',hit:{x,start:0,end:x.s.length},tier:'warn'});
 }
 // H9: 첫 줄(비어 있지 않은 첫 줄)의 경고 가운데 경고 표현 곁에 수치 주장이 있는 것은 차단으로 올린다. H8·안전망은 확인용 경고라 올리지 않는다.
 // 모집 문구 없는 소비자 캡션은 아래에서 모두 경고로 낮춘다(올린 것도 downgradedFrom 'block'으로 남기고 escalatedBy는 떼어 낸다).
 const headline=sentences[0]?.line;
 if(applies(H9)&&headline!==undefined)for(const d of drafts)if(d.tier==='warn'&&d.ruleId!==H8&&d.ruleId!==FRANCHISE_REVIEW_NET.id&&d.hit.x.line===headline&&numericClaim(d.hit)){d.tier='block';d.escalated=true}
 const issues:FranchiseIssue[]=drafts.map(d=>{
  const from=!context&&d.tier!=='warn'?d.tier as 'hard_block'|'block':null;
  return {ruleId:d.ruleId,registryId:d.rule.id,tier:from?'warn' as const:d.tier,basis:d.extension||d.ruleId===FRANCHISE_REVIEW_NET.id?'heuristic' as const:d.rule.basis,registryScope:d.rule.scope!,title:d.title,article:d.rule.article,excerpt:d.hit.x.raw.slice(0,EXCERPT),reason:d.reason,
   ...(d.escalated&&!from?{escalatedBy:H9}:{}),...(d.extension?{extended:true as const}:{}),...(from?{downgradedBy:DOWNGRADED,downgradedFrom:from}:{}),basisLabel:basisLabelOf(d,i.scope),sources:[...d.rule.sourceUrls]};
 }).sort((a,b)=>TIER_ORDER[a.tier]-TIER_ORDER[b.tier]||ascii(a.ruleId,b.ruleId));
 return {version:`${FRANCHISE_CLAIMS_VERSION}+${COMPLIANCE_LEXICON.version}`,issues,hardBlocked:issues.some(x=>x.tier==='hard_block'),blocked:issues.some(x=>x.tier!=='warn'),recruitmentContext:context,notice:COMPLIANCE_NOTICE,disclaimer:GATE_DISCLAIMER};
}

// ── 문구 ──
const REASON_TEXT:Record<FranchiseReason,string>={pattern:'',no_evidence:'근거 사실 없음',value_mismatch:'확정 사실 값과 다름',details_missing:'매장 유형·포함·불포함·면적 줄 없음',revenue_fact:'수익 항목 사실 값',review:'규칙 밖 표현이라 승인자 확인'};
const downgradeText=(x:FranchiseIssue)=>x.downgradedBy?`모집 문구 없는 소비자 캡션이라 경고, 모집 문구가 있으면 ${x.downgradedFrom==='hard_block'?'해제 불가 ':''}차단`:'';
export function franchiseIssueText(x:FranchiseIssue):string{
 const why=[REASON_TEXT[x.reason],x.escalatedBy?'첫 줄 수치 주장이라 차단(H9)':'',downgradeText(x)].filter(Boolean).join(' · ');
 const basis=x.escalatedBy&&!x.basisLabel.includes(GATE_DISCLAIMER)?`${x.basisLabel} · H9는 ${GATE_DISCLAIMER}`:x.basisLabel;
 return `${x.title}${why?`(${why})`:''} — “${x.excerpt}” (${basis})`;
}
// 게이트 409 문구. 해제 불가(hard_block)가 하나라도 있으면 승인으로 풀 수 없다고 먼저 알린다.
export function franchiseGateError(j:FranchiseJudgement):{status:409;message:string}|null{
 if(!j.blocked)return null;
 const hard=j.issues.filter(x=>x.tier==='hard_block');
 if(hard.length)return {status:409,message:`가맹 모집 규칙상 쓸 수 없는 표현입니다(승인으로 풀 수 없음): ${hard.map(franchiseIssueText).join(', ')}`};
 return {status:409,message:`가맹 모집 규칙상 근거 사실이 필요한 표현입니다: ${j.issues.filter(x=>x.tier==='block').map(franchiseIssueText).join(', ')}. 근거 사실을 확정하거나 표현을 고치세요.`};
}
// 승인 화면·캡션 후보용 한 줄 사유.
export function franchiseIssueLabels(j:FranchiseJudgement):{blockers:string[];warnings:string[]}{
 return {blockers:j.issues.filter(x=>x.tier!=='warn').map(x=>(x.tier==='hard_block'?'가맹 규칙(해제 불가) · ':'가맹 규칙 · ')+franchiseIssueText(x)),warnings:j.issues.filter(x=>x.tier==='warn').map(x=>'가맹 규칙 확인 · '+franchiseIssueText(x))};
}

// ── 각주가 필요한 언급 ──
// 캡션·카피에 나온 매장 수 주장(비교 방식으로 참인 사실: 'N여 개'·'N개 이상'도 그 사실을 근거로 쓴다)·비용 라벨 뒤 금액이 현재 가맹 사실 값과 같으면
// 그 사실의 정보공개서 각주가 캡션에 있어야 한다(lib/franchise-facts.ts footnoteIssues의 mentioned).
// 원시 부분 문자열로 대조하지 않는다('한정 12개, 대기 없음'은 가맹점 수 12의 언급이 아니다).
export function mentionedFranchiseFacts(i:Omit<FranchiseJudgeInput,'at'|'scope'>):BrandFact[]{
 const {current}=splitFacts({...i,at:i.now,scope:'consumer'}),original=new Map(i.facts.map(f=>[f.id,f])),out=new Map<string,BrandFact>(),text=normalized(i.text);
 const counts=countLedgerOf(current),add=(fs:Fact[]|undefined)=>{for(const f of fs??[])if(f.sourceRef&&original.has(f.id))out.set(f.id,original.get(f.id)!)};
 for(const x of sentencesOf(text))for(const kind of FR_KINDS){
  if(kind.kind==='매장 수'){for(const c of storeCountClaimList(x.s))for(const [v,fs] of counts[c.of])if(storeCountHolds(c,v))add(fs);continue}
  const body=kind.body(x.s);
  if(!body.length)continue;
  const ledger=ledgerOf(kind,current);
  for(const v of body)add(ledger.get(v));
 }
 return [...out.values()];
}

// ── 모집처럼 읽히는 소비자 캠페인 ──
// objective가 없는 캠페인(R2의 모든 캠페인)은 소비자 규칙만 적용한다. 모집처럼 읽히면 발행 승인 화면에만 경고하고 서버는 막지 않는다(결정 21·H7 문구 포함).
// 같은 문구가 캡션에 있으면 소비자 범위에서도 가맹 규칙이 막는다(judgeFranchiseText). 엄격한 모집 문구만 본다: 가맹 문의·상담·모집·개설·조건·계약·신청·설명회, 가맹점 모집,
// 창업 설명회·문의·상담·박람회·비용·아이템, 점주 모집, 예비 창업자, 가맹비·가맹금·가맹 보증금·가맹 교육비. '본사'·'창업 30주년'·'점포'·'가맹점에서 사용 가능'·'교육비'만으로는 아니다.
export const RECRUITMENT_LIKE=/가맹\s?(?:문의|상담|모집|개설|조건|사업\s?설명회|설명회|계약|신청|희망)|가맹점\s?(?:모집|개설)|가맹점주\s?모집|창업\s?(?:설명회|문의|상담|박람회|비용|비(?![가-힣])|아이템|희망자?)|점주\s?(?:님\s?)?(?:을\s?|를\s?)?(?:모집|모십니다|모셔요)|예비\s?(?:창업자|점주|가맹점주)|가맹비|가맹금|가맹\s?(?:가입비|보증금|교육비)|프랜차이즈\s?(?:창업|모집|문의|가맹)|[Ff]ranchise\s+(?:inquir|opportunit|recruit)/;
export function recruitmentWarning(branch:string):string{
 return '모집 캠페인처럼 보입니다. 이 캠페인에는 소비자 캠페인 규칙만 적용했습니다. 모집 광고는 모집 목표를 정한 캠페인으로 따로 만들어 승인받으세요.'+(branch!=='A'?' 분기 A가 아니면 유료 모집 광고·설명회·가맹 조건 제시를 하지 않습니다(H7).':'')+` ${GATE_DISCLAIMER}`;
}
