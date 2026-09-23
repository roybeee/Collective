import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { SourceTextModule, SyntheticModule, createContext } from 'node:vm';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { webcrypto, createHash } from 'node:crypto';
import ts from 'typescript';
import { testRuntime } from './helpers/runtime.mjs';
const sql=new DatabaseSync(':memory:');
for(const file of readdirSync('drizzle').filter(x=>x.endsWith('.sql')).sort())sql.exec(readFileSync('drizzle/'+file,'utf8'));
class Statement{constructor(query,values=[]){this.query=query;this.values=values}bind(...v){return new Statement(this.query,v)}async first(){return sql.prepare(this.query).get(...this.values)||null}async all(){return {results:sql.prepare(this.query).all(...this.values)}}async run(){const r=sql.prepare(this.query).run(...this.values);return {meta:{changes:Number(r.changes)}}}}
const DB={prepare:q=>new Statement(q),batch:async ss=>{sql.exec('BEGIN');try{const r=[];for(const s of ss)r.push(await s.run());sql.exec('COMMIT');return r}catch(e){sql.exec('ROLLBACK');throw e}}};
const runtime={DB,AUTH_MODE:'legacy',AGENCY_ENCRYPTION_KEY:Buffer.alloc(32,7).toString('base64')};
let callCount=0,providerFail=false;const provider=new Map();
const fakeFetch=async(url,options={})=>{if(url.includes('/models/'))return Response.json({id:'test-model'});if(options.method==='POST'&&url.endsWith('/responses')){callCount++;if(providerFail)throw new Error('network lost');const b=JSON.parse(options.body),id='resp_test'+callCount;provider.set(id,{id,status:'completed',metadata:b.metadata,output:[{content:[{type:'output_text',text:'## Verified test output\nThis is a mock provider response.'}]}],usage:{total_tokens:42}});return Response.json({id,status:'completed'})}const id=url.split('/').pop();if(provider.has(id))return Response.json(provider.get(id));return Response.json({error:{message:'Not found'}},{status:404})};
const ctx=createContext({console,crypto:webcrypto,Response,Request,Headers,TextEncoder,TextDecoder,Uint8Array,Date,URL,AbortSignal,btoa,atob,fetch:fakeFetch,process:{env:{NODE_ENV:'production'}}});
const modules=new Map();const envModule=new SyntheticModule(['env'],function(){this.setExport('env',runtime)},{context:ctx});
function moduleFor(file){file=resolve(file);if(modules.has(file))return modules.get(file);const code=ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;const m=new SourceTextModule(code,{context:ctx,identifier:file});modules.set(file,m);return m}
async function load(file){const m=moduleFor(file);if(m.status==='unlinked')await m.link((spec,ref)=>{if(spec==='cloudflare:workers')return envModule;const f=spec.startsWith('@/')?resolve(spec.slice(2)):resolve(dirname(ref.identifier),spec);return moduleFor(f.endsWith('.ts')?f:f+'.ts')});return m}
const action=await load('app/api/action/route.ts');await action.evaluate();const workspace=await load('app/api/workspace/route.ts');await workspace.evaluate();const run=await load('app/api/run/route.ts');await run.evaluate();
let owner='qa-owner-with-a-production-length-authenticated-user-id';const passed=[];const check=(name,val)=>{assert.ok(val,name);passed.push(name)};
async function request(mod,method,b,override={}){const headers={'Content-Type':'application/json','oai-authenticated-user-id':owner,...override};for(const k in headers)if(headers[k]===null)delete headers[k];const r=await mod.namespace[method](new Request('https://agency.test/api/test',{method,headers,...(b?{body:JSON.stringify(b)}:{})}));return {status:r.status,data:await r.json()}}
const act=(name,b={})=>request(action,'POST',{action:name,...b});const snapshot=()=>request(workspace,'GET');
// 삭제 영향 조회 API(GET /api/campaigns/[id]/deletion)와 캠페인 조회 API. Next 동적 경로처럼 params를 Promise로 넘긴다.
const deletionRoute=await load('app/api/campaigns/[id]/deletion/route.ts');await deletionRoute.evaluate();const detailRoute=await load('app/api/campaigns/[id]/route.ts');await detailRoute.evaluate();
async function routeGet(mod,path,id,override={}){const headers={'oai-authenticated-user-id':owner,...override};for(const k in headers)if(headers[k]===null)delete headers[k];const r=await mod.namespace.GET(new Request('https://agency.test'+path,{headers}),{params:Promise.resolve({id})});return {status:r.status,data:await r.json()}}
const preview=(id,override)=>routeGet(deletionRoute,`/api/campaigns/${id}/deletion`,id,override);
const sorted=o=>JSON.stringify(Object.fromEntries(Object.entries(o||{}).sort(([a],[b])=>a.localeCompare(b))));

await snapshot();
const created=await act('save_campaign',{data:{brandId:'ofd',title:'Delete test',goal:'Deletion only',budget:0}});const cid=created.data.id;
const payload={id:cid,version:1,confirmed:true};
check('deletion requires authentication',(await request(action,'POST',{action:'delete_campaign',...payload},{'oai-authenticated-user-id':null})).status===401);
check('cross-origin deletion rejected',(await request(action,'POST',{action:'delete_campaign',...payload},{origin:'https://other.test'})).status===403);
check('another owner cannot delete campaign',(await request(action,'POST',{action:'delete_campaign',...payload},{'oai-authenticated-user-id':'other-owner'})).status===404);
check('confirmation required',(await act('delete_campaign',{...payload,confirmed:false})).status===400);
check('stale campaign rejected',(await act('delete_campaign',{...payload,version:0})).status===409);
check('deletion preview requires authentication',(await preview(cid,{'oai-authenticated-user-id':null})).status===401);
check('another owner cannot preview deletion',(await preview(cid,{'oai-authenticated-user-id':'other-owner'})).status===404);
const server=await load('lib/server.ts');await server.evaluate();const put=(kind,id,data,parent='',user=owner)=>server.namespace.recordStatement(user,kind,id,data,parent).run();
const has=(kind,id,user=owner)=>!!sql.prepare('SELECT id FROM records WHERE owner=? AND kind=? AND id=?').get(user,kind,`${user}:${kind}:${id}`);
const read=(kind,id)=>JSON.parse(sql.prepare('SELECT data FROM records WHERE owner=? AND kind=? AND id=?').get(owner,kind,`${owner}:${kind}:${id}`)?.data||'null');
const addJob=(id,campaignId,role,status)=>sql.prepare('INSERT INTO jobs(id,owner,campaign_id,role,status,model,campaign_version,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)').run(id,owner,campaignId,role,status,'mock',1,'now','now');
const job='delete-job';addJob(job,cid,'cmo','uncertain');
check('uncertain provider execution prevents deletion',(await act('delete_campaign',payload)).status===409&&has('campaign',cid));
const blockedPlan=(await preview(cid)).data;check('preview reports running work as blocking',blockedPlan.deletable===false&&blockedPlan.blockedReason.includes('AI 작업'));
sql.prepare("UPDATE jobs SET status='completed' WHERE id=?").run(job);
await put('brief_draft','linked-draft',{id:'linked-draft',campaignId:cid,status:'queued'});
check('active linked brief prevents deletion',(await act('delete_campaign',payload)).status===409);
await put('brief_draft','linked-draft',{id:'linked-draft',campaignId:cid,status:'completed'});
await put('brief_draft','saved-draft',{id:'saved-draft',savedCampaignId:cid,status:'completed'});
await put('brief_draft','unrelated-draft',{id:'unrelated-draft',input:{title:'unrelated'},status:'queued'});
for(const kind of ['artifact','history','metric','event','learning_snapshot','campaign_directive'])await put(kind,'linked-'+kind,{id:'linked-'+kind,campaignId:cid},cid);
// 결정 7(b) fixture(합성): 규칙 두 개(활성·이미 종료)를 낳은 원천 실험, 규칙 없는 실험, 실험 하위 기록(개정 이력·측정 초안·수집 대상·채택 문구 초안)과 문구 초안 작업.
const exp={id:'exp',brandId:'ofd',campaignId:cid,caseId:'source',analysisId:'analysis',title:'첫 장면 질문형',channel:'Instagram',hypothesis:'첫 장면을 질문형으로 바꾸면 공유가 는다',variable:'첫 장면',control:'대조 원문 문장',treatment:'실험 원문 문장',metric:'share_rate',minSample:100,minHours:24,minLift:10,conditions:'조건 원문 문장',version:3,status:'evaluated',startedAt:'2026-09-01T00:00:00.000Z',createdAt:'2026-09-01T00:00:00.000Z',updatedAt:'2026-09-03T00:00:00.000Z',result:{control:{denominator:1000,numerator:10,source:'수치 출처 원문'},treatment:{denominator:1000,numerator:20,source:'수치 출처 원문'},comparable:true,notes:'메모 원문',observedUntil:'2026-09-03T00:00:00.000Z',recordedAt:'2026-09-03T00:00:00.000Z'},assessment:{status:'promising',label:'관찰상 개선',controlRate:0.01,treatmentRate:0.02,lift:100,reasons:[]}};
await put('viral_experiment','exp',exp,cid);await put('experiment_revision','exp:1',{id:'exp'},'exp');
const rule={origin:'viral',direction:'test',id:'exp:3',brandId:'ofd',channel:'Instagram',experimentId:'exp',experimentVersion:3,caseId:'source',title:'첫 장면 질문형',guidance:'질문형 첫 장면을 시험 적용',scope:'같은 채널·같은 시간대',evidenceLevel:'observational',status:'active',version:1,expiresAt:'2026-10-03T00:00:00.000Z',createdAt:'2026-09-03T00:00:00.000Z',updatedAt:'2026-09-03T00:00:00.000Z'};
const legacyRule=Object.fromEntries(Object.entries({...rule,id:'exp:2',experimentVersion:2,status:'retired',version:2}).filter(([key])=>key!=='origin'));
await put('learning_rule','exp:3',rule,'ofd');await put('learning_rule','exp:2',legacyRule,'ofd');
await put('viral_experiment','exp-plain',{id:'exp-plain',brandId:'ofd',campaignId:cid,title:'규칙 없는 실험',status:'draft',version:1},cid);
await put('measurement_draft','exp',{id:'exp',experimentId:'exp'},cid);await put('measurement_source','exp:control',{id:'exp:control',experimentId:'exp'},'exp');await put('learning_guidance','exp:3',{id:'exp:3',experimentId:'exp',guidance:'초안 원문'},'exp');
const guideJob='guide-job';addJob(guideJob,'guidance:exp','viral_guidance','completed');
await put('learning_task',guideJob,{id:guideJob,kind:'guidance',brandId:'ofd',experimentId:'exp'});await put('learning_job_output',guideJob,{id:guideJob,output:'초안 원문'});await put('hermes_submission',guideJob,{body:'experiment input'});
const caseJob='case-job';addJob(caseJob,'case:source','viral_analysis','completed');await put('learning_task',caseJob,{id:caseJob,kind:'analysis',brandId:'ofd',caseId:'source'});
// 점포 출처 규칙과 캠페인에 연결된 점포 실험은 현행대로 남는다(회귀 고정).
const storeExperiment={id:'sx',storeId:'st1',brandId:'ofd',campaignId:cid,title:'점포 실험',status:'closed',version:4};const storeRule={...rule,origin:'store',id:'store:sx:4',storeId:'st1',experimentId:'sx',experimentVersion:4,direction:'caution'};
await put('store','st1',{id:'st1',brandId:'ofd'},'ofd');await put('store_experiment','sx',storeExperiment,'st1');await put('learning_rule','store:sx:4',storeRule,'ofd');
await put('hermes_submission',job,{body:'job input'});await put('hermes_submission','brief-linked-draft',{body:'brief input'});await put('hermes_submission','brief-saved-draft',{body:'brief input'});
await put('viral_case','source',{id:'source'},'ofd');await put('viral_analysis','analysis',{id:'analysis'},'source');
await put('learning_snapshot','other-snapshot',{rules:[{id:'exp:3'}]},'other-campaign');await put('learning_rule','other-rule',{id:'other-rule',origin:'viral',experimentId:'other-exp',status:'active',version:1},'ofd');
await put('campaign',cid,{id:cid},'','other-owner');await put('artifact','foreign',{id:'foreign'},cid,'other-owner');
sql.prepare("UPDATE jobs SET status='queued' WHERE id=?").run(guideJob);
check('running rule-draft job of a campaign experiment prevents deletion',(await act('delete_campaign',payload)).status===409&&has('campaign',cid));
sql.prepare("UPDATE jobs SET status='completed' WHERE id=?").run(guideJob);
const ownerRecords=()=>sql.prepare('SELECT COUNT(*) AS n FROM records WHERE owner=?').get(owner).n;
const before=JSON.stringify(sql.prepare('SELECT * FROM records ORDER BY id').all());
const plan=(await preview(cid)).data;
check('preview does not change stored records',before===JSON.stringify(sql.prepare('SELECT * FROM records ORDER BY id').all()));
const events=sql.prepare("SELECT COUNT(*) AS n FROM records WHERE owner=? AND kind='event' AND parent_id=?").get(owner,cid).n;
check('preview counts deleted records per kind',sorted(plan.deleted)===sorted({campaign:1,artifact:1,history:1,metric:1,event:events,learning_snapshot:1,campaign_directive:1,viral_experiment:2,experiment_revision:1,measurement_draft:1,measurement_source:1,learning_guidance:1,brief_draft:2,hermes_submission:4,learning_task:1,learning_job_output:1}));
check('preview counts retained records per kind',sorted(plan.retained)===sorted({learning_rule:2,viral_experiment_summary:1,store_experiment:1}));
check('preview counts execution jobs and totals',plan.jobs===2&&plan.totals.deleted===Object.values(plan.deleted).reduce((a,b)=>a+b,0)&&plan.totals.retained===4);
check('preview reports the campaign as deletable',plan.deletable===true&&plan.blockedReason===null&&plan.version===1&&plan.campaignId===cid);
const originalBatch=DB.batch;DB.batch=async ss=>originalBatch([...ss,DB.prepare('INSERT INTO missing_table VALUES (1)')]);
check('storage failure reports error',(await act('delete_campaign',payload)).status===500);DB.batch=originalBatch;
check('deletion failure rolls back every dependent write',before===JSON.stringify(sql.prepare('SELECT * FROM records ORDER BY id').all()));
const countBefore=ownerRecords();
check('campaign deletion succeeds despite unrelated active brief',(await act('delete_campaign',payload)).data.deleted===true);
// 삭제된 건수는 조회 결과와 같다. 새로 생기는 레코드는 동결 요약 1건과 삭제 기록(tombstone) 1건이다.
check('deleted record count matches the preview',countBefore-ownerRecords()===plan.totals.deleted-2);
check('campaign and direct records removed',!has('campaign',cid)&&!has('artifact','linked-artifact')&&!has('history','linked-history')&&!has('metric','linked-metric')&&!has('event','linked-event')&&!has('learning_snapshot','linked-learning_snapshot'));
check('deleted campaign is no longer readable',(await routeGet(detailRoute,`/api/campaigns/${cid}`,cid)).status===404);
check('deleted artifact is no longer readable',await server.namespace.readRecord(owner,'artifact','linked-artifact').then(()=>false,e=>e.status===404));
check('standing directives removed with the campaign',!has('campaign_directive','linked-campaign_directive'));
check('experiments and their revisions measurements and drafts removed',!has('viral_experiment','exp')&&!has('viral_experiment','exp-plain')&&!has('experiment_revision','exp:1')&&!has('measurement_draft','exp')&&!has('measurement_source','exp:control')&&!has('learning_guidance','exp:3'));
const kept=read('learning_rule','exp:3');
check('viral rule is kept as retired with the deletion mark',kept.status==='retired'&&kept.version===2&&kept.guidance===rule.guidance&&kept.sourceCampaignDeleted?.by?.id===owner&&Number.isFinite(Date.parse(kept.sourceCampaignDeleted.at)));
const legacy=read('learning_rule','exp:2');check('already retired viral rule without origin is marked too',legacy.status==='retired'&&legacy.version===3&&!!legacy.sourceCampaignDeleted);
const summary=read('viral_experiment_summary','exp');
check('source experiment summary is frozen without raw text',summary?.hypothesis===exp.hypothesis&&summary.metric==='share_rate'&&summary.assessment.status==='promising'&&summary.observedUntil===exp.result.observedUntil&&JSON.stringify([...summary.adoptedRuleIds].sort())==='["exp:2","exp:3"]'&&!/원문/.test(JSON.stringify(summary)));
check('frozen summary is kept under the brand',sql.prepare('SELECT parent_id FROM records WHERE owner=? AND kind=? AND id=?').get(owner,'viral_experiment_summary',`${owner}:viral_experiment_summary:exp`).parent_id==='ofd');
check('experiments without adopted rules leave no summary',!has('viral_experiment_summary','exp-plain'));
check('rule-draft job records removed with the experiment',!has('learning_task',guideJob)&&!has('learning_job_output',guideJob)&&!has('hermes_submission',guideJob)&&!sql.prepare('SELECT id FROM jobs WHERE id=?').get(guideJob));
check('case analysis work preserved',has('learning_task',caseJob)&&!!sql.prepare('SELECT id FROM jobs WHERE id=?').get(caseJob));
check('store rule and store experiment preserved unchanged',JSON.stringify(read('learning_rule','store:sx:4'))===JSON.stringify(storeRule)&&JSON.stringify(read('store_experiment','sx'))===JSON.stringify(storeExperiment));
check('drafts and provider payloads removed',!has('brief_draft','linked-draft')&&!has('brief_draft','saved-draft')&&!has('hermes_submission',job)&&!has('hermes_submission','brief-linked-draft')&&!has('hermes_submission','brief-saved-draft'));
check('campaign execution history removed',!sql.prepare('SELECT id FROM jobs WHERE owner=? AND campaign_id=?').get(owner,cid));
check('shared source and unrelated history preserved',has('viral_case','source')&&has('viral_analysis','analysis')&&has('learning_snapshot','other-snapshot')&&read('learning_rule','other-rule').status==='active'&&has('brief_draft','unrelated-draft'));
check('foreign owner records preserved',has('campaign',cid,'other-owner')&&has('artifact','foreign','other-owner'));
// 원 캠페인이 삭제된 규칙은 재검증·연장·일시중지 대신 새 실험을 안내한다(404가 아니다).
const learningRoute=await load('app/api/learning/route.ts');await learningRoute.evaluate();
for(const [name,b] of [['retest',{action:'retest_rule',id:'exp:3',version:2}],['renew',{action:'renew_rule',id:'exp:3',version:2,reason:'다음 캠페인까지 유지'}],['pause',{action:'pause_rule',id:'exp:3',version:2}]]){const r=await request(learningRoute,'POST',b);check(`${name} on a rule from a deleted campaign asks for a new experiment`,r.status===409&&r.data.error.includes('원 캠페인이 삭제')&&r.data.error.includes('새 실험'))}
check('refused rule operations leave the rule unchanged',JSON.stringify(read('learning_rule','exp:3'))===JSON.stringify(kept));
check('lost-response retry is idempotent',(await act('delete_campaign',payload)).status===200);
check('stale edit cannot recreate deleted campaign',(await act('save_campaign',{id:cid,version:1,data:{brandId:'ofd',title:'Resurrection',goal:'No',budget:0}})).status===404);
check('starter campaign can be deleted',(await act('delete_campaign',{id:'ofd-pilot-01',version:1,confirmed:true})).status===200);
const refreshed=await snapshot();check('refresh does not restore deleted starter',refreshed.data.campaigns.length===0&&refreshed.data.brands.length===4);
// 발행 한도만 저장한 캠페인은 삭제할 수 있다. 제작·발행 시도 기록이 있으면 계속 막는다(exec-loop-12).
const campaignWith=async title=>(await act('save_campaign',{data:{brandId:'ofd',title,goal:'실행 기록 삭제 규칙'}})).data.id;
const limitsOnly=await campaignWith('한도만 저장');await put('execution_limits',limitsOnly,{campaignId:limitsOnly,maxPlannedCostKRW:0,version:1},limitsOnly);
check('campaign with only publish limits can be deleted',(await act('delete_campaign',{id:limitsOnly,version:1,confirmed:true})).status===200&&!has('campaign',limitsOnly));
check('publish limits removed with the campaign',!has('execution_limits',limitsOnly));
const attempted=await campaignWith('발행 시도');await put('execution_limits',attempted,{campaignId:attempted,version:1},attempted);await put('execution_publication','attempt',{id:'attempt',campaignId:attempted,status:'pending'},attempted);
check('publication attempt still blocks deletion',(await act('delete_campaign',{id:attempted,version:1,confirmed:true})).status===409&&has('campaign',attempted)&&has('execution_limits',attempted));
const attemptedPlan=(await preview(attempted)).data;
check('preview explains blocked deletion and retained execution history',attemptedPlan.deletable===false&&attemptedPlan.blockedReason.includes('발행')&&attemptedPlan.retained.execution_publication===1);
const produced=await campaignWith('소재 제작');await put('execution_creative','png',{id:'png',campaignId:produced},produced);
check('saved creative still blocks deletion',(await act('delete_campaign',{id:produced,version:1,confirmed:true})).status===409&&has('campaign',produced));
const ordered=await campaignWith('주문 귀속');await put('store_order','attributed',{id:'attributed',storeId:'st1',campaignId:ordered},'st1');
check('attributed store order still blocks deletion',(await act('delete_campaign',{id:ordered,version:1,confirmed:true})).status===409&&has('campaign',ordered)&&has('store_order','attributed'));

// 이메일 모드: 삭제 영향 조회 권한은 삭제와 같다(직원 403, 관리자·대표 허용).
const rt=testRuntime(async()=>{throw new Error('외부 호출 금지')});Object.assign(rt.env,{AUTH_MODE:'email',AUTH_ORIGIN:'https://app.test'});
const emailServer=await rt.load('lib/server.ts'),emailDeletion=await rt.load('app/api/campaigns/[id]/deletion/route.ts');
await emailServer.recordStatement('workspace','campaign','m',{id:'m',brandId:'ofd',version:1}).run();
for(const [id,role,token] of [['admin','admin','a'.repeat(64)],['member','member','b'.repeat(64)]]){rt.sql.prepare('INSERT INTO auth_users(id,email,workspace_owner,role,status,created_at) VALUES(?,?,?,?,?,?)').run(id,id+'@test.invalid','workspace',role,'active',Date.now());rt.sql.prepare('INSERT INTO auth_sessions VALUES(?,?,?,?)').run(createHash('sha256').update(token).digest('hex'),id,Date.now()+60000,Date.now())}
const emailPreview=token=>emailDeletion.GET(new Request('https://app.test/api/campaigns/m/deletion',{headers:{cookie:'__Host-collective_session='+token}}),{params:Promise.resolve({id:'m'})});
check('member cannot preview campaign deletion',(await emailPreview('b'.repeat(64))).status===403);
check('owner can preview campaign deletion',(await emailPreview('a'.repeat(64))).status===200);
console.log(JSON.stringify({passed:passed.length,checks:passed},null,2));
