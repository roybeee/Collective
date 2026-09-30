import assert from 'node:assert/strict';
import {testRuntime} from './helpers/runtime.mjs';
const {load,sql}=testRuntime(async()=>{throw Error('No external calls')});
const server=await load('lib/server.ts'),learning=await load('app/api/learning/route.ts'),prompts=await load('app/api/prompts/route.ts'),meta=await load('lib/meta-experiment-server.ts'),stores=await load('app/api/stores/route.ts');
const owner='stop-learning-owner';let passed=0;
const check=(value,label)=>{assert.ok(value,label);passed++;};
const post=async(route,action,who=owner)=>{const r=await route.POST(new Request('https://agency.test/api/test',{method:'POST',headers:{'content-type':'application/json','oai-authenticated-user-id':who},body:JSON.stringify({action})}));return {status:r.status,body:await r.json()};};
await server.recordStatement(owner,'growth_stop','global',{id:'global',version:1,status:'stopped',reason:'신규 실행 검토',updatedAt:new Date().toISOString(),updatedBy:owner}).run();
for(const action of ['adopt_rule','renew_rule','playbook_activate','playbook_renew']){
 const r=await post(learning,action);check(r.status===409&&/중단/.test(r.body.error),'learning application blocked: '+action+JSON.stringify(r));
}
for(const action of ['activate','stage','promote','reset_pins']){
 const r=await post(prompts,action);check(r.status===409&&/중단/.test(r.body.error),'prompt application blocked: '+action+JSON.stringify(r));
}
await assert.rejects(()=>meta.mutateMetaExperiment(owner,owner,{id:'c',brandId:'b',status:'active'},{action:'approve_rule',confirmed:true}),e=>e.status===409&&/중단/.test(e.message));passed++;
for(const action of ['pause_rule','retire_rule','save_results'])check((await post(learning,action)).status===400,'recovery reaches its own validation: '+action);
check((await post(prompts,'rollback')).status===400,'rollback remains accessible');
check((await post(learning,'adopt_rule','other-owner')).status===400,'other owner unaffected');
check(sql.prepare("SELECT COUNT(*) n FROM records WHERE owner=? AND kind='learning_rule'").get(owner).n===0,'no active rule created');
const store={id:'s',brandId:'b',status:'active',version:1},experiment={id:'e',storeId:'s',brandId:'b',status:'running',version:1,title:'수요 비교',primaryMetric:'orders',target:5,channel:'daangn',measurement:'주문 장부 비교'};
await server.recordStatement(owner,'store','s',store,'b').run();
await server.recordStatement(owner,'store_experiment','e',experiment,'s').run();
await server.recordStatement(owner,'store_measurement','m',{id:'m',storeId:'s',experimentId:'e',periodStart:'2026-09-01',periodEnd:'2026-09-02',values:{orders:8},source:'합성 주문 자료'},'s').run();
const review={evidenceLevel:'comparison',failureType:'none',nextAction:'다음 비교 준비',confounders:'요일 차이',conditions:'같은 상품'},payload={storeId:'s',experimentId:'e',version:1,decision:'stop',learning:'비용 검토 후 후속 비교',review};
const storePost=async(action)=>{const r=await stores.POST(new Request('https://agency.test/api/stores',{method:'POST',headers:{'content-type':'application/json','oai-authenticated-user-id':owner},body:JSON.stringify({...payload,action})}));return {status:r.status,body:await r.json()};};
let result=await storePost('preview_close');check(result.status===200&&!result.body.promoted&&result.body.reasons.some(s=>s.includes('전역 중단')),'preview holds rule while allowing review');
result=await storePost('close_experiment');check(result.status===200&&!result.body.ruleId,'review saves without active promotion');
check((await server.readRecord(owner,'store_experiment','e')).status==='completed','review persisted during stop');
check(sql.prepare("SELECT COUNT(*) n FROM records WHERE owner=? AND kind='learning_rule'").get(owner).n===0,'store cannot bypass stop');
console.log(JSON.stringify({passed,external:'not_called'}));
