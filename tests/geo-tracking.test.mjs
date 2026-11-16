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
 // geo_protocol_v2: 지시가 schema 2를 요구하면 맥락(context)을 더한 답을 돌려준다.
 if(String(sent.instructions??'').includes('geo-observation-2'))return {...good,schema:'geo-observation-2',citations:[...good.citations,{url:'https://map.naver.com/p/entry/place/777',title:'지도'}],context:{tone:'positive',reason:'로제 떡볶이가 대표 메뉴로 소개됨'}};
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

// ── 6) 프로토콜 v2(스위치 geo_protocol_v2, 기본 꺼짐) ──
// 6-1) 꺼짐일 때 v1과 같다: 기준선 해시는 변경 전 코드(559df20)에서 같은 입력으로 계산했다.
{
 const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex').slice(0,16);
 const T=Date.parse('2026-11-16T03:00:00.000Z');
 const vctx={engine:'perplexity',question:'휘경동 떡볶이 추천',target,notBefore:T-1000,now:T+1000};
 const vresp=JSON.stringify({schema:'geo-observation-1',engine:'perplexity',question:'휘경동 떡볶이 추천',status:'observed',observedAt:new Date(T).toISOString(),pageUrl:'https://www.perplexity.ai/search?q=x',answerExcerpt:'엽떡도 있지만 판떡이 좋습니다.',citations:[{url:'https://www.pantteok.example.kr/about',title:'공식'},{url:'https://map.naver.com/p/entry/place/9999',title:'다른 가게'}],brandMentioned:true,competitorsMentioned:['엽떡'],note:''});
 const W1x='2026-11-02T03:00:00.000Z',W2x='2026-11-09T03:00:00.000Z';
 const vfix=[o('q1','perplexity',W1x,{brandMentioned:false}),o('q2','perplexity',W1x),o('q1','perplexity',W2x,{brandCited:true,citations:[{url:'https://pantteok.example.kr',title:'',domain:'pantteok.example.kr',brand:true}]}),o('q2','perplexity',W2x,{brandMentioned:false,competitorsMentioned:['엽떡']}),o('q2','naver',W2x,{status:'login_required',brandMentioned:null,brandCited:null})];
 const vfacts=[{id:'f-addr',key:'address',value:'서울특별시 동대문구 휘경동 123-4'},{id:'f-menu',key:'signature_menu',value:'로제 떡볶이, 순대'}];
 const qrow={text:'휘경동 떡볶이 추천'};
 check('v1 parse is byte-identical to the pre-v2 baseline',hash(ob.parseGeoResponse(vresp,vctx))==='b7cc2ffa1e5cef87');
 check('v1 report is byte-identical to the pre-v2 baseline',hash(rep.geoReport({questions:[{id:'q1',text:'판떡 영업시간'},{id:'q2',text:'휘경동 떡볶이 추천'}],observations:vfix,site:{jsonLd:'unknown',llmsTxt:'absent'}}))==='de6ed70c60498855');
 check('v1 starters are byte-identical (no competitors, no v2)',hash(qs.starterQuestions({brandName:'판떡',category:'떡볶이',facts:vfacts}))==='0cf525e4e1840bf4');
 check('v1 starters stay identical when competitors are given but v2 is off',hash(qs.starterQuestions({brandName:'판떡',category:'떡볶이',facts:vfacts,competitors:['엽떡']}))==='0cf525e4e1840bf4');
 check('v1 HERMES instruction is byte-identical',hash(ob.geoSubmission(target,'휘경동 떡볶이 추천','naver'))==='efd679b51954432a');
 check('v1 token estimate is byte-identical',hash(geo.geoJobEstimate(target,[{question:qrow,engine:'naver'},{question:qrow,engine:'chatgpt'}],{average:0,samples:0}))==='19bf1fd640f43197');
 check('v1 schema and intents are unchanged',ob.GEO_OBSERVATION_SCHEMA==='geo-observation-1'&&JSON.stringify(qs.GEO_INTENTS)==='["brand","category","local"]');
 check('a schema-2 answer to a v1 request is rejected with the v1 message',/schema 값이 다릅니다/.test(bad(()=>ob.parseGeoResponse(vresp.replace('geo-observation-1','geo-observation-2'),vctx))));
}
r=await get(boss);
check('with v2 off the view has no v2 keys and the report equals the v1 report',r.status===200&&!('protocol' in r.body)&&!('changes' in r.body)&&!('verdicts' in r.body.report)&&!('repeats' in r.body.plan)&&JSON.stringify(r.body.report)===JSON.stringify(plain(rep.geoReport({questions:r.body.questions,observations:rows('geo_observation'),site:{jsonLd:'present',llmsTxt:'present'}}))));
check('v1 runs store no protocol or repeat fields',rows('geo_run').every(x=>!('protocol' in x)&&x.jobs.every(j=>!('repeat' in j))));
check('save_change is 409 while v2 is off',(await post(boss,{action:'save_change',input:{kind:'faq',summary:'FAQ 추가',appliedOn:'2026-11-10',appliedBasis:'published'}})).status===409&&rows('geo_change').length===0);
check('a comparison question is rejected while v2 is off',(await post(boss,{action:'save_question',expectedVersion:0,input:{...qi,text:'판떡 엽떡 비교',intent:'comparison'}})).status===400);

// 6-2) 질문 묶음: 비교 묶음 추가, 지역은 카테고리 아래
check('comparison intent parses only with v2',qs.parseGeoQuestionInput({...qi,intent:'comparison'},{v2:true}).intent==='comparison'&&/질문 유형/.test(bad(()=>qs.parseGeoQuestionInput({...qi,intent:'comparison'}))));
check('groups: local shows under category, comparison is its own group',qs.geoGroupOf('local')==='category'&&qs.geoGroupOf('category')==='category'&&qs.geoGroupOf('comparison')==='comparison'&&qs.geoGroupOf('brand')==='brand'&&JSON.stringify(qs.GEO_GROUPS)==='["category","comparison","brand"]');
{const s2=plain(qs.starterQuestions({brandName:'판떡',category:'떡볶이',facts,competitors:['엽떡','신전떡볶이','동네떡볶이'],v2:true}));
 check('v2 starters add comparison questions from the competitor list (at most two)',s2.filter(s=>s.intent==='comparison').map(s=>s.text).join('|')==='판떡 엽떡 비교|판떡 신전떡볶이 비교'&&s2.filter(s=>s.intent==='comparison').every(s=>s.basis.includes('brand.competitors'))&&s2.length<=qs.GEO_STARTER_COUNT);}

// 6-3) 관찰 스키마 geo-observation-2: 맥락·인용 4분류
{
 const T=Date.now(),c2={...ctx,notBefore:T-1000,now:T+1000,protocol:2};
 const r2=(over={})=>JSON.stringify({schema:'geo-observation-2',engine:'perplexity',question:'휘경동 떡볶이 추천',status:'observed',observedAt:new Date(T).toISOString(),pageUrl:'https://www.perplexity.ai/search?q=x',answerExcerpt:'엽떡도 있지만 판떡이 좋습니다.',
  citations:[{url:'https://www.pantteok.example.kr/about',title:'공식'},{url:'https://map.naver.com/p/entry/place/9999',title:'다른 가게'},{url:'https://blog.naver.com/someone/1',title:'후기'},{url:'https://blog.example.com/a',title:'모름'}],brandMentioned:true,competitorsMentioned:['엽떡'],note:'',context:{tone:'neutral',reason:'여러 가게 중 하나로 나열'},...over});
 const v2=plain(ob.parseGeoResponse(r2(),c2));
 check('v2 parse keeps v1 fields and adds protocol and context',v2.protocol===2&&v2.brandCited===true&&v2.firstMentionRank===2&&v2.context.tone==='neutral'&&v2.context.reason==='여러 가게 중 하나로 나열');
 check('citations are classified official / platform / third party / unclassified',v2.citations.map(c=>c.sourceClass).join(',')==='official,platform,third_party,unclassified');
 check('a platform page that is our own listing stays platform but counts as brand citation',(()=>{const x=plain(ob.parseGeoResponse(r2({citations:[{url:'https://map.naver.com/p/entry/place/1234',title:'우리 지도'}]}),c2));return x.citations[0].sourceClass==='platform'&&x.citations[0].brand===true&&x.brandCited===true})());
 const r2bad=(name,text,re)=>check(name,re.test(bad(()=>ob.parseGeoResponse(text,c2))));
 r2bad('a reason over 100 characters is rejected',r2({context:{tone:'positive',reason:'가'.repeat(101)}}),/100자/);
 r2bad('an unknown tone is rejected',r2({context:{tone:'great',reason:'좋음'}}),/긍정·중립·부정/);
 r2bad('a missing context when the brand is mentioned is rejected',r2({context:null}),/context/);
 r2bad('a context when the brand is not mentioned is rejected',r2({brandMentioned:false,answerExcerpt:'엽떡이 유명합니다.',context:{tone:'negative',reason:'없음'}}),/context/);
 r2bad('a v1 answer to a v2 request is rejected',r2({schema:'geo-observation-1'}),/schema 값이 다릅니다/);
 r2bad('an invented key is still rejected in v2',r2({score:3}),/정해지지 않은 키/);
 const nf=plain(ob.parseGeoResponse(r2({brandMentioned:false,answerExcerpt:'엽떡이 유명합니다.',context:null}),c2));
 check('context is null when the brand is not mentioned',nf.context===null&&nf.protocol===2);
 const lg=plain(ob.parseGeoResponse(r2({status:'login_required',pageUrl:'https://chatgpt.com/',answerExcerpt:'',citations:[],brandMentioned:null,competitorsMentioned:[],context:null}),c2));
 check('login_required in v2 has null context',lg.status==='login_required'&&lg.context===null&&lg.protocol===2);
 const s2=ob.geoSubmission(target,'휘경동 떡볶이 추천','naver',2);
 check('the v2 instruction asks for schema 2 with context and a 100-character reason',s2.instructions.includes('geo-observation-2')&&/context/.test(s2.instructions)&&/100자/.test(s2.instructions)&&s2.input===ob.geoSubmission(target,'휘경동 떡볶이 추천','naver').input);
}

// 6-4) N회 중 k회·판정어·7일 규칙·방어 실패·엔티티 부재
{
 const vd=await load('lib/geo-verdict.ts');
 check('count label reads N회 중 k회',vd.countLabel(6,4)==='6회 중 4회');
 check('verdict thresholds (운영 기준): 2/3 dominant, 1/3 contested, above 0 behind, 0 absent, none unobserved',vd.verdictOf(3,2)==='dominant'&&vd.verdictOf(6,3)==='contested'&&vd.verdictOf(3,1)==='contested'&&vd.verdictOf(4,1)==='behind'&&vd.verdictOf(3,0)==='absent'&&vd.verdictOf(0,0)==='unobserved'&&vd.GEO_VERDICT_RULES.label==='운영 기준');
 check('verdict words are the Korean protocol words',JSON.stringify(Object.values(vd.GEO_VERDICT_LABELS))===JSON.stringify(['장악','경합','열세','부재','방어 실패','미관측','판정 보류']));
 // 날짜는 date 명령으로 계산했다: 2026-11-02 +7일 = 2026-11-09, +6일 = 2026-11-08, 2026-11-09 -28일 = 2026-10-12.
 const at=(day)=>day+'T03:00:00.000Z';// KST 정오
 const ob2=(questionId,engine,day,mentioned)=>({questionId,engine,observedAt:at(day),status:'observed',brandMentioned:mentioned,brandCited:false,competitorsMentioned:[],citations:[]});
 const qv=[{id:'qb',text:'판떡 영업시간',intent:'brand'},{id:'qc',text:'휘경동 떡볶이 추천',intent:'local'},{id:'qx',text:'판떡 엽떡 비교',intent:'comparison'}];
 const seven=[ob2('qc','perplexity','2026-11-02',true),ob2('qc','perplexity','2026-11-02',true),ob2('qc','perplexity','2026-11-09',false)];
 const six=[ob2('qc','perplexity','2026-11-02',true),ob2('qc','perplexity','2026-11-08',true)];
 const rowOf=(rowsV,group,engine)=>rowsV.find(x=>x.group===group&&x.engine===engine);
 const v7=rowOf(vd.geoVerdicts(qv,seven),'category','perplexity'),v6=rowOf(vd.geoVerdicts(qv,six),'category','perplexity');
 check('two time points 7 days apart give a verdict with N회 중 k회 (local counted under category)',v7.n===3&&v7.k===2&&v7.count==='3회 중 2회'&&v7.timePoints===2&&v7.verdict==='dominant');
 check('time points 6 days apart give 판정 보류 with the count kept',v6.verdict==='pending'&&v6.count==='2회 중 2회'&&vd.GEO_VERDICT_LABELS[v6.verdict]==='판정 보류');
 check('a single time point is 판정 보류',rowOf(vd.geoVerdicts(qv,[ob2('qc','naver','2026-11-09',true)]),'category','naver').verdict==='pending');
 check('a group with no observation is 미관측',rowOf(vd.geoVerdicts(qv,seven),'comparison','perplexity').verdict==='unobserved');
 check('login_required rows do not count in N',rowOf(vd.geoVerdicts(qv,[...seven,{...ob2('qc','perplexity','2026-11-09',null),status:'login_required'}]),'category','perplexity').n===3);
 const drop=[ob2('qc','perplexity','2026-10-05',true),ob2('qc','perplexity','2026-10-12',true),ob2('qc','perplexity','2026-11-02',false),ob2('qc','perplexity','2026-11-02',false),ob2('qc','perplexity','2026-11-09',true),ob2('qc','perplexity','2026-11-09',false)];
 const vdrop=rowOf(vd.geoVerdicts(qv,drop),'category','perplexity');
 check('a drop from the previous 28-day window is 방어 실패 with the current level kept',vdrop.verdict==='defense_failed'&&vdrop.level==='behind'&&vdrop.previous==='dominant'&&vdrop.n===4&&vdrop.k===1);
 const absent=[ob2('qb','perplexity','2026-11-02',false),ob2('qb','perplexity','2026-11-09',false),ob2('qc','perplexity','2026-11-02',true)];
 const noFacts=vd.geoReportV2({questions:qv,observations:absent,site:{jsonLd:'present',llmsTxt:'present'},confirmedFactKeys:[]});
 check('brand-group absence puts prescription 0 (entity absence) first in the backlog',noFacts.backlog[0].kind==='entity_absent'&&noFacts.entity.absent===true&&JSON.stringify(noFacts.entity.engines)==='["perplexity"]');
 check('without confirmed facts prescription 0 waits',noFacts.backlog[0].waiting===true&&/대기/.test(noFacts.backlog[0].text));
 const withFacts=vd.geoReportV2({questions:qv,observations:absent,site:{jsonLd:'present',llmsTxt:'present'},confirmedFactKeys:['address','signature_menu']});
 check('with a confirmed address prescription 0 names the info page, map listing and name consistency',withFacts.backlog[0].kind==='entity_absent'&&withFacts.backlog[0].waiting===false&&/공식 정보 페이지/.test(withFacts.backlog[0].text)&&/지도/.test(withFacts.backlog[0].text)&&/표기/.test(withFacts.backlog[0].text));
 const fine=vd.geoReportV2({questions:qv,observations:seven,site:{jsonLd:'present',llmsTxt:'present'},confirmedFactKeys:[]});
 check('no brand-group absence means no prescription 0',!fine.backlog.some(b=>b.kind==='entity_absent')&&fine.entity.absent===false);
 check('the v2 report keeps every v1 field and labels its thresholds 운영 기준',Object.keys(plain(rep.geoReport({questions:qv,observations:seven,site:{jsonLd:'present',llmsTxt:'present'}}))).every(k=>k in fine)&&fine.protocol===2&&fine.rules.label==='운영 기준'&&fine.rules.minGapDays===7);
 check('citation and context mixes count v2 observations only',(()=>{const m=vd.geoReportV2({questions:qv,observations:[{...ob2('qc','perplexity','2026-11-09',true),protocol:2,context:{tone:'positive',reason:'x'},citations:[{url:'https://a.kr',title:'',domain:'a.kr',brand:true,sourceClass:'official'},{url:'https://b.kr',title:'',domain:'b.kr',brand:false,sourceClass:'unclassified'}]},ob2('qc','perplexity','2026-11-02',true)],site:{jsonLd:'present',llmsTxt:'present'},confirmedFactKeys:[]});return m.citationMix.official===1&&m.citationMix.unclassified===1&&m.citationMix.platform===0&&m.contextMix.positive===1&&m.contextMix.neutral===0})());
}

// 6-5) 재관측 예약 +14·+42일(lib/scheduled-runs.ts). 기대 날짜는 date 명령으로 계산했다: 2026-12-01 +14일 = 2026-12-15, +42일 = 2027-01-12.
check('rechecks are scheduled at +14 and +42 days',JSON.stringify(plain(sched.geoRecheckDates('2026-12-01')))==='[{"offset":14,"dueOn":"2026-12-15"},{"offset":42,"dueOn":"2027-01-12"}]'&&JSON.stringify(sched.GEO_RECHECK_OFFSETS)==='[14,42]');
check('due rechecks are those scheduled on or before today (KST)',(()=>{const ch=[{id:'gchg-a',rechecks:[{offset:14,dueOn:'2026-12-15',status:'scheduled'},{offset:42,dueOn:'2027-01-12',status:'scheduled'}]},{id:'gchg-b',rechecks:[{offset:14,dueOn:'2026-12-10',status:'started',runId:'geo-run-x'}]}];
 const due=plain(sched.dueGeoRechecks(ch,Date.parse('2026-12-15T00:00:00.000Z')));// KST 2026-12-15 09시
 return due.length===1&&due[0].changeId==='gchg-a'&&due[0].offset===14&&!sched.dueGeoRechecks(ch,Date.parse('2026-12-14T14:00:00.000Z')).length})());// KST 12-14 23시

// 6-6) 켜면: 반복·예산 가드·관찰·보고·변경 기록·재관측 예약
await flags.setFeatureFlag(WS,{flag:'geo_protocol_v2',enabled:true},by);
r=await get(boss);
const pairs2=r.body.questions.filter(q=>q.active).reduce((n,q)=>n+q.engines.length,0);
check('with v2 the plan repeats every pair 3 times and the token total counts repeats',r.body.protocol===2&&r.body.plan.repeats===3&&r.body.plan.jobs===pairs2*3&&r.body.plan.totalTokens===r.body.plan.perJobTokens*pairs2*3);
check('the v2 estimate triples the v1 total for the same pairs',(()=>{const ps=[{question:{text:'휘경동 떡볶이 추천'},engine:'naver'},{question:{text:'판떡 영업시간'},engine:'chatgpt'}],e1=geo.geoJobEstimate(target,ps,{average:0,samples:0}),e3=geo.geoJobEstimate(target,ps,{average:0,samples:0},{repeats:3,protocol:2});return e3.jobs===6&&e3.repeats===3&&e3.totalTokens===e3.perJobTokens*6&&e3.perJobTokens>=e1.perJobTokens})());
{
 const sum=await budget.tokenBudgetSummary(server.database(),WS),line=sum.workspace??sum.lines?.workspace??sum;
 const usedNow=Number(line.used??0)+Number(line.inProgress??0),v1Total=r.body.plan.perJobTokens*pairs2;
 await budget.setTokenBudget(server.database(),WS,{scope:'workspace',monthlyTokens:usedNow+v1Total},by);
 const sentB=hermes.bodies.length;
 const rb=await post(boss,{action:'start_run',id:'geo-run-v2budget1'});
 check('the budget guard counts repeats: a budget that fits one pass blocks three repeats',rb.status===409&&/토큰 예산 초과/.test(rb.body.error)&&hermes.bodies.length===sentB&&!rows('geo_run').some(x=>x.id==='geo-run-v2budget1'));
 await budget.setTokenBudget(server.database(),WS,{scope:'workspace',monthlyTokens:null},by);
}
hermes.modeFor=()=>'good';
r=await post(boss,{action:'start_run',id:'geo-run-v2run0001',repeats:3});
check('a v2 run creates three repeat jobs per pair and asks for schema 2',r.status===200&&r.body.protocol===2&&r.body.jobs.length===pairs2*3&&[1,2,3].every(k=>r.body.jobs.filter(j=>j.repeat===k).length===pairs2)&&hermes.bodies.at(-1).instructions.includes('geo-observation-2'));
check('repeats outside 1..3 are rejected',(await post(boss,{action:'start_run',id:'geo-run-v2bad0001',repeats:4})).status===400);
for(let i=0;i<30&&r.body.status==='running';i++)r=await post(boss,{action:'advance',runId:'geo-run-v2run0001'});
const v2obs=rows('geo_observation').filter(x=>x.runId==='geo-run-v2run0001');
check('v2 observations store protocol, repeat, context and citation classes',r.body.status==='completed'&&v2obs.length===pairs2*3&&v2obs.every(x=>x.protocol===2&&x.repeat>=1&&x.context?.tone==='positive'&&x.citations.some(c=>c.sourceClass==='platform')));
r=await get(boss);
const vrow=r.body.report.verdicts.find(x=>x.group==='category'&&x.engine==='perplexity');
check('the v2 view reports N회 중 k회 and 판정 보류 for a single time point',vrow&&/^\d+회 중 \d+회$/.test(vrow.count)&&vrow.verdict==='pending'&&r.body.report.rules.label==='운영 기준'&&r.body.report.citationMix.platform>0);
check('the v2 view offers the comparison intent and the three groups',JSON.stringify(r.body.intents)==='["brand","category","local","comparison"]'&&JSON.stringify(r.body.groups)==='["category","comparison","brand"]');
// 변경 기록과 +14·+42 재관측
const kstToday=new Date(Date.now()+9*3600000).toISOString().slice(0,10);
const shift=(day,n)=>new Date(Date.parse(day+'T00:00:00Z')+n*86400000).toISOString().slice(0,10);
r=await post(boss,{action:'save_change',input:{kind:'faq',summary:'공식 페이지에 영업시간 FAQ 추가',appliedOn:kstToday,appliedBasis:'published',questionIds:[]}});
check('a change record schedules rechecks at +14 and +42 days from the applied day',r.status===200&&/^gchg-/.test(r.body.id)&&JSON.stringify(r.body.rechecks.map(x=>[x.offset,x.dueOn,x.status]))===JSON.stringify([[14,shift(kstToday,14),'scheduled'],[42,shift(kstToday,42),'scheduled']]));
check('a change in the future or with an unknown kind is rejected',(await post(boss,{action:'save_change',input:{kind:'faq',summary:'x',appliedOn:shift(kstToday,2),appliedBasis:'published'}})).status===400&&(await post(boss,{action:'save_change',input:{kind:'magic',summary:'x',appliedOn:kstToday,appliedBasis:'published'}})).status===400);
check('a member cannot record a change',(await post(member,{action:'save_change',input:{kind:'faq',summary:'x',appliedOn:kstToday,appliedBasis:'published'}})).status===403);
r=await post(boss,{action:'save_change',input:{kind:'entity_basics',summary:'공식 정보 페이지·지도 등록 정보·이름 표기 정비',appliedOn:shift(kstToday,-15),appliedBasis:'indexed'}});
const oldChange=r.body.id;
check('an older change has its +14 recheck already due',(await get(boss)).body.rechecksDue.some(d=>d.changeId===oldChange&&d.offset===14));
const runsBefore=rows('geo_run').length;
await geo.advanceGeoRunsSafely(WS);
check('a due recheck does not start while research runs are not automatic',rows('geo_run').length===runsBefore&&rows('geo_change').find(x=>x.id===oldChange).rechecks[0].status==='scheduled');
await flags.setFeatureFlag(WS,{flag:'autonomy_rules',enabled:true},by);
await server.recordStatement(WS,'autonomy_settings','current',{id:'current',version:4,settings:{research_run:'auto'},updatedAt:at,updatedBy:null}).run();
await geo.advanceGeoRunsSafely(WS);
const started=rows('geo_change').find(x=>x.id===oldChange).rechecks[0];
const rrun=rows('geo_run').find(x=>x.id===started.runId);
check('with research runs automatic the tick starts the recheck run once',started.status==='started'&&rrun&&rrun.scheduleRunId===`recheck:${oldChange}:14`&&rrun.trigger==='recheck'&&rrun.protocol===2);
const runsAfter=rows('geo_run').length;
await geo.advanceGeoRunsSafely(WS);
check('the next tick does not start the same recheck again',rows('geo_run').length===runsAfter);
check('the +42 recheck of the older change stays scheduled',rows('geo_change').find(x=>x.id===oldChange).rechecks[1].status==='scheduled');
await flags.setFeatureFlag(WS,{flag:'autonomy_rules',enabled:false},by);
await post(boss,{action:'cancel_run',runId:started.runId});
// 6-7) 맨 앞 재관측의 캠페인이 보관·삭제됐으면 그 회차를 건너뜀(사유)으로 한 번만 남기고 같은 tick에 다음 회차로 넘어간다. tick마다 오류 로그를 남기지 않는다.
{
 await server.recordStatement(WS,'campaign','geo-archived',{id:'geo-archived',brandId:BRAND,title:'보관 캠페인',goal:'시험',status:'draft',archivedAt:at,version:2,createdAt:at,updatedAt:at}).run();
 const ch=(id,campaignId,daysAgo)=>({id,brandId:BRAND,campaignId,kind:'faq',summary:'시험 변경',appliedOn:shift(kstToday,-14-daysAgo),appliedBasis:'published',questionIds:[],rechecks:[{offset:14,dueOn:shift(kstToday,-daysAgo),status:'scheduled'},{offset:42,dueOn:shift(kstToday,28-daysAgo),status:'scheduled'}],createdAt:at,createdBy:'geo-boss'});
 for(const c of [ch('gchg-archived01','geo-archived',3),ch('gchg-missing001','geo-gone',2),ch('gchg-validnext1',CAMPAIGN,1)])await server.recordStatement(WS,'geo_change',c.id,c,BRAND).run();
 await flags.setFeatureFlag(WS,{flag:'autonomy_rules',enabled:true},by);
 const errors=[],origError=console.error;console.error=(...a)=>{errors.push(a.join(' '))};
 try{
  await geo.advanceGeoRunsSafely(WS);
  const get1=id=>rows('geo_change').find(x=>x.id===id);
  const arch=get1('gchg-archived01').rechecks[0],gone=get1('gchg-missing001').rechecks[0],next=get1('gchg-validnext1').rechecks[0];
  check('an archived head recheck is skipped with a reason',arch.status==='skipped'&&/보관/.test(arch.reason)&&typeof arch.skippedAt==='string');
  check('a recheck whose campaign is missing is skipped with a reason',gone.status==='skipped'&&/찾지 못/.test(gone.reason));
  check('the next due recheck starts in the same tick',next.status==='started'&&rows('geo_run').some(x=>x.id===next.runId&&x.scheduleRunId==='recheck:gchg-validnext1:14'));
  check('the archived change keeps its future +42 recheck scheduled',get1('gchg-archived01').rechecks[1].status==='scheduled');
  const snapshot=JSON.stringify([get1('gchg-archived01'),get1('gchg-missing001')]);
  await post(boss,{action:'cancel_run',runId:next.runId});
  await geo.advanceGeoRunsSafely(WS);await geo.advanceGeoRunsSafely(WS);
  check('the skip is recorded once (later ticks leave it unchanged)',JSON.stringify([get1('gchg-archived01'),get1('gchg-missing001')])===snapshot);
  check('skipping does not log an error on any tick',!errors.some(e=>/geo_recheck_start_failed|geo_run_advance_failed/.test(e)));
 }finally{console.error=origError}
 await flags.setFeatureFlag(WS,{flag:'autonomy_rules',enabled:false},by);
}

console.log(JSON.stringify({passed:passed.length}));
