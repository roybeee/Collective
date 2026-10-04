// 실패 근거 기반 최적화 후보 샌드박스(G2-15/16): 예산 상한·동결·오프라인 평가≠매출 개선·판매 확증·소유자 채택·되돌림. 인증 mocked.
import assert from 'node:assert/strict';import {randomUUID,createHash} from 'node:crypto';import {testRuntime} from './helpers/runtime.mjs';
const {load,sql,env}=testRuntime(async()=>{throw Error('external forbidden')});
const server=await load('lib/server.ts'),route=await load('app/api/growth/optimization/route.ts');let passed=0;const check=(v,n)=>{assert.ok(v,n);passed++};
const owner='owner',c={id:'c',brandId:'b',storeId:'s',version:1,status:'active'},h={'oai-authenticated-user-id':owner,origin:'https://agency.test'};
const put=(kind,id,data,parent='')=>server.recordStatement(owner,kind,id,data,parent).run();await put('campaign','c',c);
const past=new Date(Date.now()-3600000).toISOString(),later=()=>new Date(Date.now()+1000).toISOString();
await put('growth_experiment_result','exp-fail:1',{id:'exp-fail:1',designId:'exp-fail',brandId:'b',campaignId:'c',analysisNumber:1,analysis:{status:'rejected'}},'c');
await put('growth_experiment_result','exp-good:1',{id:'exp-good:1',designId:'exp-good',brandId:'b',campaignId:'c',analysisNumber:1,analysis:{status:'supported'}},'c');
await put('growth_lesson_application','ap-ok',{id:'ap-ok',brandId:'b',campaignId:'c',version:2,outcome:{result:'success'}},'c');
const cand=(p={})=>({failureKind:'experiment_result',failureId:'exp-fail:1',failureVersion:1,failureSummary:'상세 문구 실험이 악화 근거',candidateKind:'prompt_unit',targetRef:'channel.commerce',proposal:'혜택보다 배송 확실성을 먼저 제시',tokenBudget:100000,krwBudget:10000,...p});
const unpack=async r=>({status:r.status,body:await r.json()}),post=(data,headers=h)=>route.POST(new Request('https://agency.test/api/x',{method:'POST',headers:{...headers,'content-type':'application/json'},body:JSON.stringify({campaignId:'c',campaignVersion:1,expectedVersion:0,requestId:randomUUID(),...data})})).then(unpack),get=(headers=h)=>route.GET(new Request('https://agency.test/api/growth/optimization?campaignId=c',{headers})).then(unpack);
check((await post({action:'save_candidate',id:'o1',input:cand()},{})).status===401,'auth');check((await post({action:'save_candidate',id:'o1',input:cand()},{...h,origin:'https://evil.test'})).status===403,'CSRF');
check((await post({action:'save_candidate',id:'o1',input:cand({tokenBudget:1000000})})).status===400,'token budget cap');check((await post({action:'save_candidate',id:'o1',input:cand({krwBudget:1000000})})).status===400,'krw budget cap');
check((await post({action:'save_candidate',id:'o1',input:cand({failureId:'exp-good:1'})})).status===409,'supported result is not a failure');check((await post({action:'save_candidate',id:'o1',input:cand({failureKind:'lesson_application',failureId:'ap-ok',failureVersion:2})})).status===409,'successful lesson application is not a failure');
check((await post({action:'save_candidate',id:'o1',input:cand({failureId:'missing'})})).status===409,'unknown failure');

const promptBody='배송 조건과 구매 판단 근거를 먼저 설명한다.',promptHash=createHash('sha256').update(JSON.stringify(promptBody)).digest('hex'),promptVersion='channel.commerce@'+promptHash.slice(0,12);
await put('prompt_version',promptVersion,{id:promptVersion,unit:'channel.commerce',body:promptBody,sha256:promptHash});
await put('eval_case','case',{id:'case',role:'content',kind:'role',label:'합성 봉인',set:'sealed',request:{campaign:{channels:'커머스'}},expectations:{prohibitedTerms:[]},createdAt:past});
const evaluation={candidateVersionId:promptVersion,caseIds:['case']};
let r=await post({action:'save_candidate',id:'o1',input:cand()});check(r.status===200,'draft saved');
check((await post({action:'record_offline',id:'o1',expectedVersion:1,evalRunId:'run',verdict:'pass'})).status===409,'offline before freeze rejected');
r=await post({action:'freeze',id:'o1',expectedVersion:1,evaluation});check(r.status===200,'frozen');check((await post({action:'save_candidate',id:'o1',expectedVersion:2,input:cand({proposal:'바꾼 제안'})})).status===409,'frozen candidate immutable');
await put('eval_run','run-old',{id:'run-old',status:'completed',results:[],tokenBudget:1000,usedTokens:900,createdAt:past});await put('eval_run','run-big',{id:'run-big',status:'completed',results:[],tokenBudget:90000,usedTokens:80000,createdAt:later()});await put('eval_run','run-run',{id:'run-run',status:'running',results:[],tokenBudget:1000,usedTokens:10,createdAt:later()});await put('eval_run','run-ok',{id:'run-ok',status:'completed',results:[],tokenBudget:40000,usedTokens:30000,createdAt:later()});
check((await post({action:'record_offline',id:'o1',expectedVersion:2,evalRunId:'run-old',verdict:'pass'})).status===409,'eval before freeze rejected');check((await post({action:'record_offline',id:'o1',expectedVersion:2,evalRunId:'run-big',verdict:'pass'})).status===409,'eval over budget rejected');check((await post({action:'record_offline',id:'o1',expectedVersion:2,evalRunId:'run-run',verdict:'pass'})).status===409,'running eval rejected');
await put('eval_run','run-run',{id:'run-run',status:'cancelled',results:[],tokenBudget:1000,usedTokens:10,createdAt:later()});
r=await post({action:'start_evaluation',id:'o1',expectedVersion:2,confirmed:true,krwCapNotEnforced:true});check(r.status===409,'paid Q execution requires enforced KRW cap');
// Legacy accepted intent fixture: recovery remains supported after new paid starts are blocked.
const prior=await server.readRecord(owner,'growth_optimization','o1'),intent={label:'growth-opt:legacy',at:new Date().toISOString(),by:owner,tokenBudget:100000,krwBudget:10000,krwCapNotEnforced:true};
const legacy={...prior,version:3,evaluation:{...prior.evaluation,intent}};await put('growth_optimization','o1',legacy,'c');await put('growth_optimization_history','o1:3',legacy,'c');
await (await load('lib/eval-server.ts')).evalAction(owner,{action:'start_run',label:intent.label,variant:'pair',pair:{unit:prior.evaluation.pair.unit,candidateVersionId:promptVersion},caseIds:['case'],tokenBudget:100000},{owner,id:owner,role:'owner',email:null});
const queued=(await server.listRecords(owner,'eval_run')).find(x=>x.label?.startsWith('growth-opt:'));
const gateway={eval:{hash:'e'},operational:{hash:'o'}},done={...queued,status:'completed',usedTokens:100,gatewaySnapshot:gateway,gatewaySnapshotEnd:gateway,results:queued.results.map(x=>({...x,status:'completed',model:'synthetic',graders:[{id:'input_budget',status:'pass'}]}))};await put('eval_run',queued.id,done);
r=await post({action:'record_offline',id:'o1',expectedVersion:3,evalRunId:queued.id,verdict:'fail'});check(r.status===200,'offline pass recorded');
r=await get();let x=r.body.candidates[0];check(x.status.offline==='pass'&&x.status.sales==='not_linked'&&!x.status.adoptable&&/매출 개선이 아닙니다/.test(x.status.reason)&&r.body.mayPromote===false&&r.body.mayChangeGraders===false,'offline pass is not sales improvement');
await put('growth_experiment','exp-val',{id:'exp-val',brandId:'b',campaignId:'c',status:'registered',input:{mode:'confirm',aa:false},registration:{digest:'d',at:past}},'c');check((await post({action:'link_sales',id:'o1',expectedVersion:4,experimentId:'exp-val'})).status===409,'experiment registered before freeze rejected');
await put('growth_experiment','exp-val',{id:'exp-val',brandId:'b',campaignId:'c',status:'registered',input:{mode:'explore',aa:false},registration:{digest:'d',at:later()}},'c');check((await post({action:'link_sales',id:'o1',expectedVersion:4,experimentId:'exp-val'})).status===409,'explore experiment rejected');
const ref={kind:'publication_link',id:'link',version:1},designInput={title:'합성 확증',mode:'confirm',aa:false,hypothesis:'구매 증가',missionId:'mission',missionVersion:1,offerId:'offer',offerVersion:1,channel:'organic',interventionRefs:[ref],minEffect:0.05,metric:'paid_orders',assignmentUnit:'pseudonymous_visitor',treatmentShare:0.5,lowerBound:0,upperBound:1,minSamplePerArm:30,startAt:new Date(Date.now()-86400000).toISOString(),endAt:past,maturityDays:0,stopRule:'한도',intervention:'안내'},digest=await (await load('lib/storefront-orders.ts')).storefrontDigest({id:'exp-val',input:designInput});
await put('artifact','art',{id:'art',campaignId:'c',version:1,promptVersion});await put('growth_publication_link','link',{id:'link',brandId:'b',campaignId:'c',version:1,status:'published',snapshot:{publication:{copy:{artifactId:'art',artifactVersion:1}}}},'c');
await put('growth_experiment','exp-val',{id:'exp-val',brandId:'b',campaignId:'c',storeId:'s',version:2,status:'registered',input:designInput,registration:{digest,at:later(),refs:[ref]}},'c');r=await post({action:'link_sales',id:'o1',expectedVersion:4,experimentId:'exp-val'});check(r.status===200,'sales validation linked');
check((await post({action:'adopt',id:'o1',expectedVersion:5,ref:'prompt-stage-1'})).status===409,'not adoptable before sales result');
// Real canonical analysis, rather than a fabricated supported result.
await put('store','s',{id:'s',brandId:'b'},'b');
const growthRow=(id,input)=>({id,brandId:'b',campaignId:'c',campaignVersion:1,version:1,input,factRefs:[],evidenceRefs:[]});
await put('growth_catalog','catalog',growthRow('catalog',{sku:'SKU',title:'상품',price:100,unitCost:10,variableCost:0,stock:0,stockUnit:'piece',currency:'KRW',taxBasis:'included',fulfillment:'배송',refunds:'반품',rightsConfirmed:true,factIds:[],validUntil:'2099-01-01'}),'c');
await put('growth_offer','offer',growthRow('offer',{title:'오퍼',catalogId:'catalog',catalogVersion:1,needId:'',price:100,quantity:1,landingUrl:'https://example.com/item',purchaseReason:'안내',priceApproved:true}),'c');
await put('growth_mission','mission',growthRow('mission',{title:'미션',offerId:'offer',offerVersion:1,channel:'organic',budget:0,lossLimit:0,deadline:'2099-01-01',assignee:'담당',nextAction:'검증',stopRule:'중단',fulfillmentOwner:'배송'}),'c');
for(const arm of ['control','treatment'])for(let i=0;i<100;i++){
 const unitId=arm+'-'+i,orderId='order-'+unitId;
 if(arm==='treatment')await put('store_order',orderId,{id:orderId,storeId:'s',campaignId:'c',version:1,orderDate:new Date(Date.now()-7200000).toISOString().slice(0,10),status:'paid',paidAmount:100,refundAmount:0,costs:{unitCost:10}},'s');
 await put('growth_experiment_unit',unitId,{id:unitId,designId:'exp-val',brandId:'b',campaignId:'c',version:1,unitHash:unitId,arm,observation:{exposed:true,trackingComplete:true,contaminated:false,orderIds:arm==='treatment'?[orderId]:[]}},'c');
}
const experimentServer=await load('lib/growth-experiment-server.ts');
const analysis=await experimentServer.saveGrowthExperiment({owner,id:owner,role:'owner'},c,{action:'analyse',id:'exp-val',campaignVersion:1,requestId:randomUUID()});
check(analysis.status==='supported','server analysis supports synthetic effect');
const originalOrder=await server.readRecord(owner,'store_order','order-treatment-0'),originalUnit=await server.readRecord(owner,'growth_experiment_unit','treatment-0');
const drifts=[['refund','store_order',originalOrder,{...originalOrder,version:2,refundAmount:100}],['cost','store_order',originalOrder,{...originalOrder,version:2,costs:{unitCost:90}}],['withdrawal','growth_experiment_unit',originalUnit,{...originalUnit,version:2,observation:null}]];
for(const [label,kind,original,changed] of drifts){
 await put(kind,original.id,changed,kind==='store_order'?'s':'c');
 const stale=await get();check(!stale.body.candidates[0].status.adoptable,label+' canonical drift removes adoptable view');
 const blocked=await post({action:'adopt',id:'o1',expectedVersion:5,ref:'prompt-stage-1'});check(blocked.status===409,label+' canonical drift blocks adoption');
 await put(kind,original.id,original,kind==='store_order'?'s':'c');
}
const originalArtifact=await server.readRecord(owner,'artifact','art');
await put('artifact','art',{...originalArtifact,version:2});
const artifactChanged=await get();check(!artifactChanged.body.candidates[0].status.adoptable,'artifact revision drift removes adoptable view');
check((await post({action:'adopt',id:'o1',expectedVersion:5,ref:'prompt-stage-1'})).status===409,'artifact revision drift blocks adoption');
await put('artifact','art',originalArtifact);
r=await get();check(r.body.candidates[0].status.adoptable,'adoptable after offline pass and supported sales');
sql.prepare('INSERT INTO auth_users(id,email,workspace_owner,role,status,created_at) VALUES(?,?,?,?,?,?)').run('first','o@test.invalid',owner,'admin','active',0);sql.prepare('INSERT INTO auth_users(id,email,workspace_owner,role,status,created_at) VALUES(?,?,?,?,?,?)').run('adm','a@test.invalid',owner,'admin','active',1);const session='c'.repeat(64);sql.prepare('INSERT INTO auth_sessions VALUES(?,?,?,?)').run(createHash('sha256').update(session).digest('hex'),'adm',Date.now()+60000,Date.now());env.AUTH_MODE='email';env.AUTH_ORIGIN='https://agency.test';
check((await post({action:'adopt',id:'o1',expectedVersion:5,ref:'prompt-stage-1'},{cookie:'__Host-collective_session='+session,origin:'https://agency.test'})).status===403,'admin cannot adopt');env.AUTH_MODE='legacy';
r=await post({action:'adopt',id:'o1',expectedVersion:5,ref:'prompt-stage-1'});check(r.status===200,'owner adopts with existing-path reference');
check((await post({action:'rollback',id:'o1',expectedVersion:6,reason:'',evidenceRef:'rb'})).status===400,'rollback needs reason');r=await post({action:'rollback',id:'o1',expectedVersion:6,reason:'매출 악화',evidenceRef:'rb-1'});check(r.status===200,'rollback recorded');
r=await get();check(r.body.candidates[0].stage==='rolled_back'&&r.body.history.length===7,'history kept (7 versions)');
check(sql.prepare("SELECT COUNT(*) n FROM records WHERE kind LIKE 'prompt_%'").get().n===1,'no prompt registry records written beyond fixture');
check((await get({'oai-authenticated-user-id':'other'})).status===404,'owner isolation');
console.log(JSON.stringify({passed}));
