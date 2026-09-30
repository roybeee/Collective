import type {Campaign} from './agency';
import {parseExecutionInput,parseExecutionReceipt,executionSafeText,executionId,canRecordExecution,type ExecutionInput,type ExecutionState,type ExecutionReceiptInput} from './growth-execution';
import {prepareMissionCommitment,growthAuthorityView,type GrowthAuthorityRecord} from './growth-authority-server';
import {prepareMissionStock,growthOperationsView,type InventoryRow} from './growth-operations-server';
import {growthView,type GrowthRecord} from './growth-workspace-server';
import type {MissionInput} from './growth-mission';
import {storefrontDigest} from './storefront-orders';
import {ApiError,database,readRecord,recordStatement,stamp,type Actor} from './server';

export type ExecutionIntent={id:string;brandId:string;campaignId:string;campaignVersion:number;storeId:string;version:number;input:ExecutionInput;state:ExecutionState;requestDigest:string;commitmentId:string;reservationId:string;currentMissionVersion:number;source:'operator_attested';createdAt:string;createdBy:string;updatedAt:string;snapshot:{mission:MissionInput;authority:GrowthAuthorityRecord['input'];inventory:InventoryRow['input']}};
export type ExecutionReceipt={id:string;intentId:string;intentVersion:number;campaignId:string;brandId:string;state:ExecutionState;input:ExecutionReceiptInput|null;requestDigest:string;source:'operator_attested';recordedAt:string;recordedBy:string};
const kinds={intent:'growth_action_intent',receipt:'growth_action_receipt'};
async function rows<T>(owner:string,kind:string,c:Campaign,limit=1000){
 const result=await database().prepare('SELECT data FROM records WHERE owner=? AND kind=? AND parent_id=? ORDER BY updated_at DESC LIMIT ?').bind(owner,kind,c.id,limit+1).all<{data:string}>();
 if(result.results.length>limit)throw new ApiError(409,'판매 실행 이력 한도에 도달했습니다. 전체 대사 후 진행하세요.');
 return result.results.map(r=>JSON.parse(r.data) as T);
}
async function optional<T>(owner:string,kind:string,id:string){try{return await readRecord<T>(owner,kind,id)}catch(e){if(e instanceof ApiError&&e.status===404)return null;throw e}}
function scope(row:{campaignId:string;brandId:string},c:Campaign){if(row.campaignId!==c.id||row.brandId!==c.brandId)throw new ApiError(404,'현재 캠페인의 실행 기록을 찾지 못했습니다.')}
function insert<T extends {id:string}>(who:Actor,kind:string,row:T,c:Campaign){return database().prepare('INSERT INTO records(id,owner,kind,parent_id,data,updated_at) VALUES(?,?,?,?,?,?)').bind(`${who.owner}:${kind}:${row.id}`,who.owner,kind,c.id,JSON.stringify(row),stamp())}
export async function growthExecutionView(who:Actor,c:Campaign){
 const [intents,receipts,workspace,authority,operations]=await Promise.all([rows<ExecutionIntent>(who.owner,kinds.intent,c),rows<ExecutionReceipt>(who.owner,kinds.receipt,c,5000),growthView(who.owner,c,who.role!=='member'),growthAuthorityView(who,c),growthOperationsView(who,c)]);
 for(const row of [...intents,...receipts])scope(row,c);
 return {intents,receipts,missions:workspace.missions,authorities:authority.authorities,inventory:operations.inventory,campaignVersion:c.version,canPrepare:who.role!=='member'&&c.status!=='archived'&&Boolean(c.storeId),canRecord:who.role!=='member',mayExecute:false as const};
}
async function prepare(who:Actor,c:Campaign,b:Record<string,unknown>){
 const input=parseExecutionInput(b.input),id='intent-'+(await storefrontDigest([c.id,input.missionId])).slice(0,32),digest=await storefrontDigest({input,campaignVersion:b.campaignVersion});
 const old=await optional<ExecutionIntent>(who.owner,kinds.intent,id);
 if(old){scope(old,c);if(old.requestDigest!==digest)throw new ApiError(409,'이미 준비된 미션의 요청 내용이 다릅니다. 새 실행을 만들기 전에 기존 결과를 대사하세요.');return {...await growthExecutionView(who,c),duplicate:true}}
 if(c.status==='archived')throw new ApiError(409,'보관한 캠페인은 새 판매 실행을 준비할 수 없습니다.');
 if(Date.parse(input.recoveryDueAt)<=Date.now())throw new ApiError(409,'복구 담당의 미래 확인 기한을 지정하세요.');
 const existing=await rows<ExecutionIntent>(who.owner,kinds.intent,c);
 if((await rows<ExecutionReceipt>(who.owner,kinds.receipt,c,5000)).length>=5000)throw new ApiError(409,'실행 증빙 한도에 도달했습니다.');
 if(existing.length>=1000)throw new ApiError(409,'판매 실행은 캠페인별 1000개까지 준비할 수 있습니다.');
 const budget=await prepareMissionCommitment(who,c,{authorityId:input.authorityId,expectedVersion:input.authorityVersion,missionId:input.missionId,missionVersion:input.missionVersion});
 for(const snapshot of [budget.mission.input,budget.authority.input])for(const value of Object.values(snapshot))if(typeof value==='string'&&value)executionSafeText(value,'연결 스냅샷',2000);
 const at=stamp(),reservationId='execution-'+(await storefrontDigest([c.id,input.missionId])).slice(0,32);
 const stock=await prepareMissionStock(who,c,{action:'reserve_stock',id:reservationId,inventoryId:input.inventoryId,inventoryVersion:input.inventoryVersion,missionId:input.missionId,missionVersion:input.missionVersion,quantity:input.quantity,requireNoPriorReservation:true,observedAt:at,evidenceRef:input.evidenceRef});
 for(const value of Object.values(stock.item.input))if(typeof value==='string'&&value)executionSafeText(value,'재고 스냅샷',2000);
 if(stock.duplicate)throw new ApiError(409,'기존 재고 사건과 판매 실행을 대사하세요.');
 const record:ExecutionIntent={id,brandId:c.brandId,campaignId:c.id,campaignVersion:c.version,storeId:stock.item.storeId,version:1,input,state:'prepared',requestDigest:digest,commitmentId:budget.record.id,reservationId,currentMissionVersion:budget.mission.version,source:'operator_attested',createdAt:at,createdBy:who.id,updatedAt:at,snapshot:{mission:budget.mission.input,authority:budget.authority.input,inventory:stock.item.input}};
 const history:ExecutionReceipt={id:`${id}:prepared`,intentId:id,intentVersion:1,campaignId:c.id,brandId:c.brandId,state:'prepared',input:null,requestDigest:digest,source:'operator_attested',recordedAt:at,recordedBy:who.id};
 await database().batch([...budget.writes,...stock.writes,insert(who,kinds.intent,record,c),insert(who,kinds.receipt,history,c)]);
 return {...await growthExecutionView(who,c),duplicate:false};
}
async function recordReceipt(who:Actor,c:Campaign,b:Record<string,unknown>){
 const id=executionId(b.id),receiptId=executionId(b.receiptId),input=parseExecutionReceipt(b.input),old=await readRecord<ExecutionIntent>(who.owner,kinds.intent,id);scope(old,c);
 const digest=await storefrontDigest({id,receiptId,input,expectedVersion:b.expectedVersion}),key=`${id}:${receiptId}`,existing=await optional<ExecutionReceipt>(who.owner,kinds.receipt,key);
 if(existing){scope(existing,c);if(existing.requestDigest!==digest)throw new ApiError(409,'같은 실행 증빙 ID의 내용이 다릅니다.');return {...await growthExecutionView(who,c),duplicate:true}}
 if(b.expectedVersion!==old.version)throw new ApiError(409,'실행 확인 판이 변경되었습니다. 최신 기록을 확인하세요.');
 if(!canRecordExecution(old.state))throw new ApiError(409,'결과가 확정된 실행은 다시 보내거나 변경할 수 없습니다.');
 if((await rows<ExecutionReceipt>(who.owner,kinds.receipt,c,5000)).length>=5000)throw new ApiError(409,'실행 증빙 한도에 도달했습니다.');
 const mission=await readRecord<GrowthRecord<MissionInput>>(who.owner,'growth_mission',old.input.missionId);scope(mission,c);
 if(mission.version!==old.currentMissionVersion)throw new ApiError(409,'연결 미션의 판이 변경되었습니다. 실행 장부와 대사하세요.');
 const at=stamp(),record:ExecutionIntent={...old,version:old.version+1,state:input.status,currentMissionVersion:mission.version+1,updatedAt:at};
 const history:ExecutionReceipt={id:key,intentId:id,intentVersion:record.version,campaignId:c.id,brandId:c.brandId,state:input.status,input,requestDigest:digest,source:'operator_attested',recordedAt:at,recordedBy:who.id};
 const nextMission:GrowthRecord<MissionInput>={...mission,version:mission.version+1,status:input.status,receipt:{...input,recordedAt:at,recordedBy:who.id},updatedAt:at,updatedBy:who.id,requestDigest:digest};
 await database().batch([recordStatement(who.owner,kinds.intent,id,record,c.id),insert(who,kinds.receipt,history,c),recordStatement(who.owner,'growth_mission',mission.id,nextMission,c.id),insert(who,'growth_history',{...nextMission,id:`mission:${mission.id}:${nextMission.version}`,entity:'mission'},c)]);
 return {...await growthExecutionView(who,c),duplicate:false};
}
export async function saveGrowthExecution(who:Actor,c:Campaign,b:Record<string,unknown>){
 if(who.role==='member')throw new ApiError(403,'관리자만 실행 준비와 확인을 기록할 수 있습니다.');
 if(b.campaignVersion!==c.version)throw new ApiError(409,'캠페인이 변경되었습니다. 다시 불러오세요.');
 if(b.action==='prepare_execution')return prepare(who,c,b);
 if(b.action==='record_execution_receipt')return recordReceipt(who,c,b);
 throw new ApiError(400,'지원하지 않는 판매 실행 작업입니다.');
}
