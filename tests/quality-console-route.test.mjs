// B2 품질 콘솔 라우트 회귀(console-server-ui). 실제 SQLite(node:sqlite)·실제 라우트, 헤더(legacy)·세션(email) 인증, 합성 데이터. 외부 호출·모델 호출은 0이다(mocked: fetch 스텁).
// 권한(401·403·404), 기간·주 검증(400), 응답 모양, 기간 밖 이력 읽기(1차 판정·보고 모델·회의·jobs), 전체 레코드로 만든 집계와 같은 숫자, 다이제스트 content-type·파일명·스크립트 입력 호환,
// owner 격리, 행 상한 '일부만 집계', 쓰기 없음, 화면 연결을 확인한다.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,existsSync,mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {testRuntime} from './helpers/runtime.mjs';

let fetchCalls=0;
const rt=testRuntime(async()=>{fetchCalls++;throw new Error('외부 호출 금지')});
const server=await rt.load('lib/server.ts'),route=await rt.load('app/api/quality-console/route.ts'),qs=await rt.load('lib/quality-console-server.ts');
const qc=await rt.load('lib/quality-console.ts'),qd=await rt.load('lib/quality-digest.ts');
let passed=0;const check=(name,ok)=>{assert.ok(ok,name);passed++};
const plain=value=>JSON.parse(JSON.stringify(value));
const DAY=86400000,now=Date.now(),ago=days=>new Date(now-days*DAY).toISOString();

// 1) 기간·주(순수). 기준 시각은 고정한다: 2026-09-24 10:00 KST = 01:00Z(python datetime으로 확인: 2026-09-24는 목요일, ISO 2026-W39).
const fixed=Date.parse('2026-09-24T01:00:00Z'),P=q=>new URLSearchParams(q);
const bad=fn=>{try{fn();return false}catch(e){return e.status===400}};
const d=plain(qs.consolePeriod(P(''),fixed));
check('default period is the last 28 KST days ending today',d.from==='2026-08-28'&&d.to==='2026-09-24'&&d.days===28);
check('period bounds are KST midnights in UTC',d.start==='2026-08-27T15:00:00.000Z'&&d.end==='2026-09-24T15:00:00.000Z');
check('explicit from/to are inclusive',qs.consolePeriod(P('from=2026-09-01&to=2026-09-01'),fixed).days===1);
check('180 days is allowed',qs.consolePeriod(P('from=2026-03-29&to=2026-09-24'),fixed).days===180);
check('181 days is a 400',bad(()=>qs.consolePeriod(P('from=2026-03-28&to=2026-09-24'),fixed)));
check('from after to is a 400',bad(()=>qs.consolePeriod(P('from=2026-09-10&to=2026-09-01'),fixed)));
check('malformed and impossible dates are a 400',['from=2026-9-1','from=2026-02-30','to=2026-13-01','to=yesterday'].every(q=>bad(()=>qs.consolePeriod(P(q),fixed))));
check('last full week is the previous ISO week in KST',qs.lastFullWeek(fixed)==='2026-W38'&&qs.lastFullWeek(Date.parse('2026-09-20T15:30:00Z'))==='2026-W38'&&qs.lastFullWeek(Date.parse('2026-09-20T14:30:00Z'))==='2026-W37');

// 2) 합성 데이터: 소유자 qc-owner(캠페인 c1)와 다른 소유자 qc-other(캠페인 c9). 판정은 기록 순서(rowid)대로 넣는다.
const O='qc-owner',X='qc-other';
const put=(owner,kind,id,data,parent='')=>server.recordStatement(owner,kind,id,data,parent).run();
const decision=(owner,id,targetId,value,createdAt,extra={})=>rt.sql.prepare('INSERT INTO records(id,owner,kind,parent_id,data,updated_at) VALUES(?,?,?,?,?,?)').run(`${owner}:review_decision:${id}`,owner,'review_decision','',JSON.stringify({id,targetKind:'artifact',targetId,version:1,role:'cmo',decision:value,reasonCodes:value==='revision'?['evidence']:[],actor:{id:'u1',role:'owner'},promptVersion:'sv1:abc',skillVersion:'sv1',outputContractVersion:null,campaignId:'c1',brandId:null,origin:'ai',reasonsVersion:'review-reasons-v1',createdAt,...extra}),createdAt);
const art=(id,extra={})=>({id,campaignId:'c1',campaignVersion:1,role:'cmo',title:'전략 '+id,content:'## 목표\n평일 방문을 늘리는 실행 초안',version:1,status:'review',origin:'ai',skillVersion:'sv1',createdAt:ago(2),...extra});
await put(O,'campaign','c1',{id:'c1',brandId:'oda',title:'콘솔',goal:'평일 방문',version:1,status:'review'});
await put(X,'campaign','c9',{id:'c9',brandId:'oda',title:'남의 캠페인',goal:'x',version:1,status:'review'});
await put(O,'artifact','a1',art('a1',{status:'approved'}),'c1');
await put(O,'artifact','a2',art('a2',{status:'outdated'}),'c1');
await put(O,'artifact','a3',art('a3',{content:'현재 메시지에는 수행할 작업이 명시되지 않았습니다. 원하시는 작업을 선택해 주세요.'}),'c1');
await put(O,'artifact','a4',art('a4',{content:'가'.repeat(3000),complianceHold:{version:'c1',block:2,issues:[{category:'x',ruleId:'r',title:'t',excerpt:'원문 발췌'}],checkedAt:ago(2),notice:'n'}}),'c1');
await put(O,'artifact','a0',art('a0',{createdAt:ago(45)}),'c1');
await put(O,'artifact','old',art('old',{createdAt:ago(60)}),'c1');
await put(X,'artifact','x1',art('x1',{campaignId:'c9'}),'c9');
decision(O,'d0','a0','revision',ago(40));
decision(O,'d1','a1','approved',ago(2));
decision(O,'d2','a3','revision',ago(2),{criteria:[{criterion:'evidence',human:'revise',ai:'pass'}]});
decision(O,'d3','a0','approved',ago(1));
decision(O,'d-old','old','approved',ago(59));
decision(X,'dx','x1','approved',ago(1),{campaignId:'c9'});
const usage=(owner,run,extra={})=>put(owner,'provider_usage',`hermes:${run}`,{id:`hermes:${run}`,provider:'hermes',providerRunId:run,model:'hermes-agent',inputTokens:100,outputTokens:50,totalTokens:150,status:'completed',terminalReason:'completed',observedAt:ago(2),costAmount:null,currency:null,priceVersion:null,costStatus:'unpriced',pricingSource:null,inputPricePerMillion:null,outputPricePerMillion:null,domainOutcome:'completed',outcomeObservedAt:ago(2),jobId:'j1',campaignId:'c1',kind:'role',role:'cmo',artifactId:'a1',promptVersion:'sv1:abc',...extra});
await usage(O,'r1');await usage(O,'r2',{domainOutcome:'invalid_output',jobId:null,artifactId:null});await usage(O,'r3',{jobId:'j3',artifactId:'a3',totalTokens:500});
await usage(O,'r-a0',{jobId:'j0',artifactId:'a0',model:'model-a0',observedAt:ago(45)});
await usage(O,'r-unrelated',{jobId:'jz',artifactId:'zzz',observedAt:ago(90)});
await usage(O,'r-meet',{kind:'meeting',jobId:`${O}:meeting:m-prev`,artifactId:null,role:'strategy',observedAt:ago(2)});
await usage(O,'run-jold',{jobId:null,artifactId:null,kind:undefined,role:undefined,promptVersion:undefined,campaignId:'c1',totalTokens:70});
await usage(X,'rx',{campaignId:'c9',artifactId:'x1'});
const meeting=(owner,id,status,parent,createdAt=ago(3))=>put(owner,'team_meeting',id,{id,campaignId:parent,campaignVersion:1,agenda:'안건 원문',status,steps:[],createdAt,updatedAt:createdAt,model:'HERMES',stopRequested:false,artifactIds:['a1'],invalidatedRoles:[],snapshot:{campaign:{id:parent},brand:{},artifacts:[{content:'스냅샷 본문'.repeat(100)}],metrics:[],learning:[]}},parent);
await meeting(O,'m1','completed','c1');await meeting(O,'m2','failed','c1');await meeting(O,'m3','cancelled','c1');await meeting(O,'m-prev','completed','c1',ago(40));await meeting(O,'m-old','completed','c1',ago(50));await meeting(X,'mx','completed','c9');
const grading=(owner,id,artifactId,status,parent,jobId='j1')=>put(owner,'grading',id,{id,artifactId,artifactVersion:1,campaignId:parent,campaignVersion:1,role:'cmo',source:'role',jobId,meetingId:null,status,gradersVersion:'g1',graders:[{id:'question_only',status:'fail',detail:'채점 상세 원문'},{id:'format',status:'pass'}],summary:{pass:1,fail:1,not_applicable:0,grader_error:0},compliance:{version:'c',block:0,warn:0,info:0,issues:[]},context:{},durationMs:3,gradedAt:ago(2)},parent);
await grading(O,'a1:1','a1','graded','c1');await grading(O,'a3:1','a3','grader_error','c1','j3');await grading(X,'x1:1','x1','graded','c9');
const job=(owner,id,campaign,status,createdAt=ago(2))=>rt.sql.prepare('INSERT INTO jobs(id,owner,campaign_id,role,status,provider_id,model,campaign_version,created_at,updated_at,tokens) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(id,owner,campaign,'cmo',status,'run-'+id,'HERMES',1,createdAt,createdAt,0);
job(O,'j1','c1','completed');job(O,'j2','c1','failed');job(O,'j3','c1','completed',ago(20));job(O,'jold','c1','completed',ago(70));job(O,'jfar','c1','completed',ago(80));job(X,'jx','c9','completed');

// 3) 저장소 조회: 기간 + 집계에 필요한 이력, 소유자 범위, 본문 절단
const period=qs.consolePeriod(P(''),now),loaded=await qs.readConsoleRecords(O,period,null),rec=plain(loaded.input);
const ids=rows=>rows.map(r=>r.id).sort().join(',');
check('decisions: in the period plus earlier judgements of artifacts judged in the period, in record order',rec.decisions.map(x=>x.id).join(',')==='d0,d1,d2,d3');
check('artifacts: in the period, judged in the period, or used/graded in the period; other owners excluded',ids(rec.artifacts)==='a0,a1,a2,a3,a4');
check('short artifact content is kept for the question-only check',rec.artifacts.find(a=>a.id==='a3').content.includes('명시되지 않았습니다'));
check('long artifact content is not read',rec.artifacts.find(a=>a.id==='a4').content==='');
check('compliance hold is reduced to its check time and block count',JSON.stringify(rec.artifacts.find(a=>a.id==='a4').complianceHold)===JSON.stringify({checkedAt:ago(2),block:2})&&rec.artifacts.find(a=>a.id==='a1').complianceHold===null);
check('usage: in the period plus runs of artifacts judged in the period (reported model); unrelated old runs excluded',ids(rec.usage)==='hermes:r-a0,hermes:r-meet,hermes:r1,hermes:r2,hermes:r3,hermes:run-jold');
check('meetings: started in the period plus meetings of in-period meeting usage, status fields only',ids(rec.meetings)==='m-prev,m1,m2,m3'&&rec.meetings.every(m=>Object.keys(m).sort().join()==='campaignId,createdAt,id,status'));
check('gradings keep only aggregate fields',ids(rec.gradings)==='a1:1,a3:1'&&rec.gradings.every(g=>!('compliance' in g)&&!('context' in g)));
check('jobs: created in the period or referenced by usage and gradings, as raw job rows',ids(rec.jobs)==='j1,j2,j3,jold'&&rec.jobs.every(j=>Object.keys(j).sort().join()==='id,provider_id,role'));
check('nothing is truncated below the row limit',plain(loaded.truncated).length===0);

// 4) 라우트(legacy 헤더): 응답 모양, 전체 레코드로 만든 집계와 같은 숫자, 쓰기 없음
const get=(query,headers)=>route.GET(new Request('https://agency.test/api/quality-console'+query,{headers}));
const as=who=>({'oai-authenticated-user-id':who});
const recordsBefore=rt.sql.prepare('SELECT COUNT(*) n, MAX(updated_at) m FROM records').get();
let r=await get('',as(O)),body=await r.json();
check('owner gets the console JSON',r.status===200&&r.headers.get('cache-control')==='no-store');
check('response has period, summary, kappa, partial, read, digestWeek and notice',['period','summary','kappa','partial','read','digestWeek','notice'].every(k=>k in body)&&body.period.days===28&&body.period.timezone==='Asia/Seoul'&&body.digestWeek===qs.lastFullWeek(now));
check('read counts are what the aggregation received',JSON.stringify(body.read)===JSON.stringify({decisions:4,artifacts:5,history:0,usage:6,meetings:4,gradings:2,jobs:4,units:1}));
check('first decisions follow B1 record order: a0 was first judged before the period',body.summary.totals.n===2&&body.summary.totals.approvedFirst===1&&body.summary.totals.revisions===1);
check('a decision on an artifact made before the period takes that artifact\'s reported model',body.summary.rows.some(row=>row.reportedModel==='model-a0'&&row.n===0&&row.artifacts===0));
check('question-only tokens, invalid output and unlinked usage are aggregated',body.summary.totals.discarded.question_only===500&&body.summary.totals.discarded.invalid_output===150&&body.summary.totals.holds===1);
check('meeting completion counts meetings started in the period',JSON.stringify(body.summary.meetings)===JSON.stringify({started:3,completed:1,failed:1,cancelled:1,inProgress:0,rate:null}));
check('kappa has the five criteria with the period labels',body.kappa.length===5&&body.kappa.find(k=>k.criterion==='evidence').n===1&&body.kappa.every(k=>k.status!=='ok'));
check('weekly trend covers the period',body.summary.weeks.length>=4&&body.summary.weeks.every(w=>/^\d{4}-W\d{2}$/.test(w.week)));
check('no partial flag below the row limit',body.partial===null);
check('notice says the console is not an automatic judgement',/자동 판정이 아니/.test(body.notice));
check('response carries no content, grader detail, agenda or snapshot text',!/평일 방문|채점 상세 원문|안건 원문|스냅샷 본문|원문 발췌/.test(JSON.stringify(body)));
// 같은 소유자의 전체 레코드를 그대로 넘긴 순수 집계와 같은 숫자여야 한다(기간 밖 이력을 빠짐없이 읽었는지).
const all=kind=>rt.sql.prepare('SELECT data FROM records WHERE owner=? AND kind=? ORDER BY rowid').all(O,kind).map(x=>JSON.parse(x.data));
const full={artifacts:all('artifact'),decisions:all('review_decision'),usage:all('provider_usage'),meetings:all('team_meeting'),gradings:all('grading'),jobs:rt.sql.prepare('SELECT id,role,provider_id FROM jobs WHERE owner=?').all(O).map(x=>({...x}))};
check('console summary equals the pure summary over all owner records',JSON.stringify(body.summary)===JSON.stringify(plain(qc.consoleSummary(full,{from:body.period.from,to:body.period.to}))));
r=await get('?campaignId=c1',as(O));body=await r.json();
check('campaign scope keeps the same owner records',r.status===200&&body.campaignId==='c1'&&body.read.artifacts===5);
r=await get('?campaignId=c9',as(O));
check('another owner campaign is a 404',r.status===404);
r=await get('?campaignId=bad%20id',as(O));
check('malformed campaign id is a 400',r.status===400);
r=await get('',as(X));body=await r.json();
check('another owner sees only their own records',r.status===200&&body.read.artifacts===1&&body.read.decisions===1&&body.read.usage===1&&body.read.meetings===1&&body.read.jobs===1);
for(const q of ['?from=2026-02-30','?from=2026-09-10&to=2026-09-01','?from=2026-01-01&to=2026-09-24','?format=csv','?week=2025-W53','?week=39','?format=digest&week=2026-W54','?format=digest&week=2026-W00'])check('invalid query is a 400: '+q,(await get(q,as(O))).status===400);
r=await get('?from='+qs.addDays(qs.kstToday(now),-179),as(O));
check('a 180-day period is accepted',r.status===200&&(await r.json()).period.days===180);

// 5) 주간 묶음 JSON·다이제스트: 스크립트 입력 호환, 마크다운 첨부, 파일명, 기본 주(지난주)
const week=qc.isoWeekOf(ago(2));
r=await get('?week='+week,as(O));const payload=await r.json();
check('week JSON is the weekly payload the local script reads',r.status===200&&payload.week===week&&['summary','previous','kappa'].every(k=>k in payload)&&Array.isArray(payload.kappa));
const expected=plain(qd.weeklyPayload(full,week));
check('weekly payload equals the pure weekly payload over all owner records',JSON.stringify({week:payload.week,summary:payload.summary,previous:payload.previous,kappa:payload.kappa})===JSON.stringify(expected));
r=await get('?format=digest&week='+week,as(O));const md=await r.text();
check('digest is a markdown attachment',r.status===200&&r.headers.get('content-type')==='text/markdown; charset=utf-8'&&r.headers.get('content-disposition')===`attachment; filename="${qd.digestFileName(week)}"`&&r.headers.get('cache-control')==='no-store');
check('digest markdown is the same the local script prints for the week JSON',md===qd.digestMarkdown({week,summary:payload.summary,previous:payload.previous,kappa:payload.kappa,campaignId:payload.campaignId??null,partial:payload.partial??null})&&md.includes('자동 판정 아님'));
// 운영 실행: 소유자가 받은 주간 JSON을 로컬 스크립트에 넣으면 API 마크다운과 같은 내용을 표준 출력에 낸다(네트워크 없음).
const dir=mkdtempSync(join(tmpdir(),'quality-console-route-'));
try{const file=join(dir,'week.json');writeFileSync(file,JSON.stringify(payload));const run=spawnSync(process.execPath,['scripts/quality-digest.mjs',file],{encoding:'utf8',timeout:60000});check('the local script prints the API digest from the saved week JSON',run.status===0&&run.stdout===md)}finally{rmSync(dir,{recursive:true,force:true})}
r=await get('?format=digest',as(O));
check('digest defaults to last full week',r.status===200&&r.headers.get('content-disposition').includes(qs.lastFullWeek(now)));
r=await get('?format=digest&week='+week+'&campaignId=c1',as(O));
check('campaign digest names the campaign in the file name',r.status===200&&r.headers.get('content-disposition').includes(`${week}-c1.md`));
r=await get('?format=digest&campaignId=c9',as(O));
check('another owner campaign digest is a 404',r.status===404);

const recordsAfter=rt.sql.prepare('SELECT COUNT(*) n, MAX(updated_at) m FROM records').get();
check('reading the console writes nothing',recordsAfter.n===recordsBefore.n&&recordsAfter.m===recordsBefore.m&&rt.sql.prepare('SELECT COUNT(*) n FROM mutation_locks').get().n===0);

// 5-1) 기간 밖 이력 프로브(B2 리뷰): 전체 레코드를 넣은 순수 집계와 같은 숫자여야 한다.
const fullOf=owner=>{const rows=kind=>rt.sql.prepare('SELECT data FROM records WHERE owner=? AND kind=? ORDER BY rowid').all(owner,kind).map(x=>JSON.parse(x.data));return {artifacts:rows('artifact'),history:rows('history'),decisions:rows('review_decision'),usage:rows('provider_usage'),meetings:rows('team_meeting'),gradings:rows('grading'),jobs:rt.sql.prepare('SELECT id,role,provider_id FROM jobs WHERE owner=?').all(owner).map(x=>({...x}))}};
const PR='qc-probe';
await put(PR,'campaign','c1',{id:'c1',brandId:'oda',title:'프로브',goal:'평일 방문',version:1,status:'review'});
// 40일 전 AI 실행 → 기간 안에 사람 수정(판정 없음, aiSource 없음). 기간 전에 만들고 실행했지만 기간 안에 채점·규제 보류된 작업물.
await put(PR,'artifact','e1',art('e1',{origin:'ai_edited',version:2,skillVersion:null,createdAt:ago(2)}),'c1');await usage(PR,'r-e1',{jobId:'je1',artifactId:'e1',model:'model-edited',observedAt:ago(40)});
await put(PR,'artifact','g9',art('g9',{createdAt:ago(50)}),'c1');await usage(PR,'r-g9',{jobId:'jg9',artifactId:'g9',model:'model-graded',observedAt:ago(50)});await grading(PR,'g9:1','g9','graded','c1','jg9');
await put(PR,'artifact','k9',art('k9',{createdAt:ago(50),complianceHold:{version:'c1',block:1,issues:[],checkedAt:ago(2),notice:'n'}}),'c1');await usage(PR,'r-k9',{jobId:'jk9',artifactId:'k9',model:'model-held',observedAt:ago(50)});
// 40일 전 회의 개선본(역할 작업물 id를 재사용한 2판)을 기간 안에 승인: 보고 모델은 그 회의 사용량이다.
await meeting(PR,'m1','completed','c1',ago(40));await usage(PR,'r-m1',{kind:'meeting',jobId:`${PR}:meeting:m1`,artifactId:null,role:'strategy',model:'gpt-x',observedAt:ago(40)});
await put(PR,'artifact','ai-s1',art('ai-s1',{role:'strategy',version:2,meetingId:'m1',createdAt:ago(40)}),'c1');decision(PR,'dp1','ai-s1','approved',ago(2),{role:'strategy',version:2});
r=await get('',as(PR));body=await r.json();
check('usage before the period of artifacts edited, graded or held in the period gives their reported model',r.status===200&&['model-edited','model-graded','model-held'].every(m=>body.summary.rows.some(row=>row.reportedModel===m))&&!body.summary.rows.some(row=>row.reportedModel===null));
check('an edited artifact without aiSource keeps the skill version of its earlier run',body.summary.rows.some(row=>row.reportedModel==='model-edited'&&row.skillVersion==='sv1'&&row.artifacts===1));
check('a meeting version judged in the period takes the model of its earlier meeting',body.summary.rows.some(row=>row.role==='strategy'&&row.reportedModel==='gpt-x'&&row.n===1&&row.approvedFirst===1));
check('probe: console summary equals the pure summary over all owner records',JSON.stringify(body.summary)===JSON.stringify(plain(qc.consoleSummary(fullOf(PR),{from:body.period.from,to:body.period.to}))));

// 5-2) 지난 주 수치는 나중에 바뀌지 않는다: 그 주에 A2 보류된 AI 작업물을 이번 주에 사람이 고쳐 저장해도(이전 판은 kind 'history'에만 남는다) 그 주 보류·AI 작업물은 그대로다.
const H='qc-hist',LW=qs.lastFullWeek(now),inLW=new Date(Date.parse(qc.weekRange(LW).from)+DAY).toISOString();
await put(H,'campaign','c1',{id:'c1',brandId:'oda',title:'이력',goal:'평일 방문',version:1,status:'review'});
const hv1=art('h1',{createdAt:inLW,complianceHold:{version:'c1',block:1,issues:[],checkedAt:inLW,notice:'n'}});
await put(H,'artifact','h1',hv1,'c1');await usage(H,'r-h1',{jobId:'jh1',artifactId:'h1',observedAt:inLW});
const heldBefore=await (await get('?week='+LW,as(H))).json();
// app/api/action/route.ts save_artifact와 같다: 이전 판을 이력으로 남기고 같은 id에 사람 수정본(ai_edited 2판)을 쓴다.
await put(H,'history','hx1',{...hv1,id:'hx1',originalId:'h1'},'c1');
await put(H,'artifact','h1',art('h1',{origin:'ai_edited',version:2,skillVersion:undefined,aiSource:{id:'h1',version:1,skillVersion:'sv1',outputContractVersion:null},createdAt:new Date(now).toISOString()}),'c1');
const heldAfter=await (await get('?week='+LW,as(H))).json();
check('last week hold and AI artifact stay after a human saves a new version this week',heldBefore.summary.totals.holds===1&&heldBefore.summary.totals.artifacts===1&&heldAfter.summary.totals.holds===1&&heldAfter.summary.totals.artifacts===1);
check('history: the weekly payload equals the pure weekly payload over all owner records',JSON.stringify({week:heldAfter.week,summary:heldAfter.summary,previous:heldAfter.previous,kappa:heldAfter.kappa})===JSON.stringify(plain(qd.weeklyPayload(fullOf(H),LW))));
check('history records are read with aggregate fields only',(await qs.readConsoleRecords(H,qs.consolePeriod(P(''),now),null)).input.history.every(h=>!('content' in h)&&!('issues' in (h.complianceHold||{}))));

// 6) 행 상한: 종류별 MAX_ROWS를 넘으면 최근 행만 집계하고 partial에 종류를 남긴다(D1 바인드 수는 쿼리마다 고정).
const B='qc-bulk',insert=rt.sql.prepare('INSERT INTO records(id,owner,kind,parent_id,data,updated_at) VALUES(?,?,?,?,?,?)');
rt.sql.exec('BEGIN');for(let i=0;i<=qs.MAX_ROWS;i++){const at=new Date(now-DAY-i*1000).toISOString();insert.run(`${B}:provider_usage:hermes:b${i}`,B,'provider_usage','',JSON.stringify({id:'hermes:b'+i,provider:'hermes',providerRunId:'b'+i,model:null,inputTokens:1,outputTokens:1,totalTokens:2,status:'completed',observedAt:at,domainOutcome:'completed',kind:'brief'}),at)}rt.sql.exec('COMMIT');
r=await get('',as(B));body=await r.json();
check('over the row limit the response is marked partial',r.status===200&&JSON.stringify(body.partial)===JSON.stringify({kinds:['usage'],limit:qs.MAX_ROWS})&&body.read.usage===qs.MAX_ROWS);
r=await get('?format=digest&week='+qc.isoWeekOf(ago(1)),as(B));
check('a partial digest says so',r.status===200&&(await r.text()).includes('일부만 집계'));
// κ 라벨도 상한 안에서만 읽는다(B1 criterionUnits는 소유자의 판정 전체를 읽는다). 넘으면 partial에 'decisions'(콘솔)·'units'(주간 누적 κ)를 남긴다.
const L='qc-labels';
rt.sql.exec('BEGIN');for(let i=0;i<=qs.MAX_ROWS;i++){const at=new Date(now-DAY-i*1000).toISOString(),id='l'+i;insert.run(`${L}:review_decision:${id}`,L,'review_decision','',JSON.stringify({id,targetKind:'artifact',targetId:'la'+i,version:1,role:'quality',decision:'approved',reasonCodes:[],actor:{id:'u1',role:'owner'},promptVersion:null,skillVersion:'sv1',outputContractVersion:null,campaignId:'c1',brandId:null,origin:'ai',criteria:[{criterion:'evidence',human:'pass',ai:i%2?'pass':'revise'}],reasonsVersion:'review-reasons-v1',createdAt:at}),at)}rt.sql.exec('COMMIT');
r=await get('',as(L));body=await r.json();
check('console kappa uses only the labels of the capped decision read and says so',r.status===200&&body.kappa.find(k=>k.criterion==='evidence').n===qs.MAX_ROWS&&body.read.units===qs.MAX_ROWS&&body.partial.kinds.includes('decisions'));
r=await get('?week='+qc.isoWeekOf(ago(1)),as(L));body=await r.json();
check('weekly cumulative kappa reads at most the row limit of labels and marks units partial',r.status===200&&body.kappa.find(k=>k.criterion==='evidence').n===qs.MAX_ROWS&&body.partial.kinds.includes('units'));
const binds=[];rt.env.DB.prepare=(p=>q=>{const s=p(q);const bind=s.bind.bind(s);s.bind=(...v)=>{binds.push(v.length);return bind(...v)};return s})(rt.env.DB.prepare);
await get('?campaignId=c1',as(O));await get('?week='+week+'&campaignId=c1',as(O));
check('every query binds far fewer than the D1 limit of 100 values',binds.length>0&&Math.max(...binds)<60);

// 7) 이메일 인증: 소유자·관리자 200, 직원 403, 비로그인 401, 다른 워크스페이스의 캠페인 404
Object.assign(rt.env,{AUTH_MODE:'email',AUTH_ORIGIN:'https://agency.test'});
const sha=v=>createHash('sha256').update(v).digest('hex');
const signIn=(id,role,createdAt,ws)=>{const token=sha(id);rt.sql.prepare('INSERT INTO auth_users(id,email,workspace_owner,role,status,created_at) VALUES(?,?,?,?,?,?)').run(id,id+'@test.invalid',ws,role,'active',createdAt);rt.sql.prepare('INSERT INTO auth_sessions VALUES(?,?,?,?)').run(sha(token),id,Date.now()+60000,Date.now());return {cookie:'__Host-collective_session='+token}};
const ownerS=signIn('qc-first','admin',1000,O),adminS=signIn('qc-admin','admin',2000,O),memberS=signIn('qc-member','member',500,O),strangerS=signIn('qc-stranger','admin',1000,X);
const [anon,owner,admin,member,memberDigest,memberWeek,stranger,strangerAll]=await Promise.all([get('',{}),get('',ownerS),get('',adminS),get('',memberS),get('?format=digest',memberS),get('?week='+week,memberS),get('?campaignId=c1',strangerS),get('',strangerS)]);
check('unauthenticated is a 401',anon.status===401);
check('workspace owner and admin read the console',owner.status===200&&admin.status===200&&(await owner.json()).read.artifacts===5);
check('member is a 403 for the console, the week JSON and the digest',member.status===403&&memberDigest.status===403&&memberWeek.status===403&&/소유자·관리자/.test((await member.json()).error));
check('another workspace gets 404 for this campaign and only its own records otherwise',stranger.status===404&&strangerAll.status===200&&(await strangerAll.json()).read.artifacts===1);
check('the route is GET only',!('POST' in route)&&!('PUT' in route)&&!('DELETE' in route));

// 8) 화면 연결: 소유자·관리자만 진입점, 패널 요소
const ws=readFileSync('app/workspace.tsx','utf8'),panelPath='app/quality-console-panel.tsx',panel=existsSync(panelPath)?readFileSync(panelPath,'utf8'):'';
check('workspace has one quality console entry for managers only',/import \{QualityConsolePanel\} from '\.\/quality-console-panel'/.test(ws)&&(ws.match(/<span>품질 콘솔<\/span>/g)||[]).length===1&&/\{canManage&&<SidebarMenuButton onClick=\{\(\)=>setQualityOpen\(true\)\}>/.test(ws)&&/\{canManage&&<QualityConsolePanel /.test(ws));
check('existing navigation labels are unchanged',['워크스페이스','바이럴 학습','캠페인','브랜드 아카이브','점포 마케팅','AI 팀','작업물','성과 분석','연결 및 설정'].every(label=>ws.includes(`'${label}'`)||ws.includes(`<span>${label}</span>`)));
check('panel reads the console API and offers the weekly digest',/\/api\/quality-console/.test(panel)&&/format=digest/.test(panel)&&/주간 다이제스트 받기/.test(panel));
check('panel shows small samples, uncalibrated and undefined kappa and partial aggregation',/표본 부족/.test(panel)&&/보정 불가/.test(panel)&&/정의 불가/.test(panel)&&/일부만 집계/.test(panel));
check('panel has loading, retry and empty states',/불러오는 중/.test(panel)&&/다시 시도/.test(panel)&&/집계할 기록이 없습니다/.test(panel));
check('panel queries the period shown in the date fields',/const shown=\{from:range\.from\|\|data\?\.period\.from\|\|'',to:range\.to\|\|data\?\.period\.to\|\|''/.test(panel)&&/new URLSearchParams\(Object\.entries\(shown\)/.test(panel)&&/value=\{shown\.from\}/.test(panel)&&/value=\{shown\.to\}/.test(panel));
check('panel downloads the digest for the campaign of the last applied query',/data\?\.campaignId\?\{campaignId:data\.campaignId\}/.test(panel)&&!/range\.campaignId\?\{campaignId:range\.campaignId\}/.test(panel));
check('panel labels show the metric definitions (AI artifacts include earlier versions, prompt version column)',panel.includes('AI 작업물(이전 버전 포함)')&&panel.includes('프롬프트 버전'));
check('no provider call was made',fetchCalls===0);
console.log(JSON.stringify({passed},null,1));
