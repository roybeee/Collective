export const learningChannels=['Instagram','YouTube','TikTok','Reddit'] as const;
export const learningMetrics={share_rate:{label:'도달 대비 공유',denominator:'도달 수',numerator:'공유 횟수'},completion_rate:{label:'재생 대비 완주',denominator:'재생 시작 수',numerator:'완주 수'},click_rate:{label:'노출 대비 클릭',denominator:'노출 수',numerator:'클릭 수'}};
export type LearningMetric=keyof typeof learningMetrics;
export type ViralCase={id:string;brandId:string;title:string;channel:string;url:string;account:string;publishedAt:string;observedAt:string;scope:string;observations:string;transcript:string;views:number|null;baselineViews:number|null;comparison:string;origin:'manual'|'hermes';createdAt:string};
export type TestIdea={hypothesis:string;variable:string;control:string;treatment:string;metric:LearningMetric};
export type ViralAnalysis={id:string;caseId:string;brandId:string;facts:string;hook:string;retention:string;sharing:string;context:string;counterEvidence:string;unknowns:string;ideas:TestIdea[];origin:'manual'|'hermes';createdAt:string};
export type Arm={denominator:number|null;numerator:number|null;source:string};
export type ExperimentResult={control:Arm;treatment:Arm;comparable:boolean;notes:string;observedUntil:string;recordedAt:string};
export type Assessment={status:'insufficient'|'promising'|'not_supported'|'inconclusive';label:string;controlRate:number|null;treatmentRate:number|null;lift:number|null;reasons:string[]};
export type ViralExperiment={id:string;brandId:string;campaignId:string;caseId:string;analysisId:string;title:string;channel:string;hypothesis:string;variable:string;control:string;treatment:string;metric:LearningMetric;minSample:number;minHours:number;minLift:number;conditions:string;version:number;status:'draft'|'running'|'evaluated';startedAt:string|null;createdAt:string;updatedAt:string;result:ExperimentResult|null;assessment:Assessment|null};
export type LearningRule={direction?:'test'|'caution';sourceAssessment?:{status:'promising'|'not_supported';metric:LearningMetric;controlRate:number|null;treatmentRate:number|null;lift:number|null;controlSample:number|null;treatmentSample:number|null;startedAt:string|null;observedUntil:string;conditions:string;notes:string};id:string;brandId:string;channel:string;experimentId:string;experimentVersion:number;caseId:string;title:string;guidance:string;scope:string;evidenceLevel:'observational';status:'active'|'paused'|'retired';version:number;expiresAt:string;createdAt:string;updatedAt:string};
export type LearningSnapshot={id:string;campaignId:string;role:string;createdAt:string;rules:LearningRule[]};
export type LearningJob={id:string;campaignId:string;role:string;status:string;error:string|null;createdAt:string};
export type LearningData={cases:ViralCase[];analyses:ViralAnalysis[];experiments:ViralExperiment[];rules:LearningRule[];snapshots:LearningSnapshot[];jobs:LearningJob[];observations:(ViralCase&{caseId:string})[];jobOutputs:{id:string;output:string}[]};
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
export function ruleApplies(rule:LearningRule,brandId:string,channels:string,now=Date.now()){
 const aliases:Record<string,string[]>={Instagram:['instagram','인스타그램','인스타','릴스'],YouTube:['youtube','유튜브','쇼츠'],TikTok:['tiktok','틱톡'],Reddit:['reddit','레딧']};
 return rule.status==='active'&&rule.brandId===brandId&&Date.parse(rule.expiresAt)>now&&(aliases[rule.channel]||[rule.channel.toLowerCase()]).some(x=>channels.toLowerCase().includes(x));
}
