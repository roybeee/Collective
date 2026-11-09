// C8 당근 광고 OpenAPI: 요청 빌더·인증 헤더(가정)·한도 큐(분당 60·초당 100)·429 Retry-After·쓰기 타임아웃 unknown(재시도 없음)·계약 하네스 5 시나리오,
// 규칙 제안(14일 클릭 0 중지 T2·CPA 초과 일 예산 10% 인하 T3·ROAS 양호 10% 인상 T3), 서버(연결·스위치 꺼짐 409·자율성 never 403·승인·반영·읽기 대조·unknown→reconcile·성과 수집), HTTP 권한.
// 근거: mocked(메모리 SQLite, 로컬 인증 헤더·세션 주입, 당근 fetch 스텁). 외부 네트워크 0회. 실제 당근 광고 API 경로·필드는 미확인 가정이다.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {testRuntime} from './helpers/runtime.mjs';

const HOST='https://ads-openapi.kr.karrotmarket.com',ACCT='acct1',base=`/v1/ad-accounts/${ACCT}`;
const mock={campaigns:{},adgroups:{},perf:{},log:[],fail:null,nextId:1};
const reset=()=>{
 mock.campaigns={c1:{id:'c1',name:'휘경 당근 캠페인',status:'ACTIVE',dailyBudget:50000},c2:{id:'c2',name:'다른 캠페인',status:'ACTIVE',dailyBudget:30000}};
 mock.adgroups={g1:{id:'g1',campaignId:'c1',name:'클릭 없는 그룹',status:'ACTIVE',dailyBudget:20000},g2:{id:'g2',campaignId:'c1',name:'잘 되는 그룹',status:'ACTIVE',dailyBudget:10000},g3:{id:'g3',campaignId:'c1',name:'멈춘 그룹',status:'PAUSED',dailyBudget:10000}};
 // 14일 두 날로 나눠 합계를 검사한다.
 mock.perf={c1:[{impressions:6000,clicks:60,spend:25000,conversions:1},{impressions:4000,clicks:40,spend:15000,conversions:1}],g1:[{impressions:2000,clicks:0,spend:0,conversions:0},{impressions:1000,clicks:0,spend:0,conversions:0}],g2:[{impressions:1500,clicks:30,spend:10000,conversions:5,conversionValue:50000}],g3:[{impressions:0,clicks:0}]};
};
reset();
const route=(url,init)=>{
 const u=new URL(url),path=u.pathname,method=init.method||'GET',body=init.body?JSON.parse(init.body):undefined;
 mock.log.push({method,path,search:u.search,body,headers:init.headers});
 if(mock.fail){const r=mock.fail(path,method,body);if(r)return r}
 const list=rows=>Response.json({data:rows});
 if(path===`${base}/campaigns`&&method==='GET')return list(Object.values(mock.campaigns));
 if(path===`${base}/campaigns`&&method==='POST'){const id='c-new-'+(mock.nextId++);mock.campaigns[id]={id,...body};return Response.json(mock.campaigns[id])}
 if(path===`${base}/ad-groups`&&method==='GET')return list(Object.values(mock.adgroups).filter(g=>g.campaignId===u.searchParams.get('campaignId')));
 const item=path.match(/^\/v1\/ad-accounts\/acct1\/(campaigns|ad-groups)\/([\w-]+)$/);
 if(item){const store=item[1]==='campaigns'?mock.campaigns:mock.adgroups,row=store[item[2]];if(!row)return new Response('{}',{status:404});if(method==='PATCH'){store[item[2]]={...row,...body};return Response.json(store[item[2]])}return Response.json(row)}
 if(path===`${base}/reports/performance`){const ids=u.searchParams.get('ids').split(',');return list(ids.flatMap(id=>(mock.perf[id]||[]).map((r,i)=>({date:`2026-10-${String(27+i).padStart(2,'0')}`,[u.searchParams.get('level')==='CAMPAIGN'?'campaignId':'adGroupId']:id,...r}))))}
 if(path==='/v1/agency/business-rights')return list([{adAccountId:ACCT}]);
 if(path===`${base}/conversion-events`)return Response.json({accepted:body.events.length});
 return new Response('{}',{status:404});
};
const {sql,env,load}=testRuntime(async(url,init={})=>{if(!String(url).startsWith(HOST+'/'))throw new Error('외부 호출 금지: '+url);return route(String(url),init)});
const conn=await load('lib/connectors/daangn-ads.ts'),registry=await load('lib/connectors/registry.ts'),contract=await load('lib/connectors/contract-test.ts'),rules=await load('lib/ads-proposals-daangn.ts'),pure=await load('lib/ads-proposals.ts');
const server=await load('lib/ads-proposals-server.ts'),daangn=await load('lib/daangn-ads-server.ts'),flags=await load('lib/feature-flags.ts'),core=await load('lib/server.ts'),autonomy=await load('lib/autonomy-server.ts');
const proposalsRoute=await load('app/api/ads-proposals/route.ts'),daangnRoute=await load('app/api/daangn-ads/route.ts'),kinds=await load('lib/record-kinds.ts'),status=await load('lib/feature-status.ts'),featureFlags=await load('lib/feature-flags.ts');
const passed=[];const check=(name,value)=>{assert.ok(value,name);passed.push(name)};
const plain=v=>JSON.parse(JSON.stringify(v));
const refuse=fn=>{try{fn();return null}catch(e){return e.message}};
const cred={channel:'daangn_ads',apiKey:'dg-secret-key',adAccountId:ACCT,authHeader:'x-api-key'};
const fast={now:()=>Date.now(),random:()=>0.5,sleep:async()=>undefined};

// 1) 요청 빌더(순수): 경로·메서드·본문. 생성은 PAUSED로만 만든다. 잘못된 입력은 보내기 전에 막는다.
const b=(op)=>plain(conn.buildDaangnRequest(op,ACCT));
check('set_status builds PATCH on the item with status only',JSON.stringify(b({op:'set_status',target:'adgroup',id:'g1',status:'PAUSED'}))===JSON.stringify({method:'PATCH',path:`${base}/ad-groups/g1`,query:'',body:{status:'PAUSED'}}));
check('set_daily_budget builds PATCH with dailyBudget and validates 100-won steps in 1,000~100,000,000',b({op:'set_daily_budget',target:'campaign',id:'c1',dailyBudget:45000}).body.dailyBudget===45000&&/1,000~100,000,000원, 100원 단위/.test(refuse(()=>conn.buildDaangnRequest({op:'set_daily_budget',target:'campaign',id:'c1',dailyBudget:45050},ACCT)))&&/1,000/.test(refuse(()=>conn.buildDaangnRequest({op:'set_daily_budget',target:'campaign',id:'c1',dailyBudget:900},ACCT))));
check('create campaign/adgroup/creative POST to the collection and always as PAUSED',b({op:'create_campaign',name:'신메뉴',dailyBudget:20000}).body.status==='PAUSED'&&b({op:'create_adgroup',campaignId:'c1',name:'그룹'}).path===`${base}/ad-groups`&&b({op:'create_creative',adGroupId:'g1',title:'제목',body:'본문',landingUrl:'https://example.com/a'}).body.status==='PAUSED');
check('updates PATCH only given fields and refuse empty updates',JSON.stringify(b({op:'update_creative',creativeId:'cr1',title:'새 제목'}).body)==='{"title":"새 제목"}'&&/바꿀 항목이 없습니다/.test(refuse(()=>conn.buildDaangnRequest({op:'update_campaign',campaignId:'c1'},ACCT))));
check('bad ids, non-https landing URLs and unknown ops are refused in Korean',/ID 형식/.test(refuse(()=>conn.buildDaangnRequest({op:'set_status',target:'campaign',id:'../x',status:'PAUSED'},ACCT)))&&/https/.test(refuse(()=>conn.buildDaangnRequest({op:'create_creative',adGroupId:'g1',title:'a',body:'b',landingUrl:'http://x.test'},ACCT)))&&/지원하지 않는/.test(refuse(()=>conn.buildDaangnRequest({op:'delete_all'},ACCT)))&&/ACTIVE/.test(refuse(()=>conn.buildDaangnRequest({op:'set_status',target:'campaign',id:'c1',status:'DELETED'},ACCT))));
check('auth header scheme is configurable: x-api-key by default, Bearer as an option',conn.authHeaders(cred)['x-api-key']==='dg-secret-key'&&!('Authorization' in conn.authHeaders(cred))&&conn.authHeaders({...cred,authHeader:'bearer'}).Authorization==='Bearer dg-secret-key');
const ev={eventId:'e1',eventName:'purchase',eventTime:'2026-11-08T03:00:00Z',value:12000};
check('conversion events: ISO time, KRW value, hashed user id only, 1~50 per request',(()=>{const r=plain(conn.buildEventsRequest([ev,{...ev,eventId:'e2',hashedUserId:'a'.repeat(64)}],ACCT));return r.path===`${base}/conversion-events`&&r.body.events[0].currency==='KRW'&&r.body.events[1].hashedUserId.length===64})()&&/SHA-256 해시/.test(refuse(()=>conn.buildEventsRequest([{...ev,hashedUserId:'010-1234-5678'}],ACCT)))&&/1~50건/.test(refuse(()=>conn.buildEventsRequest(Array.from({length:51},(_,i)=>({...ev,eventId:'e'+i})),ACCT))));
check('parseDaangnCredential defaults to x-api-key, accepts bearer and refuses other schemes',daangn&&conn.parseDaangnCredential({apiKey:'k',adAccountId:'a1'}).authHeader==='x-api-key'&&conn.parseDaangnCredential({apiKey:'k',adAccountId:'a1',authHeader:'bearer'}).authHeader==='bearer'&&(()=>{try{conn.parseDaangnCredential({apiKey:'k',adAccountId:'a1',authHeader:'basic'});return false}catch(e){return e.status===400}})());

// 2) 레지스트리: read T1·write T3·events T4(types.ts '전환 전송'), 기본 꺼짐, 스위치 daangn_ads, 한도 분당 60·초당 100.
const caps=plain(registry.descriptorFor('daangn_ads').capabilities),cap=k=>caps.find(c=>c.key===k);
check('registry descriptor: management read T1, write T3, conversion send T4, flag daangn_ads, store scope, no violations',cap('daangn_ads.management.read').riskTier==='T1'&&cap('daangn_ads.management.write').riskTier==='T3'&&cap('daangn_ads.conversion.send').riskTier==='T4'&&caps.every(c=>c.flag==='daangn_ads'&&c.defaultOff===true&&c.retryUnknown===false&&c.credentialScope==='store')&&registry.describeViolations().length===0);
check('rate limits: 60 per minute for management and performance, 100 per second for events',cap('daangn_ads.management.read').rateLimit.perMinute===60&&cap('daangn_ads.management.write').rateLimit.perMinute===60&&cap('daangn_ads.conversion.send').rateLimit.perSecond===100);

// 3) 보내기·한도·429·unknown (fetch 스텁).
mock.log.length=0;
let w=plain(await conn.executeDaangnWrite(cred,{op:'set_status',target:'adgroup',id:'g1',status:'PAUSED'},fast));
check('a write sends one PATCH with the x-api-key header and returns the target id',w.outcome==='success'&&w.attempts===1&&w.providerIds.join()==='g1'&&mock.log.length===1&&mock.log[0].method==='PATCH'&&mock.log[0].headers['x-api-key']==='dg-secret-key'&&mock.adgroups.g1.status==='PAUSED');
reset();
{let n=0;mock.fail=(p,m)=>m==='PATCH'&&++n===1?new Response('',{status:429,headers:{'retry-after':'2'}}):null;const waits=[];let t=0;
 w=plain(await conn.executeDaangnWrite(cred,{op:'set_daily_budget',target:'campaign',id:'c1',dailyBudget:45000},{now:()=>t,random:()=>0.5,sleep:async ms=>{waits.push(ms);t+=ms}}));mock.fail=null;
 check('429 waits Retry-After then succeeds on the second attempt',w.outcome==='success'&&w.attempts===2&&waits[0]===2000&&mock.campaigns.c1.dailyBudget===45000);}
reset();
{let sends=0;mock.fail=(p,m)=>{if(m==='PATCH'){sends++;const e=new Error('t');e.name='TimeoutError';throw e}return null};
 w=plain(await conn.executeDaangnWrite(cred,{op:'set_status',target:'campaign',id:'c1',status:'PAUSED'},fast));mock.fail=null;
 check('a timeout after sending is unknown after one send (never retried)',w.outcome==='unknown'&&w.attempts===1&&sends===1&&/자동 재시도하지 않으며/.test(w.error));}
{let sends=0;mock.fail=(p,m)=>m==='PATCH'?(sends++,new Response('',{status:503})):null;
 w=plain(await conn.executeDaangnWrite(cred,{op:'set_status',target:'campaign',id:'c1',status:'PAUSED'},fast));mock.fail=null;
 check('a 5xx write is unknown and not retried',w.outcome==='unknown'&&sends===1);}
{mock.fail=(p,m)=>m==='PATCH'?Response.json({code:'INVALID_BUDGET',message:'예산이 너무 작습니다'},{status:400}):null;
 w=plain(await conn.executeDaangnWrite(cred,{op:'set_daily_budget',target:'campaign',id:'c1',dailyBudget:1000},fast));mock.fail=null;
 check('a 4xx write is fatal with the provider reason and no key in the message',w.outcome==='fatal'&&w.attempts===1&&/INVALID_BUDGET · 예산이 너무 작습니다/.test(w.error)&&!w.error.includes('dg-secret'));}
{let t=0;const waits=[],reader=conn.daangnReader(cred,{now:()=>t,random:()=>0.5,sleep:async ms=>{waits.push(ms);t+=ms}});mock.log.length=0;
 for(let i=0;i<61;i++)await reader.get(`${base}/campaigns`);
 check('the 61st management call within a minute waits for the window (60/min per ad account)',mock.log.length===61&&waits.length===1&&waits[0]===60000);}
{let t=0;const waits=[],d={now:()=>t,random:()=>0.5,sleep:async ms=>{waits.push(ms);t+=ms}};let state;
 for(let i=0;i<101;i++){const r=await conn.sendConversionEvents(cred,[{...ev,eventId:'x'+i}],{...d,state});state=r.state}
 check('the 101st event request within a second waits (100/s events lane, separate from management)',waits.length===1&&waits[0]===1000);}
{mock.fail=()=>new Response('{}',{status:401});
 const e=await conn.daangnReader(cred,fast).get(`${base}/campaigns`).then(()=>null,e=>e);mock.fail=null;
 check('401 on read is a Korean auth error that mentions key reissue',e&&e.status===400&&/인증에 실패/.test(e.message)&&/재발급/.test(e.message));}
{const rows=plain(await conn.performanceByDay(conn.daangnReader(cred,fast),cred,{level:'campaign',ids:['c1'],window:{from:'2026-10-26',to:'2026-11-08'}}));
 const total=conn.totalOf(rows);
 check('performance by day is summed; missing metrics stay null (not 0)',rows.length===2&&total.impressions===10000&&total.clicks===100&&total.spend===40000&&total.conversions===2&&total.conversionValue===null&&total.days===2);}

// 4) 계약 하네스: 실제 빌더를 거쳐 스크립트 transport로 5 시나리오.
const requests=[];
const factory=script=>{const calls={};const transport=async(request,op)=>{requests.push({id:op.id,...request});calls[op.id]=(calls[op.id]??0)+1;const steps=script[op.id]??[{kind:'thrown'}];return steps[Math.min(calls[op.id],steps.length)-1]};
 const inner=conn.daangnContractConnector(caps,ACCT,transport);return {...inner,calls:()=>({...calls}),execute:(op,attempt)=>inner.execute({...op,payload:op.payload??{op:'set_status',target:'campaign',id:'c1',status:'PAUSED'}},attempt)}};
const results=await contract.runContractScenarios(factory,{read:'daangn_ads.management.read',write:'daangn_ads.management.write'});
check('contract harness runs the five scenarios against the Daangn connector',results.map(r=>r.scenario).join()==='success,failure,timeout,restart_resume,duplicate_idempotent');
for(const s of results)check(`contract scenario ${s.scenario} passes: ${s.details.join(' | ')||'ok'}`,s.passed);
check('contract writes went through the real builder (PATCH campaigns/c1) and reads used GET',requests.filter(q=>q.id.startsWith('w-')).every(q=>q.method==='PATCH'&&q.path===`${base}/campaigns/c1`)&&requests.filter(q=>q.id.startsWith('r-')).every(q=>q.method==='GET'));

// 5) 규칙(순수).
const window={from:'2026-10-26',to:'2026-11-08'};
const unit=(over)=>({target:'adgroup',id:'u',name:'u',campaignId:'c1',status:'ACTIVE',dailyBudget:10000,impressions:1000,clicks:20,spend:10000,conversions:2,conversionValue:20000,days:14,...over});
let seq=0;const ctx={now:'2026-11-09T00:00:00.000Z',by:'admin-1',id:()=>'d'+(++seq)};
const props=plain(rules.proposeDaangnFromStats({campaignId:'c1',storeId:'s1',brandId:'ofd',window,targets:{targetCpa:3000,targetRoas:null},units:[
 unit({id:'zero',clicks:0,spend:0,conversions:0}),unit({id:'cpa',spend:10000,conversions:2}),unit({id:'roas',spend:10000,conversions:5,conversionValue:50000}),unit({id:'ok',spend:10000,conversions:5,conversionValue:10000}),unit({id:'paused',status:'PAUSED',clicks:0}),unit({id:'nobudget',dailyBudget:null,conversions:1}),unit({id:'few',clicks:5,conversions:5,conversionValue:50000})]},ctx));
check('fixture units produce exactly zero→pause, cpa→budget cut, roas→budget raise in input order',props.map(p=>`${p.target.ids[0]}:${p.kind}:${p.rationale.evidence.ruleId}`).join()==='zero:pause:daangn_zero_clicks_14d,cpa:budget:daangn_cpa_above_target,roas:budget:daangn_roas_good');
check('pause is T2 set_status PAUSED; budget changes are T3 set_daily_budget ±10% in 100-won steps',props[0].riskTier==='T2'&&props[0].operation.op==='set_status'&&props[0].operation.status==='PAUSED'&&props[1].riskTier==='T3'&&props[1].operation.dailyBudget===9000&&props[2].riskTier==='T3'&&props[2].operation.dailyBudget===11000&&props[1].diff.before.dailyBudget===10000&&props[1].diff.after.dailyBudget===9000);
check('every proposal is a daangn_ads draft labelled estimated/no auto apply with metrics as evidence',props.every(p=>p.channel==='daangn_ads'&&p.status==='draft'&&p.label==='추정·규칙 기반, 자동 적용 없음'&&/자동 적용 없음/.test(p.rationale.text)&&p.rationale.evidence.window.to==='2026-11-08'&&'cpa' in p.rationale.evidence.metrics)&&/5,000원.*3,000원/.test(props[1].rationale.text)&&/ROAS 5\.00/.test(props[2].rationale.text));
check('a paused campaign suppresses its ad group proposals (no duplicate effect)',plain(rules.proposeDaangnFromStats({campaignId:'c1',window,targets:{},units:[unit({target:'campaign',id:'c1',clicks:0}),unit({id:'g',clicks:0})]},ctx)).map(p=>p.target.ids[0]).join()==='c1');
check('a budget already at the minimum gets no cut proposal; roundBudget clamps to 1,000~100,000,000',rules.decideForUnit(unit({dailyBudget:1000,spend:10000,conversions:1}),{targetCpa:100})===null&&rules.roundBudget(10)===1000&&rules.roundBudget(1e12)===100000000&&rules.roundBudget(10049)===10000);
check('manual daangn proposals: resume must be set_status ACTIVE, kinds must match, T3',plain(rules.daangnManualProposal({campaignId:'c1',kind:'resume',operation:{op:'set_status',target:'campaign',id:'c1',status:'ACTIVE'},rationale:'재개'},ctx)).riskTier==='T3'&&/맞지 않습니다/.test(refuse(()=>rules.daangnManualProposal({campaignId:'c1',kind:'resume',operation:{op:'set_status',target:'campaign',id:'c1',status:'PAUSED'},rationale:'x'},ctx))));
check('dedupe keys include the channel so a naver and a daangn proposal on the same id do not collide',pure.dedupeAgainst([{...props[0],channel:'naver_ads'}],[props[0]]).length===1&&pure.dedupeAgainst([props[0]],[props[0]]).length===0);

// 6) 서버: 연결(스위치 꺼짐 409) → 연결 → 생성 → 승인(꺼짐 409·never 403) → 반영 verified → mismatch → unknown → reconcile → 수집.
reset();
const owner='daangn-owner',who={owner,id:'owner-account',email:null,role:'owner'},member={...who,id:'m',role:'member'};
await core.seedBrands(owner);
await core.recordStatement(owner,'store','s1',{id:'s1',brandId:'ofd',name:'휘경점',status:'active',version:1},'ofd').run();
const connectInput={apiKey:'dg-secret-key',adAccountId:ACCT,brandId:'ofd',storeId:'s1'};
mock.log.length=0;
check('connect with the switch off is a 409 and calls nothing',await daangn.connectDaangn(who,connectInput).then(()=>false,e=>e.status===409&&/daangn_ads/.test(e.message))&&mock.log.length===0);
await flags.setFeatureFlag(owner,{flag:'daangn_ads',enabled:true},{id:'owner-account',email:null});
check('a member cannot connect (403)',await daangn.connectDaangn(member,connectInput).then(()=>false,e=>e.status===403));
mock.log.length=0;
const connected=plain(await daangn.connectDaangn(who,connectInput,fast));
check('connect verifies with one GET campaigns and stores the key encrypted at store scope; the response has no key',connected.account===ACCT&&connected.storeId==='s1'&&connected.campaigns===2&&mock.log.map(l=>l.method+' '+l.path).join()===`GET ${base}/campaigns`&&!JSON.stringify(connected).includes('dg-secret')&&!sql.prepare("SELECT data FROM records WHERE owner=? AND kind='channel_credential'").get(owner).data.includes('dg-secret'));
check('agency credentials are checked against business-rights',plain(await conn.verifyDaangn({...cred,agency:true},fast)).agencyRight===true);
check('status shows connected without secrets',(s=>s.connected===true&&s.account===ACCT&&!JSON.stringify(s).includes('dg-secret'))(plain(await daangn.daangnStatus(owner,{brandId:'ofd',storeId:'s1'}))));
const nowMs=Date.UTC(2026,10,9,12,0,0);
mock.log.length=0;
let gen=plain(await server.generateProposals(who,{channel:'daangn_ads',campaignId:'c1',storeId:'s1',targetCpa:10000},nowMs,fast));
check('generate reads campaigns → ad groups → performance (campaign, ad_group) and stores 3 daangn proposals',gen.created.length===3&&gen.units===4&&mock.log.map(l=>l.method+' '+l.path).join()===[`GET ${base}/campaigns`,`GET ${base}/ad-groups`,`GET ${base}/reports/performance`,`GET ${base}/reports/performance`].join()&&mock.log.every(l=>l.method==='GET')&&decodeURIComponent(mock.log[2].search).includes('startDate=2026-10-26&endDate=2026-11-08'));
check('the expected rules fired: campaign CPA cut 50,000→45,000, g1 pause, g2 ROAS raise 10,000→11,000',(()=>{const k=Object.fromEntries(gen.created.map(p=>[p.target.ids[0],p]));return k.c1.operation.dailyBudget===45000&&k.g1.operation.status==='PAUSED'&&k.g2.operation.dailyBudget===11000&&!k.g3})());
gen=plain(await server.generateProposals(who,{channel:'daangn_ads',campaignId:'c1',storeId:'s1',targetCpa:10000},nowMs,fast));
check('a second generate skips the open duplicates',gen.created.length===0&&gen.skipped===3);
let list=plain(await server.listProposals(owner,{channel:'daangn_ads'}));
const byId=id=>list.find(p=>p.target.ids[0]===id);
const cutP=byId('c1'),pauseP=byId('g1'),raiseP=byId('g2');
check('daangn proposals live in the same ads_proposal kind under the store',list.length===3&&sql.prepare("SELECT COUNT(*) n FROM records WHERE owner=? AND kind='ads_proposal' AND parent_id='s1'").get(owner).n===3);
await flags.setFeatureFlag(owner,{flag:'daangn_ads',enabled:false},{id:'owner-account',email:null});
check('approve with daangn_ads off is a 409 (even though naver_ads_write is irrelevant)',await server.approveProposal(who,{id:cutP.id}).then(()=>false,e=>e.status===409&&/daangn_ads/.test(e.message)));
check('apply with daangn_ads off is a 409',await server.applyProposal(who,{id:cutP.id},fast).then(()=>false,e=>e.status===409));
check('generate with daangn_ads off is a 409',await server.generateProposals(who,{channel:'daangn_ads',campaignId:'c1',storeId:'s1'},nowMs,fast).then(()=>false,e=>e.status===409));
await flags.setFeatureFlag(owner,{flag:'naver_ads_write',enabled:true},{id:'owner-account',email:null});
check('turning on the naver switch does not open daangn approval',await server.approveProposal(who,{id:cutP.id}).then(()=>false,e=>e.status===409&&/daangn_ads/.test(e.message)));
await flags.setFeatureFlag(owner,{flag:'daangn_ads',enabled:true},{id:'owner-account',email:null});
check('a member cannot approve (403)',await server.approveProposal(member,{id:cutP.id}).then(()=>false,e=>e.status===403));
await flags.setFeatureFlag(owner,{flag:'autonomy_rules',enabled:true},{id:'owner-account',email:null});
await autonomy.saveAutonomySettings(who,{settings:{budget_change:'never'}});
check('budget_change never blocks daangn approval with a 403',await server.approveProposal(who,{id:cutP.id}).then(()=>false,e=>e.status===403&&/예산 변경/.test(e.message)));
await autonomy.saveAutonomySettings(who,{settings:{budget_change:'ask'}});
let a=plain(await server.approveProposal(who,{id:cutP.id}));
check('ask proceeds: approved by the owner',a.proposal.status==='approved'&&a.proposal.approvedBy==='owner-account'&&a.autonomy==='ask');
mock.log.length=0;
let applied=plain(await server.applyProposal(who,{id:cutP.id},fast));
check('apply sends one PATCH dailyBudget then reads the campaign back and marks verified',applied.status==='verified'&&applied.write.state==='done'&&applied.write.attempts===1&&applied.write.providerIds.join()==='c1'&&mock.log.map(l=>l.method+' '+l.path).join()===`PATCH ${base}/campaigns/c1,GET ${base}/campaigns/c1`&&mock.log[0].body.dailyBudget===45000&&mock.campaigns.c1.dailyBudget===45000&&applied.history.map(h=>h.to).join()==='draft,approved,applied,verified');
check('applying an already sent proposal is refused (no resend)',await server.applyProposal(who,{id:cutP.id},fast).then(()=>false,e=>e.status===409&&/다시 보내지 않습니다/.test(e.message)));
// mismatch: 200을 주지만 다시 읽은 예산이 다르다.
await server.approveProposal(who,{id:raiseP.id});
mock.fail=(p,m)=>m==='PATCH'&&p.endsWith('/g2')?Response.json({id:'g2',dailyBudget:11000}):null;
applied=plain(await server.applyProposal(who,{id:raiseP.id},fast));mock.fail=null;
check('a read-back that differs is a mismatch with details',applied.status==='mismatch'&&/10000 ≠ 기대 11000/.test(applied.verification.details[0]));
// unknown → reconcile.
await server.approveProposal(who,{id:pauseP.id});
let sends=0;mock.fail=(p,m)=>{if(m==='PATCH'){sends++;const e=new Error('t');e.name='TimeoutError';throw e}return null};
let unknown=plain(await server.applyProposal(who,{id:pauseP.id},fast));mock.fail=null;
check('a timeout after sending leaves the daangn proposal unknown after one send',unknown.status==='unknown'&&unknown.write.state==='unknown'&&unknown.write.attempts===1&&sends===1);
check('unknown proposals are never resent',await server.applyProposal(who,{id:pauseP.id},fast).then(()=>false,e=>e.status===409)&&sends===1);
await flags.setFeatureFlag(owner,{flag:'daangn_ads',enabled:false},{id:'owner-account',email:null});
let rec=plain(await server.reconcileProposal(who,{id:pauseP.id},fast));
check('reconcile works with the switch off; status still ACTIVE → failed (not applied) after reading the target back',rec.status==='failed'&&rec.verification.status==='mismatch'&&/상태 ACTIVE ≠ 기대 PAUSED/.test(rec.verification.details[0])&&/반영되지 않음/.test(rec.history.at(-1).note));
await flags.setFeatureFlag(owner,{flag:'daangn_ads',enabled:true},{id:'owner-account',email:null});
// 반영돼 있던 unknown은 verified로.
const m=plain(await server.createManualProposal(who,{channel:'daangn_ads',kind:'resume',campaignId:'c1',storeId:'s1',rationale:'멈춘 그룹 재개',operation:{op:'set_status',target:'adgroup',id:'g3',status:'ACTIVE'}}));
check('manual daangn resume proposal is a T3 draft; an invalid operation is a 400',m.riskTier==='T3'&&m.channel==='daangn_ads'&&await server.createManualProposal(who,{channel:'daangn_ads',kind:'create_campaign',campaignId:'c1',rationale:'x',operation:{op:'create_campaign',name:'a',dailyBudget:5}}).then(()=>false,e=>e.status===400&&/1,000/.test(e.message)));
await server.approveProposal(who,{id:m.id});
mock.fail=(p,mt)=>{if(mt==='PATCH'){mock.adgroups.g3.status='ACTIVE';const e=new Error('t');e.name='TimeoutError';throw e}return null};
unknown=plain(await server.applyProposal(who,{id:m.id},fast));mock.fail=null;
rec=plain(await server.reconcileProposal(who,{id:m.id},fast));
check('reconcile that finds the expected state marks applied then verified without resending',unknown.status==='unknown'&&rec.status==='verified'&&rec.history.map(h=>h.to).join()==='draft,approved,unknown,applied,verified');
// 성과 수집 → daangn_ads_performance.
mock.log.length=0;
const perf=plain(await daangn.collectDaangn(who,{storeId:'s1',level:'campaign',targetId:'c1',from:'2026-10-26',to:'2026-11-08'},fast));
check('collect stores a Collected-shaped record with arm, ad spend, orders, limitations and the credential scope',perf.collected.arm.denominator===10000&&perf.collected.arm.numerator===100&&perf.collected.storeValues.adSpend===40000&&perf.collected.storeValues.orders===2&&perf.collected.limitations.some(l=>/가정/.test(l))&&perf.resolvedScope.level==='store'&&sql.prepare("SELECT COUNT(*) n FROM records WHERE owner=? AND kind='daangn_ads_performance' AND parent_id='s1'").get(owner).n===1&&mock.log.every(l=>l.method==='GET'));
check('collect validates the level and window before calling out',await daangn.collectDaangn(who,{storeId:'s1',level:'keyword',targetId:'c1'}).then(()=>false,e=>e.status===400)&&await daangn.collectDaangn(who,{storeId:'s1',targetId:'c1',from:'2026-11-08',to:'2026-11-01'}).then(()=>false,e=>e.status===400));
check('naver proposals are untouched by the channel split (listing by channel)',plain(await server.listProposals(owner,{channel:'naver_ads'})).length===0);

// 7) HTTP: /api/daangn-ads와 /api/ads-proposals?channel=daangn_ads.
const call=async res=>({status:res.status,body:await res.json()});
const legacy={'oai-authenticated-user-id':owner,origin:'https://agency.test'};
const dget=(q,h=legacy)=>daangnRoute.GET(new Request('https://agency.test/api/daangn-ads'+q,{headers:h})).then(call);
const dpost=(input,h=legacy)=>daangnRoute.POST(new Request('https://agency.test/api/daangn-ads',{method:'POST',headers:{'content-type':'application/json',...h},body:JSON.stringify(input)})).then(call);
const pget=(q,h=legacy)=>proposalsRoute.GET(new Request('https://agency.test/api/ads-proposals'+q,{headers:h})).then(call);
let r=await dget('?brandId=ofd&storeId=s1');
check('GET /api/daangn-ads shows the connection and stored performance without secrets',r.status===200&&r.body.status.connected===true&&r.body.performance.length===1&&!JSON.stringify(r.body).includes('dg-secret'));
r=await pget('?channel=daangn_ads');
check('GET /api/ads-proposals?channel=daangn_ads lists only daangn proposals with per-channel switch state',r.status===200&&r.body.proposals.length===4&&r.body.proposals.every(p=>p.channel==='daangn_ads')&&r.body.enabledByChannel.daangn_ads===true);
r=await dpost({action:'dance'});
check('an unknown daangn action is a 400',r.status===400&&/connect/.test(r.body.error));
r=await dpost({action:'collect',storeId:'s1',targetId:'c1'},{...legacy,origin:'https://evil.test'});
check('cross-origin daangn write is a 403',r.status===403);
check('unauthenticated read is a 401',(await dget('',{})).status===401);
env.AUTH_MODE='email';env.AUTH_ORIGIN='https://agency.test';
const signIn=(id,role)=>{const token=createHash('sha256').update(id).digest('hex');sql.prepare('INSERT INTO auth_users(id,email,workspace_owner,role,status,created_at) VALUES(?,?,?,?,?,?)').run(id,id+'@test.invalid',owner,role,'active',1000);sql.prepare('INSERT INTO auth_sessions VALUES(?,?,?,?)').run(createHash('sha256').update(token).digest('hex'),id,Date.now()+60000,Date.now());return {cookie:'__Host-collective_session='+token,origin:'https://agency.test'}};
const memberS=signIn('dg-member','member'),adminS=signIn('dg-admin','admin');
check('member GET and POST are 403',(await dget('',memberS)).status===403&&(await dpost({action:'revoke'},memberS)).status===403);
await flags.setFeatureFlag(owner,{flag:'daangn_ads',enabled:false},{id:'owner-account',email:null});
r=await dpost({action:'collect',storeId:'s1',targetId:'c1'},adminS);
check('admin collect with the switch off is a 409',r.status===409);
r=await dpost({action:'revoke',brandId:'ofd',storeId:'s1'},adminS);
check('revoke works with the switch off and removes the credential',r.status===200&&r.body.revoked===true&&plain(await daangn.daangnStatus(owner,{brandId:'ofd',storeId:'s1'})).connected===false);

// 8) 레지스트리 문서·스위치·기능 상태·레코드 종류.
check('record kind daangn_ads_performance is store-scoped and outside campaign deletion',(()=>{const k=plain(kinds.recordKinds).find(k=>k.kind==='daangn_ads_performance');return k&&k.parent==='store'&&k.campaignDeletion==='not_campaign_scoped'})());
check('flag daangn_ads defaults off and the feature row follows it',featureFlags.FEATURE_FLAGS.daangn_ads.defaultEnabled===false&&status.featureRows({flags:[{flag:'daangn_ads',enabled:false}]}).find(r=>r.key==='daangn-ads').status==='blocked'&&status.featureRows({flags:[{flag:'daangn_ads',enabled:true}]}).find(r=>r.key==='daangn-ads').status==='available');
const doc=readFileSync('docs/DAANGN-ADS.ko.md','utf8');
check('docs/DAANGN-ADS.ko.md records the assumptions, limits and API',['x-api-key','분당 60','초당 100','429','unknown','business-rights','daangn_ads','가정','/api/daangn-ads','channel'].every(w=>doc.includes(w)));
check('no secret ever reached a proposal or performance record',!sql.prepare("SELECT GROUP_CONCAT(data) d FROM records WHERE owner=? AND kind IN ('ads_proposal','daangn_ads_performance')").get(owner).d.includes('dg-secret'));

console.log(JSON.stringify({passed:passed.length,checks:passed},null,2));
