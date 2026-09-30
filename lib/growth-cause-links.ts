import {executionId,executionSafeText} from './growth-execution';
import {returnReasonCodes} from './growth-return-reasons';
export class GrowthCauseLinkError extends Error {}
export const causeTargetKinds=['journey','decision','lesson'] as const;
export type CauseTargetKind=typeof causeTargetKinds[number];
export type CauseLinkInput={eventId:string;reasonVersion:number;targetKind:CauseTargetKind;targetId:string;targetVersion:number;note:string};
export type CauseLinkSnapshot={reasonVersion:number;reasonCode:typeof returnReasonCodes[number];reasonSnapshotDigest:string;lineId:string;missionId:string;targetVersion:number;targetMissionId:string};
const version=(v:unknown,label:string)=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=1?v:(()=>{throw new GrowthCauseLinkError(`${label}의 정확한 판을 확인하세요.`)})();
export function parseCauseLinkInput(value:unknown):CauseLinkInput{
 if(!value||typeof value!=='object'||Array.isArray(value))throw new GrowthCauseLinkError('원인 연결 입력을 확인하세요.');const b=value as Record<string,unknown>;
 if(!causeTargetKinds.includes(b.targetKind as CauseTargetKind))throw new GrowthCauseLinkError('연결할 검토 종류를 선택하세요.');
 try{return {eventId:executionId(b.eventId),reasonVersion:version(b.reasonVersion,'원인 기록'),targetKind:b.targetKind as CauseTargetKind,targetId:executionId(b.targetId),targetVersion:version(b.targetVersion,'검토 기록'),note:b.note===undefined||b.note===''?'':executionSafeText(b.note,'연결 메모',300)}}
 catch(e){if(e instanceof GrowthCauseLinkError)throw e;throw new GrowthCauseLinkError(e instanceof Error?e.message:'입력을 확인하세요.')}
}
export const causeLinkId=(i:Pick<CauseLinkInput,'eventId'|'targetKind'|'targetId'>)=>`${i.eventId}__${i.targetKind}__${i.targetId}`;
export type CauseEvent={eventId:string;lineId:string;kind:'return'|'refund';observedAt:string|null;sourceStatus:'current'|'held';reasonCode:string|null;reasonVersion:number|null};
/**
 * Operator-attested cause distribution. Denominator is distinct growth order lines with a return/refund event observed in the window,
 * so a return and refund on the same line are not double counted. Counts are observations, not defect rates or causal effects.
 */
export function causeDistribution(events:CauseEvent[],window:{from:string;to:string}){
 const inWindow=events.filter(e=>e.observedAt&&e.observedAt.slice(0,10)>=window.from&&e.observedAt.slice(0,10)<=window.to),lines=new Map<string,CauseEvent[]>();
 for(const e of inWindow)lines.set(e.lineId,[...(lines.get(e.lineId)??[]),e]);
 const counts:Record<string,number>={},held={lines:0},unrecorded={lines:0};let multiple=0;
 for(const rows of lines.values()){
  if(rows.some(r=>r.sourceStatus==='held')){held.lines++;continue}
  const codes=[...new Set(rows.map(r=>r.reasonCode).filter((c):c is string=>!!c))];
  if(!codes.length){unrecorded.lines++;continue}
  if(codes.length>1)multiple++;
  for(const code of codes)counts[code]=(counts[code]??0)+1;
 }
 return {window,denominator:{unit:'order_line_with_return_or_refund_event' as const,lines:lines.size},counts:returnReasonCodes.map(code=>({code,lines:counts[code]??0})),held:held.lines,unrecorded:unrecorded.lines,linesWithMultipleCodes:multiple,excludedWithoutObservedAt:events.filter(e=>!e.observedAt).length,rateStatus:'not_a_defect_rate' as const,causalStatus:'not_measured' as const};
}
