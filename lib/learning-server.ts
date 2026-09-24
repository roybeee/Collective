import {ApiError,str,num,stamp,uid,readRecord,listRecords,recordStatement,database,eventStatement,type EventActor} from './server';
import {learningChannels,learningMetrics,evaluateExperiment,ruleApplies,defaultVerifyChannel,operatorRule,ANY_CHANNEL,PLAYBOOK_MAX_CHARS,type ViralCase,type ViralAnalysis,type TestIdea,type ViralExperiment,type ExperimentResult,type LearningRule,type LearningSnapshot,type Arm,type StoreAssessment,type ReviewDecisionSummary,type PlaybookRecheck} from './learning';
import {channelHosts,storeChannelName,channelRegistry} from './channels';
import {normalizeRuleBody,ruleBodyProblem,ruleTitle,playbookExpiry,activationProblem,MAX_ACTIVE_PER_ROLE,PLAYBOOK_MIN_CITATIONS,PLAYBOOK_MAX_CITATIONS} from './playbook-curator';
import type {ReviewDecision} from './review-decisions';
import {summarizeResult,planShortfall,decisionConflict} from './viral-stats';
import type {StoreExperiment,StoreMeasurement,StoreReview} from './store-marketing';
import {roles,type Brand,type Campaign,type Artifact} from './agency';
import type {SourceCampaignDeleted} from './record-kinds';
export const RULE_DAYS=30;
// 결정 7(b): 원 캠페인이 삭제된 바이럴 규칙은 종료 상태로만 남는다. 재검증·연장·상태 변경 대신 새 실험을 안내한다.
function assertSourceCampaign(r:LearningRule&{sourceCampaignDeleted?:SourceCampaignDeleted}){if(r.sourceCampaignDeleted)throw new ApiError(409,'원 캠페인이 삭제되어 이 규칙은 재검증·연장·상태 변경을 할 수 없습니다. 캠페인을 선택해 새 실험을 만들어 주세요.')}
const expiry=(from=Date.now())=>new Date(from+RULE_DAYS*86400000).toISOString();
// 운영자 선호 규칙은 소유자 전용 playbook_* 작업(감사 로그 포함)으로만 상태를 바꾼다. 기존 중지·종료·연장·재검증 작업은 거절한다.
function assertNotOperatorRule(r:LearningRule){if(operatorRule(r))throw new ApiError(409,'운영자 선호 규칙은 학습 규칙 화면의 운영자 선호 영역에서 승인·중지·연장합니다.')}

export function publicUrl(value:unknown,label='출처 URL'){
 const raw=str(value,label,2000,true);let u:URL;try{u=new URL(raw)}catch{throw new ApiError(400,`${label}을 확인해 주세요.`)}
 if(!['http:','https:'].includes(u.protocol)||u.username||u.password||!u.hostname.includes('.')||u.hostname==='localhost'||/^[\d.]+$/.test(u.hostname))throw new ApiError(400,`${label}은 공개 웹 주소여야 합니다.`);
 u.hash='';return u.href;
}
export function canonicalCaseUrl(value:unknown){
 const u=new URL(publicUrl(value));u.protocol='https:';u.hostname=u.hostname.replace(/^www\./,'').replace(/^m\./,'');
 if(u.hostname==='youtu.be'){const id=u.pathname.split('/')[1];u.hostname='youtube.com';u.pathname='/watch';u.search='';u.searchParams.set('v',id)}
 else if(u.hostname==='youtube.com'){const id=u.searchParams.get('v')||(/^\/(shorts|embed)\//.test(u.pathname)?u.pathname.split('/')[2]:'');u.search='';if(id){u.pathname='/watch';u.searchParams.set('v',id)}}
 else u.search='';u.pathname=u.pathname.replace(/\/+$/,'')||'/';return u.href;
}
function nullableNumber(v:unknown,label:string){return v===null||v===undefined||v===''?null:num(v,label)}
function dated(v:unknown,label:string,required=true){const s=str(v??'',label,50,required);if(s&&(!Number.isFinite(Date.parse(s))||Date.parse(s)>Date.now()+60000))throw new ApiError(400,`${label}은 현재까지의 유효한 날짜여야 합니다.`);return s?new Date(s).toISOString():''}
export async function makeCase(owner:string,b:any,origin:'manual'|'hermes'='manual'):Promise<ViralCase>{
 const brandId=str(b.brandId,'브랜드',100,true);await readRecord<Brand>(owner,'brand',brandId);
 const channel=str(b.channel,'채널',30,true);if(!(learningChannels as readonly string[]).includes(channel))throw new ApiError(400,'지원하는 채널을 선택하세요.');
 const url=canonicalCaseUrl(b.url),host=new URL(url).hostname;
 // 원본 호스트를 특정할 수 있는 채널만 검증한다. 국내 로컬 채널은 canonicalCaseUrl의 공개 URL 검사로 남긴다.
 const hosts=channelHosts(channel);
 if(hosts&&!hosts.some(h=>host===h||host.endsWith('.'+h)))throw new ApiError(400,'선택한 채널의 게시물 URL을 입력하세요.');
 if(b.baselineViews!==null&&b.baselineViews!==undefined&&b.baselineViews!==''&&!str(b.comparison??'','비교 조건',3000))throw new ApiError(400,'평소 기준 조회수의 표본과 관찰 길이를 적어 주세요.');
 const observedAt=dated(b.observedAt||stamp(),'관찰 시점'),publishedAt=dated(b.publishedAt,'게시 시점',false);if(publishedAt&&publishedAt>observedAt)throw new ApiError(400,'게시 시점은 관찰 시점 이전이어야 합니다.');
 return {id:uid(),brandId,title:str(b.title,'사례 이름',200,true),channel,url,account:str(b.account??'','계정',200),publishedAt,observedAt,scope:str(b.scope,'실제로 확인한 범위',2000,true),observations:str(b.observations,'확인한 내용',14000,true),transcript:str(b.transcript??'','자막·장면 메모',20000),views:nullableNumber(b.views,'조회수'),baselineViews:nullableNumber(b.baselineViews,'비교 기준 조회수'),comparison:str(b.comparison??'','비교 조건',3000),origin,createdAt:stamp()};
}
export function parseAnalysis(raw:any,c:ViralCase,origin:'manual'|'hermes'):ViralAnalysis{
 if(!raw||!Array.isArray(raw.ideas)||raw.ideas.length<1||raw.ideas.length>3)throw new ApiError(400,'검증할 실험안을 1~3개 작성해 주세요.');
 const out:any={id:uid(),caseId:c.id,brandId:c.brandId,origin,createdAt:stamp()};
 for(const key of ['facts','hook','retention','sharing','context','counterEvidence','unknowns'])out[key]=str(raw[key],key,6000,true);
 out.ideas=raw.ideas.map((x:any)=>{if(!x||!Object.hasOwn(learningMetrics,x.metric))throw new ApiError(400,'실험 주지표를 확인해 주세요.');const idea:any={metric:x.metric};for(const k of ['hypothesis','variable','control','treatment'])idea[k]=str(x[k],k,6000,true);return idea as TestIdea});return out;
}
// 모델 입력의 규칙은 판정 통계 도입 이전과 같게 둔다. 통계 요약·확정 기록은 화면·감사용이며 역할 지시문에 뜻이 정의돼 있지 않다.
const MODEL_OMIT=['stats','decision','decisionReason','decisionConflict'];
// 원 사례 채널·연장 근거 측정 시각도 화면·감사용이다. 모델에는 검증 채널(channel)만 전달한다.
const MODEL_RULE_OMIT=['caseChannel','renewMeasuredAt'];
const modelRule=(rule:LearningRule):LearningRule=>{const r=Object.fromEntries(Object.entries(rule).filter(([k])=>!MODEL_RULE_OMIT.includes(k))) as LearningRule;return r.sourceAssessment?{...r,sourceAssessment:Object.fromEntries(Object.entries(r.sourceAssessment).filter(([k])=>!MODEL_OMIT.includes(k))) as NonNullable<LearningRule['sourceAssessment']>}:r};
// 성과 규칙(learning 블록). 운영자 선호 규칙은 다른 블록(operatorPreferenceContext)으로 가므로 뺀다. 브리프·회의 경로도 이 함수만 쓴다(운영자 선호 주입은 역할 실행만, B3-1).
export async function learningContext(owner:string,c:Pick<Campaign,'brandId'|'channels'|'storeId'>){
 const rules=await listRecords<LearningRule>(owner,'learning_rule');
 return rules.filter(r=>!operatorRule(r)&&ruleApplies(r,c.brandId,c.channels,Date.now(),c.storeId))
  // 지점 전용 규칙이 더 구체적이므로 먼저 전달한다.
  .sort((a,b)=>Number(!!b.storeId)-Number(!!a.storeId)||b.createdAt.localeCompare(a.createdAt))
  .slice(0,12).map(modelRule);
}
// 운영자 선호 규칙(B3-1). 승인(active)·미만료·같은 브랜드·채널("*" 포함)·역할이 맞는 것만 역할당 8개까지. 역할 지정 규칙을 먼저, 그다음 최신순이다.
export async function operatorPreferenceContext(owner:string,c:Pick<Campaign,'brandId'|'channels'|'storeId'>,role:string){
 const rules=await listRecords<LearningRule>(owner,'learning_rule'),now=Date.now();
 return rules.filter(r=>operatorRule(r)&&ruleApplies(r,c.brandId,c.channels,now,c.storeId,role))
  .sort((a,b)=>Number(!!b.role)-Number(!!a.role)||b.createdAt.localeCompare(a.createdAt)||a.id.localeCompare(b.id)).slice(0,MAX_ACTIVE_PER_ROLE);
}
// 점포 실험 회고를 학습 규칙으로 승격한다. 게이트를 통과하지 못하면 null을 반환하고 회고만 저장된다.
// 바이럴 실험의 sourceAssessment와 지표 체계가 달라 storeAssessment로 분리해 담는다.
export function storeLearningRule(e:StoreExperiment,decision:string,learning:string,review:StoreReview|undefined,measurements:StoreMeasurement[],metricLabel:string):LearningRule|null{
 if(decision!=='adopt'&&decision!=='stop')return null;
 if(!review?.nextAction?.trim())return null;
 const measured=measurements.filter(m=>m.experimentId===e.id&&(m.scope??'experiment')==='experiment'&&m.values[e.primaryMetric]!==null).sort((a,b)=>b.periodEnd.localeCompare(a.periodEnd))[0];
 if(!measured)return null;
 // 대조 없는 단일 관측은 규칙이 되지 못한다. 회고가 스스로 'observation'이라 적은 것을 그대로 게이트로 쓴다.
 if(review.evidenceLevel==='observation')return null;
 const storeAssessment:StoreAssessment={decision,primaryMetric:e.primaryMetric,primaryMetricLabel:metricLabel,target:e.target,observed:measured.values[e.primaryMetric],periodStart:measured.periodStart,periodEnd:measured.periodEnd,measurementSource:measured.source,evidenceLevel:review.evidenceLevel,failureType:review.failureType,confounders:review.confounders,nextAction:review.nextAction};
 return {id:'store:'+e.id+':'+e.version,origin:'store',storeId:e.storeId,storeAssessment,direction:decision==='adopt'?'test':'caution',brandId:e.brandId,channel:storeChannelName(e.channel)||e.channel,experimentId:e.id,experimentVersion:e.version,caseId:'',title:e.title,guidance:learning,scope:review.conditions||e.measurement,evidenceLevel:'observational',status:'active',version:1,expiresAt:expiry(),createdAt:stamp(),updatedAt:stamp()};
}
// preferences: 운영자 선호 규칙을 주입한 역할 실행만 넘긴다. 0건이면 이전과 같은 모양으로 저장한다(키 없음).
export function learningSnapshotStatement(owner:string,id:string,c:Campaign,role:string,rules:LearningRule[],skillVersion?:string,preferences?:{operatorPreferences:LearningRule[];artifactId:string}){
 const snap:LearningSnapshot & {skillVersion?:string}={skillVersion,id,campaignId:c.id,role,rules,createdAt:stamp(),...(preferences?.operatorPreferences.length?preferences:{})};return recordStatement(owner,'learning_snapshot',id,snap,c.id);
}
export async function saveLearningSnapshot(owner:string,id:string,c:Campaign,role:string,rules:LearningRule[],skillVersion?:string){
 await learningSnapshotStatement(owner,id,c,role,rules,skillVersion).run();
}
// 판정할 수 있는 확인(계획 충족·비교 가능)만 센다. 계획 전이나 비교 가능성 확인 전에 본 결과는 중간 확인 경고로 따로 잡는다.
const completedLook=(e:ViralExperiment,r:ExperimentResult,now:number)=>!planShortfall(e,r,now).length&&r.comparable===true;
const sameCounts=(a:ExperimentResult,b:ExperimentResult)=>(['control','treatment'] as const).every(k=>a[k].denominator===b[k].denominator&&a[k].numerator===b[k].numerator);
// 이번 확인 전에 판정할 수 있는 결과를 본 횟수. completedLooks가 없던 실험은 저장된 결과로 센다.
// 수치가 그대로인 재저장(메모·비교 가능성·종료 시점 정정)은 새 데이터를 본 것이 아니므로 직전 확인을 대신한다.
function looksBefore(e:ViralExperiment,result:ExperimentResult,now:number){
 const prev=e.result,counted=e.completedLooks??(prev&&completedLook(e,prev,now)?1:0);
 return prev&&sameCounts(prev,result)?Math.max(0,counted-(completedLook(e,prev,now)?1:0)):counted;
}
// 사후확률 요약. 이 기능 전에 저장된 실험은 읽을 때 계산만 하고 저장하지 않는다(이전 확인 이력은 알 수 없어 0회로 본다).
export function experimentStats(e:ViralExperiment){return e.stats!==undefined?e.stats:e.result?summarizeResult(e,e.result,0,Date.now(),e.assessment?.status??null):null}
export const withStats=(e:ViralExperiment):ViralExperiment=>e.stats===undefined&&e.result?{...e,stats:experimentStats(e)}:e;
function arm(raw:any,label:string,metric:string):Arm{
 if(!raw)throw new ApiError(400,`${label} 결과가 필요합니다.`);const denominator=nullableNumber(raw.denominator,`${label} 분모`),numerator=nullableNumber(raw.numerator,`${label} 반응 수`);
 if((denominator!==null&&!Number.isInteger(denominator))||(numerator!==null&&!Number.isInteger(numerator)))throw new ApiError(400,'횟수는 정수로 입력하세요.');
 if(metric==='completion_rate'&&denominator!==null&&numerator!==null&&numerator>denominator)throw new ApiError(400,'완주 수는 재생 시작 수를 초과할 수 없습니다.');
 return {denominator,numerator,source:str(raw.source,'수치 출처와 조회 조건',3000,true)};
}
// 연장 근거가 되는 새 측정: since 이후의 관찰 구간이 있는 유효한 측정의 기간 끝(가장 늦은 것, 없으면 null).
// 저장 시각이 아니라 측정 기간 끝을 본다. 같은 결과를 다시 저장하거나 지난 기간을 뒤늦게 입력해도 새 측정이 아니다(R1·SEC-1).
// 바이럴 규칙은 재검증 실험(retest_rule) 결과 중 두 안의 분모가 있고 근거 부족이 아닌 것, 점포 규칙은 원 실험에서 이어간 후속 실험 성과 중
// 규칙의 핵심 지표가 기록된 것이다(처치 전 기준선 제외). 점포 성과 기간은 날짜뿐이라 since의 Asia/Seoul 날짜보다 뒤에 끝나야 한다.
async function measuredSince(owner:string,r:LearningRule,since:string,viral?:ViralExperiment[]):Promise<string|null>{
 let ends:string[];
 if(r.origin==='store'){
  if(!r.storeId)return null;
  const [experiments,measurements]=await Promise.all([listRecords<StoreExperiment>(owner,'store_experiment',r.storeId),listRecords<StoreMeasurement>(owner,'store_measurement',r.storeId)]);
  const ids=new Set([r.experimentId,...experiments.filter(x=>x.parentExperimentId===r.experimentId).map(x=>x.id)]),metric=r.storeAssessment?.primaryMetric,sinceDay=new Date(since).toLocaleDateString('en-CA',{timeZone:'Asia/Seoul'});
  const recorded=(m:StoreMeasurement)=>{const values=(m.values??{}) as Record<string,number|null|undefined>;return metric?typeof values[metric]==='number':Object.values(values).some(v=>typeof v==='number')};
  ends=measurements.filter(m=>ids.has(m.experimentId)&&(m.scope??'experiment')==='experiment'&&recorded(m)&&m.periodEnd>sinceDay).map(m=>m.periodEnd);
 }else ends=(viral??await listRecords<ViralExperiment>(owner,'viral_experiment')).filter(x=>x.id==='retest:'+r.id&&!!x.result&&!!x.assessment&&x.assessment.status!=='insufficient'&&x.result.control.denominator!==null&&x.result.treatment.denominator!==null&&x.result.observedUntil>since).map(x=>x.result!.observedUntil);
 return ends.sort().at(-1)??null;
}
// 서버가 연장을 거절하는 규칙인지: 측정 없이 한 번 연장했고 그 뒤 새 측정이 없다. GET /api/learning이 규칙마다 계산해 화면이 같은 판정으로 연장 버튼을 끈다.
export async function renewBlocked(owner:string,r:LearningRule,viral?:ViralExperiment[]){return (r.renewCount||0)>=1&&!await measuredSince(owner,r,r.renewedAt??r.createdAt,viral)}
export async function learningAction(owner:string,b:any,by?:PlaybookActor){
 if(typeof b.action==='string'&&b.action.startsWith('playbook_'))return playbookAction(owner,b,by);
 if(b.action==='add_case'){
  const c=await makeCase(owner,b.data);const previous=(await listRecords<ViralCase>(owner,'viral_case')).find(x=>x.brandId===c.brandId&&x.url===c.url);
  if(previous){const id=uid();await recordStatement(owner,'case_observation',id,{...c,id,caseId:previous.id},previous.id).run();return {id:previous.id,duplicate:true}}
  await recordStatement(owner,'viral_case',c.id,c,c.brandId).run();return {id:c.id};
 }
 if(b.action==='save_analysis'){
  const c=await readRecord<ViralCase>(owner,'viral_case',str(b.caseId,'사례',100,true));const analysis=parseAnalysis(b.data,c,'manual');await recordStatement(owner,'viral_analysis',analysis.id,analysis,c.id).run();return {id:analysis.id};
 }
 if(b.action==='create_experiment'){
  const a=await readRecord<ViralAnalysis>(owner,'viral_analysis',str(b.analysisId,'분석',100,true)),c=await readRecord<ViralCase>(owner,'viral_case',a.caseId);
  const campaign=await readRecord<Campaign>(owner,'campaign',str(b.campaignId,'캠페인',100,true));if(campaign.brandId!==a.brandId)throw new ApiError(400,'동일 브랜드의 캠페인을 선택하세요.');
  const d=b.data||{};const minSample=num(d.minSample,'최소 표본'),minHours=num(d.minHours,'최소 관찰 시간'),minLift=num(d.minLift,'목표 개선율');if(!Number.isInteger(minSample)||minSample<100||minHours<1||minHours>2160||minLift<=0||minLift>1000)throw new ApiError(400,'최소 표본 100 이상, 관찰 1~2160시간, 개선율 0 초과~1000%로 설정하세요.');
  if(!Object.hasOwn(learningMetrics,d.metric))throw new ApiError(400,'주지표를 선택하세요.');
  // 검증할 채널은 사례 채널과 따로 받는다. 비우면 앱이 발행·수집할 수 있는 채널을 쓴다. 사례로 등록할 수 있는 채널만 고를 수 있다.
  const verifyChannel=d.verifyChannel===undefined||d.verifyChannel===null||d.verifyChannel===''?defaultVerifyChannel(c.channel):str(d.verifyChannel,'검증할 채널',30,true);
  if(!learningChannels.includes(verifyChannel)&&verifyChannel!==c.channel)throw new ApiError(400,'검증할 채널을 선택하세요.');
  const now=stamp(),e:ViralExperiment={id:uid(),brandId:a.brandId,campaignId:campaign.id,caseId:c.id,analysisId:a.id,title:str(d.title,'실험 이름',200,true),channel:verifyChannel,caseChannel:c.channel,hypothesis:str(d.hypothesis,'가설',6000,true),variable:str(d.variable,'바꿀 요소',3000,true),control:str(d.control,'대조안',6000,true),treatment:str(d.treatment,'실험안',6000,true),metric:d.metric,minSample,minHours,minLift,conditions:str(d.conditions,'동일하게 유지할 조건',6000,true),version:1,status:'draft',startedAt:null,createdAt:now,updatedAt:now,result:null,assessment:null};
  await database().batch([recordStatement(owner,'viral_experiment',e.id,e,campaign.id),eventStatement(owner,campaign.id,`바이럴 실험 「${e.title}」을 설계했습니다.`,by)]);return {id:e.id};
 }
 if(['start_experiment','save_results','adopt_rule'].includes(b.action)){
  const e=await readRecord<ViralExperiment>(owner,'viral_experiment',str(b.id,'실험',100,true));if(b.version!==e.version)throw new ApiError(409,'실험이 변경됐습니다. 새로고침 후 다시 시도하세요.');
  if(b.action==='start_experiment'){
   if(e.status!=='draft')throw new ApiError(409,'이미 시작된 실험입니다.');const updated={...e,status:'running',version:e.version+1,startedAt:stamp(),updatedAt:stamp()};await recordStatement(owner,'viral_experiment',e.id,updated,e.campaignId).run();return {id:e.id};
  }
  if(b.action==='save_results'){
   if(!e.startedAt)throw new ApiError(409,'실험 계획을 먼저 확정하세요.');const d=b.data||{},observedUntil=dated(d.observedUntil,'측정 종료 시점');if(observedUntil<e.startedAt)throw new ApiError(400,'측정 종료는 실험 시작 이후여야 합니다.');
   const result:ExperimentResult={control:arm(d.control,'대조안',e.metric),treatment:arm(d.treatment,'실험안',e.metric),comparable:d.comparable===true,notes:str(d.notes,'측정 조건·차이·한계',6000,true),observedUntil,recordedAt:stamp()};
   const checkedAt=Date.now(),looks=looksBefore(e,result,checkedAt),assessment=evaluateExperiment(e,result),stats=summarizeResult(e,result,looks,checkedAt,assessment.status);
   const updated={...e,result,assessment,stats,completedLooks:looks+(completedLook(e,result,checkedAt)?1:0),version:e.version+1,status:'evaluated',updatedAt:stamp()};
   const oldRules=(await listRecords<LearningRule>(owner,'learning_rule')).filter(r=>r.experimentId===e.id&&r.status!=='retired');
   await database().batch([recordStatement(owner,'experiment_revision',e.id+':'+e.version,e,e.id),recordStatement(owner,'viral_experiment',e.id,updated,e.campaignId),...oldRules.map(r=>recordStatement(owner,'learning_rule',r.id,{...r,status:'retired',version:r.version+1,updatedAt:stamp()},r.brandId)),eventStatement(owner,e.campaignId,`「${e.title}」 결과: ${updated.assessment.label}. 결과 정정 시 이전 학습 적용은 종료됩니다.`,by)]);return {id:e.id,assessment:updated.assessment,stats};
  }
  if(!e.assessment||!['promising','not_supported'].includes(e.assessment.status))throw new ApiError(409,'최소 표본·기간·비교 조건과 판정 기준을 충족한 결과가 필요합니다.');
  const id=e.id+':'+e.version;const existing=(await listRecords<LearningRule>(owner,'learning_rule')).find(r=>r.id===id);if(existing)return {id:existing.id};
  // 사람의 확정: 개선 판정은 채택(시험 적용), 미지지 판정은 중단(주의사항)이다. 통계 권고와 어긋나도 막지 않고 어긋남과 선택 사유를 규칙에 남긴다.
  const positive=e.assessment.status==='promising',decision=positive?'adopt' as const:'stop' as const,stats=experimentStats(e),reason=str(b.reason??'','판정 사유',2000),conflict=decisionConflict(stats,decision);
  const rule:LearningRule={origin:'viral',direction:positive?'test':'caution',...(e.result?{sourceAssessment:{status:e.assessment.status as 'promising'|'not_supported',metric:e.metric,controlRate:e.assessment.controlRate,treatmentRate:e.assessment.treatmentRate,lift:e.assessment.lift,controlSample:e.result.control.denominator,treatmentSample:e.result.treatment.denominator,startedAt:e.startedAt,observedUntil:e.result.observedUntil,conditions:e.conditions,notes:e.result.notes,stats,decision,...(conflict?{decisionConflict:conflict}:{}),...(reason?{decisionReason:reason}:{})}}:{}),id,brandId:e.brandId,channel:e.channel,caseChannel:e.caseChannel??e.channel,experimentId:e.id,experimentVersion:e.version,caseId:e.caseId,title:e.title,guidance:str(b.guidance,'다음 제작에 반영할 규칙',6000,true),scope:e.conditions,evidenceLevel:'observational',status:'active',version:1,expiresAt:expiry(),createdAt:stamp(),updatedAt:stamp()};
  await database().batch([recordStatement(owner,'learning_rule',id,rule,e.brandId),eventStatement(owner,e.campaignId,`「${e.title}」을 ${positive?'시험 적용 규칙':'실패에서 배운 주의사항'}으로 채택했습니다. 30일 후 재검토합니다.`,by)]);return {id};
 }
 if(b.action==='pause_rule'){
  const r=await readRecord<LearningRule>(owner,'learning_rule',str(b.id,'학습 규칙',200,true));assertSourceCampaign(r);assertNotOperatorRule(r);if(r.version!==b.version||r.status!=='active')throw new ApiError(409,'규칙 상태가 변경됐습니다.');await recordStatement(owner,'learning_rule',r.id,{...r,status:'paused',version:r.version+1,updatedAt:stamp()},r.brandId).run();return {id:r.id};
 }
 if(['retire_rule','renew_rule','retest_rule'].includes(b.action)){
  const r=await readRecord<LearningRule>(owner,'learning_rule',str(b.id,'학습 규칙',200,true));
  assertSourceCampaign(r);
  assertNotOperatorRule(r);
  if(r.version!==b.version)throw new ApiError(409,'규칙 상태가 변경됐습니다.');
  if(r.status==='retired')throw new ApiError(409,'이미 종료된 규칙입니다.');
  if(b.action==='retire_rule'){
   await recordStatement(owner,'learning_rule',r.id,{...r,status:'retired',version:r.version+1,updatedAt:stamp()},r.brandId).run();return {id:r.id,status:'retired'};
  }
  if(b.action==='renew_rule'){
   if(r.status!=='active')throw new ApiError(409,'활성 규칙만 연장할 수 있습니다.');
   // 새 측정 없이 연장한 사실을 규칙에 남긴다. 이 값은 모델 입력으로 그대로 전달되어 근거의 신선도를 낮춰 해석하게 한다.
   // 측정 없는 연장은 한 번까지다. 마지막 연장(없으면 채택) 이후 새 측정이 있으면 횟수를 늘리지 않고 그 측정 기간 끝을 남긴다(renewBlocked와 같은 판정).
   const reason=str(b.reason,'연장 사유',2000,true),measuredAt=await measuredSince(owner,r,r.renewedAt??r.createdAt);
   if(!measuredAt&&(r.renewCount||0)>=1)throw new ApiError(409,'연장은 한 번까지 측정 없이 가능합니다. 새 측정을 기록한 뒤 연장하세요.');
   const renewed={...r,expiresAt:expiry(),...(measuredAt?{renewMeasuredAt:measuredAt}:{renewCount:(r.renewCount||0)+1}),renewedAt:stamp(),renewReason:reason,version:r.version+1,updatedAt:stamp()};
   await recordStatement(owner,'learning_rule',r.id,renewed,r.brandId).run();return {id:r.id,expiresAt:renewed.expiresAt,renewCount:renewed.renewCount||0};
  }
  if(r.origin==='store')throw new ApiError(409,'점포 실험에서 승격된 규칙은 점포 마케팅 화면에서 후속 실험을 만드세요.');
  const source=await readRecord<ViralExperiment>(owner,'viral_experiment',r.experimentId);
  let campaign:Campaign;
  try{campaign=await readRecord<Campaign>(owner,'campaign',source.campaignId)}catch(err){if(err instanceof ApiError&&err.status===404)throw new ApiError(400,'원래 캠페인이 삭제됐습니다. 캠페인을 선택해 새 실험을 만들어 주세요.');throw err}
  const id='retest:'+r.id,existing=(await listRecords<ViralExperiment>(owner,'viral_experiment')).find(x=>x.id===id);
  if(existing)return {id:existing.id,duplicate:true};
  // 원 실험은 그대로 두고 설계만 복제한다. 측정 결과와 판정은 비운 draft로 시작한다.
  const now=stamp(),retest:ViralExperiment={...source,id,campaignId:campaign.id,title:'재검증 · '+source.title,status:'draft',version:1,startedAt:null,result:null,assessment:null,stats:null,completedLooks:0,createdAt:now,updatedAt:now};
  await database().batch([recordStatement(owner,'viral_experiment',id,retest,campaign.id),eventStatement(owner,campaign.id,`「${r.title}」 규칙의 재검증 실험을 만들었습니다. 만료 전에 다시 측정하세요.`,by)]);
  return {id};
 }
 throw new ApiError(400,'지원하지 않는 학습 작업입니다.');
}

// ── 운영자 선호 규칙(B3-1, 대표 결정 9). 사람 판정(review_decision)을 2건 이상 인용한 규칙을 소유자가 만들고 승인·중지·연장한다. 모델을 부르지 않는다.
// 생성은 초안(draft)이고 승인 전에는 주입 0건이다. 상태를 바꿀 때마다 playbook_audit를 남긴다(행위자는 id·역할만). 형식과 정책은 docs/PLAYBOOK.ko.md.
type PlaybookActor=EventActor&{role?:'owner'|'admin'|'member'};
type PlaybookAuditAction='create'|'activate'|'pause'|'renew';
function auditStatement(owner:string,r:LearningRule,action:PlaybookAuditAction,from:string,by:PlaybookActor,extra:Record<string,unknown>={}){
 const id=uid();
 return recordStatement(owner,'playbook_audit',id,{id,ruleId:r.id,brandId:r.brandId,action,fromStatus:from,toStatus:r.status,ruleVersion:r.version,expiresAt:r.expiresAt,actor:{id:by.id,role:by.role},...extra,createdAt:stamp()},r.brandId);
}
// performance_tested는 골든 on/off 비교를 첨부할 때만 부여한다. 그 경로는 B3-2에서 연결하므로 지금은 409로 막는다. 수동 규칙은 operator_preference만이다.
function manualGrade(value:unknown){
 if(value===undefined||value===null||value===''||value==='operator_preference')return;
 if(value==='performance_tested')throw new ApiError(409,'performance_tested 등급은 골든 on/off 비교를 첨부할 때만 부여합니다. 부여 경로는 B3-2에서 연결합니다.');
 throw new ApiError(400,'수동 규칙의 등급은 operator_preference만 쓸 수 있습니다.');
}
const campaignBrands=async(owner:string)=>new Map((await listRecords<Campaign>(owner,'campaign')).map(c=>[c.id,c.brandId]));
// 판정의 브랜드: 기록의 brandId, 없으면 캠페인의 브랜드(작업물·발행 판정). 원 캠페인이 삭제돼 알 수 없으면 null이다.
const decisionBrand=(d:Pick<ReviewDecision,'brandId'|'campaignId'>,brands:Map<string,string>)=>d.brandId??(d.campaignId?brands.get(d.campaignId)??null:null);
// 인용 선택용 사람 판정 요약(최근 200건, 브랜드를 확인할 수 있는 것만). 메모 원문은 판정 로그에 없고 행위자는 담지 않는다.
export async function reviewDecisionChoices(owner:string,limit=200):Promise<ReviewDecisionSummary[]>{
 const [rows,brands]=await Promise.all([database().prepare("SELECT data FROM records WHERE owner=? AND kind='review_decision' ORDER BY rowid DESC LIMIT ?").bind(owner,limit).all<{data:string}>(),campaignBrands(owner)]);
 return rows.results.map(r=>JSON.parse(r.data) as ReviewDecision).flatMap(d=>{const brandId=decisionBrand(d,brands);return brandId?[{id:d.id,brandId,targetKind:d.targetKind,role:d.role,decision:d.decision,reasonCodes:d.reasonCodes,...(d.origin?{origin:d.origin}:{}),campaignId:d.campaignId,createdAt:d.createdAt}]:[]});
}
// 인용: 서로 다른 판정 2~20건, 모두 같은 브랜드의 실제 기록. 편집 근거(preference) 규칙은 사람이 고친 AI 작업물 판정(ai_edited)만 인용한다.
async function citedDecisions(owner:string,brandId:string,value:unknown,origin:'review'|'preference'){
 if(!Array.isArray(value))throw new ApiError(400,`근거가 되는 사람 판정 기록을 ${PLAYBOOK_MIN_CITATIONS}건 이상 고르세요.`);
 const ids=[...new Set(value.map(x=>str(x,'인용 판정',100,true)))];
 if(ids.length<PLAYBOOK_MIN_CITATIONS||ids.length>PLAYBOOK_MAX_CITATIONS)throw new ApiError(400,`서로 다른 사람 판정 기록을 ${PLAYBOOK_MIN_CITATIONS}~${PLAYBOOK_MAX_CITATIONS}건 인용하세요.`);
 const brands=await campaignBrands(owner);
 for(const id of ids){
  const d=await readRecord<ReviewDecision>(owner,'review_decision',id).catch((e:unknown)=>{if(e instanceof ApiError&&e.status===404)throw new ApiError(400,'인용한 사람 판정 기록을 찾을 수 없습니다.');throw e});
  if(decisionBrand(d,brands)!==brandId)throw new ApiError(400,'같은 브랜드의 사람 판정 기록만 인용할 수 있습니다. 원 캠페인이 삭제돼 브랜드를 확인할 수 없는 기록도 인용할 수 없습니다.');
  if(origin==='preference'&&(d.targetKind!=='artifact'||d.origin!=='ai_edited'))throw new ApiError(400,'편집 근거(preference) 규칙은 사람이 고친 AI 작업물(ai_edited) 판정만 인용할 수 있습니다.');
 }
 return ids;
}
const optional=(v:unknown)=>v===undefined||v===null||v==='';
async function createPlaybookRule(owner:string,d:Record<string,unknown>,by:PlaybookActor){
 manualGrade(d.grade);
 const origin=optional(d.origin)?'review':d.origin;
 if(origin!=='review'&&origin!=='preference')throw new ApiError(400,'규칙 출처는 운영자 교정(review) 또는 편집 근거(preference)만 고를 수 있습니다.');
 const brandId=str(d.brandId,'대상 브랜드',100,true);await readRecord<Brand>(owner,'brand',brandId);
 const role=optional(d.role)?'':str(d.role,'역할',30);if(role&&!roles.some(r=>r.id===role))throw new ApiError(400,'역할을 확인해 주세요.');
 const channel=optional(d.channel)?ANY_CHANNEL:str(d.channel,'채널',30);if(channel!==ANY_CHANNEL&&!Object.hasOwn(channelRegistry,channel))throw new ApiError(400,'채널을 확인해 주세요.');
 const text=normalizeRuleBody(str(d.text,'규칙 본문',PLAYBOOK_MAX_CHARS*4,true)),problem=ruleBodyProblem(text);if(problem)throw new ApiError(400,problem);
 const citations=await citedDecisions(owner,brandId,d.citations,origin),at=stamp();
 const rule:LearningRule={origin,grade:'operator_preference',id:'playbook:'+uid(),brandId,channel,...(role?{role}:{}),experimentId:'',experimentVersion:0,caseId:'',title:ruleTitle(text),guidance:text,scope:`사람 판정 ${citations.length}건 인용`,citations,feedback:{helpful:0,harmful:0},status:'draft',version:1,expiresAt:playbookExpiry(),createdAt:at,updatedAt:at};
 await database().batch([recordStatement(owner,'learning_rule',rule.id,rule,brandId),auditStatement(owner,rule,'create','',by)]);
 return {id:rule.id,status:rule.status};
}
async function playbookRule(owner:string,b:Record<string,unknown>){
 const r=await readRecord<LearningRule>(owner,'learning_rule',str(b.id,'학습 규칙',200,true));
 if(!operatorRule(r))throw new ApiError(409,'운영자 선호 규칙이 아닙니다.');
 if(r.version!==b.version)throw new ApiError(409,'규칙 상태가 변경됐습니다. 새로고침 후 다시 시도하세요.');
 return r;
}
// 승인(초안·중지 → 적용 중): 역할당 활성 8개 상한을 넘으면 409. 승인 시점부터 60일 뒤 만료된다.
async function activatePlaybookRule(owner:string,b:Record<string,unknown>,by:PlaybookActor){
 const r=await playbookRule(owner,b);if(r.status!=='draft'&&r.status!=='paused')throw new ApiError(409,'초안이나 중지한 규칙만 승인할 수 있습니다.');
 const problem=activationProblem(r,await listRecords<LearningRule>(owner,'learning_rule'));if(problem)throw new ApiError(409,problem);
 const at=stamp(),next:LearningRule={...r,status:'active',expiresAt:playbookExpiry(),version:r.version+1,updatedAt:at};
 await database().batch([recordStatement(owner,'learning_rule',r.id,next,r.brandId),auditStatement(owner,next,'activate',r.status,by)]);
 return {id:r.id,status:next.status,expiresAt:next.expiresAt};
}
// 재확인(연장): 적용 중인 규칙만 지금부터 60일로 늘린다. 만료된 규칙을 되살리는 경우도 상한을 다시 본다.
async function renewPlaybookRule(owner:string,b:Record<string,unknown>,by:PlaybookActor){
 const r=await playbookRule(owner,b);if(r.status!=='active')throw new ApiError(409,'적용 중인 규칙만 연장할 수 있습니다.');
 const problem=activationProblem(r,await listRecords<LearningRule>(owner,'learning_rule'));if(problem)throw new ApiError(409,problem);
 const at=stamp(),next:LearningRule={...r,expiresAt:playbookExpiry(),renewedAt:at,version:r.version+1,updatedAt:at};
 await database().batch([recordStatement(owner,'learning_rule',r.id,next,r.brandId),auditStatement(owner,next,'renew',r.status,by)]);
 return {id:r.id,expiresAt:next.expiresAt};
}
// 중지할 규칙이 주입된 역할 작업물(learning_snapshot 기준). 운영자 선호를 주입한 스냅샷(artifactId 있음)만 읽고, 그중 실제로 저장된 작업물만 고른다. 작업물은 읽기만 한다.
async function injectedArtifacts(owner:string,ruleId:string):Promise<Omit<PlaybookRecheck,'createdAt'>[]>{
 const snapshots=(await database().prepare("SELECT data FROM records WHERE owner=? AND kind='learning_snapshot' AND json_extract(data,'$.artifactId') IS NOT NULL").bind(owner).all<{data:string}>()).results.map(r=>JSON.parse(r.data) as LearningSnapshot);
 const hits=snapshots.flatMap(s=>{const p=s.operatorPreferences?.find(x=>x.id===ruleId);return p&&s.artifactId?[{s,artifactId:s.artifactId,ruleVersion:p.version}]:[]});
 const found=await Promise.all(hits.map(async({s,artifactId,ruleVersion})=>{
  const a=await readRecord<Artifact>(owner,'artifact',artifactId).catch((e:unknown)=>{if(e instanceof ApiError&&e.status===404)return null;throw e});
  return a?[{id:`${ruleId}:${a.id}`,ruleId,ruleVersion,artifactId:a.id,artifactVersion:a.version,campaignId:s.campaignId,jobId:s.id,role:s.role,reason:'rule_paused' as const}]:[];
 }));
 return [...new Map(found.flat().map(m=>[m.artifactId,m])).values()];
}
// 재확인 표시: 캠페인마다 이력(event) 1건에 작업물 목록을 detail(playbookRecheck)로 싣는다. 캠페인 이력이라 캠페인과 함께 지워지고 캠페인 화면 이력에도 보인다.
type RecheckDetail={ruleId:string;reason:'rule_paused';artifacts:Pick<PlaybookRecheck,'artifactId'|'artifactVersion'|'ruleVersion'|'jobId'|'role'>[]};
function recheckStatement(owner:string,r:LearningRule,campaignId:string,marks:Omit<PlaybookRecheck,'createdAt'>[],by:PlaybookActor){
 const artifacts=marks.filter(m=>m.campaignId===campaignId).map(({artifactId,artifactVersion,ruleVersion,jobId,role})=>({artifactId,artifactVersion,ruleVersion,jobId,role})),playbookRecheck:RecheckDetail={ruleId:r.id,reason:'rule_paused',artifacts};
 return eventStatement(owner,campaignId,`운영자 선호 규칙 「${r.title}」 적용을 중지했습니다. 이 규칙이 전달된 작업물 ${artifacts.length}건을 재확인하세요. 작업물 내용은 바꾸지 않았습니다.`,by,{playbookRecheck});
}
// 학습 화면용 재확인 표시 목록(캠페인 이력의 playbookRecheck를 작업물 단위로 편다).
export async function playbookRechecks(owner:string):Promise<PlaybookRecheck[]>{
 const rows=await database().prepare("SELECT data FROM records WHERE owner=? AND kind='event' AND json_extract(data,'$.playbookRecheck.ruleId') IS NOT NULL").bind(owner).all<{data:string}>();
 return rows.results.map(r=>JSON.parse(r.data) as {campaignId:string;createdAt:string;playbookRecheck:RecheckDetail}).flatMap(e=>e.playbookRecheck.artifacts.map(a=>({...a,id:`${e.playbookRecheck.ruleId}:${a.artifactId}`,ruleId:e.playbookRecheck.ruleId,campaignId:e.campaignId,reason:e.playbookRecheck.reason,createdAt:e.createdAt})));
}
// 중지: 다음 작업부터 주입하지 않고, 이미 주입된 작업물에는 재확인 표시(캠페인 이력)만 남긴다. 작업물 내용·버전은 바꾸지 않는다.
async function pausePlaybookRule(owner:string,b:Record<string,unknown>,by:PlaybookActor){
 const r=await playbookRule(owner,b);if(r.status!=='active')throw new ApiError(409,'적용 중인 규칙만 중지할 수 있습니다.');
 const at=stamp(),next:LearningRule={...r,status:'paused',version:r.version+1,updatedAt:at},marks=await injectedArtifacts(owner,r.id),campaigns=[...new Set(marks.map(m=>m.campaignId))];
 await database().batch([recordStatement(owner,'learning_rule',r.id,next,r.brandId),...campaigns.map(id=>recheckStatement(owner,next,id,marks,by)),auditStatement(owner,next,'pause',r.status,by,{affectedArtifacts:marks.length})]);
 return {id:r.id,status:next.status,affected:marks.length};
}
const playbookActions:Record<string,(owner:string,b:Record<string,unknown>,by:PlaybookActor)=>Promise<unknown>>={
 playbook_create:(owner,b,by)=>createPlaybookRule(owner,(b.data&&typeof b.data==='object'&&!Array.isArray(b.data)?b.data:{}) as Record<string,unknown>,by),
 playbook_activate:activatePlaybookRule,playbook_pause:pausePlaybookRule,playbook_renew:renewPlaybookRule,
 playbook_grade:async(_owner,b)=>{manualGrade(b.grade);throw new ApiError(400,'운영자 선호 규칙의 등급은 바꿀 수 없습니다.')},
};
// 소유자 전용(서버 판정). 화면도 같은 규칙으로 버튼을 끈다(app/learning-panel.tsx).
async function playbookAction(owner:string,b:Record<string,unknown>,by?:PlaybookActor){
 const run=playbookActions[String(b.action)];if(!run)throw new ApiError(400,'지원하지 않는 학습 작업입니다.');
 if(!by||by.role!=='owner')throw new ApiError(403,'소유자만 변경할 수 있습니다.');
 return run(owner,b,by);
}
