// 검증된 확증 실험 결과 기반 1회 20% 이내 예산 확대(G2-12b/17b/11). 인증 mocked, 메모리 SQLite real, 외부 0.
import assert from 'node:assert/strict';import {randomUUID,createHash} from 'node:crypto';import {testRuntime} from './helpers/runtime.mjs';
const {load,sql,env}=testRuntime(async()=>{throw Error('external forbidden')});
const server=await load('lib/server.ts'),growth=await load('app/api/growth/route.ts'),authorityRoute=await load('app/api/growth/authority/route.ts'),operations=await load('app/api/growth/operations/route.ts'),route=await load('app/api/growth/expansion/route.ts'),pure=await load('lib/growth-expansion.ts');
let passed=0;const check=(v,n)=>{assert.ok(v,n);passed++};
const owner='owner',c={id:'c',brandId:'brand',storeId:'store',version:1,status:'active'},h={'oai-authenticated-user-id':owner,origin:'https://agency.test'};
const put=(kind,id,data,parent='')=>server.recordStatement(owner,kind,id,data,parent).run();await put('campaign','c',c);await put('store','store',{id:'store',brandId:'brand'});
const unpack=async r=>({status:r.status,body:await r.json()}),call=(target,data,headers=h)=>target.POST(new Request('https://agency.test/api/x',{method:'POST',headers:{...headers,'content-type':'application/json'},body:JSON.stringify({campaignId:'c',campaignVersion:1,expectedVersion:0,...data})})).then(unpack);
const before=new Date(Date.now()-86400000).toISOString(),after=new Date(Date.now()+30*86400000).toISOString();
check((await call(authorityRoute,{action:'save_authority',id:'auth',sign:true,input:{accountId:'acct',channel:'storefront',status:'active',maxTier:'T3',allowedActions:['publish','spend'],startsAt:before,expiresAt:after,periodStart:before,periodEnd:after,totalCap:10000,dayCap:10000,weekCap:10000,lossCap:10000}})).status===200,'authority');
await put('brand_fact','f',{id:'f',brandId:'brand',key:'product',value:'상품',status:'confirmed',source:'운영 확인',version:1,verifiedAt:'2026-01-01',validUntil:'2099-01-01'},'brand');
await call(growth,{action:'save_signal',id:'s',input:{title:'근거',sourceUrl:'https://example.com/m',observedAt:before,expiresAt:'2099-01-01',sourceType:'market',summary:'관측',sampleSize:null}});
await call(growth,{action:'save_need',id:'n',input:{title:'니즈',situation:'상황',desiredOutcome:'결과',alternative:'대안',barrier:'장애',counterEvidence:'반례',signalIds:['s'],deadline:'2099-01-01',nextAction:'검증',assignee:'담당'}});
await call(growth,{action:'save_catalog',id:'p',input:{sku:'SKU',title:'상품',price:100,unitCost:20,variableCost:10,stock:0,stockUnit:'piece',currency:'KRW',taxBasis:'included',fulfillment:'배송',refunds:'반품',rightsConfirmed:true,factIds:['f'],validUntil:'2099-01-01'}});
await call(growth,{action:'save_offer',id:'o',input:{title:'오퍼',catalogId:'p',catalogVersion:1,needId:'n',price:100,quantity:1,landingUrl:'https://example.com/buy',purchaseReason:'이유',priceApproved:true}});
await call(growth,{action:'save_mission',id:'m',input:{title:'미션',offerId:'o',offerVersion:1,assignee:'담당',deadline:'2099-01-01',nextAction:'판매',channel:'storefront',budget:1000,lossLimit:1000,stopRule:'한도',fulfillmentOwner:'배송'}});
check((await call(operations,{action:'create_inventory',input:{sku:'SKU',locationId:'store',unit:'piece',onHand:50},observedAt:before,evidenceRef:'stock-evidence'})).status===200,'shared stock');
let designDigest='a'.repeat(64);const now=new Date().toISOString();
const expServer=await load('lib/growth-experiment-server.ts'),hash=await load('lib/storefront-orders.ts');
const experiment=(p={})=>({id:'exp',brandId:'brand',campaignId:'c',storeId:'store',version:2,status:'registered',input:{title:'실험',mode:'confirm',aa:false,missionId:'m',missionVersion:1,offerId:'o',offerVersion:1,channel:'storefront',interventionRefs:[{kind:'offer',id:'o',version:1}],minEffect:0.05,metric:'paid_orders',assignmentUnit:'pseudonymous_visitor',treatmentShare:0.5,lowerBound:0,upperBound:1,minSamplePerArm:30,startAt:before,endAt:new Date(Date.parse(now)-3600000).toISOString(),maturityDays:0,stopRule:'중단',...p.input},seed:'x',registration:{digest:designDigest,at:before,by:owner,refs:[{kind:'offer',id:'o',version:1}]},...p.top});
async function seedCanonical(e){
 e={...e,registration:{...e.registration,digest:await hash.storefrontDigest({id:e.id,input:e.input}),refs:e.input.interventionRefs}};await put('growth_experiment',e.id,e,'c');
 for(const arm of ['control','treatment'])for(let i=0;i<100;i++){
  const id=e.id+'-'+arm+'-'+i,orderId='order-'+id;
  if(arm==='treatment')await put('store_order',orderId,{id:orderId,storeId:'store',campaignId:'c',version:1,orderDate:before.slice(0,10),status:'paid',paidAmount:100,refundAmount:0,costs:{unitCost:10}},'store');
  await put('growth_experiment_unit',id,{id,designId:e.id,brandId:'brand',campaignId:'c',version:1,unitHash:id,arm,observation:{exposed:true,trackingComplete:true,contaminated:false,orderIds:arm==='treatment'?[orderId]:[]}},'c');
 }
 await expServer.saveGrowthExperiment({owner,id:owner,role:'owner'},c,{action:'analyse',id:e.id,campaignVersion:1,requestId:randomUUID()});
 return {e,r:await server.readRecord(owner,'growth_experiment_result',e.id+':1')};
}
const canonical=await seedCanonical(experiment());designDigest=canonical.e.registration.digest;
const result=(n,status='supported',p={})=>({...canonical.r,id:`exp:${n}`,analysisNumber:n,analysis:{...canonical.r.analysis,status},...p});
const post=(data,headers=h)=>call(route,{requestId:randomUUID(),...data},headers),get=(headers=h)=>route.GET(new Request('https://agency.test/api/growth/expansion?campaignId=c',{headers})).then(unpack);
const proposal=(p={})=>({missionId:'m',missionVersion:1,experimentId:'exp',analysisNumber:1,nextBudget:1200,addQuantity:10,rationale:'확증 개선 근거',...p});
check((await post({action:'propose',id:'x1',input:proposal()},{})).status===401,'auth');check((await post({action:'propose',id:'x1',input:proposal()},{...h,origin:'https://evil.test'})).status===403,'CSRF');
let r=await post({action:'propose',id:'x1',input:proposal({nextBudget:1300})});check(r.status===409&&/20%/.test(r.body.error),'more than 20% blocked');
r=await post({action:'propose',id:'x1',input:proposal({addQuantity:60})});check(r.status===409&&/재고/.test(r.body.error),'stock capacity blocked');
await put('growth_experiment_result','exp:1',result(1,'exploratory'),'c');check((await post({action:'propose',id:'x1',input:proposal()})).status===409,'exploratory result blocked');
await put('growth_experiment_result','exp:1',result(1,'inconclusive'),'c');check((await post({action:'propose',id:'x1',input:proposal()})).status===409,'inconclusive blocked');
await put('growth_experiment_result','exp:1',result(1,'supported',{recordedAt:new Date(Date.now()-91*86400000).toISOString()}),'c');check((await post({action:'propose',id:'x1',input:proposal()})).status===409,'stale evidence blocked');
await put('growth_experiment_result','exp:1',result(1),'c');
await put('growth_experiment','exp',experiment({input:{aa:true}}),'c');check((await post({action:'propose',id:'x1',input:proposal()})).status===409,'A/A cannot scale');
await put('growth_experiment','exp',experiment({input:{mode:'explore'}}),'c');check((await post({action:'propose',id:'x1',input:proposal()})).status===409,'explore cannot scale');
await put('growth_experiment','exp',experiment({input:{channel:'organic'}}),'c');check((await post({action:'propose',id:'x1',input:proposal()})).status===409,'other channel cannot scale');
await put('growth_experiment','exp',experiment({input:{interventionRefs:[{kind:'offer',id:'o',version:2}]}}),'c');check((await post({action:'propose',id:'x1',input:proposal()})).status===409,'changed intervention ref out of scope');
await put('growth_experiment','exp',experiment(),'c');await put('growth_experiment_result','exp:2',result(2,'inconclusive'),'c');check((await post({action:'propose',id:'x1',input:proposal()})).status===409,'superseded analysis blocked');sql.prepare("DELETE FROM records WHERE id=?").run(`${owner}:growth_experiment_result:exp:2`);
r=await post({action:'propose',id:'x1',input:proposal()});check(r.status===200&&r.body.mayExecute===false,'valid proposal');
r=await get();let p=r.body.proposals[0];check(p.status==='proposed'&&p.assessment.allowed&&p.assessment.increase===200&&r.body.autoScale===false,'view shows allowed increase');
const canonicalOrder=await server.readRecord(owner,'store_order','order-exp-treatment-0');
await put('store_order',canonicalOrder.id,{...canonicalOrder,version:2,refundAmount:100},'store');
check(!(await get()).body.proposals[0].assessment.allowed,'canonical refund invalidates proposal view');
check((await post({action:'approve_reserve',id:'x1',expectedVersion:1,authorityId:'auth',authorityVersion:1})).status===409,'canonical refund blocks generic reservation');
await put('store_order',canonicalOrder.id,canonicalOrder,'store');
// admin cannot reserve
await put('growth_stop','global',{status:'stopped'});check((await post({action:'approve_reserve',id:'x1',expectedVersion:1,authorityId:'auth',authorityVersion:1})).status===409,'global stop blocks reservation');sql.prepare("DELETE FROM records WHERE kind='growth_stop'").run();
const session='b'.repeat(64);env.AUTH_MODE='email';env.AUTH_ORIGIN='https://agency.test';sql.prepare('INSERT INTO auth_users(id,email,workspace_owner,role,status,created_at) VALUES(?,?,?,?,?,?)').run('first-owner','owner@test.invalid',owner,'admin','active',0);sql.prepare('INSERT INTO auth_users(id,email,workspace_owner,role,status,created_at) VALUES(?,?,?,?,?,?)').run('adm','adm@test.invalid',owner,'admin','active',1);sql.prepare('INSERT INTO auth_sessions VALUES(?,?,?,?)').run(createHash('sha256').update(session).digest('hex'),'adm',Date.now()+60000,Date.now());
{const x=await post({action:'approve_reserve',id:'x1',expectedVersion:1,authorityId:'auth',authorityVersion:1},{cookie:'__Host-collective_session='+session,origin:'https://agency.test'});check(x.status===403,'admin cannot approve scale');}env.AUTH_MODE='legacy';
check((await post({action:'approve_reserve',id:'x1',expectedVersion:1,authorityId:'auth',authorityVersion:9})).status===409,'authority CAS');
await put('growth_experiment_result','exp:1',result(1,'supported',{inputDigest:'changed'}),'c');check((await post({action:'approve_reserve',id:'x1',expectedVersion:1,authorityId:'auth',authorityVersion:1})).status===409,'evidence changed after proposal');await put('growth_experiment_result','exp:1',result(1),'c');
const ledger=()=>sql.prepare("SELECT data FROM records WHERE kind='growth_commitment'").all().map(x=>JSON.parse(x.data));const beforeLedger=ledger().length;
r=await post({action:'approve_reserve',id:'x1',expectedVersion:1,authorityId:'auth',authorityVersion:1});check(r.status===200,'owner reserves');
const scale=ledger().find(x=>x.id==='m:scale:x1');check(ledger().length===beforeLedger+1&&scale.commitment.action.operation==='scale'&&scale.commitment.action.budget==='confirmed'&&scale.commitment.reservedAmount===200&&scale.commitment.action.evidence.id==='exp:1','confirmed scale commitment with verified evidence');
const grant=JSON.parse(sql.prepare("SELECT data FROM records WHERE kind='growth_authority'").get().data);check(!grant.input.allowedActions.includes('scale'),'standing mandate not widened');
check((await post({action:'approve_reserve',id:'x1',expectedVersion:2,authorityId:'auth',authorityVersion:1})).status===409,'no double reservation');
// cap still enforced for a second proposal
await put('growth_mission','m2',{id:'m2',brandId:'brand',campaignId:'c',campaignVersion:1,version:1,input:{title:'큰 미션',offerId:'o',offerVersion:1,assignee:'담당',deadline:'2099-01-01',nextAction:'판매',channel:'storefront',budget:50000,lossLimit:1000,stopRule:'한도',fulfillmentOwner:'배송'},updatedAt:now,updatedBy:owner,requestDigest:'x'},'c');
await seedCanonical({...experiment(),id:'exp2',input:{...experiment().input,missionId:'m2'}});
r=await post({action:'propose',id:'x2',input:proposal({missionId:'m2',experimentId:'exp2',nextBudget:60000})});check(r.status===200,'second proposal within 20%');r=await post({action:'approve_reserve',id:'x2',expectedVersion:1,authorityId:'auth',authorityVersion:1});check(r.status===409&&/한도/.test(r.body.error),'signed caps still enforced');
check((await post({action:'withdraw',id:'x2',expectedVersion:1})).status===200,'withdraw proposal');
// reconcile scale commitment
r=await get();p=r.body.proposals.find(x=>x.id==='x1');check(p.commitment.status==='reserved'&&p.commitment.version===1,'commitment shown');
check((await post({action:'reconcile',id:'x1',expectedVersion:2,commitmentVersion:1,outcome:'observed',reconciliation:{mode:'release',actualAmount:0,actualLoss:0,evidenceRef:'rec-1',note:'미집행 확인',noExecution:true,noOutstandingObligations:true}})).status===409,'release requires failed outcome');
r=await post({action:'reconcile',id:'x1',expectedVersion:2,commitmentVersion:1,outcome:'observed',reconciliation:{mode:'final',actualAmount:180,actualLoss:40,evidenceRef:'rec-1',note:'정산 확인',noExecution:false,noOutstandingObligations:true}});check(r.status===200,'final reconcile');
r=await get();p=r.body.proposals.find(x=>x.id==='x1');check(p.commitment.status==='reconciled'&&p.commitment.actualAmount===180&&p.reconciliation.status==='reconciled','reconciled scale commitment');
check((await post({action:'reconcile',id:'x1',expectedVersion:3,commitmentVersion:2,outcome:'observed',reconciliation:{mode:'final',actualAmount:100,actualLoss:40,evidenceRef:'rec-2',note:'재확인',noExecution:false,noOutstandingObligations:true}})).status===409,'cumulative amount cannot decrease');
check((await get({'oai-authenticated-user-id':'other'})).status===404,'owner isolation');
const base={input:proposal(),evidence:{experimentId:'exp',analysisNumber:1,status:'supported',interval:[0.1,0.2],minEffect:0.05,metric:'paid_orders',channel:'storefront',offerId:'o',offerVersion:1,designDigest,inputDigest:'i',recordedAt:now,refs:[]},latestAnalysis:1,experiment:{status:'registered',mode:'confirm',aa:false,missionId:'m',registrationDigest:designDigest},refsCurrent:true,mission:{version:1,channel:'storefront',offerId:'o',budget:1000},offer:{version:1,unitContribution:70},stock:{status:'known',available:50},now:Date.now()};
check(pure.assessExpansion(base).allowed,'pure allowed');check(!pure.assessExpansion({...base,offer:{version:1,unitContribution:null}}).allowed,'unknown contribution blocks');check(!pure.assessExpansion({...base,offer:{version:1,unitContribution:-1}}).allowed,'negative contribution blocks');check(!pure.assessExpansion({...base,mission:{...base.mission,budget:0}}).allowed,'zero base budget cannot scale');check(!pure.assessExpansion({...base,stock:{status:'held',available:null}}).allowed,'held stock blocks');
console.log(JSON.stringify({passed}));
