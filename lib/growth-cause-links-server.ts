import type {Campaign} from './agency';
import {growthReturnReasonView,type ReturnReasonRecord} from './growth-return-reasons-server';
import {causeDistribution,causeLinkId,parseCauseLinkInput,type CauseLinkInput,type CauseLinkSnapshot,type CauseTargetKind} from './growth-cause-links';
import {storefrontDigest} from './storefront-orders';
import {ApiError,database,readRecord,recordStatement,stamp,type Actor} from './server';
const kinds={current:'growth_cause_link',history:'growth_cause_link_history',request:'growth_cause_link_request'} as const;
const targetKinds:Record<CauseTargetKind,string>={journey:'growth_journey',decision:'growth_decision',lesson:'growth_lesson'};
type Target={id:string;brandId:string;campaignId:string;version:number;input:{title:string;missionId:string}};
export type CauseLinkRecord={id:string;brandId:string;campaignId:string;version:number;status:'active'|'retired';input:CauseLinkInput;snapshot:CauseLinkSnapshot;source:'operator_linked';requestDigest:string;recordedAt:string;recordedBy:string};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
async function optional<T>(owner:string,kind:string,id:string){try{return await readRecord<T>(owner,kind,id)}catch(e){if(e instanceof ApiError&&e.status===404)return null;throw e}}
const scoped=(x:{brandId:string;campaignId:string},c:Campaign)=>x.brandId===c.brandId&&x.campaignId===c.id;
async function rows<T>(owner:string,c:Campaign,kind:string,limit:number){const r=await database().prepare('SELECT data FROM records WHERE owner=? AND kind=? AND parent_id=? LIMIT ?').bind(owner,kind,c.id,limit+1).all<{data:string}>();if(r.results.length>limit)throw new ApiError(409,'원인 연결 조회 한도를 넘었습니다.');return r.results.map(x=>JSON.parse(x.data) as T)}
async function capacity(owner:string,c:Campaign,kind:string,limit:number){const r=await database().prepare('SELECT COUNT(*) n FROM records WHERE owner=? AND kind=? AND parent_id=?').bind(owner,kind,c.id).first<{n:number}>();if((r?.n??0)>=limit)throw new ApiError(409,'원인 연결 보관 한도에 도달했습니다.')}
function append(owner:string,c:Campaign,kind:string,id:string,value:unknown,at:string){return database().prepare('INSERT INTO records(id,owner,kind,parent_id,data,updated_at) VALUES(?,?,?,?,?,?)').bind(`${owner}:${kind}:${id}`,owner,kind,c.id,JSON.stringify(value),at)}
const reasonDigest=(r:ReturnReasonRecord)=>storefrontDigest({id:r.id,version:r.version,input:r.input,snapshot:r.snapshot});
function day(v:unknown,fallback:string){if(v===null||v===undefined||v==='')return fallback;if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(v)||new Date(v+'T00:00:00Z').toISOString().slice(0,10)!==v)throw new ApiError(400,'관측 기간은 YYYY-MM-DD 날짜여야 합니다.');return v}
export async function growthCauseLinkView(who:Actor,c:Campaign,q:{from?:unknown;to?:unknown}={}){
 const today=new Date().toISOString().slice(0,10),to=day(q.to,today),from=day(q.from,new Date(Date.parse(to+'T00:00:00Z')-29*86400000).toISOString().slice(0,10));
 if(from>to||Date.parse(to)-Date.parse(from)>366*86400000)throw new ApiError(400,'관측 기간은 시작≤끝, 최대 1년입니다.');
 const [reasons,links,history,...targetRows]=await Promise.all([growthReturnReasonView(who,c),rows<CauseLinkRecord>(who.owner,c,kinds.current,500),rows<CauseLinkRecord>(who.owner,c,kinds.history,2000),...Object.values(targetKinds).map(k=>rows<Target>(who.owner,c,k,500))]);
 const targets=Object.fromEntries(Object.keys(targetKinds).map((k,i)=>[k,targetRows[i].filter(t=>scoped(t,c))])) as Record<CauseTargetKind,Target[]>;
 const events=reasons.events,assess=async(l:CauseLinkRecord)=>{
  if(l.status==='retired')return null;
  const e=events.find(x=>x.eventId===l.input.eventId),t=targets[l.input.targetKind].find(x=>x.id===l.input.targetId),why:string[]=[];
  if(!e||e.sourceStatus!=='current'||!e.current)why.push('원인 기록의 원본 사건·품목이 현재 확인되지 않습니다.');
  else if(e.current.version!==l.snapshot.reasonVersion||await reasonDigest(e.current)!==l.snapshot.reasonSnapshotDigest)why.push('연결 뒤 원인 기록이 개정되었습니다. 다시 검토하세요.');
  if(!t)why.push('연결한 검토 기록이 없습니다.');else if(t.version!==l.snapshot.targetVersion)why.push('연결한 검토 기록이 개정되었습니다.');
  return {status:why.length?'held' as const:'current' as const,reasons:why};
 };
 const records=await Promise.all(links.filter(l=>scoped(l,c)).map(async l=>({...l,assessment:await assess(l)})));
 const distribution=causeDistribution(events.map(e=>({eventId:e.eventId,lineId:e.lineId,kind:e.kind,observedAt:e.observedAt,sourceStatus:e.sourceStatus,reasonCode:e.current?.input.reasonCode??null,reasonVersion:e.current?.version??null})),{from,to});
 return {campaignId:c.id,campaignVersion:c.version,distribution,events:events.filter(e=>e.current).map(e=>({eventId:e.eventId,lineId:e.lineId,kind:e.kind,reasonCode:e.current!.input.reasonCode,reasonVersion:e.current!.version,sourceStatus:e.sourceStatus})),targets:Object.fromEntries(Object.entries(targets).map(([k,v])=>[k,v.map(t=>({id:t.id,version:t.version,title:t.input.title,missionId:t.input.missionId}))])) as Record<CauseTargetKind,{id:string;version:number;title:string;missionId:string}[]>,records,history:history.filter(h=>scoped(h,c)),canEdit:who.role!=='member'&&c.status!=='archived',mayExecute:false as const,mayPromote:false as const};
}
export type GrowthCauseLinkView=Awaited<ReturnType<typeof growthCauseLinkView>>;
export async function saveGrowthCauseLink(who:Actor,c:Campaign,b:Record<string,unknown>){
 if(b.campaignVersion!==c.version)throw new ApiError(409,'캠페인이 변경되었습니다. 다시 불러오세요.');
 const requestId=String(b.requestId??'');if(!uuid.test(requestId)||!Number.isSafeInteger(b.expectedVersion)||Number(b.expectedVersion)<0)throw new ApiError(400,'요청 번호와 연결 판을 확인하세요.');
 if(b.action!=='link'&&b.action!=='retire')throw new ApiError(400,'지원하지 않는 원인 연결 작업입니다.');
 const input=parseCauseLinkInput(b.input),id=causeLinkId(input),digest=await storefrontDigest({action:b.action,campaignId:c.id,campaignVersion:c.version,input,expectedVersion:b.expectedVersion});
 const [request,old]=await Promise.all([optional<{digest:string;id:string;version:number}>(who.owner,kinds.request,requestId),optional<CauseLinkRecord>(who.owner,kinds.current,id)]),ack=(version:number,duplicate:boolean)=>({recorded:true as const,id,version,duplicate,mayExecute:false as const});
 if(request){if(request.digest!==digest)throw new ApiError(409,'같은 요청 번호의 내용이 다릅니다.');return ack(old?.version??request.version,true)}
 if(old&&!scoped(old,c))throw new ApiError(404,'다른 캠페인의 원인 연결입니다.');
 if(b.expectedVersion!==(old?.version??0))throw new ApiError(409,'원인 연결이 변경되었습니다. 다시 불러오세요.');
 const at=stamp();let record:CauseLinkRecord;
 if(b.action==='retire'){if(!old||old.status==='retired')throw new ApiError(409,'해제할 활성 연결이 없습니다.');record={...old,version:old.version+1,status:'retired',requestDigest:digest,recordedAt:at,recordedBy:who.id};}
 else{
  if(c.status==='archived')throw new ApiError(409,'보관한 캠페인에는 새 연결을 만들 수 없습니다.');
  const reasons=await growthReturnReasonView(who,c),e=reasons.events.find(x=>x.eventId===input.eventId);
  if(!e||!e.current)throw new ApiError(404,'원인이 기록된 현재 캠페인의 사건이 아닙니다.');
  if(e.sourceStatus!=='current')throw new ApiError(409,'원인 기록의 원본 사건·품목이 보류 상태입니다.');
  if(e.current.version!==input.reasonVersion)throw new ApiError(409,'원인 기록이 개정되었습니다. 다시 불러오세요.');
  const line=await readRecord<{id:string;brandId:string;campaignId:string;input:{missionId:string}}>(who.owner,'growth_order_line',e.lineId);
  const target=await optional<Target>(who.owner,targetKinds[input.targetKind],input.targetId);
  if(!target||!scoped(target,c))throw new ApiError(404,'현재 캠페인의 검토 기록이 아닙니다.');
  if(target.version!==input.targetVersion)throw new ApiError(409,'검토 기록이 개정되었습니다. 다시 불러오세요.');
  if(!line.input.missionId||line.input.missionId!==target.input.missionId)throw new ApiError(409,'원인 사건의 품목 미션과 검토 기록의 미션이 같아야 합니다.');
  if(!old)await capacity(who.owner,c,kinds.current,500);
  record={id,brandId:c.brandId,campaignId:c.id,version:(old?.version??0)+1,status:'active',input,snapshot:{reasonVersion:e.current.version,reasonCode:e.current.input.reasonCode,reasonSnapshotDigest:await reasonDigest(e.current),lineId:e.lineId,missionId:line.input.missionId,targetVersion:target.version,targetMissionId:target.input.missionId},source:'operator_linked',requestDigest:digest,recordedAt:at,recordedBy:who.id};
 }
 await capacity(who.owner,c,kinds.history,2000);await capacity(who.owner,c,kinds.request,5000);
 await database().batch([recordStatement(who.owner,kinds.current,id,record,c.id),append(who.owner,c,kinds.history,`${id}:${record.version}`,record,at),append(who.owner,c,kinds.request,requestId,{digest,id,version:record.version},at)]);
 return ack(record.version,false);
}
