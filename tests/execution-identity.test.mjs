// 실행 신원(F2a): 사용량 원장 조인 키(5개 HERMES 경로 + OpenAI 역할), 보고 모델 변경 경보, 사용량 화면 응답, 소유자 전용 내보내기, kind 등록.
// 근거: mocked(모의 HERMES·OpenAI fetch 스텁, 메모리 SQLite, 로컬 인증 헤더·세션 주입, 합성 데이터). 외부 네트워크 호출은 0회다.
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {SourceTextModule,SyntheticModule,createContext} from 'node:vm';
import {readFileSync,readdirSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {webcrypto,createHash} from 'node:crypto';
import ts from 'typescript';
import {roleFixture} from './helpers/role-fixture.mjs';

// 게시 빌드가 주입하는 소스 트리 해시를 흉내 낸다(lib/app-version.ts). 합성 값이다.
const TREE='0123456789abcdef0123456789abcdef01234567';
const HERMES='https://hermes.example.com',OPENAI='https://api.openai.com/v1/';
const sha=value=>createHash('sha256').update(value).digest('hex');
const mode={model:'reported-model-a',usage:{input_tokens:1200,output_tokens:800,total_tokens:2000}};
const sent=new Map(),external=[],queries=[];let seq=0;

// 쿼리 기록이 있는 메모리 D1. provider_usage 전체 조회가 없는지 보려고 실행한 SQL을 남긴다.
const sql=new DatabaseSync(':memory:');
for(const f of readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())sql.exec(readFileSync('drizzle/'+f,'utf8'));
class Statement{
 constructor(query,values=[]){this.query=query;this.values=values}
 bind(...values){return new Statement(this.query,values)}
 async first(){queries.push({op:'first',query:this.query,values:this.values});return sql.prepare(this.query).get(...this.values)||null}
 async all(){queries.push({op:'all',query:this.query,values:this.values});return {results:sql.prepare(this.query).all(...this.values)}}
 async run(){queries.push({op:'run',query:this.query,values:this.values});return {meta:{changes:Number(sql.prepare(this.query).run(...this.values).changes)}}}
}
const DB={prepare:q=>new Statement(q),batch:async statements=>{sql.exec('BEGIN');try{const out=[];for(const s of statements)out.push(await s.run());sql.exec('COMMIT');return out}catch(e){sql.exec('ROLLBACK');throw e}}};
const env={DB,AUTH_MODE:'legacy',AGENCY_ENCRYPTION_KEY:Buffer.alloc(32,8).toString('base64')};
async function fetchStub(url,options={}){
 url=String(url);const method=options.method||'GET';
 if(url===OPENAI+'responses'&&method==='POST'){const id='resp_'+ ++seq;sent.set(id,options.body);return Response.json({id,status:'queued',model:'openai-model-x'})}
 if(url.startsWith(OPENAI+'responses/')){const id=decodeURIComponent(url.slice((OPENAI+'responses/').length));const input=JSON.parse(sent.get(id)).input;return Response.json({id,status:'completed',model:'openai-model-x',usage:mode.usage,output:[{content:[{type:'output_text',text:roleFixture(input)}]}]})}
 if(!url.startsWith(HERMES+'/')){external.push(url);throw new Error('모의 주소만 호출합니다: '+url)}
 const path=url.slice(HERMES.length);
 if(path==='/v1/runs'&&method==='POST'){const id='run_'+ ++seq;sent.set(id,options.body);return Response.json({run_id:id})}
 const stop=/^\/v1\/runs\/([\w-]+)\/stop$/.exec(path);if(stop)return Response.json({object:'hermes.run',run_id:stop[1],status:'cancelled',model:mode.model,usage:mode.usage});
 const id=/^\/v1\/runs\/([\w-]+)$/.exec(path)?.[1];if(!id||!sent.has(id))return new Response('{}',{status:404});
 return Response.json({object:'hermes.run',run_id:id,status:'completed',output:roleFixture(JSON.parse(sent.get(id)).input),usage:mode.usage,model:mode.model});
}
const context=createContext({console,crypto:webcrypto,Response,Request,Headers,ReadableStream,TextEncoder,TextDecoder,Uint8Array,Date,URL,AbortSignal,DecompressionStream,btoa,atob,fetch:fetchStub,process:{env:{NODE_ENV:'production'}},__COLLECTIVE_SOURCE_TREE__:TREE});
const modules=new Map();
const envModule=new SyntheticModule(['env'],function(){this.setExport('env',env)},{context});
const nextModule=new SyntheticModule(['after'],function(){this.setExport('after',()=>{})},{context});
function moduleFor(file){file=resolve(file);if(modules.has(file))return modules.get(file);const m=new SourceTextModule(ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText,{context,identifier:file});modules.set(file,m);return m}
async function load(file){const m=moduleFor(file);if(m.status==='unlinked')await m.link((spec,ref)=>{if(spec==='cloudflare:workers')return envModule;if(spec==='next/server')return nextModule;const p=spec.startsWith('@/')?resolve(spec.slice(2)):resolve(dirname(ref.identifier),spec);return moduleFor(p.endsWith('.ts')?p:p+'.ts')});if(m.status!=='evaluated')await m.evaluate();return m.namespace}

const server=await load('lib/server.ts'),ledger=await load('lib/usage-ledger.ts'),summary=await load('lib/usage-summary.ts'),hermes=await load('lib/hermes.ts'),practice=await load('lib/practice.ts');
const roleExec=await load('lib/role-execution.ts'),meetingExec=await load('lib/meeting-execution.ts'),briefExec=await load('lib/brief-execution.ts'),researchExec=await load('lib/research-execution.ts'),learningExec=await load('lib/learning-execution.ts');
const alarm=await load('lib/usage-model-alarm.ts'),usageRoute=await load('app/api/usage/route.ts'),exportRoute=await load('app/api/usage/export/route.ts'),registry=await load('lib/record-kinds.ts');
const passed=[];const check=(name,value)=>{assert.ok(value,name);passed.push(name)};
const plain=v=>JSON.parse(JSON.stringify(v));
const owner='id-owner',now=new Date().toISOString();
const put=(kind,id,data,parent='',who=owner)=>server.recordStatement(who,kind,id,data,parent).run();
const usageRow=(runId,who=owner)=>{const row=sql.prepare("SELECT data FROM records WHERE owner=? AND kind='provider_usage' AND json_extract(data,'$.providerRunId')=?").get(who,runId);return row&&JSON.parse(row.data)};
const usageCount=(runId,who=owner)=>sql.prepare("SELECT COUNT(*) n FROM records WHERE owner=? AND kind='provider_usage' AND json_extract(data,'$.providerRunId')=?").get(who,runId).n;
const submissionOf=(id,kind='hermes_submission')=>JSON.parse(sql.prepare('SELECT data FROM records WHERE id=?').get(`${owner}:${kind}:${id}`).data);
const expectedPrompt=(id,skill,kind='hermes_submission')=>`${skill}:${sha(JSON.parse(submissionOf(id,kind).body).instructions).slice(0,12)}`;
const settings=async secret=>sql.prepare('INSERT INTO settings(owner,secret,model,updated_at) VALUES(?,?,?,?) ON CONFLICT(owner) DO UPDATE SET secret=excluded.secret').run(owner,await server.encrypt(secret),'HERMES',now);
await settings(JSON.stringify({provider:'hermes',endpoint:HERMES,key:'mock-only'}));

// 합성 브랜드·지점·캠페인·지시(작성자 이메일 포함). 실제 고객·매장 정보가 아니다.
const brand={id:'id-brand',name:'가상분식',short:'GB',category:'SNACK BAR',color:'#224466',bg:'#eef2f6',description:'합성 소개(미확인).',audience:'가상동 주민(가설)',tone:'명료한',constraints:'가격은 확인 전 확정하지 않는다.',knowledge:'합성 메모.'};
const store={id:'id-store',brandId:brand.id,name:'가상점',address:'가상동 12',tradeArea:'residential',customer:'',goal:'',daypart:'',menu:'',hours:'',access:'',capacity:'',economics:'',competitors:'',status:'active',version:1,createdAt:now,updatedAt:now};
const campaign={id:'id-campaign',brandId:brand.id,title:'가상분식 오픈',goal:'오픈 전 인지와 첫 포장 주문을 만든다.',audience:'가상동 주민(가설)',channels:'Instagram',stores:'가상동 12',products:'떡볶이(가격 미확정)',budget:null,startDate:'',endDate:'',constraints:'할인 약속 금지.',sources:'',status:'draft',version:1,createdAt:now,updatedAt:now};
await put('brand',brand.id,brand);await put('store',store.id,store,brand.id);await put('campaign',campaign.id,campaign);
await put('campaign_directive','directive-1',{id:'directive-1',campaignId:campaign.id,text:'합성 지시: 날짜는 D-day 상대 일정으로 쓴다.',createdAt:now,createdBy:{id:'synthetic-member',email:'private-person@example.com',role:'member'}},campaign.id);
await put('worker_credential','current',{hash:'synthetic-hash',createdAt:now});

// B-1) 역할(HERMES): start → poll. 첫 기록에 조인 키가 모두 채워진다.
let res=await (await roleExec.executeRole(owner,{action:'start',campaignId:campaign.id,role:'cmo'})).json();
const roleJob=res.id,roleRun=sql.prepare('SELECT provider_id FROM jobs WHERE id=?').get(roleJob).provider_id;
res=await (await roleExec.executeRole(owner,{action:'poll',id:roleJob})).json();
const role=usageRow(roleRun);
check('role run completes',res.status==='completed');
check('role usage carries job campaign brand kind and role',role.jobId===roleJob&&role.campaignId===campaign.id&&role.campaignVersion===1&&role.brandId===brand.id&&role.kind==='role'&&role.role==='cmo');
check('role usage has no store when the campaign has none (null, not empty or zero)',role.storeId===null);
check('role promptVersion is the skill version plus the instruction hash',role.promptVersion===expectedPrompt(roleJob,practice.PRACTICE_VERSION));
check('role output contract version and app tree are recorded',role.outputContractVersion==='role-output-v1'&&role.appTree===TREE);
check('role duration is measured from submission to terminal observation',Number.isInteger(role.durationMs)&&role.durationMs>=0);
check('role usage points at the artifact it produced',role.artifactId==='ai-'+sha(roleJob).slice(0,32)&&!!sql.prepare('SELECT id FROM records WHERE id=?').get(`${owner}:artifact:${role.artifactId}`));
check('stored HERMES submission is unchanged in shape (key and body only)',JSON.stringify(Object.keys(submissionOf(roleJob)).sort())==='["body","key"]');

// B-2) 같은 providerRunId를 다른 맥락으로 여러 번 조회해도 1건이고 첫 기록의 조인 키가 그대로다.
const cfg={provider:'hermes',endpoint:HERMES,key:'mock-only',model:'HERMES'};
await hermes.pollHermes(cfg,roleRun,false,30000,owner,{kind:'brief',submissionId:'nope',jobId:'other-job',campaignId:'other'});
await hermes.pollHermes(cfg,roleRun,false,30000,owner);
check('repeat polls keep one ledger row',usageCount(roleRun)===1);
check('repeat polls never rewrite the first join keys',plain(usageRow(roleRun)).jobId===roleJob&&usageRow(roleRun).kind==='role'&&usageRow(roleRun).promptVersion===role.promptVersion);

// B-2b) 실행 중 브리프가 바뀌어도(지점 변경·브리프 v2) 역할 조인 키는 제출 때 저장한 브랜드·지점을 쓴다. 검토 재현을 위해 가드를 우회해 캠페인을 직접 바꾼다.
const storeCampaign={...campaign,id:'id-store-campaign',storeId:store.id,title:'가상점 캠페인'};
await put('campaign',storeCampaign.id,storeCampaign);
res=await (await roleExec.executeRole(owner,{action:'start',campaignId:storeCampaign.id,role:'cmo'})).json();
const storeJob=res.id,storeRun=sql.prepare('SELECT provider_id FROM jobs WHERE id=?').get(storeJob).provider_id;
check('role contract keeps the brand and store used at submission',JSON.stringify((await server.readRecord(owner,'role_output_contract',storeJob)).usageScope)===JSON.stringify({brandId:brand.id,storeId:store.id}));
await put('campaign',storeCampaign.id,{...storeCampaign,storeId:'id-store-b',version:2});
await roleExec.executeRole(owner,{action:'poll',id:storeJob});
const storeUsage=usageRow(storeRun);
check('a brief changed mid-run does not mix versions in role join keys',storeUsage.campaignVersion===1&&storeUsage.storeId===store.id&&storeUsage.brandId===brand.id);

// B-3) 팀 회의: start → advance(제출) → advance(조회).
res=await (await meetingExec.executeMeeting(owner,{action:'start',id:'id-meeting',campaignId:campaign.id,campaignVersion:1,agenda:'합성 안건'})).json();
await meetingExec.executeMeeting(owner,{action:'advance',id:'id-meeting'});
const meetingStep=(await server.readRecord(owner,'team_meeting','id-meeting')).steps[0];
await meetingExec.executeMeeting(owner,{action:'advance',id:'id-meeting'});
const meeting=usageRow(meetingStep.providerId);
check('meeting usage carries meeting job and campaign keys',meeting.kind==='meeting'&&meeting.jobId===`${owner}:meeting:id-meeting`&&meeting.campaignId===campaign.id&&meeting.campaignVersion===1&&meeting.brandId===brand.id&&meeting.role===meetingStep.role);
check('meeting promptVersion uses the meeting skill version',meeting.promptVersion===expectedPrompt(meetingStep.id,practice.PRACTICE_VERSION));
check('meeting unknown contract version is null',meeting.outputContractVersion===null&&meeting.storeId===null&&meeting.appTree===TREE&&Number.isInteger(meeting.durationMs));

// B-4) 브리프 초안: 지점과 캠페인이 있는 초안.
res=await (await briefExec.executeBrief(owner,{action:'start',id:'id-brief',campaignId:campaign.id,campaignVersion:1,data:{brandId:brand.id,storeId:store.id,title:'합성 초안',goal:'합성 목표'}})).json();
check('brief draft was submitted',res.status==='queued');
await briefExec.executeBrief(owner,{action:'poll',id:'id-brief'});
const briefRun=JSON.parse(sql.prepare("SELECT data FROM records WHERE kind='brief_draft'").get().data).providerId,brief=usageRow(briefRun);
check('brief usage carries draft brand store and campaign',brief.kind==='brief'&&brief.jobId==='id-brief'&&brief.brandId===brand.id&&brief.storeId===store.id&&brief.campaignId===campaign.id&&brief.campaignVersion===1&&brief.role===null);
check('inline brief instructions get an inline prompt version',brief.promptVersion===expectedPrompt('brief-id-brief','inline'));

// B-5) 브랜드 조사: start → advance(제출) → advance(조회). 조사는 캠페인에 속하지 않는다.
await researchExec.executeResearch(owner,{action:'start',id:'id-research',brandId:brand.id});
await researchExec.executeResearch(owner,{action:'advance',id:'id-research'});
const researchStep=(await server.readRecord(owner,'brand_research','id-research')).steps[0];
await researchExec.executeResearch(owner,{action:'advance',id:'id-research'});
const research=usageRow(researchStep.providerId);
check('research usage carries brand job and stage',research.kind==='research'&&research.jobId===`${owner}:brand-research:id-research`&&research.brandId===brand.id&&research.role===researchStep.stage);
check('research has no campaign (null)',research.campaignId===null&&research.campaignVersion===null);
check('research output contract is the research protocol',research.outputContractVersion==='brand-onboarding-2'&&research.promptVersion===expectedPrompt(researchStep.id,'inline'));

// B-6) 바이럴 학습: 조사(discovery)와 실험 규칙 초안(guidance). 규칙 초안은 실험의 캠페인을 찾아 붙인다.
res=await (await learningExec.executeLearning(owner,{action:'start_discovery',brandId:brand.id,query:'합성 주제'})).json();
const discoveryJob=res.id;await learningExec.executeLearning(owner,{action:'poll',id:discoveryJob});
const discovery=usageRow(sql.prepare('SELECT provider_id FROM jobs WHERE id=?').get(discoveryJob).provider_id);
check('learning usage carries brand job and task role',discovery.kind==='learning'&&discovery.jobId===discoveryJob&&discovery.brandId===brand.id&&discovery.role==='viral_discovery'&&discovery.campaignId===null);
await put('viral_experiment','id-experiment',{id:'id-experiment',brandId:brand.id,campaignId:campaign.id,caseId:'c',analysisId:'a',title:'합성 실험',channel:'Instagram',hypothesis:'가설',variable:'첫 장면',control:'대조',treatment:'실험',metric:'share_rate',minSample:100,minHours:24,minLift:10,conditions:'조건',version:1,status:'evaluated',startedAt:now,createdAt:now,updatedAt:now,result:null,assessment:{status:'promising',label:'관찰상 개선',controlRate:0.01,treatmentRate:0.02,lift:100,reasons:[]}},campaign.id);
res=await (await learningExec.executeLearning(owner,{action:'start_guidance',experimentId:'id-experiment',version:1})).json();
const guidanceJob=res.id;await learningExec.executeLearning(owner,{action:'poll',id:guidanceJob});
const guidance=usageRow(sql.prepare('SELECT provider_id FROM jobs WHERE id=?').get(guidanceJob).provider_id);
check('guidance usage is joined to the experiment campaign',guidance.kind==='learning'&&guidance.role==='viral_guidance'&&guidance.campaignId===campaign.id&&guidance.brandId===brand.id);

// B-7) OpenAI 역할 경로: 제출 응답(queued)은 원장에 넣지 않고, 종료 조회 때 openai_submission 지시 해시로 채운다.
await put('campaign','id-openai',{...campaign,id:'id-openai'});
await settings('mock-openai-key');
res=await (await roleExec.executeRole(owner,{action:'start',campaignId:'id-openai',role:'cmo'})).json();
const openaiJob=res.id,openaiRun=sql.prepare('SELECT provider_id FROM jobs WHERE id=?').get(openaiJob).provider_id;
check('queued OpenAI acknowledgement is not a ledger row',usageCount(openaiRun)===0);
await roleExec.executeRole(owner,{action:'poll',id:openaiJob});
const openai=usageRow(openaiRun);
check('OpenAI role usage carries the same join keys',openai.provider==='openai'&&openai.kind==='role'&&openai.jobId===openaiJob&&openai.campaignId==='id-openai'&&openai.role==='cmo'&&openai.outputContractVersion==='role-output-v1');
check('OpenAI promptVersion hashes the stored OpenAI instructions',openai.promptVersion===expectedPrompt(openaiJob,practice.PRACTICE_VERSION,'openai_submission'));
await settings(JSON.stringify({provider:'hermes',endpoint:HERMES,key:'mock-only'}));

// B-8) 맥락이 없는 기록과 제출 원문이 없는 기록: 모르는 값은 0이 아니라 null이다.
const bare=await ledger.recordProviderUsage(owner,'hermes','run_bare',{status:'completed',model:'reported-model-a',usage:{total_tokens:5}});
check('usage without context has null join keys except the app tree',['jobId','campaignId','brandId','storeId','kind','role','promptVersion','outputContractVersion','durationMs'].every(k=>bare[k]===null)&&bare.appTree===TREE);
const missing=await ledger.recordProviderUsage(owner,'hermes','run_missing_submission',{status:'failed',usage:{}},{kind:'role',submissionId:'no-such-submission',jobId:'j',role:'cmo'});
check('missing submission leaves prompt version and duration null',missing.promptVersion===null&&missing.durationMs===null&&missing.jobId==='j'&&missing.campaignId===null);

// C) 보고 모델 변경 경보: 공급자별 상태 1건과 비교해 바뀔 때만 1건, 같은 값 반복은 0건, 별칭은 '실제 모델 미확인'.
// HERMES 5개 경로는 같은 연결을 쓰므로 기반 모델 1회 변경은 실행 종류 수와 무관하게 1건이다(수용 기준 C: A에서 B로 1건).
const changes=()=>sql.prepare("SELECT data FROM records WHERE owner=? AND kind='model_change' ORDER BY updated_at,rowid").all(owner).map(r=>JSON.parse(r.data));
const hermesChanges=()=>changes().filter(c=>c.provider==='hermes');
const modelState=()=>JSON.parse(sql.prepare("SELECT data FROM records WHERE owner=? AND kind='usage_model_state'").get(owner).data);
// 합성 제출 원문. 저장 시각(updated_at)만 경보 순서 판정에 쓴다. at(n)은 테스트 시작 n초 뒤다(B 단계 실제 제출보다 늦다).
const at=s=>new Date(Date.parse(now)+s*1000).toISOString();
const submitted=(id,time)=>{sql.prepare('INSERT INTO records(id,owner,kind,parent_id,data,updated_at) VALUES(?,?,?,?,?,?)').run(`${owner}:hermes_submission:${id}`,owner,'hermes_submission','',JSON.stringify({key:'synthetic',body:'{}'}),time);return id};
const observe=async(runId,model,kind='role',time=null)=>{queries.length=0;await ledger.recordProviderUsage(owner,'hermes',runId,{status:'completed',model,usage:{total_tokens:1}},{kind,submissionId:time?submitted('sub-'+runId,time):'none'});return [...queries]};
check('first reports only set the baseline',changes().length===0&&!!sql.prepare("SELECT id FROM records WHERE owner=? AND kind='usage_model_state'").get(owner));
check('model state is a single record',sql.prepare("SELECT COUNT(*) n FROM records WHERE owner=? AND kind='usage_model_state'").get(owner).n===1);
check('all five HERMES kinds share one provider baseline',JSON.stringify(Object.keys(modelState().providers).sort())==='["hermes","openai"]'&&modelState().providers.hermes.actual==='reported-model-a');
let q=await observe('run_same','reported-model-a','role',at(60));
check('same reported model again creates no change',hermesChanges().length===0);
check('alarm reads one state row and never lists provider usage',q.filter(x=>x.op==='all'&&/provider_usage/.test(x.query+x.values.join(' '))).length===0&&q.filter(x=>/usage_model_state/.test(x.query+x.values.join(' '))&&x.op==='first').length===1);
for(const [i,kind] of ['role','meeting','brief','research','learning'].entries())await observe('run_b_'+kind,'reported-model-b',kind,at(120+i));
check('one base-model change reported by all five HERMES kinds is exactly one change',hermesChanges().length===1&&hermesChanges()[0].from.actual==='reported-model-a'&&hermesChanges()[0].to.actual==='reported-model-b'&&hermesChanges()[0].providerRunId==='run_b_role'&&hermesChanges()[0].kind==='role'&&hermesChanges()[0].key==='hermes');
// 모델 전환 중 늦게 끝난 이전 실행: 기준값 실행(120초)보다 먼저(90초) 제출돼 이전 모델을 보고해도 역방향 경보·재경보가 없다.
await observe('run_late_a','reported-model-a','role',at(90));
await observe('run_after_late','reported-model-b','role',at(130));
check('a late run submitted before the switch makes no reverse change and no repeat',hermesChanges().length===1&&modelState().providers.hermes.actual==='reported-model-b');
await observe('run_b2','reported-model-b');
await ledger.recordProviderUsage(owner,'hermes','run_b_role',{status:'completed',model:'reported-model-b',usage:{total_tokens:1}},{kind:'role',submissionId:'none'});
check('repeating the new model or re-polling a run creates no change',hermesChanges().length===1);
await observe('run_alias','hermes-agent','meeting',at(180));
const aliasChange=hermesChanges()[1];
check('switching to the gateway alias is a change to an unverified model',hermesChanges().length===2&&aliasChange.to.actual===null&&aliasChange.to.reported==='hermes-agent'&&aliasChange.from.actual==='reported-model-b');
await observe('run_alias2','HERMES-AGENT','brief',at(181));
check('the alias repeated (any case, any kind) creates no change',hermesChanges().length===2);
check('alias is never written as an actual model anywhere',changes().every(c=>c.to.actual!=='hermes-agent'&&c.from.actual!=='hermes-agent'&&c.to.actual?.toLowerCase()!=='hermes-agent')&&modelState().providers.hermes.actual===null);
check('alias usage stays unpriced',usageRow('run_alias').costStatus==='unpriced'&&usageRow('run_alias').costAmount===null);
await assert.rejects(()=>ledger.saveUsagePricing(owner,{provider:'hermes',model:'hermes-agent',priceVersion:'v',currency:'USD',inputPerMillion:1,outputPerMillion:1,source:'https://provider.example.com/p'}),e=>e.status===400);passed.push('pricing the alias is still rejected');
await observe('run_back_b','reported-model-b','research',at(240));
check('a run submitted after the baseline that reports an earlier model is a real change',hermesChanges().length===3&&hermesChanges()[2].from.actual===null&&hermesChanges()[2].to.actual==='reported-model-b');
const beforeNull=changes().length;
await ledger.recordProviderUsage(owner,'hermes','run_nomodel',{status:'failed',usage:{}},{kind:'role',submissionId:submitted('sub-run_nomodel',at(300))});
check('a run that reports no model is not a change',changes().length===beforeNull);
await ledger.recordProviderUsage(owner,'hermes','run_nomodel',{status:'failed',model:'reported-model-c',usage:{}},{kind:'role',submissionId:'sub-run_nomodel'});
check('a model reported later for the same run is compared once',hermesChanges().length===4&&hermesChanges()[3].to.actual==='reported-model-c');
check('a later-reported model keeps its run submission time for ordering',modelState().providers.hermes.submittedAt===at(300));
const recent=plain(await alarm.recentModelChanges(owner,2));
check('recent changes are newest first and limited',recent.length===2&&recent[0].to.actual==='reported-model-c');

// D) 사용량 화면 응답: 조인 키·캠페인 이름·superseded·모델 경보.
await put('artifact',role.artifactId,{...(await server.readRecord(owner,'artifact',role.artifactId)),status:'outdated'},campaign.id);
await put('campaign',campaign.id,{...(await server.readRecord(owner,'campaign',campaign.id)),version:2});
let r=await usageRoute.GET(new Request('https://agency.test/api/usage',{headers:{'oai-authenticated-user-id':owner}}));
const usage=await r.json();
const byRun=id=>usage.entries.find(e=>e.providerRunId===id);
check('usage response keeps every entry and the join keys',r.status===200&&byRun(roleRun).jobId===roleJob&&byRun(briefRun).storeId===store.id);
check('outdated role artifact marks its run superseded',byRun(roleRun).superseded==='outdated');
check('a changed brief marks older campaign runs superseded',byRun(meetingStep.providerId).superseded==='brief_changed'&&byRun(briefRun).superseded==='brief_changed');
check('current and campaign-less runs are not superseded',byRun(openaiRun).superseded===null&&byRun(researchStep.providerId).superseded===null);
check('campaign titles are returned for the campaign column',usage.campaigns.some(c=>c.id===campaign.id&&c.title===campaign.title));
check('recent model changes are in the usage response',Array.isArray(usage.modelChanges)&&usage.modelChanges.length===changes().length&&usage.modelChanges[0].to.actual==='reported-model-c');
check('current reported model per provider is in the usage response',usage.reportedModels.some(m=>m.key==='hermes'&&m.actual==='reported-model-c'&&m.kind==='role'));
const filtered=summary.filterUsage(usage.entries,{campaignId:campaign.id,kind:'role',role:'cmo'});
check('filter by campaign and role keeps only matching runs',filtered.length===1&&filtered[0].providerRunId===roleRun);
// 학습 실행 2회(조사·규칙 초안) + 경보 검사(C)의 합성 학습 실행 1회.
check('filter by kind alone',summary.filterUsage(usage.entries,{kind:'learning'}).length===3);
const panel=readFileSync('app/usage-panel.tsx','utf8');
check('usage panel shows campaign and role columns, filters, superseded and the model alarm badge',/캠페인 · 역할/.test(panel)&&/filterUsage/.test(panel)&&/superseded/.test(panel)&&/modelChanges/.test(panel)&&/모델 변경/.test(panel));

// E) 소유자 전용 내보내기: CSV(조인 키, 합계 = 화면 합계)와 캠페인 제출 원문(리플레이용). member·admin 403, 다른 owner 404, 비로그인 401.
const csvRows=text=>{const rows=[];let row=[],cell='',quoted=false;const s=text.replace(/^\uFEFF/,'');for(let i=0;i<s.length;i++){const ch=s[i];if(quoted){if(ch==='"'&&s[i+1]==='"'){cell+='"';i++}else if(ch==='"')quoted=false;else cell+=ch}else if(ch==='"')quoted=true;else if(ch===','){row.push(cell);cell=''}else if(ch==='\n'){row.push(cell);rows.push(row);row=[];cell=''}else if(ch!=='\r')cell+=ch}if(cell||row.length){row.push(cell);rows.push(row)}return rows};
const exportGet=(query,headers)=>exportRoute.GET(new Request('https://agency.test/api/usage/export'+query,{headers}));
r=await exportGet('?type=usage_csv',{'oai-authenticated-user-id':owner});
const csvText=await r.text(),rows=csvRows(csvText),header=rows[0],col=name=>header.indexOf(name);
check('owner downloads a CSV attachment',r.status===200&&/text\/csv/.test(r.headers.get('content-type'))&&/attachment/.test(r.headers.get('content-disposition'))&&r.headers.get('cache-control')==='no-store');
check('CSV has the join key columns',['jobId','campaignId','brandId','storeId','kind','role','promptVersion','outputContractVersion','appTree','durationMs','superseded','model','totalTokens'].every(c=>col(c)>=0));
const csvTotal=rows.slice(1).reduce((n,row)=>n+(row[col('totalTokens')]===''?0:Number(row[col('totalTokens')])),0);
check('CSV row count and token total equal the usage screen summary',rows.length-1===usage.entries.length&&csvTotal===summary.summarizeUsage(usage.entries).totalTokens);
check('unknown values are empty cells, not zero',rows.slice(1).find(row=>row[col('providerRunId')]==='run_missing_submission')[col('promptVersion')]==='');
r=await exportGet(`?type=usage_csv&campaignId=${campaign.id}&kind=role&role=cmo`,{'oai-authenticated-user-id':owner});
const filteredRows=csvRows(await r.text()).slice(1);
check('filtered CSV total equals the filtered screen total',filteredRows.length===filtered.length&&filteredRows.reduce((n,row)=>n+Number(row[col('totalTokens')]||0),0)===summary.summarizeUsage(filtered).totalTokens);
check('CSV contains no owner id, email, key or endpoint',!csvText.includes(owner+':')&&!/@/.test(csvText)&&!csvText.includes('mock-only')&&!csvText.includes('hermes.example.com'));
r=await exportGet('?type=usage_csv&kind=bogus',{'oai-authenticated-user-id':owner});
check('unknown kind filter is a 400',r.status===400);
r=await exportGet('?type=submissions&campaignId='+campaign.id,{'oai-authenticated-user-id':owner});
const replay=await r.json();
check('campaign submission export is an owner attachment',r.status===200&&/attachment/.test(r.headers.get('content-disposition'))&&replay.campaignId===campaign.id);
const exported=id=>replay.submissions.find(s=>s.id===(id.startsWith(owner+':')?id.slice(owner.length+1):id));
check('export has the role, meeting, brief and guidance submissions of the campaign only',!!exported(roleJob)&&!!exported(meetingStep.id)&&!!exported('brief-id-brief')&&!!exported(guidanceJob)&&replay.submissions.every(s=>!s.id.startsWith('id-research')));
check('exported instructions and input replay the stored body exactly',(()=>{const saved=submissionOf(roleJob),e=exported(roleJob);return JSON.stringify({instructions:e.instructions,input:e.input,session_id:saved.key,conversation_history:[]})===saved.body&&e.instructionHash===sha(e.instructions).slice(0,12)})());
const replayText=JSON.stringify(replay);
check('submission export has no idempotency key, email, owner id or connection secret',!replayText.includes(submissionOf(roleJob).key)&&!replayText.includes('private-person@example.com')&&!replayText.includes(owner+':')&&!replayText.includes('mock-only'));
r=await exportGet('?type=submissions',{'oai-authenticated-user-id':owner});
check('submission export needs a campaign',r.status===400);
r=await exportGet('?type=other',{'oai-authenticated-user-id':owner});
check('unknown export type is a 400',r.status===400);

env.AUTH_MODE='email';env.AUTH_ORIGIN='https://agency.test';
const signIn=(id,role,createdAt,ws)=>{const token=sha(id);sql.prepare('INSERT INTO auth_users(id,email,workspace_owner,role,status,created_at) VALUES(?,?,?,?,?,?)').run(id,id+'@test.invalid',ws,role,'active',createdAt);sql.prepare('INSERT INTO auth_sessions VALUES(?,?,?,?)').run(sha(token),id,Date.now()+60000,Date.now());return {cookie:'__Host-collective_session='+token}};
const ownerS=signIn('ws-owner','admin',1000,owner),adminS=signIn('ws-admin','admin',2000,owner),memberS=signIn('ws-member','member',500,owner),strangerS=signIn('other-owner-admin','admin',1000,'other-workspace');
const campaignQ=`?type=submissions&campaignId=${campaign.id}`,csvQ=`?type=usage_csv&campaignId=${campaign.id}`;
const [anonCsv,anonSub,memberCsv,memberSub,adminCsv,ownerCsv,strangerSub,strangerCsv,strangerAll]=await Promise.all([exportGet('?type=usage_csv',{}),exportGet(campaignQ,{}),exportGet('?type=usage_csv',memberS),exportGet(campaignQ,memberS),exportGet('?type=usage_csv',adminS),exportGet('?type=usage_csv',ownerS),exportGet(campaignQ,strangerS),exportGet(csvQ,strangerS),exportGet('?type=usage_csv',strangerS)]);
check('unauthenticated export is a 401',anonCsv.status===401&&anonSub.status===401);
check('member and admin exports are 403',memberCsv.status===403&&memberSub.status===403&&adminCsv.status===403);
check('workspace owner exports',ownerCsv.status===200);
check('another owner gets 404 for this campaign',strangerSub.status===404&&strangerCsv.status===404);
check('another owner never sees this ledger',strangerAll.status===200&&csvRows(await strangerAll.text()).length===1);
r=await usageRoute.GET(new Request('https://agency.test/api/usage',{headers:memberS}));
check('members still read the usage screen',r.status===200);

// F) 새 kind는 레지스트리에 캠페인과 무관한 정책으로 등록돼 있다(전수 검사는 tests/record-kinds.test.mjs).
const kinds=plain(registry.recordKinds);
check('new kinds are registered and not campaign scoped',['feature_flag','usage_model_state','model_change'].every(k=>kinds.find(x=>x.kind===k)?.campaignDeletion==='not_campaign_scoped'));
check('no external network call',external.length===0);
console.log(JSON.stringify({passed:passed.length,checks:passed},null,2));
