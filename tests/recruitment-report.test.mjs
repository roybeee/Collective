// 트랙 R R6b 모집 보고·증빙 묶음 경로 스위트(/api/franchise GET report, 작업 report_freeze·report_export·evidence_export). 사례 번호 RP-*는 R6b PR 본문 수용 기준과 같다.
// 확인: 보고 보기(모든 역할, 집계만, 스위치가 꺼져도 읽기), 확정(대표·관리자, 끝난 주만, 확인 값 대조 409, 판 이력), 내려받기(확정본만, 감사, 재생),
// 리드별·소재별 증빙 묶음(대표·관리자, 감사, 같은 입력 같은 해시, 연락처 원문 없음), 새 kind recruitment_report, 외부·모델 호출 0.
// 근거: mocked(메모리 SQLite node:sqlite, 이메일 모드 세션 주입, 외부 fetch는 던지는 스텁, 시계 이동 Date). 운영 real 확인은 not_run(미게시).
import assert from 'node:assert/strict';
import {franchiseFixture,captureConsole,HOUR,DAY,DISCLAIMER,plain,sha64,NAME,PHONE_DIGITS,EMAIL,MEMO} from './helpers/franchise-fixture.mjs';

const logged=captureConsole();
const f=await franchiseFixture();
const {sql,env,server}=f;
env.AUTH_MODE='email';env.AUTH_ORIGIN='https://agency.test';
const passed=[];const check=(name,val)=>{assert.ok(val,name);passed.push(name)};
const setNow=ms=>f.clock.set(ms-Date.now());
const ago=ms=>new Date(f.clock.now()-ms).toISOString();
setNow(Date.parse('2026-09-30T03:00:00Z')); // 2026-W40(09-28 ~ 10-04) 수요일 12:00 KST
const rep=await f.load('lib/franchise-report.ts'),rec=await f.load('lib/franchise-recruitment.ts');
const E=plain(f.lib.FRANCHISE_ERRORS),T=k=>E[k]?.text;
const WS='rp-owner';
const boss=f.signIn('rp-boss','admin',1000,WS),admin=f.signIn('rp-admin','admin',2000,WS),member=f.signIn('rp-member','member',3000,WS);
for(const b of ['fr-a','fr-b'])await f.brand(WS,b);
const post=(s,input)=>f.post(s,input),get=(s,q)=>f.get(s,q);
const audits=action=>sql.prepare("SELECT data FROM records WHERE kind='franchise_audit' AND json_extract(data,'$.action')=?").all(action).map(r=>JSON.parse(r.data));
const reportRow=id=>{const r=sql.prepare("SELECT data FROM records WHERE kind='recruitment_report' AND id=?").get(`${WS}:recruitment_report:${id}`);return r?JSON.parse(r.data):null};
const countKind=kind=>Number(sql.prepare('SELECT COUNT(*) n FROM records WHERE kind=?').get(kind).n);
const snapshot=()=>sql.prepare("SELECT id,data FROM records WHERE kind LIKE 'recruitment_%' OR kind LIKE 'franchise_%' ORDER BY id").all().map(r=>r.id+'\t'+r.data).join('\n');
const fixed=(r,status,key)=>r.status===status&&r.body.error===T(key);
const v=id=>f.leadRow(id).version;

// ── 준비: 스위치·프로필·정보공개서·계약서안·캠페인·자료·코드·비용·리드 ──
check('owner turns the franchise switch on',(await f.setFlag(boss,true)).status===200);
for(const b of ['fr-a','fr-b']){const r=await f.profile(boss,b,{storageLabels:['본사 문서함']},0);assert.equal(r.status,200,JSON.stringify(r.body))}
let r=await post(boss,{action:'register_disclosure_version',brandId:'fr-a',label:'가상 정보공개서 1판',sha256:sha64('rp-dv'),registeredAt:ago(60*DAY),validFrom:ago(90*DAY),validUntil:new Date(f.clock.now()+300*DAY).toISOString(),storageLabel:'본사 문서함'});
const DV=r.body.result.id;
r=await post(boss,{action:'register_contract_template',brandId:'fr-a',label:'가상 계약서안',sha256:sha64('rp-ct'),checkedItems:[1,2,3,4,5,6,7,8,9,10,11,12,13],storageLabel:'본사 문서함'});
const CT=r.body.result.id;
await server.recordStatement(WS,'campaign','ca-a',{id:'ca-a',brandId:'fr-a',title:'가상 모집 캠페인',status:'approved',objective:'franchise_recruitment',version:1,createdAt:'2026-09-01T00:00:00.000Z',updatedAt:'2026-09-01T00:00:00.000Z'},'fr-a').run();
const BODY_TOKEN='가상자료본문토큰';
const assetRow=(id,version,x={})=>sql.prepare('INSERT INTO records(id,owner,kind,parent_id,data,updated_at) VALUES(?,?,?,?,?,?)').run(`${WS}:recruitment_asset:${id}:${version}`,WS,'recruitment_asset','fr-a',JSON.stringify({id,version,brandId:'fr-a',campaignId:'ca-a',type:'portal_intro',body:BODY_TOKEN+' '+version,bodyHash:sha64(BODY_TOKEN+version),factRefs:[],disclosureVersionId:null,status:'approved',approval:{by:'rp-boss',role:'owner',at:'2026-09-20T00:00:00.000Z',bodyHash:sha64(BODY_TOKEN+version),checklist:{version:'c1',checked:[]}},placements:[],exports:[],review:{needed:false,reasons:[],at:null},createdAt:'2026-09-20T00:00:00.000Z',updatedAt:'2026-09-20T00:00:00.000Z',...x}),'2026-09-20T00:00:00.000Z');
assetRow('ra-1',1,{status:'retired'});assetRow('ra-1',2);
r=await post(boss,{action:'code_issue',brandId:'fr-a',channel:'portal',label:'가상 포털 소개',assetRef:{id:'ra-1',version:2},campaignId:'ca-a',validFrom:'2026-09-01'});
assert.equal(r.status,200,JSON.stringify(r.body));
const CODE=r.body.result.code;
r=await post(boss,{action:'spend_record',brandId:'fr-a',channel:'portal',period:{from:'2026-09-28',to:'2026-09-29'},amount:300000,vat:'excluded',funding:'hq_budget',evidence:'관리 화면 소진 내역',assetRef:{id:'ra-1',version:2},platform:{impressions:5000,clicks:120,formSubmits:9}});
assert.equal(r.status,200,JSON.stringify(r.body));
const leads=[];
for(let i=0;i<6;i++){const c=await f.createLead(i<4?boss:member,'fr-a',{codes:[CODE]});assert.equal(c.status,200,JSON.stringify(c.body));leads.push(c.body.result.leadId)}
const other=(await f.createLead(boss,'fr-b')).body.result.leadId;
// 계약 리드 하나: 30일 전 3종 제공 → 1시간 전 계약
const EL=t=>({electronic:{channel:'email',receivedAt:t,printable:true}});
const past=ago(30*DAY);
for(const doc of ['disclosure','nearby','draft']){const d=await post(boss,{action:'record_delivery',brandId:'fr-a',leadId:leads[0],version:v(leads[0]),doc,method:'electronic',deliveredAt:past,evidence:EL(past),...(doc==='disclosure'?{versionId:DV}:{}),...(doc==='draft'?{templateId:CT}:{}),backdateReason:'after_the_fact_entry',storageLabel:'본사 문서함'});assert.equal(d.status,200,JSON.stringify(d.body))}
r=await post(boss,{action:'record_contract',brandId:'fr-a',leadId:leads[0],version:v(leads[0]),signedAt:ago(HOUR),backdateReason:'after_the_fact_entry'});
assert.equal(r.status,200,JSON.stringify(r.body));
// 서버 거부 시도 하나(대기기간 전 계약)
r=await post(boss,{action:'record_contract',brandId:'fr-a',leadId:leads[1],version:v(leads[1]),signedAt:ago(HOUR),backdateReason:'after_the_fact_entry'});
check('setup: a contract without deliveries is refused by the gate',r.status===409||r.status===400);

// ════ RP-V 보기 ════
r=await get(member,'view=report&brandId=fr-a&week=2026-W40');
const pv=r.body.preview;
check('RP-V1 any role (member) reads the aggregate report with notes first and the disclaimer',r.status===200&&pv.schema==='collective.recruitment-report.v1'&&pv.notes[0]===rec.RECRUITMENT_ATTRIBUTION_NOTE&&pv.disclaimer===DISCLAIMER&&r.body.disclaimer===DISCLAIMER);
check('RP-V1 the preview counts every lead of the brand (not only the member\'s own) and nothing of the other brand',pv.inflow.total.n===6&&pv.inflow.code.n===6&&pv.excluded.otherBrand===0);
check('RP-V1 the channel cost uses the spend in the week and hides the CPL under twenty leads',pv.cost.channels.find(c=>c.key==='portal').spend===300000&&pv.cost.channels.find(c=>c.key==='portal').cpl.state==='small_sample');
check('RP-V1 the contract, the refused attempt and the evidence completeness reach the gate section',same(pv.gates.contractsInWeek,{n:null,suppressed:true})&&pv.gates.blockedAttempts>=1&&same(pv.gates.evidenceComplete,{n:null,suppressed:true}));
check('RP-V1 the digest is the SHA-256 of the digest source, the week is open and nothing is frozen',/^[0-9a-f]{64}$/.test(r.body.digest)&&r.body.digest===sha64(rep.reportDigestSource(pv))&&r.body.closed===false&&r.body.frozen===null&&r.body.week==='2026-W40');
function same(a,b){return JSON.stringify(plain(a))===JSON.stringify(b)}
const noLead=JSON.stringify(r.body);
check('RP-V2 the report view carries no lead id, system code, contact or recruitment code',leads.every(id=>!noLead.includes(id))&&!noLead.includes(CODE)&&!noLead.includes(NAME)&&leads.every(id=>!noLead.includes(f.leadRow(id).systemCode)));
r=await get(boss,'view=report&brandId=fr-a');
check('RP-V3 without a week the current KST week is used',r.status===200&&r.body.week==='2026-W40');
for(const w of ['2026-W00','x','2026-W41'])check(`RP-V3 an unknown or future week ${w} is 400`,fixed(await get(boss,`view=report&brandId=fr-a&week=${w}`),400,w==='2026-W41'?'REPORT_WEEK_FUTURE':'REPORT_WEEK'));

// ════ RP-F 확정 ════
let pre=await get(boss,'view=report&brandId=fr-a&week=2026-W40');
r=await post(boss,{action:'report_freeze',brandId:'fr-a',week:'2026-W40',confirmed:true,expected:{digest:pre.body.digest}});
check('RP-F1 an open week cannot be frozen (400)',fixed(r,400,'REPORT_WEEK_OPEN')&&countKind('recruitment_report')===0);
setNow(Date.parse('2026-10-06T03:00:00Z')); // 2026-W41 화요일
pre=await get(boss,'view=report&brandId=fr-a&week=2026-W40');
check('RP-F1 after the week ends the view says closed',pre.status===200&&pre.body.closed===true);
r=await post(member,{action:'report_freeze',brandId:'fr-a',week:'2026-W40',confirmed:true,expected:{digest:pre.body.digest}});
check('RP-F2 a member cannot freeze (403)',fixed(r,403,'ADMIN_ONLY'));
for(const bad of [{},{confirmed:true},{expected:{digest:pre.body.digest}},{confirmed:true,expected:{digest:'x'}}]){
 const x=await post(boss,{action:'report_freeze',brandId:'fr-a',week:'2026-W40',...bad});
 check(`RP-F3 freeze without confirmation and a digest is 400 or a mismatch 409 (${Object.keys(bad).join('+')||'none'})`,bad.expected?.digest==='x'?fixed(x,409,'REPORT_CHANGED'):fixed(x,400,'REPORT_CONFIRM'));
}
// 확인 뒤 원장이 바뀌면 409
const stalePre=pre.body.digest;
await post(boss,{action:'move_stage',brandId:'fr-a',leadId:leads[2],version:v(leads[2]),to:'contacted'});
let snap=snapshot();
r=await post(boss,{action:'report_freeze',brandId:'fr-a',week:'2026-W40',confirmed:true,expected:{digest:stalePre}});
check('RP-F4 when the ledger changed after the preview the freeze is 409 REPORT_CHANGED and writes nothing',fixed(r,409,'REPORT_CHANGED')&&snapshot()===snap);
pre=await get(boss,'view=report&brandId=fr-a&week=2026-W40');
const RID='rp-freeze-0001';
r=await post(boss,{action:'report_freeze',brandId:'fr-a',week:'2026-W40',confirmed:true,expected:{digest:pre.body.digest},requestId:RID});
const row1=reportRow('fr-a:2026-W40');
check('RP-F5 an owner freezes a closed week: one row with version 1, the digest, the report and the freezer',r.status===200&&r.body.result.version===1&&r.body.result.digest===pre.body.digest&&!!row1&&row1.version===1&&row1.digest===pre.body.digest&&row1.report.period.week==='2026-W40'&&row1.frozenBy.id==='rp-boss'&&row1.history.length===0&&row1.brandId==='fr-a');
check('RP-F5 the frozen report keeps only aggregates (no lead id, contact or code)',leads.every(id=>!JSON.stringify(row1).includes(id))&&!JSON.stringify(row1).includes(CODE)&&!JSON.stringify(row1).includes(NAME));
check('RP-F5 one receipt audit with the week and version, no report body',audits('report_freeze').length===1&&audits('report_freeze')[0].recordId==='2026-W40'&&audits('report_freeze')[0].reportVersion===1&&!('report' in audits('report_freeze')[0]));
const again=await post(boss,{action:'report_freeze',brandId:'fr-a',week:'2026-W40',confirmed:true,expected:{digest:pre.body.digest},requestId:RID});
check('RP-F5 the same request id replays without a new version',again.status===200&&again.body.replayed===true&&reportRow('fr-a:2026-W40').version===1&&audits('report_freeze').length===1);
let view=await get(boss,'view=report&brandId=fr-a&week=2026-W40');
check('RP-F6 the view shows the frozen version unchanged since the freeze',view.body.frozen&&view.body.frozen.version===1&&view.body.frozen.digest===row1.digest&&view.body.frozen.changedSinceFreeze===false&&view.body.frozen.frozenBy.id==='rp-boss');
await post(boss,{action:'move_stage',brandId:'fr-a',leadId:leads[3],version:v(leads[3]),to:'contacted'});
view=await get(boss,'view=report&brandId=fr-a&week=2026-W40');
check('RP-F6 a later ledger change shows as changed since the freeze without touching the frozen row',view.body.frozen.changedSinceFreeze===true&&reportRow('fr-a:2026-W40').digest===row1.digest);
r=await post(admin,{action:'report_freeze',brandId:'fr-a',week:'2026-W40',confirmed:true,expected:{digest:view.body.digest}});
const row2=reportRow('fr-a:2026-W40');
check('RP-F7 freezing again adds version 2 and keeps version 1 in the history',r.status===200&&row2.version===2&&row2.history.length===1&&row2.history[0].version===1&&row2.history[0].digest===row1.digest&&row2.frozenBy.id==='rp-admin');
await f.setFlag(boss,false);
r=await post(boss,{action:'report_freeze',brandId:'fr-a',week:'2026-W40',confirmed:true,expected:{digest:view.body.digest}});
check('RP-F8 with the switch off freezing is 409 OFF',fixed(r,409,'OFF'));
view=await get(member,'view=report&brandId=fr-a&week=2026-W40');
check('RP-F8 with the switch off the report still reads (enabled false)',view.status===200&&view.body.enabled===false&&view.body.frozen.version===2);

// ════ RP-E 내려받기(스위치가 꺼져도 된다) ════
const EXP=(x={})=>({action:'report_export',brandId:'fr-a',week:'2026-W40',format:'md',...x});
r=await post(member,EXP());
check('RP-E1 a member cannot download (403)',fixed(r,403,'ADMIN_ONLY'));
r=await post(boss,EXP());
check('RP-E1 an owner downloads the frozen Markdown with the switch off: body, file name, SHA-256',r.status===200&&r.body.body===rep.reportMarkdown(row2.report)&&r.body.fileName==='recruitment-report-fr-a-2026-W40.md'&&r.body.sha256===sha64(r.body.body)&&/text\/markdown/.test(r.body.contentType)&&r.body.disclaimer===DISCLAIMER);
check('RP-E1 one export audit with the week, version, format and the file hash (no body)',audits('report_export').length===1&&audits('report_export')[0].recordId==='2026-W40'&&audits('report_export')[0].reportVersion===2&&audits('report_export')[0].format==='md'&&audits('report_export')[0].bundleSha256===r.body.sha256&&!JSON.stringify(audits('report_export')[0]).includes('# 가맹 모집'));
r=await post(boss,EXP({format:'csv',version:1}));
check('RP-E2 an earlier version and CSV can be downloaded',r.status===200&&r.body.body===rep.reportCsv(row1.report)&&r.body.fileName.endsWith('.csv'));
r=await post(boss,EXP({format:'json'}));
check('RP-E2 JSON is the frozen report itself',r.status===200&&same(JSON.parse(r.body.body),plain(row2.report)));
check('RP-E3 a week without a frozen report or an unknown version is 404',fixed(await post(boss,EXP({week:'2026-W39'})),404,'REPORT_NOT_FOUND')&&fixed(await post(boss,EXP({version:9})),404,'REPORT_NOT_FOUND'));
check('RP-E3 an unknown format is 400',fixed(await post(boss,EXP({format:'pdf'})),400,'REPORT_FORMAT'));
const XR='rp-export-0001',x1=await post(boss,EXP({requestId:XR})),x2=await post(boss,EXP({requestId:XR}));
check('RP-E4 the same request id replays the same file within five minutes without a new audit row',x1.status===200&&x2.status===200&&x2.body.replayed===true&&x2.body.body===x1.body.body&&audits('report_export').length===4);
{const tampered={...reportRow('fr-a:2026-W40')};tampered.report={...tampered.report,notes:['변조']};
 sql.prepare('UPDATE records SET data=? WHERE id=?').run(JSON.stringify(tampered),`${WS}:recruitment_report:fr-a:2026-W40`);
 const x3=await post(boss,EXP({requestId:XR}));
 check('RP-E4 a replay whose file no longer matches the audited hash is 409 REPLAY_EXPIRED',fixed(x3,409,'REPLAY_EXPIRED')&&audits('report_export').length===4);
 sql.prepare('UPDATE records SET data=? WHERE id=?').run(JSON.stringify(row2),`${WS}:recruitment_report:fr-a:2026-W40`)}
check('RP-E4 the same request id with another format is 409 REQUEST_REUSED',fixed(await post(boss,EXP({requestId:XR,format:'csv'})),409,'REQUEST_REUSED'));
setNow(f.clock.now()+6*60000);
check('RP-E4 a replay after five minutes is 409 REPLAY_EXPIRED',fixed(await post(boss,EXP({requestId:XR})),409,'REPLAY_EXPIRED')&&audits('report_export').length===4);
await f.setFlag(boss,true);

// ════ RP-B 증빙 묶음 ════
const EV=(x={})=>({action:'evidence_export',brandId:'fr-a',scope:'lead',leadId:leads[0],...x});
r=await post(member,EV());
check('RP-B1 a member cannot export an evidence bundle (403)',fixed(r,403,'ADMIN_ONLY'));
r=await post(boss,EV());
const lb=r.status===200?JSON.parse(r.body.body):null;
check('RP-B1 an owner exports the lead journey: system code, stage, attribution with its inputs, events and evidence',r.status===200&&lb.schema==='collective.recruitment-evidence.v1'&&lb.scope==='lead'&&lb.lead.systemCode===f.leadRow(leads[0]).systemCode&&lb.lead.stage==='contracted'&&lb.attribution.state==='attributed'&&lb.attribution.code===CODE&&Array.isArray(lb.attribution.inputs)&&lb.attribution.inputs.length>0&&lb.events.some(e=>e.type==='created')&&lb.evidence.filter(e=>e.evidenceType==='delivery').length===3&&lb.evidence.some(e=>e.evidenceType==='contract'));
check('RP-B1 the bundle carries the contract window, the contract gate result, the asset version and the rule versions',!!lb.contractWindow&&!!lb.contractWindow.at&&lb.contractGate&&lb.contractGate.ok===true&&lb.asset&&lb.asset.id==='ra-1'&&lb.asset.version===2&&lb.asset.bodyHash===sha64(BODY_TOKEN+'2')&&lb.ruleVersions.recruitment===rec.RECRUITMENT_VERSION&&lb.ruleVersions.report===rep.REPORT_VERSION&&lb.disclaimer===DISCLAIMER);
const lbText=r.body.body;
check('RP-B2 the lead bundle has no contact value, memo, phone or email',![NAME,PHONE_DIGITS,EMAIL,MEMO,'이테스트'].some(t=>lbText.includes(t))&&!/"contact"\s*:\s*\{/.test(lbText)&&!/"memo"/.test(lbText));
check('RP-B3 the audit row has the scope, the lead id and the bundle hash',audits('evidence_export').length===1&&audits('evidence_export')[0].bundleScope==='lead'&&audits('evidence_export')[0].leadId===leads[0]&&audits('evidence_export')[0].bundleSha256===r.body.sha256);
const second=await post(boss,EV());
check('RP-B3 the same data exports the same hash (asOf is outside the hash)',second.status===200&&second.body.sha256===r.body.sha256&&JSON.parse(second.body.body).asOf!==undefined);
check('RP-B4 a lead of another brand or an unknown lead is 404',fixed(await post(boss,EV({leadId:other})),404,'LEAD_NOT_FOUND')&&fixed(await post(boss,EV({leadId:'nope'})),404,'LEAD_NOT_FOUND'));
check('RP-B4 an unknown scope is 400',fixed(await post(boss,EV({scope:'campaign'})),400,'EVIDENCE_SCOPE'));
{const plainCode=(await post(boss,{action:'code_issue',brandId:'fr-a',channel:'youtube',label:'가상 유튜브'})).body.result.code;assert.ok(plainCode);
 const extra=await f.createLead(boss,'fr-a',{codes:[plainCode]});assert.equal(extra.status,200,JSON.stringify(extra.body))}
r=await post(boss,{action:'evidence_export',brandId:'fr-a',scope:'asset',assetId:'ra-1'});
const ab=r.status===200?JSON.parse(r.body.body):null;
check('RP-B5 the asset bundle lists every version with its hash, status and approver, oldest first',r.status===200&&ab.scope==='asset'&&same(ab.versions.map(x=>[x.version,x.status]),[[1,'retired'],[2,'approved']])&&ab.versions[1].bodyHash===sha64(BODY_TOKEN+'2')&&ab.versions[1].approval.by==='rp-boss');
check('RP-B5 the asset bundle links the codes, the attributed lead count per version and the spend with its platform numbers',ab.codes.length===1&&ab.codes[0].code===CODE&&ab.codes[0].assetVersion===2&&ab.attributed.byVersion['2']===6&&ab.attributed.total===6&&ab.spend.length===1&&ab.spend[0].amountExVat===300000&&ab.spend[0].platform.clicks===120&&ab.spend[0].note===rec.PLATFORM_REPORTED_NOTE);
check('RP-B5 the asset bundle has no lead id',leads.every(id=>!r.body.body.includes(id)));
check('RP-B5 an unknown asset is 404',fixed(await post(boss,{action:'evidence_export',brandId:'fr-a',scope:'asset',assetId:'nope'}),404,'ASSET_NOT_FOUND'));

// ════ RP-K·RP-M ════
const kinds=(await f.load('lib/record-kinds.ts')).recordKinds;
const k=kinds.find(x=>x.kind==='recruitment_report');
check('RP-K1 recruitment_report is a brand kind outside campaign deletion with a policy retention and no subject erasure',!!k&&k.parent==='brand'&&k.campaignDeletion==='not_campaign_scoped'&&k.retention.basis==='policy'&&k.subjectErasure==='none'&&/집계/.test(k.description));
check('RP-M1 no external or model call was made',f.calls.length===0);
check('RP-M1 no unexpected console error',!logged.some(l=>/franchise_request_failed/.test(l)));

const IDS=['RP-V1','RP-V2','RP-V3','RP-F1','RP-F2','RP-F3','RP-F4','RP-F5','RP-F6','RP-F7','RP-F8','RP-E1','RP-E2','RP-E3','RP-E4','RP-B1','RP-B2','RP-B3','RP-B4','RP-B5','RP-K1','RP-M1'];
const missing=IDS.filter(id=>!passed.some(n=>n.startsWith(id+' ')));
assert.deepEqual(missing,[],'이름에 없는 사례 번호: '+missing.join(', '));passed.push(`every R6b case id (${IDS.length}) has a named check`);
console.log(JSON.stringify({passed:passed.length}));
