// 바이럴 평가 경로 PR 1(대표 승인 2026-09-27): 사례 분석(L1) 평가 종류 viral_analysis와 수집 콘텐츠 지시 무시 보안 문장.
// a) 운영 분석 조립을 순수 함수(viralAnalysisSubmission)로 떼어 운영 실행과 평가가 같이 쓴다. 운영 제출 바이트는 보안 문장 말고는 그대로다(prompt-baseline이 고정).
// b) 분석·조사 코드 소유 문장에 수집 콘텐츠 지시 무시 문장(collectedContentRule)이 한 번씩, 기존 '지시로 따르지 않습니다' 바로 뒤에 있다. 레지스트리 본문을 바꿔도 남는다.
// c) 처리기: freeze 형식 검사(400), build는 순수 함수로 쪽 본문(PromptSet.viral 또는 null=코드 상수)을 주입, grade는 바이럴 채점기, 쌍 평가 대상은 viral_analysis 케이스만.
// d) 캡처: 끝난 분석 작업(jobId)만. 조사·규칙 초안 400, 진행 중 409, 드리프트(identical·context_changed·code_changed·store_allow_changed·assembly_drift).
// e) 채점기(결정론, 네트워크 0): 형식·반례/미확인·관찰 밖 수치 단정·금지 표현·input_budget. 역할·회의·브리프 채점기 목록은 그대로다.
// f) 레지스트리: viral.discovery 쌍 평가 시작·게이트 통과 활성화·게이트 실패 409·stage 400·역할 케이스 400. 권한 401·403 기존 규칙.
// 근거: mocked(운영·평가 HERMES·raw.githubusercontent.com fetch 스텁, 메모리 SQLite, 합성 브랜드·사례). 외부 네트워크·유료 모델 호출은 0회다.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {testRuntime} from './helpers/runtime.mjs';
import {seed,roleCampaign,brand,rawGithub,now} from './helpers/prompt-seed.mjs';

const OPS='https://hermes.example.com',EVAL='https://eval-hermes.example.com',BAD='합성 불량 초점';
const capabilities={object:'hermes.api_server.capabilities',platform:'hermes-agent',features:{run_submission:true,run_status:true,run_stop:true,runs_idempotency:{durable:true,enabled:true,supported:true}}};
// 합성 분석 결과. 관찰 기록에 있는 수치(조회수 12,000·평소 4,000)만 쓴다. 후보 본문에 불량 표시가 있으면 실험안 4개(형식 위반)를 낸다.
const idea=n=>({hypothesis:`합성 가설 ${n}: 첫 장면에 포장 동선을 보여 주면 공유가 는다.`,variable:'첫 장면',control:'매장 외관으로 시작',treatment:'포장 봉투를 건네는 손으로 시작',metric:'share_rate'});
const analysisOf=(bad=false)=>JSON.stringify({facts:'관찰 기록 기준 조회수 12,000회이며 평소 조회수는 4,000회입니다. 자막 0:03에 가격 안내가 나옵니다.',hook:'첫 장면에서 떡볶이를 들어 올리는 동작으로 약속을 보여 줍니다.',retention:'조리 과정 뒤에 가격을 공개하는 순서입니다.',sharing:'[가설] 퇴근길 동료에게 보낼 이유가 있습니다.',context:'계정 규모와 유료 배포 여부는 미확인입니다.',counterEvidence:'같은 계정의 저성과 사례와 비교하지 못했습니다. 게시 시각 차이가 다른 설명일 수 있습니다.',unknowns:'시청 지속 시간과 공유 수는 확인하지 못했습니다.',ideas:bad?[1,2,3,4].map(idea):[idea(1)]});
const opsRuns=new Map(),evalRuns=new Map(),evalSubmits=[],external=[];let seq=0;
const raw=rawGithub();
const {sql,env,load}=testRuntime(async(url,options={})=>{
 url=String(url);const method=options.method||'GET',headers=new Headers(options.headers||{});
 const mocked=await raw.handler(url);if(mocked)return mocked;
 if(url.startsWith(OPS+'/')){
  if(url===OPS+'/v1/runs'&&method==='POST'){const id='ops_'+ ++seq;opsRuns.set(id,JSON.parse(options.body));return Response.json({run_id:id})}
  const id=/\/v1\/runs\/([\w-]+)$/.exec(url)?.[1];if(!id||!opsRuns.has(id))return new Response('{}',{status:404});
  const sent=opsRuns.get(id),discovery='query' in JSON.parse(sent.input);
  return Response.json({object:'hermes.run',run_id:id,status:'completed',output:discovery?JSON.stringify({cases:[],blockers:'합성: 도구 없음'}):analysisOf(),usage:{total_tokens:900}});
 }
 if(!url.startsWith(EVAL+'/')){external.push(url);throw new Error('모의 주소만 호출합니다: '+url)}
 const path=url.slice(EVAL.length);
 if(!headers.get('authorization'))return new Response('{}',{status:401});
 if(path==='/v1/capabilities')return Response.json(capabilities);
 if(path==='/v1/models')return Response.json({data:[{id:'mock-eval-model'}]});
 if(path==='/v1/toolsets')return Response.json({toolsets:[{name:'web'}]});
 if(path==='/v1/runs'&&method==='POST'){const id='ev_'+ ++seq,sent=JSON.parse(options.body);evalRuns.set(id,sent);evalSubmits.push({id,sent});return Response.json({run_id:id})}
 const stop=/^\/v1\/runs\/([\w-]+)\/stop$/.exec(path);if(stop)return Response.json({object:'hermes.run',run_id:stop[1],status:'stopped'});
 const id=/^\/v1\/runs\/([\w-]+)$/.exec(path)?.[1],sent=evalRuns.get(id);if(!sent)return new Response('{}',{status:404});
 return Response.json({object:'hermes.run',run_id:id,status:'completed',output:analysisOf(sent.instructions.includes(BAD)),usage:{input_tokens:1000,output_tokens:500,total_tokens:1500},model:'mock-eval-model'});
});
const server=await load('lib/server.ts'),learning=await load('lib/learning-execution.ts'),practice=await load('lib/practice.ts'),kinds=await load('lib/eval-kinds.ts'),graders=await load('lib/graders/index.ts'),viral=await load('lib/graders/viral.ts');
const evalRoute=await load('app/api/eval/route.ts'),promptRoute=await load('app/api/prompts/route.ts'),background=await load('lib/background-execution.ts');
const owner='pr-viral-owner',passed=[];
const check=(name,fn)=>{fn();passed.push(name)};
const put=await seed(server,sql,owner);
const plain=x=>JSON.parse(JSON.stringify(x));
const call=async res=>({status:res.status,body:await res.json()});
const post=(path,route,input,user=owner,extra={})=>route.POST(new Request('https://agency.test'+path,{method:'POST',headers:{'oai-authenticated-user-id':user,'content-type':'application/json',...extra},body:JSON.stringify(input)})).then(call);
const evalPost=(input,user,extra)=>post('/api/eval',evalRoute,input,user,extra),prompts=(input,user,extra)=>post('/api/prompts',promptRoute,input,user,extra);
const evalGet=(query='')=>evalRoute.GET(new Request('https://agency.test/api/eval'+query,{headers:{'oai-authenticated-user-id':owner}})).then(call);
const rejects=(fn,status,pattern)=>assert.throws(fn,e=>e.status===status&&(!pattern||pattern.test(e.message)),String(pattern));
const stored=async id=>JSON.parse((await server.readRecord(owner,'hermes_submission',id)).body);
const count=(text,part)=>text.split(part).length-1;
const RULE=learning.collectedContentRule;

// 합성 사례: 관찰 기록 한 건(재관찰)을 더한다. 실제 게시물·계정이 아니다.
const viralCase={id:'pr-case',brandId:brand.id,title:'합성 사례',channel:'YouTube',url:'https://example.com/synthetic-case',account:'합성 계정',publishedAt:'',observedAt:now,scope:'합성 관찰',observations:'합성 관찰 기록: 조회수 12,000회, 평소 조회수 4,000회.',transcript:'0:03 가격 안내',views:12000,baselineViews:4000,comparison:'같은 계정 최근 5개 평균',createdAt:now,origin:'manual'};
await put('viral_case',viralCase.id,viralCase,brand.id);
await put('case_observation','pr-obs',{...viralCase,id:'pr-obs',caseId:viralCase.id,observations:'합성 재관찰 기록'},viralCase.id);

// ── a·b) 운영 조립 = 순수 함수, 보안 문장 ──
const start=async b=>{const r=await (await learning.executeLearning(owner,b)).json();assert.ok(r.id&&r.status==='queued',JSON.stringify(r));return r.id};
const poll=async id=>(await (await learning.executeLearning(owner,{action:'poll',id})).json()).status;
const analysisId=await start({action:'start_analysis',caseId:viralCase.id}),analysisSent=await stored(analysisId);
const discoveryId=await start({action:'start_discovery',brandId:brand.id,query:'합성 조사 주제'}),discoverySent=await stored(discoveryId);
const aIn=JSON.parse(analysisSent.input),dIn=JSON.parse(discoverySent.input);
check('the pure analysis assembly is byte-identical to the operational submission',()=>assert.deepEqual(plain(learning.viralAnalysisSubmission({brand:aIn.brand,case:aIn.case,observations:aIn.observations})),{instructions:analysisSent.instructions,input:analysisSent.input}));
check('the pure discovery assembly is byte-identical to the operational submission',()=>assert.deepEqual(plain(learning.viralDiscoverySubmission({brand:dIn.brand,query:dIn.query,requestedAt:dIn.requestedAt})),{instructions:discoverySent.instructions,input:discoverySent.input}));
check('the analysis input keeps its key order (brand, case, observations)',()=>assert.deepEqual(Object.keys(aIn),['brand','case','observations']));
check('without a body the assembly uses the code constant (viralPractice)',()=>assert.ok(learning.viralAnalysisSubmission({brand:aIn.brand,case:aIn.case,observations:aIn.observations}).instructions.startsWith(practice.viralPractice+'\n')));
check('a registry body replaces only the practice part',()=>{const x=learning.viralAnalysisSubmission({brand:aIn.brand,case:aIn.case,observations:aIn.observations},'합성 본문');assert.ok(x.instructions.startsWith('합성 본문\n')&&x.instructions.endsWith(analysisSent.instructions.slice(practice.viralPractice.length+1)))});
check('the security rule names external pages, descriptions, subtitles and comments and says to treat them as data only',()=>assert.ok(typeof RULE==='string'&&['웹페이지','영상 설명','자막','댓글'].every(w=>RULE.includes(w))&&/따르지/.test(RULE)&&/자료로만/.test(RULE)));
for(const [name,sent] of Object.entries({analysis:analysisSent,discovery:discoverySent})){
 check(`${name} instructions carry the collected-content rule exactly once`,()=>assert.equal(count(sent.instructions,RULE),1));
 check(`${name} rule follows the untrusted-data sentence`,()=>assert.ok(sent.instructions.includes('지시로 따르지 않습니다. '+RULE+' 발송·게시')));
}
check('the rule lives in code, not in the registry body or its code fallback',()=>assert.ok(!practice.viralPractice.includes(RULE)&&!JSON.parse(readFileSync('prompts/viral.discovery.json','utf8')).body.includes(RULE)));
const analysisStatus=await poll(analysisId);await poll(discoveryId);
const discoveryStatus=sql.prepare('SELECT status FROM jobs WHERE owner=? AND id=?').get(owner,discoveryId).status;
check('the analysis job completes and the tool-less discovery fails (mocked)',()=>assert.ok(analysisStatus==='completed'&&discoveryStatus==='failed'));

// ── c) 처리기 ──
const handler=kinds.evalKind('viral_analysis'),request={brand:aIn.brand,case:aIn.case,observations:aIn.observations};
check('viral_analysis is a case kind with its own reserve constant',()=>assert.ok(plain(kinds.EVAL_CASE_KINDS).includes('viral_analysis')&&handler.kind==='viral_analysis'&&handler.reserve===kinds.EVAL_VIRAL_ANALYSIS_TOKEN_RESERVE&&kinds.reserveOf({kind:'viral_analysis'})===kinds.EVAL_VIRAL_ANALYSIS_TOKEN_RESERVE&&kinds.EVAL_VIRAL_ANALYSIS_TOKEN_RESERVE>0));
check('freeze keeps {brand, case, observations} and the fixed role',()=>{const f=plain(handler.freeze(request));assert.ok(f.role===kinds.VIRAL_ANALYSIS_ROLE&&JSON.stringify(f.request)===JSON.stringify(request))});
check('freeze drops keys the assembly does not read',()=>assert.deepEqual(Object.keys(plain(handler.freeze({...request,requestedAt:now,extra:1})).request),['brand','case','observations']));
check('freeze accepts the fixed role name',()=>assert.equal(handler.freeze(request,kinds.VIRAL_ANALYSIS_ROLE).role,kinds.VIRAL_ANALYSIS_ROLE));
check('freeze rejects another role (400)',()=>rejects(()=>handler.freeze(request,'cmo'),400,/담당/));
check('freeze rejects a request without brand (400)',()=>rejects(()=>handler.freeze({case:request.case,observations:[]}),400));
check('freeze rejects a case that is not an object (400)',()=>rejects(()=>handler.freeze({...request,case:'x'}),400));
check('freeze rejects a case without observed text (400)',()=>rejects(()=>handler.freeze({...request,case:{...request.case,observations:''}}),400));
check('freeze rejects observations that are not a list of objects (400)',()=>{rejects(()=>handler.freeze({...request,observations:{}}),400);rejects(()=>handler.freeze({...request,observations:['x']}),400)});
check('freeze rejects a discovery-shaped request (query, requestedAt) (400)',()=>rejects(()=>handler.freeze({brand:aIn.brand,query:'q',requestedAt:now}),400));
check('build without a side is the code-constant assembly (operational bytes)',()=>assert.deepEqual(plain(handler.build(request)),{instructions:analysisSent.instructions,input:analysisSent.input}));
check('build with a null side (active is the code constant) is the same bytes',()=>assert.deepEqual(plain(handler.build(request,null)),plain(handler.build(request))));
check('build with a PromptSet side injects its viral body',()=>{const x=handler.build(request,{viral:'합성 후보 본문'});assert.ok(x.instructions.startsWith('합성 후보 본문\n')&&x.input===analysisSent.input&&count(x.instructions,RULE)===1)});
check('build with a PromptSet without viral falls back to the code constant',()=>assert.equal(handler.build(request,{roles:{}}).instructions,analysisSent.instructions));
check('build refuses an operator-preference side',()=>assert.throws(()=>handler.build(request,{preference:'on',block:{note:'',rules:[]}})));
check('viral cases have no campaign and no fact ledger',()=>assert.ok(handler.campaignOf(request)===null&&handler.factsOf(request)===null));
const graded=handler.grade({id:'k',role:kinds.VIRAL_ANALYSIS_ROLE,kind:'viral_analysis',request,expectations:{prohibitedTerms:[],facts:null,industry:null,localStore:false}},analysisOf(),1000);
check('grade runs the viral graders only and passes a good analysis (no prohibited terms: not applicable)',()=>assert.ok(JSON.stringify(graded.result.graders.map(g=>g.id))===JSON.stringify(viral.VIRAL_GRADERS.map(g=>g.id))&&graded.result.graders.every(g=>g.status===(g.id==='viral_prohibited_term'?'not_applicable':'pass')),JSON.stringify(graded.result.graders)));
check('grade records the grading version and a compliance tally',()=>assert.ok(graded.result.gradersVersion===graders.GRADERS_VERSION&&typeof graded.result.compliance.block==='number'&&Array.isArray(graded.result.prevention)&&graded.result.prevention.length===0));

// ── e) 채점기(순수) ──
const item=(output,extra={})=>({id:'v',kind:'viral_analysis',role:kinds.VIRAL_ANALYSIS_ROLE,raw:output,inputTokens:1000,...extra});
const ctx={viralCase:{case:viralCase,observations:[{observations:'합성 재관찰 기록'}]}};
const statusOf=(output,c=ctx,extra)=>Object.fromEntries(graders.runGraders(item(output,extra),c,viral.VIRAL_GRADERS).map(r=>[r.id,r.status]));
const goodOut=JSON.parse(analysisOf()),with_=over=>JSON.stringify({...goodOut,...over});
check('the viral grader list is contract, counter-evidence, unobserved metric, prohibited term and input budget',()=>assert.deepEqual(plain(viral.VIRAL_GRADERS.map(g=>g.id)),['viral_analysis_contract','viral_counter_evidence','viral_unobserved_metric','viral_prohibited_term','input_budget']));
check('a good analysis passes every viral grader (prohibited terms not applicable without terms)',()=>assert.deepEqual(statusOf(analysisOf()),{viral_analysis_contract:'pass',viral_counter_evidence:'pass',viral_unobserved_metric:'pass',viral_prohibited_term:'not_applicable',input_budget:'pass'}));
check('a fenced JSON output is read like the operational parser',()=>assert.equal(statusOf('```json\n'+analysisOf()+'\n```').viral_analysis_contract,'pass'));
check('non-JSON output fails the contract',()=>assert.equal(statusOf('분석을 완료했습니다.').viral_analysis_contract,'fail'));
check('four ideas fail the contract (1~3)',()=>assert.equal(statusOf(analysisOf(true)).viral_analysis_contract,'fail'));
check('zero ideas fail the contract',()=>assert.equal(statusOf(with_({ideas:[]})).viral_analysis_contract,'fail'));
check('an idea with an unknown metric fails the contract',()=>assert.equal(statusOf(with_({ideas:[{...idea(1),metric:'view_count'}]})).viral_analysis_contract,'fail'));
check('an idea missing its treatment fails the contract',()=>assert.equal(statusOf(with_({ideas:[{...idea(1),treatment:''}]})).viral_analysis_contract,'fail'));
check('a missing analysis field fails the contract',()=>assert.equal(statusOf(with_({hook:undefined})).viral_analysis_contract,'fail'));
check('an analysis field over 6,000 characters fails the contract',()=>assert.equal(statusOf(with_({context:'가'.repeat(6001)})).viral_analysis_contract,'fail'));
check('an empty counterEvidence fails both contract and counter-evidence graders',()=>{const s=statusOf(with_({counterEvidence:'  '}));assert.ok(s.viral_analysis_contract==='fail'&&s.viral_counter_evidence==='fail')});
check('a placeholder unknowns ("없음") fails the counter-evidence grader only',()=>{const s=statusOf(with_({unknowns:'없음'}));assert.ok(s.viral_analysis_contract==='pass'&&s.viral_counter_evidence==='fail')});
check('counter-evidence grader is not applicable to non-JSON output (contract owns it)',()=>assert.equal(statusOf('분석 불가').viral_counter_evidence,'not_applicable'));
check('a view count that is not in the observations fails the unobserved-metric grader',()=>assert.equal(statusOf(with_({facts:'이 영상은 조회수 50만 회를 기록했습니다.'})).viral_unobserved_metric,'fail'));
check('a percentage that is not in the observations fails',()=>assert.equal(statusOf(with_({retention:'시청 지속률이 72%로 높습니다.'})).viral_unobserved_metric,'fail'));
check('a lift ratio derived from views and baseline views passes',()=>assert.equal(statusOf(with_({context:'평소 대비 3배 조회수입니다.'})).viral_unobserved_metric,'pass'));
check('an invented ratio fails',()=>assert.equal(statusOf(with_({context:'평소 대비 7배 조회수입니다.'})).viral_unobserved_metric,'fail'));
check('an observed count written with a Korean unit passes (1.2만 = 12,000)',()=>assert.equal(statusOf(with_({facts:'조회수 1.2만 회가 관찰됐습니다.'})).viral_unobserved_metric,'pass'));
check('a hedged number (미확인, [확인 필요], 추정) is not an assertion',()=>assert.equal(statusOf(with_({sharing:'공유 수는 약 300회로 추정되나 미확인입니다.',context:'[확인 필요] 광고 집행 비율 30%'})).viral_unobserved_metric,'pass'));
check('experiment ideas (forward targets) are not checked for observed numbers',()=>assert.equal(statusOf(with_({ideas:[{...idea(1),hypothesis:'공유율이 5% 오르면 채택한다.'}]})).viral_unobserved_metric,'pass'));
check('the unobserved-metric grader is not applicable without the case context',()=>assert.equal(statusOf(analysisOf(),{}).viral_unobserved_metric,'not_applicable'));
check('a prohibited term used without negation fails',()=>assert.equal(statusOf(with_({hook:'첫 장면에서 최저가를 약속합니다.'}),{...ctx,prohibitedTerms:['최저가']}).viral_prohibited_term,'fail'));
check('a negated prohibited term passes',()=>assert.equal(statusOf(with_({hook:'최저가라는 표현은 쓰지 않습니다.'}),{...ctx,prohibitedTerms:['최저가']}).viral_prohibited_term,'pass'));
check('input budget over the role cap fails',()=>assert.equal(statusOf(analysisOf(),ctx,{inputTokens:40000}).input_budget,'fail'));
check('the grading version carries the viral-analysis tag at the end',()=>assert.ok(graders.GRADERS_VERSION.endsWith('+revision-labels+viral-analysis')));
check('the role grader list and the meeting/brief list are unchanged',()=>assert.ok(graders.GRADERS.length===15&&graders.KIND_GRADERS.length===6&&graders.ALL_GRADERS.length===21&&!graders.ALL_GRADERS.some(g=>g.id.startsWith('viral_'))));
check('viral graders are not applicable to role items',()=>assert.ok(graders.runGraders({id:'r',kind:'role',role:'cmo',text:'## 합성\n조회수 50만 회'},ctx,viral.VIRAL_GRADERS.filter(g=>g.id!=='input_budget')).every(r=>r.status==='not_applicable')));

// ── d) 캡처 ──
let r=await evalPost({action:'save_connection',endpoint:EVAL,key:'eval-only',isolationConfirmed:true,note:'합성 평가 프로필'});
check('eval connection is ready',()=>assert.equal(r.body.status,'ready',JSON.stringify(r.body)));
r=await evalPost({action:'capture_case',kind:'viral_analysis',jobId:analysisId,label:'합성 분석 dev'});
const devCase=r.body;
check('a finished analysis job is captured as a viral_analysis case',()=>assert.ok(r.status===200&&devCase.kind==='viral_analysis'&&devCase.role===kinds.VIRAL_ANALYSIS_ROLE&&devCase.campaignId===null&&devCase.source==='capture',JSON.stringify(r.body)));
check('the capture is identical to the stored operational submission',()=>assert.ok(devCase.captureCheck.submission==='identical'&&devCase.captureCheck.frozenIdentical===true,JSON.stringify(devCase.captureCheck)));
check('the frozen request rebuilds the stored operational submission byte for byte',()=>assert.deepEqual(plain(handler.build(devCase.request)),{instructions:analysisSent.instructions,input:analysisSent.input}));
check('the frozen request has only brand, case and observations',()=>assert.deepEqual(Object.keys(devCase.request),['brand','case','observations']));
r=await evalPost({action:'capture_case',kind:'viral_analysis',jobId:discoveryId});
check('a discovery job is not captured (400, requestedAt cannot be reproduced)',()=>assert.ok(r.status===400&&/조사/.test(r.body.error),JSON.stringify(r.body)));
r=await evalPost({action:'capture_case',kind:'viral_analysis'});
check('a capture without jobId is 400',()=>assert.equal(r.status,400));
r=await evalPost({action:'capture_case',kind:'viral_analysis',jobId:'no-such-job'});
check('a capture of an unknown job is 404',()=>assert.equal(r.status,404));
const liveId=await start({action:'start_analysis',caseId:viralCase.id});
r=await evalPost({action:'capture_case',kind:'viral_analysis',jobId:liveId});
check('a running analysis job is not captured (409)',()=>assert.equal(r.status,409));
sql.prepare("UPDATE jobs SET status='completed' WHERE owner=? AND id=?").run(owner,liveId);
// 드리프트: 저장 제출을 바꾸거나 사례 관찰을 더해 사유를 만든다.
const submissionRow=id=>sql.prepare("SELECT data FROM records WHERE owner=? AND kind='hermes_submission' AND id=?").get(owner,`${owner}:hermes_submission:${id}`);
const setSubmission=(id,body)=>{const row=JSON.parse(submissionRow(id).data);sql.prepare("UPDATE records SET data=? WHERE owner=? AND kind='hermes_submission' AND id=?").run(JSON.stringify({...row,body:JSON.stringify(body)}),owner,`${owner}:hermes_submission:${id}`)};
const drift=async id=>(await evalPost({action:'capture_case',kind:'viral_analysis',jobId:id})).body.captureCheck?.submission;
const original=await stored(liveId);
setSubmission(liveId,{...original,instructions:original.instructions.replace(RULE+' ','')});
const codeDrift=await drift(liveId);
check('a stored submission without today\'s code sentence is code_changed',()=>assert.equal(codeDrift,'code_changed'));
const task=await server.readRecord(owner,'learning_task',liveId),changedBrand={...JSON.parse(original.input),brand:{...JSON.parse(original.input).brand,tone:'다른 말투'}};
setSubmission(liveId,{...original,input:JSON.stringify(changedBrand)});
const assemblyDrift=await drift(liveId);
check('a different input with the same case, observations and masking is assembly_drift',()=>assert.equal(assemblyDrift,'assembly_drift'));
await server.recordStatement(owner,'learning_task',liveId,{...task,inputMasking:[{field:'brand.audience',kind:'phone',count:1}]}).run();
const maskDrift=await drift(liveId);
check('a different recorded masking is store_allow_changed',()=>assert.equal(maskDrift,'store_allow_changed'));
await server.recordStatement(owner,'learning_task',liveId,task).run();setSubmission(liveId,original);
const restored=await drift(liveId);
check('restoring the submission and masking is identical again',()=>assert.equal(restored,'identical'));
await put('case_observation','pr-obs-2',{...viralCase,id:'pr-obs-2',caseId:viralCase.id,observations:'합성 추가 관찰'},viralCase.id);
const contextDrift=await drift(liveId);
check('an observation added after the job is context_changed',()=>assert.equal(contextDrift,'context_changed'));
sql.prepare("DELETE FROM records WHERE owner=? AND kind='hermes_submission' AND id=?").run(owner,`${owner}:hermes_submission:${liveId}`);
const missing=await drift(liveId);
check('a job without a stored submission is no_submission',()=>assert.equal(missing,'no_submission'));
sql.prepare("DELETE FROM records WHERE owner=? AND kind='case_observation' AND id=?").run(owner,`${owner}:case_observation:pr-obs-2`);
// 직접 저장(save_case): 봉인 케이스와 형식 거부.
r=await evalPost({action:'save_case',kind:'viral_analysis',set:'sealed',request:{...devCase.request,case:{...devCase.request.case,title:'합성 봉인 사례'}},label:'합성 분석 sealed'});
const sealedCase=r.body;
check('a viral_analysis case can be saved directly into the sealed set',()=>assert.ok(r.status===200&&sealedCase.kind==='viral_analysis'&&sealedCase.set==='sealed'&&sealedCase.role===kinds.VIRAL_ANALYSIS_ROLE&&sealedCase.campaignId===null,JSON.stringify(r.body)));
const caseRows=()=>sql.prepare("SELECT COUNT(*) n FROM records WHERE owner=? AND kind='eval_case'").get(owner).n,casesBefore=caseRows();
r=await evalPost({action:'save_case',kind:'viral_analysis',request:{case:devCase.request.case,observations:[]}});
check('save_case with a malformed viral request is 400 and stores nothing',()=>assert.ok(r.status===400&&caseRows()===casesBefore));
r=await evalPost({action:'save_case',kind:'viral_analysis',role:'cmo',request:devCase.request});
check('save_case with another role is 400',()=>assert.equal(r.status,400));

// ── 평가 run(active): 코드 상수 조립·바이럴 채점 ──
const runOf=async id=>(await evalGet('?run='+encodeURIComponent(id))).body;
async function drive(id,max=40){for(let i=0;i<max;i++){const run=await runOf(id);if(!['queued','running'].includes(run.status))return run;await background.advanceBackgroundWork(owner)}return runOf(id)}
r=await evalPost({action:'start_run',caseIds:[devCase.id],tokenBudget:100000,label:'합성 바이럴 active'});
const activeRun=await drive(r.body.id),activeSent=evalSubmits.at(-1).sent;
check('an active run submits the operational bytes and grades with the viral graders',()=>assert.ok(activeRun.status==='completed'&&activeSent.instructions===analysisSent.instructions&&activeSent.input===analysisSent.input&&activeRun.results[0].graders.map(g=>g.id).join()===viral.VIRAL_GRADERS.map(g=>g.id).join()&&activeRun.results[0].reserve===kinds.EVAL_VIRAL_ANALYSIS_TOKEN_RESERVE,JSON.stringify(activeRun.results)));

// ── f) 레지스트리 쌍 평가·활성화 ──
const roleCase=(await evalPost({action:'capture_case',campaignId:roleCampaign.id,role:'cmo',label:'합성 cmo'})).body;
let refSeq=0;
async function register(unit,body){const ref=createHash('sha1').update('pv-ref-'+ ++refSeq).digest('hex');raw.publish(ref,unit,body);raw.publish('main',unit,body);const x=await prompts({action:'register',unit,sourceSha:ref});assert.equal(x.status,200,JSON.stringify(x));return x.body.version.id}
const repoBody=raw.repoBody('viral.discovery'),goodV=await register('viral.discovery',repoBody+' 합성 개선 초점: 비교 사례의 첫 장면 차이를 먼저 적으세요.'),badV=await register('viral.discovery',repoBody+' '+BAD+': 실험안을 넉넉히 적으세요.');
const cmoV=await register('role.cmo',{...raw.repoBody('role.cmo'),focus:'합성 cmo 초점'});
const startPair=(unit,candidateVersionId,caseIds)=>evalPost({action:'start_run',pair:{unit,candidateVersionId},caseIds,tokenBudget:250000,label:'합성 바이럴 쌍 평가'});
const runs=()=>sql.prepare("SELECT COUNT(*) n FROM records WHERE owner=? AND kind='eval_run'").get(owner).n;
const before=runs();
r=await startPair('viral.discovery',goodV,[roleCase.id]);
check('viral.discovery with role cases only is still 400',()=>assert.ok(r.status===400&&/viral_analysis|바이럴/.test(r.body.error),JSON.stringify(r.body)));
r=await startPair('role.cmo',cmoV,[devCase.id,sealedCase.id]);
check('a role unit with viral cases only is 400',()=>assert.equal(r.status,400));
check('rejected pair starts record no run',()=>assert.equal(runs(),before));
const pairRun=async version=>{const s=await startPair('viral.discovery',version,[devCase.id,sealedCase.id,roleCase.id]);assert.equal(s.status,200,JSON.stringify(s.body));return drive(s.body.id)};
const submitsBefore=evalSubmits.length,good=await pairRun(goodV),goodSubmits=evalSubmits.slice(submitsBefore);
check('a viral pair run keeps only the viral_analysis cases and counts the role case as skipped',()=>assert.ok(good.status==='completed'&&good.pair.unit==='viral.discovery'&&good.pair.activeVersionId===null&&good.pair.skippedCases===1&&JSON.stringify(good.caseIds)===JSON.stringify([devCase.id,sealedCase.id])&&good.results.length===4&&good.results.every(x=>x.status==='completed'),JSON.stringify(good.results)));
check('the active side sends the code constant and the candidate side the candidate body',()=>{
 const byVariant=v=>good.results.filter(x=>x.variant===v).map(x=>goodSubmits.find(s=>s.id===x.providerRunId).sent.instructions);
 assert.ok(byVariant('active').every(t=>t.startsWith(practice.viralPractice+'\n'))&&byVariant('candidate').every(t=>t.startsWith(repoBody+' 합성 개선 초점')&&count(t,RULE)===1));
});
r=await evalGet('?pair='+good.id);
check('the pair report passes the gate for a non-regressing candidate',()=>assert.ok(r.status===200&&r.body.gate.ok===true,JSON.stringify(r.body.gate)));
const bad=await pairRun(badV);
const approval={reason:'합성 승인: 바이럴 쌍 평가 확인'};
r=await prompts({action:'activate',unit:'viral.discovery',versionId:badV,evalRunId:bad.id,approval});
check('a regressing viral candidate is refused by the gate (409)',()=>assert.ok(r.status===409&&/합격 수/.test(r.body.error),JSON.stringify(r.body)));
r=await prompts({action:'stage',unit:'viral.discovery',versionId:goodV,evalRunId:good.id,campaignIds:[roleCampaign.id],approval});
check('stage is refused for viral.discovery (400, no campaign scope)',()=>assert.ok(r.status===400&&/viral\.discovery|바이럴/.test(r.body.error),JSON.stringify(r.body)));
r=await prompts({action:'activate',unit:'viral.discovery',versionId:goodV,evalRunId:good.id,approval});
check('a gated viral candidate activates',()=>assert.ok(r.status===200&&r.body.release.active===goodV&&r.body.event.action==='activate',JSON.stringify(r.body)));
const afterId=await start({action:'start_analysis',caseId:viralCase.id}),afterTask=await server.readRecord(owner,'learning_task',afterId),afterSent=await stored(afterId);
check('the next operational analysis uses the activated body and keeps the code rule',()=>assert.ok(afterTask.promptSource==='registry'&&afterTask.promptVersion===goodV&&afterSent.instructions.startsWith(repoBody+' 합성 개선 초점')&&count(afterSent.instructions,RULE)===1));

// ── 권한: 평가·레지스트리 모두 소유자만(기존 규칙). 비로그인 401, 관리자·직원 403. ──
env.AUTH_MODE='email';env.AUTH_ORIGIN='https://agency.test';
const signIn=(id,role,createdAt,ws)=>{const token=createHash('sha256').update(id).digest('hex');sql.prepare('INSERT INTO auth_users(id,email,workspace_owner,role,status,created_at) VALUES(?,?,?,?,?,?)').run(id,id+'@test.invalid',ws,role,'active',createdAt);sql.prepare('INSERT INTO auth_sessions VALUES(?,?,?,?)').run(createHash('sha256').update(token).digest('hex'),id,Date.now()+60000,Date.now());return {cookie:'__Host-collective_session='+token,origin:'https://agency.test'}};
const adminS=signIn('pv-ws-admin','admin',2000,owner),memberS=signIn('pv-ws-member','member',500,owner);
signIn('pv-ws-owner','admin',1000,owner);
for(const [name,send] of [['capture_case',x=>evalPost({action:'capture_case',kind:'viral_analysis',jobId:analysisId},owner,x)],['viral pair start_run',x=>evalPost({action:'start_run',pair:{unit:'viral.discovery',candidateVersionId:badV},caseIds:[devCase.id,sealedCase.id],tokenBudget:250000},owner,x)],['viral activate',x=>prompts({action:'activate',unit:'viral.discovery',versionId:badV,evalRunId:bad.id,approval},owner,x)]]){
 const [anon,member,admin]=await Promise.all([send({origin:'https://agency.test'}),send(memberS),send(adminS)]);
 check(`${name}: anonymous 401, member and admin 403`,()=>assert.ok(anon.status===401&&member.status===403&&admin.status===403,JSON.stringify([anon.status,member.status,admin.status])));
}
check('no external network call was made',()=>assert.equal(external.length,0));
console.log(JSON.stringify({passed:passed.length}));
