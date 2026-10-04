// Real SQLite/source assembly, mocked provider; no customer data or external calls.
import assert from 'node:assert/strict';
import {testRuntime} from './helpers/runtime.mjs';
import {roleFixture} from './helpers/role-fixture.mjs';
let submitted;
const {load,sql,env}=testRuntime(async(url,options={})=>{
 if(String(url)==='https://hermes.example.com/v1/runs'){submitted=JSON.parse(options.body);return Response.json({run_id:'synthetic-lesson-run'});}
 if(String(url)==='https://hermes.example.com/v1/runs/synthetic-lesson-run')return Response.json({object:'hermes.run',run_id:'synthetic-lesson-run',status:'completed',output:roleFixture(submitted.input),usage:{total_tokens:100,output_tokens:600}});
 throw Error('external forbidden');
});
const server=await load('lib/server.ts'),decisions=await load('lib/growth-decisions.ts'),execution=await load('lib/role-execution.ts');
let passed=0;const check=(v,n)=>{assert.ok(v,n);passed++};
const owner='lesson-owner',now=new Date().toISOString(),c={id:'campaign',brandId:'brand',title:'합성 캠페인',version:1,status:'draft',channels:'Instagram',budget:null},brand={id:'brand',name:'합성 브랜드'};
const put=(kind,id,data,parent=c.id)=>server.recordStatement(owner,kind,id,data,parent).run();
await put('campaign',c.id,c,'');await put('brand',brand.id,brand,'');
const source={artifacts:[],previous:[]};
const request=()=>execution.roleRequestFor(owner,c,'growth',source,brand);
const before=await request();check(!before.growthLessons,'no lesson leaves old request untouched');
const input={...decisions.emptyLessonInput(),title:'배송 안내 먼저',method:'배송 조건을 구매 버튼 가까이에 설명',hypothesis:'조건 확인 부담 감소',scope:'현재 캠페인 상세페이지',falsificationRule:'문의 증가 시 재검토',lossLimit:0,sourceEvidence:'합성 관측',counterEvidence:'소표본이라 효과 미확인',expiresAt:'2099-12-31',state:'reusable',outcome:'success',evidenceLevel:'operational_observation',testPlan:'조건 안내 전후 확인',testResult:'합성 운영 관측',nextAction:'다음 초안에 조건 검토',assignee:'운영 담당',dueAt:'2099-12-31'};
const row={id:'lesson',brandId:c.brandId,campaignId:c.id,campaignVersion:1,version:1,input,createdAt:now,updatedAt:now};
await put('growth_lesson',row.id,row);
const req=await request();check(req.growthLessons?.lessons.length===1,'reusable current lesson reaches actual role request');
check(req.growthLessons.lessons[0].direction==='consider','success is method reference only');
const submission=execution.roleSubmission(req),sent=JSON.parse(submission.input);
check(sent.growthLessons.lessons[0].method===input.method,'provider submission contains approved method');
check(submission.instructions.includes('인과 효과')&&submission.instructions.includes('growthLessons'),'explicit authority and evidence limit');
check(!submission.input.includes('lesson-owner')&&!submission.input.includes('운영 담당'),'no operator identity in provider context');
check(req.growthLessons.digest.length===64,'exact context digest available');
const masked=execution.roleSubmission({...req,growthLessons:{...req.growthLessons,lessons:[{...req.growthLessons.lessons[0],method:'합성 연락처 synthetic@example.com'}]}});
check(!masked.input.includes('synthetic@example.com')&&masked.findings.length>0,'frozen/manual evaluation input also masks contact text');
assert.throws(()=>execution.roleSubmission({...req,growthLessons:{...req.growthLessons,lessons:[{...req.growthLessons.lessons[0],method:'password=synthetic-only-value'}]}}));passed++;
for(const method of ['{"api_key":"synthetic-only-value"}',"{'password':'synthetic-only-value'}",'ｐａｓｓｗｏｒｄ=synthetic-only-value','pass\u200bword=synthetic-only-value']){
 assert.throws(()=>execution.roleSubmission({...req,growthLessons:{...req.growthLessons,lessons:[{...req.growthLessons.lessons[0],method}]}}));
 assert.throws(()=>decisions.parseLessonInput({...input,method}));passed+=2;
}
await put('growth_lesson',row.id,{...row,input:{...input,outcome:'failure'},version:2});
const failed=await request();check(failed.growthLessons.lessons[0].direction==='avoid_or_retest','failed method not presented as success');
check(failed.growthLessons.digest!==req.growthLessons.digest,'revision changes input digest');
await put('growth_lesson',row.id,{...row,input:{...input,state:'retired',retirementReason:'재검토'}});check(!(await request()).growthLessons,'retired excluded');
await put('growth_lesson',row.id,{...row,input:{...input,expiresAt:'2000-01-01'}});check(!(await request()).growthLessons,'expired excluded');
await put('growth_lesson',row.id,{...row,campaignVersion:2});check(!(await request()).growthLessons,'stale campaign excluded');
await put('growth_lesson',row.id,{...row,input:{...input,missionId:'missing',missionVersion:1}});check(!(await request()).growthLessons,'missing upstream excluded');
await put('growth_lesson',row.id,row);
await server.recordStatement('other','brand',brand.id,brand,'').run();
const other=await execution.roleRequestFor('other',c,'growth',source,brand);check(!other.growthLessons,'owner isolation');
await put('growth_stop','global',{id:'global',version:1,status:'stopped',reason:'검토',updatedAt:now,updatedBy:owner},'');check(!(await request()).growthLessons,'global stop excludes new lesson use');
await put('growth_stop','global',{id:'global',version:2,status:'running',reason:'검토 완료',updatedAt:now,updatedBy:owner},'');
sql.prepare('INSERT INTO settings(owner,secret,model,updated_at) VALUES(?,?,?,?)').run(owner,await server.encrypt(JSON.stringify({provider:'hermes',endpoint:'https://hermes.example.com',key:'synthetic-only'})),'HERMES',now);
const start=await execution.executeRole(owner,{action:'start',campaignId:c.id,role:'cmo'}),started=await start.json();
check(start.status===200&&!!started.id,'actual role start accepts context');
const contract=await server.readRecord(owner,'role_output_contract',started.id);check(contract.growthLessonReferences[0].id===row.id&&contract.growthLessonDigest,'snapshot committed before provider call');
check(JSON.parse(submitted.input).growthLessons.lessons.length===1,'mock provider received the method');
const polled=await execution.executeRole(owner,{action:'poll',id:started.id});check((await polled.json()).status==='completed','provider output saved');
const aid=await execution.roleArtifactId(started.id),artifact=await server.readRecord(owner,'artifact',aid);check(artifact.growthLessonDigest===contract.growthLessonDigest&&!artifact.growthLessonsChanged,'artifact carries original context snapshot');
await put('growth_lesson',row.id,{...row,version:2,input:{...input,state:'retired',retirementReason:'후속 반증'}});
const detail=await load('lib/campaign-detail.ts');check((await detail.campaignDetail(owner,c.id)).artifacts.find(a=>a.id===aid).growthLessonsChanged,'post-completion retirement appears on refresh');
const action=await load('app/api/action/route.ts'),review=(extra={})=>action.POST(new Request('https://agency.test/api/action',{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://agency.test','oai-authenticated-user-id':owner},body:JSON.stringify({action:'review_artifact',id:aid,version:1,decision:'approved',...extra})}));
check((await review()).status===409,'changed lesson cannot be approved without acknowledgement');
check((await review({acknowledgeChanges:true})).status===200,'explicit change review allowed without claiming causal effect');
check(!(await detail.campaignDetail(owner,c.id)).artifacts.find(a=>a.id===aid).growthLessonsChanged,'acknowledged state is recorded without deleting original provenance');
await put('growth_lesson',row.id,{...row,version:3,input:{...input,state:'retired',retirementReason:'추가 반증으로 폐기 유지'}});
check((await detail.campaignDetail(owner,c.id)).artifacts.find(a=>a.id===aid).growthLessonsChanged,'retired to retired revision invalidates acknowledged state');
check((await review({acknowledgeChanges:true})).status===200,'retired revision acknowledgement recorded');
await put('growth_lesson',row.id,{...row,version:3,input:{...input,state:'retired',retirementReason:'추가 반증으로 폐기 유지',expiresAt:'2000-01-01'}});
check((await detail.campaignDetail(owner,c.id)).artifacts.find(a=>a.id===aid).growthLessonsChanged,'expired retired source invalidates acknowledgement even without a version bump');
await put('growth_lesson',row.id,{...row,version:3,input:{...input,method:'개정된 배송 안내 방법'}});
check((await detail.campaignDetail(owner,c.id)).artifacts.find(a=>a.id===aid).growthLessonsChanged,'new revision invalidates old change acknowledgement');
const saved=await action.POST(new Request('https://agency.test/api/action',{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://agency.test','oai-authenticated-user-id':owner},body:JSON.stringify({action:'save_artifact',id:aid,version:1,campaignId:c.id,role:'cmo',title:'사람 수정',content:artifact.content+'\n추가 검토'})}));
check(saved.status===200&&(await server.readRecord(owner,'artifact',aid)).growthLessonReferences[0].id===row.id,'human edits preserve original lesson provenance');
check((await review({version:2})).status===409,'editing cannot bypass source freshness review');

// Read-only lineage must preserve the same transitive campaign/mission/offer/catalog/fact/need/signal checks.
const contexts=await load('lib/growth-lesson-context-server.ts'),mission=await load('lib/growth-mission.ts'),catalog=await load('lib/growth-catalog.ts'),market=await load('lib/growth-market.ts'),journeys=await load('lib/growth-journey.ts');
const base={brandId:c.brandId,campaignId:c.id,campaignVersion:1,version:1};
const m={...base,id:'m',input:{...mission.emptyMissionInput(),title:'참조 미션',offerId:'off',offerVersion:1},status:'failed'};
const off={...base,id:'off',input:{...catalog.emptyOfferInput(),title:'참조 오퍼',catalogId:'cat',catalogVersion:1,needId:'need'},evidenceRefs:[{id:'need',version:1}]};
const cat={...base,id:'cat',input:{...catalog.emptyCatalogInput(),title:'참조 상품',factIds:['fact']},factRefs:[{id:'fact',version:1}]};
const need={...base,id:'need',input:{...market.emptyNeedInput(),title:'참조 필요',signalIds:['signal']},evidenceRefs:[{id:'signal',version:1}]};
const signal={...base,id:'signal',input:{title:'시장 관측',sourceUrl:'https://example.com/market',observedAt:now,expiresAt:'2099-12-31',sourceType:'market',summary:'합성 시장 관측',sampleSize:null}};
const fact={id:'fact',brandId:c.brandId,key:'product',value:'합성 상품',source:'운영자 확인',status:'confirmed',version:1,verifiedAt:'2026-01-01',validUntil:'2099-12-31'};
const journey={...base,id:'journey',input:{...journeys.emptyJourneyInput(),title:'참조 병목',missionId:'m',missionVersion:1}};
const decision={...base,id:'decision',input:{...decisions.emptyDecisionInput(),title:'참조 결정',missionId:'m',missionVersion:1,journeyId:'journey',journeyVersion:1}};
const linked={...row,version:4,input:{...input,missionId:'m',missionVersion:1,journeyId:'journey',journeyVersion:1,decisionId:'decision',decisionVersion:1}};
const chain=[['growth_mission',m,c.id],['growth_offer',off,c.id],['growth_catalog',cat,c.id],['growth_need',need,c.id],['growth_signal',signal,c.id],['brand_fact',fact,c.brandId],['growth_journey',journey,c.id],['growth_decision',decision,c.id]];
for(const [kind,r,parent] of chain)await put(kind,r.id,r,parent);await put('growth_lesson',row.id,linked);
check(!!(await request()).growthLessons,'failed mission with incomplete execution readiness remains learnable');
for(const [kind,r,parent] of chain){
 await put(kind,r.id,{...r,version:2},parent);check(!(await request()).growthLessons,`transitive ${kind} revision prevents reuse`);await put(kind,r.id,r,parent);
}
// A new upstream revision must invalidate an acknowledgement even when both revisions remain ineligible.
const origin=(await request()).growthLessons.references,tracked={...artifact,role:'growth',growthLessonReferences:origin};
await put('growth_offer',off.id,{...off,version:2});
const state2=await contexts.growthLessonReviewState(owner,c,tracked),acknowledged={...tracked,growthLessonAcknowledgedState:state2.stateDigest};
check(!(await contexts.growthLessonReviewState(owner,c,acknowledged)).changed,'same held lineage can be explicitly acknowledged');
await put('growth_offer',off.id,{...off,version:3});
check((await contexts.growthLessonReviewState(owner,c,acknowledged)).changed,'additional upstream change invalidates held-lineage acknowledgement');
await put('growth_offer',off.id,off);
// A sixth eligible lesson can fall out of the input budget without becoming stale.
for(let i=0;i<5;i++)await put('growth_lesson',`a${i}`,{...row,id:`a${i}`});
check(!(await request()).growthLessons.references.some(r=>r.id===row.id),'original reference leaves current five-item selection');
check(!(await contexts.growthLessonReviewState(owner,c,tracked)).changed,'selection budget does not invalidate original eligible reference');
for(let i=0;i<5;i++)sql.prepare('DELETE FROM records WHERE owner=? AND kind=? AND id=?').run(owner,'growth_lesson',`${owner}:growth_lesson:a${i}`);
const sourcePure=await load('lib/growth-signal-source.ts'),digest=(await load('lib/storefront-orders.ts')).storefrontDigest;
const archive={id:'market-source',brandId:c.brandId,title:signal.input.title,category:'market',origin:'manual',status:'confirmed',url:signal.input.sourceUrl,content:signal.input.summary,scope:'시장 관측',observedAt:now,version:1,createdAt:now};
await put('brand_source',archive.id,archive,c.brandId);
await put('growth_signal',signal.id,{...signal,sourceProvenance:{sourceId:archive.id,sourceVersion:1,sourceDigest:await digest(sourcePure.signalSourceBasis(archive,null)),researchId:null,importedAt:now}});
const sourceRefs=(await request()).growthLessons.references;
const sourceTracked={...tracked,growthLessonReferences:sourceRefs};
await put('brand_source',archive.id,{...archive,content:'원본 시장 관측 추가 수정'},c.brandId);
check(!(await request()).growthLessons,'raw archive content change holds reuse even at same revision');
const sourceState=await contexts.growthLessonReviewState(owner,c,sourceTracked),sourceAck={...sourceTracked,growthLessonAcknowledgedState:sourceState.stateDigest};
await put('brand_source',archive.id,{...archive,content:'원본 시장 관측 추가 반증'},c.brandId);
check((await contexts.growthLessonReviewState(owner,c,sourceAck)).changed,'additional source evidence change invalidates an acknowledged held state');
await put('brand_source',archive.id,archive,c.brandId);
await put('brand_fact',fact.id,{...fact,validUntil:'2000-01-01'},c.brandId);
check(!(await request()).growthLessons,'expired confirmed fact blocks transitive reuse');await put('brand_fact',fact.id,fact,c.brandId);
await put('growth_lesson',row.id,{...linked,input:{...linked.input,method:'password=synthetic-only-value'}});
check(!(await request()).growthLessons,'unsafe stored lesson fails closed before provider input');await put('growth_lesson',row.id,linked);
const campaignHeld=await contexts.growthLessonReviewState(owner,{...c,version:2},tracked);
check((await contexts.growthLessonReviewState(owner,{...c,version:3},{...tracked,growthLessonAcknowledgedState:campaignHeld.stateDigest})).changed,'further campaign revision invalidates held-source acknowledgement');
// Snapshot memo lives only in this refresh call: two artifacts share one campaign read, later calls see changes.
let lessonReads=0;const prepare=env.DB.prepare;
env.DB.prepare=q=>{if(q.includes('SELECT data FROM records')&&q.includes('kind=?')){const statement=prepare(q),bind=statement.bind;statement.bind=(...values)=>{if(values[1]==='growth_lesson')lessonReads++;return bind.apply(statement,values)};return statement}return prepare(q)};
await contexts.refreshGrowthLessonArtifacts(owner,[c],[tracked,{...tracked,id:'another-artifact'}]);
check(lessonReads===1,'artifact refresh caches the campaign lesson snapshot once');env.DB.prepare=prepare;
console.log(JSON.stringify({passed}));
