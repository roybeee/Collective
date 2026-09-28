import type {MetaCandidate,MetaPreregistration} from './meta-learning';

export type ExperimentArm='control'|'treatment';
export type ExperimentDesign={id:string;campaignId:string;brandId:string;storeId:string;campaignVersion:number;registrationId:string;registration:MetaPreregistration;creativeBasis:string;creative:Pick<MetaCandidate,'creativeId'|'creativeVersion'|'creativeHash'>;metric:MetaCandidate['metric'];minSample:number;minEffect:number;lowerBound:number;upperBound:number;assignmentUnit:'pseudonymous_visitor';taxBasis:'net_tax_explicit';method:'hoeffding_union_alpha_spending_v1';seed:string;digest:string;createdAt:string;actorId:string};
export type ExperimentUnit={id:string;designId:string;campaignId:string;unitHash:string;arm:ExperimentArm;assignedAt:string;version:number;observation:ExperimentObservation|null};
export type ExperimentObservation={orderIds:string[];purchases:{orderId:string;purchasedAt:string;evidenceRef:string}[];exposed:boolean;trackingComplete:boolean;contaminated:boolean;netTaxKrw:number;adSpendKrw:number;productionCostKrw:number;costEvidence:string;sourceReceipt:string;observedThrough:string;recordedAt:string;actorId:string};
export type ExperimentState='not_started'|'collecting'|'maturing'|'insufficient'|'invalid'|'inconclusive'|'supported'|'rejected';
export type ExperimentStatistics={status:ExperimentState;method:ExperimentDesign['method'];alpha:number;controlSample:number;treatmentSample:number;controlMean:number|null;treatmentMean:number|null;difference:number|null;interval:[number,number]|null;reason:string};
export type ExperimentResult={id:string;designId:string;campaignId:string;brandId:string;version:number;sourceDigest:string;designDigest:string;statistics:ExperimentStatistics;lineage:{unitId:string;version:number;orders:{id:string;version:number}[]}[];recordedAt:string;actorId:string};
export type ExperimentRule={id:string;campaignId:string;brandId:string;designId:string;resultId:string;resultVersion:number;sourceDigest:string;guidance:string;status:'draft'|'approved';learningRuleId?:string;recordedAt:string;actorId:string};
export class ExperimentInputError extends Error {}
export function experimentDesignInput(b:Record<string,unknown>,metric:MetaCandidate['metric']){
 const lowerBound=Number(b.lowerBound),upperBound=Number(b.upperBound),minEffect=Number(b.minEffect);
 if([b.lowerBound,b.upperBound,b.minEffect].some(v=>typeof v!=='number'||!Number.isFinite(v))||lowerBound>=upperBound||Math.abs(lowerBound)>1e9||Math.abs(upperBound)>1e9||minEffect<0||minEffect>=upperBound-lowerBound)throw new ExperimentInputError('효과 기준과 단위별 최솟값·최댓값을 확인하세요.');
 if(metric==='paid_orders'&&(lowerBound!==0||upperBound!==1))throw new ExperimentInputError('구매 지표는 배정 단위별 구매 여부(0 또는 1)입니다.');
 if(b.assignmentUnit!=='pseudonymous_visitor'||b.taxBasis!=='net_tax_explicit')throw new ExperimentInputError('비식별 방문자 단위와 순세액 명시 기준을 사용하세요.');
 return {lowerBound,upperBound,minEffect,assignmentUnit:'pseudonymous_visitor' as const,taxBasis:'net_tax_explicit' as const,method:'hoeffding_union_alpha_spending_v1' as const};
}

// A two-sided Hoeffding bound per arm, union bound across arms; the k-th
// corrected result spends .05/(k(k+1)), whose infinite sum is .05.
// No normal approximation, clipping, or fixed-alpha repeated peeking.
export function experimentStatistics(d:Pick<ExperimentDesign,'metric'|'minSample'|'minEffect'|'lowerBound'|'upperBound'>,control:number[],treatment:number[],version:number):ExperimentStatistics{
 const alpha=0.05/(version*(version+1)),base={method:'hoeffding_union_alpha_spending_v1' as const,alpha,controlSample:control.length,treatmentSample:treatment.length,controlMean:null,treatmentMean:null,difference:null,interval:null};
 if(!Number.isSafeInteger(version)||version<1||[...control,...treatment].some(v=>!Number.isFinite(v)||v<d.lowerBound||v>d.upperBound||(d.metric==='paid_orders'&&v!==0&&v!==1)))return {...base,status:'invalid',reason:'사전등록한 단위별 범위를 벗어난 관측입니다.'};
 if(Math.min(control.length,treatment.length)<d.minSample)return {...base,status:'insufficient',reason:'양 군 각각의 최소 배정 표본에 도달하지 못했습니다.'};
 const mean=(xs:number[])=>xs.reduce((a,b)=>a+b,0)/xs.length,controlMean=mean(control),treatmentMean=mean(treatment),difference=treatmentMean-controlMean;
 const radius=(n:number)=>(d.upperBound-d.lowerBound)*Math.sqrt(Math.log(4/alpha)/(2*n)),width=radius(control.length)+radius(treatment.length);
 const interval:[number,number]=[difference-width,difference+width];
 const status=interval[0]>d.minEffect?'supported':interval[1]<-d.minEffect?'rejected':'inconclusive';
 return {...base,controlMean,treatmentMean,difference,interval,status,reason:status==='supported'?'조건부 개선 근거':status==='rejected'?'조건부 악화 근거':'등록한 효과 기준에 대한 불확실성이 남았습니다.'};
}
export const experimentStateLabels:Record<ExperimentState,string>={not_started:'시작 전',collecting:'관측 중',maturing:'환불·전환 성숙 대기',insufficient:'자료 부족',invalid:'관측 조건 불충족',inconclusive:'불확실',supported:'개선 근거',rejected:'악화 근거'};
