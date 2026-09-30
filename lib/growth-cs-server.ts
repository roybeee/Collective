import type {Campaign} from './agency';
import {csRecurring,csServiceLevel,parseCsEvent,parseCsTicket,type CsEvent,type CsStatus,type CsTicketInput} from './growth-cs';
import {campaignRows,inCampaign,optionalRecord,versionedMutation,type Versioned} from './growth-ledger-server';
import {ApiError,str,type Actor} from './server';
const kinds={current:'growth_cs_ticket',history:'growth_cs_ticket_history',request:'growth_cs_ticket_request'} as const;
export type CsTicketRecord=Versioned&{status:CsStatus;input:CsTicketInput;events:CsEvent[];line:{id:string;version:number}|null;createdAt:string;updatedAt:string;updatedBy:string};
type Line={id:string;brandId:string;campaignId:string;storeId:string;version:number};
export async function growthCsView(who:Actor,c:Campaign){
 const [rows,history,reasons]=await Promise.all([campaignRows<CsTicketRecord>(who.owner,c,kinds.current,2000),campaignRows<CsTicketRecord>(who.owner,c,kinds.history,20000),campaignRows<{eventId:string;brandId:string;campaignId:string;snapshot:{lineId:string};input:{reasonCode:string};version:number}>(who.owner,c,'growth_return_reason',500)]);
 const now=Date.now(),own=rows.filter(r=>inCampaign(r,c));
 const tickets=await Promise.all(own.map(async r=>{const line=r.line?await optionalRecord<Line>(who.owner,'growth_order_line',r.line.id):null;return {...r,service:csServiceLevel(r,now),lineStatus:!r.line?'none' as const:line&&line.version===r.line.version&&line.campaignId===c.id?'current' as const:'held' as const,returnReasons:r.line?reasons.filter(x=>inCampaign(x,c)&&x.snapshot.lineId===r.line!.id).map(x=>({eventId:x.eventId,reasonCode:x.input.reasonCode,version:x.version})):[]}}));
 return {campaignId:c.id,campaignVersion:c.version,tickets:tickets.sort((a,b)=>Number(b.service.overdue)-Number(a.service.overdue)||a.input.promisedBy.localeCompare(b.input.promisedBy)),history:history.filter(h=>inCampaign(h,c)).slice(-500),recurring:csRecurring(own,now),open:own.filter(t=>t.status==='open'||t.status==='responded').length,overdue:tickets.filter(t=>t.service.overdue).length,canEdit:who.role!=='member',mayReply:false as const,mayRefund:false as const};
}
export type GrowthCsView=Awaited<ReturnType<typeof growthCsView>>;
export async function saveGrowthCs(who:Actor,c:Campaign,b:Record<string,unknown>){
 const id=str(b.id,'문의 ID',100,true),action=String(b.action??'');
 if(action==='save_ticket'){
  const input=parseCsTicket(b.input);
  return versionedMutation<CsTicketRecord>(who,c,b,kinds,id,{action,input},async(old,at)=>{
   if(old&&old.status!=='open')throw new ApiError(409,'응답·해결된 문의의 접수 내용은 바꾸지 않습니다. 처리 기록을 추가하세요.');
   let line:CsTicketRecord['line']=null;
   if(input.lineId){const l=await optionalRecord<Line>(who.owner,'growth_order_line',input.lineId);if(!l||l.campaignId!==c.id||l.brandId!==c.brandId)throw new ApiError(404,'현재 캠페인의 주문 품목이 아닙니다.');line={id:l.id,version:l.version};}
   return {next:{id,brandId:c.brandId,campaignId:c.id,version:(old?.version??0)+1,status:'open',input,events:old?.events??[],line,createdAt:(old as CsTicketRecord|null)?.createdAt??at,updatedAt:at,updatedBy:who.id},limit:2000};
  });
 }
 if(action==='record_event'){
  return versionedMutation<CsTicketRecord>(who,c,b,kinds,id,{action,event:b.event},async(old,at)=>{
   if(!old)throw new ApiError(404,'문의를 찾지 못했습니다.');
   let parsed;try{parsed=parseCsEvent(old.status,b.event,old.input.receivedAt)}catch(e){throw new ApiError(409,e instanceof Error?e.message:'처리를 확인하세요.')}
   const last=old.events.at(-1);if(last&&Date.parse(parsed.event.at)<Date.parse(last.at))throw new ApiError(409,'처리 시각은 이전 처리 이후여야 합니다.');
   return {next:{...old,version:old.version+1,status:parsed.to,events:[...old.events,{...parsed.event,recordedAt:at,recordedBy:who.id}],updatedAt:at,updatedBy:who.id},limit:2000};
  });
 }
 throw new ApiError(400,'지원하지 않는 문의 작업입니다.');
}
