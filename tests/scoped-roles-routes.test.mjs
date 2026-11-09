// G7 범위 역할 경로 가드 회귀(이메일 모드, 모의 D1). 범위 역할은 배정 밖에서 403, 대표·관리자·직원은 이전과 같은 상태·문구다.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {testRuntime} from './helpers/runtime.mjs';

const rt=testRuntime(async()=>{throw new Error('External calls forbidden in scoped role regression')});
Object.assign(rt.env,{AUTH_MODE:'email',AUTH_ORIGIN:'https://app.test'});
const server=await rt.load('lib/server.ts');
const routes={
 workspace:await rt.load('app/api/workspace/route.ts'),action:await rt.load('app/api/action/route.ts'),execution:await rt.load('app/api/execution/route.ts'),
 meta:await rt.load('app/api/meta-ads/execution/route.ts'),ads:await rt.load('app/api/ads-proposals/route.ts'),kakao:await rt.load('app/api/kakao/route.ts'),
 place:await rt.load('app/api/place-drafts/route.ts'),run:await rt.load('app/api/run/route.ts'),meetings:await rt.load('app/api/meetings/route.ts'),
};
const {SCOPE_DENIED}=await rt.load('lib/server-access.ts');
const W='workspace';
await server.seedBrands(W);
const put=(kind,id,data,parent='')=>server.recordStatement(W,kind,id,data,parent).run();
await put('campaign','oda-c',{id:'oda-c',brandId:'oda',title:'ODA 캠페인',version:1,status:'review'});
await put('campaign','ofd-s1',{id:'ofd-s1',brandId:'ofd',storeId:'s1',title:'OFD 1호점',version:1,status:'review'});
await put('campaign','ofd-s2',{id:'ofd-s2',brandId:'ofd',storeId:'s2',title:'OFD 2호점',version:1,status:'review'});
for(const [id,brandId] of [['s1','ofd'],['s2','ofd'],['s3','oda']])await put('store',id,{id,brandId,name:id+' 지점',version:1},brandId);
const artifact=async(id,campaignId)=>put('artifact',id,{id,campaignId,campaignVersion:1,role:'cmo',title:'작업물 '+id,content:'내용',version:1,status:'review'},campaignId);
for(const [id,c] of [['a-ofd','ofd-pilot-01'],['a-ofd2','ofd-pilot-01'],['a-oda','oda-c'],['a-oda2','oda-c'],['a-s1','ofd-s1'],['a-s2','ofd-s2']])await artifact(id,c);
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
const headers=(who)=>({cookie:'__Host-collective_session='+tokens[who],origin:'https://app.test','content-type':'application/json'});
const get=(mod,who,path)=>mod.GET(new Request('https://app.test'+path,{headers:headers(who)}));
const post=(mod,who,data)=>mod.POST(new Request('https://app.test/api/test',{method:'POST',headers:headers(who),body:JSON.stringify(data)}));
const read=async r=>({status:r.status,body:await r.json()});
let passed=0;
const check=(name,actual,expected)=>{assert.deepEqual(actual,expected,name);passed++};

// ── 워크스페이스 목록 거르기 ──
const view=async who=>(await read(await get(routes.workspace,who,'/api/workspace'))).body;
const ids=list=>list.map(x=>x.id).sort();
const ownerView=await view('owner'),memberView=await view('member'),bmView=await view('bm'),smView=await view('sm'),rvView=await view('rv');
check('owner sees every campaign',ids(ownerView.campaigns),['oda-c','ofd-pilot-01','ofd-s1','ofd-s2']);
check('member sees every campaign (unchanged)',ids(memberView.campaigns),ids(ownerView.campaigns));
check('unscoped views carry no access field',['access' in ownerView,'access' in memberView],[false,false]);
check('owner and member see the same keys as before',[Object.keys(ownerView).sort().join(),Object.keys(memberView).sort().join()].every(k=>k===Object.keys(ownerView).sort().join()),true);
check('brand manager sees only the assigned brand',[ids(bmView.campaigns),ids(bmView.brands)],[['ofd-pilot-01','ofd-s1','ofd-s2'],['ofd']]);
check('brand manager artifacts are only from visible campaigns',ids(bmView.artifacts),['a-ofd','a-ofd2','a-s1','a-s2']);
check('store manager sees brand-level and own store campaigns, not another store',ids(smView.campaigns),['ofd-pilot-01','ofd-s1']);
check('reviewer sees only the reviewed brand',[ids(rvView.campaigns),ids(rvView.artifacts)],[['oda-c'],['a-oda','a-oda2']]);
check('scoped views announce their scope',[bmView.access,smView.access],[{role:'brand_manager',brandIds:['ofd'],storeIds:[]},{role:'store_manager',brandIds:['ofd'],storeIds:['s1']}]);
check('scoped events are only from visible campaigns',bmView.events.every(e=>['ofd-pilot-01','ofd-s1','ofd-s2'].includes(e.campaignId)),true);

// ── 작업물 승인(/api/action review_artifact) ──
const review=(who,id,decision='approved',extra={})=>post(routes.action,who,{action:'review_artifact',id,version:1,decision,...extra});
const member=await read(await review('member','a-ofd'));
check('member approval keeps the old 403 and message',[member.status,member.body.error],[403,'관리자만 변경할 수 있습니다.']);
const outside=await read(await review('bm','a-oda'));
check('brand manager cannot approve another brand',[outside.status,outside.body.error],[403,SCOPE_DENIED]);
check('brand manager approves in the assigned brand',(await review('bm','a-ofd')).status,200);
check('approval was written',(await server.readRecord(W,'artifact','a-ofd')).status,'approved');
check('reviewer approves in the reviewed brand',(await review('rv','a-oda')).status,200);
check('reviewer cannot approve outside',(await review('rv','a-ofd2')).status,403);
check('store manager cannot approve brand-level work',(await review('sm','a-ofd2')).status,403);
check('store manager approves own store campaign work',(await review('sm','a-s1')).status,200);
check('store manager cannot approve another store',(await review('sm','a-s2')).status,403);
check('reviewer revision outside the brand is 403',(await review('rv','a-ofd2','revision',{note:'확인'})).status,403);
check('member revision still allowed',(await review('member','a-ofd2','revision',{note:'가격 확인'})).status,200);
check('admin approval unchanged',(await review('admin2','a-oda2')).status,200);
check('unknown artifact is 403 for a scoped role (no existence leak)',(await review('bm','missing')).status,403);
check('unknown artifact stays 404 for an admin',(await review('admin2','missing')).status,404);

// ── 캠페인 작성(/api/action save_campaign) ──
const draft=brandId=>({action:'save_campaign',data:{brandId,title:'범위 확인 캠페인',goal:'평일 방문을 늘립니다.',budget:0}});
check('brand manager writes in the assigned brand',(await post(routes.action,'bm',draft('ofd'))).status,200);
check('brand manager cannot write another brand',(await post(routes.action,'bm',draft('oda'))).status,403);
check('reviewer cannot write campaigns',(await post(routes.action,'rv',draft('oda'))).status,403);
check('member writes any brand (unchanged)',(await post(routes.action,'member',draft('oda'))).status,200);
check('brand manager cannot move another brand campaign into scope',(await post(routes.action,'bm',{...draft('ofd'),id:'oda-c'})).status,403);

// ── 발행 승인·전송(/api/execution) ──
const exec=(who,campaignId,action='approve')=>post(routes.execution,who,{action,campaignId,id:'p',version:1});
const memberExec=await read(await exec('member','ofd-pilot-01'));
check('member publish keeps 403 and message',[memberExec.status,memberExec.body.error],[403,'관리자만 변경할 수 있습니다.']);
check('brand manager cannot publish another brand',[(await exec('bm','oda-c')).status,(await exec('bm','oda-c','execute')).status],[403,403]);
check('brand manager passes the guard in the assigned brand',(await exec('bm','ofd-pilot-01')).status!==403,true);
check('owner passes the guard',(await exec('owner','oda-c')).status!==403,true);
check('reviewer cannot publish',(await exec('rv','oda-c')).status,403);
check('brand manager still cannot change admin-only execution settings',(await post(routes.execution,'bm',{action:'save_limits',campaignId:'ofd-pilot-01',maxPublications:1,maxPlannedCostKRW:0})).status,403);
check('execution view is scoped',[(await get(routes.execution,'bm','/api/execution?campaignId=oda-c')).status,(await get(routes.execution,'bm','/api/execution?campaignId=ofd-pilot-01')).status,(await get(routes.execution,'member','/api/execution?campaignId=oda-c')).status],[403,200,200]);

// ── 지출·고객 발송·광고 반영 ──
check('meta ads activation is owner only (scoped 403)',(await post(routes.meta,'bm',{action:'activate',campaignId:'ofd-pilot-01'})).status,403);
check('meta ads view is scoped',(await get(routes.meta,'bm','/api/meta-ads/execution?campaignId=oda-c')).status,403);
for(const action of ['approve','apply'])check(`ads proposal ${action} denies scoped roles`,(await post(routes.ads,'bm',{action,campaignId:'ofd-pilot-01'})).status,403);
for(const action of ['approve','send'])check(`kakao ${action} denies scoped roles`,(await post(routes.kakao,'bm',{action,brandId:'ofd'})).status,403);

// ── 플레이스 초안(점포 단위) ──
const placeView=await read(await get(routes.place,'sm','/api/place-drafts?storeId=s1'));
check('store manager reads own store drafts',placeView.status,200);
check('store manager cannot read another store',(await get(routes.place,'sm','/api/place-drafts?storeId=s3')).status,403);
check('store manager cannot read a same-brand store not assigned',(await get(routes.place,'sm','/api/place-drafts?storeId=s2')).status,403);
const memberPlace=await read(await get(routes.place,'member','/api/place-drafts?storeId=s1'));
check('member place drafts keep 403 and message',[memberPlace.status,memberPlace.body.error],[403,'관리자만 변경할 수 있습니다.']);
check('owner reads drafts',(await get(routes.place,'owner','/api/place-drafts?storeId=s3')).status,200);
const create=await read(await post(routes.place,'sm',{action:'create',storeId:'s1',kind:'news'}));
check('store manager create passes the scope guard (switch off is 409)',create.status,409);
check('store manager cannot create for another store',(await post(routes.place,'sm',{action:'create',storeId:'s3',kind:'news'})).status,403);
check('store manager cannot declare a device mapping',(await post(routes.place,'sm',{action:'declare_mapping',storeId:'s1'})).status,403);
check('reviewer cannot touch place drafts',(await post(routes.place,'rv',{action:'create',storeId:'s3',kind:'news'})).status,403);
check('member place draft write keeps 403',(await post(routes.place,'member',{action:'create',storeId:'s1',kind:'news'})).status,403);

// ── AI 실행 시작(/api/run, /api/meetings) ──
for(const [name,mod] of [['run',routes.run],['meetings',routes.meetings]]){
 check(`${name}: reviewer cannot start`,(await post(mod,'rv',{action:'start',campaignId:'oda-c',role:'cmo'})).status,403);
 check(`${name}: store manager cannot start`,(await post(mod,'sm',{action:'start',campaignId:'ofd-s1',role:'cmo'})).status,403);
 check(`${name}: brand manager cannot start another brand`,(await post(mod,'bm',{action:'start',campaignId:'oda-c',role:'cmo'})).status,403);
 check(`${name}: brand manager passes in the assigned brand`,(await post(mod,'bm',{action:'start',campaignId:'ofd-pilot-01',role:'cmo'})).status!==403,true);
 check(`${name}: member passes as before`,(await post(mod,'member',{action:'start',campaignId:'oda-c',role:'cmo'})).status!==403,true);
}
check('run: start_sequence is guarded too',(await post(routes.run,'rv',{action:'start_sequence',campaignId:'oda-c'})).status,403);
console.log(JSON.stringify({passed}));
