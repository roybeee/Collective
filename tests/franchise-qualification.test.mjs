// 트랙 R 대표 결정 35 적격 판정 기록(/api/franchise 작업 qualify_lead, 보드 필터·열, 리드 상세 이력, 주간 보고 코호트 적격 수·적격 리드당 비용). 사례 번호 QL-*는 PR 본문 수용 기준과 같다.
// 확인: 순수 판정(QL-P), 권한(대표·관리자·담당 직원만, QL-R), 추가 전용 이력(QL-H), 입력 거부(사유 코드만·기준 버전·바뀐 것 없음·한도, QL-V), 스위치·잠금·재생(QL-S),
// 마지막 활동 불변과 감사(QL-A), 보드 필터·열(QL-B), 리드 상세(QL-D), 주간 보고 코호트(QL-Q), 값 누출 없음(QL-X).
// 근거: mocked(메모리 SQLite node:sqlite, 이메일 모드 세션 주입, 외부 fetch는 던지는 스텁, 시계 이동 Date). 운영 real 확인은 not_run(미게시).
import assert from 'node:assert/strict';
import {franchiseFixture,captureConsole,DAY,DISCLAIMER,plain} from './helpers/franchise-fixture.mjs';

const logged=captureConsole();
const f=await franchiseFixture();
const {sql,env}=f;
env.AUTH_MODE='email';env.AUTH_ORIGIN='https://agency.test';
const passed=[];const check=(name,val)=>{assert.ok(val,name);passed.push(name)};
const setNow=ms=>f.clock.set(ms-Date.now());
setNow(Date.parse('2026-09-30T03:00:00Z')); // 2026-W40 수요일 12:00 KST
const lib=f.lib,E=plain(lib.FRANCHISE_ERRORS),T=k=>E[k]?.text;
const WS='ql-owner';
const boss=f.signIn('ql-boss','admin',1000,WS),admin=f.signIn('ql-admin','admin',2000,WS),memberA=f.signIn('ql-member-a','member',3000,WS),memberB=f.signIn('ql-member-b','member',4000,WS);
for(const b of ['ql-a','ql-b'])await f.brand(WS,b);
const post=(s,input)=>f.post(s,input),get=(s,q)=>f.get(s,q);
const v=id=>f.leadRow(id).version;
const events=(id,type)=>f.rows('franchise_lead_event',"AND parent_id=? AND json_extract(data,'$.type')=?",id,type);
const audits=action=>f.rows('franchise_audit',"AND json_extract(data,'$.action')=?",action);
const fixed=(r,status,key)=>r.status===status&&r.body.error===T(key);
const judge=(s,leadId,verdict,reason,x={})=>post(s,{action:'qualify_lead',brandId:'ql-a',leadId,version:v(leadId),verdict,reason,criteriaVersion:1,...x});

// ════ QL-P 순수 판정 ════
check('QL-P1 three verdicts with Korean labels: qualified, hold, rejected',JSON.stringify(plain(lib.QUALIFICATION_VERDICT_LABELS))===JSON.stringify({qualified:'적격',hold:'보류',rejected:'거절'})&&lib.QUALIFICATION_VERDICTS.length===3);
check('QL-P1 every verdict has its own reason codes, each with a label, all matching the approval reason pattern',lib.QUALIFICATION_VERDICTS.every(x=>lib.QUALIFICATION_REASONS_BY_VERDICT[x].length>0&&lib.QUALIFICATION_REASONS_BY_VERDICT[x].every(r=>typeof lib.QUALIFICATION_REASON_LABELS[r]==='string'&&/^[a-z][a-z0-9_]{2,63}$/.test(r))));
check('QL-P1 a reason is accepted only with its verdict',lib.qualificationReasonOk('qualified','criteria_met')&&!lib.qualificationReasonOk('qualified','budget_short')&&lib.qualificationReasonOk('rejected','budget_short')&&!lib.qualificationReasonOk('hold','criteria_met')&&!lib.qualificationReasonOk('nope','criteria_met')&&!lib.qualificationReasonOk('qualified',undefined));
{
 const q=(verdict,at)=>({verdict,reason:'other',criteriaVersion:1,score:null,at,by:{id:'x',role:'owner'}});
 const lead={qualifications:[q('hold','2026-09-01T00:00:00Z'),q('qualified','2026-09-10T00:00:00Z')]};
 check('QL-P2 the current judgment is the last one, and the last one at or before asOf when asOf is given',lib.currentQualification(lead)?.verdict==='qualified'&&lib.currentQualification(lead,'2026-09-05T00:00:00Z')?.verdict==='hold'&&lib.currentQualification(lead,'2026-08-01T00:00:00Z')===null&&lib.currentQualification({})===null);
}
{
 const who={id:'m',role:'member'},own={assigneeId:'m',stage:'inquiry',basis:{type:'inquiry_response'},marketing:{status:'none'},contactState:'present'};
 check('QL-P3 the lead action list offers qualify_lead to the assigned member and admins, not to others, not when the switch is off or the contact is gone',
  lib.leadActions(who,own,true).includes('qualify_lead')&&!lib.leadActions(who,{...own,assigneeId:null},true).includes('qualify_lead')&&lib.leadActions({id:'a',role:'admin'},{...own,assigneeId:null},true).includes('qualify_lead')
  &&!lib.leadActions(who,own,false).includes('qualify_lead')&&!lib.leadActions(who,{...own,contactState:'purged'},true).includes('qualify_lead'));
}

// ── 준비 ──
check('owner turns the switch on',(await f.setFlag(boss,true)).status===200);
let r=await f.profile(boss,'ql-a',{},0);
check('setup: a branch A profile without criteria',r.status===200);
const created=[];
const lead=async(s,extra={})=>{const x=await f.createLead(s,'ql-a',extra);assert.equal(x.status,200,JSON.stringify(x.body));created.push(x.body.result.leadId);return x.body.result.leadId};
const own=await lead(memberA),other=await lead(memberB),un=await lead(boss,{assigneeId:null}),adminLead=await lead(boss);

// ════ QL-V 기준 없음 ════
r=await judge(boss,adminLead,'qualified','criteria_met');
check('QL-V1 without eligibility criteria a judgment is 409 with the fixed text and nothing is written',fixed(r,409,'QUALIFICATION_NO_CRITERIA')&&!f.leadRow(adminLead).qualifications&&!events(adminLead,'qualification_recorded').length);
r=await f.profile(boss,'ql-a',{eligibility:{budgetBands:['100m_150m'],regions:['서울 강남구'],timingBands:['within_3m']}},1);
check('setup: criteria version 1 is saved',r.status===200&&(await get(boss,'view=settings&brandId=ql-a')).body.profile.eligibility.version===1);

// ════ QL-R 권한 ════
const before=f.leadRow(own).lastActivityAt;
r=await judge(memberA,own,'qualified','criteria_met');
check('QL-R1 the assigned member records a judgment on their own lead',r.status===200&&r.body.result.verdict==='qualified'&&r.body.result.reason==='criteria_met'&&r.body.result.criteriaVersion===1&&r.body.lead.qualification.verdict==='qualified');
r=await judge(memberA,un,'hold','budget_unconfirmed');
check('QL-R2 a member cannot judge an unassigned lead (claim first)',fixed(r,403,'NOT_ASSIGNED')&&!f.leadRow(un).qualifications);
r=await judge(memberA,other,'rejected','budget_short');
check('QL-R3 a member cannot judge another member\'s lead',r.status===403&&!f.leadRow(other).qualifications);
r=await judge(admin,other,'rejected','budget_short');
check('QL-R4 an admin judges any lead of the brand, including another member\'s',r.status===200&&f.leadRow(other).qualifications.length===1);
r=await judge(boss,un,'hold','awaiting_reply');
check('QL-R4 the owner judges an unassigned lead',r.status===200);
r=await post(boss,{action:'qualify_lead',brandId:'ql-b',leadId:own,version:v(own),verdict:'qualified',reason:'criteria_met',criteriaVersion:1});
check('QL-R5 a lead of another brand is not found through this brand',r.status===404||r.status===409||r.status===400);

// ════ QL-A 마지막 활동·이벤트·감사 ════
{
 const row=f.leadRow(own),ev=events(own,'qualification_recorded'),au=audits('qualification').filter(a=>a.leadId===own);
 check('QL-A1 the judgment is stored on the lead with verdict, reason, criteria version, score, time and actor',row.qualifications.length===1&&row.qualifications[0].verdict==='qualified'&&row.qualifications[0].reason==='criteria_met'&&row.qualifications[0].criteriaVersion===1&&row.qualifications[0].score?.total===4&&row.qualifications[0].by.id==='ql-member-a'&&row.qualifications[0].by.role==='member');
 check('QL-A2 judging is not prospect activity: last activity and retention stay, the version goes up',row.lastActivityAt===before&&row.version===2);
 check('QL-A3 one event with the verdict, reason code and criteria version, and one audit row with the same codes',ev.length===1&&ev[0].qualification?.verdict==='qualified'&&ev[0].qualification?.reason==='criteria_met'&&ev[0].qualification?.criteriaVersion===1&&au.length===1&&au[0].qualification?.reason==='criteria_met'&&au[0].actor.id==='ql-member-a');
}

// ════ QL-H 이력 ════
r=await judge(memberA,own,'hold','timing_unconfirmed');
check('QL-H1 changing the judgment appends; the earlier judgment stays',r.status===200&&f.leadRow(own).qualifications.length===2&&f.leadRow(own).qualifications[0].verdict==='qualified'&&f.leadRow(own).qualifications[1].verdict==='hold');
check('QL-H1 each change is its own event and audit row',events(own,'qualification_recorded').length===2&&audits('qualification').filter(a=>a.leadId===own).length===2);
r=await judge(memberA,own,'hold','timing_unconfirmed');
check('QL-H2 the same verdict, reason and criteria version again is a 400 with no write',r.status===400&&f.leadRow(own).qualifications.length===2);
r=await judge(memberA,own,'hold','region_review');
check('QL-H2 the same verdict with another reason is a change',r.status===200&&f.leadRow(own).qualifications.length===3);

// ════ QL-V 입력 거부 ════
const vBefore=v(own);
r=await judge(memberA,own,'qualified','budget_short');
check('QL-V2 a reason code of another verdict is a 400 with the fixed text',fixed(r,400,'QUALIFICATION_REASON'));
r=await judge(memberA,own,'maybe','criteria_met');
check('QL-V2 an unknown verdict is a 400',r.status===400);
r=await judge(memberA,own,'rejected','예산이 너무 적음');
check('QL-V3 free text in the reason is refused (codes only)',fixed(r,400,'QUALIFICATION_REASON'));
const NOTE_TOKEN='가상판정메모토큰';
r=await judge(memberA,own,'rejected','budget_short',{note:NOTE_TOKEN});
check('QL-V3 any free-text field next to the codes is refused with the fixed text',fixed(r,400,'QUALIFICATION_TEXT'));
check('QL-V3 the refused free text is stored nowhere',!sql.prepare("SELECT data FROM records").all().some(x=>String(x.data).includes(NOTE_TOKEN)));
r=await judge(memberA,own,'rejected','budget_short',{criteriaVersion:2});
check('QL-V4 a criteria version other than the current one is a 409 (the criteria changed after the screen loaded)',fixed(r,409,'QUALIFICATION_CRITERIA_CHANGED'));
r=await judge(memberA,own,'rejected','budget_short',{criteriaVersion:undefined});
check('QL-V4 a judgment without the criteria version is refused',r.status===409||r.status===400);
r=await judge(memberA,own,'rejected','budget_short',{version:vBefore-1});
check('QL-V5 a stale lead version is a 409 STALE',fixed(r,409,'STALE'));
check('QL-V refusals wrote nothing',v(own)===vBefore&&f.leadRow(own).qualifications.length===3);

// ════ QL-S 스위치·재생 ════
{
 const rid='ql-replay-0001';
 const a=await post(memberA,{action:'qualify_lead',brandId:'ql-a',leadId:own,version:v(own),verdict:'rejected',reason:'budget_short',criteriaVersion:1,requestId:rid});
 const b=await post(memberA,{action:'qualify_lead',brandId:'ql-a',leadId:own,version:v(own)-1,verdict:'rejected',reason:'budget_short',criteriaVersion:1,requestId:rid});
 check('QL-S1 the same request id replays the result without a second judgment',a.status===200&&b.status===200&&b.body.replayed===true&&f.leadRow(own).qualifications.length===4&&events(own,'qualification_recorded').length===4);
}
check('owner turns the switch off',(await f.setFlag(boss,false)).status===200);
r=await judge(boss,adminLead,'qualified','criteria_met');
check('QL-S2 with the switch off a judgment is 409 OFF',fixed(r,409,'OFF'));
r=await get(boss,`view=lead&brandId=ql-a&leadId=${own}`);
check('QL-S2 with the switch off the lead still shows its judgment and history, without the action',r.status===200&&r.body.qualification.verdict==='rejected'&&r.body.qualifications.length===4&&!r.body.allowedActions.includes('qualify_lead'));
check('owner turns the switch back on',(await f.setFlag(boss,true)).status===200);

// ════ QL-D 리드 상세 ════
r=await get(memberA,`view=lead&brandId=ql-a&leadId=${own}`);
{
 const d=r.body;
 check('QL-D1 the detail carries the current judgment, the criteria version in force and the full history newest first',r.status===200&&d.criteriaVersion===1&&d.qualification.verdict==='rejected'&&d.qualification.current===true&&d.qualifications.length===4&&d.qualifications[0].verdict==='rejected'&&d.qualifications[3].verdict==='qualified'&&d.qualifications.every(q=>q.by&&q.by.id&&q.by.role));
 check('QL-D1 the detail offers qualify_lead to the assigned member',d.allowedActions.includes('qualify_lead'));
 check('QL-D2 the timeline shows the judgment events',d.events.filter(e=>e.type==='qualification_recorded').length===4&&d.events.find(e=>e.type==='qualification_recorded').qualification.verdict==='rejected');
}
r=await f.profile(boss,'ql-a',{eligibility:{budgetBands:['100m_150m','150m_200m'],regions:['서울 강남구'],timingBands:['within_3m']}},2);
check('setup: criteria version 2 is saved',r.status===200);
r=await get(memberA,`view=lead&brandId=ql-a&leadId=${own}`);
check('QL-D3 after the criteria change the judgment is marked as made under an earlier version',r.body.criteriaVersion===2&&r.body.qualification.criteriaVersion===1&&r.body.qualification.current===false);
r=await judge(memberA,own,'rejected','budget_short',{criteriaVersion:2});
check('QL-D3 the same verdict under the new criteria version is a new judgment',r.status===200&&f.leadRow(own).qualifications.length===5&&f.leadRow(own).qualifications[4].criteriaVersion===2);

// ════ QL-B 보드 필터·열 ════
r=await get(boss,'view=board&brandId=ql-a');
{
 const byId=Object.fromEntries(r.body.leads.map(l=>[l.id,l]));
 check('QL-B1 every board row carries its current judgment or null',r.status===200&&byId[own].qualification.verdict==='rejected'&&byId[other].qualification.verdict==='rejected'&&byId[un].qualification.verdict==='hold'&&byId[adminLead].qualification===null);
}
const ids=async q=>(await get(boss,'view=board&brandId=ql-a&qualification='+q)).body.leads.map(l=>l.id).sort();
check('QL-B2 the qualification filter keeps the matching leads (none = never judged)',JSON.stringify(await ids('rejected'))===JSON.stringify([own,other].sort())&&JSON.stringify(await ids('hold'))===JSON.stringify([un])&&JSON.stringify(await ids('none'))===JSON.stringify([adminLead])&&(await ids('qualified')).length===0);
r=await get(boss,'view=board&brandId=ql-a&qualification=maybe');
check('QL-B2 an unknown qualification filter is a 400',r.status===400);
r=await get(memberA,'view=board&brandId=ql-a&qualification=rejected');
check('QL-B3 a member\'s filtered board still holds only visible leads',r.status===200&&r.body.leads.every(l=>l.id!==other)&&r.body.leads.some(l=>l.id===own));

// ════ QL-V 한도·삭제된 연락처 ════
{
 const row=f.leadRow(adminLead),hist=Array.from({length:lib.QUALIFICATION_LIMIT},(_,i)=>({verdict:i%2?'hold':'qualified',reason:i%2?'awaiting_reply':'criteria_met',criteriaVersion:2,score:null,at:new Date(Date.parse('2026-09-01T00:00:00Z')+i*60000).toISOString(),by:{id:'ql-boss',role:'owner'}}));
 sql.prepare('UPDATE records SET data=? WHERE id=?').run(JSON.stringify({...row,qualifications:hist}),`${WS}:franchise_lead:${adminLead}`);
 r=await post(boss,{action:'qualify_lead',brandId:'ql-a',leadId:adminLead,version:row.version,verdict:'rejected',reason:'no_intent',criteriaVersion:2});
 check('QL-V6 after the history limit a judgment is a 409 LIMIT',fixed(r,409,'LIMIT'));
 sql.prepare('UPDATE records SET data=? WHERE id=?').run(JSON.stringify(row),`${WS}:franchise_lead:${adminLead}`);
}
r=await post(boss,{action:'erase_lead',brandId:'ql-a',leadId:un});
check('setup: an erased lead',r.status===200);
r=await post(boss,{action:'qualify_lead',brandId:'ql-a',leadId:un,version:v(un),verdict:'rejected',reason:'no_intent',criteriaVersion:2});
check('QL-V7 a lead whose contact is erased cannot be judged (LEAD_ERASED)',fixed(r,409,'LEAD_ERASED'));

// ════ QL-Q 주간 보고 코호트 ════
r=await get(memberA,'view=report&brandId=ql-a&week=2026-W40');
{
 const k=r.body.preview.cohorts.find(c=>c.month==='2026-09');
 check('QL-Q1 the report counts the current judgments of the receipt-month cohort (1~4 suppressed) with the cost per qualified lead',r.status===200&&k.qualification&&k.qualification.rejected.suppressed===true&&k.qualification.qualified.n===0&&k.qualification.hold.suppressed===true&&k.qualification.unjudged.suppressed===true&&k.qualification.costPerQualified.state==='no_spend');
 check('QL-Q1 the report carries no lead id or reason code',!created.some(id=>JSON.stringify(r.body).includes(id))&&!/budget_short|timing_unconfirmed|criteria_met/.test(JSON.stringify(r.body)));
}

// ════ QL-X 값 누출 없음 ════
check('QL-X1 console output holds no free text',!logged.some(x=>x.includes(NOTE_TOKEN)));
check('QL-X1 the disclaimer is on the lead view',(await get(boss,`view=lead&brandId=ql-a&leadId=${own}`)).body.disclaimer===DISCLAIMER);
check('no external call was made',f.calls.length===0);

const IDS=['QL-P1','QL-P2','QL-P3','QL-V1','QL-V2','QL-V3','QL-V4','QL-V5','QL-V6','QL-V7','QL-R1','QL-R2','QL-R3','QL-R4','QL-R5','QL-A1','QL-A2','QL-A3','QL-H1','QL-H2','QL-S1','QL-S2','QL-D1','QL-D2','QL-D3','QL-B1','QL-B2','QL-B3','QL-Q1','QL-X1'];
const missing=IDS.filter(id=>!passed.some(n=>n.startsWith(id+' ')));
assert.deepEqual(missing,[],'이름에 없는 사례 번호: '+missing.join(', '));passed.push(`every qualification case id (${IDS.length}) has a named check`);
void DAY;
console.log(JSON.stringify({passed:passed.length}));
