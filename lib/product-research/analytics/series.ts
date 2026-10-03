// 스냅샷 → 지표 시계열(순수). 모든 점은 원본 스냅샷 ID를 가리킨다(⑨ 근거 추적).
// 점의 시각(at)은 관측 기간의 끝(period.to)이다. 기간이 끝나야 값이 확정되므로, 백테스트의 '기준 시점 이전' 판정도 이 값으로 한다.
import type {MetricKey,SeriesPoint,Series,Snapshot,SourceId,Subject} from '../types';
import {normalizeKeyword} from './normalize';

export const DAY_MS=86400000;
export const timeOf=(at:string)=>{const t=Date.parse(at.length===10?at+'T00:00:00Z':at);return Number.isFinite(t)?t:NaN};
export const dayOf=(t:number)=>new Date(t).toISOString().slice(0,10);
// 키워드는 정규형으로 묶는다('마라 소스'와 '마라소스'는 같은 시계열). 플랫폼 상품은 출처+외부 ID다.
export const subjectKey=(s:Subject)=>s.type==='keyword'?`kw:${normalizeKeyword(s.text)}`:`ls:${s.sourceId}:${s.externalId}`;
export const seriesKey=(subject:string,metric:MetricKey,sourceId:SourceId)=>`${subject}|${metric}|${sourceId}`;

// 같은 (대상, 지표, 출처)의 같은 기간 값이 여러 스냅샷에 있으면, 값이 있는 것 중 가장 늦게 수집한 것을 쓴다(재수집이 정정한 값).
// 실패 스냅샷은 버린다. 부분 스냅샷은 쓰되 limitations가 화면에 따라간다.
export function buildSeries(snapshots:readonly Snapshot[]):Series[]{
 const acc=new Map<string,{subject:string;metric:MetricKey;sourceId:SourceId;byPeriod:Map<string,{at:string;value:number|null;snapshotId:string;fetchedAt:number}>}>();
 for(const snap of snapshots){
  if(snap.status==='failed')continue;const fetched=timeOf(snap.fetchedAt);
  for(const o of snap.observations){
   const subject=subjectKey(o.subject),key=seriesKey(subject,o.metric,snap.sourceId);
   let e=acc.get(key);if(!e){e={subject,metric:o.metric,sourceId:snap.sourceId,byPeriod:new Map()};acc.set(key,e)}
   const period=`${o.period.from}|${o.period.to}`,prev=e.byPeriod.get(period),value=typeof o.value==='number'&&Number.isFinite(o.value)?o.value:null;
   const better=!prev||(value!==null&&prev.value===null)||((value===null)===(prev.value===null)&&(fetched>prev.fetchedAt||(fetched===prev.fetchedAt&&snap.id>prev.snapshotId)));
   if(better)e.byPeriod.set(period,{at:o.period.to,value,snapshotId:snap.id,fetchedAt:fetched});
  }
 }
 const out:Series[]=[];
 for(const e of acc.values()){
  // 기간이 다르지만 끝이 같은 점(예: 주간·일간 혼재)은 기간이 짧은 쪽이 먼저 오고 둘 다 남긴다. 같은 at이 여러 개면 소비자가 toWeekly로 합친다.
  const points=[...e.byPeriod.values()].sort((a,b)=>timeOf(a.at)-timeOf(b.at)||(a.snapshotId<b.snapshotId?-1:1)).map(p=>({at:p.at,value:p.value,snapshotId:p.snapshotId}));
  out.push({subjectKey:e.subject,metric:e.metric,sourceId:e.sourceId,points});
 }
 return out.sort((a,b)=>{const ka=seriesKey(a.subjectKey,a.metric,a.sourceId),kb=seriesKey(b.subjectKey,b.metric,b.sourceId);return ka<kb?-1:ka>kb?1:0});
}

// 기준 시점까지만 남긴다(미래 점 차단). 백테스트·점수표 입력이 이 함수만 거쳐 들어온다.
export function sliceAsOf(series:Series,asOf:string):Series{const T=timeOf(asOf);return {...series,points:series.points.filter(p=>timeOf(p.at)<=T)}}
export function latestValue(points:readonly SeriesPoint[]):SeriesPoint|null{for(let i=points.length-1;i>=0;i--)if(points[i].value!==null)return points[i];return null}
export function findSeries(all:readonly Series[],subject:string,metric:MetricKey,sourceId?:SourceId):Series|null{return all.find(s=>s.subjectKey===subject&&s.metric===metric&&(!sourceId||s.sourceId===sourceId))??null}

// 누적 조회수 → 하루 조회수 증가. 연속한 두 점의 차이를 날짜 수로 나눈다. 누적값이 줄면(집계 재설정·삭제) 그 구간은 미확인(null)이다.
export function videoViewVelocity(points:readonly SeriesPoint[]):SeriesPoint[]{
 const ok=points.filter(p=>p.value!==null).sort((a,b)=>timeOf(a.at)-timeOf(b.at)),out:SeriesPoint[]=[];
 for(let i=1;i<ok.length;i++){
  const days=(timeOf(ok[i].at)-timeOf(ok[i-1].at))/DAY_MS;if(!(days>0))continue;
  const diff=(ok[i].value as number)-(ok[i-1].value as number);
  out.push({at:ok[i].at,value:diff<0?null:diff/days,snapshotId:ok[i].snapshotId});
 }
 return out;
}
export const velocitySeries=(views:Series):Series=>({subjectKey:views.subjectKey,metric:'video_view_velocity',sourceId:views.sourceId,points:videoViewVelocity(views.points)});

// 주 단위로 합친다(월요일 시작, UTC). 값은 주 안 평균, 시각·스냅샷은 그 주 마지막 점이다(기준 시점보다 늦은 시각을 만들지 않는다).
export function toWeekly(points:readonly SeriesPoint[]):SeriesPoint[]{
 const buckets=new Map<number,SeriesPoint[]>();
 for(const p of points){if(p.value===null)continue;const t=timeOf(p.at);if(!Number.isFinite(t))continue;const d=new Date(t),monday=Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate())-((d.getUTCDay()+6)%7)*DAY_MS;buckets.set(monday,[...(buckets.get(monday)??[]),p])}
 return [...buckets.entries()].sort((a,b)=>a[0]-b[0]).map(([,ps])=>{const last=ps.reduce((x,y)=>timeOf(y.at)>=timeOf(x.at)?y:x);return {at:last.at,value:ps.reduce((s,p)=>s+(p.value as number),0)/ps.length,snapshotId:last.snapshotId}});
}
