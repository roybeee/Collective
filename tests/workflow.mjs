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
let callCount=0,providerFail=false;const provider=new Map();
const fakeFetch=async(url,options={})=>{if(url.includes('/models/'))return Response.json({id:'test-model'});if(options.method==='POST'&&url.endsWith('/responses')){callCount++;if(providerFail)throw new Error('network lost');const b=JSON.parse(options.body),id='resp_test'+callCount;provider.set(id,{id,status:'completed',metadata:b.metadata,output:[{content:[{type:'output_text',text:roleFixture(b.input)}]}],usage:{total_tokens:42}});return Response.json({id,status:'completed'})}const id=url.split('/').pop();if(provider.has(id))return Response.json(provider.get(id));return Response.json({error:{message:'Not found'}},{status:404})};
const ctx=createContext({console,crypto:webcrypto,Response,Request,Headers,TextEncoder,TextDecoder,Uint8Array,Date,URL,AbortSignal,btoa,atob,fetch:fakeFetch,process:{env:{NODE_ENV:'production'}}});
const modules=new Map();const envModule=new SyntheticModule(['env'],function(){this.setExport('env',runtime)},{context:ctx});
function moduleFor(file){file=resolve(file);if(modules.has(file))return modules.get(file);const code=ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;const m=new SourceTextModule(code,{context:ctx,identifier:file});modules.set(file,m);return m}
async function load(file){const m=moduleFor(file);if(m.status==='unlinked')await m.link((spec,ref)=>{if(spec==='cloudflare:workers')return envModule;const f=spec.startsWith('@/')?resolve(spec.slice(2)):resolve(dirname(ref.identifier),spec);return moduleFor(f.endsWith('.ts')?f:f+'.ts')});return m}
const version=await load('app/api/version/route.ts');await version.evaluate();
const action=await load('app/api/action/route.ts');await action.evaluate();const workspace=await load('app/api/workspace/route.ts');await workspace.evaluate();const run=await load('app/api/run/route.ts');await run.evaluate();
let owner='qa-owner-with-a-production-length-authenticated-user-id';const passed=[];const check=(name,val)=>{assert.ok(val,name);passed.push(name)};
async function request(mod,method,b,override={}){const headers={'Content-Type':'application/json','oai-authenticated-user-id':owner,...override};for(const k in headers)if(headers[k]===null)delete headers[k];const r=await mod.namespace[method](new Request('https://agency.test/api/test',{method,headers,...(b?{body:JSON.stringify(b)}:{})}));return {status:r.status,data:await r.json()}}
const act=(name,b={})=>request(action,'POST',{action:name,...b});const snapshot=()=>request(workspace,'GET');
check('production rejects anonymous access',(await request(workspace,'GET',null,{'oai-authenticated-user-id':null})).status===401);
let r=await snapshot();check('four brands and starter campaign persist',r.data.brands.length===4&&r.data.campaigns.length===1);check('connection correctly reports disconnected',!r.data.connection.configured);
r=await act('save_campaign',{data:{brandId:'ofd',title:'QA Campaign',goal:'Validate workflow',budget:0}});const cid=r.data.id;check('campaign created',r.status===200);
check('negative budget rejected',(await act('save_campaign',{data:{brandId:'ofd',title:'Invalid',goal:'x',budget:-1}})).status===400);
check('date range rejected',(await act('save_campaign',{data:{brandId:'ofd',title:'Invalid',goal:'x',budget:0,startDate:'2026-09-20',endDate:'2026-09-19'}})).status===400);
check('cross-origin mutation rejected',(await request(action,'POST',{action:'disconnect'},{origin:'https://other.test'})).status===403);
check('AI unavailable without actual connection',(await request(run,'POST',{action:'start',campaignId:cid,role:'cmo'})).status===409);
r=await act('save_artifact',{campaignId:cid,role:'cmo',title:'Strategy',content:'Initial strategy'});const aid=r.data.id;check('manual artifact saved',r.status===200);
r=await act('save_artifact',{campaignId:cid,role:'quality',title:'Quality',content:'Review initial strategy'});const qid=r.data.id;
await act('review_artifact',{id:aid,version:1,decision:'approved',note:''});await act('review_artifact',{id:qid,version:1,decision:'approved',note:''});r=await snapshot();check('approval with current quality review',r.data.campaigns.find(c=>c.id===cid).status==='approved');
await act('save_artifact',{id:aid,version:1,campaignId:cid,role:'cmo',title:'Strategy v2',content:'Changed strategy'});r=await snapshot();check('upstream edit invalidates quality approval',r.data.artifacts.find(a=>a.id===qid).status==='outdated');
check('stale approval rejected',(await act('review_artifact',{id:aid,version:1,decision:'approved',note:''})).status===409);
check('outdated output approval rejected',(await act('review_artifact',{id:qid,version:1,decision:'approved',note:''})).status===409);
check('other owner cannot access artifact',(await request(action,'POST',{action:'review_artifact',id:aid,version:2,decision:'approved',note:''},{'oai-authenticated-user-id':'other-owner'})).status===404);
r=await act('save_metric',{campaignId:cid,period:'test period',revenue:100000,variableCosts:40000,adSpend:10000,productionCost:5000,orders:10,baselineContribution:30000,notes:'fixture'});check('measurement persists',r.status===200);
r=await snapshot();let c=r.data.campaigns.find(c=>c.id===cid);const simultaneous=await Promise.all([act('save_campaign',{id:cid,version:c.version,data:c}),act('save_campaign',{id:cid,version:c.version,data:c})]);check('simultaneous edits are serialized',simultaneous.filter(x=>x.status===200).length===1&&simultaneous.filter(x=>x.status===409).length===1);
r=await act('save_connection',{key:'sk-test-not-real',model:'test-model'});check('model connection validated and saved',r.status===200);const stored=sql.prepare('SELECT secret FROM settings WHERE owner=?').get(owner);check('API key encrypted at rest',stored.secret&&!stored.secret.includes('sk-test'));
r=await snapshot();check('workspace never returns key material',r.data.connection.configured&&!JSON.stringify(r.data).includes('sk-test'));
r=await request(run,'POST',{action:'start',campaignId:cid,role:'cmo'});check('background response queued even if immediately completed',r.status===200&&r.data.status==='queued');const job=r.data.id;
const eventActor=text=>JSON.parse(sql.prepare("SELECT data FROM records WHERE kind='event' AND data LIKE ? ORDER BY rowid DESC").get('%'+text+'%')?.data||'{}').actor;check('role start event records the requester',eventActor('AI 작업을 시작했습니다')?.id===owner);
check('duplicate active run blocked',(await request(run,'POST',{action:'start',campaignId:cid,role:'cmo'})).status===409&&callCount===1);
check('active run blocks disconnection',(await act('disconnect')).status===409);
// 다른 캠페인이 실행 중이라고 이 캠페인의 사람 게이트가 막히면, 실행을 늘릴수록 승인이 멈춘다.
const otherId=(await act('save_campaign',{data:{brandId:'ofd',title:'Second Campaign',goal:'Parallel work',budget:0}})).data.id;
const otherArtifact=await act('save_artifact',{campaignId:otherId,role:'cmo',title:'Other strategy',content:'Another campaign draft'});
check('another campaign can still be edited while a run is active',otherArtifact.status===200);
check('another campaign can still be approved while a run is active',(await act('review_artifact',{id:otherArtifact.data.id,version:1,decision:'approved',note:''})).status===200);
r=await request(run,'POST',{action:'poll',id:job});check('completed response becomes real artifact',r.status===200&&r.data.status==='completed');
r=await snapshot();const generated=r.data.artifacts.find(a=>a.origin==='ai');check('provider output stored with tokens',generated?.content.includes('자료 필요: 실제 운영 조건')&&generated?.outputContractVersion==='role-output-v1'&&r.data.runs[0].tokens===42);
await act('review_artifact',{id:generated.id,version:1,decision:'approved',note:''});await request(run,'POST',{action:'poll',id:job});r=await snapshot();check('repeated poll preserves artifact approval',r.data.artifacts.find(a=>a.id===generated.id).status==='approved');
providerFail=true;r=await request(run,'POST',{action:'start',campaignId:cid,role:'insight'});check('ambiguous provider failure does not fabricate success',r.status===502);r=await snapshot();check('ambiguous submission stops automatic retries',r.data.runs.some(j=>j.status==='uncertain'));const before=callCount;await request(run,'POST',{action:'start',campaignId:cid,role:'insight'});check('no duplicate charged retry after uncertainty',callCount===before);
// 배포 검증 경로. 소유자만 읽을 수 있어야 하고, 주입이 없으면 신원을 주장하지 않아야 한다.
r=await request(version,'GET',null);
check('version reports build and tree to the owner',r.status===200&&typeof r.data.build==='string'&&typeof r.data.tree==='string');
check('an uninjected build never claims a source identity',r.data.tree==='unknown');
check('version is owner-only',(await request(version,'GET',null,{'oai-authenticated-user-id':null})).status===401);
console.log(JSON.stringify({passed:passed.length,checks:passed},null,2));
