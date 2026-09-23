import {ApiError,str,num,stamp,uid,readRecord,listRecords,recordStatement,database,eventStatement,type EventActor} from './server';
import {learningChannels,learningMetrics,evaluateExperiment,ruleApplies,defaultVerifyChannel,type ViralCase,type ViralAnalysis,type TestIdea,type ViralExperiment,type ExperimentResult,type LearningRule,type LearningSnapshot,type Arm,type StoreAssessment} from './learning';
import {channelHosts,storeChannelName} from './channels';
import {summarizeResult,planShortfall,decisionConflict} from './viral-stats';
import type {StoreExperiment,StoreMeasurement,StoreReview} from './store-marketing';
import type {Brand,Campaign} from './agency';
import type {SourceCampaignDeleted} from './record-kinds';
export const RULE_DAYS=30;
// 결정 7(b): 원 캠페인이 삭제된 바이럴 규칙은 종료 상태로만 남는다. 재검증·연장·상태 변경 대신 새 실험을 안내한다.
function assertSourceCampaign(r:LearningRule&{sourceCampaignDeleted?:SourceCampaignDeleted}){if(r.sourceCampaignDeleted)throw new ApiError(409,'원 캠페인이 삭제되어 이 규칙은 재검증·연장·상태 변경을 할 수 없습니다. 캠페인을 선택해 새 실험을 만들어 주세요.')}
const expiry=(from=Date.now())=>new Date(from+RULE_DAYS*86400000).toISOString();

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
export async function learningContext(owner:string,c:Pick<Campaign,'brandId'|'channels'|'storeId'>){
 const rules=await listRecords<LearningRule>(owner,'learning_rule');
 return rules.filter(r=>ruleApplies(r,c.brandId,c.channels,Date.now(),c.storeId))
  // 지점 전용 규칙이 더 구체적이므로 먼저 전달한다.
  .sort((a,b)=>Number(!!b.storeId)-Number(!!a.storeId)||b.createdAt.localeCompare(a.createdAt))
  .slice(0,12).map(modelRule);
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
export function learningSnapshotStatement(owner:string,id:string,c:Campaign,role:string,rules:LearningRule[],skillVersion?:string){
 const snap:LearningSnapshot & {skillVersion?:string}={skillVersion,id,campaignId:c.id,role,rules,createdAt:stamp()};return recordStatement(owner,'learning_snapshot',id,snap,c.id);
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
export async function learningAction(owner:string,b:any,by?:EventActor){
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
  const r=await readRecord<LearningRule>(owner,'learning_rule',str(b.id,'학습 규칙',200,true));assertSourceCampaign(r);if(r.version!==b.version||r.status!=='active')throw new ApiError(409,'규칙 상태가 변경됐습니다.');await recordStatement(owner,'learning_rule',r.id,{...r,status:'paused',version:r.version+1,updatedAt:stamp()},r.brandId).run();return {id:r.id};
 }
 if(['retire_rule','renew_rule','retest_rule'].includes(b.action)){
  const r=await readRecord<LearningRule>(owner,'learning_rule',str(b.id,'학습 규칙',200,true));
  assertSourceCampaign(r);
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
