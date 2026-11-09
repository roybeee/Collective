// 회의 남은 이견 A/B 선택(X2)·실행 전 계획 기록(X3)·단계 상태(thinking·waiting_for_approval, G0) 검사. 모의 HERMES fetch, 메모리 SQLite(mocked). 유료 모델 호출 0회.
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

let calls=0,providerStatus='completed',lastEvent;const submissions=new Map(),inputs=[];
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
  const key=options.headers['Idempotency-Key'];if(!submissions.has(key)){calls++;const x=JSON.parse(JSON.parse(options.body).input);inputs.push(x);submissions.set(key,{id:'choice_run_'+calls,x})}
  return Response.json({run_id:submissions.get(key).id});
 }
 if(url.endsWith('/stop')){providerStatus='cancelled';return Response.json({ok:true})}
 if(url.includes('/v1/runs/')){const id=url.split('/').pop(),r=[...submissions.values()].find(r=>r.id===id);return Response.json({object:'hermes.run',run_id:id,status:providerStatus,...(lastEvent?{last_event:lastEvent,updated_at:Math.floor(Date.now()/1000)}:{}),output:answer(r.x),usage:{total_tokens:50}})}
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
const flags=await load('lib/feature-flags.ts');await flags.evaluate();
const mp=(action,b={})=>request(meetings,'POST',{action,...b});
const put=(kind,id,data,parent='')=>server.namespace.recordStatement(owner,kind,id,data,parent).run();
const choicesStored=()=>sql.prepare("SELECT data FROM records WHERE kind='meeting_choice' ORDER BY rowid").all().map(r=>JSON.parse(r.data));
await snapshot();const c=(await snapshot()).data.campaigns[0],cid=c.id;
await act('save_hermes',{endpoint:'https://hermes.example.com',key:'hermes-local-test-key-only'});
await put('worker_credential','current',{id:'current',tokenHash:'fixture'});
for(const role of ['creative','content','growth','data','quality'])await put('artifact','old-'+role,{id:'old-'+role,campaignId:cid,campaignVersion:1,role,title:role,content:'original '+role,version:3,status:'approved',origin:'manual',createdAt:'old'},cid);
const args={id:'choice-main',campaignId:cid,campaignVersion:1,agenda:'남은 이견 선택 검사'};
// 합의 단계까지 진행한다(단계마다 접수 1회 + 조회 1회).
async function untilSynthesis(id){let r;for(let i=0;i<40;i++){r=await mp('advance',{id});const s=r.data.steps.find(x=>x.phase==='synthesis');if(s?.status==='completed'||!['running','uncertain'].includes(r.data.status))break}return r}
async function untilDone(id){let r;for(let i=0;i<40;i++){r=await mp('advance',{id});if(!['running','uncertain'].includes(r.data.status))break}return r}

// --- X3 실행 전 계획 기록 ---------------------------------------------------------------
check('plan with a non-integer token estimate is rejected',(await mp('start',{...args,id:'bad-plan',plan:{estimatedTokens:'many',steps:12}})).status===400);
check('plan with an out-of-range step count is rejected',(await mp('start',{...args,id:'bad-plan-2',plan:{estimatedTokens:100,steps:40}})).status===400);
let r=await mp('start',{...args,plan:{estimatedTokens:12000,estimatedMs:null,steps:12}});
check('meeting start stores the approved plan estimate',r.status===200&&r.data.plan.estimatedTokens===12000&&r.data.plan.estimatedMs===null&&r.data.plan.steps===12&&typeof r.data.plan.approvedAt==='string');
const synthesisId=args.id+':synthesis';
// --- X2 선택: 합의 전에는 거절, 완료 뒤 추가만 ----------------------------------------------
check('choosing before the synthesis step completes is rejected',(await mp('choose',{id:args.id,stepId:synthesisId,choice:'A'})).status===409);
r=await untilSynthesis(args.id);
const synthesis=r.data.steps.find(s=>s.phase==='synthesis');
check('synthesis completed with a remaining disagreement',synthesis.status==='completed'&&synthesis.output.disagreements==='기준 없는 할인 제안 보류');
check('revision step is not gated while the switch is off',r.data.steps.find(s=>s.phase==='revision').status==='pending');
check('an unknown choice value is rejected',(await mp('choose',{id:args.id,stepId:synthesisId,choice:'C'})).status===400);
check('choosing on a discussion step is rejected',(await mp('choose',{id:args.id,stepId:args.id+':discussion:cmo',choice:'A'})).status===409);
r=await mp('choose',{id:args.id,stepId:synthesisId,choice:'B'});
check('choice B is stored on the meeting with both options',r.status===200&&r.data.choices.length===1&&r.data.choices[0].choice==='B'&&r.data.choices[0].optionA===synthesis.output.decisions&&r.data.choices[0].optionB===synthesis.output.disagreements);
check('choice is appended as a meeting_choice record under the campaign',choicesStored().length===1&&choicesStored()[0].meetingId===args.id&&choicesStored()[0].campaignId===cid&&choicesStored()[0].by?.id===owner);
check('choice is recorded as a campaign event',!!sql.prepare("SELECT 1 FROM records WHERE kind='event' AND data LIKE '%B안 채택%'").get());
const beforeRevision=inputs.length;
await mp('advance',{id:args.id});
check('the next step input carries the user decision',inputs.length===beforeRevision+1&&inputs.at(-1).phase==='revision'&&inputs.at(-1).userDecision.choice==='B'&&inputs.at(-1).userDecision.chosen===synthesis.output.disagreements&&/B를 따르세요/.test(inputs.at(-1).userDecision.note));
check('steps before the synthesis never carried a decision',inputs.slice(0,beforeRevision).every(x=>!('userDecision' in x)));
r=await untilDone(args.id);
check('meeting completes with the decision in every later step input',r.data.status==='completed'&&inputs.filter(x=>x.phase==='revision'||x.phase==='quality').every(x=>x.userDecision?.choice==='B'));
check('completed steps record start and finish times',r.data.steps.every(s=>typeof s.startedAt==='string'&&typeof s.completedAt==='string'));
// 완료 뒤에도 선택을 추가할 수 있다(후속 회의 전달용). 기록은 덮어쓰지 않고 추가된다.
r=await mp('choose',{id:args.id,stepId:synthesisId,choice:'A'});
check('a later choice is appended, not overwritten',r.data.choices.length===2&&r.data.choices.at(-1).choice==='A'&&choicesStored().length===2);
await mp('start',{...args,id:'choice-followup',previousMeetingId:args.id});await mp('advance',{id:'choice-followup'});
check('a follow-up meeting receives the latest previous choice in its input',inputs.at(-1).previousMeeting.id===args.id&&inputs.at(-1).previousMeeting.choice.choice==='A'&&inputs.at(-1).previousMeeting.choice.chosen===synthesis.output.decisions);
await mp('cancel',{id:'choice-followup'});await untilDone('choice-followup');
// --- G0 공급자 보고 상태: 승인 대기·생각 중 -------------------------------------------------
await mp('start',{...args,id:'status-main'});await mp('advance',{id:'status-main'});
providerStatus='waiting_approval';r=await mp('advance',{id:'status-main'});
check('provider approval wait shows as waiting_for_approval on the step while the meeting keeps running',r.data.status==='running'&&r.data.steps[0].status==='waiting_for_approval');
providerStatus='running';lastEvent='model.thinking';r=await mp('advance',{id:'status-main'});
check('provider reasoning activity shows as thinking with the activity name',r.data.steps[0].status==='thinking'&&r.data.steps[0].activity==='model.thinking'&&typeof r.data.steps[0].activityAt==='string');
lastEvent='tool.call';r=await mp('advance',{id:'status-main'});
check('other activity shows as running',r.data.steps[0].status==='running'&&r.data.steps[0].activity==='tool.call');
lastEvent=undefined;providerStatus='completed';r=await mp('advance',{id:'status-main'});
check('completion still lands after the intermediate states',r.data.steps[0].status==='completed');
await mp('cancel',{id:'status-main'});await untilDone('status-main');
// --- X2 게이트(meeting_choice_gate 켜짐): 선택 전까지 첫 개선 단계를 제출하지 않는다 -------------
await flags.namespace.setFeatureFlag(owner,{flag:'meeting_choice_gate',enabled:true},{id:owner,email:null});
await mp('start',{...args,id:'choice-gate'});r=await untilSynthesis('choice-gate');
const gated=r.data.steps.find(s=>s.phase==='revision');
check('with the gate on the first revision step waits for approval',gated.status==='waiting_for_approval'&&r.data.steps.filter(s=>s.status==='waiting_for_approval').length===1);
const callsBefore=calls;
await mp('advance',{id:'choice-gate'});await mp('recover',{id:'choice-gate'});
check('advance and recover do not submit while waiting for the choice',calls===callsBefore&&(await mp('advance',{id:'choice-gate'})).data.steps.find(s=>s.phase==='revision').status==='waiting_for_approval');
r=await mp('choose',{id:'choice-gate',stepId:'choice-gate:synthesis',choice:'hold'});
check('the choice releases the gated step back to pending',r.data.steps.find(s=>s.phase==='revision').status==='pending');
await mp('advance',{id:'choice-gate'});
check('the released step is submitted with the hold decision',calls===callsBefore+1&&inputs.at(-1).phase==='revision'&&inputs.at(-1).userDecision.choice==='hold'&&/보류/.test(inputs.at(-1).userDecision.note));
r=await untilDone('choice-gate');check('gated meeting completes after the choice',r.data.status==='completed');
// 게이트 대기 중 중지: 접수 없이 취소되고 종료 시각이 남는다.
await mp('start',{...args,id:'choice-gate-cancel'});r=await untilSynthesis('choice-gate-cancel');
const cancelCalls=calls;r=await mp('cancel',{id:'choice-gate-cancel'});
check('cancelling while gated cancels without submitting',r.data.status==='cancelled'&&calls===cancelCalls&&r.data.steps.find(s=>s.phase==='revision').status==='cancelled'&&typeof r.data.steps.find(s=>s.phase==='revision').completedAt==='string');
await flags.namespace.resetFeatureFlag(owner,{flag:'meeting_choice_gate'});
// 이견이 '없음'이면 게이트가 켜져 있어도 멈추지 않는다(순수 판정).
const meetingsLib=await load('lib/meetings.ts');await meetingsLib.evaluate();
check('a one-word no-disagreement synthesis has no disagreement',!meetingsLib.namespace.hasDisagreement({disagreements:'없음'})&&!meetingsLib.namespace.hasDisagreement({disagreements:' 해당 없음. '})&&meetingsLib.namespace.hasDisagreement({disagreements:'기준 없는 할인 제안 보류'}));
check('userDecision of nothing is undefined',meetingsLib.namespace.userDecision(undefined)===undefined);
console.log(JSON.stringify({passed:passed.length,checks:passed},null,1));
