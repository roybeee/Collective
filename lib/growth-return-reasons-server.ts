import type {Campaign} from './agency';
import type {InventoryEvent} from './growth-inventory';
import {parseReturnReasonInput,type ReturnReasonInput} from './growth-return-reasons';
import {executionId} from './growth-execution';
import {storefrontDigest} from './storefront-orders';
import {ApiError,database,readRecord,recordStatement,stamp,type Actor} from './server';
const kinds={current:'growth_return_reason',history:'growth_return_reason_history',request:'growth_return_reason_request'} as const;
type Scoped={brandId:string;storeId:string;campaignId:string};
type Event=InventoryEvent&Scoped&{inventoryId:string};
type Line=Scoped&{id:string;version:number;input:{inventoryId:string;missionId:string}};
type Inventory={id:string;brandId:string;storeId:string;input:{unit:string}};
export type ReturnReasonSnapshot={eventId:string;eventVersion:number;eventDigest:string;lineId:string;lineVersion:number;inventoryId:string};
export type ReturnReasonRecord=Scoped&{id:string;eventId:string;version:number;input:ReturnReasonInput;snapshot:ReturnReasonSnapshot;recordedAt:string;source:'operator_attested';requestDigest:string};
async function optional<T>(owner:string,kind:string,id:string){try{return await readRecord<T>(owner,kind,id)}catch(e){if(e instanceof ApiError&&e.status===404)return null;throw e}}
function scoped(x:Scoped,c:Campaign){return x.brandId===c.brandId&&x.storeId===c.storeId&&x.campaignId===c.id}
async function context(owner:string,c:Campaign,eventId:string){
 const event=await readRecord<Event>(owner,'growth_stock_event',eventId);
 if(event.id!==eventId||!scoped(event,c))throw new ApiError(404,'현재 캠페인의 운영 사건이 아닙니다.');
 if(!['return','refund'].includes(event.kind)||!Number.isSafeInteger(event.version)||event.version<1||!Number.isSafeInteger(event.quantity)||event.quantity<1||!/^[a-f0-9]{64}$/.test(event.digest))throw new ApiError(409,'유효한 반품·환불 수량 사건을 선택하세요.');
 const [line,inventory]=await Promise.all([readRecord<Line>(owner,'growth_order_line',executionId(event.orderId)),readRecord<Inventory>(owner,'growth_inventory_item',executionId(event.inventoryId))]);
 if(line.id!==event.orderId||!scoped(line,c)||line.input.inventoryId!==event.inventoryId||inventory.id!==event.inventoryId||inventory.brandId!==c.brandId||inventory.storeId!==c.storeId||(event.missionId&&event.missionId!==line.input.missionId)||(!event.missionId&&event.reservationId))throw new ApiError(409,'사건의 정확한 품목·미션·재고 범위를 확인하세요.');
 if(!Number.isSafeInteger(line.version)||line.version<1)throw new ApiError(409,'품목 판을 확인하세요.');
 const eventDigest=await storefrontDigest({inventoryUnit:inventory.input.unit,lineBasis:{id:line.id,version:line.version,inventoryId:line.input.inventoryId,missionId:line.input.missionId},id:event.id,version:event.version,digest:event.digest,kind:event.kind,quantity:event.quantity,orderId:event.orderId,inventoryId:event.inventoryId,missionId:event.missionId,reservationId:event.reservationId,observedAt:event.observedAt,recordedAt:event.recordedAt,evidenceRef:event.evidenceRef,returnAccepted:event.returnAccepted,disposition:event.disposition,restock:event.restock});
 return {event,line,inventory,snapshot:{eventId:event.id,eventVersion:event.version,eventDigest,lineId:line.id,lineVersion:line.version,inventoryId:inventory.id} satisfies ReturnReasonSnapshot};
}
async function rows<T>(owner:string,c:Campaign,kind:string,limit:number){const result=await database().prepare('SELECT data FROM records WHERE owner=? AND kind=? AND parent_id=? LIMIT ?').bind(owner,kind,c.id,limit+1).all<{data:string}>();if(result.results.length>limit)throw new ApiError(409,'원인 기록 조회 한도를 넘었습니다.');return result.results.map(r=>JSON.parse(r.data) as T)}
async function capacity(owner:string,c:Campaign,kind:string,limit:number){const r=await database().prepare('SELECT COUNT(*) n FROM records WHERE owner=? AND kind=? AND parent_id=?').bind(owner,kind,c.id).first<{n:number}>();if((r?.n??0)>=limit)throw new ApiError(409,'원인 기록 보관 한도에 도달했습니다.')}
function append(owner:string,c:Campaign,kind:string,id:string,value:unknown,at:string){return database().prepare('INSERT INTO records(id,owner,kind,parent_id,data,updated_at) VALUES(?,?,?,?,?,?)').bind(`${owner}:${kind}:${id}`,owner,kind,c.id,JSON.stringify(value),at)}
const instant=(value:string)=>typeof value==='string'&&Number.isFinite(Date.parse(value))?value:null;
export async function growthReturnReasonView(who:Actor,c:Campaign){
 const [found,current,history]=await Promise.all([database().prepare("SELECT data FROM records WHERE owner=? AND kind='growth_stock_event' AND json_extract(data,'$.campaignId')=? AND json_extract(data,'$.kind') IN ('return','refund') LIMIT 501").bind(who.owner,c.id).all<{data:string}>(),rows<ReturnReasonRecord>(who.owner,c,kinds.current,500),rows<ReturnReasonRecord>(who.owner,c,kinds.history,2000)]);
 if(found.results.length>500)throw new ApiError(409,'운영 사건 조회 한도를 넘었습니다.');
 const events=await Promise.all(found.results.map(r=>JSON.parse(r.data) as Event).filter(e=>scoped(e,c)).map(async e=>{
  const eventId=executionId(e.id),lineId=executionId(e.orderId),inventoryId=executionId(e.inventoryId),record=current.find(r=>r.eventId===eventId&&scoped(r,c))??null;
  let sourceStatus:'current'|'held'='current',lineVersion:number|null=null,unit:'piece'|'pack'|null=null;const reasons:string[]=[];
  try{const ctx=await context(who.owner,c,eventId);lineVersion=ctx.line.version;unit=ctx.inventory.input.unit==='piece'||ctx.inventory.input.unit==='pack'?ctx.inventory.input.unit:null;if(record&&JSON.stringify(record.snapshot)!==JSON.stringify(ctx.snapshot))throw new ApiError(409,'changed')}catch{sourceStatus='held';reasons.push('원본 사건·품목·재고 연결이 변경되거나 현재 확인되지 않습니다.');}
  return {eventId,eventVersion:e.version,lineId,lineVersion,inventoryId,kind:e.kind as 'return'|'refund',quantity:Number.isSafeInteger(e.quantity)&&e.quantity>0?e.quantity:null,unit,observedAt:instant(e.observedAt),recordedAt:instant(e.recordedAt),current:record,sourceStatus,reasons};
 }));
 return {campaignId:c.id,campaignVersion:c.version,events,history:history.filter(r=>scoped(r,c)),canEdit:who.role!=='member',mayExecute:false as const};
}
export type GrowthReturnReasonView=Awaited<ReturnType<typeof growthReturnReasonView>>;
export async function saveGrowthReturnReason(who:Actor,c:Campaign,b:Record<string,unknown>){
 if(b.campaignVersion!==c.version)throw new ApiError(409,'캠페인이 변경되었습니다. 다시 불러오세요.');
 const eventId=executionId(b.eventId),lineId=executionId(b.lineId),input=parseReturnReasonInput(b.input),requestId=String(b.requestId??'');
 if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)||!Number.isSafeInteger(b.expectedVersion)||Number(b.expectedVersion)<0)throw new ApiError(400,'요청 번호와 원인 기록 판을 확인하세요.');
 const digest=await storefrontDigest({campaignId:c.id,campaignVersion:c.version,eventId,eventVersion:b.eventVersion,lineId,lineVersion:b.lineVersion,input,expectedVersion:b.expectedVersion}),request=await optional<{digest:string;id:string;version:number}>(who.owner,kinds.request,requestId);
 const old=await optional<ReturnReasonRecord>(who.owner,kinds.current,eventId),ack=(id:string,version:number,duplicate:boolean)=>({recorded:true as const,id,version,duplicate,mayExecute:false as const});
 if(request){if(request.digest!==digest)throw new ApiError(409,'같은 요청 번호의 내용이 다릅니다.');return ack(request.id,old?.version??request.version,true)}
 const ctx=await context(who.owner,c,eventId);
 if(ctx.event.version!==b.eventVersion||ctx.line.id!==lineId||ctx.line.version!==b.lineVersion)throw new ApiError(409,'운영 사건 또는 품목 판이 변경되었습니다.');
 if(old&&!scoped(old,c))throw new ApiError(404,'다른 캠페인의 원인 기록입니다.');
 const same=old&&JSON.stringify(old.input)===JSON.stringify(input)&&JSON.stringify(old.snapshot)===JSON.stringify(ctx.snapshot);
 if(!same&&b.expectedVersion!==(old?.version??0))throw new ApiError(409,'원인 기록이 변경되었습니다. 다시 불러오세요.');
 await capacity(who.owner,c,kinds.request,5000);const at=stamp();
 if(same){await database().batch([append(who.owner,c,kinds.request,requestId,{digest,id:eventId,version:old.version},at)]);return ack(eventId,old.version,true)}
 if(!old)await capacity(who.owner,c,kinds.current,500);await capacity(who.owner,c,kinds.history,2000);
 const record:ReturnReasonRecord={id:eventId,eventId,brandId:c.brandId,storeId:c.storeId!,campaignId:c.id,version:(old?.version??0)+1,input,snapshot:ctx.snapshot,recordedAt:at,source:'operator_attested',requestDigest:digest};
 await database().batch([recordStatement(who.owner,kinds.current,eventId,record,c.id),append(who.owner,c,kinds.history,`${eventId}:${record.version}`,record,at),append(who.owner,c,kinds.request,requestId,{digest,id:eventId,version:record.version},at)]);
 return ack(eventId,record.version,false);
}
