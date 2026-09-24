// 조사·학습 입력 브랜드 정체성의 자유 텍스트 가림(docs/DATA-PROCESSING.ko.md 4.4 ⑤, 대표 결정 2026-09-24): 고객(audience)·제약(constraints)은
// 제작 경로(lib/ai-context.ts BRAND_MASK_PATHS)와 같은 탐지·자리표시·허용 값(확정 사실 값·지점 주소·사업장 유선 번호)으로 가린 뒤 보낸다.
// (1) 순수 도우미(lib/archive-research.ts maskedIdentity) (2) 조사 제출(심층·단계별 분류·지점 조사, lib/research-execution.ts)
// (3) 학습 제출(규칙 초안·바이럴 분석·바이럴 발견, lib/learning-execution.ts) (4) 탐지 0이면 제출 본문의 브랜드가 가림 전과 바이트 동일하다.
// 허용 값은 남고, 저장 레코드(브랜드·조사 스냅샷)는 원문이며 저장본(hermes_submission)=전송본이고, 가림 기록(필드·종류·건수, 허용 탐지는 allowed:true)은 값 없이
// 조사 단계(brand_research.steps[].inputMasking)·학습 작업(learning_task.inputMasking)에 남고, 값은 콘솔에 남지 않는다(DP-4).
// (5) 허용 값 범위: 브랜드 단위(심층·분류 조사, 학습)는 active 지점 전부의 주소, 지점 조사는 그 지점 주소만 남기고, archived 지점 주소는 어디서나 가린다.
// 근거: mocked(모의 HERMES fetch 스텁, 메모리 SQLite, 합성 브랜드). 외부 네트워크·유료 모델 호출은 0회다. 모든 번호·주소·이메일은 합성이다.
import assert from 'node:assert/strict';
import {testRuntime} from './helpers/runtime.mjs';

let passed=0;const check=(name,condition)=>{assert.ok(condition,name);passed++};
const HERMES='https://hermes.example.com',posts=[],external=[];let seq=0;
const {sql,load}=testRuntime(async(url,options={})=>{
 url=String(url);if(!url.startsWith(HERMES+'/')){external.push(url);throw new Error('모의 주소만 호출합니다: '+url)}
 if(url===HERMES+'/v1/runs'&&options.method==='POST'){posts.push(options.body);return Response.json({run_id:'run_'+ ++seq})}
 return new Response('{}',{status:404});
});
// 콘솔 출력(DP-4): 실행 중 모든 console 출력을 모은다.
const logged=[];for(const k of ['log','warn','error','info','debug']){const orig=console[k].bind(console);console[k]=(...a)=>{logged.push(a.map(String).join(' '));orig(...a)}}
const server=await load('lib/server.ts'),research=await load('lib/research-execution.ts'),learning=await load('lib/learning-execution.ts'),stages=await load('lib/archive-research.ts');

// 합성 개인정보(허용 목록 밖)와 허용 값(지점 레코드의 주소·연락 동선 유선 번호, 브랜드 확정 사실 값).
const USER={phone:'010-0000-0202',email:'synthetic.identity@example.com',address:'나상로 56'};
const STORE_ADDRESS='가상시 가상로 1',STORE_PHONE='02-000-0000',FACT_PHONE='031-000-0000';
// 같은 브랜드의 다른 active 지점과 archived 지점(허용 값 범위 확인용).
const STORE2_ADDRESS='가상시 다상길 9',STORE2_PHONE='02-000-0001',ARCHIVED_ADDRESS='가상시 라상로 3';
const AUDIENCE=`가상동 직장인(가설). 단골 문의 ${USER.phone}, 본사 ${FACT_PHONE}`,AUDIENCE_MASKED=`가상동 직장인(가설). 단골 문의 [전화번호], 본사 ${FACT_PHONE}`;
const CONSTRAINTS_HEAD=`연락은 ${USER.email}로만. 집 ${USER.address} 인근 촬영 금지. 매장 ${STORE_ADDRESS}, 매장 전화 ${STORE_PHONE}.`,CONSTRAINTS_HEAD_MASKED=`연락은 [이메일]로만. 집 [주소] 인근 촬영 금지. 매장 ${STORE_ADDRESS}, 매장 전화 ${STORE_PHONE}.`;
const CONSTRAINTS=`${CONSTRAINTS_HEAD} 2호점 ${STORE2_ADDRESS}. 닫은 매장 ${ARCHIVED_ADDRESS} 앞 촬영 금지.`;
// 브랜드 단위: active 지점 둘의 주소는 남고 archived 지점 주소는 가린다. 지점 조사(idm-store): 그 지점 주소만 남는다.
const CONSTRAINTS_MASKED=`${CONSTRAINTS_HEAD_MASKED} 2호점 ${STORE2_ADDRESS}. 닫은 매장 가상시 [주소] 앞 촬영 금지.`,CONSTRAINTS_STORE_MASKED=`${CONSTRAINTS_HEAD_MASKED} 2호점 가상시 [주소]. 닫은 매장 가상시 [주소] 앞 촬영 금지.`;
const allow=[STORE_ADDRESS,STORE_PHONE,STORE2_ADDRESS,STORE2_PHONE,FACT_PHONE];
const userLeaks=text=>Object.values(USER).filter(v=>String(text).includes(v));
// 가림 기록을 '<필드>:<종류>:<건수>[:allowed]'로 줄인다(prefix로 거른다).
const recordOf=(list,prefix='brand.')=>list.filter(f=>f.field.startsWith(prefix)).map(f=>`${f.field}:${f.kind}:${f.count}${f.allowed?':allowed':''}`).sort();
// 고객: 가린 휴대폰 1건·허용 사실 번호 1건. 제약(브랜드 단위): 가린 이메일 1건·주소 2건(집·archived 지점), 허용 active 지점 주소 2건·유선 번호 1건.
const IDENTITY_RECORD=['brand.audience:phone:1','brand.audience:phone:1:allowed','brand.constraints:address:2','brand.constraints:address:2:allowed','brand.constraints:email:1','brand.constraints:phone:1:allowed'];
// 지점 조사: 다른 active 지점 주소도 가려 주소 3건 가림·1건 허용.
const STORE_IDENTITY_RECORD=['brand.audience:phone:1','brand.audience:phone:1:allowed','brand.constraints:address:1:allowed','brand.constraints:address:3','brand.constraints:email:1','brand.constraints:phone:1:allowed'];
const valueFree=list=>Array.isArray(list)&&list.every(f=>Object.keys(f).every(k=>['field','kind','count','allowed'].includes(k)))&&userLeaks(JSON.stringify(list)).length===0&&![FACT_PHONE,STORE_ADDRESS,STORE2_ADDRESS,ARCHIVED_ADDRESS].some(v=>JSON.stringify(list).includes(v));

const now=new Date().toISOString(),owner='idm-owner';
const put=(kind,id,data,parent='')=>server.recordStatement(owner,kind,id,data,parent).run();
await server.database().prepare('INSERT INTO settings(owner,secret,model,updated_at) VALUES(?,?,?,?)').bind(owner,await server.encrypt(JSON.stringify({provider:'hermes',endpoint:HERMES,key:'mock-only'})),'HERMES',now).run();
// 브랜드 A: 고객·제약에 합성 개인정보와 허용 값. 브랜드 B: 탐지 없는 고객·제약(바이트 동일 확인용). 공식 웹사이트는 조사 입력(officialLinks)에만 간다.
const brandA={id:'idm-brand',name:'가상정체분식',short:'IM',category:'SNACK BAR',color:'#224466',bg:'#eef2f6',description:'',audience:AUDIENCE,tone:'명료한',constraints:CONSTRAINTS,knowledge:'',intake:{website:'https://idm-brand.example.com/',socialLinks:'',market:'',clientNeed:'',competitors:''}};
const brandB={...brandA,id:'idm-clean',name:'가상무탐지분식',audience:'가상동 주민(가설)',constraints:'가격은 확인 전 확정하지 않는다.'};
for(const b of [brandA,brandB])await put('brand',b.id,b);
const shop={id:'idm-store',brandId:brandA.id,name:'가상정체분식 가상점',address:STORE_ADDRESS,tradeArea:'residential',customer:'가상 고객',goal:'평일 방문',daypart:'점심',menu:'떡볶이',hours:'11-21',access:`문의 ${STORE_PHONE}`,capacity:'20석',economics:'미확인',competitors:'미확인',status:'active',version:1,createdAt:now,updatedAt:now};
await put('store',shop.id,shop,brandA.id);
await put('store','idm-store-2',{...shop,id:'idm-store-2',name:'가상정체분식 2호점',address:STORE2_ADDRESS,access:`문의 ${STORE2_PHONE}`},brandA.id);
await put('store','idm-store-closed',{...shop,id:'idm-store-closed',name:'가상정체분식 폐점',address:ARCHIVED_ADDRESS,access:'미확인',status:'archived'},brandA.id);
await put('brand_fact','idm-fact-phone',{id:'idm-fact-phone',brandId:brandA.id,key:'전화',value:FACT_PHONE,status:'confirmed',source:'합성 원장',verifiedAt:now,validUntil:'2099-12-31T00:00:00.000Z',version:1,updatedAt:now},brandA.id);
// 브랜드 단위 자료는 조사 자료(research)뿐이다: 자료 가림이 없어도 정체성 가림의 허용 값을 읽는지 본다. 지점 자료(upload)는 지점 조사에만 들어가 자료 가림 기록과 합쳐진다.
const source=(id,brandId,origin,content,extra={})=>({id,brandId,title:'합성 자료 '+id,category:'customer',origin,status:'candidate',url:'',content,scope:'합성 관찰 범위',observedAt:now,createdAt:now,version:1,...extra});
for(const b of [brandA,brandB])await put('brand_source',b.id+'-research',source(b.id+'-research',b.id,'research','공개 메뉴 관찰: 떡볶이 5,000원.'),b.id);
await put('brand_source','idm-upload',source('idm-upload',brandA.id,'upload',`매장 메모: 예약 ${USER.phone}`,{storeId:shop.id,fileName:'memo.txt'}),brandA.id);
const stored=async id=>(await server.readRecord(owner,'hermes_submission',id)).body;
const inputOf=body=>JSON.parse(JSON.parse(body).input);
const identityOf=b=>JSON.stringify({name:b.name,short:b.short,category:b.category,color:b.color,tone:b.tone,audience:b.audience,constraints:b.constraints});

// ── (1) 순수 도우미 ──
{
 const identity=stages.researchBrand(brandA,true),masked=stages.maskedIdentity(identity,allow);
 check('audience and constraints are masked and allow-listed values stay',masked.value.audience===AUDIENCE_MASKED&&masked.value.constraints===CONSTRAINTS_MASKED);
 check('other identity fields and official links are unchanged in key order',JSON.stringify(Object.keys(masked.value))===JSON.stringify(Object.keys(identity))&&masked.value.name===brandA.name&&masked.value.officialLinks.website===brandA.intake.website);
 check('the masking record has field, kind and count with allow-listed detections as allowed:true',JSON.stringify(recordOf(masked.masking))===JSON.stringify(IDENTITY_RECORD)&&valueFree(masked.masking));
 check('masked detections come before allow-listed ones in the record',masked.masking.findIndex(f=>f.allowed)===masked.masking.filter(f=>!f.allowed).length);
 check('the input identity object is not mutated',identity.audience===AUDIENCE&&identity.constraints===CONSTRAINTS);
 check('without allow values the store and fact values are masked too',stages.maskedIdentity(identity).value.audience===`가상동 직장인(가설). 단골 문의 [전화번호], 본사 [전화번호]`);
 const clean=stages.researchBrand(brandB,true),kept=stages.maskedIdentity(clean,allow);
 check('an identity without detections serializes byte-identical with an empty record',JSON.stringify(kept.value)===JSON.stringify(clean)&&kept.masking.length===0);
 check('detection check tells whether allow values are needed',stages.identityDetected(identity)&&!stages.identityDetected(clean)&&!stages.identityDetected({name:'x'}));
}

// ── (2) 조사 제출 ──
const researchRun=async(id,body)=>{
 sql.prepare("UPDATE jobs SET status='completed' WHERE owner=?").run(owner);
 await research.executeResearch(owner,{action:'start',id,...body});await research.executeResearch(owner,{action:'advance',id});
 const rec=await server.readRecord(owner,'brand_research',id),step=rec.steps.find(s=>s.status!=='pending');
 return {rec,step,body:posts.at(-1),input:inputOf(posts.at(-1))};
};
{
 const before=posts.length;
 // 심층 조사(브랜드 단위, 대화형 1단계): 사용자 자료가 없어도 정체성 가림의 허용 값(브랜드 확정 사실·active 지점 주소·유선 번호)을 쓴다.
 const deep=await researchRun('idm-deep',{brandId:brandA.id});
 check('deep research submitted once',posts.length===before+1&&deep.step.stage==='investigation');
 check('deep research masks brand audience and constraints and keeps allow-listed values',deep.input.brand.audience===AUDIENCE_MASKED&&deep.input.brand.constraints===CONSTRAINTS_MASKED);
 check('brand-level research keeps every active store address and masks the archived store address',deep.input.brand.constraints.includes(STORE_ADDRESS)&&deep.input.brand.constraints.includes(STORE2_ADDRESS)&&!deep.input.brand.constraints.includes(ARCHIVED_ADDRESS));
 check('deep research keeps the other identity fields and official links',deep.input.brand.name===brandA.name&&deep.input.brand.officialLinks.website===brandA.intake.website&&JSON.stringify(Object.keys(deep.input.brand))===JSON.stringify(Object.keys(stages.researchBrand(brandA,true))));
 check('the deep research body carries no personal data from the identity',userLeaks(deep.body).length===0);
 check('the stored deep research submission equals the sent body',await stored(deep.step.id)===deep.body);
 check('the research snapshot keeps the original brand',deep.rec.snapshot.brand.audience===AUDIENCE&&deep.rec.snapshot.brand.constraints===CONSTRAINTS);
 check('the deep research step records identity masking without values',JSON.stringify(recordOf(deep.step.inputMasking))===JSON.stringify(IDENTITY_RECORD)&&deep.step.inputMasking.length===IDENTITY_RECORD.length&&valueFree(deep.step.inputMasking));
 // 단계별 분류 조사(브랜드 단위 1단계).
 const classify=await researchRun('idm-classify',{brandId:brandA.id,mode:'classify'});
 check('stepwise classify research masks the identity the same way',classify.step.stage==='identity'&&classify.input.brand.audience===AUDIENCE_MASKED&&classify.input.brand.constraints===CONSTRAINTS_MASKED&&userLeaks(classify.body).length===0);
 check('the stepwise step records identity masking and equals the stored submission',JSON.stringify(recordOf(classify.step.inputMasking))===JSON.stringify(IDENTITY_RECORD)&&await stored(classify.step.id)===classify.body);
 // 지점 조사: 허용 값은 조사 스냅샷의 지점 레코드와 지점 범위 확정 사실이다. 지점 자료(upload)의 가림 기록과 한 단계 기록에 합친다.
 const local=await researchRun('idm-store-r',{brandId:brandA.id,storeId:shop.id});
 const upload=local.input.sources.findIndex(s=>s.id==='idm-upload');
 check('store research masks the identity and the user source and keeps allow-listed values',local.input.brand.audience===AUDIENCE_MASKED&&local.input.brand.constraints===CONSTRAINTS_STORE_MASKED&&local.input.sources[upload].content==='매장 메모: 예약 [전화번호]'&&userLeaks(local.body).length===0);
 check('store research keeps only its own store address and masks the other active store address',local.input.brand.constraints.includes(STORE_ADDRESS)&&!local.input.brand.constraints.includes(STORE2_ADDRESS)&&!local.input.brand.constraints.includes(ARCHIVED_ADDRESS));
 check('the store research step merges identity and source masking records without values',JSON.stringify(recordOf(local.step.inputMasking))===JSON.stringify(STORE_IDENTITY_RECORD)&&JSON.stringify(recordOf(local.step.inputMasking,'sources.'))===JSON.stringify([`sources.${upload}.content:phone:1`])&&valueFree(local.step.inputMasking));
 check('the stored store research submission equals the sent body and the snapshot keeps the original brand',await stored(local.step.id)===local.body&&local.rec.snapshot.brand.audience===AUDIENCE);
 // 탐지 0: 브랜드 입력이 가림 전 값(researchBrand)과 바이트 동일하고 가림 기록은 빈 배열이다.
 const clean=await researchRun('idm-clean-deep',{brandId:brandB.id});
 check('research without identity detections sends the brand byte-identical',JSON.stringify(clean.input.brand)===JSON.stringify(stages.researchBrand(brandB,true))&&JSON.parse(clean.body).input.includes(JSON.stringify(stages.researchBrand(brandB,true))));
 check('research without detections records an empty masking list',Array.isArray(clean.step.inputMasking)&&clean.step.inputMasking.length===0);
}

// ── (3)(4) 학습 제출 ──
const experiment=(b,id)=>({id,brandId:b.id,campaignId:id+'-campaign',caseId:b.id+'-case',analysisId:'a',title:'합성 실험',channel:'YouTube',hypothesis:'합성 가설',variable:'첫 장면',control:'대조',treatment:'실험',metric:'share_rate',minSample:100,minHours:24,minLift:10,conditions:'합성 조건',version:1,status:'evaluated',startedAt:now,createdAt:now,updatedAt:now,result:null,assessment:{status:'promising',label:'관찰상 개선',controlRate:0.01,treatmentRate:0.02,lift:100,reasons:[]}});
for(const b of [brandA,brandB]){
 await put('viral_case',b.id+'-case',{id:b.id+'-case',brandId:b.id,title:'합성 사례',channel:'YouTube',url:'https://example.com/'+b.id,account:'합성 공식 계정',publishedAt:'',observedAt:now,scope:'합성 관찰 범위',observations:'합성 관찰 기록',transcript:'',views:null,baselineViews:null,comparison:'',createdAt:now,origin:'manual'},b.id);
 await put('viral_experiment',b.id+'-exp',experiment(b,b.id+'-exp'),b.id+'-exp-campaign');
}
const learn=async body=>{const r=await (await learning.executeLearning(owner,body)).json();assert.ok(r.id&&r.status==='queued',JSON.stringify(r));return {id:r.id,body:posts.at(-1),input:inputOf(posts.at(-1)),task:await server.readRecord(owner,'learning_task',r.id)}};
const learnAll=b=>({guidance:()=>learn({action:'start_guidance',experimentId:b.id+'-exp',version:1}),analysis:()=>learn({action:'start_analysis',caseId:b.id+'-case'}),discovery:()=>learn({action:'start_discovery',brandId:b.id,query:'합성 조사 주제'})});
for(const [name,run] of Object.entries(learnAll(brandA))){
 const r=await run();
 check(`${name} masks brand audience and constraints and keeps allow-listed values`,r.input.brand.audience===AUDIENCE_MASKED&&r.input.brand.constraints===CONSTRAINTS_MASKED&&r.input.brand.name===brandA.name&&!('officialLinks' in r.input.brand));
 check(`${name} keeps every active store address and masks the archived store address`,r.input.brand.constraints.includes(STORE_ADDRESS)&&r.input.brand.constraints.includes(STORE2_ADDRESS)&&!r.input.brand.constraints.includes(ARCHIVED_ADDRESS));
 check(`${name} body carries no personal data from the identity`,userLeaks(r.body).length===0);
 check(`${name} stored submission equals the sent body`,await stored(r.id)===r.body);
 check(`${name} learning_task records identity masking without values`,JSON.stringify(recordOf(r.task.inputMasking))===JSON.stringify(IDENTITY_RECORD)&&r.task.inputMasking.length===IDENTITY_RECORD.length&&valueFree(r.task.inputMasking));
}
for(const [name,run] of Object.entries(learnAll(brandB))){
 const r=await run();
 check(`${name} without detections sends the brand byte-identical`,JSON.stringify(r.input.brand)===identityOf(brandB)&&JSON.parse(r.body).input.includes('"brand":'+identityOf(brandB)));
 check(`${name} without detections records an empty masking list`,Array.isArray(r.task.inputMasking)&&r.task.inputMasking.length===0);
}

{
 const records=await Promise.all([brandA,brandB].map(b=>server.readRecord(owner,'brand',b.id)));
 check('stored brand records keep the original audience and constraints',records[0].audience===AUDIENCE&&records[0].constraints===CONSTRAINTS&&records[1].audience===brandB.audience);
}
check('no detected value was written to the console',userLeaks(logged.join('\n')).length===0);
check('no external call was made',external.length===0&&posts.length===10);
console.log(JSON.stringify({passed}));
