import type {QualityReview} from '../quality';
import type {FactLedger} from './types';
import {COMPLIANCE_LEXICON,type ComplianceRule,type ComplianceSeverity,type ComplianceCategory} from './compliance-lexicon';
export {COMPLIANCE_LEXICON,COMPLIANCE_CATEGORIES} from './compliance-lexicon';
export type {ComplianceRule,ComplianceSeverity,ComplianceCategory} from './compliance-lexicon';

// 규제·플랫폼·업종 표시 가드레일(A2) 판정 로직. 어휘는 compliance-lexicon.ts에 있다. 결과는 검토 신호이며 법률 판단이 아니다.
export const COMPLIANCE_NOTICE='이 검사는 표시·광고 관련 법령과 공식 지침의 일부 표현을 찾는 자동 점검이며 법률 자문이 아닙니다. 게시 전 담당자가 원문 규정과 플랫폼 정책을 확인해야 합니다.';
export type ComplianceIssue={category:ComplianceCategory;ruleId:string;severity:ComplianceSeverity;title:string;excerpt:string;sources:string[]};
export type ComplianceReport={version:string;issues:ComplianceIssue[];notice:string};

// 부정·배제 문장은 위반 표현을 쓴 것으로 보지 않는다. '없습니다'는 '부작용이 없습니다' 같은 효능 주장을 면제하므로 넣지 않는다.
const NEGATION=/[가-힣]지\s?(?:않|말)|금지|하지\s?않|제외|삭제|피합니다|피한다/;
const MARKED=/\[[^\]]*(?:확인|예시)[^\]]*\]|확인\s?필요|미확정|자료\s?필요/;
const sentencesOf=(text:string)=>text.split('\n').flatMap(line=>line.split(/(?<=[.?!])\s+/)).map(s=>s.trim()).filter(Boolean);
const confirmedKeys=(facts?:FactLedger|null)=>(facts?.confirmed||[]).map(f=>typeof f.key==='string'?f.key:'').filter(Boolean);

function ruleHit(rule:ComplianceRule,text:string,sentences:string[],keys:string[]){
 if(rule.context&&!new RegExp(rule.context).test(text))return undefined;
 if(rule.cleared&&new RegExp(rule.cleared).test(text))return undefined;
 if(rule.ledgerKey&&keys.some(k=>new RegExp(rule.ledgerKey!).test(k)))return undefined;
 const match=new RegExp(rule.match),also=rule.also?new RegExp(rule.also):null;
 return sentences.find(s=>match.test(s)&&(!also||also.test(s))&&!NEGATION.test(s)&&!(rule.marked&&MARKED.test(s)));
}
// 규칙마다 첫 해당 문장 하나만 보고한다. 입력을 바꾸지 않는다.
export function checkCompliance(text:string,opts:{facts?:FactLedger|null}={}):ComplianceReport{
 const sentences=sentencesOf(text),keys=confirmedKeys(opts.facts);
 const issues=COMPLIANCE_LEXICON.rules.flatMap(rule=>{
  const hit=ruleHit(rule,text,sentences,keys);
  return hit?[{category:rule.category,ruleId:rule.id,severity:rule.severity,title:rule.title,excerpt:hit.slice(0,60),sources:[...rule.sources]}]:[];
 });
 return {version:COMPLIANCE_LEXICON.version,issues,notice:COMPLIANCE_NOTICE};
}
// 판정은 하향만 한다. 차단(block)이 있으면 사용자 검토 준비를 수정 필요로 내리고, 경고·정보와 무위반은 판정을 바꾸지 않는다.
export function downgradeVerdict(verdict:QualityReview['verdict'],issues:Pick<ComplianceIssue,'severity'>[]):QualityReview['verdict']{
 return verdict==='ready_for_review'&&issues.some(i=>i.severity==='block')?'revise':verdict;
}
