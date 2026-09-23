import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {testRuntime} from './helpers/runtime.mjs';

// 캠페인 상시 지시: 브리프 version과 분리되어 작업물을 무효화하지 않고, 행위자와 변경 이력만 남긴다.
const rt=testRuntime(async()=>{throw new Error('External calls forbidden in directives regression')});
Object.assign(rt.env,{AUTH_MODE:'email',AUTH_ORIGIN:'https://app.test'});
const server=await rt.load('lib/server.ts'),route=await rt.load('app/api/directives/route.ts'),ctx=await rt.load('lib/ai-context.ts');
const owner='workspace',admin='a'.repeat(64),member='b'.repeat(64),outsider='c'.repeat(64);
await server.seedBrands(owner);await server.seedBrands('other-workspace');
for(const [id,workspace,role,token] of [['admin',owner,'admin',admin],['member',owner,'member',member],['outsider','other-workspace','admin',outsider]]){
 rt.sql.prepare('INSERT INTO auth_users(id,email,workspace_owner,role,status,created_at) VALUES(?,?,?,?,?,?)').run(id,id+'@test.invalid',workspace,role,'active',Date.now());
 rt.sql.prepare('INSERT INTO auth_sessions VALUES(?,?,?,?)').run(createHash('sha256').update(token).digest('hex'),id,Date.now()+60000,Date.now());
}
let passed=0;const check=(name,value)=>{assert.ok(value,name);passed++};
const campaign={id:'c1',brandId:'oda',title:'오픈',goal:'오픈 알리기',version:4,status:'review',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};
await server.recordStatement(owner,'campaign','c1',campaign).run();
await server.recordStatement(owner,'campaign','c2',{...campaign,id:'c2'}).run();
await server.recordStatement(owner,'artifact','a1',{id:'a1',campaignId:'c1',campaignVersion:4,role:'strategy',title:'전략',content:'전략 초안',status:'review',version:1,origin:'ai',createdAt:new Date().toISOString()},'c1').run();
const post=async(token,data,origin='https://app.test')=>{const r=await route.POST(new Request('https://app.test/api/directives',{method:'POST',headers:{cookie:'__Host-collective_session='+token,origin,'content-type':'application/json'},body:JSON.stringify(data)}));return {status:r.status,...await r.json()}};
const get=async(token,campaignId='c1')=>{const r=await route.GET(new Request('https://app.test/api/directives?campaignId='+campaignId,{headers:token?{cookie:'__Host-collective_session='+token}:{}}));return {status:r.status,...await r.json()}};
const events=()=>rt.sql.prepare("SELECT data FROM records WHERE owner=? AND kind='event'").all(owner).map(r=>JSON.parse(r.data));

check('anonymous list rejected',(await get('')).status===401);
check('cross origin add rejected',(await post(member,{action:'add',campaignId:'c1',text:'되묻지 않습니다.'},'https://evil.test')).status===403);
check('other workspace cannot reach campaign',(await get(outsider)).status===404&&(await post(outsider,{action:'add',campaignId:'c1',text:'침입'})).status===404);
check('empty directive rejected',(await post(member,{action:'add',campaignId:'c1',text:'   '})).status===400);
check('directive over 500 characters rejected',(await post(member,{action:'add',campaignId:'c1',text:'가'.repeat(501)})).status===400);
const added=await post(member,{action:'add',campaignId:'c1',id:'dir-1',text:'  선택지를 제시하거나 되묻지 마세요.  '});
check('member adds standing directive',added.status===200&&added.directive.text==='선택지를 제시하거나 되묻지 마세요.');
const stored=await server.readRecord(owner,'campaign_directive','dir-1');
check('directive records actor and actor role',stored.createdBy.id==='member'&&stored.createdBy.email==='member@test.invalid'&&stored.createdBy.role==='member'&&stored.campaignId==='c1');
check('retry with same id is idempotent',(await post(member,{action:'add',campaignId:'c1',id:'dir-1',text:'선택지를 제시하거나 되묻지 마세요.'})).status===200&&(await get(member)).directives.length===1);
check('id owned by another campaign rejected',(await post(member,{action:'add',campaignId:'c2',id:'dir-1',text:'다른 캠페인'})).status===409);
check('duplicate directive text rejected',(await post(member,{action:'add',campaignId:'c1',text:'선택지를 제시하거나 되묻지 마세요.'})).status===409);
const afterAdd=await server.readRecord(owner,'campaign','c1');
check('brief version and status unchanged',afterAdd.version===4&&afterAdd.status==='review');
check('artifacts are not invalidated',(await server.readRecord(owner,'artifact','a1')).status==='review');
check('change history event keeps actor',events().some(e=>e.campaignId==='c1'&&e.message.includes('상시 지시 추가')&&e.actor?.email==='member@test.invalid'));
const listed=await get(member);
check('list returns directives with evidence summary',listed.status===200&&listed.directives[0].id==='dir-1'&&listed.evidence.directives===1&&typeof listed.evidence.confirmedFacts==='number'&&['included','stale','none'].includes(listed.evidence.diagnosis));
check('list hides owner key',!JSON.stringify(listed).includes('workspace:'));
check('evidence context delivers directive to AI inputs with author role label',JSON.stringify((await ctx.evidenceContext(rt.env.DB,owner,campaign)).directives)===JSON.stringify([{text:'선택지를 제시하거나 되묻지 마세요.',author:'직원'}]));
for(let i=1;i<30;i++)assert.equal((await post(admin,{action:'add',campaignId:'c1',text:'지시 '+i})).status,200);
check('thirty directives allowed',(await get(admin)).directives.length===30);
check('thirty-first directive rejected',(await post(admin,{action:'add',campaignId:'c1',text:'지시 31'})).status===409);
check('other campaign keeps its own limit',(await post(admin,{action:'add',campaignId:'c2',text:'다른 캠페인 지시'})).status===200);
// 관리자가 남긴 지시는 직원이 지우지 못한다(SEC-1). 직원 지시는 관리자가 지울 수 있다.
const guard=await post(admin,{action:'add',campaignId:'c2',id:'admin-guard',text:'할인 표현 금지'});
check('admin directive records a non-member role',guard.status===200&&['owner','admin'].includes((await server.readRecord(owner,'campaign_directive','admin-guard')).createdBy.role));
check('member cannot remove an admin directive',(await post(member,{action:'remove',campaignId:'c2',id:'admin-guard'})).status===403&&!!(await server.readRecord(owner,'campaign_directive','admin-guard')));
check('admin removes an admin directive',(await post(admin,{action:'remove',campaignId:'c2',id:'admin-guard'})).status===200);
check('remove of an already deleted directive is idempotent',(await post(admin,{action:'remove',campaignId:'c2',id:'admin-guard'})).status===200&&(await post(member,{action:'remove',campaignId:'c1',id:'missing'})).removed==='missing');
check('cannot remove another campaign directive',(await post(member,{action:'remove',campaignId:'c2',id:'dir-1'})).status===404);
const removed=await post(member,{action:'remove',campaignId:'c1',id:'dir-1'});
check('member removes own-role directive',removed.status===200&&!(await get(member)).directives.some(d=>d.id==='dir-1'));
const memberDirective=await post(member,{action:'add',campaignId:'c2',id:'member-note',text:'첫 장면은 매장 전경'});
check('admin removes a member directive',memberDirective.status===200&&(await post(admin,{action:'remove',campaignId:'c2',id:'member-note'})).status===200);
check('removal keeps history and version',events().some(e=>e.message.includes('상시 지시 삭제')&&e.message.includes('되묻지'))&&(await server.readRecord(owner,'campaign','c1')).version===4);
check('unknown action rejected',(await post(member,{action:'rewrite',campaignId:'c1'})).status===400);
console.log(JSON.stringify({passed}));
