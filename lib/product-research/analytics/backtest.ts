// 백테스트(순수). 계획 8절 1번·④: 기준 시점 T에 점수를 고정하고(입력은 T 이전 점만), T+H주의 실제 변화로 정답을 매겨 정밀도@k·순위 상관을 잰다.
// 기준선 셋(현재 1위·모멘텀만·무작위)과 같은 후보·같은 정답으로 비교한다. 무작위는 시드로 결정형이다.
import type {BacktestResult,ScoreCard,SubScoreKey} from '../types';
import {SUB_SCORES} from '../types';
import type {WeightsProposalView} from '../api';
import {shortId,sha256Hex} from './hash';
import {buildScoreInput,scoreCard,type ProductBundle,type ScoreInput} from './score';
import {DAY_MS,timeOf,toWeekly} from './series';

export type BacktestRow={productId:string;score:number|null;tier:ScoreCard['tier'];outcome:number|null;positive:boolean|null;outcomeBasis:'search'|'rank'|null;baselines:{current_top:number|null;momentum_only:number|null;random:number}};
export type BacktestRun={result:BacktestResult;rows:BacktestRow[];cards:ScoreCard[];inputs:ScoreInput[]};

// 정밀도@k: 점수 내림차순(동점은 productId 오름차순, null은 맨 뒤) 상위 k개 중 정답 비율. 평가 대상이 k개 미만이면 null.
export function precisionAtK(items:readonly {id:string;score:number|null;positive:boolean}[],k:number):number|null{
 if(items.length<k||k<=0)return null;
 const sorted=[...items].sort((a,b)=>(a.score===null?1:0)-(b.score===null?1:0)||((b.score??0)-(a.score??0))||(a.id<b.id?-1:a.id>b.id?1:0));
 return sorted.slice(0,k).filter(x=>x.positive).length/k;
}
// 평균 순위(동점은 평균). 1부터.
export function ranks(xs:readonly number[]):number[]{
 const idx=xs.map((v,i)=>({v,i})).sort((a,b)=>a.v-b.v),out=new Array<number>(xs.length);
 for(let s=0;s<idx.length;){let e=s;while(e+1<idx.length&&idx[e+1].v===idx[s].v)e++;const r=(s+e)/2+1;for(let j=s;j<=e;j++)out[idx[j].i]=r;s=e+1}
 return out;
}
// 스피어만 순위 상관: 순위에 대한 피어슨 상관(동점 보정). 쌍이 3개 미만이거나 분산이 0이면 null.
export function spearman(a:readonly number[],b:readonly number[]):number|null{
 if(a.length!==b.length||a.length<3)return null;const ra=ranks(a),rb=ranks(b),n=a.length,ma=ra.reduce((s,x)=>s+x,0)/n,mb=rb.reduce((s,x)=>s+x,0)/n;
 let num=0,da=0,db=0;for(let i=0;i<n;i++){num+=(ra[i]-ma)*(rb[i]-mb);da+=(ra[i]-ma)**2;db+=(rb[i]-mb)**2}
 return da>0&&db>0?num/Math.sqrt(da*db):null;
}
// 시드 난수(mulberry32). 같은 시드·같은 상품 ID면 같은 값.
export function seededRandom(seed:string,id:string):number{
 let t=parseInt(sha256Hex(seed+'\u0000'+id).slice(0,8),16)>>>0;
 t=(t+0x6d2b79f5)>>>0;let r=Math.imul(t^(t>>>15),1|t);r=(r+Math.imul(r^(r>>>7),61|r))^r;return ((r^(r>>>14))>>>0)/4294967296;
}

// 결과값: 대표 키워드 검색 추세(같은 시계열 안 비율이라 보정 배율과 무관)의 T 직전 4주 평균 대비 T+H 직전 4주 평균 변화.
// 추세가 없으면 순위 개선률((이전 순위/이후 순위)-1). 둘 다 없으면 null(평가에서 뺌).
export function outcomeOf(b:ProductBundle,asOf:string,horizonWeeks:number):{value:number|null;basis:'search'|'rank'|null}{
 const T=timeOf(asOf),E=T+horizonWeeks*7*DAY_MS,win=(pts:{at:string;value:number|null}[],to:number)=>{const vs=pts.filter(p=>p.value!==null&&timeOf(p.at)>to-28*DAY_MS&&timeOf(p.at)<=to).map(p=>p.value as number);return vs.length?vs.reduce((a,c)=>a+c,0)/vs.length:null};
 const primary=b.keywordKeys[0],trend=b.series.find(s=>s.subjectKey===primary&&s.metric==='search_trend');
 if(trend){const w=toWeekly(trend.points),before=win(w,T),after=win(w,E);if(before!==null&&after!==null&&before>0)return {value:after/before-1,basis:'search'}}
 for(const k of b.listingKeys){const s=b.series.find(x=>x.subjectKey===k&&x.metric==='rank');if(!s)continue;const before=win(s.points,T),after=win(s.points,E);if(before!==null&&after!==null&&after>0)return {value:before/after-1,basis:'rank'}}
 return {value:null,basis:null};
}

// outcomes(선택): 정답 계산에만 쓰는 묶음(상품 ID별). 서버 백테스트는 후보·점수를 기준 시점 이전 관측만으로 만든 묶음(candidates)으로 내고,
// 정답은 같은 대상 키의 전체 시계열 묶음(outcomes)으로 잰다. 없으면 candidates를 그대로 쓴다. 어느 쪽이든 점수는 buildScoreInput이 asOf로 자른 점만 본다.
// 기준선 current_top: 기준 시점 입력의 수요(보정 검색량), 없으면 기준 시점 순위(작을수록 위). 둘 다 기준 시점 이전 자료다.
export function runBacktest(opts:{candidates:readonly ProductBundle[];asOf:string;horizonWeeks:number;weightsVersion?:string;threshold?:number;ks?:readonly number[];seed?:string;computedAt:string;outcomes?:ReadonlyMap<string,ProductBundle>}):BacktestRun{
 const version=opts.weightsVersion??'w1',X=opts.threshold??0.3,ks=opts.ks??[10,20],seed=opts.seed??'pr-backtest',H=opts.horizonWeeks;
 const inputs:ScoreInput[]=[],cards:ScoreCard[]=[],rows:BacktestRow[]=[];
 for(const b of opts.candidates){
  // 점수는 asOf로 고정한 입력에서만 나온다(buildScoreInput이 미래 점을 잘라 낸다). 정답만 전체 시계열을 본다.
  const input=buildScoreInput(b,opts.asOf),card=scoreCard(input,{weightsVersion:version,computedAt:opts.computedAt}),o=outcomeOf(opts.outcomes?.get(b.productId)??b,opts.asOf,H);
  inputs.push(input);cards.push(card);
  rows.push({productId:b.productId,score:card.total,tier:card.tier,outcome:o.value,positive:o.value===null?null:o.value>=X,outcomeBasis:o.basis,
   baselines:{current_top:input.demand?.monthlyVolume??(input.rank?.current!=null?-input.rank.current:null),momentum_only:input.trend?.slope12??null,random:seededRandom(seed,b.productId)}});
 }
 const evaluated=rows.filter(r=>r.positive!==null);
 const pk=(pick:(r:BacktestRow)=>number|null)=>ks.map(k=>({k,value:precisionAtK(evaluated.map(r=>({id:r.productId,score:pick(r),positive:r.positive as boolean})),k)}));
 const pairs=evaluated.filter(r=>r.score!==null);
 const result:BacktestResult={
  id:shortId('prb',{version,asOf:opts.asOf,H,X,seed,ids:rows.map(r=>r.productId).sort()}),weightsVersion:version,asOf:opts.asOf,horizonWeeks:H,candidates:evaluated.length,
  precisionAtK:pk(r=>r.score),spearman:spearman(pairs.map(r=>r.score as number),pairs.map(r=>r.outcome as number)),
  baselines:[{name:'current_top',precisionAtK:pk(r=>r.baselines.current_top)},{name:'momentum_only',precisionAtK:pk(r=>r.baselines.momentum_only)},{name:'random',precisionAtK:pk(r=>r.baselines.random)}],
  label:`기준 시점 뒤 ${H}주에 대표 키워드 검색량(보정)이, 검색 추세가 없으면 플랫폼 순위가 ${Math.round(X*100)}% 이상 오른 상품`,computedAt:opts.computedAt,
 };
 return {result,rows,cards,inputs};
}

// ── 가중치 재보정 후보(평가 3회차 ⑩ 학습 고리, 순수·읽기 전용). 결정 때 점수표의 하위 점수와 출시 뒤 실제 순매출(같은 주 수 창, 다 지난 것만)의 순위 상관(스피어만)으로
// 다음 판(w2) 가중치를 '제안'한다. 제안식: w2_k ∝ w_k × max(0, 1 + ρ_k) (상관을 못 잰 하위 점수는 ρ=0, 즉 그대로), 합 1로 맞추고 소수 셋째 자리로 반올림.
// 표본이 minN 미만이면 제안하지 않는다(null과 까닭). 점수표·가중치 판은 바꾸지 않는다. 새 판은 백테스트로 기준선 대비 결과를 본 뒤 사람이 정한다.
export const RECALIBRATION_MIN_N=8,RECALIBRATION_WEEKS=8;
export type RecalibrationRow={subScores:Partial<Record<SubScoreKey,number|null>>;revenue:number};
export function proposeWeights(rows:readonly RecalibrationRow[],base:Record<SubScoreKey,number>,opts:{at:string;baseVersion:string;weeks?:number;minN?:number}):WeightsProposalView{
 const minN=opts.minN??RECALIBRATION_MIN_N,weeks=opts.weeks??RECALIBRATION_WEEKS,n=rows.length;
 const correlations=SUB_SCORES.map(key=>{
  const pairs=rows.filter(r=>typeof r.subScores[key]==='number');
  const rho=pairs.length>=minN?spearman(pairs.map(r=>r.subScores[key] as number),pairs.map(r=>r.revenue)):null;
  return {key,rho:rho===null?null:Math.round(rho*1000)/1000,n:pairs.length};
 });
 const caveats=[
  '제안일 뿐 적용하지 않습니다. 점수표는 지금 가중치 판을 그대로 씁니다. 새 판으로 백테스트해 기준선보다 나은지 확인한 뒤 사람이 정합니다.',
  '표본은 승인해 성장2로 넘긴 후보뿐입니다. 제외·보류한 후보의 매출은 모르므로 선택 편향이 있습니다.',
  `출시 뒤 ${weeks}주 순매출은 가격·광고·재고처럼 점수 밖 요인의 영향을 받습니다.`,
  ...(n<30?[`표본이 ${n}개로 적어 상관이 우연일 수 있습니다.`]:[]),
 ];
 const out={at:opts.at,weeks,n,minN,baseVersion:opts.baseVersion,base:{...base},correlations,caveats};
 if(n<minN)return {...out,proposed:null,reason:`출시 뒤 ${weeks}주가 다 지나고 순매출을 아는 결과가 ${n}개라 가중치를 제안하지 않았습니다(최소 ${minN}개).`};
 if(!correlations.some(c=>c.rho!==null))return {...out,proposed:null,reason:'하위 점수와 순매출의 순위 상관을 잴 수 있는 항목이 없어(값이 같거나 비어 있음) 가중치를 제안하지 않았습니다.'};
 const raw=SUB_SCORES.map(k=>base[k]*Math.max(0,1+(correlations.find(c=>c.key===k)?.rho??0))),sum=raw.reduce((a,b)=>a+b,0);
 if(!(sum>0))return {...out,proposed:null,reason:'모든 하위 점수가 순매출과 거꾸로 움직여 가중치를 제안하지 않았습니다.'};
 const rounded=raw.map(x=>Math.round(x/sum*1000)/1000),drift=Math.round((1-rounded.reduce((a,b)=>a+b,0))*1000)/1000;
 if(drift!==0){const i=rounded.indexOf(Math.max(...rounded));rounded[i]=Math.round((rounded[i]+drift)*1000)/1000}
 return {...out,proposed:Object.fromEntries(SUB_SCORES.map((k,i)=>[k,rounded[i]])) as Record<SubScoreKey,number>,reason:null};
}
