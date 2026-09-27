// 트랙 R R6d 워크스페이스 할 일 경로 스위트(GET /api/workspace의 franchiseTasks). 사례 번호 WR-*는 R6d PR 본문 수용 기준과 같다.
// 확인: 스위치 꺼짐이면 키 없음(WR-F), 할 일 5종 실제 기록 판정(WR-T), 역할별 범위(WR-A), 다른 워크스페이스 격리(WR-I), 값 누출 없음(WR-X),
// 공유 파일 호출 1줄·스위치 위치(WR-W), 외부·모델 호출 0. 근거: mocked(메모리 SQLite node:sqlite, 이메일 모드 세션 주입, 외부 fetch는 던지는 스텁, 시계 이동 Date).
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {franchiseFixture,captureConsole,DAY,HOUR,DISCLAIMER,sha64} from './helpers/franchise-fixture.mjs';

const logged=captureConsole();
const f=await franchiseFixture();
const {sql,env,server}=f;
env.AUTH_MODE='email';env.AUTH_ORIGIN='https://agency.test';
const passed=[];const check=(name,val)=>{assert.ok(val,name);passed.push(name)};
const setNow=ms=>f.clock.set(ms-Date.now());
const ago=ms=>new Date(f.clock.now()-ms).toISOString();
const ahead=ms=>new Date(f.clock.now()+ms).toISOString();
setNow(Date.parse('2026-09-30T03:00:00Z'));
const wsRoute=await f.load('app/api/workspace/route.ts');
const WS='wr-owner',OTHER='wr-other';
const boss=f.signIn('wr-boss','admin',1000,WS),member=f.signIn('wr-member','member',3000,WS),stranger=f.signIn('wr-stranger','admin',4000,OTHER);
for(const b of ['fr-a','fr-b'])await f.brand(WS,b);
await f.brand(OTHER,'fr-z');
const post=(s,input)=>f.post(s,input),get=(s,q)=>f.get(s,q);
const workspace=async s=>{const res=await wsRoute.GET(new Request('https://agency.test/api/workspace',{headers:Object.fromEntries(Object.entries(s).filter(([k])=>k!=='id'))}));return {status:res.status,body:await res.json(),text:null}};
const v=id=>f.leadRow(id).version;
const byTask=body=>Object.fromEntries((body.franchiseTasks?.items??[]).map(i=>[i.task,i]));

// ════ WR-F 스위치 꺼짐: 응답에 키가 없다(이전 응답과 같은 모양) ════
let w=await workspace(boss);
check('WR-F1 switch off: workspace answers 200 without franchiseTasks',w.status===200&&!('franchiseTasks' in w.body));

// ── 준비 ──
check('setup: owner turns the franchise switch on',(await f.setFlag(boss,true)).status===200);
for(const b of ['fr-a','fr-b']){const r=await f.profile(boss,b,{storageLabels:['본사 문서함']},0);assert.equal(r.status,200,JSON.stringify(r.body))}
let r=await post(boss,{action:'register_disclosure_version',brandId:'fr-a',label:'가상 정보공개서 1판',sha256:sha64('wr-dv'),registeredAt:ago(60*DAY),validFrom:ago(90*DAY),validUntil:ahead(300*DAY),storageLabel:'본사 문서함'});
assert.equal(r.status,200,JSON.stringify(r.body));const DV=r.body.result.id;
r=await post(boss,{action:'register_contract_template',brandId:'fr-a',label:'가상 계약서안',sha256:sha64('wr-ct'),checkedItems:[1,2,3,4,5,6,7,8,9,10,11,12,13],storageLabel:'본사 문서함'});
assert.equal(r.status,200,JSON.stringify(r.body));const CT=r.body.result.id;
// fr-b: 유효 기간 끝이 20일 뒤인 등록 버전(변경등록 기한 할 일).
r=await post(boss,{action:'register_disclosure_version',brandId:'fr-b',label:'가상 정보공개서 B',sha256:sha64('wr-dv-b'),registeredAt:ago(300*DAY),validFrom:ago(300*DAY),validUntil:ahead(20*DAY),storageLabel:'본사 문서함'});
assert.equal(r.status,200,JSON.stringify(r.body));
w=await workspace(boss);
check('WR-F2 switch on: registration task appears for fr-b only (fr-a has 300 days)',w.status===200&&byTask(w.body).registration_due?.count===1&&byTask(w.body).registration_due?.brandId==='fr-b');

// 모집 자료 판(승인)과 코드, 코드 귀속 리드 20명(H10).
await server.recordStatement(WS,'campaign','ca-a',{id:'ca-a',brandId:'fr-a',title:'가상 모집 캠페인',status:'approved',objective:'franchise_recruitment',version:1,createdAt:'2026-09-01T00:00:00.000Z',updatedAt:'2026-09-01T00:00:00.000Z'},'fr-a').run();
const BODY='가상자료본문';
sql.prepare('INSERT INTO records(id,owner,kind,parent_id,data,updated_at) VALUES(?,?,?,?,?,?)').run(`${WS}:recruitment_asset:ra-1:1`,WS,'recruitment_asset','fr-a',JSON.stringify({id:'ra-1',version:1,brandId:'fr-a',campaignId:'ca-a',type:'portal_intro',body:BODY,bodyHash:sha64(BODY),factRefs:[],disclosureVersionId:null,status:'approved',approval:{by:'wr-boss',role:'owner',at:'2026-09-20T00:00:00.000Z',bodyHash:sha64(BODY),checklist:{version:'c1',checked:[]}},placements:[],exports:[],review:{needed:false,reasons:[],at:null},createdAt:'2026-09-20T00:00:00.000Z',updatedAt:'2026-09-20T00:00:00.000Z'}),'2026-09-20T00:00:00.000Z');
r=await post(boss,{action:'code_issue',brandId:'fr-a',channel:'portal',label:'가상 포털 소개',assetRef:{id:'ra-1',version:1},campaignId:'ca-a',validFrom:'2026-09-01'});
assert.equal(r.status,200,JSON.stringify(r.body));const CODE=r.body.result.code;
const h10=[];
for(let i=0;i<19;i++){const c=await f.createLead(boss,'fr-a',{codes:[CODE]});assert.equal(c.status,200,JSON.stringify(c.body));h10.push(c.body.result.leadId)}
w=await workspace(boss);
check('WR-T1 H10: 19 attributed leads is not yet a review task',!byTask(w.body).asset_review);
{const c=await f.createLead(boss,'fr-a',{codes:[CODE]});assert.equal(c.status,200);h10.push(c.body.result.leadId)}
w=await workspace(boss);
check('WR-T1 H10: the 20th attributed lead raises one review task for fr-a',byTask(w.body).asset_review?.count===1&&byTask(w.body).asset_review?.brandId==='fr-a');
check('WR-T2 unanswered: 20 new inquiries without first contact',byTask(w.body).unanswered?.count===20);

// 미응대 해소: 첫 연락을 기록하면 빠진다(단계 이동으로 첫 연락 시각이 생긴다).
r=await post(boss,{action:'move_stage',brandId:'fr-a',leadId:h10[0],version:v(h10[0]),to:'contacted'});
assert.equal(r.status,200,JSON.stringify(r.body));
w=await workspace(boss);
check('WR-T2 recording first contact removes a lead from unanswered',byTask(w.body).unanswered?.count===19&&f.leadRow(h10[0]).firstContactAt!==null);

// 직원이 등록한 리드(본인 담당)와 fr-b 리드.
const mine=(await f.createLead(member,'fr-a')).body.result.leadId,bLead=(await f.createLead(boss,'fr-b')).body.result.leadId;
assert.ok(mine&&bLead);

// 계약 가능일: 세 문서를 지금 제공한 리드. 계약 가능 시각 2일 전으로 시계를 옮긴다.
const EL=t=>({electronic:{channel:'email',receivedAt:t,printable:true}});
const deliverAll=async(lead,when,extra={})=>{for(const doc of ['disclosure','nearby','draft']){const d=await post(boss,{action:'record_delivery',brandId:'fr-a',leadId:lead,version:v(lead),doc,method:'electronic',deliveredAt:when,evidence:EL(when),...(doc==='disclosure'?{versionId:DV}:{}),...(doc==='draft'?{templateId:CT}:{}),storageLabel:'본사 문서함',...extra});assert.equal(d.status,200,JSON.stringify(d.body))}};
const soon=(await f.createLead(boss,'fr-a')).body.result.leadId;
await post(boss,{action:'move_stage',brandId:'fr-a',leadId:soon,version:v(soon),to:'contacted'});
await deliverAll(soon,'now');
const windowAt=(await get(boss,`view=lead&brandId=fr-a&leadId=${soon}`)).body.gate.window.at;
check('setup: the delivered lead has a contract window and a draft stage',typeof windowAt==='string'&&f.leadRow(soon).stage==='draft_provided');
w=await workspace(boss);
check('WR-T3 a window two weeks away is not yet a task',!byTask(w.body).contract_soon);

// 증빙 결손: 30일 전 세 문서 제공, 1시간 전 계약, 그 뒤 정보공개서 제공 기록 무효화.
const gap=(await f.createLead(boss,'fr-a')).body.result.leadId;
await post(boss,{action:'move_stage',brandId:'fr-a',leadId:gap,version:v(gap),to:'contacted'});
await deliverAll(gap,ago(30*DAY),{backdateReason:'after_the_fact_entry'});
r=await post(boss,{action:'record_contract',brandId:'fr-a',leadId:gap,version:v(gap),signedAt:ago(HOUR),backdateReason:'after_the_fact_entry'});
assert.equal(r.status,200,JSON.stringify(r.body));
w=await workspace(boss);
check('WR-T4 a complete contract is not an evidence gap',!byTask(w.body).evidence_gap);
const dis=f.rows('franchise_delivery',"AND parent_id=? AND json_extract(data,'$.payload.doc')='disclosure'",gap)[0];
r=await post(boss,{action:'void_evidence',brandId:'fr-a',leadId:gap,version:v(gap),supersedes:dis.id,correctionReason:'wrong_lead'});
assert.equal(r.status,200,JSON.stringify(r.body));
w=await workspace(boss);
check('WR-T4 voiding the disclosure delivery of a contracted lead raises an evidence gap',byTask(w.body).evidence_gap?.count===1&&byTask(w.body).evidence_gap?.brandId==='fr-a');

// 시계를 계약 가능 시각 2일 전으로 옮긴다.
setNow(Date.parse(windowAt)-2*DAY);
w=await workspace(boss);
const t=byTask(w.body);
check('WR-T3 two days before the contract window the lead is a task',t.contract_soon?.count===1&&t.contract_soon?.brandId==='fr-a');
check('WR-T5 all five tasks in fixed order with the disclaimer and rule version',JSON.stringify(w.body.franchiseTasks.items.map(i=>i.task))==='["unanswered","contract_soon","evidence_gap","registration_due","asset_review"]'
 &&w.body.franchiseTasks.disclaimer===DISCLAIMER&&/^fr-tasks@/.test(w.body.franchiseTasks.ruleVersion));
check('WR-T5 unanswered counts both brands and opens the busier one',t.unanswered?.count===21&&t.unanswered?.brandId==='fr-a');
check('WR-T5 registration still due for fr-b (about a week left)',t.registration_due?.count===1&&t.registration_due?.brandId==='fr-b');
setNow(Date.parse(windowAt)+HOUR);
w=await workspace(boss);
check('WR-T3 once the window opens it is no longer a task',!byTask(w.body).contract_soon);
setNow(Date.parse(windowAt)-2*DAY);

// ════ WR-A 역할 ════
w=await workspace(member);
const mt=byTask(w.body);
check('WR-A1 members count only their own and unassigned leads',mt.unanswered?.count===1&&mt.unanswered?.brandId==='fr-a');
check('WR-A2 members get no lead-level tasks for leads they cannot see',!mt.contract_soon&&!mt.evidence_gap);
check('WR-A3 members get no registration task (settings are admin-only)',!mt.registration_due);
check('WR-A4 the asset review task is asset-level and shown to members',mt.asset_review?.count===1);

// ════ WR-I 다른 워크스페이스 격리 ════
w=await workspace(stranger);
check('WR-I1 another workspace with the switch off sees no franchise tasks',w.status===200&&!('franchiseTasks' in w.body));
check('WR-I1 turning it on there shows nothing from this workspace',(await f.setFlag(stranger,true)).status===200&&(await workspace(stranger)).body.franchiseTasks?.items.length===0);

// ════ WR-X 값 누출 없음 ════
w=await workspace(boss);
const payload=JSON.stringify(w.body.franchiseTasks);
const leadIds=f.rows('franchise_lead').map(l=>l.id),codes=f.rows('franchise_lead').map(l=>l.systemCode);
check('WR-X1 no lead id or system code in franchiseTasks',leadIds.every(id=>!payload.includes(id))&&codes.every(c=>!payload.includes(c)));
check('WR-X2 no name, phone or contact field in franchiseTasks',!/이테스트|010-|@example|contact|phone|email|name/.test(payload));
check('WR-X3 only task, count and brandId per item',w.body.franchiseTasks.items.every(i=>JSON.stringify(Object.keys(i).sort())==='["brandId","count","task"]'));
check('WR-X4 no external or model call',f.calls.length===0);
check('WR-X5 no error was logged',!logged.some(l=>/franchise workspace tasks failed/.test(l)));

// ════ WR-F3 스위치를 다시 끄면 키가 사라진다 ════
check('WR-F3 switch off again: key gone',(await f.setFlag(boss,false)).status===200&&!('franchiseTasks' in (await workspace(boss)).body));

// ════ WR-W 공유 파일 연결(레인 A 파일은 호출 1줄 수준) ════
const ROUTE=readFileSync('app/api/workspace/route.ts','utf8'),METRICS=readFileSync('lib/workspace-metrics.ts','utf8'),SERVER=readFileSync('lib/franchise-workspace-server.ts','utf8');
check('WR-W1 the workspace route has one import and one call line',ROUTE.split('\n').filter(l=>/franchise/i.test(l)).length===2&&ROUTE.includes('...await franchiseWorkspaceTasks(who),'));
check('WR-W2 the switch is read in the franchise server module, not in shared files',/isEnabled\(who\.owner,'r_franchise'\)/.test(SERVER)&&!ROUTE.includes('r_franchise')&&!METRICS.includes('r_franchise'));
check('WR-W3 workspace metrics only appends the franchise conversion',METRICS.includes('...franchiseNextTasks(data.franchiseTasks)')&&METRICS.split('\n').filter(l=>/franchise/i.test(l)).length===4);
const SCREEN=readFileSync('app/workspace.tsx','utf8'),ITEM=readFileSync('app/franchise-next-task.tsx','utf8');
check('WR-W4 the overview hands franchise tasks to the franchise item and keeps campaign tasks as before',SCREEN.includes("t.kind==='franchise'?<FranchiseNextTaskItem key={t.task} task={t}")&&SCREEN.includes('onClick={()=>setSelectedId(t.campaignId)}'));
check('WR-W5 the item opens the franchise view at the task brand and tab and shows the disclaimer',ITEM.includes("onOpen({view:'franchise',brand:task.brandId,tab:task.tab})")&&ITEM.includes('{task.disclaimer}'));

console.log(JSON.stringify({passed:passed.length}));
