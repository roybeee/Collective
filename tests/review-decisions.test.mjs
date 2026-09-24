// B1 사람 판정·교정 결정 로그 회귀(대표 결정 8). 실제 SQLite(node:sqlite)와 실제 라우트를 쓰고 외부 호출은 막는다(mocked: fetch 스텁, 헤더 세션).
// 사유 코드 v1 사전·F1 채점기 매핑, review_decision 추가 전용 이력, 사유 필수 스위치, 기준별 사람 판정, AI 편집 교정(origin ai_edited),
// 브리프 제안 채택·수정·미사용, 자료 제외·발행 취소 사유, 선호 쌍 조회, 캠페인 삭제 정책, 화면 연결을 확인한다. LLM 호출은 0이어야 한다.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,existsSync} from 'node:fs';
import {testRuntime} from './helpers/runtime.mjs';

let fetchCalls=0,failWrite=null;
// failWrite: 지정한 문장 실행을 실패시켜 한 묶음(db.batch) 롤백을 확인한다.
const rt=testRuntime(async()=>{fetchCalls++;throw new Error('외부 호출 금지')},{beforeRun:statement=>failWrite?.(statement)});
Object.assign(rt.env,{AUTH_MODE:'email',AUTH_ORIGIN:'https://app.test'});
const server=await rt.load('lib/server.ts'),action=await rt.load('app/api/action/route.ts'),archive=await rt.load('app/api/archive/route.ts'),execution=await rt.load('app/api/execution/route.ts');
const pure=await rt.load('lib/review-decisions.ts'),store=await rt.load('lib/review-decisions-server.ts'),flags=await rt.load('lib/feature-flags.ts');
const {GRADERS}=await rt.load('lib/graders/index.ts'),{qualityCriteria}=await rt.load('lib/quality.ts'),registry=await rt.load('lib/record-kinds.ts'),{deletionSummary}=await rt.load('lib/deletion-summary.ts');
const plain=value=>JSON.parse(JSON.stringify(value));
let passed=0;const check=(name,ok)=>{assert.ok(ok,name);passed++};

// 1) 사유 코드 v1 사전(순수)
const codes=plain(pure.REVIEW_REASONS.map(r=>r.code));
check('reason codes v1 are the five quality criteria keys plus five review codes',JSON.stringify(codes)===JSON.stringify([...Object.keys(qualityCriteria),'compliance','voice','fact_error','question_only','format']));
check('reason codes stay within ten and are unique',codes.length<=10&&new Set(codes).size===codes.length);
check('every reason has a Korean label and description',pure.REVIEW_REASONS.every(r=>/[가-힣]/.test(r.label)&&/[가-힣]/.test(r.description)));
const graderIds=plain(GRADERS.map(g=>g.id)),mapped=plain(pure.REVIEW_REASONS.flatMap(r=>[...r.graders]));
check('every mapped F1 failure type is a real grader id',mapped.every(id=>graderIds.includes(id)));
check('every grader except the declared unmapped ones maps to a reason',graderIds.filter(id=>!plain(pure.UNMAPPED_GRADERS).includes(id)).every(id=>mapped.includes(id)));
check('compliance maps to the A2 guardrail and fact_error to fact_conflict',pure.REVIEW_REASONS.find(r=>r.code==='compliance').guardrail==='compliance'&&plain(pure.REVIEW_REASONS.find(r=>r.code==='fact_error').graders).includes('fact_conflict'));
for(const kind of ['artifact','brief_suggestion','source','publication'])for(const role of [null,'cmo','data','growth','quality','content'])check(`at most eight chips for ${kind}/${role}`,pure.reasonChoices(kind,role).length<=8&&pure.reasonChoices(kind,role).every(r=>r.targets.includes(kind)));
check('the data role sees the measurement chip',pure.reasonChoices('artifact','data').some(r=>r.code==='measurement'));
check('missing reason codes are an empty list',pure.reasonCodesProblem(undefined,'artifact')===null&&JSON.stringify(plain(pure.reasonCodesOf(undefined)))==='[]');
check('duplicate codes are accepted once',pure.reasonCodesProblem(['evidence','evidence'],'artifact')===null&&JSON.stringify(plain(pure.reasonCodesOf(['evidence','evidence'])))==='["evidence"]');
check('unknown, non-list, oversized and inapplicable codes are problems',[['nope'],'evidence',[1],Array(11).fill('evidence')].every(v=>typeof pure.reasonCodesProblem(v,'artifact')==='string')&&typeof pure.reasonCodesProblem(['question_only'],'source')==='string');
check('identical text has no edit',JSON.stringify(plain(pure.editStats('## 목표\nA','## 목표\nA')))==='{"changedSections":[],"diffRatio":0}');
const sectionEdit=plain(pure.editStats('## 목표\nA\n## 채널\nB','## 목표\nA\n## 채널\nB 수정'));
check('a section edit names the section and has a partial ratio',JSON.stringify(sectionEdit.changedSections)==='["채널"]'&&sectionEdit.diffRatio>0&&sectionEdit.diffRatio<1);
check('a full rewrite has ratio 1',pure.editStats('가\n나','다\n라').diffRatio===1);
check('suggestion decisions: adopted, edited, ignored',pure.suggestionDecision(' v ','v','')==='adopted'&&pure.suggestionDecision('','v','')==='ignored'&&pure.suggestionDecision('base','v','base')==='ignored'&&pure.suggestionDecision('other','v','base')==='edited');
check('origin labels are readable',pure.originLabel('ai')==='AI 작성'&&pure.originLabel('ai_edited').includes('사람 수정')&&pure.originLabel('manual')==='직접 등록');

// 2) 라우트 준비: 소유자(가장 먼저 만든 관리자)와 직원 세션
const O='workspace',ADMIN='a'.repeat(64),MEMBER='b'.repeat(64);
for(const [id,role,token] of [['admin','admin',ADMIN],['member','member',MEMBER]]){
 rt.sql.prepare('INSERT INTO auth_users(id,email,workspace_owner,role,status,created_at) VALUES(?,?,?,?,?,?)').run(id,id+'@test.invalid',O,role,'active',Date.now());
 rt.sql.prepare('INSERT INTO auth_sessions VALUES(?,?,?,?)').run(createHash('sha256').update(token).digest('hex'),id,Date.now()+60000,Date.now());
}
const call=async(mod,token,data)=>{const r=await mod.POST(new Request('https://app.test/api/test',{method:'POST',headers:{cookie:'__Host-collective_session='+token,origin:'https://app.test','content-type':'application/json'},body:JSON.stringify(data)}));return {status:r.status,data:await r.json()}};
const rows=()=>rt.sql.prepare("SELECT id,data,updated_at FROM records WHERE owner=? AND kind='review_decision' ORDER BY rowid").all(O);
const decisions=()=>rows().map(r=>JSON.parse(r.data));
const count=kind=>rt.sql.prepare('SELECT COUNT(*) AS n FROM records WHERE owner=? AND kind=?').get(O,kind).n;
const put=(kind,id,data,parent='')=>server.recordStatement(O,kind,id,data,parent).run();
const artifact=(id,extra={})=>({id,campaignId:'c1',campaignVersion:1,role:'cmo',title:'전략 '+id,content:'## 목표\n평일 방문 초안',version:1,status:'review',origin:'manual',createdAt:new Date().toISOString(),...extra});
await server.seedBrands(O);
await put('campaign','c1',{id:'c1',brandId:'oda',title:'판정 로그',goal:'평일 방문',version:1,status:'review'});
await put('artifact','art1',artifact('art1'),'c1');

// 3) B: 수정 요청 1회 = review_decision 1건 + 기존 이벤트 1건. 스위치 꺼짐이면 칩 없이 저장, 모르는 코드는 400
let events=count('event');
let r=await call(action,MEMBER,{action:'review_artifact',id:'art1',version:1,decision:'revision',note:'가격 표기를 빼 주세요.'});
const first=decisions()[0];
check('member revision without chips is saved while the switch is off',r.status===200&&decisions().length===1);
check('the decision carries target, version, role, decision, note length and the actor id and role',first.targetKind==='artifact'&&first.targetId==='art1'&&first.version===1&&first.role==='cmo'&&first.decision==='revision'&&JSON.stringify(first.reasonCodes)==='[]'&&first.noteLength==='가격 표기를 빼 주세요.'.length&&JSON.stringify(first.actor)==='{"id":"member","role":"member"}'&&first.campaignId==='c1'&&Number.isFinite(Date.parse(first.createdAt)));
check('the decision log copies neither the note text nor the reviewer email',!('note' in first)&&rows().every(x=>!x.data.includes('가격 표기')&&!x.data.includes('@test.invalid')));
check('the revision also writes exactly one legacy event and keeps the review note',count('event')===events+1&&(await server.readRecord(O,'artifact','art1')).reviewNote==='가격 표기를 빼 주세요.');
events=count('event');
r=await call(action,ADMIN,{action:'review_artifact',id:'art1',version:1,decision:'revision',note:'다시',reasonCodes:['nope']});
check('an unknown reason code is 400 and writes nothing',r.status===400&&decisions().length===1&&count('event')===events&&(await server.readRecord(O,'artifact','art1')).reviewNote==='가격 표기를 빼 주세요.');

// 승인 → 수정 요청 → 재작성 후 승인: 3건 모두 조회되고 덮어쓰기 0건
await put('artifact','art2',artifact('art2'),'c1');
r=await call(action,ADMIN,{action:'review_artifact',id:'art2',version:1,decision:'approved'});
check('approval needs no chips',r.status===200);
r=await call(action,ADMIN,{action:'review_artifact',id:'art2',version:1,decision:'revision',note:'근거를 보강해 주세요.',reasonCodes:['evidence','fact_error']});
const before=new Map(rows().map(x=>[x.id,x.data+'|'+x.updated_at]));
await call(action,ADMIN,{action:'save_artifact',id:'art2',version:1,campaignId:'c1',role:'cmo',title:'전략 art2',content:'## 목표\n근거를 보강한 초안'});
r=await call(action,ADMIN,{action:'review_artifact',id:'art2',version:2,decision:'approved'});
const history=plain(await store.targetHistory(O,'artifact','art2'));
check('approve, revise and approve after rewrite are all in the target history',r.status===200&&JSON.stringify(history.map(d=>[d.decision,d.version]))==='[["approved",1],["revision",1],["approved",2]]');
check('history rows are distinct and earlier rows are never overwritten',new Set(history.map(d=>d.id)).size===3&&[...before].every(([id,v])=>{const now=rows().find(x=>x.id===id);return now&&now.data+'|'+now.updated_at===v}));
check('reason codes are stored in order',JSON.stringify(history[1].reasonCodes)==='["evidence","fact_error"]');
check('a manual artifact stays manual after a human edit',(await server.readRecord(O,'artifact','art2')).origin==='manual');

// 스위치 켜짐: 수정 요청에 사유 1개 이상 필수. 승인은 칩 없이 가능. 직원 승인은 403이고 판정도 생기지 않는다
await flags.setFeatureFlag(O,{flag:'b1_reason_required',enabled:true},{id:'admin',email:null});
await put('artifact','art3',artifact('art3'),'c1');
const n=decisions().length;events=count('event');
r=await call(action,ADMIN,{action:'review_artifact',id:'art3',version:1,decision:'revision',note:'고쳐 주세요.'});
check('with the switch on a revision without reasons is 400 and writes nothing',r.status===400&&/사유/.test(r.data.error)&&decisions().length===n&&count('event')===events&&(await server.readRecord(O,'artifact','art3')).status==='review');
r=await call(action,ADMIN,{action:'review_artifact',id:'art3',version:1,decision:'revision',note:'고쳐 주세요.',reasonCodes:['nope']});
check('with the switch on an unknown code is still 400',r.status===400&&decisions().length===n);
r=await call(action,MEMBER,{action:'review_artifact',id:'art3',version:1,decision:'approved'});
check('member approval stays 403 and creates no decision',r.status===403&&decisions().length===n);
r=await call(action,MEMBER,{action:'review_artifact',id:'art3',version:1,decision:'revision',note:'고쳐 주세요.',reasonCodes:['question_only']});
check('with the switch on one reason is enough',r.status===200&&decisions().at(-1).reasonCodes[0]==='question_only'&&decisions().at(-1).actor.role==='member');
r=await call(action,ADMIN,{action:'review_artifact',id:'art3',version:1,decision:'approved'});
check('with the switch on approval still needs no chips',r.status===200);
await flags.resetFeatureFlag(O,{flag:'b1_reason_required'});

// 4) C: 품질 검수 기준별 사람 판정(작업물 id·버전, 기준)
const checks=Object.keys(qualityCriteria).map(criterion=>({criterion,status:criterion==='brand'?'revise':'pass',location:'브리프',finding:'근거',fix:'해당 없음'}));
await put('artifact','qa1',artifact('qa1',{role:'quality',origin:'ai',qualityReview:{verdict:'revise',summary:'요약',findings:'지적',checks}}),'c1');
r=await call(action,ADMIN,{action:'review_artifact',id:'qa1',version:1,decision:'revision',note:'근거 판정이 틀렸습니다.',criteria:{evidence:'revise',brand:'revise'}});
check('criterion judgements are stored with the AI status snapshot',r.status===200&&JSON.stringify(decisions().at(-1).criteria)==='[{"criterion":"evidence","human":"revise","ai":"pass"},{"criterion":"brand","human":"revise","ai":"revise"}]');
for(const [name,body] of [['unknown criterion',{id:'qa1',criteria:{speed:'pass'}}],['unknown judgement',{id:'qa1',criteria:{evidence:'maybe'}}],['criteria on a non-quality artifact',{id:'art3',criteria:{evidence:'pass'}}]]){
 const m=decisions().length;r=await call(action,ADMIN,{action:'review_artifact',version:1,decision:'approved',...body});check(name+' is 400 and writes nothing',r.status===400&&decisions().length===m);
}
const units=plain(await store.criterionUnits(O,'c1'));
check('criterion units are keyed by artifact id, version and criterion',units.length===2&&units.every(u=>u.artifactId==='qa1'&&u.version===1&&u.human==='revise')&&JSON.stringify(units.map(u=>u.criterion))==='["evidence","brand"]');

// 5) 버전 필드와 역할×스킬 버전별 1차 승인율
const ai=(id,role='cmo',content='## 목표\n평일 방문 초안\n## 채널\n인스타그램 게시')=>artifact(id,{role,origin:'ai',content,skillVersion:'practice-v9',outputContractVersion:'role-output-v1'});
for(const [id,role] of [['ai1','cmo'],['ai2','cmo'],['ai3','data']]){await put('artifact',id,ai(id,role),'c1');await put('provider_usage','hermes:'+id,{id:'hermes:'+id,artifactId:id,promptVersion:'practice-v9:'+id+'hash'})}
await call(action,ADMIN,{action:'review_artifact',id:'ai1',version:1,decision:'approved'});
const aiDecision=decisions().at(-1);
check('decisions copy prompt, skill and output contract versions from the artifact and usage ledger',aiDecision.promptVersion==='practice-v9:ai1hash'&&aiDecision.skillVersion==='practice-v9'&&aiDecision.outputContractVersion==='role-output-v1'&&aiDecision.origin==='ai');
await call(action,ADMIN,{action:'review_artifact',id:'ai2',version:1,decision:'revision',note:'채널 계획을 구체화해 주세요.',reasonCodes:['execution']});
await call(action,ADMIN,{action:'review_artifact',id:'ai3',version:1,decision:'approved'});

// 6) D: AI 작업물을 사람이 고치면 ai_edited + 원본 id·버전 + 편집 통계
r=await call(action,ADMIN,{action:'save_artifact',id:'ai2',version:1,campaignId:'c1',role:'cmo',title:'전략 ai2',content:'## 목표\n평일 방문 초안\n## 채널\n인스타그램 게시와 당근 소식'});
let edited=await server.readRecord(O,'artifact','ai2');
check('a human edit of an AI artifact is marked ai_edited with its source id and version',r.status===200&&edited.origin==='ai_edited'&&edited.aiSourceId==='ai2:1'&&edited.version===2);
check('edit stats name the changed section and a ratio between 0 and 1',JSON.stringify(edited.editStats.changedSections)==='["채널"]'&&edited.editStats.diffRatio>0&&edited.editStats.diffRatio<1);
await call(action,ADMIN,{action:'save_artifact',id:'ai2',version:2,campaignId:'c1',role:'cmo',title:'전략 ai2',content:'## 목표\n주말 방문\n## 채널\n인스타그램 게시와 당근 소식'});
edited=await server.readRecord(O,'artifact','ai2');
check('a second edit keeps the AI source and measures against it',edited.aiSourceId==='ai2:1'&&JSON.stringify(edited.editStats.changedSections)==='["목표","채널"]');
await call(action,ADMIN,{action:'review_artifact',id:'ai2',version:3,decision:'approved'});
const editedDecision=decisions().at(-1);
check('a decision on an edited artifact keeps the AI source versions',editedDecision.origin==='ai_edited'&&editedDecision.skillVersion==='practice-v9'&&editedDecision.promptVersion==='practice-v9:ai2hash');
const rates=plain(await store.firstPassApprovalRates(O));
const cmoRate=rates.find(x=>x.role==='cmo'&&x.skillVersion==='practice-v9'),dataRate=rates.find(x=>x.role==='data'&&x.skillVersion==='practice-v9');
check('first-pass approval rate is grouped by role and skill version',cmoRate?.artifacts===2&&cmoRate.approvedFirst===1&&cmoRate.editedFirst===0&&cmoRate.rate===0.5&&dataRate?.rate===1);
check('manual artifacts are left out of the first-pass rate',rates.every(x=>x.skillVersion!==null||x.role!=='cmo')&&JSON.stringify(plain(pure.firstPassApproval([{targetKind:'artifact',targetId:'m',origin:'manual',decision:'approved',role:'cmo',skillVersion:null}])))==='[]');
check('the pure aggregation agrees with the stored one',JSON.stringify(plain(pure.firstPassApproval(decisions())))===JSON.stringify(rates));
check('the panel shows the readable origin label',(()=>{const panels=readFileSync('app/panels.tsx','utf8');return (panels.match(/originLabel\(a\.origin\)/g)||[]).length>=2&&!panels.includes("a.origin==='ai'?'AI 작성':'직접 등록'")})());

// 7) H: 선호 쌍(AI 원본·사람 확정본·판정)을 조회로만 묶는다
const pair=plain(await store.preferencePair(O,'ai2'));
check('preference pair joins the AI original, the human final and the decisions',pair.ai.version===1&&pair.ai.content.includes('인스타그램 게시')&&!pair.ai.content.includes('당근')&&pair.human.version===3&&pair.human.status==='approved'&&pair.human.content.includes('주말')&&pair.decisions.length===2);
check('a manual artifact has no preference pair',(await store.preferencePair(O,'art2'))===null);

// 7-1) 사람이 먼저 고친 뒤 받은 첫 승인은 1차 승인이 아니다(AI 원본 그대로의 승인만 센다)
await put('campaign','c3',{id:'c3',brandId:'oda',title:'편집 후 승인',goal:'평일 방문',version:1,status:'review'});
await put('artifact','x1',artifact('x1',{campaignId:'c3',origin:'ai',skillVersion:'sv-edit',content:'## 목표\n평일 방문 초안\n## 채널\n인스타그램 게시'}),'c3');
r=await call(action,MEMBER,{action:'save_artifact',id:'x1',version:1,campaignId:'c3',role:'cmo',title:'전략 x1',content:'## 목표\n주말 방문\n## 채널\n당근 소식'});
r=await call(action,ADMIN,{action:'review_artifact',id:'x1',version:2,decision:'approved'});
const x1Decision=decisions().at(-1),x1Rate=plain(await store.firstPassApprovalRates(O)).find(x=>x.skillVersion==='sv-edit');
check('an approval given after a human edit is recorded as ai_edited on the edited version',r.status===200&&x1Decision.origin==='ai_edited'&&x1Decision.version===2&&x1Decision.skillVersion==='sv-edit');
check('edit first then approve is not a first-pass approval',x1Rate?.artifacts===1&&x1Rate.approvedFirst===0&&x1Rate.editedFirst===1&&x1Rate.rate===0);

// 7-2) B1 이전 사람 수정본(origin ai·v2 이상·meetingId 없음)은 AI 원본으로 보지 않는다
await put('campaign','c4',{id:'c4',brandId:'oda',title:'과거 수정본',goal:'평일 방문',version:1,status:'review'});
const aiOriginal=artifact('old1',{campaignId:'c4',origin:'ai',skillVersion:'v8',outputContractVersion:'role-output-v1',content:'## 목표\nAI가 쓴 원문'});
await put('history','h-old1',{...aiOriginal,id:'h-old1',originalId:'old1',status:'review'},'c4');
await put('artifact','old1',artifact('old1',{campaignId:'c4',origin:'ai',version:2,content:'## 목표\n사람이 B1 이전에 고친 문장'}),'c4');
await put('artifact','old2',artifact('old2',{campaignId:'c4',role:'data',origin:'ai',version:3,content:'## 목표\n이력 없는 과거 수정본'}),'c4');
await put('artifact','meet1',artifact('meet1',{campaignId:'c4',role:'data',origin:'ai',version:2,meetingId:'m1',skillVersion:'mv1',content:'## 목표\n회의 개선본'}),'c4');
const legacyPair=plain(await store.preferencePair(O,'old1'));
check('a legacy human edit pairs the earlier AI version, not itself',legacyPair.ai.version===1&&legacyPair.ai.skillVersion==='v8'&&legacyPair.ai.content.includes('AI가 쓴 원문')&&legacyPair.human.version===2&&legacyPair.human.origin==='ai_edited'&&legacyPair.human.content.includes('B1 이전')&&legacyPair.ai.content!==legacyPair.human.content);
check('a legacy human edit without an AI history has no AI side',plain(await store.preferencePair(O,'old2')).ai===null);
const meetingPair=plain(await store.preferencePair(O,'meet1'));
check('a meeting version stays an AI original',meetingPair.ai.version===2&&meetingPair.ai.skillVersion==='mv1'&&meetingPair.human===null);
await call(action,ADMIN,{action:'review_artifact',id:'meet1',version:2,decision:'approved'});
check('a decision on a meeting version keeps origin ai',decisions().at(-1).origin==='ai'&&decisions().at(-1).skillVersion==='mv1');
await call(action,ADMIN,{action:'review_artifact',id:'old2',version:3,decision:'approved'});
check('a decision on a legacy edit without history is ai_edited with no skill version',decisions().at(-1).origin==='ai_edited'&&decisions().at(-1).skillVersion===null);
await call(action,ADMIN,{action:'review_artifact',id:'old1',version:2,decision:'revision',note:'다시'});
check('a decision on a legacy edit is ai_edited with the AI source versions',decisions().at(-1).origin==='ai_edited'&&decisions().at(-1).skillVersion==='v8'&&decisions().at(-1).outputContractVersion==='role-output-v1');
r=await call(action,ADMIN,{action:'save_artifact',id:'old1',version:2,campaignId:'c4',role:'cmo',title:'전략 old1',content:'## 목표\nAI가 쓴 원문\n## 채널\n추가'});
const relabeled=await server.readRecord(O,'artifact','old1');
check('editing a legacy edit measures against the earlier AI version',r.status===200&&relabeled.origin==='ai_edited'&&relabeled.aiSourceId==='old1:1'&&relabeled.aiSource.skillVersion==='v8'&&JSON.stringify(relabeled.editStats.changedSections)==='["채널"]');
check('legacy edits are not first-pass approvals either',plain(await store.firstPassApprovalRates(O)).every(x=>x.skillVersion!=='v8'||x.approvedFirst===0));

// 8) E: 브리프 저장 때 AI 제안 필드마다 채택·수정·미사용 기록(기존 저장 동작 불변)
const plan={behavior:'',kpi:'',baseline:'',target:'',barrier:'',message:'',journey:'',deliverables:'',hypothesis:'',experiment:'',tracking:'',decision:'',operations:'',owner:'',schedule:'',budgetPlan:'',learning:''};
const suggestions=[['audience','인근 직장인'],['kpi','재방문율'],['hypothesis','가설 A'],['experiment','실험 A'],['tracking','POS 기록'],['decision','확대 기준']].map(([field,value])=>({field,value,reason:'근거'}));
await put('brief_draft','draft1',{id:'draft1',status:'completed',input:{brandId:'oda',title:'',goal:'평일 방문을 늘립니다.',audience:'직장인',channels:'',stores:'',products:'',budget:null,startDate:'',endDate:'',constraints:'',sources:'',plan},result:{summary:'요약',suggestions,questions:[],assumptions:[],contextUsed:[]},createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),model:'HERMES'});
await put('provider_usage','hermes:draft1',{id:'hermes:draft1',jobId:'draft1',promptVersion:'inline:draft1hash'});
const brief={action:'save_campaign',briefDraftId:'draft1',data:{brandId:'oda',title:'브리프',goal:'평일 방문을 늘립니다.',audience:'직장인',plan:{...plan,kpi:'재방문율',hypothesis:'가설 A를 고친 가설',tracking:'POS 기록',decision:'다른 기준'}}};
const campaigns=count('campaign'),m=decisions().length;
r=await call(action,MEMBER,{...brief,suggestionReasons:['nope']});
check('an unknown suggestion reason is 400 and saves no brief',r.status===400&&count('campaign')===campaigns&&decisions().length===m);
r=await call(action,MEMBER,{...brief,suggestionReasons:['measurement']});
const saved=await server.readRecord(O,'campaign',r.data.id),briefDecisions=decisions().filter(d=>d.targetKind==='brief_suggestion');
check('each suggested field gets one adopted, edited or ignored decision',r.status===200&&JSON.stringify(briefDecisions.map(d=>[d.section,d.decision]))==='[["audience","ignored"],["kpi","adopted"],["hypothesis","edited"],["experiment","ignored"],["tracking","adopted"],["decision","edited"]]');
check('brief decisions point at the draft, the saved brief version and the prompt version',briefDecisions.every(d=>d.targetId==='draft1'&&d.version===saved.version&&d.campaignId===saved.id&&d.promptVersion==='inline:draft1hash'&&d.role===null));
check('suggestion reasons apply only to edited and ignored fields',briefDecisions.every(d=>JSON.stringify(d.reasonCodes)===(d.decision==='adopted'?'[]':'["measurement"]')));
check('the saved brief keeps its existing draft meta',JSON.stringify(Object.keys(saved.draftMeta.values))==='["kpi","tracking"]'&&(await server.readRecord(O,'brief_draft','draft1')).savedCampaignId===saved.id);
r=await call(action,MEMBER,brief);
check('a retried save records no duplicate suggestion decisions',r.data.id===saved.id&&decisions().filter(d=>d.targetKind==='brief_suggestion').length===6);

// 9) F: 조사 자료 제외와 발행 취소·되돌림 사유(선택)
const source=(id,version=1)=>({id,brandId:'oda',title:'자료 '+id,category:'other',origin:'manual',status:'candidate',url:'',content:'내용',observedAt:new Date().toISOString(),createdAt:new Date().toISOString(),version,scope:'범위'});
for(const id of ['s1','s2','s3','s4'])await put('brand_source',id,source(id),'oda');
r=await call(archive,ADMIN,{action:'review_source',brandId:'oda',id:'s1',version:1,status:'excluded',reasonCodes:['question_only']});
check('an inapplicable source reason is 400 and leaves the source alone',r.status===400&&(await server.readRecord(O,'brand_source','s1')).status==='candidate');
r=await call(archive,ADMIN,{action:'review_source',brandId:'oda',id:'s1',version:1,status:'excluded',reasonCodes:['evidence']});
const excluded=decisions().at(-1);
check('source exclusion records the reason',r.status===200&&excluded.targetKind==='source'&&excluded.targetId==='s1'&&excluded.decision==='excluded'&&excluded.version===1&&excluded.brandId==='oda'&&excluded.campaignId===null&&excluded.reasonCodes[0]==='evidence');
const k=decisions().length;
r=await call(archive,ADMIN,{action:'review_source',brandId:'oda',id:'s2',version:1,status:'excluded'});
check('exclusion without a reason works as before and is still logged',r.status===200&&(await server.readRecord(O,'brand_source','s2')).status==='excluded'&&decisions().length===k+1&&decisions().at(-1).reasonCodes.length===0);
r=await call(archive,ADMIN,{action:'review_sources',brandId:'oda',items:[{id:'s3',version:1,status:'confirmed'},{id:'s4',version:1,status:'excluded'}],reasonCodes:['brand']});
check('bulk review logs only excluded items',r.status===200&&decisions().length===k+2&&decisions().at(-1).targetId==='s4'&&decisions().at(-1).reasonCodes[0]==='brand');

await put('campaign','c2',{id:'c2',brandId:'oda',title:'발행',goal:'발행',version:1,status:'approved'});
const publication=id=>({id,campaignId:'c2',creativeId:'cr',status:'draft',version:1,mediaMode:'external',mediaUrl:'',pngHash:'0'.repeat(64),caption:'문구',channelId:'',scheduledAt:new Date(Date.now()+3600000).toISOString(),plannedCostKRW:0,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()});
for(const id of ['p1','p2'])await put('execution_publication',id,publication(id),'c2');
r=await call(execution,ADMIN,{action:'cancel',campaignId:'c2',id:'p1',version:1,reasonCodes:['nope']});
check('an unknown publication reason is 400 and keeps the publication',r.status===400&&(await server.readRecord(O,'execution_publication','p1')).status==='draft');
r=await call(execution,ADMIN,{action:'cancel',campaignId:'c2',id:'p1',version:1,reasonCodes:['compliance']});
const cancelled=decisions().at(-1);
check('publication cancel records the reason',r.status===200&&r.data.status==='cancelled'&&cancelled.targetKind==='publication'&&cancelled.targetId==='p1'&&cancelled.decision==='cancelled'&&cancelled.reasonCodes[0]==='compliance'&&cancelled.campaignId==='c2'&&cancelled.actor.id==='admin');
r=await call(execution,ADMIN,{action:'cancel',campaignId:'c2',id:'p2',version:1});
check('publication cancel without a reason works as before',r.status===200&&r.data.status==='cancelled'&&decisions().at(-1).targetId==='p2');
// 판정 쓰기가 실패하면 발행 상태·이벤트도 바뀌지 않는다(한 묶음). 같은 버전으로 다시 시도하면 둘 다 쓴다
await put('execution_publication','p3',publication('p3'),'c2');
await put('execution_publication','p4',{...publication('p4'),status:'approved'},'c2');
failWrite=statement=>{if(statement.query.startsWith('INSERT INTO records')&&statement.values[2]==='review_decision')throw new Error('판정 쓰기 실패(모의)')};
let d=decisions().length;events=count('event');
r=await call(execution,ADMIN,{action:'cancel',campaignId:'c2',id:'p3',version:1});
let p3=await server.readRecord(O,'execution_publication','p3');
check('a failed decision write rolls back the cancel',r.status===500&&p3.status==='draft'&&p3.version===1&&decisions().length===d);
r=await call(execution,ADMIN,{action:'reconfirm',campaignId:'c2',id:'p4',version:1});
let p4=await server.readRecord(O,'execution_publication','p4');
check('a failed decision write rolls back the reconfirm and its event',r.status===500&&p4.status==='approved'&&p4.version===1&&decisions().length===d&&count('event')===events);
failWrite=null;
r=await call(execution,ADMIN,{action:'cancel',campaignId:'c2',id:'p3',version:1});
p3=await server.readRecord(O,'execution_publication','p3');
check('retrying the cancel with the same version records both',r.status===200&&p3.status==='cancelled'&&p3.version===2&&decisions().length===d+1&&decisions().at(-1).targetId==='p3'&&decisions().at(-1).decision==='cancelled');
r=await call(execution,ADMIN,{action:'reconfirm',campaignId:'c2',id:'p4',version:1,reasonCodes:['voice']});
p4=await server.readRecord(O,'execution_publication','p4');
check('retrying the reconfirm with the same version records both',r.status===200&&p4.status==='draft'&&p4.version===2&&decisions().length===d+2&&decisions().at(-1).decision==='returned'&&decisions().at(-1).reasonCodes[0]==='voice'&&count('event')===events+1);

// 10) I: records kind 정책. 평가 자료라 eval_case처럼 캠페인을 지워도 남기고, 삭제 영향 조회에는 보존 건수로 잡는다
const kind=plain(registry.recordKinds).find(x=>x.kind==='review_decision');
check('review_decision is registered as retained through campaignId without blocking deletion',kind.campaignDeletion==='retain'&&JSON.stringify(kind.links)==='["data_campaign"]'&&!kind.blocksDeletion&&kind.parent==='none');
const kept=decisions().filter(d=>d.campaignId==='c1').length,preview=plain(await server.campaignDeletionPreview(O,'c1'));
check('the deletion preview counts decisions as retained',kept>0&&preview.retained.review_decision===kept&&!preview.deleted.review_decision);
r=await call(action,ADMIN,{action:'delete_campaign',id:'c1',version:1,confirmed:true});
check('deleting a campaign keeps its decisions and the source decisions',r.status===200&&decisions().filter(d=>d.campaignId==='c1').length===kept&&decisions().filter(d=>d.targetKind==='source').length===3);
check('the retained decisions hold no review note text or reviewer email',rows().every(x=>!x.data.includes('가격 표기')&&!x.data.includes('근거를 보강해 주세요')&&!x.data.includes('@test.invalid')));
check('the deletion dialog names the retained decision log',deletionSummary({...preview,retained:{review_decision:kept}}).retained===`보존: 사람 판정 로그 ${kept}건(사유 코드·판정만, 검토 메모 원문 없음)`);

// 11) 화면 연결과 문서
const panels=readFileSync('app/panels.tsx','utf8'),archiveUi=readFileSync('app/brand-archive.tsx','utf8'),publishUi=readFileSync('app/execution-panel.tsx','utf8'),briefUi=readFileSync('app/campaign-brief.tsx','utf8');
check('the artifact dialog shows reason chips and sends reasons and criteria',panels.includes("reasonChoices('artifact'")&&panels.includes('reasonCodes:reasons')&&panels.includes('criteria')&&panels.includes('b1_reason_required'));
check('archive exclusion, publication cancel and brief save send optional reasons',archiveUi.includes('reasonCodes')&&publishUi.includes('reasonCodes')&&briefUi.includes('suggestionReasons'));
const doc=existsSync('docs/REVIEW-DECISIONS.ko.md')?readFileSync('docs/REVIEW-DECISIONS.ko.md','utf8'):'';
check('the reason code table documents every code and grader mapping',codes.every(c=>doc.includes('`'+c+'`'))&&mapped.every(id=>doc.includes(id))&&doc.includes('review_decision'));

// 12) LLM 호출·토큰 증가 0
check('no provider call was made',fetchCalls===0&&count('provider_usage')===4);
console.log(JSON.stringify({passed},null,1));
