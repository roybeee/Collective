import {emptyGrowthStop,parseGrowthStopInput,validateGrowthStop,type GrowthStopState} from './growth-stop';
import {storefrontDigest} from './storefront-orders';
import {ApiError,database,readRecord,recordStatement,stamp,type Actor} from './server';
const kinds={state:'growth_stop',history:'growth_stop_history'} as const;
export type GrowthStopHistory={id:string;version:number;status:GrowthStopState['status'];reason:string;actorId:string;recordedAt:string;requestDigest:string};
export async function readGrowthStop(owner:string):Promise<GrowthStopState>{
 let value:unknown;try{value=await readRecord(owner,kinds.state,'global')}catch(e){if(e instanceof ApiError&&e.status===404)return emptyGrowthStop();throw new ApiError(503,'전역 중단 상태를 확인할 수 없어 새 실행을 차단합니다.');}
 try{return validateGrowthStop(value)}catch{throw new ApiError(409,'전역 중단 기록을 확인할 때까지 새 실행을 차단합니다.');}
}
export async function requireGrowthRunning(owner:string){if((await readGrowthStop(owner)).status!=='running')throw new ApiError(409,'전역 중단 중입니다. 새 예약·게시·활성화는 소유자가 재개한 뒤 가능합니다.');}
export async function growthStopView(who:Actor){
 const state=await readGrowthStop(who.owner),rows=await database().prepare('SELECT data FROM records WHERE owner=? AND kind=? AND parent_id=? ORDER BY updated_at DESC LIMIT 101').bind(who.owner,kinds.history,'').all<{data:string}>();
 return {state,history:rows.results.slice(0,100).map(r=>JSON.parse(r.data) as GrowthStopHistory),hasMoreHistory:rows.results.length>100,canStop:who.role==='owner'||who.role==='admin',canResume:who.role==='owner',externalCancellationConfirmed:false as const,notice:'이 작업공간의 새 예약·게시·활성화를 차단합니다. 이미 전송 중이거나 외부에서 실행 중인 작업은 자동 취소되지 않으므로 별도로 중단·대사하세요.'};
}
export type GrowthStopView=Awaited<ReturnType<typeof growthStopView>>;
export async function changeGrowthStop(who:Actor,value:unknown){
 const input=parseGrowthStopInput(value);if(who.role!=='owner'&&who.role!=='admin')throw new ApiError(403,'관리자만 전역 중단을 기록할 수 있습니다.');if(input.action==='resume'&&who.role!=='owner')throw new ApiError(403,'소유자만 전역 실행을 재개할 수 있습니다.');
 const digest=await storefrontDigest(input);let previous:GrowthStopHistory|null=null;
 try{previous=await readRecord<GrowthStopHistory>(who.owner,kinds.history,input.requestId)}catch(e){if(!(e instanceof ApiError&&e.status===404))throw e}
 if(previous){if(previous.requestDigest!==digest)throw new ApiError(409,'동일 요청 ID의 내용이 변경되었습니다.');return {...await growthStopView(who),duplicate:true};}
 const old=await readGrowthStop(who.owner);if(old.version!==input.expectedVersion)throw new ApiError(409,'전역 중단 상태가 변경되었습니다. 최신 판을 확인하세요.');
 const at=stamp(),state:GrowthStopState={id:'global',version:old.version+1,status:input.action==='stop'?'stopped':'running',reason:input.reason,updatedAt:at,updatedBy:who.id};
 const history:GrowthStopHistory={id:input.requestId,version:state.version,status:state.status,reason:state.reason,actorId:who.id,recordedAt:at,requestDigest:digest};
 await database().batch([recordStatement(who.owner,kinds.state,'global',state,''),database().prepare('INSERT INTO records(id,owner,kind,parent_id,data,updated_at) VALUES(?,?,?,?,?,?)').bind(`${who.owner}:${kinds.history}:${history.id}`,who.owner,kinds.history,'',JSON.stringify(history),at)]);
 return {...await growthStopView(who),duplicate:false};
}
