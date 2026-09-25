import type {QualityReview} from '../quality';
import type {FactLedger} from './types';
import {COMPLIANCE_LEXICON,HELD_MARK,type ComplianceRule,type ComplianceSeverity,type ComplianceCategory} from './compliance-lexicon';
import {neutralize,negatedAt,prohibitiveLabel} from './negation';
export {COMPLIANCE_LEXICON,COMPLIANCE_CATEGORIES} from './compliance-lexicon';
export type {ComplianceRule,ComplianceSeverity,ComplianceCategory} from './compliance-lexicon';

// 규제·플랫폼·업종 표시 가드레일(A2) 판정 로직. 어휘는 compliance-lexicon.ts에 있다. 결과는 검토 신호이며 법률 판단이 아니다.
export const COMPLIANCE_NOTICE='이 검사는 표시·광고 관련 법령과 공식 지침의 일부 표현을 찾는 자동 점검이며 법률 자문이 아닙니다. 게시 전 담당자가 원문 규정과 플랫폼 정책을 확인해야 합니다.';
export type ComplianceIssue={category:ComplianceCategory;ruleId:string;severity:ComplianceSeverity;title:string;excerpt:string;sources:string[]};
export type ComplianceReport={version:string;issues:ComplianceIssue[];notice:string};

const MARKED=/\[[^\]]*(?:확인|예시)[^\]]*\]|확인\s?필요|미확정|자료\s?필요/;
// 인용한 경쟁점·위반 사례 문장은 우리 문안이 아니다. 따옴표 안 표현이면 block·warn 대신 info로 기록한다.
const CITED=/사례|위반\s?(?:예|소지)|경쟁\s?(?:점|사|매장)/,QUOTE=/[‘“"「『][^’”"」』]*[’”"」』]/g;
// '금지 사항'·'하지 않을 것' 같은 제목 아래 목록은 위반 문안이 아니다. '금지 또는 보류 표현'처럼 제목 전체가 금지·보류 목록이어도 같다(채점기와 같은 판별, negation.ts).
const NEGATED_HEADING=/^#{1,6}\s.*(?:(?:하지|쓰지|사용하지|넣지)\s?않을|금지\s?(?:사항|표현|목록|행위)|피할\s?(?:표현|것))/,HEADING=/^#{1,6}\s+(.*)$/;
const negatedHeading=(line:string)=>NEGATED_HEADING.test(line)||prohibitiveLabel(HEADING.exec(line)?.[1]||'');
// 초안 라벨('문자 초안:', '## 알림톡 발송 문안 B')이면 판촉어를 뒤따르는 문단에서도 찾는다.
const DRAFT_LABEL=/(?:초안|문안|내용)$/,LABEL_TAIL=/^\s*[A-Za-z0-9가-힣]{0,2}\s*(?:[:：]|$)/;
const splitSentences=(line:string)=>line.split(/(?<=[.?!])\s+/).map(s=>s.trim()).filter(Boolean);
const confirmedKeys=(facts?:FactLedger|null)=>(facts?.confirmed||[]).map(f=>typeof f.key==='string'?f.key:'').filter(Boolean);
// 섹션: 렌더본의 계약 섹션(#·## 제목과 구분선 --- 사이). 단락: 그 안을 ###~###### 소제목으로 나눈 초안 단위.
// context·cleared는 같은 단락 안에서 본다(한 초안의 (광고)·#광고가 다른 초안의 누락을 덮지 않게). 표기 문장만 같은 섹션의 다른 단락을 해소한다.
// 문장은 원문(s)과 부정 판정용으로 조건 주석·관용구를 지운 문장(n)을 함께 한 번만 만든다.
type Part={body:string;lines:string[];sentences:{s:string;n:string;line:number}[]};
type Section={parts:Part[]};
function partOf(body:string):Part{
 const lines=body.split('\n');
 return {body,lines,sentences:lines.flatMap((l,line)=>splitSentences(l).map(s=>({s,n:neutralize(s),line})))};
}
function sectionsOf(text:string):Section[]{
 return text.split(/\n(?=#{1,2}\s)|\n\s*(?:-{3,}|\*{3,})\s*(?=\n|$)/).map(body=>({parts:body.split(/\n(?=#{3,6}\s)/).map(partOf)}));
}
// 표기 문장: 해소 표현 바로 뒤에 '표기·표시·태그'나 '을/를 + 표시 동사'가 오거나('(광고) 표기를 넣는다', '#광고를 붙인다'), 따옴표가 해소 표현만 감싸고 문장에 표시 동사가 있거나
// ('해당 문안에 ‘#광고’를 표시한다'), 표현 자체가 표시 서술인 문장('광고 표기를 넣는다')이다. 부정·생략된 표기('‘#광고’를 표시하지 않는다', '‘#광고’ 표기는 생략한다')는 표기 문장이 아니다.
// 초안에 그냥 붙인 표기('… #광고', '“#광고 오늘 …”', '(광고) 가상분식 …', '소정의 원고료를 받아 작성한 글', '12,000원과 음료')는 그 단락만 해소한다.
const WRAP_OPEN=/[‘“'"「『]\s?$/,WRAP_CLOSE=/^\s?[’”'"」』]/,MENTIONED=/^\s?(?:표기|표시|문구|해시태그|태그|라벨|[을를]\s?(?:표시|표기|넣|붙|달|명시|밝|고지|포함))/;
const DESCRIBES=/표기|표시|넣|명시|붙|밝|공개|고지/,OMITTED=/생략|빼|없이|숨기|지우|제거/;
function statesDisclosure(n:string,cleared:string){
 return [...n.matchAll(new RegExp(cleared,'g'))].some(m=>{
  const at=m.index!,end=at+m[0].length,after=n.slice(end,end+60);
  const states=DESCRIBES.test(m[0])||MENTIONED.test(after)||WRAP_OPEN.test(n.slice(0,at))&&WRAP_CLOSE.test(after)&&DESCRIBES.test(n);
  return states&&!negatedAt(n,at,end)&&!OMITTED.test(after.split(/[.,，;；]/)[0]);
 });
}
// 추천·보증 매치의 중단·점검 조건 면제: 매치가 든 절이 표기 누락을 조건으로 적고, 그 조건으로 문장이 끝나거나('광고·협찬 콘텐츠에 필요한 표시가 누락될 때.')
// 뒤따르는 결과가 시정 조치다('표기가 빠지면 내린다', '누락될 때 수정한다'). '표기가 없으면 반응이 좋으니 그대로 올린다', '표시가 누락될 때에는 직원이 후기를 올린다'는 면제하지 않는다.
// 부정 나열('위장 후기·… 없음')·보류('집행 보류')·'확정하지 않고'는 공용 부정 판별(negatedAt)이 맡는다. 이 조건은 부정이 아니라 가드레일 전용이다.
// 절 단위로만 본다: '직원이 후기를 작성해 올리고 표시가 누락될 때 수정한다'의 앞 절(가짜 후기)은 면제하지 않는다.
const OMISSION_CONDITION=/(?:표시|표기|고지|문구|해시태그)[^.\n]{0,8}(?:누락|빠지|빠질|빠졌|생략되|없)[가-힣]{0,3}\s?(?:때|경우|면|시)(?:에는|에|마다|는)?(?![가-힣])/;
const CORRECTIVE=/내리|내린|내려|중단|멈추|멈춘|수정|보완|반려|삭제|보류|교체|재검토|비공개|추가|보충|(?:표기|표시|문구)[^.\n]{0,6}(?:넣|달|붙)|(?:게시|올리|발행|노출)(?:하)?지\s?않/;
const CLAUSE_CUT=/[,，;；—–]|(?<![광재참최공신경원창])고\s|(?:며|면서|지만|는데|으나|니까)\s/,CLAUSE=40;
function stopCondition(n:string,at:number,end:number){
 const lead=Math.max(0,at-CLAUSE),before=n.slice(lead,at),cut=[...before.matchAll(new RegExp(CLAUSE_CUT.source,'g'))].pop();
 const from=lead+(cut?cut.index!+cut[0].length:0),to=end+n.slice(end,end+CLAUSE).split(CLAUSE_CUT)[0].length,c=OMISSION_CONDITION.exec(n.slice(from,to));
 if(!c)return false;
 const tail=from+c.index+c[0].length,result=n.slice(tail,tail+60).split(/[.!?\n]/)[0];
 return !result.replace(/[\s,，;；:：)）\]]/g,'')||CORRECTIVE.test(result);
}
// 매치 자리 판정(rule.held): 매치가 든 절(쉼표·연결 어미·줄표 사이)에서 매치를 HELD_MARK로 바꾼 문자열로 본다. 같은 문장의 다른 문구 보류가 이 매치를 면제하지 않게 한다.
// 절 경계는 문장마다 한 번만 찾는다(한 문장의 매치는 연달아 판정되므로 마지막 문장 하나만 기억한다).
function lastSentence<T>(fn:(n:string)=>T){
 let last:{n:string;value:T}|undefined;
 return (n:string)=>{if(last?.n!==n)last={n,value:fn(n)};return last.value};
}
// 인용 문구 나열('“상품 선택하기”, “구매하기” 중 하나') 사이 쉼표는 절 경계가 아니다. 나열 앞의 조건('확인한 뒤')이 나열 전체에 걸린다.
const listComma=(n:string,i:number)=>/[,，]/.test(n[i])&&/[”’"']\s*$/.test(n.slice(Math.max(0,i-3),i))&&/^\s*[“‘"']/.test(n.slice(i+1,i+4));
// 대괄호 자리 표시 안의 쉼표·줄표('[가격 확정 후 검토 — 구매하기]')도 절 경계가 아니다. 자리 표시 전체가 한 조건이다(R3 재채점 뒤 MAPDAL 콘텐츠).
const inBracket=(n:string,i:number)=>n.lastIndexOf('[',i)>n.lastIndexOf(']',i);
const cutsOf=lastSentence(n=>{const cuts=[...n.matchAll(new RegExp(CLAUSE_CUT.source,'g'))].filter(c=>!listComma(n,c.index!)&&!inBracket(n,c.index!));return {starts:cuts.map(c=>c.index!),ends:cuts.map(c=>c.index!+c[0].length)}});
function clauseAround(n:string,at:number,end:number){
 const {starts,ends}=cutsOf(n),before=ends.filter(e=>e<=at),next=starts.findIndex(i=>i>=end);
 return n.slice(before.length?before[before.length-1]:0,at)+HELD_MARK+n.slice(end,next>=0?ends[next]:n.length);
}
type Hit={sentence:string;cited:boolean};

// 라벨 줄 다음의 첫 문단(빈 줄 전까지). 초안 라벨에 걸렸을 때만 계산한다.
function followingParagraph(lines:string[],from:number){
 let start=from+1;
 while(start<lines.length&&!lines[start].trim())start++;
 let end=start;
 while(end<lines.length&&lines[end].trim())end++;
 return lines.slice(start,end).join('\n');
}
const inQuote=(s:string,i:number)=>[...s.matchAll(QUOTE)].some(q=>i>q.index!&&i<q.index!+q[0].length);
// 문장 s(원문)·n(neutralize 결과)에서 규칙이 부정되지 않은 채 걸리는 첫 위치.
function sentenceHit(rule:ComplianceRule,s:string,n:string,draftBody:()=>string):Hit|undefined{
 if(rule.also&&!new RegExp(rule.also).test(n)||rule.except&&new RegExp(rule.except).test(n)||rule.marked&&MARKED.test(s))return undefined;
 for(const m of n.matchAll(new RegExp(rule.match,'g'))){
  const at=m.index!,end=at+m[0].length;
  if(negatedAt(n,at,end)||rule.category==='endorsement'&&stopCondition(n,at,end)||rule.held&&new RegExp(rule.held).test(clauseAround(n,at,end)))continue;
  const unit=rule.context&&DRAFT_LABEL.test(m[0])&&LABEL_TAIL.test(n.slice(end))?n+'\n'+draftBody():n;
  if(rule.context&&!new RegExp(rule.context).test(unit))continue;
  return {sentence:s,cited:CITED.test(n)&&inQuote(n,at)};
 }
 return undefined;
}
function partHits(rule:ComplianceRule,part:Part):Hit[]{
 if(negatedHeading(part.lines[0]||'')||rule.cleared&&new RegExp(rule.cleared).test(part.body))return [];
 return part.sentences.flatMap(({s,n,line})=>{const hit=sentenceHit(rule,s,n,()=>followingParagraph(part.lines,line));return hit?[hit]:[]});
}
function sectionHits(rule:ComplianceRule,section:Section):Hit[]{
 const hits=section.parts.flatMap(part=>partHits(rule,part));
 return hits.length&&rule.cleared&&section.parts.some(p=>p.sentences.some(({n})=>statesDisclosure(n,rule.cleared!)))?[]:hits;
}
// 규칙마다 첫 해당 문장 하나만 보고한다. 인용 사례만 있으면 info로 낮춘다. 입력을 바꾸지 않는다.
function ruleIssue(rule:ComplianceRule,sections:Section[],keys:string[]):ComplianceIssue[]{
 if(rule.ledgerKey&&keys.some(k=>new RegExp(rule.ledgerKey!).test(k)))return [];
 const hits=sections.flatMap(section=>sectionHits(rule,section)),hit=hits.find(h=>!h.cited)||hits[0];
 return hit?[{category:rule.category,ruleId:rule.id,severity:hit.cited?'info':rule.severity,title:rule.title,excerpt:hit.sentence.slice(0,60),sources:[...rule.sources]}]:[];
}
// 표의 금지·보류·실패 기준 열('| 기준 | 통과 조건 | 실패 기준 |', '| 표현 | 사용하지 않을 표현 |')은 규칙 목록이라 그 칸을 비우고 검사한다. 다른 열은 그대로 본다.
function withoutProhibitedCells(text:string){
 let banned:number[]|null=null;
 return text.split('\n').map(line=>{
  if(!line.trim().startsWith('|')){banned=null;return line}
  const cells=line.trim().split('|');
  if(banned===null){banned=cells.flatMap((c,i)=>c.trim()&&prohibitiveLabel(c.replace(/\s?(?:사유|이유)\s*$/,'').trim())?[i]:[]);return line}
  if(/^\|?\s*:?-{3,}/.test(line.trim()))return line;
  return banned.length?cells.map((c,i)=>banned!.includes(i)?' ':c).join('|'):line;
 }).join('\n');
}
// '다음 상황에서는 … 중단한다'처럼 중단·수정·보류 조건을 여는 리드 문장 바로 아래 목록(빈 줄 하나 허용)은 중단 조건 목록이라 비우고 검사한다.
// 목록이 끝난 뒤 문장과, 리드가 중단 조건이 아닌 목록('아래 문안을 게시한다')은 그대로 본다(2026-09-25 ODA cmo 기준선 v1 문장, 제목이 없을 때).
const STOP_LEAD=/(?:다음|아래)\s?(?:상황|경우|조건|신호)(?:에서는|에는|에서|이면|일\s?때|가\s?(?:보이면|나오면))?[^.\n]{0,40}(?:중단|중지|멈추|멈춘|수정|보류|회수|내리|내린)(?:한다|합니다|하고|해야|하세요|다|ㅂ니다)?[.:：]?\s*$/;
const LIST_ITEM=/^\s*(?:[-*•·]|\d+[.)])\s/;
function withoutStopLists(text:string){
 let state:'none'|'lead'|'list'='none';
 return text.split('\n').map(line=>{
  if(state!=='none'&&LIST_ITEM.test(line)){state='list';return ''}
  if(state==='lead'&&!line.trim())return line;
  state=!LIST_ITEM.test(line)&&STOP_LEAD.test(line.trim())?'lead':'none';
  return line;
 }).join('\n');
}
// 가맹 범주(franchise_recruit, 트랙 R R2)는 opts.franchise로 옵트인할 때만 본다. 기본 호출(온라인 채점·평가)의 이슈 목록은 이전과 같다(사전 버전 문자열만 바뀐다).
// scope 'recruitment' 규칙(생산·판매 채널 표현)은 모집 범위에서만 본다. 캡션·발행 게이트는 이 경로가 아니라 lib/franchise-compliance.ts가 직접 판정한다.
export type FranchiseComplianceScope={scope:'consumer'|'recruitment'};
const skipped=(rule:ComplianceRule,franchise?:FranchiseComplianceScope|null)=>rule.category==='franchise_recruit'&&(!franchise||(rule.scope==='recruitment'&&franchise.scope!=='recruitment'));
export function checkCompliance(text:string,opts:{facts?:FactLedger|null;franchise?:FranchiseComplianceScope|null}={}):ComplianceReport{
 const sections=sectionsOf(withoutStopLists(withoutProhibitedCells(text))),keys=confirmedKeys(opts.facts),franchise=opts.franchise;
 return {version:COMPLIANCE_LEXICON.version,issues:COMPLIANCE_LEXICON.rules.flatMap(rule=>skipped(rule,franchise)?[]:ruleIssue(rule,sections,keys)),notice:COMPLIANCE_NOTICE};
}
// 판정은 하향만 한다. 차단(block)이 있으면 사용자 검토 준비를 수정 필요로 내리고, 경고·정보와 무위반은 판정을 바꾸지 않는다.
export function downgradeVerdict(verdict:QualityReview['verdict'],issues:Pick<ComplianceIssue,'severity'>[]):QualityReview['verdict']{
 return verdict==='ready_for_review'&&issues.some(i=>i.severity==='block')?'revise':verdict;
}
