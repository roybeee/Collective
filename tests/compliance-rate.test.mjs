// 규정 점검 준수율(QA 2026-11-09 D12 잔여): 통과 규칙 수 / 점검 규칙 수. 순수 함수(lib/graders/compliance-rate.ts)와 작업물 규정 보기(complianceViewOf)와의 일관성.
// 근거: mocked(메모리 SQLite 런타임, fetch 스텁). 모델·외부 네트워크 호출은 0회다. 합성 문장이며 법률 자문이 아니다.
import assert from 'node:assert/strict';
import {testRuntime} from './helpers/runtime.mjs';

const rt=testRuntime(async()=>{throw new Error('외부 호출 금지')});
const {complianceRate}=await rt.load('lib/graders/compliance-rate.ts');
const {complianceViewOf}=await rt.load('lib/artifact-sources-server.ts');
const {COMPLIANCE_LEXICON}=await rt.load('lib/graders/compliance.ts');
let passed=0;const check=(name,ok)=>{assert.ok(ok,name);passed++};
const eq=(name,a,b)=>{assert.deepEqual(JSON.parse(JSON.stringify(a)),b,name);passed++};

// 1) 순수 계산: 통과는 분류별 pass의 합, 점검은 통과 + 걸린 규칙 수(같은 규칙이 여러 번 걸려도 1개).
eq('no rules checked → null',complianceRate({categories:[],issues:[]}),null);
eq('all pass → 100%',complianceRate({categories:[{category:'a',pass:3},{category:'b',pass:2}],issues:[]}),{passed:5,checked:5,percent:100});
eq('same rule hit twice counts once',complianceRate({categories:[{category:'a',pass:3},{category:'b',pass:1}],issues:[{category:'b',ruleId:'r1'},{category:'b',ruleId:'r1'}]}),{passed:4,checked:5,percent:80});
eq('rounds down so a failing check never shows 100%',complianceRate({categories:[{category:'a',pass:199}],issues:[{category:'a',ruleId:'x'}]}),{passed:199,checked:200,percent:99});
eq('issues outside the checked categories are not counted',complianceRate({categories:[{category:'a',pass:2}],issues:[{category:'franchise_recruit',ruleId:'kr.fr.x'}]}),{passed:2,checked:2,percent:100});
eq('every rule hit → 0%',complianceRate({categories:[{category:'a',pass:0}],issues:[{category:'a',ruleId:'r1'},{category:'a',ruleId:'r2'}]}),{passed:0,checked:2,percent:0});
check('does not mutate its input',(()=>{const v=Object.freeze({categories:Object.freeze([Object.freeze({category:'a',pass:1})]),issues:Object.freeze([Object.freeze({category:'a',ruleId:'r'})])});complianceRate(v);return true})());

// 2) 작업물 규정 보기와 같은 규칙 집합: 점검 규칙 수 = 소비자 점검 규칙(가맹 모집 범위 규칙 제외) 수. 위반이 있어도 분모는 같다.
const applicable=COMPLIANCE_LEXICON.rules.filter(r=>r.scope!=='recruitment').length;
const view=content=>complianceViewOf({id:'rate-a',role:'copy',content},null,null,'2026-11-15T00:00:00.000Z');
const clean=complianceRate(view('## 이번 주 메뉴\n매운 떡볶이 세트를 소개합니다.'));
eq('clean artifact: every applicable rule passes',clean,{passed:applicable,checked:applicable,percent:100});
const dirty=view('## 이벤트\n영수증 리뷰 이벤트: 별점 5점 리뷰를 남기면 음료를 드립니다.');
check('synthetic violation is detected',dirty.issues.length>0);
const rate=complianceRate(dirty),hits=new Set(dirty.issues.map(i=>i.ruleId)).size;
eq('violation keeps the denominator at the applicable rule count',[rate.checked,rate.passed],[applicable,applicable-hits]);
check('violation lowers the rate below 100%',rate.percent<100&&rate.percent===Math.floor(100*(applicable-hits)/applicable));

console.log(JSON.stringify({passed}));
