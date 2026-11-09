// 홀드아웃 증분(C7): 순수 이중차분·결정론 부트스트랩이 알려진 lift를 신뢰구간 안에 돌려주고, 자료 부족 경로와 라벨이 있으며, 서버가 장부 일별 합계로 캠페인당 1행을 저장한다. 외부 호출 0.
import assert from 'node:assert/strict';import {testRuntime} from './helpers/runtime.mjs';
const {load,sql}=testRuntime(async()=>{throw new Error('외부 호출 금지')});
const pure=await load('lib/incrementality.ts'),server=await load('lib/server.ts'),route=await load('app/api/measurements/route.ts');
let passed=0;const check=(v,n)=>{assert.ok(v,n);passed++};const plain=v=>JSON.parse(JSON.stringify(v));
const LABEL='관찰 비교이며 인과 증명이 아닙니다';
// --- 순수: 합성 자료 -----------------------------------------------------------------------------
const lcg=seed=>{let s=seed>>>0;return()=>{s=(s*1664525+1013904223)>>>0;return s/4294967296}};
const rnd=lcg(7),days=(start,n)=>Array.from({length:n},(_,i)=>pure.addDays(start,i));
const pre=days('2026-09-03',28),camp=days('2026-10-01',28);
const daily=[];
for(const store of ['t1','t2','c1','c2','c3']){const treated=store.startsWith('t'),base=store==='t2'?140000:100000;
 for(const [list,isCamp] of [[pre,false],[camp,true]])for(const day of list){const season=isCamp?8000:0,noise=Math.round((rnd()-0.5)*6000),lift=treated&&isCamp?20000:0;daily.push({storeId:store,day,net:base+season+noise+lift})}}
let res=plain(pure.computeIncrementality({periodStart:'2026-10-01',periodEnd:'2026-10-28',treatedStoreIds:['t1','t2'],controlStoreIds:['c1','c2','c3'],daily}));
check(res.label===LABEL&&res.method==='difference_in_differences','label and method are present');
check(res.prePeriod.start==='2026-09-03'&&res.prePeriod.end==='2026-09-30'&&res.prePeriod.days===28&&res.period.days===28,'pre-period is the same length right before the campaign');
check(res.stores.treated===2&&res.stores.control===3,'store counts');
check(Math.abs(res.liftPerStoreDay-20000)<2500,'DiD recovers the planted lift of 20,000 per store-day (seasonal +8,000 removed by the control)');
check(res.ci&&res.ci.low<=20000&&20000<=res.ci.high&&res.ci.level===0.95&&res.ci.samples===400,'bootstrap CI contains the true lift');
check(res.verdict==='positive'&&Math.abs(res.liftTotal-res.liftPerStoreDay*2*28)<1&&res.liftRate>0.1&&res.liftRate<0.25,'verdict positive; total and relative lift follow the point estimate');
const again=plain(pure.computeIncrementality({periodStart:'2026-10-01',periodEnd:'2026-10-28',treatedStoreIds:['t2','t1'],controlStoreIds:['c3','c1','c2'],daily:[...daily].reverse()}));
check(JSON.stringify(again)===JSON.stringify(res),'deterministic: same inputs in any order give the same CI');
const flat=plain(pure.computeIncrementality({periodStart:'2026-10-01',periodEnd:'2026-10-28',treatedStoreIds:['t1'],controlStoreIds:['c1'],daily:daily.filter(d=>d.day<'2026-10-01'||!d.storeId.startsWith('t')).concat(daily.filter(d=>d.day>='2026-10-01'&&d.storeId==='t1').map(d=>({...d,net:d.net-20000})))}));
check(flat.verdict==='inconclusive'&&flat.ci.low<0&&flat.ci.high>0,'no planted lift is inconclusive, not positive');
const short=plain(pure.computeIncrementality({periodStart:'2026-10-01',periodEnd:'2026-10-10',treatedStoreIds:['t1'],controlStoreIds:['c1'],daily}));
check(short.verdict==='insufficient'&&short.reasons.some(x=>x.includes('14일'))&&short.liftPerStoreDay===null&&short.ci===null&&short.label===LABEL,'fewer than 14 pre days is insufficient and still labelled');
check(plain(pure.computeIncrementality({periodStart:'2026-10-01',periodEnd:'2026-10-28',treatedStoreIds:['t1'],controlStoreIds:[],daily})).reasons.some(x=>x.includes('대조')),'no control store is insufficient');
check(plain(pure.computeIncrementality({periodStart:'2026-10-01',periodEnd:'2026-10-28',treatedStoreIds:['t1'],controlStoreIds:['t1'],daily})).verdict==='insufficient','overlapping treated and control is insufficient');
check(plain(pure.computeIncrementality({periodStart:'2026-10-01',periodEnd:'2026-10-28',treatedStoreIds:['t1'],controlStoreIds:['zz'],daily})).reasons.some(x=>x.includes('장부 순매출이 없습니다')),'a control store without ledger data is insufficient');
check(plain(pure.computeIncrementality({periodStart:'2026-10-28',periodEnd:'2026-10-01',treatedStoreIds:['t1'],controlStoreIds:['c1'],daily})).verdict==='insufficient','reversed period is insufficient');
// --- 서버: 장부에서 계산해 캠페인당 1행 ----------------------------------------------------------
const owner='incr-owner',h={'oai-authenticated-user-id':owner,origin:'https://agency.test'};
await server.recordStatement(owner,'brand','b',{id:'b',name:'브랜드'}).run();
for(const s of ['s1','s2','c1'])await server.recordStatement(owner,'store',s,{id:s,brandId:'b',name:s,version:1,status:'active'},'b').run();
await server.recordStatement(owner,'store','x',{id:'x',brandId:'other',name:'x',version:1,status:'active'},'other').run();
await server.recordStatement(owner,'campaign','camp',{id:'camp',brandId:'b',title:'캠페인',storeId:'s1',startDate:'2026-10-01',endDate:'2026-10-28',status:'approved',version:1}).run();
let k=0;const addOrder=(storeId,day,paid,refund=0)=>server.recordStatement(owner,'store_order',`o${k++}`,{id:`o${k}`,storeId,source:'pos',orderNumber:String(k),orderDate:day,mode:'hall',status:refund===paid&&paid>0?'refunded':'paid',paidAmount:paid,refundAmount:refund,costs:{foodCost:null,packagingCost:null,fees:null,deliveryCost:null,benefitCost:null},channel:'unknown',experimentId:'',attributionEvidence:'',note:'',version:1,createdAt:'2026-10-01T00:00:00Z',updatedAt:'2026-10-01T00:00:00Z'},storeId).run();
for(const day of pre){await addOrder('s1',day,100000);await addOrder('s2',day,50000);await addOrder('s2',day,50000);await addOrder('c1',day,80000)}
for(const day of camp){await addOrder('s1',day,130000);await addOrder('s2',day,130000,0);await addOrder('c1',day,90000);await addOrder('c1',day,10000,10000)}
const post=async(data,headers=h)=>{const r=await route.POST(new Request('https://agency.test/api/measurements',{method:'POST',headers:{...headers,'content-type':'application/json'},body:JSON.stringify(data)}));return {status:r.status,body:await r.json()}};
const get=async(cid,headers=h)=>{const r=await route.GET(new Request('https://agency.test/api/measurements?campaignId='+cid,{headers}));return {status:r.status,body:await r.json()}};
check((await get('camp')).body.incrementality===null,'no result before computing');
check((await post({action:'incrementality',campaignId:'camp',controlStoreIds:['x']})).status===400,'stores of another brand are refused');
check((await post({action:'incrementality',campaignId:'camp',treatedStoreIds:['s1'],controlStoreIds:['s1']})).status===400,'overlap refused');
check((await post({action:'incrementality',campaignId:'camp',controlStoreIds:['c1'],periodEnd:'2099-01-01'})).status===400,'future end refused');
check((await post({action:'incrementality',campaignId:'camp',controlStoreIds:['c1']},{...h,origin:'https://evil.test'})).status===403,'CSRF');
let r=await post({action:'incrementality',campaignId:'camp',treatedStoreIds:['s1','s2'],controlStoreIds:['c1']});
check(r.status===200&&r.body.recorded===true&&r.body.incrementality.version===1,'computed and stored');
const rec=r.body.incrementality,out=rec.result;
check(rec.periodStart==='2026-10-01'&&rec.periodEnd==='2026-10-28'&&out.prePeriod.start==='2026-09-03','campaign dates default from the campaign');
check(out.means.treatedPre===100000&&out.means.treatedCampaign===130000&&out.means.controlPre===80000&&out.means.controlCampaign===90000,'ledger day totals (net of refunds) feed the means');
check(out.liftPerStoreDay===20000&&out.liftTotal===20000*2*28&&out.verdict==='positive'&&out.ci.low===20000&&out.ci.high===20000&&out.label===LABEL,'noise-free ledger gives exactly +20,000 per store-day with a degenerate CI');
r=await post({action:'incrementality',campaignId:'camp',controlStoreIds:['c1']});check(r.body.incrementality.version===2&&r.body.incrementality.treatedStoreIds[0]==='s1'&&r.body.incrementality.result.stores.treated===1,'treated defaults to the campaign store; recompute bumps the version');
check(sql.prepare("SELECT COUNT(*) n, MAX(parent_id) p FROM records WHERE kind='incrementality_result'").get().n===1&&sql.prepare("SELECT parent_id p FROM records WHERE kind='incrementality_result'").get().p==='camp','one row per campaign under the campaign');
check((await get('camp')).body.incrementality.version===2&&(await get('camp',{'oai-authenticated-user-id':'other'})).body.incrementality===null,'GET returns the stored result only to its owner');
check((await post({action:'incrementality',campaignId:'nope',controlStoreIds:['c1']})).status===404,'unknown campaign');
console.log(JSON.stringify({passed}));
