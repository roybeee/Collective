// 게이트웨이 상태 스냅샷(F2b): 워커 tick의 하루 1회 스냅샷, 정규화·해시, 변경 경보, 막힘(blocked), 건너뜀, 사용량 응답, 평가 run 기준 해시.
// 근거: mocked(운영·평가 HERMES fetch 스텁, 메모리 SQLite, 로컬 인증 헤더, 합성 응답). 외부 네트워크 호출은 0회다.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {testRuntime} from './helpers/runtime.mjs';

const OPS='https://hermes.example.com',EVAL='https://eval-hermes.example.com',DENY='https://hermes-deny.example.com';
// 합성 게이트웨이 응답. sentinel 문자열은 저장소에 원문이 남는지 보려는 표식이다.
const baseCaps={object:'hermes.api_server.capabilities',platform:'hermes-agent',version:'raw-version-sentinel',features:{run_submission:true,run_status:true,run_stop:true,runs_idempotency:{durable:true,enabled:true,supported:true}}};
const baseToolsets=[{name:'web',description:'raw-description-sentinel',tools:['search','fetch'],enabled:true},{name:'files',description:'파일 도구',tools:['read'],enabled:false}];
const baseModels=[{id:'hermes-agent',object:'model',owned_by:'hermes'}];
const state={caps:baseCaps,toolsets:baseToolsets,models:baseModels,fail:null,hang:false,shuffle:false,seq:0};
const calls=[],external=[],errors=[];
const reverseKeys=o=>Object.fromEntries(Object.entries(o).reverse());
function body(section){
 const t=++state.seq;
 if(section==='capabilities')return state.shuffle?reverseKeys({...state.caps,created_at:t,request_id:'req-'+t}):{...state.caps,created_at:t,request_id:'req-'+t};
 if(section==='toolsets'){const data=state.shuffle?[...state.toolsets].reverse().map(reverseKeys):state.toolsets;return {object:'list',generated_at:t,data}}
 return {object:'list',data:(state.shuffle?[...state.models].reverse():state.models).map(m=>({...m,created:t}))};
}
let failGatewayWrite=false;
const {sql,load}=testRuntime(async(url,options={})=>{
 url=String(url);const headers=new Headers(options.headers||{}),method=options.method||'GET',host=[OPS,EVAL,DENY].find(h=>url.startsWith(h+'/'));
 if(!host){external.push(url);throw new Error('모의 주소만 호출합니다: '+url)}
 const path=url.slice(host.length);calls.push({host,path,method,auth:headers.get('authorization')});
 if(!headers.get('authorization')||host===DENY)return new Response('{}',{status:401});
 const section=/^\/v1\/(capabilities|toolsets|models)$/.exec(path)?.[1];
 if(!section||method!=='GET')return new Response('{}',{status:404});
 if(state.hang)return new Promise((_,reject)=>options.signal?.addEventListener('abort',()=>reject(new Error('aborted'))));
 if(state.fail===section)return new Response('{}',{status:500});
 return Response.json(body(section));
},{beforeRun(statement){if(failGatewayWrite&&statement.values.includes('gateway_snapshot'))throw new Error('injected gateway write failure')}});
const server=await load('lib/server.ts'),worker=await load('lib/research-worker.ts'),gateway=await load('lib/gateway-snapshot.ts');
const usageRoute=await load('app/api/usage/route.ts'),evalRoute=await load('app/api/eval/route.ts'),registry=await load('lib/record-kinds.ts');
const passed=[];const check=(name,value)=>{assert.ok(value,name);passed.push(name)};
const plain=v=>JSON.parse(JSON.stringify(v));
const now=new Date(),day=n=>new Date(now.getTime()+n*86400000);
const setConnection=async(owner,secret)=>sql.prepare('INSERT INTO settings(owner,secret,model,updated_at) VALUES(?,?,?,?) ON CONFLICT(owner) DO UPDATE SET secret=excluded.secret').run(owner,await server.encrypt(secret),'HERMES',now.toISOString());
const hermes=endpoint=>JSON.stringify({provider:'hermes',endpoint,key:'mock-only-key'});
const rows=(owner,kind)=>sql.prepare('SELECT data FROM records WHERE owner=? AND kind=? ORDER BY updated_at,rowid').all(owner,kind).map(r=>JSON.parse(r.data));
const gatewayCalls=host=>calls.filter(c=>c.host===host&&/^\/v1\/(capabilities|toolsets|models)$/.test(c.path)).length;
const originalError=console.error;console.error=(...args)=>{errors.push(args.join(' '))};
async function tickFor(owner){
 const token=await worker.registerWorker(owner),hash=await worker.workerHash(token);
 let executed=0;
 const tick=()=>worker.workerTick({owner,hash},async()=>Response.json({}),async()=>({status:'idle'}),async()=>{executed++;return {status:'processed'}});
 return {tick,executed:()=>executed};
}

// A) 미설정·OpenAI 연결은 not_run 기록 없이 건너뛴다.
const unconfigured=await tickFor('gw-unconfigured');
let result=await unconfigured.tick();
check('unconfigured owner tick still runs other queues',result.status==='processed'&&unconfigured.executed()===1);
check('unconfigured owner writes no snapshot and calls no gateway',rows('gw-unconfigured','gateway_snapshot').length===0&&calls.length===0);
await setConnection('gw-openai','sk-mock-openai-only');
const openai=await tickFor('gw-openai');
result=await openai.tick();
check('OpenAI connection is skipped without a record',result.status==='processed'&&rows('gw-openai','gateway_snapshot').length===0&&calls.length===0);

// B) HERMES 운영 연결: 첫 tick에 스냅샷 1건(3개 GET, 인증 헤더), 기준값이라 변경 경보 0건. 같은 UTC 날짜 두 번째 tick은 호출 0회.
const owner='gw-owner';await setConnection(owner,hermes(OPS));
const ops=await tickFor(owner);
result=await ops.tick();
let snaps=rows(owner,'gateway_snapshot');
check('first tick records one passed snapshot',snaps.length===1&&snaps[0].status==='passed'&&/^[0-9a-f]{64}$/.test(snaps[0].hash));
check('snapshot reads capabilities, toolsets and models with the connection key',JSON.stringify(calls.filter(c=>c.host===OPS).map(c=>c.path).sort())==='["/v1/capabilities","/v1/models","/v1/toolsets"]'&&calls.every(c=>c.auth==='Bearer mock-only-key'));
check('snapshot date is the UTC date of the snapshot time',snaps[0].date===snaps[0].takenAt.slice(0,10)&&snaps[0].date===now.toISOString().slice(0,10));
check('first snapshot is only the baseline (no change alarm)',rows(owner,'gateway_change').length===0);
check('tick with a snapshot still advances work',result.status==='processed'&&ops.executed()===1);
const firstHash=snaps[0].hash;
await ops.tick();
check('second tick on the same UTC day makes no gateway call and no snapshot',gatewayCalls(OPS)===3&&rows(owner,'gateway_snapshot').length===1);
const stored=JSON.stringify(sql.prepare("SELECT data FROM records WHERE owner=? AND kind='gateway_snapshot'").all(owner));
check('snapshot keeps hashes and section summaries, not raw response text',!stored.includes('raw-description-sentinel')&&!stored.includes('raw-version-sentinel')&&!stored.includes('파일 도구'));
check('snapshot never stores the key or the gateway address',!stored.includes('mock-only-key')&&!stored.includes('hermes.example.com'));
check('each section has its own hash',['capabilities','toolsets','models'].every(s=>/^[0-9a-f]{64}$/.test(snaps[0].sections[s].hash)));

// C) 정규화: 변동 필드(시각·요청 번호)와 키·배열 순서가 바뀌어도 해시가 같다. 무엇을 지웠는지 기록한다.
state.shuffle=true;
let r=plain(await gateway.recordGatewaySnapshot(owner,{now:day(1)}));
snaps=rows(owner,'gateway_snapshot');
check('next UTC day takes a new snapshot',r.status==='passed'&&snaps.length===2&&snaps[1].date===day(1).toISOString().slice(0,10));
check('volatile fields and key or array order do not change the hash',snaps[1].hash===firstHash&&rows(owner,'gateway_change').length===0);
check('removed volatile field names are recorded',['created','created_at','generated_at','request_id'].every(k=>snaps[1].removedFields.includes(k)));
check('normalizer sorts keys, drops volatile fields and sorts arrays without mutating input',(()=>{const input={b:[3,1],a:{request_id:'x',z:1,y:2}},before=JSON.stringify(input),n=plain(gateway.normalizeGatewayResponse(input));return JSON.stringify(n.value)==='{"a":{"y":2,"z":1},"b":[1,3]}'&&JSON.stringify(n.removed)==='["request_id"]'&&JSON.stringify(input)===before})());

// D) 모델 목록이 바뀌면 경보 1건(바뀐 섹션만, 추가 경로 요약). 같은 값 반복은 0건.
state.shuffle=false;state.models=[...baseModels,{id:'reported-model-b',object:'model',owned_by:'hermes'}];
r=plain(await gateway.recordGatewaySnapshot(owner,{now:day(2)}));
let changes=rows(owner,'gateway_change');
check('a changed model list writes exactly one change',r.status==='passed'&&changes.length===1);
check('change summary names only the changed section',changes[0].sections.length===1&&changes[0].sections[0].section==='models');
check('change summary lists the added model paths',changes[0].sections[0].added.some(p=>p.startsWith('data[reported-model-b]'))&&changes[0].sections[0].removed.length===0);
check('change links the previous and new hashes and dates',changes[0].fromHash===firstHash&&changes[0].toHash===rows(owner,'gateway_snapshot')[2].hash&&changes[0].fromDate===day(1).toISOString().slice(0,10)&&changes[0].toDate===day(2).toISOString().slice(0,10));
const modelHash=rows(owner,'gateway_snapshot')[2].hash;

// E) 응답 실패·타임아웃은 blocked 스냅샷, 경보 0건. 기준값은 마지막 passed 스냅샷으로 남는다.
state.fail='toolsets';
r=plain(await gateway.recordGatewaySnapshot(owner,{now:day(3)}));
snaps=rows(owner,'gateway_snapshot');
check('a failing section records a blocked snapshot without a hash',r.status==='blocked'&&snaps[3].status==='blocked'&&snaps[3].hash===null&&/toolsets/.test(snaps[3].blockedReason));
check('blocked snapshot writes no change',rows(owner,'gateway_change').length===1);
state.fail=null;state.hang=true;
// Node의 AbortSignal.timeout 타이머는 unref라 대기 중 프로세스가 끝나지 않게 잠시 붙잡는다(테스트 전용).
const started=Date.now(),keepAlive=setTimeout(()=>{},10000);
r=plain(await gateway.recordGatewaySnapshot(owner,{now:day(4),timeoutMs:50}));clearTimeout(keepAlive);
check('a hanging gateway times out quickly as blocked',r.status==='blocked'&&Date.now()-started<3000&&rows(owner,'gateway_snapshot')[4].status==='blocked');
check('per-call timeout stays far below the 60 second worker tick',gateway.GATEWAY_TIMEOUT_MS<=10000);
state.hang=false;
r=plain(await gateway.recordGatewaySnapshot(owner,{now:day(5)}));
check('after blocked days the comparison uses the last passed snapshot',r.status==='passed'&&rows(owner,'gateway_snapshot')[5].hash===modelHash&&rows(owner,'gateway_change').length===1);
state.caps={...baseCaps,features:{...baseCaps.features,run_stop:false}};
await gateway.recordGatewaySnapshot(owner,{now:day(6)});
changes=rows(owner,'gateway_change');
check('a changed capability is summarised by path',changes.length===2&&changes[1].sections[0].section==='capabilities'&&changes[1].sections[0].changed.includes('features.run_stop'));
check('change summaries never contain raw values, key or address',!JSON.stringify(changes).includes('raw-')&&!JSON.stringify(changes).includes('mock-only-key')&&!JSON.stringify(changes).includes('hermes.example.com'));

// F) 실패가 tick과 다른 작업을 막지 않는다: 인증 실패(blocked 기록)와 저장 실패(기록 없음, 로그 1줄).
await setConnection('gw-deny',hermes(DENY));
const deny=await tickFor('gw-deny');
result=await deny.tick();
check('an unauthorised gateway is a blocked snapshot and the tick continues',rows('gw-deny','gateway_snapshot')[0]?.status==='blocked'&&result.status==='processed'&&deny.executed()===1);
await setConnection('gw-broken',hermes(OPS));
const broken=await tickFor('gw-broken');
failGatewayWrite=true;const errorsBefore=errors.length;
result=await broken.tick();failGatewayWrite=false;
check('a snapshot storage failure does not fail the tick',result.status==='processed'&&broken.executed()===1&&rows('gw-broken','gateway_snapshot').length===0);
check('a snapshot storage failure leaves one log line',errors.slice(errorsBefore).filter(e=>/gateway_snapshot_failed/.test(e)).length===1);

// G) 사용량 응답: 마지막 스냅샷 상태와 최근 변경. 화면은 모델 경보 근처에 표시한다.
const usage=await (await usageRoute.GET(new Request('https://agency.test/api/usage',{headers:{'oai-authenticated-user-id':owner}}))).json();
check('usage response has the last snapshot status',usage.gateway?.snapshot?.status==='passed'&&usage.gateway.snapshot.date===day(6).toISOString().slice(0,10)&&/^[0-9a-f]{64}$/.test(usage.gateway.snapshot.hash));
check('usage response has recent gateway changes newest first',usage.gateway.changes.length===2&&usage.gateway.changes[0].sections[0].section==='capabilities');
check('usage response exposes no key or address',!JSON.stringify(usage.gateway).includes('mock-only-key')&&!JSON.stringify(usage.gateway).includes('hermes.example.com'));
const none=await (await usageRoute.GET(new Request('https://agency.test/api/usage',{headers:{'oai-authenticated-user-id':'gw-unconfigured'}}))).json();
check('owners without snapshots get an empty gateway status',none.gateway.snapshot===null&&none.gateway.changes.length===0);
const panel=readFileSync('app/usage-panel.tsx','utf8');
check('usage panel shows the gateway status next to the model alarm',/GatewayAlarm/.test(panel)&&/게이트웨이/.test(panel)&&/<ModelAlarm[^>]*\/>\s*<GatewayAlarm/.test(panel));

// H) 평가 run 시작 시점 기준 해시: 운영 최신 passed 스냅샷(basis operational)과 같은 함수로 잰 평가 연결 해시(basis eval).
// 평가 연결 저장 검사(verifyHermes)가 run_stop을 요구하므로 기능을 되돌린 7일째 스냅샷을 먼저 남긴다(되돌림도 변경 1건).
state.caps=baseCaps;
await gateway.recordGatewaySnapshot(owner,{now:day(7)});
check('reverting a capability is another change',rows(owner,'gateway_change').length===3);
const post=input=>evalRoute.POST(new Request('https://agency.test/api/eval',{method:'POST',headers:{'oai-authenticated-user-id':owner,'content-type':'application/json'},body:JSON.stringify(input)})).then(async res=>({status:res.status,body:await res.json()}));
const brand={id:'gw-brand',name:'가상분식',short:'GB',category:'SNACK BAR',color:'#224466',bg:'#eef2f6',description:'합성 소개(미확인).',audience:'가상동 주민(가설)',tone:'명료한',constraints:'가격은 확인 전 확정하지 않는다.',knowledge:'합성 메모.'};
const campaign={id:'gw-campaign',brandId:brand.id,title:'가상분식 오픈',goal:'오픈 전 인지와 첫 포장 주문을 만든다.',audience:'가상동 주민(가설)',channels:'Instagram',stores:'가상동 12',products:'떡볶이(가격 미확정)',budget:null,startDate:'',endDate:'',constraints:'할인 약속 금지.',sources:'',status:'draft',version:1,createdAt:now.toISOString(),updatedAt:now.toISOString()};
await server.recordStatement(owner,'brand',brand.id,brand).run();await server.recordStatement(owner,'campaign',campaign.id,campaign).run();
check('eval connection saves',(await post({action:'save_connection',endpoint:EVAL,key:'eval-mock-key',isolationConfirmed:true})).status===200);
const kase=(await post({action:'capture_case',campaignId:campaign.id,role:'cmo'})).body;
const started2=await post({action:'start_run',caseIds:[kase.id],tokenBudget:50000});
const basis=started2.body.gatewaySnapshot,lastPassed=rows(owner,'gateway_snapshot').filter(s=>s.status==='passed').at(-1);
check('eval run records the latest operational snapshot hash and says it is operational',started2.status===200&&basis.operational.basis==='operational'&&basis.operational.hash===lastPassed.hash&&basis.operational.date===lastPassed.date);
check('eval run records the eval connection hash from the same snapshot function',basis.eval.basis==='eval'&&basis.eval.status==='passed'&&basis.eval.hash===lastPassed.hash);
check('eval run gateway basis has no key or address',!JSON.stringify(basis).includes('eval-mock-key')&&!JSON.stringify(basis).includes('example.com'));
check('eval start never writes an operational snapshot record',rows(owner,'gateway_snapshot').length===8);
const evalBlocked=plain(await gateway.gatewayBasis(owner,{endpoint:DENY,key:'eval-mock-key'}));
check('an unreachable eval gateway is a blocked eval basis, not a start failure',evalBlocked.eval.status==='blocked'&&evalBlocked.eval.hash===null&&evalBlocked.operational.hash===lastPassed.hash);

// I) kind 등록
const kinds=plain(registry.recordKinds);
check('gateway kinds are registered and not campaign scoped',['gateway_snapshot','gateway_change'].every(k=>kinds.find(x=>x.kind===k)?.campaignDeletion==='not_campaign_scoped'));
check('no external network call',external.length===0);
console.error=originalError;
console.log(JSON.stringify({passed:passed.length,checks:passed},null,2));
