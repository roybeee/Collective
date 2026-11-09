// G5 GEO 자동 추적(lib/geo-questions.ts·lib/geo-observation.ts·lib/geo-report.ts·lib/geo-run-server.ts·app/api/geo/route.ts·예약 종류 geo_weekly).
// 확인: 시작 질문은 확정 사실·브랜드 이름·업종에서만, 응답 스키마 검사(지어낸 키·빠진 키·자기모순·목록 밖 경쟁 브랜드·시각 범위), login_required 경로, 관찰 저장,
// 보고서 계산(점유율·인용률·주간 변화·도메인) 고정 입력, 백로그 규칙, 예산 예약·초과 409, 자율성 금지 403·전역 중단 409, 스위치 꺼짐 409, 직원 403, 멱등·중복 측정 409·중지, 예약 짝 규칙.
// 근거: mocked(메모리 SQLite, 이메일 모드 세션 주입, HERMES fetch 스텁). 실제 HERMES 브라우저 실행은 not_run.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {testRuntime} from './helpers/runtime.mjs';

const hermes={bodies:[],runs:new Map(),seq:0,modeFor:()=>'good'};
const answer=(sent,mode)=>{
 const input=JSON.parse(sent.input),base={schema:'geo-observation-1',engine:input.engine,question:input.question,observedAt:new Date().toISOString(),pageUrl:'https://www.perplexity.ai/search?q=x',note:''};
 if(mode==='login')return {...base,status:'login_required',pageUrl:'https://chatgpt.com/',answerExcerpt:'',citations:[],brandMentioned:null,competitorsMentioned:[]};
 const good={...base,status:'observed',answerExcerpt:'휘경동에서는 엽떡과 판떡이 자주 추천됩니다. 판떡은 로제 떡볶이가 대표입니다.',citations:[{url:'https://pantteok.example.kr/menu',title:'판떡 메뉴'},{url:'https://blog.example.com/a',title:'후기'}],brandMentioned:true,competitorsMentioned:['엽떡']};
 if(mode==='invented')return {...good,rating:5};
 if(mode==='gap')return {...good,answerExcerpt:'휘경동은 엽떡이 유명합니다.',citations:[{url:'https://blog.example.com/b',title:'후기'}],brandMentioned:false};
 return good;
};
const rt=testRuntime(async(url,init={})=>{
 url=String(url);
 if(!url.startsWith('https://hermes.example.com/'))throw new Error('모의 주소만: '+url);
 if(url.endsWith('/v1/runs')&&init.method==='POST'){const id='geo_'+ ++hermes.seq,sent=JSON.parse(String(init.body));hermes.bodies.push(sent);hermes.runs.set(id,sent);return Response.json({run_id:id})}
 const id=url.replace(/\/stop$/,'').split('/').pop(),sent=hermes.runs.get(id);
 if(url.endsWith('/stop'))return Response.json({object:'hermes.run',run_id:id,status:'cancelled',usage:{total_tokens:1}});
 const input=JSON.parse(sent.input),mode=hermes.modeFor(input.engine,input.question);
 if(mode==='slow')return Response.json({object:'hermes.run',run_id:id,status:'running'});
 return Response.json({object:'hermes.run',run_id:id,status:'completed',output:'```json\n'+JSON.stringify(answer(sent,mode))+'\n```',usage:{total_tokens:20000},model:'mock-model'});
});
const {sql,env,load}=rt;
env.AUTH_MODE='email';env.AUTH_ORIGIN='https://agency.test';
const server=await load('lib/server.ts'),route=await load('app/api/geo/route.ts'),flags=await load('lib/feature-flags.ts'),budget=await load('lib/token-budget.ts');
const qs=await load('lib/geo-questions.ts'),ob=await load('lib/geo-observation.ts'),rep=await load('lib/geo-report.ts'),geo=await load('lib/geo-run-server.ts'),sched=await load('lib/scheduled-runs.ts');
const passed=[];const check=(name,value)=>{assert.ok(value,name);passed.push(name)};
const plain=v=>JSON.parse(JSON.stringify(v));
const WS='geo-owner',BRAND='geo-brand',CAMPAIGN='geo-campaign';
const far=()=>Date.now()+100*365*86400000;
const signIn=(id,role)=>{const token=createHash('sha256').update('geo-session:'+id).digest('hex');sql.prepare('INSERT INTO auth_users(id,email,workspace_owner,role,status,created_at) VALUES(?,?,?,?,?,?)').run(id,id+'@test.invalid',WS,role,'active',1000);sql.prepare('INSERT INTO auth_sessions VALUES(?,?,?,?)').run(createHash('sha256').update(token).digest('hex'),id,far(),Date.now());return {cookie:'__Host-collective_session='+token,origin:'https://agency.test'}};
const boss=signIn('geo-boss','admin'),member=signIn('geo-member','member');
const call=async res=>({status:res.status,body:await res.json()});
const post=(session,input)=>route.POST(new Request('https://agency.test/api/geo',{method:'POST',headers:{'content-type':'application/json',...session},body:JSON.stringify({campaignId:CAMPAIGN,...input})})).then(call);
const get=session=>route.GET(new Request('https://agency.test/api/geo?campaignId='+CAMPAIGN,{headers:session})).then(call);
const by={id:'geo-boss',email:null};
const rows=kind=>sql.prepare('SELECT data FROM records WHERE owner=? AND kind=?').all(WS,kind).map(r=>JSON.parse(r.data));
const bad=(fn)=>{try{fn();return ''}catch(e){return e.message}};

// ── 1) 시작 질문: 확정 사실에서만 ──
const F=(id,key,value)=>({id,key,value});
const facts=[F('f-addr','address','서울특별시 동대문구 휘경동 123-4'),F('f-menu','signature_menu','로제 떡볶이, 순대'),F('f-hours','hours','11:00~21:00')];
const starters=plain(qs.starterQuestions({brandName:'판떡',category:'떡볶이',facts}));
check('starters are deterministic and at most 10',starters.length<=10&&JSON.stringify(starters)===JSON.stringify(plain(qs.starterQuestions({brandName:'판떡',category:'떡볶이',facts}))));
check('area comes from the confirmed address (dong level)',qs.areaFromAddress('서울특별시 동대문구 휘경동 123-4')==='휘경동'&&qs.areaFromAddress('부산광역시 해운대구 456')==='해운대구'&&qs.areaFromAddress('123')==='');
check('templates use only area, category, menu and brand facts',starters.some(s=>s.text==='휘경동 떡볶이 추천'&&s.basis.includes('f-addr')&&s.basis.includes('brand.category'))&&starters.some(s=>s.text==='로제 떡볶이 맛집'&&s.basis.includes('f-menu'))&&starters.some(s=>s.text==='판떡 영업시간'));
check('no parking question without a parking fact',!starters.some(s=>/주차/.test(s.text)));
const bare=plain(qs.starterQuestions({brandName:'판떡',category:'',facts:[]}));
check('without facts only brand-name templates remain (no invented area or menu)',bare.length>0&&bare.every(s=>s.intent==='brand'&&s.text.startsWith('판떡')&&!/위치|대표 메뉴|주차/.test(s.text)));
check('nothing at all without a brand name, category or facts',qs.starterQuestions({brandName:'',category:'',facts:[]}).length===0);
check('pending starters skip existing questions (normalised)',!qs.pendingStarters({brandName:'판떡',category:'떡볶이',facts},[{text:' 휘경동  떡볶이 추천'}]).some(s=>s.text==='휘경동 떡볶이 추천'));
const qi={text:'판떡 영업시간',locale:'ko',intent:'brand',engines:['naver','chatgpt'],active:true};
check('question input parses and orders engines canonically',JSON.stringify(plain(qs.parseGeoQuestionInput(qi)).engines)==='["chatgpt","naver"]');
check('question input rejects empty text, unknown engine, locale, PII',/1~200자/.test(bad(()=>qs.parseGeoQuestionInput({...qi,text:' '})))&&/서비스/.test(bad(()=>qs.parseGeoQuestionInput({...qi,engines:['bing']})))&&/언어/.test(bad(()=>qs.parseGeoQuestionInput({...qi,locale:'fr'})))&&/식별정보/.test(bad(()=>qs.parseGeoQuestionInput({...qi,text:'010-1234-5678 맛집'}))));

// ── 2) 응답 스키마 검사 ──
const target={brandName:'판떡',officialUrls:['https://pantteok.example.kr','https://map.naver.com/p/entry/place/1234'],competitors:['엽떡','신전떡볶이']};
const t0=Date.now();
const ctx={engine:'perplexity',question:'휘경동 떡볶이 추천',target,notBefore:t0-1000,now:t0+1000};
const resp=(over={})=>JSON.stringify({schema:'geo-observation-1',engine:'perplexity',question:'휘경동 떡볶이 추천',status:'observed',observedAt:new Date(t0).toISOString(),pageUrl:'https://www.perplexity.ai/search?q=x',answerExcerpt:'엽떡도 있지만 판떡이 좋습니다.',citations:[{url:'https://www.pantteok.example.kr/about',title:'공식'},{url:'https://map.naver.com/p/entry/place/9999',title:'다른 가게'}],brandMentioned:true,competitorsMentioned:['엽떡'],note:'',...over});
const p1=plain(ob.parseGeoResponse(resp(),ctx));
check('a valid response is parsed with computed citation and rank',p1.status==='observed'&&p1.brandCited===true&&p1.citations[0].brand===true&&p1.citations[1].brand===false&&p1.firstMentionRank===2&&p1.competitorsMentioned[0]==='엽떡');
check('place URLs match by path, not the whole platform domain',ob.isOfficialUrl('https://map.naver.com/p/entry/place/1234?c=1',ob.officialMatchers(target.officialUrls))&&!ob.isOfficialUrl('https://map.naver.com/p/entry/place/12345',ob.officialMatchers(target.officialUrls)));
const rejects=(name,text,re)=>check(name,re.test(bad(()=>ob.parseGeoResponse(text,ctx))));
rejects('an invented key is rejected',resp({score:9}),/정해지지 않은 키/);
rejects('a missing key is rejected',JSON.stringify(Object.fromEntries(Object.entries(JSON.parse(resp())).filter(([k])=>k!=='citations'))),/필수 키가 빠졌습니다: citations/);
rejects('brandMentioned false while the excerpt names the brand is rejected',resp({brandMentioned:false}),/brandMentioned가 false/);
rejects('a competitor outside the list is rejected',resp({competitorsMentioned:['지어낸집']}),/경쟁 브랜드 목록에 없습니다/);
rejects('an excerpt over 1,500 characters is rejected',resp({answerExcerpt:'가'.repeat(1501)}),/1500자/);
rejects('an observedAt outside the run window is rejected',resp({observedAt:'2020-01-01T00:00:00.000Z'}),/observedAt/);
rejects('another engine or question is rejected',resp({engine:'gemini'}),/엔진/);
rejects('prose without JSON is rejected','답변을 찾았습니다.',/JSON 객체가 없습니다/);
rejects('login_required with an excerpt is rejected',resp({status:'login_required'}),/관찰하지 못한 응답/);
const login=plain(ob.parseGeoResponse(resp({status:'login_required',pageUrl:'https://chatgpt.com/',answerExcerpt:'',citations:[],brandMentioned:null,competitorsMentioned:[]}),ctx));
check('login_required is kept with null values (not guessed)',login.status==='login_required'&&login.brandMentioned===null&&login.brandCited===null&&login.answerExcerpt===''&&login.citations.length===0);
const sub=ob.geoSubmission(target,'휘경동 떡볶이 추천','naver');
check('the instruction opens one public page, forbids login and asks verbatim 1,500 chars',/search\.naver\.com\/search\.naver\?query=/.test(sub.instructions)&&/로그인하지 말고/.test(sub.instructions)&&/1500자/.test(sub.instructions)&&JSON.stringify(Object.keys(JSON.parse(sub.input)))==='["engine","question","brandName","competitors"]');
const tg=plain(ob.geoTarget({name:'판떡',intake:{website:'https://pantteok.example.kr',socialLinks:'인스타 https://instagram.com/pantteok',competitors:'엽떡, 신전떡볶이\n'}},['https://map.naver.com/p/entry/place/1234','11:00~21:00']));
check('target collects official URLs from intake and fact values only',tg.officialUrls.length===3&&JSON.stringify(tg.competitors)==='["엽떡","신전떡볶이"]');

// ── 3) 보고서 계산(고정 입력) ──
const o=(questionId,engine,observedAt,over={})=>({questionId,engine,observedAt,status:'observed',brandMentioned:true,brandCited:false,competitorsMentioned:[],citations:[],...over});
const W1='2026-11-02T03:00:00.000Z',W2='2026-11-09T03:00:00.000Z';// KST 월요일 12시
const fixture=[o('q1','perplexity',W1,{brandMentioned:false}),o('q2','perplexity',W1),
 o('q1','perplexity',W2,{brandCited:true,citations:[{url:'https://pantteok.example.kr',title:'',domain:'pantteok.example.kr',brand:true},{url:'https://blog.example.com',title:'',domain:'blog.example.com',brand:false}]}),
 o('q1','perplexity','2026-11-08T14:00:00.000Z',{brandMentioned:false}),// KST 11-08 23시 = 지난주
 o('q2','perplexity',W2,{brandMentioned:false,competitorsMentioned:['엽떡'],citations:[{url:'https://blog.example.com/x',title:'',domain:'blog.example.com',brand:false}]}),
 o('q2','naver',W2,{status:'login_required',brandMentioned:null,brandCited:null}),o('q1','naver',W2,{brandMentioned:true,brandCited:false})];
const report=plain(rep.geoReport({questions:[{id:'q1',text:'판떡 영업시간'},{id:'q2',text:'휘경동 떡볶이 추천'}],observations:fixture,site:{jsonLd:'unknown',llmsTxt:'absent'}}));
const px=report.engines.find(e=>e.engine==='perplexity'),nv=report.engines.find(e=>e.engine==='naver');
check('weeks start on Monday KST',rep.weekOfKst('2026-11-08T14:00:00.000Z')==='2026-11-02'&&rep.weekOfKst(W2)==='2026-11-09'&&report.week==='2026-11-09'&&report.previousWeek==='2026-11-02');
check('share of voice and citation rate use the latest observation per question×engine',px.observed===2&&px.mentions===1&&px.shareOfVoice===0.5&&px.cited===1&&px.citationRate===0.5);
check('last week uses its own latest rows (q1 late Sunday overrides Monday)',px.previous.observed===2&&px.previous.mentions===1&&px.previous.shareOfVoice===0.5);
check('week-over-week change is a difference of rates',px.change.shareOfVoice===0&&px.change.citationRate===0.5);
check('login_required is excluded from the denominator and counted separately',nv.observed===1&&nv.notObserved===1&&nv.shareOfVoice===1&&nv.citationRate===0&&nv.previous===null&&nv.change.shareOfVoice===null);
check('top cited domains count this week',JSON.stringify(report.topDomains)==='[{"domain":"blog.example.com","count":2,"brand":false},{"domain":"pantteok.example.kr","count":1,"brand":true}]');
const kinds=report.backlog.map(b=>b.kind);
check('backlog: competitor gap suggests an answer section for that question',report.backlog.some(b=>b.kind==='competitor_gap'&&b.questionId==='q2'&&/공식 페이지에 '휘경동 떡볶이 추천' 답변 섹션 추가/.test(b.text)&&/엽떡/.test(b.text)));
check('backlog: mentioned but not cited, login, JSON-LD and llms.txt rules',kinds.includes('mention_without_citation')&&kinds.includes('login_required')&&report.backlog.find(b=>b.kind==='json_ld').link==='json_ld_generator'&&report.backlog.find(b=>b.kind==='llms_txt').link==='llms_txt_template');
check('backlog: present site checks drop their items',!plain(rep.geoBacklog([],[],{jsonLd:'present',llmsTxt:'present'})).length);
check('report carries the observation label and no guarantee',report.label==='관찰 기록 · 노출 보장 아님'&&report.exposureGuaranteed===false);
check('an empty report has no week',plain(rep.geoReport({questions:[],observations:[],site:{jsonLd:'unknown',llmsTxt:'unknown'}})).week===null);
const llms=rep.llmsTxtTemplate({brandName:'판떡',summary:'휘경동 떡볶이',officialUrls:['https://pantteok.example.kr'],facts:[{label:'영업시간',value:'11:00~21:00'}]});
check('llms.txt template uses only given facts and URLs',llms.startsWith('# 판떡\n')&&llms.includes('- 영업시간: 11:00~21:00')&&llms.includes('(https://pantteok.example.kr)'));

// ── 4) 예약 짝 규칙(scheduled-runs 추가 종류) ──
const schedBad=input=>bad(()=>sched.parseScheduleInput(input));
check('geo_weekly pairs only with run_geo_tracking and one weekday',/짝을 이룹니다/.test(schedBad({kind:'geo_weekly',action:'create_meeting_draft',brandId:'b',campaignId:'c',spec:{weekdays:[1],hour:9}}))&&/짝을 이룹니다/.test(schedBad({kind:'weekly_performance_summary',action:'run_geo_tracking',brandId:'b',campaignId:'c',spec:{weekdays:[1],hour:9}}))&&/주 1회/.test(schedBad({kind:'geo_weekly',action:'run_geo_tracking',brandId:'b',campaignId:'c',spec:{weekdays:[1,3],hour:9}}))&&sched.parseScheduleInput({kind:'geo_weekly',action:'run_geo_tracking',brandId:'b',campaignId:'c',spec:{weekdays:[1],hour:9}}).kind==='geo_weekly');

// ── 5) 서버·라우트 ──
const at='2026-11-01T00:00:00.000Z';
await server.recordStatement(WS,'brand',BRAND,{id:BRAND,name:'판떡',short:'판',category:'떡볶이',color:'',bg:'',description:'휘경동 떡볶이 전문점',audience:'',tone:'',constraints:'',knowledge:'',intake:{website:'https://pantteok.example.kr',socialLinks:'',market:'',clientNeed:'',competitors:'엽떡, 신전떡볶이'}}).run();
await server.recordStatement(WS,'campaign',CAMPAIGN,{id:CAMPAIGN,brandId:BRAND,title:'GEO 캠페인',goal:'시험',status:'draft',version:1,createdAt:at,updatedAt:at}).run();
const fact=(id,key,value,status='confirmed')=>server.recordStatement(WS,'brand_fact',id,{id,brandId:BRAND,key,value,status,source:'대표 확인',verifiedAt:at,validUntil:'2099-01-01T00:00:00.000Z',version:1,updatedAt:at},BRAND).run();
await fact('bf-addr','address','서울특별시 동대문구 휘경동 123-4');await fact('bf-menu','signature_menu','로제 떡볶이');await fact('bf-park','parking','건물 주차 2대','candidate');
await sql.prepare('INSERT INTO settings(owner,secret,model,updated_at) VALUES(?,?,?,?)').run(WS,await server.encrypt(JSON.stringify({provider:'hermes',endpoint:'https://hermes.example.com',key:'mock-only'})),'HERMES',at);

let r=await get(boss);
check('GET is 409 while the switch is off',r.status===409&&/스위치가 꺼져/.test(r.body.error));
r=await post(boss,{action:'start_run',id:'geo-run-flagoff01'});
check('start is 409 while off and nothing is sent',r.status===409&&hermes.bodies.length===0&&rows('geo_run').length===0);
check('save_question is 409 while off',(await post(boss,{action:'save_question',expectedVersion:0,input:qi})).status===409);
await flags.setFeatureFlag(WS,{flag:'geo_tracking',enabled:true},by);
check('a member is 403',(await get(member)).status===403&&(await post(member,{action:'save_question',expectedVersion:0,input:qi})).status===403);
check('an unknown action is 400',(await post(boss,{action:'scrape_all'})).status===400);
r=await get(boss);
check('the view lists starters from confirmed facts only (candidate parking ignored)',r.status===200&&r.body.starters.some(s=>s.text==='휘경동 떡볶이 추천')&&!r.body.starters.some(s=>/주차/.test(s.text))&&r.body.questions.length===0&&r.body.plan.jobs===0);
check('the view has the llms.txt template from confirmed facts',/# 판떡/.test(r.body.llmsTxt)&&/휘경동 123-4/.test(r.body.llmsTxt)&&!/주차/.test(r.body.llmsTxt));
r=await post(boss,{action:'add_starters',texts:['휘경동 최고 맛집 1위']});
check('a starter text outside the generated list is 409',r.status===409&&rows('geo_question').length===0);
r=await post(boss,{action:'add_starters',texts:['휘경동 떡볶이 추천','판떡 영업시간'],engines:['perplexity','chatgpt','gemini']});
check('starters are saved with their fact basis',r.status===200&&r.body.added.length===2&&r.body.added.every(q=>q.origin==='starter'&&q.basis.length>0&&q.engines.length===3));
r=await post(boss,{action:'save_question',expectedVersion:0,input:{...qi,text:'휘경동  떡볶이 추천'}});
check('a duplicate question (normalised) is 409',r.status===409&&/같은 질문/.test(r.body.error));
r=await post(boss,{action:'save_question',expectedVersion:0,input:{...qi,text:'떡볶이 배달 추천',engines:['naver'],active:false}});
check('a manual question is saved',r.status===200&&r.body.origin==='manual'&&r.body.version===1);
const manualId=r.body.id;
check('a stale version is 409',(await post(boss,{action:'save_question',id:manualId,expectedVersion:0,input:{...qi,text:'떡볶이 배달 추천',active:false}})).status===409);
r=await get(boss);
check('the plan counts active questions × engines with a token estimate',r.body.plan.jobs===6&&r.body.plan.questions===2&&r.body.plan.engines===3&&r.body.plan.perJobTokens>=geo.GEO_JOB_MIN_TOKENS&&r.body.plan.totalTokens===r.body.plan.perJobTokens*6&&r.body.plan.basis==='input');

// 예산 초과: 계획 전체 추정이 상한을 넘으면 보내지 않는다.
await budget.setTokenBudget(server.database(),WS,{scope:'workspace',monthlyTokens:50000},by);
r=await post(boss,{action:'start_run',id:'geo-run-budget001'});
check('over the token budget is 409 and nothing is sent or recorded',r.status===409&&/토큰 예산 초과/.test(r.body.error)&&hermes.bodies.length===0&&rows('geo_run').length===0);
await budget.setTokenBudget(server.database(),WS,{scope:'workspace',monthlyTokens:null},by);
// 자율성 금지
await flags.setFeatureFlag(WS,{flag:'autonomy_rules',enabled:true},by);
await server.recordStatement(WS,'autonomy_settings','current',{id:'current',version:1,settings:{research_run:'never'},updatedAt:at,updatedBy:null}).run();
r=await post(boss,{action:'start_run',id:'geo-run-never0001'});
check('autonomy never for research runs is 403 and nothing is sent',r.status===403&&hermes.bodies.length===0);
check('a scheduled run is skipped with the never reason',/금지/.test(await geo.geoScheduleSkip(WS)));
await server.recordStatement(WS,'autonomy_settings','current',{id:'current',version:2,settings:{research_run:'ask'},updatedAt:at,updatedBy:null}).run();
check('a scheduled run needs research_run auto (ask is skipped)',/자동일 때만/.test(await geo.geoScheduleSkip(WS)));
await server.recordStatement(WS,'autonomy_settings','current',{id:'current',version:3,settings:{research_run:'auto'},updatedAt:at,updatedBy:null}).run();
check('auto lets the schedule run',await geo.geoScheduleSkip(WS)===null);
await flags.setFeatureFlag(WS,{flag:'autonomy_rules',enabled:false},by);
// 전역 중단
await server.recordStatement(WS,'growth_stop','global',{id:'global',version:1,status:'stopped',reason:'점검',updatedAt:at,updatedBy:'geo-boss'}).run();
r=await post(boss,{action:'start_run',id:'geo-run-stopped01'});
check('global stop blocks a new run with 409',r.status===409&&/전역 중단/.test(r.body.error)&&hermes.bodies.length===0);
await server.recordStatement(WS,'growth_stop','global',{id:'global',version:2,status:'running',reason:'재개',updatedAt:at,updatedBy:'geo-boss'}).run();

// 측정: perplexity 관찰, chatgpt 로그인 필요, gemini 지어낸 키(검사 실패).
hermes.modeFor=engine=>engine==='chatgpt'?'login':engine==='gemini'?'invented':'good';
r=await post(boss,{action:'start_run',id:'geo-run-good00001'});
check('start submits at most two jobs in the first advance',r.status===200&&r.body.status==='running'&&hermes.bodies.length===2&&r.body.jobs.filter(j=>j.status==='queued').length===2);
check('each submission reserves tokens',sql.prepare("SELECT COUNT(*) AS n FROM records WHERE owner=? AND kind='token_reservation' AND id LIKE ?").get(WS,`${WS}:token_reservation:geo-geo-run-good00001-%`).n===2);
check('the same id returns the same run without new sends',(await post(boss,{action:'start_run',id:'geo-run-good00001'})).body.id==='geo-run-good00001'&&hermes.bodies.length===2);
r=await post(boss,{action:'start_run',id:'geo-run-second001'});
check('a second run while one is active is 409',r.status===409&&/진행 중인 측정/.test(r.body.error));
check('advance on another campaign brand is 404',(await post(boss,{action:'advance',runId:'geo-run-good00001',campaignId:'missing'})).status===404);
let run=r;for(let i=0;i<8;i++){run=(await post(boss,{action:'advance',runId:'geo-run-good00001'})).body;if(run.status!=='running')break}
check('the run completes after repeated advances (low frequency, at most 3 in flight)',run.status==='completed'&&hermes.bodies.length===6);
const obs=rows('geo_observation');
check('observations are stored for valid and login_required answers only',obs.length===4&&obs.filter(x=>x.status==='observed').length===2&&obs.filter(x=>x.status==='login_required').length===2);
const good=obs.find(x=>x.engine==='perplexity'&&x.questionText==='휘경동 떡볶이 추천');
check('a stored observation keeps excerpt, citations, computed brandCited and source',good.source==='hermes'&&good.runId==='geo-run-good00001'&&good.brandCited===true&&good.brandMentioned===true&&good.firstMentionRank===2&&good.answerExcerpt.startsWith('휘경동에서는')&&good.citations.length===2&&!!good.providerRunId);
check('invalid answers fail the job without an observation',run.jobs.filter(j=>j.engine==='gemini').every(j=>j.status==='failed'&&/정해지지 않은 키/.test(j.error))&&!obs.some(x=>x.engine==='gemini'));
check('usage is recorded with the geo role',rows('provider_usage').filter(u=>u.role==='geo_observation').length>=6);
r=await get(boss);
check('the view report shows perplexity share of voice and the login backlog',r.body.report.engines.find(e=>e.engine==='perplexity').shareOfVoice===1&&r.body.report.backlog.some(b=>b.kind==='login_required')&&r.body.active===null);
check('later estimates use the recorded geo usage average',r.body.plan.perJobTokens>=20000&&r.body.plan.samples>=1);
check('the run record has no secrets and the submission has no fact text',!JSON.stringify(rows('geo_run')).includes('mock-only')&&!hermes.bodies.some(b=>b.input.includes('123-4')));

// 중지: 대기 작업은 보내지 않는다.
hermes.modeFor=()=>'slow';
r=await post(boss,{action:'start_run',id:'geo-run-cancel001'});
const sentBefore=hermes.bodies.length;
r=await post(boss,{action:'cancel_run',runId:'geo-run-cancel001'});
check('cancel stops the run and sends no pending jobs',r.status===200&&r.body.status!=='running'&&r.body.jobs.every(j=>['cancelled','completed','failed'].includes(j.status))&&hermes.bodies.length===sentBefore);
// 진행 중 전역 중단: 남은 대기 작업은 취소한다.
r=await post(boss,{action:'start_run',id:'geo-run-stopmid01'});
await server.recordStatement(WS,'growth_stop','global',{id:'global',version:3,status:'stopped',reason:'점검',updatedAt:at,updatedBy:'geo-boss'}).run();
const sentMid=hermes.bodies.length;
r=await post(boss,{action:'advance',runId:'geo-run-stopmid01'});
check('global stop during a run cancels pending jobs without new sends',hermes.bodies.length===sentMid&&r.body.jobs.filter(j=>j.status==='cancelled').every(j=>/전역 중단/.test(j.error))&&r.body.jobs.some(j=>j.status==='cancelled'));
await server.recordStatement(WS,'growth_stop','global',{id:'global',version:4,status:'running',reason:'재개',updatedAt:at,updatedBy:'geo-boss'}).run();
await post(boss,{action:'cancel_run',runId:'geo-run-stopmid01'});

// 사이트 점검
r=await post(boss,{action:'save_site',expectedVersion:0,jsonLd:'present',llmsTxt:'maybe'});
check('site check rejects an unknown state',r.status===400);
r=await post(boss,{action:'save_site',expectedVersion:0,jsonLd:'present',llmsTxt:'present'});
check('site check saves and removes those backlog items',r.status===200&&!(await get(boss)).body.report.backlog.some(b=>b.kind==='json_ld'||b.kind==='llms_txt'));
// 예약 측정
await flags.setFeatureFlag(WS,{flag:'geo_tracking',enabled:false},by);
check('scheduled advance does nothing while off',await geo.advanceGeoRunsSafely(WS)===0);
await flags.setFeatureFlag(WS,{flag:'geo_tracking',enabled:true},by);
hermes.modeFor=()=>'good';
const sid=await geo.startScheduledGeo(WS,{brandId:BRAND,campaignId:CAMPAIGN},'sched-abc:2026-11-09');
const srun=rows('geo_run').find(x=>x.id===sid);
check('a scheduled run is created with the schedule id and no human',srun.trigger==='schedule'&&srun.scheduleRunId==='sched-abc:2026-11-09'&&srun.by===null);
check('the same schedule period returns the same run',await geo.startScheduledGeo(WS,{brandId:BRAND,campaignId:CAMPAIGN},'sched-abc:2026-11-09')===sid);
for(let i=0;i<6;i++)await geo.advanceGeoRunsSafely(WS);
check('the worker tick advances the scheduled run to completion',rows('geo_run').find(x=>x.id===sid).status==='completed');

console.log(JSON.stringify({passed:passed.length}));
