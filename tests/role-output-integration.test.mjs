import assert from 'node:assert/strict';
import {testRuntime} from './helpers/runtime.mjs';
import {roleFixture} from './helpers/role-fixture.mjs';
let output='',calls=0,outputTokens;
const submissions=new Map();
const {sql,load}=testRuntime(async(url,options={})=>{
 if(url.endsWith('/v1/runs')){const id='role_'+ ++calls;submissions.set(id,JSON.parse(options.body));return Response.json({run_id:id});}
 const id=url.split('/').pop();
 return Response.json({object:'hermes.run',run_id:id,status:'completed',output:output||roleFixture(submissions.get(id).input),usage:{total_tokens:123,...(outputTokens===undefined?{}:{output_tokens:outputTokens})},model:'provider-model'});
});
const server=await load('lib/server.ts'),execution=await load('lib/role-execution.ts'),sequence=await load('lib/campaign-sequence.ts'),action=await load('app/api/action/route.ts'),policy=await load('lib/campaign-policy.ts'),roleOutput=await load('lib/role-output.ts');
const owner='role-owner',passed=[];
const check=(name,value)=>{assert.ok(value,name);passed.push(name)};
await server.seedBrands(owner);
sql.prepare('INSERT INTO settings(owner,secret,model,updated_at) VALUES(?,?,?,?)').run(owner,await server.encrypt(JSON.stringify({provider:'hermes',endpoint:'https://hermes.example.com',key:'test-only'})),'HERMES','2026-01-01');
const base=await server.readRecord(owner,'campaign','ofd-pilot-01');
const put=(kind,id,data,parent='')=>server.recordStatement(owner,kind,id,data,parent).run();
const start=async(id,role='cmo')=>execution.executeRole(owner,{action:'start',campaignId:id,role});
await put('campaign','invalid',{...base,id:'invalid'});
// Verbatim failed ODA strategy response, reduced only to omit choice descriptions.
output='이번 요청에서 수행할 작업이 명시되지 않았습니다. 다음 중 하나를 지정해 주세요.\n1. 현재 초안을 검수\n2. 전략 브리프 전체 재작성\n번호 하나만 말씀해 주시면 됩니다.';
let response=await start('invalid'),job=await response.json();
check('request persists versioned role contract before provider polling',!!(await server.readRecord(owner,'role_output_contract',job.id)).version);
const body=submissions.values().next().value,input=JSON.parse(body.input);
check('provider input explicitly names action role and all required outputs',input.task.action==='작성'&&input.task.role==='cmo'&&input.task.outputContract.sections.length===3);
response=await execution.executeRole(owner,{action:'poll',id:job.id});
check('question-only result becomes terminal failed',(await response.json()).status==='failed');
check('invalid result never becomes artifact',(await server.listRecords(owner,'artifact','invalid')).length===0);
check('failure explains missing task execution',sql.prepare('SELECT error FROM jobs WHERE id=?').get(job.id).error.includes('작업 선택'));
check('failure preserves tokens',sql.prepare('SELECT tokens FROM jobs WHERE id=?').get(job.id).tokens===123);
check('failure ledger preserves provider completion and invalid domain outcome',(await server.listRecords(owner,'provider_usage')).some(x=>x.domainOutcome==='invalid_output'));
const failure=await server.readRecord(owner,'role_output_failure',job.id);
check('raw invalid output is retained for owner diagnosis',failure.raw===output);
await assert.rejects(()=>server.readRecord('another-owner','role_output_failure',job.id));passed.push('foreign owner cannot access raw output');
const beforeReplay=calls;await execution.executeRole(owner,{action:'poll',id:job.id});check('terminal replay cannot create another provider job',calls===beforeReplay);

output='';await put('campaign','valid',{...base,id:'valid'});
job=await (await start('valid')).json();await execution.executeRole(owner,{action:'poll',id:job.id});
let artifact=(await server.listRecords(owner,'artifact','valid'))[0];
check('incomplete-data structured draft remains usable',artifact.content.includes('자료 필요')&&artifact.outputContractVersion==='role-output-v1');
for(const change of [{status:'revision'},{campaignVersion:99},{content:'자료 확인했습니다. 다만 이번 요청에서 수행할 작업이 명시되지 않았습니다. 다음 중 무엇을 원하시는지 한 가지만 지정해 주세요.'}]){
 await put('artifact',artifact.id,{...artifact,...change},'valid');const before=calls;
 check('direct dependent role rejects bad predecessor '+JSON.stringify(change),(await start('valid','insight')).status===409&&calls===before);
 await put('campaign_sequence','valid',{campaignId:'valid',campaignVersion:base.version,status:'running',startedAt:'2099-01-01',updatedAt:'2026-01-01'},'valid');
 const result=await sequence.sequenceAction(owner,{action:'advance_sequence',campaignId:'valid'});
 check('sequence blocks instead of skipping bad predecessor '+JSON.stringify(change),result.sequence.status==='blocked'&&calls===before);
}
await put('artifact',artifact.id,{...artifact,status:'revision'},'valid');
for(const role of ['insight','strategy','creative','content','growth','data','quality'])await put('artifact','downstream-'+role,{...artifact,id:'downstream-'+role,role,status:'approved'},'valid');
check('repair requires explicit optimistic artifact version',(await execution.executeRole(owner,{action:'start',campaignId:'valid',role:'cmo',repairId:artifact.id,repairVersion:999})).status===409);
job=await (await execution.executeRole(owner,{action:'start',campaignId:'valid',role:'cmo',repairId:artifact.id,repairVersion:artifact.version})).json();
check('revision can be regenerated without reusing completed job id',typeof job.id==='string');
await execution.executeRole(owner,{action:'poll',id:job.id});
check('replacement preserves previous draft as outdated',(await server.readRecord(owner,'artifact',artifact.id)).status==='outdated');
check('replacement leaves only one current role artifact',(await server.listRecords(owner,'artifact','valid')).filter(a=>a.status!=='outdated').length===1);
check('replacement invalidates all seven previously approved descendants',(await server.listRecords(owner,'artifact','valid')).filter(a=>a.id.startsWith('downstream-')&&a.status==='outdated').length===7);
check('replacement preserves prior role versions in history',(await server.listRecords(owner,'history','valid')).length===8);
await put('campaign_sequence','valid',{campaignId:'valid',campaignVersion:base.version,status:'running',startedAt:'2099-01-01',updatedAt:'2026-01-01'},'valid');
check('sequence resumes at insight after CMO repair',(await sequence.sequenceAction(owner,{action:'advance_sequence',campaignId:'valid'})).role==='insight');

// 검토 메모와 직전 실패 사유가 재작성 입력으로 돌아간다(ai-quality-1). 역할 입력은 근거 컨텍스트와 미확인 브랜드 소개를 받는다.
const act=async data=>{const r=await action.POST(new Request('https://agency.test/api/action',{method:'POST',headers:{'Content-Type':'application/json','oai-authenticated-user-id':owner},body:JSON.stringify(data)}));return {status:r.status,data:await r.json()}};
const submissionOf=async id=>{const saved=await server.readRecord(owner,'hermes_submission',id);const body=JSON.parse(saved.body);return {raw:saved.body,body,input:JSON.parse(body.input)}};
const now=Date.now();
await put('brand_fact','hours',{id:'hours',brandId:base.brandId,key:'hours',value:'평일 11시~21시',status:'confirmed',source:'점주 확인',verifiedAt:new Date(now-60000).toISOString(),validUntil:new Date(now+86400000).toISOString(),version:2,updatedAt:new Date(now-60000).toISOString()},base.brandId);
await put('campaign','loop',{...base,id:'loop'});
await put('campaign_directive','loop-directive',{id:'loop-directive',campaignId:'loop',text:'인기·할인 표현은 확인 전 쓰지 않습니다.',createdAt:new Date(now).toISOString(),createdBy:{id:owner,email:null}},'loop');
output='';job=await (await start('loop')).json();
let sub=await submissionOf(job.id);
check('role input carries evidence facts and standing directives instead of raw confirmed facts',sub.input.evidence.facts.confirmed.some(f=>f.key==='hours'&&f.id===undefined)&&sub.input.evidence.directives.some(d=>d.text==='인기·할인 표현은 확인 전 쓰지 않습니다.'&&d.author==='관리자')&&sub.input.confirmedFacts===undefined);
check('role input brand separates unverified introduction from identity',sub.input.brand.brandIntro.verification==='unverified'&&sub.input.brand.brandIntro.useInCopy===false&&!!sub.input.brand.identity);
check('role instructions always forbid re-asking and unverified ad claims',sub.body.instructions.includes(policy.answerDiscipline)&&sub.body.instructions.includes(policy.claimPolicy));
check('role instructions limit standing directives to team instructions without fact authority',sub.body.instructions.includes(policy.directivePolicy)&&!sub.body.instructions.includes('대표가 이 캠페인에 남긴'));
check('campaign input is cited by a readable ref label, not its internal id',sub.input.campaign.ref===`브리프 v${base.version}`&&sub.input.campaign.id===undefined);
// data-truth-4: 역할 입력의 예산은 null=미확정, 0=무예산 확정이다. 확정 표시 없는 이전 0은 미확정(null)으로 넘기고, 지시문도 같은 의미를 쓴다.
await put('campaign','zero-budget',{...base,id:'zero-budget',budget:0,budgetConfirmedAt:'2026-09-01T00:00:00.000Z'});
await put('campaign','legacy-zero',{...base,id:'legacy-zero',budget:0,budgetConfirmedAt:undefined});
const zeroJob=await (await start('zero-budget')).json(),legacyJob=await (await start('legacy-zero')).json();
const zeroSub=await submissionOf(zeroJob.id),legacySub=await submissionOf(legacyJob.id);
for(const id of [zeroJob.id,legacyJob.id])await execution.executeRole(owner,{action:'poll',id});
check('confirmed zero budget reaches the role as a no-budget decision',zeroSub.input.campaign.budget===0&&zeroSub.input.campaign.budgetStatus==='0원(무예산)');
check('role instructions no longer call a zero budget unconfirmed',!zeroSub.body.instructions.includes('0은 미확정')&&zeroSub.body.instructions.includes('0은 무예산 확정'));
check('legacy zero without confirmation reaches the role as unconfirmed',legacySub.input.campaign.budget===null&&legacySub.input.campaign.budgetStatus==='미확정');
await execution.executeRole(owner,{action:'poll',id:job.id});
let cmo=(await server.listRecords(owner,'artifact','loop'))[0];
check('saved artifact records the confirmed fact versions it used',JSON.stringify(cmo.factRefs)===JSON.stringify([{id:'hours',version:2,status:'confirmed'}])&&!cmo.factsChanged);
const note='가격 표현을 빼고 오픈일 확인 계획을 추가해 주세요.';
check('revision request with note succeeds',(await act({action:'review_artifact',id:cmo.id,version:cmo.version,decision:'revision',note})).status===200);
cmo=await server.readRecord(owner,'artifact',cmo.id);
check('review note, time and reviewed version persist on the artifact',cmo.status==='revision'&&cmo.reviewNote===note&&cmo.reviewedVersion===1&&Number.isFinite(Date.parse(cmo.reviewedAt)));
output='이번 요청에서 수행할 작업이 명시되지 않았습니다. 다음 중 하나를 지정해 주세요.\n1. 검수\n2. 재작성';
const repairJob=await (await execution.executeRole(owner,{action:'start',campaignId:'loop',role:'cmo',repairId:cmo.id,repairVersion:cmo.version})).json();
sub=await submissionOf(repairJob.id);
check('review note reaches the HERMES submission body',sub.raw.includes(note)&&sub.input.revisionRequest.note===note);
check('rewrite receives the previous version and excerpt',sub.input.revisionRequest.previousVersion===1&&sub.input.revisionRequest.previousExcerpt===cmo.content.slice(0,2000));
check('rewrite instruction asks where the request was applied',sub.body.instructions.includes('요청 반영 위치를 changes 절에'));
await execution.executeRole(owner,{action:'poll',id:repairJob.id});
check('invalid rewrite does not send a campaign with work back to brief drafting',(await server.readRecord(owner,'campaign','loop')).status==='revision');
const secondNote='가격 표현을 빼 주세요. 오픈일은 확인 계획으로만 남겨 주세요.';
await act({action:'review_artifact',id:cmo.id,version:cmo.version,decision:'revision',note:secondNote});
output='';const retryJob=await (await execution.executeRole(owner,{action:'start',campaignId:'loop',role:'cmo',repairId:cmo.id,repairVersion:cmo.version})).json();
sub=await submissionOf(retryJob.id);
check('a changed review note produces a new execution identity',typeof retryJob.id==='string'&&retryJob.id!==repairJob.id);
check('the last failure reason reaches the next rewrite',sub.input.revisionRequest.note===secondNote&&sub.input.revisionRequest.lastFailure.includes('작업 선택'));
outputTokens=100;await execution.executeRole(owner,{action:'poll',id:retryJob.id});outputTokens=undefined;
const repaired=(await server.listRecords(owner,'artifact','loop')).find(a=>a.status==='review');
check('output under 5% of the role token budget is marked thin',repaired?.outputSignal==='thin_output'&&repaired.outputTokens===100);
check('thin output is recorded separately in the usage ledger',(await server.readRecord(owner,'provider_usage','hermes:'+sql.prepare('SELECT provider_id FROM jobs WHERE id=?').get(retryJob.id).provider_id)).domainOutcome==='thin_output');

// 속 빈 초안과 형식을 바꾼 재질문은 JSON 계약을 통과해도 저장되지 않는다(ai-quality-4).
const cmoContract=roleOutput.roleOutputContract('cmo');
const structured=content=>JSON.stringify({contractVersion:cmoContract.version,role:'cmo',sections:cmoContract.sections.map(s=>({id:s.id,content}))});
for(const [index,[name,text]] of [['placeholder-only draft',[1,2,3].map(i=>`자료 필요 ${i}: 실제 운영 조건이 없습니다. 확인 전에는 가설로 취급하며 대표 확인 후 작성합니다.`).join('\n')],['numbered choice request','다음 중 무엇을 원하시는지 한 가지만 지정해 주세요. 1) 전략 2) 카피'],['deferred writing offer','어떤 방향으로 작성할지 알려 주시면 바로 작성하겠습니다. '+'브랜드와 목표는 확인했습니다. '.repeat(20)]].entries()){
 const id='thin-'+index;await put('campaign',id,{...base,id});output=structured(text);
 const thinJob=await (await start(id)).json();const result=await (await execution.executeRole(owner,{action:'poll',id:thinJob.id})).json();
 const row=sql.prepare('SELECT error,provider_id FROM jobs WHERE id=?').get(thinJob.id);
 check(name+' fails as a rewritable invalid output',result.status==='failed'&&(await server.listRecords(owner,'artifact',id)).length===0&&row.error.startsWith('작업물 수정 필요')&&(await server.readRecord(owner,'provider_usage','hermes:'+row.provider_id)).domainOutcome==='invalid_output');
}

// 단독 품질 검수: 루브릭 문제는 판정 하향으로 보존하고, 판정이 준비되지 않으면 연속 실행은 수정 목록과 함께 멈춘다(ai-quality-6, 7, 10).
await put('campaign','qa',{...base,id:'qa'});
for(const role of ['cmo','insight','strategy','creative','content','growth','data'])await put('artifact','qa-'+role,{id:'qa-'+role,campaignId:'qa',campaignVersion:base.version,role,title:role,content:role+' 검토 가능한 초안',status:'approved',version:1,origin:'ai',createdAt:'2026-01-01'},'qa');
output=JSON.stringify({verdict:'ready_for_review',summary:'검수 결론',findings:'근거와 실행을 대조했습니다.',checks:['evidence','brand','execution','economics','measurement'].map(criterion=>criterion==='brand'?{criterion,status:'revise',location:'브랜드 전략 v1 · 37da2d59-038a-4403-8374-de1f01f430f7',finding:'금지 표현이 남아 있습니다.',fix:'브랜드 전략의 금지 표현을 삭제하세요.'}:{criterion,status:'pass',location:'총괄 파트너 v1',finding:'대조함',fix:'해당 없음'}),taskChecks:[{role:'strategy',status:'revise',location:'브랜드 전략 v1',finding:'CTA가 둘입니다.',fix:'CTA를 하나로 줄이세요.'}]});
job=await (await start('qa','quality')).json();sub=await submissionOf(job.id);
check('standalone quality instruction requires an empty taskChecks array',sub.body.instructions.includes('taskChecks는 반드시 빈 배열'));
check('upstream work is cited by role ref labels',sub.input.previous.every(p=>p.ref&&p.id===undefined)&&sub.input.previous[0].ref==='총괄 파트너 v1');
check('rubric gate issue keeps the paid review instead of failing it',(await (await execution.executeRole(owner,{action:'poll',id:job.id})).json()).status==='completed');
let qa=(await server.listRecords(owner,'artifact','qa')).find(a=>a.role==='quality');
check('gate issues downgrade the verdict and remain visible',qa.qualityReview.verdict==='revise'&&qa.content.includes('## 추가 확인 필요'));
check('quality location hides internal ids but keeps them separately',!/[0-9a-f]{8}-[0-9a-f]{4}-/.test(qa.content)&&qa.qualityReview.checks.find(x=>x.criterion==='brand').locationRef.includes('37da2d59'));
await put('campaign_sequence','qa',{campaignId:'qa',campaignVersion:base.version,status:'running',startedAt:'2099-01-01',updatedAt:'2026-01-01'},'qa');
const reviewSequence=(await sequence.sequenceAction(owner,{action:'advance_sequence',campaignId:'qa'})).sequence;
check('non-ready quality verdict ends the sequence as needs_review',reviewSequence.status==='needs_review'&&!!reviewSequence.error);
check('needs_review sequence records the quality artifact its fixes came from',reviewSequence.source?.id===qa.id&&reviewSequence.source.version===qa.version);
check('sequence carries quality fixes with responsible roles',reviewSequence.fixes.some(x=>x.role==='strategy'&&x.fix==='CTA를 하나로 줄이세요.')&&reviewSequence.fixes.some(x=>x.role==='strategy'&&x.fix.includes('금지 표현'))&&reviewSequence.fixes.some(x=>x.role===null));
await put('artifact',qa.id,{...qa,status:'revision'},'qa');
output='검수 결과: 대체로 통과입니다. 가격만 확인하세요.';
job=await (await execution.executeRole(owner,{action:'start',campaignId:'qa',role:'quality',repairId:qa.id,repairVersion:qa.version})).json();
check('unparseable standalone quality JSON is an invalid output',(await (await execution.executeRole(owner,{action:'poll',id:job.id})).json()).status==='failed'&&sql.prepare('SELECT error FROM jobs WHERE id=?').get(job.id).error.includes('JSON'));

// 브랜드 수정은 그 브랜드의 작업만 막고, 승인 캠페인의 상태·브리프 버전을 유지한 채 작업물에 변경 표시만 남긴다(data-truth-2).
output='';
await put('campaign','brand-approved',{...base,id:'brand-approved',status:'approved'});
await put('artifact','approved-work',{id:'approved-work',campaignId:'brand-approved',campaignVersion:base.version,role:'cmo',title:'승인 작업물',content:'승인된 실행 기획',status:'approved',version:1,origin:'ai',createdAt:'2026-01-01'},'brand-approved');
await put('artifact','brand-review-work',{id:'brand-review-work',campaignId:'brand-approved',campaignVersion:base.version,role:'insight',title:'검토 작업물',content:'검토 대기 초안',status:'review',version:1,origin:'ai',createdAt:'2026-01-01'},'brand-approved');
await put('campaign','other-brand',{...base,id:'other-brand',brandId:'oda'});
const activeJob=(id,campaign)=>sql.prepare('INSERT INTO jobs(id,owner,campaign_id,role,status,provider_id,model,campaign_version,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run(id,owner,campaign,'cmo','queued','provider-'+id,'HERMES',base.version,'2026-01-01','2026-01-01');
activeJob('other-brand-active','other-brand');
check('active work in another brand does not block a brand edit',(await act({action:'save_brand',id:base.brandId,data:{description:'확인된 설명만 남깁니다.'}})).status===200);
const kept=await server.readRecord(owner,'campaign','brand-approved');
check('brand edit keeps approved campaign status and brief version',kept.status==='approved'&&kept.version===base.version);
const flagged=await server.readRecord(owner,'artifact','approved-work');
check('brand edit flags current artifacts instead of outdating them',flagged.status==='approved'&&flagged.brandChanged===true);
activeJob('same-brand-active','brand-approved');
check('active work in the same brand still blocks a brand edit',(await act({action:'save_brand',id:base.brandId,data:{description:'다시 수정'}})).status===409);
sql.prepare("UPDATE jobs SET status='cancelled' WHERE id IN ('other-brand-active','same-brand-active')").run();
// 브랜드·사실 변경 표시가 있는 작업물은 변경을 확인했다는 명시적 값이 있어야 승인된다(DT2, DT5 권고 4).
check('approval of a brand-changed artifact asks for explicit acknowledgement',(await act({action:'review_artifact',id:'brand-review-work',version:1,decision:'approved'})).status===409&&(await server.readRecord(owner,'artifact','brand-review-work')).status==='review');
const acked=await act({action:'review_artifact',id:'brand-review-work',version:1,decision:'approved',acknowledgeChanges:true}),ackedArtifact=await server.readRecord(owner,'artifact','brand-review-work');
check('acknowledged approval clears the brand change mark',acked.status===200&&ackedArtifact.status==='approved'&&!('brandChanged' in ackedArtifact));
await put('artifact','fact-review-work',{id:'fact-review-work',campaignId:'brand-approved',campaignVersion:base.version,role:'strategy',title:'사실 변경 작업물',content:'검토 대기 초안',status:'review',version:1,origin:'ai',createdAt:'2026-01-01',factRefs:[],factsChanged:true},'brand-approved');
check('revision requests on changed artifacts need no acknowledgement',(await act({action:'review_artifact',id:'fact-review-work',version:1,decision:'revision',note:'사실 반영'})).status===200);
await put('artifact','fact-review-work',{id:'fact-review-work',campaignId:'brand-approved',campaignVersion:base.version,role:'strategy',title:'사실 변경 작업물',content:'검토 대기 초안',status:'review',version:1,origin:'ai',createdAt:'2026-01-01',factRefs:[],factsChanged:true},'brand-approved');
check('approval of a fact-changed artifact asks for explicit acknowledgement',(await act({action:'review_artifact',id:'fact-review-work',version:1,decision:'approved'})).status===409);
await act({action:'review_artifact',id:'fact-review-work',version:1,decision:'approved',acknowledgeChanges:true});
const factAcked=await server.readRecord(owner,'artifact','fact-review-work');
check('acknowledged approval rebases the fact snapshot and clears the fact change mark',factAcked.status==='approved'&&!factAcked.factsChanged&&factAcked.factRefs.some(r=>r.id==='hours'&&r.status==='confirmed'));

// 가장 최근 완료된 같은 브리프 버전 회의의 안건과 합의가 단일 역할 재작성에 전달된다(AQ2).
await put('campaign','decided',{...base,id:'decided'});
const meetingRecord=(id,campaignVersion,agenda,decisions,createdAt)=>put('team_meeting',id,{id,campaignId:'decided',campaignVersion,agenda,status:'completed',createdAt,updatedAt:createdAt,steps:[{id:id+':synthesis',role:'cmo',phase:'synthesis',status:'completed',output:{decisions,disagreements:'없음',questions:'가격 확인',tasks:[]}}],snapshot:{artifacts:[]}},'decided');
await meetingRecord('m-old',base.version,'이전 안건','이전 합의','2026-01-01T00:00:00.000Z');await meetingRecord('m-new',base.version,'대표 안건: 할인 표현 없이 픽업 대기 시간을 강조','픽업 준비 시간 보장을 핵심 메시지로 채택','2026-02-01T00:00:00.000Z');await meetingRecord('m-other',base.version+1,'다른 브리프 안건','다른 합의','2026-03-01T00:00:00.000Z');
output='';job=await (await start('decided')).json();sub=await submissionOf(job.id);
check('role input carries the latest completed meeting agenda and decisions for this brief version',sub.input.previousDecisions?.agenda==='대표 안건: 할인 표현 없이 픽업 대기 시간을 강조'&&sub.input.previousDecisions.decisions==='픽업 준비 시간 보장을 핵심 메시지로 채택'&&sub.input.previousDecisions.questions==='가격 확인');
check('role instructions ask to apply meeting decisions',sub.body.instructions.includes('previousDecisions'));
await execution.executeRole(owner,{action:'poll',id:job.id});

// 성공 뒤 outdated된 역할을 다시 실행하면 이미 해결된 과거 실패 사유를 재작성 요청으로 보내지 않는다(stale-last-failure).
await put('campaign','stale-failure',{...base,id:'stale-failure'});
output='이번 요청에서 수행할 작업이 명시되지 않았습니다. 다음 중 하나를 지정해 주세요.\n1. 검수\n2. 재작성';
job=await (await start('stale-failure')).json();await execution.executeRole(owner,{action:'poll',id:job.id});
output='';job=await (await start('stale-failure')).json();sub=await submissionOf(job.id);
check('the first rewrite after a failure still receives the failure reason',sub.input.revisionRequest?.lastFailure.includes('작업 선택'));
await execution.executeRole(owner,{action:'poll',id:job.id});
const solved=(await server.listRecords(owner,'artifact','stale-failure'))[0];await put('artifact',solved.id,{...solved,status:'outdated'},'stale-failure');
job=await (await start('stale-failure')).json();sub=await submissionOf(job.id);
check('a failure resolved by a later artifact is not resent after the artifact becomes outdated',sub.input.revisionRequest===undefined&&!sub.body.instructions.includes('changes:'));
await put('role_output_failure','legacy-failure',{id:'legacy-failure',role:'cmo',error:'작업물 수정 필요: 오래된 실패',createdAt:'2099-01-01T00:00:00.000Z'},'stale-failure');
await execution.executeRole(owner,{action:'poll',id:job.id});
for(const a of await server.listRecords(owner,'artifact','stale-failure'))await put('artifact',a.id,{...a,status:'outdated'},'stale-failure');
await put('campaign_directive','stale-failure-directive',{id:'stale-failure-directive',campaignId:'stale-failure',text:'픽업 시간을 먼저 보여 줍니다.',createdAt:new Date(now).toISOString(),createdBy:{id:owner,email:null}},'stale-failure');
job=await (await start('stale-failure')).json();sub=await submissionOf(job.id);
check('legacy failures without a brief version are never resent',sub.input.revisionRequest===undefined);
await execution.executeRole(owner,{action:'poll',id:job.id});

// 실행 중 사실이 바뀌면 저장 시점에 factsChanged로 표시한다(facts-changed-race).
await put('campaign','race',{...base,id:'race'});
output='';job=await (await start('race')).json();
await put('brand_fact','race-fact',{id:'race-fact',brandId:base.brandId,key:'price',value:'도넛 3,500원',status:'confirmed',source:'점주 확인',verifiedAt:new Date(now-60000).toISOString(),validUntil:new Date(now+86400000).toISOString(),version:1,updatedAt:new Date(now).toISOString()},base.brandId);
await execution.executeRole(owner,{action:'poll',id:job.id});
check('a fact confirmed while the role was running marks the saved artifact',(await server.listRecords(owner,'artifact','race'))[0].factsChanged===true);

// 거절 사실 값이나 근거 없는 광고 표현이 [확인 필요] 없이 저장되면 결정적 검사로 신호를 남긴다(AQ3).
await put('brand_fact','oven',{id:'oven',brandId:base.brandId,key:'조리 방식',value:'장작 화덕',status:'rejected',source:'',verifiedAt:'',validUntil:'',version:1,updatedAt:new Date(now).toISOString()},base.brandId);
await put('campaign','claims',{...base,id:'claims'});
for(const role of ['cmo','insight','strategy'])await put('artifact','claims-'+role,{id:'claims-'+role,campaignId:'claims',campaignVersion:base.version,role,title:role,content:role+' 검토 가능한 초안',status:'approved',version:1,origin:'ai',createdAt:'2026-01-01'},'claims');
const creativeContract=roleOutput.roleOutputContract('creative');
output=JSON.stringify({contractVersion:creativeContract.version,role:'creative',sections:creativeContract.sections.map((s,i)=>({id:s.id,content:i===0?'콘셉트 A: 장작 화덕에서 막 나온 한 판. 오픈 첫 주 할인으로 첫 방문을 유도합니다.\n콘셉트 B: 퇴근길 20분 픽업, 기다림 없는 한 끼.\n[가설] 픽업 준비 시간 보장이 할인보다 강한 선택 이유입니다. 반증: 픽업 비율 10% 미만이면 기각합니다.':'제작 지시: 도우 단면을 2초 안에 보여 주고 매장 로고를 우하단에 둡니다. 촬영 조건과 색 보정 기준은 브랜드 색을 따릅니다. [자료 필요] 실제 메뉴 가격은 점주 확인 후 반영합니다.'}))});
job=await (await start('claims','creative')).json();sub=await submissionOf(job.id);await execution.executeRole(owner,{action:'poll',id:job.id});
const claimed=(await server.listRecords(owner,'artifact','claims')).find(a=>a.role==='creative');
check('rejected fact value and unmarked discount claim are flagged on the saved artifact',claimed?.status==='review'&&JSON.stringify(claimed.unverifiedClaims)===JSON.stringify(['장작 화덕','할인']));
check('claim check leaves an event for the campaign',(await server.listRecords(owner,'event','claims')).some(e=>e.message.includes('장작 화덕')));
output='';

// Legacy in-flight requests have no structured contract. Reject the known failure anyway.
await put('campaign','legacy',{...base,id:'legacy'});
sql.prepare('INSERT INTO jobs(id,owner,campaign_id,role,status,provider_id,model,campaign_version,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run('legacy',owner,'legacy','cmo','queued','legacy-provider','HERMES',base.version,'2026-01-01','2026-01-01');
output='이번 요청에서 수행할 작업이 명시되지 않았습니다. 다음 중 하나를 지정해 주세요.';
response=await execution.executeRole(owner,{action:'poll',id:'legacy'});
check('legacy in-flight known nonanswer also fails',(await response.json()).status==='failed');
await put('role_output_failure','cleanup-check',{raw:'private output'},'valid');
await server.deleteCampaign(owner,{id:'valid',version:base.version,confirmed:true});
check('campaign deletion removes new role contracts and failure originals',(await server.listRecords(owner,'role_output_contract','valid')).length===0&&(await server.listRecords(owner,'role_output_failure','valid')).length===0);
console.log(JSON.stringify({passed:passed.length,checks:passed}));
