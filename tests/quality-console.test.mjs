// B2 품질 콘솔 순수 집계(lib/quality-console.ts) 회귀. 합성 레코드만 쓰고 LLM·네트워크 호출은 0이다(mocked: fetch 스텁, 메모리 SQLite).
// 1차 승인율은 실제 SQLite에 넣은 판정으로 B1 firstPassApprovalRates와 같은 숫자인지 교차 검증한다.
// 역할×스킬 버전×보고 모델 행, 폐기 토큰 조인(artifactId·jobId·jobs provider_id)과 미연결, 표본 부족, 회의 완주율, 채점·규제 보류, KST 주 경계, 입력 불변, 출력에 원문·이메일·계정 id 없음을 확인한다.
import assert from 'node:assert/strict';
import {testRuntime} from './helpers/runtime.mjs';

let fetchCalls=0;
const rt=testRuntime(async()=>{fetchCalls++;throw new Error('외부 호출 금지')});
const qc=await rt.load('lib/quality-console.ts'),store=await rt.load('lib/review-decisions-server.ts');
const plain=v=>JSON.parse(JSON.stringify(v));
let passed=0;
const check=(name,ok)=>{assert.ok(ok,name);passed++};
const eq=(name,actual,expected)=>{assert.deepEqual(plain(actual),expected,name);passed++};
const near=(a,b)=>typeof a==='number'&&Math.abs(a-b)<1e-12;
const deepFreeze=v=>{if(v&&typeof v==='object'&&!Object.isFrozen(v)){Object.freeze(v);Object.values(v).forEach(deepFreeze)}return v};

// W39 = 2026-09-21~27 KST(2026-09-20T15:00Z 이상 2026-09-27T15:00Z 미만). 날짜 경계는 python datetime.isocalendar로 확인한 값이다.
const t=(day,hh='03')=>`2026-09-${String(day).padStart(2,'0')}T${hh}:00:00.000Z`;
const O='workspace',SECRET='고객 메모 원문 비밀 owner@example.com';
const art=(id,extra={})=>({id,campaignId:'c1',campaignVersion:1,role:'cmo',title:'전략 '+id,content:`## 목표\n평일 방문을 늘리는 실행 초안입니다. ${SECRET}`,status:'approved',version:1,origin:'ai',createdAt:t(22),skillVersion:'sv1',...extra});
let seq=0;
const dec=(targetId,decision,extra={})=>({id:'d'+String(++seq).padStart(2,'0'),targetKind:'artifact',targetId,version:1,role:'cmo',decision,reasonCodes:[],actor:{id:'actor-secret-1',role:'owner'},promptVersion:'sv1:abc123abc123',skillVersion:'sv1',outputContractVersion:'role-output-v1',campaignId:'c1',brandId:null,origin:'ai',reasonsVersion:'review-reasons-v1',createdAt:t(22),...extra});
const ledger=(id,extra={})=>({id:'hermes:'+id,provider:'hermes',providerRunId:id,model:'hermes-agent',inputTokens:null,outputTokens:null,totalTokens:1000,status:'completed',terminalReason:'completed',observedAt:t(22),domainOutcome:'completed',kind:'role',role:'cmo',promptVersion:'sv1:abc123abc123',...extra});
const reask='현재 메시지에는 수행할 작업이 명시되지 않았습니다. 원하시는 작업을 선택해 주세요. 1. 시장 조사 2. 전략 수립';

const artifacts=[
 ...['a1','a2','a4'].map(id=>art(id)),
 art('a3',{complianceHold:{version:'v1',block:1,issues:[],checkedAt:t(23),notice:'법률 자문 아님'}}),
 art('a5',{origin:'ai_edited',version:2,skillVersion:undefined,aiSource:{id:'a5',version:1,skillVersion:'sv1',outputContractVersion:null}}),
 art('a6',{origin:'ai_edited',version:2,skillVersion:undefined,aiSource:{id:'a6',version:1,skillVersion:'sv1',outputContractVersion:null}}),
 art('a7',{status:'revision'}),
 art('a8',{createdAt:t(7)}),
 art('q1',{status:'review',content:reask}),
 art('o1',{status:'outdated'}),
 art('o2',{status:'outdated'}),
 art('c1',{role:'content'}),art('c2',{role:'content'}),
 art('m1',{origin:'manual',skillVersion:undefined}),
 art('mt1',{role:'strategy',meetingId:'mt1',version:2,complianceHold:{version:'v1',block:2,issues:[],checkedAt:t(24),notice:'법률 자문 아님'}}),
 art('p1',{createdAt:t(15)}),
].filter((a,i,all)=>all.findIndex(x=>x.id===a.id)===i);
const decisions=[
 dec('a8','approved',{createdAt:t(8)}),
 dec('p1','approved',{createdAt:t(15)}),
 ...['a1','a2','a3','a4'].map(id=>dec(id,'approved')),
 dec('a5','revision',{reasonCodes:['evidence']}),
 dec('a5','approved',{version:2,origin:'ai_edited'}),
 dec('a6','approved',{version:2,origin:'ai_edited'}),
 dec('a7','revision',{reasonCodes:['evidence','fact_error']}),
 dec('a8','revision',{reasonCodes:['brand']}),
 dec('c1','approved',{role:'content'}),dec('c2','approved',{role:'content'}),
 dec('m1','approved',{origin:'manual',promptVersion:null,skillVersion:null,outputContractVersion:null}),
 dec('brief-1','edited',{targetKind:'brief_suggestion',role:null,section:'kpi',reasonCodes:['economics'],origin:undefined,skillVersion:null}),
 dec('src-1','excluded',{targetKind:'source',role:null,reasonCodes:['brand'],campaignId:null,brandId:'oda',origin:undefined,skillVersion:null}),
 dec('pub-1','cancelled',{targetKind:'publication',role:null,reasonCodes:['compliance'],origin:undefined,skillVersion:null}),
];
const usage=[
 ...['a1','a3','a5','a6','a7'].map(id=>ledger('run-'+id,{jobId:'j-'+id,artifactId:id})),
 ledger('run-a2',{jobId:'j-a2',artifactId:'a2',totalTokens:null,inputTokens:600,outputTokens:400}),
 ledger('run-a4',{jobId:'j-a4',artifactId:'a4',totalTokens:null}),
 ledger('run-a8',{jobId:'j-a8',artifactId:'a8',observedAt:t(7)}),
 ledger('run-p1',{jobId:'j-p1',artifactId:'p1',observedAt:t(15)}),
 ledger('run-q1',{jobId:'j-q1',artifactId:'q1',totalTokens:500}),
 ledger('run-o1',{jobId:'j-o1',artifactId:'o1',totalTokens:700}),
 ledger('run-invalid',{jobId:'j-invalid',totalTokens:300,domainOutcome:'invalid_output'}),
 ledger('run-missing',{jobId:'j-missing',artifactId:'ai-missing',totalTokens:400}),
 ledger('run-failed',{jobId:'j-failed',totalTokens:100,domainOutcome:'provider_failed'}),
 ...['c1','c2'].map(id=>ledger('resp-'+id,{provider:'openai',model:'gpt-x',jobId:'j-'+id,artifactId:id,role:'content',totalTokens:800})),
 ledger('run-mt-1',{kind:'meeting',jobId:O+':meeting:mt1',role:'strategy',promptVersion:'sv1:def456def456',totalTokens:900}),
 ledger('run-mt-2',{kind:'meeting',jobId:O+':meeting:mt1',role:'strategy',promptVersion:'sv1:def456def456',totalTokens:200,domainOutcome:'invalid_output'}),
 ledger('run-mt-3',{kind:'meeting',jobId:O+':meeting:gone',role:'strategy',promptVersion:'sv1:def456def456',totalTokens:150}),
 // F2a 이전 행: 조인 키가 없다. run-o2는 jobs.provider_id → 채점 기록의 jobId → 작업물 o2로 이어지고, run-old2는 역할만, run-old는 아무것도 잇지 못한다.
 {...ledger('run-o2',{totalTokens:600}),kind:undefined,role:undefined,promptVersion:undefined},
 {...ledger('run-old2',{totalTokens:350,domainOutcome:null}),kind:undefined,role:undefined,promptVersion:undefined},
 {...ledger('run-old',{totalTokens:250}),kind:undefined,role:undefined,promptVersion:undefined},
 ledger('run-brief',{kind:'brief',jobId:'brief-1',role:null,promptVersion:'inline:0123456789ab',totalTokens:5000}),
];
const graded=(artifactId,status,graders=[],extra={})=>({id:artifactId+':1',artifactId,artifactVersion:1,campaignId:'c1',campaignVersion:1,role:'cmo',source:'role',jobId:'j-'+artifactId,meetingId:null,status,gradersVersion:'g1',graders,summary:null,compliance:null,context:{},durationMs:1,gradedAt:t(22),...extra});
const gradings=[
 graded('a1','graded',[{id:'fact_conflict',status:'fail',detail:SECRET},{id:'thin_section',status:'pass'}]),
 graded('a2','grader_error',[],{error:SECRET}),
 graded('o2','not_run',[],{jobId:'job-o2',reason:'too_many_lines',lines:2400}),
 graded('p1','graded',[{id:'thin_section',status:'fail'}],{gradedAt:t(15)}),
];
const meeting=(id,status,createdAt=t(22))=>({id,campaignId:'c1',campaignVersion:1,agenda:SECRET,status,steps:[],createdAt,updatedAt:createdAt,model:'hermes-agent',stopRequested:false,artifactIds:[],invalidatedRoles:[],snapshot:{}});
const meetings=[meeting('mt1','completed'),meeting('m2','failed'),meeting('m3','cancelled'),meeting('m4','running'),meeting('m5','completed'),meeting('m6','completed'),meeting('m-old','completed',t(15))];
const jobs=[{id:'job-o2',role:'cmo',provider_id:'run-o2'},{id:'job-old2',role:'cmo',provider_id:'run-old2'}];
const input=deepFreeze({artifacts,decisions,usage,meetings,gradings,jobs});
const before=JSON.stringify(input);

// 1) 주 경계(KST, ISO 주)와 기간
check('Monday 00:00 KST starts ISO week 39',qc.isoWeekOf('2026-09-20T15:00:00.000Z')==='2026-W39');
check('Sunday 23:59 KST is still week 38',qc.isoWeekOf('2026-09-20T14:59:59.999Z')==='2026-W38');
check('2027-01-01 belongs to 2026-W53',qc.isoWeekOf('2027-01-01T00:00:00.000Z')==='2026-W53');
check('2021-01-01 belongs to 2020-W53',qc.isoWeekOf('2021-01-01T00:00:00.000Z')==='2020-W53');
eq('week 39 range is Monday to Monday in KST',qc.weekRange('2026-W39'),{from:'2026-09-20T15:00:00.000Z',to:'2026-09-27T15:00:00.000Z'});
eq('week 1 of 2026 starts on 2025-12-29 KST',qc.weekRange('2026-W01'),{from:'2025-12-28T15:00:00.000Z',to:'2026-01-04T15:00:00.000Z'});
check('invalid weeks are null',['2025-W53','2026-W00','2026-W54','2026-39','0000-W01',''].every(w=>qc.weekRange(w)===null));
check('previous week crosses the year',qc.previousWeek('2026-W01')==='2025-W52'&&qc.previousWeek('2026-W39')==='2026-W38'&&qc.previousWeek('bad')===null);
check('KST date of an instant',qc.kstDate('2026-09-20T15:00:00.000Z')==='2026-09-21');
const W39=qc.consoleSummary(input,{from:'2026-09-21',to:'2026-09-27'});
check('KST dates are inclusive and become UTC instants',W39.from==='2026-09-20T15:00:00.000Z'&&W39.to==='2026-09-27T15:00:00.000Z');
check('ISO instants are used as given',qc.consoleSummary(input,qc.weekRange('2026-W39')).to==='2026-09-27T15:00:00.000Z');
for(const bad of [{from:'2026-09-27',to:'2026-09-21'},{from:'nope',to:'2026-09-21'},{from:'2026-02-30',to:'2026-03-01'}])check(`bad period ${bad.from}..${bad.to} throws`,(()=>{try{qc.consoleSummary(input,bad);return false}catch(e){return /기간/.test(e.message)}})());

// 2) 행: 역할×스킬 버전×보고 모델
const row=(role,skillVersion,model)=>W39.rows.find(r=>r.role===role&&r.skillVersion===skillVersion&&r.reportedModel===model);
eq('rows are ordered by role order and include only AI work',plain(W39.rows).map(r=>[r.role,r.skillVersion,r.reportedModel]),[['cmo','sv1','hermes-agent'],['cmo',null,'hermes-agent'],['strategy','sv1','hermes-agent'],['content','sv1','gpt-x']]);
const R1=row('cmo','sv1','hermes-agent');
check('artifact count is AI artifacts created in the period (edited ones via their AI source version)',R1.artifacts===10);
check('first-pass sample and counts follow B1 (a1-a4 approved, a6 edited first, a5 and a7 revised)',R1.n===7&&R1.approvedFirst===4&&R1.editedFirst===1&&near(R1.firstPassRate,4/7));
check('revision decisions in the period count by decision time (a8 was first judged before the period)',R1.revisions===3);
eq('reason codes of AI artifact decisions',Object.fromEntries(Object.entries(plain(R1.reasons)).filter(([,n])=>n)),{evidence:2,brand:1,fact_error:1});
eq('discarded tokens by reason (revision a5·a7, question-only q1, outdated o1 and o2 via jobs, invalid output)',plain(R1.discarded),{invalid_output:300,question_only:500,revision:2000,outdated:1300});
check('discarded total is the sum of reasons',R1.discardedTokens===4100);
check('usage whose artifact join fails is unlinked, failed runs are not',R1.unlinkedTokens===400);
check('tokens fall back to input+output and unknown totals are counted, not zeroed silently',R1.unknownTokenRuns===1);
eq('gradings: graded, grader_error, not_run and failed graders (fail or grader_error results)',plain(R1.gradings),{graded:1,grader_error:1,not_run:1,failedGraders:1});
check('compliance holds checked in the period',R1.holds===1);
eq('prompt versions seen in the row',plain(R1.promptVersions),['sv1:abc123abc123']);
const R2=row('cmo',null,'hermes-agent');
check('a pre-F2a run matched only to a role job is its own unlinked row',R2&&R2.unlinkedTokens===350&&R2.artifacts===0&&R2.n===0&&R2.firstPassRate===null);
const R3=row('content','sv1','gpt-x');
check('a group under five is insufficient: rate null but n shown',R3.n===2&&R3.approvedFirst===2&&R3.firstPassRate===null&&R3.discardedTokens===0);
const R4=row('strategy','sv1','hermes-agent');
check('meeting artifacts take the model reported in their meeting',R4.artifacts===1&&R4.holds===1);
check('meeting usage: invalid output is discarded, a missing meeting is unlinked, the rest is kept',R4.discarded.invalid_output===200&&R4.discardedTokens===200&&R4.unlinkedTokens===150);
check('manual artifacts and their decisions are not in any row',!W39.rows.some(r=>r.skillVersion===null&&r.reportedModel===null));

// 3) 합계·사유 분포·회의·채점
const T=W39.totals;
check('totals add rows plus usage that has no role',T.artifacts===13&&T.n===9&&T.approvedFirst===6&&near(T.firstPassRate,6/9));
check('total discarded and unlinked tokens',T.discardedTokens===4300&&T.discarded.invalid_output===500&&T.unlinkedTokens===400+350+150+250);
check('brief, research and learning usage is outside the role rows',T.otherKindTokens===5000);
check('total holds and grading counts',T.holds===2&&T.gradings.graded===1&&T.gradings.failedGraders===1);
eq('first-pass table is B1 firstPassApproval for first decisions in the period',plain(W39.firstPass),[{role:'cmo',skillVersion:'sv1',n:7,approvedFirst:4,editedFirst:1,rate:4/7},{role:'content',skillVersion:'sv1',n:2,approvedFirst:2,editedFirst:0,rate:null}]);
const reasons=Object.fromEntries(plain(W39.reasons).map(r=>[r.code,r]));
check('reason distribution covers all ten B1 codes in order',plain(W39.reasons).map(r=>r.code).join()==='evidence,brand,execution,economics,measurement,compliance,voice,fact_error,question_only,format');
check('reason counts per target kind',reasons.evidence.artifact===2&&reasons.brand.artifact===1&&reasons.brand.source===1&&reasons.brand.total===2&&reasons.economics.brief_suggestion===1&&reasons.compliance.publication===1&&reasons.format.total===0);
check('reason labels come from B1',reasons.evidence.label==='근거'&&reasons.fact_error.label==='사실 오류');
eq('decision counts per target kind (manual artifacts included here)',plain(W39.decisions),{artifact:12,brief_suggestion:1,source:1,publication:1});
eq('failed graders by id',plain(W39.failedGraders),[{id:'fact_conflict',count:1}]);
eq('meeting completion: started, completed, failed, cancelled, in progress',plain(W39.meetings),{started:6,completed:3,failed:1,cancelled:1,inProgress:1,rate:0.5});
check('the minimum sample is reported',W39.minSample===5&&qc.MIN_SAMPLE===5);

// 4) 주간 추이
const two=qc.consoleSummary(input,{from:'2026-09-14',to:'2026-09-27'});
eq('weeks cover the period in order',plain(two.weeks).map(w=>[w.week,w.from,w.to]),[['2026-W38','2026-09-13T15:00:00.000Z','2026-09-20T15:00:00.000Z'],['2026-W39','2026-09-20T15:00:00.000Z','2026-09-27T15:00:00.000Z']]);
const [w38,w39]=two.weeks;
check('weekly totals add up to the period totals',w38.artifacts+w39.artifacts===two.totals.artifacts&&w38.n+w39.n===two.totals.n&&w38.discardedTokens+w39.discardedTokens===two.totals.discardedTokens);
check('a week under five first decisions is insufficient',w38.n===1&&w38.firstPassRate===null&&w38.gradings.failedGraders===1);
check('weekly meeting completion',w38.meetings.started===1&&w38.meetings.rate===null&&w39.meetings.started===6);
const partial=qc.consoleSummary(input,{from:'2026-09-23',to:'2026-09-24'});
check('a partial week is clipped to the period',partial.weeks.length===1&&partial.weeks[0].week==='2026-W39'&&partial.weeks[0].from==='2026-09-22T15:00:00.000Z'&&partial.weeks[0].to==='2026-09-24T15:00:00.000Z');

// 5) 교차 검증: 같은 판정을 실제 SQLite에 넣고 B1 firstPassApprovalRates와 비교한다(전체 기간).
for(const d of decisions)rt.sql.prepare('INSERT INTO records(id,owner,kind,parent_id,data,updated_at) VALUES(?,?,?,?,?,?)').run(`${O}:review_decision:${d.id}`,O,'review_decision','',JSON.stringify(d),d.createdAt);
const b1=plain(await store.firstPassApprovalRates(O)),all=qc.consoleSummary(input,{from:'2026-01-01',to:'2026-12-31'});
check('B1 has the same role×skill groups',b1.length===all.firstPass.length&&b1.length===2);
for(const r of b1){
 const mine=all.firstPass.find(x=>x.role===r.role&&x.skillVersion===r.skillVersion);
 check(`first-pass ${r.role}/${r.skillVersion} matches B1 counts`,mine&&mine.n===r.artifacts&&mine.approvedFirst===r.approvedFirst&&mine.editedFirst===r.editedFirst);
 check(`first-pass ${r.role}/${r.skillVersion} rate is B1's or insufficient`,mine.rate===null?r.artifacts<5:mine.rate===r.rate);
 const split=all.rows.filter(x=>x.role===r.role&&x.skillVersion===r.skillVersion);
 check(`rows split by model add up to B1 for ${r.role}/${r.skillVersion}`,split.reduce((s,x)=>s+x.n,0)===r.artifacts&&split.reduce((s,x)=>s+x.approvedFirst,0)===r.approvedFirst);
}
check('cmo/sv1 over the whole year includes the earlier first approvals (a8, p1)',all.firstPass.find(x=>x.role==='cmo').n===9&&near(all.firstPass.find(x=>x.role==='cmo').rate,6/9));

// 6) 표본 경계와 폐기 우선순위
const small=n=>({artifacts:[],usage:[],meetings:Array.from({length:n},(_,i)=>meeting('s'+i,'completed')),gradings:[],decisions:Array.from({length:n},(_,i)=>dec('s'+i,'approved'))});
const s4=qc.consoleSummary(small(4),{from:'2026-09-21',to:'2026-09-27'}),s5=qc.consoleSummary(small(5),{from:'2026-09-21',to:'2026-09-27'});
check('four first decisions: insufficient',s4.totals.n===4&&s4.totals.firstPassRate===null&&s4.firstPass[0].rate===null&&s4.meetings.rate===null);
check('five first decisions: a rate',s5.totals.n===5&&s5.totals.firstPassRate===1&&s5.firstPass[0].rate===1&&s5.meetings.rate===1);
check('an artifact without usage has an unknown model',s5.rows.length===1&&s5.rows[0].reportedModel===null);
const prio=qc.consoleSummary({artifacts:[art('x1',{status:'outdated',content:reask}),art('x2',{status:'outdated'}),art('x3')],decisions:[dec('x2','revision'),dec('x3','revision'),dec('x3','approved')],usage:['x1','x2','x3'].map(id=>ledger('run-'+id,{jobId:'j-'+id,artifactId:id})),meetings:[],gradings:[]},{from:'2026-09-21',to:'2026-09-27'});
eq('question-only beats revision beats outdated; a revision later approved at the same version is kept',plain(prio.totals.discarded),{invalid_output:0,question_only:1000,revision:1000,outdated:0});
check('empty input gives empty rows and zero totals',(()=>{const e=qc.consoleSummary({artifacts:[],decisions:[],usage:[],meetings:[],gradings:[]},{from:'2026-09-21',to:'2026-09-27'});return e.rows.length===0&&e.totals.n===0&&e.totals.firstPassRate===null&&e.meetings.started===0&&e.weeks.length===1})());

// 6-1) 서버 조회가 필요한 필드만 읽은 모양도 받는다: jobs의 camelCase providerId, checkedAt 없는 규제 보류(작성 시각으로 센다), aiSource 없는 사람 수정본(사용량 promptVersion의 스킬 버전).
const lean=qc.consoleSummary({
 artifacts:[art('e1',{origin:'ai_edited',version:2,skillVersion:null}),art('h1',{complianceHold:{block:1}}),art('g1',{status:'outdated'})],
 decisions:[dec('e1','approved',{version:2,origin:'ai_edited'})],
 usage:[ledger('run-e1',{jobId:'j-e1',artifactId:'e1'}),{...ledger('run-g1',{totalTokens:450}),kind:undefined,role:undefined,promptVersion:undefined},ledger('run-h1',{jobId:'j-h1',artifactId:'h1'})],
 meetings:[],gradings:[graded('g1','graded',[],{jobId:'job-g1'})],jobs:[{id:'job-g1',campaignId:'c1',role:'cmo',status:'completed',providerId:'run-g1',createdAt:t(22)}],
},{from:'2026-09-21',to:'2026-09-27'});
check('jobs rows with camelCase providerId link legacy usage too',lean.totals.discarded.outdated===450&&lean.totals.unlinkedTokens===0);
check('a compliance hold without checkedAt counts at the artifact creation time',lean.totals.holds===1);
check('an edited artifact without aiSource takes the skill version of its linked usage',lean.rows.length===1&&lean.rows[0].skillVersion==='sv1'&&lean.rows[0].artifacts===3&&lean.rows[0].n===1);

// 6-2) 판 단위: 회의 개선은 역할 작업물 id를 재사용해 새 판(version+1, origin ai, meetingId)을 쓴다(lib/meeting-execution.ts). 역할 실행은 항상 1판이다(lib/role-execution.ts version:1).
const W=o=>qc.consoleSummary({artifacts:[],decisions:[],usage:[],meetings:[],gradings:[],...o},{from:'2026-09-21',to:'2026-09-27'});
const meetingV2=art('r1',{version:2,meetingId:'mr',status:'revision',createdAt:t(23)});
const roleRun=ledger('run-r1',{jobId:'j-r1',artifactId:'r1',model:'model-role'}),meetRun=ledger('run-mr',{kind:'meeting',jobId:O+':meeting:mr',role:'cmo',model:'model-meet',promptVersion:'sv1:def456def456',totalTokens:200});
const kept=W({artifacts:[meetingV2],decisions:[dec('r1','approved'),dec('r1','revision',{version:2,createdAt:t(23)})],usage:[roleRun,meetRun],meetings:[meeting('mr','completed')]});
check('a revision on the meeting version does not discard the approved role run (v1) tokens',kept.totals.discarded.revision===0&&kept.totals.discardedTokens===0);
const dropped=W({artifacts:[meetingV2],decisions:[dec('r1','revision'),dec('r1','revision',{version:2,createdAt:t(23)})],usage:[roleRun,meetRun],meetings:[meeting('mr','completed')]});
check('a revision on the role run version (v1) discards the role run tokens',dropped.totals.discarded.revision===1000);
const reaskMeeting=W({artifacts:[art('r1',{version:2,meetingId:'mr',status:'review',content:reask})],usage:[roleRun],meetings:[meeting('mr','completed')]});
check('question-only content of the meeting version does not discard the role run tokens',reaskMeeting.totals.discarded.question_only===0);
const modelRow=(s,model)=>s.rows.find(r=>r.reportedModel===model);
check('the meeting version and the decision on it go to the meeting model row',modelRow(kept,'model-meet')?.artifacts===1&&modelRow(kept,'model-meet').revisions===1&&modelRow(kept,'model-meet').n===0);
check('the first decision on the role run version stays in the role model row',modelRow(kept,'model-role')?.n===1&&modelRow(kept,'model-role').approvedFirst===1&&modelRow(kept,'model-role').artifacts===0);

// 6-3) 프롬프트 레지스트리(F3a) promptVersion 'role.<역할>@<sha12>+channel.<채널>@<sha12>'은 행을 나눈다. 코드 상수 실행('<스킬>:<해시>')은 스킬 버전으로 묶는다.
const RA='role.cmo@aaaaaaaaaaaa+channel.search@cccccccccccc',RB='role.cmo@bbbbbbbbbbbb+channel.search@cccccccccccc',RS='role.strategy@dddddddddddd+channel.search@cccccccccccc';
const reg=W({
 artifacts:[art('g1',{promptVersion:RA}),art('g2',{promptVersion:RB,status:'revision'}),art('gm',{role:'strategy',meetingId:'mg',promptVersion:RS})],
 decisions:[dec('g1','approved',{promptVersion:RA}),dec('g2','revision',{promptVersion:RB}),dec('gm','approved',{role:'strategy',promptVersion:null})],
 usage:[ledger('run-g1',{jobId:'j-g1',artifactId:'g1',model:'gpt-x',promptVersion:RA}),ledger('run-g2',{jobId:'j-g2',artifactId:'g2',model:'gpt-x',promptVersion:RB}),
  ledger('run-g3',{jobId:'j-g3',model:'gpt-x',promptVersion:RA,domainOutcome:'invalid_output',totalTokens:300}),
  ledger('run-gm',{kind:'meeting',jobId:O+':meeting:mg',role:'strategy',model:'gpt-x',promptVersion:RS,totalTokens:400})],
 meetings:[meeting('mg','completed')],
});
const regRow=p=>reg.rows.find(r=>r.promptVersion===p);
eq('registry prompt versions split rows (role × prompt version × model)',plain(reg.rows).map(r=>[r.role,r.skillVersion,r.promptVersion,r.reportedModel]),[['cmo',null,RA,'gpt-x'],['cmo',null,RB,'gpt-x'],['strategy',null,RS,'gpt-x']]);
check('first-pass counts stay with their prompt version',regRow(RA).n===1&&regRow(RA).approvedFirst===1&&regRow(RB).n===1&&regRow(RB).approvedFirst===0&&regRow(RB).revisions===1);
check('a registry run that saved no artifact (invalid output) joins its prompt version row',regRow(RA).discarded.invalid_output===300&&regRow(RB).discarded.revision===1000);
check('registry meeting usage, the meeting artifact and its decision are one row',regRow(RS).artifacts===1&&regRow(RS).n===1&&regRow(RS).approvedFirst===1&&regRow(RS).unlinkedTokens===0);
check('code-constant rows have no registry prompt version',R1.promptVersion===null&&W39.rows.every(r=>r.promptVersion===null));

// 6-4) 이전 판(kind 'history'): 사람이 고쳐 저장하면 작업물 레코드는 새 판이 되고 이전 판은 이력에만 남는다(app/api/action/route.ts save_artifact). 판마다 만든 주에 센다.
const v1=art('h1',{createdAt:t(15),complianceHold:{block:1,checkedAt:t(15)}});
const edited={artifacts:[art('h1',{version:2,origin:'ai_edited',skillVersion:undefined,aiSource:{id:'h1',version:1,skillVersion:'sv1'},createdAt:t(22)})],history:[{...v1,id:'hist-1',originalId:'h1'}],usage:[ledger('run-h1',{jobId:'j-h1',artifactId:'h1',observedAt:t(15)})]};
const wk=(o,from,to)=>qc.consoleSummary({decisions:[],meetings:[],gradings:[],...o},{from,to});
const w38h=wk(edited,'2026-09-14','2026-09-20'),w39h=wk(edited,'2026-09-21','2026-09-27');
check('an earlier version kept in history still counts in its own week (hold and AI artifact)',w38h.totals.holds===1&&w38h.totals.artifacts===1&&w38h.rows.length===1&&w38h.rows[0].reportedModel==='hermes-agent'&&w38h.rows[0].skillVersion==='sv1');
check('the edited version counts in its own week without the earlier hold',w39h.totals.holds===0&&w39h.totals.artifacts===1);
check('a version copied twice into history and an outdated record of the same version count once',[{...edited,history:[...edited.history,{...v1,id:'hist-2',originalId:'h1'}]},{artifacts:[{...v1,status:'outdated'}],history:[{...v1,id:'hist-3',originalId:'h1'}],usage:edited.usage}].every(o=>{const s=wk(o,'2026-09-14','2026-09-20');return s.totals.holds===1&&s.totals.artifacts===1}));

// 6-5) 교차: 재질문 판정은 워크스페이스 숫자(lib/workspace-metrics.ts needsWorkArtifacts의 artifactUsable)와 같은 isQuestionOnly다.
const wm=await rt.load('lib/workspace-metrics.ts');
const cands=[reask,'## 목표\n평일 방문 실행안입니다.','What task would you like me to do?','원하시는 작업을 알려 주세요.','가'.repeat(2600)+' 수행할 작업이 명시되지 않았습니다'].map((content,i)=>art('w'+i,{status:'review',content}));
const needs=new Set(wm.needsWorkArtifacts(cands,[{id:'c1',version:1}]).map(a=>a.id));
for(const a of cands)check(`question-only discard of ${a.id} matches workspace needs-work`,(W({artifacts:[a],usage:[ledger('run-'+a.id,{jobId:'j-'+a.id,artifactId:a.id})]}).totals.discarded.question_only>0)===needs.has(a.id));
check('the cross check covers both outcomes',needs.size>0&&needs.size<cands.length);

// 7) 불변·원문 없음·네트워크 0
check('the input is not mutated (deep-frozen input, same JSON)',JSON.stringify(input)===before);
const text=JSON.stringify([W39,two,all]);
check('no artifact content, memo text, grader detail, agenda, email or actor id in the summary',!text.includes('비밀')&&!text.includes('@example.com')&&!text.includes('actor-secret-1')&&!text.includes('평일 방문'));
check('summary carries its version',W39.version==='quality-console-v1');
check('no external calls',fetchCalls===0);

console.log(JSON.stringify({passed}));
