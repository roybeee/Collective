import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {deflateSync} from 'node:zlib';
import {testRuntime} from './helpers/runtime.mjs';

function crc32(bytes){let crc=0xffffffff;for(const byte of bytes){crc^=byte;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0)}return (crc^0xffffffff)>>>0}
function chunk(type,data){const name=Buffer.from(type),size=Buffer.alloc(4),crc=Buffer.alloc(4);size.writeUInt32BE(data.length);crc.writeUInt32BE(crc32(Buffer.concat([name,data])));return Buffer.concat([size,name,data,crc])}
const signature=Buffer.from([137,80,78,71,13,10,26,10]),ihdr=Buffer.alloc(13);
ihdr.writeUInt32BE(1080,0);ihdr.writeUInt32BE(1080,4);ihdr[8]=8;ihdr[9]=2;
function fixture(fill=0){const pixels=Buffer.alloc((1080*3+1)*1080,fill);for(let row=0;row<1080;row++)pixels[row*(1080*3+1)]=0;return Buffer.concat([signature,chunk('IHDR',ihdr),chunk('IDAT',deflateSync(pixels)),chunk('IEND',Buffer.alloc(0))])}
const png=fixture(),dataUrl=bytes=>'data:image/png;base64,'+bytes.toString('base64');
let calls=0,mode='ok',providerStatus='sent';const media=png,inspectChannel='channel-1';
let server,beforeRun=null;
const rt=testRuntime(async(url,init={})=>{
 if(String(url).startsWith('https://res.cloudinary.com/'))return new Response(media,{headers:{'content-type':'image/png'}});
 if(String(url).startsWith('https://app.test/')){return new Response('not found',{status:404})}
 const {query,variables}=JSON.parse(init.body);
 if(query.includes('organizations'))return Response.json({data:{account:{organizations:[{id:'org',name:'ODA 조직'},{id:'org-2',name:'두 번째 조직'}]}}});
 if(query.includes('channels('))return Response.json({data:{channels:variables.organizationId==='org-2'?[{id:'channel-2',name:'ODA 2',service:'instagram',isQueuePaused:false}]:[{id:'channel-1',name:'ODA',service:'instagram',isQueuePaused:false},{id:'fb-1',name:'ODA FB',service:'facebook',isQueuePaused:false}]}});
 if(query.includes('createPost')){
  calls++;
  if(mode==='lost')throw new Error('request result unknown');
  if(mode==='stop-in-flight')await server.recordStatement('owner','growth_stop','global',{id:'global',version:1,status:'stopped',reason:'진행 중 중단',updatedAt:new Date().toISOString(),updatedBy:'owner'}).run();
  return Response.json({data:{createPost:{__typename:'PostActionSuccess',post:{id:'post-'+calls,status:'scheduled'}}}});
 }
 return Response.json({data:{post:{id:variables.id,status:providerStatus,channelId:inspectChannel}}});
},{beforeRun:statement=>beforeRun?.(statement)});
const objects=new Map();rt.env.BUCKET={put:async(k,v)=>objects.set(k,new Uint8Array(v)),get:async k=>objects.has(k)?{arrayBuffer:async()=>objects.get(k).slice().buffer,body:new Response(objects.get(k).slice()).body}:null,head:async k=>objects.has(k)?{size:objects.get(k).length}:null,delete:async k=>objects.delete(k)};
server=await rt.load('lib/server.ts');
const route=await rt.load('app/api/execution/route.ts');
const put=(kind,id,value,parent='')=>server.recordStatement('owner',kind,id,value,parent).run();
const rows=kind=>rt.sql.prepare("SELECT data FROM records WHERE owner='owner' AND kind=?").all(kind).map(r=>JSON.parse(r.data));
const fresh=()=>put('execution_rate','execution',{startedAt:Date.now(),count:0});
await server.seedBrands('owner');
const fact={id:'fact',brandId:'oda',key:'address',value:'휘경동 377 C107',status:'confirmed',source:'owner',verifiedAt:new Date().toISOString(),validUntil:'2099-01-01T00:00:00Z',version:1};
await put('brand_fact','fact',fact,'oda');
// 발행 승인에는 기획 승인과 확정된 캠페인 기간이 필요하다. 모든 예약(2098-01-01 KST)이 기간 안에 들어가게 둔다.
// 비용 상한은 확정 예산 안에서만 정할 수 있으므로(data-truth-4 a) 기본 픽스처는 10만 원 확정 예산을 둔다.
const campaignFixture=(id,extra={})=>({id,brandId:'oda',title:'ODA',version:1,status:'approved',startDate:'2098-01-01',endDate:'2098-12-31',budget:100000,budgetConfirmedAt:'2026-09-01T00:00:00.000Z',...extra});
async function post(action,campaignId,data={},owner='owner',origin='https://app.test'){
 const response=await route.POST(new Request('https://app.test/api/execution',{method:'POST',headers:{'content-type':'application/json','oai-authenticated-user-id':owner,origin},body:JSON.stringify({action,campaignId,...data})}));
 return {status:response.status,data:await response.json()};
}
let checks=0;const failures=[];function check(value,label){checks++;if(!value)failures.push(label)}
async function setup(id,maxPublications=1,maxPlannedCostKRW=1000,extra={},bytes=png){
 // Each independent scenario starts a fresh rate window; the boundary is tested separately below.
 await fresh();
 await put('campaign',id,campaignFixture(id,extra));
 const limits=await post('save_limits',id,{maxPublications,maxPlannedCostKRW});assert.equal(limits.status,200,'fixture limits');
 const card=await post('save_creative',id,{campaignVersion:1,factRefs:[{id:'fact',version:1}],png:dataUrl(bytes)});assert.equal(card.status,200,'real PNG fixture stored: '+JSON.stringify(card.data));
 return {id,creative:card.data,limits:limits.data};
}
const cloud=s=>'https://res.cloudinary.com/oda/image/upload/'+s.creative.pngHash+'.png',at=offset=>new Date(Date.UTC(2098,0,1,0,offset)).toISOString();
async function draft(s,offset=0,cost=100){
 const r=await post('save_publication',s.id,{creativeId:s.creative.id,mediaUrl:cloud(s),scheduledAt:at(offset),plannedCostKRW:cost});
 assert.equal(r.status,200,'fixture draft '+JSON.stringify(r.data));return r.data;
}
async function approve(s,p,extra={}){
 const credential=await server.readRecord('owner','publisher_credential','oda');
 const limits=await server.readRecord('owner','execution_limits',s.id).catch(()=>null);
 return post('approve',s.id,{id:p.id,version:p.version,confirmed:true,rightsConfirmed:true,immutableMediaConfirmed:true,channelId:'channel-1',credentialVersion:credential.version,limitsVersion:limits?.version,...extra});
}
check((await post('connect_buffer','missing',{token:'test-token-not-a-secret',organizationId:'org',channelId:'channel-1'})).status===404,'campaign required');
await put('campaign','connection',{id:'connection',brandId:'oda',version:1});
const channelList=await post('buffer_channels','connection',{token:'test-token-not-a-secret'});
check(channelList.status===200&&channelList.data.organizations?.length===2&&channelList.data.organizationId==='org'&&JSON.stringify(channelList.data.channels?.map(c=>c.id))==='["channel-1"]','API key loads organizations and Instagram channels only');
check((await post('buffer_channels','connection',{token:'test-token-not-a-secret',organizationId:'org-2'})).data.channels?.[0]?.id==='channel-2','organization choice reloads its channels');
check((await post('buffer_channels','connection',{token:'test-token-not-a-secret',organizationId:'unknown-org'})).status===400,'unknown organization rejected');
check(!JSON.stringify(rows('publisher_credential')).includes('channel'),'channel listing stores nothing');
check((await post('connect_buffer','connection',{token:'test-token-not-a-secret',organizationId:'org',channelId:'channel-1'})).status===200,'verified publisher');
check((await post('connect_buffer','connection',{token:'test-token-not-a-secret',organizationId:'org',channelId:'channel-1'})).status===409,'reconnect without displayed credential version rejected (CAS)');
check((await post('connect_buffer','connection',{token:'test-token-not-a-secret',organizationId:'org',channelId:'channel-1',version:1})).data.version===2,'reconnect with current credential version succeeds');

const growthRoute=await rt.load('app/api/growth/route.ts'),authorityRoute=await rt.load('app/api/growth/authority/route.ts'),operations=await rt.load('app/api/growth/operations/route.ts'),intentRoute=await rt.load('app/api/growth/execution/route.ts'),linkRoute=await rt.load('app/api/growth/publication/route.ts');
async function growthCall(target,campaignId,data){const r=await target.POST(new Request('https://app.test/api/growth/publication',{method:'POST',headers:{'content-type':'application/json','oai-authenticated-user-id':'owner',origin:'https://app.test'},body:JSON.stringify({campaignId,campaignVersion:1,expectedVersion:0,...data})}));return {status:r.status,data:await r.json()};}
const before=new Date(Date.now()-86400000).toISOString();
async function linkedFixture(name){
 const storeId='store-'+name;
 await put('store',storeId,{id:storeId,brandId:'oda'});
 const s=await setup(name,2,1000,{storeId});
 const p=(await approve(s,await draft(s))).data;
 const gp=data=>growthCall(growthRoute,name,data);
 const ok=async promise=>{const r=await promise;assert.equal(r.status,200,JSON.stringify(r.data));return r.data};
 await ok(growthCall(authorityRoute,name,{action:'save_authority',id:'auth-'+name,sign:true,input:{accountId:'channel-1',channel:'organic',status:'active',maxTier:'T3',allowedActions:['publish','spend'],startsAt:before,expiresAt:'2099-01-01T00:00:00Z',periodStart:before,periodEnd:'2099-01-01T00:00:00Z',totalCap:1000,dayCap:1000,weekCap:1000,lossCap:100}}));
 await ok(gp({action:'save_signal',id:'signal-'+name,input:{title:'시장 근거',sourceUrl:'https://example.com/market',observedAt:before,expiresAt:'2099-01-01',sourceType:'market',summary:'공개 시장 관측',sampleSize:null}}));
 await ok(gp({action:'save_need',id:'need-'+name,input:{title:'니즈',situation:'상황',desiredOutcome:'결과',alternative:'대안',barrier:'장벽',counterEvidence:'반례',signalIds:['signal-'+name],deadline:'2099-01-01',nextAction:'검증',assignee:'운영 담당'}}));
 await ok(gp({action:'save_catalog',id:'catalog-'+name,input:{sku:'SKU-'+name,title:'상품',price:1000,unitCost:20,variableCost:10,stock:0,stockUnit:'piece',currency:'KRW',taxBasis:'included',fulfillment:'배송 조건',refunds:'반품 조건',rightsConfirmed:true,factIds:['fact'],validUntil:'2099-01-01'}}));
 await ok(gp({action:'save_offer',id:'offer-'+name,input:{title:'오퍼',catalogId:'catalog-'+name,catalogVersion:1,needId:'need-'+name,price:1000,quantity:1,landingUrl:'https://example.com/buy',purchaseReason:'구매 이유',priceApproved:true}}));
 const inv=await ok(growthCall(operations,name,{action:'create_inventory',input:{sku:'SKU-'+name,locationId:storeId,unit:'piece',onHand:10},observedAt:before,evidenceRef:'stock-evidence'}));
 await ok(gp({action:'save_mission',id:'mission-'+name,input:{title:'판매 미션',offerId:'offer-'+name,offerVersion:1,assignee:'운영 담당',deadline:'2099-01-01',nextAction:'게시',channel:'organic',budget:100,lossLimit:4,stopRule:'한도 도달',fulfillmentOwner:'운영 담당'}}));
 await ok(gp({action:'queue_mission',id:'mission-'+name,expectedVersion:1}));
 const prepared=await ok(growthCall(intentRoute,name,{action:'prepare_execution',input:{missionId:'mission-'+name,missionVersion:2,authorityId:'auth-'+name,authorityVersion:1,inventoryId:inv.inventory[0].id,inventoryVersion:1,quantity:10,recoveryOwner:'복구 담당',recoveryDueAt:'2099-01-01T00:00:00Z',evidenceRef:'prepare-evidence'}}));
 return {s,p,intent:prepared.intents[0],ok};
}
// Actual Buffer route, growth APIs and memory SQLite; only provider/auth mocked.
const f=await linkedFixture('organic-buffer');
const linkInput={action:'link_publication',requestId:randomUUID(),intentId:f.intent.id,intentVersion:f.intent.version,publicationId:f.p.id,publicationVersion:f.p.version,contentConfirmed:true,evidenceRef:'approved-offer-review'};
let view=await f.ok(growthCall(linkRoute,f.s.id,linkInput));
assert.equal(view.links.length,1);
const preparedBudgetCount=rows('growth_commitment').length;
let response=await post('execute',f.s.id,{id:f.p.id,version:f.p.version});
assert.equal(response.status,200,JSON.stringify(response.data));assert.equal(response.data.status,'accepted');assert.equal(calls,1);
assert.equal((await server.readRecord('owner','growth_action_intent',f.intent.id)).state,'unknown');
assert.equal(rows('growth_commitment').length,preparedBudgetCount,'no second budget reservation');
assert.equal(rows('growth_stock_event').filter(row=>row.kind==='reserve').length,1,'no second inventory reservation');
const getLink=async()=>{const r=await linkRoute.GET(new Request('https://app.test/api/growth/publication?campaignId='+f.s.id,{headers:{'oai-authenticated-user-id':'owner'}}));assert.equal(r.status,200);return r.json()};
view=await getLink();
view=await f.ok(growthCall(linkRoute,f.s.id,{action:'sync_publication',requestId:randomUUID(),id:view.links[0].id,expectedVersion:view.links[0].version,publicationVersion:response.data.version}));
assert.equal(view.links[0].status,'scheduled');assert.equal((await server.readRecord('owner','growth_action_intent',f.intent.id)).state,'unknown');
const duplicate=await post('execute',f.s.id,{id:f.p.id,version:response.data.version});assert.equal(duplicate.status,409);assert.equal(calls,1);
providerStatus='sent';response=await post('refresh',f.s.id,{id:f.p.id,version:response.data.version});assert.equal(response.status,200,JSON.stringify(response.data));assert.equal(response.data.status,'published');
view=await f.ok(growthCall(linkRoute,f.s.id,{action:'sync_publication',requestId:randomUUID(),id:view.links[0].id,expectedVersion:view.links[0].version,publicationVersion:response.data.version}));
assert.equal(view.links[0].status,'published');assert.equal((await server.readRecord('owner','growth_action_intent',f.intent.id)).state,'observed');
assert.equal(rows('store_order').length,0,'published never fabricates sales');assert.equal(calls,1);
async function connect(fixture){return fixture.ok(growthCall(linkRoute,fixture.s.id,{action:'link_publication',requestId:randomUUID(),intentId:fixture.intent.id,intentVersion:fixture.intent.version,publicationId:fixture.p.id,publicationVersion:fixture.p.version,contentConfirmed:true,evidenceRef:'approved-content-review'}));}
async function sync(fixture,publicationVersion){const r=await linkRoute.GET(new Request('https://app.test/api/growth/publication?campaignId='+fixture.s.id,{headers:{'oai-authenticated-user-id':'owner'}}));const v=await r.json();return fixture.ok(growthCall(linkRoute,fixture.s.id,{action:'sync_publication',requestId:randomUUID(),id:v.links[0].id,expectedVersion:v.links[0].version,publicationVersion}));}
const atomic=await linkedFixture('atomic-buffer');await connect(atomic);const beforeAtomic=calls;
beforeRun=statement=>{if(statement.query.startsWith('INSERT INTO records')&&statement.values[2]==='growth_publication_history')throw new Error('Injected growth receipt failure');};
response=await post('execute',atomic.s.id,{id:atomic.p.id,version:atomic.p.version});beforeRun=null;
check(response.status===500&&calls===beforeAtomic,'atomic failure prevents provider request');
check((await server.readRecord('owner','execution_publication',atomic.p.id)).status==='approved','atomic failure rolls back publication submitting');
check((await server.readRecord('owner','growth_action_intent',atomic.intent.id)).state==='prepared','atomic failure rolls back growth unknown');
response=await post('execute',atomic.s.id,{id:atomic.p.id,version:atomic.p.version});check(response.status===200&&calls===beforeAtomic+1,'safe retry only after atomic rollback');
const revoked=await linkedFixture('revoked-buffer');await connect(revoked);const beforeRevoke=calls;
beforeRun=statement=>{if(statement.query.startsWith('DELETE FROM mutation_locks')&&rows('execution_publication').some(p=>p.id===revoked.p.id&&p.status==='submitting')){beforeRun=null;rt.sql.prepare("UPDATE records SET data=json_set(data,'$.input.status','revoked') WHERE owner=? AND kind='growth_authority' AND json_extract(data,'$.id')=?").run('owner','auth-'+revoked.s.id);}};
response=await post('execute',revoked.s.id,{id:revoked.p.id,version:revoked.p.version});beforeRun=null;
check(response.status===200&&response.data.status==='failed'&&calls===beforeRevoke,'revocation after reservation prevents provider');
view=await sync(revoked,response.data.version);check(view.links[0].releaseEvidence===null,'pre-send failure does not manufacture release evidence');
check((await server.readRecord('owner','growth_action_intent',revoked.intent.id)).state==='unknown','pre-send failure conservatively retains reservation');
const lost=await linkedFixture('lost-buffer');await connect(lost);mode='lost';const beforeLost=calls;
response=await post('execute',lost.s.id,{id:lost.p.id,version:lost.p.version});mode='ok';
check(response.status===200&&response.data.status==='uncertain'&&calls===beforeLost+1,'lost provider response remains uncertain');
view=await sync(lost,response.data.version);check(view.links[0].status==='unknown','uncertain provider synchronizes unknown');
const retry=await post('execute',lost.s.id,{id:lost.p.id,version:response.data.version});check(retry.status===409&&calls===beforeLost+1,'uncertain is never resent');
check((await server.readRecord('owner','growth_action_intent',lost.intent.id)).state==='unknown','uncertain keeps growth reservation');
const inflight=await linkedFixture('inflight-buffer');await connect(inflight);mode='stop-in-flight';const beforeInflight=calls;
response=await post('execute',inflight.s.id,{id:inflight.p.id,version:inflight.p.version});mode='ok';
check(response.status===200&&response.data.status==='accepted'&&calls===beforeInflight+1,'stop in flight preserves returned provider result');
view=await sync(inflight,response.data.version);check(view.links[0].status==='scheduled','global stop still permits linked result sync');
check((await server.readRecord('owner','growth_action_intent',inflight.intent.id)).state==='unknown','in-flight result never fabricates published or releases');
assert.deepEqual(failures,[]);
console.log(JSON.stringify({passed:checks+19,storage:'real memory SQLite and real growth/Buffer routes',provider:'mocked Buffer',external:0}));
