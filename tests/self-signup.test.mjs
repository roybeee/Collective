// G8 셀프 가입 회귀(docs/SELF-SIGNUP.ko.md). 실제 SQLite·native scrypt, 실제 라우트(/api/auth/signup·/api/auth·/api/workspace), AUTH_MODE=email.
// 스위치 꺼짐 404(초대·로그인 그대로), 플랫폼 스위치(운영자 워크스페이스 값), 입력·동의 검증, 확인 전 로그인 불가, 확인 링크 일회·이메일 결합·만료, 새 빈 워크스페이스(예시 브랜드 없음),
// 기존·초대 이메일 409, 확인 전 재가입(이전 링크 폐기), 요청 제한 429, 동의 기록. 근거: mocked(메모리 SQLite, D1 어댑터). 메일·외부 호출 0회.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {testRuntime} from './helpers/auth-runtime.mjs';

const origin='https://agency.example',password='A secure password 2026!',bootstrap='bootstrap-secret-token-with-at-least-32-characters';
const r=testRuntime(async()=>{throw new Error('외부 호출 금지')});
Object.assign(r.env,{AUTH_MODE:'email',AUTH_ORIGIN:origin,AUTH_BOOTSTRAP_EMAIL:'admin@example.com',AUTH_BOOTSTRAP_OWNER:'old-owner',AUTH_BOOTSTRAP_TOKEN_HASH:createHash('sha256').update(bootstrap).digest('hex')});
const auth=await r.load('app/api/auth/route.ts'),signup=await r.load('app/api/auth/signup/route.ts'),accounts=await r.load('app/api/accounts/route.ts'),workspace=await r.load('app/api/workspace/route.ts');
const flags=await r.load('lib/feature-flags.ts'),session=await r.load('lib/auth-session.ts');
const passed=[];const check=(name,val)=>{assert.ok(val,name);passed.push(name)};
const request=(path,body,cookie,headers={})=>new Request(origin+path,{method:body?'POST':'GET',headers:{origin,'content-type':'application/json','cf-connecting-ip':'203.0.113.7',...(cookie?{cookie}:{}),...headers},...(body?{body:JSON.stringify(body)}:{})});
const read=async res=>({status:res.status,body:await res.json(),cookie:res.headers.get('set-cookie')?.split(';')[0]});
const start=(email,extra={},headers)=>signup.POST(request('/api/auth/signup',{action:'start',email,password,termsAccepted:true,privacyAccepted:true,...extra},null,headers)).then(read);
const verify=(email,token,headers)=>signup.POST(request('/api/auth/signup',{action:'verify',email,token},null,headers)).then(read);
const tokenOf=url=>new URLSearchParams(new URL(url).hash.slice(1)).get('verify');
const enabled=async()=>(await read(await signup.GET())).body.enabled;
const by={id:'op',email:null};

// 1) 스위치 꺼짐
check('no accounts yet: signup is closed (GET enabled false, POST 404)',await enabled()===false&&(await start('new@example.com')).status===404);
const admin=await read(await auth.POST(request('/api/auth',{action:'bootstrap',email:'admin@example.com',password,token:bootstrap})));
check('bootstrap still works (invitation-only path unchanged)',admin.status===200&&!!admin.cookie);
check('flag off after bootstrap: signup is a 404 and writes nothing',await enabled()===false&&(await start('new@example.com')).status===404&&!r.sql.prepare("SELECT 1 FROM auth_users WHERE email='new@example.com'").get());
const invited=await read(await accounts.POST(request('/api/accounts',{action:'invite',email:'member@example.com',role:'member'},admin.cookie)));
check('invite flow unchanged with the switch off',invited.status===200&&/^[a-f0-9]{64}$/.test(invited.body.token));

// 2) 플랫폼 스위치: 운영자 워크스페이스(old-owner) 값만 읽는다
await flags.setFeatureFlag('someone-else',{flag:'self_signup',enabled:true},by);
check('turning the switch on in a non-operator workspace does not open signup',await enabled()===false);
await flags.setFeatureFlag('old-owner',{flag:'self_signup',enabled:true},by);
check('operator switch on: signup is open',await enabled()===true);

// 3) 입력·동의 검증
let x=await start('new@example.com',{termsAccepted:false});
check('terms consent is required',x.status===400&&/필수/.test(x.body.error));
x=await start('new@example.com',{privacyAccepted:undefined});
check('privacy consent is required',x.status===400);
x=await start('new@example.com',{termsAccepted:'yes'});
check('consent must be an explicit boolean true',x.status===400);
x=await start('new@example.com',{marketingOptIn:'yes'});
check('marketing consent must be a boolean when sent',x.status===400);
x=await signup.POST(request('/api/auth/signup',{action:'start',email:'new@example.com',password:'short',termsAccepted:true,privacyAccepted:true})).then(read);
check('the existing password policy applies (12~128)',x.status===400&&/12~128/.test(x.body.error));
x=await signup.POST(request('/api/auth/signup',{action:'start',email:'not-an-email',password,termsAccepted:true,privacyAccepted:true})).then(read);
check('invalid email is a 400',x.status===400);
x=await signup.POST(request('/api/auth/signup',{action:'start',email:'new@example.com',password,termsAccepted:true,privacyAccepted:true},null,{origin:'https://evil.example'})).then(read);
check('foreign origin is a 403',x.status===403);
check('no account was created by rejected requests',!r.sql.prepare("SELECT 1 FROM auth_users WHERE email='new@example.com'").get());

// 위 거절 요청도 요청 제한에 세므로(9절에서 따로 확인) 여기서 창을 비운다.
r.sql.exec('DELETE FROM auth_rate_limits');
// 4) 시작 → 확인 대기
x=await start('New@Example.com');
const user=r.sql.prepare("SELECT * FROM auth_users WHERE email='new@example.com'").get();
check('start creates a pending admin whose workspace is its own id, and returns a 24h display link',x.status===200&&x.body.delivery==='display'&&x.body.verifyUrl.startsWith(origin+'/#verify=')&&user.status==='pending'&&user.role==='admin'&&user.workspace_owner===user.id&&/^scrypt\$/.test(user.password_hash));
const firstToken=tokenOf(x.body.verifyUrl);
const tokenRow=r.sql.prepare('SELECT * FROM auth_tokens WHERE user_id=?').get(user.id);
check('the verification token is stored only as a hash with kind verify and a 24h expiry',tokenRow.kind==='verify'&&tokenRow.token_hash!==firstToken&&tokenRow.token_hash===createHash('sha256').update(firstToken).digest('hex')&&Math.abs(tokenRow.expires_at-tokenRow.created_at-86400000)<5);
const consent=JSON.parse(r.sql.prepare("SELECT data FROM records WHERE owner=? AND kind='signup_consent'").get(user.id).data);
check('consents are recorded with versions; marketing defaults to false',consent.marketingOptIn===false&&/draft/.test(consent.termsVersion)&&!!consent.consentedAt&&!JSON.stringify(consent).includes(password));
check('pending accounts cannot log in',(await auth.POST(request('/api/auth',{action:'login',email:'new@example.com',password}))).status===401);
check('the verify token cannot be used as an invite acceptance',(await auth.POST(request('/api/auth',{action:'accept',email:'new@example.com',password,token:firstToken}))).status===401);

// 5) 확인 전 재가입: 새 링크, 이전 링크 폐기
x=await start('new@example.com',{marketingOptIn:true});
const secondToken=tokenOf(x.body.verifyUrl);
check('restarting before verification issues a new link and keeps one account',x.status===200&&secondToken!==firstToken&&r.sql.prepare("SELECT COUNT(*) n FROM auth_users WHERE email='new@example.com'").get().n===1&&JSON.parse(r.sql.prepare("SELECT data FROM records WHERE owner=? AND kind='signup_consent'").get(user.id).data).marketingOptIn===true);
check('the earlier link is revoked',(await verify('new@example.com',firstToken)).status===401);

// 6) 확인
check('a link bound to another email fails',(await verify('other@example.com',secondToken)).status===401);
check('a malformed token fails',(await verify('new@example.com','abc')).status===401);
const done=await verify('new@example.com',secondToken);
check('verify activates the account and signs in as the workspace owner',done.status===200&&done.body.user.role==='owner'&&!!done.cookie&&r.sql.prepare('SELECT status FROM auth_users WHERE id=?').get(user.id).status==='active');
const principal=await session.authPrincipal(request('/',null,done.cookie));
check('the session belongs to the new workspace, not the operator',principal.owner===user.id&&principal.owner!=='old-owner');
check('the link is single use',(await verify('new@example.com',secondToken)).status===401);
const ws=await read(await workspace.GET(request('/api/workspace',null,done.cookie)));
check('the new workspace is empty: no sample brands or campaigns',ws.status===200&&ws.body.brands.length===0&&ws.body.campaigns.length===0);
const adminWs=await read(await workspace.GET(request('/api/workspace',null,admin.cookie)));
check('the operator workspace still gets its sample brands',adminWs.body.brands.length>0);
check('password login works after verification',(await auth.POST(request('/api/auth',{action:'login',email:'new@example.com',password}))).status===200);
check('the new owner cannot see the operator accounts',(await read(await accounts.GET(request('/api/accounts',null,done.cookie)))).body.accounts.every(a=>a.email==='new@example.com'));

// 7) 기존·초대 이메일
check('an existing active account email is a 409',(await start('admin@example.com')).status===409);
check('an invited pending email is a 409 (the invite stays usable)',(await start('member@example.com')).status===409&&(await auth.POST(request('/api/auth',{action:'accept',email:'member@example.com',password,token:invited.body.token}))).status===200);
check('the verified account email is a 409',(await start('new@example.com')).status===409);

// 8) 만료
x=await start('late@example.com');
r.sql.exec("UPDATE auth_tokens SET expires_at=0 WHERE email='late@example.com'");
check('an expired link fails',(await verify('late@example.com',tokenOf(x.body.verifyUrl))).status===401);

// 9) 요청 제한(이메일+IP 10회/15분)
const limited=[];for(let i=0;i<11;i++)limited.push((await start('spam@example.com',{termsAccepted:false},{'cf-connecting-ip':'198.51.100.9'})).status);
check('repeated attempts for one email from one address hit 429',limited.slice(0,10).every(s=>s===400)&&limited[10]===429);

// 10) 스위치를 다시 끄면 닫힌다(가입한 계정은 그대로 로그인)
await flags.setFeatureFlag('old-owner',{flag:'self_signup',enabled:false},by);
check('switch off again: signup 404, existing self-signup login still works',(await start('after@example.com')).status===404&&(await verify('new@example.com',secondToken)).status===404&&(await auth.POST(request('/api/auth',{action:'login',email:'new@example.com',password},null,{'cf-connecting-ip':'192.0.2.1'}))).status===200);

console.log(JSON.stringify({passed:passed.length}));
