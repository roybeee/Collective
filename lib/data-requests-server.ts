import {ApiError,database,listRecords,readRecord,recordStatement,stamp,str,type Actor} from './server';
import type {Artifact,Brand,Campaign} from './agency';
import type {Store} from './store-marketing';
import type {BrandFact} from './brand-facts';
import {artifactUsable} from './role-output';
import {isEnabled} from './feature-flags';
import {factLabel} from './fact-catalog';
import {PLACE_PLATFORMS,type PlaceSnapshot} from './place-check';
import {placeTasksAfterFact} from './place-check-server';
import {closedByFact,closingFact,draftFor,extractCopyPackNeeds,extractMarkers,factKeyOfFact,planCollect,requestSeed,sortRequests,DATA_REQUEST_LIMITS,type DataRequest,type DataRequestActor,type DataRequestOrigin,type ExtractedNeed,type PlannedNeed} from './data-requests';

// 자료 요청(A6-1) 저장. records kind data_request(parent = 브랜드 id, 캠페인 요청은 data.campaignId로 캠페인과 함께 지운다).
// 스위치 a6_data_requests(기본 꺼짐, 소유자 단위)는 이 파일에서만 읽고, 읽기 실패는 꺼짐으로 본다. 꺼져 있으면 쓰기는 409이고 사실 저장 응답은 바이트 동일하다(afterFactSaved가 {}).
// 권한: 직원은 collect·create·조회만, 수동 닫기(answered)·dismiss·reconcile은 대표·관리자. 호출자(app/api/data-requests/route.ts)가 소유자 변경 잠금을 가진다.
export type DataRequestAction='collect'|'create'|'close'|'dismiss'|'reconcile';
const ACTIONS:readonly string[]=['collect','create','close','dismiss','reconcile'];
const ADMIN_ACTIONS:readonly string[]=['close','dismiss','reconcile'];
export const DATA_REQUEST_MESSAGES={
 off:'자료 요청 기능이 꺼져 있습니다. 소유자가 기능 스위치 a6_data_requests를 켜야 합니다.',
 adminOnly:'자료 요청 닫기·필요 없음 처리·다시 대조는 대표·관리자만 할 수 있습니다.',
 stale:'자료 요청이 그사이 바뀌었습니다. 새로고침한 뒤 다시 시도하세요.',
 notOpen:'이미 닫힌 자료 요청입니다.',
 duplicate:'같은 항목의 자료 요청이 이미 열려 있습니다.',
 cap:`캠페인의 열린 자료 요청은 ${DATA_REQUEST_LIMITS.openPerCampaign}건까지입니다. 먼저 닫거나 필요 없음으로 처리하세요.`,
} as const;

export async function dataRequestsOn(owner:string){
 return isEnabled(owner,'a6_data_requests').catch(()=>{console.error('a6_data_requests_flag_unreadable');return false});
}
const actorOf=(who:Pick<Actor,'id'|'role'>):DataRequestActor=>({id:who.id,role:who.role});
const hex=async(text:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)))).map(x=>x.toString(16).padStart(2,'0')).join('');
export const dataRequestId=async(seed:string)=>'dr-'+(await hex(seed)).slice(0,12);
const brandRequests=(owner:string,brandId:string)=>listRecords<DataRequest>(owner,'data_request',brandId);
const brandFacts=(owner:string,brandId:string)=>listRecords<BrandFact>(owner,'brand_fact',brandId);
const write=(owner:string,rows:DataRequest[])=>rows.length?database().batch(rows.map(r=>recordStatement(owner,'data_request',r.id,r,r.brandId))):Promise.resolve([]);

// 조회: 캠페인(campaignId) 또는 브랜드(brandId) 범위. 스위치와 무관하게 읽는다(enabled로 상태를 알린다).
export async function listDataRequests(owner:string,{campaignId,brandId}:{campaignId?:string;brandId?:string}){
 let rows:DataRequest[];
 if(campaignId){const c=await readRecord<Campaign>(owner,'campaign',campaignId);rows=(await brandRequests(owner,c.brandId)).filter(r=>r.campaignId===campaignId)}
 else if(brandId){await readRecord<Brand>(owner,'brand',brandId);rows=await brandRequests(owner,brandId)}
 else throw new ApiError(400,'캠페인이나 브랜드를 지정하세요.');
 return {enabled:await dataRequestsOn(owner),requests:sortRequests(rows)};
}

// 작업물 한 개의 출처 붙은 요청 목록. 지금 브리프 판에서 쓸 수 있는 작업물(artifactUsable)만 읽는다(outdated·재질문·옛 브리프 제외).
function artifactNeeds(a:Artifact):{need:ExtractedNeed;origin:DataRequestOrigin}[]{
 const markers=extractMarkers(a.content).map(need=>({need,origin:{kind:'artifact_marker' as const,artifactId:a.id,artifactVersion:a.version,role:a.role,excerpt:need.excerpt}}));
 const pack=extractCopyPackNeeds(a as Artifact&{copyPack?:unknown;copyPackArtifactVersion?:unknown}).map(need=>({need,origin:{kind:'copy_pack' as const,artifactId:a.id,artifactVersion:a.version,channel:need.channel??'',variantId:need.variantId??''}}));
 return [...markers,...pack];
}
async function collect(owner:string,input:Record<string,unknown>,who:DataRequestActor){
 const campaignId=str(input.campaignId,'캠페인',100,true),c=await readRecord<Campaign>(owner,'campaign',campaignId);
 const scope={brandId:c.brandId,...(c.storeId?{storeId:c.storeId}:{}),campaignId};
 const artifacts=(await listRecords<Artifact>(owner,'artifact',campaignId)).filter(a=>artifactUsable(a,c.version));
 const needs:PlannedNeed[]=await Promise.all(artifacts.flatMap(artifactNeeds).map(async({need,origin})=>{const draft=draftFor(need,scope);return {id:await dataRequestId(requestSeed(campaignId,draft.storeId,draft.factKey,need.item)),draft,origins:[origin]}}));
 const existing=(await brandRequests(owner,c.brandId)).filter(r=>r.campaignId===campaignId);
 const plan=planCollect({existing,needs,facts:await brandFacts(owner,c.brandId),by:who,now:stamp()});
 await write(owner,plan.writes);
 const after=new Map([...existing,...plan.writes].map(r=>[r.id,r] as const));
 return {artifacts:artifacts.length,created:plan.created,merged:plan.merged,skipped:plan.skipped,requests:sortRequests([...after.values()])};
}

const withoutResolution=({resolution,...rest}:DataRequest)=>{void resolution;return rest};
// 수동 요청. 캠페인을 주면 캠페인의 브랜드·지점 범위, 아니면 브랜드(와 선택 지점) 범위다. 같은 id가 열려 있으면 409, 닫혀 있으면 다시 연다.
async function create(owner:string,input:Record<string,unknown>,who:DataRequestActor){
 const item=str(input.text,'요청 항목',120,true),assignee=str(input.assignee??'','확인 담당',40);
 const campaignId=str(input.campaignId??'','캠페인',100);
 let scope:{brandId:string;storeId?:string;campaignId?:string};
 if(campaignId){const c=await readRecord<Campaign>(owner,'campaign',campaignId);scope={brandId:c.brandId,...(c.storeId?{storeId:c.storeId}:{}),campaignId}}
 else{
  const brandId=str(input.brandId,'브랜드',100,true),storeId=str(input.storeId??'','지점',100)||undefined;
  await readRecord<Brand>(owner,'brand',brandId);
  if(storeId&&(await readRecord<Store>(owner,'store',storeId)).brandId!==brandId)throw new ApiError(404,'해당 브랜드의 지점이 아닙니다.');
  scope={brandId,...(storeId?{storeId}:{})};
 }
 const draft=draftFor({item,text:item,...(assignee?{assignee}:{})},scope),id=await dataRequestId(requestSeed(campaignId,draft.storeId,draft.factKey,item));
 const rows=await brandRequests(owner,scope.brandId),old=rows.find(r=>r.id===id),now=stamp();
 if(old?.status==='open')throw new ApiError(409,DATA_REQUEST_MESSAGES.duplicate);
 if(campaignId&&rows.filter(r=>r.campaignId===campaignId&&r.status==='open').length>=DATA_REQUEST_LIMITS.openPerCampaign)throw new ApiError(409,DATA_REQUEST_MESSAGES.cap);
 const row:DataRequest=old?{...withoutResolution(old),...draft,status:'open',version:old.version+1,updatedAt:now}:{id,...draft,status:'open',origins:[],createdBy:who,createdAt:now,version:1,updatedAt:now};
 await write(owner,[row]);
 return {request:row};
}

// 수동 닫기(answered)·필요 없음(dismissed). version 비교(CAS)로 409를 낸다.
async function resolveManually(owner:string,input:Record<string,unknown>,who:DataRequestActor,kind:'answered'|'dismissed'){
 const id=str(input.id,'자료 요청',40,true),note=str(input.note??'','메모',DATA_REQUEST_LIMITS.note);
 const old=await readRecord<DataRequest>(owner,'data_request',id);
 if(!Number.isInteger(input.version)||input.version!==old.version)throw new ApiError(409,DATA_REQUEST_MESSAGES.stale);
 if(old.status!=='open')throw new ApiError(409,DATA_REQUEST_MESSAGES.notOpen);
 const now=stamp(),row:DataRequest={...old,status:'closed',resolution:{kind,note,by:who,at:now},version:old.version+1,updatedAt:now};
 await write(owner,[row]);
 return {request:row};
}

// 열린 요청을 지금 유효한 사실과 대조해 닫는다(멱등, 브랜드 전체). factKey를 주면 그 항목만 본다. 사실 저장과 닫기는 원자적이지 않아서, 저장 뒤 닫기가 실패하면 이것으로 다시 닫는다.
export async function reconcileBrand(owner:string,brandId:string,by:DataRequestActor,factKey?:string){
 const open=(await brandRequests(owner,brandId)).filter(r=>r.status==='open'&&!!r.factKey&&(!factKey||r.factKey===factKey));
 if(!open.length)return [] as DataRequest[];
 const facts=await brandFacts(owner,brandId),now=stamp();
 const closed=open.flatMap(r=>{const f=closingFact(r,facts,Date.parse(now));return f?[closedByFact(r,f,by,now)]:[]});
 await write(owner,closed);
 return closed;
}
async function reconcile(owner:string,input:Record<string,unknown>,who:DataRequestActor){
 const campaignId=str(input.campaignId??'','캠페인',100);
 const brandId=campaignId?(await readRecord<Campaign>(owner,'campaign',campaignId)).brandId:str(input.brandId,'브랜드',100,true);
 if(!campaignId)await readRecord<Brand>(owner,'brand',brandId);
 const closed=await reconcileBrand(owner,brandId,who);
 return {closed:closed.length,ids:closed.map(r=>r.id)};
}

export async function dataRequestAction(owner:string,input:Record<string,unknown>,who:Pick<Actor,'id'|'role'>){
 const action=String(input.action);
 if(!ACTIONS.includes(action))throw new ApiError(400,'지원하지 않는 작업입니다.');
 if(ADMIN_ACTIONS.includes(action)&&who.role!=='owner'&&who.role!=='admin')throw new ApiError(403,DATA_REQUEST_MESSAGES.adminOnly);
 if(!await dataRequestsOn(owner))throw new ApiError(409,DATA_REQUEST_MESSAGES.off);
 const by=actorOf(who);
 switch(action as DataRequestAction){
  case 'collect':return collect(owner,input,by);
  case 'create':return create(owner,input,by);
  case 'close':return resolveManually(owner,input,by,'answered');
  case 'dismiss':return resolveManually(owner,input,by,'dismissed');
  case 'reconcile':return reconcile(owner,input,by);
 }
}

// /api/brand-facts save_fact 저장 뒤에 부른다. 스위치가 꺼져 있으면 {}(응답 바이트 동일), 켜져 있으면 {closedRequests: 닫은 수},
// 닫기가 실패하면 사실 저장은 유지하고 {closedRequests:null}이다(reconcile로 다시 닫는다). 확정 사실이 아니면 닫을 것이 없다(0).
// A6-2: 이어서 플레이스 스냅샷을 다시 대조해 할 일을 닫는다(lib/place-check-server.ts, 스위치 a6_place_check). 두 스위치가 모두 꺼져 있으면 {}다.
export async function afterFactSaved(owner:string,fact:Pick<BrandFact,'id'|'version'|'brandId'|'storeId'|'key'|'status'>,who:Pick<Actor,'id'|'role'>):Promise<{closedRequests?:number|null;closedPlaceTasks?:number|null}>{
 return {...await closeRequestsAfterFact(owner,fact,who),...await placeTasksAfterFact(owner,fact)};
}
async function closeRequestsAfterFact(owner:string,fact:Pick<BrandFact,'brandId'|'key'|'status'>,who:Pick<Actor,'id'|'role'>):Promise<{closedRequests?:number|null}>{
 if(!await dataRequestsOn(owner))return {};
 if(fact.status!=='confirmed')return {closedRequests:0};
 try{return {closedRequests:(await reconcileBrand(owner,fact.brandId,actorOf(who),factKeyOfFact(fact.key))).length}}
 catch{console.error('data_request_close_failed');return {closedRequests:null}}
}

// 플레이스 대조(A6-2)의 fact_missing(플레이스 값은 있는데 확정 사실 없음)을 지점 자료 요청(origin place_check, 캠페인 없음)으로 모은다. 할 일은 만들지 않는다.
// 스위치 a6_data_requests가 꺼져 있으면 {}(응답에 키 없음), 켜져 있으면 {dataRequests: 새 요청 수}, 실패하면 스냅샷 저장은 유지하고 {dataRequests:null}이다.
// id는 수동 지점 요청과 같은 씨앗(|지점|항목)이라 같은 항목이 열려 있으면 출처만 합친다. 닫힌 요청은 다시 열지 않는다(planCollect).
export async function placeCheckRequests(owner:string,snapshot:PlaceSnapshot,who:Pick<Actor,'id'|'role'>):Promise<{dataRequests?:number|null}>{
 if(!await dataRequestsOn(owner))return {};
 try{
  const scope={brandId:snapshot.brandId,storeId:snapshot.storeId},platform=PLACE_PLATFORMS[snapshot.platform].label;
  const needs:PlannedNeed[]=await Promise.all(snapshot.result.filter(r=>r.state==='fact_missing').map(async r=>{
   const item=factLabel(r.field),draft=draftFor({item,text:`${platform} ${item}: ${snapshot.fields[r.field]} (확정 사실 없음)`.slice(0,DATA_REQUEST_LIMITS.text)},scope);
   return {id:await dataRequestId(requestSeed('',draft.storeId,draft.factKey,item)),draft,origins:[{kind:'place_check' as const,snapshotId:snapshot.id,snapshotVersion:snapshot.version,platform:snapshot.platform,field:r.field}]};
  }));
  if(!needs.length)return {dataRequests:0};
  const existing=(await brandRequests(owner,snapshot.brandId)).filter(r=>!r.campaignId&&r.storeId===snapshot.storeId);
  const plan=planCollect({existing,needs,facts:await brandFacts(owner,snapshot.brandId),by:actorOf(who),now:stamp()});
  await write(owner,plan.writes);
  return {dataRequests:plan.created};
 }catch{console.error('place_check_request_failed');return {dataRequests:null}}
}
