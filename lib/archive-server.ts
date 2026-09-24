import {ApiError,database,listRecords,readRecord,recordStatement,stamp,str,uid,num,runtime} from './server';
import {storeContext} from './store-context';
import {diagnosisIncluded,latestAdopted,CONTEXT_SOURCE_LIMIT,type AdoptedDiagnostic} from './ai-context';
import type {Brand} from './agency';
import {archiveCategories,classifySource,metricFields,type ArchiveSource,type ArchiveState,type ChannelObservation,type Diagnostic,type MetricField,type BrandIntake} from './archive';
export async function archiveState(owner:string,brandId:string):Promise<ArchiveState>{const s=await listRecords<ArchiveState>(owner,'brand_archive_state',brandId);return s[0]||{id:brandId,revision:0,updatedAt:''}}
export function stateWrite(owner:string,brandId:string,revision:number){return recordStatement(owner,'brand_archive_state',brandId,{id:brandId,revision,updatedAt:stamp()},brandId)}
export async function assertArchiveIdle(owner:string,brandId:string){const r=await database().prepare("SELECT id FROM jobs WHERE owner=? AND campaign_id=? AND status IN ('starting','queued','in_progress','uncertain')").bind(owner,'brand:'+brandId).first();if(r)throw new ApiError(409,'브랜드 조사 중입니다. 조사 완료 또는 중지 후 자료를 변경하세요.')}
export function archiveUrl(value:unknown,required=false){const text=str(value??'','출처 URL',2000,required);if(!text)return '';let u:URL;try{u=new URL(text)}catch{throw new ApiError(400,'출처 URL을 확인하세요.')}if(!['https:','http:'].includes(u.protocol)||u.username||u.password||!u.hostname.includes('.')||/^[\d.]+$/.test(u.hostname)||u.hostname.includes(':')||/(^|\.)(localhost|internal|local|test|invalid)$/.test(u.hostname))throw new ApiError(400,'공개 웹 주소를 입력하세요.');return u.href}
export function intake(raw:any):BrandIntake{return {website:archiveUrl(raw?.website),socialLinks:str(raw?.socialLinks??'','공식 채널',6000),market:str(raw?.market??'','시장',3000),clientNeed:str(raw?.clientNeed??'','의뢰 목적',5000),competitors:str(raw?.competitors??'','경쟁·대안',5000)}}
export function observed(value:unknown){const t=str(value,'확인 시점',50,true);if(!Number.isFinite(Date.parse(t))||Date.parse(t)>Date.now()+60000)throw new ApiError(400,'현재까지의 유효한 확인 시점이 필요합니다.');return new Date(t).toISOString()}
export function makeSource(brandId:string,b:any,origin:ArchiveSource['origin']='manual'):ArchiveSource{
 const title=str(b.title,'자료 제목',200,true),content=str(b.content??'','자료 내용',80000);const category=b.category||classifySource(title,content);if(!Object.hasOwn(archiveCategories,category))throw new ApiError(400,'자료 분류를 확인하세요.');
 if(!content&&!b.fileName)throw new ApiError(400,'출처 링크와 함께 확인한 내용이나 원문 파일이 필요합니다.');
 return {id:uid(),brandId,title,category,origin,status:'candidate',url:archiveUrl(b.url),content,scope:str(b.scope??'사용자가 입력한 자료','확인 범위',3000,true),observedAt:observed(b.observedAt||stamp()),createdAt:stamp(),version:1};
}
// 원본 파일 삭제 표시(brand_source 확장 필드, 새 kind 없음). fileCleanupKey는 R2 삭제가 끝나지 않은 원본 키로 재시도 목록 역할을 하며 API 응답에는 내보내지 않는다(목록·지점 API는 lib/archive.ts sourceSummary, 자료 상세는 withoutCleanupKey).
export type SourceFileDeletion={fileDeletedAt?:string;fileDeletedBy?:{id:string;email:string|null};fileCleanupKey?:string};
export function withoutCleanupKey<T extends SourceFileDeletion>(s:T){const{fileCleanupKey,...rest}=s;return {...rest,...(fileCleanupKey?{fileCleanupPending:true}:{})}}
// R2 원본 삭제. 실패하면 오류 이름만 로그에 남기고(키·메시지 없음) false를 돌려준다.
// 같은 버킷에 다른 워크스페이스 원본과 공개 미디어가 섞여 있으므로, 업로드 라우트가 만든 'archive/<uuid>/<자료 id>' 형식(sourceId를 주면 그 자료의 키)만 지운다.
const ARCHIVE_KEY=/^archive\/[0-9a-f-]{36}\/[A-Za-z0-9_-]{1,100}$/;
export async function removeArchiveObject(key:string,sourceId?:string){
 if(!ARCHIVE_KEY.test(key)||(sourceId!==undefined&&!key.endsWith('/'+sourceId))){console.error('archive_object_cleanup_failed','InvalidKey');return false}
 if(!runtime.BUCKET){console.error('archive_object_cleanup_failed','BucketUnavailable');return false}
 try{await runtime.BUCKET.delete(key);return true}catch(e){const name=(e as {name?:unknown}|null)?.name;console.error('archive_object_cleanup_failed',typeof name==='string'?name.slice(0,60):'unknown');return false}
}
// 원본 파일 삭제(관리자 전용, 되돌릴 수 없음): 자료 레코드·추출 텍스트·검토 상태는 남기고 R2 원본만 지운다. 사용 제외(excluded)는 되돌릴 수 있어 원본을 지우지 않는다.
// 순서: 레코드 저장(objectKey 제거·fileDeletedAt·fileDeletedBy·fileCleanupKey) → R2 삭제 → 성공하면 fileCleanupKey 제거. R2가 실패해도 성공으로 답하고, 같은 요청을 다시 보내면 남은 R2 삭제만 재시도한다.
// AI 입력(content)은 그대로라 archive revision은 올리지 않는다.
export async function deleteSourceFile(owner:string,brandId:string,b:{id?:unknown;version?:unknown},by:{id:string;email:string|null}){
 let s=await readRecord<ArchiveSource&SourceFileDeletion>(owner,'brand_source',str(b.id,'자료',100,true));if(s.brandId!==brandId)throw new ApiError(404,'자료를 찾을 수 없습니다.');
 if(!s.fileDeletedAt){
  if(s.version!==b.version)throw new ApiError(409,'자료가 변경됐습니다. 새로고침해 주세요.');if(!s.objectKey)throw new ApiError(404,'삭제할 원본 파일이 없습니다.');
  s={...s,objectKey:undefined,fileDeletedAt:stamp(),fileDeletedBy:{id:by.id,email:by.email},fileCleanupKey:s.objectKey,version:s.version+1};await recordStatement(owner,'brand_source',s.id,s,brandId).run();
 }
 if(s.fileCleanupKey&&await removeArchiveObject(s.fileCleanupKey,s.id)){s={...s,fileCleanupKey:undefined};await recordStatement(owner,'brand_source',s.id,s,brandId).run()}
 return {id:s.id,version:s.version,fileDeletedAt:s.fileDeletedAt,cleanupPending:!!s.fileCleanupKey};
}
export function makeObservation(brandId:string,b:any):ChannelObservation{
 const periodStart=str(b.periodStart,'시작일',10,true),periodEnd=str(b.periodEnd,'종료일',10,true);
 for(const d of [periodStart,periodEnd])if(!/^\d{4}-\d{2}-\d{2}$/.test(d)||!Number.isFinite(Date.parse(d))||new Date(d).toISOString().slice(0,10)!==d)throw new ApiError(400,'측정 기간을 확인하세요.');
 if(periodStart>periodEnd||Date.parse(periodEnd)>Date.now())throw new ApiError(400,'측정 종료는 시작 이후, 현재 이전이어야 합니다.');
 if(!['organic','paid','all'].includes(b.scope)||!['export','manual','public'].includes(b.method))throw new ApiError(400,'측정 범위와 수집 방식을 선택하세요.');
 const values={} as ChannelObservation['values'];
 for(const key of Object.keys(metricFields) as MetricField[]){const v=b.values?.[key];values[key]=v===null||v===undefined||v===''?null:num(v,metricFields[key]);if(values[key]!==null&&!['revenue','adSpend','variableCosts','productionCost','averageViewPercentage'].includes(key)&&!Number.isInteger(values[key]))throw new ApiError(400,'횟수와 계정 수는 정수로 입력하세요.');}
 if(Object.values(values).every(v=>v===null))throw new ApiError(400,'확인된 수치를 하나 이상 입력하세요.');
 if(values.keyEventSessions!==null&&values.sessions!==null&&values.keyEventSessions>values.sessions)throw new ApiError(400,'핵심 행동 세션은 전체 세션보다 클 수 없습니다.');
 if(b.method==='public'&&(['reach','impressions','saves','clicks','sessions','keyEventSessions','orders','revenue','adSpend','variableCosts','productionCost','averageViewPercentage'] as MetricField[]).some(k=>values[k]!==null))throw new ApiError(400,'계정 통계·내부 성과 수치는 공개 관찰과 분리해 직접 입력 또는 내보내기 자료로 등록하세요.');
 return {id:uid(),brandId,channel:str(b.channel,'채널',80,true),account:str(b.account,'계정·대상',300,true),periodStart,periodEnd,observedAt:observed(b.observedAt||stamp()),source:str(b.source,'수치 출처',2000,true),definition:str(b.definition,'지표 정의·집계 조건',3000,true),scope:b.scope,method:b.method,values,version:1,createdAt:stamp()};
}
// 채택 기록(브랜드 지문·채택자)은 AI 입력에서 뺀다.
const withoutAdoption=(d:AdoptedDiagnostic)=>Object.fromEntries(Object.entries(d).filter(([k])=>!['brandBasis','confirmedBy','confirmedAt'].includes(k))) as Diagnostic;
export async function brandArchiveContext(owner:string,brandId:string,storeId?:string){
 const state=await archiveState(owner,brandId),brand=await readRecord<Brand>(owner,'brand',brandId),all=await listRecords<ArchiveSource>(owner,'brand_source',brandId);const sources=all.filter(s=>s.status==='confirmed'&&(!s.storeId||s.storeId===storeId));
 const latest=latestAdopted(await listRecords<AdoptedDiagnostic>(owner,'brand_diagnostic',brandId)),diagnosis=latest&&diagnosisIncluded(latest,all,brand,state.revision)?latest:undefined;
 const observations=storeId?[]:await listRecords<ChannelObservation>(owner,'brand_observation',brandId);
 return {storeMarketing:await storeContext(owner,brandId,storeId),revision:state.revision,observations:observations.slice(0,12),omittedObservations:Math.max(0,observations.length-12),confirmedSources:sources.slice(0,CONTEXT_SOURCE_LIMIT).map(s=>({id:s.id,title:s.title,category:s.category,url:s.url,observedAt:s.observedAt,scope:s.scope,content:s.content.slice(0,3500),excerpt:s.content.length>3500,version:s.version})),omittedSources:Math.max(0,sources.length-CONTEXT_SOURCE_LIMIT),confirmedDiagnosis:diagnosis?withoutAdoption(diagnosis):null,notice:'자료는 확인된 항목만 포함되며 관찰 수치는 사용자 기록입니다. 출처·기간·정의를 확인하고 미수집 값을 추정하지 마세요. 진단이 없으면 미확정으로 다루세요. 근거가 바뀐 진단은 제외됩니다.'};
}
