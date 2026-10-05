import assert from 'node:assert/strict';
import {testRuntime} from './helpers/runtime.mjs';
const calls=[];const rt=testRuntime(async()=>{calls.push(1);throw new Error('external forbidden')});
const p=await rt.load('lib/product-research/server-policy.ts'),s=await rt.load('lib/product-research/server-store.ts');
let passed=0;const check=(v,m)=>{assert.ok(v,m);passed++};const owner='stored-policy',now=Date.parse('2026-10-05T00:00:00Z');
const snapshot={id:'good',sourceId:'own_sales',fetchedAt:'2026-10-01T00:00:00Z',status:'ok',observations:[],request:{}};
for(const row of [snapshot,{...snapshot,id:'blocked',sourceId:'youtube_data'},{...snapshot,id:'future',fetchedAt:'2099-01-01T00:00:00Z'}])await s.putStatement(owner,s.K.snapshot,row.id,row,row.sourceId).run();
const card={id:'card',productId:'product',subScores:[{evidence:['good']}],total:90};
check((await p.scoreResearchPolicy(owner,card,now)).allowed,'allowed complete card');
for(const refs of [['good','blocked'],['good','missing'],['future'],[]])check(!(await p.scoreResearchPolicy(owner,{...card,subScores:[{evidence:refs}]},now)).allowed,'never retain mixed/missing card');
check(!(await p.snapshotIdsResearchPolicy('other',['good'],now)).allowed,'owner isolation');
await s.putStatement(owner,s.K.score,'card',card).run();await s.putStatement(owner,s.K.product,'product',{id:'product',scoreId:'card'}).run();
check((await p.productResearchPolicy(owner,{scoreId:'card'},now)).allowed,'product validates exact card');
check(!(await p.briefResearchPolicy(owner,{productIds:['product'],claims:[{citations:['blocked']}]},now)).allowed,'brief blocked citation');
check(!(await p.briefResearchPolicy(owner,{productIds:['product'],claims:[]},now)).allowed,'legacy brief no citations held');
const pipeline=await rt.load('lib/product-research/server-pipeline.ts');
check(pipeline.material([snapshot,{...snapshot,id:'yt',sourceId:'youtube_data'}],now).snapshots.length===1,'new material excludes forbidden sources');
check(pipeline.material([{...snapshot,fetchedAt:'invalid'}],now).snapshots.length===0,'invalid time excluded');
check(pipeline.recomputePlan(new Date(now)).every(x=>!['youtube_data','naver_searchad_keyword','naver_shop_search'].includes(x.sourceId)),'recompute plan allowed only');
check(pipeline.backtestPlan(now,4).every(x=>!['youtube_data','naver_searchad_keyword','naver_shop_search'].includes(x.sourceId)),'backtest plan allowed only');

check(!(await p.productResearchPolicy(owner,{scoreId:'card',listings:[{sourceId:'naver_shop_search'}]},now)).allowed,'old copied product listing held');
check(!(await p.briefResearchPolicy(owner,{productIds:['product'],claims:[{citations:['good']}]},now)).allowed,'legacy copied brief requires frozen card revision');
const briefModule=await rt.load('lib/product-research/server-brief.ts');
await s.putStatement(owner,s.K.score,'card',{...card,subScores:[{evidence:['blocked']}]}).run();
await assert.rejects(()=>briefModule.briefInputs(owner,['product']),e=>e.status===409);passed++;
await assert.rejects(()=>briefModule.modelBrief(owner,{productIds:['product'],question:'검토',requestId:'test'},null,new Date(now).toISOString(),0),e=>e.status===409&&/YouTube/.test(e.message));passed++;
check(calls.length===0,'blocked model makes zero provider calls');

const server=await rt.load('lib/server.ts'),growth=await rt.load('lib/growth-workspace-server.ts');
const campaign={id:'c',brandId:'b',version:1,status:'active'};
await server.recordStatement(owner,'growth_signal','sig',{id:'sig',campaignId:'c',brandId:'b',campaignVersion:1,version:1,input:{title:'가설',sourceUrl:'https://example.com/source',observedAt:'2026-01-01',expiresAt:'2099-01-01',sourceType:'market',summary:'원본 확인 필요',sampleSize:null},productResearch:{decisionId:'d',scoreCardId:'card',productId:'product',snapshotIds:['blocked']}},'c').run();
let view=await growth.growthView(owner,campaign,true);check(view.signals[0].sourceReadiness.status==='held'&&view.signals[0].evidence.status==='insufficient','growth mixed provenance held');
await s.putStatement(owner,s.K.score,'card',card).run();
await server.recordStatement(owner,'growth_signal','sig',{...view.signals[0],productResearch:{decisionId:'d',scoreCardId:'card',productId:'product',snapshotIds:['missing']}},'c').run();
view=await growth.growthView(owner,campaign,true);check(view.signals[0].sourceReadiness.status==='held','growth missing original held');
check(pipeline.backtestFromSnapshots([],4,0.3,new Date(now).toISOString()).result.sourcePolicyVersion===p.SOURCE_POLICY_VERSION,'new backtest marker');

const prior={sourcePolicyVersion:p.SOURCE_POLICY_VERSION,submissionId:'prior',providerId:'run',productIds:['product'],question:'검토',rows:[{snapshotId:'good'}],startedAt:new Date(now).toISOString(),scoreCardIds:['prior-card']};
await s.putStatement(owner,s.K.score,'prior-card',{...card,id:'prior-card',subScores:[{evidence:['good','blocked']}]}).run();
await assert.rejects(()=>briefModule.modelBrief(owner,{productIds:['product'],question:'검토',requestId:'test'},prior,new Date(now).toISOString(),0),e=>e.status===409&&/YouTube/.test(e.message));passed++;

const keywordSnapshot={...snapshot,request:{keywordGroups:'소스:소스'},observations:[{subject:{type:'keyword',text:'소스'},metric:'sales_estimate',value:1,period:{from:'2026-09-01',to:'2026-09-01'}}]};
const computed=pipeline.computeProducts(pipeline.material([keywordSnapshot],now),[],[],new Set(),new Date(now).toISOString());
check(computed.groups.length>0&&computed.groups.every(g=>g.sourcePolicyVersion===p.SOURCE_POLICY_VERSION&&g.sourceSnapshotIds.includes('good')),'new groups retain allowed snapshot provenance');
check(calls.length===0,'external zero');console.log(JSON.stringify({passed,sqlite:'real',http:'mocked',externalCalls:0}));
