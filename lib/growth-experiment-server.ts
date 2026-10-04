import type {ExperimentIngestState} from './growth-experiment-events-server';
import type {Campaign} from './agency';
import type {ExperimentArm} from './meta-experiment';
import {growthView} from './growth-workspace-server';
import {analyseExperiment,assignUnit,parseExperimentDesign,parseUnitKey,GrowthExperimentError,type ExperimentDesignInput,type GrowthExperimentAnalysis} from './growth-experiment';
import type {StorefrontOrderLink} from './storefront-orders';
import {storefrontDigest} from './storefront-orders';
import {ApiError,database,readRecord,recordStatement,stamp,str,type Actor} from './server';
const kinds={design:'growth_experiment',history:'growth_experiment_history',unit:'growth_experiment_unit',result:'growth_experiment_result',request:'growth_experiment_request'} as const;
export type GrowthExperimentRecord={id:string;brandId:string;campaignId:string;storeId:string;version:number;status:'draft'|'registered'|'cancelled';input:ExperimentDesignInput;seed:string;registration:{digest:string;at:string;by:string;refs:{kind:string;id:string;version:number}[]}|null;createdAt:string;updatedAt:string;updatedBy:string};
export type GrowthExperimentUnit={id:string;designId:string;campaignId:string;brandId:string;unitHash:string;arm:ExperimentArm;assignedAt:string;version:number;ingest?:ExperimentIngestState;observation:{exposed:boolean;trackingComplete:boolean;contaminated:boolean;orderIds:string[];evidenceRef:string;recordedAt:string;recordedBy:string}|null};
export type GrowthExperimentResult={id:string;designId:string;campaignId:string;brandId:string;analysisNumber:number;designDigest:string;inputDigest:string;analysis:GrowthExperimentAnalysis;lineage:{unitHash:string;version:number;source?:'signed_storefront'|'operator';orders:{id:string;version:number}[]}[];recordedAt:string;recordedBy:string};
type Order={id:string;storeId:string;campaignId?:string;orderDate:string;status:string;paidAmount:number;refundAmount:number;costs:Record<string,number|null>;version:number};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
async function optional<T>(owner:string,kind:string,id:string){try{return await readRecord<T>(owner,kind,id)}catch(e){if(e instanceof ApiError&&e.status===404)return null;throw e}}
const scoped=(x:{brandId:string;campaignId:string},c:Campaign)=>x.brandId===c.brandId&&x.campaignId===c.id;
async function rows<T>(owner:string,c:Campaign,kind:string,limit:number,extra='',...binds:unknown[]){const r=await database().prepare(`SELECT data FROM records WHERE owner=? AND kind=? AND parent_id=?${extra} LIMIT ?`).bind(owner,kind,c.id,...binds,limit+1).all<{data:string}>();if(r.results.length>limit)throw new ApiError(409,'실험 기록 조회 한도를 넘었습니다.');return r.results.map(x=>JSON.parse(x.data) as T)}
async function capacity(owner:string,c:Campaign,kind:string,limit:number,extra='',...binds:unknown[]){const r=await database().prepare(`SELECT COUNT(*) n FROM records WHERE owner=? AND kind=? AND parent_id=?${extra}`).bind(owner,kind,c.id,...binds).first<{n:number}>();if((r?.n??0)>=limit)throw new ApiError(409,'실험 기록 보관 한도에 도달했습니다.');return r?.n??0}
function append(owner:string,c:Campaign,kind:string,id:string,value:unknown,at:string){return database().prepare('INSERT INTO records(id,owner,kind,parent_id,data,updated_at) VALUES(?,?,?,?,?,?)').bind(`${owner}:${kind}:${id}`,owner,kind,c.id,JSON.stringify(value),at)}
const units=(owner:string,c:Campaign,designId:string)=>rows<GrowthExperimentUnit>(owner,c,kinds.unit,5000," AND json_extract(data,'$.designId')=?",designId);
const unitId=(designId:string,hash:string)=>`${designId}:${hash.slice(0,40)}`;
const publicDesign=({seed:_seed,...rest}:GrowthExperimentRecord)=>{void _seed;return rest};
export const orderValue=(o:Order)=>({net:o.paidAmount-o.refundAmount,contribution:Object.values(o.costs??{}).some(v=>v===null)||!o.costs?null:o.paidAmount-o.refundAmount-Object.values(o.costs).reduce<number>((n,v)=>n+(v??0),0)});
function unitValue(d:ExperimentDesignInput,orders:Order[]){
 if(d.metric==='paid_orders')return orders.some(o=>o.status!=='cancelled'&&orderValue(o).net>0)?1:0;
 if(d.metric==='net_revenue_per_unit')return orders.reduce((n,o)=>n+orderValue(o).net,0);
 const values=orders.map(o=>orderValue(o).contribution);return values.some(v=>v===null)?null:(values as number[]).reduce((n,v)=>n+v,0);
}
async function computeAnalysis(owner:string,c:Campaign,e:GrowthExperimentRecord,analysisNumber:number,now=Date.now()){
 const list=await units(owner,c,e.id),orderIds=[...new Set(list.flatMap(u=>u.observation?.orderIds??[]))],orders=new Map<string,Order|null>();
 for(const id of orderIds)orders.set(id,await optional<Order>(owner,'store_order',id));
 const canonical=await Promise.all(list.map(async u=>{
  const links=u.ingest?await Promise.all(u.ingest.orderLinks.map(ref=>optional<StorefrontOrderLink>(owner,'storefront_order_link',ref.id))):[];
  const os=(u.observation?.orderIds??[]).map(id=>orders.get(id)).filter((o):o is Order=>!!o&&o.storeId===e.storeId&&(!o.campaignId||o.campaignId===c.id)&&o.orderDate>=e.input.startAt.slice(0,10)&&o.orderDate<=e.input.endAt.slice(0,10));
  const valid=!u.ingest||os.every(o=>links.some(l=>l&&l.orderId===o.id&&l.orderVersion===o.version&&l.brandId===c.brandId&&l.storeId===e.storeId&&l.sourceKey===u.ingest!.sourceKey));
  return {os,valid,links:links.map(l=>l?{id:l.id,orderId:l.orderId,orderVersion:l.orderVersion,revision:l.revision,brandId:l.brandId,storeId:l.storeId,sourceKey:l.sourceKey}:null)};
 }));
 const analysisUnits=list.map((u,i)=>{const {os,valid}=canonical[i],missing=(u.observation?.orderIds.length??0)!==os.length;return {arm:u.arm,exposed:!!u.observation?.exposed,trackingComplete:!!u.observation?.trackingComplete&&!missing&&valid,contaminated:!!u.observation?.contaminated,value:u.observation?unitValue(e.input,os):null}});
 const analysis=analyseExperiment(e.input,analysisUnits,now,analysisNumber);
 const lineage=list.map(u=>({unitHash:u.unitHash,version:u.version,source:u.ingest?'signed_storefront' as const:'operator' as const,orders:(u.observation?.orderIds??[]).map(id=>({id,version:orders.get(id)?.version??0}))}));
 return {analysis,lineage,inputDigest:await storefrontDigest({lineage,canonicalLinks:canonical.map(x=>({valid:x.valid,links:x.links})),orders:[...orders.entries()].map(([id,o])=>[id,o?{paid:o.paidAmount,refund:o.refundAmount,costs:o.costs,status:o.status,version:o.version}:null])})};
}
export async function growthExperimentView(who:Actor,c:Campaign){
 const [designs,results]=await Promise.all([rows<GrowthExperimentRecord>(who.owner,c,kinds.design,200),rows<GrowthExperimentResult>(who.owner,c,kinds.result,2000)]);
 const own=designs.filter(d=>scoped(d,c));
 const experiments=await Promise.all(own.map(async e=>{
  const list=e.status==='registered'?await units(who.owner,c,e.id):[],mine=results.filter(r=>r.designId===e.id&&scoped(r,c)).sort((a,b)=>a.analysisNumber-b.analysisNumber);
  const preview=e.status==='registered'?(await computeAnalysis(who.owner,c,e,mine.length+1)).analysis:null;
  return {...publicDesign(e),units:{control:list.filter(u=>u.arm==='control').length,treatment:list.filter(u=>u.arm==='treatment').length,observed:list.filter(u=>u.observation).length,signed:list.filter(u=>u.ingest).length,manual:list.filter(u=>!u.ingest).length},unitRows:list.slice(0,500).map(u=>({unitHash:u.unitHash,arm:u.arm,version:u.version,observed:!!u.observation,source:u.ingest?'signed_storefront' as const:'operator' as const,orders:u.observation?.orderIds.length??0})),preview:preview?{status:preview.status,reasons:preview.reasons,analysed:preview.analysed,excluded:preview.excluded,srm:preview.srm}:null,results:mine,latest:mine.at(-1)??null};
 }));
 return {campaignId:c.id,campaignVersion:c.version,experiments,canEdit:who.role!=='member'&&c.status!=='archived',mayExecute:false as const,mayScale:false as const};
}
export type GrowthExperimentView=Awaited<ReturnType<typeof growthExperimentView>>;
/** Read-only canonical basis for collecting lesson observations; never starts an analysis or promotes a method. */
export async function readExperimentOutcomeBasis(owner:string,c:Campaign,id:string,now=Date.now()){
 const e=await optional<GrowthExperimentRecord>(owner,kinds.design,id);
 if(!e||!scoped(e,c)||e.storeId!==c.storeId||e.status!=='registered'||!e.registration)throw new ApiError(409,'현재 등록 실험이 아닙니다.');
 if(e.registration.digest!==await storefrontDigest({id:e.id,input:e.input}))throw new ApiError(409,'등록 실험 근거가 바뀌었습니다.');
 if(await storefrontDigest(e.registration.refs)!==await storefrontDigest(e.input.interventionRefs))throw new ApiError(409,'등록 개입 근거가 바뀌었습니다.');
 await checkExperimentRefs(owner,c,e.input);
 const view=await growthView(owner,c,true),mission=view.missions.find(x=>x.id===e.input.missionId),offer=view.offers.find(x=>x.id===e.input.offerId),catalog=view.catalogs.find(x=>x.id===offer?.input.catalogId);
 if(!mission||!offer||!catalog||[mission,offer,catalog].some(x=>x.campaignVersion!==c.version)||!catalog.input.validUntil||Date.parse(catalog.input.validUntil+'T23:59:59Z')<now||catalog.factRefs?.some(ref=>!view.facts.some(f=>f.id===ref.id&&f.version===ref.version)))throw new ApiError(409,'실험 상품·캠페인·확정 사실 근거를 재검토하세요.');
 const results=(await rows<GrowthExperimentResult>(owner,c,kinds.result,2000)).filter(r=>scoped(r,c)&&r.designId===id).sort((a,b)=>a.analysisNumber-b.analysisNumber);
 const latest=results.at(-1)??null,current=await computeAnalysis(owner,c,e,latest?.analysisNumber??1,now);
 return {registrationDigest:e.registration.digest,inputDigest:current.inputDigest,latest:latest?{id:latest.id,number:latest.analysisNumber,digest:await storefrontDigest(latest),status:latest.analysis.status}:null,
  current:!!latest&&latest.designDigest===e.registration.digest&&latest.inputDigest===current.inputDigest&&latest.analysis.status===current.analysis.status};
}
export async function checkExperimentRefs(owner:string,c:Campaign,d:ExperimentDesignInput){
 const view=await growthView(owner,c,true),mission=view.missions.find(m=>m.id===d.missionId),offer=view.offers.find(o=>o.id===d.offerId);
 if(!mission||mission.version!==d.missionVersion)throw new ApiError(409,'현재 판의 판매 미션을 연결하세요.');
 if(!offer||offer.version!==d.offerVersion||mission.input.offerId!==d.offerId||mission.input.offerVersion!==d.offerVersion)throw new ApiError(409,'미션에 연결된 현재 판의 오퍼를 선택하세요.');
 const catalog=view.catalogs.find(x=>x.id===offer.input.catalogId);if(!catalog||catalog.version!==offer.input.catalogVersion)throw new ApiError(409,'오퍼에 연결된 상품의 최신 판을 확인하세요.');
 if(mission.input.channel!==d.channel)throw new ApiError(409,'실험 채널은 미션 채널과 같아야 합니다.');
 const kindOf={landing_revision:'growth_landing_revision',demand_step:'growth_demand',publication_link:'growth_publication_link',offer:'growth_offer',manual:''} as const;
 for(const r of d.interventionRefs){if(r.kind==='manual')continue;const x=await optional<{brandId:string;campaignId:string;version:number}>(owner,kindOf[r.kind],r.id);if(!x||!scoped(x,c)||x.version!==r.version)throw new ApiError(409,`개입 근거 ${r.kind}:${r.id}의 현재 판을 확인하세요.`)}
 if(d.mode==='confirm'&&!d.interventionRefs.length&&!d.aa)throw new ApiError(409,'확증 실험은 고정한 개입 근거가 필요합니다.');
}
export async function saveGrowthExperiment(who:Actor,c:Campaign,b:Record<string,unknown>){
 if(b.campaignVersion!==c.version)throw new ApiError(409,'캠페인이 변경되었습니다. 다시 불러오세요.');
 const requestId=String(b.requestId??''),action=String(b.action??'');if(!uuid.test(requestId))throw new ApiError(400,'요청 번호를 확인하세요.');
 const id=str(b.id,'실험 ID',100,true);if(!/^[A-Za-z0-9_-]+$/.test(id))throw new ApiError(400,'실험 ID 형식을 확인하세요.');
 const input=action==='save_design'?parseExperimentDesign(b.input):null;
 const digest=await storefrontDigest({action,id,campaignId:c.id,campaignVersion:c.version,input,expectedVersion:b.expectedVersion,units:b.units,observation:b.observation});
 const request=await optional<{digest:string;response:unknown}>(who.owner,kinds.request,requestId);
 if(request){if(request.digest!==digest)throw new ApiError(409,'같은 요청 번호의 내용이 다릅니다.');return {...(request.response as object),duplicate:true}}
 const old=await optional<GrowthExperimentRecord>(who.owner,kinds.design,id);if(old&&!scoped(old,c))throw new ApiError(404,'다른 캠페인의 실험입니다.');
 const at=stamp(),now=Date.now(),writes:D1PreparedStatement[]=[];let response:Record<string,unknown>;
 const cas=()=>{if(!Number.isSafeInteger(b.expectedVersion)||b.expectedVersion!==(old?.version??0))throw new ApiError(409,'실험 설계가 변경되었습니다. 입력을 보존하고 다시 불러오세요.')};
 if(action==='save_design'){
  cas();if(c.status==='archived')throw new ApiError(409,'보관한 캠페인에는 실험을 만들 수 없습니다.');if(old&&old.status!=='draft')throw new ApiError(409,'등록한 실험 설계는 바꿀 수 없습니다. 새 실험으로 등록하세요.');
  if(!old)await capacity(who.owner,c,kinds.design,200);
  const seed=old?.seed??[...crypto.getRandomValues(new Uint8Array(32))].map(x=>x.toString(16).padStart(2,'0')).join('');
  const next:GrowthExperimentRecord={id,brandId:c.brandId,campaignId:c.id,storeId:c.storeId??'',version:(old?.version??0)+1,status:'draft',input:input!,seed,registration:null,createdAt:old?.createdAt??at,updatedAt:at,updatedBy:who.id};
  writes.push(recordStatement(who.owner,kinds.design,id,next,c.id),append(who.owner,c,kinds.history,`${id}:${next.version}`,publicDesign(next),at));response={recorded:true,id,version:next.version};
 }else if(action==='register'||action==='cancel'){
  cas();if(!old)throw new ApiError(404,'실험을 찾지 못했습니다.');
  if(action==='register'){
   if(old.status!=='draft')throw new ApiError(409,'초안만 등록할 수 있습니다.');if(!c.storeId)throw new ApiError(409,'지점이 있는 캠페인에서만 판매 실험을 등록합니다.');
   if(Date.parse(old.input.startAt)<=now)throw new ApiError(409,'사전등록은 시작 시각 전에 해야 합니다. 시작 시각을 미래로 바꾸세요.');
   await checkExperimentRefs(who.owner,c,old.input);
  }else if(old.status==='cancelled')throw new ApiError(409,'이미 취소한 실험입니다.');
  const next:GrowthExperimentRecord={...old,version:old.version+1,status:action==='register'?'registered':'cancelled',registration:action==='register'?{digest:await storefrontDigest({id,input:old.input}),at,by:who.id,refs:old.input.interventionRefs}:old.registration,updatedAt:at,updatedBy:who.id};
  writes.push(recordStatement(who.owner,kinds.design,id,next,c.id),append(who.owner,c,kinds.history,`${id}:${next.version}`,publicDesign(next),at));response={recorded:true,id,version:next.version};
 }else if(action==='assign_units'){
  if(!old||old.status!=='registered')throw new ApiError(409,'등록된 실험만 배정합니다.');
  if(now<Date.parse(old.input.startAt)||now>Date.parse(old.input.endAt))throw new ApiError(409,'관측 기간 안에서만 배정합니다.');
  if(!Array.isArray(b.units)||!b.units.length||b.units.length>500)throw new ApiError(400,'배정 단위는 1~500개 배열입니다.');
  let keys:string[];try{keys=[...new Set((b.units as unknown[]).map(parseUnitKey))]}catch(e){throw new ApiError(400,e instanceof Error?e.message:'배정 단위를 확인하세요.')}
  const count=await capacity(who.owner,c,kinds.unit,5000," AND json_extract(data,'$.designId')=?",id),assigned:{unitHash:string;arm:ExperimentArm;existing:boolean}[]=[];let added=0;
  for(const key of keys){const a=await assignUnit(old.seed,key,old.input.treatmentShare),uid=unitId(id,a.unitHash),existing=await optional<GrowthExperimentUnit>(who.owner,kinds.unit,uid);
   if(existing){if(existing.arm!==a.arm||existing.designId!==id)throw new ApiError(409,'기존 배정과 다른 군이 계산되었습니다. 배정을 점검하세요.');assigned.push({...a,existing:true});continue}
   if(count+ ++added>5000)throw new ApiError(409,'실험당 배정 단위는 5,000개까지입니다.');
   const u:GrowthExperimentUnit={id:uid,designId:id,campaignId:c.id,brandId:c.brandId,unitHash:a.unitHash,arm:a.arm,assignedAt:at,version:1,observation:null};writes.push(recordStatement(who.owner,kinds.unit,uid,u,c.id));assigned.push({...a,existing:false});}
  response={recorded:true,id,assigned:assigned.map(a=>({unitHash:a.unitHash,arm:a.arm,existing:a.existing}))};
 }else if(action==='record_observation'){
  if(!old||old.status!=='registered')throw new ApiError(409,'등록된 실험만 관측을 기록합니다.');
  if(now<Date.parse(old.input.startAt)||now>Date.parse(old.input.endAt)+old.input.maturityDays*86400000)throw new ApiError(409,'관측·성숙 기간 안에서만 기록합니다.');
  const o=b.observation as Record<string,unknown>|undefined;if(!o||typeof o!=='object')throw new ApiError(400,'관측 입력을 확인하세요.');
  const hash=String(o.unitHash??'');if(!/^[a-f0-9]{64}$/.test(hash))throw new ApiError(400,'배정 단위 해시를 확인하세요.');
  const unit=await optional<GrowthExperimentUnit>(who.owner,kinds.unit,unitId(id,hash));if(!unit||unit.unitHash!==hash||!scoped(unit,c))throw new ApiError(404,'배정된 단위가 아닙니다.');
  if(unit.ingest)throw new ApiError(409,'서명 수신 단위는 공급자 사건으로 갱신하세요. 수동 관측으로 덮어쓰지 않습니다.');
  if(b.expectedVersion!==unit.version)throw new ApiError(409,'단위 관측이 변경되었습니다. 다시 불러오세요.');
  for(const k of ['exposed','trackingComplete','contaminated'])if(typeof o[k]!=='boolean')throw new ApiError(400,'노출·추적·오염 여부를 선택하세요.');
  if(!Array.isArray(o.orderIds)||o.orderIds.length>20)throw new ApiError(400,'주문은 최대 20개입니다.');
  const orderIds=[...new Set((o.orderIds as unknown[]).map(x=>{if(typeof x!=='string'||!/^[A-Za-z0-9_-]{1,100}$/.test(x))throw new ApiError(400,'주문 ID 형식을 확인하세요.');return x}))];
  if(orderIds.length&&!o.exposed)throw new ApiError(409,'노출되지 않은 단위에는 주문을 연결하지 않습니다.');
  for(const oid of orderIds){const ord=await optional<Order>(who.owner,'store_order',oid);if(!ord||ord.storeId!==old.storeId)throw new ApiError(409,'현재 지점의 주문이 아닙니다.');const day=ord.orderDate;if(day<old.input.startAt.slice(0,10)||day>old.input.endAt.slice(0,10))throw new ApiError(409,'관측 기간 밖 주문입니다.')}
  const others=(await units(who.owner,c,id)).filter(u=>u.id!==unit.id);if(orderIds.some(x=>others.some(u=>u.observation?.orderIds.includes(x))))throw new ApiError(409,'이미 다른 단위에 연결된 주문입니다.');
  let evidenceRef:string;try{evidenceRef=String(o.evidenceRef??'');if(!/^[A-Za-z0-9_-]{1,100}$/.test(evidenceRef))throw 0}catch{throw new ApiError(400,'관측 근거 ID를 입력하세요.')}
  const next:GrowthExperimentUnit={...unit,version:unit.version+1,observation:{exposed:o.exposed as boolean,trackingComplete:o.trackingComplete as boolean,contaminated:o.contaminated as boolean,orderIds,evidenceRef,recordedAt:at,recordedBy:who.id}};
  writes.push(recordStatement(who.owner,kinds.unit,unit.id,next,c.id));response={recorded:true,id,unitVersion:next.version};
 }else if(action==='analyse'){
  if(!old||old.status!=='registered')throw new ApiError(409,'등록된 실험만 분석합니다.');
  const prior=await rows<GrowthExperimentResult>(who.owner,c,kinds.result,50," AND json_extract(data,'$.designId')=?",id);if(prior.length>=20)throw new ApiError(409,'실험당 분석은 20회까지입니다.');
  const n=prior.length+1,{analysis,lineage,inputDigest}=await computeAnalysis(who.owner,c,old,n,now);
  if(['registered','collecting','maturing'].includes(analysis.status))throw new ApiError(409,analysis.reasons[0]);
  if(prior.some(r=>r.inputDigest===inputDigest))throw new ApiError(409,'이전 분석과 같은 입력입니다. 관측이 바뀐 뒤 다시 분석하세요.');
  const result:GrowthExperimentResult={id:`${id}:${n}`,designId:id,campaignId:c.id,brandId:c.brandId,analysisNumber:n,designDigest:old.registration!.digest,inputDigest,analysis,lineage,recordedAt:at,recordedBy:who.id};
  writes.push(append(who.owner,c,kinds.result,result.id,result,at));response={recorded:true,id,analysisNumber:n,status:analysis.status};
 }else throw new ApiError(400,'지원하지 않는 실험 작업입니다.');
 await capacity(who.owner,c,kinds.request,20000);
 response={...response,mayExecute:false,mayScale:false,duplicate:false};
 writes.push(append(who.owner,c,kinds.request,requestId,{digest,response},at));await database().batch(writes);return response;
}
export {GrowthExperimentError};
