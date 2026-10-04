import type {Campaign} from './agency';
import {saveProviderCatalog} from './growth-provider-catalog-server';
import {readLandingProviderConnection} from './growth-provider-credential-server';
import {optionalRecord} from './growth-ledger-server';
import {acquireLock,releaseLock,database,ApiError,stamp,type Actor} from './server';
const kinds={state:'growth_provider_catalog_worker'} as const;
export const PROVIDER_CATALOG_INTERVAL_MS=300000;
const MAX_BACKOFF=21600000;
type Binding={id:string;brandId:string;storeId:string;campaignId:string;version:number;connectionVersion:number};
type WorkerState={id:string;brandId:string;storeId:string;campaignId:string;failures:number;nextAt:number;status:string;reason:string;checkedAt:string};
function safeObject(value:string|null):Record<string,unknown>|null{
 try{const parsed:unknown=JSON.parse(value??'null');return parsed&&typeof parsed==='object'&&!Array.isArray(parsed)?parsed as Record<string,unknown>:null}catch{return null}
}
async function due(owner:string,now:number){
 const prefix=owner+':growth_provider_catalog_binding:',workerJson="CASE WHEN json_valid(w.data) THEN w.data ELSE '{}' END",sourceJson="CASE WHEN json_valid(s.data) THEN s.data ELSE '{}' END";
 const deadline=`CASE WHEN json_type(${workerJson},'$.nextAt') IN ('integer','real') THEN MAX(json_extract(${workerJson},'$.nextAt'),0) ELSE 0 END`;
 return database().prepare(`SELECT b.data,b.parent_id,b.id recordId,w.data workerData FROM records b
 LEFT JOIN records w ON w.owner=b.owner AND w.kind=? AND w.id=?||substr(b.id,?)
 LEFT JOIN records s ON s.owner=b.owner AND s.kind='growth_provider_catalog_source' AND s.id=?||substr(b.id,?)
 WHERE b.owner=? AND b.kind='growth_provider_catalog_binding'
 AND MAX(${deadline},COALESCE((julianday(json_extract(${sourceJson},'$.checkedAt'))-2440587.5)*86400000+?,0))<=?
 ORDER BY MAX(${deadline},COALESCE((julianday(json_extract(${sourceJson},'$.checkedAt'))-2440587.5)*86400000+?,0)),b.id LIMIT 1`)
 .bind(kinds.state,owner+':'+kinds.state+':',prefix.length+1,owner+':growth_provider_catalog_source:',prefix.length+1,owner,PROVIDER_CATALOG_INTERVAL_MS,now,PROVIDER_CATALOG_INTERVAL_MS).first<{data:string;parent_id:string;recordId:string;workerData:string|null}>();
}
async function persist(owner:string,token:string,state:WorkerState){
 const r=await database().prepare('INSERT INTO records(id,owner,kind,parent_id,data,updated_at) SELECT ?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM mutation_locks WHERE owner=? AND token=? AND expires_at>=?) ON CONFLICT(id) DO UPDATE SET data=excluded.data,updated_at=excluded.updated_at WHERE records.owner=excluded.owner')
 .bind(owner+':'+kinds.state+':'+state.id,owner,kinds.state,state.storeId,JSON.stringify(state),stamp(),owner,token,Date.now()).run();
 if(!r.meta.changes)throw new ApiError(409,'상품 조회 작업 잠금이 만료되었습니다.');
}
/** Read-only provider refresh. Binding/review remains an explicit owner operation. */
export async function runProviderCatalogWorker(owner:string,now=Date.now()){
 if(!Number.isFinite(now))throw new ApiError(400,'상품 조회 시각을 확인하세요.');
 let token:string;try{token=await acquireLock(owner)}catch(e){if(e instanceof ApiError&&e.status===409)return {status:'skipped' as const,reason:'busy'};throw e}
 try{
  const row=await due(owner,now);if(!row)return {status:'idle' as const,reason:'not_due'};
  const parsed=safeObject(row.data),raw=(parsed??{}) as Partial<Binding>,id=row.recordId.slice((owner+':growth_provider_catalog_binding:').length),prior=safeObject(row.workerData);
  const priorFailures=typeof prior?.failures==='number'&&Number.isSafeInteger(prior.failures)&&prior.failures>=0?Math.min(prior.failures,20):0;
  const base:WorkerState={id,brandId:typeof raw.brandId==='string'?raw.brandId:'',storeId:row.parent_id,campaignId:typeof raw.campaignId==='string'?raw.campaignId:'',failures:priorFailures,nextAt:now+PROVIDER_CATALOG_INTERVAL_MS,status:'running',reason:'claimed',checkedAt:new Date(now).toISOString()};
  // Persist the minimum retry deadline before HTTP so process termination cannot produce a tight read loop.
  await persist(owner,token,base);
  let reason='ready',status:'processed'|'retry'|'skipped'='processed';
  try{
   const c=base.campaignId?await optionalRecord<Campaign>(owner,'campaign',base.campaignId):null;
   if(!parsed)reason='malformed_binding';
   else if(!c||c.status==='archived'||c.brandId!==raw.brandId||c.storeId!==raw.storeId||raw.storeId!==row.parent_id||raw.id!==id||!Number.isSafeInteger(raw.version))reason='campaign_unavailable';
   else{
    const connection=await readLandingProviderConnection(owner,c);
    if(!connection?.enabled||connection.version!==raw.connectionVersion)reason='connection_unavailable';
    else{
     const who:Actor={owner,id:'growth_provider_catalog_worker',role:'owner',email:null};
     await saveProviderCatalog(who,c,{action:'pull',campaignVersion:c.version,id,expectedVersion:raw.version,requestId:crypto.randomUUID()},{leaseToken:token});
     const source=await optionalRecord<{status:string}>(owner,'growth_provider_catalog_source',id);
     if(source?.status!=='ready')reason='source_unavailable';
    }
   }
   status=reason==='ready'?'processed':reason==='source_unavailable'?'retry':'skipped';
  }catch{status='retry';reason='pull_failed'}
  const failures=status==='processed'?0:Math.min(base.failures+1,20),nextAt=now+(failures?Math.min(MAX_BACKOFF,PROVIDER_CATALOG_INTERVAL_MS*2**(failures-1)):PROVIDER_CATALOG_INTERVAL_MS);
  await persist(owner,token,{...base,status,reason,failures,nextAt});
  return {status,reason,id,nextAt};
 }finally{await releaseLock(owner,token)}
}
