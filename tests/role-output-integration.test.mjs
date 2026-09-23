import assert from 'node:assert/strict';
import {testRuntime} from './helpers/runtime.mjs';
import {roleFixture} from './helpers/role-fixture.mjs';
let output='',calls=0;
const submissions=new Map();
const {sql,load}=testRuntime(async(url,options={})=>{
 if(url.endsWith('/v1/runs')){const id='role_'+ ++calls;submissions.set(id,JSON.parse(options.body));return Response.json({run_id:id});}
 const id=url.split('/').pop();
 return Response.json({object:'hermes.run',run_id:id,status:'completed',output:output||roleFixture(submissions.get(id).input),usage:{total_tokens:123},model:'provider-model'});
});
const server=await load('lib/server.ts'),execution=await load('lib/role-execution.ts'),sequence=await load('lib/campaign-sequence.ts');
const owner='role-owner',passed=[];
const check=(name,value)=>{assert.ok(value,name);passed.push(name)};
await server.seedBrands(owner);
sql.prepare('INSERT INTO settings(owner,secret,model,updated_at) VALUES(?,?,?,?)').run(owner,await server.encrypt(JSON.stringify({provider:'hermes',endpoint:'https://hermes.example.com',key:'test-only'})),'HERMES','2026-01-01');
const base=await server.readRecord(owner,'campaign','ofd-pilot-01');
const put=(kind,id,data,parent='')=>server.recordStatement(owner,kind,id,data,parent).run();
const start=async(id,role='cmo')=>execution.executeRole(owner,{action:'start',campaignId:id,role});
await put('campaign','invalid',{...base,id:'invalid'});
// Verbatim failed ODA strategy response, reduced only to omit choice descriptions.
output='이번 요청에서 수행할 작업이 명시되지 않았습니다. 다음 중 하나를 지정해 주세요.\n1. 현재 초안을 검수\n2. 전략 브리프 전체 재작성\n번호 하나만 말씀해 주시면 됩니다.';
let response=await start('invalid'),job=await response.json();
check('request persists versioned role contract before provider polling',!!(await server.readRecord(owner,'role_output_contract',job.id)).version);
const body=submissions.values().next().value,input=JSON.parse(body.input);
check('provider input explicitly names action role and all required outputs',input.task.action==='작성'&&input.task.role==='cmo'&&input.task.outputContract.sections.length===3);
response=await execution.executeRole(owner,{action:'poll',id:job.id});
check('question-only result becomes terminal failed',(await response.json()).status==='failed');
check('invalid result never becomes artifact',(await server.listRecords(owner,'artifact','invalid')).length===0);
check('failure explains missing task execution',sql.prepare('SELECT error FROM jobs WHERE id=?').get(job.id).error.includes('작업 선택'));
check('failure preserves tokens',sql.prepare('SELECT tokens FROM jobs WHERE id=?').get(job.id).tokens===123);
check('failure ledger preserves provider completion and invalid domain outcome',(await server.listRecords(owner,'provider_usage')).some(x=>x.domainOutcome==='invalid_output'));
const failure=await server.readRecord(owner,'role_output_failure',job.id);
check('raw invalid output is retained for owner diagnosis',failure.raw===output);
await assert.rejects(()=>server.readRecord('another-owner','role_output_failure',job.id));passed.push('foreign owner cannot access raw output');
const beforeReplay=calls;await execution.executeRole(owner,{action:'poll',id:job.id});check('terminal replay cannot create another provider job',calls===beforeReplay);

output='';await put('campaign','valid',{...base,id:'valid'});
job=await (await start('valid')).json();await execution.executeRole(owner,{action:'poll',id:job.id});
let artifact=(await server.listRecords(owner,'artifact','valid'))[0];
check('incomplete-data structured draft remains usable',artifact.content.includes('자료 필요')&&artifact.outputContractVersion==='role-output-v1');
for(const change of [{status:'revision'},{campaignVersion:99},{content:'자료 확인했습니다. 다만 이번 요청에서 수행할 작업이 명시되지 않았습니다. 다음 중 무엇을 원하시는지 한 가지만 지정해 주세요.'}]){
 await put('artifact',artifact.id,{...artifact,...change},'valid');const before=calls;
 check('direct dependent role rejects bad predecessor '+JSON.stringify(change),(await start('valid','insight')).status===409&&calls===before);
 await put('campaign_sequence','valid',{campaignId:'valid',campaignVersion:base.version,status:'running',startedAt:'2099-01-01',updatedAt:'2026-01-01'},'valid');
 const result=await sequence.sequenceAction(owner,{action:'advance_sequence',campaignId:'valid'});
 check('sequence blocks instead of skipping bad predecessor '+JSON.stringify(change),result.sequence.status==='blocked'&&calls===before);
}
await put('artifact',artifact.id,{...artifact,status:'revision'},'valid');
for(const role of ['insight','strategy','creative','content','growth','data','quality'])await put('artifact','downstream-'+role,{...artifact,id:'downstream-'+role,role,status:'approved'},'valid');
check('repair requires explicit optimistic artifact version',(await execution.executeRole(owner,{action:'start',campaignId:'valid',role:'cmo',repairId:artifact.id,repairVersion:999})).status===409);
job=await (await execution.executeRole(owner,{action:'start',campaignId:'valid',role:'cmo',repairId:artifact.id,repairVersion:artifact.version})).json();
check('revision can be regenerated without reusing completed job id',typeof job.id==='string');
await execution.executeRole(owner,{action:'poll',id:job.id});
check('replacement preserves previous draft as outdated',(await server.readRecord(owner,'artifact',artifact.id)).status==='outdated');
check('replacement leaves only one current role artifact',(await server.listRecords(owner,'artifact','valid')).filter(a=>a.status!=='outdated').length===1);
check('replacement invalidates all seven previously approved descendants',(await server.listRecords(owner,'artifact','valid')).filter(a=>a.id.startsWith('downstream-')&&a.status==='outdated').length===7);
check('replacement preserves prior role versions in history',(await server.listRecords(owner,'history','valid')).length===8);
await put('campaign_sequence','valid',{campaignId:'valid',campaignVersion:base.version,status:'running',startedAt:'2099-01-01',updatedAt:'2026-01-01'},'valid');
check('sequence resumes at insight after CMO repair',(await sequence.sequenceAction(owner,{action:'advance_sequence',campaignId:'valid'})).role==='insight');

// Legacy in-flight requests have no structured contract. Reject the known failure anyway.
await put('campaign','legacy',{...base,id:'legacy'});
sql.prepare('INSERT INTO jobs(id,owner,campaign_id,role,status,provider_id,model,campaign_version,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run('legacy',owner,'legacy','cmo','queued','legacy-provider','HERMES',base.version,'2026-01-01','2026-01-01');
output='이번 요청에서 수행할 작업이 명시되지 않았습니다. 다음 중 하나를 지정해 주세요.';
response=await execution.executeRole(owner,{action:'poll',id:'legacy'});
check('legacy in-flight known nonanswer also fails',(await response.json()).status==='failed');
await put('role_output_failure','cleanup-check',{raw:'private output'},'valid');
await server.deleteCampaign(owner,{id:'valid',version:base.version,confirmed:true});
check('campaign deletion removes new role contracts and failure originals',(await server.listRecords(owner,'role_output_contract','valid')).length===0&&(await server.listRecords(owner,'role_output_failure','valid')).length===0);
console.log(JSON.stringify({passed:passed.length,checks:passed}));
