// B4-2c 닫힌 개선 루프 대장 순수 모듈 회귀(docs/REWARD-LINEAGE.ko.md 11절 RED 목록): 루프 후보(평가 run·승인이 있는 activate·promote, 승인 없는 stage 제외, playbook activate),
// 활성화 전후 14일 창의 L0 비교(L1 발행·L3 주문 경로 포함), 상태(open·insufficient·closable·closed·rolled_back), 롤백된 버전은 닫힌 루프로 세지 않음,
// 닫은 루프는 동결 수치를 그대로 보임, 비교 확률은 설명용, 결정론·inputDigest, 순수 모듈 import 경계. 근거: mocked(순수 함수, 외부 호출 0회).
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import ts from 'typescript';
import {testRuntime} from './helpers/runtime.mjs';

let calls=0;
const rt=testRuntime(async()=>{calls++;throw new Error('외부 호출 금지')});
const il=await rt.load('lib/improvement-loops.ts'),vs=await rt.load('lib/viral-stats.ts');
const passed=[];const check=(name,val)=>{assert.ok(val,name);passed.push(name)};
const plain=x=>JSON.parse(JSON.stringify(x));

const TODAY='2026-09-27',B='b1';
const PV_A='role.content@aaaaaaaaaaaa',PV_B='role.content@bbbbbbbbbbbb',PV_C='role.content@cccccccccccc',PV_S='role.strategy@dddddddddddd',PV_I='channel.instagram@eeeeeeeeeeee';
const approval={reason:'평가 통과',by:{id:'u1',email:null},at:'x'};
const ev=(id,action,unit,from,to,at,over={})=>({id,unit,action,from,to,sourceSha:null,evalRunId:'run-'+id,approval,stagedCampaignIds:[],by:{id:'u1',email:null},manifestBefore:null,manifestAfter:null,at,...over});
const releaseEvents=[
 ev('e1','activate','role.content',PV_A,PV_B,'2026-09-01T03:00:00.000Z'), // D=09-01, 전 08-18~08-31, 후 09-01~09-14 → 경과
 ev('e2','stage','role.content',PV_B,PV_C,'2026-09-16T03:00:00.000Z'), // 지정 캠페인 적용(stage)은 후보가 아니다
 ev('e3','activate','role.brand',null,'role.brand@ffffffffffff','2026-09-02T03:00:00.000Z',{approval:null}), // 승인 없음
 ev('e3b','activate','role.brand',null,'role.brand@999999999999','2026-09-02T04:00:00.000Z',{evalRunId:null}), // 평가 run 없음
 ev('e4','promote','role.content',PV_B,PV_C,'2026-09-20T03:00:00.000Z',{approval:{reason:null,by:{id:'u1',email:null},at:'x'}}), // 14일 전 → open
 ev('e5','activate','role.strategy',null,PV_S,'2026-08-25T03:00:00.000Z'),
 ev('e5r','rollback','role.strategy',PV_S,null,'2026-09-15T03:00:00.000Z',{evalRunId:null,approval:null}), // e5 버전 롤백
 ev('e6','activate','channel.instagram',null,PV_I,'2026-08-20T03:00:00.000Z'), // 표본 부족
 ev('e7','reset_pins',null,null,null,'2026-09-03T03:00:00.000Z',{evalRunId:null,approval:null}),
];

// 작업물·1차 판정 생성기: n건, 날짜 목록을 돌며 앞의 approved건은 승인, 나머지는 수정 요청.
let seq=0;
const art=(id,pv,role='content')=>({id,version:1,role,origin:'ai',promptVersion:pv});
const dec=(targetId,pv,decision,createdAt,role='content')=>({id:'d'+String(++seq).padStart(4,'0'),targetKind:'artifact',targetId,version:1,role,decision,reasonCodes:[],noteLength:0,actor:{id:'u1',role:'owner'},promptVersion:pv,skillVersion:null,outputContractVersion:null,campaignId:'c1',brandId:B,origin:'ai',reasonsVersion:'review-reasons-v1',createdAt});
function batch(prefix,pv,days,approved,role='content'){
 const ids=days.map((_,i)=>`${prefix}${i}`);
 return {artifacts:ids.map(id=>art(id,pv,role)),decisions:ids.map((id,i)=>dec(id,pv,i<approved?'approved':'revision',days[i]+'T03:00:00.000Z',role)),ids};
}
const before1=batch('pa',PV_A,['2026-08-20','2026-08-21','2026-08-22','2026-08-23','2026-08-24','2026-08-25'],2);
const after1=batch('pb',PV_B,['2026-09-03','2026-09-04','2026-09-05','2026-09-06','2026-09-07','2026-09-08'],5);
const outside=batch('po',PV_B,['2026-09-15','2026-09-16'],2); // 후 창 밖(09-15 이후)
const early=batch('pe',PV_A,['2026-08-10'],1); // 전 창 밖(08-18 이전)
const strat=batch('ps',PV_S,['2026-08-26','2026-08-27','2026-08-28','2026-08-29','2026-08-30','2026-08-31'],6,'strategy');
const stratBefore=batch('pt','strategy-v1:111111111111',['2026-08-12','2026-08-13','2026-08-14','2026-08-15','2026-08-16'],1,'strategy');
const insta=batch('pi','meeting.synthesis@999999999999+'+PV_I,['2026-08-21','2026-08-22','2026-08-23'],3);
const all=[before1,after1,outside,early,strat,stratBefore,insta];
const pub=(id,artifactId,scheduledAt,over={})=>({id,version:2,status:'published',scheduledAt,approvedAt:scheduledAt,copy:{artifactId,artifactVersion:1,index:0},...over});
const publications=[pub('pub1',after1.ids[0],'2026-09-05T03:00:00.000Z'),pub('pub0',before1.ids[0],'2026-08-22T03:00:00.000Z',{status:'accepted'})];
const reward=(over={})=>({period:{from:'2026-08-01',to:TODAY},scope:{brandId:B,storeId:null,campaignId:null},decision16:'not_run',
 decisions:all.flatMap(x=>x.decisions),artifacts:all.flatMap(x=>x.artifacts),snapshots:[],roleArtifactIds:{},publications,orders:[],experiments:[],rules:[],...over});
const base=(over={})=>({today:TODAY,brandId:B,releaseEvents,playbookAudits:[],closures:[],reward:reward(),...over});
const loopOf=(out,id)=>out.loops.find(l=>l.id===id);

// ── 1) 후보: 평가 run과 승인이 있는 activate·promote만. stage·승인 없음·평가 run 없음·rollback·reset_pins는 아니다 ──
const cands=plain(il.loopCandidates({releaseEvents,playbookAudits:[],brandId:B,today:TODAY}));
check('activate and promote with an eval run and an approval are loop candidates',['prompt:e1','prompt:e4','prompt:e5','prompt:e6'].every(id=>cands.some(c=>c.id===id)));
check('stage, unapproved, eval-less, rollback and reset_pins events are not candidates',!cands.some(c=>['prompt:e2','prompt:e3','prompt:e3b','prompt:e5r','prompt:e7'].includes(c.id))&&cands.length===4);
check('windows are the 14 KST days before activation and 14 days from the activation day',(c=>c.windows.before.from==='2026-08-18'&&c.windows.before.to==='2026-08-31'&&c.windows.after.from==='2026-09-01'&&c.windows.after.to==='2026-09-14'&&c.activatedDay==='2026-09-01')(cands.find(c=>c.id==='prompt:e1')));
check('a promote loop records the baseline as from and the promoted version as to',(c=>c.source.action==='promote'&&c.source.from===PV_B&&c.source.to===PV_C&&c.source.evalRunId==='run-e4')(cands.find(c=>c.id==='prompt:e4')));

// ── 2) closable: 14일 경과, 양쪽 5건 이상. 전후 L0 비교와 L1 발행 ──
let out=plain(il.buildImprovementLoops(base()));
const e1=loopOf(out,'prompt:e1');
check('an elapsed loop with enough samples on both sides is closable',e1.status==='closable'&&e1.version===0&&e1.closed===null&&!e1.rolledBack);
check('before counts first decisions of the from version inside the 14 days before',e1.comparison.before.decidedFirst===6&&e1.comparison.before.approvedFirst===2&&e1.comparison.before.firstPassRate===0.3333&&e1.comparison.before.status==='measured');
check('after counts first decisions of the to version inside the 14 days from activation (not later ones)',e1.comparison.after.decidedFirst===6&&e1.comparison.after.approvedFirst===5&&e1.comparison.after.firstPassRate===0.8333);
check('the comparison probability is the explanatory probTreatmentBetter of before vs after',e1.comparison.probTreatmentBetter===vs.probTreatmentBetter({successes:2,trials:6},{successes:5,trials:6})&&e1.comparison.probTreatmentBetter>0.5);
check('L1 publications of each window are carried (possible L1)',e1.comparison.after.publish.publications===1&&e1.comparison.before.publish.publications===1&&e1.comparison.after.publish.live===1);
check('L3 is the order path only (attributed orders, contribution) and states attribution is not incremental',e1.comparison.after.order.attributedOrders===0&&e1.comparison.after.order.contribution===0&&out.notices.some(n=>/귀속≠증분/.test(n)));
check('the loop carries no recommendation or verdict field',!/recommend|verdict|promote_to|권고/.test(JSON.stringify(e1)));

// ── 3) open(14일 미경과)·insufficient(표본 5건 미만) ──
check('a loop within 14 days of activation is open',loopOf(out,'prompt:e4').status==='open');
check('open wins over the sample check while the after window is running',loopOf(out,'prompt:e4').comparison.after.decidedFirst<5);
const e6=loopOf(out,'prompt:e6');
check('an elapsed loop with fewer than 5 first decisions on a side is insufficient',e6.status==='insufficient'&&e6.comparison.after.decidedFirst===3&&e6.comparison.after.firstPassRate===null&&e6.comparison.probTreatmentBetter===null);
check('a composite version counts for the unit it uses',e6.comparison.after.decidedFirst===3);
out=plain(il.buildImprovementLoops(base({today:'2026-09-14'})));
check('the last day of the after window is still open',loopOf(out,'prompt:e1').status==='open');
out=plain(il.buildImprovementLoops(base({today:'2026-09-15'})));
check('the day after the after window the loop can close',loopOf(out,'prompt:e1').status==='closable');

// ── 4) 롤백된 버전은 닫힌 루프로 세지 않는다 ──
out=plain(il.buildImprovementLoops(base()));
const e5=loopOf(out,'prompt:e5');
check('a rolled back version is not closable',e5.status==='rolled_back'&&e5.rolledBack===true&&e5.countsToExit===false);
check('from=null before window uses runs without any version of the unit, same role',e5.comparison.before.decidedFirst===5&&e5.comparison.after.decidedFirst===6);
const rec=(loop,over={})=>({id:loop.id,version:1,source:loop.source,activatedAt:loop.activatedAt,activatedDay:loop.activatedDay,windows:loop.windows,scope:{brandId:B,storeId:null,campaignId:null},comparison:loop.comparison,inputDigest:'sha256:'+'0'.repeat(64),closedBy:{id:'u1',role:'owner'},closedAt:'2026-09-20T00:00:00.000Z',...over});
const closedE1=rec(e1),closedE5=rec(e5);
out=plain(il.buildImprovementLoops(base({closures:[closedE1,closedE5]})));
check('a closed loop is closed with version 1 and counts toward the exit condition',loopOf(out,'prompt:e1').status==='closed'&&loopOf(out,'prompt:e1').version===1&&loopOf(out,'prompt:e1').countsToExit===true);
check('a closed loop whose version was rolled back does not count as a closed loop',loopOf(out,'prompt:e5').status==='closed'&&loopOf(out,'prompt:e5').rolledBack===true&&loopOf(out,'prompt:e5').countsToExit===false);
check('the exit condition counts closed, not rolled back loops against the target of 5',JSON.stringify(out.exit)==='{"target":5,"closed":2,"counted":1}');
const lateRollback=[...releaseEvents,ev('e1r','rollback','role.content',PV_B,PV_A,'2026-09-25T03:00:00.000Z',{evalRunId:null,approval:null})];
out=plain(il.buildImprovementLoops(base({releaseEvents:lateRollback,closures:[closedE1]})));
check('rolling back after closing removes the loop from the exit count',loopOf(out,'prompt:e1').countsToExit===false&&out.exit.counted===0);
const earlierRollback=[...releaseEvents,ev('e0r','rollback','role.content',PV_B,PV_A,'2026-08-30T03:00:00.000Z',{evalRunId:null,approval:null})];
check('a rollback before the activation does not roll the loop back',loopOf(plain(il.buildImprovementLoops(base({releaseEvents:earlierRollback}))),'prompt:e1').status==='closable');

// ── 5) 닫은 루프는 동결 수치를 보인다(이후 데이터가 바뀌어도 그대로) ──
const moreData=reward({decisions:[...all.flatMap(x=>x.decisions),...batch('px',PV_B,['2026-09-09','2026-09-10','2026-09-11'],0).decisions],artifacts:[...all.flatMap(x=>x.artifacts),...batch('px',PV_B,['2026-09-09','2026-09-10','2026-09-11'],0).artifacts]});
const live=loopOf(plain(il.buildImprovementLoops(base({reward:moreData}))),'prompt:e1'),frozen=loopOf(plain(il.buildImprovementLoops(base({reward:moreData,closures:[closedE1]}))),'prompt:e1');
check('new data changes the live numbers of an unclosed loop',live.comparison.after.decidedFirst===9);
check('a closed loop keeps the frozen numbers and digest',JSON.stringify(frozen.comparison)===JSON.stringify(e1.comparison)&&frozen.inputDigest===closedE1.inputDigest&&frozen.closed.by.role==='owner');

// ── 6) playbook activate: 규칙이 주입된 작업물의 L0 전후 ──
const pa=(id,action,ruleId,createdAt,brandId=B,role='content')=>({id,ruleId,brandId,action,fromStatus:'draft',toStatus:action==='pause'?'paused':'active',ruleVersion:2,role,createdAt});
const RULE='playbook:r1';
const pbBefore=batch('qa',PV_A,['2026-08-26','2026-08-27','2026-08-28','2026-08-29','2026-08-30'],1);
const pbAfter=batch('qb',PV_A,['2026-09-10','2026-09-11','2026-09-12','2026-09-13','2026-09-14'],4);
const pbPlain=batch('qc',PV_A,['2026-09-10','2026-09-11'],0); // 활성화 뒤지만 규칙이 주입되지 않은 작업물
const pbOther=batch('qd',PV_A,['2026-08-26'],0,'strategy'); // 다른 역할(전 창에서 빠진다)
const pRule={id:RULE,version:2,grade:'operator_preference'};
const pbSnaps=pbAfter.ids.map(id=>({id:'job-'+id,artifactId:id,rules:[],operatorPreferences:[pRule]}));
const pbReward=reward({decisions:[...pbBefore.decisions,...pbAfter.decisions,...pbPlain.decisions,...pbOther.decisions],artifacts:[...pbBefore.artifacts,...pbAfter.artifacts,...pbPlain.artifacts,...pbOther.artifacts],snapshots:pbSnaps,publications:[]});
const audits=[pa('au0','create',RULE,'2026-09-01T00:00:00.000Z'),pa('au1','activate',RULE,'2026-09-09T03:00:00.000Z'),pa('aux','activate','playbook:other','2026-09-09T03:00:00.000Z','b2')];
out=plain(il.buildImprovementLoops(base({releaseEvents:[],playbookAudits:audits,reward:pbReward})));
const pb=loopOf(out,'playbook:au1');
check('a playbook activate is a loop candidate and create is not',!!pb&&!out.loops.some(l=>l.id==='playbook:au0')&&pb.source.kind==='playbook'&&pb.source.ruleId===RULE);
check('a playbook activate of another brand is not a candidate here',!out.loops.some(l=>l.id==='playbook:aux'));
check('after counts only artifacts the rule was injected into',pb.comparison.after.decidedFirst===5&&pb.comparison.after.approvedFirst===4);
check('before counts the same brand role first decisions of the 14 days before activation',pb.comparison.before.decidedFirst===5&&pb.comparison.before.approvedFirst===1);
check('the playbook loop is closable after 14 days with 5 on each side',pb.status==='closable'&&pb.comparison.probTreatmentBetter!==null);
out=plain(il.buildImprovementLoops(base({releaseEvents:[],playbookAudits:[...audits,pa('au2','pause',RULE,'2026-09-20T03:00:00.000Z')],reward:pbReward})));
check('pausing the rule after activation rolls the playbook loop back',loopOf(out,'playbook:au1').status==='rolled_back');

// ── 7) 결정론·inputDigest ──
const shuffled=base({releaseEvents:[...releaseEvents].reverse(),reward:reward({decisions:all.flatMap(x=>x.decisions).reverse(),artifacts:all.flatMap(x=>x.artifacts).reverse()})});
check('the same input in another order gives byte-identical loops',JSON.stringify(il.buildImprovementLoops(base()))===JSON.stringify(il.buildImprovementLoops(shuffled)));
const withDigest=plain(await il.improvementLoops(base())),again=plain(await il.improvementLoops(shuffled));
check('each computed loop has a sha256 inputDigest that does not depend on input order',withDigest.loops.every(l=>/^sha256:[0-9a-f]{64}$/.test(l.inputDigest))&&JSON.stringify(withDigest)===JSON.stringify(again));
check('the sync build leaves inputDigest null',plain(il.buildImprovementLoops(base())).loops.every(l=>l.inputDigest===null));
const changed=plain(await il.improvementLoops(base({reward:moreData})));
check('a new decision inside the loop span changes that loop digest',loopOf(changed,'prompt:e1').inputDigest!==loopOf(withDigest,'prompt:e1').inputDigest);
const later=reward({decisions:[...all.flatMap(x=>x.decisions),dec('zz','other','approved','2026-09-26T03:00:00.000Z')]});
check('a decision after the loop span does not change that loop digest',loopOf(plain(await il.improvementLoops(base({reward:later}))),'prompt:e1').inputDigest===loopOf(withDigest,'prompt:e1').inputDigest);
check('loops are ordered newest activation first',out.loops.length>0&&JSON.stringify(withDigest.loops.map(l=>l.id))===JSON.stringify(['prompt:e4','prompt:e1','prompt:e5','prompt:e6']));
check('loops older than the maximum age are not listed unless closed',!loopOf(plain(il.buildImprovementLoops(base({today:'2027-04-01'}))),'prompt:e1')&&loopOf(plain(il.buildImprovementLoops(base({today:'2027-04-01',closures:[closedE1]}))),'prompt:e1').status==='closed');
check('the span covers all listed loop windows up to today',JSON.stringify(plain(il.loopSpan(cands,TODAY)))==='{"from":"2026-08-06","to":"2026-09-27"}'&&il.loopSpan([],TODAY)===null);

// ── 8) 순수 모듈 import 경계 ──
function edges(file){
 const src=ts.createSourceFile(file,readFileSync(file,'utf8'),ts.ScriptTarget.ES2022,true),out=[];
 const typeOnly=n=>ts.isImportDeclaration(n)?!!n.importClause&&(n.importClause.isTypeOnly||(!n.importClause.name&&!!n.importClause.namedBindings&&ts.isNamedImports(n.importClause.namedBindings)&&n.importClause.namedBindings.elements.length>0&&n.importClause.namedBindings.elements.every(e=>e.isTypeOnly))):ts.isExportDeclaration(n)?n.isTypeOnly:false;
 const visit=n=>{if((ts.isImportDeclaration(n)||ts.isExportDeclaration(n))&&n.moduleSpecifier&&ts.isStringLiteral(n.moduleSpecifier))out.push({spec:n.moduleSpecifier.text,type:typeOnly(n)});if(ts.isCallExpression(n)&&(n.expression.kind===ts.SyntaxKind.ImportKeyword||(ts.isIdentifier(n.expression)&&n.expression.text==='require')))out.push({spec:'<opaque>',type:false});ts.forEachChild(n,visit)};
 visit(src);return out;
}
const target=(from,spec)=>resolve(dirname(from),spec)+'.ts';
const FORBIDDEN=/(^|\/)(server|feature-flags|prompt-registry|quality-[^/]*|eval-[^/]*|franchise-[^/]*|[^/]*-server)\.ts$/;
function runtimeClosure(roots){const seen=new Set(),queue=roots.map(r=>resolve(r));while(queue.length){const f=queue.shift();if(seen.has(f))continue;seen.add(f);for(const e of edges(f))if(!e.type&&e.spec.startsWith('.'))queue.push(target(f,e.spec))}return [...seen]}
const PURE='lib/improvement-loops.ts',ALLOWED=new Set(['./reward-lineage','./store-attribution','./viral-stats','./prompt-registry']);
check('the pure module imports only allowed relative modules',edges(PURE).every(e=>ALLOWED.has(e.spec)));
check('prompt-registry is imported for types only',edges(PURE).filter(e=>e.spec==='./prompt-registry').every(e=>e.type)&&edges(PURE).some(e=>e.spec==='./prompt-registry'));
check('the pure module does not reach server, prompt-registry, feature-flags, quality-*, eval-*, franchise-* at runtime',(c=>c.length>2&&!c.some(f=>FORBIDDEN.test(f)))(runtimeClosure([PURE])));
check('the pure module has no network, clock, storage or model access in source',(s=>!/\bfetch\s*\(|Date\.now|new Date\(\)|Math\.random|database\(|provider|hermes|console\./i.test(s))(readFileSync(PURE,'utf8')));
check('no model or external call was made',calls===0);

console.log(JSON.stringify({passed:passed.length}));
