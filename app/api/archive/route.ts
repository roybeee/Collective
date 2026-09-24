import {workerStatus} from '@/lib/research-worker';
import {initialResearch,queueResearchStatements} from '@/lib/research-queue';
import {scheduleResearch} from '@/lib/research-background';
import {autoResearchAccess} from '@/lib/research-tool-check';
import {ApiError,identity,requireAdminActor,secureMutation,body,str,json,failure,database,readRecord,listRecords,recordStatement,acquireLock,releaseLock,stamp,uid,runtime,configuration,connection,assertNoActiveJobs} from '@/lib/server';
import type {Brand} from '@/lib/agency';
import {sourceSummary,publicResearch,type ArchiveSource,type ChannelObservation,type Diagnostic,type BrandResearch} from '@/lib/archive';
import {archiveState,stateWrite,assertArchiveIdle,makeSource,makeObservation,intake,deleteSourceFile,withoutCleanupKey,type SourceFileDeletion} from '@/lib/archive-server';
import {diagnosisBasis,diagnosisIncluded,latestAdopted,brandBasis,type AdoptedDiagnostic} from '@/lib/ai-context';
import {reviewActor,requireReasonCodes,sourceDecisionStatement} from '@/lib/review-decisions-server';
export async function GET(req:Request){try{const owner=await identity(req),u=new URL(req.url),brandId=str(u.searchParams.get('brandId'),'브랜드',100,true),brand=await readRecord<Brand>(owner,'brand',brandId);
 if(u.searchParams.get('sourceId')){const s=await readRecord<ArchiveSource&SourceFileDeletion>(owner,'brand_source',str(u.searchParams.get('sourceId'),'자료',100,true));if(s.brandId!==brandId)throw new ApiError(404,'자료를 찾을 수 없습니다.');const{objectKey:_,...data}=withoutCleanupKey(s);return json(data)}
 // 진단마다 근거 상태(basis)와 AI 입력 포함 여부(included)를 서버 규칙으로 계산해 화면이 같은 기준을 쓰게 한다.
 const state=await archiveState(owner,brandId),sources=await listRecords<ArchiveSource>(owner,'brand_source',brandId);
 const diagnostics=await listRecords<AdoptedDiagnostic>(owner,'brand_diagnostic',brandId),latest=latestAdopted(diagnostics);
 return json({state,sources:sources.map(sourceSummary),observations:await listRecords<ChannelObservation>(owner,'brand_observation',brandId),diagnostics:diagnostics.map(d=>({...d,basis:diagnosisBasis(d,sources),included:d.id===latest?.id&&diagnosisIncluded(d,sources,brand,state.revision)})),research:(await listRecords<BrandResearch>(owner,'brand_research',brandId)).map(publicResearch),storageReady:!!runtime.BUCKET});
}catch(e){return failure(e)}}
export async function POST(req:Request){let owner='',lock='';try{owner=await identity(req);secureMutation(req);const b=await body(req);lock=await acquireLock(owner);
 if(b.action==='create_brand'){
  const id=str(b.id,'브랜드 번호',100,true);if(!/^[a-zA-Z0-9_-]{5,100}$/.test(id))throw new ApiError(400,'브랜드 번호를 확인하세요.');const existing=(await listRecords<Brand>(owner,'brand')).find(x=>x.id===id);if(existing)return json({id:existing.id});
  const name=str(b.data?.name,'브랜드 이름',100,true),brand:Brand={id,name,short:name.slice(0,3).toUpperCase(),category:str(b.data?.category??'','업종',100,true),description:str(b.data?.description??'','소개',5000),audience:'',tone:'',constraints:'',knowledge:'',color:'#273953',bg:'#e5e9ee',intake:intake(b.data?.intake)};
  let research:BrandResearch|undefined,researchBlocked:string|undefined;
  // RESEARCH_TOOL_POLICY=block이면 등록 전에 도구를 점검해, 막히면 브랜드만 만들고 조사는 만들지 않는다(security-ops-1). 기본(warn)은 점검 없이 바로 등록한다.
  if(b.autoResearch===true&&(await configuration(owner))?.secret){const cfg=await connection(owner);if(cfg.provider==='hermes'){const checked=await autoResearchAccess(cfg);researchBlocked=checked.blocked;if(!researchBlocked){const queued=initialResearch(brand,uid(),cfg.model,(await workerStatus(owner)).activated);research=checked.access?{...queued,access:checked.access}:queued}}}
  await database().batch([recordStatement(owner,'brand',id,brand),stateWrite(owner,id,0),...(research?queueResearchStatements(owner,research):[])]);
  if(research)scheduleResearch(owner,research.id);
  return json({id,researchId:research?.id,researchQueued:!!research,...(researchBlocked?{researchBlocked}:{})});
 }
 const brandId=str(b.brandId,'브랜드',100,true),brand=await readRecord<Brand>(owner,'brand',brandId);await assertArchiveIdle(owner,brandId);const state=await archiveState(owner,brandId);
 // 확정 자료·채택 진단·의뢰 정보는 AI 제작 맥락에 '확인된 근거'로 들어가므로 관리자 전용이다. 직원은 자료 추가와 후보 검토까지 한다.
 if(b.action==='save_intake'){await requireAdminActor(req);await assertNoActiveJobs(owner);const updated={...brand,intake:intake(b.data)};await database().batch([recordStatement(owner,'brand',brandId,updated),stateWrite(owner,brandId,state.revision+1)]);return json({id:brandId})}
 if(b.action==='add_source'){
  const rows=await listRecords<ArchiveSource>(owner,'brand_source',brandId);if(rows.length>=200)throw new ApiError(400,'브랜드당 자료 200개까지 보관할 수 있습니다.');
  const s=makeSource(brandId,b.data||{});await database().batch([recordStatement(owner,'brand_source',s.id,s,brandId),stateWrite(owner,brandId,state.revision+1)]);return json({id:s.id});
 }
 if(b.action==='review_source'){
  const who=b.status!=='candidate'?await requireAdminActor(req):null;
  const s=await readRecord<ArchiveSource>(owner,'brand_source',str(b.id,'자료',100,true));if(s.brandId!==brandId)throw new ApiError(404,'자료를 찾을 수 없습니다.');if(s.version!==b.version)throw new ApiError(409,'자료가 변경됐습니다. 새로고침해 주세요.');if(!['confirmed','candidate','excluded'].includes(b.status))throw new ApiError(400,'검토 상태를 확인하세요.');if(b.status==='confirmed'&&!s.content.trim())throw new ApiError(400,'분석 가능한 내용이 없습니다. 원문을 확인하고 텍스트 자료를 추가해 주세요.');
  // B1: 사용 제외는 사유 코드(선택)와 함께 review_decision 1건을 남긴다. 모르는 코드는 쓰기 전에 400이다.
  const exclusion=b.status==='excluded'?[sourceDecisionStatement(owner,s,reviewActor(who!),requireReasonCodes(b.reasonCodes,'source'))]:[];
  await database().batch([recordStatement(owner,'brand_source',s.id,{...s,status:b.status,version:s.version+1},brandId),stateWrite(owner,brandId,state.revision+1),...exclusion]);return json({id:s.id});
 }
 // 후보 자료 일괄 검토: 모두 검증한 뒤 한 번에 저장하고 revision은 한 번만 올린다. 확정·제외는 관리자 전용(PR 1).
 if(b.action==='review_sources'){
  if(!Array.isArray(b.items)||!b.items.length||b.items.length>200)throw new ApiError(400,'검토할 자료를 1~200개 선택하세요.');
  const who=b.items.some((i:{status?:unknown}|null)=>i?.status!=='candidate')?await requireAdminActor(req):null;
  const reasonCodes=requireReasonCodes(b.reasonCodes,'source');
  const rows=await listRecords<ArchiveSource>(owner,'brand_source',brandId),seen=new Set<string>(),writes:D1PreparedStatement[]=[];
  for(const item of b.items){
   const s=rows.find(r=>r.id===item?.id);if(!s)throw new ApiError(404,'자료를 찾을 수 없습니다.');if(seen.has(s.id))throw new ApiError(400,'같은 자료가 중복 선택됐습니다.');seen.add(s.id);
   if(s.version!==item.version)throw new ApiError(409,`자료가 변경됐습니다. 새로고침해 주세요: ${s.title}`);if(!['confirmed','candidate','excluded'].includes(item.status))throw new ApiError(400,'검토 상태를 확인하세요.');if(item.status==='confirmed'&&!s.content.trim())throw new ApiError(400,`분석 가능한 내용이 없는 자료는 확정할 수 없습니다: ${s.title}`);
   writes.push(recordStatement(owner,'brand_source',s.id,{...s,status:item.status,version:s.version+1},brandId));
   if(item.status==='excluded')writes.push(sourceDecisionStatement(owner,s,reviewActor(who!),reasonCodes));
  }
  await database().batch([...writes,stateWrite(owner,brandId,state.revision+1)]);return json({ids:[...seen],revision:state.revision+1});
 }
 // 원본 파일 삭제(관리자 전용): 레코드는 남기고 R2 원본만 지운다. 사용 제외와 달리 되돌릴 수 없다(lib/archive-server.ts deleteSourceFile).
 if(b.action==='delete_source_file'){const who=await requireAdminActor(req);return json(await deleteSourceFile(owner,brandId,b,who))}
 if(b.action==='add_observation'){const o=makeObservation(brandId,b.data||{});await database().batch([recordStatement(owner,'brand_observation',o.id,o,brandId),stateWrite(owner,brandId,state.revision+1)]);return json({id:o.id})}
 if(b.action==='confirm_diagnosis'){
  const who=await requireAdminActor(req);
  // 채택 조건: 근거 자료가 모두 확정이고 진단 이후 근거 집합이 바뀌지 않음. revision이 달라도 HERMES를 다시 부르지 않고 채택한다.
  const d=await readRecord<Diagnostic>(owner,'brand_diagnostic',str(b.id,'진단',100,true));if(d.brandId!==brandId)throw new ApiError(404,'진단을 찾을 수 없습니다.');if(d.researchQuality?.status==='needs_data')throw new ApiError(409,'조사 근거가 부족합니다. 추가 자료와 보완 조사 후 진단을 채택하세요.');const basis=diagnosisBasis(d,await listRecords<ArchiveSource>(owner,'brand_source',brandId));
  if(basis==='pending')throw new ApiError(409,'진단 근거 중 검토 대기 자료가 있습니다. 근거 자료를 확인한 뒤 채택하세요.');if(basis!=='confirmed')throw new ApiError(409,'진단 이후 근거 자료가 바뀌었습니다. 최신 자료로 다시 진단해 주세요.');
  const adoptionSeq=Math.max(0,...(await listRecords<AdoptedDiagnostic>(owner,'brand_diagnostic',brandId)).map(x=>x.adoptionSeq??0))+1;
  await recordStatement(owner,'brand_diagnostic',d.id,{...d,status:'confirmed',brandBasis:brandBasis(brand),confirmedBy:{id:who.id,email:who.email},confirmedAt:stamp(),adoptionSeq},brandId).run();return json({id:d.id});
 }
 throw new ApiError(400,'지원하지 않는 아카이브 작업입니다.');
}catch(e){return failure(e)}finally{if(lock)await releaseLock(owner,lock)}}
