// 평가 종류 골격(Q1): kind별 build·grade·reserveOf(종류 처리기의 값, 케이스별 덮어쓰기 없음), 역할 평가의 운영 조립 공유(운영자 선호 규칙까지 동결), 예약량을 반영한 예산, externalKey 멱등.
// 수용: 선호 블록이 없는 기존 역할 케이스(kind 없음)의 promptHash 불변(합성 재현), 선호 블록이 든 옛 동결본은 운영 해시로 의도적으로 바뀜,
// 선호 규칙이 있는 케이스 1건의 제출이 운영 제출과 바이트 동일, 같은 키에 다른 specHash는 409, 알 수 없는 kind는 400.
// 근거: mocked(평가·운영 HERMES fetch 스텁, 메모리 SQLite, 합성 브랜드·캠페인·선호 규칙). 외부 네트워크 호출은 0회다.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {testRuntime} from './helpers/runtime.mjs';
import {roleFixture} from './helpers/role-fixture.mjs';

const EVAL='https://eval-hermes.example.com',OPS='https://hermes.example.com';
const capabilities={object:'hermes.api_server.capabilities',platform:'hermes-agent',features:{run_submission:true,run_status:true,run_stop:true,runs_idempotency:{durable:true,enabled:true,supported:true}}};
const USAGE={input_tokens:1000,output_tokens:500,total_tokens:1500},mode={usage:USAGE};
const evalRuns=new Map(),external=[];let seq=0;
const {sql,load}=testRuntime(async(url,options={})=>{
 url=String(url);const method=options.method||'GET',headers=new Headers(options.headers||{});
 if(url.startsWith(OPS+'/')){if(url===OPS+'/v1/runs'&&method==='POST')return Response.json({run_id:'ops_'+ ++seq});return new Response('{}',{status:404})}
 if(!url.startsWith(EVAL+'/')){external.push(url);throw new Error('모의 주소만 호출합니다: '+url)}
 const path=url.slice(EVAL.length);
 if(!headers.get('authorization'))return new Response('{}',{status:401});
 if(path==='/v1/capabilities')return Response.json(capabilities);
 if(path==='/v1/models')return Response.json({data:[{id:'mock-eval-model'}]});
 if(path==='/v1/runs'&&method==='POST'){const id='eval_'+ ++seq;evalRuns.set(id,JSON.parse(options.body));return Response.json({run_id:id})}
 const stop=/^\/v1\/runs\/([\w-]+)\/stop$/.exec(path);if(stop)return Response.json({object:'hermes.run',run_id:stop[1],status:'stopped'});
 const id=/^\/v1\/runs\/([\w-]+)$/.exec(path)?.[1];if(!id||!evalRuns.has(id))return new Response('{}',{status:404});
 return Response.json({object:'hermes.run',run_id:id,status:'completed',output:roleFixture(evalRuns.get(id).input),usage:mode.usage,model:'mock-eval-model'});
});
const server=await load('lib/server.ts'),route=await load('app/api/eval/route.ts'),background=await load('lib/background-execution.ts');
const instruction=await load('lib/role-instruction.ts'),execution=await load('lib/role-execution.ts'),kinds=await load('lib/eval-kinds.ts'),agency=await load('lib/agency.ts'),curator=await load('lib/playbook-curator.ts');
const owner='kinds-owner',other='kinds-other',now=new Date().toISOString(),passed=[];
const check=(name,fn)=>{fn();passed.push(name)};
const plain=x=>JSON.parse(JSON.stringify(x));
const put=(kind,id,data,parent='')=>server.recordStatement(owner,kind,id,data,parent).run();
const call=async res=>({status:res.status,body:await res.json()});
const post=(input,user=owner)=>route.POST(new Request('https://agency.test/api/eval',{method:'POST',headers:{'oai-authenticated-user-id':user,'content-type':'application/json'},body:JSON.stringify(input)})).then(call);
const get=(query='',user=owner)=>route.GET(new Request('https://agency.test/api/eval'+query,{headers:{'oai-authenticated-user-id':user}})).then(call);
const sha=text=>createHash('sha256').update(text).digest('hex');
// 기존 평가 제출의 promptHash 규칙(docs/EVAL.ko.md): 지시문·입력의 SHA-256 앞 16자.
const oldHash=req=>sha(instruction.buildRoleInstruction(req)+'\u0000'+instruction.buildRoleInput(req)).slice(0,16);
const caseCount=(who=owner)=>sql.prepare("SELECT COUNT(*) n FROM records WHERE owner=? AND kind='eval_case'").get(who).n;
const runCount=()=>sql.prepare("SELECT COUNT(*) n FROM records WHERE owner=? AND kind='eval_run'").get(owner).n;
const rejects=(fn,pattern)=>assert.throws(fn,e=>e.status===400&&pattern.test(e.message));
sql.prepare('INSERT INTO settings(owner,secret,model,updated_at) VALUES(?,?,?,?)').run(owner,await server.encrypt(JSON.stringify({provider:'hermes',endpoint:OPS,key:'ops-only'})),'HERMES',now);
assert.equal((await post({action:'save_connection',endpoint:EVAL,key:'eval-secret-key',isolationConfirmed:true,note:'메모리 off 평가 프로필'})).body.status,'ready');
const runOf=async id=>(await get('?run='+encodeURIComponent(id))).body;
async function drive(id,max=60){for(let i=0;i<max;i++){const run=await runOf(id);if(!['queued','running'].includes(run.status))return run;await background.advanceBackgroundWork(owner)}return runOf(id)}
const sentFor=result=>[...evalRuns.values()].find(b=>b.session_id===result.idempotencyKey);

// 합성 브랜드 두 개·캠페인 세 개·사실 원장·앞선 작업물·운영자 선호 규칙. 실제 고객·매장 정보가 아니다.
const brand=(id,name)=>({id,name,short:'SY',category:'SNACK BAR',color:'#224466',bg:'#eef2f6',description:'합성 소개(미확인).',audience:'가상동 주민(가설)',tone:'명료한',constraints:'가격은 확인 전 확정하지 않는다.',knowledge:'합성 메모.'});
const campaign=(id,brandId,title)=>({id,brandId,title,goal:'오픈 전 인지와 첫 포장 주문을 만든다.',audience:'가상동 주민(가설)',channels:'Instagram, 매장 안내',stores:'가상동 12',products:'떡볶이(가격 미확정)',budget:null,startDate:'',endDate:'',constraints:'할인 약속 금지.',sources:'',status:'draft',version:1,createdAt:now,updatedAt:now});
await put('brand','syn-brand',brand('syn-brand','가상분식'));await put('brand','syn-brand-p',brand('syn-brand-p','가상포장'));
await put('campaign','syn-a',campaign('syn-a','syn-brand','가상분식 구매전환'));await put('campaign','syn-b',campaign('syn-b','syn-brand','가상분식 오픈'));await put('campaign','syn-p',campaign('syn-p','syn-brand-p','가상포장 오픈'));
const fact=(id,brandId,key,value,status)=>put('brand_fact',id,{id,brandId,key,value,status,source:'합성 원장',verifiedAt:now,validUntil:'2099-12-31T00:00:00.000Z',version:1,updatedAt:now},brandId);
await fact('fact-address','syn-brand','주소','가상동 12','confirmed');await fact('fact-cooking','syn-brand','조리 방식','숯불','rejected');await fact('fact-p','syn-brand-p','주소','가상동 34','confirmed');
await put('artifact','syn-a-cmo',{id:'syn-a-cmo',campaignId:'syn-a',campaignVersion:1,role:'cmo',title:'합성 CMO',content:'## 합성 CMO 초안\n\n포장 동선을 먼저 알리는 조건부 계획입니다.',version:1,status:'review',origin:'ai',createdAt:now},'syn-a');
const PREFERENCE='첫 문장은 고객의 평일 상황으로 시작한다.';
await put('learning_rule','pref-1',{id:'pref-1',origin:'review',grade:'operator_preference',role:'cmo',citations:['d-1','d-2'],feedback:{helpful:0,harmful:0},brandId:'syn-brand-p',channel:'*',experimentId:'',experimentVersion:0,caseId:'',title:'평일 상황으로 시작',guidance:PREFERENCE,scope:'',status:'active',version:1,expiresAt:new Date(Date.now()+30*86400000).toISOString(),createdAt:now,updatedAt:now},'syn-brand-p');

// A) kind 골격(순수): 종류 목록, 없으면 role, 회의 단계·브리프 처리기(G2, tests/eval-meeting-brief.test.mjs가 동작을 본다), 알 수 없는 종류 400, 예약량.
check('the case kinds are role, meeting_step and brief',()=>assert.deepEqual(plain(kinds.EVAL_CASE_KINDS),['role','meeting_step','brief']));
check('a missing kind reads as role (no migration)',()=>assert.ok(kinds.caseKind(undefined)==='role'&&kinds.caseKind('role')==='role'&&kinds.evalKind(undefined).kind==='role'));
for(const bad of ['judge','ROLE','',5,null])check(`unknown kind ${JSON.stringify(bad)} is 400`,()=>rejects(()=>kinds.caseKind(bad),/kind|종류/));
check('meeting_step and brief have handlers (G2): meeting reserves 100,000, brief 50,000',()=>assert.ok(kinds.caseKind('meeting_step')==='meeting_step'&&kinds.evalKind('meeting_step').kind==='meeting_step'&&kinds.reserveOf({kind:'meeting_step'})===100000&&kinds.evalKind('brief').kind==='brief'&&kinds.reserveOf({kind:'brief'})===50000));
check('a stored unknown kind is 400 unsupported',()=>rejects(()=>kinds.evalKind('judge'),/지원하지 않는 평가 종류/));
check('role reserves 50,000 per case by default',()=>assert.ok(kinds.EVAL_CASE_TOKEN_RESERVE===50000&&kinds.reserveOf({expectations:{prohibitedTerms:[]}})===50000&&kinds.reserveOf({kind:'role',expectations:{prohibitedTerms:[]}})===50000));
check('a case reserve comes from its kind only (no per-case override through expectations)',()=>assert.ok(kinds.reserveOf({kind:'role',expectations:{reserveTokens:120000}})===50000&&kinds.reserveOf({expectations:{reserveTokens:20000}})===50000&&!('EVAL_RESERVE_MIN' in kinds)&&!('reserveTokens' in kinds)));

// B) 기존 역할 케이스 promptHash 불변(합성 재현): 운영 캡처 모양(8역할 + 3역할, 선호 규칙 없음)을 kind 없는 옛 레코드로 되돌려 실행한다.
const captured=[];
for(const [c,list] of [['syn-a',agency.roles.map(r=>r.id)],['syn-b',['insight','strategy','cmo']]])for(const role of list){
 const res=await post({action:'capture_case',campaignId:c,role});assert.equal(res.status,200,JSON.stringify(res.body));captured.push(res.body);
}
check('eleven role cases are captured with kind role',()=>assert.ok(captured.length===11&&captured.every(c=>c.kind==='role'&&!c.request.operatorPreferences)));
sql.prepare("UPDATE records SET data=json_remove(data,'$.kind') WHERE owner=? AND kind='eval_case'").run(owner);
check('legacy records have no kind field',()=>assert.ok(sql.prepare("SELECT data FROM records WHERE owner=? AND kind='eval_case'").all(owner).every(r=>!('kind' in JSON.parse(r.data)))));
let r=await post({action:'start_run',caseIds:captured.map(c=>c.id),tokenBudget:100000,label:'옛 케이스 재현'});
const legacy=await drive(r.body.id);
check('legacy role cases all run and complete',()=>assert.ok(legacy.status==='completed'&&legacy.results.length===11&&legacy.results.every(x=>x.status==='completed'),JSON.stringify(legacy.results.map(x=>x.error))));
for(const res of legacy.results){
 const kase=captured.find(c=>c.id===res.caseId),body=sentFor(res);
 check(`${kase.label} promptHash is unchanged`,()=>assert.equal(res.promptHash,oldHash(kase.request)));
 check(`${kase.label} body equals the pure role builders`,()=>assert.ok(body.instructions===instruction.buildRoleInstruction(kase.request)&&body.input===instruction.buildRoleInput(kase.request)&&!('operatorPreferences' in JSON.parse(body.input))));
 check(`${kase.label} is graded by the role kind`,()=>assert.ok(res.graders.length===14&&res.variant==='active'));
}
check('the role kind build equals the pure builders without preferences',()=>assert.deepEqual(plain(kinds.evalKind('role').build(captured[0].request)),{instructions:instruction.buildRoleInstruction(captured[0].request),input:instruction.buildRoleInput(captured[0].request)}));

// C) 선호 규칙이 있는 케이스 1건: 캡처(운영 start 직전 시점) → 평가 제출이 운영 start의 HERMES 제출과 바이트 동일하다.
r=await post({action:'capture_case',campaignId:'syn-p',role:'cmo'});
const prefCase=r.body;
check('the capture freezes the model-facing preference block',()=>assert.ok(r.status===200&&prefCase.request.operatorPreferences?.rules.some(x=>x.text===PREFERENCE)&&!JSON.stringify(prefCase.request).includes('pref-1')&&!JSON.stringify(prefCase.request).includes('d-1')));
const job=await (await execution.executeRole(owner,{action:'start',campaignId:'syn-p',role:'cmo'})).json();
const production=JSON.parse((await server.readRecord(owner,'hermes_submission',job.id)).body);
sql.prepare("UPDATE jobs SET status='cancelled' WHERE id=?").run(job.id);
check('production sends the preference block and the authority sentence',()=>assert.ok(JSON.parse(production.input).operatorPreferences.rules.length===1&&production.instructions===instruction.buildRoleInstruction(prefCase.request)+'\n'+curator.OPERATOR_PREFERENCE_AUTHORITY));
check('the role kind build equals the production submission byte for byte',()=>assert.deepEqual(plain(kinds.evalKind('role').build(prefCase.request)),{instructions:production.instructions,input:production.input}));
r=await post({action:'start_run',caseIds:[prefCase.id],tokenBudget:100000,label:'선호 규칙 동결'});
const prefRun=await drive(r.body.id),prefSent=sentFor(prefRun.results[0]);
check('the eval run completes the preference case',()=>assert.ok(prefRun.status==='completed'&&prefRun.results[0].status==='completed'));
check('eval instructions equal the production instructions byte for byte',()=>assert.equal(prefSent.instructions,production.instructions));
check('eval input equals the production input byte for byte',()=>assert.equal(prefSent.input,production.input));
check('the preference case promptHash hashes the production bytes',()=>assert.equal(prefRun.results[0].promptHash,sha(production.instructions+'\u0000'+production.input).slice(0,16)));
// 기존 케이스 중 동결 요청에 선호 블록이 이미 든 것(B3-1 뒤 캡처)은 Q1 뒤 promptHash가 의도적으로 바뀐다: kind 없는 옛 레코드로 되돌려도 운영 해시를 쓰고 옛 순수 조립 해시와 다르다.
sql.prepare("UPDATE records SET data=json_remove(data,'$.kind') WHERE owner=? AND kind='eval_case' AND id=?").run(owner,`${owner}:eval_case:${prefCase.id}`);
r=await post({action:'start_run',caseIds:[prefCase.id],tokenBudget:100000,label:'선호 블록 옛 케이스'});
const legacyPref=(await drive(r.body.id)).results[0];
check('a legacy frozen case with a preference block now hashes the production bytes, not the old pure builders',()=>assert.ok(legacyPref.status==='completed'&&legacyPref.promptHash===sha(production.instructions+'\u0000'+production.input).slice(0,16)&&legacyPref.promptHash!==oldHash(prefCase.request)));

// D) 예약량(reserveOf)은 종류 처리기의 값이다(역할 50,000, 케이스별 덮어쓰기 없음). run 시작 때 결과 행 reserve에 고정하고,
// run 예산 하한·제출 직전 run 예산·월 상한 재검사가 모두 그 값을 쓴다.
const base=captured.find(c=>c.role==='cmo'&&c.request.campaign.id==='syn-a');
r=await post({action:'save_case',role:'cmo',request:base.request,expectations:{reserveTokens:20000},label:'예약 낮추기 시도'});
const lowered=r.body;
check('expectations.reserveTokens is not stored as a reserve override',()=>assert.ok(r.status===200&&lowered.kind==='role'&&!('reserveTokens' in lowered.expectations)));
let before=runCount();r=await post({action:'start_run',caseIds:[lowered.id],tokenBudget:20000});
check('a budget below the role reserve is 400 and records no run',()=>assert.ok(r.status===400&&/50,000/.test(r.body.error)&&runCount()===before));
mode.usage={input_tokens:15000,output_tokens:5000,total_tokens:20000};
r=await post({action:'start_run',caseIds:[lowered.id,base.id],tokenBudget:60000});
const spent=await drive(r.body.id);mode.usage=USAGE;
check('each result fixes the reserve of its kind at start',()=>assert.ok(spent.results.every(x=>x.reserve===50000)));
check('the next case is not submitted when its reserve would pass the run budget',()=>assert.ok(spent.stopReason==='budget_reached'&&spent.usedTokens===20000&&spent.results[0].status==='completed'&&spent.results[1].status==='not_run'&&/50,000/.test(spent.results[1].error),JSON.stringify(spent.results.map(x=>[x.status,x.error]))));
// 결과 행에 고정한 예약이 50,000이 아니어도(G2 종류 자리, 합성 진행 중 run 행) 제출 직전 검사는 그 행의 값을 쓴다.
const seededRun=(id,tokenBudget,usedTokens,reserve)=>put('eval_run',id,{id,label:'합성 예약 run',variant:'active',set:null,caseIds:[base.id],tokenBudget,usedTokens,status:'running',host:'eval-hermes.example.com',results:[{caseId:base.id,label:base.label,set:'dev',role:'cmo',variant:'active',...(reserve?{reserve}:{}),status:'pending'}],createdAt:now,updatedAt:now,createdBy:{id:owner,email:null}});
await seededRun('wide-run',130000,20000,120000);before=evalRuns.size;
const wide=await drive('wide-run');
check('the run budget re-check uses the reserve fixed on the result row',()=>assert.ok(wide.stopReason==='budget_reached'&&wide.results[0].status==='not_run'&&/120,000/.test(wide.results[0].error)&&evalRuns.size===before,JSON.stringify(wide.results)));
// 월 누적을 1,400,000으로 맞춘다: 기본 예약(50,000)이면 넘지 않고, 결과 행의 예약(120,000)이면 1,500,000을 넘는다.
const usedNow=(await get()).body.usage.usedTokens;
await put('eval_run','seed-month',{id:'seed-month',label:'합성 누적',variant:'active',caseIds:[],tokenBudget:1400000-usedNow,usedTokens:1400000-usedNow,status:'completed',results:[],createdAt:now,updatedAt:now,createdBy:{id:owner,email:null}});
await seededRun('wide-month',200000,0,120000);
const capped=await drive('wide-month');
check('the monthly re-check adds the row reserve, not a fixed 50,000',()=>assert.ok(capped.stopReason==='monthly_cap_reached'&&capped.results[0].status==='not_run'&&evalRuns.size===before,JSON.stringify(capped.results)));
r=await post({action:'start_run',caseIds:[base.id],tokenBudget:50000});
const small=await drive(r.body.id);
check('a default-reserve case still submits under the same month usage',()=>assert.ok(r.status===200&&small.status==='completed'&&small.results[0].status==='completed'&&small.results[0].reserve===50000));
sql.prepare("DELETE FROM records WHERE owner=? AND kind='eval_run' AND id=?").run(owner,`${owner}:eval_run:seed-month`);
// Q1 전에 시작해 진행 중인 run(결과 행에 reserve 없음)은 역할 기본 예약 50,000으로 계속 검사한다.
await put('eval_run','legacy-run',{id:'legacy-run',label:'Q1 전 run',variant:'active',set:null,caseIds:[base.id],tokenBudget:60000,usedTokens:15000,status:'running',host:'eval-hermes.example.com',results:[{caseId:base.id,label:base.label,set:'dev',role:'cmo',variant:'active',status:'pending'}],createdAt:now,updatedAt:now,createdBy:{id:owner,email:null}});
before=evalRuns.size;const legacyStop=await drive('legacy-run');
check('a pre-Q1 run without per-result reserves falls back to the 50,000 role reserve',()=>assert.ok(legacyStop.stopReason==='budget_reached'&&legacyStop.results[0].status==='not_run'&&/50,000/.test(legacyStop.results[0].error)&&evalRuns.size===before,JSON.stringify(legacyStop)));

// E) externalKey 멱등: 같은 키·같은 specHash는 기존 케이스를 돌려주고, 다른 specHash는 409로 거부한다(동결 원칙: 덮어쓰지 않는다).
const HASH='a'.repeat(64),HASH2='b'.repeat(64),manual={action:'save_case',role:'cmo',request:base.request,externalKey:'syn-s2:cmo:v1',specHash:HASH,label:'생성기 케이스'};
let count=caseCount();r=await post(manual);const first=r.body;
check('save_case stores externalKey and specHash',()=>assert.ok(r.status===200&&first.externalKey==='syn-s2:cmo:v1'&&first.specHash===HASH&&caseCount()===count+1));
r=await post({...manual,label:'다른 이름'});
check('the same key and specHash returns the existing case without a new record',()=>assert.ok(r.status===200&&r.body.id===first.id&&r.body.label==='생성기 케이스'&&r.body.updatedAt===first.updatedAt&&caseCount()===count+1));
r=await post({...manual,specHash:HASH2});
check('the same key with another specHash is 409 and changes nothing',()=>assert.ok(r.status===409&&/specHash|스펙/.test(r.body.error)&&caseCount()===count+1&&JSON.stringify(sql.prepare('SELECT data FROM records WHERE id=?').get(`${owner}:eval_case:${first.id}`).data)===JSON.stringify(JSON.stringify(first))));
for(const [name,bad] of [['a key without specHash',{specHash:undefined}],['a specHash without key',{externalKey:undefined}],['a key with spaces',{externalKey:'syn s2'}],['a too long key',{externalKey:'k'.repeat(201)}],['a short specHash',{specHash:'abc'}],['a non-string key',{externalKey:12}]]){
 const res=await post({...manual,...bad});check(`save_case rejects ${name}`,()=>assert.ok(res.status===400&&caseCount()===count+1,JSON.stringify(res.body)));
}
r=await post({action:'capture_case',campaignId:'syn-b',role:'cmo',externalKey:'syn-cap:cmo',specHash:HASH});const capFirst=r.body;
const capAgain=await post({action:'capture_case',campaignId:'syn-b',role:'cmo',externalKey:'syn-cap:cmo',specHash:HASH}),capOther=await post({action:'capture_case',campaignId:'syn-b',role:'cmo',externalKey:'syn-cap:cmo',specHash:HASH2});
check('capture_case is idempotent on externalKey and refuses another specHash',()=>assert.ok(r.status===200&&capFirst.externalKey==='syn-cap:cmo'&&capAgain.status===200&&capAgain.body.id===capFirst.id&&capOther.status===409));
r=await post(manual,other);
check('externalKey is scoped to the owner',()=>assert.ok(r.status===200&&r.body.id!==first.id&&caseCount(other)===1));
await post({action:'delete_case',id:first.id});r=await post({...manual,specHash:HASH2});
check('deleting the case frees its externalKey',()=>assert.ok(r.status===200&&r.body.id!==first.id&&r.body.specHash===HASH2));

// F) kind 입력: 알 수 없는 종류 400, 회의·브리프 요청 형식이 아니면 400(G2), 저장된 알 수 없는 종류는 실행 시작에서 400(기록 없음).
count=caseCount();
for(const bad of ['judge',5,'Role'])for(const action of ['save_case','capture_case']){
 const res=await post({action,kind:bad,role:'cmo',campaignId:'syn-a',request:base.request});check(`${action} rejects kind ${JSON.stringify(bad)}`,()=>assert.ok(res.status===400&&/kind|종류/.test(res.body.error)));
}
for(const slot of ['meeting_step','brief'])for(const action of ['save_case','capture_case']){
 const res=await post({action,kind:slot,role:'cmo',campaignId:'syn-a',request:base.request});check(`${action} ${slot} with a role-shaped input is 400`,()=>assert.ok(res.status===400&&/회의|브리프/.test(res.body.error),JSON.stringify(res.body)));
}
check('rejected kinds store no case',()=>assert.equal(caseCount(),count));
r=await post({action:'save_case',kind:'role',role:'cmo',request:base.request});
check('an explicit role kind saves',()=>assert.ok(r.status===200&&r.body.kind==='role'));
for(const kind of ['judge']){
 const id='stored-'+kind;await put('eval_case',id,{...plain(r.body),id,kind});before=runCount();
 const res=await post({action:'start_run',caseIds:[id],tokenBudget:100000});
 check(`a stored ${kind} case cannot start a run (400, no run)`,()=>assert.ok(res.status===400&&/지원하지 않는 평가 종류/.test(res.body.error)&&runCount()===before));
}
r=await post({action:'save_case',role:'cmo',request:{...base.request,operatorPreferences:'x'}});
check('a manual request with a malformed preference block is 400',()=>assert.equal(r.status,400));
check('no external network call',()=>assert.deepEqual(external,[]));
console.log(JSON.stringify({passed:passed.length}));
