// Real SQLite; external calls forbidden. Automatic observations never replace operator judgments.
import assert from 'node:assert/strict';
import {testRuntime} from './helpers/runtime.mjs';
const {load,sql}=testRuntime(async()=>{throw Error('external forbidden')});
const s=await load('lib/server.ts'),pure=await load('lib/growth-decisions.ts'),hash=await load('lib/storefront-orders.ts');
const who={owner:'owner',id:'daily',role:'owner',email:null},c={id:'c',brandId:'b',storeId:'s',version:1,status:'active'};
const put=(kind,id,x,parent=c.id)=>s.recordStatement(who.owner,kind,id,x,parent).run();
await put('campaign',c.id,c);await put('store','s',{id:'s',brandId:'b'},'b');
const lesson={id:'lesson',brandId:'b',campaignId:'c',campaignVersion:1,version:1,input:{...pure.emptyLessonInput(),title:'배송 안내',method:'배송 안내 확인',hypothesis:'문의 부담 감소',scope:'현재 캠페인',falsificationRule:'문의 증가 시 재검토',lossLimit:0,sourceEvidence:'합성 관측',counterEvidence:'표본 한계',expiresAt:'2099-12-31',state:'reusable',outcome:'success',evidenceLevel:'operational_observation',testPlan:'비교 관측',testResult:'운영 관측',nextAction:'재시험',assignee:'담당',dueAt:'2099-12-31'}};
await put('growth_lesson',lesson.id,lesson);
const target={id:'mission',brandId:'b',campaignId:'c',campaignVersion:1,version:1,status:'observed',receipt:{note:'RAW PRIVATE TEXT'}};await put('growth_mission',target.id,target);
const application={id:'apply',brandId:'b',campaignId:'c',version:1,input:{lessonId:lesson.id,lessonVersion:1,targetKind:'mission',targetId:target.id,targetVersion:1,howApplied:'배송 안내 추가',expectedCheck:'문의 감소',checkAt:'2020-01-01'},lessonDigest:await hash.storefrontDigest({id:lesson.id,version:1,input:lesson.input}),outcome:null,createdAt:new Date().toISOString()};await put('growth_lesson_application',application.id,application);
const helper=await load('lib/growth-lesson-outcomes-server.ts');
let passed=0;const check=(x,label)=>{assert.ok(x,label);passed++};
const read=()=>s.readRecord(who.owner,'growth_lesson_outcome',application.id);
check((await helper.collectGrowthLessonOutcomes(who,c)).collected===1,'first collection');
let auto=await read();check(auto.state==='current'&&auto.observation.status==='observed'&&auto.lessonCausalStatus==='not_measured','operational status only');
check(!JSON.stringify(auto).includes('RAW PRIVATE TEXT'),'raw source prose excluded');
check((await helper.collectGrowthLessonOutcomes(who,c)).collected===0,'same evidence causes no write');
const manual={...application,version:2,outcome:{result:'failure',note:'operator result'}};await put('growth_lesson_application',application.id,manual);
await helper.collectGrowthLessonOutcomes(who,c);check(JSON.stringify(await s.readRecord(who.owner,'growth_lesson_application',application.id))===JSON.stringify(manual),'manual outcome and version preserved');
await put('growth_mission',target.id,{...target,version:2});
let live=await helper.lessonOutcomeView(who,c,[manual]);check(live.get(application.id).sourceStatus==='changed','GET invalidates before daily');
await helper.collectGrowthLessonOutcomes(who,c);check((await read()).state==='changed'&&(await read()).observation===null,'target revision never automatically inherited');
await put('growth_mission',target.id,target);await helper.collectGrowthLessonOutcomes(who,c);check((await read()).state==='current','current evidence can recover');
await put('growth_lesson',lesson.id,{...lesson,input:{...lesson.input,expiresAt:'2000-01-01'}});await helper.collectGrowthLessonOutcomes(who,c);check((await read()).state==='changed','same-version expiry/digest change invalidated');
await put('growth_lesson',lesson.id,lesson);
sql.exec("CREATE TRIGGER fail_outcome BEFORE INSERT ON records WHEN NEW.kind='growth_lesson_outcome_history' BEGIN SELECT RAISE(ABORT,'atomic test'); END;");
const before=await read();await assert.rejects(()=>helper.collectGrowthLessonOutcomes(who,c));passed++;check(JSON.stringify(await read())===JSON.stringify(before),'atomic history/current rollback');sql.exec('DROP TRIGGER fail_outcome');
await helper.collectGrowthLessonOutcomes(who,c);check((await read()).state==='current','retry recovery');
await assert.rejects(()=>helper.collectGrowthLessonOutcomes({...who,role:'member'},c));passed++;
await assert.rejects(()=>helper.collectGrowthLessonOutcomes(who,{...c,version:2}));passed++;
await put('growth_mission',target.id,{...target,brandId:'other'});await helper.collectGrowthLessonOutcomes(who,c);check((await read()).state==='changed','foreign brand rejected');await put('growth_mission',target.id,target);
for(let i=0;i<22;i++)await put('growth_lesson_application','z'+String(i).padStart(2,'0'),{...application,id:'z'+String(i).padStart(2,'0')});
let chunk=await helper.collectGrowthLessonOutcomes(who,c);check(chunk.processed===20&&chunk.remaining,'bounded first chunk');chunk=await helper.collectGrowthLessonOutcomes(who,c);check(chunk.processed===3&&!chunk.remaining,'cursor reaches remaining applications');
check(sql.prepare("SELECT count(*) n FROM records WHERE kind='growth_lesson_outcome_history'").get().n>23,'immutable change history');


// Canonical experiment inputs are recalculated from the real order ledger, not inferred from revenue.
const exp=await load('lib/growth-experiment-server.ts'),ep=await load('lib/growth-experiment.ts'),catalog=await load('lib/growth-catalog.ts'),mission=await load('lib/growth-mission.ts');
const base={brandId:'b',campaignId:'c',campaignVersion:1,version:1};
await put('growth_catalog','cat',{...base,id:'cat',input:{...catalog.emptyCatalogInput(),title:'상품',sku:'sku',validUntil:'2099-12-31'}});
await put('growth_offer','offer',{...base,id:'offer',input:{...catalog.emptyOfferInput(),title:'오퍼',catalogId:'cat',catalogVersion:1}});
await put('growth_mission',target.id,{...target,input:{...mission.emptyMissionInput(),title:'미션',offerId:'offer',offerVersion:1,channel:'storefront'}});
const now=Date.now(),iso=x=>new Date(x).toISOString(),design={title:'합성 실험',mode:'confirm',aa:false,hypothesis:'상품 안내',missionId:target.id,missionVersion:1,offerId:'offer',offerVersion:1,channel:'storefront',intervention:'상품 안내',interventionRefs:[{kind:'offer',id:'offer',version:1}],assignmentUnit:'pseudonymous_visitor',treatmentShare:0.5,metric:'paid_orders',lowerBound:0,upperBound:1,minEffect:0.05,minSamplePerArm:30,startAt:iso(now-86400000),endAt:iso(now-3600000),maturityDays:0,stopRule:'중단'};
const e={...base,id:'exp',storeId:'s',status:'registered',input:design,registration:{digest:await hash.storefrontDigest({id:'exp',input:design}),refs:design.interventionRefs,at:iso(now-172800000)},seed:'synthetic'};await put('growth_experiment','exp',e);
const order={id:'order',storeId:'s',campaignId:'c',version:1,orderDate:iso(now-7200000).slice(0,10),status:'paid',paidAmount:1000,refundAmount:0,costs:{foodCost:1}};await put('store_order',order.id,order,'s');
const unit={id:'u',designId:e.id,brandId:'b',campaignId:'c',version:1,unitHash:'a'.repeat(64),arm:'control',observation:{exposed:true,trackingComplete:true,contaminated:false,orderIds:['order']}};await put('growth_experiment_unit',unit.id,unit);
let eb=await exp.readExperimentOutcomeBasis(who.owner,c,e.id);check(!eb.current&&!eb.latest,'unanalyzed experiment remains pending');
const analysis=ep.analyseExperiment(design,[{arm:'control',exposed:true,trackingComplete:true,contaminated:false,value:1}],now,1),result={id:'exp:1',brandId:'b',campaignId:'c',designId:e.id,analysisNumber:1,designDigest:e.registration.digest,inputDigest:eb.inputDigest,analysis};await put('growth_experiment_result',result.id,result);
eb=await exp.readExperimentOutcomeBasis(who.owner,c,e.id);check(eb.current&&eb.latest.id===result.id,'latest analysis matches canonical basis');
const ea={...application,id:'exp-application',input:{...application.input,targetKind:'experiment',targetId:'exp'}};await put('growth_lesson_application',ea.id,ea);
await helper.collectGrowthLessonOutcomes(who,c);let ev=(await helper.lessonOutcomeView(who,c,[ea])).get(ea.id);check(ev?.observation?.kind==='experiment'&&ev.lessonCausalStatus==='not_measured','experiment observation is not lesson causality');
await put('store_order',order.id,{...order,refundAmount:1000,version:2},'s');check(!(await exp.readExperimentOutcomeBasis(who.owner,c,e.id)).current,'refund/order revision invalidates old analysis');ev=(await helper.lessonOutcomeView(who,c,[ea])).get(ea.id);check(ev.sourceStatus==='changed','canonical drift appears before next collection');
await put('store_order',order.id,order,'s');await put('growth_experiment_result','exp:2',{...result,id:'exp:2',analysisNumber:2});check((await helper.lessonOutcomeView(who,c,[ea])).get(ea.id).sourceStatus==='changed','new latest result invalidates old collected reference');
await put('growth_experiment','exp',{...e,registration:{...e.registration,digest:'f'.repeat(64)}});await assert.rejects(()=>exp.readExperimentOutcomeBasis(who.owner,c,e.id));passed++;await put('growth_experiment','exp',e);
await put('growth_experiment','exp',{...e,registration:{...e.registration,refs:[]}});await assert.rejects(()=>exp.readExperimentOutcomeBasis(who.owner,c,e.id));passed++;await put('growth_experiment','exp',e);
await put('growth_catalog','cat',{...base,id:'cat',input:{...catalog.emptyCatalogInput(),title:'상품',sku:'sku',validUntil:'2000-01-01'}});await assert.rejects(()=>exp.readExperimentOutcomeBasis(who.owner,c,e.id));passed++;
await put('growth_catalog','cat',{...base,id:'cat',input:{...catalog.emptyCatalogInput(),title:'상품',sku:'sku',validUntil:'2099-12-31'}});
await put('growth_offer','offer',{...base,id:'offer',version:2,input:{...catalog.emptyOfferInput(),title:'오퍼',catalogId:'cat',catalogVersion:1}});await assert.rejects(()=>exp.readExperimentOutcomeBasis(who.owner,c,e.id));passed++;
// Soft history caps restrict new intake, never recovery of already collected observations.
for(let i=0;i<10000;i++)sql.prepare('INSERT INTO records(id,owner,kind,parent_id,data,updated_at) VALUES(?,?,?,?,?,?)').run('history-cap-'+i,who.owner,'growth_lesson_outcome_history',c.id,'{}',iso(now));
await put('growth_mission',target.id,{...target,version:2});for(let i=0;i<3;i++)await helper.collectGrowthLessonOutcomes(who,c);check((await read()).state==='changed','history cap cannot strand existing evidence');


check((await helper.lessonOutcomeHistory(who,c)).hasMore,'history reads remain bounded after recovery cap');
await put('growth_landing_revision','land',{...base,id:'land',status:'applied',applied:{method:'manual_attested',reason:'RAW PRIVATE TEXT'}});
await put('growth_demand','demand',{...base,id:'demand',input:{steps:[{performanceStatus:'observed',performanceNote:'RAW PRIVATE TEXT'}]}});
// Remove synthetic history-cap fillers so new operational applications can be collected.
sql.prepare("DELETE FROM records WHERE id LIKE 'history-cap-%'").run();
for(const [kind,id] of [['landing_revision','land'],['demand','demand']])await put('growth_lesson_application',id,{...application,id,input:{...application.input,targetKind:kind,targetId:id}});
for(let i=0;i<3;i++)await helper.collectGrowthLessonOutcomes(who,c);
for(const id of ['land','demand']){const row=await s.readRecord(who.owner,'growth_lesson_outcome',id);check(row.observation.kind==='operational'&&row.lessonCausalStatus==='not_measured'&&!JSON.stringify(row).includes('RAW PRIVATE TEXT'),'operational adapter excludes raw prose and causality');}
const daily=await load('lib/growth-daily-server.ts');
// Stop suppresses new draft actions; read-only evidence collection still finishes all chunks.
await put('growth_stop','global',{id:'global',version:1,status:'stopped',reason:'test',updatedAt:iso(now),updatedBy:who.id},'');
await put('growth_mission',target.id,{...target,input:{...mission.emptyMissionInput(),title:'미션',offerId:'offer',offerVersion:1,channel:'storefront'}});
await put('growth_lesson_outcome_cursor',c.id,{id:c.id,after:null});
const firstDaily=await daily.runGrowthDaily(who.owner,'operator',Date.now());check(firstDaily.runStatus==='partial','daily leaves unfinished lesson chunk pending');
const nextDaily=await daily.runGrowthDaily(who.owner,'operator',Date.now());check(nextDaily.runStatus==='completed','daily resumes lesson cursor within same day '+JSON.stringify(nextDaily)+' '+JSON.stringify(sql.prepare("SELECT data FROM records WHERE kind='growth_daily_run'").all()));


const evidence=await load('lib/growth-lesson-evidence-server.ts');
await put('growth_offer','offer',{...base,id:'offer',input:{...catalog.emptyOfferInput(),title:'오퍼',catalogId:'cat',catalogVersion:1}});
await put('growth_catalog','cat',{...base,id:'cat',input:{...catalog.emptyCatalogInput(),title:'상품',sku:'sku',validUntil:'2000-01-01'}});
const linkedLesson={...lesson,input:{...lesson.input,missionId:target.id,missionVersion:1}};
check(!(await evidence.readGrowthLessonEvidence(who.owner,c,[linkedLesson]))[0].assessment.canReuse,'expired upstream catalog invalidates reusable lesson without version change');
console.log(JSON.stringify({passed,sqlite:'real',externalCalls:0}));
