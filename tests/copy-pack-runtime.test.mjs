// 카피 팩 v2(A3-1) 운영 경로: 기능 스위치 a3_copy_pack이 켜진 소유자의 콘텐츠 역할만 v2 계약으로 제출하고, 팩을 작업물에 저장한다.
// 스위치가 꺼져 있으면 모든 역할의 제출이 순수 함수(v1) 출력과 바이트 동일하다. 팩 형식 문제는 작업물을 막지 않는다(soft).
// 근거: mocked(모의 HERMES fetch 스텁, 메모리 SQLite, 합성 데이터). 외부 네트워크 호출은 0회다.
import assert from 'node:assert/strict';
import {testRuntime} from './helpers/runtime.mjs';
import {roleFixture} from './helpers/role-fixture.mjs';

const sent=new Map(),external=[];let calls=0,packOverride=null;
const variant=(id,hook,body)=>({id,angle:`각도 ${id}`,hook,body,cta:'네이버 플레이스에서 길찾기'});
const V3=[variant('A','퇴근길 20분, 포장 떡볶이 한 컵','가상동 12에서 바로 포장해 가세요. 줄 서지 않고 받는 픽업 선반을 준비했습니다.'),variant('B','오늘 저녁은 떡볶이 한 컵으로','매장 앞 픽업 선반에서 이름만 확인하고 가져가면 됩니다.'),variant('C','동네 분식이 새로 문을 열었어요','가상동 주민분들께 먼저 인사드립니다. 길찾기로 위치를 확인하세요.')];
const scene=(start,end)=>({start,end,visual:'매장 외관',line:'퇴근길 20분',caption:'가상동 12',sound:'거리 소음',transition:'컷'});
const goodPack={version:'copy-pack-v2',channels:[{channel:'Instagram 피드',purpose:'첫 방문 유도',destination:'네이버 플레이스',variants:V3}],shortform:{channel:'Instagram 릴스',durationSec:15,scenes:[scene(0,3),scene(3,7),scene(7,12),scene(12,15)]},experiments:[{title:'훅 비교',channel:'Instagram 피드',hypothesis:'시간 절약 훅이 클릭을 늘린다',variable:'훅',control:'A',treatment:'B',fixed:'본문·CTA',metric:'click_rate'}]};
const note='이 절은 선택 이유와 확인 계획을 적는다. 브리프 v1 목표인 첫 포장 주문에 맞춰 퇴근길 고객의 대기 시간 장벽을 먼저 다룬다.\n[자료 필요] 시간대별 주문량은 점장이 오픈 전 주에 확인한다. 확인 전에는 가격을 확정 문구로 쓰지 않는다.';
// 콘텐츠 v2 계약이면 팩을 붙인 v2 원문을, 나머지는 기존 v1 모의 원문을 돌려준다.
function respond(input){
 const task=JSON.parse(input).task;
 if(task?.role!=='content'||task.outputContract.version!=='role-output-v2')return roleFixture(input);
 const copyPack=packOverride===null?goodPack:packOverride;
 return JSON.stringify({contractVersion:'role-output-v2',role:'content',sections:task.outputContract.sections.map(s=>({id:s.id,content:`${s.title} 메모. ${note}`})),...(copyPack===undefined?{}:{copyPack})});
}
const {sql,load}=testRuntime(async(url,options={})=>{
 url=String(url);
 if(!url.startsWith('https://hermes.example.com/')){external.push(url);throw new Error('모의 주소만 호출합니다: '+url)}
 if(url.endsWith('/v1/runs')){const id='cp_'+ ++calls;sent.set(id,options.body);return Response.json({run_id:id})}
 const id=url.split('/').pop();
 return Response.json({object:'hermes.run',run_id:id,status:'completed',output:respond(JSON.parse(sent.get(id)).input),usage:{total_tokens:100,output_tokens:900},model:'mock-model'});
});
const server=await load('lib/server.ts'),execution=await load('lib/role-execution.ts'),instruction=await load('lib/role-instruction.ts'),flags=await load('lib/feature-flags.ts'),agency=await load('lib/agency.ts');
const now='2026-01-01T00:00:00.000Z',passed=[];
const check=(name,fn)=>{fn();passed.push(name)};
const plain=v=>JSON.parse(JSON.stringify(v));
const ROLES=agency.roles.map(r=>r.id),UPSTREAM=ROLES.slice(0,ROLES.indexOf('content'));

// 합성 브랜드·캠페인. 실제 고객·매장 정보가 아니다.
async function seed(owner,campaignId){
 const put=(kind,id,data,parent='')=>server.recordStatement(owner,kind,id,data,parent).run();
 sql.prepare('INSERT INTO settings(owner,secret,model,updated_at) VALUES(?,?,?,?) ON CONFLICT(owner) DO NOTHING').run(owner,await server.encrypt(JSON.stringify({provider:'hermes',endpoint:'https://hermes.example.com',key:'mock-only'})),'HERMES',now);
 const brand={id:'cp-brand',name:'가상분식',short:'GB',category:'SNACK BAR',color:'#224466',bg:'#eef2f6',description:'합성 브랜드 소개(미확인).',audience:'가상동 주민(가설)',tone:'친근하고 명료한',constraints:'가격은 확인 전 확정 문구로 쓰지 않는다.',knowledge:'합성 메모.'};
 await put('brand',brand.id,brand);
 await put('campaign',campaignId,{id:campaignId,brandId:brand.id,title:'가상분식 오픈',goal:'오픈 전 인지와 첫 포장 주문을 만든다.',audience:'가상동 주민(가설)',channels:'Instagram',stores:'가상동 12',products:'떡볶이(가격 미확정)',budget:null,startDate:'',endDate:'',constraints:'할인 약속 금지.',sources:'',status:'draft',version:1,createdAt:now,updatedAt:now});
}
const setFlag=(owner,enabled)=>flags.setFeatureFlag(owner,{flag:'a3_copy_pack',enabled},{id:owner,email:null});
async function run(owner,campaignId,role){
 const r=await (await execution.executeRole(owner,{action:'start',campaignId,role})).json();
 assert.ok(r.id,`${role} 시작 실패: ${JSON.stringify(r)}`);
 const saved=await server.readRecord(owner,'hermes_submission',r.id);
 const polled=await (await execution.executeRole(owner,{action:'poll',id:r.id})).json();
 return {id:r.id,saved,status:polled.status,body:JSON.parse(saved.body)};
}
const artifactOf=async(owner,campaignId,role)=>(await server.listRecords(owner,'artifact',campaignId)).find(a=>a.role===role&&a.status!=='outdated');
const requestFor=async(owner,campaignId,role)=>{const c=await server.readRecord(owner,'campaign',campaignId);return plain(await execution.roleRequestFor(owner,c,role,await execution.roleSources(owner,c,role),await server.readRecord(owner,'brand',c.brandId)))};

check('the copy pack switch is a known flag that defaults to off',()=>assert.ok(flags.FEATURE_FLAGS.a3_copy_pack?.defaultEnabled===false&&/카피 팩/.test(flags.FEATURE_FLAGS.a3_copy_pack.description)));

// 1) 스위치 꺼짐: 8역할 모두 순수 함수(v1) 출력 그대로 보낸다. 콘텐츠 요청에 outputProfile 키가 없다.
const off='cp-off',offCampaign='cp-off-campaign';await seed(off,offCampaign);
const offRead=await flags.isEnabled(off,'a3_copy_pack');
check('flag off reads as off for the owner',()=>assert.equal(offRead,false));
for(const role of ROLES){
 const req=await requestFor(off,offCampaign,role),r=await run(off,offCampaign,role);
 check(`flag off keeps ${role} submission byte-identical to the v1 builders`,()=>{
  assert.ok(!('outputProfile' in req));
  assert.equal(r.body.instructions,instruction.buildRoleInstruction(req));
  assert.equal(r.body.input,instruction.buildRoleInput(req));
  assert.ok(!r.saved.body.includes('role-output-v2')&&!r.saved.body.includes('copyPack'));
  assert.equal(r.status,'completed');
 });
}
const offContent=await artifactOf(off,offCampaign,'content');
check('flag off keeps content submission byte-identical and stores a v1 artifact without pack fields',()=>assert.ok(offContent.outputContractVersion==='role-output-v1'&&!('copyPack' in offContent)&&!('copyPackIssues' in offContent)&&!('copyPackArtifactVersion' in offContent)));

// 2) 스위치 켜짐: 같은 DB 상태에서 콘텐츠 요청만 바뀐다(나머지 7역할 제출 바이트 동일).
const on='cp-on',onCampaign='cp-on-campaign';await seed(on,onCampaign);
for(const role of UPSTREAM)await run(on,onCampaign,role);
const beforeFlag={};for(const role of ROLES)beforeFlag[role]=execution.roleSubmission(await requestFor(on,onCampaign,role));
await setFlag(on,true);
const afterFlag={};for(const role of ROLES)afterFlag[role]=execution.roleSubmission(await requestFor(on,onCampaign,role));
check('flag on only changes the content role',()=>{
 for(const role of ROLES.filter(r=>r!=='content')){assert.equal(afterFlag[role].instructions,beforeFlag[role].instructions,role);assert.equal(afterFlag[role].input,beforeFlag[role].input,role)}
 assert.notEqual(afterFlag.content.instructions,beforeFlag.content.instructions);
 assert.equal(JSON.parse(afterFlag.content.input).task.outputContract.version,'role-output-v2');
 assert.equal(JSON.parse(afterFlag.content.input).task.outputContract.copyPack,'copy-pack-v2');
});
const contentRun=await run(on,onCampaign,'content');
check('flag on submits the v2 contract for content from the start branch',()=>{
 assert.ok(contentRun.body.instructions.includes('"role-output-v2"')&&contentRun.body.instructions.includes('copyPack'));
 assert.equal(contentRun.body.input,afterFlag.content.input);
});
const onContent=await artifactOf(on,onCampaign,'content');
check('flag on stores copyPack bound to artifact version 1',()=>{
 assert.equal(contentRun.status,'completed');
 assert.equal(onContent.outputContractVersion,'role-output-v2');
 assert.equal(onContent.version,1);assert.equal(onContent.copyPackArtifactVersion,1);
 assert.deepEqual(plain(onContent.copyPack),goodPack);
 assert.ok(!('copyPackIssues' in onContent),JSON.stringify(onContent.copyPackIssues));
 assert.ok(onContent.content.includes('#### 카피 안 A')&&onContent.content.includes(V3[2].hook));
});
const contract=await server.readRecord(on,'role_output_contract',contentRun.id);
check('the stored role output contract is the v2 contract',()=>assert.ok(contract.version==='role-output-v2'&&contract.copyPack==='copy-pack-v2'));
// 뒤 역할(그로스)은 스위치와 무관하게 v1 계약으로 제출한다.
const growth=await run(on,onCampaign,'growth');
check('downstream roles keep the v1 contract with the flag on',()=>assert.ok(JSON.parse(growth.body.input).task.outputContract.version==='role-output-v1'&&!growth.body.instructions.includes('copyPack')));

// 3) 형식 문제 팩: 작업물은 저장하고 copyPackIssues와 이벤트를 남긴다. invalid_output이 아니다.
async function softCase(name,override){
 const campaignId='cp-soft-'+name;await seed(on,campaignId);
 for(const role of UPSTREAM)await run(on,campaignId,role);
 packOverride=override;const r=await run(on,campaignId,'content');packOverride=null;
 const a=await artifactOf(on,campaignId,'content'),usage=(await server.listRecords(on,'provider_usage')).find(u=>u.jobId===r.id||u.submissionId===r.id);
 const events=sql.prepare("SELECT data FROM records WHERE owner=? AND kind='event' AND parent_id=?").all(on,campaignId).map(x=>JSON.parse(x.data).message||'');
 return {r,a,usage,events};
}
const two=await softCase('two',{...goodPack,channels:[{...goodPack.channels[0],variants:V3.slice(0,2)}]});
check('invalid pack saves the artifact with copyPackIssues (no invalid_output)',()=>{
 assert.equal(two.r.status,'completed');
 assert.ok(two.a,'작업물이 저장돼야 한다');
 assert.ok(two.a.copyPackIssues.some(i=>i.code==='variants_too_few'&&i.level==='error'));
 assert.equal(two.a.copyPackArtifactVersion,1);
 assert.ok(two.usage&&two.usage.domainOutcome!=='invalid_output',JSON.stringify(two.usage));
 assert.equal(sql.prepare("SELECT COUNT(*) n FROM records WHERE owner=? AND kind='role_output_failure' AND parent_id='cp-soft-two'").get(on).n,0);
 assert.ok(two.events.some(t=>/카피 팩/.test(t)),JSON.stringify(two.events));
});
const missing=await softCase('missing',undefined);
check('a v2 answer without a pack is soft too',()=>assert.ok(missing.r.status==='completed'&&missing.a&&missing.a.copyPackIssues.some(i=>i.code==='copy_pack_missing')&&!('copyPack' in missing.a)));
check('no external network call',()=>assert.deepEqual(external,[]));
console.log(JSON.stringify({passed:passed.length}));
