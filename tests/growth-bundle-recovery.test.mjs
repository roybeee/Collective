// Bundle failure/capacity recovery regressions. Real SQLite, mocked auth, no external calls.
import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';import {testRuntime} from './helpers/runtime.mjs';
let failKind='';const {load,sql}=testRuntime(async()=>{throw Error('external forbidden')},{beforeRun(s){if(failKind&&s.values[2]===failKind&&s.query.startsWith('INSERT INTO records'))throw Error('atomic failure')}});
const server=await load('lib/server.ts'),growth=await load('app/api/growth/route.ts'),operations=await load('app/api/growth/operations/route.ts'),route=await load('app/api/growth/bundles/route.ts');
let passed=0;const failures=[];const check=(v,n)=>{if(v)passed++;else failures.push(n)};
const owner='owner',c={id:'c',brandId:'b',storeId:'store',version:1,status:'active'},h={'oai-authenticated-user-id':owner,origin:'https://agency.test'};
await server.recordStatement(owner,'campaign','c',c).run();await server.recordStatement(owner,'store','store',{id:'store',brandId:'b'}).run();
await server.recordStatement(owner,'brand_fact','product-fact',{id:'product-fact',brandId:'b',key:'상품 조건',value:'합성 상품 조건',status:'confirmed',source:'합성 증빙',verifiedAt:new Date().toISOString(),validUntil:'2099-01-01T00:00:00Z',version:1},'b').run();
const unpack=async r=>({status:r.status,body:await r.json()}),call=(target,data,headers=h)=>target.POST(new Request('https://agency.test/api/x',{method:'POST',headers:{...headers,'content-type':'application/json'},body:JSON.stringify({campaignId:'c',campaignVersion:1,expectedVersion:0,...data})})).then(unpack);
const catalog=(sku,p={})=>({sku,title:sku,price:5000,unitCost:1500,variableCost:500,stock:0,stockUnit:'piece',currency:'KRW',taxBasis:'included',fulfillment:'배송',refunds:'반품',rightsConfirmed:true,factIds:['product-fact'],validUntil:'2099-01-01',...p});
await call(growth,{action:'save_catalog',id:'a',input:catalog('A')});await call(growth,{action:'save_catalog',id:'b2',input:catalog('B',{price:3000,unitCost:800,variableCost:200})});await call(growth,{action:'save_catalog',id:'x',input:catalog('X',{taxBasis:'excluded'})});
await call(operations,{action:'create_inventory',input:{sku:'A',locationId:'store',unit:'piece',onHand:20},observedAt:new Date(Date.now()-60000).toISOString(),evidenceRef:'stock-a'});await call(operations,{action:'create_inventory',input:{sku:'B',locationId:'store',unit:'piece',onHand:9},observedAt:new Date(Date.now()-60000).toISOString(),evidenceRef:'stock-b'});
const bundle=(p={})=>({title:'점심 세트',components:[{catalogId:'a',catalogVersion:1,units:1},{catalogId:'b2',catalogVersion:1,units:2}],price:9000,priceApproved:true,plannedQuantity:4,landingUrl:'https://shop.example.com/set',purchaseReason:'한 번에 준비',...p});
const post=(data,headers=h)=>call(route,{action:'save_bundle',requestId:randomUUID(),...data},headers),get=(headers=h)=>route.GET(new Request('https://agency.test/api/growth/bundles?campaignId=c',{headers})).then(unpack);
await post({id:'set',input:bundle()});
const fulfillment=await load('app/api/growth/bundle-fulfillment/route.ts'),authority=await load('app/api/growth/authority/route.ts');
const before=new Date(Date.now()-86400000).toISOString(),after=new Date(Date.now()+30*86400000).toISOString();
assert.equal((await call(authority,{action:'save_authority',id:'auth',sign:true,input:{accountId:'shop',channel:'storefront',status:'active',maxTier:'T3',allowedActions:['publish','spend'],startsAt:before,expiresAt:after,periodStart:before,periodEnd:after,totalCap:100,dayCap:100,weekCap:100,lossCap:20}})).status,200);
const stocks=()=>sql.prepare("SELECT data FROM records WHERE kind='growth_inventory_item'").all().map(x=>JSON.parse(x.data)),versions=()=>stocks().map(x=>({inventoryId:x.id,version:x.version}));
const fp=data=>call(fulfillment,{requestId:randomUUID(),...data});
const prepare={action:'prepare_bundle_mission',id:'bundle-mission-test',bundleId:'set',bundleVersion:1,authorityId:'auth',authorityVersion:1,quantity:4,inventories:versions(),evidenceRef:'bundle-prepared',confirmed:true,input:{title:'번들 판매',assignee:'운영',deadline:'2099-01-01',nextAction:'판매',channel:'storefront',budget:60,lossLimit:4,stopRule:'중단',fulfillmentOwner:'배송'}};

assert.equal((await fp(prepare)).status,200);
const order={id:'ord',storeId:'store',campaignId:'c',version:1,status:'paid',orderDate:new Date().toISOString().slice(0,10),paidAmount:36000,refundAmount:0,costs:{foodCost:1000,packagingCost:0,fees:0,deliveryCost:0,benefitCost:0}};
await server.recordStatement(owner,'store_order','ord',order,'store').run();
const a=stocks().find(x=>x.input.sku==='A'),b=stocks().find(x=>x.input.sku==='B');
const components=stocks().map(x=>({inventoryId:x.id,paidAllocation:x.input.sku==='A'?12000:24000,refundAllocation:0}));
const link={action:'link_bundle_order',id:'bundle-order-test',missionId:prepare.id,missionVersion:1,orderId:'ord',orderVersion:1,sourceKey:'shop',accountId:'shop',externalLineId:'line',quantity:4,paidAllocation:36000,refundAllocation:0,components,inventories:versions(),evidenceRef:'order-proof'};
assert.equal((await fp(link)).status,200);
const line=()=>JSON.parse(sql.prepare("SELECT data FROM records WHERE kind='growth_bundle_order' AND parent_id='c'").get().data);
const op=(inventoryId,kind,quantity,extra={})=>fp({action:'record_bundle_operation',id:link.id,expectedVersion:line().version,inventoryId,inventoryVersion:stocks().find(x=>x.id===inventoryId).version,kind,quantity,observedAt:new Date().toISOString(),evidenceRef:'operation-proof',safeRelease:false,returnAccepted:false,disposition:'unknown',restock:false,...extra});
assert.equal((await op(a.id,'ship',4)).status,200);assert.equal((await op(b.id,'ship',8)).status,200);
const final={action:'reconcile_bundle_mission',id:prepare.id,expectedVersion:1,commitmentVersion:1,status:'failed',input:{mode:'final',actualAmount:60,actualLoss:0,evidenceRef:'failed-proof',note:'failed after recorded fulfillment',noExecution:false,noOutstandingObligations:true}};
assert.equal((await fp(final)).status,200);
await server.recordStatement(owner,'store_order','ord',{...order,version:2,refundAmount:200},'store').run();
const reconciled={...link,expectedVersion:line().version,missionVersion:2,orderVersion:2,refundAllocation:200,components:components.map(x=>({...x,refundAllocation:x.inventoryId===b.id?200:0})),requestId:randomUUID()};
const eventsBefore=sql.prepare("SELECT COUNT(*) n FROM records WHERE kind='growth_stock_event'").get().n;
check((await fp(reconciled)).status===200,'failed mission permits existing canonical refund/version reconciliation');
check(line().input.orderVersion===2&&line().input.refundAllocation===200,'refund allocation stores current canonical order version');
check(sql.prepare("SELECT COUNT(*) n FROM records WHERE kind='growth_stock_event'").get().n===eventsBefore,'money reconciliation creates no second stock allocation');
check((await fp(reconciled)).body.duplicate,'existing order correction retry is idempotent');
check((await op(b.id,'return',4,{returnAccepted:true,disposition:'resalable',restock:true})).status===200,'partial SKU return succeeds after failed mission refund reconciliation');
check(stocks().find(x=>x.id===a.id).input.onHand===a.input.onHand,'return does not mutate unrelated inventory opening balance');
const opview=await operations.GET(new Request('https://agency.test/api/growth/operations?campaignId=c',{headers:h})).then(unpack);
check(opview.body.inventory.find(x=>x.id===b.id).projection.onHand===5&&opview.body.inventory.find(x=>x.id===a.id).projection.onHand===16,'partial return changes only selected SKU projection');
check((await fp({...link,id:'bundle-order-forbidden',missionVersion:2,orderVersion:2,quantity:1,externalLineId:'another',inventories:versions()})).status===409,'failed mission still rejects new order allocations');
// An explicit stocktake makes the capacity scenario independent of refund recovery.
assert.equal((await call(operations,{action:'stock_adjust',id:'capacity-fixture-stocktake',inventoryId:b.id,inventoryVersion:stocks().find(x=>x.id===b.id).version,kind:'stocktake',quantity:20,observedAt:new Date().toISOString(),evidenceRef:'capacity-fixture'})).status,200);
await post({id:'pending',input:bundle({plannedQuantity:1})});await post({id:'new-at-capacity',input:bundle({plannedQuantity:1})});
const pending={...prepare,id:'bundle-mission-pending',bundleId:'pending',quantity:1,inventories:versions(),input:{...prepare.input,budget:20}};
assert.equal((await fp(pending)).status,200);
const historyCount=sql.prepare("SELECT COUNT(*) n FROM records WHERE kind='growth_bundle_history' AND parent_id='c'").get().n;
for(let i=historyCount;i<2000;i++)await server.recordStatement(owner,'growth_bundle_history','capacity-'+i,{id:'capacity-'+i,campaignId:'c',brandId:'b',version:1,input:bundle()},'c').run();
const beforeStock=JSON.stringify(versions()),beforeBudget=sql.prepare("SELECT COUNT(*) n FROM records WHERE kind='growth_commitment'").get().n;
const blocked={...pending,id:'bundle-mission-blocked',bundleId:'new-at-capacity',inventories:versions()};
check((await fp(blocked)).status===409,'history capacity rejects new mission preparation');
check(JSON.stringify(versions())===beforeStock,'rejected preparation reserves no component stock');
check(sql.prepare("SELECT COUNT(*) n FROM records WHERE kind='growth_commitment'").get().n===beforeBudget,'rejected preparation reserves no budget');
check(sql.prepare("SELECT COUNT(*) n FROM records WHERE kind='growth_bundle_mission' AND json_extract(data,'$.id')='bundle-mission-blocked'").get().n===0,'rejected preparation creates no mission');
// Existing recovery must not be stranded by its own ordinary mutation receipts.
for(const [kind,cap] of [['growth_bundle_mission_history',5000],['growth_bundle_mission_request',10000]]){const count=sql.prepare('SELECT COUNT(*) n FROM records WHERE kind=? AND parent_id=?').get(kind,'c').n;for(let i=count;i<cap;i++)await server.recordStatement(owner,kind,'capacity-'+i,{id:'capacity-'+i,campaignId:'c',brandId:'b'},'c').run();}
const release={action:'reconcile_bundle_mission',id:pending.id,expectedVersion:1,commitmentVersion:1,bundleVersion:2,inventories:versions(),status:'failed',input:{mode:'release',actualAmount:0,actualLoss:0,evidenceRef:'no-execution',note:'cancel pending mission',noExecution:true,noOutstandingObligations:true}};
check((await fp(release)).status===200,'existing mission release remains possible at ordinary history capacity');
const afterGet=await get();check(afterGet.status===200,'bundle view remains readable after recovery history overflow');
if(afterGet.status===200){check(afterGet.body.bundles.find(x=>x.id==='pending').reservation.status==='released','recovered reservation is shown as released');check(afterGet.body.history.length<=2000&&afterGet.body.historyHasMore===true,'bounded history explicitly signals overflow');}
console.log(JSON.stringify({passed,failures,sqlite:'real',auth:'mocked',external:0}));assert.deepEqual(failures,[]);
