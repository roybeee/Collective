// 바이럴 실험 판정 통계(lib/viral-stats.ts)의 수치·경고·권고 규칙을 고정한다.
// 확률 기준값은 이 파일의 닫힌 식(정수 모수 Beta 적분의 유한합)으로 따로 계산한다. lift 구간 기준값은 정수 모수 Beta CDF의 이항 유한합과 40만 칸 Simpson 적분으로
// 두 방향(대조안 적분·실험안 적분)을 따로 계산해 일치를 확인한 값이다. 비교는 상대 오차 1e-3이고, 0에 가까운 기준값만 절대 오차로 본다.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {SourceTextModule,createContext} from 'node:vm';
import ts from 'typescript';
const context=createContext({console}),cache=new Map();
function moduleFor(path){path=resolve(path);if(cache.has(path))return cache.get(path);const m=new SourceTextModule(ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText,{context,identifier:path});cache.set(path,m);return m;}
const m=moduleFor('lib/viral-stats.ts');await m.link((s,r)=>moduleFor(resolve(dirname(r.identifier),s+'.ts')));await m.evaluate();
const {betaPosterior,probTreatmentBetter,liftInterval,interimWarning,recommend,decisionConflict,armCounts,summarizeResult,recommendationLabels}=m.namespace;
let passed=0;
function check(name,condition){assert.ok(condition,name);passed++}
function rejects(name,run){let error;try{run()}catch(e){error=e}assert.ok(error&&error.status===422&&/[가-힣]/.test(error.message),name+' → '+(error?`${error.status} ${error.message}`:'통과함'));passed++}
const near=(a,b,tol)=>Math.abs(a-b)<=tol,rel=(x,ref)=>Math.abs(x/ref-1)<1e-3;
// 정확한 기준값: P(p_t>p_c) = Σ_{i<α_t} B(α_c+i, β_c+β_t) / ((β_t+i)·B(1+i,β_t)·B(α_c,β_c)). Beta(1,1) 사전분포와 정수 횟수에서만 쓴다.
const logFact=(()=>{const t=[0];return n=>{for(let k=t.length;k<=n;k++)t[k]=t[k-1]+Math.log(k);return t[n]}})();
const lbeta=(a,b)=>logFact(a-1)+logFact(b-1)-logFact(a+b-1);
function exact(c,t){const ac=1+c.successes,bc=1+c.trials-c.successes,at=1+t.successes,bt=1+t.trials-t.successes;let s=0;for(let i=0;i<at;i++)s+=Math.exp(lbeta(ac+i,bc+bt)-Math.log(bt+i)-lbeta(1+i,bt)-lbeta(ac,bc));return s}
const k=(successes,trials)=>({successes,trials});

// --- 사후분포 ------------------------------------------------------------------
const post=betaPosterior(10,100);
check('Beta(1,1) prior adds successes and failures',post.a===11&&post.b===91&&near(post.mean,11/102,1e-12));
const custom=betaPosterior(10,100,{a:2,b:3});
check('custom prior is respected',custom.a===12&&custom.b===93);

// --- P(B>A) --------------------------------------------------------------------
const p=probTreatmentBetter(k(10,100),k(20,100));
check('10/100 vs 20/100 is about 0.97',near(p,0.97,0.01));
check('10/100 vs 20/100 matches the closed form to 4 decimals',near(p,exact(k(10,100),k(20,100)),1e-4));
check('result is rounded to 4 decimals',Math.round(p*1e4)/1e4===p);
check('same input gives the same output',probTreatmentBetter(k(10,100),k(20,100))===p);
check('identical data gives exactly 0.5',probTreatmentBetter(k(10,100),k(10,100))===0.5&&probTreatmentBetter(k(0,0),k(0,0))===0.5&&probTreatmentBetter(k(1234,50000),k(1234,50000))===0.5);
for(const [c,t] of [[k(10,100),k(20,100)],[k(20,2000),k(40,2000)],[k(3,50),k(0,80)],[k(1000,10000),k(12,100)]])check(`swapping arms mirrors the probability (${c.successes}/${c.trials} vs ${t.successes}/${t.trials})`,near(probTreatmentBetter(c,t)+probTreatmentBetter(t,c),1,1e-4));
for(const [c,t] of [[k(20,2000),k(40,2000)],[k(20,2000),k(10,2000)],[k(100,1000),k(130,1000)],[k(0,100),k(3,100)],[k(1000,10000),k(12,100)],[k(10000,100000),k(11,100)],[k(12,100),k(10000,100000)]])check(`closed form agreement (${c.successes}/${c.trials} vs ${t.successes}/${t.trials})`,near(probTreatmentBetter(c,t),exact(c,t),1e-4));
const started=Date.now();const big=probTreatmentBetter(k(50000,1000000),k(51000,1000000));
check('million-sample arms stay accurate',near(big,exact(k(50000,1000000),k(51000,1000000)),1e-4));
check('million-sample arms finish quickly',Date.now()-started<3000);

// --- 상대 lift 신용구간 ---------------------------------------------------------
const lift=liftInterval(k(10,100),k(20,100));
check('default level is 90%',lift.level===0.9);
check('90% lift interval matches the numerical reference',rel(lift.low,11.0621)&&rel(lift.high,253.3784));
check('lift interval is deterministic',JSON.stringify(liftInterval(k(10,100),k(20,100)))===JSON.stringify(lift));
const mirrored=liftInterval(k(20,100),k(10,100));
check('swapping arms inverts the ratio interval',rel(mirrored.low,-71.7017)&&rel(mirrored.high,-9.9603));
const wide=liftInterval(k(10,100),k(20,100),0.95);
check('a higher level widens the interval',wide.low<lift.low&&wide.high>lift.high&&near(wide.low,0.0979,0.01)&&rel(wide.high,299.9603));
const heavy=liftInterval(k(0,100),k(3,100));
check('heavy-tailed interval stays within 0.1% of the numerical reference',rel(heavy.low,-8.8264)&&rel(heavy.high,7577.2056));
const flat=liftInterval(k(100,1000),k(100,1000));
check('identical data straddles zero',flat.low<0&&flat.high>0);
check('lift bounds are rounded percentages',Math.round(lift.low*100)/100===lift.low&&Math.round(lift.high*100)/100===lift.high);
const beyond=liftInterval(k(0,1e9),k(1e9,1e9));
check('both bounds are null when the ratio exceeds 10^6',beyond.low===null&&beyond.high===null);

// --- 입력 검증 ------------------------------------------------------------------
rejects('negative successes rejected',()=>betaPosterior(-1,10));
rejects('negative trials rejected',()=>probTreatmentBetter(k(0,-1),k(1,10)));
rejects('successes above trials rejected',()=>probTreatmentBetter(k(11,10),k(1,10)));
rejects('fractional counts rejected',()=>liftInterval(k(1.5,10),k(1,10)));
rejects('non-numeric counts rejected',()=>probTreatmentBetter({successes:'1',trials:10},k(1,10)));
rejects('missing arm rejected',()=>probTreatmentBetter(null,k(1,10)));
rejects('denominator above one billion rejected',()=>probTreatmentBetter(k(1,1e9+1),k(1,10)));
rejects('non-positive prior rejected',()=>betaPosterior(1,10,{a:0,b:1}));
rejects('level outside (0,1) rejected',()=>liftInterval(k(1,10),k(2,10),1));
rejects('negative look count rejected',()=>interimWarning({minSample:100,minHours:1,startedAt:new Date(0).toISOString()},-1,Date.now()));
rejects('fractional look count rejected',()=>interimWarning({minSample:100,minHours:1,startedAt:new Date(0).toISOString()},0.5,Date.now()));

// --- 중간 확인 경고 -------------------------------------------------------------
const t0=Date.parse('2026-09-01T00:00:00Z'),hour=3600000;
const plan={minSample:1000,minHours:72,startedAt:new Date(t0).toISOString()};
const at=(h,c=1000,t=1000)=>({control:{denominator:c,numerator:10},treatment:{denominator:t,numerator:20},observedUntil:new Date(t0+h*hour).toISOString()});
check('no warning when the plan is met and not re-checked',interimWarning({...plan,result:at(72)},0,t0+100*hour)===null);
const shortSample=interimWarning({...plan,result:at(80,999,1000)},0,t0+100*hour);
check('sample below plan warns with a reason code',shortSample?.codes.join()==='sample_below_plan'&&shortSample.message.includes('최소 표본'));
const missingSample=interimWarning({...plan,result:at(80,1000,null)},0,t0+100*hour);
check('unknown denominator counts as below plan',missingSample?.codes.includes('sample_below_plan'));
const shortTime=interimWarning({...plan,result:at(71)},0,t0+100*hour);
check('observation window below plan warns',shortTime?.codes.join()==='duration_below_plan'&&shortTime.message.includes('72시간'));
check('the window ends at the measured time, not the viewing time',interimWarning({...plan,result:at(10)},0,t0+500*hour)?.codes.includes('duration_below_plan'));
check('unstarted experiment warns on duration',interimWarning({...plan,startedAt:null,result:at(80)},0,t0+100*hour)?.codes.includes('duration_below_plan'));
const peek=interimWarning({...plan,result:at(90)},2,t0+100*hour);
check('re-checking after the plan was met warns as peeking',peek?.codes.join()==='repeated_looks'&&peek.message.includes('2회'));
const all=interimWarning({...plan,result:at(10,5,5)},1,t0+100*hour);
const unconfirmed=interimWarning({...plan,result:{...at(80),comparable:false}},0,t0+100*hour);
check('unconfirmed comparability warns with its own code',unconfirmed?.codes.join()==='not_comparable'&&unconfirmed.message.includes('비교 가능성'));
check('confirmed comparability adds no warning',interimWarning({...plan,result:{...at(80),comparable:true}},0,t0+100*hour)===null);
check('all reasons are reported together',['sample_below_plan','duration_below_plan','repeated_looks'].every(c=>all.codes.includes(c))&&all.message.startsWith('중간 확인 경고'));

// --- 권고 규칙 ------------------------------------------------------------------
const warn={codes:['repeated_looks'],message:'x'};
check('0.95 without warning recommends adopt',recommend(0.95,null,'promising')==='adopt');
check('0.95 with a warning is only inconclusive',recommend(0.95,warn,'promising')==='inconclusive');
check('just below 0.95 is inconclusive',recommend(0.9499,null,'promising')==='inconclusive');
check('adopt needs the existing judgement to be an observed improvement',['insufficient','inconclusive','not_supported',null,undefined].every(j=>recommend(0.999,null,j)==='inconclusive'));
check('stop does not depend on the existing judgement',recommend(0.01,null,'insufficient')==='stop'&&recommend(0.01,null,'inconclusive')==='stop');
check('0.05 recommends stop even with a warning',recommend(0.05,null)==='stop'&&recommend(0.05,warn)==='stop');
check('just above 0.05 is inconclusive',recommend(0.0501,null)==='inconclusive');
check('recommendation labels are Korean',Object.values(recommendationLabels).every(x=>/권고$/.test(x)&&/[가-힣]/.test(x)));

// --- 사람 확정과 권고의 어긋남 -----------------------------------------------------
const stats=(recommendation,warning=null)=>({recommendation,warning});
check('matching adopt is no conflict',decisionConflict(stats('adopt'),'adopt')===null);
check('adopt against an inconclusive recommendation is a mismatch',decisionConflict(stats('inconclusive'),'adopt')==='mismatch');
check('adopt against a stop recommendation is a mismatch',decisionConflict(stats('stop'),'adopt')==='mismatch');
check('adopt with an interim warning is an interim conflict',decisionConflict(stats('inconclusive',warn),'adopt')==='interim');
check('matching stop is no conflict even with a warning',decisionConflict(stats('stop',warn),'stop')===null);
check('stop against an inconclusive recommendation is a mismatch',decisionConflict(stats('inconclusive'),'stop')==='mismatch');
check('without statistics there is no conflict',decisionConflict(null,'adopt')===null&&decisionConflict(undefined,'stop')===null);

// --- 결과 요약 ------------------------------------------------------------------
check('arm counts need both numbers',armCounts({denominator:null,numerator:3})===null&&armCounts({denominator:10,numerator:null})===null);
check('event counts above the denominator are not a rate',armCounts({denominator:100,numerator:130})===null);
check('denominator above one billion is not computed',armCounts({denominator:1e9+1,numerator:5})===null);
check('zero denominator is not a rate',armCounts({denominator:0,numerator:0})===null);
check('valid arm becomes counts',JSON.stringify(armCounts({denominator:100,numerator:7}))==='{"successes":7,"trials":100}');
const result={control:{denominator:100,numerator:10,source:'A'},treatment:{denominator:100,numerator:20,source:'B'},observedUntil:new Date(t0+80*hour).toISOString()};
const summary=summarizeResult({minSample:100,minHours:72,startedAt:plan.startedAt},result,0,t0+100*hour,'promising');
check('summary carries the posterior fields',summary.probBetter===p&&summary.liftLow===lift.low&&summary.liftHigh===lift.high&&summary.level===0.9&&summary.controlRate===0.1&&summary.treatmentRate===0.2&&summary.n.control===100&&summary.n.treatment===100&&summary.prior.a===1&&summary.prior.b===1);
check('summary recommends adopt only at 0.95 or more',summary.recommendation===(p>=0.95?'adopt':'inconclusive')&&summary.warning===null);
check('summary keeps the peeking warning',summarizeResult({minSample:100,minHours:72,startedAt:plan.startedAt},result,1,t0+100*hour,'promising').warning.codes.includes('repeated_looks'));
check('no rate metric means no statistics',summarizeResult({minSample:100,minHours:72,startedAt:plan.startedAt},{...result,treatment:{denominator:100,numerator:130,source:'B'}},0,t0+100*hour,'promising')===null);
const planned={minSample:1000,minHours:72,startedAt:plan.startedAt},full=(c,t,comparable=true)=>({control:{denominator:c[1],numerator:c[0]},treatment:{denominator:t[1],numerator:t[0]},comparable,observedUntil:new Date(t0+80*hour).toISOString()});
const notComparable=summarizeResult(planned,full([20,2000],[40,2000],false),0,t0+100*hour,'promising');
check('comparable:false is not recommended for adoption',notComparable.probBetter>0.95&&notComparable.recommendation!=='adopt'&&notComparable.warning?.codes.join()==='not_comparable');
const belowTarget=summarizeResult(planned,full([50000,1e6],[51000,1e6]),0,t0+100*hour,'inconclusive');
check('a large-sample lift below the target is not recommended for adoption',belowTarget.probBetter>0.99&&belowTarget.warning===null&&belowTarget.recommendation==='inconclusive');
const zeroControl=summarizeResult(planned,full([0,1000],[30,1000]),0,t0+100*hour,'insufficient');
check('a zero control response is not recommended for adoption',zeroControl.probBetter===1&&zeroControl.recommendation==='inconclusive');

console.log(JSON.stringify({passed},null,2));
