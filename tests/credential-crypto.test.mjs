// 자격증명 암호화 키 버전·AAD·회전(security-ops-6, PR 4b 잔여).
// 옛 형식(iv.data) 읽기 회귀, 스위치 crypto_v1_write(기본 꺼짐)일 때만 v1 쓰기·지연 재암호화, AGENCY_ENCRYPTION_KEYS 이전 키 읽기,
// 다른 레코드로 옮긴 v1 암호문 거부(AAD), 키 없음·잘못된 키 409, 키 형식 오류 503, 대표 전용 전체 재암호화(건수만)를 확인한다.
// 근거: mocked(메모리 SQLite, 로컬 인증 헤더·세션 주입, HERMES fetch 스텁). 암호화는 실제 WebCrypto(AES-GCM)다. 외부 네트워크 호출은 0회다.
import assert from 'node:assert/strict';
import {createHash,webcrypto} from 'node:crypto';
import {testRuntime} from './helpers/runtime.mjs';

const HERMES='https://hermes.example.com';
const capabilities={object:'hermes.api_server.capabilities',platform:'hermes-agent',features:{run_submission:true,run_status:true,run_stop:true,runs_idempotency:{durable:true,enabled:true,supported:true}}};
const {sql,env,load}=testRuntime(async(url,init={})=>{
 const u=String(url),auth=new Headers(init.headers||{}).get('authorization');
 if(u===HERMES+'/v1/capabilities')return auth?Response.json(capabilities):new Response('',{status:401});
 if(u===HERMES+'/v1/models')return Response.json({data:[{id:'stub-model'}]});
 throw new Error('외부 호출 금지: '+u);
},{beforeRun:s=>{if(failReseal&&/^UPDATE records SET data=\?/.test(s.query))throw new Error('d1 write failed')}});
let failReseal=false;
const server=await load('lib/server.ts'),sealing=await load('lib/credential-crypto-server.ts'),flags=await load('lib/feature-flags.ts');
const channels=await load('lib/channel-credentials.ts'),action=await load('app/api/action/route.ts'),workspace=await load('app/api/workspace/route.ts');
const passed=[];const check=(name,value)=>{assert.ok(value,name);passed.push(name)};
const rejects=async(name,fn,test)=>{let error=null;try{await fn()}catch(e){error=e}assert.ok(error&&test(error),name+(error?' · '+error.status+' '+error.message:' · no error'));passed.push(name)};

// 옛 코드(이 PR 이전 lib/server.ts encrypt/decrypt)를 그대로 옮긴 기준 구현. 롤백한 코드가 읽을 수 있는지 이것으로 본다.
const bytes=s=>Buffer.from(s,'base64'),b64=b=>Buffer.from(b).toString('base64');
const aes=k=>webcrypto.subtle.importKey('raw',bytes(k),{name:'AES-GCM'},false,['encrypt','decrypt']);
const oldEncrypt=async(k,value)=>{const iv=webcrypto.getRandomValues(new Uint8Array(12));return b64(iv)+'.'+b64(new Uint8Array(await webcrypto.subtle.encrypt({name:'AES-GCM',iv},await aes(k),new TextEncoder().encode(value))))};
const oldDecrypt=async(k,value)=>{const [iv,data]=value.split('.');return new TextDecoder().decode(await webcrypto.subtle.decrypt({name:'AES-GCM',iv:bytes(iv)},await aes(k),bytes(data)))};

const K_OLD=env.AGENCY_ENCRYPTION_KEY,K_NEW=Buffer.alloc(32,9).toString('base64'),K_OTHER=Buffer.alloc(32,3).toString('base64');
const LEGACY=/^[A-Za-z0-9+/=]+\.[A-Za-z0-9+/=]+$/,V1=/^v1:[0-9a-f]{12}:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/;
const kid=v=>v.split(':')[1];
// 두 번째 인자를 생략하면 AGENCY_ENCRYPTION_KEY는 기본 키, undefined를 넘기면 지운다.
const keys=(list,...rest)=>{const legacy=rest.length?rest[0]:K_OLD;if(list===undefined)delete env.AGENCY_ENCRYPTION_KEYS;else env.AGENCY_ENCRYPTION_KEYS=list;if(legacy===undefined)delete env.AGENCY_ENCRYPTION_KEY;else env.AGENCY_ENCRYPTION_KEY=legacy};
const by={id:'crypto-owner',email:null};
const setV1=(owner,enabled)=>flags.setFeatureFlag(owner,{flag:'crypto_v1_write',enabled},by);
const now=new Date().toISOString();
const row=(owner,kind,id)=>sql.prepare('SELECT data,updated_at FROM records WHERE id=?').get(`${owner}:${kind}:${id}`);
const secretOf=(owner,kind,id)=>JSON.parse(row(owner,kind,id).data).secret;
const putRecord=(owner,kind,id,data)=>sql.prepare('INSERT INTO records(id,owner,kind,parent_id,data,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').run(`${owner}:${kind}:${id}`,owner,kind,'',JSON.stringify(data),now);
const instagram=secret=>({channel:'instagram',secret,account:'가상 계정',createdAt:now,updatedAt:now});
const CRED=JSON.stringify({accessToken:'synthetic-channel-token',accountId:'1784'});
const unreadable=e=>e instanceof server.ApiError&&e.status===409&&e.message.includes('다시 등록');

// ════ 1) 스위치 꺼짐(기본): 옛 형식 읽기 회귀 0, 쓰기는 옛 형식·AGENCY_ENCRYPTION_KEY ════
const A='crypto-a';
check('crypto_v1_write is a known switch, off by default, registered last',flags.FEATURE_FLAGS.crypto_v1_write?.defaultEnabled===false&&Object.keys(flags.FEATURE_FLAGS).at(-1)==='crypto_v1_write'&&await flags.isEnabled(A,'crypto_v1_write')===false&&/롤백/.test(flags.FEATURE_FLAGS.crypto_v1_write.description));
const legacySecret=await oldEncrypt(K_OLD,'legacy-plain-value');
check('a ciphertext written by the old code reads back unchanged',await server.decrypt(legacySecret)==='legacy-plain-value');
check('an AAD passed for an old-format ciphertext is ignored (old ciphertexts have none)',await server.decrypt(legacySecret,'crypto-a:settings:connection')==='legacy-plain-value');
const written=await server.encrypt('written-now');
check('switch off writes the old iv.data format that the old code reads',LEGACY.test(written)&&await oldDecrypt(K_OLD,written)==='written-now');
sql.prepare('INSERT INTO settings(owner,secret,model,updated_at) VALUES(?,?,?,?)').run(A,await oldEncrypt(K_OLD,JSON.stringify({provider:'hermes',endpoint:HERMES,key:'mock-only'})),'HERMES',now);
check('an old-format HERMES connection still resolves',(await server.connection(A)).endpoint===HERMES);
putRecord(A,'channel_credential','instagram',instagram(await oldEncrypt(K_OLD,CRED)));
const beforeRead=row(A,'channel_credential','instagram');
check('an old-format channel credential still loads',(await channels.loadCredential(A,'instagram')).credential.accessToken==='synthetic-channel-token');
check('switch off never re-encrypts on read (the row is byte-identical)',JSON.stringify(row(A,'channel_credential','instagram'))===JSON.stringify(beforeRead));
const sealedOff=await sealing.sealRecordSecret(A,'publisher_credential','oda','buffer-token');
check('switch off: record secrets are written in the old format',LEGACY.test(sealedOff)&&await oldDecrypt(K_OLD,sealedOff)==='buffer-token');
keys(`${K_NEW},${K_OLD}`);
const offWithRing=await server.encrypt('ring-but-off');
check('switch off with AGENCY_ENCRYPTION_KEYS set still writes with AGENCY_ENCRYPTION_KEY (rollback-safe)',LEGACY.test(offWithRing)&&await oldDecrypt(K_OLD,offWithRing)==='ring-but-off');
keys(undefined);

// ════ 2) 스위치 켜짐: v1 쓰기·읽기 왕복, 옛 형식 지연 재암호화 ════
await setV1(A,true);
const v1=await sealing.sealRecordSecret(A,'publisher_credential','oda','buffer-token');
check('switch on writes v1:<kid>:<iv>:<data>',V1.test(v1));
check('a v1 ciphertext round-trips with its record AAD',await sealing.openRecordSecret(A,'publisher_credential','oda',v1)==='buffer-token');
await rejects('the old code cannot read v1 (documented rollback caveat)',()=>oldDecrypt(K_OLD,v1),()=>true);
putRecord(A,'publisher_credential','oda',{secret:v1,channelId:'channel-1',account:'가상',version:3});
const v1Kid=kid(v1);
const legacyRow=row(A,'channel_credential','instagram');
check('switch on: an old-format credential reads',(await channels.loadCredential(A,'instagram')).credential.accessToken==='synthetic-channel-token');
const resealed=secretOf(A,'channel_credential','instagram'),afterRow=row(A,'channel_credential','instagram');
check('switch on: reading an old-format credential re-encrypts it with the current key and AAD',V1.test(resealed)&&kid(resealed)===v1Kid);
check('lazy re-encryption changes only the secret (other fields and updated_at kept)',(()=>{const a=JSON.parse(legacyRow.data),b=JSON.parse(afterRow.data);return JSON.stringify({...a,secret:''})===JSON.stringify({...b,secret:''})&&afterRow.updated_at===legacyRow.updated_at})());
check('the re-encrypted credential reads again',(await channels.loadCredential(A,'instagram')).credential.accessToken==='synthetic-channel-token');
const saved=await server.encrypt('x',{aad:'crypto-a:settings:connection'});
check('settings AAD helper matches the owner-scoped settings id',V1.test(saved)&&await server.decrypt(saved,'crypto-a:settings:connection')==='x');

// ════ 3) 회전: 이전 키로 쓴 v1을 AGENCY_ENCRYPTION_KEYS 두 번째 키로 읽고, 켜짐이면 현재 키로 다시 쓴다 ════
const B='crypto-b';
keys(`${K_NEW},${K_OLD}`);
const newKid=kid(await server.encrypt('probe',{aad:'p'}));
check('the first AGENCY_ENCRYPTION_KEYS key is the current key (new kid differs)',newKid!==v1Kid);
check('a v1 ciphertext from the previous key reads through the second key',await sealing.openRecordSecret(A,'publisher_credential','oda',secretOf(A,'publisher_credential','oda'))==='buffer-token');
const rotated=secretOf(A,'publisher_credential','oda');
check('switch on: the previous-key ciphertext is re-encrypted with the current key',V1.test(rotated)&&kid(rotated)===newKid);
check('the re-encrypted publisher credential keeps its version (approval CAS untouched)',JSON.parse(row(A,'publisher_credential','oda').data).version===3);
putRecord(B,'publisher_credential','oda',{secret:await (async()=>{keys(undefined);await setV1(B,true);const s=await sealing.sealRecordSecret(B,'publisher_credential','oda','b-token');await setV1(B,false);keys(`${K_NEW},${K_OLD}`);return s})(),channelId:'channel-1',account:'가상',version:1});
const bBefore=secretOf(B,'publisher_credential','oda');
check('switch off: a previous-key v1 still reads through the ring',await sealing.openRecordSecret(B,'publisher_credential','oda',bBefore)==='b-token');
check('switch off: nothing is re-encrypted',secretOf(B,'publisher_credential','oda')===bBefore&&kid(bBefore)===v1Kid);
check('an old-format ciphertext reads through AGENCY_ENCRYPTION_KEY while KEYS lists a new current key',await server.decrypt(legacySecret)==='legacy-plain-value');

// 다시 쓰기 실패는 읽기를 막지 않고, 로그에는 고정 코드와 kind만 남는다.
const logs=[];const originalError=console.error;console.error=(...args)=>logs.push(args.map(String).join(' '));
putRecord(A,'channel_credential','naver_searchad',{channel:'naver_searchad',secret:await oldEncrypt(K_OLD,'{"apiKey":"k","secretKey":"s","customerId":"1"}'),account:'가상',createdAt:now,updatedAt:now});
failReseal=true;
let failedRead;try{failedRead=await sealing.openRecordSecret(A,'channel_credential','naver_searchad',secretOf(A,'channel_credential','naver_searchad'))}finally{failReseal=false;console.error=originalError}
check('a failed re-encryption still returns the plaintext',JSON.parse(failedRead).apiKey==='k');
check('the failure log carries only a fixed code and the kind (no value, key or ciphertext)',logs.length===1&&logs[0]==='credential_reseal_failed channel_credential');

// ════ 4) AAD: 다른 레코드·다른 소유자로 옮긴 v1 암호문은 풀지 않는다 ════
putRecord(A,'publisher_credential','other-brand',{secret:rotated,channelId:'channel-1',account:'가상',version:1});
await rejects('a v1 publisher secret copied to another brand is refused (409)',()=>sealing.openRecordSecret(A,'publisher_credential','other-brand',rotated),unreadable);
await rejects('a v1 publisher secret copied to another owner is refused (409)',()=>sealing.openRecordSecret(B,'publisher_credential','oda',rotated),unreadable);
await rejects('a v1 channel secret read as another kind is refused (409)',()=>sealing.openRecordSecret(A,'channel_credential','oda',rotated),unreadable);
await server.seedBrands(A);
putRecord(A,'channel_credential','instagram:oda',{...instagram(secretOf(A,'channel_credential','instagram')),brandId:'oda'});
await rejects('a workspace channel credential copied to a brand-level record is refused on load (409)',()=>channels.loadCredential(A,'instagram',{brandId:'oda'}),unreadable);
await rejects('a v1 settings secret does not open as a record secret',()=>server.decrypt(saved,'crypto-a:settings:other'),unreadable);

// ════ 5) 키 없음·잘못된 키 → 409(500 아님), 키 설정 형식 오류 → 503 명확한 문구 ════
keys(K_NEW,undefined);
await rejects('after removing the previous key a v1 ciphertext with its kid is 409, not 500',()=>server.decrypt(bBefore),unreadable);
await rejects('after removing AGENCY_ENCRYPTION_KEY an old-format ciphertext is 409',()=>server.decrypt(legacySecret),unreadable);
keys(undefined,K_OTHER);
let caught;try{await server.decrypt(legacySecret)}catch(e){caught=e}
const rendered=server.failure(caught);
check('a wrong key renders as a 409 JSON error, not the generic 500',rendered.status===409&&(await rendered.json()).error.includes('다시 등록'));
await rejects('a malformed stored ciphertext is 409',()=>server.decrypt('v1:zz:%%%:%%%'),unreadable);
keys(undefined,undefined);
await rejects('no key configured keeps the existing 503',()=>server.encrypt('x'),e=>e.status===503&&e.message.includes('준비 중'));
const badValue='not-base64!!';
keys(badValue,K_OLD);
await rejects('a malformed AGENCY_ENCRYPTION_KEYS entry is a clear 503 without the value',()=>server.encrypt('x'),e=>e.status===503&&e.message.includes('AGENCY_ENCRYPTION_KEYS 1번째')&&!e.message.includes(badValue));
keys(`${K_NEW},${Buffer.alloc(16,1).toString('base64')}`,K_OLD);
await rejects('a 16-byte entry in AGENCY_ENCRYPTION_KEYS is refused (2nd entry named)',()=>server.decrypt(legacySecret),e=>e.status===503&&e.message.includes('AGENCY_ENCRYPTION_KEYS 2번째')&&e.message.includes('32바이트'));
keys(undefined,'%%%');
await rejects('a malformed AGENCY_ENCRYPTION_KEY is a clear 503',()=>server.encrypt('x'),e=>e.status===503&&e.message.includes('AGENCY_ENCRYPTION_KEY ')&&!e.message.includes('%%%'));
keys(undefined);

// 연결을 풀 수 없어도 작업 공간은 열리고(다시 등록 안내), HERMES를 다시 등록할 수 있다.
const C='crypto-c',headers={'oai-authenticated-user-id':C,origin:'https://agency.test','content-type':'application/json'};
sql.prepare('INSERT INTO settings(owner,secret,model,updated_at) VALUES(?,?,?,?)').run(C,await oldEncrypt(K_OTHER,JSON.stringify({provider:'hermes',endpoint:HERMES,key:'lost'})),'HERMES',now);
const ws=await workspace.GET(new Request('https://agency.test/api/workspace',{headers}));
const wsBody=await ws.json();
check('an unreadable connection does not break the workspace (200, reconnect flag)',ws.status===200&&wsBody.connection.configured===true&&wsBody.connection.unreadable===true&&wsBody.connection.endpoint==='');
const post=(input,h=headers)=>action.POST(new Request('https://agency.test/api/action',{method:'POST',headers:h,body:JSON.stringify(input)})).then(async r=>({status:r.status,body:await r.json(),text:''}));
const reRegister=await post({action:'save_hermes',endpoint:HERMES,key:'a-fresh-hermes-key-of-enough-length'});
check('HERMES can be registered again over an unreadable connection',reRegister.status===200&&(await server.connection(C)).key==='a-fresh-hermes-key-of-enough-length');
check('switch off: the re-registered settings secret is old format',LEGACY.test(sql.prepare('SELECT secret FROM settings WHERE owner=?').get(C).secret));
await setV1(C,true);
await post({action:'save_hermes',endpoint:HERMES,key:'a-fresh-hermes-key-of-enough-length'});
const cSecret=sql.prepare('SELECT secret FROM settings WHERE owner=?').get(C).secret;
check('switch on: save_hermes writes v1 bound to the settings AAD',V1.test(cSecret)&&(await server.connection(C)).provider==='hermes'&&await server.decrypt(cSecret,`${C}:settings:connection`).then(()=>true));
await rejects('the v1 settings secret copied to another owner is refused',async()=>{sql.prepare('INSERT INTO settings(owner,secret,model,updated_at) VALUES(?,?,?,?)').run('crypto-d',cSecret,'HERMES',now);return server.connection('crypto-d')},unreadable);

// ════ 6) 대표 전용 전체 재암호화: 스위치 켜짐일 때만, 건수·종류만 ════
const D='crypto-e',dh={'oai-authenticated-user-id':D,origin:'https://agency.test','content-type':'application/json'};
sql.prepare('INSERT INTO settings(owner,secret,model,updated_at) VALUES(?,?,?,?)').run(D,await oldEncrypt(K_OLD,'sk-legacy-openai-key'),'gpt-test',now);
putRecord(D,'channel_credential','instagram',instagram(await oldEncrypt(K_OLD,CRED)));
putRecord(D,'publisher_credential','oda',{secret:await oldEncrypt(K_OLD,'buffer-d'),channelId:'c',account:'가상',version:1});
keys(undefined);await setV1(D,true);
const moved=await sealing.sealRecordSecret(D,'publisher_credential','oda','moved-token');
putRecord(D,'publisher_credential','other',{secret:moved,channelId:'c',account:'가상',version:1});
await setV1(D,false);
keys(`${K_NEW},${K_OLD}`);
let r=await post({action:'reseal_credentials'},dh);
check('re-encrypt-all is 409 while the switch is off and changes nothing',r.status===409&&r.body.error.includes('crypto_v1_write')&&LEGACY.test(secretOf(D,'publisher_credential','oda')));
await setV1(D,true);
r=await post({action:'reseal_credentials'},dh);
check('re-encrypt-all re-encrypts every readable credential and counts the unreadable one by kind and reason',r.status===200&&r.body.resealed===3&&r.body.current===0&&r.body.failed.publisher_credential===1&&r.body.failed.settings===0&&r.body.failed.channel_credential===0&&r.body.reasons.mismatch===1);
check('the summary carries counts only (no plaintext, ciphertext or key)',(()=>{const t=JSON.stringify(r.body);return !/sk-legacy|buffer-d|moved-token|synthetic-channel|v1:|[A-Za-z0-9+/]{20,}/.test(t)&&!t.includes(K_NEW)&&!t.includes(K_OLD)})());
check('every readable credential now carries the current kid',[secretOf(D,'channel_credential','instagram'),secretOf(D,'publisher_credential','oda'),sql.prepare('SELECT secret FROM settings WHERE owner=?').get(D).secret].every(s=>V1.test(s)&&kid(s)===newKid));
check('the owner connection still resolves after re-encryption',(await server.connection(D)).key==='sk-legacy-openai-key');
r=await post({action:'reseal_credentials'},dh);
check('a second run finds everything current',r.status===200&&r.body.resealed===0&&r.body.current===3&&r.body.failed.publisher_credential===1);
keys(K_NEW,undefined);
check('after re-encryption the previous key can be removed for these kinds',(await server.connection(D)).key==='sk-legacy-openai-key'&&(await channels.loadCredential(D,'instagram')).credential.accountId==='1784');
keys(undefined);

// 이메일 모드: 대표만. 관리자·직원 403, 다른 출처 403.
keys(`${K_NEW},${K_OLD}`);env.AUTH_MODE='email';env.AUTH_ORIGIN='https://agency.test';
const signIn=(id,role,createdAt)=>{const token=createHash('sha256').update(id).digest('hex');sql.prepare('INSERT INTO auth_users(id,email,workspace_owner,role,status,created_at) VALUES(?,?,?,?,?,?)').run(id,id+'@test.invalid',D,role,'active',createdAt);sql.prepare('INSERT INTO auth_sessions VALUES(?,?,?,?)').run(createHash('sha256').update(token).digest('hex'),id,Date.now()+60000,Date.now());return {cookie:'__Host-collective_session='+token,origin:'https://agency.test','content-type':'application/json'}};
const ownerS=signIn('e-owner','admin',1000),adminS=signIn('e-admin','admin',2000),memberS=signIn('e-member','member',500);
const [adminR,memberR,crossR,ownerR]=[await post({action:'reseal_credentials'},adminS),await post({action:'reseal_credentials'},memberS),await post({action:'reseal_credentials'},{...ownerS,origin:'https://evil.test'}),await post({action:'reseal_credentials'},ownerS)];
check('re-encrypt-all is owner-only (admin and member 403, cross-origin 403)',adminR.status===403&&memberR.status===403&&crossR.status===403);
check('the workspace owner runs re-encrypt-all',ownerR.status===200&&ownerR.body.current===3);

console.log(JSON.stringify({passed:passed.length,checks:passed},null,2));
