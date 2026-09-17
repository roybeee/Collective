import {ApiError,str,num,stamp,uid,readRecord,listRecords,recordStatement,database,eventStatement} from './server';
import {learningChannels,learningMetrics,evaluateExperiment,ruleApplies,type ViralCase,type ViralAnalysis,type TestIdea,type ViralExperiment,type ExperimentResult,type LearningRule,type LearningSnapshot,type Arm} from './learning';
import type {Brand,Campaign} from './agency';

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
 const allowed:Record<string,string[]>= {Instagram:['instagram.com'],YouTube:['youtube.com'],TikTok:['tiktok.com'],Reddit:['reddit.com','redd.it']};
 if(!allowed[channel].some(h=>host===h||host.endsWith('.'+h)))throw new ApiError(400,'선택한 채널의 게시물 URL을 입력하세요.');
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
export async function learningContext(owner:string,c:Campaign){
 const rules=await listRecords<LearningRule>(owner,'learning_rule');return rules.filter(r=>ruleApplies(r,c.brandId,c.channels)).slice(0,12);
}
export async function saveLearningSnapshot(owner:string,id:string,c:Campaign,role:string,rules:LearningRule[]){
 const snap:LearningSnapshot={id,campaignId:c.id,role,rules,createdAt:stamp()};await recordStatement(owner,'learning_snapshot',id,snap,c.id).run();
}
function arm(raw:any,label:string,metric:string):Arm{
 if(!raw)throw new ApiError(400,`${label} 결과가 필요합니다.`);const denominator=nullableNumber(raw.denominator,`${label} 분모`),numerator=nullableNumber(raw.numerator,`${label} 반응 수`);
 if((denominator!==null&&!Number.isInteger(denominator))||(numerator!==null&&!Number.isInteger(numerator)))throw new ApiError(400,'횟수는 정수로 입력하세요.');
 if(metric==='completion_rate'&&denominator!==null&&numerator!==null&&numerator>denominator)throw new ApiError(400,'완주 수는 재생 시작 수를 초과할 수 없습니다.');
 return {denominator,numerator,source:str(raw.source,'수치 출처와 조회 조건',3000,true)};
}
export async function learningAction(owner:string,b:any){
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
  const now=stamp(),e:ViralExperiment={id:uid(),brandId:a.brandId,campaignId:campaign.id,caseId:c.id,analysisId:a.id,title:str(d.title,'실험 이름',200,true),channel:c.channel,hypothesis:str(d.hypothesis,'가설',6000,true),variable:str(d.variable,'바꿀 요소',3000,true),control:str(d.control,'대조안',6000,true),treatment:str(d.treatment,'실험안',6000,true),metric:d.metric,minSample,minHours,minLift,conditions:str(d.conditions,'동일하게 유지할 조건',6000,true),version:1,status:'draft',startedAt:null,createdAt:now,updatedAt:now,result:null,assessment:null};
  await database().batch([recordStatement(owner,'viral_experiment',e.id,e,campaign.id),eventStatement(owner,campaign.id,`바이럴 실험 「${e.title}」을 설계했습니다.`)]);return {id:e.id};
 }
 if(['start_experiment','save_results','adopt_rule'].includes(b.action)){
  const e=await readRecord<ViralExperiment>(owner,'viral_experiment',str(b.id,'실험',100,true));if(b.version!==e.version)throw new ApiError(409,'실험이 변경됐습니다. 새로고침 후 다시 시도하세요.');
  if(b.action==='start_experiment'){
   if(e.status!=='draft')throw new ApiError(409,'이미 시작된 실험입니다.');const updated={...e,status:'running',version:e.version+1,startedAt:stamp(),updatedAt:stamp()};await recordStatement(owner,'viral_experiment',e.id,updated,e.campaignId).run();return {id:e.id};
  }
  if(b.action==='save_results'){
   if(!e.startedAt)throw new ApiError(409,'실험 계획을 먼저 확정하세요.');const d=b.data||{},observedUntil=dated(d.observedUntil,'측정 종료 시점');if(observedUntil<e.startedAt)throw new ApiError(400,'측정 종료는 실험 시작 이후여야 합니다.');
   const result:ExperimentResult={control:arm(d.control,'대조안',e.metric),treatment:arm(d.treatment,'실험안',e.metric),comparable:d.comparable===true,notes:str(d.notes,'측정 조건·차이·한계',6000,true),observedUntil,recordedAt:stamp()};
   const updated={...e,result,assessment:evaluateExperiment(e,result),version:e.version+1,status:'evaluated',updatedAt:stamp()};
   const oldRules=(await listRecords<LearningRule>(owner,'learning_rule')).filter(r=>r.experimentId===e.id&&r.status!=='retired');
   await database().batch([recordStatement(owner,'experiment_revision',e.id+':'+e.version,e,e.id),recordStatement(owner,'viral_experiment',e.id,updated,e.campaignId),...oldRules.map(r=>recordStatement(owner,'learning_rule',r.id,{...r,status:'retired',version:r.version+1,updatedAt:stamp()},r.brandId)),eventStatement(owner,e.campaignId,`「${e.title}」 결과: ${updated.assessment.label}. 결과 정정 시 이전 학습 적용은 종료됩니다.`)]);return {id:e.id,assessment:updated.assessment};
  }
  if(!e.assessment||!['promising','not_supported'].includes(e.assessment.status))throw new ApiError(409,'최소 표본·기간·비교 조건과 판정 기준을 충족한 결과가 필요합니다.');
  const id=e.id+':'+e.version;const existing=(await listRecords<LearningRule>(owner,'learning_rule')).find(r=>r.id===id);if(existing)return {id:existing.id};
  const positive=e.assessment.status==='promising',rule:LearningRule={id,brandId:e.brandId,channel:e.channel,experimentId:e.id,experimentVersion:e.version,caseId:e.caseId,title:e.title,guidance:str(b.guidance,'다음 제작에 반영할 규칙',6000,true),scope:e.conditions,evidenceLevel:'observational',status:'active',version:1,expiresAt:new Date(Date.now()+30*86400000).toISOString(),createdAt:stamp(),updatedAt:stamp()};
  await database().batch([recordStatement(owner,'learning_rule',id,rule,e.brandId),eventStatement(owner,e.campaignId,`「${e.title}」을 ${positive?'시험 적용 규칙':'실패에서 배운 주의사항'}으로 채택했습니다. 30일 후 재검토합니다.`)]);return {id};
 }
 if(b.action==='pause_rule'){
  const r=await readRecord<LearningRule>(owner,'learning_rule',str(b.id,'학습 규칙',200,true));if(r.version!==b.version||r.status!=='active')throw new ApiError(409,'규칙 상태가 변경됐습니다.');await recordStatement(owner,'learning_rule',r.id,{...r,status:'paused',version:r.version+1,updatedAt:stamp()},r.brandId).run();return {id:r.id};
 }
 throw new ApiError(400,'지원하지 않는 학습 작업입니다.');
}
