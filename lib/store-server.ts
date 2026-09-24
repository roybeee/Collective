import {ApiError,str,num,uid,stamp} from './server';
import {archiveUrl} from './archive-server';
import type {ArchiveSource} from './archive';
import {obj,boundedArray} from './validate';
import {channelCatalog,tradeAreas,storeFields,storeMetricFields,checkStates,decisions,type Store,type StoreChannel,type StoreExperiment,type StoreMeasurement,type StoreReport,type StoreMetricKey,type StoreReview} from './store-marketing';
import {storeLearningRule} from './learning-server';
import type {LearningRule} from './learning';
export function option<T extends string>(value:unknown,values:readonly T[],label:string):T{if(typeof value!=='string'||!values.includes(value as T))throw new ApiError(400,label+'을 선택하세요.');return value as T}
export function checkedVersion(old:{version:number},value:unknown){if(old.version!==value)throw new ApiError(409,'다른 화면에서 변경되었습니다. 새로고침 후 다시 저장하세요.')}
export function localDate(value:unknown,label:string,required=false){const d=str(value??'',label,10,required);if(d&&(!/^\d{4}-\d{2}-\d{2}$/.test(d)||!Number.isFinite(Date.parse(d))||new Date(d).toISOString().slice(0,10)!==d))throw new ApiError(400,label+'을 확인하세요.');return d}
export function nullableNumber(v:unknown,label:string){return v===null||v===undefined||v===''?null:num(v,label)}
export function storeInput(raw:Record<string,unknown>){const data=Object.fromEntries(Object.entries(storeFields).map(([k,label])=>[k,str(raw[k]??'',label,k==='name'?150:3000,['name','address','goal'].includes(k))]));return {...data,tradeArea:option(raw.tradeArea,Object.keys(tradeAreas) as Store['tradeArea'][],'상권')} as Pick<Store,keyof typeof storeFields|'tradeArea'>}
export function channelInput(raw:Record<string,unknown>,storeId:string,old?:StoreChannel):StoreChannel{
 const key=option(raw.key,channelCatalog.map(c=>c.key),'채널'),catalog=channelCatalog.find(c=>c.key===key)!;
 const checks=Object.fromEntries(catalog.checks.map((label,i)=>[String(i),option(obj(raw.checks)[i]??'unknown',Object.keys(checkStates) as (keyof typeof checkStates)[],label)]));
 const checkedAt=localDate(raw.checkedAt,'확인일'),evidence=str(raw.evidence??'','확인 근거',4000);
 if(Object.values(checks).some(v=>v==='done')&&(!checkedAt||!evidence))throw new ApiError(400,'확인 완료 항목은 확인일과 실제 근거가 필요합니다.');
 if(checkedAt&&checkedAt>new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Seoul'}))throw new ApiError(400,'확인일은 오늘까지 입력하세요.');
 return {id:storeId+'-'+key,storeId,key,url:archiveUrl(raw.url),checks,checkedAt,evidence,version:(old?.version||0)+1,updatedAt:stamp()};
}
export function experimentInput(raw:Record<string,unknown>){
 const startDate=localDate(raw.startDate,'시작일'),endDate=localDate(raw.endDate,'종료일');if(startDate&&endDate&&startDate>endDate)throw new ApiError(400,'종료일은 시작일 이후여야 합니다.');
 return {title:str(raw.title,'실험 이름',150,true),channel:option(raw.channel,channelCatalog.map(c=>c.key),'채널'),hypothesis:str(raw.hypothesis,'검증할 가설',3000,true),offer:str(raw.offer??'','제안·혜택',3000),control:str(raw.control??'','비교 조건',3000),treatment:str(raw.treatment??'','바꿀 변수',3000),primaryMetric:option(raw.primaryMetric,Object.keys(storeMetricFields) as StoreMetricKey[],'핵심 지표'),target:nullableNumber(raw.target,'목표값'),budget:nullableNumber(raw.budget,'예산'),startDate,endDate,measurement:str(raw.measurement??'','측정 방법',3000),stopRule:str(raw.stopRule??'','확대·중단 기준',3000)};
}
export function measurementInput(raw:Record<string,unknown>,experiment:StoreExperiment,old?:StoreMeasurement):StoreMeasurement{
 const periodStart=localDate(raw.periodStart,'측정 시작',true),periodEnd=localDate(raw.periodEnd,'측정 종료',true);
 const today=new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Seoul'});
 if(periodStart>periodEnd||periodEnd>today)throw new ApiError(400,'측정 기간은 시작 이후부터 오늘까지 가능합니다.');
 const scope=option(raw.scope??'experiment',['experiment','baseline'] as const,'기록 구분');
 // 사전 기간 기준선은 달력으로만 만들어진다. 같은 스키마에 담지 못하면 준실험 비교가 영구히 불가능해진다.
 if(scope==='baseline'){if(periodEnd>=experiment.startDate)throw new ApiError(400,'기준선은 실험 시작 전 기간이어야 합니다.');}
 else if(periodStart<experiment.startDate||periodEnd>experiment.endDate)throw new ApiError(400,'실험 기간 안의 성과를 기록하세요.');
 const values=Object.fromEntries(Object.entries(storeMetricFields).map(([k,label])=>{const n=nullableNumber(obj(raw.values)[k],label);if(n!==null&&!['revenue','variableCosts','adSpend','productionCost'].includes(k)&&!Number.isInteger(n))throw new ApiError(400,label+'은 정수로 입력하세요.');return [k,n]})) as StoreMeasurement['values'];
 if(Object.values(values).every(n=>n===null))throw new ApiError(400,'확인한 수치를 하나 이상 입력하세요.');
 for(const [a,b] of [['couponUsed','couponReceived'],['repeatCustomers','eligibleCustomers']] as const)if(values[a]!==null&&values[b]!==null&&values[a]!>values[b]!)throw new ApiError(400,storeMetricFields[a]+'은 '+storeMetricFields[b]+'보다 클 수 없습니다.');
 return {id:old?.id||uid(),scope,storeId:experiment.storeId,experimentId:experiment.id,periodStart,periodEnd,source:str(raw.source,'수치 출처',2000,true),definition:str(raw.definition,'집계 정의·시간대·고객군',4000,true),method:option(raw.method,['manual','export'] as const,'수집 방식'),cohortMatured:raw.cohortMatured===true,values,version:(old?.version||0)+1,createdAt:old?.createdAt||stamp(),updatedAt:stamp()};
}
// 회고 저장(close_experiment)이 409로 거절하는 조건부 확대의 사유. 미리보기(preview_close)도 같은 문구로 저장할 수 없다고 알린다(R3).
export const ADOPT_NEEDS_MEASUREMENT='조건부 확대에는 핵심 지표의 실제 기록이 필요합니다.';
export const LEDGER_CHANGED='성과를 가져온 뒤 장부가 변경되었습니다. 장부 성과를 다시 가져와 검토하세요.';
// 회고가 학습 규칙으로 승격되는지와 그 사유(loop-7). 승격 판정은 저장 때와 같은 storeLearningRule 결과 그대로다.
// 사유는 막힌 조건을 사람이 읽을 문장으로 옮긴 설명이며, 규칙이 되지 않았는데 해당 사유가 없으면 일반 문구를 준다.
// blocked는 저장 자체가 거절되는 사유다(핵심 지표 기록 없는 조건부 확대). 장부 변경은 DB를 읽어야 해 라우트가 따로 판정한다.
export function storeRulePromotion(e:StoreExperiment,decision:string,learning:string,review:StoreReview|undefined,measurements:StoreMeasurement[]):{rule:LearningRule|null;reasons:string[];blocked?:string}{
 const label=storeMetricFields[e.primaryMetric],rule=storeLearningRule(e,decision,learning,review,measurements,label);
 if(rule)return {rule,reasons:[] as string[]};
 const measured=measurements.some(m=>m.experimentId===e.id&&(m.scope??'experiment')==='experiment'&&m.values[e.primaryMetric]!==null);
 const blocked=decision==='adopt'&&!measured?ADOPT_NEEDS_MEASUREMENT:undefined;
 const reasons=[
  ...(decision!=='adopt'&&decision!=='stop'?[`「${decisions[decision as keyof typeof decisions]??decision}」 판단은 회고로만 남습니다. 조건부 확대·중단 판단만 규칙이 됩니다 — 후속 실험을 만들어 이어가세요.`]:[]),
  ...(!review?.nextAction?.trim()?['다음 행동을 적어야 규칙이 됩니다.']:[]),
  ...(!measured?[`핵심 지표(${label})의 실험 기간 기록이 없어 규칙이 되지 않습니다 — 성과를 먼저 기록하세요.`]:[]),
  ...(review?.evidenceLevel==='observation'?['관찰 수준이라 규칙이 되지 않습니다 — 비교 조건을 갖춘 결과로 기록하거나 다음 실험을 만드세요.']:[]),
 ];
 return {rule:null,reasons:reasons.length?reasons:['학습 규칙 승격 조건을 충족하지 않습니다.'],...(blocked?{blocked}:{})};
}
export function parseStoreReport(raw:Record<string,unknown>,store:Store,sources:ArchiveSource[],id:string):StoreReport{
 const allowed=new Set(sources.filter(s=>s.status!=='excluded').map(s=>s.id));
 const arr=(v:unknown,max:number)=>boundedArray(v,max,'점포 진단 목록 형식을 확인하세요.');
 const refs=(v:unknown)=>{const ids=arr(v,40);if(ids.some(x=>typeof x!=='string'||!allowed.has(x)))throw new ApiError(422,'점포 진단에 실제 자료와 일치하지 않는 근거가 있습니다.');return [...new Set(ids)] as string[]};
 const sourceIds=refs(raw.sourceIds),itemRefs=(v:unknown)=>{const ids=refs(v);if(!ids.length||ids.some(x=>!sourceIds.includes(x)))throw new ApiError(422,'실행 제안에 전체 진단과 연결된 근거가 필요합니다.');return ids};
 const text=(v:unknown,label:string,max=2000)=>str(v,label,max,true);
 // security-ops-11: 실행·실험 제안 원소가 null·원시값·배열이면 TypeError가 아니라 목록 형식 오류(422)다. 점포 보고서는 부분 구제 없이 전체를 거절한다.
 const items=(v:unknown,max:number)=>arr(v,max).map(x=>{if(!x||typeof x!=='object'||Array.isArray(x))throw new ApiError(422,'점포 진단 목록 형식을 확인하세요.');return x as Record<string,unknown>});
 return {id,storeId:store.id,brandId:store.brandId,storeVersion:store.version,status:'candidate',summary:text(raw.summary,'진단 요약'),customer:text(raw.customer,'우선 고객'),bottleneck:text(raw.bottleneck,'방문 장벽'),measurementPlan:text(raw.measurementPlan,'측정 설계'),limitations:text(raw.limitations,'조사 한계'),questions:arr(raw.questions,8).map(q=>text(q,'질문')),sourceIds,actions:items(raw.actions,8).map(a=>({channel:option(a.channel,channelCatalog.map(c=>c.key),'채널'),priority:option(a.priority,['first','next'] as const,'우선순위'),action:text(a.action,'수정 과제'),reason:text(a.reason,'이유'),sourceIds:itemRefs(a.sourceIds)})),proposals:items(raw.proposals,2).map(p=>({title:text(p.title,'실험 이름',150),channel:option(p.channel,channelCatalog.map(c=>c.key),'채널'),hypothesis:text(p.hypothesis,'가설'),control:text(p.control,'비교 조건'),treatment:text(p.treatment,'바꿀 변수'),measurement:text(p.measurement,'측정 방법'),sourceIds:itemRefs(p.sourceIds)})),createdAt:stamp()};
}
