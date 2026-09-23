// 토큰 예산 가드(loop-4): 미설정 통과+경고, 설정 초과 409(역할·회의·브리프·조사·학습이 HERMES 공통 제출 함수를 지남), 진행 중 예약,
// 한국 시간 월 경계, 캠페인 예산(campaignId 조인), 같은 요청 복구, 확정 거절 예약 해제, 소유자 전용 설정(관리자·직원 403).
// 근거: mocked(모의 HERMES fetch 스텁, 메모리 SQLite, 로컬 인증 헤더·세션 주입, 합성 데이터). 외부 네트워크·유료 모델 호출은 0회다.
import assert from 'node:assert/strict';
import {readFileSync,readdirSync,statSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {testRuntime} from './helpers/runtime.mjs';
import {roleFixture} from './helpers/role-fixture.mjs';

const HERMES='https://hermes.example.com';
const sent=new Map(),posts=[],external=[];let seq=0,postMode='ok',reportUsage=true;
async function fetchStub(url,options={}){
 url=String(url);const method=options.method||'GET';
 if(!url.startsWith(HERMES+'/')){external.push(url);throw new Error('모의 주소만 호출합니다: '+url)}
 const path=url.slice(HERMES.length);
 if(path==='/v1/runs'&&method==='POST'){
  posts.push(options.body);
  if(postMode==='lost'){postMode='ok';throw new Error('lost acknowledgement')}
  if(postMode==='reject')return new Response('{}',{status:400});
  if(postMode==='429'){postMode='ok';return new Response('{}',{status:429})}
  const id='run_'+ ++seq;sent.set(id,options.body);return Response.json({run_id:id});
 }
 const id=/^\/v1\/runs\/([\w-]+)$/.exec(path)?.[1];if(!id||!sent.has(id))return new Response('{}',{status:404});
 return Response.json({object:'hermes.run',run_id:id,status:'completed',output:roleFixture(JSON.parse(sent.get(id)).input),...(reportUsage?{usage:{input_tokens:1200,output_tokens:800,total_tokens:2000}}:{}),model:'reported-model-a'});
}
const {sql,env,load}=testRuntime(fetchStub);
const server=await load('lib/server.ts'),budget=await load('lib/token-budget.ts');
const roleExec=await load('lib/role-execution.ts'),meetingExec=await load('lib/meeting-execution.ts'),briefExec=await load('lib/brief-execution.ts'),researchExec=await load('lib/research-execution.ts'),learningExec=await load('lib/learning-execution.ts');
const usageRoute=await load('app/api/usage/route.ts'),registry=await load('lib/record-kinds.ts');
const passed=[];const check=(name,value)=>{assert.ok(value,name);passed.push(name)};
const plain=v=>JSON.parse(JSON.stringify(v));
const owner='tb-owner',now=new Date().toISOString();
const put=(kind,id,data,parent='',who=owner)=>server.recordStatement(who,kind,id,data,parent).run();
const DB=env.DB;
const reservation=id=>{const row=sql.prepare("SELECT data FROM records WHERE owner=? AND kind='token_reservation' AND id=?").get(owner,`${owner}:token_reservation:${id}`);return row&&JSON.parse(row.data)};
const reservations=()=>sql.prepare("SELECT data FROM records WHERE owner=? AND kind='token_reservation'").all(owner).map(r=>JSON.parse(r.data));
const submissionBody=id=>JSON.parse(sql.prepare('SELECT data FROM records WHERE id=?').get(`${owner}:hermes_submission:${id}`).data).body;
// 테스트가 독립적으로 다시 계산한 추정식: max(문자 수/2, UTF-8 바이트/3)의 올림.
const expectedEstimate=text=>Math.max(Math.ceil(text.length/2),Math.ceil(Buffer.byteLength(text,'utf8')/3));
const EXCEEDED=/^토큰 예산 초과: 남은 예산 [\d,]+/;
const call=async res=>({status:res.status,body:await res.json()});
const usageGet=(headers={'oai-authenticated-user-id':owner})=>usageRoute.GET(new Request('https://agency.test/api/usage',{headers})).then(call);
const usagePost=(input,headers={'oai-authenticated-user-id':owner,origin:'https://agency.test'})=>usageRoute.POST(new Request('https://agency.test/api/usage',{method:'POST',headers:{'content-type':'application/json',...headers},body:JSON.stringify(input)})).then(call);
const setBudget=(monthlyTokens,extra={})=>usagePost({action:'set_budget',scope:'workspace',monthlyTokens,...extra});

// 1) 추정식과 한국 시간 달력 월(순수 함수).
check('input estimate is chars/2 for ASCII',budget.estimateInputTokens('a'.repeat(101))===51);
check('input estimate counts Korean as about one token per character (UTF-8 bytes/3)',budget.estimateInputTokens('가'.repeat(100))===100);
check('input estimate matches the independent formula on a mixed body',(()=>{const t=JSON.stringify({instructions:'한국어 지시 English text',input:'{"brand":"가상분식"}'});return budget.estimateInputTokens(t)===expectedEstimate(t)})());
const sep=plain(budget.kstMonth(new Date('2026-09-30T14:59:59.999Z'))),oct=plain(budget.kstMonth(new Date('2026-09-30T15:00:00.000Z'))),jan=plain(budget.kstMonth(new Date('2026-12-31T15:00:00.000Z')));
check('last KST second of September is September',sep.month==='2026-09'&&sep.start==='2026-08-31T15:00:00.000Z'&&sep.end==='2026-09-30T15:00:00.000Z');
check('KST midnight of October 1 is October',oct.month==='2026-10'&&oct.start==='2026-09-30T15:00:00.000Z'&&oct.end==='2026-10-31T15:00:00.000Z');
check('KST new year rolls the year',jan.month==='2027-01'&&jan.start==='2026-12-31T15:00:00.000Z'&&jan.end==='2027-01-31T15:00:00.000Z');

// 2) 월 경계(KST): 별도 소유자에 경계 전후 사용량을 넣고 시각을 주입해 누계를 본다.
const edge='tb-boundary';
const usageRow=(who,runId,observedAt,data)=>sql.prepare('INSERT INTO records(id,owner,kind,parent_id,data,updated_at) VALUES(?,?,?,?,?,?)').run(`${who}:provider_usage:hermes:${runId}`,who,'provider_usage','',JSON.stringify({id:'hermes:'+runId,provider:'hermes',providerRunId:runId,model:'reported-model-a',inputTokens:null,outputTokens:null,totalTokens:null,status:'completed',terminalReason:'completed',observedAt,costAmount:null,currency:null,priceVersion:null,costStatus:'unpriced',pricingSource:null,inputPricePerMillion:null,outputPricePerMillion:null,domainOutcome:null,outcomeObservedAt:null,campaignId:null,...data}),observedAt);
usageRow(edge,'sep_last','2026-09-30T14:59:59.000Z',{totalTokens:600});
usageRow(edge,'oct_first','2026-09-30T15:00:00.000Z',{totalTokens:500});
usageRow(edge,'aug_last','2026-08-31T14:59:59.000Z',{totalTokens:9000});
usageRow(edge,'split_only','2026-09-10T00:00:00.000Z',{inputTokens:30,outputTokens:20});
usageRow(edge,'unknown','2026-09-11T00:00:00.000Z',{});
usageRow(edge,'camp_a','2026-09-12T00:00:00.000Z',{totalTokens:70,campaignId:'camp-a'});
await budget.setTokenBudget(DB,edge,{scope:'workspace',monthlyTokens:1000},{id:edge,email:null});
const inSep=new Date('2026-09-15T00:00:00.000Z'),inOct=new Date('2026-10-02T00:00:00.000Z');
let s=plain(await budget.tokenBudgetSummary(DB,edge,inSep));
check('September KST total excludes the October row and the August row',s.month==='2026-09'&&s.workspace.used===600+50+70);
check('split input+output counts when the total is missing, unknown usage is counted apart',s.workspace.unknownUsage===1);
check('remaining is the limit minus used and in-progress',s.workspace.limit===1000&&s.workspace.remaining===1000-720&&s.workspace.inProgress===0);
s=plain(await budget.tokenBudgetSummary(DB,edge,inOct));
check('October KST total starts at KST midnight',s.month==='2026-10'&&s.workspace.used===500&&s.workspace.remaining===500);
await assert.rejects(()=>budget.assertTokenBudget(DB,edge,null,281,{now:inSep}),e=>e.status===409&&EXCEEDED.test(e.message)&&e.message.includes('남은 예산 280'));passed.push('September guard blocks one token over the remaining 280');
check('September guard passes exactly at the limit',(await budget.assertTokenBudget(DB,edge,null,280,{now:inSep})).status==='within');
check('the same request passes in October (month boundary)',(await budget.assertTokenBudget(DB,edge,null,281,{now:inOct})).status==='within');
// 캠페인 상한은 campaignId가 같은 사용량만 센다(워크스페이스 누계 720 중 camp-a 70).
sql.prepare('INSERT INTO records(id,owner,kind,parent_id,data,updated_at) VALUES(?,?,?,?,?,?)').run(`${edge}:campaign:camp-a`,edge,'campaign','',JSON.stringify({id:'camp-a',title:'경계 캠페인'}),'2026-09-01T00:00:00.000Z');
await budget.setTokenBudget(DB,edge,{scope:'campaign',campaignId:'camp-a',monthlyTokens:100},{id:edge,email:null});
s=plain(await budget.tokenBudgetSummary(DB,edge,inSep));
check('campaign line counts only usage joined by campaignId',s.campaigns.length===1&&s.campaigns[0].used===70&&s.campaigns[0].remaining===30&&s.workspace.used===720);
await assert.rejects(()=>budget.assertTokenBudget(DB,edge,'camp-a',31,{now:inSep}),e=>e.status===409&&/남은 예산 30토큰 · 캠페인/.test(e.message));passed.push('the tighter campaign budget is the one reported');
check('a request inside both budgets passes',(await budget.assertTokenBudget(DB,edge,'camp-a',30,{now:inSep})).status==='within');
check('another campaign is only bound by the workspace budget',(await budget.assertTokenBudget(DB,edge,'camp-b',280,{now:inSep})).status==='within');

// 3) 운영 경로 준비: HERMES 연결, 합성 브랜드·캠페인(경로마다 다른 캠페인).
sql.prepare('INSERT INTO settings(owner,secret,model,updated_at) VALUES(?,?,?,?)').run(owner,await server.encrypt(JSON.stringify({provider:'hermes',endpoint:HERMES,key:'mock-only'})),'HERMES',now);
const brand={id:'tb-brand',name:'가상분식',short:'GB',category:'SNACK BAR',color:'#224466',bg:'#eef2f6',description:'합성 소개(미확인).',audience:'가상동 주민(가설)',tone:'명료한',constraints:'가격은 확인 전 확정하지 않는다.',knowledge:'합성 메모.'};
const campaign=(id,title)=>({id,brandId:brand.id,title,goal:'오픈 전 인지와 첫 포장 주문을 만든다.',audience:'가상동 주민(가설)',channels:'Instagram',stores:'가상동 12',products:'떡볶이(가격 미확정)',budget:null,startDate:'',endDate:'',constraints:'할인 약속 금지.',sources:'',status:'draft',version:1,createdAt:now,updatedAt:now});
await put('brand',brand.id,brand);
for(const [id,title] of [['tb-role','역할 캠페인'],['tb-meeting','회의 캠페인'],['tb-brief','브리프 캠페인']])await put('campaign',id,campaign(id,title));
await put('worker_credential','current',{hash:'synthetic-hash',createdAt:now});

// 4) 미설정(기본값): 막지 않고 경고만 돌려준다. 사용량 화면도 미설정 경고를 보인다.
check('unset budget passes with a warning',(await budget.assertTokenBudget(DB,owner,null,10**9)).status==='unset');
check('unset warning is Korean and says it does not block',/미설정/.test((await budget.assertTokenBudget(DB,owner,null,1)).warning));
let g=await usageGet();
check('usage API shows the unset budget with a warning',g.status===200&&g.body.budget.workspace.limit===null&&g.body.budget.workspace.remaining===null&&/미설정/.test(g.body.budget.warning)&&g.body.budget.month===plain(budget.kstMonth()).month);

// 5) 설정 초과: 모든 HERMES 경로가 공통 제출 함수(submitHermes)에서 409로 막히고 요청을 보내지 않는다.
let r=await setBudget(1);
check('owner sets a workspace monthly budget',r.status===200&&r.body.budget.monthlyTokens===1);
let before=posts.length;
let res=await roleExec.executeRole(owner,{action:'start',campaignId:'tb-role',role:'cmo'});let body=await res.json();
const roleJob=sql.prepare("SELECT id,status,error FROM jobs WHERE owner=? AND campaign_id='tb-role'").get(owner);
check('role path: 409 with the remaining budget and the job fails with the reason',res.status===409&&EXCEEDED.test(body.error)&&/남은 예산 1토큰/.test(body.error)&&roleJob.status==='failed'&&EXCEEDED.test(roleJob.error));
await meetingExec.executeMeeting(owner,{action:'start',id:'tb-m1',campaignId:'tb-meeting',campaignVersion:1,agenda:'합성 안건'});
body=await (await meetingExec.executeMeeting(owner,{action:'advance',id:'tb-m1'})).json();
check('meeting path: the step fails with the budget reason',body.status==='failed'&&EXCEEDED.test(body.error));
body=await (await briefExec.executeBrief(owner,{action:'start',id:'tb-b1',campaignId:'tb-brief',campaignVersion:1,data:{brandId:brand.id,title:'합성 초안',goal:'합성 목표'}})).json();
check('brief path: the draft fails with the budget reason',body.status==='failed'&&EXCEEDED.test(body.error));
await researchExec.executeResearch(owner,{action:'start',id:'tb-r1',brandId:brand.id});
body=await (await researchExec.executeResearch(owner,{action:'advance',id:'tb-r1'})).json();
check('research path: the research fails with the budget reason',body.status==='failed'&&EXCEEDED.test(body.error));
res=await learningExec.executeLearning(owner,{action:'start_discovery',brandId:brand.id,query:'합성 주제'});body=await res.json();
check('learning path: 409 with the budget reason',res.status===409&&EXCEEDED.test(body.error));
check('no HERMES run was requested by any blocked path',posts.length===before);
check('blocked submissions leave no token reservation',reservations().length===0);

// 6) 한도 안: 제출하면 예약(추정 입력 토큰·캠페인·실행 번호)이 생기고 진행 중 예상으로 센다. 종료 사용량이 기록되면 예약을 지운다.
await setBudget(10_000_000);
res=await roleExec.executeRole(owner,{action:'start',campaignId:'tb-role',role:'cmo'});body=await res.json();
const roleJob2=body.id,roleRun=sql.prepare('SELECT provider_id FROM jobs WHERE id=?').get(roleJob2).provider_id;
const roleReservation=reservation(roleJob2);
check('within budget the role run is requested once',res.status===200&&posts.length===before+1&&!!roleRun);
check('reservation keeps the estimate, kind, campaign and run id but no request text',roleReservation.estimatedInputTokens===expectedEstimate(submissionBody(roleJob2))&&roleReservation.estimatedTokens===roleReservation.estimatedInputTokens&&roleReservation.kind==='role'&&roleReservation.campaignId==='tb-role'&&roleReservation.runId===roleRun&&!JSON.stringify(roleReservation).includes('instructions'));
check('the stored HERMES submission keeps its shape (key and body only)',JSON.stringify(Object.keys(JSON.parse(sql.prepare('SELECT data FROM records WHERE id=?').get(`${owner}:hermes_submission:${roleJob2}`).data)).sort())==='["body","key"]');
s=plain(await budget.tokenBudgetSummary(DB,owner));
check('in-progress estimate is counted until the run ends',s.workspace.inProgress===roleReservation.estimatedTokens&&s.workspace.used===0);
await setBudget(roleReservation.estimatedTokens+1);
before=posts.length;
body=await (await briefExec.executeBrief(owner,{action:'start',id:'tb-b2',campaignId:'tb-brief',campaignVersion:1,data:{brandId:brand.id,title:'합성 초안',goal:'합성 목표'}})).json();
check('in-progress reservations count against the budget',body.status==='failed'&&/남은 예산 1토큰/.test(body.error)&&posts.length===before);
await roleExec.executeRole(owner,{action:'poll',id:roleJob2});
s=plain(await budget.tokenBudgetSummary(DB,owner));
check('terminal usage replaces the estimate (reservation settled)',!reservation(roleJob2)&&s.workspace.inProgress===0&&s.workspace.used===2000);

// 7) 캠페인 예산: provider_usage.campaignId로 조인한다. 워크스페이스는 미설정으로 되돌린다.
r=await setBudget(null);
check('owner clears the workspace budget back to unset',r.status===200&&r.body.budget.monthlyTokens===null&&(await budget.assertTokenBudget(DB,owner,null,10**9)).status==='unset');
r=await usagePost({action:'set_budget',scope:'campaign',campaignId:'tb-role',monthlyTokens:2000});
check('owner sets a campaign budget',r.status===200&&r.body.budget.campaignId==='tb-role');
before=posts.length;
await meetingExec.executeMeeting(owner,{action:'start',id:'tb-m2',campaignId:'tb-role',campaignVersion:1,agenda:'합성 안건'});
body=await (await meetingExec.executeMeeting(owner,{action:'advance',id:'tb-m2'})).json();
check('campaign budget blocks a meeting of that campaign (usage joined by campaignId)',body.status==='failed'&&EXCEEDED.test(body.error)&&/남은 예산 0토큰/.test(body.error)&&body.error.includes('캠페인')&&posts.length===before);
body=await (await briefExec.executeBrief(owner,{action:'start',id:'tb-b3',campaignId:'tb-brief',campaignVersion:1,data:{brandId:brand.id,title:'합성 초안',goal:'합성 목표'}})).json();
check('another campaign without a budget still runs',body.status==='queued'&&posts.length===before+1&&reservation('brief-tb-b3').campaignId==='tb-brief'&&reservation('brief-tb-b3').kind==='brief');
await briefExec.executeBrief(owner,{action:'poll',id:'tb-b3'});
g=await usageGet();
const campaignLine=g.body.budget.campaigns.find(c=>c.campaignId==='tb-role');
check('usage API lists the campaign budget with its joined usage',campaignLine.limit===2000&&campaignLine.used===2000&&campaignLine.remaining===0&&campaignLine.title==='역할 캠페인'&&g.body.budget.workspace.used===4000);
check('workspace stays unset with a warning while only a campaign budget exists',g.body.budget.workspace.limit===null&&/미설정/.test(g.body.budget.warning));

// 8) 같은 요청의 접수 확인 복구는 다시 막지 않는다(같은 멱등 키). 확정 거절(4xx)은 예약을 풀어 준다.
postMode='lost';
body=await (await briefExec.executeBrief(owner,{action:'start',id:'tb-b4',campaignId:'tb-brief',campaignVersion:1,data:{brandId:brand.id,title:'합성 초안',goal:'합성 목표'}})).json();
check('a lost acknowledgement keeps the reservation without a run id',body.status==='uncertain'&&reservation('brief-tb-b4').runId===null);
await setBudget(1);
before=posts.length;
body=await (await briefExec.executeBrief(owner,{action:'recover',id:'tb-b4'})).json();
check('recovering the same request is not blocked by the new budget',posts.length===before+1&&!EXCEEDED.test(String(body.error||'')));
check('recovery resends the identical body with the same key',posts.at(-1)===posts.at(-2));
await setBudget(null);
// 제출의 캠페인 판정: 실험 규칙 초안은 원천 실험의 캠페인, 브랜드 조사는 캠페인 없음(워크스페이스 상한만).
await put('viral_experiment','tb-experiment',{id:'tb-experiment',brandId:brand.id,campaignId:'tb-meeting',caseId:'c',analysisId:'a',title:'합성 실험',channel:'Instagram',hypothesis:'가설',variable:'첫 장면',control:'대조',treatment:'실험',metric:'share_rate',minSample:100,minHours:24,minLift:10,conditions:'조건',version:1,status:'evaluated',startedAt:now,createdAt:now,updatedAt:now,result:null,assessment:{status:'promising',label:'관찰상 개선',controlRate:0.01,treatmentRate:0.02,lift:100,reasons:[]}},'tb-meeting');
body=await (await learningExec.executeLearning(owner,{action:'start_guidance',experimentId:'tb-experiment',version:1})).json();
check('a rule draft reserves against the source experiment campaign',body.status==='queued'&&reservation(body.id).campaignId==='tb-meeting'&&reservation(body.id).kind==='learning');
await researchExec.executeResearch(owner,{action:'start',id:'tb-r2',brandId:brand.id});
await researchExec.executeResearch(owner,{action:'advance',id:'tb-r2'});
const researchStep=JSON.parse(sql.prepare('SELECT data FROM records WHERE id=?').get(`${owner}:brand_research:tb-r2`).data).steps[0];
check('brand research reserves without a campaign',!!researchStep.providerId&&reservation(researchStep.id).campaignId===null&&reservation(researchStep.id).kind==='research');
await meetingExec.executeMeeting(owner,{action:'start',id:'tb-m3',campaignId:'tb-meeting',campaignVersion:1,agenda:'합성 안건'});
await meetingExec.executeMeeting(owner,{action:'advance',id:'tb-m3'});
check('a meeting step reserves as a meeting of its campaign',reservations().some(x=>x.kind==='meeting'&&x.campaignId==='tb-meeting'));
postMode='reject';
res=await learningExec.executeLearning(owner,{action:'start_discovery',brandId:brand.id,query:'거절될 주제'});
const rejectedJob=sql.prepare("SELECT id,status FROM jobs WHERE owner=? AND role='viral_discovery' ORDER BY created_at DESC,rowid DESC").get(owner);
check('a definite HERMES rejection releases the reservation',res.status===400&&rejectedJob.status==='failed'&&!reservation(rejectedJob.id));
postMode='ok';
// 토큰을 보고하지 않은 종료 실행은 예약을 지우지 않고 추정치로 계속 센다(누계에서 0으로 빠지지 않게).
const briefInput={brandId:brand.id,title:'합성 초안',goal:'합성 목표'};
await briefExec.executeBrief(owner,{action:'start',id:'tb-b5',campaignId:'tb-brief',campaignVersion:1,data:briefInput});
const b5=reservation('brief-tb-b5'),inProgressBefore=plain(await budget.tokenBudgetSummary(DB,owner)).workspace.inProgress;
reportUsage=false;await briefExec.executeBrief(owner,{action:'poll',id:'tb-b5'});reportUsage=true;
const b5Usage=JSON.parse(sql.prepare("SELECT data FROM records WHERE owner=? AND kind='provider_usage' AND id=?").get(owner,`${owner}:provider_usage:hermes:${b5.runId}`).data);
check('a terminal run that reported no tokens keeps its reservation in the running total',b5Usage.totalTokens===null&&!!reservation('brief-tb-b5')&&plain(await budget.tokenBudgetSummary(DB,owner)).workspace.inProgress===inProgressBefore);
// 실행 번호 기록이 실패해도(runId 없음) 종료 사용량을 기록하면 제출 id로 예약을 지운다.
await briefExec.executeBrief(owner,{action:'start',id:'tb-b6',campaignId:'tb-brief',campaignVersion:1,data:briefInput});
sql.prepare("UPDATE records SET data=json_set(data,'$.runId',NULL) WHERE owner=? AND id=?").run(owner,`${owner}:token_reservation:brief-tb-b6`);
await briefExec.executeBrief(owner,{action:'poll',id:'tb-b6'});
check('a reservation without a run id is settled by its submission id',!reservation('brief-tb-b6'));
// HERMES 429(미접수·재시도 예정)는 예약을 풀지 않는다. 같은 요청의 복구는 새 상한에 다시 막히지 않고 같은 본문을 다시 보낸다.
const researchOf=id=>JSON.parse(sql.prepare('SELECT data FROM records WHERE id=?').get(`${owner}:brand_research:${id}`).data);
await put('brand','tb-brand-r3',{...brand,id:'tb-brand-r3'});await researchExec.executeResearch(owner,{action:'start',id:'tb-r3',brandId:'tb-brand-r3'});
postMode='429';before=posts.length;
body=await (await researchExec.executeResearch(owner,{action:'advance',id:'tb-r3'})).json();
check('a rate-limited research submission keeps its reservation for the retry',body.status==='uncertain'&&posts.length===before+1&&!!reservation(researchOf('tb-r3').steps[0].id));
await setBudget(1);
body=await (await researchExec.executeResearch(owner,{action:'recover',id:'tb-r3'})).json();
check('recovering after a rate limit resends the same request without the new budget blocking it',body.status==='running'&&posts.length===before+2&&posts.at(-1)===posts.at(-2));
// 예약 없이 복구에 들어온 제출(기능 배포 전 저장 등)이 가드에 막히면 '확인 지연'으로 가리지 않고 예산 초과 사유로 실패시킨다.
await setBudget(null);
await put('brand','tb-brand-r4',{...brand,id:'tb-brand-r4'});await researchExec.executeResearch(owner,{action:'start',id:'tb-r4',brandId:'tb-brand-r4'});
postMode='lost';await researchExec.executeResearch(owner,{action:'advance',id:'tb-r4'});
sql.prepare("DELETE FROM records WHERE owner=? AND kind='token_reservation' AND id=?").run(owner,`${owner}:token_reservation:${researchOf('tb-r4').steps[0].id}`);
await setBudget(1);before=posts.length;
res=await researchExec.executeResearch(owner,{action:'recover',id:'tb-r4'});body=await res.json();
const r4=researchOf('tb-r4');
check('a recovery blocked by the budget fails the research with the budget reason',res.status===200&&body.status==='failed'&&EXCEEDED.test(body.error)&&r4.status==='failed'&&EXCEEDED.test(r4.error)&&r4.retryAt===undefined&&posts.length===before);
await setBudget(null);

// 8b) 예약 추정은 max(입력 추정, 같은 종류 최근 실행 평균 토큰)이다. 종류는 사용량 조인 키 kind와 같은 규칙으로 정한다.
const kindOwner='tb-kind',kindRes=id=>{const row=sql.prepare("SELECT data FROM records WHERE owner=? AND kind='token_reservation' AND id=?").get(kindOwner,`${kindOwner}:token_reservation:${id}`);return row&&JSON.parse(row.data)};
usageRow(kindOwner,'learn_1',now,{kind:'learning',totalTokens:30000});usageRow(kindOwner,'learn_2',now,{kind:'learning',totalTokens:50000});usageRow(kindOwner,'learn_unknown',now,{kind:'learning'});usageRow(kindOwner,'role_1',now,{kind:'role',totalTokens:900000});
sql.prepare('INSERT INTO jobs(id,owner,campaign_id,role,status,model,campaign_version,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)').run('tb-kind-learn',kindOwner,'discovery:tb','viral_discovery','starting','HERMES',1,now,now);
const shortBody='{"input":"짧은 요청"}';
await budget.reserveTokenBudget(DB,kindOwner,'tb-kind-learn',{key:'k-learn',body:shortBody});
check('a reservation uses the recent average of the same kind when it is larger than the input estimate',kindRes('tb-kind-learn').kind==='learning'&&kindRes('tb-kind-learn').estimatedTokens===40000&&kindRes('tb-kind-learn').estimatedInputTokens===expectedEstimate(shortBody));
check('the summary counts the larger reservation as in progress',plain(await budget.tokenBudgetSummary(DB,kindOwner)).workspace.inProgress===40000);
await budget.reserveTokenBudget(DB,kindOwner,'tb-kind-unknown',{key:'k-unknown',body:'x'.repeat(100)});
check('a submission of unknown kind reserves the input estimate',kindRes('tb-kind-unknown').kind===null&&kindRes('tb-kind-unknown').estimatedTokens===50);

// 8c) 동시 제출: 확인과 예약이 한 문장이라 서로의 예약을 못 본 채 함께 통과하지 않는다. D1처럼 쿼리마다 지연을 준다.
const raceOwner='tb-race';
await budget.setTokenBudget(DB,raceOwner,{scope:'workspace',monthlyTokens:150},{id:raceOwner,email:null});
const pause=()=>new Promise(done=>setTimeout(done,5));
const slowStatement=st=>({bind:(...v)=>slowStatement(st.bind(...v)),first:async()=>{await pause();return st.first()},all:async()=>{await pause();return st.all()},run:async()=>{await pause();return st.run()}});
const slowDB={prepare:q=>slowStatement(DB.prepare(q)),batch:DB.batch};
const raced=await Promise.allSettled(['race-a','race-b'].map(id=>budget.reserveTokenBudget(slowDB,raceOwner,id,{key:'k-'+id,body:'x'.repeat(200)})));
check('of two concurrent submissions that fit only one at a time, one is reserved and one is a 409',raced.filter(x=>x.status==='fulfilled').length===1&&raced.filter(x=>x.status==='rejected'&&x.reason.status===409&&EXCEEDED.test(x.reason.message)).length===1);
check('concurrent reservations stay within the limit',plain(await budget.tokenBudgetSummary(DB,raceOwner)).workspace.inProgress===100);

// 9) 설정 검증과 권한: 소유자만(관리자·직원 403, 비로그인 401, 다른 출처 403). 모르는 캠페인 404, 잘못된 값 400.
for(const bad of [0,-5,1.5,'100',10_000_000_001])check(`invalid monthly tokens ${JSON.stringify(bad)} is a 400`,(await setBudget(bad)).status===400);
check('unknown scope is a 400',(await usagePost({action:'set_budget',scope:'team',monthlyTokens:5})).status===400);
check('unknown campaign is a 404',(await usagePost({action:'set_budget',scope:'campaign',campaignId:'no-such',monthlyTokens:5})).status===404);
check('cross-origin budget change is a 403',(await usagePost({action:'set_budget',scope:'workspace',monthlyTokens:5},{'oai-authenticated-user-id':owner,origin:'https://evil.test'})).status===403);
env.AUTH_MODE='email';env.AUTH_ORIGIN='https://agency.test';
const signIn=(id,role,createdAt,ws)=>{const token=createHash('sha256').update(id).digest('hex');sql.prepare('INSERT INTO auth_users(id,email,workspace_owner,role,status,created_at) VALUES(?,?,?,?,?,?)').run(id,id+'@test.invalid',ws,role,'active',createdAt);sql.prepare('INSERT INTO auth_sessions VALUES(?,?,?,?)').run(createHash('sha256').update(token).digest('hex'),id,Date.now()+60000,Date.now());return {cookie:'__Host-collective_session='+token,origin:'https://agency.test'}};
const ownerS=signIn('tb-ws-owner','admin',1000,owner),adminS=signIn('tb-ws-admin','admin',2000,owner),memberS=signIn('tb-ws-member','member',500,owner);
const budgetInput={action:'set_budget',scope:'workspace',monthlyTokens:777};
const aliasInput={action:'set_alias_pricing',baseModel:'declared-base-model',priceVersion:'declared-2026-09',currency:'USD',inputPerMillion:2,outputPerMillion:8,source:'https://provider.example.com/pricing',effectiveFrom:'2026-09-01'};
const [anon,member,admin,adminAlias,memberAlias]=await Promise.all([usagePost(budgetInput,{origin:'https://agency.test'}),usagePost(budgetInput,memberS),usagePost(budgetInput,adminS),usagePost(aliasInput,adminS),usagePost(aliasInput,memberS)]);
check('unauthenticated budget change is a 401',anon.status===401);
check('member and admin budget changes are 403',member.status===403&&admin.status===403&&(await budget.assertTokenBudget(DB,owner,null,10**9)).status==='unset');
check('member and admin alias price declarations are 403',adminAlias.status===403&&memberAlias.status===403&&sql.prepare("SELECT COUNT(*) n FROM records WHERE owner=? AND kind='usage_alias_pricing'").get(owner).n===0);
r=await usagePost(budgetInput,ownerS);
check('workspace owner sets the budget',r.status===200&&(await budget.tokenBudgetSummary(DB,owner)).workspace.limit===777);
r=await usagePost(aliasInput,ownerS);
check('workspace owner declares alias pricing',r.status===200&&r.body.aliasPricing.baseModel==='declared-base-model');
g=await usageGet(memberS);
check('members read the budget summary',g.status===200&&g.body.budget.workspace.limit===777&&Array.isArray(g.body.aliasPricing)&&g.body.aliasPricing.length===1);
env.AUTH_MODE='legacy';

// 10) 모든 운영 HERMES 제출이 공통 함수 한 곳을 지난다: /v1/runs 제출은 lib/hermes.ts(운영)와 lib/eval-server.ts(평가 전용 연결·자체 월 예산)에만 있다.
const walk=d=>readdirSync(d).flatMap(f=>{const p=join(d,f);return statSync(p).isDirectory()?walk(p):/\.(ts|tsx)$/.test(f)?[p]:[]});
const runPosters=['app','lib','server'].flatMap(d=>{try{return walk(d)}catch{return []}}).filter(f=>readFileSync(f,'utf8').includes("'/v1/runs'"));
check('only the common submitter and the separate eval runner post HERMES runs',JSON.stringify(runPosters.sort())===JSON.stringify([join('lib','eval-server.ts'),join('lib','hermes.ts')]));
check('role, meeting, brief, research and learning submit through submitHermes',['role','meeting','brief','research','learning'].every(k=>/import \{[^}]*submitHermes[^}]*\} from '(?:@\/lib|\.)\/hermes'/.test(readFileSync(`lib/${k}-execution.ts`,'utf8'))));
const evalSource=readFileSync('lib/eval-server.ts','utf8');
check('eval runs keep their own monthly budget and do not use the operational submitter',/EVAL_MONTHLY_TOKEN_CAP/.test(evalSource)&&!/submitHermes/.test(evalSource));
check('the guard sits in submitHermes before the run request',(()=>{const src=readFileSync('lib/hermes.ts','utf8'),fn=src.slice(src.indexOf('export async function submitHermes'));return fn.indexOf('reserveTokenBudget')>0&&fn.indexOf('reserveTokenBudget')<fn.indexOf("'/v1/runs'")})());

// 11) 새 kind는 레지스트리 끝에 등록돼 있다. 캠페인별 상한 행은 data.campaignId로 캠페인과 함께 지우고, 예약·별칭 단가 선언은 캠페인과 무관하다.
const kinds=plain(registry.recordKinds);
check('new kinds are registered at the end',JSON.stringify(kinds.slice(-3).map(k=>k.kind))==='["token_budget","token_reservation","usage_alias_pricing"]');
check('campaign token budgets are deleted with the campaign through data.campaignId',JSON.stringify(kinds.at(-3).links)==='["data_campaign"]'&&kinds.at(-3).campaignDeletion==='delete');
check('reservations and alias price declarations are not campaign scoped',kinds.slice(-2).every(k=>k.campaignDeletion==='not_campaign_scoped'&&!(k.links||[]).length));
check('no external network call',external.length===0);
console.log(JSON.stringify({passed:passed.length,checks:passed},null,2));
