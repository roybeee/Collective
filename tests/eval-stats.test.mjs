// 평가 run 비교 통계(lib/eval-stats.ts)의 McNemar 정확 검정과 판정 규칙을 고정한다. 모든 입력은 합성 데이터다(mocked, 네트워크 0회).
// p 기준값은 Python fractions로 계산한 정확값이다: p = min(1, 2·Σ_{i≤min(b,c)} C(b+c,i) / 2^(b+c)).
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {SourceTextModule,createContext} from 'node:vm';
import ts from 'typescript';
const context=createContext({console}),cache=new Map();
function moduleFor(path){path=resolve(path);if(cache.has(path))return cache.get(path);const m=new SourceTextModule(ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText,{context,identifier:path});cache.set(path,m);return m;}
const m=moduleFor('lib/eval-stats.ts');await m.link((s,r)=>moduleFor(resolve(dirname(r.identifier),s+'.ts')));await m.evaluate();
const {mcnemarExact,compareRuns,comparisonVerdict,MIN_PAIRS,ALPHA}=m.namespace;
const passed=[];
const check=(name,fn)=>{fn();passed.push(name)};
const plain=v=>JSON.parse(JSON.stringify(v));

// 1) 알려진 값
const known=[[0,0,1],[1,0,1],[0,5,0.0625],[0,6,0.03125],[2,8,0.109375],[1,9,0.021484375],[10,10,1],[30,50,0.03299261842647618],[12,3,0.03515625],[40,20,0.01348929373119186],[5,17,0.01690053939819336],[100,130,0.055613577781392386]];
for(const [b,c,p] of known)check(`McNemar exact p(b=${b},c=${c}) = ${p}`,()=>assert.ok(Math.abs(mcnemarExact(b,c)-p)<1e-12,`${mcnemarExact(b,c)} ≠ ${p}`));
check('p is symmetric in b and c',()=>assert.equal(mcnemarExact(3,11),mcnemarExact(11,3)));
check('large discordant counts stay finite and in [0,1]',()=>{const p=mcnemarExact(2000,2150);assert.ok(Number.isFinite(p)&&p>0&&p<1)});
for(const [b,c] of [[-1,2],[1.5,2],[NaN,1],[1,'2']])check(`invalid counts rejected (${b},${c})`,()=>assert.throws(()=>mcnemarExact(b,c),e=>e.status===422&&/[가-힣]/.test(e.message)));
check('thresholds follow docs/EVAL.ko.md (n≥30, p<0.05)',()=>assert.ok(MIN_PAIRS===30&&ALPHA===0.05));

// 2) 판정 규칙
const cases=[
 ['no pairs is insufficient',0,0,0,'insufficient'],
 ['n<30 with a regression is insufficient even when p<0.05',20,9,0,'insufficient'],
 ['n<30 without regression is only non_regression, never improved',6,0,6,'non_regression'],
 ['n<30 with b=0 and c=0 is non_regression',12,0,0,'non_regression'],
 ['n≥30, p<0.05 and c>b is improved',30,1,9,'improved'],
 ['n≥30, b=0, c=6 (p=0.03125) is improved',40,0,6,'improved'],
 ['n≥30, p<0.05 and b>c is regressed',31,12,3,'regressed'],
 ['n≥30, b=0 but p≥0.05 is non_regression',40,0,5,'non_regression'],
 ['n≥30, b>0 and p≥0.05 is inconclusive',40,2,8,'inconclusive'],
 ['n≥30, b=c is inconclusive',50,10,10,'inconclusive'],
];
for(const [name,n,b,c,verdict] of cases)check(name,()=>assert.equal(comparisonVerdict(n,b,c,mcnemarExact(b,c)),verdict));

// 3) 대응 비교: 같은 케이스·같은 채점기의 pass/fail 짝만 쓴다.
const run=(id,rows)=>({id,results:rows.map(([caseId,status,graders])=>({caseId,status,graders:Object.entries(graders).map(([gid,s])=>({id:gid,status:s}))}))});
const A=run('run-a',[
 ['c1','completed',{g1:'pass',g2:'pass'}],
 ['c2','completed',{g1:'pass',g2:'not_applicable'}],
 ['c3','completed',{g1:'fail',g2:'grader_error'}],
 ['c4','failed',{}],
 ['c5','completed',{g1:'fail',g2:'fail'}],
 ['only-a','completed',{g1:'pass'}],
]);
const B=run('run-b',[
 ['c1','completed',{g1:'fail',g2:'pass'}],
 ['c2','completed',{g1:'pass',g2:'pass'}],
 ['c3','completed',{g1:'pass',g2:'fail'}],
 ['c4','completed',{g1:'pass',g2:'pass'}],
 ['c5','not_run',{}],
 ['only-b','completed',{g1:'fail'}],
]);
const cmp=plain(compareRuns(A,B));
const g1=cmp.graders.find(g=>g.id==='g1'),g2=cmp.graders.find(g=>g.id==='g2');
check('comparison names baseline and candidate',()=>assert.ok(cmp.baseline==='run-a'&&cmp.candidate==='run-b'));
check('case sets are reported with the unmatched counts',()=>assert.deepEqual([cmp.sharedCases,cmp.onlyBaseline,cmp.onlyCandidate,cmp.sameCaseSet],[5,1,1,false]));
check('pairs need both runs completed',()=>assert.equal(g1.n,3));
check('b counts baseline pass → candidate fail, c counts fail → pass',()=>assert.deepEqual([g1.b,g1.c,g1.bothPass,g1.bothFail],[1,1,1,0]));
check('not_applicable and grader_error are excluded from pairs',()=>assert.deepEqual([g2.n,g2.b,g2.c,g2.bothPass],[1,0,0,1]));
check('each grader carries p and verdict',()=>assert.ok(g1.p===1&&g1.verdict==='insufficient'&&g2.verdict==='non_regression'));
check('grader order follows first appearance',()=>assert.deepEqual(cmp.graders.map(g=>g.id),['g1','g2']));

// 4) 30쌍 이상에서 개선 판정
const many=(id,pattern)=>run(id,pattern.map((s,i)=>['k'+i,'completed',{g1:s}]));
const base=[...Array(9).fill('fail'),'pass',...Array(20).fill('pass'),...Array(5).fill('fail')];
const cand=[...Array(9).fill('pass'),'fail',...Array(20).fill('pass'),...Array(5).fill('fail')];
const improved=plain(compareRuns(many('base',base),many('cand',cand))).graders[0];
check('35 paired cases with c=9, b=1 is improved',()=>assert.deepEqual([improved.n,improved.b,improved.c,improved.verdict],[35,1,9,'improved']));
check('the reverse direction is regressed',()=>assert.equal(plain(compareRuns(many('cand',cand),many('base',base))).graders[0].verdict,'regressed'));
check('identical runs are non_regression with p=1',()=>{const g=plain(compareRuns(many('x',base),many('y',base))).graders[0];assert.ok(g.b===0&&g.c===0&&g.p===1&&g.verdict==='non_regression'&&plain(compareRuns(many('x',base),many('y',base))).sameCaseSet)});
check('runs without results compare to nothing',()=>assert.deepEqual(plain(compareRuns({id:'e1',results:[]},{id:'e2',results:[]})).graders,[]));

// 5) 순수 모듈: import가 없다(화면·서버·테스트가 그대로 쓴다).
check('eval-stats has no imports',()=>assert.ok(!/^\s*import\s/m.test(readFileSync('lib/eval-stats.ts','utf8'))));
console.log(JSON.stringify({passed:passed.length}));
