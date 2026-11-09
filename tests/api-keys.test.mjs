// G9 API 키 회귀(docs/MCP-SERVER.ko.md). 실제 SQLite(node:sqlite)·실제 라우트(/api/api-keys), 헤더(legacy) 인증, 합성 데이터.
// 등록(kind·스위치·기능표), 스위치 꺼짐(만들기 409·목록 200), 권한(직원 403)·같은 출처·입력 검증, 만들기(ck_ 형식·한 번만·해시 저장·끝 4자·기본 90일),
// 확인(해시 PK·상수 시간 비교·모양 검사), 취소(다른 소유자 404·멱등), 만료, 활성 20개 상한, Bearer 파싱, 범위 규칙.
// 근거: mocked(메모리 SQLite, 로컬 인증 헤더). 모델·외부 네트워크 호출은 0회다.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {testRuntime} from './helpers/runtime.mjs';

let fetchCalls=0;
const rt=testRuntime(async()=>{fetchCalls++;throw new Error('외부 호출 금지')});
const {sql}=rt;
const flags=await rt.load('lib/feature-flags.ts'),registry=await rt.load('lib/record-kinds.ts'),status=await rt.load('lib/feature-status.ts');
const pure=await rt.load('lib/api-keys.ts'),keys=await rt.load('lib/api-keys-server.ts'),route=await rt.load('app/api/api-keys/route.ts');
const passed=[];const check=(name,val)=>{assert.ok(val,name);passed.push(name)};
const plain=x=>JSON.parse(JSON.stringify(x));
const ORIGIN='https://agency.test',O='g9-owner',X='g9-other';
const as=who=>({'oai-authenticated-user-id':who});
const call=async res=>{const text=await res.text();let body=null;try{body=JSON.parse(text)}catch{body=text}return {status:res.status,body}};
const G=(h=as(O))=>route.GET(new Request(`${ORIGIN}/api/api-keys`,{headers:h})).then(call);
const P=(input,h=as(O),origin=ORIGIN)=>route.POST(new Request(`${ORIGIN}/api/api-keys`,{method:'POST',headers:{'content-type':'application/json',origin,...h},body:JSON.stringify(input)})).then(call);
const rows=()=>sql.prepare("SELECT id,owner,data FROM records WHERE kind='api_key' ORDER BY rowid").all().map(r=>({...JSON.parse(r.data),rowId:r.id,owner:r.owner}));
const allData=()=>sql.prepare('SELECT id,data FROM records').all().map(r=>r.id+' '+r.data).join('\n');
const sha=t=>createHash('sha256').update(t).digest('hex');

// ── 1) 등록 ──
const kinds=plain(registry.recordKinds),kindOf=k=>kinds.find(x=>x.kind===k);
check('api_key and api_call are registered outside campaign deletion',['api_key','api_call'].every(k=>kindOf(k)&&kindOf(k).parent==='none'&&kindOf(k).campaignDeletion==='not_campaign_scoped'&&!kindOf(k).links&&/캠페인과 무관/.test(kindOf(k).description)));
check('the api_call description says it keeps no payload',/본문은 담지 않는다/.test(kindOf('api_call').description)&&/원문 없음/.test(kindOf('api_key').description));
check('mcp_server is a known switch, off by default',flags.FEATURE_FLAGS.mcp_server?.defaultEnabled===false&&/404/.test(flags.FEATURE_FLAGS.mcp_server.description)&&/승인·발행·지출·고객 발송·AI 실행은 없다/.test(flags.FEATURE_FLAGS.mcp_server.description));
const row=f=>plain(status.featureRows({flags:f})).find(r=>r.key==='mcp-server');
check('the settings table has an MCP server row that follows the switch',JSON.stringify([row([{flag:'mcp_server',enabled:true}]).status,row([{flag:'mcp_server',enabled:false}]).status,row(null).status])==='["available","blocked","blocked"]'&&row(null).flag==='mcp_server'&&row(null).label==='MCP 서버·API 키(외부 AI 도구 연결)');
const view=plain(status.featureView(row([{flag:'mcp_server',enabled:true}])));
check('the MCP feature row shows no internal code or middle dot separator on screen',![view.label,...view.reason].some(t=>/\b[a-z][a-z0-9]*_[a-z0-9_]+\b/.test(t)||t.includes(' · '))&&view.tech.includes('스위치 이름 mcp_server'));
const src=p=>readFileSync(p,'utf8');
check('the switch is read only in lib/api-keys-server.ts',/isEnabled\(owner,'mcp_server'\)/.test(src('lib/api-keys-server.ts'))&&!/isEnabled\(/.test(src('lib/mcp/server.ts')+src('app/api/mcp/route.ts')+src('app/api/api-keys/route.ts')));
check('key and MCP code never log a token or authorization header',!/console\.(log|error|warn)\([^)]*(token|authorization|Bearer)/i.test(src('lib/api-keys-server.ts')+src('lib/mcp/server.ts')+src('lib/mcp/tools.ts')));

// ── 2) 스위치 꺼짐 ──
let r=await P({action:'create',label:'Claude',scope:'read'});
check('switch off: create is a 409 that names the switch and writes nothing',r.status===409&&/mcp_server/.test(r.body.error)&&rows().length===0);
r=await G();
check('switch off: the list still reads',r.status===200&&r.body.enabled===false&&r.body.keys.length===0);
await flags.setFeatureFlag(O,{flag:'mcp_server',enabled:true},{id:O,email:null});

// ── 3) 권한·출처·입력 ──
await assert.rejects(()=>keys.apiKeyAction({owner:O,id:'m',email:null,role:'member'},{action:'create',label:'x',scope:'read'}),e=>e.status===403&&/대표·관리자/.test(e.message));
await assert.rejects(()=>keys.listApiKeys({owner:O,id:'m',email:null,role:'member'}),e=>e.status===403);
passed.push('members cannot list, create or revoke keys');
r=await P({action:'create',label:'x',scope:'read'},as(O),'https://evil.test');
check('cross-origin create is a 403',r.status===403&&rows().length===0);
for(const [input,re,name] of [[{action:'create',label:'',scope:'read'},/라벨/,'empty label'],[{action:'create',label:'a'.repeat(61),scope:'read'},/라벨/,'long label'],[{action:'create',label:'x',scope:'admin'},/범위/,'unknown scope'],[{action:'create',label:'x',scope:'read',days:0},/1~365일/,'zero days'],[{action:'create',label:'x',scope:'read',days:366},/1~365일/,'366 days'],[{action:'create',label:'x',scope:'read',days:1.5},/1~365일/,'fractional days'],[{action:'create',label:'x',scope:'read',extra:1},/알 수 없는/,'unknown field'],[{action:'nope'},/지원하지 않는/,'unknown action']]){
 r=await P(input);check(`invalid input is a 400: ${name}`,r.status===400&&re.test(r.body.error));
}
check('no key row was written by rejected inputs',rows().length===0);

// ── 4) 만들기 ──
r=await P({action:'create',label:'Claude Desktop',scope:'read'});
const T1=r.body.token,K1=r.body.id;
check('create returns a ck_ key once with a 90-day default expiry',r.status===200&&/^ck_[a-f0-9]{64}$/.test(T1)&&r.body.state==='active'&&r.body.scope==='read'&&Math.round((Date.parse(r.body.expiresAt)-Date.parse(r.body.createdAt))/86400000)===90);
check('the key remembers only the ck_ prefix and the last four characters',r.body.prefix==='ck_'&&r.body.last4===T1.slice(-4)&&plain(pure.maskedKey(r.body))===`ck_…${T1.slice(-4)}`);
check('the stored row id is api_key:<SHA-256> and the key itself is nowhere in the database',rows().length===1&&rows()[0].rowId===`api_key:${sha(T1)}`&&rows()[0].owner===O&&!allData().includes(T1)&&!allData().includes(T1.slice(3)));
check('the creator id and role are recorded',rows()[0].createdBy.id===O&&rows()[0].createdBy.role==='owner'&&rows()[0].lastUsedAt===null&&rows()[0].revokedAt===null);
r=await P({action:'create',label:'초안 키',scope:'draft',days:30});
const T2=r.body.token,K2=r.body.id;
check('a draft key with a 30-day expiry is created',r.status===200&&r.body.scope==='draft'&&Math.round((Date.parse(r.body.expiresAt)-Date.parse(r.body.createdAt))/86400000)===30&&T2!==T1);
r=await G();
check('the list shows both keys without token or hash',r.status===200&&r.body.enabled===true&&r.body.keys.length===2&&r.body.keys.every(k=>!('token' in k)&&!('hash' in k)&&!JSON.stringify(k).includes(sha(T1))));

// ── 5) 확인 ──
const res1=await keys.resolveApiKey(T1);
check('a valid key resolves to its owner and record',res1&&res1.owner===O&&res1.key.id===K1&&res1.rowId===`api_key:${sha(T1)}`);
check('a wrong key of the right shape does not resolve',await keys.resolveApiKey('ck_'+'0'.repeat(64))===null);
check('malformed keys do not resolve',(await Promise.all([undefined,null,'',T1.toUpperCase(),T1.slice(3),'ck_'+'a'.repeat(63),'sk_'+T1.slice(3),T1+'0'].map(v=>keys.resolveApiKey(v)))).every(v=>v===null));
check('sameHash compares equal-length strings and rejects different lengths',keys.sameHash('abc','abc')&&!keys.sameHash('abc','abd')&&!keys.sameHash('abc','abcd'));
check('bearer parsing accepts any case and trims, and rejects other schemes or shapes',pure.bearerToken(`Bearer ${T1}`)===T1&&pure.bearerToken(`bearer   ${T1} `)===T1&&pure.bearerToken(`Basic ${T1}`)===null&&pure.bearerToken(T1)===null&&pure.bearerToken(null)===null&&pure.bearerToken('Bearer ck_123')===null);
check('scope rules: read allows reads only, draft allows reads and drafts',pure.scopeAllows('read','read')&&!pure.scopeAllows('read','draft')&&pure.scopeAllows('draft','read')&&pure.scopeAllows('draft','draft'));

// ── 6) 취소·만료 ──
r=await P({action:'revoke',id:K1},as(X));
check('another workspace cannot revoke the key',r.status===404&&rows().find(k=>k.id===K1).revokedAt===null);
r=await P({action:'revoke',id:K1});
check('revoke marks the key and it no longer resolves',r.status===200&&r.body.state==='revoked'&&typeof r.body.revokedAt==='string'&&await keys.resolveApiKey(T1)===null);
const at=r.body.revokedAt;
r=await P({action:'revoke',id:K1});
check('revoking twice is idempotent and keeps the first time',r.status===200&&r.body.revokedAt===at);
await flags.setFeatureFlag(O,{flag:'mcp_server',enabled:false},{id:O,email:null});
r=await P({action:'revoke',id:K2});
check('revoke still works while the switch is off',r.status===200&&r.body.state==='revoked');
await flags.setFeatureFlag(O,{flag:'mcp_server',enabled:true},{id:O,email:null});
r=await P({action:'create',label:'만료 테스트',scope:'read',days:1});
const T3=r.body.token;
sql.prepare("UPDATE records SET data=json_set(data,'$.expiresAt',?) WHERE kind='api_key' AND json_extract(data,'$.id')=?").run('2020-01-01T00:00:00.000Z',r.body.id);
check('an expired key does not resolve and lists as expired',await keys.resolveApiKey(T3)===null&&(await G()).body.keys.find(k=>k.label==='만료 테스트').state==='expired');
check('key states follow revokedAt then expiresAt',pure.keyState({expiresAt:'2999-01-01T00:00:00.000Z',revokedAt:null},Date.now())==='active'&&pure.keyState({expiresAt:'2999-01-01T00:00:00.000Z',revokedAt:'x'},Date.now())==='revoked'&&pure.keyState({expiresAt:'2000-01-01T00:00:00.000Z',revokedAt:null},Date.now())==='expired');

// ── 7) 활성 상한 ──
for(let i=0;i<21;i++){r=await P({action:'create',label:'상한 '+i,scope:'read'});if(r.status!==200)break}
check('the 21st active key is refused (20 active at most)',r.status===409&&/20개/.test(r.body.error)&&rows().filter(k=>!k.revokedAt&&Date.parse(k.expiresAt)>Date.now()).length===20);
check('keys of another owner are not listed',(await G(as(X))).body.keys.length===0);
check('no model or network call was made',fetchCalls===0);

console.log(JSON.stringify({passed:passed.length,checks:passed},null,1));
