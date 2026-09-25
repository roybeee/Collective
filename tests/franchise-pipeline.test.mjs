// 트랙 R /api/franchise 파이프라인 회귀(R1a·R4b): 기능 스위치, 역할(대표·관리자·직원 403), IDOR, 가맹 설정, 법정 절차 게이트 시나리오(서버 강제·우회 없음),
// 단계 규칙, 증빙 정정·무효화, 잠금·버전 409, 요청 번호 재생, 요청 제한 429, 준비도 분기, 면책 문구.
// 근거: mocked(메모리 SQLite, 이메일 모드 세션 주입, 외부 fetch는 던지는 스텁). 게이트 결과는 COLLECTIVE 휴리스틱이며 법률 적합성은 확인하지 않는다(결정 20 보류, blocked).
// 운영(real) 직원 403 확인은 직원 계정을 만든 뒤다. Playwright E2E는 이 위임의 허용 게이트가 아니라 not_run이다.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {franchiseFixture,captureConsole,DAY,HOUR,DISCLAIMER,plain,sha64} from './helpers/franchise-fixture.mjs';

const logged=captureConsole();
const f=await franchiseFixture();
const {sql,env,get,setFlag,total,rows,leadRow,profile,brand,signIn}=f;
const passed=[];const check=(name,val)=>{assert.ok(val,name);passed.push(name)};
const E=plain(f.lib.FRANCHISE_ERRORS),T=k=>E[k].text;
const responses=[];
const post=async(s,input)=>{const r=await f.post(s,input);responses.push(r.body);return r};
const createLead=async(s,brandId,extra)=>{const r=await f.createLead(s,brandId,extra);responses.push(r.body);return r};
const ago=ms=>new Date(Date.now()-ms).toISOString(),ahead=ms=>new Date(Date.now()+ms).toISOString();
const v=id=>leadRow(id).version;
const events=(id,type)=>rows('franchise_lead_event',"AND parent_id=? AND json_extract(data,'$.type')=?",id,type);
const audits=action=>rows('franchise_audit',"AND json_extract(data,'$.action')=?",action);
const WS='fr-owner',WS2='fr-owner-2';
env.AUTH_MODE='email';env.AUTH_ORIGIN='https://agency.test';
const boss=signIn('fr-boss','admin',1000,WS),admin=signIn('fr-admin','admin',2000,WS),memberA=signIn('fr-member-a','member',3000,WS),memberB=signIn('fr-member-b','member',4000,WS);
const boss2=signIn('fr-boss-2','admin',1000,WS2);
for(const b of ['fr-a','fr-b','fr-c','fr-d'])await brand(WS,b);
await brand(WS2,'fr-a');

// ── 3) 기본 거부 ──
let r=await post({origin:'https://agency.test'},{action:'purge',brandId:'fr-a'});
check('anonymous POST is a 401',r.status===401);
r=await get({},'view=status');
check('anonymous GET is a 401',r.status===401);
r=await post({...boss,origin:'https://evil.test'},{action:'purge',brandId:'fr-a'});
check('cross-origin POST is a 403',r.status===403);
r=await post(boss,{action:'drop_everything',brandId:'fr-a'});
check('unknown action is a 400',r.status===400&&r.body.error===T('UNKNOWN_ACTION'));
r=await post(boss,{action:'purge',brandId:'fr-a',requestId:'bad id!'});
check('bad requestId is a 400',r.status===400&&r.body.error===T('REQUEST_ID'));
r=await get(boss,'view=nope&brandId=fr-a');
check('unknown view is a 400',r.status===400&&r.body.error===T('UNKNOWN_VIEW'));
check('basic rejections wrote no franchise rows',total()===0);

// ── 1) 스위치 기본 꺼짐 ──
r=await get(boss,'view=status');
check('status shows the switch off by default with the disclaimer',r.status===200&&r.body.enabled===false&&r.body.hasRecords===false&&r.body.contactKey==='ready'&&r.body.disclaimer===DISCLAIMER);
r=await createLead(boss,'fr-a');
check('create_lead with the switch off is 409 with the fixed text',r.status===409&&r.body.error===T('OFF'));
check('switch-off rejection writes zero franchise rows',total()===0);
r=await get(boss,'view=board&brandId=fr-a');
check('board still reads with the switch off',r.status===200&&r.body.enabled===false&&r.body.leads.length===0);
// ── 2) 스위치는 소유자만 ──
const [adminFlag,memberFlag]=await Promise.all([setFlag(admin,true),setFlag(memberA,true)]);
check('admin and member cannot turn the switch on',adminFlag.status===403&&memberFlag.status===403);
r=await setFlag(boss,true);
check('owner turns the switch on through /api/feature-flags',r.status===200&&r.body.flag.enabled===true);

// 설정: 프로필·버전·템플릿(대표·관리자)
r=await profile(boss,'fr-a',{},0);
check('owner saves a branch A profile',r.status===200&&r.body.result.version===1);
const DV_SHA=sha64('synthetic disclosure v1');
r=await post(boss,{action:'register_disclosure_version',brandId:'fr-a',label:'가상 정보공개서 1판',sha256:DV_SHA,registeredAt:ago(60*DAY),validFrom:ago(90*DAY),validUntil:ahead(300*DAY),storageLabel:'본사 문서함'});
const DV=r.body.result.id;
check('disclosure version is registered with its hash',r.status===200&&/^dv-/.test(DV)&&rows('franchise_disclosure_version').some(x=>x.id===DV&&x.sha256===DV_SHA&&x.status==='active'));
const before=total();
r=await post(admin,{action:'register_disclosure_version',brandId:'fr-a',label:'다른 라벨',sha256:DV_SHA,registeredAt:ago(60*DAY),validFrom:ago(90*DAY),validUntil:ahead(300*DAY),storageLabel:'본사 문서함'});
check('same hash returns the existing version and writes nothing',r.status===200&&r.body.result.id===DV&&r.body.result.existing===true&&total()===before);
r=await post(boss,{action:'register_disclosure_version',brandId:'fr-a',label:'미래',sha256:sha64('x2'),registeredAt:ahead(DAY),validFrom:ago(DAY),validUntil:ahead(DAY),storageLabel:'본사 문서함'});
check('future registeredAt is a 400',r.status===400&&r.body.error===T('FUTURE_TIME'));
r=await post(boss,{action:'register_disclosure_version',brandId:'fr-a',label:'역순',sha256:sha64('x3'),registeredAt:null,validFrom:ahead(DAY),validUntil:ago(DAY),storageLabel:'본사 문서함'});
check('validFrom not before validUntil is a 400',r.status===400);
r=await post(boss,{action:'register_disclosure_version',brandId:'fr-a',label:'문의 010-0000-0999',sha256:sha64('x4'),registeredAt:null,validFrom:ago(DAY),validUntil:ahead(DAY),storageLabel:'본사 문서함'});
check('label with a phone number is a 400 PII_IN_TEXT',r.status===400&&r.body.error===T('PII_IN_TEXT'));
check('rejected registrations wrote nothing',total()===before);
// 13) 템플릿
for(const items of [[0],[14],[1.5],[1,1]]){r=await post(boss,{action:'register_contract_template',brandId:'fr-a',label:'잘못된 템플릿',sha256:sha64('bad'+items),checkedItems:items,storageLabel:'본사 문서함'});check(`template items ${JSON.stringify(items)} are a 400`,r.status===400)}
r=await post(boss,{action:'register_contract_template',brandId:'fr-a',label:'가상 계약서안 일부',sha256:sha64('tpl-part'),checkedItems:[1,2,3],storageLabel:'본사 문서함'});
const CT_PART=r.body.result.id;
check('an incomplete template is saved and flagged incomplete',r.status===200&&r.body.result.complete===false);
r=await post(boss,{action:'register_contract_template',brandId:'fr-a',label:'가상 계약서안 전체',sha256:sha64('tpl-full'),checkedItems:[13,12,11,10,9,8,7,6,5,4,3,2,1],storageLabel:'본사 문서함'});
const CT=r.body.result.id;
check('a complete template is saved',r.status===200&&r.body.result.complete===true);

// 헬퍼: 제공 기록(전자 방식, 수신 증빙) · 3종 제공이 끝난 리드
const EL=t=>({electronic:{channel:'email',receivedAt:t,printable:true}});
const deliver=(s,id,doc,t,extra={})=>post(s,{action:'record_delivery',brandId:'fr-a',leadId:id,version:v(id),doc,method:'electronic',deliveredAt:t,evidence:EL(t),...(doc==='disclosure'?{versionId:extra.versionId??DV}:{}),...(doc==='draft'?{templateId:extra.templateId??CT}:{}),...(t==='now'?{}:{backdateReason:'after_the_fact_entry'}),...extra});
const ready=async(daysAgo,s=boss,brandId='fr-a',ids={})=>{
 const c=await createLead(s,brandId);assert.equal(c.status,200,JSON.stringify(c.body));
 const id=c.body.result.leadId,t=daysAgo===0?'now':ago(daysAgo*DAY);
 for(const doc of ['disclosure','nearby','draft']){const d=await deliver(boss,id,doc,t,{brandId,...ids});assert.equal(d.status,200,JSON.stringify(d.body))}
 return id;
};

// ── 1) 계속: 스위치를 끄면 조회·파기·정보주체 요청·철회·열람·내보내기·찾기만 된다 ──
const off1=(await createLead(boss,'fr-a',{basis:{type:'referral',referralFrom:'franchisee'}})).body.result.leadId;
const off2=(await createLead(boss,'fr-a')).body.result.leadId;
const offM=(await createLead(memberA,'fr-a')).body.result.leadId;
check('member-created lead is assigned to the member',leadRow(offM).assigneeId==='fr-member-a');
await setFlag(boss,false);
r=await post(memberA,{action:'add_subject_request',brandId:'fr-a',leadId:offM,type:'access',channel:'phone',receivedAt:'now'});
check('switch off: subject request is accepted',r.status===200);
r=await post(memberA,{action:'set_marketing_consent',brandId:'fr-a',leadId:offM,status:'withdrawn'});
check('switch off: marketing withdrawal is accepted',r.status===200&&leadRow(offM).marketing.status==='withdrawn');
r=await post(admin,{action:'reveal_contact',brandId:'fr-a',leadId:off1,fields:['name'],purpose:'call_back'});
check('switch off: reveal is accepted',r.status===200&&typeof r.body.values.name==='string');
r=await post(boss,{action:'export_leads',brandId:'fr-a',purpose:'internal_review',contactMode:'masked'});
check('switch off: export is accepted',r.status===200&&r.body.rowCount===3);
r=await post(memberB,{action:'find_contact',brandId:'fr-a',phone:'010-0000-0999'});
check('switch off: find is accepted',r.status===200);
r=await post(admin,{action:'update_contact',brandId:'fr-a',leadId:off1,version:v(off1),contact:{name:'이테스트 정정'}});
check('switch off: admin correction (update_contact) is accepted',r.status===200);
r=await post(memberA,{action:'update_contact',brandId:'fr-a',leadId:offM,version:v(offM),contact:{name:'이테스트 정정'}});
check('switch off: member update_contact is 409 OFF',r.status===409&&r.body.error===T('OFF'));
r=await post(admin,{action:'record_source_notice',brandId:'fr-a',leadId:off1,version:v(off1),noticedAt:'now'});
check('switch off: admin source notice is accepted',r.status===200);
r=await post(memberA,{action:'record_source_notice',brandId:'fr-a',leadId:offM,version:v(offM),noticedAt:'now'});
check('switch off: member source notice is 409 OFF',r.status===409&&r.body.error===T('OFF'));
r=await post(memberA,{action:'move_stage',brandId:'fr-a',leadId:offM,version:v(offM),to:'closed',closeReason:'not_interested'});
check('switch off: member close is 409 OFF',r.status===409&&r.body.error===T('OFF'));
r=await post(admin,{action:'move_stage',brandId:'fr-a',leadId:off2,version:v(off2),to:'closed',closeReason:'not_interested'});
check('switch off: admin close (suspension) is accepted',r.status===200&&leadRow(off2).stage==='closed');
for(const [name,s,input] of [
 ['marketing given',boss,{action:'set_marketing_consent',leadId:off1,status:'given',method:'written',at:'now',noticeId:'pn-x'}],
 ['save_profile',boss,{action:'save_profile',version:1,profile:{branch:'A'}}],
 ['update_task',boss,{action:'update_task',leadId:off1,task:{budgetBand:'lt_50m'}}],
 ['record_delivery',boss,{action:'record_delivery',leadId:off1,doc:'disclosure',method:'electronic',deliveredAt:'now'}],
 ['claim_lead',memberB,{action:'claim_lead',leadId:off1}],
]){const n=total();r=await post(s,{brandId:'fr-a',version:v(off1),...input});check(`switch off: ${name} is 409 OFF and writes nothing`,r.status===409&&r.body.error===T('OFF')&&total()===n)}
r=await post(admin,{action:'purge',brandId:'fr-a'});
check('switch off: manual purge is accepted',r.status===200&&typeof r.body.result.counts.leads==='number');
r=await post(admin,{action:'erase_lead',brandId:'fr-a',leadId:off2});
check('switch off: erasure is accepted',r.status===200&&leadRow(off2).contactState==='erased');
await setFlag(boss,true);

// ── 4) 직원 403(대표·관리자만) ──
const own=(await createLead(memberA,'fr-a')).body.result.leadId;
r=await deliver(admin,own,'disclosure','now');
check('admin disclosure on the member lead advances it to disclosed',r.status===200&&leadRow(own).stage==='disclosed');
const memberDenied=[
 ['save_profile',{action:'save_profile',version:1,profile:{branch:'A'}}],
 ['register_disclosure_version',{action:'register_disclosure_version',label:'x',sha256:sha64('m1')}],
 ['register_contract_template',{action:'register_contract_template',label:'x',sha256:sha64('m2'),checkedItems:[1]}],
 ['register_privacy_notice',{action:'register_privacy_notice',versionLabel:'m',text:'x',controllerName:'x'}],
 ['record_delivery',{action:'record_delivery',leadId:own}],['record_advice',{action:'record_advice',leadId:own}],['record_forecast',{action:'record_forecast',leadId:own}],
 ['record_contract',{action:'record_contract',leadId:own}],['record_fee',{action:'record_fee',leadId:own}],['record_agreement',{action:'record_agreement',leadId:own}],['void_evidence',{action:'void_evidence',leadId:own}],
 ['export_leads',{action:'export_leads',purpose:'handover',contactMode:'full'}],['purge',{action:'purge'}],['erase_lead',{action:'erase_lead',leadId:own}],
 ['update_subject_request',{action:'update_subject_request',id:'sr-x',status:'done'}],['assign_lead',{action:'assign_lead',leadId:own,assigneeId:null}],['reopen_lead',{action:'reopen_lead',leadId:own}],
 ['move_stage opened',{action:'move_stage',leadId:own,to:'opened'}],['move_stage closed from disclosed',{action:'move_stage',leadId:own,to:'closed',closeReason:'not_interested'}],
 ['set_marketing_consent given',{action:'set_marketing_consent',leadId:own,status:'given',method:'written',at:'now',noticeId:'pn-x'}],
];
for(const [name,input] of memberDenied){const n=total();r=await post(memberA,{brandId:'fr-a',version:v(own),...input});check(`member ${name} is 403 ADMIN_ONLY and writes nothing`,r.status===403&&r.body.error===T('ADMIN_ONLY')&&total()===n)}
for(const view of ['settings','audit']){r=await get(memberA,`view=${view}&brandId=fr-a`);check(`member GET ${view} is 403`,r.status===403)}
// 5) 직원 등록은 자신에게 배정
r=await createLead(memberA,'fr-a');
const mLead=r.body.result.leadId;
check('member-created lead is assigned to self',r.status===200&&leadRow(mLead).assigneeId==='fr-member-a'&&r.body.lead.assignedToMe===true);
r=await createLead(memberA,'fr-a',{assigneeId:'fr-member-b'});
check('member assigning someone else is 403',r.status===403&&r.body.error===T('ADMIN_ONLY'));
// 6) 다른 직원의 리드
r=await get(memberB,'view=board&brandId=fr-a');
check('member B board excludes member A leads',r.status===200&&!r.body.leads.some(l=>l.id===mLead));
r=await get(memberB,`view=lead&brandId=fr-a&leadId=${mLead}`);
check('member B lead view of member A lead is 403 NOT_VISIBLE',r.status===403&&r.body.error===T('NOT_VISIBLE'));
r=await post(memberB,{action:'update_task',brandId:'fr-a',leadId:mLead,version:v(mLead),task:{budgetBand:'lt_50m'}});
check('member B update_task on member A lead is 403',r.status===403);
// 7) 담당 없는 리드: 보이고, 가져와야 수정한다
const un=(await createLead(boss,'fr-a',{assigneeId:null})).body.result.leadId;
r=await get(memberB,'view=board&brandId=fr-a');
check('member sees an unassigned lead on the board',r.body.leads.some(l=>l.id===un&&l.assigneeId===null));
r=await post(memberB,{action:'update_task',brandId:'fr-a',leadId:un,version:v(un),task:{budgetBand:'lt_50m'}});
check('member update_task on an unassigned lead is 403 NOT_ASSIGNED',r.status===403&&r.body.error===T('NOT_ASSIGNED'));
r=await post(memberB,{action:'claim_lead',brandId:'fr-a',leadId:un,version:v(un)});
check('member claims the unassigned lead',r.status===200&&leadRow(un).assigneeId==='fr-member-b'&&audits('claim').some(a=>a.leadId===un));
r=await post(memberB,{action:'update_task',brandId:'fr-a',leadId:un,version:v(un),task:{budgetBand:'lt_50m'}});
check('after claiming, member update_task succeeds',r.status===200&&leadRow(un).task.budgetBand==='lt_50m');
r=await post(memberA,{action:'claim_lead',brandId:'fr-a',leadId:un,version:v(un)});
check('another member cannot see or claim a claimed lead',r.status===403);
const un2=(await createLead(boss,'fr-a',{assigneeId:null})).body.result.leadId;
await post(memberA,{action:'claim_lead',brandId:'fr-a',leadId:un2,version:v(un2)});
r=await post(admin,{action:'claim_lead',brandId:'fr-a',leadId:un2,version:v(un2)});
check('second claim is 409 ALREADY_ASSIGNED',r.status===409&&r.body.error===T('ALREADY_ASSIGNED'));
// 8) 재배정
r=await post(admin,{action:'assign_lead',brandId:'fr-a',leadId:un2,version:v(un2),assigneeId:'fr-member-b'});
check('admin reassigns and an assign audit row is written',r.status===200&&leadRow(un2).assigneeId==='fr-member-b'&&audits('assign').some(a=>a.leadId===un2&&a.assigneeId==='fr-member-b'));
r=await post(admin,{action:'assign_lead',brandId:'fr-a',leadId:un2,version:v(un2),assigneeId:'someone-else'});
check('assigning an unknown account is a 400',r.status===400);
// 9) 직원 보기에는 증빙·게이트가 없다
const mView=(await get(memberA,`view=lead&brandId=fr-a&leadId=${own}`)).body,aView=(await get(admin,`view=lead&brandId=fr-a&leadId=${own}`)).body;
check('member lead view has no evidence or gate keys',!('evidence' in mView)&&!('gate' in mView)&&Array.isArray(mView.events));
check('admin lead view has evidence and gate with disclaimer',Array.isArray(aView.evidence)&&aView.evidence.length===1&&aView.gate.disclaimer===DISCLAIMER&&aView.gate.window.disclaimer===DISCLAIMER);

// ── 10) 다른 소유자(IDOR) ──
await setFlag(boss2,true);
for(const [name,call] of [['GET lead',()=>get(boss2,`view=lead&brandId=fr-a&leadId=${own}`)],['update_task',()=>post(boss2,{action:'update_task',brandId:'fr-a',leadId:own,version:v(own),task:{budgetBand:'lt_50m'}})],['reveal',()=>post(boss2,{action:'reveal_contact',brandId:'fr-a',leadId:own,fields:['name'],purpose:'call_back'})]]){r=await call();check(`other owner ${name} on this lead is 404`,r.status===404)}
// ── 11) 다른 브랜드 ──
r=await get(boss,`view=lead&brandId=fr-b&leadId=${own}`);
check('lead requested under another brand is 404',r.status===404&&r.body.error===T('LEAD_NOT_FOUND'));
await profile(boss,'fr-b',{},0);
const dvB=(await post(boss,{action:'register_disclosure_version',brandId:'fr-b',label:'B 정보공개서',sha256:sha64('dv-b'),registeredAt:ago(60*DAY),validFrom:ago(90*DAY),validUntil:ahead(300*DAY),storageLabel:'본사 문서함'})).body.result.id;
const ctB=(await post(boss,{action:'register_contract_template',brandId:'fr-b',label:'B 계약서안',sha256:sha64('ct-b'),checkedItems:Array.from({length:13},(_,i)=>i+1),storageLabel:'본사 문서함'})).body.result.id;
const pnB=(await post(boss,{action:'register_privacy_notice',brandId:'fr-b',versionLabel:'B-1',text:'가상 안내문 B',controllerName:'가상 가맹본부'})).body.result.id;
const xb=(await createLead(boss,'fr-a')).body.result.leadId;
let n0=total();
r=await deliver(boss,xb,'disclosure','now',{versionId:dvB});
check('delivery with another brand version is 400 VERSION_NOT_FOUND',r.status===400&&r.body.error===T('VERSION_NOT_FOUND'));
r=await deliver(boss,xb,'draft','now',{templateId:ctB});
check('delivery with another brand template is 400',r.status===400&&r.body.error===T('TEMPLATE_NOT_FOUND'));
r=await createLead(boss,'fr-a',{basis:{type:'consent',noticeId:pnB,noticeGivenAt:'now'}});
check('consent with another brand notice is 400 NOTICE_REQUIRED',r.status===400&&r.body.error===T('NOTICE_REQUIRED'));
r=await post(boss,{action:'add_subject_request',brandId:'fr-b',leadId:xb,type:'access',channel:'phone',receivedAt:'now'});
check('subject request for another brand lead is 404',r.status===404);
check('cross-brand rejections wrote nothing',total()===n0);
r=await deliver(boss,own,'nearby','now');
const otherRecord=r.body.result.evidenceId;
r=await deliver(boss,xb,'nearby','now',{supersedes:otherRecord,correctionReason:'typo'});
check('supersedes pointing at another lead record is 400',r.status===400);

// ── 14) 프로필 버전·보관 위치 ──
r=await profile(boss,'fr-a',{storageLabels:['본사 문서함','외부 보관']},0);
check('stale profile version is 409',r.status===409&&r.body.error===T('STALE'));
r=await profile(boss,'fr-a',{storageLabels:['본사 문서함','외부 보관'],eligibility:{budgetBands:['lt_50m'],regions:['가상시 가상구'],timingBands:['within_3m']}},1);
check('profile saves labels and a versioned eligibility rule',r.status===200&&r.body.result.version===2&&leadRow(own)&&rows('franchise_profile').find(p=>p.id==='fr-a').eligibility.version===1);
r=await deliver(boss,xb,'nearby','now',{storageLabel:'책상 서랍'});
check('evidence with a storage label outside the profile list is 400',r.status===400&&r.body.error===T('STORAGE_LABEL'));

// ── 게이트 시나리오 ──
// 15) 시나리오 1: 30일 전 3종 제공(사유 있는 이른 증빙 시각) → 계약(1시간 전) 200 → 개점 200
const s1=await ready(30);
check('three deliveries advance the lead to draft_provided',leadRow(s1).stage==='draft_provided');
const signed1=ago(HOUR);
r=await post(boss,{action:'record_contract',brandId:'fr-a',leadId:s1,version:v(s1),signedAt:signed1,backdateReason:'after_the_fact_entry'});
check('scenario 1: contract after the waiting period is recorded',r.status===200&&leadRow(s1).stage==='contracted'&&leadRow(s1).contractedAt===signed1);
check('scenario 1: lead view shows the contract window with disclaimer',!!r.body.lead.gate.window.at&&/KST$/.test(r.body.lead.gate.window.atKst)&&r.body.lead.gate.disclaimer===DISCLAIMER);
r=await post(boss,{action:'move_stage',brandId:'fr-a',leadId:s1,version:v(s1),to:'opened'});
check('scenario 1: opening passes with stored backdate approvals',r.status===200&&leadRow(s1).stage==='opened');
// 16) 시나리오 2: 3일 전 제공 → 계약 409
const s2=await ready(3);
n0=total();
r=await post(boss,{action:'record_contract',brandId:'fr-a',leadId:s2,version:v(s2),signedAt:ago(HOUR),backdateReason:'after_the_fact_entry'});
const tooEarly=r;
check('scenario 2: early contract is 409 GATE_BLOCKED',r.status===409&&r.body.error===T('GATE_BLOCKED'));
check('scenario 2: reasons include contract_too_early in Korean',r.body.reasons.some(x=>x.code==='contract_too_early'&&/계약 가능 시각/.test(x.message)));
check('scenario 2: earliest contract time and disclaimer are returned',!!r.body.earliestContractAt&&r.body.disclaimer===DISCLAIMER&&r.body.window.disclaimer===DISCLAIMER);
check('scenario 2: one transition_blocked event and no contract record',total()===n0+1&&events(s2,'transition_blocked').length===1&&!rows('franchise_delivery',"AND parent_id=? AND json_extract(data,'$.evidenceType')='contract'",s2).length&&leadRow(s2).stage==='draft_provided');
// 23) 우회 없음
r=await post(boss,{action:'record_contract',brandId:'fr-a',leadId:s2,version:v(s2),signedAt:ago(HOUR),backdateReason:'after_the_fact_entry',force:true,bypass:true,skipGate:true});
check('owner has no bypass field',r.status===409&&r.body.reasons.some(x=>x.code==='contract_too_early'));
r=await post(admin,{action:'record_contract',brandId:'fr-a',leadId:s2,version:v(s2),signedAt:ago(HOUR),backdateReason:'after_the_fact_entry',force:true});
check('admin has no bypass field',r.status===409);
// 22) 본계약 전 약정
r=await post(boss,{action:'record_agreement',brandId:'fr-a',leadId:s2,version:v(s2),signedAt:ago(HOUR),backdateReason:'after_the_fact_entry',clauses:{fee:true,construction:false,training:false}});
check('binding pre-contract agreement before the window is 409',r.status===409&&r.body.reasons.some(x=>x.code==='pre_contract_agreement_too_early')&&!!r.body.window);
r=await post(boss,{action:'record_agreement',brandId:'fr-a',leadId:s2,version:v(s2),signedAt:ago(HOUR),backdateReason:'after_the_fact_entry',clauses:{fee:false,construction:false,training:false}});
check('agreement with no binding clause is recorded',r.status===200);
// 17) 시나리오 6: 1호 자필 누락은 기록되지만 기산하지 않는다
const s6=(await createLead(boss,'fr-a')).body.result.leadId;
const HAND={receiptDateTimePlaceHandwritten:true,nameAddressPhoneHandwritten:true,signatureHandwritten:true,hqSigned:true,confirmationGiven:false};
r=await post(boss,{action:'record_delivery',brandId:'fr-a',leadId:s6,version:v(s6),doc:'disclosure',method:'hand',deliveredAt:'now',versionId:DV,evidence:{hand:HAND}});
check('scenario 6: incomplete hand delivery is recorded but not counted',r.status===200&&r.body.result.assessment.counted===false&&r.body.result.assessment.reasons.some(x=>x.code==='evidence_incomplete')&&leadRow(s6).stage==='inquiry');
await deliver(boss,s6,'nearby','now');await deliver(boss,s6,'draft','now');
r=await post(boss,{action:'record_contract',brandId:'fr-a',leadId:s6,version:v(s6),signedAt:'now'});
check('scenario 6: later contract is 409',r.status===409&&r.body.reasons.some(x=>['evidence_incomplete','disclosure_missing'].includes(x.code)));
r=await deliver(boss,s6,'draft','now',{templateId:CT_PART});
check('a draft on an incomplete template is recorded but not counted',r.status===200&&r.body.result.assessment.counted===false&&r.body.result.assessment.reasons.some(x=>x.code==='draft_template_incomplete'));
const kstToday=new Date(Date.now()+9*HOUR).toISOString().slice(0,10);
r=await post(boss,{action:'record_advice',brandId:'fr-a',leadId:s6,version:v(s6),advisorType:'attorney',registrationVerified:true,advisedOn:'2199-01-01',targetDoc:'disclosure',hqPaid:false,hqReferred:false});
check('advice dated after today (KST) is 400 FUTURE_TIME',r.status===400&&r.body.error===T('FUTURE_TIME'));
r=await post(boss,{action:'record_advice',brandId:'fr-a',leadId:s6,version:v(s6),advisorType:'lawyer',registrationVerified:true,advisedOn:kstToday,targetDoc:'disclosure'});
check('unknown advisor type is 400',r.status===400);
r=await post(boss,{action:'record_advice',brandId:'fr-a',leadId:s6,version:v(s6),advisorType:'attorney',registrationVerified:true,advisedOn:kstToday,targetDoc:'disclosure',hqPaid:false,hqReferred:false});
check('advice evidence is recorded without a backdate',r.status===200&&rows('franchise_delivery',"AND json_extract(data,'$.id')=?",r.body.result.evidenceId)[0].payload.advisedOn===kstToday);
// 18) 공정위 링크
n0=total();
r=await post(boss,{action:'record_delivery',brandId:'fr-a',leadId:s6,version:v(s6),doc:'disclosure',method:'ftc_link',deliveredAt:'now',versionId:DV});
check('ftc link method is 400 method_not_allowed and stores nothing',r.status===400&&r.body.reasons.some(x=>x.code==='method_not_allowed')&&r.body.disclaimer===DISCLAIMER&&total()===n0);
// 19) 미래·이른 증빙 시각, 허용 필드만 저장
r=await deliver(boss,s6,'nearby',ahead(HOUR));
check('future deliveredAt is 400 FUTURE_TIME',r.status===400&&r.body.error===T('FUTURE_TIME'));
r=await post(boss,{action:'record_delivery',brandId:'fr-a',leadId:s6,version:v(s6),doc:'nearby',method:'electronic',deliveredAt:ago(DAY),evidence:EL(ago(DAY))});
check('past deliveredAt without a reason is 400 BACKDATE',r.status===400&&r.body.error===T('BACKDATE'));
check('rejected evidence stored nothing',total()===n0);
r=await deliver(boss,s6,'nearby',ago(DAY));
const bdRow=rows('franchise_delivery',"AND json_extract(data,'$.id')=?",r.body.result.evidenceId)[0];
check('backdated delivery with a reason stores an approval tied to a backdate audit row',r.status===200&&bdRow.backdateApproval.reasonCode==='after_the_fact_entry'&&audits('backdate').some(a=>a.id===bdRow.backdateApproval.auditEventId&&a.recordId===bdRow.id));
const bdCount=audits('backdate').length;
r=await deliver(boss,s6,'nearby','now');
const nowRow=rows('franchise_delivery',"AND json_extract(data,'$.id')=?",r.body.result.evidenceId)[0];
check("'now' delivery uses the server time and needs no backdate row",r.status===200&&nowRow.payload.deliveredAt===nowRow.recordedAt&&nowRow.backdateApproval===null&&audits('backdate').length===bdCount);
r=await post(boss,{action:'record_delivery',brandId:'fr-a',leadId:s6,version:v(s6),doc:'nearby',method:'hand',deliveredAt:'now',name:'김가상',evidence:{hand:{...HAND,confirmationGiven:true,note:'김가상'}}});
const handRow=JSON.stringify(rows('franchise_delivery',"AND json_extract(data,'$.id')=?",r.body.result.evidenceId)[0]);
check('unknown payload keys are dropped, not stored',r.status===200&&!handRow.includes('김가상')&&!handRow.includes('note')&&!handRow.includes('"name"'));
// 20) 시나리오 8: 가맹금
const s8=await ready(30);
await post(boss,{action:'record_contract',brandId:'fr-a',leadId:s8,version:v(s8),signedAt:ago(2*HOUR),backdateReason:'after_the_fact_entry'});
check('fee scenario lead is contracted',leadRow(s8).stage==='contracted');
r=await post(boss,{action:'record_fee',brandId:'fr-a',leadId:s8,version:v(s8),category:'a_join',paidAt:ago(HOUR),backdateReason:'after_the_fact_entry'});
check('join fee without escrow is 409 escrow_unproven with a blocked event',r.status===409&&r.body.reasons.some(x=>x.code==='escrow_unproven')&&events(s8,'transition_blocked').length===1);
r=await post(boss,{action:'record_fee',brandId:'fr-a',leadId:s8,version:v(s8),category:'a_join',escrow:{institutionType:'bank',firstDepositAt:ago(2*DAY),agreementAt:ago(25*DAY)},backdateReason:'after_the_fact_entry'});
check('escrow agreed before the window is 409 fee_too_early',r.status===409&&r.body.reasons.some(x=>x.code==='fee_too_early'));
r=await post(boss,{action:'record_fee',brandId:'fr-a',leadId:s8,version:v(s8),category:'d_periodic',paidAt:ago(DAY),backdateReason:'after_the_fact_entry'});
check('periodic fee after the window without escrow is recorded and the stage stays',r.status===200&&leadRow(s8).stage==='contracted');
r=await post(boss,{action:'record_fee',brandId:'fr-a',leadId:s8,version:v(s8),category:'a_join',escrow:{institutionType:'bank',firstDepositAt:ago(2*DAY),agreementAt:null},backdateReason:'after_the_fact_entry'});
check('valid escrow after the window moves the lead to fee_escrowed',r.status===200&&leadRow(s8).stage==='fee_escrowed');
r=await post(boss,{action:'record_fee',brandId:'fr-a',leadId:s8,version:v(s8),category:'a_join',paidAt:ago(DAY),insurance:{coverageFrom:ago(10*DAY),coverageTo:ahead(365*DAY)},backdateReason:'after_the_fact_entry'});
check('insurance coverage ending next year is accepted (not a future evidence time)',r.status===200);
// 21) 시나리오 9: 산정서 의무 미확인
await profile(boss,'fr-c',{forecastInputs:{sme:null,storesAtFyEnd:null,fiscalYearEnd:null}},0);
const dvC=(await post(boss,{action:'register_disclosure_version',brandId:'fr-c',label:'C 정보공개서',sha256:sha64('dv-c'),registeredAt:ago(60*DAY),validFrom:ago(90*DAY),validUntil:ahead(300*DAY),storageLabel:'본사 문서함'})).body.result.id;
const ctC=(await post(boss,{action:'register_contract_template',brandId:'fr-c',label:'C 계약서안',sha256:sha64('ct-c'),checkedItems:Array.from({length:13},(_,i)=>i+1),storageLabel:'본사 문서함'})).body.result.id;
const s9=await ready(30,boss,'fr-c',{versionId:dvC,templateId:ctC});
r=await post(boss,{action:'record_contract',brandId:'fr-c',leadId:s9,version:v(s9),signedAt:ago(HOUR),backdateReason:'after_the_fact_entry'});
check('unknown forecast duty blocks a contract without a forecast statement',r.status===409&&r.body.reasons.some(x=>x.code==='forecast_statement_missing'));
r=await post(boss,{action:'record_forecast',brandId:'fr-c',leadId:s9,version:v(s9),providedAt:ago(2*HOUR),backdateReason:'after_the_fact_entry'});
check('forecast statement needs a document hash',r.status===400);
r=await post(boss,{action:'record_forecast',brandId:'fr-c',leadId:s9,version:v(s9),providedAt:ago(2*HOUR),backdateReason:'after_the_fact_entry',docSha256:sha64('forecast')});
check('forecast statement is recorded',r.status===200);
r=await post(boss,{action:'record_contract',brandId:'fr-c',leadId:s9,version:v(s9),signedAt:ago(HOUR),backdateReason:'after_the_fact_entry'});
check('contract passes after the forecast statement',r.status===200&&leadRow(s9).stage==='contracted');
// 24) 단계 규칙
r=await post(boss,{action:'move_stage',brandId:'fr-a',leadId:s6,version:v(s6),to:'contracted'});
check('moving to contracted is 400 EVIDENCE_ONLY',r.status===400&&r.body.error===T('EVIDENCE_ONLY'));
r=await post(boss,{action:'move_stage',brandId:'fr-a',leadId:s6,version:v(s6),to:'disclosed'});
check('moving to disclosed is 400 EVIDENCE_ONLY',r.status===400&&r.body.error===T('EVIDENCE_ONLY'));
r=await post(boss,{action:'move_stage',brandId:'fr-a',leadId:own,version:v(own),to:'contacted'});
check('a general stage after disclosed is 400 NO_BACKWARD',r.status===400&&r.body.error===T('NO_BACKWARD'));
r=await post(boss,{action:'move_stage',brandId:'fr-a',leadId:own,version:v(own),to:'closed'});
check('closing without a reason is 400',r.status===400);
r=await post(boss,{action:'move_stage',brandId:'fr-a',leadId:own,version:v(own),to:'closed',closeReason:'contract_ended'});
check('contract_ended on an uncontracted lead is 400',r.status===400);
r=await post(boss,{action:'move_stage',brandId:'fr-a',leadId:own,version:v(own),to:'closed',closeReason:'not_interested'});
check('admin closes a disclosed lead',r.status===200&&leadRow(own).closedFrom==='disclosed');
r=await post(memberA,{action:'reopen_lead',brandId:'fr-a',leadId:own,version:v(own)});
check('member reopen is 403',r.status===403);
r=await post(boss,{action:'move_stage',brandId:'fr-a',leadId:own,version:v(own),to:'contacted'});
check('moving a closed lead is 409 CLOSED',r.status===409&&r.body.error===T('CLOSED'));
// 25) 종결 리드 증빙
r=await deliver(boss,own,'nearby','now');
check('delivery on a closed lead is 409 CLOSED',r.status===409&&r.body.error===T('CLOSED'));
r=await post(admin,{action:'reopen_lead',brandId:'fr-a',leadId:own,version:v(own)});
check('admin reopen restores the pre-close stage',r.status===200&&leadRow(own).stage==='disclosed'&&leadRow(own).closedAt===null);
const g0=await createLead(boss,'fr-a');
r=await post(boss,{action:'move_stage',brandId:'fr-a',leadId:g0.body.result.leadId,version:1,to:'opened'});
check('opening before a contract is 409',r.status===409&&r.body.error===T('GATE_BLOCKED'));
r=await post(boss,{action:'move_stage',brandId:'fr-a',leadId:g0.body.result.leadId,version:v(g0.body.result.leadId),to:'consulted'});
check('a general move records the first contact time',r.status===200&&!!leadRow(g0.body.result.leadId).firstContactAt);
// 정정·무효화
const s25=await ready(30),ev25=rows('franchise_delivery',"AND parent_id=? AND json_extract(data,'$.payload.doc')='disclosure'",s25)[0];
const at25=(await get(boss,`view=lead&brandId=fr-a&leadId=${s25}`)).body.gate.window.at;
r=await deliver(boss,s25,'disclosure',ago(2*DAY),{supersedes:ev25.id,correctionReason:'wrong_time'});
const view25=(await get(boss,`view=lead&brandId=fr-a&leadId=${s25}`)).body;
check('correction appends a new version and keeps the old row unchanged',r.status===200&&JSON.stringify(rows('franchise_delivery',"AND json_extract(data,'$.id')=?",ev25.id)[0])===JSON.stringify(ev25)&&view25.evidence.find(e=>e.id===ev25.id).superseded===true);
check('the gate uses the corrected record',Date.parse(view25.gate.window.at)>Date.parse(at25));
r=await deliver(boss,s25,'disclosure','now',{supersedes:'fd-unknown',correctionReason:'typo'});
check('supersedes of an unknown record is 400',r.status===400);
const s25b=await ready(30),dis=rows('franchise_delivery',"AND parent_id=? AND json_extract(data,'$.payload.doc')='disclosure'",s25b)[0];
r=await post(boss,{action:'void_evidence',brandId:'fr-a',leadId:s25b,version:v(s25b),supersedes:dis.id,correctionReason:'wrong_lead'});
check('voiding a wrong-lead disclosure writes a void row and an audit row',r.status===200&&audits('evidence_void').some(a=>a.recordId===dis.id));
r=await post(boss,{action:'record_contract',brandId:'fr-a',leadId:s25b,version:v(s25b),signedAt:ago(HOUR),backdateReason:'after_the_fact_entry'});
check('after voiding the only disclosure, the contract is 409 disclosure_missing',r.status===409&&r.body.reasons.some(x=>x.code==='disclosure_missing'));
const contract1=rows('franchise_delivery',"AND parent_id=? AND json_extract(data,'$.evidenceType')='contract'",s1)[0];
r=await post(boss,{action:'void_evidence',brandId:'fr-a',leadId:s1,version:v(s1),supersedes:contract1.id,correctionReason:'wrong_lead'});
check('voiding a contract record is 400',r.status===400);

// ── 26·27) 버전·잠금 ──
n0=total();
r=await post(boss,{action:'update_task',brandId:'fr-a',leadId:s25,version:v(s25)-1,task:{budgetBand:'lt_50m'}});
check('stale version is 409 STALE and writes nothing',r.status===409&&r.body.error===T('STALE')&&total()===n0);
sql.prepare('INSERT INTO mutation_locks(owner,token,expires_at) VALUES(?,?,?)').run(WS+':franchise','held-by-test',Date.now()+60000);
r=await post(boss,{action:'update_task',brandId:'fr-a',leadId:s25,version:v(s25),task:{budgetBand:'lt_50m'}});
check('a held lock is 409 and writes nothing',r.status===409&&/다른 작업을 저장하고 있습니다/.test(r.body.error)&&total()===n0);
sql.prepare('DELETE FROM mutation_locks WHERE owner=?').run(WS+':franchise');
const race=(await createLead(boss,'fr-a')).body.result.leadId;
const both=await Promise.all([post(boss,{action:'move_stage',brandId:'fr-a',leadId:race,version:1,to:'contacted'}),post(admin,{action:'move_stage',brandId:'fr-a',leadId:race,version:1,to:'consulted'})]);
check('two concurrent moves with the same version: exactly one 200, one 409',both.filter(x=>x.status===200).length===1&&both.filter(x=>x.status===409).length===1&&leadRow(race).version===2);

// ── 28) 요청 번호 재생 ──
const snapshot=()=>JSON.stringify(f.counts());
const RID='replay-create-0001';
r=await createLead(boss,'fr-a',{requestId:RID});
let s0=snapshot();
let again=await createLead(boss,'fr-a',{requestId:RID,contact:{name:'다른사람',phone:'010-0000-0998'}});
check('create_lead replay returns the same result without new rows',again.status===200&&again.body.replayed===true&&again.body.result.leadId===r.body.result.leadId&&snapshot()===s0);
const rl=r.body.result.leadId;
const mv={action:'move_stage',brandId:'fr-a',leadId:rl,version:1,to:'contacted',requestId:'replay-move-0001'};
r=await post(boss,mv);s0=snapshot();again=await post(boss,mv);
check('move_stage replay is idempotent',r.status===200&&again.status===200&&again.body.replayed===true&&JSON.stringify(again.body.result)===JSON.stringify(r.body.result)&&snapshot()===s0);
const dl={action:'record_delivery',brandId:'fr-a',leadId:rl,version:2,doc:'disclosure',method:'electronic',deliveredAt:'now',evidence:EL('now'),versionId:DV,requestId:'replay-deliver-01'};
r=await post(boss,dl);s0=snapshot();again=await post(boss,dl);
check('record_delivery replay is idempotent',r.status===200&&again.body.replayed===true&&again.body.result.evidenceId===r.body.result.evidenceId&&snapshot()===s0);
const rv={action:'reveal_contact',brandId:'fr-a',leadId:rl,fields:['name','phone'],purpose:'call_back',requestId:'replay-reveal-001'};
r=await post(boss,rv);s0=snapshot();again=await post(boss,rv);
check('reveal replay within five minutes returns the same values without a new audit row',again.status===200&&JSON.stringify(again.body.values)===JSON.stringify(r.body.values)&&snapshot()===s0);
const ex={action:'export_leads',brandId:'fr-a',purpose:'internal_review',contactMode:'masked',requestId:'replay-export-001'};
r=await post(boss,ex);s0=snapshot();again=await post(boss,ex);
check('export replay within five minutes regenerates the file without a new audit row',again.status===200&&again.body.rowCount===r.body.rowCount&&typeof again.body.csv==='string'&&snapshot()===s0);
const bl={action:'record_contract',brandId:'fr-a',leadId:s2,version:v(s2),signedAt:ago(HOUR),backdateReason:'after_the_fact_entry',requestId:'replay-blocked-01'};
r=await post(boss,bl);s0=snapshot();again=await post(boss,bl);
check('blocked contract replay returns the same 409',r.status===409&&again.status===409&&again.body.replayed===true&&JSON.stringify(again.body.reasons)===JSON.stringify(r.body.reasons)&&snapshot()===s0);
check('the first blocked contract response matched the scenario 2 reasons',JSON.stringify(r.body.reasons.map(x=>x.code))===JSON.stringify(tooEarly.body.reasons.map(x=>x.code)));
r=await post(boss,{action:'update_task',brandId:'fr-a',leadId:rl,version:v(rl),task:{budgetBand:'lt_50m'},requestId:'replay-task-0002'});
check('a different requestId writes new rows',r.status===200&&snapshot()!==s0);
r=await post(boss,{...mv,leadId:s25});
check('same requestId with another leadId is 409 REQUEST_REUSED',r.status===409&&r.body.error===T('REQUEST_REUSED'));
const MR='replay-member-001';
r=await createLead(memberA,'fr-a',{requestId:MR});
const ml=r.body.result.leadId;
await post(admin,{action:'assign_lead',brandId:'fr-a',leadId:ml,version:v(ml),assigneeId:'fr-member-b'});
again=await createLead(memberA,'fr-a',{requestId:MR});
check('member replay after reassignment returns 200 without a lead view',again.status===200&&again.body.replayed===true&&!('lead' in again.body));

// ── 29) 요청 제한 ──
f.opts.resetRate=false;
sql.prepare("DELETE FROM records WHERE kind='execution_rate'").run();
const statuses=[];
for(let i=0;i<61;i++)statuses.push((await post(memberB,{action:'find_contact',brandId:'fr-a',phone:'010-0000-0997'})).status);
check('sixty writes per minute pass and the sixty-first is 429',statuses.slice(0,60).every(s=>s===200)&&statuses[60]===429);
f.opts.resetRate=true;

// ── 30) 준비도 분기 ──
const pB=rows('franchise_profile').find(p=>p.id==='fr-b').version;
for(const [branch,version] of [['B',pB],['undetermined',pB+1]]){
 await profile(boss,'fr-b',{branch},version);
 r=await createLead(boss,'fr-b');
 check(`branch ${branch} blocks new leads with 409 BRANCH_BLOCKED`,r.status===409&&r.body.error===T('BRANCH_BLOCKED'));
}
r=await createLead(boss,'fr-d');
check('a brand without a profile blocks new leads',r.status===409&&r.body.error===T('BRANCH_BLOCKED'));
await profile(boss,'fr-b',{branch:'A'},pB+2);
r=await createLead(boss,'fr-b');
check('branch A accepts new leads',r.status===200);

// ── 31) 면책·금지 표현 ──
const withGate=responses.filter(b=>b&&(b.reasons||b.window||b.gate));
check('every gate response carries the disclaimer',withGate.length>10&&withGate.every(b=>(b.disclaimer??b.gate?.disclaimer)===DISCLAIMER));
const FORBIDDEN=/법적으로 적합|준수 완료|합법/;
check('no response contains a legal-adequacy claim',!responses.some(b=>FORBIDDEN.test(JSON.stringify(b))));
check('franchise sources and docs contain no legal-adequacy claim',['lib/franchise.ts','lib/franchise-server.ts','lib/franchise-crypto.ts','app/api/franchise/route.ts','docs/FRANCHISE-RECRUITMENT-PLAN.ko.md','docs/SECURITY-BOUNDARIES.ko.md','docs/DATA-PROCESSING.ko.md'].every(p=>!FORBIDDEN.test(readFileSync(p,'utf8'))));
check('no unexpected server error was logged',!logged.some(l=>/franchise_request_failed|agency_request_failed/.test(l)));
check('no external call was made',f.calls.length===0);

console.log(JSON.stringify({passed:passed.length}));
