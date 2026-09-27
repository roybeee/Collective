// 반복 쌍 평가 과반 게이트(lib/eval-stats.ts pairGateMajority, 대표 결정 2026-09-27 "v4 + 반복 채점").
// 같은 단위·후보·기준으로 돌린 pair run 여러 개를 받아 (케이스·채점기)마다 과반으로 봉인 회귀·input_budget·합격 수를 판정한다.
// run 하나면 pairGate와 같다. 구조 조건(pair·완료·케이스 완료·게이트웨이·모델·봉인 포함)은 run마다 그대로 본다. 모든 입력은 합성 데이터다(mocked, 네트워크 0회).
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {SourceTextModule,createContext} from 'node:vm';
import ts from 'typescript';
const context=createContext({console}),cache=new Map();
function moduleFor(path){path=resolve(path);if(cache.has(path))return cache.get(path);const m=new SourceTextModule(ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText,{context,identifier:path});cache.set(path,m);return m}
const m=moduleFor('lib/eval-stats.ts');await m.link((s,r)=>moduleFor(resolve(dirname(r.identifier),s+'.ts')));await m.evaluate();
const {pairGate,pairGateMajority}=m.namespace;
const passed=[];
const check=(name,fn)=>{fn();passed.push(name)};
const plain=v=>JSON.parse(JSON.stringify(v));

const basis={operational:{hash:'o'},eval:{hash:'e'}};
const GRADERS=['contract_json','internal_id_exposure','industry_metric_leak','input_budget'];
const grades=(over={})=>GRADERS.map(id=>({id,status:over[id]??'pass'}));
const pairCase=(caseId,set,active,candidate)=>[{caseId,set,variant:'active',status:'completed',model:'m',graders:active},{caseId,set,variant:'candidate',status:'completed',model:'m',graders:candidate}];
const run=(id,cases,extra={})=>({id,variant:'pair',status:'completed',gatewaySnapshot:basis,gatewaySnapshotEnd:basis,results:cases.flat(),...extra});
const clean=id=>run(id,[pairCase('d','dev',grades(),grades()),pairCase('s','sealed',grades(),grades())]);
const leaky=id=>run(id,[pairCase('d','dev',grades(),grades()),pairCase('s','sealed',grades(),grades({industry_metric_leak:'fail'}))]);
const codes=g=>g.reasons.map(r=>r.code);

// 1) run 하나는 기존 pairGate와 같다.
for(const r of [clean('one'),leaky('one')])check(`a single run gives exactly pairGate (${r.results[3].graders[2].status})`,()=>{const g=plain(pairGateMajority([r]));const {repeats,...rest}=g;assert.equal(repeats,1);assert.deepEqual(rest,plain(pairGate(r)))});

// 2) 봉인 회귀는 과반일 때만 센다.
let g=plain(pairGateMajority([leaky('r1'),clean('r2'),clean('r3')]));
check('a sealed regression in one of three runs is noise, not a regression',()=>assert.ok(g.ok&&g.sealedRegressions.length===0&&g.repeats===3,JSON.stringify(g)));
g=plain(pairGateMajority([leaky('r1'),leaky('r2'),clean('r3')]));
check('a sealed regression in two of three runs is a sealed regression',()=>assert.ok(!g.ok&&codes(g).includes('sealed_regression')&&JSON.stringify(g.sealedRegressions)==='[{"caseId":"s","grader":"industry_metric_leak"}]',JSON.stringify(g)));
// active가 과반 통과해야 회귀다(active도 흔들려 과반 실패면 후보 실패는 회귀가 아니다).
const shaky=id=>run(id,[pairCase('s','sealed',grades({industry_metric_leak:'fail'}),grades({industry_metric_leak:'fail'}))]);
g=plain(pairGateMajority([shaky('r1'),shaky('r2'),leaky('r3')]));
check('no regression when the active side does not pass by majority',()=>assert.ok(!codes(g).includes('sealed_regression'),JSON.stringify(g)));
// 짝수 반복의 동률은 회귀로 센다(후보에 불리하게).
g=plain(pairGateMajority([leaky('r1'),clean('r2')]));
check('an even tie on the candidate side counts against the candidate',()=>assert.ok(codes(g).includes('sealed_regression'),JSON.stringify(g)));

// 3) input_budget은 후보가 케이스마다 과반 pass면 통과한다.
const over=id=>run(id,[pairCase('d','dev',grades(),grades({input_budget:'fail'})),pairCase('s','sealed',grades(),grades())]);
g=plain(pairGateMajority([over('r1'),clean('r2'),clean('r3')]));
check('an input_budget spike in one of three runs passes',()=>assert.ok(g.ok&&g.inputBudget.pass===2&&g.inputBudget.total===2,JSON.stringify(g)));
g=plain(pairGateMajority([over('r1'),over('r2'),clean('r3')]));
check('input_budget failing in two of three runs refuses',()=>assert.ok(!g.ok&&codes(g).includes('input_budget')&&g.inputBudget.pass===1,JSON.stringify(g)));

// 4) 합격 수는 과반 판정끼리 센다.
const worse=id=>run(id,[pairCase('d','dev',grades(),grades({contract_json:'fail'})),pairCase('s','sealed',grades(),grades())]);
g=plain(pairGateMajority([worse('r1'),worse('r2'),clean('r3')]));
check('fewer majority passes on the candidate side refuses',()=>assert.ok(!g.ok&&codes(g).includes('fewer_passes')&&g.passes.active===g.passes.candidate+1,JSON.stringify(g)));
g=plain(pairGateMajority([worse('r1'),clean('r2'),clean('r3')]));
check('a minority fail does not lower the majority passes',()=>assert.ok(g.ok&&g.passes.active===g.passes.candidate,JSON.stringify(g)));

// 5) 구조 조건은 run마다 본다.
g=plain(pairGateMajority([clean('r1'),clean('r2'),{...clean('r3'),status:'running'}]));
check('an unfinished run refuses with its run id',()=>assert.ok(!g.ok&&codes(g).includes('not_completed')&&g.reasons.some(r=>r.message.includes('r3')),JSON.stringify(g)));
g=plain(pairGateMajority([clean('r1'),clean('r2'),{...clean('r3'),gatewaySnapshotEnd:{operational:{hash:'o'},eval:{hash:'changed'}}}]));
check('a gateway change inside any run refuses',()=>assert.ok(!g.ok&&codes(g).includes('gateway_changed'),JSON.stringify(g)));
g=plain(pairGateMajority([clean('r1'),clean('r2'),run('r3',[pairCase('d','dev',grades(),grades()),pairCase('x','sealed',grades(),grades())])]));
check('runs over different case sets refuse (case_set_mismatch)',()=>assert.ok(!g.ok&&codes(g).includes('case_set_mismatch'),JSON.stringify(g)));
g=plain(pairGateMajority([clean('r1'),clean('r2'),run('r3',[pairCase('d','dev',grades(),grades()),pairCase('s','sealed',grades(),grades())].map(c=>c.map(x=>({...x,model:'other'}))))]));
check('a different reported model across runs refuses (model_changed)',()=>assert.ok(!g.ok&&codes(g).includes('model_changed'),JSON.stringify(g)));
check('reasons are not duplicated across runs',()=>{const x=plain(pairGateMajority([{...clean('r1'),status:'running'},{...clean('r2'),status:'running'}]));assert.equal(x.reasons.filter(r=>r.code==='not_completed').length,1)});
check('an empty list is refused',()=>assert.throws(()=>pairGateMajority([])));

// 6) 순수 모듈 유지
check('eval-stats still has no imports',()=>assert.ok(!/^\s*import\s/m.test(readFileSync('lib/eval-stats.ts','utf8'))));
console.log(JSON.stringify({passed:passed.length}));
