import type {Campaign,Metric} from './agency';
import {ApiError,listRecords,num,readRecord,stamp,str,uid} from './server';

const values=['revenue','variableCosts','adSpend','productionCost','orders'] as const;
function calendarDate(value:unknown,label:string){
 const date=str(value,label,10,true);
 if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date))||new Date(date).toISOString().slice(0,10)!==date)throw new ApiError(400,`${label}을 확인하세요.`);
 return date;
}
function nullable(value:unknown,label:string){return value===null||value===undefined||value===''?null:num(value,label)}

export async function campaignMeasurement(owner:string,campaign:Campaign,input:Record<string,unknown>):Promise<Metric>{
 const old=input.id?await readRecord<Metric>(owner,'metric',str(input.id,'성과',100,true)):undefined;
 if(old&&old.campaignId!==campaign.id)throw new ApiError(400,'캠페인이 일치하지 않습니다.');
 if(old&&input.version!==(old.version||1))throw new ApiError(409,'성과가 변경됐습니다. 최신 기록을 확인해 주세요.');
 const version=old?(old.version||1)+1:1;
 if(old?.schemaVersion===2||input.schemaVersion===2){
  const periodStart=calendarDate(input.periodStart,'측정 시작일'),periodEnd=calendarDate(input.periodEnd,'측정 종료일');
  const today=new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Seoul'});
  if(periodStart>periodEnd||periodEnd>today)throw new ApiError(400,'측정 기간은 시작 이후부터 오늘까지 가능합니다.');
  const scope=str(input.scope,'비교 범위',300,true),source=str(input.source,'자료 출처',2000,true),definition=str(input.definition,'집계 정의',4000,true);
  if(!['manual','export'].includes(String(input.method)))throw new ApiError(400,'수집 방식을 선택하세요.');
  const measured=Object.fromEntries(values.map(key=>[key,nullable(input[key],key)])) as Pick<Metric,typeof values[number]>;
  if(values.every(key=>measured[key]===null))throw new ApiError(400,'확인한 수치를 하나 이상 입력하세요.');
  if(measured.orders!==null&&!Number.isInteger(measured.orders))throw new ApiError(400,'주문 수는 정수로 입력하세요.');
  const existing=await listRecords<Metric>(owner,'metric',campaign.id);
  if(existing.some(m=>m.id!==old?.id&&m.schemaVersion===2&&m.scope===scope&&m.periodStart!<=periodEnd&&m.periodEnd!>=periodStart))throw new ApiError(409,'같은 범위의 측정 기간이 겹칩니다. 기존 기록을 수정하거나 다른 기간을 입력하세요.');
  return {id:old?.id||uid(),campaignId:campaign.id,schemaVersion:2,version,period:`${periodStart} ~ ${periodEnd} · ${scope}`,periodStart,periodEnd,scope,source,definition,method:input.method as 'manual'|'export',...measured,baselineContribution:null,notes:str(input.notes??'','측정 메모',5000),updatedAt:stamp()};
 }
 // Existing integrations remain readable/writable without inventing dates or provenance.
 return {id:old?.id||uid(),campaignId:campaign.id,version,period:str(input.period,'측정 기간',200,true),revenue:num(input.revenue,'순매출'),variableCosts:num(input.variableCosts,'변동 원가'),adSpend:num(input.adSpend,'매체비'),productionCost:num(input.productionCost,'제작비'),orders:num(input.orders,'주문 수'),baselineContribution:nullable(input.baselineContribution,'비교 기준 공헌이익'),notes:str(input.notes??'','측정 메모',5000)};
}
