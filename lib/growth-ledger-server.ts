import type {Campaign} from './agency';
import {storefrontDigest} from './storefront-orders';
import {ApiError,database,readRecord,recordStatement,stamp,type Actor} from './server';
/** Shared plumbing for campaign-scoped growth records: exact current row + append-only history + UUID request replay in one batch. */
export type Scoped={brandId:string;campaignId:string};
export const uuidPattern=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export async function optionalRecord<T>(owner:string,kind:string,id:string){try{return await readRecord<T>(owner,kind,id)}catch(e){if(e instanceof ApiError&&e.status===404)return null;throw e}}
export const inCampaign=(x:Scoped,c:Campaign)=>x.brandId===c.brandId&&x.campaignId===c.id;
export async function campaignRows<T>(owner:string,c:Campaign,kind:string,limit:number){const r=await database().prepare('SELECT data FROM records WHERE owner=? AND kind=? AND parent_id=? LIMIT ?').bind(owner,kind,c.id,limit+1).all<{data:string}>();if(r.results.length>limit)throw new ApiError(409,'조회 한도를 넘었습니다. 전체 기록을 대사하세요.');return r.results.map(x=>JSON.parse(x.data) as T)}
export async function campaignCapacity(owner:string,c:Campaign,kind:string,limit:number){const r=await database().prepare('SELECT COUNT(*) n FROM records WHERE owner=? AND kind=? AND parent_id=?').bind(owner,kind,c.id).first<{n:number}>();if((r?.n??0)>=limit)throw new ApiError(409,'보관 한도에 도달했습니다.')}
export function appendRow(owner:string,c:Campaign,kind:string,id:string,value:unknown,at:string){return database().prepare('INSERT INTO records(id,owner,kind,parent_id,data,updated_at) VALUES(?,?,?,?,?,?)').bind(`${owner}:${kind}:${id}`,owner,kind,c.id,JSON.stringify(value),at)}
export type Versioned=Scoped&{id:string;version:number};
type Kinds={current:string;history:string;request:string};
/**
 * Runs one versioned mutation. `build` receives the current row (or null) and returns the next row plus extra statements;
 * CAS on expectedVersion, UUID replay with digest check and campaign version are enforced here.
 */
export async function versionedMutation<T extends Versioned>(who:Actor,c:Campaign,b:Record<string,unknown>,kinds:Kinds,id:string,payload:unknown,build:(old:T|null,at:string)=>Promise<{next:T;extra?:D1PreparedStatement[];limit?:number}>){
 if(b.campaignVersion!==c.version)throw new ApiError(409,'캠페인이 변경되었습니다. 다시 불러오세요.');
 const requestId=String(b.requestId??'');if(!uuidPattern.test(requestId)||!Number.isSafeInteger(b.expectedVersion)||Number(b.expectedVersion)<0)throw new ApiError(400,'요청 번호와 기록 판을 확인하세요.');
 if(!/^[A-Za-z0-9_-]{1,100}$/.test(id))throw new ApiError(400,'기록 ID 형식을 확인하세요.');
 const digest=await storefrontDigest({id,campaignId:c.id,campaignVersion:c.version,expectedVersion:b.expectedVersion,payload});
 const [request,old]=await Promise.all([optionalRecord<{digest:string;id:string;version:number}>(who.owner,kinds.request,requestId),optionalRecord<T>(who.owner,kinds.current,id)]);
 if(request){if(request.digest!==digest)throw new ApiError(409,'같은 요청 번호의 내용이 다릅니다.');return {recorded:true as const,id,version:old?.version??request.version,duplicate:true,mayExecute:false as const}}
 if(old&&!inCampaign(old,c))throw new ApiError(404,'다른 캠페인의 기록입니다.');
 if(b.expectedVersion!==(old?.version??0))throw new ApiError(409,'기록이 변경되었습니다. 입력을 보존하고 다시 불러오세요.');
 const at=stamp(),{next,extra=[],limit=500}=await build(old,at);
 if(!old)await campaignCapacity(who.owner,c,kinds.current,limit);await campaignCapacity(who.owner,c,kinds.history,limit*10);await campaignCapacity(who.owner,c,kinds.request,limit*20);
 await database().batch([...extra,recordStatement(who.owner,kinds.current,id,next,c.id),appendRow(who.owner,c,kinds.history,`${id}:${next.version}`,next,at),appendRow(who.owner,c,kinds.request,requestId,{digest,id,version:next.version},at)]);
 return {recorded:true as const,id,version:next.version,duplicate:false,mayExecute:false as const};
}
