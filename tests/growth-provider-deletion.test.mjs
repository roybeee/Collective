import assert from 'node:assert/strict';
import {testRuntime} from './helpers/runtime.mjs';
const {load}=testRuntime(async()=>{throw Error('external forbidden')});
const server=await load('lib/server.ts');let passed=0;const check=(v,n)=>{assert.ok(v,n);passed++};
const owner='provider-owner',c={id:'c',brandId:'b',version:1,status:'active',title:'판매처 결과 확인'};
const put=(kind,id,data,parent='')=>server.recordStatement(owner,kind,id,data,parent).run();
await put('campaign','c',c);
await put('growth_landing_revision','landing',{id:'landing',campaignId:'c',brandId:'b',provider:{attempt:{status:'unknown'}}},'c');
check(!(await server.campaignDeletionPreview(owner,'c')).deletable,'unknown external landing result blocks campaign deletion');
await assert.rejects(()=>server.deleteCampaign(owner,{id:'c',version:1,confirmed:true}),e=>e.status===409);passed++;
await put('growth_landing_revision','landing',{id:'landing',campaignId:'c',brandId:'b',provider:{attempt:{status:'verified'}}},'c');
check((await server.campaignDeletionPreview(owner,'c')).deletable,'resolved landing result no longer blocks campaign');
await put('campaign','other',{...c,id:'other'});
await put('growth_consumer_delivery','delivery',{id:'delivery',campaignId:'other',brandId:'b'},'other');
check((await server.campaignDeletionPreview(owner,'c')).deletable,'other campaign delivery does not block');
check(!(await server.campaignDeletionPreview(owner,'other')).deletable,'delivery current blocks deleting its campaign');
await put('campaign','history',{...c,id:'history'});
await put('growth_consumer_delivery_history','history-row',{id:'history-row',campaignId:'history',brandId:'b'},'history');
check(!(await server.campaignDeletionPreview(owner,'history')).deletable,'delivery history also protects audit after current changes');
for(const kind of ['growth_cs_source','growth_cs_source_history']){
 const id=kind+'-campaign';await put('campaign',id,{...c,id});
 await put(kind,'inquiry-'+kind,{id:'inquiry',campaignId:id,brandId:'b'},id);
 check(!(await server.campaignDeletionPreview(owner,id)).deletable,'service inquiry evidence protects its campaign');
 await assert.rejects(()=>server.deleteCampaign(owner,{id,version:1,confirmed:true}),e=>e.status===409);passed++;
}
console.log(JSON.stringify({passed}));
