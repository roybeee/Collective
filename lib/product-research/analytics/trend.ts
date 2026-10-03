// 추세·지속성 분석(순수). 계획 4.2 '성장 모멘텀'·'지속성'. 이상치 한두 점에 흔들리지 않게 Theil–Sen(쌍별 기울기 중앙값)을 쓴다.
// 결정형 규칙이며 예측 모델이 아니다. 임계값은 TREND_RULES 한 곳에 두고 백테스트로만 바꾼다.
import type {SeriesPoint} from '../types';
import {DAY_MS,timeOf,toWeekly} from './series';

export const TREND_RULES={slopeWeeks:12,risingSlope:0.02,decliningSlope:-0.02,fadSpikeRatio:3,fadHalfLifeWeeks:4,fadLookbackWeeks:52,fadRecentWeeks:8,
 seasonalWeeks:13,seasonalCorr:0.5,seasonalAmplitude:1.5,seasonalContrast:1.3,seasonalEdgeWeeks:8,seasonalYoy:[0.6,1.7] as const,minWeeks:4};
export type Durability='steady'|'seasonal'|'fad'|'rising'|'declining';
export type FadInfo={peakAt:string;peak:number;baseline:number;ratio:number;halfLifeWeeks:number|null;resolved:boolean};
export type TrendResult={
 weeks:number;latestAt:string|null;latest:number|null;
 slope12:number|null;      // 최근 12주 ln(값)의 주당 기울기(Theil–Sen)
 slope12Pct:number|null;   // exp(slope)-1: 주당 성장률
 preSpikeSlope:number|null;// 급등이 있으면 급등 직전 12주의 기울기(급등 주를 뺀 바탕 추세)
 wow:number|null;          // 지난주 대비
 yoy:number|null;          // 최근 4주 평균 / 1년 전 같은 4주 평균
 seasonalCorr:number|null; // 최근 13주와 1년 전 같은 13주의 모양 상관(로그값). 1년+13주 이력이 있어야 계산
 seasonalAmplitude:number|null; // 최근 52주 4주 이동평균의 최대/최소
 seasonalOutlook:number|null;    // 1년 전 '지금부터 12주 뒤' 4주 평균 / 1년 전 '지금' 4주 평균. 모두 기준 시점 이전 자료다
 fad:FadInfo|null;spiking:boolean;durability:Durability|null;reasons:string[];evidence:string[];
};
const median=(xs:number[])=>{if(!xs.length)return NaN;const s=[...xs].sort((a,b)=>a-b),m=s.length>>1;return s.length%2?s[m]:(s[m-1]+s[m])/2};
const mean=(xs:number[])=>xs.length?xs.reduce((a,b)=>a+b,0)/xs.length:NaN;
const ln=(v:number)=>Math.log(Math.max(v,0.5));
// Theil–Sen 기울기·절편. x가 같은 쌍은 건너뛴다. 점이 2개 미만이면 null.
export function theilSen(xs:readonly number[],ys:readonly number[]):{slope:number;intercept:number}|null{
 const slopes:number[]=[];for(let i=0;i<xs.length;i++)for(let j=i+1;j<xs.length;j++)if(xs[j]!==xs[i])slopes.push((ys[j]-ys[i])/(xs[j]-xs[i]));
 if(!slopes.length)return null;const slope=median(slopes);return {slope,intercept:median(xs.map((x,i)=>ys[i]-slope*x))};
}
export function pearson(a:readonly number[],b:readonly number[]):number|null{
 if(a.length!==b.length||a.length<3)return null;const ma=mean([...a]),mb=mean([...b]);let num=0,da=0,db=0;
 for(let i=0;i<a.length;i++){num+=(a[i]-ma)*(b[i]-mb);da+=(a[i]-ma)**2;db+=(b[i]-mb)**2}
 return da>0&&db>0?num/Math.sqrt(da*db):null;
}
const fmtPct=(r:number)=>`${r>=0?'+':''}${(r*100).toFixed(1)}%`;

// 반짝 유행: 직전 기준(3~10주 전 중앙값)의 3배 이상 급등 뒤, 4주 안에 (정점-기준)의 절반 아래로 내려오면 유행이다.
// 정점 뒤 자료가 짧아 아직 판정할 수 없으면 spiking(급등 중)으로 둔다. 급등이 4주 넘게 유지되면 유행이 아니라 계단식 상승이다.
function detectFad(w:SeriesPoint[]):{fad:FadInfo|null;spiking:boolean;spikeIndex:number}{
 const R=TREND_RULES,v=w.map(p=>p.value as number),n=v.length;let best:{i:number;ratio:number;base:number}|null=null;
 for(let i=Math.max(10,n-R.fadLookbackWeeks);i<n;i++){
  const base=median(v.slice(i-10,i-2));if(!(base>0))continue;const ratio=v[i]/base;
  if(ratio>=R.fadSpikeRatio&&(!best||ratio>best.ratio))best={i,ratio,base};
 }
 if(!best)return {fad:null,spiking:false,spikeIndex:-1};
 // 급등 시작: 정점 앞쪽으로 기준의 1.5배를 처음 넘은 주.
 let p=best.i;for(let j=best.i;j<Math.min(n,best.i+4);j++)if(v[j]>v[p])p=j;
 let s=p;while(s>0&&v[s-1]>=1.5*best.base)s--;
 const peak=v[p],half=best.base+(peak-best.base)/2;let hl:number|null=null;
 for(let j=p+1;j<n;j++)if(v[j]<=half){hl=Math.round((timeOf(w[j].at)-timeOf(w[p].at))/(7*DAY_MS));break}
 const fad:FadInfo={peakAt:w[p].at,peak,baseline:best.base,ratio:peak/best.base,halfLifeWeeks:hl,resolved:hl!==null};
 if(hl!==null)return hl<=R.fadHalfLifeWeeks?{fad,spiking:false,spikeIndex:s}:{fad:null,spiking:false,spikeIndex:-1};
 const weeksAfter=(timeOf(w[n-1].at)-timeOf(w[p].at))/(7*DAY_MS);
 return weeksAfter<=R.fadHalfLifeWeeks?{fad,spiking:true,spikeIndex:s}:{fad:null,spiking:false,spikeIndex:-1};
}

// 계절 모양: 최근 52주 4주 이동평균에서 가장자리(8주) 밖에 정점이 있고 양 끝보다 1.3배 이상 높거나, 골이 있고 양 끝이 1.3배 이상 높아야 한다.
// 단조 증가·감소(양 끝이 최대·최소)는 진폭이 커도 계절이 아니다(작년과 모양 상관이 높게 나오는 추세 상품을 거른다).
function interiorExtreme(roll:readonly number[]):boolean{
 const E=TREND_RULES.seasonalEdgeWeeks,C=TREND_RULES.seasonalContrast,n=roll.length;if(n<2*E+3)return false;
 const ends=[roll[0],roll[n-1]],inner=roll.slice(E,n-E),hi=Math.max(...inner),lo=Math.min(...inner);
 return hi>=C*Math.max(...ends)||(lo>0&&Math.min(...ends)>=C*lo);
}

// 주간 자료로 바꾼 뒤 분석한다. 점이 4주 미만이면 모든 값이 null이다(0이 아님).
export function analyzeTrend(points:readonly SeriesPoint[],opts:{horizonWeeks?:number}={}):TrendResult{
 const R=TREND_RULES,H=opts.horizonWeeks??12,w=toWeekly(points),n=w.length,reasons:string[]=[];
 const empty:TrendResult={weeks:n,latestAt:n?w[n-1].at:null,latest:n?w[n-1].value:null,slope12:null,slope12Pct:null,preSpikeSlope:null,wow:null,yoy:null,seasonalCorr:null,seasonalAmplitude:null,seasonalOutlook:null,fad:null,spiking:false,durability:null,reasons,evidence:[...new Set(w.map(p=>p.snapshotId))]};
 if(n<R.minWeeks){reasons.push(`주간 이력 ${n}주로 4주 미만이라 추세를 판단하지 않습니다.`);return empty}
 const T=timeOf(w[n-1].at),wk=(p:SeriesPoint)=>(timeOf(p.at)-T)/(7*DAY_MS),v=w.map(p=>p.value as number);
 const slopeOf=(pts:SeriesPoint[])=>{const ts=pts.length>=3?theilSen(pts.map(wk),pts.map(p=>ln(p.value as number))):null;return ts?ts.slope:null};
 const slope12=slopeOf(w.slice(-R.slopeWeeks)),slope12Pct=slope12===null?null:Math.exp(slope12)-1;
 const wow=n>=2&&v[n-2]>0?v[n-1]/v[n-2]-1:null;
 // 시간 창 평균: (T-from주, T-to주]
 const win=(fromWk:number,toWk:number)=>mean(w.filter(p=>{const x=wk(p);return x>-fromWk&&x<=-toWk}).map(p=>p.value as number));
 const now4=win(4,0),ago4=win(56,52),yoy=ago4>0&&Number.isFinite(now4)?now4/ago4:null;
 const span=-wk(w[0]);let seasonalCorr:number|null=null,seasonalAmplitude:number|null=null,seasonalOutlook:number|null=null,shaped=false;
 if(span>=52){
  const roll:number[]=[];for(let i=3;i<n;i++)if(-wk(w[i])<52)roll.push(mean(v.slice(i-3,i+1)));
  const lo=Math.min(...roll),hi=Math.max(...roll);seasonalAmplitude=lo>0?hi/lo:null;shaped=interiorExtreme(roll);
  const fwd=win(52-H+4,52-H),base=win(56,52);seasonalOutlook=base>0&&Number.isFinite(fwd)?fwd/base:null;
 }
 if(span>=52+R.seasonalWeeks-1){
  // 같은 주차끼리 짝을 지어(±3일) 모양 상관을 본다. 짝이 8개 미만이면 계산하지 않는다.
  const a:number[]=[],b:number[]=[];
  for(const p of w.filter(p=>wk(p)>-R.seasonalWeeks)){const target=timeOf(p.at)-364*DAY_MS,q=w.find(x=>Math.abs(timeOf(x.at)-target)<=3*DAY_MS);if(q){a.push(ln(p.value as number));b.push(ln(q.value as number))}}
  seasonalCorr=a.length>=8?pearson(a,b):null;
 }
 const {fad,spiking,spikeIndex}=detectFad(w);
 // 급등 주를 뺀 바탕 추세: 급등 시작 직전 12주. 모멘텀이 반짝 급등을 '성장'으로 읽지 않게 한다.
 const preSpikeSlope=spikeIndex>0?slopeOf(w.slice(Math.max(0,spikeIndex-R.slopeWeeks),spikeIndex)):null;
 const recentPeak=fad?(T-timeOf(fad.peakAt))/(7*DAY_MS)<=R.fadRecentWeeks:false;
 let durability:Durability;
 const seasonal=shaped&&seasonalCorr!==null&&seasonalCorr>=R.seasonalCorr&&seasonalAmplitude!==null&&seasonalAmplitude>=R.seasonalAmplitude&&(yoy===null||(yoy>=R.seasonalYoy[0]&&yoy<=R.seasonalYoy[1]));
 if(spiking&&fad){durability='fad';reasons.push(`최근 기준값의 ${fad.ratio.toFixed(1)}배로 급등했습니다. 4주 안에 절반 아래로 꺼지면 반짝 유행이라 짧게 팔기만 검토합니다.`)}
 else if(fad&&(recentPeak||v[n-1]<2*fad.baseline)){durability='fad';reasons.push(`${fad.peakAt} 주에 기준의 ${fad.ratio.toFixed(1)}배로 치솟은 뒤 ${fad.halfLifeWeeks}주 만에 절반 아래로 꺼진 반짝 유행입니다.`)}
 else if(seasonal){durability='seasonal';reasons.push(`작년 같은 13주와 모양이 닮은(상관 ${seasonalCorr!.toFixed(2)}) 계절 상품입니다. 작년 기준 앞으로 12주 변화는 ${fmtPct((seasonalOutlook??1)-1)}입니다.`)}
 else if(slope12!==null&&slope12>=R.risingSlope){durability='rising';reasons.push(`최근 12주 주당 ${fmtPct(slope12Pct!)}로 꾸준히 오르고 있습니다.`)}
 else if(slope12!==null&&slope12<=R.decliningSlope){durability='declining';reasons.push(`최근 12주 주당 ${fmtPct(slope12Pct!)}로 줄고 있습니다.`)}
 else{durability='steady';reasons.push(`최근 12주 주당 ${fmtPct(slope12Pct??0)}로 큰 변화 없이 유지됩니다.`)}
 if(span<52)reasons.push('1년 미만 이력이라 계절성은 판단하지 않았습니다.');
 return {...empty,slope12,slope12Pct,preSpikeSlope,wow,yoy,seasonalCorr,seasonalAmplitude,seasonalOutlook,fad,spiking,durability,reasons};
}
