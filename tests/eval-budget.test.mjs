// 평가 월 승인 레코드(Q2): 승인 없음=기본 1,500,000, 승인 반영(시작·제출 직전·GET usage), UTC 월 경계, 소유자 전용(관리자·직원 403),
// 승인 cap을 넘는 제출은 건별 승인(overBudgetApproved)이 있어도 monthly_cap_reached로 멈춤, 월당 1행과 갱신 이력.
// 근거: mocked(평가 HERMES fetch 스텁, 메모리 SQLite, 합성 브랜드·캠페인·run). 외부 네트워크·유료 모델 호출은 0회다.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {testRuntime} from './helpers/runtime.mjs';
import {roleFixture} from './helpers/role-fixture.mjs';

const EVAL='https://eval-hermes.example.com';
const capabilities={object:'hermes.api_server.capabilities',platform:'hermes-agent',features:{run_submission:true,run_status:true,run_stop:true,runs_idempotency:{durable:true,enabled:true,supported:true}}};
const external=[],hermesRuns=new Map(),submissions=[];let seq=0;
const {sql,env,load}=testRuntime(async(url,options={})=>{
 url=String(url);const headers=new Headers(options.headers||{}),method=options.method||'GET';
 if(!url.startsWith(EVAL+'/')){external.push(url);throw new Error('모의 주소만 호출합니다: '+url)}
 const path=url.slice(EVAL.length);
 if(!headers.get('authorization'))return new Response('{}',{status:401});
 if(path==='/v1/capabilities')return Response.json(capabilities);
 if(path==='/v1/models')return Response.json({data:[{id:'mock-eval-model'}]});
 if(path==='/v1/runs'&&method==='POST'){const id='eval_'+ ++seq;submissions.push(id);hermesRuns.set(id,JSON.parse(options.body));return Response.json({run_id:id})}
 const id=/^\/v1\/runs\/([\w-]+)$/.exec(path)?.[1];if(!id||!hermesRuns.has(id))return new Response('{}',{status:404});
 return Response.json({object:'hermes.run',run_id:id,status:'completed',output:roleFixture(hermesRuns.get(id).input),usage:{input_tokens:1000,output_tokens:500,total_tokens:1500},model:'mock-eval-model'});
});
const server=await load('lib/server.ts'),budget=await load('lib/eval-budget-server.ts'),evalServer=await load('lib/eval-server.ts');
const route=await load('app/api/eval/route.ts'),background=await load('lib/background-execution.ts');
const passed=[];const check=(name,value)=>{assert.ok(value,name);passed.push(name)};
const plain=v=>JSON.parse(JSON.stringify(v));
const approvals=()=>sql.prepare("SELECT id,data FROM records WHERE kind='eval_budget_approval' ORDER BY id").all().map(r=>({id:r.id,...JSON.parse(r.data)}));
const rejects=async(fn,status,name)=>{await assert.rejects(fn,e=>e.status===status,name);passed.push(name)};

// 1) 기본값·UTC 월 경계(순수 함수와 직접 호출). 평가 월은 UTC 달력 월이다(운영 토큰 예산의 한국 시간 월과 다르다).
const direct='budget-direct',by={id:direct,email:null};
check('default monthly cap is 1,500,000 and matches the eval server constant',budget.EVAL_DEFAULT_MONTHLY_TOKEN_CAP===1500000&&evalServer.EVAL_MONTHLY_TOKEN_CAP===1500000);
check('last UTC millisecond of September is September',budget.evalMonthOf(new Date('2026-09-30T23:59:59.999Z'))==='2026-09');
check('UTC midnight of October 1 is October',budget.evalMonthOf(new Date('2026-10-01T00:00:00.000Z'))==='2026-10');
check('KST midnight of October 1 is still September in UTC',budget.evalMonthOf(new Date('2026-09-30T15:00:00.000Z'))==='2026-09');
check('UTC new year rolls the year',budget.evalMonthOf(new Date('2026-12-31T23:59:59.999Z'))==='2026-12'&&budget.evalMonthOf(new Date('2027-01-01T00:00:00.000Z'))==='2027-01');
check('no approval means the default cap',await budget.monthlyCapFor(direct,'2026-10')===1500000);
check('month budget without approval reports the default and no approval',JSON.stringify(plain(await budget.evalMonthBudget(direct,'2026-10')))==='{"monthlyCap":1500000,"approval":null}');

// 2) 승인 저장: 월당 1행, 그 달만 바뀐다. 지난 달(UTC)은 바꿀 수 없다.
const endOfSeptember=new Date('2026-09-30T23:59:59.999Z'),startOfOctober=new Date('2026-10-01T00:00:00.000Z');
const R1='토큰 상한 증액 승인 -> 승인한다(기준선 달 월 2.4M)';
const first=plain(await budget.setBudgetApproval(direct,{month:'2026-10',cap:2400000,reason:R1},by,endOfSeptember));
check('approval stores month, cap, reason, approver and time',first.month==='2026-10'&&first.cap===2400000&&first.reason===R1&&first.by.id===direct&&first.by.email===null&&typeof first.createdAt==='string'&&JSON.stringify(first.history)==='[]');
check('approval is reflected for its month',await budget.monthlyCapFor(direct,'2026-10')===2400000);
check('month budget returns the approval with the reflected cap',(b=>b.monthlyCap===2400000&&b.approval.cap===2400000&&b.approval.reason===R1)(plain(await budget.evalMonthBudget(direct,'2026-10'))));
check('other months keep the default cap',await budget.monthlyCapFor(direct,'2026-09')===1500000&&await budget.monthlyCapFor(direct,'2026-11')===1500000);
check('another owner keeps the default cap',await budget.monthlyCapFor('budget-stranger','2026-10')===1500000);
check('one row per month keyed by the month',JSON.stringify(approvals().map(a=>a.id))===JSON.stringify([`${direct}:eval_budget_approval:2026-10`]));
await rejects(()=>budget.setBudgetApproval(direct,{month:'2026-09',cap:2400000,reason:R1},by,startOfOctober),400,'a past UTC month cannot be approved');
check('the current UTC month can still be approved at its first millisecond',(await budget.setBudgetApproval(direct,{month:'2026-10',cap:2400000,reason:R1},by,startOfOctober)).cap===2400000);
sql.prepare("DELETE FROM records WHERE kind='eval_budget_approval'").run();

// 3) 입력 검증: 형식이 틀리면 400이고 아무것도 쓰지 않는다.
for(const month of ['2026-13','2026-00','2026-9','26-10','2026-10-01','',' 2026-10',undefined,null,202610])await rejects(()=>budget.setBudgetApproval(direct,{month,cap:2400000,reason:R1},by,endOfSeptember),400,`month ${JSON.stringify(month)} is 400`);
for(const cap of [0,-1,1.5,'2400000',null,undefined,budget.EVAL_BUDGET_APPROVAL_MAX_CAP+1])await rejects(()=>budget.setBudgetApproval(direct,{month:'2026-10',cap,reason:R1},by,endOfSeptember),400,`cap ${JSON.stringify(cap)} is 400`);
for(const reason of ['','   ',undefined,'x'.repeat(501)])await rejects(()=>budget.setBudgetApproval(direct,{month:'2026-10',cap:2400000,reason},by,endOfSeptember),400,`reason ${JSON.stringify(reason)?.slice(0,12)} is 400`);
check('rejected approvals write nothing',approvals().length===0);
check('the largest allowed cap is accepted',(await budget.setBudgetApproval(direct,{month:'2026-10',cap:budget.EVAL_BUDGET_APPROVAL_MAX_CAP,reason:'상한 경계'},by,endOfSeptember)).cap===budget.EVAL_BUDGET_APPROVAL_MAX_CAP);
sql.prepare("DELETE FROM records WHERE kind='eval_budget_approval'").run();

// 4) 이력: 같은 달을 다시 승인하면 행은 하나로 두고 이전 승인(cap·사유·승인자·시각)을 오래된 순서로 history에 남긴다.
await budget.setBudgetApproval(direct,{month:'2026-10',cap:2400000,reason:R1},by,endOfSeptember);
const second=plain(await budget.setBudgetApproval(direct,{month:'2026-10',cap:2000000,reason:'파일럿 평균 1.2배 초과로 중단·재보고'},{id:'budget-approver-2',email:'a2@test.invalid'},endOfSeptember));
check('re-approval keeps a single row for the month',approvals().length===1&&second.cap===2000000&&second.by.id==='budget-approver-2');
check('re-approval keeps the previous approval in history',second.history.length===1&&second.history[0].cap===2400000&&second.history[0].reason===R1&&second.history[0].by.id===direct&&typeof second.history[0].createdAt==='string'&&!('history' in second.history[0])&&!('month' in second.history[0]));
const third=plain(await budget.setBudgetApproval(direct,{month:'2026-10',cap:2600000,reason:'S8 추가'},by,endOfSeptember));
check('history grows oldest first and the current cap is the latest',third.cap===2600000&&JSON.stringify(third.history.map(h=>h.cap))==='[2400000,2000000]'&&await budget.monthlyCapFor(direct,'2026-10')===2600000);
check('stored row equals the returned approval',JSON.stringify(approvals()[0].history)===JSON.stringify(third.history)&&approvals()[0].cap===2600000);
// 이력을 버리지 않는다: 한 달의 이력이 EVAL_BUDGET_HISTORY_MAX(50)건에 닿으면 더 받지 않고 409로 답하며 행은 그대로다.
for(let i=1;i<=budget.EVAL_BUDGET_HISTORY_MAX+1;i++)await budget.setBudgetApproval(direct,{month:'2026-11',cap:1500000+i,reason:`합성 재승인 ${i}`},by,endOfSeptember);
const full=JSON.stringify(approvals().find(a=>a.month==='2026-11'));
await rejects(()=>budget.setBudgetApproval(direct,{month:'2026-11',cap:2400000,reason:'이력 한도 넘김'},by,endOfSeptember),409,'a month whose history is full refuses another approval');
check('the full history is kept unchanged',budget.EVAL_BUDGET_HISTORY_MAX===50&&JSON.stringify(approvals().find(a=>a.month==='2026-11'))===full&&JSON.parse(full).history.length===50&&JSON.parse(full).history[0].cap===1500001&&JSON.parse(full).cap===1500051);
sql.prepare("DELETE FROM records WHERE kind='eval_budget_approval'").run();

// 5) API·평가 실행(POST /api/eval set_budget_approval, GET usage, 시작·제출 직전 월 상한). 합성 브랜드·캠페인이다.
const owner='budget-owner',now=new Date().toISOString();
const put=(kind,id,data,parent='')=>server.recordStatement(owner,kind,id,data,parent).run();
const call=async res=>({status:res.status,body:await res.json()});
const post=(input,extra={})=>route.POST(new Request('https://agency.test/api/eval',{method:'POST',headers:{'oai-authenticated-user-id':owner,'content-type':'application/json',...extra},body:JSON.stringify(input)})).then(call);
const get=(query='',extra={})=>route.GET(new Request('https://agency.test/api/eval'+query,{headers:{'oai-authenticated-user-id':owner,...extra}})).then(call);
const month=new Date().toISOString().slice(0,7),monthRow=()=>approvals().filter(a=>a.id===`${owner}:eval_budget_approval:${month}`),monthStart=new Date(Date.UTC(new Date().getUTCFullYear(),new Date().getUTCMonth(),1));
const lastMonth=new Date(monthStart.getTime()-86400000).toISOString().slice(0,7),nextMonth=new Date(Date.UTC(monthStart.getUTCFullYear(),monthStart.getUTCMonth()+1,1)).toISOString().slice(0,7);
const brand={id:'budget-brand',name:'가상분식',short:'GB',category:'SNACK BAR',color:'#224466',bg:'#eef2f6',description:'합성 소개(미확인).',audience:'가상동 주민(가설)',tone:'명료한',constraints:'가격은 확인 전 확정하지 않는다.',knowledge:'합성 메모.'};
const campaign={id:'budget-campaign',brandId:brand.id,title:'가상분식 오픈',goal:'오픈 전 인지와 첫 포장 주문을 만든다.',audience:'가상동 주민(가설)',channels:'Instagram, 매장 안내',stores:'가상동 12',products:'떡볶이(가격 미확정)',budget:null,startDate:'',endDate:'',constraints:'할인 약속 금지.',sources:'',status:'draft',version:1,createdAt:now,updatedAt:now};
await put('brand',brand.id,brand);await put('campaign',campaign.id,campaign);
let r=await post({action:'save_connection',endpoint:EVAL,key:'eval-secret-key',isolationConfirmed:true,note:'메모리 off 평가 프로필'});
check('eval connection is ready',r.status===200&&r.body.status==='ready');
const kase=(await post({action:'capture_case',campaignId:campaign.id,role:'cmo',label:'예산 케이스'})).body;
check('a case is captured for the budget runs',typeof kase.id==='string');
const seeded=(id,usedTokens)=>put('eval_run',id,{id,label:'합성 누적',variant:'active',set:null,caseIds:[],tokenBudget:usedTokens,usedTokens,status:'completed',results:[],host:null,createdAt:now,updatedAt:now,createdBy:{id:owner,email:null}});
const runOf=async id=>(await get('?run='+encodeURIComponent(id))).body;
async function drive(id,max=12){for(let i=0;i<max;i++){const run=await runOf(id);if(!['queued','running'].includes(run.status))return run;await background.advanceBackgroundWork(owner)}return runOf(id)}

r=await get();
check('GET usage without an approval shows the default cap and no approval',r.status===200&&r.body.usage.month===month&&r.body.usage.monthlyCap===1500000&&r.body.usage.approval===null);
await seeded('seed-used',2300000);
r=await post({action:'start_run',caseIds:[kase.id],tokenBudget:100000});
check('without an approval the default cap blocks the start',r.status===409&&/1,500,000/.test(r.body.error));
r=await post({action:'set_budget_approval',month:lastMonth,cap:2400000,reason:R1});
check('the API rejects a past month',r.status===400);
r=await post({action:'set_budget_approval',month,cap:2400000,reason:R1});
check('owner records the monthly approval through the API',r.status===200&&r.body.month===month&&r.body.cap===2400000&&r.body.reason===R1&&r.body.by.id===owner&&JSON.stringify(r.body.history)==='[]');
r=await post({action:'set_budget_approval',month:nextMonth,cap:3000000,reason:'다음 달 사전 승인'});
check('next month can be approved in advance',r.status===200&&r.body.month===nextMonth);
r=await get();
check('GET usage reflects this month\'s approval only',r.body.usage.monthlyCap===2400000&&r.body.usage.approval.month===month&&r.body.usage.approval.cap===2400000&&r.body.usage.approval.reason===R1&&r.body.usage.usedTokens===2300000);
r=await post({action:'start_run',caseIds:[kase.id],tokenBudget:100000});
check('the approved cap lets a run start without a per-run approval',r.status===200&&!r.body.overBudgetApproved);
let before=submissions.length;const within=await drive(r.body.id);
check('a run under the approved cap submits and completes',within.status==='completed'&&within.results[0].status==='completed'&&submissions.length===before+1&&!within.stopReason);

// 건별 승인은 월 상한을 올리지 못한다: 첫 케이스 예약(50,000)도 승인 cap에 들어가지 않으면(누적 2,381,500) 승인이 있어도 제출 0건 run이므로 기록하지 않고 409로 월 승인을 안내한다.
const runCount=()=>sql.prepare("SELECT COUNT(*) n FROM records WHERE owner=? AND kind='eval_run'").get(owner).n;
await seeded('seed-overshoot',80000);
let runsBefore=runCount();
r=await post({action:'start_run',caseIds:[kase.id],tokenBudget:100000});
check('a start whose first case does not fit the approved cap names the cap and the monthly approval',r.status===409&&/2,400,000/.test(r.body.error)&&/set_budget_approval/.test(r.body.error)&&runCount()===runsBefore);
r=await post({action:'start_run',caseIds:[kase.id],tokenBudget:100000,overBudgetApproved:{reason:'합성 승인: 월 승인 cap 초과 시도'}});
check('a per-run approval cannot start a run with no case fitting the approved cap (no run recorded)',r.status===409&&/2,400,000/.test(r.body.error)&&/set_budget_approval/.test(r.body.error)&&runCount()===runsBefore);
sql.prepare("DELETE FROM records WHERE owner=? AND kind='eval_run' AND id=?").run(owner,`${owner}:eval_run:seed-overshoot`);
// 실패 사례(설계 교차 검토 1-3): 첫 케이스는 들어가고 run 예산은 월 cap을 넘는 run(누적 2,349,000)은 건별 승인으로 시작하지만, 제출 직전마다 월 누적을 봐서 승인 cap을 넘는 두 번째 제출은 monthly_cap_reached로 멈춘다.
const kase2=(await post({action:'capture_case',campaignId:campaign.id,role:'insight',label:'예산 케이스 2'})).body;
await seeded('seed-partial',2349000-(await get()).body.usage.usedTokens);
r=await post({action:'start_run',caseIds:[kase.id,kase2.id],tokenBudget:100000});
check('a partly fitting start still needs a per-run approval and points to the monthly approval',r.status===409&&/2,400,000/.test(r.body.error)&&/overBudgetApproved\.reason/.test(r.body.error)&&/set_budget_approval/.test(r.body.error));
r=await post({action:'start_run',caseIds:[kase.id,kase2.id],tokenBudget:100000,overBudgetApproved:{reason:'합성 승인: 월 승인 cap 초과 시도'}});
check('the per-run approval is still recorded',r.status===200&&JSON.stringify(r.body.overBudgetApproved.exceeded)==='["monthly_cap"]');
before=submissions.length;const capped=await drive(r.body.id);
check('a submission past the approved monthly cap stops with monthly_cap_reached',capped.status==='completed'&&capped.stopReason==='monthly_cap_reached'&&capped.results[0].status==='completed'&&capped.results[1].status==='not_run'&&/2,400,000/.test(capped.results[1].error)&&submissions.length===before+1);
r=await post({action:'set_budget_approval',month,cap:2600000,reason:'S8 추가(합성)'});
check('raising the approval keeps the previous one in history',r.status===200&&r.body.cap===2600000&&r.body.history.length===1&&r.body.history[0].cap===2400000&&monthRow().length===1);
r=await post({action:'start_run',caseIds:[kase.id],tokenBudget:100000});
check('the raised approval applies to the next start',r.status===200);
before=submissions.length;const raised=await drive(r.body.id);
check('the raised approval applies before each submission',raised.results[0].status==='completed'&&submissions.length===before+1);

// 6) 권한: 소유자만 승인한다. 관리자·직원 403, 비로그인 401. 거부된 요청은 승인을 바꾸지 않는다.
env.AUTH_MODE='email';env.AUTH_ORIGIN='https://agency.test';
const signIn=(id,role,createdAt)=>{const token=createHash('sha256').update(id).digest('hex');sql.prepare('INSERT INTO auth_users(id,email,workspace_owner,role,status,created_at) VALUES(?,?,?,?,?,?)').run(id,id+'@test.invalid',owner,role,'active',createdAt);sql.prepare('INSERT INTO auth_sessions VALUES(?,?,?,?)').run(createHash('sha256').update(token).digest('hex'),id,Date.now()+60000,Date.now());return {cookie:'__Host-collective_session='+token,origin:'https://agency.test'}};
const ownerS=signIn('budget-ws-owner','admin',1000),adminS=signIn('budget-ws-admin','admin',2000),memberS=signIn('budget-ws-member','member',500);
const stored=()=>JSON.stringify(monthRow());const beforeDenied=stored();
const attempt={action:'set_budget_approval',month,cap:9000000,reason:'권한 없는 증액 시도'};
const [anon,admin,member,adminGet]=await Promise.all([post(attempt,{origin:'https://agency.test'}),post(attempt,adminS),post(attempt,memberS),get('',adminS)]);
check('unauthenticated approval is 401',anon.status===401);
check('admin and member cannot approve or read (403)',admin.status===403&&member.status===403&&adminGet.status===403);
check('denied requests leave the approval unchanged',stored()===beforeDenied);
const ownerSet=await post({action:'set_budget_approval',month,cap:2400000,reason:'소유자 세션 재승인'},ownerS);
check('the workspace owner session approves',ownerSet.status===200&&ownerSet.body.by.id==='budget-ws-owner'&&ownerSet.body.by.email==='budget-ws-owner@test.invalid'&&ownerSet.body.history.length===2);
check('no external network call',external.length===0);
console.log(JSON.stringify({passed:passed.length}));
