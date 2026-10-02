import {scanText} from './pii-scan';

export type JourneyObservation = {
  windowStart:string; windowEnd:string; observedAt:string; delayHours:number|null;
  tracking:'unknown'|'reliable'|'broken'; sourceUrls:string[]; evidence:string;
  denominator:number|null; conversions:number|null; paidOrders:number|null;
  refundedOrders:number|null; contributionProfit:number|null;
};
export type JourneyInput = {
  title:string; stage:'inflow'|'click'|'product'|'cart'|'checkout'|'delivery';
  hypothesis:string; alternativeExplanation:string; offerId:string; offerVersion:number;
  missionId:string; missionVersion:number; segment:string;
  channel:'storefront'|'organic'|'meta'|'manual'; device:'all'|'mobile'|'desktop';
  denominatorDefinition:string; denominatorUnit:'visitor'|'session'|'order';
  before:JourneyObservation; after:JourneyObservation; action:string; assignee:string;
  dueAt:string; appliedAt:string; factEvidence:string; handoffReason:string;
};
export type JourneyAssessment = {
  missing:string[];
  comparison:{status:'not_measured'|'held'|'observed'; reasons:string[]; conversionDeltaPp:number|null; refundDeltaPp:number|null; profitDelta:number|null};
  mayExecute:false; causalStatus:'not_measured';
};
export class GrowthJourneyError extends Error {
  constructor(message:string) { super(message); this.name='GrowthJourneyError'; }
}
export function emptyJourneyObservation():JourneyObservation {
  return {windowStart:'',windowEnd:'',observedAt:'',delayHours:null,tracking:'unknown',sourceUrls:[],evidence:'',
    denominator:null,conversions:null,paidOrders:null,refundedOrders:null,contributionProfit:null};
}
export function emptyJourneyInput():JourneyInput {
  return {title:'',stage:'product',hypothesis:'',alternativeExplanation:'',offerId:'',offerVersion:0,
    missionId:'',missionVersion:0,segment:'',channel:'storefront',device:'all',denominatorDefinition:'',denominatorUnit:'visitor',
    before:emptyJourneyObservation(),after:emptyJourneyObservation(),action:'',assignee:'',dueAt:'',appliedAt:'',factEvidence:'',handoffReason:''};
}
function object(value:unknown):Record<string,unknown> {
  if (!value || typeof value!=='object' || Array.isArray(value)) throw new GrowthJourneyError('입력은 객체여야 합니다.');
  return value as Record<string,unknown>;
}
function safeText(value:unknown,field:string,max=2000):string {
  if (value===undefined) return '';
  if (typeof value!=='string' || value.length>max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) {
    throw new GrowthJourneyError(`${field}: 유효한 문자열을 입력하세요(최대 ${max}자).`);
  }
  const normalized=value.normalize('NFKC').replace(/[\u200b-\u200d\u2060\ufeff]/g,'');
  if (scanText(normalized).length || /(?:bearer\s+\S+|(?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret)\s*[:=]\s*\S+|\bsk-(?:proj-)?[\w-]{8,}|-----BEGIN [A-Z ]*PRIVATE KEY-----)/i.test(normalized)) {
    throw new GrowthJourneyError(`${field}: 식별정보와 인증정보를 넣을 수 없습니다.`);
  }
  return value.trim();
}
function identifier(value:unknown,field:string):string {
  const result=safeText(value,field,100);
  if (result && !/^[A-Za-z0-9_.:-]+$/.test(result)) throw new GrowthJourneyError(`${field}: 내부 식별자를 입력하세요.`);
  return result;
}
function number(value:unknown,field:string,fallback:number|null):number|null {
  if (value===undefined) return fallback;
  if (value===null && fallback===null) return null;
  if (typeof value!=='number' || !Number.isSafeInteger(value) || value<0) throw new GrowthJourneyError(`${field}: 0 이상의 안전한 정수를 입력하세요.`);
  return value;
}
function choice<T extends string>(value:unknown,values:readonly T[],fallback:T,field:string):T {
  if (value===undefined) return fallback;
  if (typeof value!=='string' || !values.includes(value as T)) throw new GrowthJourneyError(`${field}: 지원하는 값을 선택하세요.`);
  return value as T;
}
function publicUrl(value:unknown):string {
  const result=safeText(value,'공개 URL',2048);
  if (!result) return '';
  let url:URL;
  try { url=new URL(result); } catch { throw new GrowthJourneyError('공개 URL 형식이 유효하지 않습니다.'); }
  const host=url.hostname.toLowerCase();
  const publicDomain=/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/.test(host) && !/(^|\.)(localhost|local|internal|test|invalid|lan|home|onion)$/.test(host);
  if (url.protocol!=='https:' || url.username || url.password || url.port || !publicDomain || /[\s\\?#]/.test(result)) {
    throw new GrowthJourneyError('공개 URL은 인증정보·쿼리·해시 없는 공개 HTTPS 주소여야 합니다.');
  }
  let path=url.pathname;
  for (let round=0;round<4;round++) {
    let decoded:string;
    try { decoded=decodeURIComponent(path); } catch { throw new GrowthJourneyError('URL 인코딩을 확인하세요.'); }
    safeText(decoded,'URL 경로',2048);
    if (decoded===path) return result;
    path=decoded;
  }
  throw new GrowthJourneyError('URL 경로가 과도하게 인코딩되어 있습니다.');
}
function strings(value:unknown,field:string,max:number,parse:(item:unknown)=>string):string[] {
  if (value===undefined) return [];
  if (!Array.isArray(value) || value.length>max) throw new GrowthJourneyError(`${field}: 최대 ${max}개 배열이어야 합니다.`);
  return [...new Set(value.map(item=>{
    const result=parse(item);
    if (!result) throw new GrowthJourneyError(`${field}: 빈 항목을 넣을 수 없습니다.`);
    return result;
  }))];
}
const DAY=86_400_000;
const CAP=1_000_000_000_000;
function date(value:unknown,field:string):string {
  const result=safeText(value,field,10);
  if (!result) return '';
  const timestamp=Date.parse(`${result}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(result) || !Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0,10)!==result) {
    throw new GrowthJourneyError(`${field}: 실제 YYYY-MM-DD 날짜를 입력하세요.`);
  }
  return result;
}
function metric(value:unknown,field:string,signed=false):number|null {
  if (value===undefined || value===null) return null;
  if (typeof value!=='number' || !Number.isSafeInteger(value) || Math.abs(value)>CAP || (!signed && value<0)) {
    throw new GrowthJourneyError(`${field}: 허용 범위 내 안전한 정수를 입력하세요.`);
  }
  return value;
}
function parseObservation(value:unknown):JourneyObservation {
  const input=object(value===undefined?{}:value);
  const result:JourneyObservation={windowStart:date(input.windowStart,'관측 시작'),windowEnd:date(input.windowEnd,'관측 종료'),
    observedAt:date(input.observedAt,'관측일'),delayHours:metric(input.delayHours,'보고 지연'),
    tracking:choice(input.tracking,['unknown','reliable','broken'],'unknown','추적 신뢰'),
    sourceUrls:strings(input.sourceUrls,'출처 URL',20,publicUrl),evidence:safeText(input.evidence,'관측 근거'),
    denominator:metric(input.denominator,'분모'),conversions:metric(input.conversions,'전환'),paidOrders:metric(input.paidOrders,'결제 주문'),
    refundedOrders:metric(input.refundedOrders,'환불 주문'),contributionProfit:metric(input.contributionProfit,'공헌이익',true)};
  if (result.windowStart && result.windowEnd && result.windowStart>result.windowEnd) throw new GrowthJourneyError('관측 종료는 시작보다 빠를 수 없습니다.');
  if (result.denominator!==null && result.conversions!==null && result.conversions>result.denominator) throw new GrowthJourneyError('전환은 분모보다 클 수 없습니다.');
  if (result.paidOrders!==null && result.refundedOrders!==null && result.refundedOrders>result.paidOrders) throw new GrowthJourneyError('환불 주문은 결제 주문보다 클 수 없습니다.');
  return result;
}
export function parseJourneyInput(value:unknown):JourneyInput {
  const input=object(value);
  return {title:safeText(input.title,'제목',200),stage:choice(input.stage,['inflow','click','product','cart','checkout','delivery'],'product','단계'),
    hypothesis:safeText(input.hypothesis,'가설'),alternativeExplanation:safeText(input.alternativeExplanation,'대체 설명'),
    offerId:identifier(input.offerId,'오퍼 ID'),offerVersion:number(input.offerVersion,'오퍼 버전',0)!,
    missionId:identifier(input.missionId,'미션 ID'),missionVersion:number(input.missionVersion,'미션 버전',0)!,
    segment:safeText(input.segment,'세그먼트'),channel:choice(input.channel,['storefront','organic','meta','manual'],'storefront','채널'),
    device:choice(input.device,['all','mobile','desktop'],'all','기기'),denominatorDefinition:safeText(input.denominatorDefinition,'분모 정의'),
    denominatorUnit:choice(input.denominatorUnit,['visitor','session','order'],'visitor','분모 단위'),
    before:parseObservation(input.before),after:parseObservation(input.after),action:safeText(input.action,'조치'),assignee:safeText(input.assignee,'담당'),
    dueAt:date(input.dueAt,'기한'),appliedAt:date(input.appliedAt,'적용일'),factEvidence:safeText(input.factEvidence,'사실 근거'),handoffReason:safeText(input.handoffReason,'인계 사유')};
}
function kstStart(value:string):number { return Date.parse(`${value}T00:00:00+09:00`); }
function observationReasons(observation:JourneyObservation,label:string,now:number):string[] {
  const reasons:string[]=[];
  if (!observation.windowStart || !observation.windowEnd || !observation.observedAt) reasons.push(`${label}: 관측창과 관측일을 입력하세요.`);
  if (observation.tracking!=='reliable') reasons.push(`${label}: 추적 신뢰를 확인하세요.`);
  if (!observation.sourceUrls.length || !observation.evidence) reasons.push(`${label}: 관측 출처와 근거를 연결하세요.`);
  if (observation.delayHours===null) reasons.push(`${label}: 보고 지연을 확인하세요.`);
  if (observation.observedAt && kstStart(observation.observedAt)>now) reasons.push(`${label}: 미래 관측일을 사용할 수 없습니다.`);
  if (observation.windowEnd && observation.observedAt && observation.delayHours!==null) {
    const matureAt=kstStart(observation.windowEnd)+DAY+observation.delayHours*3_600_000;
    // A date-only observation is conservatively evaluated at the start of that KST day.
    if (matureAt>now || kstStart(observation.observedAt)<matureAt) reasons.push(`${label}: 관측 종료와 보고 지연이 지나지 않았습니다.`);
  }
  return reasons;
}
function rate(numerator:number|null,denominator:number|null):number|null {
  return numerator===null || denominator===null || denominator===0?null:numerator/denominator;
}
function delta(before:number|null,after:number|null,scale=1):number|null {
  return before===null || after===null?null:Number(((after-before)*scale).toFixed(10));
}
/** Observational comparison is never causal evidence, a resolution decision, or permission to execute. */
export function journeyAssessment(value:JourneyInput,upstream:string[]=[],now=Date.now()):JourneyAssessment {
  const input=parseJourneyInput(value);
  const required:readonly [string,string][]=[[input.title,'제목'],[input.hypothesis,'가설'],[input.alternativeExplanation,'대체 설명'],
    [input.action,'조치'],[input.assignee,'담당'],[input.dueAt,'기한'],[input.segment,'세그먼트'],[input.denominatorDefinition,'분모 정의'],[input.factEvidence,'사실 근거']];
  const missing=[...upstream,...required.filter(([value])=>!value).map(([,label])=>`${label}를 입력하세요.`),
    ...(!input.offerId || input.offerVersion<1?['현재 오퍼와 버전을 연결하세요.']:[]),
    ...(!input.missionId || input.missionVersion<1?['현재 미션과 버전을 연결하세요.']:[]),
    ...(!input.factEvidence && !input.handoffReason?['사실 근거가 없으면 상담·추천 인계 사유를 입력하세요.']:[])];
  const {before,after}=input;
  const reasons=[...missing,...observationReasons(before,'변경 전',now),...observationReasons(after,'변경 후',now)];
  if (!Number.isFinite(now)) reasons.push('평가 시각이 유효하지 않습니다.');
  if (!input.appliedAt) reasons.push('실제 적용일을 입력하세요.');
  if (before.windowStart && before.windowEnd && after.windowStart && after.windowEnd) {
    if (kstStart(before.windowEnd)-kstStart(before.windowStart)!==kstStart(after.windowEnd)-kstStart(after.windowStart)) reasons.push('비교 관측창 길이가 같아야 합니다.');
    if (before.windowEnd>=after.windowStart) reasons.push('전후 관측창이 겹치거나 순서가 잘못되었습니다.');
    if (input.appliedAt && (before.windowEnd>=input.appliedAt || input.appliedAt>after.windowStart)) reasons.push('적용일은 변경 전 종료 이후, 변경 후 시작 이하여야 합니다.');
  }
  const conversionDeltaPp=delta(rate(before.conversions,before.denominator),rate(after.conversions,after.denominator),100);
  const refundDeltaPp=delta(rate(before.refundedOrders,before.paidOrders),rate(after.refundedOrders,after.paidOrders),100);
  const profitDelta=delta(before.contributionProfit,after.contributionProfit);
  const measured=[conversionDeltaPp,refundDeltaPp,profitDelta].some(value=>value!==null);
  const status=!measured?'not_measured':reasons.length?'held':'observed';
  return {missing:[...new Set(missing)],comparison:{status,reasons:[...new Set(reasons)],
    conversionDeltaPp:status==='observed'?conversionDeltaPp:null,refundDeltaPp:status==='observed'?refundDeltaPp:null,
    profitDelta:status==='observed'?profitDelta:null},mayExecute:false,causalStatus:'not_measured'};
}
