// 홀드아웃 매장 증분 측정(C7). 순수 모듈: 캠페인 기간·대상(치료) 매장·대조(홀드아웃) 매장·장부 일별 순매출로
// 같은 길이의 직전 기간을 기준선으로 한 이중차분(difference-in-differences)과 결정론 부트스트랩 신뢰구간을 계산한다.
// 비유: 같은 날 같은 비를 맞은 두 밭에서 비료를 준 밭만 더 자랐는지 본다. 비(계절·날씨·휴일)는 두 밭에 같이 내렸다고 가정할 뿐, 그 가정을 증명하지는 않는다.
// 라벨은 결과마다 그대로 싣는다. 귀속≠증분(lib/store-attribution.ts)과 같은 취지다.
export const INCREMENTALITY_LABEL='관찰 비교이며 인과 증명이 아닙니다' as const;
export const MIN_PRE_DAYS=14,MAX_PERIOD_DAYS=182,MAX_STORES=50,BOOTSTRAP_SAMPLES=400,BOOTSTRAP_SEED=20261109;
export type DailyNet={storeId:string;day:string;net:number};
export type IncrementalityVerdict='insufficient'|'positive'|'negative'|'inconclusive';
export type IncrementalityInput={periodStart:string;periodEnd:string;treatedStoreIds:readonly string[];controlStoreIds:readonly string[];daily:readonly DailyNet[];seed?:number;samples?:number};
export type IncrementalityResult={
 label:typeof INCREMENTALITY_LABEL;method:'difference_in_differences';verdict:IncrementalityVerdict;reasons:string[];
 period:{start:string;end:string;days:number};prePeriod:{start:string;end:string;days:number};stores:{treated:number;control:number};
 // 매장·하루 평균 순매출(원). 결측일은 0으로 본다.
 means:{treatedPre:number;treatedCampaign:number;controlPre:number;controlCampaign:number};
 liftPerStoreDay:number|null;liftTotal:number|null;liftRate:number|null;ci:{low:number;high:number;level:0.95;samples:number}|null;
};
// 캠페인당 1행으로 저장되는 결과(kind incrementality_result). 화면은 이 모양만 읽는다.
export type IncrementalityRecord={id:string;campaignId:string;brandId:string;periodStart:string;periodEnd:string;treatedStoreIds:string[];controlStoreIds:string[];result:IncrementalityResult;computedAt:string;computedBy:{id:string;email:string|null};version:number};
export const verdictLabels:Record<IncrementalityVerdict,string>={insufficient:'자료 부족',positive:'증가 관찰',negative:'감소 관찰',inconclusive:'차이 불분명'};

export const addDays=(date:string,days:number)=>new Date(Date.parse(date+'T00:00:00Z')+days*86400000).toISOString().slice(0,10);
export const isDay=(v:unknown):v is string=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&new Date(v+'T00:00:00Z').toISOString().slice(0,10)===v;
const dayCount=(start:string,end:string)=>Math.round((Date.parse(end+'T00:00:00Z')-Date.parse(start+'T00:00:00Z'))/86400000)+1;
const days=(start:string,n:number)=>Array.from({length:n},(_,i)=>addDays(start,i));
const mean=(xs:readonly number[])=>xs.length?xs.reduce((a,b)=>a+b,0)/xs.length:0;
const round=(n:number)=>Math.round(n*100)/100;
// 결정론 난수(mulberry32). 같은 seed면 같은 신뢰구간이 나온다.
export function seededRandom(seed:number){let a=seed>>>0;return()=>{a=(a+0x6D2B79F5)>>>0;let t=a;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return ((t^(t>>>14))>>>0)/4294967296}}
const quantile=(sorted:readonly number[],q:number)=>sorted[Math.min(sorted.length-1,Math.max(0,Math.floor(q*(sorted.length-1))))];

function groupMeans(daily:readonly DailyNet[],stores:readonly string[],dayList:readonly string[]){
 const set=new Set(stores),table=new Map<string,number>();
 for(const d of daily)if(set.has(d.storeId))table.set(d.storeId+'|'+d.day,(table.get(d.storeId+'|'+d.day)??0)+d.net);
 return dayList.map(day=>mean(stores.map(s=>table.get(s+'|'+day)??0)));
}
function checks(input:IncrementalityInput,n:number){
 const reasons:string[]=[];
 if(!isDay(input.periodStart)||!isDay(input.periodEnd)||n<1)reasons.push('캠페인 기간을 확인하세요.');
 else if(n<MIN_PRE_DAYS)reasons.push(`기준 기간이 ${MIN_PRE_DAYS}일 미만입니다(캠페인 기간과 같은 길이의 직전 기간을 씁니다).`);
 if(n>MAX_PERIOD_DAYS)reasons.push(`캠페인 기간은 ${MAX_PERIOD_DAYS}일까지입니다.`);
 if(!input.treatedStoreIds.length)reasons.push('대상 매장이 없습니다.');
 if(!input.controlStoreIds.length)reasons.push('대조(홀드아웃) 매장이 1곳 이상 필요합니다.');
 if(input.treatedStoreIds.some(s=>input.controlStoreIds.includes(s)))reasons.push('같은 매장이 대상과 대조에 함께 있습니다.');
 return reasons;
}
export function computeIncrementality(input:IncrementalityInput):IncrementalityResult{
 const n=isDay(input.periodStart)&&isDay(input.periodEnd)?dayCount(input.periodStart,input.periodEnd):0;
 const preStart=n>0?addDays(input.periodStart,-n):input.periodStart,preEnd=n>0?addDays(input.periodStart,-1):input.periodStart;
 const treated=[...new Set(input.treatedStoreIds)].sort(),control=[...new Set(input.controlStoreIds)].sort();
 const base={label:INCREMENTALITY_LABEL as typeof INCREMENTALITY_LABEL,method:'difference_in_differences' as const,period:{start:input.periodStart,end:input.periodEnd,days:Math.max(0,n)},prePeriod:{start:preStart,end:preEnd,days:Math.max(0,n)},stores:{treated:treated.length,control:control.length}};
 const reasons=checks(input,n);
 const empty={means:{treatedPre:0,treatedCampaign:0,controlPre:0,controlCampaign:0},liftPerStoreDay:null,liftTotal:null,liftRate:null,ci:null};
 if(reasons.length)return {...base,...empty,verdict:'insufficient',reasons};
 const campDays=days(input.periodStart,n),preDays=days(preStart,n);
 const tp=groupMeans(input.daily,treated,preDays),tc=groupMeans(input.daily,treated,campDays),cp=groupMeans(input.daily,control,preDays),cc=groupMeans(input.daily,control,campDays);
 const means={treatedPre:round(mean(tp)),treatedCampaign:round(mean(tc)),controlPre:round(mean(cp)),controlCampaign:round(mean(cc))};
 if(tp.every(v=>v===0)||cp.every(v=>v===0))return {...base,...empty,means,verdict:'insufficient',reasons:['기준 기간에 대상 또는 대조 매장의 장부 순매출이 없습니다.']};
 const diffs=campDays.map((_,i)=>(tc[i]-tp[i])-(cc[i]-cp[i])),lift=mean(diffs);
 const samples=Math.max(50,Math.min(5000,input.samples??BOOTSTRAP_SAMPLES)),random=seededRandom(input.seed??BOOTSTRAP_SEED);
 const draws=Array.from({length:samples},()=>mean(Array.from({length:n},()=>diffs[Math.floor(random()*n)]))).sort((a,b)=>a-b);
 const ci={low:round(quantile(draws,0.025)),high:round(quantile(draws,0.975)),level:0.95 as const,samples};
 const counterfactual=mean(tp)+(mean(cc)-mean(cp));
 const verdict:IncrementalityVerdict=ci.low>0?'positive':ci.high<0?'negative':'inconclusive';
 return {...base,means,verdict,reasons:[],liftPerStoreDay:round(lift),liftTotal:round(lift*treated.length*n),liftRate:counterfactual>0?Math.round(lift/counterfactual*10000)/10000:null,ci};
}
