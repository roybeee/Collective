import {executionSafeText} from './growth-execution';
export class GrowthStopError extends Error {}
export type GrowthStopState={id:'global';version:number;status:'running'|'stopped';reason:string;updatedAt:string|null;updatedBy:string|null};
export type GrowthStopInput={action:'stop'|'resume';expectedVersion:number;requestId:string;reason:string};
export function emptyGrowthStop():GrowthStopState{return {id:'global',version:0,status:'running',reason:'',updatedAt:null,updatedBy:null}}
export function parseGrowthStopInput(value:unknown):GrowthStopInput{
 if(!value||typeof value!=='object'||Array.isArray(value))throw new GrowthStopError('전역 중단 입력을 확인하세요.');const b=value as Record<string,unknown>;
 if(!['stop','resume'].includes(String(b.action))||!Number.isSafeInteger(b.expectedVersion)||Number(b.expectedVersion)<0)throw new GrowthStopError('중단 작업·기록 판을 확인하세요.');
 if(typeof b.requestId!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(b.requestId))throw new GrowthStopError('요청 UUID를 확인하세요.');
 let reason:string;try{reason=executionSafeText(b.reason,'중단·재개 사유',500)}catch{throw new GrowthStopError('개인정보·인증정보 없는 중단·재개 사유를 입력하세요.');}
 return {action:b.action as GrowthStopInput['action'],expectedVersion:Number(b.expectedVersion),requestId:b.requestId.toLowerCase(),reason};
}
export function validateGrowthStop(value:unknown):GrowthStopState{
 if(!value||typeof value!=='object'||Array.isArray(value))throw new GrowthStopError('전역 중단 기록이 손상되었습니다.');const b=value as Record<string,unknown>;
 if(b.id!=='global'||!['running','stopped'].includes(String(b.status))||!Number.isSafeInteger(b.version)||Number(b.version)<1||typeof b.reason!=='string'||!b.reason.trim()||typeof b.updatedAt!=='string'||!Number.isFinite(Date.parse(b.updatedAt))||typeof b.updatedBy!=='string'||!b.updatedBy)throw new GrowthStopError('전역 중단 기록이 손상되었습니다.');
 return b as unknown as GrowthStopState;
}
