// 트랙 R 가맹 리드 순수 모듈(lib/franchise.ts) 회귀: 사유 문구 완결, 라벨, 연락처 정규화·가림, 보존 기한(H11)·재확인, 역할 판정, CSV 수식 주입 방지, 적격 점수, 게이트 설명, 순수성.
// 근거: mocked(순수 함수, 합성 값, 외부 호출 0회). 기한은 COLLECTIVE 휴리스틱이며 법률 적합성은 확인하지 않는다(결정 20 보류, blocked).
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {testRuntime} from './helpers/runtime.mjs';

let fetchCalls=0;
const rt=testRuntime(async()=>{fetchCalls++;throw new Error('외부 호출 금지')});
const fl=await rt.load('lib/franchise.ts'),fg=await rt.load('lib/franchise-gates.ts');
const passed=[];const check=(name,val)=>{assert.ok(val,name);passed.push(name)};
const plain=x=>JSON.parse(JSON.stringify(x));
const same=(a,b)=>JSON.stringify(plain(a))===JSON.stringify(b);
const DAY=86400000,iso=ms=>new Date(ms).toISOString();

// 1) 게이트 사유 문구: 사유·경고 코드와 정확히 같은 키, 모두 한국어.
const codes=[...fg.REASON_CODES,...fg.WARNING_CODES].sort();
check('gate reason messages cover exactly every reason and warning code',same(Object.keys(fl.GATE_REASON_MESSAGES).sort(),codes));
check('every gate reason message is Korean',Object.values(fl.GATE_REASON_MESSAGES).every(m=>/[가-힣]/.test(m)));
check('ftc link reason says a site link is not a delivery',/공정위 사이트 링크는 제공으로 기록할 수 없습니다/.test(fl.GATE_REASON_MESSAGES.method_not_allowed));

// 2) 단계·라벨
check('stage labels cover exactly the lead stages',same(Object.keys(fl.STAGE_LABELS),plain(fg.LEAD_STAGES)));
check('general and evidence stages split the pre-contract flow',same(fl.GENERAL_STAGES,['inquiry','contacted','consulted','briefing'])&&same(fl.EVIDENCE_STAGES,['disclosed','draft_provided','contracted','fee_escrowed']));
check('stage order runs inquiry 0 to opened 8 and closed has none',fl.stageOrder('inquiry')===0&&fl.stageOrder('opened')===8&&fl.stageOrder('closed')===-1&&fl.stageOrder('disclosed')===4);
const labelSets=['BUDGET_LABELS','TIMING_LABELS','SOURCE_LABELS','BASIS_LABELS','REFERRAL_LABELS','MARKETING_METHOD_LABELS','CLOSE_REASON_LABELS','REVEAL_PURPOSE_LABELS','EXPORT_PURPOSE_LABELS','BACKDATE_REASON_LABELS','CORRECTION_REASON_LABELS','SUBJECT_REQUEST_TYPE_LABELS','SUBJECT_REQUEST_STATUS_LABELS','SUBJECT_CHANNEL_LABELS','BRANCH_LABELS','CONTACT_FIELD_LABELS','CONTACT_STATE_LABELS','EVIDENCE_TYPE_LABELS','EVENT_TYPE_LABELS','AUDIT_ACTION_LABELS','REGISTRY_AMEND_REASON_LABELS','BOARD_TODO_LABELS'];
check('every enum has Korean labels',labelSets.every(k=>Object.values(fl[k]).length>0&&Object.values(fl[k]).every(v=>/[가-힣]/.test(v))));
check('enum arrays match their label keys',[['BUDGET_BANDS','BUDGET_LABELS'],['TIMING_BANDS','TIMING_LABELS'],['SOURCE_CHANNELS','SOURCE_LABELS'],['BASIS_TYPES','BASIS_LABELS'],['CLOSE_REASONS','CLOSE_REASON_LABELS'],['REVEAL_PURPOSES','REVEAL_PURPOSE_LABELS'],['EXPORT_PURPOSES','EXPORT_PURPOSE_LABELS'],['BACKDATE_REASONS','BACKDATE_REASON_LABELS'],['CONTACT_FIELDS','CONTACT_FIELD_LABELS'],['SUBJECT_REQUEST_TYPES','SUBJECT_REQUEST_TYPE_LABELS']].every(([a,l])=>same(fl[a],Object.keys(fl[l]))));
check('backdate reasons satisfy the gate approval pattern',fl.BACKDATE_REASONS.every(r=>fg.APPROVAL_REASON_PATTERN.test(r)));
check('the three collection bases name their article',same(fl.BASIS_TYPES,['inquiry_response','consent','referral'])&&/제15조①4호/.test(fl.BASIS_LABELS.inquiry_response)&&/제15조①1호/.test(fl.BASIS_LABELS.consent));
check('every fixed error has a status and Korean text',Object.values(fl.FRANCHISE_ERRORS).every(e=>[400,403,404,409,503].includes(e.status)&&/[가-힣]/.test(e.text)));
check('heuristic labels carry the disclaimer wording',[fl.DUE_LABEL,fl.RETENTION_LABEL,fl.RECHECK_LABEL].every(t=>t.includes('COLLECTIVE 휴리스틱')&&t.includes('법률 자문 아님'))&&fl.GATE_DISCLAIMER==='COLLECTIVE 휴리스틱 · 법률 자문 아님');

// 3) 전화 정규화
check('domestic, +82 and spaced country code phones normalize to the same digits',['010-0000-0101','+82 10-0000-0101','82 10 0000 0101','+82 (0)10.0000.0101','０１０-００００-０１０１'].every(p=>fl.normalizePhone(p)==='01000000101'));
check('non-phone input is rejected',['12345','abc','','010-0000-01o1',null,42,'1'.repeat(41)].every(p=>fl.normalizePhone(p)===null));
check('landline numbers keep their area code',fl.normalizePhone('02-000-0000')==='020000000');
// 4) 이메일
check('email is trimmed and lowercased',fl.normalizeEmail('  Lead.One@Example.COM ')==='lead.one@example.com');
check('bad emails are rejected',['a@b','lead one@example.com','x@example','',`${'a'.repeat(250)}@example.com`,null].every(e=>fl.normalizeEmail(e)===null));
// 5) 이름
check('names are trimmed and inner spaces collapsed',fl.normalizeName('  김  가상 ')==='김 가상'&&fl.normalizeName('김가상')==='김가상');
check('names with digits, control chars, brackets, empty or 41 chars are rejected',['김가상1','김\u0007가상','<김>','','   ','가'.repeat(41)].every(n=>fl.normalizeName(n)===null)&&fl.normalizeName('가'.repeat(40))!==null);
// 6) 가림
check('name masks keep first (and last) character',fl.maskName('홍길동')==='홍*동'&&fl.maskName('김철')==='김*'&&fl.maskName('남궁민수')==='남**수'&&fl.maskName('김')==='*');
check('phone mask keeps only the last four digits',fl.maskPhone('01000000101')==='***-****-0101');
check('email mask keeps first local char and domain',fl.maskEmail('lead.one@example.com')==='l***@example.com');
check('an email with a one- or two-character local part hides the whole local part',fl.maskEmail('a@example.com')==='***@example.com'&&fl.maskEmail('ab@example.com')==='***@example.com'&&!fl.maskEmail('a@example.com').startsWith('a')&&!fl.maskEmail('ab@example.com').includes('ab@')&&fl.maskEmail('abc@example.com')==='a***@example.com');
check('masks never contain the full value',!fl.maskName('김가상').includes('김가상')&&!fl.maskPhone('01000000101').includes('01000000101')&&!fl.maskEmail('lead.one@example.com').includes('lead.one'));
// 6-1) 보드 검색어: 코드 앞부분·지역만(전화·이메일·숫자는 GET 주소에 싣지 않는다)
check('board queries accept a code prefix or a region name',['','L','lkb7','LKB728BT','가상시 가상구'].every(q=>fl.isBoardQuery(q)));
check('board queries refuse phones, emails, digits and non-code letters',['010-0000-0777','01000000777','lead.one@example.com','가상구 1','L0100000','LKB728BT9','김가상 010','abc'].every(q=>!fl.isBoardQuery(q)));
check('the holiday warning also covers a list that misses the year',/해당 연도를 포함하지 않아/.test(fl.GATE_REASON_MESSAGES.holiday_calendar_unverified));
check('the switch-off banner names the switch and the reload instead of a missing settings control',fl.OFF_BANNER.includes('r_franchise')&&fl.OFF_BANNER.includes('새로고침')&&!fl.OFF_BANNER.includes('설정의 기능 스위치'));
// 7) 전화 표시
check('phone formatting covers 02, 10 and 11 digit numbers',fl.formatPhone('020000000')==='02-000-0000'&&fl.formatPhone('0200000000')==='02-0000-0000'&&fl.formatPhone('0310000000')==='031-000-0000'&&fl.formatPhone('01000000101')==='010-0000-0101'&&fl.formatPhone('12')==='12');

// 8) 보존 기한
const base='2026-01-01T00:00:00.000Z',t0=Date.parse(base);
const lead=(x={})=>({contactState:'present',contractedAt:null,closedAt:null,lastActivityAt:base,marketing:{status:'none'},...x});
check('unconverted lead keeps contact 180 days after last activity',fl.retentionUntil(lead())===iso(t0+180*DAY));
check('contracted open lead has no retention deadline',fl.retentionUntil(lead({contractedAt:base}))===null);
check('contracted closed lead keeps contact 1095 days after closing',fl.retentionUntil(lead({contractedAt:base,closedAt:'2026-02-01T00:00:00.000Z'}))===iso(Date.parse('2026-02-01T00:00:00.000Z')+1095*DAY));
check('purged and erased leads have no deadline',fl.retentionUntil(lead({contactState:'purged'}))===null&&fl.retentionUntil(lead({contactState:'erased'}))===null);
check('179 days is kept, 180 days is expired',!fl.isContactExpired(lead(),iso(t0+179*DAY))&&fl.isContactExpired(lead(),iso(t0+180*DAY)));
check('expiry compares instants across Z and +09:00',fl.isContactExpired(lead(),'2026-06-30T09:00:00+09:00')&&!fl.isContactExpired(lead(),'2026-06-30T08:59:00+09:00')&&fl.isContactExpired(lead({lastActivityAt:'2026-01-01T09:00:00+09:00'}),iso(t0+180*DAY)));
check('activity events exclude internal actions',['reveal','find','claimed','assigned','export','marketing_withdrawn','transition_blocked','purged','erased'].every(e=>!fl.ACTIVITY_EVENTS.includes(e))&&['created','stage_changed','evidence_recorded','contact_updated'].every(e=>fl.ACTIVITY_EVENTS.includes(e)));
check('marketing consent recheck is due after two years only',!fl.marketingRecheckDue(lead({marketing:{status:'given',at:base}}),iso(t0+729*DAY))&&fl.marketingRecheckDue(lead({marketing:{status:'given',at:base}}),iso(t0+731*DAY))&&!fl.marketingRecheckDue(lead({marketing:{status:'withdrawn',at:base}}),iso(t0+800*DAY)));
check('subject request is due ten days after receipt',fl.subjectDueAt(base)===iso(t0+10*DAY)&&fl.DSR_DUE_DAYS===10);

// 9) 역할 판정
const owner={id:'o',role:'owner'},admin={id:'a',role:'admin'},me={id:'m',role:'member'};
const L=(assigneeId,stage='inquiry')=>({assigneeId,stage,contactState:'present',basis:{type:'inquiry_response'},marketing:{status:'none'}});
check('owner and admin see and reveal every lead',[owner,admin].every(w=>fl.canSeeLead(w,L('x'))&&fl.canReveal(w,L('x'))&&fl.canEditLead(w,L(null))&&fl.canClose(w,L('x','disclosed'))));
check('member sees own and unassigned leads only',fl.canSeeLead(me,L('m'))&&fl.canSeeLead(me,L(null))&&!fl.canSeeLead(me,L('x')));
check('member edits and reveals only own leads',fl.canEditLead(me,L('m'))&&!fl.canEditLead(me,L(null))&&fl.canReveal(me,L('m'))&&!fl.canReveal(me,L(null))&&!fl.canReveal(me,L('x'))&&fl.isOwnLead(me,L('m')));
check('member closes own leads only from a general stage',fl.canClose(me,L('m','briefing'))&&!fl.canClose(me,L('m','disclosed'))&&!fl.canClose(me,L(null))&&!fl.canClose(me,L('x')));
check('lead actions offer claim to a member only on unassigned leads and never evidence',fl.leadActions(me,L(null),true).includes('claim_lead')&&!fl.leadActions(me,L('m'),true).includes('claim_lead')&&!fl.leadActions(me,L('m'),true).some(a=>a.startsWith('record_'))&&!fl.leadActions(me,L(null),true).includes('reveal_contact'));
check('switch off hides write actions but keeps reveal and subject requests',(a=>a.includes('reveal_contact')&&a.includes('add_subject_request')&&!a.includes('update_task')&&!a.includes('claim_lead'))(fl.leadActions(admin,L(null),false)));
check('allowed moves never include evidence stages',[owner,me].every(w=>fl.allowedMoves(w,L(w.id),true).every(s=>!fl.EVIDENCE_STAGES.includes(s)))&&fl.allowedMoves(admin,L('x','contracted'),true).includes('opened'));

// 10) CSV
check('formula cells are prefixed and quoted',fl.csvCell('=HYPERLINK("x")')==='"\'=HYPERLINK(""x"")"');
check('plus, minus, at, tab and carriage return are prefixed',['+1','-1','@a','\tx','\rx'].every(v=>fl.csvCell(v).startsWith('"\'')));
check('full-width, leading-space and zero-width equals are prefixed',['＝1',' =1','​=1','﻿+1'].every(v=>fl.csvCell(v).startsWith('"\'')));
check('plain text is only quoted',fl.csvCell('가상')==='"가상"'&&fl.csvCell(null)==='""'&&fl.csvCell('2026-01-01')==='"2026-01-01"');
check('csv file starts with a BOM and uses CRLF',fl.csvFile(['a','b'],[[1,2]])==='﻿"a","b"\r\n"1","2"');
check('export columns are the fourteen Korean headers',fl.EXPORT_COLUMNS.length===14&&fl.EXPORT_COLUMNS[0]==='코드'&&fl.EXPORT_COLUMNS.at(-1)==='이메일');

// 11) 적격 점수
const criteria={version:1,budgetBands:['lt_50m'],regions:['가상시 가상구'],timingBands:['within_3m']};
check('eligibility counts the four task criteria',same(fl.eligibilityScore({task:{budgetBand:'lt_50m',region:'가상시 가상구',timingBand:'within_3m'},firstContactAt:base},criteria),{met:4,total:4})&&same(fl.eligibilityScore({task:{budgetBand:'unknown',region:'',timingBand:'unknown'},firstContactAt:null},criteria),{met:0,total:4}));
check('eligibility is null without criteria',fl.eligibilityScore({task:{budgetBand:'lt_50m',region:'',timingBand:'unknown'},firstContactAt:null},null)===null);

// 12) 게이트 설명
const w=fg.earliestContractAt({deliveries:[],disclosureVersions:[],contractTemplates:[]},'2026-10-05T10:00:00+09:00');
const d=plain(fl.describeWindow(w));
check('window description turns codes into Korean messages with disclaimer',d.at===null&&d.atKst===null&&d.blockers.some(b=>b.code==='disclosure_missing'&&/정보공개서/.test(b.message))&&d.disclaimer===fl.GATE_DISCLAIMER);
check('KST label slices +09:00 instants and converts Z instants',fl.kstLabel('2026-10-20T00:00:00+09:00')==='2026-10-20 00:00 KST'&&fl.kstLabel('2026-10-19T15:30:00.000Z')==='2026-10-20 00:30 KST');
const g=plain(fl.describeGate(fg.checkTransition({deliveries:[]},'contracted','2026-10-05T10:00:00+09:00',{disclosureVersions:[],contractTemplates:[]})));
check('gate description carries reasons and the disclaimer',g.ok===false&&g.reasons.every(r=>r.message&&r.code)&&g.disclaimer===fl.GATE_DISCLAIMER);
check('system code is L plus seven alphabet characters',/^L[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{7}$/.test(fl.leadSystemCode(new Uint8Array(32).map((_,i)=>i*7)))&&fl.leadSystemCode(new Uint8Array(3))===null);

// 13) 순수성
const src=readFileSync('lib/franchise.ts','utf8'),imports=[...src.matchAll(/^\s*import\s[^;]*?from\s*'([^']+)'/gm)].map(m=>m[1]);
check('pure module imports only gates, rules and tracking codes',imports.length>0&&imports.every(i=>['./franchise-gates','./franchise-rules','./tracking-codes'].includes(i)));
const code=src.replace(/^\s*\/\/.*$/gm,'');
check('pure module reads no clock, randomness, environment or network',!/\bfetch\s*\(|Date\.now|new Date\(\s*\)|Math\.random|\bprocess\./.test(code));
check('no legal-adequacy claim in the module',!/법적으로 적합|준수 완료|합법/.test(src));
check('no external call was made',fetchCalls===0);

console.log(JSON.stringify({passed:passed.length}));
