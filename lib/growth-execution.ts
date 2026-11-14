import {scanText} from './pii-scan';

export type ExecutionInput={missionId:string;missionVersion:number;authorityId:string;authorityVersion:number;inventoryId:string;inventoryVersion:number;quantity:number;recoveryOwner:string;recoveryDueAt:string;evidenceRef:string};
export type ExecutionState='prepared'|'unknown'|'observed'|'failed';
export type ExecutionReceiptInput={status:Exclude<ExecutionState,'prepared'>;reference:string;note:string};
export class GrowthExecutionError extends Error {}
function object(value:unknown){if(!value||typeof value!=='object'||Array.isArray(value))throw new GrowthExecutionError('실행 입력 형식을 확인하세요.');return value as Record<string,unknown>}
export function executionSafeText(value:unknown,label:string,max=200){
 if(typeof value!=='string'||!value.trim()||value.length>max||/[\x00-\x1f\x7f]/.test(value))throw new GrowthExecutionError(`${label} 입력을 확인하세요.`);
 const normalized=value.normalize('NFKC').replace(/[\u200b-\u200d\u2060\ufeff]/g,'');
 if(scanText(normalized).length||/(?:bearer\s+\S+|(?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret)\s*[:=]\s*\S+|\bsk-(?:proj-)?[\w-]{8,}|-----BEGIN [A-Z ]*PRIVATE KEY-----)/i.test(normalized))throw new GrowthExecutionError(`${label}에 식별정보와 인증정보를 넣을 수 없습니다.`);
 return value.trim();
}
// 소유자 자신의 저장 기록에서 읽은 id(앱·서버가 만든 식별자)는 자유 입력이 아니라 개인정보 패턴 검사 없이 형식만 본다. 형식이 틀리면 null.
// QA N3(2026-11-15): Date.now() 13자리가 든 id('d8-src-1794677180051')를 카드번호로 오탐해 목록 전체가 400이었다. 사용자가 적는 근거 참조는 계속 executionId를 쓴다.
export function storedRecordId(value:unknown):string|null{return typeof value==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(value)?value:null}
export function executionId(value:unknown){const result=executionSafeText(value,'내부 식별자',100);if(!/^[A-Za-z0-9_-]+$/.test(result))throw new GrowthExecutionError('내부 식별자 형식을 확인하세요.');return result}
function integer(value:unknown,min=1){if(typeof value!=='number'||!Number.isSafeInteger(value)||value<min)throw new GrowthExecutionError(`${min} 이상의 정수를 입력하세요.`);return value}
export function parseExecutionInput(value:unknown):ExecutionInput{
 const b=object(value),due=executionSafeText(b.recoveryDueAt,'복구 기한',40);
 const match=/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/.exec(due);
 if(!match||!Number.isFinite(Date.parse(due))||new Date(match[1]+'T00:00:00Z').toISOString().slice(0,10)!==match[1]||Number(match[2])>23||Number(match[3])>59||Number(match[4])>59||(match[5]!=='Z'&&(Number(match[5].slice(1,3))>14||Number(match[5].slice(4))>59||(Number(match[5].slice(1,3))===14&&Number(match[5].slice(4))!==0))))throw new GrowthExecutionError('시간대가 있는 실제 복구 기한을 입력하세요.');
 return {missionId:executionId(b.missionId),missionVersion:integer(b.missionVersion),authorityId:executionId(b.authorityId),authorityVersion:integer(b.authorityVersion),inventoryId:executionId(b.inventoryId),inventoryVersion:integer(b.inventoryVersion,0),quantity:integer(b.quantity),recoveryOwner:executionSafeText(b.recoveryOwner,'복구 담당'),recoveryDueAt:due,evidenceRef:executionId(b.evidenceRef)};
}
export function parseExecutionReceipt(value:unknown):ExecutionReceiptInput{
 const b=object(value);if(!['unknown','observed','failed'].includes(String(b.status)))throw new GrowthExecutionError('확인 상태를 선택하세요.');
 return {status:b.status as ExecutionReceiptInput['status'],reference:executionSafeText(b.reference,'실행 근거'),note:executionSafeText(b.note,'확인 내용',1000)};
}
export function canRecordExecution(state:ExecutionState){return state==='prepared'||state==='unknown'}
