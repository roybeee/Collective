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
const runtime={DB,AGENCY_ENCRYPTION_KEY:Buffer.alloc(32,7).toString('base64')};

let now=Date.now();class Clock extends Date{constructor(...a){super(...(a.length?a:[now]))}static now(){return now}}
let calls=0,disconnect=false,researchBlocked=false,rejectAuth=false,researchCases=[];const provider=new Map();const captured=[];
const analysis={facts:'확인한 장면: 제품을 나누는 손',hook:'단면을 먼저 보여주는 장면이 관심을 끌었을 가능성',retention:'속재료 공개를 기다리는 구조일 가능성',sharing:'친구와 함께 먹을 상황을 떠올릴 가능성',context:'광고 집행 여부는 미확인',counterEvidence:'비슷한 저성과 콘텐츠와 비교 필요',unknowns:'시청 지속·전환·광고비 미확인',ideas:[{hypothesis:'단면 먼저 보여주면 도달 대비 공유가 증가할 것이다',variable:'첫 3초 장면',control:'완성 제품 → 소개 → 매장 안내',treatment:'단면 확대 → 동일 소개 → 동일 매장 안내',metric:'share_rate'}]};
const fakeFetch=async(url,options={})=>{
 if(url.endsWith('/v1/capabilities')){if(!new Headers(options.headers).has('Authorization'))return new Response('',{status:401});return Response.json({object:'hermes.api_server.capabilities',platform:'hermes-agent',features:{run_submission:true,run_status:true,run_stop:true,runs_idempotency:{durable:true}}})}if(url.endsWith('/v1/models'))return Response.json({data:[{id:'test'}]});
 if(options.method==='POST'&&url.endsWith('/v1/runs')){if(rejectAuth)return Response.json({error:'bad auth'},{status:403});const input=JSON.parse(options.body),key=new Headers(options.headers).get('Idempotency-Key');const known=[...provider.values()].find(x=>x.key===key);if(known)return Response.json({run_id:known.run_id});calls++;const id='run_'+calls;captured.push(input);let output='실제 공급자 모의 응답';if(input.instructions.includes('바이럴 콘텐츠 연구원'))output=input.input.includes('"case"')?JSON.stringify(analysis):JSON.stringify({cases:researchCases,blockers:'사용 가능한 조사 도구가 없습니다.'});provider.set(id,{run_id:id,object:'hermes.run',status:'completed',output,key});if(disconnect){disconnect=false;throw new Error('lost response')}return Response.json({run_id:id});}
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
check('premature adoption prohibited',(await act('adopt_rule',{id:expId,version:3,guidance:'x'})).status===409);
now+=73*3600000;result.observedUntil=new Clock().toISOString();
r=await act('save_results',{id:expId,version:3,data:{...result,treatment:{...result.treatment,denominator:null}}});check('missing denominator is not zero or winning',r.data.assessment?.status==='insufficient'&&r.data.assessment.treatmentRate===null);
check('negative metric rejected',(await act('save_results',{id:expId,version:4,data:{...result,treatment:{...result.treatment,numerator:-1}}})).status===400);
r=await act('save_results',{id:expId,version:4,data:result});check('qualified result is observational improvement',r.data.assessment?.status==='promising'&&r.data.assessment.lift===100);
r=await act('adopt_rule',{id:expId,version:5,guidance:'단면을 먼저 보여주는 안을 시험 적용하되 인과관계 확정 아님'});const ruleId=r.data.id;check('trial rule adopted',r.status===200);
await act('adopt_rule',{id:expId,version:5,guidance:'duplicate'});d=await snap();check('duplicate adoption produces one unchanged rule',d.rules.length===1&&d.rules[0].guidance.includes('단면'));
check('adopted rule stores actual direction and observed result',d.rules[0].direction==='test'&&d.rules[0].sourceAssessment.lift===100&&d.rules[0].sourceAssessment.controlSample===result.control.denominator);
check('brand boundary enforced',!domain.namespace.ruleApplies(d.rules[0],'oda','Instagram',now));
check('channel boundary enforced',!domain.namespace.ruleApplies(d.rules[0],'ofd','YouTube',now));
check('expiry removes new retrieval',!domain.namespace.ruleApplies(d.rules[0],'ofd','Instagram',now+31*86400000));
const secret=await server.namespace.encrypt(JSON.stringify({provider:'hermes',key:'test-key',endpoint:'https://hermes.example.com'}));sql.prepare('INSERT INTO settings(owner,secret,model,updated_at) VALUES(?,?,?,?)').run(owner,secret,'HERMES test',new Clock().toISOString());
r=await req(run,{action:'start',campaignId:cid,role:'cmo'});check('campaign starts through Hermes',r.status===200);const job=r.data.id;
check('new campaign receives trial learning',JSON.parse(captured.at(-1).input).learning[0].id===ruleId);d=await snap();check('actual learning input snapshot persists',d.snapshots[0].rules[0].guidance.includes('단면'));
r=await act('save_results',{id:expId,version:5,data:{...result,treatment:{...result.treatment,numerator:10}}});d=await snap();check('correction retires previous rule',d.rules[0].status==='retired');
check('past campaign retains exact previous guidance',d.snapshots[0].rules[0].status==='active'&&d.snapshots[0].rules[0].guidance.includes('단면'));
r=await req(run,{action:'poll',id:job});check('campaign completes with snapshot intact',r.status===200&&r.data.status==='completed');
r=await req(ai,{action:'start_analysis',caseId});check('Hermes deep analysis submitted',r.status===200);const ajob=r.data.id;
check('analysis includes subsequent observations',JSON.parse(captured.at(-1).input).observations.length===1);
check('duplicate active analysis prevented',(await req(ai,{action:'start_analysis',caseId})).status===409);
check('foreign job cannot be polled',(await req(ai,{action:'poll',id:ajob},'another-owner')).status===409);
r=await req(ai,{action:'poll',id:ajob});check('structured analysis and test variants saved',r.status===200&&r.data.status==='completed');d=await snap();const count=d.analyses.length;await req(ai,{action:'poll',id:ajob});check('poll replay does not duplicate analysis',(await snap()).analyses.length===count);
r=await req(ai,{action:'start_discovery',brandId:'ofd',query:'실제 사례를 조사'});await req(ai,{action:'poll',id:r.data.id});d=await snap();check('unavailable source does not fabricate findings',d.cases.length===1&&d.jobs.some(j=>j.role==='viral_discovery'&&j.status==='failed'));
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
console.log(JSON.stringify({passed:checks.length,checks},null,2));
