import {scanText} from './pii-scan';
export class GrowthCollaborationError extends Error {}
export const collaborationStages=['proposed','agreed','delivered','approved','published','settled','cancelled'] as const;
export type CollaborationStage=typeof collaborationStages[number];
export type CollaborationPlan={sequenceId:string;sequenceVersion:number;stepId:string;partnerAlias:string;partnerKind:'creator'|'partner';audienceFitEvidence:string;brief:string;rightsScope:string;rightsDays:number;terms:string;feeKrw:number|null;commissionRate:number|null;trackingCodeId:string;deliverDueAt:string;publishDueAt:string};
export type StageReceipt={stage:CollaborationStage;at:string;evidenceRef:string;note:string;disclosureConfirmed?:boolean;authenticityConfirmed?:boolean;paidKrw?:number|null;recordedAt:string;recordedBy:string};
function fail(m:string):never{throw new GrowthCollaborationError(m)}
const control=/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/,secret=/(?:bearer\s+\S+|(?:api[_-]?key|access[_-]?token|password|secret)\s*[:=]\s*\S+)/i;
function text(v:unknown,label:string,max:number,required=true){if((v===undefined||v==='')&&!required)return '';if(typeof v!=='string'||!v.trim()||v.length>max||control.test(v))fail(`${label}: 1~${max}자 문자열을 입력하세요.`);const n=v.normalize('NFKC');if(scanText(n).length||secret.test(n))fail(`${label}: 연락처·식별정보·인증정보를 넣을 수 없습니다.`);return v.trim()}
const ident=(v:unknown,label:string,required=true)=>{const r=text(v,label,100,required);if(r&&!/^[A-Za-z0-9_.:-]+$/.test(r))fail(`${label}: 내부 식별자 형식을 확인하세요.`);return r};
const day=(v:unknown,label:string)=>{const r=text(v,label,10);if(!/^\d{4}-\d{2}-\d{2}$/.test(r)||new Date(r+'T00:00:00Z').toISOString().slice(0,10)!==r)fail(`${label}: YYYY-MM-DD 날짜입니다.`);return r};
export function parseCollaborationPlan(value:unknown):CollaborationPlan{
 if(!value||typeof value!=='object'||Array.isArray(value))fail('협업 계획 입력을 확인하세요.');const b=value as Record<string,unknown>;
 const fee=b.feeKrw===null||b.feeKrw===undefined?null:typeof b.feeKrw==='number'&&Number.isSafeInteger(b.feeKrw)&&b.feeKrw>=0&&b.feeKrw<=1e11?b.feeKrw:fail('고정 수수료는 0 이상 정수 원입니다.');
 const rate=b.commissionRate===null||b.commissionRate===undefined?null:typeof b.commissionRate==='number'&&b.commissionRate>=0&&b.commissionRate<=0.5?Math.round(b.commissionRate*10000)/10000:fail('성과 수수료율은 0~50%입니다.');
 if(!['creator','partner'].includes(String(b.partnerKind)))fail('협업 종류를 선택하세요.');
 const deliverDueAt=day(b.deliverDueAt,'납품 기한'),publishDueAt=day(b.publishDueAt,'게시 기한');if(publishDueAt<deliverDueAt)fail('게시 기한은 납품 기한 이후여야 합니다.');
 const rightsDays=typeof b.rightsDays==='number'&&Number.isSafeInteger(b.rightsDays)&&b.rightsDays>=1&&b.rightsDays<=3650?b.rightsDays:fail('사용 권리 기간(일)은 1~3650입니다.');
 return {sequenceId:ident(b.sequenceId,'시퀀스 ID'),sequenceVersion:typeof b.sequenceVersion==='number'&&Number.isSafeInteger(b.sequenceVersion)&&b.sequenceVersion>=1?b.sequenceVersion:fail('시퀀스 판을 확인하세요.'),stepId:ident(b.stepId,'단계 ID'),partnerAlias:ident(b.partnerAlias,'협업자 별칭(가명 ID)'),partnerKind:b.partnerKind as 'creator'|'partner',audienceFitEvidence:text(b.audienceFitEvidence,'청중 적합 근거',1000),brief:text(b.brief,'브리프',3000),rightsScope:text(b.rightsScope,'사용 권리 범위',1000),rightsDays,terms:text(b.terms,'조건',2000),feeKrw:fee,commissionRate:rate,trackingCodeId:ident(b.trackingCodeId,'추적 코드 ID',false),deliverDueAt,publishDueAt};
}
const next:Record<CollaborationStage,CollaborationStage[]>={proposed:['agreed','cancelled'],agreed:['delivered','cancelled'],delivered:['approved','cancelled'],approved:['published','cancelled'],published:['settled'],settled:[],cancelled:[]};
/** Stage receipts are operator-attested; approval needs ad disclosure and no fabricated engagement, settlement records the paid amount. */
export function parseStageReceipt(current:CollaborationStage,value:unknown,now=Date.now()):Omit<StageReceipt,'recordedAt'|'recordedBy'>{
 if(!value||typeof value!=='object'||Array.isArray(value))fail('단계 영수증을 확인하세요.');const b=value as Record<string,unknown>;
 const stage=b.stage as CollaborationStage;if(!collaborationStages.includes(stage)||!next[current].includes(stage))fail(`현재 단계(${current})에서 ${String(b.stage)}(으)로 갈 수 없습니다.`);
 const at=text(b.at,'발생 시각',40);if(!Number.isFinite(Date.parse(at))||Date.parse(at)>now+60_000)fail('발생 시각은 현재 이전이어야 합니다.');
 const r:Omit<StageReceipt,'recordedAt'|'recordedBy'>={stage,at:new Date(Date.parse(at)).toISOString(),evidenceRef:ident(b.evidenceRef,'증빙 ID'),note:text(b.note,'메모',500,false)};
 if(stage==='approved'){if(b.disclosureConfirmed!==true)fail('광고·협찬 표시를 확인해야 승인할 수 있습니다.');if(b.authenticityConfirmed!==true)fail('가짜 참여·후기가 없는지 확인해야 승인할 수 있습니다.');r.disclosureConfirmed=true;r.authenticityConfirmed=true;}
 if(stage==='settled'){r.paidKrw=b.paidKrw===null?null:typeof b.paidKrw==='number'&&Number.isSafeInteger(b.paidKrw)&&b.paidKrw>=0?b.paidKrw:fail('지급액은 0 이상 정수 원 또는 미확인입니다.');}
 return r;
}
export function collaborationWarnings(plan:CollaborationPlan,stage:CollaborationStage,receipts:StageReceipt[],plannedCost:number|null,today:string){
 const w:string[]=[];
 if(plannedCost!==null&&plan.feeKrw!==null&&plan.feeKrw>plannedCost)w.push('고정 수수료가 수요 단계 계획 비용을 넘습니다.');
 if(!['delivered','approved','published','settled','cancelled'].includes(stage)&&today>plan.deliverDueAt)w.push('납품 기한이 지났습니다.');
 if(!['published','settled','cancelled'].includes(stage)&&today>plan.publishDueAt)w.push('게시 기한이 지났습니다.');
 const paid=receipts.find(r=>r.stage==='settled')?.paidKrw;if(paid!==undefined&&paid!==null&&plan.feeKrw!==null&&paid>plan.feeKrw&&plan.commissionRate===null)w.push('지급액이 합의 고정 수수료보다 큽니다.');
 if(!plan.trackingCodeId)w.push('추적 코드가 없어 협업 성과를 주문과 연결할 수 없습니다.');
 return w;
}
