// A2 런타임 하향: 기능 스위치 a2_downgrade(기본 꺼짐)가 켜지면 저장된 역할·회의 작업물의 block 위반을 complianceHold로 남기고(compare-and-set),
// 품질 검수 판정을 ready_for_review→revise로만 내린다. checks 5기준·taskChecks는 그대로다. 꺼져 있으면 작업물·grading 기록이 바이트 단위로 같다.
// 근거: mocked(모의 HERMES fetch 스텁, 메모리 SQLite, 로컬 인증 헤더, 합성 브랜드·캠페인·문장). 외부 네트워크 호출은 0회다. 법률 자문이 아니다.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {testRuntime} from './helpers/runtime.mjs';
import {roleFixture} from './helpers/role-fixture.mjs';

const HERMES='https://hermes.example.com';
// 합성 문장. BLOCK은 block 2건(보상 조건 리뷰·영수증 리뷰 이벤트), WARN은 warn만, INFO는 인용 사례라 info만 나온다.
const BLOCK='게시 문안: 영수증 리뷰 작성 시 음료 1잔을 증정합니다.';
const WARN='원산지 안내: 국내산 돼지고기로 만든 순대입니다.\nAI 음성으로 내레이션한 15초 영상을 게시한다.';
const INFO='경쟁점 사례: "리뷰 작성 시 음료 증정". 이는 정책 위반 소지가 있어 우리는 쓰지 않는다.';
const CRITERIA=['evidence','brand','execution','economics','measurement'];
const pass=criterion=>({criterion,status:'pass',location:'콘텐츠 스튜디오 v1 §1',finding:'브리프 목표와 게시 문안을 대조했습니다.',fix:'해당 없음'});
const readyReview={verdict:'ready_for_review',summary:'사용자 검토 준비',findings:'앞선 작업물의 근거와 실행 계획을 대조했습니다.',checks:CRITERIA.map(pass),taskChecks:[]};
// inject: 역할 작업물 첫 섹션 끝에 붙일 문장. qualityOut: 품질 검수 역할 응답. revisionExtra·meetingReady: 회의 개선본 문장과 품질 재검토 판정.
let inject='',qualityOut=null,revisionExtra='',meetingReady=false;
function roleOutput(input){
 const task=JSON.parse(input).task;
 if(task?.role==='quality'&&qualityOut)return JSON.stringify(qualityOut);
 const out=roleFixture(input);
 if(!inject||!task||task.role==='quality')return out;
 const x=JSON.parse(out);return JSON.stringify({...x,sections:x.sections.map((s,i)=>i?s:{...s,content:s.content+'\n'+inject})});
}
// 회의 단계 모의 응답(tests/online-grading.test.mjs와 같은 형식의 합성 문장).
function answer(x){
 if(x.phase==='discussion')return JSON.stringify({position:'실제 브리프를 검토했습니다. 평일 오후 고객은 가격보다 제품 단면과 구매 이유를 먼저 확인한다는 가설이 가장 중요합니다.',evidence:'주어진 브리프만 사용했고 고객 반응은 미측정입니다. 가격과 판매 메뉴는 [자료 필요]이며 매장 담당자가 확인합니다.',challenge:'앞선 제안의 공유 동기와 검증 기준을 보완해야 합니다. 확인되지 않은 인기 표현은 사용하지 않습니다.',proposal:'제품 단면을 먼저 보여주는 첫 장면과 기존 컷을 2주간 공유율로 대조하고, 콘텐츠 담당에게 대조안 두 개를 요청합니다.',respondsTo:x.allowedRespondsTo.length?[x.allowedRespondsTo.at(-1).ref]:[]});
 if(x.phase==='synthesis')return JSON.stringify({decisions:'공유 동기를 드러내는 콘텐츠 실험',disagreements:'기준 없는 할인 제안 보류',questions:'실제 제품 가격 확인',tasks:[{role:'growth',instruction:'배포 설계 개선',reason:'콘텐츠와 측정 연결',acceptance:'배포 조건 명시'},{role:'content',instruction:'완성된 카피와 대본 개선',reason:'첫 장면 반론 반영',acceptance:'대조안과 한 변수 구분'}]});
 if(x.phase==='revision')return JSON.stringify({title:x.role+' 개선본',content:'## 완성된 수정본\n첫 장면과 CTA를 구체화했습니다. 실적은 미측정입니다.\n첫 장면: 떡볶이 단면을 2초 안에 보여 주고 소스 양을 확대합니다. CTA: 평일 오후 포장 시간을 안내합니다.\n대조안: 기존 전체 컷과 단면 컷을 같은 시간대에 게시하고 공유율과 저장률만 비교합니다.\n게시 문안 A: 오늘 오후, 소스가 가득한 단면부터 확인하세요. 게시 문안 B: 퇴근길 포장으로 기다림 없이 받아 가세요.\n[자료 필요] 판매 가격과 포장 가능 시간은 매장 담당자가 게시 전 확인합니다.'+(revisionExtra?'\n'+revisionExtra:''),changes:'인사이트 담당의 반론과 총괄의 조건을 반영했습니다.'});
 if(meetingReady)return JSON.stringify({verdict:'ready_for_review',summary:'사용자 검토 준비',findings:'개선본 두 개를 합의 과제의 통과 조건과 대조했습니다.',checks:CRITERIA.map(pass),taskChecks:['growth','content'].map(role=>({role,status:'pass',location:'개선본',finding:'합의 과제의 통과 조건을 대조했습니다.',fix:'해당 없음'}))});
 return JSON.stringify({verdict:'revise',summary:'후속 측정 설계 필요',findings:'개선본은 작성됐으며 데이터 담당은 변경된 배포 조건에 맞춰 다시 설계해야 합니다.'});
}
// inserted: 작업물 id별로 저장 경로(역할·회의)가 마지막으로 쓴 본문 바이트. race: 작업물 CAS UPDATE 직전에 한 번 부르는 훅. failUpdate: 작업물 UPDATE 실패 주입.
// campaignSaved: 캠페인 id별로 저장 경로가 마지막으로 쓴 캠페인 바이트. campaignUpdates: A2의 캠페인 compare-and-set UPDATE 횟수.
const runs=new Map(),external=[],errors=[],inserted=new Map(),campaignSaved=new Map();let seq=0,race=null,failUpdate=false,artifactUpdates=0,campaignUpdates=0;
const {sql,load}=testRuntime(async(url,options={})=>{
 url=String(url);const method=options.method||'GET';
 if(!url.startsWith(HERMES+'/')){external.push(url);throw new Error('모의 주소만 호출합니다: '+url)}
 const path=url.slice(HERMES.length);
 if(path==='/v1/runs'&&method==='POST'){const key=options.headers['Idempotency-Key'];if(!runs.has(key))runs.set(key,{id:'run_'+ ++seq,input:JSON.parse(options.body).input});return Response.json({run_id:runs.get(key).id})}
 const id=/^\/v1\/runs\/([\w-]+)$/.exec(path)?.[1],run=[...runs.values()].find(r=>r.id===id);
 if(!run)return new Response('{}',{status:404});
 const x=JSON.parse(run.input);
 return Response.json({object:'hermes.run',run_id:id,status:'completed',output:x.phase?answer(x):roleOutput(run.input),usage:{input_tokens:1200,output_tokens:800,total_tokens:2000},model:'reported-model-a'});
},{beforeRun(statement){
 if(/^INSERT/.test(statement.query)&&statement.values[2]==='artifact')inserted.set(statement.values[0],statement.values[4]);
 if(/^INSERT/.test(statement.query)&&statement.values[2]==='campaign')campaignSaved.set(statement.values[0],statement.values[4]);
 if(/^UPDATE records/.test(statement.query)&&/kind='campaign'/.test(statement.query))campaignUpdates++;
 if(/^UPDATE records/.test(statement.query)&&/kind='artifact'/.test(statement.query)){
  artifactUpdates++;
  if(failUpdate)throw new Error('injected artifact update failure');
  if(race){const hook=race;race=null;hook(statement)}
 }
}});
const server=await load('lib/server.ts'),roleExec=await load('lib/role-execution.ts'),meetingExec=await load('lib/meeting-execution.ts'),flags=await load('lib/feature-flags.ts');
const og=await load('lib/online-grading.ts'),compliance=await load('lib/graders/compliance.ts'),quality=await load('lib/quality.ts');
const passed=[];const check=(name,value)=>{assert.ok(value,name);passed.push(name)};
// 규제 점검 호출 수: checkCompliance는 호출마다 사전 규칙 배열의 flatMap을 한 번 읽는다(같은 모듈 인스턴스).
const lexicon=compliance.COMPLIANCE_LEXICON,rules=lexicon.rules;let complianceCalls=0;
lexicon.rules=new Proxy(rules,{get(t,p,r){if(p==='flatMap')complianceCalls++;return Reflect.get(t,p,r)}});
const originalError=console.error;console.error=(...args)=>{errors.push(args.join(' '))};
const owner='a2-owner',now=new Date().toISOString();
const put=(kind,id,data,parent='')=>server.recordStatement(owner,kind,id,data,parent).run();
const key=id=>`${owner}:artifact:${id}`;
const rowOf=id=>sql.prepare("SELECT data FROM records WHERE owner=? AND kind='artifact' AND id=?").get(owner,key(id))?.data;
const artifactOf=id=>JSON.parse(rowOf(id));
const gradings=campaignId=>sql.prepare("SELECT data FROM records WHERE owner=? AND kind='grading' AND parent_id=?").all(owner,campaignId).map(r=>JSON.parse(r.data));
const usageOf=runId=>JSON.parse(sql.prepare("SELECT data FROM records WHERE owner=? AND kind='provider_usage' AND id=?").get(owner,`${owner}:provider_usage:hermes:${runId}`).data);
const setFlag=(flag,enabled)=>flags.setFeatureFlag(owner,{flag,enabled},{id:owner,email:null});
const withoutHold=id=>JSON.stringify(artifactOf(id),(k,v)=>k==='complianceHold'?undefined:v);
const campaignRow=id=>sql.prepare("SELECT data FROM records WHERE owner=? AND kind='campaign' AND id=?").get(owner,`${owner}:campaign:${id}`)?.data;
const campaignSavedOf=id=>JSON.parse(campaignSaved.get(`${owner}:campaign:${id}`));
// 저장 경로가 쓴 캠페인과 비교해 status·updatedAt 말고는 같은지 본다.
const sameCampaignBut=(id,status)=>{const saved=campaignSavedOf(id),now=JSON.parse(campaignRow(id));return now.status===status&&now.updatedAt>=saved.updatedAt&&JSON.stringify({...now,status:0,updatedAt:0})===JSON.stringify({...saved,status:0,updatedAt:0})};
sql.prepare('INSERT INTO settings(owner,secret,model,updated_at) VALUES(?,?,?,?)').run(owner,await server.encrypt(JSON.stringify({provider:'hermes',endpoint:HERMES,key:'mock-only'})),'HERMES',now);
await put('worker_credential','current',{hash:'synthetic-hash',createdAt:now});

// 합성 브랜드·사실. 실제 고객·매장 정보가 아니다.
const brand={id:'a2-brand',name:'가상분식',short:'GB',category:'SNACK BAR',color:'#224466',bg:'#eef2f6',description:'합성 소개(미확인).',audience:'가상동 주민(가설)',tone:'명료한',constraints:'가격은 확인 전 확정하지 않는다.',knowledge:'합성 메모.'};
await put('brand',brand.id,brand);
const campaignOf=id=>({id,brandId:brand.id,title:'가상분식 '+id,goal:'오픈 전 인지와 첫 포장 주문을 만든다.',audience:'가상동 주민(가설)',channels:'Instagram',stores:'가상동 12',products:'떡볶이(가격 미확정)',budget:null,startDate:'',endDate:'',constraints:'할인 약속 금지.',sources:'',status:'draft',version:1,createdAt:now,updatedAt:now});
const campaign=async id=>{const c=campaignOf(id);await put('campaign',id,c);return c};
async function roleRun(campaignId,role='cmo'){
 const started=await (await roleExec.executeRole(owner,{action:'start',campaignId,role})).json();
 const polled=await roleExec.executeRole(owner,{action:'poll',id:started.id});
 const job=sql.prepare('SELECT id,status,provider_id FROM jobs WHERE id=?').get(started.id);
 return {job,response:polled,body:await polled.json(),artifactId:await roleExec.roleArtifactId(started.id)};
}
async function meetingRun(id,campaignId){
 await meetingExec.executeMeeting(owner,{action:'start',id,campaignId,campaignVersion:1,agenda:'합성 안건: 서로의 제안을 검토하고 콘텐츠를 개선'});
 let m;for(let i=0;i<40;i++){m=await (await meetingExec.executeMeeting(owner,{action:'advance',id})).json();if(['completed','failed','cancelled'].includes(m.status))break}
 return m;
}
const roleName=id=>({cmo:'총괄 파트너',insight:'고객 인사이트',strategy:'브랜드 전략',creative:'크리에이티브',content:'콘텐츠 스튜디오',growth:'채널 & 그로스',data:'데이터 & 실험',quality:'독립 품질 검수'})[id];
const NEUTRAL='## 실행 초안\n자료 필요: 실제 운영 조건을 확인한 뒤 실행합니다. 현재 초안은 가설이며 담당자가 POS 기록과 현장 관찰로 검증합니다.';
const art=(campaignId,id,role,content=NEUTRAL,extra={})=>({id,campaignId,campaignVersion:1,role,title:`${roleName(role)} · ${id}`,content,version:1,status:'review',origin:'ai',createdAt:now,...extra});
const putArtifact=a=>put('artifact',a.id,a,a.campaignId);
const qualityArt=(campaignId,id,review,extra={})=>art(campaignId,id,'quality',quality.qualityMarkdown(review),{qualityReview:review,...extra});
const a2Line=(a,hold)=>`A2 규제 점검: ${a.title} — ${hold.issues[0].title}${hold.block>1?` 외 ${hold.block-1}건`:''}`;

// 0) 합성 문장 전제: BLOCK은 block 2건, WARN은 warn만, INFO는 info만.
const sev=text=>compliance.checkCompliance(text).issues.map(i=>i.severity);
check('synthetic block text has two blocking issues',sev(BLOCK).filter(s=>s==='block').length===2);
check('synthetic warn and info texts have no blocking issue',sev(WARN).length>0&&!sev(WARN).includes('block')&&sev(INFO).length>0&&sev(INFO).every(s=>s==='info'));
complianceCalls=0;

// A) 두 스위치 모두 꺼짐(기본): 규제 점검 0회, 작업물 바이트 불변, grading 0건. 회의 경로도 같다.
check('a2_downgrade is off by default',(await flags.isEnabled(owner,'a2_downgrade'))===false&&(await flags.isEnabled(owner,'online_grading'))===false);
await campaign('a2-off');inject=BLOCK;
let run=await roleRun('a2-off');
check('switches off: the role run completes',run.body.status==='completed'&&run.job.status==='completed');
check('switches off: the saved role artifact is byte-identical',rowOf(run.artifactId)===inserted.get(key(run.artifactId))&&!('complianceHold' in artifactOf(run.artifactId)));
check('switches off: no compliance check and no grading record',complianceCalls===0&&gradings('a2-off').length===0);
check('switches off: the campaign row is byte-identical to what the role run saved',campaignRow('a2-off')===campaignSaved.get(`${owner}:campaign:a2-off`)&&campaignUpdates===0);
await campaign('a2-meet-off');revisionExtra=BLOCK;meetingReady=true;let updatesBefore=artifactUpdates;
let meeting=await meetingRun('a2-m-off','a2-meet-off');
check('switches off: the meeting completes and saves its artifacts',meeting.status==='completed'&&meeting.artifactIds.length===3);
check('switches off: meeting artifacts are byte-identical and the quality verdict is kept',meeting.artifactIds.every(id=>rowOf(id)===inserted.get(key(id)))&&meeting.artifactIds.map(artifactOf).find(a=>a.role==='quality').qualityReview.verdict==='ready_for_review');
check('switches off: meeting runs no compliance check and no artifact update',complianceCalls===0&&artifactUpdates===updatesBefore&&gradings('a2-meet-off').length===0);
check('switches off: the meeting campaign stays review and byte-identical',campaignSavedOf('a2-meet-off').status==='review'&&campaignRow('a2-meet-off')===campaignSaved.get(`${owner}:campaign:a2-meet-off`)&&campaignUpdates===0);

// B) online_grading만 켬: grading은 기존대로, 작업물 바이트 불변(complianceHold 없음).
await setFlag('online_grading',true);await campaign('a2-grade-only');
run=await roleRun('a2-grade-only');
const gradedOnly=gradings('a2-grade-only')[0];
check('grading only: the artifact is byte-identical',rowOf(run.artifactId)===inserted.get(key(run.artifactId)));
check('grading only: one grading with the compliance summary as before',gradedOnly?.status==='graded'&&gradedOnly.compliance.block===2&&gradedOnly.compliance.issues.every(i=>Object.keys(i).join()==='category,ruleId,severity')&&complianceCalls===1);

// C) 두 스위치 켬: 채점 결과의 규제 점검을 재사용(점검 1회)하고 block이면 complianceHold를 남긴다. grading 기록은 스위치 전과 같다.
await setFlag('a2_downgrade',true);await campaign('a2-both');complianceCalls=0;let campaignUpdatesBefore=campaignUpdates;
run=await roleRun('a2-both');
let a=artifactOf(run.artifactId),hold=a.complianceHold;
check('both on: the role run completes',run.body.status==='completed'&&run.job.status==='completed'&&usageOf(run.job.provider_id).domainOutcome==='completed');
check('both on: the compliance result is reused (one check)',complianceCalls===1);
check('both on: a blocking artifact gets a complianceHold',hold&&hold.version===lexicon.version&&hold.block===2&&hold.issues.length===2&&hold.notice===compliance.COMPLIANCE_NOTICE&&!Number.isNaN(Date.parse(hold.checkedAt)));
check('complianceHold issues carry category, rule, title and excerpt only',hold.issues.every(i=>Object.keys(i).join()==='category,ruleId,title,excerpt'&&i.excerpt.length<=60)&&hold.issues.map(i=>i.ruleId).join()==='review_reward,receipt_review_event');
check('complianceHold is the only change to the saved artifact',withoutHold(run.artifactId)===inserted.get(key(run.artifactId))&&a.version===1&&a.status==='review');
check('a hold write refreshes only the campaign updatedAt (status stays review)',campaignUpdates===campaignUpdatesBefore+1&&sameCampaignBut('a2-both','review'));
const bothGrading=gradings('a2-both')[0],norm=g=>JSON.stringify({...g,id:0,artifactId:0,campaignId:0,jobId:0,gradedAt:0,durationMs:0});
check('both on: the grading record is the same as with the downgrade switch off',norm(bothGrading)===norm(gradedOnly)&&bothGrading.compliance.block===hold.block);

// D) online_grading 꺼짐 + a2_downgrade 켬: grading 기록 없이 규제 점검만 한다.
await setFlag('online_grading',false);await campaign('a2-only');complianceCalls=0;
run=await roleRun('a2-only');
check('downgrade only: the role run and usage outcome are unchanged',run.body.status==='completed'&&run.job.status==='completed'&&usageOf(run.job.provider_id).domainOutcome==='completed');
check('downgrade only: complianceHold is written without a grading record',artifactOf(run.artifactId).complianceHold?.block===2&&gradings('a2-only').length===0&&complianceCalls===1);

// E) warn·info만: 기록 없음(바이트 불변).
await campaign('a2-warn');inject=WARN;campaignUpdatesBefore=campaignUpdates;run=await roleRun('a2-warn');
check('warnings only: no complianceHold and the artifact is byte-identical',run.body.status==='completed'&&rowOf(run.artifactId)===inserted.get(key(run.artifactId)));
check('warnings only: the campaign is not touched',campaignUpdates===campaignUpdatesBefore&&campaignRow('a2-warn')===campaignSaved.get(`${owner}:campaign:a2-warn`));
await campaign('a2-info');inject=INFO;run=await roleRun('a2-info');
check('cited info only: no complianceHold',run.body.status==='completed'&&rowOf(run.artifactId)===inserted.get(key(run.artifactId)));
inject='';

// F) 역할 경로 품질 검수: 다른 현재 작업물의 hold → ready_for_review를 revise로 내리고 문구를 더한다. checks 5기준·taskChecks 불변.
const qc=await campaign('a2-q');
const priors=['cmo','insight','strategy','creative','content','growth','data'].map(role=>art('a2-q','a2-q-'+role,role,role==='content'?NEUTRAL+'\n'+BLOCK:NEUTRAL));
for(const p of priors)await putArtifact(p);
const held=priors.find(p=>p.role==='content');
await og.gradeSavedArtifacts(owner,qc,[{artifact:held,source:'role'}]);
const heldHold=artifactOf(held.id).complianceHold;
check('a directly graded saved artifact gets its complianceHold',heldHold?.block===2);
const heldRow=rowOf(held.id);qualityOut=readyReview;
run=await roleRun('a2-q','quality');qualityOut=null;
const savedQ=JSON.parse(inserted.get(key(run.artifactId))),q=artifactOf(run.artifactId),line=a2Line(held,heldHold);
check('quality run completes and was saved as ready_for_review (after the ai-quality-6 gate)',run.body.status==='completed'&&savedQ.qualityReview.verdict==='ready_for_review'&&savedQ.qualityReview.gateIssues.length===0);
check('another current artifact with a hold downgrades ready_for_review to revise',q.qualityReview.verdict==='revise'&&q.qualityReview.reportedVerdict==='ready_for_review'&&q.version===1&&q.status==='review');
check('the downgrade adds the A2 line and the not-legal-advice notice to gateIssues',JSON.stringify(q.qualityReview.gateIssues)===JSON.stringify([line,compliance.COMPLIANCE_NOTICE])&&line.includes(' 외 1건'));
check('checks keep exactly the five criteria and taskChecks are unchanged',JSON.stringify(q.qualityReview.checks)===JSON.stringify(savedQ.qualityReview.checks)&&q.qualityReview.checks.map(c=>c.criterion).join()===CRITERIA.join()&&Object.keys(quality.qualityCriteria).join()===CRITERIA.join()&&JSON.stringify(q.qualityReview.taskChecks)===JSON.stringify(savedQ.qualityReview.taskChecks));
check('content is rebuilt with qualityMarkdown',q.content===quality.qualityMarkdown(q.qualityReview)&&q.content.includes(line)&&q.content.includes('판정: 수정 필요'));
check('the held artifact itself is not touched by the quality save',rowOf(held.id)===heldRow);
check('the downgrade moves the campaign from review to revision like the save rule (verdict not ready_for_review)',campaignSavedOf('a2-q').status==='review'&&sameCampaignBut('a2-q','revision'));

// G) 직접 호출 경계: 이미 revise·needs_data면 판정 유지, outdated·다른 캠페인 버전 무시, 승인·버전 변경·경합이면 쓰지 않음(CAS), findings 끝 대체.
const reviseCase=async(id,review)=>{const c=await campaign(id),h=art(id,id+'-content','content',NEUTRAL,{complianceHold:heldHold}),qa=qualityArt(id,id+'-quality',review);await putArtifact(h);await putArtifact(qa);await og.gradeSavedArtifacts(owner,c,[{artifact:qa,source:'role'}]);return {h,qa,after:artifactOf(qa.id)}};
let r=await reviseCase('a2-rev',{...readyReview,verdict:'revise',reportedVerdict:'revise',gateIssues:['기존 확인 사항']});
check('an already revise review keeps its verdict and only gains the A2 lines',r.after.qualityReview.verdict==='revise'&&JSON.stringify(r.after.qualityReview.gateIssues)===JSON.stringify(['기존 확인 사항',a2Line(r.h,heldHold),compliance.COMPLIANCE_NOTICE])&&JSON.stringify(r.after.qualityReview.checks)===JSON.stringify(r.qa.qualityReview.checks));
r=await reviseCase('a2-nd',{...readyReview,verdict:'needs_data',gateIssues:[]});
check('a needs_data review stays needs_data',r.after.qualityReview.verdict==='needs_data'&&r.after.qualityReview.gateIssues.length===2);
r=await reviseCase('a2-legacy',{verdict:'ready_for_review',summary:'이전 형식 검수',findings:'이전 형식 검수 결과입니다.'});
check('a review without gateIssues gets the lines at the end of findings',r.after.qualityReview.verdict==='revise'&&r.after.qualityReview.findings.endsWith(a2Line(r.h,heldHold)+'\n'+compliance.COMPLIANCE_NOTICE)&&!('gateIssues' in r.after.qualityReview)&&!('checks' in r.after.qualityReview));
{
 const c=await campaign('a2-ign'),qa=qualityArt('a2-ign','a2-ign-quality',readyReview);
 await putArtifact(art('a2-ign','a2-ign-old','content',NEUTRAL,{status:'outdated',complianceHold:heldHold}));
 await putArtifact(art('a2-ign','a2-ign-v2','growth',NEUTRAL,{campaignVersion:2,complianceHold:heldHold}));
 await putArtifact(art('a2-ign-other','a2-ign-elsewhere','content',NEUTRAL,{complianceHold:heldHold}));
 await putArtifact(qa);const before=rowOf(qa.id);
 await og.gradeSavedArtifacts(owner,c,[{artifact:qa,source:'role'}]);
 check('outdated artifacts, other campaign versions and other campaigns are ignored',rowOf(qa.id)===before);
}
{
 const c=await campaign('a2-appr'),qa=qualityArt('a2-appr','a2-appr-quality',readyReview,{status:'approved'});
 await putArtifact(art('a2-appr','a2-appr-content','content',NEUTRAL,{complianceHold:heldHold}));await putArtifact(qa);const before=rowOf(qa.id);
 await og.gradeSavedArtifacts(owner,c,[{artifact:{...qa,status:'review'},source:'role'}]);
 check('an approved quality review is not downgraded (CAS)',rowOf(qa.id)===before);
 const approved=art('a2-appr','a2-appr-block','content',BLOCK,{status:'approved'});await putArtifact(approved);const approvedRow=rowOf(approved.id);
 await og.gradeSavedArtifacts(owner,c,[{artifact:{...approved,status:'review'},source:'role'}]);
 check('an artifact approved after the save gets no complianceHold (CAS)',rowOf(approved.id)===approvedRow);
 const edited=art('a2-appr','a2-appr-edited','content',BLOCK,{version:2});await putArtifact(edited);const editedRow=rowOf(edited.id);
 await og.gradeSavedArtifacts(owner,c,[{artifact:{...edited,version:1},source:'role'}]);
 check('an artifact whose version changed after the save gets no complianceHold (CAS)',rowOf(edited.id)===editedRow);
 const raced=art('a2-appr','a2-appr-raced','content',BLOCK);await putArtifact(raced);const errorsBefore=errors.length;
 race=()=>sql.prepare("UPDATE records SET data=json_set(data,'$.status','approved') WHERE id=?").run(key(raced.id));
 await og.gradeSavedArtifacts(owner,c,[{artifact:raced,source:'role'}]);
 check('an approval between the read and the write skips silently (changes 0)',race===null&&artifactOf(raced.id).status==='approved'&&!('complianceHold' in artifactOf(raced.id))&&errors.length===errorsBefore);
}
{
 // block이 없으면 기존 hold를 지우지 않는다(상향 금지).
 const c=await campaign('a2-keep'),kept=art('a2-keep','a2-keep-content','content',NEUTRAL,{complianceHold:heldHold});await putArtifact(kept);const before=rowOf(kept.id);
 await og.gradeSavedArtifacts(owner,c,[{artifact:kept,source:'role'}]);
 check('a clean re-check never removes an existing complianceHold',rowOf(kept.id)===before);
}
// 같은 버전에 이미 hold가 있으면 새 block이 나와도 덮지 않는다. 품질 검수 문구는 저장된 hold(화면에 보이는 것)로 만든다.
const otherHold={...heldHold,block:1,issues:[{category:'rights',ruleId:'synthetic_rule',title:'합성 기존 규칙',excerpt:'합성 발췌'}]};
{
 const c=await campaign('a2-noover'),x=art('a2-noover','a2-noover-content','content',BLOCK,{complianceHold:otherHold});await putArtifact(x);const before=rowOf(x.id);
 await og.gradeSavedArtifacts(owner,c,[{artifact:x,source:'role'}]);
 check('an existing complianceHold on the same version is never overwritten by a new block',rowOf(x.id)===before);
 const c2=await campaign('a2-prio'),y=art('a2-prio','a2-prio-content','content',BLOCK,{complianceHold:otherHold}),qa=qualityArt('a2-prio','a2-prio-quality',{...readyReview,gateIssues:[]});
 await putArtifact(y);await putArtifact(qa);
 await og.gradeSavedArtifacts(owner,c2,[{artifact:y,source:'role'},{artifact:qa,source:'role'}]);
 check('the quality line uses the stored complianceHold shown on screen',JSON.stringify(artifactOf(qa.id).qualityReview.gateIssues)===JSON.stringify([a2Line(y,otherHold),compliance.COMPLIANCE_NOTICE]));
 // 이번 점검이 옛 버전(v1)에서 block을 찾았어도 저장된 작업물이 사람이 고친 v2(hold 없음)면 하향하지 않는다.
 const c3=await campaign('a2-ver'),v2=art('a2-ver','a2-ver-content','content',NEUTRAL,{version:2}),qv=qualityArt('a2-ver','a2-ver-quality',{...readyReview,gateIssues:[]});
 await putArtifact(v2);await putArtifact(qv);const qBefore=rowOf(qv.id),vBefore=rowOf(v2.id);
 await og.gradeSavedArtifacts(owner,c3,[{artifact:{...v2,version:1,content:BLOCK},source:'role'},{artifact:qv,source:'role'}]);
 check('a block found on an older version neither holds the new version nor downgrades the quality review',rowOf(qv.id)===qBefore&&rowOf(v2.id)===vBefore);
}
{
 // 품질 검수 본문 자체의 block도 '이번 점검에서 block이 나온 현재 작업물'이다.
 const id='a2-self';await put('campaign',id,{...campaignOf(id),status:'review'});
 const selfReview={...readyReview,findings:readyReview.findings+'\n'+BLOCK,gateIssues:[]},qa=qualityArt(id,id+'-quality',selfReview);await putArtifact(qa);
 check('synthetic quality body has a blocking issue',sev(qa.content).includes('block'));
 await og.gradeSavedArtifacts(owner,{...campaignOf(id),status:'review'},[{artifact:qa,source:'role'}]);
 const after=artifactOf(qa.id),selfHold=after.complianceHold;
 check('a block in the quality review body itself downgrades it and names itself',selfHold?.block===2&&after.qualityReview.verdict==='revise'&&JSON.stringify(after.qualityReview.gateIssues)===JSON.stringify([a2Line(qa,selfHold),compliance.COMPLIANCE_NOTICE]));
 check('a direct quality downgrade moves a review campaign to revision',JSON.parse(campaignRow(id)).status==='revision'&&JSON.parse(campaignRow(id)).updatedAt>now);
}
{
 // 읽은 뒤 쓰기 전에 다른 표시(factsChanged)만 붙으면 한 번 다시 읽어 표시를 보존하고 hold를 남긴다.
 const c=await campaign('a2-mark'),m=art('a2-mark','a2-mark-content','content',BLOCK);await putArtifact(m);const errorsBefore=errors.length;
 race=()=>sql.prepare("UPDATE records SET data=json_set(data,'$.factsChanged',json('true')) WHERE id=?").run(key(m.id));
 await og.gradeSavedArtifacts(owner,c,[{artifact:m,source:'role'}]);
 const after=artifactOf(m.id);
 check('a mark added between the read and the write is kept and the hold is still recorded (one retry)',race===null&&after.factsChanged===true&&after.complianceHold?.block===2&&after.status==='review'&&after.version===1&&errors.length===errorsBefore);
}
{
 // 입력 상한: 온라인 채점과 같은 MAX_GRADED_LINES를 넘으면 규제 점검을 부르지 않는다(hold 없음, 이름만 로그 1줄).
 const big=BLOCK+'\n'.repeat(og.MAX_GRADED_LINES),c=await campaign('a2-cap'),x=art('a2-cap','a2-cap-content','content',big);await putArtifact(x);const before=rowOf(x.id);
 check('synthetic oversized artifact has MAX_GRADED_LINES+1 lines',big.split('\n').length===og.MAX_GRADED_LINES+1);
 complianceCalls=0;let errorsBefore=errors.length;
 await og.gradeSavedArtifacts(owner,c,[{artifact:x,source:'role'}]);
 check('downgrade only: an artifact over MAX_GRADED_LINES is not checked and gets no hold',complianceCalls===0&&rowOf(x.id)===before&&gradings('a2-cap').length===0&&JSON.stringify(errors.slice(errorsBefore))===JSON.stringify(['a2_downgrade_not_run']));
 await setFlag('online_grading',true);complianceCalls=0;errorsBefore=errors.length;
 await og.gradeSavedArtifacts(owner,c,[{artifact:x,source:'role'}]);
 const g=gradings('a2-cap');
 check('both on: an artifact over MAX_GRADED_LINES gets a not_run grading and no compliance check',g.length===1&&g[0].status==='not_run'&&complianceCalls===0&&rowOf(x.id)===before&&JSON.stringify(errors.slice(errorsBefore))===JSON.stringify(['a2_downgrade_not_run']));
 await setFlag('online_grading',false);
}
{
 // 회의 경로: 회의가 저장한 레코드(meetingId)만 A2 대상이다. 잠금이 풀린 뒤 사람이 저장한 새 버전(meetingId 없음)에는 hold를 쓰지 않는다.
 const c=await campaign('a2-mbase'),mid='a2-mbase-m';
 const mine=art('a2-mbase','a2-mbase-content','content',BLOCK,{meetingId:mid}),edited=art('a2-mbase','a2-mbase-growth','growth',BLOCK,{version:2});
 await putArtifact(mine);await putArtifact(edited);const editedRow=rowOf(edited.id);
 await og.gradeMeetingArtifacts(owner,{id:mid,campaignId:'a2-mbase',artifactIds:[mine.id,edited.id],snapshot:{campaign:c,evidence:null}});
 check('meeting path: a version a person saved after the meeting gets no complianceHold',rowOf(edited.id)===editedRow&&artifactOf(mine.id).complianceHold?.block===2);
}

// H) 예외는 삼키고 이름만 로그로 남긴다. 역할 실행 결과·작업물은 그대로다.
{
 rules.push({id:'broken_rule',category:'rights',severity:'block',title:'합성 오류 규칙',match:'(',sources:[]});
 await campaign('a2-throw');inject=BLOCK;const errorsBefore=errors.length;
 run=await roleRun('a2-throw');rules.pop();
 check('a compliance exception keeps the role result and the artifact bytes',run.response.status===200&&run.body.status==='completed'&&run.job.status==='completed'&&rowOf(run.artifactId)===inserted.get(key(run.artifactId)));
 check('a compliance exception is one log line with the name only',JSON.stringify(errors.slice(errorsBefore))===JSON.stringify(['a2_downgrade_error']));
 await campaign('a2-wfail');failUpdate=true;const failBefore=errors.length;
 run=await roleRun('a2-wfail');failUpdate=false;
 check('an artifact write failure keeps the role result and the artifact bytes',run.body.status==='completed'&&run.job.status==='completed'&&rowOf(run.artifactId)===inserted.get(key(run.artifactId)));
 check('an artifact write failure is logged by name only',JSON.stringify(errors.slice(failBefore))===JSON.stringify(['a2_downgrade_error']));
 inject='';
 const direct=await og.gradeSavedArtifacts(owner,{id:'a2-missing',brandId:brand.id,version:1},[{artifact:art('a2-missing','a2-missing-a','content',BLOCK),source:'role'}]);
 check('gradeSavedArtifacts never throws and returns 0 with online grading off',direct===0);
}

// I) 회의 경로(gradeMeetingArtifacts): 개선본 block → hold, 같은 회의의 품질 재검토를 ready_for_review→revise로 내린다.
await campaign('a2-meet');revisionExtra=BLOCK;meetingReady=true;complianceCalls=0;
meeting=await meetingRun('a2-m-on','a2-meet');revisionExtra='';meetingReady=false;
const saved=meeting.artifactIds.map(artifactOf),mq=saved.find(x=>x.role==='quality'),revisions=saved.filter(x=>x.role!=='quality');
const mqSaved=JSON.parse(inserted.get(key(mq.id)));
check('meeting completes with the downgrade switch on',meeting.status==='completed'&&revisions.length===2&&complianceCalls===3&&gradings('a2-meet').length===0);
check('meeting revisions with a block get a complianceHold',revisions.every(x=>x.complianceHold?.block===2&&withoutHold(x.id)===inserted.get(key(x.id))));
check('meeting quality review is saved ready_for_review and downgraded to revise',mqSaved.qualityReview.verdict==='ready_for_review'&&mq.qualityReview.verdict==='revise'&&mq.version===mqSaved.version&&mq.status==='review');
// 문구 순서는 역할 순서(콘텐츠 → 그로스)이며 회의 저장 순서(artifactIds)와 같다.
check('meeting quality review gains one line per held revision and the notice',JSON.stringify(mq.qualityReview.gateIssues)===JSON.stringify([...mqSaved.qualityReview.gateIssues,...revisions.map(x=>a2Line(x,x.complianceHold)),compliance.COMPLIANCE_NOTICE]));
check('meeting quality checks and taskChecks are unchanged and content is rebuilt',JSON.stringify(mq.qualityReview.checks)===JSON.stringify(mqSaved.qualityReview.checks)&&JSON.stringify(mq.qualityReview.taskChecks)===JSON.stringify(mqSaved.qualityReview.taskChecks)&&mq.qualityReview.taskChecks.length===2&&mq.content===quality.qualityMarkdown(mq.qualityReview));
check('meeting downgrade moves the campaign from review to revision',campaignSavedOf('a2-meet').status==='review'&&sameCampaignBut('a2-meet','revision'));
// 두 스위치 켬: 회의 작업물 3개는 채점 결과의 규제 점검을 재사용한다(점검 3회, grading 3건).
await setFlag('online_grading',true);await campaign('a2-meet-both');revisionExtra=BLOCK;meetingReady=true;complianceCalls=0;
meeting=await meetingRun('a2-m-both','a2-meet-both');revisionExtra='';meetingReady=false;
const both=meeting.artifactIds.map(artifactOf);
check('both on: the meeting reuses the grading compliance (three checks, three gradings)',meeting.status==='completed'&&complianceCalls===3&&gradings('a2-meet-both').length===3&&both.filter(x=>x.role!=='quality').every(x=>x.complianceHold?.block===2)&&both.find(x=>x.role==='quality').qualityReview.verdict==='revise');
await setFlag('online_grading',false);

// J) 화면·문서 연결.
const view=readFileSync('app/online-grading.tsx','utf8');
check('campaign view shows the complianceHold with the notice',/complianceHold/.test(view)&&/규제 점검 차단/.test(view)&&/게시 전 담당자 확인 필요/.test(view)&&/notice/.test(view)&&/출처/.test(view));
const reliability=readFileSync('docs/RELIABILITY.ko.md','utf8'),evalDoc=readFileSync('docs/EVAL.ko.md','utf8');
check('docs describe the runtime downgrade, how to switch it off and the notice',/a2_downgrade/.test(reliability)&&/complianceHold/.test(reliability)&&/complianceHold/.test(evalDoc)&&/법률 자문/.test(reliability));
check('no a2 log line carries artifact text',errors.every(e=>!e.includes('영수증')&&!e.includes('리뷰')));
check('no external network call',external.length===0);
console.error=originalError;
console.log(JSON.stringify({passed:passed.length,checks:passed},null,2));
