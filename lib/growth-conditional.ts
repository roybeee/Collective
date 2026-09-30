import {scanText} from './pii-scan';
export class GrowthConditionalError extends Error {}
function fail(m:string):never{throw new GrowthConditionalError(m)}
const control=/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
const text=(v:unknown,label:string,max:number,required=true)=>{if((v===undefined||v==='')&&!required)return '';if(typeof v!=='string'||!v.trim()||v.length>max||control.test(v))fail(`${label}: 1~${max}자 문자열입니다.`);if(scanText(v.normalize('NFKC')).length)fail(`${label}: 식별정보를 넣을 수 없습니다.`);return v.trim()};
const httpsUrl=(v:unknown,label:string)=>{if(v===undefined||v==='')return '';if(typeof v!=='string'||v.length>2048)fail(`${label}을(를) 확인하세요.`);let u:URL;try{u=new URL(v)}catch{return fail(`${label} 형식을 확인하세요.`)}if(u.protocol!=='https:'||u.username||u.password)fail(`${label}은(는) 인증정보 없는 HTTPS 주소입니다.`);return u.toString()};
// ---------- G2-20 GEO / structured product data ----------
export type ProductDataInput={offerId:string;offerVersion:number;title:string;sku:string;price:number|null;priceApproved:boolean;rightsConfirmed:boolean;landingUrl:string;brandName:string;available:number|null;stockStatus:string};
/** schema.org Product JSON-LD for the operator to place on the page. Structured data is not an exposure or citation guarantee. */
export function productStructuredData(p:ProductDataInput){
 const missing=[...(!p.priceApproved||p.price===null?['승인된 오퍼 가격이 필요합니다.']:[]),...(!p.rightsConfirmed?['판매 권리 확인이 필요합니다.']:[]),...(!p.landingUrl?['상세페이지 URL이 필요합니다.']:[])];
 if(missing.length)return {ready:false as const,missing,jsonLd:null};
 const availability=p.stockStatus==='known'&&p.available!==null?(p.available>0?'https://schema.org/InStock':'https://schema.org/OutOfStock'):undefined;
 return {ready:true as const,missing:[],jsonLd:{'@context':'https://schema.org','@type':'Product',name:p.title,sku:p.sku,brand:{'@type':'Brand',name:p.brandName},offers:{'@type':'Offer',price:String(p.price),priceCurrency:'KRW',url:p.landingUrl,...(availability?{availability}:{})}}};
}
export const geoEngines=['chatgpt','perplexity','gemini','google_ai_overview','naver','other'] as const;
export type GeoObservationInput={engine:typeof geoEngines[number];query:string;observedAt:string;cited:boolean;citedUrl:string;referralSessions:number|null;note:string};
export function parseGeoObservation(value:unknown,now=Date.now()):GeoObservationInput{
 if(!value||typeof value!=='object'||Array.isArray(value))fail('관측 입력을 확인하세요.');const b=value as Record<string,unknown>;
 if(!geoEngines.includes(b.engine as GeoObservationInput['engine']))fail('AI 답변 서비스를 선택하세요.');if(typeof b.cited!=='boolean')fail('인용 여부를 선택하세요.');
 const at=text(b.observedAt,'관측 시각',40);if(!Number.isFinite(Date.parse(at))||Date.parse(at)>now+60_000)fail('관측 시각은 현재 이전이어야 합니다.');
 const sessions=b.referralSessions===null||b.referralSessions===undefined?null:typeof b.referralSessions==='number'&&Number.isSafeInteger(b.referralSessions)&&b.referralSessions>=0?b.referralSessions:fail('유입 세션 수는 0 이상 정수 또는 미확인입니다.');
 const citedUrl=httpsUrl(b.citedUrl,'인용 URL');if(b.cited===false&&citedUrl)fail('인용되지 않은 관측에는 인용 URL을 넣지 않습니다.');
 return {engine:b.engine as GeoObservationInput['engine'],query:text(b.query,'질문',300),observedAt:new Date(Date.parse(at)).toISOString(),cited:b.cited,citedUrl,referralSessions:sessions,note:text(b.note,'메모',500,false)};
}
/** Citations, inflow and orders stay separate; no rate is claimed from a handful of manual checks. */
export function geoSummary(rows:GeoObservationInput[]){
 const byEngine=geoEngines.map(e=>{const r=rows.filter(x=>x.engine===e);return {engine:e,checks:r.length,cited:r.filter(x=>x.cited).length}}).filter(x=>x.checks);
 const sessions=rows.map(r=>r.referralSessions);return {checks:rows.length,cited:rows.filter(r=>r.cited).length,byEngine,referralSessions:sessions.some(s=>s===null)?null:sessions.reduce<number>((n,s)=>n+(s??0),0),orders:'use_tracking_codes' as const,exposureGuaranteed:false as const};
}
// ---------- G2-21 overseas pilot readiness ----------
export const pilotChecks=['productEligibility','rightsCleared','logistics','returnsPolicy','fxBasis','settlementPath','taxCustoms'] as const;
export type PilotCheck={status:'unknown'|'confirmed'|'blocked';evidenceRef:string};
export type PilotInput={country:string;offerId:string;currency:string;priceLocal:number|null;fxKrwPerUnit:number|null;landedCostKrw:number|null;expectedReturnRate:number|null;checks:Record<typeof pilotChecks[number],PilotCheck>};
export function parsePilot(value:unknown):PilotInput{
 if(!value||typeof value!=='object'||Array.isArray(value))fail('파일럿 입력을 확인하세요.');const b=value as Record<string,unknown>;
 const country=String(b.country??'');if(!/^[A-Z]{2}$/.test(country)||country==='KR')fail('해외 국가 코드(ISO 2자리, KR 제외)를 입력하세요.');
 const currency=String(b.currency??'');if(!/^[A-Z]{3}$/.test(currency)||currency==='KRW')fail('현지 통화 코드(ISO 3자리)를 입력하세요.');
 const num=(v:unknown,label:string,max:number)=>v===null||v===undefined?null:typeof v==='number'&&Number.isFinite(v)&&v>=0&&v<=max?v:fail(`${label}을(를) 확인하세요.`);
 const offerId=String(b.offerId??'');if(!/^[A-Za-z0-9_-]{1,100}$/.test(offerId))fail('오퍼를 확인하세요.');
 const raw=(b.checks??{}) as Record<string,unknown>,checks={} as PilotInput['checks'];
 for(const k of pilotChecks){const c=(raw[k]??{}) as Record<string,unknown>;const status=['unknown','confirmed','blocked'].includes(String(c.status))?c.status as PilotCheck['status']:'unknown';const evidenceRef=String(c.evidenceRef??'');if(evidenceRef&&!/^[A-Za-z0-9_.:-]{1,100}$/.test(evidenceRef))fail('확인 증빙 ID 형식을 확인하세요.');if(status==='confirmed'&&!evidenceRef)fail('확인한 항목에는 증빙 ID가 필요합니다.');checks[k]={status,evidenceRef}}
 return {country,offerId,currency,priceLocal:num(b.priceLocal,'현지 가격',1e9),fxKrwPerUnit:num(b.fxKrwPerUnit,'환율',1e6),landedCostKrw:num(b.landedCostKrw,'도착 원가',1e10),expectedReturnRate:num(b.expectedReturnRate,'예상 반품률',1),checks};
}
/** Ready only for an owner decision; nothing is launched, and unknown economics stay null. */
export function assessPilot(p:PilotInput){
 const blocked=pilotChecks.filter(k=>p.checks[k].status==='blocked'),unknown=pilotChecks.filter(k=>p.checks[k].status==='unknown');
 const contribution=p.priceLocal!==null&&p.fxKrwPerUnit!==null&&p.landedCostKrw!==null&&p.expectedReturnRate!==null?Math.round(p.priceLocal*p.fxKrwPerUnit*(1-p.expectedReturnRate)-p.landedCostKrw):null;
 const reasons=[...blocked.map(k=>`${k}: 막힘`),...unknown.map(k=>`${k}: 미확인`),...(contribution===null?['단위 경제(현지가·환율·도착 원가·반품률) 미확인']:contribution<=0?['반품·환율 반영 단위 공헌이익이 양수가 아닙니다.']:[])];
 return {status:blocked.length?'blocked' as const:reasons.length?'not_ready' as const:'ready_for_owner_decision' as const,reasons,unitContributionKrw:contribution,mayLaunch:false as const};
}
// ---------- G2-22 MMM feasibility ----------
export const MMM_RULES={minWeeks:52,minSpendChannels:2,minActiveWeeksPerChannel:10,minSpendCv:0.2};
/** MMM is only attempted with long, varied spend history; otherwise not_run. Never an initial budget allocation source. */
export function mmmFeasibility(weeks:{week:string;revenue:number|null;spend:Record<string,number|null>}[]){
 const reasons:string[]=[],usable=weeks.filter(w=>w.revenue!==null&&Object.values(w.spend).every(v=>v!==null));
 if(usable.length<MMM_RULES.minWeeks)reasons.push(`매출·지출이 모두 확인된 주가 ${usable.length}주입니다(최소 ${MMM_RULES.minWeeks}주).`);
 const channels=[...new Set(usable.flatMap(w=>Object.keys(w.spend)))],varied=channels.filter(ch=>{const xs=usable.map(w=>w.spend[ch]??0),active=xs.filter(x=>x>0).length,mean=xs.reduce((a,b)=>a+b,0)/Math.max(xs.length,1),sd=Math.sqrt(xs.reduce((a,b)=>a+(b-mean)**2,0)/Math.max(xs.length,1));return active>=MMM_RULES.minActiveWeeksPerChannel&&mean>0&&sd/mean>=MMM_RULES.minSpendCv});
 if(varied.length<MMM_RULES.minSpendChannels)reasons.push(`충분히 변동한 지출 채널이 ${varied.length}개입니다(최소 ${MMM_RULES.minSpendChannels}개, 채널당 활성 ${MMM_RULES.minActiveWeeksPerChannel}주·변동계수 ${MMM_RULES.minSpendCv}).`);
 const unknownWeeks=weeks.length-usable.length;if(unknownWeeks)reasons.push(`미확인 매출·지출이 있는 주 ${unknownWeeks}개는 제외했습니다.`);
 return {status:reasons.some(r=>!r.startsWith('미확인'))?'not_run' as const:'feasible_for_review' as const,usableWeeks:usable.length,variedChannels:varied,reasons,budgetAllocation:null,rules:MMM_RULES};
}
