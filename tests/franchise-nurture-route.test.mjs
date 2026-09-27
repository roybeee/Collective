// 트랙 R R9a-2 너처링 경로 스위트(/api/franchise nurture_draft_start·nurture_draft_poll·nurture_template_save·nurture_template_retire, 리드 add_info_request·log_lead_message, GET nurture).
// 확인: 초안 HERMES 1회(모의)의 제출 본문·제출 원문 행·콘솔에 리드 유래 문자열 0건(DP-10), 수익 항목 사실 미전송, 멱등(같은 초안 id 1건), 작성 중 중복 409, 완료 출력 검사(형식 오류·hard_block은 본문 없이 실패),
// 접수 실패 → 확인 불가(uncertain) → 복구, 템플릿 저장(초안에서·손으로)·폐기(대표·관리자), 정보 요청 → 발송 기록(요청당 1회, 광고성 409), 스위치·역할, 감사 값 없음, 외부 발송 0. 사례 번호 NR-*는 PR 본문과 같다.
// 근거: mocked(메모리 SQLite, 이메일 모드 세션 주입, HERMES fetch 스텁). 실제 HERMES 실행은 not_run(운영 게시·스위치 뒤). 결과는 COLLECTIVE 휴리스틱 · 법률 자문 아님.
import assert from 'node:assert/strict';
import {franchiseFixture,captureConsole,NAME,PHONE,PHONE_DIGITS,EMAIL,MEMO} from './helpers/franchise-fixture.mjs';

const logged=captureConsole();
// ── 모의 HERMES: 접수 본문을 모으고, 조회 때 mode에 따라 출력한다 ──
const hermes={bodies:[],refused:[],runs:new Map(),mode:'good',submitFail:0,seq:0};
const GOOD={subject:'{브랜드} 가맹 절차 안내',body:'{이름}님, 요청하신 가맹 절차를 안내합니다.\n정보공개서를 먼저 받으시고 충분히 검토하신 뒤 상담해 주세요.\n문의는 {담당자}에게 {문의처}로 해 주세요.'};
const outputFor=mode=>mode==='good'?JSON.stringify(GOOD):mode==='hard'?JSON.stringify({subject:'안내',body:'{이름}님, 월 순수익 500만원을 보장합니다.'}):mode==='broken'?'초안입니다(형식 없음)':'';
const fetch=async(url,init={})=>{
 if(!url.startsWith('https://hermes.example.com/'))throw new Error('모의 주소만: '+url);
 if(url.endsWith('/v1/runs')&&init.method==='POST'){if(hermes.submitFail>0){hermes.submitFail--;hermes.refused.push(String(init.body));return new Response('{}',{status:503})}const id='nr_'+ ++hermes.seq;hermes.bodies.push(String(init.body));hermes.runs.set(id,hermes.mode);return Response.json({run_id:id})}
 const id=url.split('/').pop(),mode=hermes.runs.get(id);
 if(mode==='fail')return Response.json({object:'hermes.run',run_id:id,status:'failed',error:'합성 실패',usage:{total_tokens:10}});
 return Response.json({object:'hermes.run',run_id:id,status:'completed',output:outputFor(mode),usage:{total_tokens:120,output_tokens:60},model:'mock-model'});
};
const f=await franchiseFixture({fetch});
const {sql,env,server}=f;
env.AUTH_MODE='email';env.AUTH_ORIGIN='https://agency.test';
const passed=[];const check=(name,val)=>{assert.ok(val,name);passed.push(name)};
const WS='nr-owner';
const boss=f.signIn('nr-boss','admin',1000,WS),member=f.signIn('nr-member','member',3000,WS);
await f.brand(WS,'fr-a');
await sql.prepare('INSERT INTO settings(owner,secret,model,updated_at) VALUES(?,?,?,?)').run(WS,await server.encrypt(JSON.stringify({provider:'hermes',endpoint:'https://hermes.example.com',key:'mock-only'})),'HERMES','2026-10-01T00:00:00.000Z');
const fact=(id,key,value,x={})=>server.recordStatement(WS,'brand_fact',id,{id,brandId:'fr-a',key,value,status:'confirmed',source:'합성 원장',verifiedAt:'2026-01-01T00:00:00.000Z',validUntil:'2099-12-31T00:00:00.000Z',version:1,updatedAt:'2026-01-01T00:00:00.000Z',...x},'fr-a').run();
await fact('nf-menu','signature_menu','우유 도넛');
await fact('nf-sales','monthly_sales','매월 가상매출 3,200만원');
await fact('nf-store','parking','매장 앞 2대',{storeId:'st-1'});
const reasons=r=>(r.body.reasons||[]).map(x=>x.code);
const post=(s,input)=>f.post(s,{brandId:'fr-a',...input});
check('owner turns the franchise switch on',(await f.setFlag(boss,true)).status===200);
assert.equal((await f.profile(boss,'fr-a',{},0)).status,200);
const TOKEN='가상메모토큰';
const created=await f.createLead(boss,'fr-a',{contact:{name:NAME,phone:PHONE,email:EMAIL},memo:MEMO+TOKEN,assigneeId:'nr-member'});
assert.equal(created.status,200,JSON.stringify(created.body));
const leadId=created.body.result.leadId,systemCode=f.leadRow(leadId).systemCode;
const LEAD_STRINGS=[NAME,PHONE,PHONE_DIGITS,EMAIL,MEMO,TOKEN,leadId,systemCode];

// ════ 초안 ════
let r=await post(member,{action:'nurture_draft_start',draftId:'nd-first-001',purpose:'process_guide',medium:'email'});
check('NR-1 a member starts a draft (200, queued, no provider id in the response)',r.status===200&&r.body.result.draft.status==='queued'&&!('providerId' in r.body.result.draft)&&r.body.classificationNote==='COLLECTIVE 해석 · 법률 자문 아님');
const sent=hermes.bodies[0],sub=JSON.parse(sent),input=JSON.parse(sub.input);
const reservation=sql.prepare("SELECT data FROM records WHERE kind='token_reservation' AND id=?").get(`${WS}:token_reservation:nurture-nd-first-001`);
check('NR-8 the budget reservation of the queued draft is kind nurture',!!reservation&&JSON.parse(reservation.data).kind==='nurture');
check('NR-2 the HERMES body carries only the allowed input keys and the confirmed brand fact line',JSON.stringify(Object.keys(input))==='["purpose","classification","medium","brand","facts"]'&&input.facts.some(l=>l.includes('우유 도넛'))&&input.brand.name==='가상 브랜드 fr-a');
check('NR-3 no revenue or store fact is sent',!sent.includes('가상매출')&&!sent.includes('매장 앞 2대'));
const subRow=sql.prepare("SELECT data FROM records WHERE kind='hermes_submission' AND id=?").get(`${WS}:hermes_submission:nurture-nd-first-001`)?.data??'';
check('NR-4 DP-10: no lead-derived string in the HERMES body or the stored submission',subRow.length>0&&LEAD_STRINGS.every(t=>!sent.includes(t)&&!subRow.includes(t)));
r=await post(member,{action:'nurture_draft_start',draftId:'nd-first-001',purpose:'process_guide',medium:'email'});
check('NR-5 the same draft id returns the same draft without a second HERMES call',r.status===200&&r.body.result.draft.id==='nd-first-001'&&hermes.bodies.length===1);
r=await post(member,{action:'nurture_draft_start',draftId:'nd-second-01',purpose:'process_guide',medium:'sms'});
check('NR-6 a second draft while one is active is 409',r.status===409&&hermes.bodies.length===1);
r=await post(member,{action:'nurture_draft_poll',draftId:'nd-first-001'});
check('NR-7 poll completes with the checked result',r.status===200&&r.body.result.draft.status==='completed'&&r.body.result.draft.result.body===GOOD.body&&r.body.result.draft.result.subject===GOOD.subject);
hermes.mode='hard';
await post(member,{action:'nurture_draft_start',draftId:'nd-hard-0001',purpose:'process_guide',medium:'email'});
r=await post(member,{action:'nurture_draft_poll',draftId:'nd-hard-0001'});
const hardRow=sql.prepare("SELECT data FROM records WHERE kind='franchise_nurture_draft' AND id=?").get(`${WS}:franchise_nurture_draft:nd-hard-0001`).data;
check('NR-9 a hard_block output fails with the reason code and no body is stored',r.body.result.draft.status==='failed'&&JSON.stringify(r.body.result.draft.reasons)==='["hard_block"]'&&r.body.result.draft.result===null&&!hardRow.includes('순수익'));
hermes.mode='broken';
await post(member,{action:'nurture_draft_start',draftId:'nd-broken-01',purpose:'process_guide',medium:'email'});
r=await post(member,{action:'nurture_draft_poll',draftId:'nd-broken-01'});
check('NR-10 a non-JSON output fails without a partial body',r.body.result.draft.status==='failed'&&r.body.result.draft.result===null&&!sql.prepare("SELECT data FROM records WHERE id=?").get(`${WS}:franchise_nurture_draft:nd-broken-01`).data.includes('형식 없음'));
hermes.mode='good';hermes.submitFail=1;
r=await post(member,{action:'nurture_draft_start',draftId:'nd-flaky-001',purpose:'requested_material',medium:'sms'});
check('NR-11 a 503 on submit leaves the draft uncertain (not failed)',r.status===200&&r.body.result.draft.status==='uncertain');
r=await post(member,{action:'nurture_draft_poll',draftId:'nd-flaky-001',mode:'recover'});
check('NR-12 recover resubmits the stored body and completes',r.status===200&&r.body.result.draft.status==='completed'&&hermes.bodies.at(-1)===hermes.refused[0]);
r=await post(member,{action:'nurture_draft_start',draftId:'nd-alimtalk1',purpose:'benefit',medium:'alimtalk'});
check('NR-13 advertising on alimtalk is 400 and bad ids are 400',r.status===400&&(await post(member,{action:'nurture_draft_start',draftId:'bad',purpose:'benefit',medium:'sms'})).status===400);

// ════ 템플릿 ════
r=await post(member,{action:'nurture_template_save',purpose:'process_guide',medium:'email',subject:GOOD.subject,body:GOOD.body,draftId:'nd-first-001'});
check('NR-14 a member saves a template from the completed draft (aiAssisted)',r.status===200&&r.body.result.version===1&&r.body.result.classification==='info_requested');
const T1=r.body.result.templateId;
check('NR-15 saving the same text again writes nothing',(await post(member,{action:'nurture_template_save',templateId:T1,baseVersion:1,purpose:'process_guide',medium:'email',subject:GOOD.subject,body:GOOD.body})).body.result.unchanged===true);
r=await post(member,{action:'nurture_template_save',purpose:'process_guide',medium:'email',subject:null,body:'{이름}님 010-0000-0199로 연락 주세요'});
check('NR-16 personal data in a template is 400 personal_data',r.status===400&&JSON.stringify(reasons(r))==='["personal_data"]');
r=await post(member,{action:'nurture_template_save',purpose:'process_guide',medium:'email',subject:null,body:'{이름}님, 월 순수익 500만원을 보장합니다.'});
check('NR-17 a hard_block template is 409',r.status===409&&reasons(r).includes('hard_block'));
r=await post(member,{action:'nurture_template_save',purpose:'briefing_invite',medium:'sms',subject:null,body:'(광고) {브랜드}\n{이름}님, 창업 설명회에 초대합니다.\n무료 수신거부: {수신거부}'});
check('NR-18 an advertising template with the fixed lines saves',r.status===200&&r.body.result.classification==='advertising');
const TAD=r.body.result.templateId;
check('NR-19 a draft from another state cannot be imported',(await post(member,{action:'nurture_template_save',purpose:'process_guide',medium:'email',subject:null,body:'{이름}님 안내',draftId:'nd-hard-0001'})).status===400);

// ════ 정보 요청·발송 기록 ════
const lead=()=>f.leadRow(leadId);
r=await post(member,{action:'log_lead_message',leadId,version:lead().version,templateId:T1,templateVersion:1,medium:'email'});
check('NR-20 a log without an info request is 400 request_missing',r.status===400&&JSON.stringify(reasons(r))==='["request_missing"]');
r=await post(member,{action:'add_info_request',leadId,version:lead().version,purpose:'process_guide'});
check('NR-21 the assigned member records an info request (activity moves)',r.status===200&&r.body.lead.infoRequests.length===1&&lead().lastActivityAt===lead().infoRequests[0].at);
const requestId=r.body.result.requestId;
r=await post(member,{action:'log_lead_message',leadId,version:lead().version,templateId:T1,templateVersion:1,medium:'email',infoRequestId:requestId});
check('NR-22 the log links template version, classification, medium and the request',r.status===200&&r.body.result.classification==='info_requested'&&r.body.lead.messageLogs.length===1&&r.body.lead.infoRequests[0].used===true);
r=await post(member,{action:'log_lead_message',leadId,version:lead().version,templateId:T1,templateVersion:1,medium:'email',infoRequestId:requestId});
check('NR-23 a second log for the same request is 409 request_used',r.status===409&&JSON.stringify(reasons(r))==='["request_used"]');
r=await post(member,{action:'log_lead_message',leadId,version:lead().version,templateId:TAD,templateVersion:1,medium:'sms'});
check('NR-24 an advertising log is 409 before R9b',r.status===409&&JSON.stringify(reasons(r))==='["advertising_before_r9b"]');
check('NR-25 an info request with an advertising purpose is 400',(await post(member,{action:'add_info_request',leadId,version:lead().version,purpose:'benefit'})).status===400);
const events=f.rows('franchise_lead_event',"AND parent_id=?",leadId).filter(e=>e.type==='info_requested'||e.type==='message_logged');
check('NR-26 lead events carry codes only',events.length===2&&events.every(e=>!JSON.stringify(e).includes(GOOD.body.slice(0,10))&&!LEAD_STRINGS.slice(0,6).some(t=>JSON.stringify(e).includes(t))));

// ════ 폐기·역할·스위치 ════
const other=await f.createLead(boss,'fr-a',{assigneeId:null});
check('NR-33 a member cannot record requests on an unassigned lead she can only see (403 NOT_ASSIGNED)',other.status===200&&(await post(member,{action:'add_info_request',leadId:other.body.result.leadId,version:f.leadRow(other.body.result.leadId).version,purpose:'process_guide'})).status===403);
check('NR-27 a member cannot retire a template (403)',(await post(member,{action:'nurture_template_retire',templateId:T1,version:1})).status===403);
check('NR-28 the owner retires it and it can no longer be logged',(await post(boss,{action:'nurture_template_retire',templateId:T1,version:1})).status===200&&(await post(member,{action:'add_info_request',leadId,version:lead().version,purpose:'requested_material'})).status===200
 &&reasons(await post(member,{action:'log_lead_message',leadId,version:lead().version,templateId:T1,templateVersion:1,medium:'email',infoRequestId:lead().infoRequests[1].id})).includes('invalid_input'));
check('NR-29 switch off: draft start and template save are 409, retire still works',(await f.setFlag(boss,false)).status===200&&(await post(member,{action:'nurture_draft_start',draftId:'nd-off-00001',purpose:'process_guide',medium:'email'})).status===409
 &&(await post(member,{action:'nurture_template_save',purpose:'process_guide',medium:'email',subject:null,body:'{이름}님 안내'})).status===409&&(await post(boss,{action:'nurture_template_retire',templateId:TAD,version:1})).status===200);
await f.setFlag(boss,true);

// ════ 보기·감사·경계 ════
const view=await f.get(member,'view=nurture&brandId=fr-a');
check('NR-30 the nurture view lists templates, drafts, purposes and media without provider ids',view.status===200&&view.body.templates.length===2&&view.body.drafts.length>=4&&view.body.drafts.every(d=>!('providerId' in d))&&view.body.purposes.length===7&&view.body.media.length===3);
const audit=sql.prepare("SELECT data FROM records WHERE kind='franchise_audit'").all().map(x=>x.data).join('\n');
check('NR-31 audit rows carry no template text or lead values',!audit.includes('가맹 절차를 안내')&&LEAD_STRINGS.slice(0,6).every(t=>!audit.includes(t)));
check('NR-32 only HERMES was called (no send API) and no lead string reached the console',f.calls.every(u=>u.startsWith('https://hermes.example.com/'))&&!logged.some(l=>LEAD_STRINGS.some(t=>l.includes(t))));

console.log(JSON.stringify({passed:passed.length}));
