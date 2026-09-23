export type FactRef={id:string;version:number};
export type ExecutionCreative={id:string;campaignId:string;campaignVersion:number;brandId:string;storeId?:string;version:number;factRefs:FactRef[];caption:string;pngHash:string;objectKey:string;createdAt:string};
export type ExecutionLimits={id:string;version:number;maxPublications:number;maxPlannedCostKRW:number;paused:boolean};
export type PublicationStatus='draft'|'approved'|'submitting'|'uncertain'|'accepted'|'published'|'failed'|'cancelled'|'blocked';
export type Publication={id:string;campaignId:string;creativeId:string;creativeVersion:number;campaignVersion:number;pngHash:string;factRefs:FactRef[];caption:string;mediaUrl:string;scheduledAt:string;plannedCostKRW:number;version:number;status:PublicationStatus;channelId?:string;credentialVersion?:number;limitsVersion?:number;approvedBy?:string;approvedAt?:string;providerId?:string;providerStatus?:string;error?:string;attemptedAt?:string;createdAt:string;updatedAt?:string};
export type PublisherStatus={connected:boolean;channelId?:string;account?:string;version?:number};
export type ExecutionState={creatives:ExecutionCreative[];publications:Publication[];limits:ExecutionLimits|null;publisher:PublisherStatus};
export const publicationLabels:Record<PublicationStatus,string>={draft:'승인 전',approved:'실행 승인',submitting:'접수 확인 중',uncertain:'접수 여부 미확인',accepted:'예약 접수',blocked:'공급자 확인 필요',published:'게시 확인',failed:'발행 실패',cancelled:'취소'};
export function executionTotals(publications:Publication[]){const attempted=publications.filter(p=>!!p.attemptedAt);return {attempts:attempted.length,plannedCostKRW:attempted.reduce((n,p)=>n+p.plannedCostKRW,0)}}

export function providerPublicationStatus(status:string):PublicationStatus{return status==='sent'?'published':status==='error'?'failed':['scheduled','sending'].includes(status)?'accepted':'blocked'}
