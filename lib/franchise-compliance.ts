// 트랙 R R2 가맹 모집 규제 가드레일 판정기(순수). 가맹 프로필이 있는 브랜드의 캡션·발행 게이트가 캡션 본문을 직접 판정한다.
// 기존 A2 경로(lib/graders/compliance.ts)의 원장 해소(ledgerKey)·[확인 필요] 면제(marked)·인용 강등(cited→info)을 거치지 않는다. 입력에 해제·우회 인자는 없다.
// 공식 규칙의 표현은 규제 사전(범주 franchise_recruit), 휴리스틱 표현·근거 조건·해제 불가 목록은 lib/franchise-rules.ts에 있다. 시계를 읽지 않는다(at·now 인자).
// 결정 20(법률 검토 보류)·결정 25(대표 기본값): 결과마다 공식 규정·휴리스틱 구분을 싣고, 휴리스틱은 'COLLECTIVE 휴리스틱 · 법률 자문 아님'을 붙인다. 법적 적합성을 주장하지 않는다.
// 모델 경계: lib/franchise.ts·lib/franchise-server.ts·lib/franchise-crypto.ts를 import하지 않는다(tests/franchise-model-boundary.test.mjs). 모델 입력(프롬프트)은 바꾸지 않는다.
import type {BrandFact} from './brand-facts';
import {COMPLIANCE_LEXICON,type ComplianceRule} from './graders/compliance-lexicon';
import {COMPLIANCE_NOTICE} from './graders/compliance';
import {VALUE_KINDS,krwAmounts} from './graders/ledger';
import {neutralize,negatedAt} from './graders/negation';
import {FRANCHISE_CLAIMS_VERSION,FRANCHISE_CLAIM_EVIDENCE,FRANCHISE_CLAIM_LOGIC,FRANCHISE_CLAIM_MATCHERS,FRANCHISE_HARD_BLOCK_IDS,kstDateOf,rulesAt,type ClaimEvidence,type FranchiseRule,type RuleBasis,type RuleScope} from './franchise-rules';
import {franchiseFactKey,franchiseItem} from './fact-catalog';
import {costDetailLine,versionStates,type VersionLite} from './franchise-facts';
import {GATE_DISCLAIMER} from './franchise-gates';

export type ClaimScope='consumer'|'recruitment';
// facts: 캠페인 범위의 유효 확정 사실(lib/brand-facts-server.ts confirmedFactContext, sourceRef 포함). at: 규칙 선택 시각(발행 예약 시각 등). now: 정보공개서 버전 상태 판정 시각.
export type FranchiseJudgeInput={text:string;at:string;now:string;scope:ClaimScope;brandId:string;facts:readonly BrandFact[];versions:readonly VersionLite[]};
export type FranchiseTier='hard_block'|'block'|'warn';
export type FranchiseReason='pattern'|'no_evidence'|'value_mismatch'|'details_missing'|'revenue_fact';
export type FranchiseIssue={ruleId:string;registryId:string;tier:FranchiseTier;basis:RuleBasis;registryScope:RuleScope;title:string;article:string;excerpt:string;reason:FranchiseReason;escalatedBy?:'h.headline_claim_block';basisLabel:string;sources:readonly string[]};
export type FranchiseJudgement={version:string;issues:FranchiseIssue[];hardBlocked:boolean;blocked:boolean;notice:string;disclaimer:string};

const H8='h.fact_opinion_labels',H9='h.headline_claim_block' as const,H6='h.revenue_figures_no_ad';
const H8_TITLE='가맹 수치 문장의 [사실] 표지·정보공개서 각주 없음(H8)';
// 가맹사업법·시행령·고시 제2019-8호만 근거인 공식 규칙은 가맹희망자 정보제공 규정이다. 소비자 캠페인에 거는 것은 결정 25의 적용 범위 선택이라 휴리스틱 표시를 덧붙인다.
const FRANCHISE_LAW_SOURCES=new Set(['franchise_act','franchise_decree','franchise_false_info_notice']);
const STORE_COUNT_RULE='kr.fr.store_count_claims',STARTUP_COST_RULE='kr.fr.startup_cost_claims';
const VALUE_RULES=new Set([STORE_COUNT_RULE,STARTUP_COST_RULE]);
const COUNT_KEYS=['franchise_store_count','direct_store_count'];
const COST_KEYS=['startup_cost_total','franchise_fee','education_fee','franchise_deposit','interior_cost','royalty_fee'];
const FR_KINDS=VALUE_KINDS.filter(k=>k.franchise);
const EXCERPT=60;
// H9 수치 주장: 금액, 비율, 거리(가맹 값 종류 본문 값은 따로 본다).
const NUMERIC=/\d+(?:\.\d+)?\s?%|\d+(?:\.\d+)?\s?(?:km|㎞|m|미터)(?![A-Za-z])/;

const compactText=(s:string)=>s.normalize('NFKC').replace(/\s+/g,'').toLowerCase();
type Sentence={s:string;n:string;line:number};
function sentencesOf(text:string):Sentence[]{
 return text.split('\n').flatMap((l,line)=>l.split(/(?<=[.?!])\s+/).map(s=>s.trim()).filter(Boolean).map(s=>({s,n:neutralize(s),line})));
}
type Matcher={match:string;also?:string;except?:string;cleared?:string};
// 부정되지 않은 적중 문장. all이 아니면 첫 문장에서 멈춘다. 매치가 부정문('수익을 보장하지 않습니다')이면 그 매치는 세지 않는다.
function hitSentences(m:Matcher,sentences:Sentence[],all:boolean):Sentence[]{
 const match=new RegExp(m.match,'g'),also=m.also?new RegExp(m.also):null,except=m.except?new RegExp(m.except):null,out:Sentence[]=[];
 for(const x of sentences){
  if(also&&!also.test(x.n)||except&&except.test(x.n))continue;
  for(const hit of x.n.matchAll(match)){
   if(negatedAt(x.n,hit.index!,hit.index!+hit[0].length))continue;
   out.push(x);break;
  }
  if(out.length&&!all)break;
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
const integerOf=(v:string)=>{const m=/\d[\d,]*/.exec(v);return m?String(Number(m[0].replace(/,/g,''))):null};
// 값 종류별 원장: 값 → 그 값을 가진 현재 사실. '매장 수'는 기준일(asOf)이 있는 가맹점 수·직영점 수와 그 합이다.
function ledgerOf(kind:typeof FR_KINDS[number],current:Fact[]):Map<string,Fact[]>{
 const out=new Map<string,Fact[]>(),add=(v:string,fs:Fact[])=>out.set(v,[...(out.get(v)??[]),...fs]);
 if(kind.kind==='매장 수'){
  const counted=current.filter(f=>COUNT_KEYS.includes(f.frKey)&&!!f.sourceRef?.asOf);
  for(const f of counted){const v=integerOf(f.value);if(v!==null)add(v,[f])}
  const franchised=counted.find(f=>f.frKey==='franchise_store_count'),direct=counted.find(f=>f.frKey==='direct_store_count');
  const a=franchised?integerOf(franchised.value):null,b=direct?integerOf(direct.value):null;
  if(franchised&&direct&&a!==null&&b!==null)add(String(Number(a)+Number(b)),[franchised,direct]);
  return out;
 }
 for(const f of current.filter(f=>kind.key.test(f.frKey)))for(const v of kind.ledger(f.value))add(v,[f]);
 return out;
}
type ValueFailure={reason:'no_evidence'|'value_mismatch'|'details_missing'};
// 적중 문장 하나의 값 대조. 본문 값이 없으면(금액이 아닌 '로열티: 매출의 3%') 그 종류의 현재 사실 값이 본문에 있을 때만 통과한다. 매장 수는 값이 없으면 근거 없음('오픈 예정 N개').
function valueFailure(x:Sentence,kinds:string[],current:Fact[],text:string):ValueFailure|null{
 let found=false;
 for(const kind of FR_KINDS.filter(k=>kinds.includes(k.kind))){
  const body=kind.body(x.s);
  if(!body.length)continue;
  found=true;
  const ledger=ledgerOf(kind,current);
  if(!ledger.size)return {reason:'no_evidence'};
  if(body.some(v=>!ledger.has(v)))return {reason:'value_mismatch'};
  // 창업비용은 값이 맞아도 그 사실의 매장 유형·포함·불포함·면적 줄이 본문에 있어야 한다.
  if(kind.kind==='창업비용'&&body.some(v=>{const fs=ledger.get(v)!.filter(f=>!!f.cost);return fs.length>0&&!fs.some(f=>text.includes(costDetailLine(f.cost!)))}))return {reason:'details_missing'};
 }
 if(found)return null;
 if(kinds.includes('매장 수'))return {reason:'no_evidence'};
 const body=compactText(text);
 return current.some(f=>COST_KEYS.includes(f.frKey)&&compactText(f.value).length>=2&&body.includes(compactText(f.value)))?null:{reason:'no_evidence'};
}
function evidenceMet(e:ClaimEvidence,current:Fact[],text:string):boolean{
 const body=compactText(text),inText=(k:string)=>current.some(f=>f.frKey===k&&compactText(f.value).length>0&&body.includes(compactText(f.value)));
 if(e.kind==='fact_exists')return current.some(f=>e.factKeys.includes(f.frKey));
 if(e.kind==='fact_in_text')return (e.all?e.factKeys.every(inText):e.factKeys.some(inText))&&(!e.marker||new RegExp(e.marker).test(text));
 if(e.kind==='fact_value'){const ok=new RegExp(e.valuePattern),no=e.notPattern?new RegExp(e.notPattern):null;return current.some(f=>f.frKey===e.factKey&&ok.test(f.value)&&!(no&&no.test(f.value)))}
 return false;
}

// ── 판정 ──
type Draft={rule:FranchiseRule;ruleId:string;title:string;lexicon?:ComplianceRule;reason:FranchiseReason;sentence:Sentence;tier:FranchiseTier;escalated?:boolean};
const tierOf=(r:FranchiseRule):FranchiseTier=>(FRANCHISE_HARD_BLOCK_IDS as readonly string[]).includes(r.id)?'hard_block':r.tier==='warn'?'warn':'block';
function basisLabelOf(d:Draft,scope:ClaimScope){
 if(d.rule.basis==='heuristic')return GATE_DISCLAIMER;
 if(d.rule.basis==='platform')return '플랫폼 정책';
 const consumerNote=scope==='consumer'&&!!d.lexicon&&d.lexicon.sources.every(s=>FRANCHISE_LAW_SOURCES.has(s));
 return `공식 규정 · ${d.rule.article}`+(consumerNote?` · 소비자 캠페인 적용은 ${GATE_DISCLAIMER}`:'');
}
const TIER_ORDER:Record<FranchiseTier,number>={hard_block:0,block:1,warn:2};
const ascii=(a:string,b:string)=>a<b?-1:a>b?1:0;
// H9 수치 주장: 가맹 값 종류 본문 값, 원화 금액, 비율, 거리.
const numericClaim=(s:string)=>FR_KINDS.some(k=>k.body(s).length>0)||krwAmounts(s).length>0||NUMERIC.test(s);
export function judgeFranchiseText(i:FranchiseJudgeInput):FranchiseJudgement{
 const text=typeof i.text==='string'?i.text:'',sentences=sentencesOf(text),date=kstDateOf(i.at);
 const applicable=rulesAt(date).filter(r=>r.scope==='franchise_brand'||(r.scope==='objective_export'&&i.scope==='recruitment'));
 const applies=(id:string)=>applicable.some(r=>r.id===id);
 const {current,stale}=splitFacts(i);
 const drafts:Draft[]=[],valueHits:Sentence[]=[];
 for(const rule of applicable){
  const source=claimSourceOf(rule);
  if(!source||source.kind==='logic')continue;
  const lexicon=source.kind==='lexicon'?source.rule:undefined,matcher=lexicon??FRANCHISE_CLAIM_MATCHERS[rule.id];
  const ruleId=lexicon?lexicon.id:rule.id,title=lexicon?lexicon.title:FRANCHISE_CLAIM_MATCHERS[rule.id].title;
  if(matcher.cleared&&new RegExp(matcher.cleared).test(text))continue;
  const evidence=FRANCHISE_CLAIM_EVIDENCE[ruleId],values=evidence?.kind==='values';
  const hits=hitSentences(matcher,sentences,values);
  if(!hits.length)continue;
  const draft=(reason:FranchiseReason,sentence:Sentence)=>drafts.push({rule,ruleId,title,lexicon,reason,sentence,tier:tierOf(rule)});
  if(!evidence){draft('pattern',hits[0]);continue}
  if(evidence.kind==='values'){
   if(VALUE_RULES.has(ruleId))valueHits.push(...hits);
   for(const x of hits){const f=valueFailure(x,[...evidence.valueKinds],current,text);if(f){draft(f.reason,x);break}}
   continue;
  }
  if(!evidenceMet(evidence,current,text))draft('no_evidence',hits[0]);
 }
 // H6: 수익 항목(adUse:false) 사실 값이 본문에 있으면 표현과 관계없이 해제 불가 차단이다(교체된 버전 사실 포함).
 const h6=applicable.find(r=>r.id===H6);
 if(h6&&!drafts.some(d=>d.ruleId===H6)){
  const values=[...current,...stale].filter(f=>franchiseItem(f.frKey)?.adUse===false).map(f=>compactText(f.value)).filter(v=>v.length>=4);
  const x=sentences.find(s=>values.some(v=>compactText(s.s).includes(v)))??(values.some(v=>compactText(text).includes(v))?sentences[0]:undefined);
  if(x)drafts.push({rule:h6,ruleId:H6,title:FRANCHISE_CLAIM_MATCHERS[H6].title,reason:'revenue_fact',sentence:x,tier:tierOf(h6)});
 }
 // H8: 매장 수·창업비용 주장 문장이 있는데 [사실] 표지도 정보공개서 각주도 없으면 경고.
 const h8=applicable.find(r=>r.id===H8);
 if(h8&&valueHits.length&&!/\[사실/.test(text)&&!text.includes('※ 정보공개서')){
  const first=[...valueHits].sort((a,b)=>sentences.indexOf(a)-sentences.indexOf(b))[0];
  drafts.push({rule:h8,ruleId:H8,title:H8_TITLE,reason:'pattern',sentence:first,tier:'warn'});
 }
 // H9: 첫 줄(비어 있지 않은 첫 줄)의 경고 가운데 수치 주장이 있는 것은 차단으로 올린다. H8은 문서 단위 표지 경고라 올리지 않는다.
 const headline=sentences[0]?.line;
 if(applies(H9)&&headline!==undefined)for(const d of drafts)if(d.tier==='warn'&&d.ruleId!==H8&&d.sentence.line===headline&&numericClaim(d.sentence.s)){d.tier='block';d.escalated=true}
 const issues:FranchiseIssue[]=drafts.map(d=>({ruleId:d.ruleId,registryId:d.rule.id,tier:d.tier,basis:d.rule.basis,registryScope:d.rule.scope!,title:d.title,article:d.rule.article,excerpt:d.sentence.s.slice(0,EXCERPT),reason:d.reason,...(d.escalated?{escalatedBy:H9}:{}),basisLabel:basisLabelOf(d,i.scope),sources:[...d.rule.sourceUrls]}))
  .sort((a,b)=>TIER_ORDER[a.tier]-TIER_ORDER[b.tier]||ascii(a.ruleId,b.ruleId));
 return {version:`${FRANCHISE_CLAIMS_VERSION}+${COMPLIANCE_LEXICON.version}`,issues,hardBlocked:issues.some(x=>x.tier==='hard_block'),blocked:issues.some(x=>x.tier!=='warn'),notice:COMPLIANCE_NOTICE,disclaimer:GATE_DISCLAIMER};
}

// ── 문구 ──
const REASON_TEXT:Record<FranchiseReason,string>={pattern:'',no_evidence:'근거 사실 없음',value_mismatch:'확정 사실 값과 다름',details_missing:'매장 유형·포함·불포함 항목 없음',revenue_fact:'수익 항목 사실 값'};
export function franchiseIssueText(x:FranchiseIssue):string{
 const why=[REASON_TEXT[x.reason],x.escalatedBy?'첫 줄 수치 주장이라 차단(H9)':''].filter(Boolean).join(' · ');
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
// 캡션·카피에 나온 매장 수 주장·비용 라벨 뒤 금액이 현재 가맹 사실 값과 같으면 그 사실의 정보공개서 각주가 캡션에 있어야 한다(lib/franchise-facts.ts footnoteIssues의 mentioned).
// 원시 부분 문자열로 대조하지 않는다('한정 12개, 대기 없음'은 가맹점 수 12의 언급이 아니다).
export function mentionedFranchiseFacts(i:Omit<FranchiseJudgeInput,'at'|'scope'>):BrandFact[]{
 const {current}=splitFacts({...i,at:i.now,scope:'consumer'}),original=new Map(i.facts.map(f=>[f.id,f])),out=new Map<string,BrandFact>();
 for(const x of sentencesOf(typeof i.text==='string'?i.text:''))for(const kind of FR_KINDS){
  const body=kind.body(x.s);
  if(!body.length)continue;
  const ledger=ledgerOf(kind,current);
  for(const v of body)for(const f of ledger.get(v)??[])if(f.sourceRef&&original.has(f.id))out.set(f.id,original.get(f.id)!);
 }
 return [...out.values()];
}

// ── 모집처럼 읽히는 소비자 캠페인 ──
// objective가 없는 캠페인(R2의 모든 캠페인)은 소비자 규칙만 적용한다. 모집처럼 읽히면 발행 승인 화면에만 경고하고 서버는 막지 않는다(결정 21·H7 문구 포함).
export const RECRUITMENT_LIKE=/가맹\s?(?:문의|상담|모집|개설|조건|사업\s?설명회)|가맹점\s?모집|창업\s?(?:설명회|문의|상담|박람회)|점주\s?모집|예비\s?창업자/;
export function recruitmentWarning(branch:string):string{
 return '모집 캠페인처럼 보입니다. 이 캠페인에는 소비자 캠페인 규칙만 적용했습니다. 모집 광고는 모집 목표를 정한 캠페인으로 따로 만들어 승인받으세요.'+(branch!=='A'?' 분기 A가 아니면 유료 모집 광고·설명회·가맹 조건 제시를 하지 않습니다(H7).':'')+` ${GATE_DISCLAIMER}`;
}
