import {markUsageOutcomeSafely as markUsageOutcome} from './usage-outcome';
import {storeContext} from './store-context';
import {storeResearchInstructions,type Store} from './store-marketing';
import {parseStoreReport} from './store-server';
import {ApiError,str,json,failure,database,readRecord,listRecords,recordStatement,connection,acquireLock,releaseLock,stamp} from '@/lib/server';
import type {Brand} from '@/lib/agency';
import {archiveCategories,researchActive,publicResearch,type BrandResearch,type ArchiveSource,type ChannelObservation,type Diagnostic} from '@/lib/archive';
import {archiveState,stateWrite,assertArchiveIdle} from '@/lib/archive-server';
import {archiveResearchInstructions,researchObject,parseResearchSources,parseDiagnostic} from '@/lib/archive-research';
import {DEEP_RESEARCH_VERSION,defaultResearchPlan} from '@/lib/deep-research';
import {deepInstructions,parseDeepReport} from '@/lib/deep-research-server';
import {hermesSubmissionStatement,submitHermes,pollHermes} from '@/lib/hermes';
import type {UsageContext} from '@/lib/usage-ledger';
import {workerStatus} from './research-worker';
import {researchSteps,unverifiedResearchAccess} from './research-queue';
const jobId=(owner:string,id:string)=>owner+':brand-research:'+id;
// 사용량 조인 키(F2a). 조사는 캠페인에 속하지 않는다. 역할 자리에는 조사 단계, 산출물 계약에는 조사 프로토콜을 쓴다.
const researchUsage=(owner:string,r:BrandResearch,step:BrandResearch['steps'][number]):UsageContext=>({kind:'research',submissionId:step.id,jobId:jobId(owner,r.id),brandId:r.brandId,storeId:r.storeId??null,role:step.stage,outputContractVersion:r.protocol??null});
function writes(owner:string,r:BrandResearch){return [recordStatement(owner,'brand_research',r.id,r,r.brandId),database().prepare('UPDATE jobs SET status=?,error=?,tokens=?,updated_at=? WHERE owner=? AND id=?').bind(r.status==='running'?'in_progress':r.status,r.error||null,r.tokens,r.updatedAt,owner,jobId(owner,r.id))]}
export async function executeResearch(owner:string,b:Record<string,any>,submissionTimeoutMs=90000){let lock='',lockOwner='',prepared:BrandResearch|undefined,current:BrandResearch|undefined,recovering=false;try{
 const id=str(b.id,'조사 번호',70,true);if(!/^[a-zA-Z0-9_-]+$/.test(id))throw new ApiError(400,'조사 번호를 확인하세요.');lockOwner=b.action==='start'?owner:owner+':research:'+id;lock=await acquireLock(lockOwner);
 let r:BrandResearch;
 if(b.action==='start'){
  const existing=(await listRecords<BrandResearch>(owner,'brand_research')).find(r=>r.id===id);if(existing){if(existing.brandId!==b.brandId||existing.storeId!==(b.storeId||undefined))throw new ApiError(409,'다른 브랜드의 조사 번호입니다.');return json(publicResearch(existing))}
  const brandId=str(b.brandId,'브랜드',100,true),brand=await readRecord<Brand>(owner,'brand',brandId);await assertArchiveIdle(owner,brandId);const cfg=await connection(owner);if(cfg.provider!=='hermes')throw new ApiError(409,'브랜드 심층 조사는 HERMES 연결이 필요합니다.');
  const store=b.storeId?await readRecord<Store>(owner,'store',str(b.storeId,'지점',100,true)):undefined;if(store&&(store.brandId!==brandId||store.status!=='active'))throw new ApiError(400,'조사할 지점의 브랜드·상태를 확인하세요.');const localContext=store?await storeContext(owner,brandId,store.id):undefined;
  const mode=store?'deep':b.mode==='classify'?'classify':'deep';const sources=(await listRecords<ArchiveSource>(owner,'brand_source',brandId)).filter(s=>s.status!=='excluded'&&(!s.storeId||s.storeId===store?.id));if(mode==='classify'&&!sources.some(s=>s.content.trim()))throw new ApiError(400,'분석할 텍스트 자료를 먼저 추가하세요.');
  const previous=b.previousResearchId?await readRecord<BrandResearch>(owner,'brand_research',str(b.previousResearchId,'이전 조사',70,true)):undefined;if(previous&&(previous.brandId!==brandId||previous.storeId!==store?.id||researchActive(previous)))throw new ApiError(409,'종료된 같은 브랜드의 조사만 보완할 수 있습니다.');
  const serverMode=(await workerStatus(owner)).activated;
  r={...(store?{storeId:store.id}:{}),execution:serverMode?'server':'interactive',...(mode==='deep'?{protocol:DEEP_RESEARCH_VERSION,plan:defaultResearchPlan(brand),access:unverifiedResearchAccess()}:{}),...(previous?{previousResearchId:previous.id}:{}),id,brandId,mode,status:'running',steps:store?(['identity','customer','channel','store_diagnosis'] as const).map(stage=>({id:id+'-'+stage,stage,status:'pending'})):mode==='deep'?researchSteps(id,serverMode):[...Array.from({length:Math.ceil(sources.length/30)},(_,i)=>({id:id+'-step-'+i,stage:'identity' as const,status:'pending' as const,sourceIds:sources.slice(i*30,(i+1)*30).map(s=>s.id)})),{id:id+'-diagnosis',stage:'diagnosis',status:'pending'}],model:cfg.model,stopRequested:false,createdAt:stamp(),updatedAt:stamp(),tokens:0,snapshot:{brand,...(store?{store,storeContext:localContext}:{}),observations:store?[]:(await listRecords<ChannelObservation>(owner,'brand_observation',brandId)).slice(0,12)}};
  await database().batch([recordStatement(owner,'brand_research',r.id,r,brandId),database().prepare('INSERT INTO jobs(id,owner,campaign_id,role,status,model,campaign_version,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)').bind(jobId(owner,id),owner,'brand:'+brandId,'brand_research','in_progress',cfg.model,1,r.createdAt,r.updatedAt)]);return json(publicResearch(r),202);
 }
 else r=await readRecord<BrandResearch>(owner,'brand_research',id);current=r;
 if(b.action==='advance'&&r.retryAt&&Date.parse(r.retryAt)>Date.now())return json(publicResearch(r));
 if(!['start','advance','recover','cancel'].includes(b.action))throw new ApiError(400,'지원하지 않는 조사 작업입니다.');
 if(!researchActive(r))return json(publicResearch(r));const step=r.steps.find(s=>s.status!=='completed');if(!step)throw new ApiError(409,'조사 진행 상태를 확인하세요.');
 if(b.action==='cancel'){r.stopRequested=true;r.updatedAt=stamp();await database().batch(writes(owner,r))}
 if(r.stopRequested&&step.status==='pending'){r.status='cancelled';await database().batch(writes(owner,r));return json(publicResearch(r))}
 const cfg=await connection(owner);if(cfg.provider!=='hermes')throw new ApiError(409,'조사를 시작한 HERMES 연결이 필요합니다.');
 if(step.status==='pending'){
  if((await workerStatus(owner)).activated)r.execution='server';
  const archived=await listRecords<ArchiveSource>(owner,'brand_source',r.brandId),sources=archived.filter(s=>s.status!=='excluded'&&(!s.storeId||s.storeId===r.storeId));
  const selected=step.sourceIds?sources.filter(s=>step.sourceIds!.includes(s.id)):sources.slice(0,30);
  step.sourceIds=selected.map(s=>s.id);
  const prior=r.previousResearchId?await readRecord<BrandResearch>(owner,'brand_research',r.previousResearchId):undefined;
  const input={execution:r.execution,protocol:r.protocol,plan:r.plan,access:r.access,maxNewSources:Math.max(0,Math.min(40,200-archived.length)),previousGaps:prior?.report?.quality.issues||[],brand:r.snapshot.brand,store:r.snapshot.store,storeContext:r.snapshot.storeContext,mode:r.mode,stage:step.stage,requestedAt:stamp(),sources:selected.map(s=>({id:s.id,title:s.title,status:s.status,category:s.category,url:s.url,scope:s.scope,observedAt:s.observedAt,content:s.content.slice(0,4500),excerpt:s.content.length>4500})),omittedSources:Math.max(0,sources.length-selected.length),observations:r.snapshot.observations.slice(0,12),priorSteps:r.steps.filter(s=>s.status==='completed').map(s=>({stage:s.stage,summary:s.summary,limitations:s.limitations}))};
  step.status='uncertain';r.updatedAt=stamp();await database().batch([...writes(owner,r),hermesSubmissionStatement(owner,step.id,{instructions:step.stage==='store_diagnosis'?storeResearchInstructions:step.stage==='investigation'?deepInstructions:archiveResearchInstructions(step.stage,r.mode)+(r.storeId?'\n이번 작업은 특정 점포의 조사입니다. 입력 store와 storeContext를 기준으로 지점명·주소를 확인하세요. identity는 메뉴·가격·영업시간·주차·예약/주문 경로, customer는 생활권·이용 상황·동일 상권 경쟁 매장·리뷰의 방문 장벽, channel은 네이버 플레이스/검색광고·블로그·지역 맛집 페이지·당근·지도·재방문 동선을 우선 조사하세요. 사용자 제공 사실과 공개 관찰을 구분하고 다른 지점의 수치를 섞지 마세요. SNS 영상 표본 수를 채우는 작업은 필수가 아닙니다.':''),input:JSON.stringify(input)},r.brandId)]);prepared=r;
  const result=await submitHermes(owner,step.id,cfg,undefined,submissionTimeoutMs);step.providerId=result.id;step.status='running';r.status='running';r.error=undefined;r.retryAt=undefined;r.retryCount=0;await database().batch(writes(owner,r));return json(publicResearch(r));
 }
 if(!step.providerId){if(b.action!=='recover'){r.status='uncertain';r.error='조사 접수 확인이 지연돼 같은 요청으로 다시 확인합니다.';researchRetry(r);await database().batch(writes(owner,r));return json(publicResearch(r))}recovering=true;prepared=r;const result=await submitHermes(owner,step.id,cfg,undefined,submissionTimeoutMs);step.providerId=result.id;step.status='running';r.status='running';r.error=undefined;r.retryAt=undefined;r.retryCount=0;await database().batch(writes(owner,r));return json(publicResearch(r))}
 const result=await pollHermes(cfg,step.providerId,r.stopRequested,Math.min(submissionTimeoutMs,45000),owner,researchUsage(owner,r,step));r.updatedAt=stamp();r.lastCheckedAt=r.updatedAt;r.activity=result.activity;r.activityAt=result.activityAt;r.retryAt=undefined;r.retryCount=0;r.error=result.needsApproval?'HERMES에서 도구 사용 승인을 기다리고 있습니다. 연결된 HERMES에서 요청 내용을 확인하세요.':undefined;r.status='running';step.status='running';
 if(['completed','failed','cancelled'].includes(result.status)){
  const measuredStep=step as typeof step&{usageTokens?:number};
  const tokens=Number.isSafeInteger(result.usage.total_tokens)?Math.max(0,result.usage.total_tokens):0;
  r.tokens+=Math.max(0,tokens-(measuredStep.usageTokens||0));measuredStep.usageTokens=Math.max(tokens,measuredStep.usageTokens||0);
 }
 if(r.stopRequested){if(['completed','failed','cancelled'].includes(result.status)){r.status='cancelled';await markUsageOutcome(owner,'hermes',step.providerId,result.invalidOutput?'invalid_output':'cancelled')}await database().batch(writes(owner,r));return json(publicResearch(r))}
 if(result.status==='completed'){
  const all=await listRecords<ArchiveSource>(owner,'brand_source',r.brandId),state=await archiveState(owner,r.brandId);const out:D1PreparedStatement[]=[];
  try{
   const x=researchObject(result.output[0].content[0].text);
   if(step.stage==='store_diagnosis'){
    if(!r.snapshot.store)throw new ApiError(422,'지점 조사 기준이 없습니다.');const parsed=parseStoreReport(x,r.snapshot.store,all.filter(s=>step.sourceIds?.includes(s.id)),r.id);out.push(recordStatement(owner,'store_report',parsed.id,parsed,r.storeId!));step.summary=parsed.summary;step.limitations=parsed.limitations;
   }else if(step.stage==='investigation'){
    const parsed=parseDeepReport(x,r,all.filter(s=>step.sourceIds?.includes(s.id)));if(all.length+parsed.sources.length>200)throw new ApiError(400,'자료 보관 한도를 초과했습니다.');
    const revision=state.revision+(parsed.sources.length?1:0);for(const source of parsed.sources)out.push(recordStatement(owner,'brand_source',source.id,source,r.brandId));if(parsed.sources.length)out.push(stateWrite(owner,r.brandId,revision));
    const d:Diagnostic={...parsed.diagnosis,id:r.id,brandId:r.brandId,researchId:r.id,archiveRevision:revision,status:'candidate',createdAt:stamp()};out.push(recordStatement(owner,'brand_diagnostic',d.id,d,r.brandId));r.report=parsed.report;step.summary=d.summary;step.limitations=d.limitations;
   }else if(step.stage==='diagnosis'){
    const parsed=parseDiagnostic(x,all.filter(s=>s.status!=='excluded').slice(0,30));const d:Diagnostic={...parsed,id:r.id,brandId:r.brandId,researchId:r.id,archiveRevision:state.revision,status:'candidate',createdAt:stamp()};out.push(recordStatement(owner,'brand_diagnostic',d.id,d,r.brandId));step.summary=d.summary;step.limitations=d.limitations;
   }else{
    const sources=parseResearchSources(x.sources,r.brandId,r.id,step.id,stamp()).map(s=>({...s,...(r.storeId?{storeId:r.storeId}:{})})).filter(s=>!all.some(a=>a.url===s.url&&a.status!=='excluded'&&a.storeId===s.storeId));if(r.mode==='classify'&&sources.length)throw new ApiError(422,'자료 분류에서 외부 출처를 만들 수 없습니다.');if(all.length+sources.length>200)throw new ApiError(400,'자료 보관 한도를 초과했습니다.');
    if(!Array.isArray(x.classifications)||x.classifications.length>30)throw new ApiError(422,'자료 분류 형식이 올바르지 않습니다.');const used=new Set<string>(),inputIds=new Set(step.sourceIds||all.filter(s=>s.status!=='excluded').slice(0,30).map(s=>s.id));
    for(const cl of x.classifications){const source=all.find(s=>s.id===cl?.sourceId&&s.status==='candidate');if(!cl||!Object.hasOwn(archiveCategories,cl.category)||used.has(cl.sourceId)||!inputIds.has(cl.sourceId))throw new ApiError(422,'존재하지 않거나 중복된 자료 분류입니다.');used.add(cl.sourceId);if(source&&source.category!==cl.category)out.push(recordStatement(owner,'brand_source',source.id,{...source,category:cl.category,version:source.version+1},r.brandId));}
    for(const source of sources)out.push(recordStatement(owner,'brand_source',source.id,source,r.brandId));
    step.summary=str(x.summary,'조사 요약',5000,true);step.limitations=str(x.limitations,'조사 한계',5000,true);if(out.length)out.push(stateWrite(owner,r.brandId,state.revision+1));
   }
   step.status='completed';if(r.steps.every(s=>s.status==='completed'))r.status='completed';
  }catch(e){step.status='failed';r.status='failed';r.error=e instanceof Error?e.message:'조사 결과를 확인하세요.';step.rawResult=result.output[0].content[0].text;out.length=0}
  await database().batch([...out,...writes(owner,r)]);await markUsageOutcome(owner,'hermes',step.providerId,step.status==='failed'?'invalid_output':'completed');
 }else if(['failed','cancelled'].includes(result.status)){await markUsageOutcome(owner,'hermes',step.providerId,result.invalidOutput?'invalid_output':result.status==='cancelled'?'cancelled':'provider_failed');r.status=result.status as 'failed'|'cancelled';step.status='failed';r.error=result.failureReason||'HERMES 조사가 종료됐습니다. 저장된 자료에서 이어서 새 조사를 시작할 수 있습니다.';await database().batch(writes(owner,r))}
 else await database().batch(writes(owner,r));
 return json(publicResearch(r));
}catch(e){if(prepared){prepared.status=recovering||!(e instanceof ApiError)||e.status>=500||e.status===429?'uncertain':'failed';prepared.error=prepared.status==='uncertain'?'조사 접수 확인이 지연되고 있습니다. 같은 요청으로 다시 확인하며 중복 조사를 만들지 않습니다.':(e as Error).message;prepared.updatedAt=stamp();if(!(e instanceof ApiError)||e.status>=500||e.status===429)researchRetry(prepared);else prepared.retryAt=undefined;await database().batch(writes(owner,prepared));return json(publicResearch(prepared))}if(current&&e instanceof ApiError&&(e.status>=500||e.status===429)){current.error=e.message+' 기존 실행을 다시 확인하며 새 조사를 중복 접수하지 않습니다.';current.updatedAt=stamp();researchRetry(current);await database().batch(writes(owner,current));return json(publicResearch(current))}if(current&&e instanceof ApiError&&e.status!==409){current.error=e.message;current.updatedAt=stamp();await database().batch(writes(owner,current))}return failure(e)}finally{if(lock)await releaseLock(lockOwner,lock)}}
function researchRetry(r:BrandResearch){r.retryCount=(r.retryCount||0)+1;r.retryAt=new Date(Date.now()+Math.min(300000,15000*2**Math.min(r.retryCount,5))).toISOString()}
