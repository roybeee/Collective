import {channelRegistry,channelAliases} from './channels';
import type {ViralStats} from './viral-stats';
// 사용자가 사례로 직접 등록할 수 있는 채널. 전환 채널은 점포 실험 승격 경로로만 규칙이 된다.
export const learningChannels:string[]=Object.keys(channelRegistry).filter(name=>channelRegistry[name].caseEligible);
// 앱이 발행(Buffer Instagram)하거나 성과를 자동 수집(lib/connectors)할 수 있는 채널. 실험을 앱 안에서 실행·측정할 수 있다.
export const verifyChannels:string[]=Object.keys(channelRegistry).filter(name=>!!channelRegistry[name].connectorKey);
// 검증할 채널의 기본값. 사례 채널에서 앱이 측정할 수 있으면 그대로, 아니면 Instagram에서 검증한다.
export function defaultVerifyChannel(caseChannel:string){return verifyChannels.includes(caseChannel)?caseChannel:'Instagram'}
export const learningMetrics={share_rate:{label:'도달 대비 공유',denominator:'도달 수',numerator:'공유 횟수'},completion_rate:{label:'재생 대비 완주',denominator:'재생 시작 수',numerator:'완주 수'},click_rate:{label:'노출 대비 클릭',denominator:'노출 수',numerator:'클릭 수'}};
export type LearningMetric=keyof typeof learningMetrics;
export type ViralCase={id:string;brandId:string;title:string;channel:string;url:string;account:string;publishedAt:string;observedAt:string;scope:string;observations:string;transcript:string;views:number|null;baselineViews:number|null;comparison:string;origin:'manual'|'hermes';createdAt:string};
export type TestIdea={hypothesis:string;variable:string;control:string;treatment:string;metric:LearningMetric};
export type ViralAnalysis={id:string;caseId:string;brandId:string;facts:string;hook:string;retention:string;sharing:string;context:string;counterEvidence:string;unknowns:string;ideas:TestIdea[];origin:'manual'|'hermes';createdAt:string};
export type Arm={denominator:number|null;numerator:number|null;source:string};
export type ExperimentResult={control:Arm;treatment:Arm;comparable:boolean;notes:string;observedUntil:string;recordedAt:string};
export type Assessment={status:'insufficient'|'promising'|'not_supported'|'inconclusive';label:string;controlRate:number|null;treatmentRate:number|null;lift:number|null;reasons:string[]};
// channel은 검증할 채널, caseChannel은 원 사례 채널이다. caseChannel이 없는 이전 실험은 channel이 사례 채널이다.
export type ViralExperiment={id:string;brandId:string;campaignId:string;caseId:string;analysisId:string;title:string;channel:string;caseChannel?:string;hypothesis:string;variable:string;control:string;treatment:string;metric:LearningMetric;minSample:number;minHours:number;minLift:number;conditions:string;version:number;status:'draft'|'running'|'evaluated';startedAt:string|null;createdAt:string;updatedAt:string;result:ExperimentResult|null;assessment:Assessment|null;stats?:ViralStats|null;completedLooks?:number};
// 점포 실험 회고에서 승격된 규칙의 근거. 바이럴 실험의 sourceAssessment와 지표 체계가 달라 분리한다.
// 모르는 값은 null로 남긴다. 관찰 기록이며 인과 효과가 아니다.
export type StoreAssessment={decision:'adopt'|'stop';primaryMetric:string;primaryMetricLabel:string;target:number|null;observed:number|null;periodStart:string;periodEnd:string;measurementSource:string;evidenceLevel:'observation'|'comparison'|'repeated';failureType:string;confounders:string;nextAction:string};
// channel은 검증 채널(주입 대상 판정 기준), caseChannel은 원 사례 채널이다. renewCount는 새 측정 없이 연장한 횟수, renewMeasuredAt은 마지막 연장의 근거가 된 측정의 기간 끝이다(바이럴은 observedUntil 시각, 점포는 성과 기간 종료일).
// 규칙 등급(대표 결정 9, 2026-09-24). 등급이 없는 기존 규칙(바이럴·점포)은 performance_observed(30일)다. operator_preference는 운영자 교정 판정에서 나온 규칙(60일)이고
// 성과 규칙과 다른 블록(operatorPreferences)으로 역할 입력에 들어간다. performance_tested는 골든 on/off 비교를 첨부할 때만 부여한다(부여 경로는 B3-2, 지금은 409).
export const RULE_GRADES=['operator_preference','performance_observed','performance_tested'] as const;
export type RuleGrade=typeof RULE_GRADES[number];
// performance_tested 기간은 B3-2에서 골든 비교를 연결할 때 확정한다(지금은 부여 경로가 없다).
export const GRADE_DAYS:Record<RuleGrade,number>={operator_preference:60,performance_observed:30,performance_tested:30};
// 채널 무관 범위. 운영자 선호 규칙의 기본값이며 채널이 비어 있는 같은 브랜드 캠페인에도 적용된다.
export const ANY_CHANNEL='*';
// 운영자 선호 규칙 본문 상한(글자). 화면 입력 한도와 서버 검사(lib/playbook-curator.ts)가 같은 값을 쓴다.
export const PLAYBOOK_MAX_CHARS=400;
// origin review(운영자 교정 판정)·preference(편집 diff 근거)는 운영자 선호 규칙이다. role이 있으면 그 역할 입력에만, citations는 인용한 review_decision id,
// feedback은 helpful/harmful 카운터 자리다(갱신은 B3-2). 운영자 선호 규칙은 실험 근거가 없어 evidenceLevel·experimentId를 쓰지 않는다(experimentId는 빈 문자열).
export type LearningRule={origin?:'viral'|'store'|'review'|'preference';grade?:RuleGrade;role?:string;citations?:string[];feedback?:{helpful:number;harmful:number};storeId?:string;storeAssessment?:StoreAssessment;renewCount?:number;renewedAt?:string;renewReason?:string;renewMeasuredAt?:string;caseChannel?:string;direction?:'test'|'caution';sourceAssessment?:{status:'promising'|'not_supported';metric:LearningMetric;controlRate:number|null;treatmentRate:number|null;lift:number|null;controlSample:number|null;treatmentSample:number|null;startedAt:string|null;observedUntil:string;conditions:string;notes:string;stats?:ViralStats|null;decision?:'adopt'|'stop';decisionConflict?:'interim'|'mismatch';decisionReason?:string};id:string;brandId:string;channel:string;experimentId:string;experimentVersion:number;caseId:string;title:string;guidance:string;scope:string;evidenceLevel?:'observational';status:'draft'|'active'|'paused'|'retired';version:number;expiresAt:string;createdAt:string;updatedAt:string};
// operatorPreferences·artifactId는 운영자 선호 규칙을 주입한 역할 실행에만 있다(규칙 0건이면 키가 없다). 규칙을 중지하면 이 기록으로 재확인 대상 작업물을 찾는다.
export type LearningSnapshot={id:string;campaignId:string;role:string;createdAt:string;rules:LearningRule[];operatorPreferences?:LearningRule[];artifactId?:string};
export type LearningJob={id:string;campaignId:string;role:string;status:string;error:string|null;createdAt:string};
export type LearningGuidance={id:string;experimentId:string;experimentVersion:number;guidance:string;createdAt:string};
// 인용 선택용 사람 판정 요약(GET /api/learning). 메모 원문·행위자는 없다. brandId는 기록의 브랜드, 없으면 캠페인의 브랜드다.
export type ReviewDecisionSummary={id:string;brandId:string;targetKind:string;role:string|null;decision:string;reasonCodes:string[];origin?:string;campaignId:string|null;createdAt:string};
// Curator 제안(자동 병합 없음). duplicate는 같은 뜻의 규칙, conflict는 같은 주제에서 서로 반대 지시다.
export type CurationSuggestion={kind:'duplicate'|'conflict';ruleIds:[string,string];brandId:string;role:string|null;similarity:number;note:string};
// 운영자 선호 규칙 중지 때 그 규칙이 주입된 작업물의 재확인 표시(캠페인 이력 event의 playbookRecheck를 작업물 단위로 편 것). 작업물 내용은 바꾸지 않는다.
export type PlaybookRecheck={id:string;ruleId:string;ruleVersion:number;artifactId:string;artifactVersion:number;campaignId:string;jobId:string;role:string;reason:'rule_paused';createdAt:string};
export type LearningData={reviewDecisions?:ReviewDecisionSummary[];playbookSuggestions?:CurationSuggestion[];playbookRechecks?:PlaybookRecheck[];guidances?:LearningGuidance[];expiringRules?:LearningRule[];cases:ViralCase[];analyses:ViralAnalysis[];experiments:ViralExperiment[];rules:LearningRule[];snapshots:LearningSnapshot[];jobs:LearningJob[];observations:(ViralCase&{caseId:string})[];jobOutputs:{id:string;output:string}[]};
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
export const ruleGrade=(r:Pick<LearningRule,'grade'>):RuleGrade=>r.grade??'performance_observed';
export const operatorRule=(r:Pick<LearningRule,'grade'>)=>ruleGrade(r)==='operator_preference';
// storeId가 있는 규칙은 같은 지점의 캠페인에만 전달한다. 한 지점의 관찰을 다른 지점으로 일반화하지 않는다.
// 채널은 검증 채널(rule.channel)로만 판정한다. 원 사례 채널(caseChannel)은 보지 않는다. channel "*"은 채널과 무관하게(비어 있어도) 같은 브랜드에 적용된다.
// role이 있는 규칙은 그 역할의 입력에만 전달한다(역할을 모르는 호출에는 전달하지 않는다). role이 없는 기존 규칙의 판정은 그대로다.
export function ruleApplies(rule:LearningRule,brandId:string,channels:string,now=Date.now(),storeId?:string,role?:string){
 if(rule.storeId&&rule.storeId!==storeId)return false;
 if(rule.role&&rule.role!==role)return false;
 return rule.status==='active'&&rule.brandId===brandId&&Date.parse(rule.expiresAt)>now&&(rule.channel===ANY_CHANNEL||channelAliases(rule.channel).some(x=>channels.toLowerCase().includes(x)));
}
// 재검토가 필요한 규칙. 만료됐거나 만료가 임박한 활성 규칙을 모은다.
export const RULE_REVIEW_WINDOW_MS=7*86400000;
export function ruleNeedsReview(rule:LearningRule,now=Date.now()){
 return rule.status==='active'&&Date.parse(rule.expiresAt)-now<=RULE_REVIEW_WINDOW_MS;
}
// 만료 임박 알림(GET /api/learning expiringRules). 재검토 대상 중 원 캠페인이 삭제된 규칙(재검증·연장 불가)은 빼고, 먼저 만료되는 순으로 둔다.
// 운영자 선호 규칙은 재검증 실험 대상이 아니라 빼고, 학습 화면의 운영자 선호 영역에서 재확인(연장)을 안내한다(playbookState).
export function expiringRules<T extends LearningRule&{sourceCampaignDeleted?:unknown}>(rules:readonly T[],now=Date.now()):T[]{
 return rules.filter(r=>!r.sourceCampaignDeleted&&!operatorRule(r)&&ruleNeedsReview(r,now)).sort((a,b)=>Date.parse(a.expiresAt)-Date.parse(b.expiresAt));
}
// 운영자 선호 규칙의 만료 상태(화면). 만료되면 주입에서 빠지고, 적용 중인 규칙은 만료 7일 전부터 재확인이 필요하다(ruleNeedsReview와 같은 창).
export function playbookState(r:Pick<LearningRule,'status'|'expiresAt'>,now=Date.now()){
 const left=Date.parse(r.expiresAt)-now;
 return {expired:left<=0,reconfirm:r.status==='active'&&left<=RULE_REVIEW_WINDOW_MS,daysLeft:Math.max(0,Math.ceil(left/86400000))};
}
