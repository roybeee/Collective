// A4 점포 실측 화면의 표시 판정(lib/store-operations-view.ts)과 화면·문서·E2E 연결을 확인한다.
// 응답 모양은 서버 계약(lib/store-operations-server.ts measurementAction, tests/store-attribution.test.mjs)을 따른다.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {SourceTextModule,createContext} from 'node:vm';
import ts from 'typescript';
const context=createContext({console}),cache=new Map();
function moduleFor(path){path=resolve(path);if(cache.has(path))return cache.get(path);const m=new SourceTextModule(ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText,{context,identifier:path});cache.set(path,m);return m;}
const m=moduleFor('lib/store-operations-view.ts');await m.link((s,r)=>moduleFor(resolve(dirname(r.identifier),s+'.ts')));await m.evaluate();
const v=m.namespace;
const load=async p=>{const x=moduleFor(p);if(x.status==='unlinked')await x.link((s,r)=>moduleFor(resolve(dirname(r.identifier),s+'.ts')));if(x.status!=='evaluated')await x.evaluate();return x.namespace};
const importer=await load('lib/order-import.ts'),attribution=await load('lib/store-attribution.ts');
let passed=0;
function check(name,actual,expected){assert.deepEqual(JSON.parse(JSON.stringify(actual)),expected,name);passed++}
function throws(name,fn,pattern){assert.throws(fn,pattern,name);passed++}

// --- 자동 귀속 스위치(a4_auto_attribution, 기본 꺼짐) ------------------------------------------
check('the off notice is the agreed wording',v.AUTO_ATTRIBUTION_OFF,'자동 귀속 꺼짐 — 소유자가 기능 스위치에서 켤 수 있음');
check('a missing switch state reads as off',v.autoAttributionNotice(undefined),{on:false,text:v.AUTO_ATTRIBUTION_OFF});
check('false reads as off',v.autoAttributionNotice(false).on,false);
check('true reads as on with the on notice',v.autoAttributionNotice(true),{on:true,text:v.AUTO_ATTRIBUTION_ON});
check('a switch state object is read by its enabled field',[v.autoAttributionNotice({enabled:true,label:'자동 귀속 켜짐'}).on,v.autoAttributionNotice({enabled:false,label:'자동 귀속 꺼짐'}).on],[true,false]);
check('only a real boolean turns it on',[v.autoAttributionNotice('true').on,v.autoAttributionNotice(1).on,v.autoAttributionNotice({enabled:'yes'}).on],[false,false,false]);

// --- CSV 헤더와 열 매핑 ---------------------------------------------------------------------
check('headers keep quoted commas and drop BOM, CRLF and spaces',v.csvHeaders('\uFEFF주문번호, "결제,금액" ,주문일시\r\nA1,100,2026-09-01\r\n'),['주문번호','결제,금액','주문일시']);
check('escaped quotes inside a header are kept',v.csvHeaders('"쿠폰 ""코드""",주문번호\n'),['쿠폰 "코드"','주문번호']);
check('a header-only CSV without a newline is read',v.csvHeaders('orderNumber,orderedAt'),['orderNumber','orderedAt']);
throws('an empty CSV is rejected',()=>v.csvHeaders('  \n'),/첫 줄/);
throws('a blank header is rejected',()=>v.csvHeaders('주문번호,,결제금액\n'),/빈 열 이름/);
check('trailing blank headers are dropped like the server',v.csvHeaders('주문번호,주문일시,결제금액,,\nA1,2026-09-01,100,,\n'),['주문번호','주문일시','결제금액']);
throws('a duplicated header is rejected',()=>v.csvHeaders('주문번호,주문번호\n'),/같은 열 이름/);
throws('an unclosed quote is rejected',()=>v.csvHeaders('"주문번호,결제금액\n'),/따옴표/);
check('import fields follow the server mapping keys',v.importFields.map(f=>f.key),['orderNumber','orderedAt','amount','discount','code','channel','customerId','newCustomer']);
check('only order number, order time and amount are required',v.importFields.filter(f=>f.required).map(f=>f.key),['orderNumber','orderedAt','amount']);
const posHeaders=['주문번호','주문일시','결제금액','할인금액','쿠폰코드','주문채널','회원번호'];
check('common POS headers are guessed like the server suggestion',v.guessMapping(posHeaders),{orderNumber:'주문번호',orderedAt:'주문일시',amount:'결제금액',discount:'할인금액',code:'쿠폰코드',channel:'주문채널',customerId:'회원번호'});
check('other POS spellings are guessed',v.guessMapping(['영수증번호','거래일시','실결제금액','쿠폰번호','적립고객ID','신규고객','메모']),{orderNumber:'영수증번호',orderedAt:'거래일시',amount:'실결제금액',code:'쿠폰번호',customerId:'적립고객ID',newCustomer:'신규고객'});
check('field labels and suggestions come from lib/order-import.ts',[v.importFields.map(f=>f.label).join('|'),JSON.stringify(v.guessMapping(posHeaders))],[Object.values(importer.importFields).join('|'),JSON.stringify(importer.suggestMapping(posHeaders))]);
check('field keys themselves are guessed',v.guessMapping(['orderNumber','orderedAt','amount','code']),{orderNumber:'orderNumber',orderedAt:'orderedAt',amount:'amount',code:'code'});
check('a column is guessed for one field only',Object.values(v.guessMapping(['주문번호','거래번호'])),['주문번호']);
check('nothing is guessed for unknown headers',v.guessMapping(['a','b']),{});
check('a complete mapping has no problems',v.mappingProblems({orderNumber:'A',orderedAt:'B',amount:'C'},['A','B','C']),[]);
check('missing required fields use the server message',v.mappingProblems({orderNumber:'A'},['A']),['필수 열을 연결하세요: 주문 일시, 결제 금액(할인 후)']);
check('one column for two fields is a problem',v.mappingProblems({orderNumber:'A',orderedAt:'B',amount:'B'},['A','B']),["'B' 열을 두 항목에 연결할 수 없습니다."]);
check('a column missing from the CSV is a problem',v.mappingProblems({orderNumber:'A',orderedAt:'B',amount:'Z'},['A','B']),['결제 금액(할인 후)에 연결한 열이 파일에 없습니다.']);
check('unselected fields are not problems',v.mappingProblems({orderNumber:'A',orderedAt:'B',amount:'C',discount:''},['A','B','C']),[]);
check('the sent mapping drops unselected and unknown fields',v.cleanMapping({orderNumber:'A',discount:'',code:'쿠폰',phone:'연락처'}),{orderNumber:'A',code:'쿠폰'});

// --- 가져오기 미리보기(import_orders dryRun) ------------------------------------------------
const off={dryRun:true,ready:3,duplicates:1,identifiableOrders:2,errors:[{line:5,message:'5행: 주문 일시가 미래입니다.'},{line:3,message:'3행: 금액이 음수입니다.'}],autoAttribution:{enabled:false,label:'자동 귀속 꺼짐',attributed:0,conflicts:0,unknownCodes:0,unavailable:0}};
const shown=v.previewView(off);
check('preview cards count ready, duplicate, error and attribution rows',shown.cards,[{label:'저장 가능',value:'3건'},{label:'이미 있음',value:'1건'},{label:'오류 행',value:'2건'},{label:'자동 귀속',value:'0건'},{label:'미귀속',value:'3건'}]);
check('row errors are listed in CSV line order',shown.errors,[{line:3,message:'3행: 금액이 음수입니다.'},{line:5,message:'5행: 주문 일시가 미래입니다.'}]);
check('identifiable customers are counted, never shown',shown.privacy,'고객 식별 열 값이 있는 주문 2건은 원문을 저장하지 않고 건수만 셉니다.');
check('a file with row errors cannot be confirmed',[shown.canConfirm,shown.blocked],[false,'오류 행이 있으면 파일 전체를 저장하지 않습니다. 고친 뒤 다시 미리보기 하세요.']);
const on=v.previewView({dryRun:true,ready:4,duplicates:0,identifiableOrders:0,autoAttribution:{enabled:true,label:'자동 귀속 켜짐',attributed:2,conflicts:1,unknownCodes:1,unavailable:1}});
check('a clean preview can be confirmed with the ready count',[on.canConfirm,on.confirmLabel,on.blocked,on.privacy],[true,'확정 · 4건 저장','',null]);
check('attributed and unattributed rows split the ready rows',on.cards.slice(3),[{label:'자동 귀속',value:'2건'},{label:'미귀속',value:'2건'}]);
check('code conflicts, unknown and unavailable codes are explained',on.codeNotes,'코드 충돌 1건(첫 유효 코드로 귀속) · 등록되지 않은 코드 1건 · 쓸 수 없는 코드 1건(캠페인 삭제 등)');
check('nothing ready cannot be confirmed',v.previewView({ready:0,duplicates:2,identifiableOrders:0}).canConfirm,false);
check('rejected rows in the {row,reason} shape are read too',v.previewView({ready:1,rejected:[{row:2,reason:'x'}]}).errors,[{line:2,message:'x'}]);
check('the full error count wins over the first 50 errors',v.previewView({ready:1,errorCount:73,errors:[{line:2,message:'x'}]}).cards[2].value,'73건');
const sampled=v.previewView({ready:2,sample:[{line:2,orderNumber:'A1',orderDate:'2026-09-21',source:'baemin',mode:'delivery',paidAmount:18000,discountAmount:1000,trackingCodes:['CAB23XYZ','QRB7X9K'],campaignId:'c1',arm:'A',conflict:true},{line:3,orderNumber:'A2',orderDate:'2026-09-21',source:'pos',mode:'hall',paidAmount:12000,discountAmount:0,trackingCodes:[],campaignId:null,arm:null,conflict:false}]},{c1:'오픈 캠페인'});
check('the preview table shows saved values and the attribution per row',sampled.sample,[{line:2,orderNumber:'A1',orderDate:'2026-09-21',route:'배달의민족 · 배달',amount:'18,000원',discount:'1,000원',codes:'CAB23XYZ, QRB7X9K',attribution:'오픈 캠페인 · 팔 A · 코드 충돌'},{line:3,orderNumber:'A2',orderDate:'2026-09-21',route:'POS · 홀',amount:'12,000원',discount:'0원',codes:'없음',attribution:'미귀속'}]);
const twins=v.previewView({ready:2,duplicates:0,identifiableOrders:0,sourceConflicts:2,sourceConflictLines:[2,3]});
check('orders saved under another source are explained before confirming',[twins.sourceConflicts,twins.canConfirm],['출처(주문 채널)만 다른 같은 주문일·주문번호의 주문이 장부에 2건 있습니다(2, 3행). 열 매핑만 바꿔 같은 파일을 다시 올린 것이면 확정하지 마세요.',true]);
check('no different-source orders means no notice',v.previewView({ready:1}).sourceConflicts,null);
check('a malformed preview reads as zero instead of crashing',v.previewView({}).cards.map(c=>c.value),['0건','0건','0건','0건','0건']);

// --- 귀속 보고: 코드·팔·캠페인·채널·출처별 단위경제 ------------------------------------------
check('report sections are code, arm, creative, campaign, channel and source',v.reportSections.map(s=>s.key),['byCode','byArm','byCreative','byCampaign','byChannel','bySource']);
check('channel rows format money and keep unknown as unknown',v.unitRows([{key:'daangn',orders:2,netRevenue:3000,contribution:null,unknownCostOrders:2,estimatedOrders:0,newCustomers:1,spendTotal:600,costPerOrder:300,costPerNewCustomer:600}],{daangn:'당근'}),[{key:'daangn',label:'당근',orders:'2건',netRevenue:'3,000원',contribution:'미확인',contributionNote:'원가 미확인 2건',spend:'600원',newCustomers:'1명',costPerNewCustomer:'600원'}]);
check('estimated contribution is marked',v.unitRows([{key:'c1',orders:2,netRevenue:2000,contribution:1200,unknownCostOrders:0,estimatedOrders:2,newCustomers:null}])[0].contributionNote,'변동비율 추정 2건');
check('rows without spend or customer data say so',v.unitRows([{key:'pos',orders:4,netRevenue:0,contribution:0,newCustomers:null,spendTotal:null}])[0],{key:'pos',label:'pos',orders:'4건',netRevenue:'0원',contribution:'0원',contributionNote:'',spend:'배분 안 함',newCustomers:'미확인',costPerNewCustomer:'미확인'});
check('the unattributed row keeps the server label',v.unitRows([{key:'',label:'미귀속',orders:1,netRevenue:700,contribution:null}],{c1:'오픈 캠페인'})[0].label,'미귀속');
check('a campaign title wins over the server id label',v.unitRows([{key:'c1',label:'c1',orders:1,netRevenue:700,contribution:null}],{c1:'오픈 캠페인'})[0].label,'오픈 캠페인');
check('arm rows are named by campaign title and arm',v.armNames([{key:'c1·A'},{key:'c1·팔 없음'},{key:'c9·B'}],{c1:'오픈 캠페인'}),{'c1·A':'오픈 캠페인 · 팔 A','c1·팔 없음':'오픈 캠페인 · 팔 없음','c9·B':'c9 · 팔 B'});
check('creative rows are named by campaign title and creative',v.creativeNames([{key:'c1·cr1'}],{c1:'오픈 캠페인'}),{'c1·cr1':'오픈 캠페인 · 소재 cr1'});
check('creative rows use the report creative labels (title or fallback) when given',v.creativeNames([{key:'c1·cr1'},{key:'c1·cr2'},{key:'c9·cr3'}],{c1:'오픈 캠페인'},{cr1:'오픈 주소 안내 v1',cr2:'소재 · 9월 23일 00:05 생성 · 주소: 휘경동 377 C107'}),{'c1·cr1':'오픈 캠페인 · 오픈 주소 안내 v1','c1·cr2':'오픈 캠페인 · 소재 · 9월 23일 00:05 생성 · 주소: 휘경동 377 C107','c9·cr3':'c9 · 소재 cr3'});
check('server-shaped arm rows show the campaign title',v.unitRows([{key:'c1·A',label:'c1 · A',orders:1,netRevenue:1,contribution:null}],v.armNames([{key:'c1·A'}],{c1:'오픈 캠페인'}))[0].label,'오픈 캠페인 · 팔 A');
check('the report request sends a variable cost rate only when entered',[v.reportRequest({from:'2026-09-01',to:'2026-09-30',rate:''}),v.reportRequest({from:'2026-09-01',to:'2026-09-30',rate:' 0.4 '})],[{from:'2026-09-01',to:'2026-09-30'},{from:'2026-09-01',to:'2026-09-30',variableCostRate:0.4}]);
check('the contribution basis says when costs are estimated',[v.contributionBasis(null),v.contributionBasis({variableCostRate:0.4})],['원가를 모르면 미확인','원가 없는 주문은 변동비율 0.4로 추정']);
check('a missing list is an empty table',v.unitRows(undefined),[]);

// --- 주 단위 완전성 검사와 north-star -------------------------------------------------------
const weeks=[{weekStart:'2026-09-21',weekEnd:'2026-09-27',status:'pass',ledgerNet:500000,posNet:502000},{weekStart:'2026-09-28',weekEnd:'2026-10-04',status:'missing_pos',ledgerNet:300000,posNet:null},{weekStart:'2026-12-28',status:'fail',ledgerNet:200000,posNet:260000,reason:'장부 합계가 POS 합계와 1% 넘게 다릅니다.'},{weekStart:'2026-09-14',status:'fail',ledgerNet:100,posNet:90}];
check('week rows show pass, missing POS total and the server reason',v.weekRows(weeks).map(w=>[w.label,w.ledger,w.pos,w.status,w.statusLabel]),[
 ['2026-09-21 ~ 09-27','500,000원','502,000원','pass','통과'],
 ['2026-09-28 ~ 10-04','300,000원','미입력','missing_pos','미통과 · POS 합계 미입력'],
 ['2026-12-28 ~ 2027-01-03','200,000원','260,000원','fail','미통과 · 장부 합계가 POS 합계와 1% 넘게 다릅니다.'],
 ['2026-09-14 ~ 09-20','100원','90원','fail','미통과 · 차이 10원'],
]);
check('baseline weeks are marked in the completeness table',v.weekRows([{weekStart:'2026-08-31',status:'pass',ledgerNet:1,posNet:1}],true).map(w=>[w.label,w.baseline]),[['2026-08-31 ~ 09-06 · 기준 주',true]]);
check('report weeks are not baseline weeks',v.weekRows([{weekStart:'2026-08-31',status:'pass',ledgerNet:1,posNet:1}])[0].baseline,false);
check('a week without a POS total never passes',v.weekRows([{weekStart:'2026-09-21',status:'pass',ledgerNet:1,posNet:null}])[0].status,'missing_pos');
check('an unknown week key is shown as is',v.weekLabel('9월 첫째 주'),'9월 첫째 주');
check('completeness summary counts passing weeks for the north-star',v.completenessSummary(weeks),{passed:1,total:4,text:'완전성 통과 1/4주 · 통과한 주만 north-star에 집계합니다.'});
check('no weeks means nothing counted yet',v.completenessSummary([]).text,'완전성 검사할 주가 없습니다. POS 합계를 입력하면 주별로 대조합니다.');
check('north-star shows attributed orders and contribution of passed weeks only',v.northStarView({passedWeeks:2,excludedWeeks:3,attributedOrders:5,attributedContribution:14400,weeks:['2026-08-24','2026-09-14']}),{orders:'5건',contribution:'14,400원',basis:'완전성 통과 2주 기준 · 미통과·미입력 3주 제외'});
check('north-star without data is unknown',v.northStarView(undefined),{orders:'미확인',contribution:'미확인',basis:'완전성 통과 주가 없어 north-star를 집계하지 않았습니다.'});
check('POS totals are offered only for finished weeks, newest first, with the saved version',v.posWeekOptions(weeks.map(w=>w.weekStart==='2026-09-21'?{...w,posVersion:2}:{...w,posVersion:null}),'2026-10-04').map(o=>[o.value,o.label,o.version??null]),[['2026-09-28','2026-09-28 ~ 10-04',null],['2026-09-21','2026-09-21 ~ 09-27',2],['2026-09-14','2026-09-14 ~ 09-20',null]]);
check('the current week is not offered yet',v.posWeekOptions(weeks,'2026-10-03').map(o=>o.value),['2026-09-21','2026-09-14']);

// --- incrementality-lite ------------------------------------------------------------------
check('the not-incremental warning is the server wording',v.NOT_INCREMENTAL,attribution.ATTRIBUTION_NOT_INCREMENTAL);
check('the warning says attribution is not incrementality',v.NOT_INCREMENTAL.startsWith('귀속≠증분'),true);
const inc={baseline:{average:10,weeks:['a','b','c','d']},campaign:{average:15,weeks:['e','f']},change:5,changeRate:0.5,excluded:['g'],disclaimer:'귀속≠증분: 서버 문구',warnings:['기준 주 1주를 뺐습니다.','귀속 주문 12건이 증가분보다 많습니다.']};
check('incrementality card shows order averages, change and every warning after the fixed one',v.incrementalityView(inc),{metric:'주 평균 주문 수',baseline:'10건',campaign:'15건',baselineWeeks:'기준 4주',campaignWeeks:'캠페인 2주',change:'+5건 (+50.0%)',warnings:[v.NOT_INCREMENTAL,'귀속≠증분: 서버 문구','기준 주 1주를 뺐습니다.','귀속 주문 12건이 증가분보다 많습니다.']});
check('a revenue metric is shown in won and a drop is signed',(({metric,baseline,change})=>[metric,baseline,change])(v.incrementalityView({metric:'netRevenue',baseline:{average:400000,weeks:['a']},campaign:{average:380000,weeks:['b']},change:-20000,changeRate:-0.05})),['주 평균 순매출','400,000원','-20,000원 (-5.0%)']);
check('fractional order averages keep one decimal',v.incrementalityView({baseline:{average:10.25,weeks:[]},campaign:{average:null,weeks:[]},change:null,changeRate:null}).baseline,'10.3건');
check('the warning is always present even without a report',v.incrementalityView(undefined),{metric:'주 평균 주문 수',baseline:'미확인',campaign:'미확인',baselineWeeks:'기준 0주',campaignWeeks:'캠페인 0주',change:'미확인',warnings:[v.NOT_INCREMENTAL]});
check('repeated warnings and notes are shown once',v.incrementalityView({disclaimer:v.NOT_INCREMENTAL,warnings:['a','a']},['a','b']).warnings,[v.NOT_INCREMENTAL,'a','b']);

// --- 추적 코드 ------------------------------------------------------------------------------
check('tracking code types come from lib/tracking-codes.ts',Object.keys(v.trackingCodeTypes),['coupon','qr','pos_tag','utm']);
check('a complete code form has no problems',v.trackingCodeProblems({type:'coupon',campaignId:'c1',label:'오픈 쿠폰',utmCampaign:''}),[]);
check('campaign, name and type are required',v.trackingCodeProblems({type:'fax',campaignId:'',label:' ',utmCampaign:''}),['추적 코드 종류를 고르세요.','캠페인을 고르세요.','코드 이름을 입력하세요.']);
check('a UTM code needs a utm_campaign slug',v.trackingCodeProblems({type:'utm',campaignId:'c1',label:'링크',utmCampaign:'bad value'}),['utm_campaign은 영문 소문자·숫자·_ . - 로 60자 이하입니다.']);
check('a UTM code copies its link query',v.trackingCopyText({code:'U7K9P2XA',type:'utm',utmCampaign:'open_week'}),'utm_campaign=open_week&utm_content=U7K9P2XA');
check('other codes copy the code itself',v.trackingCopyText({code:'CAB23XYZ',type:'coupon'}),'CAB23XYZ');

// --- 화면 연결(원문 검사) ------------------------------------------------------------------
const panel=readFileSync('app/store-operations-panel.tsx','utf8');
const has=(name,text)=>{assert.ok(panel.includes(text),name);passed++};
has('the panel uses the view module',"from '@/lib/store-operations-view'");
for(const tab of ['추적 코드','주문 가져오기','귀속 보고'])has(`the ${tab} tab exists`,`>${tab}</TabsTrigger>`);
has('the import tab is only for managers','{canManage&&<TabsTrigger value="import">');
has('the switch notice comes from the view','autoAttributionNotice(');
has('codes and the switch state are read with the list action',"post('list'");
has('the import previews before saving','dryRun:true');
has('the import saves only on confirm','dryRun:false');
has('the report card renders every warning','incrementalityView(');
has('the north-star comes from the view','northStarView(');
has('the report asks for weekly POS totals',"post('set_pos_total'");
has('tracking codes are created through the store operations API',"post('create_tracking_code'");
has('code creation is only offered to managers','{canManage&&<form className="form-stack" aria-label="추적 코드 만들기"');
has('POS totals are only offered to managers','{canManage&&<PosTotalForm');
has('the ledger-form import stays for every role',"post('import_orders',{storeId:store.id,rows})");
has('the ledger-form template download stays','orderCsvTemplate');
has('the POS import button opens the manager tab','POS CSV 가져오기');
has('the import asks to confirm different-source orders','allowSourceConflicts');
has('the report sends the period through reportRequest','reportRequest(');
has('the report form asks for a variable cost rate','변동비율');
has('baseline weeks are offered for POS totals','report.baselineWeeks');
has('arm and creative rows get campaign titles','armNames(');
has('creative rows are named by the view module with the report labels','creativeNames(report?.byCreative,titles,report?.creativeLabels)');
has('the import asks to confirm orders of publications not confirmed yet','allowPendingPublications');

const spec=readFileSync('e2e/store-measurement.spec.ts','utf8');
assert.ok(!spec.includes('route.fetch')&&!spec.includes('page.route'),'the E2E spec never intercepts requests (docs/E2E.ko.md)');passed++;
assert.ok(spec.includes("'a4_auto_attribution'"),'the E2E spec turns the switch on through the owner API');passed++;
assert.ok(spec.includes('dryRun'),'the E2E spec previews the CSV');passed++;

const doc=readFileSync('docs/STORE-MEASUREMENT.ko.md','utf8');
for(const heading of ['## 수동 추적 프로토콜','## CSV 열 규격','## 개인정보 원칙','## 완전성 검사와 north-star','## incrementality-lite의 한계']){assert.ok(doc.includes(heading),'doc has '+heading);passed++}
assert.ok(doc.includes('결정 13'),'the manual protocol follows decision 13');passed++;
assert.ok(doc.includes('a4_auto_attribution'),'the doc names the switch');passed++;
for(const f of v.importFields){assert.ok(doc.includes('`'+f.key+'`'),'the CSV spec documents '+f.key);passed++}
assert.ok(doc.includes(v.NOT_INCREMENTAL),'the doc uses the same not-incremental wording');passed++;
assert.ok(doc.includes(importer.IMPORT_LIMITS.maxRows.toLocaleString('ko-KR')+'행'),'the doc states the import row limit of lib/order-import.ts');passed++;

console.log(JSON.stringify({passed}));
