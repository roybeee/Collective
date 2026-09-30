import type {AuthorityCommitment} from './growth-authority';
import {executionId,executionSafeText} from './growth-execution';
export class GrowthReconciliationError extends Error {}
export type ReconciliationInput={mode:'partial'|'final'|'release';actualAmount:number|null;actualLoss:number|null;evidenceRef:string;note:string;noExecution:boolean;noOutstandingObligations:boolean};
export function emptyReconciliationInput():ReconciliationInput{return {mode:'partial',actualAmount:null,actualLoss:null,evidenceRef:'',note:'',noExecution:false,noOutstandingObligations:false}}
function fail(s:string):never{throw new GrowthReconciliationError(s)}
function amount(v:unknown){if(v===null)return null;if(typeof v!=='number'||!Number.isSafeInteger(v)||v<0)return fail('실비·손실은 0 이상의 안전한 KRW 정수 또는 미확인이어야 합니다.');return v}
export function parseReconciliationInput(v:unknown):ReconciliationInput{
 if(!v||typeof v!=='object'||Array.isArray(v))return fail('대사 입력을 확인하세요.');const b=v as Record<string,unknown>;
 if(!['partial','final','release'].includes(String(b.mode)))return fail('대사 방법을 선택하세요.');
 for(const k of ['noExecution','noOutstandingObligations'])if(typeof b[k]!=='boolean')return fail('무집행·잔여 의무 확인은 참 또는 거짓이어야 합니다.');
 return {mode:b.mode as ReconciliationInput['mode'],actualAmount:amount(b.actualAmount),actualLoss:amount(b.actualLoss),evidenceRef:executionId(b.evidenceRef),note:executionSafeText(b.note,'대사 근거',1000),noExecution:b.noExecution as boolean,noOutstandingObligations:b.noOutstandingObligations as boolean};
}
/** Values are cumulative observations for this commitment, never per-event additions. */
export function reconcileCommitment(old:AuthorityCommitment,input:ReconciliationInput,state:string):AuthorityCommitment{
 if(old.status==='released')return fail('해제한 예약은 다시 변경할 수 없습니다.');
 if(old.status==='reconciled'&&input.mode==='partial')return fail('확정 대사를 부분 미확인으로 되돌릴 수 없습니다.');
 for(const k of ['actualAmount','actualLoss'] as const)if(old[k]!==null&&(input[k]===null||input[k]!<old[k]!))return fail('이미 확인한 누적 실비·손실은 낮추거나 미확인으로 되돌릴 수 없습니다.');
 if(input.mode==='release'){
  if(state!=='failed'||input.actualAmount!==0||input.actualLoss!==0||!input.noExecution||!input.noOutstandingObligations)return fail('실패 확정·실비와 손실 0·무집행 및 잔여 의무 없음의 확인이 필요합니다.');
  return {...old,status:'released',actualAmount:0,actualLoss:0};
 }
 if(input.mode==='final'&&(!['failed','observed'].includes(state)||input.actualAmount===null||input.actualLoss===null||!input.noOutstandingObligations))return fail('실행 결과·누적 실비·손실과 잔여 의무 없음이 모두 확인되어야 최종 대사할 수 있습니다.');
 return {...old,status:input.mode==='final'?'reconciled':'unknown',actualAmount:input.actualAmount,actualLoss:input.actualLoss};
}
