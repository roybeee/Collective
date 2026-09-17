import {ApiError,identity,secureMutation,body,str,json,failure,database,readRecord,listRecords,recordStatement,connection,acquireLock,releaseLock,stamp} from '@/lib/server';
import type {Brand} from '@/lib/agency';
import {archiveCategories,researchActive,publicResearch,type BrandResearch,type ArchiveSource,type ChannelObservation,type Diagnostic} from '@/lib/archive';
import {archiveState,stateWrite,assertArchiveIdle} from '@/lib/archive-server';
import {archiveResearchInstructions,researchObject,parseResearchSources,parseDiagnostic} from '@/lib/archive-research';
import {hermesSubmissionStatement,submitHermes,pollHermes} from '@/lib/hermes';
const jobId=(owner:string,id:string)=>owner+':brand-research:'+id;
function writes(owner:string,r:BrandResearch){return [recordStatement(owner,'brand_research',r.id,r,r.brandId),database().prepare('UPDATE jobs SET status=?,error=?,tokens=?,updated_at=? WHERE owner=? AND id=?').bind(r.status==='running'?'in_progress':r.status,r.error||null,r.tokens,r.updatedAt,owner,jobId(owner,r.id))]}
export async function POST(req:Request){let owner='',lock='',prepared:BrandResearch|undefined,recovering=false;try{
 owner=identity(req);secureMutation(req);const b=await body(req);lock=await acquireLock(owner);const id=str(b.id,'조사 번호',70,true);if(!/^[a-zA-Z0-9_-]+$/.test(id))throw new ApiError(400,'조사 번호를 확인하세요.');
 if(b.action==='start'){
  const existing=(await listRecords<BrandResearch>(owner,'brand_research')).find(r=>r.id===id);if(existing){if(existing.brandId!==b.brandId)throw new ApiError(409,'다른 브랜드의 조사 번호입니다.');return json(publicResearch(existing))}
  const brandId=str(b.brandId,'브랜드',100,true),brand=await readRecord<Brand>(owner,'brand',brandId);await assertArchiveIdle(owner,brandId);const cfg=await connection(owner);if(cfg.provider!=='hermes')throw new ApiError(409,'브랜드 심층 조사는 HERMES 연결이 필요합니다.');
  const mode=b.mode==='classify'?'classify':'deep';const sources=(await listRecords<ArchiveSource>(owner,'brand_source',brandId)).filter(s=>s.status!=='excluded');if(mode==='classify'&&!sources.some(s=>s.content.trim()))throw new ApiError(400,'분석할 텍스트 자료를 먼저 추가하세요.');
  const r:BrandResearch={id,brandId,mode,status:'running',steps:mode==='deep'?(['identity','customer','channel','diagnosis'] as const).map((stage,i)=>({id:id+'-step-'+i,stage,status:'pending'})):[...Array.from({length:Math.ceil(sources.length/30)},(_,i)=>({id:id+'-step-'+i,stage:'identity' as const,status:'pending' as const,sourceIds:sources.slice(i*30,(i+1)*30).map(s=>s.id)})),{id:id+'-diagnosis',stage:'diagnosis',status:'pending'}],model:cfg.model,stopRequested:false,createdAt:stamp(),updatedAt:stamp(),tokens:0,snapshot:{brand,observations:(await listRecords<ChannelObservation>(owner,'brand_observation',brandId)).slice(0,12)}};
  await database().batch([recordStatement(owner,'brand_research',r.id,r,brandId),database().prepare('INSERT INTO jobs(id,owner,campaign_id,role,status,model,campaign_version,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)').bind(jobId(owner,id),owner,'brand:'+brandId,'brand_research','in_progress',cfg.model,1,r.createdAt,r.updatedAt)]);return json(publicResearch(r));
 }
 if(!['advance','recover','cancel'].includes(b.action))throw new ApiError(400,'지원하지 않는 조사 작업입니다.');
 const r=await readRecord<BrandResearch>(owner,'brand_research',id);if(!researchActive(r))return json(publicResearch(r));const step=r.steps.find(s=>s.status!=='completed');if(!step)throw new ApiError(409,'조사 진행 상태를 확인하세요.');
 if(b.action==='cancel'){r.stopRequested=true;r.updatedAt=stamp();await database().batch(writes(owner,r))}
 if(r.stopRequested&&step.status==='pending'){r.status='cancelled';await database().batch(writes(owner,r));return json(publicResearch(r))}
 const cfg=await connection(owner);if(cfg.provider!=='hermes')throw new ApiError(409,'조사를 시작한 HERMES 연결이 필요합니다.');
 if(step.status==='pending'){
  const sources=(await listRecords<ArchiveSource>(owner,'brand_source',r.brandId)).filter(s=>s.status!=='excluded');
  const selected=step.sourceIds?sources.filter(s=>step.sourceIds!.includes(s.id)):sources.slice(0,30);
  const input={brand:r.snapshot.brand,mode:r.mode,stage:step.stage,requestedAt:stamp(),sources:selected.map(s=>({id:s.id,title:s.title,status:s.status,category:s.category,url:s.url,scope:s.scope,observedAt:s.observedAt,content:s.content.slice(0,4500),excerpt:s.content.length>4500})),omittedSources:Math.max(0,sources.length-selected.length),observations:r.snapshot.observations.slice(0,12),priorSteps:r.steps.filter(s=>s.status==='completed').map(s=>({stage:s.stage,summary:s.summary,limitations:s.limitations}))};
  step.status='uncertain';r.updatedAt=stamp();await database().batch([...writes(owner,r),hermesSubmissionStatement(owner,step.id,{instructions:archiveResearchInstructions(step.stage,r.mode),input:JSON.stringify(input)},r.brandId)]);prepared=r;
  const result=await submitHermes(owner,step.id,cfg);step.providerId=result.id;step.status='running';r.status='running';r.error=undefined;await database().batch(writes(owner,r));return json(publicResearch(r));
 }
 if(!step.providerId){if(b.action!=='recover'){r.status='uncertain';r.error='접수 확인이 필요합니다. 기존 요청 확인으로 같은 작업을 복구하세요.';await database().batch(writes(owner,r));return json(publicResearch(r))}recovering=true;prepared=r;const result=await submitHermes(owner,step.id,cfg);step.providerId=result.id;step.status='running';r.status='running';r.error=undefined;await database().batch(writes(owner,r));return json(publicResearch(r))}
 const result=await pollHermes(cfg,step.providerId,r.stopRequested);r.updatedAt=stamp();r.error=undefined;r.status='running';step.status='running';
 if(r.stopRequested){if(['completed','failed','cancelled'].includes(result.status))r.status='cancelled';await database().batch(writes(owner,r));return json(publicResearch(r))}
 if(result.status==='completed'){
  const all=await listRecords<ArchiveSource>(owner,'brand_source',r.brandId),state=await archiveState(owner,r.brandId);const out:D1PreparedStatement[]=[];
  try{
   const x=researchObject(result.output[0].content[0].text);
   if(step.stage==='diagnosis'){
    const parsed=parseDiagnostic(x,all.filter(s=>s.status!=='excluded').slice(0,30));const d:Diagnostic={...parsed,id:r.id,brandId:r.brandId,researchId:r.id,archiveRevision:state.revision,status:'candidate',createdAt:stamp()};out.push(recordStatement(owner,'brand_diagnostic',d.id,d,r.brandId));step.summary=d.summary;step.limitations=d.limitations;
   }else{
    const sources=parseResearchSources(x.sources,r.brandId,r.id,step.id,stamp());if(r.mode==='classify'&&sources.length)throw new ApiError(422,'자료 분류에서 외부 출처를 만들 수 없습니다.');if(all.length+sources.length>200)throw new ApiError(400,'자료 보관 한도를 초과했습니다.');
    if(!Array.isArray(x.classifications)||x.classifications.length>30)throw new ApiError(422,'자료 분류 형식이 올바르지 않습니다.');const used=new Set<string>(),inputIds=new Set(step.sourceIds||all.filter(s=>s.status!=='excluded').slice(0,30).map(s=>s.id));
    for(const cl of x.classifications){const source=all.find(s=>s.id===cl?.sourceId&&s.status==='candidate');if(!cl||!Object.hasOwn(archiveCategories,cl.category)||used.has(cl.sourceId)||!inputIds.has(cl.sourceId))throw new ApiError(422,'존재하지 않거나 중복된 자료 분류입니다.');used.add(cl.sourceId);if(source&&source.category!==cl.category)out.push(recordStatement(owner,'brand_source',source.id,{...source,category:cl.category,version:source.version+1},r.brandId));}
    for(const source of sources)out.push(recordStatement(owner,'brand_source',source.id,source,r.brandId));
    step.summary=str(x.summary,'조사 요약',5000,true);step.limitations=str(x.limitations,'조사 한계',5000,true);if(out.length)out.push(stateWrite(owner,r.brandId,state.revision+1));
   }
   step.status='completed';r.tokens+=result.usage.total_tokens;if(r.steps.every(s=>s.status==='completed'))r.status='completed';
  }catch(e){step.status='failed';r.status='failed';r.error=e instanceof Error?e.message:'조사 결과를 확인하세요.';out.length=0}
  await database().batch([...out,...writes(owner,r)]);
 }else if(['failed','cancelled'].includes(result.status)){r.status=result.status as 'failed'|'cancelled';step.status='failed';r.error='HERMES 조사가 종료됐습니다. 저장된 자료에서 이어서 새 조사를 시작할 수 있습니다.';await database().batch(writes(owner,r))}
 else await database().batch(writes(owner,r));
 return json(publicResearch(r));
}catch(e){if(prepared){prepared.status=recovering||!(e instanceof ApiError)||e.status>=500?'uncertain':'failed';prepared.error=prepared.status==='uncertain'?'HERMES 접수 확인이 필요합니다. 기존 요청 확인으로 복구하세요.':(e as Error).message;prepared.updatedAt=stamp();await database().batch(writes(owner,prepared));return json(publicResearch(prepared))}return failure(e)}finally{if(lock)await releaseLock(owner,lock)}}
