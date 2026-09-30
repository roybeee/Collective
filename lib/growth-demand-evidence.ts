import {executionId,executionSafeText} from './growth-execution';
import type {DemandStep} from './growth-demand';
import type {GrowthPublicationObservationView} from './growth-publication-observation-server';
export class GrowthDemandEvidenceError extends Error {}
export type DemandEvidenceInput={sequenceId:string;sequenceVersion:number;stepId:string;publicationLinkId:string;publicationLinkVersion:number;evidenceRef:string};
export type DemandEvidenceSnapshot={sequenceVersion:number;stepDigest:string;offerId:string;offerVersion:number;missionId:string;missionVersion:number;publicationLinkVersion:number;publicationSnapshotDigest:string;intentId:string;intentMissionVersion:number;publicationId:string};
type Observation=GrowthPublicationObservationView['rows'][number];
export type DemandStepEvidence={deliveryState:'not_submitted'|'accepted'|'published'|'failed'|'unknown';measurement:Observation['measurement']|null;attribution:Observation['attribution']|null;source:'server_publication_record'};
const version=(v:unknown)=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=1;
export function parseDemandEvidenceInput(value:unknown):DemandEvidenceInput{
 if(!value||typeof value!=='object'||Array.isArray(value))throw new GrowthDemandEvidenceError('단계 근거 연결 입력을 확인하세요.');const b=value as Record<string,unknown>;
 if(!version(b.sequenceVersion)||!version(b.publicationLinkVersion))throw new GrowthDemandEvidenceError('연결할 시퀀스와 발행 연결의 정확한 판을 확인하세요.');
 try{return {sequenceId:executionId(b.sequenceId),sequenceVersion:b.sequenceVersion as number,stepId:stepIdentifier(b.stepId),publicationLinkId:executionId(b.publicationLinkId),publicationLinkVersion:b.publicationLinkVersion as number,evidenceRef:executionSafeText(b.evidenceRef,'연결 확인 근거',160)}}
 catch(e){if(e instanceof GrowthDemandEvidenceError)throw e;throw new GrowthDemandEvidenceError(e instanceof Error?e.message:'입력을 확인하세요.')}
}
function stepIdentifier(value:unknown){if(typeof value!=='string'||!/^[A-Za-z0-9_.:-]{1,100}$/.test(value))throw new GrowthDemandEvidenceError('수요 단계 ID를 확인하세요.');return value}
/** Only owned organic steps may borrow own-media publication receipts; creator/partner/ad steps need their own provider evidence. */
export function stepEligibility(step:DemandStep|undefined):string[]{
 if(!step)return ['현재 시퀀스에 해당 단계가 없습니다.'];
 return [...(step.channel!=='organic'?['자체 발행 근거는 자연 유입(organic) 단계에만 연결합니다.']:[]),...(step.placement!=='owned'?['크리에이터·파트너·광고 단계는 자체 계정 발행 근거로 대체할 수 없습니다.']:[])];
}
export function deliveryState(status:string):DemandStepEvidence['deliveryState']{return status==='published'?'published':status==='accepted'?'accepted':['approved','draft'].includes(status)?'not_submitted':status==='failed'||status==='cancelled'?'failed':'unknown'}
/** Evidence is shown only while every exact source still matches; stale or unknown sources never become observed performance. */
export function assessDemandEvidence({snapshot,current,observation}:{snapshot:DemandEvidenceSnapshot;current:{stepDigest:string|null;sequenceOfferId:string|null;sequenceOfferVersion:number|null;sequenceMissionId:string|null;publicationSnapshotDigest:string|null;publicationLinkVersion:number|null;intentMissionId:string|null};observation:Observation|null}){
 const reasons:string[]=[];
 if(current.stepDigest===null)reasons.push('시퀀스 또는 단계가 현재 없습니다.');else if(current.stepDigest!==snapshot.stepDigest)reasons.push('연결 뒤 단계 메시지·대상·권리 내용이 바뀌었습니다. 다시 연결하세요.');
 if(current.sequenceOfferId!==snapshot.offerId||current.sequenceOfferVersion!==snapshot.offerVersion||current.sequenceMissionId!==snapshot.missionId)reasons.push('시퀀스의 오퍼·미션 연결이 바뀌었습니다.');
 if(current.publicationSnapshotDigest===null||current.publicationSnapshotDigest!==snapshot.publicationSnapshotDigest)reasons.push('발행 연결의 승인 내용·판이 바뀌었거나 확인되지 않습니다.');
 if(current.intentMissionId!==snapshot.missionId)reasons.push('발행 실행 준비의 미션이 시퀀스 미션과 다릅니다.');
 if(!observation||observation.publicationId!==snapshot.publicationId||observation.intentId!==snapshot.intentId)reasons.push('발행 관측 행을 찾지 못했습니다.');
 const held=reasons.length>0;
 const evidence:DemandStepEvidence={deliveryState:held||!observation?'unknown':deliveryState(observation.publicationStatus),measurement:held?null:observation!.measurement,attribution:held?null:observation!.attribution,source:'server_publication_record'};
 const performance=held?'held' as const:evidence.deliveryState!=='published'?'not_published' as const:evidence.measurement?.status==='observed'||evidence.measurement?.status==='historical'||evidence.attribution?.status==='observed'?'observed' as const:'collecting' as const;
 return {status:held?'held' as const:'current' as const,performance,evidence,reasons,causalStatus:'not_measured' as const};
}
