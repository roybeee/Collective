// J1 심사 보정 통계: 기준별 대표 라벨(사람 점수)과 심사 점수 쌍의 이차 가중 κ·Spearman ρ·부트스트랩 κ 하한, uncertain 비율, 양극 점수, 길이 편향과 채택 판정.
// 순수 함수(모델·네트워크·DB 없음). 채택 조건은 품질 계획 v2 (4)와 AI 심사 보정 설계 v1 3절을 따른다. 채택 뒤에도 심사는 막기만 하고 통과시키지 않는다(J4).
import {cohenKappa} from './quality-kappa';
import {JUDGE_CRITERIA,JUDGE_INVALID,RUBRIC_VERSION,type JudgeCriterionId,type JudgeInvalid} from './judge-rubric';

export class JudgeStatsError extends Error{status=422;constructor(message:string){super(message);this.name='JudgeStatsError'}}
export type ScorePair={human:number;judge:number};
const SCORES=[1,2,3,4,5];
const isScore=(v:unknown)=>Number.isInteger(v)&&(v as number)>=1&&(v as number)<=5;
// 공개 함수의 입력 검사. 부트스트랩 재표본은 검사한 쌍에서만 뽑으므로 다시 검사하지 않는다(kappaOf).
function checkedPairs(pairs:readonly ScorePair[]):readonly ScorePair[]{
 if(!Array.isArray(pairs)||!pairs.every(p=>!!p&&isScore(p.human)&&isScore(p.judge)))throw new JudgeStatsError('점수 쌍은 사람·심사 점수가 모두 1~5 정수인 배열이어야 합니다.');
 return pairs;
}
// κ_w=1-Σ(i-j)²·O_ij/Σ(i-j)²·E_ij. O는 관측 비율, E는 두 평가자 점수 분포의 곱이다. 범주를 1~5로 고정해 가중치 분모 (k-1)²는 약분된다.
// 기대 불일치가 0이면(두 쪽이 같은 한 점수뿐) 정의할 수 없어 null이다. 쌍이 없어도 null.
export const weightedKappa=(pairs:readonly ScorePair[]):number|null=>kappaOf(checkedPairs(pairs));
function kappaOf(pairs:readonly ScorePair[]):number|null{
 const n=pairs.length;
 if(!n)return null;
 const share=(side:keyof ScorePair)=>SCORES.map(k=>pairs.filter(p=>p[side]===k).length/n),h=share('human'),j=share('judge');
 const observed=pairs.reduce((s,p)=>s+(p.human-p.judge)**2,0)/n,expected=SCORES.reduce((s,_,a)=>s+SCORES.reduce((t,__,b)=>t+(a-b)**2*h[a]*j[b],0),0);
 return expected<1e-12?null:1-observed/expected;
}
// 평균 순위(동점은 순위 평균). 표본이 수백 건 이하라 단순 계산으로 둔다.
function ranks(xs:readonly number[]):number[]{
 const sorted=[...xs].sort((a,b)=>a-b);
 return xs.map(v=>(sorted.indexOf(v)+sorted.lastIndexOf(v))/2+1);
}
// Spearman ρ = 평균 순위의 Pearson 상관. 두 값 미만이거나 한쪽이 상수면 null.
export function spearman(xs:readonly number[],ys:readonly number[]):number|null{
 if(xs.length!==ys.length)throw new JudgeStatsError('두 값 목록의 길이가 같아야 합니다.');
 if(![...xs,...ys].every(v=>typeof v==='number'&&Number.isFinite(v)))throw new JudgeStatsError('순위 상관의 값은 모두 유한한 수여야 합니다.');
 if(xs.length<2)return null;
 const rx=ranks(xs),ry=ranks(ys),mean=(v:number[])=>v.reduce((s,x)=>s+x,0)/v.length,mx=mean(rx),my=mean(ry);
 const sxy=rx.reduce((s,x,i)=>s+(x-mx)*(ry[i]-my),0),sxx=rx.reduce((s,x)=>s+(x-mx)**2,0),syy=ry.reduce((s,y)=>s+(y-my)**2,0);
 return sxx<1e-12||syy<1e-12?null:sxy/Math.sqrt(sxx*syy);
}

// ── 부트스트랩 κ 하한 ──
// 쌍을 복원 추출해 κ_w를 iterations번 다시 재고, 양측 (1-alpha) 구간의 하한(alpha/2 분위)을 낸다. 난수는 고정 시드 mulberry32라 같은 입력이면 같은 값이다.
export const BOOTSTRAP=Object.freeze({iterations:2000,alpha:0.05,seed:0x4a31});
const MAX_ITERATIONS=100000;
export type BootstrapOptions={iterations?:number;seed?:number;alpha?:number};
function mulberry32(seed:number){
 let a=seed>>>0;
 return ()=>{a=(a+0x6d2b79f5)>>>0;let t=a;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return ((t^(t>>>14))>>>0)/4294967296};
}
// 선형 보간 분위수(numpy 기본 방식).
const quantile=(sorted:readonly number[],q:number)=>{const at=(sorted.length-1)*q,lo=Math.floor(at),hi=Math.ceil(at);return sorted[lo]+(sorted[hi]-sorted[lo])*(at-lo)};
export function bootstrapKappaLower(pairs:readonly ScorePair[],opts:BootstrapOptions={}):number|null{
 const iterations=opts.iterations??BOOTSTRAP.iterations,seed=opts.seed??BOOTSTRAP.seed,alpha=opts.alpha??BOOTSTRAP.alpha;
 if(!Number.isInteger(iterations)||iterations<1||iterations>MAX_ITERATIONS)throw new JudgeStatsError(`부트스트랩 반복 수는 1~${MAX_ITERATIONS} 정수여야 합니다.`);
 if(!Number.isSafeInteger(seed))throw new JudgeStatsError('부트스트랩 시드는 정수여야 합니다.');
 if(!(alpha>0&&alpha<1))throw new JudgeStatsError('부트스트랩 alpha는 0과 1 사이여야 합니다.');
 const n=checkedPairs(pairs).length;
 if(!n)return null;
 const next=mulberry32(seed);
 // 한 점수로만 뽑힌 재표본(κ 정의 불가)은 뺀다.
 const kappas=Array.from({length:iterations},()=>kappaOf(Array.from({length:n},()=>pairs[Math.floor(next()*n)]))).filter((k):k is number=>k!==null).sort((a,b)=>a-b);
 return kappas.length?quantile(kappas,alpha/2):null;
}

// ── 기준별 통계 ──
// human: 대표 라벨 1~5(null=해당없음, 표본 아님). judge: 파서가 유효로 받은 심사 점수(무효·누락은 null). uncertain: 심사가 판단 불가로 답함(점수가 있어도 κ에서 뺀다).
// invalid: 파서가 준 무효 사유(있으면 judge는 null). length: 심사에 보낸 산출물 글자 수.
// use: measure만 κ에 쓴다. 앵커 맞춤(anchor)·봉인(sealed)·결함 심은(seeded) 출력과 2주 뒤 자기 일치도용 재라벨(relabel)은 분리한다(계획 (4)·(5)).
// 자기 일치도는 같은 출력의 {human:첫 라벨, judge:재라벨} 쌍을 weightedKappa에 넣어 잰다(채택 조건이 아니다).
export type CalibrationUse='measure'|'anchor'|'sealed'|'seeded'|'relabel';
export type CalibrationItem={human:number|null;judge:number|null;uncertain?:boolean;invalid?:readonly JudgeInvalid[];length:number;use?:CalibrationUse};
// uncertainRate: 사람이 점수를 매긴 항목 중 심사가 쓸 수 있는 점수를 내지 못한 비율(uncertain·무효·누락 포함). polar: κ 쌍의 사람 점수 1~2점·4~5점 건수.
// quoteInvalid·quoteInvalidRate: 사람이 점수를 매긴 항목 중 인용 사유(QUOTE_INVALID)로 무효가 된 답의 건수·비율(교차 검토 3-6).
// length.bias: ρ(심사 점수, 글자 수) - ρ(사람 점수, 글자 수). 심사가 사람보다 길이에 더 끌려가는 정도다.
export type JudgeCriterionStats={criterion:JudgeCriterionId;rubricVersion:string;labelled:number;excluded:number;humanNotApplicable:number;pairs:number;uncertain:number;invalid:number;uncertainRate:number|null;quoteInvalid:number;quoteInvalidRate:number|null;
 weightedKappa:number|null;kappaLower:number|null;spearman:number|null;binaryKappa:number|null;polar:{low:number;high:number};length:{judge:number|null;human:number|null;bias:number|null}};
const USES:readonly string[]=['measure','anchor','sealed','seeded','relabel'];
export const QUOTE_INVALID:readonly JudgeInvalid[]=Object.freeze(['quotes_missing','too_many_quotes','quote_too_short','quote_not_found']);
const isRecord=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
function checkedItem(v:unknown,i:number):CalibrationItem{
 const at=`보정 항목 ${i+1}`;
 if(!isRecord(v))throw new JudgeStatsError(`${at}이 객체가 아닙니다.`);
 if(!(v.human===null||isScore(v.human))||!(v.judge===null||isScore(v.judge)))throw new JudgeStatsError(`${at}: 사람·심사 점수는 1~5 정수 또는 null이어야 합니다.`);
 if(typeof v.length!=='number'||!Number.isFinite(v.length)||v.length<0)throw new JudgeStatsError(`${at}: 산출물 글자 수는 0 이상의 수여야 합니다.`);
 if(!(v.uncertain===undefined||typeof v.uncertain==='boolean')||!(v.use===undefined||USES.includes(v.use as string)))throw new JudgeStatsError(`${at}: uncertain은 참·거짓, use는 ${USES.join('·')} 중 하나여야 합니다.`);
 if(!(v.invalid===undefined||Array.isArray(v.invalid)&&v.invalid.every(r=>(JUDGE_INVALID as readonly unknown[]).includes(r))))throw new JudgeStatsError(`${at}: invalid는 파서 무효 사유(${JUDGE_INVALID.join('·')}) 배열이어야 합니다.`);
 if(Array.isArray(v.invalid)&&v.invalid.length&&v.judge!==null)throw new JudgeStatsError(`${at}: 무효로 판정된 답에는 심사 점수가 없어야 합니다(judge null).`);
 return v as CalibrationItem;
}
export function criterionStats(criterion:string,items:readonly CalibrationItem[],opts:BootstrapOptions={}):JudgeCriterionStats{
 const known=JUDGE_CRITERIA.find(c=>c.id===criterion);
 if(!known)throw new JudgeStatsError('루브릭에 없는 기준입니다.');
 if(!Array.isArray(items))throw new JudgeStatsError('보정 항목은 배열이어야 합니다.');
 const all=items.map(checkedItem),measure=all.filter(x=>(x.use??'measure')==='measure'),labelled=measure.filter(x=>x.human!==null);
 const scored=labelled.filter(x=>x.judge!==null&&x.uncertain!==true),pairs=scored.map(x=>({human:x.human as number,judge:x.judge as number})),lengths=scored.map(x=>x.length);
 const uncertain=labelled.filter(x=>x.uncertain===true).length,judgeLength=spearman(pairs.map(p=>p.judge),lengths),humanLength=spearman(pairs.map(p=>p.human),lengths);
 const high=(s:number)=>s>=4?'high':'low',quoteInvalid=labelled.filter(x=>x.invalid?.some(r=>QUOTE_INVALID.includes(r))).length;
 return {criterion:known.id,rubricVersion:RUBRIC_VERSION,labelled:labelled.length,excluded:all.length-measure.length,humanNotApplicable:measure.length-labelled.length,pairs:pairs.length,uncertain,invalid:labelled.length-pairs.length-uncertain,
  uncertainRate:labelled.length?(labelled.length-pairs.length)/labelled.length:null,quoteInvalid,quoteInvalidRate:labelled.length?quoteInvalid/labelled.length:null,weightedKappa:weightedKappa(pairs),kappaLower:bootstrapKappaLower(pairs,opts),
  spearman:spearman(pairs.map(p=>p.human),pairs.map(p=>p.judge)),binaryKappa:cohenKappa(pairs.map(p=>({human:high(p.human),ai:high(p.judge)}))).kappa,
  polar:{low:pairs.filter(p=>p.human<=2).length,high:pairs.filter(p=>p.human>=4).length},length:{judge:judgeLength,human:humanLength,bias:judgeLength===null||humanLength===null?null:judgeLength-humanLength}};
}

// ── 채택 판정 ──
// 모두 충족하면 adopted, 아니면 reference와 미충족 사유 전부. 경계값은 충족이다(κ 0.6, 하한 0.4, uncertain 20%, 양극 각 3건, 사람 라벨 30건). 길이 편향은 0.2 이상이면 편향이다(설계: 사람보다 0.2 이상 높지 않음).
// 표본 n은 사람이 점수를 매긴 측정 항목 수(labelled)다(계획 (4)의 라벨 예산 42·30·30건과 같은 단위). κ·하한·양극은 대응 쌍으로 재고, 쌍 감소는 uncertain 20% 상한이 따로 막는다.
export const ADOPTION=Object.freeze({minN:30,kappa:0.6,kappaLower:0.4,uncertainMax:0.2,polarMin:3,lengthBiasMax:0.2});
export type AdoptionCode='not_target'|'rubric_version'|'small_sample'|'kappa'|'kappa_lower'|'uncertain'|'polar'|'length_bias';
export type Adoption={criterion:string;rubricVersion:string;status:'adopted'|'reference';reasons:{code:AdoptionCode;message:string}[]};
export type AdoptionInput=Pick<JudgeCriterionStats,'rubricVersion'|'labelled'|'pairs'|'weightedKappa'|'kappaLower'|'uncertainRate'|'polar'>&{criterion:string;length:{bias:number|null}};
const fixed=(v:number|null,digits:number)=>v===null?'계산 불가':v.toFixed(digits);
const isCount=(v:unknown)=>Number.isInteger(v)&&(v as number)>=0;
const isStat=(v:unknown)=>v===null||typeof v==='number'&&Number.isFinite(v);
const finite=(v:number|null):v is number=>typeof v==='number'&&Number.isFinite(v);
// 채택은 게이트를 켜는 결정이고 J4·R5는 저장된 통계로 부른다. 필드 누락·NaN·문자열·모순된 건수는 채택도 참고도 아닌 422다(fail closed).
function checkedAdoption(s:unknown):AdoptionInput{
 const fail=(what:string)=>{throw new JudgeStatsError(`채택 판정 입력이 올바르지 않습니다: ${what}. 보정 통계를 criterionStats로 다시 계산해 주세요.`)};
 if(!isRecord(s))return fail('객체가 아닙니다');
 if(typeof s.criterion!=='string'||typeof s.rubricVersion!=='string')fail('criterion·rubricVersion은 문자열이어야 합니다');
 if(!isCount(s.labelled)||!isCount(s.pairs)||(s.pairs as number)>(s.labelled as number))fail('labelled·pairs는 0 이상 정수이고 pairs는 labelled 이하여야 합니다');
 if(!isRecord(s.polar)||!isCount(s.polar.low)||!isCount(s.polar.high)||(s.polar.low as number)+(s.polar.high as number)>(s.pairs as number))fail('polar.low·high는 0 이상 정수이고 합이 pairs 이하여야 합니다');
 if(!isRecord(s.length)||![s.weightedKappa,s.kappaLower,s.uncertainRate,s.length.bias].every(isStat))fail('weightedKappa·kappaLower·uncertainRate·length.bias는 유한한 수 또는 null이어야 합니다');
 return s as AdoptionInput;
}
// 규칙은 '충족의 부정'으로 적는다. 계산할 수 없는 값(null)은 미충족이다.
export function adoptCriterion(stats:AdoptionInput):Adoption{
 const s=checkedAdoption(stats),A=ADOPTION,target=JUDGE_CRITERIA.some(c=>c.id===s.criterion&&c.adoptable),{weightedKappa:k,kappaLower:lower,uncertainRate:u,length:{bias}}=s;
 const rules:[boolean,AdoptionCode,string][]=[
  [!target,'not_target',`채택 대상(${JUDGE_CRITERIA.filter(c=>c.adoptable).map(c=>c.id).join('·')})이 아니라 참고로만 씁니다.`],
  [s.rubricVersion!==RUBRIC_VERSION,'rubric_version',`통계의 루브릭 버전이 현재 버전(${RUBRIC_VERSION})과 달라 다시 보정해야 합니다.`],
  [!(s.labelled>=A.minN),'small_sample',`사람이 점수를 매긴 측정 항목이 ${s.labelled}건으로 최소 ${A.minN}건에 못 미칩니다.`],
  [!(finite(k)&&k>=A.kappa),'kappa',`가중 κ ${fixed(k,3)}가 기준 ${A.kappa} 미만입니다.`],
  [!(finite(lower)&&lower>=A.kappaLower),'kappa_lower',`부트스트랩 κ 하한 ${fixed(lower,3)}이 기준 ${A.kappaLower} 미만입니다.`],
  [!(finite(u)&&u<=A.uncertainMax),'uncertain',`판정 불가·무효 비율 ${u===null?'계산 불가':(u*100).toFixed(1)+'%'}이 ${A.uncertainMax*100}%를 넘습니다.`],
  [!(s.polar.low>=A.polarMin&&s.polar.high>=A.polarMin),'polar',`사람 점수 1~2점 ${s.polar.low}건·4~5점 ${s.polar.high}건으로 양극 각 ${A.polarMin}건 이상이 아닙니다.`],
  [!(finite(bias)&&bias<A.lengthBiasMax),'length_bias',`길이 편향(심사-사람 글자 수 상관 차) ${fixed(bias,3)}이 ${A.lengthBiasMax} 미만이 아닙니다.`],
 ];
 const reasons=rules.filter(([failed])=>failed).map(([,code,message])=>({code,message}));
 return {criterion:s.criterion,rubricVersion:s.rubricVersion,status:reasons.length?'reference':'adopted',reasons};
}
