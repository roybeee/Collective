import {assessSourcing,sourcingText,type SourcingInventory,type CandidateInput} from './growth-sourcing';
import {executionId} from './growth-execution';
export class GrowthReorderError extends Error {}
export type ReorderInput={catalogId:string;catalogVersion:number;candidateId:string;candidateVersion:number;unit:'piece'|'pack';demand:{from:string;to:string;quantity:number|null;evidenceRef:string};coverageDays:number|null;safetyQuantity:number|null;outstanding:{state:'unknown'|'confirmed_none';observedAt:string|null;evidenceRef:string};purchaseBudget:number|null;budgetEvidenceRef:string;note:string};
export type ReorderAssessment={status:'held'|'reviewable';missing:string[];observedDays:number|null;demandPerDay:number|null;rawStock:number|null;reorderPoint:number|null;targetQuantity:number|null;neededQuantity:number|null;purchaseQuantity:number|null;daysUntilReorder:number|null;quoteSubtotal:number|null;cashNeed:number|null;budgetAssessment:'not_configured'|'unknown'|'within'|'exceeded';mayOrder:false;notice:string};
export function emptyReorderInput():ReorderInput{return {catalogId:'',catalogVersion:0,candidateId:'',candidateVersion:0,unit:'piece',demand:{from:'',to:'',quantity:null,evidenceRef:''},coverageDays:null,safetyQuantity:null,outstanding:{state:'unknown',observedAt:null,evidenceRef:''},purchaseBudget:null,budgetEvidenceRef:'',note:''}}
const fail=(s:string):never=>{throw new GrowthReorderError(s)};
function obj(v:unknown){if(!v||typeof v!=='object'||Array.isArray(v))return fail('재발주 검토 입력 객체를 확인하세요.');return v as Record<string,unknown>}
function num(v:unknown,label:string,min=0,nullable=true){if(v===null&&nullable)return null;if(typeof v!=='number'||!Number.isSafeInteger(v)||v<min)return fail(`${label}은 ${min} 이상의 안전한 정수 또는 미확인이어야 합니다.`);return v}
function text(v:unknown,label:string,max=1000){try{return sourcingText(v,label,false,max)}catch{return fail(`${label}에 개인정보·인증정보를 넣을 수 없습니다.`)}}
function id(v:unknown){try{return executionId(v)}catch{return fail('내부 식별자를 확인하세요.')}}
const kst=(at:number)=>new Date(at+9*3600000).toISOString().slice(0,10);
function day(v:unknown){if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(v)||!Number.isFinite(Date.parse(v))||new Date(v).toISOString().slice(0,10)!==v)return fail('수요 기준기간은 실제 날짜여야 합니다.');return v}
function instant(v:unknown,now:number){if(v===null)return null;if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(v))return fail('확인시각은 시간대가 명시된 시각이어야 합니다.');day(v.slice(0,10));const zone=v.endsWith('Z')?'Z':v.slice(-6),zoneValid=zone==='Z'||(Number(zone.slice(1,3))<=14&&Number(zone.slice(4))<60&&(Number(zone.slice(1,3))<14||Number(zone.slice(4))===0));const t=Date.parse(v);if(!Number.isFinite(t)||Number(v.slice(11,13))>23||Number(v.slice(14,16))>59||Number(v.slice(17,19))>59||!zoneValid||t>now)return fail('확인시각은 실제 현재 이전 시각이어야 합니다.');return new Date(t).toISOString()}
export function parseReorderInput(value:unknown,now=Date.now()):ReorderInput{
 const b=obj(value),d=obj(b.demand),o=obj(b.outstanding),from=day(d.from),to=day(d.to);if(from>to||to>kst(now))return fail('수요 기준기간은 순서대로, 한국시간 오늘까지 입력하세요.');if(!['piece','pack'].includes(String(b.unit))||!['unknown','confirmed_none'].includes(String(o.state)))return fail('단위·미입고 확인 상태를 확인하세요.');
 return {catalogId:id(b.catalogId),catalogVersion:num(b.catalogVersion,'상품 판',1,false)!,candidateId:id(b.candidateId),candidateVersion:num(b.candidateVersion,'견적 판',1,false)!,unit:b.unit as ReorderInput['unit'],demand:{from,to,quantity:num(d.quantity,'수요 가정 수량'),evidenceRef:text(d.evidenceRef,'수요 근거',160)},coverageDays:num(b.coverageDays,'추가 보유 일수'),safetyQuantity:num(b.safetyQuantity,'안전 수량'),outstanding:{state:o.state as ReorderInput['outstanding']['state'],observedAt:instant(o.observedAt,now),evidenceRef:text(o.evidenceRef,'미입고 근거',160)},purchaseBudget:num(b.purchaseBudget,'구매비 한도'),budgetEvidenceRef:text(b.budgetEvidenceRef,'한도 근거',160),note:text(b.note,'검토 메모')};
}
type Catalog={id:string;version:number;campaignVersion:number;input:{sku:string;taxBasis:string;validUntil:string;stockUnit?:'unknown'|'piece'|'pack'}};
type Candidate={id:string;version:number;campaignVersion:number;input:CandidateInput};
export function assessReorder(input:ReorderInput,catalog:Catalog,candidate:Candidate,inventory:SourcingInventory,campaignVersion:number,now=Date.now()):ReorderAssessment{
 const missing:string[]=[],q=candidate.input,observedDays=(Date.parse(input.demand.to)-Date.parse(input.demand.from))/86400000+1;
 const result:ReorderAssessment={status:'held',missing,observedDays:Number.isSafeInteger(observedDays)&&observedDays>0?observedDays:null,demandPerDay:null,rawStock:null,reorderPoint:null,targetQuantity:null,neededQuantity:null,purchaseQuantity:null,daysUntilReorder:null,quoteSubtotal:null,cashNeed:null,budgetAssessment:input.purchaseBudget===null?'not_configured':'unknown',mayOrder:false,notice:'수요 수량은 운영자 가정이며 주문 건수나 검증된 판매량이 아닙니다. 검토 일수는 가정이며 확정 발주일이 아닙니다. 실제 발주·입고·현금 이동은 실행하지 않습니다.'};
 const basis=assessSourcing({catalogId:input.catalogId,catalogVersion:input.catalogVersion,requestedQuantity:1,unit:input.unit,candidates:[{id:input.candidateId,version:input.candidateVersion}],note:''},catalog,[candidate],inventory,campaignVersion,now).rows[0];missing.push(...basis.missing);
 if(candidate.id!==input.candidateId||candidate.version!==input.candidateVersion||catalog.id!==input.catalogId)missing.push('상품·공급 후보 참조 변경');
 if(!input.demand.evidenceRef)missing.push('수요 가정 근거 미확인');if(input.demand.quantity===null)missing.push('수요 가정 수량 미확인');if(result.observedDays===null||input.demand.to>kst(now))missing.push('수요 기준기간 재확인');
 if(input.coverageDays===null||input.safetyQuantity===null)missing.push('보유 일수·안전 수량 미확인');
 const outstanding=input.outstanding.state==='confirmed_none'&&!!input.outstanding.evidenceRef&&input.outstanding.observedAt!==null&&Date.parse(input.outstanding.observedAt)<=now&&kst(Date.parse(input.outstanding.observedAt))===kst(now);
 if(!outstanding)missing.push('현재 한국시간 당일 미입고 없음 확인 필요');
 const unitsMatch=q.unit===input.unit&&(!catalog.input.stockUnit||catalog.input.stockUnit==='unknown'||catalog.input.stockUnit===input.unit);
 const stockKnown=unitsMatch&&inventory.status==='known'&&inventory.unit===input.unit&&q.unit===input.unit&&inventory.onHand!==null&&inventory.reserved!==null;
 if(!stockKnown)missing.push('현재 재고·예약 수량 및 단위 미확인');
 if(stockKnown)result.rawStock=inventory.onHand!-inventory.reserved!;
 if(result.observedDays!==null&&input.demand.quantity!==null){result.demandPerDay=input.demand.quantity/result.observedDays;
  if(unitsMatch&&q.leadDays!==null&&input.coverageDays!==null&&input.safetyQuantity!==null){
   const horizon=q.leadDays+input.coverageDays,a=input.demand.quantity*q.leadDays,b=input.demand.quantity*horizon;
   const point=Math.ceil(a/result.observedDays)+input.safetyQuantity,target=Math.ceil(b/result.observedDays)+input.safetyQuantity;
   if([horizon,a,b,point,target].every(Number.isSafeInteger)){result.reorderPoint=point;result.targetQuantity=target;
    if(result.rawStock!==null&&outstanding){const needed=Math.max(0,target-result.rawStock);if(Number.isSafeInteger(needed)){result.neededQuantity=needed;result.purchaseQuantity=needed===0?0:q.moq===null?null:Math.max(needed,q.moq);}else missing.push('필요 수량 안전 범위 초과');
     if(input.demand.quantity>0){const numerator=(result.rawStock-input.safetyQuantity)*result.observedDays;if(Number.isSafeInteger(numerator))result.daysUntilReorder=Math.max(0,Math.floor(numerator/input.demand.quantity)-q.leadDays);else missing.push('검토 일수 안전 범위 초과');}
    }
   }else missing.push('수요 계산 안전 범위 초과');
  }
 }
 if(result.purchaseQuantity===0){result.quoteSubtotal=0;result.cashNeed=0;}else if(result.purchaseQuantity!==null){
  const cost=assessSourcing({catalogId:input.catalogId,catalogVersion:input.catalogVersion,requestedQuantity:result.purchaseQuantity,unit:input.unit,candidates:[{id:input.candidateId,version:input.candidateVersion}],note:''},catalog,[candidate],inventory,campaignVersion,now).rows[0];result.quoteSubtotal=cost.totalCost;missing.push(...cost.missing.filter(x=>!missing.includes(x)));
  if(q.taxBasis==='included'&&catalog.input.taxBasis==='included')result.cashNeed=cost.totalCost;else missing.push('세금 포함 실제 구매 현금 미확인');
 }
 if(input.purchaseBudget!==null){if(!input.budgetEvidenceRef)missing.push('구매비 한도 근거 미확인');else if(result.cashNeed!==null){result.budgetAssessment=result.cashNeed<=input.purchaseBudget?'within':'exceeded';if(result.budgetAssessment==='exceeded')missing.push('구매비 한도 초과');}}
 result.status=missing.length?'held':'reviewable';return result;
}
