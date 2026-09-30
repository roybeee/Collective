import {executionId} from './growth-execution';
export const returnReasonCodes=['unknown','product_defect','description_mismatch','wrong_option','delivery_issue','change_of_mind','other'] as const;
export type ReturnReasonInput={reasonCode:typeof returnReasonCodes[number];evidenceRef:string};
export class GrowthReturnReasonError extends Error {}
export function parseReturnReasonInput(value:unknown):ReturnReasonInput{
 if(!value||typeof value!=='object'||Array.isArray(value))throw new GrowthReturnReasonError('원인 기록 입력을 확인하세요.');const b=value as Record<string,unknown>;
 if(!returnReasonCodes.includes(b.reasonCode as ReturnReasonInput['reasonCode']))throw new GrowthReturnReasonError('지원하는 원인 또는 미확인을 선택하세요.');
 try{return {reasonCode:b.reasonCode as ReturnReasonInput['reasonCode'],evidenceRef:executionId(b.evidenceRef)}}catch{throw new GrowthReturnReasonError('개인정보·인증정보 없는 내부 근거 ID를 입력하세요.')}
}
