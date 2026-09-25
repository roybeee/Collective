import {ApiError,database,str,stamp,recordStatement} from './server';

// 평가 월 승인 레코드(Q2, 품질 계획 v2). 대표가 UTC 달력 월마다 서버 평가 토큰 월 상한(cap)을 승인한다. 승인이 없는 달은 결정 5의 기본 1,500,000이다.
// eval-server의 월 상한 판정(시작 budgetApproval·제출 직전 monthlyCapReached)과 GET usage가 evalMonthBudget·monthlyCapFor로 이 cap을 읽는다.
// run별 대표 승인(overBudgetApproved)은 시작만 허용하고 월 누적 검사를 건너뛰지 못한다(승인 cap을 넘는 제출은 monthly_cap_reached).
// 월당 1행(id=YYYY-MM). 다시 승인하면 이전 승인(cap·사유·승인자·시각)을 history에 오래된 순서로 덧붙인다. 권한은 라우트가 본다(소유자만).
export const EVAL_DEFAULT_MONTHLY_TOKEN_CAP=1500000,EVAL_BUDGET_APPROVAL_MAX_CAP=10000000,EVAL_BUDGET_HISTORY_MAX=50;
type Who={id:string;email:string|null};
export type EvalBudgetApprovalEntry={cap:number;reason:string;by:Who;createdAt:string};
export type EvalBudgetApproval=EvalBudgetApprovalEntry&{month:string;history:EvalBudgetApprovalEntry[]};
const MONTH=/^\d{4}-(0[1-9]|1[0-2])$/;
const comma=(n:number)=>String(n).replace(/\B(?=(\d{3})+(?!\d))/g,',');
// 평가 월은 UTC 달력 월이다(evalMonthUsage의 run 생성 월과 같다). 운영 토큰 예산(lib/token-budget.ts)의 한국 시간 월과 다르다.
export const evalMonthOf=(at=new Date())=>at.toISOString().slice(0,7);
async function readApproval(owner:string,month:string){
 const row=await database().prepare("SELECT data FROM records WHERE id=? AND owner=? AND kind='eval_budget_approval'").bind(`${owner}:eval_budget_approval:${month}`,owner).first<{data:string}>();
 return row?JSON.parse(row.data) as EvalBudgetApproval:null;
}
// 그 달의 월 상한(승인 cap 또는 기본값)과 승인 레코드(없으면 null). GET usage의 monthlyCap·approval이 이 값이다.
export async function evalMonthBudget(owner:string,month:string){
 const approval=await readApproval(owner,month);
 return {monthlyCap:approval?.cap??EVAL_DEFAULT_MONTHLY_TOKEN_CAP,approval};
}
export const monthlyCapFor=async(owner:string,month:string)=>(await evalMonthBudget(owner,month)).monthlyCap;
// POST /api/eval {action:'set_budget_approval',month,cap,reason}. 지난 달은 월 누적 장부가 닫혔으므로 바꾸지 않는다(이번 달·다음 달 이후만).
export async function setBudgetApproval(owner:string,input:Record<string,unknown>,by:Who,now=new Date()):Promise<EvalBudgetApproval>{
 const month=input.month,cap=input.cap;
 if(typeof month!=='string'||!MONTH.test(month))throw new ApiError(400,'승인 월(month)은 UTC 기준 YYYY-MM 형식으로 입력하세요.');
 if(month<evalMonthOf(now))throw new ApiError(400,'지난 달의 평가 토큰 승인은 바꿀 수 없습니다. 이번 달이나 다음 달 이후를 입력하세요.');
 if(typeof cap!=='number'||!Number.isSafeInteger(cap)||cap<1||cap>EVAL_BUDGET_APPROVAL_MAX_CAP)throw new ApiError(400,`월 상한(cap)은 1 이상 ${comma(EVAL_BUDGET_APPROVAL_MAX_CAP)} 이하의 정수로 입력하세요.`);
 const reason=str(input.reason,'대표 승인 사유',500,true),previous=await readApproval(owner,month);
 if(previous&&previous.history.length>=EVAL_BUDGET_HISTORY_MAX)throw new ApiError(409,`이 달의 승인 변경 이력이 ${EVAL_BUDGET_HISTORY_MAX}건에 닿았습니다. 이력을 지우지 않으려고 더 받지 않습니다.`);
 const history=previous?[...previous.history,{cap:previous.cap,reason:previous.reason,by:previous.by,createdAt:previous.createdAt}]:[];
 const approval:EvalBudgetApproval={month,cap,reason,by:{id:by.id,email:by.email},createdAt:stamp(),history};
 await recordStatement(owner,'eval_budget_approval',month,approval).run();
 return approval;
}
