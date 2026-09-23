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
let callCount=0,loseAck=false,providerStatus='running',output=readFileSync('tests/fixtures/brief.json','utf8');const submissions=new Map();let lastInput;
const fakeFetch=async(url,options={})=>{
 if(url.endsWith('/v1/capabilities'))return options.headers?Response.json({object:'hermes.api_server.capabilities',platform:'hermes-agent',features:{run_submission:true,run_status:true,run_stop:true,runs_idempotency:{durable:true}}}):new Response('',{status:401});
 if(url.endsWith('/v1/models'))return Response.json({data:[{id:'test-hermes'}]});
 if(url.endsWith('/v1/runs')&&options.method==='POST'){const key=options.headers['Idempotency-Key'];if(!submissions.has(key)){callCount++;lastInput=JSON.parse(JSON.parse(options.body).input);submissions.set(key,'run_'+callCount)}if(loseAck){loseAck=false;throw new Error('ack lost')}return Response.json({run_id:submissions.get(key)})}
 if(url.endsWith('/stop')){providerStatus='cancelled';return Response.json({ok:true})}
 if(url.includes('/v1/runs/'))return Response.json({object:'hermes.run',run_id:url.split('/').pop(),status:providerStatus,output,usage:{total_tokens:99}});
 throw new Error('Unexpected external destination: '+url);
};
const ctx=createContext({console,crypto:webcrypto,Response,Request,Headers,TextEncoder,TextDecoder,Uint8Array,Date,URL,AbortSignal,btoa,atob,fetch:fakeFetch,process:{env:{NODE_ENV:'production'}}});
const modules=new Map();const envModule=new SyntheticModule(['env'],function(){this.setExport('env',runtime)},{context:ctx});
function moduleFor(file){file=resolve(file);if(modules.has(file))return modules.get(file);const code=ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;const m=new SourceTextModule(code,{context:ctx,identifier:file});modules.set(file,m);return m}
async function load(file){const m=moduleFor(file);if(m.status==='unlinked')await m.link((spec,ref)=>{if(spec==='cloudflare:workers')return envModule;const f=spec.startsWith('@/')?resolve(spec.slice(2)):resolve(dirname(ref.identifier),spec);return moduleFor(f.endsWith('.ts')?f:f+'.ts')});return m}
const action=await load('app/api/action/route.ts');await action.evaluate();const workspace=await load('app/api/workspace/route.ts');await workspace.evaluate();const run=await load('app/api/run/route.ts');await run.evaluate();
let owner='qa-owner-with-a-production-length-authenticated-user-id';const passed=[];const check=(name,val)=>{assert.ok(val,name);passed.push(name)};
async function request(mod,method,b,override={}){const headers={'Content-Type':'application/json','oai-authenticated-user-id':owner,...override};for(const k in headers)if(headers[k]===null)delete headers[k];const r=await mod.namespace[method](new Request('https://agency.test/api/test',{method,headers,...(b?{body:JSON.stringify(b)}:{})}));return {status:r.status,data:await r.json()}}
const act=(name,b={})=>request(action,'POST',{action:name,...b});const snapshot=()=>request(workspace,'GET');

const brief=await load('app/api/brief/route.ts');await brief.evaluate();
const bp=(name,b={})=>request(brief,'POST',{action:name,...b});
const pure=await load('lib/brief.ts');await pure.evaluate();
const input={brandId:'mapdal',title:'사용자 제목',goal:'맵달서울 물품보관함 사용률을 높이고 싶어.',audience:'성수동에 온 외국인',budget:0,plan:{}};
await snapshot();
check('missing connection returns honest error',(await bp('start',{id:'draft-1',data:input})).status===409);
await act('save_hermes',{endpoint:'https://hermes.example.com',key:'hermes-local-test-key-only'});
const server=await load('lib/server.ts');await server.evaluate();
const trial={id:'brief-trial',brandId:'mapdal',channel:'Instagram',status:'active',title:'실험에서 얻은 시험 규칙',version:2,expiresAt:new Date(Date.now()+86400000).toISOString()};
await server.namespace.recordStatement(owner,'learning_rule',trial.id,trial).run();
await server.namespace.recordStatement(owner,'learning_rule','other-brand-trial',{...trial,id:'other-brand-trial',brandId:'other'}).run();
input.channels='인스타그램';
let r=await bp('start',{id:'draft-1',data:input});check('real adapter submission creates queued draft',r.status===200&&r.data.status==='queued');
check('new campaign draft receives only applicable trial learning',lastInput.trialLearning.length===1&&lastInput.trialLearning[0].id===trial.id&&lastInput.trialLearning[0].version===2);
check('brief input separates unverified brand intro',lastInput.brand.brandIntro.verification==='unverified'&&lastInput.brand.brandIntro.useInCopy===false&&!('description' in lastInput.brand)&&lastInput.brand.identity.name==='MAPDAL');
check('brief input carries shared evidence context',['confirmed','prohibited','candidate'].every(k=>Array.isArray(lastInput.evidence.facts[k]))&&Array.isArray(lastInput.evidence.directives)&&!('factRefs' in lastInput.evidence));
check('repeat start reuses durable draft',(await bp('start',{id:'draft-1',data:input})).status===200&&callCount===1);
check('parallel second draft is blocked',(await bp('start',{id:'draft-2',data:input})).status===409&&callCount===1);
check('active draft blocks credential changes',(await act('disconnect')).status===409);
check('owner isolation',(await request(brief,'POST',{action:'load',id:'draft-1'},{'oai-authenticated-user-id':'other'})).status===404);
check('cross-origin draft blocked',(await request(brief,'POST',{action:'start',id:'bad',data:input},{origin:'https://other.test'})).status===403);
check('poll running is not success',(await bp('poll',{id:'draft-1'})).data.status==='in_progress');
providerStatus='completed';r=await bp('poll',{id:'draft-1'});check('completed output validates structured brief',r.data.status==='completed'&&r.data.result.questions.length===3);
check('provider id hidden from frontend',!r.data.providerId);
const completeInput={...r.data.input};const merged=pure.namespace.applySuggestions(completeInput,r.data.result.suggestions);
check('user title and audience preserved',merged.title===input.title&&merged.audience===input.audience);
check('empty planning fields filled',merged.plan.kpi.includes('락커')&&merged.plan.tracking.includes('QR'));
const withBad=pure.namespace.applySuggestions(merged,[{field:'baseline',value:'90%',reason:'guess'},{field:'operations',value:'무료',reason:'guess'}],true);
check('protected facts cannot be auto filled',!withBad.plan.baseline&&!withBad.plan.operations&&withBad.budget===0);
const result=r.data.result;
r=await act('save_campaign',{briefDraftId:'draft-1',data:merged});const cid=r.data.id;check('generated plan saved in campaign',r.status===200);
check('save retry does not duplicate campaign',(await act('save_campaign',{briefDraftId:'draft-1',data:merged})).data.id===cid);
r=await snapshot();const c=r.data.campaigns.find(c=>c.id===cid);check('plan and AI provenance persist',c.plan.kpi===merged.plan.kpi&&c.draftMeta.values.kpi===merged.plan.kpi&&!c.draftMeta.values.title);
check('saved draft absent from resume list',!r.data.briefDrafts.some(d=>d.id==='draft-1'));
providerStatus='running';loseAck=true;r=await bp('start',{id:'lost-ack',data:input});check('lost acknowledgement becomes uncertain',r.data.status==='uncertain');const before=callCount;
r=await bp('recover',{id:'lost-ack'});check('recovery reuses same provider operation',r.status===200&&r.data.status==='in_progress'&&callCount===before);
check('cancellation finishes pending draft',(await bp('cancel',{id:'lost-ack'})).data.status==='cancelled');
providerStatus='completed';output='not json';await bp('start',{id:'invalid-result',data:input});r=await bp('poll',{id:'invalid-result'});check('malformed output cannot become success',r.data.status==='failed'&&!r.data.result);
output=JSON.stringify({summary:'',suggestions:[{field:'kpi',value:'one'},{field:'title',value:'two'},{field:'channels',value:'three'}],questions:[],assumptions:[]});await bp('start',{id:'thin-result',data:input});check('incomplete strategy is rejected',(await bp('poll',{id:'thin-result'})).data.status==='failed');
await server.namespace.recordStatement(owner,'campaign_directive','brief-dir',{id:'brief-dir',campaignId:cid,text:'인기·할인은 확인 전 쓰지 않습니다.',createdAt:new Date().toISOString(),createdBy:{id:owner,email:null}},cid).run();
await server.namespace.recordStatement(owner,'brand_fact','brief-oven',{id:'brief-oven',brandId:'mapdal',key:'popular',value:'동네 1위',status:'rejected',source:'대표 확인',verifiedAt:'',validUntil:'',version:2,updatedAt:new Date().toISOString()},'mapdal').run();
output=readFileSync('tests/fixtures/brief.json','utf8');await bp('start',{id:'edit-draft',data:c,campaignId:cid,campaignVersion:c.version});
check('campaign brief draft receives standing directives and prohibited claims',lastInput.evidence.directives.some(d=>d.text==='인기·할인은 확인 전 쓰지 않습니다.')&&lastInput.evidence.facts.prohibited.some(f=>f.value==='동네 1위'));await bp('poll',{id:'edit-draft'});await act('save_campaign',{id:cid,version:c.version,data:{...c,title:'Newer human version'}});
check('stale draft cannot overwrite newer campaign',(await act('save_campaign',{id:cid,version:c.version+1,briefDraftId:'edit-draft',data:c})).status===409);
const badParse=JSON.parse(output);badParse.suggestions.push({field:'baseline',value:'100',reason:'fabricated'});badParse.questions=[{field:'budget',question:'예산?',why:'scope'}];const sanitized=pure.namespace.parseBrief(JSON.stringify(badParse));
check('parser discards protected suggestions',!sanitized.suggestions.some(s=>s.field==='baseline'));
check('budget question is retained',sanitized.questions[0].field==='budget');
// 사실 후보는 사용자가 브리프에 직접 적은 값만 받는다. 모델이 다른 출처를 밝히거나 브리프에 없는 값은 버린다(ai-quality-8).
const briefInput={title:'오픈',goal:'휘경동 377 C동 107호 매장 오픈 알리기',audience:'',channels:'',stores:'휘경동',products:'마르게리타 12,900원',budget:0,startDate:'',endDate:'',constraints:Array.from({length:12},(_,i)=>'값 '+i).join(', '),sources:'',plan:{operations:'평일 11시 오픈'}};
const withFacts=pure.namespace.parseBrief(JSON.stringify({...JSON.parse(output),factCandidates:[{key:'매장 주소',value:'휘경동 377 C동 107호',source:'사용자 브리프'},{key:'조리 방식',value:'장작 화덕',source:'AI 추론'},{key:'가격',value:'마르게리타   12,900원'},{key:'주소 추정',value:'휘경동 377 C동 107호',source:'AI 추론'},{key:'영업시간',value:'평일 11시~21시',source:'사용자 브리프'},{key:'',value:'빈 항목'},{key:'매장 주소',value:'중복'},'text',...Array.from({length:12},(_,i)=>({key:'항목 '+i,value:'값 '+i}))]}),briefInput);
check('fact candidates keep only values written in the user brief',withFacts.factCandidates[0].key==='매장 주소'&&withFacts.factCandidates[1].key==='가격'&&withFacts.factCandidates.every(f=>f.source==='사용자 브리프'));
check('AI-inferred or absent values never become user brief candidates',!withFacts.factCandidates.some(f=>['조리 방식','주소 추정','영업시간'].includes(f.key)));
check('invalid and duplicate fact candidates dropped and capped',withFacts.factCandidates.length===10&&withFacts.factCandidates.filter(f=>f.key==='매장 주소').length===1);
check('fact candidates need the brief input to verify provenance',pure.namespace.parseBrief(JSON.stringify({...JSON.parse(output),factCandidates:[{key:'매장 주소',value:'휘경동 377 C동 107호'}]})).factCandidates.length===0);
check('missing fact candidates default to empty',Array.isArray(sanitized.factCandidates)&&sanitized.factCandidates.length===0);
check('brief instructions request fact candidates from the user brief only',pure.namespace.briefInstructions.includes('factCandidates')&&pure.namespace.briefInstructions.includes('사용자 브리프'));
check('past campaign context includes joinable ids',lastInput.previousCampaigns.every(c=>c.id));
const originalBatch=DB.batch;let failOnce=true;DB.batch=async ss=>{if(failOnce){failOnce=false;throw new Error('injected atomic storage failure')}return originalBatch(ss)};
r=await bp('start',{id:'atomic-failure',data:input});check('atomic storage failure creates no stuck draft',r.status===500&&!sql.prepare("SELECT id FROM records WHERE kind='brief_draft' AND id LIKE '%atomic-failure'").get());
DB.batch=originalBatch;
check('atomic failure never submits provider request',!sql.prepare("SELECT id FROM records WHERE kind='hermes_submission' AND id LIKE '%atomic-failure'").get());
console.log(JSON.stringify({passed:passed.length,checks:passed},null,2));
