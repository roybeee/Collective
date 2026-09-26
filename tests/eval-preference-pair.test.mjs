// B3-2b 운영자 선호 on/off 골든 쌍 평가(설계 권고 D5·D8·D11): POST /api/eval start_run pair:{kind:'operator_preferences', ruleIds}.
// 같은 run·같은 게이트웨이 스냅샷에서 케이스마다 off(동결 요청에서 operatorPreferences를 뺀 제출)와 on(고른 규칙만으로 만든 운영 주입 블록)을 번갈아 제출하고,
// 기존 pairGate(봉인 1건 이상·회귀 0·같은 게이트웨이)로 판정한다. 초안 규칙도 평가한다(D5). 이 run은 프롬프트 활성화 게이트에 쓰지 못한다.
// 근거: mocked(평가·운영 HERMES·raw.githubusercontent.com fetch 스텁, 메모리 SQLite, 실제 app/api/eval·app/api/prompts 라우트, 합성 데이터). 외부 네트워크 호출은 0회다.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {testRuntime} from './helpers/runtime.mjs';
import {roleFixture} from './helpers/role-fixture.mjs';
import {sha,seed,mockHermes,runRole,roleCampaign,brand,now,rawGithub} from './helpers/prompt-seed.mjs';

// ── 모의 평가 HERMES(tests/prompt-activation.test.mjs와 같은 모양): 게이트웨이 도구 목록·출력 누설을 시나리오마다 바꾼다 ──
const EVAL='https://eval-hermes.example.com';
const capabilities={object:'hermes.api_server.capabilities',platform:'hermes-agent',features:{run_submission:true,run_status:true,run_stop:true,runs_idempotency:{durable:true,enabled:true,supported:true}}};
const clean={toolsets:{toolsets:[{name:'web'}]},leak:()=>false};
let evalMode={...clean};
const evalRuns=new Map(),evalSubmits=[];let evalSeq=0;
const evalOutput=sent=>{const out=JSON.parse(roleFixture(sent.input));return evalMode.leak(sent)?JSON.stringify({...out,sections:out.sections.map((s,i)=>i?s:{...s,content:s.content+' 근거 위치는 evidence.facts 기준입니다.'})}):JSON.stringify(out)};
async function evalHandler(url,options={}){
 if(!url.startsWith(EVAL+'/'))return undefined;
 const path=url.slice(EVAL.length),headers=new Headers(options.headers||{}),method=options.method||'GET';
 if(!headers.get('authorization'))return new Response('{}',{status:401});
 if(path==='/v1/capabilities')return Response.json(capabilities);
 if(path==='/v1/models')return Response.json({data:[{id:'mock-eval-model'}]});
 if(path==='/v1/toolsets')return Response.json(evalMode.toolsets);
 if(path==='/v1/runs'&&method==='POST'){const id='pp_'+ ++evalSeq,sent=JSON.parse(options.body);evalRuns.set(id,sent);evalSubmits.push({id,sent,headers:Object.fromEntries(headers)});return Response.json({run_id:id})}
 const stop=/^\/v1\/runs\/([\w-]+)\/stop$/.exec(path);if(stop)return Response.json({object:'hermes.run',run_id:stop[1],status:'stopped'});
 const id=/^\/v1\/runs\/([\w-]+)$/.exec(path)?.[1],sent=evalRuns.get(id);if(!sent)return new Response('{}',{status:404});
 return Response.json({object:'hermes.run',run_id:id,status:'completed',output:evalOutput(sent),usage:{input_tokens:1000,output_tokens:500,total_tokens:1500},model:'mock-eval-model'});
}
const raw=rawGithub(),hermes=mockHermes(async(url,options)=>await raw.handler(url)??await evalHandler(url,options));
const {sql,env,load}=testRuntime(hermes.fetch);
const server=await load('lib/server.ts'),evalRoute=await load('app/api/eval/route.ts'),promptRoute=await load('app/api/prompts/route.ts');
const background=await load('lib/background-execution.ts'),execution=await load('lib/role-execution.ts'),instruction=await load('lib/role-instruction.ts');
const curator=await load('lib/playbook-curator.ts'),stats=await load('lib/eval-stats.ts');
const owner='pp-owner',passed=[];
const check=(name,fn)=>{fn();passed.push(name)};
const plain=value=>JSON.parse(JSON.stringify(value));
const put=await seed(server,sql,owner);
const call=async res=>({status:res.status,body:await res.json()});
const request=(path,input,user,extra)=>new Request('https://agency.test'+path,{method:'POST',headers:{'oai-authenticated-user-id':user,'content-type':'application/json',...extra},body:JSON.stringify(input)});
const evalPost=(input,user=owner,extra={})=>evalRoute.POST(request('/api/eval',input,user,extra)).then(call);
const evalGet=(query='',user=owner,extra={})=>evalRoute.GET(new Request('https://agency.test/api/eval'+query,{headers:{'oai-authenticated-user-id':user,...extra}})).then(call);
const prompts=(input,user=owner)=>promptRoute.POST(request('/api/prompts',input,user,{})).then(call);
const runCount=()=>sql.prepare("SELECT COUNT(*) n FROM records WHERE owner=? AND kind='eval_run'").get(owner).n;
const runOf=async id=>(await evalGet('?run='+encodeURIComponent(id))).body;
async function drive(id,max=40){for(let i=0;i<max;i++){const run=await runOf(id);if(!['queued','running'].includes(run.status))return run;await background.advanceBackgroundWork(owner)}return runOf(id)}
const submitted=res=>evalSubmits.find(s=>s.id===res.providerRunId);
const side=(run,caseId,variant)=>run.results.find(x=>x.caseId===caseId&&x.variant===variant);

// ── 합성 규칙: 규칙 id·인용 id를 모델 입력에서 찾기 쉬운 고유 문자열로 둔다 ──
const DAY=86400000,at=offset=>new Date(Date.parse('2026-09-01T00:00:00.000Z')+offset*DAY).toISOString(),future=new Date(Date.now()+50*DAY).toISOString();
const CITES=['rd-cite-7c41a','rd-cite-7c41b'];
const pref=(id,over)=>({origin:'review',grade:'operator_preference',id,brandId:brand.id,channel:'*',experimentId:'',experimentVersion:0,caseId:'',title:'',guidance:'',scope:'사람 판정 2건 인용',citations:CITES,feedback:{helpful:3,harmful:1},status:'draft',version:1,expiresAt:future,createdAt:at(0),updatedAt:at(0),...over});
const withText=(r,text)=>({...r,title:curator.ruleTitle(text),guidance:text});
// ruleA: cmo 역할 초안(D5). ruleB: 역할 없음·Instagram 채널·적용 중(케이스 캡처 때 동결본에 이미 블록으로 들어간다).
const ruleA=withText(pref('playbook:pp-alpha-51e7',{role:'cmo',createdAt:at(1)}),'첫 문단은 고객이 평일 저녁에 겪는 상황 한 가지로 시작한다.');
const ruleB=withText(pref('playbook:pp-bravo-83d2',{channel:'Instagram',status:'active',version:2,createdAt:at(2)}),'숫자는 브리프에 있는 값만 쓰고 단위를 붙여 적는다.');
const ruleRetired=withText(pref('playbook:pp-retired-11aa',{status:'retired'}),'끝낸 규칙 본문이다.');
const ruleOther=withText(pref('playbook:pp-other-22bb',{brandId:'pp-brand-2'}),'다른 브랜드의 선호 본문이다.');
const ruleViral={origin:'viral',id:'exp:pp-viral:1',brandId:brand.id,channel:'YouTube',experimentId:'pp-viral',experimentVersion:1,caseId:'case',title:'성과 규칙',guidance:'단면을 먼저 보여 준다',scope:'',evidenceLevel:'observational',status:'active',version:1,expiresAt:future,createdAt:at(0),updatedAt:at(0)};
for(const r of [ruleA,ruleB,ruleRetired,ruleOther,ruleViral])await put('learning_rule',r.id,r,r.brandId);

// ── 캠페인·케이스: 대상 dev·sealed cmo, 빠지는 케이스(다른 역할·다른 브랜드·채널 밖·회의 단계·브리프) ──
await put('brand','pp-brand-2',{...brand,id:'pp-brand-2',name:'가상국밥',short:'GK'});
const sealedCampaign={...roleCampaign,id:'pp-sealed-campaign',title:'가상분식 봉인 점검'},otherBrandCampaign={...roleCampaign,id:'pp-other-campaign',brandId:'pp-brand-2',title:'가상국밥 오픈'},noChannelCampaign={...roleCampaign,id:'pp-youtube-campaign',channels:'YouTube',title:'가상분식 영상'};
for(const c of [sealedCampaign,otherBrandCampaign,noChannelCampaign])await put('campaign',c.id,c);
let r=await evalPost({action:'save_connection',endpoint:EVAL,key:'eval-only',isolationConfirmed:true,note:'합성 평가 프로필'});
check('eval connection is ready',()=>assert.equal(r.body.status,'ready',JSON.stringify(r)));
const capture=async(campaignId,role,extra={})=>{const res=await evalPost({action:'capture_case',campaignId,role,expectations:{inputTokenCap:20000},...extra});assert.equal(res.status,200,JSON.stringify(res));return res.body};
const devCase=await capture(roleCampaign.id,'cmo',{label:'dev cmo'}),sealedCase=await capture(sealedCampaign.id,'cmo',{set:'sealed',label:'sealed cmo'});
const insightCase=await capture(roleCampaign.id,'insight'),otherBrandCase=await capture(otherBrandCampaign.id,'cmo'),noChannelCase=await capture(noChannelCampaign.id,'cmo');
const shell=(id,kind,role)=>({id,kind,role,label:id,set:'dev',request:{},expectations:{prohibitedTerms:[],facts:null,industry:null,localStore:false},campaignId:roleCampaign.id,source:'manual',capturedWith:{skillVersion:'x',outputContractVersion:'x'},createdBy:{id:owner,email:null},createdAt:now,updatedAt:now});
await put('eval_case','pp-meeting-case',shell('pp-meeting-case','meeting_step','content'));await put('eval_case','pp-brief-case',shell('pp-brief-case','brief','brief'));
check('captured requests already carry the active rule block (ruleB) and no rule id',()=>assert.ok(devCase.request.operatorPreferences.rules.length===1&&devCase.request.operatorPreferences.rules[0].text===ruleB.guidance&&!JSON.stringify(devCase.request).includes(ruleB.id)));

// 0) 순수 헬퍼(lib/playbook-curator.ts)
const block=curator.operatorPreferenceBlock([ruleA,ruleB]),frozenBefore=JSON.stringify(devCase.request),sides=curator.preferenceSides(devCase.request,block);
check('preferenceSides: off drops operatorPreferences, on carries the given block, the input is not mutated',()=>assert.ok(!('operatorPreferences' in sides.off)&&JSON.stringify(sides.on.operatorPreferences)===JSON.stringify(block)&&JSON.stringify(devCase.request)===frozenBefore&&Object.keys(sides.on).at(-1)==='operatorPreferences'));
const picked=curator.preferencePairCases([devCase,insightCase,otherBrandCase,noChannelCase,shell('m','meeting_step','cmo'),shell('b','brief','brief')],[ruleA,ruleB]);
check('preferencePairCases keeps only role cases where every rule applies and counts the rest',()=>assert.ok(picked.cases.length===1&&picked.cases[0].id===devCase.id&&picked.skippedCases===5,JSON.stringify(plain(picked))));
check('preferencePairCases scopes draft rules like active ones (D5)',()=>assert.equal(curator.preferencePairCases([devCase],[{...ruleA,status:'draft'}]).cases.length,1));

// 1) 시작 거부(400): 모르는 id·운영자 선호가 아닌 규칙·종료 규칙·다른 브랜드 섞임·8개 초과·빈 목록·해당 케이스 없음. run 기록과 제출이 없다.
const startPref=(ruleIds,caseIds,extra={})=>evalPost({action:'start_run',pair:{kind:'operator_preferences',ruleIds},caseIds,tokenBudget:250000,label:'B3 가상분식 cmo 선호 on/off',...extra});
for(const [name,ids,pattern] of [['an unknown rule id',['playbook:pp-missing'],/찾을 수 없/],['a performance (non operator) rule',[ruleViral.id],/운영자 선호 규칙이 아닙/],['a retired rule',[ruleA.id,ruleRetired.id],/종료/],['rules of another brand',[ruleA.id,ruleOther.id],/같은 브랜드의 운영자 선호 규칙만/],['more than 8 rule ids',Array.from({length:9},(_,i)=>'playbook:pp-many-'+i),/1~8/],['an empty rule list',[],/1~8/]]){
 r=await startPref(ids,[devCase.id,sealedCase.id]);
 check(`${name} is 400`,()=>assert.ok(r.status===400&&pattern.test(r.body.error),JSON.stringify(r)));
}
r=await startPref([ruleA.id],[insightCase.id,otherBrandCase.id,'pp-meeting-case']);
check('no case where every selected rule applies is 400',()=>assert.ok(r.status===400&&/케이스/.test(r.body.error),JSON.stringify(r)));
check('rejected starts record no run and submit nothing',()=>assert.ok(runCount()===0&&evalSubmits.length===0));

// 2) 예산: 두 쪽 모두 케이스 예약 50,000을 잡는다. 한쪽이 끝나면 다음 쪽 예약이 들어가지 않아 budget_reached로 멈춘다.
r=await startPref([ruleA.id],[devCase.id],{tokenBudget:50000});
const budgetRun=await drive(r.body.id);
check('both sides reserve 50,000 and the run stops at budget_reached',()=>assert.ok(budgetRun.results.length===2&&budgetRun.results.every(x=>x.reserve===50000)&&budgetRun.status==='completed'&&budgetRun.stopReason==='budget_reached'&&budgetRun.results[1].status==='not_run'&&evalSubmits.length===1,JSON.stringify(budgetRun.results)));

// 3) 본 run P1: 초안 ruleA + 적용 중 ruleB. 대상 밖 케이스 5건은 빠진다.
const before=evalSubmits.length;
r=await startPref([ruleB.id,ruleA.id,ruleA.id],[devCase.id,sealedCase.id,insightCase.id,otherBrandCase.id,noChannelCase.id,'pp-meeting-case','pp-brief-case']);
check('a preference pair run starts (200)',()=>assert.equal(r.status,200,JSON.stringify(r)));
const P1=await drive(r.body.id),order=[ruleA,ruleB];
const expectedBlock=curator.operatorPreferenceBlock(order);
check('run meta freezes kind, unit, brand, off/on ids, rule refs, block hash and skipped cases',()=>assert.ok(P1.variant==='pair'&&P1.pair.kind==='operator_preferences'&&P1.pair.unit==='operator_preferences'&&P1.pair.brandId===brand.id&&P1.pair.activeVersionId==='off'&&P1.pair.candidateVersionId===`${ruleA.id}@1+${ruleB.id}@2`&&P1.pair.skippedCases===5,JSON.stringify(P1.pair)));
check('rule refs keep role, channel and status (draft allowed, D5) in injection order',()=>assert.deepEqual(P1.pair.rules,[{ruleRef:`${ruleA.id}@1`,role:'cmo',channel:'*',status:'draft'},{ruleRef:`${ruleB.id}@2`,role:null,channel:'Instagram',status:'active'}]));
check('the frozen block is the production block and blockHash is its sha256',()=>assert.ok(JSON.stringify(P1.pair.block)===JSON.stringify(expectedBlock)&&P1.pair.blockHash==='sha256:'+sha(JSON.stringify(expectedBlock))));
check('only the dev and sealed cmo cases run, both sides each, alternating',()=>assert.ok(JSON.stringify(P1.caseIds)===JSON.stringify([devCase.id,sealedCase.id])&&JSON.stringify(P1.results.map(x=>x.variant))==='["active","candidate","candidate","active"]'&&P1.results.every(x=>x.status==='completed'&&x.reserve===50000)&&evalSubmits.length===before+4));
const devOff=submitted(side(P1,devCase.id,'active')),devOn=submitted(side(P1,devCase.id,'candidate')),sealedOff=submitted(side(P1,sealedCase.id,'active'));
const strip=req=>Object.fromEntries(Object.entries(req).filter(([k])=>k!=='operatorPreferences'));
const offExpected=execution.roleSubmission(strip(devCase.request));
check('off side equals roleSubmission without operatorPreferences (byte)',()=>assert.ok(devOff.sent.instructions===offExpected.instructions&&devOff.sent.input===offExpected.input&&devOff.sent.instructions===instruction.buildRoleInstruction(devCase.request)&&!devOff.sent.input.includes('operatorPreferences')&&!devOff.sent.input.includes(ruleB.guidance)));
check('the off side of a case captured with a block also drops it',()=>assert.ok(sealedCase.request.operatorPreferences&&sealedOff.sent.instructions===execution.roleSubmission(strip(sealedCase.request)).instructions&&!sealedOff.sent.input.includes('operatorPreferences')));
check('the on side replaces the captured block with the selected rules only',()=>assert.ok(JSON.stringify(JSON.parse(devOn.sent.input).operatorPreferences)===JSON.stringify(expectedBlock)&&devOn.sent.input.split('"operatorPreferences"').length===2&&devOn.sent.instructions.endsWith(curator.OPERATOR_PREFERENCE_AUTHORITY)));
const leaks=[ruleA.id,ruleB.id,...CITES,'citations','"feedback"','"helpful"','"harmful"','ruleRef','blockHash'];
check('model input carries no rule id, citation or counter',()=>assert.ok(evalSubmits.slice(before).every(s=>leaks.every(x=>!s.sent.input.includes(x)&&!s.sent.instructions.includes(x)))));
check('each side has its own idempotency key',()=>assert.ok(new Set(P1.results.map(x=>x.idempotencyKey)).size===4&&P1.results.every(x=>x.idempotencyKey==='collective-eval-'+createHash('sha256').update(`${P1.id}:${x.caseId}:${x.variant}`).digest('hex').slice(0,40))));

// 운영 제출과 바이트 비교: ruleA만 승인해 이 두 규칙만 적용 중이 되게 하고(다른 브랜드·종료 규칙은 주입 대상이 아니다) 실제 역할 실행 start의 HERMES 제출 본문을 읽는다.
await put('learning_rule',ruleA.id,{...ruleA,status:'active'},ruleA.brandId);
const production=await runRole(execution,server,owner,roleCampaign,'cmo');
check('on side equals the production submission when only these rules are active (byte)',()=>assert.ok(devOn.sent.instructions===production.instructions&&devOn.sent.input===production.input,'production differs'));

// 4) 게이트: 기존 pairGate 그대로(봉인 1건 이상·회귀 0·같은 게이트웨이)
r=await evalGet('?pair='+P1.id);
check('pair report passes the unchanged pairGate and shows the preference meta without the block',()=>assert.ok(r.status===200&&r.body.gate.ok===true&&r.body.gate.sealedCases===1&&r.body.gate.sealedRegressions.length===0&&JSON.stringify(r.body.gate)===JSON.stringify(plain(stats.pairGate(P1)))&&r.body.pair.kind==='operator_preferences'&&r.body.pair.blockHash===P1.pair.blockHash&&r.body.pair.skippedCases===5&&r.body.pair.block===undefined,JSON.stringify(r.body.pair)));
const pairRun=async(ruleIds,caseIds,mode={},midway=()=>{})=>{evalMode={...clean,...mode};const s=await startPref(ruleIds,caseIds);assert.equal(s.status,200,JSON.stringify(s));await midway(s.body);const run=await drive(s.body.id);evalMode={...clean};return run};
const codes=async run=>(await evalGet('?pair='+run.id)).body.gate.reasons.map(x=>x.code);
const noSealed=await pairRun([ruleA.id],[devCase.id]);
const noSealedCodes=await codes(noSealed);
check('without a sealed case the gate refuses (sealed_missing only)',()=>assert.deepEqual(noSealedCodes,['sealed_missing']));
const regressed=await pairRun([ruleA.id],[devCase.id,sealedCase.id],{leak:sent=>sent.input.includes(ruleA.guidance)&&sent.input.includes('가상분식 봉인 점검')});
const regressedCodes=await codes(regressed);
check('an on-side sealed regression is refused (sealed_regression)',()=>assert.ok(regressedCodes.includes('sealed_regression'),JSON.stringify(regressedCodes)));
const gatewayMoved=await pairRun([ruleA.id],[devCase.id,sealedCase.id],{},()=>{evalMode.toolsets={toolsets:[{name:'web'},{name:'browser'}]}});
const gatewayCodes=await codes(gatewayMoved);
check('a gateway change inside the run is refused (gateway_changed)',()=>assert.deepEqual(gatewayCodes,['gateway_changed']));

// 5) 동결: 시작 뒤 규칙을 고쳐도 두 쪽 본문은 시작 때 블록이다.
const EDITED='수정한 본문: 마지막 문단에 다음 방문 이유를 적는다.';
const P2=await pairRun([ruleA.id,ruleB.id],[devCase.id,sealedCase.id],{},async()=>{await put('learning_rule',ruleA.id,{...withText({...ruleA,status:'active'},EDITED),version:3},ruleA.brandId);await put('learning_rule',ruleB.id,{...ruleB,status:'paused',version:3},ruleB.brandId)});
const p2On=submitted(side(P2,devCase.id,'candidate'));
check('rule refs and block are frozen at start; later rule edits do not change the sides',()=>assert.ok(P2.pair.blockHash===P1.pair.blockHash&&P2.pair.rules[0].ruleRef===`${ruleA.id}@1`&&p2On.sent.input.includes(ruleA.guidance)&&!p2On.sent.input.includes(EDITED)&&JSON.stringify(JSON.parse(p2On.sent.input).operatorPreferences)===JSON.stringify(expectedBlock)));

// 6) 프롬프트 활성화 게이트에 쓰지 못한다(pairGate가 통과한 P1이어도).
const ref=createHash('sha1').update('pp-ref').digest('hex'),cmoBody={...raw.repoBody('role.cmo'),focus:'합성 초점: 평일 저녁 상황을 먼저 적는다'};
raw.publishRepo(ref);raw.publish(ref,'role.cmo',cmoBody);raw.publishRepo('main');raw.publish('main','role.cmo',cmoBody);
const registered=await prompts({action:'register',unit:'role.cmo',sourceSha:ref});
check('a prompt version is registered for the gate check',()=>assert.equal(registered.status,200,JSON.stringify(registered)));
const approval={reason:'합성 승인'};
for(const action of ['activate','stage']){
 r=await prompts({action,unit:'role.cmo',versionId:registered.body.version.id,evalRunId:P1.id,approval,...(action==='stage'?{campaignIds:[roleCampaign.id]}:{})});
 check(`a preference pair run cannot pass a prompt activation gate (${action} 409)`,()=>assert.ok(r.status===409&&/운영자 선호 쌍 평가/.test(r.body.error)&&!/이 단위·버전/.test(r.body.error),JSON.stringify(r.body)));
}
check('refused activations change no pointer',()=>assert.equal(sql.prepare("SELECT COUNT(*) n FROM records WHERE kind='prompt_release'").get().n,0));

// 7) 기존 프롬프트 쌍 평가 응답 모양은 그대로다(pair 조회 키 4개).
const promptRun=await (async()=>{const s=await evalPost({action:'start_run',pair:{unit:'role.cmo',candidateVersionId:registered.body.version.id},caseIds:[devCase.id,sealedCase.id],tokenBudget:250000,label:'합성 프롬프트 쌍 평가'});assert.equal(s.status,200,JSON.stringify(s));return drive(s.body.id)})();
r=await evalGet('?pair='+promptRun.id);
check('a prompt pair run keeps its pair read shape and PromptSet sides',()=>assert.ok(r.status===200&&JSON.stringify(Object.keys(r.body.pair))==='["unit","candidateVersionId","activeVersionId","skippedCases"]'&&promptRun.pair.candidateSet&&promptRun.pair.kind===undefined));

// 8) 권한: 소유자만. 관리자·직원 403, 비로그인 401.
env.AUTH_MODE='email';env.AUTH_ORIGIN='https://agency.test';
const signIn=(id,role,createdAt)=>{const token=createHash('sha256').update(id).digest('hex');sql.prepare('INSERT INTO auth_users(id,email,workspace_owner,role,status,created_at) VALUES(?,?,?,?,?,?)').run(id,id+'@test.invalid',owner,role,'active',createdAt);sql.prepare('INSERT INTO auth_sessions VALUES(?,?,?,?)').run(createHash('sha256').update(token).digest('hex'),id,Date.now()+60000,Date.now());return {cookie:'__Host-collective_session='+token,origin:'https://agency.test'}};
signIn('pp-ws-owner','admin',1000);const adminS=signIn('pp-ws-admin','admin',2000),memberS=signIn('pp-ws-member','member',500);
const runsBefore=runCount(),input={action:'start_run',pair:{kind:'operator_preferences',ruleIds:[ruleA.id]},caseIds:[devCase.id,sealedCase.id],tokenBudget:250000};
const [anon,admin,member]=await Promise.all([evalPost(input,owner,{origin:'https://agency.test'}),evalPost(input,owner,adminS),evalPost(input,owner,memberS)]);
check('start_run preference pair: anonymous 401, admin and member 403',()=>assert.ok(anon.status===401&&admin.status===403&&member.status===403&&runCount()===runsBefore,JSON.stringify([anon.status,admin.status,member.status])));
const [anonRead,adminRead]=await Promise.all([evalGet('?pair='+P1.id,owner,{}),evalGet('?pair='+P1.id,owner,{cookie:adminS.cookie})]);
check('pair read: anonymous 401, admin 403',()=>assert.ok(anonRead.status===401&&adminRead.status===403));
check('no external network call (all HERMES and GitHub raw are mocked)',()=>assert.deepEqual(hermes.external,[]));
console.log(JSON.stringify({passed:passed.length}));
