// 바이럴 실험 판정 통계. Beta-Binomial 사후분포로 'B가 A보다 나을 확률'과 상대 lift 신용구간을 계산한다.
// 난수를 쓰지 않는 결정론 수치 적분이다. 같은 입력은 항상 같은 값을 낸다. import가 없어 화면·서버·테스트가 그대로 쓴다.
// 방법·한계: docs/VIRAL-STATS.ko.md
export class ViralStatsError extends Error{status=422;constructor(message:string){super(message);this.name='ViralStatsError'}}
export type Counts={successes:number;trials:number};
export type Prior={a:number;b:number};
export type WarningCode='sample_below_plan'|'duration_below_plan'|'not_comparable'|'repeated_looks';
export type InterimWarning={codes:WarningCode[];message:string};
export type Recommendation='adopt'|'stop'|'inconclusive';
// 기존 판정(evaluateExperiment)의 상태. 채택 권고가 승격 조건과 어긋나지 않도록 받는다.
export type Judgement='insufficient'|'promising'|'not_supported'|'inconclusive';
// liftLow·liftHigh는 백분율(+12.34 = 12.34% 개선)이다. 판정의 assessment.lift와 같은 단위다. 구간 끝이 비율 10⁶배를 넘으면 null이다(하한 포함).
// controlRate·treatmentRate는 관측 비율, looks는 이번 확인 전에 판정할 수 있는 결과(계획 충족·비교 가능)를 본 횟수다.
export type ViralStats={probBetter:number;liftLow:number|null;liftHigh:number|null;level:number;controlRate:number;treatmentRate:number;n:{control:number;treatment:number};prior:Prior;warning:InterimWarning|null;recommendation:Recommendation;looks:number};
export type PlanInput={minSample:number;minHours:number;startedAt:string|null};
type ArmLike={denominator:number|null;numerator?:number|null};
type LookResult={control:ArmLike;treatment:ArmLike;observedUntil:string;comparable?:boolean};
export const DEFAULT_PRIOR:Prior={a:1,b:1};
export const LIFT_LEVEL=0.9,ADOPT_AT=0.95,STOP_AT=0.05;
export const recommendationLabels:Record<Recommendation,string>={adopt:'채택 권고',stop:'중단 권고',inconclusive:'판단 보류 권고'};
// 사후분포 평균 ± SPAN 표준편차 구간을 STEPS 칸으로 나눠 CDF 표를 만든다. 구간 밖 확률은 무시할 만큼 작아 4자리에 영향이 없다.
// Workers CPU 한도를 고려해 한 번의 결과 저장이 수십 ms 안에 끝나도록 칸 수와 분위수 탐색 횟수를 정했다.
// 분모가 10억을 넘으면 lgamma의 부동소수 오차가 4자리 정밀도를 해친다. 그 이상은 계산하지 않는다.
export const MAX_TRIALS=1e9;
const SPAN=12,STEPS=1000,MAXIT=100000,R_MIN=1e-6,R_MAX=1e6,ROOT_TOL=1e-10,ROOT_MAXIT=200;
const round=(v:number,d:number)=>Math.round(v*10**d)/10**d;

function counts(x:Counts,label:string):Counts{
 const s=x?.successes,n=x?.trials;
 if(!Number.isSafeInteger(s)||!Number.isSafeInteger(n)||s<0||n<0)throw new ViralStatsError(`${label}의 반응 수와 분모는 0 이상의 정수여야 합니다.`);
 if(s>n)throw new ViralStatsError(`${label}의 반응 수는 분모를 넘을 수 없습니다.`);
 if(n>MAX_TRIALS)throw new ViralStatsError(`${label}의 분모는 ${MAX_TRIALS}(10억) 이하여야 합니다.`);
 return {successes:s,trials:n};
}
function checkedPrior(p:Prior){if(!p||!Number.isFinite(p.a)||!Number.isFinite(p.b)||p.a<=0||p.b<=0)throw new ViralStatsError('사전분포 모수는 0보다 큰 유한한 수여야 합니다.');return p}
export function betaPosterior(successes:number,trials:number,prior:Prior=DEFAULT_PRIOR){
 const c=counts({successes,trials},'실험안'),p=checkedPrior(prior),a=p.a+c.successes,b=p.b+c.trials-c.successes;
 return {a,b,mean:a/(a+b)};
}

// Lanczos 근사(g=7). 인자는 항상 양수다.
const LANCZOS=[0.99999999999980993,676.5203681218851,-1259.1392167224028,771.32342877765313,-176.61502916214059,12.507343278686905,-0.13857109526572012,9.9843695780195716e-6,1.5056327351493116e-7];
function lgamma(x:number):number{
 if(x<0.5)return Math.log(Math.PI/Math.sin(Math.PI*x))-lgamma(1-x);
 const z=x-1,t=z+7.5;let s=LANCZOS[0];for(let i=1;i<9;i++)s+=LANCZOS[i]/(z+i);
 return 0.5*Math.log(2*Math.PI)+(z+0.5)*Math.log(t)-t+Math.log(s);
}
// 정규화 불완전 베타 함수 I_x(a,b)의 연분수 전개(수정 Lentz). 수렴이 빠른 쪽으로 대칭 변환한다.
function continuedFraction(x:number,a:number,b:number){
 const tiny=1e-300,fix=(v:number)=>Math.abs(v)<tiny?tiny:v;
 let c=1,d=1/fix(1-(a+b)*x/(a+1)),h=d;
 for(let m=1;m<=MAXIT;m++){
  const m2=2*m,even=m*(b-m)*x/((a-1+m2)*(a+m2));d=1/fix(1+even*d);c=fix(1+even/c);h*=d*c;
  const odd=-(a+m)*(a+b+m)*x/((a+m2)*(a+1+m2));d=1/fix(1+odd*d);c=fix(1+odd/c);const del=d*c;h*=del;
  if(Math.abs(del-1)<1e-15)break;
 }
 return h;
}
// lb = ln B(a,b). 표 하나에서 같은 값을 반복 계산하지 않도록 호출자가 넘긴다.
function betaCdf(x:number,a:number,b:number,lb:number){
 if(x<=0)return 0;if(x>=1)return 1;
 const front=Math.exp(a*Math.log(x)+b*Math.log1p(-x)-lb);
 return x<(a+1)/(a+b+2)?front*continuedFraction(x,a,b)/a:1-front*continuedFraction(1-x,b,a)/b;
}
type Table={lo:number;hi:number;h:number;x:number[];F:number[]};
function table(a:number,b:number):Table{
 const mean=a/(a+b),sd=Math.sqrt(a*b/((a+b)**2*(a+b+1))),lo=Math.max(0,mean-SPAN*sd),hi=Math.min(1,mean+SPAN*sd),h=(hi-lo)/STEPS;
 const x=Array.from({length:STEPS+1},(_,i)=>i===STEPS?hi:lo+i*h);
 const lb=lgamma(a)+lgamma(b)-lgamma(a+b);
 return {lo,hi,h,x,F:x.map(v=>betaCdf(v,a,b,lb))};
}
// 표 안은 선형 보간, 표 밖은 0·1까지 직선으로 잇는다(표 밖 확률은 무시할 만큼 작다).
function cdfAt(t:Table,v:number){
 if(v<=0)return 0;if(v>=1)return 1;
 if(v<t.lo)return t.F[0]*v/t.lo;
 if(v>t.hi)return t.F[STEPS]+(1-t.F[STEPS])*(v-t.hi)/(1-t.hi);
 const i=Math.min(STEPS-1,Math.floor((v-t.lo)/t.h)),w=(v-t.x[i])/(t.x[i+1]-t.x[i]);
 return t.F[i]+w*(t.F[i+1]-t.F[i]);
}
// 정렬된 두 격자를 합친다. 두 분포 중 어느 쪽이 급하게 변해도 그 구간의 해상도를 유지한다.
function merge(p:number[],q:number[]){
 const out=[0];let i=0,j=0;
 while(i<p.length||j<q.length){const v=j>=q.length||(i<p.length&&p[i]<=q[j])?p[i++]:q[j++];if(v>out[out.length-1]&&v<1)out.push(v)}
 out.push(1);return out;
}
// ∫ H dG 의 Stieltjes 사다리꼴 합. 같은 격자에서 ∫H dG + ∫G dH = 1 이 정확히 성립해 대칭성이 보존된다.
function stieltjes(grid:number[],G:(v:number)=>number,H:(v:number)=>number){
 let s=0,g0=G(grid[0]),h0=H(grid[0]);
 for(let i=1;i<grid.length;i++){const g1=G(grid[i]),h1=H(grid[i]);s+=(g1-g0)*(h0+h1)/2;g0=g1;h0=h1}
 return s;
}
function tables(control:Counts,treatment:Counts,prior:Prior){
 const c=counts(control,'대조안'),t=counts(treatment,'실험안'),p=checkedPrior(prior);
 return {c:table(p.a+c.successes,p.b+c.trials-c.successes),t:table(p.a+t.successes,p.b+t.trials-t.successes)};
}
// P(p_t > p_c) = ∫ F_c(x) dF_t(x). 소수 4자리로 반올림한다.
function probFrom(c:Table,t:Table){return round(Math.min(1,Math.max(0,stieltjes(merge(c.x,t.x),x=>cdfAt(t,x),x=>cdfAt(c,x)))),4)}
export function probTreatmentBetter(control:Counts,treatment:Counts,prior:Prior=DEFAULT_PRIOR){
 const {c,t}=tables(control,treatment,prior);return probFrom(c,t);
}
// 단조 증가 함수 f의 f(x)=0 근을 [lo,hi]에서 찾는다(Illinois 수정 가위치법). 이분법보다 적은 평가로 수렴한다.
function root(f:(x:number)=>number,lo:number,hi:number,flo:number,fhi:number){
 let side=0;
 for(let i=0;i<ROOT_MAXIT&&hi-lo>ROOT_TOL;i++){
  const x=(lo*fhi-hi*flo)/(fhi-flo),fx=f(x);
  if(Math.abs(fx)<ROOT_TOL)return x;
  if(fx<0){lo=x;flo=fx;if(side===-1)fhi/=2;side=-1}else{hi=x;fhi=fx;if(side===1)flo/=2;side=1}
 }
 return (lo+hi)/2;
}
// 상대 lift = p_t/p_c - 1 의 등꼬리 신용구간. 비율 R의 CDF P(p_t ≤ r·p_c) = ∫ F_t(r·y) dF_c(y) 를 계산하고 로그 척도 이분법으로 분위수를 찾는다.
function liftFrom(c:Table,t:Table,level:number){
 const G=(r:number)=>stieltjes(merge(c.x,t.x.map(x=>x/r)),y=>cdfAt(c,y),y=>cdfAt(t,r*y));
 const gMin=G(R_MIN),gMax=G(R_MAX);
 const quantile=(q:number)=>gMax<q?null:gMin>=q?R_MIN:Math.exp(root(x=>G(Math.exp(x))-q,Math.log(R_MIN),Math.log(R_MAX),gMin-q,gMax-q));
 const pct=(r:number|null)=>r===null?null:round((r-1)*100,2);
 return {level,low:pct(quantile((1-level)/2)),high:pct(quantile((1+level)/2))};
}
function checkedLevel(level:number){if(!Number.isFinite(level)||level<=0||level>=1)throw new ViralStatsError('신용구간 수준은 0과 1 사이여야 합니다.');return level}
export function liftInterval(control:Counts,treatment:Counts,level=LIFT_LEVEL,prior:Prior=DEFAULT_PRIOR){
 const lv=checkedLevel(level),{c,t}=tables(control,treatment,prior);return liftFrom(c,t,lv);
}

// 계획 미달 사유. 관찰 시간은 측정 종료 시점까지로 잰다(화면을 연 시점이 아니다).
export function planShortfall(e:PlanInput,result:LookResult|null|undefined,now:number):WarningCode[]{
 const n=Math.min(result?.control?.denominator??0,result?.treatment?.denominator??0);
 const end=Math.min(result?Date.parse(result.observedUntil):now,now),hours=e.startedAt?(end-Date.parse(e.startedAt))/3600000:NaN;
 return [...(n<e.minSample?['sample_below_plan' as const]:[]),...(!(hours>=e.minHours)?['duration_below_plan' as const]:[])];
}
// 중간 확인(peeking) 경고. looks는 이번 확인 전에 판정할 수 있는 결과(계획 충족·비교 가능)를 본 횟수다.
// 계획 전에 판정하면 표본·기간 미달로, 비교 가능성(대상·기간·배포 조건)을 확인하지 않았으면 비교 가능성 미확인으로,
// 계획을 채운 뒤 결과를 보며 다시 측정·정정하면 반복 확인으로 경고한다.
export function interimWarning(e:PlanInput&{result?:LookResult|null},looks:number,now:number):InterimWarning|null{
 if(!Number.isSafeInteger(looks)||looks<0)throw new ViralStatsError('확인 횟수는 0 이상의 정수여야 합니다.');
 if(!Number.isFinite(now)||!Number.isFinite(e?.minSample)||!Number.isFinite(e?.minHours))throw new ViralStatsError('실험 계획의 최소 표본·관찰 시간을 확인해 주세요.');
 const codes:WarningCode[]=[...planShortfall(e,e.result,now),...(e.result?.comparable===false?['not_comparable' as const]:[]),...(looks>=1?['repeated_looks' as const]:[])];
 if(!codes.length)return null;
 const text:Record<WarningCode,string>={sample_below_plan:`최소 표본(각 안 ${e.minSample}) 미달`,duration_below_plan:`최소 관찰 시간(${e.minHours}시간) 미달`,not_comparable:'대상·기간·배포 조건의 비교 가능성 미확인',repeated_looks:`계획을 채운 결과를 이미 ${looks}회 확인한 뒤 재확인`};
 return {codes,message:`중간 확인 경고 · ${codes.map(x=>text[x]).join(' · ')}. 지금 결과로 채택하면 우연한 차이를 채택할 위험이 커집니다.`};
}
// 채택 권고는 기존 판정이 관찰상 개선일 때만 낸다. 목표 개선율 미달·대조안 반응 0·근거 부족이면 확률이 높아도 채택을 권하지 않는다.
export function recommend(probBetter:number,warning:InterimWarning|null,judgement?:Judgement|null):Recommendation{
 return probBetter>=ADOPT_AT&&!warning&&judgement==='promising'?'adopt':probBetter<=STOP_AT?'stop':'inconclusive';
}
// 사람의 확정이 통계 권고와 어긋나는 경우. 확정을 막지 않고 규칙에 기록한다(사유는 선택). 통계가 없으면(비율 지표 없음) 어긋남도 없다.
export function decisionConflict(stats:Pick<ViralStats,'recommendation'|'warning'>|null|undefined,decision:'adopt'|'stop'):'interim'|'mismatch'|null{
 if(!stats)return null;
 if(decision==='adopt'&&stats.warning)return 'interim';
 return stats.recommendation===decision?null:'mismatch';
}
// 비율로 볼 수 있는 arm만 통계를 낸다. 공유·클릭처럼 반응 수가 분모를 넘을 수 있는 이벤트 집계는 이항 모형이 맞지 않는다.
export function armCounts(arm:ArmLike|null|undefined):Counts|null{
 const n=arm?.denominator,s=arm?.numerator;
 return typeof n==='number'&&typeof s==='number'&&Number.isSafeInteger(n)&&Number.isSafeInteger(s)&&n>0&&n<=MAX_TRIALS&&s>=0&&s<=n?{successes:s,trials:n}:null;
}
export function summarizeResult(e:PlanInput,result:LookResult,looks:number,now:number,judgement:Judgement|null):ViralStats|null{
 const c=armCounts(result.control),t=armCounts(result.treatment);if(!c||!t)return null;
 // 두 사후분포 표를 한 번만 만들어 확률과 구간에 함께 쓴다.
 const {c:tc,t:tt}=tables(c,t,DEFAULT_PRIOR),probBetter=probFrom(tc,tt),lift=liftFrom(tc,tt,LIFT_LEVEL),warning=interimWarning({...e,result},looks,now);
 return {probBetter,liftLow:lift.low,liftHigh:lift.high,level:LIFT_LEVEL,controlRate:c.successes/c.trials,treatmentRate:t.successes/t.trials,n:{control:c.trials,treatment:t.trials},prior:{...DEFAULT_PRIOR},warning,recommendation:recommend(probBetter,warning,judgement),looks};
}
