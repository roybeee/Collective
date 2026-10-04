import {scanText} from './pii-scan';
import {GrowthExperimentError} from './growth-experiment';
export const EXPERIMENT_EVENT_DOMAIN='collective.growth-experiment.events.v1';
export const experimentEventPath=(id:string)=>'/api/growth/experiments/events/'+id;
export type ExperimentEvent={eventId:string;action:'assign'|'exposure'|'tracking_close'|'withdraw';campaignId:string;designId:string;designVersion:number;registrationDigest:string;unitKey:string;revision:number;occurredAt:string;consent:{granted:boolean;noticeVersion:string;observedAt:string};trackingComplete?:boolean;contaminated?:boolean;trackingThrough?:string;orders?:{externalId:string;revision:number}[]};
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
function fail(message:string):never{throw new GrowthExperimentError(message)}
function object(value:unknown,keys:string[]){if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!keys.includes(k)))fail('실험 사건에 허용된 필드만 전송하세요. 금액·군·고객 정보는 받지 않습니다.');return value as Record<string,unknown>}
function id(value:unknown){if(typeof value!=='string'||!/^[A-Za-z0-9_-]{1,100}$/.test(value)||scanText(value).length||/^(?:sk-|gh[pousr]_|github_pat_|xox[baprs]-)/i.test(value))fail('식별정보 없는 내부 근거 ID를 사용하세요.');return value}
function revision(value:unknown){if(typeof value!=='number'||!Number.isSafeInteger(value)||value<1||value>1e9)fail('사건·설계 판은 양의 정수여야 합니다.');return value}
function instant(value:unknown){if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)||!Number.isFinite(Date.parse(value)))fail('UTC ISO 사건 시각을 확인하세요.');const canonical=new Date(value).toISOString();if(canonical.slice(0,19)!==value.slice(0,19))fail('실제 날짜·시각을 입력하세요.');return canonical}
export function parseExperimentEvent(raw:string,now=Date.now()):ExperimentEvent{
 let value:unknown;try{value=JSON.parse(raw)}catch{fail('실험 사건 JSON을 확인하세요.')}
 const common=['eventId','action','campaignId','designId','designVersion','registrationDigest','unitKey','revision','occurredAt','consent'];
 const action=(value as {action?:unknown}|null)?.action;if(!['assign','exposure','tracking_close','withdraw'].includes(String(action)))fail('지원하지 않는 실험 사건입니다.');
 const b=object(value,action==='tracking_close'?[...common,'trackingComplete','contaminated','trackingThrough','orders']:common);
 if(typeof b.eventId!=='string'||!uuid.test(b.eventId)||typeof b.unitKey!=='string'||!uuid.test(b.unitKey))fail('사건 ID와 가명 단위 키는 무작위 UUID v4여야 합니다.');
 if(typeof b.registrationDigest!=='string'||!/^[a-f0-9]{64}$/.test(b.registrationDigest))fail('사전등록 digest를 확인하세요.');
 const consent=object(b.consent,['granted','noticeVersion','observedAt']),occurredAt=instant(b.occurredAt),consentAt=instant(consent.observedAt);
 if(typeof consent.granted!=='boolean'||(action==='withdraw'?consent.granted:!consent.granted))fail('유효한 측정 동의가 필요하며 철회 사건은 동의 해제로 전송하세요.');
 if(Date.parse(occurredAt)>now||Date.parse(consentAt)>Date.parse(occurredAt))fail('미래 사건·동의 시각은 수신하지 않습니다.');
 const event:ExperimentEvent={eventId:b.eventId.toLowerCase(),action:action as ExperimentEvent['action'],campaignId:id(b.campaignId),designId:id(b.designId),designVersion:revision(b.designVersion),registrationDigest:b.registrationDigest,unitKey:b.unitKey.toLowerCase(),revision:revision(b.revision),occurredAt,consent:{granted:consent.granted,noticeVersion:id(consent.noticeVersion),observedAt:consentAt}};
 if(action==='tracking_close'){
  if(typeof b.trackingComplete!=='boolean'||typeof b.contaminated!=='boolean'||!Array.isArray(b.orders)||b.orders.length>20)fail('추적 완료·오염 상태와 주문 근거(최대 20개)를 확인하세요.');
  const trackingThrough=instant(b.trackingThrough);if(Date.parse(trackingThrough)>Date.parse(occurredAt))fail('미래 구간을 추적 완료로 선언할 수 없습니다.');
  const orders=b.orders.map(value=>{const order=object(value,['externalId','revision']);return {externalId:id(order.externalId),revision:revision(order.revision)}});
  if(new Set(orders.map(o=>o.externalId)).size!==orders.length)fail('같은 주문 근거를 중복 전송할 수 없습니다.');
  return {...event,trackingComplete:b.trackingComplete,contaminated:b.contaminated,trackingThrough,orders};
 }
 return event;
}
export async function verifyExperimentEventSignature(secret:string,connectionId:string,timestamp:string,signature:string,raw:string,now=Date.now()){
 if(!/^\d{10}$/.test(timestamp)||Math.abs(Math.floor(now/1000)-Number(timestamp))>300||!/^sha256=[a-f0-9]{64}$/.test(signature))return false;
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['verify']);
 return crypto.subtle.verify('HMAC',key,Uint8Array.from(signature.slice(7).match(/../g)!,v=>parseInt(v,16)),new TextEncoder().encode(`${EXPERIMENT_EVENT_DOMAIN}\nPOST\n${experimentEventPath(connectionId)}\n${timestamp}\n${raw}`));
}
