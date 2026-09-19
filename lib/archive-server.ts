import {ApiError,database,listRecords,readRecord,recordStatement,stamp,str,uid,num} from './server';
import {storeContext} from './store-context';
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
export async function brandArchiveContext(owner:string,brandId:string,storeId?:string){
 const state=await archiveState(owner,brandId);const sources=(await listRecords<ArchiveSource>(owner,'brand_source',brandId)).filter(s=>s.status==='confirmed'&&(!s.storeId||s.storeId===storeId));
 const diagnosis=(await listRecords<Diagnostic>(owner,'brand_diagnostic',brandId)).find(d=>d.status==='confirmed'&&d.archiveRevision===state.revision);
 const observations=storeId?[]:await listRecords<ChannelObservation>(owner,'brand_observation',brandId);
 return {storeMarketing:await storeContext(owner,brandId,storeId),revision:state.revision,observations:observations.slice(0,12),omittedObservations:Math.max(0,observations.length-12),confirmedSources:sources.slice(0,20).map(s=>({id:s.id,title:s.title,category:s.category,url:s.url,observedAt:s.observedAt,scope:s.scope,content:s.content.slice(0,3500),excerpt:s.content.length>3500,version:s.version})),omittedSources:Math.max(0,sources.length-20),confirmedDiagnosis:diagnosis||null,notice:'자료는 확인된 항목만 포함되며 관찰 수치는 사용자 기록입니다. 출처·기간·정의를 확인하고 미수집 값을 추정하지 마세요. 진단이 없으면 미확정으로 다루세요. 근거가 바뀐 진단은 제외됩니다.'};
}
