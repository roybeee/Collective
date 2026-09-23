import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {SourceTextModule,SyntheticModule,createContext} from 'node:vm';
import {readFileSync,readdirSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {webcrypto} from 'node:crypto';
import ts from 'typescript';

const sql=new DatabaseSync(':memory:');
for(const file of readdirSync('drizzle').filter(x=>x.endsWith('.sql')).sort())sql.exec(readFileSync('drizzle/'+file,'utf8'));
let annotationFailures=0,fetches=0;const errorLogs=[],responses=new Map();
class Statement {
 constructor(query,values=[]){this.query=query;this.values=values}
 bind(...values){return new Statement(this.query,values)}
 async first(){return sql.prepare(this.query).get(...this.values)||null}
 async all(){return {results:sql.prepare(this.query).all(...this.values)}}
 async run(){if(annotationFailures&&this.query.includes("'$.domainOutcome'")){annotationFailures--;throw new Error('simulated annotation write failed');}return {meta:{changes:Number(sql.prepare(this.query).run(...this.values).changes)}}}
}
const DB={prepare:q=>new Statement(q),batch:async ss=>{sql.exec('BEGIN');try{const result=[];for(const s of ss)result.push(await s.run());sql.exec('COMMIT');return result}catch(e){sql.exec('ROLLBACK');throw e}}};
const runtime={DB,AGENCY_ENCRYPTION_KEY:Buffer.alloc(32,7).toString('base64')};
const ctx=createContext({console:{...console,error:(...args)=>errorLogs.push(args.join(' '))},crypto:webcrypto,Response,Request,Headers,TextEncoder,TextDecoder,Uint8Array,Date,URL,AbortSignal,btoa,atob,process:{env:{NODE_ENV:'production'}},fetch:async url=>{fetches++;const parts=url.split('/'),response=responses.get(parts.at(-1)==='stop'?parts.at(-2):parts.at(-1));if(!response)throw new Error('Unexpected provider request');return Response.json(response)}});
const env=new SyntheticModule(['env'],function(){this.setExport('env',runtime)},{context:ctx}),modules=new Map();
function moduleFor(file){file=resolve(file);if(modules.has(file))return modules.get(file);const code=ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;const vmModule=new SourceTextModule(code,{context:ctx,identifier:file});modules.set(file,vmModule);return vmModule}
async function load(file){const m=moduleFor(file);if(m.status==='unlinked')await m.link((specifier,reference)=>{if(specifier==='cloudflare:workers')return env;const path=specifier.startsWith('@/')?resolve(specifier.slice(2)):resolve(dirname(reference.identifier),specifier);return moduleFor(path.endsWith('.ts')?path:path+'.ts')});await m.evaluate();return m.namespace}
const server=await load('lib/server.ts'),roles=await load('lib/role-execution.ts'),learning=await load('lib/learning-execution.ts'),brief=await load('lib/brief-execution.ts');
const owner='terminal-test-owner',checks=[];const check=(name,value)=>{assert.ok(value,name);checks.push(name)};
const put=(kind,id,data,parent='')=>server.recordStatement(owner,kind,id,data,parent).run();
await server.seedBrands(owner);
const secret=await server.encrypt(JSON.stringify({provider:'hermes',key:'local-test-only',endpoint:'https://hermes.example.com'}));
sql.prepare('INSERT INTO settings(owner,secret,model,updated_at) VALUES(?,?,?,?)').run(owner,secret,'HERMES','2026-01-01');
function seedJob(id,role,campaignId,output){
 const providerId='provider_'+id;
 sql.prepare('INSERT INTO jobs(id,owner,campaign_id,role,status,provider_id,model,campaign_version,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run(id,owner,campaignId,role,'queued',providerId,'HERMES',1,'2026-01-01','2026-01-01');
 responses.set(providerId,{object:'hermes.run',run_id:providerId,status:'completed',output,model:'actual-model',usage:{total_tokens:77}});
 return providerId;
}
// A single failed accounting annotation must not roll back an already committed result.
const guidanceId='guidance_annotation';seedJob(guidanceId,'viral_guidance','guidance-parent',JSON.stringify({guidance:'Keep the observed context.'}));
await put('learning_task',guidanceId,{id:guidanceId,kind:'guidance',experimentId:'experiment',experimentVersion:1});
annotationFailures=1;
let result=await learning.executeLearning(owner,{action:'poll',id:guidanceId});
check('annotation failure does not turn a saved learning result into an HTTP failure',result.status===200);
check('annotation failure preserves completed job',sql.prepare('SELECT status FROM jobs WHERE id=?').get(guidanceId).status==='completed');
check('guidance exists once after annotation failure',(await server.listRecords(owner,'learning_guidance')).length===1);
check('annotation failure is logged without database or provider details',errorLogs.includes('usage_outcome_write_failed')&&!errorLogs.join(' ').includes('simulated annotation'));
const previousFetches=fetches;
result=await learning.executeLearning(owner,{action:'poll',id:guidanceId});
check('completed replay cannot call provider or duplicate guidance',result.status===200&&fetches===previousFetches&&(await server.listRecords(owner,'learning_guidance')).length===1);

for(const [id,output] of [['numeric',123],['large','x'.repeat(300001)]]){
 const campaignId='campaign_'+id;
 await put('campaign',campaignId,{id:campaignId,brandId:'ofd',title:'Terminal regression',goal:'Validate output',status:'running',version:1});
 const providerId=seedJob(id,'cmo',campaignId,output);
 result=await roles.executeRole(owner,{action:'poll',id});const body=await result.json();
 check(id+' malformed completed output becomes terminal failed',result.status===200&&body.status==='failed'&&sql.prepare('SELECT status FROM jobs WHERE id=?').get(id).status==='failed');
 const ledger=await server.readRecord(owner,'provider_usage','hermes:'+providerId);
 check(id+' preserves provider completion and usage with invalid domain outcome',ledger.status==='completed'&&ledger.totalTokens===77&&ledger.domainOutcome==='invalid_output');
 const before=fetches;await roles.executeRole(owner,{action:'poll',id});
 check(id+' terminal replay stops provider polling',fetches===before);
}
const badLearning='learning_invalid',badProvider=seedJob(badLearning,'viral_guidance','bad-guidance-parent',null);
result=await learning.executeLearning(owner,{action:'poll',id:badLearning});
check('learning invalid terminal output is failed',(await result.json()).status==='failed');
check('learning marks invalid output rather than provider failure',(await server.readRecord(owner,'provider_usage','hermes:'+badProvider)).domainOutcome==='invalid_output');
const briefProvider='brief_invalid';responses.set(briefProvider,{object:'hermes.run',run_id:briefProvider,status:'completed',output:[],usage:{total_tokens:31}});
await put('brief_draft','bad_brief',{id:'bad_brief',status:'queued',providerId:briefProvider,input:{brandId:'ofd',goal:'test'}});
result=await brief.executeBrief(owner,{action:'poll',id:'bad_brief'});
check('brief invalid terminal output is failed',(await result.json()).status==='failed');
check('brief preserves invalid output outcome',(await server.readRecord(owner,'provider_usage','hermes:'+briefProvider)).domainOutcome==='invalid_output');
await put('campaign','cancel-campaign',{id:'cancel-campaign',brandId:'ofd',title:'Cancel malformed result',status:'running',version:1});
const cancelProvider=seedJob('cancel-invalid','cmo','cancel-campaign',123);
result=await roles.executeRole(owner,{action:'cancel',id:'cancel-invalid'});
check('cancellation observing malformed terminal output also releases the active job',result.status===200&&(await result.json()).status==='failed'&&sql.prepare('SELECT status FROM jobs WHERE id=?').get('cancel-invalid').status==='failed');
check('cancel path preserves invalid domain outcome',(await server.readRecord(owner,'provider_usage','hermes:'+cancelProvider)).domainOutcome==='invalid_output');
console.log(JSON.stringify({passed:checks.length,checks},null,2));
