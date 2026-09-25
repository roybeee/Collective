// 트랙 R 리드 연락처(대표 결정 22) 회귀: v1. 필드 암호화와 평문 부재, 읽을 때 가림, 열람 감사, 중복 키(HMAC, 소유자·브랜드 범위), 키 없음 503,
// 입력 개인정보 거부, 수집 근거·출처 고지, 광고성 정보 동의·철회, 내보내기(수식 주입 방지·감사), 보존 기한 파기(H11, 시계 이동)·되살림 금지, 수동 파기·감사 기록 정리,
// 정보주체 삭제·요청, 콘솔 노출 0, 공개 저장소 경계(합성 번호·이메일만).
// 근거: mocked(메모리 SQLite, 이메일 모드 세션 주입, 시계 이동 Date, 외부 fetch는 던지는 스텁). 보존 기한·처리 기한은 COLLECTIVE 휴리스틱이며 법률 적합성은 확인하지 않는다(결정 20 보류, blocked).
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {franchiseFixture,captureConsole,NAME,PHONE,PHONE_DIGITS,EMAIL,MEMO,REGION,DAY,DISCLAIMER,plain,sha64} from './helpers/franchise-fixture.mjs';

const logged=captureConsole();
const f=await franchiseFixture();
const {sql,env,post,get,setFlag,total,rows,leadRow,profile,brand,signIn,createLead,clock}=f;
const passed=[];const check=(name,val)=>{assert.ok(val,name);passed.push(name)};
const E=plain(f.lib.FRANCHISE_ERRORS),T=k=>E[k].text;
const v=id=>leadRow(id).version;
const audits=action=>rows('franchise_audit',"AND json_extract(data,'$.action')=?",action);
const keysOf=id=>sql.prepare("SELECT id,kind,parent_id,data FROM records WHERE kind='franchise_lead_key' AND parent_id=?").all(id);
const WS='fc-owner',WS2='fc-owner-2';
env.AUTH_MODE='email';env.AUTH_ORIGIN='https://agency.test';
const boss=signIn('fc-boss','admin',1000,WS),admin=signIn('fc-admin','admin',2000,WS),memberA=signIn('fc-member-a','member',3000,WS),memberB=signIn('fc-member-b','member',4000,WS);
const boss2=signIn('fc-boss-2','admin',1000,WS2);
for(const b of ['fr-a','fr-b','fr-e'])await brand(WS,b);
await brand(WS2,'fr-a');
await setFlag(boss,true);await setFlag(boss2,true);
for(const b of ['fr-a','fr-b','fr-e'])await profile(boss,b,{},0);
await profile(boss2,'fr-a',{},0);
const FULL={name:NAME,phone:PHONE,email:EMAIL};
const task={region:REGION,budgetBand:'lt_50m',timingBand:'within_3m',sourceChannel:'phone_inquiry'};

// ── 1) 필드 암호화 ──
let r=await post(memberA,{action:'create_lead',brandId:'fr-a',contact:FULL,memo:MEMO,task,basis:{type:'inquiry_response'}});
const L1=r.body.result.leadId,row1=leadRow(L1);
check('create_lead stores name, phone, email and memo as v1. ciphertext',r.status===200&&['name','phone','email'].every(k=>row1.contact[k].startsWith('v1.'))&&row1.memo.startsWith('v1.'));
check('each ciphertext decrypts to the normalized input',await f.fcrypto.openField(row1.contact.name)===NAME&&await f.fcrypto.openField(row1.contact.phone)===PHONE_DIGITS&&await f.fcrypto.openField(row1.contact.email)===EMAIL&&await f.fcrypto.openField(row1.memo)===MEMO);
check('ciphertext is not deterministic (fresh IV per field)',(await f.fcrypto.sealField(NAME))!==row1.contact.name);
// ── 5) 가림 ──
r=await get(memberA,'view=board&brandId=fr-a');
const b1=r.body.leads.find(l=>l.id===L1);
check('board shows masked name and phone only',b1.contact.name==='김*상'&&b1.contact.phone==='***-****-0101'&&b1.contact.email===null&&b1.contact.hasEmail===true);
r=await get(memberA,`view=lead&brandId=fr-a&leadId=${L1}`);
check('lead view shows every contact masked',r.body.contact.name==='김*상'&&r.body.contact.phone==='***-****-0101'&&r.body.contact.email==='l***@example.com'&&r.body.hasMemo===true&&!JSON.stringify(r.body).includes(NAME)&&!JSON.stringify(r.body).includes(EMAIL));
// ── 6) 열람 ──
r=await post(memberA,{action:'reveal_contact',brandId:'fr-a',leadId:L1,fields:['name','phone','email','memo'],purpose:'call_back'});
check('member reveals own lead with full values',r.status===200&&r.body.values.name===NAME&&r.body.values.phone===PHONE&&r.body.values.email===EMAIL&&r.body.values.memo===MEMO);
const reveal=audits('reveal').find(a=>a.leadId===L1);
check('reveal writes an audit row with fields, purpose, lead id and actor only',!!reveal&&JSON.stringify(reveal.fields)==='["name","phone","email","memo"]'&&reveal.purpose==='call_back'&&JSON.stringify(Object.keys(reveal.actor).sort())==='["id","role"]'
 &&Object.keys(reveal).every(k=>['id','brandId','action','actor','at','leadId','fields','purpose','requestAction','status','result','target'].includes(k)));
const un=(await createLead(boss,'fr-a',{assigneeId:null})).body.result.leadId;
let n0=audits('reveal').length;
r=await post(memberA,{action:'reveal_contact',brandId:'fr-a',leadId:un,fields:['name'],purpose:'call_back'});
check('member reveal of an unassigned lead is 403 NOT_ASSIGNED with no audit row',r.status===403&&r.body.error===T('NOT_ASSIGNED')&&audits('reveal').length===n0);
const bLead=(await createLead(memberB,'fr-a')).body.result.leadId;
r=await post(memberA,{action:'reveal_contact',brandId:'fr-a',leadId:bLead,fields:['name'],purpose:'call_back'});
check('member reveal of another member lead is 403',r.status===403&&audits('reveal').length===n0);
r=await post(admin,{action:'reveal_contact',brandId:'fr-a',leadId:bLead,fields:['phone'],purpose:'consultation'});
check('admin reveals any lead with an audit row',r.status===200&&/^010-0000-0\d{3}$/.test(r.body.values.phone)&&audits('reveal').length===n0+1);

// ── 7) 중복 ──
n0=total();
r=await post(boss,{action:'create_lead',brandId:'fr-a',contact:{name:'이테스트',phone:'+82 10-0000-0101'},task,basis:{type:'inquiry_response'}});
check('duplicate phone in another format is 409 with the system code only',r.status===409&&r.body.error===T('DUPLICATE')&&r.body.duplicateOf.systemCode===row1.systemCode&&JSON.stringify(Object.keys(r.body).sort())==='["duplicateOf","error"]'&&JSON.stringify(Object.keys(r.body.duplicateOf))==='["systemCode"]');
check('duplicate response holds no contact value or lead id',!JSON.stringify(r.body).includes(PHONE_DIGITS)&&!JSON.stringify(r.body).includes(L1));
r=await post(boss,{action:'create_lead',brandId:'fr-a',contact:{name:'이테스트',email:'  LEAD.ONE@Example.COM '},task,basis:{type:'inquiry_response'}});
check('duplicate email is case-insensitive',r.status===409&&r.body.duplicateOf.systemCode===row1.systemCode);
check('duplicates wrote nothing',total()===n0);
r=await post(boss,{action:'create_lead',brandId:'fr-b',contact:{name:NAME,phone:PHONE},task,basis:{type:'inquiry_response'}});
const LB=r.body.result?.leadId;
check('same phone in another brand is a separate lead',r.status===200);
n0=audits('find').length;
r=await post(memberB,{action:'find_contact',brandId:'fr-a',phone:PHONE});
check('member B finds member A lead as invisible without its id',r.status===200&&r.body.matches.length===1&&r.body.matches[0].visible===false&&!('leadId' in r.body.matches[0])&&r.body.matches[0].systemCode===row1.systemCode);
r=await post(admin,{action:'find_contact',brandId:'fr-a',email:EMAIL});
check('admin finds the lead with its id',r.body.matches[0].visible===true&&r.body.matches[0].leadId===L1);
const finds=audits('find');
check('each find writes one audit row with count and lead ids only',finds.length===n0+2&&finds.every(a=>typeof a.count==='number'&&Array.isArray(a.matchedLeadIds)&&!JSON.stringify(a).includes(PHONE_DIGITS)&&!JSON.stringify(a).includes(EMAIL)));
// ── 8) 키 행 ──
const k1=keysOf(L1);
check('key rows use a 64-hex HMAC id, the key kind and the lead as parent',k1.length===2&&k1.every(k=>new RegExp(`^${WS}:franchise_lead_key:[0-9a-f]{64}$`).test(k.id)&&k.kind==='franchise_lead_key'&&k.parent_id===L1&&!k.data.includes(PHONE_DIGITS)&&!k.data.includes(EMAIL)));
r=await post(boss2,{action:'create_lead',brandId:'fr-a',contact:{name:NAME,phone:PHONE},task,basis:{type:'inquiry_response'}});
const W2=r.body.result.leadId;
const hexOf=id=>id.split(':').pop();
check('same phone under the same brand id in another workspace gives a different key',r.status===200&&keysOf(W2).length===1&&!k1.some(k=>hexOf(k.id)===hexOf(keysOf(W2)[0].id)));
const L2=(await post(memberA,{action:'create_lead',brandId:'fr-a',contact:{name:'이테스트',phone:'010-0000-0102'},task,basis:{type:'inquiry_response'}})).body.result.leadId;
const oldKey=keysOf(L2)[0].id;
r=await post(memberA,{action:'update_contact',brandId:'fr-a',leadId:L2,version:v(L2),contact:{phone:'010-0000-0103'}});
check('phone change replaces the key row',r.status===200&&keysOf(L2).length===1&&keysOf(L2)[0].id!==oldKey&&JSON.stringify(r.body.result.fields)==='["phone"]');
const before2=JSON.stringify(leadRow(L2));
r=await post(memberA,{action:'update_contact',brandId:'fr-a',leadId:L2,version:v(L2),contact:{phone:PHONE}});
check("changing to another lead's phone is 409 and the lead is unchanged",r.status===409&&r.body.duplicateOf.systemCode===row1.systemCode&&JSON.stringify(leadRow(L2))===before2);
r=await post(memberA,{action:'update_contact',brandId:'fr-a',leadId:L2,version:v(L2),contact:{phone:null}});
check('removing the only contact is 400 CONTACT_REQUIRED',r.status===400&&r.body.error===T('CONTACT_REQUIRED'));

// ── 10) 입력 개인정보 거부 ──
n0=total();
const bad=[
 ['memo with a resident registration number','PII_IN_TEXT',{memo:'가상 메모 000101-3000000'}],
 ['memo with a card number','PII_IN_TEXT',{memo:'카드 0000-0000-0000-0000'}],
 ['memo with a phone number','PII_IN_TEXT',{memo:'다른 번호 010-0000-0999'}],
 ['region with a road address','PII_IN_TEXT',{task:{...task,region:'가상로 12'}}],
 ['region with a number','PII_IN_TEXT',{task:{...task,region:'가상구 1'}}],
 ['name with digits',null,{contact:{name:'김가상2',phone:'010-0000-0998'}}],
 ['1001-character memo',null,{memo:'가'.repeat(1001)}],
 ['neither phone nor email','CONTACT_REQUIRED',{contact:{name:'이테스트'}}],
];
for(const [name,key,extra] of bad){r=await post(boss,{action:'create_lead',brandId:'fr-a',contact:{name:'이테스트',phone:'010-0000-0998'},task,basis:{type:'inquiry_response'},...extra});check(`${name} is a 400`,r.status===400&&(!key||r.body.error===T(key)))}
check('rejected inputs wrote nothing',total()===n0);

// ── 11) 수집 근거 ──
r=await post(boss,{action:'create_lead',brandId:'fr-a',contact:{name:'이테스트',phone:'010-0000-0104'},task,basis:{type:'consent'}});
check('consent without a notice is 400 NOTICE_REQUIRED',r.status===400&&r.body.error===T('NOTICE_REQUIRED'));
r=await post(boss,{action:'register_privacy_notice',brandId:'fr-a',versionLabel:'2026-1',text:'가상 개인정보 수집·이용 안내문(합성). 수집 항목: 이름, 연락처. 보유 기간: 휴리스틱.',controllerName:'가상 가맹본부',processorNames:['가상 호스팅사']});
const PN=r.body.result.id;
check('admin registers a privacy notice with a server hash',r.status===200&&rows('franchise_privacy_notice').find(n=>n.id===PN).sha256===sha64('가상 개인정보 수집·이용 안내문(합성). 수집 항목: 이름, 연락처. 보유 기간: 휴리스틱.'));
r=await post(boss,{action:'register_privacy_notice',brandId:'fr-a',versionLabel:'2026-1',text:'다른 본문',controllerName:'가상 가맹본부'});
check('same version label with different text is 409',r.status===409);
r=await post(boss,{action:'create_lead',brandId:'fr-a',contact:{name:'이테스트',phone:'010-0000-0104'},task,basis:{type:'consent',noticeId:PN,noticeGivenAt:'now'}});
const LC=r.body.result?.leadId;
check('consent with an active notice is accepted and the created event keeps the notice id',r.status===200&&rows('franchise_lead_event',"AND parent_id=? AND json_extract(data,'$.type')='created'",LC)[0].basis.noticeId===PN);
r=await post(memberA,{action:'create_lead',brandId:'fr-a',contact:{name:'이테스트',phone:'010-0000-0105'},task,basis:{type:'referral',referralFrom:'franchisee'}});
const LR=r.body.result.leadId;
check('referral lead shows the source notice as pending',r.body.lead.sourceNoticePending===true);
let board=(await get(memberA,'view=board&brandId=fr-a')).body;
const pending=board.todos.sourceNoticePending;
check('board counts the pending source notice',pending>=1);
r=await post(memberA,{action:'record_source_notice',brandId:'fr-a',leadId:LR,version:v(LR),noticedAt:'now'});
board=(await get(memberA,'view=board&brandId=fr-a')).body;
check('recording the source notice clears the to-do',r.status===200&&r.body.lead.sourceNoticePending===false&&board.todos.sourceNoticePending===pending-1);
r=await post(memberA,{action:'record_source_notice',brandId:'fr-a',leadId:L1,version:v(L1),noticedAt:'now'});
check('source notice on a non-referral lead is 400',r.status===400);
// ── 12) 광고성 정보 동의 ──
check('marketing consent defaults to none',leadRow(L1).marketing.status==='none');
r=await post(memberA,{action:'set_marketing_consent',brandId:'fr-a',leadId:L1,version:v(L1),status:'given',method:'written',at:'now',noticeId:PN});
check('member recording consent given is 403',r.status===403);
r=await post(admin,{action:'set_marketing_consent',brandId:'fr-a',leadId:L1,version:v(L1),status:'given',at:'now',noticeId:PN});
check('consent given without a method is 400',r.status===400);
r=await post(admin,{action:'set_marketing_consent',brandId:'fr-a',leadId:L1,version:v(L1),status:'given',method:'written',at:'now',noticeId:PN});
check('admin records consent with method, time and notice',r.status===200&&leadRow(L1).marketing.status==='given'&&leadRow(L1).marketing.noticeId===PN);
await setFlag(boss,false);
r=await post(memberA,{action:'set_marketing_consent',brandId:'fr-a',leadId:L1,status:'withdrawn'});
check('member withdraws consent on own lead with the switch off, with an audit row',r.status===200&&leadRow(L1).marketing.status==='withdrawn'&&audits('marketing_withdrawn').some(a=>a.leadId===L1));
await setFlag(boss,true);

// ── 13) 내보내기 ──
const EX=['=HYPERLINK("x")','@김가상','-김가상','+김가상'];
for(const [i,name] of EX.entries())assert.equal((await post(boss,{action:'create_lead',brandId:'fr-e',contact:{name,phone:'010-0000-015'+i},memo:MEMO,task,basis:{type:'inquiry_response'}})).status,200);
r=await post(boss,{action:'export_leads',brandId:'fr-e',purpose:'internal_review',contactMode:'full'});
const csv=r.body.csv,lines=csv.split('\r\n');
check('export CSV starts with a BOM and the Korean header row',r.status===200&&csv.startsWith('﻿')&&lines[0]==='﻿"코드","단계","담당자 ID","유입","지역","예산","시기","수집 근거","광고성 정보","등록일","마지막 활동","이름","전화","이메일"');
check('row count matches',r.body.rowCount===4&&lines.length===5&&r.body.disclaimer===DISCLAIMER&&/^franchise-leads-fr-e-\d{8}\.csv$/.test(r.body.filename));
check('formula-like names are neutralised',csv.includes('"\'=HYPERLINK(""x"")"')&&csv.includes('"\'@김가상"')&&csv.includes('"\'-김가상"')&&csv.includes('"\'+김가상"'));
check('memo is never exported',!csv.includes(MEMO));
r=await post(boss,{action:'export_leads',brandId:'fr-e',purpose:'handover',contactMode:'masked'});
check('masked export has no full values',r.status===200&&!r.body.csv.includes('010-0000-015')&&r.body.csv.includes('***-****-015'));
const exportAudit=audits('export');
check('each export writes an audit row with purpose, mode and count only',exportAudit.length===2&&exportAudit.some(a=>a.purpose==='internal_review'&&a.contactMode==='full'&&a.count===4)&&!JSON.stringify(exportAudit).includes('김가상'));
r=await post(memberA,{action:'export_leads',brandId:'fr-e',purpose:'handover',contactMode:'masked'});
check('member export is 403',r.status===403);

// ── 18) 정보주체 요청 ──
r=await post(memberA,{action:'add_subject_request',brandId:'fr-a',leadId:L1,type:'access',channel:'phone',receivedAt:'now'});
const SR=r.body.result;
check('member registers a request on a visible lead with a ten-day heuristic due date',r.status===200&&Date.parse(SR.dueAt)-Date.parse(rows('franchise_subject_request').find(x=>x.id===SR.id).receivedAt)===10*DAY&&SR.dueLabel.includes('COLLECTIVE 휴리스틱'));
r=await post(memberA,{action:'add_subject_request',brandId:'fr-a',leadId:L1,type:'access',channel:'phone',receivedAt:new Date(clock.now()+DAY).toISOString()});
check('future receivedAt is a 400',r.status===400);
r=await post(memberA,{action:'add_subject_request',brandId:'fr-a',leadId:bLead,type:'access',channel:'phone',receivedAt:'now'});
check('member request on an invisible lead is 403',r.status===403);
r=await post(memberA,{action:'update_subject_request',brandId:'fr-a',id:SR.id,version:1,status:'done'});
check('member cannot update a request',r.status===403);
r=await post(admin,{action:'update_subject_request',brandId:'fr-a',id:SR.id,version:1,status:'done',resolution:'fulfilled'});
check('admin updates the request status',r.status===200&&rows('franchise_subject_request').find(x=>x.id===SR.id).status==='done'&&!!rows('franchise_subject_request').find(x=>x.id===SR.id).resolvedAt);
r=await get(memberB,'view=requests&brandId=fr-a');
check('member sees only own requests',r.status===200&&r.body.requests.every(x=>x.createdBy.id==='fc-member-b'));
r=await get(memberA,'view=requests&brandId=fr-a');
check('requests view carries the due label and lead code',r.body.requests.some(x=>x.id===SR.id&&x.dueLabel.includes('10일')&&x.leadCode===row1.systemCode));

// ── 17) 정보주체 삭제 ──
const ER=(await post(admin,{action:'create_lead',brandId:'fr-a',contact:{name:'이테스트',phone:'010-0000-0106',email:'erase.me@example.com'},memo:MEMO,task,basis:{type:'inquiry_response'},marketing:{status:'given',method:'electronic',at:'now',noticeId:PN}})).body.result.leadId;
const DVE=(await post(boss,{action:'register_disclosure_version',brandId:'fr-a',label:'가상 정보공개서',sha256:sha64('dv-contacts'),registeredAt:new Date(clock.now()-30*DAY).toISOString(),validFrom:new Date(clock.now()-60*DAY).toISOString(),validUntil:new Date(clock.now()+300*DAY).toISOString(),storageLabel:'본사 문서함'})).body.result.id;
r=await post(admin,{action:'record_delivery',brandId:'fr-a',leadId:ER,version:v(ER),doc:'disclosure',method:'electronic',deliveredAt:'now',versionId:DVE,evidence:{electronic:{channel:'email',receivedAt:'now',printable:true}}});
check('erasure fixture has a delivery record',r.status===200);
const srE=(await post(admin,{action:'add_subject_request',brandId:'fr-a',leadId:ER,type:'erasure',channel:'email',receivedAt:'now'})).body.result.id;
r=await post(memberA,{action:'erase_lead',brandId:'fr-a',leadId:ER});
check('member erasure is 403',r.status===403);
const ERASE={action:'erase_lead',brandId:'fr-a',leadId:ER,subjectRequestId:srE,requestId:'erase-request-001'};
r=await post(admin,ERASE);
const erased=leadRow(ER);
check('erasure removes contact and memo and marks the lead erased',r.status===200&&erased.contact===null&&erased.memo===null&&erased.contactState==='erased'&&!!erased.erasedAt);
check('erasure deletes the key rows',keysOf(ER).length===0);
check('events, deliveries and the marketing record remain',rows('franchise_lead_event',"AND parent_id=?",ER).length>=3&&rows('franchise_delivery',"AND parent_id=?",ER).length===1&&erased.marketing.status==='given'&&erased.marketing.method==='electronic');
check('the linked request is done with resolution erased',(x=>x.status==='done'&&x.resolution==='erased')(rows('franchise_subject_request').find(x=>x.id===srE)));
const snap=JSON.stringify(f.counts());
const again=await post(admin,ERASE);
check('erasure replay returns the same result without new rows',again.status===200&&again.body.replayed===true&&JSON.stringify(again.body.result)===JSON.stringify(r.body.result)&&JSON.stringify(f.counts())===snap);
r=await post(admin,{action:'reveal_contact',brandId:'fr-a',leadId:ER,fields:['name'],purpose:'call_back'});
check('reveal of an erased contact is 409 CONTACT_GONE',r.status===409&&r.body.error===T('CONTACT_GONE'));
r=await post(admin,{action:'update_task',brandId:'fr-a',leadId:ER,version:v(ER),task:{budgetBand:'unknown'}});
check('other mutations of an erased lead are 409 LEAD_ERASED',r.status===409&&r.body.error===T('LEAD_ERASED'));
r=await post(admin,{action:'create_lead',brandId:'fr-a',contact:{name:'이테스트',phone:'010-0000-0106'},task,basis:{type:'inquiry_response'}});
check('the erased phone can be registered again as a new lead',r.status===200&&r.body.result.leadId!==ER);

// ── 9) 암호화 키 없음 ──
const KEY=env.AGENCY_ENCRYPTION_KEY,disposable=(await createLead(boss,'fr-a')).body.result.leadId;
env.AGENCY_ENCRYPTION_KEY=undefined;
n0=total();
r=await post(boss,{action:'create_lead',brandId:'fr-a',contact:{name:'이테스트',phone:'010-0000-0107'},task,basis:{type:'inquiry_response'}});
check('create_lead without the key is 503 KEY_MISSING and writes nothing',r.status===503&&r.body.error===T('KEY_MISSING')&&total()===n0);
for(const [name,call] of [['board',()=>get(boss,'view=board&brandId=fr-a')],['lead',()=>get(boss,`view=lead&brandId=fr-a&leadId=${L1}`)],['reveal',()=>post(boss,{action:'reveal_contact',brandId:'fr-a',leadId:L1,fields:['name'],purpose:'call_back'})],
 ['export',()=>post(boss,{action:'export_leads',brandId:'fr-a',purpose:'handover',contactMode:'masked'})],['find',()=>post(boss,{action:'find_contact',brandId:'fr-a',phone:PHONE})],['update_contact',()=>post(boss,{action:'update_contact',brandId:'fr-a',leadId:L1,version:v(L1),contact:{name:'이테스트'}})]]){
 r=await call();check(`${name} without the key is 503`,r.status===503&&r.body.error===T('KEY_MISSING'));
}
check('503 paths wrote nothing',total()===n0);
r=await post(boss,{action:'purge',brandId:'fr-a'});
check('purge works without the key',r.status===200);
r=await post(boss,{action:'set_marketing_consent',brandId:'fr-a',leadId:disposable,status:'withdrawn'});
check('marketing withdrawal works without the key and omits the lead view',r.status===200&&!('lead' in r.body));
r=await post(boss,{action:'add_subject_request',brandId:'fr-a',leadId:disposable,type:'erasure',channel:'phone',receivedAt:'now'});
check('subject request works without the key',r.status===200);
r=await post(boss,{action:'erase_lead',brandId:'fr-a',leadId:disposable});
check('erasure works without the key',r.status===200&&leadRow(disposable).contactState==='erased');
r=await profile(boss,'fr-a',{},rows('franchise_profile').find(p=>p.id==='fr-a'&&p.version).version);
check('settings work without the key',r.status===200);
env.AGENCY_ENCRYPTION_KEY=KEY;

// ── 14) 보존 기한 파기(시계 이동) ──
const PL=(await post(memberA,{action:'create_lead',brandId:'fr-a',contact:{name:'이테스트',phone:'010-0000-0110'},memo:MEMO,task,basis:{type:'inquiry_response'}})).body.result.leadId;
const PK=(await post(memberA,{action:'create_lead',brandId:'fr-a',contact:{name:'이테스트',phone:'010-0000-0111'},task,basis:{type:'inquiry_response'}})).body.result.leadId;
const PX=(await post(boss,{action:'create_lead',brandId:'fr-a',contact:{name:'이테스트',phone:'010-0000-0112'},task,basis:{type:'inquiry_response'}})).body.result.leadId;
const seeded=async(id,contractedAt,closedAt)=>{const t=new Date(clock.now()).toISOString();const lead={id,brandId:'fr-a',systemCode:'LSEED'+id.slice(-3).toUpperCase(),stage:closedAt?'closed':'contracted',closeReason:closedAt?'contract_ended':null,closedFrom:closedAt?'contracted':null,assigneeId:null,contact:{name:await f.fcrypto.sealField('이테스트'),phone:await f.fcrypto.sealField('01000000113'),email:null},memo:null,contactState:'present',task,basis:{type:'inquiry_response'},marketing:{status:'none'},firstContactAt:t,lastActivityAt:t,contractedAt,closedAt,version:1,createdAt:t,createdBy:{id:'fc-boss',role:'owner'},updatedAt:t};await f.server.recordStatement(WS,'franchise_lead',id,lead,'fr-a').run();return lead};
const t0=new Date(clock.now()).toISOString(),CC='seed-cc1',CO='seed-co1';
await seeded(CC,t0,t0);await seeded(CO,t0,null);
// 열람 재생: 4분 뒤 값 재생, 6분 뒤 만료
const RV={action:'reveal_contact',brandId:'fr-a',leadId:PL,fields:['name'],purpose:'call_back',requestId:'reveal-replay-time'};
r=await post(memberA,RV);
clock.set(4*60000);
r=await post(memberA,RV);
check('reveal replay four minutes later returns the values',r.status===200&&r.body.replayed===true&&typeof r.body.values.name==='string');
clock.set(6*60000);
r=await post(memberA,RV);
check('reveal replay six minutes later is 409 REPLAY_EXPIRED without values',r.status===409&&r.body.error===T('REPLAY_EXPIRED')&&!('values' in r.body));
const lastPK=leadRow(PK).lastActivityAt,purgeAudits=()=>audits('purge').filter(a=>a.trigger==='board_open').length;
clock.set(179*DAY);
r=await get(boss,'view=board&brandId=fr-a');
check('at 179 days the owner board keeps the contact',r.status===200&&leadRow(PL).contactState==='present'&&r.body.leads.find(l=>l.id===PL).contactState==='present');
clock.set(181*DAY);
r=await get(memberA,'view=board&brandId=fr-a');
check('at 181 days the member board shows the contact as expired without purging',r.body.leads.find(l=>l.id===PL).contactState==='expired'&&r.body.leads.find(l=>l.id===PL).contact===null&&leadRow(PL).contactState==='present');
r=await post(memberA,{action:'update_task',brandId:'fr-a',leadId:PK,version:v(PK),task:{budgetBand:'unknown'}});
check('an action on an expired lead purges it first and then is 409 LEAD_ERASED',r.status===409&&r.body.error===T('LEAD_ERASED')&&leadRow(PK).contactState==='purged'&&leadRow(PK).lastActivityAt===lastPK&&keysOf(PK).length===0);
check('the inline purge wrote an audit row',audits('purge').some(a=>a.trigger==='inline'&&a.counts.leads===1));
r=await post(memberA,{action:'create_lead',brandId:'fr-a',contact:{name:'이테스트',phone:'010-0000-0112'},task,basis:{type:'inquiry_response'}});
check('a re-inquiry with an expired phone purges the old lead and is accepted',r.status===200&&leadRow(PX).contactState==='purged');
const pa0=purgeAudits();
r=await get(boss,'view=board&brandId=fr-a');
const purged=leadRow(PL),openAudit=audits('purge').filter(a=>a.trigger==='board_open');
check('owner board open purges the expired contact, memo and keys',purged.contactState==='purged'&&purged.contact===null&&purged.memo===null&&keysOf(PL).length===0&&!!purged.purgedAt);
check('the purge writes a purged event by the system',rows('franchise_lead_event',"AND parent_id=? AND json_extract(data,'$.type')='purged'",PL).some(e=>e.actor.id==='system'));
check('the purge writes one audit row with counts and no values',openAudit.length===pa0+1&&openAudit.at(-1).counts.leads>=1&&!JSON.stringify(openAudit).includes('010-0000'));
await get(boss,'view=board&brandId=fr-a');
check('a second open adds no audit row',purgeAudits()===pa0+1);
check('contracted and closed lead is kept at 181 days',leadRow(CC).contactState==='present');
clock.set(1096*DAY+7*60000);
await get(boss,'view=board&brandId=fr-a');
check('contracted and closed lead is purged 1096 days after closing',leadRow(CC).contactState==='purged');
check('contracted open lead is never purged',leadRow(CO).contactState==='present');

// ── 15) 수동 파기 ──
const now2=()=>new Date(clock.now()).toISOString();
r=await post(boss2,{action:'purge',brandId:'fr-a'});
check('manual purge always writes one audit row, even with zero counts',r.status===200&&rows('franchise_audit',"AND owner=? AND json_extract(data,'$.action')='purge'",WS2).length===1);
const old=new Date(clock.now()-200*DAY).toISOString(),sealedName=await f.fcrypto.sealField('이테스트');
for(let i=0;i<101;i++)await f.server.recordStatement(WS2,'franchise_lead','bulk-'+i,{id:'bulk-'+i,brandId:'fr-a',systemCode:'LBULK'+i,stage:'inquiry',closeReason:null,closedFrom:null,assigneeId:null,contact:{name:sealedName,phone:null,email:null},memo:null,contactState:'present',task,basis:{type:'inquiry_response'},marketing:{status:'none'},firstContactAt:null,lastActivityAt:old,contractedAt:null,closedAt:null,version:1,createdAt:old,createdBy:{id:'fc-boss-2',role:'owner'},updatedAt:old},'fr-a').run();
r=await post(boss2,{action:'purge',brandId:'fr-a'});
check('with 101 expired leads the first run purges 100 and reports one remaining',r.status===200&&r.body.result.counts.leads===100&&r.body.result.counts.remaining===1);
await setFlag(boss2,false);env.AGENCY_ENCRYPTION_KEY=undefined;
r=await post(boss2,{action:'purge',brandId:'fr-a'});
check('manual purge works with the switch off and without the key',r.status===200&&r.body.result.counts.leads===1&&r.body.result.counts.remaining===0);
env.AGENCY_ENCRYPTION_KEY=KEY;
// ── 16) 감사 기록 365일 ──
for(const [id,action] of [['au-old-reveal','reveal'],['au-old-backdate','backdate']])sql.prepare('INSERT INTO records(id,owner,kind,parent_id,data,updated_at) VALUES(?,?,?,?,?,?)').run(`${WS2}:franchise_audit:${id}`,WS2,'franchise_audit','fr-a',JSON.stringify({id,brandId:'fr-a',action,actor:{id:'fc-boss-2',role:'owner'},at:new Date(clock.now()-400*DAY).toISOString()}),now2());
r=await post(boss2,{action:'purge',brandId:'fr-a'});
const has=id=>!!sql.prepare('SELECT 1 FROM records WHERE id=?').get(`${WS2}:franchise_audit:${id}`);
check('purge deletes audit rows older than 365 days but keeps backdate rows',r.status===200&&r.body.result.counts.audits>=1&&!has('au-old-reveal')&&has('au-old-backdate'));

// ── 2·3) 평문 부재 ──
const dump=sql.prepare('SELECT id,kind,parent_id,data FROM records').all().map(x=>JSON.stringify(x)).join('\n')+JSON.stringify(sql.prepare('SELECT * FROM mutation_locks').all());
const secrets=[NAME,PHONE,PHONE_DIGITS,EMAIL,MEMO,'lead.one','010-0000-0102','01000000102','erase.me@example.com'];
check('no stored row holds a plaintext contact, phone digits, email or memo',secrets.every(s=>!dump.includes(s)));
check('no stored row holds a masked value (masking is read-time only)',!dump.includes('김*상')&&!dump.includes('***-****-0101')&&!dump.includes('l***@example.com'));
const evAudit=[...rows('franchise_lead_event'),...rows('franchise_audit')].map(x=>JSON.stringify(x)).join('\n');
check('events and audit rows hold no contact values',!evAudit.includes('이테스트')&&!evAudit.includes('010-0000')&&!evAudit.includes('example.com'));
// ── 4) 콘솔 ──
check('console output holds none of the synthetic values',!logged.some(l=>secrets.some(s=>l.includes(s))||l.includes('이테스트')));
check('no unexpected server error was logged',!logged.some(l=>/franchise_request_failed|agency_request_failed/.test(l)));
check('no external call was made',f.calls.length===0);
check('another-brand lead was created from the same phone',!!LB&&!!W2);

// ── 19) 공개 저장소 경계 ──
const scanFiles=[...readdirSync('lib').filter(x=>/^franchise.*\.ts$/.test(x)&&!['franchise-rules.ts','franchise-gates.ts'].includes(x)).map(x=>'lib/'+x),...readdirSync('app').filter(x=>/^franchise.*\.tsx$/.test(x)).map(x=>'app/'+x),'app/api/franchise/route.ts',
 ...['franchise-lib','franchise-pipeline','franchise-contacts','franchise-model-boundary'].map(x=>`tests/${x}.test.mjs`),'tests/helpers/franchise-fixture.mjs'];
const PHONE_RE=/(?:\+?82[ .-]?)?\(?0?1[016789]\)?[ .-]?\d{3,4}[ .-]?\d{4}/g,EMAIL_RE=/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
const phoneBad=[],emailBad=[],ipBad=[];
for(const file of scanFiles){
 const src=readFileSync(file,'utf8');
 // 국가번호·(0) 뒤에서 잘린 번호('10.0000.0101')는 앞에 0을 붙여 본다. 구분자 없는 숫자열(시각·상수)이 번호로 읽히지 않으면 건너뛴다.
 for(const m of src.match(PHONE_RE)||[]){const n=f.lib.normalizePhone(m)??f.lib.normalizePhone('0'+m);if(n?!/^0100000\d{4}$/.test(n):/[ .()-]/.test(m))phoneBad.push(file+': '+m)}
 for(const m of src.match(EMAIL_RE)||[])if(!/@(?:example\.com|test\.invalid)$/i.test(m))emailBad.push(file+': '+m);
 for(const m of src.match(/\b\d{1,3}(?:\.\d{1,3}){3}\b/g)||[])ipBad.push(file+': '+m);
}
assert.deepEqual(phoneBad,[],'합성이 아닌 전화번호 형태: '+phoneBad.join(', '));passed.push('every phone-like value in the franchise files is a synthetic 010-0000 number');
assert.deepEqual(emailBad,[],'합성이 아닌 이메일: '+emailBad.join(', '));passed.push('every email in the franchise files is example.com or test.invalid');
assert.deepEqual(ipBad,[],'주소 형태 숫자: '+ipBad.join(', '));passed.push('franchise files contain no IPv4-like dotted numbers');
check('the boundary scan covered the new files',scanFiles.length>=8);

console.log(JSON.stringify({passed:passed.length}));
