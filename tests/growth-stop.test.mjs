import assert from 'node:assert/strict';
import {testRuntime} from './helpers/runtime.mjs';
const {load}=testRuntime(async()=>{throw Error('No external calls')});const d=await load('lib/growth-stop.ts');let passed=0;const check=(v,n)=>{assert.ok(v,n);passed++};
check(d.emptyGrowthStop().status==='running'&&d.emptyGrowthStop().version===0,'default unsaved state');
check(d.parseGrowthStopInput({action:'stop',reason:'한도 검토',expectedVersion:0,requestId:'11111111-1111-4111-8111-111111111111'}).action==='stop','stop input');
for(const patch of [{action:'pause'},{reason:''},{reason:'person@example.com'},{reason:'api_key=synthetic-secret'},{expectedVersion:-1},{expectedVersion:1.5},{requestId:'not-uuid'}]){assert.throws(()=>d.parseGrowthStopInput({action:'stop',reason:'한도 검토',expectedVersion:0,requestId:'11111111-1111-4111-8111-111111111111',...patch}));passed++}
for(const v of [null,{}, {id:'global',status:'running',version:-1},{id:'else',status:'stopped',version:1}]){assert.throws(()=>d.validateGrowthStop(v));passed++}
console.log(JSON.stringify({passed,external:'not_called'}));
