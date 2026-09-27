// 트랙 R R5b-1 모집 코드·모집 비용 경로 스위트(/api/franchise 작업 code_issue·code_retire·spend_record·spend_void, 리드 add_lead_codes·strike_lead_code, GET codes·spend,
// 보드·리드 보기의 귀속과 code_conflict 할 일, 행사 spendRef 존재 확인). 명세 docs/FRANCHISE-R5-SPEC.ko.md 6.2 R5b-1 사례(RR-*) 이름이 검사 이름에 붙는다.
// 권한(직원 403), 스위치(r_franchise 꺼짐 409, 사용 중지·무효화는 허용), 분기(B면 발급 409·비용 200), 멱등(같은 요청 번호 재생·다른 입력 REQUEST_REUSED 409, 같은 코드 경쟁 409),
// 감사 행 허용 키(라벨·증빙·금액 없음), 수식 주입 기준 사례, 외부 호출 0. 결과는 COLLECTIVE 휴리스틱 · 법률 자문 아님.
// 근거: mocked(메모리 SQLite node:sqlite, 이메일 모드 세션 주입, 외부 fetch는 던지는 스텁, 시계 이동 Date, batch 가로채기로 경합 재현). 운영 real 확인은 not_run(미게시, 명세 6.4).
import assert from 'node:assert/strict';
import {franchiseFixture,captureConsole,HOUR,DAY,DISCLAIMER,plain} from './helpers/franchise-fixture.mjs';

const logged=captureConsole();
const f=await franchiseFixture();
const {sql,env,server}=f;
env.AUTH_MODE='email';env.AUTH_ORIGIN='https://agency.test';
const passed=[];const check=(name,val)=>{assert.ok(val,name);passed.push(name)};
const setNow=ms=>f.clock.set(ms-Date.now()),nowMs=()=>f.clock.now();
const kstDay=(d=0)=>new Date(nowMs()+9*HOUR+d).toISOString().slice(0,10);
setNow(Date.parse('2026-10-05T03:00:00Z'));
const rec=await f.load('lib/franchise-recruitment.ts');
const E=plain(f.lib.FRANCHISE_ERRORS),T=k=>E[k]?.text;
const WS='rr-owner',WS2='rr-owner-2';
const boss=f.signIn('rr-boss','admin',1000,WS),admin=f.signIn('rr-admin','admin',2000,WS),member=f.signIn('rr-member','member',3000,WS),member2=f.signIn('rr-member-2','member',4000,WS);
const boss2=f.signIn('rr-boss-2','admin',1000,WS2);
for(const b of ['fr-a','fr-b','fr-c'])await f.brand(WS,b);
await f.brand(WS2,'fr-z');

// ── 보조 ──
const responses=[];
const post=async(s,input)=>{const r=await f.post(s,input);responses.push(r.body);return r};
const get=async(s,q)=>{const r=await f.get(s,q);responses.push(r.body);return r};
const headersOf=s=>Object.fromEntries(Object.entries(s).filter(([k])=>k!=='id'));
const storeRoute=await f.load('app/api/store-operations/route.ts');
const storePost=async(s,input)=>{const res=await storeRoute.POST(new Request('https://agency.test/api/store-operations',{method:'POST',headers:{'content-type':'application/json',...headersOf(s)},body:JSON.stringify(input)}));return {status:res.status,body:await res.json()}};
const snapshot=()=>sql.prepare("SELECT id,data FROM records WHERE kind LIKE 'recruitment_%' OR kind LIKE 'franchise_%' ORDER BY id").all().map(r=>r.id+'\t'+r.data).join('\n');
const codeRow=code=>{const r=sql.prepare("SELECT data FROM records WHERE kind='recruitment_code' AND id=?").get(`${WS}:recruitment_code:${code}`);return r?JSON.parse(r.data):null};
const spendRow=id=>{const r=sql.prepare("SELECT data FROM records WHERE kind='recruitment_spend' AND id=?").get(`${WS}:recruitment_spend:${id}`);return r?JSON.parse(r.data):null};
const countKind=kind=>Number(sql.prepare('SELECT COUNT(*) n FROM records WHERE kind=?').get(kind).n);
const audits=action=>sql.prepare("SELECT data FROM records WHERE kind='franchise_audit' AND json_extract(data,'$.action')=?").all(action).map(r=>JSON.parse(r.data));
const events=(leadId,type)=>sql.prepare("SELECT data FROM records WHERE kind='franchise_lead_event' AND parent_id=? AND json_extract(data,'$.type')=?").all(leadId,type).map(r=>JSON.parse(r.data));
const reasons=r=>(r.body.reasons||[]).map(x=>x.code);
const codesAre=(r,status,...list)=>r.status===status&&JSON.stringify(reasons(r))===JSON.stringify(list);
const fixed=(r,status,key)=>r.status===status&&r.body.error===T(key);
const LABEL_TOKEN='가상라벨토큰',EVIDENCE_TOKEN='가상증빙토큰',AMOUNT_TOKEN=7654321;
const ISSUE=(x={})=>({action:'code_issue',brandId:'fr-a',channel:'expo',label:'가상 박람회 부스 '+LABEL_TOKEN,...x});
const SPEND=(x={})=>({action:'spend_record',brandId:'fr-a',channel:'search_ad',period:{from:'2026-09-01',to:'2026-09-30'},amount:AMOUNT_TOKEN,vat:'excluded',funding:'hq_budget',evidence:'관리 화면 월 소진 내역 '+EVIDENCE_TOKEN,...x});
const leadView=(s,id)=>get(s,`view=lead&brandId=fr-a&leadId=${id}`);
const boardRow=async(s,id,q='')=>(await get(s,'view=board&brandId=fr-a'+q)).body.leads.find(l=>l.id===id);

// ── 준비: 스위치·프로필·캠페인·지점 ──
check('owner turns the franchise switch on',(await f.setFlag(boss,true)).status===200);
for(const [b,branch] of [['fr-a','A'],['fr-b','A'],['fr-c','B']]){const r=await f.profile(boss,b,{branch},0);assert.equal(r.status,200,JSON.stringify(r.body))}
const campaign=(id,brandId,x={})=>server.recordStatement(WS,'campaign',id,{id,brandId,title:'가상 캠페인 '+id,status:'approved',version:1,createdAt:'2026-09-01T00:00:00.000Z',updatedAt:'2026-09-01T00:00:00.000Z',...x},brandId).run();
await campaign('ca-a','fr-a',{objective:'franchise_recruitment'});
await campaign('ca-plain','fr-a');
await campaign('ca-b','fr-b',{objective:'franchise_recruitment'});
await campaign('ca-store','fr-a',{storeId:'st-a'});
await server.recordStatement(WS,'store','st-a',{id:'st-a',brandId:'fr-a',name:'가상 지점',status:'active',version:1},'fr-a').run();
const assetRow=(id,version,x={})=>sql.prepare('INSERT INTO records(id,owner,kind,parent_id,data,updated_at) VALUES(?,?,?,?,?,?)').run(`${WS}:recruitment_asset:${id}:${version}`,WS,'recruitment_asset','fr-a',JSON.stringify({id,version,brandId:'fr-a',campaignId:'ca-a',type:'expo_banner',status:'approved',review:{needed:false,reasons:[],at:null},...x}),'2026-10-01T00:00:00.000Z');
assetRow('ra-ok',1);assetRow('ra-old',1);assetRow('ra-old',2,{status:'draft'});

// ════ RR-C 발급 ════
let r=await post(boss,ISSUE());
const C1=r.body.result?.code,row1=codeRow(C1);
check('RR-C1: an owner issues a code: 200 with an R code of eight characters',r.status===200&&rec.isRecruitmentCode(C1)&&r.body.ruleVersion===rec.RECRUITMENT_VERSION&&r.body.disclaimer===DISCLAIMER&&Array.isArray(r.body.warnings));
check('RR-C1: one code row with the issue value, status, version and issuer',!!row1&&row1.code===C1&&row1.brandId==='fr-a'&&row1.channel==='expo'&&row1.label.includes(LABEL_TOKEN)&&row1.validFrom===kstDay()&&row1.status==='active'&&row1.retiredOn===null&&row1.version===1&&row1.createdBy.id==='rr-boss'&&row1.ruleVersion===rec.RECRUITMENT_VERSION&&row1.campaignId===null&&countKind('recruitment_code')===1);
check('RR-C1: one receipt audit with the record id and an input hash',audits('code_issue').length===1&&audits('code_issue')[0].recordId===C1&&/^[0-9a-f]{64}$/.test(audits('code_issue')[0].inputSha256));

const RID='rr-replay-0001';
const first=await post(boss,ISSUE({requestId:RID,channel:'portal'})),again=await post(boss,ISSUE({requestId:RID,channel:'portal'}));
check('RR-C2: the same request id and input replays the same code without a new row',first.status===200&&again.status===200&&again.body.replayed===true&&again.body.result.code===first.body.result.code&&countKind('recruitment_code')===2);
let snap=snapshot();
r=await post(boss,SPEND({requestId:RID}));
check('RR-C2: the same request id on another recruitment action is 409 REQUEST_REUSED and writes nothing',fixed(r,409,'REQUEST_REUSED')&&snapshot()===snap);
const chg=await post(boss,ISSUE({requestId:RID,channel:'youtube'})),custom=await post(boss,ISSUE({requestId:RID,channel:'portal',customCode:'R2345679'}));
check('RR-C2b: the same request id with another channel or a direct code is 409 REQUEST_REUSED and writes nothing',fixed(chg,409,'REQUEST_REUSED')&&fixed(custom,409,'REQUEST_REUSED')&&snapshot()===snap);
const RID2='rr-replay-0002';
const s1=await post(boss,SPEND({requestId:RID2,period:{from:'2026-08-01',to:'2026-08-31'}})),s2=await post(boss,SPEND({requestId:RID2,period:{from:'2026-08-01',to:'2026-08-31'}}));
snap=snapshot();
const s3=await post(boss,SPEND({requestId:RID2,period:{from:'2026-08-01',to:'2026-08-31'},amount:1}));
check('RR-C2b: spend_record replays the same spend and a changed amount under the same id is 409 REQUEST_REUSED',s1.status===200&&s2.body.replayed===true&&s2.body.result.spendId===s1.body.result.spendId&&countKind('recruitment_spend')===1&&fixed(s3,409,'REQUEST_REUSED')&&snapshot()===snap);

r=await storePost(boss,{storeId:'st-a',action:'create_tracking_code',type:'coupon',campaignId:'ca-store',code:'R2345678',label:'가상 쿠폰'});
check('RR-C3: the store route creates a store code R2345678',r.status===200,JSON.stringify(r.body));
snap=snapshot();
const takenStore=await post(boss,ISSUE({customCode:'R2345678'})),takenLower=await post(boss,ISSUE({customCode:'r234-5678'})),takenOwn=await post(boss,ISSUE({customCode:C1}));
check('RR-C3: issuing the value of a store code or an issued recruitment code is 409 code_taken and writes nothing',codesAre(takenStore,409,'code_taken')&&codesAre(takenLower,409,'code_taken')&&codesAre(takenOwn,409,'code_taken')&&snapshot()===snap);
r=await post(boss,ISSUE({customCode:'R23456789'}));
check('RR-C3: a nine-character direct code is 400 code_format without the value in the message',codesAre(r,400,'code_format')&&!JSON.stringify(r.body).includes('R23456789'));

const both=await Promise.all([post(boss,ISSUE({customCode:'R3456789'})),post(admin,ISSUE({customCode:'R3456789'}))]);
check('RR-C4: two simultaneous issues of one code give one 200 and one 409, never 500, and one row',JSON.stringify(both.map(x=>x.status).sort())==='[200,409]'&&Number(sql.prepare("SELECT COUNT(*) n FROM records WHERE id=?").get(`${WS}:recruitment_code:R3456789`).n)===1);
const realBatch=env.DB.batch;
const receiptOf=(stmts,action)=>stmts.some(s=>Array.isArray(s.values)&&s.values.some(v=>typeof v==='string'&&v.includes(`"action":"${action}"`)));
const raceCommit=(action,mutate)=>{env.DB.batch=async stmts=>{if(receiptOf(stmts,action)){env.DB.batch=realBatch;await mutate()}return realBatch(stmts)}};
raceCommit('code_issue',()=>sql.prepare('INSERT INTO records(id,owner,kind,parent_id,data,updated_at) VALUES(?,?,?,?,?,?)').run(`${WS}:recruitment_code:R4567892`,WS,'recruitment_code','fr-a',JSON.stringify({code:'R4567892',brandId:'fr-a',channel:'portal',label:'경합 행',validFrom:'2026-10-05',campaignId:null,assetRef:null,eventId:null,utmCampaign:null,status:'active',retiredOn:null,retiredAt:null,retiredBy:null,version:1,createdAt:'2026-10-05T00:00:00.000Z',createdBy:{id:'rr-race',role:'admin'},ruleVersion:rec.RECRUITMENT_VERSION}),'2026-10-05T00:00:00.000Z'));
const auditsBefore=audits('code_issue').length;
r=await post(boss,ISSUE({customCode:'R4567892'}));
check('RR-C4: a row inserted between the lookup and the commit makes the INSERT fail as 409 CODE_TAKEN with no receipt',fixed(r,409,'CODE_TAKEN')&&audits('code_issue').length===auditsBefore&&codeRow('R4567892').channel==='portal');

snap=snapshot();
const notRecruit=await post(boss,ISSUE({campaignId:'ca-plain'})),otherBrand=await post(boss,ISSUE({campaignId:'ca-b'}));
check('RR-C5: a non-recruitment campaign is 409 campaign_not_recruitment and another brand campaign is 400 campaign_other_brand',codesAre(notRecruit,409,'campaign_not_recruitment')&&codesAre(otherBrand,400,'campaign_other_brand')&&snapshot()===snap);
r=await post(boss,ISSUE({campaignId:'ca-a',assetRef:{id:'ra-ok',version:1}}));
check('RR-C5: a recruitment campaign and an approved current asset version are linked',r.status===200&&codeRow(r.body.result.code).campaignId==='ca-a'&&JSON.stringify(codeRow(r.body.result.code).assetRef)==='{"id":"ra-ok","version":1}');
r=await post(boss,ISSUE({assetRef:{id:'ra-old',version:1}}));
check('RR-C5: an older approved asset version is 409 asset_superseded',codesAre(r,409,'asset_superseded'));
const EV=x=>({action:'event_save',brandId:'fr-a',campaignId:'ca-a',type:'tour',startsAt:'2026-10-20T14:00:00+09:00',placeLabel:'가상 직영점',capacity:5,spendRef:null,assetRefs:[],...x});
const ev1=await post(boss,EV({}));
assert.equal(ev1.status,200,JSON.stringify(ev1.body));
const EV1=ev1.body.result.eventId;
r=await post(boss,ISSUE({channel:'briefing',eventId:EV1}));
check('RR-C5: a scheduled event of the brand is linked',r.status===200&&codeRow(r.body.result.code).eventId===EV1);

// ════ RR-P 권한·스위치·분기 ════
snap=snapshot();
const memberCalls=[];
for(const x of [ISSUE(),{action:'code_retire',brandId:'fr-a',code:C1,version:1},SPEND({period:{from:'2026-07-01',to:'2026-07-31'}}),{action:'spend_void',brandId:'fr-a',spendId:s1.body.result.spendId,version:1,reason:'entry_error'}])memberCalls.push(await post(member,x));
const memberSpend=await get(member,'view=spend&brandId=fr-a');
check('RR-P1: a member gets 403 on code_issue, code_retire, spend_record, spend_void and the spend view, writing nothing',memberCalls.every(x=>fixed(x,403,'ADMIN_ONLY'))&&fixed(memberSpend,403,'ADMIN_ONLY')&&snapshot()===snap);
r=await post(boss,ISSUE({brandId:'fr-c'}));
check('RR-P3: a branch B brand cannot issue a code (409 branch_not_a)',codesAre(r,409,'branch_not_a'));
r=await post(boss,SPEND({brandId:'fr-c',channel:'portal'}));
const SC=r.body.result?.spendId;
check('RR-P3: a branch B brand still records spend',r.status===200&&spendRow(SC).brandId==='fr-c');

// ════ RR-S 비용 ════
snap=snapshot();
const neg=await post(boss,SPEND({amount:-1})),adf=await post(boss,SPEND({funding:'ad_fund'})),adWord=await post(boss,SPEND({evidence:'광고 분담금 정산'})),refr=await post(boss,SPEND({channel:'owner_referral',amount:1000}));
check('RR-S1: a negative amount, the ad fund source or wording and a referral reward are 400 and write nothing',codesAre(neg,400,'amount_negative')&&codesAre(adf,400,'ad_fund_forbidden')&&codesAre(adWord,400,'ad_fund_forbidden')&&codesAre(refr,400,'referral_reward_forbidden')&&snapshot()===snap);
const S1=s1.body.result.spendId,s0=await post(boss,SPEND()),S0=s0.body.result?.spendId;
check('RR-S1: the recorded spend row holds the decision value, status and version',(x=>x.brandId==='fr-a'&&x.channel==='search_ad'&&x.amount===AMOUNT_TOKEN&&x.amountExVat===AMOUNT_TOKEN&&x.vat==='excluded'&&x.currency==='KRW'&&x.funding==='hq_budget'&&x.status==='active'&&x.voided===null&&x.version===1&&x.platformNote===rec.PLATFORM_REPORTED_NOTE&&x.ruleVersion===rec.RECRUITMENT_VERSION&&x.createdBy.id==='rr-boss'&&x.period.from==='2026-09-01'&&x.period.to==='2026-09-30')(spendRow(S0)));
r=await post(boss,SPEND({channel:'blog_post',vat:'included',amount:11000,period:{from:'2026-09-01',to:'2026-09-30'}}));
check('RR-S6: a VAT-included record stores the amount, the VAT flag and the amount without VAT',r.status===200&&(x=>x.amount===11000&&x.vat==='included'&&x.amountExVat===10000)(spendRow(r.body.result.spendId)));
r=await post(boss,SPEND({period:{from:'2026-08-01',to:'2026-08-31'}}));
check('RR-S4: the same channel, period and amount is 409 spend_possible_duplicate',r.status===409&&reasons(r).includes('spend_possible_duplicate')&&Array.isArray(r.body.duplicates)&&r.body.duplicates.some(d=>d.id===S1));
r=await post(boss,SPEND({period:{from:'2026-08-01',to:'2026-08-31'},acknowledgeDuplicate:true}));
const SACK=r.body.result?.spendId;
check('RR-S4: acknowledging the duplicate records it with a warning',r.status===200&&r.body.warnings.includes('duplicate_acknowledged'));
r=await post(boss,SPEND({period:{from:'2026-08-01',to:'2026-08-31'},amount:7000000,replacesSpendId:SACK,acknowledgeDuplicate:true}));
const SREP=r.body.result?.spendId;
check('RR-S4: a replacement writes the new row and voids the old one as replaced in one batch',r.status===200&&spendRow(SREP).replaces.spendId===SACK&&spendRow(SACK).status==='voided'&&spendRow(SACK).voided.reason==='replaced'&&spendRow(SACK).version===2&&audits('spend_record').some(a=>a.recordId===SREP));
r=await post(boss,{action:'spend_void',brandId:'fr-a',spendId:SREP,version:9,reason:'entry_error'});
check('RR-S2: voiding with a stale version is 409 SPEND_STALE',fixed(r,409,'SPEND_STALE')&&spendRow(SREP).status==='active');
r=await post(boss,{action:'spend_void',brandId:'fr-a',spendId:SREP,version:1,reason:'entry_error'});
check('RR-S2: voiding with the current version voids the row and bumps its version',r.status===200&&spendRow(SREP).status==='voided'&&spendRow(SREP).voided.reason==='entry_error'&&spendRow(SREP).version===2&&audits('spend_void').some(a=>a.recordId===SREP));
r=await post(boss,{action:'spend_void',brandId:'fr-a',spendId:SREP,version:2,reason:'entry_error'});
const notFound=await post(boss,{action:'spend_void',brandId:'fr-a',spendId:'rs-none',version:1,reason:'entry_error'}),badReason=await post(boss,{action:'spend_void',brandId:'fr-a',spendId:S1,version:1,reason:'replaced'});
check('RR-S2: voiding again is 409 spend_already_voided, an unknown spend is 404 and the replaced reason is 400',codesAre(r,409,'spend_already_voided')&&fixed(notFound,404,'SPEND_NOT_FOUND')&&codesAre(badReason,400,'void_reason_invalid'));

// RR-E1: 행사 비용 참조
const refUnknown=await post(boss,EV({spendRef:'rs-nope'})),refOther=await post(boss,EV({spendRef:SC})),refVoided=await post(boss,EV({spendRef:SREP}));
check('RR-E1: an unknown, another brand or a voided spend reference is 400 SPEND_REF_UNKNOWN',fixed(refUnknown,400,'SPEND_REF_UNKNOWN')&&fixed(refOther,400,'SPEND_REF_UNKNOWN')&&fixed(refVoided,400,'SPEND_REF_UNKNOWN'));
r=await post(boss,SPEND({channel:'briefing',period:{from:'2026-09-10',to:'2026-09-10'},amount:300000}));
const SEV=r.body.result.spendId;
r=await post(boss,EV({spendRef:SEV}));
const EV2=r.body.result?.eventId;
check('RR-E1: a valid spend of the brand is linked to the event',r.status===200&&JSON.parse(sql.prepare("SELECT data FROM records WHERE id=?").get(`${WS}:recruitment_event:${EV2}`).data).spendRef===SEV);
snap=snapshot();
const voidRef=await post(boss,{action:'spend_void',brandId:'fr-a',spendId:SEV,version:1,reason:'entry_error'}),replaceRef=await post(boss,SPEND({channel:'briefing',period:{from:'2026-09-10',to:'2026-09-10'},amount:250000,replacesSpendId:SEV}));
check('RR-S5: voiding or replacing a spend an event references is 409 spend_referenced and writes nothing',codesAre(voidRef,409,'spend_referenced')&&codesAre(replaceRef,409,'spend_referenced')&&snapshot()===snap);

// RR-S3: 비용 보기
r=await post(boss,SPEND({channel:'portal',period:{from:'2026-09-20',to:'2026-10-03'},amount:500000}));
assert.equal(r.status,200,JSON.stringify(r.body));
r=await get(boss,'view=spend&brandId=fr-a&from=2026-09-01&to=2026-09-30');
const W=r.body.window;
check('RR-S3: the spend view sums whole-period rows per channel, counts straddling rows and aligns the window',r.status===200&&W.byChannel.search_ad.total===AMOUNT_TOKEN&&W.byChannel.search_ad.rowCount===1&&W.byChannel.portal.total===0&&W.byChannel.portal.straddlingCount===1&&JSON.stringify(W.aligned.portal)==='{"from":"2026-09-01","to":"2026-10-03","expanded":true}'&&r.body.noProrationNote===rec.NO_PRORATION_NOTE&&r.body.platformNote===rec.PLATFORM_REPORTED_NOTE&&r.body.disclaimer===DISCLAIMER);
check('RR-S3: the spend list marks voided and replacing rows and hides other brands',r.body.spend.some(s=>s.id===SACK&&s.status==='voided')&&r.body.spend.some(s=>s.id===SREP)&&!r.body.spend.some(s=>s.id===SC));
r=await get(boss,'view=spend&brandId=fr-a&from=2026-09-30&to=2026-09-01');
check('RR-S3: an inverted window is 400',r.status===400);

// ════ RR-A 리드 코드·귀속 ════
const CR=(await post(boss,ISSUE({channel:'portal',customCode:'R5678923'}))).body.result.code;
r=await f.createLead(boss,'fr-a',{codes:['r567-8923']});
const L1=r.body.result.leadId;
let lv=await leadView(boss,L1);
check('RR-A1: a lead created with a code shows the channel label on the lead view and the board',r.status===200&&f.leadRow(L1).codes.length===1&&f.leadRow(L1).codes[0].code===CR&&f.leadRow(L1).codes[0].source==='manual'&&lv.body.attribution.state==='attributed'&&lv.body.attribution.channel==='portal'&&lv.body.attribution.label==='창업 포털'&&(await boardRow(boss,L1)).attribution.label==='창업 포털');
r=await f.createLead(boss,'fr-a',{codes:['R23456789']});
check('RR-A1: create_lead with a malformed code is 400 LEAD_CODE_INVALID',fixed(r,400,'LEAD_CODE_INVALID'));
const plainLead=(await f.createLead(boss,'fr-a')).body.result.leadId;
check('RR-A1: a lead without codes is unattributed with no_code and keeps no codes field',!('codes' in f.leadRow(plainLead))&&(await leadView(boss,plainLead)).body.attribution.state==='unattributed'&&(await leadView(boss,plainLead)).body.attribution.label===rec.UNATTRIBUTED_LABEL);

const before=f.leadRow(L1);
r=await post(boss,{action:'add_lead_codes',brandId:'fr-a',leadId:L1,version:before.version,codes:[C1,'R9999999']});
const after=f.leadRow(L1);
check('RR-A2: add_lead_codes appends after the first code and keeps lastActivityAt and the retention date',r.status===200&&after.codes.map(c=>c.code).join(',')===[CR,C1,'R9999999'].join(',')&&after.lastActivityAt===before.lastActivityAt&&f.lib.retentionUntil(after)===f.lib.retentionUntil(before)&&after.version===before.version+1);
check('RR-A2: an unregistered code is stored with a warning and the event is codes_added without code values',r.body.warnings?.includes('code_not_registered')&&events(L1,'codes_added').length===1&&!JSON.stringify(events(L1,'codes_added')).includes(C1));
check('RR-A2: the first valid code still decides',(await leadView(boss,L1)).body.attribution.channel==='portal');
snap=snapshot();
const emptyAdd=await post(boss,{action:'add_lead_codes',brandId:'fr-a',leadId:L1,version:after.version,codes:[]}),badAdd=await post(boss,{action:'add_lead_codes',brandId:'fr-a',leadId:L1,version:after.version,codes:['C2345678']}),overAdd=await post(boss,{action:'add_lead_codes',brandId:'fr-a',leadId:L1,version:after.version,codes:['R2222222','R3333333','R4444444']});
check('RR-A2: an empty, malformed or over-limit code list is 400 LEAD_CODE_INVALID and writes nothing',[emptyAdd,badAdd,overAdd].every(x=>fixed(x,400,'LEAD_CODE_INVALID'))&&snapshot()===snap);

const mine=(await f.createLead(member,'fr-a')).body.result.leadId,theirs=(await f.createLead(member2,'fr-a')).body.result.leadId;
r=await post(member,{action:'add_lead_codes',brandId:'fr-a',leadId:mine,version:1,codes:[C1]});
const other=await post(member,{action:'add_lead_codes',brandId:'fr-a',leadId:theirs,version:1,codes:[C1]});
check('RR-A4: a member adds codes to an own lead and gets 403 on another member lead',r.status===200&&other.status===403&&!('codes' in f.leadRow(theirs)));

// RR-C6: 사용 중지와 귀속(과거로 소급하지 않음)
setNow(nowMs()+DAY);
const today=kstDay();
r=await post(boss,{action:'code_retire',brandId:'fr-a',code:CR,version:9});
check('RR-C6: retiring with a stale version is 409 CODE_STALE',fixed(r,409,'CODE_STALE'));
r=await post(member,{action:'code_retire',brandId:'fr-a',code:CR,version:1});
check('RR-C6: a member cannot retire a code (403)',fixed(r,403,'ADMIN_ONLY'));
r=await post(boss,{action:'code_retire',brandId:'fr-a',code:CR,version:1});
check('RR-C6: retiring sets today as the retire date and bumps the version',r.status===200&&codeRow(CR).status==='retired'&&codeRow(CR).retiredOn===today&&codeRow(CR).version===2&&codeRow(CR).retiredBy.id==='rr-boss'&&audits('code_retire').some(a=>a.recordId===CR));
const again2=await post(boss,{action:'code_retire',brandId:'fr-a',code:CR,version:2}),missing=await post(boss,{action:'code_retire',brandId:'fr-a',code:'R7777777',version:1});
check('RR-C6: retiring again is 409 code_already_retired and an unknown code is 404 CODE_NOT_FOUND',codesAre(again2,409,'code_already_retired')&&fixed(missing,404,'CODE_NOT_FOUND'));
const L2=(await f.createLead(boss,'fr-a',{codes:[CR]})).body.result.leadId;
check('RR-C6: a lead received on the retire date is after_retired while the earlier lead stays attributed',(await leadView(boss,L2)).body.attribution.state==='unattributed'&&(await leadView(boss,L2)).body.attribution.reason==='after_retired'&&(await leadView(boss,L1)).body.attribution.state==='attributed'&&(await leadView(boss,L1)).body.attribution.code===CR);

// RR-A3: 점포 코드 충돌
const CX=(await post(boss,ISSUE({channel:'youtube',customCode:'R6789234'}))).body.result.code;
const L3=(await f.createLead(boss,'fr-a',{codes:[CX]})).body.result.leadId;
check('RR-A3: before the clash the lead is attributed to the code',(await leadView(boss,L3)).body.attribution.state==='attributed');
r=await storePost(boss,{storeId:'st-a',action:'create_tracking_code',type:'qr',campaignId:'ca-store',code:'R6789234',label:'가상 QR'});
check('RR-A3: the store route later creates a store code with the same value',r.status===200,JSON.stringify(r.body));
const board=await get(boss,'view=board&brandId=fr-a');
const l3=board.body.leads.find(l=>l.id===L3);
check('RR-A3: the lead turns into a conflict with one code_conflict to-do',l3.attribution.state==='conflict'&&l3.attribution.detail===rec.CONFLICT_DETAIL&&board.body.todos.codeConflict===1);
const filtered=await get(boss,'view=board&brandId=fr-a&todo=code_conflict'),inflowConflict=await get(boss,'view=board&brandId=fr-a&inflow=conflict'),inflowPortal=await get(boss,'view=board&brandId=fr-a&inflow=portal');
check('RR-A3: the code_conflict to-do and the inflow filters select the matching leads',filtered.body.leads.map(l=>l.id).join()===L3&&inflowConflict.body.leads.map(l=>l.id).join()===L3&&inflowPortal.body.leads.some(l=>l.id===L1)&&!inflowPortal.body.leads.some(l=>l.id===L3));
r=await get(boss,'view=board&brandId=fr-a&inflow=naver_place');
check('RR-A3: an unknown inflow filter is 400',r.status===400);

// RR-V1: 코드 보기
r=await get(member,'view=codes&brandId=fr-a');
const cx=r.body.codes?.find(c=>c.code===CX),cr=r.body.codes?.find(c=>c.code===CR);
check('RR-V1: the codes view puts the attribution note before every count and is open to members',r.status===200&&Object.keys(r.body)[0]==='attributionNote'&&r.body.attributionNote===rec.RECRUITMENT_ATTRIBUTION_NOTE&&r.body.disclaimer===DISCLAIMER&&r.body.ruleVersion===rec.RECRUITMENT_VERSION);
check('RR-V1: the codes view shows the store clash, the retire date and per-code attribution counts',cx.conflict===true&&cr.status==='retired'&&cr.retiredOn===today&&cr.attributed.total===1&&cr.channelLabel==='창업 포털'&&r.body.unattributed.after_retired>=1&&r.body.unattributed.conflict===1&&r.body.byChannel.portal.attributed===1&&r.body.channels.length===10);
check('RR-V1: the codes view shows the campaign, asset and event links',r.body.codes.some(c=>c.campaignId==='ca-a'&&c.campaignTitle==='가상 캠페인 ca-a'&&c.assetRef?.id==='ra-ok')&&r.body.codes.some(c=>c.eventId===EV1));

// RR-A5: 리드 코드 제외
const l1=f.leadRow(L1);
snap=snapshot();
const memberStrike=await post(member,{action:'strike_lead_code',brandId:'fr-a',leadId:L1,version:l1.version,code:CR,reason:'typo'});
check('RR-A5: a member cannot strike a lead code (403)',fixed(memberStrike,403,'ADMIN_ONLY')&&snapshot()===snap);
r=await post(admin,{action:'strike_lead_code',brandId:'fr-a',leadId:L1,version:l1.version,code:CR,reason:'wrong_lead'});
const l1s=f.leadRow(L1);
lv=await leadView(boss,L1);
check('RR-A5: an admin strike moves the attribution to the next code and keeps lastActivityAt',r.status===200&&l1s.codeStrikes.length===1&&l1s.codeStrikes[0].code===CR&&l1s.codeStrikes[0].reason==='wrong_lead'&&l1s.lastActivityAt===l1.lastActivityAt&&lv.body.attribution.code===C1&&lv.body.attribution.channel==='expo'&&events(L1,'codes_struck').length===1&&audits('code_strike').some(a=>a.leadId===L1&&JSON.stringify(a.reasons)==='["wrong_lead"]'));
const notOn=await post(admin,{action:'strike_lead_code',brandId:'fr-a',leadId:L1,version:l1s.version,code:'R8888888',reason:'typo'}),twice=await post(admin,{action:'strike_lead_code',brandId:'fr-a',leadId:L1,version:l1s.version,code:CR,reason:'typo'}),badWhy=await post(admin,{action:'strike_lead_code',brandId:'fr-a',leadId:L1,version:l1s.version,code:C1,reason:'because'});
check('RR-A5: a code not on the lead is 400, striking again is 409 LEAD_CODE_STRUCK and an unknown reason is 400',fixed(notOn,400,'LEAD_CODE_NOT_ON_LEAD')&&fixed(twice,409,'LEAD_CODE_STRUCK')&&badWhy.status===400);
r=await post(boss,{action:'erase_lead',brandId:'fr-a',leadId:L2});
assert.equal(r.status,200,JSON.stringify(r.body));
r=await post(boss,{action:'strike_lead_code',brandId:'fr-a',leadId:L2,version:f.leadRow(L2).version,code:CR,reason:'other'});
check('RR-A5: an erased lead can still have a code struck',r.status===200&&f.leadRow(L2).contactState==='erased'&&f.leadRow(L2).codeStrikes.length===1);

// ════ RR-P2 스위치 꺼짐 ════
check('owner turns the franchise switch off',(await f.setFlag(boss,false)).status===200);
snap=snapshot();
const offIssue=await post(boss,ISSUE()),offSpend=await post(boss,SPEND({period:{from:'2026-06-01',to:'2026-06-30'}})),offAdd=await post(boss,{action:'add_lead_codes',brandId:'fr-a',leadId:plainLead,version:f.leadRow(plainLead).version,codes:[C1]});
check('RR-P2: with the switch off issuing, recording spend and adding lead codes are 409 OFF and write nothing',[offIssue,offSpend,offAdd].every(x=>fixed(x,409,'OFF'))&&snapshot()===snap);
const offVoid=await post(boss,{action:'spend_void',brandId:'fr-a',spendId:S1,version:1,reason:'duplicate'}),offRetire=await post(boss,{action:'code_retire',brandId:'fr-a',code:C1,version:1});
check('RR-P2: with the switch off voiding spend and retiring a code still work',offVoid.status===200&&spendRow(S1).status==='voided'&&offRetire.status===200&&codeRow(C1).status==='retired');
check('owner turns the franchise switch back on',(await f.setFlag(boss,true)).status===200);

// ════ 상태 보기 hasRecords ════
check('a second workspace turns the switch on',(await f.setFlag(boss2,true)).status===200);
const st0=await get(boss2,'view=status');
r=await post(boss2,{...SPEND({brandId:'fr-z',channel:'community',period:{from:'2026-09-01',to:'2026-09-01'},amount:0})});
const st1=await get(boss2,'view=status');
check('status hasRecords turns true when only recruitment spend exists',st0.body.hasRecords===false&&r.status===200&&st1.body.hasRecords===true);

// ════ RR-L 감사·수식 주입 ════
const FORMULA_LABEL='=HYPERLINK("x")',FORMULA_EVIDENCE="-2+3+cmd|' /C calc'!A0";
r=await post(boss,ISSUE({label:FORMULA_LABEL}));
const CF=r.body.result.code;
const sf=await post(boss,SPEND({channel:'community',period:{from:'2026-05-01',to:'2026-05-31'},evidence:FORMULA_EVIDENCE}));
const codesNow=await get(boss,'view=codes&brandId=fr-a'),spendNow=await get(boss,'view=spend&brandId=fr-a');
check('RR-L2: formula-like label and evidence are stored and shown as written',r.status===200&&codeRow(CF).label===FORMULA_LABEL&&codesNow.body.codes.find(c=>c.code===CF).label===FORMULA_LABEL&&sf.status===200&&spendRow(sf.body.result.spendId).evidence===FORMULA_EVIDENCE&&spendNow.body.spend.find(s=>s.id===sf.body.result.spendId).evidence===FORMULA_EVIDENCE);
check('RR-L2: csvCell neutralizes both with a leading quote',f.lib.csvCell(FORMULA_LABEL).startsWith(`"'=`)&&f.lib.csvCell(FORMULA_EVIDENCE).startsWith(`"'-`));
const BASE=['id','brandId','action','actor','at','requestAction','status','result','target','leadId'],EXTRA=['recordId','channel','periodFrom','periodTo','fileSha256','planSha256','inputSha256','count','skipped','reasons','ruleVersion','importVersion'];
const newAudits=['code_issue','code_retire','code_strike','spend_record','spend_void'].flatMap(audits);
check('RR-L1: every new audit row uses only the allowed keys',newAudits.length>=10&&newAudits.every(a=>Object.keys(a).every(k=>BASE.includes(k)||EXTRA.includes(k))));
const auditText=JSON.stringify(sql.prepare("SELECT data FROM records WHERE kind IN ('franchise_audit','franchise_lead_event')").all());
check('RR-L1: no label, evidence or amount token reaches audit rows, lead events or the console',![LABEL_TOKEN,EVIDENCE_TOKEN,String(AMOUNT_TOKEN),FORMULA_LABEL].some(t=>auditText.includes(t))&&![LABEL_TOKEN,EVIDENCE_TOKEN,String(AMOUNT_TOKEN)].some(t=>logged.some(l=>l.includes(t))));
check('RR-L1: the audit view lists the new actions with Korean labels',['code_issue','code_retire','code_strike','spend_record','spend_void'].every(a=>/[가-힣]/.test(f.lib.AUDIT_ACTION_LABELS[a]))&&['codes_added','codes_struck'].every(e=>/[가-힣]/.test(f.lib.EVENT_TYPE_LABELS[e]))&&!f.lib.ACTIVITY_EVENTS.includes('codes_added')&&!f.lib.ACTIVITY_EVENTS.includes('codes_struck'));
const NEW_ERRORS={CODE_TAKEN:409,CODE_RETRY:409,CODE_NOT_FOUND:404,CODE_STALE:409,SPEND_NOT_FOUND:404,SPEND_STALE:409,SPEND_REF_UNKNOWN:400,LEAD_CODE_INVALID:400,LEAD_CODE_NOT_ON_LEAD:400,LEAD_CODE_STRUCK:409};
check('the ten new fixed errors are Korean with their status and SPEND_REF_UNAVAILABLE is gone',Object.entries(NEW_ERRORS).every(([k,s])=>E[k]&&E[k].status===s&&/[가-힣]/.test(E[k].text))&&!('SPEND_REF_UNAVAILABLE' in E));
check('no response makes a legal-adequacy claim and failures carry the disclaimer',!responses.some(b=>/법적으로 적합|준수 완료|합법/.test(JSON.stringify(b))));
check('no unexpected failure was logged and no external call was made',!logged.some(l=>/franchise_request_failed/.test(l))&&f.calls.length===0);

console.log(JSON.stringify({passed:passed.length}));
