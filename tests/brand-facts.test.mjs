import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {SourceTextModule,SyntheticModule,createContext} from 'node:vm';
import {readFileSync,readdirSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {webcrypto} from 'node:crypto';
import ts from 'typescript';
const sql=new DatabaseSync(':memory:');
for(const f of readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())sql.exec(readFileSync('drizzle/'+f,'utf8'));
class Statement{constructor(q,v=[]){this.q=q;this.v=v}bind(...v){return new Statement(this.q,v)}async first(){return sql.prepare(this.q).get(...this.v)||null}async all(){return {results:sql.prepare(this.q).all(...this.v)}}async run(){return {meta:{changes:Number(sql.prepare(this.q).run(...this.v).changes)}}}}
const DB={prepare:q=>new Statement(q),batch:async ss=>{sql.exec('BEGIN');try{const out=[];for(const s of ss)out.push(await s.run());sql.exec('COMMIT');return out}catch(e){sql.exec('ROLLBACK');throw e}}};
const context=createContext({console,crypto:webcrypto,Response,Request,Headers,TextEncoder,TextDecoder,Uint8Array,Date,URL,AbortSignal,btoa,atob,process:{env:{NODE_ENV:'production'}}});
const env=new SyntheticModule(['env'],function(){this.setExport('env',{DB,AUTH_MODE:'legacy'})},{context});const modules=new Map();
function moduleFor(file){file=resolve(file);if(modules.has(file))return modules.get(file);const code=ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;const m=new SourceTextModule(code,{context,identifier:file});modules.set(file,m);return m}
async function load(file){const m=moduleFor(file);if(m.status==='unlinked')await m.link((s,r)=>s==='cloudflare:workers'?env:moduleFor((s.startsWith('@/')?resolve(s.slice(2)):resolve(dirname(r.identifier),s))+'.ts'));await m.evaluate();return m.namespace}
const api=await load('app/api/brand-facts/route.ts'),server=await load('lib/server.ts'),facts=await load('lib/brand-facts-server.ts'),bf=await load('lib/brand-facts.ts');
const owner='brand-facts-owner-authenticated-production-id',other='brand-facts-other-authenticated-production-id';
let passed=0;function check(name,value){assert.ok(value,name);passed++}
await server.seedBrands(owner);await server.seedBrands(other);
await server.recordStatement(owner,'store','s1',{id:'s1',brandId:'oda',status:'active'},'oda').run();
await server.recordStatement(owner,'store','s2',{id:'s2',brandId:'ofd',status:'active'},'ofd').run();
async function post(data,extra={},user=owner,headers={}){const r=await api.POST(new Request('https://agency.test/api/brand-facts',{method:'POST',headers:{'Content-Type':'application/json','oai-authenticated-user-id':user,...headers},body:JSON.stringify({action:'save_fact',data,...extra})}));return {status:r.status,...await r.json()}}
async function get(query,user=owner){const r=await api.GET(new Request('https://agency.test/api/brand-facts?'+query,{headers:{'oai-authenticated-user-id':user}}));return {status:r.status,...await r.json()}}
const now=Date.now(),past=new Date(now-60000).toISOString(),future=new Date(now+86400000).toISOString();
const base={brandId:'oda',key:'oven',value:'전기 오븐',status:'candidate',source:'',verifiedAt:'',validUntil:''};
check('anonymous rejected',(await post(base,{},'')).status===401);
check('cross origin rejected',(await post(base,{},owner,{origin:'https://evil.test'})).status===403);
check('unknown brand rejected',(await post({...base,brandId:'missing'})).status===404);
check('wrong brand store rejected',(await post({...base,storeId:'s2'})).status===404);
const candidate=await post(base);check('candidate saved',candidate.status===200);
check('candidate has no decider',!(await server.readRecord(owner,'brand_fact',candidate.id)).confirmedBy);
check('candidate excluded from context',(await facts.confirmedFactContext(owner,'oda')).length===0);
check('duplicate key rejected',(await post({...base,key:' OVEN '})).status===409);
const confirmed={...base,status:'confirmed',source:'점주 확인',verifiedAt:past,validUntil:future};
check('explicit confirmation required',(await post(confirmed,{id:candidate.id,version:1})).status===400);
check('source required',(await post({...confirmed,source:''},{id:candidate.id,version:1,confirmed:true})).status===400);
check('future verification rejected',(await post({...confirmed,verifiedAt:future},{id:candidate.id,version:1,confirmed:true})).status===400);
check('expired verification rejected',(await post({...confirmed,validUntil:past},{id:candidate.id,version:1,confirmed:true})).status===400);
check('stale update rejected',(await post(confirmed,{id:candidate.id,version:7,confirmed:true})).status===409);
check('confirm succeeds',(await post(confirmed,{id:candidate.id,version:1,confirmed:true})).status===200);
const decided=await server.readRecord(owner,'brand_fact',candidate.id);check('confirmation records decider and time',typeof decided.confirmedBy?.id==='string'&&!!decided.confirmedBy.id&&'email' in decided.confirmedBy&&Number.isFinite(Date.parse(decided.confirmedAt)));
check('confirmed included',(await facts.confirmedFactContext(owner,'oda'))[0].value==='전기 오븐');
check('history preserves candidate',(await server.listRecords(owner,'brand_fact_history',candidate.id))[0].status==='candidate');
check('foreign edit rejected',(await post(confirmed,{id:candidate.id,version:2,confirmed:true},other)).status===404);
check('foreign list isolated',(await get('brandId=oda',other)).facts.length===0);
check('foreign history isolated',(await server.listRecords(other,'brand_fact_history',candidate.id)).length===0);
check('scope move rejected',(await post({...confirmed,storeId:'s1'},{id:candidate.id,version:2,confirmed:true})).status===409);
const local=await post({...confirmed,storeId:'s1',value:'지점 전용'},{confirmed:true});check('same key distinct scope allowed',local.status===200);
check('global scope excludes store facts',(await facts.confirmedFactContext(owner,'oda')).length===1);
check('store scope resolves local override',(await facts.confirmedFactContext(owner,'oda','s1')).length===1&&(await facts.confirmedFactContext(owner,'oda','s1'))[0].value==='지점 전용');
check('store query validates ownership',(await get('brandId=oda&storeId=s2')).status===404);
check('store-only query resolves brand',(await get('storeId=s1')).facts.length===2);
const stored=await server.readRecord(owner,'brand_fact',local.id);await server.recordStatement(owner,'brand_fact',local.id,{...stored,validUntil:past},'oda').run();
check('expired local excluded and global retained',(await facts.confirmedFactContext(owner,'oda','s1'))[0].id===candidate.id);
check('reject succeeds',(await post({...base,status:'rejected'},{id:candidate.id,version:2})).status===200);
check('rejected excluded',(await facts.confirmedFactContext(owner,'oda')).length===0);
check('history preserves confirmed revision',(await server.listRecords(owner,'brand_fact_history',candidate.id)).some(f=>f.version===2&&f.status==='confirmed'));
check('all owner facts readable',(await get('')).facts.length===2);
await server.recordStatement(owner,'brand_fact',candidate.id,{...confirmed,id:candidate.id,version:200},'oda').run();
check('revision cap still permits withdrawing confirmed fact',(await post({...base,status:'rejected'},{id:candidate.id,version:200})).status===200);
check('withdrawn capped fact cannot be used',(await facts.confirmedFactContext(owner,'oda')).length===0);
await server.recordStatement(owner,'brand_fact','before-decider',{...confirmed,key:'legacy',id:'before-decider',version:1},'oda').run();
check('confirmed fact saved before decider tracking stays usable',(await facts.confirmedFactContext(owner,'oda')).some(f=>f.id==='before-decider'));
// 사실 변경 표시: 작업물이 입력에 쓴 사실 스냅샷(factRefs: 확정·거절)이 현재와 다르면 factsChanged만 표시하고 outdated로 바꾸지 않는다.
const refsFor=async storeId=>bf.evidenceFactRefs(bf.scopedBrandFacts(await server.listRecords(owner,'brand_fact','oda'),'oda',storeId));
const art=(id,campaignId,extra={})=>server.recordStatement(owner,'artifact',id,{id,campaignId,campaignVersion:4,role:'strategy',title:id,content:'초안',status:'review',version:1,origin:'ai',createdAt:now.toString(),...extra},campaignId).run();
await server.recordStatement(owner,'campaign','fc',{id:'fc',brandId:'oda',version:4,status:'review'}).run();
await server.recordStatement(owner,'campaign','fc-store',{id:'fc-store',brandId:'oda',storeId:'s1',version:4,status:'review'}).run();
await server.recordStatement(owner,'campaign','fc-ofd',{id:'fc-ofd',brandId:'ofd',version:4,status:'review'}).run();
const brandRefs=await refsFor(),storeRefs=await refsFor('s1');
await art('fa','fc',{factRefs:brandRefs});await art('fa-store','fc-store',{factRefs:storeRefs});await art('fa-legacy','fc');await art('fa-out','fc',{status:'outdated',factRefs:[]});await art('fa-ofd','fc-ofd',{factRefs:[]});
check('candidate proposal leaves matching artifacts unflagged',(await post({...base,key:'menu',value:'마르게리타'})).status===200&&!(await server.readRecord(owner,'artifact','fa')).factsChanged);
const address=await post({...confirmed,key:'address',value:'휘경동 377 C동 107호'},{confirmed:true});check('new confirmed fact saved',address.status===200);
const flagged=await server.readRecord(owner,'artifact','fa');
check('artifact using old facts flagged factsChanged',flagged.factsChanged===true&&flagged.status==='review'&&flagged.version===1);
check('store campaign artifact flagged by brand fact',(await server.readRecord(owner,'artifact','fa-store')).factsChanged===true);
check('artifact without factRefs left untouched',!('factsChanged' in await server.readRecord(owner,'artifact','fa-legacy')));
check('outdated artifact left untouched',!('factsChanged' in await server.readRecord(owner,'artifact','fa-out')));
check('other brand artifact left untouched',!('factsChanged' in await server.readRecord(owner,'artifact','fa-ofd')));
check('fact change does not bump campaign version',(await server.readRecord(owner,'campaign','fc')).version===4&&(await server.readRecord(owner,'campaign','fc')).status==='review');
await art('fa-current','fc',{factRefs:await refsFor()});
const localOnly=await post({...confirmed,key:'parking',storeId:'s1',value:'주차 불가'},{confirmed:true});check('store-only fact saved',localOnly.status===200);
check('store fact does not flag brand-scope artifacts',!(await server.readRecord(owner,'artifact','fa-current')).factsChanged);
// 후보를 거절(광고 금지 표현)로 바꾸는 것도 입력에 쓴 사실 스냅샷을 바꾼다(DT5).
const menu=(await server.listRecords(owner,'brand_fact','oda')).find(f=>f.key==='menu');
check('rejecting a candidate flags artifacts that used the fact snapshot',(await post({...base,key:'menu',value:'마르게리타'},{id:menu.id,version:menu.version})).status===200&&!(await server.readRecord(owner,'artifact','fa-current')).factsChanged&&(await post({...base,key:'menu',value:'마르게리타',status:'rejected'},{id:menu.id,version:menu.version+1})).status===200&&(await server.readRecord(owner,'artifact','fa-current')).factsChanged===true);
check('legacy confirmed-only refs are compared as confirmed facts',bf.sameEvidenceFactRefs([{id:'a',version:1}],[{id:'a',version:1,status:'confirmed'}])&&!bf.sameEvidenceFactRefs([{id:'a',version:1}],[{id:'a',version:1,status:'rejected'}]));
console.log(JSON.stringify({passed}));
