// B3-2a 교정 신호 회귀: 브랜드×역할 교정 묶음(90일·5건 eligible·인용 id 미리 채움·coveredBy), 규칙 버전별 파생 피드백(읽을 때 계산, 저장 없음),
// 같은 사유 재발률(4주, n<20 표본 부족), 경보 중 승인 동결(D3, 스위치 무관·ack로 해제·중지·연장은 막지 않음), 스위치 b3_playbook_signals(기본 꺼짐, 꺼지면 GET 바이트 동일).
// 근거: mocked(메모리 SQLite, 이메일 세션, 모의 HERMES fetch 스텁, 합성 데이터). 외부 네트워크 호출은 0회다.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,readdirSync} from 'node:fs';
import {testRuntime} from './helpers/runtime.mjs';
import {roleFixture} from './helpers/role-fixture.mjs';

const sent=new Map(),external=[];let hermesCalls=0;
const rt=testRuntime(async(url,options={})=>{
 url=String(url);
 if(!url.startsWith('https://hermes.example.com/')){external.push(url);throw new Error('모의 주소만 호출합니다: '+url)}
 hermesCalls++;
 if(url.endsWith('/v1/runs')){const id='sig_'+hermesCalls;sent.set(id,options.body);return Response.json({run_id:id})}
 const id=url.split('/').pop(),input=JSON.parse(sent.get(id)).input;
 return Response.json({object:'hermes.run',run_id:id,status:'completed',output:roleFixture(input),usage:{total_tokens:100,output_tokens:600},model:'mock-model'});
});
Object.assign(rt.env,{AUTH_MODE:'email',AUTH_ORIGIN:'https://app.test'});
const server=await rt.load('lib/server.ts'),route=await rt.load('app/api/learning/route.ts'),flags=await rt.load('lib/feature-flags.ts'),learning=await rt.load('lib/learning.ts');
const curator=await rt.load('lib/playbook-curator.ts'),registry=await rt.load('lib/prompt-registry.ts'),rewardRoute=await rt.load('app/api/reward-lineage/route.ts'),reward=await rt.load('lib/reward-lineage.ts');
const execution=await rt.load('lib/role-execution.ts'),instruction=await rt.load('lib/role-instruction.ts');
const plain=value=>JSON.parse(JSON.stringify(value));
let passed=0;const check=(name,ok)=>{assert.ok(ok,name);passed++};
const DAY=86400000,ago=days=>new Date(Date.now()-days*DAY).toISOString(),kstDay=ms=>new Date(ms+9*3600000).toISOString().slice(0,10);

// 1) 계정: 소유자(가장 먼저 만든 관리자)·관리자·직원 세션
const O='signals-ws',OWNER='d'.repeat(64),ADMIN='e'.repeat(64),MEMBER='f'.repeat(64);
[['sig-owner','admin',OWNER],['sig-admin','admin',ADMIN],['sig-member','member',MEMBER]].forEach(([id,role,token],i)=>{
 rt.sql.prepare('INSERT INTO auth_users(id,email,workspace_owner,role,status,created_at) VALUES(?,?,?,?,?,?)').run(id,id+'@test.invalid',O,role,'active',Date.now()-100000+i);
 rt.sql.prepare('INSERT INTO auth_sessions VALUES(?,?,?,?)').run(createHash('sha256').update(token).digest('hex'),id,Date.now()+600000,Date.now());
});
const session=token=>({cookie:'__Host-collective_session='+token,origin:'https://app.test'});
const call=async(token,data)=>{const r=await route.POST(new Request('https://app.test/api/learning',{method:'POST',headers:{...session(token),'content-type':'application/json'},body:JSON.stringify(data)}));return {status:r.status,data:await r.json()}};
const get=async(token=OWNER)=>{const r=await route.GET(new Request('https://app.test/api/learning',{headers:session(token)}));const text=await r.text();return {status:r.status,text,data:JSON.parse(text)}};
const put=(kind,id,data,parent='')=>server.recordStatement(O,kind,id,data,parent).run();
const rule=id=>server.readRecord(O,'learning_rule',id);
const ruleRows=()=>JSON.stringify(rt.sql.prepare("SELECT id,data,updated_at FROM records WHERE owner=? AND kind='learning_rule' ORDER BY id").all(O));
const allRows=()=>JSON.stringify(rt.sql.prepare('SELECT COUNT(*) n,MAX(updated_at) m FROM records').get());
const setSignals=enabled=>flags.setFeatureFlag(O,{flag:'b3_playbook_signals',enabled},{id:'sig-owner',email:null});
const NEW_KEYS=['correctionClusters','playbookFeedback','recurrence'];

// 2) 합성 데이터(실제 고객·매장 정보 아님). 브랜드 oda·ofd, 캠페인 c-oda(oda)·c-ofd(ofd). c-gone은 지운 캠페인이다.
await server.seedBrands(O);
const campaign=(id,brandId)=>({id,brandId,title:'합성 캠페인 '+id,goal:'평일 방문을 늘린다.',audience:'가상 주민(가설)',channels:'Instagram',stores:'',products:'',budget:null,startDate:'',endDate:'',constraints:'',sources:'',status:'draft',version:1,createdAt:ago(120),updatedAt:ago(120)});
for(const [id,brand] of [['c-oda','oda'],['c-ofd','ofd']])await put('campaign',id,campaign(id,brand));
const MEMO='검토 메모 원문 비밀';
const decision=(id,targetId,role,value,origin,reasonCodes,days,over={})=>put('review_decision',id,{id,targetKind:'artifact',targetId,version:1,role,decision:value,reasonCodes,noteLength:MEMO.length,actor:{id:'sig-owner',role:'owner'},promptVersion:null,skillVersion:null,outputContractVersion:null,campaignId:'c-oda',brandId:'oda',origin,reasonsVersion:'review-reasons-v1',createdAt:ago(days),...over});
const artifact=(id,role='content',origin='ai')=>put('artifact',id,{id,campaignId:'c-oda',campaignVersion:1,role,title:'작업물 '+id,content:'본문 원문 비밀',status:'review',version:1,origin,promptVersion:'role.content@aaaaaaaaaaaa',createdAt:ago(40)},'c-oda');
// insight: 90일 안 교정 5건(수정 요청 4·사람 수정본 승인 1) + 90일 밖 1건 + 교정 아닌 승인 1건 + 브랜드를 알 수 없는 교정 1건
await decision('rd-i1','art-i1','insight','revision','ai',['voice'],5);
await decision('rd-i2','art-i2','insight','revision','ai',['voice','format'],10);
await decision('rd-i3','art-i3','insight','revision','ai',['brand'],30);
await decision('rd-i4','art-i4','insight','approved','ai_edited',[],60);
await decision('rd-i5','art-i5','insight','revision','ai',['voice'],89);
await decision('rd-i6','art-i6','insight','revision','ai',['voice'],100);
await decision('rd-i7','art-i7','insight','approved','ai',[],3);
await decision('rd-ig','art-ig','insight','revision','ai',['voice'],4,{campaignId:'c-gone',brandId:null});
// cmo: 교정 4건(묶음 기준 미달)
for(const i of [1,2,3,4])await decision('rd-c'+i,'art-c'+i,'cmo','revision','ai',['evidence'],i*7);
// data: 4주 안 판정 20건 중 voice 교정 5건 → 재발률 0.25(측정)
for(let i=0;i<20;i++)await decision('rd-d'+i,'art-d'+i,'data',i<5?'revision':'approved','ai',i<5?['voice']:[],1+i);
// 운영자 선호 규칙 playbook:r1(content, v2 적용 중, rd-i1·rd-i2 인용 → 사유 voice·format). ago(18) 승인 감사.
const R='playbook:r1',RULE_TEXT='규칙 본문 원문 비밀',R_EXPIRES=ago(-40);
await put('learning_rule',R,{id:R,origin:'review',grade:'operator_preference',brandId:'oda',channel:'*',role:'content',experimentId:'',experimentVersion:0,caseId:'',title:'규칙',guidance:RULE_TEXT,scope:'사람 판정 2건 인용',citations:['rd-i1','rd-i2'],feedback:{helpful:0,harmful:0},status:'active',version:2,expiresAt:R_EXPIRES,createdAt:ago(20),updatedAt:ago(18)},'oda');
await put('playbook_audit','au1',{id:'au1',ruleId:R,brandId:'oda',action:'activate',fromStatus:'draft',toStatus:'active',ruleVersion:2,expiresAt:ago(-40),actor:{id:'sig-owner',role:'owner'},createdAt:ago(18)},'oda');
const inject=async(artifactId,version,days)=>{await artifact(artifactId);await put('learning_snapshot','job-'+artifactId,{id:'job-'+artifactId,campaignId:'c-oda',role:'content',createdAt:ago(days),artifactId,rules:[],operatorPreferences:[{id:R,version,grade:'operator_preference',title:'규칙',guidance:RULE_TEXT}]},'c-oda')};
// v2 주입 작업물 7건: 승인 2(a2는 뒤에 수정 요청), 같은 사유 수정 1, 다른 사유 수정 1, 사람 수정본 1, 판정 없음 1, 직접 작성 첫 판정 1
for(const [id,d] of [['a1',15],['a2',15],['a3',15],['a4',15],['a5',15],['a6',15],['a7',15]])await inject(id,2,d);
await decision('rd-a1','a1','content','approved','ai',[],14);
await decision('rd-a2','a2','content','approved','ai',[],13);
await decision('rd-a2b','a2','content','revision','ai',['voice'],12);
await decision('rd-a3','a3','content','revision','ai',['voice'],12);
await decision('rd-a4','a4','content','revision','ai',['evidence'],11);
await decision('rd-a5','a5','content','approved','ai_edited',[],10);
await decision('rd-a7','a7','content','approved','manual',[],10);
// v1 주입 작업물 2건(표본 부족)과 승인 전 창의 content 1차 판정 5건(개선 루프 전 창)
for(const [id,d] of [['v1a',26],['v1b',25]]){await inject(id,1,d+1);await decision('rd-'+id,id,'content','approved','ai',[],d)}
for(const i of [1,2,3,4,5]){await artifact('b'+i);await decision('rd-b'+i,'b'+i,'content','approved','ai',[],19+i)}

// 3) 스위치: 기본 꺼짐, 이 파일(lib/learning-server.ts)에서만 읽는다
const catalog=plain(flags.FEATURE_FLAGS),names=Object.keys(catalog);
check('b3_playbook_signals defaults to false',catalog.b3_playbook_signals?.defaultEnabled===false&&await flags.isEnabled(O,'b3_playbook_signals')===false&&/교정/.test(catalog.b3_playbook_signals.description));
check('b3_playbook_signals is registered right after b4_reward_lineage',names.indexOf('b3_playbook_signals')===names.indexOf('b4_reward_lineage')+1);
const src=p=>readFileSync(p,'utf8'),tsFiles=dir=>readdirSync(dir,{recursive:true}).map(f=>dir+'/'+f).filter(p=>/\.tsx?$/.test(p));
const readers=[...tsFiles('lib'),...tsFiles('app')].filter(p=>/isEnabled\([^)]*b3_playbook_signals/.test(src(p)));
const featureStatus=await rt.load('lib/feature-status.ts'),featureRow=list=>featureStatus.featureRows({flags:list}).find(r=>r.key==='playbook-signals');
check('the settings table has a playbook signals row that follows the switch',JSON.stringify([featureRow([{flag:'b3_playbook_signals',enabled:true}]).status,featureRow([{flag:'b3_playbook_signals',enabled:false}]).status,featureRow(null).status])==='["available","blocked","blocked"]');
check('the switch is read only in lib/learning-server.ts',JSON.stringify(readers)==='["lib/learning-server.ts"]');

// 4) 스위치 꺼짐: GET 바이트 동일·새 키 없음
const offDefault=await get();
await setSignals(false);
const offExplicit=await get();
check('switch off: GET /api/learning has no new keys',offDefault.status===200&&NEW_KEYS.every(k=>!(k in offDefault.data)));
check('switch off: an explicit false is byte-identical to the default',offExplicit.text===offDefault.text);
await setSignals(true);
const on=await get(),onAdmin=await get(ADMIN),onMember=await get(MEMBER);
const stripped=JSON.stringify(Object.fromEntries(Object.entries(on.data).filter(([k])=>!NEW_KEYS.includes(k))));
check('switch off: GET /api/learning is byte-identical to the switch-on response without the new keys',stripped===offDefault.text&&NEW_KEYS.every(k=>k in on.data));
check('switch on: the new keys are appended after the existing keys',JSON.stringify(Object.keys(on.data).slice(-3))===JSON.stringify(NEW_KEYS));
check('switch on: admin sees the signals, member does not (hidden from staff)',NEW_KEYS.every(k=>k in onAdmin.data)&&NEW_KEYS.every(k=>!(k in onMember.data))&&onMember.status===200);

// 5) 교정 묶음
const clusters=on.data.correctionClusters,cluster=(role,brand='oda')=>clusters.find(c=>c.brandId===brand&&c.role===role);
const ins=cluster('insight');
check('correction clusters count revisions and edited approvals per brand and role',ins?.corrections===5&&cluster('cmo')?.corrections===4&&cluster('data')?.corrections===5&&!clusters.some(c=>c.brandId===null));
check('cluster reason codes are counted per code',JSON.stringify(ins.reasonCodes)==='{"brand":1,"format":1,"voice":3}');
check('the cluster window is the last 90 days in Korean dates',ins.window.to===kstDay(Date.now())&&(Date.parse(ins.window.to)-Date.parse(ins.window.from))/DAY===90&&learning.CLUSTER_WINDOW_DAYS===90&&learning.PLAYBOOK_CLUSTER_MIN===5);
check('a cluster is eligible at five corrections within 90 days and prefills citation ids',ins.eligible===true&&JSON.stringify(ins.decisionIds)==='["rd-i1","rd-i2","rd-i3","rd-i4","rd-i5"]'&&cluster('cmo').eligible===false&&cluster('cmo').decisionIds.length===0);
check('corrections outside 90 days, plain approvals and unresolvable brands are not counted',!ins.decisionIds.includes('rd-i6')&&!ins.decisionIds.includes('rd-i7')&&!ins.decisionIds.includes('rd-ig'));
check('a cluster records the rules that already cite its corrections',JSON.stringify(ins.coveredBy)===JSON.stringify([R])&&cluster('cmo').coveredBy.length===0);
check('prefilled citation ids stay within the citation limit',clusters.every(c=>c.decisionIds.length<=curator.PLAYBOOK_MAX_CITATIONS));
const CLUSTER_KEYS='["brandId","role","window","corrections","eligible","reasonCodes","decisionIds","coveredBy"]';
check('clusters carry ids and reason codes only (no memo, email, body)',clusters.every(c=>JSON.stringify(Object.keys(c))===CLUSTER_KEYS)&&!/검토 메모|@test\.invalid|규칙 본문 원문|본문 원문 비밀|noteLength|actor/.test(JSON.stringify(clusters)));
// 순수 함수 경계: 4건이면 eligible 아님, 5건째에 eligible
const pure=n=>curator.correctionClusters(Array.from({length:n},(_,i)=>({id:'x'+i,brandId:'oda',targetKind:'artifact',targetId:'t'+i,role:'content',decision:'revision',reasonCodes:['voice'],origin:'ai',createdAt:ago(i+1)})),[],Date.now());
check('the pure cluster boundary is exactly five',pure(4)[0].eligible===false&&pure(5)[0].eligible===true&&pure(5)[0].decisionIds.length===5);

// 6) 규칙 버전별 파생 피드백
const fb=on.data.playbookFeedback,v2=fb.find(f=>f.ruleId===R&&f.ruleVersion===2),v1=fb.find(f=>f.ruleId===R&&f.ruleVersion===1);
check('feedback counts first-pass approvals of artifacts injected with that rule version',v2?.injectedArtifacts===7&&v2.decidedFirst===5&&v2.helpful===2&&v2.editedFirst===1);
check('same-reason revisions on injected artifacts count as recurrence',v2.recurrence===1&&v2.otherRevision===1&&v2.helpful+v2.recurrence+v2.otherRevision+v2.editedFirst===v2.decidedFirst);
check('feedback below five first decisions is insufficient',v1?.decidedFirst===2&&v1.status==='insufficient'&&v2.status==='measured');
check('feedback carries the not-automatic notice',fb.every(f=>f.notice==='자동 판정 아님: 규칙 상태·만료를 바꾸지 않습니다.'));
check('feedback carries ids and counts only',!/규칙 본문 원문|검토 메모|@test\.invalid/.test(JSON.stringify(fb)));
const stored0=await rule(R);
check('feedback is derived at read time: no learning_rule write, no status or expiry change',stored0.feedback.helpful===0&&stored0.feedback.harmful===0&&stored0.status==='active'&&stored0.expiresAt===R_EXPIRES&&stored0.version===2);
const rowsBefore=ruleRows(),countBefore=allRows();await get();await get(ADMIN);
check('GET with signals writes no record at all',ruleRows()===rowsBefore&&allRows()===countBefore);

// 7) 같은 사유 재발률(4주, n<20 표본 부족)
const rec=on.data.recurrence,recOf=(role,code)=>rec.find(r=>r.brandId==='oda'&&r.role===role&&r.reasonCode===code);
check('recurrence below 20 decided artifacts is a sample shortfall',recOf('insight','voice')?.n===3&&recOf('insight','voice').rate===null&&recOf('insight','voice').status==='표본 부족'&&recOf('insight','voice').weeks===4);
check('recurrence at 20 decided artifacts is measured',recOf('data','voice')?.n===20&&recOf('data','voice').rate===0.25&&recOf('data','voice').status==='measured');
check('reason codes seen in the 90-day clusters stay listed at zero in the 4-week window',recOf('insight','brand')?.n===3&&recOf('insight','brand').rate===null);
const pureRate=curator.recurrenceRate(Array.from({length:20},(_,i)=>({id:'y'+i,brandId:'oda',targetKind:'artifact',targetId:'u'+i,role:'content',decision:i<4?'revision':'approved',reasonCodes:i<4?['brand']:[],origin:'ai',createdAt:ago(i+1)})),Date.now());
check('the pure recurrence rate is hits over decided artifacts',pureRate.length===1&&pureRate[0].rate===0.2&&pureRate[0].n===20);

// 8) 보상 계보 교차 검사와 보상 계보 GET·close가 규칙을 바꾸지 않음
await flags.setFeatureFlag(O,{flag:'b4_reward_lineage',enabled:true},{id:'sig-owner',email:null});
const rulesBeforeLineage=ruleRows();
const lr=await rewardRoute.GET(new Request('https://app.test/api/reward-lineage?brandId=oda',{headers:session(OWNER)})),lineage=await lr.json();
const byRule=lineage.lineage?.byRule.find(r=>r.ruleRef===R+'@2');
check('feedback helpful equals reward-lineage byRule approvedFirst for the same ruleRef',lr.status===200&&byRule&&byRule.human.approvedFirst===v2.helpful&&byRule.human.decidedFirst===v2.decidedFirst&&byRule.human.editedFirst===v2.editedFirst);
const pureLineage=reward.buildRewardLineage({period:{from:kstDay(Date.now()-40*DAY),to:kstDay(Date.now())},scope:{brandId:'oda'},decision16:'not_run',decisions:plain(rt.sql.prepare("SELECT data FROM records WHERE owner=? AND kind='review_decision'").all(O).map(r=>JSON.parse(r.data))),artifacts:[],
 snapshots:rt.sql.prepare("SELECT data FROM records WHERE owner=? AND kind='learning_snapshot'").all(O).map(r=>JSON.parse(r.data))});
const pureV1=pureLineage.byRule.find(r=>r.ruleRef===R+'@1');
check('the pure reward lineage agrees for every rule version',pureV1.human.approvedFirst===v1.helpful&&pureV1.human.decidedFirst===v1.decidedFirst&&pureLineage.byRule.find(r=>r.ruleRef===R+'@2').human.approvedFirst===v2.helpful);
const loop=lineage.loops.loops.find(l=>l.id==='playbook:au1');
const closed=await rewardRoute.POST(new Request('https://app.test/api/reward-lineage',{method:'POST',headers:{...session(OWNER),'content-type':'application/json'},body:JSON.stringify({action:'close',brandId:'oda',loopId:loop?.id,version:loop?.version,expected:loop&&{before:{decidedFirst:loop.comparison.before.decidedFirst,approvedFirst:loop.comparison.before.approvedFirst},after:{decidedFirst:loop.comparison.after.decidedFirst,approvedFirst:loop.comparison.after.approvedFirst}}})}));
check('reward-lineage GET and close leave learning_rule rows unchanged',loop?.status==='closable'&&closed.status===200&&ruleRows()===rulesBeforeLineage);

// 9) 경보 동결(D3): 열린 모델·게이트웨이 경보가 있으면 승인 409, ack로 해제. 스위치와 무관하다. 중지·연장은 막지 않는다.
const base={brandId:'oda',text:'첫 문장은 고객의 평일 상황으로 시작한다.',citations:['rd-i1','rd-i2']};
const created=await call(OWNER,{action:'playbook_create',data:base}),draftId=created.data.id;
const activate=async id=>call(OWNER,{action:'playbook_activate',id,version:(await rule(id)).version});
const callsBefore=hermesCalls;
await put('model_change','hermes:2:abcd1234',{id:'hermes:2:abcd1234',key:'hermes',provider:'hermes',kind:'role',from:{reported:'hermes-agent',actual:null},to:{reported:'hermes-agent-2',actual:null},providerRunId:'run-x',observedAt:ago(0)});
for(const enabled of [false,true]){
 await setSignals(enabled);
 const r=await activate(draftId);
 check(`an open model or gateway alarm blocks playbook_activate (409, switch ${enabled?'on':'off'})`,r.status===409&&/경보/.test(r.data.error)&&(await rule(draftId)).status==='draft');
}
const active=await rule(R);
let r=await call(OWNER,{action:'playbook_renew',id:R,version:active.version});
check('renew is not blocked by alarms',r.status===200);
r=await call(OWNER,{action:'playbook_pause',id:R,version:(await rule(R)).version});
check('pause is not blocked by alarms',r.status===200&&(await rule(R)).status==='paused');
check('a paused rule cannot be re-approved while the alarm is open',(await activate(R)).status===409);
await registry.promptRegistryAction(O,{action:'acknowledge_alarms',reason:'골든 스모크 재실행 확인'},{id:'sig-owner',email:null});
r=await activate(draftId);
check('an open model or gateway alarm blocks playbook_activate (409); ack releases it',r.status===200&&(await rule(draftId)).status==='active');
await put('gateway_change','gw-1',{id:'gw-1',fromHash:'a'.repeat(64),toHash:'b'.repeat(64),sections:[{section:'model'}]});
check('a gateway alarm also blocks approval',(await activate(R)).status===409);
await registry.promptRegistryAction(O,{action:'acknowledge_alarms',reason:'게이트웨이 변경 확인'},{id:'sig-owner',email:null});
check('the same prompt registry ack releases the gateway alarm',(await activate(R)).status===200);
check('playbook actions still make no model call',hermesCalls===callsBefore&&external.length===0);

// 10) 역할 제출은 바이트 동일(스위치 켜짐, 운영자 선호 0건 브랜드)
await setSignals(true);
await rt.sql.prepare('INSERT INTO settings(owner,secret,model,updated_at) VALUES(?,?,?,?)').run(O,await server.encrypt(JSON.stringify({provider:'hermes',endpoint:'https://hermes.example.com',key:'mock-only'})),'HERMES',ago(0));
const c=await server.readRecord(O,'campaign','c-ofd'),req=await execution.roleRequestFor(O,c,'cmo',await execution.roleSources(O,c,'cmo'),await server.readRecord(O,'brand','ofd'));
const startRes=await (await execution.executeRole(O,{action:'start',campaignId:'c-ofd',role:'cmo'})).json(),stored=await server.readRecord(O,'hermes_submission',startRes.id);
check('role submissions stay byte-identical',!('operatorPreferences' in req)&&stored.body===JSON.stringify({instructions:instruction.buildRoleInstruction(req),input:instruction.buildRoleInput(req),session_id:stored.key,conversation_history:[]}));
const executors=['lib/role-execution.ts','lib/role-instruction.ts','lib/meeting-execution.ts','lib/brief-execution.ts'];
check('executors do not read the signals',executors.every(p=>!/b3_playbook_signals|correctionClusters|playbookFeedback|recurrenceRate/.test(src(p))));

// 11) 화면·문서(정적)
const panel=src('app/learning-panel.tsx');
check('the learning panel shows clusters, feedback and recurrence tables',['correctionClusters','playbookFeedback','recurrence'].every(k=>panel.includes(k))&&panel.includes('aria-label="교정 신호"'));
check('the signals section is for owner and admin only (canChange without owner)',/canSeeSignals=canChange\(useAccount\(\)\)/.test(panel));
check('an eligible cluster opens the playbook draft with prefilled citations',panel.includes('citations:cl.decisionIds'));
const doc=src('docs/PLAYBOOK.ko.md');
check('docs describe B3-2a and drop the stale eval submission limit',doc.includes('B3-2a')&&doc.includes('b3_playbook_signals')&&doc.includes('roleSubmission')&&!doc.includes('평가 실행 입력이 운영 입력과 다르다'));
check('no external network call',external.length===0);
console.log(JSON.stringify({passed}));
