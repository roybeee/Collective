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
let calls=0,loseAck=false,denyRecovery=false,badOutput=false,providerStatus='completed',failPoll=false,holdSubmit=null,capExtra={},toolsets=[];const submissions=new Map(),inputs=[],destinations=[];
function answer(x){
 if(x.stage==='store_diagnosis')return JSON.stringify({summary:'지점 메뉴·방문 장벽 진단',customer:'제공 주소 인근 주민',bottleneck:'가격 안내 부족',actions:[{channel:'naver_place',priority:'first',action:'실제 메뉴 가격 갱신',reason:'메뉴 자료와 안내 차이',sourceIds:[x.sources[0].id]}],proposals:[{title:'메뉴 가격 안내 실험',channel:'daangn',hypothesis:'가격 명시가 구매를 도울 것이다',control:'기존 소재',treatment:'가격 추가',measurement:'POS 전용 코드',sourceIds:[x.sources[0].id]}],measurementPlan:'결제와 클릭 분리',questions:['원가 확인 필요'],limitations:'모의 공급자 응답·실측 없음',sourceIds:[x.sources[0].id]});
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
  if(holdSubmit)await holdSubmit;
  if(denyRecovery)return new Response('',{status:401});
  const key=options.headers['Idempotency-Key'];if(!submissions.has(key)){calls++;const x=JSON.parse(JSON.parse(options.body).input);inputs.push(x);submissions.set(key,{id:'meeting_run_'+calls,x})}
  if(loseAck){loseAck=false;throw new Error('lost acknowledgement')}
  return Response.json({run_id:submissions.get(key).id});
 }
 if(url.endsWith('/stop')){providerStatus='cancelled';return Response.json({ok:true})}
 if(url.includes('/v1/runs/')){if(failPoll)throw new Error('temporary gateway timeout');const id=url.split('/').pop(),r=[...submissions.values()].find(r=>r.id===id);return Response.json({object:'hermes.run',run_id:id,status:providerStatus,output:badOutput?'invalid JSON':answer(r.x),usage:{total_tokens:50}})}
 throw new Error('Unexpected destination: '+url);
};
const requestTimeouts=[];const trackedAbortSignal={timeout:ms=>{requestTimeouts.push(ms);return AbortSignal.timeout(ms)}};
const ctx=createContext({console,crypto:webcrypto,Response,Request,Headers,File,FormData,TextEncoder,TextDecoder,Uint8Array,Date,URL,AbortSignal:trackedAbortSignal,btoa,atob,fetch:fakeFetch,process:{env:{NODE_ENV:'production'}}});
const backgroundTasks=[];let drainBackground=true;const afterModule=new SyntheticModule(['after'],function(){this.setExport('after',fn=>backgroundTasks.push(fn))},{context:ctx});
const modules=new Map();const envModule=new SyntheticModule(['env'],function(){this.setExport('env',runtime)},{context:ctx});
function moduleFor(file){file=resolve(file);if(modules.has(file))return modules.get(file);if(file.endsWith('?raw')){const raw=new SyntheticModule(['default'],function(){this.setExport('default',readFileSync(file.slice(0,-4),'utf8'))},{context:ctx});modules.set(file,raw);return raw;}const code=ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;const m=new SourceTextModule(code,{context:ctx,identifier:file});modules.set(file,m);return m}
async function load(file){const m=moduleFor(file);if(m.status==='unlinked')await m.link((spec,ref)=>{if(spec==='cloudflare:workers')return envModule;if(spec==='next/server')return afterModule;const f=spec.startsWith('@/')?resolve(spec.slice(2)):resolve(dirname(ref.identifier),spec);return moduleFor(f.endsWith('.ts')||f.endsWith('?raw')?f:f+'.ts')});return m}
const action=await load('app/api/action/route.ts');await action.evaluate();const workspace=await load('app/api/workspace/route.ts');await workspace.evaluate();const run=await load('app/api/run/route.ts');await run.evaluate();
let owner='qa-owner-with-a-production-length-authenticated-user-id';const passed=[];const check=(name,val)=>{assert.ok(val,name);passed.push(name)};
async function request(mod,method,b,override={}){const headers={'Content-Type':'application/json','oai-authenticated-user-id':owner,...override};for(const k in headers)if(headers[k]===null)delete headers[k];const r=await mod.namespace[method](new Request('https://agency.test/api/test',{method,headers,...(b?{body:JSON.stringify(b)}:{})}));const data=await r.json();if(drainBackground)while(backgroundTasks.length)await backgroundTasks.shift()();return {status:r.status,data}}
const act=(name,b={})=>request(action,'POST',{action:name,...b});const snapshot=()=>request(workspace,'GET');


const stores=await load('app/api/stores/route.ts');await stores.evaluate();
const research=await load('app/api/archive/research/route.ts');await research.evaluate();
const server=await load('lib/server.ts');await server.evaluate();
const domain=await load('lib/store-marketing.ts');await domain.evaluate();
const archiveContext=await load('lib/archive-server.ts');await archiveContext.evaluate();
const sp=(action,b={})=>request(stores,'POST',{action,...b});
const rp=(action,b={})=>request(research,'POST',{action,...b});
const sd=async(id,who=owner)=>{const r=await stores.namespace.GET(new Request('https://agency.test/api/stores?storeId='+id,{headers:{'oai-authenticated-user-id':who}}));return {status:r.status,data:await r.json()}};
await snapshot();
const info={name:'검증 지점',address:'서울 성수동 테스트 주소',tradeArea:'residential',goal:'평일 포장 주문 증가',menu:'실제 메뉴 확인 필요',hours:'11시~20시',economics:'원가 확인 필요'};
check('anonymous store write denied',(await request(stores,'POST',{action:'save_store',brandId:'oda',data:info},{'oai-authenticated-user-id':null})).status===401);
check('cross-origin store write denied',(await request(stores,'POST',{action:'save_store',brandId:'oda',data:info},{origin:'https://other.test'})).status===403);
let result=await sp('save_store',{brandId:'oda',data:info});check('store created',result.status===200);const storeId=result.data.id;
check('store durable read',(await sd(storeId)).data.stores.some(s=>s.id===storeId&&s.name===info.name));
check('other owner cannot read store',(await sd(storeId,'other-owner')).status===404);
check('stale store write rejected',(await sp('save_store',{brandId:'oda',id:storeId,version:99,data:info})).status===409);
check('store cannot move brands',(await sp('save_store',{brandId:'ofd',id:storeId,version:1,data:info})).status===400);
const storeB=(await sp('save_store',{brandId:'oda',data:{...info,name:'다른 지점'}})).data.id;
check('channel cannot claim verified without evidence',(await sp('save_channel',{storeId,data:{key:'naver_place',checks:{0:'done'}}})).status===400);
check('channel unsafe URL rejected',(await sp('save_channel',{storeId,data:{key:'naver_place',url:'javascript:alert(1)'}})).status===400);
check('channel evidence saved',(await sp('save_channel',{storeId,data:{key:'naver_place',url:'https://map.naver.com/',checks:{0:'done',1:'todo'},checkedAt:'2026-09-01',evidence:'사용자 메뉴판과 대조'}})).status===200);
check('stale channel write rejected',(await sp('save_channel',{storeId,data:{key:'naver_place',checks:{0:'todo'}}})).status===409);
const plan={title:'포장 가격 실험',channel:'daangn',hypothesis:'가격 안내가 주문 증가에 도움이 된다',control:'기존 문구',treatment:'가격 추가',primaryMetric:'orders',target:10,budget:10000,startDate:'2026-08-01',endDate:'2026-08-31',measurement:'POS 코드·KST',stopRule:'원가 차감 후 손실 발생 시 중단'};
result=await sp('save_experiment',{storeId,data:plan});check('experiment created',result.status===200);const experimentId=result.data.id;
check('cross-store experiment mutation denied',(await sp('start_experiment',{storeId:storeB,experimentId,version:1})).status===400);
const campaign=(await sp('create_campaign',{storeId,experimentId})).data.id;
check('campaign creation idempotent',(await sp('create_campaign',{storeId,experimentId})).data.id===campaign);
let c=(await snapshot()).data.campaigns.find(c=>c.id===campaign);check('campaign retains store context',c.storeId===storeId&&c.storeExperimentId===experimentId&&c.plan.tracking===plan.measurement);
check('campaign cannot link foreign brand store',(await act('save_campaign',{data:{...c,brandId:'ofd'}})).status===400);
check('campaign edit preserves store when omitted',(await act('save_campaign',{id:c.id,version:c.version,data:{...c,storeId:undefined}})).status===200);
check('linked campaign freezes experiment design',(await sp('save_experiment',{storeId,id:experimentId,version:2,data:{...plan,budget:50000}})).status===409);
check('experiment start',(await sp('start_experiment',{storeId,experimentId,version:2})).status===200);
check('started experiment design locked',(await sp('save_experiment',{storeId,id:experimentId,version:3,data:plan})).status===409);
const measurement={periodStart:'2026-08-01',periodEnd:'2026-08-07',source:'테스트 POS',definition:'Asia/Seoul · 해당 쿠폰·신규 고객·전체 비용',method:'export',cohortMatured:false,values:{orders:12,newCustomers:6,revenue:120000,variableCosts:60000,adSpend:10000,productionCost:5000,couponReceived:20,couponUsed:10,eligibleCustomers:10,repeatCustomers:3}};
check('invalid actual calendar rejected',(await sp('save_measurement',{storeId,experimentId,data:{...measurement,periodStart:'2026-02-30'}})).status===400);
check('coupon denominator validated',(await sp('save_measurement',{storeId,experimentId,data:{...measurement,values:{couponReceived:3,couponUsed:4}}})).status===400);
check('fractional visits rejected',(await sp('save_measurement',{storeId,experimentId,data:{...measurement,values:{visits:1.5}}})).status===400);
result=await sp('save_measurement',{storeId,experimentId,data:measurement});check('measurement saved',result.status===200);const mid=result.data.id;
check('overlap rejected',(await sp('save_measurement',{storeId,experimentId,data:measurement})).status===409);
let d=(await sd(storeId)).data,m=d.measurements.find(m=>m.id===mid),metrics=domain.namespace.storeMetrics(m);
check('missing is null not zero',m.values.visits===null);
check('contribution calculated with complete costs',metrics.find(x=>x.label==='비용 차감 잔액').value===45000);
check('unfinished cohort not used',metrics.find(x=>x.label==='재구매율').value===null);
check('new customer ad cost correct',Math.abs(metrics.find(x=>x.label==='신규 고객당 광고비').value-10000/6)<0.01);
check('stale measurement update denied',(await sp('save_measurement',{storeId,experimentId,id:mid,version:99,data:measurement})).status===409);
check('measurement edit works',(await sp('save_measurement',{storeId,experimentId,id:mid,version:1,data:{...measurement,cohortMatured:true}})).status===200);
check('close with learning',(await sp('close_experiment',{storeId,experimentId,version:3,decision:'iterate',learning:'요일 차이로 인과 판단 보류. 같은 요일로 재실험.'})).status===200);
check('closed results preserved',(await sp('save_measurement',{storeId,experimentId,id:mid,version:2,data:measurement})).status===409);
const context=await archiveContext.namespace.brandArchiveContext(owner,'oda',storeId);
check('next campaign gets same-store learning',context.storeMarketing.experiments[0].learning.includes('요일 차이'));
check('other store does not inherit learning',(await archiveContext.namespace.brandArchiveContext(owner,'oda',storeB)).storeMarketing.experiments.length===0);
check('brand-only context excludes store data',(await archiveContext.namespace.brandArchiveContext(owner,'oda')).storeMarketing===null);
await act('save_hermes',{endpoint:'https://gateway.example.com',key:'a-secret-of-more-than-twenty-characters'});
result=await rp('start',{id:'store-research-one',brandId:'oda',storeId,mode:'deep'});check('store research queued',result.status===202);
check('store research snapshots target',(await server.namespace.readRecord(owner,'brand_research','store-research-one')).snapshot.store.id===storeId);
check('store research has local final stage',result.data.steps[3].stage==='store_diagnosis');
for(let i=0;i<10;i++){result=await rp('advance',{id:'store-research-one'});if(result.data.status==='completed'||result.data.status==='failed')break;}
check('local research fully saves without viral samples',result.data.status==='completed');
d=(await sd(storeId)).data;check('local report persisted',d.reports[0].summary.includes('지점 메뉴')&&d.reports[0].storeVersion===1);
check('sources tagged with store',d.sources.every(s=>s.storeId===storeId));
check('local research receives previous learning',inputs.some(x=>x.stage==='store_diagnosis'&&x.storeContext.experiments[0].learning.includes('요일 차이')));
const rid=d.reports[0].id;
check('task completion requires evidence',(await sp('save_task',{storeId,reportId:rid,index:0,status:'done'})).status===400);
check('task completion recorded',(await sp('save_task',{storeId,reportId:rid,index:0,status:'done',evidence:'가격 대조 후 수정 완료'})).status===200);
check('task cannot cross stores',(await sp('save_task',{storeId:storeB,reportId:rid,index:0,status:'done',evidence:'x'})).status===400);
const savedSource=await server.namespace.readRecord(owner,'brand_source',d.reports[0].sourceIds[0]);
await server.namespace.recordStatement(owner,'brand_source',savedSource.id,{...savedSource,status:'excluded'},'oda').run();
check('excluded evidence removes report from AI context',(await archiveContext.namespace.brandArchiveContext(owner,'oda',storeId)).storeMarketing.researchDraft===null);
check('excluded evidence cannot seed experiment',(await sp('save_experiment',{storeId,reportId:rid,data:plan})).status===409);
await server.namespace.recordStatement(owner,'brand_source',savedSource.id,savedSource,'oda').run();
const beforeStoreEdit=(await snapshot()).data.campaigns.find(c=>c.id===campaign).version;
await sp('save_store',{brandId:'oda',id:storeId,version:1,data:{...info,name:'수정된 지점'}});
check('store edit invalidates linked campaign version',(await snapshot()).data.campaigns.find(c=>c.id===campaign).version===beforeStoreEdit+1);
check('outdated report excluded from AI context',(await archiveContext.namespace.brandArchiveContext(owner,'oda',storeId)).storeMarketing.researchDraft===null);
check('outdated report cannot seed experiment',(await sp('save_experiment',{storeId,reportId:rid,data:plan})).status===409);
check('cross-store research replay denied',(await rp('start',{id:'store-research-one',brandId:'oda',storeId:storeB})).status===409);
console.log(JSON.stringify({passed:passed.length,checks:passed},null,2));
