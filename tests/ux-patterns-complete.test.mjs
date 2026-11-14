// 레인 X 패턴 완성(P2·P5·P10·P11·P14): 회의·연속 실행 중 지시 추가(다음 단계부터, 없으면 바이트 동일), 작업물 진행 단계, 사용량 미터 임계, 결정 카드 분할, 타임라인 끼우기. 모의 HERMES fetch, 메모리 SQLite(mocked). 유료 모델 호출 0회.
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
async function request(mod,method,b,path='/api/test'){const headers={'Content-Type':'application/json','oai-authenticated-user-id':owner};const r=await mod.namespace[method](new Request('https://agency.test'+path,{method,headers,...(b?{body:JSON.stringify(b)}:{})}));return {status:r.status,data:await r.json()}}
const act=(name,b={})=>request(action,'POST',{action:name,...b});const snapshot=()=>request(workspace,'GET');
const meetings=await load('app/api/meetings/route.ts');await meetings.evaluate();
const server=await load('lib/server.ts');await server.evaluate();
const mp=(action,b={})=>request(meetings,'POST',{action,...b});
const rp=(action,b={})=>request(run,'POST',{action,...b});
const put=(kind,id,data,parent='')=>server.namespace.recordStatement(owner,kind,id,data,parent).run();
const stored=kind=>sql.prepare('SELECT data FROM records WHERE kind=? ORDER BY rowid').all(kind).map(r=>JSON.parse(r.data));
await snapshot();const c=(await snapshot()).data.campaigns[0],cid=c.id;
await act('save_hermes',{endpoint:'https://hermes.example.com',key:'hermes-local-test-key-only'});
await put('worker_credential','current',{id:'current',tokenHash:'fixture'});

// ── P14 회의 중 지시 추가: 다음 단계부터, 지금 단계는 그대로 ─────────────────────────────
const id='instr-main';
let r=await mp('start',{id,campaignId:cid,campaignVersion:1,agenda:'지시 추가 검사'});
check('meeting starts',r.status===200&&r.data.status==='running');
r=await mp('advance',{id});
const first=r.data.steps.find(s=>s.status!=='completed');
check('the first discussion step was submitted once',inputs.length===1&&first.id===id+':discussion:cmo'&&['running','starting'].includes(first.status));
check('an empty instruction is rejected',(await mp('add_instruction',{id,text:'   '})).status===400);
check('an over-long instruction is rejected',(await mp('add_instruction',{id,text:'가'.repeat(1001)})).status===400);
r=await mp('add_instruction',{id,text:'다음 단계부터 가격 표현은 빼 주세요. 문의 010-1234-5678'});
check('an instruction is stored on the running meeting after the current step',r.status===200&&r.data.instructions.length===1&&r.data.instructions[0].afterStepId===id+':discussion:cmo');
check('the instruction is appended as a meeting_instruction record with the actor',stored('meeting_instruction').length===1&&stored('meeting_instruction')[0].meetingId===id&&stored('meeting_instruction')[0].campaignId===cid&&stored('meeting_instruction')[0].by?.id===owner);
check('the instruction is recorded as a campaign event',!!sql.prepare("SELECT 1 FROM records WHERE kind='event' AND data LIKE '%회의 중 지시를 추가했습니다%'").get());
check('the step already in progress keeps its original input',!('addedInstructions' in inputs[0])&&!sql.prepare("SELECT data FROM records WHERE kind='hermes_submission' ORDER BY rowid LIMIT 1").get().data.includes('addedInstructions'));
for(let i=0;i<6&&inputs.length<2;i++)await mp('advance',{id});
check('the next step input carries the instruction with its note',inputs.length>=2&&inputs[1].addedInstructions?.items?.length===1&&/가격 표현은 빼 주세요/.test(inputs[1].addedInstructions.items[0].text)&&/이 단계부터 반영/.test(inputs[1].addedInstructions.note));
check('personal data in the instruction is masked in the model input',!JSON.stringify(inputs[1]).includes('010-1234-5678'));
// 지시문(system)은 바뀌지 않는다: 같은 단계를 지시 없이 조립한 지시문과 같다.
const meetingInput=await load('lib/meeting-input.ts');await meetingInput.evaluate();
const record=JSON.parse(sql.prepare("SELECT data FROM records WHERE kind='team_meeting' AND json_extract(data,'$.id')=?").get(id).data);
const target=record.steps.find(s=>s.status!=='completed');
const before={...record,steps:record.steps.map(s=>s.id===target.id?{id:s.id,role:s.role,phase:s.phase,status:'pending'}:s)};
const none={...before};delete none.instructions;
const build=m=>meetingInput.namespace.buildMeetingSubmission(m,target.id,[]);
check('without instructions the submission is byte-identical to an empty instruction list',build(none).input===build({...before,instructions:[]}).input&&build(none).instructions===build({...before,instructions:[]}).instructions);
check('an instruction attached to the target step itself is not injected into that step',build(none).input===build({...before,instructions:[{id:'x',text:'지금 단계',createdAt:'2026-01-01T00:00:00.000Z',afterStepId:target.id}]}).input);
check('instructions never change the system instructions of the step',build(none).instructions===build(before).instructions&&build(before).input!==build(none).input);
r=await mp('cancel',{id});for(let i=0;i<4&&r.data.status==='running';i++)r=await mp('advance',{id});
check('adding to a stopped or finished meeting is rejected',(await mp('add_instruction',{id,text:'늦은 지시'})).status===409);

// ── P14 연속 실행 중 지시 추가 ─────────────────────────────────────────────
check('adding to a campaign without a running sequence is rejected',(await rp('add_instruction',{campaignId:cid,text:'다음 담당부터'})).status===409);
await put('campaign_sequence',cid,{campaignId:cid,campaignVersion:1,status:'running',startedAt:'2026-01-02T00:00:00.000Z',updatedAt:'2026-01-02T00:00:00.000Z'},cid);
r=await rp('add_instruction',{campaignId:cid,text:'다음 담당부터 할인 문구는 빼 주세요.'});
check('a running sequence stores a run_instruction tied to that sequence',r.status===200&&r.data.instructions.length===1&&stored('run_instruction')[0].sequenceStartedAt==='2026-01-02T00:00:00.000Z');
const listed=await request(run,'GET',null,'/api/run?instructions='+encodeURIComponent(cid));
check('the instruction list is readable for the timeline',listed.status===200&&listed.data.instructions.length===1);
const roleExec=await load('lib/role-execution.ts');await roleExec.evaluate();
const campaign=JSON.parse(sql.prepare("SELECT data FROM records WHERE kind='campaign' AND json_extract(data,'$.id')=?").get(cid).data),brandRec=JSON.parse(sql.prepare("SELECT data FROM records WHERE kind='brand' AND json_extract(data,'$.id')=?").get(campaign.brandId).data);
const sources=await roleExec.namespace.roleSources(owner,campaign,'insight');
const withRun=await roleExec.namespace.roleRequestFor(owner,campaign,'insight',sources,brandRec);
const sub=roleExec.namespace.roleSubmission(withRun);
check('the next role request carries the instruction',withRun.addedInstructions?.items?.[0]?.text==='다음 담당부터 할인 문구는 빼 주세요.'&&JSON.parse(sub.input).addedInstructions.items.length===1);
const plain=Object.fromEntries(Object.entries(withRun).filter(([k])=>k!=="addedInstructions"));
check('a role request without instructions has no key and the input has none',!('addedInstructions' in JSON.parse(roleExec.namespace.roleSubmission(plain).input))&&roleExec.namespace.roleSubmission(plain).instructions===sub.instructions);
await put('campaign_sequence',cid,{campaignId:cid,campaignVersion:1,status:'paused',startedAt:'2026-01-02T00:00:00.000Z',updatedAt:'2026-01-02T00:05:00.000Z'},cid);
const paused=await roleExec.namespace.roleRequestFor(owner,campaign,'insight',sources,brandRec);
check('a paused sequence no longer injects its instructions',!('addedInstructions' in paused));
await put('campaign_sequence',cid,{campaignId:cid,campaignVersion:1,status:'running',startedAt:'2026-01-03T00:00:00.000Z',updatedAt:'2026-01-03T00:00:00.000Z'},cid);
check('a new sequence does not inherit the previous sequence instructions',!('addedInstructions' in await roleExec.namespace.roleRequestFor(owner,campaign,'insight',sources,brandRec)));

// ── 순수 모듈: 진행 단계(P5)·미터(P11)·결정 카드(P2)·타임라인 끼우기(P14) ──────────────────
const life=await load('lib/artifact-lifecycle.ts');await life.evaluate();const L=life.namespace;
const states=x=>Object.fromEntries(x.stages.map(s=>[s.id,s.state]));
check('a draft artifact is at the draft stage',L.artifactLifecycle('draft').current==='draft'&&states(L.artifactLifecycle('draft')).review==='todo');
check('an unknown status falls back to the draft stage',L.artifactLifecycle('legacy_mystery').current==='draft');
check('review is the current stage with the draft done',JSON.stringify(states(L.artifactLifecycle('review')))===JSON.stringify({draft:'done',review:'current',revision:'todo',approved:'todo',scheduled:'todo',published:'todo'}));
check('changes requested passes back through review',JSON.stringify(states(L.artifactLifecycle('revision')))===JSON.stringify({draft:'done',review:'done',revision:'current',approved:'todo',scheduled:'todo',published:'todo'}));
check('approved marks the optional revision as skipped',JSON.stringify(states(L.artifactLifecycle('approved')))===JSON.stringify({draft:'done',review:'done',revision:'skipped',approved:'current',scheduled:'todo',published:'todo'}));
const art={id:'a1',version:2};
check('a publication of another version does not move the stage',L.publicationMark(art,[{status:'published',copy:{artifactId:'a1',artifactVersion:1}}])===null);
check('a draft, failed or blocked publication does not move the stage',L.publicationMark(art,['draft','failed','cancelled','blocked'].map(status=>({status,copy:{artifactId:'a1',artifactVersion:2}})))===null);
check('an accepted publication schedules the artifact',L.publicationMark(art,[{status:'accepted',copy:{artifactId:'a1',artifactVersion:2}}])==='scheduled'&&L.artifactLifecycle('approved','scheduled').current==='scheduled');
check('a confirmed post wins over a schedule',L.publicationMark(art,[{status:'approved',copy:{artifactId:'a1',artifactVersion:2}},{status:'published',copy:{artifactId:'a1',artifactVersion:2}}])==='published'&&JSON.stringify(states(L.artifactLifecycle('approved','published')))===JSON.stringify({draft:'done',review:'done',revision:'skipped',approved:'done',scheduled:'done',published:'current'}));
const meter=await load('lib/usage-meter.ts');await meter.evaluate();const M=meter.namespace;
const at=(used,limit,inProgress=0)=>M.meterOf({used,limit,inProgress});
check('below 80 percent is ok',at(799,1000).state==='ok'&&at(799,1000).percent===79);
check('80 percent including in-progress reservations is a warning',at(700,1000,100).state==='warn'&&at(700,1000,100).percent===80);
check('99 percent is still a warning',at(999,1000).state==='warn');
check('100 percent reaches the cap and the bar stops at full width',at(1000,1000).state==='over'&&M.meterWidth(at(1500,1000))===100&&at(1500,1000).percent===150);
check('no cap is unset without a percentage',at(500,null).state==='unset'&&at(500,null).percent===null&&M.meterWidth(at(500,null))===0);
check('a missing budget line is unknown',M.meterOf(null).state==='unknown'&&M.meterOf({used:NaN,limit:10,inProgress:0}).state==='unknown');
check('token cost converts to credits and won with VAT from the placeholder top-up price',JSON.stringify(M.tokenCost(12345))===JSON.stringify({credits:13,krw:150})&&JSON.stringify(M.tokenCost(0))===JSON.stringify({credits:0,krw:0}));
const dec=await load('lib/meeting-decisions.ts');await dec.evaluate();
check('decision text splits into one card per line without bullets',JSON.stringify(dec.namespace.decisionItems('- 단면 컷 실험\n2) 평일 오후 픽업 안내\n\n• 쿠폰 보류'))===JSON.stringify(['단면 컷 실험','평일 오후 픽업 안내','쿠폰 보류'])&&JSON.stringify(dec.namespace.decisionItems('한 줄 결정'))===JSON.stringify(['한 줄 결정'])&&dec.namespace.decisionItems('').length===0);
check('more than twelve decisions fold into the last card',dec.namespace.decisionItems(Array.from({length:15},(_,i)=>'결정'+i).join('\n')).length===12);
const tl=await load('lib/run-timeline.ts');await tl.evaluate();
const items=[{id:'s1',title:'a',status:'completed'},{id:'s2',title:'b',status:'running'},{id:'s3',title:'c',status:'pending'}];
const merged=tl.namespace.withInstructions(items,[{id:'i2',text:'둘째',createdAt:'2026-01-01T00:02:00Z',afterStepId:'s2'},{id:'i1',text:'첫째',createdAt:'2026-01-01T00:01:00Z',afterStepId:'s2'},{id:'i3',text:'모름',createdAt:'2026-01-01T00:03:00Z',afterStepId:null}],{title:'지시 추가',subtitle:'다음 단계부터 반영'});
check('instructions sit right after the step in progress, in time order, unknown ones last',JSON.stringify(merged.map(x=>x.id))===JSON.stringify(['s1','s2','instruction:i1','instruction:i2','s3','instruction:i3'])&&merged[2].status==='instruction'&&tl.namespace.statusView('instruction').label==='지시 추가'&&!tl.namespace.statusView('instruction').live);
check('no instructions leaves the timeline unchanged',JSON.stringify(tl.namespace.withInstructions(items,undefined,{title:'',subtitle:''}))===JSON.stringify(items));
console.log(JSON.stringify({passed:passed.length,checks:passed},null,1));
