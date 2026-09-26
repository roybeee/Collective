// A8-2 고객 보고서 서버·API 회귀(docs/CUSTOMER-REPORT.ko.md 5절 A8-2 RED 목록). 실제 SQLite(node:sqlite)·실제 라우트, 헤더(legacy)·세션(email) 인증, 합성 데이터.
// 스위치 a8_customer_report(꺼짐: 미리보기·동결 409, 동결본 목록·다운로드는 계속), 권한(직원 403·관리자 동결·검토는 대표만), 진행 중·미래 주 400, 확인 값 불일치 409,
// 다시 동결(version+1·옛 판 검토 보존·옛 판 검토 요청 409), 동결 뒤 주문 수정 stale, 다른 워크스페이스 404, kind 등록 위치, 첨부 헤더, 크기 상한, 보고서 합계 = attributionReport(게시 관문 재검사),
// 브랜드 범위 POS 합산 규칙(지점별 대조 후 합산, 한 지점이라도 POS 없으면 missing_pos), 주를 걸친 네이버 광고비 경고, provider_usage 0건·외부 호출 0회(토큰 0).
// 근거: mocked(메모리 SQLite, 로컬 인증 헤더·이메일 세션, fetch 스텁). 모델·외부 네트워크 호출은 0회다.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,readdirSync} from 'node:fs';
import {testRuntime} from './helpers/runtime.mjs';

let fetchCalls=0;
const rt=testRuntime(async()=>{fetchCalls++;throw new Error('외부 호출 금지')});
const {sql,env}=rt;
const server=await rt.load('lib/server.ts'),sa=await rt.load('lib/store-attribution.ts'),so=await rt.load('lib/store-operations.ts'),ops=await rt.load('lib/store-operations-server.ts');
const cr=await rt.load('lib/customer-report.ts'),crs=await rt.load('lib/customer-report-server.ts'),route=await rt.load('app/api/customer-reports/route.ts');
const flags=await rt.load('lib/feature-flags.ts'),registry=await rt.load('lib/record-kinds.ts'),status=await rt.load('lib/feature-status.ts');
const passed=[];const check=(name,val)=>{assert.ok(val,name);passed.push(name)};
const plain=x=>JSON.parse(JSON.stringify(x));

// ── 1) 합성 데이터: 소유자 O(브랜드 oda 지점 s1·s2, 브랜드 big 지점 sb), 다른 소유자 X(지점 sx) ──
const O='a82-owner',X='a82-other';
const save=(owner,kind,id,data,parent='')=>server.recordStatement(owner,kind,id,data,parent).run();
await save(O,'brand','oda',{id:'oda',name:'오다'});await save(O,'brand','big',{id:'big',name:'큰 브랜드'});await save(X,'brand','oda',{id:'oda',name:'남의 오다'});
const store=(id,brandId,name,address)=>({id,brandId,name,address,status:'active',version:1});
await save(O,'store','s1',store('s1','oda','이문점','서울 동대문구 이문로 12'),'oda');await save(O,'store','s2',store('s2','oda','회기점','서울 동대문구 회기로 1'),'oda');
await save(O,'store','sb',store('sb','big','큰 지점','서울 중구 1'),'big');await save(X,'store','sx',store('sx','oda','남의 지점','x'),'oda');
await save(O,'campaign','c1',{id:'c1',brandId:'oda',storeId:'s1',title:'이문 오픈'});
const T=so.koreaToday(),W0=sa.weekStart(T),LF=sa.addDays(W0,-7),d=n=>sa.addDays(LF,n);
const LW=cr.isoWeekOfDate(LF),CUR=cr.isoWeekOfDate(T),FUT=cr.isoWeekOfDate(sa.addDays(W0,7)),PPW=cr.isoWeekOfDate(d(-14));
const at=day=>new Date(`${day}T00:30:00+09:00`).toISOString();
const pub=(id,status)=>save(O,'execution_publication',id,{id,campaignId:'c1',creativeId:'cr1',creativeVersion:1,campaignVersion:1,pngHash:'h',factRefs:[],caption:'캡션',mediaUrl:'',scheduledAt:at(d(-20)),plannedCostKRW:0,version:1,status,createdAt:'x'},'c1');
await pub('p-live','published');await pub('p-can','cancelled');
const zero={foodCost:0,packagingCost:0,fees:0,deliveryCost:0,benefitCost:0},unknown={foodCost:null,packagingCost:null,fees:null,deliveryCost:null,benefitCost:null};
const PHONE='010-2345-6789';
let seq=0;
const order=async(storeId,over)=>{const id='o'+(++seq),o={id,storeId,source:'pos',orderNumber:'N'+seq,orderDate:d(0),mode:'hall',status:'paid',paidAmount:1000,refundAmount:0,costs:zero,channel:'unknown',experimentId:'',attributionEvidence:'',note:`고객 ${PHONE}`,version:1,createdAt:'x',updatedAt:'x',...over};await save(O,'store_order',id,o,storeId);return o};
const coded=(code,publicationId)=>({codeAttribution:{codeId:code,code,publicationId,conflictCodeIds:[]},channel:'social',campaignId:'c1',creativeId:'cr1',attributionEvidence:sa.autoEvidence({code,type:'coupon'})});
// 보고 주(지난주) s1: 수동 귀속·살아 있는 게시 코드·취소된 게시 코드(자동 문구 → 관문 밖)·취소 주문·원가 미상 주문
await order('s1',{orderDate:d(0),paidAmount:20000,costs:{...zero,foodCost:5000},channel:'social',campaignId:'c1',attributionEvidence:'계산대 구두 확인',newCustomer:true});
await order('s1',{orderDate:d(1),paidAmount:15000,costs:{...zero,foodCost:3000},...coded('PLIV2345','p-live'),newCustomer:false});
await order('s1',{orderDate:d(2),paidAmount:8000,costs:{...zero,foodCost:2000},...coded('PCAN2345','p-can'),newCustomer:false});
await order('s1',{orderDate:d(3),status:'cancelled',paidAmount:5000,refundAmount:5000});
const unknownOrder=await order('s1',{orderDate:d(4),paidAmount:12000,costs:unknown,newCustomer:false});
await order('s1',{orderDate:d(-7),paidAmount:9000});
await order('s1',{orderDate:d(-14),paidAmount:10000});
await order('s2',{orderDate:d(2),paidAmount:30000,channel:'naver_place',attributionEvidence:'플레이스 문의 확인'});
await order('s2',{orderDate:d(-14),paidAmount:11000});
const hex='0123456789abcdef01234567';
const spend=(storeId,id,over)=>save(O,'store_spend',id,{id,storeId,date:d(1),channel:'daangn',experimentId:'',adSpend:5000,productionCost:1000,source:`견적서 ${PHONE}`,version:1,createdAt:'x',updatedAt:'x',...over},storeId);
await spend('s1','sp1',{});
// 네이버 수집 광고비: 수집 기간이 보고 주를 걸쳐 다음 주 날짜(종료일)로 기록됐다. 보고 주 장부에는 들어가지 않고 경고만 붙어야 한다.
await spend('s1',`naver-${hex}-${d(5)}`,{date:d(9),channel:'naver_ads',adSpend:7000,productionCost:0,source:'naver_ads 수집'});
const pos=(storeId,weekStart,netSales)=>save(O,'pos_weekly_total',`${storeId}-${weekStart}`,{id:`${storeId}-${weekStart}`,storeId,weekStart,netSales,orderCount:null,source:'POS',note:`메모 ${PHONE}`,version:1,createdAt:'x',updatedAt:'x',updatedBy:{id:'u1',email:'a@b.c'}},storeId);
await pos('s1',d(0),55000);await pos('s1',d(-7),9000);
// 합산 상쇄 주(PPW): s1은 장부 10,000 · POS 11,000(불일치), s2는 장부 11,000 · POS 10,000(불일치). 합계는 21,000으로 같지만 브랜드는 통과로 세면 안 된다.
await pos('s1',d(-14),11000);await pos('s2',d(-14),10000);
await save(O,'brand_fact','f-phone',{id:'f-phone',brandId:'oda',storeId:'s1',key:'phone',value:'02-963-1234',status:'confirmed',source:'점주 확인',verifiedAt:new Date(Date.now()-86400000).toISOString(),validUntil:new Date(Date.now()+60*86400000).toISOString(),version:1},'oda');

// HTTP 도우미(legacy 헤더 = 소유자)
const as=who=>({'oai-authenticated-user-id':who});
const get=(query,headers=as(O))=>route.GET(new Request('https://agency.test/api/customer-reports'+query,{headers}));
const post=(input,headers=as(O))=>route.POST(new Request('https://agency.test/api/customer-reports',{method:'POST',headers:{'content-type':'application/json',...headers},body:JSON.stringify(input)}));
const call=async res=>{const text=await res.text();let body=null;try{body=JSON.parse(text)}catch{body=text}return {status:res.status,body,headers:res.headers}};
const G=(q,h)=>get(q,h).then(call),P=(i,h)=>post(i,h).then(call);
const idOf=(type,id,week)=>`${type}:${id}:${week}`;
const rows=()=>sql.prepare("SELECT data FROM records WHERE owner=? AND kind='customer_report' ORDER BY id").all(O).map(r=>JSON.parse(r.data));

// ── 2) 등록: kind 위치·스위치·기능표·구조 규칙 ──
const kinds=plain(registry.recordKinds),kind=kinds.find(k=>k.kind==='customer_report');
check('customer_report is a brand record outside campaign deletion',kind&&kind.parent==='brand'&&kind.campaignDeletion==='not_campaign_scoped'&&!kind.links&&!kind.purge&&!kind.blocksDeletion);
check('customer_report sits right after place_snapshot and right before brand_voice',kinds.indexOf(kind)===kinds.findIndex(k=>k.kind==='place_snapshot')+1&&kinds.indexOf(kind)===kinds.findIndex(k=>k.kind==='brand_voice')-1);
const names=Object.keys(flags.FEATURE_FLAGS);
check('a8_customer_report is a known switch, off by default, after a6_place_check',flags.FEATURE_FLAGS.a8_customer_report?.defaultEnabled===false&&names.indexOf('a8_customer_report')===names.indexOf('a6_place_check')+1&&/고객 보고서/.test(flags.FEATURE_FLAGS.a8_customer_report.description));
const featureRow=f=>plain(status.featureRows({flags:f})).find(r=>r.key==='customer-report');
check('the settings table has a customer report row that follows the switch',JSON.stringify([featureRow([{flag:'a8_customer_report',enabled:true}]).status,featureRow([{flag:'a8_customer_report',enabled:false}]).status,featureRow(null).status])==='["available","blocked","blocked"]');
check('the customer report row comes right after the place check row',(k=>k.indexOf('customer-report')===k.indexOf('place-check')+1)(plain(status.featureRows({})).map(r=>r.key)));
const src=p=>readFileSync(p,'utf8');
const switchReaders=[...readdirSync('lib').map(f=>'lib/'+f),'app/api/customer-reports/route.ts'].filter(p=>p.endsWith('.ts')&&/isEnabled\([^)]*a8_customer_report/.test(src(p)));
check('the switch is read only in lib/customer-report-server.ts',JSON.stringify(switchReaders)==='["lib/customer-report-server.ts"]'&&!/feature-flags/.test(src('app/api/customer-reports/route.ts')));
check('attributionReport is exported with one word',/^export async function attributionReport\(owner:string,store:Store,b:Record<string,unknown>\)\{/m.test(src('lib/store-operations-server.ts')));

// ── 3) 스위치 꺼짐: 미리보기·동결 409, 목록은 읽힘 ──
let r=await G(`?storeId=s1&week=${LW}`);
check('switch off: preview is a 409',r.status===409&&/a8_customer_report/.test(r.body.error));
r=await P({action:'freeze',storeId:'s1',week:LW,confirmed:true,expected:{orders:4,netRevenue:55000,posStatus:'pass'}});
check('switch off: freeze is a 409 and writes nothing',r.status===409&&rows().length===0);
r=await G(`?brandId=oda&from=${LW}&to=${LW}`);
check('switch off: the frozen list still reads',r.status===200&&r.body.enabled===false&&r.body.preview===null&&Array.isArray(r.body.frozen));
await flags.setFeatureFlag(O,{flag:'a8_customer_report',enabled:true},{id:O,email:null});

// ── 4) 미리보기: 저장 안 함, 합계 = attributionReport(게시 관문 재검사), 주를 걸친 네이버 광고비 경고 ──
const before=sql.prepare('SELECT COUNT(*) n, MAX(updated_at) m FROM records').get();
r=await G(`?storeId=s1&week=${LW}`);
const preview=r.body.preview,s1=await server.readRecord(O,'store','s1');
check('preview returns the report payload with confirm values and no write',r.status===200&&r.body.enabled===true&&preview.schema==='collective.customer-report.v1'&&r.body.id===idOf('store','s1',LW)&&r.body.closed===true&&(a=>a.n===before.n&&a.m===before.m)(sql.prepare('SELECT COUNT(*) n, MAX(updated_at) m FROM records').get()));
const ar=plain(await ops.attributionReport(O,s1,{from:d(0),to:d(6)})),wk=ar.weeks.find(w=>w.weekStart===d(0)),row=preview.completeness.find(c=>c.week===LW);
check('report totals equal attributionReport totals (orders, net revenue, contribution, records)',['orders','netRevenue','contribution','records','unknownCostOrders','newCustomers'].every(k=>preview.ledger.current[k]===ar.totals[k])&&preview.ledger.current.orders===4&&preview.ledger.current.netRevenue===55000&&preview.ledger.current.contribution===null);
check('report week completeness equals attributionReport week (regated days)',row&&row.ledgerNet===wk.ledgerNet&&row.attributedOrders===wk.attributedOrders&&row.attributedContribution===wk.attributedContribution&&row.status===wk.status&&row.status==='pass');
check('the cancelled-publication order leaves attribution in the ledger and in the POS check alike',preview.ledger.current.attributedOrders===2&&row.attributedOrders===2);
check('confirm values are the ones freeze asks for',JSON.stringify(r.body.confirm)===JSON.stringify({orders:4,netRevenue:55000,posStatus:'pass'}));
check('a Naver window that crosses into the next week is warned, not counted',preview.ledger.current.adSpend===5000&&preview.spendWarnings.length===1&&preview.spendWarnings[0].counted===false&&preview.spendWarnings[0].to===d(9));
check('the preview carries no order memo, cost source or POS memo text',!JSON.stringify(r.body).includes(PHONE)&&!JSON.stringify(r.body).includes('견적서'));
check('the confirmed store phone is the business phone',preview.scope.businessPhone==='02-963-1234'&&preview.scope.address==='서울 동대문구 이문로 12'&&preview.facts.effective===1);
r=await G(`?storeId=s1&week=${CUR}`);
check('an in-progress week previews but is not closed',r.status===200&&r.body.closed===false);
for(const q of [`?storeId=s1&week=${FUT}`,'?storeId=s1&week=2026-W54','?storeId=s1&week=2026-39','?storeId=s1','?week='+LW,''])check('bad preview query is a 400: '+q,(await G(q)).status===400);

// ── 5) 동결: 확인 필수, 진행 중·미래 주 400, 확인 값 불일치 409, 판·이력 ──
const expected={orders:4,netRevenue:55000,posStatus:'pass'},freeze=(over={},h)=>P({action:'freeze',storeId:'s1',week:LW,confirmed:true,expected,...over},h);
check('freeze without confirmation is a 400',(await freeze({confirmed:undefined})).status===400&&(await freeze({expected:undefined})).status===400);
check('freezing the in-progress week is a 400',(await freeze({week:CUR})).status===400);
check('freezing a future week is a 400',(await freeze({week:FUT})).status===400);
for(const e of [{...expected,orders:5},{...expected,netRevenue:54000},{...expected,posStatus:'fail'}])check('a changed confirm value is a 409: '+JSON.stringify(e),(await freeze({expected:e})).status===409);
check('rejected freezes write nothing',rows().length===0);
r=await freeze();
check('freeze stores version 1 under the deterministic id',r.status===200&&r.body.id===idOf('store','s1',LW)&&r.body.version===1&&rows().length===1&&rows()[0].version===1&&rows()[0].review===null);
const v1=rows()[0];
check('the frozen row keeps the report, the input fingerprint and who froze it (id and role only)',v1.report.schema==='collective.customer-report.v1'&&/^[0-9a-f]{64}$/.test(v1.inputHash)&&JSON.stringify(v1.frozenBy)===JSON.stringify({id:O,role:'owner'})&&v1.scope.brandId==='oda'&&v1.week===LW);
check('the frozen row is stored under the brand',sql.prepare("SELECT parent_id p FROM records WHERE owner=? AND kind='customer_report'").get(O).p==='oda');
r=await P({action:'review',id:v1.id,version:1});
check('the owner reviews version 1',r.status===200&&r.body.review.status==='reviewed'&&r.body.review.reportVersion===1&&r.body.review.by.role==='owner'&&rows()[0].review.reportVersion===1);
r=await freeze();
const v2=rows()[0];
check('freezing again bumps the version and keeps the old one in history with its review',r.status===200&&r.body.version===2&&v2.version===2&&v2.review===null&&v2.history.length===1&&v2.history[0].version===1&&v2.history[0].review.reportVersion===1);
check('reviewing the old version is a 409',(await P({action:'review',id:v1.id,version:1})).status===409);
check('reviewing an unknown report is a 404',(await P({action:'review',id:idOf('store','s1',PPW),version:1})).status===404);
for(let i=0;i<5;i++)await freeze();
check('history keeps at most five earlier versions',rows()[0].version===7&&rows()[0].history.length===5&&rows()[0].history[0].version===6&&rows()[0].history[4].version===2);

// ── 6) stale: 동결 뒤 주문을 고치면 stale ──
r=await G(`?storeId=s1&week=${LW}`);
check('a fresh frozen report is not stale',r.status===200&&r.body.frozen.length===1&&r.body.frozen[0].stale===false&&r.body.frozen[0].version===7);
await save(O,'store_order',unknownOrder.id,{...unknownOrder,paidAmount:13000,version:2},'s1');
r=await G(`?storeId=s1&week=${LW}`);
check('editing an order after the freeze marks the report stale',r.body.frozen[0].stale===true);
r=await G(`?brandId=oda&from=${LW}&to=${LW}`);
check('the brand list shows the same stale flag and versions',r.status===200&&r.body.frozen.length===1&&r.body.frozen[0].stale===true&&r.body.frozen[0].versions.length===6);
await save(O,'store_order',unknownOrder.id,{...unknownOrder,version:3},'s1');
check('the stale flag follows the data, not the edit count (back to the frozen numbers is still a change)',(await G(`?storeId=s1&week=${LW}`)).body.frozen[0].stale===true);
r=await P({action:'freeze',storeId:'s1',week:LW,confirmed:true,expected});
check('refreezing clears stale',r.status===200&&(await G(`?storeId=s1&week=${LW}`)).body.frozen[0].stale===false);
check('the owner reviews the current version',(await P({action:'review',id:v1.id,version:8})).status===200);

// ── 7) 다운로드: 첨부·no-store·nosniff, 판 선택 ──
const dl=await G(`?id=${encodeURIComponent(v1.id)}&format=md`);
const frozenNow=rows()[0];
check('markdown download is an attachment with no-store and nosniff',dl.status===200&&dl.headers.get('content-type')==='text/markdown; charset=utf-8'&&dl.headers.get('content-disposition')===`attachment; filename="${cr.reportFileName(frozenNow.report,'md')}"`&&dl.headers.get('cache-control')==='no-store'&&dl.headers.get('x-content-type-options')==='nosniff');
check('markdown download is the frozen report rendering',dl.body===cr.reportMarkdown(frozenNow.report));
const dj=await G(`?id=${encodeURIComponent(v1.id)}&format=json`),dc=await G(`?id=${encodeURIComponent(v1.id)}&format=csv`);
check('json and csv downloads are attachments of the same frozen report',dj.status===200&&dj.headers.get('content-type')==='application/json; charset=utf-8'&&JSON.stringify(dj.body)===JSON.stringify(frozenNow.report)&&dc.status===200&&dc.headers.get('content-type')==='text/csv; charset=utf-8'&&Buffer.from(await (await get(`?id=${encodeURIComponent(v1.id)}&format=csv`)).arrayBuffer()).equals(Buffer.from(cr.reportCsv(frozenNow.report),'utf8'))&&/attachment; filename=".*\.csv"/.test(dc.headers.get('content-disposition')));
const old=await G(`?id=${encodeURIComponent(v1.id)}&format=json&version=6`);
check('an earlier version downloads from history',old.status===200&&JSON.stringify(old.body)===JSON.stringify(frozenNow.history.find(h=>h.version===6).report));
check('bad download queries: unknown format 400, unknown version 404, unknown id 404, malformed id 400',(await G(`?id=${encodeURIComponent(v1.id)}&format=pdf`)).status===400&&(await G(`?id=${encodeURIComponent(v1.id)}&format=md&version=1`)).status===404&&(await G(`?id=${encodeURIComponent(idOf('store','s2',LW))}&format=md`)).status===404&&(await G('?id=bad&format=md')).status===400);

// ── 8) 브랜드 범위: 지점별 대조 후 합산 ──
r=await G(`?brandId=oda&week=${LW}`);
let brand=r.body.preview,brow=brand.completeness.find(c=>c.week===LW);
check('brand preview sums the stores',r.status===200&&r.body.id===idOf('brand','oda',LW)&&brand.scope.type==='brand'&&brand.ledger.current.orders===5&&brand.ledger.current.netRevenue===55000+30000);
check('one store without POS makes the brand week missing_pos',brow.status==='missing_pos'&&brow.posNet===null);
await pos('s2',d(0),30000);
brand=(await G(`?brandId=oda&week=${LW}`)).body.preview;brow=brand.completeness.find(c=>c.week===LW);
check('when every store with records passes, the brand POS is the sum and passes',brow.status==='pass'&&brow.posNet===85000&&brow.ledgerNet===85000);
const ppw=brand.completeness.find(c=>c.week===PPW),pw=brand.completeness.find(c=>c.week===cr.isoWeekOfDate(d(-7)));
check('store mismatches that cancel out in the sum do not pass for the brand',ppw.status!=='pass'&&!brand.northStar.weeks.includes(PPW));
check('a store with no records and no POS that week does not block the brand',pw.status==='pass'&&pw.posNet===9000);
check('store scope still shows its own mismatch that week',(await G(`?storeId=s1&week=${LW}`)).body.preview.completeness.find(c=>c.week===PPW).status==='fail');
r=await P({action:'freeze',brandId:'oda',week:LW,confirmed:true,expected:{orders:5,netRevenue:85000,posStatus:'pass'}});
check('a brand report freezes under brand:<id>:<week>',r.status===200&&r.body.id===idOf('brand','oda',LW)&&r.body.version===1);
const phoneFact=await server.readRecord(O,'brand_fact','f-phone');
check('a fresh brand report is not stale',(await G(`?brandId=oda&from=${LW}&to=${LW}`)).body.frozen.every(f=>f.stale===false));
await save(O,'brand_fact','f-phone',{...phoneFact,version:2},'oda');
r=await G(`?brandId=oda&from=${LW}&to=${LW}`);
check('a store fact change stales the store report but not the brand report (brand scope reads brand facts only)',r.body.frozen.find(f=>f.id===idOf('store','s1',LW)).stale===true&&r.body.frozen.find(f=>f.id===idOf('brand','oda',LW)).stale===false);
r=await G(`?brandId=oda&from=${cr.isoWeekOfDate(d(-21))}&to=${LW}`);
check('the brand list has the store and brand reports of the brand',r.status===200&&r.body.frozen.map(f=>f.id).sort().join()===[idOf('brand','oda',LW),idOf('store','s1',LW)].sort().join());
r=await G(`?brandId=oda&storeId=s1&from=${LW}&to=${LW}`);
check('the brand list can be narrowed to one store',r.status===200&&r.body.frozen.length===1&&r.body.frozen[0].id===idOf('store','s1',LW));
check('the list is at most 26 weeks and from must not be after to',(await G(`?brandId=oda&from=${cr.isoWeekOfDate(sa.addDays(LF,-7*26))}&to=${LW}`)).status===400&&(await G(`?brandId=oda&from=${cr.isoWeekOfDate(sa.addDays(LF,-7*25))}&to=${LW}`)).status===200&&(await G(`?brandId=oda&from=${LW}&to=${PPW}`)).status===400);

// ── 9) 사실 팩: 첨부, 확정 사실만 ──
const fp=await G('?type=fact_pack&brandId=oda&storeId=s1&format=json');
check('fact pack json is an attachment of the confirmed facts',fp.status===200&&fp.headers.get('content-type')==='application/json; charset=utf-8'&&/^attachment; filename="fact-pack-oda-s1-\d{4}-\d{2}-\d{2}\.json"$/.test(fp.headers.get('content-disposition'))&&fp.headers.get('cache-control')==='no-store'&&fp.headers.get('x-content-type-options')==='nosniff'&&fp.body.schema==='collective.fact-pack.v1'&&fp.body.facts.length===1&&fp.body.facts[0].factId==='f-phone');
const fpm=await G('?type=fact_pack&brandId=oda&format=md'),fpc=await G('?type=fact_pack&brandId=oda&storeId=s1&format=csv');
check('fact pack markdown and csv download',fpm.status===200&&fpm.headers.get('content-type')==='text/markdown; charset=utf-8'&&fpm.body.startsWith('# 사실 팩')&&fpc.status===200&&fpc.body.includes('f-phone'));
check('fact pack of a store of another brand is a 404',(await G('?type=fact_pack&brandId=big&storeId=s1&format=json')).status===404);

// ── 10) 다른 워크스페이스: 404 ──
check('another owner store is a 404 for preview and freeze',(await G(`?storeId=sx&week=${LW}`)).status===404&&(await P({action:'freeze',storeId:'sx',week:LW,confirmed:true,expected})).status===404);
check('another owner brand is a 404 for brand preview and list',(await G(`?brandId=nope&week=${LW}`)).status===404&&(await G(`?brandId=nope&from=${LW}&to=${LW}`)).status===404);
await flags.setFeatureFlag(X,{flag:'a8_customer_report',enabled:true},{id:X,email:null});
check('another owner cannot download or review this owner report',(await G(`?id=${encodeURIComponent(v1.id)}&format=json`,as(X))).status===404&&(await P({action:'review',id:v1.id,version:8},as(X))).status===404);
check('another owner reading its own brand sees none of this owner reports',(r=>r.status===200&&r.body.frozen.length===0)(await G(`?brandId=oda&from=${LW}&to=${LW}`,as(X))));

// ── 11) 크기 상한 ──
const insert=sql.prepare('INSERT INTO records(id,owner,kind,parent_id,data,updated_at) VALUES(?,?,?,?,?,?)');
sql.exec('BEGIN');for(let i=0;i<900;i++){const id='dr'+i;insert.run(`${O}:data_request:${id}`,O,'data_request','big',JSON.stringify({id,brandId:'big',status:'open',factKey:null,label:'매장 입구 사진과 메뉴판 사진을 새로 찍어 올려 주세요 '.repeat(4)+i,text:'x'}),new Date().toISOString())}sql.exec('COMMIT');
r=await G(`?storeId=sb&week=${LW}`);
check('an oversized preview says so',r.status===200&&r.body.bytes>crs.REPORT_MAX_BYTES&&r.body.tooLarge===true);
r=await P({action:'freeze',storeId:'sb',week:LW,confirmed:true,expected:{orders:0,netRevenue:0,posStatus:'missing_pos'}});
check('freezing a report over the size limit is a 413 and writes nothing',r.status===413&&!rows().some(x=>x.id===idOf('store','sb',LW)));

// ── 12) 스위치를 다시 끄면: 미리보기·동결 409, 동결본 목록·다운로드는 계속 ──
await flags.setFeatureFlag(O,{flag:'a8_customer_report',enabled:false},{id:O,email:null});
check('switch off again: preview and freeze are 409',(await G(`?storeId=s1&week=${LW}`)).status===409&&(await P({action:'freeze',storeId:'s1',week:LW,confirmed:true,expected})).status===409);
check('switch off again: review is a 409 too (a write)',(await P({action:'review',id:v1.id,version:8})).status===409);
check('switch off again: frozen list and downloads still read',(await G(`?brandId=oda&from=${LW}&to=${LW}`)).body.frozen.length===2&&(await G(`?id=${encodeURIComponent(v1.id)}&format=md`)).status===200);
check('switch off again: fact pack is a 409',(await G('?type=fact_pack&brandId=oda&format=json')).status===409);
await flags.setFeatureFlag(O,{flag:'a8_customer_report',enabled:true},{id:O,email:null});

// ── 13) 이메일 인증: 직원 403, 관리자 동결 가능·검토 불가, 대표 검토, 비로그인 401, 다른 출처 403 ──
Object.assign(env,{AUTH_MODE:'email',AUTH_ORIGIN:'https://agency.test'});
const sha=v=>createHash('sha256').update(v).digest('hex');
const signIn=(id,role,createdAt,ws)=>{const token=sha(id);sql.prepare('INSERT INTO auth_users(id,email,workspace_owner,role,status,created_at) VALUES(?,?,?,?,?,?)').run(id,id+'@test.invalid',ws,role,'active',createdAt);sql.prepare('INSERT INTO auth_sessions VALUES(?,?,?,?)').run(sha(token),id,Date.now()+60000,Date.now());return {cookie:'__Host-collective_session='+token}};
const ownerS=signIn('a82-first','admin',1000,O),adminS=signIn('a82-admin','admin',2000,O),memberS=signIn('a82-member','member',500,O);
const origin=h=>({...h,origin:'https://agency.test'});
const memberCalls=await Promise.all([G(`?storeId=s1&week=${LW}`,memberS),G(`?brandId=oda&from=${LW}&to=${LW}`,memberS),G(`?id=${encodeURIComponent(v1.id)}&format=md`,memberS),G('?type=fact_pack&brandId=oda&format=json',memberS),P({action:'freeze',storeId:'s1',week:LW,confirmed:true,expected},origin(memberS)),P({action:'review',id:v1.id,version:8},origin(memberS))]);
check('member is a 403 for preview, list, download, fact pack, freeze and review',memberCalls.every(x=>x.status===403));
check('unauthenticated is a 401',(await G(`?storeId=s1&week=${LW}`,{})).status===401&&(await P({action:'freeze'},{})).status===401);
check('a cross-origin write is a 403',(await P({action:'freeze',storeId:'s1',week:LW,confirmed:true,expected},{...adminS,origin:'https://evil.test'})).status===403);
check('admin previews and downloads',(await G(`?storeId=s1&week=${LW}`,adminS)).status===200&&(await G(`?id=${encodeURIComponent(v1.id)}&format=md`,adminS)).status===200);
r=await P({action:'freeze',storeId:'s1',week:LW,confirmed:true,expected},origin(adminS));
check('admin freezes (version 9) with the admin role recorded',r.status===200&&r.body.version===9&&rows().find(x=>x.id===v1.id).frozenBy.role==='admin');
check('admin cannot review',(await P({action:'review',id:v1.id,version:9},origin(adminS))).status===403);
r=await P({action:'review',id:v1.id,version:9},origin(ownerS));
check('the owner reviews with an id and role only (no email)',r.status===200&&JSON.stringify(rows().find(x=>x.id===v1.id).review.by)===JSON.stringify({id:'a82-first',role:'owner'})&&!JSON.stringify(rows()).includes('@test.invalid'));
check('reviewing the same version again returns the review without a new write',(await P({action:'review',id:v1.id,version:9},origin(ownerS))).status===200);

// ── 14) 토큰 0: provider_usage 0건, 외부 호출 0회 ──
check('no provider usage row was written',sql.prepare("SELECT COUNT(*) n FROM records WHERE kind='provider_usage'").get().n===0);
check('no external call was made (no HERMES, no model)',fetchCalls===0);
check('the server module does not import HERMES, model or network code',!/hermes|openai|fetch\(|role-execution|execution-server/.test(src('lib/customer-report-server.ts'))&&!/hermes|openai|fetch\(/.test(src('app/api/customer-reports/route.ts')));
check('the route has only GET and POST',!('PUT' in route)&&!('DELETE' in route));
console.log(JSON.stringify({passed:passed.length},null,1));
