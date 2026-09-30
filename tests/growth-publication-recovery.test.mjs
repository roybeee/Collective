import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {testRuntime} from './helpers/runtime.mjs';
let failKind='';
const {load}=testRuntime(async()=>{throw Error('Execution preparation must not dispatch');},{beforeRun(statement){if(failKind&&statement.query.startsWith('INSERT INTO records')&&statement.values[2]===failKind)throw Error('Injected atomic write failure');}});
const server=await load('lib/server.ts'),growth=await load('app/api/growth/route.ts'),authorityRoute=await load('app/api/growth/authority/route.ts'),operations=await load('app/api/growth/operations/route.ts'),route=await load('app/api/growth/execution/route.ts');
let passed=0;const check=(condition,label)=>{assert.ok(condition,label);passed++;};
const owner='execution-owner',c={id:'c',brandId:'brand',storeId:'store',version:1,status:'active'},h={'oai-authenticated-user-id':owner,origin:'https://agency.test'};
await server.recordStatement(owner,'campaign','c',c).run();await server.recordStatement(owner,'brand','brand',{id:'brand',name:'합성 브랜드'}).run();
await server.recordStatement(owner,'store','store',{id:'store',brandId:'brand'}).run();
const unpack=async r=>({status:r.status,body:await r.json()});
const call=(target,data,headers=h)=>target.POST(new Request('https://agency.test/api/growth/execution',{method:'POST',headers:{...headers,'content-type':'application/json'},body:JSON.stringify({campaignId:'c',campaignVersion:1,expectedVersion:0,...data})})).then(unpack);
const post=(data,headers=h)=>call(route,data,headers),gp=data=>call(growth,data);
const before=new Date(Date.now()-86400000).toISOString(),after=new Date(Date.now()+30*86400000).toISOString();
const mandate={accountId:'buffer-channel',channel:'organic',status:'active',maxTier:'T3',allowedActions:['publish','spend'],startsAt:before,expiresAt:after,periodStart:before,periodEnd:after,totalCap:100,dayCap:100,weekCap:100,lossCap:20};
check((await call(authorityRoute,{action:'save_authority',id:'auth',sign:true,input:mandate})).status===200,'signed authority');
const signal={title:'시장 근거',sourceUrl:'https://example.com/market',observedAt:before,expiresAt:'2099-01-01',sourceType:'market',summary:'공개 시장 관측',sampleSize:null};
check((await gp({action:'save_signal',id:'s',input:signal})).status===200,'signal fixture');
check((await gp({action:'save_need',id:'n',input:{title:'니즈 가설',situation:'상황',desiredOutcome:'원하는 결과',alternative:'대안',barrier:'장애물',counterEvidence:'반례',signalIds:['s'],deadline:'2099-01-01',nextAction:'검증',assignee:'검토 담당'}})).status===200,'need fixture');
await server.recordStatement(owner,'brand_fact','f',{id:'f',brandId:'brand',key:'product',value:'상품',status:'confirmed',source:'운영 확인',version:1,verifiedAt:'2026-01-01',validUntil:'2099-01-01'},'brand').run();
check((await gp({action:'save_catalog',id:'p',input:{sku:'SKU',title:'상품',price:100,unitCost:20,variableCost:10,stock:20,stockUnit:'piece',currency:'KRW',taxBasis:'included',fulfillment:'배송 조건',refunds:'반품 조건',rightsConfirmed:true,factIds:['f'],validUntil:'2099-01-01'}})).status===200,'product fixture');
check((await gp({action:'save_offer',id:'o',input:{title:'오퍼',catalogId:'p',catalogVersion:1,needId:'n',price:100,quantity:1,landingUrl:'https://example.com/buy',purchaseReason:'구매 이유',priceApproved:true}})).status===200,'offer fixture');
const mission={title:'판매 미션',offerId:'o',offerVersion:1,assignee:'판매 담당',deadline:'2099-01-01',nextAction:'판매 준비',channel:'organic',budget:60,lossLimit:4,stopRule:'한도 도달',fulfillmentOwner:'배송 담당'};
async function makeMission(id,input=mission){check((await gp({action:'save_mission',id,input})).status===200,'mission fixture '+id);check((await gp({action:'queue_mission',id,expectedVersion:1})).status===200,'staged fixture '+id);}


const created=await call(operations,{action:'create_inventory',input:{sku:'SKU',locationId:'store',unit:'piece',onHand:10},observedAt:before,evidenceRef:'stock-evidence'});
check(created.status===200,'inventory fixture '+JSON.stringify(created));
const inventoryId=created.body.inventory[0].id;
await makeMission('m');
const input={missionId:'m',missionVersion:2,authorityId:'auth',authorityVersion:1,inventoryId,inventoryVersion:1,quantity:3,recoveryOwner:'운영 담당',recoveryDueAt:after,evidenceRef:'prepare-evidence'};

const adapter=await load('app/api/growth/publication/route.ts'),ps=await load('lib/growth-publication-server.ts');
let prepared=await post({action:'prepare_execution',input});check(prepared.status===200,'organic prepared fixture');const intent=prepared.body.intents[0];
const publication={id:'pub',campaignId:'c',campaignVersion:1,creativeId:'creative',creativeVersion:1,pngHash:'a'.repeat(64),factRefs:[{id:'f',version:1}],caption:'상품 배송 안내',mediaUrl:'https://example.com/image.png',scheduledAt:new Date(Date.now()+86400000).toISOString(),plannedCostKRW:10,version:2,status:'approved',channelId:'buffer-channel',credentialVersion:1,limitsVersion:1,approvedLimits:{maxPublications:10,maxPlannedCostKRW:100},approvedBy:owner,approvedAt:before,createdAt:before};
await server.recordStatement(owner,'execution_publication','pub',publication,'c').run();await server.recordStatement(owner,'execution_creative','creative',{id:'creative',campaignId:'c',campaignVersion:1,version:1,pngHash:publication.pngHash},'c').run();await server.recordStatement(owner,'publisher_credential','brand',{secret:'synthetic-test-only',channelId:'buffer-channel',account:'synthetic-account',version:1},'brand').run();
const ap=(data,headers=h)=>call(adapter,{requestId:randomUUID(),...data},headers),ag=()=>adapter.GET(new Request('https://agency.test/api/growth/publication?campaignId=c',{headers:h})).then(unpack);
const link={action:'link_publication',intentId:intent.id,intentVersion:1,publicationId:'pub',publicationVersion:2,contentConfirmed:true,evidenceRef:'content-review',requestId:randomUUID()};
check((await ap(link,{})).status===401,'anonymous link blocked');check((await ap(link,{...h,origin:'https://evil.test'})).status===403,'CSRF');check((await ap({...link,contentConfirmed:false})).status===400,'content confirmation required');
const originalGrant=await server.readRecord(owner,'growth_authority','auth');await server.recordStatement(owner,'growth_authority','auth',{...originalGrant,input:{...originalGrant.input,allowedActions:['spend']}},'c').run();check((await ap({...link,requestId:randomUUID()})).status===409,'spend without publish cannot link organic publication');await server.recordStatement(owner,'growth_authority','auth',originalGrant,'c').run();
const originalOffer=await server.readRecord(owner,'growth_offer','o');await server.recordStatement(owner,'growth_offer','o',{...originalOffer,input:{...originalOffer.input,quantity:5}},'c').run();check((await ap({...link,requestId:randomUUID()})).status===409,'own reservation must cover whole offered package');await server.recordStatement(owner,'growth_offer','o',originalOffer,'c').run();
let r=await ap(link);check(r.status===200,'link '+JSON.stringify(r));check(r.body.links.length===1&&r.body.links[0].intentId===intent.id,'one immutable link');check((await ap(link)).body.duplicate,'link UUID replay');check((await ap({...link,evidenceRef:'different-review'})).status===409,'UUID conflict');check(JSON.stringify((await ag()).body).includes('synthetic-test-only')===false,'credential secret never returned');check((await server.readRecord(owner,'growth_action_intent',intent.id)).state==='prepared','link does not claim submission');
await server.recordStatement(owner,'execution_publication','pub',{...publication,status:'cancelled',version:3},'c').run();for(let n=0;n<1000;n++)await server.recordStatement(owner,'execution_publication','extra-'+n,{...publication,id:'extra-'+n},'c').run();
r=await ap({action:'sync_publication',id:intent.id,expectedVersion:1,publicationVersion:3});check(r.status===200&&r.body.recorded&&r.body.viewUnavailable,'unrelated publication cap does not block exact cancellation sync');const synced=await server.readRecord(owner,'growth_action_intent',intent.id);check(synced.state==='failed','never attempted cancellation verified');await ps.assertGrowthPublicationRelease(owner,c,synced);passed++;
await server.recordStatement(owner,'campaign','c',{...c,status:'archived'}).run();await server.recordStatement(owner,'growth_stop','global',{id:'global',status:'stopped',version:1,reason:'복구',updatedAt:new Date().toISOString(),updatedBy:owner}).run();
r=await post({action:'reconcile_execution',id:intent.id,expectedVersion:synced.version,missionVersion:synced.currentMissionVersion,inventoryVersion:2,commitmentVersion:1,requestId:randomUUID(),input:{mode:'release',actualAmount:0,actualLoss:0,evidenceRef:'cancel-proof',note:'미시도 취소 확인',noExecution:true,noOutstandingObligations:true}});check(r.status===200,'archived stopped no-attempt cancellation recovery');check((await server.readRecord(owner,'growth_commitment',intent.commitmentId)).commitment.status==='released','budget released only proven cancellation');check((await server.readRecord(owner,'growth_inventory_item',inventoryId)).version===3,'stock release committed');
console.log(JSON.stringify({passed,external:'not_called'}));
