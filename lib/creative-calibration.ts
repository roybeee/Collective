// 소재 예측 점수 사후 보정(G2, docs/CREATIVE-SCORE.ko.md 4절). 게시 뒤 실제 반응(노출·클릭)이 쌓인 소재의 예측 점수와 관측 비율(CTR)을 대조해
// 브랜드×채널 보정표를 만든다. 순수 함수만 둔다(난수·시계·모델 호출 없음). 가중치를 자동으로 배우지 않는다. 표는 점수 분위 구간 → 관측 CTR 중앙값과
// 구성 요소별 상관 부호만 담고, 점수 계산(lib/creative-score.ts)은 표가 있을 때 등급만 관측 순위로 바꾼다. 인과 주장은 하지 않는다(docs/EVAL.ko.md 통계 입장).
export const CALIBRATION_VERSION='creative-calibration-v1';
// 게시 뒤 7일이 지나고 노출 30회 이상인 관측만 쓴다. 관측 10건 미만은 표를 만들지 않고, 30건 미만은 '방향성(표본 부족)'으로 표시한다.
export const CALIBRATION_MIN_DAYS=7,CALIBRATION_MIN_IMPRESSIONS=30,CALIBRATION_MIN_N=10,CALIBRATION_USABLE_N=30;
export const CALIBRATION_BINS=3;
export const DIRECTIONAL_LABEL='방향성(표본 부족)',USABLE_LABEL='관측 기반 보정표';
export type CalibrationObservation={artifactId:string;score:number;band:string;components:readonly {key:string;points:number;max:number}[];publishedAt:string;impressions:number;clicks:number};
export type CalibrationBin={from:number;to:number;n:number;medianCtr:number};
export type ComponentSign={key:string;sign:'+'|'-'|'0';n:number};
export type CalibrationStatus='insufficient'|'directional'|'usable';
export type CalibrationTable={version:string;brandId:string;channel:string;status:CalibrationStatus;label:string;n:number;window:{from:string;to:string}|null;excluded:{tooRecent:number;tooFewImpressions:number;invalid:number};bins:CalibrationBin[];monotonic:boolean;agreement:number|null;components:ComponentSign[];limits:string[];computedAt:string};

const DAY=86400000;
const median=(xs:number[])=>{const s=[...xs].sort((a,b)=>a-b),m=s.length>>1;return s.length?s.length%2?s[m]:(s[m-1]+s[m])/2:0};
const round=(v:number,d=4)=>Math.round(v*10**d)/10**d;
const ctrOf=(o:CalibrationObservation)=>o.impressions>0?o.clicks/o.impressions:0;
const bandOfScore=(score:number)=>score>=70?'높음':score>=40?'보통':'낮음';
const valid=(o:CalibrationObservation)=>Number.isFinite(o.score)&&o.score>=0&&o.score<=100&&Number.isInteger(o.impressions)&&o.impressions>=0&&Number.isInteger(o.clicks)&&o.clicks>=0&&o.clicks<=o.impressions&&Number.isFinite(Date.parse(o.publishedAt));

function eligible(observations:readonly CalibrationObservation[],now:number){
 const kept:CalibrationObservation[]=[],excluded={tooRecent:0,tooFewImpressions:0,invalid:0};
 for(const o of observations){
  if(!valid(o)){excluded.invalid++;continue}
  if(now-Date.parse(o.publishedAt)<CALIBRATION_MIN_DAYS*DAY){excluded.tooRecent++;continue}
  if(o.impressions<CALIBRATION_MIN_IMPRESSIONS){excluded.tooFewImpressions++;continue}
  kept.push(o);
 }
 return {kept,excluded};
}
// 점수 분위 구간: 점수 오름차순으로 같은 수로 나눈다(마지막 구간이 나머지를 받는다). 구간 경계는 그 구간의 실제 최소·최대 점수다.
export function quantileBins(rows:readonly CalibrationObservation[],bins=CALIBRATION_BINS):CalibrationBin[]{
 const sorted=[...rows].sort((a,b)=>a.score-b.score||a.artifactId.localeCompare(b.artifactId)),size=Math.floor(sorted.length/bins);
 if(!size)return [];
 return Array.from({length:bins},(_,i)=>{
  const part=sorted.slice(i*size,i===bins-1?sorted.length:(i+1)*size);
  return {from:part[0].score,to:part[part.length-1].score,n:part.length,medianCtr:round(median(part.map(ctrOf)))};
 });
}
// 실현 3분위(상·중·하)와 예측 등급(높음·보통·낮음)이 같은 비율. 표가 설명하는 것은 '일치율'이며 효과 크기가 아니다.
export function bandAgreement(rows:readonly CalibrationObservation[]){
 if(rows.length<3)return null;
 const ctrs=rows.map(ctrOf).sort((a,b)=>a-b),lo=ctrs[Math.floor(ctrs.length/3)],hi=ctrs[Math.floor(ctrs.length*2/3)];
 const realized=(o:CalibrationObservation)=>{const c=ctrOf(o);return c>=hi?'높음':c>=lo?'보통':'낮음'};
 return round(rows.filter(o=>realized(o)===bandOfScore(o.score)).length/rows.length,3);
}
// 구성 요소 점수와 CTR의 공분산 부호. 분산이 0이거나 표본이 3건 미만이면 '0'이다. 상관의 크기·유의성은 적지 않는다.
export function componentSigns(rows:readonly CalibrationObservation[]):ComponentSign[]{
 const keys=[...new Set(rows.flatMap(o=>o.components.map(c=>c.key)))];
 return keys.map(key=>{
  const pairs=rows.flatMap(o=>{const c=o.components.find(x=>x.key===key);return c&&c.max>0?[[c.points/c.max,ctrOf(o)] as const]:[]});
  if(pairs.length<3)return {key,sign:'0' as const,n:pairs.length};
  const mx=pairs.reduce((s,[x])=>s+x,0)/pairs.length,my=pairs.reduce((s,[,y])=>s+y,0)/pairs.length;
  const cov=pairs.reduce((s,[x,y])=>s+(x-mx)*(y-my),0),vx=pairs.reduce((s,[x])=>s+(x-mx)**2,0);
  return {key,sign:vx===0||Math.abs(cov)<1e-12?'0':cov>0?'+':'-',n:pairs.length};
 });
}
const isMonotonic=(bins:readonly CalibrationBin[])=>bins.every((b,i)=>i===0||b.medianCtr>=bins[i-1].medianCtr);
export function buildCalibration(input:{brandId:string;channel:string;observations:readonly CalibrationObservation[];now:string}):CalibrationTable{
 const nowMs=Date.parse(input.now),{kept,excluded}=eligible(input.observations,nowMs),n=kept.length;
 const base={version:CALIBRATION_VERSION,brandId:input.brandId,channel:input.channel,n,excluded,computedAt:input.now};
 const limits=['귀속 ≠ 증분: CTR 차이는 관측된 반응 차이이며 소재 요소가 만든 효과가 아닙니다.','표는 점수 구간별 관측 중앙값과 부호만 담습니다. 가중치를 자동으로 바꾸지 않습니다.'];
 if(n<CALIBRATION_MIN_N)return {...base,status:'insufficient',label:`표본 부족(관측 ${n}건, 최소 ${CALIBRATION_MIN_N}건)`,window:null,bins:[],monotonic:false,agreement:null,components:[],limits};
 const dates=kept.map(o=>o.publishedAt).sort(),bins=quantileBins(kept),status:CalibrationStatus=n>=CALIBRATION_USABLE_N?'usable':'directional';
 return {...base,status,label:status==='usable'?USABLE_LABEL:DIRECTIONAL_LABEL,window:{from:dates[0].slice(0,10),to:dates[dates.length-1].slice(0,10)},bins,monotonic:isMonotonic(bins),agreement:bandAgreement(kept),components:componentSigns(kept),limits};
}
// 점수 계산이 표를 읽는 방식: usable이고 구간 중앙값이 단조이면 점수가 속한 구간의 관측 순위로 등급을 정한다(상위 구간 높음·하위 구간 낮음).
// directional이면 등급은 바꾸지 않고 표본 표시만 더한다. insufficient면 아무것도 바꾸지 않는다.
export type CalibratedBand={band:'낮음'|'보통'|'높음'|null;n:number;window:string|null;note:string|null};
export function calibratedBand(score:number,table:CalibrationTable|null|undefined):CalibratedBand|null{
 if(!table||table.status==='insufficient')return null;
 const window=table.window?`${table.window.from}~${table.window.to}`:null;
 if(table.status==='directional'||!table.monotonic||table.bins.length<2)return {band:null,n:table.n,window,note:`보정표 ${table.status==='directional'?DIRECTIONAL_LABEL:'비단조(등급 미적용)'} · n=${table.n}${window?`, 기간 ${window}`:''}`};
 const idx=Math.max(0,table.bins.findIndex((b,i)=>score<=b.to||i===table.bins.length-1)),rank=idx/(table.bins.length-1);
 return {band:rank>=0.67?'높음':rank<=0.33?'낮음':'보통',n:table.n,window,note:`보정표 적용 · n=${table.n}${window?`, 기간 ${window}`:''}`};
}
