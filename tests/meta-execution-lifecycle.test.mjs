import assert from 'node:assert/strict';
import {testRuntime} from './helpers/runtime.mjs';
const {load}=testRuntime(()=>{throw new Error('external forbidden')});
const {runExecutionTransition}=await load('lib/meta-execution-runner.ts');
let count=0;
async function scenario(failAt=0){let row={state:'approved',pending:null,version:1,scope:{campaignId:'1',adsetId:'2',adId:'3'}},calls=[],statuses={campaign:'PAUSED',adset:'PAUSED',ad:'PAUSED'};const api={async read(){return {...statuses}},async write(id,status){calls.push([id,status]);if(calls.length===failAt)throw new Error('timeout');statuses[id==='1'?'campaign':id==='2'?'adset':'ad']=status}};const journal={async save(p){row={...row,...p,version:row.version+1};return row},async current(){return true}};await runExecutionTransition(row,'ACTIVE',api,journal);return {get row(){return row},calls,statuses,api,journal}}
let x=await scenario();assert.equal(x.row.state,'active');assert.deepEqual(x.calls,[['3','ACTIVE'],['2','ACTIVE'],['1','ACTIVE']]);count++;
x=await scenario(2);assert.equal(x.row.state,'unknown');assert.equal(x.calls.length,2);count++;
await runExecutionTransition(x.row,'PAUSED',x.api,x.journal);assert.equal(x.row.state,'stopped');assert.equal(x.calls.filter(v=>v[1]==='ACTIVE').length,2);count++;
x=await scenario();await assert.rejects(()=>runExecutionTransition(x.row,'ACTIVE',x.api,x.journal));count++;
let writes=[];let stored={state:'approved',version:1,pending:null,scope:{campaignId:'1',adsetId:'2',adId:'3'}};
const journal={async save(p){stored={...stored,...p};return stored},async current(){return false}};
await runExecutionTransition(stored,'ACTIVE',{async read(){return {campaign:'PAUSED',adset:'PAUSED',ad:'PAUSED'}},async write(id,s){writes.push([id,s])}},journal);assert.equal(stored.state,'unknown');assert.equal(writes.length,0);count++;
await runExecutionTransition(stored,'PAUSED',{async read(){throw new Error('deleted child')},async write(id,s){writes.push([id,s])}},journal);assert.equal(writes[0][0],'1');assert.equal(writes.length,3);assert.equal(stored.state,'unknown');count++;
stored={...stored,state:'approved'};writes=[];let failed=false;
await runExecutionTransition(stored,'ACTIVE',{async read(){return {campaign:'ACTIVE',adset:'ACTIVE',ad:'ACTIVE'}},async write(id,s){writes.push([id,s])}},{async current(){return true},async save(p){if(p.state==='active'&&!failed){failed=true;throw new Error('success persistence failure')}stored={...stored,...p};return stored}});assert.equal(stored.state,'unknown');count++;
console.log(JSON.stringify({passed:count}));
