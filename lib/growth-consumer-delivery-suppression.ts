import {database} from './server';
/** Included in the consent/erase transaction: no provider calls can obstruct withdrawal. */
export function deliverySuppression(owner:string,brandId:string,customerId:string,purpose:string|null,erase:boolean,requestId:string,at:string){
 const filter="owner=? AND json_extract(data,'$.brandId')=? AND json_extract(data,'$.customerId')=?";
 const specific=purpose&&purpose!=='identity_link'?" AND json_extract(data,'$.input.purpose')=?":'',args=[owner,brandId,customerId,...(specific?[purpose]:[])];
 const statements:D1PreparedStatement[]=[];
 if(erase){
  for(const kind of ['growth_cs_source','growth_cs_source_history'])statements.push(database().prepare("UPDATE records SET data=json_set(data,'$.customerId',NULL,'$.externalOrderId',NULL,'$.sourceDigest',NULL,'$.order',NULL,'$.status','withdrawn','$.erased',json('true')) WHERE owner=? AND kind=? AND json_extract(data,'$.brandId')=? AND json_extract(data,'$.customerId')=?").bind(owner,kind,brandId,customerId));
  statements.push(database().prepare(`UPDATE records SET data=json_remove(data,'$.digest') WHERE owner=? AND kind='growth_consumer_delivery_request' AND json_extract(data,'$.id') IN (SELECT json_extract(data,'$.id') FROM records WHERE kind='growth_consumer_delivery' AND ${filter})`).bind(owner,owner,brandId,customerId));
  statements.push(database().prepare(`UPDATE records SET data=json_set(data,'$.customerId',NULL,'$.input',NULL,'$.approval',NULL,'$.payload',NULL) WHERE kind='growth_consumer_delivery_history' AND ${filter}`).bind(owner,brandId,customerId));
 }
 statements.push(database().prepare(`UPDATE records SET updated_at=?,data=json_set(data,'$.version',json_extract(data,'$.version')+1,'$.status',CASE WHEN json_extract(data,'$.status')='queued' THEN 'failed' ELSE json_extract(data,'$.status') END,'$.suppressed',json('true'),'$.cancelPending',json(CASE WHEN json_extract(data,'$.status') IN ('unknown','accepted') THEN 'true' ELSE 'false' END),'$.updatedAt',?,'$.suppressionRequestId',?${erase?",'$.customerId',NULL,'$.input',NULL,'$.approval',NULL,'$.payload',NULL":''}) WHERE kind='growth_consumer_delivery' AND ${filter}${specific}`).bind(at,at,requestId,...args));
 statements.push(database().prepare("INSERT INTO records(id,owner,kind,parent_id,data,updated_at) SELECT owner||':growth_consumer_delivery_history:'||json_extract(data,'$.id')||':'||json_extract(data,'$.version'),owner,'growth_consumer_delivery_history',parent_id,data,? FROM records WHERE owner=? AND kind='growth_consumer_delivery' AND json_extract(data,'$.suppressionRequestId')=?").bind(at,owner,requestId));
 return statements;
}
