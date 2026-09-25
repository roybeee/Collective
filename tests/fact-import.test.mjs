import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {testRuntime} from './helpers/runtime.mjs';

// 사실 원장 후보 가져오기(조사 주장·지점 필드·브리프 확정 표현/사실 후보), 중복 건너뛰기, 표준 항목 카탈로그, 원장 점검(미확인·충돌).
let passed=0;function check(name,value){assert.ok(value,name);passed++}
const rt=testRuntime(async()=>{throw new Error('External calls forbidden in fact import')});
const server=await rt.load('lib/server.ts'),route=await rt.load('app/api/brand-facts/route.ts'),catalog=await rt.load('lib/fact-catalog.ts'),imp=await rt.load('lib/fact-import.ts');
const owner='fact-import-owner';
async function post(data,user=owner){const r=await route.POST(new Request('https://agency.test/api/brand-facts',{method:'POST',headers:{'Content-Type':'application/json','oai-authenticated-user-id':user},body:JSON.stringify(data)}));return {status:r.status,...await r.json()}}
async function get(query,user=owner){const r=await route.GET(new Request('https://agency.test/api/brand-facts?'+query,{headers:{'oai-authenticated-user-id':user}}));return {status:r.status,...await r.json()}}
const facts=async()=>server.listRecords(owner,'brand_fact','oda');

// 카탈로그: 표시 라벨·지점 전용 여부·같은 항목의 다른 표기.
check('catalog labels are Korean',catalog.factLabel('address')==='주소'&&catalog.factLabel('opening_date')==='오픈일'&&catalog.factLabel('cooking_method')==='조리 방식');
check('free key label is the key itself',catalog.factLabel('주차 안내 문구')==='주차 안내 문구');
check('catalog covers standard items',['address','opening_date','hours','closed_days','menu_price','signature_menu','cooking_method','seating','parking','delivery','promotion','phone','official_account'].every(k=>catalog.factCatalog.some(i=>i.key===k&&typeof i.label==='string'&&i.label)));
check('store scoped flags',catalog.factCatalog.find(i=>i.key==='address').storeScoped===true&&catalog.factCatalog.find(i=>i.key==='hours').storeScoped===true&&catalog.factCatalog.find(i=>i.key==='cooking_method').storeScoped===false);
check('canonical key maps labels and spellings',catalog.canonicalFactKey('영업 시간')==='hours'&&catalog.canonicalFactKey(' Address ')==='address'&&catalog.canonicalFactKey('주소')==='address'&&catalog.canonicalFactKey('OVEN')==='oven');

// 브리프 확정 표현 추출과 항목 추정.
check('brief expression extracted',JSON.stringify(imp.briefFactExpressions('오픈 마케팅. 확정 사실(사용자 직접 제공): 서울 동대문구 휘경동 377 C동 107호에 오픈 예정. 목표는 인지도.'))===JSON.stringify(['서울 동대문구 휘경동 377 C동 107호에 오픈 예정']));
check('no expression without marker',imp.briefFactExpressions('확정 사실은 아직 없습니다.').length===0);
check('address guessed from brief expression',imp.guessFactKey('서울 동대문구 휘경동 377 C동 107호에 오픈 예정')==='address'&&imp.guessFactKey('11:00-21:00 영업')==='hours'&&imp.guessFactKey('마르게리타 15,000원')==='menu_price');

await server.seedBrands(owner);
const oda=await server.readRecord(owner,'brand','oda');
await server.recordStatement(owner,'brand','oda',{...oda,description:'화덕의 열기로 굽는 contemporary pizza. 마르게리타 15,000원.'}).run();
const store={id:'s1',brandId:'oda',name:'이문동점',address:'서울 동대문구 휘경동 377',tradeArea:'residential',customer:'',goal:'',daypart:'',menu:'마르게리타 15,000원',hours:'11:00-21:00',access:'',capacity:'',economics:'객단가 2만원',competitors:'',status:'active',version:1,createdAt:'',updatedAt:''};
await server.recordStatement(owner,'store','s1',store,'oda').run();
await server.recordStatement(owner,'store','s-old',{...store,id:'s-old',name:'보관 지점',status:'archived'},'oda').run();
const research=(id,extra)=>server.recordStatement(owner,'brand_research',id,{id,brandId:'oda',mode:'deep',status:'completed',steps:[],model:'m',stopRequested:false,createdAt:'2026-09-01T00:00:00.000Z',updatedAt:'2026-09-01T00:00:00.000Z',snapshot:{brand:{},observations:[]},tokens:0,...extra},'oda').run();
const claims=list=>({review:{claims:list.map(([claim,sourceIds])=>({claim,sourceIds,counterEvidence:'',nextCheck:''})),followups:[],unresolved:[]}});
await research('r1',{report:claims([['ODA는 도우를 48시간 숙성한다',['src-1','src-2']],['  ',[]]])});
await research('r2',{status:'running',report:claims([['진행 중 조사의 주장',['src-9']]])});
await research('r3',{storeId:'s1',report:claims([['이문동점은 포장 주문을 받는다',['src-3']]])});
const campaign={id:'c1',brandId:'oda',storeId:'s1',title:'오픈 준비',goal:'오픈 마케팅. 확정 사실(사용자 직접 제공): 서울 동대문구 휘경동 377 C동 107호에 오픈 예정. 목표는 인지도.',audience:'',channels:'',stores:'',products:'',budget:0,startDate:'',endDate:'',constraints:'',sources:'',status:'draft',version:3,createdAt:'',updatedAt:''};
await server.recordStatement(owner,'campaign','c1',campaign).run();
await server.recordStatement(owner,'campaign','c-ofd',{...campaign,id:'c-ofd',brandId:'ofd',storeId:undefined}).run();
await server.recordStatement(owner,'brief_draft','d1',{id:'d1',status:'completed',input:{brandId:'oda',title:'브리프'},result:{summary:'',suggestions:[],questions:[],assumptions:[],contextUsed:[],factCandidates:[{key:'영업 시간',value:'매일 11:00-21:00',source:'사용자 브리프'}]},createdAt:'',updatedAt:'',model:'m'}).run();
await server.recordStatement(owner,'brief_draft','d2',{id:'d2',status:'failed',input:{brandId:'oda',title:'실패'},result:{factCandidates:[{key:'오픈일',value:'10월 1일',source:'사용자 브리프'}]},createdAt:'',updatedAt:'',model:'m'}).run();

// 준비 상태: 브랜드 공통 범위는 브랜드 조사 1건 + 브리프 초안 1건, 지점 범위는 여기에 지점 항목(브리프 주소·영업시간·메뉴 가격·지점 조사)이 더해진다.
const before=await imp.factReadiness(rt.env.DB,owner,'oda');
check('brand readiness before import',before.confirmed===0&&before.candidates===0&&before.importable===2);
check('store readiness counts store items',(await imp.factReadiness(rt.env.DB,owner,'oda','s1')).importable===6);

const brandImport=await post({action:'import_candidates',brandId:'oda'});
check('brand import succeeds',brandImport.status===200&&brandImport.imported===2&&brandImport.skipped.length===0);
const afterBrand=await facts();
const claimFact=afterBrand.find(f=>f.value==='ODA는 도우를 48시간 숙성한다');
check('research claim imported as candidate with source ids',claimFact&&claimFact.status==='candidate'&&!claimFact.storeId&&claimFact.source.includes('review.claims')&&claimFact.source.includes('src-1')&&claimFact.source.includes('src-2')&&claimFact.version===1);
check('running research and blank claims ignored',!afterBrand.some(f=>f.value.includes('진행 중'))&&afterBrand.every(f=>f.value.trim()));
const draftFact=afterBrand.find(f=>f.value==='매일 11:00-21:00');
check('brief draft candidate imported with catalog key',draftFact&&draftFact.key==='hours'&&draftFact.status==='candidate'&&draftFact.source.includes('d1'));
check('failed draft ignored',!afterBrand.some(f=>f.value==='10월 1일'));
check('store items not imported into brand scope',afterBrand.every(f=>!f.storeId));

const again=await post({action:'import_candidates',brandId:'oda'});
check('duplicate import skipped and reported',again.status===200&&again.imported===0&&again.skipped.length===2&&again.skipped.every(s=>s.reason&&s.key));
check('no duplicate facts written',(await facts()).length===2);

const storeImport=await post({action:'import_candidates',brandId:'oda',storeId:'s1'});
const afterStore=await facts(),local=afterStore.filter(f=>f.storeId==='s1');
check('store import adds store scoped candidates',storeImport.status===200&&storeImport.imported===4&&local.length===4);
const address=local.find(f=>f.key==='address');
check('brief expression wins address and records campaign path',address&&address.value==='서울 동대문구 휘경동 377 C동 107호에 오픈 예정'&&address.source.includes('c1')&&address.source.includes('확정 사실(사용자 직접 제공)'));
check('store field duplicate reported',storeImport.skipped.some(s=>s.key==='address'&&s.storeId==='s1'&&s.value==='서울 동대문구 휘경동 377'));
check('store fields imported with record path',local.some(f=>f.key==='hours'&&f.value==='11:00-21:00'&&f.source.includes('이문동점'))&&local.some(f=>f.key==='menu_price'&&f.value==='마르게리타 15,000원'));
check('store research claim imported to store scope',local.some(f=>f.value==='이문동점은 포장 주문을 받는다'&&f.source.includes('src-3')));
check('internal economics and archived store not imported',!afterStore.some(f=>f.value.includes('객단가'))&&!afterStore.some(f=>f.storeId==='s-old'));
check('brand items already imported reported as skipped',storeImport.skipped.filter(s=>!s.storeId).length===2);
const ready=await imp.factReadiness(rt.env.DB,owner,'oda','s1');
check('readiness after import',ready.confirmed===0&&ready.candidates===6&&ready.importable===0);
check('import rejects foreign brand store',(await post({action:'import_candidates',brandId:'ofd',storeId:'s1'})).status===404);
check('import rejects unknown brand',(await post({action:'import_candidates',brandId:'missing'})).status===404);

// 원장 점검: 브랜드 소개의 조리 방식·가격 주장과 지점 주소·영업시간을 원장과 비교한다.
const view=await get('brandId=oda&storeId=s1');
check('get returns readiness and stores',view.status===200&&view.readiness.candidates===6&&view.stores.some(s=>s.id==='s1'&&s.name==='이문동점')&&!view.stores.some(s=>s.id==='s-old'));
const cooking=view.checks.find(c=>c.origin==='brand'&&c.key==='cooking_method');
check('brand intro cooking claim unverified',cooking&&cooking.state==='unverified'&&cooking.claim.includes('화덕'));
check('brand intro price claim unverified',view.checks.some(c=>c.origin==='brand'&&c.key==='menu_price'&&c.state==='unverified'));
check('store address has pending candidate',view.checks.some(c=>c.origin==='store'&&c.storeId==='s1'&&c.key==='address'&&c.state==='candidate'));
await post({action:'save_fact',id:address.id,version:1,confirmed:true,data:{brandId:'oda',storeId:'s1',key:'address',value:'서울 동대문구 휘경동 377 C동 107호',status:'confirmed',source:'임대차 계약서',verifiedAt:new Date(Date.now()-60000).toISOString(),validUntil:new Date(Date.now()+86400000).toISOString()}});
const conflict=(await get('brandId=oda&storeId=s1')).checks.find(c=>c.origin==='store'&&c.key==='address');
check('store address differing from confirmed ledger warned',conflict&&conflict.state==='conflict'&&conflict.ledgerValue==='서울 동대문구 휘경동 377 C동 107호'&&conflict.value==='서울 동대문구 휘경동 377');
const rejectedOven=await post({action:'save_fact',data:{brandId:'oda',key:'화덕 표현',value:'화덕',status:'rejected',source:'대표 확인',verifiedAt:'',validUntil:''}});
check('rejected expression saved',rejectedOven.status===200);
check('brand intro using rejected expression flagged',(await get('brandId=oda')).checks.some(c=>c.origin==='brand'&&c.key==='cooking_method'&&c.state==='prohibited'));
check('brand scope checks every active store',(await get('brandId=oda')).checks.some(c=>c.origin==='store'&&c.storeId==='s1'));

// SEC-4: 원장 점검의 주소 정규식은 공백 없는 긴 한글에서도 되돌림이 폭증하지 않는다(사실 패널 조회마다 실행된다).
const slowStart=performance.now();imp.ledgerChecks({...oda,description:'',knowledge:'시'.repeat(30000)},[],[]);const slowMs=performance.now()-slowStart;
check('address check stays fast on long Hangul runs ('+Math.round(slowMs)+'ms)',slowMs<250);
check('bounded address pattern still finds an address without spaces',imp.ledgerChecks({...oda,description:'매장은 서울특별시동대문구휘경동 377에 있습니다.',knowledge:''},[],[]).some(c=>c.key==='address'&&c.value.includes('377')));
// SEC-5: 가져온 후보는 사실 저장과 같은 길이 한도(항목 120·내용 5,000·근거 3,000자)를 지켜 관리자가 그대로 확정할 수 있다.
const longOwner='fact-import-long-title-owner';await server.seedBrands(longOwner);
await server.recordStatement(longOwner,'campaign','long',{...campaign,id:'long',storeId:undefined,title:'가'.repeat(5000)}).run();
const longImport=await post({action:'import_candidates',brandId:'oda'},longOwner);
const longFact=(await server.listRecords(longOwner,'brand_fact','oda')).find(f=>f.source.includes('(long)'));
check('imported candidate fits the fact length limits',longImport.status===200&&!!longFact&&longFact.source.length<=3000&&longFact.key.length<=120&&longFact.value.length<=5000);
check('admin can confirm an imported candidate as is',(await post({action:'save_fact',id:longFact.id,version:1,confirmed:true,data:{brandId:'oda',key:longFact.key,value:longFact.value,status:'confirmed',source:longFact.source,verifiedAt:new Date(Date.now()-60000).toISOString(),validUntil:new Date(Date.now()+86400000).toISOString()}},longOwner)).status===200);

// 직원(member)은 후보 가져오기·후보 등록은 할 수 있고 확정은 403이다.
const staff=testRuntime(async()=>{throw new Error('External calls forbidden')});
Object.assign(staff.env,{AUTH_MODE:'email',AUTH_ORIGIN:'https://app.test'});
const staffServer=await staff.load('lib/server.ts'),staffRoute=await staff.load('app/api/brand-facts/route.ts');
await staffServer.seedBrands('workspace');
await staffServer.recordStatement('workspace','brand_research','r1',{id:'r1',brandId:'oda',mode:'deep',status:'completed',report:claims([['직원이 가져올 조사 주장',['src-7']]]),steps:[],model:'m',stopRequested:false,createdAt:'',updatedAt:'',snapshot:{brand:{},observations:[]},tokens:0},'oda').run();
const token='e'.repeat(64);
staff.sql.prepare('INSERT INTO auth_users(id,email,workspace_owner,role,status,created_at) VALUES(?,?,?,?,?,?)').run('staff','staff@test.invalid','workspace','member','active',Date.now());
staff.sql.prepare('INSERT INTO auth_sessions VALUES(?,?,?,?)').run(createHash('sha256').update(token).digest('hex'),'staff',Date.now()+60000,Date.now());
const staffCall=async data=>{const r=await staffRoute.POST(new Request('https://app.test/api/brand-facts',{method:'POST',headers:{cookie:'__Host-collective_session='+token,origin:'https://app.test','content-type':'application/json'},body:JSON.stringify(data)}));return {status:r.status,...await r.json()}};
const staffImport=await staffCall({action:'import_candidates',brandId:'oda'});
check('member may import candidates',staffImport.status===200&&staffImport.imported===1);
const staffFact=(await staffServer.listRecords('workspace','brand_fact','oda'))[0];
check('member import recorded as candidate with importer',staffFact.status==='candidate'&&staffFact.importedBy?.id==='staff');
check('member cannot confirm imported candidate',(await staffCall({action:'save_fact',id:staffFact.id,version:1,confirmed:true,data:{brandId:'oda',key:staffFact.key,value:staffFact.value,status:'confirmed',source:'근거',verifiedAt:new Date(Date.now()-60000).toISOString(),validUntil:new Date(Date.now()+86400000).toISOString()}})).status===403);
check('member may propose a candidate',(await staffCall({action:'save_fact',data:{brandId:'oda',key:'phone',value:'02-000-0000',status:'candidate',source:'',verifiedAt:'',validUntil:''}})).status===200);

// 트랙 R R1b: 가맹 금액 문장(합성)은 메뉴 가격으로 분류하지 않는다. 숫자형 3종은 이 변경 전에 menu_price였다. 소비자 문장 분류는 명시 기대값 그대로다.
const FR_MONEY=['가맹비 870만원','교육비 550만원','가맹 보증금 500만원','인테리어 비용 3.3㎡당 180만원','총 창업비용 1억 2천만원','가맹비 8,700,000원','교육비 5,500,000원','로열티 월 300,000원'];
check('franchise money sentences are not guessed as menu prices',FR_MONEY.every(s=>imp.isFranchiseMoney(s)&&imp.guessFactKey(s)!=='menu_price'));
const CONSUMER={'아메리카노 4,500원':'menu_price','일회용컵 보증금 300원':'menu_price','쿠키 3개 5,000원':'menu_price','베이킹 클래스 교육비 35,000원':'menu_price','멤버십 가입비 10,000원':'menu_price','로열티 카드 적립 시 아메리카노 4,500원':'menu_price','로열티 10% 할인, 아메리카노 4,500원':'menu_price','로열티 5% 적립 라떼 5,000원':'menu_price','로열티 월 1회 무료 음료, 라떼 5,000원':'menu_price','대관 보증금 100만원, 케이크 30,000원':'menu_price','총 투자 없이 즐기는 라떼 5,000원':'menu_price','영업시간 10:00-21:00':'hours','9월 1일 오픈':'opening_date','02-000-0000':'phone','가상시 가상구 가상로 12':'address'};
check('consumer sentence classification keeps the explicit expectations',Object.entries(CONSUMER).every(([s,k])=>imp.guessFactKey(s)===k&&!imp.isFranchiseMoney(s)));
const priceChecks=(description,menu='')=>imp.ledgerChecks({...oda,description,knowledge:''},menu?[{...store,menu,address:'',hours:''}]:[],[]).filter(c=>c.key==='menu_price');
check('brand intro franchise money sentences make no menu price check',priceChecks('가맹 안내. '+FR_MONEY.join('. ')+'.').length===0);
check('brand intro consumer prices keep their menu price checks',JSON.stringify(priceChecks('일회용컵 보증금 300원. 마르게리타 15,000원. 멤버십 가입비 10,000원.').map(c=>c.value))===JSON.stringify(['300원','15,000원','10,000원']));
check('store menu lines with franchise money are skipped, consumer lines kept',JSON.stringify(priceChecks('','마르게리타 15,000원\n가맹비 870만원').map(c=>c.value))===JSON.stringify(['15,000원'])&&JSON.stringify(priceChecks('','마르게리타 15,000원\n콜라 2,000원').map(c=>c.value))===JSON.stringify(['15,000원, 2,000원']));
console.log(JSON.stringify({passed}));
