// Growth2 M0: local planning only. Readiness never grants spend authority.
export const metaTextFields={product:'상품·오퍼',landingUrl:'전환 목적지 URL',storeStack:'자사몰·예약 시스템',accountLabel:'광고 계정 별칭',startAt:'시작 시각',endAt:'종료 시각',attributionWindow:'귀속 기간',stopRule:'중단 기준'} as const;
export const metaMoneyFields={price:'판매가',unitCost:'상품 원가',variableCost:'건당 변동비',totalBudget:'총 광고 예산',dailyTarget:'일별 운영 목표',lossLimit:'손실 한도',safetyReserve:'안전 여유'} as const;
export const metaChecks={inventory:'재고·제공 가능 수량 확인',fulfillment:'배송·서비스 이행 확인',refunds:'취소·환불 조건 확인',rights:'소재·상품 사용권 확인',measurement:'결제·후속 전환 측정 경로 확인',consent:'전환 데이터 동의·처리 조건 확인'} as const;
export type MetaPlanInput=Record<keyof typeof metaTextFields,string>&Record<keyof typeof metaMoneyFields,number|null>&{path:'storefront'|'content';goal:'purchase'|'lead'|'awareness';currency:'KRW';timeZone:'Asia/Seoul';taxBasis:'unknown'|'included'|'excluded';checks:Record<keyof typeof metaChecks,boolean>};
export type MetaPlan={id:string;campaignId:string;brandId:string;campaignVersion:number;version:number;input:MetaPlanInput;updatedAt:string;updatedBy:{id:string;role:string}};
export function emptyMetaPlan():MetaPlanInput{return {product:'',landingUrl:'',storeStack:'',accountLabel:'',startAt:'',endAt:'',attributionWindow:'',stopRule:'',price:null,unitCost:null,variableCost:null,totalBudget:null,dailyTarget:null,lossLimit:null,safetyReserve:null,path:'storefront',goal:'purchase',currency:'KRW',timeZone:'Asia/Seoul',taxBasis:'unknown',checks:{inventory:false,fulfillment:false,refunds:false,rights:false,measurement:false,consent:false}}}
export function parseMetaPlan(value:unknown):{input:MetaPlanInput;errors:string[]}{
 const input=emptyMetaPlan(),errors:string[]=[];
 if(!value||typeof value!=='object'||Array.isArray(value))return {input,errors:['계획 형식이 올바르지 않습니다.']};
 const v=value as Record<string,unknown>;
 for(const k of Object.keys(metaTextFields) as (keyof typeof metaTextFields)[]){const s=v[k];if(typeof s!=='string'||s.length>500||/[\x00-\x1f\x7f]/.test(s))errors.push(`${metaTextFields[k]}: 500자 이내로 입력하세요.`);else input[k]=s.trim()}
 for(const k of Object.keys(metaMoneyFields) as (keyof typeof metaMoneyFields)[]){const n=v[k];if(n!==null&&(typeof n!=='number'||!Number.isSafeInteger(n)||n<0||n>1e12))errors.push(`${metaMoneyFields[k]}: 0 이상 원 단위 금액 또는 미확인을 입력하세요.`);else input[k]=n as number|null}
 for(const [k,allowed] of Object.entries({path:['storefront','content'],goal:['purchase','lead','awareness'],currency:['KRW'],timeZone:['Asia/Seoul'],taxBasis:['unknown','included','excluded']})){if(!allowed.includes(v[k] as string))errors.push(`${k}: 지원하지 않는 값입니다.`);else Object.assign(input,{[k]:v[k]})}
 for(const k of Object.keys(metaChecks) as (keyof typeof metaChecks)[]){const b=(v.checks as Record<string,unknown>|null)?.[k];if(typeof b!=='boolean')errors.push(`${metaChecks[k]}: 확인 여부를 지정하세요.`);else input.checks[k]=b}
 if(input.landingUrl){try{const u=new URL(input.landingUrl);if(u.protocol!=='https:'||u.username||u.password||u.search||u.hash||!u.hostname.includes('.'))throw new Error();input.landingUrl=u.href}catch{errors.push('목적지는 로그인 정보·쿼리·조각이 없는 HTTPS 공개 URL을 입력하세요.')}}
 for(const k of ['startAt','endAt'] as const)if(input[k]&&(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?(?:Z|[+-]\d{2}:\d{2})$/.test(input[k])||!Number.isFinite(Date.parse(input[k]))))errors.push('기간은 시간대가 있는 날짜·시각으로 입력하세요.');
 if(input.startAt&&input.endAt&&Date.parse(input.endAt)<=Date.parse(input.startAt))errors.push('종료 시각은 시작 시각 이후여야 합니다.');
 if(input.totalBudget!==null)for(const k of ['dailyTarget','lossLimit','safetyReserve'] as const)if(input[k]!==null&&input[k]!>input.totalBudget)errors.push(`${metaMoneyFields[k]}는 총 광고 예산 이하여야 합니다.`);
 return {input,errors};
}
export function metaReadiness(plan:MetaPlan|null,campaignVersion:number,now=Date.now()){
 const p=plan?.input??emptyMetaPlan(),missing:string[]=[];
 for(const k of Object.keys(metaTextFields) as (keyof typeof metaTextFields)[])if(!p[k])missing.push(metaTextFields[k]);
 for(const k of Object.keys(metaMoneyFields) as (keyof typeof metaMoneyFields)[])if(p[k]===null||(['price','totalBudget','dailyTarget','lossLimit','safetyReserve'].includes(k)&&p[k]!<=0))missing.push(metaMoneyFields[k]);
 for(const k of Object.keys(metaChecks) as (keyof typeof metaChecks)[])if(!p.checks[k])missing.push(metaChecks[k]);
 if(p.taxBasis==='unknown')missing.push('부가세 기준');
 if(p.endAt&&Date.parse(p.endAt)<=now)missing.push('종료된 기간 다시 설정');
 if(plan&&plan.campaignVersion!==campaignVersion)missing.push('변경된 캠페인 기준으로 계획 다시 저장');
 const unitContribution=p.price===null||p.unitCost===null||p.variableCost===null?null:p.price-p.unitCost-p.variableCost;
 return {missing,planningComplete:missing.length===0,canActivate:false as const,approval:'not_requested' as const,unitContribution,external:{read:false,draftWrite:false,activate:false,conversionSend:false},blockers:['Meta 계정 권한 연결 미검증','주문·전환 어댑터 미검증','소재·실험안 검수 미완료','집행 승인·예산 예약 미구현'],salesEvidence:p.goal==='purchase'?'구매·순매출 대조 필요':'매출 미검증'};
}
