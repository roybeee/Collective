// X7 신뢰 UI 회귀(docs/GLOBAL-PLAN.ko.md 에픽 X7): ref 라벨 → 인용 조각 나누기, 근거 3단계 판정, 출처 읽기 API(인용 지도·AI 출처·규제 점검 보기, 소유자 범위),
// 승인 판정의 manuallyVerified 저장(선택·이전 요청 호환), '다시 점검' regrade_artifact(결정론·대표/관리자 권한·grading 덮어쓰기), 화면 연결.
// 근거: mocked(메모리 SQLite, 헤더 세션 주입, fetch 스텁). 모델·외부 네트워크 호출은 0회다. 데이터는 합성(실제 고객·매장 아님).
import {koSource} from './helpers/i18n-source.mjs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {testRuntime} from './helpers/runtime.mjs';

let fetchCalls=0;
const rt=testRuntime(async()=>{fetchCalls++;throw new Error('외부 호출 금지')});
Object.assign(rt.env,{AUTH_MODE:'email',AUTH_ORIGIN:'https://app.test'});
const refs=await rt.load('lib/citation-refs.ts'),conf=await rt.load('lib/evidence-confidence.ts'),disclosure=await rt.load('lib/ai-disclosure.ts');
const server=await rt.load('lib/server.ts'),execution=await rt.load('lib/role-execution.ts');
const sourcesRoute=await rt.load('app/api/artifact-sources/route.ts'),usageRoute=await rt.load('app/api/usage/route.ts'),actionRoute=await rt.load('app/api/action/route.ts');
const plain=x=>JSON.parse(JSON.stringify(x));
let passed=0;const check=(name,ok)=>{assert.ok(ok,name);passed++};

// ── 1) ref 라벨 → 인용 조각(순수) ──
const LINE='상권은 브랜드 자료 #3 기준이고 매장은 확정 사실 주소에 있습니다. 근거는 https://example.test/report. 참고하세요.';
const segs=plain(refs.parseCitations(LINE,['주소']));
check('segments rejoin to the original line',segs.map(s=>s.text).join('')===LINE);
const found=segs.filter(s=>s.type==='ref').map(s=>s.ref);
check('archive, fact and external refs are found in order',JSON.stringify(found.map(r=>r.kind))==='["archive","fact","external"]');
check('archive pill keys by its label and shows a short name',found[0].key==='브랜드 자료 #3'&&found[0].short==='자료 3');
check('fact pill keys by fact:<항목>',found[1].key==='fact:주소'&&found[1].short==='사실 주소'&&found[1].label==='확정 사실 주소');
check('an external url drops trailing punctuation and shows its domain',found[2].url==='https://example.test/report'&&found[2].short==='example.test'&&segs.some(s=>s.type==='text'&&s.text.startsWith('. 참고')));
check('a fact key alone without the confirmed-fact marker is not a citation',refs.refsOf('주소는 가상동입니다.',['주소']).length===0);
check('an unknown fact key is not a citation',refs.refsOf('확정 사실 가격 4,500원',['주소']).length===0);
const bracket=plain(refs.parseCitations('[사실: 주소 · 확정 사실] 가상동 12',['주소']));
check('the franchise fact marker is one fact pill (no overlapping archive/brief hit)',bracket.filter(s=>s.type==='ref').length===1&&bracket[0].ref.kind==='fact'&&bracket[0].text==='[사실: 주소 · 확정 사실]');
const mixed=plain(refs.refsOf('브랜드 진단과 브리프 v3, 콘텐츠 스튜디오 v2, 채널 관찰 #2를 참고했습니다.'));
check('diagnosis, brief, role artifact and observation labels are recognised',JSON.stringify(mixed.map(r=>r.kind))==='["diagnosis","brief","artifact","observation"]'&&mixed[2].label==='콘텐츠 스튜디오 v2');
check('text without any label is a single text segment',JSON.stringify(plain(refs.parseCitations('그냥 문장입니다.')))==='[{"type":"text","text":"그냥 문장입니다."}]');
const units=plain(refs.claimSentences('# 제목은 세지 않음\n\n- 브랜드 자료 #1에 따르면 평일 오후 방문이 많습니다. 짧음.\n가격은 [확인 필요]로 둡니다 이 문장도 충분히 깁니다.\n|---|---|'));
check('claim sentences skip headings, gaps, short bits and table rules',units.length===2&&units[0].refs.length===1&&units[1].checkFlag===true&&units[1].refs.length===0);
check('sentence split rejoins to the line',refs.splitSentences('가. 나! 다?').join('')==='가. 나! 다?');

// ── 2) 근거 3단계(순수) ──
const SUFFICIENT='브랜드 자료 #1에 따르면 평일 오후 방문이 많습니다. 매장 위치는 확정 사실 주소에 있는 가상동 12입니다.';
const s1=plain(conf.evidenceConfidence(SUFFICIENT,{factKeys:['주소']}));
check('all sentences cited with a confirmed fact and no flags is sufficient',s1.level==='sufficient'&&s1.label==='근거 충분'&&s1.counts.cited===2&&s1.counts.sentences===2&&s1.counts.confirmedFacts===1);
check('a compliance warning drops sufficient to partial',conf.evidenceConfidence(SUFFICIENT,{factKeys:['주소'],warns:1}).level==='partial');
check('citations without any confirmed fact are partial',conf.evidenceConfidence('브랜드 자료 #1에 따르면 평일 오후 방문이 많습니다. 브랜드 자료 #2는 주말 방문을 보여 줍니다.').level==='partial');
const none=plain(conf.evidenceConfidence('평일 오후 방문이 가장 많은 동네 맛집입니다. 지금 바로 포장 주문하세요 정말 맛있습니다.'));
check('no cited sentence is insufficient',none.level==='insufficient'&&none.label==='근거 부족'&&none.counts.cited===0);
check('a compliance block is insufficient even when cited',conf.evidenceConfidence(SUFFICIENT,{factKeys:['주소'],blocks:1}).level==='insufficient');
check('three check flags are insufficient',conf.evidenceConfidence(SUFFICIENT+' 가격 [확인 필요] 효능 [확인 필요] 순위 [확인 필요] 표시입니다.',{factKeys:['주소']}).level==='insufficient');
check('a ratio below 20% is insufficient',conf.confidenceLevel({sentences:10,cited:1,confirmedFacts:1,checkFlags:0,warns:0,blocks:0})==='insufficient'&&conf.confidenceLevel({sentences:10,cited:2,confirmedFacts:0,checkFlags:0,warns:0,blocks:0})==='partial');
check('manual verification is required only for AI origins at insufficient',conf.needsManualVerification('ai',none)&&conf.needsManualVerification('ai_edited',none)&&!conf.needsManualVerification('manual',none)&&!conf.needsManualVerification('ai',s1)&&!conf.needsManualVerification('ai',null));

// ── 3) 합성 데이터와 세션 ──
const O='workspace',X='other-ws',ADMIN='a'.repeat(64),MEMBER='b'.repeat(64),OTHER='c'.repeat(64),now=new Date().toISOString();
for(const [id,role,token,ws] of [['admin','admin',ADMIN,O],['member','member',MEMBER,O],['x-admin','admin',OTHER,X]]){
 rt.sql.prepare('INSERT INTO auth_users(id,email,workspace_owner,role,status,created_at) VALUES(?,?,?,?,?,?)').run(id,id+'@test.invalid',ws,role,'active',Date.now());
 rt.sql.prepare('INSERT INTO auth_sessions VALUES(?,?,?,?)').run(createHash('sha256').update(token).digest('hex'),id,Date.now()+60000,Date.now());
}
const cookie=token=>({cookie:'__Host-collective_session='+token});
const get=async(q,token=ADMIN)=>{const r=await sourcesRoute.GET(new Request('https://app.test/api/artifact-sources'+q,{headers:cookie(token)}));return {status:r.status,data:await r.json()}};
const post=async(mod,token,data)=>{const r=await mod.POST(new Request('https://app.test/api/test',{method:'POST',headers:{...cookie(token),origin:'https://app.test','content-type':'application/json'},body:JSON.stringify(data)}));return {status:r.status,data:await r.json()}};
const put=(kind,id,data,parent='',owner=O)=>server.recordStatement(owner,kind,id,data,parent).run();
await put('brand','gb',{id:'gb',name:'가상분식',short:'GB'});
await put('campaign','c1',{id:'c1',brandId:'gb',title:'가상분식 오픈',goal:'첫 포장 주문',audience:'',channels:'Instagram',stores:'',products:'떡볶이',budget:null,startDate:'',endDate:'',constraints:'',sources:'',status:'review',version:1,createdAt:now,updatedAt:now});
await put('brand_source','src-0001-synthetic-archive',{id:'src-0001-synthetic-archive',brandId:'gb',title:'가상 상권 조사',category:'market',origin:'manual',status:'confirmed',url:'https://example.test/market',content:'합성',observedAt:'2026-10-01T00:00:00.000Z',createdAt:now,version:1,scope:'brand'},'gb');
await put('brand_fact','f-addr',{id:'f-addr',brandId:'gb',key:'address',value:'가상동 12',status:'confirmed',source:'합성 원장',verifiedAt:'2026-10-02T00:00:00.000Z',validUntil:'2099-12-31T00:00:00.000Z',version:1,updatedAt:now},'gb');
const JOB='job-synthetic-0001',AID=await execution.roleArtifactId(JOB);
rt.sql.prepare('INSERT INTO jobs(id,owner,campaign_id,role,status,model,campaign_version,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)').run(JOB,O,'c1','content','completed','configured-model',1,now,now);
await put('role_output_contract',JOB,{version:'role-output-v1',role:'content',sections:[],idLabels:{'src-0001-synthetic-archive':'브랜드 자료 #1','c1':'브리프 v1'}},'c1');
await put('learning_snapshot',JOB,{id:JOB,campaignId:'c1',role:'content',rules:[{id:'r1'},{id:'r2'}],createdAt:now},'c1');
await put('provider_usage','openai:run-1',{id:'openai:run-1',provider:'openai',providerRunId:'run-1',model:'reported-model',artifactId:AID,observedAt:now});
const CONTENT='## 게시물 카피\n브랜드 자료 #1에 따르면 평일 오후 방문이 많습니다. 매장은 확정 사실 주소에 있는 가상동 12입니다.\n영수증 리뷰 이벤트로 음료를 증정합니다. 자세한 안내는 https://example.test/menu 에서 확인하세요.';
await put('artifact',AID,{id:AID,campaignId:'c1',campaignVersion:1,role:'content',title:'콘텐츠 · 가상분식',content:CONTENT,version:1,status:'review',origin:'ai',factRefs:[{id:'f-addr',version:1,status:'confirmed'}],createdAt:now},'c1');
await put('grading',`${AID}:1`,{id:`${AID}:1`,artifactId:AID,artifactVersion:1,campaignId:'c1',role:'content',source:'role',jobId:JOB,meetingId:null,status:'graded',graders:[],summary:null,compliance:null,context:{facts:'current',confirmedFacts:1,prohibitedFacts:0,industry:null,localStore:false,inputTokens:1234},durationMs:1,gradedAt:'2026-10-03T00:00:00.000Z'},'c1');
await put('creative_score',`${AID}:1`,{id:`${AID}:1`,artifactId:AID,artifactVersion:1,campaignId:'c1',score:72,band:'높음'},'c1');
await put('creative_score',`${AID}:0`,{id:`${AID}:0`,artifactId:AID,artifactVersion:0,campaignId:'c1',score:10,band:'낮음'},'c1');
await put('campaign','cx',{id:'cx',brandId:'gb',title:'남의 캠페인',version:1,status:'review'},'',X);
await put('artifact','ax',{id:'ax',campaignId:'cx',campaignVersion:1,role:'cmo',title:'남의 작업물',content:'남의 본문',version:1,status:'review',origin:'manual',createdAt:now},'cx',X);

// ── 4) 출처 읽기 API ──
let r=await get('?artifact='+AID);
check('GET returns 200 for the owner admin',r.status===200);
const d=r.data;
check('the archive label resolves through the run contract to the brand source',d.refs['브랜드 자료 #1']?.kind==='archive'&&d.refs['브랜드 자료 #1'].title==='가상 상권 조사'&&d.refs['브랜드 자료 #1'].url==='https://example.test/market'&&d.refs['브랜드 자료 #1'].brandId==='gb'&&d.refs['브랜드 자료 #1'].observedAt==='2026-10-01T00:00:00.000Z');
check('the brief label resolves to the campaign record',d.refs['브리프 v1']?.kind==='brief'&&d.refs['브리프 v1'].title.includes('가상분식 오픈'));
check('the fact ref carries value, check date and validity',d.refs['fact:주소']?.value==='가상동 12'&&d.refs['fact:주소'].validUntil==='2099-12-31T00:00:00.000Z'&&d.refs['fact:주소'].observedAt==='2026-10-02T00:00:00.000Z'&&JSON.stringify(d.factKeys)==='["address","주소"]'&&d.refs['fact:address']?.title==='주소');
const parsedKeys=refs.refsOf(CONTENT,d.factKeys).filter(x=>x.kind!=='external').map(x=>x.key);
check('every non-external pill in the artifact text has a resolved source',parsedKeys.length===2&&parsedKeys.every(k=>d.refs[k]?.found));
check('origin info comes from the run: reported model, rules, brief version, disclosure',d.origin.via==='role'&&d.origin.model==='reported-model'&&d.origin.learningRules===2&&d.origin.briefVersion===1&&d.origin.roleName==='콘텐츠 스튜디오'&&d.origin.originLabel==='AI 작성'&&d.origin.generatedAt===now&&d.origin.disclosure.applies===true&&d.origin.disclosure.line===disclosure.AI_DISCLOSURE_LINE);
const block=d.compliance.issues.find(i=>i.severity==='block');
check('compliance view lists the block issue with excerpt and law sources',d.compliance.status==='checked'&&block?.ruleId==='receipt_review_event'&&block.excerpt.includes('리뷰 이벤트')&&block.sources.length>=1&&block.sources.every(s=>/^https:\/\//.test(s.url)&&s.title));
const pr=d.compliance.categories.find(c=>c.category==='platform_review');
check('category counts: platform review has a block and passing rules',pr&&pr.label==='플랫폼 리뷰'&&pr.block>=1&&pr.pass>=1&&d.compliance.categories.every(c=>c.category!=='franchise_recruit'||c.pass>=0));
check('stored grading time is reported',d.compliance.gradedAt==='2026-10-03T00:00:00.000Z');
check('a member can read sources',(await get('?artifact='+AID,MEMBER)).status===200);
check('another owner gets 404 for this artifact',(await get('?artifact='+AID,OTHER)).status===404);
check('reading its own artifact works for the other owner',(await get('?artifact=ax',OTHER)).status===200&&(await get('?artifact=ax',ADMIN)).status===404);
check('a missing parameter is 400',(await get('')).status===400);
r=await get('?campaign=c1');
check('score summaries return only the current version',r.status===200&&r.data.scores.length===1&&r.data.scores[0].score===72&&r.data.scores[0].band==='높음');
check('score summaries are owner scoped',(await get('?campaign=c1',OTHER)).status===404);
const manualInfo=(await get('?artifact=ax',OTHER)).data.origin;
check('a manual artifact has no AI disclosure and no run',manualInfo.via==='manual'&&manualInfo.disclosure.applies===false&&manualInfo.model===null&&manualInfo.originLabel==='직접 등록');

await put('team_meeting','mt1',{id:'mt1',campaignId:'c1',campaignVersion:1,agenda:'합성 회의',status:'completed',steps:[],createdAt:now,updatedAt:now,model:'meeting-model',stopRequested:false,artifactIds:['ma1'],invalidatedRoles:[],snapshot:{campaign:{id:'c1',version:1},brandArchive:{confirmedSources:[{id:'src-0001-synthetic-archive'}]},artifacts:[],learning:[{id:'r1'}]}},'c1');
await put('artifact','ma1',{id:'ma1',meetingId:'mt1',campaignId:'c1',campaignVersion:1,role:'strategy',title:'회의 전략',content:'브랜드 자료 #1을 근거로 평일 오후를 겨냥합니다.',version:1,status:'review',origin:'ai',createdAt:now},'c1');
const meetingSources=(await get('?artifact=ma1')).data;
check('a meeting artifact resolves labels from the team_meeting snapshot',meetingSources.origin.via==='meeting'&&meetingSources.origin.model==='meeting-model'&&meetingSources.origin.learningRules===1&&meetingSources.refs['브랜드 자료 #1']?.title==='가상 상권 조사');

// ── 5) 다시 점검(regrade_artifact) ──
check('a member cannot regrade (403)',(await post(usageRoute,MEMBER,{action:'regrade_artifact',artifactId:AID})).status===403);
check('another owner cannot regrade this artifact (404)',(await post(usageRoute,OTHER,{action:'regrade_artifact',artifactId:AID})).status===404);
check('a missing artifact id is 400',(await post(usageRoute,ADMIN,{action:'regrade_artifact'})).status===400);
const g1=await post(usageRoute,ADMIN,{action:'regrade_artifact',artifactId:AID});
check('admin regrade returns 200 with a compliance view',g1.status===200&&g1.data.compliance.status==='checked'&&g1.data.grading.status==='graded');
check('regrade compliance matches the read view (deterministic)',JSON.stringify(g1.data.compliance.issues)===JSON.stringify(d.compliance.issues)&&JSON.stringify(g1.data.compliance.categories)===JSON.stringify(d.compliance.categories));
const stored=()=>JSON.parse(rt.sql.prepare("SELECT data FROM records WHERE owner=? AND kind='grading' AND id=?").get(O,`${O}:grading:${AID}:1`).data);
const after1=stored();
check('the grading row is overwritten in place with graders, compliance and the actor',after1.status==='graded'&&after1.graders.length>0&&after1.compliance.block>=1&&after1.regradedBy.id==='admin'&&after1.jobId===JOB&&after1.source==='role');
check('reported input tokens from the previous grading are kept',after1.context.inputTokens===1234);
check('one grading row per artifact version',rt.sql.prepare("SELECT COUNT(*) AS n FROM records WHERE owner=? AND kind='grading'").get(O).n===1);
const g2=await post(usageRoute,ADMIN,{action:'regrade_artifact',artifactId:AID});
const after2=stored(),strip=g=>JSON.stringify({...g,gradedAt:null,durationMs:null});
check('a second regrade yields the same graders and summary',strip(after1)===strip(after2)&&JSON.stringify(g1.data.grading.summary)===JSON.stringify(g2.data.grading.summary));
check('regrade does not touch the artifact',JSON.parse(rt.sql.prepare("SELECT data FROM records WHERE owner=? AND kind='artifact' AND id=?").get(O,`${O}:artifact:${AID}`).data).content===CONTENT);

// ── 6) manuallyVerified 저장 ──
const manual=(id)=>({id,campaignId:'c1',campaignVersion:1,role:'cmo',title:'전략 '+id,content:'## 목표\n평일 방문 초안',version:1,status:'review',origin:'manual',createdAt:now});
for(const id of ['m1','m2','m3','m4'])await put('artifact',id,manual(id),'c1');
const decisionFor=id=>rt.sql.prepare("SELECT data FROM records WHERE owner=? AND kind='review_decision' ORDER BY rowid").all(O).map(x=>JSON.parse(x.data)).filter(x=>x.targetId===id);
r=await post(actionRoute,ADMIN,{action:'review_artifact',id:'m1',version:1,decision:'approved',note:'',manuallyVerified:true});
check('approval with manuallyVerified:true is 200 and stored on the decision',r.status===200&&decisionFor('m1').length===1&&decisionFor('m1')[0].manuallyVerified===true);
r=await post(actionRoute,ADMIN,{action:'review_artifact',id:'m2',version:1,decision:'approved',note:''});
check('a legacy approval without the field still works and stores no key',r.status===200&&decisionFor('m2').length===1&&!('manuallyVerified' in decisionFor('m2')[0]));
r=await post(actionRoute,ADMIN,{action:'review_artifact',id:'m3',version:1,decision:'approved',note:'',manuallyVerified:'yes'});
check('a non-boolean manuallyVerified is 400 and writes nothing',r.status===400&&decisionFor('m3').length===0);
r=await post(actionRoute,ADMIN,{action:'review_artifact',id:'m4',version:1,decision:'revision',note:'고쳐 주세요.',manuallyVerified:true});
check('a revision does not store manuallyVerified',r.status===200&&decisionFor('m4').length===1&&!('manuallyVerified' in decisionFor('m4')[0]));
check('no model or network call happened',fetchCalls===0);

// ── 7) 화면 연결(정적) ──
const panels=koSource('app/panels.tsx'),pill=readFileSync('components/app/citation-pill.tsx','utf8'),badge=readFileSync('components/app/ai-origin-badge.tsx','utf8'),panel=readFileSync('components/app/compliance-panel.tsx','utf8');
check('the dialog renders citations, the origin badge, confidence and the compliance panel',/<CitedText /.test(panels)&&/<AiOriginBadge key="origin"/.test(panels)&&/<ConfidenceLabel /.test(panels)&&/<CompliancePanel /.test(panels));
check('the approve request carries manuallyVerified only when verification is required',/decision==='approved'&&mustVerify\?\{manuallyVerified:true\}:\{\}/.test(panels)&&/mustVerify&&!verified/.test(panels)&&/직접 확인했습니다/.test(panels));
check('list cards show the origin badge and score badge outside the card button',/<div className="artifact-trust-row"><AiOriginBadge /.test(panels)&&/<ScoreBadge /.test(panels)&&!/originLabel\(a\.origin\)/.test(panels));
check('popovers use the Radix popover and external links use noopener',/PopoverTrigger asChild/.test(pill)&&/PopoverTrigger asChild/.test(badge)&&/rel="noopener noreferrer"/.test(pill)&&/rel="noopener noreferrer"/.test(panel));
check('the compliance panel calls regrade and mounts the creative score card',/regradeArtifact\(artifactId\)/.test(panel)&&/<CreativeScoreCard /.test(panel)&&/법령 근거/.test(panel));
console.log(JSON.stringify({passed}));
