// B1 사람 판정·교정 결정 로그의 순수 규칙(화면·서버 공용). 저장·조회는 lib/review-decisions-server.ts, 표와 저장 형식은 docs/REVIEW-DECISIONS.ko.md.
// 대표 결정 8(2026-09-24, a): 사유 코드 v1 = quality 5기준(lib/quality.ts qualityCriteria 키) + compliance·voice·fact_error·question_only·format, 총 10개.
// 각 코드에 F1 실패 유형 ID(lib/graders 채점기 id)를 매핑한다. input_budget은 호출 비용 지표라 사람 사유와 매핑하지 않는다.
import {qualityCriteria} from './quality';

export const REVIEW_REASONS_VERSION='review-reasons-v1';
export type ReviewTargetKind='artifact'|'brief_suggestion'|'source'|'publication';
// 대상별 판정 값. publication의 returned는 승인한 발행을 초안으로 되돌린 반려(재확인)다.
export const REVIEW_DECISIONS={artifact:['approved','revision'],brief_suggestion:['adopted','edited','ignored'],source:['excluded'],publication:['cancelled','returned']} as const;
export type ReviewDecisionValue=(typeof REVIEW_DECISIONS)[ReviewTargetKind][number];
export type ReasonCode=keyof typeof qualityCriteria|'compliance'|'voice'|'fact_error'|'question_only'|'format';
export type ReasonDef={code:ReasonCode;label:string;description:string;graders:readonly string[];guardrail?:'compliance';targets:readonly ReviewTargetKind[]};
const ALL:readonly ReviewTargetKind[]=['artifact','brief_suggestion','source','publication'];
export const REVIEW_REASONS:readonly ReasonDef[]=[
 {code:'evidence',label:qualityCriteria.evidence,description:'출처·실측 없이 단정하거나 확인 전 값·표현을 표시 없이 씀',graders:['unconfirmed_value_assertion','unsupported_claim_term'],targets:ALL},
 {code:'brand',label:qualityCriteria.brand,description:'브랜드 정체성·상품·업종과 맞지 않음',graders:['industry_metric_leak'],targets:ALL},
 {code:'execution',label:qualityCriteria.execution,description:'실행할 초안·채널 계획·제작 지시가 비었거나 부족함',graders:['thin_section','local_channel_coverage'],targets:['artifact','brief_suggestion','publication']},
 {code:'economics',label:qualityCriteria.economics,description:'예산·원가·운영 조건을 무시하거나 임의로 확정함',graders:[],targets:['artifact','brief_suggestion']},
 {code:'measurement',label:qualityCriteria.measurement,description:'지표 정의·기준 기간·대조군·판정 기준이 없거나 잘못됨',graders:['revisit_cohort_definition'],targets:['artifact','brief_suggestion']},
 {code:'compliance',label:'규제·표시',description:'표시·광고 규제, 플랫폼 정책, 권리 확인이 필요한 표현(A2 가드레일)',graders:[],guardrail:'compliance',targets:ALL},
 {code:'voice',label:'어조·표현',description:'브랜드 목소리·톤이 맞지 않거나 브리프가 막은 표현을 씀',graders:['brief_prohibition_conflict'],targets:['artifact','brief_suggestion','publication']},
 {code:'fact_error',label:'사실 오류',description:'확정 사실과 다른 값(가격·주소·오픈일 등)이나 거절된 값을 씀',graders:['fact_conflict'],targets:ALL},
 {code:'question_only',label:'재질문·보류',description:'산출물 대신 재질문·선택지·작성 보류를 돌려줌',graders:['question_only'],targets:['artifact']},
 {code:'format',label:'형식·구조',description:'출력 계약·제목 구조가 깨지거나 내부 ID·디버그 값이 노출됨',graders:['contract_json','heading_nesting','internal_id_exposure'],targets:['artifact','publication']},
];
// 사람 사유와 매핑하지 않는 F1 채점기(호출 입력 토큰 상한은 산출물 내용 판정이 아니다).
export const UNMAPPED_GRADERS=['input_budget'] as const;
export const MAX_REASON_CHIPS=8;
// 화면 칩 순서. 역할이 주로 다루는 기준을 앞에 두고 최대 8개만 보여 준다.
const CHIP_ORDER:readonly ReasonCode[]=['question_only','fact_error','evidence','brand','voice','compliance','execution','format','measurement','economics'];
const ROLE_FOCUS:Record<string,readonly ReasonCode[]>={cmo:['economics','measurement'],growth:['economics','measurement'],data:['measurement'],quality:['evidence','measurement','economics']};
export function reasonChoices(kind:ReviewTargetKind,role?:string|null):ReasonDef[]{
 const order=[...new Set([...(role&&ROLE_FOCUS[role]||[]),...CHIP_ORDER])];
 return order.map(code=>REVIEW_REASONS.find(r=>r.code===code)!).filter(r=>r.targets.includes(kind)).slice(0,MAX_REASON_CHIPS);
}
// 입력 검사. 문제가 없으면 null. 빈 값(undefined·null)은 사유 없음이다.
export function reasonCodesProblem(value:unknown,kind:ReviewTargetKind):string|null{
 if(value===undefined||value===null)return null;
 if(!Array.isArray(value)||value.length>REVIEW_REASONS.length)return '사유 코드는 10개 이하의 목록으로 보내 주세요.';
 for(const code of value){
  const def=REVIEW_REASONS.find(r=>r.code===code);
  if(!def)return `알 수 없는 사유 코드입니다: ${String(code).slice(0,40)}`;
  if(!def.targets.includes(kind))return `이 대상에는 쓸 수 없는 사유 코드입니다: ${def.label}`;
 }
 return null;
}
// 검사를 통과한 값만 넘긴다. 중복은 처음 한 번만 남긴다.
export const reasonCodesOf=(value:unknown):ReasonCode[]=>Array.isArray(value)?[...new Set(value as ReasonCode[])]:[];

// quality 작업물의 5기준별 사람 판정(선택). B2 κ 계산 단위는 (작업물 id·버전, 기준)이다. ai는 판정 시점의 AI 검수 상태 사본이다.
export type HumanCriterion='pass'|'revise';
export type CriterionJudgement={criterion:keyof typeof qualityCriteria;human:HumanCriterion;ai:'pass'|'revise'|'needs_data'|null};
const criterionKeys=Object.keys(qualityCriteria) as (keyof typeof qualityCriteria)[];
export function criteriaProblem(value:unknown):string|null{
 if(value===undefined||value===null)return null;
 if(typeof value!=='object'||Array.isArray(value))return '기준별 판정 형식을 확인하세요.';
 for(const [key,judgement] of Object.entries(value)){
  if(!criterionKeys.includes(key as keyof typeof qualityCriteria))return `알 수 없는 검수 기준입니다: ${key.slice(0,40)}`;
  if(judgement!=='pass'&&judgement!=='revise')return '기준별 판정은 통과(pass) 또는 수정(revise)만 고를 수 있습니다.';
 }
 return null;
}
export function criteriaOf(value:unknown,aiChecks:readonly {criterion:string;status:string}[]=[]):CriterionJudgement[]{
 const input=(value&&typeof value==='object'?value:{}) as Record<string,HumanCriterion>;
 const aiOf=(key:string)=>{const s=aiChecks.find(c=>c.criterion===key)?.status;return s==='pass'||s==='revise'||s==='needs_data'?s:null};
 return criterionKeys.filter(key=>Object.hasOwn(input,key)).map(criterion=>({criterion,human:input[criterion],ai:aiOf(criterion)}));
}

// 편집 통계: 제목(#~###)으로 나눈 섹션 중 바뀐 섹션 제목과 줄 단위 편집 비율(0=같음, 1=공통 줄 없음). 원문은 담지 않는다.
export type EditStats={changedSections:string[];diffRatio:number};
const LEAD='(머리말)',MAX_SECTIONS=30,LCS_CELLS=4_000_000;
function sectionsOf(text:string){
 const out=new Map<string,string[]>();let key=LEAD;
 for(const line of text.split('\n')){
  const heading=/^#{1,3}\s+(.+)$/.exec(line.trim());
  if(heading){let k=heading[1].trim().slice(0,100),i=2;while(out.has(k))k=`${heading[1].trim().slice(0,100)} (${i++})`;key=k;out.set(key,[]);continue}
  out.set(key,[...(out.get(key)||[]),line.trim()]);
 }
 return new Map([...out].map(([k,v])=>[k,v.filter(Boolean).join('\n')]));
}
function commonLines(a:string[],b:string[]){
 if(a.length*b.length>LCS_CELLS){const bag=new Map<string,number>();for(const x of b)bag.set(x,(bag.get(x)||0)+1);return a.filter(x=>{const n=bag.get(x)||0;if(n)bag.set(x,n-1);return n>0}).length}
 let prev=new Array<number>(b.length+1).fill(0);
 for(const x of a){const row=[0];for(let j=0;j<b.length;j++)row.push(x===b[j]?prev[j]+1:Math.max(prev[j+1],row[j]));prev=row}
 return prev[b.length];
}
export function editStats(before:string,after:string):EditStats{
 const a=sectionsOf(before),b=sectionsOf(after);
 const changedSections=[...new Set([...b.keys(),...a.keys()])].filter(k=>(a.get(k)||'')!==(b.get(k)||'')).slice(0,MAX_SECTIONS);
 const la=before.split('\n').map(l=>l.trim()).filter(Boolean),lb=after.split('\n').map(l=>l.trim()).filter(Boolean);
 const total=la.length+lb.length,ratio=total?1-2*commonLines(la,lb)/total:0;
 return {changedSections,diffRatio:Math.round(ratio*1000)/1000};
}
// 작업물 출처 표시 문구. ai_edited는 AI 초안을 사람이 고친 판이다.
export const originLabel=(origin:string|undefined)=>origin==='ai'?'AI 작성':origin==='ai_edited'?'AI 작성 · 사람 수정':'직접 등록';
// 브리프 초안 제안의 처리: 저장값이 제안과 같으면 채택, 비었거나 초안 요청 때 값 그대로면 미사용, 그 밖은 수정.
export function suggestionDecision(saved:string,suggested:string,baseline:string):'adopted'|'edited'|'ignored'{
 const s=saved.trim();
 if(s&&s===suggested.trim())return 'adopted';
 return !s||s===baseline.trim()?'ignored':'edited';
}

export type ReviewActor={id:string;email:string|null;role:'owner'|'admin'|'member'};
export type ReviewDecision={id:string;targetKind:ReviewTargetKind;targetId:string;version:number;role:string|null;decision:ReviewDecisionValue;reasonCodes:ReasonCode[];section?:string;note?:string;actor:ReviewActor;
 promptVersion:string|null;skillVersion:string|null;outputContractVersion:string|null;campaignId:string|null;brandId:string|null;origin?:string;criteria?:CriterionJudgement[];reasonsVersion:string;createdAt:string};
// 역할×스킬 버전별 1차 승인율: 작업물마다 기록 순서상 첫 판정이 approved인 비율. 입력은 기록 순서대로 준다.
export type FirstPassRate={role:string;skillVersion:string|null;artifacts:number;approvedFirst:number;rate:number};
export function firstPassApproval(decisions:readonly ReviewDecision[]):FirstPassRate[]{
 const first=new Map<string,ReviewDecision>();
 for(const d of decisions)if(d.targetKind==='artifact'&&!first.has(d.targetId))first.set(d.targetId,d);
 const groups=new Map<string,FirstPassRate>();
 for(const d of first.values()){
  const key=JSON.stringify([d.role,d.skillVersion]),g=groups.get(key)||{role:d.role||'',skillVersion:d.skillVersion,artifacts:0,approvedFirst:0,rate:0};
  const artifacts=g.artifacts+1,approvedFirst=g.approvedFirst+(d.decision==='approved'?1:0);
  groups.set(key,{...g,artifacts,approvedFirst,rate:approvedFirst/artifacts});
 }
 return [...groups.values()];
}
