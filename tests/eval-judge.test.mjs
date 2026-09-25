// AI 심사 실행(J3): start_run variant judge(보정 라벨이 있는 출력만), 심사 프롬프트(J1)·금지 값, 결과(점수만)·judge_output(인용), ?judge 보정 통계, 예산·멱등·거부.
// 수용: 라벨이 없으면 400, 예약 25,000(그보다 작은 예산 400), 케이스·세트 입력 400, 같은 케이스의 두 원 run 항목은 표시 id로 멱등 키가 다르다,
// run·목록 GET에 인용·이유가 없다, 모델 이름이 든 출력은 심사를 보내지 않는다(그 항목 failed), JSON이 아닌 응답은 모든 기준 무효, compare·regrade는 400,
// 월 사용량에 심사 토큰이 들어간다, 심사 run을 지우면 judge_output도 지운다.
// 근거: mocked(평가 HERMES fetch 스텁, 메모리 SQLite, 합성 캠페인). 외부 네트워크 호출은 0회다.
import assert from 'node:assert/strict';
import {testRuntime} from './helpers/runtime.mjs';
import {roleFixture} from './helpers/role-fixture.mjs';

const EVAL='https://eval-hermes.example.com',bodies=new Map(),external=[];let seq=0;
const MODEL='mock-secret-model',mode={leakRole:null,brokenJudge:false};
const capabilities={object:'hermes.api_server.capabilities',platform:'hermes-agent',features:{run_submission:true,run_status:true,run_stop:true,runs_idempotency:{durable:true,enabled:true,supported:true}}};
// 심사 응답: 보낸 산출물(input.output)의 한 줄을 그대로 인용하고 기준마다 3점을 준다.
function judgeAnswer(input){
 if(mode.brokenJudge)return '합성: JSON이 아닌 심사 응답';
 const line=input.output.split('\n').map(s=>s.trim()).find(s=>s.length>=12&&!s.startsWith('#'))||input.output.slice(0,20);
 const criteria=rubric.applicableCriteria(input.task.role);
 return JSON.stringify({rubricVersion:'judge-rubric-v1',criteria:criteria.map(id=>({id,score:3,uncertain:false,quotes:[line.slice(0,40)],reason:'합성 이유: 인용한 문장이 근거를 일부 보입니다. 문의 010-2468-1357(합성).'}))});
}
const {sql,load}=testRuntime(async(url,options={})=>{
 url=String(url);const method=options.method||'GET',headers=new Headers(options.headers||{});
 if(url.startsWith('https://hermes.example.com/'))return Response.json({run_id:'ops'});
 if(!url.startsWith(EVAL+'/')){external.push(url);throw new Error('모의 주소만 호출합니다: '+url)}
 const path=url.slice(EVAL.length);
 if(!headers.get('authorization'))return new Response('{}',{status:401});
 if(path==='/v1/capabilities')return Response.json(capabilities);
 if(path==='/v1/models')return Response.json({data:[{id:MODEL}]});
 if(path==='/v1/runs'&&method==='POST'){const id='j3_'+ ++seq;bodies.set(id,JSON.parse(options.body));return Response.json({run_id:id})}
 const id=/^\/v1\/runs\/([\w-]+)$/.exec(path)?.[1];if(!id||!bodies.has(id))return new Response('{}',{status:404});
 const body=bodies.get(id),input=JSON.parse(body.input),judge=typeof input.output==='string'&&input.task?.kind==='role';
 const role=judge?null:input.task?.role;
 const output=judge?judgeAnswer(input):roleFixture(body.input)+(role&&role===mode.leakRole?`\n\n모델 메모: ${MODEL}`:'');
 return Response.json({object:'hermes.run',run_id:id,status:'completed',output,usage:{input_tokens:2000,output_tokens:500,total_tokens:2500},model:MODEL});
});
const server=await load('lib/server.ts'),route=await load('app/api/eval/route.ts'),background=await load('lib/background-execution.ts'),rubric=await load('lib/judge-rubric.ts');
const owner='j3-owner',now=new Date().toISOString(),passed=[];
const check=(name,fn)=>{fn();passed.push(name)};
const put=(kind,id,data,parent='')=>server.recordStatement(owner,kind,id,data,parent).run();
const call=async res=>({status:res.status,body:await res.json()});
const post=input=>route.POST(new Request('https://agency.test/api/eval',{method:'POST',headers:{'oai-authenticated-user-id':owner,'content-type':'application/json'},body:JSON.stringify(input)})).then(call);
const get=query=>route.GET(new Request('https://agency.test/api/eval'+query,{headers:{'oai-authenticated-user-id':owner}})).then(call);
const count=kind=>sql.prepare('SELECT COUNT(*) n FROM records WHERE owner=? AND kind=?').get(owner,kind).n;
await sql.prepare('INSERT INTO settings(owner,secret,model,updated_at) VALUES(?,?,?,?)').run(owner,await server.encrypt(JSON.stringify({provider:'hermes',endpoint:'https://hermes.example.com',key:'ops-only'})),'HERMES',now);
assert.equal((await post({action:'save_connection',endpoint:EVAL,key:'eval-secret-key',isolationConfirmed:true,note:'메모리 off 평가 프로필'})).body.status,'ready');
await put('brand','j3-brand',{id:'j3-brand',name:'가상분식',short:'GB',category:'SNACK BAR',color:'#224466',bg:'#eef2f6',description:'합성 소개(미확인).',audience:'가상동 주민(가설)',tone:'명료한',constraints:'가격은 확인 전 확정하지 않는다.',knowledge:''});
await put('campaign','j3-campaign',{id:'j3-campaign',brandId:'j3-brand',title:'J3 합성 캠페인',goal:'첫 포장 주문을 만든다.',audience:'가상동 주민(가설)',channels:'Instagram',stores:'가상동 12',products:'떡볶이(가격 미확정)',budget:null,startDate:'',endDate:'',constraints:'할인 약속 금지.',sources:'',status:'draft',version:1,createdAt:now,updatedAt:now});
const cases={};
for(const role of ['cmo','insight','creative']){const r=await post({action:'capture_case',campaignId:'j3-campaign',role,label:`SECRET-LABEL-${role}`});assert.equal(r.status,200);cases[role]=r.body.id}
async function drive(id){let run=(await get('?run='+id)).body;for(let i=0;i<80&&['queued','running'].includes(run.status);i++){await background.advanceBackgroundWork(owner);run=(await get('?run='+id)).body}return run}
async function evalRun(caseIds){const r=await post({action:'start_run',caseIds,tokenBudget:250000});assert.equal(r.status,200,JSON.stringify(r.body));return drive(r.body.id)}

// 0) 라벨이 없으면 심사할 것이 없다.
let r=await post({action:'start_run',variant:'judge',tokenBudget:100000});
check('a judge run without labels is 400',()=>assert.ok(r.status===400&&/보정 라벨/.test(r.body.error)));
// 원 평가 run 두 개(같은 cmo 케이스를 두 번), creative는 출력에 모델 이름이 섞인다(금지 값).
mode.leakRole='creative';
const runA=await evalRun([cases.cmo,cases.insight,cases.creative]);mode.leakRole=null;
const runB=await evalRun([cases.cmo]);
const queue=(await get('?labels=queue&limit=50')).body;
check('four label items exist (cmo twice, insight, creative)',()=>assert.equal(queue.items.length,4));
for(const item of queue.items){
 const scores=Object.fromEntries(item.criteria.map((c,i)=>[c,i%2?2:4]));
 const s=await post({action:'save_label',itemId:item.itemId,scores});assert.equal(s.status,200,JSON.stringify(s.body));
}
const usageBefore=(await get('')).body.usage.usedTokens;

// 1) 시작 입력 검사.
for(const [name,input] of [['case ids',{caseIds:[cases.cmo]}],['a set',{set:'dev'}],['a pair target',{pair:{unit:'role.cmo'}}],['limit 0',{limit:0}],['limit 101',{limit:101}]]){
 r=await post({action:'start_run',variant:'judge',tokenBudget:100000,...input});check(`a judge run with ${name} is 400`,()=>assert.equal(r.status,400,JSON.stringify(r.body)));
}
r=await post({action:'start_run',variant:'judge',tokenBudget:20000});
check('a judge budget below one judge reserve (25,000) is 400',()=>assert.ok(r.status===400&&/25,000/.test(r.body.error)));
check('rejected judge starts record no run',()=>assert.equal(count('eval_run'),2));

// 2) 심사 실행.
r=await post({action:'start_run',variant:'judge',tokenBudget:250000,label:'J3 합성 심사'});
check('a judge run starts over the four labeled items with a 25,000 reserve each',()=>assert.ok(r.status===200&&r.body.variant==='judge'&&r.body.results.length===4&&r.body.results.every(x=>x.reserve===25000&&/^L[0-9a-f]{10}$/.test(x.judge.itemId)&&[runA.id,runB.id].includes(x.judge.sourceRunId)),JSON.stringify(r.body).slice(0,300)));
const judgeRunId=r.body.id,sentBefore=seq;
let run=await drive(judgeRunId);
const judgeBodies=[...bodies.entries()].filter(([k])=>Number(k.slice(3))>sentBefore).map(([,b])=>b);
check('the judge run completes three items and fails the one whose output carries the model name',()=>{const failed=run.results.filter(x=>x.status==='failed');assert.ok(run.status==='completed'&&run.results.filter(x=>x.status==='completed').length===3&&failed.length===1&&failed[0].role==='creative'&&/forbidden_field/.test(failed[0].error),JSON.stringify(run.results.map(x=>[x.role,x.status,x.error])))});
check('the two items of the same case got different idempotency keys',()=>{const cmo=run.results.filter(x=>x.role==='cmo');assert.ok(cmo.length===2&&cmo[0].idempotencyKey!==cmo[1].idempotencyKey&&cmo.every(x=>x.status==='completed'))});
check('judge submissions carry no model name, run id, case label or golden label',()=>{const t=JSON.stringify(judgeBodies);assert.ok(judgeBodies.length===3&&[MODEL,runA.id,runB.id,'SECRET-LABEL','prohibitedTerms','expectations','"variant"'].every(v=>!t.includes(v)))});
check('judge submissions use the J1 judge instructions and the rendered output',()=>assert.ok(judgeBodies.every(b=>/독립 심사자/.test(b.instructions)&&JSON.parse(b.input).output.length>100)));
const completed=run.results.filter(x=>x.status==='completed');
check('results keep per-criterion scores for the applicable criteria only',()=>assert.ok(completed.every(x=>JSON.stringify(x.judge.scores.map(s=>s.id))===JSON.stringify(rubric.applicableCriteria(x.role))&&x.judge.scores.every(s=>s.score===3&&s.valid&&!s.uncertain))));
const runText=JSON.stringify(await get('?run='+judgeRunId)),listText=JSON.stringify((await get('')).body.runs);
check('run and list reads carry no quotes or reasons',()=>assert.ok(!runText.includes('합성 이유')&&!listText.includes('합성 이유')&&!runText.includes('"quotes"')));
check('judge outputs (quotes, reasons) are stored per item under the judge run',()=>assert.equal(count('judge_output'),3));
const item=completed[0].judge.itemId;
r=await get(`?judge=${judgeRunId}&itemId=${item}`);
check('an item read returns its quotes and reasons',()=>assert.ok(r.status===200&&r.body.parse.ok&&r.body.parse.criteria.every(c=>c.quotes.length===1&&c.reason)));
check('stored reasons and the raw judge answer are masked',()=>{const t=JSON.stringify(r.body);assert.ok(!t.includes('010-2468-1357')&&t.includes('[전화번호]'),t.slice(0,300))});
r=await get('?judge='+judgeRunId);
check('the judge read lists item scores and calibration stats with adoption (reference on a small sample)',()=>assert.ok(r.status===200&&r.body.items.length===3&&r.body.calibration.length>0&&r.body.calibration.every(c=>c.stats.labelled>0&&c.adoption.status==='reference'&&c.adoption.reasons.some(x=>x.code==='small_sample')),JSON.stringify(r.body).slice(0,400)));
check('the judge read carries no quotes',()=>assert.ok(!JSON.stringify(r.body).includes('합성 이유')));
const usageAfter=(await get('')).body.usage.usedTokens;
check('judge tokens count toward the monthly evaluation usage',()=>assert.equal(usageAfter-usageBefore,3*2500));

// 3) 다른 읽기·작업은 심사 run을 받지 않는다.
r=await get(`?compare=${runA.id},${judgeRunId}`);check('compare rejects a judge run (400)',()=>assert.equal(r.status,400));
r=await post({action:'regrade_run',id:judgeRunId});check('regrade rejects a judge run (400)',()=>assert.equal(r.status,400));
r=await get('?judge='+runA.id);check('a judge read of an evaluation run is 400',()=>assert.equal(r.status,400));
r=await get('?labels=queue&limit=50');check('judge runs never appear in the label queue',()=>assert.equal(r.body.counts.items,4));

// 4) JSON이 아닌 심사 응답은 적용 기준 모두 무효(bad_shape)로 센다.
mode.brokenJudge=true;
r=await post({action:'start_run',variant:'judge',tokenBudget:100000,limit:1});run=await drive(r.body.id);mode.brokenJudge=false;
check('a non-JSON judge answer marks every applicable criterion invalid',()=>{const x=run.results[0];assert.ok(x.status==='completed'&&x.judge.error==='not_json'&&x.judge.scores.every(s=>!s.valid&&s.score===null&&s.invalid.includes('bad_shape')),JSON.stringify(x))});

// 5) 심사 run 삭제는 judge_output도 지운다(라벨은 원 평가 run에 걸려 있어 그대로다).
r=await post({action:'delete_run',id:judgeRunId});
check('deleting a judge run deletes its judge outputs and keeps labels',()=>assert.ok(r.status===200&&count('judge_output')===1&&count('judge_label')===4));
check('no external network call',()=>assert.deepEqual(external,[]));
console.log(JSON.stringify({passed:passed.length}));
