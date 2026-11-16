// GEO 관측 프로토콜 v2(스위치 geo_protocol_v2) — 판정(순수 모듈). 저장된 관찰만으로 묶음×엔진마다 'N회 중 k회'와 판정어를 낸다.
// 묶음은 카테고리 추천(지역 포함)·비교·브랜드 직접(lib/geo-questions.ts geoGroupOf)이고, 엔진끼리는 합치지 않는다. N은 관찰한 응답 수(로그인 필요·답변 없음 제외), k는 브랜드가 나온 수다.
// 같은 날(KST)의 반복은 회차이고, 판정에는 서로 7일 이상 떨어진 두 시점이 있어야 한다. 없으면 '판정 보류'다. 기준값은 모두 운영 기준이며 노출 보장이 아니다.
// 비교 창: 최신 관찰일까지 28일(현재)과 그 앞 28일(이전). 이전 창이 판정을 냈고 현재 판정이 더 낮으면 '방어 실패'다.
import {GEO_ENGINES,GEO_GROUPS,geoGroupOf,type GeoEngine,type GeoGroup,type GeoIntent,type GeoQuestion} from './geo-questions';
import {GEO_CONTEXT_TONES,GEO_SOURCE_CLASSES,type GeoContextTone,type GeoSourceClass} from './geo-observation';
import {geoReport,type GeoBacklogItem,type GeoReportObservation,type GeoSiteChecks} from './geo-report';
import {canonicalFactKey} from './fact-catalog';

export const GEO_VERDICTS=['dominant','contested','behind','absent','defense_failed','unobserved','pending'] as const;
export type GeoVerdict=typeof GEO_VERDICTS[number];
export const GEO_VERDICT_LABELS:Record<GeoVerdict,string>={dominant:'장악',contested:'경합',behind:'열세',absent:'부재',defense_failed:'방어 실패',unobserved:'미관측',pending:'판정 보류'};
// 운영 기준(책·법령 수치가 아님). 대표가 바꿀 수 있도록 한곳에 둔다.
export const GEO_VERDICT_RULES={label:'운영 기준',dominant:'2/3',contested:'1/3',minGapDays:7,windowDays:28,maxRepeats:3} as const;
type Level='dominant'|'contested'|'behind'|'absent';
const RANK:Record<Level,number>={absent:0,behind:1,contested:2,dominant:3};
const DAY=86400000,KST=9*3600000;

export const countLabel=(n:number,k:number)=>`${n}회 중 ${k}회`;
// 비율 경계는 정수 비교로 센다(3k ≥ 2N이면 장악, 3k ≥ N이면 경합).
export function verdictOf(n:number,k:number):Level|'unobserved'{
 if(n<=0)return 'unobserved';
 if(k<=0)return 'absent';
 if(3*k>=2*n)return 'dominant';
 return 3*k>=n?'contested':'behind';
}
export type GeoVerdictObservation=Pick<GeoReportObservation,'questionId'|'engine'|'status'|'observedAt'|'brandMentioned'|'citations'>&{protocol?:2;context?:{tone:GeoContextTone;reason:string}|null};
export type GeoVerdictRow={group:GeoGroup;engine:GeoEngine;n:number;k:number;count:string;timePoints:number;spanDays:number;verdict:GeoVerdict;level:Level|'unobserved';previous:Level|null;rule:typeof GEO_VERDICT_RULES.label};

const kstDay=(iso:string)=>new Date(Date.parse(iso)+KST).toISOString().slice(0,10);
const dayNumber=(day:string)=>Math.round(Date.parse(day+'T00:00:00Z')/DAY);
// 한 창의 집계. 시점 = 관찰이 있는 KST 날짜. 가장 이른 시점과 늦은 시점 차가 7일 이상이면 그런 두 시점이 있다.
function windowStats(rows:readonly GeoVerdictObservation[]){
 const n=rows.length,k=rows.filter(r=>r.brandMentioned===true).length,days=[...new Set(rows.map(r=>dayNumber(kstDay(r.observedAt))))].sort((a,b)=>a-b);
 const spanDays=days.length?days[days.length-1]-days[0]:0,qualified=spanDays>=GEO_VERDICT_RULES.minGapDays;
 return {n,k,timePoints:days.length,spanDays,qualified,level:verdictOf(n,k)};
}
export function geoVerdicts(questions:readonly Pick<GeoQuestion,'id'|'intent'>[],observations:readonly GeoVerdictObservation[]):GeoVerdictRow[]{
 const groupOf=new Map<string,GeoGroup>(questions.map(q=>[q.id,geoGroupOf(q.intent as GeoIntent)]));
 const seen=observations.filter(o=>o.status==='observed'&&groupOf.has(o.questionId));
 const out:GeoVerdictRow[]=[];
 for(const group of GEO_GROUPS)for(const engine of GEO_ENGINES){
  const mine=seen.filter(o=>o.engine===engine&&groupOf.get(o.questionId)===group);
  const asked=questions.some(q=>geoGroupOf(q.intent as GeoIntent)===group);
  if(!mine.length){if(asked&&observations.some(o=>o.engine===engine))out.push({group,engine,n:0,k:0,count:countLabel(0,0),timePoints:0,spanDays:0,verdict:'unobserved',level:'unobserved',previous:null,rule:GEO_VERDICT_RULES.label});continue}
  const latest=Math.max(...mine.map(o=>dayNumber(kstDay(o.observedAt)))),w=GEO_VERDICT_RULES.windowDays;
  const at=(o:GeoVerdictObservation)=>dayNumber(kstDay(o.observedAt));
  const now=windowStats(mine.filter(o=>at(o)>latest-w)),before=windowStats(mine.filter(o=>at(o)<=latest-w&&at(o)>latest-2*w));
  const previous=before.qualified&&before.level!=='unobserved'?before.level:null;
  const level=now.level;
  const verdict:GeoVerdict=!now.qualified?'pending':level==='unobserved'?'unobserved':previous&&RANK[level]<RANK[previous]?'defense_failed':level;
  out.push({group,engine,n:now.n,k:now.k,count:countLabel(now.n,now.k),timePoints:now.timePoints,spanDays:now.spanDays,verdict,level,previous,rule:GEO_VERDICT_RULES.label});
 }
 return out;
}
// 엔티티 부재: 브랜드 직접 묶음을 관찰한 엔진 중 하나라도 0회면 부재다. 7일 규칙을 아직 못 채웠으면 예비로 표시한다.
export function entityAbsence(rows:readonly GeoVerdictRow[]){
 const hits=rows.filter(r=>r.group==='brand'&&r.n>0&&r.k===0);
 return {absent:hits.length>0,engines:GEO_ENGINES.filter(e=>hits.some(r=>r.engine===e)),preliminary:hits.some(r=>r.verdict==='pending')};
}
// 처방 0에 넣을 기본 정보 사실(확정 사실 key). 하나도 없으면 페이지를 만들지 않고 대기한다(지어내지 않는다).
export const GEO_ENTITY_FACT_KEYS=['address','hours','phone'] as const;
export function entityBacklogItem(entity:ReturnType<typeof entityAbsence>,confirmedFactKeys:readonly string[]):GeoBacklogItem|null{
 if(!entity.absent)return null;
 const waiting=!confirmedFactKeys.some(k=>(GEO_ENTITY_FACT_KEYS as readonly string[]).includes(canonicalFactKey(k)));
 const mark=entity.preliminary?'(예비) ':'';
 const text=waiting?`${mark}처방 0 대기(엔티티 부재): 브랜드 이름으로 물어도 답변에 나오지 않지만, 공식 정보 페이지에 넣을 확정 사실(주소·영업시간·전화번호)이 없습니다. 브랜드 사실을 먼저 확정한 뒤 진행하세요.`
  :`${mark}처방 0(엔티티 부재): 브랜드 이름으로 물어도 답변에 나오지 않습니다. 다른 처방보다 먼저 공식 정보 페이지 1곳(확정 사실만)·지도 등록 정보·이름 표기 통일을 한 묶음으로 정비하고, 변경 기록을 남겨 다시 관측하세요.`;
 return {id:'entity-absent',kind:'entity_absent',engines:entity.engines,waiting,text};
}
const mixOf=<T extends string>(keys:readonly T[],values:readonly T[])=>Object.fromEntries(keys.map(k=>[k,values.filter(v=>v===k).length])) as Record<T,number>;
export function geoReportV2(input:{questions:readonly Pick<GeoQuestion,'id'|'text'|'intent'>[];observations:readonly (GeoReportObservation&GeoVerdictObservation)[];site:GeoSiteChecks;confirmedFactKeys:readonly string[]}){
 const base=geoReport(input),verdicts=geoVerdicts(input.questions,input.observations),entity=entityAbsence(verdicts);
 const v2=input.observations.filter(o=>o.protocol===2&&o.status==='observed');
 const citationMix=mixOf<GeoSourceClass>(GEO_SOURCE_CLASSES,v2.flatMap(o=>o.citations.map(c=>(c as {sourceClass?:GeoSourceClass}).sourceClass??'unclassified')));
 const contextMix=mixOf<GeoContextTone>(GEO_CONTEXT_TONES,v2.flatMap(o=>o.context?[o.context.tone]:[]));
 const first=entityBacklogItem(entity,input.confirmedFactKeys);
 return {...base,protocol:2 as const,rules:GEO_VERDICT_RULES,verdicts,entity:{...entity,waiting:first?.waiting??false},citationMix,contextMix,backlog:first?[first,...base.backlog]:base.backlog};
}
export type GeoReportV2=ReturnType<typeof geoReportV2>;
