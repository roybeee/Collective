// 트랙 R R15b-2 모집 카드 묶음 경로 스위트(/api/franchise asset_save·asset_approve·asset_export, GET assets·asset): 자료 유형 card_bundle이 실제 라우트·메모리 SQLite에서
// 모집 코드 장부(recruitment_code 행)를 읽어 QR을 판정하는지, 원장에 없는 수치·쓸 수 없는 코드가 400인지, 초안 저장은 경고만인지, 감사 행에 원문·링크가 없는지 본다. 사례 번호 CR-*는 PR 본문과 같다.
// 근거: mocked(메모리 SQLite node:sqlite, 이메일 모드 세션 주입, 외부 fetch는 던지는 스텁, 시계 이동 Date). PNG 그리기는 브라우저 몫이라 로컬 E2E(e2e/franchise-recruit.spec.ts)가 본다.
// 결과는 COLLECTIVE 휴리스틱 · 법률 자문 아님.
import assert from 'node:assert/strict';
import {franchiseFixture,captureConsole,DISCLAIMER,plain,sha64} from './helpers/franchise-fixture.mjs';

const logged=captureConsole();
const f=await franchiseFixture();
const {sql,env,server}=f;
env.AUTH_MODE='email';env.AUTH_ORIGIN='https://agency.test';
const passed=[];const check=(name,val)=>{assert.ok(val,name);passed.push(name)};
const setNow=ms=>f.clock.set(ms-Date.now());
setNow(Date.parse('2026-10-05T03:00:00Z'));
const fc=await f.load('lib/franchise-cards.ts'),fa=await f.load('lib/franchise-assets.ts'),wrm=await f.load('lib/franchise-wait-review.ts'),factsRoute=await f.load('app/api/brand-facts/route.ts');
const WS='cr-owner';
const boss=f.signIn('cr-boss','admin',1000,WS),member=f.signIn('cr-member','member',3000,WS);
for(const b of ['fr-a','fr-b'])await f.brand(WS,b);
const post=(s,input)=>f.post(s,input),get=(s,q)=>f.get(s,q);
const headersOf=s=>Object.fromEntries(Object.entries(s).filter(([k])=>k!=='id'));
const factPost=async(s,input)=>{const res=await factsRoute.POST(new Request('https://agency.test/api/brand-facts',{method:'POST',headers:{'content-type':'application/json',...headersOf(s)},body:JSON.stringify(input)}));return {status:res.status,body:JSON.parse(await res.text())}};
const reasons=r=>(r.body.reasons||[]).map(x=>x.code);
const codesAre=(r,status,...list)=>r.status===status&&JSON.stringify(reasons(r))===JSON.stringify(list);
const assetRow=(id,v)=>JSON.parse(sql.prepare("SELECT data FROM records WHERE kind='recruitment_asset' AND id=?").get(`${WS}:recruitment_asset:${id}:${v}`).data);
const audits=action=>sql.prepare("SELECT data FROM records WHERE kind='franchise_audit' AND json_extract(data,'$.action')=?").all(action).map(r=>JSON.parse(r.data));

// ── 준비: 스위치·분기 A·정보공개서 버전·사실·모집 캠페인·모집 코드 ──
check('owner turns the franchise switch on',(await f.setFlag(boss,true)).status===200);
const LABEL='가상 보관함',FY={forecastInputs:{sme:true,storesAtFyEnd:3,fiscalYearEnd:'2025-12-31'},storageLabels:[LABEL]};
for(const b of ['fr-a','fr-b'])assert.equal((await f.profile(boss,b,{...FY,branch:'A'},0)).status,200);
const dv=await post(boss,{action:'register_disclosure_version',brandId:'fr-a',label:'가상 정보공개서 A',sha256:sha64('cr dvA'),storageLabel:LABEL,registeredAt:'2026-03-15T10:00:00+09:00',validFrom:'2026-03-15',validUntil:'2027-06-30'});
assert.equal(dv.status,200,JSON.stringify(dv.body));
const dvA=dv.body.result.id;
const total=await factPost(boss,{action:'save_fact',confirmed:true,data:{brandId:'fr-a',status:'confirmed',source:'가상 정보공개서',verifiedAt:'2026-09-25T10:00:00+09:00',validUntil:'2026-10-30T12:00:00+09:00',key:'startup_cost_total',value:'4,500만원',sourceRef:{disclosureVersionId:dvA,fiscalYear:2025,page:12},cost:{storeType:'소형 매장',includes:['가맹비','교육비','인테리어'],excludes:['임차보증금','권리금'],areaM2:33}}});
assert.equal(total.status,200,JSON.stringify(total.body));
const TOTAL=total.body;
await server.recordStatement(WS,'campaign','ca-a',{id:'ca-a',brandId:'fr-a',title:'가상 가맹 모집 A',goal:'가상 목표',audience:'',channels:'',stores:'',products:'',budget:null,startDate:'',endDate:'',constraints:'',sources:'',status:'approved',version:1,createdAt:'2026-10-01T00:00:00.000Z',updatedAt:'2026-10-01T00:00:00.000Z',objective:'franchise_recruitment'}).run();
const issue=async(brandId,x={})=>{const r=await post(boss,{action:'code_issue',brandId,channel:'expo',label:'가상 박람회 부스',...x});assert.equal(r.status,200,JSON.stringify(r.body));return r.body.result.code};
const CODE_A=await issue('fr-a'),CODE_B=await issue('fr-b');
check('CR-0 two brand codes were issued as R codes',[CODE_A,CODE_B].every(c=>/^R[A-Z0-9]{7}$/.test(c))&&CODE_A!==CODE_B);

// ── 원문 ──
const list=await get(member,'view=assets&brandId=fr-a');
check('CR-1 the assets view lists the card type and serves the card template',list.status===200&&list.body.types.some(t=>t.type==='card_bundle'&&t.label==='모집 카드 묶음(PNG)')&&list.body.templates.card_bundle===fa.sectionTemplate('card_bundle'));
const FOOT='※ 정보공개서 등록 버전 가상 정보공개서 A(등록일 2026-03-15) · 기준 사업연도 2025년 · 확인일 2026-09-25';
const URL_OF=code=>`https://ofd.example.kr/franchise?utm_content=${code}`;
const body=(x={})=>['■ 1장 [의견]',x.why??'매일 아침 굽는 도넛 브랜드입니다.','','■ 2장 [사실]','총 창업비용 · 소형 매장: 4,500만원','포함: 가맹비, 교육비, 인테리어 · 불포함: 임차보증금, 권리금 · 전용면적 33㎡',FOOT,'','■ 3장 [COLLECTIVE 휴리스틱 · 법률 자문 아님]',fa.WAITING_NOTES[0],'','■ 4장','가맹 문의','QR '+(x.url??URL_OF(CODE_A))].join('\n');
const REFS=[{id:TOTAL.id,version:TOTAL.version}];
const save=(s,b,x={})=>post(s,{action:'asset_save',brandId:'fr-a',campaignId:'ca-a',type:'card_bundle',factRefs:REFS,body:b,...x});
const CHECK={version:fa.CHECKLIST_VERSION,checked:plain(fa.CHECKLIST_IDS)};
const WRV=a=>({waitReview:{version:wrm.WAIT_REVIEW_VERSION,confirmed:true,candidates:wrm.waitReviewSummary(assetRow(a.assetId,a.version).body).candidates}});
const approve=a=>post(boss,{action:'asset_approve',brandId:'fr-a',assetId:a.assetId,version:a.version,bodyHash:a.bodyHash,checklist:CHECK,...WRV(a)});
const exportAsset=a=>post(boss,{action:'asset_export',brandId:'fr-a',assetId:a.assetId,version:a.version,mode:'download',...WRV(a)});

// ════ 저장은 경고만 ════
let r=await save(member,fa.sectionTemplate('card_bundle'));
check('CR-2 a member saves the empty card template (200) and gets the card warnings',r.status===200&&[fc.CARD_MESSAGES.card_structure,fc.CARD_MESSAGES.card_qr_invalid].every(m=>r.body.warnings.includes(m)));
const tpl=r.body.result;
check('CR-3 approving the empty template is 400 card_qr_invalid and card_structure',codesAre(await approve(tpl),400,'card_qr_invalid','card_structure'));

// ════ 정상 흐름 ════
r=await save(member,body());
check('CR-4 a filled bundle saves without card warnings',r.status===200&&!r.body.warnings.some(w=>Object.values(fc.CARD_MESSAGES).includes(w)));
const good=r.body.result;
const detail=await get(member,`view=asset&brandId=fr-a&assetId=${good.assetId}`);
check('CR-5 the detail gate has no code for the good bundle',detail.status===200&&detail.body.gate.status===200&&detail.body.gate.reasons.length===0);
r=await approve(good);
check('CR-6 the owner approves the bundle (200)',r.status===200&&r.body.result.status==='approved');
r=await exportAsset(good);
check('CR-7 the export returns the exact approved body for PNG drawing',r.status===200&&r.body.body===body()&&sha64(r.body.body)===good.bodyHash&&r.body.disclaimer===DISCLAIMER);

// ════ 거부 ════
r=await save(member,body({url:URL_OF(CODE_B)}));
const other=r.body.result;
check('CR-8 a code of another brand is 400 card_qr_invalid (and a warning at save)',r.status===200&&r.body.warnings.includes(fc.CARD_MESSAGES.card_qr_invalid)&&codesAre(await approve(other),400,'card_qr_invalid'));
r=await save(member,body({url:'https://ofd.example.kr/franchise?utm_content=RZZZZZZZ'}));
check('CR-9 an unissued code is 400 card_qr_invalid',codesAre(await approve(r.body.result),400,'card_qr_invalid'));
r=await save(member,body({why:'가맹점 120개를 넘었습니다.'}));
const unbacked=r.body.result;
check('CR-10 a number not in the fact ledger is 400 card_number_unbacked at approval',codesAre(await approve(unbacked),400,'card_number_unbacked'));
const gate=await get(member,`view=asset&brandId=fr-a&assetId=${unbacked.assetId}`);
check('CR-11 the detail gate shows the same 400 code',gate.body.gate.status===400&&JSON.stringify(gate.body.gate.reasons.map(x=>x.code))==='["card_number_unbacked"]');
// 사용 중지: 내보낸 뒤 코드를 오늘부터 중지하면 다음 내보내기는 400이다.
const retired=await post(boss,{action:'code_retire',brandId:'fr-a',code:CODE_A,version:1});
check('CR-12 the owner retires the code used in the approved bundle',retired.status===200);
check('CR-13 exporting the approved bundle after the code is retired is 400 card_qr_invalid',codesAre(await exportAsset(good),400,'card_qr_invalid'));
check('CR-14 400 card failures leave no blocked receipt (409 only)',audits('asset_blocked').length===0);

// ════ 감사·경계 ════
const rows=sql.prepare("SELECT data FROM records WHERE kind='franchise_audit'").all().map(x=>x.data).join('\n');
check('CR-15 audit rows carry no card text or QR link',!rows.includes('ofd.example.kr')&&!rows.includes('매일 아침 굽는'));
check('CR-16 no external call and no card text or link in the console',f.calls.length===0&&!logged.some(l=>l.includes('ofd.example.kr')||l.includes('매일 아침 굽는')));

console.log(JSON.stringify({passed:passed.length}));
