// 입력 축소(input_diet, PR 4b: 감사 ai-quality-9 ①~④·loop-10). 스위치 기본 꺼짐이고 꺼지면 제출 바이트가 이전과 같다(tests/prompt-baseline.test.mjs·role-execution-drift·assembly-export가 그대로 통과).
// 이 스위트는 켜짐 경로를 본다: 캠페인 메타·중복 deliverable 제거, 선행 작업물 섹션별 예산(마지막 섹션 포함), 회의 품질 재검토 본문 중복 제거, 브랜드 자료 역할별 digest(출처 id 유지·결정론),
// 입력 상한 초과 시 omitted 표시, 확정 사실·factPolicy·지시문(근거 규율) 보존, revision 변경 뒤 옛 digest 재사용 0, 다른 소유자 digest 섞임 0, 입력 문자 수 분해(inputChars) 기록.
// 근거: mocked(모의 HERMES fetch 스텁, 메모리 SQLite, 합성 데이터). 외부 네트워크 호출은 0회다. INPUT_DIET_TABLE=1이면 역할별 입력 문자 수 표를 표준 오류에 쓴다.
import assert from 'node:assert/strict';
import {testRuntime} from './helpers/runtime.mjs';
import {seed,mockHermes,runMeeting,roleCampaign,meetingCampaign,roleIds,brand,now} from './helpers/prompt-seed.mjs';

const hermes=mockHermes();
const {sql,load}=testRuntime(hermes.fetch);
const server=await load('lib/server.ts'),execution=await load('lib/role-execution.ts'),meeting=await load('lib/meeting-execution.ts'),briefExec=await load('lib/brief-execution.ts');
const diet=await load('lib/input-diet.ts'),flags=await load('lib/feature-flags.ts'),ledger=await load('lib/graders/ledger.ts'),roleOutput=await load('lib/role-output.ts'),meetingInput=await load('lib/meeting-input.ts'),briefInput=await load('lib/brief-input.ts'),agency=await load('lib/agency.ts');
const passed=[];const check=(name,value)=>{assert.ok(value,name);passed.push(name)};
const owner='diet-owner',other='diet-other',by={id:'diet-boss',email:null};
const setDiet=(o,enabled)=>flags.setFeatureFlag(o,{flag:'input_diet',enabled},by);
const put=(o,kind,id,data,parent='')=>server.recordStatement(o,kind,id,data,parent).run();
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const count=(text,part)=>text.split(part).length-1;

// ════ 1) 순수 변환 ════
// 역할 계약 모양의 긴 작업물(6,000자 초과). 마지막 섹션에 추가 자료 요청 표지를 둔다.
const LAST='LAST-SECTION-MARK';
const contractArtifact=role=>{const sections=roleOutput.roleOutputContract(role).sections;return sections.map((s,i)=>`## ${s.title}\n\n${i===sections.length-1?LAST+' 추가 자료 요청: 좌석 수와 포장 비율. ':''}${`${role} ${i+1}번 섹션 조건부 초안과 확인 계획입니다. `.repeat(i===sections.length-1?20:120)}`).join('\n\n')};
const longCmo=contractArtifact('cmo'),cmoTitles=roleOutput.roleOutputContract('cmo').sections.map(s=>s.title);
check('synthetic predecessor is longer than the 6,000-char front cut and loses its last section there',longCmo.length>6000&&!longCmo.slice(0,6000).includes(LAST));
const budgeted=diet.sectionExcerpt(longCmo,6000);
check('section budget keeps every contract heading and the last section marker',cmoTitles.every(t=>budgeted.includes('## '+t))&&budgeted.includes(LAST));
check('section budget keeps the same total (6,000 + cut marks)',budgeted.length<=6000+cmoTitles.length*4&&budgeted.length<longCmo.length);
check('content under the limit is unchanged',diet.sectionExcerpt('## 짧은 제목\n\n짧은 본문',6000)==='## 짧은 제목\n\n짧은 본문');
const uneven='## 짧은 섹션\n\n짧다.\n\n## 긴 섹션\n\n'+'긴 본문 문장입니다. '.repeat(900);
check('water-filling keeps a short section whole and cuts only the long one',diet.sectionExcerpt(uneven,6000).startsWith('## 짧은 섹션\n\n짧다.\n\n## 긴 섹션')&&diet.sectionExcerpt(uneven,6000).length<=6004);
const digestText=diet.discussionDigest(longCmo,'cmo');
check('discussion digest keeps all headings, the summary section and the handoff section (cmo output_3) only',cmoTitles.every(t=>digestText.includes('## '+t))&&digestText.includes(LAST)&&digestText.includes('cmo 1번 섹션')&&!digestText.includes('cmo 2번 섹션')&&digestText.length<longCmo.length/2);
check('discussion digest of a role without a handoff section keeps the summary only',!diet.discussionDigest(contractArtifact('strategy'),'strategy').includes(LAST));

const arch={revision:3,confirmedSources:[{ref:'브랜드 자료 #1',id:'s1',category:'channel',content:'채널 문장입니다. '.repeat(200)},{ref:'브랜드 자료 #2',id:'s2',category:'market',content:'짧은 시장 자료'},{ref:'브랜드 자료 #3',id:'s3',category:'모름',content:'분류 없는 자료'}],omittedSources:0,observations:[{id:'o1'},{id:'o2'}],omittedObservations:1,notice:'합성 안내'};
const frozenArch=JSON.stringify(arch),insightDigest=diet.archiveDigest(arch,'insight');
check('digest does not mutate the archive',JSON.stringify(arch)===frozenArch);
check('insight digest drops the channel source, keeps market and unknown (other) with ids and refs',same(insightDigest.archive.confirmedSources.map(s=>[s.id,s.ref]),[['s2','브랜드 자료 #2'],['s3','브랜드 자료 #3']])&&insightDigest.archive.omittedSources===1);
check('insight digest drops observations (no channel/performance) and adds them to omittedObservations',insightDigest.archive.observations.length===0&&insightDigest.archive.omittedObservations===3);
check('digest report carries revision and counts only',same(insightDigest.report,{revision:3,sources:2,sourcesOmitted:1,observations:0,observationsOmitted:2,summarized:0}));
const contentDigest=diet.archiveDigest(arch,'content'),s1=contentDigest.archive.confirmedSources.find(s=>s.id==='s1');
check('content digest keeps the channel source as a summary with excerpt:true and the same key order',s1&&s1.content.length<=diet.SOURCE_SUMMARY_CHARS+2&&s1.excerpt===true&&same(Object.keys(s1),['ref','id','category','content','excerpt']));
check('digest is deterministic (same archive → same digest)',same(diet.archiveDigest(arch,'content'),contentDigest)&&same(diet.archiveDigest(arch,null).archive.confirmedSources.map(s=>s.id),['s1','s2','s3']));
check('brief digest (role null) keeps every category and observation',diet.archiveDigest(arch,null).report.sourcesOmitted===0&&diet.archiveDigest(arch,null).archive.observations.length===2);

const bulky={task:{role:'insight'},evidence:{facts:{confirmed:[{key:'주소',value:'가상동 12'}]}},factPolicy:'합성 정책',brandArchive:{confirmedSources:Array.from({length:5},(_,i)=>({id:'b'+i,content:'자'.repeat(1000)})),omittedSources:2,observations:[{id:'ob1',note:'관'.repeat(500)}],omittedObservations:0}};
const tight=diet.capInput(bulky,1800);
check('input cap drops sources from the end until the estimate fits and shows the omitted count',diet.estimateTokens(JSON.stringify(tight.value))<=1800&&tight.report.sources>0&&same(tight.value.brandArchive.confirmedSources.map(s=>s.id),['b0','b1','b2','b3','b4'].slice(0,5-tight.report.sources))&&tight.value.brandArchive.omittedSources===2+tight.report.sources&&same(tight.value.brandArchive.inputCapOmitted,{sources:tight.report.sources,observations:0}));
check('input cap never touches evidence, factPolicy or task',same(tight.value.evidence,bulky.evidence)&&tight.value.factPolicy===bulky.factPolicy&&same(tight.value.task,bulky.task));
const tiny=diet.capInput(bulky,10);
check('input cap then drops observations and still sends when nothing is left to drop',tiny.report.sources===5&&tiny.report.observations===1&&tiny.value.brandArchive.omittedObservations===1&&same(tiny.value.evidence,bulky.evidence));
check('input under the cap is returned unchanged without an omitted mark',same(diet.capInput(bulky,1e6).value,bulky)&&diet.capInput(bulky,1e6).report.sources===0);
check('caps equal the grade-mode input_budget caps (lib/graders/ledger.ts)',diet.ROLE_INPUT_TOKEN_CAP===ledger.INPUT_TOKEN_CAP&&diet.MEETING_INPUT_TOKEN_CAP===ledger.MEETING_INPUT_TOKEN_CAP);

const sample=JSON.stringify({task:{a:1},'이상한 키':'값',brand:{name:'가상'}}),chars=diet.inputChars(sample,'지시');
check('inputChars splits top-level keys and adds up to the input length',chars.total===sample.length&&chars.instructions===2&&Object.values(chars.byKey).reduce((a,b)=>a+b,0)+(Object.keys(JSON.parse(sample)).length-1)+2===sample.length&&'(기타)' in chars.byKey&&!JSON.stringify(chars).includes('가상'));
check('inputChars of a non-JSON input has the total only',same(diet.inputChars('not json'),{total:8}));
check('campaign meta removal drops draftMeta, status and timestamps only',same(Object.keys(diet.dietCampaign({id:'c',title:'t',draftMeta:{},status:'review',createdAt:now,updatedAt:now,budgetConfirmedAt:now,derivedStatus:'x',statusReason:'y',plan:{}})),['id','title','plan']));

// ════ 2) 역할: 같은 요청의 꺼짐/켜짐 조립(평가 쌍과 같은 방법) ════
await seed(server,sql,owner);
const source=(id,category,content,extra={})=>({id,brandId:brand.id,title:'합성 자료 '+id,category,origin:'research',status:'confirmed',url:'https://example.com/'+id,content,scope:'합성 범위',observedAt:now,createdAt:now,version:1,...extra});
const seedArchive=async(o,prefix,revision)=>{
 for(const [i,cat] of ['brand','market','channel','performance','customer'].entries())await put(o,'brand_source',`${prefix}-${cat}`,source(`${prefix}-${cat}`,cat,`${prefix} ${cat} 확인 자료 문장입니다. `.repeat(40+i*20)),brand.id);
 await put(o,'brand_observation',prefix+'-obs',{id:prefix+'-obs',brandId:brand.id,channel:'Instagram',account:'합성 계정',periodStart:'2025-12-01',periodEnd:'2025-12-31',observedAt:now,source:'합성 내보내기',definition:'합성 정의',scope:'organic',method:'export',values:{reach:120,impressions:300},version:1,createdAt:now},brand.id);
 await put(o,'brand_archive_state',brand.id,{id:brand.id,revision,updatedAt:now},brand.id);
};
await seedArchive(owner,'ds',1);
const dietCampaignRow={...roleCampaign,id:'diet-campaign',draftMeta:{id:'dm',generatedAt:now,model:'mock',values:{goal:roleCampaign.goal},questions:[],assumptions:['합성 가정'],contextUsed:['합성 맥락']}};
await put(owner,'campaign',dietCampaignRow.id,dietCampaignRow);
for(const role of roleIds)await put(owner,'artifact','da-'+role,{id:'da-'+role,campaignId:dietCampaignRow.id,campaignVersion:1,role,title:'합성 '+role,content:role==='quality'?'## 합성 검수\n\n'+'검수 문장입니다. '.repeat(50):contractArtifact(role),version:1,status:'review',origin:'ai',createdAt:now},dietCampaignRow.id);
const requestFor=async(o,campaignId,role)=>{const c=await server.readRecord(o,'campaign',campaignId);return execution.roleRequestFor(o,c,role,await execution.roleSources(o,c,role),await server.readRecord(o,'brand',brand.id))};
const rows=[];
for(const role of roleIds){
 const request=await requestFor(owner,dietCampaignRow.id,role),off=execution.roleSubmission(request),on=execution.roleSubmission(request,{inputDiet:true}),a=JSON.parse(off.input),b=JSON.parse(on.input);
 rows.push({role,off:off.input.length,on:on.input.length,offKeys:diet.inputChars(off.input).byKey,onKeys:diet.inputChars(on.input).byKey});
 check(`${role}: default (evaluation) assembly has no diet report`,!('diet' in off));
 check(`${role}: on input is shorter than off`,on.input.length<off.input.length);
 check(`${role}: instructions (evidence discipline, fact policy, output contract wording) are identical on/off`,on.instructions===off.instructions);
 check(`${role}: confirmed facts, prohibited/candidate facts, directives and factPolicy are unchanged`,same(b.evidence,a.evidence)&&b.evidence.facts.confirmed.length>0&&b.factPolicy===a.factPolicy);
 check(`${role}: task keeps the output contract and drops only the deliverable duplicate`,same(b.task.outputContract,a.task.outputContract)&&'deliverable' in a.task&&!('deliverable' in b.task)&&same(Object.keys(b.task),Object.keys(a.task).filter(k=>k!=='deliverable')));
 check(`${role}: campaign drops draftMeta, status and timestamps and keeps the brief fields`,'draftMeta' in a.campaign&&['draftMeta','status','createdAt','updatedAt'].every(k=>!(k in b.campaign))&&b.campaign.goal===a.campaign.goal&&b.campaign.ref===a.campaign.ref&&b.campaign.budgetStatus===a.campaign.budgetStatus);
 check(`${role}: digest source ids are a subset of the full archive ids and the omitted count adds up`,b.brandArchive.confirmedSources.every(s=>a.brandArchive.confirmedSources.some(x=>x.id===s.id&&x.ref===s.ref))&&b.brandArchive.omittedSources===a.brandArchive.omittedSources+on.diet.archive.sourcesOmitted+on.diet.cap.sources);
 check(`${role}: diet report names the version and archive revision 1`,on.diet.version==='input-diet-v1'&&on.diet.archive.revision===1);
 // 품질 담당은 앞선 작업물 7개(각 24,000자 한도)를 받아 역할 상한(추정 32,000토큰)을 넘을 수 있다. 넘으면 브랜드 자료부터 빼고 그 수를 표시한다.
 check(`${role}: the input cap mark matches the report (omitted count shown only when the cap was hit)`,on.diet.cap.sources||on.diet.cap.observations?same(b.brandArchive.inputCapOmitted,{sources:on.diet.cap.sources,observations:on.diet.cap.observations}):!('inputCapOmitted' in b.brandArchive));
 if(role==='quality')check('quality: predecessors under the 24,000-char limit are sent whole on and off',b.previous.every((p,i)=>p.content===a.previous[i].content&&p.excerpt===false));
 else if(role!=='cmo')check(`${role}: predecessor cmo artifact carries its last section on, and loses it off`,b.previous[0].content.includes(LAST)&&!a.previous[0].content.includes(LAST)&&b.previous[0].excerpt===true);
}
const insightOn=JSON.parse(execution.roleSubmission(await requestFor(owner,dietCampaignRow.id,'insight'),{inputDiet:true}).input);
check('insight digest has no channel/performance sources and no observations',insightOn.brandArchive.confirmedSources.every(s=>!['channel','performance'].includes(s.category))&&insightOn.brandArchive.observations.length===0&&insightOn.brandArchive.omittedObservations===1);
const growthOn=JSON.parse(execution.roleSubmission(await requestFor(owner,dietCampaignRow.id,'growth'),{inputDiet:true}).input);
check('growth digest keeps channel and performance sources and the observation',['ds-channel','ds-performance'].every(id=>growthOn.brandArchive.confirmedSources.some(s=>s.id===id))&&growthOn.brandArchive.observations.length===1);
if(process.env.INPUT_DIET_TABLE)console.error(['| 역할 | 꺼짐 입력 문자 | 켜짐 입력 문자 | 감소 | 꺼짐 brandArchive | 켜짐 brandArchive | 꺼짐 previous | 켜짐 previous |','|---|---:|---:|---:|---:|---:|---:|---:|',...rows.map(r=>`| ${r.role} | ${r.off} | ${r.on} | ${((1-r.on/r.off)*100).toFixed(1)}% | ${r.offKeys.brandArchive} | ${r.onKeys.brandArchive} | ${r.offKeys.previous} | ${r.onKeys.previous} |`)].join('\n'));

// ════ 3) revision 변경 뒤 옛 digest 재사용 0 ════
const before=execution.roleSubmission(await requestFor(owner,dietCampaignRow.id,'strategy'),{inputDiet:true});
await put(owner,'brand_source','ds-market',source('ds-market','market','NEW-REVISION-MARK 바뀐 시장 자료입니다. '.repeat(30),{version:2}),brand.id);
await put(owner,'brand_archive_state',brand.id,{id:brand.id,revision:2,updatedAt:now},brand.id);
const after=execution.roleSubmission(await requestFor(owner,dietCampaignRow.id,'strategy'),{inputDiet:true}),afterInput=JSON.parse(after.input);
check('after an archive revision change the digest is rebuilt from the new revision (no stale digest)',before.diet.archive.revision===1&&after.diet.archive.revision===2&&afterInput.brandArchive.revision===2&&after.input.includes('NEW-REVISION-MARK')&&!after.input.includes('ds market 확인 자료')&&before.input.includes('ds market 확인 자료'));

// ════ 4) 다른 소유자 digest 섞임 0 (같은 브랜드 id, 다른 자료) ════
await seed(server,sql,other);await seedArchive(other,'ot',5);
await put(other,'campaign',dietCampaignRow.id,dietCampaignRow);
const otherOn=execution.roleSubmission(await requestFor(other,dietCampaignRow.id,'strategy'),{inputDiet:true}),mineOn=execution.roleSubmission(await requestFor(owner,dietCampaignRow.id,'strategy'),{inputDiet:true});
check('another owner with the same brand id gets only its own sources and revision',JSON.parse(otherOn.input).brandArchive.confirmedSources.every(s=>s.id.startsWith('ot-'))&&otherOn.diet.archive.revision===5&&!otherOn.input.includes('ds-')&&!mineOn.input.includes('ot-'));

// ════ 5) 운영 역할 실행: 스위치를 보조 모듈이 읽고, 켜짐·꺼짐 제출이 조립 함수와 같고, 계약 기록에 inputChars(항상)·inputDiet(켜짐만)가 남는다 ════
const runCampaign=async(id,enabled)=>{
 const c={...roleCampaign,id};await put(owner,'campaign',id,c);
 await put(owner,'artifact',id+'-cmo',{id:id+'-cmo',campaignId:id,campaignVersion:1,role:'cmo',title:'합성 cmo',content:longCmo,version:1,status:'review',origin:'ai',createdAt:now},id);
 await setDiet(owner,enabled);
 const expected=execution.roleSubmission(await requestFor(owner,id,'insight'),{inputDiet:enabled});
 const started=await (await execution.executeRole(owner,{action:'start',campaignId:id,role:'insight'})).json();
 const body=JSON.parse((await server.readRecord(owner,'hermes_submission',started.id)).body),contract=await server.readRecord(owner,'role_output_contract',started.id);
 await execution.executeRole(owner,{action:'poll',id:started.id});
 return {expected,body,contract,jobId:started.id};
};
const runOff=await runCampaign('diet-run-off',false),runOn=await runCampaign('diet-run-on',true);
check('switch off: the production submission equals the default assembly and the contract has no inputDiet',runOff.body.input===runOff.expected.input&&runOff.body.instructions===runOff.expected.instructions&&!('inputDiet' in runOff.contract));
check('switch on: the production submission equals the diet assembly and carries the last predecessor section',runOn.body.input===runOn.expected.input&&runOn.body.instructions===runOff.body.instructions&&runOn.body.input.includes(LAST)&&!runOff.body.input.includes(LAST));
check('switch on: the role output contract records the diet report (version, revision, counts only)',same(runOn.contract.inputDiet,runOn.expected.diet)&&runOn.contract.inputDiet.archive.revision===2);
check('inputChars is recorded on both runs and adds up to the submitted input',[runOff,runOn].every(r=>r.contract.inputChars.total===r.body.input.length&&r.contract.inputChars.instructions===r.body.instructions.length&&Object.values(r.contract.inputChars.byKey).reduce((a,b)=>a+b,0)+Object.keys(r.contract.inputChars.byKey).length+1===r.body.input.length));
check('the on/off job ids differ only by the input hash (diet version is part of it)',runOff.jobId.split(':').pop()!==runOn.jobId.split(':').pop());
await setDiet(owner,false);

// ════ 6) 회의: 켜짐 회의는 스냅샷에 고정되고, 품질 재검토에 같은 개선본 본문이 한 번만 들어간다 ════
await setDiet(owner,true);
const met=await runMeeting(meeting,server,owner,meetingCampaign,'diet-meeting');
await setDiet(owner,false);
const stored=met.meeting,qualityStep=stored.steps.find(s=>s.phase==='quality'),qualityInput=JSON.parse(met.steps.find(s=>s.step==='quality').input);
check('meeting snapshot fixes the switch at start',stored.snapshot.inputDiet==='input-diet-v1');
check('every step records inputChars and the diet report',stored.steps.every(s=>s.inputChars&&s.inputChars.total>0&&s.inputDiet?.version==='input-diet-v1'));
const REVISED='안내 카드 문안과 배포 조건을 구체화했습니다';
const offQuality=meetingInput.buildMeetingSubmission(stored,qualityStep.id,[]),onQuality=meetingInput.buildMeetingSubmission(stored,qualityStep.id,[],{inputDiet:true});
check('quality step: the stored submission equals the diet assembly of the same record',onQuality.input===met.steps.find(s=>s.step==='quality').input);
check('quality step: revision bodies appear once (candidateArtifacts) on, twice off',count(onQuality.input,REVISED)===qualityInput.completedRevisions.length&&count(offQuality.input,REVISED)===2*qualityInput.completedRevisions.length);
check('quality step: originalArtifacts are id/version/length only and completedRevisions keep title and changes without content',qualityInput.originalArtifacts.every(a=>same(Object.keys(a),['ref','id','role','version','length']))&&qualityInput.completedRevisions.every(r=>!('content' in r)&&r.title&&r.changes)&&qualityInput.candidateArtifacts.every(a=>typeof a.content==='string'&&a.content.length>0));
check('quality step: evidence and instructions are identical on/off',same(qualityInput.evidence,JSON.parse(offQuality.input).evidence)&&onQuality.instructions===offQuality.instructions);
const discussionInput=JSON.parse(met.steps.find(s=>s.step==='discussion:insight').input);
check('discussion step: campaign meta removed and archive digest applied for the step role',!('status' in discussionInput.campaign)&&!('updatedAt' in discussionInput.campaign)&&discussionInput.brandArchive.confirmedSources.every(s=>!['channel','performance'].includes(s.category)));
// 꺼짐 회의: 스냅샷에 키가 없고 단계 제출은 기본 조립과 같다. inputChars만 기록된다.
const offStart=await (await meeting.executeMeeting(owner,{action:'start',id:'diet-meeting-off',campaignId:meetingCampaign.id,campaignVersion:meetingCampaign.version,agenda:'합성 안건: 꺼짐 확인.'})).json();
await meeting.executeMeeting(owner,{action:'advance',id:'diet-meeting-off'});
const offMeeting=await server.readRecord(owner,'team_meeting','diet-meeting-off'),offStep=offMeeting.steps[0],offBody=JSON.parse((await server.readRecord(owner,'hermes_submission',offStep.id)).body);
check('switch off meeting: no snapshot key, first step equals the default assembly, inputChars recorded without inputDiet',offStart.status==='running'&&!('inputDiet' in offMeeting.snapshot)&&offBody.input===meetingInput.buildMeetingSubmission({...offMeeting,steps:offMeeting.steps.map((s,i)=>i?s:{...s,status:'pending'})},offStep.id,[]).input&&offStep.inputChars.total===offBody.input.length&&!('inputDiet' in offStep));
await meeting.executeMeeting(owner,{action:'cancel',id:'diet-meeting-off'});

// ════ 7) 브리프: 켜짐 초안은 브랜드 자료 digest, 꺼짐은 이전과 같다 ════
const briefData={brandId:brand.id,title:'가상분식 입력 축소 초안',goal:'첫 방문 고객의 재방문을 만든다.',audience:'가상동 주민(가설)',channels:'YouTube',stores:'가상동 12',products:'떡볶이(가격 미확정)',budget:null,startDate:'',endDate:'',constraints:'',sources:''};
await setDiet(owner,true);
await briefExec.executeBrief(owner,{action:'start',id:'diet-brief-on',data:briefData});
await briefExec.executeBrief(owner,{action:'poll',id:'diet-brief-on'});
await setDiet(owner,false);
await briefExec.executeBrief(owner,{action:'start',id:'diet-brief-off',data:briefData});
const draftOn=await server.readRecord(owner,'brief_draft','diet-brief-on'),draftOff=await server.readRecord(owner,'brief_draft','diet-brief-off');
const briefOn=JSON.parse(JSON.parse((await server.readRecord(owner,'hermes_submission','brief-diet-brief-on')).body).input),briefOff=JSON.parse(JSON.parse((await server.readRecord(owner,'hermes_submission','brief-diet-brief-off')).body).input);
check('brief on: sources are summarized digests with ids kept, facts unchanged, report recorded',draftOn.inputDiet?.version==='input-diet-v1'&&same(briefOn.brandArchive.confirmedSources.map(s=>s.id),briefOff.brandArchive.confirmedSources.map(s=>s.id))&&briefOn.brandArchive.confirmedSources.every(s=>s.content.length<=diet.SOURCE_SUMMARY_CHARS+2)&&same(briefOn.evidence,briefOff.evidence)&&JSON.stringify(briefOn).length<JSON.stringify(briefOff).length);
check('brief off: no inputDiet key and inputChars recorded',!('inputDiet' in draftOff)&&draftOff.inputChars.total===JSON.stringify(briefOff).length);
const briefRequest=JSON.parse(JSON.stringify(briefInput.briefRequestFor(await briefExec.briefSources(owner,{input:draftOff.input,contextDate:draftOff.createdAt.slice(0,10)}))));
check('brief assembly default is off (evaluation path) and on differs only when asked',!('diet' in briefInput.buildBriefSubmission(briefRequest))&&'diet' in briefInput.buildBriefSubmission(briefRequest,{inputDiet:true}));

// ════ 8) 레인 Q 쌍 평가 연결점: 평가 동결 요청(lib/eval-freeze.ts, 읽기만)에 INPUT_DIET_SIDES를 넘겨 두 쪽 본문을 만든다 ════
const freeze=await load('lib/eval-freeze.ts'),{off:OFF,on:ON}=diet.INPUT_DIET_SIDES;
check('pair kind and sides are fixed values (active off, candidate on)',diet.INPUT_DIET_PAIR_KIND==='input_diet'&&same(diet.INPUT_DIET_SIDES,{off:{inputDiet:false},on:{inputDiet:true}}));
// 역할: 운영 캡처와 같은 JSON 동결본. off 쪽은 인자 없는 기본 조립(지금 평가 build)과 바이트 동일하다.
const frozenRole=JSON.parse(JSON.stringify(await requestFor(owner,dietCampaignRow.id,'strategy'))),roleOff=execution.roleSubmission(frozenRole,OFF),roleOn=execution.roleSubmission(frozenRole,ON);
check('role pair: frozen request has no switch key, off equals the current evaluation build, on differs only in input',!('inputDiet' in frozenRole)&&roleOff.input===execution.roleSubmission(frozenRole).input&&roleOff.instructions===roleOn.instructions&&roleOn.input.length<roleOff.input.length&&same(JSON.parse(roleOn.input).evidence,JSON.parse(roleOff.input).evidence));
// 회의 단계: 켜짐 회의 기록을 동결해도 스위치 상태가 남지 않아 두 쪽이 인자로만 갈린다. 품질 재검토 쌍은 개선본 본문 중복 여부가 기대 차이다.
const frozenMeeting=freeze.freezeMeetingRequest(stored,qualityStep.id,[]),meetOff=meetingInput.buildMeetingSubmission(frozenMeeting.meeting,frozenMeeting.stepId,frozenMeeting.storeAllow,OFF),meetOn=meetingInput.buildMeetingSubmission(frozenMeeting.meeting,frozenMeeting.stepId,frozenMeeting.storeAllow,ON);
check('meeting pair: frozen record drops snapshot.inputDiet, off equals the current evaluation build, on removes the duplicate revision body',!('inputDiet' in frozenMeeting.meeting.snapshot)&&meetOff.input===freeze.buildMeetingRequest(frozenMeeting).input&&meetOff.instructions===meetOn.instructions&&count(meetOn.input,REVISED)*2===count(meetOff.input,REVISED)&&meetOn.input.length<meetOff.input.length);
// 브리프: 동결본 두 쪽. 지금 평가는 브리프를 쌍 평가에서 뺀다(레지스트리 단위 없음). 입력 축소 쌍은 대상이 될 수 있다.
const frozenBrief=freeze.freezeBriefRequest(briefRequest),briefPairOff=briefInput.buildBriefSubmission(frozenBrief,OFF),briefPairOn=briefInput.buildBriefSubmission(frozenBrief,ON);
check('brief pair: off equals the default build, on keeps instructions and facts and shortens the archive',briefPairOff.input===briefInput.buildBriefSubmission(frozenBrief).input&&briefPairOff.instructions===briefPairOn.instructions&&same(JSON.parse(briefPairOn.input).evidence,JSON.parse(briefPairOff.input).evidence)&&briefPairOn.input.length<briefPairOff.input.length);

// ════ 9) 스위치·구조 ════
check('input_diet is a known flag, off by default',flags.FEATURE_FLAGS.input_diet?.defaultEnabled===false&&await flags.isEnabled('diet-nobody','input_diet')===false);
check('no external calls',hermes.external.length===0);
check('agency roles cover every digest category row',agency.roles.every(r=>Object.hasOwn(diet.ROLE_ARCHIVE_CATEGORIES,r.id)&&Object.hasOwn(diet.HANDOFF_SECTIONS,r.id)));
console.log(JSON.stringify({passed:passed.length},null,1));
