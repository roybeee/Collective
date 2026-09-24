// PR 4b-2 캠페인 성과 탭의 주문 장부 귀속 집계 회귀: 주 단위(한국시간 월~일) 귀속 주문 수·순매출·공헌이익, 원가 미입력 null 전파,
// 게시 관문 재판정(publicationGateView), 코드 귀속·수동 귀속 구분, 지점·소재·게시별 분해, 브랜드 공통 캠페인의 여러 지점(보관 지점 포함) 합산,
// 다른 브랜드·지점 주문 제외, 기간 경계·한도, 점포 귀속 보고와 같은 주문 집합에서 같은 숫자(교차 검증),
// schemaVersion 2 metric 스냅샷 저장(확인 필수·확인 값 필수·오늘 끝나는 기간 400·기간 겹침 409·빈 기간 400·확인 뒤 바뀐 집계 409), 권한(기존 성과 입력과 같음), 화면 연결.
// 근거: mocked(메모리 SQLite, 로컬 인증 헤더·이메일 세션). 외부 네트워크 호출은 0회다.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {testRuntime} from './helpers/runtime.mjs';

const rt=testRuntime(async()=>{throw new Error('외부 호출 금지')});
const {sql,env}=rt;
const passed=[];const check=(name,val)=>{assert.ok(val,name);passed.push(name)};
const plain=x=>JSON.parse(JSON.stringify(x));
const sa=await rt.load('lib/store-attribution.ts'),server=await rt.load('lib/server.ts'),logic=await rt.load('lib/store-operations.ts'),ops=await rt.load('lib/store-operations-server.ts');
const ca=await rt.load('lib/campaign-attribution.ts'),route=await rt.load('app/api/campaign-attribution/route.ts'),action=await rt.load('app/api/action/route.ts');

// 1) 준비: 같은 브랜드 지점 2곳(하나는 보관), 다른 브랜드 지점 1곳, 지점 캠페인·브랜드 공통 캠페인, 소재, 게시(게시 확인·취소·승인 전·예약 접수)
const owner='pr4b2-owner-production-authenticated-id';
const save=(kind,id,data,parent='')=>server.recordStatement(owner,kind,id,data,parent).run();
await save('store','s1',{id:'s1',brandId:'oda',name:'휘경점',status:'active',version:1},'oda');
await save('store','s2',{id:'s2',brandId:'oda',name:'회기점',status:'archived',version:1},'oda');
await save('store','s3',{id:'s3',brandId:'ofd',name:'다른 브랜드 지점',status:'active',version:1},'ofd');
const c1={id:'c1',brandId:'oda',storeId:'s1',title:'휘경 오픈'},cw={id:'cw',brandId:'oda',title:'브랜드 공통'},cn={id:'cn',brandId:'oda',title:'주문 없는 캠페인'};
for(const c of [c1,cw,cn])await save('campaign',c.id,c);
await save('execution_creative','cr1',{id:'cr1',campaignId:'c1',brandId:'oda',storeId:'s1',version:1,title:'오픈 주소 안내 v1',createdAt:'2026-09-01T00:00:00.000Z'},'c1');
await save('execution_creative','cr-w',{id:'cr-w',campaignId:'cw',brandId:'oda',version:1,caption:'주소: 휘경동 377 C107\n영업시간: 11시',createdAt:'2026-09-22T15:05:00.000Z'},'cw');
const T=logic.koreaToday(),W0=sa.addDays(sa.weekStart(T),-21),d=n=>sa.addDays(W0,n),at=(day,hm='00:30')=>new Date(`${day}T${hm}:00+09:00`).toISOString();
const pub=(id,status,campaignId='c1',creativeId='cr1')=>save('execution_publication',id,{id,campaignId,creativeId,creativeVersion:1,campaignVersion:1,pngHash:'h',factRefs:[],caption:'캡션',mediaUrl:'',scheduledAt:at(d(-10)),plannedCostKRW:0,version:1,status,createdAt:'x'},campaignId);
await pub('p-live','published');await pub('p-can','cancelled');await pub('p-draft','draft');await pub('p-w','accepted','cw','cr-w');
const code=(id,over={})=>save('tracking_code',id,{id,code:id,type:'coupon',storeId:'s1',campaignId:'c1',label:'',validFrom:d(-30),createdAt:'x',createdBy:{id:owner,email:null},version:1,...over},over.storeId||'s1');
await code('PLIV2345',{creativeId:'cr1',publicationId:'p-live'});await code('PCAN2345',{creativeId:'cr1',publicationId:'p-can'});await code('PDRA2345',{creativeId:'cr1',publicationId:'p-draft'});await code('CXYZ2345');
const zero={foodCost:0,packagingCost:0,fees:0,deliveryCost:0,benefitCost:0},unknown={foodCost:null,packagingCost:null,fees:null,deliveryCost:null,benefitCost:null};
let seq=0;
const put=async(storeId,over)=>{const id='o'+(++seq),o={id,storeId,source:'pos',orderNumber:'N'+seq,orderDate:d(0),mode:'hall',status:'paid',paidAmount:1000,refundAmount:0,costs:zero,channel:'unknown',experimentId:'',attributionEvidence:'',note:'',version:1,createdAt:'x',updatedAt:'x',...over};await save('store_order',id,o,storeId);return o};
const coded=(codeId,publicationId)=>({codeAttribution:{codeId,code:codeId,...(publicationId?{publicationId}:{}),conflictCodeIds:[]},channel:'social',attributionEvidence:sa.autoEvidence({code:codeId,type:'coupon'})});
// 지점 캠페인 c1(휘경점): 1주차(d0~d6), 2주차(d7~d13).
await put('s1',{orderDate:d(0),paidAmount:10000,costs:{...zero,foodCost:3000},campaignId:'c1',creativeId:'cr1',channel:'social',attributionEvidence:'계산대 구두 확인'});
await put('s1',{orderDate:d(6),paidAmount:20000,refundAmount:5000,costs:unknown,campaignId:'c1',creativeId:'cr1',...coded('PLIV2345','p-live')});
await put('s1',{orderDate:d(7),paidAmount:8000,costs:{...zero,foodCost:2000},campaignId:'c1',creativeId:'cr1',...coded('PCAN2345','p-can')});
await put('s1',{orderDate:d(7),paidAmount:5000,costs:{...zero,fees:500},campaignId:'c1',creativeId:'cr1',...coded('PCAN2345','p-can'),attributionEvidence:'계산대에서 쿠폰 제시 확인'});
await put('s1',{orderDate:d(13),paidAmount:7000,costs:{...zero,foodCost:1000},campaignId:'c1',...coded('CXYZ2345')});
await put('s1',{orderDate:d(8),paidAmount:3000,refundAmount:3000,status:'cancelled',campaignId:'c1',channel:'social',attributionEvidence:'취소 주문'});
await put('s1',{orderDate:d(8),paidAmount:4400,campaignId:'c1',creativeId:'cr1',...coded('PDRA2345','p-draft')});
await put('s1',{orderDate:d(-1),paidAmount:9999,campaignId:'c1',channel:'social',attributionEvidence:'기간 전날'});
await put('s1',{orderDate:d(14),paidAmount:1111,campaignId:'c1',channel:'social',attributionEvidence:'기간 다음 날'});
await put('s1',{orderDate:d(3),paidAmount:6000});
await put('s2',{orderDate:d(3),paidAmount:7777,campaignId:'c1',channel:'social',attributionEvidence:'다른 지점에 잘못 연결'});
// 브랜드 공통 캠페인 cw: 휘경점·보관한 회기점 주문을 합치고, 다른 브랜드 지점 주문은 뺀다.
await put('s1',{orderDate:d(1),paidAmount:4000,costs:{...zero,foodCost:1500},campaignId:'cw',creativeId:'cr-w',channel:'social',attributionEvidence:'전단 확인'});
await put('s2',{orderDate:d(9),paidAmount:6000,costs:{...zero,foodCost:2500},campaignId:'cw',channel:'social',attributionEvidence:'구두 확인'});
await put('s3',{orderDate:d(2),paidAmount:50000,campaignId:'cw',channel:'social',attributionEvidence:'다른 브랜드'});
const period={from:d(0),to:d(13)};
const settle=promise=>promise.then(value=>({status:200,body:plain(value)}),e=>{if(typeof e?.status==='number')return {status:e.status,error:e.message};throw e});

// 2) 기간: 기본 최근 8주(이번 주 포함), 한국 날짜, 최대 26주(182일), 시작 ≤ 종료 ≤ 오늘
let res=await settle(ca.campaignAttribution(owner,c1));
check('the default period is the last 8 weeks up to today',res.status===200&&res.body.period.to===T&&res.body.period.from===sa.addDays(sa.weekStart(T),-49)&&res.body.weeks.length===8);
check('a period of 182 days is allowed',(await settle(ca.campaignAttribution(owner,c1,{from:sa.addDays(T,-181),to:T}))).status===200);
check('a period longer than 26 weeks is refused',(await settle(ca.campaignAttribution(owner,c1,{from:sa.addDays(T,-182),to:T}))).status===400);
check('a start after the end is refused',(await settle(ca.campaignAttribution(owner,c1,{from:d(5),to:d(4)}))).status===400);
check('an end after today is refused',(await settle(ca.campaignAttribution(owner,c1,{from:T,to:sa.addDays(T,1)}))).status===400);
check('a malformed date is refused',(await settle(ca.campaignAttribution(owner,c1,{from:'2026-02-30',to:T}))).status===400);

// 3) 지점 캠페인 집계: 수치, 원가 미입력 null 전파, 게시 관문, 코드·수동 구분, 주 단위, 기간 경계
res=await settle(ca.campaignAttribution(owner,c1,period));
const r=res.body,week=start=>r.weeks.find(w=>w.weekStart===start),row=(list,key)=>list.find(g=>g.key===key);
check('the campaign totals count paid orders, net revenue and records in the period',res.status===200&&r.totals.orders===4&&r.totals.records===5&&r.totals.netRevenue===37000);
check('an unknown order cost keeps the contribution null instead of zero',r.totals.contribution===null&&r.totals.unknownCostOrders===1);
check('weeks run Monday to Sunday in Korean dates',r.weeks.length===2&&week(d(0)).end===d(6)&&week(d(7)).start===d(7)&&week(d(7)).end===d(13));
check('the first week has the Monday and Sunday orders',week(d(0)).orders===2&&week(d(0)).netRevenue===25000&&week(d(0)).contribution===null);
check('a week with known costs has a number and a week with an unknown cost stays null',week(d(7)).orders===2&&week(d(7)).netRevenue===12000&&week(d(7)).contribution===12000-500-1000);
check('orders the day before and the day after the period are out',!r.weeks.some(w=>w.netRevenue===9999||w.netRevenue===1111)&&r.totals.netRevenue===37000);
const wider=(await settle(ca.campaignAttribution(owner,c1,{from:d(-1),to:d(13)}))).body;
check('widening the start by one day brings in that day',wider.totals.netRevenue===37000+9999&&wider.weeks[0].weekStart===sa.weekStart(d(-1))&&wider.weeks[0].start===d(-1)&&wider.weeks[0].end===d(-1));
check('an order of a cancelled publication with the automatic wording leaves the campaign',!r.byCreative.some(g=>g.netRevenue===8000)&&r.totals.netRevenue===37000);
check('an order of a pending publication leaves the campaign until it goes live',!r.weeks.some(w=>w.netRevenue===12000+4400));
check('a person-written evidence keeps the order as a manual attribution after the gate',row(r.byMethod,'manual').orders===2&&row(r.byMethod,'manual').records===3&&row(r.byMethod,'manual').netRevenue===15000);
check('code attribution counts only orders whose code passes the gate',row(r.byMethod,'code').orders===2&&row(r.byMethod,'code').netRevenue===22000&&row(r.byMethod,'code').label==='추적 코드 귀속'&&row(r.byMethod,'manual').label==='수동 귀속');
check('the publication rows keep only the live publication with its code',r.byPublication.length===1&&r.byPublication[0].key==='p-live'&&r.byPublication[0].orders===1&&r.byPublication[0].netRevenue===15000&&r.byPublication[0].codes.join()==='PLIV2345');
check('a publication row is labelled with the creative, Korean schedule and status',r.byPublication[0].label===`오픈 주소 안내 v1 · 예약 ${d(-10)} 00:30 · 게시 확인`);
check('the creative rows use the creative title and keep campaign-only orders apart',row(r.byCreative,'cr1').label==='오픈 주소 안내 v1'&&row(r.byCreative,'cr1').orders===3&&row(r.byCreative,'').orders===1&&row(r.byCreative,'').records===2&&row(r.byCreative,'').label.includes('소재 미지정'));
check('a store campaign counts only its own store',r.byStore.length===1&&r.byStore[0].key==='s1'&&r.byStore[0].label==='휘경점'&&r.excluded.outOfScope===1);
check('the gate counts are reported',r.excluded.publicationGate===3&&r.excluded.unattributedByGate===2&&r.notes.some(x=>x.includes('게시 관문 밖 3건')&&x.includes('2건')));
check('the attribution caveat comes first',r.notes[0]===sa.ATTRIBUTION_NOT_INCREMENTAL&&r.notes[0].includes('귀속≠증분'));
check('the report names the snapshot source and scope',r.snapshot.source==='주문 장부 귀속'&&r.snapshot.scope===ca.SNAPSHOT_SCOPE&&r.scope==='store');

// 4) 브랜드 공통 캠페인: 같은 브랜드의 모든 지점(보관 지점 포함) 합산, 다른 브랜드 주문 제외
const w=(await settle(ca.campaignAttribution(owner,cw,period))).body;
check('a brand-wide campaign adds up the orders of every store of the brand',w.totals.orders===2&&w.totals.netRevenue===10000&&w.totals.contribution===10000-1500-2500&&w.scope==='brand');
check('the store rows list each store, an archived store included',w.byStore.length===2&&row(w.byStore,'s1').netRevenue===4000&&row(w.byStore,'s2').netRevenue===6000&&row(w.byStore,'s2').label==='회기점 · 보관');
check('an order of another brand pointing at the campaign is left out and counted',w.excluded.outOfScope===1&&!w.byStore.some(g=>g.key==='s3')&&w.notes.some(x=>x.includes('밖 주문 1건')));
check('an untitled creative gets the readable fallback label',row(w.byCreative,'cr-w').label==='소재 · 9월 23일 00:05 생성 · 주소: 휘경동 377 C107');
const none=(await settle(ca.campaignAttribution(owner,cn,period))).body;
check('a campaign without orders has zero totals and empty rows',none.totals.records===0&&none.totals.orders===0&&none.byStore.length===0&&none.byPublication.length===0&&none.weeks.every(x=>x.orders===0));

// 5) 교차 검증: 점포 귀속 보고와 같은 주문 집합에서 같은 숫자
const legacyReq=()=>new Request('https://agency.test/api/store-operations',{method:'POST',headers:{'oai-authenticated-user-id':owner}});
const report=async storeId=>plain(await ops.measurementAction(legacyReq(),owner,plain(await server.readRecord(owner,'store',storeId)),{action:'attribution_report',...period}));
const pick=g=>g&&JSON.stringify([g.records,g.orders,g.netRevenue,g.contribution,g.unknownCostOrders]);
const s1=await report('s1'),s2=await report('s2');
check('the store report campaign row equals the campaign totals',pick(s1.byCampaign.find(g=>g.key==='c1'))===pick(r.totals));
check('the store report creative row equals the campaign creative row',pick(s1.byCreative.find(g=>g.key==='c1·cr1'))===pick(row(r.byCreative,'cr1')));
check('the store report publication row equals the campaign publication row',pick(s1.byPublication.find(g=>g.key==='p-live'))===pick(r.byPublication[0])&&s1.byPublication.find(g=>g.key==='p-live').codes.join()===r.byPublication[0].codes.join());
check('each store report campaign row equals the brand-wide store row',pick(s1.byCampaign.find(g=>g.key==='cw'))===pick(row(w.byStore,'s1'))&&pick(s2.byCampaign.find(g=>g.key==='cw'))===pick(row(w.byStore,'s2')));
const sumRows=(a,b)=>JSON.stringify([a.records+b.records,a.orders+b.orders,a.netRevenue+b.netRevenue,a.contribution+b.contribution,a.unknownCostOrders+b.unknownCostOrders]);
check('the brand-wide totals equal the sum of the store reports',sumRows(s1.byCampaign.find(g=>g.key==='cw'),s2.byCampaign.find(g=>g.key==='cw'))===pick(w.totals));
check('the weekly rows add up to the totals',r.weeks.reduce((n,x)=>n+x.orders,0)===r.totals.orders&&r.weeks.reduce((n,x)=>n+x.netRevenue,0)===r.totals.netRevenue);

// 6) 라우트: GET 집계, POST action=snapshot → schemaVersion 2 metric
const get=async(query,headers={'oai-authenticated-user-id':owner})=>{const res=await route.GET(new Request('https://agency.test/api/campaign-attribution?'+new URLSearchParams(query),{headers}));return {status:res.status,...await res.json()}};
const post=async(body,headers={'oai-authenticated-user-id':owner})=>{const res=await route.POST(new Request('https://agency.test/api/campaign-attribution',{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body)}));return {status:res.status,...await res.json()}};
res=await get({campaignId:'c1',...period});
check('GET returns the same aggregation as the library',res.status===200&&pick(res.totals)===pick(r.totals)&&res.period.from===period.from);
check('GET without a period uses the default 8 weeks',(await get({campaignId:'c1'})).weeks.length===8);
check('GET of a missing campaign is a 404',(await get({campaignId:'missing'})).status===404);
check('GET of another workspace cannot read the campaign',(await get({campaignId:'c1'},{'oai-authenticated-user-id':'other-owner'})).status===404);
check('GET without login is a 401',(await get({campaignId:'c1'},{})).status===401);
const metrics=()=>sql.prepare("SELECT data FROM records WHERE owner=? AND kind='metric' AND parent_id=?").all(owner,'c1').map(x=>JSON.parse(x.data));
const events=()=>sql.prepare("SELECT COUNT(*) n FROM records WHERE owner=? AND kind='event' AND parent_id=?").get(owner,'c1').n;
const expected={orders:r.totals.orders,netRevenue:r.totals.netRevenue,contribution:r.totals.contribution};
const confirmedOf=async(campaign,p)=>{const t=(await settle(ca.campaignAttribution(owner,campaign,p))).body.totals;return {orders:t.orders,netRevenue:t.netRevenue,contribution:t.contribution}};
const snap={action:'snapshot',campaignId:'c1',...period,confirmed:true,expected};
check('a snapshot needs the explicit confirmation',(await post({...snap,confirmed:undefined})).status===400&&metrics().length===0);
check('a snapshot needs an explicit period',(await post({...snap,from:undefined})).status===400&&metrics().length===0);
check('a snapshot whose numbers changed after the check is a 409',(await post({...snap,expected:{...expected,orders:3}})).status===409&&metrics().length===0);
check('a snapshot without the confirmed values is refused',(await post({...snap,expected:undefined})).status===400&&metrics().length===0);
const live={from:d(0),to:T};
check('a snapshot ending today is refused because the day is not closed',(await post({...snap,...live,expected:await confirmedOf(c1,live)})).status===400&&metrics().length===0);
check('an unsupported action is a 400',(await post({...snap,action:'save'})).status===400);
const eventsBefore=events();
res=await post(snap);
const m=metrics()[0];
check('the snapshot is saved as a schemaVersion 2 export metric',res.status===200&&metrics().length===1&&m.id===res.id&&m.schemaVersion===2&&m.method==='export'&&m.campaignId==='c1'&&m.version===1);
check('the snapshot names the source, scope and period',m.source==='주문 장부 귀속'&&m.scope===ca.SNAPSHOT_SCOPE&&!m.scope.includes('모든 지점')&&m.periodStart===period.from&&m.periodEnd===period.to&&m.period===`${period.from} ~ ${period.to} · ${ca.SNAPSHOT_SCOPE}`);
check('the snapshot values are the aggregation with unknown costs kept null',m.revenue===37000&&m.orders===4&&m.variableCosts===null&&m.adSpend===null&&m.productionCost===null&&m.baselineContribution===null);
check('the snapshot definition states the rule and the caveat',m.definition.includes('귀속≠증분')&&m.definition.includes(period.from)&&m.definition.includes('휘경점')&&m.definition.includes('게시 관문')&&m.definition.length<=4000);
check('the snapshot notes split code and manual attribution',m.notes.includes('추적 코드 귀속 2건')&&m.notes.includes('수동 귀속 2건'));
check('the snapshot writes a campaign event',events()===eventsBefore+1);
res=await post(snap);
check('a second snapshot of an overlapping period is a 409 from the measurement rule',res.status===409&&res.error.includes('겹칩니다')&&metrics().length===1);
check('a manual metric with the same scope and overlapping dates is refused too',(await action.POST(new Request('https://agency.test/api/action',{method:'POST',headers:{'Content-Type':'application/json','oai-authenticated-user-id':owner},body:JSON.stringify({action:'save_metric',campaignId:'c1',schemaVersion:2,periodStart:d(10),periodEnd:d(11),scope:ca.SNAPSHOT_SCOPE,source:'수기',definition:'x',method:'manual',revenue:1,variableCosts:null,adSpend:null,productionCost:null,orders:null})}))).status===409);
res=await post({...snap,from:d(14),to:d(20),expected:await confirmedOf(c1,{from:d(14),to:d(20)})});
check('a snapshot of the next period is saved',res.status===200&&metrics().length===2&&metrics().some(x=>x.periodStart===d(14)&&x.revenue===1111&&x.orders===1&&x.variableCosts===0));
check('a period without attributed orders is not saved',(await post({...snap,campaignId:'cn',expected:await confirmedOf(cn,period)})).status===400&&!sql.prepare("SELECT 1 FROM records WHERE owner=? AND kind='metric' AND parent_id='cn'").get(owner));
const ws=await post({action:'snapshot',campaignId:'cw',...period,confirmed:true,expected:await confirmedOf(cw,period)});
const wm=JSON.parse(sql.prepare("SELECT data FROM records WHERE owner=? AND kind='metric' AND parent_id='cw'").get(owner).data);
check('a brand-wide snapshot adds up every store and names them',ws.status===200&&wm.revenue===10000&&wm.orders===2&&wm.variableCosts===4000&&wm.definition.includes('휘경점')&&wm.definition.includes('회기점')&&wm.definition.includes('브랜드 공통'));

// 7) 권한: 기존 성과 입력(save_metric)과 같다. 로그인한 모든 역할, 같은 출처 요청, 로그인 필요.
env.AUTH_MODE='email';env.AUTH_ORIGIN='https://agency.test';
const signIn=(id,role,createdAt)=>{const token=createHash('sha256').update(id).digest('hex');sql.prepare('INSERT INTO auth_users(id,email,workspace_owner,role,status,created_at) VALUES(?,?,?,?,?,?)').run(id,id+'@test.invalid',owner,role,'active',createdAt);sql.prepare('INSERT INTO auth_sessions VALUES(?,?,?,?)').run(createHash('sha256').update(token).digest('hex'),id,Date.now()+60000,Date.now());return token};
const member=signIn('pr4b2-member','member',500);
const session=(token,origin='https://agency.test')=>({cookie:'__Host-collective_session='+token,...(origin?{origin}:{})});
check('a member reads the aggregation',(await get({campaignId:'c1',...period},session(member,null))).status===200);
const earlier={from:d(-7),to:d(-1)};
res=await post({action:'snapshot',campaignId:'c1',...earlier,confirmed:true,expected:await confirmedOf(c1,earlier)},session(member));
check('a member saves a snapshot like a manual metric',res.status===200&&metrics().some(x=>x.periodStart===earlier.from&&x.revenue===9999));
const saveMetric=await action.POST(new Request('https://agency.test/api/action',{method:'POST',headers:{'Content-Type':'application/json',...session(member)},body:JSON.stringify({action:'save_metric',campaignId:'c1',schemaVersion:2,periodStart:d(0),periodEnd:d(1),scope:'수기 범위',source:'수기',definition:'x',method:'manual',revenue:1,variableCosts:null,adSpend:null,productionCost:null,orders:null})}));
check('the manual metric entry also allows a member (same permission)',saveMetric.status===200);
check('a cross-origin snapshot is refused',(await post({...snap,from:d(28)},session(member,'https://evil.test'))).status===403);
check('a snapshot without login is refused',(await post(snap,{origin:'https://agency.test'})).status===401);

// 8) 화면: 성과 탭 슬롯(panels.tsx는 고치지 않는다), 로딩·오류 재시도·빈 상태·스냅샷 확인 대화, '귀속≠증분' 표기
const slot=readFileSync('app/campaign-attribution-slot.tsx','utf8'),detail=readFileSync('app/campaign-detail-panel.tsx','utf8');
check('the slot attaches to the results tab of the campaign sheet',slot.includes('[id$="-content-results"]')&&slot.includes('createPortal'));
check('the campaign detail mounts the slot and reloads after a snapshot',detail.includes("from './campaign-attribution-slot'")&&/<CampaignAttributionSlot campaignId=\{detail\.campaign\.id\} onSaved=\{reload\}\/>/.test(detail));
check('the slot shows loading, retry, empty and the caveat',slot.includes('role="status"')&&slot.includes('다시 시도')&&slot.includes('귀속된 주문이 없습니다')&&slot.includes('NOT_INCREMENTAL'));
check('the slot asks for a confirmation before saving the snapshot',slot.includes('스냅샷으로 저장')&&slot.includes('확인하고 저장')&&slot.includes('confirmed:true')&&slot.includes('expected'));
check('the slot offers the snapshot only for closed days and can re-query up to yesterday',slot.includes('어제까지로 조회')&&/closed\?<Button[^>]*onClick=\{\(\)=>setConfirming\(true\)\}/.test(slot));
check('the slot shows weeks, stores, creatives, publications and the attribution method',['주별 귀속','지점별','소재별','게시별','귀속 방식별'].every(x=>slot.includes(x)));

console.log(JSON.stringify({passed:passed.length,checks:passed},null,2));
