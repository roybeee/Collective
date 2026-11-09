// 경로별 범위 가드 회귀(쓰기 경로, 이메일 모드, 모의 D1). 범위 역할은 배정 밖 쓰기가 403 SCOPE_DENIED이고, 대표·관리자·직원은 범위 가드에 걸리지 않는다.
// 허용 쪽은 "범위 문구로 거절되지 않음"만 본다(스위치 꺼짐 409·HERMES 미연결 409 등 기존 판정은 그대로 남는다). 근거: mocked(메모리 SQLite, 세션 쿠키). 외부 호출 0회.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {testRuntime} from './helpers/runtime.mjs';

const rt=testRuntime(async()=>{throw new Error('External calls forbidden in scoped write regression')});
Object.assign(rt.env,{AUTH_MODE:'email',AUTH_ORIGIN:'https://app.test'});
const server=await rt.load('lib/server.ts');
const {SCOPE_DENIED}=await rt.load('lib/server-access.ts');
const load=path=>rt.load(`app/api/${path}/route.ts`);
const R={
 archive:await load('archive'),interview:await load('archive/interview'),research:await load('archive/research'),brief:await load('brief'),facts:await load('brand-facts'),
 learn:await load('brand-learn'),attribution:await load('campaign-attribution'),dataRequests:await load('data-requests'),directives:await load('directives'),
 checks:await load('place-checks'),execution:await load('execution'),meetings:await load('meetings'),run:await load('run'),stores:await load('stores'),
 ops:await load('store-operations'),franchise:await load('franchise'),learning:await load('learning'),learningRun:await load('learning/run'),
};
const W='workspace';
await server.seedBrands(W);
const put=(kind,id,data,parent='')=>server.recordStatement(W,kind,id,data,parent).run();
await put('campaign','oda-c',{id:'oda-c',brandId:'oda',title:'ODA 캠페인',version:1,status:'review'});
await put('campaign','ofd-s1',{id:'ofd-s1',brandId:'ofd',storeId:'s1',title:'OFD 1호점',version:1,status:'review'});
await put('campaign','ofd-s2',{id:'ofd-s2',brandId:'ofd',storeId:'s2',title:'OFD 2호점',version:1,status:'review'});
for(const [id,brandId] of [['s1','ofd'],['s2','ofd'],['s3','oda']])await put('store',id,{id,brandId,name:id+' 지점',status:'active',version:1},brandId);
await put('brand_fact','f-oda',{id:'f-oda',brandId:'oda',key:'주소',value:'서울',status:'confirmed',source:'대표 확인',verifiedAt:'2026-11-01T00:00:00.000Z',validUntil:'2999-01-01T00:00:00.000Z',version:1,updatedAt:'2026-11-01T00:00:00.000Z'},'oda');
await put('brief_draft','draft-oda',{id:'draft-oda',status:'completed',input:{brandId:'oda',title:'ODA 초안',goal:'목표'},createdAt:'2026-11-01T00:00:00.000Z',updatedAt:'2026-11-01T00:00:00.000Z',model:'HERMES'});
await put('team_meeting','meet-oda',{id:'meet-oda',campaignId:'oda-c',campaignVersion:1,agenda:'안건',status:'completed',steps:[],createdAt:'2026-11-01T00:00:00.000Z',updatedAt:'2026-11-01T00:00:00.000Z',model:'HERMES',stopRequested:false},'oda-c');
const researchRow=(id,storeId)=>({id,brandId:'ofd',...(storeId?{storeId}:{}),mode:'deep',status:'completed',steps:[],model:'HERMES',stopRequested:false,createdAt:'2026-11-01T00:00:00.000Z',updatedAt:'2026-11-01T00:00:00.000Z'});
for(const [id,storeId] of [['r-brand',null],['r-s1','s1'],['r-s2','s2']])await put('brand_research',id,researchRow(id,storeId),'ofd');
await put('brand_research','r-oda',{...researchRow('r-oda',null),brandId:'oda'},'oda');
for(const [id,storeId] of [['src-brand',null],['src-s2','s2']])await put('brand_source',id,{id,brandId:'ofd',...(storeId?{storeId}:{}),title:'자료 '+id,content:'본문',category:'기타',status:'candidate',origin:'manual',createdAt:'2026-11-01T00:00:00.000Z'},'ofd');
const now=new Date().toISOString();
rt.sql.prepare("INSERT INTO jobs(id,owner,campaign_id,role,status,model,campaign_version,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)").run('job-oda',W,'oda-c','cmo','completed','test-model',1,now,now);

const tokens={};let at=Date.now();
const user=(id,role,membership)=>{
 rt.sql.prepare('INSERT INTO auth_users(id,email,workspace_owner,role,status,created_at) VALUES(?,?,?,?,?,?)').run(id,id+'@test.invalid',W,role,'active',at++);
 const token=createHash('sha256').update('token-'+id).digest('hex');tokens[id]=token;
 rt.sql.prepare('INSERT INTO auth_sessions VALUES(?,?,?,?)').run(createHash('sha256').update(token).digest('hex'),id,Date.now()+600000,Date.now());
 return membership?put('membership',id,{userId:id,...membership,updatedAt:new Date().toISOString(),updatedBy:{id:'owner',email:null}}):null;
};
await user('owner','admin');await user('member','member');
await user('bm','member',{role:'brand_manager',brandIds:['ofd'],storeIds:[]});
await user('sm','member',{role:'store_manager',brandIds:['ofd'],storeIds:['s1']});
await user('rv','member',{role:'reviewer',brandIds:['oda'],storeIds:[]});
const headers=who=>({cookie:'__Host-collective_session='+tokens[who],origin:'https://app.test','content-type':'application/json'});
const read=async r=>{const text=await r.text();let body=null;try{body=JSON.parse(text)}catch{body=text}return {status:r.status,body}};
const post=async(mod,who,data)=>read(await mod.POST(new Request('https://app.test/api/test',{method:'POST',headers:headers(who),body:JSON.stringify(data)})));
const scopeDenied=r=>r.status===403&&r.body?.error===SCOPE_DENIED;
let passed=0;
const denied=async(name,mod,who,data)=>{const r=await post(mod,who,data);assert.ok(scopeDenied(r),`${name}: expected scope 403, got ${r.status} ${JSON.stringify(r.body).slice(0,160)}`);passed++};
const allowed=async(name,mod,who,data)=>{const r=await post(mod,who,data);assert.ok(!scopeDenied(r),`${name}: unexpected scope 403`);passed++;return r};

// ── 캠페인 단위 쓰기 ──
const directive=campaignId=>({action:'add',campaignId,text:'가격은 확인된 값만 씁니다.'});
await denied('directives: brand manager cannot add to another brand campaign',R.directives,'bm',directive('oda-c'));
await denied('directives: reviewer cannot add directives',R.directives,'rv',directive('oda-c'));
await denied('directives: store manager cannot add to another store campaign',R.directives,'sm',directive('ofd-s2'));
await allowed('directives: brand manager adds in the assigned brand',R.directives,'bm',directive('ofd-pilot-01'));
await allowed('directives: member adds to any brand (unchanged)',R.directives,'member',directive('oda-c'));
await denied('campaign attribution snapshot: another brand is 403',R.attribution,'bm',{action:'snapshot',campaignId:'oda-c'});
await allowed('campaign attribution snapshot: member is not scope-blocked',R.attribution,'member',{action:'snapshot',campaignId:'oda-c'});
await denied('execution: brand manager cannot save a creative for another brand',R.execution,'bm',{action:'save_creative',campaignId:'oda-c'});
await allowed('execution: brand manager prepares in the assigned brand',R.execution,'bm',{action:'save_creative',campaignId:'ofd-pilot-01'});
await allowed('execution: member prepares for any brand (unchanged)',R.execution,'member',{action:'save_creative',campaignId:'oda-c'});
await denied('data requests: brand manager cannot create for another brand campaign',R.dataRequests,'bm',{action:'create',campaignId:'oda-c',text:'영업시간'});
await denied('data requests: store manager cannot create a brand-level request',R.dataRequests,'sm',{action:'create',brandId:'ofd',text:'영업시간'});
await allowed('data requests: store manager creates for the own store',R.dataRequests,'sm',{action:'create',brandId:'ofd',storeId:'s1',text:'영업시간'});
await denied('data requests: a store of another brand under the own brand id is 403',R.dataRequests,'bm',{action:'create',brandId:'ofd',storeId:'s3',text:'영업시간'});

// ── AI 실행의 후속 작업(회의·역할 실행·연속 실행·초안·조사) ──
await denied('meetings: brand manager cannot cancel another brand meeting',R.meetings,'bm',{action:'cancel',id:'meet-oda'});
await allowed('meetings: member cancel is not scope-blocked',R.meetings,'member',{action:'cancel',id:'meet-oda'});
await denied('run: brand manager cannot poll another brand job',R.run,'bm',{action:'poll',id:'job-oda'});
await denied('run: brand manager cannot advance another brand sequence',R.run,'bm',{action:'advance_sequence',campaignId:'oda-c'});
await allowed('run: member poll is not scope-blocked',R.run,'member',{action:'poll',id:'job-oda'});
await denied('brief: brand manager cannot start a draft for another brand',R.brief,'bm',{action:'start',id:'draft-new',data:{brandId:'oda',title:'새 초안',goal:'목표'}});
await denied('brief: restarting another brand draft id under the own brand is 403',R.brief,'bm',{action:'start',id:'draft-oda',data:{brandId:'ofd',title:'새 초안',goal:'목표'}});
await denied('brief: brand manager cannot load another brand draft',R.brief,'bm',{action:'load',id:'draft-oda'});
await allowed('brief: reviewer of the brand loads its draft (read)',R.brief,'rv',{action:'load',id:'draft-oda'});
await allowed('brief: member loads any draft (unchanged)',R.brief,'member',{action:'load',id:'draft-oda'});
await denied('research: brand manager cannot start research for another brand',R.research,'bm',{action:'start',id:'r-new',brandId:'oda'});
await denied('research: brand manager cannot cancel another brand research',R.research,'bm',{action:'cancel',id:'r-oda'});
await denied('research: store manager cannot run research (no run_ai)',R.research,'sm',{action:'start',id:'r-new2',brandId:'ofd',storeId:'s1'});
await allowed('research: brand manager starts in the assigned brand',R.research,'bm',{action:'start',id:'r-new3',brandId:'ofd'});

// ── 브랜드 단위 쓰기 ──
await denied('archive: brand manager cannot add a source to another brand',R.archive,'bm',{action:'add_source',brandId:'oda',data:{title:'자료',content:'본문'}});
await denied('archive: scoped roles cannot create a brand',R.archive,'bm',{action:'create_brand',id:'brand-new-1',data:{name:'새 브랜드',category:'카페'}});
await denied('archive: store manager cannot edit the brand archive',R.archive,'sm',{action:'add_source',brandId:'ofd',data:{title:'자료',content:'본문'}});
await allowed('archive: brand manager adds a source in the assigned brand',R.archive,'bm',{action:'add_source',brandId:'ofd',data:{title:'자료',content:'본문'}});
await allowed('archive: member adds to any brand (unchanged)',R.archive,'member',{action:'add_source',brandId:'oda',data:{title:'자료',content:'본문'}});
await denied('interview: brand manager cannot save an interview for another brand',R.interview,'bm',{action:'save',brandId:'oda'});
await denied('brand learn: brand manager cannot preview another brand',R.learn,'bm',{action:'preview',brandId:'oda',url:'https://example.test/'});
const fact=(brandId,storeId,extra={})=>({action:'save_fact',...extra,data:{brandId,...(storeId?{storeId}:{}),key:'영업시간',value:'10시',status:'candidate',source:'대표 확인',verifiedAt:'2026-11-01'}});
await denied('brand facts: another brand is 403',R.facts,'bm',fact('oda'));
await denied('brand facts: moving another brand fact into the own brand is 403',R.facts,'bm',fact('ofd',null,{id:'f-oda',version:1}));
await denied('brand facts: store manager cannot write another store fact',R.facts,'sm',fact('ofd','s2'));
await denied('brand facts: store manager cannot write a brand-level fact',R.facts,'sm',fact('ofd'));
await allowed('brand facts: store manager writes an own store fact',R.facts,'sm',fact('ofd','s1'));
await allowed('brand facts: member writes any brand (unchanged)',R.facts,'member',fact('oda'));

// ── 지점 단위 쓰기 ──
await denied('stores: store manager cannot create a store',R.stores,'sm',{action:'save_store',brandId:'ofd',data:{name:'새 지점'}});
await denied('stores: brand manager cannot create a store in another brand',R.stores,'bm',{action:'save_store',brandId:'oda',data:{name:'새 지점'}});
await denied('stores: store manager cannot edit another store channel',R.stores,'sm',{action:'save_channel',storeId:'s2',data:{key:'instagram'}});
await denied('stores: reviewer cannot edit store data',R.stores,'rv',{action:'save_channel',storeId:'s3',data:{key:'instagram'}});
await denied('stores: preview of another store is 403',R.stores,'sm',{action:'preview_close',storeId:'s2',experimentId:'x',decision:'adopt'});
await denied('stores: linking another brand campaign to the own store is 403',R.stores,'sm',{action:'link_store',storeId:'s1',campaignId:'oda-c'});
await allowed('stores: store manager edits the own store channel',R.stores,'sm',{action:'save_channel',storeId:'s1',data:{key:'instagram'}});
await allowed('stores: member creates a store in any brand (unchanged)',R.stores,'member',{action:'save_store',brandId:'oda',data:{name:'새 지점'}});
await denied('store operations: store manager cannot record spend for another store',R.ops,'sm',{action:'save_spend',storeId:'s2',data:{id:'sp-1'}});
await allowed('store operations: store manager records for the own store',R.ops,'sm',{action:'save_spend',storeId:'s1',data:{id:'sp-2'}});
await denied('place checks: store manager cannot update another store task',R.checks,'sm',{action:'save_task',storeId:'s2',id:'t1'});

// ── 워크스페이스 전체 쓰기 ──
await denied('learning: scoped roles cannot change workspace learning',R.learning,'bm',{action:'add_case'});
await denied('learning run: scoped roles cannot start learning jobs',R.learningRun,'bm',{action:'start_guidance'});
await denied('franchise: scoped roles cannot write franchise recruitment',R.franchise,'bm',{action:'save_settings',requestId:'req-12345678'});
await allowed('learning: member is not scope-blocked',R.learning,'member',{action:'unknown_action'});

// ── 아카이브 조사 목록: 점포 매니저는 다른 지점 조사·자료를 받지 않는다 ──
const archive=await rt.load('app/api/archive/route.ts');
const view=async who=>(await read(await archive.GET(new Request('https://app.test/api/archive?brandId=ofd',{headers:headers(who)})))).body;
const ids=list=>list.map(x=>x.id).sort();
const ownerView=await view('owner'),smView=await view('sm'),bmView=await view('bm');
assert.deepEqual(ids(ownerView.research),['r-brand','r-s1','r-s2'],'owner sees all research');passed++;
assert.deepEqual(ids(bmView.research),['r-brand','r-s1','r-s2'],'brand manager sees all research of the brand');passed++;
assert.deepEqual(ids(smView.research),['r-brand','r-s1'],'store manager sees brand-level and own store research only');passed++;
assert.ok(ids(smView.sources).includes('src-brand')&&!ids(smView.sources).includes('src-s2'),'store manager does not see another store source');passed++;
assert.ok(ids(ownerView.sources).includes('src-s2'),'owner still sees store sources');passed++;
console.log(JSON.stringify({passed}));
