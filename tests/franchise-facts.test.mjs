// 트랙 R R1b 모집 팩트시트: 가맹 팩트 카탈로그(해석 분리), 정보공개서 근거(sourceRef)·창업비용 상세(cost) 검증, 버전 상태·유효 기한 상한(다음 변경등록 기한),
// 결정론 각주(사실 카드·캡션)와 각주 삭제 거부, 수익 항목 H6 거부, 버전 교체 뒤 재검토·새 버전으로 옮기기(멱등), 비가맹 브랜드 불변, 모델 제출 바이트 불변.
// 근거: mocked(메모리 SQLite, 이메일 모드 세션 주입, 모의 R2, 외부 fetch는 던지는 스텁, 모의 HERMES). 값은 모두 합성이다. 기한 상한은 COLLECTIVE 휴리스틱 · 법률 자문 아님.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {deflateSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {franchiseFixture,captureConsole,DISCLAIMER,sha64} from './helpers/franchise-fixture.mjs';
import {testRuntime} from './helpers/runtime.mjs';
import {seed,mockHermes,runRole,runMeeting,roleCampaign,meetingCampaign,brand as seedBrand,now as seedNow} from './helpers/prompt-seed.mjs';

captureConsole();
const passed=[];const check=(name,val)=>{assert.ok(val,name);passed.push(name)};
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);

// ── 합성 PNG(1080×1080) ──
function crc32(bytes){let crc=0xffffffff;for(const byte of bytes){crc^=byte;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0)}return (crc^0xffffffff)>>>0}
function chunk(type,data){const name=Buffer.from(type),size=Buffer.alloc(4),crc=Buffer.alloc(4);size.writeUInt32BE(data.length);crc.writeUInt32BE(crc32(Buffer.concat([name,data])));return Buffer.concat([size,name,data,crc])}
const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(1080,0);ihdr.writeUInt32BE(1080,4);ihdr[8]=8;ihdr[9]=2;
const pixels=Buffer.alloc((1080*3+1)*1080,0);for(let row=0;row<1080;row++)pixels[row*(1080*3+1)]=0;
const PNG='data:image/png;base64,'+Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),chunk('IDAT',deflateSync(pixels)),chunk('IEND',Buffer.alloc(0))]).toString('base64');

const f=await franchiseFixture();
const {sql,env,server}=f;
env.AUTH_MODE='email';env.AUTH_ORIGIN='https://agency.test';
const objects=new Map();env.BUCKET={put:async(k,v)=>objects.set(k,new Uint8Array(v)),get:async k=>objects.has(k)?{arrayBuffer:async()=>objects.get(k).slice().buffer,body:new Response(objects.get(k).slice()).body}:null,head:async k=>objects.has(k)?{size:objects.get(k).length}:null,delete:async k=>objects.delete(k)};
// 서버 시각을 2026-09-26 12:00 KST로 고정한다(테스트 벡터가 실제 날짜와 무관하게 같도록).
const NOW_MS=Date.parse('2026-09-26T03:00:00Z');f.clock.set(NOW_MS-Date.now());
const NOW='2026-09-26T12:00:00+09:00';
const WS='ff-owner';
const boss=f.signIn('ff-boss','admin',1000,WS),admin=f.signIn('ff-admin','admin',2000,WS),member=f.signIn('ff-member','member',3000,WS);
const A='ff-a',N='ff-n',O='ff-o',M='ff-m',P='ff-p';
for(const b of [A,N,O,M,P])await f.brand(WS,b);
const catalog=await f.load('lib/fact-catalog.ts'),facts=await f.load('lib/franchise-facts.ts'),gates=await f.load('lib/franchise-gates.ts'),elig=await f.load('lib/fact-eligibility.ts');
const factsRoute=await f.load('app/api/brand-facts/route.ts'),execRoute=await f.load('app/api/execution/route.ts');
const MSG=JSON.parse(JSON.stringify(facts.FRANCHISE_FACT_MESSAGES));
const headersOf=s=>Object.fromEntries(Object.entries(s).filter(([k])=>k!=='id'));
const clearRate=()=>sql.prepare("DELETE FROM records WHERE kind='execution_rate'").run();
const responses=[];
async function call(res){const body=await res.json();responses.push(body);return {status:res.status,body}}
const factPost=async(s,input)=>{clearRate();return call(await factsRoute.POST(new Request('https://agency.test/api/brand-facts',{method:'POST',headers:{'content-type':'application/json',...headersOf(s)},body:JSON.stringify(input)})))};
const factGet=async(s,q)=>call(await factsRoute.GET(new Request('https://agency.test/api/brand-facts?'+q,{headers:headersOf(s)})));
const execPost=async(s,input)=>{clearRate();return call(await execRoute.POST(new Request('https://agency.test/api/execution',{method:'POST',headers:{'content-type':'application/json',...headersOf(s)},body:JSON.stringify(input)})))};
const execGet=async(s,id)=>call(await execRoute.GET(new Request('https://agency.test/api/execution?campaignId='+id,{headers:headersOf(s)})));
const frPost=async(s,input)=>{const r=await f.post(s,input);responses.push(r.body);return r};
const factRow=id=>JSON.parse(sql.prepare("SELECT data FROM records WHERE kind='brand_fact' AND json_extract(data,'$.id')=?").get(id).data);
const count=kind=>Number(sql.prepare('SELECT COUNT(*) n FROM records WHERE kind=?').get(kind).n);

// ════ 1) 카탈로그(순수) ════
const BASE_EXPECT={address:'address',주소:'address',매장주소:'address',위치:'address',opening_date:'opening_date',오픈일:'opening_date',개점일:'opening_date',오픈날짜:'opening_date',hours:'hours',영업시간:'hours','영업 시간':'hours',운영시간:'hours',closed_days:'closed_days',휴무일:'closed_days',휴무:'closed_days',정기휴무:'closed_days',access:'access','찾아오는 길':'access',오시는길:'access',대중교통:'access',parking:'parking',주차:'parking',seating:'seating',좌석:'seating',좌석수:'seating',delivery:'delivery','배달·포장':'delivery',배달:'delivery',포장:'delivery',배달여부:'delivery',phone:'phone',전화번호:'phone',전화:'phone',연락처:'phone',menu_price:'menu_price','메뉴 가격':'menu_price',가격:'menu_price',메뉴가격:'menu_price',signature_menu:'signature_menu','대표 메뉴':'signature_menu',대표메뉴:'signature_menu',cooking_method:'cooking_method','조리 방식':'cooking_method',조리방법:'cooking_method',조리설비:'cooking_method',promotion:'promotion',프로모션:'promotion',할인:'promotion',이벤트:'promotion',official_account:'official_account','공식 계정':'official_account',공식sns:'official_account',인스타그램:'official_account'};
check('the 14 base items, labels and aliases resolve exactly as before',Object.entries(BASE_EXPECT).every(([k,v])=>catalog.canonicalFactKey(k)===v)&&catalog.factCatalog.filter(i=>!i.franchise).length===14);
const frItems=catalog.factCatalog.filter(i=>i.franchise),frNames=catalog.catalogNames().franchise;
check('franchise labels and aliases stay free keys in canonicalFactKey and resolve only through franchiseFactKey',frNames.every(([name,key])=>catalog.franchiseFactKey(name)===key)&&catalog.canonicalFactKey('가맹비')==='가맹비'&&catalog.canonicalFactKey('월 매출')==='월 매출'&&catalog.canonicalFactKey('판매채널')==='판매채널'&&catalog.franchiseFactKey('가맹비')==='franchise_fee'&&catalog.franchiseFactKey('월 매출')==='monthly_sales');
check('factLabel of every franchise label or alias used as a free key is the key itself',frItems.flatMap(i=>[i.label]).concat(['가맹비','가입비','월 매출','판매채널','평균매출']).every(k=>catalog.factLabel(k)===k)&&catalog.factLabel('franchise_fee')==='가맹비'&&catalog.factCatalogItem('franchise_fee')?.franchise===true);
check('36 franchise items: brand-wide, 5 revenue items without ad use, 6 cost items, 5 count items, 2 area items',frItems.length===36&&frItems.every(i=>i.storeScoped===false&&i.franchise===true)&&same(frItems.filter(i=>i.adUse===false).map(i=>i.key),['regional_avg_sales','direct_store_sales','direct_store_contribution','monthly_sales','profit_rate'])&&frItems.filter(i=>i.storeType).length===6&&frItems.filter(i=>i.asOf).length===5&&same(frItems.filter(i=>i.area).map(i=>i.key),['interior_cost','startup_cost_total']));
const baseCompact=new Set(catalog.catalogNames().base.map(([c])=>c)),byCompact=new Map();for(const [c,k] of frNames){if(!byCompact.has(c))byCompact.set(c,new Set());byCompact.get(c).add(k)}
check('franchise names never collide with base names or with each other',frNames.every(([c])=>!baseCompact.has(c))&&[...byCompact.values()].every(s=>s.size===1));
check('production_method is separate from cooking_method with no shared alias',catalog.franchiseFactKey('생산방식')==='production_method'&&catalog.franchiseFactKey('생산 방식')==='production_method'&&catalog.canonicalFactKey('조리 방식')==='cooking_method'&&catalog.franchiseFactKey('조리 방식')===undefined&&catalog.franchiseFactKey('조리방법')===undefined&&catalog.franchiseFactKey('조리설비')===undefined&&catalog.franchiseFactKey('cooking_method')===undefined);
check('general words are not franchise aliases',['인테리어','보증금','매출','등록번호','창업연도','기타비용','royalty'].every(w=>catalog.franchiseFactKey(w)===undefined));
check('every disclosure item maps to a known change-registration item and nothing else does',same(Object.keys(facts.AMENDMENT_ITEM_OF).sort(),frItems.filter(i=>i.disclosure).map(i=>i.key).sort())&&Object.values(facts.AMENDMENT_ITEM_OF).every(v=>gates.AMENDMENT_ITEMS.includes(v)));

// ════ 2) 버전 상태·상한·각주(순수) ════
const V=(id,over={})=>({id,brandId:'b',label:id,registeredAt:'2026-03-15T10:00:00+09:00',validFrom:'2026-03-15T00:00:00+09:00',validUntil:'2027-07-01T00:00:00+09:00',status:'active',...over});
const V1=V('dv-1',{label:'가상 정보공개서 2026'}),V2=V('dv-2',{registeredAt:'2026-09-20T10:00:00+09:00',validFrom:'2026-09-01T00:00:00+09:00',validUntil:'2027-10-01T00:00:00+09:00'});
check('current version is the latest validFrom among active registered versions in range',facts.currentDisclosureVersion([V1],'b',NOW)?.id==='dv-1'&&facts.currentDisclosureVersion([V1,V2],'b',NOW)?.id==='dv-2'&&facts.currentDisclosureVersion([V1,V2],'other',NOW)===null);
check('retired, unregistered, expired and not-yet-valid versions are never current',facts.currentDisclosureVersion([V('r',{status:'retired'}),V('u',{registeredAt:null}),V('e',{validUntil:'2026-09-01T00:00:00+09:00'}),V('p',{validFrom:'2026-12-01T00:00:00+09:00'})],'b',NOW)===null);
check('ties break by later registration time and then larger id',facts.currentDisclosureVersion([V('a',{registeredAt:'2026-03-16T10:00:00+09:00'}),V('b2')],'b',NOW)?.id==='a'&&facts.currentDisclosureVersion([V('a'),V('b2')],'b',NOW)?.id==='b2');
const all=[V1,V2,V('r',{status:'retired'}),V('u',{registeredAt:null}),V('e',{validUntil:'2026-09-01T00:00:00+09:00'}),V('p',{validFrom:'2026-12-01T00:00:00+09:00'})];
check('versionState covers all six states',same(all.map(v=>facts.versionState(v,all,NOW)),['superseded','current','retired','unregistered','expired','pending'])&&Object.keys(facts.VERSION_STATE_LABELS).length===6);
const REF={disclosureVersionId:'dv-1',fiscalYear:2025,page:3},cap=(key,over={})=>facts.franchiseValidUntilCap({key,sourceRef:REF,verifiedAt:'2026-09-25T10:00:00+09:00',fiscalYearEnd:'2025-12-31',version:V1,...over});
check('fiscal-year items cap at 2027-04-30 (next fiscal year end + 120 days)',['franchise_store_count','direct_store_count','new_openings','terminations','regional_avg_sales','direct_store_sales','profit_rate','disclosure_registration_no'].every(k=>{const c=cap(k);return c.ok&&c.deadline==='2027-04-30'&&c.cap==='2027-05-01T00:00:00+09:00'}));
check('quarter items cap at 2026-10-30 (quarter end + 30 days)',['franchise_fee','royalty_fee','required_items','production_method','sales_channels','ip_registration','territory_clause'].every(k=>{const c=cap(k);return c.ok&&c.deadline==='2026-10-30'&&c.cap==='2026-10-31T00:00:00+09:00'}));
check('the cap carries the application-date-unknown warning',cap('franchise_fee').warnings.includes('application_date_unknown'));
check('missing fiscal year end is reported, an earlier version end becomes the cap',cap('franchise_fee',{fiscalYearEnd:null}).code==='fiscal_year_end_missing'&&cap('franchise_store_count',{version:{validUntil:'2027-03-01T00:00:00+09:00'}}).cap==='2027-03-01T00:00:00+09:00'&&cap('claim_basis').ok===false);
const plainFacts=[{key:'address',value:'가상로 12'},{key:'가맹비',value:'870만원'},{key:'가입비',value:'가상 값'}];
check('facts without sourceRef or cost keep the previous caption bytes',facts.factCaption(plainFacts,[])==='주소: 가상로 12\n가맹비: 870만원\n가입비: 가상 값'&&plainFacts.every(x=>facts.factLine(x)===catalog.factLabel(x.key)+': '+x.value));
const SC={key:'franchise_store_count',value:'12개',verifiedAt:'2026-09-25T01:00:00.000Z',sourceRef:{...REF,asOf:'2025-12-31'}};
const COST={key:'startup_cost_total',value:'5,000만원',verifiedAt:'2026-09-25T01:00:00.000Z',sourceRef:REF,cost:{storeType:'테이크아웃형',includes:['가맹비','교육비'],excludes:['임차보증금'],areaM2:33}};
const NOTE='※ 정보공개서 등록 버전 가상 정보공개서 2026(등록일 2026-03-15) · 기준 사업연도 2025년 · 확인일 2026-09-25';
check('store count line carries the reference date',facts.factLine(SC)==='가맹점 수 (2025-12-31 기준): 12개');
check('startup cost line carries store type and a second line with inclusions, exclusions and area',facts.factLine(COST)==='총 창업비용 · 테이크아웃형: 5,000만원\n포함: 가맹비, 교육비 · 불포함: 임차보증금 · 전용면적 33㎡');
check('footnote format is exact and one line per version, fiscal year and check date',same(facts.footnoteLines([SC,COST],[V1]),[NOTE])&&facts.footnoteLines([SC,{...COST,verifiedAt:'2026-09-20T01:00:00.000Z'}],[V1]).length===2);
check('a missing referenced version gives no footnote (null) and no caption',facts.footnoteLines([SC],[V2])===null&&facts.factCaption([SC],[V2])===null&&same(facts.footnoteLines([{key:'address',value:'x'}],[]),[]));
check('the caption puts footnotes after the fact lines',facts.factCaption([SC,COST],[V1])===facts.factLine(SC)+'\n'+facts.factLine(COST)+'\n'+NOTE);
const caption=facts.factCaption([SC],[V1]);
check('footnoteIssues: full caption has none, a removed footnote line is one issue, a copy-only franchise value needs its footnote',facts.footnoteIssues(caption,{used:[SC]},[V1]).length===0&&same(facts.footnoteIssues(caption.split('\n')[0],{used:[SC]},[V1]),[NOTE])&&facts.footnoteIssues('전국 12개 매장에서 만나요\n\n주소: 가상로 12',{used:[],mentioned:[SC]},[V1]).length===1&&facts.footnoteIssues(caption+'x',{used:[SC]},[V1]).length===1);
const card=(over={})=>({id:'c'+Math.random(),brandId:'b',key:'address',value:'가상로 12',status:'confirmed',source:'대표 확인',verifiedAt:'2026-09-20T00:00:00.000Z',validUntil:'2027-01-01T00:00:00.000Z',version:1,updatedAt:'2026-09-20T00:00:00.000Z',...over});
const cardNow=Date.parse(NOW);
check('fact card rejects a sourced revenue item by key or label (H6)',elig.factCardIssue('b',[card({key:'monthly_sales',value:'월 4,200만원',sourceRef:REF})],cardNow)===MSG.revenueNoAd&&elig.factCardIssue('b',[card({key:'월 매출',value:'월 4,200만원',sourceRef:REF})],cardNow)===MSG.revenueNoAd);
check('an old free-key revenue fact without sourceRef keeps the previous verdict',elig.factCardIssue('b',[card({key:'월 매출',value:'월 4,200만원'})],cardNow)===null);
const factUse=(fx,states)=>facts.franchiseFactUseIssue(fx,states);
check('fact use gate: revenue first, then missing source, then non-current version',factUse({key:'monthly_sales',sourceRef:REF},{'dv-1':'current'})==='revenueNoAd'&&factUse({key:'가맹비'},{})==='sourceMissingInUse'&&factUse({key:'franchise_store_count',sourceRef:REF},{'dv-1':'superseded'})==='staleFact'&&factUse({key:'franchise_store_count',sourceRef:REF},{'dv-1':'current'})===null&&factUse({key:'address'},{})===null&&factUse({key:'claim_basis'},{})===null);

// ════ 3) 가맹 설정(프로필·버전) ════
const flag=async on=>assert.equal((await f.setFlag(boss,on)).status,200);
await flag(true);
const LABEL='가상 보관함';
const profile=(brandId,fiscalYearEnd)=>f.profile(boss,brandId,{forecastInputs:{sme:true,storesAtFyEnd:3,fiscalYearEnd},storageLabels:[LABEL]},0);
for(const [b,fye] of [[A,'2025-12-31'],[O,'2025-12-31'],[M,'2026-03-31'],[P,null]])assert.equal((await profile(b,fye)).status,200);
const register=async(brandId,label,seedText,meta)=>{const r=await frPost(boss,{action:'register_disclosure_version',brandId,label,sha256:sha64(seedText),storageLabel:LABEL,...meta});assert.equal(r.status,200,JSON.stringify(r.body));return r};
const V1META={registeredAt:'2026-03-15T10:00:00+09:00',validFrom:'2026-03-15',validUntil:'2027-06-30'};
const regV1=await register(A,'가상 정보공개서 2026','ff dv1',V1META),v1=regV1.body.result.id;
check('registering a version with no sourced facts keeps the R1a response shape',!('reviewPublications' in regV1.body));
const vRetired=(await register(A,'가상 이전본','ff dv retired',{registeredAt:'2026-03-10T10:00:00+09:00',validFrom:'2026-03-10',validUntil:'2027-06-30'})).body.result.id;
assert.equal((await frPost(boss,{action:'retire_disclosure_version',brandId:A,id:vRetired,version:1})).status,200);
const vO=(await register(O,'가상 타 브랜드본','ff dvO',V1META)).body.result.id;
const vM=(await register(M,'가상 3월 결산본','ff dvM',{registeredAt:'2026-07-01T10:00:00+09:00',validFrom:'2026-07-01',validUntil:'2027-06-30'})).body.result.id;
const vP=(await register(P,'가상 종료일 없음','ff dvP',V1META)).body.result.id;

// ════ 4) 저장 검증(라우트) ════
const VERIFIED='2026-09-25T10:00:00+09:00',UNTIL_Q='2026-10-30T12:00:00+09:00',UNTIL_Y='2027-04-01T00:00:00+09:00';
const ref=(over={})=>({disclosureVersionId:v1,fiscalYear:2025,page:12,...over});
const takeout={storeType:'테이크아웃형',includes:['가맹비'],excludes:['임차보증금'],areaM2:null};
const data=(over={})=>({brandId:A,key:'franchise_fee',value:'870만원',status:'confirmed',source:'가상 정보공개서 12쪽',verifiedAt:VERIFIED,validUntil:UNTIL_Q,...over});
const save=(s,d,extra={})=>factPost(s,{action:'save_fact',data:d,confirmed:d.status==='confirmed',...extra});
let r=await save(boss,data({sourceRef:ref(),cost:takeout}));
check('confirming a franchise fee with source and cost succeeds with the cap warning',r.status===200&&r.body.fact.key==='franchise_fee'&&same(r.body.fact.sourceRef,ref())&&same(r.body.fact.cost,takeout)&&r.body.warnings.includes(MSG.capWarning)&&r.body.warnings.some(w=>w.includes(DISCLAIMER)));
r=await save(boss,data({key:'가맹비',sourceRef:ref(),cost:{...takeout,storeType:'카페형'}}));
check('a franchise label is stored as the franchise key in a franchise brand',r.status===200&&r.body.fact.key==='franchise_fee');
const feeCafe=r.body;
// 창업비용 매장 유형
const startup=(storeType,areaM2)=>data({key:'startup_cost_total',value:'5,000만원',sourceRef:ref(),cost:{storeType,includes:['가맹비','교육비','인테리어'],excludes:['임차보증금'],areaM2}});
const takeoutCost=await save(boss,startup('테이크아웃형',33)),cafeCost=await save(boss,startup('카페형',66));
check('startup cost per store type: two types each 200, the same type again 409',takeoutCost.status===200&&cafeCost.status===200&&(await save(boss,startup('테이크아웃형',33))).status===409);
// 표 2~11
check('2: source or cost on a non-franchise or wrong item is 400',(await save(boss,data({key:'signature_menu',value:'가상 도넛',sourceRef:ref()}))).body.error===MSG.notFranchiseItem&&(await save(boss,data({key:'royalty_fee',value:'매출의 3%',sourceRef:ref(),cost:takeout}))).body.error===MSG.notFranchiseItem&&(await save(boss,data({key:'claim_basis',value:'가상 조사',sourceRef:ref()}))).body.error===MSG.notFranchiseItem);
check('3: malformed source or cost is 400',(await save(boss,data({sourceRef:ref({fiscalYear:25}),cost:takeout}))).body.error===MSG.sourceInvalid&&(await save(boss,data({sourceRef:ref({page:0}),cost:takeout}))).body.error===MSG.sourceInvalid&&(await save(boss,data({sourceRef:ref(),cost:{...takeout,includes:[]}}))).body.error===MSG.costInvalid);
r=await save(boss,data({key:'franchise_deposit',value:'500만원',cost:takeout}));
check('4: confirming a disclosure item without source is 400',r.status===400&&r.body.error===MSG.sourceRequired);
check('5: another brand version or an unknown version is 400',(await save(boss,data({key:'royalty_fee',value:'매출의 3%',sourceRef:ref({disclosureVersionId:vO})}))).body.error===MSG.versionOtherBrand&&(await save(boss,data({key:'royalty_fee',value:'매출의 3%',sourceRef:ref({disclosureVersionId:'dv-missing'})}))).body.error===MSG.versionOtherBrand);
check('6: a retired version is 400',(await save(boss,data({key:'royalty_fee',value:'매출의 3%',sourceRef:ref({disclosureVersionId:vRetired})}))).body.error===MSG.versionNotCurrent);
check('7: a fiscal year that does not end before registration is 400',(await save(boss,data({key:'royalty_fee',value:'매출의 3%',sourceRef:ref({fiscalYear:2026})}))).body.error===MSG.fiscalYearInvalid);
r=await save(boss,data({brandId:M,key:'royalty_fee',value:'매출의 3%',sourceRef:{disclosureVersionId:vM,fiscalYear:2026,page:null}}));
check('7: a March fiscal year end lets fiscal year 2026 pass for a July 2026 registration',r.status===200);
check('7: March fiscal year 2027 is rejected',(await factPost(boss,{action:'save_fact',id:r.body.id,version:r.body.version,confirmed:true,data:data({brandId:M,key:'royalty_fee',value:'매출의 3%',sourceRef:{disclosureVersionId:vM,fiscalYear:2027,page:null}})})).body.error===MSG.fiscalYearInvalid);
const count12=(over={})=>data({key:'franchise_store_count',value:'12개',validUntil:UNTIL_Y,sourceRef:ref({page:7,asOf:'2025-12-31'}),...over});
check('8: a count item without a reference date, or dated after registration, is 400',(await save(boss,count12({sourceRef:ref({page:7})}))).body.error===MSG.asOfRequired&&(await save(boss,count12({sourceRef:ref({page:7,asOf:'2026-04-01'})}))).body.error===MSG.asOfRequired);
check('9: startup cost without area, or a fee without store type and items, is 400',(await save(boss,startup('매장형',null))).body.error===MSG.costRequired&&(await save(boss,data({sourceRef:ref()}))).body.error===MSG.costRequired);
check('10: confirming without a profile fiscal year end is 400',(await save(boss,data({brandId:P,key:'royalty_fee',value:'매출의 3%',sourceRef:{disclosureVersionId:vP,fiscalYear:2025,page:null}}))).body.error===MSG.fiscalYearEndMissing);
r=await save(boss,data({key:'royalty_fee',value:'매출의 3%',sourceRef:ref(),validUntil:'2026-11-15T00:00:00+09:00'}));
check('11: validUntil beyond the next change-registration deadline is 400 with the deadline',r.status===400&&r.body.error===facts.validUntilCapMessage('2026-10-30')&&r.body.error.includes(DISCLAIMER));
// 1: 스위치 꺼짐
await flag(false);
const offCandidate=await save(boss,data({key:'royalty_fee',value:'매출의 3%',status:'candidate',sourceRef:ref()}));
const offConsumer=await save(boss,{brandId:A,key:'signature_menu',value:'매일 직접 굽는 수제 도넛',status:'candidate',source:'',verifiedAt:'',validUntil:''});
const offReject=await factPost(boss,{action:'save_fact',id:feeCafe.id,version:feeCafe.version,data:data({status:'rejected'})});
check('1: switch off blocks franchise writes (409) but not consumer facts or franchise rejections',offCandidate.status===409&&offCandidate.body.error===MSG.off&&offConsumer.status===200&&offReject.status===200&&offReject.body.fact.status==='rejected'&&same(offReject.body.fact.sourceRef,feeCafe.fact.sourceRef));
const nonFr=[];
for(const key of ['가맹비','판매채널','월 매출']){r=await save(boss,{brandId:N,key,value:'가상 값 '+key,status:'confirmed',source:'가상 근거',verifiedAt:VERIFIED,validUntil:UNTIL_Y});nonFr.push(r)}
check('a brand without franchise context confirms free keys 가맹비·판매채널·월 매출 with the switch off, keys stored as typed',nonFr.every(x=>x.status===200)&&same(nonFr.map(x=>factRow(x.body.id).key),['가맹비','판매채널','월 매출']));
check('non-franchise save response keys and stored JSON are unchanged',nonFr.every(x=>same(Object.keys(x.body).sort(),['fact','id','reviewPublications','version','warnings'])&&same(x.body.warnings,[])&&!('sourceRef' in factRow(x.body.id))&&!('cost' in factRow(x.body.id))));
check('the switch-off rejection wrote nothing for the rejected franchise candidate',!sql.prepare("SELECT 1 FROM records WHERE kind='brand_fact' AND json_extract(data,'$.key')='royalty_fee' AND json_extract(data,'$.brandId')=?").get(A));
await flag(true);
// 13·14 역할·동시 수정
r=await save(member,data({key:'royalty_fee',value:'매출의 3%',sourceRef:ref()}));
check('13: member confirmation is 403 with the existing text',r.status===403&&r.body.error==='사실 확정·거절과 확정·거절된 사실 수정은 관리자만 할 수 있습니다. 확인 후보로 제안해 주세요.');
const memberCandidate=await save(member,data({key:'royalty_fee',value:'매출의 3%',status:'candidate',sourceRef:ref()}));
check('13: member proposes a franchise candidate with a source (200)',memberCandidate.status===200&&memberCandidate.body.fact.status==='candidate'&&memberCandidate.body.fact.key==='royalty_fee');
const edit=d=>factPost(boss,{action:'save_fact',id:memberCandidate.body.id,version:1,confirmed:true,data:d});
const [first,second]=[await edit(data({key:'royalty_fee',value:'매출의 3%',sourceRef:ref()})),await edit(data({key:'royalty_fee',value:'매출의 3%',sourceRef:ref()}))];
check('14: saving the same fact version twice gives 200 then 409',first.status===200&&second.status===409);

// ════ 5) 소재·발행: 각주·H6·근거 없음 ════
const CAMP={id:'ff-camp-a',brandId:A,title:'가상 도넛 가을',version:1,status:'approved',startDate:'2026-09-01',endDate:'2026-12-31',budget:0,budgetConfirmedAt:'2026-09-01T00:00:00.000Z'};
await server.recordStatement(WS,'campaign',CAMP.id,CAMP).run();
await server.recordStatement(WS,'publisher_credential',A,{secret:await server.encrypt('synthetic-buffer-token'),channelId:'channel-1',account:'가상 계정',organizationId:'org',version:1},A).run();
const limits=await execPost(boss,{action:'save_limits',campaignId:CAMP.id,maxPublications:5,maxPlannedCostKRW:0});assert.equal(limits.status,200);
const sc=await save(boss,count12());assert.equal(sc.status,200,JSON.stringify(sc.body));
const creative=(ids,campaignId=CAMP.id)=>execPost(boss,{action:'save_creative',campaignId,campaignVersion:1,factRefs:ids.map(x=>({id:x.id,version:x.version})),png:PNG});
const card1=await creative([sc.body]);
const NOTE_V1='※ 정보공개서 등록 버전 가상 정보공개서 2026(등록일 2026-03-15) · 기준 사업연도 2025년 · 확인일 2026-09-25';
check('a store count card gets the fact line and the deterministic footnote in its caption',card1.status===200&&card1.body.caption==='가맹점 수 (2025-12-31 기준): 12개\n'+NOTE_V1);
check('the same card request returns the same creative (idempotent)',(await creative([sc.body])).body.id===card1.body.id);
const pub=await execPost(boss,{action:'save_publication',campaignId:CAMP.id,creativeId:card1.body.id,scheduledAt:'2026-10-15T01:00:00.000Z',plannedCostKRW:0});
check('the publication draft carries the footnote',pub.status===200&&pub.body.caption.endsWith(NOTE_V1));
const approve=(p,s=boss)=>execPost(s,{action:'approve',campaignId:CAMP.id,id:p.id,version:p.version,confirmed:true,rightsConfirmed:true,immutableMediaConfirmed:true,channelId:'channel-1',credentialVersion:1,limitsVersion:limits.body.version});
const setCaption=(kind,id,text)=>sql.prepare("UPDATE records SET data=json_set(data,'$.caption',?) WHERE kind=? AND json_extract(data,'$.id')=?").run(text,kind,id);
const strip=t=>t.split('\n').filter(l=>!l.startsWith('※ 정보공개서')).join('\n');
setCaption('execution_creative',card1.body.id,strip(card1.body.caption));setCaption('execution_publication',pub.body.id,strip(pub.body.caption));
r=await approve(pub.body);
check('a caption with the footnote removed from both rows is rejected at approval (409)',r.status===409&&r.body.error===MSG.footnoteMissing);
setCaption('execution_creative',card1.body.id,card1.body.caption);
r=await approve(pub.body);
check('removing it from the publication row only hits the existing material-changed 409 first',r.status===409&&r.body.error==='소재가 변경됐습니다. 다시 준비하세요.');
setCaption('execution_publication',pub.body.id,pub.body.caption);
check('member approval stays 403',(await approve(pub.body,member)).status===403);
const approved=await approve(pub.body);
check('the intact caption approves (200)',approved.status===200&&approved.body.status==='approved');
const revenue=await save(boss,data({key:'monthly_sales',value:'월 4,200만원',validUntil:UNTIL_Y,sourceRef:ref()}));
r=await creative([revenue.body]);
check('a revenue fact is stored but its card is 409 (H6)',revenue.status===200&&r.status===409&&r.body.error===MSG.revenueNoAd);
await server.recordStatement(WS,'brand_fact','ff-legacy',{id:'ff-legacy',brandId:A,key:'가맹비',value:'870만원',status:'confirmed',source:'옛 기록',verifiedAt:'2026-09-01T00:00:00.000Z',validUntil:'2027-01-01T00:00:00.000Z',version:1,updatedAt:'2026-09-01T00:00:00.000Z'},A).run();
r=await creative([{id:'ff-legacy',version:1}]);
check('an old free-key 가맹비 fact without source in a franchise brand is 409 in use',r.status===409&&r.body.error===MSG.sourceMissingInUse);
const menu=await factPost(boss,{action:'save_fact',id:offConsumer.body.id,version:offConsumer.body.version,confirmed:true,data:{brandId:A,key:'signature_menu',value:'매일 직접 굽는 수제 도넛',status:'confirmed',source:'대표 확인',verifiedAt:VERIFIED,validUntil:UNTIL_Y}});
r=await creative([menu.body]);
check('a consumer fact card in a franchise brand keeps the plain caption',r.status===200&&r.body.caption==='대표 메뉴: 매일 직접 굽는 수제 도넛');
let g=await factGet(boss,'brandId='+A);
check('GET adds the franchise block with version states, current version and facts to move',g.status===200&&g.body.franchise.currentVersionId===v1&&g.body.franchise.enabled===true&&g.body.franchise.fiscalYearEnd==='2025-12-31'&&g.body.franchise.disclaimer===DISCLAIMER&&g.body.franchise.versions.find(v=>v.id===vRetired)?.state==='retired'&&g.body.franchise.staleFactIds.includes('ff-legacy')&&!g.body.franchise.staleFactIds.includes(sc.body.id));

// ════ 6) 버전 교체 → 재검토, 옮기기 ════
const V2META={registeredAt:'2026-09-20T10:00:00+09:00',validFrom:'2026-09-01',validUntil:'2027-09-30'};
const regV2=await register(A,'가상 정보공개서 2026 변경','ff dv2',V2META),v2=regV2.body.result.id;
const pubRow=JSON.parse(sql.prepare("SELECT data FROM records WHERE kind='execution_publication' AND json_extract(data,'$.id')=?").get(pub.body.id).data);
check('17: registering a newer version flags the approved publication that used the old version fact',regV2.body.reviewPublications===1&&!!pubRow.needsReview&&pubRow.status==='approved');
check('17: the fact itself is not rewritten automatically',factRow(sc.body.id).sourceRef.disclosureVersionId===v1&&factRow(sc.body.id).version===sc.body.version);
const again=await register(A,'가상 정보공개서 2026 변경','ff dv2',V2META);
check('17: re-registering the same SHA-256 returns the existing version without a review count',again.body.result.id===v2&&again.body.result.existing===true&&!('reviewPublications' in again.body));
r=await creative([sc.body]);
check('a card with a superseded-version fact is 409',r.status===409&&r.body.error===MSG.staleFact);
check('16: saving with the superseded version is 400',(await save(boss,data({key:'royalty_fee',value:'매출의 3%',sourceRef:ref()}))).body.error===MSG.versionNotCurrent);
r=await save(boss,count12({sourceRef:ref({disclosureVersionId:v2,page:7,asOf:'2025-12-31'})}));
check('18: a new fact for the same item while the old-version fact exists is 409 (no parallel facts)',r.status===409&&r.body.error===MSG.staleDuplicate);
g=await factGet(boss,'brandId='+A);
check('GET marks the old-version fact to move and the new current version',g.body.franchise.currentVersionId===v2&&g.body.franchise.versions.find(v=>v.id===v1).state==='superseded'&&g.body.franchise.staleFactIds.includes(sc.body.id));
const item=(over={})=>({id:sc.body.id,version:sc.body.version,fiscalYear:2025,page:7,asOf:'2025-12-31',verifiedAt:'2026-09-26T09:00:00+09:00',validUntil:UNTIL_Y,...over});
const rebase=(s,items,versionId=v2)=>factPost(s,{action:'rebase_facts',brandId:A,disclosureVersionId:versionId,items});
check('19: member rebase is 403',(await rebase(member,[item()])).body.error===MSG.rebaseAdminOnly);
await flag(false);r=await rebase(boss,[item()]);await flag(true);
check('19: rebase with the switch off is 409',r.status===409&&r.body.error===MSG.off);
check('19: a non-current target version is 400',(await rebase(boss,[item()],v1)).body.error===MSG.versionNotCurrent);
check('19: a stale fact version is 409',(await rebase(boss,[item({version:99})])).status===409);
check('19: a consumer or candidate fact cannot be moved',(await rebase(boss,[{...item(),id:menu.body.id,version:menu.body.version}])).body.error===MSG.rebaseInvalid);
const factsBefore=count('brand_fact');
const moved=await rebase(admin,[item()]);
const history=JSON.parse(sql.prepare("SELECT data FROM records WHERE kind='brand_fact_history' AND id=?").get(`${WS}:brand_fact_history:${sc.body.id}:${sc.body.version}`).data);
check('19: an admin rebase rewrites the fact to the new version, keeps the old source in history and counts review publications',moved.status===200&&moved.body.rebased===1&&moved.body.unchanged===0&&typeof moved.body.reviewPublications==='number'&&factRow(sc.body.id).sourceRef.disclosureVersionId===v2&&factRow(sc.body.id).version===sc.body.version+1&&factRow(sc.body.id).value==='12개'&&history.sourceRef.disclosureVersionId===v1);
const movedVersion=factRow(sc.body.id).version;
const repeat=await rebase(boss,[item({version:movedVersion})]);
check('19: repeating the same rebase is idempotent',repeat.status===200&&repeat.body.rebased===0&&repeat.body.unchanged===1&&repeat.body.reviewPublications===0&&count('brand_fact')===factsBefore&&factRow(sc.body.id).version===movedVersion);
r=await creative([factRow(sc.body.id)]);
check('a card with the moved fact carries the new version footnote',r.status===200&&r.body.caption==='가맹점 수 (2025-12-31 기준): 12개\n※ 정보공개서 등록 버전 가상 정보공개서 2026 변경(등록일 2026-09-20) · 기준 사업연도 2025년 · 확인일 2026-09-26');
const cur=factRow(sc.body.id);
r=await factPost(boss,{action:'save_fact',id:cur.id,version:cur.version,confirmed:true,data:count12({verifiedAt:cur.verifiedAt,sourceRef:{disclosureVersionId:v2,fiscalYear:2025,page:7,asOf:'2026-06-30'}})});
check('20: changing only the source reference date counts review publications',r.status===200&&r.body.reviewPublications>=1);
check('amending the label of the current version flags the publications whose footnote changes',(await frPost(boss,{action:'amend_disclosure_version',brandId:A,id:v2,version:1,reasonCode:'typo',label:'가상 정보공개서 2026 변경(정정)'})).body.reviewPublications>=1);

// ════ 7) 비가맹 불변 ════
const CN={...CAMP,id:'ff-camp-n',brandId:N};
await server.recordStatement(WS,'campaign',CN.id,CN).run();
const address=await save(boss,{brandId:N,key:'address',value:'가상시 가상구 가상로 12',status:'confirmed',source:'대표 확인',verifiedAt:VERIFIED,validUntil:UNTIL_Y});
const plainCard=await creative([address.body],CN.id);
const nBrand=await server.readRecord(WS,'brand',N);
const oldHash=createHash('sha256').update(JSON.stringify([nBrand.name,nBrand.color,[[address.body.id,address.body.version]],'주소: 가상시 가상구 가상로 12'])).digest('hex');
check('22: a non-franchise creative keeps the previous caption and materialHash formula',plainCard.status===200&&plainCard.body.caption==='주소: 가상시 가상구 가상로 12'&&plainCard.body.materialHash===oldHash);
const nState=await execGet(boss,CN.id);
check('22: the non-franchise creative is current and the state has no franchise key',nState.body.creatives.find(c=>c.id===plainCard.body.id)?.current===true&&!('franchise' in nState.body));
g=await factGet(boss,'brandId='+N);
check('21: GET for a brand without franchise context has no franchise key',g.status===200&&!('franchise' in g.body));

// ════ 8) 문구 경계 ════
const FORBIDDEN=/법적으로 적합|준수 완료|합법/;
check('23: new modules, route responses and docs make no legal-adequacy claim',['lib/franchise-facts.ts','lib/franchise-facts-server.ts','app/api/brand-facts/route.ts','docs/FRANCHISE-RECRUITMENT-PLAN.ko.md','docs/SECURITY-BOUNDARIES.ko.md'].every(p=>!FORBIDDEN.test(readFileSync(p,'utf8')))&&!FORBIDDEN.test(JSON.stringify(responses)));
check('no external network call from the franchise fact paths',f.calls.length===0);

// ════ 9) 모델 제출 바이트 불변 ════
// 같은 사실 id·버전으로 A(가맹 기록 없음, 사실에 근거·상세 없음)와 B(가맹 프로필·버전, 사실에 sourceRef·cost)를 만들고 역할·회의·브리프 제출 본문을 비교한다.
async function modelRun(franchiseSide){
 const hermes=mockHermes();
 const RealDate=Date,started=RealDate.now(),pinned=RealDate.parse('2026-03-15T09:00:00.000Z'),clock=()=>pinned+RealDate.now()-started;
 class PinnedDate extends RealDate{constructor(...a){super(...(a.length?a:[clock()]))}static now(){return clock()}}
 globalThis.Date=PinnedDate;let rt;try{rt=testRuntime(hermes.fetch)}finally{globalThis.Date=RealDate}
 const s=await rt.load('lib/server.ts'),execution=await rt.load('lib/role-execution.ts'),meeting=await rt.load('lib/meeting-execution.ts'),brief=await rt.load('lib/brief-execution.ts');
 const owner='ff-model-owner';
 const put=await seed(s,rt.sql,owner);
 const fee={id:'ff-model-fee',brandId:seedBrand.id,key:'franchise_fee',value:'870만원',status:'confirmed',source:'합성 정보공개서',verifiedAt:seedNow,validUntil:'2099-12-31T00:00:00.000Z',version:1,updatedAt:seedNow};
 if(franchiseSide){
  await put('franchise_profile',seedBrand.id,{id:seedBrand.id,brandId:seedBrand.id,branch:'A',forecastInputs:{sme:true,storesAtFyEnd:3,fiscalYearEnd:'2025-12-31'},holidays:null,storageLabels:[LABEL],eligibility:null,version:1,updatedAt:seedNow,updatedBy:{id:'x',role:'owner'}},seedBrand.id);
  await put('franchise_disclosure_version','dv-model',{id:'dv-model',brandId:seedBrand.id,label:'가상 정보공개서 모델본',sha256:sha64('model'),registeredAt:'2025-12-01T00:00:00.000Z',validFrom:'2025-12-01T00:00:00.000Z',validUntil:'2099-01-01T00:00:00.000Z',storageLabel:LABEL,status:'active',version:1,createdAt:seedNow,createdBy:{id:'x',role:'owner'}},seedBrand.id);
  await put('brand_fact',fee.id,{...fee,sourceRef:{disclosureVersionId:'dv-model',fiscalYear:2024,page:3},cost:{storeType:'테이크아웃형',includes:['가맹비'],excludes:['없음'],areaM2:null}},seedBrand.id);
 }else await put('brand_fact',fee.id,fee,seedBrand.id);
 // 사실 목록 순서(updated_at)가 두 실행에서 같도록 행 시각을 고정한다.
 rt.sql.prepare('UPDATE records SET updated_at=? WHERE id=?').run('2026-01-01T00:00:00.500Z',`${owner}:brand_fact:${fee.id}`);
 await runRole(execution,s,owner,roleCampaign,'cmo');
 await runMeeting(meeting,s,owner,meetingCampaign,'ff-model-meeting');
 const started2=await (await brief.executeBrief(owner,{action:'start',id:'ff-model-brief',data:{brandId:seedBrand.id,title:'가상 브리프',goal:'첫 방문을 늘린다.'}})).json();
 assert.equal(started2.status,'queued',JSON.stringify(started2));
 return {bodies:[...hermes.bodies.values()].map(b=>String(b).replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g,'<uuid>').replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z/g,'<iso>')),external:hermes.external};
}
const before=await modelRun(false),after=await modelRun(true);
check('role, meeting and brief submissions ran on the mock',before.bodies.length>3&&after.bodies.length===before.bodies.length&&!before.external.length&&!after.external.length);
check('model submission bytes are identical with or without franchise source and cost',same(before.bodies,after.bodies));
check('no franchise source detail reaches a model submission',after.bodies.every(b=>!/sourceRef|disclosureVersionId|정보공개서 등록 버전|가상 정보공개서 모델본|storeType|dv-model/.test(b))&&after.bodies.some(b=>b.includes('franchise_fee')));

console.log(JSON.stringify({passed:passed.length}));
