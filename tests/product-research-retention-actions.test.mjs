import assert from 'node:assert/strict';
import {testRuntime} from './helpers/runtime.mjs';
let inject=null;const {load,sql}=testRuntime(async()=>{throw Error('external forbidden')},{beforeRun:s=>inject?.(s)});
const mod=await load('lib/product-research/server-retention-actions.ts');
const who={owner:'A',id:'A',email:null,role:'owner'},now=new Date();let passed=0;
const check=(v,m)=>{assert.ok(v,m);passed++};
const put=(owner,kind,id,data)=>sql.prepare('INSERT OR REPLACE INTO records VALUES(?,?,?,?,?,?)').run(`${owner}:${kind}:${id}`,owner,kind,'',JSON.stringify(data),now.toISOString());
const snap=(id,days=31)=>({id,sourceId:'youtube_data',fetchedAt:new Date(now.getTime()-days*86400000).toISOString(),observations:[]});
put('A','pr_snapshot','old',snap('old'));put('B','pr_snapshot','other',snap('other'));
let v=await mod.retentionView('A');check(!v.settings.automaticEnabled,'default OFF');
check((await mod.runRetentionQueue('A')).status==='idle','off worker no mutation');
let plan=await mod.retentionAction(who,{action:'preview'});check(plan.status==='ready'&&plan.total===1,'isolated old snapshot ready flags off');
const applied=await mod.retentionAction(who,{action:'apply',planId:plan.id,digest:plan.digest,confirmed:true});check(applied.deleted===1,'atomic deletion');
check(sql.prepare("SELECT COUNT(*) n FROM records WHERE owner='B'").get().n===1,'other owner untouched');
const retry=await mod.retentionAction(who,{action:'apply',planId:plan.id,digest:plan.digest,confirmed:true});check(retry.id===applied.id,'retry returns receipt');
put('A','pr_snapshot','new',snap('new'));await mod.retentionAction(who,{action:'apply',planId:plan.id,digest:plan.digest,confirmed:true});check(sql.prepare("SELECT id FROM records WHERE id='A:pr_snapshot:new'").get(),'retry never deletes later record');
plan=await mod.retentionAction(who,{action:'preview'});put('A','pr_snapshot','new',snap('new',32));await assert.rejects(()=>mod.retentionAction(who,{action:'apply',planId:plan.id,digest:plan.digest,confirmed:true}),/변경/);passed++;
put('held','pr_snapshot','old',snap('old'));put('held','growth_signal','g',{snapshotIds:['old']});const held=await mod.retentionAction({...who,owner:'held'},{action:'preview'});check(held.status==='held','business lineage held');
put('invalid','pr_snapshot','bad',{...snap('bad'),fetchedAt:'bad'});check((await mod.retentionAction({...who,owner:'invalid'},{action:'preview'})).status==='held','invalid time held');
put('missing','pr_brief','b',{citations:['missing']});check((await mod.retentionAction({...who,owner:'missing'},{action:'preview'})).status==='held','missing refs held');
await assert.rejects(()=>mod.retentionAction({...who,role:'admin'},{action:'preview'}));passed++;
await assert.rejects(()=>mod.retentionAction(who,{action:'configure',automaticEnabled:true}));passed++;
const action=(owner,input)=>mod.retentionAction({...who,owner},input);
const count=(owner,kind)=>sql.prepare('SELECT COUNT(*) n FROM records WHERE owner=? AND kind=?').get(owner,kind).n;
for(const [owner,extra] of [['request',{kind:'pr_request',data:{action:'import_file',resultId:'old'}}],['risk',{kind:'pr_score',data:{riskEvidence:['old'],productId:'absent'}}],['outside',{kind:'growth_mission',data:{input:{snapshotId:'old'}}}]]){
 put(owner,'pr_snapshot','old',snap('old'));put(owner,extra.kind,'dependent',extra.data);
 const p=await action(owner,{action:'preview'});check(p.status==='held',`unsupported consumer held ${owner}`);
 await assert.rejects(()=>action(owner,{action:'apply',planId:p.id,digest:p.digest,confirmed:true}));passed++;
 check(count(owner,'pr_snapshot')===1,`held never deletes ${owner}`);
}
put('future','pr_snapshot','future',snap('future',-1));check((await action('future',{action:'preview'})).status==='held','future timestamp held');
put('derived','pr_snapshot','old',snap('old'));put('derived','pr_score','card',{id:'card',riskEvidence:['old']});
let dp=await action('derived',{action:'preview'});check(dp.total===2&&dp.status==='ready','risk-only derived identified');
const dr=await action('derived',{action:'apply',planId:dp.id,digest:dp.digest,confirmed:true});check(dr.deleted===2&&count('derived','pr_score')===0,'original and known derived removed atomically');
for(const mode of ['phantom','updated','lock','research-lock','rollback']){
 const owner=`race-${mode}`;put(owner,'pr_snapshot','old',snap('old'));const p=await action(owner,{action:'preview'});let fired=false;
 inject=s=>{if(fired)return;if(mode==='rollback'&&s.query.startsWith('DELETE FROM records')){fired=true;throw Error('synthetic write failure')}
  if(!s.query.startsWith('INSERT INTO records(id,owner,kind,parent_id,data,updated_at) VALUES(?,?,?,\'\',CASE'))return;
  if(mode==='phantom'){fired=true;put(owner,'unrelated','new',{note:'new consumer'})}
  if(mode==='updated'){fired=true;put(owner,'pr_snapshot','old',{...snap('old'),newField:'same timestamp new bytes'})}
  if(mode==='lock'){fired=true;sql.prepare('UPDATE mutation_locks SET expires_at=0 WHERE owner=?').run(owner)}
  if(mode==='research-lock'){fired=true;sql.prepare('UPDATE mutation_locks SET token=? WHERE owner=?').run('replacement',owner+':product-research')}
 };
 try{await assert.rejects(()=>action(owner,{action:'apply',planId:p.id,digest:p.digest,confirmed:true}),/변경/);passed++}finally{inject=null}
 check(fired&&count(owner,'pr_snapshot')===1&&count(owner,'pr_retention_receipt')===0,`atomic guard/rollback ${mode}`);
}
put('auto','pr_snapshot','old',snap('old'));await action('auto',{action:'configure',automaticEnabled:true,confirmed:true});
check((await mod.retentionView('auto')).inventory.automaticDeletion===true,'inventory reports actual authorized automatic setting');
check((await mod.runRetentionQueue('auto')).status==='processed'&&count('auto','pr_snapshot')===0,'explicit opt-in works with collection flags OFF');
put('auto','pr_snapshot','later',snap('later'));check((await mod.runRetentionQueue('auto')).status==='idle'&&count('auto','pr_snapshot')===1,'one automatic attempt per UTC day');
const ev=await action('auto',{action:'record_external_evidence',reference:'ticket-123',note:'운영자 제출 기록',confirmed:true});check(ev.verification==='operator_attested','evidence never provider verified');
const expiredOwner='expired-plan';put(expiredOwner,'pr_snapshot','old',snap('old'));const ep=await action(expiredOwner,{action:'preview'});sql.prepare("UPDATE records SET data=json_set(data,'$.expiresAt','2000-01-01T00:00:00Z') WHERE owner=? AND kind='pr_retention_plan'").run(expiredOwner);
await assert.rejects(()=>action(expiredOwner,{action:'apply',planId:ep.id,digest:ep.digest,confirmed:true}),/만료/);passed++;
const route=await load('app/api/product-research/retention/route.ts');
const get=await route.GET(new Request('https://agency.test/api/product-research/retention',{headers:{'oai-authenticated-user-id':'A'}}));check(get.status===200,'owner view flags OFF');
check((await route.GET(new Request('https://agency.test/api/product-research/retention'))).status===401,'anonymous denied');
check((await route.POST(new Request('https://agency.test/api/product-research/retention',{method:'POST',headers:{'oai-authenticated-user-id':'A',origin:'https://evil.test'},body:JSON.stringify({action:'preview'})}))).status===403,'cross origin denied');
const posted=await route.POST(new Request('https://agency.test/api/product-research/retention',{method:'POST',headers:{'oai-authenticated-user-id':'A',origin:'https://agency.test'},body:JSON.stringify({action:'preview'})}));const postedBody=await posted.json();check(posted.status===200&&postedBody.inventory&&postedBody.latestPlan&&postedBody.settings,'POST returns complete UI view');
put('large','pr_snapshot','old',snap('old'));put('large','unrelated','bulk',{text:'가'.repeat(250000)});check((await action('large',{action:'preview'})).status==='held','UTF8 total scope budget is fail closed');
for(let i=0;i<2001;i++)put('many','unrelated',String(i),{});check((await action('many',{action:'preview'})).status==='held','scope row budget fails closed');
put('external','pr_snapshot','old',snap('old'));put('external','hermes_submission','prmd-job',{body:JSON.stringify({input:JSON.stringify({snapshotIds:['old']})})});
const external=await action('external',{action:'preview'});check(external.status==='held'&&external.externalDeletion==='unverified','external copies held without deletion claims');
await action('external',{action:'record_external_evidence',reference:'operator-ref',note:'operator statement',confirmed:true});check((await action('external',{action:'preview'})).status==='held','operator evidence never bypasses unresolved external copies');
put('legacyauto','pr_retention_settings','current',{automaticEnabled:true});check(await mod.automaticRetentionEnabled('legacyauto')===false&&(await mod.runRetentionQueue('legacyauto')).status==='idle','legacy auto flag without explicit versioned confirmation closed');
const safeText=JSON.stringify(await mod.retentionView('large'));check(!safeText.includes('가가가')&&!safeText.includes('targetIds')&&!safeText.includes('scopeDigest'),'preview and audit do not expose raw records or internal manifests');
put('ambiguous','pr_snapshot','one',snap('same'));put('ambiguous','pr_snapshot','two',snap('same'));put('ambiguous','pr_score','card',{riskEvidence:['same']});check((await action('ambiguous',{action:'preview'})).status==='held','ambiguous original aliases are not safe deletion evidence');
console.log(JSON.stringify({passed,sqlite:'real',auth:'mocked',providerCalls:0}));
