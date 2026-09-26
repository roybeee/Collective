// 카피 팩 v2 A3-4: 회의 개선본의 카피 팩(lib/meetings.ts·meeting-execution.ts·meeting-input.ts·eval-freeze.ts), 합성 v2 스펙(scripts/eval/specs/syn-s9-*.json·synthesize.mjs),
// 평가 기대 계약(lib/eval-kinds.ts gradeRole → GradeContext.outputProfile → lib/graders/structure.ts contract_json).
// 수용: 스위치 꺼짐(스냅샷에 프로필 없음)이면 회의 제출·저장이 이전과 바이트 동일하다. 프로필이 있으면 콘텐츠 개선본만 v2 팩 지시·파싱을 쓰고 새 작업물 판에 팩을 묶는다.
// 팩 형식 오류는 soft다. 합성 스펙 2건은 스위치·확정 말투로 outputProfile·brandVoice를 동결한다. v2 요청 + v1 원문은 contract_json fail이다.
// 근거: mocked(모의 HERMES fetch 스텁, 메모리 SQLite, 합성 데이터). 모델·외부 네트워크 호출은 0회다.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {testRuntime} from './helpers/runtime.mjs';
import {seed,meetingAnswer,runMeeting,meetingCampaign} from './helpers/prompt-seed.mjs';
import {synthesizeCases,validateSpec} from '../scripts/eval/synthesize.mjs';

const passed=[];
const check=(name,fn)=>{fn();passed.push(name)};
const plain=v=>JSON.parse(JSON.stringify(v));
const clone=plain;

// ── 합성 팩(가상 브랜드 문장) ──
const variant=(id,hook,body)=>({id,angle:`각도 ${id}`,hook,body,cta:'매장에서 카드 보여 주기'});
const V3=[variant('A','다음 방문엔 김밥도 같이','포장 봉투 속 카드를 보여 주시면 다음 메뉴를 먼저 안내합니다.'),variant('B','카드 한 장이 다음 메뉴 안내','오늘 드신 떡볶이와 어울리는 메뉴를 카드 뒷면에 적었습니다.'),variant('C','동네 분식의 두 번째 메뉴','다음 방문 때 새 메뉴 준비 일정을 알려 드립니다.')];
const scene=(start,end)=>({start,end,visual:'포장 봉투에 카드를 넣는 손',line:'다음에 또 만나요',caption:'카드를 보여 주세요',sound:'주방 소리',transition:'컷'});
const goodPack={version:'copy-pack-v2',channels:[{channel:'YouTube',purpose:'재방문 유도',destination:'매장',variants:V3}],shortform:{channel:'YouTube 쇼츠',durationSec:15,scenes:[scene(0,3),scene(3,8),scene(8,15)]},experiments:[{title:'훅 비교',channel:'YouTube',hypothesis:'메뉴 이름 훅이 클릭을 늘린다',variable:'훅',control:'A',treatment:'B',fixed:'본문·CTA',metric:'click_rate'}]};
const twoVariants={...goodPack,channels:[{...goodPack.channels[0],variants:V3.slice(0,2)}]};

// ── 모의 HERMES: 회의는 합성 응답(meetingAnswer). 콘텐츠 개선본은 지시문에 카피 팩 스키마가 있을 때만 packMode의 팩을 덧붙인다 ──
const bodies=new Map(),external=[];let calls=0,packMode='good';
function answer(sent){
 const input=JSON.parse(sent.input),text=meetingAnswer(input);
 if(input.phase!=='revision'||input.role!=='content'||!sent.instructions.includes('copy-pack-v2')||packMode==='none')return text;
 return JSON.stringify({...JSON.parse(text),copyPack:packMode==='two'?twoVariants:goodPack});
}
const {sql,load}=testRuntime(async(url,options={})=>{
 url=String(url);
 if(!url.startsWith('https://hermes.example.com/')){external.push(url);throw new Error('모의 주소만 호출합니다: '+url)}
 if(url.endsWith('/v1/runs')){const id='mcp_'+ ++calls;bodies.set(id,JSON.parse(options.body));return Response.json({run_id:id})}
 const id=url.split('/').pop();
 return Response.json({object:'hermes.run',run_id:id,status:'completed',output:answer(bodies.get(id)),usage:{total_tokens:100,output_tokens:600},model:'mock-model'});
});
const server=await load('lib/server.ts'),meetingExec=await load('lib/meeting-execution.ts'),meetings=await load('lib/meetings.ts'),flags=await load('lib/feature-flags.ts');
const freeze=await load('lib/eval-freeze.ts'),kinds=await load('lib/eval-kinds.ts'),graders=await load('lib/graders/index.ts'),copyPack=await load('lib/copy-pack.ts');
const setFlag=(owner,enabled)=>flags.setFeatureFlag(owner,{flag:'a3_copy_pack',enabled},{id:owner,email:null});
const artifacts=async owner=>(await server.listRecords(owner,'artifact',meetingCampaign.id)).filter(a=>a.status!=='outdated');
const events=owner=>sql.prepare("SELECT data FROM records WHERE owner=? AND kind='event' AND parent_id=?").all(owner,meetingCampaign.id).map(x=>JSON.parse(x.data).message||'');
const byStep=run=>Object.fromEntries(run.steps.map(s=>[s.step,s]));
const MID='mcp-meeting';

// 1) 순수: 지시·파싱
const revisionStep=role=>({id:`m:revision:${role}`,role,phase:'revision',status:'pending'});
const legacyRevision=meetings.meetingInstructions(revisionStep('content'),true);
check('revision instructions without the profile are byte-identical to the three-argument call',()=>{for(const role of ['content','growth'])assert.equal(meetings.meetingInstructions(revisionStep(role),true,undefined,false),meetings.meetingInstructions(revisionStep(role),true))});
const packedInstruction=meetings.meetingInstructions(revisionStep('content'),true,undefined,true);
check('the copy pack revision instruction adds the pack schema and the meeting pack rules only',()=>{
 assert.ok(packedInstruction.startsWith(legacyRevision.slice(0,legacyRevision.indexOf('어느 팀원의 지적과'))));
 assert.ok(packedInstruction.includes(copyPack.copyPackSchema)&&packedInstruction.endsWith(meetings.meetingCopyPackInstruction));
 assert.ok(!meetings.meetingCopyPackInstruction.includes('output_1')&&!meetings.meetingCopyPackInstruction.includes('sections')&&meetings.meetingCopyPackInstruction.includes('content 앞에'));
 assert.ok(meetings.meetingCopyPackInstruction.startsWith(' 카피 팩 규칙: channels는 1~4개'));
});
const profiled={snapshot:{outputProfile:'copy-pack-v2'}},unprofiled={snapshot:{}};
check('only the content revision of a profiled meeting uses the pack',()=>{
 assert.equal(meetings.meetingCopyPack(profiled,{phase:'revision',role:'content'}),true);
 for(const s of [{phase:'revision',role:'growth'},{phase:'revision',role:'creative'},{phase:'discussion',role:'content'},{phase:'quality',role:'quality'}])assert.equal(meetings.meetingCopyPack(profiled,s),false,JSON.stringify(s));
 assert.equal(meetings.meetingCopyPack(unprofiled,{phase:'revision',role:'content'}),false);
 assert.equal(meetings.meetingCopyPack({snapshot:{outputProfile:'other'}},{phase:'revision',role:'content'}),false);
});
const revisionText=pack=>{const x=JSON.parse(meetingAnswer({phase:'revision',role:'content'}));return JSON.stringify(pack===undefined?x:{...x,copyPack:pack})};
const parse=(text,packed)=>plain(meetings.parseMeetingStep(text,revisionStep('content'),[],true,[],{},packed).output);
check('without the flag the parser ignores a model pack (same output as before)',()=>{const o=parse(revisionText(goodPack),false);assert.deepEqual(Object.keys(o),['title','content','changes']);assert.deepEqual(o,plain(meetings.parseMeetingStep(revisionText(goodPack),revisionStep('content'),[]).output))});
const good=parse(revisionText(goodPack),true);
check('a profiled content revision keeps the pack and puts its rendering before the content',()=>{
 assert.deepEqual(good.copyPack,goodPack);assert.ok(!('copyPackIssues' in good));
 assert.ok(good.content.startsWith('### YouTube · 재방문 유도 · 목적지 매장')&&good.content.includes('#### 카피 안 C')&&good.content.includes('### 숏폼 장면표')&&good.content.includes('### 제안 실험'));
 assert.ok(good.content.endsWith(parse(revisionText(),false).content));
});
const two=parse(revisionText(twoVariants),true),none=parse(revisionText(),true);
check('pack format errors are soft: the revision parses and records copyPackIssues',()=>assert.ok(two.copyPack&&two.copyPackIssues.some(i=>i.code==='variants_too_few'&&i.level==='error')));
check('a profiled revision without a pack keeps the model content and records copy_pack_missing',()=>assert.ok(!('copyPack' in none)&&none.copyPackIssues.some(i=>i.code==='copy_pack_missing')&&none.content===parse(revisionText(),false).content));
check('withoutCopyPack drops only the pack fields and keeps key order',()=>{assert.deepEqual(Object.keys(meetings.withoutCopyPack(good)),['title','content','changes']);const o={title:'t',content:'c',changes:'x'};assert.deepEqual(plain(meetings.withoutCopyPack(o)),o)});

// 2) 운영 회의: 스위치 꺼짐 vs 켜짐(모델이 팩을 내지 않음) → 콘텐츠 개선 지시만 다르고 나머지 제출은 바이트 동일
const off='mcp-off',onSame='mcp-on-same',onPack='mcp-on-pack';
for(const owner of [off,onSame,onPack])await seed(server,sql,owner);
await setFlag(onSame,true);await setFlag(onPack,true);
packMode='none';
const offRun=await runMeeting(meetingExec,server,off,meetingCampaign,MID),sameRun=await runMeeting(meetingExec,server,onSame,meetingCampaign,MID);
const offSteps=byStep(offRun),sameSteps=byStep(sameRun);
const offArtifacts=await artifacts(off);
check('flag off: no output profile in the snapshot and no pack fields on saved artifacts',()=>{assert.ok(!('outputProfile' in offRun.meeting.snapshot));assert.ok(offArtifacts.every(a=>!('copyPack' in a)&&!('copyPackIssues' in a)&&!('copyPackArtifactVersion' in a)))});
check('flag off: no meeting instruction mentions the copy pack',()=>assert.ok(offRun.steps.every(s=>!s.instructions.includes('copy-pack-v2')&&!s.input.includes('copyPack'))));
check('flag on: the meeting snapshot fixes the copy pack profile',()=>assert.equal(sameRun.meeting.snapshot.outputProfile,'copy-pack-v2'));
check('flag on: the same steps run in the same order',()=>assert.deepEqual(plain(sameRun.steps.map(s=>s.step)),plain(offRun.steps.map(s=>s.step))));
for(const s of offRun.steps){
 const on=sameSteps[s.step];
 if(s.step==='revision:content')check('flag on: the content revision changes only its instructions (input identical)',()=>{assert.notEqual(on.instructions,s.instructions);assert.equal(on.input,s.input);assert.ok(on.instructions.includes(copyPack.copyPackSchema))});
 else check(`flag on: ${s.step} submission is byte-identical to flag off`,()=>{assert.equal(on.instructions,s.instructions);assert.equal(on.input,s.input)});
}
const sameArtifacts=await artifacts(onSame);
check('flag on without a model pack: the content revision artifact records copy_pack_missing (soft) and keeps the content',()=>{
 const a=sameArtifacts.find(x=>x.role==='content'&&x.meetingId===MID),b=offArtifacts.find(x=>x.role==='content'&&x.meetingId===MID);
 assert.ok(a&&!('copyPack' in a)&&a.copyPackIssues.some(i=>i.code==='copy_pack_missing'));assert.equal(a.content,b.content);assert.equal(a.version,b.version);
});
check('a missing pack leaves an event and the meeting still completes',()=>assert.ok(sameRun.meeting.status==='completed'&&events(onSame).some(t=>/회의 개선본 카피 팩에 형식 문제/.test(t))&&!events(off).some(t=>/카피 팩/.test(t))));

// 3) 켜짐 + 팩: 새 작업물 판에 팩을 묶고, 뒤 단계 입력에는 팩 필드 없이 렌더본만 간다
packMode='good';
const packRun=await runMeeting(meetingExec,server,onPack,meetingCampaign,MID),packSteps=byStep(packRun),packArtifacts=await artifacts(onPack);
const content=packArtifacts.find(a=>a.role==='content'&&a.meetingId===MID),growth=packArtifacts.find(a=>a.role==='growth'&&a.meetingId===MID);
check('the content revision artifact carries the pack bound to its new version',()=>{
 assert.equal(content.version,2);assert.equal(content.copyPackArtifactVersion,content.version);
 assert.deepEqual(plain(content.copyPack),goodPack);
 assert.ok(content.content.includes('#### 카피 안 A')&&content.content.includes(V3[2].hook));
});
check('brief channel coverage warnings are stored as warn-level issues only',()=>assert.ok(content.copyPackIssues.length>0&&content.copyPackIssues.every(i=>i.level==='warn'&&i.code==='brief_channel_missing')));
check('other revision artifacts have no pack fields',()=>assert.ok(growth&&!('copyPack' in growth)&&!('copyPackIssues' in growth)&&!('copyPackArtifactVersion' in growth)));
const qualityInput=JSON.parse(packSteps.quality.input),growthInput=JSON.parse(packSteps['revision:growth'].input);
check('later steps see the rendered pack in the revision content but no pack fields',()=>{
 for(const input of [qualityInput,growthInput]){const r=input.completedRevisions.find(x=>x.role==='content');assert.ok(r&&!('copyPack' in r)&&!('copyPackIssues' in r)&&r.content.includes('#### 카피 안 A'))}
 assert.ok(qualityInput.candidateArtifacts.every(a=>!('copyPack' in a)));
});
check('the stored meeting step output keeps the pack for replay',()=>assert.deepEqual(plain(packRun.meeting.steps.find(s=>s.id===`${MID}:revision:content`).output.copyPack),goodPack));

// 4) 형식 오류 팩: 작업물은 저장되고 error 문제와 이벤트가 남는다
const bad='mcp-on-bad';await seed(server,sql,bad);await setFlag(bad,true);packMode='two';
const badRun=await runMeeting(meetingExec,server,bad,meetingCampaign,MID),badContent=(await artifacts(bad)).find(a=>a.role==='content'&&a.meetingId===MID);
check('an invalid pack does not fail the meeting and the artifact records the error',()=>assert.ok(badRun.meeting.status==='completed'&&badContent.copyPackIssues.some(i=>i.level==='error'&&i.code==='variants_too_few')&&badContent.copyPackArtifactVersion===badContent.version));
check('an invalid pack leaves a campaign event',()=>assert.ok(events(bad).some(t=>/카피 팩에 형식 문제/.test(t)&&/1건/.test(t))));

// 5) 프로필은 회의 시작 때 고정: 시작 뒤 스위치를 켜도 그 회의는 팩을 쓰지 않는다
const late='mcp-late';await seed(server,sql,late);packMode='good';
await meetingExec.executeMeeting(late,{action:'start',id:MID,campaignId:meetingCampaign.id,campaignVersion:meetingCampaign.version,agenda:'합성 안건: 재방문 동기를 정리한다.'});
await setFlag(late,true);
let lateMeeting;for(let i=0;i<60;i++){lateMeeting=await (await meetingExec.executeMeeting(late,{action:'advance',id:MID})).json();if(lateMeeting.status!=='running')break}
const lateSubmission=JSON.parse((await server.readRecord(late,'hermes_submission',`${MID}:revision:content`)).body);
check('turning the flag on after start does not change that meeting',()=>assert.ok(lateMeeting.status==='completed'&&!lateSubmission.instructions.includes('copy-pack-v2')&&lateSubmission.instructions===offSteps['revision:content'].instructions));

// 6) 평가 동결: 프로필은 남고 팩 필드는 저장하지 않으며, 동결본 조립이 운영 제출과 바이트 동일하다
const record=await server.readRecord(onPack,'team_meeting',MID);
for(const target of ['revision:content','revision:growth','quality']){
 const frozen=freeze.freezeMeetingRequest(record,`${MID}:${target}`,[]),built=freeze.buildMeetingRequest(frozen),sent=packSteps[target];
 check(`frozen ${target} keeps the profile, drops pack fields and rebuilds the production submission`,()=>{
  assert.equal(frozen.meeting.snapshot.outputProfile,'copy-pack-v2');
  assert.ok(!JSON.stringify(frozen.meeting.steps).includes('"copyPack'));
  assert.equal(built.instructions,sent.instructions);assert.equal(built.input,sent.input);
 });
}
const offFrozen=freeze.freezeMeetingRequest(await server.readRecord(off,'team_meeting',MID),`${MID}:revision:content`,[]);
check('frozen flag-off meetings have no profile key',()=>assert.ok(!('outputProfile' in offFrozen.meeting.snapshot)&&freeze.buildMeetingRequest(offFrozen).instructions===offSteps['revision:content'].instructions));

// 7) 합성 v2 스펙 2건: 스키마 검사 통과, 모의 DB의 스위치·확정 말투로 outputProfile·brandVoice를 동결(네트워크 없음)
const generator={commit:'c'.repeat(40),tree:'d'.repeat(40)};
const SPECS={'syn-s9-fnb-insta':'Instagram','syn-s9-edu-reels':'릴스'},outputs={};
for(const [id,channel] of Object.entries(SPECS)){
 const spec=JSON.parse(readFileSync(`scripts/eval/specs/${id}.json`,'utf8'));
 check(`${id} passes the spec schema and is a dev content spec for ${channel}`,()=>{validateSpec(clone(spec));assert.ok(spec.set==='dev'&&spec.roles.join()==='content'&&spec.records.find(r=>r.kind==='campaign').data.channels.includes(channel))});
 const out=await synthesizeCases(clone(spec),{generator}),again=await synthesizeCases(clone(spec),{generator});outputs[id]=out;
 const kase=out.cases[0],build=kinds.evalKind('role').build(kase.request);
 check(`${id} generates one content case with the copy pack profile and the confirmed brand voice frozen`,()=>{
  assert.equal(out.cases.length,1);assert.equal(kase.role,'content');assert.equal(kase.request.outputProfile,'copy-pack-v2');
  const voice=spec.records.find(r=>r.kind==='brand_voice').data.confirmedVoice;
  assert.deepEqual(plain(kase.request.brandVoice.avoidTerms),voice.avoidTerms);assert.equal(kase.request.brandVoice.version,voice.version);
 });
 check(`${id} submission uses the v2 contract and the brand voice input`,()=>{assert.ok(build.instructions.includes('"role-output-v2"')&&build.instructions.includes(copyPack.copyPackSchema));assert.equal(JSON.parse(build.input).task.outputContract.version,'role-output-v2');assert.ok(JSON.parse(build.input).brandVoice)});
 check(`${id} generation is byte-identical twice`,()=>assert.equal(JSON.stringify(out),JSON.stringify(again)));
}
const fnb=JSON.parse(readFileSync('scripts/eval/specs/syn-s9-fnb-insta.json','utf8'));
const withoutFlags=await synthesizeCases({...clone(fnb),records:fnb.records.filter(r=>r.kind!=='feature_flag')},{generator});
check('without the flag records the same spec freezes no profile and no voice',()=>assert.ok(!('outputProfile' in withoutFlags.cases[0].request)&&!('brandVoice' in withoutFlags.cases[0].request)&&withoutFlags.cases[0].promptHash!==outputs['syn-s9-fnb-insta'].cases[0].promptHash));
const badFlag=(fn)=>assert.throws(()=>validateSpec({...clone(fnb),records:fn(clone(fnb.records))}),/기능 스위치 레코드/);
check('the spec schema rejects unknown flags and malformed flag records',()=>{
 badFlag(r=>r.map(x=>x.kind==='feature_flag'&&x.id==='a3_copy_pack'?{...x,id:'online_grading',data:{...x.data,flag:'online_grading'}}:x));
 badFlag(r=>r.map(x=>x.kind==='feature_flag'&&x.id==='a3_copy_pack'?{...x,data:{...x.data,enabled:'yes'}}:x));
 badFlag(r=>r.map(x=>x.kind==='feature_flag'&&x.id==='a3_copy_pack'?{...x,data:{...x.data,flag:'a3_brand_voice'}}:x));
});

// 8) 기대 계약: v2 요청 + v1 원문 → contract_json fail, v2 원문 → 기존대로, 프로필 없는 요청 → 판정 불변
const kase=outputs['syn-s9-fnb-insta'].cases[0],sections=[1,2,3,4].map(n=>({id:`output_${n}`,content:`섹션 ${n} 본문. 이 절은 선택 이유와 확인 계획을 적는다. 첫 방문 목표에 맞춰 점심 손님의 자리 걱정을 먼저 다룬다. [자료 필요] 점심 대기 시간은 점주가 확인한다. 확인 전에는 가격을 확정 문구로 쓰지 않는다.`}));
const rawV1=JSON.stringify({contractVersion:'role-output-v1',role:'content',sections}),rawV2=JSON.stringify({contractVersion:'role-output-v2',role:'content',sections,copyPack:{...goodPack,channels:[{...goodPack.channels[0],channel:'Instagram 피드'}],experiments:[{...goodPack.experiments[0],channel:'Instagram 피드'}]}});
const caseOf=request=>({id:kase.id||'k',role:'content',request,expectations:kase.expectations});
const rows=(request,raw)=>Object.fromEntries(plain(kinds.evalKind('role').grade(caseOf(request),raw,1000).result.graders).map(g=>[g.id,g]));
const unprofiledRequest=Object.fromEntries(Object.entries(kase.request).filter(([k])=>k!=='outputProfile'));
const v2v1=rows(kase.request,rawV1),v2v2=rows(kase.request,rawV2),nov1=rows(unprofiledRequest,rawV1),nov2=rows(unprofiledRequest,rawV2);
check('a v2 request answered with a v1 raw fails contract_json with the runtime message',()=>assert.ok(v2v1.contract_json.status==='fail'&&/계약 버전이 일치하지 않습니다/.test(v2v1.contract_json.detail),JSON.stringify(v2v1.contract_json)));
check('a v2 request answered with a v2 raw passes contract_json and the pack grader as before',()=>assert.ok(v2v2.contract_json.status==='pass'&&v2v2.copy_pack_variants.status==='pass',JSON.stringify([v2v2.contract_json,v2v2.copy_pack_variants])));
check('without a profile the verdicts are unchanged (v1 raw passes, v2 raw read by its own version)',()=>{assert.equal(nov1.contract_json.status,'pass');assert.equal(nov2.contract_json.status,'pass');assert.deepEqual(nov1,Object.fromEntries(plain(graders.runGraders({id:kase.id||'k',kind:'role',role:'content',raw:rawV1,contract:true,inputTokens:1000},{prohibitedTerms:kase.expectations.prohibitedTerms,facts:kase.expectations.facts,industry:kase.expectations.industry,localStore:kase.expectations.localStore,brandVoice:{avoidTerms:[...kase.request.brandVoice.avoidTerms]}})).map(g=>[g.id,g])))});
check('only contract_json changes between the v2 and unprofiled request for a v1 raw',()=>assert.deepEqual(Object.keys(v2v1).filter(k=>JSON.stringify(v2v1[k])!==JSON.stringify(nov1[k])),['contract_json']));
check('the profile does not change a non-content role verdict',()=>{const r=(request)=>plain(kinds.evalKind('role').grade({id:'g',role:'growth',request,expectations:kase.expectations},JSON.stringify({contractVersion:'role-output-v1',role:'growth',sections}),1000).result.graders);assert.deepEqual(r({...unprofiledRequest,role:'growth',outputProfile:'copy-pack-v2'}),r({...unprofiledRequest,role:'growth'}))});
check('the grading version carries the expected-contract tag',()=>assert.ok(graders.GRADERS_VERSION.endsWith('+voice-avoid+expected-contract')));
check('no external network call',()=>assert.deepEqual(plain(external),[]));
console.log(JSON.stringify({passed:passed.length}));
