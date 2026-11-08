// 실행 전 계획 카드(GLOBAL-PLAN X3)의 토큰·소요 시간 추정(순수 모듈, 브라우저와 서버 공용).
// 입력 토큰 추정식은 서버 예산 가드(lib/token-budget.ts)가 여기서 다시 내보내 같은 식을 쓴다. 모든 값은 '추정'이며 실제 사용량은 종료 뒤 run·회의 기록이 대신한다.
export type PlanRole={id:string;name:string;deliverable:string};
export type PlanItem={id:string;role:string;name:string;deliverable:string;estimatedTokens:number;basis:'history'|'input'};
export type PlanEstimate={items:PlanItem[];totalTokens:number;durationMs:number|null;samples:number;label:'추정'};
export type RecentRun={role:string;tokens:number|null;durationMs:number|null};
export type MeetingHistory={tokens:number;durationMs:number|null;steps:number};

// 입력 토큰 추정(과대 쪽으로 보수적). 영어·JSON은 문자 수/2, 한글은 UTF-8 바이트/3(1자≈1토큰)과 비교해 큰 값을 쓴다.
export function estimateInputTokens(text:string){return Math.max(Math.ceil(text.length/2),Math.ceil(new TextEncoder().encode(text).length/3))}
// 출력 여유: 역할 산출물·회의 발언은 입력과 별도로 생기므로 단계마다 더한다(모델 지시·도구 호출은 미리 알 수 없다).
export const OUTPUT_ALLOWANCE=4000;
const safe=(n:unknown)=>typeof n==='number'&&Number.isFinite(n)&&n>0?n:null;
export function averageOf(values:readonly (number|null|undefined)[]):number|null{
 const list=values.map(safe).filter((n):n is number=>n!==null);
 return list.length?Math.ceil(list.reduce((a,b)=>a+b,0)/list.length):null;
}
const serialize=(value:unknown)=>{try{return JSON.stringify(value)??''}catch{return ''}};
// 역할 실행 계획: 남은 담당마다 입력(브리프·브랜드·앞선 작업물·지시 수) 추정과 같은 역할의 최근 실제 토큰 평균 중 큰 값을 쓴다(서버 예약 규칙과 같다).
export function estimateRolePlan(input:{roles:readonly PlanRole[];campaign:unknown;brand:unknown;artifacts:readonly {role:string;content:string}[];directives:number;recent:readonly RecentRun[]}):PlanEstimate{
 const base=estimateInputTokens(serialize({campaign:input.campaign,brand:input.brand}))+input.directives*120;
 const items=input.roles.map(role=>{
  const upstream=input.artifacts.filter(a=>a.role!==role.id).map(a=>a.content.slice(0,8000)).join('\n');
  const fromInput=base+estimateInputTokens(upstream)+OUTPUT_ALLOWANCE;
  const history=averageOf(input.recent.filter(r=>r.role===role.id).map(r=>r.tokens));
  const estimatedTokens=Math.max(fromInput,history??0);
  return {id:role.id,role:role.id,name:role.name,deliverable:role.deliverable,estimatedTokens,basis:history!==null&&history>=fromInput?'history' as const:'input' as const};
 });
 const durations=input.roles.map(role=>averageOf(input.recent.filter(r=>r.role===role.id).map(r=>r.durationMs)));
 const known=durations.filter((d):d is number=>d!==null);
 // 한 담당이라도 소요 기록이 없으면 전체 소요를 말할 수 없다(평균을 꾸미지 않는다).
 const durationMs=known.length===input.roles.length&&known.length>0?known.reduce((a,b)=>a+b,0):null;
 return {items,totalTokens:items.reduce((n,i)=>n+i.estimatedTokens,0),durationMs,samples:input.recent.filter(r=>safe(r.tokens)!==null).length,label:'추정'};
}
// 회의 계획: 단계 수(의견 교환 8 + 합의 1 + 개선 1~3 + 품질 1, 기본 12)마다 입력 추정 또는 완료 회의의 단계당 평균 토큰 중 큰 값.
export const MEETING_DEFAULT_STEPS=12;
export function estimateMeetingPlan(input:{roles:readonly PlanRole[];campaign:unknown;brand:unknown;agenda:string;artifacts:readonly {role:string;content:string}[];directives:number;history:readonly MeetingHistory[];steps?:number}):PlanEstimate{
 const steps=input.steps??MEETING_DEFAULT_STEPS;
 const body=serialize({campaign:input.campaign,brand:input.brand,agenda:input.agenda,artifacts:input.artifacts.map(a=>a.content.slice(0,8000))});
 const perStepInput=estimateInputTokens(body)+input.directives*120+OUTPUT_ALLOWANCE;
 const perStepHistory=averageOf(input.history.filter(h=>h.steps>0).map(h=>h.tokens/h.steps));
 const perStep=Math.max(perStepInput,perStepHistory??0),basis=perStepHistory!==null&&perStepHistory>=perStepInput?'history' as const:'input' as const;
 const items=[...input.roles.map(role=>({id:'discussion:'+role.id,role:role.id,name:role.name,deliverable:'의견 교환 발언',estimatedTokens:perStep,basis})),
  {id:'synthesis',role:'cmo',name:'총괄 파트너',deliverable:'합의안과 개선 과제 배정',estimatedTokens:perStep,basis},
  {id:'revision',role:'assigned',name:'배정 담당 1~3명',deliverable:'담당 개선본',estimatedTokens:perStep*Math.max(1,steps-input.roles.length-2),basis},
  {id:'quality',role:'quality',name:'독립 품질 검수',deliverable:'품질 재검토',estimatedTokens:perStep,basis}];
 return {items,totalTokens:items.reduce((n,i)=>n+i.estimatedTokens,0),durationMs:averageOf(input.history.map(h=>h.durationMs)),samples:input.history.length,label:'추정'};
}
// 완료 뒤 '실제 대비 추정'. 실제를 모르면 null 그대로 둔다(0으로 바꾸지 않는다).
export function compareTokens(estimated:number,actual:number|null){
 const ratio=actual===null||estimated<=0?null:actual/estimated;
 return {estimated,actual,ratio,label:ratio===null?'실제 사용량 미확인':ratio>1.2?'추정보다 많이 썼습니다.':ratio<0.8?'추정보다 적게 썼습니다.':'추정과 비슷합니다.'};
}
export const formatTokens=(n:number|null)=>n===null?'미확인':n.toLocaleString('ko-KR')+' 토큰';
