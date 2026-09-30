import assert from 'node:assert/strict';
import {testRuntime} from './helpers/runtime.mjs';
const {load}=testRuntime(async()=>{throw Error('Order intake must not publish')});
const server=await load('lib/server.ts'),api=await load('app/api/store-operations/route.ts'),stop=await load('lib/growth-stop-server.ts'),logic=await load('lib/store-operations.ts');
let passed=0;const check=(v,n)=>{assert.ok(v,n);passed++};const owner='stopped-orders',headers={'content-type':'application/json','oai-authenticated-user-id':owner,origin:'https://agency.test'};
await server.recordStatement(owner,'store','s',{id:'s',brandId:'b',status:'active',version:1}).run();
await server.recordStatement(owner,'growth_stop','global',{id:'global',version:1,status:'stopped',reason:'새 집행 중단',updatedAt:new Date().toISOString(),updatedBy:owner}).run();
const data={source:'pos',orderNumber:'STOP-001',orderDate:logic.koreaToday(),mode:'pickup',status:'paid',paidAmount:10000,refundAmount:0,channel:'unknown',costs:{foodCost:2000,packagingCost:0,fees:100,deliveryCost:0,benefitCost:0}};
async function post(patch={}){const r=await api.POST(new Request('https://agency.test/api/store-operations',{method:'POST',headers,body:JSON.stringify({action:'save_order',storeId:'s',data,...patch})}));return {status:r.status,body:await r.json()}}
let r=await post();check(r.status===200,'paid order intake succeeds during global stop '+JSON.stringify(r));const id=r.body.ids[0];check((await server.readRecord(owner,'store_order',id)).paidAmount===10000,'order persisted');
r=await post({id,version:1,data:{...data,refundAmount:2000}});check(r.status===200,'partial refund update allowed');check((await server.readRecord(owner,'store_order',id)).refundAmount===2000,'partial refund persisted');
r=await post({id,version:2,data:{...data,status:'refunded',refundAmount:10000}});check(r.status===200,'full refund update allowed');check((await server.readRecord(owner,'store_order',id)).status==='refunded','full refund persisted');
check((await stop.readGrowthStop(owner)).status==='stopped','intake never resumes execution');await assert.rejects(()=>stop.requireGrowthRunning(owner));passed++;
console.log(JSON.stringify({passed,storage:'real memory SQLite',auth:'mocked',external:0}));
