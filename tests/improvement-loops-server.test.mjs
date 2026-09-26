// B4-2c 닫힌 개선 루프 서버·API 회귀(docs/REWARD-LINEAGE.ko.md 11절 RED 목록). 실제 SQLite(node:sqlite)·실제 라우트, 헤더(legacy)·세션(email) 인증, 합성 데이터.
// GET loops(평가 run·승인 있는 activate·promote, stage 제외, playbook activate, open·closable·rolled_back), POST close(대표만, 판 번호 409, 확인 값 409, 동결 수치 불변, 추가만),
// 스위치 꺼짐 409·직원 403·관리자 403, 롤백되면 종료 조건에서 빠짐, kind 등록 위치, 외부 호출 0회·provider_usage 0건.
// 근거: mocked(메모리 SQLite, 로컬 인증 헤더·이메일 세션, fetch 스텁). 모델·외부 네트워크 호출은 0회다.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {testRuntime} from './helpers/runtime.mjs';

let fetchCalls=0;
const rt=testRuntime(async()=>{fetchCalls++;throw new Error('외부 호출 금지')});
const {sql,env}=rt;
const server=await rt.load('lib/server.ts'),route=await rt.load('app/api/reward-lineage/route.ts'),flags=await rt.load('lib/feature-flags.ts'),registry=await rt.load('lib/record-kinds.ts');
const passed=[];const check=(name,val)=>{assert.ok(val,name);passed.push(name)};
const plain=x=>JSON.parse(JSON.stringify(x));

// ── 1) 합성 데이터: 소유자 O(브랜드 b1, 캠페인 c1), 날짜는 모두 지금 기준 상대값(한국 날짜 차이가 그대로 유지된다) ──
const O='b42c-owner',X='b42c-other';
const save=(owner,kind,id,data,parent='')=>server.recordStatement(owner,kind,id,data,parent).run();
const ago=days=>new Date(Date.now()-days*86400000).toISOString();
const PV_A='role.content@aaaaaaaaaaaa',PV_B='role.content@bbbbbbbbbbbb',PV_C='role.content@cccccccccccc',PV_S='role.strategy@dddddddddddd';
await save(O,'brand','b1',{id:'b1',name:'브랜드'});await save(X,'brand','b1',{id:'b1',name:'브랜드'});
await save(O,'campaign','c1',{id:'c1',brandId:'b1',title:'캠페인',goal:'',audience:'',channels:'Instagram',stores:'',products:'',budget:null,startDate:'',endDate:'',constraints:'',sources:'',status:'review',version:1,createdAt:ago(60),updatedAt:ago(60)});
const REASON='승인 사유 원문 비밀';
const event=(id,action,unit,from,to,days,over={})=>save(O,'prompt_release_event',id,{id,unit,action,from,to,sourceSha:null,evalRunId:'run-'+id,approval:{reason:REASON,by:{id:'u1',email:'boss@test.invalid'},at:ago(days)},stagedCampaignIds:[],by:{id:'u1',email:'boss@test.invalid'},manifestBefore:null,manifestAfter:null,at:ago(days),...over});
await event('ev1','activate','role.content',PV_A,PV_B,30); // 전 창 ago(44)~ago(31), 후 창 ago(30)~ago(17) → 경과
await event('ev2','stage','role.content',PV_B,PV_C,8); // stage는 후보가 아니다
await event('ev3','promote','role.content',PV_B,PV_C,3); // 14일 전 → open
await event('ev4','activate','role.strategy',null,PV_S,40);
await event('ev4r','rollback','role.strategy',PV_S,null,20,{evalRunId:null,approval:null}); // ev4 버전 롤백
let seq=0;
const artifact=(id,pv,role='content')=>save(O,'artifact',id,{id,campaignId:'c1',campaignVersion:1,role,title:'작업물',content:'본문',status:'review',version:1,origin:'ai',promptVersion:pv,createdAt:ago(50)},'c1');
const decide=(targetId,pv,decision,days,role='content')=>{const id='d'+String(++seq).padStart(4,'0');return save(O,'review_decision',id,{id,targetKind:'artifact',targetId,version:1,role,decision,reasonCodes:[],noteLength:0,actor:{id:'u1',role:'owner'},promptVersion:pv,skillVersion:null,outputContractVersion:null,campaignId:'c1',brandId:'b1',origin:'ai',reasonsVersion:'review-reasons-v1',createdAt:ago(days)})};
async function batch(prefix,pv,days,approved,role='content'){for(const [i,d] of days.entries()){await artifact(prefix+i,pv,role);await decide(prefix+i,pv,i<approved?'approved':'revision',d,role)}}
await batch('pa',PV_A,[32,33,34,35,36,37],2); // ev1 전: 6건 중 2건 승인
await batch('pb',PV_B,[20,21,22,23,24,25],5); // ev1 후: 6건 중 5건 승인
await batch('ps',PV_S,[35,36,37,38,39],5,'strategy');await batch('pt','strategy-v1:111111111111',[42,43,44,45,46],2,'strategy');
// 운영자 선호 규칙: ago(18)에 승인, 주입된 작업물 5건(ago(10)~ago(14), 4건 승인)
const RULE='playbook:r1';
await save(O,'learning_rule',RULE,{id:RULE,version:2,brandId:'b1',role:'content',channel:'*',origin:'review',grade:'operator_preference',experimentId:'',experimentVersion:0,caseId:'',title:'규칙',guidance:'규칙 본문 원문 비밀',scope:'',status:'active',expiresAt:ago(-40),createdAt:ago(20),updatedAt:ago(18)},'b1');
await save(O,'playbook_audit','au1',{id:'au1',ruleId:RULE,brandId:'b1',action:'activate',fromStatus:'draft',toStatus:'active',ruleVersion:2,expiresAt:ago(-40),actor:{id:'u1',role:'owner'},createdAt:ago(18)},'b1');
for(const [i,d] of [10,11,12,13,14].entries()){const id='pq'+i;await artifact(id,PV_B);await decide(id,PV_B,i<4?'approved':'revision',d);await save(O,'learning_snapshot','job-'+id,{id:'job-'+id,campaignId:'c1',role:'content',createdAt:ago(d),artifactId:id,rules:[],operatorPreferences:[{id:RULE,version:2,grade:'operator_preference',title:'규칙',guidance:'규칙 본문 원문 비밀'}]},'c1')}

// HTTP 도우미(legacy 헤더 = 소유자)
const as=who=>({'oai-authenticated-user-id':who});
const call=async res=>{const text=await res.text();let body=null;try{body=JSON.parse(text)}catch{body=text}return {status:res.status,body,text}};
const G=(query='?brandId=b1',headers=as(O))=>route.GET(new Request('https://agency.test/api/reward-lineage'+query,{headers})).then(call);
const P=(payload,headers=as(O))=>route.POST(new Request('https://agency.test/api/reward-lineage',{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(payload)})).then(call);
const loopOf=(body,id)=>body.loops.loops.find(l=>l.id===id);
const expectedOf=l=>({before:{decidedFirst:l.comparison.before.decidedFirst,approvedFirst:l.comparison.before.approvedFirst},after:{decidedFirst:l.comparison.after.decidedFirst,approvedFirst:l.comparison.after.approvedFirst}});
const closeBody=(l,over={})=>({action:'close',brandId:'b1',loopId:l.id,version:l.version,expected:expectedOf(l),...over});
const loopRows=()=>sql.prepare("SELECT id,parent_id p,data FROM records WHERE owner=? AND kind='improvement_loop' ORDER BY id").all(O);

// ── 2) kind 등록: customer_report 뒤·brand_voice 앞, parent 없음, 캠페인과 무관, links·purge 없음 ──
const kinds=plain(registry.recordKinds),kind=kinds.find(k=>k.kind==='improvement_loop'),at=kinds.indexOf(kind);
check('improvement_loop is registered right after customer_report and right before brand_voice',!!kind&&kinds[at-1].kind==='customer_report'&&kinds[at+1].kind==='brand_voice');
check('improvement_loop has no parent, is outside campaign deletion and is append-only in its description',kind.parent==='none'&&kind.campaignDeletion==='not_campaign_scoped'&&!kind.links&&kind.purge===undefined&&!kind.blocksDeletion&&/추가만/.test(kind.description)&&/원문/.test(kind.description));

// ── 3) 스위치 꺼짐: GET 409, POST close 409(대표), 쓰기 없음 ──
check('switch off: the GET is a 409',(await G()).status===409);
let r=await P({action:'close',brandId:'b1',loopId:'prompt:ev1',version:0,expected:{}});
check('switch off: POST close is a 409 naming the switch',r.status===409&&/b4_reward_lineage/.test(r.body.error)&&loopRows().length===0);
await flags.setFeatureFlag(O,{flag:'b4_reward_lineage',enabled:true},{id:O,email:null});

// ── 4) GET loops: 후보·상태·전후 비교 ──
const before=sql.prepare('SELECT COUNT(*) n, MAX(updated_at) m FROM records').get();
r=await G();
check('GET answers 200 with the loops ledger',r.status===200&&r.body.loops.schema==='collective.improvement-loops.v1'&&JSON.stringify(r.body.loops.partial)==='{"kinds":[]}');
check('the GET with loops writes nothing',(a=>a.n===before.n&&a.m===before.m)(sql.prepare('SELECT COUNT(*) n, MAX(updated_at) m FROM records').get()));
const ids=r.body.loops.loops.map(l=>l.id);
check('activate and promote with an eval run and approval are loops, stage and rollback are not',['prompt:ev1','prompt:ev3','prompt:ev4','playbook:au1'].every(id=>ids.includes(id))&&!ids.includes('prompt:ev2')&&!ids.includes('prompt:ev4r'));
const ev1=loopOf(r.body,'prompt:ev1');
check('the activate loop compares first decisions 14 days before and after',ev1.status==='closable'&&ev1.version===0&&ev1.comparison.before.decidedFirst===6&&ev1.comparison.before.approvedFirst===2&&ev1.comparison.after.decidedFirst===6&&ev1.comparison.after.approvedFirst===5&&typeof ev1.comparison.probTreatmentBetter==='number'&&/^sha256:[0-9a-f]{64}$/.test(ev1.inputDigest));
check('a loop within 14 days is open',loopOf(r.body,'prompt:ev3').status==='open');
check('a rolled back version is not closable',loopOf(r.body,'prompt:ev4').status==='rolled_back');
const pb=loopOf(r.body,'playbook:au1');
check('the playbook loop counts only artifacts the rule was injected into after activation',pb.status==='closable'&&pb.source.role==='content'&&pb.comparison.after.decidedFirst===5&&pb.comparison.after.approvedFirst===4);
check('the loops carry no approval reason, email or rule text',!/승인 사유 원문 비밀|boss@test\.invalid|규칙 본문 원문 비밀/.test(r.text));
check('the exit condition starts at zero of five',JSON.stringify(r.body.loops.exit)==='{"target":5,"closed":0,"counted":0}');

// ── 5) close: 판 번호·상태·확인 값 ──
check('an unknown action is a 400',(await P({action:'open',brandId:'b1'})).status===400);
check('an unknown loop is a 404',(await P(closeBody({...ev1,id:'prompt:nope'}))).status===404);
check('a wrong version is a 409',(await P(closeBody(ev1,{version:1}))).status===409);
check('an open loop cannot be closed',(await P(closeBody(loopOf(r.body,'prompt:ev3')))).status===409);
check('a rolled back loop cannot be closed',(await P(closeBody(loopOf(r.body,'prompt:ev4')))).status===409);
check('missing expected counts is a 400',(await P(closeBody(ev1,{expected:undefined}))).status===400);
check('expected counts that differ from now are a 409',(await P(closeBody(ev1,{expected:{...expectedOf(ev1),after:{decidedFirst:6,approvedFirst:4}}}))).status===409);
check('rejected closes wrote no loop row',loopRows().length===0);
r=await P(closeBody(ev1));
check('the owner closes a closable loop',r.status===200&&r.body.id==='prompt:ev1'&&r.body.version===1&&r.body.inputDigest===ev1.inputDigest);
const [row]=loopRows(),stored=JSON.parse(row.data);
check('the loop row has no parent and freezes the numbers with the inputDigest',row.p===''&&JSON.stringify(stored.comparison)===JSON.stringify(ev1.comparison)&&stored.inputDigest===ev1.inputDigest&&JSON.stringify(stored.closedBy)===JSON.stringify({id:O,role:'owner'})&&JSON.stringify(stored.scope)==='{"brandId":"b1","storeId":null,"campaignId":null}');
check('the loop row carries no approval reason, email or rule text',!/승인 사유 원문 비밀|@test\.invalid|규칙 본문 원문 비밀/.test(row.data));
check('closing again with the old version is a 409 and appends nothing',(await P(closeBody(ev1))).status===409&&loopRows().length===1);
check('closing again with the new version is a 409 (already closed)',(await P(closeBody(ev1,{version:1}))).status===409&&loopRows().length===1);

// ── 6) 동결 수치는 이후 데이터가 바뀌어도 그대로 ──
await batch('pz',PV_B,[19,26],0); // ev1 후 창에 판정 2건 추가
r=await G();
const frozen=loopOf(r.body,'prompt:ev1');
check('after new data the closed loop still shows the frozen numbers and digest',frozen.status==='closed'&&frozen.version===1&&JSON.stringify(frozen.comparison)===JSON.stringify(ev1.comparison)&&frozen.inputDigest===ev1.inputDigest&&frozen.closed.by.role==='owner');
check('the stored row did not change',loopRows()[0].data===row.data);
check('the exit condition counts the closed loop',JSON.stringify(r.body.loops.exit)==='{"target":5,"closed":1,"counted":1}');
check('the unclosed playbook loop still reflects live data',loopOf(r.body,'playbook:au1').status==='closable');

// ── 7) 롤백된 버전은 닫힌 루프로 세지 않는다 ──
await event('ev1r','rollback','role.content',PV_B,PV_A,1,{evalRunId:null,approval:null});
r=await G();
check('rolling back a closed loop version keeps the row but removes it from the exit count',loopOf(r.body,'prompt:ev1').status==='closed'&&loopOf(r.body,'prompt:ev1').countsToExit===false&&JSON.stringify(r.body.loops.exit)==='{"target":5,"closed":1,"counted":0}'&&loopRows().length===1);

// ── 8) 다른 소유자: 닫은 루프·후보가 보이지 않는다 ──
await flags.setFeatureFlag(X,{flag:'b4_reward_lineage',enabled:true},{id:X,email:null});
r=await G('?brandId=b1',as(X));
check('another owner sees no loops of this owner',r.status===200&&r.body.loops.loops.length===0);
check('another owner cannot close this owner loop',(await P(closeBody(pb),as(X))).status===404);

// ── 9) 이메일 인증: 대표만 닫는다(관리자·직원 403, 비로그인 401, 다른 출처 403) ──
Object.assign(env,{AUTH_MODE:'email',AUTH_ORIGIN:'https://agency.test'});
const sha=v=>createHash('sha256').update(v).digest('hex');
const signIn=(id,role,createdAt)=>{const token=sha(id);sql.prepare('INSERT INTO auth_users(id,email,workspace_owner,role,status,created_at) VALUES(?,?,?,?,?,?)').run(id,id+'@test.invalid',O,role,'active',createdAt);sql.prepare('INSERT INTO auth_sessions VALUES(?,?,?,?)').run(sha(token),id,Date.now()+60000,Date.now());return {cookie:'__Host-collective_session='+token,origin:'https://agency.test'}};
const ownerS=signIn('b42c-first','admin',1000),adminS=signIn('b42c-admin','admin',2000),memberS=signIn('b42c-member','member',500);
r=await G('?brandId=b1',adminS);
check('admin sees the loops',r.status===200&&!!loopOf(r.body,'playbook:au1'));
const pbNow=loopOf(r.body,'playbook:au1');
check('member cannot close (403)',(await P(closeBody(pbNow),memberS)).status===403);
check('admin cannot close (403)',(await P(closeBody(pbNow),adminS)).status===403);
check('unauthenticated close is a 401',(await P(closeBody(pbNow),{})).status===401);
check('a cross-origin close is a 403',(await P(closeBody(pbNow),{...ownerS,origin:'https://evil.test'})).status===403);
check('member GET is still a 403',(await G('?brandId=b1',memberS)).status===403);
check('no loop row was written by the rejected roles',loopRows().length===1);
await flags.setFeatureFlag(O,{flag:'b4_reward_lineage',enabled:false},{id:O,email:null});
check('switch off again: owner close is a 409 and member a 403',(await P(closeBody(pbNow),ownerS)).status===409&&(await P(closeBody(pbNow),memberS)).status===403);
await flags.setFeatureFlag(O,{flag:'b4_reward_lineage',enabled:true},{id:O,email:null});
r=await P(closeBody(pbNow),ownerS);
check('the owner session closes the playbook loop with its own id',r.status===200&&JSON.parse(loopRows().find(x=>x.id.endsWith('playbook:au1')).data).closedBy.id==='b42c-first');

// ── 10) 토큰 0 ──
check('no external call was made (no HERMES, no model, no connector)',fetchCalls===0);
check('no provider usage row was written',sql.prepare("SELECT COUNT(*) n FROM records WHERE kind='provider_usage'").get().n===0);
console.log(JSON.stringify({passed:passed.length},null,1));
