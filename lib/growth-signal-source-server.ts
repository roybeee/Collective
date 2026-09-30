import type {Campaign} from './agency';
import type {ArchiveSource,BrandResearch} from './archive';
import type {GrowthRecord} from './growth-workspace-server';
import {type SignalInput,signalEvidence} from './growth-market';
import {assessSignalSource,signalSourceBasis,signalSourceText,type SignalSourceProvenance} from './growth-signal-source';
import {storefrontDigest} from './storefront-orders';
import {executionId} from './growth-execution';
import {ApiError,database,readRecord,recordStatement,stamp,type Actor} from './server';
const kinds={request:'growth_signal_source_request'} as const;
const requestKind=kinds.request;
async function optional<T>(owner:string,kind:string,id:string){try{return await readRecord<T>(owner,kind,id)}catch(e){if(e instanceof ApiError&&e.status===404)return null;throw e}}
async function sourceContext(owner:string,id:string){const s=await optional<ArchiveSource>(owner,'brand_source',id),r=s?.origin==='research'&&s.researchId?await optional<BrandResearch>(owner,'brand_research',s.researchId):null;return {s,r}}
async function signalId(c:Campaign,sourceId:string,sourceVersion:number){return 'archive_'+(await storefrontDigest({campaignId:c.id,sourceId,sourceVersion})).slice(0,48)}
async function capacity(owner:string,kind:string,c:Campaign,limit:number){const row=await database().prepare('SELECT COUNT(*) n FROM records WHERE owner=? AND kind=? AND parent_id=?').bind(owner,kind,c.id).first<{n:number}>();if((row?.n??0)>=limit)throw new ApiError(409,'출처 연결 기록 한도에 도달했습니다.')}
function append(owner:string,kind:string,id:string,value:unknown,c:Campaign,at:string){return database().prepare('INSERT INTO records(id,owner,kind,parent_id,data,updated_at) VALUES(?,?,?,?,?,?)').bind(`${owner}:${kind}:${id}`,owner,kind,c.id,JSON.stringify(value),at)}
function safeTitle(s:ArchiveSource){try{return signalSourceText(s.title,200)}catch{return '검토가 필요한 자료'}}
export async function growthSignalSourceView(who:Actor,c:Campaign){
 const rows=await database().prepare('SELECT data FROM records WHERE owner=? AND kind=? AND parent_id=? LIMIT 501').bind(who.owner,'brand_source',c.brandId).all<{data:string}>();
 if(rows.results.length>500)throw new ApiError(409,'브랜드 자료 조회 한도를 넘었습니다.');
 const sources=rows.results.map(x=>JSON.parse(x.data) as ArchiveSource).filter(s=>s.brandId===c.brandId&&(!s.storeId||s.storeId===c.storeId)&&s.category==='market');
 const candidates=await Promise.all(sources.map(async s=>{
  const sourceId=executionId(s.id),r=s.origin==='research'&&s.researchId?await optional<BrandResearch>(who.owner,'brand_research',s.researchId):null,assessment=assessSignalSource(c,s,r,'9999-12-31');
  const id=await signalId(c,s.id,s.version),imported=await optional<GrowthRecord<SignalInput>>(who.owner,'growth_signal',id);
  return {sourceId,sourceVersion:s.version,title:safeTitle(s),sourceUrl:assessment.input?.sourceUrl??null,observedAt:assessment.input?.observedAt??null,status:assessment.status,reasons:assessment.reasons,signalPreview:assessment.input?{summary:assessment.input.summary,sourceType:'market' as const,sampleSize:null}:null,importedSignalId:imported?.id??null};
 }));
 return {campaignId:c.id,campaignVersion:c.version,candidates,canImport:who.role!=='member'&&c.status!=='archived',mayCollect:false as const,mayExecute:false as const};
}
export type GrowthSignalSourceView=Awaited<ReturnType<typeof growthSignalSourceView>>;
export type SourceReadiness={status:'current'|'held';reasons:string[]};
export async function liveSignalSource(owner:string,c:Campaign,signal:GrowthRecord<SignalInput>):Promise<SourceReadiness|null>{
 const p=signal.sourceProvenance;if(!p)return null;
 try{
  const {s,r}=await sourceContext(owner,p.sourceId);
  if(!s||s.id!==p.sourceId||s.version!==p.sourceVersion)return {status:'held',reasons:['원본 자료가 변경되거나 없어져 다시 가져와야 합니다.']};
  const result=assessSignalSource(c,s,r,signal.input.expiresAt);
  if(result.status!=='ready'||await storefrontDigest(signalSourceBasis(s,r))!==p.sourceDigest||await storefrontDigest(result.input)!==await storefrontDigest(signal.input))return {status:'held',reasons:['원본 자료·조사 근거·범위·유효기한을 다시 검토하세요.']};
  return {status:'current',reasons:[]};
 }catch{return {status:'held',reasons:['원본 자료의 현재 근거를 확인할 수 없습니다.']}}
}
export async function importGrowthSignalSource(who:Actor,c:Campaign,b:Record<string,unknown>){
 if(c.status==='archived')throw new ApiError(409,'보관한 캠페인에는 자료를 가져올 수 없습니다.');
 if(b.campaignVersion!==c.version)throw new ApiError(409,'캠페인이 변경되었습니다. 다시 불러오세요.');
 const sourceId=executionId(b.sourceId),version=b.sourceVersion,requestId=String(b.requestId??'');
 if(!Number.isSafeInteger(version)||Number(version)<1||!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)||typeof b.expiresAt!=='string')throw new ApiError(400,'출처 판·요청 번호·유효기한을 확인하세요.');
 const digest=await storefrontDigest({sourceId,sourceVersion:version,campaignId:c.id,campaignVersion:c.version,expiresAt:b.expiresAt}),request=await optional<{digest:string;signalId:string;campaignId:string}>(who.owner,requestKind,requestId);
 const ack=(id:string,duplicate:boolean)=>({imported:true as const,signalId:id,duplicate,mayCollect:false as const,mayExecute:false as const});
 if(request){if(request.digest!==digest||request.campaignId!==c.id)throw new ApiError(409,'같은 요청 번호의 내용이 다릅니다.');return ack(request.signalId,true)}
 const id=await signalId(c,sourceId,Number(version)),old=await optional<GrowthRecord<SignalInput>>(who.owner,'growth_signal',id);
 await capacity(who.owner,requestKind,c,5000);
 if(old){if(old.campaignId!==c.id||old.brandId!==c.brandId||old.sourceProvenance?.sourceId!==sourceId||old.sourceProvenance.sourceVersion!==version||old.input.expiresAt!==b.expiresAt)throw new ApiError(409,'이미 가져온 자료 판의 내용·기한이 다릅니다.');await database().batch([append(who.owner,requestKind,requestId,{digest,signalId:id,campaignId:c.id},c,stamp())]);return ack(id,true)}
 const {s,r}=await sourceContext(who.owner,sourceId);
 if(!s||s.id!==sourceId||s.brandId!==c.brandId||(s.storeId!==undefined&&s.storeId!==c.storeId))throw new ApiError(404,'현재 브랜드·지점의 자료가 아닙니다.');
 if(s.version!==version)throw new ApiError(409,'원본 자료가 변경되었습니다. 다시 불러오세요.');
 const result=assessSignalSource(c,s,r,b.expiresAt);if(!result.input)throw new ApiError(409,result.reasons.join(' '));
 if(signalEvidence(result.input,Date.now()).status!=='usable')throw new ApiError(409,'유효한 기한을 입력하세요.');
 await capacity(who.owner,'growth_signal',c,500);await capacity(who.owner,'growth_history',c,10000);
 const at=stamp(),provenance:SignalSourceProvenance={sourceId,sourceVersion:Number(version),sourceDigest:await storefrontDigest(signalSourceBasis(s,r)),researchId:s.researchId??null,importedAt:at},record:GrowthRecord<SignalInput>={id,campaignId:c.id,brandId:c.brandId,campaignVersion:c.version,version:1,input:result.input,sourceProvenance:provenance,updatedAt:at,updatedBy:who.id,requestDigest:digest};
 await database().batch([recordStatement(who.owner,'growth_signal',id,record,c.id),append(who.owner,'growth_history',`signal:${id}:1`,{...record,entity:'signal'},c,at),append(who.owner,requestKind,requestId,{digest,signalId:id,campaignId:c.id},c,at)]);
 return ack(id,false);
}
