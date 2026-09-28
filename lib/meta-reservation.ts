import type {VerifiedMetaAdBundleScope} from './meta-ad-bundle-server';
export type MetaReservation={id:string;campaignId:string;brandId:string;accountId:string;adsetId:string;scope:VerifiedMetaAdBundleScope;scopeDigest:string;amount:number;totalBudget:number;safetyReserve:number;lossLimit:number;stopRule:string;state:'reserved'|'released'|'unknown';version:number;actorId:string;createdAt:string;updatedAt:string;releasedBy:string|null;maySpend:false;note:string};
type Envelope={amount:number;totalBudget:number;safetyReserve:number;lossLimit:number;stopRule:string;scope:Pick<VerifiedMetaAdBundleScope,'scopeDigest'|'accountId'|'adsetId'|'startAt'|'endAt'|'verifiedAt'>};
export function reservationIssues(input:Envelope,others:Pick<MetaReservation,'accountId'|'adsetId'|'state'>[],now=Date.now()){
 const {amount,totalBudget,safetyReserve,lossLimit,scope}=input,issues:string[]=[];
 if([amount,totalBudget,safetyReserve,lossLimit].some(v=>!Number.isSafeInteger(v)||v<0)||amount<=0||amount>totalBudget-safetyReserve||lossLimit<=0||lossLimit>totalBudget-safetyReserve)issues.push('안전 여유를 제외한 원화 예산·예약액·손실 한도를 확인하세요.');
 const start=Date.parse(scope.startAt),end=Date.parse(scope.endAt),verified=Date.parse(scope.verifiedAt);
 if(!Number.isFinite(start)||!Number.isFinite(end)||start<=now||end<=start||end-start>31*86400000)issues.push('시작 전·최대 31일의 기간만 예약할 수 있습니다.');
 if(!Number.isFinite(verified)||now-verified<0||now-verified>15*60000)issues.push('외부 광고 구성을 15분 이내 다시 확인하세요.');
 if(!input.stopRule.trim())issues.push('중단 기준을 입력하세요.');
 if(!/^[a-f0-9]{64}$/.test(scope.scopeDigest))issues.push('검증된 외부 구성 근거가 필요합니다.');
 if(others.some(r=>r.accountId===scope.accountId&&r.adsetId===scope.adsetId&&r.state!=='released'))issues.push('같은 광고세트에 예약 또는 결과 미확인 기록이 있습니다.');
 return issues;
}
