import assert from 'node:assert/strict';
import {testRuntime} from './helpers/runtime.mjs';
const {load,sql,env}=testRuntime(async()=>{throw new Error('external forbidden')});
const retention=await load('lib/product-research/server-retention.ts');
const now=new Date('2026-10-05T00:00:00Z'),day=86400000;let passed=0;const check=(v,n)=>{assert.ok(v,n);passed++};
const put=(owner,kind,id,value)=>sql.prepare('INSERT INTO records(id,owner,kind,parent_id,data,updated_at) VALUES(?,?,?,?,?,?)').run(`${owner}:${kind}:${id}`,owner,kind,'',JSON.stringify(value),now.toISOString());
const snapshot=(id,age)=>({id,sourceId:'youtube_data',fetchedAt:new Date(now.getTime()-age).toISOString(),observations:[{subject:{title:'PRIVATE_FIXTURE_TITLE'},value:5}]});
put('A','pr_snapshot','expired',snapshot('expired',30*day));put('A','pr_snapshot','fresh',snapshot('fresh',30*day-1));put('A','pr_snapshot','invalid',{id:'invalid',sourceId:'youtube_data',fetchedAt:'bad'});put('A','pr_snapshot','future',snapshot('future',-1));
put('B','pr_snapshot','other',snapshot('other',60*day));put('A','pr_credential','youtube',{secret:'PRIVATE_FIXTURE_SECRET'});
put('A','pr_score','score',{id:'score',evidence:[{snapshotId:'expired'}],total:99});put('A','pr_brief','brief',{id:'brief',scoreCardIds:['score'],summary:'PRIVATE_FIXTURE_SUMMARY'});put('A','pr_score_index','index',{entries:[{id:'score',total:99}]});
put('A','pr_request','req',{result:{briefId:'brief'}});put('A','growth_signal','signal',{provenance:{snapshotIds:['expired']}});put('A','growth_history','history',{snapshot:{signalId:'signal'}});
put('A','hermes_submission','prmd-fixture',{body:JSON.stringify({input:JSON.stringify({observations:[{snapshotId:'expired',title:'PRIVATE_FIXTURE_TITLE'}]})})});
put('A','pr_collect_state','current',{videos:[{id:'abcdefghij1',keyword:'PRIVATE_KEYWORD',addedAt:new Date(now.getTime()-31*day).toISOString()}]});
let result=await retention.researchRetentionInventory('A',now);const row=k=>result.rows.find(r=>r.kind===k);
check(result.complete&&result.scanned===12&&result.automaticDeletion===false,'inventory complete with flags OFF, keys excluded, no deletion '+JSON.stringify(result));
check(row('pr_snapshot').records===4&&row('pr_snapshot').youtubeRecords===4&&row('pr_snapshot').expiredRecords===1&&row('pr_snapshot').invalidTimeRecords===2,'30 day boundary, 1ms before boundary, invalid and future clocks');
for(const kind of ['pr_score','pr_brief','pr_score_index','pr_request','growth_signal','growth_history','hermes_submission','pr_collect_state'])check(row(kind).youtubeRecords===1&&row(kind).expiredRecords===1,`copied lineage/tracking detected ${kind}`);
check(result.externalDeletion==='unverified','external submission never claims deleted');check(!/PRIVATE|abcdefghij1|expired|scoreCardIds/.test(JSON.stringify(result).replaceAll('expiredRecords','')),'only aggregate metadata leaves inventory');
check(sql.prepare("SELECT COUNT(*) n FROM records WHERE owner='A'").get().n===13,'read only: records unchanged');
const empty=await retention.researchRetentionInventory('empty',now);check(empty.complete&&empty.scanned===0&&empty.externalDeletion==='not_applicable','empty owner is complete');
const other=await retention.researchRetentionInventory('B',now);check(other.scanned===1&&other.rows.find(r=>r.kind==='pr_snapshot').records===1,'owner scope enforced');
sql.prepare('INSERT INTO records(id,owner,kind,parent_id,data,updated_at) VALUES(?,?,?,?,?,?)').run('malformed:pr_brief:x','malformed','pr_brief','','{bad',now.toISOString());
check(!(await retention.researchRetentionInventory('malformed',now)).complete,'malformed row cannot be successful inventory');
const insert=sql.prepare('INSERT INTO records(id,owner,kind,parent_id,data,updated_at) VALUES(?,?,?,?,?,?)');for(let i=0;i<10001;i++)insert.run(`large:pr_score:${String(i).padStart(5,'0')}`,'large','pr_score','',JSON.stringify({id:`s${i}`}),now.toISOString());
const large=await retention.researchRetentionInventory('large',now);check(!large.complete&&large.scanned===10000&&large.rows.find(r=>r.kind==='pr_score').records===10000,'bounded paginated scan exposes truncation');
put('dangling','pr_brief','copy',{snapshotIds:['removed-snapshot']});check(!(await retention.researchRetentionInventory('dangling',now)).complete,'removed original cannot be treated as confirmed absent YouTube');
put('oversize','pr_brief','large',{text:'가'.repeat(180000)});const oversized=await retention.researchRetentionInventory('oversize',now);check(!oversized.complete&&oversized.scanned===1,'oversized UTF8 record yields incomplete inventory without raw content');
await assert.rejects(()=>retention.researchRetentionInventory('A',new Date(NaN)));passed++;
const original=env.DB.prepare.bind(env.DB);let pages=0;env.DB.prepare=q=>{if(q.includes('SELECT id,kind')&&++pages===2)throw new Error('synthetic storage failure');return original(q)};
try{check(!(await retention.researchRetentionInventory('large',now)).complete,'partial storage failure is not successful inventory')}finally{env.DB.prepare=original}
for(const [kind,data] of [
 ['pr_score',{subScores:[{evidence:['removed-score-snapshot']}]}],
 ['pr_brief',{claims:[{citations:['removed-brief-snapshot#0']}]}],
 ['pr_brief',{scoreCardIds:['removed-score']}],
 ['pr_brief',{productIds:['removed-product']}],
 ['pr_score_index',{entries:[{id:'removed-score',total:90}]}],
 ['hermes_submission',{body:JSON.stringify({input:JSON.stringify({observations:[{row:'removed-md-snapshot#3'}]})})}]
]){const owner=`shape-${passed}`;put(owner,kind,kind==='hermes_submission'?'prmd-case':'copy',data);const inventory=await retention.researchRetentionInventory(owner,now);check(!inventory.complete&&inventory.externalDeletion==='unverified',`typed missing reference cannot assert absence: ${kind}`)}
for(const kind of ['growth_need','growth_offer','growth_sourcing_candidate','growth_sourcing_history']){
 const owner=`handoff-${kind}`;put(owner,'pr_snapshot','original',snapshot('original',31*day));put(owner,kind,'copy',{productResearch:{snapshotIds:['original']},input:{description:'PRIVATE_COPIED_TITLE'}});const inventory=await retention.researchRetentionInventory(owner,now);const row=inventory.rows.find(r=>r.kind===kind);check(inventory.complete&&row?.youtubeRecords===1&&row.expiredRecords===1,`handoff copy ${kind} is inventoried`);
}
console.log(JSON.stringify({passed,sqlite:'real',externalCalls:0,productionWrites:0}));
