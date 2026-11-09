// G3 예약 실행·일일 요약: 입력 검증, KST 요일·시각 판정, 기간별 멱등, 전역 중단·회의 시작 금지 건너뜀, 회의 안건 초안·오늘의 안건 신호, 워커 큐는 스위치가 켜졌을 때만, 요약 문장·전송 기록.
// 근거: mocked(메모리 SQLite, 로컬 인증 헤더, fetch 스텁). 외부·모델 호출은 0회다.
import assert from 'node:assert/strict';
import {testRuntime} from './helpers/runtime.mjs';

let fetchCalls=0;
const {sql,env,load}=testRuntime(async url=>{fetchCalls++;throw new Error('외부 호출 금지: '+url)});
const pure=await load('lib/scheduled-runs.ts'),server=await load('lib/scheduled-runs-server.ts'),digest=await load('lib/digest.ts'),digestServer=await load('lib/digest-server.ts');
const core=await load('lib/server.ts'),flags=await load('lib/feature-flags.ts'),autonomy=await load('lib/autonomy-server.ts'),stop=await load('lib/growth-stop-server.ts'),agenda=await load('lib/agenda-server.ts');
const worker=await load('lib/research-worker.ts'),workerRoute=await load('app/api/research-worker/route.ts'),route=await load('app/api/scheduled-runs/route.ts');
const passed=[];const check=(name,value)=>{assert.ok(value,name);passed.push(name)};
const owner='sched-owner',who={owner,id:'owner-account',email:null,role:'owner'},by={id:'owner-account',email:null};
const count=(kind,o=owner)=>sql.prepare('SELECT COUNT(*) n FROM records WHERE owner=? AND kind=?').get(o,kind).n;
const rows=kind=>sql.prepare('SELECT data FROM records WHERE owner=? AND kind=? ORDER BY updated_at').all(owner,kind).map(r=>JSON.parse(r.data));
const DAY=86400000;
// 2026-11-09T01:00:00Z = KST 2026-11-09(월) 10:00
const monday10=Date.parse('2026-11-09T01:00:00Z');

// 1) 순수: 입력 검증과 KST 판정
check('valid schedule input parses and normalises weekdays',(()=>{const s=pure.parseScheduleInput({kind:'weekly_performance_summary',action:'create_meeting_draft',brandId:'b',campaignId:'c',spec:{weekdays:[3,1,1],hour:9}});return s.spec.weekdays.join()==='1,3'&&s.title===''})());
for(const [name,input] of [['unknown kind',{kind:'monthly',action:'create_meeting_draft',brandId:'b',campaignId:'c',spec:{weekdays:[1],hour:9}}],['unknown action',{kind:'daily_signal_review',action:'send_mail',brandId:'b',campaignId:'c',spec:{weekdays:[1],hour:9}}],['bad weekday',{kind:'daily_signal_review',action:'create_agenda_item',brandId:'b',campaignId:'c',spec:{weekdays:[7],hour:9}}],['bad hour',{kind:'daily_signal_review',action:'create_agenda_item',brandId:'b',campaignId:'c',spec:{weekdays:[1],hour:24}}],['bad identifier',{kind:'daily_signal_review',action:'create_agenda_item',brandId:'b c',campaignId:'c',spec:{weekdays:[1],hour:9}}]]){
 check(`rejects ${name} with a Korean reason`,(()=>{try{pure.parseScheduleInput(input);return false}catch(e){return e instanceof pure.ScheduledRunError&&/[가-힣]/.test(e.message)}})());
}
check('KST parts: Monday 10:00 KST from 01:00Z',(()=>{const p=pure.kstParts(monday10);return p.day==='2026-11-09'&&p.weekday===1&&p.hour===10})());
const sched=(weekdays,hour,enabled=true)=>({spec:{weekdays,hour},enabled});
check('period is today when the weekday matches and the hour has passed',pure.periodFor(sched([1],9),monday10)==='2026-11-09'&&pure.periodFor(sched([1],10),monday10)==='2026-11-09');
check('no period before the hour, on another weekday, or when disabled',pure.periodFor(sched([1],11),monday10)===null&&pure.periodFor(sched([0],9),monday10)===null&&pure.periodFor(sched([1],9,false),monday10)===null);
const summary=pure.summarizeMetrics([{period:'2026-11-05',revenue:100000,adSpend:20000,orders:5,variableCosts:null},{period:'2026-10-20',revenue:999999,adSpend:1,orders:1,variableCosts:1},{periodStart:'2026-11-01',periodEnd:'2026-11-07',revenue:50000,adSpend:null,orders:null,variableCosts:3000}],monday10);
check('seven-day summary sums known numbers and marks the rest unknown',summary.count===2&&summary.revenue===150000&&summary.adSpend===20000&&summary.orders===5&&/2026-11-03 ~ 2026-11-09/.test(summary.text)&&/매출: 150,000원/.test(summary.text));
check('an empty window says there are no records instead of zeros',/성과 기록이 없습니다/.test(pure.summarizeMetrics([],monday10).text)&&pure.summarizeMetrics([],monday10).revenue===null);

// 2) 서버: 스위치 꺼짐은 쓰기 0, 켜짐은 기간별 1회
await core.recordStatement(owner,'campaign','c',{id:'c',brandId:'b',version:1,status:'active',title:'판매 캠페인'}).run();
await core.recordStatement(owner,'campaign','arch',{id:'arch',brandId:'b',version:1,status:'archived',title:'보관'}).run();
await core.recordStatement(owner,'metric','m1',{id:'m1',campaignId:'c',period:'2026-11-06',revenue:80000,adSpend:10000,orders:4,variableCosts:20000,productionCost:null,baselineContribution:null,notes:''},'c').run();
check('switch off: nothing runs and nothing is written',(await server.runScheduledRuns(owner,monday10)).reason==='disabled'&&count('scheduled_run_execution')===0);
check('switch off: the worker queue callback is absent',await server.scheduledRunsQueue(owner)===undefined);
const h={'oai-authenticated-user-id':owner,origin:'https://agency.test'};
const call=async res=>({status:res.status,body:await res.json()});
const post=(input,headers=h)=>route.POST(new Request('https://agency.test/api/scheduled-runs',{method:'POST',headers:{'content-type':'application/json',...headers},body:JSON.stringify(input)})).then(call);
let r=await post({action:'save',schedule:{kind:'weekly_performance_summary',action:'create_meeting_draft',brandId:'b',campaignId:'c',spec:{weekdays:[1],hour:9},title:'주간 회의 준비'}});
check('owner saves a schedule through the API while the switch is off',r.status===200&&r.body.schedule.enabled===true&&r.body.schedules.length===1&&r.body.enabled===false);
const weekly=r.body.schedule;
r=await post({action:'save',schedule:{kind:'daily_signal_review',action:'create_agenda_item',brandId:'b',campaignId:'arch',spec:{weekdays:[1],hour:9}}});
check('archived campaign is refused with 409',r.status===409);
r=await post({action:'save',schedule:{kind:'daily_signal_review',action:'create_agenda_item',brandId:'other',campaignId:'c',spec:{weekdays:[1],hour:9}}});
check('brand mismatch is a 400',r.status===400);
r=await post({action:'save',schedule:{kind:'daily_signal_review',action:'create_agenda_item',brandId:'b',campaignId:'c',spec:{weekdays:[0,1,2,3,4,5,6],hour:0}}});
check('a daily signal review schedule is saved',r.status===200&&r.body.schedules.length===2);
const daily=r.body.schedule;
check('cross-origin write is a 403 and the anonymous read a 401',(await post({action:'remove',id:daily.id},{...h,origin:'https://evil.test'})).status===403&&(await route.GET(new Request('https://agency.test/api/scheduled-runs'))).status===401);
await flags.setFeatureFlag(owner,{flag:'scheduled_runs',enabled:true},by);
let result=await server.runScheduledRuns(owner,monday10);
check('switch on: both due schedules run once',result.status==='processed'&&result.runs===2&&count('scheduled_run_execution')===2);
const draft=rows('meeting_agenda_draft')[0];
check('the weekly schedule wrote one meeting agenda draft with the 7-day summary and no model call',count('meeting_agenda_draft')===1&&draft.campaignId==='c'&&/주간 회의 준비/.test(draft.agenda)&&/매출: 80,000원/.test(draft.agenda)&&/성과 기록 1건/.test(draft.agenda)&&fetchCalls===0);
const signal=rows('growth_detected_signal')[0];
check('the daily schedule wrote one new detected signal that the agenda shows',count('growth_detected_signal')===1&&signal.status==='new'&&signal.campaignId==='c'&&(await agenda.agenda(who,monday10)).items.some(i=>i.kind==='signal'&&/일일 신호 검토 검토/.test(i.title)&&i.campaignId==='c'));
check('a second tick in the same period is idle and writes nothing more',(await server.runScheduledRuns(owner,monday10+3600000)).reason==='nothing_due'&&count('scheduled_run_execution')===2&&count('meeting_agenda_draft')===1);
check('run records are keyed by schedule id and KST day',rows('scheduled_run_execution').every(x=>x.id===`${x.scheduleId}:2026-11-09`&&x.status==='completed'&&x.outputId));
result=await server.runScheduledRuns(owner,monday10+DAY);
check('the next day only the daily schedule is due',result.runs===1&&count('scheduled_run_execution')===3&&count('meeting_agenda_draft')===1);
check('no publication, meta or execution writes',sql.prepare("SELECT COUNT(*) n FROM records WHERE kind IN ('execution_publication','meta_ads_execution','growth_action_intent','meeting')").get().n===0);

// 3) 전역 중단과 회의 시작 금지는 건너뛴 사유를 남긴다
await stop.changeGrowthStop(who,{action:'stop',expectedVersion:0,requestId:'11111111-1111-4111-8111-111111111111',reason:'운영 점검 중단'});
result=await server.runScheduledRuns(owner,monday10+2*DAY);
let latest=rows('scheduled_run_execution').at(-1);
check('global stop records a skipped run with the reason and writes no output',result.runs===1&&latest.status==='skipped'&&/전역 중단/.test(latest.reason)&&count('growth_detected_signal')===2);
await stop.changeGrowthStop(who,{action:'resume',expectedVersion:1,requestId:'22222222-2222-4222-8222-222222222222',reason:'점검 종료'});
await flags.setFeatureFlag(owner,{flag:'autonomy_rules',enabled:true},by);
await autonomy.saveAutonomySettings(who,{settings:{meeting_start:'never'}});
result=await server.runScheduledRuns(owner,monday10+7*DAY);
const weeklyRun=rows('scheduled_run_execution').find(x=>x.scheduleId===weekly.id&&x.period==='2026-11-16');
check('meeting_start never skips the meeting draft with the autonomy reason but the agenda item still runs',result.runs===2&&weeklyRun.status==='skipped'&&/금지되어/.test(weeklyRun.reason)&&count('meeting_agenda_draft')===1&&count('growth_detected_signal')===3);
await autonomy.saveAutonomySettings(who,{settings:{meeting_start:'ask'}});
r=await post({action:'set_enabled',id:weekly.id,enabled:false});
check('a disabled schedule is not due',r.status===200&&r.body.schedule.enabled===false&&(await server.runScheduledRuns(owner,monday10+14*DAY)).runs===1);
r=await post({action:'remove',id:daily.id});
check('remove deletes the schedule',r.status===200&&r.body.schedules.length===1&&count('scheduled_run')===1);
check('unknown action is a 400',(await post({action:'run_now'})).status===400);
check('other owners see nothing',count('scheduled_run','other')===0&&(await (await route.GET(new Request('https://agency.test/api/scheduled-runs',{headers:{'oai-authenticated-user-id':'other'}}))).json()).schedules.length===0);

// 4) 일일 요약: 문장은 결정 대기·기한·실행 결과·비용을 담고, 전송은 스위치+어댑터 설정이 있을 때만 기록한다
const text=digest.buildDigest({day:'2026-11-09',agenda:{counts:{overdue:1,decision:2,signal:3,upcoming:0},items:[{title:'확대 제안 승인 대기',campaignTitle:'판매 캠페인',due:null},{title:'고객 문의 약속 기한 초과',campaignTitle:'판매 캠페인',due:'2026-11-08'}],total:6},runs:[{title:'주간 회의 준비',status:'skipped',reason:'전역 중단 중'}],cost:{amount:1234.5,currency:'KRW',runs:3,unknownRuns:1}}).text;
check('digest text has the four sections in Korean',/결정 대기: 2건/.test(text)&&/기한 초과 1건/.test(text)&&/- 2026-11-08 고객 문의 약속 기한 초과/.test(text)&&/건너뜀 주간 회의 준비 — 전역 중단 중/.test(text)&&/비용: 1,235원 \(사용 3건, 금액 미확인 1건\)/.test(text));
check('digest without runs or usage says so',/예약 실행이 없습니다/.test(digest.buildDigest({day:'d',agenda:{counts:{overdue:0,decision:0,signal:0,upcoming:0},items:[],total:0},runs:[],cost:{amount:null,currency:null,runs:0,unknownRuns:0}}).text));
check('digest_mail off: idle',(await digestServer.sendDailyDigest(owner,monday10)).reason==='disabled'&&count('digest_sent')===0);
await flags.setFeatureFlag(owner,{flag:'digest_mail',enabled:true},by);
check('digest_mail on without a transport target: idle, no record',(await digestServer.sendDailyDigest(owner,monday10)).reason==='unconfigured'&&count('digest_sent')===0);
env.DIGEST_MAIL_TO='owner@example.invalid';
await core.recordStatement(owner,'provider_usage','u1',{id:'u1',provider:'hermes',providerRunId:'r1',model:'m',status:'completed',terminalReason:'',observedAt:new Date(monday10).toISOString(),costAmount:700,currency:'KRW'}).run();
result=await digestServer.sendDailyDigest(owner,monday10);
const sent=rows('digest_sent')[0];
check('configured mail stub records one digest_sent row for the day with masked target and no network',result.status==='processed'&&count('digest_sent')===1&&sent.day==='2026-11-09'&&sent.target==='o***@example.invalid'&&sent.transport==='mail'&&/비용: 700원/.test(sent.text)&&/실행 결과: 2건/.test(sent.text)&&/완료 일일 신호 검토/.test(sent.text)&&fetchCalls===0);
check('a second send the same day is idle',(await digestServer.sendDailyDigest(owner,monday10+60000)).reason==='sent'&&count('digest_sent')===1);
delete env.DIGEST_MAIL_TO;

// 5) 워커 순환: 스위치가 켜진 소유자만 'scheduled_runs' 큐가 들어간다
check('workerTick accepts the scheduled_runs queue',/scheduled_runs/.test(worker.workerTick.toString()));
const other='sched-other';
const token=await worker.registerWorker(other),tick=()=>workerRoute.POST(new Request('https://agency.test/api/research-worker',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+token,'x-collective-owner':other},body:'{}'})).then(call);
const lastQueue=()=>JSON.parse(sql.prepare("SELECT data FROM records WHERE owner=? AND kind='worker_state'").get(other).data).lastQueue;
const seen=new Set();for(let i=0;i<6;i++){const t=await tick();assert.equal(t.status,200,'tick ok');seen.add(lastQueue())}
check('switch off: the rotation never visits scheduled_runs',!seen.has('scheduled_runs')&&(seen.has('pos_pull')||seen.has('provider_catalog')));// 통합 뒤 순환의 마지막 큐는 pos_pull(C7)이다
await core.recordStatement(other,'campaign','c',{id:'c',brandId:'b',version:1,status:'active',title:'t'}).run();
await flags.setFeatureFlag(other,{flag:'scheduled_runs',enabled:true},by);
const now=pure.kstParts(Date.now());
await server.saveSchedule({owner:other,id:'o',email:null,role:'owner'},{schedule:{kind:'daily_signal_review',action:'create_agenda_item',brandId:'b',campaignId:'c',spec:{weekdays:[now.weekday],hour:0}}});
let processed=null;for(let i=0;i<8&&!processed;i++){const t=await tick();if(t.body.queue==='scheduled_runs')processed=t.body}
check('switch on: the rotation reaches scheduled_runs and processes the due schedule',!!processed&&processed.status==='processed'&&count('scheduled_run_execution',other)===1);
check('the Python worker contract still holds (status idle|processed|retry)',['idle','processed','retry'].includes(processed.status));

console.log(JSON.stringify({passed:passed.length,checks:passed},null,2));
