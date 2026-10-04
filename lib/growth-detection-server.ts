import type {Campaign} from './agency';
import {detectSignals,THRESHOLDS,type Detection,type OrderPoint} from './growth-detection';
import {growthView} from './growth-workspace-server';
import {growthReturnReasonView} from './growth-return-reasons-server';
import {growthCsView} from './growth-cs-server';
import {campaignRows,inCampaign,versionedMutation,type Versioned} from './growth-ledger-server';
import {storefrontDigest} from './storefront-orders';
import {ApiError,database,stamp,str,type Actor} from './server';
const kinds={current:'growth_detected_signal',history:'growth_detected_signal_history',request:'growth_detected_signal_request'} as const;
export type DetectedSignalRecord=Versioned&{detection:Detection;status:'new'|'acknowledged'|'dismissed';triage:{assignee:string;nextAction:string;dueBy:string}|null;dismissReason:string;detectedAt:string;detectedBy:'daily_loop'|'operator';updatedAt:string;updatedBy:string};
const idOf=async(c:Campaign,key:string)=>'sig-'+(await storefrontDigest({brandId:c.brandId,campaignId:c.id,key})).slice(0,32);
async function inputs(owner:string,c:Campaign,now:number){
 const from=new Date(now-35*86400000).toISOString().slice(0,10);
 const orders=c.storeId?(await database().prepare("SELECT data FROM records WHERE owner=? AND kind='store_order' AND parent_id=? AND json_extract(data,'$.campaignId')=? AND json_extract(data,'$.orderDate')>=? LIMIT 20001").bind(owner,c.storeId,c.id,from).all<{data:string}>()).results.map(r=>JSON.parse(r.data) as OrderPoint):[];
 const view=await growthView(owner,c,true),since=new Date(now-THRESHOLDS.recentDays*86400000).toISOString();
 const ships=c.storeId?(await database().prepare("SELECT data FROM records WHERE owner=? AND kind='growth_stock_event' AND json_extract(data,'$.campaignId')=? AND json_extract(data,'$.kind')='ship' AND json_extract(data,'$.observedAt')>=? LIMIT 5001").bind(owner,c.id,since).all<{data:string}>()).results.map(r=>JSON.parse(r.data) as {inventoryId:string;quantity:number}):[];
 const stock=view.catalogs.map(x=>({sku:x.input.sku,available:x.currentStock?.status==='known'?x.currentStock.available:null,status:x.currentStock?.status??'held',recentUnits:ships.filter(s=>s.inventoryId===x.currentStock?.inventoryId).reduce((n,s)=>n+(Number.isSafeInteger(s.quantity)?s.quantity:0),0)}));
 return {orders,stock};
}
/** Stores only new detection keys; an existing key (any status) is never re-opened or overwritten. */
export async function runGrowthDetection(who:Pick<Actor,'owner'|'id'|'role'|'email'>,c:Campaign,by:'daily_loop'|'operator',now=Date.now()){
 const [{orders,stock},reasons,cs]=await Promise.all([inputs(who.owner,c,now),growthReturnReasonView(who as Actor,c),growthCsView(who as Actor,c)]);
 const detections=detectSignals({now,orders,stock,returns:reasons.events.filter(e=>e.current&&e.sourceStatus==='current'&&e.observedAt).map(e=>({reasonCode:e.current!.input.reasonCode,observedAt:e.observedAt!})),csRecurring:cs.recurring.recurring});
 const at=stamp(),writes:D1PreparedStatement[]=[];let created=0;
 for(const d of detections){const id=await idOf(c,d.key);const exists=await database().prepare("SELECT 1 FROM records WHERE owner=? AND kind=? AND parent_id=? AND json_extract(data,'$.brandId')=? AND json_extract(data,'$.detection.key')=?").bind(who.owner,kinds.current,c.id,c.brandId,d.key).first();if(exists)continue;created++;
  const row:DetectedSignalRecord={id,brandId:c.brandId,campaignId:c.id,version:1,detection:d,status:'new',triage:null,dismissReason:'',detectedAt:at,detectedBy:by,updatedAt:at,updatedBy:who.id};
  writes.push(database().prepare('INSERT INTO records(id,owner,kind,parent_id,data,updated_at) VALUES(?,?,?,?,?,?)').bind(`${who.owner}:${kinds.current}:${id}`,who.owner,kinds.current,c.id,JSON.stringify(row),at),database().prepare('INSERT INTO records(id,owner,kind,parent_id,data,updated_at) VALUES(?,?,?,?,?,?)').bind(`${who.owner}:${kinds.history}:${id}:1`,who.owner,kinds.history,c.id,JSON.stringify(row),at));}
 const total=await database().prepare('SELECT COUNT(*) n FROM records WHERE owner=? AND kind=? AND parent_id=?').bind(who.owner,kinds.current,c.id).first<{n:number}>();
 if((total?.n??0)+created>2000)throw new ApiError(409,'감지 신호 보관 한도에 도달했습니다. 오래된 신호를 정리하세요.');
 if(writes.length)await database().batch(writes);
 return {detected:detections.length,created};
}
export async function growthDetectionView(who:Actor,c:Campaign){
 const [rows,history]=await Promise.all([campaignRows<DetectedSignalRecord>(who.owner,c,kinds.current,2000),campaignRows<DetectedSignalRecord>(who.owner,c,kinds.history,20000)]);
 const order={new:0,acknowledged:1,dismissed:2} as const,today=new Date().toISOString().slice(0,10);
 const signals=rows.filter(r=>inCampaign(r,c)).map(r=>({...r,overdue:r.status==='acknowledged'&&!!r.triage&&r.triage.dueBy<today})).sort((a,b)=>order[a.status]-order[b.status]||b.detectedAt.localeCompare(a.detectedAt));
 return {campaignId:c.id,campaignVersion:c.version,signals,history:history.filter(h=>inCampaign(h,c)).slice(-500),thresholds:THRESHOLDS,canEdit:who.role!=='member',isForecast:false as const,mayExecute:false as const};
}
export type GrowthDetectionView=Awaited<ReturnType<typeof growthDetectionView>>;
export async function saveGrowthDetection(who:Actor,c:Campaign,b:Record<string,unknown>){
 const action=String(b.action??'');
 if(action==='detect'){if(b.campaignVersion!==c.version)throw new ApiError(409,'캠페인이 변경되었습니다.');if(c.status==='archived')throw new ApiError(409,'보관한 캠페인은 감지하지 않습니다.');return {recorded:true as const,...await runGrowthDetection(who,c,'operator'),mayExecute:false as const}}
 const id=str(b.id,'신호 ID',100,true);
 return versionedMutation<DetectedSignalRecord>(who,c,b,kinds,id,{action,triage:b.triage,reason:b.reason},async(old,at)=>{
  if(!old)throw new ApiError(404,'감지 신호를 찾지 못했습니다.');
  if(action==='acknowledge'){
   const t=b.triage as Record<string,unknown>|undefined,text=(v:unknown,label:string,max:number)=>{if(typeof v!=='string'||!v.trim()||v.length>max)throw new ApiError(400,`${label}을(를) 입력하세요.`);return v.trim()};
   const dueBy=String(t?.dueBy??'');if(!/^\d{4}-\d{2}-\d{2}$/.test(dueBy)||new Date(dueBy+'T00:00:00Z').toISOString().slice(0,10)!==dueBy)throw new ApiError(400,'기한을 YYYY-MM-DD로 입력하세요.');
   if(old.status==='dismissed')throw new ApiError(409,'기각한 신호는 다시 열지 않습니다.');
   return {next:{...old,version:old.version+1,status:'acknowledged',triage:{assignee:text(t?.assignee,'담당',100),nextAction:text(t?.nextAction,'다음 행동',500),dueBy},updatedAt:at,updatedBy:who.id},limit:2000};
  }
  if(action==='dismiss'){if(old.status==='dismissed')throw new ApiError(409,'이미 기각했습니다.');const reason=String(b.reason??'').trim();if(!reason||reason.length>500)throw new ApiError(400,'기각 사유를 입력하세요.');return {next:{...old,version:old.version+1,status:'dismissed',dismissReason:reason,updatedAt:at,updatedBy:who.id},limit:2000}}
  throw new ApiError(400,'지원하지 않는 감지 신호 작업입니다.');
 });
}
