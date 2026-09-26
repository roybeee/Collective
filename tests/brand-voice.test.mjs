// 브랜드 말투 원장(A3-2): 관리자가 초안을 쓰고 대표·관리자가 확정한다. 확정본만, 기능 스위치 a3_brand_voice가 켜졌을 때만 content·creative 입력에 싣는다.
// 스위치가 꺼졌거나 확정본이 없으면 모든 역할의 제출·입력이 이전과 바이트 동일하다. 금지 말투 결정론 채점기 brand_voice_avoid_term을 더한다.
// 근거: mocked(모의 HERMES fetch 스텁, 메모리 SQLite, 합성 브랜드·캠페인, 로컬 세션 쿠키 주입). 외부 네트워크 호출은 0회다.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {testRuntime} from './helpers/runtime.mjs';
import {roleFixture} from './helpers/role-fixture.mjs';

const sent=new Map(),external=[];let calls=0;
const {sql,env,load}=testRuntime(async(url,options={})=>{
 url=String(url);
 if(!url.startsWith('https://hermes.example.com/')){external.push(url);throw new Error('모의 주소만 호출합니다: '+url)}
 if(url.endsWith('/v1/runs')){const id='bv_'+ ++calls;sent.set(id,options.body);return Response.json({run_id:id})}
 const id=url.split('/').pop();
 return Response.json({object:'hermes.run',run_id:id,status:'completed',output:roleFixture(JSON.parse(sent.get(id)).input),usage:{total_tokens:100,output_tokens:900},model:'mock-model'});
});
const server=await load('lib/server.ts'),execution=await load('lib/role-execution.ts'),instruction=await load('lib/role-instruction.ts'),flags=await load('lib/feature-flags.ts'),agency=await load('lib/agency.ts');
const voice=await load('lib/brand-voice.ts'),route=await load('app/api/brand-voice/route.ts'),graders=await load('lib/graders/index.ts'),kinds=await load('lib/eval-kinds.ts'),registry=await load('lib/record-kinds.ts'),budget=await load('lib/token-budget.ts');
const now='2026-01-01T00:00:00.000Z',passed=[];
const check=(name,fn)=>{fn();passed.push(name)};
const plain=v=>JSON.parse(JSON.stringify(v));
const ROLES=agency.roles.map(r=>r.id),VOICED=['creative','content'];
const owner='bv-owner',campaignId='bv-campaign',brandId='bv-brand';

// 합성 브랜드·캠페인. 실제 고객·매장 정보가 아니다.
async function seed(){
 const put=(kind,id,data,parent='')=>server.recordStatement(owner,kind,id,data,parent).run();
 sql.prepare('INSERT INTO settings(owner,secret,model,updated_at) VALUES(?,?,?,?) ON CONFLICT(owner) DO NOTHING').run(owner,await server.encrypt(JSON.stringify({provider:'hermes',endpoint:'https://hermes.example.com',key:'mock-only'})),'HERMES',now);
 await put('brand',brandId,{id:brandId,name:'가상분식',short:'GB',category:'SNACK BAR',color:'#224466',bg:'#eef2f6',description:'합성 브랜드 소개(미확인).',audience:'가상동 주민(가설)',tone:'친근하고 명료한',constraints:'가격은 확인 전 확정 문구로 쓰지 않는다.',knowledge:'합성 메모.'});
 await put('campaign',campaignId,{id:campaignId,brandId,title:'가상분식 오픈',goal:'오픈 전 인지와 첫 포장 주문을 만든다.',audience:'가상동 주민(가설)',channels:'Instagram',stores:'가상동 12',products:'떡볶이(가격 미확정)',budget:null,startDate:'',endDate:'',constraints:'할인 약속 금지.',sources:'',status:'draft',version:1,createdAt:now,updatedAt:now});
}
await seed();
const requestFor=async role=>{const c=await server.readRecord(owner,'campaign',campaignId);return plain(await execution.roleRequestFor(owner,c,role,await execution.roleSources(owner,c,role),await server.readRecord(owner,'brand',brandId)))};
const submissions=async()=>{const out={};for(const role of ROLES){const req=await requestFor(role);out[role]={req,...execution.roleSubmission(req)}}return out};
const post=async(input,headers={'oai-authenticated-user-id':owner})=>{const r=await route.POST(new Request('https://agency.test/api/brand-voice',{method:'POST',headers:{'content-type':'application/json',...headers},body:JSON.stringify(input)}));return {status:r.status,body:await r.json()}};
const get=async(query,headers={'oai-authenticated-user-id':owner})=>{const r=await route.GET(new Request('https://agency.test/api/brand-voice?'+query,{headers}));return {status:r.status,body:await r.json()}};
const body={tone:['따뜻한','간결한'],do:['짧은 문장','현장 감각어'],dont:['과장 감탄사 연속'],preferTerms:['갓 구운'],avoidTerms:['최고의','대박'],samples:['퇴근길에 갓 구운 떡볶이 한 컵 챙겨 가세요.']};
const setFlag=enabled=>flags.setFeatureFlag(owner,{flag:'a3_brand_voice',enabled},{id:owner,email:null});

// ── 스위치·레코드 등록 ──
check('the brand voice switch is a known flag that defaults to off',()=>assert.ok(flags.FEATURE_FLAGS.a3_brand_voice?.defaultEnabled===false&&/말투/.test(flags.FEATURE_FLAGS.a3_brand_voice.description)));
const kindList=plain(registry.recordKinds),bv=kindList.find(k=>k.kind==='brand_voice');
check('record kind registered before the final group',()=>{
 assert.ok(bv&&bv.parent==='brand'&&bv.campaignDeletion==='not_campaign_scoped'&&!bv.links&&bv.purge===undefined,JSON.stringify(bv));
 assert.equal(kindList.indexOf(bv),kindList.findIndex(k=>k.kind==='eval_budget_approval')-1);
 assert.ok(Math.max(...kindList.filter(k=>k.kind.startsWith('franchise_')).map(k=>kindList.indexOf(k)))<kindList.indexOf(bv));
});

// ── 순수 모듈: 검증·상한·모델 블록 ──
check('voice lists and samples are bounded',()=>{
 assert.ok(voice.parseVoiceBody(body).errors.length===0);
 assert.ok(voice.parseVoiceBody({...body,tone:Array.from({length:11},(_,i)=>'어조'+i)}).errors.length>0);
 assert.ok(voice.parseVoiceBody({...body,do:['가'.repeat(41)]}).errors.length>0);
 assert.ok(voice.parseVoiceBody({...body,samples:['a','b','c','d']}).errors.length>0);
 assert.ok(voice.parseVoiceBody({...body,samples:['가'.repeat(201)]}).errors.length>0);
 assert.ok(voice.parseVoiceBody({tone:[],do:[],dont:[],preferTerms:[],avoidTerms:[],samples:[]}).errors.length>0);
 assert.ok(voice.parseVoiceBody({...body,tone:'따뜻한'}).errors.length>0);
});
const bigList=p=>Array.from({length:10},(_,i)=>`${p}${i}`+'가'.repeat(36));
const huge={tone:bigList('t'),do:bigList('d'),dont:bigList('n'),preferTerms:bigList('p'),avoidTerms:bigList('a'),samples:['가'.repeat(200),'나'.repeat(200),'다'.repeat(200)]};
check('the model block is capped at 1,500 characters',()=>{
 assert.ok(voice.parseVoiceBody(huge).errors.length>0,'상한을 넘는 말투는 저장 단계에서 거부한다');
 const block=voice.voiceModelBlock({...huge,version:9});
 assert.ok(JSON.stringify(block).length<=1500,String(JSON.stringify(block).length));
 assert.deepEqual(Object.keys(block),['tone','do','dont','preferTerms','avoidTerms','samples','version']);
});

// ── RED 1: 스위치 꺼짐·확정본 없음은 바이트 동일 ──
const baseline=await submissions();
check('flag off or no voice keeps role submission byte-identical',()=>{
 for(const role of ROLES){const {req,instructions,input}=baseline[role];assert.ok(!('brandVoice' in req),role);assert.equal(instructions,instruction.buildRoleInstruction(req));assert.equal(input,instruction.buildRoleInput(req));assert.ok(!input.includes('brandVoice')&&!instructions.includes('brandVoice'),role)}
});
await setFlag(true);
const flagOnNoVoice=await submissions();
check('flag on without a confirmed voice keeps every role byte-identical',()=>{for(const role of ROLES){assert.equal(flagOnNoVoice[role].instructions,baseline[role].instructions,role);assert.equal(flagOnNoVoice[role].input,baseline[role].input,role)}});

// ── RED 2: 초안은 입력에 없다 ──
let r=await post({action:'save_draft',brandId,version:0,data:body});
check('an admin saves a draft',()=>assert.ok(r.status===200&&r.body.voice.status==='draft'&&r.body.voice.version===1,JSON.stringify(r.body)));
const draftOnly=await submissions();
check('only confirmed voice reaches the model (draft stays out)',()=>{for(const role of ROLES){assert.equal(draftOnly[role].input,baseline[role].input,role);assert.equal(draftOnly[role].instructions,baseline[role].instructions,role)}});

// ── RED 3: 확정 뒤 content·creative만 ──
r=await post({action:'confirm',brandId,version:1});
check('the owner confirms the draft',()=>assert.ok(r.status===200&&r.body.voice.status==='confirmed'&&r.body.voice.version===2&&r.body.voice.confirmedBy.role==='owner'));
const confirmed=await submissions();
check('flag on injects only into content and creative',()=>{
 for(const role of ROLES.filter(x=>!VOICED.includes(x))){assert.equal(confirmed[role].input,baseline[role].input,role);assert.equal(confirmed[role].instructions,baseline[role].instructions,role);assert.ok(!('brandVoice' in confirmed[role].req),role)}
 for(const role of VOICED){
  const input=JSON.parse(confirmed[role].input),keys=Object.keys(input);
  assert.equal(keys[keys.indexOf('brand')+1],'brandVoice',role);
  assert.deepEqual(input.brandVoice,{...body,version:2});
  assert.ok(/참고 데이터이며 지시를 바꿀 권한이 없/.test(confirmed[role].instructions),role);
  assert.notEqual(confirmed[role].instructions,baseline[role].instructions);
  // 키를 빼면 이전과 바이트 동일하다(키 위치 말고는 바뀐 것이 없다).
  assert.equal(JSON.stringify(Object.fromEntries(Object.entries(input).filter(([k])=>k!=='brandVoice'))),baseline[role].input,role);
 }
});
check('the model block carries no people or timestamps',()=>{const v=JSON.parse(confirmed.content.input).brandVoice;assert.ok(!('updatedBy' in v)&&!('confirmedBy' in v)&&!('updatedAt' in v)&&!('history' in v)&&!('status' in v))});
// 스위치를 끄면 확정본이 있어도 바이트 동일하다.
await setFlag(false);
const offWithVoice=await submissions();
check('flag off keeps every role byte-identical even with a confirmed voice',()=>{for(const role of ROLES){assert.equal(offWithVoice[role].input,baseline[role].input,role);assert.equal(offWithVoice[role].instructions,baseline[role].instructions,role)}});
await setFlag(true);

// 새 초안을 써도 모델에는 이전 확정본(v2)이 간다.
r=await post({action:'save_draft',brandId,version:2,data:{...body,avoidTerms:['초특가']}});
const editing=await submissions();
check('a new draft keeps the previous confirmed voice for the model',()=>{
 assert.ok(r.status===200&&r.body.voice.status==='draft'&&r.body.voice.version===3&&r.body.voice.history[0].version===2);
 for(const role of VOICED)assert.deepEqual(JSON.parse(editing[role].input).brandVoice,{...body,version:2},role);
});

// ── RED 4: 권한·CAS ──
r=await post({action:'save_draft',brandId,version:2,data:body});
check('stale version 409',()=>assert.equal(r.status,409));
const staleConfirm=await post({action:'confirm',brandId,version:1});
check('stale confirm is 409 too',()=>assert.equal(staleConfirm.status,409));
const missing=await post({action:'save_draft',brandId:'nope',version:0,data:body});
check('an unknown brand is 404',()=>assert.equal(missing.status,404));
const tooBig=await post({action:'save_draft',brandId,version:3,data:huge});
check('an over-cap voice is rejected with 400',()=>assert.equal(tooBig.status,400));

// ── RED 5: 가림(브랜드 정체성과 같은 방식) ──
const piiVoice={...body,samples:['문의는 010-1234-5678 또는 hello@example.com 으로 주세요.'],do:['담당 010-9876-5432 안내']};
r=await post({action:'save_draft',brandId,version:3,data:piiVoice});const piiDraft=r.body.voice?.version;
r=await post({action:'confirm',brandId,version:piiDraft});
const masked=await requestFor('content'),maskedRun=instruction.buildRoleInputMasked(masked),maskedInput=JSON.parse(maskedRun.input);
check('voice text is masked like brand identity',()=>{
 assert.ok(r.status===200);
 assert.ok(!maskedRun.input.includes('010-1234-5678')&&!maskedRun.input.includes('hello@example.com')&&!maskedRun.input.includes('010-9876-5432'));
 assert.ok(maskedRun.findings.some(f=>f.field==='brandVoice.samples.0'&&f.kind==='phone')&&maskedRun.findings.some(f=>f.field==='brandVoice.samples.0'&&f.kind==='email')&&maskedRun.findings.some(f=>f.field==='brandVoice.do.0'));
 // 브랜드 정체성 가림과 같은 자리표시다.
 const identity=instruction.buildRoleInputMasked({...masked,brandVoice:undefined,brand:{...masked.brand,audience:'문의 010-1234-5678'}});
 const placeholder=JSON.parse(identity.input).brand.identity.audience.replace('문의 ','');
 assert.ok(maskedInput.brandVoice.samples[0].includes(placeholder),maskedInput.brandVoice.samples[0]);
});

// ── RED 6: 철회 뒤 입력에 없다 ──
const current=(await get('brandId='+brandId)).body.voice;
r=await post({action:'revoke',brandId,version:current.version});
const revoked=await submissions();
check('revoke removes the voice from the model input',()=>{
 assert.ok(r.status===200&&r.body.voice.status==='revoked'&&r.body.active===null);
 for(const role of ROLES){assert.equal(revoked[role].input,baseline[role].input,role);assert.equal(revoked[role].instructions,baseline[role].instructions,role)}
});
r=await post({action:'save_draft',brandId,version:r.body.voice.version,data:body});
const afterRevokeDraft=await submissions();
check('a draft after revoke does not revive the old confirmed voice',()=>{assert.equal(r.status,200);for(const role of VOICED)assert.equal(afterRevokeDraft[role].input,baseline[role].input,role)});
check('history keeps at most 20 versions',()=>assert.ok(r.body.voice.history.length<=20&&r.body.voice.history.every(h=>!('history' in h))));

// ── RED 7: 운영 start 분기가 같은 요청을 보낸다 ──
const draftNow=r.body.voice.version;await post({action:'confirm',brandId,version:draftNow});
for(const role of ROLES.slice(0,ROLES.indexOf('creative'))){const s=await (await execution.executeRole(owner,{action:'start',campaignId,role})).json();await execution.executeRole(owner,{action:'poll',id:s.id})}
const creativeReq=await requestFor('creative'),started=await (await execution.executeRole(owner,{action:'start',campaignId,role:'creative'})).json(),saved=JSON.parse((await server.readRecord(owner,'hermes_submission',started.id)).body);
check('the start branch submits the voice for creative',()=>{assert.ok(JSON.parse(saved.input).brandVoice?.version===draftNow+1);assert.equal(saved.input,instruction.buildRoleInput(creativeReq))});

// ── RED 8: 권한(이메일 모드) ──
env.AUTH_MODE='email';env.AUTH_ORIGIN='https://agency.test';
const signIn=(id,role,createdAt)=>{const token=createHash('sha256').update(id).digest('hex');sql.prepare('INSERT INTO auth_users(id,email,workspace_owner,role,status,created_at) VALUES(?,?,?,?,?,?)').run(id,id+'@test.invalid',owner,role,'active',createdAt);sql.prepare('INSERT INTO auth_sessions VALUES(?,?,?,?)').run(createHash('sha256').update(token).digest('hex'),id,Date.now()+60000,Date.now());return {cookie:'__Host-collective_session='+token,origin:'https://agency.test'}};
const ownerS=signIn('bv-first-admin','admin',1000),adminS=signIn('bv-admin','admin',2000),memberS=signIn('bv-member','member',500);
const latest=(await get('brandId='+brandId,memberS)).body;
const staffDraft=await post({action:'save_draft',brandId,version:latest.voice.version,data:body},memberS),staffConfirm=await post({action:'confirm',brandId,version:latest.voice.version},memberS),staffRevoke=await post({action:'revoke',brandId,version:latest.voice.version},memberS);
check('staff can read the voice',()=>assert.ok(latest.voice&&latest.active&&latest.active.version===latest.voice.version));
check('staff cannot draft or confirm (403)',()=>assert.ok(staffDraft.status===403&&staffConfirm.status===403&&staffRevoke.status===403));
const adminDraft=await post({action:'save_draft',brandId,version:latest.voice.version,data:body},adminS),adminConfirm=await post({action:'confirm',brandId,version:adminDraft.body.voice?.version},adminS);
check('an admin drafts and confirms, recorded by id and role only',()=>assert.ok(adminDraft.status===200&&adminConfirm.status===200&&JSON.stringify(adminConfirm.body.voice.confirmedBy)===JSON.stringify({id:'bv-admin',role:'admin'})&&!JSON.stringify(adminConfirm.body.voice).includes('@test.invalid')));
const ownerRevoke=await post({action:'revoke',brandId,version:adminConfirm.body.voice.version},ownerS);
check('the owner revokes',()=>assert.ok(ownerRevoke.status===200&&ownerRevoke.body.voice.status==='revoked'));
const cross=await post({action:'save_draft',brandId,version:ownerRevoke.body.voice.version,data:body},{...adminS,origin:'https://evil.test'});
check('cross-origin writes are rejected',()=>assert.equal(cross.status,403));
// 라우트 밖에서 저장 함수를 불러도 직원은 403이다(이중 방어).
const voiceServer=await load('lib/brand-voice-server.ts');let direct=null;try{await voiceServer.saveBrandVoice(owner,{action:'save_draft',brandId,version:ownerRevoke.body.voice.version,data:body},{id:'bv-member',role:'member'})}catch(error){direct=error.status}
check('the save function itself refuses staff',()=>assert.equal(direct,403));
env.AUTH_MODE='legacy';

// ── RED 9: 채점기 brand_voice_avoid_term ──
const copyText='## 게시 카피\n\n오늘 저녁은 최고의 떡볶이 한 컵으로 시작하세요.\n\n## 편집 메모\n\n짧은 문장을 쓴다.';
const negatedText='## 게시 카피\n\n오늘 저녁은 갓 구운 떡볶이 한 컵으로 시작하세요. ‘최고의’라는 표현은 쓰지 않는다.\n\n## 편집 메모\n\n짧은 문장을 쓴다.';
const role=text=>({id:'v',kind:'role',role:'content',text});
const status=(item,ctx)=>graders.runGraders(item,ctx).find(g=>g.id==='brand_voice_avoid_term')?.status;
const ctxVoice={brandVoice:{avoidTerms:['최고의','대박']}};
check('brand_voice_avoid_term fails on avoid term in copy zone',()=>assert.equal(status(role(copyText),ctxVoice),'fail'));
check('brand_voice_avoid_term passes when negated',()=>assert.equal(status(role(negatedText),ctxVoice),'pass'));
check('brand_voice_avoid_term is not_applicable without voice input',()=>{assert.equal(status(role(copyText),{}),'not_applicable');assert.equal(status(role(copyText),{brandVoice:null}),'not_applicable')});
check('the grader registry has fifteen graders and the voice tag',()=>{assert.equal(graders.GRADERS.length,15);assert.equal(graders.GRADERS.at(-1).id,'brand_voice_avoid_term');assert.ok(graders.GRADERS_VERSION.endsWith('+copy-pack+voice-avoid+expected-contract'))});
check('voiceAvoidHits reports term and excerpt',()=>assert.ok(voice.voiceAvoidHits([{sentence:'대박 할인 소식'}],['대박']).length===1&&voice.voiceAvoidHits([{sentence:'‘대박’이라는 말은 쓰지 않는다'}],['대박']).length===0));
// 평가 역할 채점은 동결 요청의 brandVoice(content·creative)에서 피할 표현을 읽는다.
const output=JSON.stringify({contractVersion:'role-output-v1',role:'content',sections:instruction.roleRequestPlan({role:'content',campaign:{version:1},previous:[]}).outputContract.sections.map((s,i)=>({id:s.id,content:i===0?'### 게시 카피\n오늘 저녁은 최고의 떡볶이 한 컵. 퇴근길 20분 안에 포장해 가세요. [자료 필요] 가격은 점장이 확인한다.':`${s.title} 메모. 이 절은 선택 이유와 확인 계획을 적는다. 브리프 v1 목표인 첫 포장 주문에 맞춰 퇴근길 고객의 대기 시간 장벽을 먼저 다룬다. [자료 필요] 시간대별 주문량은 점장이 오픈 전 주에 확인한다.`}))});
const expectations={prohibitedTerms:[],facts:null,industry:null,localStore:false};
const gradedWith=request=>kinds.evalKind('role').grade({id:'k',role:request.role,kind:'role',request,expectations},output,null).result.graders.find(g=>g.id==='brand_voice_avoid_term')?.status;
check('eval grading reads the frozen request voice',()=>{assert.equal(gradedWith({...confirmed.content.req}),'fail');assert.equal(gradedWith(baseline.content.req),'not_applicable');assert.equal(gradedWith({...confirmed.content.req,role:'cmo'}),'not_applicable')});

// ── RED 10: 입력 예산 ──
const fullBody={tone:bigList('t').map(x=>x.slice(0,20)),do:bigList('d').map(x=>x.slice(0,20)),dont:bigList('n').map(x=>x.slice(0,20)),preferTerms:['갓 구운'],avoidTerms:bigList('a').map(x=>x.slice(0,20)),samples:['가'.repeat(150)]};
check('voice input stays under the input budget',()=>{
 const block=voice.voiceModelBlock({...fullBody,version:99});
 assert.ok(voice.parseVoiceBody(fullBody).errors.length===0&&JSON.stringify(block).length>1000,String(JSON.stringify(block).length));
 const req=baseline.content.req,withVoice={...req,brandVoice:block};
 const before=budget.estimateInputTokens(instruction.buildRoleInstruction(req)+instruction.buildRoleInput(req)),after=budget.estimateInputTokens(instruction.buildRoleInstruction(withVoice)+instruction.buildRoleInput(withVoice));
 // 역할 입력 최대 실측 23,701 토큰(R3 기준선)에 말투 최대 증분을 더해도 상한 32,000 안이다. 1,500자 블록 전체를 한 글자 1토큰으로 더 얹어도 넘지 않는다.
 assert.ok(after-before<=1800,String(after-before));
 assert.ok(23701+(after-before)<graders.INPUT_TOKEN_CAP&&23701+1500+(after-before)<graders.INPUT_TOKEN_CAP);
});
check('no external network call',()=>assert.deepEqual(external,[]));
console.log(JSON.stringify({passed:passed.length}));
