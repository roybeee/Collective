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

let calls=0,loseAck=false,denyRecovery=false,badOutput=false,providerStatus='completed';const submissions=new Map(),inputs=[];
function answer(x){
 if(x.phase==='discussion')return JSON.stringify({position:'실제 브리프를 검토했습니다. 평일 오후 고객은 가격보다 제품 단면과 구매 이유를 먼저 확인한다는 가설이 가장 중요합니다.',evidence:'주어진 브리프만 사용했고 고객 반응은 미측정입니다. 가격과 판매 메뉴는 [자료 필요]이며 매장 담당자가 확인합니다.',challenge:'앞선 제안의 공유 동기와 검증 기준을 보완해야 합니다. 확인되지 않은 인기 표현은 사용하지 않습니다.',proposal:'제품 단면을 먼저 보여주는 첫 장면과 기존 컷을 2주간 공유율로 대조하고, 콘텐츠 담당에게 대조안 두 개를 요청합니다.',respondsTo:x.allowedRespondsTo.length?[x.allowedRespondsTo.at(-1).ref]:[]});
 if(x.phase==='synthesis')return JSON.stringify({decisions:'공유 동기를 드러내는 콘텐츠 실험',disagreements:'기준 없는 할인 제안 보류',questions:'실제 제품 가격 확인',tasks:[{role:'growth',instruction:'배포 설계 개선',reason:'콘텐츠와 측정 연결',acceptance:'배포 조건 명시'},{role:'content',instruction:'완성된 카피와 대본 개선',reason:'첫 장면 반론 반영',acceptance:'대조안과 한 변수 구분'}]});
 if(x.phase==='revision')return JSON.stringify({title:x.role+' 개선본',content:(x.role==='growth'?'## 배포 조건\n오픈 첫 주 할인 쿠폰을 배포합니다.\n\n':'')+'## 완성된 수정본\n첫 장면과 CTA를 구체화했습니다. 실적은 미측정입니다.\n첫 장면: 도넛 단면을 2초 안에 보여 주고 크림 양을 확대합니다. CTA: 평일 오후 매장 픽업 시간을 안내합니다.\n대조안: 기존 제품 전체 컷과 단면 컷을 같은 시간대에 게시하고 공유율과 저장률만 비교합니다.\n게시 문안 A: 오늘 오후, 크림이 가득 찬 단면부터 확인하세요. 게시 문안 B: 퇴근길 픽업으로 기다림 없이 받아 가세요.\n[자료 필요] 판매 가격과 픽업 가능 시간은 매장 담당자가 게시 전 확인합니다.',changes:'인사이트 담당의 반론과 총괄의 조건을 반영했습니다.'});
 return JSON.stringify({verdict:'revise',summary:'후속 측정 설계 필요',findings:'개선본은 작성됐으며 데이터 담당은 변경된 배포 조건에 맞춰 다시 설계해야 합니다.'});
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
const ctx=createContext({console,crypto:webcrypto,Response,Request,Headers,TextEncoder,TextDecoder,Uint8Array,Date,URL,AbortSignal,btoa,atob,fetch:fakeFetch,process:{env:{NODE_ENV:'production'}}});
const modules=new Map();const envModule=new SyntheticModule(['env'],function(){this.setExport('env',runtime)},{context:ctx});
function moduleFor(file){file=resolve(file);if(modules.has(file))return modules.get(file);const code=ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;const m=new SourceTextModule(code,{context:ctx,identifier:file});modules.set(file,m);return m}
async function load(file){const m=moduleFor(file);if(m.status==='unlinked')await m.link((spec,ref)=>{if(spec==='cloudflare:workers')return envModule;const f=spec.startsWith('@/')?resolve(spec.slice(2)):resolve(dirname(ref.identifier),spec);return moduleFor(f.endsWith('.ts')?f:f+'.ts')});return m}
const action=await load('app/api/action/route.ts');await action.evaluate();const workspace=await load('app/api/workspace/route.ts');await workspace.evaluate();const run=await load('app/api/run/route.ts');await run.evaluate();
let owner='qa-owner-with-a-production-length-authenticated-user-id';const passed=[];const check=(name,val)=>{assert.ok(val,name);passed.push(name)};
async function request(mod,method,b,override={}){const headers={'Content-Type':'application/json','oai-authenticated-user-id':owner,...override};for(const k in headers)if(headers[k]===null)delete headers[k];const r=await mod.namespace[method](new Request('https://agency.test/api/test',{method,headers,...(b?{body:JSON.stringify(b)}:{})}));return {status:r.status,data:await r.json()}}
const act=(name,b={})=>request(action,'POST',{action:name,...b});const snapshot=()=>request(workspace,'GET');

const meetings=await load('app/api/meetings/route.ts');await meetings.evaluate();
const server=await load('lib/server.ts');await server.evaluate();
const mp=(action,b={})=>request(meetings,'POST',{action,...b});
const listMeetings=async()=>{const res=await meetings.namespace.GET(new Request('https://agency.test/api/meetings?campaignId='+encodeURIComponent(cid),{headers:{'oai-authenticated-user-id':owner}}));return res.json()};const put=(kind,id,data,parent='')=>server.namespace.recordStatement(owner,kind,id,data,parent).run();
await snapshot();const c=(await snapshot()).data.campaigns[0],cid=c.id;
const args={id:'meeting-main',campaignId:cid,campaignVersion:1,agenda:'서로의 제안을 검토하고 콘텐츠를 개선'};
check('meeting requires a real configured connection',(await mp('start',args)).status===409);
await act('save_hermes',{endpoint:'https://hermes.example.com',key:'hermes-local-test-key-only'});
check('new meeting requires registered server worker',(await mp('start',{...args,id:'missing-worker'})).status===409);
await put('worker_credential','current',{id:'current',tokenHash:'fixture'});
for(const role of ['creative','content','growth','data','quality'])await put('artifact','old-'+role,{id:'old-'+role,campaignId:cid,campaignVersion:1,role,title:role,content:'original '+role,version:3,status:'approved',origin:'manual',createdAt:'old'},cid);
const past=new Date(Date.now()-60000).toISOString(),future=new Date(Date.now()+86400000).toISOString();
const fact=(id,extra)=>({id,brandId:c.brandId,key:id,value:id,status:'confirmed',source:'점주 확인',verifiedAt:past,validUntil:future,version:1,updatedAt:past,...extra});
await put('brand_fact','f-price',fact('f-price',{value:'도넛 1개 3,500원'}),c.brandId);await put('brand_fact','f-popular',fact('f-popular',{status:'rejected',value:'동네 판매 1위'}),c.brandId);
await put('campaign_directive','dir-main',{id:'dir-main',campaignId:cid,text:'인기·할인 표현은 확인 전 광고 문구에 쓰지 않습니다.',createdAt:past,createdBy:{id:owner,email:null}},cid);
check('anonymous meeting rejected',(await request(meetings,'POST',{action:'start',...args},{'oai-authenticated-user-id':null})).status===401);
check('cross-origin meeting rejected',(await request(meetings,'POST',{action:'start',...args},{origin:'https://other.test'})).status===403);
let r=await mp('start',args);check('eight actual roles and synthesis are prepared',r.status===200&&r.data.steps.length===9&&calls===0);
check('repeated start reuses meeting',(await mp('start',args)).data.id===args.id&&sql.prepare("SELECT count(*) n FROM jobs WHERE role='meeting'").get().n===1);
const eventActor=text=>JSON.parse(sql.prepare("SELECT data FROM records WHERE kind='event' AND data LIKE ? ORDER BY rowid DESC").get('%'+text+'%')?.data||'{}').actor;check('meeting start event records the requester',eventActor('팀 회의를 시작했습니다')?.id===owner);
check('owner cannot read another meeting',(await request(meetings,'POST',{action:'advance',id:args.id},{'oai-authenticated-user-id':'foreign'})).status===404);
check('active meeting blocks campaign edit',(await act('save_campaign',{id:cid,version:1,data:c})).status===409);
check('active meeting blocks campaign deletion',(await act('delete_campaign',{id:cid,version:1,confirmed:true})).status===409);
check('active meeting blocks normal role start',(await request(run,'POST',{action:'start',campaignId:cid,role:'cmo'})).status===409);
check('active meeting blocks connection removal',(await act('disconnect')).status===409);
const jid=sql.prepare("SELECT id FROM jobs WHERE role='meeting'").get().id;
check('normal run cannot consume meeting sentinel',(await request(run,'POST',{action:'poll',id:jid})).status===409);
await mp('advance',{id:args.id});check('first role creates one provider request',calls===1);
check('meeting input carries confirmed and prohibited ledger facts and standing directives',JSON.stringify(inputs[0].evidence.facts.confirmed).includes('도넛 1개 3,500원')&&JSON.stringify(inputs[0].evidence.facts.prohibited).includes('동네 판매 1위')&&inputs[0].evidence.directives.some(d=>d.text==='인기·할인 표현은 확인 전 광고 문구에 쓰지 않습니다.'));
check('meeting input cites original artifacts by ref labels',inputs[0].originalArtifacts.length>0&&inputs[0].originalArtifacts.every(a=>/ v\d+$/.test(a.ref)));
check('meeting input marks the brand introduction unverified',inputs[0].brand.brandIntro.verification==='unverified'&&inputs[0].brand.brandIntro.useInCopy===false&&!('description' in inputs[0].brand));
await mp('advance',{id:args.id});check('gap before second role still blocks mutation',(await act('delete_campaign',{id:cid,version:1,confirmed:true})).status===409);
await mp('advance',{id:args.id});check('next member actually receives prior member opinion',inputs[1].discussion.length===1&&inputs[1].discussion[0].role==='cmo');
check('model receives short discussion refs instead of internal step ids',inputs[1].allowedRespondsTo[0].ref==='D1'&&inputs[1].discussion[0].ref==='D1'&&!JSON.stringify([inputs[1].allowedRespondsTo,inputs[1].discussion]).includes(':discussion:'));
for(let i=0;i<30;i++){r=await mp('advance',{id:args.id});if(r.data.status==='completed'||r.data.status==='failed')break}
check('discussion assignment revisions and quality complete',r.data.status==='completed'&&r.data.steps.length===12&&calls===12);
check('short handle replies are stored as canonical discussion ids',r.data.steps[1].output.respondsTo[0]===args.id+':discussion:cmo'&&inputs[2].discussion[1].respondsTo[0]==='D1');
check('new meeting records practice version and incomplete rubric cannot pass',!!r.data.skillVersion&&r.data.steps.find(x=>x.phase==='quality').output.gateIssues.length>0);
check('assigned revisions use dependency order',inputs.filter(x=>x.phase==='revision').map(x=>x.role).join(',')==='content,growth');
check('later revision receives earlier improved draft',inputs.find(x=>x.phase==='revision'&&x.role==='growth').completedRevisions[0].role==='content');
const q=inputs.find(x=>x.phase==='quality');check('quality candidates carry ref labels',q.candidateArtifacts.every(a=>typeof a.ref==='string'&&a.ref.length>0)&&q.candidateArtifacts.some(a=>a.ref==='콘텐츠 스튜디오 개선본'));check('quality sees only current candidates and stale dependencies',q.candidateArtifacts.some(a=>a.role==='content'&&a.content.includes('수정본'))&&!q.candidateArtifacts.some(a=>a.role==='data')&&q.invalidatedRoles.includes('data'));
let data=(await snapshot()).data;
check('revisions update artifacts without self approval',data.artifacts.find(a=>a.role==='content').version===4&&data.artifacts.find(a=>a.role==='content').status==='review'&&data.campaigns[0].status==='revision');
check('dependent prior work is outdated and upstream preserved',data.artifacts.find(a=>a.role==='data').status==='outdated'&&data.artifacts.find(a=>a.role==='creative').status==='approved');
// 회의 개선본도 입력에 쓴 사실 스냅샷을 남기고, 거절 사실·근거 없는 광고 표현을 결정적으로 검사한다(DT5, AQ3).
const revisedContent=await server.namespace.readRecord(owner,'artifact',data.artifacts.find(a=>a.role==='content').id),revisedGrowth=await server.namespace.readRecord(owner,'artifact',data.artifacts.find(a=>a.role==='growth').id);
check('meeting revisions record the fact snapshot they used',JSON.stringify(revisedContent.factRefs)===JSON.stringify([{id:'f-popular',version:1,status:'rejected'},{id:'f-price',version:1,status:'confirmed'}])&&!revisedContent.factsChanged);
check('meeting revision with an unmarked discount claim is flagged',JSON.stringify(revisedGrowth.unverifiedClaims)===JSON.stringify(['할인'])&&!revisedContent.unverifiedClaims);
const factsServer=await load('lib/brand-facts-server.ts');await factsServer.evaluate();
await factsServer.namespace.saveBrandFact(owner,{data:{brandId:c.brandId,key:'hours',value:'평일 11시~21시',status:'confirmed',source:'점주 확인',verifiedAt:past,validUntil:future},confirmed:true},{id:owner,email:null,role:'owner'});
check('a later fact change marks meeting revisions',(await server.namespace.readRecord(owner,'artifact',revisedContent.id)).factsChanged===true);
const qualityNow=(await server.namespace.listRecords(owner,'artifact',cid)).find(a=>a.role==='quality'&&a.status!=='outdated');
await put('campaign_sequence',cid,{campaignId:cid,campaignVersion:1,status:'needs_review',startedAt:'2026-09-23T00:00:00.000Z',updatedAt:new Date().toISOString(),source:{id:qualityNow.id,version:qualityNow.version},fixes:[{role:'content',fix:'CTA의 할인 표현을 확인 전까지 삭제'},{role:null,fix:'측정 기준일을 첫 구매일로 정의'}]},cid);
let listed=await listMeetings();
check('agenda draft uses sequence fixes, latest quality review fixes and standing directives',listed.agendaDraft.agenda.includes('콘텐츠 스튜디오: CTA의 할인 표현을 확인 전까지 삭제')&&listed.agendaDraft.agenda.includes('인기·할인 표현은 확인 전 광고 문구에 쓰지 않습니다.')&&listed.agendaDraft.agenda.includes('공통: 측정 기준일을 첫 구매일로 정의')&&listed.agendaDraft.agenda.includes('변경에 맞춰 다시 작성할 후속 작업')&&listed.agendaDraft.reviewFixes>=2);
check('previous artifact contents remain in history',(await server.namespace.listRecords(owner,'history',cid)).some(a=>a.content==='original content'&&a.version===3));
const count=sql.prepare("SELECT count(*) n FROM records WHERE kind='history'").get().n;await mp('advance',{id:args.id});check('completion replay never duplicates output',calls===12&&sql.prepare("SELECT count(*) n FROM records WHERE kind='history'").get().n===count);
check('public response hides provider and input payloads',!JSON.stringify(r.data).includes('providerId')&&!r.data.snapshot&&!JSON.stringify(r.data).includes('raw'));
await mp('start',{...args,id:'follow-up',previousMeetingId:args.id});await mp('advance',{id:'follow-up'});check('follow-up uses prior decisions and quality feedback',inputs.at(-1).previousMeeting.id===args.id&&inputs.at(-1).previousMeeting.quality.verdict==='revise');
await mp('cancel',{id:'follow-up'});const cancelCalls=calls;r=await mp('advance',{id:'follow-up'});check('cancel prevents any subsequent role',r.data.status==='cancelled'&&calls===cancelCalls);
providerStatus='completed';await mp('start',{...args,id:'lost-ack'});loseAck=true;r=await mp('advance',{id:'lost-ack'});check('lost acknowledgement becomes uncertain',r.data.status==='uncertain');
const before=calls;denyRecovery=true;r=await mp('recover',{id:'lost-ack'});check('auth rejection during recovery retains execution lock',r.data.status==='uncertain'&&(await act('disconnect')).status===409);
denyRecovery=false;providerStatus='running';r=await mp('recover',{id:'lost-ack'});check('recovery reuses original provider operation',r.data.status==='running'&&calls===before);
const stored=await server.namespace.readRecord(owner,'team_meeting','lost-ack');stored.status='uncertain';stored.steps[0].status='uncertain';await put('team_meeting',stored.id,stored,cid);r=await mp('recover',{id:'lost-ack'});check('known provider status recovers uncertain state',r.data.status==='running'&&r.data.steps[0].status==='running');
await mp('cancel',{id:'lost-ack'});providerStatus='completed';
await mp('start',{...args,id:'malformed'});await mp('advance',{id:'malformed'});badOutput=true;r=await mp('advance',{id:'malformed'});badOutput=false;check('malformed provider output stops without fabricated minutes',r.data.status==='failed'&&!r.data.steps[0].output);
await mp('start',{...args,id:'repair-fifth'});
for(let i=0;i<8;i++)await mp('advance',{id:'repair-fifth'});
const beforeFifth=await server.namespace.readRecord(owner,'team_meeting','repair-fifth');
const completedFour=JSON.stringify(beforeFifth.steps.slice(0,4));
await mp('advance',{id:'repair-fifth'});badOutput=true;r=await mp('advance',{id:'repair-fifth'});badOutput=false;
const retry={id:'repair-fifth',stepId:r.data.steps[4].id,expectedAttempt:0};
check('fifth malformed result preserves first four completed steps',r.data.status==='failed'&&r.data.steps.filter(s=>s.status==='completed').length===4);
const failedFifth=await server.namespace.readRecord(owner,'team_meeting','repair-fifth');
const initialCalls=calls;
await mp('advance',{id:'repair-fifth'});check('failed meeting does not auto spend retry budget',calls===initialCalls);
const currentCampaign=await server.namespace.readRecord(owner,'campaign',cid);
await put('campaign',cid,{...currentCampaign,version:2});
check('retry rejects changed campaign version',(await mp('retry_failed',retry)).status===409);
listed=await listMeetings();const staleFifth=listed.meetings.find(x=>x.id==='repair-fifth');
check('changed basis marks failed meeting stale without retry',staleFifth.stale===true&&staleFifth.steps[4].retryAvailable===false);
await put('campaign',cid,currentCampaign);
listed=await listMeetings();const freshFifth=listed.meetings.find(x=>x.id==='repair-fifth');
check('unchanged basis keeps failed step retry available',freshFifth.stale===false&&freshFifth.steps[4].retryAvailable===true);
const oldArtifact=await server.namespace.readRecord(owner,'artifact','old-creative');
await put('artifact',oldArtifact.id,{...oldArtifact,version:oldArtifact.version+1},cid);
check('retry rejects changed artifact snapshot',(await mp('retry_failed',retry)).status===409);
await put('artifact',oldArtifact.id,oldArtifact,cid);
await put('campaign_directive','dir-late',{id:'dir-late',campaignId:cid,text:'오픈 혜택 표현은 쓰지 않습니다.',createdAt:new Date().toISOString(),createdBy:{id:owner,email:null}},cid);
check('retry rejects changed standing directives',(await mp('retry_failed',retry)).status===409&&(await listMeetings()).meetings.find(x=>x.id==='repair-fifth').stale===true);
sql.prepare('DELETE FROM records WHERE id=?').run(owner+':campaign_directive:dir-late');
await put('brand_fact','f-late',fact('f-late',{status:'rejected',value:'장작 화덕'}),c.brandId);
check('retry rejects changed fact ledger',(await mp('retry_failed',retry)).status===409);
sql.prepare('DELETE FROM records WHERE id=?').run(owner+':brand_fact:f-late');
// 브랜드 수정은 캠페인 version을 올리지 않으므로 회의 기준 자료에 브랜드를 따로 비교한다(meeting-stale-ignores-brand-edit).
const brandBefore=await server.namespace.readRecord(owner,'brand',c.brandId);await put('brand',c.brandId,{...brandBefore,description:'화덕 표현은 확인 전 금지'});
check('brand edit marks failed meeting stale and blocks retry',(await mp('retry_failed',retry)).status===409&&(await listMeetings()).meetings.find(x=>x.id==='repair-fifth').stale===true);
await put('brand',c.brandId,brandBefore);
await put('brief_draft','retry-conflict',{id:'retry-conflict',campaignId:cid,status:'queued'});
check('retry rejects active campaign draft',(await mp('retry_failed',retry)).status===409);
await put('brief_draft','retry-conflict',{id:'retry-conflict',campaignId:cid,status:'cancelled'});
await mp('start',{...args,id:'retry-busy'});
check('retry rejects another active campaign job',(await mp('retry_failed',retry)).status===409);
await mp('cancel',{id:'retry-busy'});
sql.prepare("DELETE FROM records WHERE owner=? AND kind='worker_credential'").run(owner);
check('retry requires registered worker',(await mp('retry_failed',retry)).status===409);
await put('worker_credential','current',{id:'current',tokenHash:'fixture'});
check('retry rejects wrong step identity',(await mp('retry_failed',{...retry,stepId:'unrelated'})).status===409);
r=await mp('retry_failed',retry);
check('explicit retry queues only failed fifth step',r.status===200&&r.data.status==='running'&&r.data.steps[4].status==='pending'&&calls===initialCalls);
const retried=await server.namespace.readRecord(owner,'team_meeting','repair-fifth');
check('completed step identities output and tokens remain unchanged',JSON.stringify(retried.steps.slice(0,4))===completedFour);
check('failed raw provider and tokens retained in internal history',retried.steps[4].attempts[0].raw==='invalid JSON'&&retried.steps[4].attempts[0].providerId===failedFifth.steps[4].providerId&&retried.steps[4].attempts[0].tokens===50);
check('public retry diagnostics never expose raw provider or snapshot',!JSON.stringify(r.data).includes('invalid JSON')&&!JSON.stringify(r.data).includes('providerId')&&!r.data.snapshot&&r.data.steps[4].attempts[0].tokens===50);
await mp('retry_failed',retry);
loseAck=true;r=await mp('advance',{id:'repair-fifth'});
check('new retry submission can become uncertain without redoing prior stages',r.data.status==='uncertain'&&calls===initialCalls+1&&inputs.at(-1).discussion.length===4);
check('correction request includes safe validation error and allowed IDs',inputs.at(-1).correction.error&&inputs.at(-1).allowedRespondsTo.length===4);
r=await mp('recover',{id:'repair-fifth'});
check('uncertain retry recovery reuses same attempt submission',r.data.status==='running'&&calls===initialCalls+1);
badOutput=true;r=await mp('advance',{id:'repair-fifth'});badOutput=false;
check('stale duplicate retry does not retry a later failed attempt',(await mp('retry_failed',retry)).status===409);
r=await mp('retry_failed',{...retry,expectedAttempt:1});await mp('advance',{id:'repair-fifth'});
badOutput=true;r=await mp('advance',{id:'repair-fifth'});badOutput=false;
check('two user retries are the per-step limit',(await mp('retry_failed',{...retry,expectedAttempt:2})).status===409);
check('all failed attempt usage retained in sentinel job',sql.prepare('SELECT tokens FROM jobs WHERE id=?').get(owner+':meeting:repair-fifth').tokens===350);
await mp('start',{...args,id:'failed-followup',previousMeetingId:'repair-fifth'});await mp('advance',{id:'failed-followup'});
check('follow-up includes completed discussion and failure context',inputs.at(-1).previousMeeting.discussion.length===4&&inputs.at(-1).previousMeeting.failure.role==='content');
await mp('cancel',{id:'failed-followup'});providerStatus='completed';
check('cancelled meeting cannot be retried',(await mp('retry_failed',{id:'failed-followup',stepId:'failed-followup:discussion:cmo',expectedAttempt:0})).status===409);
check('completed meeting cannot be retried',(await mp('retry_failed',{id:args.id,stepId:args.id+':discussion:cmo',expectedAttempt:0})).status===409);
// Existing stored failures without new failureKind must remain repairable only when raw output fails parsing.
const legacy=await server.namespace.readRecord(owner,'team_meeting','malformed');delete legacy.steps[0].failureKind;await put('team_meeting',legacy.id,legacy,cid);
r=await mp('retry_failed',{id:'malformed',stepId:'malformed:discussion:cmo',expectedAttempt:0});
check('legacy invalid raw output is safely repairable',r.status===200&&r.data.status==='running');
await mp('advance',{id:'malformed'});r=await mp('advance',{id:'malformed'});
check('valid corrected response completes the failed step',r.data.steps[0].status==='completed'&&r.data.steps[0].attempts.length===1);
await mp('cancel',{id:'malformed'});
await mp('start',{...args,id:'pending-cancel'});const cc=calls;check('pending cancellation submits no new provider request',(await mp('cancel',{id:'pending-cancel'})).data.status==='cancelled'&&calls===cc);
// 예전 파서로 실패했지만 저장된 응답이 지금은 유효하면 모델을 다시 부르지 않고 그 응답으로 단계를 완료한다(legacy-failed-meeting-no-retry).
await mp('start',{...args,id:'stored-repair'});
const storedMeeting=await server.namespace.readRecord(owner,'team_meeting','stored-repair');
storedMeeting.status='failed';storedMeeting.error='respondsTo ID 불일치';storedMeeting.steps[0]={...storedMeeting.steps[0],status:'failed',failureKind:'invalid_output',providerId:'old-provider',error:'respondsTo ID 불일치',raw:JSON.stringify({position:'첫 방문 고객은 제품 단면을 먼저 확인합니다.',evidence:'브리프만 사용했고 고객 반응은 미측정입니다.',challenge:'가격 근거가 없어 할인 제안은 보류합니다.',proposal:'단면 컷과 전체 컷을 2주간 공유율로 비교합니다.',respondsTo:[]})};
await put('team_meeting','stored-repair',storedMeeting,cid);sql.prepare("UPDATE jobs SET status='failed' WHERE id=?").run(owner+':meeting:stored-repair');
listed=await listMeetings();check('a failed step with a now-valid stored response offers a stored-response repair',listed.meetings.find(x=>x.id==='stored-repair').steps[0].storedRepair===true);
const storedCalls=calls;r=await mp('retry_failed',{id:'stored-repair',stepId:'stored-repair:discussion:cmo',expectedAttempt:0});
check('stored-response repair completes the step without a model call',r.status===200&&r.data.status==='running'&&r.data.steps[0].status==='completed'&&r.data.steps[0].output.position.startsWith('첫 방문')&&calls===storedCalls&&r.data.steps[1].status==='pending');
await mp('cancel',{id:'stored-repair'});

const brief=await load('app/api/brief/route.ts');await brief.evaluate();
await mp('start',{...args,id:'brief-conflict'});
check('meeting blocks draft generation for same campaign',(await request(brief,'POST',{action:'start',id:'blocked-brief',campaignId:cid,campaignVersion:1,data:c})).status===409);
await mp('cancel',{id:'brief-conflict'});
await put('brief_draft','active-edit',{id:'active-edit',campaignId:cid,status:'queued'});
check('active campaign draft blocks meeting start',(await mp('start',{...args,id:'reverse-conflict'})).status===409);
await put('brief_draft','active-edit',{id:'active-edit',campaignId:cid,status:'cancelled'});
await mp('start',{...args,id:'atomic-final'});
for(let i=0;i<28;i++){r=await mp('advance',{id:'atomic-final'});const step=r.data.steps.find(s=>s.status!=='completed');if(step?.phase==='quality'&&step.status==='running')break}
const beforeArtifacts=JSON.stringify(await server.namespace.listRecords(owner,'artifact',cid));
const originalBatch=DB.batch;DB.batch=async ss=>{if(ss.some(s=>s.values?.[2]==='artifact'))throw new Error('injected final storage failure');return originalBatch(ss)};
check('final storage failure remains retryable',(await mp('advance',{id:'atomic-final'})).status===500);
check('failed final write preserves all existing artifacts',JSON.stringify(await server.namespace.listRecords(owner,'artifact',cid))===beforeArtifacts);
DB.batch=originalBatch;r=await mp('advance',{id:'atomic-final'});check('retry commits completed meeting exactly once',r.data.status==='completed');
listed=await listMeetings();check('sequence fixes from a replaced quality review are no longer proposed',!listed.agendaDraft.agenda.includes('CTA의 할인 표현을 확인 전까지 삭제')&&!listed.agendaDraft.agenda.includes('측정 기준일을 첫 구매일로 정의'));
await mp('start',{...args,id:'stale-final'});
for(let i=0;i<28;i++){r=await mp('advance',{id:'stale-final'});const step=r.data.steps.find(s=>s.status!=='completed');if(step?.phase==='quality'&&step.status==='running')break}
const nowCampaign=await server.namespace.readRecord(owner,'campaign',cid);await put('campaign',cid,{...nowCampaign,version:2});
r=await mp('advance',{id:'stale-final'});check('stale meeting cannot replace newer campaign artifacts',r.data.status==='failed'&&r.data.error.includes('기준 자료'));
await put('campaign',cid,nowCampaign);

const originalOwner=owner;owner='second-owner';await snapshot();await act('save_hermes',{endpoint:'https://hermes.example.com',key:'hermes-local-test-key-only'});await put('worker_credential','current',{id:'current',tokenHash:'fixture'});check('same client meeting id is isolated per owner',(await mp('start',args)).status===200);await mp('cancel',{id:args.id});owner=originalOwner;
check('completed meetings can be deleted with campaign',(await act('delete_campaign',{id:cid,version:1,confirmed:true})).status===200);
check('deletion removes meeting context and step submissions',sql.prepare("SELECT count(*) n FROM records WHERE owner=? AND kind IN ('team_meeting','hermes_submission') AND parent_id=?").get(owner,cid).n===0);
console.log(JSON.stringify({passed:passed.length,checks:passed},null,2));
