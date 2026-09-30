import {scanText} from './pii-scan';
import {experimentStatistics,type ExperimentArm,type ExperimentStatistics} from './meta-experiment';
export class GrowthExperimentError extends Error {}
export const experimentChannels=['storefront','organic','meta','manual'] as const;
export const experimentMetrics=['paid_orders','net_revenue_per_unit','contribution_per_unit'] as const;
export const assignmentUnits=['pseudonymous_visitor','pseudonymous_session','store_day'] as const;
export type InterventionRef={kind:'landing_revision'|'demand_step'|'publication_link'|'offer'|'manual';id:string;version:number};
export type ExperimentDesignInput={
 title:string;mode:'explore'|'confirm';aa:boolean;hypothesis:string;missionId:string;missionVersion:number;offerId:string;offerVersion:number;
 channel:typeof experimentChannels[number];intervention:string;interventionRefs:InterventionRef[];assignmentUnit:typeof assignmentUnits[number];
 treatmentShare:number;metric:typeof experimentMetrics[number];lowerBound:number;upperBound:number;minEffect:number;minSamplePerArm:number;
 startAt:string;endAt:string;maturityDays:number;stopRule:string;
};
export type GrowthExperimentState='draft'|'registered'|'collecting'|'maturing'|'insufficient'|'invalid'|'inconclusive'|'supported'|'rejected'|'exploratory'|'aa_passed'|'aa_failed';
const control=/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/,secret=/(?:bearer\s+\S+|(?:api[_-]?key|access[_-]?token|password|secret)\s*[:=]\s*\S+|\bsk-[\w-]{8,})/i;
function fail(m:string):never{throw new GrowthExperimentError(m)}
function text(v:unknown,label:string,max:number,required=true){if((v===undefined||v==='')&&!required)return '';if(typeof v!=='string'||!v.trim()||v.length>max||control.test(v))fail(`${label}: 1~${max}자 문자열을 입력하세요.`);const n=v.normalize('NFKC');if(scanText(n).length||secret.test(n))fail(`${label}: 식별정보·인증정보를 넣을 수 없습니다.`);return v.trim()}
const ident=(v:unknown,label:string)=>{const r=text(v,label,100);if(!/^[A-Za-z0-9_-]+$/.test(r))fail(`${label}: 내부 식별자 형식을 확인하세요.`);return r};
const int=(v:unknown,label:string,min:number,max:number)=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=min&&v<=max?v:fail(`${label}: ${min}~${max} 정수를 입력하세요.`);
const num=(v:unknown,label:string)=>typeof v==='number'&&Number.isFinite(v)&&Math.abs(v)<=1e9?v:fail(`${label}: 유한한 숫자를 입력하세요.`);
const instant=(v:unknown,label:string)=>{const r=text(v,label,40);if(!Number.isFinite(Date.parse(r)))fail(`${label}: 시각 형식을 확인하세요.`);return new Date(Date.parse(r)).toISOString()};
function choice<T extends string>(v:unknown,values:readonly T[],label:string):T{if(!values.includes(v as T))fail(`${label}: 지원하는 값을 선택하세요.`);return v as T}
export function parseExperimentDesign(value:unknown):ExperimentDesignInput{
 if(!value||typeof value!=='object'||Array.isArray(value))fail('실험 설계 입력을 확인하세요.');const b=value as Record<string,unknown>;
 if(!Array.isArray(b.interventionRefs)||b.interventionRefs.length>10)fail('개입 근거는 최대 10개 배열입니다.');
 const refs=(b.interventionRefs as unknown[]).map(r=>{if(!r||typeof r!=='object')fail('개입 근거를 확인하세요.');const x=r as Record<string,unknown>;return {kind:choice(x.kind,['landing_revision','demand_step','publication_link','offer','manual'] as const,'개입 근거 종류'),id:ident(x.id,'개입 근거 ID'),version:int(x.version,'개입 근거 판',1,1e9)}});
 const metric=choice(b.metric,experimentMetrics,'주지표'),lowerBound=num(b.lowerBound,'단위 최솟값'),upperBound=num(b.upperBound,'단위 최댓값'),minEffect=num(b.minEffect,'최소 효과');
 if(lowerBound>=upperBound||minEffect<0||minEffect>=upperBound-lowerBound)fail('단위 범위와 최소 효과(MDE)를 확인하세요.');
 if(metric==='paid_orders'&&(lowerBound!==0||upperBound!==1))fail('구매 여부 지표의 단위 범위는 0~1입니다.');
 if(typeof b.treatmentShare!=='number'||!(b.treatmentShare>=0.1&&b.treatmentShare<=0.9))fail('처리군 배정 확률은 0.1~0.9입니다.');
 const startAt=instant(b.startAt,'시작 시각'),endAt=instant(b.endAt,'종료 시각');if(Date.parse(endAt)<=Date.parse(startAt)||Date.parse(endAt)-Date.parse(startAt)>180*86400000)fail('관측 기간은 시작 뒤 최대 180일입니다.');
 if(typeof b.aa!=='boolean')fail('A/A 점검 여부를 선택하세요.');
 return {title:text(b.title,'실험 제목',200),mode:choice(b.mode,['explore','confirm'] as const,'실험 종류'),aa:b.aa,hypothesis:text(b.hypothesis,'가설',2000),missionId:ident(b.missionId,'미션 ID'),missionVersion:int(b.missionVersion,'미션 판',1,1e9),offerId:ident(b.offerId,'오퍼 ID'),offerVersion:int(b.offerVersion,'오퍼 판',1,1e9),channel:choice(b.channel,experimentChannels,'채널'),intervention:text(b.intervention,'개입 설명',2000),interventionRefs:refs,assignmentUnit:choice(b.assignmentUnit,assignmentUnits,'배정 단위'),treatmentShare:Math.round(b.treatmentShare*1000)/1000,metric,lowerBound,upperBound,minEffect,minSamplePerArm:int(b.minSamplePerArm,'군별 최소 표본',10,1_000_000),startAt,endAt,maturityDays:int(b.maturityDays,'성숙 대기일',0,90),stopRule:text(b.stopRule,'중단 기준',1000)};
}
/** Deterministic assignment from a secret per-experiment seed; the raw unit key is never stored. */
export async function assignUnit(seed:string,unitKey:string,treatmentShare:number):Promise<{unitHash:string;arm:ExperimentArm}>{
 const bytes=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(`${seed}\u0000${unitKey}`))),hash=[...bytes].map(x=>x.toString(16).padStart(2,'0')).join('');
 const u=parseInt(hash.slice(0,13),16)/2**52;return {unitHash:hash,arm:u<treatmentShare?'treatment':'control'};
}
export function parseUnitKey(v:unknown){if(typeof v!=='string'||!/^[A-Za-z0-9_.:-]{8,128}$/.test(v)||scanText(v).length)throw new GrowthExperimentError('배정 단위 키는 8~128자의 가명 식별자여야 합니다(이메일·전화번호 금지).');return v}
/** Sample ratio mismatch: chi-square (1 d.f.) against the registered share; p<0.001 invalidates the run. */
export function sampleRatio(controlN:number,treatmentN:number,share:number){
 const n=controlN+treatmentN;if(!n)return {chi2:0,p:1,mismatch:false};const et=n*share,ec=n-et,chi2=(treatmentN-et)**2/et+(controlN-ec)**2/ec;
 const p=erfc(Math.sqrt(chi2/2));return {chi2,p,mismatch:p<0.001};
}
function erfc(x:number){const t=1/(1+0.5*x),y=t*Math.exp(-x*x-1.26551223+t*(1.00002368+t*(0.37409196+t*(0.09678418+t*(-0.18628806+t*(0.27886807+t*(-1.13520398+t*(1.48851587+t*(-0.82215223+t*0.17087277)))))))));return x>=0?y:2-y}
export type AnalysisUnit={arm:ExperimentArm;exposed:boolean;trackingComplete:boolean;contaminated:boolean;value:number|null};
export type GrowthExperimentAnalysis={status:GrowthExperimentState;analysisVersion:'growth_sales_v1';reasons:string[];assigned:{control:number;treatment:number};analysed:{control:number;treatment:number};excluded:{notExposed:number;trackingIncomplete:number;contaminated:number;unknownValue:number};srm:ReturnType<typeof sampleRatio>;statistics:ExperimentStatistics|null;descriptive:{controlMean:number|null;treatmentMean:number|null};causalScope:string};
/**
 * Non-buyers enter as 0 once exposure and tracking are complete. Unknown contribution is excluded and counted; above 10% of
 * analysed units the run is invalid rather than silently filling zeros. Confirmatory inference uses the pre-registered bound.
 */
export function analyseExperiment(d:ExperimentDesignInput,units:AnalysisUnit[],now:number,analysisCount:number):GrowthExperimentAnalysis{
 const assigned={control:units.filter(u=>u.arm==='control').length,treatment:units.filter(u=>u.arm==='treatment').length},srm=sampleRatio(assigned.control,assigned.treatment,d.treatmentShare);
 const excluded={notExposed:0,trackingIncomplete:0,contaminated:0,unknownValue:0},kept:{control:number[];treatment:number[]}={control:[],treatment:[]};
 for(const u of units){if(u.contaminated){excluded.contaminated++;continue}if(!u.exposed){excluded.notExposed++;continue}if(!u.trackingComplete){excluded.trackingIncomplete++;continue}if(u.value===null){excluded.unknownValue++;continue}kept[u.arm].push(u.value)}
 const analysed={control:kept.control.length,treatment:kept.treatment.length},total=units.length,reasons:string[]=[],mean=(xs:number[])=>xs.length?xs.reduce((a,b)=>a+b,0)/xs.length:null;
 const base={analysisVersion:'growth_sales_v1' as const,assigned,analysed,excluded,srm,descriptive:{controlMean:mean(kept.control),treatmentMean:mean(kept.treatment)},causalScope:`${d.channel}·${d.assignmentUnit}·${d.startAt.slice(0,10)}~${d.endAt.slice(0,10)} 등록 범위에 한정`};
 if(now<Date.parse(d.startAt))return {...base,status:'registered',reasons:['시작 전입니다.'],statistics:null};
 if(now<Date.parse(d.endAt))return {...base,status:'collecting',reasons:['관측 기간 중입니다. 중간 결과로 판정하지 않습니다.'],statistics:null};
 if(now<Date.parse(d.endAt)+d.maturityDays*86400000)return {...base,status:'maturing',reasons:['환불·취소 성숙 대기 중입니다.'],statistics:null};
 if(srm.mismatch)reasons.push('배정 비율이 등록 비율과 다릅니다(SRM). 배정·추적을 점검하세요.');
 if(total&&excluded.contaminated/total>0.05)reasons.push('두 군에 모두 노출된 단위가 5%를 넘습니다.');
 if(total&&excluded.trackingIncomplete/total>0.2)reasons.push('추적 미완료 단위가 20%를 넘습니다.');
 const analysedTotal=analysed.control+analysed.treatment;if(analysedTotal&&excluded.unknownValue/(analysedTotal+excluded.unknownValue)>0.1)reasons.push('비용·금액 미확인 단위가 10%를 넘습니다.');
 if(reasons.length)return {...base,status:'invalid',reasons,statistics:null};
 if(d.mode==='explore')return {...base,status:'exploratory',reasons:['탐색 실험은 인과 판정을 하지 않습니다. 유망하면 확증 실험을 새로 등록하세요.'],statistics:null};
 const statistics=experimentStatistics({metric:d.metric==='paid_orders'?'paid_orders':'contribution',minSample:d.minSamplePerArm,minEffect:d.minEffect,lowerBound:d.lowerBound,upperBound:d.upperBound},kept.control,kept.treatment,analysisCount);
 if(d.aa){const ok=statistics.status==='inconclusive'||statistics.status==='insufficient';return {...base,status:statistics.status==='insufficient'?'insufficient':ok?'aa_passed':'aa_failed',reasons:[ok?'A/A 점검에서 등록 효과 기준을 넘는 차이가 없습니다.':'A/A인데 차이가 나타났습니다. 배정·추적을 점검하세요.'],statistics};}
 return {...base,status:statistics.status as GrowthExperimentState,reasons:[statistics.reason],statistics};
}
