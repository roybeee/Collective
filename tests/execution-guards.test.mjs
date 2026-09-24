// 실행 가드(PR 4a-2): 보관 검사를 소유자 잠금 안으로(역할 start·회의 start/retry_failed·캠페인 초안 start), OpenAI 직접 경로 토큰 예산 가드,
// 복구 중 예산 초과를 '확인 필요'가 아니라 사유와 함께 실패로 남기기. 복구는 보관 중에도 막지 않고, 제출 본문은 바이트 그대로다.
// 근거: mocked(모의 HERMES·OpenAI fetch 스텁, 메모리 SQLite, 로컬 인증 헤더, 합성 데이터). 외부 네트워크·유료 모델 호출은 0회다.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {testRuntime} from './helpers/runtime.mjs';
import {roleFixture} from './helpers/role-fixture.mjs';

const HERMES='https://hermes.example.com',OPENAI='https://api.openai.com/v1/';
const hermesPosts=[],hermesRuns=new Map(),openaiPosts=[],openaiRuns=new Map(),external=[];
let seq=0,hermesMode='ok',openaiMode='ok';
async function fetchStub(url,options={}){
 url=String(url);const method=options.method||'GET';
 if(url.startsWith(HERMES+'/')){
  const path=url.slice(HERMES.length);
  if(path==='/v1/runs'&&method==='POST'){hermesPosts.push(options.body);if(hermesMode==='lost'){hermesMode='ok';throw new Error('lost acknowledgement')}const id='run_'+ ++seq;hermesRuns.set(id,options.body);return Response.json({run_id:id})}
  const id=/^\/v1\/runs\/([\w-]+)$/.exec(path)?.[1];if(!id||!hermesRuns.has(id))return new Response('{}',{status:404});
  return Response.json({object:'hermes.run',run_id:id,status:'completed',output:roleFixture(JSON.parse(hermesRuns.get(id)).input),usage:{input_tokens:1200,output_tokens:800,total_tokens:2000},model:'reported-model-a'});
 }
 if(url.startsWith(OPENAI)){
  const path=url.slice(OPENAI.length);
  if(path==='responses'&&method==='POST'){
   openaiPosts.push(options.body);
   if(openaiMode==='reject')return Response.json({error:{code:'invalid_request_error'}},{status:400});
   if(openaiMode==='5xx')return Response.json({error:{}},{status:500});
   if(openaiMode==='429')return Response.json({error:{code:'rate_limit_exceeded'}},{status:429});
   const id='resp_'+ ++seq,request=JSON.parse(options.body);openaiRuns.set(id,request);return Response.json({id,status:'queued',metadata:request.metadata});
  }
  const id=/^responses\/(resp_[\w-]+)$/.exec(path)?.[1];if(!id||!openaiRuns.has(id))return Response.json({error:{}},{status:404});
  const request=openaiRuns.get(id);
  return Response.json({id,status:'completed',metadata:request.metadata,model:'reported-model-b',output:[{type:'message',content:[{type:'output_text',text:roleFixture(request.input),annotations:[]}]}],usage:{input_tokens:1500,output_tokens:500,total_tokens:2000}});
 }
 external.push(url);throw new Error('모의 주소만 호출합니다: '+url);
}
// 경합 재현: 라우트의 잠금 밖 사전 검사를 통과한 뒤, 실행 파일이 소유자 잠금을 잡는 순간 보관이 먼저 기록된 상태를 만든다(보관도 같은 잠금 안에서 쓴다).
let archiveOnLock=null;
const rt=testRuntime(fetchStub,{beforeRun(st){if(!archiveOnLock||!/^INSERT INTO mutation_locks/.test(st.query))return;const [who,id]=archiveOnLock;archiveOnLock=null;archiveNow(who,id)}});
function archiveNow(who,id){rt.sql.prepare("UPDATE records SET data=json_set(data,'$.archivedAt',?,'$.archivedBy',json(?)) WHERE id=? AND owner=? AND kind='campaign'").run(new Date().toISOString(),JSON.stringify({id:who,email:null}),`${who}:campaign:${id}`,who)}
const server=await rt.load('lib/server.ts'),budget=await rt.load('lib/token-budget.ts');
const roleExec=await rt.load('lib/role-execution.ts'),meetingExec=await rt.load('lib/meeting-execution.ts');
const runRoute=await rt.load('app/api/run/route.ts'),meetingsRoute=await rt.load('app/api/meetings/route.ts'),briefRoute=await rt.load('app/api/brief/route.ts');
const passed=[];const check=(name,value)=>{assert.ok(value,name);passed.push(name)};
const plain=v=>JSON.parse(JSON.stringify(v));
const ARCHIVED='보관된 캠페인입니다. 보관 해제 후 다시 시도하세요.',EXCEEDED=/^토큰 예산 초과: /;
const HO='eg-hermes',OO='eg-openai',DB=rt.env.DB,now=new Date().toISOString();
const put=(who,kind,id,data,parent='')=>server.recordStatement(who,kind,id,data,parent).run();
const record=(who,kind,id)=>JSON.parse(rt.sql.prepare('SELECT data FROM records WHERE owner=? AND kind=? AND id=?').get(who,kind,`${who}:${kind}:${id}`)?.data||'null');
const jobsOf=(who,campaignId)=>rt.sql.prepare('SELECT id,status,error,provider_id FROM jobs WHERE owner=? AND campaign_id=? ORDER BY created_at,rowid').all(who,campaignId);
const reservations=who=>rt.sql.prepare("SELECT data FROM records WHERE owner=? AND kind='token_reservation'").all(who).map(r=>JSON.parse(r.data));
const dropReservations=(who,campaignId)=>rt.sql.prepare("DELETE FROM records WHERE owner=? AND kind='token_reservation' AND json_extract(data,'$.campaignId')=?").run(who,campaignId);
const setBudget=(who,monthlyTokens)=>budget.setTokenBudget(DB,who,{scope:'workspace',monthlyTokens},{id:who,email:null});
const post=async(mod,who,body)=>{const r=await mod.POST(new Request('https://agency.test/api/test',{method:'POST',headers:{'content-type':'application/json','oai-authenticated-user-id':who},body:JSON.stringify(body)}));return {status:r.status,data:await r.json()}};
const call=async res=>({status:res.status,data:await res.json()});

// 합성 데이터: HERMES 소유자(회의·초안은 HERMES 전용)와 OpenAI 직접 연결 소유자.
rt.sql.prepare('INSERT INTO settings(owner,secret,model,updated_at) VALUES(?,?,?,?)').run(HO,await server.encrypt(JSON.stringify({provider:'hermes',endpoint:HERMES,key:'mock-only'})),'HERMES',now);
rt.sql.prepare('INSERT INTO settings(owner,secret,model,updated_at) VALUES(?,?,?,?)').run(OO,await server.encrypt('sk-test-only-execution-guards'),'test-model',now);
const brand={id:'eg-brand',name:'가상분식',short:'GB',category:'SNACK BAR',color:'#224466',bg:'#eef2f6',description:'합성 소개(미확인).',audience:'가상동 주민(가설)',tone:'명료한',constraints:'가격은 확인 전 확정하지 않는다.',knowledge:'합성 메모.'};
const campaign=id=>({id,brandId:brand.id,title:'합성 캠페인 '+id,goal:'오픈 전 인지와 첫 포장 주문을 만든다.',audience:'가상동 주민(가설)',channels:'Instagram',stores:'가상동 12',products:'떡볶이(가격 미확정)',budget:null,startDate:'',endDate:'',constraints:'할인 약속 금지.',sources:'',status:'draft',version:1,createdAt:now,updatedAt:now});
for(const who of [HO,OO])await put(who,'brand',brand.id,brand);
for(const id of ['eg-role-race','eg-meet-race','eg-retry-race','eg-brief-race','eg-role-recover','eg-meet-recover','eg-role-budget','eg-meet-budget'])await put(HO,'campaign',id,campaign(id));
for(const id of ['eg-openai','eg-openai-reject','eg-openai-5xx','eg-openai-429'])await put(OO,'campaign',id,campaign(id));
await put(HO,'worker_credential','current',{hash:'synthetic-hash',createdAt:now});

// 1) 보관과 동시에 들어온 시작: 라우트 사전 검사는 통과하지만, 잠금을 잡은 뒤 캠페인을 다시 읽어 409로 막는다. 작업·기록·제출이 생기지 않는다.
let sent=hermesPosts.length;
archiveOnLock=[HO,'eg-role-race'];
let r=await post(runRoute,HO,{action:'start',campaignId:'eg-role-race',role:'cmo'});
check('race setup: the archive landed after the route pre-check, when the start took the lock',archiveOnLock===null&&!!record(HO,'campaign','eg-role-race').archivedAt);
check('role start: a campaign archived after the route pre-check is refused inside the lock (409)',r.status===409&&r.data.error===ARCHIVED);
check('role start: the refused start creates no job and sends nothing',jobsOf(HO,'eg-role-race').length===0&&hermesPosts.length===sent&&!record(HO,'hermes_submission',`${HO}:eg-role-race:1:cmo`));
archiveOnLock=[HO,'eg-meet-race'];
r=await post(meetingsRoute,HO,{action:'start',id:'eg-m-race',campaignId:'eg-meet-race',campaignVersion:1,agenda:'합성 안건'});
check('meeting start: a campaign archived after the route pre-check is refused inside the lock (409)',archiveOnLock===null&&r.status===409&&r.data.error===ARCHIVED);
check('meeting start: the refused start writes no meeting and no job',record(HO,'team_meeting','eg-m-race')===null&&jobsOf(HO,'eg-meet-race').length===0);
// 실패 회의 재시도: 응답 검증 실패로 멈춘 실제 회의를 만든 뒤 경합으로 보관한다.
await meetingExec.executeMeeting(HO,{action:'start',id:'eg-m-retry',campaignId:'eg-retry-race',campaignVersion:1,agenda:'합성 안건'});
await meetingExec.executeMeeting(HO,{action:'advance',id:'eg-m-retry'});
await meetingExec.executeMeeting(HO,{action:'advance',id:'eg-m-retry'});
const failedMeeting=record(HO,'team_meeting','eg-m-retry'),failedStep=failedMeeting.steps.find(s=>s.status!=='completed');
check('retry setup: the meeting stopped on an invalid step output',failedMeeting.status==='failed'&&failedStep.failureKind==='invalid_output');
sent=hermesPosts.length;archiveOnLock=[HO,'eg-retry-race'];
r=await post(meetingsRoute,HO,{action:'retry_failed',id:'eg-m-retry',stepId:failedStep.id,expectedAttempt:0});
check('meeting retry_failed: a campaign archived after the route pre-check is refused inside the lock (409)',archiveOnLock===null&&r.status===409&&r.data.error===ARCHIVED);
assert.deepEqual(record(HO,'team_meeting','eg-m-retry'),failedMeeting,'the refused retry leaves the failed meeting as it was');passed.push('the refused retry leaves the failed meeting as it was');
check('the refused retry sends nothing',hermesPosts.length===sent);
archiveOnLock=[HO,'eg-brief-race'];
r=await post(briefRoute,HO,{action:'start',id:'eg-b-race',campaignId:'eg-brief-race',campaignVersion:1,data:{brandId:brand.id,title:'합성 초안',goal:'합성 목표'}});
check('campaign brief draft start: a campaign archived after the route pre-check is refused inside the lock (409)',archiveOnLock===null&&r.status===409&&r.data.error===ARCHIVED);
check('the refused draft writes no draft or submission and sends nothing',record(HO,'brief_draft','eg-b-race')===null&&record(HO,'hermes_submission','brief-eg-b-race')===null&&hermesPosts.length===sent);

// 2) 이미 시작된 작업의 복구는 보관 중에도 막지 않는다(같은 요청·같은 멱등 키로 다시 보낸다).
hermesMode='lost';
await roleExec.executeRole(HO,{action:'start',campaignId:'eg-role-recover',role:'cmo'});
const lostRole=jobsOf(HO,'eg-role-recover')[0];
check('recover setup: a lost acknowledgement leaves the role job uncertain',lostRole.status==='uncertain'&&!lostRole.provider_id);
archiveNow(HO,'eg-role-recover');sent=hermesPosts.length;
r=await post(runRoute,HO,{action:'recover',id:lostRole.id});
const recoveredRole=jobsOf(HO,'eg-role-recover')[0];
check('role recover still works on an archived campaign',r.status===200&&recoveredRole.status==='queued'&&!!recoveredRole.provider_id);
check('role recover resends the identical body once',hermesPosts.length===sent+1&&hermesPosts.at(-1)===hermesPosts.at(-2));
await meetingExec.executeMeeting(HO,{action:'start',id:'eg-m-recover',campaignId:'eg-meet-recover',campaignVersion:1,agenda:'합성 안건'});
hermesMode='lost';
check('recover setup: a lost acknowledgement leaves the meeting uncertain',(await call(await meetingExec.executeMeeting(HO,{action:'advance',id:'eg-m-recover'}))).data.status==='uncertain');
archiveNow(HO,'eg-meet-recover');sent=hermesPosts.length;
r=await post(meetingsRoute,HO,{action:'recover',id:'eg-m-recover'});
check('meeting recover still works on an archived campaign',r.status===200&&r.data.status==='running'&&hermesPosts.length===sent+1&&hermesPosts.at(-1)===hermesPosts.at(-2));

// 3) OpenAI 직접 경로 예산 가드: 상한 초과면 요청 0회·409·작업은 사유와 함께 실패(접수 불확실 아님). 미설정이면 막지 않고 경고만.
await setBudget(OO,1);
let res=await call(await roleExec.executeRole(OO,{action:'start',campaignId:'eg-openai',role:'cmo'}));
let job=jobsOf(OO,'eg-openai')[0];
check('OpenAI path: over the budget answers 409 with the budget reason',res.status===409&&EXCEEDED.test(res.data.error)&&/남은 예산 1토큰/.test(res.data.error));
check('OpenAI path: no request is sent when the budget blocks it',openaiPosts.length===0);
check("OpenAI path: the job fails with the budget reason (not 'uncertain')",job.status==='failed'&&EXCEEDED.test(job.error)&&!job.provider_id);
check('OpenAI path: a blocked request leaves no reservation',reservations(OO).length===0);
await setBudget(OO,null);
res=await call(await roleExec.executeRole(OO,{action:'start',campaignId:'eg-openai',role:'cmo'}));
job=jobsOf(OO,'eg-openai')[0];
const held=record(OO,'token_reservation',job.id),unset=plain(await budget.tokenBudgetSummary(DB,OO));
check('unset budget does not block: the retried run is sent once and queued',res.status===200&&res.data.status==='queued'&&openaiPosts.length===1&&job.status==='queued'&&/^resp_/.test(job.provider_id));
check('unset budget only warns',unset.workspace.limit===null&&unset.warning===budget.UNSET_WARNING);
check('the sent request is reserved as a role run of its campaign and counted in progress',!!held&&held.kind==='role'&&held.campaignId==='eg-openai'&&held.estimatedTokens>0&&unset.workspace.inProgress===held.estimatedTokens);
// 제출 본문 불변: 보낸 요청은 저장한 제출 원문과 바이트 동일하고 필드도 그대로다(가드는 요청을 바꾸지 않는다).
check('the sent request is byte-identical to the stored submission',openaiPosts[0]===record(OO,'openai_submission',job.id).body);
check('the request keeps its fields',JSON.stringify(Object.keys(JSON.parse(openaiPosts[0])))==='["model","instructions","input","max_output_tokens","background","store","metadata"]');
res=await call(await roleExec.executeRole(OO,{action:'poll',id:job.id}));
const settled=plain(await budget.tokenBudgetSummary(DB,OO));
check('terminal OpenAI usage settles the reservation (reported tokens replace the estimate)',res.data.status==='completed'&&!record(OO,'token_reservation',job.id)&&settled.workspace.inProgress===0&&settled.workspace.used===2000);
openaiMode='reject';res=await call(await roleExec.executeRole(OO,{action:'start',campaignId:'eg-openai-reject',role:'cmo'}));job=jobsOf(OO,'eg-openai-reject')[0];
check('a definite OpenAI rejection (4xx) fails the job and releases its reservation',res.status===400&&job.status==='failed'&&!record(OO,'token_reservation',job.id)&&openaiPosts.length===2);
openaiMode='5xx';res=await call(await roleExec.executeRole(OO,{action:'start',campaignId:'eg-openai-5xx',role:'cmo'}));job=jobsOf(OO,'eg-openai-5xx')[0];
check('an OpenAI 5xx leaves the job uncertain and keeps its reservation',res.status===502&&job.status==='uncertain'&&!!record(OO,'token_reservation',job.id));
openaiMode='ok';res=await call(await roleExec.executeRole(OO,{action:'resolve_uncertain',id:job.id,confirmed:true}));
check('confirming the request was not received fails the job but keeps its reservation (5xx rule; a rerun replaces the same row)',res.status===200&&jobsOf(OO,'eg-openai-5xx')[0].status==='failed'&&!!record(OO,'token_reservation',job.id));
openaiMode='429';res=await call(await roleExec.executeRole(OO,{action:'start',campaignId:'eg-openai-429',role:'cmo'}));job=jobsOf(OO,'eg-openai-429')[0];
check('an OpenAI 429 fails the job but keeps its reservation (same rule as HERMES)',res.status===429&&job.status==='failed'&&!!record(OO,'token_reservation',job.id));
// 재실행(같은 작업 id·같은 본문)도 매번 상한을 다시 확인한다. OpenAI 요청에는 멱등 키가 없어 재실행은 새 유료 요청이다. 앞 시도의 예약이 남아 있어도 확인 없이 보내지 않는다.
await setBudget(OO,1);const openaiSent=openaiPosts.length;openaiMode='ok';
res=await call(await roleExec.executeRole(OO,{action:'start',campaignId:'eg-openai-429',role:'cmo'}));job=jobsOf(OO,'eg-openai-429')[0];
check('rerunning a job whose earlier reservation is still held re-checks the budget (409 with the reason)',res.status===409&&EXCEEDED.test(res.data.error));
check('the blocked rerun sends nothing and fails the job with the reason',openaiPosts.length===openaiSent&&job.status==='failed'&&EXCEEDED.test(job.error)&&reservations(OO).filter(x=>x.submissionId===job.id).length===1);
await setBudget(OO,null);openaiMode='reject';
res=await call(await roleExec.executeRole(OO,{action:'start',campaignId:'eg-openai-429',role:'cmo'}));job=jobsOf(OO,'eg-openai-429')[0];
check('a rerun rejected by OpenAI (4xx) releases the reservation left by the earlier attempt',res.status===400&&job.status==='failed'&&openaiPosts.length===openaiSent+1&&!record(OO,'token_reservation',job.id));
openaiMode='ok';

// 4) 복구 중 예산 초과: 예약 없이 복구에 들어온 제출(기능 배포 전 저장 등)이 가드에 막히면 '확인 지연·확인 필요'가 아니라 사유와 함께 실패로 남긴다.
await meetingExec.executeMeeting(HO,{action:'start',id:'eg-m-budget',campaignId:'eg-meet-budget',campaignVersion:1,agenda:'합성 안건'});
hermesMode='lost';
check('budget setup: a lost acknowledgement leaves the meeting uncertain',(await call(await meetingExec.executeMeeting(HO,{action:'advance',id:'eg-m-budget'}))).data.status==='uncertain');
hermesMode='lost';await roleExec.executeRole(HO,{action:'start',campaignId:'eg-role-budget',role:'cmo'});
const budgetRole=jobsOf(HO,'eg-role-budget')[0];
check('budget setup: a lost acknowledgement leaves the role job uncertain',budgetRole.status==='uncertain'&&!budgetRole.provider_id);
dropReservations(HO,'eg-meet-budget');dropReservations(HO,'eg-role-budget');
await setBudget(HO,1);sent=hermesPosts.length;
res=await call(await meetingExec.executeMeeting(HO,{action:'recover',id:'eg-m-budget'}));
const blockedMeeting=record(HO,'team_meeting','eg-m-budget'),meetingJob=rt.sql.prepare('SELECT status FROM jobs WHERE owner=? AND id=?').get(HO,`${HO}:meeting:eg-m-budget`);
check("meeting recover over the budget fails with the budget reason (not 'confirmation delayed')",res.status===200&&res.data.status==='failed'&&EXCEEDED.test(res.data.error)&&blockedMeeting.status==='failed'&&EXCEEDED.test(blockedMeeting.error));
check('the blocked meeting step and job row are failed too',blockedMeeting.steps.some(s=>s.status==='failed')&&!blockedMeeting.steps.some(s=>s.status==='uncertain')&&meetingJob.status==='failed');
res=await call(await roleExec.executeRole(HO,{action:'recover',id:budgetRole.id}));
const blockedRole=jobsOf(HO,'eg-role-budget')[0];
check('role recover over the budget answers 409 with the budget reason',res.status===409&&EXCEEDED.test(res.data.error));
check("role recover over the budget fails the job with the reason (not left 'uncertain')",blockedRole.status==='failed'&&EXCEEDED.test(blockedRole.error));
check('no blocked recovery sent a request',hermesPosts.length===sent);
await setBudget(HO,null);

// 5) 배선: OpenAI 가드는 요청을 보낸 것으로 표시(providerAccepted)하기 전, 요청 직전에 있다. 잠금 해제 뒤 채점(gradeAfterUnlock)은 finally에 그대로다.
const roleSource=readFileSync('lib/role-execution.ts','utf8'),startBranch=roleSource.slice(roleSource.indexOf("if(b.action==='start')"),roleSource.indexOf("if(b.action==='recover'||"));
const guardAt=startBranch.indexOf('reserveDirectCall('),acceptedAt=startBranch.indexOf('providerAccepted=true'),requestAt=startBranch.indexOf("openai('responses'");
check('the OpenAI budget guard runs before providerAccepted and before the request',guardAt>0&&guardAt<acceptedAt&&acceptedAt<requestAt);
check('grading after unlock stays in finally',/finally\{if\(lockToken\)await releaseLock\(lockOwner,lockToken\);if\(gradeAfterUnlock\)await gradeAfterUnlock\(\)\}/.test(roleSource));
check('no external network call',external.length===0);
console.log(JSON.stringify({passed:passed.length,checks:passed},null,2));
