import assert from 'node:assert/strict';
import {testRuntime} from './helpers/runtime.mjs';
const calls=[];const rt=testRuntime(async(...args)=>{calls.push(args);throw new Error('network forbidden')});
const policy=await rt.load('lib/product-research/source-policy.ts');
const collect=await rt.load('lib/product-research/server-collect.ts'),store=await rt.load('lib/product-research/server-store.ts'),c=await rt.load('lib/product-research/collectors/index.ts');
let passed=0;const check=(v,label)=>{assert.ok(v,label);passed++};
const now=Date.parse('2026-10-05T00:00:00Z'),deps={now:()=>new Date(now),fetch:async()=>{calls.push('fetch');throw new Error('forbidden')}};
for(const id of ['youtube_data','naver_searchad_keyword','naver_shop_search',undefined,null,'future_source'])check(!policy.researchSourcePolicy(id).allowed,`blocked ${id}`);
check(policy.researchSourcePolicy('naver_datalab_search').allowed,'DataLab remains allowed');
check(policy.researchSourcePolicy('own_sales').allowed,'own sales remains allowed');
for(const id of ['youtube_data','naver_searchad_keyword','naver_shop_search'])check(!policy.snapshotResearchPolicy({sourceId:id,fetchedAt:new Date(now).toISOString()},now).allowed,'fresh forbidden snapshot remains unusable');
for(const snapshot of [undefined,{sourceId:'missing',fetchedAt:new Date(now).toISOString()},{sourceId:'naver_datalab_search',fetchedAt:'2026-02-30T00:00:00Z'},{sourceId:'naver_datalab_search',fetchedAt:'garbage'},{sourceId:'naver_datalab_search',fetchedAt:null},{sourceId:'naver_datalab_search',fetchedAt:new Date(now+1).toISOString()}])check(!policy.snapshotResearchPolicy(snapshot,now).allowed,'missing/unknown/invalid/future denied');
check(policy.snapshotResearchPolicy({sourceId:'naver_datalab_search',fetchedAt:new Date(now).toISOString()},now).allowed,'exact current timestamp allowed');
for(const fetchedAt of ['2026-10-05','2026-10-05T00:00:00','2026-09-31T00:00:00Z','2026-10-04T24:00:00Z'])check(!policy.snapshotResearchPolicy({sourceId:'own_sales',fetchedAt},now).allowed,'non-ISO and overflow timestamp rejected');
check(policy.snapshotResearchPolicy({sourceId:'own_sales',fetchedAt:'2024-02-29T09:00:00+09:00'},now).allowed,'valid leap day and explicit offset preserved');
check(!policy.snapshotResearchPolicy({sourceId:'own_sales',fetchedAt:new Date(now).toISOString()},NaN).allowed,'invalid clock fails closed');
const owner='policy-owner';
const flags=await rt.load('lib/feature-flags.ts');await flags.setFeatureFlag(owner,{flag:'product_research_collect',enabled:true},{id:owner,email:null});
for(const sourceId of ['youtube_data','naver_searchad_keyword','naver_shop_search']){await assert.rejects(()=>collect.collectNow(owner,sourceId,deps,'unused-token'),e=>e.status===400&&e.message===policy.researchSourcePolicy(sourceId).reason);passed++}
for(const key of ['youtube','naver_searchad','naver_api_hub'])await store.putStatement(owner,store.K.credential,key,{secret:'unreadable-policy-fixture'}).run();
await store.putStatement(owner,store.K.keywordGroup,'legacy',{id:'legacy',label:'LEGACY_FORBIDDEN_TERM',keywords:['LEGACY_FORBIDDEN_TERM']}).run();
await store.putStatement(owner,store.K.keywordGroup,'marked_bad',{id:'marked_bad',label:'BAD_BASIS_TERM',keywords:['BAD_BASIS_TERM'],sourcePolicyVersion:'md-policy-2026-10-05',sourceSnapshotIds:['youtube-basis']}).run();
await store.putStatement(owner,store.K.snapshot,'youtube-basis',{id:'youtube-basis',sourceId:'youtube_data',fetchedAt:new Date(0).toISOString()}).run();
await store.putStatement(owner,store.K.snapshot,'allowed-basis',{id:'allowed-basis',sourceId:'naver_datalab_search',fetchedAt:new Date(0).toISOString()}).run();
await store.putStatement(owner,store.K.keywordGroup,'marked_ok',{id:'marked_ok',label:'TRUSTED_ALLOWED_TERM',keywords:['TRUSTED_ALLOWED_TERM'],sourcePolicyVersion:'md-policy-2026-10-05',sourceSnapshotIds:['allowed-basis']}).run();
const plan=await collect.buildPlan(owner,collect.emptyCollectState());check(!JSON.stringify(plan).includes('LEGACY_FORBIDDEN_TERM')&&!JSON.stringify(plan).includes('BAD_BASIS_TERM')&&JSON.stringify(plan).includes('TRUSTED_ALLOWED_TERM'),'stored legacy or forbidden keyword groups cannot become DataLab payload');check(plan.length>0&&plan.every(s=>policy.researchSourcePolicy(s.sourceId).allowed),'new plan excludes blocked stored keys');
for(const step of [{sourceId:'youtube_data',op:'yt_search',keyword:'소스'},{sourceId:'youtube_data',op:'yt_track',chunk:0},{sourceId:'naver_searchad_keyword',op:'keywordstool',keywords:['소스']},{sourceId:'naver_shop_search',op:'shop',keyword:'소스'},{sourceId:'unknown',op:'yt_search',keyword:'소스'},{sourceId:'naver_datalab_search',op:'yt_search',keyword:'소스'}]){
 const state=collect.emptyCollectState();state.plan=[step];state.pending=[step];const token=await store.acquireResearchLock(owner,0);try{const result=await collect.runSteps(owner,state,2,deps,token);check(result.calls===0&&state.pending.length===0&&state.errors[step.sourceId]?.code==='source_policy_blocked','persisted source/op rejected before credential/quota')}finally{await store.releaseResearchLock(owner,token)}
}
check((await store.quotaUsed(owner,'youtube_data',new Date(now)))===0&&(await store.quotaUsed(owner,'naver_searchad_keyword',new Date(now)))===0,'blocked jobs reserve no quota');
check((await store.quotaUsed(owner,'naver_datalab_search',new Date(now)))===0,'spoofed operation reserves no allowed-source quota');
for(const step of [{sourceId:'naver_datalab_search',op:'datalab',groups:[{groupName:'LEGACY_COPIED_TERM',keywords:['LEGACY_COPIED_TERM']}]},{sourceId:'naver_datalab_shopping',op:'datalab_shopping',categoryCode:'50000006',keywords:['LEGACY_COPIED_TERM']}]){
 const legacy=collect.emptyCollectState();legacy.plan=[step];legacy.pending=[step];const token=await store.acquireResearchLock(owner,0);try{await collect.runSteps(owner,legacy,2,deps,token);check(legacy.errors[step.sourceId]?.code==='source_policy_outdated'&&legacy.pending.length===0,'old DataLab plan and retry payload are held before quota or HTTP')}finally{await store.releaseResearchLock(owner,token)}
 check(await store.quotaUsed(owner,step.sourceId,new Date(now))===0,'old DataLab payload consumes zero quota');
}
const yt={kind:'youtube',apiKey:'synthetic-key'},sa={kind:'naver_searchad',apiKey:'synthetic',secretKey:'test'.repeat(8),customerId:'1234567'};
for(const run of [()=>c.discoverYoutubeVideos(yt,{keyword:'소스',publishedAfter:'2026-10-01T00:00:00Z'},deps),()=>c.trackYoutubeVideos(yt,['abcdefghij1'],deps),()=>c.collectSearchadKeywords(sa,['소스'],deps)]){await assert.rejects(run,e=>e.code==='not_allowed');passed++}
check(calls.length===0,'all forbidden collection paths make zero provider calls');
check(plan.every(step=>step.sourcePolicyVersion===policy.SOURCE_POLICY_VERSION&&Array.isArray(step.sourceSnapshotIds)),'new plans carry current policy and frozen keyword lineage');
await store.putStatement(owner,store.K.snapshot,'allowed-basis',{id:'allowed-basis',sourceId:'youtube_data',fetchedAt:new Date(0).toISOString()}).run();
const changed=collect.emptyCollectState();changed.plan=plan.filter(s=>s.sourceId==='naver_datalab_search');const changedToken=await store.acquireResearchLock(owner,0);try{await collect.runSteps(owner,changed,1,deps,changedToken);check(changed.errors.naver_datalab_search?.code==='source_policy_blocked'&&calls.length===0,'current marked plan rechecks changed evidence before transmission')}finally{await store.releaseResearchLock(owner,changedToken)}
const freshOwner='policy-fresh-owner';await (await store.sealCredential(freshOwner,{kind:'naver_api_hub',clientId:'syntheticHubId123',clientSecret:'test'.repeat(8)},null)).run();
const freshState=collect.emptyCollectState();freshState.plan=await collect.buildPlan(freshOwner,freshState,'naver_datalab_search',now);let sent=0;const positiveDeps={now:()=>new Date(now),fetch:async(_url,init)=>{sent++;const body=JSON.parse(init.body);return Response.json({results:body.keywordGroups.map(g=>({title:g.groupName,data:[{period:body.startDate,ratio:50}]}))})}};
const freshToken=await store.acquireResearchLock(freshOwner,0);try{const out=await collect.runSteps(freshOwner,freshState,1,positiveDeps,freshToken);check(out.calls===1&&out.stored===1&&sent===1,'safe regenerated seed-only plan still collects with current marker')}finally{await store.releaseResearchLock(freshOwner,freshToken)}
console.log(JSON.stringify({passed,sqlite:'real',http:'mocked',externalCalls:0}));
