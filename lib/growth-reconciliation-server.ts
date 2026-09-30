import type {Campaign} from './agency';
import type {ExecutionIntent} from './growth-execution-server';
import type {GrowthCommitmentRecord} from './growth-authority-server';
import type {GrowthRecord} from './growth-workspace-server';
import type {MissionInput} from './growth-mission';
import {prepareMissionStock,type InventoryRow} from './growth-operations-server';
import {projectInventory,type InventoryEvent} from './growth-inventory';
import {parseReconciliationInput,reconcileCommitment,type ReconciliationInput} from './growth-reconciliation';
import {executionId} from './growth-execution';
import {storefrontDigest} from './storefront-orders';
import {ApiError,database,readRecord,recordStatement,stamp,type Actor} from './server';
const kinds={history:'growth_reconciliation'} as const;
export type ReconciliationRecord={id:string;brandId:string;campaignId:string;intentId:string;intentVersion:number;commitmentId:string;commitmentVersion:number;missionVersion:number;inventoryVersion:number;input:ReconciliationInput;before:GrowthCommitmentRecord['commitment'];after:GrowthCommitmentRecord['commitment'];requestDigest:string;source:'operator_attested';recordedAt:string;recordedBy:string};
function scope(row:{brandId:string;campaignId:string},c:Campaign){if(row.brandId!==c.brandId||row.campaignId!==c.id)throw new ApiError(404,'현재 캠페인의 대사 기록이 아닙니다.')}
export async function reconciliationRows(owner:string,c:Campaign){const rows=await database().prepare('SELECT data FROM records WHERE owner=? AND kind=? AND parent_id=? ORDER BY updated_at DESC LIMIT 5001').bind(owner,kinds.history,c.id).all<{data:string}>();if(rows.results.length>5000)throw new ApiError(409,'대사 이력 한도를 넘었습니다. 전체 기록을 확인하세요.');return rows.results.map(r=>{const row=JSON.parse(r.data) as ReconciliationRecord;scope(row,c);return row})}
async function existing(owner:string,id:string){try{return await readRecord<ReconciliationRecord>(owner,kinds.history,id)}catch(e){if(e instanceof ApiError&&e.status===404)return null;throw e}}
function uuid(v:unknown){if(typeof v!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v))throw new ApiError(400,'대사 요청 UUID를 확인하세요.');return v.toLowerCase()}
async function releaseWrites(who:Actor,c:Campaign,intent:ExecutionIntent,item:InventoryRow,input:ReconciliationInput,key:string){
 const result=await database().prepare('SELECT data FROM records WHERE owner=? AND kind=? AND parent_id=? LIMIT 5001').bind(who.owner,'growth_stock_event',item.id).all<{data:string}>();
 if(result.results.length>5000)throw new ApiError(409,'재고 사건 한도를 넘었습니다.');
 const events=result.results.map(r=>JSON.parse(r.data) as InventoryEvent&{brandId:string;storeId:string;inventoryId:string});
 if(events.some(e=>e.brandId!==c.brandId||e.storeId!==intent.storeId||e.inventoryId!==item.id))throw new ApiError(409,'재고 사건 범위를 확인하세요.');
 const projection=projectInventory(item.input,events.sort((a,b)=>a.version-b.version)),reservation=projection.reservations.find(r=>r.reservationId===intent.reservationId);
 if(!reservation||reservation.missionId!==intent.input.missionId||reservation.quantity!==intent.input.quantity||reservation.held!==intent.input.quantity||reservation.allocated!==0||reservation.released!==0||projection.orders.some(o=>o.reservationId===intent.reservationId))throw new ApiError(409,'배정·출고·해제 이력이 없는 전체 미집행 예약만 함께 해제할 수 있습니다.');
 const stock=await prepareMissionStock(who,c,{action:'release_stock',id:'reconcile-'+key,inventoryId:item.id,inventoryVersion:item.version,missionId:intent.input.missionId,missionVersion:intent.currentMissionVersion,reservationId:intent.reservationId,quantity:intent.input.quantity,safeRelease:true,observedAt:stamp(),evidenceRef:input.evidenceRef});
 if(stock.duplicate)throw new ApiError(409,'기존 해제 사건을 대사하세요.');return stock.writes;
}
export async function prepareReconciliation(who:Actor,c:Campaign,b:Record<string,unknown>){
 const id=executionId(b.id),key=uuid(b.requestId),input=parseReconciliationInput(b.input),digest=await storefrontDigest(b),oldRequest=await existing(who.owner,key);
 if(oldRequest){scope(oldRequest,c);if(oldRequest.requestDigest!==digest)throw new ApiError(409,'같은 대사 요청 ID의 내용이 변경되었습니다.');return {duplicate:true,writes:[]};}
 if((await reconciliationRows(who.owner,c)).length>=5000)throw new ApiError(409,'캠페인별 대사 이력은 5000개까지 기록할 수 있습니다.');
 const intent=await readRecord<ExecutionIntent>(who.owner,'growth_action_intent',id);scope(intent,c);
 const commitment=await readRecord<GrowthCommitmentRecord>(who.owner,'growth_commitment',intent.commitmentId);scope(commitment,c);
 const mission=await readRecord<GrowthRecord<MissionInput>>(who.owner,'growth_mission',intent.input.missionId);scope(mission,c);
 const item=await readRecord<InventoryRow>(who.owner,'growth_inventory_item',intent.input.inventoryId);
 if(item.brandId!==c.brandId||item.storeId!==intent.storeId||intent.storeId!==c.storeId)throw new ApiError(404,'실행 준비 당시 브랜드·매장의 재고를 확인하세요.');
 if(b.expectedVersion!==intent.version||b.commitmentVersion!==(commitment.version??1)||b.missionVersion!==mission.version||mission.version!==intent.currentMissionVersion||b.inventoryVersion!==item.version)throw new ApiError(409,'실행·예산·미션·재고 판이 변경되었습니다. 최신 기록을 확인하세요.');
 const action=commitment.commitment.action;
 if(commitment.missionId!==intent.input.missionId||commitment.missionVersion!==intent.input.missionVersion||commitment.authorityId!==intent.input.authorityId||action.id!==intent.input.missionId||action.operationKey!==commitment.id||action.brandId!==c.brandId||action.campaignId!==c.id||action.accountId!==intent.snapshot.authority.accountId||action.channel!==intent.snapshot.authority.channel)throw new ApiError(409,'준비 당시 비용 예약 범위가 일치하지 않습니다.');
 if(intent.state!==mission.status&&!(intent.state==='prepared'&&mission.status==='staged'))throw new ApiError(409,'미션과 실행 결과 상태를 먼저 대사하세요.');
 const at=stamp(),after=reconcileCommitment(commitment.commitment,input,intent.state);
 const next={...after,...(input.mode==='final'?{reconciledAt:at}:{})};
 const writes=input.mode==='release'?await releaseWrites(who,c,intent,item,input,key):[];
 const history:ReconciliationRecord={id:key,brandId:c.brandId,campaignId:c.id,intentId:id,intentVersion:intent.version+1,commitmentId:commitment.id,commitmentVersion:(commitment.version??1)+1,missionVersion:mission.version,inventoryVersion:item.version,input,before:commitment.commitment,after:next,requestDigest:digest,source:'operator_attested',recordedAt:at,recordedBy:who.id};
 writes.push(recordStatement(who.owner,'growth_commitment',commitment.id,{...commitment,version:history.commitmentVersion,commitment:next},c.id),recordStatement(who.owner,'growth_action_intent',id,{...intent,version:history.intentVersion,updatedAt:at},c.id),database().prepare('INSERT INTO records(id,owner,kind,parent_id,data,updated_at) VALUES(?,?,?,?,?,?)').bind(`${who.owner}:${kinds.history}:${key}`,who.owner,kinds.history,c.id,JSON.stringify(history),at));
 return {duplicate:false,writes};
}
