// R4a 법정 절차 게이트(lib/franchise-gates.ts) 회귀: 위임 계약 벡터, 게이트 시나리오 1~9·12, 말일 주말·공휴일 연장(대표 지시), 사유 코드 전부, 같은 id 1회, 입력 순서 불변, 형식 오류 거부와 값 비노출.
// 근거: mocked(순수 함수, 합성 픽스처, 외부 호출 0회). 공휴일 목록은 합성 값이지 실제 달력 확인이 아니다. 법률 적합성은 not_run(LR-1 대상).
// 게이트 시나리오 (10) 직원 제공·계약 기록 403과 (11) 동시 전이 2건 409는 권한·잠금이 있는 R4b(tests/franchise-pipeline.test.mjs) 몫이다. R4a는 권한·잠금·타임아웃이 없는 순수 모듈이라 이 스위트는 다루지 않는다.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {SourceTextModule,createContext} from 'node:vm';
import ts from 'typescript';
import {testRuntime} from './helpers/runtime.mjs';

let fetchCalls=0;
const rt=testRuntime(async()=>{fetchCalls++;throw new Error('외부 호출 금지')});
const fr=await rt.load('lib/franchise-rules.ts'),fg=await rt.load('lib/franchise-gates.ts');
const passed=[];const check=(name,val)=>{assert.ok(val,name);passed.push(name)};
const plain=x=>JSON.parse(JSON.stringify(x));
const same=(a,b)=>JSON.stringify(plain(a))===JSON.stringify(b);
// 기대값으로 쓴 사유·경고 코드를 모아 마지막에 전부 나왔는지 본다.
const seen=new Set();const E=(...codes)=>{codes.forEach(c=>seen.add(c));return codes};
const side=s=>({startDate:s.startDate,days:s.days,periodEnd:s.periodEnd,opensAt:s.opensAt,shortened:s.shortened,extended:s.extended});
const pick=(o,keys)=>Object.fromEntries(keys.map(k=>[k,o[k]]));
const deepFreeze=o=>{if(o&&typeof o==='object'&&!Object.isFrozen(o)){Object.freeze(o);Object.values(o).forEach(deepFreeze)}return o};

// ── 합성 픽스처(vectors fixture.definitions) ──
const range=(a,b)=>Array.from({length:b-a+1},(_,i)=>a+i);
const VER=[{id:'dv1',registeredAt:'2026-01-15T09:00:00+09:00',validFrom:'2026-01-15T00:00:00+09:00',validUntil:'2027-04-30T00:00:00+09:00'},{id:'dv0',registeredAt:null,validFrom:'2026-01-01T00:00:00+09:00',validUntil:'2027-01-01T00:00:00+09:00'},{id:'dvx',registeredAt:'2025-01-10T09:00:00+09:00',validFrom:'2025-01-10T00:00:00+09:00',validUntil:'2026-10-01T00:00:00+09:00'},{id:'dvlate',registeredAt:'2026-10-06T09:00:00+09:00',validFrom:'2026-10-01T00:00:00+09:00',validUntil:'2027-04-30T00:00:00+09:00'}];
const TPL=[{id:'tpl1',checkedItems:range(1,13)},{id:'tpl12',checkedItems:[...range(1,11),13]}];
const HOL=['2026-10-03','2026-10-09'];
const CTX={disclosureVersions:VER,contractTemplates:TPL,holidays:HOL,forecast:{sme:true,storesAtFyEnd:3}};
const e=(id,doc,t,x={})=>({id,doc,method:'electronic',deliveredAt:t,recordedAt:t,evidence:{electronic:{channel:'email',receivedAt:t,printable:true}},versionId:doc==='disclosure'?'dv1':undefined,templateId:doc==='draft'?'tpl1':undefined,...x});
const L=t=>({deliveries:[e('d1','disclosure',t),e('n1','nearby',t),e('r1','draft',t)]});
const T10='2026-10-05T10:00:00+09:00';
const ADV=(target,date,x={})=>({id:'adv-'+target,advisorType:'attorney',registrationVerified:true,advisedOn:date,targetDoc:target,hqPaid:false,hqReferred:false,...x});
const APPROVE={role:'admin',reasonCode:'late_entry',auditEventId:'audit-1'};
const C=t=>({signedAt:t,recordedAt:t});
const W=(lead,now)=>fg.earliestContractAt({...CTX,deliveries:lead.deliveries,advice:lead.advice},now);
const HAND_OK={receiptDateTimePlaceHandwritten:true,nameAddressPhoneHandwritten:true,signatureHandwritten:true,hqSigned:true,confirmationGiven:true};
const withoutReceipt=d=>({...d,evidence:{electronic:{channel:'email',printable:true}}});
const contracted=(lead,t,ctx=CTX)=>fg.checkTransition({...lead,contract:C(t)},'contracted',t,ctx);

// 0) 순수성: 시계·네트워크 없음, import는 './franchise-rules' 한 줄
const src=readFileSync('lib/franchise-gates.ts','utf8');
const imports=src.match(/^\s*import\s.*$/gm)||[];
check('gates module imports only ./franchise-rules without extension',imports.length===1&&/from '\.\/franchise-rules';$/.test(imports[0].trim())&&!src.includes("franchise-rules.ts'"));
// 줄 주석을 뺀 원문에서 시계·난수·환경·네트워크 접근 형태를 찾는다(new Date;·Date()·Date['now']·Reflect.construct 우회 포함). 인자 있는 new Date(ms)와 Date.UTC만 허용한다.
const code=src.replace(/^\s*\/\/.*$/gm,'');
const CLOCK=/(?<!new\s+)\bDate\s*\(|new\s+Date\b(?!\s*\(\s*[^)\s])|\bDate\s*\[|\bDate\.(now|parse)\b|Reflect\.construct|performance\.|Math\.random|\bprocess\.|\bcrypto\.|globalThis|\beval\s*\(|\bFunction\s*\(/;
check('clock pattern catches the bypass forms',['new Date;','new Date ()','Date()','Date["now"]()','Date.parse(x)','Reflect.construct(Date,[])','Math.random()','process.env.X'].every(x=>CLOCK.test(x))&&!CLOCK.test('new Date(ms).getUTCDay()')&&!CLOCK.test('Date.UTC(y,m,0)'));
check('gates module does not read the clock, randomness or environment',!CLOCK.test(code));
check('gates module makes no network call and uses no any',!/\bfetch\s*\(|\bnew\s+URL\b|\bURL\s*\(/.test(code)&&!/\bany\b/.test(code));

// 1) 상수·대조표
check('reason codes are the 24 sorted unique codes',fg.REASON_CODES.length===24&&fg.REASON_CODES.every((c,i)=>i===0||fg.REASON_CODES[i-1]<c));
check('warning codes are the three advisories',same(fg.WARNING_CODES,['advisor_independence_unverified','application_date_unknown','holiday_calendar_unverified']));
check('gate rules carry versions, disclaimer and KST',fg.GATE_RULES.ruleVersion==='fr-gates@2026-09-25.1'&&fg.GATE_RULES.rulesVersion===fr.FRANCHISE_RULES_VERSION&&fg.GATE_RULES.disclaimer==='COLLECTIVE 휴리스틱 · 법률 자문 아님'&&fg.GATE_RULES.timezone==='+09:00'&&fg.GATE_DISCLAIMER===fg.GATE_RULES.disclaimer);
const ruleIds=new Set(fr.FRANCHISE_RULES.map(r=>r.id));
check('every gate rule id exists in the registry',fg.GATE_RULES.ruleIds.every(id=>ruleIds.has(id))&&fg.GATE_RULES.ruleIds.includes('h.last_day_holiday_extension'));
check('reason map covers every reason and warning code exactly',same(Object.keys(fg.REASON_RULES).sort(),[...fg.REASON_CODES,...fg.WARNING_CODES].sort()));
check('every rule referenced by the reason map exists in the registry',Object.values(fg.REASON_RULES).every(list=>list.every(id=>ruleIds.has(id))));
check('substantive codes cite at least one rule, input codes cite none',Object.entries(fg.REASON_RULES).every(([code,list])=>code.startsWith('invalid_')?list.length===0:list.length>0));
check('contract_too_early cites the holiday extension rule',fg.REASON_RULES.contract_too_early.includes('h.last_day_holiday_extension')&&fg.REASON_RULES.fee_too_early.includes('h.last_day_holiday_extension'));
check('exported constants are deeply frozen',[fg.ID_PATTERN,fg.APPROVAL_REASON_PATTERN,fg.LEAD_STAGES,fg.REASON_CODES,fg.WARNING_CODES,fg.REASON_RULES,fg.REASON_RULES.contract_too_early,fg.GATE_RULES,fg.GATE_RULES.ruleIds,fg.DELIVERY_DOCS,fg.DELIVERY_METHODS,fg.ALLOWED_METHODS,fg.ELECTRONIC_CHANNELS,fg.ADVISOR_TYPES,fg.ESCROW_INSTITUTIONS,fg.FEE_CATEGORIES,fg.ESCROW_REQUIRED_CATEGORIES,fg.AMENDMENT_ITEMS,fg.LIMITS].every(Object.isFrozen));
check('ftc_link is a known method but not an allowed one',fg.DELIVERY_METHODS.includes('ftc_link')&&!fg.ALLOWED_METHODS.includes('ftc_link')&&fg.CONTRACT_ITEM_COUNT===13&&fg.AMENDMENT_ITEMS.length===21);

// 2) templateComplete·waitingPeriod
check('template with 1..13 (duplicates ignored) is complete',fg.templateComplete({checkedItems:[...range(1,13),13]}));
check('template with 0 or a missing item is incomplete',!fg.templateComplete({checkedItems:range(0,12)})&&!fg.templateComplete({checkedItems:range(1,12)})&&!fg.templateComplete({checkedItems:[...range(1,13),14]})&&!fg.templateComplete({checkedItems:[...range(1,12),'13']})&&!fg.templateComplete({checkedItems:[...range(1,12),12.5,13]})&&!fg.templateComplete({})&&!fg.templateComplete(null));
check('waiting period ends on a weekday without extension',same(fg.waitingPeriod('2026-10-05',14,HOL),{periodEnd:'2026-10-19',opensAt:'2026-10-20T00:00:00+09:00',extended:false,calendarVerified:true}));
check('saturday end moves to monday',same(fg.waitingPeriod('2026-10-03',14,HOL),{periodEnd:'2026-10-19',opensAt:'2026-10-20T00:00:00+09:00',extended:true,calendarVerified:true}));
check('holiday end runs through the weekend',same(fg.waitingPeriod('2026-09-25',14,['2026-10-09']),{periodEnd:'2026-10-12',opensAt:'2026-10-13T00:00:00+09:00',extended:true,calendarVerified:true}));
check('without a calendar only weekends extend and the calendar is unverified',same(fg.waitingPeriod('2026-09-25',14),{periodEnd:'2026-10-09',opensAt:'2026-10-10T00:00:00+09:00',extended:false,calendarVerified:false})&&same(fg.waitingPeriod('2026-09-25',14,[]),{periodEnd:'2026-10-09',opensAt:'2026-10-10T00:00:00+09:00',extended:false,calendarVerified:false}));
check('a friday end opens on saturday (only the last day extends)',fg.waitingPeriod('2026-10-30',14,HOL).opensAt==='2026-11-14T00:00:00+09:00');
check('a holiday start day changes nothing',same(pick(fg.waitingPeriod('2026-10-09',14,HOL),['periodEnd','opensAt','extended']),pick(plain(fg.waitingPeriod('2026-10-09',14,['2026-12-25'])),['periodEnd','opensAt','extended'])));
const throwsDate=(fn,input)=>{try{fn()}catch(err){return err?.name==='FranchiseInputError'&&err.code==='invalid_date'&&!err.message.includes(input)}return false};
check('waitingPeriod throws invalid_date for bad start or holidays',throwsDate(()=>fg.waitingPeriod('2026-10-05T00:00:00+09:00',14),'2026-10-05T00')&&throwsDate(()=>fg.waitingPeriod('2026-10-05',14,['2026-13-01']),'2026-13-01')&&throwsDate(()=>fg.waitingPeriod('2026-10-05',10),'2026-10-05'));
// 평일 400일을 모두 공휴일로 주면 주말을 합쳐 연장이 LIMITS.holidays+10회를 넘는다(무한 반복 방지).
const endless=Array.from({length:600},(_,i)=>fr.addDays('2026-10-19',i)).filter(d=>fr.weekdayOf(d)%6!==0).slice(0,400);
check('an absurd holiday run stops at the loop bound',endless.length===400&&throwsDate(()=>fg.waitingPeriod('2026-10-05',14,endless),'2026'));

// 3) 벡터 v1: 2026-10-05 23:59 KST 제공 → 10-20 00:00 KST부터(말일 10-19 월요일)
const v1=W(L('2026-10-05T23:59:00+09:00'),'2026-10-06T09:00:00+09:00');
const S14={startDate:'2026-10-05',days:14,periodEnd:'2026-10-19',opensAt:'2026-10-20T00:00:00+09:00',shortened:false,extended:false};
check('v1: contract opens at 2026-10-20 00:00 KST',v1.at==='2026-10-20T00:00:00+09:00');
check('v1: both sides count 14 days from 10-05',same(side(v1.disclosureSide),S14)&&same(side(v1.draftSide),S14));
check('v1: nothing blocks, notes or warns',same(v1.blockers,[])&&same(v1.notes,[])&&same(v1.warnings,[]));
check('v1: three deliveries counted on 10-05',v1.deliveries.length===3&&v1.deliveries.every(d=>d.accepted&&d.counted&&d.effectiveDate==='2026-10-05'&&same(d.reasons,[])));
check('v1: window carries rule version and disclaimer',v1.ruleVersion==='fr-gates@2026-09-25.1'&&v1.disclaimer==='COLLECTIVE 휴리스틱 · 법률 자문 아님');
check('v1: sides record the rules applied',same(v1.disclosureSide.ruleIds,['h.evidence_integrity','h.first_day_excluded','h.last_day_holiday_extension','h.later_disclosure_doc','kr.fr.delivery_methods','kr.fr.disclosure_wait','kr.fr.nearby_doc'])&&same(v1.draftSide.ruleIds,['h.evidence_integrity','h.first_day_excluded','h.last_day_holiday_extension','kr.fr.draft_wait']));
// 시나리오 (1)(2): D+14 말일의 23:59는 불가, 그다음 날 00:00은 허용
const b1=contracted(L('2026-10-05T23:59:00+09:00'),'2026-10-19T23:59:00+09:00');
const b2=contracted(L('2026-10-05T23:59:00+09:00'),'2026-10-19T23:59:59.999+09:00');
const b3=contracted(L('2026-10-05T23:59:00+09:00'),'2026-10-20T00:00:00+09:00');
check('scenario 2: contract at 10-19 23:59 KST is too early',!b1.ok&&same(b1.reasons,E('contract_too_early')));
check('scenario 2: contract at 10-19 23:59:59.999 KST is too early',!b2.ok&&same(b2.reasons,['contract_too_early']));
check('scenario 1: contract at 10-20 00:00 KST passes',b3.ok&&same(b3.reasons,[])&&same(b3.warnings,[])&&b3.window?.at==='2026-10-20T00:00:00+09:00'&&b3.disclaimer==='COLLECTIVE 휴리스틱 · 법률 자문 아님');
check('first day is excluded even at 00:00:00 sharp',W(L('2026-10-05T00:00:00+09:00'),'2026-10-06T09:00:00+09:00').at==='2026-10-20T00:00:00+09:00');

// 4) 7일 단축 벡터: 두 문서 모두 자문 → 10-13 00:00부터(말일 10-12 월요일)
const lead7={...L('2026-10-05T23:59:00+09:00'),advice:[ADV('disclosure','2026-10-06'),ADV('draft','2026-10-06')]};
const w7=W(lead7,'2026-10-07T09:00:00+09:00');
const S7={startDate:'2026-10-05',days:7,periodEnd:'2026-10-12',opensAt:'2026-10-13T00:00:00+09:00',shortened:true,extended:false};
check('7-day: both sides shortened to 10-12, open 10-13',w7.at==='2026-10-13T00:00:00+09:00'&&same(side(w7.disclosureSide),S7)&&same(side(w7.draftSide),S7)&&same(w7.warnings,[]));
check('7-day: shortened sides cite the advice rule',w7.disclosureSide.ruleIds.includes('h.advice_shortening_evidence')&&w7.draftSide.ruleIds.includes('h.advice_shortening_evidence'));
check('7-day: contract at 10-12 23:59 is too early',same(fg.checkTransition({...lead7,contract:C('2026-10-12T23:59:00+09:00')},'contracted','2026-10-12T23:59:00+09:00',CTX).reasons,['contract_too_early']));
check('7-day: contract at 10-13 00:00 passes',fg.checkTransition({...lead7,contract:C('2026-10-13T00:00:00+09:00')},'contracted','2026-10-13T00:00:00+09:00',CTX).ok);
check('7-day: opening never precedes the day after the advice',W({...L(T10),advice:[ADV('disclosure','2026-10-13'),ADV('draft','2026-10-06')]},'2026-10-14T09:00:00+09:00').disclosureSide.opensAt==='2026-10-14T00:00:00+09:00');

// 5) 벡터 v2: UTC 오프셋. 2026-10-05T15:30Z는 KST 10-06 제공
const v2=W(L('2026-10-05T15:30Z'),'2026-10-06T12:00:00+09:00');
check('v2: toKstDate splits at 15:00Z',fg&&fr.toKstDate('2026-10-05T15:30Z')==='2026-10-06'&&fr.toKstDate('2026-10-05T14:59:59Z')==='2026-10-05');
check('v2: deliveries count on KST 10-06 and open 10-21',v2.deliveries.every(d=>d.effectiveDate==='2026-10-06')&&v2.disclosureSide.startDate==='2026-10-06'&&v2.draftSide.startDate==='2026-10-06'&&v2.disclosureSide.periodEnd==='2026-10-20'&&v2.at==='2026-10-21T00:00:00+09:00');

// 6) 벡터 v3: 정보공개서 10-01·인근 10-03·계약서안 10-05, 자문 없음 → 10-20 (시나리오 4, H1)
const v3d=[e('d1','disclosure','2026-10-01T10:00:00+09:00'),e('n1','nearby','2026-10-03T10:00:00+09:00'),e('r1','draft','2026-10-05T10:00:00+09:00')];
const v3=fg.earliestContractAt({...CTX,deliveries:v3d},'2026-10-06T09:00:00+09:00');
check('v3: disclosure side starts at the later nearby doc and extends 10-17 (sat) to 10-19',same(side(v3.disclosureSide),{startDate:'2026-10-03',days:14,periodEnd:'2026-10-19',opensAt:'2026-10-20T00:00:00+09:00',shortened:false,extended:true}));
check('v3: draft side ends 10-19',same(side(v3.draftSide),{startDate:'2026-10-05',days:14,periodEnd:'2026-10-19',opensAt:'2026-10-20T00:00:00+09:00',shortened:false,extended:false}));
check('v3: final result is 10-20 as planned',v3.at==='2026-10-20T00:00:00+09:00'&&same(v3.blockers,[])&&same(v3.warnings,[]));
check('scenario 4: the earlier disclosure record is accepted and counted',same(pick(fg.assessDelivery(v3d[0],CTX,'2026-10-06T09:00:00+09:00'),['accepted','counted','effectiveDate','reasons']),{accepted:true,counted:true,effectiveDate:'2026-10-01',reasons:[]}));

// 7) 벡터 v4(대표 지시 반영): 정보공개서만 자문 → 정보공개서 쪽 10-10(토)→10-12(월), 10-13 00:00. 결과 10-20
const v4=fg.earliestContractAt({...CTX,deliveries:v3d,advice:[ADV('disclosure','2026-10-04')]},'2026-10-06T09:00:00+09:00');
check('v4: disclosure side shortened and extended to 10-12',same(side(v4.disclosureSide),{startDate:'2026-10-03',days:7,periodEnd:'2026-10-12',opensAt:'2026-10-13T00:00:00+09:00',shortened:true,extended:true}));
check('v4: draft side still decides 10-20',v4.draftSide.opensAt==='2026-10-20T00:00:00+09:00'&&v4.at==='2026-10-20T00:00:00+09:00'&&same(v4.warnings,[]));
// 시나리오 (3): 정보공개서만 자문 7일이면 계약서안 14일 쪽이 결과
const lead3={...L(T10),advice:[ADV('disclosure','2026-10-06')]};
const w3=W(lead3,'2026-10-07T09:00:00+09:00');
const t3=fg.checkTransition({...lead3,contract:C('2026-10-13T00:00:00+09:00')},'contracted','2026-10-13T00:00:00+09:00',CTX);
check('scenario 3: disclosure side 7 days, draft side 14 decides',w3.disclosureSide.days===7&&w3.disclosureSide.periodEnd==='2026-10-12'&&w3.disclosureSide.opensAt==='2026-10-13T00:00:00+09:00'&&w3.draftSide.opensAt==='2026-10-20T00:00:00+09:00'&&w3.at==='2026-10-20T00:00:00+09:00');
check('scenario 3: contract on 10-13 is too early without shortening note',same(t3.reasons,['contract_too_early'])&&same(w3.notes,[]));

// 8) 월말·말일 연장(대표 지시): 연장은 말일에만
const mf=W(L('2026-10-30T10:00:00+09:00'),'2026-10-31T09:00:00+09:00');
check('month end: 10-30 delivery ends friday 11-13 and opens saturday 11-14',mf.disclosureSide.periodEnd==='2026-11-13'&&mf.draftSide.periodEnd==='2026-11-13'&&!mf.disclosureSide.extended&&mf.at==='2026-11-14T00:00:00+09:00');
const ms=W(L('2026-10-31T10:00:00+09:00'),'2026-11-01T09:00:00+09:00');
check('month end: 10-31 delivery ends saturday 11-14, extends to monday 11-16',ms.disclosureSide.periodEnd==='2026-11-16'&&ms.draftSide.periodEnd==='2026-11-16'&&ms.disclosureSide.extended&&ms.draftSide.extended&&ms.at==='2026-11-17T00:00:00+09:00');
const hd=L('2026-09-25T10:00:00+09:00').deliveries,hNow='2026-09-26T09:00:00+09:00';
const hw=fg.earliestContractAt({...CTX,holidays:['2026-10-09'],deliveries:hd},hNow);
check('hangul day: last day 10-09 is a listed holiday, runs to monday 10-12',hw.disclosureSide.periodEnd==='2026-10-12'&&hw.draftSide.periodEnd==='2026-10-12'&&hw.at==='2026-10-13T00:00:00+09:00'&&same(hw.warnings,[]));
const CTX_NO_HOL=Object.fromEntries(Object.entries(CTX).filter(([k])=>k!=='holidays'));
for(const [label,ctx] of [['omitted',CTX_NO_HOL],['null',{...CTX,holidays:null}],['empty',{...CTX,holidays:[]}]]){
 const w=fg.earliestContractAt({...ctx,deliveries:hd},hNow);
 check(`hangul day with calendar ${label}: weekends only and a warning`,w.disclosureSide.periodEnd==='2026-10-09'&&w.at==='2026-10-10T00:00:00+09:00'&&same(w.warnings,E('holiday_calendar_unverified')));
}
const runD=L('2026-09-10T10:00:00+09:00').deliveries,runNow='2026-09-11T09:00:00+09:00';
const run=fg.earliestContractAt({...CTX,holidays:['2026-09-24','2026-09-25','2026-09-26','2026-09-28'],deliveries:runD},runNow);
check('synthetic holiday run skips holidays and the weekend to 09-29',run.disclosureSide.periodEnd==='2026-09-29'&&run.disclosureSide.extended&&run.at==='2026-09-30T00:00:00+09:00'&&same(run.warnings,[]));
const runNo=fg.earliestContractAt({...CTX_NO_HOL,deliveries:runD},runNow);
check('same delivery without a calendar opens 09-25 with a warning',runNo.disclosureSide.periodEnd==='2026-09-24'&&runNo.at==='2026-09-25T00:00:00+09:00'&&same(runNo.warnings,['holiday_calendar_unverified']));
for(const bad of [['2026-13-01'],['2026-10-09T00:00:00+09:00']]){
 const w=fg.earliestContractAt({...CTX,holidays:bad,deliveries:L(T10).deliveries},'2026-10-06T09:00:00+09:00');
 check(`invalid holiday ${bad[0]} closes the window without echo`,w.at===null&&same(w.blockers,E('invalid_date'))&&same(w.deliveries,[])&&!JSON.stringify(w).includes(bad[0]));
}
check('no side computed means no calendar warning',same(fg.earliestContractAt({...CTX_NO_HOL,deliveries:[]},'2026-10-06T09:00:00+09:00').warnings,[]));

// 9) 시나리오 (5): 변경 통지 뒤 재기산(H3)과 같은 방법 요구
const lead5={deliveries:[...L(T10).deliveries,e('c1','change_notice','2026-10-08T10:00:00+09:00')]};
const w5=W(lead5,'2026-10-09T09:00:00+09:00');
check('scenario 5: change notice restarts the disclosure side on 10-08',w5.disclosureSide.startDate==='2026-10-08'&&w5.disclosureSide.periodEnd==='2026-10-22'&&w5.disclosureSide.opensAt==='2026-10-23T00:00:00+09:00'&&w5.at==='2026-10-23T00:00:00+09:00'&&w5.disclosureSide.ruleIds.includes('h.change_notice_restart'));
check('scenario 5: contract on 10-22 23:59 is too early',same(contracted(lead5,'2026-10-22T23:59:00+09:00').reasons,['contract_too_early']));
const w5a=W({...lead5,advice:[ADV('disclosure','2026-10-06'),ADV('draft','2026-10-06')]},'2026-10-09T09:00:00+09:00');
check('scenario 5: disclosure advice before the restart no longer shortens',w5a.disclosureSide.days===14&&w5a.draftSide.days===7&&w5a.draftSide.opensAt==='2026-10-13T00:00:00+09:00'&&w5a.at==='2026-10-23T00:00:00+09:00'&&same(w5a.notes,E('shortening_unproven')));
const handNotice={id:'c1',doc:'change_notice',method:'hand',deliveredAt:'2026-10-08T10:00:00+09:00',recordedAt:'2026-10-08T10:00:00+09:00',evidence:{hand:HAND_OK}};
const lead5m={deliveries:[...L(T10).deliveries,handNotice]};
const w5m=W(lead5m,'2026-10-09T09:00:00+09:00');
check('scenario 5: a hand change notice alone would count',fg.assessDelivery(handNotice,CTX,'2026-10-09T09:00:00+09:00').counted);
check('scenario 5: notice by a different method than the disclosure is not counted',same(pick(w5m.deliveries.find(d=>d.id==='c1'),['accepted','counted','reasons']),{accepted:true,counted:false,reasons:E('change_notice_method_mismatch')}));
check('scenario 5: method mismatch blocks the window',w5m.at===null&&same(w5m.blockers,['change_notice_method_mismatch']));
check('scenario 5: method mismatch blocks the contract',same(contracted(lead5m,'2026-10-23T00:00:00+09:00').reasons,['change_notice_method_mismatch']));

// 10) 시나리오 (6): 1호 자필·본부 서명·확인서 교부 누락은 기록되지만 타이머 미시작·계약 409
const hand=(x={})=>({id:'d1',doc:'disclosure',method:'hand',deliveredAt:T10,recordedAt:T10,versionId:'dv1',evidence:{hand:{...HAND_OK,...x}}});
const n1=e('n1','nearby',T10),r1=e('r1','draft',T10);
for(const [label,d1] of [['signature not handwritten',hand({signatureHandwritten:false})],['confirmation not given',hand({confirmationGiven:false})],['hq not signed',hand({hqSigned:false})],['no hand evidence',{...hand(),evidence:{}}]]){
 const a=fg.assessDelivery(d1,CTX,'2026-10-06T09:00:00+09:00');
 check(`scenario 6 (${label}): recorded but not counted`,same(pick(a,['accepted','counted','effectiveAt','reasons']),{accepted:true,counted:false,effectiveAt:null,reasons:E('evidence_incomplete')}));
 check(`scenario 6 (${label}): disclosed stage accepts the record`,fg.checkTransition({deliveries:[d1,n1,r1]},'disclosed','2026-10-06T09:00:00+09:00',CTX).ok);
 check(`scenario 6 (${label}): contract is blocked`,same(contracted({deliveries:[d1,n1,r1]},'2026-10-20T00:00:00+09:00').reasons,E('disclosure_missing','evidence_incomplete')));
}
check('complete hand evidence counts from the handwritten time',same(pick(fg.assessDelivery(hand(),CTX,'2026-10-06T09:00:00+09:00'),['counted','effectiveAt','effectiveDate','method']),{counted:true,effectiveAt:T10,effectiveDate:'2026-10-05',method:'hand'}));
const mail=(x)=>({id:'d1',doc:'disclosure',method:'certified_mail',deliveredAt:T10,recordedAt:T10,versionId:'dv1',evidence:{certifiedMail:x}});
check('certified mail counts from the filing time when receipt is confirmed',fg.assessDelivery(mail({receiptConfirmed:true}),CTX,'2026-10-06T09:00:00+09:00').effectiveDate==='2026-10-05');
check('certified mail without confirmation is incomplete',same(fg.assessDelivery(mail({receiptConfirmed:false}),CTX,'2026-10-06T09:00:00+09:00').reasons,['evidence_incomplete'])&&same(fg.assessDelivery({...mail({}),evidence:undefined},CTX,'2026-10-06T09:00:00+09:00').reasons,['evidence_incomplete']));

// 11) 시나리오 (7): 4호 수신 시각 없음은 제공 미성립(H5)
const d7=withoutReceipt(e('d1','disclosure',T10));
check('scenario 7: electronic without receipt time is not counted',same(pick(fg.assessDelivery(d7,CTX,'2026-10-06T09:00:00+09:00'),['accepted','counted','reasons']),{accepted:true,counted:false,reasons:E('receipt_unconfirmed')}));
check('scenario 7: contract without receipt time is blocked',same(contracted({deliveries:[d7,n1,r1]},'2026-10-20T00:00:00+09:00').reasons,['disclosure_missing','receipt_unconfirmed']));
check('electronic evidence that is not printable is incomplete',same(fg.assessDelivery(e('d1','disclosure',T10,{evidence:{electronic:{channel:'email',receivedAt:T10,printable:false}}}),CTX,'2026-10-06T09:00:00+09:00').reasons,['evidence_incomplete']));
check('electronic channel outside email/sms/app is incomplete',same(fg.assessDelivery(e('d1','disclosure',T10,{evidence:{electronic:{channel:'kakao',receivedAt:T10,printable:true}}}),CTX,'2026-10-06T09:00:00+09:00').reasons,['evidence_incomplete']));
check('electronic without any evidence object misses both',same(fg.assessDelivery(e('d1','disclosure',T10,{evidence:{}}),CTX,'2026-10-06T09:00:00+09:00').reasons,['evidence_incomplete','receipt_unconfirmed']));
const early=e('d1','disclosure',T10,{evidence:{electronic:{channel:'email',receivedAt:'2026-10-05T09:00:00+09:00',printable:true}},backdateApproval:APPROVE});
check('receipt before sending is incomplete even with approval',same(pick(fg.assessDelivery(early,CTX,'2026-10-06T09:00:00+09:00'),['accepted','counted','reasons']),{accepted:true,counted:false,reasons:['evidence_incomplete']}));
const late=e('d1','disclosure','2026-10-05T23:00:00+09:00',{recordedAt:'2026-10-06T01:00:00+09:00',evidence:{electronic:{channel:'sms',receivedAt:'2026-10-06T00:30:00+09:00',printable:true}},backdateApproval:APPROVE});
check('electronic counts from the receipt time (KST 10-06)',same(pick(fg.assessDelivery(late,CTX,'2026-10-06T09:00:00+09:00'),['counted','effectiveAt','effectiveDate']),{counted:true,effectiveAt:'2026-10-06T00:30:00+09:00',effectiveDate:'2026-10-06'}));

// 12) 시나리오 (8): 가맹금 예치·보험·시점
const fee=(x={})=>({id:'f1',category:'a_join',recordedAt:'2026-10-20T10:00:00+09:00',escrow:{institutionType:'bank',firstDepositAt:'2026-10-20T10:00:00+09:00',agreementAt:null},...x});
const feeT='2026-10-20T10:00:00+09:00';
const escrowed=(lead,now=feeT)=>fg.checkTransition(lead,'fee_escrowed',now,CTX);
const f8=escrowed({...L(T10),fees:[fee()]});
check('scenario 8: escrowed join fee after the window passes',f8.ok&&same(f8.reasons,[])&&f8.window?.at==='2026-10-20T00:00:00+09:00');
check('scenario 8: join fee paid directly without escrow is unproven',same(escrowed({...L(T10),fees:[fee({escrow:undefined,paidAt:feeT})]}).reasons,E('escrow_unproven')));
check('scenario 8: escrow without an agreementAt key is unproven',same(escrowed({...L(T10),fees:[fee({escrow:{institutionType:'bank',firstDepositAt:feeT}})]}).reasons,['escrow_unproven']));
check('scenario 8: a payment gateway is not an escrow institution',same(escrowed({...L(T10),fees:[fee({escrow:{institutionType:'pg',firstDepositAt:feeT,agreementAt:null}})]}).reasons,['escrow_unproven']));
check('scenario 8: fee_escrowed without fee records is invalid',same(escrowed({...L(T10),fees:[]}).reasons,E('invalid_record'))&&same(escrowed(L(T10)).reasons,['invalid_record']));
check('scenario 8: fee while a document is missing is too early with the gap',same(escrowed({deliveries:[e('d1','disclosure',T10),e('r1','draft',T10)],fees:[fee()]}).reasons,E('fee_too_early','nearby_missing')));
const agreed=x=>fee({escrow:{institutionType:'bank',firstDepositAt:feeT,agreementAt:'2026-10-15T10:00:00+09:00'},...x});
check('scenario 8: an escrow agreement before the window is too early',same(escrowed({...L(T10),fees:[agreed({backdateApproval:APPROVE})]}).reasons,E('fee_too_early')));
check('scenario 8: an unapproved backdated agreement is also flagged',same(escrowed({...L(T10),fees:[agreed()]}).reasons,E('backdate_unapproved','fee_too_early')));
const t19='2026-10-19T10:00:00+09:00';
check('scenario 8: first deposit on 10-19 is too early',same(escrowed({...L(T10),fees:[fee({recordedAt:t19,escrow:{institutionType:'bank',firstDepositAt:t19,agreementAt:null}})]},t19).reasons,['fee_too_early']));
const ins=x=>({id:'f2',category:'a_join',recordedAt:feeT,paidAt:feeT,insurance:{coverageFrom:'2026-01-01T00:00:00+09:00',coverageTo:'2027-01-01T00:00:00+09:00'},...x});
check('scenario 8: damage insurance covering the payment passes',escrowed({...L(T10),fees:[ins()]}).ok);
check('scenario 8: insurance ending before the payment is unproven',same(escrowed({...L(T10),fees:[ins({insurance:{coverageFrom:'2026-01-01T00:00:00+09:00',coverageTo:'2026-10-20T00:00:00+09:00'}})]}).reasons,['escrow_unproven']));
check('insurance without paidAt is an invalid record',same(escrowed({...L(T10),fees:[ins({paidAt:undefined})]}).reasons,['invalid_record']));
const f3=x=>({id:'f3',category:'c_opening',recordedAt:t19,paidAt:t19,...x});
check('opening costs are fees: paid on 10-19 is too early (no escrow required)',same(escrowed({...L(T10),fees:[f3()]},t19).reasons,['fee_too_early']));
check('opening costs paid on 10-20 pass',escrowed({...L(T10),fees:[f3({recordedAt:feeT,paidAt:feeT})]}).ok);
check('unknown fee category is invalid',same(escrowed({...L(T10),fees:[f3({category:'deposit'})]},t19).reasons,['invalid_record']));
check('other-consideration fees need escrow too',same(escrowed({...L(T10),fees:[f3({category:'e_other',recordedAt:feeT,paidAt:feeT})]}).reasons,['escrow_unproven']));
check('a non-escrow fee without paidAt is invalid',same(escrowed({...L(T10),fees:[{id:'f4',category:'d_periodic',recordedAt:feeT}]}).reasons,['invalid_record']));
check('a fee recorded in the future is a future event',same(escrowed({...L(T10),fees:[fee({recordedAt:'2026-10-21T10:00:00+09:00',escrow:{institutionType:'bank',firstDepositAt:'2026-10-21T10:00:00+09:00',agreementAt:null}})]}).reasons,E('future_event')));
check('conflicting fee records with one id are invalid',same(escrowed({...L(T10),fees:[fee(),fee({escrow:{institutionType:'trust',firstDepositAt:feeT,agreementAt:null}})]}).reasons,['invalid_record'])&&escrowed({...L(T10),fees:[fee(),structuredClone(fee())]}).ok);
check('too many fee records fail closed',same(escrowed({...L(T10),fees:Array.from({length:51},(_,i)=>fee({id:'f'+i}))}).reasons,['invalid_record']));
const wNear=fg.earliestContractAt({...CTX,deliveries:[e('d1','disclosure',T10),e('r1','draft',T10)]},feeT);
const fDirect=fg.checkFee(fee(),wNear,feeT);
check('checkFee with a blocked window reports the blockers and carries the disclaimer',same(fDirect.reasons,['fee_too_early','nearby_missing'])&&fDirect.ruleVersion==='fr-gates@2026-09-25.1'&&fDirect.disclaimer==='COLLECTIVE 휴리스틱 · 법률 자문 아님'&&!('window' in fDirect));
check('checkFee reads only known codes from a forged window',same(fg.checkFee(fee(),{at:null,blockers:['nearby_missing','<script>'],notes:[],warnings:['x']},feeT).reasons,['fee_too_early','nearby_missing']));
check('checkFee adds the shortening note only when too early',same(fg.checkFee(fee({recordedAt:t19,escrow:{institutionType:'bank',firstDepositAt:t19,agreementAt:null}}),{...wNear,at:'2026-10-20T00:00:00+09:00',blockers:[],notes:['shortening_unproven']},t19).reasons,['fee_too_early','shortening_unproven']));

// 13) 시나리오 (9): 산정서 의무·미확인이면 서면 산정서 없는 계약 409
const lead9={...L(T10),contract:C('2026-10-20T00:00:00+09:00')},t9='2026-10-20T00:00:00+09:00';
const stmt=(x={})=>({providedAt:t9,recordedAt:t9,written:true,...x});
const c9=(forecast,statement,now=t9,lead=lead9)=>fg.checkTransition({...lead,forecastStatement:statement},'contracted',now,{...CTX,forecast});
check('scenario 9: unknown SME status without a statement blocks',same(c9({sme:null,storesAtFyEnd:5}).reasons,E('forecast_statement_missing')));
check('scenario 9: a written statement given before signing passes',c9({sme:null,storesAtFyEnd:5},stmt()).ok);
check('scenario 9: a non-SME brand needs the statement',same(c9({sme:false,storesAtFyEnd:10}).reasons,['forecast_statement_missing']));
check('scenario 9: omitted forecast inputs count as unknown',same(c9(undefined).reasons,['forecast_statement_missing'])&&same(c9(null).reasons,['forecast_statement_missing']));
check('scenario 9: an SME with 12 stores needs no statement',c9({sme:true,storesAtFyEnd:12}).ok);
check('scenario 9: an oral (non-written) statement does not count',same(c9({sme:false,storesAtFyEnd:10},stmt({written:false})).reasons,['forecast_statement_missing']));
const t9b='2026-10-20T00:00:01+09:00';
check('scenario 9: a statement given after signing does not count',same(c9({sme:false,storesAtFyEnd:10},stmt({providedAt:t9b,recordedAt:t9b}),t9b).reasons,['forecast_statement_missing']));
check('a backdated statement needs approval',same(c9({sme:false,storesAtFyEnd:10},stmt({providedAt:'2026-10-19T09:00:00+09:00'})).reasons,['backdate_unapproved','forecast_statement_missing'])&&c9({sme:false,storesAtFyEnd:10},stmt({providedAt:'2026-10-19T09:00:00+09:00',backdateApproval:APPROVE})).ok);
check('a statement recorded in the future is a future event',same(c9({sme:false,storesAtFyEnd:10},stmt({providedAt:'2026-10-21T00:00:00+09:00',recordedAt:'2026-10-21T00:00:00+09:00'})).reasons,['forecast_statement_missing','future_event']));
check('forecast duty: four combinations',fg.forecastDuty({sme:true,storesAtFyEnd:99})==='not_required'&&fg.forecastDuty({sme:true,storesAtFyEnd:100})==='required'&&fg.forecastDuty({sme:false,storesAtFyEnd:99})==='required'&&fg.forecastDuty({sme:false,storesAtFyEnd:100})==='required'&&fg.forecastDuty({sme:true,storesAtFyEnd:0})==='not_required');
check('forecast duty: any unknown input is unknown',[{sme:null,storesAtFyEnd:5},{sme:true},{sme:false,storesAtFyEnd:null},{sme:true,storesAtFyEnd:-1},{sme:true,storesAtFyEnd:12.5},{sme:'yes',storesAtFyEnd:5},{sme:true,storesAtFyEnd:NaN},{}].every(x=>fg.forecastDuty(x)==='unknown')&&fg.forecastDuty(undefined)==='unknown'&&fg.forecastDuty(null)==='unknown');

// 14) 시나리오 (12): 클라이언트 시각 조작 무시, 기록 시각보다 이른 증빙 시각은 승인 표지 필요
const d12=x=>({...e('d1','disclosure',T10),recordedAt:'2026-10-07T09:00:00+09:00',...x});
const n12='2026-10-07T09:00:00+09:00';
check('scenario 12: a backdated delivery without approval is refused',same(pick(fg.assessDelivery(d12(),CTX,n12),['accepted','counted','effectiveAt','reasons']),{accepted:false,counted:false,effectiveAt:null,reasons:E('backdate_unapproved')}));
check('scenario 12: with owner/admin approval it counts from the evidence date',same(pick(fg.assessDelivery(d12({backdateApproval:APPROVE}),CTX,n12),['accepted','counted','effectiveDate','reasons']),{accepted:true,counted:true,effectiveDate:'2026-10-05',reasons:[]}));
check('scenario 12: owner approval needs the same three parts',fg.assessDelivery(d12({backdateApproval:{...APPROVE,role:'owner'}}),CTX,n12).counted&&!fg.assessDelivery(d12({backdateApproval:{role:'owner'}}),CTX,n12).accepted);
for(const [label,approval] of [['staff role',{...APPROVE,role:'staff'}],['empty audit id',{...APPROVE,auditEventId:''}],['korean reason',{...APPROVE,reasonCode:'늦은입력'}],['spaced reason',{...APPROVE,reasonCode:'late entry'}],['null approval',null]]){
 check(`scenario 12: ${label} is not an approval`,same(fg.assessDelivery(d12({backdateApproval:approval}),CTX,n12).reasons,['backdate_unapproved']));
}
check('future delivery: recorded after now is refused',same(pick(fg.assessDelivery(e('d1','disclosure','2026-10-08T00:00:00+09:00'),CTX,'2026-10-07T23:59:59+09:00'),['accepted','reasons']),{accepted:false,reasons:E('future_delivery')}));
check('future delivery: delivered after it was recorded is refused',same(fg.assessDelivery({...e('d1','disclosure','2026-10-06T10:00:00+09:00'),recordedAt:'2026-10-05T10:00:00+09:00'},CTX,'2026-10-07T00:00:00+09:00').reasons,['future_delivery']));
check('future delivery: receipt after the record time is refused',same(fg.assessDelivery(e('d1','disclosure',T10,{evidence:{electronic:{channel:'email',receivedAt:'2026-10-08T00:00:00+09:00',printable:true}}}),CTX,'2026-10-09T00:00:00+09:00').reasons,['future_delivery']));
check('a refused record blocks the window',same(fg.earliestContractAt({...CTX,deliveries:[d12(),n1,r1]},n12).blockers,['backdate_unapproved','disclosure_missing']));

// 15) 형식 오류 거부와 값 비노출
const BAD_TIMES=['2026-10-05T10:00:00','2026-10-05 10:00:00+09:00','2026-02-30T10:00:00+09:00','2026-10-05T24:00:00+09:00','2026-10-05T10:00:00-00:00','2026-10-05T10:00:00.1234+09:00','2026-10-05t10:00:00z','20261005T100000+0900'];
for(const bad of BAD_TIMES){
 const a=fg.assessDelivery({...e('d1','disclosure',T10),deliveredAt:bad},CTX,'2026-10-06T09:00:00+09:00');
 check(`timestamp ${bad} is refused without echo`,same(pick(a,['accepted','counted','effectiveAt','effectiveDate','reasons']),{accepted:false,counted:false,effectiveAt:null,effectiveDate:null,reasons:E('invalid_timestamp')})&&!JSON.stringify(a).includes(bad));
}
check('a bad receipt time is also an invalid timestamp',same(fg.assessDelivery(e('d1','disclosure',T10,{evidence:{electronic:{channel:'email',receivedAt:'2026-10-05',printable:true}}}),CTX,'2026-10-06T09:00:00+09:00').reasons,['invalid_timestamp']));
const badNow=fg.earliestContractAt({...CTX,deliveries:[]},'yesterday');
check('a bad now closes the window without echo',badNow.at===null&&same(badNow.blockers,['invalid_timestamp'])&&same(badNow.deliveries,[])&&!JSON.stringify(badNow).includes('yesterday')&&badNow.disclaimer==='COLLECTIVE 휴리스틱 · 법률 자문 아님');
check('assessDelivery with a bad now is an invalid timestamp',same(fg.assessDelivery(e('d1','disclosure',T10),CTX,'now').reasons,['invalid_timestamp']));
const FREE='홍길동-010-0000-5678';
const freeRec=fg.assessDelivery({...e('d1','disclosure',T10),id:FREE,method:FREE},CTX,'2026-10-06T09:00:00+09:00');
check('a free-text id is an invalid record and is not echoed',same(freeRec.reasons,['invalid_record'])&&freeRec.id===null&&!JSON.stringify(freeRec).includes(FREE));
const portal=fg.assessDelivery({...e('d1','disclosure',T10),method:FREE},CTX,'2026-10-06T09:00:00+09:00');
check('an unknown method string is refused and not echoed',same(portal.reasons,['method_not_allowed'])&&portal.method===null&&portal.id==='d1'&&!JSON.stringify(portal).includes(FREE));
check('invalid records: missing object, bad doc, non-string method',[null,'x',{...e('d1','disclosure',T10),doc:'brochure'},{...e('d1','disclosure',T10),method:3}].every(x=>same(fg.assessDelivery(x,CTX,'2026-10-06T09:00:00+09:00').reasons,['invalid_record'])));

// 16) 허용되지 않은 제공 방법(공정위 사이트 링크, 3호 포털)
const ftc=e('d1','disclosure',T10,{method:'ftc_link'});
check('ftc site link is not a legal delivery',same(pick(fg.assessDelivery(ftc,CTX,'2026-10-06T09:00:00+09:00'),['accepted','method','reasons']),{accepted:false,method:'ftc_link',reasons:E('method_not_allowed')}));
check('portal posting (3호) is refused before R11',same(fg.assessDelivery(e('d1','disclosure',T10,{method:'portal'}),CTX,'2026-10-06T09:00:00+09:00').reasons,['method_not_allowed']));
check('disclosed with only a site link is refused',same(fg.checkTransition({deliveries:[ftc]},'disclosed','2026-10-06T09:00:00+09:00',CTX).reasons,['method_not_allowed']));

// 17) 정보공개서 버전
const dv=v=>e('d1','disclosure',T10,{versionId:v});
check('unknown version is not registered',same(pick(fg.assessDelivery(dv('dv-none'),CTX,'2026-10-06T09:00:00+09:00'),['accepted','counted','reasons']),{accepted:true,counted:false,reasons:E('version_not_registered')}));
check('missing versionId is not registered',same(fg.assessDelivery(dv(undefined),CTX,'2026-10-06T09:00:00+09:00').reasons,['version_not_registered']));
check('unregistered version (registeredAt null) is not registered',same(fg.assessDelivery(dv('dv0'),CTX,'2026-10-06T09:00:00+09:00').reasons,['version_not_registered']));
check('expired version is not valid on the delivery day',same(pick(fg.assessDelivery(dv('dvx'),CTX,'2026-10-06T09:00:00+09:00'),['accepted','counted','reasons']),{accepted:true,counted:false,reasons:E('version_not_valid_on_delivery')}));
check('a version registered after delivery is not registered then',same(fg.assessDelivery(dv('dvlate'),CTX,'2026-10-06T09:00:00+09:00').reasons,['version_not_registered']));
check('contract after an expired-version delivery is blocked',same(contracted({deliveries:[dv('dvx'),n1,r1]},'2026-10-20T00:00:00+09:00').reasons,['disclosure_missing','version_not_valid_on_delivery']));
check('change notices and nearby docs need no version',fg.assessDelivery(e('c1','change_notice',T10),CTX,'2026-10-06T09:00:00+09:00').counted&&fg.assessDelivery(n1,CTX,'2026-10-06T09:00:00+09:00').counted);

// 18) 계약서안 템플릿
const r12=e('r1','draft',T10,{templateId:'tpl12'});
check('draft_provided with a template missing item 12 is blocked',same(fg.checkTransition({deliveries:[e('d1','disclosure',T10),n1,r12]},'draft_provided','2026-10-06T09:00:00+09:00',CTX).reasons,E('draft_template_incomplete')));
check('incomplete template records are kept but not counted',same(pick(fg.assessDelivery(r12,CTX,'2026-10-06T09:00:00+09:00'),['accepted','counted','reasons']),{accepted:true,counted:false,reasons:['draft_template_incomplete']}));
check('contract with only an incomplete draft is blocked',same(contracted({deliveries:[e('d1','disclosure',T10),n1,r12]},'2026-10-20T00:00:00+09:00').reasons,E('draft_missing','draft_template_incomplete')));
check('draft_provided without a draft record is draft_missing',same(fg.checkTransition({deliveries:[e('d1','disclosure',T10)]},'draft_provided','2026-10-06T09:00:00+09:00',CTX).reasons,['draft_missing']));
check('draft_provided with a complete template passes even before the receipt is proven',fg.checkTransition({deliveries:[withoutReceipt(e('r1','draft',T10))]},'draft_provided','2026-10-06T09:00:00+09:00',CTX).ok);
check('draft with an unknown template is incomplete',same(fg.assessDelivery(e('r1','draft',T10,{templateId:'tpl-none'}),CTX,'2026-10-06T09:00:00+09:00').reasons,['draft_template_incomplete']));

// 19) 인근가맹점 현황문서 없음
const wn=fg.earliestContractAt({...CTX,deliveries:[e('d1','disclosure',T10),e('r1','draft',T10)]},'2026-10-06T09:00:00+09:00');
check('without the nearby doc the disclosure side never starts',wn.at===null&&same(wn.blockers,E('nearby_missing'))&&wn.disclosureSide.startDate===null&&wn.draftSide.opensAt==='2026-10-20T00:00:00+09:00');
check('contract without the nearby doc is blocked',same(contracted({deliveries:[e('d1','disclosure',T10),e('r1','draft',T10)]},'2026-10-20T00:00:00+09:00').reasons,['nearby_missing']));
check('no deliveries at all misses all three documents',same(fg.earliestContractAt({...CTX,deliveries:[]},'2026-10-06T09:00:00+09:00').blockers,['disclosure_missing','draft_missing','nearby_missing']));

// 20) 증빙 없는 7일 단축(H4)
const acc=(target,x={})=>ADV(target,'2026-10-06',{advisorType:'accountant',...x});
const leadU={...L(T10),advice:[acc('disclosure'),acc('draft')]};
const wu=W(leadU,'2026-10-07T09:00:00+09:00');
check('advice by an accountant does not shorten either side',wu.at==='2026-10-20T00:00:00+09:00'&&wu.disclosureSide.days===14&&wu.draftSide.days===14&&same(wu.notes,['shortening_unproven']));
check('contract relying on unproven shortening shows the note',same(fg.checkTransition({...leadU,contract:C('2026-10-13T00:00:00+09:00')},'contracted','2026-10-13T00:00:00+09:00',CTX).reasons,E('contract_too_early','shortening_unproven')));
check('the note does not block after the 14-day window',fg.checkTransition({...leadU,contract:C('2026-10-20T00:00:00+09:00')},'contracted','2026-10-20T00:00:00+09:00',CTX).ok);
for(const [label,x,now] of [['registration not verified',{registrationVerified:false},'2026-10-07T09:00:00+09:00'],['advice before the start day',{advisedOn:'2026-10-04'},'2026-10-07T09:00:00+09:00'],['advice after today',{advisedOn:'2026-10-08'},'2026-10-07T09:00:00+09:00'],['advice on the nearby doc',{targetDoc:'nearby'},'2026-10-07T09:00:00+09:00'],['bad advice date',{advisedOn:'2026-10-06T10:00:00+09:00'},'2026-10-07T09:00:00+09:00']]){
 const w=W({...L(T10),advice:[ADV('disclosure','2026-10-06',x),ADV('draft','2026-10-06',x)]},now);
 check(`unproven shortening (${label}) keeps 14 days with a note`,same(w.notes,['shortening_unproven'])&&w.disclosureSide.days===14&&w.draftSide.days===14);
}
const conflictAdv=W({...L(T10),advice:[ADV('disclosure','2026-10-06'),ADV('disclosure','2026-10-07')]},'2026-10-08T09:00:00+09:00');
check('conflicting advice with one id is void',conflictAdv.disclosureSide.days===14&&same(conflictAdv.notes,['shortening_unproven']));
check('draft shortening needs a start on or after 2023-11-09',(()=>{const d=e('r1','draft','2023-11-08T10:00:00+09:00');const ctx={...CTX,contractTemplates:TPL};const w=fg.earliestContractAt({...ctx,deliveries:[d],advice:[ADV('draft','2023-11-08')]},'2023-11-10T09:00:00+09:00');return w.draftSide.days===14&&same(w.notes,['shortening_unproven'])})());
const franchiseConsultant=W({...L(T10),advice:[ADV('draft','2026-10-06',{advisorType:'franchise_consultant'})]},'2026-10-07T09:00:00+09:00');
check('a registered franchise consultant shortens the draft side',franchiseConsultant.draftSide.days===7&&franchiseConsultant.disclosureSide.days===14&&same(franchiseConsultant.notes,[]));

// 21) 본부 비용·소개 자문 경고(독립성 요건은 proposed라 단축은 적용)
const wi=W({...L(T10),advice:[ADV('disclosure','2026-10-06',{hqPaid:true}),ADV('draft','2026-10-06')]},'2026-10-07T09:00:00+09:00');
check('hq-paid advice still shortens but warns',wi.disclosureSide.shortened&&wi.disclosureSide.days===7&&same(wi.warnings,E('advisor_independence_unverified')));
check('unknown referral (null) also warns',same(W({...L(T10),advice:[ADV('disclosure','2026-10-06',{hqReferred:null}),ADV('draft','2026-10-06')]},'2026-10-07T09:00:00+09:00').warnings,['advisor_independence_unverified']));
check('independent advice does not warn',same(W({...L(T10),advice:[ADV('disclosure','2026-10-06'),ADV('draft','2026-10-06')]},'2026-10-07T09:00:00+09:00').warnings,[]));
check('the advisory is carried to the contract result',same(fg.checkTransition({...L(T10),advice:[ADV('disclosure','2026-10-06',{hqPaid:true}),ADV('draft','2026-10-06')],contract:C('2026-10-20T00:00:00+09:00')},'contracted','2026-10-20T00:00:00+09:00',CTX).warnings,['advisor_independence_unverified']));

// 22) 같은 id 1회, 입력 순서 불변, 내용 충돌
const [d1,n1b,r1b]=L(T10).deliveries,c1=e('c1','change_notice','2026-10-08T10:00:00+09:00');
const adv=[ADV('disclosure','2026-10-09'),ADV('draft','2026-10-06')],nowO='2026-10-09T09:00:00+09:00';
const base=plain(fg.earliestContractAt({...CTX,deliveries:[d1,n1b,r1b,c1],advice:adv},nowO));
check('duplicate identical delivery ids count once',same(fg.earliestContractAt({...CTX,deliveries:[d1,structuredClone(d1),n1b,r1b,c1],advice:adv},nowO),base)&&base.deliveries.length===4);
const perms=xs=>xs.length<=1?[xs]:xs.flatMap((x,i)=>perms([...xs.slice(0,i),...xs.slice(i+1)]).map(p=>[x,...p]));
check('every ordering of deliveries and advice gives the same window',perms([d1,n1b,r1b,c1]).every(p=>same(fg.earliestContractAt({...CTX,deliveries:p,advice:[...adv].reverse()},nowO),base)));
check('ordering does not change the transition result',same(fg.checkTransition({deliveries:[r1b,c1,n1b,d1],advice:[...adv].reverse(),contract:C('2026-10-23T00:00:00+09:00')},'contracted','2026-10-23T00:00:00+09:00',CTX),plain(fg.checkTransition({deliveries:[d1,n1b,r1b,c1],advice:adv,contract:C('2026-10-23T00:00:00+09:00')},'contracted','2026-10-23T00:00:00+09:00',CTX))));
check('deliveries come back sorted by id',same(base.deliveries.map(d=>d.id),['c1','d1','n1','r1']));
const d1b={...d1,deliveredAt:'2026-10-05T11:00:00+09:00',recordedAt:'2026-10-05T11:00:00+09:00',evidence:{electronic:{channel:'email',receivedAt:'2026-10-05T11:00:00+09:00',printable:true}}};
const wc=fg.earliestContractAt({...CTX,deliveries:[d1,d1b,n1b,r1b]},'2026-10-06T09:00:00+09:00');
check('conflicting records with one id are both kept uncounted',wc.deliveries.filter(d=>d.id==='d1').length===2&&wc.deliveries.filter(d=>d.id==='d1').every(d=>d.accepted&&!d.counted&&same(d.reasons,E('delivery_id_conflict'))));
check('an id conflict blocks the window',wc.at===null&&same(wc.blockers,['delivery_id_conflict','disclosure_missing']));
check('conflict handling is order independent',same(fg.earliestContractAt({...CTX,deliveries:[r1b,d1b,n1b,d1]},'2026-10-06T09:00:00+09:00'),plain(wc)));

// 23) 더 최근의 결손 제공은 막고, 재제공은 기산을 늦춘다
const nd=[e('d1','disclosure','2026-10-01T10:00:00+09:00'),e('n1','nearby','2026-10-03T10:00:00+09:00'),e('r1','draft','2026-10-05T10:00:00+09:00')];
const d2=withoutReceipt(e('d2','disclosure','2026-10-10T10:00:00+09:00'));
const wd=fg.earliestContractAt({...CTX,deliveries:[...nd,d2]},'2026-10-11T09:00:00+09:00');
check('a newer defective disclosure blocks despite an older good one',wd.at===null&&same(wd.blockers,['receipt_unconfirmed']));
const wd2=fg.earliestContractAt({...CTX,deliveries:[...nd,e('d2','disclosure','2026-10-10T10:00:00+09:00')]},'2026-10-11T09:00:00+09:00');
check('a proper re-delivery restarts from 10-10 and extends 10-24 (sat) to 10-26',wd2.disclosureSide.startDate==='2026-10-10'&&wd2.disclosureSide.periodEnd==='2026-10-26'&&wd2.disclosureSide.extended&&wd2.at==='2026-10-27T00:00:00+09:00');
check('an older defective record does not block',fg.earliestContractAt({...CTX,deliveries:[withoutReceipt(e('d0','disclosure','2026-10-04T10:00:00+09:00')),...L(T10).deliveries]},'2026-10-06T09:00:00+09:00').at==='2026-10-20T00:00:00+09:00');
check('a revised draft restarts the draft side',fg.earliestContractAt({...CTX,deliveries:[...L(T10).deliveries,e('r2','draft','2026-10-08T10:00:00+09:00')]},'2026-10-09T09:00:00+09:00').draftSide.startDate==='2026-10-08');

// 24) 본계약 전 점포 개발 약정(수동 절차서 7단계)
const W0=fg.earliestContractAt({...CTX,deliveries:L(T10).deliveries},'2026-10-10T10:00:00+09:00');
const ag=(x={})=>({id:'ag1',signedAt:'2026-10-10T10:00:00+09:00',recordedAt:'2026-10-10T10:00:00+09:00',clauses:{fee:true,construction:false,training:false},...x});
check('an agreement taking fees before the window is too early',same(fg.checkAgreement(ag(),W0,'2026-10-10T10:00:00+09:00').reasons,E('pre_contract_agreement_too_early')));
check('an agreement starting construction before the window is too early',same(fg.checkAgreement(ag({clauses:{fee:false,construction:true,training:false}}),W0,'2026-10-10T10:00:00+09:00').reasons,['pre_contract_agreement_too_early']));
check('a site-review-only agreement is fine at any time',fg.checkAgreement(ag({clauses:{fee:false,construction:false,training:false}}),W0,'2026-10-10T10:00:00+09:00').ok);
check('an agreement after the window passes',fg.checkAgreement(ag({signedAt:'2026-10-20T10:00:00+09:00',recordedAt:'2026-10-20T10:00:00+09:00'}),W0,'2026-10-20T10:00:00+09:00').ok);
check('an agreement with missing clauses is invalid',same(fg.checkAgreement(ag({clauses:{fee:true,construction:false}}),W0,'2026-10-10T10:00:00+09:00').reasons,['invalid_record']));
check('an agreement with a blocked window reports the blockers',same(fg.checkAgreement(ag(),wn,'2026-10-10T10:00:00+09:00').reasons,['nearby_missing','pre_contract_agreement_too_early']));
check('an early agreement blocks the later contract',same(fg.checkTransition({...L(T10),agreements:[ag()],contract:C('2026-10-20T00:00:00+09:00')},'contracted','2026-10-20T00:00:00+09:00',CTX).reasons,['pre_contract_agreement_too_early']));
check('agreement record integrity is checked',same(fg.checkAgreement(ag({recordedAt:'2026-10-11T10:00:00+09:00'}),W0,'2026-10-12T10:00:00+09:00').reasons,['backdate_unapproved','pre_contract_agreement_too_early'])&&same(fg.checkAgreement(ag({signedAt:'bad'}),W0,'2026-10-10T10:00:00+09:00').reasons,['invalid_timestamp']));

// 25) 단계 전이
for(const s of ['inquiry','contacted','consulted','briefing','closed']){
 const r=fg.checkTransition({deliveries:[]},s,T10,CTX);
 check(`stage ${s} is not gated in R4a`,r.ok&&same(r.reasons,[])&&same(r.warnings,[])&&!('window' in r)&&r.disclaimer==='COLLECTIVE 휴리스틱 · 법률 자문 아님');
}
check('an unknown stage is refused without echo',same(fg.checkTransition({deliveries:[]},'signed',T10,CTX).reasons,E('invalid_stage'))&&!JSON.stringify(fg.checkTransition({deliveries:[]},'signed',T10,CTX)).includes('signed'));
check('a bad now is refused',same(fg.checkTransition({deliveries:[]},'inquiry','bad',CTX).reasons,['invalid_timestamp']));
check('both stage and now can be wrong at once',same(fg.checkTransition({deliveries:[]},'x','bad',CTX).reasons,['invalid_stage','invalid_timestamp']));
check('disclosed accepts the scenario 6 lead',fg.checkTransition({deliveries:[hand({signatureHandwritten:false}),n1,r1]},'disclosed',T10,CTX).ok);
check('disclosed without any record is disclosure_missing',same(fg.checkTransition({deliveries:[]},'disclosed',T10,CTX).reasons,['disclosure_missing']));
check('disclosed with only an unapproved backdated record is refused',same(fg.checkTransition({deliveries:[d12()]},'disclosed',n12,CTX).reasons,['backdate_unapproved']));
check('disclosed with a conflicting id still records',fg.checkTransition({deliveries:[d1,d1b]},'disclosed','2026-10-06T09:00:00+09:00',CTX).ok);
check('contracted without a contract record is invalid',same(fg.checkTransition(L(T10),'contracted','2026-10-20T12:00:00+09:00',CTX).reasons,['invalid_record']));
check('a contract signed in the future is a future event',same(fg.checkTransition({...L(T10),contract:C('2026-10-21T00:00:00+09:00')},'contracted','2026-10-20T12:00:00+09:00',CTX).reasons,['future_event']));
const bd={signedAt:'2026-10-20T09:00:00+09:00',recordedAt:'2026-10-20T12:00:00+09:00'};
check('a backdated contract signature needs approval',same(fg.checkTransition({...L(T10),contract:bd},'contracted','2026-10-20T12:00:00+09:00',CTX).reasons,['backdate_unapproved'])&&fg.checkTransition({...L(T10),contract:{...bd,backdateApproval:APPROVE}},'contracted','2026-10-20T12:00:00+09:00',CTX).ok);
check('a contract with a bad signature time is refused',same(fg.checkTransition({...L(T10),contract:{signedAt:'2026-10-20',recordedAt:'2026-10-20T12:00:00+09:00'}},'contracted','2026-10-20T12:00:00+09:00',CTX).reasons,['invalid_timestamp']));
const opened=fg.checkTransition({...L(T10),contract:C('2026-10-20T00:00:00+09:00')},'opened','2026-11-20T00:00:00+09:00',CTX);
check('opened with a valid contract passes and carries the window',opened.ok&&opened.window?.at==='2026-10-20T00:00:00+09:00');
check('opened without a contract is invalid',same(fg.checkTransition(L(T10),'opened','2026-11-20T00:00:00+09:00',CTX).reasons,['invalid_record']));
check('a missing context is an invalid record',same(fg.checkTransition(L(T10),'contracted',T10,null).reasons,['invalid_record'])&&same(fg.checkTransition(null,'disclosed',T10,CTX).reasons,['invalid_record']));

// 26) 입력 한도·버전·템플릿 형식은 fail-closed
check('too many deliveries fail closed',same(fg.earliestContractAt({...CTX,deliveries:Array.from({length:201},(_,i)=>e('x'+i,'nearby',T10))},'2026-10-06T09:00:00+09:00').blockers,['invalid_record']));
check('too many holidays fail closed',same(fg.earliestContractAt({...CTX,holidays:Array.from({length:401},(_,i)=>fr.addDays('2027-01-01',i)),deliveries:[]},'2026-10-06T09:00:00+09:00').blockers,['invalid_record']));
check('duplicate version ids fail closed',same(fg.earliestContractAt({...CTX,disclosureVersions:[...VER,VER[0]],deliveries:[]},'2026-10-06T09:00:00+09:00').blockers,['invalid_record']));
check('a version with a bad window fails closed',same(fg.earliestContractAt({...CTX,disclosureVersions:[{...VER[0],validUntil:'2026-01-15T00:00:00+09:00'}],deliveries:[]},'2026-10-06T09:00:00+09:00').blockers,['invalid_timestamp']));
check('a template with a free-text id fails closed',same(fg.earliestContractAt({...CTX,contractTemplates:[{id:'템플릿',checkedItems:[]}],deliveries:[]},'2026-10-06T09:00:00+09:00').blockers,['invalid_record']));
check('missing deliveries array fails closed',same(fg.earliestContractAt({...CTX,deliveries:undefined},'2026-10-06T09:00:00+09:00').blockers,['invalid_record']));

// 27) 변경등록 기한(별표 1의2). 기한에는 공휴일 연장을 하지 않는다.
const am=(...args)=>plain(fg.amendmentDeadline(...args));
const core=r=>pick(r,['deadline','basis','days','ruleId','reasons','warnings']);
check('FY 2026-12-31 financials: 120 days is 2027-04-30',same(core(am('2026-12-31',{item:'financials'},'2027-03-15')),{deadline:'2027-04-30',basis:'fiscal_year',days:120,ruleId:'kr.fr.change_deadlines',reasons:[],warnings:[]}));
check('FY 2027-12-31 financials filed in 2028: 2028-04-29 (leap year) under the 2028 rule',same(core(am('2027-12-31',{item:'financials'},'2028-03-15')),{deadline:'2028-04-29',basis:'fiscal_year',days:120,ruleId:'kr.fr.change_deadlines_2028',reasons:[],warnings:[]}));
check('FY 2027-12-31 financials filed on 2027-12-31: same day, current rule, saturday kept',(()=>{const r=am('2027-12-31',{item:'financials'},'2027-12-31');return r.deadline==='2028-04-29'&&r.ruleId==='kr.fr.change_deadlines'&&fr.weekdayOf('2028-04-29')===6})());
check('individual with financials gets 180 days',am('2026-12-31',{item:'financials',individualWithFinancials:true},'2027-03-15').deadline==='2027-06-29'&&am('2026-12-31',{item:'financials',individualWithFinancials:true},'2027-03-15').days===180&&am('2026-12-31',{item:'financials',individualWithFinancials:null},'2027-03-15').days===120);
check('store counts filed in 2028 are quarterly: 2028-01-30',same(core(am('2027-12-31',{item:'store_counts',occurredOn:'2027-12-31'},'2028-01-10')),{deadline:'2028-01-30',basis:'quarter',days:30,ruleId:'kr.fr.change_deadlines_2028',reasons:[],warnings:[]}));
check('store counts filed in 2027 stay yearly: 2028-04-29',same(core(am('2027-12-31',{item:'store_counts',occurredOn:'2027-12-31'},'2027-12-30')),{deadline:'2028-04-29',basis:'fiscal_year',days:120,ruleId:'kr.fr.change_deadlines',reasons:[],warnings:[]}));
check('unknown application date picks the earlier rule and warns',same(core(am('2027-12-31',{item:'store_counts',occurredOn:'2027-12-31'},null)),{deadline:'2028-01-30',basis:'quarter',days:30,ruleId:'kr.fr.change_deadlines_2028',reasons:[],warnings:E('application_date_unknown')}));
check('tie with unknown application date keeps the current rule',same(core(am('2026-12-31',{item:'financials'})),{deadline:'2027-04-30',basis:'fiscal_year',days:120,ruleId:'kr.fr.change_deadlines',reasons:[],warnings:['application_date_unknown']}));
check('long-running stores do not exist before 2028',same(core(am('2027-12-31',{item:'long_running_stores'},'2027-12-30')),{deadline:null,basis:null,days:null,ruleId:null,reasons:['invalid_record'],warnings:[]}));
check('long-running stores with unknown date use the 2028 rule',same(core(am('2027-12-31',{item:'long_running_stores'},null)),{deadline:'2028-04-29',basis:'fiscal_year',days:120,ruleId:'kr.fr.change_deadlines_2028',reasons:[],warnings:['application_date_unknown']}));
check('event items are due 30 days after the event',same(pick(am('2026-12-31',{item:'history',occurredOn:'2026-11-10'},'2026-11-20'),['deadline','basis','days']),{deadline:'2026-12-10',basis:'event',days:30}));
check('quarter items are due 30 days after the quarter end',same(pick(am('2026-12-31',{item:'support_training',occurredOn:'2026-11-10'},'2026-11-20'),['deadline','basis','days']),{deadline:'2027-01-30',basis:'quarter',days:30}));
check('a June fiscal year shares the December quarter end',am('2026-06-30',{item:'ip',occurredOn:'2026-11-10'},'2026-11-20').deadline==='2027-01-30');
check('a November fiscal quarter end comes before the calendar one',am('2026-11-30',{item:'ip',occurredOn:'2026-11-10'},'2026-11-20').deadline==='2026-12-30');
check('event items need occurredOn',same(core(am('2026-12-31',{item:'history'},'2026-11-20')),{deadline:null,basis:null,days:null,ruleId:null,reasons:['invalid_date'],warnings:[]}));
check('application instants are read as KST dates',am('2027-12-31',{item:'store_counts',occurredOn:'2027-12-31'},'2027-12-31T15:00:00Z').ruleId==='kr.fr.change_deadlines_2028'&&am('2027-12-31',{item:'store_counts',occurredOn:'2027-12-31'},'2027-12-31T14:59:59Z').deadline==='2028-04-29');
for(const [args,code] of [[['2026-12-32',{item:'financials'},'2027-01-10'],'invalid_date'],[['2026-12-15',{item:'financials'},'2027-01-10'],'invalid_date'],[['2026-12-31',{item:'menu'},'2027-01-10'],'invalid_record'],[['2026-12-31',{item:'financials'},'2027-01-10T10:00:00'],'invalid_date'],[['2026-12-31',{item:'financials'},'2020-01-01'],'invalid_date']]){
 const r=am(...args),raw=JSON.stringify(r);
 check(`amendment input ${JSON.stringify(args)} is refused without echo`,r.deadline===null&&same(r.reasons,[code])&&r.disclaimer==='COLLECTIVE 휴리스틱 · 법률 자문 아님'&&r.ruleVersion==='fr-gates@2026-09-25.1'&&!raw.includes(args[0]===`2026-12-31`?String(args[2]):args[0])&&!raw.includes('menu'));
}

// 28) 입력 객체를 바꾸지 않는다(깊게 얼린 입력으로 판정해도 예외 없이 같은 결과)
const frozenLead=deepFreeze(structuredClone({...L(T10),advice:[ADV('disclosure','2026-10-06')],fees:[fee()],agreements:[ag({signedAt:feeT,recordedAt:feeT})],contract:C(feeT),forecastStatement:stmt({providedAt:feeT,recordedAt:feeT})}));
const frozenCtx=deepFreeze(structuredClone({...CTX,forecast:{sme:false,storesAtFyEnd:120}}));
const before=JSON.stringify(frozenLead);
const fz=fg.checkTransition(frozenLead,'contracted',feeT,frozenCtx);
check('frozen inputs are judged without mutation',fz.ok&&JSON.stringify(frozenLead)===before);

// 30) 검토 반영 회귀(2026-09-25). 지적마다 재현 입력을 고정하고 수정 뒤 기대값을 단언한다.
// 30-1) 예치 경로에서도 본부 수령 시각(paidAt)이 간주 수령 시각 후보다(제7조③1호 우회 방지). 예치 대상 가맹금을 최초 예치 전에 받았으면 직접 수령이라 예치 증빙이 아니다(제41조③1호).
check('escrow with a direct payment before the window is too early and unproven',same(escrowed({...L(T10),fees:[fee({paidAt:'2026-10-15T10:00:00+09:00',backdateApproval:APPROVE})]}).reasons,['escrow_unproven','fee_too_early']));
check('opening costs paid directly before the window are too early despite a later escrow',same(escrowed({...L(T10),fees:[f3({recordedAt:feeT,paidAt:'2026-10-15T10:00:00+09:00',escrow:{institutionType:'bank',firstDepositAt:feeT,agreementAt:null},backdateApproval:APPROVE})]}).reasons,['fee_too_early']));
const t21='2026-10-21T10:00:00+09:00';
check('a release from escrow after the deposit is not a direct receipt',escrowed({...L(T10),fees:[fee({recordedAt:t21,paidAt:t21,backdateApproval:APPROVE})]},t21).ok);

// 30-2) 늦은 자문은 게이트를 14일보다 늦추지 않는다(법정 상한 14일). 쓰지 않은 자문은 단축·경고를 만들지 않는다.
const d1001=L('2026-10-01T10:00:00+09:00').deliveries;
const lateAdv=fg.earliestContractAt({...CTX,deliveries:d1001,advice:[ADV('disclosure','2026-10-20'),ADV('draft','2026-10-20')]},'2026-10-21T09:00:00+09:00');
check('late advice keeps the 14-day opening instead of delaying it',lateAdv.at==='2026-10-16T00:00:00+09:00'&&same(side(lateAdv.disclosureSide),{startDate:'2026-10-01',days:14,periodEnd:'2026-10-15',opensAt:'2026-10-16T00:00:00+09:00',shortened:false,extended:false})&&lateAdv.draftSide.days===14&&same(lateAdv.notes,[])&&same(lateAdv.warnings,[])&&!lateAdv.disclosureSide.ruleIds.includes('h.advice_shortening_evidence'));
check('an unused hq-paid advice does not warn',same(fg.earliestContractAt({...CTX,deliveries:d1001,advice:[ADV('disclosure','2026-10-20',{hqPaid:true})]},'2026-10-21T09:00:00+09:00').warnings,[]));
const leadLate={...L(T10),advice:[ADV('disclosure','2026-10-25'),ADV('draft','2026-10-25')],contract:C('2026-10-21T00:00:00+09:00')};
check('advice given after a lawful contract never reopens it',W(leadLate,'2026-10-26T09:00:00+09:00').at==='2026-10-20T00:00:00+09:00'&&fg.checkTransition(leadLate,'opened','2026-10-26T09:00:00+09:00',CTX).ok);

// 30-3) 계약·가맹금 판정은 그 시각 이전의 증빙만 쓴다. 계약 뒤 재제공·변경 통지·계약서 수정본·결손 기록은 이미 한 계약과 가맹금을 뒤집지 않는다.
const signedLead={...L(T10),contract:C('2026-10-20T10:00:00+09:00'),fees:[fee()]};
check('the contract itself passes before any later record',fg.checkTransition(signedLead,'contracted','2026-10-20T10:00:00+09:00',CTX).ok);
for(const [label,x] of [['re-delivered disclosure',e('d2','disclosure','2026-11-01T10:00:00+09:00')],['hand change notice',{...handNotice,id:'c9',deliveredAt:'2026-11-01T10:00:00+09:00',recordedAt:'2026-11-01T10:00:00+09:00'}],['revised draft',e('r2','draft','2026-10-25T10:00:00+09:00')],['defective disclosure',withoutReceipt(e('d3','disclosure','2026-10-25T10:00:00+09:00'))]]){
 const lead={...signedLead,deliveries:[...signedLead.deliveries,x]};
 const op=fg.checkTransition(lead,'opened','2026-11-20T00:00:00+09:00',CTX);
 check(`a ${label} after signing does not reopen the contract`,op.ok&&op.window?.at==='2026-10-20T00:00:00+09:00'&&op.window.deliveries.length===3);
 check(`a ${label} after payment does not reopen the escrowed fee`,fg.checkTransition(lead,'fee_escrowed','2026-11-20T00:00:00+09:00',CTX).ok);
}
const beforeSign={...L(T10),deliveries:[...L(T10).deliveries,e('d2','disclosure','2026-10-10T10:00:00+09:00')],contract:C('2026-10-26T10:00:00+09:00')};
const bs=fg.checkTransition(beforeSign,'contracted','2026-10-26T10:00:00+09:00',CTX);
check('a re-delivery before signing still restarts the clock',same(bs.reasons,['contract_too_early'])&&bs.window?.at==='2026-10-27T00:00:00+09:00');
check('an early agreement is judged with the records before it',same(fg.checkTransition({...signedLead,deliveries:[...signedLead.deliveries,e('d2','disclosure','2026-11-01T10:00:00+09:00')],agreements:[ag()]},'opened','2026-11-20T00:00:00+09:00',CTX).reasons,['pre_contract_agreement_too_early']));

// 30-4) 같은 id 충돌이어도 따로 보면 거부될 기록은 거부를 유지한다(충돌로 미래·백데이트·허용 안 된 방법 기록이 받아지지 않는다).
const ftcA=e('d1','disclosure',T10,{method:'ftc_link'}),ftcB={...ftcA,deliveredAt:'2026-10-05T11:00:00+09:00',recordedAt:'2026-10-05T11:00:00+09:00'};
const ftcPair=fg.checkTransition({deliveries:[ftcA,ftcB]},'disclosed','2026-10-06T09:00:00+09:00',CTX);
check('a conflicting pair of site links is still refused',!ftcPair.ok&&same(ftcPair.reasons,['delivery_id_conflict','method_not_allowed']));
const futA=e('d1','disclosure','2026-10-09T10:00:00+09:00'),futB={...futA,versionId:'dvx'};
const futW=fg.earliestContractAt({...CTX,deliveries:[futA,futB]},'2026-10-06T09:00:00+09:00');
check('a conflicting pair of future records stays refused',futW.deliveries.length===2&&futW.deliveries.every(d=>!d.accepted&&same(d.reasons,['delivery_id_conflict','future_delivery']))&&same(fg.checkTransition({deliveries:[futA,futB]},'disclosed','2026-10-06T09:00:00+09:00',CTX).reasons,['delivery_id_conflict','future_delivery']));
const mixed=fg.earliestContractAt({...CTX,deliveries:[d1,{...d1,recordedAt:'2026-10-05T12:00:00+09:00'},n1b,r1b]},'2026-10-06T09:00:00+09:00'),mixedD1=mixed.deliveries.filter(d=>d.id==='d1');
check('in a mixed conflict the acceptable record stays uncounted and the other refused',mixedD1.length===2&&mixedD1.some(d=>d.accepted&&!d.counted&&same(d.reasons,['delivery_id_conflict']))&&mixedD1.some(d=>!d.accepted&&same(d.reasons,['backdate_unapproved','delivery_id_conflict']))&&same(mixed.blockers,['backdate_unapproved','delivery_id_conflict','disclosure_missing']));

// 30-5) 표기만 다른 재전송(같은 순간의 다른 오프셋, null과 생략, 키 순서)은 같은 기록으로 한 번 센다.
const d1z={...d1,deliveredAt:'2026-10-05T01:00:00Z',recordedAt:'2026-10-05T01:00:00Z',evidence:{electronic:{channel:'email',receivedAt:'2026-10-05T01:00:00Z',printable:true}}};
const zOnly=plain(fg.earliestContractAt({...CTX,deliveries:[d1z,n1b,r1b]},'2026-10-06T09:00:00+09:00'));
check('the same instant written with another offset counts once in any order',zOnly.at==='2026-10-20T00:00:00+09:00'&&zOnly.deliveries.length===3&&same(fg.earliestContractAt({...CTX,deliveries:[d1,d1z,n1b,r1b]},'2026-10-06T09:00:00+09:00'),zOnly)&&same(fg.earliestContractAt({...CTX,deliveries:[r1b,d1z,n1b,d1]},'2026-10-06T09:00:00+09:00'),zOnly));
const baseL=plain(fg.earliestContractAt({...CTX,deliveries:[d1,n1b,r1b]},'2026-10-06T09:00:00+09:00'));
check('null and omitted optional fields are the same record',same(fg.earliestContractAt({...CTX,deliveries:[d1,{...d1,backdateApproval:null,templateId:null},n1b,r1b]},'2026-10-06T09:00:00+09:00'),baseL));
check('key order alone does not make a conflict',same(fg.earliestContractAt({...CTX,deliveries:[d1,Object.fromEntries(Object.entries(d1).reverse()),n1b,r1b]},'2026-10-06T09:00:00+09:00'),baseL));

// 30-6) 공휴일 목록이 말일 판정 연도를 덮지 않으면 확인되지 않은 달력이다(연말 제공).
const yearEnd=L('2026-12-18T10:00:00+09:00').deliveries;
const staleYE=fg.earliestContractAt({...CTX,holidays:['2026-10-03','2026-10-09','2026-12-25'],deliveries:yearEnd},'2026-12-19T09:00:00+09:00');
check('a 2026-only list does not verify a 2027 last day',staleYE.disclosureSide.periodEnd==='2027-01-01'&&staleYE.at==='2027-01-02T00:00:00+09:00'&&same(staleYE.warnings,['holiday_calendar_unverified']));
const fullYE=fg.earliestContractAt({...CTX,holidays:['2026-12-25','2027-01-01'],deliveries:yearEnd},'2026-12-19T09:00:00+09:00');
check('a list covering 2027 extends new year day to monday 01-04',fullYE.disclosureSide.periodEnd==='2027-01-04'&&fullYE.disclosureSide.extended&&fullYE.at==='2027-01-05T00:00:00+09:00'&&same(fullYE.warnings,[]));
check('an old-year list does not verify the hangul day',same(fg.waitingPeriod('2026-09-25',14,['2025-10-09','2025-12-25']),{periodEnd:'2026-10-09',opensAt:'2026-10-10T00:00:00+09:00',extended:false,calendarVerified:false}));

// 30-7) 등록 전에 발송하고 등록 뒤에 수신한 4호 파일은 등록한 정보공개서 제공이 아니다. 발송·수신 모두 유효 기간 안이어야 한다.
const VL=[{id:'dvl',registeredAt:'2026-10-06T09:00:00+09:00',validFrom:'2026-10-06T09:00:00+09:00',validUntil:'2027-04-30T00:00:00+09:00'},{id:'dve',registeredAt:'2026-01-15T09:00:00+09:00',validFrom:'2026-01-15T00:00:00+09:00',validUntil:'2026-10-06T09:30:00+09:00'},{id:'dveq',registeredAt:T10,validFrom:T10,validUntil:'2027-01-01T00:00:00+09:00'},{id:'dvend',registeredAt:'2026-01-15T09:00:00+09:00',validFrom:'2026-01-15T00:00:00+09:00',validUntil:T10}];
const CTX_VL={disclosureVersions:VL,contractTemplates:TPL};
const m4=(v,sent,got)=>e('d1','disclosure',sent,{versionId:v,recordedAt:got,evidence:{electronic:{channel:'email',receivedAt:got,printable:true}},backdateApproval:APPROVE});
check('sent before registration and received after is not a registered disclosure',same(pick(fg.assessDelivery(m4('dvl','2026-10-06T08:00:00+09:00','2026-10-06T10:00:00+09:00'),CTX_VL,'2026-10-06T11:00:00+09:00'),['accepted','counted','reasons']),{accepted:true,counted:false,reasons:['version_not_registered']}));
check('sent inside the validity window and received after it is not valid on delivery',same(fg.assessDelivery(m4('dve','2026-10-06T09:00:00+09:00','2026-10-06T10:00:00+09:00'),CTX_VL,'2026-10-06T11:00:00+09:00').reasons,['version_not_valid_on_delivery']));
check('registered at the very delivery instant counts',fg.assessDelivery(e('d1','disclosure',T10,{versionId:'dveq'}),CTX_VL,'2026-10-06T09:00:00+09:00').counted);
check('delivered exactly at validUntil is outside the window',same(fg.assessDelivery(e('d1','disclosure',T10,{versionId:'dvend'}),CTX_VL,'2026-10-06T09:00:00+09:00').reasons,['version_not_valid_on_delivery']));

// 30-8) 먼저 발송했지만 늦게 수신한 결손 기록도 '더 최근 결손 제공'이다(발송·수신 중 늦은 시각으로 비교).
const e4=(id,sent,got,x={})=>e(id,'disclosure',sent,{recordedAt:got,evidence:{electronic:{channel:'email',receivedAt:got,printable:true,...x}},backdateApproval:APPROVE});
const lateGot=fg.earliestContractAt({...CTX,deliveries:[e4('d1','2026-10-05T10:00:00+09:00','2026-10-06T10:00:00+09:00'),e4('d2','2026-10-06T09:00:00+09:00','2026-10-08T10:00:00+09:00',{printable:false}),n1b,r1b]},'2026-10-09T09:00:00+09:00');
check('a defective record sent earlier but received later still blocks',lateGot.at===null&&same(lateGot.blockers,['evidence_incomplete']));

// 30-9) 방법이 달라 산입하지 않은 변경 통지는 그 뒤(엄격히 늦게) 산입된 정보공개서 재제공으로 대체된다. 시행령 제6조③은 제1항 각 호 어느 방법이든 허용하고, 같은 방법 요구는 COLLECTIVE 휴리스틱(Q3)이다.
const superseded=fg.earliestContractAt({...CTX,deliveries:[...L(T10).deliveries,handNotice,e('d2','disclosure','2026-10-10T10:00:00+09:00')]},'2026-10-11T09:00:00+09:00');
check('a full re-delivery after a mismatched notice lifts the block and restarts the clock',same(superseded.blockers,[])&&superseded.disclosureSide.startDate==='2026-10-10'&&superseded.disclosureSide.periodEnd==='2026-10-26'&&superseded.at==='2026-10-27T00:00:00+09:00');
check('a mismatched notice after the latest disclosure still blocks',same(fg.earliestContractAt({...CTX,deliveries:[...L(T10).deliveries,e('d2','disclosure','2026-10-07T10:00:00+09:00'),handNotice]},'2026-10-09T09:00:00+09:00').blockers,['change_notice_method_mismatch']));

// 30-10) H3 경계: 비교 대상은 통지 이전(같은 시각 포함) 가장 늦은 산입 정보공개서다.
const handDisc=(id,t)=>({id,doc:'disclosure',method:'hand',deliveredAt:t,recordedAt:t,versionId:'dv1',evidence:{hand:HAND_OK}});
check('the notice is compared with the latest earlier disclosure, not the first',same(fg.earliestContractAt({...CTX,deliveries:[e('dA','disclosure','2026-10-01T10:00:00+09:00'),handDisc('dB','2026-10-03T10:00:00+09:00'),n1b,r1b,e('cE','change_notice',T10)]},'2026-10-06T09:00:00+09:00').blockers,['change_notice_method_mismatch']));
check('a disclosure at the same instant as the notice is the comparison target',same(fg.earliestContractAt({...CTX,deliveries:[e('dA','disclosure','2026-10-01T10:00:00+09:00'),handDisc('dB',T10),n1b,r1b,e('cE','change_notice',T10)]},'2026-10-06T09:00:00+09:00').blockers,['change_notice_method_mismatch']));
check('a same-method notice at the same instant counts',same(fg.earliestContractAt({...CTX,deliveries:[handDisc('dB',T10),n1b,r1b,{...handDisc('cE',T10),doc:'change_notice',versionId:undefined}]},'2026-10-06T09:00:00+09:00').blockers,[]));

// 30-11) 경계 고정: 가맹금·약정·보험·자문일·기록 시각·입력 한도·개점 단계
const at20='2026-10-20T00:00:00+09:00',justBefore='2026-10-19T23:59:59.999+09:00';
const feeAt=t=>fee({recordedAt:t,escrow:{institutionType:'bank',firstDepositAt:t,agreementAt:null}});
check('a fee deemed exactly at the opening passes',escrowed({...L(T10),fees:[feeAt(at20)]},at20).ok);
check('a fee deemed 1 ms before the opening is too early',same(escrowed({...L(T10),fees:[feeAt(justBefore)]},justBefore).reasons,['fee_too_early']));
check('an agreement signed exactly at the opening passes, 1 ms before does not',fg.checkAgreement(ag({signedAt:at20,recordedAt:at20}),W0,at20).ok&&same(fg.checkAgreement(ag({signedAt:justBefore,recordedAt:justBefore}),W0,justBefore).reasons,['pre_contract_agreement_too_early']));
check('insurance ending exactly at the payment does not cover it',same(escrowed({...L(T10),fees:[ins({insurance:{coverageFrom:'2026-01-01T00:00:00+09:00',coverageTo:feeT}})]}).reasons,['escrow_unproven']));
check('advice on the start day shortens',W({...L(T10),advice:[ADV('disclosure','2026-10-05'),ADV('draft','2026-10-05')]},'2026-10-06T09:00:00+09:00').at==='2026-10-13T00:00:00+09:00');
check('advice dated today (KST) shortens',W({...L(T10),advice:[ADV('disclosure','2026-10-07'),ADV('draft','2026-10-07')]},'2026-10-07T00:00:00+09:00').draftSide.days===7);
check('the earliest valid advice sets the opening',W({...L(T10),advice:[ADV('draft','2026-10-13',{id:'a1'}),ADV('draft','2026-10-06',{id:'a2'})]},'2026-10-14T09:00:00+09:00').draftSide.opensAt==='2026-10-13T00:00:00+09:00');
check('a signature at the same instant in another offset passes, 1 ms earlier does not',contracted(L('2026-10-05T23:59:00+09:00'),'2026-10-19T15:00:00Z').ok&&same(contracted(L('2026-10-05T23:59:00+09:00'),'2026-10-19T14:59:59.999Z').reasons,['contract_too_early'])&&same(contracted(L('2026-10-05T23:59:00+09:00'),'2026-10-19T09:59:59-05:00').reasons,['contract_too_early']));
check('recordedAt after now alone refuses the record',same(fg.assessDelivery(e('d1','disclosure',T10,{recordedAt:'2026-10-06T10:00:00+09:00',backdateApproval:APPROVE}),CTX,'2026-10-06T09:00:00+09:00').reasons,['future_delivery']));
check('a fee recorded after now alone is a future event',same(escrowed({...L(T10),fees:[fee({recordedAt:'2026-10-20T12:00:00+09:00',backdateApproval:APPROVE})]},'2026-10-20T11:00:00+09:00').reasons,['future_event']));
check('a receipt time before the record time needs approval',same(pick(fg.assessDelivery(e('d1','disclosure',T10,{evidence:{electronic:{channel:'email',receivedAt:'2026-10-05T09:00:00+09:00',printable:true}}}),CTX,'2026-10-06T09:00:00+09:00'),['accepted','reasons']),{accepted:false,reasons:['backdate_unapproved']}));
check('exactly 200 deliveries and 400 holidays are within the limits',!fg.earliestContractAt({...CTX,deliveries:Array.from({length:200},(_,i)=>e('x'+i,'nearby',T10))},'2026-10-06T09:00:00+09:00').blockers.includes('invalid_record')&&!fg.earliestContractAt({...CTX,holidays:Array.from({length:400},(_,i)=>fr.addDays('2027-01-01',i)),deliveries:[]},'2026-10-06T09:00:00+09:00').blockers.includes('invalid_record'));
check('exactly 50 fee records are judged',escrowed({...L(T10),fees:Array.from({length:50},(_,i)=>fee({id:'f'+i}))}).ok);
check('opened checks the signature integrity',same(fg.checkTransition({...L(T10),contract:{signedAt:'2026-10-20T09:00:00+09:00',recordedAt:'2026-10-20T12:00:00+09:00'}},'opened','2026-11-20T00:00:00+09:00',CTX).reasons,['backdate_unapproved']));
check('opened checks the forecast statement',same(fg.checkTransition({...L(T10),contract:C('2026-10-20T00:00:00+09:00')},'opened','2026-11-20T00:00:00+09:00',{...CTX,forecast:{sme:false,storesAtFyEnd:10}}).reasons,['forecast_statement_missing']));

// 30-12) 게이트 함수는 던지지 않는다: KST 날짜가 범위 밖인 시각, BigInt 필드, 2199년 말을 넘는 대기기간·기한
check('an application instant whose KST date leaves 2000-2199 is an invalid date, not a throw',same(fg.amendmentDeadline('2026-12-31',{item:'financials'},'2199-12-31T20:00:00Z').reasons,['invalid_date'])&&same(fg.amendmentDeadline('2026-12-31',{item:'financials'},'2000-01-01T00:00:00+14:00').reasons,['invalid_date']));
check('BigInt fields do not throw',(()=>{const w=fg.earliestContractAt({...CTX,deliveries:[...L(T10).deliveries,{...e('x1','nearby',T10),size:5n}],advice:[{id:'a',x:1n}]},'2026-10-06T09:00:00+09:00');const f=escrowed({...L(T10),fees:[{...fee(),amount:5n}]});return w.at==='2026-10-20T00:00:00+09:00'&&same(w.notes,['shortening_unproven'])&&f.ok})());
const edge=fg.earliestContractAt({...CTX,holidays:['2199-01-01'],deliveries:L('2199-12-20T10:00:00+09:00').deliveries,disclosureVersions:[{id:'dv1',registeredAt:'2199-01-01T00:00:00+09:00',validFrom:'2199-01-01T00:00:00+09:00',validUntil:'2199-12-31T00:00:00+09:00'}]},'2199-12-21T09:00:00+09:00');
check('a waiting period running past 2199 closes as invalid_date without throwing',edge.at===null&&same(edge.blockers,['invalid_date']));
check('a deadline past 2199 is an invalid date',same(fg.amendmentDeadline('2199-12-31',{item:'financials'},'2199-12-31').reasons,['invalid_date']));

// 30-13) 신청일을 모르면 성립하지 않는 2028 후보(기한이 2028-01-01 전)는 뺀다. 사유 발생일이 필요한 후보가 있으면 여전히 닫는다.
check('an impossible pre-2028 deadline under the 2028 rule is dropped',same(core(am('2026-12-31',{item:'store_counts',occurredOn:'2026-05-10'})),{deadline:'2027-04-30',basis:'fiscal_year',days:120,ruleId:'kr.fr.change_deadlines',reasons:[],warnings:['application_date_unknown']}));
check('long-running stores for FY 2026 have no feasible rule',same(core(am('2026-12-31',{item:'long_running_stores'})),{deadline:null,basis:null,days:null,ruleId:null,reasons:['invalid_date'],warnings:['application_date_unknown']}));
check('a missing occurredOn still closes when any candidate needs it',same(am('2026-12-31',{item:'store_counts'}).reasons,['invalid_date']));

// 30-14) 실행 검사: console·가드 Date(인자 없는 생성·Date()·Date.now·Date.parse는 던짐)·가드 Math.random만 둔 컨텍스트에서 모듈을 다시 불러 주요 함수를 돌린다. URL·process·crypto·fetch가 없어 접근하면 ReferenceError다.
const RealDate=Date;
function GuardDate(...a){if(!new.target)throw new Error('Date() 호출 금지');if(!a.length)throw new Error('인자 없는 new Date 금지');return new RealDate(...a)}
GuardDate.UTC=RealDate.UTC;GuardDate.now=()=>{throw new Error('Date.now 금지')};GuardDate.parse=()=>{throw new Error('Date.parse 금지')};GuardDate.prototype=RealDate.prototype;
const guardCtx=createContext({console,Date:GuardDate,Math:Object.create(Math,{random:{value:()=>{throw new Error('Math.random 금지')}}})}),guardCache=new Map();
const guardModule=path=>{path=resolve(path);if(guardCache.has(path))return guardCache.get(path);const m=new SourceTextModule(ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText,{context:guardCtx,identifier:path});guardCache.set(path,m);return m};
const guardLoad=async path=>{const m=guardModule(path);if(m.status==='unlinked')await m.link((s,r)=>{if(!s.startsWith('./'))throw new Error('상대 경로만: '+s);return guardModule(resolve(dirname(r.identifier),s+'.ts'))});if(m.status!=='evaluated')await m.evaluate();return m.namespace};
const gg=await guardLoad('lib/franchise-gates.ts');
const runAll=m=>[m.earliestContractAt({...CTX,deliveries:L(T10).deliveries,advice:[ADV('disclosure','2026-10-06')]},'2026-10-07T09:00:00+09:00'),m.checkTransition({...L(T10),contract:C(feeT),fees:[fee()],agreements:[ag({signedAt:feeT,recordedAt:feeT})]},'contracted',feeT,CTX),m.checkTransition({...L(T10),fees:[fee()]},'fee_escrowed',feeT,CTX),m.amendmentDeadline('2027-12-31',{item:'store_counts',occurredOn:'2027-12-31'},null),m.waitingPeriod('2026-09-25',14,['2026-10-09']),m.assessDelivery(e('d1','disclosure',T10),CTX,'2026-10-06T09:00:00+09:00'),m.forecastDuty({sme:false,storesAtFyEnd:5})];
check('gates run without clock, randomness, URL, process or fetch and match the normal run',same(runAll(gg),plain(runAll(fg))));
let compileThrew=false;try{gg.ID_PATTERN.compile('^.*$')}catch{compileThrew=true}
const afterCompile=gg.assessDelivery({...e('d1','disclosure',T10),id:FREE},CTX,'2026-10-06T09:00:00+09:00');
check('compiling the exported id pattern cannot loosen the module check',compileThrew&&afterCompile.id===null&&same(afterCompile.reasons,['invalid_record']));

// 29) 사유·경고 코드 전부가 어딘가에서 기대값으로 나왔다. 외부 호출은 0회다.
// R4b 추가 내보내기: contractWindowAsOf는 checkTransition이 그 시각 계약에 쓰는 창과 같다(약정 판정용, 시계 없음).
{
 const t0='2026-10-05T10:00:00+09:00',lead={deliveries:[e('d1','disclosure',t0),e('n1','nearby',t0),e('r1','draft',t0)]},input={...lead,disclosureVersions:VER,contractTemplates:TPL,holidays:HOL};
 for(const cutoff of ['2026-10-19T10:00:00+09:00','2026-10-25T10:00:00+09:00','2026-10-04T10:00:00+09:00']){
  const w=fg.contractWindowAsOf(input,'2026-10-26T10:00:00+09:00',cutoff),g=fg.checkTransition({...lead,contract:{signedAt:cutoff,recordedAt:cutoff}},'contracted','2026-10-26T10:00:00+09:00',CTX);
  check(`contractWindowAsOf(${cutoff.slice(0,10)}) equals the window the contract gate uses`,w.at===g.window.at&&JSON.stringify(plain(w.blockers))===JSON.stringify(plain(g.window.blockers)));
 }
 check('contractWindowAsOf before any delivery has no window',fg.contractWindowAsOf(input,'2026-10-26T10:00:00+09:00','2026-10-04T10:00:00+09:00').at===null);
}
const missingCodes=[...fg.REASON_CODES,...fg.WARNING_CODES].filter(c=>!seen.has(c));
assert.deepEqual(missingCodes,[],'기대값으로 확인하지 않은 코드: '+missingCodes.join(', '));passed.push('all 24 reason codes and 3 warning codes are asserted');
check('no external call was made',fetchCalls===0);

console.log(JSON.stringify({passed:passed.length}));
