// 레인 A 입력 최소화(docs/INPUT-MINIMIZATION.ko.md): 제작 경로(역할·회의·브리프)의 HERMES 제출 본문이
// ① 회의 작업물 허용 목록 ④ 담당자 필드 자리표시 ⑤ 브랜드 정체성 허용 목록(intake 제외) ③ 자유 텍스트 가림(허용: 확정 사실·지점 주소·사업장 전화)을 지키고,
// 가림 기록(필드·종류·건수)만 남기며, 저장본=전송본=복구 재전송본이고, 합성 개인정보가 DB 파생 기록·전송 본문·콘솔에 남지 않는지 본다.
// 근거: mocked(모의 HERMES fetch 스텁, 메모리 SQLite, 합성 데이터). 외부 네트워크 호출 0회. 모든 번호·주소·이름은 합성이다.
import assert from 'node:assert/strict';
import {testRuntime} from './helpers/runtime.mjs';
import {mockHermes} from './helpers/prompt-seed.mjs';

const posted=[];
const hermes=mockHermes(async(url,options)=>{if(url.endsWith('/v1/runs'))posted.push(options.body)});
const {sql,load}=testRuntime(hermes.fetch);
const server=await load('lib/server.ts'),role=await load('lib/role-execution.ts'),meeting=await load('lib/meeting-execution.ts'),brief=await load('lib/brief-execution.ts'),agency=await load('lib/agency.ts'),briefLib=await load('lib/brief.ts');
const owner='min-owner',now='2026-01-01T00:00:00.000Z',passed=[];
const check=(name,fn)=>{fn();passed.push(name)};
const put=(kind,id,data,parent='')=>server.recordStatement(owner,kind,id,data,parent).run();
// 콘솔 출력(DP-4): 실행 중 모든 console 출력을 모은다.
const logged=[];for(const k of ['log','warn','error','info','debug']){const orig=console[k].bind(console);console[k]=(...a)=>{logged.push(a.map(String).join(' '));orig(...a)}}

// 합성 개인정보(허용 목록 밖). 모두 가려져야 하고 파생 기록·전송 본문에 남으면 안 된다.
const PHONE=n=>`010-0000-04${n}`;
const PERSON='가상 담당자 김가상';
const secrets=[...Array.from({length:12},(_,i)=>PHONE(17+i)),'synthetic.owner@example.com','synthetic.src@example.com','synthetic.edit@example.com','가상로 77',PERSON];
// 허용 목록 값: 확정 사실(지점 주소·사업장 전화)과 지점 레코드 주소. 가리지 않는다.
const STORE_ADDRESS='가상동 12 B동 201호',STORE_PHONE='02-000-0000';

await sql.prepare('INSERT INTO settings(owner,secret,model,updated_at) VALUES(?,?,?,?)').run(owner,await server.encrypt(JSON.stringify({provider:'hermes',endpoint:'https://hermes.example.com',key:'mock-only'})),'HERMES',now);
await put('worker_credential','current',{id:'current',tokenHash:'fixture'});
const brand={id:'min-brand',name:'가상분식',short:'GB',category:'SNACK BAR',color:'#224466',bg:'#eef2f6',description:`합성 소개: 대표 번호 ${PHONE(17)}`,audience:'가상로 77 인근 직장인(가설)',tone:'친근한',constraints:'가격은 확인 전 확정하지 않는다.',knowledge:'합성 메모: 문의 synthetic.owner@example.com',intake:{website:'https://example.com/min',socialLinks:'@synthetic_min',market:'가상시',clientNeed:`의뢰 담당 ${PHONE(18)}`,competitors:'가상 경쟁점'}};
await put('brand',brand.id,brand);
const store={id:'min-store',brandId:brand.id,name:'가상점',address:STORE_ADDRESS,tradeArea:'residential',customer:'가상동 주민',goal:'재방문',daypart:'저녁',menu:'떡볶이',hours:'11:00-21:00',access:`문의 ${STORE_PHONE}`,capacity:'12석',economics:'객단가 12,000원',competitors:'',status:'active',version:1,createdAt:now,updatedAt:now};
await put('store',store.id,store,brand.id);
await put('store_diagnostic','min-store-customer',{id:'min-store-customer',storeId:store.id,key:'customer',status:'todo',observation:'합성 관찰',evidence:'',checkedAt:'',nextAction:'합성 다음 행동',assignee:PERSON,storeVersion:1,version:1,updatedAt:now},store.id);
const fact=(id,key,value,storeId)=>put('brand_fact',id,{id,brandId:brand.id,...(storeId?{storeId}:{}),key,value,status:'confirmed',source:'합성 원장',verifiedAt:now,validUntil:'2099-12-31T00:00:00.000Z',version:1,updatedAt:now},brand.id);
await fact('min-fact-address','주소',STORE_ADDRESS,store.id);
await fact('min-fact-phone','전화',STORE_PHONE);
const plan={...briefLib.emptyPlan(),owner:PERSON,kpi:'첫 포장 주문 30건/주, 전환율 3.2%, 2026-09-24 기준'};
const campaign=(id,extra={})=>({id,brandId:brand.id,title:'가상분식 오픈',goal:`${STORE_ADDRESS} 오픈. 예약 문의 ${PHONE(19)}`,audience:'가상동 주민',channels:'Instagram',stores:`가상점 · ${STORE_ADDRESS}`,products:'떡볶이 12,000원',budget:null,startDate:'',endDate:'',constraints:`매장 전화 ${STORE_PHONE} 안내`,sources:'메일 synthetic.src@example.com',plan,status:'draft',version:1,createdAt:now,updatedAt:now,...extra});
for(const c of [campaign('min-a',{storeId:store.id}),campaign('min-b'),campaign('min-c'),campaign('min-d',{storeId:store.id}),campaign('min-e')])await put('campaign',c.id,c);
for(const c of ['min-a','min-b','min-c','min-d','min-e'])await put('campaign_directive','dir-'+c,{id:'dir-'+c,campaignId:c,text:`고객 ${PHONE(20)} 에게는 연락하지 않는다.`,createdAt:now,createdBy:{id:'synthetic-member',email:'synthetic.member@example.com',role:'member'}},c);
const artifact=(campaignId,r,extra={})=>({id:`${campaignId}-${r}`,campaignId,campaignVersion:1,role:r,title:'합성 '+r,content:`## 합성 ${r}\n조건부 초안입니다. 자료 필요: 운영 조건 확인.`,version:1,status:'review',origin:'ai',createdAt:now,...extra});
const body=async id=>JSON.parse((await server.readRecord(owner,'hermes_submission',id)).body);
const inputOf=async id=>JSON.parse((await body(id)).input);
const start=async(campaignId,r,extra={})=>{const res=await (await role.executeRole(owner,{action:'start',campaignId,role:r,...extra})).json();assert.ok(res.id,`${r} 시작 실패: ${JSON.stringify(res)}`);return res.id};
const noSecret=(text,where)=>{for(const s of secrets)assert.ok(!String(text).includes(s),`${where}에 합성 개인정보가 남았습니다`)};

// ── 역할(A1): 브랜드 허용 목록, 캠페인 자유 텍스트, 상시 지시, 담당자, 점포 맥락, 허용 목록 ──
const aId=await start('min-a','cmo');const a=await inputOf(aId);
check('role brand input is identity + brandIntro only (intake excluded)',()=>{assert.deepEqual(Object.keys(a.brand),['identity','brandIntro']);assert.deepEqual(Object.keys(a.brand.identity).sort(),['audience','category','color','constraints','name','short','tone'])});
check('role brandIntro is masked (phone, email)',()=>{assert.ok(a.brand.brandIntro.text.includes('[전화번호]')&&a.brand.brandIntro.text.includes('[이메일]'));noSecret(a.brand.brandIntro.text,'brandIntro')});
check('role identity audience is masked',()=>assert.equal(a.brand.identity.audience,'[주소] 인근 직장인(가설)'));
check('role identity constraints without detection are verbatim',()=>assert.equal(a.brand.identity.constraints,brand.constraints));
check('role campaign goal masks the phone and keeps the allowed store address',()=>assert.equal(a.campaign.goal,`${STORE_ADDRESS} 오픈. 예약 문의 [전화번호]`));
check('role campaign keeps allowed business phone (confirmed fact)',()=>assert.equal(a.campaign.constraints,`매장 전화 ${STORE_PHONE} 안내`));
check('role campaign sources email masked',()=>assert.equal(a.campaign.sources,'메일 [이메일]'));
check('role campaign prices and KPI text are verbatim',()=>{assert.equal(a.campaign.products,'떡볶이 12,000원');assert.equal(a.campaign.plan.kpi,plan.kpi)});
check('role plan.owner becomes the role placeholder',()=>assert.equal(a.campaign.plan.owner,'[담당자]'));
check('role directive text masked, author kept',()=>assert.deepEqual(a.evidence.directives,[{text:'고객 [전화번호] 에게는 연락하지 않는다.',author:'직원'}]));
check('role confirmed facts are sent verbatim',()=>assert.deepEqual(a.evidence.facts.confirmed.map(f=>f.value).sort(),[STORE_PHONE,STORE_ADDRESS].sort()));
check('role store context keeps store record and replaces diagnosis assignee',()=>{const sm=a.brandArchive.storeMarketing;assert.equal(sm.store.address,STORE_ADDRESS);assert.equal(sm.store.access,`문의 ${STORE_PHONE}`);assert.equal(sm.operations.diagnostics[0].assignee,'[담당자]')});
check('role input carries no synthetic personal data',()=>noSecret(JSON.stringify(a),'역할 입력'));
const contractA=await server.readRecord(owner,'role_output_contract',aId);
check('role masking record has field, kind and count only',()=>{assert.ok(Array.isArray(contractA.inputMasking));assert.ok(contractA.inputMasking.some(f=>f.field==='campaign.goal'&&f.kind==='phone'&&f.count===1));assert.ok(contractA.inputMasking.some(f=>f.field==='brand.brandIntro.text'&&f.kind==='email'));assert.ok(contractA.inputMasking.every(f=>Object.keys(f).sort().join()==='count,field,kind'));noSecret(JSON.stringify(contractA),'역할 계약')});
await (await role.executeRole(owner,{action:'poll',id:aId})).json();

// ── 역할 재작성: 검토 메모(reviewNote)·직전 발췌(사람 수정본) 가림 ──
await put('artifact','min-b-cmo',artifact('min-b','cmo',{status:'revision',origin:'ai_edited',reviewNote:`CS 메모: 고객 ${PHONE(21)} 요청 반영`,content:`## 수정본\n고객 ${PHONE(22)} 의견을 반영한 조건부 초안입니다.`}),'min-b');
const bId=await start('min-b','cmo',{repairId:'min-b-cmo',repairVersion:1});const b=await inputOf(bId);
check('role revision note is masked',()=>assert.equal(b.revisionRequest.note,'CS 메모: 고객 [전화번호] 요청 반영'));
check('role revision excerpt (human edit) is masked',()=>{assert.ok(b.revisionRequest.previousExcerpt.includes('고객 [전화번호] 의견'));noSecret(JSON.stringify(b),'재작성 입력')});

// ── 역할: 앞선 작업물(사람 수정본) 발췌 가림 ──
await put('artifact','min-c-cmo',artifact('min-c','cmo',{origin:'ai_edited',editStats:{changed:1},content:'## 수정본\n문의는 synthetic.edit@example.com 으로 받는 조건부 계획입니다.'}),'min-c');
const cId=await start('min-c','insight');const cIn=await inputOf(cId);
check('role previous artifact content is masked',()=>{assert.ok(cIn.previous[0].content.includes('문의는 [이메일] 으로'));noSecret(JSON.stringify(cIn),'앞선 작업물 입력')});

// ── 역할 복구: 접수 실패 뒤 같은 키로 복구하면 저장본(가린 본문)을 그대로 다시 보낸다 ──
hermes.failures.submit=1;const before=posted.length;
const eStart=await (await role.executeRole(owner,{action:'start',campaignId:'min-e',role:'cmo'})).json();
const eJob=sql.prepare("SELECT id,status FROM jobs WHERE owner=? AND campaign_id='min-e'").get(owner);
check('failed submission leaves the role job uncertain',()=>assert.equal(eJob.status,'uncertain',JSON.stringify(eStart)));
await (await role.executeRole(owner,{action:'recover',id:eJob.id})).json();
const eSaved=await server.readRecord(owner,'hermes_submission',eJob.id);
check('role stored body equals the failed send and the recovery resend',()=>{assert.equal(posted.length-before,2);assert.equal(posted[before],eSaved.body);assert.equal(posted[before+1],eSaved.body)});
check('role recovery body is the masked body',()=>{assert.ok(JSON.parse(JSON.parse(eSaved.body).input).campaign.goal.includes('[전화번호]'));noSecret(eSaved.body,'복구 본문')});

// ── 회의(A3): 작업물 허용 목록, candidateArtifacts 상한, 안건·성과 메모 가림, 복구 ──
const extra={origin:'ai_edited',aiSourceId:'min-src',aiSource:{id:'min-src',version:1},editStats:{changed:3},reviewNote:`회의 전 메모 ${PHONE(23)}`,complianceHold:{issues:1},promptVersion:'role-cmo@0123456789ab',promptRecheck:true,factRefs:[{id:'min-fact-phone',version:1}],skillVersion:'x',outputContractVersion:'y',meetingId:'m0',reviewedAt:now,reviewedVersion:1};
for(const [i,r] of agency.roles.map(x=>x.id).entries()){const a=artifact('min-d',r,{...extra,...(r==='strategy'?{content:'## 합성 전략\n'+'합성 장문: 조건부 전략 가설을 반복한 문장입니다. '.repeat(1200)}:{}),...(r==='creative'?{content:`## 합성 크리에이티브\n고객 인터뷰 연락처 ${PHONE(24)} 는 쓰지 않는다.`}:{})});sql.prepare('INSERT INTO records(id,owner,kind,parent_id,data,updated_at) VALUES(?,?,?,?,?,?)').run(`${owner}:artifact:${a.id}`,owner,'artifact','min-d',JSON.stringify(a),`2026-01-01T00:00:0${i}.000Z`)}
await put('metric','min-metric',{id:'min-metric',campaignId:'min-d',period:'2026-09',revenue:120000,variableCosts:null,adSpend:null,productionCost:null,orders:10,baselineContribution:null,notes:`점주 메모 ${PHONE(25)}`},'min-d');
const ALLOWED=['ref','id','role','title','content','version','status','createdAt','factsChanged','brandChanged','unverifiedClaims','qualityReview','excerpt'];
const started=await (await meeting.executeMeeting(owner,{action:'start',id:'min-meeting',campaignId:'min-d',campaignVersion:1,agenda:`합성 안건: 고객 ${PHONE(26)} 불만 정리`})).json();
check('meeting started',()=>assert.equal(started.status,'running',JSON.stringify(started)));
hermes.failures.submit=1;const mBefore=posted.length;
let m=await (await meeting.executeMeeting(owner,{action:'advance',id:'min-meeting'})).json();
check('failed meeting submission leaves the step uncertain',()=>assert.equal(m.status,'uncertain',JSON.stringify({status:m.status,error:m.error})));
m=await (await meeting.executeMeeting(owner,{action:'recover',id:'min-meeting'})).json();
const firstStep='min-meeting:discussion:cmo',firstSaved=await server.readRecord(owner,'hermes_submission',firstStep);
check('meeting stored body equals the failed send and the recovery resend',()=>{assert.equal(posted.length-mBefore,2);assert.equal(posted[mBefore],firstSaved.body);assert.equal(posted[mBefore+1],firstSaved.body)});
for(let i=0;i<60&&m.status==='running';i++)m=await (await meeting.executeMeeting(owner,{action:'advance',id:'min-meeting'})).json();
check('meeting completed',()=>assert.equal(m.status,'completed',JSON.stringify({status:m.status,error:m.error})));
const stored=await server.readRecord(owner,'team_meeting','min-meeting');
const stepInputs=await Promise.all(stored.steps.map(async s=>({step:s,input:await inputOf(s.attempt?`${s.id}:retry:${s.attempt}`:s.id)})));
check('meeting originalArtifacts carry only allow-listed fields',()=>{for(const {input} of stepInputs)for(const x of input.originalArtifacts)assert.deepEqual(Object.keys(x).filter(k=>!ALLOWED.includes(k)),[])});
const quality=stepInputs.find(x=>x.step.phase==='quality').input;
check('meeting candidateArtifacts carry only allow-listed fields',()=>{assert.ok(quality.candidateArtifacts.length>0);for(const x of quality.candidateArtifacts)assert.deepEqual(Object.keys(x).filter(k=>![...ALLOWED,'changes'].includes(k)),[])});
check('meeting inputs carry no correction metadata keys',()=>{for(const {input} of stepInputs)assert.ok(!/"(?:reviewNote|editStats|aiSource|aiSourceId|complianceHold|promptRecheck|promptVersion|origin|reviewedAt|meetingId)"/.test(JSON.stringify(input)))});
check('meeting candidateArtifacts body is capped at the quality upstream limit with an excerpt flag',()=>{const s=quality.candidateArtifacts.find(x=>x.role==='strategy');assert.ok(s.content.length===24000&&s.excerpt===true);const o=quality.originalArtifacts.find(x=>x.role==='strategy');assert.ok(o.content.length===8000&&o.excerpt===true)});
check('meeting agenda, metric notes and artifact text are masked',()=>{const d=stepInputs[0].input;assert.equal(d.agenda,'합성 안건: 고객 [전화번호] 불만 정리');assert.equal(d.recordedMetrics[0].notes,'점주 메모 [전화번호]');assert.ok(d.originalArtifacts.find(x=>x.role==='creative').content.includes('[전화번호]'))});
check('meeting applies brand, owner and assignee rules',()=>{const d=stepInputs[0].input;assert.deepEqual(Object.keys(d.brand),['identity','brandIntro']);assert.equal(d.campaign.plan.owner,'[담당자]');assert.equal(d.brandArchive.storeMarketing.operations.diagnostics[0].assignee,'[담당자]');assert.equal(d.campaign.stores,`가상점 · ${STORE_ADDRESS}`)});
check('meeting step inputs carry no synthetic personal data',()=>{for(const {input} of stepInputs)noSecret(JSON.stringify(input),'회의 입력')});
check('meeting steps record masking findings without values',()=>{const f=stored.steps[0].inputMasking;assert.ok(Array.isArray(f)&&f.some(x=>x.field==='agenda'&&x.kind==='phone'&&x.count===1));assert.ok(stored.steps.every(s=>Array.isArray(s.inputMasking)));noSecret(JSON.stringify(stored.steps.map(s=>s.inputMasking)),'회의 가림 기록')});
check('meeting snapshot keeps the user records for staleness checks',()=>assert.ok(stored.snapshot.artifacts.some(x=>x.reviewNote)&&stored.snapshot.brand.intake));

// ── 브리프(A4): 입력 중인 브리프·이전 캠페인·승인 작업물 발췌 가림, 담당자 자리표시 ──
await put('artifact','min-a-data',artifact('min-a','data',{status:'approved',content:`## 승인 측정 설계\n현장 담당 ${PHONE(27)} 확인.`}),'min-a');
const drafted=await (await brief.executeBrief(owner,{action:'start',id:'min-brief',data:{brandId:brand.id,storeId:store.id,title:'가상 재방문',goal:`재방문 늘리기. 문의 ${PHONE(28)}`,plan:{owner:PERSON}}})).json();
check('brief was submitted',()=>assert.equal(drafted.status,'queued',JSON.stringify(drafted)));
const br=await inputOf('brief-min-brief');
check('brief current input is masked and owner replaced',()=>{assert.equal(br.currentBrief.goal,'재방문 늘리기. 문의 [전화번호]');assert.equal(br.currentBrief.plan.owner,'[담당자]')});
check('brief previous campaigns are masked and owner replaced',()=>{assert.ok(br.previousCampaigns.length>0);for(const c of br.previousCampaigns){assert.ok(c.goal.includes('[전화번호]'));assert.equal(c.plan.owner,'[담당자]')}});
check('brief approved learnings excerpt is masked',()=>assert.ok(br.approvedLearnings.some(x=>x.content.includes('현장 담당 [전화번호]'))));
check('brief brand input excludes intake',()=>assert.deepEqual(Object.keys(br.brand),['identity','brandIntro']));
check('brief input carries no synthetic personal data',()=>noSecret(JSON.stringify(br),'브리프 입력'));
const draftRecord=await server.readRecord(owner,'brief_draft','min-brief');
check('brief draft records masking findings without values',()=>{assert.ok(draftRecord.inputMasking.some(f=>f.field==='currentBrief.goal'&&f.kind==='phone'));noSecret(JSON.stringify(draftRecord.inputMasking),'브리프 가림 기록')});

// ── 누출 0(DP-4): 전송 본문 전부, 사용자 원 레코드 밖의 모든 DB 행, 콘솔 ──
// 사용자가 입력한 원 레코드(과 그 내부 사본: 작업물 이력, 회의 스냅샷·안건, 브리프 입력)는 그대로 둔다.
const userKinds=new Set(['brand','campaign','artifact','history','campaign_directive','metric','store','store_diagnostic','brand_fact']);
// 역할 5회(복구 포함), 회의 13회(8 발언 + 실패 1 + 합의 + 개선 2 + 품질), 브리프 1회.
check('every HERMES request body is free of synthetic personal data',()=>{assert.equal(posted.length,19);for(const p of posted)noSecret(p,'HERMES 요청 본문')});
check('no derived DB row keeps synthetic personal data',()=>{
 for(const {name} of sql.prepare("SELECT name FROM sqlite_master WHERE type='table'").all()){
  for(const row of sql.prepare(`SELECT * FROM "${name}"`).all()){
   if(name==='records'){if(userKinds.has(row.kind))continue;const d=JSON.parse(row.data);if(row.kind==='team_meeting'){delete d.snapshot;delete d.agenda}if(row.kind==='brief_draft')delete d.input;noSecret(JSON.stringify(d),`records/${row.kind}`)}
   else noSecret(JSON.stringify(row),`테이블 ${name}`);
  }
 }
});
check('console output is free of synthetic personal data',()=>noSecret(logged.join('\n'),'콘솔'));
check('no external call was made',()=>assert.deepEqual(hermes.external,[]));
// ── 순수 보조 함수: 빈 담당자 유지, 입력 불변, 없는 구조는 그대로 ──
const ctx=await load('lib/ai-context.ts');
check('withoutPlanOwner keeps an empty owner and does not mutate',()=>{const c={plan:{owner:'',kpi:'k'}},before=JSON.stringify(c);assert.equal(ctx.withoutPlanOwner(c).plan.owner,'');assert.equal(ctx.withoutPlanOwner({plan:{owner:' '}}).plan.owner,' ');const named={plan:{owner:PERSON}};assert.equal(ctx.withoutPlanOwner(named).plan.owner,'[담당자]');assert.equal(named.plan.owner,PERSON);assert.equal(JSON.stringify(c),before)});
check('withoutPlanOwner and withoutAssignees leave other shapes unchanged',()=>{const x={title:'t'};assert.equal(ctx.withoutPlanOwner(x),x);assert.equal(ctx.withoutAssignees(null),null);const y={storeMarketing:null};assert.equal(ctx.withoutAssignees(y),y)});
check('productionAllow collects confirmed fact values and store address/contacts only',()=>assert.deepEqual(JSON.parse(JSON.stringify(ctx.productionAllow({facts:{confirmed:[{value:'가상 사실'},{value:3}]}},{storeMarketing:{store:{address:STORE_ADDRESS,access:`문의 ${STORE_PHONE}`,menu:'떡볶이'}}}))),['가상 사실',STORE_ADDRESS,STORE_PHONE]));
check('productionAllow without evidence or store is empty',()=>assert.equal(ctx.productionAllow(undefined).length,0));
check('aiBrand never carries intake',()=>assert.ok(!('intake' in ctx.aiBrand(brand))));
console.log(JSON.stringify({passed:passed.length}));
