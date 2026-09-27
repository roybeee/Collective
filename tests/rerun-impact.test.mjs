// 재실행 영향 설명(개선 계획 PR 5 '재실행 영향 설명', ux-12): 역할을 다시 작성하면 그 역할과 뒤 순서 역할의 이전 버전이 아닌 작업물이 이전 버전(outdated)이 된다(lib/role-execution.ts 완료 저장).
// 화면(app/panels.tsx '다시 작성')은 그 대상과 건수를 미리 보인다. 근거: mocked(순수 함수, 합성 작업물).
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {SourceTextModule,createContext} from 'node:vm';
import ts from 'typescript';
const context=createContext({console}),cache=new Map();
function moduleFor(path){path=resolve(path);if(cache.has(path))return cache.get(path);const m=new SourceTextModule(ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText,{context,identifier:path});cache.set(path,m);return m;}
const m=moduleFor('lib/rerun-impact.ts');await m.link((s,r)=>moduleFor(resolve(dirname(r.identifier),s+'.ts')));await m.evaluate();
const {rerunImpact,rerunImpactNote}=m.namespace;
let passed=0;
const check=(name,fn)=>{fn();passed++};
const plain=v=>JSON.parse(JSON.stringify(v));
const art=(role,status='review')=>({id:'a-'+role,role,status});
const all=[art('cmo','approved'),art('insight','revision'),art('strategy'),art('creative','outdated'),art('content'),art('quality','approved')];

check('the rewritten role and every later role with a current artifact are affected, in role order',()=>{
 const r=rerunImpact(all,'insight');
 assert.deepEqual(plain(r.map(x=>x.role)),['insight','strategy','content','quality']);
 assert.deepEqual(plain(r.map(x=>x.name)),['고객 인사이트','브랜드 전략','콘텐츠 스튜디오','독립 품질 검수']);
});
check('earlier roles and already outdated artifacts are not affected',()=>{
 const roles=rerunImpact(all,'insight').map(x=>x.role);
 assert.ok(!roles.includes('cmo')&&!roles.includes('creative'));
});
check('the last role affects only itself',()=>assert.deepEqual(plain(rerunImpact(all,'quality').map(x=>x.role)),['quality']));
check('an unknown role affects nothing',()=>assert.deepEqual(plain(rerunImpact(all,'nope')),[]));
check('the input list is not mutated',()=>{const before=JSON.stringify(all);rerunImpact(all,'cmo');assert.equal(JSON.stringify(all),before)});
check('the note names the affected roles and count and says history is kept',()=>{
 assert.equal(rerunImpactNote(rerunImpact(all,'insight')),'다시 작성하면 고객 인사이트·브랜드 전략·콘텐츠 스튜디오·독립 품질 검수 작업물 4건이 이전 버전으로 바뀝니다(이전 판은 기록에 남습니다).');
 assert.equal(rerunImpactNote(rerunImpact(all,'quality')),'다시 작성하면 독립 품질 검수 작업물 1건이 이전 버전으로 바뀝니다(이전 판은 기록에 남습니다).');
 assert.equal(rerunImpactNote([]),'');
});
check('the campaign sheet shows the note next to the rewrite button',()=>{
 const src=readFileSync('app/panels.tsx','utf8');
 assert.ok(/import \{rerunImpact,rerunImpactNote\} from '@\/lib\/rerun-impact'/.test(src));
 assert.ok(/>다시 작성<\/Button><small className="rerun-impact">\{rerunImpactNote\(rerunImpact\(artifacts,r\.id\)\)\}<\/small>/.test(src));
});
console.log(JSON.stringify({passed}));
