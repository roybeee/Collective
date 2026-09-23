import type {QualityReview} from '../quality';
import type {FactLedger} from './types';
import {COMPLIANCE_LEXICON,type ComplianceRule,type ComplianceSeverity,type ComplianceCategory} from './compliance-lexicon';
import {neutralize,negatedAt} from './negation';
export {COMPLIANCE_LEXICON,COMPLIANCE_CATEGORIES} from './compliance-lexicon';
export type {ComplianceRule,ComplianceSeverity,ComplianceCategory} from './compliance-lexicon';

// 규제·플랫폼·업종 표시 가드레일(A2) 판정 로직. 어휘는 compliance-lexicon.ts에 있다. 결과는 검토 신호이며 법률 판단이 아니다.
export const COMPLIANCE_NOTICE='이 검사는 표시·광고 관련 법령과 공식 지침의 일부 표현을 찾는 자동 점검이며 법률 자문이 아닙니다. 게시 전 담당자가 원문 규정과 플랫폼 정책을 확인해야 합니다.';
export type ComplianceIssue={category:ComplianceCategory;ruleId:string;severity:ComplianceSeverity;title:string;excerpt:string;sources:string[]};
export type ComplianceReport={version:string;issues:ComplianceIssue[];notice:string};

const MARKED=/\[[^\]]*(?:확인|예시)[^\]]*\]|확인\s?필요|미확정|자료\s?필요/;
// 인용한 경쟁점·위반 사례 문장은 우리 문안이 아니다. 따옴표 안 표현이면 block·warn 대신 info로 기록한다.
const CITED=/사례|위반\s?(?:예|소지)|경쟁\s?(?:점|사|매장)/,QUOTE=/[‘“"「『][^’”"」』]*[’”"」』]/g;
// '금지 사항'·'하지 않을 것' 같은 제목 아래 목록은 위반 문안이 아니다.
const NEGATED_HEADING=/^#{1,6}\s.*(?:(?:하지|쓰지|사용하지|넣지)\s?않을|금지\s?(?:사항|표현|목록|행위)|피할\s?(?:표현|것))/;
// 초안 라벨('문자 초안:', '## 알림톡 발송 문안 B')이면 판촉어를 뒤따르는 문단에서도 찾는다.
const DRAFT_LABEL=/(?:초안|문안|내용)$/,LABEL_TAIL=/^\s*[A-Za-z0-9가-힣]{0,2}\s*(?:[:：]|$)/;
const splitSentences=(line:string)=>line.split(/(?<=[.?!])\s+/).map(s=>s.trim()).filter(Boolean);
const confirmedKeys=(facts?:FactLedger|null)=>(facts?.confirmed||[]).map(f=>typeof f.key==='string'?f.key:'').filter(Boolean);
// 섹션: 제목 줄(#)과 구분선(---)으로 나눈 단위. context·cleared는 같은 섹션 안에서만 본다(여러 초안이 서로 해소하지 않게).
// 문장은 원문(s)과 부정 판정용으로 조건 주석·관용구를 지운 문장(n)을 함께 한 번만 만든다.
type Section={body:string;lines:string[];sentences:{s:string;n:string;line:number}[]};
function sectionsOf(text:string):Section[]{
 return text.split(/\n(?=#{1,6}\s)|\n\s*(?:-{3,}|\*{3,})\s*(?=\n|$)/).map(body=>{
  const lines=body.split('\n');
  return {body,lines,sentences:lines.flatMap((l,line)=>splitSentences(l).map(s=>({s,n:neutralize(s),line})))};
 });
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
  if(negatedAt(n,at,end))continue;
  const unit=rule.context&&DRAFT_LABEL.test(m[0])&&LABEL_TAIL.test(n.slice(end))?n+'\n'+draftBody():n;
  if(rule.context&&!new RegExp(rule.context).test(unit))continue;
  return {sentence:s,cited:CITED.test(n)&&inQuote(n,at)};
 }
 return undefined;
}
function sectionHits(rule:ComplianceRule,section:Section):Hit[]{
 if(NEGATED_HEADING.test(section.lines[0]||'')||rule.cleared&&new RegExp(rule.cleared).test(section.body))return [];
 return section.sentences.flatMap(({s,n,line})=>{const hit=sentenceHit(rule,s,n,()=>followingParagraph(section.lines,line));return hit?[hit]:[]});
}
// 규칙마다 첫 해당 문장 하나만 보고한다. 인용 사례만 있으면 info로 낮춘다. 입력을 바꾸지 않는다.
function ruleIssue(rule:ComplianceRule,sections:Section[],keys:string[]):ComplianceIssue[]{
 if(rule.ledgerKey&&keys.some(k=>new RegExp(rule.ledgerKey!).test(k)))return [];
 const hits=sections.flatMap(section=>sectionHits(rule,section)),hit=hits.find(h=>!h.cited)||hits[0];
 return hit?[{category:rule.category,ruleId:rule.id,severity:hit.cited?'info':rule.severity,title:rule.title,excerpt:hit.sentence.slice(0,60),sources:[...rule.sources]}]:[];
}
export function checkCompliance(text:string,opts:{facts?:FactLedger|null}={}):ComplianceReport{
 const sections=sectionsOf(text),keys=confirmedKeys(opts.facts);
 return {version:COMPLIANCE_LEXICON.version,issues:COMPLIANCE_LEXICON.rules.flatMap(rule=>ruleIssue(rule,sections,keys)),notice:COMPLIANCE_NOTICE};
}
// 판정은 하향만 한다. 차단(block)이 있으면 사용자 검토 준비를 수정 필요로 내리고, 경고·정보와 무위반은 판정을 바꾸지 않는다.
export function downgradeVerdict(verdict:QualityReview['verdict'],issues:Pick<ComplianceIssue,'severity'>[]):QualityReview['verdict']{
 return verdict==='ready_for_review'&&issues.some(i=>i.severity==='block')?'revise':verdict;
}
