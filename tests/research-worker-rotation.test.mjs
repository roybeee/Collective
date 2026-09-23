// 작업자 자격증명 만료·온라인 회전·재발급 유예·거부 기록·앱 gate 확인(security-ops-4·7 앱 측).
// 근거: mocked(메모리 SQLite, 로컬 Request로 워커 경로 호출, 운영 HERMES fetch 스텁). 외부 네트워크 호출은 0회다. 시간은 저장된 만료·유예 시각을 바꿔 주입한다.
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {testRuntime} from './helpers/runtime.mjs';

const OPS='https://hermes.example.com',DAY=86400000,MIN=60000;
const external=[],gatewayCalls=[],writes=[];
const {sql,env,load}=testRuntime(async(url)=>{
 url=String(url);
 if(!url.startsWith(OPS+'/')){external.push(url);throw new Error('모의 주소만 호출합니다: '+url)}
 const path=url.slice(OPS.length);gatewayCalls.push(path);
 if(/^\/v1\/(capabilities|toolsets|models)$/.test(path))return Response.json(path.endsWith('capabilities')?{object:'hermes.api_server.capabilities',features:{run_submission:true}}:{object:'list',data:[]});
 return new Response('{}',{status:404});
},{beforeRun(statement){writes.push(statement.values)}});
const server=await load('lib/server.ts'),worker=await load('lib/research-worker.ts'),route=await load('app/api/research-worker/route.ts');

const outcomes=[];
function check(name,value){outcomes.push({name,passed:!!value});if(!value)console.error('FAIL',name)}
const hex64=/^[a-f0-9]{64}$/;
const sha=value=>createHash('sha256').update(value).digest('hex');
const plain=value=>JSON.parse(JSON.stringify(value));
const rows=(owner,kind)=>sql.prepare('SELECT data FROM records WHERE owner=? AND kind=?').all(owner,kind).map(r=>JSON.parse(r.data));
const credential=owner=>rows(owner,'worker_credential')[0];
const setCredential=(owner,patch)=>server.recordStatement(owner,'worker_credential','current',{...credential(owner),...patch}).run();
const setState=(owner,patch)=>server.recordStatement(owner,'worker_state','current',{...rows(owner,'worker_state')[0],...patch}).run();
const status=async owner=>plain(await worker.workerStatus(owner,{admin:true}));
const near=(iso,target,slack=10000)=>typeof iso==='string'&&Math.abs(Date.parse(iso)-target)<slack;
const allRecords=()=>JSON.stringify(sql.prepare('SELECT data FROM records').all());
const rejectionWrites=()=>writes.filter(v=>v[2]==='worker_rejection').length;
const credentialWrites=()=>writes.filter(v=>v[2]==='worker_credential').length;
// 기본으로 워커가 새 토큰을 저장할 수 있다고 알린다(X-Collective-Rotation: ready). null을 주면 그 헤더를 뺀다.
async function tick(owner,token,headers={}){
 const all={'content-type':'application/json',authorization:'Bearer '+token,'x-collective-owner':owner,'x-collective-rotation':'ready',...headers};for(const k in all)if(all[k]===null)delete all[k];
 const response=await route.POST(new Request('https://agency.test/api/research-worker',{method:'POST',headers:all,body:'{}'}));
 return {status:response.status,data:await response.json()};
}
const APP_MESSAGE='작업자 연결이 해제됐거나 인증이 만료됐습니다.',GATE_MESSAGE='작업자 요청의 사이트 gate 확인에 실패했습니다.';

// A0) 기본(RESEARCH_WORKER_TOKEN_EXPIRY 없음): 새 발급에도 만료가 없고 200일 뒤에도 통과하며 교체를 제안하지 않는다(운영을 멈추는 기본 차단 금지).
let owner='rot-default-off';
let token=await worker.registerWorker(owner);
check('without the expiry flag a new credential has no expiry',!('expiresAt' in credential(owner)));
await setCredential(owner,{createdAt:new Date(Date.now()-200*DAY).toISOString()});
let r=await tick(owner,token);
check('without the expiry flag a 200-day-old credential keeps working without rotation',r.status===200&&!('rotation' in r.data)&&!credential(owner).next);
let s=await status(owner);
check('status reports expiry as off',s.expiryEnforced===false&&s.expiresAt===null&&s.rotationOfferedAt===null);
env.RESEARCH_WORKER_TOKEN_EXPIRY='on';
await worker.registerWorker('rot-flag-on');
check('only the exact enforce value turns expiry on',!('expiresAt' in credential('rot-flag-on')));
delete env.RESEARCH_WORKER_TOKEN_EXPIRY;
// 되돌리기: 환경변수를 지우면 이미 저장된 만료도 검사하지 않는다.
await setCredential(owner,{expiresAt:new Date(Date.now()-DAY).toISOString()});
check('without the expiry flag a stored past expiry is not enforced (rollback)',(await tick(owner,token)).status===200);
env.RESEARCH_WORKER_TOKEN_EXPIRY='enforce';
check('with the expiry flag the same stored expiry is enforced',(await tick(owner,token)).status===401);

// A) RESEARCH_WORKER_TOKEN_EXPIRY=enforce: 발급 후 90일 만료. 만료 전에는 통과, 만료 뒤에는 기존 앱 문구의 401과 거부 기록.
owner='rot-expiry';
token=await worker.registerWorker(owner);
let saved=credential(owner);
check('issued token is 64 hex and stored only as a hash',hex64.test(token)&&saved.hash===sha(token)&&!allRecords().includes(token));
check('issued credential expires 90 days after issue',near(saved.expiresAt,Date.parse(saved.createdAt)+90*DAY,1000));
r=await tick(owner,token);
check('token before expiry is accepted without rotation',r.status===200&&!('rotation' in r.data));
s=await status(owner);
check('status reports issue time, expiry and no pending rotation',s.expiryEnforced===true&&s.expiresAt===saved.expiresAt&&s.issuedAt===saved.createdAt&&s.rotationOfferedAt===null&&s.online===true);
await setCredential(owner,{expiresAt:new Date(Date.now()-1000).toISOString()});
r=await tick(owner,token);
check('expired token is rejected with the unchanged app message',r.status===401&&r.data.error===APP_MESSAGE);
s=await status(owner);
check('expired rejection is recorded for the settings screen',near(s.lastRejectedAt,Date.now())&&s.lastRejectedReason==='expired');

// 이전 방식 자격증명(만료 필드 없음)은 오래돼도 막지 않고 회전도 제안하지 않는다(가동 중 운영 워커를 멈추지 않는다).
owner='rot-legacy';
token='a'.repeat(64);
await server.recordStatement(owner,'worker_credential','current',{hash:sha(token),createdAt:new Date(Date.now()-200*DAY).toISOString()}).run();
r=await tick(owner,token);
check('legacy credential without expiry keeps working and is not rotated',r.status===200&&!('rotation' in r.data));
check('legacy credential shows no expiry',(await status(owner)).expiresAt===null);

// B) 만료 14일 전부터 tick 응답에 새 토큰. 겹치는 동안 둘 다 유효하고, 새 토큰으로 성공하면 이전 토큰을 폐기한다.
owner='rot-rotate';
token=await worker.registerWorker(owner);
await setCredential(owner,{expiresAt:new Date(Date.now()+30*DAY).toISOString()});
r=await tick(owner,token);
check('no rotation more than 14 days before expiry',r.status===200&&!('rotation' in r.data));
await setCredential(owner,{expiresAt:new Date(Date.now()+13*DAY).toISOString()});
r=await tick(owner,token,{'x-collective-rotation':null});
check('no rotation is offered unless the worker reports it can save the token',r.status===200&&!('rotation' in r.data)&&!credential(owner).next&&(await status(owner)).rotationReady===false);
r=await tick(owner,token);
const first=r.data.rotation?.token;
check('tick inside the 14-day window returns a new token once',r.status===200&&hex64.test(first||'')&&first!==token&&near(r.data.rotation.expiresAt,Date.now()+90*DAY));
saved=credential(owner);
check('only the hash of the next token is stored',saved.next?.hash===sha(first||'')&&!allRecords().includes(first));
const offeredAt=(await status(owner)).rotationOfferedAt;
check('status shows the pending rotation',near(offeredAt,Date.now()));
check('status shows the worker reported rotation support',(await status(owner)).rotationReady===true);
let before=credentialWrites();
r=await tick(owner,token);
check('a re-offer within 10 minutes sends no token and writes no credential',r.status===200&&!('rotation' in r.data)&&credentialWrites()===before&&credential(owner).next.hash===sha(first||''));
await setCredential(owner,{next:{...credential(owner).next,createdAt:new Date(Date.now()-11*MIN).toISOString()}});
r=await tick(owner,token);
const second=r.data.rotation?.token;
check('current token stays valid during overlap and a lost offer is replaced after 10 minutes',r.status===200&&hex64.test(second||'')&&second!==first);
check('rotation start time survives a re-offer',(await status(owner)).rotationOfferedAt===offeredAt);
check('replaced offer is no longer accepted',(await tick(owner,first)).status===401);
r=await tick(owner,second);
saved=credential(owner);
check('tick with the next token succeeds and promotes it',r.status===200&&!('rotation' in r.data)&&saved.hash===sha(second)&&!saved.next&&!saved.rotationOfferedAt&&near(saved.expiresAt,Date.now()+90*DAY));
r=await tick(owner,token);
check('old token is discarded after the new token is used',r.status===401&&r.data.error===APP_MESSAGE);
check('discarded token rejection is recorded',(await status(owner)).lastRejectedReason==='unknown_token');
s=await status(owner);
check('promoted worker is online with a fresh 90-day expiry and no pending rotation',s.online&&s.rotationOfferedAt===null&&near(s.expiresAt,Date.now()+90*DAY));
check('promoted token keeps working',(await tick(owner,second)).status===200);
// 겹침은 이전 토큰의 만료까지만: 이전 토큰이 만료돼도 이미 받은 다음 토큰은 통과한다.
await setCredential(owner,{expiresAt:new Date(Date.now()+DAY).toISOString()});
const third=(await tick(owner,second)).data.rotation?.token;
await setCredential(owner,{expiresAt:new Date(Date.now()-1000).toISOString()});
check('expired current token is rejected during rotation',(await tick(owner,second)).status===401);
check('next token still promotes after the current token expired',(await tick(owner,third)).status===200&&credential(owner).hash===sha(third||''));

// C) 설치 파일 재발급: 가동 중 워커가 있으면 그 토큰을 10분 동안 함께 받는다. 유예가 끝나면 거부하고 기록한다.
owner='rot-grace';
token=await worker.registerWorker(owner);
check('running worker ticks',(await tick(owner,token)).status===200);
let renewed=await worker.registerWorker(owner,[],{graceIfOnline:true});
saved=credential(owner);
check('reissue keeps the running token for a 10-minute grace',saved.hash===sha(renewed)&&saved.previous?.hashes?.includes(sha(token))&&near(saved.previous.until,Date.now()+10*MIN));
r=await tick(owner,token);
check('old token works during the grace period',r.status===200&&!('rotation' in r.data));
s=await status(owner);
check('status shows grace deadline and waits for the new install',near(s.graceUntil,Date.now()+10*MIN)&&s.activated===false&&s.online===false);
check('grace tick does not promote the old token',credential(owner).hash===sha(renewed));
check('new install token is accepted during grace',(await tick(owner,renewed)).status===200&&(await status(owner)).online===true);
await setCredential(owner,{previous:{...credential(owner).previous,until:new Date(Date.now()-1000).toISOString()}});
r=await tick(owner,token);
check('old token is rejected after the grace period',r.status===401&&r.data.error===APP_MESSAGE);
s=await status(owner);
check('grace end rejection is recorded and grace is no longer shown',s.lastRejectedReason==='grace_ended'&&s.graceUntil===null);
// 유예는 가동 중 워커가 이미 받았을 수 있는 다음 토큰도 함께 넘긴다(회전 중 재발급).
owner='rot-grace-next';
token=await worker.registerWorker(owner);
await setCredential(owner,{expiresAt:new Date(Date.now()+DAY).toISOString()});
const pending=(await tick(owner,token)).data.rotation?.token;
renewed=await worker.registerWorker(owner,[],{graceIfOnline:true});
check('grace also accepts the next token of the running worker',(await tick(owner,pending)).status===200&&credential(owner).hash===sha(renewed));
// 응답이 끊긴 워커(3분 넘게 응답 없음)나 옵션 없는 발급은 유예 없이 바로 바꾼다.
owner='rot-offline';
token=await worker.registerWorker(owner);
await tick(owner,token);
await setState(owner,{lastSeen:new Date(Date.now()-4*MIN).toISOString()});
renewed=await worker.registerWorker(owner,[],{graceIfOnline:true});
check('offline worker gets no grace',!credential(owner).previous&&(await tick(owner,token)).status===401);
owner='rot-default';
token=await worker.registerWorker(owner);
await tick(owner,token);
await worker.registerWorker(owner);
check('reissue without the grace option invalidates immediately',(await tick(owner,token)).status===401);
// 연결 해제 뒤에는 자격증명이 없으므로 거부 기록도 쓰지 않는다.
owner='rot-revoke';
token=await worker.registerWorker(owner);
await tick(owner,token);
await worker.revokeWorker(owner);
before=rejectionWrites();
check('revoked worker is rejected without writing a rejection record',(await tick(owner,token)).status===401&&rejectionWrites()===before&&rows(owner,'worker_rejection').length===0);

// D) 거부 기록은 자격증명이 있는 소유자만, 같은 사유는 1분에 한 번만 쓴다. 형식이 틀린 요청은 DB에 쓰지 않는다.
owner='rot-reject';
token=await worker.registerWorker(owner);
before=rejectionWrites();
await tick(owner,'b'.repeat(64));await tick(owner,'c'.repeat(64));
check('repeated rejections within a minute are throttled',rejectionWrites()===before+1&&near(rows(owner,'worker_rejection')[0].unknown_token,Date.now()));
before=writes.length;
r=await tick(owner,'not-a-token');
check('malformed token is rejected without any write',r.status===401&&r.data.error==='작업자 인증이 필요합니다.'&&writes.length===before);
before=rejectionWrites();
await tick('rot-nobody','d'.repeat(64));
check('unknown owner writes no rejection record',rejectionWrites()===before&&rows('rot-nobody','worker_rejection').length===0);
check('rejection record holds no token or header value',!JSON.stringify(rows(owner,'worker_rejection')).includes('b'.repeat(64)));
await worker.registerWorker(owner);
check('reissue clears the previous rejection record',rows(owner,'worker_rejection').length===0);
// 사유별로 따로 남긴다. owner 헤더만 맞춘 가짜 토큰(unknown_token)이 실제 원인(만료)을 덮지 못한다.
owner='rot-reject-priority';
token=await worker.registerWorker(owner);
await setCredential(owner,{expiresAt:new Date(Date.now()-1000).toISOString()});
await tick(owner,token);await tick(owner,'f'.repeat(64));
s=await status(owner);
check('a forged unknown_token rejection cannot hide an earlier expiry rejection',s.lastRejectedReason==='expired'&&near(s.lastRejectedAt,Date.now())&&near(rows(owner,'worker_rejection')[0].unknown_token,Date.now()));

// E) 사이트 공통 gate: 기본은 기록만, RESEARCH_WORKER_APP_GATE=enforce일 때만 차단. 토큰 검사가 먼저라 가짜 토큰은 기존 앱 문구의 401이다.
owner='rot-gate';
token=await worker.registerWorker(owner);
env.RESEARCH_WORKER_GATE_TOKEN='site-gate-test-only';
r=await tick(owner,token);
check('record mode accepts a request without the gate header',r.status===200&&(await status(owner)).gate==='missing');
r=await tick(owner,token,{'oai-sites-authorization':'Bearer wrong-gate'});
s=await status(owner);
check('record mode accepts but records a wrong gate header',r.status===200&&s.gate==='mismatch'&&s.gateEnforced===false);
r=await tick(owner,token,{'oai-sites-authorization':'Bearer site-gate-test-only'});
check('matching gate header is recorded as ok',r.status===200&&(await status(owner)).gate==='ok');
check('gate secret is never stored',!allRecords().includes('site-gate-test-only')&&!allRecords().includes('wrong-gate'));
env.RESEARCH_WORKER_APP_GATE='on';
check('only the exact enforce value turns blocking on',(await tick(owner,token)).status===200);
env.RESEARCH_WORKER_APP_GATE='enforce';
const lastSeen=rows(owner,'worker_state')[0].lastSeen;
r=await tick(owner,token);
check('enforce mode rejects a missing gate header with 403',r.status===403&&r.data.error===GATE_MESSAGE);
check('gate rejection is recorded and the tick does not run',(await status(owner)).lastRejectedReason==='gate'&&rows(owner,'worker_state')[0].lastSeen===lastSeen);
check('enforce mode rejects a wrong gate header',(await tick(owner,token,{'oai-sites-authorization':'Bearer wrong-gate'})).status===403);
r=await tick(owner,token,{'oai-sites-authorization':'Bearer site-gate-test-only'});
s=await status(owner);
check('enforce mode accepts the matching gate header',r.status===200&&s.gate==='ok'&&s.gateEnforced===true);
r=await tick(owner,'e'.repeat(64));
check('fake token without gate still gets the app 401 first (probe attribution unchanged)',r.status===401&&r.data.error===APP_MESSAGE);
delete env.RESEARCH_WORKER_GATE_TOKEN;
check('enforce mode fails closed when the app has no gate secret',(await tick(owner,token,{'oai-sites-authorization':'Bearer site-gate-test-only'})).status===403);
delete env.RESEARCH_WORKER_APP_GATE;
r=await tick(owner,token);
check('without the gate secret record mode keeps working',r.status===200&&(await status(owner)).gate==='unset');
// 일반 멤버 화면(workspace, setup GET member)에는 만료·회전·거부·gate 상태를 내려주지 않는다.
const member=plain(await worker.workerStatus(owner));
check('member status omits admin-only credential and gate fields',['gate','gateEnforced','lastRejectedAt','lastRejectedReason','graceUntil','rotationOfferedAt','rotationReady','expiresAt','expiryEnforced','issuedAt'].every(k=>!(k in member))&&member.online===true&&member.registered===true);

// F) F2b 게이트웨이 스냅샷은 회전 tick에서도 계속 워커 tick 안에서 불린다.
owner='rot-gateway';
sql.prepare('INSERT INTO settings(owner,secret,model,updated_at) VALUES(?,?,?,?)').run(owner,await server.encrypt(JSON.stringify({provider:'hermes',endpoint:OPS,key:'mock-only-key'})),'HERMES',new Date().toISOString());
token=await worker.registerWorker(owner);
await setCredential(owner,{expiresAt:new Date(Date.now()+DAY).toISOString()});
r=await tick(owner,token);
check('rotation tick still records the daily gateway snapshot',r.status===200&&hex64.test(r.data.rotation?.token||'')&&rows(owner,'gateway_snapshot').length===1&&gatewayCalls.length===3);
check('promotion tick keeps the once-a-day snapshot rule',(await tick(owner,r.data.rotation?.token||'f'.repeat(64))).status===200&&rows(owner,'gateway_snapshot').length===1&&gatewayCalls.length===3);
const source=readFileSync('lib/research-worker.ts','utf8'),tickBody=source.slice(source.indexOf('export async function workerTick'));
check('workerTick source still calls the F2b snapshot',tickBody.includes('await recordGatewaySnapshotSafely(owner)'));
check('no external network call',external.length===0);

const failed=outcomes.filter(x=>!x.passed);
process.stdout.write(JSON.stringify({passed:outcomes.length-failed.length,failed:failed.length})+'\n');
process.exitCode=failed.length?1:0;
