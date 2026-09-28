import type {MetaPlan} from './meta-ads';

export const META_BUDGET_REVIEW_PURPOSE = 'plan_scope_only' as const;
export type MetaBudgetScope = {
  accountId: string|null; product: string; landingUrl: string;
  startAt: string; endAt: string; currency: 'KRW'; timeZone: 'Asia/Seoul';
  totalBudget: number|null; dailyTarget: number|null; lossLimit: number|null;
  safetyReserve: number|null; allocatable: number|null; stopRule: string;
  creativeId: string|null; creativeHash: string|null;
};
export type MetaBudgetReview = {
  id:string; campaignId:string; brandId:string; version:number;
  action:'review'|'revoke'; digest:string; scope:MetaBudgetScope;
  purpose:typeof META_BUDGET_REVIEW_PURPOSE; maySpend:false;
  actorId:string; recordedAt:string; note:string;
};
// Local KRW envelope. Never interpret these amounts as Graph API budget units.
export function metaBudgetEnvelope(plan:MetaPlan|null,now=Date.now()) {
  const p=plan?.input,issues:string[]=[];
  const total=p?.totalBudget??null,reserve=p?.safetyReserve??null;
  const allocatable=total!==null&&reserve!==null?total-reserve:null;
  if(allocatable===null||allocatable<=0)issues.push('총 예산에서 안전 여유를 뺀 실행 가능 금액이 0원보다 커야 합니다.');
  if(allocatable!==null&&p?.dailyTarget!=null&&p.dailyTarget>allocatable)issues.push('일별 운영 목표가 안전 여유를 제외한 금액보다 큽니다.');
  if(allocatable!==null&&p?.lossLimit!=null&&p.lossLimit>allocatable)issues.push('손실 한도가 안전 여유를 제외한 금액보다 큽니다.');
  const start=Date.parse(p?.startAt??''),end=Date.parse(p?.endAt??'');
  if(!Number.isFinite(start)||!Number.isFinite(end)||end<=start)issues.push('유효한 시작·종료 시각을 지정하세요.');
  else {
    if(start<=now)issues.push('예산 검토를 기록할 때 시작 시각은 현재보다 뒤여야 합니다.');
    if(end-start>31*86400000)issues.push('첫 제한 실험의 기간은 최대 31일입니다.');
  }
  return {allocatable,issues};
}
