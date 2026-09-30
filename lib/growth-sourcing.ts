import {executionSafeText,executionId} from './growth-execution';
export class GrowthSourcingError extends Error {}
export type CandidateInput={catalogId:string;catalogVersion:number;supplierCode:string;currency:'KRW';unit:'unknown'|'piece'|'pack';unitCost:number|null;moq:number|null;leadDays:number|null;shippingCost:number|null;extraCost:number|null;taxBasis:'unknown'|'included'|'excluded';validUntil:string;evidenceRef:string;note:string};
export type ComparisonInput={catalogId:string;catalogVersion:number;requestedQuantity:number;unit:'piece'|'pack';candidates:{id:string;version:number}[];note:string};
export function emptyCandidateInput():CandidateInput{return {catalogId:'',catalogVersion:0,supplierCode:'',currency:'KRW',unit:'unknown',unitCost:null,moq:null,leadDays:null,shippingCost:null,extraCost:null,taxBasis:'unknown',validUntil:'',evidenceRef:'',note:''}}
export function emptyComparisonInput():ComparisonInput{return {catalogId:'',catalogVersion:0,requestedQuantity:1,unit:'piece',candidates:[],note:''}}
function fail(s:string):never{throw new GrowthSourcingError(s)}
function obj(v:unknown){if(!v||typeof v!=='object'||Array.isArray(v))return fail('소싱 입력 객체를 확인하세요.');return v as Record<string,unknown>}
function number(v:unknown,label:string,min=0,nullable=true){if(v===null&&nullable)return null;if(typeof v!=='number'||!Number.isSafeInteger(v)||v<min)return fail(`${label}은 ${min} 이상의 안전한 정수${nullable?' 또는 미확인':''}여야 합니다.`);return v}
export function sourcingText(v:unknown,label:string,required=false,max=1000){if(v===undefined||v===''){if(required)return fail(`${label}을 입력하세요.`);return ''}try{return executionSafeText(v,label,max)}catch{return fail(`${label}에 식별정보·인증정보를 넣을 수 없습니다.`)}}
function id(v:unknown){try{return executionId(v)}catch{return fail('개인정보 없는 내부 식별자를 입력하세요.')}}
function day(v:unknown){const s=sourcingText(v,'견적 유효일',false,10);if(s&&(!/^\d{4}-\d{2}-\d{2}$/.test(s)||!Number.isFinite(Date.parse(s))||new Date(s).toISOString().slice(0,10)!==s))return fail('유효일은 실제 날짜여야 합니다.');return s}
export function parseCandidateInput(value:unknown):CandidateInput{
 const b=obj(value);if(b.currency!=='KRW'||!['unknown','included','excluded'].includes(String(b.taxBasis))||!['unknown','piece','pack'].includes(String(b.unit)))return fail('통화·세금 기준·수량 단위를 확인하세요.');
 return {catalogId:id(b.catalogId),catalogVersion:number(b.catalogVersion,'상품 판',1,false)!,supplierCode:id(b.supplierCode),currency:'KRW',unit:b.unit as CandidateInput['unit'],unitCost:number(b.unitCost,'단위 원가'),moq:number(b.moq,'최소 수량',1),leadDays:number(b.leadDays,'납기 일수'),shippingCost:number(b.shippingCost,'고정 배송비'),extraCost:number(b.extraCost,'고정 추가 비용'),taxBasis:b.taxBasis as CandidateInput['taxBasis'],validUntil:day(b.validUntil),evidenceRef:sourcingText(b.evidenceRef,'견적 근거',false,160),note:sourcingText(b.note,'검토 메모')};
}
export function parseComparisonInput(value:unknown):ComparisonInput{
 const b=obj(value);if(!Array.isArray(b.candidates)||b.candidates.length<1||b.candidates.length>20||!['piece','pack'].includes(String(b.unit)))return fail('동일 단위 후보를 1~20개 선택하세요.');
 const candidates=b.candidates.map(v=>{const r=obj(v);return {id:id(r.id),version:number(r.version,'후보 판',1,false)!}});
 if(new Set(candidates.map(r=>r.id)).size!==candidates.length)return fail('같은 공급 후보를 중복 선택할 수 없습니다.');
 return {catalogId:id(b.catalogId),catalogVersion:number(b.catalogVersion,'상품 판',1,false)!,requestedQuantity:number(b.requestedQuantity,'요청 수량',1,false)!,unit:b.unit as ComparisonInput['unit'],candidates,note:sourcingText(b.note,'비교 메모')};
}
type Candidate={id:string;version:number;campaignVersion:number;input:CandidateInput};
type Catalog={id:string;version:number;campaignVersion:number;input:{sku:string;taxBasis:string;validUntil:string}};
export type SourcingInventory={status:'known'|'unknown';unit:'piece'|'pack';onHand:number|null;reserved:number|null;available:number|null;shortage:number|null;items:{id:string;version:number}[];reason:string};
function currentDay(now:number){return new Date(now+9*3600000).toISOString().slice(0,10)}
function catalogExpiry(value:string){
 const match=/^(\d{4}-\d{2}-\d{2})(?:T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|[+-]\d{2}:\d{2}))?$/.exec(value);
 if(!match)return null;const [,date,hour,minute,second,zone]=match,at=Date.parse(date+'T00:00:00Z');
 if(!Number.isFinite(at)||new Date(at).toISOString().slice(0,10)!==date||(hour!==undefined&&(Number(hour)>23||Number(minute)>59||Number(second)>59)))return null;
 if(zone&&zone!=='Z'&&(Number(zone.slice(1,3))>14||Number(zone.slice(4))>59||(Number(zone.slice(1,3))===14&&Number(zone.slice(4))!==0)))return null;
 return hour===undefined?at+15*3600000:Date.parse(value);
}
export function assessSourcing(input:ComparisonInput,catalog:Catalog,candidates:Candidate[],inventory:Pick<SourcingInventory,'status'|'unit'|'onHand'|'reserved'|'available'|'shortage'>,campaignVersion:number,now=Date.now()){
 const today=currentDay(now),rows=candidates.map(candidate=>{
  const q=candidate.input,missing:string[]=[];
  if(catalog.version!==input.catalogVersion||catalog.campaignVersion!==campaignVersion||q.catalogId!==catalog.id||q.catalogVersion!==catalog.version||candidate.campaignVersion!==campaignVersion)missing.push('상품·캠페인·견적 판 변경 후 재검토');
  if(q.taxBasis==='unknown'||catalog.input.taxBasis==='unknown'||q.taxBasis!==catalog.input.taxBasis)missing.push('상품과 견적 세금 기준 확인');
  if(q.unit!==input.unit)missing.push('구매 수량·단위원가 단위 일치 확인');
  if(!q.validUntil||q.validUntil<today)missing.push('견적 만료 또는 유효일 미확인');
  const deadline=catalogExpiry(catalog.input.validUntil);if(deadline===null||deadline<=now)missing.push('상품 근거 유효기간 재확인');
  if(!q.evidenceRef)missing.push('공급 견적 근거 미확인');
  for(const [key,label] of [['unitCost','단위 원가'],['moq','최소 수량'],['leadDays','납기'],['shippingCost','고정 배송비'],['extraCost','고정 추가비']] as const)if(q[key]===null)missing.push(`${label} 미확인`);
  const quantity=q.moq===null||q.unit!==input.unit?null:Math.max(input.requestedQuantity,q.moq);
  let totalCost:number|null=null;
  if(quantity!==null&&q.unitCost!==null&&q.shippingCost!==null&&q.extraCost!==null){const product=quantity*q.unitCost,total=product+q.shippingCost+q.extraCost;if(Number.isSafeInteger(product)&&Number.isSafeInteger(total))totalCost=total;else missing.push('비용 합계 안전 범위 초과');}
  let projectedAvailable:number|null=null,projectedShortage:number|null=null;
  if(inventory.status==='known'&&inventory.unit===input.unit&&q.unit===input.unit&&quantity!==null&&inventory.onHand!==null&&inventory.reserved!==null){const projected=inventory.onHand+quantity;if(Number.isSafeInteger(projected)){projectedAvailable=Math.max(0,projected-inventory.reserved);projectedShortage=Math.max(0,inventory.reserved-projected);}else missing.push('입고 가정 수량 안전 범위 초과');}
  return {candidateId:candidate.id,candidateVersion:candidate.version,supplierCode:q.supplierCode,status:missing.length?'held' as const:'comparable' as const,missing,quantity,totalCost,effectiveUnitCost:totalCost!==null&&quantity!==null?totalCost/quantity:null,leadDays:q.leadDays,projectedAvailable,projectedShortage};
 });
 return {rows,mayOrder:false as const,notice:'MOQ는 최소 수량이며 발주 배수 조건은 확인하지 않았습니다. 비용과 재고 증가는 비교 가정이며 발주·입고·현금 이동을 실행하지 않습니다.'};
}
