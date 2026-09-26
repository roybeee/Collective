// 카피 팩 v2(A3-1): 순수 검증·렌더(lib/copy-pack.ts), 계약 선택(lib/role-output.ts), 채점기 copy_pack_variants(lib/graders/copy-pack.ts).
// 근거: mocked(합성 데이터, 네트워크 없음). 원문은 모두 가상 브랜드 문장이다.
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {SourceTextModule,createContext} from 'node:vm';
import ts from 'typescript';
import {roleFixture} from './helpers/role-fixture.mjs';
const context=createContext({console}),cache=new Map();
function moduleFor(path){path=resolve(path);if(cache.has(path))return cache.get(path);const m=new SourceTextModule(ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText,{context,identifier:path});cache.set(path,m);return m}
async function load(path){const m=moduleFor(path);if(m.status==='unlinked')await m.link((s,r)=>moduleFor(resolve(dirname(r.identifier),s+'.ts')));if(m.status!=='evaluated')await m.evaluate();return m.namespace}
const pack=await load('lib/copy-pack.ts'),roleOutput=await load('lib/role-output.ts'),graders=await load('lib/graders/index.ts'),text=await load('lib/graders/text.ts');
const instruction=await load('lib/role-instruction.ts'),learning=await load('lib/learning.ts'),units=await load('lib/prompt-units.ts');
const {copyBlocks}=await load('lib/execution.ts');
const passed=[];
const check=(name,fn)=>{fn();passed.push(name)};
const plain=v=>JSON.parse(JSON.stringify(v));
const errors=issues=>plain(issues).filter(i=>i.level==='error');
const codes=issues=>errors(issues).map(i=>i.code);

// ── 합성 팩 ──
const variant=(id,hook,body,extra={})=>({id,angle:`각도 ${id}`,hook,body,cta:'네이버 플레이스에서 길찾기',...extra});
const V3=[
 variant('A','퇴근길 20분, 포장 떡볶이 한 컵','가상동 12에서 바로 포장해 가세요. 줄 서지 않고 받는 픽업 선반을 준비했습니다.',{needsCheck:['가격']}),
 variant('B','오늘 저녁은 떡볶이 한 컵으로','매장 앞 픽업 선반에서 이름만 확인하고 가져가면 됩니다. 기다림 없이 저녁을 해결하세요.'),
 variant('C','동네 분식이 새로 문을 열었어요','가상동 주민분들께 먼저 인사드립니다. 길찾기로 위치를 확인하고 편하게 들러 주세요.'),
];
const channel=(name,variants)=>({channel:name,purpose:'첫 방문 유도',destination:'네이버 플레이스',variants});
const scene=(start,end,n)=>({start,end,visual:`장면 ${n} 화면: 매장 외관과 포장 선반`,line:`장면 ${n} 대사`,caption:`장면 ${n} 자막`,sound:'거리 소음',transition:'컷'});
const SCENES=[scene(0,3,1),scene(3,7,2),scene(7,12,3),scene(12,15,4)];
const EXPERIMENT={title:'훅 비교',channel:'Instagram 피드',hypothesis:'시간 절약 훅이 클릭을 늘린다',variable:'훅',control:'A',treatment:'B',fixed:'본문·CTA·게시 시각',metric:'click_rate'};
const makePack=(over={})=>({version:'copy-pack-v2',channels:[channel('Instagram 피드',V3)],shortform:{channel:'Instagram 릴스',durationSec:15,scenes:SCENES},experiments:[EXPERIMENT],...over});
const note=t=>`${t} 이 절은 선택 이유와 확인 계획을 적는다. 브리프 v1 목표인 첫 포장 주문에 맞춰 퇴근길 고객의 대기 시간 장벽을 먼저 다룬다. [자료 필요] 시간대별 주문량은 점장이 오픈 전 주에 확인한다. 확인 전에는 가격을 확정 문구로 쓰지 않는다.`;
const SECTIONS=[{id:'output_1',content:note('채널별 용도: 인스타그램 피드는 첫 방문 유도용이다.')},{id:'output_2',content:note('편집 메모: 첫 3초에 매장 외관을 보여 준다.')},{id:'output_3',content:note('랜딩 문안: 첫 화면에 길찾기 버튼을 둔다.')},{id:'output_4',content:note('실험 선택 이유: 훅 하나만 바꿔 비교한다.')}];
// 인자 없이 부르면 정상 팩, undefined를 넘기면 copyPack 키가 없는 원문이다.
const rawV2=(...args)=>{const p=args.length?args[0]:makePack();return JSON.stringify({contractVersion:'role-output-v2',role:'content',sections:SECTIONS,...(p===undefined?{}:{copyPack:p})})};
const item=(raw,extra={})=>({id:'cp',kind:'role',role:'content',raw,contract:true,...extra});
const graded=(raw,ctx={})=>Object.fromEntries(plain(graders.runGraders(item(raw),ctx)).map(r=>[r.id,r]));
const v2Contract=roleOutput.roleOutputContract('content',{copyPack:true});

// ── 계약 ──
check('the v2 contract is content-only and keeps the four code-owned sections',()=>{
 assert.equal(v2Contract.version,'role-output-v2');assert.equal(v2Contract.copyPack,'copy-pack-v2');
 assert.deepEqual(plain(v2Contract.sections),plain(roleOutput.roleOutputContract('content').sections));
 assert.deepEqual(plain(roleOutput.roleOutputContract('cmo',{copyPack:true})),plain(roleOutput.roleOutputContract('cmo')));
 assert.deepEqual(Object.keys(roleOutput.roleOutputContract('content')),['version','role','sections']);
});
check('the pure copy pack module imports only relative paths',()=>assert.ok([...readFileSync('lib/copy-pack.ts','utf8').matchAll(/from\s+'([^']+)'/g)].every(x=>x[1].startsWith('./'))));

// ── RED 1: 채널당 서로 다른 안 3개 ──
check('copy pack needs three distinct variants per channel',()=>{
 const two=pack.parseCopyPack(makePack({channels:[channel('Instagram 피드',V3.slice(0,2))]}));
 assert.ok(codes(two.issues).includes('variants_too_few'),JSON.stringify(plain(two.issues)));
 assert.equal(graded(rawV2(makePack({channels:[channel('Instagram 피드',V3.slice(0,2))]}))).copy_pack_variants.status,'fail');
 const three=pack.parseCopyPack(makePack());
 assert.deepEqual(errors(three.issues),[]);
 assert.equal(graded(rawV2()).copy_pack_variants.status,'pass');
 const six=pack.parseCopyPack(makePack({channels:[channel('Instagram 피드',[...V3,...['D','E','F'].map(id=>variant(id,`다른 훅 ${id} 문장`,`다른 본문 ${id}입니다. 매장 위치를 먼저 확인하세요.`))])]}));
 assert.ok(codes(six.issues).includes('variants_too_many'));
});
// ── RED 2: 공백·문장부호만 다른 안은 1안 ──
check('duplicate variants do not count',()=>{
 const copy={...V3[0],id:'B',hook:' 퇴근길 20분 포장 떡볶이 한 컵!! ',body:'가상동 12에서, 바로 포장해 가세요 줄 서지 않고 받는 픽업 선반을 준비했습니다…'};
 const dup=makePack({channels:[channel('Instagram 피드',[V3[0],copy,V3[2]])]});
 assert.ok(codes(pack.parseCopyPack(dup).issues).includes('variants_too_few'));
 assert.equal(graded(rawV2(dup)).copy_pack_variants.status,'fail');
 assert.equal(pack.variantKey(V3[0]),pack.variantKey(copy));
 assert.notEqual(pack.variantKey(V3[0]),pack.variantKey(V3[1]));
 assert.ok(codes(pack.parseCopyPack(makePack({channels:[channel('Instagram 피드',[V3[0],{...V3[1],id:'A'},V3[2]])]})).issues).includes('variant_id_duplicate'));
});
// ── RED 3: 장면 타임라인 ──
check('scene timeline must close',()=>{
 const withScenes=(scenes,durationSec=15)=>codes(pack.parseCopyPack(makePack({shortform:{channel:'Instagram 릴스',durationSec,scenes}})).issues);
 assert.deepEqual(withScenes(SCENES),[]);
 assert.ok(withScenes([scene(1,3,1),...SCENES.slice(1)]).includes('scene_timeline'));
 assert.ok(withScenes([scene(0,3,1),scene(4,7,2),...SCENES.slice(2)]).includes('scene_timeline'));
 assert.ok(withScenes([...SCENES.slice(0,3),scene(12,14,4)]).includes('scene_timeline'));
 assert.ok(withScenes(SCENES.slice(0,2).concat([scene(7,15,3)])).length===0);
 assert.ok(withScenes(SCENES.slice(0,2)).includes('scene_count'));
 assert.ok(withScenes([scene(0,1,1),scene(1,2,2),scene(2,3,3)],3).includes('shortform_duration'));
 assert.ok(codes(pack.parseCopyPack(makePack({shortform:undefined})).issues).includes('shortform_missing'));
});
// ── RED 4: 실험 팔은 안 id, 지표는 학습 지표 ──
check('experiment arms reference variant ids and a learning metric',()=>{
 const exp=over=>codes(pack.parseCopyPack(makePack({experiments:[{...EXPERIMENT,...over}]})).issues);
 assert.deepEqual(exp({}),[]);
 assert.ok(exp({control:'Z'}).includes('experiment_arm'));
 assert.ok(exp({treatment:'A'}).includes('experiment_arm'));
 assert.ok(exp({channel:'YouTube'}).includes('experiment_channel'));
 assert.ok(exp({metric:'conversion_rate'}).includes('experiment_metric'));
 assert.deepEqual(plain(pack.COPY_PACK_METRICS),Object.keys(learning.learningMetrics));
 assert.ok(codes(pack.parseCopyPack(makePack({experiments:[]})).issues).includes('experiment_count'));
 assert.ok(codes(pack.parseCopyPack(makePack({experiments:[EXPERIMENT,EXPERIMENT,EXPERIMENT,EXPERIMENT]})).issues).includes('experiment_count'));
});
check('channel count, lengths, a single CTA and the pack version are checked',()=>{
 assert.ok(codes(pack.parseCopyPack(makePack({channels:[]})).issues).includes('channel_count'));
 assert.ok(codes(pack.parseCopyPack(makePack({channels:['a','b','c','d','e'].map(n=>channel('채널 '+n,V3))})).issues).includes('channel_count'));
 const long=codes(pack.parseCopyPack(makePack({channels:[channel('Instagram 피드',[{...V3[0],hook:'가'.repeat(121)},{...V3[1],body:'나'.repeat(1201)},{...V3[2],cta:'다'.repeat(61)}])]})).issues);
 assert.ok(['hook_length','body_length','cta_length'].every(c=>long.includes(c)),JSON.stringify(long));
 assert.ok(codes(pack.parseCopyPack(makePack({channels:[channel('Instagram 피드',[{...V3[0],cta:'길찾기\n전화 주문'},V3[1],V3[2]])]})).issues).includes('cta_single'));
 assert.ok(codes(pack.parseCopyPack(makePack({version:'copy-pack-v1'})).issues).includes('copy_pack_version'));
 assert.equal(pack.parseCopyPack(makePack({version:'copy-pack-v1'})).pack,null);
 assert.ok(codes(pack.parseCopyPack(undefined).issues).includes('copy_pack_missing'));
 assert.ok(codes(pack.parseCopyPack('팩').issues).includes('copy_pack_missing'));
});
check('brief channels missing from the pack are warnings only',()=>{
 const {pack:p}=pack.parseCopyPack(makePack());
 const warn=plain(pack.briefChannelIssues(p,'Instagram, 당근마켓 동네생활'));
 assert.deepEqual(warn.map(i=>[i.level,i.code]),[['warn','brief_channel_missing']]);
 assert.ok(warn[0].message.includes('당근마켓'));
 assert.deepEqual(plain(pack.briefChannelIssues(p,'Instagram')),[]);
 assert.deepEqual(plain(pack.briefChannelIssues(p,'')),[]);
});
check('parsing keeps only known fields and does not mutate the input',()=>{
 const input=makePack({extra:'x',channels:[channel('Instagram 피드',V3.map(v=>({...v,secret:'y'})))]}),before=JSON.stringify(input);
 const {pack:p}=pack.parseCopyPack(input);
 assert.equal(JSON.stringify(input),before);
 assert.ok(!('extra' in p)&&p.channels[0].variants.every(v=>!('secret' in v)));
 assert.deepEqual(plain(p.channels[0].variants[0].needsCheck),['가격']);
 assert.ok(!('needsCheck' in p.channels[0].variants[1]));
});

// ── RED 5: v1 원문은 not_applicable ──
check('v1 outputs are not_applicable for copy_pack_variants',()=>{
 const fixture=JSON.parse(readFileSync('tests/fixtures/'+readdirSync('tests/fixtures').find(f=>/^role-submission-[0-9a-f]{7}\.json$/.test(f)),'utf8'));
 const items=[...fixture.cases.map((c,i)=>({id:'f'+i,kind:'role',role:c.role,raw:roleFixture(c.submission.input),contract:true})),{id:'t',kind:'role',role:'content',text:'## 게시 카피 3종과 용도·CTA\n\n저장 본문',contract:true},{id:'d',kind:'discussion',role:'content',fields:{position:'a',evidence:'b',challenge:'c',proposal:'d',respondsTo:[]}},{id:'i',kind:'input',text:'목표'}];
 assert.ok(fixture.cases.some(c=>c.role==='content'));
 for(const x of items)assert.equal(plain(graders.runGraders(x)).find(r=>r.id==='copy_pack_variants').status,'not_applicable',x.id);
});

// ── RED 6: 렌더본이 캡션 후보·사실 채점기에 들어간다 ──
check('rendered pack feeds copyBlocks and fact graders',()=>{
 const r=roleOutput.renderRoleOutput(rawV2(),'content',v2Contract);
 assert.deepEqual(errors(r.copyPackIssues||[]),[]);
 assert.ok(r.copyPack&&r.copyPack.channels[0].variants.length===3);
 const blocks=copyBlocks(r.content);
 for(const v of V3)assert.ok(blocks.some(b=>b.includes(v.hook)&&b.includes(v.body)&&b.includes(v.cta)),v.id+'\n'+blocks.join('\n---\n'));
 assert.ok(blocks.slice(0,3).every(b=>!/확인 필요|카피 안/.test(b)),blocks.slice(0,3).join('\n---\n'));
 assert.ok(r.content.indexOf('#### 카피 안 A')<r.content.indexOf(SECTIONS[0].content.slice(0,10)));
 assert.ok(/\| 0–3초 \|/.test(r.content)&&r.content.includes('실험 1: 훅 비교'));
 const facts={confirmed:[{key:'주소',value:'가상동 12'}],prohibited:[{key:'조리 방식',value:'숯불'}]};
 const burnt=makePack({channels:[channel('Instagram 피드',[{...V3[0],hook:'숯불 향 가득한 퇴근길 떡볶이'},V3[1],V3[2]])]});
 assert.equal(graded(rawV2(burnt),{facts}).fact_conflict.status,'fail');
 assert.notEqual(graded(rawV2(),{facts}).fact_conflict.status,'fail');
 assert.equal(graded(rawV2(burnt),{prohibitedTerms:['숯불']}).brief_prohibition_conflict.status,'fail');
 const popular=makePack({channels:[channel('Instagram 피드',[{...V3[0],body:'동네에서 가장 인기 있는 떡볶이를 포장해 가세요. 줄 서지 않고 받습니다.'},V3[1],V3[2]])]});
 assert.equal(graded(rawV2(popular),{facts:{confirmed:[],prohibited:[]}}).unsupported_claim_term.status,'fail');
});
// ── RED 7: 채점기는 원문의 계약 버전으로 렌더한다 ──
check('graders render v2 raw with the v2 contract',()=>{
 const g=graded(rawV2());
 assert.equal(g.contract_json.status,'pass',g.contract_json.detail);
 assert.equal(g.thin_section.status,'pass',g.thin_section.detail);
 assert.equal(g.heading_nesting.status,'pass',g.heading_nesting.detail);
 const body=text.bodyOf(item(rawV2()));
 assert.ok(body.startsWith('## 게시 카피 3종과 용도·CTA')&&body.includes('#### 카피 안 A')&&body.includes(V3[1].hook),body.slice(0,200));
 assert.equal(plain(roleOutput.rawOutputContract(rawV2(),'content')).version,'role-output-v2');
 assert.equal(plain(roleOutput.rawOutputContract(roleFixture(JSON.stringify({task:{role:'content',outputContract:roleOutput.roleOutputContract('content')}})),'content')).version,'role-output-v1');
 assert.equal(plain(roleOutput.rawOutputContract('not json','content')).version,'role-output-v1');
 assert.throws(()=>roleOutput.renderRoleOutput(rawV2(),'content',roleOutput.roleOutputContract('content')),/계약 버전/);
});
check('pack format problems are soft: the render keeps the sections and reports issues',()=>{
 const missing=roleOutput.renderRoleOutput(rawV2(undefined),'content',v2Contract);
 assert.ok(codes(missing.copyPackIssues).includes('copy_pack_missing')&&!missing.copyPack&&missing.content.includes(SECTIONS[1].content.slice(0,12)));
 assert.equal(graded(rawV2(undefined)).copy_pack_variants.status,'fail');
 const broken=roleOutput.renderRoleOutput(rawV2({version:'copy-pack-v2',channels:'x',shortform:7,experiments:null}),'content',v2Contract);
 assert.ok(errors(broken.copyPackIssues).length>0&&broken.copyPack);
 const v1=roleOutput.renderRoleOutput(roleFixture(JSON.stringify({task:{role:'content',outputContract:roleOutput.roleOutputContract('content')}})),'content',roleOutput.roleOutputContract('content'));
 assert.ok(!('copyPack' in v1)&&!('copyPackIssues' in v1));
 assert.equal(graded(rawV2()).copy_pack_variants.detail.includes('1채널'),true);
});
check('copy_pack_variants is a content grader registered once and the version names it',()=>{
 const ids=graders.GRADERS.map(g=>g.id);
 assert.equal(ids.filter(id=>id==='copy_pack_variants').length,1);
 assert.ok(graders.CONTENT_GRADERS.includes('copy_pack_variants'));
 assert.ok(graders.GRADERS_VERSION.endsWith('+copy-pack'));
 const reask='요청하신 과업이 지정되지 않았습니다. 다음 중 원하시는 작업을 선택해 주세요.\n1. 초안 검수\n2. 요약';
 const r=plain(graders.runGraders(item(JSON.stringify({contractVersion:'role-output-v2',role:'content',sections:SECTIONS.map(s=>({...s,content:reask}))}))));
 assert.equal(r.find(x=>x.id==='question_only').status,'fail');assert.equal(r.find(x=>x.id==='copy_pack_variants').status,'not_applicable');
});

// ── 지시문 ──
check('the v2 instruction adds the pack schema only for the content copy pack profile',()=>{
 const base=instruction.buildRoleInstruction({role:'content'}),v2=instruction.buildRoleInstruction({role:'content',outputProfile:'copy-pack-v2'});
 assert.ok(!base.includes('copyPack')&&!base.includes('role-output-v2'));
 assert.ok(v2.includes('"role-output-v2"')&&v2.includes('copyPack')&&v2.includes(pack.copyPackInstruction));
 assert.ok(v2.startsWith(base.slice(0,base.indexOf('JSON 한 개만'))));
 assert.equal(instruction.buildRoleInstruction({role:'cmo',outputProfile:'copy-pack-v2'}),instruction.buildRoleInstruction({role:'cmo'}));
 assert.ok(/3~5/.test(pack.copyPackInstruction)&&/share_rate/.test(pack.copyPackInstruction)&&/짧게/.test(pack.copyPackInstruction));
});
check('the request plan carries the v2 contract only for content with the profile',()=>{
 const req=(role,extra={})=>({role,campaign:{version:1},previous:[],...extra});
 assert.equal(instruction.roleRequestPlan(req('content',{outputProfile:'copy-pack-v2'})).outputContract.version,'role-output-v2');
 assert.equal(instruction.roleRequestPlan(req('content')).outputContract.version,'role-output-v1');
 assert.equal(instruction.roleRequestPlan(req('growth',{outputProfile:'copy-pack-v2'})).outputContract.version,'role-output-v1');
});
check('registry bodies cannot claim the code-owned copyPack contract',()=>{
 for(const body of ['카피 팩은 copyPack 필드로 쓴다.','copy pack 형식을 지킨다.'])assert.throws(()=>units.validateUnitBody('channel.shortform',body),e=>e.reason==='code_owned',body);
});
console.log(JSON.stringify({passed:passed.length}));
