import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {testRuntime} from './helpers/runtime.mjs';

// F5: 성과 수집 자격증명은 (brandId[, storeId], channel) 단위다. 조회 우선순위는 지점 > 브랜드 > 워크스페이스 기본(기존 소유자 단위 레코드)이고,
// 다른 브랜드의 자격증명은 후보가 아니다. Instagram fetch 스텁이 받은 Authorization 헤더로 실제로 어느 토큰이 쓰였는지 확인한다(mocked).
const calls=[];
const fakeFetch=async(url,options={})=>{
 if(!url.startsWith('https://graph.facebook.com/'))throw new Error('Unexpected destination: '+url);
 const auth=new Headers(options.headers).get('Authorization')||'';calls.push({url,auth});
 if(url.includes('/insights'))return Response.json({data:[{name:'reach',values:[{value:1000}]},{name:'shares',values:[{value:10}]}]});
 if(url.includes('fields=username'))return Response.json({username:'acct-'+auth.replace('Bearer tok-','')});
 return Response.json({timestamp:'2026-08-01T09:00:00+0000',permalink:'https://instagram.com/p/x',media_type:'VIDEO'});
};
const rt=testRuntime(fakeFetch);
const server=await rt.load('lib/server.ts'),route=await rt.load('app/api/channels/route.ts'),measurements=await rt.load('app/api/measurements/route.ts'),credentials=await rt.load('lib/channel-credentials.ts'),collector=await rt.load('lib/measurement-collection.ts');
const checks=[];const check=(label,v)=>{assert.ok(v,label);checks.push(label)};

const owner='f5-owner',other='f5-other-owner';
await server.seedBrands(owner);await server.seedBrands(other);
// 다른 워크스페이스에만 있는 브랜드. 이 워크스페이스의 요청에는 없는 브랜드다.
await server.recordStatement(other,'brand','other-only',{id:'other-only',name:'다른 워크스페이스 브랜드'}).run();
const store=(id,brandId,status='active')=>server.recordStatement(owner,'store',id,{id,brandId,name:id,status,version:1},brandId).run();
await store('ofd-s1','ofd');await store('ofd-s2','ofd','archived');await store('oda-s1','oda');

async function req(mod,b,who=owner,method='POST',query=''){const h={'content-type':'application/json'};if(who)h['oai-authenticated-user-id']=who;const r=await mod[method](new Request('https://agency.test/api/test'+query,{method,headers:h,...(method==='POST'?{body:JSON.stringify(b)}:{})}));return {status:r.status,data:await r.json()}}
const save=(token,scope={},who=owner)=>req(route,{action:'save_credential',channel:'instagram',data:{accessToken:token,userId:'17841400000000000'},...scope},who);
const revoke=(scope={},channel='instagram')=>req(route,{action:'revoke_credential',channel,...scope});
const status=async(query='')=>(await req(route,null,owner,'GET',query)).data;
const row=id=>rt.sql.prepare('SELECT id,parent_id,data FROM records WHERE id=?').get(id);
const rows=()=>rt.sql.prepare("SELECT id FROM records WHERE owner=? AND kind='channel_credential' ORDER BY id").all(owner).map(r=>r.id);

// --- 기존 무범위 저장·조회는 그대로다(워크스페이스 기본) ---------------------------------
let r=await save('tok-ws',{},owner);
check('unscoped save answers exactly the previous fields',r.status===200&&JSON.stringify(Object.keys(r.data))==='["channel","account","expiresAt"]'&&r.data.account==='acct-ws');
let saved=row(`${owner}:channel_credential:instagram`);
check('unscoped save keeps the owner-level record id, empty parent and stored fields',!!saved&&saved.parent_id===''&&JSON.stringify(Object.keys(JSON.parse(saved.data)))==='["channel","secret","account","createdAt","updatedAt"]');
check('stored secret stays encrypted',!saved.data.includes('tok-ws'));
let loaded=await credentials.loadCredential(owner,'instagram');
check('unscoped load returns the same credential and says it came from the workspace default',loaded.credential.accessToken==='tok-ws'&&loaded.credential.channel==='instagram'&&JSON.stringify(loaded.resolvedScope)==='{"level":"workspace"}');
let st=await status();
check('status channels keep their previous fields',JSON.stringify(Object.keys(st.channels[0]))==='["channel","label","connected","account","expiresAt","expiringSoon","updatedAt"]'&&st.channels.some(c=>c.channel==='instagram'&&c.connected&&c.account==='acct-ws'));

// --- 브랜드·지점 단위 저장 ----------------------------------------------------------
r=await save('tok-ofd',{brandId:'ofd'});
check('brand-scoped save succeeds and names its brand',r.status===200&&r.data.brandId==='ofd'&&r.data.account==='acct-ofd'&&!('storeId' in r.data));
check('brand-scoped record uses the channel:brand id and the same kind',!!row(`${owner}:channel_credential:instagram:ofd`)&&JSON.parse(row(`${owner}:channel_credential:instagram:ofd`).data).brandId==='ofd');
check('brand-scoped save leaves the workspace default untouched',JSON.parse(row(`${owner}:channel_credential:instagram`).data).account==='acct-ws');
check('brand B saves its own credential',(await save('tok-oda',{brandId:'oda'})).status===200);
r=await save('tok-ofd-s1',{brandId:'ofd',storeId:'ofd-s1'});
check('store-scoped save succeeds under its brand',r.status===200&&r.data.brandId==='ofd'&&r.data.storeId==='ofd-s1'&&!!row(`${owner}:channel_credential:instagram:ofd:ofd-s1`));
check('no new record kind is created',rt.sql.prepare("SELECT COUNT(*) AS n FROM records WHERE owner=? AND id LIKE ? AND kind<>'channel_credential'").get(owner,`${owner}:%credential%`).n===0);

// --- 범위 검증: 없는 브랜드·다른 워크스페이스·다른 브랜드 지점·보관 지점 ----------------------
const before=calls.length;
check('an unknown brand is 404',(await save('tok-x',{brandId:'ghost'})).status===404);
check('a brand of another workspace is 404',(await save('tok-x',{brandId:'other-only'})).status===404);
check('a store of another brand is 404',(await save('tok-x',{brandId:'ofd',storeId:'oda-s1'})).status===404);
check('an unknown store is 404',(await save('tok-x',{brandId:'ofd',storeId:'ghost-store'})).status===404);
check('an archived store cannot be connected',(await save('tok-x',{brandId:'ofd',storeId:'ofd-s2'})).status===409);
check('a store without its brand is rejected',(await save('tok-x',{storeId:'ofd-s1'})).status===400);
check('an id with the separator is rejected',(await save('tok-x',{brandId:'ofd:ofd-s1'})).status===400);
check('rejected scopes never call the external API or store anything',calls.length===before&&rows().length===4);
check('revoking under an unknown brand is 404',(await revoke({brandId:'ghost'})).status===404);
check('reading the scope of another workspace brand is 404',(await req(route,null,owner,'GET','?brandId=other-only')).status===404);
check('another workspace sees none of these credentials',(await req(route,null,other,'GET')).data.byBrand.every(b=>!b.connected)&&!(await req(route,null,other,'GET')).data.channels.some(c=>c.connected));

// --- 상태: 브랜드별 연결·만료 -----------------------------------------------------------
await req(route,{action:'save_credential',channel:'instagram',brandId:'oda',data:{accessToken:'tok-oda',userId:'17841400000000000',expiresAt:new Date(Date.now()+3*86400000).toISOString()}});
st=await status();
const entry=(brandId,storeId)=>st.byBrand.find(b=>b.brandId===brandId&&b.channel==='instagram'&&(b.storeId??null)===(storeId??null));
check('status lists every brand per channel',['ofd','oda','mapdal','alan'].every(b=>st.byBrand.some(x=>x.brandId===b&&x.channel==='instagram'&&!x.storeId)&&st.byBrand.some(x=>x.brandId===b&&x.channel==='naver_ads'&&!x.storeId)));
check('connected brands show their account',entry('ofd').connected&&entry('ofd').account==='acct-ofd'&&entry('oda').connected);
check('brands without their own credential are not connected',!entry('mapdal').connected&&!entry('alan').connected);
check('store-level credentials are listed with their store',entry('ofd','ofd-s1')?.connected===true&&entry('ofd','ofd-s1').account==='acct-ofd-s1');
check('an expiring brand token is flagged with a warning',entry('oda').expiringSoon===true&&typeof entry('oda').warning==='string'&&!!entry('oda').expiresAt&&!entry('ofd').warning);
check('workspace default status is unaffected by brand credentials',st.channels.find(c=>c.channel==='instagram').account==='acct-ws'&&!st.channels.find(c=>c.channel==='naver_ads').connected);
check('status never returns a token',!JSON.stringify(st).includes('tok-'));
let scoped=await status('?brandId=ofd&storeId=ofd-s1');
check('status for a store resolves to the store credential',scoped.resolved?.find(x=>x.channel==='instagram')?.resolvedScope?.level==='store'&&scoped.resolved.find(x=>x.channel==='naver_ads').resolvedScope===null);
scoped=await status('?brandId=mapdal');
check('status for a brand without its own credential resolves to the workspace default',scoped.resolved.find(x=>x.channel==='instagram').resolvedScope.level==='workspace');

// --- 수집 격리 -----------------------------------------------------------------
const campaign=(id,brandId,storeId)=>server.recordStatement(owner,'campaign',id,{id,brandId,...(storeId?{storeId}:{}),title:id,version:1}).run();
const experiment=async(id,brandId,campaignId)=>{await server.recordStatement(owner,'viral_experiment',id,{id,brandId,campaignId,channel:'Instagram',status:'running',version:1},campaignId).run();return id};
await campaign('c-ofd','ofd');await campaign('c-ofd-s1','ofd','ofd-s1');await campaign('c-oda','oda');await campaign('c-oda-s1','oda','oda-s1');await campaign('c-mapdal','mapdal');
const eOfd=await experiment('e-ofd','ofd','c-ofd'),eOfdS1=await experiment('e-ofd-s1','ofd','c-ofd-s1'),eOda=await experiment('e-oda','oda','c-oda'),eOdaS1=await experiment('e-oda-s1','oda','c-oda-s1'),eMapdal=await experiment('e-mapdal','mapdal','c-mapdal');
const collect=async(experimentId,extra={})=>{const from=calls.length;const res=await req(measurements,{action:'collect',experimentId,arm:'treatment',channel:'instagram',target:'17900000000000000',from:'2026-08-01',to:'2026-08-07',...extra});return {...res,tokens:[...new Set(calls.slice(from).map(c=>c.auth))]}};
r=await collect(eOfd);
check('brand A collection uses only brand A token',r.status===200&&JSON.stringify(r.tokens)==='["Bearer tok-ofd"]');
r=await collect(eOda);
check('brand B collection uses only brand B token',r.status===200&&JSON.stringify(r.tokens)==='["Bearer tok-oda"]');
r=await collect(eOfdS1);
check('a store campaign uses its store credential first',r.status===200&&JSON.stringify(r.tokens)==='["Bearer tok-ofd-s1"]');
r=await collect(eOdaS1);
check('a store without its own credential falls back to its brand, never to another brand store',r.status===200&&JSON.stringify(r.tokens)==='["Bearer tok-oda"]');
r=await collect(eMapdal);
check('a brand without its own credential uses the workspace default',r.status===200&&JSON.stringify(r.tokens)==='["Bearer tok-ws"]');
check('the draft records which credential unit collected each arm',(await server.readRecord(owner,'measurement_draft',eOfd)).arms.treatment.credential?.level==='brand'&&(await server.readRecord(owner,'measurement_draft',eOfdS1)).arms.treatment.credential?.storeId==='ofd-s1'&&(await server.readRecord(owner,'measurement_draft',eMapdal)).arms.treatment.credential?.level==='workspace');
r=await collect(eOfd,{brandId:'oda',storeId:'oda-s1'});
check('collection input cannot pick another brand credential',r.status===200&&JSON.stringify(r.tokens)==='["Bearer tok-ofd"]');
loaded=await credentials.loadCredential(owner,'instagram',{brandId:'oda'});
check('loading for brand B never returns brand A token',loaded.credential.accessToken==='tok-oda'&&loaded.resolvedScope.level==='brand'&&loaded.resolvedScope.brandId==='oda');

// 두 arm이나 같은 arm의 이전 수집이 서로 다른 연결(다른 계정)로 수집되면 초안 한계에 경고가 붙는다. 이 절 끝에서 alan 브랜드 연결을 지워 뒤 검사의 상태를 그대로 둔다.
await campaign('c-alan','alan');const eAlan=await experiment('e-alan','alan','c-alan');
const draftOf=async id=>await server.readRecord(owner,'measurement_draft',id);
const mixed=l=>l.some(x=>x.includes('서로 다른 연결'));
r=await collect(eAlan,{arm:'control'});
check('the control arm is collected with the workspace default',r.status===200&&JSON.stringify(r.tokens)==='["Bearer tok-ws"]'&&!mixed((await draftOf(eAlan)).limitations));
await save('tok-alan-b',{brandId:'alan'});
r=await collect(eAlan);
let mix=await draftOf(eAlan);
check('arms collected with different connections are flagged in the draft',r.status===200&&JSON.stringify(r.tokens)==='["Bearer tok-alan-b"]'&&mix.arms.control.credential.level==='workspace'&&mix.arms.treatment.credential.level==='brand'&&mix.limitations.some(x=>x.includes('서로 다른 연결(대조안 워크스페이스 기본, 실험안 브랜드 연결 alan)')));
check('the response draft carries the same warning',mixed(r.data.draft.limitations));
r=await collect(eAlan,{arm:'control'});
mix=await draftOf(eAlan);
check('recollecting an arm with another connection flags that arm',r.status===200&&mix.arms.control.limitations.some(x=>x.includes('이전 수집(워크스페이스 기본)과 다른 연결(브랜드 연결 alan)'))&&mix.limitations.some(x=>x.includes('이전 수집(워크스페이스 기본)')));
check('arms collected with the same connection are not flagged',!mixed(mix.limitations));
await collect(eAlan,{arm:'control'});
check('the change notice clears once the arm is collected again with the same connection',!(await draftOf(eAlan)).arms.control.limitations.some(x=>x.includes('이전 수집')));
check('the alan brand credential is removed again',(await revoke({brandId:'alan'})).data.revoked===true);

// 워커 재수집도 같은 규칙이다. 기한이 된 대상 하나만 처리하므로 하나만 기한으로 만든다.
const source=await server.readRecord(owner,'measurement_source',eOda+':treatment');
for(const s of await server.listRecords(owner,'measurement_source'))await server.recordStatement(owner,'measurement_source',s.id,{...s,lastFetchedAt:new Date().toISOString()},s.experimentId).run();
await server.recordStatement(owner,'measurement_source',source.id,{...source,lastFetchedAt:new Date(Date.now()-7*3600000).toISOString()},source.experimentId).run();
let from=calls.length;
check('the worker recollects a due source',(await collector.collectDueMeasurements(owner)).status==='processed');
check('the worker uses the brand credential of the experiment',calls.length>from&&calls.slice(from).every(c=>c.auth==='Bearer tok-oda'));

// --- 해제 범위 -----------------------------------------------------------------
r=await revoke({brandId:'ofd',storeId:'ofd-s1'});
check('revoking a store removes only that store credential',r.status===200&&r.data.revoked===true&&JSON.stringify(rows())===JSON.stringify([`${owner}:channel_credential:instagram`,`${owner}:channel_credential:instagram:oda`,`${owner}:channel_credential:instagram:ofd`]));
r=await collect(eOfdS1);
check('after the store is revoked the store campaign falls back to its brand',r.status===200&&JSON.stringify(r.tokens)==='["Bearer tok-ofd"]');
check('revoking an absent scope reports nothing revoked',(await revoke({brandId:'ofd',storeId:'ofd-s1'})).data.revoked===false&&(await revoke({brandId:'alan'})).data.revoked===false&&rows().length===3);
r=await revoke();
check('revoking without a scope removes only the workspace default',r.data.revoked===true&&JSON.stringify(rows())===JSON.stringify([`${owner}:channel_credential:instagram:oda`,`${owner}:channel_credential:instagram:ofd`]));
r=await collect(eMapdal);
check('without brand or workspace credentials collection stays at the not-connected path',r.status===409&&r.data.error.includes('Instagram 연결이 필요합니다')&&r.tokens.length===0);
r=await collect(eOfd);
check('brand A still collects with its own token after the default is gone',r.status===200&&JSON.stringify(r.tokens)==='["Bearer tok-ofd"]');
r=await revoke({brandId:'ofd'});
check('revoking brand A leaves brand B',r.data.revoked===true&&JSON.stringify(rows())===JSON.stringify([`${owner}:channel_credential:instagram:oda`]));
r=await collect(eOfd);
check('brand A never borrows brand B after its own is revoked',r.status===409&&r.tokens.length===0);
check('a channel with no credential anywhere keeps the previous not-connected error',(await credentials.loadCredential(owner,'naver_ads',{brandId:'ofd'}).then(()=>null,e=>e)).status===409);
check('revoking an archived store credential is allowed',(await revoke({brandId:'ofd',storeId:'ofd-s2'})).status===200);

// --- 권한: 이메일 모드 직원은 저장·해제 403, 조회는 허용 ------------------------------------
Object.assign(rt.env,{AUTH_MODE:'email',AUTH_ORIGIN:'https://agency.test'});
for(const [id,role,token,at] of [['f5-admin','admin','a',0],['f5-member','member','b',1000]]){
 rt.sql.prepare('INSERT INTO auth_users(id,email,workspace_owner,role,status,created_at) VALUES(?,?,?,?,?,?)').run(id,id+'@test.invalid',owner,role,'active',Date.now()+at);
 rt.sql.prepare('INSERT INTO auth_sessions VALUES(?,?,?,?)').run(createHash('sha256').update(token.repeat(64)).digest('hex'),id,Date.now()+60000,Date.now());
}
const emailReq=(token,b)=>route[b?'POST':'GET'](new Request('https://agency.test/api/channels',{method:b?'POST':'GET',headers:{cookie:'__Host-collective_session='+token.repeat(64),origin:'https://agency.test','content-type':'application/json'},...(b?{body:JSON.stringify(b)}:{})}));
from=calls.length;
check('a member cannot save a brand credential',(await emailReq('b',{action:'save_credential',channel:'instagram',brandId:'ofd',data:{accessToken:'tok-member',userId:'17841400000000000'}})).status===403&&calls.length===from);
check('a member cannot revoke a brand credential',(await emailReq('b',{action:'revoke_credential',channel:'instagram',brandId:'oda'})).status===403&&rows().length===1);
check('a member can read brand connection status',(await emailReq('b')).status===200);
check('an admin can save a brand credential',(await emailReq('a',{action:'save_credential',channel:'instagram',brandId:'alan',data:{accessToken:'tok-alan',userId:'17841400000000000'}})).status===200&&rows().includes(`${owner}:channel_credential:instagram:alan`));
check('an anonymous request is 401',(await route.GET(new Request('https://agency.test/api/channels'))).status===401);

console.log(JSON.stringify({passed:checks.length,checks},null,2));
