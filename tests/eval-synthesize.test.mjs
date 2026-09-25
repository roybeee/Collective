// 합성 평가 케이스 생성기(G4): scripts/eval/synthesize.mjs·synthesize-cases.mjs와 /api/eval import_cases.
// 수용: 같은 스펙을 두 번 생성하면 바이트까지 같다(라이브러리·CLI), 외부 네트워크 0회, 분기 체크리스트 8종을 실제 요청에서 확인,
// 거부(입력에 없는 금지 표현·스펙 개인정보 패턴·체크리스트 누락·syn- 아닌 id), 가져오기는 생성 트리·promptHash가 맞아야 하고 하나라도 틀리면 아무것도 저장하지 않는다,
// 가져온 케이스를 실행하면 평가 제출의 promptHash가 생성기 값과 같다.
// 근거: mocked(스텁 HERMES, 메모리 SQLite, 합성 스펙 scripts/eval/specs/syn-s2-bakery.json). 외부 네트워크 호출은 0회다.
import assert from 'node:assert/strict';
import {readFileSync,readdirSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {testRuntime} from './helpers/runtime.mjs';
import {synthesizeCases,CHECKLIST,canonical} from '../scripts/eval/synthesize.mjs';
import {meetingAnswer} from './helpers/prompt-seed.mjs';
import {roleFixture} from './helpers/role-fixture.mjs';

const passed=[];
const check=(name,fn)=>{fn();passed.push(name)};
const SPEC_PATH='scripts/eval/specs/syn-s2-bakery.json',spec=JSON.parse(readFileSync(SPEC_PATH,'utf8'));
const generator={commit:'c'.repeat(40),tree:'d'.repeat(40)};
const clone=x=>JSON.parse(JSON.stringify(x));
const rejects=async(fn,pattern,name)=>{await assert.rejects(fn,e=>pattern.test(e.message),name);passed.push(name)};

// 1) 결정성과 출력 모양.
const first=await synthesizeCases(clone(spec),{generator}),second=await synthesizeCases(clone(spec),{generator});
check('the same spec generates byte-identical output twice (library)',()=>assert.equal(JSON.stringify(first),JSON.stringify(second)));
check('output is 15 cases: 8 roles, 6 meeting steps, 1 brief',()=>assert.deepEqual(first.cases.map(c=>c.kind).reduce((a,k)=>({...a,[k]:(a[k]||0)+1}),{}),{role:8,meeting_step:6,brief:1}));
check('every case has a syn- external key, a spec hash and a 16-hex prompt hash',()=>assert.ok(first.cases.every(c=>c.externalKey.startsWith('syn-s2-bakery:')&&/^[0-9a-f]{32}$/.test(c.specHash)&&/^[0-9a-f]{16}$/.test(c.promptHash))));
check('all eight request branches are covered by the generated role requests',()=>assert.deepEqual(Object.keys(first.checklist).filter(k=>first.checklist[k]).sort(),[...CHECKLIST].sort()));
check('output records the generator and the spec hash',()=>assert.ok(first.generator.tree===generator.tree&&first.specId==='syn-s2-bakery'&&/^[0-9a-f]{64}$/.test(first.specHash)));
check('one synthetic campaign stays under the 1MB import body limit',()=>assert.ok(Buffer.byteLength(JSON.stringify(first))<1000000));
const text=JSON.stringify(first);
check('masked sources stay masked: the plan owner name is a placeholder',()=>assert.ok(!text.includes('합성 담당')));
check('meeting cases carry the seeded defect on quality and revision targets only',()=>{const m=first.cases.filter(c=>c.kind==='meeting_step');assert.ok(m.filter(c=>c.expectations.seededDefects).map(c=>c.externalKey.split(':').slice(2).join(':')).sort().join()==='quality,revision:content')});
check('the brief context date follows the spec clock, not the wall clock',()=>assert.equal(first.cases.find(c=>c.kind==='brief').request.contextDate,spec.now.slice(0,10)));
const changed=clone(spec);changed.briefs[0].data.goal+=' (수정)';
const third=await synthesizeCases(changed,{generator}),byKey=r=>Object.fromEntries(r.cases.map(c=>[c.externalKey,c.specHash]));
check('editing the brief changes the brief spec hash and keeps role and meeting hashes',()=>{const a=byKey(first),b=byKey(third);assert.ok(Object.keys(a).every(k=>k.includes(':brief:')?a[k]!==b[k]:a[k]===b[k]))});

// 1-b) 저장소의 다른 dev 스펙도 지금 코드로 생성된다(코드가 바뀌어도 스펙이 썩지 않게). 봉인 스펙은 저장소 밖이라 여기 없다.
for(const file of readdirSync('scripts/eval/specs').filter(f=>f.endsWith('.json')&&f!=='syn-s2-bakery.json').sort()){
 const other=JSON.parse(readFileSync('scripts/eval/specs/'+file,'utf8')),out=await synthesizeCases(other,{generator});
 check(`${file} generates dev cases covering the eight branches`,()=>assert.ok(other.set==='dev'&&out.cases.length>0&&CHECKLIST.every(k=>out.checklist[k])&&out.cases.every(c=>c.externalKey.startsWith(other.id+':')),JSON.stringify(out.checklist)));
}

// 2) CLI: 두 번 실행한 출력 파일이 같다.
const dir=mkdtempSync(join(tmpdir(),'g4-synth-'));
try{
 const run=out=>execFileSync(process.execPath,['--experimental-vm-modules','scripts/eval/synthesize-cases.mjs','--spec',SPEC_PATH,'--out',out],{encoding:'utf8',stdio:['ignore','pipe','ignore']});
 const summary=JSON.parse(run(join(dir,'a.json')).trim());run(join(dir,'b.json'));
 check('the CLI writes byte-identical files on two runs',()=>assert.ok(readFileSync(join(dir,'a.json')).equals(readFileSync(join(dir,'b.json')))));
 check('the CLI reports 15 cases and a tree identity (40-hex or dirty)',()=>assert.ok(summary.cases===15&&(/^[0-9a-f]{40}$/.test(summary.tree)||summary.tree==='dirty')));
}finally{rmSync(dir,{recursive:true,force:true})}

// 3) 거부.
const withRecords=(fn)=>{const s=clone(spec);s.records=fn(s.records);return s};
await rejects(()=>synthesizeCases({...clone(spec),expectations:{...spec.expectations,prohibitedTerms:['입력에 없는 표현']}},{generator}),/글자 그대로 없는 금지 표현/,'a prohibited term missing from the input is rejected');
await rejects(()=>synthesizeCases(withRecords(r=>r.map(x=>x.kind==='campaign'?{...x,data:{...x.data,goal:x.data.goal+' 문의 010-9876-5432'}}:x)),{generator}),/개인정보 패턴이 있습니다\(경로\): records\[1\]\.data\.goal$/,'a personal-data pattern in the spec is rejected by path, without the value');
await rejects(()=>synthesizeCases(withRecords(r=>r.filter(x=>x.id!=='syn-s2-rule-caution')),{generator}),/분기 체크리스트 누락: cautionRule$/,'a spec without a caution rule is rejected (checklist)');
await rejects(()=>synthesizeCases(withRecords(r=>r.map(x=>x.kind==='artifact'&&x.data.role==='insight'?{...x,data:{...x.data,origin:'ai'}}:x)),{generator}),/분기 체크리스트 누락: aiEdited$/,'a spec without a human-edited artifact is rejected (checklist)');
await rejects(()=>synthesizeCases(withRecords(r=>r.map((x,i)=>i===0?{...x,id:'brand-1'}:x)),{generator}),/syn-/,'a record id without the syn- prefix is rejected');
await rejects(()=>synthesizeCases({...clone(spec),schema:2},{generator}),/schema/,'an unknown spec schema is rejected');
await rejects(()=>synthesizeCases({...clone(spec),meeting:{...spec.meeting,targets:['discussion:cmo','closing']}},{generator}),/meeting\.targets/,'an unknown meeting target is rejected');

// 4) 가져오기(import_cases)와 실행.
const EVAL='https://eval-hermes.example.com',evalBodies=new Map(),external=[];let seq=0;
const capabilities={object:'hermes.api_server.capabilities',platform:'hermes-agent',features:{run_submission:true,run_status:true,run_stop:true,runs_idempotency:{durable:true,enabled:true,supported:true}}};
const BRIEF_OUTPUT=JSON.stringify({summary:'합성 요약',suggestions:['kpi','hypothesis','experiment','tracking','decision'].map(field=>({field,value:`합성 ${field} 값`,reason:''})),questions:[],assumptions:[]});
const {sql,load}=testRuntime(async(url,options={})=>{
 url=String(url);const method=options.method||'GET',headers=new Headers(options.headers||{});
 if(url.startsWith('https://hermes.example.com/'))return Response.json({run_id:'ops'});
 if(!url.startsWith(EVAL+'/')){external.push(url);throw new Error('모의 주소만 호출합니다: '+url)}
 const path=url.slice(EVAL.length);
 if(!headers.get('authorization'))return new Response('{}',{status:401});
 if(path==='/v1/capabilities')return Response.json(capabilities);
 if(path==='/v1/models')return Response.json({data:[{id:'mock-eval-model'}]});
 if(path==='/v1/runs'&&method==='POST'){const id='g4_'+ ++seq;evalBodies.set(id,JSON.parse(options.body));return Response.json({run_id:id})}
 const id=/^\/v1\/runs\/([\w-]+)$/.exec(path)?.[1];if(!id||!evalBodies.has(id))return new Response('{}',{status:404});
 const body=evalBodies.get(id),input=JSON.parse(body.input);
 return Response.json({object:'hermes.run',run_id:id,status:'completed',output:input.phase?meetingAnswer(input):input.currentBrief?BRIEF_OUTPUT:roleFixture(body.input),usage:{input_tokens:1000,output_tokens:500,total_tokens:1500},model:'mock-eval-model'});
});
const server=await load('lib/server.ts'),evalServer=await load('lib/eval-server.ts'),route=await load('app/api/eval/route.ts'),background=await load('lib/background-execution.ts');
const owner='g4-owner',by={id:owner,email:null};
const call=async res=>({status:res.status,body:await res.json()});
const post=input=>route.POST(new Request('https://agency.test/api/eval',{method:'POST',headers:{'oai-authenticated-user-id':owner,'content-type':'application/json'},body:JSON.stringify(input)})).then(call);
const get=query=>route.GET(new Request('https://agency.test/api/eval'+query,{headers:{'oai-authenticated-user-id':owner}})).then(call);
const caseCount=()=>sql.prepare("SELECT COUNT(*) n FROM records WHERE owner=? AND kind='eval_case'").get(owner).n;
const status=async(fn)=>{try{await fn();return 200}catch(e){return e.status}};
await sql.prepare('INSERT INTO settings(owner,secret,model,updated_at) VALUES(?,?,?,?)').run(owner,await server.encrypt(JSON.stringify({provider:'hermes',endpoint:'https://hermes.example.com',key:'ops-only'})),'HERMES',new Date().toISOString());
assert.equal((await post({action:'save_connection',endpoint:EVAL,key:'eval-secret-key',isolationConfirmed:true,note:'메모리 off 평가 프로필'})).body.status,'ready');

let r=await post({action:'import_cases',...first});
check('the route rejects an import when the running app tree is unknown (409, nothing stored)',()=>assert.ok(r.status===409&&/운영 앱 트리/.test(r.body.error)&&caseCount()===0,JSON.stringify(r.body)));
const otherTree=await status(()=>evalServer.importCases(owner,first,by,'e'.repeat(40)));
check('an import from another tree is 409 and stores nothing',()=>assert.ok(otherTree===409&&caseCount()===0));
const imported=await evalServer.importCases(owner,clone(first),by,generator.tree);
check('an import from the running tree creates every case',()=>assert.ok(imported.created===15&&imported.existing===0&&caseCount()===15&&imported.cases.every(c=>c.status==='created')));
const stored=sql.prepare("SELECT data FROM records WHERE owner=? AND kind='eval_case'").all(owner).map(x=>JSON.parse(x.data));
check('imported cases are synthetic, record the generator and keep their keys',()=>assert.ok(stored.every(c=>c.source==='synthetic'&&c.generator.tree===generator.tree&&c.generator.commit===generator.commit&&c.externalKey.startsWith('syn-')&&c.set==='dev')));
check('imported frozen requests are unchanged by the server freeze',()=>{const byKey=Object.fromEntries(stored.map(c=>[c.externalKey,c]));assert.ok(first.cases.every(c=>canonical(byKey[c.externalKey].request)===canonical(c.request)))});
const again=await evalServer.importCases(owner,clone(first),by,generator.tree);
check('importing the same output again is idempotent (all existing)',()=>assert.ok(again.created===0&&again.existing===15&&caseCount()===15&&again.cases.every((c,i)=>c.id===imported.cases[i].id)));
// 전부 아니면 전무: 새 키 15개 중 하나의 promptHash가 틀리면 아무것도 저장하지 않는다.
const renamed=clone(first);renamed.cases=renamed.cases.map(c=>({...c,externalKey:c.externalKey.replace('syn-s2-bakery','syn-s2-bakery-copy')}));
const tampered=clone(renamed);tampered.cases[3].promptHash='0'.repeat(16);
assert.equal(await status(()=>evalServer.importCases(owner,tampered,by,generator.tree)),409);
check('a prompt hash that differs from the current assembly rejects the whole import',()=>assert.equal(caseCount(),15));
const edited=clone(first);edited.cases[0].specHash='f'.repeat(32);
assert.equal(await status(()=>evalServer.importCases(owner,edited,by,generator.tree)),409);
check('a different spec hash under an existing key is 409 and changes nothing',()=>assert.equal(caseCount(),15));
for(const [name,body] of [['a non-synthetic key',{...renamed,cases:[{...renamed.cases[0],externalKey:'manual-1'}]}],['a duplicate key',{...renamed,cases:[renamed.cases[0],renamed.cases[0]]}],['no cases',{...renamed,cases:[]}],['too many cases',{...renamed,cases:Array.from({length:101},()=>renamed.cases[0])}],['a missing prompt hash',{...renamed,cases:[{...renamed.cases[0],promptHash:undefined}]}],['a dirty generator tree',{...renamed,generator:{...generator,tree:'dirty'}}]]){
 const code=await status(()=>evalServer.importCases(owner,clone(body),by,generator.tree));
 check(`an import with ${name} is 400`,()=>assert.equal(code,400));
}
check('rejected imports store nothing',()=>assert.equal(caseCount(),15));

// 가져온 케이스 실행: 평가 제출의 promptHash가 생성기 값과 같다(역할·회의 단계·브리프 한 건씩).
const pick=key=>imported.cases.find(c=>c.externalKey===key).id,keys=['syn-s2-bakery:role:cmo','syn-s2-bakery:meeting_step:synthesis','syn-s2-bakery:brief:syn-s2-brief-1'];
r=await post({action:'start_run',caseIds:keys.map(pick),tokenBudget:250000});
check('a run over imported cases starts',()=>assert.equal(r.status,200,JSON.stringify(r.body)));
let run=r.body;for(let i=0;i<60&&['queued','running'].includes(run.status);i++){await background.advanceBackgroundWork(owner);run=(await get('?run='+run.id)).body}
check('the run completes',()=>assert.ok(run.status==='completed'&&run.results.every(x=>x.status==='completed'),JSON.stringify(run.results.map(x=>[x.label,x.status,x.error]))));
for(const key of keys){
 const result=run.results.find(x=>x.caseId===pick(key)),expected=first.cases.find(c=>c.externalKey===key).promptHash;
 check(`${key.split(':').slice(1).join(':')} was sent with the generator prompt hash`,()=>assert.equal(result.promptHash,expected));
}
check('no external network call',()=>assert.deepEqual(external,[]));
console.log(JSON.stringify({passed:passed.length}));
