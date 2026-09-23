// 실제 lib/role-execution.ts start 분기가 저장·전송한 제출 본문이 lib/role-instruction.ts 순수 함수 출력과 바이트 동일한지 확인한다(F1b 드리프트 방지).
// role-instruction.test.mjs는 순수 함수를 기준 스냅샷과 비교하고, 이 테스트는 실행 경로가 그 순수 함수 출력을 그대로 보내는지 본다. 둘이 갈라지면 실패한다.
// 근거: mocked(모의 HERMES·OpenAI fetch 스텁, 메모리 SQLite, 합성 데이터). 외부 네트워크 호출은 0회다.
import assert from 'node:assert/strict';
import {testRuntime} from './helpers/runtime.mjs';
import {roleFixture} from './helpers/role-fixture.mjs';

// 첫 인사이트 호출은 재질문(합성)으로 실패시켜 직전 실패 사유(lastFailure) 재작성 분기까지 지난다.
const reask='이번 요청에서 수행할 작업이 명시되지 않았습니다. 다음 중 하나를 지정해 주세요.\n1. 초안 검수\n2. 전체 재작성\n번호 하나만 말씀해 주시면 됩니다.';
const sent=new Map(),external=[];let calls=0,reaskOnce=true;
const {sql,load}=testRuntime(async(url,options={})=>{
 url=String(url);
 if(url==='https://api.openai.com/v1/responses'){calls++;return Response.json({id:'resp_drift_'+calls,status:'queued',model:'mock-openai-model'})}
 if(!url.startsWith('https://hermes.example.com/')){external.push(url);throw new Error('모의 주소만 호출합니다: '+url)}
 if(url.endsWith('/v1/runs')){const id='drift_'+ ++calls;sent.set(id,options.body);return Response.json({run_id:id})}
 const id=url.split('/').pop(),input=JSON.parse(sent.get(id)).input;
 const output=JSON.parse(input).task?.role==='insight'&&reaskOnce?(reaskOnce=false,reask):roleFixture(input);
 return Response.json({object:'hermes.run',run_id:id,status:'completed',output,usage:{total_tokens:100,output_tokens:600},model:'mock-model'});
});
const server=await load('lib/server.ts'),execution=await load('lib/role-execution.ts'),instruction=await load('lib/role-instruction.ts'),roleOutput=await load('lib/role-output.ts');
const archiveServer=await load('lib/archive-server.ts'),aiContext=await load('lib/ai-context.ts'),learningServer=await load('lib/learning-server.ts'),agency=await load('lib/agency.ts'),practice=await load('lib/practice.ts');
const owner='drift-owner',now='2026-01-01T00:00:00.000Z',passed=[];
const check=(name,fn)=>{fn();passed.push(name)};
const put=(kind,id,data,parent='')=>server.recordStatement(owner,kind,id,data,parent).run();
const settings=async(secret,model)=>sql.prepare('INSERT INTO settings(owner,secret,model,updated_at) VALUES(?,?,?,?) ON CONFLICT(owner) DO UPDATE SET secret=excluded.secret,model=excluded.model').run(owner,await server.encrypt(secret),model,now);
await settings(JSON.stringify({provider:'hermes',endpoint:'https://hermes.example.com',key:'mock-only'}),'HERMES');

// 합성 브랜드·캠페인·사실 원장·자료·지시. 실제 고객·매장 정보가 아니다.
const brand={id:'drift-brand',name:'가상분식',short:'GB',category:'SNACK BAR',color:'#224466',bg:'#eef2f6',description:'합성 브랜드 소개(미확인).',audience:'가상동 주민(가설)',tone:'친근하고 명료한',constraints:'가격은 확인 전 확정 문구로 쓰지 않는다.',knowledge:'합성 메모.'};
const campaign={id:'drift-campaign',brandId:brand.id,title:'가상분식 오픈',goal:'오픈 전 인지와 첫 포장 주문을 만든다.',audience:'가상동 주민(가설)',channels:'Instagram, 매장 안내',stores:'가상동 12',products:'떡볶이(가격 미확정)',budget:null,startDate:'',endDate:'',constraints:'할인 약속 금지.',sources:'',status:'draft',version:1,createdAt:now,updatedAt:now};
await put('brand',brand.id,brand);
await put('campaign',campaign.id,campaign);
const fact=(id,key,value,status)=>put('brand_fact',id,{id,brandId:brand.id,key,value,status,source:'합성 원장',verifiedAt:now,validUntil:'2099-12-31T00:00:00.000Z',version:1,updatedAt:now},brand.id);
await fact('fact-address','주소','가상동 12','confirmed');
await fact('fact-cooking','조리 방식','숯불','rejected');
await fact('fact-open','오픈일','10월 5일','candidate');
await put('brand_source','source-menu',{id:'source-menu',brandId:brand.id,title:'합성 메뉴 메모',category:'product',origin:'manual',status:'confirmed',url:'https://example.com/synthetic-menu',content:'합성 자료: 가격은 미정이다.',observedAt:now,createdAt:now,version:1,scope:'브랜드'},brand.id);
await put('campaign_directive','directive-1',{id:'directive-1',campaignId:campaign.id,text:'합성 지시: 날짜는 D-day 상대 일정으로 쓴다.',createdAt:now,createdBy:{id:'synthetic-member',email:null,role:'member'}},campaign.id);

// 기대값 계산용: role-execution.ts start 분기가 DB에서 읽는 값을 같은 규칙으로 따로 읽는다(독립 오라클).
async function request(campaignId,role){
 const c=await server.readRecord(owner,'campaign',campaignId),artifacts=await server.listRecords(owner,'artifact',c.id);
 const repair=artifacts.find(a=>a.role===role&&a.status!=='outdated'&&!roleOutput.artifactUsable(a,c.version));
 const latest=artifacts.filter(a=>a.role===role).reduce((l,a)=>String(a.createdAt)>l?String(a.createdAt):l,'');
 const lastFailure=(await server.listRecords(owner,'role_output_failure',c.id)).filter(f=>f.role===role&&f.campaignVersion===c.version&&f.createdAt>latest).sort((a,b)=>b.createdAt.localeCompare(a.createdAt))[0];
 const meeting=(await server.listRecords(owner,'team_meeting',c.id)).filter(m=>m.status==='completed'&&m.campaignVersion===c.version).sort((a,b)=>String(b.updatedAt||b.createdAt).localeCompare(String(a.updatedAt||a.createdAt)))[0];
 const synthesis=meeting?.steps.find(s=>s.phase==='synthesis')?.output;
 return {role,campaign:c,brand:await server.readRecord(owner,'brand',c.brandId),archive:await archiveServer.brandArchiveContext(owner,c.brandId,c.storeId),evidence:await aiContext.evidenceContext(server.database(),owner,c),learning:await learningServer.learningContext(owner,c),previous:artifacts.filter(a=>roleOutput.artifactUsable(a,c.version)),
  ...(meeting?{previousDecisions:{agenda:meeting.agenda.slice(0,1500),decisions:synthesis?.decisions||'',questions:synthesis?.questions||''}}:{}),
  ...(repair||lastFailure?{revisionRequest:{note:repair?.reviewNote||'',previousVersion:repair?.version??null,previousExcerpt:repair?.content.slice(0,2000)||'',lastFailure:lastFailure?.error||''}}:{})};
}
const start=async(campaignId,role,extra={})=>{const r=await (await execution.executeRole(owner,{action:'start',campaignId,role,...extra})).json();assert.ok(r.id,`${role} 시작 실패: ${JSON.stringify(r)}`);return r.id};
// 저장 계약(role_output_contract)의 계약 필드가 순수 함수의 산출물 계약과 같은지 본다. factRefs·idLabels·claimGuard는 저장 전용 필드다.
const contractOf=async id=>{const {version,role,sections,contextTruncated}=await server.readRecord(owner,'role_output_contract',id);return JSON.parse(JSON.stringify({version,role,sections,contextTruncated}))};
const drift='실행 경로 제출 본문이 lib/role-instruction.ts 출력과 다릅니다. role-execution.ts가 순수 함수 출력을 그대로 보내야 합니다.';
async function hermesCase(name,role,extra={}){
 const req=await request(campaign.id,role),id=await start(campaign.id,role,extra),saved=await server.readRecord(owner,'hermes_submission',id);
 const expected=JSON.stringify({instructions:instruction.buildRoleInstruction(req),input:instruction.buildRoleInput(req),session_id:saved.key,conversation_history:[]});
 check(`${name} stored HERMES body is byte-identical to pure builders`,()=>assert.equal(saved.body,expected,drift));
 check(`${name} HERMES receives the stored body unchanged`,()=>assert.equal(sent.get(sql.prepare('SELECT provider_id FROM jobs WHERE id=?').get(id).provider_id),saved.body));
 const stored=await contractOf(id);
 check(`${name} stored output contract matches the pure plan`,()=>assert.deepEqual(stored,JSON.parse(JSON.stringify(instruction.roleRequestPlan(req).outputContract)),drift));
 const polled=await (await execution.executeRole(owner,{action:'poll',id})).json();
 return {req,status:polled.status};
}

// 1) 8개 역할 순서 실행. 전략부터는 완료된 팀 회의 합의(previousDecisions)가 입력에 들어간다.
const statuses={};
for(const role of agency.roles.map(r=>r.id)){
 if(role==='strategy')await put('team_meeting','meeting-1',{id:'meeting-1',campaignId:campaign.id,campaignVersion:1,agenda:'합성 안건: 오픈 전 메시지 우선순위',status:'completed',steps:[{phase:'synthesis',output:{decisions:'합성 결정: 포장 동선을 먼저 알린다.',questions:'합성 질문: 오픈일 확정 시점'}}],createdAt:now,updatedAt:now,model:'mock',stopRequested:false,artifactIds:[],invalidatedRoles:[],snapshot:{}},campaign.id);
 const first=await hermesCase(role,role);statuses[role]=first.status;
 if(role==='cmo')check('cmo input has no meeting decisions or revision request',()=>assert.ok(!first.req.previousDecisions&&!first.req.revisionRequest));
 if(role==='strategy')check('strategy input carries meeting decisions',()=>assert.equal(JSON.parse(instruction.buildRoleInput(first.req)).previousDecisions.decisions,'합성 결정: 포장 동선을 먼저 알린다.'));
 // 2) 재질문 실패 뒤 같은 역할 재실행: 직전 실패 사유가 revisionRequest로 들어간다.
 if(first.status!=='completed'){const again=await hermesCase(role+'-revision',role);statuses[role+'-revision']=again.status;check(`${role}-revision carries last failure`,()=>assert.ok(again.req.revisionRequest?.lastFailure))}
}
check('all roles and the revision rerun completed',()=>assert.deepEqual(Object.entries(statuses).filter(([,s])=>s!=='completed').map(([n])=>n),['insight']));

// 3) 검토 메모가 있는 수정 요청(repair): 오래된 버전 확인은 공급자 호출 없이 거절하고, 최신 버전이면 메모·발췌가 입력에 들어간다.
const content=(await server.listRecords(owner,'artifact',campaign.id)).find(a=>a.role==='content'&&a.status==='review');
await put('artifact',content.id,{...content,status:'revision',reviewNote:'합성 검토 메모: 첫 장면을 더 구체적으로.'},campaign.id);
const before=calls,stale=await execution.executeRole(owner,{action:'start',campaignId:campaign.id,role:'content',repairId:content.id,repairVersion:content.version+1});
check('stale repair version is rejected before any provider call',()=>assert.ok(stale.status===409&&calls===before));
const repaired=await hermesCase('content-repair','content',{repairId:content.id,repairVersion:content.version});
check('content-repair carries review note and excerpt',()=>assert.ok(repaired.req.revisionRequest.note.includes('합성 검토 메모')&&repaired.req.revisionRequest.previousExcerpt));

// 4) OpenAI 분기: 같은 순수 함수 출력에 max_output_tokens·web_search(인사이트만)를 붙인 정확한 요청을 먼저 저장한다.
await settings('mock-openai-key','mock-openai-model');
for(const role of ['cmo','insight']){
 const id2=`drift-openai-${role}`;await put('campaign',id2,{...campaign,id:id2,status:'draft'});
 if(role==='insight')await put('artifact','openai-cmo',{id:'openai-cmo',campaignId:id2,campaignVersion:1,role:'cmo',title:'합성 CMO',content:'## 합성 CMO 초안\n\n포장 동선을 먼저 알리는 조건부 계획입니다.',version:1,status:'review',origin:'ai',createdAt:now},id2);
 const req=await request(id2,role),id=await start(id2,role),saved=await server.readRecord(owner,'openai_submission',id);
 const expected=JSON.stringify({model:'mock-openai-model',instructions:instruction.buildRoleInstruction(req),input:instruction.buildRoleInput(req),max_output_tokens:practice.practices[role].maxTokens,background:true,store:true,metadata:{agency_job_id:id},...(role==='insight'?{tools:[{type:'web_search'}]}:{})});
 check(`openai ${role} stored request is byte-identical to pure builders`,()=>assert.equal(saved.body,expected,drift));
 check(`openai ${role} web search only for insight`,()=>assert.equal(!!JSON.parse(saved.body).tools,role==='insight'));
}
check('no external network call',()=>assert.deepEqual(external,[]));
console.log(JSON.stringify({passed:passed.length}));
