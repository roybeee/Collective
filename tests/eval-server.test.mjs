// 서버 평가 실행(F1b-2): 평가 연결·케이스 캡처·실행(공정 큐)·예산(결정 5)·격리·취소·비교·권한.
// 근거: mocked(평가·운영 HERMES fetch 스텁, 메모리 SQLite, 합성 브랜드·캠페인). 외부 네트워크 호출은 0회다.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {testRuntime} from './helpers/runtime.mjs';
import {roleFixture} from './helpers/role-fixture.mjs';

const EVAL='https://eval-hermes.example.com',OPS='https://hermes.example.com';
const capabilities={object:'hermes.api_server.capabilities',platform:'hermes-agent',features:{run_submission:true,run_status:true,run_stop:true,runs_idempotency:{durable:true,enabled:true,supported:true}}};
const mode={caps:true,auth:true,network:true,poll:'completed',usage:{input_tokens:1000,output_tokens:500,total_tokens:1500}};
const evalCalls=[],opsCalls=[],external=[],hermesRuns=new Map(),stopped=[];let seq=0;
const {sql,env,load}=testRuntime(async(url,options={})=>{
 url=String(url);const headers=new Headers(options.headers||{}),method=options.method||'GET';
 if(url.startsWith(OPS+'/')){opsCalls.push({url,method});if(url===OPS+'/v1/runs'&&method==='POST')return Response.json({run_id:'ops_'+ ++seq});return new Response('{}',{status:404})}
 if(!url.startsWith(EVAL+'/')){external.push(url);throw new Error('모의 주소만 호출합니다: '+url)}
 const path=url.slice(EVAL.length);evalCalls.push({path,method,headers:Object.fromEntries(headers),body:options.body});
 if(!mode.network)throw new TypeError('fetch failed');
 if(!headers.get('authorization')||!mode.auth)return new Response('{}',{status:401});
 if(path==='/v1/capabilities')return Response.json(mode.caps?capabilities:{object:'unknown'});
 if(path==='/v1/models')return Response.json({data:[{id:'mock-eval-model'}]});
 if(path==='/v1/runs'&&method==='POST'){const id='eval_'+ ++seq;hermesRuns.set(id,JSON.parse(options.body));return Response.json({run_id:id})}
 const stop=/^\/v1\/runs\/([\w-]+)\/stop$/.exec(path);if(stop){stopped.push(stop[1]);return Response.json({object:'hermes.run',run_id:stop[1],status:'stopped'})}
 const id=/^\/v1\/runs\/([\w-]+)$/.exec(path)?.[1];if(!id||!hermesRuns.has(id))return new Response('{}',{status:404});
 if(mode.poll==='running')return Response.json({object:'hermes.run',run_id:id,status:'running'});
 if(mode.poll==='unavailable')return new Response('{}',{status:503});
 if(mode.poll==='failed')return Response.json({object:'hermes.run',run_id:id,status:'failed',error:'synthetic',usage:{total_tokens:40}});
 return Response.json({object:'hermes.run',run_id:id,status:'completed',output:roleFixture(hermesRuns.get(id).input),usage:mode.usage,model:'mock-eval-model'});
});
const server=await load('lib/server.ts'),route=await load('app/api/eval/route.ts'),background=await load('lib/background-execution.ts');
const instruction=await load('lib/role-instruction.ts'),execution=await load('lib/role-execution.ts');
const owner='eval-owner',other='other-owner',now=new Date().toISOString(),passed=[];
const check=(name,fn)=>{fn();passed.push(name)};
const put=(kind,id,data,parent='')=>server.recordStatement(owner,kind,id,data,parent).run();
const call=async res=>({status:res.status,body:await res.json()});
const post=(input,user=owner,extra={})=>route.POST(new Request('https://agency.test/api/eval',{method:'POST',headers:{'oai-authenticated-user-id':user,'content-type':'application/json',...extra},body:typeof input==='string'?input:JSON.stringify(input)})).then(call);
const get=(query='',user=owner,extra={})=>route.GET(new Request('https://agency.test/api/eval'+query,{headers:{'oai-authenticated-user-id':user,...extra}})).then(call);
const opsSettings=endpoint=>server.encrypt(JSON.stringify({provider:'hermes',endpoint,key:'ops-only'}));
sql.prepare('INSERT INTO settings(owner,secret,model,updated_at) VALUES(?,?,?,?)').run(owner,await opsSettings(OPS),'HERMES',now);

// 합성 브랜드·캠페인·사실 원장. 실제 고객·매장 정보가 아니다.
const brand={id:'eval-brand',name:'가상분식',short:'GB',category:'SNACK BAR',color:'#224466',bg:'#eef2f6',description:'합성 소개(미확인).',audience:'가상동 주민(가설)',tone:'명료한',constraints:'가격은 확인 전 확정하지 않는다.',knowledge:'합성 메모.'};
const campaign={id:'eval-campaign',brandId:brand.id,title:'가상분식 오픈',goal:'오픈 전 인지와 첫 포장 주문을 만든다.',audience:'가상동 주민(가설)',channels:'Instagram, 매장 안내',stores:'가상동 12',products:'떡볶이(가격 미확정)',budget:null,startDate:'',endDate:'',constraints:'할인 약속 금지.',sources:'',status:'draft',version:1,createdAt:now,updatedAt:now};
await put('brand',brand.id,brand);await put('campaign',campaign.id,campaign);await put('campaign',campaign.id+'-2',{...campaign,id:campaign.id+'-2'});
const fact=(id,key,value,status)=>put('brand_fact',id,{id,brandId:brand.id,key,value,status,source:'합성 원장',verifiedAt:now,validUntil:'2099-12-31T00:00:00.000Z',version:1,updatedAt:now},brand.id);
await fact('fact-address','주소','가상동 12','confirmed');await fact('fact-cooking','조리 방식','숯불','rejected');
await put('artifact','cmo-1',{id:'cmo-1',campaignId:campaign.id,campaignVersion:1,role:'cmo',title:'합성 CMO',content:'## 합성 CMO 초안\n\n포장 동선을 먼저 알리는 조건부 계획입니다.',version:1,status:'review',origin:'ai',createdAt:now},campaign.id);

// A) 평가 연결
let r=await get();
check('overview starts unconfigured',()=>assert.ok(r.status===200&&r.body.connection.configured===false&&Array.isArray(r.body.cases)&&Array.isArray(r.body.runs)));
const connect=(extra={})=>post({action:'save_connection',endpoint:EVAL,key:'eval-secret-key',isolationConfirmed:true,note:'메모리 off 평가 프로필',...extra});
r=await connect({endpoint:'http://eval-hermes.example.com'});
check('plain http endpoint is rejected',()=>assert.equal(r.status,400));
r=await connect({endpoint:OPS});const sameHost=await connect({endpoint:OPS+'/eval'});
check('operational endpoint is rejected with 400',()=>assert.ok(r.status===400&&/운영/.test(r.body.error)&&sameHost.status===400));
// FQDN 끝 점('host.')은 같은 DNS 이름이다. 대소문자·퍼센트 인코딩(%2E) 변형과 운영이 아닌 평가 주소의 끝 점도 400으로 거부한다.
for(const endpoint of [OPS+'.',OPS+'./eval','https://HERMES.EXAMPLE.COM.','https://hermes.example.com%2E',EVAL+'.']){const res=await connect({endpoint});check(`trailing-dot host ${endpoint} is rejected`,()=>assert.equal(res.status,400))}
sql.prepare('UPDATE settings SET secret=? WHERE owner=?').run(await opsSettings(OPS+'.'),owner);
r=await connect({endpoint:OPS});
sql.prepare('UPDATE settings SET secret=? WHERE owner=?').run(await opsSettings(OPS),owner);
check('an operational endpoint stored with a trailing dot still matches its host',()=>assert.ok(r.status===400&&/운영/.test(r.body.error)));
check('rejected endpoints never reach the eval gateway or operations',()=>assert.ok(evalCalls.length===0&&opsCalls.length===0));
r=await connect({isolationConfirmed:'yes'});
check('isolation confirmation must be a boolean',()=>assert.equal(r.status,400));
r=await connect();
check('connection saves after a capabilities check',()=>assert.ok(r.status===200&&r.body.status==='ready'&&evalCalls.some(c=>c.path==='/v1/capabilities'&&c.headers.authorization==='Bearer eval-secret-key')));
check('response exposes the host only, never the key or endpoint',()=>assert.ok(r.body.host==='eval-hermes.example.com'&&!('endpoint' in r.body)&&!('secret' in r.body)&&!JSON.stringify(r.body).includes('eval-secret-key')&&!JSON.stringify(r.body).includes('https://')));
const stored=sql.prepare("SELECT data FROM records WHERE owner=? AND kind='eval_connection'").get(owner).data;
check('stored key is encrypted',()=>assert.ok(!stored.includes('eval-secret-key')&&JSON.parse(stored).secret.includes('.')));
r=await get();
check('overview reports connection state without secrets',()=>assert.ok(r.body.connection.configured&&r.body.connection.isolationConfirmed&&!JSON.stringify(r.body).includes('eval-secret-key')));

// B) 평가 케이스: 운영 실행과 같은 DB 읽기 규칙으로 요청을 동결한다.
r=await post({action:'capture_case',campaignId:campaign.id,role:'insight',expectations:{prohibitedTerms:['숯불'],industry:'fnb',localStore:true}});
const insightCase=r.body;
check('capture stores a frozen request and default fact ledger',()=>assert.ok(r.status===200&&insightCase.role==='insight'&&insightCase.set==='dev'&&insightCase.request.campaign.id===campaign.id&&insightCase.expectations.facts.confirmed.length===1&&insightCase.expectations.facts.prohibited.length===1&&insightCase.createdBy.id===owner));
check('capture includes usable upstream work',()=>assert.ok(insightCase.request.previous.some(a=>a.id==='cmo-1')));
const cmoCase=(await post({action:'capture_case',campaignId:campaign.id,role:'cmo',label:'CMO 기준'})).body;
check('capture works for a role that already has current work',()=>assert.ok(cmoCase.id&&cmoCase.label==='CMO 기준'));
r=await post({action:'capture_case',campaignId:campaign.id,role:'intern'});
check('capture rejects unknown roles',()=>assert.equal(r.status,400));
r=await post({action:'capture_case',campaignId:campaign.id,role:'cmo'},other);
check('capture of another owner campaign is 404',()=>assert.equal(r.status,404));
// 운영 start 분기의 제출 본문이 캡처한 요청으로 만든 본문과 같다(같은 DB 읽기 규칙).
const job=await (await execution.executeRole(owner,{action:'start',campaignId:campaign.id,role:'insight'})).json();
const production=JSON.parse((await server.readRecord(owner,'hermes_submission',job.id)).body);
check('captured request rebuilds the production instructions byte for byte',()=>assert.equal(instruction.buildRoleInstruction(insightCase.request),production.instructions));
check('captured request rebuilds the production input byte for byte',()=>assert.equal(instruction.buildRoleInput(insightCase.request),production.input));
sql.prepare("UPDATE jobs SET status='cancelled' WHERE id=?").run(job.id);
const productionKeys=sql.prepare("SELECT json_extract(data,'$.key') AS k FROM records WHERE kind='hermes_submission'").all().map(x=>x.k);
r=await post({action:'save_case',role:'cmo',request:cmoCase.request,expectations:{prohibitedTerms:['할인']},set:'sealed',label:'봉인 CMO'});
const sealedCase=r.body;
check('manual case saves into the sealed set',()=>assert.ok(r.status===200&&sealedCase.set==='sealed'&&sealedCase.source==='manual'));
for(const [name,bad] of [['role mismatch',{role:'insight',request:cmoCase.request}],['missing campaign',{role:'cmo',request:{...cmoCase.request,campaign:undefined}}],['bad set',{role:'cmo',request:cmoCase.request,set:'holdout'}],['bad terms',{role:'cmo',request:cmoCase.request,expectations:{prohibitedTerms:'숯불'}}]]){
 const res=await post({action:'save_case',...bad});check(`save_case rejects ${name}`,()=>assert.equal(res.status,400));
}
r=await post({action:'update_case',id:cmoCase.id,label:'CMO 기준 v2'});
check('owner updates label',()=>assert.ok(r.status===200&&r.body.label==='CMO 기준 v2'&&r.body.request.campaign.id===campaign.id));
r=await post({action:'update_case',id:cmoCase.id,label:'x'},other);
check('another owner cannot update (404)',()=>assert.equal(r.status,404));
r=await get('?case='+cmoCase.id,other);
check('another owner cannot read a case (404)',()=>assert.equal(r.status,404));
const throwaway=(await post({action:'save_case',role:'cmo',request:cmoCase.request,label:'삭제용'})).body;
r=await post({action:'delete_case',id:throwaway.id});
check('owner deletes a case',()=>assert.equal(r.status,200));
check('deleted case is gone',()=>assert.equal(sql.prepare("SELECT COUNT(*) n FROM records WHERE kind='eval_case' AND id=?").get(`${owner}:eval_case:${throwaway.id}`).n,0));
// 캠페인을 지워도 골든셋 케이스는 남는다(결정 6·7 취지).
const kept=(await post({action:'capture_case',campaignId:campaign.id+'-2',role:'cmo'})).body;
const preview=await server.campaignDeletionPreview(owner,campaign.id+'-2');
check('deletion preview lists eval cases as retained',()=>assert.equal(preview.retained.eval_case,1));
await server.deleteCampaign(owner,{id:campaign.id+'-2',version:1,confirmed:true});
r=await get('?case='+kept.id);
check('eval case survives campaign deletion',()=>assert.ok(r.status===200&&r.body.campaignId===campaign.id+'-2'));
await post({action:'delete_case',id:kept.id});

// C) 예산(결정 5): 1회 250k, 월 1.5M 절대 상한. 초과는 대표 승인 사유로만.
r=await post({action:'start_run',set:'dev'});
check('tokenBudget is required',()=>assert.ok(r.status===400&&/tokenBudget/.test(r.body.error)));
for(const bad of [0,-1,1.5,'1000']){const res=await post({action:'start_run',set:'dev',tokenBudget:bad});check(`invalid tokenBudget ${JSON.stringify(bad)} is 400`,()=>assert.equal(res.status,400))}
// 작은 예산 run을 여러 개 만들어 월 상한을 우회하지 못하게, 케이스 1건 예약량(50,000)보다 작은 예산은 받지 않는다.
for(const small of [1,1000,49999]){const res=await post({action:'start_run',set:'dev',tokenBudget:small});check(`tokenBudget ${small} below one case reservation is 400`,()=>assert.ok(res.status===400&&/50,000/.test(res.body.error)))}
check('rejected budgets record no run',()=>assert.equal(sql.prepare("SELECT COUNT(*) n FROM records WHERE kind='eval_run'").get().n,0));
r=await post({action:'start_run',set:'dev',tokenBudget:50000,variant:'candidate'});
check('only the active variant runs for now',()=>assert.ok(r.status===400&&/variant/.test(r.body.error)));
r=await post({action:'start_run',tokenBudget:50000});
check('start needs caseIds or a set',()=>assert.ok(r.status===400&&/caseIds/.test(r.body.error)));
r=await post({action:'start_run',caseIds:[],tokenBudget:50000});
check('empty case list is 400',()=>assert.equal(r.status,400));
r=await post({action:'start_run',caseIds:['missing-case'],tokenBudget:50000});
check('unknown case is 404',()=>assert.equal(r.status,404));
r=await post({action:'start_run',set:'dev',tokenBudget:250001});
check('smoke budget above 250k is 409',()=>assert.ok(r.status===409&&/250,000/.test(r.body.error)));
check('a smoke-only overrun keeps the per-run approval message',()=>assert.ok(/overBudgetApproved\.reason/.test(r.body.error)&&!/set_budget_approval/.test(r.body.error)));
r=await post({action:'start_run',set:'dev',tokenBudget:300000,overBudgetApproved:{reason:''}});
check('approval needs a reason',()=>assert.equal(r.status,400));
r=await post({action:'start_run',set:'dev',tokenBudget:300000,overBudgetApproved:{reason:'합성 승인: dev 전체 확인'}});
check('owner approval allows an over-cap smoke and is recorded',()=>assert.ok(r.status===200&&r.body.overBudgetApproved.reason==='합성 승인: dev 전체 확인'&&r.body.overBudgetApproved.by.id===owner&&JSON.stringify(r.body.overBudgetApproved.exceeded)==='["smoke_cap"]'));
check('approved run is not submitted synchronously',()=>assert.ok(!evalCalls.some(c=>c.path==='/v1/runs')));
await post({action:'cancel_run',id:r.body.id});
const monthStart=new Date(Date.UTC(new Date().getUTCFullYear(),new Date().getUTCMonth(),1)),lastMonth=new Date(monthStart.getTime()-86400000).toISOString();
const seeded=(id,createdAt,usedTokens,status='completed')=>put('eval_run',id,{id,label:'합성 누적',variant:'active',caseIds:[],tokenBudget:usedTokens,usedTokens,status,results:[],createdAt,updatedAt:createdAt,createdBy:{id:owner,email:null}});
await seeded('seed-this-month',now,1400000);await seeded('seed-last-month',lastMonth,1400000);
r=await get();
check('monthly usage counts only this UTC month',()=>assert.ok(r.body.usage.usedTokens===1400000&&r.body.usage.monthlyCap===1500000&&r.body.usage.smokeCap===250000));
r=await post({action:'start_run',set:'dev',tokenBudget:100001});
check('monthly cap blocks a run that would exceed 1.5M',()=>assert.ok(r.status===409&&/1,500,000/.test(r.body.error)));
check('the monthly-cap refusal points to the monthly approval, not only a per-run reason (Q2)',()=>assert.ok(/overBudgetApproved\.reason/.test(r.body.error)&&/set_budget_approval/.test(r.body.error)));
r=await post({action:'start_run',set:'dev',tokenBudget:100001,overBudgetApproved:{reason:'합성 승인: 월 상한 초과 확인'}});
check('monthly overrun needs and records owner approval',()=>assert.ok(r.status===200&&JSON.stringify(r.body.overBudgetApproved.exceeded)==='["monthly_cap"]'));
const reserved=await get();
check('active runs reserve their unused budget',()=>assert.equal(reserved.body.usage.reservedTokens,100001));
await post({action:'cancel_run',id:r.body.id});
sql.prepare("DELETE FROM records WHERE kind='eval_run' AND id IN (?,?)").run(`${owner}:eval_run:seed-this-month`,`${owner}:eval_run:seed-last-month`);
// 끝난 run을 지워도 이번 달 누적은 줄지 않고, 승인·봉인 세트 감사 기록도 남는다(delete_run 우회 방지).
const approvedBy={reason:'합성 승인 기록',by:{id:owner,email:null},at:now,exceeded:['monthly_cap'],monthCommitted:0};
await seeded('seed-deleted',now,1400000);
sql.prepare("UPDATE records SET data=json_set(data,'$.overBudgetApproved',json(?),'$.sealedUsed',json(?),'$.results',json(?)) WHERE id=?").run(JSON.stringify(approvedBy),JSON.stringify({by:{id:owner,email:null},at:now,cases:1}),JSON.stringify([{caseId:'c1',status:'completed'}]),`${owner}:eval_run:seed-deleted`);
await put('eval_output','seed-deleted:c1',{runId:'seed-deleted',caseId:'c1',output:'합성 출력'},'seed-deleted');
r=await post({action:'delete_run',id:'seed-deleted'});
const afterDelete=await get(),tombstone=await get('?run=seed-deleted'),deletedOutput=await get('?run=seed-deleted&caseId=c1');
check('deleting a run keeps its tokens in the monthly usage',()=>assert.ok(r.status===200&&afterDelete.body.usage.usedTokens===1400000));
check('deleted run keeps the approval and sealed-use audit but drops results and outputs',()=>assert.ok(tombstone.body.deleted.by.id===owner&&tombstone.body.deleted.cases===1&&tombstone.body.results.length===0&&tombstone.body.overBudgetApproved.reason==='합성 승인 기록'&&tombstone.body.sealedUsed.cases===1&&deletedOutput.status===404));
r=await post({action:'start_run',set:'dev',tokenBudget:200000});
check('after deleting, the monthly cap still needs owner approval',()=>assert.ok(r.status===409&&/1,500,000/.test(r.body.error)));
r=await post({action:'delete_run',id:'seed-deleted'});
check('deleting a deleted run is 409',()=>assert.equal(r.status,409));
sql.prepare("DELETE FROM records WHERE kind='eval_run' AND id=?").run(`${owner}:eval_run:seed-deleted`);

// 연결 상태가 막혀 있으면 run은 blocked로 기록되고 409로 거부된다.
mode.caps=false;r=await connect();mode.caps=true;
check('failed capabilities check saves the connection as blocked',()=>assert.ok(r.status===200&&r.body.status==='blocked'&&r.body.statusReason));
r=await post({action:'start_run',set:'dev',tokenBudget:50000});
check('blocked connection records a blocked run and answers 409',()=>assert.ok(r.status===409&&r.body.run.status==='blocked'&&r.body.run.results.every(x=>x.status==='not_run')));
r=await post({action:'check_connection'});
check('re-check restores a ready connection',()=>assert.equal(r.body.status,'ready'));
await connect({isolationConfirmed:false});
r=await post({action:'start_run',set:'dev',tokenBudget:50000});
check('unconfirmed isolation blocks the run',()=>assert.ok(r.status===409&&r.body.run.status==='blocked'&&/격리|메모리/.test(r.body.run.blockedReason)));
await connect();

// D) 실행: 공정 큐 워커가 케이스를 하나씩 제출→조회한다.
const runOf=async id=>(await get('?run='+encodeURIComponent(id))).body;
async function drive(id,max=12){for(let i=0;i<max;i++){const run=await runOf(id);if(!['queued','running'].includes(run.status))return run;await background.advanceBackgroundWork(owner)}return runOf(id)}
const submissions=()=>evalCalls.filter(c=>c.path==='/v1/runs'&&c.method==='POST');
const opsBefore=opsCalls.length;
r=await post({action:'start_run',set:'dev',tokenBudget:100000,label:'dev 스모크'});
const run1=await drive(r.body.id);
const expectedKey=(runId,caseId)=>'collective-eval-'+createHash('sha256').update(`${runId}:${caseId}`).digest('hex').slice(0,40);
check('dev run completes every case',()=>assert.ok(run1.status==='completed'&&run1.results.length===2&&run1.results.every(x=>x.status==='completed')));
check('submissions go to the eval gateway only',()=>assert.ok(opsCalls.length===opsBefore&&submissions().length===2));
for(const res of run1.results){
 const sub=submissions().find(c=>JSON.parse(c.body).session_id===res.idempotencyKey),body=JSON.parse(sub.body),kase=res.caseId===insightCase.id?insightCase:cmoCase;
 check(`${res.role} body is built by the current role builders`,()=>assert.deepEqual(body,{instructions:instruction.buildRoleInstruction(kase.request),input:instruction.buildRoleInput(kase.request),session_id:res.idempotencyKey,conversation_history:[]}));
 check(`${res.role} idempotency key derives from run and case`,()=>assert.ok(res.idempotencyKey===expectedKey(run1.id,res.caseId)&&sub.headers['idempotency-key']===res.idempotencyKey&&sub.headers['x-hermes-session-key']===res.idempotencyKey));
 check(`${res.role} key never reuses a stored production key`,()=>assert.ok(!productionKeys.includes(res.idempotencyKey)));
 check(`${res.role} result records model, provider run, tokens and duration`,()=>assert.ok(res.model==='mock-eval-model'&&/^eval_\d+$/.test(res.providerRunId)&&res.tokens.total===1500&&res.tokens.input===1000&&res.tokens.output===500&&Number.isFinite(res.durationMs)&&res.durationMs>=0));
 check(`${res.role} graded by the fifteen graders and compliance`,()=>assert.ok(res.graders.length===15&&res.graders.every(g=>['pass','fail','not_applicable','grader_error'].includes(g.status))&&Object.values(res.summary).reduce((a,b)=>a+b,0)===15&&typeof res.compliance.version==='string'&&res.variant==='active'));
 // 채점 방식 기록: 정규화 뒤 채점(graders)과 별도로 정규화 전 예방 판정·정규화 건수를 남긴다(값 없이 건수만).
 check(`${res.role} records the grading version, prevention verdicts and normalization counts`,()=>assert.ok(res.gradersVersion==='failure-types-v1+normalized+measure-v2+g3+compound-labels+absent-expr+critique-clause+meeting-normalized+r3-measure+local-rerun+contract-read+channel-decision+copy-pack+voice-avoid'&&res.prevention.map(g=>g.id).join()==='heading_nesting,internal_id_exposure'&&res.prevention.every(g=>['pass','fail','not_applicable'].includes(g.status))&&Object.keys(res.normalization).join()==='schemaPaths,headings'&&Number.isInteger(res.normalization.schemaPaths)&&Number.isInteger(res.normalization.headings)));
}
check('run accumulates reported tokens',()=>assert.equal(run1.usedTokens,3000));
const insightResult=run1.results.find(x=>x.caseId===insightCase.id);
r=await get(`?run=${run1.id}&caseId=${insightCase.id}`);
check('raw model output is stored for the owner',()=>assert.ok(r.status===200&&r.body.output===roleFixture(hermesRuns.get(insightResult.providerRunId).input)));
r=await get(`?run=${run1.id}&caseId=${insightCase.id}`,other);
check('another owner cannot read outputs (404)',()=>assert.equal(r.status,404));
r=await post({action:'start_run',caseIds:[insightCase.id],tokenBudget:100000});
const run2=await drive(r.body.id);
check('two runs of the same case use different idempotency keys',()=>assert.ok(run2.results[0].idempotencyKey!==insightResult.idempotencyKey&&run2.results[0].idempotencyKey===expectedKey(run2.id,insightCase.id)));
r=await get(`?compare=${run1.id},${run2.id}`);
check('comparison pairs the shared case per grader without claiming improvement',()=>assert.ok(r.status===200&&r.body.sharedCases===1&&r.body.graders.length===15&&r.body.graders.every(g=>g.n<=1&&g.verdict!=='improved')));
check('comparison also reports the model-text (prevention) verdicts and normalization tallies',()=>assert.ok(r.body.prevention.map(g=>g.id).join()==='heading_nesting,internal_id_exposure'&&r.body.normalization.candidate.recorded===1&&r.body.gradersVersions.candidate[0]==='failure-types-v1+normalized+measure-v2+g3+compound-labels+absent-expr+critique-clause+meeting-normalized+r3-measure+local-rerun+contract-read+channel-decision+copy-pack+voice-avoid'));

// 예산 소진·사용량 미보고·인증·연결 실패·격리 재확인·시간 초과·취소
const normalUsage=mode.usage;mode.usage={input_tokens:30000,output_tokens:10000,total_tokens:40000};
r=await post({action:'start_run',set:'dev',tokenBudget:50000});
let before=submissions().length;const spent=await drive(r.body.id);mode.usage=normalUsage;
check('the next case is not submitted when its reservation would pass the run budget',()=>assert.ok(spent.status==='completed'&&spent.stopReason==='budget_reached'&&spent.usedTokens===40000&&submissions().length===before+1&&spent.results.filter(x=>x.status==='not_run').length===1&&/50,000/.test(spent.results.find(x=>x.status==='not_run').error)));
// 제출 직전에 월 상한을 다시 본다: 시작 뒤 이번 달 누적이 늘면(예: 앞 케이스의 예약 초과) 승인 없는 run은 더 제출하지 않는다.
r=await post({action:'start_run',caseIds:[insightCase.id],tokenBudget:100000});
await seeded('seed-overshoot',now,1460000);before=submissions().length;
const capped=await drive(r.body.id);
check('monthly cap is re-checked before each submission',()=>assert.ok(capped.status==='completed'&&capped.stopReason==='monthly_cap_reached'&&capped.results[0].status==='not_run'&&/1,500,000/.test(capped.results[0].error)&&submissions().length===before));
// Q2: 건별 승인은 월 상한을 올리지 못한다. 첫 케이스 예약도 월 상한에 들어가지 않으면 승인이 있어도 제출 0건 run이 되므로 기록하지 않고 409로 월 승인을 안내한다.
const evalRunCount=()=>sql.prepare("SELECT COUNT(*) n FROM records WHERE owner=? AND kind='eval_run'").get(owner).n,capRunsBefore=evalRunCount();
r=await post({action:'start_run',caseIds:[insightCase.id],tokenBudget:100000,overBudgetApproved:{reason:'합성 승인: 월 상한 초과 제출'}});
check('a per-run approval cannot start a run whose first case does not fit the monthly cap (Q2, no run recorded)',()=>assert.ok(r.status===409&&/1,500,000/.test(r.body.error)&&/set_budget_approval/.test(r.body.error)&&evalRunCount()===capRunsBefore&&submissions().length===before,JSON.stringify(r.body)));
sql.prepare("DELETE FROM records WHERE kind='eval_run' AND id=?").run(`${owner}:eval_run:seed-overshoot`);
mode.usage={};r=await post({action:'start_run',set:'dev',tokenBudget:100000});before=submissions().length;
const unreported=await drive(r.body.id);mode.usage={input_tokens:1000,output_tokens:500,total_tokens:1500};
check('unreported usage stops the run because the budget cannot be enforced',()=>assert.ok(unreported.stopReason==='usage_unreported'&&submissions().length===before+1&&unreported.results[1].status==='not_run'));
mode.auth=false;r=await post({action:'start_run',caseIds:[cmoCase.id],tokenBudget:50000});
const authFailed=await drive(r.body.id);mode.auth=true;
check('authentication failure is blocked, not failed',()=>assert.ok(authFailed.status==='blocked'&&/인증/.test(authFailed.blockedReason)&&authFailed.results[0].status==='not_run'));
mode.network=false;r=await post({action:'start_run',caseIds:[cmoCase.id],tokenBudget:50000});
const offline=await drive(r.body.id);mode.network=true;
check('connection failure is blocked, not failed',()=>assert.ok(offline.status==='blocked'&&/연결/.test(offline.blockedReason)));
r=await post({action:'start_run',caseIds:[cmoCase.id],tokenBudget:50000});before=submissions().length;
sql.prepare('UPDATE settings SET secret=? WHERE owner=?').run(await opsSettings(EVAL),owner);
const conflicted=await drive(r.body.id);
sql.prepare('UPDATE settings SET secret=? WHERE owner=?').run(await opsSettings(OPS),owner);
check('operations switching to the eval host blocks execution before submit',()=>assert.ok(conflicted.status==='blocked'&&/운영/.test(conflicted.blockedReason)&&submissions().length===before));
r=await post({action:'start_run',caseIds:[cmoCase.id],tokenBudget:50000});before=submissions().length;
sql.prepare('UPDATE settings SET secret=? WHERE owner=?').run(await opsSettings(EVAL+'.'),owner);
const dotted=await drive(r.body.id);
sql.prepare('UPDATE settings SET secret=? WHERE owner=?').run(await opsSettings(OPS),owner);
check('an operational endpoint differing only by a trailing dot still blocks',()=>assert.ok(dotted.status==='blocked'&&/운영/.test(dotted.blockedReason)&&submissions().length===before));
// 제출한 케이스를 조회하다 막히면 그 케이스는 failed가 아니라 blocked(결과 미확인)이고, 이 run을 보낸 연결로 중지를 요청한다.
mode.poll='running';
const inflightRun=async()=>{const res=await post({action:'start_run',caseIds:[cmoCase.id],tokenBudget:50000});await background.advanceBackgroundWork(owner);const run=await runOf(res.body.id);assert.equal(run.results[0].status,'submitted');return run};
let mid=await inflightRun();mode.auth=false;const authMid=await drive(mid.id);mode.auth=true;
check('auth failure while polling marks the submitted case blocked, not failed',()=>assert.ok(authMid.status==='blocked'&&authMid.results[0].status==='blocked'&&authMid.results[0].providerRunId===mid.results[0].providerRunId&&/인증/.test(authMid.results[0].error)&&/중지를 요청했으나 확인하지 못했습니다/.test(authMid.results[0].error)));
mid=await inflightRun();mode.network=false;const netMid=await drive(mid.id);mode.network=true;
check('connection loss while polling marks the submitted case blocked',()=>assert.ok(netMid.status==='blocked'&&netMid.results[0].status==='blocked'&&/연결/.test(netMid.results[0].error)&&!stopped.includes(mid.results[0].providerRunId)));
mid=await inflightRun();await connect({isolationConfirmed:false});const isoMid=await drive(mid.id);await connect();
check('isolation withdrawn mid-run blocks the case and stops the HERMES run',()=>assert.ok(isoMid.status==='blocked'&&isoMid.results[0].status==='blocked'&&/격리/.test(isoMid.results[0].error)&&stopped.includes(mid.results[0].providerRunId)&&/중지를 요청해 확인했습니다/.test(isoMid.results[0].error)));
check('blocked cases are not counted as failures',()=>assert.ok([authMid,netMid,isoMid].every(x=>!x.results.some(c=>c.status==='failed'))));
mode.poll='completed';
mode.poll='running';r=await post({action:'start_run',caseIds:[cmoCase.id],tokenBudget:50000});
await background.advanceBackgroundWork(owner);
sql.prepare("UPDATE records SET data=json_set(data,'$.results[0].submittedAt','2000-01-01T00:00:00.000Z') WHERE id=?").run(`${owner}:eval_run:${r.body.id}`);
const timedOut=await drive(r.body.id);
check('a case running past the timeout is stopped and failed',()=>assert.ok(timedOut.results[0].status==='failed'&&/시간/.test(timedOut.results[0].error)&&stopped.includes(timedOut.results[0].providerRunId)));
r=await post({action:'start_run',set:'dev',tokenBudget:100000});const cancelId=r.body.id;
const runCount=()=>sql.prepare("SELECT COUNT(*) n FROM records WHERE owner=? AND kind='eval_run'").get(owner).n,runsBefore=runCount();
const secondActive=await post({action:'start_run',caseIds:[insightCase.id],tokenBudget:50000});
check('a second active eval run is refused so the fair queue holds one eval item',()=>assert.ok(secondActive.status===409&&/진행 중인 평가 실행/.test(secondActive.body.error)&&!secondActive.body.run&&runCount()===runsBefore));
await background.advanceBackgroundWork(owner);await background.advanceBackgroundWork(owner);
r=await post({action:'delete_case',id:cmoCase.id});
check('a case used by an active run cannot be deleted',()=>assert.equal(r.status,409));
r=await post({action:'delete_run',id:cancelId});
check('an active run cannot be deleted',()=>assert.equal(r.status,409));
const inflight=(await runOf(cancelId)).results[0].providerRunId;
r=await post({action:'cancel_run',id:cancelId});before=submissions().length;
await background.advanceBackgroundWork(owner);
check('cancel stops the in-flight HERMES run and skips the rest',()=>assert.ok(r.status===200&&r.body.status==='cancelled'&&stopped.includes(inflight)&&r.body.results[0].status==='cancelled'&&r.body.results[1].status==='not_run'&&submissions().length===before));
r=await post({action:'cancel_run',id:cancelId});
check('cancelling twice is 409',()=>assert.equal(r.status,409));
mode.poll='unavailable';r=await post({action:'start_run',caseIds:[insightCase.id,cmoCase.id],tokenBudget:100000});const flaky=r.body.id;
await background.advanceBackgroundWork(owner);await background.advanceBackgroundWork(owner);
const attempt=sql.prepare("SELECT data FROM records WHERE owner=? AND kind='background_attempt' AND id=?").get(owner,`${owner}:background_attempt:eval:${flaky}`);
const flakyStatus=sql.prepare("SELECT json_extract(data,'$.status') AS s FROM records WHERE id=?").get(`${owner}:eval_run:${flaky}`).s;
check('gateway 5xx during poll is retried with backoff, not failed or blocked',()=>assert.ok(attempt&&JSON.parse(attempt.data).attempts===1&&flakyStatus==='running'));
sql.prepare("DELETE FROM records WHERE owner=? AND kind='background_attempt'").run(owner);
mode.poll='failed';const failedRun=await drive(flaky);
check('a HERMES-reported failure fails only that case and the run continues',()=>assert.ok(failedRun.status==='completed'&&failedRun.results.every(x=>x.status==='failed')&&failedRun.usedTokens===80&&/failed/.test(failedRun.results[0].error)));
mode.poll='completed';
r=await post({action:'start_run',set:'sealed',tokenBudget:100000,label:'활성화 게이트'});
const sealedRun=await drive(r.body.id);
check('sealed set use records who and when',()=>assert.ok(sealedRun.sealedUsed.by.id===owner&&sealedRun.sealedUsed.cases===1&&sealedRun.sealedUsed.at&&sealedRun.status==='completed'));
check('dev runs do not record sealed use',()=>assert.ok(!run1.sealedUsed));
const spentOutputs=()=>sql.prepare("SELECT COUNT(*) n FROM records WHERE kind='eval_output' AND parent_id=?").get(spent.id).n,outputsBefore=spentOutputs();
r=await post({action:'delete_run',id:spent.id});
const spentTomb=await runOf(spent.id);
check('owner deletes a finished run: outputs and results go, the budget ledger stays',()=>assert.ok(r.status===200&&outputsBefore===1&&spentOutputs()===0&&spentTomb.deleted.by.id===owner&&spentTomb.results.length===0&&spentTomb.usedTokens===40000&&spentTomb.tokenBudget===50000));
r=await get(`?compare=${run1.id},${spent.id}`);
check('a deleted run cannot be compared',()=>assert.equal(r.status,409));

// E) 권한: owner만. member·admin 403, 다른 owner 404, 비로그인 401, 크기 제한 413.
env.AUTH_MODE='email';env.AUTH_ORIGIN='https://agency.test';
const signIn=(id,role,createdAt,ws)=>{const token=createHash('sha256').update(id).digest('hex');sql.prepare('INSERT INTO auth_users(id,email,workspace_owner,role,status,created_at) VALUES(?,?,?,?,?,?)').run(id,id+'@test.invalid',ws,role,'active',createdAt);sql.prepare('INSERT INTO auth_sessions VALUES(?,?,?,?)').run(createHash('sha256').update(token).digest('hex'),id,Date.now()+60000,Date.now());return {cookie:'__Host-collective_session='+token,origin:'https://agency.test'}};
const ownerS=signIn('ws-owner','admin',1000,owner),adminS=signIn('ws-admin','admin',2000,owner),memberS=signIn('ws-member','member',500,owner),strangerS=signIn('other-owner-admin','admin',1000,'other-workspace');
const [anonGet,anonPost,memberGet,adminGet,adminPost,memberPost,ownerGet,ownerPost,strangerGet,strangerPost]=await Promise.all([
 get('',owner,{origin:'https://agency.test'}),post({action:'update_case',id:insightCase.id,label:'x'},owner,{origin:'https://agency.test'}),
 get('',owner,memberS),get('',owner,adminS),post({action:'update_case',id:insightCase.id,label:'x'},owner,adminS),post({action:'save_connection',endpoint:EVAL,key:'k',isolationConfirmed:true},owner,memberS),
 get('',owner,ownerS),post({action:'update_case',id:insightCase.id,label:'owner edit'},owner,ownerS),
 get('?case='+insightCase.id,owner,strangerS),post({action:'update_case',id:insightCase.id,label:'x'},owner,strangerS),
]);
check('unauthenticated requests are 401',()=>assert.ok(anonGet.status===401&&anonPost.status===401));
check('member and admin are 403',()=>assert.ok(memberGet.status===403&&adminGet.status===403&&adminPost.status===403&&memberPost.status===403));
check('workspace owner reads and edits',()=>assert.ok(ownerGet.status===200&&ownerPost.status===200&&ownerPost.body.label==='owner edit'));
check('another workspace owner gets 404',()=>assert.ok(strangerGet.status===404&&strangerPost.status===404));
r=await post(JSON.stringify({action:'update_case',id:insightCase.id,label:'x'.repeat(1100000)}),owner,ownerS);
check('oversized body is 413',()=>assert.equal(r.status,413));
check('no external network call',()=>assert.deepEqual(external,[]));
console.log(JSON.stringify({passed:passed.length}));
