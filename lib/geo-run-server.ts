// G5 GEO 자동 추적 서버. 스위치 geo_tracking(기본 꺼짐)이 켜진 소유자만 쓴다. 꺼져 있으면 조회·저장·측정 모두 409다.
// 질문(geo_question)·측정(geo_run)·관찰(geo_observation)·사이트 점검(geo_settings)은 브랜드를 부모로 둔다. 측정 비용(토큰 예산)은 화면을 연 캠페인으로 센다.
// 측정 한 번 = 켜 둔 질문 × 고른 엔진마다 HERMES 실행 1회(lib/geo-observation.ts 지시). 제출 원문은 hermes_submission 'geo-<작업 id>'(부모 없음)이고
// lib/hermes.ts submitHermes가 요청 전에 토큰을 예약한다. 시작 전에 계획 전체 추정 토큰을 assertTokenBudget으로 확인하고, 제출마다 그 작업 추정을 다시 확인한다(상한을 넘으면 409, 보내지 않음).
// 낮은 빈도: 한 번에 진행 중 실행은 최대 GEO_MAX_IN_FLIGHT개, 한 번 진행(advance)에 제출 GEO_SUBMIT_PER_ADVANCE개·조회 GEO_POLL_PER_ADVANCE개까지다. 화면(조회 버튼·자동 갱신)과 예약 실행 큐가 진행을 부른다.
// 자율성: 직접 측정은 research_run이 금지면 403, 예약 측정은 research_run이 자동일 때만 돈다. 전역 중단 중이면 시작은 409, 진행 중 측정의 남은 제출은 취소한다(이미 보낸 실행 결과는 읽는다).
// 응답 검사 실패는 그 작업만 실패로 남기고 관찰을 만들지 않는다(부분 합성 없음). login_required·unavailable은 그 상태 그대로 관찰로 남긴다.
import {ApiError,acquireLock,releaseLock,connection,database,listRecords,readRecord,recordStatement,stamp,type Actor,type Connection} from './server';
import type {Brand,Campaign} from './agency';
import type {Schedule} from './scheduled-runs';
import {submitHermes,pollHermes,hermesSubmissionStatement} from './hermes';
import {assertTokenBudget,estimateInputTokens,TokenBudgetExceeded} from './token-budget';
import {OUTPUT_ALLOWANCE} from './token-estimate';
import {isEnabled} from './feature-flags';
import {assertAutonomy,evaluateAutonomyFor} from './autonomy-server';
import {readGrowthStop} from './growth-stop-server';
import {markUsageOutcomeSafely} from './usage-outcome';
import {effectiveBrandFacts,type BrandFact} from './brand-facts';
import {factLabel} from './fact-catalog';
import {assertNotArchived} from './campaign-archive';
import type {UsageContext} from './usage-ledger';
import {GEO_QUESTION_ID,GEO_QUESTION_LIMIT,GeoInputError,measurementPairs,normalizeQuestion,parseGeoQuestionInput,pendingStarters,type GeoEngine,type GeoQuestion} from './geo-questions';
import {GeoResponseError,geoSubmission,geoTarget,parseGeoResponse,type GeoObservation,type GeoTarget} from './geo-observation';
import {GEO_SITE_STATES,geoReport,llmsTxtTemplate,type GeoSiteChecks,type GeoSiteState} from './geo-report';

const kinds={question:'geo_question',run:'geo_run',observation:'geo_observation',site:'geo_settings'} as const;
export const GEO_MAX_IN_FLIGHT=3,GEO_SUBMIT_PER_ADVANCE=2,GEO_POLL_PER_ADVANCE=3,GEO_MAX_JOBS=50,GEO_HTTP_TIMEOUT_MS=15000,GEO_OBSERVATION_LIMIT=500,GEO_RECENT_RUNS=20;
// 작업당 추정 토큰 하한: 제출 본문 추정은 브라우저 화면 읽기·도구 호출을 빼므로 실제보다 크게 작다. 기록이 없을 때도 막는 쪽으로 보수적으로 잡는다(종료 뒤 실제 사용량이 대신한다).
export const GEO_JOB_MIN_TOKENS=15000;
export const GEO_RUN_ID=/^geo-run-[a-z0-9]{8,32}$/;
export const GEO_USAGE_ROLE='geo_observation';
export const GEO_MESSAGES={
 off:'AI 검색 노출 자동 추적 스위치가 꺼져 있습니다. 소유자가 기능 스위치에서 켜야 쓸 수 있습니다.',
 hermes:'AI 검색 노출 측정은 HERMES 연결로만 실행합니다. 연결 및 설정에서 HERMES를 선택해 주세요.',
 busy:'이 브랜드에 진행 중인 측정이 있습니다. 끝나거나 중지한 뒤 다시 측정하세요.',
 empty:'측정할 질문이 없습니다. 질문을 켜고 엔진을 하나 이상 고르세요.',
 tooMany:`한 번에 측정할 수 있는 질문×엔진은 최대 ${GEO_MAX_JOBS}개입니다. 질문이나 엔진을 줄이세요.`,
 stopped:'전역 중단 중이라 남은 측정을 보내지 않았습니다.',
 uncertain:'접수 여부를 확인하지 못했습니다. 다음 진행에서 같은 요청 번호로 다시 확인합니다.',
 missing:'측정 기록을 찾지 못했습니다.',
 scheduleAuto:'예약 측정은 자율성 규칙에서 브랜드 조사 실행이 자동일 때만 돕니다. 화면의 지금 측정으로 확인한 뒤 실행하세요.',
} as const;

export type GeoJobStatus='pending'|'queued'|'uncertain'|'completed'|'failed'|'cancelled';
export type GeoJob={id:string;questionId:string;questionText:string;locale:string;engine:GeoEngine;status:GeoJobStatus;providerId?:string;observationId?:string;error?:string;submittedAt?:string};
export type GeoRun={id:string;brandId:string;campaignId:string;trigger:'manual'|'schedule';scheduleRunId:string|null;status:'running'|'completed'|'cancelled';target:GeoTarget;estimate:{jobs:number;perJobTokens:number;totalTokens:number;basis:'history'|'input'};jobs:GeoJob[];createdAt:string;updatedAt:string;by:{id:string;role:string}|null;model:string};
type GeoSettings=GeoSiteChecks&{id:string;brandId:string;version:number;updatedAt:string;updatedBy:string};

const submissionId=(jobId:string)=>'geo-'+jobId;
const usage=(r:GeoRun,j:GeoJob):UsageContext=>({kind:'role',role:GEO_USAGE_ROLE,submissionId:submissionId(j.id),jobId:j.id,campaignId:r.campaignId,brandId:r.brandId});
const terminal=(s:GeoJobStatus)=>s==='completed'||s==='failed'||s==='cancelled';
const saveRun=(owner:string,r:GeoRun)=>recordStatement(owner,kinds.run,r.id,r,r.brandId);
const admin=(who:Pick<Actor,'role'>)=>who.role==='owner'||who.role==='admin';

export async function geoEnabled(owner:string){try{return await isEnabled(owner,'geo_tracking')}catch{return false}}
async function requireSwitch(owner:string){if(!await geoEnabled(owner))throw new ApiError(409,GEO_MESSAGES.off)}
const input=<T>(task:()=>T):T=>{try{return task()}catch(e){if(e instanceof GeoInputError)throw new ApiError(400,e.message);throw e}};

async function optional<T>(owner:string,kind:string,id:string):Promise<T|null>{try{return await readRecord<T>(owner,kind,id)}catch(e){if(e instanceof ApiError&&e.status===404)return null;throw e}}
async function brandContext(owner:string,brandId:string){
 // 사실은 brand_fact를 직접 읽는다(lib/brand-facts-server.ts는 가맹 벤치마크 모듈에 닿아 모델 경로 경계 검사에 걸린다. lib/nurture-draft.ts와 같은 방식).
 const [brand,facts]=await Promise.all([readRecord<Brand>(owner,'brand',brandId),listRecords<BrandFact>(owner,'brand_fact',brandId)]);
 const confirmed=effectiveBrandFacts(facts,brandId);
 return {brand,confirmed,target:geoTarget(brand,confirmed.map(f=>f.value))};
}
const questionsOf=async(owner:string,brandId:string)=>(await listRecords<GeoQuestion>(owner,kinds.question,brandId)).sort((a,b)=>a.createdAt.localeCompare(b.createdAt)||a.id.localeCompare(b.id));
const runsOf=async(owner:string,brandId:string)=>(await listRecords<GeoRun>(owner,kinds.run,brandId)).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
async function observationsOf(owner:string,brandId:string){
 const rows=await database().prepare("SELECT data FROM records WHERE owner=? AND kind='geo_observation' AND parent_id=? ORDER BY json_extract(data,'$.observedAt') DESC LIMIT ?").bind(owner,brandId,GEO_OBSERVATION_LIMIT).all<{data:string}>();
 return rows.results.map(r=>JSON.parse(r.data) as GeoObservation);
}
const siteOf=async(owner:string,brandId:string):Promise<GeoSettings|null>=>optional<GeoSettings>(owner,kinds.site,brandId);

// 작업당 추정 토큰: 제출 본문 추정 + 출력 여유, 최근 GEO 실행의 실제 평균, 하한 중 큰 값.
async function recentGeoTokens(owner:string){
 const row=await database().prepare("SELECT AVG(t) AS n,COUNT(t) AS c FROM (SELECT COALESCE(json_extract(data,'$.totalTokens'),json_extract(data,'$.inputTokens')+json_extract(data,'$.outputTokens')) AS t FROM records WHERE owner=? AND kind='provider_usage' AND json_extract(data,'$.role')=? AND t IS NOT NULL ORDER BY json_extract(data,'$.observedAt') DESC LIMIT ?)").bind(owner,GEO_USAGE_ROLE,GEO_RECENT_RUNS).first<{n:number|null;c:number}>();
 return {average:Math.ceil(Number(row?.n)||0),samples:Number(row?.c)||0};
}
export function geoJobEstimate(target:GeoTarget,pairs:readonly {question:Pick<GeoQuestion,'text'>;engine:GeoEngine}[],history:{average:number;samples:number}){
 const longest=pairs.reduce((n,p)=>{const s=geoSubmission(target,p.question.text,p.engine);return Math.max(n,estimateInputTokens(JSON.stringify({input:s.input,instructions:s.instructions})))},0);
 const fromInput=Math.max(longest+OUTPUT_ALLOWANCE,GEO_JOB_MIN_TOKENS),perJobTokens=Math.max(fromInput,history.average);
 return {jobs:pairs.length,perJobTokens,totalTokens:perJobTokens*pairs.length,basis:history.average>fromInput?'history' as const:'input' as const,samples:history.samples};
}

export async function geoView(who:Actor,c:Campaign){
 await requireSwitch(who.owner);
 const [{brand,confirmed,target},questions,runs,observations,site,history]=await Promise.all([brandContext(who.owner,c.brandId),questionsOf(who.owner,c.brandId),runsOf(who.owner,c.brandId),observationsOf(who.owner,c.brandId),siteOf(who.owner,c.brandId),recentGeoTokens(who.owner)]);
 const checks:GeoSiteChecks={jsonLd:site?.jsonLd??'unknown',llmsTxt:site?.llmsTxt??'unknown'},pairs=measurementPairs(questions);
 const starters=pendingStarters({brandName:brand.name,category:brand.category,facts:confirmed.map(f=>({id:f.id,key:f.key,value:f.value}))},questions);
 return {campaignId:c.id,brandId:c.brandId,brandName:brand.name,questions,starters,runs:runs.slice(0,5),active:runs.find(r=>r.status==='running')??null,observations:observations.slice(0,200),
  report:geoReport({questions,observations,site:checks}),site:{...checks,version:site?.version??0},plan:{questions:new Set(pairs.map(p=>p.question.id)).size,engines:new Set(pairs.map(p=>p.engine)).size,...geoJobEstimate(target,pairs,history)},
  target:{officialUrls:target.officialUrls,competitors:target.competitors},llmsTxt:llmsTxtTemplate({brandName:brand.name,summary:brand.description??'',officialUrls:target.officialUrls,facts:confirmed.filter(f=>!/^https?:/.test(f.value.trim())).slice(0,12).map(f=>({label:factLabel(f.key),value:f.value}))}),
  canEdit:admin(who)&&c.status!=='archived',limit:GEO_QUESTION_LIMIT,maxJobs:GEO_MAX_JOBS};
}
export type GeoView=Awaited<ReturnType<typeof geoView>>;

// 질문 저장: id가 없으면 새로 만든다. 같은 문장(정규화 기준) 중복은 409, 판이 다르면 409.
export async function saveGeoQuestion(who:Actor,c:Campaign,b:Record<string,unknown>){
 await requireSwitch(who.owner);assertNotArchived(c);
 const parsed=input(()=>parseGeoQuestionInput(b.input)),all=await questionsOf(who.owner,c.brandId);
 const id=typeof b.id==='string'&&b.id?b.id:'gq-'+crypto.randomUUID().slice(0,12);
 if(!GEO_QUESTION_ID.test(id))throw new ApiError(400,'질문 번호 형식이 올바르지 않습니다.');
 const old=all.find(q=>q.id===id)??null;
 if((old?.version??0)!==b.expectedVersion)throw new ApiError(409,'질문이 다른 곳에서 바뀌었습니다. 새로고침한 뒤 다시 저장하세요.');
 if(all.some(q=>q.id!==id&&normalizeQuestion(q.text)===normalizeQuestion(parsed.text)))throw new ApiError(409,'같은 질문이 이미 있습니다.');
 if(!old&&all.length>=GEO_QUESTION_LIMIT)throw new ApiError(409,`질문은 브랜드마다 최대 ${GEO_QUESTION_LIMIT}개입니다.`);
 const at=stamp(),textChanged=!!old&&normalizeQuestion(old.text)!==normalizeQuestion(parsed.text);
 const row:GeoQuestion={...parsed,id,brandId:c.brandId,version:(old?.version??0)+1,origin:old&&!textChanged?old.origin:'manual',basis:old&&!textChanged?old.basis:[],createdAt:old?.createdAt??at,updatedAt:at,updatedBy:who.id};
 await recordStatement(who.owner,kinds.question,id,row,c.brandId).run();
 return row;
}
// 시작 질문 저장: 요청한 문장이 지금 확정 사실로 만든 추천 목록에 있을 때만 받는다. 엔진은 고른 값, 없으면 전체.
export async function addGeoStarters(who:Actor,c:Campaign,b:Record<string,unknown>){
 await requireSwitch(who.owner);assertNotArchived(c);
 if(!Array.isArray(b.texts)||!b.texts.length||b.texts.length>GEO_QUESTION_LIMIT||b.texts.some(t=>typeof t!=='string'))throw new ApiError(400,'저장할 추천 질문을 고르세요.');
 const [{brand,confirmed},all]=await Promise.all([brandContext(who.owner,c.brandId),questionsOf(who.owner,c.brandId)]);
 const starters=pendingStarters({brandName:brand.name,category:brand.category,facts:confirmed.map(f=>({id:f.id,key:f.key,value:f.value}))},all);
 const wanted=new Set((b.texts as string[]).map(normalizeQuestion)),picked=starters.filter(s=>wanted.has(normalizeQuestion(s.text)));
 if(picked.length!==wanted.size)throw new ApiError(409,'추천 목록에 없는 질문이 있습니다. 새로고침한 뒤 다시 고르세요.');
 if(all.length+picked.length>GEO_QUESTION_LIMIT)throw new ApiError(409,`질문은 브랜드마다 최대 ${GEO_QUESTION_LIMIT}개입니다.`);
 const engines=input(()=>parseGeoQuestionInput({text:'엔진 확인',locale:'ko',intent:'brand',engines:b.engines??['chatgpt','perplexity','gemini','google_ai_overview','naver'],active:true}).engines);
 const at=stamp(),rows:GeoQuestion[]=picked.map(s=>({text:s.text,locale:'ko',intent:s.intent,engines,active:true,id:'gq-'+crypto.randomUUID().slice(0,12),brandId:c.brandId,version:1,origin:'starter',basis:s.basis,createdAt:at,updatedAt:at,updatedBy:who.id}));
 await database().batch(rows.map(r=>recordStatement(who.owner,kinds.question,r.id,r,c.brandId)));
 return {added:rows};
}
export async function saveGeoSite(who:Actor,c:Campaign,b:Record<string,unknown>){
 await requireSwitch(who.owner);assertNotArchived(c);
 const state=(v:unknown,label:string):GeoSiteState=>GEO_SITE_STATES.includes(v as GeoSiteState)?v as GeoSiteState:(()=>{throw new ApiError(400,`${label} 상태는 있음·없음·미확인 중 하나입니다.`)})();
 const old=await siteOf(who.owner,c.brandId);
 if((old?.version??0)!==b.expectedVersion)throw new ApiError(409,'사이트 점검이 다른 곳에서 바뀌었습니다. 새로고침한 뒤 다시 저장하세요.');
 const row:GeoSettings={id:c.brandId,brandId:c.brandId,jsonLd:state(b.jsonLd,'JSON-LD'),llmsTxt:state(b.llmsTxt,'llms.txt'),version:(old?.version??0)+1,updatedAt:stamp(),updatedBy:who.id};
 await recordStatement(who.owner,kinds.site,c.brandId,row,c.brandId).run();
 return row;
}

// 측정 시작. 같은 번호가 있으면 그대로 돌려준다(멱등). 브랜드마다 진행 중 측정은 하나. 계획 전체 추정이 예산 안이어야 기록을 만든다.
async function createRun(owner:string,c:Campaign,id:string,trigger:GeoRun['trigger'],by:GeoRun['by'],scheduleRunId:string|null){
 if(!GEO_RUN_ID.test(id))throw new ApiError(400,'측정 번호 형식이 올바르지 않습니다.');
 const existing=await optional<GeoRun>(owner,kinds.run,id);
 if(existing){if(existing.brandId!==c.brandId)throw new ApiError(404,GEO_MESSAGES.missing);return {run:existing,created:false}}
 const runs=await runsOf(owner,c.brandId);
 if(runs.some(r=>r.status==='running'))throw new ApiError(409,GEO_MESSAGES.busy);
 if((await readGrowthStop(owner)).status!=='running')throw new ApiError(409,'전역 중단 중입니다. 소유자가 재개한 뒤 측정할 수 있습니다.');
 const cfg=await connection(owner);
 if(cfg.provider!=='hermes')throw new ApiError(409,GEO_MESSAGES.hermes);
 const [{target},questions,history]=await Promise.all([brandContext(owner,c.brandId),questionsOf(owner,c.brandId),recentGeoTokens(owner)]);
 const pairs=measurementPairs(questions);
 if(!pairs.length)throw new ApiError(409,GEO_MESSAGES.empty);
 if(pairs.length>GEO_MAX_JOBS)throw new ApiError(409,GEO_MESSAGES.tooMany);
 if(!target.brandName)throw new ApiError(409,'브랜드 이름이 비어 있어 언급 여부를 판정할 수 없습니다.');
 const e=geoJobEstimate(target,pairs,history),estimate={jobs:e.jobs,perJobTokens:e.perJobTokens,totalTokens:e.totalTokens,basis:e.basis};
 await assertTokenBudget(database(),owner,c.id,estimate.totalTokens);
 const at=stamp(),run:GeoRun={id,brandId:c.brandId,campaignId:c.id,trigger,scheduleRunId,status:'running',target,estimate,jobs:pairs.map((p,i)=>({id:`${id}-${i+1}`,questionId:p.question.id,questionText:p.question.text,locale:p.question.locale,engine:p.engine,status:'pending'})),createdAt:at,updatedAt:at,by,model:cfg.model};
 await saveRun(owner,run).run();
 return {run,created:true};
}
export async function startGeoRun(who:Actor,c:Campaign,b:Record<string,unknown>){
 await requireSwitch(who.owner);assertNotArchived(c);
 await assertAutonomy(who.owner,'research_run');
 const {run,created}=await createRun(who.owner,c,String(b.id??''),'manual',{id:who.id,role:who.role},null);
 return created?advanceGeoRun(who.owner,run.id):run;
}

// 한 작업의 HERMES 결과를 읽어 관찰로 바꾼다. 검사 실패는 작업 실패(관찰 없음)다.
async function settleJob(owner:string,run:GeoRun,job:GeoJob,cfg:Connection,stop:boolean):Promise<GeoJob>{
 const polled=await pollHermes(cfg,job.providerId!,stop,GEO_HTTP_TIMEOUT_MS,owner,usage(run,job));
 if(polled.status==='in_progress')return job;
 if(polled.status==='cancelled'){await markUsageOutcomeSafely(owner,'hermes',job.providerId!,'cancelled');return {...job,status:'cancelled'}}
 if(polled.status!=='completed'){await markUsageOutcomeSafely(owner,'hermes',job.providerId!,polled.invalidOutput?'invalid_output':'provider_failed');return {...job,status:'failed',error:polled.failureReason??'HERMES가 측정을 끝내지 못했습니다.'}}
 let parsed;
 try{parsed=parseGeoResponse(polled.output[0]?.content[0]?.text,{engine:job.engine,question:job.questionText,target:run.target,notBefore:Date.parse(job.submittedAt??run.createdAt),now:Date.now()})}
 catch(e){if(!(e instanceof GeoResponseError))throw e;await markUsageOutcomeSafely(owner,'hermes',job.providerId!,'invalid_output');return {...job,status:'failed',error:'HERMES 응답 형식 오류: '+e.message}}
 const obs:GeoObservation={...parsed,id:job.id,brandId:run.brandId,questionId:job.questionId,questionText:job.questionText,locale:job.locale,engine:job.engine,source:'hermes',runId:run.id,jobId:job.id,providerRunId:job.providerId!,recordedAt:stamp()};
 await recordStatement(owner,kinds.observation,obs.id,obs,run.brandId).run();
 await markUsageOutcomeSafely(owner,'hermes',job.providerId!,'completed');
 return {...job,status:'completed',observationId:obs.id};
}
// 제출. 확정 거절(예산 409 등 4xx, 429 제외)은 실패, 연결 오류·5xx·429는 확인 불가로 남겨 같은 키로 다시 보낸다(HERMES 영구 중복 방지).
async function submitJob(owner:string,run:GeoRun,job:GeoJob,cfg:Connection):Promise<GeoJob>{
 try{
  if(job.status==='pending'){
   await assertTokenBudget(database(),owner,run.campaignId,run.estimate.perJobTokens);
   await hermesSubmissionStatement(owner,submissionId(job.id),geoSubmission(run.target,job.questionText,job.engine)).run();
  }
  const r=await submitHermes(owner,submissionId(job.id),cfg,undefined,GEO_HTTP_TIMEOUT_MS);
  return {...job,status:'queued',providerId:r.id,error:undefined,submittedAt:job.submittedAt??stamp()};
 }catch(e){
  if(e instanceof TokenBudgetExceeded||e instanceof ApiError&&e.status<500&&e.status!==429)return {...job,status:'failed',error:(e as Error).message};
  return {...job,status:'uncertain',error:GEO_MESSAGES.uncertain,submittedAt:job.submittedAt??stamp()};
 }
}
const finish=(run:GeoRun,jobs:GeoJob[]):GeoRun=>{const done=jobs.every(j=>terminal(j.status));return {...run,jobs,status:done?(jobs.some(j=>j.status==='completed')||!jobs.every(j=>j.status==='cancelled')?'completed':'cancelled'):run.status,updatedAt:stamp()}};
const replace=(jobs:readonly GeoJob[],next:GeoJob)=>jobs.map(j=>j.id===next.id?next:j);

// 진행: 진행 중 결과 조회 → 확인 불가 재전송 → 대기 작업 제출(진행 중 상한 안). 다른 진행이 잠금을 잡고 있으면 읽기만 한다.
export async function advanceGeoRun(owner:string,runId:string,mode:'advance'|'cancel'='advance'):Promise<GeoRun>{
 if(!GEO_RUN_ID.test(runId))throw new ApiError(400,'측정 번호 형식이 올바르지 않습니다.');
 const key=owner+':geo-run';let token:string;
 try{token=await acquireLock(key)}catch(e){if(e instanceof ApiError&&e.status===409)return readRecord<GeoRun>(owner,kinds.run,runId);throw e}
 try{
  let run=await readRecord<GeoRun>(owner,kinds.run,runId).catch((e:unknown)=>{if(e instanceof ApiError&&e.status===404)throw new ApiError(404,GEO_MESSAGES.missing);throw e});
  if(run.status!=='running')return run;
  const cfg=await connection(owner);
  if(cfg.provider!=='hermes')throw new ApiError(409,GEO_MESSAGES.hermes);
  let stopped=mode==='cancel';
  if(!stopped){try{stopped=(await readGrowthStop(owner)).status!=='running'}catch{stopped=true}}
  let jobs=run.jobs;
  if(stopped)jobs=jobs.map(j=>j.status==='pending'?{...j,status:'cancelled' as const,error:mode==='cancel'?'사람이 측정을 중지했습니다.':GEO_MESSAGES.stopped}:j);
  for(const job of jobs.filter(j=>j.status==='queued').slice(0,mode==='cancel'?GEO_MAX_IN_FLIGHT:GEO_POLL_PER_ADVANCE))jobs=replace(jobs,await settleJob(owner,run,job,cfg,mode==='cancel'));
  if(mode==='cancel')jobs=jobs.map(j=>j.status==='uncertain'?{...j,status:'cancelled' as const,error:'사람이 측정을 중지했습니다. 접수 여부는 확인하지 못했습니다.'}:j.status==='queued'?{...j,status:'cancelled' as const,error:'중지 요청을 보냈습니다. 이 작업의 결과는 기록하지 않습니다.'}:j);
  let submitted=0;
  for(const job of jobs.filter(j=>j.status==='uncertain'||(!stopped&&j.status==='pending'))){
   if(submitted>=GEO_SUBMIT_PER_ADVANCE||jobs.filter(j=>j.status==='queued').length>=GEO_MAX_IN_FLIGHT)break;
   const next=await submitJob(owner,run,job,cfg);submitted++;jobs=replace(jobs,next);
   if(next.status==='failed'&&/토큰 예산/.test(next.error??''))jobs=jobs.map(j=>j.status==='pending'?{...j,status:'failed' as const,error:next.error}:j);
  }
  run=finish(run,jobs);
  await saveRun(owner,run).run();
  return run;
 }finally{await releaseLock(key,token)}
}
// 화면이 연 캠페인의 브랜드 측정만 진행·중지한다(다른 브랜드 번호는 404).
async function ownRun(owner:string,runId:string,brandId:string){
 await requireSwitch(owner);
 if(!GEO_RUN_ID.test(runId))throw new ApiError(400,'측정 번호 형식이 올바르지 않습니다.');
 const r=await optional<GeoRun>(owner,kinds.run,runId);
 if(!r||r.brandId!==brandId)throw new ApiError(404,GEO_MESSAGES.missing);
}
export async function cancelGeoRun(owner:string,runId:string,brandId:string){await ownRun(owner,runId,brandId);return advanceGeoRun(owner,runId,'cancel')}
export async function pollGeoRun(owner:string,runId:string,brandId:string){await ownRun(owner,runId,brandId);return advanceGeoRun(owner,runId)}

// 예약 실행(lib/scheduled-runs-server.ts). 건너뛸 이유가 있으면 문장을, 없으면 null.
export async function geoScheduleSkip(owner:string):Promise<string|null>{
 if(!await geoEnabled(owner))return GEO_MESSAGES.off;
 const d=await evaluateAutonomyFor(owner,'research_run');
 return d.mode==='auto'?null:d.mode==='never'?d.reason:GEO_MESSAGES.scheduleAuto;
}
export async function startScheduledGeo(owner:string,s:Pick<Schedule,'brandId'|'campaignId'>,scheduleRunId:string){
 const c=await readRecord<Campaign>(owner,'campaign',s.campaignId);
 if(c.brandId!==s.brandId)throw new ApiError(400,'캠페인이 그 브랜드에 속하지 않습니다.');
 assertNotArchived(c);
 const id='geo-run-'+scheduleRunId.replace(/[^a-z0-9]/gi,'').toLowerCase().slice(-32).padStart(8,'0');
 const {run,created}=await createRun(owner,c,id,'schedule',null,scheduleRunId);
 return created?(await advanceGeoRun(owner,run.id)).id:run.id;
}
// 예약 실행 큐가 tick마다 부른다. 진행 중 측정만 앞으로 민다. 실패해도 큐를 막지 않는다.
export async function advanceGeoRunsSafely(owner:string):Promise<number>{
 try{
  if(!await geoEnabled(owner))return 0;
  const active=(await listRecords<GeoRun>(owner,kinds.run)).filter(r=>r.status==='running').slice(0,2);
  for(const r of active)await advanceGeoRun(owner,r.id);
  return active.length;
 }catch{console.error('geo_run_advance_failed');return 0}
}
