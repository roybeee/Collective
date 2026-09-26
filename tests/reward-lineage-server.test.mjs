// B4-2b 보상 계보 서버·API 회귀(docs/REWARD-LINEAGE.ko.md 9절 RED 목록). 실제 SQLite(node:sqlite)·실제 라우트, 헤더(legacy)·세션(email) 인증, 합성 데이터.
// 스위치 b4_reward_lineage(꺼짐 409·켜짐 200, 이 서버 파일에서만 읽음), 권한(직원 403·관리자·소유자 200), 외부 호출 0회, 종류별 5,000행 상한(partial.kinds),
// 캠페인 삭제 뒤 판정은 promptVersion으로 남고 규칙 계보는 없음, 새 kind 0, 범위(브랜드·지점·캠페인) 분리, 다른 소유자 분리, 같은 DB 상태면 같은 inputDigest.
// 근거: mocked(메모리 SQLite, 로컬 인증 헤더·이메일 세션, fetch 스텁). 모델·외부 네트워크 호출은 0회다.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,readdirSync} from 'node:fs';
import {testRuntime} from './helpers/runtime.mjs';

let fetchCalls=0;
const rt=testRuntime(async()=>{fetchCalls++;throw new Error('외부 호출 금지')});
const {sql,env}=rt;
const server=await rt.load('lib/server.ts'),sa=await rt.load('lib/store-attribution.ts'),re=await rt.load('lib/role-execution.ts');
const route=await rt.load('app/api/reward-lineage/route.ts'),rls=await rt.load('lib/reward-lineage-server.ts');
const flags=await rt.load('lib/feature-flags.ts'),registry=await rt.load('lib/record-kinds.ts'),status=await rt.load('lib/feature-status.ts');
const passed=[];const check=(name,val)=>{assert.ok(val,name);passed.push(name)};
const plain=x=>JSON.parse(JSON.stringify(x));
const src=p=>readFileSync(p,'utf8');

// ── 1) 합성 데이터: 소유자 O(브랜드 b1 지점 s1·s2, 브랜드 b2 지점 sb), 다른 소유자 X(브랜드 b1) ──
const O='b42-owner',X='b42-other';
const save=(owner,kind,id,data,parent='')=>server.recordStatement(owner,kind,id,data,parent).run();
const ago=days=>new Date(Date.now()-days*86400000).toISOString();
const PV={c1:'role.content@aaaaaaaaaaaa',c2:'role.content@cccccccccccc',c3:'role.content@dddddddddddd',del:'role.content@eeeeeeeeeeee',meet:'role.content@aaaaaaaaaaaa+meeting.synthesis@bbbbbbbbbbbb',x:'role.content@ffffffffffff'};
const CAPTION='캡션 원문 비밀',NOTE='메모 원문 비밀 010-2345-6789';
for(const [owner,id] of [[O,'b1'],[O,'b2'],[X,'b1']])await save(owner,'brand',id,{id,name:'브랜드 '+id});
const store=(id,brandId)=>({id,brandId,name:'지점 '+id,address:'서울',status:'active',version:1});
await save(O,'store','s1',store('s1','b1'),'b1');await save(O,'store','s2',store('s2','b1'),'b1');await save(O,'store','sb',store('sb','b2'),'b2');await save(X,'store','s1',store('s1','b1'),'b1');
const campaign=(id,brandId,storeId)=>({id,brandId,...(storeId?{storeId}:{}),title:'캠페인 '+id,goal:'',audience:'',channels:'Instagram',stores:'',products:'',budget:null,startDate:'',endDate:'',constraints:'',sources:'',status:'review',version:1,createdAt:ago(40),updatedAt:ago(40)});
await save(O,'campaign','c1',campaign('c1','b1','s1'));await save(O,'campaign','c2',campaign('c2','b1','s2'));await save(O,'campaign','c3',campaign('c3','b2','sb'));await save(O,'campaign','cdel',campaign('cdel','b1','s1'));
await save(X,'campaign','c1',campaign('c1','b1','s1'));
// 역할 실행: 작업물 id는 roleArtifactId(작업 id). 스냅샷에는 artifactId가 없다(서버가 계산해 잇는다).
const artOf=async job=>re.roleArtifactId(job);
const A1=await artOf('job-c1'),A2=await artOf('job-c2'),A3=await artOf('job-c3'),AD=await artOf('job-del'),AX=await artOf('job-x');
const artifact=(id,campaignId,promptVersion,over={})=>({id,campaignId,campaignVersion:1,role:'content',title:'작업물',content:'본문 '+NOTE,status:'review',version:1,origin:'ai',promptVersion,skillVersion:'content-v1',createdAt:ago(5),...over});
const rule=(id,version,grade)=>({id,version,...(grade?{grade}:{}),brandId:'b1',channel:'Instagram',experimentId:'',experimentVersion:0,caseId:'',title:'규칙',guidance:'규칙 본문 원문 비밀',scope:'',status:'active',expiresAt:ago(-60),createdAt:ago(30),updatedAt:ago(30)});
const snapshot=(job,campaignId,rules)=>({id:job,campaignId,role:'content',createdAt:ago(5),rules,skillVersion:'content-v1',promptVersion:'x',promptSource:'registry'});
let seq=0;
const decision=(owner,targetId,campaignId,brandId,promptVersion,decisionValue,createdAt,over={})=>{const id='d'+String(++seq).padStart(5,'0');return save(owner,'review_decision',id,{id,targetKind:'artifact',targetId,version:1,role:'content',decision:decisionValue,reasonCodes:[],noteLength:4,actor:{id:'u1',role:'owner'},promptVersion,skillVersion:'content-v1',outputContractVersion:'c1',campaignId,brandId,origin:'ai',reasonsVersion:'review-reasons-v1',createdAt,...over})};
// c1(b1·s1): 역할 작업물 A1(규칙 r1@2) + 회의 작업물 AM(회의 m1 snapshot.learning: r2@1 운영자 선호)
await save(O,'artifact',A1,artifact(A1,'c1',PV.c1),'c1');await save(O,'learning_snapshot','job-c1',snapshot('job-c1','c1',[rule('r1',2,'performance_tested')]),'c1');
await save(O,'artifact','am1',artifact('am1','c1',PV.meet,{meetingId:'m1'}),'c1');
await save(O,'team_meeting','m1',{id:'m1',campaignId:'c1',campaignVersion:1,agenda:'안건',status:'completed',steps:[],createdAt:ago(5),updatedAt:ago(5),model:'m',stopRequested:false,artifactIds:['am1'],invalidatedRoles:[],snapshot:{campaign:{},brand:{},artifacts:[],metrics:[],learning:[rule('r2',1,'operator_preference')]}},'c1');
await decision(O,A1,'c1','b1',PV.c1,'approved',ago(3));await decision(O,'am1','c1','b1',PV.meet,'revision',ago(3));
// c2(b1·s2), c3(b2·sb), cdel(b1·s1, 뒤에서 삭제)
await save(O,'artifact',A2,artifact(A2,'c2',PV.c2),'c2');await save(O,'learning_snapshot','job-c2',snapshot('job-c2','c2',[rule('r3',1)]),'c2');await decision(O,A2,'c2','b1',PV.c2,'approved',ago(3));
await save(O,'artifact',A3,artifact(A3,'c3',PV.c3),'c3');await save(O,'learning_snapshot','job-c3',snapshot('job-c3','c3',[rule('r4',1)]),'c3');await decision(O,A3,'c3','b2',PV.c3,'approved',ago(3));
await save(O,'artifact',AD,artifact(AD,'cdel',PV.del),'cdel');await save(O,'learning_snapshot','job-del',snapshot('job-del','cdel',[rule('rdel',1)]),'cdel');await decision(O,AD,'cdel','b1',PV.del,'approved',ago(3));
// 기간 밖(60일 전) 판정: 기본 28일에서는 세지 않는다.
await decision(O,'old-art','c1','b1',PV.c1,'approved',ago(60));
// 첫 판정이 기간 전(40일 전)인 작업물의 기간 안 판정은 1차 판정이 아니다(수정 요청 수에만 든다). 서버는 그 작업물의 기간 전 판정도 함께 읽어야 한다.
await decision(O,'aold','c1','b1',PV.c1,'approved',ago(40));await decision(O,'aold','c1','b1',PV.c1,'revision',ago(2));
// 다른 소유자 X의 같은 브랜드 id·캠페인 id 기록
await save(X,'artifact',AX,artifact(AX,'c1',PV.x),'c1');await save(X,'learning_snapshot','job-x',snapshot('job-x','c1',[rule('rx',1)]),'c1');await decision(X,AX,'c1','b1',PV.x,'approved',ago(3));
// 발행·주문·실험: c1 게시(copy → A1)와 그 게시 코드 주문(s1), c2 게시(copy → A2)와 주문(s2)
const at=ago(2);
const pub=(id,campaignId,artifactId)=>({id,campaignId,creativeId:'cr1',creativeVersion:1,campaignVersion:1,pngHash:'h',factRefs:[],caption:CAPTION,mediaUrl:'',copy:{artifactId,artifactVersion:1,index:0,text:CAPTION},scheduledAt:ago(4),plannedCostKRW:0,version:2,status:'published',approvedAt:ago(5),createdAt:ago(5)});
await save(O,'execution_publication','p1',pub('p1','c1',A1),'c1');await save(O,'execution_publication','p2',pub('p2','c2',A2),'c2');
const zero={foodCost:1000,packagingCost:0,fees:0,deliveryCost:0,benefitCost:0};
const coded=(code,publicationId,campaignId)=>({codeAttribution:{codeId:'k-'+code,code,publicationId,conflictCodeIds:[]},channel:'social',campaignId,creativeId:'cr1',attributionEvidence:sa.autoEvidence({code,type:'coupon'})});
const order=(id,storeId,over)=>save(O,'store_order',id,{id,storeId,source:'pos',orderNumber:'N-'+id,orderDate:at.slice(0,10),mode:'hall',status:'paid',paidAmount:10000,refundAmount:0,costs:zero,channel:'unknown',experimentId:'',attributionEvidence:'',note:NOTE,version:1,createdAt:at,updatedAt:at,...over},storeId);
await order('o1','s1',coded('AB23','p1','c1'));await order('o2','s2',coded('CD45','p2','c2'));
// s2 수동 귀속 주문(사람 근거): 어느 버전에도 배분하지 않고 unallocated에 든다. 지점 s1 범위에는 들어오면 안 된다.
await order('o3','s2',{channel:'naver_place',campaignId:'c2',attributionEvidence:'플레이스 문의 확인'});
const experiment=(id,campaignId,artifactId)=>({id,brandId:'b1',campaignId,caseId:'',analysisId:'',source:{kind:'artifact',artifactId,artifactVersion:1,index:0},title:'실험',channel:'Instagram',hypothesis:NOTE,variable:'v',control:'c',treatment:'t',metric:'share_rate',minSample:100,minHours:24,minLift:10,conditions:'',version:1,status:'evaluated',startedAt:null,createdAt:ago(3),updatedAt:ago(3),result:null,assessment:null});
await save(O,'viral_experiment','e1',experiment('e1','c1',A1),'c1');await save(O,'learning_rule','rv1',{...rule('rv1',1),experimentId:'e1',experimentVersion:1,origin:'viral'},'b1');

// HTTP 도우미(legacy 헤더 = 소유자)
const as=who=>({'oai-authenticated-user-id':who});
const call=async res=>{const text=await res.text();let body=null;try{body=JSON.parse(text)}catch{body=text}return {status:res.status,body,text}};
const G=(query,headers=as(O))=>route.GET(new Request('https://agency.test/api/reward-lineage'+query,{headers})).then(call);
const row=(body,pv)=>body.lineage.byPromptVersion.find(r=>r.promptVersion===pv);
const refs=body=>body.lineage.byRule.map(r=>r.ruleRef);

// ── 2) 등록: 새 kind 0, 스위치 기본 꺼짐, 기능표 행, 스위치는 서버 파일에서만 읽음 ──
const kinds=plain(registry.recordKinds).map(k=>k.kind);
check('record-kinds is unchanged: no reward lineage kind',!kinds.some(k=>/reward/.test(k))&&kinds.length===plain(registry.recordKinds).length&&!/reward/.test(src('lib/record-kinds.ts')));
const names=Object.keys(flags.FEATURE_FLAGS);
check('b4_reward_lineage is a known switch, off by default, after a8_customer_report',flags.FEATURE_FLAGS.b4_reward_lineage?.defaultEnabled===false&&names.indexOf('b4_reward_lineage')===names.indexOf('a8_customer_report')+1&&/보상 계보/.test(flags.FEATURE_FLAGS.b4_reward_lineage.description));
check('b4_reward_lineage reads off without a stored row',await flags.isEnabled(O,'b4_reward_lineage')===false);
const featureRow=f=>plain(status.featureRows({flags:f})).find(r=>r.key==='reward-lineage');
check('the settings table has a reward lineage row that follows the switch',JSON.stringify([featureRow([{flag:'b4_reward_lineage',enabled:true}]).status,featureRow([{flag:'b4_reward_lineage',enabled:false}]).status,featureRow(null).status])==='["available","blocked","blocked"]');
check('the reward lineage row comes right after the customer report row',(k=>k.indexOf('reward-lineage')===k.indexOf('customer-report')+1)(plain(status.featureRows({})).map(r=>r.key)));
const switchReaders=[...readdirSync('lib').map(f=>'lib/'+f),'app/api/reward-lineage/route.ts'].filter(p=>p.endsWith('.ts')&&/isEnabled\([^)]*b4_reward_lineage/.test(src(p)));
check('the switch is read only in lib/reward-lineage-server.ts',JSON.stringify(switchReaders)==='["lib/reward-lineage-server.ts"]'&&!/feature-flags/.test(src('app/api/reward-lineage/route.ts')));

// ── 3) 스위치 꺼짐 409 → 켜면 200 ──
let r=await G('?brandId=b1');
check('switch off: the lineage is a 409 naming the switch',r.status===409&&/b4_reward_lineage/.test(r.body.error));
await flags.setFeatureFlag(O,{flag:'b4_reward_lineage',enabled:true},{id:O,email:null});
const before=sql.prepare('SELECT COUNT(*) n, MAX(updated_at) m FROM records').get();
r=await G('?brandId=b1');
check('switch on: the lineage is a 200 with the v1 schema',r.status===200&&r.body.enabled===true&&r.body.lineage.schema==='collective.reward-lineage.v1'&&r.body.lineage.scope.brandId==='b1');
check('the lineage GET writes nothing',(a=>a.n===before.n&&a.m===before.m)(sql.prepare('SELECT COUNT(*) n, MAX(updated_at) m FROM records').get()));
check('decision 16 is not_run: publish is not a real publish and engagement is reduced',r.body.decision16==='not_run'&&r.body.lineage.layers.publish.realPublish===false&&r.body.lineage.layers.engagement.status==='reduced');
check('the default period is the last 28 days (KST) and the partial list is empty',(p=>p.from===sa.addDays(p.to,-27)&&p.timeZone==='Asia/Seoul')(r.body.lineage.period)&&JSON.stringify(r.body.partial)==='{"kinds":[]}');
const brandBody=r.body,brandText=r.text;

// ── 4) 계보: 역할 실행은 roleArtifactId로, 회의 작업물은 snapshot.learning으로 규칙을 잇는다 ──
check('the role run rule reaches the artifact through roleArtifactId',(x=>x&&x.human.decidedFirst===1&&x.human.approvedFirst===1&&x.publish.publications===1&&x.order.attributedOrders===1&&x.engagement.experiments===1&&x.engagement.adoptedRules===1)(brandBody.lineage.byRule.find(x=>x.ruleRef==='r1@2')));
check('the meeting artifact rule comes from meeting.snapshot.learning with its grade',(x=>x&&x.grade==='operator_preference'&&x.human.decidedFirst===1&&x.human.approvedFirst===0&&x.human.revisions===1)(brandBody.lineage.byRule.find(x=>x.ruleRef==='r2@1')));
check('the meeting composite version stays a key and feeds its units',!!row(brandBody,PV.meet)&&brandBody.lineage.byUnitVersion.some(u=>u.unitVersion==='meeting.synthesis@bbbbbbbbbbbb'));
check('every snapshot of an artifact with events is mapped (no unmapped snapshots)',brandBody.lineage.unallocated.rules.snapshots===0);
check('decisions before the period are not counted, and a first decision before the period keeps later ones from being first',!brandBody.lineage.byPromptVersion.some(x=>x.human.decidedFirst>1)&&row(brandBody,PV.c1).human.decidedFirst===1&&row(brandBody,PV.c1).human.revisions===1);

// ── 5) 범위: 브랜드·지점·캠페인은 다른 범위 기록을 섞지 않는다 ──
check('brand scope has only brand b1 records',!!row(brandBody,PV.c1)&&!!row(brandBody,PV.c2)&&!row(brandBody,PV.c3)&&!refs(brandBody).includes('r4@1'));
r=await G('?brandId=b1&storeId=s1');
check('store scope s1 has c1 records only (not s2 campaign, not s2 orders)',r.status===200&&!!row(r.body,PV.c1)&&!row(r.body,PV.c2)&&!refs(r.body).includes('r3@1')&&row(r.body,PV.c1).order.attributedOrders===1&&r.body.lineage.unallocated.order.attributedOrders===0&&r.body.lineage.scope.storeId==='s1');
r=await G('?storeId=s2');
check('store scope without brandId takes the store brand and has c2 only',r.status===200&&r.body.lineage.scope.brandId==='b1'&&!!row(r.body,PV.c2)&&!row(r.body,PV.c1)&&!refs(r.body).includes('r1@2')&&row(r.body,PV.c2).publish.publications===1&&r.body.lineage.unallocated.order.reasons.manual_or_campaign_only===1);
r=await G('?campaignId=c2');
check('campaign scope c2 has c2 records only',r.status===200&&r.body.lineage.scope.campaignId==='c2'&&!!row(r.body,PV.c2)&&!row(r.body,PV.c1)&&!row(r.body,PV.meet));
r=await G('?brandId=b2');
check('brand b2 has c3 only',r.status===200&&!!row(r.body,PV.c3)&&!row(r.body,PV.c1)&&refs(r.body).join()==='r4@1');
check('a store of another brand is a 404',(await G('?brandId=b2&storeId=s1')).status===404);
check('a campaign of another brand is a 404',(await G('?brandId=b2&campaignId=c1')).status===404);
check('a campaign of another store is a 404',(await G('?storeId=s2&campaignId=c1')).status===404);
for(const q of ['','?from=2026-02-30','?brandId=b1&from=2026-09-10&to=2026-09-01','?brandId=b1&to=2026-13-01',`?brandId=b1&from=${sa.addDays(sa.addDays(brandBody.lineage.period.to,-180),0)}&to=${brandBody.lineage.period.to}`])check('bad query is a 400: '+q,(await G(q)).status===400);
check('180 days (inclusive) is allowed',(await G(`?brandId=b1&from=${sa.addDays(brandBody.lineage.period.to,-179)}&to=${brandBody.lineage.period.to}`)).status===200);

// ── 6) 다른 소유자: 보이지 않는다 ──
check('the owner does not see another owner records',!row(brandBody,PV.x)&&!refs(brandBody).includes('rx@1'));
check('another owner brand, store or campaign id that is not ours is a 404',(await G('?brandId=nope')).status===404&&(await G('?storeId=nope')).status===404&&(await G('?campaignId=nope')).status===404);
await flags.setFeatureFlag(X,{flag:'b4_reward_lineage',enabled:true},{id:X,email:null});
r=await G('?brandId=b1',as(X));
check('another owner sees only its own records under the same ids',r.status===200&&!!row(r.body,PV.x)&&!row(r.body,PV.c1)&&!row(r.body,PV.c2)&&refs(r.body).join()==='rx@1');

// ── 7) 결정론: 같은 DB 상태면 같은 inputDigest(바이트 동일), 기록이 바뀌면 digest가 바뀐다 ──
const again=await G('?brandId=b1');
check('same database state gives the same inputDigest and bytes',/^sha256:[0-9a-f]{64}$/.test(again.body.lineage.inputDigest)&&again.body.lineage.inputDigest===brandBody.lineage.inputDigest&&again.text===brandText);
check('the response carries no order memo, caption, rule body or order number',!/메모 원문 비밀|캡션 원문 비밀|규칙 본문 원문 비밀|N-o1|010-2345-6789/.test(again.text));

// ── 8) 캠페인 삭제 뒤: 판정은 promptVersion으로 남고 규칙 계보는 없다(ruleRef unknown) ──
check('before deletion the deleted-to-be campaign rule is linked',refs(brandBody).includes('rdel@1')&&row(brandBody,PV.del).human.decidedFirst===1);
await server.deleteCampaign(O,{id:'cdel',version:1,confirmed:true});
check('deleting the campaign removed its artifact and snapshot but kept the decision',sql.prepare("SELECT COUNT(*) n FROM records WHERE owner=? AND parent_id='cdel' AND kind IN ('artifact','learning_snapshot')").get(O).n===0&&sql.prepare("SELECT COUNT(*) n FROM records WHERE owner=? AND kind='review_decision' AND json_extract(data,'$.campaignId')='cdel'").get(O).n===1);
r=await G('?brandId=b1');
check('after deletion the decision still counts under its promptVersion',r.status===200&&(x=>x&&x.human.decidedFirst===1&&x.human.approvedFirst===1)(row(r.body,PV.del)));
check('after deletion the rule is unknown: no ruleRef row and no rule mapping',!refs(r.body).includes('rdel@1')&&r.body.lineage.unallocated.rules.snapshots===0&&r.body.lineage.byRule.every(x=>x.human.decidedFirst<=2));
check('the database change changed the inputDigest',r.body.lineage.inputDigest!==brandBody.lineage.inputDigest);

// ── 9) 종류별 5,000행 상한: 넘으면 partial.kinds에 표시 ──
const insert=sql.prepare('INSERT INTO records(id,owner,kind,parent_id,data,updated_at) VALUES(?,?,?,?,?,?)'),bulkAt=ago(1);
sql.exec('BEGIN');
for(let i=0;i<rls.REWARD_ROW_LIMIT+1;i++){const id='bulk'+i;insert.run(`${O}:review_decision:${id}`,O,'review_decision','',JSON.stringify({id,targetKind:'artifact',targetId:'bulk-art-'+i,version:1,role:'content',decision:'approved',reasonCodes:[],actor:{id:'u1',role:'owner'},promptVersion:PV.c1,skillVersion:null,outputContractVersion:null,campaignId:'c1',brandId:'b1',origin:'ai',reasonsVersion:'review-reasons-v1',createdAt:bulkAt}),bulkAt)}
sql.exec('COMMIT');
r=await G('?brandId=b1');
check('over 5,000 decision rows marks review_decision partial and still answers',r.status===200&&rls.REWARD_ROW_LIMIT===5000&&JSON.stringify(r.body.partial.kinds)==='["review_decision"]');
check('the other scope is not partial',JSON.stringify((await G('?brandId=b2')).body.partial.kinds)==='[]');

// ── 10) 이메일 인증: 직원 403, 관리자·소유자 200, 비로그인 401 ──
Object.assign(env,{AUTH_MODE:'email',AUTH_ORIGIN:'https://agency.test'});
const sha=v=>createHash('sha256').update(v).digest('hex');
const signIn=(id,role,createdAt,ws)=>{const token=sha(id);sql.prepare('INSERT INTO auth_users(id,email,workspace_owner,role,status,created_at) VALUES(?,?,?,?,?,?)').run(id,id+'@test.invalid',ws,role,'active',createdAt);sql.prepare('INSERT INTO auth_sessions VALUES(?,?,?,?)').run(sha(token),id,Date.now()+60000,Date.now());return {cookie:'__Host-collective_session='+token}};
const ownerS=signIn('b42-first','admin',1000,O),adminS=signIn('b42-admin','admin',2000,O),memberS=signIn('b42-member','member',500,O);
check('member is a 403',(await G('?brandId=b2',memberS)).status===403);
check('admin is a 200',(await G('?brandId=b2',adminS)).status===200);
check('owner is a 200',(await G('?brandId=b2',ownerS)).status===200);
check('unauthenticated is a 401',(await G('?brandId=b2',{})).status===401);
await flags.setFeatureFlag(O,{flag:'b4_reward_lineage',enabled:false},{id:O,email:null});
check('switch off again: admin and owner get a 409, member still a 403',(await G('?brandId=b2',adminS)).status===409&&(await G('?brandId=b2',ownerS)).status===409&&(await G('?brandId=b2',memberS)).status===403);

// ── 11) 토큰 0: 외부 호출 0회, provider_usage 0건, GET만 ──
check('no external call was made (no HERMES, no model, no connector)',fetchCalls===0);
check('no provider usage row was written',sql.prepare("SELECT COUNT(*) n FROM records WHERE kind='provider_usage'").get().n===0);
check('the server imports role-execution only for roleArtifactId and has no network code',/import \{roleArtifactId\} from '\.\/role-execution';/.test(src('lib/reward-lineage-server.ts'))&&!/hermes|openai|fetch\(/.test(src('lib/reward-lineage-server.ts'))&&!/hermes|openai|fetch\(/.test(src('app/api/reward-lineage/route.ts')));
check('the route has only GET',!('POST' in route)&&!('PUT' in route)&&!('DELETE' in route));
console.log(JSON.stringify({passed:passed.length},null,1));
