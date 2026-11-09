// G5 GEO 자동 추적 — 보고서(순수 모듈). 저장된 관찰(geo_observation)만으로 엔진별 점유율·인용률·주간 변화·많이 인용된 도메인·개선 백로그를 계산한다.
// 주는 한국 시간 월요일 시작이다. 같은 주에 (질문, 엔진) 관찰이 여러 번이면 마지막 관찰만 센다. 관찰하지 못한 응답(login_required·unavailable)은 분모에서 뺀다.
// 숫자는 관찰 기록의 비율이며 노출·인용 보장이 아니다. 엔진 답변은 사용자·위치·시각마다 바뀐다.
import {GEO_ENGINES,type GeoEngine,type GeoQuestion} from './geo-questions';
import type {GeoObservation} from './geo-observation';

export const GEO_REPORT_LABEL='관찰 기록 · 노출 보장 아님';
export const GEO_SITE_STATES=['present','absent','unknown'] as const;
export type GeoSiteState=typeof GEO_SITE_STATES[number];
export type GeoSiteChecks={jsonLd:GeoSiteState;llmsTxt:GeoSiteState};
export type GeoReportObservation=Pick<GeoObservation,'questionId'|'engine'|'status'|'observedAt'|'brandMentioned'|'brandCited'|'competitorsMentioned'|'citations'>;
export type GeoEngineStats={engine:GeoEngine;observed:number;mentions:number;cited:number;notObserved:number;shareOfVoice:number|null;citationRate:number|null};
export type GeoBacklogItem={id:string;kind:'competitor_gap'|'mention_without_citation'|'not_mentioned'|'login_required'|'json_ld'|'llms_txt';text:string;questionId?:string;engines?:GeoEngine[];link?:'json_ld_generator'|'llms_txt_template'|'manual_observation'};
export type GeoReport={label:typeof GEO_REPORT_LABEL;week:string|null;previousWeek:string|null;engines:(GeoEngineStats&{previous:GeoEngineStats|null;change:{shareOfVoice:number|null;citationRate:number|null}})[];topDomains:{domain:string;count:number;brand:boolean}[];backlog:GeoBacklogItem[];observations:number;exposureGuaranteed:false};

const KST=9*3600000,DAY=86400000;
export function weekOfKst(iso:string):string{
 const t=Date.parse(iso)+KST,d=new Date(t),day=(d.getUTCDay()+6)%7;
 return new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate())-day*DAY).toISOString().slice(0,10);
}
const previousWeekOf=(week:string)=>new Date(Date.parse(week+'T00:00:00Z')-7*DAY).toISOString().slice(0,10);
const ratio=(n:number,d:number)=>d>0?n/d:null;
const delta=(a:number|null,b:number|null)=>a===null||b===null?null:a-b;
// 같은 주 (질문, 엔진)의 마지막 관찰.
function latestOf(rows:readonly GeoReportObservation[],week:string){
 const map=new Map<string,GeoReportObservation>();
 for(const r of rows){if(weekOfKst(r.observedAt)!==week)continue;const k=r.questionId+'\u0000'+r.engine,prev=map.get(k);if(!prev||prev.observedAt<r.observedAt)map.set(k,r)}
 return [...map.values()];
}
function statsOf(rows:readonly GeoReportObservation[],engine:GeoEngine):GeoEngineStats{
 const mine=rows.filter(r=>r.engine===engine),seen=mine.filter(r=>r.status==='observed');
 const mentions=seen.filter(r=>r.brandMentioned===true).length,cited=seen.filter(r=>r.brandCited===true).length;
 return {engine,observed:seen.length,mentions,cited,notObserved:mine.length-seen.length,shareOfVoice:ratio(mentions,seen.length),citationRate:ratio(cited,seen.length)};
}
export function geoReport(input:{questions:readonly Pick<GeoQuestion,'id'|'text'>[];observations:readonly GeoReportObservation[];site:GeoSiteChecks}):GeoReport{
 const weeks=[...new Set(input.observations.map(o=>weekOfKst(o.observedAt)))].sort();
 const week=weeks.at(-1)??null,previousWeek=week?previousWeekOf(week):null;
 const current=week?latestOf(input.observations,week):[],previous=previousWeek?latestOf(input.observations,previousWeek):[];
 const engines=GEO_ENGINES.map(engine=>{const now=statsOf(current,engine),before=statsOf(previous,engine),prev=before.observed||before.notObserved?before:null;return {...now,previous:prev,change:{shareOfVoice:delta(now.shareOfVoice,prev?.shareOfVoice??null),citationRate:delta(now.citationRate,prev?.citationRate??null)}}}).filter(e=>e.observed||e.notObserved||e.previous);
 const domains=new Map<string,{count:number;brand:boolean}>();
 for(const o of current)for(const c of o.citations){if(!c.domain)continue;const d=domains.get(c.domain)??{count:0,brand:false};domains.set(c.domain,{count:d.count+1,brand:d.brand||c.brand})}
 const topDomains=[...domains].map(([domain,v])=>({domain,...v})).sort((a,b)=>b.count-a.count||a.domain.localeCompare(b.domain)).slice(0,10);
 return {label:GEO_REPORT_LABEL,week,previousWeek,engines,topDomains,backlog:geoBacklog(input.questions,current,input.site),observations:input.observations.length,exposureGuaranteed:false};
}
// 개선 백로그(결정론 규칙). 순서: 경쟁 브랜드만 나온 질문 → 언급되지만 인용 없음 → 아무도 안 나온 질문 → 로그인 필요 엔진 → 구조화 데이터 → llms.txt.
export function geoBacklog(questions:readonly Pick<GeoQuestion,'id'|'text'>[],current:readonly GeoReportObservation[],site:GeoSiteChecks):GeoBacklogItem[]{
 const out:GeoBacklogItem[]=[],seen=current.filter(o=>o.status==='observed');
 const enginesOf=(rows:readonly GeoReportObservation[])=>GEO_ENGINES.filter(e=>rows.some(r=>r.engine===e));
 for(const q of questions){
  const rows=seen.filter(o=>o.questionId===q.id);if(!rows.length)continue;
  const gap=rows.filter(o=>o.brandMentioned===false&&o.competitorsMentioned.length>0);
  const uncited=rows.filter(o=>o.brandMentioned===true&&o.brandCited===false);
  const absent=rows.filter(o=>o.brandMentioned===false&&!o.competitorsMentioned.length);
  if(gap.length)out.push({id:`gap:${q.id}`,kind:'competitor_gap',questionId:q.id,engines:enginesOf(gap),text:`공식 페이지에 '${q.text}' 답변 섹션 추가(경쟁 브랜드 ${[...new Set(gap.flatMap(o=>o.competitorsMentioned))].join(', ')}만 언급됨)`});
  if(uncited.length)out.push({id:`uncited:${q.id}`,kind:'mention_without_citation',questionId:q.id,engines:enginesOf(uncited),text:`'${q.text}' 답변에 브랜드는 나오지만 공식 페이지 인용 없음: 확정 사실(주소·영업시간·대표 메뉴)을 공식 페이지 본문에 명시`});
  if(absent.length&&!gap.length)out.push({id:`absent:${q.id}`,kind:'not_mentioned',questionId:q.id,engines:enginesOf(absent),text:`'${q.text}' 답변에 브랜드 없음: 이 질문 문장을 그대로 쓴 자주 묻는 질문(FAQ) 항목을 공식 페이지에 추가`});
 }
 const blocked=GEO_ENGINES.filter(e=>current.some(o=>o.engine===e&&o.status==='login_required'));
 if(blocked.length)out.push({id:'login',kind:'login_required',engines:blocked,link:'manual_observation',text:'로그인이 필요한 엔진은 자동 측정하지 못했습니다. 아래 AI 답변 인용 관측에 직접 확인한 결과를 기록하세요.'});
 if(site.jsonLd!=='present')out.push({id:'json-ld',kind:'json_ld',link:'json_ld_generator',text:site.jsonLd==='absent'?'공식 페이지에 JSON-LD 구조화 데이터 없음: 위 GEO 상품 구조화 데이터 생성기로 만든 JSON-LD를 페이지에 넣기':'JSON-LD 구조화 데이터 미확인: 위 GEO 상품 구조화 데이터 생성기로 만들고 페이지에 있는지 확인'});
 if(site.llmsTxt!=='present')out.push({id:'llms-txt',kind:'llms_txt',link:'llms_txt_template',text:site.llmsTxt==='absent'?'llms.txt 없음: 아래 템플릿으로 사이트 루트에 llms.txt 만들기':'llms.txt 미확인: 사이트 루트(/llms.txt)를 확인하고 없으면 아래 템플릿으로 만들기'});
 return out;
}
// llms.txt 템플릿(확정 사실과 공식 URL만). 빈 항목은 쓰지 않는다. 사람이 검토한 뒤 사이트에 올린다.
export function llmsTxtTemplate(input:{brandName:string;summary:string;officialUrls:readonly string[];facts:readonly {label:string;value:string}[]}):string{
 const line=(s:string)=>s.replace(/\s+/g,' ').trim();
 return [`# ${line(input.brandName)}`,...(input.summary.trim()?['',`> ${line(input.summary).slice(0,300)}`]:[]),
  ...(input.facts.length?['','## 확정 정보',...input.facts.map(f=>`- ${line(f.label)}: ${line(f.value).slice(0,200)}`)]:[]),
  ...(input.officialUrls.length?['','## 공식 페이지',...input.officialUrls.map(u=>`- [${line(input.brandName)}](${u})`)]:[]),''].join('\n');
}
