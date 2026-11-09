// C4 네이버 검색광고 쓰기: 서명(알려진 벡터·POST/PUT), 작업별 요청 빌더, 429 Retry-After·지터 백오프, 보낸 뒤 타임아웃=unknown·재시도 없음,
// 읽기 대조 verified/mismatch, 계약 하네스 5 시나리오(실제 빌더 경유), 레지스트리 서술자, 기존 GET(collect) 동작 불변. 근거: mocked(fetch 스텁), 네트워크 0회.
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {testRuntime} from './helpers/runtime.mjs';

let handler=async()=>{throw new Error('fetch 스텁이 설정되지 않았습니다')};
const seen=[];
const rt=testRuntime(async(url,init={})=>{seen.push({url:String(url),method:init.method||'GET',headers:new Headers(init.headers),body:typeof init.body==='string'?JSON.parse(init.body):undefined});return handler(String(url),init)});
const ads=await rt.load('lib/connectors/naver-ads.ts'),write=await rt.load('lib/connectors/naver-ads-write.ts'),contract=await rt.load('lib/connectors/contract-test.ts'),registry=await rt.load('lib/connectors/registry.ts');
const passed=[];const check=(name,value)=>{assert.ok(value,name);passed.push(name)};
const plain=v=>JSON.parse(JSON.stringify(v));
const cred={channel:'naver_ads',apiKey:'api-key',secretKey:'secret-key',customerId:'12345'};
const hmac=(secret,ts,method,path)=>createHmac('sha256',secret).update(`${ts}.${method}.${path}`).digest('base64');

// 1) 서명: 알려진 벡터(node:crypto로 독립 계산·고정 리터럴). 쿼리는 서명에 들어가지 않는다.
check('POST signing matches the fixed vector',await ads.sign('secret-key','1700000000000','POST','/ncc/campaigns')==='IITf6f01hU1KAVmSvF/wEu3+B2Uwq2XEwyIR0kqysEM=');
check('GET signing matches the fixed vector',await ads.sign('secret-key','1700000000000','GET','/ncc/campaigns')==='d+rnFFSO+vdHJzC7Vj4OS4MeavQXK33pncpZhKXx0kg=');
check('PUT signing equals an independent HMAC-SHA256 base64',await ads.sign('k2','1','PUT','/ncc/keywords')===hmac('k2','1','PUT','/ncc/keywords'));
const headers=await ads.signedHeaders(cred,'PUT','/ncc/keywords','1700000000000');
check('signed headers carry timestamp, api key, customer id, signature and json content type',headers['X-Timestamp']==='1700000000000'&&headers['X-API-KEY']==='api-key'&&headers['X-Customer']==='12345'&&headers['X-Signature']===hmac('secret-key','1700000000000','PUT','/ncc/keywords')&&headers['Content-Type']==='application/json');
handler=async()=>Response.json([{nccKeywordId:'k1'}]);
seen.length=0;
await ads.signedRequest(cred,'PUT','/ncc/keywords',{query:'?fields=bidAmt',body:[{nccKeywordId:'k1',bidAmt:900}],now:()=>1700000000000});
check('signedRequest sends method, host+path+query, JSON body and a signature over the path without the query',seen[0].method==='PUT'&&seen[0].url==='https://api.searchad.naver.com/ncc/keywords?fields=bidAmt'&&seen[0].body[0].bidAmt===900&&seen[0].headers.get('X-Signature')===hmac('secret-key','1700000000000','PUT','/ncc/keywords')&&seen[0].headers.get('X-Timestamp')==='1700000000000');

// 2) 요청 빌더: 작업마다 공식 샘플과 같은 경로·쿼리·본문. 잘못된 입력은 보내기 전에 거절.
const b=op=>plain(write.buildWriteRequest(op,'12345'));
let r=b({op:'create_campaign',name:'봄 신메뉴',campaignType:'PLACE',dailyBudget:10000});
check('create_campaign posts /ncc/campaigns with campaignTp, numeric customerId and daily budget',r.method==='POST'&&r.path==='/ncc/campaigns'&&r.query===''&&r.body.campaignTp==='PLACE'&&r.body.customerId===12345&&r.body.useDailyBudget===true&&r.body.dailyBudget===10000&&r.body.name==='봄 신메뉴');
check('create_campaign without a budget keeps useDailyBudget false',b({op:'create_campaign',name:'x',campaignType:'WEB_SITE'}).body.useDailyBudget===false);
r=b({op:'create_adgroup',campaignId:'cmp-1',name:'그룹',adgroupType:'LOCAL_AD',pcChannelId:'ch-pc',mobileChannelId:'ch-m',bidAmt:300});
check('create_adgroup posts /ncc/adgroups with campaign, channels, LOCAL_AD type and bid',r.path==='/ncc/adgroups'&&r.body.nccCampaignId==='cmp-1'&&r.body.adgroupType==='LOCAL_AD'&&r.body.pcChannelId==='ch-pc'&&r.body.mobileChannelId==='ch-m'&&r.body.bidAmt===300);
r=b({op:'create_keywords',adgroupId:'grp-1',keywords:[{keyword:'휘경동 떡볶이',bidAmt:200},{keyword:'회기역 분식'}]});
check('create_keywords posts an array to /ncc/keywords?nccAdgroupId= with per-keyword or group bids',r.method==='POST'&&r.path==='/ncc/keywords'&&r.query==='?nccAdgroupId=grp-1'&&r.body.length===2&&r.body[0].bidAmt===200&&r.body[0].useGroupBidAmt===false&&r.body[1].useGroupBidAmt===true&&r.body[1].bidAmt===undefined);
r=b({op:'update_bid',keywordIds:['k1','k2'],bidAmt:900});
check('update_bid puts /ncc/keywords?fields=bidAmt with one row per keyword',r.method==='PUT'&&r.path==='/ncc/keywords'&&r.query==='?fields=bidAmt'&&JSON.stringify(r.body)==='[{"nccKeywordId":"k1","bidAmt":900,"useGroupBidAmt":false},{"nccKeywordId":"k2","bidAmt":900,"useGroupBidAmt":false}]');
r=b({op:'set_user_lock',target:'keyword',ids:['k1'],userLock:true});
check('keyword pause puts /ncc/keywords?fields=userLock',r.method==='PUT'&&r.query==='?fields=userLock'&&r.body[0].nccKeywordId==='k1'&&r.body[0].userLock===true);
r=b({op:'set_user_lock',target:'campaign',ids:['cmp-1'],userLock:false});
check('campaign resume puts the single-item path /ncc/campaigns/{id}?fields=userLock',r.path==='/ncc/campaigns/cmp-1'&&r.query==='?fields=userLock'&&r.body.userLock===false);
check('adgroup lock uses /ncc/adgroups/{id}',b({op:'set_user_lock',target:'adgroup',ids:['g1'],userLock:true}).path==='/ncc/adgroups/g1');
r=b({op:'create_ad',adgroupId:'grp-1',creative:{type:'TEXT_45',headline:'제목',description:'설명',pcFinalUrl:'https://ex.test/p',mobileFinalUrl:'https://ex.test/m'}});
check('TEXT_45 ad posts /ncc/ads with headline, description and final urls',r.path==='/ncc/ads'&&r.body.type==='TEXT_45'&&r.body.ad.headline==='제목'&&r.body.ad.pc.final==='https://ex.test/p'&&r.body.ad.mobile.final==='https://ex.test/m');
check('LOCAL_AD place creative posts description and images',(()=>{const x=b({op:'create_ad',adgroupId:'g',creative:{type:'LOCAL_AD',description:'플레이스 설명',images:['https://img.test/1.jpg']}});return x.body.type==='LOCAL_AD'&&x.body.ad.description==='플레이스 설명'&&x.body.ad.images.length===1})());
const refused=op=>{try{write.buildWriteRequest(op,'1');return null}catch(e){return e.message}};
check('101 keywords are refused',/1~100/.test(refused({op:'create_keywords',adgroupId:'g',keywords:Array.from({length:101},(_,i)=>({keyword:'k'+i}))})||''));
check('bids outside 70~100,000 or off the 10-won step are refused',/70~100,000/.test(refused({op:'update_bid',keywordIds:['k'],bidAmt:65})||'')&&/70~100,000/.test(refused({op:'update_bid',keywordIds:['k'],bidAmt:200000})||'')&&/10원/.test(refused({op:'update_bid',keywordIds:['k'],bidAmt:105})||''));
check('campaign lock takes exactly one id and bad ids are refused',/1~1개/.test(refused({op:'set_user_lock',target:'campaign',ids:['a','b'],userLock:true})||'')&&/형식/.test(refused({op:'update_bid',keywordIds:['bad id!'],bidAmt:100})||''));
check('non-http final url and unknown operation are refused',/http/.test(refused({op:'create_ad',adgroupId:'g',creative:{type:'TEXT_45',headline:'h',description:'d',pcFinalUrl:'javascript:x',mobileFinalUrl:'https://a.test'}})||'')&&/지원하지/.test(refused({op:'nope'})||''));

// 3) 실행: 429(Retry-After 1초) → 429(없음) → 200. 대기는 Retry-After·지터 순이고 세 번째에 성공한다.
const deps=()=>{const waits=[];let t=1700000000000;return {deps:{now:()=>t,random:()=>0.5,sleep:async ms=>{waits.push(ms);t+=ms}},waits}};
let n=0;handler=async()=>{n++;if(n===1)return new Response('',{status:429,headers:{'retry-after':'1'}});if(n===2)return new Response('',{status:429});return Response.json([{nccKeywordId:'k1',bidAmt:900}])};
let d=deps();let res=await write.executeWrite(cred,{op:'update_bid',keywordIds:['k1'],bidAmt:900},d.deps);
// 두 번째 대기는 base 500ms × 2^(2-1) × 지터 1.0(random 0.5) = 1000ms.
check('429 twice then success: Retry-After wait then jittered wait, provider ids captured',res.outcome==='success'&&res.attempts===3&&JSON.stringify(res.waits)==='[1000,1000]'&&res.providerIds.join()==='k1'&&res.httpStatus===200&&res.error===null);
n=0;handler=async()=>new Response('',{status:429,headers:{'retry-after':'2'}});
res=await write.executeWrite(cred,{op:'update_bid',keywordIds:['k1'],bidAmt:900},deps().deps);
check('persistent 429 stops at maxAttempts with a Korean rate-limit error',res.outcome==='rate_limited'&&res.attempts===3&&/429/.test(res.error));
// 보낸 뒤 타임아웃: unknown, 1회, 저널(onBeforeSend)이 보내기 전에 1회 불린다. 재시도 없음.
let sends=0,journal=[];handler=async()=>{sends++;const e=new Error('timeout');e.name='TimeoutError';throw e};
res=await write.executeWrite(cred,{op:'set_user_lock',target:'keyword',ids:['k1'],userLock:true},{...deps().deps,onBeforeSend:async a=>{journal.push(a)}});
check('a timeout after sending is unknown, sent once, journaled before sending and never retried',res.outcome==='unknown'&&res.attempts===1&&sends===1&&journal.join()==='1'&&/읽기 대조/.test(res.error)&&res.providerIds.length===0);
sends=0;handler=async()=>{sends++;throw new TypeError('fetch failed')};
res=await write.executeWrite(cred,{op:'update_bid',keywordIds:['k1'],bidAmt:900},deps().deps);
check('a generic network error on a write is also unknown (cannot prove it was not sent) and not retried',res.outcome==='unknown'&&sends===1);
handler=async()=>new Response('',{status:503});
res=await write.executeWrite(cred,{op:'update_bid',keywordIds:['k1'],bidAmt:900},deps().deps);
check('5xx on a write is unknown without retry',res.outcome==='unknown'&&res.attempts===1);
handler=async()=>Response.json({code:1018,title:'Invalid Request',detail:'bidAmt out of range'},{status:400});
res=await write.executeWrite(cred,{op:'update_bid',keywordIds:['k1'],bidAmt:900},deps().deps);
check('4xx is fatal once with the provider detail surfaced',res.outcome==='fatal'&&res.attempts===1&&res.httpStatus===400&&/1018 · Invalid Request · bidAmt out of range/.test(res.error));
check('the queue key is per customer id',(()=>{const s=res.state;return Object.keys(s).join()==='naver_ads:12345'})());
sends=0;handler=async()=>{sends++;return Response.json({})};
await write.executeWrite(cred,{op:'update_bid',keywordIds:[],bidAmt:900},deps().deps).then(()=>assert.fail('should refuse'),e=>assert.equal(e.name,'NaverAdsWriteError'));
assert.equal(sends,0);passed.push('invalid operation refused before any fetch');

// 4) 읽기 대조(순수)와 readBack(GET 경유).
const v=write.verifyReadBack;
check('bid read-back equal → verified',v({op:'update_bid',keywordIds:['k1','k2'],bidAmt:900},[],[{nccKeywordId:'k1',bidAmt:900},{nccKeywordId:'k2',bidAmt:900}]).status==='verified');
check('bid read-back different or missing → mismatch with details',(()=>{const m=v({op:'update_bid',keywordIds:['k1','k2'],bidAmt:900},[],[{nccKeywordId:'k1',bidAmt:1000}]);return m.status==='mismatch'&&m.details.length===2&&/1000 ≠ 기대 900/.test(m.details[0])})());
check('lock read-back compares userLock',v({op:'set_user_lock',target:'campaign',ids:['c1'],userLock:true},[],[{nccCampaignId:'c1',userLock:true}]).status==='verified'&&v({op:'set_user_lock',target:'campaign',ids:['c1'],userLock:true},[],[{nccCampaignId:'c1',userLock:false}]).status==='mismatch');
check('created keywords must appear in the adgroup list',v({op:'create_keywords',adgroupId:'g',keywords:[{keyword:'a'},{keyword:'b'}]},[],[{keyword:'a'}]).details.join()==="키워드 'b'가 광고그룹에 없습니다.");
check('created campaign needs its provider id in the read-back',v({op:'create_campaign',name:'n',campaignType:'PLACE'},['cmp-9'],[{nccCampaignId:'cmp-9'}]).status==='verified'&&v({op:'create_campaign',name:'n',campaignType:'PLACE'},[],[]).status==='mismatch');
seen.length=0;handler=async url=>Response.json(url.includes('/ncc/keywords/k1')?{nccKeywordId:'k1',bidAmt:900}:{nccKeywordId:'k2',bidAmt:900});
const observed=await write.readBack(cred,{op:'update_bid',keywordIds:['k1','k2'],bidAmt:900},[]);
check('readBack GETs each keyword with a GET-signed request',observed.length===2&&seen.every(s=>s.method==='GET'&&s.headers.get('X-Signature')===hmac('secret-key',s.headers.get('X-Timestamp'),'GET',new URL(s.url).pathname))&&seen.map(s=>new URL(s.url).pathname).join()==='/ncc/keywords/k1,/ncc/keywords/k2');
check('providerIdsOf collects ids from arrays and objects',write.providerIdsOf({op:'create_keywords',adgroupId:'g',keywords:[]},[{nccKeywordId:'a'},{nccKeywordId:'b'}]).join()==='a,b'&&write.providerIdsOf({op:'create_campaign',name:'n',campaignType:'PLACE'},{nccCampaignId:'c'}).join()==='c');

// 5) 레지스트리 서술자와 계약 하네스(실제 빌더 경유, 스크립트 transport).
const cap=registry.capabilityFor('naver_ads.ncc.write');
check('registry lists the write capability as T3, default off, flag naver_ads_write, store-scoped, no unknown retry',cap&&cap.riskTier==='T3'&&cap.defaultOff===true&&cap.retryUnknown===false&&cap.flag==='naver_ads_write'&&cap.credentialScope==='store'&&['campaign','adgroup','keyword','bid','lock'].every(w=>cap.writes.includes(w)));
check('registry has no violations after the addition and the naver write is not T4 (T4 stays Meta money moves and Kakao customer sends)',registry.describeViolations().length===0&&registry.capabilitiesByTier('T4').every(c=>c.key.startsWith('meta_ads.')||c.key.startsWith('kakao_bizmessage.')));
const caps=registry.descriptorFor('naver_ads').capabilities;
const requests=[];
const factory=script=>{const calls={};const transport=async(request,op)=>{requests.push({id:op.id,method:request.method,path:request.path,query:request.query});const steps=script[op.id]??[{kind:'thrown'}];return steps[Math.min(calls[op.id]=(calls[op.id]??0)+1,steps.length)-1]};
 const inner=write.naverAdsContractConnector(caps,'12345',transport);return {...inner,calls:inner.calls,execute:(op,attempt)=>inner.execute({...op,payload:op.payload??{op:'update_bid',keywordIds:['k1'],bidAmt:900}},attempt)}};
const results=await contract.runContractScenarios(factory,{read:'naver_ads.stats.read',write:'naver_ads.ncc.write'});
check('contract harness runs the five scenarios against the write connector',results.map(r=>r.scenario).join()==='success,failure,timeout,restart_resume,duplicate_idempotent');
for(const s of results)check(`contract scenario ${s.scenario} passes: ${s.details.join(' | ')||'ok'}`,s.passed);
check('write scenarios went through the real request builder (PUT /ncc/keywords?fields=bidAmt) and reads used GET',requests.filter(q=>q.id.startsWith('w-')).every(q=>q.method==='PUT'&&q.path==='/ncc/keywords'&&q.query==='?fields=bidAmt')&&requests.filter(q=>q.id.startsWith('r-')).every(q=>q.method==='GET'));

// 6) 기존 GET 수집(collect)은 그대로: /stats GET, GET 서명, 지표 매핑. 인증 실패는 ConnectorAuthError(400).
seen.length=0;handler=async url=>url.includes('/stats')?Response.json([{impCnt:1000,clkCnt:50,salesAmt:30000,ccnt:3}]):Response.json([]);
const collected=plain(await ads.naverAds.collect(cred,'cmp-1',{from:'2026-10-01',to:'2026-10-14'}));
check('collect still GETs /stats with the GET signature and maps metrics',seen.length===1&&seen[0].method==='GET'&&new URL(seen[0].url).pathname==='/stats'&&seen[0].headers.get('X-Signature')===hmac('secret-key',seen[0].headers.get('X-Timestamp'),'GET','/stats')&&collected.arm.denominator===1000&&collected.arm.numerator===50&&collected.storeValues.adSpend===30000&&collected.storeValues.orders===3&&seen[0].body===undefined);
handler=async()=>new Response('',{status:401});
check('verify maps 401 to the connector auth error',await ads.naverAds.verify(cred).then(()=>false,e=>e.status===400&&/인증에 실패/.test(e.message)));
handler=async()=>Response.json([{nccCampaignId:'c'}]);
check('verify succeeds on 2xx and returns the customer id',(await ads.naverAds.verify(cred)).account==='12345');

console.log(JSON.stringify({passed:passed.length,checks:passed},null,2));
