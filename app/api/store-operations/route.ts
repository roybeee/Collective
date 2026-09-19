import {identity,secureMutation,body,readRecord,listRecords,recordStatement,json,failure,str,stamp,uid,ApiError,acquireLock,releaseLock,database} from '@/lib/server';
import {channelCatalog,type Store,type StoreExperiment,type StoreMeasurement} from '@/lib/store-marketing';
import {diagnosisCatalog,ledgerValues,ledgerSnapshot,ledgerChanged,type StoreDiagnostic,type StoreOrder,type StoreSpend} from '@/lib/store-operations';
import {diagnosisInput,orderInput,spendInput,validateOrderExperiment,getStoreOperations,requireVersion} from '@/lib/store-operations-server';
import {checkedVersion,measurementInput,option} from '@/lib/store-server';

export async function GET(req:Request){try{const owner=identity(req),p=new URL(req.url).searchParams,storeId=str(p.get('storeId'),'지점',100,true);await readRecord<Store>(owner,'store',storeId);if(p.get('part')==='diagnosis')return json({diagnostics:await listRecords<StoreDiagnostic>(owner,'store_diagnostic',storeId),orders:[],spend:[],from:'',to:''});return json(await getStoreOperations(owner,storeId,p.get('from')||undefined,p.get('to')||undefined))}catch(e){return failure(e)}}
export async function POST(req:Request){let owner='',lock='';try{
 owner=identity(req);secureMutation(req);const b=await body(req);lock=await acquireLock(owner);const store=await readRecord<Store>(owner,'store',str(b.storeId,'지점',100,true));if(store.status!=='active')throw new ApiError(409,'보관한 지점입니다.');
 if(b.action==='save_diagnostic'){
  checkedVersion(store,b.storeVersion);const key=option(b.data?.key,diagnosisCatalog.map(d=>d.key),'진단 항목');const old=(await listRecords<StoreDiagnostic>(owner,'store_diagnostic',store.id)).find(d=>d.key===key);requireVersion(old,b.version);
  const record=diagnosisInput(b.data,store,old);await recordStatement(owner,'store_diagnostic',record.id,record,store.id).run();return json({id:record.id});
 }
 if(b.action==='save_order'||b.action==='import_orders'){
  const importing=b.action==='import_orders',rows=importing?b.rows:[b.data];if(!Array.isArray(rows)||!rows.length||rows.length>200)throw new ApiError(400,'한 번에 1~200개 주문을 저장하세요.');
  const writes:ReturnType<typeof recordStatement>[]=[],seen=new Set<string>(),ids:string[]=[];
  for(let index=0;index<rows.length;index++){
   try{const input=await orderInput(rows[index]||{},store.id);if(seen.has(input.id))throw new ApiError(409,'같은 출처·주문일·주문번호가 반복됩니다.');seen.add(input.id);
    const row=await database().prepare('SELECT data FROM records WHERE id=? AND owner=? AND kind=?').bind(`${owner}:store_order:${input.id}`,owner,'store_order').first<{data:string}>();const old=row?JSON.parse(row.data) as StoreOrder:undefined;
    if(b.id&&b.id!==input.id)throw new ApiError(400,'주문 출처·주문일·주문번호는 수정할 수 없습니다.');
    if(old&&(importing||!b.id))throw new ApiError(409,'이미 등록한 주문입니다. 기존 주문에서 수정하세요.');requireVersion(old,b.version);
    await validateOrderExperiment(owner,store.id,input.experimentId,input.orderDate,input.channel);
    const order:StoreOrder={...input,version:(old?.version||0)+1,createdAt:old?.createdAt||stamp(),updatedAt:stamp()};writes.push(recordStatement(owner,'store_order',order.id,order,store.id));ids.push(order.id);
   }catch(e){if(e instanceof ApiError)throw new ApiError(e.status,`${importing?index+2+'행: ':''}${e.message}`);throw e}
  }
  await database().batch(writes);return json({ids,count:ids.length});
 }
 if(b.action==='save_spend'){
  const id=str(b.data?.id,'비용 기록',100,true),old=(await listRecords<StoreSpend>(owner,'store_spend',store.id)).find(s=>s.id===id);requireVersion(old,b.version);
  // A supplied identifier must never overwrite another store's record.
  const existing=await database().prepare('SELECT parent_id FROM records WHERE id=? AND owner=? AND kind=?').bind(`${owner}:store_spend:${id}`,owner,'store_spend').first<{parent_id:string}>();if(existing&&existing.parent_id!==store.id)throw new ApiError(400,'다른 지점의 비용입니다.');
  const spend=spendInput(b.data,store.id,old);await validateOrderExperiment(owner,store.id,spend.experimentId,spend.date,spend.channel);await recordStatement(owner,'store_spend',id,spend,store.id).run();return json({id});
 }
 if(b.action==='ledger_measurement'){
  const experiment=await readRecord<StoreExperiment>(owner,'store_experiment',str(b.experimentId,'실험',100,true));if(experiment.storeId!==store.id)throw new ApiError(400,'다른 지점의 실험입니다.');if(experiment.status!=='running')throw new ApiError(409,'진행 중인 실험에만 성과를 가져올 수 있습니다.');
  const from=str(b.from,'시작일',10,true),to=str(b.to,'종료일',10,true),ops=await getStoreOperations(owner,store.id,from,to),orders=ops.orders.filter(o=>o.experimentId===experiment.id),spend=ops.spend.filter(s=>s.experimentId===experiment.id);
  if(!orders.length&&!spend.length)throw new ApiError(400,'선택 기간에 이 실험으로 연결한 주문이나 비용이 없습니다.');
  const old=b.id?await readRecord<StoreMeasurement>(owner,'store_measurement',str(b.id,'성과',100,true)):undefined;
  if(old&&(old.experimentId!==experiment.id||!old.ledgerSnapshot))throw new ApiError(400,'해당 실험의 장부 성과만 새로 가져올 수 있습니다.');requireVersion(old,b.version);
  const costsConfirmed=b.costsConfirmed===true;
  const measurement=measurementInput({periodStart:from,periodEnd:to,source:'주문 성과 장부',definition:str(b.definition,'수집 범위·누락·비용 기준',4000,true)+'\nAsia/Seoul · 실험에 연결한 주문·비용만 집계. 수기 성과와 합산하지 않음.',method:'export',cohortMatured:false,values:ledgerValues(orders,spend,costsConfirmed)},experiment,old);
  const all=await listRecords<StoreMeasurement>(owner,'store_measurement',store.id);if(all.some(m=>m.experimentId===experiment.id&&m.id!==measurement.id&&m.periodStart<=measurement.periodEnd&&m.periodEnd>=measurement.periodStart))throw new ApiError(409,'같은 실험에 겹치는 기간의 성과가 있습니다. 장부 성과는 기존 기록에서 새로 가져오세요.');
  const result={...measurement,ledgerSnapshot:ledgerSnapshot(orders,spend,costsConfirmed)};await recordStatement(owner,'store_measurement',result.id,result,store.id).run();return json({id:result.id});
 }
 throw new ApiError(400,'지원하지 않는 매장 운영 작업입니다.');
}catch(e){return failure(e)}finally{if(lock)await releaseLock(owner,lock)}}
