// 회의 단계·브리프 평가 종류(G2): 운영 기록 캡처(가림 뒤 동결)·직접 저장·실행·채점·쌍 평가 대상.
// 수용: 두 번 가린 결과 = 한 번 가린 결과(동결본으로 만든 제출이 운영 제출과 바이트 동일), 저장 케이스에 가릴 값·실행 메타가 없다,
// 드리프트 판정은 첫 제출(attempt 0)의 지시문·입력만 비교하고 사유(identical·code_changed·store_allow_changed·assembly_drift·no_submission·context_changed)를 나눈다,
// 회의 단계 예약 100,000, 발언은 discussion·나머지는 meeting_step 채점기(G3), 브리프는 쌍 평가에서 빠진다.
// 근거: mocked(운영·평가 HERMES fetch 스텁, 메모리 SQLite, 합성 브랜드·캠페인·회의). 외부 네트워크 호출은 0회다.
import assert from 'node:assert/strict';
import {testRuntime} from './helpers/runtime.mjs';
import {seed,mockHermes,meetingCampaign,roleCampaign,brand,now,meetingAnswer} from './helpers/prompt-seed.mjs';
import {roleFixture} from './helpers/role-fixture.mjs';

const EVAL='https://eval-hermes.example.com';
const capabilities={object:'hermes.api_server.capabilities',platform:'hermes-agent',features:{run_submission:true,run_status:true,run_stop:true,runs_idempotency:{durable:true,enabled:true,supported:true}}};
// 합성 브리프 초안 응답(parseBrief 필수 항목: summary·suggestions(kpi·hypothesis·experiment·tracking·decision)·questions·assumptions).
const BRIEF_OUTPUT=JSON.stringify({summary:'합성 요약: 첫 방문 고객의 재방문 동기를 한 가지로 좁혀 시험한다.',suggestions:['kpi','hypothesis','experiment','tracking','decision'].map(field=>({field,value:`합성 ${field}: 다음 메뉴 안내 카드 회수율을 주간 기록으로 본다.`,reason:'합성 근거'})),questions:[{field:'budget',question:'예산 상한을 알려 주세요.',why:'집행 범위'}],assumptions:['합성 가정: 고객 반응은 미측정이다.']});
const evalBodies=new Map();let evalSeq=0;
function evalAnswer(body){const input=JSON.parse(body.input);return input.phase?meetingAnswer(input):input.currentBrief?BRIEF_OUTPUT:roleFixture(body.input)}
// 교정 재시도: 운영 회의에서 전략 담당 첫 발언 응답 하나만 양식 없는 텍스트로 돌려 invalid_output → retry_failed(correction) 경로를 지난다.
let failOnce=true;
const hermes=mockHermes(async(url,options={})=>{
 if(url.startsWith(EVAL+'/')){
  const path=url.slice(EVAL.length),method=options.method||'GET',headers=new Headers(options.headers||{});
  if(!headers.get('authorization'))return new Response('{}',{status:401});
  if(path==='/v1/capabilities')return Response.json(capabilities);
  if(path==='/v1/models')return Response.json({data:[{id:'mock-eval-model'}]});
  if(path==='/v1/runs'&&method==='POST'){const id='g2eval_'+ ++evalSeq;evalBodies.set(id,JSON.parse(options.body));return Response.json({run_id:id})}
  const id=/^\/v1\/runs\/([\w-]+)$/.exec(path)?.[1];if(!id||!evalBodies.has(id))return new Response('{}',{status:404});
  return Response.json({object:'hermes.run',run_id:id,status:'completed',output:evalAnswer(evalBodies.get(id)),usage:{input_tokens:1000,output_tokens:500,total_tokens:1500},model:'mock-eval-model'});
 }
 if(!failOnce||!url.startsWith('https://hermes.example.com/v1/runs/'))return undefined;
 const id=url.split('/').pop(),input=JSON.parse(JSON.parse(hermes.bodies.get(id)).input);
 if(input.phase!=='discussion'||input.role!=='strategy')return undefined;
 failOnce=false;return Response.json({object:'hermes.run',run_id:id,status:'completed',output:'합성 응답: 회의 양식이 없는 텍스트',usage:{total_tokens:100,output_tokens:10},model:'mock-model'});
});
// 브리프 기준일(stamp)을 고정한다: 이 런타임 안의 Date만 고정 시각에서 흐른다.
const RealDate=Date,started=RealDate.now(),pinned=RealDate.parse('2026-03-15T09:00:00.000Z'),clock=()=>pinned+RealDate.now()-started;
class PinnedDate extends RealDate{constructor(...a){super(...(a.length?a:[clock()]))}static now(){return clock()}}
globalThis.Date=PinnedDate;let runtime;try{runtime=testRuntime(hermes.fetch)}finally{globalThis.Date=RealDate}
const {sql,load}=runtime;
const server=await load('lib/server.ts'),meeting=await load('lib/meeting-execution.ts'),brief=await load('lib/brief-execution.ts'),route=await load('app/api/eval/route.ts'),background=await load('lib/background-execution.ts');
const freeze=await load('lib/eval-freeze.ts'),kinds=await load('lib/eval-kinds.ts'),meetingInput=await load('lib/meeting-input.ts'),briefInput=await load('lib/brief-input.ts'),registry=await load('lib/prompt-registry.ts'),practice=await load('lib/practice.ts');
const owner='g2-owner',passed=[];
const check=(name,fn)=>{fn();passed.push(name)};
const plain=x=>JSON.parse(JSON.stringify(x));
const call=async res=>({status:res.status,body:await res.json()});
const post=input=>route.POST(new Request('https://agency.test/api/eval',{method:'POST',headers:{'oai-authenticated-user-id':owner,'content-type':'application/json'},body:JSON.stringify(input)})).then(call);
const get=query=>route.GET(new Request('https://agency.test/api/eval'+query,{headers:{'oai-authenticated-user-id':owner}})).then(call);
const caseRow=id=>sql.prepare("SELECT data FROM records WHERE owner=? AND kind='eval_case' AND id=?").get(owner,`${owner}:eval_case:${id}`).data;
const caseCount=()=>sql.prepare("SELECT COUNT(*) n FROM records WHERE owner=? AND kind='eval_case'").get(owner).n;
const put=await seed(server,sql,owner);
// 가릴 값(합성): 안건·캠페인 조건의 연락처, 작업물 본문의 이메일, 담당자 실명. 운영도 가리는 자리다.
const PHONE_AGENDA='010-2345-6789',PHONE_CAMPAIGN='010-3456-7890',EMAIL='owner.synthetic@example.com',OWNER_NAME='김가상';
await put('campaign',meetingCampaign.id,{...meetingCampaign,constraints:`할인 약속 금지. 문의 ${PHONE_CAMPAIGN}(합성).`,plan:{owner:OWNER_NAME}});
const insight=sql.prepare("SELECT id,data FROM records WHERE owner=? AND kind='artifact' AND id=?").get(owner,`${owner}:artifact:pr-seed-insight`);
sql.prepare('UPDATE records SET data=? WHERE id=?').run(JSON.stringify({...JSON.parse(insight.data),content:`## 합성 insight 작업물\n조건부 초안입니다. 문의 메일 ${EMAIL}(합성).`,reviewNote:'합성 검토 메모',origin:'ai'}),insight.id);
assert.equal((await post({action:'save_connection',endpoint:EVAL,key:'eval-secret-key',isolationConfirmed:true,note:'메모리 off 평가 프로필'})).body.status,'ready');

// 1) 운영 회의(교정 재시도 1회 포함)를 끝까지 진행한다.
const meetingId='g2-meeting';
const opened=await (await meeting.executeMeeting(owner,{action:'start',id:meetingId,campaignId:meetingCampaign.id,campaignVersion:meetingCampaign.version,agenda:`합성 안건: 재방문 동기를 정리한다. 담당 연락처 ${PHONE_AGENDA}(합성).`})).json();
assert.equal(opened.status,'running',JSON.stringify(opened));
let retried=0;
for(let i=0;i<80;i++){
 const m=await server.readRecord(owner,'team_meeting',meetingId);
 if(m.status==='failed'&&!retried){const s=m.steps.find(t=>t.status==='failed');retried++;await meeting.executeMeeting(owner,{action:'retry_failed',id:meetingId,stepId:s.id,expectedAttempt:s.attempt||0});continue}
 if(m.status!=='running')break;
 await meeting.executeMeeting(owner,{action:'advance',id:meetingId});
}
const done=await server.readRecord(owner,'team_meeting',meetingId);
check('synthetic meeting completed after one correction retry',()=>assert.ok(done.status==='completed'&&retried===1,JSON.stringify({status:done.status,error:done.error})));
const retryStep=done.steps.find(s=>s.attempt);
check('the retried step has a correction and a retry submission',()=>assert.ok(retryStep?.correction&&retryStep.attempt===1));

// 2) 단계마다 캡처: 운영이 그 단계를 처음 보낸 제출과 지금 조립이 같고(identical), 동결본 조립도 같다(frozenIdentical).
const captured=new Map();
for(const s of done.steps){
 const r=await post({action:'capture_case',kind:'meeting_step',meetingId,stepId:s.id,...(s.phase==='quality'?{expectations:{seededDefects:[{id:'denominator',keywords:['회수율 분모']},{id:'missing',keywords:['합성에 없는 결함 표현']}]}}:{})});
 check(`capture ${s.id.slice(meetingId.length+1)} is stored as a meeting_step case`,()=>assert.ok(r.status===200&&r.body.kind==='meeting_step'&&r.body.role===s.role&&r.body.source==='capture'&&r.body.campaignId===meetingCampaign.id,JSON.stringify(r.body).slice(0,400)));
 captured.set(s.id,r.body);
}
const steps=[...captured.values()];
check('every capture matches the first production submission (identical, frozen identical)',()=>assert.deepEqual(steps.map(c=>[c.captureCheck.submission,c.captureCheck.frozenIdentical]),steps.map(()=>['identical',true])));
check('the retried step capture compares its first attempt (identical)',()=>assert.equal(captured.get(retryStep.id).captureCheck.submission,'identical'));
check('capture labels name the phase, role and campaign',()=>assert.ok(steps.every(c=>c.label.includes(meetingCampaign.title))&&captured.get(meetingId+':synthesis').label.startsWith('합의')));
const stored=steps.map(c=>caseRow(c.id)).join('\n');
check('stored meeting cases carry no masked value (agenda·campaign contact, artifact email, plan owner)',()=>assert.ok([PHONE_AGENDA,PHONE_CAMPAIGN,EMAIL,OWNER_NAME].every(v=>!stored.includes(v))));
check('stored meeting cases carry no execution meta or reviewer notes',()=>assert.ok(['providerId','"raw"','attempts','inputMasking','reviewNote','"bg"','"model"','stopRequested'].every(k=>!stored.includes(k))));
const synthesisCase=captured.get(meetingId+':synthesis'),frozenSteps=synthesisCase.request.meeting.steps;
check('a frozen meeting ends at the target step with no output and keeps earlier outputs',()=>assert.ok(frozenSteps.at(-1).id===meetingId+':synthesis'&&frozenSteps.at(-1).status==='pending'&&!('output' in frozenSteps.at(-1))&&frozenSteps.slice(0,-1).every(t=>t.phase==='discussion'&&t.status==='completed'&&t.output)));
const retryFrozen=captured.get(retryStep.id).request.meeting.steps.at(-1);
check('a frozen retried step drops its correction and attempt',()=>assert.ok(!('correction' in retryFrozen)&&!('attempt' in retryFrozen)));

// 두 번 가린 결과 = 한 번 가린 결과: 저장 요청을 다시 동결해도 같고, 저장 요청으로 만든 제출이 운영이 그때 보낸 첫 제출과 바이트 동일하다.
const firstSubmission=async id=>JSON.parse((await server.readRecord(owner,'hermes_submission',id)).body);
for(const c of steps){
 const stepId=c.request.stepId,label=stepId.slice(meetingId.length+1),ops=await firstSubmission(stepId),built=freeze.buildMeetingRequest(c.request);
 check(`${label}: frozen request builds the production first submission byte for byte`,()=>assert.ok(built.instructions===ops.instructions&&built.input===ops.input));
 check(`${label}: freezing the frozen request again changes nothing`,()=>assert.deepEqual(plain(freeze.freezeMeetingRequest(c.request.meeting,stepId,c.request.storeAllow)),plain(c.request)));
}
check('the agenda phone reached production only as a placeholder',()=>assert.ok(steps.every(c=>!freeze.buildMeetingRequest(c.request).input.includes(PHONE_AGENDA))));

// 3) 동결 경로표: 운영 가림 경로(MEETING_MASK_PATHS·BRIEF_MASK_PATHS)마다 원자료 경로가 있다(없으면 모듈 로드가 실패한다).
check('meeting freeze paths map production mask paths to the stored request',()=>assert.ok(['meeting.agenda','meeting.snapshot.campaign.plan.*','meeting.snapshot.artifacts.*.content','meeting.snapshot.brand.description','meeting.snapshot.evidence.directives.*.text','meeting.snapshot.previous.decisions.decisions'].every(p=>freeze.MEETING_FREEZE_MASK_PATHS.includes(p))&&plain(freeze.MEETING_REVISION_MASK_KEYS).sort().join()==='content,title'));
check('brief freeze paths map production mask paths to the stored request',()=>assert.ok(['input.constraints','input.plan.*','context.brand.audience','context.previousCampaigns.*.plan.*','context.recordedMetrics.*.notes','context.approvedLearnings.*.content','context.archive.storeMarketing.store.access'].every(p=>freeze.BRIEF_FREEZE_MASK_PATHS.includes(p))));
check('an unknown meeting step is 400',()=>assert.throws(()=>freeze.meetingBefore(done,meetingId+':missing'),e=>e.status===400));
// 개선본 출력(모델 출력 중 운영이 가리는 유일한 자리: completedRevisions·candidateArtifacts의 제목·본문)도 동결 때 가린다. 다른 단계 출력은 운영처럼 두고, 조립은 같다.
const revisionStep=done.steps.find(s=>s.phase==='revision'),qualityId=meetingId+':quality';
const piiMeeting={...done,steps:done.steps.map(s=>s.id===revisionStep.id?{...s,output:{...s.output,title:`개선본 ${PHONE_AGENDA}`,content:s.output.content+`\n문의 ${EMAIL}`}}:s)};
const piiFrozen=freeze.freezeMeetingRequest(piiMeeting,qualityId,[]),piiText=JSON.stringify(piiFrozen);
check('revision output title and content are masked in the frozen request',()=>assert.ok(!piiText.includes(PHONE_AGENDA)&&!piiText.includes(EMAIL)));
check('a quality step frozen from masked revisions builds the production submission',()=>{const a=freeze.buildMeetingRequest(piiFrozen),b=meetingInput.buildMeetingSubmission(freeze.meetingBefore(piiMeeting,qualityId),qualityId,[]);assert.ok(a.instructions===b.instructions&&a.input===b.input&&!a.input.includes(EMAIL))});
// 한계(문서): 발췌 상한(8,000자) 앞부분의 가림은 글자 수를 바꿔 발췌 끝이 달라진다. 캡처는 이것을 frozenIdentical=false로 남긴다.
const longMeeting={...done,snapshot:{...done.snapshot,artifacts:done.snapshot.artifacts.map((a,i)=>i?a:{...a,content:`문의 ${PHONE_CAMPAIGN} `+'합성 본문 '.repeat(1800)})}},firstId=done.steps[0].id;
check('masking before the 8,000-char excerpt limit shifts the excerpt (documented limit)',()=>assert.notEqual(freeze.buildMeetingRequest(freeze.freezeMeetingRequest(longMeeting,firstId,[])).input,meetingInput.buildMeetingSubmission(freeze.meetingBefore(longMeeting,firstId),firstId,[]).input));

// 4) 실행: 회의 단계 예약 100,000, 평가 제출 = 운영 첫 제출, 발언은 discussion·나머지는 meeting_step 채점기.
const caseIds=steps.map(c=>c.id);
let r=await post({action:'start_run',caseIds,tokenBudget:60000});
check('a meeting run budget below one meeting reserve (100,000) is 400',()=>assert.ok(r.status===400&&/100,000/.test(r.body.error),JSON.stringify(r.body)));
r=await post({action:'start_run',caseIds,tokenBudget:250000});
check('a meeting run starts with a 100,000 reserve per case',()=>assert.ok(r.status===200&&r.body.results.every(x=>x.reserve===100000),JSON.stringify(r.body).slice(0,300)));
const runId=r.body.id;
async function drive(id,max=200){for(let i=0;i<max;i++){const run=(await get('?run='+id)).body;if(!['queued','running'].includes(run.status))return run;await background.advanceBackgroundWork(owner)}return (await get('?run='+id)).body}
let run=await drive(runId);
check('the meeting run completes every case',()=>assert.ok(run.status==='completed'&&run.results.every(x=>x.status==='completed'),JSON.stringify(run.results.map(x=>[x.label,x.status,x.error]))));
for(const x of run.results){
 const c=steps.find(k=>k.id===x.caseId),ops=await firstSubmission(c.request.stepId),sent=[...evalBodies.values()].find(b=>b.session_id===x.idempotencyKey);
 check(`eval sent ${c.request.stepId.slice(meetingId.length+1)} byte-identical to production`,()=>assert.ok(sent&&sent.instructions===ops.instructions&&sent.input===ops.input));
}
const resultOf=step=>run.results.find(x=>x.caseId===captured.get(step).id),status=(x,id)=>x.graders.find(g=>g.id===id)?.status;
const discussion=resultOf(done.steps[1].id),synthesis=resultOf(meetingId+':synthesis'),revision=resultOf(done.steps.find(s=>s.phase==='revision').id),quality=resultOf(meetingId+':quality');
check('a discussion step is graded as a discussion (contract_json passes)',()=>assert.ok(status(discussion,'contract_json')==='pass'&&status(discussion,'meeting_step_contract')==='not_applicable'));
check('synthesis passes meeting_step_contract',()=>assert.equal(status(synthesis,'meeting_step_contract'),'pass'));
check('a revision is graded by revision_repeat against its original',()=>assert.equal(status(revision,'revision_repeat'),'pass'));
check('the quality review reports the missed seeded defect only',()=>{const g=quality.graders.find(x=>x.id==='seeded_defect_detection');assert.ok(g.status==='fail'&&/missing/.test(g.detail)&&!/denominator/.test(g.detail),JSON.stringify(g))});
check('meeting results carry no prevention rows and no grader errors',()=>assert.ok(run.results.every(x=>Array.isArray(x.prevention)&&!x.prevention.length&&!x.summary.grader_error)));
check('meeting outputs are stored per case with the step role',()=>assert.ok(run.results.every(x=>sql.prepare("SELECT 1 FROM records WHERE owner=? AND kind='eval_output' AND id=?").get(owner,`${owner}:eval_output:${runId}:${x.caseId}`))));
r=await post({action:'regrade_run',id:runId});
check('a meeting run regrades with the same scale (no skips)',()=>assert.ok(r.status===200&&r.body.totals.cases===steps.length&&!r.body.skipped.length,JSON.stringify(r.body).slice(0,300)));

// 5) 드리프트 사유: 운영 기록을 바꿔 가며 다시 캡처한다(이미 저장한 케이스·실행은 동결본이라 영향이 없다).
const synthesisId=meetingId+':synthesis',submissionRow=`${owner}:hermes_submission:${synthesisId}`;
const saved=sql.prepare('SELECT data FROM records WHERE id=?').get(submissionRow).data,body=JSON.parse(JSON.parse(saved).body);
const setSubmission=b=>sql.prepare('UPDATE records SET data=? WHERE id=?').run(JSON.stringify({...JSON.parse(saved),body:JSON.stringify(b)}),submissionRow);
const setMeeting=m=>sql.prepare("UPDATE records SET data=? WHERE owner=? AND kind='team_meeting' AND id=?").run(JSON.stringify(m),owner,`${owner}:team_meeting:${meetingId}`);
const recapture=async()=>(await post({action:'capture_case',kind:'meeting_step',meetingId,stepId:synthesisId})).body.captureCheck;
setSubmission({...body,instructions:body.instructions+'\n다른 조립'});
let cc=await recapture();check('a different submission with the same skill and masking is assembly_drift (the only alarm)',()=>assert.deepEqual([cc.submission,cc.frozenIdentical],['assembly_drift',true]));
setMeeting({...done,steps:done.steps.map(s=>s.id===synthesisId?{...s,inputMasking:[{field:'agenda',kind:'phone',count:9}]}:s)});
cc=await recapture();check('a different masking record is store_allow_changed',()=>assert.equal(cc.submission,'store_allow_changed'));
setMeeting({...done,skillVersion:'2020-01-01.1'});
cc=await recapture();check('a meeting run under another skill version is code_changed',()=>assert.equal(cc.submission,'code_changed'));
setMeeting(done);setSubmission(body);
cc=await recapture();check('restored records compare identical again',()=>assert.equal(cc.submission,'identical'));
sql.prepare('DELETE FROM records WHERE id=?').run(submissionRow);
cc=await recapture();check('a step without a stored submission is no_submission',()=>assert.equal(cc.submission,'no_submission'));

// 6) 브리프: 운영 초안 1건(기준일 고정)을 캡처해 가림 뒤 동결하고, 실행 제출이 운영 제출과 같다. 브리프는 담당 brief·예약 50,000·쌍 평가 제외.
const briefData={brandId:brand.id,title:'가상분식 재방문 초안',goal:'첫 방문 고객의 재방문을 만든다.',audience:'가상동 주민(가설)',channels:'YouTube, 커뮤니티',stores:'가상동 12',products:'떡볶이(가격 미확정)',budget:null,startDate:'',endDate:'',constraints:`문의는 ${PHONE_AGENDA}로 받는다(합성).`,sources:'',plan:{owner:OWNER_NAME}};
const draft=await (await brief.executeBrief(owner,{action:'start',id:'g2-brief',data:briefData,campaignId:roleCampaign.id,campaignVersion:roleCampaign.version})).json();
check('the production brief draft was submitted',()=>assert.equal(draft.status,'queued',JSON.stringify(draft)));
r=await post({action:'capture_case',kind:'brief',briefDraftId:'g2-brief'});
const briefCase=r.body;
check('a brief capture is a brief case with role brief and identical drift check',()=>assert.ok(r.status===200&&briefCase.kind==='brief'&&briefCase.role==='brief'&&briefCase.campaignId===roleCampaign.id&&briefCase.captureCheck.submission==='identical'&&briefCase.captureCheck.frozenIdentical,JSON.stringify(briefCase).slice(0,400)));
const briefStored=caseRow(briefCase.id);
check('a stored brief case carries no contact, owner name, brand bg or intake',()=>assert.ok([PHONE_AGENDA,OWNER_NAME,'"bg"','intake'].every(v=>!briefStored.includes(v))));
const briefOps=await firstSubmission('brief-g2-brief'),briefBuilt=briefInput.buildBriefSubmission(briefCase.request);
check('the frozen brief builds the production submission byte for byte',()=>assert.ok(briefBuilt.instructions===briefOps.instructions&&briefBuilt.input===briefOps.input));
check('freezing the frozen brief again changes nothing',()=>assert.deepEqual(plain(freeze.freezeBriefRequest(briefCase.request)),plain(briefCase.request)));
r=await post({action:'save_case',kind:'brief',request:briefCase.request,label:'합성 브리프 재저장'});
check('a frozen brief request saves as a manual brief case unchanged',()=>assert.ok(r.status===200&&r.body.role==='brief'&&JSON.stringify(r.body.request)===JSON.stringify(briefCase.request)));
let count=caseCount();
for(const [name,input] of [['role other than brief',{role:'cmo',request:briefCase.request}],['bad context date',{request:{...briefCase.request,contextDate:'2026/03/15'}}],['missing context',{request:{input:briefCase.request.input}}]]){
 r=await post({action:'save_case',kind:'brief',...input});check(`save brief with ${name} is 400`,()=>assert.equal(r.status,400,JSON.stringify(r.body)));
}
check('rejected brief saves store no case',()=>assert.equal(caseCount(),count));
r=await post({action:'start_run',caseIds:[briefCase.id],tokenBudget:100000});
run=await drive(r.body.id);
const briefResult=run.results[0],briefSent=[...evalBodies.values()].find(b=>b.session_id===briefResult.idempotencyKey);
check('a brief run reserves 50,000 and sends the production submission',()=>assert.ok(briefResult.reserve===50000&&briefResult.status==='completed'&&briefSent.instructions===briefOps.instructions&&briefSent.input===briefOps.input,JSON.stringify(briefResult).slice(0,300)));
check('a brief is graded by brief_contract and brief_instruction_violation',()=>assert.ok(status(briefResult,'brief_contract')==='pass'&&['pass','fail'].includes(status(briefResult,'brief_instruction_violation'))&&status(briefResult,'contract_json')==='not_applicable'));
r=await post({action:'capture_case',kind:'brief',briefDraftId:'missing-draft'});
check('capturing an unknown brief draft is 404',()=>assert.equal(r.status,404));

// 7) 직접 저장한 회의 단계 요청: 담당은 대상 단계에서 정하고, 형식이 틀리면 400이다.
r=await post({action:'save_case',kind:'meeting_step',request:synthesisCase.request});
check('a frozen meeting request saves as a manual case with the step role',()=>assert.ok(r.status===200&&r.body.role==='cmo'&&r.body.kind==='meeting_step'&&JSON.stringify(r.body.request)===JSON.stringify(synthesisCase.request)));
const rawMeeting={meeting:done,stepId:synthesisId,storeAllow:[]};
r=await post({action:'save_case',kind:'meeting_step',request:rawMeeting});
check('a raw completed meeting record is cut, minimized and masked before saving',()=>{const s=JSON.stringify(r.body.request);assert.ok(r.status===200&&r.body.request.meeting.steps.at(-1).id===synthesisId&&[PHONE_AGENDA,PHONE_CAMPAIGN,EMAIL,OWNER_NAME,'providerId'].every(v=>!s.includes(v)))});
count=caseCount();
for(const [name,input] of [['another role',{role:'quality',request:synthesisCase.request}],['no step id',{request:{...synthesisCase.request,stepId:''}}],['unknown step',{request:{...synthesisCase.request,stepId:meetingId+':missing'}}],['no snapshot',{request:{meeting:{agenda:'x',steps:[]},stepId:synthesisId}}],['bad store allow',{request:{...synthesisCase.request,storeAllow:[1]}}]]){
 r=await post({action:'save_case',kind:'meeting_step',...input});check(`save meeting step with ${name} is 400`,()=>assert.equal(r.status,400,JSON.stringify(r.body)));
}
check('rejected meeting saves store no case',()=>assert.equal(caseCount(),count));
r=await post({action:'capture_case',kind:'meeting_step',meetingId,stepId:meetingId+':missing'});
check('capturing an unknown step is 400',()=>assert.equal(r.status,400));

// 8) 기대 판정 확장(G3): 업종 배열과 심은 결함 형식.
r=await post({action:'capture_case',kind:'meeting_step',meetingId,stepId:meetingId+':quality',expectations:{industry:['kpop','fnb']}});
check('an industry list is accepted',()=>assert.ok(r.status===200&&JSON.stringify(r.body.expectations.industry)==='["kpop","fnb"]'));
for(const [name,expectations] of [['empty industry list',{industry:[]}],['six industries',{industry:['a','b','c','d','e','f']}],['defect without id',{seededDefects:[{marker:'x'}]}],['defect without marker or keywords',{seededDefects:[{id:'d'}]}],['defects not a list',{seededDefects:{id:'d'}}]]){
 r=await post({action:'capture_case',kind:'meeting_step',meetingId,stepId:meetingId+':quality',expectations});check(`expectations with ${name} is 400`,()=>assert.equal(r.status,400,JSON.stringify(r.body)));
}

// 9) 쌍 평가 대상: 회의 단계는 스냅샷 캠페인으로 후보 단위를 보고 프롬프트 본문을 snapshot.prompts.set에 주입한다. 브리프는 대상이 아니다.
const meetingKind=kinds.evalKind('meeting_step'),briefKind=kinds.evalKind('brief');
const contentCase=captured.get(meetingId+':revision:content');
check('a meeting case pairs through its snapshot campaign',()=>assert.ok(meetingKind.campaignOf(contentCase.request).id===meetingCampaign.id&&registry.roleRunUnits('content',meetingKind.campaignOf(contentCase.request)).includes('role.content')));
check('a brief case has no pair campaign',()=>assert.equal(briefKind.campaignOf(briefCase.request),null));
const {focus,methods,outputs,review,handoff}=practice.practices.content,candidateSet={roles:{content:{focus:'합성 후보 초점: 첫 문장에 고객의 평일 상황을 쓴다.',methods,outputs,review,handoff}}};
const asIs=meetingKind.build(contentCase.request),asActive=meetingKind.build(contentCase.request,null),asCandidate=meetingKind.build(contentCase.request,candidateSet);
check('an active side of null builds the code-constant request (same as the frozen code snapshot)',()=>assert.deepEqual(asActive,asIs));
check('a candidate side changes the meeting instructions',()=>assert.notEqual(asCandidate.instructions,asIs.instructions));
check('a brief cannot be built with a pair side',()=>assert.throws(()=>briefKind.build(briefCase.request,null)));
check('no external network call',()=>assert.deepEqual(hermes.external,[]));
console.log(JSON.stringify({passed:passed.length}));
