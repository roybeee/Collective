// 프롬프트 활성화 게이트(F3b, 대표 결정 2·5·10): 서버 eval_run 쌍 비교(pair) → 대표(owner) 승인 → 지정 캠페인 staged → promote.
// 쌍 평가: 같은 run 안에서 케이스마다 active(레지스트리 active, 없으면 코드)와 후보 본문을 교대로 제출하고 같은 채점기로 채점한다. 멱등 키 둘, 예산은 두 제출 모두 계산.
// 게이트: pair·완료, 시작/종료 게이트웨이 해시·보고 모델 동일, 코드 채점 합격 수 후보≥active, 봉인 세트 회귀 0, input_budget 후보 전부 pass, 모델·게이트웨이 경보 동결.
// staged: 지정 캠페인만 새 버전, 지정 밖 캠페인 inputHash 불변, 이미 고정한 캠페인은 reset_pins로만 새 버전. 비율 카나리·자동 승격 없음. 권한 401·403·404.
// 근거: mocked(평가·운영 HERMES·raw.githubusercontent.com fetch 스텁, 메모리 SQLite, 합성 데이터). 외부 네트워크 호출은 0회다.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,readdirSync,statSync} from 'node:fs';
import {join} from 'node:path';
import {testRuntime} from './helpers/runtime.mjs';
import {roleFixture} from './helpers/role-fixture.mjs';
import {sha,seed,mockHermes,runRole,runMeeting,roleCampaign,rawGithub} from './helpers/prompt-seed.mjs';

// ── 모의 평가 HERMES: 모델·게이트웨이·출력 누설·입력 토큰을 시나리오마다 바꾼다 ──
const EVAL='https://eval-hermes.example.com';
const capabilities={object:'hermes.api_server.capabilities',platform:'hermes-agent',features:{run_submission:true,run_status:true,run_stop:true,runs_idempotency:{durable:true,enabled:true,supported:true}}};
const clean={toolsets:{toolsets:[{name:'web'}]},leak:()=>false,model:()=>'mock-eval-model',inputTokens:()=>1000};
let evalMode={...clean};
const evalRuns=new Map(),evalSubmits=[];let evalSeq=0;
// 누설: 첫 섹션에 입력 스키마 경로를 적어 internal_id_exposure 채점기를 fail로 만든다(나머지 채점은 그대로).
const evalOutput=sent=>{const out=JSON.parse(roleFixture(sent.input));return evalMode.leak(sent)?JSON.stringify({...out,sections:out.sections.map((s,i)=>i?s:{...s,content:s.content+' 근거 위치는 evidence.facts 기준입니다.'})}):JSON.stringify(out)};
async function evalHandler(url,options={}){
 if(!url.startsWith(EVAL+'/'))return undefined;
 const path=url.slice(EVAL.length),headers=new Headers(options.headers||{}),method=options.method||'GET';
 if(!headers.get('authorization'))return new Response('{}',{status:401});
 if(path==='/v1/capabilities')return Response.json(capabilities);
 if(path==='/v1/models')return Response.json({data:[{id:'mock-eval-model'}]});
 if(path==='/v1/toolsets')return Response.json(evalMode.toolsets);
 if(path==='/v1/runs'&&method==='POST'){const id='ev_'+ ++evalSeq,sent=JSON.parse(options.body);evalRuns.set(id,sent);evalSubmits.push({id,sent,headers:Object.fromEntries(headers)});return Response.json({run_id:id})}
 const stop=/^\/v1\/runs\/([\w-]+)\/stop$/.exec(path);if(stop)return Response.json({object:'hermes.run',run_id:stop[1],status:'stopped'});
 const id=/^\/v1\/runs\/([\w-]+)$/.exec(path)?.[1],sent=evalRuns.get(id);if(!sent)return new Response('{}',{status:404});
 return Response.json({object:'hermes.run',run_id:id,status:'completed',output:evalOutput(sent),usage:{input_tokens:evalMode.inputTokens(sent),output_tokens:500,total_tokens:1500},model:evalMode.model(sent)});
}
const raw=rawGithub(),hermes=mockHermes(async(url,options)=>await raw.handler(url)??await evalHandler(url,options));
const {sql,env,load}=testRuntime(hermes.fetch);
const server=await load('lib/server.ts'),promptRoute=await load('app/api/prompts/route.ts'),evalRoute=await load('app/api/eval/route.ts'),versionRoute=await load('app/api/version/route.ts');
const background=await load('lib/background-execution.ts'),execution=await load('lib/role-execution.ts'),meeting=await load('lib/meeting-execution.ts'),registry=await load('lib/prompt-registry.ts');
const instruction=await load('lib/role-instruction.ts'),alarm=await load('lib/usage-model-alarm.ts');
const owner='pa-owner',passed=[];
const check=(name,fn)=>{fn();passed.push(name)};
const put=await seed(server,sql,owner);
const call=async res=>({status:res.status,body:await res.json()});
const request=(path,input,user,extra)=>new Request('https://agency.test'+path,{method:'POST',headers:{'oai-authenticated-user-id':user,'content-type':'application/json',...extra},body:JSON.stringify(input)});
const prompts=(input,user=owner,extra={})=>promptRoute.POST(request('/api/prompts',input,user,extra)).then(call);
const promptsGet=(query='',user=owner)=>promptRoute.GET(new Request('https://agency.test/api/prompts'+query,{headers:{'oai-authenticated-user-id':user}})).then(call);
const evalPost=(input,user=owner)=>evalRoute.POST(request('/api/eval',input,user,{})).then(call);
const evalGet=(query='',user=owner)=>evalRoute.GET(new Request('https://agency.test/api/eval'+query,{headers:{'oai-authenticated-user-id':user}})).then(call);
const version=()=>versionRoute.GET(new Request('https://agency.test/api/version',{headers:{'oai-authenticated-user-id':owner}})).then(call);
const release=()=>server.readRecord(owner,'prompt_release','role.cmo').catch(()=>null);
const events=()=>sql.prepare("SELECT data FROM records WHERE owner=? AND kind='prompt_release_event' ORDER BY rowid").all(owner).map(r=>JSON.parse(r.data));
const manifest=entries=>sha(JSON.stringify(entries));
const approval={reason:'합성 승인: 쌍 평가 결과 확인'};

// ── 합성 버전: role.cmo 본문 여러 개를 공개 raw 경로 모의로 등록한다 ──
const baseBody=raw.repoBody('role.cmo');
const V1_FOCUS='합성 기준 초점: 첫 방문 동기를 하나로 좁힌다',V2_FOCUS='합성 개선 초점: 첫 방문 동기와 중단 조건을 함께 정한다',LEAK_FOCUS='합성 누설 초점: 근거 위치를 입력 경로로 적는다';
let refSeq=0;
async function register(unit,body){const ref=createHash('sha1').update('pa-ref-'+ ++refSeq).digest('hex');raw.publish(ref,unit,body);raw.publish('main',unit,body);const r=await prompts({action:'register',unit,sourceSha:ref});assert.equal(r.status,200,JSON.stringify(r));return r.body.version.id}
const v1=await register('role.cmo',{...baseBody,focus:V1_FOCUS}),v2=await register('role.cmo',{...baseBody,focus:V2_FOCUS}),vLeak=await register('role.cmo',{...baseBody,focus:LEAK_FOCUS});
const insightV=await register('role.insight',{...raw.repoBody('role.insight'),focus:'합성 조사 초점: 선택 장벽 하나를 먼저 확인한다'});
const viralV=await register('viral.discovery',raw.repoBody('viral.discovery'));

// ── 평가 연결·케이스: dev(오픈 캠페인)·sealed(봉인 캠페인) cmo 케이스와 역할이 다른 insight 케이스 ──
let r=await evalPost({action:'save_connection',endpoint:EVAL,key:'eval-only',isolationConfirmed:true,note:'합성 평가 프로필'});
check('eval connection is ready',()=>assert.equal(r.body.status,'ready',JSON.stringify(r)));
const sealedCampaign={...roleCampaign,id:'pa-sealed-campaign',title:'가상분식 봉인 점검'};await put('campaign',sealedCampaign.id,sealedCampaign);
const devCase=(await evalPost({action:'capture_case',campaignId:roleCampaign.id,role:'cmo',label:'dev cmo',expectations:{inputTokenCap:20000}})).body;
const sealedCase=(await evalPost({action:'capture_case',campaignId:sealedCampaign.id,role:'cmo',set:'sealed',label:'sealed cmo',expectations:{inputTokenCap:20000}})).body;
const insightCase=(await evalPost({action:'capture_case',campaignId:roleCampaign.id,role:'insight',label:'dev insight'})).body;
check('cases are captured',()=>assert.ok(devCase.id&&sealedCase.set==='sealed'&&insightCase.role==='insight'));
const isDev=sent=>sent.input.includes('가상분식 오픈'),isSealed=sent=>sent.input.includes('가상분식 봉인 점검'),uses=(sent,focus)=>sent.instructions.includes(focus);

const runOf=async id=>(await evalGet('?run='+encodeURIComponent(id))).body;
async function drive(id,max=30){for(let i=0;i<max;i++){const run=await runOf(id);if(!['queued','running'].includes(run.status))return run;await background.advanceBackgroundWork(owner)}return runOf(id)}
const startPair=(candidateVersionId,caseIds,extra={})=>evalPost({action:'start_run',pair:{unit:'role.cmo',candidateVersionId},caseIds,tokenBudget:250000,label:'합성 쌍 평가',...extra});
async function pairRun(candidateVersionId,caseIds,mode={},midway=()=>{}){
 evalMode={...clean,...mode};const s=await startPair(candidateVersionId,caseIds);assert.equal(s.status,200,JSON.stringify(s));midway();const run=await drive(s.body.id);evalMode={...clean};return run;
}
const key=(runId,caseId,variant)=>'collective-eval-'+createHash('sha256').update(`${runId}:${caseId}:${variant}`).digest('hex').slice(0,40);
const submitted=res=>evalSubmits.find(s=>s.id===res.providerRunId);

// 1) 쌍 평가 시작 검증
r=await evalPost({action:'start_run',variant:'candidate',caseIds:[devCase.id],tokenBudget:100000});
check('a lone candidate variant is still 400 (variant is active or pair)',()=>assert.ok(r.status===400&&/variant/.test(r.body.error)));
r=await startPair('role.cmo@000000000000',[devCase.id]);
check('an unregistered candidate version is 404',()=>assert.equal(r.status,404));
r=await startPair(insightV,[devCase.id]);
check('a candidate of another unit is 400',()=>assert.equal(r.status,400));
r=await evalPost({action:'start_run',pair:{unit:'viral.discovery',candidateVersionId:viralV},caseIds:[devCase.id],tokenBudget:100000});
check('viral discovery cannot be pair-evaluated with role cases (400)',()=>assert.equal(r.status,400));
r=await startPair(v1,[insightCase.id]);
check('a pair run with no case that uses the unit is 400',()=>assert.ok(r.status===400&&/케이스/.test(r.body.error)));
check('rejected pair starts record no run and submit nothing',()=>assert.ok(sql.prepare("SELECT COUNT(*) n FROM records WHERE kind='eval_run'").get().n===0&&evalSubmits.length===0));

// 2) 예산(결정 5): 두 제출을 모두 계산한다. 첫 쪽이 끝나면 run 예산에 다음 쪽 예약(50,000)이 들어가지 않아 멈춘다.
r=await startPair(v1,[devCase.id],{tokenBudget:50000});
const budgetRun=await drive(r.body.id);
check('the second submission of a case is also budgeted (budget_reached after one side)',()=>assert.ok(budgetRun.status==='completed'&&budgetRun.stopReason==='budget_reached'&&budgetRun.usedTokens===1500&&budgetRun.results.length===2&&budgetRun.results[1].status==='not_run'&&evalSubmits.length===1,JSON.stringify(budgetRun.results)));

// 3) 좋은 쌍 평가 R1: 후보 v1 vs 코드 상수(active 없음). insight 케이스는 이 단위를 쓰지 않아 빠진다.
const before1=evalSubmits.length;
const R1=await pairRun(v1,[devCase.id,sealedCase.id,insightCase.id]);
check('pair run completes both sides of every relevant case',()=>assert.ok(R1.status==='completed'&&R1.variant==='pair'&&R1.results.length===4&&R1.results.every(x=>x.status==='completed'),JSON.stringify(R1.results.map(x=>x.status))));
check('pair run records unit, candidate, code-fallback active and skipped cases',()=>assert.ok(R1.pair.unit==='role.cmo'&&R1.pair.candidateVersionId===v1&&R1.pair.activeVersionId===null&&R1.pair.skippedCases===1&&JSON.stringify(R1.caseIds)===JSON.stringify([devCase.id,sealedCase.id])));
check('sides alternate per case inside the same run',()=>assert.deepEqual(R1.results.map(x=>`${x.caseId===devCase.id?'dev':'sealed'}:${x.variant}`),['dev:active','dev:candidate','sealed:candidate','sealed:active']));
check('every side has its own new idempotency key',()=>assert.ok(R1.results.every(x=>x.idempotencyKey===key(R1.id,x.caseId,x.variant)&&submitted(x).headers['idempotency-key']===x.idempotencyKey)&&new Set(R1.results.map(x=>x.idempotencyKey)).size===4&&evalSubmits.length===before1+4));
const devActive=R1.results.find(x=>x.caseId===devCase.id&&x.variant==='active'),devCandidate=R1.results.find(x=>x.caseId===devCase.id&&x.variant==='candidate');
check('the active side sends the code constants byte for byte (no active version)',()=>assert.ok(submitted(devActive).sent.instructions===instruction.buildRoleInstruction(devCase.request)&&submitted(devActive).sent.input===instruction.buildRoleInput(devCase.request)));
check('the candidate side injects the candidate body through PromptSet',()=>assert.ok(submitted(devCandidate).sent.instructions===instruction.buildRoleInstruction({...devCase.request,prompts:{roles:{cmo:{...baseBody,focus:V1_FOCUS}}}})&&uses(submitted(devCandidate).sent,V1_FOCUS)&&devCandidate.promptHash!==devActive.promptHash));
check('both sides are graded by the same thirteen graders and report a model',()=>assert.ok(R1.results.every(x=>x.graders.length===13&&x.model==='mock-eval-model')));
check('start and end gateway snapshot hashes are recorded and equal',()=>assert.ok(R1.gatewaySnapshot.eval.hash&&R1.gatewaySnapshotEnd.eval.hash===R1.gatewaySnapshot.eval.hash));
check('pair run tokens count both submissions',()=>assert.equal(R1.usedTokens,6000));
r=await evalGet('?pair='+R1.id);
check('pair report compares the two sides and passes the gate',()=>assert.ok(r.status===200&&r.body.gate.ok===true&&r.body.gate.cases===2&&r.body.gate.sealedCases===1&&r.body.gate.sealedRegressions.length===0&&r.body.comparison.graders.length===13&&r.body.comparison.sharedCases===2,JSON.stringify(r.body.gate)));
r=await evalGet(`?run=${R1.id}&caseId=${devCase.id}&variant=candidate`);
check('each side keeps its own raw output',()=>assert.ok(r.status===200&&r.body.variant==='candidate'&&r.body.output===evalOutput(submitted(devCandidate).sent)));
// 코드 기준으로 평가한 v2 run(R1b)은 v1 활성화 뒤 오래된 기준이 된다.
const R1b=await pairRun(v2,[devCase.id]);

// 4) 게이트 기본 거부: 쌍 평가가 아니거나 다른 버전·미완료
const activeRun=(await evalPost({action:'start_run',caseIds:[devCase.id],tokenBudget:100000})).body;await drive(activeRun.id);
const activate=(versionId,evalRunId,extra={},user=owner,headers={})=>prompts({action:'activate',unit:'role.cmo',versionId,evalRunId,approval,...extra},user,headers);
r=await activate(v1,activeRun.id);
check('an active-variant run cannot open the gate (409)',()=>assert.ok(r.status===409&&/쌍 평가/.test(r.body.error)));
r=await activate(v2,R1.id);
check('a pair run for another candidate cannot open the gate (409)',()=>assert.ok(r.status===409&&/쌍 평가/.test(r.body.error)));
r=await activate(v1,budgetRun.id);
check('a pair run with a missing side cannot open the gate (409)',()=>assert.ok(r.status===409&&/두 쪽 모두/.test(r.body.error)));
r=await activate(v1,'missing-run');
check('an unknown evaluation run is 409 with a reason',()=>assert.ok(r.status===409&&/쌍 평가/.test(r.body.error)));
r=await activate(v1,R1.id,{approval:{reason:''}});
check('approval needs a reason (400)',()=>assert.equal(r.status,400));
r=await activate(v1,R1.id,{approval:undefined});
check('approval is required (400)',()=>assert.equal(r.status,400));
r=await activate(v1,R1.id,{percent:10});
check('a percentage canary field is refused (400)',()=>assert.ok(r.status===400&&/카나리/.test(r.body.error)));
check('refused activations change no pointer',()=>assert.ok(sql.prepare("SELECT COUNT(*) n FROM records WHERE kind='prompt_release'").get().n===0));

// 5) 활성화: previous←active, active←v1, evalRunId·approvedBy·history, 조작 전·후 매니페스트를 이벤트로 남긴다.
r=await activate(v1,R1.id);
let rel=await release();
check('activation passes the gate and moves the pointer',()=>assert.ok(r.status===200&&rel.active===v1&&rel.previous===null&&rel.evalRunId===R1.id&&rel.approvedBy.id===owner&&rel.stagedCampaignIds.length===0,JSON.stringify(r)));
check('release history records the activation',()=>assert.ok(rel.history.at(-1).action==='activate'&&rel.history.at(-1).to===v1&&rel.history.at(-1).from===null&&rel.history.at(-1).by.id===owner));
let ev=events().at(-1),v=await version();
check('a registry event keeps unit, versions, run, approval and manifests before and after',()=>assert.ok(ev.action==='activate'&&ev.unit==='role.cmo'&&ev.from===null&&ev.to===v1&&ev.evalRunId===R1.id&&ev.approval.reason===approval.reason&&ev.approval.by.id===owner&&typeof ev.sourceSha==='string'&&ev.manifestBefore===null&&ev.manifestAfter===manifest([{unit:'role.cmo',active:v1}])&&ev.gate.cases===2,JSON.stringify(ev)));
check('/api/version promptManifest equals the recorded manifest after',()=>assert.equal(v.body.promptManifest,ev.manifestAfter));
r=await activate(v1,R1.id);
check('re-activating the active version is 409',()=>assert.equal(r.status,409));
r=await activate(v2,R1b.id);rel=await release();
check('a run evaluated against an older active is stale (409)',()=>assert.ok(r.status===409&&/active/.test(r.body.error)&&rel.active===v1));
r=await startPair(v1,[devCase.id]);
check('a candidate equal to the current active is 400',()=>assert.equal(r.status,400));

// 6) 게이트 조건별 거부(후보 v2 vs active v1)
const R2=await pairRun(v2,[devCase.id],{},()=>{evalMode.toolsets={toolsets:[{name:'web'},{name:'browser'}]}});
check('the pair active side now uses the registry active version',()=>assert.ok(R2.pair.activeVersionId===v1&&uses(submitted(R2.results.find(x=>x.variant==='active')).sent,V1_FOCUS)));
r=await activate(v2,R2.id);
check('a gateway hash change between start and end is 409',()=>assert.ok(r.status===409&&/게이트웨이/.test(r.body.error)&&R2.gatewaySnapshotEnd.eval.hash!==R2.gatewaySnapshot.eval.hash,JSON.stringify(r.body)));
const R3=await pairRun(v2,[devCase.id],{model:sent=>uses(sent,V2_FOCUS)?'mock-eval-model-b':'mock-eval-model'});
r=await activate(v2,R3.id);
check('a different reported model between the sides is 409',()=>assert.ok(r.status===409&&/모델/.test(r.body.error)));
const R4=await pairRun(vLeak,[devCase.id],{leak:sent=>uses(sent,LEAK_FOCUS)});
r=await activate(vLeak,R4.id);
check('fewer code-grader passes for the candidate is 409',()=>assert.ok(r.status===409&&/합격 수/.test(r.body.error)&&!/봉인/.test(r.body.error),r.body.error));
const R5=await pairRun(v2,[devCase.id,sealedCase.id],{leak:sent=>(uses(sent,V2_FOCUS)&&isSealed(sent))||(uses(sent,V1_FOCUS)&&isDev(sent))});
r=await activate(v2,R5.id);
check('a sealed-set regression is 409 even when total passes tie',()=>assert.ok(r.status===409&&/봉인 세트 회귀 1건/.test(r.body.error)&&!/합격 수/.test(r.body.error),r.body.error));
const R6=await pairRun(v2,[devCase.id],{inputTokens:sent=>uses(sent,V2_FOCUS)?30000:1000});
r=await activate(v2,R6.id);
check('a candidate input_budget fail is 409',()=>assert.ok(r.status===409&&/input_budget/.test(r.body.error)));
const cancelled=(await startPair(v2,[devCase.id])).body;await evalPost({action:'cancel_run',id:cancelled.id});
r=await activate(v2,cancelled.id);
check('a cancelled pair run is 409',()=>assert.ok(r.status===409&&/끝나지/.test(r.body.error)));
rel=await release();
check('gate refusals leave the pointer on v1',()=>assert.equal(rel.active,v1));

// 7) 경보 동결(결정 10): model_change·gateway_change가 마지막 확인 이후 열려 있으면 409. acknowledge_alarms로 해제한다.
const R7=await pairRun(v2,[devCase.id,sealedCase.id]);
check('the clean v2 pair run passes the gate conditions',()=>assert.ok(R7.status==='completed'&&R7.pair.activeVersionId===v1));
r=await prompts({action:'acknowledge_alarms',reason:'합성 확인'});
check('acknowledging with nothing open is 409',()=>assert.equal(r.status,409));
await alarm.observeReportedModel(owner,{provider:'openai',kind:'role',model:'synthetic-model-a',providerRunId:'pa-a',observedAt:'2026-09-24T00:00:00.000Z'});
await alarm.observeReportedModel(owner,{provider:'openai',kind:'role',model:'synthetic-model-b',providerRunId:'pa-b',observedAt:'2026-09-24T00:01:00.000Z'});
const S={...roleCampaign,id:'pa-staged'},P={...roleCampaign,id:'pa-pinned'},O1={...roleCampaign,id:'pa-outside-1'},O2={...roleCampaign,id:'pa-outside-2'},O3={...roleCampaign,id:'pa-outside-3'};
for(const c of [S,P,O1,O2,O3])await put('campaign',c.id,c);
const stage=(extra={},user=owner,headers={})=>prompts({action:'stage',unit:'role.cmo',versionId:v2,evalRunId:R7.id,campaignIds:[S.id,P.id],approval,...extra},user,headers);
r=await stage();
check('an open model_change alarm freezes staging (409)',()=>assert.ok(r.status===409&&/경보/.test(r.body.error)));
r=await promptsGet();
check('the overview lists the open alarm',()=>assert.ok(r.body.alarms.open.length===1&&r.body.alarms.open[0].kind==='model_change'));
r=await prompts({action:'acknowledge_alarms'});
check('acknowledging needs a reason (400)',()=>assert.equal(r.status,400));
r=await prompts({action:'acknowledge_alarms',reason:'합성 확인',evalRunId:'missing-run'});
check('acknowledging with an unknown evidence run is 404',()=>assert.equal(r.status,404));
r=await prompts({action:'acknowledge_alarms',reason:'합성 확인: 골든 스모크 재실행 결과 동일',evalRunId:R7.id});
const ack=sql.prepare("SELECT data FROM records WHERE owner=? AND kind='prompt_alarm_ack'").all(owner).map(x=>JSON.parse(x.data));
check('acknowledgement records the alarms, reason, evidence run and actor',()=>assert.ok(r.status===200&&ack.length===1&&ack[0].alarms.length===1&&ack[0].alarms[0].kind==='model_change'&&ack[0].evalRunId===R7.id&&ack[0].by.id===owner&&ack[0].reason.includes('골든')));
await put('gateway_change','2026-09-24',{id:'2026-09-24',detectedAt:'2026-09-24T01:00:00.000Z',fromHash:'a'.repeat(64),toHash:'b'.repeat(64),fromDate:'2026-09-23',toDate:'2026-09-24',sections:[]});
r=await stage();
check('a gateway_change after the last acknowledgement freezes again (409)',()=>assert.ok(r.status===409&&/경보/.test(r.body.error)));
await prompts({action:'acknowledge_alarms',reason:'합성 확인: 게이트웨이 변경 검토'});

// 8) 지정 캠페인 staged: 고정 전 실행 기록을 만든다(O1: 지정 밖 기준, P: v1 고정).
const o1=await runRole(execution,server,owner,O1,'cmo'),p1=await runRole(execution,server,owner,P,'cmo');
check('before staging, campaigns run the active v1 body',()=>assert.ok(o1.status==='completed'&&o1.instructions.includes(V1_FOCUS)&&p1.instructions.includes(V1_FOCUS)));
r=await stage({campaignIds:[]});
check('staging needs at least one campaign (400)',()=>assert.equal(r.status,400));
r=await stage({campaignIds:['pa-missing-campaign']});
check('staging an unknown campaign is 404',()=>assert.equal(r.status,404));
r=await stage({ratio:0.1});
check('a ratio canary on stage is refused (400)',()=>assert.ok(r.status===400&&/카나리/.test(r.body.error)));
const manifestBeforeStage=(await version()).body.promptManifest;
r=await stage();
rel=await release();ev=events().at(-1);
check('stage applies v2 to the listed campaigns only and keeps v1 as the baseline',()=>assert.ok(r.status===200&&rel.active===v2&&rel.baseline===v1&&rel.previous===v1&&JSON.stringify(rel.stagedCampaignIds)===JSON.stringify([S.id,P.id].sort())&&rel.evalRunId===R7.id,JSON.stringify(r.body)));
check('stage event records the staged campaigns and both manifests',()=>assert.ok(ev.action==='stage'&&ev.to===v2&&ev.from===v1&&ev.manifestBefore===manifestBeforeStage&&ev.manifestAfter===manifest([{unit:'role.cmo',active:v2,baseline:v1,stagedCampaignIds:[S.id,P.id].sort()}])&&JSON.stringify(ev.stagedCampaignIds)===JSON.stringify([S.id,P.id].sort())));
check('stage reports listed campaigns that already hold a pin',()=>assert.deepEqual(r.body.pinnedCampaignIds,[P.id]));
const o2=await runRole(execution,server,owner,O2,'cmo');
check('a campaign outside the staged list keeps the same inputHash, instructions and input',()=>assert.ok(o2.inputHash===o1.inputHash&&o2.instructions===o1.instructions&&o2.input===o1.input));
const s1=await runRole(execution,server,owner,S,'cmo');
const sArtifact=(await server.listRecords(owner,'artifact',S.id)).find(a=>a.role==='cmo');
check('a staged campaign runs the staged v2 body',()=>assert.ok(s1.status==='completed'&&s1.instructions.includes(V2_FOCUS)&&s1.inputHash!==o1.inputHash&&sArtifact.promptVersion===v2));
const met=await runMeeting(meeting,server,owner,S,'pa-meeting-staged');
check('the staged campaign meeting snapshot promptVersion equals its role run promptVersion',()=>assert.ok(met.meeting.snapshot.prompts.promptVersion===sArtifact.promptVersion&&met.meeting.steps.filter(x=>x.role==='cmo').every(x=>x.promptVersion===sArtifact.promptVersion)));
let pinned=await registry.resolveCampaignPrompts(owner,{id:P.id,version:1});
check('an already pinned staged campaign keeps its pinned version',()=>assert.equal(pinned.units['role.cmo'],v1));
r=await prompts({action:'reset_pins',campaignIds:[P.id,O3.id]});
check('reset_pins releases the listed pins explicitly',()=>assert.ok(r.status===200&&JSON.stringify(r.body.reset)===JSON.stringify([P.id])&&JSON.stringify(r.body.unpinned)===JSON.stringify([O3.id])&&events().at(-1).action==='reset_pins'));
pinned=await registry.resolveCampaignPrompts(owner,{id:P.id,version:1});
check('after reset_pins the staged campaign resolves the staged version',()=>assert.equal(pinned.units['role.cmo'],v2));
r=await activate(v2,R7.id);
check('activate while a staging is open is 409',()=>assert.ok(r.status===409&&/지정 캠페인/.test(r.body.error)));
r=await stage();
check('stage while a staging is open is 409',()=>assert.equal(r.status,409));

// 9) 자동 승격 없음: 워커 tick이 돌아도 staged 상태 그대로다. promote만 전체 적용한다.
for(let i=0;i<3;i++)await background.advanceBackgroundWork(owner);
rel=await release();
check('worker ticks never promote a staged release',()=>assert.ok(rel.stagedCampaignIds.length===2&&rel.baseline===v1));
const sources=dir=>readdirSync(dir).flatMap(f=>{const p=join(dir,f);return statSync(p).isDirectory()?sources(p):/\.tsx?$/.test(f)?[p]:[]});
const writers=['app','lib','server'].flatMap(sources).filter(p=>/recordStatement\([^,()]+,\s*'prompt_release'/.test(readFileSync(p,'utf8')));
check('only the registry action writes prompt_release (no automatic promotion path)',()=>assert.deepEqual(writers,['lib/prompt-registry.ts']));
// 스테이징 중 롤백은 스테이징 전 상태(v1 전체 적용)로 되돌린다.
r=await prompts({action:'rollback',unit:'role.cmo',expectedActive:v2});rel=await release();
check('rollback during staging restores the pre-stage release',()=>assert.ok(r.status===200&&rel.active===v1&&rel.stagedCampaignIds.length===0&&rel.baseline===null));
r=await stage({campaignIds:[S.id]});
check('the same pair run can stage again after a rollback',()=>assert.equal(r.status,200,JSON.stringify(r.body)));
await alarm.observeReportedModel(owner,{provider:'openai',kind:'role',model:'synthetic-model-c',providerRunId:'pa-c',observedAt:'2026-09-24T02:00:00.000Z'});
r=await prompts({action:'promote',unit:'role.cmo'});
check('promote re-checks the alarm freeze (409)',()=>assert.ok(r.status===409&&/경보/.test(r.body.error)));
await prompts({action:'acknowledge_alarms',reason:'합성 확인: 모델 별칭 변경 검토'});
r=await prompts({action:'promote',unit:'role.cmo',percent:50});
check('promote refuses a percentage canary (400)',()=>assert.equal(r.status,400));
const manifestBeforePromote=(await version()).body.promptManifest;
r=await prompts({action:'promote',unit:'role.cmo'});rel=await release();ev=events().at(-1);
check('promote applies the staged version to every campaign',()=>assert.ok(r.status===200&&rel.active===v2&&rel.stagedCampaignIds.length===0&&rel.baseline===null&&rel.previous===v1&&rel.history.at(-1).action==='promote',JSON.stringify(r.body)));
check('promote event records both manifests',()=>assert.ok(ev.action==='promote'&&ev.manifestBefore===manifestBeforePromote&&ev.manifestAfter===manifest([{unit:'role.cmo',active:v2}])&&ev.evalRunId===R7.id));
v=await version();
check('/api/version follows the promotion',()=>assert.equal(v.body.promptManifest,ev.manifestAfter));
const fresh=await registry.resolveCampaignPrompts(owner,{id:O3.id,version:1}),kept=await registry.resolveCampaignPrompts(owner,{id:O2.id,version:1});
check('after promote a new campaign resolves v2 and a pinned outside campaign keeps v1 until its pin is reset',()=>assert.ok(fresh.units['role.cmo']===v2&&kept.units['role.cmo']===v1));
r=await prompts({action:'promote',unit:'role.cmo'});
check('promote without a staging is 409',()=>assert.equal(r.status,409));

// 10) 권한: owner만. member·admin 403, 다른 owner 404, 비로그인 401.
env.AUTH_MODE='email';env.AUTH_ORIGIN='https://agency.test';
const signIn=(id,role,createdAt,ws)=>{const token=createHash('sha256').update(id).digest('hex');sql.prepare('INSERT INTO auth_users(id,email,workspace_owner,role,status,created_at) VALUES(?,?,?,?,?,?)').run(id,id+'@test.invalid',ws,role,'active',createdAt);sql.prepare('INSERT INTO auth_sessions VALUES(?,?,?,?)').run(createHash('sha256').update(token).digest('hex'),id,Date.now()+60000,Date.now());return {cookie:'__Host-collective_session='+token,origin:'https://agency.test'}};
const ownerS=signIn('pa-ws-owner','admin',1000,owner),adminS=signIn('pa-ws-admin','admin',2000,owner),memberS=signIn('pa-ws-member','member',500,owner),strangerS=signIn('pa-other-owner','admin',1000,'pa-other-workspace');
const actions=[{action:'activate',unit:'role.cmo',versionId:v1,evalRunId:R1.id,approval},{action:'stage',unit:'role.cmo',versionId:v2,evalRunId:R7.id,campaignIds:[S.id],approval},{action:'promote',unit:'role.cmo'},{action:'acknowledge_alarms',reason:'합성',evalRunId:R7.id},{action:'reset_pins',campaignIds:[S.id]}];
for(const input of actions){
 const [anon,member,admin,stranger]=await Promise.all([prompts(input,owner,{origin:'https://agency.test'}),prompts(input,owner,memberS),prompts(input,owner,adminS),prompts(input,owner,strangerS)]);
 check(`${input.action}: anonymous 401, member and admin 403, another owner 404`,()=>assert.ok(anon.status===401&&member.status===403&&admin.status===403&&stranger.status===404,JSON.stringify([anon.status,member.status,admin.status,stranger.status])));
}
r=await prompts({action:'promote',unit:'role.cmo'},owner,{...ownerS,origin:'https://evil.test'});
check('cross-origin activation mutation is 403',()=>assert.equal(r.status,403));
check('no external network call (GitHub raw and both HERMES are mocked)',()=>assert.deepEqual(hermes.external,[]));
console.log(JSON.stringify({passed:passed.length}));
