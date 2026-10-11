import type {Store} from './store-marketing';

export type StoreGrowthProfile={id:string;storeId:string;brandId:string;storeVersion:number;version:number;concept:string;categoryTags?:string[];bottleneck?:string;goal?:string;constraints?:string;regions:string[];audiences:string[];dayparts:string[];averageOrderValue:number|null;variableCostPerOrder:number|null;spareOrdersPerDay:number|null;ownerHourlyValue:number|null;plannedOwnerMinutes:number|null;monthlyBudget:number|null;adCost:number|null;productionCost:number|null;benefitCost:number|null;softwareCost:number|null;days:number|null;updatedAt:string};
export type LocalPartnerCandidate={id:string;storeId:string;name:string;kind:'creator'|'media'|'platform'|'community'|'partner';url:string;regions:string[];concepts:string[];audiences:string[];dayparts:string[];evidenceUrl:string;evidenceSummary:string;publicBusinessEvidence?:string;recentExamples?:{url:string;note:string;outcome:'positive'|'negative'|'unknown'}[];quoteEvidenceUrl?:string;rightsScope?:string;rightsDays?:number|null;visitConditions?:string;sponsoredRatio?:number|null;checkedAt:string;expiresAt:string;localReach:number|null;localReachEvidence:string;quote:number|null;rights:'unknown'|'confirmed'|'not_needed';disclosure:'unknown'|'confirmed';tracking:'unknown'|'confirmed';status:'research'|'shortlisted'|'rejected';version:number};
export type ActivityTime={id:string;storeId:string;date:string;task:string;phase?:'setup'|'recurring';minutes:number;baselineMinutes:number|null;source:'measured'|'self_reported';costIncludedElsewhere:boolean};
export type GrowthEconomicsInput={averageOrderValue:number|null;variableCostPerOrder:number|null;adCost:number|null;productionCost:number|null;benefitCost:number|null;softwareCost:number|null;ownerHourlyValue:number|null;plannedOwnerMinutes?:number|null;spareOrdersPerDay:number|null;days:number|null};
export type GrowthWeeklyInput={revenue:number|null;variableCosts:number|null;marketingCosts:number|null;softwareCost:number|null;ownerHourlyValue:number|null;baselineContribution:number|null;comparable:boolean;activities:ActivityTime[]};
const known=(n:number|null|undefined):n is number=>typeof n==='number'&&Number.isFinite(n)&&n>=0;
const words=(s:string)=>s.split(/[,\n]/).map(x=>x.trim()).filter(Boolean);
const overlap=(a:string[],b:string[])=>a.some(x=>b.some(y=>x.trim().toLowerCase()===y.trim().toLowerCase()));
const dateValid=(s:string)=>/^\d{4}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(Date.parse(`${s}T00:00:00Z`))&&new Date(`${s}T00:00:00Z`).toISOString().slice(0,10)===s;
const uniqueActivities=(items:ActivityTime[])=>items.filter((x,i)=>items.findIndex(y=>y.id===x.id&&y.storeId===x.storeId)===i);

export function prefillProfile(store:Pick<Store,'id'|'brandId'|'version'>&Partial<Store>):StoreGrowthProfile{
 return {id:store.id,storeId:store.id,brandId:store.brandId,storeVersion:store.version,version:0,concept:store.menu??'',categoryTags:[],bottleneck:'',goal:store.goal??'',constraints:[store.capacity,store.hours,store.access].filter(Boolean).join('\n'),regions:[],audiences:words(store.customer??''),dayparts:words(store.daypart??''),averageOrderValue:null,variableCostPerOrder:null,spareOrdersPerDay:null,ownerHourlyValue:null,plannedOwnerMinutes:null,monthlyBudget:null,adCost:null,productionCost:null,benefitCost:null,softwareCost:null,days:null,updatedAt:''};
}

export function candidateKey(candidate:Pick<LocalPartnerCandidate,'url'>){
 try{
  const u=new URL(candidate.url);
  const pairs=[...u.searchParams.entries()].filter(([key])=>!/^utm_/i.test(key)&&!['fbclid','gclid'].includes(key.toLowerCase())).sort(([a,av],[b,bv])=>a.localeCompare(b)||av.localeCompare(bv));
  const query=pairs.map(([key,value])=>`${encodeURIComponent(key)}=${encodeURIComponent(value)}`).join('&');
  return `${u.hostname.toLowerCase().replace(/^www\./,'')}${u.pathname.replace(/\/+$/,'')}${query?`?${query}`:''}`;
 }catch{return candidate.url.trim().toLowerCase();}
}

export function matchCandidate(profile:StoreGrowthProfile,candidate:LocalPartnerCandidate,today:string){
 const blockers:string[]=[],reasons:string[]=[];
 const regional=overlap(profile.regions,candidate.regions);
 const concept=overlap(profile.categoryTags?.length?profile.categoryTags:words(profile.concept),candidate.concepts);
 const audience=overlap(profile.audiences,candidate.audiences),daypart=overlap(profile.dayparts,candidate.dayparts);
 const fresh=dateValid(today)&&dateValid(candidate.checkedAt)&&dateValid(candidate.expiresAt)&&candidate.checkedAt<=today&&candidate.expiresAt>=today&&candidate.expiresAt>=candidate.checkedAt;
 const excluded=candidate.status==='rejected'||candidate.storeId!==profile.storeId||(profile.regions.length>0&&candidate.regions.length>0&&!regional)||candidate.localReach===0;
 if(candidate.storeId!==profile.storeId)blockers.push('다른 점포의 후보');
 if(candidate.status==='rejected')blockers.push('제외한 후보');
 if(!regional)blockers.push(candidate.regions.length?'점포 생활권과 지역 불일치':'지역 도달 미확인: 전국 서비스 제공과 지역 도달은 다릅니다');
 if(!fresh)blockers.push('확인일·유효기간 재검증 필요');
 if(!candidate.evidenceUrl||!candidate.evidenceSummary)blockers.push('공개 사업 근거 필요');
 if(!candidate.publicBusinessEvidence?.trim())blockers.push('공개 사업 계정·협업 모집 근거 필요');
 if(!known(candidate.localReach)||!candidate.localReachEvidence)blockers.push('실제 지역 도달 수와 근거 미확인');
 if(candidate.localReach===0)blockers.push('확인된 지역 도달 0');
 if(!known(candidate.quote))blockers.push('견적 미확인');
 if(!candidate.quoteEvidenceUrl?.trim())blockers.push('무료 여부를 포함한 견적 근거 필요');
 if(candidate.rights==='unknown')blockers.push('촬영·재사용 권리 미확인');
 if(candidate.rights==='confirmed'&&(!candidate.rightsScope?.trim()||!known(candidate.rightsDays)||candidate.rightsDays<=0))blockers.push('사용권 범위와 유지기간 확인 필요');
 if(!candidate.visitConditions?.trim())blockers.push('방문·촬영 일정과 제공 조건 확인 필요');
 if(candidate.disclosure!=='confirmed')blockers.push('광고 표시 조건 미확인');
 if(candidate.tracking!=='confirmed')blockers.push('실제 구매 추적 경로 미확인');
 if(!known(profile.spareOrdersPerDay)||profile.spareOrdersPerDay===0)blockers.push('추가 주문 처리 여력 미확인 또는 없음');
 if(!known(profile.averageOrderValue)||!known(profile.variableCostPerOrder)||profile.averageOrderValue<=profile.variableCostPerOrder)blockers.push('양의 주문당 공헌이익 확인 필요');
 if(!known(profile.monthlyBudget))blockers.push('예산 미확인');
 else if(known(candidate.quote)&&candidate.quote>profile.monthlyBudget)blockers.push('견적이 점포 예산 초과');
 if(regional)reasons.push('생활권 지역 일치');
 if(concept)reasons.push('컨셉·업종 일치');
 if(audience)reasons.push('고객 이용 상황 일치');
 if(daypart)reasons.push('집중 시간대 일치');
 if(!concept)blockers.push('점포 컨셉 적합성 확인 필요');
 if(!audience)blockers.push('목표 고객 적합성 확인 필요');
 if(!daypart)blockers.push('목표 시간대의 방문·운영 적합성 확인 필요');
 const plan=economics({...profile,adCost:known(profile.adCost)&&known(candidate.quote)?profile.adCost+candidate.quote:null});
 blockers.push(...plan.missing.map(k=>`총비용·수용량 입력 미확인: ${k}`),...plan.warnings);
 if(known(profile.monthlyBudget)&&plan.totalCost!==null&&plan.totalCost>profile.monthlyBudget)blockers.push('후보 견적·노동비 포함 총비용이 점포 예산 초과');
 const score=(regional?30:0)+(concept?20:0)+(audience?15:0)+(daypart?10:0)+(fresh?10:0)+(known(candidate.localReach)&&candidate.localReach>0&&candidate.localReachEvidence?10:0)+(known(candidate.quote)?5:0);
 return {score,maxScore:100 as const,fit:(excluded?'exclude':blockers.length?'review':'fit') as 'fit'|'review'|'exclude',blockers,reasons,ready:!excluded&&blockers.length===0};
}

function activitySummary(activities:ActivityTime[],hourly:number|null){
 const items=uniqueActivities(activities),valid=items.every(x=>known(x.minutes)),charged=items.filter(x=>!x.costIncludedElsewhere);
 const minutes=items.length&&valid?items.reduce((s,x)=>s+x.minutes,0):null;
 const baselineMinutes=items.length&&valid&&items.every(x=>known(x.baselineMinutes))?items.reduce((s,x)=>s+x.baselineMinutes!,0):null;
 const timeCost=charged.length===0?0:known(hourly)&&charged.every(x=>known(x.minutes))?charged.reduce((s,x)=>s+x.minutes,0)/60*hourly:null;
 const timeEvidence=!items.length||!valid?'missing':items.some(x=>x.source==='self_reported')?'self_reported':'measured';
 return {minutes,baselineMinutes,savedMinutes:minutes!==null&&baselineMinutes!==null?baselineMinutes-minutes:null,timeCost,timeEvidence:timeEvidence as 'missing'|'self_reported'|'measured'};
}

export function economics(input:GrowthEconomicsInput,activities:ActivityTime[]=[]){
 const keys=['averageOrderValue','variableCostPerOrder','adCost','productionCost','benefitCost','softwareCost','spareOrdersPerDay','days'] as const;
 const missing:string[]=keys.filter(k=>!known(input[k])),warnings:string[]=[];
 const actual=activitySummary(activities,input.ownerHourlyValue);
 const plannedTimeCost=input.plannedOwnerMinutes===0?0:known(input.plannedOwnerMinutes)&&known(input.ownerHourlyValue)?input.plannedOwnerMinutes/60*input.ownerHourlyValue:null;
 const timeCost=activities.length?actual.timeCost:plannedTimeCost;
 if(!activities.length&&!known(input.plannedOwnerMinutes))missing.push('plannedOwnerMinutes');
 if(timeCost===null&&(!activities.length?known(input.plannedOwnerMinutes):true))missing.push('ownerHourlyValue');
 const contributionPerOrder=known(input.averageOrderValue)&&known(input.variableCostPerOrder)?input.averageOrderValue-input.variableCostPerOrder:null;
 const costs=[input.adCost,input.productionCost,input.benefitCost,input.softwareCost,timeCost];
 const totalCost=costs.every(known)?costs.reduce<number>((s,n)=>s+n!,0):null;
 const breakEvenOrders=contributionPerOrder!==null&&contributionPerOrder>0&&totalCost!==null?Math.ceil(totalCost/contributionPerOrder):null;
 const capacityOrders=known(input.spareOrdersPerDay)&&known(input.days)?Math.floor(input.spareOrdersPerDay*input.days):null;
 if(contributionPerOrder!==null&&contributionPerOrder<=0)warnings.push('주문당 공헌이익이 양수가 아닙니다');
 if(breakEvenOrders!==null&&capacityOrders!==null&&breakEvenOrders>capacityOrders)warnings.push('손익분기 구매수가 추가 처리 여력을 넘습니다');
 return {contributionPerOrder,totalCost,breakEvenOrders,capacityOrders,feasible:breakEvenOrders===null||capacityOrders===null?null:breakEvenOrders<=capacityOrders,missing,warnings,timeCost};
}

export function weeklyConclusions(input:GrowthWeeklyInput){
 const summary=activitySummary(input.activities,input.ownerHourlyValue);
 const time={...summary,timeCost:input.activities.length?summary.timeCost:null},reasons:string[]=[];
 const values=[input.revenue,input.variableCosts,input.marketingCosts,input.softwareCost,time.timeCost];
 const netContribution=values.every(known)?input.revenue!-input.variableCosts!-input.marketingCosts!-input.softwareCost!-time.timeCost!:null;
 const baselineKnown=typeof input.baselineContribution==='number'&&Number.isFinite(input.baselineContribution);
 const change=input.comparable&&baselineKnown&&netContribution!==null?netContribution-input.baselineContribution!:null;
 if(netContribution===null)reasons.push('매출·비용·시간 가치의 확인 자료가 부족합니다');
 if(change===null)reasons.push('비교 가능한 기준선이 없어 이익 증가를 판정하지 않습니다');
 if(time.savedMinutes===null)reasons.push('같은 업무의 기준 시간이 없어 시간 절감을 판정하지 않습니다');
 if(input.activities.some(x=>x.source==='self_reported'))reasons.push('노동시간과 시간 절감은 점주 확인값을 포함하며 실측 절감과 구분합니다');
 reasons.push('귀속 실적과 비교 변화는 인과적 증분 효과의 증명이 아닙니다');
 const recommendation=change===null?'hold':netContribution!<0?'stop':change>0?'continue':'review';
 return {...time,netContribution,change,recommendation:recommendation as 'hold'|'stop'|'continue'|'review',reasons};
}
