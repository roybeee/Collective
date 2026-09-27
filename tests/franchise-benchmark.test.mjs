// 트랙 R R7a 공공 벤치마크(토큰 0) 순수 모듈·커넥터 스위트. 사례 번호 BM-*는 R7a PR 본문과 같다.
// 확인: 적재 입력(BM-I), 공공데이터 키 형식(BM-K), 응답 스키마·단위·0 변환·개인 필드 미적재(BM-S), 선별·30개 상한(BM-F), 파생 지표 공식·분모(BM-D),
// 커넥터 고정 호스트·키 인코딩·재시도·지수 백오프·타임아웃·200KB·미승인 분류(BM-C), 브랜드 사실 확정 차단 판정(BM-G).
// 근거: mocked(fetch 스텁, 실제 외부 호출 0). 운영 real 적재는 not_run(대표가 키를 저장한 뒤 1회).
import assert from 'node:assert/strict';
import {testRuntime} from './helpers/runtime.mjs';

const passed=[];const check=(name,val)=>{assert.ok(val,name);passed.push(name)};
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const plain=x=>JSON.parse(JSON.stringify(x));
let handler=async()=>{throw new Error('외부 호출 금지')};
const calls=[];
const {load}=testRuntime(async(url,options)=>{calls.push({url:String(url),options});return handler(String(url),options)});
const bm=await load('lib/franchise-benchmark.ts'),ftc=await load('lib/connectors/ftc-franchise.ts'),src=await load('lib/franchise-benchmark-source.ts');

// ════ BM-I 적재 입력 ════
const NOW_YEAR=2026;
const ok=v=>v.ok===true,code=v=>v.ok?null:v.code;
check('BM-I1 a year and up to 30 brand names are accepted and normalized',(v=>ok(v)&&v.value.year===2025&&same(v.value.brands,['올드페리도넛','가상도넛'])&&v.value.industry===null)(bm.readLoadInput({year:2025,brands:[' 올드페리도넛 ','가상도넛','가상도넛',''],industry:''},NOW_YEAR)));
check('BM-I2 an industry keyword alone is accepted',(v=>ok(v)&&v.value.brands.length===0&&v.value.industry==='제과제빵')(bm.readLoadInput({year:2025,brands:[],industry:' 제과제빵 '},NOW_YEAR)));
check('BM-I3 neither brands nor industry is refused',code(bm.readLoadInput({year:2025,brands:[],industry:''},NOW_YEAR))==='scope_missing');
check('BM-I4 more than 30 brands is refused',code(bm.readLoadInput({year:2025,brands:Array.from({length:31},(_,i)=>'가상'+i)},NOW_YEAR))==='too_many_brands');
check('BM-I5 a future, too old or non-integer year is refused',['2027',2027,1999,2024.5,'x'].every(y=>code(bm.readLoadInput({year:y,brands:['가상']},NOW_YEAR))==='year_invalid'));
check('BM-I6 a brand name with a phone number or e-mail is refused (no personal data in the request)',['가상 010-0000-0199','a@example.com'].every(n=>code(bm.readLoadInput({year:2025,brands:[n]},NOW_YEAR))==='personal_data'));
check('BM-I7 an over-long brand name or industry is refused',code(bm.readLoadInput({year:2025,brands:['가'.repeat(61)]},NOW_YEAR))==='name_invalid'&&code(bm.readLoadInput({year:2025,brands:[],industry:'가'.repeat(41)},NOW_YEAR))==='name_invalid');
check('BM-I8 brands must be an array of strings',code(bm.readLoadInput({year:2025,brands:'가상'},NOW_YEAR))==='name_invalid'&&code(bm.readLoadInput({year:2025,brands:[3]},NOW_YEAR))==='name_invalid');

// ════ BM-K 공공데이터 키 ════
// 합성 키(실제 공공데이터 키 아님). 인코딩 검사를 위해 +·/·= 를 넣는다.
const KEY='SyntheticTestKey'.repeat(3)+'+/==';
check('BM-K1 a decoded portal key is kept as is',bm.readServiceKey(KEY)===KEY);
check('BM-K2 a URL-encoded portal key is decoded once',bm.readServiceKey(encodeURIComponent(KEY))===KEY);
check('BM-K3 blank, short, long or non-key text is refused',[undefined,'','  ','short',`${KEY} ${KEY}`,'가'.repeat(40),'x'.repeat(401),'<script>'.repeat(4)].every(k=>bm.readServiceKey(k)===null));

// ════ BM-S 응답 스키마·단위·0 변환·개인 필드 ════
const item=(o={})=>({yr:'2025',indutyLclasNm:'외식',indutyMlsfcNm:'제과제빵',corpNm:'가상본부(주)',brandNm:'가상도넛',rprsvNm:'홍가상',brno:'사업자번호토큰A',crno:'법인번호토큰A',frcsCnt:'120',newFrcsRgsCnt:'15',ctrtEndCnt:'3',ctrtCncltnCnt:'2',nmChgCnt:'4',avrgSlsAmt:'350000',arUnitAvrgSlsAmt:'0',...o});
const envA={resultCode:'00',resultMsg:'NORMAL SERVICE.',numOfRows:400,pageNo:1,totalCount:1,items:[item()]};
const envB={response:{header:{resultCode:'00',resultMsg:'NORMAL SERVICE.'},body:{items:{item:item()},numOfRows:400,pageNo:1,totalCount:1}}};
const a=bm.parseEnvelope(envA),b=bm.parseEnvelope(envB);
check('BM-S1 the flat and the response/body envelopes both parse (single item object becomes a list)',ok(a)&&ok(b)&&a.value.items.length===1&&b.value.items.length===1&&a.value.totalCount===1&&b.value.totalCount===1);
check('BM-S2 an empty items field is an empty page',(v=>ok(v)&&v.value.items.length===0)(bm.parseEnvelope({response:{header:{resultCode:'00'},body:{items:'',totalCount:0}}})));
check('BM-S3 a body that is not an envelope is a schema mismatch',[null,[],'x',{foo:1},{response:{body:{items:5}}}].every(j=>code(bm.parseEnvelope(j))==='schema_mismatch'));
const row=bm.normalizeItem(item());
check('BM-S4 counts are numbers and money is stored as the raw thousand-won value and a won value',row&&row.stores===120&&row.newStores===15&&row.contractEnded===3&&row.contractTerminated===2&&row.ownerChanged===4&&same(plain(row.avgSales),{rawThousandKrw:350000,krw:350000000}));
check('BM-S5 a zero money value is stored as null (not reported), a zero count stays zero',same(plain(row.avgSalesPerArea),{rawThousandKrw:null,krw:null})&&bm.normalizeItem(item({ctrtEndCnt:'0'})).contractEnded===0);
check('BM-S6 representative name, business and corporate registration numbers and the HQ name are never kept',(t=>!/홍가상|사업자번호토큰A|법인번호토큰A|가상본부|rprsvNm|brno|crno|corpNm/.test(t))(JSON.stringify(row)));
check('BM-S7 commas in numbers are accepted, negative or non-numeric values become null',(r=>r.stores===1200&&r.newStores===null&&r.contractEnded===null)(bm.normalizeItem(item({frcsCnt:'1,200',newFrcsRgsCnt:'-1',ctrtEndCnt:'많음'}))));
check('BM-S8 an item without a brand name is dropped',bm.normalizeItem(item({brandNm:''}))===null&&bm.normalizeItem('x')===null&&bm.normalizeItem(item({brandNm:undefined}))===null);
check('BM-S9 field names are listed in one place for the real-load check',Array.isArray(plain(bm.BENCHMARK_FIELDS).brandName)&&plain(bm.BENCHMARK_FIELDS).brandName.includes('brandNm'));

// ════ BM-F 선별·상한 ════
const rows=[...Array.from({length:40},(_,i)=>bm.normalizeItem(item({brandNm:'가상도넛'+i,frcsCnt:String(i)}))),bm.normalizeItem(item({brandNm:'Old Ferry Donut',indutyMlsfcNm:'커피'})),bm.normalizeItem(item({brandNm:'다른업종',indutyMlsfcNm:'치킨'}))];
const byName=bm.selectRows(rows,{year:2025,brands:['old ferry donut','가상도넛3','없는브랜드'],industry:null});
check('BM-F1 brand names match after NFKC, case and space folding; missing names are reported',same(byName.rows.map(r=>r.brandName).sort(),['Old Ferry Donut','가상도넛3'])&&same(byName.missing,['없는브랜드'])&&byName.truncated===false);
const byIndustry=bm.selectRows(rows,{year:2025,brands:[],industry:'제과'});
check('BM-F2 an industry keyword keeps at most 30 rows, largest first, and marks truncation',byIndustry.rows.length===30&&byIndustry.truncated===true&&byIndustry.rows[0].brandName==='가상도넛39'&&byIndustry.rows.every(r=>r.industryMiddle==='제과제빵'));
check('BM-F3 brand names and industry together must both match',same(bm.selectRows(rows,{year:2025,brands:['Old Ferry Donut','가상도넛1'],industry:'제과'}).rows.map(r=>r.brandName),['가상도넛1']));
check('BM-F4 all named brands found is complete (the scan can stop)',bm.selectionComplete(rows,{year:2025,brands:['가상도넛1','가상도넛2'],industry:null})===true&&bm.selectionComplete(rows,{year:2025,brands:['없음'],industry:null})===false&&bm.selectionComplete(rows,{year:2025,brands:[],industry:'제과'})===false);

// ════ BM-D 파생 지표 ════
const d=bm.derivedMetrics(bm.normalizeItem(item()));
check('BM-D1 net change shows its formula and value',d.netChange.value===10&&/신규 개점/.test(d.netChange.formula)&&/계약 종료/.test(d.netChange.formula)&&/계약 해지/.test(d.netChange.formula));
check('BM-D2 closure rate shows formula, numerator and denominator',d.closureRate.numerator===5&&d.closureRate.denominator===120&&Math.abs(d.closureRate.value-5/120)<1e-9&&d.closureRate.hidden===false&&/연말 가맹점 수/.test(d.closureRate.formula));
const small=bm.derivedMetrics(bm.normalizeItem(item({frcsCnt:'19'})));
check('BM-D3 a denominator under 20 hides the rate and says the sample is small (H12)',small.closureRate.hidden===true&&small.closureRate.value===null&&small.closureRate.denominator===19&&/표본 부족/.test(small.closureRate.note));
const gap=bm.derivedMetrics(bm.normalizeItem(item({ctrtEndCnt:'x'})));
check('BM-D4 a missing count leaves both derived values empty instead of guessing',gap.netChange.value===null&&gap.closureRate.value===null);

// ════ BM-C 커넥터 ════
const deadline=()=>Date.now()+60000;
const req=(o={})=>({serviceKey:KEY,year:2025,pageNo:2,numOfRows:400,deadlineAt:deadline(),...o});
const waits=[];const wait=async ms=>{waits.push(ms)};
const reply=(status,body,headers={})=>new Response(typeof body==='string'?body:JSON.stringify(body),{status,headers:{'content-type':'application/json',...headers}});
calls.length=0;handler=async()=>reply(200,envA,{'last-modified':'Fri, 01 Aug 2026 00:00:00 GMT'});
let r=await ftc.ftcFetchPage(req(),{wait});
const u=new URL(calls[0].url);
check('BM-C1 one call to the fixed host and path with the key encoded, JSON result type and the year',calls.length===1&&u.origin==='https://apis.data.go.kr'&&u.pathname==='/1130000/FftcBrandFrcsStatsService/getBrandFrcsStats'&&u.searchParams.get('serviceKey')===KEY&&calls[0].url.includes(encodeURIComponent(KEY))&&u.searchParams.get('yr')==='2025'&&u.searchParams.get('pageNo')==='2'&&u.searchParams.get('numOfRows')==='400'&&u.searchParams.get('resultType')==='json');
check('BM-C2 redirects are not followed and every call has a timeout signal',calls[0].options.redirect==='manual'&&calls[0].options.signal instanceof AbortSignal);
check('BM-C3 a good page returns the text, JSON, attempt count and Last-Modified',r.ok&&r.attempts===1&&r.json.items.length===1&&typeof r.text==='string'&&r.lastModified==='Fri, 01 Aug 2026 00:00:00 GMT');
calls.length=0;waits.length=0;let n=0;handler=async()=>++n<3?reply(503,'busy'):reply(200,envA);
r=await ftc.ftcFetchPage(req(),{wait});
check('BM-C4 5xx is retried with exponential backoff and then succeeds',r.ok&&r.attempts===3&&calls.length===3&&same(waits,[250,500]));
calls.length=0;waits.length=0;handler=async()=>reply(502,'down');
r=await ftc.ftcFetchPage(req(),{wait});
check('BM-C5 at most 3 retries (4 attempts), then failed upstream',!r.ok&&r.kind==='failed'&&r.code==='UPSTREAM_5XX'&&r.attempts===4&&calls.length===4&&same(waits,[250,500,1000]));
calls.length=0;waits.length=0;handler=async(url,o)=>{assert.ok(o.signal);throw new DOMException('The operation was aborted due to timeout','TimeoutError')};
r=await ftc.ftcFetchPage(req(),{wait});
check('BM-C6 a per-call timeout is retried and ends as timeout',!r.ok&&r.kind==='timeout'&&r.code==='TIMEOUT'&&r.attempts===4);
calls.length=0;handler=async()=>reply(200,'x'.repeat(200001));
r=await ftc.ftcFetchPage(req(),{wait});
check('BM-C7 a body over 200KB is not read and not retried',!r.ok&&r.kind==='failed'&&r.code==='TOO_LARGE'&&r.attempts===1&&calls.length===1);
const NOT_REGISTERED='<OpenAPI_ServiceResponse><cmmMsgHeader><errMsg>SERVICE ERROR</errMsg><returnAuthMsg>SERVICE_KEY_IS_NOT_REGISTERED_ERROR</returnAuthMsg><returnReasonCode>30</returnReasonCode></cmmMsgHeader></OpenAPI_ServiceResponse>';
calls.length=0;handler=async()=>reply(200,NOT_REGISTERED,{'content-type':'text/xml'});
r=await ftc.ftcFetchPage(req(),{wait});
check('BM-C8 an unregistered key or unapproved API is blocked (SERVICE_NOT_REGISTERED) without retry',!r.ok&&r.kind==='blocked'&&r.code==='SERVICE_NOT_REGISTERED'&&r.attempts===1);
for(const status of [401,403]){calls.length=0;handler=async()=>reply(status,'Unauthorized');r=await ftc.ftcFetchPage(req(),{wait});check(`BM-C9 HTTP ${status} is blocked without retry`,!r.ok&&r.kind==='blocked'&&r.code==='SERVICE_NOT_REGISTERED'&&calls.length===1)}
calls.length=0;handler=async()=>reply(200,{resultCode:'22',resultMsg:'LIMITED_NUMBER_OF_SERVICE_REQUESTS_EXCEEDS_ERROR'});
r=await ftc.ftcFetchPage(req(),{wait});
check('BM-C10 a daily quota error in a JSON envelope fails without retry',!r.ok&&r.kind==='failed'&&r.code==='QUOTA_EXCEEDED'&&calls.length===1);
calls.length=0;handler=async()=>reply(200,{response:{header:{resultCode:'31',resultMsg:'DEADLINE_HAS_EXPIRED_ERROR'}}});
r=await ftc.ftcFetchPage(req(),{wait});
check('BM-C11 an expired key is blocked',!r.ok&&r.kind==='blocked'&&r.code==='SERVICE_KEY_EXPIRED');
calls.length=0;handler=async()=>reply(200,'<html>maintenance</html>',{'content-type':'text/html'});
r=await ftc.ftcFetchPage(req(),{wait});
check('BM-C12 a non-JSON body without a known error fails as not JSON',!r.ok&&r.kind==='failed'&&r.code==='NOT_JSON'&&calls.length===1);
calls.length=0;handler=async()=>reply(400,'bad');
r=await ftc.ftcFetchPage(req(),{wait});
check('BM-C13 other 4xx fail without retry',!r.ok&&r.kind==='failed'&&r.code==='REQUEST_REJECTED'&&calls.length===1);
calls.length=0;handler=async()=>reply(302,'',{location:'https://evil.example/'});
r=await ftc.ftcFetchPage(req(),{wait});
check('BM-C14 a redirect is refused, not followed',!r.ok&&r.kind==='failed'&&calls.length===1);
calls.length=0;handler=async()=>{throw new TypeError('network')};
r=await ftc.ftcFetchPage(req({deadlineAt:Date.now()-1}),{wait});
check('BM-C15 a passed deadline makes no call and ends as timeout',!r.ok&&r.kind==='timeout'&&r.code==='DEADLINE'&&r.attempts===0&&calls.length===0);
calls.length=0;waits.length=0;n=0;handler=async()=>++n<2?reply(429,'slow down'):reply(200,envA);
r=await ftc.ftcFetchPage(req(),{wait});
check('BM-C16 429 is retried',r.ok&&r.attempts===2);
check('BM-C17 the backoff schedule is 250ms doubling',same([1,2,3].map(ftc.ftcBackoffMs),[250,500,1000]));
check('BM-C18 the limits are 20s per call, 200KB and 4 attempts',ftc.FTC_LIMITS.timeoutMs===20000&&ftc.FTC_LIMITS.maxBytes===200000&&ftc.FTC_LIMITS.maxAttempts===4);

// ════ BM-G 브랜드 사실 확정 차단 판정 ════
check('BM-G1 a benchmark record reference or the FTC statistics API address is a benchmark source',['franchise_benchmark:bf-1 가상도넛','https://apis.data.go.kr/1130000/FftcBrandFrcsStatsService/getBrandFrcsStats?yr=2025','공정위 FftcBrandFrcsStats 2025'].every(s=>src.isBenchmarkSource(s)));
check('BM-G2 the FTC disclosure site and ordinary sources are not benchmark sources',['https://franchise.ftc.go.kr/ 정보공개서 등록 조회','정보공개서 2026년판 12쪽',''].every(s=>!src.isBenchmarkSource(s)));
check('BM-G3 the fixed notice says it is another brand\'s public number and not our forecast basis',bm.BENCHMARK_NOTICE==='타 브랜드 공개 수치. 자사 예상매출 근거가 아님'&&/자사 예상매출 근거가 아님/.test(src.BENCHMARK_FACT_BLOCKED));

check('no call ever left the stub',calls.every(c=>c.url.startsWith('https://apis.data.go.kr/')));
console.log(JSON.stringify({passed:passed.length}));
