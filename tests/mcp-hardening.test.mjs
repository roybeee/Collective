// G9 MCP 보강 회귀(docs/MCP-SERVER.ko.md 8·10절): 401의 WWW-Authenticate 안내(키 없음·틀린 키), 유효한 키 없는 요청의 IP당 1분 30회 429(CF-Connecting-IP만 신뢰),
// 감사 api_call 90일 보존 정리(멱등)와 워커 하루 정리 단계 연결, 워커가 소재 점수 자동 보정 단계를 스위치 꺼짐에서 건너뜀. 근거: mocked(메모리 SQLite, 로컬 인증 헤더). 외부 호출 0회.
import assert from 'node:assert/strict';
import {testRuntime} from './helpers/runtime.mjs';

let fetchCalls=0;
const rt=testRuntime(async()=>{fetchCalls++;throw new Error('외부 호출 금지')});
const {sql}=rt;
const flags=await rt.load('lib/feature-flags.ts'),keys=await rt.load('lib/api-keys-server.ts'),worker=await rt.load('lib/research-worker.ts');
const mcp=await rt.load('app/api/mcp/route.ts'),keysRoute=await rt.load('app/api/api-keys/route.ts');
const passed=[];const check=(name,val)=>{assert.ok(val,name);passed.push(name)};
const ORIGIN='https://agency.test',O='g9-hard-owner';
const parse=async res=>{const text=await res.text();let body=null;try{body=text?JSON.parse(text):null}catch{body=text}return {status:res.status,body,headers:res.headers}};
const rpc=(headers={})=>mcp.POST(new Request(`${ORIGIN}/api/mcp`,{method:'POST',headers:{'content-type':'application/json',...headers},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'ping'})})).then(parse);
await flags.setFeatureFlag(O,{flag:'mcp_server',enabled:true},{id:O,email:null});
const created=await keysRoute.POST(new Request(`${ORIGIN}/api/api-keys`,{method:'POST',headers:{'content-type':'application/json',origin:ORIGIN,'oai-authenticated-user-id':O},body:JSON.stringify({action:'create',label:'읽기',scope:'read'})})).then(parse);
const KEY=created.body.token;
check('a read key was created',/^ck_[a-f0-9]{64}$/.test(KEY));

// ── 1) WWW-Authenticate ──
const none=await rpc({'cf-connecting-ip':'198.51.100.1'}),bad=await rpc({'cf-connecting-ip':'198.51.100.1',authorization:'Bearer ck_'+'0'.repeat(64)});
const noneHeader=none.headers.get('www-authenticate')??'',badHeader=bad.headers.get('www-authenticate')??'';
check('no key is a 401 whose challenge names the realm and how to get a key, without an error code',none.status===401&&/^Bearer realm="collective"/.test(noneHeader)&&/error_description="API key required\./.test(noneHeader)&&!/error="/.test(noneHeader)&&/OAuth is not supported/.test(noneHeader));
check('a wrong key is a 401 with error="invalid_token"',bad.status===401&&/error="invalid_token"/.test(badHeader)&&/COLLECTIVE settings/.test(badHeader));
check('the challenge header is plain ASCII (no Korean in a header value)',/^[\x20-\x7e]+$/.test(noneHeader)&&/^[\x20-\x7e]+$/.test(badHeader));
check('the JSON-RPC body still carries the Korean message',none.body.error.code===-32001&&/API 키/.test(none.body.error.message));

// ── 2) IP당 빈도 제한(유효한 키 없는 요청) ──
const ip='203.0.113.7';let last;
for(let i=0;i<30;i++)last=await rpc({'cf-connecting-ip':ip,authorization:'Bearer wrong'});
check('30 keyless requests from one address in a minute are each a 401',last.status===401);
const blocked=await rpc({'cf-connecting-ip':ip,authorization:'Bearer wrong'});
check('the 31st keyless request from that address is a 429 with Retry-After',blocked.status===429&&blocked.headers.get('retry-after')==='60'&&blocked.body.error.code===-32029&&/1분에 30회/.test(blocked.body.error.message));
check('another address is not limited',(await rpc({'cf-connecting-ip':'203.0.113.8'})).status===401);
check('a valid key from the limited address still works',(await rpc({'cf-connecting-ip':ip,authorization:'Bearer '+KEY})).status===200);
check('a spoofed X-Forwarded-For does not escape the limit',(await rpc({'cf-connecting-ip':ip,'x-forwarded-for':'192.0.2.99'})).status===429);
const ipv6a=await (async()=>{let r;for(let i=0;i<31;i++)r=await rpc({'cf-connecting-ip':'2001:db8:1:2::'+(i+1).toString(16)});return r})();
check('IPv6 addresses in one /64 share a bucket',ipv6a.status===429);
check('the limit window expires after a minute',await (async()=>{sql.prepare('UPDATE auth_rate_limits SET window_start=window_start-61000').run();return (await rpc({'cf-connecting-ip':ip})).status===401})());
check('no outbound fetch was made',fetchCalls===0);

// ── 3) 감사 보존 정리 ──
const audit=(id,daysAgo)=>sql.prepare('INSERT INTO records(id,owner,kind,parent_id,data,updated_at) VALUES(?,?,?,?,?,?)').run(`${O}:api_call:${id}`,O,'api_call','',JSON.stringify({id,keyId:'k',tool:'list_brands',ok:true,at:new Date(Date.now()-daysAgo*86400000).toISOString()}),new Date(Date.now()-daysAgo*86400000).toISOString());
audit('old1',120);audit('old2',91);audit('edge',89);audit('new',1);
sql.prepare('INSERT INTO records(id,owner,kind,parent_id,data,updated_at) VALUES(?,?,?,?,?,?)').run('other:api_call:x','other','api_call','','{}',new Date(Date.now()-200*86400000).toISOString());
const count=(owner=O)=>sql.prepare("SELECT COUNT(*) n FROM records WHERE owner=? AND kind='api_call'").get(owner).n;
const before=count();
check('purge removes only api_call rows older than 90 days for that owner',await keys.purgeApiCallAudit(O)===2&&count()===before-2&&count('other')===1);
check('a second purge removes nothing (idempotent)',await keys.purgeApiCallAudit(O)===0);
check('the 89-day row is kept',!!sql.prepare("SELECT 1 FROM records WHERE id=?").get(`${O}:api_call:edge`));

// ── 4) 워커 하루 정리 단계 ──
audit('old3',100);
const token=await worker.registerWorker(O),tick=async()=>worker.workerTick({owner:O,hash:await worker.workerHash(token)},async()=>new Response('{}'));
await tick();
check('the daily worker maintenance purges expired api_call rows',!sql.prepare("SELECT 1 FROM records WHERE id=?").get(`${O}:api_call:old3`));
audit('old4',100);await tick();
check('a second tick on the same day does not run maintenance again',!!sql.prepare("SELECT 1 FROM records WHERE id=?").get(`${O}:api_call:old4`));
check('with creative_score off the calibration step writes no run state',sql.prepare("SELECT COUNT(*) n FROM records WHERE owner=? AND kind='creative_calibration_run'").get(O).n===0);

console.log(JSON.stringify({passed:passed.length,checks:passed,sqlite:'real',auth:'mocked',external:0},null,1));
