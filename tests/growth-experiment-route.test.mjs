// 채널 공통 판매 실험(G2-08/09/10): 사전등록·설계 동결·결정적 배정·비구매자 분모·SRM·오염·성숙·분석. 인증 mocked, 메모리 SQLite real, 외부 0.
import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';import {testRuntime} from './helpers/runtime.mjs';
const {load,sql}=testRuntime(async()=>{throw Error('external forbidden')});
const s=await load('lib/server.ts'),route=await load('app/api/growth/experiments/route.ts'),growth=await load('app/api/growth/route.ts'),pure=await load('lib/growth-experiment.ts');let passed=0;const check=(v,n)=>{assert.ok(v,n);passed++};
const owner='owner',headers={'oai-authenticated-user-id':owner,origin:'https://agency.test'},c={id:'c',brandId:'b',storeId:'store',version:1,status:'active'};
const put=(kind,id,data,parent='')=>s.recordStatement(owner,kind,id,data,parent).run();const H=3600000,now=Date.now(),iso=t=>new Date(t).toISOString(),day=iso(now).slice(0,10);
await put('campaign','c',c);await put('store','store',{id:'store',brandId:'b',name:'합성 매장'},'b');
const g=async(action,id,input)=>{const r=await growth.POST(new Request('https://agency.test/api/growth',{method:'POST',headers,body:JSON.stringify({action,id,input,campaignId:'c',campaignVersion:1,expectedVersion:0})}));assert.equal(r.status,200,JSON.stringify(await r.clone().json()))};
await g('save_catalog','cat',{sku:'EXP-SKU',title:'상품',price:10000,unitCost:3000,variableCost:1000,stock:0,stockUnit:'piece',currency:'KRW',taxBasis:'included',fulfillment:'배송',refunds:'반품',rightsConfirmed:true,factIds:[],validUntil:iso(now+30*86400000).slice(0,10)});
await g('save_offer','offer',{title:'오퍼',catalogId:'cat',catalogVersion:1,needId:'',price:10000,quantity:1,landingUrl:'https://shop.example.com/p',purchaseReason:'이유',priceApproved:true});
await g('save_mission','m',{title:'미션',offerId:'offer',offerVersion:1,assignee:'담당',deadline:iso(now+30*86400000).slice(0,10),nextAction:'판매',channel:'storefront',budget:0,lossLimit:0,stopRule:'한도',fulfillmentOwner:'배송'});
const design=(p={})=>({title:'상세 문구 실험',mode:'confirm',aa:false,hypothesis:'배송 문구가 구매를 늘린다',missionId:'m',missionVersion:1,offerId:'offer',offerVersion:1,channel:'storefront',intervention:'배송 문구 교체',interventionRefs:[{kind:'offer',id:'offer',version:1}],assignmentUnit:'pseudonymous_visitor',treatmentShare:0.5,metric:'paid_orders',lowerBound:0,upperBound:1,minEffect:0.05,minSamplePerArm:30,startAt:iso(now+H),endAt:iso(now+10*H),maturityDays:0,stopRule:'손실 한도 도달 시 중단',...p});
const post=async(b,h=headers)=>{const r=await route.POST(new Request('https://agency.test/api/growth/experiments',{method:'POST',headers:h,body:JSON.stringify({campaignId:'c',campaignVersion:1,requestId:randomUUID(),...b})}));return {status:r.status,body:await r.json()}};
const get=async(h=headers)=>{const r=await route.GET(new Request('https://agency.test/api/growth/experiments?campaignId=c',{headers:h}));return {status:r.status,body:await r.json()}};
const shift=(id,patch)=>{const row=sql.prepare('SELECT data FROM records WHERE id=?').get(`${owner}:growth_experiment:${id}`),d=JSON.parse(row.data);d.input={...d.input,...patch};sql.prepare('UPDATE records SET data=? WHERE id=?').run(JSON.stringify(d),`${owner}:growth_experiment:${id}`)};
check((await post({action:'save_design',id:'x',expectedVersion:0,input:design()},{})).status===401,'auth');check((await post({action:'save_design',id:'x',expectedVersion:0,input:design()},{...headers,origin:'https://evil.test'})).status===403,'CSRF');
check((await post({action:'save_design',id:'x',expectedVersion:0,input:design({upperBound:5})})).status===400,'paid_orders bounds 0~1');check((await post({action:'save_design',id:'x',expectedVersion:0,input:design({hypothesis:'연락 a@b.com'})})).status===400,'PII rejected');check((await post({action:'save_design',id:'x',expectedVersion:0,input:design({treatmentShare:0.95})})).status===400,'share bounds');
const once={action:'save_design',id:'e1',expectedVersion:0,input:design({startAt:iso(now-H)}),requestId:randomUUID()};let r=await post(once);check(r.status===200,'draft saved');check((await post(once)).body.duplicate,'UUID replay');
check((await post({action:'register',id:'e1',expectedVersion:1})).status===409,'registration after start rejected');
check((await post({action:'save_design',id:'e1',expectedVersion:1,input:design({interventionRefs:[{kind:'landing_revision',id:'nope',version:1}]})})).status===200,'draft revised');check((await post({action:'register',id:'e1',expectedVersion:2})).status===409,'missing intervention ref rejected');
await post({action:'save_design',id:'e1',expectedVersion:2,input:design({channel:'organic'})});check((await post({action:'register',id:'e1',expectedVersion:3})).status===409,'channel must match mission');
await post({action:'save_design',id:'e1',expectedVersion:3,input:design()});r=await post({action:'register',id:'e1',expectedVersion:4});check(r.status===200&&r.body.version===5,'registered before start');
check((await post({action:'save_design',id:'e1',expectedVersion:5,input:design({minEffect:0.01})})).status===409,'registered design is frozen');
check((await post({action:'assign_units',id:'e1',units:['visitor-0001']})).status===409,'no assignment before start');
shift('e1',{startAt:iso(now-H),endAt:iso(now+H)});
check((await post({action:'assign_units',id:'e1',units:['a@b.com-visitor']})).status===400,'email unit key rejected');
const keys=Array.from({length:120},(_,i)=>`visitor-${String(i).padStart(4,'0')}`);r=await post({action:'assign_units',id:'e1',units:keys});check(r.status===200&&r.body.assigned.length===120,'assigned');const arms=Object.fromEntries(r.body.assigned.map((a,i)=>[keys[i],a]));
r=await post({action:'assign_units',id:'e1',units:keys.slice(0,10)});check(r.body.assigned.every((a,i)=>a.existing&&a.arm===arms[keys[i]].arm),'deterministic reassignment');
const t=keys.filter(k=>arms[k].arm==='treatment'),ctrl=keys.filter(k=>arms[k].arm==='control');check(t.length>=35&&ctrl.length>=35,'balanced assignment '+t.length);
check(!JSON.stringify((await get()).body).includes('"seed"'),'seed hidden from view');check(!JSON.stringify(sql.prepare("SELECT data FROM records WHERE kind='growth_experiment_unit'").all()).includes('visitor-0001'),'raw unit key not stored');
const order=(id,date=day,patch={})=>put('store_order',id,{id,storeId:'store',campaignId:'c',orderDate:date,status:'paid',paidAmount:10000,refundAmount:0,costs:{foodCost:3000,packagingCost:0,fees:0,deliveryCost:0,benefitCost:0},version:1,...patch},'store');
const observe=async(key,orderIds=[],p={})=>{const h=arms[key].unitHash,u=JSON.parse(sql.prepare('SELECT data FROM records WHERE id=?').get(`${owner}:growth_experiment_unit:e1:${h.slice(0,40)}`).data);return post({action:'record_observation',id:'e1',expectedVersion:u.version,observation:{unitHash:h,exposed:true,trackingComplete:true,contaminated:false,orderIds,evidenceRef:'obs-1',...p}})};
await order('o-out','2020-01-01');check((await observe(t[0],['o-out'])).status===409,'order outside window rejected');
await order('o-t0');check((await observe(t[0],['o-t0'],{exposed:false})).status===409,'unexposed unit cannot hold orders');
check((await observe(t[0],['o-t0'])).status===200,'observation recorded');check((await observe(t[1],['o-t0'])).status===409,'order reused by another unit rejected');
check((await post({action:'analyse',id:'e1'})).status===409,'no analysis while collecting');
for(const [i,k] of t.entries()){if(i===0)continue;await order('o-t'+i);await observe(k,['o-t'+i]);}for(const k of ctrl)await observe(k);
r=await get();check(r.body.experiments[0].preview.status==='collecting','preview collecting');
shift('e1',{endAt:iso(now-60000)});r=await post({action:'analyse',id:'e1'});check(r.status===200&&r.body.status==='supported','non-buyer zeros included, supported');
check((await post({action:'analyse',id:'e1'})).status===409,'same input cannot be re-analysed');
r=await get();const latest=r.body.experiments[0].latest;check(latest.analysis.analysed.control===ctrl.length&&latest.analysis.statistics.alpha===0.025&&latest.analysis.causalScope.includes('storefront'),'analysis lineage and alpha spending');check(r.body.mayScale===false,'analysis never scales');
await order('o-t1',day,{refundAmount:10000,status:'refunded'});r=await post({action:'analyse',id:'e1'});check(r.status===200&&r.body.analysisNumber===2,'refund maturity changes input → new analysis version');
// contamination invalidates
await post({action:'save_design',id:'e2',expectedVersion:0,input:design({mode:'explore',interventionRefs:[]})});await post({action:'register',id:'e2',expectedVersion:1});shift('e2',{startAt:iso(now-H),endAt:iso(now+H)});
const ek=Array.from({length:40},(_,i)=>`explore-${String(i).padStart(4,'0')}`);r=await post({action:'assign_units',id:'e2',units:ek});
for(const [i,a] of r.body.assigned.entries()){const u=JSON.parse(sql.prepare('SELECT data FROM records WHERE id=?').get(`${owner}:growth_experiment_unit:e2:${a.unitHash.slice(0,40)}`).data);await post({action:'record_observation',id:'e2',expectedVersion:u.version,observation:{unitHash:a.unitHash,exposed:true,trackingComplete:true,contaminated:i<4,orderIds:[],evidenceRef:'obs'}})}
shift('e2',{endAt:iso(now-60000)});r=await post({action:'analyse',id:'e2'});check(r.body.status==='invalid','contamination above 5% invalid');
// explore mode
await post({action:'save_design',id:'e3',expectedVersion:0,input:design({mode:'explore',interventionRefs:[]})});await post({action:'register',id:'e3',expectedVersion:1});shift('e3',{startAt:iso(now-H),endAt:iso(now+H)});
r=await post({action:'assign_units',id:'e3',units:ek.map(k=>k+'x')});for(const a of r.body.assigned){const u=JSON.parse(sql.prepare('SELECT data FROM records WHERE id=?').get(`${owner}:growth_experiment_unit:e3:${a.unitHash.slice(0,40)}`).data);await post({action:'record_observation',id:'e3',expectedVersion:u.version,observation:{unitHash:a.unitHash,exposed:true,trackingComplete:true,contaminated:false,orderIds:[],evidenceRef:'obs'}})}
shift('e3',{endAt:iso(now-60000)});r=await post({action:'analyse',id:'e3'});check(r.body.status==='exploratory','explore gives no causal verdict');
check((await post({action:'cancel',id:'e3',expectedVersion:2})).status===200,'cancel registered');check((await post({action:'analyse',id:'e3'})).status===409,'cancelled cannot analyse');
// pure checks
const D=pure.parseExperimentDesign(design());
check(pure.sampleRatio(100,300,0.5).mismatch&&!pure.sampleRatio(150,150,0.5).mismatch,'SRM detection');
const unitsOf=(n,arm,value,p={})=>Array.from({length:n},()=>({arm,exposed:true,trackingComplete:true,contaminated:false,value,...p}));
check(pure.analyseExperiment({...D,aa:true,endAt:iso(now-1),startAt:iso(now-H)},[...unitsOf(60,'control',0),...unitsOf(60,'treatment',0)],now,1).status==='aa_passed','A/A passes with no difference');
check([pure.analyseExperiment({...D,endAt:iso(now-1),startAt:iso(now-H)},[...unitsOf(60,'control',0),...unitsOf(40,'treatment',1),...unitsOf(20,'treatment',1,{trackingComplete:false})],now,1)].every(x=>x.analysed.treatment===40&&x.excluded.trackingIncomplete===20),'incomplete tracking excluded, counted');
check(pure.analyseExperiment({...D,endAt:iso(now-1),startAt:iso(now-H)},[...unitsOf(60,'control',0),...unitsOf(40,'treatment',1),...unitsOf(40,'treatment',1,{trackingComplete:false})],now,1).status==='invalid','tracking incomplete above 20% invalid');
check(pure.analyseExperiment({...D,metric:'contribution_per_unit',lowerBound:-100000,upperBound:100000,endAt:iso(now-1),startAt:iso(now-H)},[...unitsOf(50,'control',0),...unitsOf(50,'treatment',null)],now,1).status==='invalid','unknown contribution >10% invalid, not zero-filled');
check(pure.analyseExperiment({...D,endAt:iso(now-1),startAt:iso(now-H),maturityDays:3},[],now,1).status==='maturing','maturity wait');
check((await get({'oai-authenticated-user-id':'other'})).status===404,'owner isolation');
console.log(JSON.stringify({passed}));
