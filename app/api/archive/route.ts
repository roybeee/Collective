import {workerStatus} from '@/lib/research-worker';
import {initialResearch,queueResearchStatements} from '@/lib/research-queue';
import {scheduleResearch} from '@/lib/research-background';
import {ApiError,identity,secureMutation,body,str,json,failure,database,readRecord,listRecords,recordStatement,acquireLock,releaseLock,stamp,uid,runtime,configuration,connection,assertNoActiveJobs} from '@/lib/server';
import type {Brand} from '@/lib/agency';
import {sourceSummary,publicResearch,type ArchiveSource,type ChannelObservation,type Diagnostic,type BrandResearch} from '@/lib/archive';
import {archiveState,stateWrite,assertArchiveIdle,makeSource,makeObservation,intake} from '@/lib/archive-server';
export async function GET(req:Request){try{const owner=await identity(req),u=new URL(req.url),brandId=str(u.searchParams.get('brandId'),'브랜드',100,true);await readRecord<Brand>(owner,'brand',brandId);
 if(u.searchParams.get('sourceId')){const s=await readRecord<ArchiveSource>(owner,'brand_source',str(u.searchParams.get('sourceId'),'자료',100,true));if(s.brandId!==brandId)throw new ApiError(404,'자료를 찾을 수 없습니다.');const{objectKey:_,...data}=s;return json(data)}
 return json({state:await archiveState(owner,brandId),sources:(await listRecords<ArchiveSource>(owner,'brand_source',brandId)).map(sourceSummary),observations:await listRecords<ChannelObservation>(owner,'brand_observation',brandId),diagnostics:await listRecords<Diagnostic>(owner,'brand_diagnostic',brandId),research:(await listRecords<BrandResearch>(owner,'brand_research',brandId)).map(publicResearch),storageReady:!!runtime.BUCKET});
}catch(e){return failure(e)}}
export async function POST(req:Request){let owner='',lock='';try{owner=await identity(req);secureMutation(req);const b=await body(req);lock=await acquireLock(owner);
 if(b.action==='create_brand'){
  const id=str(b.id,'브랜드 번호',100,true);if(!/^[a-zA-Z0-9_-]{5,100}$/.test(id))throw new ApiError(400,'브랜드 번호를 확인하세요.');const existing=(await listRecords<Brand>(owner,'brand')).find(x=>x.id===id);if(existing)return json({id:existing.id});
  const name=str(b.data?.name,'브랜드 이름',100,true),brand:Brand={id,name,short:name.slice(0,3).toUpperCase(),category:str(b.data?.category??'','업종',100,true),description:str(b.data?.description??'','소개',5000),audience:'',tone:'',constraints:'',knowledge:'',color:'#273953',bg:'#e5e9ee',intake:intake(b.data?.intake)};
  let research:BrandResearch|undefined;
  if(b.autoResearch===true&&(await configuration(owner))?.secret){const cfg=await connection(owner);if(cfg.provider==='hermes')research=initialResearch(brand,uid(),cfg.model,(await workerStatus(owner)).activated)}
  await database().batch([recordStatement(owner,'brand',id,brand),stateWrite(owner,id,0),...(research?queueResearchStatements(owner,research):[])]);
  if(research)scheduleResearch(owner,research.id);
  return json({id,researchId:research?.id,researchQueued:!!research});
 }
 const brandId=str(b.brandId,'브랜드',100,true),brand=await readRecord<Brand>(owner,'brand',brandId);await assertArchiveIdle(owner,brandId);const state=await archiveState(owner,brandId);
 if(b.action==='save_intake'){await assertNoActiveJobs(owner);const updated={...brand,intake:intake(b.data)};await database().batch([recordStatement(owner,'brand',brandId,updated),stateWrite(owner,brandId,state.revision+1)]);return json({id:brandId})}
 if(b.action==='add_source'){
  const rows=await listRecords<ArchiveSource>(owner,'brand_source',brandId);if(rows.length>=200)throw new ApiError(400,'브랜드당 자료 200개까지 보관할 수 있습니다.');
  const s=makeSource(brandId,b.data||{});await database().batch([recordStatement(owner,'brand_source',s.id,s,brandId),stateWrite(owner,brandId,state.revision+1)]);return json({id:s.id});
 }
 if(b.action==='review_source'){
  const s=await readRecord<ArchiveSource>(owner,'brand_source',str(b.id,'자료',100,true));if(s.brandId!==brandId)throw new ApiError(404,'자료를 찾을 수 없습니다.');if(s.version!==b.version)throw new ApiError(409,'자료가 변경됐습니다. 새로고침해 주세요.');if(!['confirmed','candidate','excluded'].includes(b.status))throw new ApiError(400,'검토 상태를 확인하세요.');if(b.status==='confirmed'&&!s.content.trim())throw new ApiError(400,'분석 가능한 내용이 없습니다. 원문을 확인하고 텍스트 자료를 추가해 주세요.');
  await database().batch([recordStatement(owner,'brand_source',s.id,{...s,status:b.status,version:s.version+1},brandId),stateWrite(owner,brandId,state.revision+1)]);return json({id:s.id});
 }
 if(b.action==='add_observation'){const o=makeObservation(brandId,b.data||{});await database().batch([recordStatement(owner,'brand_observation',o.id,o,brandId),stateWrite(owner,brandId,state.revision+1)]);return json({id:o.id})}
 if(b.action==='confirm_diagnosis'){
  const d=await readRecord<Diagnostic>(owner,'brand_diagnostic',str(b.id,'진단',100,true));if(d.brandId!==brandId)throw new ApiError(404,'진단을 찾을 수 없습니다.');if(d.researchQuality?.status==='needs_data')throw new ApiError(409,'조사 근거가 부족합니다. 추가 자료와 보완 조사 후 진단을 채택하세요.');if(d.archiveRevision!==state.revision)throw new ApiError(409,'진단 이후 자료가 바뀌었습니다. 최신 자료로 다시 진단하세요.');const sources=await listRecords<ArchiveSource>(owner,'brand_source',brandId);const ids=new Set(sources.filter(s=>s.status==='confirmed').map(s=>s.id));if(!d.sourceIds.length||d.sourceIds.some(id=>!ids.has(id)))throw new ApiError(409,'진단 근거를 확인한 뒤 최신 자료로 다시 진단해 주세요.');
  await recordStatement(owner,'brand_diagnostic',d.id,{...d,status:'confirmed'},brandId).run();return json({id:d.id});
 }
 throw new ApiError(400,'지원하지 않는 아카이브 작업입니다.');
}catch(e){return failure(e)}finally{if(lock)await releaseLock(owner,lock)}}
