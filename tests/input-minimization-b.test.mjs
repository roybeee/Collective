// 입력 최소화 레인 B(docs/DATA-PROCESSING.ko.md 4.4 ②⑤⑧): 조사 제출 본문과 점포 맥락이 허용한 필드만 모델로 보내는지 고정한다.
// ② 측정 기록의 주문 해시 id(ledgerSnapshot.orderRefs)는 어떤 모델 입력에도 없다(집계 수치는 남는다). 점포 맥락은 제작 경로(brandArchiveContext)와 조사가 같이 쓴다.
// ⑤ 조사의 브랜드 입력은 정체성 필드만이다. 소개·메모와 의뢰 정보 자유 텍스트는 빠지고, 조사에는 공식 웹사이트·SNS 주소만 필드 단위로 남는다.
// ⑧ 조사 지시문(심층·단계별·지점 진단)에 리뷰·댓글 작성자 식별정보를 남기지 말라는 문구가 있다.
// 근거: mocked(모의 HERMES fetch 스텁, 메모리 SQLite, 합성 브랜드·지점). 외부 네트워크·유료 모델 호출은 0회다.
import assert from 'node:assert/strict';
import {testRuntime} from './helpers/runtime.mjs';
import {readFileSync} from 'node:fs';

const HERMES='https://hermes.example.com',posts=[],external=[];let seq=0;
const {sql,load}=testRuntime(async(url,options={})=>{
 url=String(url);if(!url.startsWith(HERMES+'/')){external.push(url);throw new Error('모의 주소만 호출합니다: '+url)}
 if(url===HERMES+'/v1/runs'&&options.method==='POST'){const body=JSON.parse(options.body);posts.push({instructions:body.instructions,input:body.input});return Response.json({run_id:'run_'+ ++seq})}
 return new Response('{}',{status:404});
});
const server=await load('lib/server.ts'),research=await load('lib/research-execution.ts'),archive=await load('lib/archive-server.ts'),store=await load('lib/store-context.ts'),deep=await load('lib/deep-research-server.ts'),stages=await load('lib/archive-research.ts');
let passed=0;const check=(name,condition)=>{assert.ok(condition,name);passed++};
const now=new Date().toISOString(),owner='imb-owner',HASH='ab'.repeat(32);
// 합성 브랜드. 자유 텍스트 칸마다 고유 문장을 넣어 제출 본문에서 찾는다. 실제 고객·매장 정보가 아니다.
const secret={intro:'IMB-소개-가상소개문장',memo:'IMB-메모-가상메모문장',market:'IMB-시장-가상동상권',need:'IMB-의뢰-매장 방문을 늘리고 싶다',competitors:'IMB-경쟁-가상떡볶이',social:'IMB-채널메모-담당자연락'};
const brand={id:'imb-brand',name:'가상분식',short:'GB',category:'SNACK BAR',color:'#224466',bg:'#eef2f6',description:secret.intro,audience:'가상동 주민(가설)',tone:'명료한',constraints:'가격은 확인 전 확정하지 않는다.',knowledge:secret.memo,
 intake:{website:'https://gabunsik.example.com/',socialLinks:`공식 인스타 https://www.instagram.com/gabunsik_test ${secret.social} youtube.com/@gabunsik`,market:secret.market,clientNeed:secret.need,competitors:secret.competitors}};
const identity={name:brand.name,short:brand.short,category:brand.category,color:brand.color,tone:brand.tone,audience:brand.audience,constraints:brand.constraints};
const leaks=text=>Object.values(secret).filter(s=>text.includes(s));
const RESEARCH_PRIVACY='작성자의 이름·닉네임·계정·연락처 등 식별정보는 수집·기록하지 말고 내용만 요약';
const put=(kind,id,data,parent)=>server.recordStatement(owner,kind,id,data,parent).run();
await server.database().prepare('INSERT INTO settings(owner,secret,model,updated_at) VALUES(?,?,?,?)').bind(owner,await server.encrypt(JSON.stringify({provider:'hermes',endpoint:HERMES,key:'mock-only'})),'HERMES',now).run();
await put('brand',brand.id,brand);
const shop={id:'imb-store',brandId:brand.id,name:'가상분식 가상점',address:'가상시 가상로 1',tradeArea:'residential',customer:'가상 고객',goal:'평일 방문',daypart:'점심',menu:'떡볶이',hours:'11-21',access:'도보',capacity:'20석',economics:'미확인',competitors:'미확인',status:'active',version:1,createdAt:now,updatedAt:now};
await put('store',shop.id,shop,brand.id);
const measurement={id:'imb-m1',storeId:shop.id,experimentId:'imb-exp',periodStart:'2026-08-01',periodEnd:'2026-08-07',source:'주문 성과 장부',definition:'합성 장부',method:'export',cohortMatured:true,values:{orders:3,revenue:30000},version:1,createdAt:now,updatedAt:now,ledgerSnapshot:{capturedAt:now,orderRefs:[{id:HASH,version:1}],spendRefs:[{id:'imb-spend',version:1}],costsConfirmed:false}};
await put('store_measurement',measurement.id,measurement,shop.id);

// ② 점포 맥락: 제작 경로(brandArchiveContext)와 조사가 같은 storeContext를 쓴다. 주문 해시만 빠지고 집계·출처 정보는 남는다. 저장 기록은 그대로다(장부 변경 감지용).
{
 const ctx=await store.storeContext(owner,brand.id,shop.id),m=ctx.measurements[0];
 check('store context drops order hashes from measurements',!JSON.stringify(ctx).includes(HASH)&&!('orderRefs' in m.ledgerSnapshot));
 check('store context keeps aggregate values and the rest of the ledger snapshot',m.values.orders===3&&m.values.revenue===30000&&m.ledgerSnapshot.capturedAt===now&&m.ledgerSnapshot.costsConfirmed===false&&m.ledgerSnapshot.spendRefs.length===1&&typeof ctx.operations.ledger.records==='number');
 const production=(await archive.brandArchiveContext(owner,brand.id,shop.id)).storeMarketing;
 check('the production context (role·meeting·brief) carries no order hash either',!JSON.stringify(production).includes(HASH)&&production.measurements[0].values.orders===3);
 check('the stored measurement keeps its order refs for ledger change checks',(await server.readRecord(owner,'store_measurement',measurement.id)).ledgerSnapshot.orderRefs[0].id===HASH);
}

// ⑤⑧ 브랜드 심층 조사(대화형 1단계).
const researchBrand=input=>JSON.parse(input).brand;
{
 await research.executeResearch(owner,{action:'start',id:'imb-deep',brandId:brand.id});await research.executeResearch(owner,{action:'advance',id:'imb-deep'});
 const sent=posts.at(-1),input=JSON.parse(sent.input);
 check('deep research submission carries no brand intro, memo or intake free text',leaks(sent.input).length===0);
 check('deep research brand input is the identity allow-list plus official links',JSON.stringify(Object.keys(input.brand).sort())===JSON.stringify([...Object.keys(identity),'officialLinks'].sort())&&Object.entries(identity).every(([k,v])=>input.brand[k]===v));
 check('official links keep the website and the SNS URLs only',input.brand.officialLinks.website===brand.intake.website&&JSON.stringify(input.brand.officialLinks.socialLinks)===JSON.stringify(['https://www.instagram.com/gabunsik_test','https://youtube.com/@gabunsik']));
 check('the plan keeps derived business type and channels but not the client-need text as objective',input.plan.businessType==='local'&&input.plan.channels.join()==='Instagram,YouTube'&&!input.plan.objective.includes(secret.need)&&input.plan.objective.length>0);
 check('deep research instructions tell the model to leave out review and comment author identities',sent.instructions.includes(RESEARCH_PRIVACY));
 check('the A7 repair instructions keep the same author-privacy rule',deep.deepInstructions.split('\n').find(line=>line.startsWith('보안:')).includes(RESEARCH_PRIVACY));
}

// ⑤②⑧ 지점 조사(단계별 지시 + 점포 맥락). 같은 브랜드의 조사가 진행 중이면 막히므로 앞 조사 작업을 끝난 것으로 둔다.
{
 sql.prepare("UPDATE jobs SET status='completed' WHERE owner=?").run(owner);
 await research.executeResearch(owner,{action:'start',id:'imb-store-r',brandId:brand.id,storeId:shop.id});await research.executeResearch(owner,{action:'advance',id:'imb-store-r'});
 const sent=posts.at(-1),input=JSON.parse(sent.input);
 check('store research submission carries no brand free text and no order hash',leaks(sent.input).length===0&&!sent.input.includes(HASH)&&!sent.input.includes('"orderRefs"'));
 check('store research still receives the store and the measured aggregates',input.store.id===shop.id&&input.storeContext.measurements[0].values.revenue===30000&&researchBrand(sent.input).name===brand.name);
 check('stage research instructions carry the author-privacy rule',sent.instructions.includes(RESEARCH_PRIVACY)&&['identity','customer','channel','diagnosis'].every(stage=>stages.archiveResearchInstructions(stage,'deep').includes(RESEARCH_PRIVACY)));
 // 마지막 단계(store_diagnosis)는 점포 전용 지시(storeResearchInstructions)를 쓴다. 앞 세 단계를 끝난 것으로 두고 제출까지 진행한다.
 const rec=await server.readRecord(owner,'brand_research','imb-store-r');
 await put('brand_research',rec.id,{...rec,steps:rec.steps.map(s=>s.stage==='store_diagnosis'?s:{...s,status:'completed',summary:'합성 요약',limitations:'합성 한계'})},brand.id);
 await research.executeResearch(owner,{action:'advance',id:'imb-store-r'});
 const diagnosis=posts.at(-1),diagnosisInput=JSON.parse(diagnosis.input);
 check('the store diagnosis step is submitted with the store-only instructions',diagnosisInput.stage==='store_diagnosis'&&diagnosis.instructions.startsWith('당신은 COLLECTIVE 점포 마케팅 조사 책임자입니다.'));
 check('store diagnosis instructions carry the author-privacy rule',diagnosis.instructions.includes(RESEARCH_PRIVACY));
 check('store diagnosis submission carries no brand free text and no order hash',leaks(diagnosis.input).length===0&&!diagnosis.input.includes(HASH));
}

// ② 변경 전에 시작한 지점 조사: 저장된 점포 맥락 스냅샷에 주문 해시가 남아 있어도 보낼 때 뺀다.
{
 sql.prepare("UPDATE jobs SET status='completed' WHERE owner=?").run(owner);
 await research.executeResearch(owner,{action:'start',id:'imb-store-old',brandId:brand.id,storeId:shop.id});
 const rec=await server.readRecord(owner,'brand_research','imb-store-old'),ctx=rec.snapshot.storeContext;
 await put('brand_research',rec.id,{...rec,snapshot:{...rec.snapshot,storeContext:{...ctx,measurements:ctx.measurements.map(m=>({...m,ledgerSnapshot:{...m.ledgerSnapshot,orderRefs:[{id:HASH,version:1}]}}))}}},brand.id);
 check('the seeded in-flight snapshot still carries the order hash',JSON.stringify(await server.readRecord(owner,'brand_research','imb-store-old')).includes(HASH));
 await research.executeResearch(owner,{action:'advance',id:'imb-store-old'});
 const sent=posts.at(-1),input=JSON.parse(sent.input);
 check('an in-flight store research sends no order hash from its stored snapshot',!sent.input.includes(HASH)&&!sent.input.includes('"orderRefs"'));
 check('the in-flight submission keeps the measured aggregates and the rest of the ledger snapshot',input.storeContext.measurements[0].values.revenue===30000&&input.storeContext.measurements[0].ledgerSnapshot.spendRefs.length===1&&input.storeContext.measurements[0].ledgerSnapshot.capturedAt===now);
}

// ⑤ 의뢰 목적(intake.clientNeed)은 보내지 않으므로 진단·심층 조사 지시가 의뢰인 니즈를 추정하지 말라고 한다.
{
 const NO_CLIENT_NEED='의뢰 목적은 입력으로 제공되지 않습니다. 의뢰인의 니즈를 추정하지 말고';
 check('stage diagnosis instructions tell the model not to guess the client need',stages.archiveResearchInstructions('diagnosis','deep').includes(NO_CLIENT_NEED)&&stages.archiveResearchInstructions('diagnosis','classify').includes(NO_CLIENT_NEED));
 check('deep research step 1 reviews the plan without a client objective and does not guess it',deep.deepInstructions.includes(NO_CLIENT_NEED)&&!deep.deepInstructions.includes('의뢰 목적에 맞춰'));
}

// ⑤ 공식 SNS 칸(자유 텍스트)에서 공개 웹 주소만 고른다. 주소는 조회 문자열·조각(?·#)을 떼고, 스킴 없는 토큰은 www.나 알려진 공식 채널 호스트일 때만 주소로 본다.
{
 const links=(socialLinks,website='')=>stages.researchBrand({...brand,intake:{...brand.intake,website,socialLinks}},true).officialLinks;
 const social=text=>links(text)?.socialLinks||[];
 check('URLs glued to Korean labels or wrapped in brackets are kept',JSON.stringify(social('인스타:https://instagram.com/x'))==='["https://instagram.com/x"]'&&JSON.stringify(social('(https://instagram.com/x)'))==='["https://instagram.com/x"]'&&JSON.stringify(social('공식인스타(instagram.com/x)'))==='["https://instagram.com/x"]');
 check('closing quotes and sentence punctuation are not part of the URL',JSON.stringify(social('"https://instagram.com/x)"'))==='["https://instagram.com/x"]'&&JSON.stringify(social('블로그 blog.naver.com/gabunsik. 홈 www.gabunsik.co.kr, 끝'))==='["https://blog.naver.com/gabunsik","https://www.gabunsik.co.kr/"]');
 check('dotted personal IDs, e-mail addresses and bare handles are not sent as links',links('hong.gildong kim.minsu.personal hong@naver.com @gabunsik_official')===undefined);
 check('query strings and fragments are dropped from social links and the website',JSON.stringify(social('https://example.com/contact?name=hong&tel=01012345678#top'))==='["https://example.com/contact"]'&&links('','https://gabunsik.example.com/?ref=hong#top').website==='https://gabunsik.example.com/');
}

// ⑤ 화면 안내: 의뢰 목적·시장·경쟁사는 조사에 보내지 않고, 공식 SNS 칸은 주소만 보낸다는 것을 등록·의뢰 정보 화면이 실제 동작대로 알린다.
{
 const ui=readFileSync('app/brand-archive.tsx','utf8'),NOTE='의뢰 목적·시장·경쟁사는 AI 조사에 보내지 않습니다.';
 check('brand registration and the intake tab say intake notes are not sent to AI research',ui.split(NOTE).length===3&&!ui.includes('의뢰 목적과 공식 채널을 알려주면 조사 범위를 더 정확하게'));
 check('the empty diagnosis state no longer asks for the client objective to start research',!ui.includes('공식 채널과 의뢰 목적을 입력하고 심층 조사를 시작'));
 check('the official SNS field asks for addresses because bare handles are not sent',ui.includes("placeholder={k==='socialLinks'?'https://instagram.com/계정처럼 주소로 적어 주세요. @계정만 적으면 조사에 보내지 않습니다.'"));
}

// ⑤⑧ 바이럴 학습 경로는 레인 A 후속 학습 경로 PR에서 적용했고 tests/learning-input-minimization.test.mjs가 검증한다(docs/DATA-PROCESSING.ko.md 4.4).
check('no external call was made',external.length===0&&posts.length===4);
console.log(JSON.stringify({passed}));
