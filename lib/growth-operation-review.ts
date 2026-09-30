export type OperationReviewCode='order_changed'|'allocation_review'|'campaign_line_missing'|'stock_allocation_missing'|'unshipped_hold'|'cancelled_refunded_hold'|'inventory_unknown'|'inventory_shortage';
type Scoped={brandId?:string;storeId?:string};
type Order=Scoped&{id:string;campaignId?:string|null;version:number;status:string;paidAmount:number;refundAmount:number};
type Line=Scoped&{id:string;campaignId:string;input:{orderId:string;orderVersion:number;inventoryId:string;units:number;missionId?:string};allocation?:{status:string;reasons:readonly string[]}};
type Inventory=Scoped&{id:string;input:{unit?:string};projection?:{onHand:number|null;shortage:number|null;orders:readonly {orderId:string;missionId?:string;reservationId?:string;quantity?:number;held:number}[]}};
export type OperationReviewInput={campaignId:string;brandId?:string;storeId:string|null;orders:readonly Order[];orderLines:readonly Line[];inventory:readonly Inventory[]};
export type OperationReviewItem={key:string;orderId:string|null;lineId:string|null;inventoryId:string|null;codes:OperationReviewCode[];reasons:string[];heldUnits:number|null;unit:'piece'|'pack'|null;target:{kind:'order_link'|'line_reconcile'|'line_operation'|'inventory';id:string}};
const reasons:Record<OperationReviewCode,string>={order_changed:'주문 판이 달라 품목 배분을 다시 대사해야 합니다.',allocation_review:'품목 배분 근거가 미확인 또는 재대사 상태입니다.',campaign_line_missing:'이 캠페인의 주문에 연결된 품목이 없습니다.',stock_allocation_missing:'품목 ID에 대응하는 정확한 재고 할당을 확인할 수 없습니다.',unshipped_hold:'미출고 할당 수량이 남아 있습니다. 배송 지연을 뜻하지 않습니다.',cancelled_refunded_hold:'취소·환불 주문에 할당 수량이 남아 있습니다. 해제 수량을 별도로 확인하세요.',inventory_unknown:'참조한 공유 재고 원장의 수량·단위를 확인할 수 없습니다.',inventory_shortage:'공유 원장 전체의 재고가 부족합니다. 이 캠페인만의 부족량은 아닙니다.'};
const priority:Record<OperationReviewCode,number>={order_changed:0,allocation_review:0,stock_allocation_missing:0,cancelled_refunded_hold:1,inventory_unknown:2,inventory_shortage:2,campaign_line_missing:3,unshipped_hold:4};
const nonnegative=(value:unknown):value is number=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0;
function unique<T extends {id:string}>(items:readonly T[]):T[]{return [...new Map([...items].sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))).map(x=>[x.id,x])).values()].sort((a,b)=>a.id.localeCompare(b.id));}
function inScope(row:Scoped,view:OperationReviewInput){return (row.storeId===undefined||row.storeId===view.storeId)&&(view.brandId===undefined||row.brandId===undefined||row.brandId===view.brandId)}
function unit(row:Inventory|undefined):'piece'|'pack'|null{return row?.input.unit==='piece'||row?.input.unit==='pack'?row.input.unit:null}
function item(value:Omit<OperationReviewItem,'reasons'>):OperationReviewItem{return {...value,codes:[...new Set(value.codes)],reasons:[...new Set(value.codes)].map(code=>reasons[code])}}
export function buildOperationReview(view:OperationReviewInput,nowMs:number){
 if(!Number.isFinite(nowMs)||!Number.isFinite(new Date(nowMs).getTime()))throw new Error('운영 확인 시각을 확인하세요.');
 const evaluatedAt=new Date(nowMs).toISOString();
 if(!view.storeId)return {evaluatedAt,items:[] as OperationReviewItem[],mayExecute:false as const};
 const lines=unique(view.orderLines.filter(l=>l.campaignId===view.campaignId&&inScope(l,view))),orders=unique(view.orders.filter(o=>inScope(o,view)&&(o.campaignId===view.campaignId||lines.some(l=>l.input.orderId===o.id)))),inventory=unique(view.inventory.filter(i=>inScope(i,view)&&lines.some(l=>l.input.inventoryId===i.id)));
 const items:OperationReviewItem[]=[];
 for(const order of orders){if(!lines.some(l=>l.input.orderId===order.id))items.push(item({key:`order:${order.id}`,orderId:order.id,lineId:null,inventoryId:null,codes:['campaign_line_missing'],heldUnits:null,unit:null,target:{kind:'order_link',id:order.id}}));}
 for(const line of lines){
  const order=orders.find(o=>o.id===line.input.orderId),stock=inventory.find(i=>i.id===line.input.inventoryId),matches=stock?.projection?.orders.filter(o=>o.orderId===line.id)??[],allocation=matches.length===1?matches[0]:undefined;
  const exact=!!allocation&&typeof line.input.missionId==='string'&&!!line.input.missionId&&(allocation.missionId===line.input.missionId||(allocation.missionId===''&&allocation.reservationId===''))&&nonnegative(allocation.quantity)&&allocation.quantity===line.input.units&&nonnegative(allocation.held);
  const heldUnits=exact?allocation!.held:null,codes:OperationReviewCode[]=[];
  if(order&&order.version!==line.input.orderVersion)codes.push('order_changed');
  if(!order||!line.allocation||line.allocation.status!=='current'||line.allocation.reasons.length)codes.push('allocation_review');
  if(!exact)codes.push('stock_allocation_missing');
  if(heldUnits!==null&&heldUnits>0){codes.push('unshipped_hold');if(order&&(order.status==='cancelled'||order.status==='refunded'||order.refundAmount>0))codes.push('cancelled_refunded_hold');}
  if(codes.length)items.push(item({key:`line:${line.id}`,orderId:line.input.orderId,lineId:line.id,inventoryId:line.input.inventoryId,codes,heldUnits,unit:unit(stock),target:{kind:codes.some(c=>['order_changed','allocation_review','stock_allocation_missing'].includes(c))?'line_reconcile':'line_operation',id:line.id}}));
 }
 for(const inventoryId of [...new Set(lines.map(l=>l.input.inventoryId))].sort()){
  const stock=inventory.find(i=>i.id===inventoryId),projection=stock?.projection,codes:OperationReviewCode[]=[];
  if(!projection||!nonnegative(projection.onHand)||!nonnegative(projection.shortage)||!unit(stock))codes.push('inventory_unknown');
  if(projection&&nonnegative(projection.shortage)&&projection.shortage>0)codes.push('inventory_shortage');
  if(codes.length)items.push(item({key:`inventory:${inventoryId}`,orderId:null,lineId:null,inventoryId,codes,heldUnits:null,unit:unit(stock),target:{kind:'inventory',id:inventoryId}}));
 }
 return {evaluatedAt,items:items.sort((a,b)=>Math.min(...a.codes.map(c=>priority[c]))-Math.min(...b.codes.map(c=>priority[c]))||a.key.localeCompare(b.key)),mayExecute:false as const};
}
export type GrowthOperationReview=ReturnType<typeof buildOperationReview>;
