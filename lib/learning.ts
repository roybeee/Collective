import {channelRegistry,channelAliases} from './channels';
// 사용자가 사례로 직접 등록할 수 있는 채널. 전환 채널은 점포 실험 승격 경로로만 규칙이 된다.
export const learningChannels:string[]=Object.keys(channelRegistry).filter(name=>channelRegistry[name].caseEligible);
export const learningMetrics={share_rate:{label:'도달 대비 공유',denominator:'도달 수',numerator:'공유 횟수'},completion_rate:{label:'재생 대비 완주',denominator:'재생 시작 수',numerator:'완주 수'},click_rate:{label:'노출 대비 클릭',denominator:'노출 수',numerator:'클릭 수'}};
export type LearningMetric=keyof typeof learningMetrics;
export type ViralCase={id:string;brandId:string;title:string;channel:string;url:string;account:string;publishedAt:string;observedAt:string;scope:string;observations:string;transcript:string;views:number|null;baselineViews:number|null;comparison:string;origin:'manual'|'hermes';createdAt:string};
export type TestIdea={hypothesis:string;variable:string;control:string;treatment:string;metric:LearningMetric};
export type ViralAnalysis={id:string;caseId:string;brandId:string;facts:string;hook:string;retention:string;sharing:string;context:string;counterEvidence:string;unknowns:string;ideas:TestIdea[];origin:'manual'|'hermes';createdAt:string};
export type Arm={denominator:number|null;numerator:number|null;source:string};
export type ExperimentResult={control:Arm;treatment:Arm;comparable:boolean;notes:string;observedUntil:string;recordedAt:string};
export type Assessment={status:'insufficient'|'promising'|'not_supported'|'inconclusive';label:string;controlRate:number|null;treatmentRate:number|null;lift:number|null;reasons:string[]};
export type ViralExperiment={id:string;brandId:string;campaignId:string;caseId:string;analysisId:string;title:string;channel:string;hypothesis:string;variable:string;control:string;treatment:string;metric:LearningMetric;minSample:number;minHours:number;minLift:number;conditions:string;version:number;status:'draft'|'running'|'evaluated';startedAt:string|null;createdAt:string;updatedAt:string;result:ExperimentResult|null;assessment:Assessment|null};
// 점포 실험 회고에서 승격된 규칙의 근거. 바이럴 실험의 sourceAssessment와 지표 체계가 달라 분리한다.
// 모르는 값은 null로 남긴다. 관찰 기록이며 인과 효과가 아니다.
export type StoreAssessment={decision:'adopt'|'stop';primaryMetric:string;primaryMetricLabel:string;target:number|null;observed:number|null;periodStart:string;periodEnd:string;measurementSource:string;evidenceLevel:'observation'|'comparison'|'repeated';failureType:string;confounders:string;nextAction:string};
export type LearningRule={origin?:'viral'|'store';storeId?:string;storeAssessment?:StoreAssessment;renewCount?:number;renewedAt?:string;renewReason?:string;direction?:'test'|'caution';sourceAssessment?:{status:'promising'|'not_supported';metric:LearningMetric;controlRate:number|null;treatmentRate:number|null;lift:number|null;controlSample:number|null;treatmentSample:number|null;startedAt:string|null;observedUntil:string;conditions:string;notes:string};id:string;brandId:string;channel:string;experimentId:string;experimentVersion:number;caseId:string;title:string;guidance:string;scope:string;evidenceLevel:'observational';status:'active'|'paused'|'retired';version:number;expiresAt:string;createdAt:string;updatedAt:string};
export type LearningSnapshot={id:string;campaignId:string;role:string;createdAt:string;rules:LearningRule[]};
export type LearningJob={id:string;campaignId:string;role:string;status:string;error:string|null;createdAt:string};
export type LearningGuidance={id:string;experimentId:string;experimentVersion:number;guidance:string;createdAt:string};
export type LearningData={guidances?:LearningGuidance[];cases:ViralCase[];analyses:ViralAnalysis[];experiments:ViralExperiment[];rules:LearningRule[];snapshots:LearningSnapshot[];jobs:LearningJob[];observations:(ViralCase&{caseId:string})[];jobOutputs:{id:string;output:string}[]};
export function evaluateExperiment(e:ViralExperiment,result:ExperimentResult):Assessment{
 const a=result.control,b=result.treatment,reasons:string[]=[];
 const rate=(x:Arm)=>x.denominator!==null&&x.denominator>0&&x.numerator!==null?x.numerator/x.denominator:null;
 const ar=rate(a),br=rate(b),lift=ar!==null&&ar>0&&br!==null?(br/ar-1)*100:null;
 if(ar===null||br===null)reasons.push('주지표의 수치와 0보다 큰 분모가 필요합니다.');
 if((a.denominator??0)<e.minSample||(b.denominator??0)<e.minSample)reasons.push('두 실험안 모두 사전에 정한 최소 표본에 도달해야 합니다.');
 if(!e.startedAt||Date.parse(result.observedUntil)-Date.parse(e.startedAt)<e.minHours*3600000)reasons.push('사전에 정한 관찰 시간이 지나지 않았습니다.');
 if(!result.comparable)reasons.push('대상·기간·배포 조건의 비교 가능성을 확인해야 합니다.');
 if(ar===0)reasons.push('대조안의 반응이 0이므로 상대 개선율을 판정할 수 없습니다.');
 const status=reasons.length?'insufficient':lift!==null&&lift>=e.minLift?'promising':lift!==null&&lift<=-e.minLift?'not_supported':'inconclusive';
 return {status,label:{insufficient:'근거 부족',promising:'관찰상 개선',not_supported:'개선 가설 미지지',inconclusive:'차이 불명확'}[status],controlRate:ar,treatmentRate:br,lift,reasons};
}
// storeId가 있는 규칙은 같은 지점의 캠페인에만 전달한다. 한 지점의 관찰을 다른 지점으로 일반화하지 않는다.
export function ruleApplies(rule:LearningRule,brandId:string,channels:string,now=Date.now(),storeId?:string){
 if(rule.storeId&&rule.storeId!==storeId)return false;
 return rule.status==='active'&&rule.brandId===brandId&&Date.parse(rule.expiresAt)>now&&channelAliases(rule.channel).some(x=>channels.toLowerCase().includes(x));
}
// 재검토가 필요한 규칙. 만료됐거나 만료가 임박한 활성 규칙을 모은다.
export const RULE_REVIEW_WINDOW_MS=7*86400000;
export function ruleNeedsReview(rule:LearningRule,now=Date.now()){
 return rule.status==='active'&&Date.parse(rule.expiresAt)-now<=RULE_REVIEW_WINDOW_MS;
}
