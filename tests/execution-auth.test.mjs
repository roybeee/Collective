import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {testRuntime} from './helpers/runtime.mjs';

const rt=testRuntime(async()=>{throw new Error('External calls forbidden in auth regression')});
Object.assign(rt.env,{AUTH_MODE:'email',AUTH_ORIGIN:'https://app.test'});
const server=await rt.load('lib/server.ts'),route=await rt.load('app/api/execution/route.ts'),factRoute=await rt.load('app/api/brand-facts/route.ts');
await server.seedBrands('workspace');
await server.recordStatement('workspace','campaign','c',{id:'c',brandId:'oda',version:1}).run();
for(const [id,role,token] of [['admin','admin','a'.repeat(64)],['member','member','b'.repeat(64)]]){
 rt.sql.prepare('INSERT INTO auth_users(id,email,workspace_owner,role,status,created_at) VALUES(?,?,?,?,?,?)').run(id,id+'@test.invalid','workspace',role,'active',Date.now());
 rt.sql.prepare('INSERT INTO auth_sessions VALUES(?,?,?,?)').run(createHash('sha256').update(token).digest('hex'),id,Date.now()+60000,Date.now());
}
const request=(token,data,origin='https://app.test')=>new Request('https://app.test/api/execution'+(data?'':'?campaignId=c'),{method:data?'POST':'GET',headers:{cookie:'__Host-collective_session='+token,'oai-authenticated-user-id':'forged-workspace',origin,'content-type':'application/json'},...(data?{body:JSON.stringify({campaignId:'c',...data})}:{})});
let passed=0;
for(const action of ['save_limits','connect_buffer','disconnect_buffer','buffer_channels','approve','execute','cancel','reconfirm','resolve_uncertain']){assert.equal((await route.POST(request('b'.repeat(64),{action}))).status,403,action);passed++}
// A4-2: 게시 코드를 발급하는 발행 준비(trackingCode가 있는 save_publication)는 관리자만 한다. 직원은 값과 상관없이 403이고 추적 코드가 생기지 않는다.
// 코드 없는 준비(필드 없음·null)는 권한으로 막지 않는다(여기서는 없는 소재라 404).
const codeCount=()=>rt.sql.prepare("SELECT COUNT(*) AS n FROM records WHERE owner='workspace' AND kind='tracking_code'").get().n;
const draft={action:'save_publication',creativeId:'x',scheduledAt:new Date(Date.now()+3600000).toISOString(),plannedCostKRW:0};
for(const trackingCode of [{type:'coupon'},{type:'pos_tag',storeId:'s'},false,0,'',[],{}]){assert.equal((await route.POST(request('b'.repeat(64),{...draft,trackingCode}))).status,403,'member coded draft '+JSON.stringify(trackingCode));passed++}
assert.equal(codeCount(),0,'member coded draft issues no tracking code');passed++;
for(const extra of [{},{trackingCode:null}]){assert.equal((await route.POST(request('b'.repeat(64),{...draft,...extra}))).status,404,'member code-free draft '+JSON.stringify(extra));passed++}
assert.equal((await route.GET(request('b'.repeat(64)))).status,200);passed++;
assert.equal((await route.GET(request('c'.repeat(64)))).status,401);passed++;
assert.equal((await route.POST(request('a'.repeat(64),{action:'save_limits',maxPublications:1,maxPlannedCostKRW:0}))).status,200);passed++;
assert.equal((await route.POST(request('a'.repeat(64),{action:'save_limits',version:1,maxPublications:1,maxPlannedCostKRW:0},'https://evil.test'))).status,403);passed++;
assert.equal((await factRoute.GET(new Request('https://app.test/api/brand-facts?brandId=oda',{headers:{cookie:'__Host-collective_session='+'b'.repeat(64)}}))).status,200);passed++;
// 연결 해제는 관리자 실제 계정을 감사 이벤트에 남긴다(자격증명은 외부 호출 없이 직접 심는다).
await server.recordStatement('workspace','publisher_credential','oda',{secret:await server.encrypt('test-only-token'),channelId:'channel-1',account:'ODA',version:1},'oda').run();
assert.equal((await route.POST(request('a'.repeat(64),{action:'disconnect_buffer',version:1}))).status,200);passed++;
assert.ok(rt.sql.prepare("SELECT data FROM records WHERE owner='workspace' AND kind='event'").all().map(r=>JSON.parse(r.data)).some(e=>e.message.includes('Buffer 연결 해제')&&e.actor?.email==='admin@test.invalid'));passed++;

// 직원 권한 범위: 작성·수정 요청·후보 제안은 허용, 삭제·브랜드 지식·최종 승인·사실 확정/거절은 관리자 전용.
const action=await rt.load('app/api/action/route.ts'),workspaceRoute=await rt.load('app/api/workspace/route.ts');
// 'admin'은 가장 먼저 만든 관리자라 소유자(owner)로 계산된다. 소유자가 아닌 관리자 권한은 나중에 만든 'second'로 확인한다.
const owner='a'.repeat(64),admin='d'.repeat(64),member='b'.repeat(64);
rt.sql.prepare('INSERT INTO auth_users(id,email,workspace_owner,role,status,created_at) VALUES(?,?,?,?,?,?)').run('second','second@test.invalid','workspace','admin','active',Date.now()+1000);
rt.sql.prepare('INSERT INTO auth_sessions VALUES(?,?,?,?)').run(createHash('sha256').update(admin).digest('hex'),'second',Date.now()+60000,Date.now());
assert.equal((await server.actor(new Request('https://app.test/api/test',{headers:{cookie:'__Host-collective_session='+admin}}))).role,'admin');passed++;
const call=(mod,token,data)=>mod.POST(new Request('https://app.test/api/test',{method:'POST',headers:{cookie:'__Host-collective_session='+token,origin:'https://app.test','content-type':'application/json'},body:JSON.stringify(data)}));
const read=async(response)=>({status:response.status,...await response.json()});
const eventText=()=>rt.sql.prepare("SELECT data FROM records WHERE owner='workspace' AND kind='event'").all().map(r=>r.data).join('\n');
await server.recordStatement('workspace','campaign','d',{id:'d',brandId:'oda',version:1}).run();
await server.recordStatement('workspace','campaign','r',{id:'r',brandId:'oda',version:1,status:'review'}).run();
await server.recordStatement('workspace','artifact','art',{id:'art',campaignId:'r',campaignVersion:1,role:'quality',title:'검수 결과',content:'검수',version:1,status:'review'},'r').run();
assert.equal((await call(action,member,{action:'delete_campaign',id:'d',version:1,confirmed:true})).status,403);passed++;
assert.equal((await server.readRecord('workspace','campaign','d')).id,'d');passed++;
assert.equal((await read(await call(action,admin,{action:'delete_campaign',id:'d',version:1,confirmed:true}))).deleted,true);passed++;
assert.deepEqual({...(await server.readRecord('workspace','deleted_campaign','d')).deletedBy},{id:'second',email:'second@test.invalid'});passed++;
assert.equal((await call(action,member,{action:'review_artifact',id:'art',version:1,decision:'approved'})).status,403);passed++;
assert.equal((await server.readRecord('workspace','artifact','art')).status,'review');passed++;
assert.equal((await call(action,member,{action:'review_artifact',id:'art',version:1,decision:'revision',note:'가격 표기를 확인해 주세요.'})).status,200);passed++;
assert.ok(eventText().includes('member@test.invalid'));passed++;
assert.equal((await call(action,admin,{action:'review_artifact',id:'art',version:1,decision:'approved'})).status,200);passed++;
assert.equal((await server.readRecord('workspace','artifact','art')).status,'approved');passed++;
assert.equal((await call(action,member,{action:'save_campaign',data:{brandId:'oda',title:'직원 작성 캠페인',goal:'평일 방문을 늘립니다.',budget:0}})).status,200);passed++;
assert.equal((await call(action,member,{action:'save_brand',id:'oda',data:{description:'직원 수정'}})).status,403);passed++;
assert.notEqual((await server.readRecord('workspace','brand','oda')).description,'직원 수정');passed++;
assert.equal((await call(action,admin,{action:'save_brand',id:'oda',data:{description:'관리자 수정'}})).status,200);passed++;
assert.ok(eventText().includes('second@test.invalid'));passed++;
const now=Date.now(),fact={brandId:'oda',key:'oven',value:'화덕',status:'candidate',source:'',verifiedAt:'',validUntil:''};
const decided={...fact,status:'confirmed',source:'점주 확인',verifiedAt:new Date(now-60000).toISOString(),validUntil:new Date(now+86400000).toISOString()};
const candidate=await read(await call(factRoute,member,{action:'save_fact',data:fact}));assert.equal(candidate.status,200);passed++;
assert.equal((await call(factRoute,member,{action:'save_fact',id:candidate.id,version:1,confirmed:true,data:decided})).status,403);passed++;
assert.equal((await call(factRoute,member,{action:'save_fact',id:candidate.id,version:1,data:{...fact,status:'rejected'}})).status,403);passed++;
const confirmed=await read(await call(factRoute,admin,{action:'save_fact',id:candidate.id,version:1,confirmed:true,data:decided}));assert.equal(confirmed.status,200);passed++;
assert.deepEqual(confirmed.fact.confirmedBy,{id:'second',email:'second@test.invalid'});assert.ok(Date.parse(confirmed.fact.confirmedAt)>=now);passed++;
assert.equal((await call(factRoute,member,{action:'save_fact',id:candidate.id,version:2,data:fact})).status,403);passed++;
const rejected=await read(await call(factRoute,admin,{action:'save_fact',id:candidate.id,version:2,data:{...fact,status:'rejected'}}));assert.equal(rejected.status,200);assert.equal(rejected.fact.confirmedBy.id,'second');passed++;
await rt.sql.prepare('INSERT INTO settings(owner,secret,model,updated_at) VALUES(?,?,?,?)').run('workspace',await server.encrypt(JSON.stringify({provider:'hermes',endpoint:'https://hermes.example',key:'test-only-key'})),'HERMES',new Date().toISOString());
const snapshot=async token=>(await workspaceRoute.GET(new Request('https://app.test/api/workspace',{headers:{cookie:'__Host-collective_session='+token}}))).json();
const memberView=await snapshot(member),adminView=await snapshot(admin),ownerView=await snapshot(owner);
assert.equal(memberView.connection.configured,true);assert.equal('endpoint' in memberView.connection,false);assert.equal(memberView.connection.canConfigure,false);passed++;
assert.equal(adminView.connection.endpoint,'https://hermes.example');assert.equal(ownerView.connection.endpoint,'https://hermes.example');passed++;
// 아카이브도 같은 기준: 직원은 자료 추가·후보 검토까지, 자료 확정·제외·진단 채택·의뢰 정보 수정은 관리자 전용이다(AI 제작 맥락에 '확인된 근거'로 들어가기 때문).
const archive=await rt.load('app/api/archive/route.ts');
const sourceId=(await read(await call(archive,member,{action:'add_source',brandId:'oda',data:{title:'직원이 올린 자료',content:'화덕 조리라고 들었다',url:'https://brand.example.com/menu'}}))).id;assert.ok(sourceId);passed++;
for(const status of ['confirmed','excluded']){assert.equal((await call(archive,member,{action:'review_source',brandId:'oda',id:sourceId,version:1,status})).status,403,status);passed++}
assert.equal((await server.readRecord('workspace','brand_source',sourceId)).status,'candidate');passed++;
assert.equal((await call(archive,member,{action:'review_source',brandId:'oda',id:sourceId,version:1,status:'candidate'})).status,200);passed++;
assert.equal((await call(archive,admin,{action:'review_source',brandId:'oda',id:sourceId,version:2,status:'confirmed'})).status,200);passed++;
assert.equal((await call(archive,member,{action:'confirm_diagnosis',brandId:'oda',id:'missing'})).status,403);passed++;
assert.equal((await call(archive,member,{action:'save_intake',brandId:'oda',data:{clientNeed:'직원 수정'}})).status,403);passed++;
assert.equal((await call(archive,admin,{action:'save_intake',brandId:'oda',data:{clientNeed:'관리자 수정'}})).status,200);passed++;
console.log(JSON.stringify({passed,evidence:'real SQLite and cookie session lookup; fixture users/sessions; no provider calls'}));
