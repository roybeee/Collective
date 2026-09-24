// 프롬프트 레지스트리(F3a) 기준선: 레지스트리가 비어 있으면 역할·회의(시드 작업물, 역할 8개 실행 작업물)·바이럴 학습의 제출 본문(instructions·input)과 역할 inputHash가 기준 커밋과 바이트 동일한지 본다.
// 기준 fixture(tests/fixtures/prompt-baseline-<sha7>.json)는 기준 커밋(레지스트리 도입 전)에서 이 스위트를 캡처 모드로 실행해 만들었다. 본문 대신 sha256·길이만 담는다.
// 캡처: PROMPT_BASELINE_SHA=<40자리 기준 SHA> PROMPT_BASELINE_CAPTURE=tests/fixtures/prompt-baseline-<sha7>.json node --experimental-vm-modules tests/prompt-baseline.test.mjs
// 근거: mocked(모의 HERMES fetch 스텁, 메모리 SQLite, 합성 데이터). 외부 네트워크 호출은 0회다.
import assert from 'node:assert/strict';
import {readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {testRuntime} from './helpers/runtime.mjs';
import {sha,seed,mockHermes,runRole,runMeeting,pinRoleArtifacts,roleCampaign,meetingCampaign,roleIds,brand} from './helpers/prompt-seed.mjs';

const hermes=mockHermes();
const {sql,load}=testRuntime(hermes.fetch);
const server=await load('lib/server.ts'),execution=await load('lib/role-execution.ts'),meeting=await load('lib/meeting-execution.ts'),learning=await load('lib/learning-execution.ts');
const owner='pr-baseline-owner',passed=[];
const check=(name,fn)=>{fn();passed.push(name)};
await seed(server,sql,owner);
const digest=text=>({sha256:sha(text),length:String(text).length});

const roles=[];
for(const role of roleIds){const r=await runRole(execution,server,owner,roleCampaign,role);roles.push({role,status:r.status,inputHash:r.inputHash,instructions:digest(r.instructions),input:digest(r.input)})}
const met=await runMeeting(meeting,server,owner,meetingCampaign,'pr-meeting');
const steps=met.steps.map(s=>({step:s.step,instructions:digest(s.instructions),input:digest(s.input)}));
// 역할 8개가 만든 작업물로 여는 회의: 역할 실행이 작업물에 남기는 실행 메타(promptVersion 등)가 회의 입력(originalArtifacts·candidateArtifacts)에 새지 않는지 본다.
await pinRoleArtifacts(server,sql,owner,roleCampaign);
const roleArtifacts=await server.listRecords(owner,'artifact',roleCampaign.id);
const roleMet=await runMeeting(meeting,server,owner,roleCampaign,'pr-role-meeting');
const roleMeeting=roleMet.steps.map(s=>({step:s.step,instructions:digest(s.instructions),input:digest(s.input)}));
// 바이럴 학습: 분석(사례 입력 고정)은 지시·입력을, 조사(입력에 요청 시각이 들어감)는 지시만 비교한다.
const analysis=await (await learning.executeLearning(owner,{action:'start_analysis',caseId:'pr-case'})).json();
const discovery=await (await learning.executeLearning(owner,{action:'start_discovery',brandId:brand.id,query:'합성 조사 주제'})).json();
const submitted=async id=>JSON.parse((await server.readRecord(owner,'hermes_submission',id)).body);
const a=await submitted(analysis.id),d=await submitted(discovery.id);
const captured={roles,meeting:steps,roleMeeting,learning:[{kind:'analysis',instructions:digest(a.instructions),input:digest(a.input)},{kind:'discovery',instructions:digest(d.instructions)}],providerCalls:{external:hermes.external.length}};

if(process.env.PROMPT_BASELINE_CAPTURE){
 const baseSha=process.env.PROMPT_BASELINE_SHA||'';
 if(!/^[0-9a-f]{40}$/.test(baseSha))throw new Error('PROMPT_BASELINE_SHA에 40자리 기준 SHA를 주세요.');
 writeFileSync(process.env.PROMPT_BASELINE_CAPTURE,JSON.stringify({baseSha,...captured},null,1)+'\n');
 console.log(JSON.stringify({captured:process.env.PROMPT_BASELINE_CAPTURE,passed:0}));
 process.exit(0);
}

const files=readdirSync('tests/fixtures').filter(f=>/^prompt-baseline-[0-9a-f]{7}\.json$/.test(f));
check('one prompt baseline fixture exists',()=>assert.equal(files.length,1));
const fixture=JSON.parse(readFileSync('tests/fixtures/'+files[0],'utf8'));
check('fixture names its base commit',()=>assert.ok(/^[0-9a-f]{40}$/.test(fixture.baseSha)&&files[0].includes(fixture.baseSha.slice(0,7))));
check('capture and comparison make no external call',()=>assert.ok(fixture.providerCalls.external===0&&hermes.external.length===0));
check('all eight roles completed in the comparison run',()=>assert.deepEqual(roles.map(r=>r.status),roleIds.map(()=>'completed')));
check('meeting completed with the captured step list',()=>assert.ok(met.meeting.status==='completed'&&steps.map(s=>s.step).join()===fixture.meeting.map(s=>s.step).join()));
const drift='레지스트리가 비어 있는데 기준 커밋과 다릅니다. 코드 폴백은 바이트 동일해야 합니다.';
for(const [i,r] of roles.entries()){
 const base=fixture.roles[i];
 check(`${r.role} inputHash (job id) is unchanged`,()=>assert.equal(r.inputHash,base.inputHash,drift));
 check(`${r.role} instructions are byte-identical`,()=>assert.deepEqual(r.instructions,base.instructions,drift));
 check(`${r.role} input is byte-identical`,()=>assert.deepEqual(r.input,base.input,drift));
}
for(const [i,s] of steps.entries()){
 check(`meeting ${s.step} instructions are byte-identical`,()=>assert.deepEqual(s.instructions,fixture.meeting[i].instructions,drift));
 check(`meeting ${s.step} input is byte-identical`,()=>assert.deepEqual(s.input,fixture.meeting[i].input,drift));
}
// 역할 실행 작업물로 연 회의: 작업물에는 promptVersion이 있지만(F2a 조인 키) 회의 입력에는 없어야 기준 커밋과 같다.
check('role-run artifacts carry a promptVersion (the case exercises the leak path)',()=>assert.ok(roleArtifacts.length===roleIds.length&&roleArtifacts.every(a=>typeof a.promptVersion==='string')));
check('meeting on role-run artifacts completed with the captured step list',()=>assert.ok(roleMet.meeting.status==='completed'&&roleMeeting.map(s=>s.step).join()===fixture.roleMeeting.map(s=>s.step).join()));
check('meeting inputs carry no run metadata (promptVersion·promptFallback·promptRecheck)',()=>assert.ok(roleMet.steps.every(s=>!/"prompt(?:Version|Fallback|Recheck)"/.test(s.input))));
for(const [i,s] of roleMeeting.entries()){
 check(`role-run meeting ${s.step} instructions are byte-identical`,()=>assert.deepEqual(s.instructions,fixture.roleMeeting[i].instructions,drift));
 check(`role-run meeting ${s.step} input is byte-identical`,()=>assert.deepEqual(s.input,fixture.roleMeeting[i].input,drift));
}
check('viral analysis instructions and input are byte-identical',()=>assert.deepEqual(captured.learning[0],fixture.learning[0],drift));
check('viral discovery instructions are byte-identical',()=>assert.deepEqual(captured.learning[1],fixture.learning[1],drift));
// 실패 사례: 비교가 실제 본문을 본다(한 글자 차이면 해시가 다르다).
check('a one-character change changes the digest',()=>assert.notEqual(digest(a.instructions+' ').sha256,fixture.learning[0].instructions.sha256));
console.log(JSON.stringify({passed:passed.length}));
