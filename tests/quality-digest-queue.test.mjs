// B2 2단계 워커 digest 큐 회귀(docs/QUALITY-CONSOLE.ko.md '2단계'). 실제 SQLite(node:sqlite)·실제 워커 tick·실제 사용량 라우트, 합성 데이터. 외부·모델 호출 0(mocked: fetch 스텁).
// 순수 판정(무효율 2배 경계·기존 경보 묶기·골든 하락·예산 문턱·보존 제안·표 합치기), 스위치 꺼짐 tick 0회, 켜짐 주 1회 1건·두 번째 tick no-op, 같은 변경 중복 경보 0,
// 다른 소유자 섞임 0, 캠페인·작업물 상태 불변, 처리 시간 기록, 실패 뒤 재시도, 사용량 표 권한(직원 응답에 키 없음·관리자 있음·비로그인 401)과 kind·스위치 등록을 확인한다.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {testRuntime} from './helpers/runtime.mjs';

let fetchCalls=0;
const rt=testRuntime(async()=>{fetchCalls++;throw new Error('외부 호출 금지')});
const server=await rt.load('lib/server.ts'),flags=await rt.load('lib/feature-flags.ts'),drift=await rt.load('lib/quality-drift.ts'),queue=await rt.load('lib/quality-digest-queue-server.ts');
const worker=await rt.load('lib/research-worker.ts'),usageRoute=await rt.load('app/api/usage/route.ts'),qc=await rt.load('lib/quality-console.ts'),budget=await rt.load('lib/token-budget.ts');
const registry=await rt.load('lib/record-kinds.ts'),status=await rt.load('lib/feature-status.ts');
let passed=0;const check=(name,ok)=>{assert.ok(ok,name);passed++};
const plain=v=>JSON.parse(JSON.stringify(v));
const runs=(role,n,invalid,at)=>Array.from({length:n},(_,i)=>({role,outcome:i<invalid?'invalid_output':'completed',at}));

// 1) 순수 판정: 역할 무효율(직전 20건 대비 2배, 경계 포함), 표본 부족·미측정
const st=(cur,base)=>drift.invalidRateCheck('content',cur,base).status;
check('2/10 this week against 2/20 before is exactly twice: one alarm',st(runs('content',10,2,'b'),runs('content',20,2,'a'))==='alarm');
check('3/20 this week against 2/20 before is below twice: no alarm',st(runs('content',20,3,'b'),runs('content',20,2,'a'))==='ok');
check('fewer than 5 runs this week is insufficient, not a rate',st(runs('content',4,4,'b'),runs('content',20,0,'a'))==='insufficient');
check('fewer than 20 baseline runs is insufficient',st(runs('content',10,5,'b'),runs('content',19,0,'a'))==='insufficient');
check('no output runs this week is unmeasured, not zero',st([{role:'content',outcome:'provider_failed',at:'b'}],runs('content',20,0,'a'))==='unmeasured');
check('a zero baseline uses the 1/20 floor (10% alarms, 5% does not)',st(runs('content',10,1,'b'),runs('content',20,0,'a'))==='alarm'&&st(runs('content',20,1,'b'),runs('content',20,0,'a'))==='ok');
check('provider failures are not in the denominator',drift.invalidRateCheck('content',[...runs('content',5,1,'b'),{role:'content',outcome:'provider_failed',at:'b'}],runs('content',20,0,'a')).current.n===5);
// 기존 경보 재사용: 같은 전환은 1건으로 묶고 id는 첫 원 경보 id
const change=(id,from,to,at)=>({id,key:'hermes',provider:'hermes',kind:'role',from,to,providerRunId:'r-'+id,observedAt:at});
const alias={reported:'hermes-agent',actual:null},model=m=>({reported:m,actual:m});
const mc=plain(drift.modelChangeAlarms([change('hermes:3:b',model('A'),model('B'),'2026-09-22T02:00:00Z'),change('hermes:1:a',alias,model('B'),'2026-09-21T02:00:00Z'),change('hermes:2:c',alias,model('B'),'2026-09-21T05:00:00Z')],'2026-W39'));
check('repeated model transitions in a week are one alarm keyed by the first change',mc.length===2&&mc[0].id==='model_change:hermes:1:a'&&mc[0].sources.join()==='hermes:1:a,hermes:2:c'&&/같은 전환 2회/.test(mc[0].detail));
// 골든 스모크: 직전 통과 → 이번 실패만 하락
const g=(id,at,cases)=>({id,finishedAt:at,cases:cases.map(([caseId,st,fail])=>({caseId,status:st,fail,graderError:0}))});
const W={from:'2026-09-20T15:00:00.000Z',to:'2026-09-27T15:00:00.000Z'};
const gold=plain(drift.goldenCheck([g('r2','2026-09-22T00:00:00Z',[['c1','completed',0],['c2','completed',1],['c3','blocked',null]]),g('r1','2026-09-10T00:00:00Z',[['c1','completed',0],['c2','completed',0],['c3','completed',0]])],W));
check('a case that passed before and fails now is a golden drop; blocked cases are not judged',gold.status==='alarm'&&gold.regressed.join()==='c2'&&gold.compared===2&&gold.runId==='r2'&&gold.previousRunId==='r1');
check('no run this week is unmeasured and a first run is insufficient',drift.goldenCheck([],W).status==='unmeasured'&&drift.goldenCheck([g('r2','2026-09-22T00:00:00Z',[['c1','completed',0]])],W).status==='insufficient');
// 토큰 예산: 상한 없으면 미측정, 넘은 가장 높은 문턱 하나
const b=(limit,used)=>plain(drift.budgetCheck({scope:'workspace',campaignId:null,limit,used}));
check('budget without a limit is unmeasured, not 0%',b(null,500).status==='unmeasured'&&b(null,500).rate===null);
check('budget crossing 80% and 100% alarms on the highest threshold only',b(1000,850).threshold===0.8&&b(1000,1200).threshold===1&&b(1000,500).status==='ok');
// 보존 정리 제안과 표 합치기
const NOW=Date.now(),DAY=864e5,iso=t=>new Date(t).toISOString();
const ret=plain(drift.retentionSuggestion([iso(NOW-DAY),iso(NOW+5*DAY),iso(NOW+60*DAY)],NOW));
check('retention suggestion counts expired-not-purged and soon-expiring signals',ret.signals===3&&ret.expiredNotPurged===1&&ret.expiringSoon===1&&ret.suggestions.length===2);
const cr=(skill,n,ok)=>({role:'cmo',skillVersion:skill,promptVersion:null,reportedModel:'m',promptVersions:[],artifacts:n,n,approvedFirst:ok,editedFirst:0,firstPassRate:null,revisions:0,reasons:{},discardedTokens:10,discarded:{},unlinkedTokens:0,unknownTokenRuns:1,gradings:{},holds:0});
const merged=plain(drift.usageTable([cr('s1',3,3),cr('s2',2,1)]));
check('the usage table merges skill versions and recomputes the rate from the sums',merged.length===1&&merged[0].n===5&&merged[0].firstPassRate===0.8&&merged[0].discardedTokens===20&&merged[0].unknownTokenRuns===2);

// 2) 합성 운영 데이터: 소유자 O(지난주 활동), 다른 소유자 X
const O='dq-owner',X='dq-other',week=qc.previousWeek(qc.isoWeekOf(iso(NOW))),range=qc.weekRange(week),START=Date.parse(range.from);
const at=(days)=>iso(START+days*DAY);
const put=(owner,kind,id,data,parent='')=>server.recordStatement(owner,kind,id,data,parent).run();
const usage=(owner,id,extra)=>put(owner,'provider_usage',`hermes:${id}`,{id:`hermes:${id}`,provider:'hermes',providerRunId:id,model:'hermes-agent',inputTokens:100,outputTokens:50,totalTokens:150,status:'completed',terminalReason:'completed',costStatus:'unpriced',domainOutcome:'completed',jobId:null,campaignId:'c1',kind:'role',artifactId:null,promptVersion:'sv1:abc',...extra});
await put(O,'campaign','c1',{id:'c1',brandId:'oda',title:'주간 집계',goal:'평일 방문',version:1,status:'review'});
await put(O,'artifact','a1',{id:'a1',campaignId:'c1',campaignVersion:1,role:'cmo',title:'전략',content:'## 목표\n실행 초안',version:1,status:'review',origin:'ai',skillVersion:'sv1',createdAt:at(1)},'c1');
for(let i=0;i<20;i++){await usage(O,`cb${i}`,{role:'content',domainOutcome:i<2?'invalid_output':'completed',observedAt:at(-2-i*0.01)});await usage(O,`mb${i}`,{role:'cmo',domainOutcome:i<2?'invalid_output':'completed',observedAt:at(-2-i*0.01)})}
for(let i=0;i<10;i++)await usage(O,`cw${i}`,{role:'content',domainOutcome:i<2?'invalid_output':'completed',observedAt:at(1+i*0.01)});
for(let i=0;i<20;i++)await usage(O,`mw${i}`,{role:'cmo',domainOutcome:i<3?'invalid_output':'completed',observedAt:at(1+i*0.01)});
await usage(O,'art-a1',{role:'cmo',artifactId:'a1',observedAt:at(1)});
for(const [id,t] of [['hermes:1:aa',at(1)],['hermes:2:bb',at(2)]])await put(O,'model_change',id,change(id,alias,model('model-b'),t));
await put(O,'model_change','hermes:0:old',change('hermes:0:old',alias,model('model-a'),at(-3)));
await usage(O,'now-run',{kind:'research',role:null,observedAt:iso(NOW-60000)});
const evalRun=(id,t,fail2)=>put(O,'eval_run',id,{id,label:'골든',variant:'active',set:'dev',caseIds:['k1','k2'],status:'completed',updatedAt:t,createdAt:t,results:[['k1',0],['k2',fail2]].map(([caseId,fail])=>({caseId,label:caseId,set:'dev',role:'cmo',variant:'active',status:'completed',summary:{pass:3,fail,grader_error:0,not_applicable:0}}))});
await evalRun('run-prev',at(-5),0);await evalRun('run-now',at(2),1);
const used=plain(await budget.tokenBudgetSummary(rt.env.DB,O,new Date(NOW))).workspace.used;
await budget.setTokenBudget(rt.env.DB,O,{scope:'workspace',monthlyTokens:Math.ceil(used/0.9)},{id:O,email:null});
await put(X,'campaign','c9',{id:'c9',brandId:'oda',title:'남의 캠페인',goal:'x',version:1,status:'review'});
for(let i=0;i<10;i++)await usage(X,`xw${i}`,{role:'growth',model:'x-private-model',domainOutcome:'invalid_output',observedAt:at(1)});
await put(X,'model_change','hermes:1:xx',change('hermes:1:xx',alias,model('x-private-model'),at(1)));

const rows=(kind,owner=O)=>rt.sql.prepare('SELECT id,data FROM records WHERE owner=? AND kind=? ORDER BY id').all(owner,kind);
const state=()=>JSON.stringify(rt.sql.prepare("SELECT id,data,updated_at FROM records WHERE kind IN ('campaign','artifact','prompt_release','prompt_alarm_ack','feature_flag') ORDER BY id").all());
const setFlag=(owner,enabled)=>flags.setFeatureFlag(owner,{flag:'b2_digest_queue',enabled},{id:owner,email:null});
const token=await worker.registerWorker(O),hash=await worker.workerHash(token);
const idle=async()=>({status:'idle'});
const tick=(now=NOW)=>worker.workerTick({owner:O,hash},async()=>new Response('{}'),idle,idle,owner=>queue.runDigestQueue(owner,now)).then(plain);

// 3) 스위치 꺼짐: tick에서 digest 작업 0회(스위치 1행만 읽는다)
const queries=[],prepare=rt.env.DB.prepare;
rt.env.DB.prepare=q=>{queries.push(q);return prepare(q)};
check('the switch is off by default',await flags.isEnabled(O,'b2_digest_queue')===false);
queries.length=0;
const off=plain(await queue.runDigestQueue(O,NOW));
check('switch off: the digest queue is idle after reading only the switch',off.status==='idle'&&queries.length===1&&/feature_flag/.test(queries[0]));
rt.env.DB.prepare=prepare;
const offTick=await tick();
check('switch off: a worker tick writes no digest or alarm',offTick.status==='idle'&&rows('quality_digest').length===0&&rows('quality_drift_alarm').length===0);

// 4) 켜짐: 주 1회 1건, 두 번째 tick no-op, 캠페인·작업물·프롬프트 상태 불변
// 비식별 신호는 꺼짐 tick의 하루 1회 정리 뒤에 넣는다(같은 UTC 날짜의 다음 tick은 정리하지 않는다).
for(const [id,t] of [['s1',NOW-DAY],['s2',NOW+5*DAY]])await put(O,'deidentified_signal',id,{id,expiresAt:iso(t)});
await setFlag(O,true);
const before=state();
const first=await tick();
const digests=rows('quality_digest'),digest=JSON.parse(digests[0]?.data||'{}');
check('switch on: the first tick processes the digest queue for last week',first.status==='processed'&&first.queue==='digest'&&first.week===week&&digests.length===1&&digests[0].id===`${O}:quality_digest:${week}`);
check('the processing time is recorded and within the 60s worker timeout',typeof digest.durationMs==='number'&&digest.durationMs>=0&&digest.durationMs<60000&&digest.withinBudget===true);
const second=await tick();
check('the second tick in the same week is a no-op',second.status==='idle'&&rows('quality_digest').length===1&&rows('quality_digest')[0].data===digests[0].data);
check('the digest changes no campaign, artifact, prompt or alarm acknowledgement',state()===before);
check('no external or model call is made',fetchCalls===0);
// 경보: 모델 변경 1(같은 전환 2회 묶음, 지난주 밖 제외), 콘텐츠 무효율 1(경계 미만 cmo 0), 골든 하락 1, 예산 80% 1
const alarmIds=rows('quality_drift_alarm').map(r=>r.id.split(':quality_drift_alarm:')[1]).sort();
const month=plain(budget.kstMonth(new Date(NOW))).month;
check('alarms: one model change, content invalid rate, golden drop and budget threshold',JSON.stringify(alarmIds)===JSON.stringify([`golden_drop:run-now`,`invalid_rate:content:${week}`,'model_change:hermes:1:aa',`token_budget:${month}:workspace:80`].sort()));
const invalid=digest.drift.invalidRates;
check('the content role doubled (2/10 vs 2/20) and cmo stayed below (3/20)',invalid.find(r=>r.role==='content').status==='alarm'&&invalid.find(r=>r.role==='cmo').status==='ok');
check('the digest keeps kappa as insufficient with labels needed, never a number',digest.kappa.length===5&&digest.kappa.every(k=>['no_data','insufficient'].includes(k.status)&&k.kappa===null&&k.needed>0));
check('retention suggestion rides along with the digest',digest.retention.expiredNotPurged===1&&digest.retention.expiringSoon===1);
check('the table row for cmo shows no first-pass sample as unmeasured (n=0)',digest.table.some(r=>r.role==='cmo'&&r.n===0&&r.firstPassRate===null));
// 같은 변경 중복 경보 0: 같은 주를 다시 만들어도, 다음 주로 넘어가도 경보 행이 늘지 않는다
const alarmCount=rows('quality_drift_alarm').length,alarmData=JSON.stringify(rows('quality_drift_alarm'));
// 동시에 두 tick이 같은 주를 만든 경우(저장 행 조회가 비어 보임): 완료 행을 덮지 않는다.
const completedRow=rows('quality_digest')[0].data;
rt.env.DB.prepare=q=>/SELECT data FROM records WHERE id=\? AND owner=\? AND kind='quality_digest'/.test(q)?{bind:()=>({first:async()=>null})}:prepare(q);
const raced=plain(await queue.runDigestQueue(O,NOW));rt.env.DB.prepare=prepare;
check('a racing second build keeps the first completed row and its alarms',raced.status==='processed'&&rows('quality_digest')[0].data===completedRow&&JSON.stringify(rows('quality_drift_alarm'))===alarmData);
rt.sql.prepare('DELETE FROM records WHERE owner=? AND kind=?').run(O,'quality_digest');
check('recomputing the same week adds no duplicate alarm and keeps the first alarm rows',(await queue.runDigestQueue(O,NOW)).status==='processed'&&rows('quality_drift_alarm').length===alarmCount&&JSON.stringify(rows('quality_drift_alarm'))===alarmData);
const nextWeek=plain(await queue.runDigestQueue(O,NOW+7*DAY));
check('the next week does not re-alarm the same model change or budget threshold',nextWeek.status==='processed'&&rows('quality_digest').length===2&&rows('quality_drift_alarm').length===alarmCount);
// 소유자 격리: X의 모델·역할이 O 집계에 없고, X는 켜기 전까지 아무것도 없다
check('another owner data never enters the digest',!rows('quality_digest').some(r=>/x-private-model|growth|dq-other/.test(r.data))&&rows('quality_digest',X).length===0&&rows('quality_drift_alarm',X).length===0);
await setFlag(X,true);await queue.runDigestQueue(X,NOW);
check('the other owner gets its own digest and alarms only',rows('quality_digest',X).length===1&&rows('quality_drift_alarm',X).every(r=>!/content|run-now/.test(r.id))&&rows('quality_drift_alarm',X).some(r=>/model_change:hermes:1:xx/.test(r.id)));

// 5) 실패하면 failed·retryAt을 남기고 다음 차례에 다시 만든다
const failWeek=NOW+14*DAY;
rt.env.DB.prepare=q=>{if(/kind='eval_run'/.test(q))throw new Error('d1 down');return prepare(q)};
const failed=plain(await queue.runDigestQueue(O,failWeek));
rt.env.DB.prepare=prepare;
const failedRow=JSON.parse(rows('quality_digest').at(-1).data);
check('a failed digest returns retry and records failed with a retry time',failed.status==='retry'&&failedRow.status==='failed'&&Date.parse(failedRow.retryAt)>Date.now()&&failedRow.attempts===1);
check('before the retry time the queue stays idle',(await queue.runDigestQueue(O,failWeek)).status==='idle');
rt.sql.prepare("UPDATE records SET data=json_set(data,'$.retryAt',?) WHERE owner=? AND kind='quality_digest' AND json_extract(data,'$.status')='failed'").run(iso(Date.now()-1000),O);
check('after the retry time the digest completes in the same row',(await queue.runDigestQueue(O,failWeek)).status==='processed'&&JSON.parse(rows('quality_digest').at(-1).data).status==='completed'&&rows('quality_digest').length===3);

// 6) 사용량 화면 표: 품질 콘솔과 같은 권한(소유자·관리자). 직원 응답에는 qualityTable 키가 없고 기존 사용량 필드는 그대로, 비로그인 401
const get=headers=>usageRoute.GET(new Request('https://agency.test/api/usage',{headers}));
const legacy=plain(await (await get({'oai-authenticated-user-id':O})).json()).qualityTable;
check('the usage response carries the latest completed week table for the owner',legacy&&legacy.week===JSON.parse(rows('quality_digest').at(-1).data).week&&Array.isArray(legacy.rows)&&typeof legacy.notice==='string');
Object.assign(rt.env,{AUTH_MODE:'email',AUTH_ORIGIN:'https://agency.test'});
const sha=v=>createHash('sha256').update(v).digest('hex');
const signIn=(id,role,ws)=>{const t=sha(id);rt.sql.prepare('INSERT INTO auth_users(id,email,workspace_owner,role,status,created_at) VALUES(?,?,?,?,?,?)').run(id,id+'@test.invalid',ws,role,'active',1000);rt.sql.prepare('INSERT INTO auth_sessions VALUES(?,?,?,?)').run(sha(t),id,Date.now()+60000,Date.now());return {cookie:'__Host-collective_session='+t}};
const [anon,member,admin,stranger]=await Promise.all([get({}),get(signIn('dq-member','member',O)),get(signIn('dq-admin','admin',O)),get(signIn('dq-stranger','admin',X))]);
check('unauthenticated usage is a 401',anon.status===401);
const memberBody=await member.json(),adminBody=await admin.json(),strangerTable=(await stranger.json()).qualityTable;
check('a member reads usage without the quality table key',member.status===200&&!('qualityTable' in memberBody));
check('a member keeps every other usage field the admin gets',JSON.stringify(Object.keys(memberBody).sort())===JSON.stringify(Object.keys(adminBody).filter(k=>k!=='qualityTable').sort())&&Array.isArray(memberBody.entries)&&memberBody.entries.length===adminBody.entries.length);
check('an admin reads the table like the quality console',admin.status===200&&adminBody.qualityTable?.week===legacy.week);
check('another workspace admin sees only its own table',stranger.status===200&&strangerTable.rows.every(r=>r.role!=='cmo')&&!JSON.stringify(strangerTable).includes('run-now'));
check('the table carries no artifact content, memo or email',!/실행 초안|@test\.invalid|전략/.test(JSON.stringify(adminBody.qualityTable)));

// 7) 등록과 구조: 스위치·kind·기능 상태 행·워커 연결
const catalog=plain(flags.FEATURE_FLAGS),names=Object.keys(catalog);
check('b2_digest_queue is a known switch, off by default, after b3_playbook_signals',catalog.b2_digest_queue?.defaultEnabled===false&&names.indexOf('b2_digest_queue')===names.indexOf('b3_playbook_signals')+1);
const kinds=plain(registry.recordKinds),ki=k=>kinds.findIndex(x=>x.kind===k);
check('quality_digest and quality_drift_alarm are registered after prompt_alarm_ack and outside campaign deletion',ki('quality_digest')===ki('prompt_alarm_ack')+1&&ki('quality_drift_alarm')===ki('quality_digest')+1&&['quality_digest','quality_drift_alarm'].every(k=>kinds[ki(k)].campaignDeletion==='not_campaign_scoped'&&kinds[ki(k)].parent==='none'));
const row=list=>plain(status.featureRows({flags:list})).find(r=>r.key==='quality-digest');
check('the settings table has a digest row that follows the switch',row([{flag:'b2_digest_queue',enabled:true}]).status==='available'&&row([{flag:'b2_digest_queue',enabled:false}]).status==='blocked'&&row(undefined).status==='blocked');
const src=p=>readFileSync(p,'utf8');
check('the worker route passes the digest queue and only the server module reads the switch',/runDigestQueue/.test(src('app/api/research-worker/route.ts'))&&!/feature-flags/.test(src('lib/research-worker.ts'))&&/isEnabled\(owner,'b2_digest_queue'\)/.test(src('lib/quality-digest-queue-server.ts')));
check('the digest makes no model call (no HERMES or OpenAI import)',!/hermes|openai|fetch\(/i.test(src('lib/quality-digest-queue-server.ts').replace(/^\/\/.*$/gm,''))&&!/hermes|openai|fetch\(/i.test(src('lib/quality-drift.ts').replace(/^\/\/.*$/gm,'').replace(/import type[^;]*;/g,'')));
console.log(JSON.stringify({passed}));
