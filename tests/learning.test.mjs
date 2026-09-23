import {roleFixture} from './helpers/role-fixture.mjs';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { SourceTextModule, SyntheticModule, createContext } from 'node:vm';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { webcrypto } from 'node:crypto';
import ts from 'typescript';
const sql=new DatabaseSync(':memory:');
for(const file of readdirSync('drizzle').filter(x=>x.endsWith('.sql')).sort())sql.exec(readFileSync('drizzle/'+file,'utf8'));
class Statement{constructor(query,values=[]){this.query=query;this.values=values}bind(...v){return new Statement(this.query,v)}async first(){return sql.prepare(this.query).get(...this.values)||null}async all(){return {results:sql.prepare(this.query).all(...this.values)}}async run(){const r=sql.prepare(this.query).run(...this.values);return {meta:{changes:Number(r.changes)}}}}
const DB={prepare:q=>new Statement(q),batch:async ss=>{sql.exec('BEGIN');try{const r=[];for(const s of ss)r.push(await s.run());sql.exec('COMMIT');return r}catch(e){sql.exec('ROLLBACK');throw e}}};
const runtime={AUTH_MODE:'legacy',DB,AGENCY_ENCRYPTION_KEY:Buffer.alloc(32,7).toString('base64')};

let now=Date.now();class Clock extends Date{constructor(...a){super(...(a.length?a:[now]))}static now(){return now}}
let calls=0,disconnect=false,researchBlocked=false,rejectAuth=false,researchCases=[];const provider=new Map();const captured=[];
const analysis={facts:'확인한 장면: 제품을 나누는 손',hook:'단면을 먼저 보여주는 장면이 관심을 끌었을 가능성',retention:'속재료 공개를 기다리는 구조일 가능성',sharing:'친구와 함께 먹을 상황을 떠올릴 가능성',context:'광고 집행 여부는 미확인',counterEvidence:'비슷한 저성과 콘텐츠와 비교 필요',unknowns:'시청 지속·전환·광고비 미확인',ideas:[{hypothesis:'단면 먼저 보여주면 도달 대비 공유가 증가할 것이다',variable:'첫 3초 장면',control:'완성 제품 → 소개 → 매장 안내',treatment:'단면 확대 → 동일 소개 → 동일 매장 안내',metric:'share_rate'}]};
const fakeFetch=async(url,options={})=>{
 if(url.endsWith('/v1/capabilities')){if(!new Headers(options.headers).has('Authorization'))return new Response('',{status:401});return Response.json({object:'hermes.api_server.capabilities',platform:'hermes-agent',features:{run_submission:true,run_status:true,run_stop:true,runs_idempotency:{durable:true}}})}if(url.endsWith('/v1/models'))return Response.json({data:[{id:'test'}]});
 if(options.method==='POST'&&url.endsWith('/v1/runs')){if(rejectAuth)return Response.json({error:'bad auth'},{status:403});const input=JSON.parse(options.body),key=new Headers(options.headers).get('Idempotency-Key');const known=[...provider.values()].find(x=>x.key===key);if(known)return Response.json({run_id:known.run_id});calls++;const id='run_'+calls;captured.push(input);let output=JSON.parse(input.input).task?roleFixture(input.input):'실제 공급자 모의 응답';if(input.instructions.includes('학습 규칙 초안'))output=JSON.stringify({guidance:'관찰된 방향이 떨어졌으므로 같은 조건에서는 피하고 요일을 통제해 재검증하세요.'});else if(input.instructions.includes('바이럴 콘텐츠 연구원'))output=input.input.includes('"case"')?JSON.stringify(analysis):JSON.stringify({cases:researchCases,blockers:'사용 가능한 조사 도구가 없습니다.'});provider.set(id,{run_id:id,object:'hermes.run',status:'completed',output,key});if(disconnect){disconnect=false;throw new Error('lost response')}return Response.json({run_id:id});}
 const id=url.split('/').pop();if(provider.has(id))return Response.json(provider.get(id));return Response.json({error:'not found'},{status:404});
};
const ctx=createContext({console,crypto:webcrypto,Response,Request,Headers,TextEncoder,TextDecoder,Uint8Array,Date:Clock,URL,AbortSignal,btoa,atob,fetch:fakeFetch,process:{env:{NODE_ENV:'production'}}});
const modules=new Map();const envModule=new SyntheticModule(['env'],function(){this.setExport('env',runtime)},{context:ctx});
function moduleFor(file){file=resolve(file);if(modules.has(file))return modules.get(file);const code=ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;const m=new SourceTextModule(code,{context:ctx,identifier:file});modules.set(file,m);return m}
async function load(file){const m=moduleFor(file);if(m.status==='unlinked')await m.link((spec,ref)=>{if(spec==='cloudflare:workers')return envModule;const f=spec.startsWith('@/')?resolve(spec.slice(2)):resolve(dirname(ref.identifier),spec);return moduleFor(f.endsWith('.ts')?f:f+'.ts')});return m}
const learn=await load('app/api/learning/route.ts');await learn.evaluate();const ai=await load('app/api/learning/run/route.ts');await ai.evaluate();const action=await load('app/api/action/route.ts');await action.evaluate();const run=await load('app/api/run/route.ts');await run.evaluate();const server=await load('lib/server.ts');const domain=await load('lib/learning.ts');const learningServer=await load('lib/learning-server.ts');
let owner='learning-test-owner';await server.namespace.seedBrands(owner);
const checks=[];const check=(label,v)=>{assert.ok(v,label);checks.push(label)};
async function req(mod,b,who=owner,method='POST',origin){const h={'content-type':'application/json'};if(who)h['oai-authenticated-user-id']=who;if(origin)h.origin=origin;const r=await mod.namespace[method](new Request('https://agency.test/api/learning',{method,headers:h,...(method==='POST'?{body:JSON.stringify(b)}:{})}));return {status:r.status,data:await r.json()}}
const act=(action,data={})=>req(learn,{action,...data});const snap=async()=> (await req(learn,null,owner,'GET')).data;
check('production learning requires authentication',(await req(learn,null,null,'GET')).status===401);
check('cross-origin mutation rejected',(await req(learn,{action:'add_case'},owner,'POST','https://evil.test')).status===403);
const input={brandId:'ofd',title:'실험용 사례',channel:'Instagram',url:'https://www.instagram.com/reel/test123/?utm_source=one',scope:'첫 장면과 캡션',observations:'도넛의 단면을 먼저 공개합니다.',views:100000,baselineViews:10000,comparison:'동일 계정·형식·게시 후 72시간'};
let r=await act('add_case',{data:input});check('source evidence saved',r.status===200);const caseId=r.data.id;
r=await act('add_case',{data:{...input,url:'https://instagram.com/reel/test123?utm_source=two',views:120000}});let d=await snap();check('tracking URLs preserve one case and another observation',r.data.id===caseId&&d.cases.length===1&&d.observations.length===1);
check('missing actual observation rejected',(await act('add_case',{data:{...input,observations:''}})).status===400);
check('javascript source rejected',(await act('add_case',{data:{...input,url:'javascript:alert(1)'}})).status===400);
check('channel source mismatch rejected',(await act('add_case',{data:{...input,url:'https://youtube.com/watch?v=x'}})).status===400);
check('cross-owner analysis prohibited',(await req(learn,{action:'save_analysis',caseId,data:analysis},'another-owner')).status===404);
r=await act('save_analysis',{caseId,data:analysis});check('facts and hypotheses persist separately',r.status===200);const analysisId=r.data.id;
r=await req(action,{action:'save_campaign',data:{brandId:'ofd',title:'Learning test',goal:'Increase sharing',channels:'Instagram',budget:0}});const cid=r.data.id;
const plan={title:'첫 장면 실험',...analysis.ideas[0],minSample:1000,minHours:72,minLift:10,conditions:'같은 예산·타깃·관찰 길이'};
r=await act('create_experiment',{analysisId,campaignId:cid,data:plan});const expId=r.data.id;check('predefined experiment saved',r.status===200);
check('rule cannot be adopted before results',(await act('adopt_rule',{id:expId,version:1,guidance:'x'})).status===409);
check('measurement cannot precede plan lock',(await act('save_results',{id:expId,version:1,data:{}})).status===409);
r=await act('start_experiment',{id:expId,version:1});check('plan starts and locks',r.status===200);
check('stale experiment revision rejected',(await act('start_experiment',{id:expId,version:1})).status===409);
const result={control:{denominator:2000,numerator:20,source:'A 자사 인사이트'},treatment:{denominator:2000,numerator:40,source:'B 자사 인사이트'},observedUntil:new Clock().toISOString(),comparable:true,notes:'대상과 관찰 조건 동일. 무작위 배정 없음.'};
r=await act('save_results',{id:expId,version:2,data:result});check('early high lift remains insufficient',r.data.assessment?.status==='insufficient');
check('early look carries an interim warning and no adopt recommendation',r.data.stats?.warning?.codes.includes('duration_below_plan')&&r.data.stats.recommendation==='inconclusive'&&r.data.stats.probBetter>0.95);
check('premature adoption prohibited',(await act('adopt_rule',{id:expId,version:3,guidance:'x'})).status===409);
now+=73*3600000;result.observedUntil=new Clock().toISOString();
r=await act('save_results',{id:expId,version:3,data:{...result,treatment:{...result.treatment,denominator:null}}});check('missing denominator is not zero or winning',r.data.assessment?.status==='insufficient'&&r.data.assessment.treatmentRate===null);
check('missing denominator yields no posterior',r.data.stats===null);
check('negative metric rejected',(await act('save_results',{id:expId,version:4,data:{...result,treatment:{...result.treatment,numerator:-1}}})).status===400);
r=await act('save_results',{id:expId,version:4,data:result});check('qualified result is observational improvement',r.data.assessment?.status==='promising'&&r.data.assessment.lift===100);
check('qualified result stores the posterior summary',r.data.stats?.probBetter===0.9953&&r.data.stats.recommendation==='adopt'&&r.data.stats.warning===null&&r.data.stats.n.control===2000&&r.data.stats.liftLow>0&&r.data.stats.liftHigh>r.data.stats.liftLow);
check('posterior summary is stored on the experiment',(await snap()).experiments.find(x=>x.id===expId).stats.probBetter===0.9953);
r=await act('adopt_rule',{id:expId,version:5,guidance:'단면을 먼저 보여주는 안을 시험 적용하되 인과관계 확정 아님'});const ruleId=r.data.id;check('trial rule adopted',r.status===200);
const eventActor=text=>JSON.parse(sql.prepare("SELECT data FROM records WHERE kind='event' AND data LIKE ? ORDER BY rowid DESC").get('%'+text+'%')?.data||'{}').actor;check('adoption event records the requester',eventActor('채택했습니다')?.id===owner);
await act('adopt_rule',{id:expId,version:5,guidance:'duplicate'});d=await snap();check('duplicate adoption produces one unchanged rule',d.rules.length===1&&d.rules[0].guidance.includes('단면'));
check('adopted rule stores actual direction and observed result',d.rules[0].direction==='test'&&d.rules[0].sourceAssessment.lift===100&&d.rules[0].sourceAssessment.controlSample===result.control.denominator);
check('adopted rule records the posterior summary and human decision',d.rules[0].sourceAssessment.stats?.probBetter===0.9953&&d.rules[0].sourceAssessment.decision==='adopt'&&!d.rules[0].sourceAssessment.decisionReason&&d.rules[0].evidenceLevel==='observational');
check('brand boundary enforced',!domain.namespace.ruleApplies(d.rules[0],'oda','Instagram',now));
check('channel boundary enforced',!domain.namespace.ruleApplies(d.rules[0],'ofd','YouTube',now));
check('expiry removes new retrieval',!domain.namespace.ruleApplies(d.rules[0],'ofd','Instagram',now+31*86400000));
const secret=await server.namespace.encrypt(JSON.stringify({provider:'hermes',key:'test-key',endpoint:'https://hermes.example.com'}));sql.prepare('INSERT INTO settings(owner,secret,model,updated_at) VALUES(?,?,?,?)').run(owner,secret,'HERMES test',new Clock().toISOString());
r=await req(run,{action:'start',campaignId:cid,role:'cmo'});check('campaign starts through Hermes',r.status===200);const job=r.data.id;
check('new campaign receives trial learning',JSON.parse(captured.at(-1).input).learning[0].id===ruleId);d=await snap();check('actual learning input snapshot persists',d.snapshots[0].rules[0].guidance.includes('단면'));
const sentSource=JSON.parse(captured.at(-1).input).learning[0].sourceAssessment,addedKeys=['stats','decision','decisionReason','decisionConflict'];
check('model input keeps the rule evidence without the posterior summary or decision record',sentSource.lift===100&&addedKeys.every(k=>!(k in sentSource))&&addedKeys.every(k=>!(k in d.snapshots[0].rules[0].sourceAssessment)));
r=await act('save_results',{id:expId,version:5,data:{...result,treatment:{...result.treatment,numerator:10}}});d=await snap();check('correction retires previous rule',d.rules[0].status==='retired');
check('re-check after a completed look warns as peeking and still recommends stop',r.data.stats?.warning?.codes.join()==='repeated_looks'&&r.data.stats.recommendation==='stop');
check('past campaign retains exact previous guidance',d.snapshots[0].rules[0].status==='active'&&d.snapshots[0].rules[0].guidance.includes('단면'));
r=await req(run,{action:'poll',id:job});check('campaign completes with snapshot intact',r.status===200&&r.data.status==='completed');
r=await req(ai,{action:'start_analysis',caseId});check('Hermes deep analysis submitted',r.status===200);const ajob=r.data.id;
check('analysis includes subsequent observations',JSON.parse(captured.at(-1).input).observations.length===1);
check('duplicate active analysis prevented',(await req(ai,{action:'start_analysis',caseId})).status===409);
check('foreign job cannot be polled',(await req(ai,{action:'poll',id:ajob},'another-owner')).status===409);
r=await req(ai,{action:'poll',id:ajob});check('structured analysis and test variants saved',r.status===200&&r.data.status==='completed');d=await snap();const count=d.analyses.length;await req(ai,{action:'poll',id:ajob});check('poll replay does not duplicate analysis',(await snap()).analyses.length===count);
r=await req(ai,{action:'start_discovery',brandId:'ofd',query:'실제 사례를 조사'});await req(ai,{action:'poll',id:r.data.id});d=await snap();check('unavailable source does not fabricate findings',d.cases.length===1&&d.jobs.some(j=>j.role==='viral_discovery'&&j.status==='failed'));
const discoveryInstructions=captured.filter(x=>x.instructions.includes('바이럴 콘텐츠 연구원')&&!x.input.includes('"case"')).at(-1).instructions;
check('discovery names per-channel source access paths',['https://www.tiktok.com/oembed?url=','browser_navigate','youtube.com/oembed','blockers'].every(x=>discoveryInstructions.includes(x)));
check('secrets excluded from learning endpoint',!JSON.stringify(d).includes('test-key'));

check('Korean channel aliases retrieve rules',domain.namespace.ruleApplies({...d.rules[0],status:'active'},'ofd','인스타그램, 매장',now));
researchCases=[{...input,observedAt:new Clock().toISOString(),views:130000}];r=await req(ai,{action:'start_discovery',brandId:'ofd',query:'재관찰'});await req(ai,{action:'poll',id:r.data.id});d=await snap();check('automated revisit preserves subsequent observation',d.cases.length===1&&d.observations.length===2);
rejectAuth=true;r=await req(ai,{action:'start_analysis',caseId});d=await snap();check('explicit credential rejection becomes failed',r.status===400&&!d.jobs.some(j=>j.status==='uncertain'));
rejectAuth=false;disconnect=true;const before=calls;r=await req(ai,{action:'start_analysis',caseId});d=await snap();const uncertain=d.jobs.find(j=>j.status==='uncertain');check('lost submission is held without duplicate execution',r.status===502&&uncertain&&calls===before+1);
check('active work blocks endpoint replacement',(await req(action,{action:'save_hermes',endpoint:'https://other.example.com',key:'a-valid-test-secret-12345'})).status===409);
r=await req(action,{action:'save_hermes',endpoint:'https://hermes.example.com',key:'a-valid-test-secret-12345'});check('same gateway credentials can recover while work is active',r.status===200);
r=await req(ai,{action:'recover',id:uncertain.id});check('recovery reuses durable provider submission',r.status===200&&calls===before+1);await req(ai,{action:'poll',id:uncertain.id});
check('unknown connection cannot block disconnection after terminal jobs',(await req(action,{action:'disconnect'})).status===200);
await act('adopt_rule',{id:expId,version:6,guidance:'성과가 떨어진 조건을 재검증'});d=await snap();const caution=d.rules.find(x=>x.direction==='caution');check('negative results persist as caution with measurement evidence',caution?.sourceAssessment.status==='not_supported'&&caution.sourceAssessment.treatmentRate===10/result.treatment.denominator);
check('stop matching the recommendation needs no reason despite peeking',caution.sourceAssessment.decision==='stop'&&caution.sourceAssessment.stats.recommendation==='stop'&&caution.sourceAssessment.stats.warning.codes.includes('repeated_looks'));
// Phase 0 ③ — 국내 로컬 채널이 학습 루프에 진입한다.
const catalog=await load('lib/store-marketing.ts');await catalog.evaluate();
const channels=await load('lib/channels.ts');await channels.evaluate();
check('every store channel maps to a learning channel name',catalog.namespace.channelCatalog.every(c=>channels.namespace.storeChannelName(c.key)));
const localCase={brandId:'ofd',channel:'네이버 플레이스',url:'https://m.place.naver.com/restaurant/1234567/home',title:'플레이스 메뉴 개편',scope:'공개 플레이스 페이지에서 확인',observations:'대표 메뉴 사진과 가격 노출 위치를 확인했습니다.'};
check('local Korean channel accepts a case',(await act('add_case',{data:localCase})).status===200);
check('global channel keeps strict host validation',(await act('add_case',{data:{...localCase,channel:'Instagram'}})).status===400);
check('conversion-only channels cannot be registered as cases',(await act('add_case',{data:{...localCase,channel:'카카오톡 · 재방문'}})).status===400);
check('local channel aliases retrieve rules',domain.namespace.ruleApplies({...caution,status:'active',channel:'네이버 플레이스',expiresAt:new Clock(now+86400000).toISOString()},'ofd','네이버 플레이스, 블로그',now));

// Phase 0 ② — 만료 규칙 재검토 큐.
const campaignRules=()=>learningServer.namespace.learningContext(owner,{brandId:'ofd',channels:'Instagram'});
now+=25*86400000;
check('rule nearing expiry enters the review queue',domain.namespace.ruleNeedsReview(caution,now));
now+=6*86400000;
check('expired rule leaves the campaign context',!(await campaignRules()).some(x=>x.id===caution.id));
check('renewal requires a reason',(await act('renew_rule',{id:caution.id,version:1})).status===400);
r=await act('renew_rule',{id:caution.id,version:1,reason:'다음 캠페인까지 유지하고 재측정 예정'});
check('renewal extends expiry and records the count',r.status===200&&r.data.renewCount===1&&Date.parse(r.data.expiresAt)>now);
check('renewed rule returns with its unverified extension visible',(await campaignRules()).some(x=>x.id===caution.id&&x.renewCount===1&&x.renewReason.includes('재측정')));

r=await act('retest_rule',{id:caution.id,version:2});
check('retest clones the experiment as a new draft',r.status===200);
d=await snap();const retest=d.experiments.find(x=>x.id===r.data.id);
check('retest starts unmeasured',retest.status==='draft'&&retest.result===null&&retest.assessment===null&&retest.title.startsWith('재검증 · '));
check('retest starts without statistics or looks',retest.stats===null&&retest.completedLooks===0);
check('retest keeps the original experiment untouched',d.experiments.find(x=>x.id===expId).status==='evaluated');
check('repeated retest is idempotent',(await act('retest_rule',{id:caution.id,version:2})).data.duplicate===true);

const storeRule={id:'store:synthetic:1',origin:'store',storeId:'store-1',brandId:'ofd',channel:'당근',experimentId:'store-exp',experimentVersion:1,caseId:'',title:'점포 승격 규칙',guidance:'가격 안내 유지',scope:'같은 상품·가격',evidenceLevel:'observational',status:'active',version:1,expiresAt:new Clock(now+86400000).toISOString(),createdAt:new Clock().toISOString(),updatedAt:new Clock().toISOString()};
await server.namespace.recordStatement(owner,'learning_rule',storeRule.id,storeRule,'ofd').run();
check('store rules cannot be retested from the viral lab',(await act('retest_rule',{id:storeRule.id,version:1})).status===409);

check('retire closes the rule',(await act('retire_rule',{id:caution.id,version:2})).status===200);
check('retired rule leaves the campaign context',!(await campaignRules()).some(x=>x.id===caution.id));
check('retired rule cannot be renewed',(await act('renew_rule',{id:caution.id,version:3,reason:'재시도'})).status===409);

// Phase 0 ① — 채택 문구 초안. 초안일 뿐 채택은 사람이 한다.
const rulesBefore=(await snap()).rules.length;
sql.prepare('INSERT INTO settings(owner,secret,model,updated_at) VALUES(?,?,?,?) ON CONFLICT(owner) DO UPDATE SET secret=excluded.secret').run(owner,secret,'HERMES test',new Clock().toISOString());
r=await req(ai,{action:'start_guidance',experimentId:retest.id,version:1});
check('guidance draft rejects an unmeasured experiment',r.status===409&&r.data.error.includes('판정 결과'));
r=await req(ai,{action:'start_guidance',experimentId:expId,version:6});
check('guidance draft starts for a qualified result',r.status===200);
check('duplicate guidance run is blocked',(await req(ai,{action:'start_guidance',experimentId:expId,version:6})).status===409);
await req(ai,{action:'poll',id:r.data.id});
d=await snap();const draft=d.guidances.find(g=>g.id===expId+':6');
check('guidance draft is stored against the experiment version',!!draft&&draft.guidance.includes('재검증'));
check('guidance draft never adopts a rule by itself',d.rules.length===rulesBefore);
check('guidance draft carries no provider secrets',!JSON.stringify(d.guidances).includes('test-key'));

// B4 1부 — 사후확률 권고와 사람 확정. 권고와 다르게 확정하거나 중간 확인 경고 뒤 채택해도 막지 않는다. 어긋남과 선택 사유를 규칙에 기록한다.
async function measured(title,control,treatment,extra={}){
 const e=(await act('create_experiment',{analysisId,campaignId:cid,data:{...plan,title,minSample:100,minHours:1}})).data.id;await act('start_experiment',{id:e,version:1});now+=2*3600000;
 const saved=await act('save_results',{id:e,version:2,data:{...result,control:{...result.control,...control},treatment:{...result.treatment,...treatment},observedUntil:new Clock().toISOString(),...extra}});return {id:e,saved};
}
const counts=(c,t)=>({control:{...result.control,denominator:c[1],numerator:c[0]},treatment:{...result.treatment,denominator:t[1],numerator:t[0]}});
let x=await measured('권고 불일치 실험',{denominator:100,numerator:10},{denominator:100,numerator:13});
check('lift above target can still be statistically inconclusive',x.saved.data.assessment.status==='promising'&&x.saved.data.stats.recommendation==='inconclusive'&&x.saved.data.stats.probBetter<0.95);
r=await act('adopt_rule',{id:x.id,version:3,guidance:'시험 적용',reason:'   '});d=await snap();
const overridden=d.rules.find(z=>z.experimentId===x.id);
check('adopting against the recommendation needs no reason and records the conflict',r.status===200&&overridden.sourceAssessment.decision==='adopt'&&overridden.sourceAssessment.decisionConflict==='mismatch'&&!('decisionReason' in overridden.sourceAssessment)&&overridden.sourceAssessment.stats.recommendation==='inconclusive');
check('rule promotion gate is unchanged',overridden.evidenceLevel==='observational'&&overridden.direction==='test'&&overridden.status==='active');

x=await measured('반복 확인 실험',{denominator:1000,numerator:100},{denominator:1000,numerator:200});
check('first completed look recommends adopt',x.saved.data.stats.recommendation==='adopt'&&x.saved.data.stats.warning===null);
r=await act('save_results',{id:x.id,version:3,data:{...result,...counts([100,1000],[200,1000]),notes:'메모만 고침',observedUntil:new Clock().toISOString()}});
check('re-saving the same counts is not a new look',r.data.stats.warning===null&&r.data.stats.recommendation==='adopt'&&r.data.stats.looks===0);
r=await act('save_results',{id:x.id,version:4,data:{...result,...counts([110,1100],[220,1100]),observedUntil:new Clock().toISOString()}});
check('a completed look with new counts raises the peeking warning',r.data.stats.warning?.codes.join()==='repeated_looks'&&r.data.stats.recommendation==='inconclusive'&&r.data.stats.looks===1);
d=await snap();
check('the stored peeking warning is served on read',d.experiments.find(z=>z.id===x.id).stats.warning?.codes.join()==='repeated_looks');
r=await act('adopt_rule',{id:x.id,version:5,guidance:'시험 적용',reason:'두 번째 입력은 계획에 있던 측정 연장'});d=await snap();
const warned=d.rules.find(z=>z.experimentId===x.id);
check('warned adoption records the interim conflict and the optional reason',r.status===200&&warned.sourceAssessment.decisionConflict==='interim'&&warned.sourceAssessment.decisionReason.includes('측정 연장'));

x=await measured('비교 가능성 정정 실험',{denominator:1000,numerator:100},{denominator:1000,numerator:200},{comparable:false});
check('comparable:false is not recommended for adoption',x.saved.data.assessment.status==='insufficient'&&x.saved.data.stats.recommendation!=='adopt'&&x.saved.data.stats.warning?.codes.join()==='not_comparable');
r=await act('save_results',{id:x.id,version:3,data:{...result,...counts([100,1000],[200,1000]),comparable:true,observedUntil:new Clock().toISOString()}});
check('confirming comparability with the same counts is the first completed look',r.data.assessment.status==='promising'&&r.data.stats.warning===null&&r.data.stats.recommendation==='adopt');
r=await act('save_results',{id:x.id,version:4,data:{...result,...counts([110,1100],[220,1100]),observedUntil:new Clock().toISOString()}});
check('only comparable completed looks are counted',r.data.stats.looks===1&&r.data.stats.warning?.codes.join()==='repeated_looks');
x=await measured('비교 불가 뒤 재측정 실험',{denominator:1000,numerator:100},{denominator:1000,numerator:200},{comparable:false});
r=await act('save_results',{id:x.id,version:3,data:{...result,...counts([110,1100],[220,1100]),comparable:true,observedUntil:new Clock().toISOString()}});
check('a non-comparable look is not a completed look',r.data.stats.looks===0&&r.data.stats.warning===null&&r.data.stats.recommendation==='adopt');

x=await measured('목표 미달 대표본 실험',{denominator:1000000,numerator:50000},{denominator:1000000,numerator:51000});
check('a large-sample lift below the target is not recommended for adoption',x.saved.data.assessment.status==='inconclusive'&&x.saved.data.stats.probBetter>0.99&&x.saved.data.stats.recommendation==='inconclusive');
x=await measured('대조안 반응 0 실험',{denominator:1000,numerator:0},{denominator:1000,numerator:30});
check('a zero control response is not recommended for adoption',x.saved.data.assessment.status==='insufficient'&&x.saved.data.stats.recommendation==='inconclusive');

x=await measured('이벤트 집계 실험',{denominator:100,numerator:150},{denominator:100,numerator:200});
check('event counts above the denominator keep the old judgement without statistics',x.saved.data.assessment.status==='promising'&&x.saved.data.stats===null);
r=await act('adopt_rule',{id:x.id,version:3,guidance:'시험 적용'});d=await snap();
check('without statistics the human decides without a reason',r.status===200&&d.rules.find(z=>z.experimentId===x.id).sourceAssessment.stats===null);

// 이 기능 이전 형식(stats·completedLooks 없음)의 실험. 저장하지 않고 조회·채택 때 요약을 계산한다.
const base=d.experiments.find(z=>z.id===x.id);
async function legacyRecord(id,c,t){const e={...base,id,title:'이전 형식 · '+id,result:{...base.result,...counts(c,t),comparable:true}};e.assessment=domain.namespace.evaluateExperiment(e,e.result);delete e.stats;delete e.completedLooks;await server.namespace.recordStatement(owner,'viral_experiment',id,e,cid).run();return e}
const legacy=await legacyRecord('legacy-exp',[100,1000],[200,1000]);
d=await snap();const shown=d.experiments.find(z=>z.id==='legacy-exp');
check('legacy experiment shows computed statistics on read',shown.stats?.probBetter>0.99&&shown.stats.recommendation==='adopt'&&!('completedLooks' in shown));
check('legacy experiment adopts as before',(await act('adopt_rule',{id:'legacy-exp',version:legacy.version,guidance:'이전 형식 채택'})).status===200);
const mismatch=await legacyRecord('legacy-mismatch',[100,1000],[113,1000]);
r=await act('adopt_rule',{id:'legacy-mismatch',version:mismatch.version,guidance:'이전 형식 채택'});d=await snap();
const legacyRule=d.rules.find(z=>z.experimentId==='legacy-mismatch');
check('legacy promising result below 0.95 still adopts without a reason',mismatch.assessment.status==='promising'&&r.status===200&&legacyRule.sourceAssessment.stats?.recommendation==='inconclusive'&&legacyRule.sourceAssessment.decisionConflict==='mismatch');
const relooked=await legacyRecord('legacy-relook',[100,1000],[200,1000]);
r=await act('save_results',{id:'legacy-relook',version:relooked.version,data:{...result,...counts([110,1100],[220,1100]),observedUntil:new Clock().toISOString()}});
check('a legacy plan-met result counts as one completed look',r.status===200&&r.data.stats.looks===1&&r.data.stats.warning?.codes.join()==='repeated_looks');

// 결정 7 후속: 캠페인 삭제 때 동결한 원천 실험 요약을 학습 조회가 함께 돌려준다(화면이 보존 규칙 옆에 보여 준다).
await server.namespace.recordStatement(owner,'viral_experiment_summary','frozen-exp',{id:'frozen-exp',experimentId:'frozen-exp',experimentVersion:2,brandId:'ofd',campaignId:'gone',channel:'Instagram',title:'삭제된 실험',hypothesis:'h',metric:'saves',minSample:100,minHours:24,minLift:10,status:'completed',assessment:{status:'promising',label:'관찰상 개선',controlRate:0.1,treatmentRate:0.2,lift:100},controlSample:100,treatmentSample:100,startedAt:null,observedUntil:null,adoptedRuleIds:['r1'],frozenAt:new Clock().toISOString(),sourceCampaignDeleted:{at:new Clock().toISOString(),by:null}},'ofd').run();
const withSummary=await snap();
check('learning GET returns frozen experiment summaries',Array.isArray(withSummary.experimentSummaries)&&withSummary.experimentSummaries.some(x=>x.experimentId==='frozen-exp'&&x.title==='삭제된 실험'));
check('frozen summaries of another owner are not returned',(await req(learn,null,'someone-else','GET')).data.experimentSummaries?.length===0);

console.log(JSON.stringify({passed:checks.length,checks},null,2));
