// G7 계정 관리 API의 범위 역할 초대·배정·해제(이메일 모드, 모의 D1). 스위치 scoped_roles가 꺼져 있으면 새 역할 배정은 409이고 응답은 이전과 같다.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {testRuntime} from './helpers/auth-runtime.mjs';

const origin='https://agency.example',password='A secure password 2026!',bootstrap='bootstrap-secret-token-with-at-least-32-characters',OWNER='old-owner';
const request=(path,body,cookie,headers={})=>new Request(origin+path,{method:body?'POST':'GET',headers:{origin,'content-type':'application/json',...(cookie?{cookie}:{}),...headers},...(body?{body:JSON.stringify(body)}:{})});
const cookieOf=r=>r.headers.get('set-cookie')?.split(';')[0];
const r=testRuntime();
Object.assign(r.env,{AUTH_MODE:'email',AUTH_ORIGIN:origin,AUTH_BOOTSTRAP_EMAIL:'admin@example.com',AUTH_BOOTSTRAP_OWNER:OWNER,AUTH_BOOTSTRAP_TOKEN_HASH:createHash('sha256').update(bootstrap).digest('hex')});
const api=await r.load('app/api/auth/route.ts'),accounts=await r.load('app/api/accounts/route.ts'),workspace=await r.load('app/api/workspace/route.ts');
let n=0;const ip=()=>({'cf-connecting-ip':'10.0.'+Math.floor(n/200)+'.'+(n++%200+1)});
const auth=(b,c)=>api.POST(request('/api/auth',b,c,ip()));
const owner=cookieOf(await auth({action:'bootstrap',email:'admin@example.com',password,token:bootstrap}));
const manage=(body,by=owner)=>accounts.POST(request('/api/accounts',body,by,ip()));
const list=async(by=owner)=>(await accounts.GET(request('/api/accounts',null,by))).json();
const id=email=>r.sql.prepare('SELECT id FROM auth_users WHERE email=?').get(email)?.id;
const rows=kind=>r.sql.prepare('SELECT data FROM records WHERE owner=? AND kind=? ORDER BY rowid').all(OWNER,kind).map(x=>JSON.parse(x.data));
const join=async(email,body)=>{const res=await manage({action:'invite',email,...body});const {token}=await res.json();return cookieOf(await auth({action:'accept',email,token,password}));};
const setFlag=on=>r.sql.prepare("INSERT INTO records(id,owner,kind,parent_id,data,updated_at) VALUES(?,?,'feature_flag','',?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data").run(`${OWNER}:feature_flag:scoped_roles`,OWNER,JSON.stringify({flag:'scoped_roles',enabled:on,updatedAt:new Date().toISOString(),updatedBy:{id:'x',email:null}}),new Date().toISOString());
let passed=0;const check=(name,actual,expected)=>{assert.deepEqual(actual,expected,name);passed++};

// 워크스페이스를 한 번 열어 기본 브랜드(ofd·oda)를 만들고 지점을 심는다.
assert.equal((await workspace.GET(request('/api/workspace',null,owner))).status,200);
for(const [sid,brandId] of [['s1','ofd'],['s3','oda']])r.sql.prepare("INSERT INTO records(id,owner,kind,parent_id,data,updated_at) VALUES(?,?,'store',?,?,?)").run(`${OWNER}:store:${sid}`,OWNER,brandId,JSON.stringify({id:sid,brandId,name:sid+' 지점'}),new Date().toISOString());

// ── 스위치 꺼짐: 응답 불변, 새 역할 배정 409 ──
const before=await list();
check('flag off: account list has no scope fields',['scope' in before,before.accounts.some(a=>'access' in a)],[false,false]);
const off=await manage({action:'invite',email:'bm@example.com',role:'brand_manager',brandIds:['ofd']});
check('flag off: scoped invite is 409',off.status,409);
check('flag off: no account or membership was created',[id('bm@example.com'),rows('membership').length],[undefined,0]);
const staff=await join('staff@example.com',{role:'member'});assert.ok(staff);
check('flag off: set_access to a scoped role is 409',(await manage({action:'set_access',userId:id('staff@example.com'),role:'reviewer',brandIds:['ofd']})).status,409);
check('plain member invite still works with the flag off',typeof id('staff@example.com'),'string');

// ── 스위치 켜짐 ──
setFlag(true);
check('validation: no brand is 400',(await manage({action:'invite',email:'bm@example.com',role:'brand_manager',brandIds:[]})).status,400);
check('validation: unknown brand is 404',(await manage({action:'invite',email:'bm@example.com',role:'brand_manager',brandIds:['ghost']})).status,404);
check('validation: not a list is 400',(await manage({action:'invite',email:'bm@example.com',role:'brand_manager',brandIds:'ofd'})).status,400);
check('validation: failed invites left nothing',[id('bm@example.com'),rows('membership').length],[undefined,0]);
const bm=await join('bm@example.com',{role:'brand_manager',brandIds:['ofd']});
const bmId=id('bm@example.com');
check('scoped invite stores the account as a member',r.sql.prepare('SELECT role FROM auth_users WHERE id=?').get(bmId).role,'member');
check('scoped invite writes the membership',rows('membership').map(m=>({userId:m.userId,role:m.role,brandIds:m.brandIds,storeIds:m.storeIds})),[{userId:bmId,role:'brand_manager',brandIds:['ofd'],storeIds:[]}]);
check('scoped invite is audited as an access change',rows('access_change').map(c=>({target:c.targetEmail,before:c.before,after:c.after.role,actor:c.actor.email})),[{target:'bm@example.com',before:null,after:'brand_manager',actor:'admin@example.com'}]);
const bmView=await (await workspace.GET(request('/api/workspace',null,bm))).json();
check('the invited brand manager sees only the assigned brand',[bmView.brands.map(b=>b.id),bmView.access?.role],[['ofd'],'brand_manager']);
check('a scoped user cannot manage accounts',(await manage({action:'set_access',userId:id('staff@example.com'),role:'reviewer',brandIds:['ofd']},bm)).status,403);

// 기존 직원에게 점포 매니저 배정: 브랜드는 고른 지점의 브랜드로 정한다.
const staffId=id('staff@example.com');
check('store manager assignment',(await manage({action:'set_access',userId:staffId,role:'store_manager',storeIds:['s3'],brandIds:['ofd']})).status,200);
check('store manager brands come from its stores',rows('membership').find(m=>m.userId===staffId),{...rows('membership').find(m=>m.userId===staffId),role:'store_manager',brandIds:['oda'],storeIds:['s3']});
check('store manager needs a store',(await manage({action:'set_access',userId:staffId,role:'store_manager',storeIds:[]})).status,400);
check('same assignment again is 409',(await manage({action:'set_access',userId:staffId,role:'store_manager',storeIds:['s3']})).status,409);
check('admins cannot be scoped',(await manage({action:'set_access',userId:id('admin@example.com'),role:'reviewer',brandIds:['ofd']})).status,409);
check('unknown account is 404',(await manage({action:'set_access',userId:'nobody',role:'reviewer',brandIds:['ofd']})).status,404);
check('unknown role is 400',(await manage({action:'set_access',userId:staffId,role:'superuser',brandIds:['ofd']})).status,400);

// 관리자도 직원의 범위를 배정한다.
const admin=await join('admin-b@example.com',{role:'admin'});
check('an admin can assign a reviewer',(await manage({action:'invite',email:'rv@example.com',role:'reviewer',brandIds:['oda']},admin)).status,200);
check('admin assignment records the admin as actor',rows('access_change').at(-1).actor.email,'admin-b@example.com');

// 목록: 계정별 access와 scope(스위치·브랜드·지점·최근 변경).
const view=await list();
check('list shows access per scoped account',view.accounts.filter(a=>a.access).map(a=>[a.email,a.access.role]).sort(),[['bm@example.com','brand_manager'],['rv@example.com','reviewer'],['staff@example.com','store_manager']]);
check('list shows scope options and recent changes',[view.scope.enabled,['oda','ofd'].every(b=>view.scope.brands.some(x=>x.id===b)),view.scope.stores.map(s=>s.id),view.scope.changes.length],[true,true,['s1','s3'],3]);

// 해제는 스위치가 꺼져도 된다. 관리자로 올리면 멤버십을 지운다.
setFlag(false);
check('clear works with the flag off',(await manage({action:'set_access',userId:staffId,role:'member'})).status,200);
check('cleared membership is gone and audited',[rows('membership').some(m=>m.userId===staffId),rows('access_change').at(-1).after],[false,{role:'member',brandIds:[],storeIds:[]}]);
check('clearing twice is 409',(await manage({action:'set_access',userId:staffId,role:'member'})).status,409);
check('flag off but memberships exist: list still shows scope',(await list()).scope?.enabled,false);
check('promoting a scoped member to admin removes the membership',[(await manage({action:'set_role',userId:bmId,role:'admin'})).status,rows('membership').some(m=>m.userId===bmId)],[200,false]);
const promoted=await (await workspace.GET(request('/api/workspace',null,bm))).json();
check('promoted account sees every brand',[promoted.brands.length>1&&promoted.brands.some(b=>b.id==='oda'),'access' in promoted],[true,false]);
console.log(JSON.stringify({passed}));
