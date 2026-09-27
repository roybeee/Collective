// 트랙 R R6d-2 모집 소재 실험 선별 순수 모듈(lib/franchise-experiment.ts) 회귀. 사례 번호 EX-*는 R6d-2 PR 본문 수용 기준과 같다.
// 확인: import 경계와 viral-stats 무수정 사용(EX-S), 계획 검사(EX-P), 결과·판정·통계(EX-R), 확인 층(EX-L), 문구·값 누출(EX-N).
// 근거: mocked(순수 함수, 합성 입력, 외부 호출 0회). 법률 적합성은 not_run(LR-1 대상, 결정 20 보류).
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {testRuntime} from './helpers/runtime.mjs';

let fetchCalls=0;
const rt=testRuntime(async()=>{fetchCalls++;throw new Error('외부 호출 금지')});
const ex=await rt.load('lib/franchise-experiment.ts'),vs=await rt.load('lib/viral-stats.ts');
const passed=[];const check=(name,val)=>{assert.ok(val,name);passed.push(name)};
const plain=x=>JSON.parse(JSON.stringify(x));
const same=(a,b)=>JSON.stringify(plain(a))===JSON.stringify(b);
const DISCLAIMER='COLLECTIVE 휴리스틱 · 법률 자문 아님';

// ════ EX-S 구문 경계 ════
const SRC=readFileSync('lib/franchise-experiment.ts','utf8');
const imports=[...SRC.matchAll(/from '\.\/([^']+)'/g)].map(m=>m[1]).sort();
check('EX-S1 imports only pure modules and viral-stats',same(imports,['franchise-gates','franchise-recruitment','franchise-rules','pii-scan','viral-stats']));
check('EX-S2 no clock, storage, network or model call',!/Date\.now|new Date\(\)|database\(|listRecords|fetch\(|isEnabled/.test(SRC));
check('EX-S3 viral-stats is used as is (summarizeResult)',SRC.includes('summarizeResult(')&&!SRC.includes('function summarizeResult'));
check('EX-S4 per-arm minimum sample equals the learning experiment minimum (100)',ex.EXPERIMENT_MIN_SAMPLE===100&&/minSample<100/.test(readFileSync('lib/learning-server.ts','utf8')));

// ════ EX-P 계획 ════
const TODAY='2026-10-01';
const asset=(id,version,x={})=>({id,version,brandId:'b1',type:'portal_intro',status:'approved',review:{needed:false},...x});
const assets=[asset('ra-1',1),asset('ra-1',2),asset('ra-2',1,{type:'naver_search'}),asset('ra-3',1,{status:'draft'}),asset('ra-4',1,{review:{needed:true}}),asset('ra-9',1,{brandId:'b2'})];
const ctx={brandId:'b1',today:TODAY,assets};
const base={channel:'portal',metric:'ctr',variable:'헤드라인 첫 문장',hypothesis:'질문형 헤드라인이 클릭률을 높인다',control:{assetId:'ra-1',version:1},treatment:{assetId:'ra-1',version:2},minSample:100,minHours:72,minLift:10,period:{from:'2026-10-05',to:'2026-10-18'}};
const plan=(x={})=>plain(ex.planDecision({...base,...x},ctx));
const codes=d=>d.ok?[]:d.reasons;
check('EX-P1 a valid plan passes with the rule version and disclaimer',(()=>{const d=plan();return d.ok&&d.status===200&&d.value.minSample===100&&d.ruleVersion===ex.EXPERIMENT_VERSION&&d.disclaimer===DISCLAIMER})());
check('EX-P2 unknown keys are refused',same(codes(plain(ex.planDecision({...base,extra:1},ctx))),['invalid_input'])&&same(codes(plain(ex.planDecision(null,ctx))),['invalid_input']));
check('EX-P3 channel and metric must be known',same(codes(plan({channel:'instagram'})),['channel_unknown'])&&same(codes(plan({metric:'revenue'})),['metric_unknown']));
check('EX-P4 texts: empty, too long or control characters',same(codes(plan({variable:''})),['text_invalid'])&&same(codes(plan({hypothesis:'x'.repeat(1001)})),['text_invalid'])&&same(codes(plan({variable:'a\u0007b'})),['text_invalid']));
check('EX-P5 texts with personal data are refused',same(codes(plan({hypothesis:'010-0000-0999로 전화한 분 반응'})),['text_pii']));
check('EX-P6 arms must be distinct versions',same(codes(plan({treatment:{assetId:'ra-1',version:1}})),['arms_same'])&&same(codes(plan({control:{assetId:'ra-1'}})),['arm_invalid']));
check('EX-P7 arms from another brand or missing are refused',same(codes(plan({treatment:{assetId:'ra-9',version:1}})),['asset_other_brand'])&&same(codes(plan({treatment:{assetId:'ra-x',version:1}})),['asset_other_brand']));
check('EX-P8 arms must share the asset type (one variable)',same(codes(plan({treatment:{assetId:'ra-2',version:1}})),['asset_type_mismatch']));
check('EX-P9 minimum sample below 100 is refused',same(codes(plan({minSample:99})),['plan_invalid'])&&same(codes(plan({minSample:100.5})),['plan_invalid']));
check('EX-P9 hours and lift ranges',same(codes(plan({minHours:0})),['plan_invalid'])&&same(codes(plan({minHours:2161})),['plan_invalid'])&&same(codes(plan({minLift:0})),['plan_invalid'])&&same(codes(plan({minLift:1001})),['plan_invalid'])&&plan({minLift:1000}).ok);
check('EX-P10 period must be ordered dates up to 92 days',same(codes(plan({period:{from:'2026-10-18',to:'2026-10-05'}})),['period_invalid'])&&same(codes(plan({period:{from:'2026-10-05',to:'2027-01-05'}})),['period_invalid'])&&plan({period:{from:'2026-10-05',to:'2027-01-04'}}).ok);
check('EX-P11 the plan must be written before the period starts (409)',(()=>{const d=plan({period:{from:'2026-09-30',to:'2026-10-10'}});return d.status===409&&same(d.reasons,['period_started'])})()&&plan({period:{from:TODAY,to:'2026-10-10'}}).ok);
{const a2=[...assets,asset('ra-3',2,{status:'draft'}),asset('ra-4',2,{review:{needed:true}})];
 const d1=plain(ex.planDecision({...base,control:{assetId:'ra-3',version:1},treatment:{assetId:'ra-3',version:2}},{...ctx,assets:a2}));
 const d2=plain(ex.planDecision({...base,control:{assetId:'ra-4',version:1},treatment:{assetId:'ra-4',version:2}},{...ctx,assets:a2}));
 check('EX-P12 draft versions are refused',d1.status===409&&same(d1.reasons,['asset_not_approved']));
 check('EX-P12 versions under review are refused',d2.status===409&&same(d2.reasons,['asset_review_needed']));}
check('EX-P13 input errors come before state errors',same(codes(plan({metric:'x',period:{from:'2026-09-01',to:'2026-09-02'}})),['metric_unknown']));
check('EX-P14 messages never echo the input',!JSON.stringify(plan({hypothesis:'010-0000-0998 가상입력토큰'})).includes('가상입력토큰'));

// ════ EX-R 결과·판정 ════
const P=plan().value,exp=(x={})=>({status:'planned',plan:P,looks:[],...x});
const NOW=Date.parse('2026-10-20T03:00:00Z'),rctx={today:'2026-10-20',nowMs:NOW,recordedAt:'2026-10-20T03:00:00.000Z'};
const res=(x={})=>({control:{denominator:5000,numerator:100},treatment:{denominator:5000,numerator:150},comparable:true,observedUntil:'2026-10-18',...x});
const r1=plain(ex.resultDecision(exp(),res(),rctx));
check('EX-R1 a complete result is judged promising (50% lift ≥ 10%)',r1.ok&&r1.value.assessment.status==='promising'&&Math.abs(r1.value.assessment.lift-50)<1e-9);
check('EX-R2 stats come from viral-stats unchanged',same(r1.value.stats,plain(vs.summarizeResult({minSample:100,minHours:72,startedAt:'2026-10-05T00:00:00+09:00'},{control:{denominator:5000,numerator:100},treatment:{denominator:5000,numerator:150},observedUntil:'2026-10-19T00:00:00+09:00',comparable:true},0,NOW,'promising'))));
check('EX-R3 stats recommend adoption with no interim warning',r1.value.stats.recommendation==='adopt'&&r1.value.stats.warning===null&&r1.value.stats.probBetter>0.95);
const small=plain(ex.resultDecision(exp(),res({control:{denominator:99,numerator:5},treatment:{denominator:5000,numerator:150}}),rctx));
check('EX-R4 below the per-arm minimum is insufficient with a sample warning',small.ok&&small.value.assessment.status==='insufficient'&&small.value.stats.warning.codes.includes('sample_below_plan')&&small.value.stats.recommendation!=='adopt');
const early=plain(ex.resultDecision(exp(),res({observedUntil:'2026-10-06'}),rctx));
check('EX-R5 before the minimum hours it is insufficient (2 days < 72h)',early.value.assessment.status==='insufficient'&&early.value.stats.warning.codes.includes('duration_below_plan'));
const nc=plain(ex.resultDecision(exp(),res({comparable:false}),rctx));
check('EX-R6 not comparable is insufficient with a warning',nc.value.assessment.status==='insufficient'&&nc.value.stats.warning.codes.includes('not_comparable'));
const worse=plain(ex.resultDecision(exp(),res({treatment:{denominator:5000,numerator:60}}),rctx));
check('EX-R7 a drop beyond the target is not supported',worse.value.assessment.status==='not_supported');
const flat=plain(ex.resultDecision(exp(),res({treatment:{denominator:5000,numerator:104}}),rctx));
check('EX-R8 a small difference is inconclusive',flat.value.assessment.status==='inconclusive');
const again=plain(ex.resultDecision(exp({looks:[r1.value]}),res(),rctx));
check('EX-R9 a second look after a complete result warns about repeated looks',again.value.stats.looks===1&&again.value.stats.warning.codes.includes('repeated_looks')&&again.value.stats.recommendation!=='adopt');
const rcodes=(x,e=exp(),c=rctx)=>{const d=plain(ex.resultDecision(e,x,c));return d.ok?[]:d.reasons};
check('EX-R10 counts: numerator above denominator, negative or fractional are refused',same(rcodes(res({control:{denominator:10,numerator:11}})),['arm_counts_invalid'])&&same(rcodes(res({control:{denominator:-1,numerator:0}})),['arm_counts_invalid'])&&same(rcodes(res({treatment:{denominator:10.5,numerator:1}})),['arm_counts_invalid']));
check('EX-R11 comparable must be stated',same(rcodes(res({comparable:undefined})),['comparable_required'])&&same(rcodes({...res(),comparable:'yes'}),['comparable_required']));
check('EX-R12 observed date inside the period and not in the future',same(rcodes(res({observedUntil:'2026-10-04'})),['observed_invalid'])&&same(rcodes(res({observedUntil:'2026-10-19'})),['observed_invalid'])&&same(rcodes(res({observedUntil:'2026-10-15'}),exp(),{...rctx,today:'2026-10-14'}),['observed_invalid']));
check('EX-R13 no result before the period starts, none after cancel (409)',(()=>{const a=plain(ex.resultDecision(exp(),res({observedUntil:'2026-10-05'}),{...rctx,today:'2026-10-04'}));const b=plain(ex.resultDecision(exp({status:'cancelled'}),res(),rctx));return a.status===400&&b.status===409&&same(b.reasons,['experiment_closed'])})());
check('EX-R14 unknown result keys are refused',same(rcodes({...res(),leads:3}),['invalid_input']));
check('EX-R15 zero-control reactions cannot be judged',plain(ex.resultDecision(exp(),res({control:{denominator:5000,numerator:0}}),rctx)).value.assessment.status==='insufficient');
check('EX-R16 cancel is allowed once',plain(ex.cancelDecision(exp())).ok&&plain(ex.cancelDecision(exp({status:'cancelled'}))).status===409&&plain(ex.cancelDecision(exp({status:'evaluated'}))).ok);

// ════ EX-L 확인 층(원장) ════
const lead=(assetId,version,d)=>({assetRef:assetId?{assetId,version}:null,receivedDate:d});
const leads=[...Array.from({length:20},()=>lead('ra-1',2,'2026-10-10')),lead('ra-1',1,'2026-10-06'),lead('ra-1',1,'2026-10-30'),lead(null,0,'2026-10-10'),lead('ra-1',2,'2026-10-04')];
const events=[{assetRefs:[{id:'ra-1',version:2}],startsDate:'2026-10-12',attended:7,cancelled:false},{assetRefs:[{id:'ra-1',version:2}],startsDate:'2026-10-13',attended:5,cancelled:true},{assetRefs:[{id:'ra-1',version:1}],startsDate:'2026-10-12',attended:2,cancelled:false}];
const L=plain(ex.ledgerConfirm(P,leads,events));
check('EX-L1 ledger counts per arm inside the period only',L.control.leads===1&&L.treatment.leads===20);
check('EX-L2 attendance counts per arm, cancelled events excluded',L.treatment.attended===7&&L.control.attended===2);
check('EX-L3 the rate is hidden below 20 ledger leads and shown at 20',L.control.attendedPerLead===null&&Math.abs(L.treatment.attendedPerLead-0.35)<1e-9&&L.minForRate===20);
check('EX-L4 qualified leads stay empty with a note (no qualification record yet)',L.control.qualified===null&&L.treatment.qualified===null&&L.qualifiedNote.includes('적격 판정 기록'));

// ════ EX-N 문구 ════
check('EX-N1 the platform-reported note leads the notes',ex.EXPERIMENT_NOTES[0].includes('플랫폼 보고, 원장 리드 아님'));
check('EX-N2 every code has a status and a fixed message',ex.EXPERIMENT_CODES.every(c=>[400,409].includes(ex.EXPERIMENT_CODE_STATUS[c])&&typeof ex.EXPERIMENT_MESSAGES[c]==='string'&&ex.EXPERIMENT_MESSAGES[c].length>0));
check('EX-N3 no network call',fetchCalls===0);

console.log(JSON.stringify({passed:passed.length}));
