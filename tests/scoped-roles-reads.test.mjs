// 경로별 범위 가드 회귀(조회 경로, 이메일 모드, 모의 D1). 범위 역할은 배정 밖 조회가 403이거나 목록에서 빠지고, 대표·관리자·직원은 이전과 같다.
// 그리고 워크스페이스에서 제거(접근 해제)되거나 직원으로 내려간 관리자가 만든 API 키는 MCP에서 401이다. 근거: mocked(메모리 SQLite, 세션 쿠키 주입). 외부 호출 0회.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {testRuntime} from './helpers/runtime.mjs';

const rt=testRuntime(async()=>{throw new Error('External calls forbidden in scoped read regression')});
Object.assign(rt.env,{AUTH_MODE:'email',AUTH_ORIGIN:'https://app.test'});
const server=await rt.load('lib/server.ts'),flags=await rt.load('lib/feature-flags.ts');
const {SCOPE_DENIED}=await rt.load('lib/server-access.ts');
const load=path=>rt.load(`app/api/${path}/route.ts`);
const R={
 campaign:await load('campaigns/[id]'),meetings:await load('meetings'),directives:await load('directives'),dataRequests:await load('data-requests'),
 facts:await load('brand-facts'),archive:await load('archive'),voice:await load('brand-voice'),stores:await load('stores'),ops:await load('store-operations'),
 checks:await load('place-checks'),search:await load('search'),agenda:await load('agenda'),learning:await load('learning'),meta:await load('meta-ads'),
 growth:await load('growth'),usage:await load('usage'),billing:await load('billing'),franchise:await load('franchise'),asset:await load('execution/asset'),
 share:await load('share'),run:await load('run'),sources:await load('artifact-sources'),attribution:await load('campaign-attribution'),measurements:await load('measurements'),
 scheduled:await load('scheduled-runs'),keys:await load('api-keys'),mcp:await load('mcp'),
};
const W='workspace';
await server.seedBrands(W);
const put=(kind,id,data,parent='')=>server.recordStatement(W,kind,id,data,parent).run();
await put('campaign','oda-c',{id:'oda-c',brandId:'oda',title:'ODA 캠페인',version:1,status:'review'});
await put('campaign','ofd-s1',{id:'ofd-s1',brandId:'ofd',storeId:'s1',title:'OFD 1호점',version:1,status:'review'});
await put('campaign','ofd-s2',{id:'ofd-s2',brandId:'ofd',storeId:'s2',title:'OFD 2호점',version:1,status:'review'});
for(const [id,brandId] of [['s1','ofd'],['s2','ofd'],['s3','oda']])await put('store',id,{id,brandId,name:id+' 지점',status:'active',version:1},brandId);
for(const [id,c] of [['a-ofd','ofd-pilot-01'],['a-oda','oda-c'],['a-s1','ofd-s1'],['a-s2','ofd-s2']])await put('artifact',id,{id,campaignId:c,campaignVersion:1,role:'cmo',title:'작업물 '+id,content:'내용',version:1,status:'review'},c);
// 검색 대상(성장 기록 제목에 '도넛 확인'), 자료 요청, 사실
for(const [id,c] of [['g-oda','oda-c'],['g-pilot','ofd-pilot-01'],['g-s1','ofd-s1'],['g-s2','ofd-s2']])await put('growth_signal',id,{id,campaignId:c,input:{title:'도넛 확인 '+id}},c);
for(const [id,brandId,storeId,campaignId] of [['d-brand','ofd',null,null],['d-s1','ofd','s1','ofd-s1'],['d-s2','ofd','s2','ofd-s2']])
 await put('data_request',id,{id,brandId,...(storeId?{storeId}:{}),...(campaignId?{campaignId}:{}),status:'open',factKey:null,label:'요청 '+id,text:'자료를 주세요',createdAt:'2026-11-01T00:00:00.000Z',updatedAt:'2026-11-01T00:00:00.000Z'},brandId);
for(const [id,brandId,storeId] of [['f-ofd','ofd',null],['f-s1','ofd','s1'],['f-s2','ofd','s2'],['f-oda','oda',null]])
 await put('brand_fact',id,{id,brandId,...(storeId?{storeId}:{}),key:'k-'+id,value:'값',status:'confirmed',source:'대표 확인',verifiedAt:'2026-11-01T00:00:00.000Z',validUntil:'2999-01-01T00:00:00.000Z',version:1,updatedAt:'2026-11-01T00:00:00.000Z'},brandId);

const tokens={};let at=Date.now();
const user=(id,role,membership)=>{
 rt.sql.prepare('INSERT INTO auth_users(id,email,workspace_owner,role,status,created_at) VALUES(?,?,?,?,?,?)').run(id,id+'@test.invalid',W,role,'active',at++);
 const token=createHash('sha256').update('token-'+id).digest('hex');tokens[id]=token;
 rt.sql.prepare('INSERT INTO auth_sessions VALUES(?,?,?,?)').run(createHash('sha256').update(token).digest('hex'),id,Date.now()+600000,Date.now());
 return membership?put('membership',id,{userId:id,...membership,updatedAt:new Date().toISOString(),updatedBy:{id:'owner',email:null}}):null;
};
await user('owner','admin');await user('admin2','admin');await user('member','member');
await user('bm','member',{role:'brand_manager',brandIds:['ofd'],storeIds:[]});
await user('sm','member',{role:'store_manager',brandIds:['ofd'],storeIds:['s1']});
await user('rv','member',{role:'reviewer',brandIds:['oda'],storeIds:[]});
const headers=who=>({cookie:'__Host-collective_session='+tokens[who],origin:'https://app.test','content-type':'application/json'});
const req=(who,path)=>new Request('https://app.test'+path,{headers:headers(who)});
const get=(mod,who,path,ctx)=>mod.GET(req(who,path),ctx);
const read=async r=>{const text=await r.text();let body=null;try{body=JSON.parse(text)}catch{body=text}return {status:r.status,body}};
const status=async(mod,who,path,ctx)=>(await get(mod,who,path,ctx)).status;
let passed=0;
const check=(name,actual,expected)=>{assert.deepEqual(actual,expected,name);passed++};
const ok=(name,value)=>{assert.ok(value,name);passed++};
const ctxOf=id=>({params:Promise.resolve({id})});

// ── 캠페인 단위 조회 ──
const detail=async(who,id)=>read(await get(R.campaign,who,'/api/campaigns/'+id,ctxOf(id)));
check('campaign detail: brand manager reads the assigned brand',(await detail('bm','ofd-pilot-01')).status,200);
const outside=await detail('bm','oda-c');
check('campaign detail: brand manager gets 403 with the scope message for another brand',[outside.status,outside.body.error],[403,SCOPE_DENIED]);
check('campaign detail: store manager reads own store, not another store',[(await detail('sm','ofd-s1')).status,(await detail('sm','ofd-s2')).status],[200,403]);
check('campaign detail: reviewer reads only the reviewed brand',[(await detail('rv','oda-c')).status,(await detail('rv','ofd-pilot-01')).status],[200,403]);
const ownerDetail=await detail('owner','oda-c'),memberDetail=await detail('member','oda-c');
check('campaign detail: owner and member read any brand with the same body',[ownerDetail.status,memberDetail.status,JSON.stringify(memberDetail.body)===JSON.stringify(ownerDetail.body)],[200,200,true]);
check('campaign detail: unknown campaign is 403 for a scoped role, 404 for an admin',[(await detail('bm','missing')).status,(await detail('admin2','missing')).status],[403,404]);
for(const [name,mod,path] of [['meetings',R.meetings,'/api/meetings?campaignId='],['directives',R.directives,'/api/directives?campaignId='],['meta ads',R.meta,'/api/meta-ads?campaignId='],['growth',R.growth,'/api/growth?campaignId='],['attribution',R.attribution,'/api/campaign-attribution?campaignId='],['measurements',R.measurements,'/api/measurements?campaignId='],['artifact score badges',R.sources,'/api/artifact-sources?campaign=']]){
 check(`${name}: brand manager is 403 outside the brand`,await status(mod,'bm',path+'oda-c'),403);
 ok(`${name}: brand manager passes in the brand`,await status(mod,'bm',path+'ofd-pilot-01')!==403);
 ok(`${name}: member passes for any brand`,await status(mod,'member',path+'oda-c')!==403);
}
check('artifact sources: reviewer cannot open another brand artifact',await status(R.sources,'rv','/api/artifact-sources?artifact=a-ofd'),403);
ok('artifact sources: reviewer opens a reviewed brand artifact',await status(R.sources,'rv','/api/artifact-sources?artifact=a-oda')!==403);
check('execution asset: unknown creative is 403 for a scoped role and 404 for the owner',[await status(R.asset,'bm','/api/execution/asset?id=nope'),await status(R.asset,'owner','/api/execution/asset?id=nope')],[403,404]);
check('usage grading follows the campaign scope; the usage screen is workspace-wide',[await status(R.usage,'bm','/api/usage?grading=oda-c'),await status(R.usage,'bm','/api/usage?grading=ofd-pilot-01'),await status(R.usage,'bm','/api/usage'),await status(R.usage,'member','/api/usage')],[403,200,403,200]);

// ── 브랜드 단위 조회 ──
check('archive: brand manager reads the assigned brand only',[await status(R.archive,'bm','/api/archive?brandId=ofd'),await status(R.archive,'bm','/api/archive?brandId=oda')],[200,403]);
check('brand voice: reviewer reads the reviewed brand only',[await status(R.voice,'rv','/api/brand-voice?brandId=oda'),await status(R.voice,'rv','/api/brand-voice?brandId=ofd')],[200,403]);
const reqIds=async(who,q)=>{const r=await read(await get(R.dataRequests,who,'/api/data-requests?'+q));return r.status===200?r.body.requests.map(x=>x.id).sort():r.status};
check('data requests: owner and member see every request of the brand',[await reqIds('owner','brandId=ofd'),await reqIds('member','brandId=ofd')],[['d-brand','d-s1','d-s2'],['d-brand','d-s1','d-s2']]);
check('data requests: store manager sees brand-level and own store requests only',await reqIds('sm','brandId=ofd'),['d-brand','d-s1']);
check('data requests: another brand or another store campaign is 403',[await reqIds('bm','brandId=oda'),await reqIds('sm','campaignId=ofd-s2')],[403,403]);
const factIds=async(who,q)=>{const r=await read(await get(R.facts,who,'/api/brand-facts?'+q));return r.status===200?r.body.facts.map(x=>x.id).sort():r.status};
check('brand facts: member list is unfiltered',await factIds('member','brandId=ofd'),['f-ofd','f-s1','f-s2']);
check('brand facts: store manager sees brand and own store facts',await factIds('sm','brandId=ofd'),['f-ofd','f-s1']);
check('brand facts: workspace-wide list is filtered to the assigned brand',await factIds('bm',''),['f-ofd','f-s1','f-s2']);
check('brand facts: another store or another brand is 403',[await factIds('sm','storeId=s2'),await factIds('bm','brandId=oda')],[403,403]);
check('brand facts: reviewer sees no store facts without a store assignment',[await factIds('rv','brandId=oda'),await factIds('rv','storeId=s3')],[['f-oda'],403]);

// ── 지점 단위 조회 ──
const storeIds=async(who,q='')=>{const r=await read(await get(R.stores,who,'/api/stores'+q));return r.status===200?r.body.stores.map(x=>x.id).sort():r.status};
check('stores: owner and member list every store',[await storeIds('owner'),await storeIds('member')],[['s1','s2','s3'],['s1','s2','s3']]);
check('stores: brand manager lists the brand stores, store manager only the assigned store',[await storeIds('bm'),await storeIds('sm')],[['s1','s2'],['s1']]);
check('stores: reviewer without a store assignment lists no stores',await storeIds('rv'),[]);
check('stores: store detail outside the assignment is 403',[await storeIds('sm','?storeId=s2'),await storeIds('bm','?storeId=s3'),await storeIds('rv','?storeId=s3')],[403,403,403]);
check('stores: store detail inside the assignment is 200',[await storeIds('sm','?storeId=s1'),await storeIds('bm','?storeId=s2')],[['s1'],['s1','s2']]);
for(const [name,mod,path] of [['store operations',R.ops,'/api/store-operations?storeId='],['place checks',R.checks,'/api/place-checks?storeId=']]){
 check(`${name}: store manager own store passes, other store 403`,[(await status(mod,'sm',path+'s1'))!==403,await status(mod,'sm',path+'s2')],[true,403]);
 check(`${name}: reviewer cannot read store operations without a store assignment`,await status(mod,'rv',path+'s3'),403);
 check(`${name}: brand manager outside the brand is 403`,await status(mod,'bm',path+'s3'),403);
 ok(`${name}: member reads any store`,await status(mod,'member',path+'s3')!==403);
}

// ── 목록 거르기: 검색·안건·최근 실행·공유 링크 ──
const hits=async who=>{const r=await read(await get(R.search,who,'/api/search?q='+encodeURIComponent('도넛 확인')));return r.body.hits.map(h=>h.campaignId).sort()};
check('search: owner and member find records in every campaign',[await hits('owner'),await hits('member')],[['oda-c','ofd-pilot-01','ofd-s1','ofd-s2'],['oda-c','ofd-pilot-01','ofd-s1','ofd-s2']]);
check('search: brand manager finds only the assigned brand',await hits('bm'),['ofd-pilot-01','ofd-s1','ofd-s2']);
check('search: store manager finds brand-level and own store records',await hits('sm'),['ofd-pilot-01','ofd-s1']);
check('search: reviewer finds only the reviewed brand',await hits('rv'),['oda-c']);
const agendaOf=async who=>(await read(await get(R.agenda,who,'/api/agenda'))).body;
const campaignsIn=a=>[...new Set(a.items.map(i=>i.campaignId))].sort();
const ownerAgenda=await agendaOf('owner'),bmAgenda=await agendaOf('bm'),smAgenda=await agendaOf('sm'),rvAgenda=await agendaOf('rv');
check('agenda: owner sees review items from every campaign',campaignsIn(ownerAgenda),['oda-c','ofd-pilot-01','ofd-s1','ofd-s2']);
check('agenda: member agenda is the same as before (same items as the owner)',JSON.stringify(campaignsIn(await agendaOf('member'))),JSON.stringify(campaignsIn(ownerAgenda)));
check('agenda: scoped roles see only visible campaigns',[campaignsIn(bmAgenda),campaignsIn(smAgenda),campaignsIn(rvAgenda)],[['ofd-pilot-01','ofd-s1','ofd-s2'],['ofd-pilot-01','ofd-s1'],['oda-c']]);
check('agenda: counts follow the filtered items',[rvAgenda.total,rvAgenda.counts.decision],[rvAgenda.items.length,rvAgenda.items.filter(i=>i.kind==='decision').length]);
const now=new Date().toISOString();
for(const [id,c] of [['j-oda','oda-c'],['j-ofd','ofd-pilot-01']])rt.sql.prepare("INSERT INTO jobs(id,owner,campaign_id,role,status,model,campaign_version,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)").run(id,W,c,'cmo','completed','test-model',1,now,now);
const recent=async who=>(await read(await get(R.run,who,'/api/run'))).body.recent.map(r=>r.campaignId).sort();
check('recent runs: member sees all, brand manager only the assigned brand',[await recent('member'),await recent('bm')],[['oda-c','ofd-pilot-01'],['ofd-pilot-01']]);
check('share links: customer report links are workspace-wide for scoped roles (403)',await status(R.share,'bm','/api/share?kind=customer_report'),403);
check('share links: member still lists customer report links',await status(R.share,'member','/api/share?kind=customer_report'),200);

// ── 워크스페이스 전체(범위 역할 403, 직원 그대로) ──
for(const [name,mod,path] of [['learning',R.learning,'/api/learning'],['billing',R.billing,'/api/billing'],['scheduled runs',R.scheduled,'/api/scheduled-runs'],['franchise status',R.franchise,'/api/franchise?view=status']]){
 const denied=await read(await get(mod,'bm',path));
 check(`${name}: brand manager 403 with the scope message`,[denied.status,denied.body.error],[403,SCOPE_DENIED]);
 ok(`${name}: member is not blocked by the scope guard`,await status(mod,'member',path)!==403||(await read(await get(mod,'member',path))).body.error!==SCOPE_DENIED);
}

// ── 제거된 계정의 API 키(MCP) ──
await flags.setFeatureFlag(W,{flag:'mcp_server',enabled:true},{id:'owner',email:null});
const keyPost=(who,input)=>R.keys.POST(new Request('https://app.test/api/api-keys',{method:'POST',headers:headers(who),body:JSON.stringify(input)})).then(read);
const created=(await keyPost('admin2',{action:'create',label:'관리자 키',scope:'read'})).body;
ok('an admin created a key',/^ck_[a-f0-9]{64}$/.test(created.token));
const ping=async token=>(await R.mcp.POST(new Request('https://app.test/api/mcp',{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json',accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'ping'})}))).status;
check('the key works while the admin is active',await ping(created.token),200);
rt.sql.prepare("UPDATE auth_users SET role='member' WHERE id='admin2'").run();
check('the key is rejected after the admin is demoted to member',await ping(created.token),401);
rt.sql.prepare("UPDATE auth_users SET role='admin' WHERE id='admin2'").run();
check('the key works again once the admin role is back',await ping(created.token),200);
rt.sql.prepare("UPDATE auth_users SET status='disabled' WHERE id='admin2'").run();
check('the key is rejected after the account is removed from the workspace',await ping(created.token),401);
const ownerKey=(await keyPost('owner',{action:'create',label:'대표 키',scope:'read'})).body;
check('an active owner key keeps working',await ping(ownerKey.token),200);
console.log(JSON.stringify({passed}));
