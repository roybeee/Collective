// 입력 축소 on/off 쌍 평가(성장1 C07, 레인 Q 연결): POST /api/eval start_run pair:{kind:'input_diet'}.
// 같은 run·같은 게이트웨이 스냅샷에서 케이스마다 active(동결 요청을 inputDiet false로 조립 = 지금 평가 기본 조립)와 candidate(inputDiet true로 조립)를 번갈아 제출하고
// 기존 pairGate로 판정한다. 대상은 조립 함수가 inputDiet를 받는 역할·회의 단계·브리프이고 바이럴 사례 분석은 빠진다(없으면 400). 이 run은 프롬프트 활성화 근거가 아니다(409).
// 캡처 드리프트: 원 기록이 가진 스위치 상태(회의 snapshot.inputDiet, 브리프 초안 inputDiet 요약)로 다시 조립해 비교한다. 켜진 워크스페이스에서 오경보가 없고, 꺼진 기록은 판정이 같다.
// 근거: mocked(운영·평가 HERMES·raw.githubusercontent.com fetch 스텁, 메모리 SQLite, 실제 app/api/eval·app/api/prompts 라우트, 합성 데이터). 외부 네트워크 호출은 0회다.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {testRuntime} from './helpers/runtime.mjs';
import {roleFixture} from './helpers/role-fixture.mjs';
import {seed,mockHermes,runMeeting,meetingAnswer,roleCampaign,meetingCampaign,brand,now,rawGithub} from './helpers/prompt-seed.mjs';

const EVAL='https://eval-hermes.example.com';
const capabilities={object:'hermes.api_server.capabilities',platform:'hermes-agent',features:{run_submission:true,run_status:true,run_stop:true,runs_idempotency:{durable:true,enabled:true,supported:true}}};
const BRIEF_OUTPUT=JSON.stringify({summary:'합성 요약: 첫 방문 고객의 재방문 동기를 한 가지로 좁혀 시험한다.',suggestions:['kpi','hypothesis','experiment','tracking','decision'].map(field=>({field,value:`합성 ${field}: 다음 메뉴 안내 카드 회수율을 주간 기록으로 본다.`,reason:'합성 근거'})),questions:[{field:'budget',question:'예산 상한을 알려 주세요.',why:'집행 범위'}],assumptions:['합성 가정: 고객 반응은 미측정이다.']});
const evalAnswer=body=>{const input=JSON.parse(body.input);return input.phase?meetingAnswer(input):input.currentBrief?BRIEF_OUTPUT:roleFixture(body.input)};
const evalRuns=new Map(),evalSubmits=[];let evalSeq=0;
async function evalHandler(url,options={}){
 if(!url.startsWith(EVAL+'/'))return undefined;
 const path=url.slice(EVAL.length),headers=new Headers(options.headers||{}),method=options.method||'GET';
 if(!headers.get('authorization'))return new Response('{}',{status:401});
 if(path==='/v1/capabilities')return Response.json(capabilities);
 if(path==='/v1/models')return Response.json({data:[{id:'mock-eval-model'}]});
 if(path==='/v1/toolsets')return Response.json({toolsets:[{name:'web'}]});
 if(path==='/v1/runs'&&method==='POST'){const id='idp_'+ ++evalSeq,sent=JSON.parse(options.body);evalRuns.set(id,sent);evalSubmits.push({id,sent});return Response.json({run_id:id})}
 const id=/^\/v1\/runs\/([\w-]+)$/.exec(path)?.[1],sent=evalRuns.get(id);if(!sent)return new Response('{}',{status:404});
 return Response.json({object:'hermes.run',run_id:id,status:'completed',output:evalAnswer(sent),usage:{input_tokens:1000,output_tokens:500,total_tokens:1500},model:'mock-eval-model'});
}
const raw=rawGithub(),hermes=mockHermes(async(url,options)=>await raw.handler(url)??await evalHandler(url,options));
const {sql,env,load}=testRuntime(hermes.fetch);
const server=await load('lib/server.ts'),evalRoute=await load('app/api/eval/route.ts'),promptRoute=await load('app/api/prompts/route.ts'),background=await load('lib/background-execution.ts');
const execution=await load('lib/role-execution.ts'),meeting=await load('lib/meeting-execution.ts'),briefExec=await load('lib/brief-execution.ts'),flags=await load('lib/feature-flags.ts');
const kinds=await load('lib/eval-kinds.ts'),freeze=await load('lib/eval-freeze.ts'),meetingInput=await load('lib/meeting-input.ts'),briefInput=await load('lib/brief-input.ts'),diet=await load('lib/input-diet.ts'),stats=await load('lib/eval-stats.ts');
const owner='idp-owner',by={id:'idp-boss',email:null},passed=[];
const check=(name,fn)=>{fn();passed.push(name)};
const plain=value=>JSON.parse(JSON.stringify(value));
const call=async res=>({status:res.status,body:await res.json()});
const request=(path,input,user,extra)=>new Request('https://agency.test'+path,{method:'POST',headers:{'oai-authenticated-user-id':user,'content-type':'application/json',...extra},body:JSON.stringify(input)});
const evalPost=(input,user=owner,extra={})=>evalRoute.POST(request('/api/eval',input,user,extra)).then(call);
const evalGet=(query='',user=owner,extra={})=>evalRoute.GET(new Request('https://agency.test/api/eval'+query,{headers:{'oai-authenticated-user-id':user,...extra}})).then(call);
const prompts=(input,user=owner)=>promptRoute.POST(request('/api/prompts',input,user,{})).then(call);
const runCount=()=>sql.prepare("SELECT COUNT(*) n FROM records WHERE owner=? AND kind='eval_run'").get(owner).n;
const runOf=async id=>(await evalGet('?run='+encodeURIComponent(id))).body;
async function drive(id,max=60){for(let i=0;i<max;i++){const run=await runOf(id);if(!['queued','running'].includes(run.status))return run;await background.advanceBackgroundWork(owner)}return runOf(id)}
const submitted=res=>evalSubmits.find(s=>s.id===res.providerRunId);
const sideOf=(run,caseId,variant)=>run.results.find(x=>x.caseId===caseId&&x.variant===variant);
const setDiet=enabled=>flags.setFeatureFlag(owner,{flag:'input_diet',enabled},by);
const put=await seed(server,sql,owner);
const EXPECT={inputTokenCap:20000};
// 브랜드 자료(확정 5건, 긴 본문)와 채널 관찰 1건: 켜짐 조립이 요약·역할별 카테고리를 적용할 거리를 만든다(브리프는 이것이 유일한 축소 대상이다).
const source=(id,category,content)=>({id,brandId:brand.id,title:'합성 자료 '+id,category,origin:'research',status:'confirmed',url:'https://example.com/'+id,content,scope:'합성 범위',observedAt:now,createdAt:now,version:1});
for(const [i,cat] of ['brand','market','channel','performance','customer'].entries())await put('brand_source','idp-'+cat,source('idp-'+cat,cat,`idp ${cat} 확인 자료 문장입니다. `.repeat(40+i*20)),brand.id);
await put('brand_observation','idp-obs',{id:'idp-obs',brandId:brand.id,channel:'Instagram',account:'합성 계정',periodStart:'2025-12-01',periodEnd:'2025-12-31',observedAt:now,source:'합성 내보내기',definition:'합성 정의',scope:'organic',method:'export',values:{reach:120,impressions:300},version:1,createdAt:now},brand.id);
await put('brand_archive_state',brand.id,{id:brand.id,revision:1,updatedAt:now},brand.id);
let r=await evalPost({action:'save_connection',endpoint:EVAL,key:'eval-only',isolationConfirmed:true,note:'합성 평가 프로필'});
check('eval connection is ready',()=>assert.equal(r.body.status,'ready',JSON.stringify(r)));
const capture=async input=>{const res=await evalPost({action:'capture_case',expectations:EXPECT,...input});assert.equal(res.status,200,JSON.stringify(res).slice(0,600));return res.body};
const briefData={brandId:brand.id,title:'가상분식 입력 축소 쌍 초안',goal:'첫 방문 고객의 재방문을 만든다.',audience:'가상동 주민(가설)',channels:'YouTube',stores:'가상동 12',products:'떡볶이(가격 미확정)',budget:null,startDate:'',endDate:'',constraints:'',sources:''};
const runBrief=async id=>{await briefExec.executeBrief(owner,{action:'start',id,data:briefData});await briefExec.executeBrief(owner,{action:'poll',id});return server.readRecord(owner,'brief_draft',id)};

// ════ 1) 캡처 드리프트: 켜진 워크스페이스의 회의·브리프 기록은 원 기록의 스위치 상태로 다시 조립해 identical이다 ════
await setDiet(true);
const onMeeting=(await runMeeting(meeting,server,owner,meetingCampaign,'idp-meeting-on')).meeting;
check('the switch-on meeting fixes inputDiet in its snapshot',()=>assert.equal(onMeeting.snapshot.inputDiet,diet.INPUT_DIET_VERSION));
const onSteps=new Map();
for(const s of onMeeting.steps)onSteps.set(s.id,await capture({kind:'meeting_step',meetingId:onMeeting.id,stepId:s.id,...(s.phase==='quality'?{set:'sealed'}:{})}));
check('switch-on meeting: every step capture is identical to the stored submission (no assembly_drift)',()=>assert.ok([...onSteps.values()].every(c=>c.captureCheck.submission==='identical'),JSON.stringify([...onSteps.values()].map(c=>c.captureCheck))));
check('switch-on meeting: the frozen request rebuilt with the recorded state equals the production assembly (frozenIdentical)',()=>assert.ok([...onSteps.values()].every(c=>c.captureCheck.frozenIdentical===true)));
check('switch-on meeting: the case records the capture-time state (capturedWith.inputDiet true) and the frozen snapshot has no switch key',()=>assert.ok([...onSteps.values()].every(c=>c.capturedWith.inputDiet===true&&!('inputDiet' in c.request.meeting.snapshot))));
const onBriefDraft=await runBrief('idp-brief-on');
check('the switch-on brief draft carries the diet report',()=>assert.equal(onBriefDraft.inputDiet?.version,diet.INPUT_DIET_VERSION));
const briefCase=await capture({kind:'brief',briefDraftId:'idp-brief-on'});
check('switch-on brief: capture is identical and frozenIdentical, state recorded',()=>assert.ok(briefCase.captureCheck.submission==='identical'&&briefCase.captureCheck.frozenIdentical===true&&briefCase.capturedWith.inputDiet===true,JSON.stringify(briefCase.captureCheck)));
// 역할 캡처는 원 제출이 아니라 지금 DB로 요청을 만든다. 동결 요청에는 스위치 키가 없고, 캡처 때 워크스페이스 상태만 케이스에 남긴다.
const devCase=await capture({campaignId:roleCampaign.id,role:'cmo',label:'dev cmo'}),sealedCase=await capture({campaignId:roleCampaign.id,role:'cmo',set:'sealed',label:'sealed cmo'});
check('role capture records the workspace state and freezes no switch key in the request',()=>assert.ok(devCase.capturedWith.inputDiet===true&&!('inputDiet' in devCase.request)&&devCase.capturedWith.skillVersion&&devCase.capturedWith.outputContractVersion));
// 꺼진 때 만든 기록은 스위치를 켠 뒤 캡처해도 꺼짐으로 다시 조립한다(현재 워크스페이스 상태로 판정하지 않는다).
await setDiet(false);
const offMeeting=(await runMeeting(meeting,server,owner,meetingCampaign,'idp-meeting-off')).meeting;
await briefExec.executeBrief(owner,{action:'start',id:'idp-brief-off',data:briefData});
await setDiet(true);
const offSteps=[];for(const s of offMeeting.steps)offSteps.push(await capture({kind:'meeting_step',meetingId:offMeeting.id,stepId:s.id}));
const offBrief=await capture({kind:'brief',briefDraftId:'idp-brief-off'});
check('switch-off records captured while the workspace is on stay identical (recorded state wins)',()=>assert.ok(!('inputDiet' in offMeeting.snapshot)&&offSteps.every(c=>c.captureCheck.submission==='identical'&&c.captureCheck.frozenIdentical===true&&c.capturedWith.inputDiet===false)&&offBrief.captureCheck.submission==='identical'&&offBrief.capturedWith.inputDiet===false,JSON.stringify([...offSteps.map(c=>c.captureCheck),offBrief.captureCheck])));
const manual=await evalPost({action:'save_case',kind:'brief',request:briefCase.request,label:'수동 브리프'});
check('a manual case records no capture-time state',()=>assert.ok(manual.status===200&&!('inputDiet' in manual.body.capturedWith),JSON.stringify(manual.body.capturedWith)));
await setDiet(false);

// ════ 2) 종류 처리기 조립(lib/eval-kinds.ts build): off 쪽 = 인자 없는 기본 조립(바이트), on 쪽 = inputDiet true 조립, 지시문 동일 ════
const quality=onSteps.get(onMeeting.id+':quality'),discussion=[...onSteps.values()][0];
const OFF={inputDiet:'off'},ON={inputDiet:'on'};
const roleKind=kinds.evalKind('role'),meetingKind=kinds.evalKind('meeting_step'),briefKind=kinds.evalKind('brief');
const same=(a,b)=>a.instructions===b.instructions&&a.input===b.input;
const roleOff=roleKind.build(devCase.request,OFF),roleOn=roleKind.build(devCase.request,ON);
check('role: off side equals the default evaluation build and roleSubmission without options (byte)',()=>assert.ok(same(roleOff,roleKind.build(devCase.request))&&same(roleOff,execution.roleSubmission(devCase.request))));
check('role: on side equals roleSubmission with inputDiet true; instructions identical, only the input shrinks',()=>{const want=execution.roleSubmission(devCase.request,{inputDiet:true}),a=JSON.parse(roleOff.input),b=JSON.parse(roleOn.input);assert.ok(same(roleOn,want)&&roleOn.instructions===roleOff.instructions&&roleOn.input.length<roleOff.input.length&&'deliverable' in a.task&&!('deliverable' in b.task)&&JSON.stringify(a.evidence)===JSON.stringify(b.evidence)&&a.factPolicy===b.factPolicy)});
const qOff=meetingKind.build(quality.request,OFF),qOn=meetingKind.build(quality.request,ON),q=quality.request;
check('meeting: off side equals buildMeetingRequest (current evaluation build, byte)',()=>assert.ok(same(qOff,meetingKind.build(q))&&same(qOff,freeze.buildMeetingRequest(q))));
check('meeting: on side equals buildMeetingSubmission with inputDiet true; instructions identical, input shorter',()=>{const want=meetingInput.buildMeetingSubmission(q.meeting,q.stepId,q.storeAllow,{inputDiet:true});assert.ok(qOn.instructions===want.instructions&&qOn.input===want.input&&qOn.instructions===qOff.instructions&&qOn.input.length<qOff.input.length)});
const bOff=briefKind.build(briefCase.request,OFF),bOn=briefKind.build(briefCase.request,ON);
check('brief: off side equals the default build (byte), on side equals buildBriefSubmission with inputDiet true',()=>{const want=briefInput.buildBriefSubmission(briefCase.request,{inputDiet:true});assert.ok(same(bOff,briefKind.build(briefCase.request))&&bOn.instructions===want.instructions&&bOn.input===want.input&&bOn.instructions===bOff.instructions&&bOn.input.length<bOff.input.length&&JSON.stringify(JSON.parse(bOn.input).evidence)===JSON.stringify(JSON.parse(bOff.input).evidence))});
check('brief: prompt pair sides are still refused (no registry unit)',()=>assert.throws(()=>briefKind.build(briefCase.request,null)));
check('viral_analysis refuses an input diet side',()=>assert.throws(()=>kinds.evalKind('viral_analysis').build({brand:{},case:{},observations:[]},ON),/입력 축소/));
check('pair helpers: fixed pair meta and target kinds (role, meeting_step, brief)',()=>assert.ok(JSON.stringify(kinds.INPUT_DIET_PAIR)===JSON.stringify({kind:'input_diet',unit:'input_diet',activeVersionId:'off',candidateVersionId:diet.INPUT_DIET_VERSION})&&JSON.stringify(kinds.INPUT_DIET_PAIR_KINDS)==='["role","meeting_step","brief"]'&&kinds.isInputDietPair({kind:'input_diet'})&&!kinds.isInputDietPair({kind:'operator_preferences'})&&!kinds.isInputDietPair(null)));

// ════ 3) 시작 거부(400): 대상 케이스 없음(바이럴만)·kind 밖 키. run 기록과 제출이 없다 ════
const shell=(id,kind,role)=>({id,kind,role,label:id,set:'dev',request:{},expectations:{prohibitedTerms:[],facts:null,industry:null,localStore:false},campaignId:null,source:'manual',capturedWith:{skillVersion:'x',outputContractVersion:'x'},createdBy:{id:owner,email:null},createdAt:now,updatedAt:now});
await put('eval_case','idp-viral-case',shell('idp-viral-case','viral_analysis','viral_analysis'));
const startDiet=(caseIds,extra={})=>evalPost({action:'start_run',pair:{kind:'input_diet'},caseIds,tokenBudget:250000,label:'C07 입력 축소 on/off',...extra});
const runsBefore=runCount(),submitsBefore=evalSubmits.length;
r=await startDiet(['idp-viral-case']);
check('only viral_analysis cases is 400',()=>assert.ok(r.status===400&&/바이럴/.test(r.body.error)&&/역할·회의 단계·브리프/.test(r.body.error),JSON.stringify(r)));
r=await evalPost({action:'start_run',pair:{kind:'input_diet',unit:'role.cmo',candidateVersionId:'role.cmo@x'},caseIds:[devCase.id,sealedCase.id],tokenBudget:250000});
check('extra pair keys besides kind are 400',()=>assert.ok(r.status===400&&/kind만/.test(r.body.error),JSON.stringify(r)));
check('rejected starts record no run and submit nothing',()=>assert.ok(runCount()===runsBefore&&evalSubmits.length===submitsBefore));

// ════ 4) 본 run: 역할 dev·sealed, 회의 발언·품질 재검토(sealed), 브리프. 바이럴은 skippedCases ════
const caseIds=[devCase.id,sealedCase.id,discussion.id,quality.id,briefCase.id,'idp-viral-case'];
r=await startDiet(caseIds);
check('an input diet pair run starts (200)',()=>assert.equal(r.status,200,JSON.stringify(r).slice(0,400)));
const P=await drive(r.body.id),kept=caseIds.slice(0,5);
check('run meta freezes kind, unit, off/on ids and skipped cases',()=>assert.ok(P.variant==='pair'&&JSON.stringify(P.pair)===JSON.stringify({kind:'input_diet',unit:'input_diet',activeVersionId:'off',candidateVersionId:diet.INPUT_DIET_VERSION,skippedCases:1}),JSON.stringify(P.pair)));
check('the viral case is skipped; the others run both sides, alternating, all completed',()=>assert.ok(JSON.stringify(P.caseIds)===JSON.stringify(kept)&&P.status==='completed'&&P.results.length===10&&P.results.every(x=>x.status==='completed')&&JSON.stringify(P.results.slice(0,4).map(x=>x.variant))==='["active","candidate","candidate","active"]',JSON.stringify(P.results.map(x=>[x.variant,x.status,x.error]))));
const byId=new Map([[devCase.id,devCase],[sealedCase.id,sealedCase],[discussion.id,discussion],[quality.id,quality],[briefCase.id,briefCase]]);
check('every active side is the default evaluation build of the frozen request (byte)',()=>assert.ok(kept.every(id=>{const k=byId.get(id),s=submitted(sideOf(P,id,'active')).sent,want=kinds.evalKind(k.kind).build(k.request);return s.instructions===want.instructions&&s.input===want.input})));
check('every candidate side is the inputDiet true build; instructions equal the active side and the input is shorter',()=>assert.ok(kept.every(id=>{const k=byId.get(id),a=submitted(sideOf(P,id,'active')).sent,b=submitted(sideOf(P,id,'candidate')).sent,want=kinds.evalKind(k.kind).build(k.request,ON);return b.instructions===want.instructions&&b.input===want.input&&b.instructions===a.instructions&&b.input.length<a.input.length})));
check('each side has its own idempotency key',()=>assert.ok(new Set(P.results.map(x=>x.idempotencyKey)).size===10&&P.results.every(x=>x.idempotencyKey==='collective-eval-'+createHash('sha256').update(`${P.id}:${x.caseId}:${x.variant}`).digest('hex').slice(0,40))));

// ════ 5) 게이트 조회(GET ?pair=): 기존 pairGate 그대로, 입력 축소 메타 ════
r=await evalGet('?pair='+P.id);
check('pair read returns the unchanged pairGate and the input diet meta',()=>assert.ok(r.status===200&&JSON.stringify(r.body.gate)===JSON.stringify(plain(stats.pairGate(P)))&&JSON.stringify(r.body.pair)===JSON.stringify({kind:'input_diet',unit:'input_diet',activeVersionId:'off',candidateVersionId:diet.INPUT_DIET_VERSION,skippedCases:1}),JSON.stringify(r.body.pair)));
// 브리프 input_budget은 채점기 설계상 not_applicable(대상 여부 결정 전)이라 브리프가 섞인 run은 기존 게이트의 input_budget 조건 하나로 막힌다(게이트 규칙은 바꾸지 않는다).
check('with a brief case the unchanged gate refuses only on input_budget (brief input_budget is not_applicable)',()=>assert.ok(r.body.gate.ok===false&&JSON.stringify(r.body.gate.reasons.map(x=>x.code))==='["input_budget"]'&&r.body.gate.inputBudget.pass===4&&r.body.gate.inputBudget.total===5&&r.body.gate.sealedCases===2&&r.body.gate.sealedRegressions.length===0,JSON.stringify(r.body.gate.reasons)));
r=await startDiet(caseIds.slice(0,4));
const G=await drive(r.body.id),gateRead=(await evalGet('?pair='+G.id)).body;
check('a role and meeting step pair passes the unchanged gate (sealed 2, no regression, same gateway and model)',()=>assert.ok(G.status==='completed'&&G.pair.skippedCases===0&&gateRead.gate.ok===true&&gateRead.gate.sealedCases===2&&gateRead.gate.inputBudget.pass===4&&JSON.stringify(gateRead.gate)===JSON.stringify(plain(stats.pairGate(G))),JSON.stringify(gateRead.gate.reasons)));
const listed=(await evalGet('')).body.runs.find(x=>x.id===P.id);
check('the run list shows the same pair meta',()=>assert.ok(listed&&listed.pair.kind==='input_diet'&&listed.pair.skippedCases===1));

// ════ 6) 평가 active 기본 run의 제출 바이트는 그대로다(쌍의 off 쪽과 같다) ════
r=await evalPost({action:'start_run',caseIds:kept,tokenBudget:250000,label:'기본 active'});
const A=await drive(r.body.id);
check('an active run submits the default build for every kind, byte-equal to the pair off side',()=>assert.ok(A.status==='completed'&&!A.pair&&kept.every(id=>{const s=submitted(A.results.find(x=>x.caseId===id)).sent,off=submitted(sideOf(P,id,'active')).sent;return s.instructions===off.instructions&&s.input===off.input})));

// ════ 7) 프롬프트 활성화 게이트에 쓰지 못한다(pairGate가 통과한 run G여도) ════
const ref=createHash('sha1').update('idp-ref').digest('hex'),cmoBody={...raw.repoBody('role.cmo'),focus:'합성 초점: 평일 저녁 상황을 먼저 적는다'};
raw.publishRepo(ref);raw.publish(ref,'role.cmo',cmoBody);raw.publishRepo('main');raw.publish('main','role.cmo',cmoBody);
const registered=await prompts({action:'register',unit:'role.cmo',sourceSha:ref});
check('a prompt version is registered for the gate check',()=>assert.equal(registered.status,200,JSON.stringify(registered)));
for(const action of ['activate','stage']){
 r=await prompts({action,unit:'role.cmo',versionId:registered.body.version.id,evalRunId:G.id,approval:{reason:'합성 승인'},...(action==='stage'?{campaignIds:[roleCampaign.id]}:{})});
 check(`an input diet pair run cannot pass a prompt activation gate (${action} 409)`,()=>assert.ok(r.status===409&&/입력 축소 쌍 평가/.test(r.body.error)&&!/이 단위·버전/.test(r.body.error),JSON.stringify(r.body)));
}
r=await prompts({action:'activate',unit:'role.cmo',versionId:registered.body.version.id,evalRunIds:[G.id,P.id],approval:{reason:'합성 승인'}});
check('an input diet run inside repeated evalRunIds is also 409',()=>assert.ok(r.status===409&&/입력 축소 쌍 평가/.test(r.body.error),JSON.stringify(r.body)));
check('refused activations change no pointer',()=>assert.equal(sql.prepare("SELECT COUNT(*) n FROM records WHERE kind='prompt_release'").get().n,0));

// ════ 8) 권한: 소유자만. 관리자·직원 403, 비로그인 401 ════
env.AUTH_MODE='email';env.AUTH_ORIGIN='https://agency.test';
const signIn=(id,role,createdAt)=>{const token=createHash('sha256').update(id).digest('hex');sql.prepare('INSERT INTO auth_users(id,email,workspace_owner,role,status,created_at) VALUES(?,?,?,?,?,?)').run(id,id+'@test.invalid',owner,role,'active',createdAt);sql.prepare('INSERT INTO auth_sessions VALUES(?,?,?,?)').run(createHash('sha256').update(token).digest('hex'),id,Date.now()+60000,Date.now());return {cookie:'__Host-collective_session='+token,origin:'https://agency.test'}};
signIn('idp-ws-owner','admin',1000);const adminS=signIn('idp-ws-admin','admin',2000),memberS=signIn('idp-ws-member','member',500);
const before=runCount(),input={action:'start_run',pair:{kind:'input_diet'},caseIds:[devCase.id,sealedCase.id],tokenBudget:250000};
const [anon,admin,member]=await Promise.all([evalPost(input,owner,{origin:'https://agency.test'}),evalPost(input,owner,adminS),evalPost(input,owner,memberS)]);
check('start_run input diet pair: anonymous 401, admin and member 403',()=>assert.ok(anon.status===401&&admin.status===403&&member.status===403&&runCount()===before,JSON.stringify([anon.status,admin.status,member.status])));
const [anonRead,adminRead,memberRead]=await Promise.all([evalGet('?pair='+P.id,owner,{}),evalGet('?pair='+P.id,owner,{cookie:adminS.cookie}),evalGet('?pair='+P.id,owner,{cookie:memberS.cookie})]);
check('pair read: anonymous 401, admin and member 403',()=>assert.ok(anonRead.status===401&&adminRead.status===403&&memberRead.status===403));
check('no external network call (all HERMES and GitHub raw are mocked)',()=>assert.deepEqual(hermes.external,[]));
console.log(JSON.stringify({passed:passed.length}));
