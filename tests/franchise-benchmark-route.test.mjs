// 트랙 R R7a 공공 벤치마크 경로 스위트(/api/franchise 작업 benchmark_key_save·benchmark_key_clear·benchmark_load, GET 보기 benchmark). 사례 번호 BR-*는 R7a PR 본문과 같다.
// 확인: 역할·스위치(BR-A), 공공데이터 키 저장·삭제(암호문만, BR-K), 적재 성공·미승인·타임아웃·200KB·스키마 불일치·쪽 넘김·중복 실행·재전송(BR-L), 보기(BR-V),
// 브랜드 사실 확정 차단(BR-G), 감사·값 누출·외부 호출(BR-X).
// 근거: mocked(메모리 SQLite, 이메일 모드 세션 주입, 공공데이터포털 fetch 스텁). 실제 외부 호출 0. 운영 real 적재는 not_run(대표가 키를 저장한 뒤 1회).
import assert from 'node:assert/strict';
import {franchiseFixture,captureConsole,DISCLAIMER} from './helpers/franchise-fixture.mjs';

const logged=captureConsole();
let handler=async()=>{throw new Error('외부 호출 금지')};
const f=await franchiseFixture({fetch:(url,init)=>handler(url,init)});
const {sql,env}=f;
env.AUTH_MODE='email';env.AUTH_ORIGIN='https://agency.test';
const passed=[];const check=(name,val)=>{assert.ok(val,name);passed.push(name)};
const WS='br-owner';
const boss=f.signIn('br-boss','admin',1000,WS),member=f.signIn('br-member','member',3000,WS);
for(const b of ['fr-a','fr-b','fr-c'])await f.brand(WS,b);
const post=(s,input)=>f.post(s,input),get=(s,q)=>f.get(s,q);
const E=JSON.parse(JSON.stringify(f.lib.FRANCHISE_ERRORS)),T=k=>E[k].text;
const rows=kind=>sql.prepare('SELECT id,data FROM records WHERE kind=?').all(kind).map(r=>({...JSON.parse(r.data),_id:r.id}));
const allText=()=>sql.prepare('SELECT data FROM records').all().map(r=>r.data).join('\n');
const audits=action=>rows('franchise_audit').filter(a=>a.action===action);
// 합성 키(실제 공공데이터 키 아님). 인코딩 검사를 위해 +·/·= 를 넣는다.
const KEY='RouteSyntheticKey'.repeat(3)+'+/==';
const reply=(status,body,headers={})=>new Response(typeof body==='string'?body:JSON.stringify(body),{status,headers:{'content-type':'application/json',...headers}});
const item=(o={})=>({yr:'2025',indutyLclasNm:'외식',indutyMlsfcNm:'제과제빵',corpNm:'가상본부토큰(주)',brandNm:'가상도넛',rprsvNm:'홍가상대표토큰',brno:'사업자번호토큰B',crno:'법인번호토큰B',frcsCnt:'120',newFrcsRgsCnt:'15',ctrtEndCnt:'3',ctrtCncltnCnt:'2',nmChgCnt:'4',avrgSlsAmt:'350000',arUnitAvrgSlsAmt:'0',...o});
const page=(items,total=items.length)=>({resultCode:'00',resultMsg:'NORMAL SERVICE.',numOfRows:400,pageNo:1,totalCount:total,items});
const external=()=>f.calls.filter(u=>u.startsWith('https://apis.data.go.kr/'));
const LOAD={action:'benchmark_load',brandId:'fr-a',year:2025,brands:['가상도넛','Old Ferry Donut'],industry:''};

// ════ BR-A 역할·스위치 ════
check('setup: switch on',(await f.setFlag(boss,true)).status===200);
for(const b of ['fr-a','fr-b']){const r=await f.profile(boss,b,{storageLabels:['본사 문서함']},0);assert.equal(r.status,200,JSON.stringify(r.body))}
let r=await post(member,{action:'benchmark_key_save',brandId:'fr-a',apiKey:KEY});
check('BR-A1 members cannot save the public data key (403)',r.status===403&&rows('benchmark_credential').length===0);
r=await post(member,LOAD);
check('BR-A2 members cannot load (403) and nothing is called',r.status===403&&external().length===0);
r=await post(member,{action:'benchmark_key_clear',brandId:'fr-a'});
check('BR-A3 members cannot clear the key (403)',r.status===403);
r=await get(member,'view=benchmark&brandId=fr-a');
check('BR-A4 members can read the benchmark view',r.status===200&&r.body.role==='member'&&r.body.notice==='타 브랜드 공개 수치. 자사 예상매출 근거가 아님'&&r.body.disclaimer===DISCLAIMER);
check('setup: switch off',(await f.setFlag(boss,false)).status===200);
r=await post(boss,{action:'benchmark_key_save',brandId:'fr-a',apiKey:KEY});
check('BR-A5 saving the key needs the switch on (409)',r.status===409&&rows('benchmark_credential').length===0);
r=await post(boss,LOAD);
check('BR-A6 loading needs the switch on (409), nothing is called',r.status===409&&external().length===0);
r=await get(boss,'view=benchmark&brandId=fr-a');
check('BR-A7 the view reads with the switch off and says why loading is blocked',r.status===200&&r.body.enabled===false&&r.body.readiness.canLoad===false&&r.body.readiness.blocked.code==='switch_off');
check('setup: switch on again',(await f.setFlag(boss,true)).status===200);

// ════ BR-K 공공데이터 키 ════
r=await post(boss,LOAD);
check('BR-K1 without a stored key the load is blocked (409), no external call, no fetch record',r.status===409&&r.body.error===T('BENCHMARK_KEY_MISSING')&&external().length===0&&rows('benchmark_fetch').length===0);
r=await get(boss,'view=benchmark&brandId=fr-a');
check('BR-K2 the view shows the missing key as blocked with zero calls',r.body.credential.saved===false&&r.body.readiness.canLoad===false&&r.body.readiness.blocked.code==='credential_missing'&&/외부 호출 0/.test(r.body.readiness.blocked.message));
for(const bad of ['','짧은키','x'.repeat(401),`${KEY} ${KEY}`,42]){r=await post(boss,{action:'benchmark_key_save',brandId:'fr-a',apiKey:bad});assert.equal(r.status,400,String(bad))}
check('BR-K3 a malformed key is refused (400) and nothing is stored',rows('benchmark_credential').length===0);
const RID='rq-br-key-save-1';
r=await post(boss,{action:'benchmark_key_save',brandId:'fr-a',requestId:RID,apiKey:encodeURIComponent(KEY)});
const cred=rows('benchmark_credential');
check('BR-K4 the key is stored once as ciphertext bound to the brand (no plaintext anywhere, not in the response)',r.status===200&&r.body.result.saved===true&&cred.length===1&&cred[0].brandId==='fr-a'&&/^v1:/.test(cred[0].sealed)&&!allText().includes(KEY)&&!JSON.stringify(r.body).includes(KEY)&&!allText().includes(encodeURIComponent(KEY)));
r=await post(boss,{action:'benchmark_key_save',brandId:'fr-a',requestId:RID,apiKey:encodeURIComponent(KEY)});
check('BR-K5 the same request is replayed, not stored twice',r.status===200&&r.body.replayed===true&&rows('benchmark_credential').length===1&&audits('benchmark_key_save').length===1);
r=await get(member,'view=benchmark&brandId=fr-a');
check('BR-K6 the view says the key is saved without any key material',r.body.credential.saved===true&&typeof r.body.credential.savedAt==='string'&&!JSON.stringify(r.body).includes('sealed')&&!JSON.stringify(r.body).includes(KEY)&&r.body.readiness.canLoad===true);
check('BR-K7 other brands have no key',(await get(boss,'view=benchmark&brandId=fr-b')).body.credential.saved===false);

// ════ BR-L 적재 ════
r=await post(boss,{...LOAD,brands:['가상 010-0000-0199']});
check('BR-L1 a brand name with a phone number is refused (400 personal_data), no call',r.status===400&&r.body.reasons[0].code==='personal_data'&&external().length===0);
r=await post(boss,{...LOAD,year:2099});
check('BR-L2 a future base year is refused (400), no call',r.status===400&&r.body.reasons[0].code==='year_invalid'&&external().length===0);
handler=async()=>reply(200,page([item(),item({brandNm:'Old Ferry Donut',indutyMlsfcNm:'커피',frcsCnt:'12',avrgSlsAmt:'0'}),item({brandNm:'관계없는브랜드'})],3),{'last-modified':'Fri, 01 Aug 2026 00:00:00 GMT'});
const LOAD_RID='rq-br-load-1';
r=await post(boss,{...LOAD,requestId:LOAD_RID});
const fetches=rows('benchmark_fetch'),marks=rows('franchise_benchmark');
check('BR-L3 a load calls the fixed API once and records success',r.status===200&&r.body.result.status==='success'&&r.body.result.rowCount===2&&external().length===1&&fetches.length===1&&fetches[0].status==='success'&&fetches[0].attempts===1);
const u=new URL(external()[0]);
check('BR-L4 the call carries the decoded key, the year and JSON only to apis.data.go.kr',u.origin==='https://apis.data.go.kr'&&u.searchParams.get('serviceKey')===KEY&&u.searchParams.get('yr')==='2025'&&u.searchParams.get('resultType')==='json'&&f.calls.every(c=>c.startsWith('https://apis.data.go.kr/')));
const mark=marks[0];
check('BR-L5 the stored benchmark keeps the raw hash, request, collection time, API modified date and both years',marks.length===1&&/^[0-9a-f]{64}$/.test(mark.rawSha256)&&mark.request.year===2025&&JSON.stringify(mark.request.brands)==='["가상도넛","Old Ferry Donut"]'&&mark.baseYear===2025&&mark.performanceYear===2024&&typeof mark.collectedAt==='string'&&mark.apiModifiedAt==='Fri, 01 Aug 2026 00:00:00 GMT'&&mark.fetchId===fetches[0].id);
const donut=mark.rows.find(x=>x.brandName==='가상도넛'),ofd=mark.rows.find(x=>x.brandName==='Old Ferry Donut');
check('BR-L6 money is kept as the raw thousand-won value and won, zero money becomes null',donut.avgSales.rawThousandKrw===350000&&donut.avgSales.krw===350000000&&donut.avgSalesPerArea.krw===null&&ofd.avgSales.krw===null&&donut.stores===120);
check('BR-L7 representative name, registration numbers and HQ name are never stored',!/홍가상대표토큰|사업자번호토큰B|법인번호토큰B|가상본부토큰|rprsvNm|brno|crno/.test(allText()));
check('BR-L8 only the requested brands are kept',mark.rows.length===2&&!allText().includes('관계없는브랜드'));
const callsBefore=external().length;
r=await post(boss,{...LOAD,requestId:LOAD_RID});
check('BR-L9 resending the same load request replays it without calling again',r.status===200&&r.body.replayed===true&&r.body.result.fetchId===fetches[0].id&&external().length===callsBefore&&rows('benchmark_fetch').length===1);
// 중복 실행: 다른 적재가 잠금을 쥐고 있으면 409이고 호출하지 않는다.
sql.prepare('INSERT INTO mutation_locks(owner,token,expires_at) VALUES(?,?,?)').run(WS+':franchise-benchmark','held-by-other-load',Date.now()+60000);
r=await post(boss,LOAD);
check('BR-L10 a second load while one is running is refused (409) without calling',r.status===409&&r.body.error===T('BENCHMARK_RUNNING')&&external().length===callsBefore);
sql.prepare('DELETE FROM mutation_locks WHERE owner=?').run(WS+':franchise-benchmark');
const NOT_REGISTERED='<OpenAPI_ServiceResponse><cmmMsgHeader><errMsg>SERVICE ERROR</errMsg><returnAuthMsg>SERVICE_KEY_IS_NOT_REGISTERED_ERROR</returnAuthMsg><returnReasonCode>30</returnReasonCode></cmmMsgHeader></OpenAPI_ServiceResponse>';
handler=async()=>reply(200,NOT_REGISTERED,{'content-type':'text/xml'});
r=await post(boss,LOAD);
const blocked=rows('benchmark_fetch').find(x=>x.id===r.body.result.fetchId);
check('BR-L11 an unapproved API is recorded as blocked (SERVICE_NOT_REGISTERED) without retry and nothing is stored',r.status===200&&r.body.result.status==='blocked'&&r.body.result.failure.code==='SERVICE_NOT_REGISTERED'&&blocked.status==='blocked'&&blocked.attempts===1&&rows('franchise_benchmark').length===1);
handler=async()=>{throw new DOMException('The operation was aborted due to timeout','TimeoutError')};
const beforeTimeout=external().length;
r=await post(boss,LOAD);
check('BR-L12 per-call timeouts are retried three times and recorded as timeout',r.status===200&&r.body.result.status==='timeout'&&r.body.result.attempts===4&&r.body.result.retries===3&&external().length-beforeTimeout===4&&rows('franchise_benchmark').length===1);
handler=async()=>reply(200,'x'.repeat(200001));
r=await post(boss,LOAD);
check('BR-L13 a body over 200KB fails (TOO_LARGE) and nothing is stored',r.body.result.status==='failed'&&r.body.result.failure.code==='TOO_LARGE'&&rows('franchise_benchmark').length===1);
handler=async()=>reply(200,{resultCode:'00',items:[{name:'필드 이름이 다른 행'}]});
r=await post(boss,LOAD);
check('BR-L14 items without the expected fields fail as a schema mismatch and nothing is stored',r.body.result.status==='failed'&&r.body.result.failure.code==='SCHEMA_MISMATCH'&&rows('franchise_benchmark').length===1);
// 쪽 넘김: 업종만 주면 쪽 상한까지 읽고 30개만 남긴다. 둘째 쪽이 모자라면 멈춘다.
const pageOne=Array.from({length:400},(_,i)=>item({brandNm:'가상제과'+i,frcsCnt:String(i)})),pageTwo=[item({brandNm:'가상제과마지막',frcsCnt:'1000'}),item({brandNm:'치킨집',indutyMlsfcNm:'치킨'})];
const seenPages=[];
handler=async url=>{const p=new URL(url).searchParams.get('pageNo');seenPages.push(p);return reply(200,page(p==='1'?pageOne:pageTwo,402))};
r=await post(boss,{action:'benchmark_load',brandId:'fr-a',year:2025,brands:[],industry:'제과'});
const byIndustry=rows('franchise_benchmark').find(x=>x.fetchId===r.body.result.fetchId);
check('BR-L15 an industry load reads pages until the last one and keeps the 30 largest',r.body.result.status==='success'&&JSON.stringify(seenPages)==='["1","2"]'&&byIndustry.rows.length===30&&byIndustry.truncated===true&&byIndustry.rows[0].brandName==='가상제과마지막'&&byIndustry.rows.every(x=>x.industryMiddle==='제과제빵'));
check('BR-L16 every fetch keeps status, attempts, last activity and failure cause',rows('benchmark_fetch').every(x=>['success','failed','blocked','timeout'].includes(x.status)&&typeof x.attempts==='number'&&typeof x.lastActivityAt==='string'&&(x.status==='success'?x.failure===null:typeof x.failure.code==='string')));

// ════ BR-V 보기 ════
r=await get(member,'view=benchmark&brandId=fr-a');
const v=r.body,latest=v.latest;
check('BR-V1 the view lists fetches newest first with Korean status labels and failure messages',v.fetches.length===6&&v.fetches.every((x,i,a)=>!i||Date.parse(a[i-1].startedAt)>=Date.parse(x.startedAt))&&v.fetches.some(x=>x.status==='blocked'&&/SERVICE_NOT_REGISTERED/.test(x.failure.message))&&v.fetches.every(x=>typeof x.statusLabel==='string'&&typeof x.retries==='number'));
check('BR-V2 the latest benchmark shows its reference, years, units and derived metrics with formula and denominator',latest&&latest.ref==='franchise_benchmark:'+latest.fetchId&&latest.baseYear===2025&&latest.performanceYear===2024&&latest.rows.every(x=>x.derived&&/연말 가맹점 수/.test(x.derived.closureRate.formula)&&'denominator' in x.derived.closureRate)&&/천원/.test(v.dataset.unitNote)&&/N−1/.test(v.dataset.yearNote));
const staleId='bf-stale-1';
sql.prepare('INSERT INTO records(id,owner,kind,parent_id,data,updated_at) VALUES(?,?,?,?,?,?)').run(`${WS}:benchmark_fetch:${staleId}`,WS,'benchmark_fetch','fr-a',JSON.stringify({id:staleId,brandId:'fr-a',status:'running',request:{year:2025,brands:[],industry:'제과'},startedAt:'2026-01-01T00:00:00.000Z',finishedAt:null,lastActivityAt:'2026-01-01T00:00:00.000Z',attempts:0,pages:0,failure:null,rawSha256:null,apiModifiedAt:null,rowCount:0,by:{id:'br-boss',role:'admin'}}),'2026-01-01T00:00:00.000Z');
r=await get(boss,'view=benchmark&brandId=fr-a');
check('BR-V3 a load left running for more than five minutes shows as interrupted, not running',r.body.fetches.find(x=>x.id===staleId).status==='failed'&&r.body.fetches.find(x=>x.id===staleId).failure.code==='INTERRUPTED'&&r.body.readiness.canLoad===true);
check('BR-V4 other brands see no benchmark of fr-a',(await get(boss,'view=benchmark&brandId=fr-b')).body.fetches.length===0);

// ════ BR-G 브랜드 사실 확정 차단 ════
const facts=await f.load('lib/brand-facts-server.ts');
const fact=(status,source)=>({data:{brandId:'fr-c',key:'경쟁 브랜드 평균 매출',value:'3억 5천만원',status,source,verifiedAt:new Date(Date.now()-86400000).toISOString(),validUntil:new Date(Date.now()+30*86400000).toISOString()},confirmed:true});
let err=null;try{await facts.saveBrandFact(WS,fact('confirmed',latest.ref+' 가상도넛'),{id:'br-boss',email:null,role:'owner'})}catch(e){err=e}
check('BR-G1 a benchmark value cannot be confirmed as a brand fact (400)',err&&err.status===400&&/자사 예상매출 근거가 아님/.test(err.message)&&rows('brand_fact').length===0);
err=null;try{await facts.saveBrandFact(WS,fact('confirmed','https://apis.data.go.kr/1130000/FftcBrandFrcsStatsService/getBrandFrcsStats'),{id:'br-boss',email:null,role:'owner'})}catch(e){err=e}
check('BR-G2 the FTC statistics API address as the source is refused too (400)',err&&err.status===400);

// ════ BR-K 키 삭제 ════
check('setup: switch off for the clear',(await f.setFlag(boss,false)).status===200);
r=await post(boss,{action:'benchmark_key_clear',brandId:'fr-a'});
check('BR-K8 the key can be cleared even with the switch off (protective)',r.status===200&&r.body.result.saved===false&&rows('benchmark_credential').length===0);
check('setup: switch on after clear',(await f.setFlag(boss,true)).status===200);
const afterClear=external().length;
r=await post(boss,LOAD);
check('BR-K9 after clearing, loading is blocked again with no call',r.status===409&&r.body.error===T('BENCHMARK_KEY_MISSING')&&external().length===afterClear);

// ════ BR-X 감사·누출 ════
check('BR-X1 key saves, clears and loads are audited with Korean labels and no key',audits('benchmark_key_save').length===1&&audits('benchmark_key_clear').length===1&&audits('benchmark_load').length===6&&['benchmark_key_save','benchmark_key_clear','benchmark_load'].every(a=>/[가-힣]/.test(f.lib.AUDIT_ACTION_LABELS[a]))&&!JSON.stringify(rows('franchise_audit')).includes(KEY));
check('BR-X2 console output holds no key and no request address',!logged.some(l=>l.includes(KEY)||l.includes(encodeURIComponent(KEY))||l.includes('apis.data.go.kr')));
check('BR-X3 every external call went to the public data portal only',f.calls.every(c=>c.startsWith('https://apis.data.go.kr/1130000/FftcBrandFrcsStatsService/getBrandFrcsStats?')));
check('BR-X4 no token-spending or model call happened (no HERMES submission rows)',sql.prepare("SELECT COUNT(*) n FROM records WHERE kind IN ('hermes_submission','openai_submission','token_reservation')").get().n===0);
console.log(JSON.stringify({passed:passed.length}));
