// 역할·회의 마케팅 블록(스위치 mkt_skill_prompts, 마케팅 스킬 이식 P4b): 꺼짐이면 지시·inputHash가 기준선(tests/fixtures/prompt-baseline-*.json)과 같고,
// 켜면 지시문 끝에만 코드 소유 블록이 붙는다(총괄 실행·회의 합의=마케팅 경로, 모든 단계=근거 상태 규율, 품질=통과·보류·반려 판정). 출력 계약 섹션 수는 같다.
// 근거: mocked(모의 HERMES fetch 스텁, 메모리 SQLite, 합성 데이터). 외부 네트워크 호출은 0회다.
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {testRuntime} from './helpers/runtime.mjs';
import {sha,seed,mockHermes,runRole,runMeeting,roleCampaign,meetingCampaign,roleIds} from './helpers/prompt-seed.mjs';

const hermes=mockHermes();
const {sql,load}=testRuntime(hermes.fetch);
const server=await load('lib/server.ts'),execution=await load('lib/role-execution.ts'),meeting=await load('lib/meeting-execution.ts'),flags=await load('lib/feature-flags.ts');
const practice=await load('lib/practice.ts'),instruction=await load('lib/role-instruction.ts'),output=await load('lib/role-output.ts'),mktServer=await load('lib/mkt-skills-server.ts');
const passed=[];const check=(name,fn)=>{fn();passed.push(name)};
const off='pr-baseline-owner',on='mkt-on-owner',by={id:'owner-account',email:null};
await seed(server,sql,off);await seed(server,sql,on);
const fixture=JSON.parse(readFileSync('tests/fixtures/'+readdirSync('tests/fixtures').find(f=>/^prompt-baseline-[0-9a-f]{7}\.json$/.test(f)),'utf8'));

// (1) 순수 블록: 역할별 구성. 경로는 cmo만, 판정은 quality만, 근거 상태 규율은 모두.
const {marketingRouting,evidenceStateDiscipline,qualityVerdictWording}=practice;
check('blocks are non-empty single strings without code-owned contract headings',()=>{for(const b of [marketingRouting,evidenceStateDiscipline,qualityVerdictWording]){assert.equal(typeof b,'string');assert.ok(b.length>40);assert.ok(!/필수 산출물|완료 전 점검|인계:|sections/.test(b))}});
check('routing names the two paths and the two steps that cannot be skipped',()=>assert.ok(/빠른 경로/.test(marketingRouting)&&/전체 경로/.test(marketingRouting)&&/AI 답변 기준선/.test(marketingRouting)&&/윤리 게이트/.test(marketingRouting)&&/생략하지 않/.test(marketingRouting)));
check('evidence-state discipline: only 확인 facts carry numbers, dates or counts; statements are quotes',()=>assert.ok(/수치·날짜·횟수/.test(evidenceStateDiscipline)&&/확인/.test(evidenceStateDiscipline)&&/진술/.test(evidenceStateDiscipline)&&/인용/.test(evidenceStateDiscipline)));
check('quality verdict wording: 통과/보류/반려 with basis 법령 행 / 미확인 / 운영 기준',()=>assert.ok(['통과','보류','반려','법령 행','미확인','운영 기준'].every(w=>qualityVerdictWording.includes(w))));
check('role block: cmo gets routing, quality gets the verdict, every role gets the discipline',()=>{for(const r of roleIds){const b=practice.mktRoleBlock(r);assert.ok(b.startsWith('\n'));assert.equal(b.includes(marketingRouting),r==='cmo');assert.equal(b.includes(qualityVerdictWording),r==='quality');assert.ok(b.includes(evidenceStateDiscipline))}});
check('meeting block: synthesis gets routing, quality phase gets the verdict, all phases get the discipline',()=>{for(const p of ['discussion','synthesis','revision','quality']){const b=practice.mktMeetingBlock(p);assert.equal(b.includes(marketingRouting),p==='synthesis');assert.equal(b.includes(qualityVerdictWording),p==='quality');assert.ok(b.includes(evidenceStateDiscipline))}});

// (2) 순수 지시문: 꺼짐(옵션 없음·false)은 같고, 켜짐은 끝에만 붙는다. 계약 섹션 수는 그대로다.
const req=role=>({role,campaign:roleCampaign});
for(const role of roleIds){
 const base=instruction.buildRoleInstruction(req(role)),offText=instruction.buildRoleInstruction(req(role),{mktSkills:false}),onText=instruction.buildRoleInstruction(req(role),{mktSkills:true});
 check(`${role}: option false is byte-equal to no option`,()=>assert.equal(offText,base));
 check(`${role}: flag on only appends the role block`,()=>assert.equal(onText,base+practice.mktRoleBlock(role)));
 check(`${role}: the required sections listed in the instruction are the same`,()=>{const listed=t=>(t.match(/필수 sections: (\[[^\]]*\])/)||[])[1]??null;assert.equal(listed(onText),listed(base));assert.equal(output.roleOutputContract(role).sections.length,JSON.parse(listed(base)??JSON.stringify(output.roleOutputContract(role).sections)).length)});
}

// (3) 운영 실행: 꺼짐은 기준선과 바이트·inputHash가 같고, 켜짐은 지시 끝에 블록이 붙고 inputHash가 달라진다(같은 브리프 재실행이 이전 작업으로 묶이지 않게).
assert.equal(await mktServer.mktSkillPromptsEnabled(off),false);passed.push('the server helper reads the switch as off by default');
await flags.setFeatureFlag(on,{flag:'mkt_skill_prompts',enabled:true},by);
assert.equal(await mktServer.mktSkillPromptsEnabled(on),true);passed.push('the server helper reads the switch when it is on');
const offRuns=[],onRuns=[];
for(const role of roleIds){offRuns.push(await runRole(execution,server,off,roleCampaign,role));onRuns.push(await runRole(execution,server,on,roleCampaign,role))}
for(const [i,role] of roleIds.entries()){
 const base=fixture.roles.find(r=>r.role===role);
 check(`${role}: flag off instructions and input match the prompt baseline`,()=>{assert.equal(sha(offRuns[i].instructions),base.instructions.sha256);assert.equal(sha(offRuns[i].input),base.input.sha256)});
 check(`${role}: flag off inputHash matches the prompt baseline`,()=>assert.equal(offRuns[i].inputHash,base.inputHash));
 check(`${role}: flag on appends the role block and keeps the input`,()=>{assert.equal(onRuns[i].instructions,offRuns[i].instructions+practice.mktRoleBlock(role));assert.equal(onRuns[i].input,offRuns[i].input)});
 check(`${role}: flag on changes the inputHash`,()=>assert.notEqual(onRuns[i].inputHash,offRuns[i].inputHash));
}

// (4) 회의: 시작 때 스위치를 스냅샷에 고정한다. 꺼짐은 기준선과 같고, 켜짐은 단계별 블록만 붙는다.
const offMeeting=await runMeeting(meeting,server,off,meetingCampaign,'mkt-off-meeting'),onMeeting=await runMeeting(meeting,server,on,meetingCampaign,'mkt-on-meeting');
check('flag off meeting: every step matches the prompt baseline',()=>{assert.equal(offMeeting.steps.length,fixture.meeting.length);for(const [i,s] of offMeeting.steps.entries()){assert.equal(sha(s.instructions),fixture.meeting[i].instructions.sha256,s.step);assert.equal(sha(s.input),fixture.meeting[i].input.sha256,s.step)}});
check('flag off meeting snapshot has no switch key',()=>assert.ok(!('mktSkillPrompts' in offMeeting.meeting.snapshot)));
check('flag on meeting snapshot pins the block version',()=>assert.equal(onMeeting.meeting.snapshot.mktSkillPrompts,practice.MKT_SKILL_PROMPTS_VERSION));
check('flag on meeting: each step appends only its phase block and keeps the input',()=>{assert.equal(onMeeting.steps.length,offMeeting.steps.length);for(const [i,s] of onMeeting.steps.entries()){const phase=onMeeting.meeting.steps[i].phase;assert.equal(s.instructions,offMeeting.steps[i].instructions+practice.mktMeetingBlock(phase),s.step);assert.equal(s.input.replaceAll('mkt-on-meeting','mkt-off-meeting'),offMeeting.steps[i].input,s.step)}});
check('flag on meeting: synthesis carries the routing and the quality review carries the verdict',()=>{const at=phase=>onMeeting.steps.find((s,i)=>onMeeting.meeting.steps[i].phase===phase);assert.ok(at('synthesis').instructions.includes(marketingRouting));const q=at('quality');assert.ok(q&&q.instructions.includes(qualityVerdictWording)&&!q.instructions.includes(marketingRouting))});
check('withMeetingBlock off is the identity',()=>{for(const s of offMeeting.steps)assert.equal(practice.withMeetingBlock(s.instructions,'synthesis',false),s.instructions)});
// (5) P4a 레지스트리 후보 본문: check-prompts 통과, 코드 소유 아님, 출력 계약 수와 같은 outputs, 기존 방법 보존(덧붙임만). 코드 폴백은 바뀌지 않는다.
const units=await load('lib/prompt-units.ts');
const run=spawnSync(process.execPath,['scripts/check-prompts.mjs'],{encoding:'utf8'});
check('the candidate bodies pass check-prompts (exit 0)',()=>assert.equal(run.status,0,run.stdout+run.stderr));
for(const role of roleIds){
 const unit='role.'+role,file=JSON.parse(readFileSync(`prompts/${unit}.json`,'utf8')),code=JSON.parse(JSON.stringify(units.codeUnitBody(unit)));
 check(`${unit}: candidate passes the registry body validator`,()=>assert.doesNotThrow(()=>units.validateUnitBody(unit,file.body)));
 check(`${unit}: candidate stays within 6,000 characters`,()=>assert.ok(units.canonicalJson(unit,file.body).length<=6000));
 check(`${unit}: outputs count equals the output contract section count`,()=>assert.equal(file.body.outputs.length,output.roleOutputContract(role).sections.length));
 check(`${unit}: candidate keeps the code methods and only adds rules`,()=>{assert.deepEqual(file.body.methods.slice(0,code.methods.length),code.methods);assert.ok(file.body.methods.length>code.methods.length)});
 check(`${unit}: candidate differs from the code fallback (registered later as a candidate, not active)`,()=>assert.notEqual(units.canonicalJson(unit,file.body),JSON.stringify(code)));
}
check('the code fallback is unchanged by the candidate files (no mkt block in the code constant)',()=>{for(const role of roleIds)assert.ok(!JSON.stringify(units.codeUnitBody('role.'+role)).includes('근거 상태 규율'))});
check('no external provider call was made',()=>assert.equal(hermes.external.length,0));

console.log(JSON.stringify({passed:passed.length,checks:passed},null,1));
