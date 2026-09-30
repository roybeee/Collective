import assert from 'node:assert/strict';
import {testRuntime} from './helpers/runtime.mjs';
let failKind='';
const {load,sql,env}=testRuntime(async()=>{throw Error('Execution preparation must not dispatch');},{beforeRun(statement){if(failKind&&statement.query.startsWith('INSERT INTO records')&&statement.values[2]===failKind)throw Error('Injected atomic write failure');}});
const server=await load('lib/server.ts'),growth=await load('app/api/growth/route.ts'),authorityRoute=await load('app/api/growth/authority/route.ts'),operations=await load('app/api/growth/operations/route.ts'),route=await load('app/api/growth/execution/route.ts');
let passed=0;const check=(condition,label)=>{assert.ok(condition,label);passed++;};
const owner='execution-owner',c={id:'c',brandId:'brand',storeId:'store',version:1,status:'active'},h={'oai-authenticated-user-id':owner,origin:'https://agency.test'};
await server.recordStatement(owner,'campaign','c',c).run();
await server.recordStatement(owner,'store','store',{id:'store',brandId:'brand'}).run();
const unpack=async r=>({status:r.status,body:await r.json()});
const call=(target,data,headers=h)=>target.POST(new Request('https://agency.test/api/growth/execution',{method:'POST',headers:{...headers,'content-type':'application/json'},body:JSON.stringify({campaignId:'c',campaignVersion:1,expectedVersion:0,...data})})).then(unpack);
const post=(data,headers=h)=>call(route,data,headers),gp=data=>call(growth,data);
const before=new Date(Date.now()-86400000).toISOString(),after=new Date(Date.now()+30*86400000).toISOString();
const mandate={accountId:'account-one',channel:'storefront',status:'active',maxTier:'T3',allowedActions:['publish','spend'],startsAt:before,expiresAt:after,periodStart:before,periodEnd:after,totalCap:100,dayCap:100,weekCap:100,lossCap:20};
check((await call(authorityRoute,{action:'save_authority',id:'auth',sign:true,input:mandate})).status===200,'signed authority');
const signal={title:'시장 근거',sourceUrl:'https://example.com/market',observedAt:before,expiresAt:'2099-01-01',sourceType:'market',summary:'공개 시장 관측',sampleSize:null};
check((await gp({action:'save_signal',id:'s',input:signal})).status===200,'signal fixture');
check((await gp({action:'save_need',id:'n',input:{title:'니즈 가설',situation:'상황',desiredOutcome:'원하는 결과',alternative:'대안',barrier:'장애물',counterEvidence:'반례',signalIds:['s'],deadline:'2099-01-01',nextAction:'검증',assignee:'검토 담당'}})).status===200,'need fixture');
await server.recordStatement(owner,'brand_fact','f',{id:'f',brandId:'brand',key:'product',value:'상품',status:'confirmed',source:'운영 확인',version:1,verifiedAt:'2026-01-01',validUntil:'2099-01-01'},'brand').run();
check((await gp({action:'save_catalog',id:'p',input:{sku:'SKU',title:'상품',price:100,unitCost:20,variableCost:10,stock:0,stockUnit:'piece',currency:'KRW',taxBasis:'included',fulfillment:'배송 조건',refunds:'반품 조건',rightsConfirmed:true,factIds:['f'],validUntil:'2099-01-01'}})).status===200,'product fixture');
check((await gp({action:'save_offer',id:'o',input:{title:'오퍼',catalogId:'p',catalogVersion:1,needId:'n',price:100,quantity:1,landingUrl:'https://example.com/buy',purchaseReason:'구매 이유',priceApproved:true}})).status===200,'offer fixture');
const mission={title:'판매 미션',offerId:'o',offerVersion:1,assignee:'판매 담당',deadline:'2099-01-01',nextAction:'판매 준비',channel:'storefront',budget:60,lossLimit:4,stopRule:'한도 도달',fulfillmentOwner:'배송 담당'};
async function makeMission(id,input=mission){check((await gp({action:'save_mission',id,input})).status===200,'mission fixture '+id);check((await gp({action:'queue_mission',id,expectedVersion:1})).status===200,'staged fixture '+id);}


const created=await call(operations,{action:'create_inventory',input:{sku:'SKU',locationId:'store',unit:'piece',onHand:10},observedAt:before,evidenceRef:'stock-evidence'});
check(created.status===200,'inventory fixture '+JSON.stringify(created));
const inventoryId=created.body.inventory[0].id;

const workspace=await load('lib/growth-workspace-server.ts');
let view=await workspace.growthView(owner,c,true);check(view.catalogs[0].currentStock?.available===10,'actual shared stock exposed');check(!view.catalogs[0].readiness.missing.length,'manual zero with actual stock ready');await makeMission('m');
const saved=await server.readRecord(owner,'growth_inventory_item',inventoryId),catalog=await server.readRecord(owner,'growth_catalog','p');
await server.recordStatement(owner,'growth_catalog','p',{...catalog,input:{...catalog.input,stock:100}},'c').run();
const ev={id:'deplete',digest:'a'.repeat(64),requestDigest:'a'.repeat(64),version:2,kind:'stocktake',quantity:0,reservationId:'',missionId:'',orderId:'',observedAt:before,recordedAt:new Date().toISOString(),evidenceRef:'stocktake',safeRelease:false,returnAccepted:false,disposition:'unknown',restock:false,inventoryId,brandId:'brand',storeId:'store',campaignId:'other-campaign'};
await server.recordStatement(owner,'growth_stock_event','deplete',ev,inventoryId).run();await server.recordStatement(owner,'growth_inventory_item',inventoryId,{...saved,version:2},'store').run();view=await workspace.growthView(owner,c,true);check(view.catalogs[0].currentStock.available===0&&view.missions[0].readiness.missing.length>0,'manual ample but actual empty held');
await sql.prepare("DELETE FROM records WHERE kind='growth_stock_event' AND json_extract(data,'$.id')='deplete'").run();await server.recordStatement(owner,'growth_inventory_item',inventoryId,saved,'store').run();
await server.recordStatement(owner,'growth_inventory_item','duplicate',{...saved,id:'duplicate'},'store').run();view=await workspace.growthView(owner,c,true);check(view.catalogs[0].currentStock.status==='held','duplicate SKU ledgers not summed');
const prep={action:'prepare_execution',input:{missionId:'m',missionVersion:2,authorityId:'auth',authorityVersion:1,inventoryId,inventoryVersion:1,quantity:1,recoveryOwner:'담당',recoveryDueAt:after,evidenceRef:'proof'}};check((await post(prep)).status===409,'duplicate blocks execution');await sql.prepare("DELETE FROM records WHERE kind='growth_inventory_item' AND json_extract(data,'$.id')='duplicate'").run();
await server.recordStatement(owner,'growth_catalog','p',{...catalog,input:{...catalog.input,stockUnit:undefined}},'c').run();view=await workspace.growthView(owner,c,true);check(view.catalogs[0].currentStock.status==='held','legacy unit unknown');await server.recordStatement(owner,'growth_catalog','p',catalog,'c').run();
await server.recordStatement(owner,'growth_inventory_item',inventoryId,{...saved,input:{...saved.input,unit:'pack'}},'store').run();view=await workspace.growthView(owner,c,true);check(view.catalogs[0].currentStock.status==='held','pack versus piece held');await server.recordStatement(owner,'growth_inventory_item',inventoryId,saved,'store').run();
const originalPrepare=env.DB.prepare.bind(env.DB);env.DB.prepare=query=>{if(query==='SELECT data FROM records WHERE owner=? AND kind=? AND parent_id=? LIMIT 501')throw Error('inventory read failure');return originalPrepare(query)};view=await workspace.growthView(owner,c,true);check(view.catalogs[0].currentStock.status==='held','database read failure holds preparation');env.DB.prepare=originalPrepare;
await server.recordStatement(owner,'growth_inventory_item','broken',{id:'broken',input:null},'store').run();view=await workspace.growthView(owner,c,true);check(view.catalogs[0].currentStock.status==='held','malformed inventory holds without failing workspace');sql.prepare("DELETE FROM records WHERE kind='growth_inventory_item' AND json_extract(data,'$.id')='broken'").run();
check((await post({...prep,input:{...prep.input,inventoryVersion:0}})).status===409,'lookup to reservation stale CAS');check(sql.prepare("SELECT COUNT(*) n FROM records WHERE kind='growth_commitment'").get().n===0,'no budget on stock failure');
check((await post(prep)).status===200,'actual inventory valid execution');
view=await workspace.growthView(owner,c,true);check(view.catalogs[0].currentStock.reserved===1,'shared reservations included');
await server.recordStatement(owner,'growth_catalog','p',{...catalog,version:2},'c').run();view=await workspace.growthView(owner,c,true);check(view.offers[0].readiness.missing.some(x=>x.includes('상품 버전')),'catalog revision makes offer stale');
console.log(JSON.stringify({passed,external:'not_called'}));
