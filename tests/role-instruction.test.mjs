// lib/role-instruction.ts 순수 함수가 기준 커밋 role-execution.ts의 HERMES·OpenAI 제출 본문, 저장 산출물 계약과 바이트 동일한지 확인한다.
// 스냅샷은 scripts/eval/capture-role-submission.mjs로 기준 커밋에서 모의 런타임(합성 데이터)으로 캡처했다. 이 테스트는 런타임 헬퍼를 쓰지 않는다.
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {SourceTextModule,createContext} from 'node:vm';
import ts from 'typescript';
const context=createContext({console}),cache=new Map();
function moduleFor(path){path=resolve(path);if(cache.has(path))return cache.get(path);const m=new SourceTextModule(ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText,{context,identifier:path});cache.set(path,m);return m;}
const m=moduleFor('lib/role-instruction.ts');await m.link((s,r)=>moduleFor(resolve(dirname(r.identifier),s+'.ts')));await m.evaluate();
const {buildRoleInstruction,buildRoleInput,roleRequestPlan}=m.namespace,{roles:agencyRoles}=moduleFor('lib/agency.ts').namespace;
const passed=[];
const check=(name,fn)=>{fn();passed.push(name)};

// 순수 로더는 상대 경로 '.ts'만 해석한다. 서버 모듈(@/lib, server, hermes)을 가져오면 위 link에서 실패한다.
check('pure module imports only relative paths',()=>assert.ok(![...readFileSync('lib/role-instruction.ts','utf8').matchAll(/from\s+'([^']+)'/g)].some(x=>!x[1].startsWith('./'))));
const files=readdirSync('tests/fixtures').filter(f=>/^role-submission-[0-9a-f]{7}\.json$/.test(f));
check('one base snapshot fixture exists',()=>assert.equal(files.length,1));
const fixture=JSON.parse(readFileSync('tests/fixtures/'+files[0],'utf8'));
check('snapshot names its base commit',()=>assert.ok(files[0].includes(fixture.baseSha.slice(0,7))&&/^[0-9a-f]{40}$/.test(fixture.baseSha)));
check('snapshot was captured without external calls',()=>assert.equal(fixture.providerCalls.external,0));
// 순수 함수가 단일 원천이라 드리프트 테스트는 이 모듈의 변경을 볼 수 없다. 모든 분기가 기준 커밋에 묶이도록 스냅샷이 각 분기를 적어도 한 번 담아야 한다.
const input=c=>JSON.parse(c.submission.input),rr=c=>c.context.revisionRequest,truncated=c=>input(c).task.outputContract.contextTruncated===true;
check('snapshot covers every agency role',()=>assert.deepEqual([...new Set(fixture.cases.map(c=>c.role))].sort(),[...agencyRoles].map(r=>r.id).sort()));
const branches={
 'a plain request':c=>!rr(c)&&!c.context.previousDecisions&&!truncated(c),
 'a last-failure revision':c=>c.role!=='quality'&&rr(c)?.lastFailure&&!rr(c).note,
 'a quality last-failure revision':c=>c.role==='quality'&&rr(c)?.lastFailure,
 'a review-note repair':c=>c.role!=='quality'&&rr(c)?.note&&rr(c).previousExcerpt,
 'a quality review-note repair':c=>c.role==='quality'&&rr(c)?.note&&rr(c).previousExcerpt,
 'meeting decisions':c=>c.context.previousDecisions?.decisions,
 'a truncated prior context':c=>c.role!=='quality'&&truncated(c),
 'a quality truncated prior context':c=>c.role==='quality'&&truncated(c)&&input(c).previous.some(p=>!p.excerpt&&p.originalLength>6000),
 'an OpenAI cmo body':c=>c.provider==='openai'&&c.role==='cmo',
 'an OpenAI insight body':c=>c.provider==='openai'&&c.role==='insight',
};
for(const [name,fn] of Object.entries(branches))check(`snapshot covers ${name}`,()=>assert.ok(fixture.cases.some(fn),`스냅샷(${files[0]})에 ${name} 케이스가 없습니다. scripts/eval/capture-role-submission.mjs로 재캡처하세요.`));
// 다르면 회귀이거나 lib/role-instruction.ts·practice.ts 등의 의도한 변경이다. 의도한 변경이면 새 기준 커밋에서 재캡처한다(docs/EVAL.ko.md '역할 지시 스냅샷').
const drift=`스냅샷(${files[0]})과 다릅니다. 의도한 지시·입력 변경이면 새 기준 커밋에서 scripts/eval/capture-role-submission.mjs로 재캡처하세요.`;
for(const c of fixture.cases){
 check(`${c.name} instructions are byte-identical`,()=>assert.equal(buildRoleInstruction(c.context),c.submission.instructions,drift));
 check(`${c.name} input is byte-identical`,()=>assert.equal(buildRoleInput(c.context),c.submission.input,drift));
 check(`${c.name} output contract matches the stored contract`,()=>assert.deepEqual(JSON.parse(JSON.stringify(roleRequestPlan(c.context).outputContract)),c.contract,drift));
}
// 실패 사례: 입력 한 글자·재작성 여부가 달라지면 동일하지 않아야 한다(비교가 실제로 내용을 본다).
const sample=fixture.cases.find(c=>c.role==='content');
check('changed campaign goal changes input',()=>assert.notEqual(buildRoleInput({...sample.context,campaign:{...sample.context.campaign,goal:sample.context.campaign.goal+'!'}}),sample.submission.input));
check('revision request changes instruction',()=>assert.notEqual(buildRoleInstruction({...sample.context,revisionRequest:{note:'',previousVersion:null,previousExcerpt:'',lastFailure:'x'}}),sample.submission.instructions));
check('unknown role is rejected',()=>assert.throws(()=>buildRoleInstruction({role:'intern'}),/Unknown agency role/));
check('campaign id is not sent to the provider',()=>assert.ok(!JSON.parse(buildRoleInput(sample.context)).campaign.id));
check('output contract plan matches the submitted task contract',()=>assert.deepEqual(JSON.parse(JSON.stringify(roleRequestPlan(sample.context).outputContract)),JSON.parse(sample.submission.input).task.outputContract));
check('inputs are not mutated',()=>{const before=JSON.stringify(sample.context);buildRoleInput(sample.context);buildRoleInstruction(sample.context);assert.equal(JSON.stringify(sample.context),before)});
console.log(JSON.stringify({passed:passed.length}));
