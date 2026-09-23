// 기준 커밋의 lib/role-execution.ts가 HERMES·OpenAI에 보내는 instructions·input과 저장한 산출물 계약(role_output_contract)을 합성 캠페인으로 캡처한다.
// 모의 런타임(tests/helpers/runtime.mjs, 메모리 SQLite + HERMES·OpenAI fetch 스텁)만 쓴다. 외부 네트워크 호출은 0회다.
// 사용: node --experimental-vm-modules scripts/eval/capture-role-submission.mjs --sha <기준 커밋 SHA> --out <fixture 경로>
// 저장소 루트에서 실행한다(drizzle/ 마이그레이션을 상대 경로로 읽는다). 출력 fixture는 합성 데이터만 담는다.
// 케이스는 lib/role-instruction.ts의 분기를 모두 지난다: 8개 역할, 재질문 실패 뒤 재작성(insight·quality lastFailure), 검토 메모 보완(content·quality reviewNote),
// 팀 회의 합의(previousDecisions, strategy부터), 앞선 작업물 발췌(contextTruncated, 6000자·quality 24000자 초과), OpenAI 본문(cmo, insight).
import {writeFileSync} from 'node:fs';
import {testRuntime} from '../../tests/helpers/runtime.mjs';
import {roleFixture} from '../../tests/helpers/role-fixture.mjs';

const arg=name=>{const i=process.argv.indexOf(name);return i>0?process.argv[i+1]:undefined};
const sha=arg('--sha'),out=arg('--out');
if(!/^[0-9a-f]{40}$/.test(sha||'')||!out){process.stderr.write('사용법: --sha <40자리 기준 SHA> --out <fixture 경로>\n');process.exit(2)}

// 첫 인사이트·품질 호출은 재질문(합성)으로 실패시켜 재작성 지시(revisionRequest.lastFailure) 분기까지 캡처한다.
const reask='이번 요청에서 수행할 작업이 명시되지 않았습니다. 다음 중 하나를 지정해 주세요.\n1. 초안 검수\n2. 전체 재작성\n번호 하나만 말씀해 주시면 됩니다.';
const bodies=new Map(),reaskRoles=new Set(['insight','quality']),external=[];let calls=0;
const {sql,load}=testRuntime(async(url,options={})=>{
 url=String(url);
 if(url==='https://api.openai.com/v1/responses'){calls++;return Response.json({id:'resp_capture_'+calls,status:'queued',model:'mock-openai-model'})}
 if(!url.startsWith('https://hermes.example.com/')){external.push(url);throw new Error('캡처는 모의 HERMES·OpenAI 주소만 호출합니다: '+url)}
 if(url.endsWith('/v1/runs')){const id='capture_'+ ++calls;bodies.set(id,JSON.parse(options.body));return Response.json({run_id:id})}
 const id=url.split('/').pop(),task=JSON.parse(bodies.get(id).input).task;
 const output=reaskRoles.delete(task?.role)?reask:roleFixture(bodies.get(id).input);
 return Response.json({object:'hermes.run',run_id:id,status:'completed',output,usage:{total_tokens:100,output_tokens:600},model:'mock-model'});
});
const server=await load('lib/server.ts'),execution=await load('lib/role-execution.ts'),roleOutput=await load('lib/role-output.ts');
const archiveServer=await load('lib/archive-server.ts'),aiContext=await load('lib/ai-context.ts'),learningServer=await load('lib/learning-server.ts'),agency=await load('lib/agency.ts');
const owner='eval-capture-owner',now='2026-01-01T00:00:00.000Z';
const put=(kind,id,data,parent='')=>server.recordStatement(owner,kind,id,data,parent).run();
const settings=async(secret,model)=>sql.prepare('INSERT INTO settings(owner,secret,model,updated_at) VALUES(?,?,?,?) ON CONFLICT(owner) DO UPDATE SET secret=excluded.secret,model=excluded.model').run(owner,await server.encrypt(secret),model,now);
await settings(JSON.stringify({provider:'hermes',endpoint:'https://hermes.example.com',key:'mock-only'}),'HERMES');

// 합성 브랜드·캠페인·사실 원장·자료·지시. 실제 고객·매장 정보가 아니다.
const brand={id:'synthetic-bunsik',name:'가상분식',short:'GB',category:'SNACK BAR',color:'#224466',bg:'#eef2f6',description:'합성 브랜드 소개(미확인): 동네에서 포장해 가는 분식.',audience:'퇴근길에 빠르게 저녁을 포장하려는 가상동 주민(가설)',tone:'친근하고 명료한',constraints:'가격·메뉴는 확인 전 확정 문구로 쓰지 않는다.',knowledge:'합성 메모: 대표 메뉴와 조리 방식은 미확인.'};
const campaign={id:'synthetic-open-01',brandId:brand.id,title:'가상분식 가상동 오픈 캠페인',goal:'가상동 12 B동 201호 오픈 전 인지와 첫 포장 주문을 만든다. 오픈일·가격은 미확정이다.',audience:'가상동 주민과 인근 직장인(가설)',channels:'Instagram, 네이버 플레이스, 매장 안내',stores:'가상동 12 B동 201호',products:'떡볶이·김밥(가격 미확정)',budget:0,startDate:'',endDate:'',constraints:'숯불 표현 금지. 할인 약속 금지.',sources:'',status:'draft',version:1,createdAt:now,updatedAt:now};
await put('brand',brand.id,brand);
await put('campaign',campaign.id,campaign);
const fact=(id,key,value,status)=>put('brand_fact',id,{id,brandId:brand.id,key,value,status,source:'합성 원장',verifiedAt:now,validUntil:'2099-12-31T00:00:00.000Z',version:1,updatedAt:now},brand.id);
await fact('fact-address','주소','가상동 12 B동 201호','confirmed');
await fact('fact-cooking','조리 방식','숯불','rejected');
await fact('fact-open','오픈일','10월 5일','candidate');
await put('brand_source','source-menu',{id:'source-menu',brandId:brand.id,title:'합성 메뉴 메모',category:'product',origin:'manual',status:'confirmed',url:'https://example.com/synthetic-menu',content:'합성 자료: 떡볶이와 김밥을 준비 중이며 가격은 미정이다.',observedAt:now,createdAt:now,version:1,scope:'브랜드'},brand.id);
await put('campaign_directive','directive-1',{id:'directive-1',campaignId:campaign.id,text:'합성 지시: 오픈일이 확정되기 전에는 날짜를 D-day 상대 일정으로 쓴다.',createdAt:now,createdBy:{id:'synthetic-member',email:null,role:'member'}},campaign.id);
// 역할 실행 없이 넣는 앞선 작업물(사용 가능한 review 상태). length를 주면 합성 문장으로 그 길이까지 채운다.
const artifact=(campaignId,role,length=0)=>{const name=agency.roles.find(r=>r.id===role).name;return put('artifact',`seed-${campaignId}-${role}`,{id:`seed-${campaignId}-${role}`,campaignId,campaignVersion:1,role,title:`합성 ${name}`,content:`## 합성 ${name} 초안\n\n포장 동선을 먼저 알리는 조건부 계획입니다. 자료 필요: 운영 조건 확인.\n`.padEnd(length,'합성 장문: 오픈 전 확인 계획과 가설을 반복해 적은 문장입니다. '),version:1,status:'review',origin:'ai',createdAt:now},campaignId)};

// role-execution.ts start 분기가 DB에서 읽는 값과 같은 순서·함수로 입력 맥락을 기록한다.
async function context(campaignId,role){
 const c=await server.readRecord(owner,'campaign',campaignId),artifacts=await server.listRecords(owner,'artifact',c.id);
 const previous=artifacts.filter(a=>roleOutput.artifactUsable(a,c.version));
 const repair=artifacts.find(a=>a.role===role&&a.status!=='outdated'&&!roleOutput.artifactUsable(a,c.version));
 const latest=artifacts.filter(a=>a.role===role).reduce((l,a)=>String(a.createdAt)>l?String(a.createdAt):l,'');
 const lastFailure=(await server.listRecords(owner,'role_output_failure',c.id)).filter(f=>f.role===role&&f.campaignVersion===c.version&&f.createdAt>latest).sort((a,b)=>b.createdAt.localeCompare(a.createdAt))[0];
 const meeting=(await server.listRecords(owner,'team_meeting',c.id)).filter(m=>m.status==='completed'&&m.campaignVersion===c.version).sort((a,b)=>String(b.updatedAt||b.createdAt).localeCompare(String(a.updatedAt||a.createdAt)))[0],synthesis=meeting?.steps.find(s=>s.phase==='synthesis')?.output;
 const previousDecisions=meeting?{agenda:meeting.agenda.slice(0,1500),decisions:synthesis?.decisions||'',questions:synthesis?.questions||''}:undefined;
 const revisionRequest=repair||lastFailure?{note:repair?.reviewNote||'',previousVersion:repair?.version??null,previousExcerpt:repair?.content.slice(0,2000)||'',lastFailure:lastFailure?.error||''}:undefined;
 return {role,campaign:c,brand:await server.readRecord(owner,'brand',c.brandId),archive:await archiveServer.brandArchiveContext(owner,c.brandId,c.storeId),evidence:await aiContext.evidenceContext(server.database(),owner,c),learning:await learningServer.learningContext(owner,c),previous,...(previousDecisions?{previousDecisions}:{}),...(revisionRequest?{revisionRequest}:{})};
}
// HERMES는 저장 본문(hermes_submission)을 캡처하고 결과를 조회해 다음 역할로 넘어간다. OpenAI는 요청 본문(openai_submission)만 캡처하고 조회하지 않는다.
async function run(name,role,{campaignId=campaign.id,extra={},provider='hermes'}={}){
 const ctx=await context(campaignId,role);
 const started=await (await execution.executeRole(owner,{action:'start',campaignId,role,...extra})).json();
 if(!started.id)throw new Error(`${name} 시작 실패: ${JSON.stringify(started)}`);
 const saved=JSON.parse((await server.readRecord(owner,provider==='hermes'?'hermes_submission':'openai_submission',started.id)).body);
 const stored=await server.readRecord(owner,'role_output_contract',started.id);
 const jobStatus=provider==='hermes'?(await (await execution.executeRole(owner,{action:'poll',id:started.id})).json()).status:'submitted';
 return {name,role,provider,jobStatus,context:ctx,submission:{instructions:saved.instructions,input:saved.input},contract:{version:stored.version,role:stored.role,sections:stored.sections,contextTruncated:stored.contextTruncated}};
}
const cases=[];
// 1) 8개 역할 순서 실행. strategy 직전에 완료된 팀 회의를 넣어 strategy부터 previousDecisions가 들어간다. 재질문으로 실패한 역할은 한 번 더 실행한다(-revision).
for(const role of agency.roles.map(r=>r.id)){
 if(role==='strategy')await put('team_meeting','meeting-1',{id:'meeting-1',campaignId:campaign.id,campaignVersion:1,agenda:'합성 안건: 오픈 전 메시지 우선순위',status:'completed',steps:[{phase:'synthesis',output:{decisions:'합성 결정: 포장 동선을 먼저 알린다.',questions:'합성 질문: 오픈일 확정 시점'}}],createdAt:now,updatedAt:now,model:'mock',stopRequested:false,artifactIds:[],invalidatedRoles:[],snapshot:{}},campaign.id);
 const first=await run(role,role);cases.push(first);
 if(first.jobStatus!=='completed')cases.push(await run(role+'-revision',role));
}
// 2) 검토 메모 보완(repair): 수정 요청한 작업물의 메모·발췌가 revisionRequest로 들어간다. content 보완이 끝나면 뒤 역할 작업물이 outdated가 되므로 quality를 먼저 한다.
for(const role of ['quality','content']){
 const a=(await server.listRecords(owner,'artifact',campaign.id)).find(a=>a.role===role&&a.status==='review');
 await put('artifact',a.id,{...a,status:'revision',reviewNote:`합성 검토 메모: ${role} 초안의 확인 계획을 더 구체적으로.`},campaign.id);
 cases.push(await run(role+'-repair',role,{extra:{repairId:a.id,repairVersion:a.version}}));
}
// 3) 앞선 작업물 발췌(contextTruncated): cmo는 6000자와 24000자 사이라 strategy에서만 발췌되고, insight는 두 한도를 모두 넘는다.
// 역할 완료가 뒤 역할 작업물을 outdated로 만들므로 캠페인을 나눠 앞선 작업물을 직접 넣는다.
for(const role of ['strategy','quality']){
 const id=`synthetic-long-${role}`;await put('campaign',id,{...campaign,id,title:campaign.title+' (긴 작업물)'});
 for(const prior of agency.roles.slice(0,agency.roles.findIndex(r=>r.id===role)))await artifact(id,prior.id,{cmo:6100,insight:24100}[prior.id]);
 cases.push(await run(role+'-truncated',role,{campaignId:id}));
}
// 4) OpenAI 본문: 같은 지시·입력에 max_output_tokens·web_search(insight만)를 붙인 요청을 먼저 저장한다.
await settings('mock-openai-key','mock-openai-model');
for(const role of ['cmo','insight']){
 const id=`synthetic-openai-${role}`;await put('campaign',id,{...campaign,id});
 if(role==='insight')await artifact(id,'cmo');
 cases.push(await run('openai-'+role,role,{campaignId:id,provider:'openai'}));
}
const failed=cases.filter(c=>c.provider==='hermes'&&c.jobStatus!=='completed').map(c=>c.name).join();
if(failed!=='insight,quality'||!['insight-revision','quality-revision'].every(n=>cases.some(c=>c.name===n)))throw new Error('재작성 분기를 캡처하지 못했습니다: '+failed);
if(external.length)throw new Error('외부 호출이 있었습니다: '+external.join());
const fixture={baseSha:sha,capturedWith:'scripts/eval/capture-role-submission.mjs + tests/helpers/runtime.mjs (모의 HERMES·OpenAI fetch, 메모리 SQLite)',evidence:'mocked',data:'합성 데이터만 사용',providerCalls:{submitted:calls,external:external.length},cases:cases.map(c=>({name:c.name,role:c.role,provider:c.provider,context:c.context,submission:c.submission,contract:c.contract}))};
writeFileSync(out,JSON.stringify(fixture,null,1)+'\n');
process.stdout.write(JSON.stringify({captured:cases.map(c=>`${c.name}:${c.jobStatus}`),out})+'\n');
