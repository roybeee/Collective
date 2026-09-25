// AI 심사 보정 라벨(J2): /api/eval ?labels=queue·item, save_label, 라벨이 있는 run의 delete_run 409, 권한(관리자·직원 403).
// 수용: 대기열·항목 응답에 run id·케이스 id·variant·모델·케이스 이름·채점 결과가 없다(블라인드), 순서는 표시 id(해시) 순, 봉인 세트·pair run·삭제한 run·
// quality 역할(적용 기준 없음)은 대상이 아니다, 적용 기준마다 1~5 또는 na를 빠짐없이 줘야 저장된다, relabel은 첫 라벨 뒤에만, 라벨이 있는 run은 지울 수 없다.
// 근거: mocked(평가 HERMES fetch 스텁, 메모리 SQLite, 합성 캠페인). 외부 네트워크 호출은 0회다.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {testRuntime} from './helpers/runtime.mjs';
import {roleFixture} from './helpers/role-fixture.mjs';

const EVAL='https://eval-hermes.example.com',bodies=new Map(),external=[];let seq=0;
const capabilities={object:'hermes.api_server.capabilities',platform:'hermes-agent',features:{run_submission:true,run_status:true,run_stop:true,runs_idempotency:{durable:true,enabled:true,supported:true}}};
const {sql,load,env}=testRuntime(async(url,options={})=>{
 url=String(url);const method=options.method||'GET',headers=new Headers(options.headers||{});
 if(url.startsWith('https://hermes.example.com/'))return Response.json({run_id:'ops'});
 if(!url.startsWith(EVAL+'/')){external.push(url);throw new Error('모의 주소만 호출합니다: '+url)}
 const path=url.slice(EVAL.length);
 if(!headers.get('authorization'))return new Response('{}',{status:401});
 if(path==='/v1/capabilities')return Response.json(capabilities);
 if(path==='/v1/models')return Response.json({data:[{id:'mock-secret-model'}]});
 if(path==='/v1/runs'&&method==='POST'){const id='j2_'+ ++seq;bodies.set(id,JSON.parse(options.body));return Response.json({run_id:id})}
 const id=/^\/v1\/runs\/([\w-]+)$/.exec(path)?.[1];if(!id||!bodies.has(id))return new Response('{}',{status:404});
 return Response.json({object:'hermes.run',run_id:id,status:'completed',output:roleFixture(bodies.get(id).input),usage:{input_tokens:1000,output_tokens:500,total_tokens:1500},model:'mock-secret-model'});
});
const server=await load('lib/server.ts'),route=await load('app/api/eval/route.ts'),background=await load('lib/background-execution.ts'),rubric=await load('lib/judge-rubric.ts');
const owner='j2-owner',now=new Date().toISOString(),passed=[];
const check=(name,fn)=>{fn();passed.push(name)};
const put=(kind,id,data,parent='')=>server.recordStatement(owner,kind,id,data,parent).run();
const call=async res=>({status:res.status,body:await res.json()});
const post=(input,headers={})=>route.POST(new Request('https://agency.test/api/eval',{method:'POST',headers:{'oai-authenticated-user-id':owner,'content-type':'application/json',...headers},body:JSON.stringify(input)})).then(call);
const get=(query,headers={})=>route.GET(new Request('https://agency.test/api/eval'+query,{headers:{'oai-authenticated-user-id':owner,...headers}})).then(call);
const labelCount=()=>sql.prepare("SELECT COUNT(*) n FROM records WHERE owner=? AND kind='judge_label'").get(owner).n;
await sql.prepare('INSERT INTO settings(owner,secret,model,updated_at) VALUES(?,?,?,?)').run(owner,await server.encrypt(JSON.stringify({provider:'hermes',endpoint:'https://hermes.example.com',key:'ops-only'})),'HERMES',now);
assert.equal((await post({action:'save_connection',endpoint:EVAL,key:'eval-secret-key',isolationConfirmed:true,note:'메모리 off 평가 프로필'})).body.status,'ready');
await put('brand','j2-brand',{id:'j2-brand',name:'가상분식',short:'GB',category:'SNACK BAR',color:'#224466',bg:'#eef2f6',description:'합성 소개(미확인).',audience:'가상동 주민(가설)',tone:'명료한',constraints:'가격은 확인 전 확정하지 않는다.',knowledge:''});
await put('campaign','j2-campaign',{id:'j2-campaign',brandId:'j2-brand',title:'J2 합성 캠페인',goal:'첫 포장 주문을 만든다.',audience:'가상동 주민(가설)',channels:'Instagram',stores:'가상동 12',products:'떡볶이(가격 미확정)',budget:null,startDate:'',endDate:'',constraints:'할인 약속 금지.',sources:'',status:'draft',version:1,createdAt:now,updatedAt:now});
// 케이스: dev 역할 3개(cmo·creative·quality), 봉인 cmo 1개.
const cases={};
for(const [role,set] of [['cmo','dev'],['creative','dev'],['quality','dev'],['insight','sealed']]){const r=await post({action:'capture_case',campaignId:'j2-campaign',role,set,label:`SECRET-LABEL-${role}`});assert.equal(r.status,200,JSON.stringify(r.body));cases[`${role}:${set}`]=r.body.id}
async function runAll(caseIds){
 const r=await post({action:'start_run',caseIds,tokenBudget:250000});assert.equal(r.status,200,JSON.stringify(r.body));
 let run=r.body;for(let i=0;i<60&&['queued','running'].includes(run.status);i++){await background.advanceBackgroundWork(owner);run=(await get('?run='+run.id)).body}
 assert.equal(run.status,'completed');return run;
}
const runA=await runAll(Object.values(cases)),runB=await runAll([cases['cmo:dev']]);

// 1) 대기열: 대상은 dev·active·적용 기준이 있는 역할만(봉인·quality 제외), run 2개 × cmo·creative = 3항목.
let r=await get('?labels=queue&limit=50');
check('the queue lists dev role outputs with criteria only (sealed and quality excluded)',()=>assert.ok(r.status===200&&r.body.items.length===3&&r.body.counts.items===3&&r.body.counts.labeled===0,JSON.stringify(r.body.counts)));
const queue=r.body,text=JSON.stringify(queue);
check('queue items are ordered by display id and use L+10 hex ids',()=>assert.ok(queue.items.every(i=>/^L[0-9a-f]{10}$/.test(i.itemId))&&queue.items.map(i=>i.itemId).join()===[...queue.items.map(i=>i.itemId)].sort().join()));
check('the queue is blind: no run id, case id, variant, model, case label or grading',()=>assert.ok([runA.id,runB.id,...Object.values(cases),'variant','candidate','mock-secret-model','SECRET-LABEL','graders','promptHash','expectations','"active"'].every(v=>!text.includes(v)),text.slice(0,400)));
check('each item carries the rendered output, role name and applicable criteria',()=>assert.ok(queue.items.every(i=>typeof i.output==='string'&&i.output.length>100&&i.roleName&&JSON.stringify(i.criteria)===JSON.stringify(rubric.applicableCriteria(i.role)))));
check('the rubric (7 criteria with 5 anchors) comes with the queue',()=>assert.ok(queue.rubricVersion==='judge-rubric-v1'&&queue.criteria.length===7&&queue.criteria.every(c=>c.anchors.length===5)));
r=await get('?labels=queue&limit=1');
check('limit bounds the queue',()=>assert.ok(r.status===200&&r.body.items.length===1&&r.body.items[0].itemId===queue.items[0].itemId));
for(const q of ['?labels=queue&limit=0','?labels=queue&limit=51','?labels=queue&limit=x','?labels=other']){r=await get(q);check(`bad label query ${q} is 400`,()=>assert.equal(r.status,400))}

// 2) 저장: 적용 기준마다 1~5 또는 na.
const cmoItem=queue.items.find(i=>i.role==='cmo'),full=Object.fromEntries(cmoItem.criteria.map((c,i)=>[c,i===0?'na':i+2]));
for(const [name,scores] of [['a missing criterion',Object.fromEntries(Object.entries(full).slice(1))],['a criterion outside the role',{...full,concept_diversity:3}],['a score of 6',{...full,[cmoItem.criteria[1]]:6}],['a fractional score',{...full,[cmoItem.criteria[1]]:2.5}],['no scores',undefined]]){
 r=await post({action:'save_label',itemId:cmoItem.itemId,scores});check(`saving with ${name} is 400`,()=>assert.equal(r.status,400,JSON.stringify(r.body)));
}
r=await post({action:'save_label',itemId:'Lffffffffff',scores:full});check('an unknown item is 404',()=>assert.equal(r.status,404));
r=await post({action:'save_label',itemId:cmoItem.itemId,scores:full,use:'relabel'});check('relabel before a first label is 409',()=>assert.equal(r.status,409));
r=await post({action:'save_label',itemId:cmoItem.itemId,scores:full,use:'sealed'});check('an unknown use is 400',()=>assert.equal(r.status,400));
check('rejected saves store nothing',()=>assert.equal(labelCount(),0));
r=await post({action:'save_label',itemId:cmoItem.itemId,scores:full,note:'합성 메모'});
check('a complete label saves (na stored as null)',()=>assert.ok(r.status===200&&r.body.use==='measure'&&r.body.scores[cmoItem.criteria[0]]===null&&r.body.scores[cmoItem.criteria[1]]===3,JSON.stringify(r.body)));
const stored=JSON.parse(sql.prepare("SELECT data,parent_id FROM records WHERE owner=? AND kind='judge_label'").get(owner).data);
check('the stored label keeps its run link, rubric version and output hash server-side',()=>assert.ok(stored.runId&&stored.caseId&&stored.variant==='active'&&stored.rubricVersion==='judge-rubric-v1'&&/^[0-9a-f]{64}$/.test(stored.outputHash)&&stored.labeledBy.id===owner));
r=await get('?labels=queue&limit=50');
check('a labeled item leaves the queue and the count moves',()=>assert.ok(r.body.items.length===2&&!r.body.items.some(i=>i.itemId===cmoItem.itemId)&&r.body.counts.labeled===1&&r.body.counts.byUse.measure===1));
r=await post({action:'save_label',itemId:cmoItem.itemId,scores:full,use:'anchor'});
check('saving again as anchor replaces the first label (one row)',()=>assert.ok(r.status===200&&labelCount()===1&&r.body.use==='anchor'));
r=await post({action:'save_label',itemId:cmoItem.itemId,scores:Object.fromEntries(cmoItem.criteria.map(c=>[c,4])),use:'relabel'});
check('a relabel after the first label is a second row',()=>assert.ok(r.status===200&&labelCount()===2));
r=await get('?labels=item&id='+cmoItem.itemId);
check('an item read shows its labels without run links',()=>assert.ok(r.status===200&&r.body.item.labels.length===2&&!JSON.stringify(r.body).includes(runA.id)&&!JSON.stringify(r.body).includes('caseId')));
r=await get('?labels=item&id=Lffffffffff');check('reading an unknown item is 404',()=>assert.equal(r.status,404));

// 3) 라벨이 있는 run은 삭제할 수 없다. 라벨 없는 run은 지울 수 있고, 지운 run의 항목은 대기열에서 빠진다.
const labeledRun=stored.runId,otherRun=labeledRun===runA.id?runB.id:runA.id;
r=await post({action:'delete_run',id:labeledRun});
check('a run with labels cannot be deleted (409)',()=>assert.ok(r.status===409&&/보정 라벨/.test(r.body.error)));
r=await post({action:'delete_run',id:otherRun});
check('a run without labels can be deleted',()=>assert.equal(r.status,200));
r=await get('?labels=queue&limit=50');
check('a deleted run leaves the queue',()=>assert.ok(r.body.counts.items===(labeledRun===runA.id?2:1)));

// 4) 권한: 관리자·직원은 읽기·쓰기 모두 403(평가 API 소유자 전용).
env.AUTH_MODE='email';env.AUTH_ORIGIN='https://agency.test';
const signIn=(id,role,createdAt)=>{const token=createHash('sha256').update(id).digest('hex');sql.prepare('INSERT INTO auth_users(id,email,workspace_owner,role,status,created_at) VALUES(?,?,?,?,?,?)').run(id,id+'@test.invalid',owner,role,'active',createdAt);sql.prepare('INSERT INTO auth_sessions VALUES(?,?,?,?)').run(createHash('sha256').update(token).digest('hex'),id,Date.now()+60000,Date.now());return {cookie:'__Host-collective_session='+token,origin:'https://agency.test'}};
signIn('j2-ws-owner','admin',1000);
const beforeDenied=labelCount();
for(const [role,session] of [['admin',signIn('j2-ws-admin','admin',2000)],['member',signIn('j2-ws-member','member',500)]]){
 const read=await get('?labels=queue',session),write=await post({action:'save_label',itemId:cmoItem.itemId,scores:full},session);
 check(`${role} cannot read or save labels (403)`,()=>assert.ok(read.status===403&&write.status===403,JSON.stringify([read.status,write.status])));
}
const anon=await post({action:'save_label',itemId:cmoItem.itemId,scores:full},{origin:'https://agency.test'});
check('an unauthenticated save is 401',()=>assert.equal(anon.status,401));
check('denied requests store nothing',()=>assert.equal(labelCount(),beforeDenied));
check('no external network call',()=>assert.deepEqual(external,[]));
console.log(JSON.stringify({passed:passed.length}));
