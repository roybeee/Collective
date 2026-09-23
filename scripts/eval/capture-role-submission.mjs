// 기준 커밋의 lib/role-execution.ts가 HERMES에 보내는 instructions·input을 합성 캠페인으로 캡처한다.
// 모의 런타임(tests/helpers/runtime.mjs, 메모리 SQLite + HERMES fetch 스텁)만 쓴다. 외부 네트워크 호출은 0회다.
// 사용: node --experimental-vm-modules scripts/eval/capture-role-submission.mjs --sha <기준 커밋 SHA> --out <fixture 경로>
// 저장소 루트에서 실행한다(drizzle/ 마이그레이션을 상대 경로로 읽는다). 출력 fixture는 합성 데이터만 담는다.
import {writeFileSync} from 'node:fs';
import {testRuntime} from '../../tests/helpers/runtime.mjs';
import {roleFixture} from '../../tests/helpers/role-fixture.mjs';

const arg=name=>{const i=process.argv.indexOf(name);return i>0?process.argv[i+1]:undefined};
const sha=arg('--sha'),out=arg('--out');
if(!/^[0-9a-f]{40}$/.test(sha||'')||!out){process.stderr.write('사용법: --sha <40자리 기준 SHA> --out <fixture 경로>\n');process.exit(2)}

// 첫 인사이트 호출은 재질문(합성)으로 실패시켜 재작성 지시(revisionRequest) 분기까지 캡처한다.
const reask='이번 요청에서 수행할 작업이 명시되지 않았습니다. 다음 중 하나를 지정해 주세요.\n1. 초안 검수\n2. 전체 재작성\n번호 하나만 말씀해 주시면 됩니다.';
const bodies=new Map();let calls=0,reaskOnce=true;
const {sql,load}=testRuntime(async(url,options={})=>{
 if(!String(url).startsWith('https://hermes.example.com/'))throw new Error('캡처는 모의 HERMES 주소만 호출합니다: '+url);
 if(String(url).endsWith('/v1/runs')){const id='capture_'+ ++calls;bodies.set(id,JSON.parse(options.body));return Response.json({run_id:id})}
 const id=String(url).split('/').pop(),task=JSON.parse(bodies.get(id).input).task;
 const output=task?.role==='insight'&&reaskOnce?(reaskOnce=false,reask):roleFixture(bodies.get(id).input);
 return Response.json({object:'hermes.run',run_id:id,status:'completed',output,usage:{total_tokens:100,output_tokens:600},model:'mock-model'});
});
const server=await load('lib/server.ts'),execution=await load('lib/role-execution.ts'),roleOutput=await load('lib/role-output.ts');
const archiveServer=await load('lib/archive-server.ts'),aiContext=await load('lib/ai-context.ts'),learningServer=await load('lib/learning-server.ts'),agency=await load('lib/agency.ts');
const owner='eval-capture-owner',now='2026-01-01T00:00:00.000Z';
const put=(kind,id,data,parent='')=>server.recordStatement(owner,kind,id,data,parent).run();
sql.prepare('INSERT INTO settings(owner,secret,model,updated_at) VALUES(?,?,?,?)').run(owner,await server.encrypt(JSON.stringify({provider:'hermes',endpoint:'https://hermes.example.com',key:'mock-only'})),'HERMES',now);

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

// role-execution.ts start 분기가 DB에서 읽는 값과 같은 순서·함수로 입력 맥락을 기록한다.
async function context(role){
 const c=await server.readRecord(owner,'campaign',campaign.id),artifacts=await server.listRecords(owner,'artifact',c.id);
 const previous=artifacts.filter(a=>roleOutput.artifactUsable(a,c.version));
 const repair=artifacts.find(a=>a.role===role&&a.status!=='outdated'&&!roleOutput.artifactUsable(a,c.version));
 const latest=artifacts.filter(a=>a.role===role).reduce((l,a)=>String(a.createdAt)>l?String(a.createdAt):l,'');
 const lastFailure=(await server.listRecords(owner,'role_output_failure',c.id)).filter(f=>f.role===role&&f.campaignVersion===c.version&&f.createdAt>latest).sort((a,b)=>b.createdAt.localeCompare(a.createdAt))[0];
 const revisionRequest=repair||lastFailure?{note:repair?.reviewNote||'',previousVersion:repair?.version??null,previousExcerpt:repair?.content.slice(0,2000)||'',lastFailure:lastFailure?.error||''}:undefined;
 return {role,campaign:c,brand:await server.readRecord(owner,'brand',c.brandId),archive:await archiveServer.brandArchiveContext(owner,c.brandId,c.storeId),evidence:await aiContext.evidenceContext(server.database(),owner,c),learning:await learningServer.learningContext(owner,c),previous,...(revisionRequest?{revisionRequest}:{})};
}
async function run(role,name){
 const ctx=await context(role);
 const started=await (await execution.executeRole(owner,{action:'start',campaignId:campaign.id,role})).json();
 if(!started.id)throw new Error(`${role} 시작 실패: ${JSON.stringify(started)}`);
 const saved=JSON.parse((await server.readRecord(owner,'hermes_submission',started.id)).body);
 const polled=await (await execution.executeRole(owner,{action:'poll',id:started.id})).json();
 return {name,role,jobStatus:polled.status,context:ctx,submission:{instructions:saved.instructions,input:saved.input}};
}
const cases=[];
for(const role of agency.roles.map(r=>r.id)){
 const first=await run(role,role);cases.push(first);
 if(first.jobStatus!=='completed')cases.push(await run(role,role+'-revision'));
}
if(cases.some(c=>c.name.endsWith('-revision')&&c.jobStatus!=='completed')||!cases.some(c=>c.name==='insight-revision'))throw new Error('재작성 분기를 캡처하지 못했습니다.');
const fixture={baseSha:sha,capturedWith:'scripts/eval/capture-role-submission.mjs + tests/helpers/runtime.mjs (모의 HERMES fetch, 메모리 SQLite)',evidence:'mocked',data:'합성 데이터만 사용',providerCalls:{submitted:calls,external:0},cases:cases.map(c=>({name:c.name,role:c.role,context:c.context,submission:c.submission}))};
writeFileSync(out,JSON.stringify(fixture,null,1)+'\n');
process.stdout.write(JSON.stringify({captured:cases.map(c=>`${c.name}:${c.jobStatus}`),out})+'\n');
