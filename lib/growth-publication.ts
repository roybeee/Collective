import {executionId,executionSafeText} from './growth-execution';
import type {Publication} from './execution';
export class GrowthPublicationError extends Error {}
export type PublicationLinkInput={intentId:string;intentVersion:number;publicationId:string;publicationVersion:number;contentConfirmed:true;evidenceRef:string};
export type GrowthPublicationStatus='linked'|'submitting'|'unknown'|'scheduled'|'published'|'failed'|'cancelled';
export function parsePublicationLink(value:unknown):PublicationLinkInput{
 if(!value||typeof value!=='object'||Array.isArray(value))throw new GrowthPublicationError('게시 연결 입력을 확인하세요.');const b=value as Record<string,unknown>;
 if(b.contentConfirmed!==true)throw new GrowthPublicationError('승인 게시 내용과 판매 오퍼의 일치를 확인하세요.');
 for(const k of ['intentVersion','publicationVersion'])if(typeof b[k]!=='number'||!Number.isSafeInteger(b[k])||(b[k] as number)<1)throw new GrowthPublicationError('연결할 정확한 판을 확인하세요.');
 return {intentId:executionId(b.intentId),intentVersion:b.intentVersion as number,publicationId:executionId(b.publicationId),publicationVersion:b.publicationVersion as number,contentConfirmed:true,evidenceRef:executionSafeText(b.evidenceRef,'내용 확인 근거',160)};
}
export function publicationObservation(p:Pick<Publication,'status'|'attemptedAt'|'providerId'|'attemptRestored'>){
 const never=p.status==='cancelled'&&!p.attemptedAt&&!p.providerId;
 const status:GrowthPublicationStatus=p.status==='approved'||p.status==='draft'?'linked':p.status==='accepted'?'scheduled':p.status==='published'?'published':p.status==='submitting'?'submitting':p.status==='failed'?'failed':p.status==='cancelled'?'cancelled':'unknown';
 return {status,intentState:never?'failed' as const:p.status==='published'?'observed' as const:status==='linked'?'prepared' as const:'unknown' as const,releaseEvidence:never?'never_attempted_cancelled' as const:null};
}
export function approvedPublicationBasis(p:Publication){return {id:p.id,campaignId:p.campaignId,campaignVersion:p.campaignVersion,creativeId:p.creativeId,creativeVersion:p.creativeVersion,pngHash:p.pngHash,factRefs:p.factRefs,caption:p.caption,mediaUrl:p.mediaUrl,mediaMode:p.mediaMode??null,copy:p.copy??null,trackingCode:p.trackingCode??null,codedPng:p.codedPng??null,scheduledAt:p.scheduledAt,plannedCostKRW:p.plannedCostKRW,channelId:p.channelId??null,credentialVersion:p.credentialVersion??null,limitsVersion:p.limitsVersion??null,approvedLimits:p.approvedLimits??null,approvedBy:p.approvedBy??null,approvedAt:p.approvedAt??null,aiDisclosureConfirmedAt:p.aiDisclosureConfirmedAt??null,aiDisclosureConfirmedBy:p.aiDisclosureConfirmedBy??null,codedPngConfirmedAt:p.codedPngConfirmedAt??null,codedPngConfirmedBy:p.codedPngConfirmedBy??null}}
