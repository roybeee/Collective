// B2 판정 보정 κ(lib/quality-kappa.ts) 회귀. 교과서 예시(Cohen's κ 2×2·3×3)와 단일 범주·n<20·needs_data 묶기·중복 단위를 고정한다.
// 기대값은 python fractions로 계산한 정확값이다: κ=(po-pe)/(1-pe), pe=Σ_k p_사람(k)·p_AI(k). 합성 데이터만 쓰고 LLM·네트워크 호출은 0이다(mocked: fetch 스텁).
// κ 단위는 B1 criterionUnits(lib/review-decisions-server.ts)와 같아야 한다: 같은 판정을 실제 SQLite에 넣고 unitsFromDecisions와 비교한다.
import assert from 'node:assert/strict';
import {testRuntime} from './helpers/runtime.mjs';

let fetchCalls=0;
const rt=testRuntime(async()=>{fetchCalls++;throw new Error('외부 호출 금지')});
const qk=await rt.load('lib/quality-kappa.ts'),store=await rt.load('lib/review-decisions-server.ts'),{qualityCriteria}=await rt.load('lib/quality.ts');
const plain=v=>JSON.parse(JSON.stringify(v));
let passed=0;
const check=(name,ok)=>{assert.ok(ok,name);passed++};
const near=(a,b)=>typeof a==='number'&&Math.abs(a-b)<1e-12;
// 행 = 사람 범주, 열 = AI 범주. 칸의 수만큼 쌍을 만든다.
const pairsOf=(labels,matrix)=>matrix.flatMap((row,i)=>row.flatMap((count,j)=>Array.from({length:count},()=>({human:labels[i],ai:labels[j]}))));
const transpose=m=>m[0].map((_,j)=>m.map(r=>r[j]));

// 1) 교과서 예시
const textbook=[
 ['Cohen 2x2 (Wikipedia: 20/5/10/15)',['yes','no'],[[20,5],[10,15]],0.7,2/5],
 ['same agreement, lower kappa (45/15/25/15)',['yes','no'],[[45,15],[25,15]],0.6,3/23],
 ['same agreement, higher kappa (25/35/5/35)',['yes','no'],[[25,35],[5,35]],0.6,7/27],
 ['3x3 table (44/5/1, 7/20/3, 9/5/6)',['a','b','c'],[[44,5,1],[7,20,3],[9,5,6]],0.7,29/59],
];
for(const [name,labels,m,po,kappa] of textbook){
 const r=qk.cohenKappa(pairsOf(labels,m)),n=m.flat().reduce((s,x)=>s+x,0);
 check(`${name}: kappa ${kappa}`,near(r.kappa,kappa)&&near(r.agreement,po)&&r.n===n&&r.reason===undefined);
 check(`${name}: swapping raters keeps kappa`,near(qk.cohenKappa(pairsOf(labels,transpose(m))).kappa,kappa));
}
check('a category only one rater uses is handled (2 human x 3 AI categories)',near(qk.cohenKappa(pairsOf(['pass','revise','needs_data'],[[10,2,3],[2,5,3],[0,0,0]])).kappa,1/3));
check('perfect agreement over two categories is 1',qk.cohenKappa(pairsOf(['pass','revise'],[[5,0],[0,5]])).kappa===1);
check('complete disagreement with one category each is 0, not undefined',qk.cohenKappa(pairsOf(['pass','revise'],[[0,6],[0,0]])).kappa===0);
const single=qk.cohenKappa(pairsOf(['pass'],[[30]]));
check('only one category overall: kappa undefined, agreement shown',single.kappa===null&&single.agreement===1&&single.n===30&&single.reason==='single_category');
const none=qk.cohenKappa([]);
check('no pairs: no data',none.kappa===null&&none.agreement===null&&none.n===0&&none.reason==='no_data');
check('cohenKappa does not mutate its input',(()=>{const p=Object.freeze(pairsOf(['yes','no'],[[2,1],[1,2]]).map(Object.freeze));qk.cohenKappa(p);return true})());

// 2) 기준별 κ(5기준, n<20은 보정 불가, needs_data는 revise로 묶음, AI 상태 없음은 제외, 같은 단위는 마지막 판정)
let seq=0;
const unit=(criterion,human,ai,artifactId=`x${++seq}`,version=1)=>({criterion,human,ai,artifactId,version,decisionId:'d'+seq,actorId:'actor-secret',createdAt:'2026-09-22T03:00:00.000Z'});
const cells=(criterion,list)=>list.flatMap(([human,ai,count])=>Array.from({length:count},()=>unit(criterion,human,ai)));
const units=[
 ...cells('evidence',[['pass','pass',12],['pass','revise',2],['pass','needs_data',1],['revise','pass',3],['revise','revise',5],['revise','needs_data',2],['revise',null,2]]),
 unit('evidence','revise','revise','dup',1),unit('evidence','pass','pass','dup',1),
 ...cells('brand',[['pass','pass',4]]),
 ...cells('execution',[['pass','pass',10],['revise','revise',5],['pass','revise',4]]),
 ...cells('economics',[['pass','pass',20]]),
];
const rows=plain(qk.criterionKappa(units)),by=Object.fromEntries(rows.map(r=>[r.criterion,r]));
check('five rows in quality criteria order with B1 labels',rows.map(r=>r.criterion).join()===Object.keys(qualityCriteria).join()&&rows.every(r=>r.label===qualityCriteria[r.criterion]));
// 기본 κ는 원 범주(사람 pass·revise × AI pass·revise·needs_data, 2×3)다. python fractions: po=9/13, κ=71/175. needs_data를 revise로 묶은 값은 보조 열(po=10/13, κ=41/80)이다.
check('evidence: 26 labelled units (last judgement of a duplicate, AI status missing excluded)',by.evidence.n===26&&by.evidence.status==='ok'&&by.evidence.missingAi===2&&by.evidence.aiNeedsData===3);
check('evidence kappa is on the raw 2x3 categories (needs_data is a disagreement)',near(by.evidence.kappa,71/175)&&near(by.evidence.agreement,9/13));
const raw=qk.cohenKappa([...pairsOf(['pass','revise','needs_data'],[[12,2,1],[3,5,2],[0,0,0]]),{human:'pass',ai:'pass'}]);
check('evidence kappa equals cohenKappa on the same raw pairs',near(by.evidence.kappa,raw.kappa)&&near(by.evidence.agreement,raw.agreement)&&raw.n===26);
const ev=qk.cohenKappa([...pairsOf(['pass','revise'],[[12,3],[3,7]]),{human:'pass',ai:'pass'}]);
check('the collapsed kappa (needs_data as revise) is reported next to it',near(by.evidence.kappaCollapsed,41/80)&&near(by.evidence.kappaCollapsed,ev.kappa)&&near(by.evidence.agreementCollapsed,10/13));
check('evidence 2x3 table (human pass·revise × AI pass·revise·needs_data)',JSON.stringify(by.evidence.table)===JSON.stringify([{human:'pass',ai:'pass',count:13},{human:'pass',ai:'revise',count:2},{human:'pass',ai:'needs_data',count:1},{human:'revise',ai:'pass',count:3},{human:'revise',ai:'revise',count:5},{human:'revise',ai:'needs_data',count:2}]));
check('a duplicate unit keeps the last human judgement only',by.evidence.table[0].count===13&&by.evidence.table[4].count===5);
const nd=qk.criterionKappa(cells('measurement',[['revise','revise',10],['revise','needs_data',10]])).find(r=>r.criterion==='measurement');
check('human revise vs AI revise·needs_data: raw kappa defined, collapsed single category withheld',nd.status==='ok'&&nd.kappa===0&&nd.agreement===0.5&&nd.kappaCollapsed===null&&nd.agreementCollapsed===1);
check('n<5: no agreement rate, no kappa, insufficient with the labels still needed',by.brand.n===4&&by.brand.agreement===null&&by.brand.kappa===null&&by.brand.status==='insufficient'&&by.brand.needed===16);
check('5<=n<20: agreement shown, kappa withheld as insufficient',by.execution.n===19&&near(by.execution.agreement,15/19)&&by.execution.kappa===null&&by.execution.status==='insufficient'&&by.execution.needed===1);
check('n>=20 with one category: kappa undefined',by.economics.n===20&&by.economics.kappa===null&&by.economics.agreement===1&&by.economics.status==='single_category'&&by.economics.needed===0);
check('no labels: no data',by.measurement.n===0&&by.measurement.status==='no_data'&&by.measurement.kappa===null&&by.measurement.agreement===null&&by.measurement.needed===20);
check('the minimum label count is 20',qk.MIN_KAPPA_N===20);
check('kappa rows carry no actor id',!JSON.stringify(rows).includes('actor-secret'));
const at20=qk.criterionKappa(cells('measurement',[['pass','pass',10],['revise','revise',6],['pass','revise',2],['revise','pass',2]]));
check('exactly 20 labels are enough',at20.find(r=>r.criterion==='measurement').status==='ok'&&near(at20.find(r=>r.criterion==='measurement').kappa,qk.cohenKappa(pairsOf(['pass','revise'],[[10,2],[2,6]])).kappa));

// 3) 해석 구간(Landis & Koch 1977 관례)
check('kappa bands',[[-0.1,'우연보다 낮은 일치'],[0,'미미한 일치'],[0.2,'미미한 일치'],[0.3,'약한 일치'],[0.5,'보통 일치'],[0.7,'상당한 일치'],[0.81,'거의 완전한 일치'],[1,'거의 완전한 일치']].every(([k,label])=>qk.kappaBand(k)===label));

// 4) 교차 검증: 판정을 실제 SQLite에 넣고 B1 criterionUnits와 같은 단위인지 본다.
const O='workspace';
const decision=(id,targetId,version,criteria,extra={})=>({id,targetKind:'artifact',targetId,version,role:'quality',decision:'revision',reasonCodes:['evidence'],actor:{id:'actor-'+id,role:'owner'},promptVersion:null,skillVersion:'sv1',outputContractVersion:null,campaignId:'c1',brandId:null,origin:'ai',...(criteria?{criteria}:{}),reasonsVersion:'review-reasons-v1',createdAt:`2026-09-2${id.length}T03:00:00.000Z`,...extra});
const decisions=[
 decision('q1','qa1',1,[{criterion:'evidence',human:'revise',ai:'pass'},{criterion:'brand',human:'pass',ai:null}]),
 decision('b1','brief-1',1,undefined,{targetKind:'brief_suggestion',role:null,decision:'edited'}),
 decision('q22','qa1',2,[{criterion:'evidence',human:'pass',ai:'needs_data'}]),
 decision('c333','cm1',1,undefined,{role:'cmo'}),
];
for(const d of decisions)rt.sql.prepare('INSERT INTO records(id,owner,kind,parent_id,data,updated_at) VALUES(?,?,?,?,?,?)').run(`${O}:review_decision:${d.id}`,O,'review_decision','',JSON.stringify(d),d.createdAt);
const b1=plain(await store.criterionUnits(O)),mine=plain(qk.unitsFromDecisions(decisions));
check('pure units equal B1 criterionUnits (same order and fields)',JSON.stringify(mine)===JSON.stringify(b1)&&b1.length===3);
check('B1 units feed criterionKappa directly',plain(qk.criterionKappa(b1)).find(r=>r.criterion==='evidence').n===2);
check('no external calls',fetchCalls===0);

console.log(JSON.stringify({passed}));
