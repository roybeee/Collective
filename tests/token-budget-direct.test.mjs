// 토큰 예산 후속(PR 4a-2): OpenAI 직접 경로 예약(reserveDirectCall·releaseDirectCall, 제출 원문 hermes_submission 없이 같은 원자적 예약·상한 409·재호출도 매번 재확인),
// OpenAI 응답 id·제출 id로 예약 정리(settleTokenReservation), A7 수리 요청('<단계>:repair')의 입력 추정 예약과 조사 종류 최근 평균에서 수리 사용량('<단계>_repair') 제외.
// 근거: mocked(메모리 SQLite, 합성 데이터). fetch는 호출되면 실패하는 스텁이다. 외부 네트워크·유료 모델 호출은 0회다.
import assert from 'node:assert/strict';
import {testRuntime} from './helpers/runtime.mjs';

const external=[];
const {sql,env,load}=testRuntime(async url=>{external.push(String(url));throw new Error('네트워크를 호출하지 않습니다: '+url)});
const server=await load('lib/server.ts'),budget=await load('lib/token-budget.ts'),ledger=await load('lib/usage-ledger.ts');
const DB=env.DB;let passed=0;const check=(name,condition)=>{assert.ok(condition,name);passed++};
const plain=v=>JSON.parse(JSON.stringify(v));
const EXCEEDED=/^토큰 예산 초과: 남은 예산 [\d,]+/;
// 테스트가 독립적으로 다시 계산한 추정식: max(문자 수/2, UTF-8 바이트/3)의 올림.
const expectedEstimate=text=>Math.max(Math.ceil(text.length/2),Math.ceil(Buffer.byteLength(text,'utf8')/3));
// 지난달(40일 전) 관측 행은 이번 달 누계에 들지 않고 종류별 최근 평균에만 쓰인다.
const earlier=new Date(Date.now()-40*86400000).toISOString(),recent=new Date(Date.now()-86400000).toISOString();
const reservation=(owner,id)=>{const row=sql.prepare("SELECT data FROM records WHERE owner=? AND kind='token_reservation' AND id=?").get(owner,`${owner}:token_reservation:${id}`);return row&&JSON.parse(row.data)};
const reservationCount=owner=>sql.prepare("SELECT COUNT(*) n FROM records WHERE owner=? AND kind='token_reservation'").get(owner).n;
const summary=async owner=>plain(await budget.tokenBudgetSummary(DB,owner)).workspace;
const setWorkspace=(owner,monthlyTokens)=>budget.setTokenBudget(DB,owner,{scope:'workspace',monthlyTokens},{id:owner,email:null});
const usageRow=(owner,runId,data,observedAt=earlier)=>sql.prepare('INSERT INTO records(id,owner,kind,parent_id,data,updated_at) VALUES(?,?,?,?,?,?)').run(`${owner}:provider_usage:hermes:${runId}`,owner,'provider_usage','',JSON.stringify({id:'hermes:'+runId,provider:'hermes',providerRunId:runId,model:'mock-model',inputTokens:null,outputTokens:null,totalTokens:null,status:'completed',terminalReason:'completed',observedAt,campaignId:null,...data}),observedAt);
// OpenAI 직접 경로 요청 본문 모양(합성). 실제 요청 조립은 lib/role-execution.ts가 한다.
const openaiBody=text=>JSON.stringify({model:'mock-model',instructions:'합성 지시',input:text,max_output_tokens:1000,background:true,store:true});
const direct=(owner,submissionId,body,campaignId=null,kind='role')=>budget.reserveDirectCall(DB,owner,{submissionId,campaignId,kind,body});
const rejects409=async(label,task)=>{await assert.rejects(task,e=>e instanceof budget.TokenBudgetExceeded&&e.status===409&&EXCEEDED.test(e.message),label);passed++};

// 1) 미설정(기본값): 막지 않고 경고만. 제출 원문(hermes_submission) 없이 주어진 캠페인·종류로 예약 1행을 남긴다.
{
 const owner='dc-unset',body=openaiBody('짧은 요청');
 const r=plain(await direct(owner,'job-1',body,'camp-1'));const saved=reservation(owner,'job-1');
 check('unset budget: the direct call is reserved with the unset warning',r.created===true&&r.warning===budget.UNSET_WARNING);
 check('the direct reservation keeps the given campaign and kind and the input estimate, without request text',saved.submissionId==='job-1'&&saved.campaignId==='camp-1'&&saved.kind==='role'&&saved.estimatedInputTokens===expectedEstimate(body)&&saved.estimatedTokens===saved.estimatedInputTokens&&saved.runId===null&&typeof saved.keyHash==='string'&&!JSON.stringify(saved).includes('합성 지시'));
 check('no submission record is needed or written for a direct call',sql.prepare("SELECT COUNT(*) n FROM records WHERE owner=? AND kind IN ('hermes_submission','openai_submission')").get(owner).n===0);
 check('the unset summary counts the direct reservation as in progress',(await summary(owner)).inProgress===saved.estimatedTokens);
}

// 2) 예상 토큰은 HERMES 경로와 같은 규칙이다: max(입력 추정, 같은 종류 최근 종료 실행 평균).
{
 const owner='dc-average',body=openaiBody('평균 확인');
 usageRow(owner,'role_1',{kind:'role',role:'cmo',totalTokens:40000});usageRow(owner,'role_2',{kind:'role',role:'insight',totalTokens:60000});usageRow(owner,'meeting_1',{kind:'meeting',totalTokens:900000});
 await direct(owner,'job-avg',body);
 check('a direct role call reserves the recent role average when it is larger than the input',reservation(owner,'job-avg').estimatedTokens===50000&&reservation(owner,'job-avg').estimatedInputTokens===expectedEstimate(body));
}

// 3) 상한 초과: 요청 전에 409(TokenBudgetExceeded)이고 예약을 남기지 않는다. 상한과 같으면 통과한다.
{
 const owner='dc-limit',body=openaiBody('상한 확인'),estimate=expectedEstimate(body);
 await setWorkspace(owner,estimate-1);
 await rejects409('an over-limit direct call is a 409 budget error',()=>direct(owner,'job-over',body));
 check('an over-limit direct call leaves no reservation',reservationCount(owner)===0);
 await setWorkspace(owner,estimate);
 const r=plain(await direct(owner,'job-over',body));
 check('a direct call exactly at the limit is reserved without the unset warning',r.created===true&&r.warning===null&&reservation(owner,'job-over').estimatedTokens===estimate);
 await rejects409('the next direct call sees the in-progress reservation',()=>direct(owner,'job-next',openaiBody('다음 요청')));
}

// 4) 캠페인 상한: 주어진 campaignId로 캠페인 상한을 적용한다. 다른 캠페인은 워크스페이스 상한만 본다(여기선 미설정).
{
 const owner='dc-campaign',body=openaiBody('캠페인 확인');
 await server.recordStatement(owner,'campaign','camp-a',{id:'camp-a',title:'합성 캠페인'}).run();
 await budget.setTokenBudget(DB,owner,{scope:'campaign',campaignId:'camp-a',monthlyTokens:1},{id:owner,email:null});
 await assert.rejects(()=>direct(owner,'job-a',body,'camp-a'),e=>e.status===409&&EXCEEDED.test(e.message)&&e.message.includes('캠페인'));passed++;
 check('another campaign is not bound by that campaign budget',plain(await direct(owner,'job-b',body,'camp-b')).created===true&&reservation(owner,'job-b').campaignId==='camp-b');
}

// 5) 같은 제출 id·같은 본문으로 다시 불러도 매번 상한을 다시 확인한다. OpenAI 요청에는 멱등 키가 없어 재호출은 새 유료 요청(재실행)이기 때문이다.
// 자기 예약에는 막히지 않고 같은 1행을 바꾼다(이중 예약 없음). 본문이 바뀐 새 요청도 같은 1행을 새 추정으로 바꾼다.
{
 const owner='dc-repeat',body=openaiBody('반복 확인'),estimate=expectedEstimate(body);
 await setWorkspace(owner,estimate);
 const first=plain(await direct(owner,'job-r',body)),second=plain(await direct(owner,'job-r',body));
 check('calling again with the same submission and body re-checks and is not blocked by its own reservation',first.created===true&&second.created===true&&second.warning===null);
 check('a repeated call keeps one reservation and one in-progress estimate',reservationCount(owner)===1&&(await summary(owner)).inProgress===estimate);
 await setWorkspace(owner,estimate-1);
 await rejects409('a repeated call with the same body is blocked once the limit no longer fits it',()=>direct(owner,'job-r',body));
 check('the blocked repeat keeps the earlier reservation counted',reservationCount(owner)===1&&(await summary(owner)).inProgress===estimate);
 await setWorkspace(owner,null);
 const changed=openaiBody('반복 확인 - 바뀐 본문'),third=plain(await direct(owner,'job-r',changed));
 check('a changed body under the same submission replaces the single reservation',third.created===true&&reservationCount(owner)===1&&reservation(owner,'job-r').estimatedInputTokens===expectedEstimate(changed));
}

// 6) 해제: 공급자가 새 요청을 확정 거절(4xx, 429 제외)하면 호출부가 푼다. 없는 예약 해제는 조용히 끝난다.
{
 const owner='dc-release',body=openaiBody('해제 확인');
 await direct(owner,'job-x',body);
 await budget.releaseDirectCall(DB,owner,'job-x');
 check('releaseDirectCall removes the reservation and the in-progress estimate',!reservation(owner,'job-x')&&(await summary(owner)).inProgress===0);
 await budget.releaseDirectCall(DB,owner,'job-missing');
 check('releasing a missing reservation is a no-op',reservationCount(owner)===0);
 await direct(owner,'job-x',body);
 check('after a release the same submission reserves again',reservationCount(owner)===1&&!!reservation(owner,'job-x'));
}

// 7) 정리: OpenAI 응답 id(runId 자리)로 종료 사용량을 잇는다. 토큰을 아는 종료 사용량이 기록되면 예약 대신 실제 사용량을 세고 예약을 지운다.
{
 const owner='dc-settle',body=openaiBody('정리 확인'),estimate=expectedEstimate(body);
 await direct(owner,'job-s',body);await budget.markTokenReservationRun(DB,owner,'job-s','resp_s1');
 check('the accepted OpenAI response id is attached to the direct reservation',reservation(owner,'job-s').runId==='resp_s1');
 await ledger.recordProviderUsage(owner,'openai','resp_s1',{id:'resp_s1',status:'in_progress',model:'mock-model'});
 await budget.settleTokenReservation(DB,owner,'resp_s1','job-s');
 check('a running OpenAI response keeps its reservation',!!reservation(owner,'job-s')&&(await summary(owner)).inProgress===estimate);
 await ledger.recordProviderUsage(owner,'openai','resp_s1',{id:'resp_s1',status:'completed',model:'mock-model',usage:{input_tokens:700,output_tokens:300,total_tokens:1000}});
 let line=await summary(owner);
 check('terminal OpenAI usage with tokens replaces the estimate in the running total',line.used===1000&&line.inProgress===0);
 await budget.settleTokenReservation(DB,owner,'resp_s1','job-s');
 check('settling by the OpenAI response id removes the direct reservation',!reservation(owner,'job-s'));
 // 실행 번호 기록이 실패해도(runId 없음) 제출 id로 지운다.
 await direct(owner,'job-n',openaiBody('실행 번호 없음'));
 await ledger.recordProviderUsage(owner,'openai','resp_n1',{id:'resp_n1',status:'completed',model:'mock-model',usage:{input_tokens:1,output_tokens:1,total_tokens:2}});
 await budget.settleTokenReservation(DB,owner,'resp_n1','job-n');
 check('a direct reservation without a run id is settled by its submission id',!reservation(owner,'job-n'));
 // 토큰을 보고하지 않은 종료 사용량은 예약을 남겨 추정치로 계속 센다.
 await direct(owner,'job-u',body);await budget.markTokenReservationRun(DB,owner,'job-u','resp_u1');
 await ledger.recordProviderUsage(owner,'openai','resp_u1',{id:'resp_u1',status:'failed',model:'mock-model'});
 await budget.settleTokenReservation(DB,owner,'resp_u1','job-u');
 line=await summary(owner);
 check('a terminal OpenAI run without tokens keeps its reservation in the running total',!!reservation(owner,'job-u')&&line.inProgress===estimate&&line.unknownUsage===1);
}

// 8) 동시 호출: 확인과 예약이 한 문장이라 제출 원문 없는 직접 경로도 서로의 예약을 못 본 채 함께 통과하지 않는다.
{
 const owner='dc-race',body='x'.repeat(200);
 await setWorkspace(owner,150);
 const pause=()=>new Promise(done=>setTimeout(done,5));
 const slowStatement=st=>({bind:(...v)=>slowStatement(st.bind(...v)),first:async()=>{await pause();return st.first()},all:async()=>{await pause();return st.all()},run:async()=>{await pause();return st.run()}});
 const slowDB={prepare:q=>slowStatement(DB.prepare(q)),batch:DB.batch};
 const raced=await Promise.allSettled(['race-a','race-b'].map(id=>budget.reserveDirectCall(slowDB,owner,{submissionId:id,campaignId:null,kind:'role',body})));
 check('of two concurrent direct calls that fit only one at a time, one is reserved and one is a 409',raced.filter(x=>x.status==='fulfilled').length===1&&raced.filter(x=>x.status==='rejected'&&x.reason.status===409).length===1);
 check('concurrent direct reservations stay within the limit',(await summary(owner)).inProgress===100);
}

// 9) A7 수리 요청(제출 id '<단계>:repair')은 조사 종류 최근 평균(운영 관찰 약 339k)이 아니라 입력 추정으로 예약한다. 일반 조사 제출은 평균을 그대로 쓴다.
const brand={id:'dc-brand',name:'가상분식'};
const researchSubmission=async(owner,id,text)=>{const key='collective-'+id,body=JSON.stringify({instructions:'합성 조사 지시',input:text,session_id:key,conversation_history:[]});await server.recordStatement(owner,'hermes_submission',id,{key,body},brand.id).run();return {key,body}};
{
 const owner='dc-repair';await server.recordStatement(owner,'brand',brand.id,brand).run();
 for(const n of [1,2,3])usageRow(owner,'research_'+n,{kind:'research',role:'investigation',totalTokens:339000});
 await setWorkspace(owner,200000);
 const repair=await researchSubmission(owner,'r1-investigation:repair',JSON.stringify({errors:['조사 단계 기록이 누락되거나 순서가 다릅니다.'],allowedSourceIds:[],original:'{"phases":[]}'}));
 const r=plain(await budget.reserveTokenBudget(DB,owner,'r1-investigation:repair',repair));const saved=reservation(owner,'r1-investigation:repair');
 check('a repair request is reserved although less budget is left than the research average',r.created===true&&!!saved);
 check('the repair reservation is the input estimate of the repair body, not the 339k research average',saved.kind==='research'&&saved.estimatedInputTokens===expectedEstimate(repair.body)&&saved.estimatedTokens===saved.estimatedInputTokens&&saved.estimatedTokens<339000);
 const full=await researchSubmission(owner,'r2-investigation',JSON.stringify({stage:'investigation'}));
 await rejects409('a full research submission still reserves the research average and is blocked',()=>budget.reserveTokenBudget(DB,owner,'r2-investigation',full));
 check('only the repair reservation exists',reservationCount(owner)===1);
}

// 10) 조사 종류 최근 평균에서 수리 실행(사용량 역할 '<단계>_repair')을 뺀다. 작은 수리 실행이 다음 전체 조사의 예약을 끌어내리지 않는다.
{
 const owner='dc-exclude';await server.recordStatement(owner,'brand',brand.id,brand).run();
 usageRow(owner,'research_a',{kind:'research',role:'investigation',totalTokens:339000});usageRow(owner,'research_b',{kind:'research',role:'identity',totalTokens:339000});
 for(const n of [1,2,3])usageRow(owner,'repair_'+n,{kind:'research',role:'investigation_repair',totalTokens:3000},recent);
 const full=await researchSubmission(owner,'r3-investigation',JSON.stringify({stage:'investigation'}));
 await budget.reserveTokenBudget(DB,owner,'r3-investigation',full);
 check('the research average excludes repair usage (339k, not lowered by 3k repair runs)',reservation(owner,'r3-investigation').estimatedTokens===339000);
 const repair=await researchSubmission(owner,'r3-investigation:repair',JSON.stringify({errors:['형식 오류'],allowedSourceIds:[],original:'{}'}));
 await budget.reserveTokenBudget(DB,owner,'r3-investigation:repair',repair);
 check('a repair reservation does not use the repair-run average either (input estimate only)',reservation(owner,'r3-investigation:repair').estimatedTokens===expectedEstimate(repair.body));
}
check('no external destination was called',external.length===0);

console.log(JSON.stringify({passed}));
