// 같은 저울 재채점(regrade_run): 끝난 평가 run의 저장 출력(eval_output)을 지금 코드의 채점기·규제 가드레일·예방 판정·정규화로 다시 채점한다.
// 원래 results는 그대로 두고 eval_run.regrades에 덧붙인다. ?run=<id>&regrade=latest 조회, ?compare=a,b&regrade=1 재채점 비교, 권한·상태 거부.
// 근거: mocked(합성 케이스·run·출력, 메모리 SQLite). fetch 스텁은 모든 호출을 기록하고 실패시킨다 — 모델·HERMES 호출 0회, 토큰 사용 0.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {testRuntime} from './helpers/runtime.mjs';

const calls=[],hooks={};
const {sql,env,load}=testRuntime(async url=>{calls.push(String(url));throw new Error('재채점은 네트워크를 쓰지 않습니다: '+url)},hooks);
const server=await load('lib/server.ts'),route=await load('app/api/eval/route.ts'),evalServer=await load('lib/eval-server.ts');
const {runGraders,runPreventionGraders,GRADERS,GRADERS_VERSION}=await load('lib/graders/index.ts'),{bodyOf,rawNormalization}=await load('lib/graders/text.ts');
const {checkCompliance,COMPLIANCE_LEXICON}=await load('lib/graders/compliance.ts'),{roleOutputContract}=await load('lib/role-output.ts'),{compareRuns}=await load('lib/eval-stats.ts');
const owner='regrade-owner',other='regrade-other',passed=[];
const check=(name,fn)=>{fn();passed.push(name)};
// vm 컨텍스트가 만든 값은 프로토타입이 달라 deepStrictEqual 전에 평범한 값으로 바꾼다.
const plain=x=>JSON.parse(JSON.stringify(x));
const call=async res=>({status:res.status,body:await res.json()});
const post=(input,user=owner,extra={})=>route.POST(new Request('https://agency.test/api/eval',{method:'POST',headers:{'oai-authenticated-user-id':user,'content-type':'application/json',...extra},body:JSON.stringify(input)})).then(call);
const get=(query='',user=owner,extra={})=>route.GET(new Request('https://agency.test/api/eval'+query,{headers:{'oai-authenticated-user-id':user,...extra}})).then(call);
const put=(kind,id,data,parent='')=>server.recordStatement(owner,kind,id,data,parent).run();
const stored=(kind,id)=>JSON.parse(sql.prepare('SELECT data FROM records WHERE id=?').get(`${owner}:${kind}:${id}`).data);

// 합성 케이스·출력. 실제 고객·매장·모델 출력이 아니다. 시각은 고정 문자열이다(계산하지 않는다).
const caseAt='2026-09-20T00:00:00.000Z',runAt='2026-09-21T00:00:00.000Z',by={id:owner,email:null};
const facts={confirmed:[{key:'주소',value:'가상동 12'}],prohibited:[{key:'조리 방식',value:'숯불'}]};
const kase=(id,role,expectations)=>({id,role,label:`${role} 합성 케이스`,set:'dev',request:{},expectations,campaignId:null,source:'manual',capturedWith:{skillVersion:'test',outputContractVersion:'role-output-v1'},createdBy:by,createdAt:caseAt,updatedAt:caseAt});
const A=kase('case-a','cmo',{prohibitedTerms:['숯불'],facts,industry:'fnb',localStore:true}),B=kase('case-b','insight',{prohibitedTerms:[],facts,industry:'fnb',localStore:true});
await put('eval_case',A.id,A);await put('eval_case',B.id,B);
const CLEAN='자료 필요: 실제 운영 조건을 확인한 뒤 실행합니다. 현재 초안은 가설이며 담당자가 POS 기록과 현장 관찰로 검증합니다.';
// 실제 결함이 든 출력: # 제목(정규화·예방 판정), 입력 경로 노출, 근거 없는 '판매 1위' 카피, 가격 없는 구매 버튼, 보상 조건 체험단 후기.
const VIOLATING='# 캠페인 계획\n캠페인 목표(campaign.goal)는 campaign.goal 기준입니다.\n\n### 게시 카피\n“판매 1위 가상분식 떡볶이, 오늘 바로 주문하기”\n\n### 체험단 운영\n체험단 20명을 모집해 후기를 올려 주시면 쿠폰을 드립니다.';
const raw=(role,first)=>JSON.stringify({contractVersion:'role-output-v1',role,sections:roleOutputContract(role).sections.map((s,i)=>({id:s.id,content:i===0&&first?first:`${s.title}\n${CLEAN}`}))});
// 원래 결과는 옛 저울로 잰 값처럼 모두 pass·가드레일 0건이다. 재채점은 이것과 달라야 한다.
const ids=GRADERS.map(g=>g.id);
const stale=(c,variant='active',status='completed')=>({caseId:c.id,label:c.label,set:c.set,role:c.role,variant,status,providerRunId:'eval_synthetic',model:'mock-eval-model',tokens:{input:1000,output:500,total:1500},submittedAt:runAt,completedAt:runAt,durationMs:10,...(status==='completed'?{gradersVersion:'failure-types-v1',graders:ids.map(id=>({id,status:'pass'})),summary:{pass:ids.length,fail:0,not_applicable:0,grader_error:0},prevention:[],compliance:{version:'compliance-lexicon-old',block:0,warn:0,info:0,issues:[]}}:{error:'합성 실패'})});
const putRun=(id,results,extra={})=>put('eval_run',id,{id,label:'합성 재채점 대상',variant:'active',set:'dev',caseIds:[...new Set(results.map(r=>r.caseId))],tokenBudget:100000,usedTokens:1500*results.length,status:'completed',host:'eval-hermes.example.com',createdBy:by,createdAt:runAt,updatedAt:runAt,results,...extra});
const putOutput=(runId,c,output,variant)=>put('eval_output',variant?`${runId}:${c.id}:${variant}`:`${runId}:${c.id}`,{runId,caseId:c.id,role:c.role,...(variant?{variant}:{}),providerRunId:'eval_synthetic',model:'mock-eval-model',output,compliance:{},createdAt:runAt},runId);
const outA=raw('cmo',VIOLATING),outB=raw('insight'),outAclean=raw('cmo');
await putRun('run-a',[stale(A),stale(B),stale({...B,id:'case-c'},'active','failed')]);await putOutput('run-a',A,outA);await putOutput('run-a',B,outB);
await putRun('run-b',[stale(A),stale(B)]);await putOutput('run-b',A,outAclean);await putOutput('run-b',B,outB);

// 기대값: 같은 모듈의 채점기·가드레일로 직접 채점한 값(서버 저장 규칙: 상세 200자, 가드레일은 발췌 없이 등급·규칙만).
function expected(c,output,inputTokens=1000){
 const e=c.expectations,item={id:c.id,kind:'role',role:c.role,raw:output,contract:true,inputTokens},ctx={prohibitedTerms:e.prohibitedTerms,facts:e.facts,industry:e.industry,localStore:e.localStore};
 const row=g=>({id:g.id,status:g.status,...(g.detail?{detail:g.detail.slice(0,200)}:{})}),rows=plain(runGraders(item,ctx)).map(row),report=plain(checkCompliance(bodyOf(item),{facts:e.facts}));
 const n=s=>report.issues.filter(i=>i.severity===s).length,count=s=>rows.filter(g=>g.status===s).length;
 return {summary:{pass:count('pass'),fail:count('fail'),not_applicable:count('not_applicable'),grader_error:count('grader_error')},graders:rows.map(({id,status})=>({id,status})),fails:rows.filter(g=>g.status==='fail').map(({id,detail})=>detail?{id,detail}:{id}),
  prevention:plain(runPreventionGraders(item,ctx)).map(row),normalization:plain(rawNormalization(item)),compliance:{block:n('block'),warn:n('warn'),info:n('info'),issues:report.issues.map(({category,ruleId,severity})=>({category,ruleId,severity}))}};
}
const graded=entry=>({summary:entry.summary,graders:entry.graders,fails:entry.fails,prevention:entry.prevention,normalization:entry.normalization,compliance:entry.compliance});
const expA=expected(A,outA),expB=expected(B,outB),expAclean=expected(A,outAclean);
check('the synthetic violating output really fails graders, guardrails and prevention today',()=>assert.ok(expA.fails.some(f=>f.id==='unsupported_claim_term')&&expA.compliance.block>0&&expA.prevention.some(g=>g.status==='fail')&&expA.normalization.headings>0));
check('the clean output passes the claim grader',()=>assert.ok(expAclean.graders.find(g=>g.id==='unsupported_claim_term').status==='pass'));

const recordsBefore=sql.prepare("SELECT kind,COUNT(*) n FROM records GROUP BY kind ORDER BY kind").all().map(plain),outputsBefore=sql.prepare("SELECT id,data FROM records WHERE kind='eval_output' ORDER BY id").all().map(plain);
const runBefore=stored('eval_run','run-a'),usageBefore=(await get()).body.usage;

// A) 재채점: 원래 completed인 케이스만, 저장 출력으로 지금 채점기를 다시 돌린다.
let r=await post({action:'regrade_run',id:'run-a'});
check('regrade_run answers 200 for a finished run',()=>assert.equal(r.status,200,JSON.stringify(r.body)));
const first=r.body;
check('regrade names the run and the current grader and dictionary versions',()=>assert.ok(first.runId==='run-a'&&typeof first.id==='string'&&first.gradersVersion===GRADERS_VERSION&&first.complianceVersion===COMPLIANCE_LEXICON.version&&first.by.id===owner&&!Number.isNaN(Date.parse(first.at))));
// 측정 v2는 채점 판정을 바꿨으므로 채점 버전도 바뀌어야 같은 저울 검사·비교가 저울 변경을 구분한다.
check('the measure-v2 graders carry a new grading version',()=>assert.ok(GRADERS_VERSION!=='failure-types-v1+normalized'&&GRADERS_VERSION!=='failure-types-v1'&&first.original.gradersVersions[0]!==first.gradersVersion));
check('only completed cases are regraded (a failed case has no output)',()=>assert.deepEqual(first.cases.map(c=>[c.caseId,c.label,c.role,c.variant]),[[A.id,A.label,'cmo','active'],[B.id,B.label,'insight','active']]));
check('nothing completed was skipped',()=>assert.deepEqual(first.skipped,[]));
check('case A regrade matches the current graders, prevention, normalization and guardrails',()=>assert.deepEqual(graded(first.cases[0]),expA));
check('case B regrade matches the current graders',()=>assert.deepEqual(graded(first.cases[1]),expB));
check('cases unchanged since the run carry no update flag',()=>assert.ok(first.cases.every(c=>!('caseUpdatedAfterRun' in c))));
const sum=(list,f)=>list.reduce((a,x)=>a+f(x),0);
check('run totals add up the regraded cases',()=>assert.deepEqual(first.totals,{cases:2,pass:sum([expA,expB],e=>e.summary.pass),fail:sum([expA,expB],e=>e.summary.fail),not_applicable:sum([expA,expB],e=>e.summary.not_applicable),grader_error:sum([expA,expB],e=>e.summary.grader_error),preventionFail:sum([expA,expB],e=>e.prevention.filter(g=>g.status==='fail').length),block:expA.compliance.block+expB.compliance.block,warn:expA.compliance.warn+expB.compliance.warn,info:expA.compliance.info+expB.compliance.info,
 failsByGrader:[...expA.fails,...expB.fails].reduce((acc,f)=>({...acc,[f.id]:(acc[f.id]||0)+1}),{}),issuesByRule:[...expA.compliance.issues,...expB.compliance.issues].reduce((acc,i)=>({...acc,[i.ruleId]:(acc[i.ruleId]||0)+1}),{})}));
check('the original totals of the same cases are reported beside the regrade',()=>assert.deepEqual(first.original,{gradersVersions:['failure-types-v1'],complianceVersions:['compliance-lexicon-old'],totals:{cases:2,pass:2*ids.length,fail:0,not_applicable:0,grader_error:0,preventionFail:0,block:0,warn:0,info:0,failsByGrader:{},issuesByRule:{}}}));

// B) 원래 결과·출력·예산은 그대로다. 호출 0, 토큰 0.
const runAfter=stored('eval_run','run-a'),{regrades,...rest}=runAfter;
check('original results and every other run field are unchanged',()=>assert.deepEqual(rest,runBefore));
check('the regrade is appended to the run record',()=>assert.ok(regrades.length===1&&regrades[0].id===first.id));
check('stored outputs are unchanged and no record kind grows',()=>{assert.deepEqual(sql.prepare("SELECT id,data FROM records WHERE kind='eval_output' ORDER BY id").all().map(plain),outputsBefore);assert.deepEqual(sql.prepare("SELECT kind,COUNT(*) n FROM records GROUP BY kind ORDER BY kind").all().map(plain),recordsBefore)});
const usageAfter=(await get()).body.usage;
check('monthly eval usage is unchanged by a regrade',()=>assert.deepEqual(usageAfter,usageBefore));
check('no model, HERMES or other network call',()=>assert.deepEqual(calls,[]));

// C) 조회: ?run=<id>&regrade=latest
r=await get('?run=run-a&regrade=latest');
check('latest regrade is readable by the owner',()=>assert.ok(r.status===200&&JSON.stringify(r.body)===JSON.stringify(first)));
r=await get('?run=run-a');
check('the plain run read still returns the original results',()=>assert.deepEqual(r.body.results,runBefore.results));
r=await get('?run=run-b&regrade=latest');
check('a run without a regrade answers 404 with guidance',()=>assert.ok(r.status===404&&/regrade_run/.test(r.body.error)));
r=await get('?run=run-a&regrade=oldest');
check('an unknown regrade selector is 400',()=>assert.equal(r.status,400));
r=await get('?run=run-a&regrade=latest',other);
check('another owner cannot read a regrade (404)',()=>assert.equal(r.status,404));

// D) 비교: compare는 원래 결과 기준 그대로, &regrade=1이면 두 run의 최신 재채점 결과로 같은 비교 통계를 낸다.
const original=await get('?compare=run-a,run-b');
check('plain compare keeps the original results (no discordant claim pair)',()=>{const g=original.body.graders.find(x=>x.id==='unsupported_claim_term');assert.ok(original.status===200&&g.b===0&&g.c===0&&g.bothPass===2&&!('regrade' in original.body))});
r=await get('?compare=run-a,run-b&regrade=1');
check('regrade compare needs a regrade on both runs (409 with guidance)',()=>assert.ok(r.status===409&&/regrade_run/.test(r.body.error)&&r.body.error.includes('run-b')));
const second=(await post({action:'regrade_run',id:'run-b'})).body;
r=await get('?compare=run-a,run-b&regrade=1');
const outcomes=(run,g)=>({id:run,results:g.cases.map(c=>({caseId:c.caseId,status:'completed',gradersVersion:g.gradersVersion,graders:c.graders,prevention:c.prevention,normalization:c.normalization??null}))});
check('regrade compare equals the comparison statistics of the two latest regrades',()=>{const {regrade,...stats}=r.body;assert.ok(r.status===200);assert.deepEqual(stats,plain(compareRuns(outcomes('run-a',first),outcomes('run-b',second))));assert.deepEqual([regrade.baseline.id,regrade.candidate.id],[first.id,second.id])});
check('regrade compare sees the fixed claim (fail to pass) that the old scale missed',()=>{const g=r.body.graders.find(x=>x.id==='unsupported_claim_term');assert.ok(g.c===1&&g.b===0&&r.body.gradersVersions.baseline[0]===GRADERS_VERSION)});
check('regrade compare reports both sides guardrail totals and versions',()=>assert.ok(r.body.regrade.baseline.totals.block===first.totals.block&&r.body.regrade.candidate.totals.block===second.totals.block&&r.body.regrade.baseline.complianceVersion===COMPLIANCE_LEXICON.version));
r=await get('?compare=run-a,run-b&regrade=2');
check('an unknown compare regrade selector is 400',()=>assert.equal(r.status,400));
// 두 쪽 재채점의 채점기·사전 버전이 다르면 같은 저울이 아니다.
sql.prepare("UPDATE records SET data=json_set(data,'$.regrades[0].gradersVersion','failure-types-v0') WHERE id=?").run(`${owner}:eval_run:run-b`);
r=await get('?compare=run-a,run-b&regrade=1');
check('regrades from different grader versions are not compared (409)',()=>assert.ok(r.status===409&&/버전/.test(r.body.error)));
await post({action:'regrade_run',id:'run-b'});
r=await get('?compare=run-a,run-b&regrade=1');
check('regrading again restores a same-scale comparison',()=>assert.equal(r.status,200));

// E) 기록 보존: 최근 EVAL_REGRADE_KEEP개만, 케이스별 상세는 최신 1개에만 둔다(run 행 크기 제한).
const keep=evalServer.EVAL_REGRADE_KEEP;
let last;for(let i=0;i<keep+1;i++)last=(await post({action:'regrade_run',id:'run-a'})).body;
const history=stored('eval_run','run-a').regrades;
check('regrade history keeps only the most recent entries',()=>assert.ok(keep>=2&&history.length===keep&&history[keep-1].id===last.id&&!history.some(g=>g.id===first.id)));
check('only the latest regrade keeps per-case detail; older ones keep versions and totals',()=>assert.ok(history.slice(0,-1).every(g=>!('cases' in g)&&!('skipped' in g)&&g.totals.cases===2&&g.gradersVersion===GRADERS_VERSION)&&history[keep-1].cases.length===2));
r=await get('?run=run-a&regrade=latest');
check('latest read follows the newest regrade',()=>assert.equal(r.body.id,last.id));

// F) 쌍 평가 run: 두 쪽 출력을 각각 다시 채점한다. 쌍 평가는 compare 대상이 아니다(기존 규칙).
await putRun('run-pair',[stale(A,'active'),stale(A,'candidate')],{variant:'pair',pair:{unit:'role:cmo',candidateVersionId:'v-candidate',activeVersionId:null,skippedCases:0}});
await putOutput('run-pair',A,outA,'active');await putOutput('run-pair',A,outAclean,'candidate');
r=await post({action:'regrade_run',id:'run-pair'});
check('a pair run regrades both variants from their own outputs',()=>{assert.equal(r.status,200);assert.deepEqual(r.body.cases.map(c=>c.variant),['active','candidate']);assert.deepEqual(graded(r.body.cases[0]),expA);assert.deepEqual(graded(r.body.cases[1]),expAclean)});
r=await get('?compare=run-a,run-pair&regrade=1');
check('pair runs stay out of compare, with or without regrade (400)',()=>assert.equal(r.status,400));

// G) 재채점할 수 없는 케이스: 출력 없음·케이스 삭제는 이유와 함께 skipped. 끝난 cancelled run도 completed 케이스를 재채점한다.
const D=kase('case-d','cmo',A.expectations);
await putRun('run-missing',[stale(A),stale(D)],{status:'cancelled'});await putOutput('run-missing',D,outA);
r=await post({action:'regrade_run',id:'run-missing'});
check('missing outputs and deleted cases are skipped with a reason, not graded',()=>assert.ok(r.status===200&&r.body.cases.length===0&&r.body.totals.cases===0&&r.body.skipped.length===2&&/출력/.test(r.body.skipped.find(s=>s.caseId===A.id).reason)&&/삭제/.test(r.body.skipped.find(s=>s.caseId===D.id).reason)));
// 케이스의 기대 판정을 run 뒤에 고쳤으면(원래 채점과 기대 판정이 달랐을 수 있음) 표시한다. 이름만 바꾸면 표시하지 않는다.
await post({action:'update_case',id:B.id,label:'insight 합성 케이스 v2'});
r=await post({action:'regrade_run',id:'run-a'});
check('renaming a case after the run does not flag it',()=>assert.ok(r.status===200&&r.body.cases.every(c=>!('caseUpdatedAfterRun' in c))));
await post({action:'update_case',id:B.id,expectations:{...B.expectations,prohibitedTerms:['숯불']}});
r=await post({action:'regrade_run',id:'run-a'});
check('a case whose expectations changed after the run is flagged in the regrade',()=>assert.ok(r.body.cases.find(c=>c.caseId===B.id).caseUpdatedAfterRun===true&&!('caseUpdatedAfterRun' in r.body.cases.find(c=>c.caseId===A.id))));
await post({action:'update_case',id:B.id,label:'insight 합성 케이스 v3'});
r=await post({action:'regrade_run',id:'run-a'});
check('a later rename keeps the expectations-change flag',()=>assert.equal(r.body.cases.find(c=>c.caseId===B.id).caseUpdatedAfterRun,true));
// 재채점 중에 run이 바뀌면(삭제가 먼저 끝나면) 덮어쓰지 않는다. 삭제 tombstone이 이전 결과로 되살아나지 않는다(compare-and-set).
await putRun('run-race',[stale(A)]);await putOutput('run-race',A,outA);
const raceTomb={...stored('eval_run','run-race'),results:[],deleted:{by,at:runAt,cases:1}};
hooks.beforeRun=stmt=>{if(stmt.values.includes(`${owner}:eval_run:run-race`)&&/records/.test(stmt.query)){hooks.beforeRun=undefined;sql.prepare('UPDATE records SET data=? WHERE id=?').run(JSON.stringify(raceTomb),`${owner}:eval_run:run-race`)}};
r=await post({action:'regrade_run',id:'run-race'});
hooks.beforeRun=undefined;
check('a run deleted while it was being regraded is not resurrected (409)',()=>{const row=stored('eval_run','run-race');assert.ok(r.status===409&&/다시/.test(r.body.error)&&row.deleted&&row.results.length===0&&!('regrades' in row),JSON.stringify(r.body))});

// H) 거부: 진행 중 409, 삭제 409, 다른 소유자 404, 없는 run 404, id 누락 400. 거부는 아무것도 기록하지 않는다.
await putRun('run-active',[stale(A,'active','pending')],{status:'running'});await putRun('run-queued',[stale(A,'active','pending')],{status:'queued'});
for(const id of ['run-active','run-queued']){const res=await post({action:'regrade_run',id});check(`a ${id.slice(4)} run is 409`,()=>assert.ok(res.status===409&&!('regrades' in stored('eval_run',id))))}
r=await post({action:'delete_run',id:'run-b'});
const tomb=stored('eval_run','run-b');
check('deleting a run also drops its regrade detail',()=>assert.ok(r.status===200&&tomb.deleted&&tomb.results.length===0&&tomb.regrades.length===0));
r=await post({action:'regrade_run',id:'run-b'});
check('a deleted run cannot be regraded (409)',()=>assert.equal(r.status,409));
r=await get('?run=run-b&regrade=latest');
check('a deleted run has no regrade to read (409)',()=>assert.equal(r.status,409));
r=await get('?compare=run-a,run-b&regrade=1');
check('a deleted run cannot be regrade-compared (409)',()=>assert.equal(r.status,409));
r=await post({action:'regrade_run',id:'run-a'},other);
check('another owner cannot regrade (404)',()=>assert.equal(r.status,404));
r=await post({action:'regrade_run',id:'no-such-run'});
check('an unknown run is 404',()=>assert.equal(r.status,404));
r=await post({action:'regrade_run'});
check('a missing run id is 400',()=>assert.equal(r.status,400));

// I) 권한: owner만. 비로그인 401, 관리자·직원 403, 다른 워크스페이스 소유자 404.
env.AUTH_MODE='email';env.AUTH_ORIGIN='https://agency.test';
const signIn=(id,role,createdAt,ws)=>{const token=createHash('sha256').update(id).digest('hex');sql.prepare('INSERT INTO auth_users(id,email,workspace_owner,role,status,created_at) VALUES(?,?,?,?,?,?)').run(id,id+'@test.invalid',ws,role,'active',createdAt);sql.prepare('INSERT INTO auth_sessions VALUES(?,?,?,?)').run(createHash('sha256').update(token).digest('hex'),id,Date.now()+60000,Date.now());return {cookie:'__Host-collective_session='+token,origin:'https://agency.test'}};
const ownerS=signIn('rg-owner','admin',1000,owner),adminS=signIn('rg-admin','admin',2000,owner),memberS=signIn('rg-member','member',500,owner),strangerS=signIn('rg-stranger','admin',1000,'other-workspace');
const regrade={action:'regrade_run',id:'run-a'};
const [anonPost,anonGet,adminPost,memberPost,adminGet,memberGet,ownerPost,ownerGet,strangerPost,strangerGet]=await Promise.all([
 post(regrade,owner,{origin:'https://agency.test'}),get('?run=run-a&regrade=latest',owner,{origin:'https://agency.test'}),
 post(regrade,owner,adminS),post(regrade,owner,memberS),get('?run=run-a&regrade=latest',owner,adminS),get('?run=run-a&regrade=latest',owner,memberS),
 post(regrade,owner,ownerS),get('?run=run-a&regrade=latest',owner,ownerS),post(regrade,owner,strangerS),get('?run=run-a&regrade=latest',owner,strangerS),
]);
check('unauthenticated regrade and read are 401',()=>assert.ok(anonPost.status===401&&anonGet.status===401));
check('admin and member are 403',()=>assert.ok(adminPost.status===403&&memberPost.status===403&&adminGet.status===403&&memberGet.status===403));
check('the workspace owner regrades and reads',()=>assert.ok(ownerPost.status===200&&ownerGet.status===200&&ownerPost.body.runId==='run-a'));
check('another workspace owner gets 404',()=>assert.ok(strangerPost.status===404&&strangerGet.status===404));
check('no external network call in the whole suite',()=>assert.deepEqual(calls,[]));
console.log(JSON.stringify({passed:passed.length}));
