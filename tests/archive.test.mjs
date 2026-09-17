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

const blobs=new Map();runtime.BUCKET={put:async(k,stream)=>blobs.set(k,await new Response(stream).arrayBuffer()),get:async k=>blobs.has(k)?{body:blobs.get(k)}:null,delete:async k=>blobs.delete(k)};
let calls=0,loseAck=false,denyRecovery=false,badOutput=false,providerStatus='completed';const submissions=new Map(),inputs=[];
function answer(x){
 if(!x.stage)return "검증용 공급자 응답";
 if(x.stage==='diagnosis')return JSON.stringify({summary:'브랜드 현황 진단',positioning:'상품 중심',audience:'인근 고객',needs:'구매 장벽 파악',strengths:'확인된 가격',gaps:'전환 측정 부족',opportunities:x.sources.length?[{title:'구매 장벽 실험',hypothesis:'가격 안내가 장벽을 줄일 수 있음',action:'가격 안내 비교',metric:'핵심 행동 세션율',sourceIds:[x.sources[0].id]}]:[],questions:['실제 고객 선택 이유는?'],sourceIds:x.sources.length?[x.sources[0].id]:[],limitations:'통제 실험 전 가설'});
 return JSON.stringify({summary:'자료를 검토했습니다.',limitations:'공개 자료와 제공 문서만 확인',classifications:x.sources.map(s=>({sourceId:s.id,category:s.category,reason:'기존 분류 유지'})),sources:x.mode==='deep'?[{title:x.stage+' 공식 정보',category:'product',url:'https://brand.example.com/menu',content:'확인한 메뉴와 가격. 테스트 제공자 응답.',scope:'공식 메뉴 페이지',observedAt:new Date().toISOString()}]:[]});
}
const fakeFetch=async(url,options={})=>{
 if(url.endsWith('/v1/capabilities'))return options.headers?Response.json({object:'hermes.api_server.capabilities',platform:'hermes-agent',features:{run_submission:true,run_status:true,run_stop:true,runs_idempotency:{durable:true}}}):new Response('',{status:401});
 if(url.endsWith('/v1/models'))return Response.json({data:[{id:'test-hermes'}]});
 if(url.endsWith('/v1/runs')&&options.method==='POST'){
  if(denyRecovery)return new Response('',{status:401});
  const key=options.headers['Idempotency-Key'];if(!submissions.has(key)){calls++;const x=JSON.parse(JSON.parse(options.body).input);inputs.push(x);submissions.set(key,{id:'meeting_run_'+calls,x})}
  if(loseAck){loseAck=false;throw new Error('lost acknowledgement')}
  return Response.json({run_id:submissions.get(key).id});
 }
 if(url.endsWith('/stop')){providerStatus='cancelled';return Response.json({ok:true})}
 if(url.includes('/v1/runs/')){const id=url.split('/').pop(),r=[...submissions.values()].find(r=>r.id===id);return Response.json({object:'hermes.run',run_id:id,status:providerStatus,output:badOutput?'invalid JSON':answer(r.x),usage:{total_tokens:50}})}
 throw new Error('Unexpected destination: '+url);
};
const ctx=createContext({console,crypto:webcrypto,Response,Request,Headers,File,FormData,TextEncoder,TextDecoder,Uint8Array,Date,URL,AbortSignal,btoa,atob,fetch:fakeFetch,process:{env:{NODE_ENV:'production'}}});
const modules=new Map();const envModule=new SyntheticModule(['env'],function(){this.setExport('env',runtime)},{context:ctx});
async function load(file){file=resolve(file);if(modules.has(file))return modules.get(file);const code=ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;const m=new SourceTextModule(code,{context:ctx,identifier:file});modules.set(file,m);await m.link(async(spec,ref)=>{if(spec==='cloudflare:workers')return envModule;const f=spec.startsWith('@/')?resolve(spec.slice(2)):resolve(dirname(ref.identifier),spec);return load(f.endsWith('.ts')?f:f+'.ts')});return m}
const action=await load('app/api/action/route.ts');await action.evaluate();const workspace=await load('app/api/workspace/route.ts');await workspace.evaluate();const run=await load('app/api/run/route.ts');await run.evaluate();
let owner='qa-owner-with-a-production-length-authenticated-user-id';const passed=[];const check=(name,val)=>{assert.ok(val,name);passed.push(name)};
async function request(mod,method,b,override={}){const headers={'Content-Type':'application/json','oai-authenticated-user-id':owner,...override};for(const k in headers)if(headers[k]===null)delete headers[k];const r=await mod.namespace[method](new Request('https://agency.test/api/test',{method,headers,...(b?{body:JSON.stringify(b)}:{})}));return {status:r.status,data:await r.json()}}
const act=(name,b={})=>request(action,'POST',{action:name,...b});const snapshot=()=>request(workspace,'GET');

const archive=await load('app/api/archive/route.ts');await archive.evaluate();
const research=await load('app/api/archive/research/route.ts');await research.evaluate();
const files=await load('app/api/archive/file/route.ts');await files.evaluate();
const server=await load('lib/server.ts');await server.evaluate();
const logic=await load('lib/archive.ts');await logic.evaluate();
const context=await load('lib/archive-server.ts');await context.evaluate();
const ap=(action,b={})=>request(archive,'POST',{action,...b});
const rp=(action,b={})=>request(research,'POST',{action,...b});
const ar=async(brandId='new-brand')=>{const r=await archive.namespace.GET(new Request('https://agency.test/api/archive?brandId='+brandId,{headers:{'oai-authenticated-user-id':owner}}));return {status:r.status,data:await r.json()}};
await snapshot();
const create={id:'new-brand',data:{name:'검증용 브랜드',category:'베이커리',description:'테스트',intake:{website:'https://brand.example.com',clientNeed:'평일 방문 개선'}}};
check('anonymous creation rejected',(await request(archive,'POST',{action:'create_brand',...create},{'oai-authenticated-user-id':null})).status===401);
check('cross origin mutation rejected',(await request(archive,'POST',{action:'create_brand',...create},{origin:'https://evil.example.com'})).status===403);
check('dynamic brand created',(await ap('create_brand',create)).status===200);
check('brand creation replay idempotent',(await ap('create_brand',create)).data.id==='new-brand'&&(await snapshot()).data.brands.filter(b=>b.id==='new-brand').length===1);
const campaign={brandId:'new-brand',title:'새 브랜드 캠페인',goal:'평일 방문 개선'};
let res=await act('save_campaign',{data:campaign});const campaignId=res.data.id;
check('new brand accepted by campaign server',res.status===200);
check('non-owned brand rejected',(await act('save_campaign',{data:{...campaign,brandId:'foreign-brand'}})).status===404);
const source={title:'제품 가격',content:'도넛 가격 5000원, 테스트 자료',url:'https://brand.example.com/menu'};
res=await ap('add_source',{brandId:'new-brand',data:source});const sid=res.data.id;
check('source stored and classified',(await ar()).data.sources[0].category==='product');
check('candidate excluded from campaign context',(await context.namespace.brandArchiveContext(owner,'new-brand')).confirmedSources.length===0);
check('stale source review rejected',(await ap('review_source',{brandId:'new-brand',id:sid,version:99,status:'confirmed'})).status===409);
await ap('review_source',{brandId:'new-brand',id:sid,version:1,status:'confirmed'});
check('confirmed source reaches campaign context',(await context.namespace.brandArchiveContext(owner,'new-brand')).confirmedSources[0].id===sid);
const originalOwner=owner;owner='foreign-owner';check('other owner cannot read archive',(await ar()).status===404);check('other owner cannot review source',(await ap('review_source',{brandId:'new-brand',id:sid,version:2,status:'excluded'})).status===404);owner=originalOwner;
const observation={channel:'Instagram',account:'test',periodStart:'2026-08-01',periodEnd:'2026-08-07',observedAt:'2026-08-08T00:00:00Z',source:'실측 내보내기',scope:'organic',method:'export',definition:'KST, 계정 전체, 구매 세션',values:{reach:1000,shares:50,sessions:100,keyEventSessions:10,revenue:10000,adSpend:5000,variableCosts:8000,productionCost:1000}};
check('invalid event session denominator rejected',(await ap('add_observation',{brandId:'new-brand',data:{...observation,values:{sessions:10,keyEventSessions:11}}})).status===400);
check('internal metrics cannot masquerade as public',(await ap('add_observation',{brandId:'new-brand',data:{...observation,method:'public'}})).status===400);
check('measurement saved',(await ap('add_observation',{brandId:'new-brand',data:observation})).status===200);
let obs=(await ar()).data.observations[0],metrics=logic.namespace.dashboardMetrics(obs);
check('share and session rates use correct denominators',metrics.find(m=>m.id==='share').value===5&&metrics.find(m=>m.id==='conversion').value===10);
check('missing input is not zero',metrics.find(m=>m.id==='save').value===null&&metrics.find(m=>m.id==='contribution').value===-4000);
check('zero denominator differs from missing',logic.namespace.dashboardMetrics({...obs,values:{...obs.values,reach:0}}).find(m=>m.id==='share').unavailable==='분모 0 · 계산 불가');
check('observations with definitions reach AI context',(await context.namespace.brandArchiveContext(owner,'new-brand')).observations[0].definition===observation.definition);
const cur={...obs,id:'current',periodStart:'2026-08-08',periodEnd:'2026-08-14'};
check('comparison requires matched scope and interval',logic.namespace.comparablePrevious(cur,[obs])?.id===obs.id&&!logic.namespace.comparablePrevious({...cur,scope:'paid'},[obs]));
check('public cumulative snapshots not compared',!logic.namespace.comparablePrevious({...cur,method:'public'},[{...obs,method:'public'}]));
check('research requires configured provider',(await rp('start',{id:'deep-1',brandId:'new-brand'})).status===409);
await act('save_hermes',{endpoint:'https://hermes.example.com',key:'hermes-local-test-key-only'});
res=await rp('start',{id:'deep-1',brandId:'new-brand'});
check('deep research prepares four real provider stages',res.status===200&&res.data.steps.length===4&&calls===0);
check('raw source corpus not duplicated in snapshot',!(await server.namespace.readRecord(owner,'brand_research','deep-1')).snapshot.sources);
check('active research blocks source edits',(await ap('add_source',{brandId:'new-brand',data:source})).status===409);
check('active research blocks connection removal',(await act('disconnect')).status===409);
check('repeated start reuses durable job',(await rp('start',{id:'deep-1',brandId:'new-brand'})).data.id==='deep-1'&&sql.prepare("SELECT count(*) n FROM jobs WHERE role='brand_research'").get().n===1);
for(let i=0;i<10;i++){res=await rp('advance',{id:'deep-1'});if(res.data.status==='completed'||res.data.status==='failed')break}
check('all research stages complete',res.data.status==='completed'&&calls===4);
check('later research receives earlier sources',inputs[2].sources.length===3&&inputs[3].priorSteps.length===3);
check('public research hides snapshots and provider IDs',!res.data.snapshot&&!JSON.stringify(res.data).includes('providerId'));
let archiveData=(await ar()).data;check('research records real source refs as candidates',archiveData.sources.filter(s=>s.origin==='research').length===3&&archiveData.diagnostics[0].sourceIds.length===1);
await ap('add_source',{brandId:'new-brand',data:{...source,title:'변경된 근거'}});
check('stale diagnosis cannot be adopted',(await ap('confirm_diagnosis',{brandId:'new-brand',id:'deep-1'})).status===409);
for(const s of (await ar()).data.sources.filter(s=>s.status==='candidate'))await ap('review_source',{brandId:'new-brand',id:s.id,version:s.version,status:'confirmed'});
await rp('start',{id:'classify-1',brandId:'new-brand',mode:'classify'});
for(let i=0;i<5;i++){res=await rp('advance',{id:'classify-1'});if(res.data.status==='completed')break}
check('classification diagnosis uses two stages without new external sources',res.data.status==='completed'&&(await ar()).data.sources.length===5);
check('diagnosis grounded in confirmed current sources adoptable',(await ap('confirm_diagnosis',{brandId:'new-brand',id:'classify-1'})).status===200);
check('adopted diagnosis reaches AI context',(await context.namespace.brandArchiveContext(owner,'new-brand')).confirmedDiagnosis.id==='classify-1');
await act('save_brand',{id:'new-brand',data:{description:'브랜드 포지셔닝 변경'}});
check('brand basic changes invalidate adopted diagnosis',(await context.namespace.brandArchiveContext(owner,'new-brand')).confirmedDiagnosis===null);
await rp('start',{id:'ack-lost',brandId:'new-brand'});loseAck=true;res=await rp('advance',{id:'ack-lost'});const before=calls;
check('lost ACK keeps uncertain lock',res.data.status==='uncertain');denyRecovery=true;res=await rp('recover',{id:'ack-lost'});check('recovery auth rejection retains lock',res.data.status==='uncertain'&&(await act('disconnect')).status===409);denyRecovery=false;
res=await rp('recover',{id:'ack-lost'});check('recovery reuses provider request',res.data.status==='running'&&calls===before);
res=await rp('cancel',{id:'ack-lost'});check('cancellation ends known provider',res.data.status==='cancelled');providerStatus='completed';
await rp('start',{id:'cancel-pending',brandId:'new-brand'});const cancelBefore=calls;check('pending cancellation submits nothing',(await rp('cancel',{id:'cancel-pending'})).data.status==='cancelled'&&calls===cancelBefore);
await rp('start',{id:'bad-output',brandId:'new-brand'});await rp('advance',{id:'bad-output'});badOutput=true;res=await rp('advance',{id:'bad-output'});badOutput=false;check('malformed output fails without fake diagnosis',res.data.status==='failed'&&!(await ar()).data.diagnostics.some(d=>d.id==='bad-output'));
async function upload(){const form=new FormData();form.set('brandId','new-brand');form.set('file',new File(['원본 브랜드 제품 가격'],'brief.txt',{type:'text/plain'}));form.set('content','원본 브랜드 제품 가격');return files.namespace.POST(new Request('https://agency.test/api/archive/file',{method:'POST',headers:{'oai-authenticated-user-id':owner},body:form}))}
res=await upload();const fid=(await res.json()).id;check('upload stores original and source',res.status===200&&blobs.size===1);
const download=(id,user=owner)=>files.namespace.GET(new Request('https://agency.test/api/archive/file?id='+id,{headers:{'oai-authenticated-user-id':user}}));
res=await download(fid);check('original downloads as attachment',res.status===200&&res.headers.get('content-disposition').startsWith('attachment')&&await res.text()==='원본 브랜드 제품 가격');check('cross-owner download forbidden',(await download(fid,'foreign')).status===404);
const originalBatch=DB.batch;DB.batch=async()=>{throw new Error('injected storage failure')};res=await upload();DB.batch=originalBatch;check('failed metadata write cleans new original',res.status===500&&blobs.size===1);
const published=(await ar()).data;check('public source list contains no object key or full content',published.sources.every(s=>!s.objectKey&&!s.content));


for(let i=0;i<31;i++)await ap('add_source',{brandId:'new-brand',data:{title:'분류 배치 '+i,content:'추가 분류 자료 '+i}});
const totalSources=(await ar()).data.sources.length;res=await rp('start',{id:'all-batches',brandId:'new-brand',mode:'classify'});check('classification creates enough batches for entire archive',res.data.steps.length===3);
const inputStart=inputs.length;for(let i=0;i<7;i++){res=await rp('advance',{id:'all-batches'});if(res.data.status==='completed')break}
const handled=new Set(inputs.slice(inputStart).filter(x=>x.stage==='identity').flatMap(x=>x.sources.map(s=>s.id)));check('classification covers older sources beyond first 30',res.data.status==='completed'&&handled.size===totalSources);
const brief=await load('app/api/brief/route.ts');await brief.evaluate();
res=await request(brief,'POST',{action:'start',id:'archive-brief',data:campaign});check('new brand brief receives confirmed archive and real metrics',res.status===200&&inputs.at(-1).brandArchive.confirmedSources.some(s=>s.id===sid)&&inputs.at(-1).brandArchive.observations.length===1);await request(brief,'POST',{action:'cancel',id:'archive-brief'});providerStatus='completed';
res=await request(run,'POST',{action:'start',campaignId,role:'cmo'});check('ordinary agent receives archive context',res.status===200&&inputs.at(-1).brandArchive.confirmedSources.some(s=>s.id===sid));await request(run,'POST',{action:'cancel',id:res.data.id});providerStatus='completed';
const meetings=await load('app/api/meetings/route.ts');await meetings.evaluate();const currentCampaign=await server.namespace.readRecord(owner,'campaign',campaignId);
res=await request(meetings,'POST',{action:'start',id:'archive-meeting',campaignId,campaignVersion:currentCampaign.version,agenda:'브랜드 자료를 기반으로 논의'});await request(meetings,'POST',{action:'advance',id:'archive-meeting'});check('meeting participants receive archive snapshot',res.status===200&&inputs.at(-1).brandArchive.confirmedSources.some(s=>s.id===sid)&&inputs.at(-1).brandArchive.observations.length===1);await request(meetings,'POST',{action:'cancel',id:'archive-meeting'});
console.log(JSON.stringify({passed:passed.length,checks:passed},null,2));
