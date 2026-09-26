// A8-1 고객 보고서 순수 모듈 회귀(docs/CUSTOMER-REPORT.ko.md 5절 RED 목록): 지표 사전, 장부 합계 = 귀속 보고·ledgerSummary(data-truth-9), KST ISO 주,
// 공헌이익 미상 null·변동비율 미적용, north-star는 POS 대조 통과 주만, 개인정보 카나리, 가림·허용 목록, 커넥터 comparable:false·계정 id 없음,
// 네이버 기간 합계 광고비 경고, CSV 수식 방지, 고지 문구, 바이트 동일, 순수 모듈 import 경계. 근거: mocked(순수 함수, 외부 호출 0회).
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import ts from 'typescript';
import {testRuntime} from './helpers/runtime.mjs';

let calls=0;
const rt=testRuntime(async()=>{calls++;throw new Error('외부 호출 금지')});
const cr=await rt.load('lib/customer-report.ts'),sa=await rt.load('lib/store-attribution.ts'),so=await rt.load('lib/store-operations.ts'),qc=await rt.load('lib/quality-console.ts'),ex=await rt.load('lib/execution.ts');
const passed=[];const check=(name,val)=>{assert.ok(val,name);passed.push(name)};
const plain=x=>JSON.parse(JSON.stringify(x));

// ── 카나리: 주문 행·비용 출처·자료 요청 원문·플레이스 원문·POS 메모·커넥터 계정에 심는다 ──
const PHONE='010-2345-6789',EMAIL='hong.gildong@example.com',CARD='4111 1111 1111 1111',ACCOUNT='7766554433',TARGET='grp-a001-secret';
const planted=[PHONE,'01023456789',EMAIL,CARD,'4111111111111111',ACCOUNT,TARGET];
const known={foodCost:5000,packagingCost:500,fees:0,deliveryCost:0,benefitCost:0};
const unknownCosts={foodCost:null,packagingCost:null,fees:null,deliveryCost:null,benefitCost:null};
let seq=0;
const order=(over={})=>({id:'o'+(++seq),storeId:'s1',source:'pos',orderNumber:`N-${seq} ${EMAIL}`,orderDate:'2026-09-15',mode:'hall',status:'paid',paidAmount:20000,refundAmount:0,costs:known,channel:'unknown',experimentId:'',attributionEvidence:`근거 ${CARD}`,note:`고객 ${PHONE}`,trackingCodes:[PHONE],version:1,createdAt:'x',updatedAt:'x',...over});
const orders=[
 order({orderDate:'2026-09-14',channel:'naver_place',campaignId:'c1',newCustomer:true,codeAttribution:{codeId:'k1',code:'AB23',conflictCodeIds:[],enteredBy:{id:'u9',email:EMAIL}}}),
 order({orderDate:'2026-09-16',paidAmount:15000,refundAmount:5000,channel:'daangn',newCustomer:false}),
 order({orderDate:'2026-09-17',paidAmount:12000,channel:'naver_place',newCustomer:true}),
 order({orderDate:'2026-09-20',status:'cancelled',paidAmount:8000,refundAmount:8000,newCustomer:false}),
 order({orderDate:'2026-09-20',status:'refunded',paidAmount:9000,refundAmount:9000,newCustomer:false}),
 order({orderDate:'2026-09-21',paidAmount:99999}),
 order({orderDate:'2026-09-13',paidAmount:7000,newCustomer:false}),
 order({orderDate:'2026-09-08',paidAmount:30000,channel:'daangn',newCustomer:false}),
 order({orderDate:'2026-08-31',paidAmount:10000,newCustomer:false}),
 order({orderDate:'2026-08-24',paidAmount:11000,channel:'naver_place',newCustomer:false}),
];
const hex='0123456789abcdef01234567';
const spendRow=(over={})=>({id:'sp'+(++seq),storeId:'s1',date:'2026-09-15',channel:'daangn',experimentId:'',adSpend:5000,productionCost:1000,source:`견적서 ${PHONE}`,version:1,createdAt:'x',updatedAt:'x',...over});
const spend=[
 spendRow(),
 spendRow({id:`naver-${hex}-2026-09-10`,date:'2026-09-16',channel:'naver_ads',adSpend:7000,productionCost:0,source:`naver_ads 수집 · 계정 ${ACCOUNT}`}),
 spendRow({id:`naver-${hex}-2026-09-14`,date:'2026-09-15',channel:'naver_ads',adSpend:3000,productionCost:0}),
 spendRow({id:`naver-${hex}-2026-09-18`,date:'2026-09-23',channel:'naver_ads',adSpend:4000,productionCost:0}),
 spendRow({date:'2026-09-09',adSpend:2000,productionCost:0}),
];
const inWeek=(list,key,from,to)=>list.filter(x=>x[key]>=from&&x[key]<=to);
const weekOrders=inWeek(orders,'orderDate','2026-09-14','2026-09-20'),weekSpend=inWeek(spend,'date','2026-09-14','2026-09-20');
const days=sa.dayTotals(orders.filter(o=>o.orderDate>='2026-08-24'&&o.orderDate<='2026-09-20'));
const pos=(weekStart,netSales,over={})=>({id:`s1-${weekStart}`,storeId:'s1',weekStart,netSales,orderCount:null,source:`POS ${PHONE}`,note:`메모 ${EMAIL}`,version:2,createdAt:'x',updatedAt:'x',updatedBy:{id:'u1',email:EMAIL},...over});
const w38Net=weekOrders.reduce((n,o)=>n+o.paidAmount-o.refundAmount,0);
const posTotals=[pos('2026-09-14',w38Net),pos('2026-08-31',10000),pos('2026-08-24',11000)];
const scope={type:'store',id:'s1',brandId:'b1',name:'오다 이문점',address:'서울 동대문구 이문로 12',businessPhone:'02-963-1234'};
const connectors=[
 {id:'d1',experimentId:'x1',channel:'naver_ads',window:{from:'2026-09-14',to:'2026-09-20'},definition:'노출 대비 클릭. 광고비는 salesAmt, 전환은 ccnt.',limitations:['네이버 검색광고 통계는 집계 지연이 있을 수 있습니다.'],fetchedAt:'2026-09-21T01:00:00.000Z',updatedAt:'x',comparable:true,account:ACCOUNT,raw:{customerId:ACCOUNT},storeValues:{adSpend:12000,orders:3},
  arms:{treatment:{value:{denominator:100,numerator:5,source:`네이버 검색광고 · 고객 ${ACCOUNT} · 대상 ${TARGET}`},window:{from:'2026-09-14',to:'2026-09-20'},definition:'x',limitations:[],fetchedAt:'x',target:TARGET,credential:{level:'store',brandId:'b1',storeId:'s1'}}}},
 {id:'d2',experimentId:'x2',channel:'instagram',window:{from:'2026-09-10',to:'2026-09-16'},definition:'도달 대비 공유. 게시 이후 누적값.',limitations:['Instagram 미디어 인사이트는 게시 이후 누적값입니다.'],fetchedAt:'2026-09-17T01:00:00.000Z',updatedAt:'x',comparable:false,account:ACCOUNT,
  arms:{control:{value:{denominator:400,numerator:12,source:`Instagram · @${ACCOUNT}`},window:{from:'2026-09-10',to:'2026-09-16'},definition:'x',limitations:[],fetchedAt:'x',target:TARGET}}},
];
const publications=[{status:'published',scheduledAt:'2026-09-13T15:30:00.000Z',caption:PHONE},{status:'published',scheduledAt:'2026-09-15T03:00:00.000Z'},{status:'failed',scheduledAt:'2026-09-16T03:00:00.000Z'},{status:'accepted',scheduledAt:'2026-09-20T15:30:00.000Z'}];
const dataRequests=[
 {status:'open',label:`영업시간 확인 ${PHONE}`,text:`원문 ${EMAIL}`,assignee:EMAIL,origins:[{excerpt:PHONE}]},
 {status:'open',label:'이문로 12 입구 사진 · 02-963-1234 확인',text:'x',origins:[]},
 {status:'closed',label:'주차 안내',text:'x',origins:[]},
];
const placeChecks=[{field:'phone',state:'conflict',placeValue:PHONE,factValue:'02-963-1234'},{field:'hours',state:'match',placeValue:'10:00~22:00'},{field:'address',state:'place_missing',factValue:'서울 동대문구 이문로 12'}];
const facts={effective:5,expiringSoon:1,rejected:1,excluded:{candidate:1,expired:1,unsupported:0,franchise:2}};
const baseInput=()=>({scope,week:'2026-W38',ledger:cr.aggregateLedger('2026-W38',orders,spend),days,posTotals,connectors,publications,dataRequests,placeChecks,facts});
const report=plain(cr.buildReport(baseInput()));
const json=JSON.stringify(report),md=cr.reportMarkdown(report),csv=cr.reportCsv(report);

// ── 0) 지표 사전 ──
const metrics=plain(cr.REPORT_METRICS),ids=metrics.map(m=>m.id);
check('metric dictionary ids are unique and every entry has label, unit, source and definition',new Set(ids).size===ids.length&&metrics.every(m=>m.id&&m.label&&m.unit&&['user_record','derived','connector','app_record'].includes(m.source)&&m.definition));
check('every ledger, completeness, north-star and channel value key in the payload is a dictionary id',[report.ledger.current,report.completeness[0],report.northStar,report.channels[0]].every(o=>Object.keys(o).filter(k=>!['week','weekStart','weekEnd','status','reason','key','label','weeks','measured'].includes(k)).every(k=>ids.includes(k))));
check('payload carries the schema id',report.schema==='collective.customer-report.v1');

// ── 1) data-truth-9: 보고서 합계 = 귀속 보고(orderMetrics, 변동비율 없음) = ledgerSummary ──
const m=plain(sa.orderMetrics(weekOrders)),ls=plain(so.ledgerSummary(weekOrders,weekSpend)),cur=report.ledger.current;
check('report totals equal attributionReport totals (orderMetrics) for the same fixture',cur.records===m.records&&cur.orders===m.orders&&cur.netRevenue===m.netRevenue&&cur.contribution===m.contribution&&cur.newCustomers===m.newCustomers&&cur.unknownCostOrders===m.unknownCostOrders);
check('report totals equal ledgerSummary for the same fixture (data-truth-9)',cur.orders===ls.orders&&cur.netRevenue===ls.netRevenue&&cur.contribution===ls.contribution&&cur.adSpend===ls.adSpend&&cur.productionCost===ls.productionCost&&cur.cancelled===ls.cancelled&&cur.refunded===ls.refunded&&cur.attributedOrders===ls.attributed&&cur.records===ls.records);
check('fixture is not trivial (orders, refunds, cancellations and spend are all present)',cur.orders===3&&cur.cancelled===1&&cur.refunded===1&&cur.adSpend===15000&&cur.netRevenue===w38Net);
const ue=plain(sa.unitEconomics(weekOrders,weekSpend)).byChannel;
check('channel unit economics equal unitEconomics without economics input',JSON.stringify(report.channels.map(c=>[c.key,c.orders,c.netRevenue,c.contribution,c.adSpend,c.spendTotal,c.costPerOrder,c.revenuePerSpend,c.contributionAfterSpend]))===JSON.stringify(ue.map(c=>[c.key,c.orders,c.netRevenue,c.contribution,c.adSpend,c.spendTotal,c.costPerOrder,c.revenuePerSpend,c.contributionAfterSpend])));
const w38=report.completeness.find(c=>c.week==='2026-W38');
check('completeness ledger for the report week equals the ledger totals',w38.ledgerNet===cur.netRevenue&&w38.ledgerOrders===cur.orders);
const prevOrders=inWeek(orders,'orderDate','2026-09-07','2026-09-13');
check('previous week ledger is the ISO week before (2026-W37)',report.period.previousWeek==='2026-W37'&&report.ledger.previous.netRevenue===sa.orderMetrics(prevOrders).netRevenue&&report.ledger.previous.orders===2&&report.ledger.previous.adSpend===2000);

// ── 2) 주 경계: KST ISO 주(월~일), quality-console isoWeekOf와 교차 확인(테스트에서만) ──
let mismatch=0;
for(let t=Date.parse('2020-12-20T00:00:00Z');t<=Date.parse('2027-01-10T00:00:00Z');t+=86400000){const d=new Date(t).toISOString().slice(0,10);if(cr.isoWeekOfDate(d)!==qc.isoWeekOf(d+'T00:00:00+09:00')||cr.isoWeekOfDate(d)!==qc.isoWeekOf(d+'T23:59:59+09:00'))mismatch++}
check('ISO week label matches quality-console isoWeekOf for every KST day 2020-12-20..2027-01-10',mismatch===0);
const w=plain(cr.reportWeek('2026-W38'));
check('week is Monday to Sunday KST',w.from==='2026-09-14'&&w.to==='2026-09-20'&&new Date(w.from+'T00:00:00Z').getUTCDay()===1&&new Date(w.to+'T00:00:00Z').getUTCDay()===0&&sa.weekStart(w.from)===w.from&&w.timeZone==='Asia/Seoul');
check('week 53 and year boundaries follow ISO rules',cr.reportWeek('2026-W53').from==='2026-12-28'&&cr.reportWeek('2026-W53').to==='2027-01-03'&&cr.isoWeekOfDate('2021-01-03')==='2020-W53'&&cr.isoWeekOfDate('2021-01-04')==='2021-W01');
check('invalid weeks are null (W00, W54, a W53 the year does not have, bad format)',[cr.reportWeek('2026-W00'),cr.reportWeek('2026-W54'),cr.reportWeek('2025-W53'),cr.reportWeek('2026-38'),cr.reportWeek('')].every(x=>x===null));
check('a week is closed only after its Sunday (KST date)',cr.weekClosed('2026-W38','2026-09-20')===false&&cr.weekClosed('2026-W38','2026-09-21')===true);
check('Sunday 09-20 is in the week, Monday 09-21 and Sunday 09-13 are not',cur.records===weekOrders.length&&weekOrders.every(o=>o.orderDate!=='2026-09-21'&&o.orderDate!=='2026-09-13'));
check('period in payload carries week, from, to and Asia/Seoul',JSON.stringify(report.period)===JSON.stringify({week:'2026-W38',from:'2026-09-14',to:'2026-09-20',timeZone:'Asia/Seoul',previousWeek:'2026-W37'}));
const isRange=e=>e?.name==='RangeError';
assert.throws(()=>cr.buildReport({...baseInput(),week:'2026-W99'}),isRange);
assert.throws(()=>cr.buildReport({...baseInput(),week:'2026-W37'}),isRange);passed.push('an invalid week or a ledger for another week is refused');

// ── 3) 공헌이익: 원가 미상 1건이면 null, 변동비율은 절대 적용하지 않는다 ──
const withUnknown=[...orders,order({orderDate:'2026-09-18',channel:'naver_place',costs:unknownCosts,newCustomer:true})];
const unknownDays=sa.dayTotals(withUnknown.filter(o=>o.orderDate>='2026-08-24'&&o.orderDate<='2026-09-20'));
const unknownPos=[pos('2026-09-14',w38Net+20000),pos('2026-08-31',10000),pos('2026-08-24',11000)];
const ur=plain(cr.buildReport({...baseInput(),ledger:cr.aggregateLedger('2026-W38',withUnknown,spend),days:unknownDays,posTotals:unknownPos}));
check('contribution stays null when any order cost is unknown',ur.ledger.current.contribution===null&&ur.ledger.current.unknownCostOrders===1&&ur.channels.find(c=>c.key==='naver_place').contribution===null&&ur.channels.find(c=>c.key==='naver_place').contributionAfterSpend===null);
check('attributed contribution and north-star contribution stay null when an attributed order cost is unknown',ur.completeness.find(c=>c.week==='2026-W38').attributedContribution===null&&ur.northStar.northStarContribution===null&&ur.northStar.passedWeeks>0);
const withRate=plain(cr.buildReport({...baseInput(),ledger:cr.aggregateLedger('2026-W38',withUnknown,spend),days:unknownDays,posTotals:unknownPos,economics:{variableCostRate:0.3},variableCostRate:0.3}));
check('report never applies variableCostRate (an economics input changes nothing)',JSON.stringify(withRate)===JSON.stringify(ur)&&!JSON.stringify(ur).includes('estimated'));
const forged=cr.aggregateLedger('2026-W38',withUnknown,spend);
const forgedReport=plain(cr.buildReport({...baseInput(),ledger:{...forged,current:{...forged.current,contribution:123456,estimatedOrders:1}}}));
check('a ledger with unknown-cost orders cannot carry a contribution into the payload',forgedReport.ledger.current.contribution===null&&!('estimatedOrders' in forgedReport.ledger.current));

// ── 4) north-star: POS 대조를 통과한 주만. missing_pos는 보이되 통과로 보지 않는다 ──
const statuses=report.completeness.map(c=>`${c.week}:${c.status}`).join(',');
check('completeness covers the 4 weeks up to the report week, oldest first',statuses==='2026-W35:pass,2026-W36:pass,2026-W37:missing_pos,2026-W38:pass');
const failPos=[pos('2026-09-14',w38Net),pos('2026-08-31',15000),pos('2026-08-24',11000)];
const nr=plain(cr.buildReport({...baseInput(),posTotals:failPos}));
check('a fail week and a missing_pos week are shown with their status',nr.completeness.map(c=>c.status).join()==='pass,fail,missing_pos,pass'&&nr.completeness[2].posNet===null&&nr.completeness[2].reason.includes('POS'));
check('north-star counts only POS-pass weeks',JSON.stringify(nr.northStar.weeks)===JSON.stringify(['2026-W35','2026-W38'])&&nr.northStar.passedWeeks===2&&nr.northStar.excludedWeeks===2&&nr.northStar.measured===true);
const expected=plain(sa.northStar(sa.weeklyCompletenessFromDays(['2026-08-24','2026-08-31','2026-09-07','2026-09-14'],days,failPos)));
check('north-star sums equal store-attribution northStar on the same days and POS totals',nr.northStar.northStarOrders===expected.attributedOrders&&nr.northStar.northStarContribution===expected.attributedContribution&&expected.attributedOrders>0);
const noPos=plain(cr.buildReport({...baseInput(),posTotals:[]}));
check('without any POS total the north-star is not measured and nothing is passed',noPos.northStar.measured===false&&noPos.northStar.northStarOrders===0&&noPos.northStar.northStarContribution===null&&noPos.completeness.every(c=>c.status==='missing_pos'));

// ── 5) 개인정보: 주문 행 필드·심은 전화·이메일·카드가 JSON·MD·CSV 어디에도 없다 ──
check('no planted phone, email, card, account id or ad target appears in payload, markdown or csv',[json,md,csv].every(text=>planted.every(p=>!text.includes(p))));
check('no order-row field names appear in the payload',['orderNumber','attributionEvidence','"note"','trackingCodes','enteredBy','codeAttribution','"source"','"text"','assignee','origins','placeValue','factValue','updatedBy'].every(k=>!json.includes(k)));
check('POS memo and updater never reach the payload',!json.includes('메모')&&!json.includes('"u1"'));

// ── 6) 가림: 라벨은 가리고, 지점 주소·확정 사업장 전화는 둔다(허용 목록) ──
const labels=report.todos.dataRequests.map(d=>d.label);
check('labels are masked and the masking record carries field, kind and count only',labels.includes('영업시간 확인 [전화번호]')&&report.masking.some(f=>f.field==='todos.dataRequests.0.label'&&f.kind==='phone'&&f.count===1)&&report.masking.every(f=>Object.keys(f).join()==='field,kind,count'));
check('store address and confirmed business phone stay (allow list)',labels.includes('이문로 12 입구 사진 · 02-963-1234 확인')&&report.scope.address===scope.address&&report.scope.businessPhone===scope.businessPhone&&md.includes('02-963-1234'));
check('closed data requests are not listed; text, assignee and origins are dropped',labels.length===2&&!labels.includes('주차 안내'));
check('place mismatches carry field and state only (no raw values), matches are left out',JSON.stringify(report.todos.placeMismatches)===JSON.stringify([{field:'address',label:'주소',state:'place_missing'},{field:'phone',label:'전화번호',state:'conflict'}]));

// ── 7) 커넥터: 출처 커넥터·기간·한계·comparable:false, 계정 id 없음 ──
const cn=report.connectors;
check('connector entries carry origin connector, window, limitations and comparable:false',cn.length===2&&cn.every(c=>c.comparable===false&&c.connector&&c.window.from&&c.window.to&&Array.isArray(c.limitations)&&c.limitations.length>0));
check('connector entries carry no account id, target, credential or raw',cn.every(c=>!('account' in c)&&!('raw' in c)&&!('target' in c)&&!('credential' in c)&&!('arms' in c)&&!JSON.stringify(c).includes(ACCOUNT)));
const naver=cn.find(c=>c.connector==='naver_ads'),insta=cn.find(c=>c.connector==='instagram');
check('connector values keep only numbers (ad spend, conversions, arm numerator and denominator)',naver.values.connectorAdSpend===12000&&naver.values.connectorConversions===3&&naver.values.treatmentNumerator===5&&naver.values.treatmentDenominator===100&&insta.values.controlNumerator===12&&insta.values.controlDenominator===400&&!('connectorAdSpend' in insta.values));
check('connector value keys are dictionary ids',cn.every(c=>Object.keys(c.values).every(k=>ids.includes(k))));
check('a connector window that crosses the report week is marked and noted',naver.relation==='within'&&insta.relation==='crosses'&&insta.limitations.some(l=>l.includes('보고 주')));

// ── 8) 네이버 광고비: 기간 합계가 종료일 한 건으로 기록돼 주를 걸치면 경고한다(배분하지 않는다) ──
const warnings=report.spendWarnings;
check('naver spend recorded as a window total is flagged when the window crosses the week',warnings.length===2&&warnings.some(x=>x.from==='2026-09-10'&&x.to==='2026-09-16'&&x.counted===true)&&warnings.some(x=>x.from==='2026-09-18'&&x.to==='2026-09-23'&&x.counted===false));
check('a naver window inside the week is not flagged and spend is never split',!warnings.some(x=>x.from==='2026-09-14')&&report.ledger.current.adSpend===15000);
check('the spend warning is rendered in markdown',md.includes('2026-09-10~2026-09-16'));

// ── 9) CSV 수식 방지 ──
const parseCsv=raw=>{const text=raw.replace(/^\uFEFF/,''),rows=[];let row=[],cell='',q=false;for(let i=0;i<text.length;i++){const c=text[i];if(q){if(c==='"'){if(text[i+1]==='"'){cell+='"';i++}else q=false}else cell+=c}else if(c==='"')q=true;else if(c===','){row.push(cell);cell=''}else if(c==='\n'){row.push(cell);rows.push(row);row=[];cell=''}else if(c!=='\r')cell+=c}if(cell||row.length){row.push(cell);rows.push(row)}return rows};
const evil=['=HYPERLINK("http://x")','+1+1','-2+3','@SUM(A1)','\tTAB'];
const er=plain(cr.buildReport({...baseInput(),dataRequests:evil.map(label=>({status:'open',label}))}));
const cells=parseCsv(cr.reportCsv(er)).flat();
check('csv cells starting with = + - @ and tab are prefixed with a quote',evil.every(e=>cells.includes("'"+e))&&cells.every(c=>!/^[=+@\t\r]/.test(c)&&(!c.startsWith('-')||/^-\d+(\.\d+)?$/.test(c))));
check('csv starts with a UTF-8 BOM and uses CRLF like usage-export',csv.startsWith('\uFEFF')&&csv.endsWith('\r\n')&&!/[^\r]\n/.test(csv.replace(/"[^"]*"/g,'')));
check('csv has a header and one value per row',parseCsv(csv)[0].join()==='section,key,label,unit,value,previous'&&parseCsv(csv).every(r=>r.length===6));

// ── 10) 고지: 귀속≠증분, 자동 판정 아님 ──
check('markdown states 귀속≠증분 and 자동 판정 아님',md.includes('귀속≠증분')&&md.includes('자동 판정 아님'));
check('json and csv carry the same notices',report.notices.some(n=>n.includes('귀속≠증분'))&&report.notices.some(n=>n.includes('자동 판정 아님'))&&csv.includes('귀속≠증분')&&csv.includes('자동 판정 아님'));

// ── 11) 결정론: 같은 입력이면 바이트 동일, 입력 배열 순서와 무관 ──
const again=cr.buildReport(baseInput());
check('same input gives byte-identical JSON, markdown and csv',JSON.stringify(again)===json&&cr.reportMarkdown(again)===md&&cr.reportCsv(again)===csv);
const shuffled=cr.buildReport({...baseInput(),ledger:cr.aggregateLedger('2026-W38',[...orders].reverse(),[...spend].reverse()),days:[...days].reverse(),posTotals:[...posTotals].reverse(),connectors:[...connectors].reverse(),publications:[...publications].reverse(),dataRequests:[...dataRequests].reverse(),placeChecks:[...placeChecks].reverse()});
check('input array order does not change the bytes',JSON.stringify(shuffled)===json);

// ── 12) 발행 건수·사실 건수·파일 이름 ──
check('publication counts only the report week (KST scheduled day) with the execution labels',report.publications.total===3&&JSON.stringify(report.publications.byStatus)===JSON.stringify([{status:'failed',label:'발행 실패',count:1},{status:'published',label:'게시 확인',count:2}]));
check('publication status labels match lib/execution.ts publicationLabels',JSON.stringify(plain(cr.PUBLICATION_STATUS_LABELS))===JSON.stringify(plain(ex.publicationLabels)));
check('fact counts are carried as numbers only',JSON.stringify(report.facts)===JSON.stringify(facts));
check('report file name is deterministic and safe',cr.reportFileName(report,'md')==='customer-report-store-s1-2026-W38.md'&&cr.reportFileName({...report,scope:{...report.scope,id:'../a b'}},'csv')==='customer-report-store-___a_b-2026-W38.csv'&&cr.reportFileName(report,'json').endsWith('.json'));
assert.throws(()=>cr.reportFileName(report,'exe'));passed.push('an unknown file format is refused');
const empty=plain(cr.buildReport({scope,week:'2026-W38',ledger:cr.aggregateLedger('2026-W38',[],[]),days:[],posTotals:[]}));
check('optional sections default to empty lists and null facts',empty.connectors.length===0&&empty.publications.total===0&&empty.todos.dataRequests.length===0&&empty.facts===null&&empty.ledger.current.contribution===0&&cr.reportMarkdown(empty).includes('자동 판정 아님'));

// ── 13) 순수 모듈 import 경계: server·feature-flags·quality-*·franchise-*를 import하지 않는다 ──
// TypeScript 구문 트리로 import·export from·import()·require를 읽는다. 타입 전용 import는 컴파일에서 지워지므로 실행 그래프에서 뺀다(직접 import는 타입 포함 전부 본다).
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
const FORBIDDEN=/(^|\/)(server|feature-flags|quality-[^/]*|franchise-[^/]*|[^/]*-server)\.ts$/;
function runtimeClosure(roots){const seen=new Set(),queue=roots.map(r=>resolve(r));while(queue.length){const f=queue.shift();if(seen.has(f))continue;seen.add(f);for(const e of edges(f))if(!e.type&&e.spec!=='<opaque>'&&(e.spec.startsWith('.')||e.spec.startsWith('@/')))queue.push(target(f,e.spec))}return [...seen]}
const PURE=['lib/customer-report.ts','lib/fact-pack.ts'],ALLOWED=new Set(['./store-attribution','./store-operations','./brand-facts','./fact-catalog','./pii-scan','./fact-pack']);
check('pure modules import only relative allowed modules (type imports included)',PURE.every(f=>edges(f).every(e=>ALLOWED.has(e.spec)&&e.spec!=='<opaque>')));
const closure=runtimeClosure(PURE),bad=closure.filter(f=>FORBIDDEN.test(f));
check('pure modules do not import server, feature-flags, quality-*, franchise-* (runtime closure)',bad.length===0&&closure.length>2);
check('pure modules have no network, clock or model access in source',PURE.every(f=>{const s=readFileSync(f,'utf8');return !/\bfetch\s*\(|Date\.now|new Date\(\)|provider|hermes/i.test(s)}));
const probe=resolve('lib/fact-pack.ts');
check('the boundary checker would catch a forbidden import',FORBIDDEN.test(resolve('lib/server.ts'))&&FORBIDDEN.test(resolve('lib/franchise-facts.ts'))&&FORBIDDEN.test(resolve('lib/quality-console.ts'))&&FORBIDDEN.test(resolve('lib/feature-flags.ts'))&&!FORBIDDEN.test(probe));

// ── 14) 모델·외부 호출 0회 ──
check('no model or external call was made',calls===0);

console.log(JSON.stringify({passed:passed.length}));
