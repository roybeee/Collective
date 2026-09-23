// A4 점포 실측 루프 회귀: 자동 귀속 규칙·집계·단위경제·주간 완전성·north-star·incrementality-lite(순수),
// 그리고 서버 연결(코드 생성·주문 CSV 미리보기/확정·POS 주간 합계·귀속 보고서, 기능 스위치 끔/켬, 권한 403, 개인정보 거부, 멱등).
// 근거: mocked(메모리 SQLite, 로컬 인증 헤더·세션 주입). 외부 네트워크 호출은 0회다.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {testRuntime} from './helpers/runtime.mjs';

const rt=testRuntime(async()=>{throw new Error('외부 호출 금지')});
const {sql,env}=rt;
const sa=await rt.load('lib/store-attribution.ts');
const passed=[];const check=(name,val)=>{assert.ok(val,name);passed.push(name)};
const plain=x=>JSON.parse(JSON.stringify(x));
const unknownCosts={foodCost:null,packagingCost:null,fees:null,deliveryCost:null,benefitCost:null};
let seq=0;
const order=(over={})=>({id:'o'+(++seq),storeId:'s1',source:'pos',orderNumber:'n'+seq,orderDate:'2026-09-15',mode:'hall',status:'paid',paidAmount:1000,refundAmount:0,costs:unknownCosts,channel:'unknown',experimentId:'',attributionEvidence:'',note:'',version:1,createdAt:'x',updatedAt:'x',...over});

// 1) 자동 귀속 규칙: 첫 유효 코드, 다른 대상을 가리키는 코드가 함께 있으면 충돌 표시
const code=(c,over={})=>({id:c,code:c,type:'coupon',storeId:'s1',campaignId:'c1',label:'',validFrom:'2026-09-01',createdAt:'x',createdBy:{id:'u',email:null},version:1,...over});
const codes=[code('AB23',{arm:'A'}),code('CD45',{arm:'B'}),code('EF67',{arm:'A'}),code('GH89',{storeId:'s2'}),code('JK23',{validFrom:'2026-09-20'})];
const attr=tokens=>plain(sa.attributeByCodes(tokens.map(c=>({code:c})),codes,{storeId:'s1',orderDate:'2026-09-15'}));
let r=attr(['AB23','CD45']);
check('first valid code wins and a different target is a conflict',r.code.id==='AB23'&&r.conflict===true&&r.matched.join()==='AB23,CD45');
r=attr(['AB23','EF67']);
check('codes pointing at the same target are not a conflict',r.code.id==='AB23'&&r.conflict===false);
r=attr(['GH89','CD45']);
check('another store code is skipped and the next valid code wins',r.code.id==='CD45'&&r.skipped.join()==='GH89'&&r.conflict===false);
r=attr(['JK23']);
check('a code is not valid before its start date',r.code===null&&r.skipped.join()==='JK23');
r=attr(['ZZZZ','AB23']);
check('unknown codes are listed and do not block a later match',r.code.id==='AB23'&&r.unknown.join()==='ZZZZ');
check('no tokens means no attribution',attr([]).code===null&&attr([]).conflict===false);

// 2) 지표: 주문 수·순매출·공헌이익(원가가 모두 있거나 경제성 입력이 있을 때)·신규 고객
const known={foodCost:300,packagingCost:0,fees:100,deliveryCost:0,benefitCost:0};
const trio=[order({costs:known}),order(),order({status:'cancelled',paidAmount:0})];
let m=plain(sa.orderMetrics(trio));
check('cancelled orders are records but not orders',m.records===3&&m.orders===2&&m.netRevenue===2000);
check('unknown costs leave contribution empty',m.contribution===null&&m.unknownCostOrders===2&&m.estimatedOrders===0);
m=plain(sa.orderMetrics(trio,{variableCostRate:0.4}));
check('economics input estimates contribution for orders without costs',m.contribution===1200&&m.estimatedOrders===2&&m.unknownCostOrders===0);
check('new customers need a flag on every counted order',plain(sa.orderMetrics([order({newCustomer:true}),order()])).newCustomers===null&&plain(sa.orderMetrics([order({newCustomer:true}),order({newCustomer:false})])).newCustomers===1);

// 3) 코드·팔·캠페인별 집계
const ca=(codeId,arm)=>({codeId,code:codeId,arm,conflictCodeIds:[]});
const mix=[order({campaignId:'c1',creativeId:'cr1',channel:'daangn',paidAmount:1000,codeAttribution:ca('AB23','A'),newCustomer:true}),order({campaignId:'c1',channel:'daangn',paidAmount:2000,codeAttribution:ca('CD45','B'),newCustomer:false}),order({campaignId:'c2',channel:'social',attributionEvidence:'직원 확인',paidAmount:500}),order({paidAmount:700})];
const br=plain(sa.attributionBreakdown(mix,codes));
const find=(list,key)=>list.find(g=>g.key===key);
check('by code sums only code-attributed orders',br.byCode.length===2&&find(br.byCode,'AB23').netRevenue===1000&&find(br.byCode,'CD45').orders===1);
check('by arm groups campaign and arm',find(br.byArm,'c1·A').orders===1&&find(br.byArm,'c1·B').netRevenue===2000);
check('by campaign includes manual attribution and the unattributed rest',find(br.byCampaign,'c1').orders===2&&find(br.byCampaign,'c2').netRevenue===500&&find(br.byCampaign,'').netRevenue===700&&find(br.byCampaign,'').label==='미귀속');
check('by creative groups orders with a creative under their campaign',br.byCreative.length===1&&find(br.byCreative,'c1·cr1').orders===1&&find(br.byCreative,'c1·cr1').netRevenue===1000);
const spend=[{id:'sp1',storeId:'s1',date:'2026-09-15',channel:'daangn',experimentId:'',adSpend:600,productionCost:0,source:'당근 광고',version:1,createdAt:'x',updatedAt:'x'},{id:'sp2',storeId:'s1',date:'2026-09-15',channel:'blog',experimentId:'',adSpend:200,productionCost:100,source:'협찬',version:1,createdAt:'x',updatedAt:'x'}];
const ue=plain(sa.unitEconomics(mix,spend));
const daangn=find(ue.byChannel,'daangn'),blog=find(ue.byChannel,'blog');
check('channel economics join spend of the same channel',daangn.orders===2&&daangn.netRevenue===3000&&daangn.spendTotal===600&&daangn.costPerOrder===300&&daangn.revenuePerSpend===5);
check('cost per new customer uses flagged new customers',daangn.newCustomers===1&&daangn.costPerNewCustomer===600);
check('spend without orders is still shown',blog.orders===0&&blog.spendTotal===300&&blog.costPerOrder===null);
check('unknown channel carries no spend',find(ue.byChannel,'unknown').spendTotal===0&&find(ue.byChannel,'unknown').costPerNewCustomer===null);
check('order source groups have no spend',find(ue.bySource,'pos').orders===4&&find(ue.bySource,'pos').spendTotal===null);

// 4) 주 계산(월요일 시작)
check('week starts on Monday',sa.weekStart('2026-09-24')==='2026-09-21'&&sa.weekStart('2026-09-21')==='2026-09-21'&&sa.weekStart('2026-09-27')==='2026-09-21'&&sa.weekStart('2026-01-01')==='2025-12-29');
check('days are added on the calendar',sa.addDays('2026-09-21',6)==='2026-09-27'&&sa.addDays('2026-03-01',-1)==='2026-02-28');
check('weeks between two dates cover partial weeks',plain(sa.weeksBetween('2026-09-10','2026-09-24')).join()==='2026-09-07,2026-09-14,2026-09-21'&&plain(sa.weeksBetween('2026-09-24','2026-09-10')).length===0);

// 5) 주간 완전성: 장부 합계 vs POS 합계, 허용 오차 1%
const pos=(weekStart,netSales,orderCount=null)=>({id:'s1-'+weekStart,storeId:'s1',weekStart,netSales,orderCount,source:'POS',note:'',version:1,createdAt:'x',updatedAt:'x',updatedBy:{id:'u',email:null}});
const weekOrders=[order({orderDate:'2026-08-25',paidAmount:4000,campaignId:'c1',attributionEvidence:'코드',codeAttribution:ca('AB23','A')}),order({orderDate:'2026-08-27',paidAmount:6000}),order({orderDate:'2026-09-01',paidAmount:10000}),order({orderDate:'2026-09-08',paidAmount:5000}),order({orderDate:'2026-09-22',paidAmount:3000})];
const weeks=['2026-08-24','2026-08-31','2026-09-07','2026-09-14','2026-09-21'];
const checks=plain(sa.weeklyCompleteness(weeks,weekOrders,[pos('2026-08-24',10090,2),pos('2026-08-31',10200),pos('2026-09-14',0,0),pos('2026-09-21',3000,2)]));
const wk=w=>checks.find(c=>c.weekStart===w);
check('within 1% of the POS total passes',wk('2026-08-24').status==='pass'&&wk('2026-08-24').ledgerNet===10000&&wk('2026-08-24').weekEnd==='2026-08-30');
check('more than 1% off the POS total fails',wk('2026-08-31').status==='fail'&&/1%/.test(wk('2026-08-31').reason));
check('a week without a POS total is not verified',wk('2026-09-07').status==='missing_pos'&&wk('2026-09-07').posNet===null);
check('an empty week with a zero POS total passes',wk('2026-09-14').status==='pass');
check('an order count off the POS count fails',wk('2026-09-21').status==='fail'&&/주문 수/.test(wk('2026-09-21').reason));
check('each week carries the POS total version for corrections',wk('2026-08-24').posVersion===1&&wk('2026-09-07').posVersion===null);
check('attributed orders are counted per week',wk('2026-08-24').attributedOrders===1&&wk('2026-08-24').attributedContribution===null);
const ns=plain(sa.northStar(checks));
check('north-star counts only weeks that passed completeness',ns.passedWeeks===2&&ns.excludedWeeks===3&&ns.attributedOrders===1&&ns.weeks.join()==='2026-08-24,2026-09-14');
const nsEst=plain(sa.northStar(plain(sa.weeklyCompleteness(weeks,weekOrders,[pos('2026-08-24',10000)],{variableCostRate:0.5}))));
check('north-star contribution uses the economics input',nsEst.attributedContribution===2000);

// 6) incrementality-lite: 기준 주 평균 대비 캠페인 주 변화, 귀속≠증분
const w=(weekStart,ledgerOrders,status='pass',attributedOrders=0)=>({weekStart,status,ledgerOrders,ledgerNet:ledgerOrders*1000,attributedOrders});
const inc=plain(sa.incrementalityLite([w('2026-08-03',10),w('2026-08-10',12),w('2026-08-17',8),w('2026-08-24',10),w('2026-08-31',30,'fail'),w('2026-09-07',14,'pass',7),w('2026-09-14',16,'pass',5)],['2026-08-03','2026-08-10','2026-08-17','2026-08-24','2026-08-31'],['2026-09-07','2026-09-14']));
check('baseline and campaign averages use passed weeks only',inc.baseline.average===10&&inc.baseline.weeks.length===4&&inc.campaign.average===15&&inc.excluded.join()==='2026-08-31');
check('change is reported against the baseline average',inc.change===5&&inc.changeRate===0.5);
check('attribution is never called incrementality',inc.disclaimer===sa.ATTRIBUTION_NOT_INCREMENTAL&&inc.disclaimer.includes('귀속≠증분'));
check('more attributed orders than the increase is warned',inc.warnings.some(x=>/귀속 주문 12건/.test(x)));
check('excluded weeks are warned',inc.warnings.some(x=>/1주/.test(x)&&/뺐/.test(x)));
const thin=plain(sa.incrementalityLite([w('2026-08-24',10),w('2026-09-07',12)],['2026-08-24'],['2026-09-07'],'netRevenue'));
check('a single baseline week is warned',thin.warnings.some(x=>/기준 주가 2주 미만/.test(x))&&thin.change===2000);
const none=plain(sa.incrementalityLite([w('2026-08-24',10,'fail')],['2026-08-24'],['2026-09-07']));
check('no comparable weeks gives no change',none.change===null&&none.changeRate===null);

// 7) 서버 연결
const server=await rt.load('lib/server.ts'),ops=await rt.load('lib/store-operations-server.ts'),flags=await rt.load('lib/feature-flags.ts'),logic=await rt.load('lib/store-operations.ts'),tc=await rt.load('lib/tracking-codes.ts');
const owner='a4-owner-production-authenticated-id';
const save=(kind,id,data,parent='')=>server.recordStatement(owner,kind,id,data,parent).run();
const store={id:'s1',brandId:'oda',name:'지점',status:'active',version:1};
await save('store','s1',store,'oda');
await save('campaign','c1',{id:'c1',brandId:'oda',storeId:'s1'});
await save('campaign','c2',{id:'c2',brandId:'ofd'});
await save('campaign','c3',{id:'c3',brandId:'oda'});
await save('execution_creative','cr1',{id:'cr1',campaignId:'c1',brandId:'oda',storeId:'s1',version:1},'c1');
await save('execution_publication','p1',{id:'p1',campaignId:'c1',creativeId:'cr1',status:'published'},'c1');
const legacyReq=()=>new Request('https://agency.test/api/store-operations',{method:'POST',headers:{'oai-authenticated-user-id':owner}});
const act=async(b,request=legacyReq())=>{try{return {status:200,body:plain(await ops.measurementAction(request,owner,store,b))}}catch(e){if(typeof e?.status==='number')return {status:e.status,error:e.message};throw e}};
const today=logic.koreaToday(),W=sa.addDays(sa.weekStart(today),-7),day=n=>sa.addDays(W,n),since=sa.addDays(W,-28);
const orderCount=()=>sql.prepare("SELECT COUNT(*) n FROM records WHERE owner=? AND kind='store_order'").get(owner).n;
const orderBy=number=>JSON.parse(sql.prepare("SELECT data FROM records WHERE owner=? AND kind='store_order' AND json_extract(data,'$.orderNumber')=?").get(owner,number).data);

check('measurement actions are recognised without taking over legacy row imports',ops.isMeasurementAction({action:'create_tracking_code'})&&ops.isMeasurementAction({action:'import_orders',csv:'a'})&&!ops.isMeasurementAction({action:'import_orders',rows:[]})&&!ops.isMeasurementAction({action:'save_order'}));

// 7-1) 추적 코드 생성
let res=await act({action:'create_tracking_code',type:'coupon',campaignId:'c1',creativeId:'cr1',arm:'A',channel:'daangn',label:'당근 쿠폰 A',validFrom:since});
const codeA=res.body?.code?.code;
check('a coupon code is generated in the code format',res.status===200&&tc.isValidCode(codeA)&&codeA[0]==='C'&&res.body.code.storeId==='s1'&&res.body.code.createdBy.id===owner);
check('the code is stored under the store',sql.prepare('SELECT parent_id p FROM records WHERE id=?').get(`${owner}:tracking_code:${codeA}`)?.p==='s1');
res=await act({action:'create_tracking_code',type:'qr',campaignId:'c1',arm:'B',code:'qrb-7x9k',validFrom:since});
check('a custom code is normalised',res.status===200&&res.body.code.code==='QRB7X9K'&&res.body.code.type==='qr');
check('a code already in use is a 409',(await act({action:'create_tracking_code',type:'coupon',campaignId:'c1',code:'QRB 7X9K'})).status===409);
check('a custom code with confusable characters is a 400',(await act({action:'create_tracking_code',type:'coupon',campaignId:'c1',code:'OPEN10'})).status===400);
check('another brand campaign is a 400',(await act({action:'create_tracking_code',type:'coupon',campaignId:'c2'})).status===400);
check('a missing campaign is a 404',(await act({action:'create_tracking_code',type:'coupon',campaignId:'nope'})).status===404);
check('a utm code needs utm_campaign',(await act({action:'create_tracking_code',type:'utm',campaignId:'c1'})).status===400);
res=await act({action:'create_tracking_code',type:'utm',campaignId:'c1',utmCampaign:'Open_Week'});
check('a utm code keeps its campaign slug',res.status===200&&res.body.code.utmCampaign==='open_week'&&res.body.code.code[0]==='U');
// 게시(publication) 연결(A4-2): 게시는 같은 캠페인·같은 소재여야 한다. 게시 상태·예약일은 코드를 만들 때가 아니라 귀속할 때 본다(tests/store-publication-codes.test.mjs).
res=await act({action:'create_tracking_code',type:'pos_tag',campaignId:'c3',publicationId:'p1'});
check('a publication of another campaign is refused',res.status===400&&/게시/.test(res.error));
check('a missing publication is a 404',(await act({action:'create_tracking_code',type:'pos_tag',campaignId:'c1',publicationId:'p-none'})).status===404);
res=await act({action:'create_tracking_code',type:'pos_tag',campaignId:'c1',creativeId:'cr1'});
check('a POS tag code is linked to its campaign and creative',res.status===200&&res.body.code.code[0]==='P'&&res.body.code.creativeId==='cr1'&&!('publicationId' in res.body.code));
check('an unknown code type is refused',(await act({action:'create_tracking_code',type:'sms',campaignId:'c1'})).status===400);
res=await act({action:'create_tracking_code',type:'coupon',campaignId:'c3',code:'GNEX2345',validFrom:since});
check('a brand-wide campaign code is allowed',res.status===200);
res=await act({action:'list'});
check('list shows codes and that auto attribution is off',res.status===200&&res.body.codes.length===5&&res.body.autoAttribution===false&&res.body.autoAttributionLabel==='자동 귀속 꺼짐');

// 7-2) 주문 CSV: 스위치 꺼짐 → 미귀속으로 저장(끄기 테스트)
const header='주문번호,주문일시,결제금액,할인금액,쿠폰코드,주문채널,회원번호';
const mapping={orderNumber:'주문번호',orderedAt:'주문일시',amount:'결제금액',discount:'할인금액',code:'쿠폰코드',channel:'주문채널',customerId:'회원번호'};
const csvOff=[header,`R1,${day(0)} 12:00,10000,1000,${codeA},,member-4455`,`R2,${day(1)} 13:00,20000,0,"${codeA};QRB7X9K",,`,`R3,${day(2)},5000,0,,,`].join('\n');
res=await act({action:'import_orders',csv:csvOff,mapping});
check('preview is the default and writes nothing',res.status===200&&res.body.dryRun===true&&res.body.ready===3&&res.body.duplicates===0&&orderCount()===0);
check('preview says auto attribution is off',res.body.autoAttribution.enabled===false&&res.body.autoAttribution.label==='자동 귀속 꺼짐'&&res.body.autoAttribution.attributed===0);
check('preview counts identifiable orders without the ID',res.body.identifiableOrders===1&&!JSON.stringify(res.body).includes('member-4455'));
res=await act({action:'import_orders',csv:csvOff,mapping,dryRun:false,fileName:'pos-week.csv'});
check('confirm saves orders unattributed while the switch is off',res.status===200&&res.body.created===3&&res.body.attributed===0&&orderCount()===3&&!orderBy('R1').campaignId&&!orderBy('R1').codeAttribution&&orderBy('R1').channel==='unknown');
check('imported orders keep the codes seen and the discount',orderBy('R2').trackingCodes.join()===`${codeA},QRB7X9K`&&orderBy('R1').discountAmount===1000&&orderBy('R1').importId===res.body.importId);
check('customer IDs are never stored',!sql.prepare("SELECT COUNT(*) n FROM records WHERE data LIKE '%member-4455%'").get().n);
const imp=JSON.parse(sql.prepare("SELECT data FROM records WHERE owner=? AND kind='order_import'").get(owner).data);
check('the import record keeps actor counts and switch state',imp.importedBy.id===owner&&imp.created===3&&imp.identifiableOrders===1&&imp.autoAttribution===false&&imp.fileName==='pos-week.csv');
res=await act({action:'attribution_report',from:W,to:day(6)});
check('report says auto attribution is off and has no code groups',res.status===200&&res.body.autoAttribution.label==='자동 귀속 꺼짐'&&res.body.byCode.length===0);
check('the switch-off note says earlier code attribution stays in the totals',res.body.notes.some(x=>x.includes('앞으로 가져오는 주문')&&x.includes('이미 코드로 귀속된 주문은 집계에 남습니다')));

// 7-3) 스위치 켬 → 코드로 자동 귀속
await flags.setFeatureFlag(owner,{flag:'a4_auto_attribution',enabled:true},{id:owner,email:null});
const csvOn=[header,`S1,${day(3)},8000,0,${codeA},,`,`S2,${day(4)},9000,0,"${codeA};QRB7X9K",,`,`S3,${day(5)},7000,0,qrb-7x9k,,`,`S4,${day(6)},6000,0,ZZZZ,,`,`S5,${day(6)},1000,0,GNEX2345,,`].join('\n');
await server.database().prepare('DELETE FROM records WHERE id=?').bind(`${owner}:campaign:c3`).run();
res=await act({action:'import_orders',csv:csvOn,mapping});
check('preview with the switch on shows matches conflicts and unknown codes',res.status===200&&res.body.autoAttribution.enabled===true&&res.body.autoAttribution.attributed===3&&res.body.autoAttribution.conflicts===1&&res.body.autoAttribution.unknownCodes===1);
check('a code whose campaign is gone is not attributed',res.body.autoAttribution.unavailable===1);
res=await act({action:'import_orders',csv:csvOn,mapping,dryRun:false});
check('confirm attributes orders by code',res.status===200&&res.body.created===5&&res.body.attributed===3&&res.body.conflicts===1);
const s1=orderBy('S1'),s2=orderBy('S2'),s3=orderBy('S3');
check('the code link becomes the order attribution',s1.campaignId==='c1'&&s1.creativeId==='cr1'&&s1.channel==='daangn'&&s1.codeAttribution.arm==='A'&&s1.attributionEvidence.includes(codeA));
check('the first valid code wins and the conflict is kept',s2.codeAttribution.codeId===codeA&&s2.codeAttribution.conflictCodeIds.join()==='QRB7X9K');
check('a differently written code still matches',s3.codeAttribution.codeId==='QRB7X9K'&&s3.codeAttribution.arm==='B'&&!s3.creativeId);
check('unknown and unavailable codes stay unattributed',!orderBy('S4').campaignId&&!orderBy('S5').campaignId&&orderBy('S5').trackingCodes.join()==='GNEX2345');
check('legacy ledger summary counts code attribution',logic.ledgerSummary([s1,s2,s3,orderBy('S4')],[]).attributed===3);

// 7-4) 같은 파일 재가져오기는 멱등
const before=orderCount();
res=await act({action:'import_orders',csv:csvOn,mapping,dryRun:false});
check('re-importing the same file creates nothing',res.status===200&&res.body.created===0&&res.body.duplicates===5&&orderCount()===before);
check('re-imported orders keep their first version',orderBy('S1').version===1);
// 7-4b) 열 매핑만 바꿔 같은 파일을 다시 올리면 출처가 달라진다. 같은 주문일·주문번호의 다른 출처 주문을 세고, 확인 없이는 확정하지 않는다.
const twinDay=sa.addDays(W,-35),twinCsv=['주문번호,주문일시,결제금액,주문채널',`TW1,${twinDay},5000,배달의민족`,`TW2,${twinDay},6000,배달의민족`].join('\n');
res=await act({action:'import_orders',csv:twinCsv,mapping:{orderNumber:'주문번호',orderedAt:'주문일시',amount:'결제금액'},dryRun:false});
check('a file imported without its channel column is saved as POS orders',res.status===200&&res.body.created===2&&orderBy('TW1').source==='pos');
const twinMapping={orderNumber:'주문번호',orderedAt:'주문일시',amount:'결제금액',channel:'주문채널'},beforeTwins=orderCount();
res=await act({action:'import_orders',csv:twinCsv,mapping:twinMapping});
check('the preview counts orders already saved under another source',res.status===200&&res.body.ready===2&&res.body.sourceConflicts===2&&res.body.sourceConflictLines.join()==='2,3');
res=await act({action:'import_orders',csv:twinCsv,mapping:twinMapping,dryRun:false});
check('a re-import with a changed mapping is refused without confirmation',res.status===409&&/출처/.test(res.error)&&orderCount()===beforeTwins);
res=await act({action:'import_orders',csv:twinCsv,mapping:twinMapping,dryRun:false,allowSourceConflicts:true});
check('confirmed different-source orders are saved and recorded',res.status===200&&res.body.created===2&&res.body.sourceConflicts===2&&orderCount()===beforeTwins+2);

// 7-5) 스위치 다시 끔 → 다음 가져오기부터 즉시 수동 귀속만
await flags.setFeatureFlag(owner,{flag:'a4_auto_attribution',enabled:false},{id:owner,email:null});
res=await act({action:'import_orders',csv:[header,`T1,${day(6)},4000,0,${codeA},,`].join('\n'),mapping,dryRun:false});
check('turning the switch off stops auto attribution on the next import',res.status===200&&res.body.attributed===0&&!orderBy('T1').campaignId&&res.body.autoAttribution.label==='자동 귀속 꺼짐');

// 7-6) 개인정보 거부와 원자성
const phoneCsv=[header+',연락처',`U1,${day(0)},100,0,,,,010-2222-3333`].join('\n');
res=await act({action:'import_orders',csv:phoneCsv,mapping});
check('a phone column is refused at preview',res.status===400&&/휴대폰/.test(res.error)&&!res.error.includes('2222'));
res=await act({action:'import_orders',csv:phoneCsv,mapping,dryRun:false});
check('a phone column is refused at confirm and nothing is saved',res.status===400&&!sql.prepare("SELECT COUNT(*) n FROM records WHERE data LIKE '%2222-3333%'").get().n);
res=await act({action:'import_orders',csv:[header,`U2,${day(0)},100,0,,,4111111111111111`].join('\n'),mapping,dryRun:false});
check('a card number in the customer column is refused',res.status===400&&/카드/.test(res.error));
const beforeBad=orderCount();
res=await act({action:'import_orders',csv:[header,`V1,${day(0)},100,0,,,`,`V2,${day(0)},-100,0,,,`].join('\n'),mapping,dryRun:false});
check('a file with row errors saves nothing',res.status===400&&/3행/.test(res.error)&&orderCount()===beforeBad);
check('an invalid mapping is a 400',(await act({action:'import_orders',csv:csvOff,mapping:{orderNumber:'주문번호'}})).status===400);

// 7-7) POS 주간 합계
const weekOrdersNet=async start=>{const o=(await ops.getStoreOperations(owner,'s1',start,sa.addDays(start,6))).orders;return {net:o.reduce((n,x)=>n+x.paidAmount-x.refundAmount,0),count:o.filter(x=>x.status==='paid').length}};
const wNet=await weekOrdersNet(W);
check('a week start must be a Monday',(await act({action:'set_pos_total',weekStart:day(1),netSales:1,source:'POS'})).status===400);
check('a future week is refused',(await act({action:'set_pos_total',weekStart:sa.addDays(W,14),netSales:1,source:'POS'})).status===400);
check('a POS total needs its source',(await act({action:'set_pos_total',weekStart:W,netSales:1})).status===400);
res=await act({action:'set_pos_total',weekStart:W,netSales:wNet.net+1,orderCount:wNet.count,source:'POS 주간 매출 리포트'});
check('a POS total is saved with the actor',res.status===200&&res.body.total.version===1&&res.body.total.updatedBy.id===owner);
check('a stale POS total write is a 409',(await act({action:'set_pos_total',weekStart:W,netSales:wNet.net,orderCount:wNet.count,source:'POS',version:9})).status===409);
res=await act({action:'set_pos_total',weekStart:W,netSales:wNet.net,orderCount:wNet.count,source:'POS 주간 매출 리포트',version:1});
check('a POS total is corrected with its version',res.status===200&&res.body.total.version===2&&res.body.total.netSales===wNet.net);
// 기준 주: 2주는 대조 통과, 1주는 어긋남, 1주는 POS 합계 없음
for(const [k,n] of [[7,2],[14,3],[21,4],[28,5]]){const start=sa.addDays(W,-k);await act({action:'import_orders',csv:[header,...Array.from({length:n},(_,i)=>`B${k}-${i},${start},1000,0,,,`)].join('\n'),mapping,dryRun:false})}
await act({action:'set_pos_total',weekStart:sa.addDays(W,-7),netSales:2000,orderCount:2,source:'POS'});
await act({action:'set_pos_total',weekStart:sa.addDays(W,-14),netSales:3000,source:'POS'});
await act({action:'set_pos_total',weekStart:sa.addDays(W,-21),netSales:9000,source:'POS'});
await save('store_spend','sp-a4',{id:'sp-a4',storeId:'s1',date:day(2),channel:'daangn',experimentId:'',adSpend:3000,productionCost:0,source:'당근 광고 관리자',version:1,createdAt:'x',updatedAt:'x'},'s1');

// 7-8) 귀속 보고서
res=await act({action:'attribution_report',from:W,to:day(6),variableCostRate:0.4});
const rep=res.body;
check('the report covers the requested week and says the switch is off now',res.status===200&&rep.period.from===W&&rep.weeks.length===1&&rep.weeks[0].status==='pass'&&rep.autoAttribution.enabled===false);
check('report weeks carry the stored POS total version',rep.weeks[0].posVersion===2);
check('the report groups by code and arm',find(rep.byCode,codeA).orders===2&&find(rep.byArm,'c1·A').orders===2&&find(rep.byArm,'c1·B').orders===1&&find(rep.byCampaign,'c1').orders===3);
check('the report groups by creative with its campaign',find(rep.byCreative,'c1·cr1').orders===2&&rep.byCreative.length===1);
check('weekly ledger totals match the ledger orders',rep.weeks[0].ledgerNet===wNet.net&&rep.weeks[0].ledgerOrders===wNet.count);
check('channel economics use the store spend',find(rep.byChannel,'daangn').spendTotal===3000&&find(rep.byChannel,'daangn').costPerOrder===1500);
check('north-star counts attributed orders of passed weeks with estimated contribution',rep.northStar.passedWeeks===1&&rep.northStar.attributedOrders===3&&rep.northStar.attributedContribution===(8000+9000+7000)*0.6);
check('incrementality uses passed baseline weeks and says attribution is not incrementality',rep.incrementality.baseline.weeks.length===2&&rep.incrementality.excluded.length===2&&rep.incrementality.disclaimer.includes('귀속≠증분'));
check('the report repeats the attribution caveat',rep.notes.some(x=>x.includes('귀속≠증분')));
check('a baseline after the period is refused',(await act({action:'attribution_report',from:W,to:day(6),baselineFrom:day(1),baselineTo:day(2)})).status===400);
check('a variable cost rate above 1 is refused',(await act({action:'attribution_report',from:W,to:day(6),variableCostRate:1.5})).status===400);
check('a report period longer than 26 weeks is refused',(await act({action:'attribution_report',from:'1000-01-01',to:day(6)})).status===400);
check('a baseline longer than 12 weeks is refused',(await act({action:'attribution_report',from:W,to:day(6),baselineFrom:'2000-01-03',baselineTo:sa.addDays(W,-1)})).status===400);
check('a one-week baseline from a year ago is allowed',(await act({action:'attribution_report',from:W,to:day(6),baselineFrom:sa.addDays(W,-364),baselineTo:sa.addDays(W,-358)})).status===200);
check('an unknown measurement action is a 400',(await act({action:'drop_everything'})).status===400);

// 7-8b) 가져온 주문을 주문 기록 창(save_order)에서 고쳐도 가져오기 필드(코드 귀속·읽은 코드·신규 여부·할인·가져오기 기록)가 남는다.
const route=await rt.load('app/api/store-operations/route.ts');
await save('campaign','c4',{id:'c4',brandId:'oda',storeId:'s1'});
const saveOrder=async(o,over={})=>{const data={source:o.source,orderNumber:o.orderNumber,orderDate:o.orderDate,mode:o.mode,status:o.status,paidAmount:o.paidAmount,refundAmount:o.refundAmount,costs:o.costs,channel:o.channel,experimentId:o.experimentId,campaignId:o.campaignId||'',creativeId:o.creativeId||'',attributionEvidence:o.attributionEvidence,note:o.note,...over};const r=await route.POST(new Request('https://agency.test/api/store-operations',{method:'POST',headers:{'Content-Type':'application/json','oai-authenticated-user-id':owner},body:JSON.stringify({action:'save_order',storeId:'s1',id:o.id,version:o.version,data})}));return {status:r.status,...await r.json()}};
await flags.setFeatureFlag(owner,{flag:'a4_auto_attribution',enabled:true},{id:owner,email:null});
res=await act({action:'import_orders',csv:['주문번호,주문일시,결제금액,할인금액,쿠폰코드,신규',`E1,${day(6)},10000,500,${codeA},Y`].join('\n'),mapping:{orderNumber:'주문번호',orderedAt:'주문일시',amount:'결제금액',discount:'할인금액',code:'쿠폰코드',newCustomer:'신규'},dryRun:false});
await flags.setFeatureFlag(owner,{flag:'a4_auto_attribution',enabled:false},{id:owner,email:null});
const e1=orderBy('E1');
check('the edit fixture is a code-attributed import',res.status===200&&e1.codeAttribution?.codeId===codeA&&e1.newCustomer===true&&e1.discountAmount===500&&e1.trackingCodes.join()===codeA);
res=await saveOrder(e1,{costs:{foodCost:3000,packagingCost:0,fees:300,deliveryCost:0,benefitCost:0}});
const edited=orderBy('E1');
check('filling costs in the order dialog keeps the import fields',res.status===200&&edited.version===2&&edited.costs.foodCost===3000&&JSON.stringify(edited.codeAttribution)===JSON.stringify(e1.codeAttribution)&&edited.trackingCodes.join()===codeA&&edited.newCustomer===true&&edited.discountAmount===500&&edited.importId===e1.importId);
check('an edited import stays in the code, arm and creative groups',(b=>find(b.byCode,codeA)?.orders===1&&find(b.byArm,'c1·A')?.orders===1&&find(b.byCreative,'c1·cr1')?.orders===1)(plain(sa.attributionBreakdown([edited],[]))));
res=await saveOrder(edited,{campaignId:'c4',creativeId:'',attributionEvidence:'계산대 구두 확인'});
const moved=orderBy('E1');
check('a manual campaign change drops the code attribution copy and keeps what was read',res.status===200&&moved.campaignId==='c4'&&!moved.codeAttribution&&moved.trackingCodes.join()===codeA&&moved.newCustomer===true&&moved.discountAmount===500&&moved.importId===e1.importId);
res=await saveOrder(orderBy('T1'),{campaignId:'c1',attributionEvidence:'쿠폰 확인'});
check('manual attribution of an import made with the switch off keeps the codes read',res.status===200&&orderBy('T1').campaignId==='c1'&&orderBy('T1').trackingCodes.join()===codeA&&!orderBy('T1').codeAttribution);
res=await saveOrder(orderBy('R3'),{status:'refunded',refundAmount:5000});
check('a refund on an imported order keeps its import record',res.status===200&&orderBy('R3').status==='refunded'&&orderBy('R3').importId===orderBy('R1').importId);
res=await saveOrder(orderBy('S3'),{refundAmount:1000});
check('a partial refund keeps the code attribution',res.status===200&&orderBy('S3').codeAttribution?.codeId==='QRB7X9K');
// 주간 완전성은 SQL 일별 합계(ledgerDays)로 판정한다. 순수 합계(dayTotals)와 같은 값이어야 한다(취소·환불·원가 확인·추정 대상이 섞인 장부).
const ledgerFrom=sa.addDays(W,-35),byDay=list=>JSON.stringify([...list].map(d=>[d.day,d.net,d.orders,d.attributedOrders,d.attributedKnown,d.attributedUnknown,d.attributedUnknownNet]).sort());
check('SQL day totals match the pure ledger totals',byDay(await ops.ledgerDays(owner,'s1',ledgerFrom,today))===byDay(sa.dayTotals((await ops.getStoreOperations(owner,'s1',ledgerFrom,today)).orders)));

// 7-9) 권한: 코드 생성·가져오기 확정·POS 합계는 관리자, 조회·미리보기는 로그인 사용자
env.AUTH_MODE='email';env.AUTH_ORIGIN='https://agency.test';
const signIn=(id,role,createdAt,ws=owner)=>{const token=createHash('sha256').update(id).digest('hex');sql.prepare('INSERT INTO auth_users(id,email,workspace_owner,role,status,created_at) VALUES(?,?,?,?,?,?)').run(id,id+'@test.invalid',ws,role,'active',createdAt);sql.prepare('INSERT INTO auth_sessions VALUES(?,?,?,?)').run(createHash('sha256').update(token).digest('hex'),id,Date.now()+60000,Date.now());return new Request('https://agency.test/api/store-operations',{method:'POST',headers:{cookie:'__Host-collective_session='+token,origin:'https://agency.test'}})};
const memberReq=signIn('a4-member','member',500),adminReq=signIn('a4-admin','admin',2000),foreignReq=signIn('a4-foreign-admin','admin',3000,'someone-else');
const codesBefore=sql.prepare("SELECT COUNT(*) n FROM records WHERE owner=? AND kind='tracking_code'").get(owner).n,ordersBefore=orderCount();
check('a member cannot create a tracking code',(await act({action:'create_tracking_code',type:'coupon',campaignId:'c1'},memberReq)).status===403);
check('a member cannot confirm an import',(await act({action:'import_orders',csv:[header,`M1,${day(0)},100,0,,,`].join('\n'),mapping,dryRun:false},memberReq)).status===403&&orderCount()===ordersBefore);
check('a member cannot set a POS total',(await act({action:'set_pos_total',weekStart:W,netSales:1,source:'POS',version:2},memberReq)).status===403);
check('a member can preview an import',(await act({action:'import_orders',csv:[header,`M1,${day(0)},100,0,,,`].join('\n'),mapping},memberReq)).status===200);
check('a member can list and read the report',(await act({action:'list'},memberReq)).status===200&&(await act({action:'attribution_report',from:W,to:day(6)},memberReq)).status===200);
check('an admin of another workspace is refused',(await act({action:'create_tracking_code',type:'coupon',campaignId:'c1'},foreignReq)).status===403);
check('refused writes leave nothing behind',sql.prepare("SELECT COUNT(*) n FROM records WHERE owner=? AND kind='tracking_code'").get(owner).n===codesBefore);
res=await act({action:'create_tracking_code',type:'coupon',campaignId:'c1'},adminReq);
check('an admin creates a code and is recorded as the actor',res.status===200&&res.body.code.createdBy.id==='a4-admin'&&res.body.code.createdBy.email==='a4-admin@test.invalid');

// 7-10) 기준 주와 조회 기간을 합쳐 5,000건이 넘어도 보고서를 만든다. 주간 완전성은 주문 행 대신 일별 합계를 읽는다.
const busy={id:'s2',brandId:'oda',name:'바쁜 지점',status:'active',version:1};await save('store','s2',busy,'oda');
const bulk=(prefix,date,n)=>Array.from({length:n},(_,i)=>server.recordStatement(owner,'store_order',prefix+i,{...order({id:prefix+i,storeId:'s2',orderNumber:prefix+i,orderDate:date})},'s2'));
await server.database().batch([...bulk('base-',sa.addDays(W,-7),2600),...bulk('now-',day(0),2600)]);
check('the fixture exceeds the order-row read limit over baseline and period',await ops.getStoreOperations(owner,'s2',sa.addDays(W,-28),day(6)).then(()=>false,e=>e.status===400));
res=await (async()=>{try{return {status:200,body:plain(await ops.measurementAction(legacyReq(),owner,busy,{action:'attribution_report',from:W,to:day(6)}))}}catch(e){if(typeof e?.status==='number')return {status:e.status,error:e.message};throw e}})();
check('a report over more than 5,000 baseline and period orders is built',res.status===200&&res.body.totals.orders===2600&&res.body.weeks[0].ledgerOrders===2600&&res.body.baselineWeeks.find(w=>w.weekStart===sa.addDays(W,-7)).ledgerOrders===2600);

console.log(JSON.stringify({passed:passed.length,checks:passed},null,2));
