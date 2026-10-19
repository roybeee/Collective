// 트랙 R R6d 워크스페이스 할 일 순수 모듈(lib/franchise-tasks.ts 표시 정의, lib/franchise-workspace.ts 판정) 회귀. 사례 번호 WT-*는 R6d PR 본문 수용 기준과 같다.
// 확인: 표시 정의 모듈의 import 없음(WT-S1), 할 일 5종 판정 경계(WT-U·WT-C·WT-E·WT-R·WT-H), 브랜드 합산·이동 브랜드(WT-B), 역할(WT-A),
// 응답 검증과 다음 할 일 변환(WT-N), 값 누출 없음(WT-X). 근거: mocked(순수 함수, 합성 입력, 외부 호출 0회). 법률 적합성은 not_run(LR-1 대상, 결정 20 보류).
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {testRuntime} from './helpers/runtime.mjs';

let fetchCalls=0;
const rt=testRuntime(async()=>{fetchCalls++;throw new Error('외부 호출 금지')});
const tasks=await rt.load('lib/franchise-tasks.ts'),ws=await rt.load('lib/franchise-workspace.ts'),metrics=await rt.load('lib/workspace-metrics.ts');
const passed=[];const check=(name,val)=>{assert.ok(val,name);passed.push(name)};
const plain=x=>JSON.parse(JSON.stringify(x));
const same=(a,b)=>JSON.stringify(plain(a))===JSON.stringify(b);
const DISCLAIMER='COLLECTIVE 휴리스틱 · 법률 자문 아님';
const DAY=86400000,NOW='2026-09-30T03:00:00.000Z',at=ms=>new Date(Date.parse(NOW)+ms).toISOString();

// ════ WT-S1 구문 경계: 표시 정의는 첫 화면 번들에 실리므로 import가 없다. 판정 모듈은 순수 모듈만 import한다 ════
const TASKS_SRC=readFileSync('lib/franchise-tasks.ts','utf8'),WS_SRC=readFileSync('lib/franchise-workspace.ts','utf8');
check('WT-S1 the display module has no import',!/^\s*import\s/m.test(TASKS_SRC));
const wsImports=[...WS_SRC.matchAll(/from '\.\/([^']+)'/g)].map(m=>m[1]).sort();
check('WT-S1 the judgement module imports only pure franchise modules',same(wsImports,['franchise-facts','franchise-gates','franchise-rules','franchise-tasks']));
check('WT-S1 no clock, storage, network or model call in the judgement module',!/Date\.now|new Date\(\)|database\(|listRecords|fetch\(|isEnabled/.test(WS_SRC));
check('WT-S1 six task kinds in fixed order (R15a-3 event follow-up last)',same(tasks.FRANCHISE_TASKS,['unanswered','contract_soon','evidence_gap','registration_due','asset_review','event_followup']));
// ════ WT-V 행사 뒤 48시간 연락(R15a-3) ════
const EV=(id,startsAt,x={})=>({id,brandId:'b1',startsAt,status:'scheduled',...x});
const EVS=[EV('e-now',NOW),EV('e-47h',at(-47*3600000)),EV('e-48h',at(-48*3600000)),EV('e-future',at(3600000)),EV('e-cancel',at(-3600000),{status:'cancelled'}),EV('e-other',at(-3600000),{brandId:'b2'})];
check('WT-V1 events started within 48 hours count; the exact 48-hour edge, future, cancelled and other-brand events do not',ws.eventFollowupCount('b1',EVS,NOW)===2&&ws.eventFollowupCount('b2',EVS,NOW)===1&&ws.eventFollowupCount('b1',[],NOW)===0&&ws.eventFollowupCount('b1',EVS,'bad')===0);
check('WT-V2 brand counts carry event_followup and the next task goes to the events tab',ws.brandTaskCounts({brandId:'b1',leads:[],gates:new Map(),registration:null,assets:[],attributed:new Map(),admin:false,events:EVS},NOW).event_followup===2
 &&(t=>t.length===1&&t[0].task==='event_followup'&&t[0].tab==='events'&&t[0].label==='행사 뒤 48시간 연락'&&t[0].detail.includes('2건'))(plain(tasks.franchiseNextTasks({items:[{task:'event_followup',count:2,brandId:'b1'}],ruleVersion:'x',disclaimer:DISCLAIMER}))));
check('WT-V3 no events means no event task (field defaults to empty)',ws.brandTaskCounts({brandId:'b1',leads:[],gates:new Map(),registration:null,assets:[],attributed:new Map(),admin:false},NOW).event_followup===0);
check('WT-S1 thresholds are named constants',tasks.CONTRACT_SOON_DAYS===3&&tasks.REGISTRATION_DUE_DAYS===30&&tasks.H10_REVIEW_AT===20&&tasks.H10_LIMIT===30&&tasks.H10_REVIEW_AT<tasks.H10_LIMIT);

// ════ WT-U 미응대 ════
const lead=(x={})=>({id:'l-'+Math.random().toString(36).slice(2,8),stage:'inquiry',firstContactAt:null,contactState:'present',contractedAt:null,...x});
check('WT-U1 an inquiry without first contact is unanswered',ws.isUnanswered(lead()));
check('WT-U2 a first contact clears it',!ws.isUnanswered(lead({firstContactAt:at(-DAY)})));
check('WT-U3 later stages are not unanswered',!ws.isUnanswered(lead({stage:'contacted'}))&&!ws.isUnanswered(lead({stage:'closed'})));
check('WT-U4 purged or erased contacts are not counted (cannot be reached)',!ws.isUnanswered(lead({contactState:'purged'}))&&!ws.isUnanswered(lead({contactState:'erased'})));

// ════ WT-C 계약 가능일 3일 전 ════
const open=lead({stage:'draft_provided',firstContactAt:at(-20*DAY)});
check('WT-C1 a window within 3 days is due',ws.isContractSoon(open,at(3*DAY),NOW)&&ws.isContractSoon(open,at(1),NOW));
check('WT-C2 a window after 3 days is not yet due',!ws.isContractSoon(open,at(3*DAY+1),NOW));
check('WT-C3 a window already open is not a task',!ws.isContractSoon(open,NOW,NOW)&&!ws.isContractSoon(open,at(-DAY),NOW));
check('WT-C4 no window (missing documents) is not a task',!ws.isContractSoon(open,null,NOW)&&!ws.isContractSoon(open,undefined,NOW)&&!ws.isContractSoon(open,'not-a-time',NOW));
check('WT-C5 contracted or closed leads are not counted',!ws.isContractSoon({...open,contractedAt:at(-DAY)},at(DAY),NOW)&&!ws.isContractSoon({...open,stage:'closed'},at(DAY),NOW));
check('WT-C6 gate candidates: contracted leads and open disclosed/draft leads only',ws.gateCandidate(lead({contractedAt:at(-DAY),stage:'contracted'}))&&ws.gateCandidate(lead({stage:'disclosed'}))&&ws.gateCandidate(lead({stage:'draft_provided'}))
 &&!ws.gateCandidate(lead())&&!ws.gateCandidate(lead({stage:'consulted'}))&&!ws.gateCandidate(lead({stage:'closed'})));

// ════ WT-E 증빙 결손 ════
check('WT-E1 a contract that fails the gate now is an evidence gap',ws.isEvidenceGap(false));
check('WT-E2 a complete contract or no contract is not',!ws.isEvidenceGap(true)&&!ws.isEvidenceGap(null)&&!ws.isEvidenceGap(undefined));

// ════ WT-R 변경등록 기한 30일 전 ════
const ver=(id,x={})=>({id,brandId:'b1',label:id,registeredAt:at(-200*DAY),validFrom:at(-200*DAY),validUntil:at(100*DAY),status:'active',...x});
const reg=(versions,fiscalYearEnd=null,now=NOW)=>plain(ws.registrationDue({brandId:'b1',versions,fiscalYearEnd},now));
check('WT-R1 no registered version: no deadline known',same(reg([]),{due:false,reasons:[]})&&same(reg([ver('v0',{registeredAt:null})]),{due:false,reasons:[]}));
check('WT-R2 current version valid for more than 30 days: not due',same(reg([ver('v1')]),{due:false,reasons:[]}));
check('WT-R3 current version ending within 30 days is due',same(reg([ver('v1',{validUntil:at(30*DAY)})]),{due:true,reasons:['version_expiring']}));
check('WT-R4 a registered successor starting later clears it',same(reg([ver('v1',{validUntil:at(10*DAY)}),ver('v2',{registeredAt:at(-DAY),validFrom:at(10*DAY),validUntil:at(400*DAY)})]),{due:false,reasons:[]}));
check('WT-R5 no current version and the last one expired: due (past deadline)',same(reg([ver('v1',{validUntil:at(-DAY)})]),{due:true,reasons:['version_expired']}));
check('WT-R6 retired versions are ignored',same(reg([ver('v1',{validUntil:at(5*DAY),status:'retired'})]),{due:false,reasons:[]}));
check('WT-R7 other brands are ignored',same(reg([ver('v1',{brandId:'b2',validUntil:at(5*DAY)})]),{due:false,reasons:[]}));
// 사업연도 종료 2025-12-31 → 정기 변경등록 기한 2026-04-30(120일). 30일 전 = 2026-03-31.
const fyNow=d=>`${d}T03:00:00.000Z`,old=ver('v1',{registeredAt:'2025-06-01T00:00:00.000Z',validFrom:'2025-06-01T00:00:00.000Z',validUntil:'2027-06-01T00:00:00.000Z'});
check('WT-R8 annual deadline: 31 days before is not due',same(reg([old],'2025-12-31',fyNow('2026-03-30')),{due:false,reasons:[]}));
check('WT-R8 annual deadline: 30 days before is due',same(reg([old],'2025-12-31',fyNow('2026-03-31')),{due:true,reasons:['annual_deadline']}));
check('WT-R8 annual deadline: after the deadline without a new registration is still due',same(reg([old],'2025-12-31',fyNow('2026-05-10')),{due:true,reasons:['annual_deadline']}));
const renewed=ver('v2',{registeredAt:'2026-04-10T00:00:00.000Z',validFrom:'2026-04-10T00:00:00.000Z',validUntil:'2027-06-01T00:00:00.000Z'});
check('WT-R9 a version registered after the fiscal year end clears the annual deadline',same(reg([old,renewed],'2025-12-31',fyNow('2026-04-20')),{due:false,reasons:[]}));
check('WT-R10 a non-December fiscal year end picks the latest ended year',same(reg([ver('v1',{registeredAt:'2026-01-10T00:00:00.000Z',validFrom:'2026-01-10T00:00:00.000Z',validUntil:'2027-12-01T00:00:00.000Z'})],'2026-06-30',fyNow('2026-10-01')),{due:true,reasons:['annual_deadline']}));
check('WT-R11 an invalid fiscal year end is ignored (no throw)',same(reg([old],'2025-02-30',fyNow('2026-04-20')),{due:false,reasons:[]})&&same(reg([old],'garbage',fyNow('2026-04-20')),{due:false,reasons:[]}));

// ════ WT-H H10 재검토 ════
const assets=[{id:'ra-1',version:1,brandId:'b1',status:'retired'},{id:'ra-1',version:2,brandId:'b1',status:'approved'},{id:'ra-2',version:1,brandId:'b1',status:'approved'},{id:'ra-3',version:1,brandId:'b1',status:'draft'},{id:'ra-9',version:1,brandId:'b2',status:'approved'}];
const attributed=new Map([['ra-1:1',40],['ra-1:2',20],['ra-2:1',19],['ra-3:1',25],['ra-9:1',30]]);
check('WT-H1 approved versions of this brand with 20 or more attributed leads need review',ws.assetReviewCount('b1',assets,attributed)===1);
check('WT-H2 retired, draft and other-brand versions are not counted',ws.assetReviewCount('b2',assets,attributed)===1&&ws.assetReviewCount('b1',assets,new Map([['ra-1:1',99],['ra-3:1',99]]))===0);
check('WT-H3 19 is not yet due',ws.assetReviewCount('b1',[{id:'ra-2',version:1,brandId:'b1',status:'approved'}],attributed)===0);

// ════ WT-B 브랜드별 건수와 합산 ════
const gates=new Map();
const leads=[lead({id:'u1'}),lead({id:'u2',assigneeId:'m1'}),lead({id:'u3',assigneeId:'m2'}),lead({id:'c1',stage:'draft_provided',firstContactAt:at(-9*DAY)}),lead({id:'g1',stage:'contracted',contractedAt:at(-DAY),firstContactAt:at(-40*DAY)}),lead({id:'g2',stage:'contracted',contractedAt:at(-DAY),firstContactAt:at(-40*DAY)})];
gates.set('c1',{windowAt:at(2*DAY),complete:null});gates.set('g1',{windowAt:at(-10*DAY),complete:false});gates.set('g2',{windowAt:at(-10*DAY),complete:true});
const b1=ws.brandTaskCounts({brandId:'b1',leads,gates,registration:{brandId:'b1',versions:[ver('v1',{validUntil:at(20*DAY)})],fiscalYearEnd:null},assets,attributed,admin:true},NOW);
check('WT-B1 per-brand counts',same(b1,{brandId:'b1',unanswered:3,contract_soon:1,evidence_gap:1,registration_due:1,asset_review:1,event_followup:0}));
const memberView=ws.brandTaskCounts({brandId:'b1',leads,gates,registration:{brandId:'b1',versions:[ver('v1',{validUntil:at(20*DAY)})],fiscalYearEnd:null},assets,attributed,admin:false},NOW);
check('WT-A1 members do not get the registration task (settings are admin-only)',memberView.registration_due===undefined&&memberView.unanswered===3);
const built=plain(ws.buildWorkspaceTasks([b1,{brandId:'b0',unanswered:3,asset_review:0},{brandId:'b2',unanswered:1,evidence_gap:2}]));
check('WT-B2 items follow the fixed order and skip zero totals',same(built.items.map(i=>i.task),['unanswered','contract_soon','evidence_gap','registration_due','asset_review']));
check('WT-B3 totals add across brands',same(built.items.map(i=>i.count),[7,1,3,1,1]));
check('WT-B4 each item opens the brand with the most, ties by brand id',built.items[0].brandId==='b0'&&built.items[2].brandId==='b2'&&built.items[1].brandId==='b1');
check('WT-B5 rule version and disclaimer',built.ruleVersion===ws.WORKSPACE_TASKS_VERSION&&/^fr-tasks@/.test(built.ruleVersion)&&built.disclaimer===DISCLAIMER);
check('WT-B6 nothing to do yields no items',same(plain(ws.buildWorkspaceTasks([{brandId:'b1'}])).items,[]));
check('WT-B7 same input same output (deterministic)',JSON.stringify(plain(ws.buildWorkspaceTasks([b1])))===JSON.stringify(plain(ws.buildWorkspaceTasks([b1]))));

// ════ WT-N 응답 검증과 다음 할 일 변환 ════
const next=plain(tasks.franchiseNextTasks(built));
check('WT-N1 converted to next tasks with label, tab and disclaimer',next.length===5&&next.every(t=>t.kind==='franchise'&&t.disclaimer===DISCLAIMER&&typeof t.label==='string'&&typeof t.detail==='string'));
check('WT-N2 tabs: lead tasks open leads, registration opens settings, H10 opens assets',same(next.map(t=>t.tab),['leads','leads','leads','settings','assets']));
check('WT-N3 details carry the count and thresholds',next[0].detail.includes('7건')&&next[1].detail.includes('3일')&&next[3].detail.includes('30일')&&next[4].detail.includes('20명')&&next[4].detail.includes('30명'));
check('WT-N4 missing or malformed payloads yield nothing',[undefined,null,{},{items:'x'},{items:[{task:'unknown',count:1,brandId:'b'}]},{items:[{task:'unanswered',count:0,brandId:'b'}]},{items:[{task:'unanswered',count:1.5,brandId:'b'}]},{items:[{task:'unanswered',count:2,brandId:''}]}]
 .every(p=>tasks.franchiseNextTasks(p).length===0));
check('WT-N5 a missing disclaimer is filled with the fixed text',plain(tasks.franchiseNextTasks({items:[{task:'unanswered',count:2,brandId:'b1'}],ruleVersion:'x'}))[0].disclaimer===DISCLAIMER);
// workspace-metrics: 캠페인 할 일 뒤에 가맹 할 일을 붙인다. 가맹 할 일이 없으면 이전과 같다.
const nt=plain(metrics.nextTasks({campaigns:[],artifacts:[],runs:[],franchiseTasks:built}));
check('WT-N6 workspace next tasks include franchise tasks',nt.length===5&&nt.every(t=>t.kind==='franchise'));
check('WT-N7 without franchise tasks the result is unchanged',same(plain(metrics.nextTasks({campaigns:[],artifacts:[],runs:[]})),[]));

// ════ WT-X 값 누출 없음 ════
const text=JSON.stringify(built)+JSON.stringify(next);
check('WT-X1 no lead id, system code or contact in the payload',!/\b(u1|u2|u3|c1|g1|g2)\b|\bL[A-Z0-9]{7}\b|010-|@example/.test(text));
check('WT-X2 no network call',fetchCalls===0);

console.log(JSON.stringify({passed:passed.length}));
