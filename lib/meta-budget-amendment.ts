import type {MetaExecution} from './meta-execution';
import {krwGraphBudget} from './meta-execution';
export type BudgetAmendmentState='approved'|'submitting'|'unknown'|'applied'|'blocked';
export type ExecutionBudgetAmendment={id:string;state:'pending'|'applied'|'blocked';nextDaily:number;nextGraph:string};
export type BudgetAmendmentAmounts={previousTotal:number;nextTotal:number;increase:number;previousDaily:number;nextDaily:number;previousGraph:string;nextGraph:string;currencyOffset:number};
export function budgetAmendmentAmounts(e:MetaExecution,value:unknown,nextTotal:number,missionTotal:number,offset:number):BudgetAmendmentAmounts{
 const b=value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{};
 if(b.confirmed!==true||b.executionId!==e.id||b.executionVersion!==e.version||e.state!=='active'||e.pending||e.budgetAmendment)throw new Error('현재 집행 중인 동일 실행의 정확한 판과 최초 1회 예산 확대 승인이 필요합니다.');
 const nextDaily=b.nextDailyBudgetKrw;
 if(e.maxSpend!==missionTotal||!Number.isSafeInteger(nextTotal)||nextTotal<=e.maxSpend||nextTotal-e.maxSpend>Math.floor(e.maxSpend/5))throw new Error('미션 총액과 실행 총액이 같고 총액 확대가 20% 이하여야 합니다.');
 if(typeof nextDaily!=='number'||!Number.isSafeInteger(nextDaily)||nextDaily<=e.dailyTarget||nextDaily-e.dailyTarget>Math.floor(e.dailyTarget/5)||nextDaily>nextTotal)throw new Error('일예산은 총액과 별도로 입력하며 기존 일예산보다 크고 20% 이내여야 합니다.');
 if(e.scope.graphDailyBudget!==krwGraphBudget(e.dailyTarget,offset))throw new Error('원본 일예산과 Graph 통화 배율이 다릅니다.');
 return {previousTotal:e.maxSpend,nextTotal,increase:nextTotal-e.maxSpend,previousDaily:e.dailyTarget,nextDaily,previousGraph:e.scope.graphDailyBudget,nextGraph:krwGraphBudget(nextDaily,offset),currencyOffset:offset};
}
export const effectiveBudgetScope=(e:Pick<MetaExecution,'scope'|'budgetAmendment'>)=>e.budgetAmendment?.state==='applied'?{...e.scope,dailyBudgetKrw:e.budgetAmendment.nextDaily,graphDailyBudget:e.budgetAmendment.nextGraph}:e.scope;
/** Durable intent before one POST. Unknown/submitting recovery never resends a budget write. */
export async function runBudgetAmendment<T extends {state:BudgetAmendmentState;nextGraph:string}>(initial:T,api:{current:()=>Promise<boolean>;read:()=>Promise<string>;write:()=>Promise<void>},journal:{save:(patch:{state:BudgetAmendmentState})=>Promise<T>}){
 if(initial.state==='applied'||initial.state==='blocked')return initial;
 let row=initial;
 if(row.state==='approved'){
  if(!await api.current())return journal.save({state:'blocked'});
  row=await journal.save({state:'submitting'});
  try{await api.write()}catch{return journal.save({state:'unknown'})}
 }
 try{if(await api.read()===row.nextGraph)return await journal.save({state:'applied'})}catch{/* Keep the accepted write uncertain. */}
 return row.state==='unknown'?row:journal.save({state:'unknown'});
}
