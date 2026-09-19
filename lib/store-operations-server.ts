import {ApiError,database,listRecords,readRecord,str,num,stamp} from './server';
import {checkedVersion,localDate,option} from './store-server';
import {channelCatalog,type Store,type StoreExperiment} from './store-marketing';
import {diagnosisCatalog,orderCostFields,orderModes,orderSources,orderStates,koreaToday,recentPeriod,type StoreDiagnostic,type StoreOrder,type StoreSpend,type StoreOperations} from './store-operations';

export function operationDate(v:unknown,label:string){const date=localDate(v,label,true);if(date>koreaToday())throw new ApiError(400,label+'은 오늘까지 입력하세요.');return date}
export function diagnosisInput(raw:any,store:Store,old?:StoreDiagnostic):StoreDiagnostic{
 const key=option(raw.key,diagnosisCatalog.map(x=>x.key),'진단 항목'),status=option(raw.status,['unknown','todo','done'] as const,'확인 상태');
 const checkedAt=raw.checkedAt?operationDate(raw.checkedAt,'확인일'):'',evidence=str(raw.evidence??'','확인 근거',3000,status==='done'),observation=str(raw.observation??'','확인한 내용',4000,status==='done');
 if(status==='done'&&!checkedAt)throw new ApiError(400,'확인 완료에는 실제 확인일이 필요합니다.');
 return {id:store.id+'-'+key,storeId:store.id,key,status,evidence,checkedAt,observation,nextAction:str(raw.nextAction??'','다음 행동',2000),assignee:str(raw.assignee??'','담당자',100),storeVersion:store.version,version:(old?.version||0)+1,updatedAt:stamp()};
}
const amount=(value:unknown,label:string,nullable=false)=>{if(nullable&&(value===null||value===undefined||value===''))return null;const v=typeof value==='string'&&/^\d+(\.\d+)?$/.test(value)?Number(value):value;return num(v,label)};
export async function orderInput(raw:any,storeId:string):Promise<Omit<StoreOrder,'version'|'createdAt'|'updatedAt'>>{
 const source=option(raw.source,Object.keys(orderSources) as StoreOrder['source'][],'주문 출처'),orderNumber=str(raw.orderNumber,'주문번호',100,true),orderDate=operationDate(raw.orderDate,'주문일');
 const key=JSON.stringify([storeId,source,orderDate,orderNumber]);const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(key));const id=Array.from(new Uint8Array(hash),x=>x.toString(16).padStart(2,'0')).join('');
 const paidAmount=amount(raw.paidAmount,'할인 후 결제액')!,refundAmount=amount(raw.refundAmount,'환불액')!;
 if(refundAmount>paidAmount)throw new ApiError(400,'환불액은 결제액을 초과할 수 없습니다.');
 const status=option(raw.status,Object.keys(orderStates) as StoreOrder['status'][],'주문 상태');
 if(status==='paid'&&paidAmount>0&&refundAmount===paidAmount)throw new ApiError(400,'결제액을 모두 환불했다면 상태를 전액 환불 또는 취소로 변경하세요.');
 if(status!=='paid'&&paidAmount!==refundAmount)throw new ApiError(400,'취소·전액 환불 주문은 결제액 전체의 환불을 반영하세요. 결제 전 취소는 두 금액을 0으로 입력하세요.');
 const channel=option(raw.channel||'unknown',['unknown',...channelCatalog.map(c=>c.key)] as const,'유입 채널');
 return {id,storeId,source,orderNumber,orderDate,mode:option(raw.mode,Object.keys(orderModes) as StoreOrder['mode'][],'주문 방식'),status,paidAmount,refundAmount,costs:Object.fromEntries(Object.entries(orderCostFields).map(([k,label])=>[k,amount(raw.costs?.[k]??raw[k],label,true)])) as StoreOrder['costs'],channel,experimentId:str(raw.experimentId??'','실험',100),attributionEvidence:str(raw.attributionEvidence??'','유입 확인 근거',2000,channel!=='unknown'),note:str(raw.note??'','출처 메모',2000)};
}
export async function validateOrderExperiment(owner:string,storeId:string,experimentId:string,date:string,channel:string){if(!experimentId)return;const e=await readRecord<StoreExperiment>(owner,'store_experiment',experimentId);if(e.storeId!==storeId)throw new ApiError(400,'다른 지점의 실험에는 연결할 수 없습니다.');if(e.status==='draft'||!e.startDate||!e.endDate||date<e.startDate||date>e.endDate)throw new ApiError(400,'시작한 실험의 기간 안에서 연결하세요.');if(e.channel!==channel)throw new ApiError(400,'유입 채널과 실험 채널이 일치해야 합니다.');}
export function spendInput(raw:any,storeId:string,old?:StoreSpend):StoreSpend{return {id:str(raw.id,'비용 기록',100,true),storeId,date:operationDate(raw.date,'비용일'),channel:option(raw.channel,channelCatalog.map(c=>c.key),'채널'),experimentId:str(raw.experimentId??'','실험',100),adSpend:amount(raw.adSpend,'광고비')!,productionCost:amount(raw.productionCost,'제작·협찬비')!,source:str(raw.source,'비용 출처',2000,true),version:(old?.version||0)+1,createdAt:old?.createdAt||stamp(),updatedAt:stamp()}}
export async function getStoreOperations(owner:string,storeId:string,from?:string,to?:string):Promise<StoreOperations>{
 const period=recentPeriod(),start=operationDate(from||period.from,'조회 시작일'),end=operationDate(to||period.to,'조회 종료일');if(start>end)throw new ApiError(400,'조회 기간을 확인하세요.');
 const query=async<T>(kind:string,dateKey:string)=>{const rows=await database().prepare(`SELECT data FROM records WHERE owner=? AND kind=? AND parent_id=? AND json_extract(data, '$.${dateKey}') >= ? AND json_extract(data, '$.${dateKey}') <= ? ORDER BY json_extract(data, '$.${dateKey}') DESC, updated_at DESC LIMIT 5001`).bind(owner,kind,storeId,start,end).all<{data:string}>();if(rows.results.length>5000)throw new ApiError(400,'조회 결과가 5,000건을 초과합니다. 기간을 좁혀 주세요.');return rows.results.map(r=>JSON.parse(r.data) as T)};
 const [diagnostics,orders,spend]=await Promise.all([listRecords<StoreDiagnostic>(owner,'store_diagnostic',storeId),query<StoreOrder>('store_order','orderDate'),query<StoreSpend>('store_spend','date')]);return {diagnostics,orders,spend,from:start,to:end};
}
export function requireVersion(old:{version:number}|undefined,version:unknown){if(old)checkedVersion(old,version);else if(version!==undefined&&version!==null)throw new ApiError(409,'기록이 변경되었습니다. 다시 불러오세요.')}
