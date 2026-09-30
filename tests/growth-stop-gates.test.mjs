import assert from 'node:assert/strict';
import {testRuntime} from './helpers/runtime.mjs';
const {load}=testRuntime(async()=>{throw Error('Stopped gate must precede provider calls')});
const server=await load('lib/server.ts'),authority=await load('lib/growth-authority-server.ts'),execution=await load('lib/growth-execution-server.ts'),stock=await load('lib/growth-operations-server.ts'),metaBudget=await load('lib/meta-reservation-server.ts'),meta=await load('lib/meta-execution-server.ts'),buffer=await load('lib/execution-server.ts');
let passed=0;const owner='gate-owner',who={owner,id:owner,role:'owner',email:null},c={id:'c',brandId:'b',version:1,status:'active'};
await server.recordStatement(owner,'growth_stop','global',{id:'global',version:1,status:'stopped',reason:'운영 중단',updatedAt:new Date().toISOString(),updatedBy:owner}).run();
for(const [label,call] of [
 ['general budget',()=>authority.prepareMissionCommitment(who,c,{})],['general execution',()=>execution.saveGrowthExecution(who,c,{action:'prepare_execution',campaignVersion:1,input:{}})],['stock reservation',()=>stock.prepareMissionStock(who,c,{action:'reserve_stock'})],['Meta budget',()=>metaBudget.reserveMetaBudget(owner,owner,c,{})],['Meta approval',()=>meta.approveMetaExecution(owner,owner,c,{})],['Meta ACTIVE',()=>meta.transitionMetaExecution(owner,owner,c,{},'ACTIVE')],['Buffer approval',()=>buffer.approvePublication(owner,c,{}, {},who,'https://agency.test')],['Buffer reservation',()=>buffer.reservePublication(owner,c,{},'https://agency.test')]
]){await assert.rejects(call,e=>e.status===409&&e.message.includes('전역 중단'),label);passed++}
for(const [label,call] of [['stock release',()=>stock.prepareMissionStock(who,c,{action:'release_stock'})],['general reconciliation',()=>execution.saveGrowthExecution(who,c,{action:'reconcile_execution',campaignVersion:1})],['Meta PAUSED',()=>meta.transitionMetaExecution(owner,owner,c,{scope:{accountId:'account'}},'PAUSED')],['Buffer cancellation',()=>buffer.cancelPublication(owner,c,{status:'draft',id:'p',version:1})]]){
 try{await call()}catch(e){assert.ok(!e.message.includes('전역 중단'),label)}passed++;
}
console.log(JSON.stringify({passed,external:'not_called'}));
