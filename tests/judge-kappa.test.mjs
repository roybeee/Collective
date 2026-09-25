// J1 심사 보정 통계(lib/judge-kappa.ts): 이차 가중 κ·Spearman ρ를 손계산 예제로, 부트스트랩 κ 하한의 결정성, 기준별 통계(uncertain·양극·길이 편향), 채택 판정 경계값을 고정한다.
// 기대값은 python fractions로 계산한 정확값이다: κ_w=1-Σ(i-j)²·O_ij/Σ(i-j)²·E_ij(범주 1~5 고정), ρ=평균 순위의 Pearson 상관. 합성 데이터만 쓰고 모델·네트워크 호출은 0이다.
import assert from 'node:assert/strict';
import {testRuntime} from './helpers/runtime.mjs';

let fetchCalls=0;
const rt=testRuntime(async()=>{fetchCalls++;throw new Error('외부 호출 금지')});
const jk=await rt.load('lib/judge-kappa.ts'),{RUBRIC_VERSION}=await rt.load('lib/judge-rubric.ts'),{cohenKappa}=await rt.load('lib/quality-kappa.ts');
let passed=0;
const check=(name,ok)=>{assert.ok(ok,name);passed++};
const near=(a,b,eps=1e-12)=>typeof a==='number'&&Math.abs(a-b)<eps;
const P=list=>list.map(([human,judge])=>({human,judge}));
const throws422=fn=>{try{fn();return false}catch(e){return e.name==='JudgeStatsError'&&e.status===422&&/[가-힣]/.test(e.message)}};
const safe=fn=>{try{return fn()}catch{return false}};

// 1) 이차 가중 κ(손계산)
const A=P([[1,1],[1,2],[2,2],[2,3],[3,3],[3,3],[4,4],[4,5],[5,5],[5,4]]);
const B=P([[1,2],[2,1],[3,5],[5,3],[4,4],[2,2]]);
const C=P([[1,5],[2,4],[3,3],[4,2],[5,1]]);
check('weighted kappa A (10 pairs, one-step disagreements) = 8/9',near(jk.weightedKappa(A),8/9));
check('weighted kappa B (6 pairs, symmetric misses) = 7/13',near(jk.weightedKappa(B),7/13));
check('weighted kappa C (perfect reversal) = -1',near(jk.weightedKappa(C),-1));
check('perfect agreement over several scores is 1',jk.weightedKappa(P([[1,1],[3,3],[5,5],[2,2]]))===1);
check('swapping human and judge keeps weighted kappa',near(jk.weightedKappa(A.map(p=>({human:p.judge,judge:p.human}))),8/9));
check('both raters on a single score: undefined (null)',jk.weightedKappa(P([[3,3],[3,3],[3,3]]))===null);
check('no pairs: null',jk.weightedKappa([])===null);
check('quadratic weights: a 2-step miss costs 4x a 1-step miss',(()=>{const one=jk.weightedKappa(P([[1,1],[2,2],[3,3],[4,4],[5,5],[1,2]])),two=jk.weightedKappa(P([[1,1],[2,2],[3,3],[4,4],[5,5],[1,3]]));return one>two})());
check('weightedKappa does not mutate its input',(()=>{const p=Object.freeze(A.map(Object.freeze));jk.weightedKappa(p);return true})());
for(const [name,bad] of [['score 0',[{human:0,judge:3}]],['score 6',[{human:3,judge:6}]],['score 2.5',[{human:2.5,judge:3}]],['string score',[{human:'3',judge:3}]],['non-array','x']])
 check(`weightedKappa rejects ${name}`,throws422(()=>jk.weightedKappa(bad)));

// 2) Spearman ρ(평균 순위)
check('spearman with ties = 3/sqrt(10)',near(jk.spearman([1,2,2,3],[1,3,2,4]),3/Math.sqrt(10)));
check('spearman with a tie on one side = 8/sqrt(95)',near(jk.spearman([1,2,3,4,5],[5,6,7,8,7]),8/Math.sqrt(95)));
check('spearman of a reversed order is -1',near(jk.spearman([1,2,3,4],[40,30,20,10]),-1));
check('spearman with a constant side is null',jk.spearman([3,3,3],[1,2,3])===null&&jk.spearman([1,2,3],[7,7,7])===null);
check('spearman with fewer than two values is null',jk.spearman([1],[1])===null&&jk.spearman([],[])===null);
check('spearman rejects unequal lengths',throws422(()=>jk.spearman([1,2],[1])));
check('spearman rejects non-finite values',throws422(()=>jk.spearman([1,NaN],[1,2]))&&throws422(()=>jk.spearman([1,2],[1,Infinity]))&&throws422(()=>jk.spearman([1,'2'],[1,2])));

// 3) 부트스트랩 κ 하한: 고정 시드로 결정적이다.
const scores=[1,2,3,4,5];
const forty=Array.from({length:40},(_,i)=>{const h=scores[i%5];return {human:h,judge:i%7===0?Math.min(5,h+1):i%11===0?Math.max(1,h-2):h}});
const lower=jk.bootstrapKappaLower(forty);
check('bootstrap lower is a number in [-1,1]',typeof lower==='number'&&lower>=-1&&lower<=1);
check('bootstrap lower is deterministic (same input, same value)',jk.bootstrapKappaLower(forty)===lower);
check('bootstrap lower equals an explicit default seed and iterations',jk.bootstrapKappaLower(forty,{seed:jk.BOOTSTRAP.seed,iterations:jk.BOOTSTRAP.iterations})===lower);
const rt2=testRuntime(async()=>{fetchCalls++;throw new Error('외부 호출 금지')}),jk2=await rt2.load('lib/judge-kappa.ts');
check('bootstrap lower is the same in a fresh module instance (no hidden state)',jk2.bootstrapKappaLower(forty)===lower);
check('a different seed gives a different resample',jk.bootstrapKappaLower(forty,{seed:jk.BOOTSTRAP.seed+1})!==lower);
check('bootstrap lower is not above the point estimate',lower<=jk.weightedKappa(forty));
check('bootstrap defaults: 2000 resamples, two-sided 95% (alpha 0.05)',jk.BOOTSTRAP.iterations===2000&&jk.BOOTSTRAP.alpha===0.05&&Number.isSafeInteger(jk.BOOTSTRAP.seed));
const perfect=Array.from({length:30},(_,i)=>({human:scores[i%5],judge:scores[i%5]}));
check('perfect agreement keeps the lower bound at 1',jk.bootstrapKappaLower(perfect)===1);
check('no pairs: lower is null',jk.bootstrapKappaLower([])===null);
for(const bad of [0,-5,1.5,100001])check(`iterations ${bad} is rejected`,throws422(()=>jk.bootstrapKappaLower(forty,{iterations:bad})));
check('alpha outside (0,1) is rejected',throws422(()=>jk.bootstrapKappaLower(forty,{alpha:1})));
check('bootstrap rejects an out-of-range score',throws422(()=>jk.bootstrapKappaLower([...forty,{human:6,judge:1}])));
check('bootstrap does not mutate its input',(()=>{const p=Object.freeze(forty.map(Object.freeze));jk.bootstrapKappaLower(p,{iterations:50});return true})());

// 4) 기준별 통계: 사람 점수 vs 심사 점수 쌍. 앵커·봉인·결함 심은 항목은 κ에서 뺀다. 사람 '해당없음'(null)은 표본이 아니다.
const len=i=>1000+((i*37)%23)*100;
const measured=forty.map((p,i)=>({...p,uncertain:false,length:len(i)}));
const items=[...measured,
 {human:4,judge:null,uncertain:true,length:1200},{human:2,judge:3,uncertain:true,length:900},
 {human:5,judge:null,length:1500},
 {human:null,judge:3,length:800},
 {human:1,judge:5,length:3000,use:'anchor'},{human:5,judge:1,length:100,use:'sealed'},{human:1,judge:5,length:100,use:'seeded'}];
const st=jk.criterionStats('evidence_linkage',items);
check('stats name the criterion and the rubric version',st.criterion==='evidence_linkage'&&st.rubricVersion===RUBRIC_VERSION);
check('labelled counts human-scored measure items only',st.labelled===43&&st.excluded===3&&st.humanNotApplicable===1);
check('pairs exclude uncertain (even with a score) and invalid judge answers',st.pairs===40&&st.uncertain===2&&st.invalid===1);
check('uncertain rate counts uncertain, invalid and missing judge scores over labelled',near(st.uncertainRate,3/43));
check('weighted kappa is computed on the measure pairs only',near(st.weightedKappa,jk.weightedKappa(forty)));
check('kappa lower is the deterministic bootstrap of the same pairs',st.kappaLower===lower);
check('spearman over the pairs',near(st.spearman,jk.spearman(forty.map(p=>p.human),forty.map(p=>p.judge))));
check('binarized (>=4) kappa reuses cohenKappa from quality-kappa',near(st.binaryKappa,cohenKappa(forty.map(p=>({human:p.human>=4?'high':'low',ai:p.judge>=4?'high':'low'}))).kappa));
check('polar counts are human 1-2 and 4-5 among the pairs',st.polar.low===16&&st.polar.high===16);
const jl=jk.spearman(forty.map(p=>p.judge),measured.map(m=>m.length)),hl=jk.spearman(forty.map(p=>p.human),measured.map(m=>m.length));
check('length bias = rho(judge,length) - rho(human,length)',near(st.length.judge,jl)&&near(st.length.human,hl)&&near(st.length.bias,jl-hl));
check('criterionStats does not mutate its items',(()=>{const f=Object.freeze(items.map(Object.freeze));jk.criterionStats('evidence_linkage',f);return true})());
const empty=jk.criterionStats('actionability',[]);
check('empty stats are zero counts and null statistics',empty.labelled===0&&empty.pairs===0&&empty.uncertainRate===null&&empty.weightedKappa===null&&empty.kappaLower===null&&empty.length.bias===null);
const withRelabel=safe(()=>jk.criterionStats('evidence_linkage',[...items,{human:1,judge:5,length:100,use:'relabel'}]));
check('relabel items (self-agreement) are excluded from pairs',!!withRelabel&&withRelabel.excluded===4&&withRelabel.pairs===40&&near(withRelabel.weightedKappa,st.weightedKappa));
const qi=safe(()=>jk.criterionStats('evidence_linkage',[...measured,{human:4,judge:null,invalid:['quote_not_found'],length:900},{human:3,judge:null,invalid:['quote_too_short','duplicate'],length:900},{human:2,judge:null,invalid:['score_out_of_range'],length:900},{human:null,judge:null,invalid:['quote_not_found'],length:900}]));
check('quote-invalid answers are counted per criterion over labelled items',!!qi&&qi.quoteInvalid===2&&near(qi.quoteInvalidRate,2/43)&&qi.invalid===3);
check('no parser reasons means zero quote-invalid',st.quoteInvalid===0&&st.quoteInvalidRate===0&&empty.quoteInvalid===0&&empty.quoteInvalidRate===null);
for(const [name,bad] of [['human 6',{human:6,judge:3,length:10}],['judge 0',{human:3,judge:0,length:10}],['human 2.5',{human:2.5,judge:3,length:10}],['judge string',{human:3,judge:'3',length:10}],['negative length',{human:3,judge:3,length:-1}],['NaN length',{human:3,judge:3,length:NaN}],['unknown use',{human:3,judge:3,length:10,use:'holdout?'}],['non-object',3],['invalid not an array',{human:3,judge:null,length:10,invalid:'quote_not_found'}],['unknown invalid reason',{human:3,judge:null,length:10,invalid:['made_up']}],['invalid answer with a score',{human:3,judge:3,length:10,invalid:['quote_not_found']}]])
 check(`invalid item is rejected: ${name}`,throws422(()=>jk.criterionStats('evidence_linkage',[bad])));
check('unknown criterion is rejected',throws422(()=>jk.criterionStats('brand_love',[])));
check('non-array items are rejected',throws422(()=>jk.criterionStats('evidence_linkage','x')));

// 5) 채택 판정(설계 (4)): n≥30, κ_w≥0.6, 부트스트랩 하한≥0.4, uncertain≤20%, 양극 각 3건 이상, 길이 편향<0.2. 채택 대상 3기준만 채택될 수 있다.
check('adoption thresholds follow the design',JSON.stringify(jk.ADOPTION)===JSON.stringify({minN:30,kappa:0.6,kappaLower:0.4,uncertainMax:0.2,polarMin:3,lengthBiasMax:0.2})&&Object.isFrozen(jk.ADOPTION));
const edge={criterion:'evidence_linkage',rubricVersion:RUBRIC_VERSION,labelled:30,pairs:30,weightedKappa:0.6,kappaLower:0.4,uncertainRate:0.2,polar:{low:3,high:3},length:{judge:0.3,human:0.11,bias:0.19}};
const ok=jk.adoptCriterion(edge);
check('exactly at every threshold is adopted',ok.status==='adopted'&&ok.reasons.length===0&&ok.criterion==='evidence_linkage'&&ok.rubricVersion===RUBRIC_VERSION);
const codes=s=>jk.adoptCriterion(s).reasons.map(r=>r.code);
const only=(s,code)=>{const r=jk.adoptCriterion(s);return r.status==='reference'&&r.reasons.length===1&&r.reasons[0].code===code&&/[가-힣]/.test(r.reasons[0].message)};
check('29 labelled items is too small',only({...edge,labelled:29,pairs:29},'small_sample'));
check('29 pairs out of 30 labelled items is not small_sample (n is the labelled count)',!codes({...edge,pairs:29}).includes('small_sample'));
const v0=safe(()=>jk.adoptCriterion({...edge,rubricVersion:'judge-rubric-v0'}));
check('stats from another rubric version are not adopted and keep their version',!!v0&&v0.status==='reference'&&v0.reasons.map(r=>r.code).join()==='rubric_version'&&v0.rubricVersion==='judge-rubric-v0'&&/[가-힣]/.test(v0.reasons[0].message));
check('kappa 0.5999 is below 0.6',only({...edge,weightedKappa:0.5999},'kappa'));
check('kappa null (not computable) is unmet',only({...edge,weightedKappa:null},'kappa'));
check('bootstrap lower 0.3999 is below 0.4',only({...edge,kappaLower:0.3999},'kappa_lower'));
check('bootstrap lower null is unmet',only({...edge,kappaLower:null},'kappa_lower'));
check('uncertain 20.01% is over 20%',only({...edge,uncertainRate:0.2001},'uncertain'));
check('uncertain rate null (no labels) is unmet',codes({...edge,uncertainRate:null}).includes('uncertain'));
check('two low human scores are not enough',only({...edge,polar:{low:2,high:9}},'polar'));
check('two high human scores are not enough',only({...edge,polar:{low:9,high:2}},'polar'));
check('length bias exactly 0.2 is biased',only({...edge,length:{...edge.length,bias:0.2}},'length_bias'));
check('length bias that cannot be computed is unmet',only({...edge,length:{judge:null,human:0.1,bias:null}},'length_bias'));
check('negative length bias (judge less length-driven than human) is fine',jk.adoptCriterion({...edge,length:{...edge.length,bias:-0.5}}).status==='adopted');
check('reference-only criterion is never adopted even with perfect stats',only({...edge,criterion:'persuasion',weightedKappa:1,kappaLower:1},'not_target'));
check('all unmet conditions are listed together, in order',codes({...edge,rubricVersion:'judge-rubric-v0',labelled:10,pairs:10,weightedKappa:0.2,kappaLower:-0.1,uncertainRate:0.5,polar:{low:0,high:1},length:{judge:0.9,human:0,bias:0.9}}).join()==='rubric_version,small_sample,kappa,kappa_lower,uncertain,polar,length_bias');
// 입력 검사: 채택은 게이트를 켜는 결정이라 필드 누락·NaN·문자열·모순된 건수는 채택도 참고도 아니고 422다(fail closed).
const noPairs=Object.fromEntries(Object.entries(edge).filter(([k])=>k!=='pairs'));
const allNaN={...edge,labelled:NaN,pairs:NaN,weightedKappa:NaN,kappaLower:NaN,uncertainRate:NaN,polar:{low:NaN,high:NaN},length:{bias:NaN}};
for(const [name,bad] of [['pairs missing',noPairs],['polar empty',{...edge,polar:{}}],['all values NaN',allNaN],['NaN kappa',{...edge,weightedKappa:NaN}],['string kappa',{...edge,weightedKappa:'0.9'}],['string pairs',{...edge,pairs:'30'}],['fractional pairs',{...edge,pairs:30.5}],['labelled missing',{...edge,labelled:undefined}],['rubricVersion missing',{...edge,rubricVersion:undefined}],['criterion not a string',{...edge,criterion:7}],['uncertainRate missing',{...edge,uncertainRate:undefined}],['length missing',{...edge,length:undefined}],['length bias missing',{...edge,length:{}}],['pairs above labelled',{...edge,pairs:31}],['polar above pairs',{...edge,polar:{low:20,high:20}}],['non-object','x']])
 check(`adoptCriterion rejects ${name} with 422 (never adopted)`,throws422(()=>jk.adoptCriterion(bad)));
check('adoptCriterion does not mutate the stats',(()=>{const s=Object.freeze({...edge,polar:Object.freeze({...edge.polar}),length:Object.freeze({...edge.length})});jk.adoptCriterion(s);return true})());

// 6) 통합: 강한 합성 표본은 채택, 길이에 끌려가는 심사는 참고로 남는다.
check('strong synthetic sample (criterionStats → adoptCriterion) is adopted',jk.adoptCriterion(st).status==='adopted');
const thirty=Array.from({length:30},(_,i)=>({human:scores[i%5],judge:scores[i%5],length:1000+i*10}));
const oneUnsure=jk.criterionStats('actionability',thirty.map((x,i)=>i===7?{...x,judge:null,uncertain:true}:x));
check('30 labels with one uncertain answer (29 pairs) can still be adopted',oneUnsure.labelled===30&&oneUnsure.pairs===29&&safe(()=>jk.adoptCriterion(oneUnsure).status)==='adopted');
const biased=Array.from({length:40},(_,i)=>{const h=scores[i%5],long=i%2===0;return {human:h,judge:long?Math.min(5,h+1):Math.max(1,h-1),length:long?4000+i:800+i}});
const bs=jk.criterionStats('actionability',biased);
check('length-driven judge has bias over 0.2 and is kept as reference',bs.length.bias>0.2&&jk.adoptCriterion(bs).reasons.some(r=>r.code==='length_bias')&&jk.adoptCriterion(bs).status==='reference');

check('no network call was made',fetchCalls===0);
console.log(JSON.stringify({passed}));
