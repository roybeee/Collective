import {scanText} from './pii-scan';
export class GrowthTargetsError extends Error {}
export type TargetInput={title:string;status:'provisional'|'confirmed';metric:'netRevenue'|'paidOrders'|'contributionProfit';comparison:'absolute';unit:'KRW'|'orders';baseline:number|null;targetValue:number|null;from:string;to:string;executionStartedAt:string;denominator:string;assignee:string;autonomyScope:string;profitCondition:string;lossLimit:number|null;requiredImprovement:string;stopRule:string;stopAt:string;changeReason:string;unconfirmedReason:string;confirmBy:string};
export type ReviewInput={resources:string;questionsAndReturns:string;ownerExceptions:string;nextAction:string;next30Days:string;decisionId:string;decisionVersion:number};
export function emptyTargetInput():TargetInput{return {title:'',status:'provisional',metric:'netRevenue',comparison:'absolute',unit:'KRW',baseline:null,targetValue:null,from:'',to:'',executionStartedAt:'',denominator:'',assignee:'',autonomyScope:'',profitCondition:'',lossLimit:null,requiredImprovement:'',stopRule:'',stopAt:'',changeReason:'',unconfirmedReason:'',confirmBy:''}}
export function emptyReviewInput():ReviewInput{return {resources:'',questionsAndReturns:'',ownerExceptions:'',nextAction:'',next30Days:'',decisionId:'',decisionVersion:0}}
function fail(s:string):never{throw new GrowthTargetsError(s)}
function object(v:unknown){if(!v||typeof v!=='object'||Array.isArray(v))return fail('입력 객체를 확인하세요.');return v as Record<string,unknown>}
function text(v:unknown,key:string,max=1000){if(v===undefined)return '';if(typeof v!=='string'||v.length>max||/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(v))return fail(`${key} 입력을 확인하세요.`);const n=v.normalize('NFKC').replace(/[\u200b-\u200d\u2060\ufeff]/g,'');if(scanText(n).length||/(?:bearer\s+\S+|(?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret)\s*[:=]\s*\S+|\bsk-(?:proj-)?[\w-]{8,}|-----BEGIN [A-Z ]*PRIVATE KEY-----)/i.test(n))return fail('직접 식별정보·인증정보는 저장할 수 없습니다.');return n.trim()}
function amount(v:unknown,key:string,negative=false){if(v===null||v===undefined)return null;if(typeof v!=='number'||!Number.isSafeInteger(v)||Math.abs(v)>1e12||(!negative&&v<0))return fail(`${key}는 원·건 단위 정수 또는 미확인이어야 합니다.`);return v}
function day(v:unknown,key:string){const s=text(v,key,10);if(s&&(!/^\d{4}-\d{2}-\d{2}$/.test(s)||!Number.isFinite(Date.parse(s))||new Date(s).toISOString().slice(0,10)!==s))return fail(`${key}는 실제 날짜여야 합니다.`);return s}
export function parseTargetInput(v:unknown):TargetInput{
 const b=object(v),base=emptyTargetInput();
 const status=b.status??base.status,metric=b.metric??base.metric,unit=b.unit??(metric==='paidOrders'?'orders':'KRW');
 if(!['provisional','confirmed'].includes(String(status))||!['netRevenue','paidOrders','contributionProfit'].includes(String(metric))||(b.comparison??'absolute')!=='absolute'||unit!==(metric==='paidOrders'?'orders':'KRW'))return fail('목표 지표·상태·단위·절대값 비교를 확인하세요.');
 const strings=Object.fromEntries(['title','denominator','assignee','autonomyScope','profitCondition','requiredImprovement','stopRule','changeReason','unconfirmedReason'].map(k=>[k,text(b[k],k)]));
 const dates=Object.fromEntries(['from','to','executionStartedAt','stopAt','confirmBy'].map(k=>[k,day(b[k],k)]));
 if(dates.from&&dates.to&&dates.from>dates.to)return fail('관측 시작일이 종료일보다 늦습니다.');
 return {...base,...strings,...dates,status,metric,unit,comparison:'absolute',baseline:amount(b.baseline,'기준선',metric==='contributionProfit'),targetValue:amount(b.targetValue,'목표',metric==='contributionProfit'),lossLimit:amount(b.lossLimit,'손실 한도')} as TargetInput;
}
export function parseReviewInput(v:unknown):ReviewInput{
 const b=object(v),base=emptyReviewInput(),strings=Object.fromEntries(['resources','questionsAndReturns','ownerExceptions','nextAction','next30Days','decisionId'].map(k=>[k,text(b[k],k,k==='decisionId'?100:1500)]));
 const decisionVersion=b.decisionVersion??0;if(!Number.isSafeInteger(decisionVersion)||Number(decisionVersion)<0||Number(decisionVersion)>1e9||Boolean(strings.decisionId)!==(Number(decisionVersion)>0))return fail('결정 ID와 판을 함께 확인하세요.');
 if(strings.decisionId&&!/^[A-Za-z0-9_-]+$/.test(strings.decisionId))return fail('결정 ID 형식을 확인하세요.');
 return {...base,...strings,decisionVersion:Number(decisionVersion)};
}
export function targetAssessment(input:TargetInput){
 const labels:Partial<Record<keyof TargetInput,string>>={title:'목표명',from:'관측 시작일',to:'관측 종료일',executionStartedAt:'실행 착수일',denominator:'관측 분모',assignee:'책임자',autonomyScope:'자율 범위',profitCondition:'수익 조건',requiredImprovement:'필수 개선 지표',stopRule:'중단 조건',stopAt:'중단 확인일',changeReason:'변경 이유',confirmBy:'확정 예정일'};
 const missing=Object.entries(labels).filter(([k])=>!input[k as keyof TargetInput]).map(([,label])=>`${label} 입력`);
 if(input.baseline===null)missing.push('기준선 미확인');if(input.targetValue===null)missing.push('목표값 미확인');if(input.lossLimit===null)missing.push('손실 한도 미확인');
 if(input.from&&input.executionStartedAt&&input.from<input.executionStartedAt)missing.push('관측기간은 실행 착수일 이후로 설정');
 if(input.status==='provisional'){missing.push('잠정 목표: 확정 전');if(!input.unconfirmedReason)missing.push('목표 미확정 사유 입력');}
 return {missing,mayExecute:false as const,mayScale:false as const};
}
type Business={status:string;netRevenue:number|null;orders?:number|null;paidOrders?:number|null;contribution?:number|null;contributionBeforeMarketing:number|null};
export function targetReviewAssessment(input:TargetInput,business:Business,now=Date.now()){
 const missing=[...targetAssessment(input).missing],today=new Date(now+9*3600000).toISOString().slice(0,10);
 const observationDays=input.from&&input.to?(Date.parse(input.to)-Date.parse(input.from))/86400000+1:0;
 const elapsedDays=input.executionStartedAt?(Date.parse(today)-Date.parse(input.executionStartedAt))/86400000:0;
 const mature=observationDays>=30&&elapsedDays>=30&&!!input.to&&today>input.to;
 const observedValue=input.metric==='netRevenue'?business.netRevenue:input.metric==='paidOrders'?(business.paidOrders??null):(business.contribution??null);
 if(business.status!=='ledger_only')missing.push('주문 장부 집계 미확인');
 if(observedValue===null)missing.push(input.metric==='contributionProfit'?'광고·제작비까지 배분된 공헌이익 미확인':'지표 관측값 미확인');
 if(!mature)missing.push('30일 관측기간 미충족 또는 종료일 진행 중');
 const ready=targetAssessment(input).missing.length===0&&business.status==='ledger_only'&&observedValue!==null;
 const status=!ready?'held':!mature?'interim':observedValue!>=input.targetValue!?'observed_met':'observed_below';
 return {status,missing,observedValue,absoluteChange:observedValue!==null&&input.baseline!==null?observedValue-input.baseline:null,observedContributionBeforeMarketing:business.contributionBeforeMarketing,mayExecute:false as const,mayScale:false as const,causalStatus:'not_measured' as const};
}
