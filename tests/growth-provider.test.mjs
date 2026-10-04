// Real WebCrypto / schema, mocked HTTP. No real MAPDAL writes.
import assert from 'node:assert/strict';
import {createHmac, createHash, randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {testRuntime} from './helpers/runtime.mjs';
let calls=[], responder=()=>new Response('{}');
const {load}=testRuntime(async(url,options)=>{calls.push({url,options});return responder(url,options)});
const provider=await load('lib/growth-provider.ts');
let passed=0;const check=(v,n)=>{assert.ok(v,n);passed++};
const config={baseUrl:'https://mapdal.kr',tenantId:'tenant',storeId:'store',secret:'synthetic-test-secret-with-32-bytes'};
const client=provider.createGrowthProviderClient(config);
const fields={description:'원본'},digest=createHash('sha256').update(JSON.stringify({fields,version:1})).digest('hex');
responder=()=>Response.json({productId:'product',fields,version:1,digest});
const product=await client.read('product');check(product.digest===digest,'Korean canonical digest validated');
const call=calls.at(-1),h=call.options.headers;
const signed=[h['x-collective-timestamp'],h['x-collective-nonce'],'POST',new URL(call.url).pathname,call.options.body].join('\n');
check(h['x-collective-signature']===createHmac('sha256',config.secret).update(signed).digest('hex'),'raw UTF8 signature contract');
check(call.options.redirect==='error'&&call.options.signal instanceof AbortSignal,'redirect and timeout controls');
const py=spawnSync('python3',['-c',"import sys;sys.path.insert(0,'scripts/mapdal');import bridge;print(bridge.digest({'version':1,'fields':{'description':'원본'}}))"],{encoding:'utf8'});
check(py.status===0&&py.stdout.trim()===digest,'cross language Korean digest fixture');
for(const url of ['http://mapdal.kr','https://127.0.0.1','https://mapdal.kr.evil.test','https://mapdal.kr@evil.test','https://mapdal.kr:8443','https://mapdal.kr/foo','https://mapdal.kr/?x=1']){
 assert.throws(()=>provider.createGrowthProviderClient({...config,baseUrl:url}));passed++;
}
const input={requestId:randomUUID(),productId:'product',expectedDigest:digest,approvalDigest:'a'.repeat(64),fields:{description:'승인된 설명'}};
const receipt={requestId:input.requestId,productId:'product',beforeDigest:digest,afterDigest:'b'.repeat(64),approvalDigest:input.approvalDigest,operation:'apply',at:'2026-10-04T00:00:00Z',status:'applied'};
responder=()=>Response.json(receipt);check((await client.apply(input)).requestId===input.requestId,'valid apply receipt');
const applyCall=calls.at(-1);
const integrated=spawnSync('python3',['-c',`
import json,sys,tempfile
sys.path.insert(0,'scripts/mapdal')
from bridge import SQLiteLandingStore,LandingBridge
request=json.load(sys.stdin)
with tempfile.TemporaryDirectory() as root:
 store=SQLiteLandingStore(root+'/bridge.db')
 store.seed('tenant','store','product',{'description':'원본'})
 app=LandingBridge(store,'synthetic-test-secret-with-32-bytes','tenant','store',{'landing:read','landing:write'})
 print(json.dumps(app.handle('POST','/collective/v1/landing/apply',request['headers'],request['body'].encode(),now=int(request['headers']['x-collective-timestamp'])),ensure_ascii=False))
 store.close()
`],{input:JSON.stringify({headers:applyCall.options.headers,body:applyCall.options.body}),encoding:'utf8'});
const cross=integrated.status===0?JSON.parse(integrated.stdout):null;
check(cross?.[0]===200&&cross[1].requestId===input.requestId,'actual TS signed Korean mutation accepted by Python bridge');
responder=()=>{throw new Error('secret provider transport')};
await assert.rejects(()=>client.apply(input),e=>e.outcome==='unknown'&&!e.message.includes('secret'));passed++;
check(calls.filter(c=>c.url.endsWith('/apply')).length===2,'timeout mutation not automatically retried');
responder=()=>Response.json(null);check(await client.receipt(input.requestId)===null,'missing receipt remains unknown');
responder=()=>Response.json(receipt);check((await client.receipt(input.requestId)).requestId===input.requestId,'post timeout reconciliation');
for(const status of [408,429,500,503]){responder=()=>Response.json({status:'rejected',code:'invalid_request'},{status});await assert.rejects(()=>client.apply(input),e=>e.outcome==='unknown');passed++;}
responder=()=>Response.json({status:'rejected',code:'stale_product'},{status:409});
await assert.rejects(()=>client.apply(input),e=>e.outcome==='rejected'&&e.code==='stale_product');passed++;
responder=()=>new Response('proxy error',{status:403});await assert.rejects(()=>client.apply(input),e=>e.outcome==='unknown');passed++;
responder=()=>Response.json({...receipt,approvalDigest:'c'.repeat(64)});await assert.rejects(()=>client.apply(input),e=>e.outcome==='unknown');passed++;
responder=()=>Response.json({...receipt,privateCustomer:'x'});await assert.rejects(()=>client.receipt(input.requestId),e=>e.outcome==='unavailable');passed++;
responder=()=>new Response('x'.repeat(32769));await assert.rejects(()=>client.apply(input),e=>e.outcome==='unknown');passed++;
responder=()=>Response.json({...product,digest:'f'.repeat(64)});await assert.rejects(()=>client.read('product'),e=>e.outcome==='unavailable');passed++;
const count=calls.length;
await assert.rejects(()=>client.apply({...input,fields:{description:'<script>bad</script>'}}));passed++;
check(calls.length===count,'invalid markup never sent');
const rollback={requestId:randomUUID(),originalRequestId:input.requestId,expectedDigest:receipt.afterDigest,approvalDigest:'c'.repeat(64)};
responder=()=>Response.json({...receipt,requestId:rollback.requestId,operation:'rollback',originalRequestId:input.requestId,beforeDigest:receipt.afterDigest,approvalDigest:rollback.approvalDigest});
check((await client.rollback(rollback)).operation==='rollback','rollback receipt checks approval and before digest');
const bridgeTests=spawnSync('python3',['tests/mapdal_bridge_test.py'],{encoding:'utf8'});
check(bridgeTests.status===0,'Python reference bridge suite: '+bridgeTests.stderr);
responder=()=>Response.json({productId:'mpd::123',fields,version:1,digest});
check((await client.read('mpd::123')).productId==='mpd::123','native MAPDAL colon product id accepted');
assert.throws(()=>provider.createGrowthProviderClient({...config,tenantId:'tenant:other'}));passed++;
for(const path of ['/p/mpd::123','/p/mpd%3A%3A123'])check(provider.growthProviderProductUrlMatches('https://mapdal.kr'+path,'https://mapdal.kr','mpd::123'),'same canonical product identity '+path);
for(const path of ['/p/mpd%253A%253A123','/p/mpd%2F123','/p/mpd::124','/p/mpd::123?other=1'])check(!provider.growthProviderProductUrlMatches('https://mapdal.kr'+path,'https://mapdal.kr','mpd::123'),'different or ambiguous product identity denied '+path);
check(!provider.growthProviderProductUrlMatches('https://evil.test/p/mpd::123','https://mapdal.kr','mpd::123'),'public product URL cannot cross provider origin');
console.log(JSON.stringify({passed}));
