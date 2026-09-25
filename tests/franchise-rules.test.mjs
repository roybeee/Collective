// R4a 가맹 규칙 레지스트리(lib/franchise-rules.ts) 회귀: 스키마 필드 완결, 54개 id, 시행일 창 경계(2026-12-30/31, 2027-12-31/2028-01-01), proposed 미적용, KST 날짜, 레지스트리 자체 검사, 얼림, 시계·외부 호출 없음.
// 근거: mocked(합성 입력, 외부 호출 0회). 법률 적합성은 not_run(LR-1 대상). 현재 시각은 모듈이 아니라 이 테스트가 읽어 registryIssues에 넘긴다.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {SourceTextModule,createContext} from 'node:vm';
import ts from 'typescript';
import {testRuntime} from './helpers/runtime.mjs';

const rt=testRuntime(async()=>{throw new Error('외부 호출 금지')});
const fr=await rt.load('lib/franchise-rules.ts');
const passed=[];const check=(name,val)=>{assert.ok(val,name);passed.push(name)};
const plain=x=>JSON.parse(JSON.stringify(x));
const same=(a,b)=>JSON.stringify(plain(a))===JSON.stringify(b);
const byId=id=>fr.FRANCHISE_RULES.find(r=>r.id===id);
const NOW=new Date().toISOString();
// FranchiseInputError를 code로 확인하고, 문구가 한국어 고정 문구이며 입력 값을 담지 않는지 본다(vm realm이 달라 instanceof 대신 name·code로 본다).
const throwsInput=(fn,code,input)=>{try{fn()}catch(e){return e?.name==='FranchiseInputError'&&e.code===code&&/[가-힣]/.test(e.message)&&(typeof input!=='string'||!input||(!e.message.includes(input)&&!String(e.stack).split('\n')[0].includes(input)))}return false};

// 0) 순수성: 모듈 원문에 시계·네트워크·import가 없다.
const src=readFileSync('lib/franchise-rules.ts','utf8');
// 줄 주석을 뺀 원문에서 시계·난수·환경·네트워크 접근 형태를 찾는다(new Date;·Date()·Date['now']·Reflect.construct 우회 포함). 인자 있는 new Date(ms)와 Date.UTC만 허용한다.
const code=src.replace(/^\s*\/\/.*$/gm,'');
const CLOCK=/(?<!new\s+)\bDate\s*\(|new\s+Date\b(?!\s*\(\s*[^)\s])|\bDate\s*\[|\bDate\.(now|parse)\b|Reflect\.construct|performance\.|Math\.random|\bprocess\.|\bcrypto\.|globalThis|\beval\s*\(|\bFunction\s*\(/;
check('clock pattern catches the bypass forms',['new Date;','new Date ()','Date()','Date["now"]()','Date.parse(x)','Reflect.construct(Date,[])','Math.random()','process.env.X'].every(x=>CLOCK.test(x))&&!CLOCK.test('new Date(ms).getUTCDay()')&&!CLOCK.test('Date.UTC(y,m,0)'));
check('rules module does not read the clock, randomness or environment',!CLOCK.test(code));
check('rules module makes no network call and does not depend on a URL global',!/\bfetch\s*\(|\bnew\s+URL\b|\bURL\s*\(/.test(code));
check('rules module has no import',!/^\s*import\s/m.test(src)&&!/\brequire\(/.test(src));

// 1) 레지스트리 모양: 54개, id 오름차순, 스키마 필드 완결, 얼림
const EXPECTED_IDS=['h.advice_shortening_evidence','h.captive_advisor_phrase','h.change_notice_restart','h.collab_rights_claims','h.direct_store_popularity','h.direct_to_franchise_inference','h.evidence_integrity','h.exclusive_supply_claims','h.fact_opinion_labels','h.first_day_excluded','h.handmade_claims','h.headline_claim_block','h.heritage_claims','h.last_day_holiday_extension','h.later_disclosure_doc','h.lead_retention_180','h.m4_receipt_required','h.net_profit_payback_claims','h.own_ip_claims','h.pre_contract_development_agreement','h.pre_registration_recruiting','h.revenue_figures_no_ad','h.same_asset_30_review','h.small_sample_suppression','h.wait_bypass_solicitation','h.zero_cost_claims',
 'kr.ad.endorsement_disclosure','kr.ad.virtual_human_label','kr.fr.association_bargaining','kr.fr.association_condition','kr.fr.association_condition_2026','kr.fr.association_decree','kr.fr.change_deadlines','kr.fr.change_deadlines_2028','kr.fr.conditional_support','kr.fr.delivery_methods','kr.fr.disclosure_wait','kr.fr.draft_wait','kr.fr.escrow','kr.fr.exclusive_channel_claims','kr.fr.forecast_statement','kr.fr.independent_advisor','kr.fr.insurance_mark','kr.fr.ip_claims','kr.fr.nearby_doc','kr.fr.production_claims','kr.fr.revenue_guarantee','kr.fr.startup_cost_claims','kr.fr.store_count_claims','kr.fr.superlative_claims','kr.fr.territory_claims','kr.fr.trade_area_claims',
 'platform.kakao.alimtalk','platform.meta.lead_form_fields'];
const ids=fr.FRANCHISE_RULES.map(r=>r.id);
check('registry holds exactly the 54 planned rule ids',fr.FRANCHISE_RULES.length===54&&same(ids,EXPECTED_IDS));
check('rule ids are unique',new Set(ids).size===ids.length);
check('rules are sorted by id in ASCII order',ids.every((id,i)=>i===0||ids[i-1]<id));
check('registry version is pinned',fr.FRANCHISE_RULES_VERSION==='2026-09-25.1');
const REQUIRED=['id','jurisdiction','article','title','status','selectBy','tier','basis','sourceUrls','verifiedAt','confidence'];
const ALLOWED_KEYS=new Set([...REQUIRED,'family','effectiveFrom','effectiveTo','scope','question','notes']);
check('every rule fills every schema field',fr.FRANCHISE_RULES.every(r=>REQUIRED.every(k=>Object.hasOwn(r,k)&&(k==='sourceUrls'?r.sourceUrls.length>0:typeof r[k]==='string'&&r[k].length>0))));
check('rules carry no field outside the schema',fr.FRANCHISE_RULES.every(r=>Object.keys(r).every(k=>ALLOWED_KEYS.has(k))));
check('every rule is jurisdiction KR',fr.FRANCHISE_RULES.every(r=>r.jurisdiction==='KR'));
check('every verifiedAt is a timezone-qualified instant',fr.FRANCHISE_RULES.every(r=>fr.isInstant(r.verifiedAt)&&/(Z|[+-]\d{2}:\d{2})$/.test(r.verifiedAt)));
check('effective dates are KST calendar dates',fr.FRANCHISE_RULES.every(r=>(r.effectiveFrom===undefined||fr.isDate(r.effectiveFrom))&&(r.effectiveTo===undefined||fr.isDate(r.effectiveTo))));
check('registry, rules and source lists are frozen',Object.isFrozen(fr.FRANCHISE_RULES)&&fr.FRANCHISE_RULES.every(r=>Object.isFrozen(r)&&Object.isFrozen(r.sourceUrls)));
assert.throws(()=>{byId('kr.fr.escrow').tier='warn'});assert.throws(()=>{fr.FRANCHISE_RULES.push({})});passed.push('frozen registry rejects mutation');

// 2) 구분: kr.* official, h.* heuristic(26), platform.* platform. proposed만 tier none.
check('kr.* rules are official',fr.FRANCHISE_RULES.filter(r=>r.id.startsWith('kr.')).every(r=>r.basis==='official'));
check('h.* rules are the 26 heuristics',fr.FRANCHISE_RULES.filter(r=>r.id.startsWith('h.')).length===26&&fr.FRANCHISE_RULES.filter(r=>r.id.startsWith('h.')).every(r=>r.basis==='heuristic')&&fr.FRANCHISE_RULES.filter(r=>r.basis==='heuristic').length===26);
check('platform.* rules are platform policy',same(fr.FRANCHISE_RULES.filter(r=>r.basis==='platform').map(r=>r.id),['platform.kakao.alimtalk','platform.meta.lead_form_fields']));
check('only proposed rules use tier none',fr.FRANCHISE_RULES.every(r=>(r.tier==='none')===(r.status==='proposed')));
check('proposed rules are the two unenacted items without dates',same(fr.FRANCHISE_RULES.filter(r=>r.status==='proposed').map(r=>r.id),['kr.fr.association_decree','kr.fr.independent_advisor'])&&fr.FRANCHISE_RULES.filter(r=>r.status==='proposed').every(r=>r.effectiveFrom===undefined&&r.effectiveTo===undefined));
check('scheduled rules all carry effectiveFrom',fr.FRANCHISE_RULES.filter(r=>r.status==='scheduled').every(r=>fr.isDate(r.effectiveFrom)));
check('official non-proposed rules cite law.go.kr or ftc.go.kr',fr.FRANCHISE_RULES.filter(r=>r.basis==='official'&&r.status!=='proposed').every(r=>r.sourceUrls.some(u=>/^https:\/\/www\.(law|ftc)\.go\.kr\//.test(u))));
// R2가 규제 사전(compliance-lexicon)으로 옮길 공식 표현 규칙은 law.go.kr 출처가 있어야 한다(tests/compliance.test.mjs 출처 규칙).
check('official claim rules bound for the R2 lexicon cite www.law.go.kr',fr.FRANCHISE_RULES.filter(r=>r.basis==='official'&&['hard_block','block_unless_evidence','warn'].includes(r.tier)).every(r=>r.sourceUrls.some(u=>u.startsWith('https://www.law.go.kr/'))));
check('every source URL is https without whitespace',fr.FRANCHISE_RULES.every(r=>r.sourceUrls.every(u=>u.startsWith('https://')&&!/\s/.test(u))));
check('holiday extension rule is the low-confidence representative directive',byId('h.last_day_holiday_extension').tier==='gate'&&byId('h.last_day_holiday_extension').confidence==='low'&&byId('h.last_day_holiday_extension').question==='Q1'&&byId('h.last_day_holiday_extension').verifiedAt==='2026-09-25T00:00:00+09:00');
check('draft_wait verifiedAt uses the shared research date',byId('kr.fr.draft_wait').verifiedAt==='2026-09-24T00:00:00+09:00');
check('families group the versioned rules',same(fr.FRANCHISE_RULES.filter(r=>r.family).map(r=>[r.id,r.family]),[['kr.fr.association_condition','kr.fr.association_condition'],['kr.fr.association_condition_2026','kr.fr.association_condition'],['kr.fr.change_deadlines','kr.fr.change_deadlines'],['kr.fr.change_deadlines_2028','kr.fr.change_deadlines']]));

// 3) 레지스트리 자체 검사: 현재 레지스트리는 깨끗하다(출처 없음·확인 시각 미래가 있으면 여기서 실패한다).
check('registry has no issue at the current time',same(fr.registryIssues(NOW),[]));
check('registry is also clean at the research timestamp',same(fr.registryIssues('2026-09-25T00:00:00+09:00'),[]));
check('registry flags the holiday rule one second before it was verified',same(fr.registryIssues('2026-09-24T23:59:59+09:00'),['h.last_day_holiday_extension:verified_at_future']));
const escrow={...byId('kr.fr.escrow')},advisor={...byId('kr.fr.independent_advisor')};
check('empty sources are flagged',same(fr.registryIssues(NOW,[{...escrow,sourceUrls:[]}]),['kr.fr.escrow:official_source_host','kr.fr.escrow:source_missing']));
check('a future verifiedAt is flagged',same(fr.registryIssues(NOW,[{...escrow,verifiedAt:'2199-01-01T00:00:00+09:00'}]),['kr.fr.escrow:verified_at_future']));
check('an official rule without a government source is flagged',same(fr.registryIssues(NOW,[{...escrow,sourceUrls:['https://example.com/x']}]),['kr.fr.escrow:official_source_host']));
check('a proposed rule with dates is flagged',same(fr.registryIssues(NOW,[{...advisor,effectiveFrom:'2027-01-01'}]),['kr.fr.independent_advisor:proposed_has_dates']));
check('plain http sources are flagged',same(fr.registryIssues(NOW,[{...escrow,sourceUrls:['http://www.law.go.kr/x']}]),['kr.fr.escrow:official_source_host','kr.fr.escrow:source_not_https']));
check('an empty verifiedAt is a missing field',same(fr.registryIssues(NOW,[{...escrow,verifiedAt:''}]),['kr.fr.escrow:field_missing']));
check('a verifiedAt without timezone is invalid',same(fr.registryIssues(NOW,[{...escrow,verifiedAt:'2026-09-24T00:00:00'}]),['kr.fr.escrow:verified_at_invalid']));
check('duplicate ids are flagged',same(fr.registryIssues(NOW,[escrow,{...escrow}]),['kr.fr.escrow:duplicate_id']));
check('malformed ids are flagged',same(fr.registryIssues(NOW,[{...escrow,id:'kr.fr.Bad-Id'}]),['kr.fr.Bad-Id:id_format']));
check('id prefix must match basis',same(fr.registryIssues(NOW,[{...escrow,basis:'heuristic'}]),['kr.fr.escrow:id_basis_mismatch']));
check('unknown enum values are flagged',same(fr.registryIssues(NOW,[{...escrow,tier:'block'}]),['kr.fr.escrow:enum_invalid'])&&same(fr.registryIssues(NOW,[{...escrow,jurisdiction:'US'}]),['kr.fr.escrow:enum_invalid']));
check('bad effective dates are flagged',same(fr.registryIssues(NOW,[{...escrow,effectiveFrom:'2026-02-30'}]),['kr.fr.escrow:date_invalid']));
check('an empty window is flagged',same(fr.registryIssues(NOW,[{...escrow,effectiveFrom:'2027-01-01',effectiveTo:'2027-01-01'}]),['kr.fr.escrow:window_invalid']));
check('scheduled without effectiveFrom is flagged',same(fr.registryIssues(NOW,[{...escrow,status:'scheduled'}]),['kr.fr.escrow:scheduled_without_from']));
check('a proposed rule with a real tier is flagged',same(fr.registryIssues(NOW,[{...advisor,tier:'gate'}]),['kr.fr.independent_advisor:proposed_tier']));
check('tier none outside proposed is flagged',same(fr.registryIssues(NOW,[{...escrow,tier:'none'}]),['kr.fr.escrow:tier_none_not_proposed']));
const cd=byId('kr.fr.change_deadlines'),cd28=byId('kr.fr.change_deadlines_2028');
check('overlapping family windows are flagged on both members',same(fr.registryIssues(NOW,[{...cd,effectiveTo:'2028-02-01'},cd28]),['kr.fr.change_deadlines:family_overlap','kr.fr.change_deadlines_2028:family_overlap']));
check('adjacent family windows do not overlap',same(fr.registryIssues(NOW,[cd,cd28]),[]));
check('an invalid now is reported once',same(fr.registryIssues('2026-09-25'),['registry:now_invalid'])&&same(fr.registryIssues('yesterday'),['registry:now_invalid']));
check('non-object rules are reported without echoing',same(fr.registryIssues(NOW,[null]),['?:field_missing','?:id_format']));

// 4) ruleAt 경계: 단체 협의의무 2026-12-30/31, 변경등록 기한 2027-12-31/2028-01-01, 단체 조건 금지 ⑤→⑥
check('bargaining duty is absent on 2026-12-30',fr.ruleAt('kr.fr.association_bargaining','2026-12-30')===null);
const bargaining=fr.ruleAt('kr.fr.association_bargaining','2026-12-31');
check('bargaining duty applies from 2026-12-31',bargaining?.id==='kr.fr.association_bargaining'&&bargaining.status==='scheduled'&&bargaining.effectiveFrom==='2026-12-31');
check('instants are compared on the KST date (14:59:59Z is still 12-30)',fr.ruleAt('kr.fr.association_bargaining','2026-12-30T14:59:59Z')===null);
check('15:00Z on 12-30 is KST midnight 12-31',fr.ruleAt('kr.fr.association_bargaining','2026-12-30T15:00:00Z')?.id==='kr.fr.association_bargaining');
check('23:59:59 KST on 12-30 is still before the boundary',fr.ruleAt('kr.fr.association_bargaining','2026-12-30T23:59:59+09:00')===null);
check('change deadline family picks the current version on 2027-12-31',fr.ruleAt('kr.fr.change_deadlines','2027-12-31')?.id==='kr.fr.change_deadlines');
check('change deadline family picks the 2028 version on 2028-01-01',fr.ruleAt('kr.fr.change_deadlines','2028-01-01')?.id==='kr.fr.change_deadlines_2028');
check('the 2028 rule by its own id is absent before 2028',fr.ruleAt('kr.fr.change_deadlines_2028','2027-12-31')===null&&fr.ruleAt('kr.fr.change_deadlines_2028','2028-01-01')?.id==='kr.fr.change_deadlines_2028');
check('the current change deadline rule does not exist before 2021-11-19',fr.ruleAt('kr.fr.change_deadlines','2021-11-18')===null&&fr.ruleAt('kr.fr.change_deadlines','2021-11-19')?.id==='kr.fr.change_deadlines');
const cond30=fr.ruleAt('kr.fr.association_condition','2026-12-30'),cond31=fr.ruleAt('kr.fr.association_condition','2026-12-31');
check('association condition is paragraph 5 on 2026-12-30',cond30?.id==='kr.fr.association_condition'&&cond30.article.includes('제14조의2⑤'));
check('association condition moves to paragraph 6 on 2026-12-31',cond31?.id==='kr.fr.association_condition_2026'&&cond31.article.includes('제14조의2⑥'));
check('draft shortening rule starts on 2023-11-09',fr.ruleAt('kr.fr.draft_wait','2023-11-08')===null&&fr.ruleAt('kr.fr.draft_wait','2023-11-09')?.id==='kr.fr.draft_wait');
check('rules without dates apply at the range edges',fr.ruleAt('kr.fr.delivery_methods','2000-01-01')?.id==='kr.fr.delivery_methods'&&fr.ruleAt('h.first_day_excluded','2199-12-31')?.id==='h.first_day_excluded');
check('an unknown id returns null',fr.ruleAt('kr.fr.no_such_rule','2026-10-01')===null);
check('a returned rule is the frozen registry object',fr.ruleAt('kr.fr.escrow','2026-10-01')===byId('kr.fr.escrow'));

// 5) proposed는 어떤 날짜에도 적용되지 않는다.
for(const d of ['2000-01-01','2026-09-24','2026-12-31','2028-01-01','2199-12-31']){
 check(`proposed rules never apply on ${d}`,fr.ruleAt('kr.fr.independent_advisor',d)===null&&fr.ruleAt('kr.fr.association_decree',d)===null&&!fr.rulesAt(d).some(r=>r.status==='proposed')&&same(fr.rulesAt(d,{status:'proposed'}),[]));
}

// 6) rulesAt 필터
const HARD_1001=['h.captive_advisor_phrase','h.net_profit_payback_claims','h.revenue_figures_no_ad','h.wait_bypass_solicitation','kr.fr.association_condition','kr.fr.insurance_mark','kr.fr.revenue_guarantee'];
check('hard_block set on 2026-10-01',same(fr.rulesAt('2026-10-01',{tier:'hard_block'}).map(r=>r.id),HARD_1001));
check('hard_block set on 2026-12-31 swaps in paragraph 6',same(fr.rulesAt('2026-12-31',{tier:'hard_block'}).map(r=>r.id),HARD_1001.map(id=>id==='kr.fr.association_condition'?'kr.fr.association_condition_2026':id)));
check('26 heuristics apply on 2026-10-01',fr.rulesAt('2026-10-01',{basis:'heuristic'}).length===26);
check('platform rules on 2026-10-01',same(fr.rulesAt('2026-10-01',{basis:'platform'}).map(r=>r.id),['platform.kakao.alimtalk','platform.meta.lead_form_fields']));
check('rulesAt without filter returns the 49 rules in force on 2026-10-01 in id order',(()=>{const all=fr.rulesAt('2026-10-01').map(r=>r.id);return all.length===49&&all.every((id,i)=>i===0||all[i-1]<id)})());
check('family filter selects the version in force',same(fr.rulesAt('2027-06-01',{family:'kr.fr.change_deadlines'}).map(r=>r.id),['kr.fr.change_deadlines'])&&same(fr.rulesAt('2028-06-01',{family:'kr.fr.change_deadlines'}).map(r=>r.id),['kr.fr.change_deadlines_2028']));
check('scope, selectBy and ids filters combine',same(fr.rulesAt('2026-10-01',{scope:'objective_export',tier:'warn'}).map(r=>r.id),['h.direct_to_franchise_inference'])&&same(fr.rulesAt('2026-10-01',{selectBy:'application_date'}).map(r=>r.id),['kr.fr.change_deadlines'])&&same(fr.rulesAt('2026-10-01',{ids:['kr.fr.escrow','kr.fr.association_decree','nope']}).map(r=>r.id),['kr.fr.escrow']));
check('scheduled rules appear only from their start date',!fr.rulesAt('2026-12-30').some(r=>r.id==='kr.fr.association_bargaining')&&fr.rulesAt('2026-12-31',{status:'scheduled'}).map(r=>r.id).join()==='kr.fr.association_bargaining,kr.fr.association_condition_2026');
check('rulesAt returns a fresh array each call',fr.rulesAt('2026-10-01')!==fr.rulesAt('2026-10-01'));

// 7) 날짜 입력 거부: 형식이 틀리거나 시간대 없는 시각은 invalid_date(문구에 값 없음)
for(const x of ['2026-13-01','2026-02-30','2026-10-01T10:00:00','2026-10-01 10:00+09:00','','20261001',null,123,'1999-12-31','2026-10-01T10:00:00-00:00']){
 check(`ruleAt rejects ${JSON.stringify(x)} as invalid_date without echo`,throwsInput(()=>fr.ruleAt('kr.fr.disclosure_wait',x),'invalid_date',x));
}
check('rulesAt rejects bad dates the same way',throwsInput(()=>fr.rulesAt('2026-10-01T09:00'),'invalid_date','2026-10-01T09:00'));
check('an unknown id with a bad date still throws',throwsInput(()=>fr.ruleAt('kr.fr.no_such_rule','bad-date'),'invalid_date','bad-date'));

// 8) 시각·날짜 보조 함수
check('instants need a timezone and allow minutes-only',fr.isInstant('2026-10-05T15:30Z')&&fr.isInstant('2026-10-05T15:30:00.123+09:00')&&fr.isInstant('2026-10-05T15:30:00-14:00'));
for(const bad of ['2026-10-05T10:00:00','2026-10-05 10:00:00+09:00','2026-02-30T10:00:00+09:00','2026-10-05T24:00:00+09:00','2026-10-05T10:00:00-00:00','2026-10-05T10:00:00.1234+09:00','2026-10-05t10:00:00z','20261005T100000+0900','2026-10-05T10:00:00+0900','2026-10-05T10:00:60Z','2026-10-05T10:00:00+14:30','2026-10-05T10:00:00+09:60','1999-12-31T23:59:59Z','2200-01-01T00:00:00Z','2027-02-29T00:00:00Z',' 2026-10-05T10:00:00Z',123,null]){
 check(`parseInstant rejects ${JSON.stringify(bad)} without echo`,!fr.isInstant(bad)&&throwsInput(()=>fr.parseInstant(bad),'invalid_timestamp',bad));
}
check('parseInstant uses the offset',fr.parseInstant('2026-10-05T15:30Z')===Date.UTC(2026,9,5,15,30)&&fr.parseInstant('2026-10-06T00:30:00+09:00')===Date.UTC(2026,9,5,15,30)&&fr.parseInstant('2026-10-05T10:00:00.5Z')===Date.UTC(2026,9,5,10,0,0,500));
check('leap day 2028-02-29 is valid, 2027-02-29 is not',fr.isDate('2028-02-29')&&!fr.isDate('2027-02-29')&&!fr.isDate('2026-10-5')&&!fr.isDate('2026-10-05T00:00:00+09:00'));
check('toKstDate: 2026-10-05T15:30Z is KST 10-06',fr.toKstDate('2026-10-05T15:30Z')==='2026-10-06'&&fr.toKstDate('2026-10-05T14:59:59Z')==='2026-10-05');
check('kstDateOf keeps dates and converts instants',fr.kstDateOf('2026-10-05')==='2026-10-05'&&fr.kstDateOf('2026-12-31T15:00:00Z')==='2027-01-01');
check('parseDate and kstDateOf reject junk as invalid_date',throwsInput(()=>fr.parseDate('2026-10-05T00:00:00Z'),'invalid_date','2026-10-05T00:00:00Z')&&throwsInput(()=>fr.kstDateOf('soon'),'invalid_date','soon'));
check('addDays crosses months, years and leap days',fr.addDays('2026-10-05',14)==='2026-10-19'&&fr.addDays('2026-12-31',120)==='2027-04-30'&&fr.addDays('2027-12-31',120)==='2028-04-29'&&fr.addDays('2028-02-28',1)==='2028-02-29'&&fr.addDays('2026-01-01',-1)==='2025-12-31');
check('addDays refuses bad inputs',throwsInput(()=>fr.addDays('2026-02-30',1),'invalid_date','2026-02-30')&&throwsInput(()=>fr.addDays('2026-10-05',1.5),'invalid_date'));
check('weekdayOf uses the calendar date (2026-10-05 Monday, 10-10 Saturday, 10-11 Sunday)',fr.weekdayOf('2026-10-05')===1&&fr.weekdayOf('2026-10-10')===6&&fr.weekdayOf('2026-10-11')===0&&fr.weekdayOf('2028-04-29')===6);
check('kstMidnight formats the KST start of day',fr.kstMidnight('2026-10-20')==='2026-10-20T00:00:00+09:00'&&fr.KST_OFFSET==='+09:00');
check('compareInstant orders across offsets',fr.compareInstant('2026-10-05T15:30Z','2026-10-06T00:30:00+09:00')===0&&fr.compareInstant('2026-10-05T15:29Z','2026-10-06T00:30:00+09:00')===-1&&fr.compareInstant('2026-10-06T00:31:00+09:00','2026-10-05T15:30Z')===1);
check('FranchiseInputError has fixed messages per code',(()=>{const a=new fr.FranchiseInputError('invalid_timestamp'),b=new fr.FranchiseInputError('invalid_date');return a.message==='시각은 시간대가 있는 ISO 8601이어야 합니다.'&&b.message==='날짜는 YYYY-MM-DD 또는 시간대가 있는 ISO 8601이어야 합니다.'&&a.name==='FranchiseInputError'&&Object.keys(a).sort().join()==='code,name'})());

// 9) 검토 반영 회귀(2026-09-25)
check('instants whose KST date leaves 2000-2199 are refused',!fr.isInstant('2199-12-31T20:00:00Z')&&!fr.isInstant('2000-01-01T00:00:00+14:00')&&fr.isInstant('2199-12-31T14:59:59Z')&&fr.isInstant('2000-01-01T00:00:00+09:00')&&throwsInput(()=>fr.toKstDate('2199-12-31T20:00:00Z'),'invalid_timestamp','2199-12-31T20:00:00Z')&&throwsInput(()=>fr.kstDateOf('2199-12-31T20:00:00Z'),'invalid_date','2199-12-31T20:00:00Z'));
check('addDays refuses results outside 2000-2199 instead of returning a broken date',throwsInput(()=>fr.addDays('2026-01-01',1e9),'invalid_date')&&throwsInput(()=>fr.addDays('2026-01-01',1e8),'invalid_date')&&throwsInput(()=>fr.addDays('2199-12-31',1),'invalid_date')&&throwsInput(()=>fr.addDays('2000-01-01',-1),'invalid_date')&&fr.addDays('2199-12-30',1)==='2199-12-31'&&fr.addDays('2000-01-02',-1)==='2000-01-01');
check('a non-array ids filter closes instead of matching everything',same(fr.rulesAt('2026-10-01',{ids:'kr.fr.escrow'}),[])&&same(fr.rulesAt('2026-10-01',{ids:{0:'kr.fr.escrow'}}),[]));
check('registryIssues refuses a non-array rule list',same(fr.registryIssues(NOW,null),['registry:rules_invalid'])&&same(fr.registryIssues(NOW,{}),['registry:rules_invalid']));
check('unreadable entries are not counted as duplicates of each other',same(fr.registryIssues(NOW,[null,null]),['?:field_missing','?:id_format']));
for(const u of ['https://user@www.law.go.kr/x','https://www.law.go.kr\\x','https://[::1]/x','https://www.law.go.kr /x','https:/www.law.go.kr/x']){
 check(`source ${JSON.stringify(u)} is not an https source`,fr.registryIssues(NOW,[{...escrow,sourceUrls:[u]}]).includes('kr.fr.escrow:source_not_https'));
}
check('a port on an official host is still an official host',same(fr.registryIssues(NOW,[{...escrow,sourceUrls:['https://www.law.go.kr:443/x']}]),[]));
check('the 2028 deadline rule cites the 2028 annex, not the older decree',byId('kr.fr.change_deadlines_2028').sourceUrls.some(u=>u.includes('MST=288453&efYd=20280101'))&&!byId('kr.fr.change_deadlines_2028').sourceUrls.some(u=>u.includes('MST=284653')));
check('same-method notices and draft evidence are marked as COLLECTIVE heuristics',byId('h.change_notice_restart').notes.includes('어느 방법이든')&&byId('kr.fr.delivery_methods').notes.includes('계약서안'));
check('draft_wait notes carry the 19614 addendum for LR-1',byId('kr.fr.draft_wait').notes.includes('부칙 제2조'));

// 10) 실행 검사: console·가드 Date(인자 없는 생성·Date()·Date.now·Date.parse는 던짐)·가드 Math.random만 둔 컨텍스트에서 모듈을 다시 불러 돌린다. URL·process·crypto·fetch가 없어 접근하면 ReferenceError다.
const RealDate=Date;
function GuardDate(...a){if(!new.target)throw new Error('Date() 호출 금지');if(!a.length)throw new Error('인자 없는 new Date 금지');return new RealDate(...a)}
GuardDate.UTC=RealDate.UTC;GuardDate.now=()=>{throw new Error('Date.now 금지')};GuardDate.parse=()=>{throw new Error('Date.parse 금지')};GuardDate.prototype=RealDate.prototype;
const guardCtx=createContext({console,Date:GuardDate,Math:Object.create(Math,{random:{value:()=>{throw new Error('Math.random 금지')}}})});
const gm=new SourceTextModule(ts.transpileModule(src,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText,{context:guardCtx,identifier:resolve('lib/franchise-rules.ts')});
await gm.link(()=>{throw new Error('import 금지')});await gm.evaluate();
const gr=gm.namespace;
const runAll=m=>[m.ruleAt('kr.fr.change_deadlines','2028-01-01'),m.rulesAt('2026-12-31',{tier:'hard_block'}).map(r=>r.id),m.registryIssues(NOW),m.registryIssues(NOW,[{...escrow,sourceUrls:['https://user@www.law.go.kr/x']}]),m.addDays('2027-12-31',120),m.weekdayOf('2028-04-29'),m.toKstDate('2026-10-05T15:30Z'),m.kstMidnight('2026-10-20'),m.compareInstant('2026-10-05T15:30Z','2026-10-06T00:30:00+09:00')];
check('rules run without clock, randomness, URL, process or fetch and match the normal run',same(runAll(gr),plain(runAll(fr))));

// 11) R2 모집 표현 판정 상수: 규칙 레지스트리(54개·버전)는 그대로이고 별도 상수만 더했다. 상수는 얼려져 있고, 해제 불가 목록은 레지스트리 hard_block(적용 범위 있음)과 같다.
check('R2 claim constants are frozen, deeply',Object.isFrozen(fr.FRANCHISE_HARD_BLOCK_IDS)&&Object.isFrozen(fr.FRANCHISE_CLAIM_MATCHERS)&&Object.values(fr.FRANCHISE_CLAIM_MATCHERS).every(Object.isFrozen)&&Object.isFrozen(fr.FRANCHISE_CLAIM_EVIDENCE)&&Object.values(fr.FRANCHISE_CLAIM_EVIDENCE).every(e=>Object.isFrozen(e)&&[e.factKeys,e.valueKinds].every(x=>x===undefined||Object.isFrozen(x)))&&Object.isFrozen(fr.FRANCHISE_CLAIM_LOGIC));
assert.throws(()=>{fr.FRANCHISE_HARD_BLOCK_IDS.push('x')});assert.throws(()=>{fr.FRANCHISE_CLAIM_MATCHERS['h.handmade_claims'].match='x'});passed.push('frozen claim constants reject mutation');
check('claims version is pinned and the registry version is unchanged',fr.FRANCHISE_CLAIMS_VERSION==='fr-claims@2026-09-25.1'&&fr.FRANCHISE_RULES_VERSION==='2026-09-25.1'&&fr.FRANCHISE_RULES.length===54);
check('the unremovable list equals the scoped hard_block registry rules',same([...fr.FRANCHISE_HARD_BLOCK_IDS].sort(),fr.FRANCHISE_RULES.filter(r=>r.tier==='hard_block'&&r.scope).map(r=>r.id).sort())&&fr.FRANCHISE_HARD_BLOCK_IDS.length===8);
check('heuristic matchers are exactly the scoped heuristic pattern rules and compile',same(Object.keys(fr.FRANCHISE_CLAIM_MATCHERS).sort(),fr.FRANCHISE_RULES.filter(r=>r.basis==='heuristic'&&r.scope&&!fr.FRANCHISE_CLAIM_LOGIC.includes(r.id)).map(r=>r.id).sort())&&Object.values(fr.FRANCHISE_CLAIM_MATCHERS).every(m=>[m.match,m.also,m.except,m.cleared].filter(Boolean).every(x=>new RegExp(x)&&true)&&m.title.length>0));
check('evidence is never attached to an unremovable rule except the insurance contract condition',Object.keys(fr.FRANCHISE_CLAIM_EVIDENCE).every(id=>!fr.FRANCHISE_HARD_BLOCK_IDS.includes(id)||id==='kr.fr.insurance_mark'));
check('registryIssues stays empty after the R2 additions',fr.registryIssues(NOW).length===0);

console.log(JSON.stringify({passed:passed.length}));
