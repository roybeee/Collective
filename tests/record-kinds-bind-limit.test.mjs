import assert from 'node:assert/strict';
import {testRuntime} from './helpers/runtime.mjs';
const {load,sql}=testRuntime(async()=>{throw Error('external calls forbidden')});
const registry=await load('lib/record-kinds.ts');
const owner='owner',campaign='campaign';let passed=0;
const check=(condition,label)=>{assert.ok(condition,label);passed++;};
const bounded=q=>{check(q.binds.length<=100,`D1 parameter limit exceeded: ${q.binds.length}`);return sql.prepare(q.sql);};
const counts={};
for(const policy of ['delete','retain','retire_and_mark','not_campaign_scoped']){
 const scopes=registry.campaignScopes(policy,owner,campaign),q=registry.scopesSql('SELECT COUNT(*) AS n',owner,scopes);
 counts[policy]=q.binds.length;check(bounded(q).get(...q.binds).n===0,policy+' empty count executes within D1 limit');
 for(const scope of scopes){const remove=registry.scopesSql('DELETE',owner,[scope]);bounded(remove).run(...remove.binds);}
}
const insert=(o,id,kind,parent,data={})=>sql.prepare('INSERT INTO records(id,owner,kind,parent_id,data,updated_at) VALUES(?,?,?,?,?,?)').run(`${o}:${kind}:${id}`,o,kind,parent,JSON.stringify(data),new Date().toISOString());
const manyKinds=Array.from({length:500},(_,i)=>`synthetic_kind_${i}`),special="kind'); DELETE FROM records; --";
const scopes=[{link:'parent',kinds:[...manyKinds,special,manyKinds[0]],where:'parent_id=?',binds:[campaign]},{link:'data_campaign',kinds:[manyKinds[0]],where:"json_extract(data,'$.campaignId')=?",binds:[campaign]}];
insert(owner,'both',manyKinds[0],campaign,{campaignId:campaign});
insert(owner,'last',manyKinds.at(-1),campaign);
insert(owner,'quoted',special,campaign);
insert(owner,'other-campaign',manyKinds[0],'different');
insert('other-owner','both',manyKinds[0],campaign,{campaignId:campaign});
insert(owner,'outside-kind','unselected',campaign);
const count=registry.scopesSql('SELECT COUNT(*) AS n',owner,scopes);
check(bounded(count).get(...count.binds).n===3,'overlapping links and repeated kinds count each selected row once');
check(!count.sql.includes(special),'kind content remains a bound value, never SQL syntax');
const empty=registry.scopesSql('SELECT COUNT(*) AS n',owner,[{link:'parent',kinds:[],where:'parent_id=?',binds:[campaign]}]);
check(bounded(empty).get(...empty.binds).n===0,'empty kind set does not broaden scope');
const remove=registry.scopesSql('DELETE',owner,scopes);check(bounded(remove).run(...remove.binds).changes===3,'delete uses exactly the preview row set');
check(sql.prepare('SELECT count(*) n FROM records WHERE owner=?').get('other-owner').n===1,'other owner survives deletion');
check(sql.prepare('SELECT count(*) n FROM records WHERE owner=?').get(owner).n===2,'other campaign and unselected kind survive deletion');
console.log(JSON.stringify({passed,counts,sqlite:'real',d1Limit:'explicit 100-bind assertion',external:'not_called'}));
