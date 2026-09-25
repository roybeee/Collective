// 조립 공개(G1): 회의 단계·브리프 초안의 제출 조립이 공개 순수 함수(lib/meeting-input.ts buildMeetingSubmission, lib/brief-input.ts briefRequestFor·buildBriefSubmission)로 나와 있고,
// 운영 실행 경로(lib/meeting-execution.ts advance, lib/brief-execution.ts start)가 hermes_submission에 저장·전송한 본문과 바이트 동일한지 본다. 평가가 같은 요청을 동결·재현하는 전제다.
// 회의는 단계 직전의 저장 기록(JSON)을, 브리프는 JSON으로 동결한 요청을 순수 함수에 넣는다. 동작 불변은 두 곳이 본다: 재시도 없는 회의 단계는 prompt-baseline이 기준 커밋과 비교하고,
// 교정 재시도와 기준일을 고정한 브리프는 이 스위트가 기준 커밋(7b897c9)에서 뽑은 sha256·길이(tests/fixtures/assembly-baseline-7b897c9.json)와 비교한다.
// 근거: mocked(모의 HERMES fetch 스텁, 메모리 SQLite, 합성 데이터). 외부 네트워크 호출은 0회다.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {testRuntime} from './helpers/runtime.mjs';
import {seed,mockHermes,meetingCampaign,roleCampaign,brand,now,sha} from './helpers/prompt-seed.mjs';

// 교정 재시도: 전략 담당 첫 발언 응답 하나만 양식 없는 텍스트로 돌려 invalid_output 실패 → retry_failed(correction) 경로를 지난다.
let failOnce=true;
const hermes=mockHermes(async url=>{
 if(!failOnce||!url.startsWith('https://hermes.example.com/v1/runs/'))return undefined;
 const id=url.split('/').pop(),input=JSON.parse(JSON.parse(hermes.bodies.get(id)).input);
 if(input.phase!=='discussion'||input.role!=='strategy')return undefined;
 failOnce=false;return Response.json({object:'hermes.run',run_id:id,status:'completed',output:'합성 응답: 회의 양식이 없는 텍스트',usage:{total_tokens:100,output_tokens:10},model:'mock-model'});
});
// 브리프 기준일(stamp().slice(0,10))을 고정한다: 이 런타임 안의 Date만 고정 시각에서 흐르고, 테스트 프로세스의 Date는 그대로다.
const RealDate=Date,started=RealDate.now(),pinned=RealDate.parse('2026-03-15T09:00:00.000Z'),clock=()=>pinned+RealDate.now()-started;
class PinnedDate extends RealDate{constructor(...a){super(...(a.length?a:[clock()]))}static now(){return clock()}}
globalThis.Date=PinnedDate;let runtime;try{runtime=testRuntime(hermes.fetch)}finally{globalThis.Date=RealDate}
const {sql,load}=runtime;
const server=await load('lib/server.ts'),meeting=await load('lib/meeting-execution.ts'),brief=await load('lib/brief-execution.ts'),repair=await load('lib/meeting-repair.ts');
const meetingInput=await load('lib/meeting-input.ts'),briefInput=await load('lib/brief-input.ts');
const allow=await load('lib/store-allow-server.ts'),archiveServer=await load('lib/archive-server.ts'),aiContext=await load('lib/ai-context.ts'),learningServer=await load('lib/learning-server.ts');
const owner='g1-assembly-owner',passed=[];
const check=(name,fn)=>{fn();passed.push(name)};
// 기준 커밋 고정값(본문 대신 sha256·길이). 순수 함수 안에서 바이트가 바뀌면 운영 경로도 함께 바뀌어 자기 일관성 비교로는 못 잡으므로 G1 이전 운영 제출과 직접 비교한다.
const baseline=JSON.parse(readFileSync('tests/fixtures/assembly-baseline-7b897c9.json','utf8')),digest=t=>({sha256:sha(t),length:String(t).length});
const baseDrift='기준 커밋(7b897c9)의 운영 제출과 다릅니다. 조립 공개(G1)는 제출 바이트를 바꾸지 않아야 합니다.';
const put=await seed(server,sql,owner);

check('meeting and brief assembly are exported as functions',()=>assert.ok(typeof meetingInput.buildMeetingSubmission==='function'&&typeof briefInput.briefRequestFor==='function'&&typeof briefInput.buildBriefSubmission==='function'));
check('meeting mask paths are exported',()=>assert.ok(Array.isArray(meetingInput.MEETING_MASK_PATHS)&&['agenda','candidateArtifacts.*.content','completedRevisions.*.content','previousMeeting.decisions.decisions'].every(p=>meetingInput.MEETING_MASK_PATHS.includes(p))));
// 이중 확인: 운영 실행 경로가 공개 함수를 부르고, 자체 조립(가림·지시문 호출)을 따로 두지 않는다.
const source=f=>readFileSync(f,'utf8');
check('meeting execution submits buildMeetingSubmission output and has no own assembly',()=>{const s=source('lib/meeting-execution.ts');assert.ok(/buildMeetingSubmission\(/.test(s)&&!/maskFields\(|meetingInstructions\(|function context\(/.test(s))});
check('brief execution submits buildBriefSubmission(briefRequestFor(...)) and has no own assembly',()=>{const s=source('lib/brief-execution.ts');assert.ok(/buildBriefSubmission\(/.test(s)&&/briefRequestFor\(/.test(s)&&!/maskFields\(|briefInstructions/.test(s))});

// 1) 회의: 단계마다 직전 저장 기록으로 기대 제출을 만들고, 진행 뒤 저장·전송 본문과 비교한다.
const meetingId='g1-meeting',expected=new Map();
const started0=await (await meeting.executeMeeting(owner,{action:'start',id:meetingId,campaignId:meetingCampaign.id,campaignVersion:meetingCampaign.version,agenda:'합성 안건: 재방문 동기를 정리한다. 담당 연락처 010-2345-6789(합성).'})).json();
assert.equal(started0.status,'running',JSON.stringify(started0));
let retried=0;
for(let i=0;i<80;i++){
 const before=await server.readRecord(owner,'team_meeting',meetingId);
 if(before.status==='failed'&&!retried){const s=before.steps.find(t=>t.status==='failed');retried++;await meeting.executeMeeting(owner,{action:'retry_failed',id:meetingId,stepId:s.id,expectedAttempt:s.attempt||0});continue}
 if(before.status!=='running')break;
 const next=before.steps.find(t=>t.status!=='completed');
 if(next?.status==='pending')expected.set(repair.meetingSubmissionId(next),{step:next,built:meetingInput.buildMeetingSubmission(before,next.id,await allow.brandStoreAllow(owner,before.snapshot.campaign))});
 await meeting.executeMeeting(owner,{action:'advance',id:meetingId});
}
const done=await server.readRecord(owner,'team_meeting',meetingId);
check('meeting completed after one correction retry',()=>assert.ok(done.status==='completed'&&retried===1&&!failOnce,JSON.stringify({status:done.status,error:done.error})));
const submissions=sql.prepare("SELECT id FROM records WHERE owner=? AND kind='hermes_submission' AND parent_id=?").all(owner,meetingCampaign.id).map(r=>r.id.slice(`${owner}:hermes_submission:`.length));
check('every meeting submission (12 steps + 1 retry) has an expected assembly',()=>assert.deepEqual(submissions.sort(),[...expected.keys()].sort()));
check('meeting has 13 submissions',()=>assert.equal(expected.size,13));
const drift='운영 회의 제출 본문이 lib/meeting-input.ts buildMeetingSubmission 출력과 다릅니다. meeting-execution.ts가 순수 함수 출력을 그대로 보내야 합니다.';
const received=[...hermes.bodies.values()];
for(const [sid,{built}] of expected){
 const label=sid.slice(meetingId.length+1),saved=await server.readRecord(owner,'hermes_submission',sid);
 check(`meeting ${label} stored body is byte-identical to the pure assembly`,()=>assert.equal(saved.body,JSON.stringify({instructions:built.instructions,input:built.input,session_id:saved.key,conversation_history:[]}),drift));
 check(`meeting ${label} HERMES received the stored body unchanged`,()=>assert.ok(received.includes(saved.body)));
 const step=done.steps.find(t=>repair.meetingSubmissionId(t)===sid);
 if(step)check(`meeting ${label} masking record equals the stored step record`,()=>assert.deepEqual(built.maskingRecord,step.inputMasking));
}
// 단계 종류 5종(첫 의견·이어지는 의견·합의·개선본·품질 재검토)과 교정 재시도가 모두 비교에 들어갔는지 본다.
const inputs=[...expected.entries()].map(([sid,{built}])=>({sid,instructions:built.instructions,input:JSON.parse(built.input)}));
const firstTry=inputs.filter(x=>!x.sid.includes(':retry:'));
check('kind: first discussion (no earlier statement to answer)',()=>assert.ok(firstTry.some(x=>x.input.phase==='discussion'&&x.input.allowedRespondsTo.length===0)));
check('kind: later discussion (answers earlier statements)',()=>assert.ok(firstTry.some(x=>x.input.phase==='discussion'&&x.input.allowedRespondsTo.length>0&&x.input.discussion.length>0)));
check('kind: synthesis',()=>assert.ok(firstTry.some(x=>x.input.phase==='synthesis'&&x.input.discussion.length===8)));
check('kind: revision (second revision sees the first)',()=>assert.ok(firstTry.some(x=>x.input.phase==='revision'&&x.input.task&&x.input.completedRevisions.length===0)&&firstTry.some(x=>x.input.phase==='revision'&&x.input.completedRevisions.length===1)));
check('kind: quality review with candidate artifacts',()=>assert.ok(firstTry.some(x=>x.input.phase==='quality'&&x.input.candidateArtifacts.length>0)));
const retry=inputs.find(x=>x.sid.endsWith(':retry:1'));
check('correction retry carries correction in instructions and input',()=>assert.ok(retry&&retry.input.correction?.error&&/correction\.error를 고치고/.test(retry.instructions)&&!inputs.find(x=>x.sid===retry.sid.replace(/:retry:1$/,'')).input.correction));
const retryBase=baseline.correctionRetry,retryBuilt=expected.get(retryBase.submission)?.built,retryStep=done.steps.find(t=>repair.meetingSubmissionId(t)===retryBase.submission);
check('correction retry instructions (with the correction sentence) equal base 7b897c9',()=>assert.deepEqual(digest(retryBuilt?.instructions),retryBase.instructions,baseDrift));
check('correction retry input equals base 7b897c9',()=>assert.deepEqual(digest(retryBuilt?.input),retryBase.input,baseDrift));
check('correction retry step masking record equals base 7b897c9',()=>assert.deepEqual(digest(JSON.stringify(retryStep?.inputMasking)),retryBase.inputMasking,baseDrift));
check('meeting agenda phone is masked and recorded',()=>assert.ok(firstTry.every(x=>!x.input.agenda.includes('010-2345-6789'))&&[...expected.values()].every(({built})=>built.maskingRecord.some(f=>f.field==='agenda'&&f.kind==='phone'))));
// 전제: 입력은 대상 단계 직전까지의 기록이어야 한다. 완료된 회의 기록을 그대로 넣으면 뒤 단계 발언이 섞여 다르다(평가 캡처는 기록을 잘라 동결한다).
const firstStep=done.steps[0],full=meetingInput.buildMeetingSubmission(done,firstStep.id,[]);
check('full completed record differs from the pre-step record (cut is required)',()=>assert.notEqual(full.input,expected.get(repair.meetingSubmissionId(firstStep)).built.input));
check('unknown step id is rejected',()=>assert.throws(()=>meetingInput.buildMeetingSubmission(done,meetingId+':missing',[])));

// 2) 브리프: 기준일을 고정한 운영 초안 1건. 다른 캠페인의 승인 작업물·성과와 지시·담당자 이름·연락처를 넣어 선택·가림 경로를 지난다.
await put('artifact','g1-approved-insight',{id:'g1-approved-insight',campaignId:roleCampaign.id,campaignVersion:1,role:'insight',title:'합성 승인 인사이트',content:'합성 인사이트: 포장 고객은 저녁 시간대가 많다(가설). '.repeat(120),version:1,status:'approved',origin:'ai',createdAt:now},roleCampaign.id);
await put('metric','g1-metric',{id:'g1-metric',campaignId:roleCampaign.id,period:'2026-01',revenue:null,variableCosts:null,adSpend:null,productionCost:null,orders:12,baselineContribution:null,notes:'합성 메모: 포장 12건(미검증).'},roleCampaign.id);
const briefData={brandId:brand.id,title:'가상분식 재방문 초안',goal:'첫 방문 고객의 재방문을 만든다.',audience:'가상동 주민(가설)',channels:'YouTube, 커뮤니티',stores:'가상동 12',products:'떡볶이(가격 미확정)',budget:null,startDate:'',endDate:'',constraints:'문의는 010-2345-6789로 받는다(합성).',sources:'',plan:{owner:'김가상'}};
const draft=await (await brief.executeBrief(owner,{action:'start',id:'g1-brief',data:briefData,campaignId:meetingCampaign.id,campaignVersion:meetingCampaign.version})).json();
check('brief draft was submitted',()=>assert.equal(draft.status,'queued',JSON.stringify(draft)));
const stored=await server.readRecord(owner,'brief_draft','g1-brief'),saved=await server.readRecord(owner,'hermes_submission','brief-g1-brief'),input=stored.input;
// 독립 오라클: brief-execution.ts start가 읽는 원자료를 같은 규칙으로 따로 읽어 요청을 만들고, JSON으로 동결한 뒤 조립한다.
const {archive,sourceMasking}=await archiveServer.brandArchiveInput(owner,brand.id,input.storeId);
const sources={campaignId:meetingCampaign.id,input,brand:await server.readRecord(owner,'brand',brand.id),evidence:await aiContext.evidenceContext(server.database(),owner,{id:meetingCampaign.id,brandId:brand.id,storeId:input.storeId}),archive,sourceMasking,trialLearning:await learningServer.learningContext(owner,input),campaigns:await server.listRecords(owner,'campaign'),metrics:await server.listRecords(owner,'metric'),artifacts:await server.listRecords(owner,'artifact'),storeAllow:await allow.brandStoreAllow(owner,{brandId:brand.id,storeId:input.storeId})};
const request=JSON.parse(JSON.stringify(briefInput.briefRequestFor({...sources,contextDate:'2026-03-15'}))),built=briefInput.buildBriefSubmission(request);
check('brief stored body is byte-identical to the frozen pure assembly (fixed context date)',()=>assert.equal(saved.body,JSON.stringify({instructions:built.instructions,input:built.input,session_id:saved.key,conversation_history:[]}),'운영 브리프 제출 본문이 lib/brief-input.ts 출력과 다릅니다.'));
check('brief HERMES received the stored body unchanged',()=>assert.ok([...hermes.bodies.values()].includes(saved.body)));
check('brief masking record equals the stored draft record',()=>assert.deepEqual(built.maskingRecord,stored.inputMasking));
// 브리프 지시문 기준값은 브리프 품질 수정 v2(2026-09-25)가 의도적으로 바꿨다(fixture brief.instructionsUpdated에 이전 값·사유). 입력·가림 기록은 7b897c9 그대로다.
check('brief instructions equal the recorded baseline (7b897c9, updated by brief quality v2)',()=>assert.deepEqual(digest(built.instructions),baseline.brief.instructions,baseDrift));
check('brief input equals base 7b897c9 (same fixed context date)',()=>{assert.equal(request.contextDate,baseline.contextDate);assert.deepEqual(digest(built.input),baseline.brief.input,baseDrift)});
check('brief draft masking record equals base 7b897c9',()=>assert.deepEqual(digest(JSON.stringify(stored.inputMasking)),baseline.brief.inputMasking,baseDrift));
const briefBody=JSON.parse(built.input);
check('brief input carries the given context date',()=>assert.equal(briefBody.contextDate,'2026-03-15'));
check('brief request freezes the other campaign, its metric and approved excerpt only',()=>assert.ok(request.contextDate==='2026-03-15'&&briefBody.previousCampaigns.map(c=>c.id).join()===roleCampaign.id&&briefBody.recordedMetrics.length===1&&briefBody.approvedLearnings.length===1&&briefBody.approvedLearnings[0].content.length===2500));
check('brief masks the contact number and the plan owner',()=>assert.ok(!built.input.includes('010-2345-6789')&&!built.input.includes('김가상')&&built.maskingRecord.some(f=>f.kind==='phone')));
// 동결 요청 최소화: 모델에 가지 않는 원자료(브랜드 의뢰 정보 intake·bg, 담당자 실명)는 요청에도 담지 않는다. 줄여도 조립 바이트는 원자료로 조립한 것과 같다.
check('frozen brief request carries no plan owner name and no brand bg',()=>assert.ok(!JSON.stringify(request).includes('김가상')&&!('bg' in request.context.brand)));
const leak={brand:{...sources.brand,intake:{website:'https://intake.example.com',socialLinks:'',market:'합성 상권',clientNeed:'합성 비공개 요구',competitors:'합성 경쟁 매장'}},archive:{...archive,storeMarketing:{operations:{diagnostics:[{id:'g1-diagnostic',assignee:'이가상'}]}}},campaigns:sources.campaigns.map(c=>c.id===roleCampaign.id?{...c,plan:{owner:'박가상'}}:c)};
const leakRequest=briefInput.briefRequestFor({...sources,...leak,contextDate:'2026-03-15'}),leakFrozen=JSON.stringify(leakRequest);
check('frozen brief request drops brand intake and person names',()=>assert.ok(leakRequest.context.previousCampaigns.length===1&&['intake.example.com','합성 상권','합성 비공개 요구','합성 경쟁 매장','김가상','박가상','이가상'].every(v=>!leakFrozen.includes(v)),leakFrozen));
const rawRequest={...leakRequest,input,context:{...leakRequest.context,brand:leak.brand,archive:leak.archive,previousCampaigns:leakRequest.context.previousCampaigns.map(p=>p.id===roleCampaign.id?{...p,plan:{owner:'박가상'}}:p)}};
check('minimized request assembles the same bytes as the raw sources',()=>assert.deepEqual(briefInput.buildBriefSubmission(JSON.parse(leakFrozen)),briefInput.buildBriefSubmission(rawRequest)));
// 결정성과 민감도: 같은 요청은 같은 바이트, 기준일이 다르면 입력이 다르다(지시문은 같다).
const other=briefInput.buildBriefSubmission({...request,contextDate:'2026-04-01'});
check('same frozen request gives the same bytes',()=>assert.deepEqual(briefInput.buildBriefSubmission(JSON.parse(JSON.stringify(request))),built));
check('a different context date changes only the input',()=>assert.ok(other.input!==built.input&&other.instructions===built.instructions&&JSON.parse(other.input).contextDate==='2026-04-01'));
check('no external call',()=>assert.equal(hermes.external.length,0));
console.log(JSON.stringify({passed:passed.length}));
