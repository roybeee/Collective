import {scanText} from './pii-scan';
export class GrowthCsError extends Error {}
export const csCategories=['shipping_delay','product_question','option_change','cancel_request','return_request','refund_request','defect_report','other'] as const;
export const csChannels=['phone','chat','email','marketplace','other'] as const;
export const csResolutions=['answered','shipped','exchanged','returned','refunded','no_action','other'] as const;
export type CsTicketInput={category:typeof csCategories[number];channel:typeof csChannels[number];summary:string;lineId:string;receivedAt:string;promisedBy:string;assignee:string;priority:'normal'|'high'};
export type CsStatus='open'|'responded'|'resolved'|'cancelled';
export type CsEvent={action:'respond'|'resolve'|'reopen'|'cancel';at:string;evidenceRef:string;resolution?:typeof csResolutions[number];note:string;recordedAt:string;recordedBy:string};
function fail(m:string):never{throw new GrowthCsError(m)}
const control=/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
/** Operator summary only: raw customer messages, names, contacts and addresses are rejected rather than stored. */
function text(v:unknown,label:string,max:number,required=true){if((v===undefined||v==='')&&!required)return '';if(typeof v!=='string'||!v.trim()||v.length>max||control.test(v))fail(`${label}: 1~${max}자 문자열을 입력하세요.`);if(scanText(v.normalize('NFKC')).length||/(?:주소|address)\s*[:：]|["“”].{20,}["“”]/i.test(v))fail(`${label}: 고객 원문·연락처·주소 대신 운영자 요약만 입력하세요.`);return v.trim()}
const ident=(v:unknown,label:string,required=true)=>{const r=text(v,label,100,required);if(r&&!/^[A-Za-z0-9_-]+$/.test(r))fail(`${label}: 내부 식별자 형식을 확인하세요.`);return r};
const instant=(v:unknown,label:string,now:number,allowFuture:boolean)=>{const r=text(v,label,40);const t=Date.parse(r);if(!Number.isFinite(t))fail(`${label}: 시각 형식을 확인하세요.`);if(!allowFuture&&t>now+60_000)fail(`${label}: 현재 이전이어야 합니다.`);return new Date(t).toISOString()};
function choice<T extends string>(v:unknown,values:readonly T[],label:string):T{if(!values.includes(v as T))fail(`${label}: 지원하는 값을 선택하세요.`);return v as T}
export function parseCsTicket(value:unknown,now=Date.now()):CsTicketInput{
 if(!value||typeof value!=='object'||Array.isArray(value))fail('문의 입력을 확인하세요.');const b=value as Record<string,unknown>;
 const receivedAt=instant(b.receivedAt,'접수 시각',now,false),promisedBy=instant(b.promisedBy,'약속 기한',now,true);if(Date.parse(promisedBy)<Date.parse(receivedAt))fail('약속 기한은 접수 이후여야 합니다.');
 return {category:choice(b.category,csCategories,'문의 유형'),channel:choice(b.channel,csChannels,'접수 경로'),summary:text(b.summary,'운영자 요약',500),lineId:ident(b.lineId,'주문 품목 ID',false),receivedAt,promisedBy,assignee:text(b.assignee,'담당',100),priority:choice(b.priority,['normal','high'] as const,'우선순위')};
}
const transitions:Record<CsEvent['action'],{from:CsStatus[];to:CsStatus}>={respond:{from:['open'],to:'responded'},resolve:{from:['open','responded'],to:'resolved'},reopen:{from:['resolved'],to:'open'},cancel:{from:['open','responded'],to:'cancelled'}};
export function parseCsEvent(status:CsStatus,value:unknown,receivedAt:string,now=Date.now()){
 if(!value||typeof value!=='object'||Array.isArray(value))fail('처리 기록을 확인하세요.');const b=value as Record<string,unknown>;
 const action=choice(b.action,['respond','resolve','reopen','cancel'] as const,'처리 종류');if(!transitions[action].from.includes(status))fail(`현재 상태(${status})에서 할 수 없는 처리입니다.`);
 const at=instant(b.at,'처리 시각',now,false);if(Date.parse(at)<Date.parse(receivedAt))fail('처리 시각은 접수 이후여야 합니다.');
 const event:Omit<CsEvent,'recordedAt'|'recordedBy'>={action,at,evidenceRef:ident(b.evidenceRef,'처리 증빙 ID'),note:text(b.note,'처리 메모',500,false)};
 if(action==='resolve')event.resolution=choice(b.resolution,csResolutions,'해결 방법');
 return {event,to:transitions[action].to};
}
/** Service level from the operator's own promise: overdue means unresolved past the promised time, never a customer satisfaction score. */
export function csServiceLevel(t:{status:CsStatus;input:CsTicketInput;events:CsEvent[]},now=Date.now()){
 const firstResponse=t.events.find(e=>e.action==='respond'||e.action==='resolve'),resolved=[...t.events].reverse().find(e=>e.action==='resolve');
 const promised=Date.parse(t.input.promisedBy),open=t.status==='open'||t.status==='responded';
 return {overdue:open&&now>promised,resolvedLate:t.status==='resolved'&&!!resolved&&Date.parse(resolved.at)>promised,firstResponseHours:firstResponse?Math.round((Date.parse(firstResponse.at)-Date.parse(t.input.receivedAt))/360000)/10:null};
}
export function csRecurring(tickets:{input:CsTicketInput;status:CsStatus}[],now=Date.now(),days=30,threshold=3){
 const since=now-days*86400000,counts=new Map<string,number>();for(const t of tickets){if(t.status==='cancelled'||Date.parse(t.input.receivedAt)<since)continue;counts.set(t.input.category,(counts.get(t.input.category)??0)+1)}
 return {windowDays:days,counts:csCategories.map(c=>({category:c,tickets:counts.get(c)??0})),recurring:csCategories.filter(c=>(counts.get(c)??0)>=threshold),basis:'ticket_count_not_rate' as const};
}
