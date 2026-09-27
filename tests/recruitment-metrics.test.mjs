// R6a 모집 퍼널·비용·speed-to-lead·주간 보고 순수 모듈(lib/franchise-report.ts) 회귀. 사례 번호 RM-*는 R6a PR 본문 수용 기준과 같다.
// 확인: 구문 import 경계(RM-S1), 주·칸 억제·비율 규칙(RM-W·RM-C·RM-R), 유입(RM-I), 채널 CPL·플랫폼 보고(RM-P), speed-to-lead(RM-T), 문의 월 코호트·계약당 비용(RM-K),
// 법정 게이트 집계(RM-G), 규칙 신선도(RM-F), 결정론·다이제스트(RM-D), 값 누출 없음(RM-X), 고정 문구 순서(RM-N), Markdown·CSV(RM-O).
// 근거: mocked(순수 함수, 합성 입력, 외부 호출 0회). 저장·API·화면·kind는 R6b·R6c가 맡는다. 법률 적합성은 not_run(LR-1 대상, 결정 20 보류).
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {testRuntime} from './helpers/runtime.mjs';

let fetchCalls=0;
const rt=testRuntime(async()=>{fetchCalls++;throw new Error('외부 호출 금지')});
const rep=await rt.load('lib/franchise-report.ts'),rc=await rt.load('lib/franchise-recruitment.ts'),fr=await rt.load('lib/franchise-rules.ts');
const passed=[];const check=(name,val)=>{assert.ok(val,name);passed.push(name)};
const plain=x=>JSON.parse(JSON.stringify(x));
const same=(a,b)=>JSON.stringify(plain(a))===JSON.stringify(b);
const asc=(a,b)=>a<b?-1:a>b?1:0;
const DISCLAIMER='COLLECTIVE 휴리스틱 · 법률 자문 아님';

// ════ RM-S1 구문 경계 ════
const SRC=readFileSync('lib/franchise-report.ts','utf8');
const refs=[];
{const sf=ts.createSourceFile('m.ts',SRC,ts.ScriptTarget.Latest,false,ts.ScriptKind.TS);
 const visit=n=>{
  if(ts.isImportDeclaration(n))refs.push({kind:n.importClause?.isTypeOnly?'import type':'import',spec:n.moduleSpecifier.text});
  else if(ts.isExportDeclaration(n)&&n.moduleSpecifier)refs.push({kind:'export',spec:n.moduleSpecifier.text});
  else if(ts.isCallExpression(n)&&(n.expression.kind===ts.SyntaxKind.ImportKeyword||(ts.isIdentifier(n.expression)&&n.expression.text==='require')))refs.push({kind:'call',spec:'(call)'});
  else if(ts.isImportTypeNode(n))refs.push({kind:'import type()',spec:'(type)'});
  ts.forEachChild(n,visit);
 };visit(sf)}
check('RM-S1 the module imports only the four pure franchise modules, all static imports',same([...new Set(refs.map(r=>r.spec))].sort(asc),['./franchise','./franchise-gates','./franchise-recruitment','./franchise-rules'])&&refs.every(r=>r.kind==='import'||r.kind==='import type'));
const CODE=SRC.replace(/^\s*\/\/.*$/gm,'');
check('RM-S1 no fetch, clock, randomness, environment, storage call or record-kind literal',!/\bfetch\s*\(/.test(SRC)&&!/\bDate\.now\b|new\s+Date\s*\(\s*\)|Math\.random|\bcrypto\.|\bprocess\.|globalThis/.test(CODE)&&!/recordStatement|readRecord|listRecords|database\(|recruitment_(report|code|spend|import|asset|event)|franchise_lead/.test(SRC)&&!/\bany\b/.test(CODE));
check('RM-S1 no model or HERMES reference',!/hermes|openai|anthropic|role-execution|meeting-execution/i.test(CODE));

// ════ 합성 입력 ════
const BRAND='oda-fr',OTHER='other-brand',WEEK='2026-W39',AS_OF='2026-09-28T01:00:00Z';
const MARK='ZZMARKZZ';
let seq=0;
// 리드: 접수 시각(KST 기준 입력은 +09:00), 선택 필드. id·코드에 표지 문자열을 넣어 출력 누출을 본다.
const lead=(at,o={})=>({id:`lead-${MARK}-${++seq}`,brandId:BRAND,stage:'inquiry',closedFrom:null,createdAt:at,firstContactAt:null,contractedAt:null,codes:[],codeStrikes:[],...o});
const codeRow=(code,channel,o={})=>({code,brandId:BRAND,channel,validFrom:'2026-01-01',createdAt:'2026-01-01T00:00:00Z',retiredOn:null,retiredAt:null,campaignId:null,assetRef:null,eventId:null,...o});
const book={codes:[codeRow('RAAAAAAA','portal'),codeRow('RBBBBBBB','search_ad'),codeRow('RCCCCCCC','lead_ad'),codeRow('RDDDDDDD','expo'),codeRow('RXTHERBR','portal',{brandId:OTHER}),codeRow('RMATEAAA','youtube',{createdAt:'2026-09-25T00:00:00Z'})],tracking:[{value:'RQQQQQQQ',createdAt:'2026-01-01T00:00:00Z'}]};
book.codes.push(codeRow('RQQQQQQQ','blog_post'));
const tok=(code,at,source='manual')=>({code,at,source});
const spendRow=(id,channel,from,to,amount,o={})=>({id,version:1,channel,period:{from,to},amountExVat:amount,createdAt:'2026-09-01T00:00:00Z',voided:null,platform:null,...o});
const base=o=>({brandId:BRAND,week:WEEK,asOf:AS_OF,leads:[],book,spend:[],blockedAttempts:[],contractEvidence:[],...o});
const build=o=>rep.buildRecruitmentReport(base(o));
const throwsRange=f=>{try{f();return false}catch(e){return e?.name==='RangeError'}};
const inWeek=(day,hh='10')=>`2026-09-${day}T${hh}:00:00+09:00`;
const many=(n,f)=>Array.from({length:n},(_,i)=>f(i));

// ════ RM-W 주 ════
check('RM-W1 ISO week 2026-W39 is Monday 2026-09-21 to Sunday 2026-09-27 in Asia/Seoul',same(rep.reportWeek('2026-W39'),{week:'2026-W39',from:'2026-09-21',to:'2026-09-27',timeZone:'Asia/Seoul'}));
check('RM-W1 week 53 exists only in long years and malformed weeks are null',rep.reportWeek('2025-W53')===null&&rep.reportWeek('2026-W53')!==null&&['2026-W00','2026-W54','2026-39','x',''].every(w=>rep.reportWeek(w)===null)&&rep.isoWeekOfDate('2027-01-01')==='2026-W53');
check('RM-W2 an unknown week, a bad asOf or a week that has not started throws RangeError',throwsRange(()=>build({week:'2026-W00'}))&&throwsRange(()=>build({asOf:'2026-09-28'}))&&throwsRange(()=>build({week:'2026-W41'}))&&!throwsRange(()=>build({})));
check('RM-W2 a week in progress can be built (asOf inside the week)',build({asOf:'2026-09-23T00:00:00Z'}).period.week===WEEK);

// ════ RM-C·RM-R 칸 억제·비율 ════
check('RM-C1 zero is shown, one to four are suppressed, five and above are shown',same(rep.cell(0),{n:0,suppressed:false})&&[1,2,3,4].every(n=>same(rep.cell(n),{n:null,suppressed:true}))&&same(rep.cell(5),{n:5,suppressed:false})&&same(rep.cell(120),{n:120,suppressed:false}));
check('RM-R1 a ratio needs at least twenty in the denominator',same(rep.rate(10,19),{value:null,state:'small_sample'})&&same(rep.rate(10,20),{value:0.5,state:'shown'})&&same(rep.rate(0,0),{value:null,state:'none'}));
check('RM-R1 a ratio over a suppressed numerator is suppressed too',same(rep.rate(3,40),{value:null,state:'suppressed'})&&same(rep.rate(0,40),{value:0,state:'shown'})&&same(rep.rate(5,40),{value:0.125,state:'shown'}));
check('RM-R1 thresholds are exposed as frozen constants',rep.RATIO_MIN_N===20&&rep.SUPPRESS_BELOW===5&&rep.COHORT_MATURE_DAYS===90&&rep.RULE_STALE_DAYS===180);

// ════ RM-I 유입 ════
{
 const leads=[
  ...many(6,()=>lead(inWeek('22'),{codes:[tok('RAAAAAAA',inWeek('22'))]})),            // 창업 포털 코드 6
  ...many(2,()=>lead(inWeek('23'),{codes:[tok('RBBBBBBB',inWeek('23'))]})),            // 검색광고 코드 2(병합)
  ...many(3,()=>lead(inWeek('24'),{codes:[tok('RCCCCCCC',inWeek('24'))]})),            // 리드광고 코드 3(병합)
  ...many(5,()=>lead('2026-09-10T00:00:00Z',{createdAt:'2026-09-26T00:00:00Z',receivedAt:inWeek('25'),receivedPrecision:'time',importId:'ri-1',imports:[{importId:'ri-1',channel:'expo',eventId:null,merged:false}]})), // 박람회 제공처 파일 5
  lead(inWeek('25'),{codes:[tok('RQQQQQQQ',inWeek('25'))]}),                            // 점포 코드 충돌
  lead(inWeek('26')),                                                                   // 코드 없음
  lead(inWeek('24'),{codes:[tok('RMATEAAA',inWeek('24'))]}),                            // 소급 등록 코드(코드 생성이 토큰보다 늦다)
  lead(inWeek('21'),{codes:[tok('RAAAAAAA','2026-09-26T01:00:00Z')]}),                  // 늦은 입력(72시간 뒤)
  lead('2026-09-20T14:59:00Z'),                                                         // KST 09-20 23:59 → 주 밖
  lead('2026-09-20T15:00:00Z'),                                                         // KST 09-21 00:00 → 주 안
  lead(inWeek('22'),{brandId:OTHER,codes:[tok('RXTHERBR',inWeek('22'))]}),              // 다른 브랜드 → 제외
  lead('2026-09-28T02:00:00Z'),                                                         // asOf 뒤 생성 → 제외
 ];
 const r=build({leads});
 const ch=k=>r.inflow.channels.find(c=>c.key===k);
 check('RM-I1 leads of another brand and leads created after asOf are excluded and counted',same(r.excluded,{otherBrand:1,afterAsOf:1}));
 check('RM-I1 the week window is KST: 23:59 on Sunday before is out, 00:00 on Monday is in',r.inflow.total.n===6+2+3+5+1+1+1+1+1);
 check('RM-I2 code, file basis, unattributed and conflict are separate columns',r.inflow.code.n===13&&r.inflow.file.n===5&&same(r.inflow.conflict,{n:null,suppressed:true})&&same(r.inflow.unattributed,{n:null,suppressed:true}));
 check('RM-I2 manual and imported leads are counted apart',r.inflow.manual.n===16&&r.inflow.imported.n===5);
 check('RM-I2 retroactive and late badges are counted apart and suppressed when small',same(r.inflow.retroactive,{n:null,suppressed:true})&&same(r.inflow.late,{n:null,suppressed:true}));
 check('RM-I3 a channel with five or more keeps its own row',ch('portal')&&ch('portal').total.n===7&&ch('portal').code.n===7&&ch('portal').file.n===0&&ch('expo').total.n===5&&ch('expo').file.n===5);
 check('RM-I3 channels with one to four leads merge into one row (DP-10) that is shown when the sum reaches five',ch('_small')&&ch('_small').merged===true&&same(ch('_small').channels,['search_ad','lead_ad','youtube'])&&same(ch('_small').channelLabels,['네이버 검색광고','메타 리드광고','유튜브'])&&ch('_small').total.n===6&&!ch('search_ad')&&!ch('lead_ad'));
 check('RM-I3 channels with no lead are not listed',!ch('community')&&!ch('store_qr'));
 check('RM-I4 the attributed rate is hidden under twenty leads',build({leads:leads.slice(0,10)}).inflow.attributedRate.state==='small_sample'&&build({leads:leads.slice(0,10)}).inflow.attributedRate.value===null);
 const big=build({leads:[...leads,...many(10,()=>lead(inWeek('23'),{codes:[tok('RAAAAAAA',inWeek('23'))]}))]});
 check('RM-I4 with thirty-one leads the attributed rate is (code + file) / total',big.inflow.total.n===31&&same(big.inflow.attributedRate,{value:Math.round(28/31*1e4)/1e4,state:'shown'})&&same(r.inflow.attributedRate,{value:Math.round(18/21*1e4)/1e4,state:'shown'}));
 const split=build({leads:[...many(7,()=>lead(inWeek('22'),{codes:[tok('RAAAAAAA',inWeek('22'))]})),...many(2,()=>lead('2026-09-10T00:00:00Z',{createdAt:'2026-09-26T00:00:00Z',receivedAt:inWeek('25'),importId:'ri-2',imports:[{importId:'ri-2',channel:'portal',eventId:null,merged:false}]}))]});
 const p=split.inflow.channels.find(c=>c.key==='portal');
 check('RM-I5 when one side of a code/file split is one to four both sides are suppressed (no subtraction from the row total)',p.total.n===9&&p.code.suppressed&&p.file.suppressed&&p.code.n===null&&p.file.n===null);
 const one=build({leads:[lead(inWeek('22'),{codes:[tok('RBBBBBBB',inWeek('22'))]})]});
 check('RM-I5 a merged row under five is suppressed',same(one.inflow.channels.find(c=>c.key==='_small').total,{n:null,suppressed:true}));
}

// ════ RM-P 채널 CPL·플랫폼 보고 ════
{
 const portalLeads=many(20,()=>lead(inWeek('22'),{codes:[tok('RAAAAAAA',inWeek('22'))]}));
 const portalFile=many(5,()=>lead('2026-09-01T00:00:00Z',{createdAt:'2026-09-26T00:00:00Z',receivedAt:inWeek('24'),importId:'ri-3',imports:[{importId:'ri-3',channel:'portal',eventId:null,merged:false}]}));
 const searchLeads=many(8,()=>lead(inWeek('23'),{codes:[tok('RBBBBBBB',inWeek('23'))]}));
 const spend=[
  spendRow('rs-1','portal','2026-09-21','2026-09-27',500000,{platform:{impressions:10000,clicks:300,formSubmits:40}}),
  spendRow('rs-2','portal','2026-09-22','2026-09-22',100000,{platform:{impressions:null,clicks:50,formSubmits:null}}),
  spendRow('rs-3','search_ad','2026-09-21','2026-09-27',200000),
  spendRow('rs-4','lead_ad','2026-09-01','2026-09-30',900000),                       // 걸친 행
  spendRow('rs-5','expo','2026-09-23','2026-09-23',300000,{voided:{at:'2026-09-24T00:00:00Z',reason:'entry_error'}}), // 무효화
  spendRow('rs-6','youtube','2026-09-23','2026-09-23',70000,{createdAt:'2026-09-28T05:00:00Z'}), // asOf 뒤 기록
 ];
 const r=build({leads:[...portalLeads,...portalFile,...searchLeads],spend});
 const c=k=>r.cost.channels.find(x=>x.key===k);
 check('RM-P1 CPL divides the channel spend by code plus file-basis leads when the denominator reaches twenty',c('portal').spend===600000&&c('portal').leads.n===25&&same(c('portal').cpl,{value:24000,state:'shown'}));
 check('RM-P1 the code-only CPL uses its own denominator',c('portal').leadsCode.n===20&&same(c('portal').cplCode,{value:30000,state:'shown'}));
 check('RM-P2 a denominator under twenty hides the CPL (small sample) but keeps the spend',c('search_ad').spend===200000&&c('search_ad').leads.n===8&&same(c('search_ad').cpl,{value:null,state:'small_sample'}));
 check('RM-P3 a channel with a spend row straddling the week has no CPL and an aligned window',c('lead_ad').spend===0&&c('lead_ad').straddling===1&&same(c('lead_ad').cpl,{value:null,state:'straddling'})&&same(c('lead_ad').aligned,{from:'2026-09-01',to:'2026-09-30'}));
 check('RM-P4 voided rows and rows recorded after asOf are not spend (unknown, not zero)',!c('expo')&&!c('youtube'));
 check('RM-P4 total spend counts only rows fully inside the week',r.cost.totalSpend===800000&&r.cost.straddlingRows===1);
 const noSpend=build({leads:portalLeads});
 check('RM-P5 leads without any spend row give a null CPL marked no_spend',same(noSpend.cost.channels.find(x=>x.key==='portal').cpl,{value:null,state:'no_spend'})&&noSpend.cost.channels.find(x=>x.key==='portal').spend===null);
 const noLead=build({spend:[spendRow('rs-9','community','2026-09-22','2026-09-22',1000)]});
 check('RM-P5 spend without leads gives a null CPL marked no_leads',same(noLead.cost.channels.find(x=>x.key==='community').cpl,{value:null,state:'no_leads'}));
 check('RM-P6 platform-reported numbers are a separate list that sums known values per channel and keeps unknown as null',same(r.cost.platform.find(x=>x.key==='portal'),{key:'portal',label:'창업 포털',impressions:10000,clicks:350,formSubmits:40,note:rc.PLATFORM_REPORTED_NOTE})&&r.cost.platform.every(x=>x.key!=='search_ad'));
 check('RM-P6 platform numbers never enter the CPL (portal CPL stays spend / ledger leads)',c('portal').cpl.value===600000/25);
 check('RM-P7 the qualified-lead cost is empty with a fixed note (no human qualification record yet)',same(r.cost.qualified,{value:null,note:rep.QUALIFIED_NOTE}));
}

// ════ RM-T speed-to-lead ════
{
 const at=(d,h,m=0)=>`2026-09-${d}T${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:00+09:00`;
 const manual=[10,20,30,40,50,60].map(min=>lead(at(22,9),{firstContactAt:at(22,9+Math.floor(min/60),min%60)}));
 const unc=many(3,()=>lead(at(23,9)));
 const negative=lead(at(24,12),{firstContactAt:at(24,11)});
 const future=lead(at(24,12),{firstContactAt:'2026-09-28T02:00:00Z'});
 const imported=[5,15].map(min=>lead('2026-09-01T00:00:00Z',{createdAt:'2026-09-26T00:00:00Z',receivedAt:at(25,10),receivedPrecision:'time',importId:'ri-4',imports:[{importId:'ri-4',channel:'portal',eventId:null,merged:false}],firstContactAt:at(25,10,min)}));
 const dayOnly=lead('2026-09-01T00:00:00Z',{createdAt:'2026-09-26T00:00:00Z',receivedAt:'2026-09-25T00:00:00+09:00',receivedPrecision:'day',importId:'ri-5',imports:[{importId:'ri-5',channel:'portal',eventId:null,merged:false}],firstContactAt:at(25,12)});
 const r=build({leads:[...manual,...unc,negative,future,...imported,dayOnly]});
 const g=b=>r.speedToLead.groups.find(x=>x.basis===b);
 check('RM-T1 manual leads use the server receipt time and give the median of first contact minus receipt',g('server').contacted.n===6&&g('server').medianMinutes===35&&g('server').medianState==='shown');
 check('RM-T1 leads never contacted by asOf count as unanswered (a contact after asOf is not yet a contact)',g('server').uncontacted.n===null&&g('server').uncontacted.suppressed&&g('server').received.n===11);
 check('RM-T2 a first contact before the receipt is excluded and counted',g('server').excludedNegative===1);
 check('RM-T3 imported leads are a separate group on the provider time and day-only receipts are excluded',g('provider').label==='제공처 시각'&&g('provider').received.n===null&&g('provider').medianMinutes===null&&g('provider').medianState==='suppressed'&&same(r.speedToLead.excludedDayPrecision,{n:null,suppressed:true}));
 check('RM-T4 the contacted rate follows the twenty rule',g('server').contactedRate.state==='small_sample');
 check('RM-T5 the one-hour figure is labeled a US reference',r.speedToLead.referenceNote===rep.STL_REFERENCE_NOTE&&/미국 참고치/.test(rep.STL_REFERENCE_NOTE));
 const odd=build({leads:[10,20,40,80,160].map(m=>lead('2026-09-22T00:00:00Z',{firstContactAt:new Date(Date.parse('2026-09-22T00:00:00Z')+m*60000).toISOString()}))});
 check('RM-T6 an odd-sized group takes the middle value',odd.speedToLead.groups.find(x=>x.basis==='server').medianMinutes===40);
}

// ════ RM-K 문의 월 코호트·계약당 비용 ════
{
 const june=[
  ...many(12,()=>lead('2026-06-10T10:00:00+09:00')),
  ...many(5,()=>lead('2026-06-11T10:00:00+09:00',{stage:'consulted',firstContactAt:'2026-06-11T11:00:00+09:00'})),
  ...many(2,()=>lead('2026-06-12T10:00:00+09:00',{stage:'contracted',contractedAt:'2026-07-20T10:00:00+09:00'})),
  ...many(3,()=>lead('2026-06-13T10:00:00+09:00',{stage:'closed',closedFrom:'briefing'})),
  lead('2026-06-30T15:30:00Z'), // KST 07-01 → 7월 코호트
 ];
 const spend=[spendRow('rs-j1','portal','2026-06-01','2026-06-30',1000000),spendRow('rs-j2','search_ad','2026-06-15','2026-06-15',200000),spendRow('rs-a1','portal','2026-08-15','2026-09-14',400000)];
 const r=build({leads:june,spend});
 const k=m=>r.cohorts.find(c=>c.month===m);
 check('RM-K1 six month cohorts end with the month of the report week, oldest first',same(r.cohorts.map(c=>c.month),['2026-04','2026-05','2026-06','2026-07','2026-08','2026-09']));
 check('RM-K1 the cohort month is the KST month of the receipt',k('2026-06').size.n===22&&same(k('2026-07').size,{n:null,suppressed:true}));
 const st=(m,s)=>k(m).stages.find(x=>x.stage===s);
 check('RM-K2 reached counts a stage and every stage after it, and a closed lead reached the stage it closed from',st('2026-06','contacted').reached.n===10&&st('2026-06','consulted').reached.n===10&&st('2026-06','briefing').reached.n===5&&same(st('2026-06','disclosed').reached,{n:null,suppressed:true}));
 check('RM-K2 stage rates are shown with twenty or more in the cohort',same(st('2026-06','contacted').rate,{value:Math.round(10/22*1e4)/1e4,state:'shown'})&&st('2026-06','disclosed').rate.state==='suppressed');
 check('RM-K2 closed leads are counted',same(k('2026-06').closed,{n:null,suppressed:true}));
 check('RM-K3 maturity is receipt month end + 90 days on or before the asOf KST date',k('2026-06').mature===true&&k('2026-07').mature===false&&k('2026-05').mature===true);
 check('RM-K4 cost per contract under twenty contracts is not divided (small sample) but the spend total is kept',k('2026-06').spend===1200000&&k('2026-06').spendState==='known'&&same(k('2026-06').costPerContract,{value:null,state:'small_sample'})&&same(k('2026-06').contracts,{n:null,suppressed:true}));
 check('RM-K4 a month with a spend row straddling it has no cost per contract',k('2026-08').spendState==='straddling'&&k('2026-08').costPerContract.state==='straddling'&&k('2026-09').spendState==='straddling');
 check('RM-K4 a month with no spend row is no_spend and a month without contracts is no_contracts when spend is known',k('2026-04').spendState==='no_spend'&&k('2026-04').costPerContract.state==='no_spend');
 const late=build({leads:[...many(5,()=>lead('2026-09-01T00:00:00Z',{createdAt:'2026-09-22T00:00:00Z',receivedAt:'2026-08-31T23:00:00+09:00',receivedPrecision:'time',importId:'ri-6',imports:[{importId:'ri-6',channel:'portal',eventId:null,merged:false}]}))]});
 check('RM-K1 an imported lead belongs to the month and week of the provider receipt, not of the import',late.cohorts.find(c=>c.month==='2026-08').size.n===5&&late.cohorts.find(c=>c.month==='2026-09').size.n===0&&late.inflow.total.n===0);
 const twenty=build({leads:many(20,()=>lead('2026-05-10T10:00:00+09:00',{stage:'opened',contractedAt:'2026-06-10T10:00:00+09:00'})),spend:[spendRow('rs-m','portal','2026-05-01','2026-05-31',2000000)]});
 check('RM-K5 with twenty contracts the cost per contract is spend / contracts',same(twenty.cohorts.find(c=>c.month==='2026-05').costPerContract,{value:100000,state:'shown'})&&twenty.cohorts.find(c=>c.month==='2026-05').contracts.n===20);
 const none=build({leads:many(6,()=>lead('2026-05-10T10:00:00+09:00')),spend:[spendRow('rs-n','portal','2026-05-01','2026-05-31',1)]});
 check('RM-K5 known spend and no contract is no_contracts',same(none.cohorts.find(c=>c.month==='2026-05').costPerContract,{value:null,state:'no_contracts'}));
}

// ════ RM-G 법정 게이트 ════
{
 const leads=[...many(5,()=>lead('2026-08-01T10:00:00+09:00',{stage:'contracted',contractedAt:inWeek('23')})),lead('2026-08-01T10:00:00+09:00',{stage:'opened',contractedAt:'2026-09-01T10:00:00+09:00'})];
 const ev=leads.map((l,i)=>({leadId:l.id,complete:i!==0}));
 const r=build({leads,blockedAttempts:[{at:inWeek('22')},{at:inWeek('27','23')},{at:'2026-09-20T10:00:00+09:00'},{at:'2026-09-28T09:00:00+09:00'}],contractEvidence:[...ev,{leadId:'unknown-lead',complete:true}]});
 check('RM-G1 contracts recorded in the week are counted on the KST date',r.gates.contractsInWeek.n===5);
 check('RM-G1 server-rejected attempts are counted only inside the week (they are attempts, not people)',r.gates.blockedAttempts===2);
 check('RM-G2 evidence completeness counts contracted leads of this brand only',r.gates.contracted.n===6&&r.gates.evidenceComplete.n===5);
}

// ════ RM-F 규칙 신선도 ════
{
 const rule=fr.FRANCHISE_RULES.find(x=>x.status==='in_force');
 const stale={...rule,id:'syn.stale',verifiedAt:'2026-04-01T09:59:59+09:00'},fresh={...rule,id:'syn.fresh',verifiedAt:'2026-04-01T10:00:00+09:00'},prop={...rule,id:'syn.proposed',status:'proposed',verifiedAt:'2020-01-01T00:00:00+09:00'};
 const r=build({rules:[stale,fresh,prop]});
 check('RM-F1 non-proposed rules verified more than 180 days before asOf are counted with their ids',r.rules.checked===2&&r.rules.stale===1&&same(r.rules.staleIds,['syn.stale']));
 check('RM-F1 the default registry is used when no rules are passed',build({}).rules.checked===fr.FRANCHISE_RULES.filter(x=>x.status!=='proposed').length);
}

// ════ RM-D 결정론·다이제스트 ════
{
 const leads=[...many(6,()=>lead(inWeek('22'),{codes:[tok('RAAAAAAA',inWeek('22'))]})),lead(inWeek('23'))];
 const spend=[spendRow('rs-1','portal','2026-09-21','2026-09-27',500000),spendRow('rs-2','search_ad','2026-09-21','2026-09-27',1)];
 const a=build({leads,spend}),b=build({leads:[...leads].reverse(),spend:[...spend].reverse()});
 check('RM-D1 the same input in another order gives the same report bytes',JSON.stringify(a)===JSON.stringify(b)&&rep.reportMarkdown(a)===rep.reportMarkdown(b)&&rep.reportCsv(a)===rep.reportCsv(b));
 const later=build({leads,spend,asOf:'2026-09-28T02:00:00Z'});
 check('RM-D2 the digest source leaves asOf out so a later rebuild of unchanged data matches',rep.reportDigestSource(a)===rep.reportDigestSource(later)&&!Object.hasOwn(JSON.parse(rep.reportDigestSource(a)),'asOf'));
 const changed=build({leads:[...leads,lead(inWeek('24'))],spend});
 check('RM-D2 any changed number changes the digest source',rep.reportDigestSource(a)!==rep.reportDigestSource(changed));
 check('RM-D3 the report carries schema, versions and the brand id',a.schema==='collective.recruitment-report.v1'&&a.version===rep.REPORT_VERSION&&/^fr-report@\d{4}-\d{2}-\d{2}\.\d+$/.test(rep.REPORT_VERSION)&&a.recruitmentVersion===rc.RECRUITMENT_VERSION&&a.brandId===BRAND);
 check('RM-D4 bad leads and spend rows are skipped, not thrown',!throwsRange(()=>build({leads:[null,{},{id:1},...leads],spend:[null,{id:'x'},...spend]}))&&build({leads:[null,{},...leads]}).inflow.total.n===7);
}

// ════ RM-X 값 누출 없음 ════
{
 const leads=[...many(6,()=>lead(inWeek('22'),{codes:[tok('RAAAAAAA',inWeek('22'))],systemCode:'L'+MARK,memo:MARK,contact:{name:MARK}})),lead(inWeek('23'),{codes:[tok('RQQQQQQQ',inWeek('23'))]})];
 const r=build({leads,spend:[spendRow('rs-'+MARK,'portal','2026-09-21','2026-09-27',1)]});
 const all=JSON.stringify(r)+rep.reportMarkdown(r)+rep.reportCsv(r);
 check('RM-X1 no lead id, system code, contact, memo, spend id or recruitment code appears in the report, Markdown or CSV',!all.includes(MARK)&&!/R[A-Z0-9]{7}/.test(all.replace(/fr-[a-z-]+@[\d.-]+/g,'')));
}

// ════ RM-N 고정 문구 ════
{
 const r=build({});
 check('RM-N1 notes open with attribution is not increment and include the platform, proration, sample, suppression and no-model notes',r.notes[0]===rc.RECRUITMENT_ATTRIBUTION_NOTE&&r.notes.some(n=>n.startsWith(rc.PLATFORM_REPORTED_NOTE))&&r.notes.includes(rc.NO_PRORATION_NOTE)&&r.notes.some(n=>/20/.test(n)&&/비율/.test(n))&&r.notes.some(n=>/5건 미만/.test(n))&&r.notes.some(n=>/모델/.test(n)&&/0/.test(n)));
 check('RM-N1 the disclaimer is the gate disclaimer',r.disclaimer===DISCLAIMER);
 check('RM-N2 the report has no revenue forecast, payback or per-applicant profit field',!/revenue|profit|payback|forecast|수익|회수/.test(JSON.stringify(Object.keys(r)))&&!/expectedRevenue|payback/.test(SRC));
}

// ════ RM-O Markdown·CSV ════
{
 const r=build({leads:many(6,()=>lead(inWeek('22'),{codes:[tok('RAAAAAAA',inWeek('22'))]})),spend:[spendRow('rs-1','portal','2026-09-21','2026-09-27',1234567)]});
 const md=rep.reportMarkdown(r),csv=rep.reportCsv(r);
 const firstNumber=md.search(/\|\s*\d/);
 check('RM-O1 Markdown puts attribution≠increment and the disclaimer before the first number',md.indexOf('귀속≠증분')>-1&&md.indexOf('귀속≠증분')<firstNumber&&md.indexOf(DISCLAIMER)>-1&&md.indexOf(DISCLAIMER)<firstNumber);
 const small=rep.reportMarkdown(build({leads:[lead(inWeek('22'),{codes:[tok('RAAAAAAA',inWeek('22'))]})]}));
 check('RM-O1 Markdown writes suppressed cells as "5건 미만" and small samples as "표본 부족" in the table',/\| 유입 \| 전체 \| 리드 \| 5건 미만 \|/.test(small)&&/\| 표본 부족\(n<20\) \|/.test(md));
 check('RM-O1 won amounts use thousands separators without locale dependency',md.includes('1,234,567원'));
 check('RM-O2 CSV starts with a BOM, quotes every cell and carries the disclaimer row',csv.startsWith('﻿"')&&csv.includes(DISCLAIMER)&&csv.split('\r\n').every(line=>/^﻿?"/.test(line)));
 check('RM-O3 the file name is ascii, brand-safe and week-stamped',rep.reportFileName({...r,brandId:'a b/../c'},'md')==='recruitment-report-a_b____c-2026-W39.md'&&rep.reportFileName(r,'csv').endsWith('.csv'));
}

const IDS=['RM-S1','RM-W1','RM-W2','RM-C1','RM-R1','RM-I1','RM-I2','RM-I3','RM-I4','RM-I5','RM-P1','RM-P2','RM-P3','RM-P4','RM-P5','RM-P6','RM-P7','RM-T1','RM-T2','RM-T3','RM-T4','RM-T5','RM-T6','RM-K1','RM-K2','RM-K3','RM-K4','RM-K5','RM-G1','RM-G2','RM-F1','RM-D1','RM-D2','RM-D3','RM-D4','RM-X1','RM-N1','RM-N2','RM-O1','RM-O2','RM-O3'];
const missing=IDS.filter(id=>!passed.some(n=>n.startsWith(id+' ')));
assert.deepEqual(missing,[],'이름에 없는 사례 번호: '+missing.join(', '));passed.push(`every R6a case id (${IDS.length}) has a named check`);
check('no external call was made',fetchCalls===0);
console.log(JSON.stringify({passed:passed.length}));
