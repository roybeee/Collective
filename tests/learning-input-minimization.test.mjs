// 입력 최소화 레인 A 후속(docs/DATA-PROCESSING.ko.md 4.4 ⑤⑧): 바이럴 학습 경로(규칙 초안·분석·발견)의 HERMES 제출 본문과 지시문을 고정한다.
// ⑤ 학습의 브랜드 입력은 정체성 7필드(researchBrand, 공식 주소 없음)만이다. 소개·메모·의뢰 정보(웹사이트·SNS·시장·의뢰 목적·경쟁사)는 빠지고 입력 키 이름 brand는 그대로다.
// ⑧ 작성자 식별정보 금지 문장(authorPrivacy)과 사례 게시 계정 한정 문장(caseAccountRule)은 코드가 붙이는 바이럴 발견(L2) 지시에만 있어, 레지스트리 본문(viral.discovery)을 활성화해도 빠지지 않는다. 사례 분석(L1)·규칙 초안(L3) 지시에는 넣지 않는다(병합된 계획대로 L2만, 외부 콘텐츠를 수집하지 않음).
// 근거: mocked(모의 HERMES·raw.githubusercontent.com fetch 스텁, 메모리 SQLite, 합성 브랜드). 외부 네트워크·유료 모델 호출은 0회다.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {testRuntime} from './helpers/runtime.mjs';
import {rawGithub,setRelease,SOURCE_SHA} from './helpers/prompt-seed.mjs';

const HERMES='https://hermes.example.com',raw=rawGithub(),posts=[],external=[];let seq=0;
const {sql,load}=testRuntime(async(url,options={})=>{
 url=String(url);const mocked=await raw.handler(url);if(mocked)return mocked;
 if(!url.startsWith(HERMES+'/')){external.push(url);throw new Error('모의 주소만 호출합니다: '+url)}
 if(url===HERMES+'/v1/runs'&&options.method==='POST'){const body=JSON.parse(options.body);posts.push({instructions:body.instructions,input:body.input});return Response.json({run_id:'run_'+ ++seq})}
 return new Response('{}',{status:404});
});
const server=await load('lib/server.ts'),learning=await load('lib/learning-execution.ts'),stages=await load('lib/archive-research.ts'),practice=await load('lib/practice.ts'),route=await load('app/api/prompts/route.ts');
let passed=0;const check=(name,condition)=>{assert.ok(condition,name);passed++};
const now='2026-01-01T00:00:00.000Z',owner='lim-owner',PRIVACY=stages.authorPrivacy,ACCOUNT=learning.caseAccountRule;
// 합성 브랜드. 자유 텍스트·의뢰 정보 칸마다 고유 문장을 넣어 제출 본문에서 찾는다. 실제 고객·매장 정보가 아니다.
const secret={intro:'비밀소개문장-7Q',memo:'비밀메모문장-7Q',website:'lim-secret-7q.example.com',social:'instagram.com/lim_secret_7q',socialNote:'비밀채널메모-7Q',market:'비밀시장문장-7Q',need:'비밀의뢰문장-7Q',competitors:'비밀경쟁문장-7Q'};
const brand={id:'lim-brand',name:'가상학습분식',short:'LB',category:'SNACK BAR',color:'#335577',bg:'#eef2f6',description:secret.intro,audience:'가상동 직장인(가설)',tone:'차분하고 명료한',constraints:'효과를 단정하지 않는다.',knowledge:secret.memo,
 intake:{website:`https://${secret.website}/`,socialLinks:`공식 인스타 https://www.${secret.social} ${secret.socialNote}`,market:secret.market,clientNeed:secret.need,competitors:secret.competitors}};
const identity={name:brand.name,short:brand.short,category:brand.category,color:brand.color,tone:brand.tone,audience:brand.audience,constraints:brand.constraints};
const leaks=text=>Object.values(secret).filter(s=>text.includes(s));
const count=(text,part)=>text.split(part).length-1;
const sameIdentity=b=>JSON.stringify(Object.keys(b).sort())===JSON.stringify(Object.keys(identity).sort())&&Object.entries(identity).every(([k,v])=>b[k]===v);
const put=(kind,id,data,parent)=>server.recordStatement(owner,kind,id,data,parent).run();
await server.database().prepare('INSERT INTO settings(owner,secret,model,updated_at) VALUES(?,?,?,?)').bind(owner,await server.encrypt(JSON.stringify({provider:'hermes',endpoint:HERMES,key:'mock-only'})),'HERMES',now).run();
await put('brand',brand.id,brand);
const viralCase={id:'lim-case',brandId:brand.id,title:'합성 사례',channel:'YouTube',url:'https://example.com/lim-case',account:'합성 공식 계정',publishedAt:'',observedAt:now,scope:'합성 관찰 범위',observations:'합성 관찰 기록',transcript:'',views:null,baselineViews:null,comparison:'',createdAt:now,origin:'manual'};
await put('viral_case',viralCase.id,viralCase,brand.id);
await put('case_observation','lim-obs',{...viralCase,id:'lim-obs',caseId:viralCase.id,observations:'합성 재관찰 기록'},viralCase.id);
await put('viral_experiment','lim-exp',{id:'lim-exp',brandId:brand.id,campaignId:'lim-campaign',caseId:viralCase.id,analysisId:'a',title:'합성 실험',channel:'YouTube',hypothesis:'합성 가설',variable:'첫 장면',control:'대조',treatment:'실험',metric:'share_rate',minSample:100,minHours:24,minLift:10,conditions:'합성 조건',version:1,status:'evaluated',startedAt:now,createdAt:now,updatedAt:now,result:null,assessment:{status:'promising',label:'관찰상 개선',controlRate:0.01,treatmentRate:0.02,lift:100,reasons:[]}},'lim-campaign');
const start=async b=>{const r=await (await learning.executeLearning(owner,b)).json();assert.ok(r.id&&r.status==='queued',JSON.stringify(r));return {id:r.id,sent:posts.at(-1)}};
const stored=async id=>JSON.parse((await server.readRecord(owner,'hermes_submission',id)).body);

// ⑤ 세 경로의 제출 본문: 브랜드는 정체성 7필드만, 과업 입력(실험·사례·관찰·조사 주제)은 그대로다. 저장된 제출 본문(recover가 다시 보내는 원문)도 같다.
const guidance=await start({action:'start_guidance',experimentId:'lim-exp',version:1});
const analysis=await start({action:'start_analysis',caseId:viralCase.id});
const discovery=await start({action:'start_discovery',brandId:brand.id,query:'합성 조사 주제'});
for(const [name,{id,sent}] of Object.entries({guidance,analysis,discovery})){
 const input=JSON.parse(sent.input),saved=await stored(id);
 check(`${name} submission carries no brand intro, memo, intake text or official links`,leaks(sent.input).length===0);
 check(`${name} brand input keeps the brand key with the seven identity fields only`,sameIdentity(input.brand));
 check(`${name} stored submission body sent on recovery is the same minimized body`,saved.input===sent.input&&leaks(JSON.stringify(saved)).length===0);
}
{
 const g=JSON.parse(guidance.sent.input),a=JSON.parse(analysis.sent.input),d=JSON.parse(discovery.sent.input);
 check('guidance input still carries the experiment design and assessment',g.experiment.title==='합성 실험'&&g.experiment.variable==='첫 장면'&&g.assessment.status==='promising'&&'result' in g);
 check('analysis input still carries the case and its observations',a.case.id===viralCase.id&&a.observations.length===1&&a.observations[0].observations==='합성 재관찰 기록');
 check('discovery input still carries the query and request time',d.query==='합성 조사 주제'&&typeof d.requestedAt==='string');
}

// ⑧ 바이럴 발견(L2) 지시에 작성자 식별정보 금지 문장과 사례 게시 계정 한정 문장이 한 번씩, 민감정보 금지 바로 뒤에 있다. 발견 스키마의 account 요구와 한정 문장이 함께 있어야 두 지시가 충돌하지 않는다.
check('the case-account rule limits cases.account to the posting account and excludes commenters, reviewers and people shown',typeof ACCOUNT==='string'&&ACCOUNT.includes('account')&&ACCOUNT.includes('댓글·리뷰 작성자')&&ACCOUNT.includes('등장하는 개인'));
check('discovery instructions carry the author-privacy rule exactly once',count(discovery.sent.instructions,PRIVACY)===1);
check('discovery instructions carry the case-account rule exactly once',count(discovery.sent.instructions,ACCOUNT)===1);
check('discovery rules follow the sensitive-data rule in order',discovery.sent.instructions.includes('개인의 민감한 정보를 수집하지 마세요. '+PRIVACY+' '+ACCOUNT+' 조회수만으로'));
check('discovery schema still asks for the case account the rule allows',discovery.sent.instructions.includes('cases:[{title,channel,url,account,'));
// 사례 분석(L1)·규칙 초안(L3) 지시에는 두 문장이 없다. 분석 지시는 이 PR 전과 같은 자리(민감정보 금지 → 조회수)를 유지한다.
for(const [name,{sent}] of Object.entries({analysis,guidance}))check(`${name} instructions carry neither the author-privacy nor the case-account rule`,!sent.instructions.includes(PRIVACY)&&!sent.instructions.includes(ACCOUNT)&&!sent.instructions.includes('작성자의 이름·닉네임'));
check('analysis instructions keep the sensitive-data rule directly before the view-count rule',analysis.sent.instructions.includes('개인의 민감한 정보를 수집하지 마세요. 조회수만으로'));
check('the rules live in code, not in the registry body or its code fallback',[PRIVACY,ACCOUNT].every(rule=>!practice.viralPractice.includes(rule)&&!JSON.parse(readFileSync('prompts/viral.discovery.json','utf8')).body.includes(rule))&&discovery.sent.instructions.startsWith(practice.viralPractice+'\n'));

// ⑧ 레지스트리 본문을 다른 버전으로 활성화해도 코드가 붙이는 문장은 남는다.
{
 const body=JSON.parse(readFileSync('prompts/viral.discovery.json','utf8')).body+' 합성 개선 초점: 비교 사례의 첫 장면 차이를 먼저 적으세요.';
 raw.publish(SOURCE_SHA,'viral.discovery',body);raw.publish('main','viral.discovery',body);
 const res=await route.POST(new Request('https://agency.test/api/prompts',{method:'POST',headers:{'oai-authenticated-user-id':owner,'content-type':'application/json'},body:JSON.stringify({action:'register',unit:'viral.discovery',sourceSha:SOURCE_SHA})})),reg=await res.json();
 check('a different viral.discovery body registers',res.status===200&&typeof reg.version?.id==='string');
 await setRelease(server,owner,'viral.discovery',reg.version.id);
 sql.prepare("UPDATE jobs SET status='completed' WHERE owner=?").run(owner);
 const next=await start({action:'start_discovery',brandId:brand.id,query:'합성 조사 주제 2'}),task=await server.readRecord(owner,'learning_task',next.id);
 check('the registry body is in use for the new discovery',task.promptSource==='registry'&&task.promptVersion===reg.version.id&&next.sent.instructions.startsWith(body+'\n'));
 check('the registry-run instructions still carry the author-privacy and case-account rules exactly once',count(next.sent.instructions,PRIVACY)===1&&count(next.sent.instructions,ACCOUNT)===1);
 check('the registry-run submission carries the identity fields only',leaks(next.sent.input).length===0&&sameIdentity(JSON.parse(next.sent.input).brand));
}

// 저장 기록은 그대로다: 브랜드 레코드는 소개·메모·의뢰 정보를 유지한다(모델 입력에서만 뺀다).
{
 const b=await server.readRecord(owner,'brand',brand.id);
 check('the stored brand record keeps its intro, memo and intake',b.description===secret.intro&&b.knowledge===secret.memo&&b.intake.clientNeed===secret.need&&b.intake.website===brand.intake.website);
}
check('no external call was made',external.length===0&&posts.length===4);
console.log(JSON.stringify({passed}));
