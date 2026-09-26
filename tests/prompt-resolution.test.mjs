// 프롬프트 레지스트리 해석·기록(F3a): 공용 해석기(역할 실행·회의)·캠페인 고정(pin)·promptVersion 기록(작업물·learning_snapshot·provider_usage·회의 스냅샷)·폴백.
// 코드 기본값과 같은 본문을 활성화하면 역할·회의·바이럴 지시와 입력은 기준 커밋과 바이트 동일하고, 역할 inputHash 변화는 promptVersion 키 추가분뿐이다(독립 오라클로 재계산).
// 회의 입력에는 작업물 실행 메타(promptVersion·promptFallback·promptRecheck)를 싣지 않는다.
// 근거: mocked(raw.githubusercontent.com·HERMES fetch 스텁, 메모리 SQLite, 합성 데이터). 포인터는 테스트 헬퍼로 직접 설정한다(활성화 게이트는 F3b).
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {testRuntime} from './helpers/runtime.mjs';
import {sha,seed,mockHermes,runRole,runMeeting,roleCampaign,meetingCampaign,brand,now,rawGithub,setRelease,SOURCE_SHA} from './helpers/prompt-seed.mjs';

const raw=rawGithub(),hermes=mockHermes(raw.handler);
const {sql,load}=testRuntime(hermes.fetch);
const server=await load('lib/server.ts'),route=await load('app/api/prompts/route.ts'),execution=await load('lib/role-execution.ts'),meeting=await load('lib/meeting-execution.ts'),learning=await load('lib/learning-execution.ts');
const practice=await load('lib/practice.ts'),roleOutput=await load('lib/role-output.ts'),archiveServer=await load('lib/archive-server.ts'),aiContext=await load('lib/ai-context.ts'),learningServer=await load('lib/learning-server.ts'),units=await load('lib/prompt-units.ts'),policy=await load('lib/campaign-policy.ts');
const owner='pr-res-owner',passed=[];
const check=(name,fn)=>{fn();passed.push(name)};
const put=await seed(server,sql,owner);
const fixture=JSON.parse(readFileSync('tests/fixtures/'+readdirSync('tests/fixtures').find(f=>/^prompt-baseline-[0-9a-f]{7}\.json$/.test(f)),'utf8'));
const digest=text=>({sha256:sha(text),length:String(text).length});
const post=input=>route.POST(new Request('https://agency.test/api/prompts',{method:'POST',headers:{'oai-authenticated-user-id':owner,'content-type':'application/json'},body:JSON.stringify(input)})).then(async res=>({status:res.status,body:await res.json()}));
const usageOf=async jobId=>{const provider=sql.prepare('SELECT provider_id FROM jobs WHERE id=?').get(jobId).provider_id;return server.readRecord(owner,'provider_usage','hermes:'+provider)};
const snapshotOf=jobId=>server.readRecord(owner,'learning_snapshot',jobId);
const artifactOf=async(c,role)=>(await server.listRecords(owner,'artifact',c.id)).find(a=>a.role===role&&a.status!=='outdated');
const pinOf=c=>server.readRecord(owner,'campaign_prompt_pin',c.id).catch(()=>null);
const f2a=instructions=>`${practice.PRACTICE_VERSION}:${sha(instructions).slice(0,12)}`;
// 독립 오라클: lib/role-execution.ts start 분기의 inputHash 입력을 같은 순서로 다시 만든다(총괄 파트너, 앞선 작업물·회의·재작성 없음).
async function oracleHash(c,extra={}){
 const artifacts=await server.listRecords(owner,'artifact',c.id);
 const payload={outputContractVersion:roleOutput.ROLE_OUTPUT_VERSION,repairSources:artifacts.filter(a=>a.role==='cmo'&&a.status!=='outdated').map(a=>({id:a.id,version:a.version,status:a.status})),skillVersion:practice.PRACTICE_VERSION,version:c.version,brand:await server.readRecord(owner,'brand',c.brandId),archive:await archiveServer.brandArchiveContext(owner,c.brandId,c.storeId),evidence:await aiContext.evidenceContext(server.database(),owner,c),learning:await learningServer.learningContext(owner,c),role:'cmo',previous:[],...extra};
 return sha(JSON.stringify(payload)).slice(0,20);
}

// 1) 레지스트리가 비어 있음: 코드 상수. 기준 fixture와 같은 inputHash, F2a promptVersion이 작업물·learning_snapshot·provider_usage에서 일치.
const codeHash=await oracleHash(roleCampaign);
const code=await runRole(execution,server,owner,roleCampaign,'cmo');
check('empty registry: cmo inputHash equals the base-commit fixture and the independent oracle',()=>assert.ok(code.inputHash===fixture.roles[0].inputHash&&code.inputHash===codeHash));
check('empty registry: cmo instructions and input equal the base-commit fixture',()=>assert.ok(digest(code.instructions).sha256===fixture.roles[0].instructions.sha256&&digest(code.input).sha256===fixture.roles[0].input.sha256));
const codeArtifact=await artifactOf(roleCampaign,'cmo'),codeUsage=await usageOf(code.jobId),codeSnapshot=await snapshotOf(code.jobId);
check('code run records the F2a promptVersion on artifact, snapshot and provider usage alike',()=>assert.ok(codeArtifact.promptVersion===f2a(code.instructions)&&codeSnapshot.promptVersion===codeArtifact.promptVersion&&codeUsage.promptVersion===codeArtifact.promptVersion&&codeSnapshot.promptSource==='code'));
check('code run has no fallback mark',()=>assert.ok(!codeArtifact.promptFallback&&!codeSnapshot.promptFallback&&!codeUsage.promptFallback));
check('code run writes no campaign pin',()=>assert.equal(sql.prepare("SELECT COUNT(*) n FROM records WHERE kind='campaign_prompt_pin'").get().n,0));

// 2) 모든 단위를 API로 등록(코드 기본값과 같은 본문)하고 포인터를 직접 설정한다.
raw.publishRepo(SOURCE_SHA);raw.publishRepo('main');
// A1 정본은 새 후보다. 이 절의 '코드와 같은 본문' 대조는 실제 코드 폴백을 명시적으로 등록한다.
for(const ref of [SOURCE_SHA,'main'])raw.publish(ref,'channel.offline',units.codeUnitBody('channel.offline'));
const ids={};
for(const u of units.promptUnits){const r=await post({action:'register',unit:u.unit,sourceSha:SOURCE_SHA});ids[u.unit]=r.body.version?.id;await setRelease(server,owner,u.unit,ids[u.unit])}
check('all 22 units registered',()=>assert.equal(Object.values(ids).filter(Boolean).length,22));
await put('artifact',codeArtifact.id,{...codeArtifact,status:'outdated'},roleCampaign.id);
const expected=['role.cmo','channel.shortform','channel.search','channel.offline'].map(u=>ids[u]).join('+');
const regHash=await oracleHash(roleCampaign,{promptVersion:expected});
const reg=await runRole(execution,server,owner,roleCampaign,'cmo');
check('code-identical registry: instructions are byte-identical to the code run',()=>assert.equal(reg.instructions,code.instructions));
check('code-identical registry: input is byte-identical to the code run',()=>assert.equal(reg.input,code.input));
check('code-identical registry: inputHash differs only by the added promptVersion key',()=>assert.ok(reg.inputHash!==code.inputHash&&reg.inputHash===regHash&&code.inputHash===codeHash));
const regArtifact=await artifactOf(roleCampaign,'cmo'),regUsage=await usageOf(reg.jobId),regSnapshot=await snapshotOf(reg.jobId);
check('registry promptVersion is unit@sha256[0..12] of the role and applied channel units',()=>assert.equal(regArtifact.promptVersion,expected));
check('artifact, learning_snapshot and provider_usage share the registry promptVersion (F2a join key)',()=>assert.ok(regSnapshot.promptVersion===expected&&regSnapshot.promptSource==='registry'&&regUsage.promptVersion===expected));
const pin=await pinOf(roleCampaign),campaignUnits=units.promptUnits.filter(u=>u.kind!=='viral').map(u=>u.unit);
check('the campaign pin fixes every campaign unit (not the brand-level viral unit)',()=>assert.ok(pin.campaignVersion===1&&JSON.stringify(Object.keys(pin.units).sort())===JSON.stringify([...campaignUnits].sort())&&pin.promptVersion===campaignUnits.map(u=>ids[u]).join('+')));

// 2b) 가맹 모집 objective 캠페인(R3b): 같은 레지스트리에서 역할 단위와 objective로 켜진 채널 단위(shortform·franchise·keyword·leadad)만 promptVersion에 들어간다.
// 소비자 채널 단위(search·offline)는 빠지고, 입력 channelPractice는 코드 조립과 같으며, 지시문은 소비자 30일 정의 자리에 가맹 모집 규칙이 들어간다.
const objectiveCampaign={...roleCampaign,id:'pr-role-objective',objective:'franchise_recruitment'};
const objectiveRun=await runRole(execution,server,owner,objectiveCampaign,'cmo');
const objectiveExpected=['role.cmo','channel.shortform','channel.franchise','channel.keyword','channel.leadad'].map(u=>ids[u]).join('+');
const objectiveArtifact=await artifactOf(objectiveCampaign,'cmo');
check('objective role run completes and records role.cmo, shortform, franchise, keyword and leadad versions',()=>assert.ok(objectiveRun.status==='completed'&&objectiveExpected.split('+').every(x=>/@[0-9a-f]{12}$/.test(x))&&objectiveArtifact.promptVersion===objectiveExpected,JSON.stringify({status:objectiveRun.status,pv:objectiveArtifact?.promptVersion})));
check('objective role input channelPractice equals the code assembly for the campaign',()=>assert.equal(JSON.parse(objectiveRun.input).channelPractice,practice.campaignPractice(objectiveCampaign)));
check('objective role instructions replace only the 30-day definition with the franchise policy',()=>assert.equal(objectiveRun.instructions,code.instructions.replace(policy.measurementDiscipline,()=>policy.franchiseEvidencePolicy)));
check('the consumer expectation is unchanged by the objective run',()=>assert.equal(expected,['role.cmo','channel.shortform','channel.search','channel.offline'].map(u=>ids[u]).join('+')));

// 3) 회의: 같은 공용 해석기. 코드 기본값과 같은 본문이면 단계별 지시·입력이 기준 커밋과 바이트 동일하다.
const met=await runMeeting(meeting,server,owner,meetingCampaign,'pr-meeting');
for(const [i,s] of met.steps.entries())check(`meeting ${s.step} submission is byte-identical to the base commit`,()=>assert.ok(digest(s.instructions).sha256===fixture.meeting[i].instructions.sha256&&digest(s.input).sha256===fixture.meeting[i].input.sha256&&s.step===fixture.meeting[i].step));
const mp=met.meeting.snapshot.prompts,meetingPin=await pinOf(meetingCampaign);
check('meeting snapshot records the pinned registry resolution',()=>assert.ok(mp.source==='registry'&&mp.promptVersion===meetingPin.promptVersion&&JSON.stringify(mp.units)===JSON.stringify(meetingPin.units)));
const stepVersion=role=>[ids['role.'+role],ids['channel.youtube'],ids['channel.community'],ids['channel.commerce']].join('+');
check('each meeting step records its role and channel unit versions',()=>assert.ok(met.meeting.steps.every(s=>s.promptVersion===stepVersion(s.role))));
const meetingArtifacts=(await server.listRecords(owner,'artifact',meetingCampaign.id)).filter(a=>a.meetingId==='pr-meeting');
check('meeting artifacts carry the promptVersion of the step that wrote them',()=>assert.ok(meetingArtifacts.length===3&&meetingArtifacts.every(a=>a.promptVersion===stepVersion(a.role))));
const meetingUsage=sql.prepare("SELECT data FROM records WHERE owner=? AND kind='provider_usage' AND json_extract(data,'$.kind')='meeting'").all(owner).map(r=>JSON.parse(r.data));
check('meeting provider usage rows carry the same step promptVersion',()=>assert.ok(meetingUsage.length===met.steps.length&&meetingUsage.every(u=>u.promptVersion===stepVersion(u.role))));

// 4) 바이럴 발견 지시: 코드 기본값과 같은 본문이면 지시가 바이트 동일하고 작업 입력·사용량에 버전이 남는다.
const discovery=await (await learning.executeLearning(owner,{action:'start_discovery',brandId:brand.id,query:'합성 조사 주제'})).json();
const dBody=JSON.parse((await server.readRecord(owner,'hermes_submission',discovery.id)).body),dTask=await server.readRecord(owner,'learning_task',discovery.id);
check('viral discovery instructions stay byte-identical with the registry unit',()=>assert.deepEqual(digest(dBody.instructions),fixture.learning[1].instructions));
check('viral task records the registry version',()=>assert.ok(dTask.promptVersion===ids['viral.discovery']&&dTask.promptSource==='registry'));
await learning.executeLearning(owner,{action:'poll',id:discovery.id});
const dUsage=await usageOf(discovery.id);
check('viral provider usage records the registry version',()=>assert.equal(dUsage.promptVersion,ids['viral.discovery']));

// 5) 다른 본문 활성화: 이미 고정한 캠페인은 고정 버전을 쓰고, 새 캠페인은 새 active를 쓴다.
const V2='f3a5'.repeat(10),insightBody={...raw.repoBody('role.insight'),focus:'합성 개선 초점: 선택 장벽 하나를 먼저 확인한다'};
raw.publish(V2,'role.insight',insightBody);raw.publish('main','role.insight',insightBody);
const insightV2=(await post({action:'register',unit:'role.insight',sourceSha:V2})).body.version.id;
await setRelease(server,owner,'role.insight',insightV2,{previous:ids['role.insight']});
const pinned=await runRole(execution,server,owner,roleCampaign,'insight');
check('a pinned campaign keeps its pinned insight version',()=>assert.ok(pinned.status==='completed'&&!pinned.instructions.includes(insightBody.focus)&&digest(pinned.instructions).sha256===fixture.roles[1].instructions.sha256));
const fresh={...roleCampaign,id:'pr-res-campaign-2'};await put('campaign',fresh.id,fresh);
await runRole(execution,server,owner,fresh,'cmo');const freshInsight=await runRole(execution,server,owner,fresh,'insight');
check('a new campaign resolves the new active body',()=>assert.ok(freshInsight.status==='completed'&&freshInsight.instructions.includes(insightBody.focus)));
check('the new body changes only the role skill text, not the code-owned sections',()=>assert.equal(freshInsight.instructions.replace(insightBody.focus,raw.repoBody('role.insight').focus),pinned.instructions));
const freshSnapshot=await snapshotOf(sql.prepare("SELECT id FROM jobs WHERE campaign_id=? AND role='insight'").get(fresh.id).id);
check('the new campaign records the new insight version',()=>assert.ok(freshSnapshot.promptVersion.split('+').includes(insightV2)));
// 회의도 같은 해석기로 새 본문을 쓴다: 역할 스킬은 지시에, 채널 스킬은 입력의 channelPractice에 들어간다.
const youtubeBody='영상 채널 합성 개선: 제목·썸네일 약속을 도입부에서 먼저 회수하고 시청 지속과 사업 전환을 따로 정의.';
raw.publish(V2,'channel.youtube',youtubeBody);raw.publish('main','channel.youtube',youtubeBody);
const youtubeV2=(await post({action:'register',unit:'channel.youtube',sourceSha:V2})).body.version.id;
await setRelease(server,owner,'channel.youtube',youtubeV2,{previous:ids['channel.youtube']});
const mc2={...meetingCampaign,id:'pr-res-meeting-2'};await put('campaign',mc2.id,mc2);
await meeting.executeMeeting(owner,{action:'start',id:'pr-meeting-2',campaignId:mc2.id,campaignVersion:1,agenda:'합성 안건: 새 본문 확인'});
const submitted=id=>server.readRecord(owner,'hermes_submission',id).then(x=>JSON.parse(x.body)).catch(()=>null);
let insightStep=null;for(let i=0;i<8&&!insightStep;i++){await meeting.executeMeeting(owner,{action:'advance',id:'pr-meeting-2'});insightStep=await submitted('pr-meeting-2:discussion:insight')}
check('a meeting on a new campaign puts the registry role body in the step instructions',()=>assert.ok(insightStep&&insightStep.instructions.includes(insightBody.focus)));
check('a meeting on a new campaign puts the registry channel body in the step input',()=>assert.ok(JSON.parse(insightStep.input).channelPractice.includes(youtubeBody)));
const m2=await server.readRecord(owner,'team_meeting','pr-meeting-2');
check('the new meeting step records the new role and channel versions',()=>assert.ok(m2.steps.find(s=>s.role==='insight'&&s.phase==='discussion').promptVersion===[insightV2,youtubeV2,ids['channel.community'],ids['channel.commerce']].join('+')));

// A1 후보는 등록만으로 운영을 바꾸지 않는다. 포인터 변경 뒤 새 캠페인에만 채널 본문이 들어간다.
const offlineCandidate=raw.repoBody('channel.offline'),A1_SHA='a1'.repeat(20);
raw.publish(A1_SHA,'channel.offline',offlineCandidate);raw.publish('main','channel.offline',offlineCandidate);
const a1Registration=await post({action:'register',unit:'channel.offline',sourceSha:A1_SHA});
check('the canonical A1 candidate registers through the existing validator',()=>assert.equal(a1Registration.status,200));
const beforeA1={...roleCampaign,id:'pr-offline-before'};await put('campaign',beforeA1.id,beforeA1);
const beforeA1Run=await runRole(execution,server,owner,beforeA1,'cmo');
check('registering the candidate without activation keeps the old channel input',()=>assert.equal(JSON.parse(beforeA1Run.input).channelPractice,JSON.parse(code.input).channelPractice));
const beforeA1Pin=await pinOf(beforeA1);
check('the pre-activation campaign pins the old offline version',()=>assert.equal(beforeA1Pin.units['channel.offline'],ids['channel.offline']));
await setRelease(server,owner,'channel.offline',a1Registration.body.version.id,{previous:ids['channel.offline']});
const afterA1={...roleCampaign,id:'pr-offline-after'};await put('campaign',afterA1.id,afterA1);
const afterA1Run=await runRole(execution,server,owner,afterA1,'cmo');
check('a newly resolved campaign receives the activated offline candidate',()=>assert.ok(JSON.parse(afterA1Run.input).channelPractice.includes(offlineCandidate)));
check('offline activation keeps code-owned role instructions unchanged',()=>assert.equal(afterA1Run.instructions,code.instructions));
const a1Registry=await load('lib/prompt-registry.ts');
const keptA1=await a1Registry.resolveCampaignPrompts(owner,beforeA1);
check('activation does not rewrite an existing campaign pin',()=>assert.equal(keptA1.units['channel.offline'],ids['channel.offline']));

// 6) 지정 캠페인(stagedCampaignIds): 목록에 없는 캠페인과 캠페인 없는 학습에는 적용하지 않는다.
const registry=await load('lib/prompt-registry.ts');
await setRelease(server,owner,'channel.default',ids['channel.default'],{stagedCampaignIds:['pr-staged-only']});
const staged=await registry.resolveCampaignPrompts(owner,{id:'pr-staged-only',version:1}),other=await registry.resolveCampaignPrompts(owner,{id:'pr-not-staged',version:1});
check('a staged release applies only to its listed campaigns',()=>assert.ok(staged.units['channel.default']===ids['channel.default']&&!other.units['channel.default']));

// 7) 폴백: 버전 레코드 손상 → 코드 상수로 실행하고 fallback 표시. inputHash에 promptVersion 키가 없다.
sql.prepare("UPDATE records SET data=json_set(data,'$.body.focus','합성 변조') WHERE owner=? AND kind='prompt_version' AND json_extract(data,'$.id')=?").run(owner,ids['role.cmo']);
const broken={...roleCampaign,id:'pr-res-campaign-3'};await put('campaign',broken.id,broken);
const brokenHash=await oracleHash(broken);
const fb=await runRole(execution,server,owner,broken,'cmo');
const fbArtifact=await artifactOf(broken,'cmo'),fbUsage=await usageOf(fb.jobId),fbSnapshot=await snapshotOf(fb.jobId);
check('a corrupt version runs on the code constants (instructions identical to the code run)',()=>assert.ok(fb.status==='completed'&&fb.instructions===code.instructions));
check('fallback inputHash has no promptVersion key',()=>assert.equal(fb.inputHash,brokenHash));
check('fallback is marked on snapshot, artifact and provider usage with the F2a promptVersion',()=>assert.ok(fbSnapshot.promptFallback==='corrupt_record'&&fbSnapshot.promptSource==='code'&&fbArtifact.promptFallback==='corrupt_record'&&fbUsage.promptFallback==='corrupt_record'&&fbUsage.promptVersion===f2a(fb.instructions)&&fbArtifact.promptVersion===fbUsage.promptVersion));
check('a failed resolution writes no pin for that campaign',()=>assert.equal(sql.prepare("SELECT COUNT(*) n FROM records WHERE kind='campaign_prompt_pin' AND parent_id=?").get(broken.id).n,0));
sql.prepare('INSERT INTO records(id,owner,kind,parent_id,data,updated_at) VALUES(?,?,?,?,?,?)').run(`${owner}:prompt_release:broken`,owner,'prompt_release','','{not json',new Date().toISOString());
const lost={...roleCampaign,id:'pr-res-campaign-4'};await put('campaign',lost.id,lost);
const lf=await runRole(execution,server,owner,lost,'cmo');
check('an unreadable release list runs on the code constants marked lookup_failed',()=>assert.ok(lf.instructions===code.instructions));
const lfSnapshot=await snapshotOf(lf.jobId);
check('lookup failure is recorded on the run snapshot',()=>assert.equal(lfSnapshot.promptFallback,'lookup_failed'));
const lfDiscovery=await (await learning.executeLearning(owner,{action:'start_discovery',brandId:brand.id,query:'합성 조사 주제 2'})).json();
const lfTask=await server.readRecord(owner,'learning_task',lfDiscovery.id),lfBody=JSON.parse((await server.readRecord(owner,'hermes_submission',lfDiscovery.id)).body);
check('viral discovery falls back to the code constant and marks the task',()=>assert.ok(lfTask.promptFallback==='lookup_failed'&&!lfTask.promptVersion&&sha(lfBody.instructions)===fixture.learning[1].instructions.sha256));
// 8) 회의 입력에는 작업물 실행 메타가 없다: 레지스트리 버전 id(promptVersion)·폴백 표시·롤백 재확인 표시를 단 작업물로 회의를 열어도 originalArtifacts·candidateArtifacts에 싣지 않는다.
const markArtifact=(c,role,path,value)=>sql.prepare(`UPDATE records SET data=json_set(data,'${path}',json(?)) WHERE owner=? AND kind='artifact' AND parent_id=? AND json_extract(data,'$.role')=? AND json_extract(data,'$.status')!='outdated'`).run(JSON.stringify(value),owner,c.id,role);
markArtifact(fresh,'cmo','$.promptRecheck',{version:ids['role.cmo'],reason:'prompt_rollback',at:now});markArtifact(fresh,'insight','$.promptFallback','lookup_failed');
const marked=(await server.listRecords(owner,'artifact',fresh.id)).filter(a=>a.status!=='outdated');
check('the leak case starts from artifacts that carry registry versions and run marks',()=>assert.ok(marked.length===2&&marked.every(a=>/@[0-9a-f]{12}/.test(a.promptVersion))&&marked.some(a=>a.promptRecheck)&&marked.some(a=>a.promptFallback)));
const leak=await runMeeting(meeting,server,owner,fresh,'pr-meeting-3');
check('meeting inputs carry no promptVersion, promptFallback, promptRecheck or registry version id',()=>assert.ok(leak.meeting.status==='completed'&&leak.steps.every(s=>!/"prompt(?:Version|Fallback|Recheck)"|[a-z]+\.[a-z]+@[0-9a-f]{12}/.test(s.input))));
check('meeting inputs still carry the artifacts themselves (original and quality candidates)',()=>assert.ok(marked.every(a=>leak.steps.every(s=>s.input.includes('"id":'+JSON.stringify(a.id))))));
check('no external network call',()=>assert.deepEqual(hermes.external,[]));
console.log(JSON.stringify({passed:passed.length}));
