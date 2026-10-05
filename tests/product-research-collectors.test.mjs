// 상품 리서치 수집기 회귀(lib/product-research/collectors/*, credentials.ts). 근거: mocked — 가짜 fetch가 요청 URL·헤더·본문을 기록하고 고정 응답(tests/fixtures/product-research)을 준다.
// 실제 네트워크는 부르지 않는다(런타임 전역 fetch는 호출되면 던진다). 서명(검색광고 base64·쿠팡 hex)은 node:crypto로 따로 계산해 맞춘다.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash,createHmac} from 'node:crypto';
import {testRuntime} from './helpers/runtime.mjs';

const rt=testRuntime(async()=>{throw new Error('외부 호출 금지: 수집기는 deps.fetch만 써야 합니다')});
const c=await rt.load('lib/product-research/collectors/index.ts');
const cr=await rt.load('lib/product-research/credentials.ts');
let passed=0;const check=(v,n)=>{assert.ok(v,n);passed++};
const plain=v=>JSON.parse(JSON.stringify(v));
const fixture=f=>readFileSync('tests/fixtures/product-research/'+f,'utf8');
const sha=t=>createHash('sha256').update(t,'utf8').digest('hex');
const NOW=new Date('2026-10-03T03:04:05.678Z');
function fakeFetch(responder){
 const calls=[];
 const fn=async(url,init={})=>{calls.push({url:String(url),method:init.method||'GET',headers:Object.fromEntries(new Headers(init.headers).entries()),body:init.body??null,redirect:init.redirect,hasSignal:Boolean(init.signal)});return responder(String(url),init)};
 return {calls,deps:{fetch:fn,now:()=>NOW}};
}
const json=(body,status=200,headers={})=>new Response(typeof body==='string'?body:JSON.stringify(body),{status,headers:{'content-type':'application/json',...headers}});
async function rejects(promise,code,name){
 try{await promise}catch(e){assert.equal(e.code,code,`${name}: ${e.code} ${e.message}`);passed++;return e}
 assert.fail(name+': 거절되지 않았습니다');
}
const obs=(draft,pred,metric)=>draft.observations.filter(o=>o.metric===metric&&pred(o.subject));
const kw=text=>s=>s.type==='keyword'&&s.text===text;
const listing=id=>s=>s.type==='listing'&&s.externalId===id;
const one=(draft,pred,metric)=>{const found=obs(draft,pred,metric);assert.equal(found.length,1,`${metric} 관측 1개`);return found[0]};

// ── 검색광고 키워드 도구 ──
const sa={kind:'naver_searchad',apiKey:'0100000000abcdefabcdef',secretKey:'AQAAAAB-secret-key-synthetic==',customerId:'1234567'};
{
 const f=fakeFetch(()=>json({}));
 await rejects(c.collectSearchadKeywords(sa,['마라소스'],f.deps),'not_allowed','searchad: MD policy blocks collection');
 check(f.calls.length===0,'searchad: policy denied before HTTP');
 check(c.parseQcCnt('< 10')===null&&c.parseQcCnt(0)===0&&c.parseQcCnt('1,234')===1234&&c.parseQcCnt(-1)===null&&c.compIdxValue('high')===null,'searchad: parseQcCnt/compIdxValue edge cases');
 const g=fakeFetch(()=>json({}));
 await rejects(c.collectSearchadKeywords(sa,['a','b','c','d','e','f'],g.deps),'input','searchad: 6 hints rejected');
 await rejects(c.collectSearchadKeywords(sa,['  '],g.deps),'input','searchad: empty hints rejected');
 check(g.calls.length===0,'searchad: invalid input never fetches');
}

// ── 데이터랩 ──
const dev={kind:'naver_developers',clientId:'synthClientId01',clientSecret:'synthSecret'};
{
 const f=fakeFetch(()=>json(fixture('datalab-search.json')));
 const input={startDate:'2026-07-01',endDate:'2026-09-30',timeUnit:'month',keywordGroups:[{groupName:'마라소스',keywords:['마라소스','마라 소스']},{groupName:'불닭소스',keywords:['불닭소스']}]};
 const r=plain(await c.collectDatalabSearch(dev,input,f.deps)),call=f.calls[0];
 check(call.url==='https://openapi.naver.com/v1/datalab/search'&&call.method==='POST','datalab search: fixed URL, POST');
 check(call.headers['x-naver-client-id']===dev.clientId&&call.headers['x-naver-client-secret']===dev.clientSecret&&call.headers['content-type']==='application/json','datalab: client id/secret headers');
 assert.deepEqual(JSON.parse(call.body),{startDate:'2026-07-01',endDate:'2026-09-30',timeUnit:'month',keywordGroups:input.keywordGroups});passed++;
 const aug=obs(r.draft,kw('마라소스'),'search_trend').find(o=>o.period.from==='2026-08-01');
 check(aug.value===82.5&&aug.period.to==='2026-08-31','datalab: month point period spans the month');
 check(obs(r.draft,kw('마라소스'),'search_trend').find(o=>o.period.from==='2026-09-01').period.to==='2026-09-30','datalab: last month clipped to endDate');
 check(obs(r.draft,kw('불닭소스'),'search_trend').length===2&&!obs(r.draft,kw('불닭소스'),'search_trend').some(o=>o.period.from==='2026-08-01'),'datalab: missing point not filled with 0');
 check(r.draft.status==='partial'&&r.draft.limitations.some(l=>l.includes('상대값'))&&r.draft.limitations.some(l=>l.includes('불닭소스')),'datalab: relative-value limitation and partial for short group');
 check(r.unitsUsed===1&&r.draft.sourceId==='naver_datalab_search','datalab: 1 unit per call');
 const g=fakeFetch(()=>json({}));
 const groups=n=>Array.from({length:n},(_,i)=>({groupName:'g'+i,keywords:['k'+i]}));
 await rejects(c.collectDatalabSearch(dev,{...input,keywordGroups:groups(6)},g.deps),'input','datalab: >5 groups rejected');
 await rejects(c.collectDatalabSearch(dev,{...input,keywordGroups:[{groupName:'x',keywords:Array.from({length:21},(_,i)=>'k'+i)}]},g.deps),'input','datalab: >20 keywords rejected');
 await rejects(c.collectDatalabSearch(dev,{...input,startDate:'2026-10-01'},g.deps),'input','datalab: start after end rejected');
 await rejects(c.collectDatalabSearch(dev,{...input,timeUnit:'year'},g.deps),'input','datalab: timeUnit must be date|week|month');
 await rejects(c.collectDatalabSearch(dev,{...input,startDate:'2026-02-30'},g.deps),'input','datalab: impossible date rejected');
 check(g.calls.length===0,'datalab: invalid input never fetches');
}
{
 const f=fakeFetch(()=>json(fixture('datalab-shopping-categories.json')));
 const r=plain(await c.collectDatalabShoppingCategories(dev,{startDate:'2026-09-01',endDate:'2026-09-14',timeUnit:'week',categories:[{name:'소스',code:'50000146'}]},f.deps)),call=f.calls[0];
 check(call.url==='https://openapi.naver.com/v1/datalab/shopping/categories'&&JSON.parse(call.body).category[0].param[0]==='50000146','datalab shopping: categories URL and body');
 const pts=obs(r.draft,kw('소스'),'shopping_click_trend');
 check(pts.length===2&&pts[0].period.to==='2026-09-07'&&pts[1].value===91.3&&pts[1].period.to==='2026-09-14'&&pts[0].scope==='category:50000146','datalab shopping: weekly periods and category scope');
 check(r.draft.status==='ok'&&r.draft.sourceId==='naver_datalab_shopping'&&r.draft.limitations.some(l=>l.includes('판매량이 아닙니다')),'datalab shopping: ok with click limitation');
 const k=fakeFetch(()=>json(fixture('datalab-shopping-keywords.json')));
 const rk=plain(await c.collectDatalabShoppingKeywords(dev,{startDate:'2026-09-01',endDate:'2026-09-02',timeUnit:'date',categoryCode:'50000006',keywords:[{name:'마라',keyword:'마라소스'}]},k.deps));
 const body=JSON.parse(k.calls[0].body);
 check(k.calls[0].url==='https://openapi.naver.com/v1/datalab/shopping/category/keywords'&&body.category==='50000006'&&body.keyword[0].param[0]==='마라소스','datalab shopping: category/keywords URL and body');
 const day2=obs(rk.draft,kw('마라'),'shopping_click_trend').find(o=>o.period.from==='2026-09-02');
 check(day2.value===null&&day2.period.to==='2026-09-02'&&rk.draft.status==='partial','datalab shopping: invalid ratio → null + partial');
 const g=fakeFetch(()=>json({}));
 await rejects(c.collectDatalabShoppingCategories(dev,{startDate:'2026-09-01',endDate:'2026-09-14',timeUnit:'week',categories:[1,2,3,4].map(i=>({name:'c'+i,code:'5000000'+i}))},g.deps),'input','datalab shopping: >3 categories rejected');
 await rejects(c.collectDatalabShoppingKeywords(dev,{startDate:'2026-09-01',endDate:'2026-09-02',timeUnit:'date',categoryCode:'식품',keywords:[{name:'a',keyword:'a'}]},g.deps),'input','datalab shopping: non-numeric category rejected');
 check(g.calls.length===0,'datalab shopping: invalid input never fetches');
}

// 종료된 쇼핑 검색은 저장 이력만 유지하고 직접 호출도 네트워크 전에 막는다.
{const f=fakeFetch(()=>json(fixture('shop-search.json')));await rejects(c.collectShopSearch(dev,'마라소스',f.deps),'not_allowed','retired shop blocked');check(f.calls.length===0,'retired shop never fetches');check(c.stripTags('<b>a</b> &lt;b&gt; &quot;x&quot;')==='a <b> "x"','historical shop text sanitizer retained');}

// ── YouTube ──
const yt={kind:'youtube',apiKey:'AIzaSyD-synthetic-key-000000000000000'};
{
 const f=fakeFetch(()=>json({}));
 await rejects(c.discoverYoutubeVideos(yt,{keyword:'마라소스',publishedAfter:'2026-09-01T00:00:00Z'},f.deps),'not_allowed','youtube search: MD policy denies collection');
 check(f.calls.length===0,'youtube search: policy denied before HTTP');
 const g=fakeFetch(()=>json({}));
 await rejects(c.discoverYoutubeVideos(yt,{keyword:'a',publishedAfter:'2026-09-01T00:00:00Z',maxResults:26},g.deps),'input','youtube search: maxResults ≤25');
 await rejects(c.discoverYoutubeVideos(yt,{keyword:'a',publishedAfter:'2027-01-01T00:00:00Z'},g.deps),'input','youtube search: future window rejected');
 const ids=['abcdefghij1','abcdefghij2','abcdefghij3'];
 await rejects(c.trackYoutubeVideos(yt,ids,g.deps),'not_allowed','youtube tracking: MD policy denies collection');
 await rejects(c.trackYoutubeVideos(yt,Array.from({length:51},(_,i)=>'abcdefghi'+String(i).padStart(2,'0')),g.deps),'input','youtube videos: >50 ids rejected');
 await rejects(c.trackYoutubeVideos(yt,['bad id'],g.deps),'input','youtube videos: invalid id rejected');
 check(g.calls.length===0,'youtube: invalid input never fetches');
 const q=fakeFetch(()=>json({error:{code:403,errors:[{reason:'quotaExceeded'}]}},403));
 await rejects(c.trackYoutubeVideos(yt,ids,q.deps),'not_allowed','youtube: policy blocks even quota response');
 check(q.calls.length===0,'youtube: no quota-consuming request');
}

// ── 데이터랩 주 단위 창 고정(평가 1회차 M2): 같은 주에 이틀 수집해도 시계열 점이 늘지 않는다
{
 const S=await rt.load('lib/product-research/analytics/series.ts'),DL=await rt.load('lib/product-research/collectors/naver-datalab.ts');
 const DAY=86400000,iso=t=>new Date(t).toISOString().slice(0,10);
 // 수집 계획과 같은 창: 끝 = 한국 날짜 어제, 시작 = 끝 − (104×7 − 1)일
 const planned=kstToday=>{const end=Date.parse(kstToday+'T00:00:00Z')-DAY;return {startDate:iso(end-(104*7-1)*DAY),endDate:iso(end)}};
 // 응답: 요청 창의 주마다 점 하나. 수집일마다 다른 정규화(재정규화)를 흉내 낸다.
 const responder=scale=>(url,init)=>{const b=JSON.parse(init.body),data=[];for(let t=Date.parse(b.startDate+'T00:00:00Z'),i=0;t<=Date.parse(b.endDate+'T00:00:00Z');t+=7*DAY,i++)data.push({period:iso(t),ratio:Math.round(Math.min(100,(20+i*0.5)*scale)*100)/100});return json({startDate:b.startDate,endDate:b.endDate,timeUnit:'week',results:[{title:'마라소스',keywords:['마라소스'],data}]})};
 const collect=async(kstToday,scale,id)=>{const f=fakeFetch(responder(scale));const r=plain(await c.collectDatalabSearch(dev,{...planned(kstToday),timeUnit:'week',keywordGroups:[{groupName:'마라소스',keywords:['마라소스']}]},f.deps));return {body:JSON.parse(f.calls[0].body),snap:{...r.draft,id,fetchedAt:kstToday+'T01:00:00.000Z',importedBy:null}}};
 const tue=await collect('2026-09-29',1,'dl-tue'),wed=await collect('2026-09-30',0.9,'dl-wed'),mon=await collect('2026-10-05',0.8,'dl-mon');
 check(tue.body.startDate===wed.body.startDate&&tue.body.endDate===wed.body.endDate,'datalab week: two days in the same week request the same window');
 check(tue.body.endDate==='2026-09-27'&&new Date(tue.body.endDate+'T00:00:00Z').getUTCDay()===0&&new Date(tue.body.startDate+'T00:00:00Z').getUTCDay()===1,'datalab week: window ends on Sunday and starts on Monday (KST dates)');
 check((Date.parse(tue.body.endDate)-Date.parse(tue.body.startDate))/DAY+1===104*7,'datalab week: fixed 104-week length');
 check(tue.snap.limitations.some(l=>l.includes('월요일 시작')),'datalab week: moved window is disclosed');
 const one=S.buildSeries([tue.snap]).find(s=>s.metric==='search_trend'),two=S.buildSeries([tue.snap,wed.snap]).find(s=>s.metric==='search_trend');
 check(one.points.length===104&&two.points.length===one.points.length,`datalab week: same week twice adds no points (${one.points.length} → ${two.points.length})`);
 check(two.points.every(p=>p.snapshotId==='dl-wed'),'datalab week: the latest fetch wins every overlapping period (no mixed scales)');
 check(!one.limitations&&two.limitations&&two.limitations[0].includes('다시 맞춘'),'datalab week: re-normalisation recorded as a series limitation');
 const three=S.buildSeries([tue.snap,wed.snap,mon.snap]).find(s=>s.metric==='search_trend');
 check(mon.body.startDate===iso(Date.parse(tue.body.startDate+'T00:00:00Z')+7*DAY)&&three.points.length===105,'datalab week: next week shifts by exactly one week (periods align, one new point)');
 check(DL.anchorWeekWindow({startDate:'2016-01-01',endDate:'2016-01-20'}).startDate>='2016-01-01','datalab week: never starts before the data floor');
 // 같은 기간에 옛 값이 있고 새 값이 null이면 새 null이 이긴다(옛 축척 값을 남기지 않는다). 절대값 지표는 값 있는 옛 점이 이긴다(기존 규칙).
 const mk=(id,fetchedAt,metric,value)=>({id,sourceId:'naver_datalab_search',method:'api',request:{},fetchedAt,bodyDigest:'0',bodyBytes:1,status:'ok',limitations:[],importedBy:null,observations:[{subject:{type:'keyword',text:'x'},metric,value,period:{from:'2026-09-21',to:'2026-09-27'}}]});
 check(S.buildSeries([mk('a','2026-09-29T00:00:00Z','search_trend',50),mk('b','2026-09-30T00:00:00Z','search_trend',null)])[0].points[0].value===null,'relative metric: latest fetch wins even when null');
 check(S.buildSeries([mk('a','2026-09-29T00:00:00Z','search_volume_month',50),mk('b','2026-09-30T00:00:00Z','search_volume_month',null)])[0].points[0].value===50,'absolute metric: older value beats newer null');
}
// ── 쿠팡 파트너스 ──
const cp={kind:'coupang_partners',accessKey:'a1b2c3d4-0000-1111-2222-333344445555',secretKey:'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef'};
{
 check(c.coupangSignedDate(NOW)==='261003T030405Z','coupang: signed-date yyMMddTHHmmssZ (UTC)');
 const f=fakeFetch(()=>json(fixture('coupang-best.json')));
 const r=plain(await c.collectCoupangBestCategory(cp,'1012',f.deps)),call=f.calls[0];
 const path='/v2/providers/affiliate_open_api/apis/openapi/v1/products/bestcategories/1012';
 check(call.url===`https://api-gateway.coupang.com${path}?limit=50`,'coupang best: fixed URL');
 const m=/^CEA algorithm=HmacSHA256, access-key=([^,]+), signed-date=(\d{6}T\d{6}Z), signature=([0-9a-f]{64})$/.exec(call.headers.authorization||'');
 check(m&&m[1]===cp.accessKey&&m[2]==='261003T030405Z','coupang: Authorization CEA header shape');
 check(m[3]===createHmac('sha256',cp.secretKey).update('261003T030405Z'+'GET'+path+'limit=50').digest('hex'),'coupang: signature = hex HMAC(signedDate+method+path+query)');
 check(one(r.draft,listing('7001'),'rank').value===1&&one(r.draft,listing('7001'),'price_min').value===3980&&one(r.draft,listing('7001'),'rank').scope==='coupang_best:1012','coupang best: rank and price');
 check(one(r.draft,listing('7003'),'rank').value===null&&one(r.draft,listing('7003'),'price_min').value===null&&r.draft.status==='partial','coupang best: missing rank stays unknown (not response order), 0 price → null, partial');
 check(r.draft.limitations.some(l=>l.includes('순위를 미확인')),'coupang best: missing rank disclosed');
 check(r.draft.limitations.some(l=>l.includes('공식 문서')),'coupang: approval/limit caveat');
 const s=fakeFetch(()=>json(fixture('coupang-search.json')));
 const rs=plain(await c.collectCoupangSearch(cp,'마라소스',s.deps)),sc=s.calls[0];
 const sq=`keyword=${encodeURIComponent('마라소스')}&limit=10`,spath='/v2/providers/affiliate_open_api/apis/openapi/v1/products/search';
 check(sc.url===`https://api-gateway.coupang.com${spath}?${sq}`,'coupang search: fixed URL with encoded keyword');
 check(sc.headers.authorization.endsWith('signature='+createHmac('sha256',cp.secretKey).update('261003T030405Z'+'GET'+spath+sq).digest('hex')),'coupang search: signature over encoded query');
 check(one(rs.draft,listing('8002'),'rank').value===2&&rs.draft.status==='ok'&&rs.unitsUsed===1,'coupang search: rank mapped, ok');
 const bad=fakeFetch(()=>json({rCode:'400',rMessage:'limit is out of range'}));
 await rejects(c.collectCoupangSearch(cp,'마라소스',bad.deps),'http','coupang: rCode≠0 rejected');
 const g=fakeFetch(()=>json({}));
 await rejects(c.collectCoupangBestCategory(cp,'1012',g.deps,101),'input','coupang: limit >100 rejected');
 await rejects(c.collectCoupangBestCategory(cp,'../x',g.deps),'input','coupang: category id must be numeric');
 check(g.calls.length===0,'coupang: invalid input never fetches');
}

// ── 공용 HTTP: 상태 코드·리디렉트·크기·형식·시간 초과 ──
{
 const run=responder=>{const f=fakeFetch(responder);return {f,p:c.fetchSourceJson('naver_datalab_search','https://openapi.naver.com/v1/datalab/search',{},f.deps,{label:'네이버',maxBytes:600000})}};
 const e401=await rejects(run(()=>json({errorMessage:'Authentication failed'},401)).p,'auth','http: 401 → auth');
 check(e401 instanceof c.CollectorAuthError&&/인증/.test(e401.message),'http: auth error class with Korean message');
 await rejects(run(()=>json({errorMessage:'forbidden'},403)).p,'auth','http: 403 → auth');
 const e429=await rejects(run(()=>json({errorCode:'010'},429)).p,'quota','http: 429 → quota');
 check(e429 instanceof c.CollectorQuotaError&&e429.status===429,'http: quota error class with status');
 const e500=await rejects(run(()=>json({},500)).p,'http','http: 500 → http');
 check(e500.status===500,'http: status kept');
 const redirect=run(()=>new Response(null,{status:302,headers:{location:'https://evil.example.com/'}}));
 await rejects(redirect.p,'redirect','http: 302 → redirect rejected');
 check(redirect.f.calls.length===1&&redirect.f.calls[0].redirect==='manual','http: redirect not followed');
 await rejects(run(()=>json({pad:'x'.repeat(700_000)})).p,'too_large','http: oversized body rejected while streaming');
 await rejects(run(()=>new Response('{}',{status:200,headers:{'content-length':'99999999'}})).p,'too_large','http: oversized Content-Length rejected');
 await rejects(run(()=>new Response('<html>not json</html>',{status:200})).p,'format','http: non-JSON → format');
 await rejects(run(()=>{throw new DOMException('timed out','TimeoutError')}).p,'timeout','http: timeout');
 await rejects(run(()=>{throw new TypeError('fetch failed')}).p,'network','http: network failure');
 // 레지스트리 관문: manual 출처·등록 밖 호스트·http는 fetch 전에 막힌다.
 const f=fakeFetch(()=>json({}));
 await rejects(c.fetchSourceJson('musinsa_ranking_manual','https://www.musinsa.com/ranking',{},f.deps,{label:'무신사'}),'not_allowed','http: manual source blocked');
 await rejects(c.fetchSourceJson('naver_shop_search','https://evil.example.com/v1/search/shop.json',{},f.deps,{label:'x'}),'not_allowed','http: unregistered host blocked');
 await rejects(c.fetchSourceJson('naver_searchad_keyword','https://openapi.naver.com/v1/search/shop.json',{},f.deps,{label:'x'}),'not_allowed','http: another source host blocked');
 await rejects(c.fetchSourceJson('naver_shop_search','http://openapi.naver.com/v1/search/shop.json',{},f.deps,{label:'x'}),'not_allowed','http: plain http blocked');
 check(f.calls.length===0,'http: blocked requests never reach fetch');
 const ok=fakeFetch(()=>json({a:1}));
 const got=plain(await c.fetchSourceJson('naver_datalab_search','https://openapi.naver.com/x',{},ok.deps,{label:'x'}));
 check(got.bodyDigest===sha('{"a":1}')&&got.bodyBytes===7&&got.fetchedAt===NOW.toISOString(),'http: digest, bytes and injected clock');
}

// ── 쿼터 ──
{
 check(c.unitsFor('youtube_data','youtube_search')===100&&c.unitsFor('youtube_data','youtube_videos')===1,'quota: youtube search 100, videos 1');
 check(c.unitsFor('naver_datalab_search','datalab_search')===1&&c.unitsFor('naver_shop_search','shop_search')===1&&c.unitsFor('coupang_partners','coupang_search')===1,'quota: other APIs 1 per call');
 check(c.unitsFor('musinsa_ranking_manual','licensed_fetch')===0&&c.unitsFor('own_sales','licensed_fetch')===0,'quota: manual/internal spend 0');
 assert.throws(()=>c.unitsFor('youtube_data','shop_search'));passed++;
 check(c.canSpend(9900,100,10000)&&!c.canSpend(9901,100,10000)&&c.canSpend(5,1,null)&&!c.canSpend(-1,1,10)&&!c.canSpend(0,Number.NaN,10),'quota: canSpend bounds');
 check(c.kstDayKey(new Date('2026-10-02T14:59:59Z'))==='2026-10-02'&&c.kstDayKey(new Date('2026-10-02T15:00:00Z'))==='2026-10-03','quota: KST midnight boundary');
 check(c.quotaDayKey('youtube_data',new Date('2026-10-03T06:00:00Z'))==='2026-10-02'&&c.quotaDayKey('naver_shop_search',new Date('2026-10-03T06:00:00Z'))==='2026-10-03','quota: YouTube resets at Pacific midnight, Naver at KST');
}

// ── 자격증명 ──
{
 const p=plain(cr.parseResearchCredential('naver_searchad',{apiKey:' 0100000000abcdefabcdef ',secretKey:sa.secretKey,customerId:'1234567'}));
 check(p.apiKey==='0100000000abcdefabcdef'&&p.kind==='naver_searchad','credentials: searchad trimmed');
 const bad=(kind,input,re,name)=>{try{cr.parseResearchCredential(kind,input)}catch(e){assert.match(e.message,re,name);assert.equal(e.status,400);check(!e.message.includes('synthetic'),name+': secret not echoed');return}assert.fail(name)};
 bad('naver_searchad',{apiKey:sa.apiKey,secretKey:sa.secretKey,customerId:'12a'},/고객 ID/,'credentials: customer id digits');
 bad('naver_developers',{clientId:'',clientSecret:'x'},/Client ID/,'credentials: client id required');
 bad('youtube',{apiKey:'AIza synthetic key 0000000'},/공백/,'credentials: whitespace inside key');
 bad('coupang_partners',{accessKey:'synthetic<script>',secretKey:'x'},/Access Key/,'credentials: coupang access key charset');
 bad('licensed',{vendor:''},/공급사/,'credentials: licensed vendor required');
 const lic=plain(cr.parseLicensedCredential({vendor:'아이템스카우트'}));
 check(lic.apiKey===null&&lic.vendor==='아이템스카우트','credentials: licensed placeholder without key');
 check(cr.credentialAccount(plain(cr.parseYoutubeCredential({apiKey:yt.apiKey}))).endsWith('0000')&&!cr.credentialAccount({kind:'youtube',apiKey:yt.apiKey}).includes('synthetic'),'credentials: account label masks key');
 check(cr.CREDENTIAL_FOR_SOURCE.musinsa_ranking_manual===null&&cr.CREDENTIAL_FOR_SOURCE.naver_shop_search==='naver_developers'&&cr.CREDENTIAL_FOR_SOURCE.naver_datalab_shopping==='naver_developers','credentials: source → credential map');
}

// ── 운영자·계약 가져오기 ──
const deps={now:()=>NOW};
const imp=async input=>plain(await c.parseImport({scope:'식품 베스트',observedDate:'2026-10-03',...input},deps));
{
 const text=fixture('coupang-ranking.csv');
 const r=await imp({sourceId:'coupang_ranking_manual',fileName:'C:\\Users\\op\\coupang.csv',text});
 check(r.ok&&r.rows===3&&r.unitsUsed===0,'import coupang: BOM/CRLF/quoted CSV parsed');
 const d=r.draft;
 check(d.method==='manual'&&d.sourceId==='coupang_ranking_manual'&&d.request.fileName==='coupang.csv'&&d.request.scope==='식품 베스트'&&d.request.observedDate==='2026-10-03','import coupang: method from registry, request shape, path stripped from file name');
 check(d.bodyDigest===sha(text)&&d.bodyBytes===Buffer.byteLength(text),'import: digest of raw text');
 const r1=one(d,listing('CP-1'),'rank');
 check(r1.value===1&&r1.subject.title==='불닭소스, 매운맛 200g'&&r1.subject.price===3980&&r1.subject.url==='https://www.coupang.com/vp/products/1'&&r1.scope==='식품 베스트'&&r1.period.from==='2026-10-03','import coupang: quoted comma, "3,980원" price, url');
 check(one(d,listing('CP-2'),'rank').subject.title==='마라소스 "특" 500g'&&one(d,listing('CP-2'),'review_count').value===12000,'import coupang: escaped quotes and 1.2만');
 check(one(d,listing('CP-3'),'rank').subject.title==='고추장 대용량'&&one(d,listing('CP-3'),'price_min').value===12000&&one(d,listing('CP-3'),'review_count').value===null&&one(d,listing('CP-3'),'rating').value===null,'import coupang: newline in quoted title folded, blanks → null');
 check(d.status==='ok'&&d.limitations.some(l=>l.includes('미확인')),'import coupang: ok with unknown-value limitation');
}
{
 const r=await imp({sourceId:'musinsa_ranking_manual',fileName:'musinsa.csv',text:fixture('musinsa-ranking.csv'),scope:'상의'});
 check(r.ok&&r.draft.observations.every(o=>['rank','price_min','review_count','rating'].includes(o.metric)),'import musinsa: English headers, only registry metrics');
 check(!JSON.stringify(r.draft).includes('홍길동')&&r.draft.limitations.some(l=>l.includes('reviewer'))&&r.draft.limitations.some(l=>l.includes('판매량')),'import musinsa: unknown column (reviewer) and non-metric sales dropped');
 check(one(r.draft,s=>s.type==='listing'&&s.title==='키링 세트','rating').value===4.2,'import musinsa: values mapped');
}
{
 const r=await imp({sourceId:'oliveyoung_ranking_manual',fileName:'oy.json',text:fixture('oliveyoung-ranking.json'),observedDate:'2026-10-02',scope:'스킨케어'});
 check(r.ok&&one(r.draft,listing('A000001'),'price_min').value===18900&&one(r.draft,listing('A000001'),'review_count').value===9876,'import oliveyoung: JSON with Korean keys and goodsNo alias');
 check(one(r.draft,listing('A000002'),'review_count').value===null&&one(r.draft,listing('A000002'),'rating').value===null,'import oliveyoung: null/blank → null');
 check(r.draft.status==='partial'&&r.draft.limitations.some(l=>l.includes('3')&&l.includes('빠졌')),'import oliveyoung: rank gap → partial');
 const wrongDay=await imp({sourceId:'oliveyoung_ranking_manual',fileName:'oy.json',text:fixture('oliveyoung-ranking.json'),observedDate:'2026-10-03'});
 check(!wrongDay.ok&&wrongDay.errors.some(e=>e.row===1&&e.field==='date'),'import manual: row date must equal file date');
}
{
 const r=await imp({sourceId:'licensed_ranking',fileName:'vendor-export.csv',text:fixture('licensed-ranking.csv'),scope:'소스'});
 check(r.ok&&r.draft.method==='licensed'&&r.rows===4,'import licensed: vendor export accepted, method licensed');
 const sales=obs(r.draft,()=>true,'sales_estimate');
 check(sales.length===4&&sales.some(o=>o.value===15000&&o.period.from==='2026-09-30')&&sales.some(o=>o.value===5100&&o.period.from==='2026-10-01'),'import licensed: sales_estimate per date (history allowed)');
 check(r.draft.status==='ok','import licensed: same rank on different dates is not a duplicate');
}
{
 const r=await imp({sourceId:'coupang_ranking_manual',fileName:'bad.csv',text:fixture('bad-rows.csv')});
 check(!r.ok&&!('draft' in r),'import: invalid rows reject the whole file (no partial save)');
 const rows=[...new Set(r.errors.map(e=>e.row))].sort((a,b)=>a-b);
 assert.deepEqual(rows,[3,4,5,6,7]);passed++;
 check(r.errors.every(e=>Number.isInteger(e.row)&&!/^\d+행/.test(e.reason)),'import: row number lives in the row field only (no "3행: 3행:" prefix in the reason)');
 check(r.errors.some(e=>e.row===6&&e.field==='rating')&&r.errors.some(e=>e.row===5&&e.field==='price')&&r.errors.some(e=>e.row===7&&e.field==='title'),'import: field-specific reasons');
 const dup=await imp({sourceId:'musinsa_ranking_manual',fileName:'dup.csv',text:fixture('dup-rank.csv')});
 check(!dup.ok&&dup.errors.length===1&&dup.errors[0].row===4&&dup.errors[0].field==='rank'&&dup.errors[0].reason.includes('3행'),'import: duplicate rank rejected with both rows');
 const big=await imp({sourceId:'musinsa_ranking_manual',fileName:'big.csv',text:'순위,상품명\n1,'+'가'.repeat(700_000)});
 check(!big.ok&&big.errors[0].reason.includes('2MB'),'import: >2MB rejected');
 const many=await imp({sourceId:'musinsa_ranking_manual',fileName:'many.csv',text:'순위,상품명\n'+Array.from({length:2001},(_,i)=>`${i+1},상품${i+1}`).join('\n')});
 check(!many.ok&&many.errors[0].reason.includes('2,000'),'import: >2,000 rows rejected');
 const noRank=await imp({sourceId:'musinsa_ranking_manual',fileName:'x.csv',text:'상품명,가격\n가,1000\n'});
 check(!noRank.ok&&noRank.errors.some(e=>e.field==='rank'&&e.row===1),'import: missing rank header rejected');
 const open=await imp({sourceId:'musinsa_ranking_manual',fileName:'x.csv',text:'순위,상품명\n1,"닫히지 않음\n'});
 check(!open.ok&&/따옴표/.test(open.errors[0].reason),'import: unterminated quote rejected');
 const extra=await imp({sourceId:'musinsa_ranking_manual',fileName:'x.csv',text:'순위,상품명\n1,가,덤\n'});
 check(!extra.ok&&extra.errors[0].row===2,'import: extra cells rejected');
 const js=await imp({sourceId:'musinsa_ranking_manual',fileName:'x.csv',text:'순위,상품명,링크\n1,가,javascript:alert(1)\n'});
 check(!js.ok&&js.errors[0].field==='url','import: non-http link rejected');
 const broken=await imp({sourceId:'musinsa_ranking_manual',fileName:'x.csv',text:'순위,상품명\n1,\uFFFD\uFFFD\n'});
 check(!broken.ok&&/UTF-8/.test(broken.errors[0].reason),'import: mis-decoded (CP949) text rejected');
 const api=await imp({sourceId:'naver_shop_search',fileName:'x.csv',text:'순위,상품명\n1,가\n'});
 check(!api.ok,'import: API source ids are not importable');
 const future=await imp({sourceId:'musinsa_ranking_manual',fileName:'x.csv',text:'순위,상품명\n1,가\n',observedDate:'2026-10-04'});
 check(!future.ok&&/오늘/.test(future.errors[0].reason),'import: future observed date rejected');
 const stale=await imp({sourceId:'musinsa_ranking_manual',fileName:'x.csv',text:'순위,상품명\n1,가\n',observedDate:'2026-09-18'});
 check(!stale.ok&&/14일/.test(stale.errors[0].reason),'import: observed date older than 14 days (KST) rejected');
 const edge=await imp({sourceId:'musinsa_ranking_manual',fileName:'x.csv',text:'순위,상품명\n1,가\n',observedDate:'2026-09-19'});
 check(edge.ok,'import: observed date exactly 14 days ago accepted');
 const notArray=await imp({sourceId:'oliveyoung_ranking_manual',fileName:'x.json',text:'{"rank":1}'});
 check(!notArray.ok&&/배열/.test(notArray.errors[0].reason),'import: JSON must be an array');
 check(c.parseCsv('a,"b\r\nc",d\r\n\r\ne').length===3&&c.parseCsv('\uFEFFx,y')[0].cells[0]==='x','import: parseCsv handles CRLF in quotes, blank lines, BOM');
}

console.log(JSON.stringify({passed,external:'not_called'}));
