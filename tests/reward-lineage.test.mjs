// B4-2a 보상 계보 순수 모듈 회귀(docs/REWARD-LINEAGE.ko.md RED 목록): L0 첫 판정·사람 수정판 계보, ruleRef(id@version)·roleArtifactId 매핑,
// L1 copy 계보, L3 게시 관문·원가 미상 null·수동 귀속 unallocated, L2 결정 16 축소·사례 실험 제외, L4 not_run, 표본 5건 미만 null, 복합 버전 usesVersion,
// 버전 비교 확률(설명용), 바이트 동일·inputDigest, 카나리, 순수 모듈 import 경계. 근거: mocked(순수 함수, 외부 호출 0회).
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve,dirname} from 'node:path';
import ts from 'typescript';
import {testRuntime} from './helpers/runtime.mjs';

let calls=0;
const rt=testRuntime(async()=>{calls++;throw new Error('외부 호출 금지')});
const rl=await rt.load('lib/reward-lineage.ts'),sa=await rt.load('lib/store-attribution.ts'),vs=await rt.load('lib/viral-stats.ts');
const passed=[];const check=(name,val)=>{assert.ok(val,name);passed.push(name)};
const plain=x=>JSON.parse(JSON.stringify(x));

// ── 카나리: 주문번호·메모·근거 원문·이메일·규칙 본문·실험 메모·캡션에 심는다 ──
const EMAIL='hong.gildong@example.com',ORDER_NO='ORD-7788-SECRET',NOTE='단골 김철수 메모',EVIDENCE='매장 직원이 쿠폰 확인 010-2345-6789',GUIDANCE='규칙 본문 원문 비밀',CAPTION='캡션 원문 비밀';
const planted=[EMAIL,ORDER_NO,NOTE,EVIDENCE,GUIDANCE,CAPTION,'010-2345-6789'];

const PV_A='role.content@aaaaaaaaaaaa',PV_B='role.content@bbbbbbbbbbbb',PV_M='role.content@aaaaaaaaaaaa+channel.instagram@cccccccccccc',CH='channel.instagram@cccccccccccc';
const period={from:'2026-09-01',to:'2026-09-28'},scope={brandId:'b1',storeId:null,campaignId:null};

const art=(id,version,over={})=>({id,version,role:'content',origin:'ai',promptVersion:PV_A,...over});
const artifacts=[
 ...['a1','a2','a3','a4','a5','a6','a9'].map(id=>art(id,1)),
 art('a7',1,{promptVersion:PV_B}),
 // 사람이 고친 판: 레코드 promptVersion은 낡은 값(PV_A)이고 aiSource.promptVersion이 AI 원본(PV_B)이다.
 art('a7',2,{origin:'ai_edited',promptVersion:PV_A,aiSource:{version:1,promptVersion:PV_B}}),
 art('a8',1,{promptVersion:PV_B}),
 art('m1',1,{promptVersion:PV_M}),
 art('x1',1,{promptVersion:null}),
 art('h1',1,{origin:'manual',promptVersion:null}),
];
let seq=0;
const dec=(targetId,version,decision,createdAt,over={})=>({id:'d'+String(++seq).padStart(3,'0'),targetKind:'artifact',targetId,version,role:'content',decision,reasonCodes:[],section:`섹션 ${EMAIL}`,noteLength:12,actor:{id:'u1',role:'owner'},
 promptVersion:PV_A,skillVersion:'content-v1',outputContractVersion:'c1',campaignId:'c1',brandId:'b1',origin:'ai',reasonsVersion:'review-reasons-v1',createdAt,...over});
const decisions=[
 dec('a9',1,'approved','2026-08-20T01:00:00.000Z'), // 첫 판정이 기간 전이라 1차 판정으로 세지 않는다
 dec('a1',1,'approved','2026-09-02T01:00:00.000Z'),
 dec('a2',1,'approved','2026-09-02T02:00:00.000Z'),
 dec('a3',1,'approved','2026-09-02T03:00:00.000Z'),
 dec('a4',1,'approved','2026-09-02T04:00:00.000Z'),
 dec('a5',1,'revision','2026-09-03T01:00:00.000Z',{reasonCodes:['voice']}),
 dec('a5',1,'approved','2026-09-04T01:00:00.000Z'),
 dec('a6',1,'approved','2026-09-05T01:00:00.000Z'),
 dec('a1',1,'revision','2026-09-06T01:00:00.000Z',{reasonCodes:['fact_error']}),
 dec('a9',1,'revision','2026-09-06T02:00:00.000Z',{reasonCodes:['brand','not_a_code']}),
 dec('a7',2,'approved','2026-09-07T01:00:00.000Z',{origin:'ai_edited',promptVersion:null}),
 dec('a8',1,'approved','2026-09-07T02:00:00.000Z',{promptVersion:PV_B}),
 dec('m1',1,'approved','2026-09-08T01:00:00.000Z',{promptVersion:PV_M}),
 dec('x1',1,'approved','2026-09-08T02:00:00.000Z',{promptVersion:null}),
 dec('h1',1,'approved','2026-09-08T03:00:00.000Z',{origin:'manual',promptVersion:null}),
 dec('p1',1,'cancelled','2026-09-08T04:00:00.000Z',{targetKind:'publication',reasonCodes:['voice']}),
];
const rule=(id,version,over={})=>({id,version,brandId:'b1',channel:'Instagram',experimentId:'',experimentVersion:0,caseId:'',title:`제목 ${GUIDANCE}`,guidance:GUIDANCE,scope:'',status:'active',expiresAt:'2026-12-01T00:00:00.000Z',...over});
const R1v2=rule('rule-1',2),R1v3=rule('rule-1',3),P1=rule('playbook:9c1e',1,{origin:'review',grade:'operator_preference',channel:'*'});
const snap=(id,rules,prefs,over={})=>({id,campaignId:'c1',role:'content',createdAt:'2026-09-01T00:00:00.000Z',rules,...(prefs?{operatorPreferences:prefs}:{}),...over});
const snapshots=[
 snap('job1',[R1v2],[P1]),
 snap('job2',[R1v2],[P1],{artifactId:'a2'}), // 스냅샷 자체 artifactId(운영자 선호 주입 실행)
 ...['job3','job4','job5','job6'].map(id=>snap(id,[R1v2])),
 snap('job9',[R1v3]), // 매핑이 없는 스냅샷
];
const roleArtifactIds={job1:'a1',job3:'a3',job4:'a4',job5:'a5',job6:'a6'};
const pub=(id,over={})=>({id,campaignId:'c1',creativeId:'cr1',creativeVersion:1,campaignVersion:1,pngHash:'h',factRefs:[],caption:CAPTION,mediaUrl:'',scheduledAt:'2026-09-10T03:00:00.000Z',plannedCostKRW:0,version:2,status:'published',approvedAt:'2026-09-09T00:00:00.000Z',createdAt:'x',...over});
const copy=(artifactId,artifactVersion)=>({artifactId,artifactVersion,index:0,text:CAPTION});
const publications=[
 pub('p1',{copy:copy('a1',1)}),
 pub('p2',{copy:copy('a7',2),status:'accepted'}),
 pub('p3',{status:'published'}), // copy 없음
 pub('p4',{copy:copy('a2',1),status:'cancelled'}),
 pub('p5',{copy:copy('x1',1),status:'failed',approvedAt:undefined}),
 pub('p6',{copy:copy('a3',1),scheduledAt:'2026-08-10T03:00:00.000Z'}), // 기간 전 발행
];
const known={foodCost:5000,packagingCost:500,fees:0,deliveryCost:0,benefitCost:0},unknownCosts={...known,foodCost:null};
const code=(publicationId,c='AB23')=>({codeId:'k-'+c,code:c,...(publicationId?{publicationId}:{}),conflictCodeIds:[],enteredBy:{id:'u9',email:EMAIL}});
const auto=c=>sa.autoEvidence({code:c,type:'coupon'});
const order=(id,over={})=>({id,storeId:'s1',source:'pos',orderNumber:`${ORDER_NO}-${id}`,orderDate:'2026-09-12',mode:'hall',status:'paid',paidAmount:20000,refundAmount:0,costs:known,channel:'unknown',experimentId:'',attributionEvidence:'',note:NOTE,version:1,createdAt:'x',updatedAt:'x',...over});
const orders=[
 order('o1',{codeAttribution:code('p1'),campaignId:'c1',attributionEvidence:auto('AB23')}),
 order('o2',{codeAttribution:code('p1'),campaignId:'c1',attributionEvidence:auto('AB23'),costs:unknownCosts,paidAmount:15000}),
 order('o3',{codeAttribution:code('p2','CD45'),campaignId:'c1',attributionEvidence:auto('CD45')}),
 order('o4',{codeAttribution:code('p4','EF67'),campaignId:'c1',attributionEvidence:auto('EF67')}), // 취소 게시: 관문에서 빠져 미귀속
 order('o5',{codeAttribution:code('p1'),campaignId:'c1',orderDate:'2026-09-09',attributionEvidence:EVIDENCE}), // 게시 전 주문, 사람 근거 → 수동 귀속
 order('o6',{channel:'naver_place',campaignId:'c1',attributionEvidence:EVIDENCE}),
 order('o7',{codeAttribution:code(null,'GH89'),campaignId:'c1',attributionEvidence:auto('GH89')}), // 캠페인 코드(게시 없음)
 order('o8',{codeAttribution:code('p3','JK23'),campaignId:'c1',attributionEvidence:auto('JK23')}), // copy 없는 게시
 order('o9',{codeAttribution:code('p1'),campaignId:'c1',attributionEvidence:auto('AB23'),status:'cancelled'}),
 order('o10',{codeAttribution:code('p1'),campaignId:'c1',attributionEvidence:auto('AB23'),orderDate:'2026-10-02'}), // 기간 밖
];
const exp=(id,over={})=>({id,brandId:'b1',campaignId:'c1',caseId:'',analysisId:'',title:'실험',channel:'Instagram',hypothesis:`가설 ${NOTE}`,variable:'v',control:'c',treatment:'t',metric:'share_rate',minSample:100,minHours:24,minLift:10,conditions:'',version:1,status:'evaluated',startedAt:null,createdAt:'2026-09-11T00:00:00.000Z',updatedAt:'x',result:{control:{denominator:10,numerator:1,source:EMAIL},treatment:{denominator:10,numerator:2,source:EMAIL},comparable:true,notes:NOTE,observedUntil:'x',recordedAt:'x'},assessment:null,...over});
const experiments=[
 exp('e1',{source:{kind:'artifact',artifactId:'a1',artifactVersion:1,index:0}}),
 exp('e2',{caseId:'case1',analysisId:'an1'}), // 사례 기반 실험
 exp('e3',{source:{kind:'artifact',artifactId:'a7',artifactVersion:2,index:1},status:'running'}),
];
const rules=[rule('rv1',1,{experimentId:'e1',experimentVersion:1,origin:'viral'}),rule('rv0',1,{experimentId:'e1',status:'draft'})];
const baseInput=()=>({period,scope,decision16:'not_run',decisions,artifacts,snapshots,roleArtifactIds,publications,orders,experiments,rules});

const report=plain(rl.buildRewardLineage(baseInput())),json=JSON.stringify(report);
const row=(pv,role='content')=>report.byPromptVersion.find(r=>r.promptVersion===pv&&r.role===role);
const A=row(PV_A),B=row(PV_B),M=row(PV_M);

// ── 0) 계약 모양 ──
check('schema, period with Asia/Seoul and scope are carried',report.schema==='collective.reward-lineage.v1'&&report.period.timeZone==='Asia/Seoul'&&report.period.from==='2026-09-01'&&JSON.stringify(report.scope)===JSON.stringify(scope));
check('rows are sorted by promptVersion then role',JSON.stringify(report.byPromptVersion.map(r=>r.promptVersion))===JSON.stringify([PV_A,PV_M,PV_B]));

// ── 1) L0: 작업물의 첫 판정만 1차 승인으로 세고, 사람이 고친 판은 aiSource.promptVersion으로 묶는다 ──
check('L0 counts only the first decision per artifact',A.human.decidedFirst===6&&A.human.approvedFirst===5&&A.human.editedFirst===0);
check('L0 first-pass rate uses first decisions (5/6)',A.human.firstPassRate===0.8333&&A.human.status==='measured');
check('L0 revisions count every in-period revision, first or not (a5, a1, a9)',A.human.revisions===3);
check('L0 reason codes are counted by known code only, sorted',JSON.stringify(A.human.reasonCodes)==='{"brand":1,"fact_error":1,"voice":1}');
check('L0 human-edited version is grouped by aiSource.promptVersion, not the stale record field',B.human.decidedFirst===2&&B.human.editedFirst===1&&B.human.approvedFirst===1);
check('L0 a first decision before the period is not a first decision in the period (a9 counts as an artifact through its in-period revision)',A.human.decidedFirst===6&&A.artifacts===7);
check('L0 manual artifacts are left out and unknown promptVersion goes to unallocated',report.unallocated.human.firstDecisions===1&&report.unallocated.human.reasons.no_prompt_version===1&&!json.includes('"h1"'));
check('L0 layer is measured app_record',report.layers.human.status==='measured'&&report.layers.human.source==='app_record');

// ── 2) ruleRef: learning_snapshot rules·operatorPreferences를 id@version으로 작업물에 잇는다(roleArtifactId 매핑 입력) ──
const refs=report.byRule.map(r=>r.ruleRef);
check('byRule refs are id@version, sorted, unmapped snapshots excluded',JSON.stringify(refs)===JSON.stringify(['playbook:9c1e@1','rule-1@2']));
const R=report.byRule.find(r=>r.ruleRef==='rule-1@2'),P=report.byRule.find(r=>r.ruleRef==='playbook:9c1e@1');
check('rule links use snapshot artifactId or the roleArtifactId mapping',R.human.decidedFirst===6&&R.human.approvedFirst===5&&R.artifacts===6);
check('operator preference rule keeps its grade and a default grade is performance_observed',P.grade==='operator_preference'&&R.grade==='performance_observed');
check('appliedRules derives rules and operatorPreferences blocks',JSON.stringify(plain(rl.appliedRules(snapshots[0])))===JSON.stringify([{ruleRef:'rule-1@2',grade:'performance_observed',block:'rules'},{ruleRef:'playbook:9c1e@1',grade:'operator_preference',block:'operatorPreferences'}]));
check('snapshots without an artifact link are counted as unallocated',report.unallocated.rules.snapshots===1&&report.unallocated.rules.reasons.no_artifact_mapping===1);

// ── 3) L1: publication.copy가 있는 발행만 정확한 계보로 세고, copy가 없으면 unknown이다 ──
check('L1 counts publications with copy by artifact version (p1, p4)',JSON.stringify(A.publish)==='{"publications":2,"approved":2,"live":1,"cancelled":1,"failed":0}');
check('L1 human-edited copy follows aiSource (p2 → PV_B)',B.publish.publications===1&&B.publish.live===1);
check('L1 without copy is unknown, copy without promptVersion is no_prompt_version',report.unallocated.publish.publications===2&&report.unallocated.publish.reasons.no_copy===1&&report.unallocated.publish.reasons.no_prompt_version===1);
check('L1 publications outside the period are not counted',report.byPromptVersion.reduce((n,r)=>n+r.publish.publications,0)===3);
check('L1 layer marks realPublish false when decision 16 is not_run',report.layers.publish.realPublish===false&&report.layers.publish.status==='measured'&&report.layers.publish.source==='app_record');

// ── 4) L3: 게시 관문을 통과한 코드 귀속 주문만 세고, 원가 미상이 1건이라도 있으면 contribution은 null이다 ──
check('L3 counts gated publication-code orders only (o1, o2 → PV_A)',A.order.attributedOrders===2&&A.order.netRevenue===35000);
check('L3 one unknown-cost order makes contribution null',A.order.contribution===null&&A.order.unknownCostOrders===1);
check('L3 known costs give a contribution (o3 → PV_B)',B.order.attributedOrders===1&&B.order.contribution===14500&&B.order.unknownCostOrders===0);
check('L3 layer notes 귀속≠증분 and user_record+derived',report.layers.order.notice==='귀속≠증분'&&report.layers.order.source==='user_record+derived'&&report.notices.some(n=>n.includes('귀속≠증분')));

// ── 5) L3: 수동·캠페인 귀속은 unallocated이고 어느 버전에도 배분하지 않는다 ──
check('L3 manual, campaign-code and pre-publication orders are unallocated (o5, o6, o7)',report.unallocated.order.reasons.manual_or_campaign_only===3);
check('L3 an order through a publication without copy is unknown (o8)',report.unallocated.order.reasons.no_copy===1&&report.unallocated.order.attributedOrders===4);
check('L3 no version receives unallocated orders',report.byPromptVersion.reduce((n,r)=>n+r.order.attributedOrders,0)===3&&report.byRule.every(r=>r.order.attributedOrders<=2));
check('L3 a cancelled publication code order is not attributed at all (o4)',report.byPromptVersion.reduce((n,r)=>n+r.order.attributedOrders,0)+report.unallocated.order.attributedOrders===7);

// ── 6) L2: 결정 16 not_run이면 reduced이고, 사례 기반 실험은 빼고 작업물 출처 실험만 센다 ──
check('L2 is reduced with decision16_not_run',report.layers.engagement.status==='reduced'&&report.layers.engagement.reason==='decision16_not_run'&&report.layers.engagement.source==='user_record');
check('L2 counts artifact-source experiments and excludes case-based ones',JSON.stringify(A.engagement)==='{"experiments":1,"evaluated":1,"adoptedRules":1}'&&JSON.stringify(B.engagement)==='{"experiments":1,"evaluated":0,"adoptedRules":0}'&&report.layers.engagement.excluded.caseBased===1);
const real=plain(rl.buildRewardLineage({...baseInput(),decision16:'real'}));
check('L2 is measured and realPublish true once decision 16 ran for real',real.layers.engagement.status==='measured'&&!('reason' in real.layers.engagement)&&real.layers.publish.realPublish===true);

// ── 7) L4: A5 전에는 not_run 사유와 null이다 ──
check('L4 is not_run with a5_not_started',report.layers.revisit.status==='not_run'&&report.layers.revisit.reason==='a5_not_started');
check('L4 is null on every row',[...report.byPromptVersion,...report.byRule,...report.byUnitVersion].every(r=>r.revisit===null));

// ── 8) 표본 5건 미만 비율은 null·insufficient다 ──
check('fewer than five first decisions gives a null rate and insufficient',B.human.firstPassRate===null&&B.human.status==='insufficient'&&P.human.firstPassRate===null&&P.human.status==='insufficient');
check('the minimum sample is five',rl.MIN_SAMPLE===5);

// ── 9) 복합 버전(a+b): 키 그대로 쓰고 단위별 모음은 usesVersion으로 한다 ──
check('composite key is kept as one row',M&&M.human.decidedFirst===1);
const unit=id=>report.byUnitVersion.find(u=>u.unitVersion===id);
check('unit rows cover every unit of a composite key and add every row using it',unit(PV_A).human.decidedFirst===7&&unit(CH).human.decidedFirst===1&&JSON.stringify(unit(CH).promptVersions)===JSON.stringify([PV_M]));
check('usesVersion splits on +',rl.usesVersion(PV_M,CH)&&rl.usesVersion(PV_A,PV_A)&&!rl.usesVersion(PV_M,'channel.instagram@ccc')&&!rl.usesVersion(null,PV_A));

// ── 10) 버전 비교: probTreatmentBetter는 설명용, 권고·판정 문구 없음 ──
const many=[];
for(const [pv,approved] of [[PV_A,3],[PV_B,5]])for(let i=0;i<5;i++){const id=`${pv.slice(-1)}${i}`;many.push(dec(id,1,i<approved?'approved':'revision',`2026-09-${String(10+(pv===PV_A?0:5)+i).padStart(2,'0')}T00:00:00.000Z`,{promptVersion:pv}))}
const cmp=plain(rl.buildRewardLineage({period,scope,decision16:'not_run',decisions:many,artifacts:[]}));
check('versions of one role with enough samples get one explanatory comparison',cmp.comparisons.length===1&&cmp.comparisons[0].control.promptVersion===PV_A&&cmp.comparisons[0].treatment.promptVersion===PV_B);
check('comparison probability equals viral-stats probTreatmentBetter',cmp.comparisons[0].probTreatmentBetter===vs.probTreatmentBetter({successes:3,trials:5},{successes:5,trials:5}));
check('an insufficient version is not compared',report.comparisons.length===0);
const data=JSON.stringify({...cmp,notices:[]})+JSON.stringify({...report,notices:[]});
check('no recommendation, promotion or verdict wording in the data',!/recommend|promot|demot|verdict|adopt"|권고|승격|강등|판정:/.test(data.replace(/adoptedRules/g,''))&&cmp.notices.some(t=>t.includes('자동 판정 아님')));

// ── 11) 결정론: 같은 입력이면 바이트 동일, 입력 배열 순서와 무관, inputDigest ──
check('same input gives byte-identical JSON',JSON.stringify(plain(rl.buildRewardLineage(baseInput())))===json);
const shuffle=list=>[...list].reverse();
const shuffledInput={...baseInput(),decisions:shuffle(decisions),artifacts:shuffle(artifacts),snapshots:shuffle(snapshots),publications:shuffle(publications),orders:shuffle(orders),experiments:shuffle(experiments),rules:shuffle(rules)};
check('input array order does not change the bytes',JSON.stringify(plain(rl.buildRewardLineage(shuffledInput)))===json);
const full=plain(await rl.rewardLineage(baseInput())),fullShuffled=plain(await rl.rewardLineage(shuffledInput));
check('inputDigest is sha256 of the canonical input and order independent',full.inputDigest==='sha256:'+createHash('sha256').update(rl.canonicalInput(baseInput())).digest('hex')&&fullShuffled.inputDigest===full.inputDigest);
const bumped=plain(await rl.rewardLineage({...baseInput(),orders:orders.map(o=>o.id==='o1'?{...o,version:2}:o)}));
check('inputDigest changes when a record version changes',bumped.inputDigest!==full.inputDigest);
check('the digest report equals the built report plus the digest',JSON.stringify({...full,inputDigest:undefined})===JSON.stringify({...report,inputDigest:undefined}));
assert.throws(()=>rl.buildRewardLineage({...baseInput(),period:{from:'2026-09-28',to:'2026-09-01'}}));passed.push('an inverted period is refused');
assert.throws(()=>rl.buildRewardLineage({...baseInput(),period:{from:'2026/09/01',to:'2026-09-28'}}));passed.push('a malformed period is refused');

// ── 12) 카나리: 주문번호·메모·근거 원문·이메일이 없다 ──
const leaked=planted.filter(p=>json.includes(p)||JSON.stringify(full).includes(p)||rl.canonicalInput(baseInput()).includes(p));
check('output and canonical input carry no order number, note, evidence text, email, rule text or caption',leaked.length===0);

// ── 13) 순수 모듈 import 경계: server·feature-flags·quality-*·eval-*·franchise-*를 import하지 않는다 ──
function edges(file){
 const src=ts.createSourceFile(file,readFileSync(file,'utf8'),ts.ScriptTarget.ES2022,true),out=[];
 const typeOnly=n=>ts.isImportDeclaration(n)?!!n.importClause&&(n.importClause.isTypeOnly||(!n.importClause.name&&!!n.importClause.namedBindings&&ts.isNamedImports(n.importClause.namedBindings)&&n.importClause.namedBindings.elements.length>0&&n.importClause.namedBindings.elements.every(e=>e.isTypeOnly))):ts.isExportDeclaration(n)?n.isTypeOnly:false;
 const visit=n=>{
  if((ts.isImportDeclaration(n)||ts.isExportDeclaration(n))&&n.moduleSpecifier&&ts.isStringLiteral(n.moduleSpecifier))out.push({spec:n.moduleSpecifier.text,type:typeOnly(n)});
  if(ts.isCallExpression(n)&&(n.expression.kind===ts.SyntaxKind.ImportKeyword||(ts.isIdentifier(n.expression)&&n.expression.text==='require')))out.push({spec:n.arguments[0]&&ts.isStringLiteralLike(n.arguments[0])?n.arguments[0].text:'<opaque>',type:false});
  ts.forEachChild(n,visit);
 };
 visit(src);return out;
}
const target=(from,spec)=>spec.startsWith('@/')?resolve(spec.slice(2))+'.ts':resolve(dirname(from),spec)+'.ts';
const FORBIDDEN=/(^|\/)(server|feature-flags|quality-[^/]*|eval-[^/]*|franchise-[^/]*|[^/]*-server)\.ts$/;
function runtimeClosure(roots){const seen=new Set(),queue=roots.map(r=>resolve(r));while(queue.length){const f=queue.shift();if(seen.has(f))continue;seen.add(f);for(const e of edges(f))if(!e.type&&e.spec!=='<opaque>'&&(e.spec.startsWith('.')||e.spec.startsWith('@/')))queue.push(target(f,e.spec))}return [...seen]}
const PURE=['lib/reward-lineage.ts'],ALLOWED=new Set(['./review-decisions','./store-attribution','./viral-stats','./learning','./execution','./customer-report']);
const TYPE_ONLY=new Set(['./learning','./execution','./customer-report']);
check('the pure module imports only relative allowed modules (type imports included)',PURE.every(f=>edges(f).every(e=>ALLOWED.has(e.spec))));
check('learning, execution and customer-report are imported for types only',PURE.every(f=>edges(f).filter(e=>TYPE_ONLY.has(e.spec)).every(e=>e.type)));
const closure=runtimeClosure(PURE),bad=closure.filter(f=>FORBIDDEN.test(f));
check('the pure module does not reach server, feature-flags, quality-*, eval-*, franchise-* at runtime',bad.length===0&&closure.length>2);
check('the pure module has no network, clock, storage or model access in source',PURE.every(f=>{const s=readFileSync(f,'utf8');return !/\bfetch\s*\(|Date\.now|new Date\(\)|Math\.random|database\(|provider|hermes|console\./i.test(s)}));
check('the boundary checker would catch a forbidden import',['lib/server.ts','lib/franchise-facts.ts','lib/quality-console.ts','lib/feature-flags.ts','lib/eval-stats.ts','lib/prompt-registry.ts'].every(f=>FORBIDDEN.test(resolve(f))||runtimeClosure([f]).some(x=>FORBIDDEN.test(x)))&&!FORBIDDEN.test(resolve('lib/reward-lineage.ts')));

// ── 14) 모델·외부 호출 0회 ──
check('no model or external call was made',calls===0);

console.log(JSON.stringify({passed:passed.length}));
