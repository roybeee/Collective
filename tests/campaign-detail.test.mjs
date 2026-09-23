import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {SourceTextModule,SyntheticModule,createContext} from 'node:vm';
import {readFileSync,readdirSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {webcrypto} from 'node:crypto';
import ts from 'typescript';

const sql=new DatabaseSync(':memory:');
for(const file of readdirSync('drizzle').filter(x=>x.endsWith('.sql')).sort())sql.exec(readFileSync('drizzle/'+file,'utf8'));
class Statement {
 constructor(query,values=[]){this.query=query;this.values=values}
 bind(...values){return new Statement(this.query,values)}
 async first(){return sql.prepare(this.query).get(...this.values)||null}
 async all(){return {results:sql.prepare(this.query).all(...this.values)}}
 async run(){return {meta:{changes:Number(sql.prepare(this.query).run(...this.values).changes)}}}
}
const DB={prepare:q=>new Statement(q),batch:async ss=>{sql.exec('BEGIN');try{const result=[];for(const s of ss)result.push(await s.run());sql.exec('COMMIT');return result}catch(e){sql.exec('ROLLBACK');throw e}}};
const ctx=createContext({console,crypto:webcrypto,Response,Request,Headers,TextEncoder,TextDecoder,Uint8Array,Date,URL,AbortSignal,btoa,atob,process:{env:{NODE_ENV:'production'}}});
const env=new SyntheticModule(['env'],function(){this.setExport('env',{DB})},{context:ctx});
const modules=new Map();
function moduleFor(file){file=resolve(file);if(modules.has(file))return modules.get(file);const code=ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;const m=new SourceTextModule(code,{context:ctx,identifier:file});modules.set(file,m);return m}
async function load(file){const m=moduleFor(file);if(m.status==='unlinked')await m.link((spec,ref)=>{if(spec==='cloudflare:workers')return env;const path=spec.startsWith('@/')?resolve(spec.slice(2)):resolve(dirname(ref.identifier),spec);return moduleFor(path.endsWith('.ts')?path:path+'.ts')});await m.evaluate();return m.namespace}
const detail=await load('app/api/campaigns/[id]/route.ts');
const action=await load('app/api/action/route.ts');
const workspace=await load('app/api/workspace/route.ts');
const server=await load('lib/server.ts');
const agency=await load('lib/agency.ts');
const owner='campaign-detail-test-owner',checks=[];
const check=(name,value)=>{assert.ok(value,name);checks.push(name)};
const put=(kind,id,data,parent='')=>server.recordStatement(owner,kind,id,data,parent).run();
const headers={'content-type':'application/json','oai-authenticated-user-id':owner};
async function get(id,who=owner){const r=await detail.GET(new Request('https://agency.test/api/campaigns/'+id,{headers:who?{'oai-authenticated-user-id':who}:{}}),{params:Promise.resolve({id})});return {status:r.status,data:await r.json()}}
async function act(payload){const r=await action.POST(new Request('https://agency.test/api/action',{method:'POST',headers,body:JSON.stringify(payload)}));return {status:r.status,data:await r.json()}}
await server.seedBrands(owner);
const campaign={id:'campaign-a',brandId:'ofd',title:'History',goal:'Compare',version:1,status:'draft'};
await put('campaign',campaign.id,campaign);
const artifact={id:'artifact-a',campaignId:campaign.id,role:'cmo',title:'Strategy',content:'Current version',status:'review',version:2,origin:'manual',createdAt:'2026-01-02T00:00:00Z'};
await put('artifact',artifact.id,artifact,campaign.id);
await put('history','old-a',{...artifact,id:'old-a',originalId:artifact.id,version:1,content:'Original version'},campaign.id);
await put('history','foreign-campaign',{...artifact,id:'foreign-campaign',campaignId:'another',content:'Do not disclose'},'another');
check('anonymous detail denied',(await get(campaign.id,null)).status===401);
check('foreign owner detail hidden',(await get(campaign.id,'other-owner')).status===404);
check('missing campaign hidden',(await get('missing')).status===404);
const loaded=await get(campaign.id);
check('detail includes full current artifact',loaded.data.artifacts[0].content==='Current version');
check('history includes preserved original body',loaded.data.history[0].content==='Original version');
check('history cannot include another campaign',loaded.data.history.length===1);

const base={action:'save_metric',campaignId:campaign.id,schemaVersion:2,periodStart:'2026-01-01',periodEnd:'2026-01-07',scope:'성수점 · 전체 주문',source:'POS export',definition:'환불 차감, KST, 부가세 제외',method:'export',revenue:100,variableCosts:null,adSpend:0,productionCost:0,orders:2,baselineContribution:null};
let result=await act(base);
check('structured metric saved',result.status===200);
const metricId=result.data.id;
const metric=await server.readRecord(owner,'metric',metricId);
check('unknown cost is preserved',metric.variableCosts===null);
check('unknown costs do not become profit',agency.metricSummary(metric).net===null);
check('zero cost remains a known zero',agency.metricSummary({...metric,variableCosts:0}).net===100);
check('overlapping same scope rejected',(await act({...base,periodStart:'2026-01-07',periodEnd:'2026-01-09'})).status===409);
check('another scope can use same dates',(await act({...base,scope:'한남점 · 전체 주문'})).status===200);
check('invalid calendar date rejected',(await act({...base,periodStart:'2026-02-30',periodEnd:'2026-03-01'})).status===400);
check('fractional order count rejected',(await act({...base,scope:'separate',orders:1.5})).status===400);
check('source is required',(await act({...base,scope:'separate',source:''})).status===400);
check('all unknown values rejected',(await act({...base,scope:'separate',revenue:null,variableCosts:null,adSpend:null,productionCost:null,orders:null})).status===400);
check('stale metric edit rejected',(await act({...base,id:metricId,version:0})).status===409);
check('current metric edit succeeds',(await act({...base,id:metricId,version:1,variableCosts:25})).status===200);
const legacy={action:'save_metric',campaignId:campaign.id,period:'Legacy period',revenue:50,variableCosts:10,adSpend:0,productionCost:0,orders:1,baselineContribution:null};
const savedLegacy=await act(legacy);
check('legacy records stay readable',savedLegacy.status===200);
check('legacy edit requires a version',(await act({...legacy,id:savedLegacy.data.id,revenue:60})).status===409);
check('current legacy edit succeeds',(await act({...legacy,id:savedLegacy.data.id,version:1,revenue:60})).status===200);
check('stale legacy edit is rejected',(await act({...legacy,id:savedLegacy.data.id,version:1,revenue:70})).status===409);
await put('metric','pre-version',{...legacy,id:'pre-version'},campaign.id);
const converted=await act({...base,id:'pre-version',version:1,scope:'legacy conversion'});
check('legacy conversion advances the implicit initial version',converted.status===200&&(await server.readRecord(owner,'metric','pre-version')).version===2);
check('stale legacy form cannot overwrite converted metric',(await act({...base,id:'pre-version',version:1,scope:'legacy conversion',revenue:70})).status===409);

const addJob=sql.prepare('INSERT INTO jobs(id,owner,campaign_id,role,status,model,campaign_version,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)');
addJob.run('old-active',owner,campaign.id,'cmo','in_progress','test',1,'2020-01-01','2020-01-01');
for(let i=0;i<201;i++)addJob.run('done-'+i,owner,'other-'+i,'cmo','completed','test',1,'2026-01-01','2026-01-01');
await put('campaign_sequence',campaign.id,{campaignId:campaign.id,status:'running'},campaign.id);
const response=await workspace.GET(new Request('https://agency.test/api/workspace',{headers}));const ws=await response.json();
check('older active run survives latest terminal limit',ws.runs.some(r=>r.id==='old-active'));
check('terminal history stays bounded',ws.runs.filter(r=>r.status==='completed').length===200);
check('sequence state is exposed',ws.sequences.some(s=>s.campaignId===campaign.id&&s.status==='running'));
check('detail shows campaign-local active run',(await get(campaign.id)).data.runs.some(r=>r.id==='old-active'));
console.log(JSON.stringify({passed:checks.length,checks},null,2));
