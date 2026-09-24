// B2 판정 보정: 사람의 기준별 판정(B1 criteria)과 AI 품질 검수 checks 5기준 상태의 일치도(Cohen's κ). 순수 함수(LLM·네트워크·DB 없음).
// 단위는 B1 criterionUnits(lib/review-decisions-server.ts)와 같은 (작업물 id·버전, 기준)이다. 같은 단위를 여러 번 판정했으면 기록 순서상 마지막 판정 하나만 쓴다.
// 기본 κ는 원 범주다: 사람 pass·revise × AI pass·revise·needs_data(2×3 표). 사람은 needs_data를 쓰지 않으므로 AI의 needs_data는 늘 불일치로 센다.
// needs_data를 revise(미통과)로 묶은 κ·일치율은 보조 값(kappaCollapsed·agreementCollapsed)으로만 함께 낸다. 판정 시점 AI 상태가 없던 단위(null)는 빼고 missingAi로 센다.
// 기준별 라벨 n<MIN_KAPPA_N이면 κ를 내지 않는다('보정 불가(표본 부족)'). 일치율은 비율 규칙(n<MIN_SAMPLE이면 null)을 따른다.
import {qualityCriteria} from './quality';
import {MIN_SAMPLE} from './quality-console';
import type {ReviewDecision} from './review-decisions';
import type {CriterionUnit} from './review-decisions-server';

export const MIN_KAPPA_N=20;
export type KappaResult={kappa:number|null;agreement:number|null;n:number;reason?:'no_data'|'single_category'};
// κ=(po-pe)/(1-pe). po=일치 비율, pe=Σ_k p_사람(k)·p_AI(k)(범주는 두 평가자가 쓴 값의 합집합이라 2×2 이상·비대칭 범주도 된다).
// 전체에 범주가 하나뿐이면 pe=1이라 κ를 정의할 수 없다(single_category, 일치율만 낸다). 쌍이 없으면 no_data.
export function cohenKappa(pairs:readonly {human:string;ai:string}[]):KappaResult{
 const n=pairs.length;
 if(!n)return {kappa:null,agreement:null,n,reason:'no_data'};
 const share=(side:'human'|'ai',c:string)=>pairs.filter(p=>p[side]===c).length/n;
 const po=pairs.filter(p=>p.human===p.ai).length/n,pe=[...new Set(pairs.flatMap(p=>[p.human,p.ai]))].reduce((s,c)=>s+share('human',c)*share('ai',c),0);
 if(1-pe<1e-12)return {kappa:null,agreement:po,n,reason:'single_category'};
 return {kappa:(po-pe)/(1-pe),agreement:po,n};
}

export type KappaUnit=Pick<CriterionUnit,'criterion'|'human'|'ai'|'artifactId'|'version'>;
type Human='pass'|'revise';type AiStatus='pass'|'revise'|'needs_data';
export type KappaStatus='ok'|'insufficient'|'single_category'|'no_data';
export type CriterionKappaRow={criterion:keyof typeof qualityCriteria;label:string;n:number;agreement:number|null;kappa:number|null;status:KappaStatus;needed:number;missingAi:number;aiNeedsData:number;
 agreementCollapsed:number|null;kappaCollapsed:number|null;table:{human:Human;ai:AiStatus;count:number}[]};
const CRITERIA=Object.keys(qualityCriteria) as (keyof typeof qualityCriteria)[];
const HUMAN:readonly Human[]=['pass','revise'],AI:readonly AiStatus[]=['pass','revise','needs_data'];
export function criterionKappa(units:readonly KappaUnit[]):CriterionKappaRow[]{
 const latest=new Map(units.map(u=>[JSON.stringify([u.artifactId,u.version,u.criterion]),u]));
 return CRITERIA.map(criterion=>{
  const mine=[...latest.values()].filter(u=>u.criterion===criterion);
  const pairs=mine.flatMap(u=>u.ai===null?[]:[{human:u.human,ai:u.ai}]);
  const r=cohenKappa(pairs),c=cohenKappa(pairs.map(p=>({human:p.human,ai:p.ai==='pass'?'pass':'revise'}))),n=r.n,status:KappaStatus=!n?'no_data':n<MIN_KAPPA_N?'insufficient':r.reason==='single_category'?'single_category':'ok';
  return {criterion,label:qualityCriteria[criterion],n,agreement:n>=MIN_SAMPLE?r.agreement:null,kappa:status==='ok'?r.kappa:null,status,needed:Math.max(0,MIN_KAPPA_N-n),
   missingAi:mine.length-pairs.length,aiNeedsData:mine.filter(u=>u.ai==='needs_data').length,agreementCollapsed:n>=MIN_SAMPLE?c.agreement:null,kappaCollapsed:n>=MIN_KAPPA_N?c.kappa:null,
   table:HUMAN.flatMap(human=>AI.map(ai=>({human,ai,count:pairs.filter(p=>p.human===human&&p.ai===ai).length})))};
 });
}
// 판정 로그에서 κ 단위를 만든다. B1 criterionUnits(owner)와 같은 순서·필드다(tests/quality-kappa.test.mjs가 실제 SQLite로 대조). 스크립트·다이제스트가 DB 없이 쓴다.
export const unitsFromDecisions=(decisions:readonly ReviewDecision[]):CriterionUnit[]=>decisions.filter(d=>d.targetKind==='artifact')
 .flatMap(d=>(d.criteria||[]).map(c=>({...c,artifactId:d.targetId,version:d.version,decisionId:d.id,actorId:d.actor.id,createdAt:d.createdAt})));
// 해석 구간(Landis & Koch 1977 관례). 보정 참고용 표현이며 합격 기준이 아니다.
export function kappaBand(kappa:number){
 if(kappa<0)return '우연보다 낮은 일치';
 return kappa<=0.2?'미미한 일치':kappa<=0.4?'약한 일치':kappa<=0.6?'보통 일치':kappa<=0.8?'상당한 일치':'거의 완전한 일치';
}
