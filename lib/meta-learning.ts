import type {MetaPerformanceSnapshot} from './meta-performance-report';
export class MetaLearningInputError extends Error {}
function text(value:unknown,label:string,max:number){if(typeof value!=='string'||!value.trim()||value.length>max)throw new MetaLearningInputError(label+' 내용을 확인하세요.');return value.trim();}

export const metaDecisionLabels={hold:'보류',stop:'중단',retest:'재실험',continue:'계속 관찰'} as const;
export const metaCandidateFields={hypothesis:'확인할 가설',variable:'바꿀 한 가지',control:'대조안',treatment:'실험안',stopCondition:'종료·중단 기준'} as const;
export type MetaCandidate={hypothesis:string;variable:string;control:string;treatment:string;stopCondition:string;metric:'paid_orders'|'contribution';minSample:number;creativeId:string;creativeVersion:number;creativeHash:string;status:'draft'|'preregistered'};
export type MetaPreregistration={sourceDecisionId:string;sourceDecisionVersion:number;candidateDigest:string;hypothesis:string;variable:string;control:string;treatment:string;primaryMetric:MetaCandidate['metric'];minSample:number;stopCondition:string;startAt:string;endAt:string;maturityHours:number;fixedConditions:string;singleVariableConfirmed:true;observationSource:'not_connected'};
export type MetaLearningDecision={id:string;campaignId:string;brandId:string;version:number;snapshotId:string;sourceDigest:string;sourceVersion:number;campaignVersion:number;decision:keyof typeof metaDecisionLabels;note:string;evidenceStatus:'insufficient'|'observation_only';candidate:MetaCandidate|null;registration?:MetaPreregistration;mayActivate:false;requestDigest:string;recordedAt:string;actorId:string};

export function preregistrationInput(b:Record<string,unknown>,now=Date.now()){
 const startAt=text(b.startAt,'시작 시각',40),endAt=text(b.endAt,'종료 시각',40),start=Date.parse(startAt),end=Date.parse(endAt);
 const validDate=(v:string)=>/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(v)&&new Date(v.slice(0,10)+'T00:00:00Z').toISOString().slice(0,10)===v.slice(0,10);
 if(!Number.isFinite(start)||!Number.isFinite(end)||![startAt,endAt].every(validDate)||start<=now||end<=start||end-start>31*86400000)throw new MetaLearningInputError('미래 시작·종료 시각과 최대 31일 관측 기간을 지정하세요.');
 if(b.singleVariableConfirmed!==true||!Number.isSafeInteger(b.maturityHours)||Number(b.maturityHours)<24||Number(b.maturityHours)>720)throw new MetaLearningInputError('한 변수만 변경함을 확인하고 종료 후 성숙 대기를 24~720시간으로 정하세요.');
 return {startAt:new Date(start).toISOString(),endAt:new Date(end).toISOString(),maturityHours:Number(b.maturityHours),fixedConditions:text(b.fixedConditions,'고정 조건·배정 및 측정 계획',1500),singleVariableConfirmed:true as const};
}

export function candidateInput(value:unknown){
 if(value===null||value===undefined)return null;
 if(!value||typeof value!=='object'||Array.isArray(value))throw new MetaLearningInputError('실험 후보 형식을 확인하세요.');
 const v=value as Record<string,unknown>,allowed=[...Object.keys(metaCandidateFields),'metric','minSample','creativeId','creativeVersion','creativeHash'];
 if(Object.keys(v).some(k=>!allowed.includes(k)))throw new MetaLearningInputError('지원하지 않는 실험 설정입니다.');
 if(!['paid_orders','contribution'].includes(String(v.metric))||!Number.isSafeInteger(v.minSample)||Number(v.minSample)<1||Number(v.minSample)>1000000)throw new MetaLearningInputError('지표와 최소 표본을 확인하세요.');
 const fields=Object.fromEntries(Object.entries(metaCandidateFields).map(([k,label])=>[k,text(v[k],label,1000)])) as Record<keyof typeof metaCandidateFields,string>;
 if(fields.control===fields.treatment)throw new MetaLearningInputError('대조안과 실험안을 다르게 입력하세요.');
 if(!Number.isSafeInteger(v.creativeVersion)||Number(v.creativeVersion)<1||typeof v.creativeHash!=='string'||!/^[a-f0-9]{64}$/.test(v.creativeHash))throw new MetaLearningInputError('조회한 소재의 판과 파일 식별자를 확인하세요.');
 return {...fields,metric:v.metric as MetaCandidate['metric'],minSample:Number(v.minSample),creativeId:text(v.creativeId,'연결 소재',100),creativeVersion:Number(v.creativeVersion),creativeHash:v.creativeHash};
}
export function learningEvidence(snapshot:MetaPerformanceSnapshot){
 const r=snapshot.report;
 return r.meta?.matured&&r.ledger&&r.ledger.netRevenue>0?'observation_only' as const:'insufficient' as const;
}
