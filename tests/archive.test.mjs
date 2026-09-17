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
let calls=0,loseAck=false,denyRecovery=false,badOutput=false,providerStatus='completed',capExtra={},toolsets=[];const submissions=new Map(),inputs=[],destinations=[];
function answer(x){
 if(!x.stage)return "검증용 공급자 응답";
 if(x.stage==='investigation'){const sources=['brand','product','customer'].map((category,i)=>({id:'new-'+i,title:'공식 자료 '+i,category,url:'https://brand.example.com/evidence/'+i,content:'테스트에서 제공한 관찰 정보',scope:'공식 원문',observedAt:new Date().toISOString()}));return JSON.stringify({sources,phases:['조사 계획','브랜드·사업 이해','고객·경쟁 조사','콘텐츠 비교','반론·보완 조사','진단·실험 제안'].map(phase=>({phase,summary:'단계별 관찰 결과'})),access:sources.map(s=>({sourceId:s.id,method:'browser',tool:'test-browser',scope:'읽기 전용 관찰'})),cases:[],customerSignals:[],competitors:[],review:{claims:[],followups:[],unresolved:['추가 콘텐츠 자료 필요']},diagnosis:JSON.parse(answer({...x,stage:'diagnosis'}))})}
 if(x.stage==='diagnosis')return JSON.stringify({summary:'브랜드 현황 진단',positioning:'상품 중심',audience:'인근 고객',needs:'구매 장벽 파악',strengths:'확인된 가격',gaps:'전환 측정 부족',opportunities:x.sources.length?[{title:'구매 장벽 실험',hypothesis:'가격 안내가 장벽을 줄일 수 있음',action:'가격 안내 비교',metric:'핵심 행동 세션율',sourceIds:[x.sources[0].id]}]:[],questions:['실제 고객 선택 이유는?'],sourceIds:x.sources.length?[x.sources[0].id]:[],limitations:'통제 실험 전 가설'});
 return JSON.stringify({summary:'자료를 검토했습니다.',limitations:'공개 자료와 제공 문서만 확인',classifications:x.sources.map(s=>({sourceId:s.id,category:s.category,reason:'기존 분류 유지'})),sources:x.mode==='deep'?[{title:x.stage+' 공식 정보',category:'product',url:'https://brand.example.com/menu',content:'확인한 메뉴와 가격. 테스트 제공자 응답.',scope:'공식 메뉴 페이지',observedAt:new Date().toISOString()}]:[]});
}
const fakeFetch=async(url,options={})=>{
 destinations.push(url);
 if(url.endsWith('/v1/capabilities'))return options.headers?Response.json({object:'hermes.api_server.capabilities',platform:'hermes-agent',features:{run_submission:true,run_status:true,run_stop:true,runs_idempotency:{durable:true}},...capExtra}):new Response('',{status:401});
 if(url.endsWith('/v1/toolsets'))return Response.json({data:toolsets});
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
check('deep research submits continuous server run before returning',res.status===200&&res.data.steps.length===1&&calls===1&&!!res.data.protocol);
check('raw source corpus not duplicated in snapshot',!(await server.namespace.readRecord(owner,'brand_research','deep-1')).snapshot.sources);
check('active research blocks source edits',(await ap('add_source',{brandId:'new-brand',data:source})).status===409);
check('active research blocks connection removal',(await act('disconnect')).status===409);
check('repeated start reuses durable job',(await rp('start',{id:'deep-1',brandId:'new-brand'})).data.id==='deep-1'&&sql.prepare("SELECT count(*) n FROM jobs WHERE role='brand_research'").get().n===1);
for(let i=0;i<10;i++){res=await rp('advance',{id:'deep-1'});if(res.data.status==='completed'||res.data.status==='failed')break}
check('all research stages complete',res.data.status==='completed'&&calls===1);
check('continuous investigation receives plan and honest capability status',inputs[0].plan.targetCases===15&&inputs[0].access.aside==='unverified');
check('incomplete research is not strategy ready',res.data.report.quality.status==='needs_data'&&(await ap('confirm_diagnosis',{brandId:'new-brand',id:'deep-1'})).status===409);
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
loseAck=true;res=await rp('start',{id:'ack-lost',brandId:'new-brand'});const before=calls;
check('lost ACK keeps uncertain lock',res.data.status==='uncertain');denyRecovery=true;res=await rp('recover',{id:'ack-lost'});check('recovery auth rejection retains lock',res.data.status==='uncertain'&&(await act('disconnect')).status===409);denyRecovery=false;
res=await rp('recover',{id:'ack-lost'});check('recovery reuses provider request',res.data.status==='running'&&calls===before);
res=await rp('cancel',{id:'ack-lost'});check('cancellation ends known provider',res.data.status==='cancelled');providerStatus='completed';
await rp('start',{id:'cancel-pending',brandId:'new-brand',mode:'classify'});const cancelBefore=calls;check('pending cancellation submits nothing',(await rp('cancel',{id:'cancel-pending'})).data.status==='cancelled'&&calls===cancelBefore);
await rp('start',{id:'bad-output',brandId:'new-brand'});badOutput=true;res=await rp('advance',{id:'bad-output'});badOutput=false;check('malformed output fails without fake diagnosis',res.data.status==='failed'&&!(await ar()).data.diagnostics.some(d=>d.id==='bad-output'));
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
providerStatus='completed';
const deep=await load('lib/deep-research-server.ts');await deep.evaluate();const deepLogic=await load('lib/deep-research.ts');await deepLogic.evaluate();
const cfg=await server.namespace.connection(owner);
capExtra={endpoints:{toolsets:{method:'GET',path:'/v1/toolsets'}}};toolsets=[{name:'aside',enabled:true,configured:false,tools:['aside_browser']},{name:'browser',enabled:false,configured:true,tools:['browser_open']}];
check('disabled or unconfigured browser tools are not advertised',(await deep.namespace.inspectResearchAccess(cfg)).browser==='unverified');
toolsets=[{name:'aside',enabled:true,configured:true,tools:['aside_browser']}];const advertised=await deep.namespace.inspectResearchAccess(cfg);
check('advertised Aside remains distinct from actual site access',advertised.aside==='advertised'&&advertised.notes.some(s=>s.includes('실제 접속 성공을 뜻하지')));
capExtra={endpoints:{toolsets:{method:'GET',path:'https://evil.example.com/steal'}}};const destinationStart=destinations.length;await deep.namespace.inspectResearchAccess(cfg);
check('gateway cannot redirect capability probe to arbitrary endpoint',destinations.slice(destinationStart).every(s=>s.endsWith('/v1/capabilities')));capExtra={};
const date=new Date().toISOString(),publishedAt=new Date(Date.now()-4*86400000).toISOString();
const rawSources=Array.from({length:15},(_,i)=>({id:'case-'+i,title:'영상 '+i,category:'channel',url:'https://brand.example.com/video/'+i,content:'관찰된 공개 콘텐츠',scope:'테스트 영상 전체',observedAt:date}));
for(const category of ['brand','product','customer','market','operations'])rawSources.push({id:category,title:category,category,url:'https://brand.example.com/'+category,content:'확인된 테스트 자료',scope:'원문',observedAt:date});
const cases=rawSources.slice(0,15).map((s,i)=>({id:'content-'+i,sourceId:s.id,account:'brand',channel:'Instagram',relationship:'own',format:'video',publishedAt,observedAt:date,distribution:'organic',views:(i+1)*100,likes:null,comments:0,shares:null,durationSeconds:20,viewing:'full',viewedRanges:[{start:0,end:20}],timeline:[{second:0,observation:'첫 장면 관찰'}],hook:'도입 관찰',message:'제품 소개',proof:'사용 장면',cta:'제품 보기',friction:'가격 미표시',hypothesis:'사용 장면이 관심을 높였을 수 있음',alternative:'기존 고객 노출 차이'}));
const fixture={sources:rawSources,phases:Array.from(deepLogic.namespace.researchPhases,phase=>({phase,summary:'검토 내용'})),access:rawSources.map(s=>({sourceId:s.id,method:'browser',tool:'test-browser',scope:'원문 관찰'})),cases,customerSignals:[{sourceId:'customer',kind:'barrier',observation:'가격에 관한 질문',implication:'가격 안내 검증'}],competitors:[1,2,3].map(i=>({name:'경쟁 '+i,sourceIds:['market'],difference:'상품 구성 차이'})),review:{claims:[{claim:'가격 안내 기회',sourceIds:['customer'],counterEvidence:'가격 이외 방문 장벽',nextCheck:'한 변수 실험'}],followups:[],unresolved:[]},diagnosis:{...JSON.parse(answer({stage:'diagnosis',sources:[{id:'product'}]})),sourceIds:rawSources.map(s=>s.id)}};
const record={id:'parser-check',brandId:'new-brand',createdAt:date,plan:deepLogic.namespace.defaultResearchPlan(create.data)};
const parse=value=>deep.namespace.parseDeepReport(value,record,[]);
const valid=parse(fixture);check('complete grounded fixture reaches human review with canonical refs',valid.report.quality.status==='review_ready'&&valid.report.quality.comparableGroups===1&&valid.diagnosis.sourceIds.every(id=>id.startsWith('parser-check-e')));
const groups=deepLogic.namespace.comparisonGroups(valid.report.cases);check('comparison computes sample bands and median',groups[0].median===800&&groups[0].items.filter(x=>x.band==='high').length===5&&groups[0].items[0].relativeViews===0.125);
check('unknown ad status excluded from comparative rankings',deepLogic.namespace.comparisonGroups(cases.map(c=>({...c,distribution:'unknown'}))).length===0);
check('unmatched accounts cannot be combined for sample threshold',deepLogic.namespace.comparisonGroups(cases.map((c,i)=>({...c,account:'account-'+Math.floor(i/5)}))).length===0);
check('unmatched age buckets cannot be combined',deepLogic.namespace.comparisonGroups(cases.map((c,i)=>({...c,publishedAt:new Date(Date.now()-[3,15,50][Math.floor(i/5)]*86400000).toISOString()}))).length===0);
check('zero median produces no invented relative multiplier',deepLogic.namespace.comparisonGroups(cases.map((c,i)=>({...c,views:i<10?0:i})))[0].items.every(x=>x.relativeViews===null));
function rejects(name,change){const x=structuredClone(fixture);change(x);assert.throws(()=>parse(x));passed.push(name)}
rejects('full-view claim with missing segment rejected',x=>x.cases[0].viewedRanges=[{start:0,end:5},{start:10,end:20}]);
rejects('search snippet cannot claim video viewing',x=>x.access[0].method='search_snippet');
rejects('unseen scene cannot appear in timeline',x=>{x.cases[0].viewing='partial';x.cases[0].viewedRanges=[{start:0,end:5}];x.cases[0].timeline[0].second=8});
rejects('fabricated source reference rejected',x=>x.review.claims[0].sourceIds=['missing']);
rejects('duplicate content cannot inflate sample',x=>x.cases[1].sourceId=x.cases[0].sourceId);
rejects('duplicate source URL cannot inflate evidence',x=>x.sources[1].url=x.sources[0].url);
rejects('missing investigation phase rejected',x=>x.phases.pop());
rejects('unobserved count cannot silently become zero',x=>delete x.cases[0].views);
const insufficient=structuredClone(fixture);insufficient.cases=insufficient.cases.slice(0,4);insufficient.quality={status:'review_ready'};
check('provider cannot override server quality gate',parse(insufficient).report.quality.status==='needs_data');
const unviewed=structuredClone(fixture);Object.assign(unviewed.cases[0],{viewing:'not_viewed',viewedRanges:[],timeline:[]});check('unviewed video preserves report but blocks strategy readiness',parse(unviewed).report.quality.status==='needs_data');
const old=structuredClone(fixture);old.cases.forEach(c=>c.publishedAt=new Date(Date.now()-120*86400000).toISOString());check('old content cannot meet recent sample requirement',parse(old).report.quality.status==='needs_data');
res=await rp('start',{id:'followup-test',brandId:'new-brand',previousResearchId:'deep-1'});check('followup submits missing evidence questions',res.status===200&&inputs.at(-1).previousGaps.length>0&&inputs.at(-1).maxNewSources<=40);
providerStatus='waiting_approval';res=await rp('advance',{id:'followup-test'});check('tool approval is visible and never marked complete',res.data.status==='running'&&res.data.error.includes('승인'));
providerStatus='completed';const countBefore=(await ar()).data.sources.length;
DB.batch=async()=>{throw new Error('injected final storage failure')};res=await rp('advance',{id:'followup-test'});DB.batch=originalBatch;
check('failed final storage retains running job and no partial evidence',res.status===500&&(await server.namespace.readRecord(owner,'brand_research','followup-test')).status==='running'&&(await ar()).data.sources.length===countBefore);
res=await rp('advance',{id:'followup-test'});await rp('advance',{id:'followup-test'});check('final storage retry archives once',res.data.status==='completed'&&(await ar()).data.sources.length===countBefore+3);
await ap('create_brand',{id:'other-brand',data:{name:'다른 브랜드',category:'서비스'}});
check('cross-brand followup rejected',(await rp('start',{id:'wrong-followup',brandId:'other-brand',previousResearchId:'deep-1'})).status===409);
console.log(JSON.stringify({passed:passed.length,checks:passed},null,2));
