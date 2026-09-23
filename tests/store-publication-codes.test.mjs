// A4-2 게시 단위 귀속 회귀: 게시별 코드 발급(멱등·캠페인 검사), 수동 코드의 게시 연결, 귀속 때 게시 상태·예약 시각(한국 날짜) 검증
// (CSV 가져오기 자동 귀속·확인 전 게시 확인 요구·주문 기록 수정·보고서의 현재 상태 재판정), 게시별 집계, 소재 제목 대체 라벨, 자동 귀속 스위치 꺼짐, publicationId 없는 기존 코드 동작 불변.
// 근거: mocked(메모리 SQLite, 로컬 인증 헤더). 외부 네트워크 호출은 0회다.
import assert from 'node:assert/strict';
import {testRuntime} from './helpers/runtime.mjs';

const rt=testRuntime(async()=>{throw new Error('외부 호출 금지')});
const {sql}=rt;
const sa=await rt.load('lib/store-attribution.ts');
const passed=[];const check=(name,val)=>{assert.ok(val,name);passed.push(name)};
const plain=x=>JSON.parse(JSON.stringify(x));
const unknownCosts={foodCost:null,packagingCost:null,fees:null,deliveryCost:null,benefitCost:null};
let seq=0;
const order=(over={})=>({id:'o'+(++seq),storeId:'s1',source:'pos',orderNumber:'n'+seq,orderDate:'2026-09-15',mode:'hall',status:'paid',paidAmount:1000,refundAmount:0,costs:unknownCosts,channel:'unknown',experimentId:'',attributionEvidence:'',note:'',version:1,createdAt:'x',updatedAt:'x',...over});

// 1) 순수 규칙: 한국 시각, 게시 관문(예약 접수·게시 확인 + 예약일 이후), 코드 귀속, 게시별 집계, 라벨
check('Korean minute is UTC+9 and unknown input is empty',sa.koreaMinute('2026-09-22T15:30:00.000Z')==='2026-09-23 00:30'&&sa.koreaMinute('x')===''&&sa.koreaMinute(undefined)==='');
check('a publication gate keeps the status and the Korean scheduled day',JSON.stringify(plain(sa.publicationGate({status:'accepted',scheduledAt:'2026-09-22T15:30:00.000Z'})))==='{"status":"accepted","scheduledDay":"2026-09-23"}');
const gates=new Map([['pa',{status:'accepted',scheduledDay:'2026-09-10'}],['pp',{status:'published',scheduledDay:'2026-09-10'}],['pc',{status:'cancelled',scheduledDay:'2026-09-01'}],['pf',{status:'failed',scheduledDay:'2026-09-01'}],['pd',{status:'draft',scheduledDay:'2026-09-01'}],['pv',{status:'approved',scheduledDay:'2026-09-01'}],['ps',{status:'submitting',scheduledDay:'2026-09-01'}],['pu',{status:'uncertain',scheduledDay:'2026-09-01'}],['pb',{status:'blocked',scheduledDay:'2026-09-01'}],['pn',{status:'accepted',scheduledDay:''}]]);
check('a code without a publication is never refused',sa.publicationRefusal({},'2026-09-01',gates)===null);
check('an order before the scheduled day is refused',sa.publicationRefusal({publicationId:'pa'},'2026-09-09',gates)==='before_publication');
check('accepted and published publications pass from the scheduled day',['pa','pp'].every(id=>sa.publicationRefusal({publicationId:id},'2026-09-10',gates)===null&&sa.publicationRefusal({publicationId:id},'2026-09-11',gates)===null));
check('cancelled and failed publications are not live',['pc','pf'].every(id=>sa.publicationRefusal({publicationId:id},'2026-09-20',gates)==='not_live'));
check('draft approved submitting uncertain and blocked publications are pending (they may still go live)',['pd','pv','ps','pu','pb'].every(id=>sa.publicationRefusal({publicationId:id},'2026-09-20',gates)==='pending'));
check('an order before the scheduled day of a pending publication is refused as before the post',sa.publicationRefusal({publicationId:'pd'},'2026-08-31',gates)==='before_publication'&&sa.publicationRefusal({publicationId:'pc'},'2026-08-31',gates)==='not_live');
check('an unknown publication or schedule is refused (fail closed)',sa.publicationRefusal({publicationId:'nope'},'2026-09-20',gates)==='not_live'&&sa.publicationRefusal({publicationId:'pa'},'2026-09-20')==='not_live'&&sa.publicationRefusal({publicationId:'pn'},'2026-09-20',gates)==='not_live');
const code=(c,over={})=>({id:c,code:c,type:'coupon',storeId:'s1',campaignId:'c1',label:'',validFrom:'2026-09-01',createdAt:'x',createdBy:{id:'u',email:null},version:1,...over});
const codes=[code('PUBA',{publicationId:'pa',creativeId:'cr1'}),code('PUBC',{publicationId:'pc',creativeId:'cr1'}),code('CXYZ'),code('QPUB',{type:'qr',publicationId:'pa',creativeId:'cr1'}),code('PUBD',{publicationId:'pd',creativeId:'cr1'})];
const attr=(tokens,orderDate,g=gates)=>plain(sa.attributeByCodes(tokens.map(c=>({code:c})),codes,{storeId:'s1',orderDate},g));
let r=attr(['PUBA'],'2026-09-09');
check('a publication code before the post is not attributed and says why',r.code===null&&r.refused.length===1&&r.refused[0].codeId==='PUBA'&&r.refused[0].reason==='before_publication');
r=attr(['PUBA'],'2026-09-10');
check('a publication code from the scheduled day is attributed',r.code.id==='PUBA'&&r.refused.length===0);
r=attr(['PUBC','CXYZ'],'2026-09-20');
check('a refused publication code lets the next valid code win without a conflict',r.code.id==='CXYZ'&&r.conflict===false&&r.refused[0].reason==='not_live'&&r.matched.join()==='CXYZ');
r=attr(['PUBD'],'2026-09-20');
check('a code of a pending publication is refused as pending',r.code===null&&r.refused[0].reason==='pending');
r=attr(['PUBA','QPUB'],'2026-09-20');
check('two codes of the same publication are not a conflict',r.code.id==='PUBA'&&r.conflict===false);
const ungated=c=>plain(sa.attributeByCodes([{code:c}],codes,{storeId:'s1',orderDate:'2026-09-20'}));
check('without gates a publication code is refused',ungated('PUBA').code===null&&ungated('PUBA').refused[0].reason==='not_live');
check('without gates a code without a publication behaves as before',ungated('CXYZ').code.id==='CXYZ'&&ungated('CXYZ').refused.length===0);
const ca=(codeId,publicationId)=>({codeId,code:codeId,...(publicationId?{publicationId}:{}),conflictCodeIds:[]});
const mix=[order({campaignId:'c1',creativeId:'cr1',paidAmount:1000,codeAttribution:ca('PUBA','pa')}),order({campaignId:'c1',creativeId:'cr1',paidAmount:2500,refundAmount:500,codeAttribution:ca('QPUB','pa')}),order({campaignId:'c1',paidAmount:700,codeAttribution:ca('CXYZ')}),order({campaignId:'c1',paidAmount:900,attributionEvidence:'계산대 구두 확인'})];
const br=plain(sa.attributionBreakdown(mix,codes,undefined,{pa:'오픈 안내 v1 · 예약 2026-09-10 18:00 · 게시 확인'}));
check('by publication counts only orders attributed by a publication code',br.byPublication.length===1&&br.byPublication[0].key==='pa'&&br.byPublication[0].orders===2&&br.byPublication[0].netRevenue===3000);
check('a publication row carries its label and every code linked to it',br.byPublication[0].label==='오픈 안내 v1 · 예약 2026-09-10 18:00 · 게시 확인'&&br.byPublication[0].codes.join()==='PUBA,QPUB');
check('a publication row without a label falls back to its id',plain(sa.attributionBreakdown(mix,codes)).byPublication[0].label==='게시 pa');
check('other breakdowns are unchanged by publication codes',br.byCode.length===3&&br.byCampaign.find(g=>g.key==='c1').orders===4);
check('a creative title is shown as written',sa.creativeLabel({id:'cr-uuid',title:' 오픈 주소 안내 v1 ',createdAt:'2026-09-23T05:05:00.000Z'})==='오픈 주소 안내 v1');
check('a creative without a title gets a readable Korean-time fallback',sa.creativeLabel({id:'cr-uuid',title:'',createdAt:'2026-09-22T15:05:00.000Z'})==='소재 · 9월 23일 00:05 생성');
check('a creative without a date falls back to a short id',sa.creativeLabel({id:'abcdef123456'})==='소재 · abcdef12');
check('the store label follows the execution label and adds the first fact line',sa.creativeLabel({id:'cr-uuid',caption:'주소: 휘경동 377 C107\n영업시간: 11시',createdAt:'2026-09-22T15:05:00.000Z'})==='소재 · 9월 23일 00:05 생성 · 주소: 휘경동 377 C107');
check('a publication row label joins creative, Korean schedule and status',sa.publicationRowLabel({scheduledAt:'2026-09-10T09:00:00.000Z'},'오픈 안내','게시 확인')==='오픈 안내 · 예약 2026-09-10 18:00 · 게시 확인'&&sa.publicationRowLabel({},'소재','취소')==='소재 · 예약 시각 미확인 · 취소');
check('the import note names publication refusals only when there are some',sa.publicationImportNote({beforePublication:2,unpublished:1,pendingPublication:3})==='게시 코드로 귀속하지 않음: 게시 전 주문 2건 · 취소·발행 실패 게시 1건 · 게시 상태 확인 전 3건'&&sa.publicationImportNote({beforePublication:0,unpublished:0})===null&&sa.publicationImportNote(undefined)===null);
check('the pending warning appears only when orders wait for a publication status',sa.pendingPublicationNote({pendingPublication:2})?.includes('게시 상태 확인 전')&&sa.pendingPublicationNote({pendingPublication:2}).includes('2건')&&sa.pendingPublicationNote({pendingPublication:0})===null&&sa.pendingPublicationNote(undefined)===null);

// 1b) 게시 관문을 지금 게시 상태로 다시 본 주문(보고서·주문 수정이 같은 규칙을 쓴다)
check('the automatic evidence is the import wording',sa.autoEvidence({code:'PUBA',type:'coupon'})==='추적 코드 PUBA(쿠폰) 자동 귀속 · 주문 CSV'&&sa.autoEvidence({code:'QPUB',type:'qr'})==='추적 코드 QPUB(QR) 자동 귀속 · 주문 CSV');
const coded=(codeId,publicationId,over={})=>order({campaignId:'c1',creativeId:'cr1',channel:'social',attributionEvidence:sa.autoEvidence({code:codeId,type:'coupon'}),codeAttribution:ca(codeId,publicationId),...over});
const liveOrder=coded('PUBA','pa',{orderDate:'2026-09-20'}),plainOrder=order({campaignId:'c1',attributionEvidence:'계산대 구두 확인'}),freeCode=coded('CXYZ');
check('the gate view leaves live, code-free and publication-free orders untouched',sa.publicationGateView(liveOrder,gates)===liveOrder&&sa.publicationGateView(plainOrder,gates)===plainOrder&&sa.publicationGateView(freeCode,gates)===freeCode);
let view=plain(sa.publicationGateView(coded('PUBC','pc',{orderDate:'2026-09-20'}),gates));
check('an automatic attribution to a cancelled publication becomes unattributed like an import refusal',!view.codeAttribution&&!view.campaignId&&!view.creativeId&&view.channel==='unknown'&&view.attributionEvidence===''&&!sa.isAttributed(view));
view=plain(sa.publicationGateView(coded('QPUB','pc',{orderDate:'2026-09-20',channel:'unknown',attributionEvidence:sa.autoEvidence({code:'QPUB',type:'qr'})}),gates));
check('the automatic wording of any code type is recognised',!view.campaignId&&view.attributionEvidence==='');
view=plain(sa.publicationGateView(coded('PUBC','pc',{orderDate:'2026-09-20',attributionEvidence:'계산대에서 쿠폰 제시 확인'}),gates));
check('a person-written evidence keeps the manual attribution without the code copy',!view.codeAttribution&&view.campaignId==='c1'&&view.creativeId==='cr1'&&view.channel==='social'&&view.attributionEvidence==='계산대에서 쿠폰 제시 확인');
view=plain(sa.publicationGateView(coded('PUBD','pd',{orderDate:'2026-09-20'}),gates));
check('a pending publication is out of the attribution view until it goes live',!view.codeAttribution&&!view.campaignId);
check('a deleted publication is out of the attribution view',!sa.publicationGateView(coded('PUBA','p-deleted',{orderDate:'2026-09-20'}),gates).campaignId);
// A4-3: 주문 기록 창에 직접 넣은 코드의 문구('… 직접 입력')도 사람이 근거를 적지 않은 코드 귀속이다.
view=plain(sa.publicationGateView(coded('PUBC','pc',{orderDate:'2026-09-20',attributionEvidence:sa.manualEvidence({code:'PUBC',type:'coupon'})}),gates));
check('the direct-entry wording is treated like the import wording by the gate view',!view.codeAttribution&&!view.campaignId&&view.channel==='unknown'&&view.attributionEvidence==='');
const dayRows=[{day:'2026-09-15',net:5000,orders:3,attributedOrders:2,attributedKnown:0,attributedUnknown:2,attributedUnknownNet:3000},{day:'2026-09-16',net:900,orders:1,attributedOrders:1,attributedKnown:0,attributedUnknown:1,attributedUnknownNet:900}];
const moved=[coded('PUBC','pc',{paidAmount:1000})],fixed=plain(sa.regateDays(dayRows,moved,moved.map(o=>sa.publicationGateView(o,gates))));
check('regated days drop only the attributed totals of orders the view unattributes',JSON.stringify(fixed[0])===JSON.stringify({...dayRows[0],attributedOrders:1,attributedUnknown:1,attributedUnknownNet:2000})&&JSON.stringify(fixed[1])===JSON.stringify(dayRows[1]));
check('regated days are unchanged without moved orders',JSON.stringify(plain(sa.regateDays(dayRows,[],[])))===JSON.stringify(dayRows));

// 2) 서버: 게시별 코드 발급(실행 쪽 공용 인터페이스)
const server=await rt.load('lib/server.ts'),ops=await rt.load('lib/store-operations-server.ts'),pc=await rt.load('lib/publication-codes.ts'),flags=await rt.load('lib/feature-flags.ts'),logic=await rt.load('lib/store-operations.ts'),tc=await rt.load('lib/tracking-codes.ts');
const owner='a42-owner-production-authenticated-id';
const save=(kind,id,data,parent='')=>server.recordStatement(owner,kind,id,data,parent).run();
const store={id:'s1',brandId:'oda',name:'지점',status:'active',version:1};
await save('store','s1',store,'oda');
await save('store','s2',{id:'s2',brandId:'oda',name:'다른 지점',status:'active',version:1},'oda');
await save('store','s-arch',{id:'s-arch',brandId:'oda',name:'보관 지점',status:'archived',version:1},'oda');
const campaign={id:'c1',brandId:'oda',storeId:'s1',title:'오픈 캠페인'},wide={id:'c-wide',brandId:'oda',title:'브랜드 공통'},foreignBrand={id:'c-ofd',brandId:'ofd',title:'다른 브랜드'},otherStore={id:'c-s2',brandId:'oda',storeId:'s2',title:'다른 지점'};
for(const c of [campaign,wide,foreignBrand,otherStore])await save('campaign',c.id,c);
await save('execution_creative','cr1',{id:'cr1',campaignId:'c1',brandId:'oda',storeId:'s1',version:1,title:'오픈 주소 안내 v1',createdAt:'2026-09-01T00:00:00.000Z'},'c1');
await save('execution_creative','cr2',{id:'cr2',campaignId:'c1',brandId:'oda',storeId:'s1',version:1,caption:'주소: 휘경동 377 C107\n영업시간: 11시',createdAt:'2026-09-22T15:05:00.000Z'},'c1');
await save('execution_creative','cr-w',{id:'cr-w',campaignId:'c-wide',brandId:'oda',version:1,createdAt:'2026-09-01T00:00:00.000Z'},'c-wide');
await save('execution_creative','cr-o',{id:'cr-o',campaignId:'c-ofd',brandId:'ofd',version:1,createdAt:'2026-09-01T00:00:00.000Z'},'c-ofd');
await save('execution_creative','cr-s2',{id:'cr-s2',campaignId:'c-s2',brandId:'oda',storeId:'s2',version:1,createdAt:'2026-09-01T00:00:00.000Z'},'c-s2');
const T=logic.koreaToday(),at=(day,hm='00:30')=>new Date(`${day}T${hm}:00+09:00`).toISOString();
const pubRecord=(id,status,scheduledAt,creativeId='cr1',campaignId='c1')=>({id,campaignId,creativeId,creativeVersion:1,campaignVersion:1,pngHash:'h',factRefs:[],caption:'캡션',mediaUrl:'',scheduledAt,plannedCostKRW:0,version:1,status,createdAt:'x'});
const pub=(id,status,scheduledAt,creativeId,campaignId)=>{const p=pubRecord(id,status,scheduledAt,creativeId,campaignId);return save('execution_publication',id,p,p.campaignId)};
// p-future는 내일 한국시간 00:30 예약이라 UTC 날짜로는 오늘이다. 한국 날짜로 비교해야 오늘 주문이 '게시 전'이 된다.
await pub('p-acc','accepted',at(T));
await pub('p-future','accepted',at(sa.addDays(T,1)));
await pub('p-pub','published',at(sa.addDays(T,-3)),'cr2');
await pub('p-can','cancelled',at(sa.addDays(T,-3)));
await pub('p-fail','failed',at(sa.addDays(T,-3)));
await pub('p-draft','draft',at(sa.addDays(T,-3)));
await pub('p-gone','accepted',at(sa.addDays(T,-3)));
const who={id:owner,email:null};
const settle=promise=>promise.then(value=>({status:200,code:plain(value)}),e=>{if(typeof e?.status==='number')return {status:e.status,error:e.message};throw e});
const issue=(publicationId,over={})=>settle(pc.issuePublicationCode(owner,{campaign,publicationId,creativeId:'cr1',storeId:'s1',type:'coupon',who,...over}));
const codesOf=publicationId=>sql.prepare("SELECT COUNT(*) n FROM records WHERE owner=? AND kind='tracking_code' AND json_extract(data,'$.publicationId')=?").get(owner,publicationId).n;

let res=await issue('p-acc');
const accCode=res.code?.code;
check('a publication coupon code is issued in the code format',res.status===200&&tc.isValidCode(accCode)&&accCode[0]==='C'&&res.code.publicationId==='p-acc'&&res.code.creativeId==='cr1'&&res.code.campaignId==='c1'&&res.code.storeId==='s1');
check('the issued code starts today and records the actor',res.code.validFrom===T&&res.code.createdBy.id===owner&&res.code.type==='coupon');
check('the issued code is stored under the store',sql.prepare('SELECT parent_id p FROM records WHERE id=?').get(`${owner}:tracking_code:${accCode}`)?.p==='s1');
res=await issue('p-acc',{type:'pos_tag'});
check('issuing again for the same publication returns the same code',res.status===200&&res.code.code===accCode&&codesOf('p-acc')===1);
check('the code can be looked up by publication',(await pc.publicationCodeFor(owner,'p-acc'))?.code===accCode&&(await pc.publicationCodeFor(owner,'p-none'))===null);
res=await issue('p-x',{campaign:foreignBrand,creativeId:'cr-o'});
check('a campaign of another brand is refused',res.status===400&&codesOf('p-x')===0);
res=await issue('p-y',{campaign:otherStore,creativeId:'cr-s2'});
check('a campaign of another store is refused',res.status===400&&codesOf('p-y')===0);
res=await issue('p-wide-new',{campaign:wide,creativeId:'cr-w',type:'pos_tag'});
check('a brand-wide campaign may issue a POS tag before its publication is saved',res.status===200&&res.code.code[0]==='P'&&res.code.publicationId==='p-wide-new');
check('a saved publication must use the same creative',(await issue('p-pub',{creativeId:'cr1'})).status===400&&codesOf('p-pub')===0);
check('a code for an archived store is refused',(await issue('p-arch',{storeId:'s-arch'})).status===409);
check('only coupon and POS tag codes are issued for captions',(await issue('p-qr',{type:'qr'})).status===400&&codesOf('p-qr')===0);
check('a publication already coded for another store is a 409',(await issue('p-acc',{storeId:'s2'})).status===409);
const codeFor={};
for(const [id,creativeId] of [['p-future','cr1'],['p-pub','cr2'],['p-can','cr1'],['p-fail','cr1'],['p-draft','cr1'],['p-gone','cr1']]){res=await issue(id,{creativeId});codeFor[id]=res.code?.code}
check('codes are issued for draft and cancelled publications too (status is checked at attribution)',Object.values(codeFor).every(c=>tc.isValidCode(c))&&new Set(Object.values(codeFor)).size===6);
await server.database().prepare('DELETE FROM records WHERE id=?').bind(`${owner}:execution_publication:p-gone`).run();

// 3) 점포 화면의 수동 코드 만들기: 게시 연결은 같은 캠페인·같은 소재만
const legacyReq=()=>new Request('https://agency.test/api/store-operations',{method:'POST',headers:{'oai-authenticated-user-id':owner}});
const act=async b=>{try{return {status:200,body:plain(await ops.measurementAction(legacyReq(),owner,store,b))}}catch(e){if(typeof e?.status==='number')return {status:e.status,error:e.message};throw e}};
res=await act({action:'create_tracking_code',type:'qr',campaignId:'c1',publicationId:'p-acc',label:'매장 QR'});
const qrCode=res.body?.code?.code;
check('a manual code is linked to a publication and takes its creative',res.status===200&&res.body.code.publicationId==='p-acc'&&res.body.code.creativeId==='cr1'&&qrCode[0]==='Q');
check('the caption code of a publication stays the coupon after a QR is linked',(await pc.publicationCodeFor(owner,'p-acc'))?.code===accCode);
check('a publication of another creative is refused',(await act({action:'create_tracking_code',type:'qr',campaignId:'c1',creativeId:'cr2',publicationId:'p-acc'})).status===400);
check('a publication of another campaign is refused',(await act({action:'create_tracking_code',type:'qr',campaignId:'c-wide',publicationId:'p-acc'})).status===400);
check('a missing publication is a 404',(await act({action:'create_tracking_code',type:'qr',campaignId:'c1',publicationId:'p-none'})).status===404);
res=await act({action:'create_tracking_code',type:'coupon',campaignId:'c1',code:'WAKE2345',validFrom:sa.addDays(T,-7)});
check('a code without a publication is created as before',res.status===200&&!('publicationId' in res.body.code));

// 4) 주문 CSV: 스위치 꺼짐이면 게시 코드도 미귀속, 켜면 게시 상태·예약일을 검사한다
const header='주문번호,주문일시,결제금액,쿠폰코드',mapping={orderNumber:'주문번호',orderedAt:'주문일시',amount:'결제금액',code:'쿠폰코드'};
const orderBy=number=>JSON.parse(sql.prepare("SELECT data FROM records WHERE owner=? AND kind='store_order' AND json_extract(data,'$.orderNumber')=?").get(owner,number).data);
res=await act({action:'import_orders',csv:[header,`OFF1,${T},9000,${accCode}`].join('\n'),mapping,dryRun:false});
check('with the switch off a publication code is not attributed',res.status===200&&res.body.attributed===0&&res.body.beforePublication===0&&res.body.unpublished===0&&!orderBy('OFF1').campaignId&&orderBy('OFF1').trackingCodes.join()===accCode);
await flags.setFeatureFlag(owner,{flag:'a4_auto_attribution',enabled:true},{id:owner,email:null});
const rows=[[`A1`,5000,codeFor['p-future']],['A2',12000,accCode],['A3',8000,codeFor['p-pub']],['A4',3000,codeFor['p-can']],['A5',3000,codeFor['p-fail']],['A6',3000,codeFor['p-draft']],['A7',3000,codeFor['p-gone']],['A8',4000,'WAKE2345'],['A9',1000,`"${codeFor['p-can']};WAKE2345"`],['A10',7000,qrCode]];
const csv=[header,...rows.map(([n,amount,c])=>`${n},${T},${amount},${c}`)].join('\n');
res=await act({action:'import_orders',csv,mapping});
const preview=res.body?.autoAttribution;
check('the preview counts orders before the post',res.status===200&&preview.beforePublication===1);
check('the preview counts cancelled and failed publications',preview.unpublished===2);
check('the preview counts publications whose status is not confirmed yet',preview.pendingPublication===1);
check('a deleted publication is an unavailable code',preview.unavailable===1);
check('publication and plain codes that pass are attributed',preview.attributed===5&&preview.conflicts===0);
res=await act({action:'import_orders',csv,mapping,dryRun:false});
const storedOrders=()=>sql.prepare("SELECT COUNT(*) AS n FROM records WHERE owner=? AND kind='store_order'").get(owner).n,beforeConfirm=storedOrders();
check('confirming orders of publications not confirmed yet needs an explicit acknowledgement',res.status===409&&res.error.includes('게시 상태 확인 전')&&storedOrders()===beforeConfirm);
res=await act({action:'import_orders',csv,mapping,dryRun:false,allowPendingPublications:true});
check('the confirm result counts refusals by reason',res.status===200&&res.body.created===10&&res.body.attributed===5&&res.body.beforePublication===1&&res.body.unpublished===2&&res.body.pendingPublication===1);
const a2=orderBy('A2');
check('an order on the scheduled Korean day is attributed to the publication',a2.campaignId==='c1'&&a2.creativeId==='cr1'&&a2.codeAttribution.publicationId==='p-acc'&&a2.codeAttribution.codeId===accCode&&a2.channel==='social');
check('an order before the Korean scheduled day stays unattributed with its code',!orderBy('A1').campaignId&&!orderBy('A1').codeAttribution&&orderBy('A1').trackingCodes.join()===codeFor['p-future']);
check('orders on cancelled failed draft or deleted publications stay unattributed',['A4','A5','A6','A7'].every(n=>!orderBy(n).campaignId&&!orderBy(n).codeAttribution));
check('a published publication attributes its orders',orderBy('A3').codeAttribution.publicationId==='p-pub'&&orderBy('A3').creativeId==='cr2');
check('a code without a publication still attributes as before',orderBy('A8').codeAttribution.codeId==='WAKE2345'&&!('publicationId' in orderBy('A8').codeAttribution)&&orderBy('A9').codeAttribution.codeId==='WAKE2345');
check('a manual QR linked to the publication attributes to it',orderBy('A10').codeAttribution.publicationId==='p-acc'&&orderBy('A10').codeAttribution.codeId===qrCode);

// 5) 귀속 보고: 게시별 줄(라벨·주문·매출·코드), 소재 표시 이름, '귀속≠증분'
res=await act({action:'attribution_report',from:T,to:T});
const rep=res.body,row=key=>rep.byPublication.find(g=>g.key===key);
check('the report has a row per publication with orders and revenue',res.status===200&&rep.byPublication.length===2&&row('p-acc').orders===2&&row('p-acc').netRevenue===19000&&row('p-pub').orders===1&&row('p-pub').netRevenue===8000);
check('a publication row lists its codes',row('p-acc').codes.includes(accCode)&&row('p-acc').codes.includes(qrCode)&&row('p-pub').codes.join()===codeFor['p-pub']);
check('a publication row is labelled with the creative title, Korean schedule and status',row('p-acc').label===`오픈 주소 안내 v1 · 예약 ${T} 00:30 · 예약 접수`);
check('a publication of an untitled creative uses the fallback label',row('p-pub').label===`소재 · 9월 23일 00:05 생성 · 주소: 휘경동 377 C107 · 예약 ${sa.addDays(T,-3)} 00:30 · 게시 확인`);
check('the report carries creative display names',rep.creativeLabels.cr1==='오픈 주소 안내 v1'&&rep.creativeLabels.cr2==='소재 · 9월 23일 00:05 생성 · 주소: 휘경동 377 C107');
check('a report with every publication live has no gate note',!rep.notes.some(x=>x.includes('게시 관문 밖')));
check('the report keeps the attribution caveat',rep.notes.some(x=>x.includes('귀속≠증분')));

// 6) 게시 상태가 바뀐 뒤: 보고서는 지금 게시 상태로 관문을 다시 보고, 주문 기록 수정은 같은 규칙으로 저장한다(고쳤든 안 고쳤든 같은 집계).
const route=await rt.load('app/api/store-operations/route.ts');
const saveOrder=async(o,over={})=>{const data={source:o.source,orderNumber:o.orderNumber,orderDate:o.orderDate,mode:o.mode,status:o.status,paidAmount:o.paidAmount,refundAmount:o.refundAmount,costs:o.costs,channel:o.channel,experimentId:o.experimentId,campaignId:o.campaignId||'',creativeId:o.creativeId||'',attributionEvidence:o.attributionEvidence,note:o.note,...over};const r=await route.POST(new Request('https://agency.test/api/store-operations',{method:'POST',headers:{'Content-Type':'application/json','oai-authenticated-user-id':owner},body:JSON.stringify({action:'save_order',storeId:'s1',id:o.id,version:o.version,data})}));return {status:r.status,...await r.json()}};
const costs={foodCost:3000,packagingCost:0,fees:300,deliveryCost:0,benefitCost:0};
const report=async()=>(await act({action:'attribution_report',from:T,to:T})).body;
const campaignOrders=(r,key)=>r.byCampaign.find(g=>g.key===key)?.orders||0,weekAttributed=r=>r.weeks.reduce((n,w)=>n+w.attributedOrders,0);
// 실험에 연결한 게시 코드 주문(A11): 관문 밖이 되면 미귀속(유입 미확인)이 실험 채널과 맞지 않으므로 수정 때 사람이 고르게 한다.
await save('store_experiment','e-social',{id:'e-social',storeId:'s1',campaignId:'c1',title:'SNS 실험',status:'running',channel:'social',startDate:sa.addDays(T,-7),endDate:sa.addDays(T,7),version:1},'s1');
res=await act({action:'import_orders',csv:[header,`A11,${T},6000,${accCode}`].join('\n'),mapping,dryRun:false});
check('a later order on the live publication is attributed',res.status===200&&orderBy('A11').codeAttribution?.publicationId==='p-acc');
res=await saveOrder(orderBy('A11'),{experimentId:'e-social'});
check('linking an experiment to an order of a live publication keeps its code attribution',res.status===200&&orderBy('A11').experimentId==='e-social'&&orderBy('A11').codeAttribution?.publicationId==='p-acc');
res=await saveOrder(orderBy('A3'),{costs});
check('editing an order of a live publication keeps the publication attribution',res.status===200&&orderBy('A3').codeAttribution?.publicationId==='p-pub'&&orderBy('A3').costs.foodCost===3000);
const live=await report();
await save('execution_publication','p-acc',pubRecord('p-acc','failed',at(T)),'c1');
const failed=await report();
check('after the publication fails the report leaves its orders out of publication and code rows',live.byPublication.some(g=>g.key==='p-acc')&&!failed.byPublication.some(g=>g.key==='p-acc')&&!failed.byCode.some(g=>g.key===accCode||g.key===qrCode));
check('its automatic orders also leave campaign, channel and weekly attribution (like an import refusal)',campaignOrders(failed,'c1')===campaignOrders(live,'c1')-3&&weekAttributed(failed)===weekAttributed(live)-3&&(failed.byChannel.find(g=>g.key==='social')?.orders||0)===(live.byChannel.find(g=>g.key==='social')?.orders||0)-2);
check('the report says how many orders fell outside the publication gate',failed.notes.some(x=>x.includes('게시 관문 밖 3건')));
// 집계 숫자에 영향이 없는 메모만 고쳐, 고친 주문과 안 고친 주문의 보고서가 같은지 본다.
res=await saveOrder(orderBy('A2'),{note:'영수증 재확인'});
const a2edited=orderBy('A2');
check('editing an order of a failed publication makes it unattributed like an import refusal',res.status===200&&!a2edited.codeAttribution&&!a2edited.campaignId&&!a2edited.creativeId&&a2edited.channel==='unknown'&&a2edited.attributionEvidence===''&&!sa.isAttributed(a2edited)&&a2edited.trackingCodes.join()===accCode&&a2edited.note==='영수증 재확인');
res=await saveOrder(orderBy('A11'),{costs});
check('an experiment-linked order of a failed publication asks the person to choose (409)',res.status===409&&res.error.includes('실험')&&orderBy('A11').codeAttribution?.publicationId==='p-acc'&&orderBy('A11').costs.foodCost===null);
const edited=await report(),shape=r=>JSON.stringify([r.totals,r.byCampaign,r.byCreative,r.byPublication,r.byCode,r.byArm,r.byChannel,r.weeks.map(w=>[w.weekStart,w.attributedOrders,w.attributedContribution])]);
check('the report is the same whether or not the order was edited',shape(edited)===shape(failed)&&edited.notes.some(x=>x.includes('게시 관문 밖 2건')));
res=await saveOrder(orderBy('A10'),{attributionEvidence:'계산대에서 QR 제시 확인'});
check('a person-written evidence keeps a manual attribution after the publication fails',res.status===200&&!orderBy('A10').codeAttribution&&orderBy('A10').campaignId==='c1'&&orderBy('A10').creativeId==='cr1'&&orderBy('A10').attributionEvidence==='계산대에서 QR 제시 확인');
const manual=await report();
check('the manual attribution counts for the campaign but not for the publication',campaignOrders(manual,'c1')===campaignOrders(edited,'c1')+1&&!manual.byPublication.some(g=>g.key==='p-acc'));
// 확인 전 상태(공급자 확인 필요)는 되돌릴 수 있다: 수정은 코드 귀속을 그대로 두고, 보고서는 그동안만 뺀다.
await save('execution_publication','p-pub',pubRecord('p-pub','blocked',at(sa.addDays(T,-3)),'cr2'),'c1');
res=await saveOrder(orderBy('A3'),{costs:{...costs,fees:500}});
check('editing an order while its publication is pending keeps the code attribution',res.status===200&&orderBy('A3').codeAttribution?.publicationId==='p-pub'&&orderBy('A3').campaignId==='c1'&&orderBy('A3').costs.fees===500);
check('while pending the report leaves the publication out',!(await report()).byPublication.some(g=>g.key==='p-pub'));
await save('execution_publication','p-pub',pubRecord('p-pub','published',at(sa.addDays(T,-3)),'cr2'),'c1');
check('once confirmed the publication row comes back',(await report()).byPublication.find(g=>g.key==='p-pub')?.orders===1);
res=await saveOrder(orderBy('A8'),{costs});
check('editing an order of a code without a publication keeps its code attribution',res.status===200&&orderBy('A8').codeAttribution?.codeId==='WAKE2345');
await flags.setFeatureFlag(owner,{flag:'a4_auto_attribution',enabled:false},{id:owner,email:null});

console.log(JSON.stringify({passed:passed.length,checks:passed},null,2));
