// 브랜드 자료 가림(docs/DATA-PROCESSING.ko.md 4.4 ③ DP-3 업로드 추출문, 레인 B 후속): 사용자가 넣은 자료(origin 'upload'·'manual')의 본문·제목(파일 이름)·확인 범위·URL은
// 모델 입력으로 나가기 직전에 lib/pii-scan.ts maskText로 가리고, 조사가 공개 웹에서 모은 자료(origin 'research')는 원문으로 보낸다.
// (1) 순수 함수(lib/source-masking.ts, 앞부분 창 가림 포함) (2) 조사 제출(심층·지점 조사, lib/research-execution.ts)
// (3) 제작 경로(lib/archive-server.ts brandArchiveInput과 역할·회의·브리프 제출, 가림 이전에 시작한 회의 스냅샷의 전환 가림).
// 허용 값(확정 사실 값·지점 주소·사업장 유선 번호)은 남고, 탐지 0이면 원문 그대로이며, 저장 레코드는 원문이고 저장본=전송본이며,
// 가림 기록(필드·종류·건수, 허용 탐지는 allowed:true)은 실행 기록에 값 없이 남고, 값은 콘솔에 남지 않는다(DP-4).
// 근거: mocked(모의 HERMES fetch 스텁, 메모리 SQLite, 합성 데이터). 외부 네트워크·유료 모델 호출은 0회다. 모든 번호·주소·이메일은 합성이다.
import assert from 'node:assert/strict';
import {pureLoader} from '../scripts/eval/load-ts.mjs';
import {testRuntime} from './helpers/runtime.mjs';

let passed=0;const check=(name,condition)=>{assert.ok(condition,name);passed++};
// 합성 개인정보(허용 목록 밖). 사용자 자료에서는 가려져야 한다.
const USER={phone:'010-0000-0101',email:'synthetic.upload@example.com',address:'나상로 34',card:'0000-0000-0000-0000',nationalId:'900101-1000000'};
// 조사 자료(공개 웹 관찰)의 같은 종류 패턴. 가리지 않고 원문으로 보낸다.
const PUBLIC={phone:'010-0000-0909',email:'synthetic.public@example.com'};
// 허용 값: 지점 레코드의 주소·연락 동선 유선 번호, 브랜드 확정 사실 값.
const STORE_ADDRESS='가상시 가상로 1',STORE_PHONE='02-000-0000',FACT_PHONE='031-000-0000';
const userText=`업로드 메모: 고객 ${USER.phone}, 메일 ${USER.email}, 집 ${USER.address} 인근, 카드 ${USER.card}, 주민번호 ${USER.nationalId}. 매장 문의 ${STORE_PHONE}, 본사 ${FACT_PHONE}, 매장 주소 ${STORE_ADDRESS}.`;
const userMasked=`업로드 메모: 고객 [전화번호], 메일 [이메일], 집 [주소] 인근, 카드 [결제정보], 주민번호 [고유식별번호]. 매장 문의 ${STORE_PHONE}, 본사 ${FACT_PHONE}, 매장 주소 ${STORE_ADDRESS}.`;
const researchText=`공개 리뷰 관찰: 가게 안내문에 ${PUBLIC.phone}, ${PUBLIC.email} 표기. 방문 동선은 ${USER.address} 쪽.`;
const plainText='가상분식 메뉴표: 떡볶이 5,000원, 김밥 3,500원. 영업 11:00-21:00.';
// 사용자 자료의 제목(업로드 파일 이름)·확인 범위·URL에 든 합성 개인정보와 가린 모습.
const UPLOAD_TITLE=`고객명단_${USER.phone}.csv`,UPLOAD_TITLE_MASKED='고객명단_[전화번호].csv',UPLOAD_SCOPE=`담당 ${USER.email}`,UPLOAD_SCOPE_MASKED='담당 [이메일]';
const MANUAL_URL=`https://example.com/form?tel=${USER.phone}`,MANUAL_URL_MASKED='https://example.com/form?tel=[전화번호]',RESEARCH_TITLE=`공개 리뷰 ${PUBLIC.phone}`;
const allow=[STORE_ADDRESS,STORE_PHONE,FACT_PHONE];
const userLeaks=text=>Object.values(USER).filter(v=>String(text).includes(v));
// 가림 기록을 '<필드 꼬리>:<종류>:<건수>[:allowed]'로 줄인다(prefix: '<입력 경로>.<자료 순번>').
const recordOf=(list,prefix)=>list.filter(f=>f.field.startsWith(prefix+'.')).map(f=>`${f.field.slice(prefix.length+1)}:${f.kind}:${f.count}${f.allowed?':allowed':''}`).sort();
// userText 본문의 기록: 가린 전화·이메일·주소·카드·주민번호 각 1건, 허용 값이라 보낸 전화 2건(지점·사실)·주소 1건(지점).
const CONTENT_RECORD=['content:address:1','content:address:1:allowed','content:email:1','content:national_id:1','content:payment:1','content:phone:1','content:phone:2:allowed'];
const UPLOAD_RECORD=[...CONTENT_RECORD,'scope:email:1','title:phone:1'].sort(),MANUAL_RECORD=[...CONTENT_RECORD,'url:phone:1'].sort();

// ── (1) 순수 함수 ──
{
 const load=pureLoader(process.cwd()),sm=await load('lib/source-masking.ts'),pii=await load('lib/pii-scan.ts');
 const content=(source,a=allow)=>sm.modelSourceContent(source,a);
 check('upload text masks phone, email, address, payment and national id and keeps allow-listed values',content({origin:'upload',content:userText})===userMasked);
 check('manual text is masked the same way',content({origin:'manual',content:userText})===userMasked);
 check('a record without origin is treated as user-provided and masked',content({content:userText})===userMasked);
 check('research text is sent verbatim even with the same patterns',content({origin:'research',content:userText})===userText&&content({origin:'research',content:researchText})===researchText);
 check('without allow values the store phone, fact phone and store address are masked too',content({origin:'upload',content:userText},[]).endsWith('매장 문의 [전화번호], 본사 [전화번호], 매장 주소 가상시 [주소].'));
 check('no detection returns the original string',content({origin:'upload',content:plainText})===plainText&&content({origin:'manual',content:''})==='');
 check('user-provided predicate is origin based',sm.userProvidedSource({origin:'upload'})&&sm.userProvidedSource({origin:'manual'})&&sm.userProvidedSource({})&&!sm.userProvidedSource({origin:'research'}));
 const long='가'.repeat(5000),ex=sm.modelSourceExcerpt({origin:'upload',content:long},4500,allow);
 check('excerpt keeps the limit and the flag when nothing is masked',ex.content===long.slice(0,4500)&&ex.excerpt===true&&sm.modelSourceExcerpt({origin:'upload',content:plainText},4500).content===plainText&&sm.modelSourceExcerpt({origin:'upload',content:plainText},4500).excerpt===false);
 // 원문 4,504자(상한 초과)가 가린 뒤 4,497자가 되면 실제로 보낸 본문은 잘리지 않았으므로 excerpt=false다.
 const shrink='가'.repeat(4490)+' '+USER.phone,sx=sm.modelSourceExcerpt({origin:'upload',content:shrink},4500);
 check('excerpt follows the masked text length',shrink.length>4500&&sx.excerpt===false&&sx.content==='가'.repeat(4490)+' [전화번호]');
 // 상한 경계에 걸친 번호: 자르기 전에 가리므로 번호 조각이 나가지 않는다.
 const edge=sm.modelSourceExcerpt({origin:'upload',content:'가'.repeat(4495)+USER.phone},4500);
 check('a number across the cut is masked before the slice',edge.content.length===4500&&!/\d/.test(edge.content)&&edge.excerpt===true);
 const rx=sm.modelSourceExcerpt({origin:'research',content:'가'.repeat(4495)+PUBLIC.phone},4500);
 check('research excerpt is the plain slice of the original',rx.content==='가'.repeat(4495)+PUBLIC.phone.slice(0,5)&&rx.excerpt===true);
 // 가림 기록(DP-4): 본문 발췌는 maskText와 같은 종류·건수를 돌려주고 값은 없다. 조사 자료는 빈 기록이다.
 const full=pii.maskText(userText,{allow}),mx=sm.modelSourceExcerpt({origin:'upload',content:userText},4500,allow);
 check('excerpt returns the kinds and counts of masked and allow-listed detections',JSON.stringify(mx.findings)===JSON.stringify(full.findings)&&JSON.stringify(mx.allowed)===JSON.stringify(full.allowed)&&mx.findings.length===5&&mx.allowed.length===2);
 check('research excerpt has an empty masking record',rx.findings.length===0&&rx.allowed.length===0);
 // 자료 목록: 사용자 자료의 제목(파일 이름)·확인 범위·URL도 가리고, 조사 자료는 네 필드 모두 원문이다. 기록 필드는 '<prefix>.<순번>.<필드>'다.
 const listed=sm.modelSources([{origin:'upload',title:UPLOAD_TITLE,scope:UPLOAD_SCOPE,url:'',content:userText},{origin:'research',title:RESEARCH_TITLE,scope:`출처 ${PUBLIC.email}`,url:`https://example.com/r?tel=${PUBLIC.phone}`,content:researchText},{origin:'manual',title:'직접 입력',scope:'사용자가 입력한 자료',url:MANUAL_URL,content:userText}],4500,allow,'sources');
 check('user source title, scope and url are masked and research fields are verbatim',listed.texts[0].title===UPLOAD_TITLE_MASKED&&listed.texts[0].scope===UPLOAD_SCOPE_MASKED&&listed.texts[0].content===userMasked&&listed.texts[2].url===MANUAL_URL_MASKED&&listed.texts[1].title===RESEARCH_TITLE&&listed.texts[1].scope===`출처 ${PUBLIC.email}`&&listed.texts[1].url.includes(PUBLIC.phone)&&listed.texts[1].content===researchText);
 check('source list records field, kind and count per source without values',JSON.stringify(recordOf(listed.masking,'sources.0'))===JSON.stringify(UPLOAD_RECORD)&&JSON.stringify(recordOf(listed.masking,'sources.2'))===JSON.stringify(MANUAL_RECORD)&&recordOf(listed.masking,'sources.1').length===0&&userLeaks(JSON.stringify(listed.masking)).length===0);
 check('masked detections come before allow-listed ones in the record',listed.masking.findIndex(f=>f.allowed)===listed.masking.filter(f=>!f.allowed).length);
 check('a source list without detections has an empty record and verbatim fields',(()=>{const r=sm.modelSources([{origin:'upload',title:'메뉴',scope:'업로드 원문 텍스트',url:'',content:plainText}],4500,allow,'sources');return r.masking.length===0&&r.texts[0].content===plainText&&r.texts[0].title==='메뉴'&&r.texts[0].excerpt===false})());
 // 앞부분 창 가림(DP3-B-03·SEC-2): 긴 본문도 결과는 본문 전체를 가린 뒤 자른 것과 같다(창 끝 경계 포함, 가림으로 줄어드는 본문 포함).
 const chunk=`메모 ${USER.phone} / ${USER.email} / 집 ${USER.address} 인근, 101동 1203호, 카드 ${USER.card}, 매장 ${STORE_PHONE}, 주민 ${USER.nationalId}. `;
 const same=(text,limit)=>{const s={origin:'upload',content:text},whole=sm.modelSourceContent(s,allow),w=sm.modelSourceExcerpt(s,limit,allow);return w.content===whole.slice(0,limit)&&w.excerpt===(whole.length>limit)};
 check('window masking equals whole-text masking at every offset',Array.from({length:40},(_,k)=>k*7).every(k=>same('가'.repeat(k)+chunk.repeat(500),3500)&&same('가'.repeat(k)+chunk.repeat(500),4500)));
 const hex=i=>(i.toString(16).padStart(4,'0')+'ab12cd34').repeat(8).slice(0,64);
 const ids=n=>Array.from({length:n},(_,i)=>hex(i)).join(' ');
 check('window grows when masking shrinks the text (64-hex ids) and still equals whole-text masking',same(ids(1200),3500)&&same(ids(400),3500)&&sm.modelSourceExcerpt({origin:'upload',content:ids(400)},3500,allow).excerpt===false);
 // 첫 창을 가린 길이가 상한을 겨우 넘고 번호가 창 끝에 걸친 본문: 여유분이 없으면 창 끝에서 잘려 탐지되지 않은 번호 조각이 보낸 본문 끝에 들어간다.
 const head=ids(8)+' '+Array(7).fill(USER.phone).join(' ')+' ';
 check('a number across the window end never reaches the sent excerpt',[4000,4001,4002].every(k=>same(head+'가'.repeat(k-head.length)+USER.phone+'가'.repeat(3000),3500)));
 const heavy='101동 '.repeat(16000),t0=performance.now(),many=sm.modelSources(Array.from({length:20},()=>({origin:'upload',title:'t',scope:'s',url:'',content:heavy})),3500,Array.from({length:120},(_,i)=>`가상시 가상로 ${i+1}`),'sources'),ms=performance.now()-t0;
 check(`20 dense 80,000-char sources are masked within the time bound (${Math.round(ms)}ms)`,ms<1500&&many.texts.every(t=>t.content.length===3500&&t.excerpt===true));
}

// ── (2)(3) 실행 경로: 모의 HERMES ──
const HERMES='https://hermes.example.com',posts=[],external=[];let seq=0;
const {sql,load}=testRuntime(async(url,options={})=>{
 url=String(url);if(!url.startsWith(HERMES+'/')){external.push(url);throw new Error('모의 주소만 호출합니다: '+url)}
 if(url===HERMES+'/v1/runs'&&options.method==='POST'){posts.push(options.body);return Response.json({run_id:'run_'+ ++seq})}
 return new Response('{}',{status:404});
});
// 콘솔 출력(DP-4): 실행 중 모든 console 출력을 모은다.
const logged=[];for(const k of ['log','warn','error','info','debug']){const orig=console[k].bind(console);console[k]=(...a)=>{logged.push(a.map(String).join(' '));orig(...a)}}
const server=await load('lib/server.ts'),research=await load('lib/research-execution.ts'),archive=await load('lib/archive-server.ts'),role=await load('lib/role-execution.ts'),meeting=await load('lib/meeting-execution.ts'),brief=await load('lib/brief-execution.ts');
const now=new Date().toISOString(),owner='sm-owner';
const put=(kind,id,data,parent='')=>server.recordStatement(owner,kind,id,data,parent).run();
await server.database().prepare('INSERT INTO settings(owner,secret,model,updated_at) VALUES(?,?,?,?)').bind(owner,await server.encrypt(JSON.stringify({provider:'hermes',endpoint:HERMES,key:'mock-only'})),'HERMES',now).run();
await put('worker_credential','current',{id:'current',tokenHash:'fixture'});
const brand={id:'sm-brand',name:'가상분식',short:'GB',category:'SNACK BAR',color:'#224466',bg:'#eef2f6',description:'',audience:'가상동 주민(가설)',tone:'명료한',constraints:'가격은 확인 전 확정하지 않는다.',knowledge:''};
await put('brand',brand.id,brand);
const shop={id:'sm-store',brandId:brand.id,name:'가상분식 가상점',address:STORE_ADDRESS,tradeArea:'residential',customer:'가상 고객',goal:'평일 방문',daypart:'점심',menu:'떡볶이',hours:'11-21',access:`문의 ${STORE_PHONE}`,capacity:'20석',economics:'미확인',competitors:'미확인',status:'active',version:1,createdAt:now,updatedAt:now};
await put('store',shop.id,shop,brand.id);
await put('brand_fact','sm-fact-phone',{id:'sm-fact-phone',brandId:brand.id,key:'전화',value:FACT_PHONE,status:'confirmed',source:'합성 원장',verifiedAt:now,validUntil:'2099-12-31T00:00:00.000Z',version:1,updatedAt:now},brand.id);
const source=(id,origin,content,extra={})=>({id,brandId:brand.id,title:'합성 자료 '+id,category:'customer',origin,status:'confirmed',url:'',content,scope:'사용자가 입력한 자료',observedAt:now,createdAt:now,version:1,...extra});
const sources=[source('sm-upload','upload',userText,{title:UPLOAD_TITLE,scope:UPLOAD_SCOPE,fileName:UPLOAD_TITLE,extraction:'텍스트 추출 완료',extractedBy:'server'}),source('sm-manual','manual',userText,{url:MANUAL_URL}),source('sm-research','research',researchText,{title:RESEARCH_TITLE,url:'https://example.com/synthetic-review',scope:'공개 리뷰 관찰'}),source('sm-plain','upload',plainText,{fileName:'menu.txt'})];
for(const s of sources)await put('brand_source',s.id,s,brand.id);
const byId=list=>Object.fromEntries(list.map(s=>[s.id,s]));
const indexOf=(list,id)=>list.findIndex(s=>s.id===id);
const stored=async id=>JSON.parse((await server.readRecord(owner,'hermes_submission',id)).body);
// 사용자 자료의 네 필드는 가린 값, 조사·탐지 없는 자료는 원문이다(심층 조사·지점 조사·역할·회의·브리프 공통).
const sentSourcesOk=got=>got['sm-upload'].content===userMasked&&got['sm-upload'].title===UPLOAD_TITLE_MASKED&&got['sm-upload'].scope===UPLOAD_SCOPE_MASKED&&got['sm-manual'].content===userMasked&&got['sm-manual'].url===MANUAL_URL_MASKED&&got['sm-research'].content===researchText&&got['sm-research'].title===RESEARCH_TITLE&&got['sm-plain'].content===plainText;
// 입력의 자료 목록(list)과 가림 기록(masking)이 입력 경로(path) 기준으로 맞는지 본다. 조사·탐지 없는 자료의 기록은 없다.
const recordOk=(masking,list,path)=>JSON.stringify(recordOf(masking,`${path}.${indexOf(list,'sm-upload')}`))===JSON.stringify(UPLOAD_RECORD)&&JSON.stringify(recordOf(masking,`${path}.${indexOf(list,'sm-manual')}`))===JSON.stringify(MANUAL_RECORD)&&recordOf(masking,`${path}.${indexOf(list,'sm-research')}`).length===0&&recordOf(masking,`${path}.${indexOf(list,'sm-plain')}`).length===0&&userLeaks(JSON.stringify(masking)).length===0;

// ── (2) 조사 제출: 브랜드 심층 조사(대화형 1단계)와 지점 조사 ──
{
 await research.executeResearch(owner,{action:'start',id:'sm-deep',brandId:brand.id});await research.executeResearch(owner,{action:'advance',id:'sm-deep'});
 check('deep research submitted once',posts.length===1);
 const sent=JSON.parse(posts.at(-1)),input=JSON.parse(sent.input),got=byId(input.sources);
 check('deep research masks the upload source content',got['sm-upload'].content===userMasked&&got['sm-upload'].excerpt===false);
 check('deep research masks the manual source content',got['sm-manual'].content===userMasked);
 check('deep research sends the research source verbatim',got['sm-research'].content===researchText&&sent.input.includes(PUBLIC.phone)&&sent.input.includes(PUBLIC.email));
 check('deep research masks user source title, scope and url and keeps research fields',sentSourcesOk(got));
 check('allow-listed store phone, store address and confirmed fact stay in brand-level research',got['sm-upload'].content.includes(STORE_PHONE)&&got['sm-upload'].content.includes(STORE_ADDRESS)&&got['sm-upload'].content.includes(FACT_PHONE));
 check('a source without detections is sent byte-identical',got['sm-plain'].content===plainText&&got['sm-plain'].excerpt===false);
 check('the deep research body carries no user-provided personal data',userLeaks(posts.at(-1).replace(researchText,'')).length===0);
 check('the stored submission equals the sent body',JSON.stringify(await stored('sm-deep-investigation'))===posts.at(-1));
 const deepStep=(await server.readRecord(owner,'brand_research','sm-deep')).steps.find(s=>s.id==='sm-deep-investigation');
 check('the research step records source masking by field, kind and count without values',Array.isArray(deepStep.inputMasking)&&recordOk(deepStep.inputMasking,input.sources,'sources'));
 // 지점 조사: 허용 값은 조사 스냅샷의 지점 레코드와 지점 범위 확정 사실에서 온다.
 sql.prepare("UPDATE jobs SET status='completed' WHERE owner=?").run(owner);
 await research.executeResearch(owner,{action:'start',id:'sm-store-r',brandId:brand.id,storeId:shop.id});await research.executeResearch(owner,{action:'advance',id:'sm-store-r'});
 const storeSent=JSON.parse(posts.at(-1)),storeGot=byId(JSON.parse(storeSent.input).sources);
 check('store research masks user sources and keeps the store and fact values',storeGot['sm-upload'].content===userMasked&&storeGot['sm-manual'].content===userMasked&&storeGot['sm-research'].content===researchText&&sentSourcesOk(storeGot));
 check('the store research body carries no user-provided personal data',userLeaks(posts.at(-1).replace(researchText,'')).length===0);
 const records=await Promise.all(sources.map(s=>server.readRecord(owner,'brand_source',s.id)));
 check('stored source records keep the original content, title, scope and url',records.every((r,i)=>r.content===sources[i].content&&r.title===sources[i].title&&r.scope===sources[i].scope&&r.url===sources[i].url));
}

// ── (3) 제작 경로: brandArchiveInput(역할·회의·브리프 공통)과 각 제출 ──
const bodySources=body=>JSON.parse(JSON.parse(body).input).brandArchive.confirmedSources;
{
 const brandLevel=byId((await archive.brandArchiveContext(owner,brand.id)).confirmedSources);
 check('brand-level archive context masks confirmed upload and manual sources',brandLevel['sm-upload'].content===userMasked&&brandLevel['sm-manual'].content===userMasked&&brandLevel['sm-upload'].excerpt===false);
 check('brand-level archive context keeps research and undetected sources verbatim',brandLevel['sm-research'].content===researchText&&brandLevel['sm-plain'].content===plainText&&sentSourcesOk(brandLevel));
 const storeLevel=byId((await archive.brandArchiveContext(owner,brand.id,shop.id)).confirmedSources);
 check('store archive context masks user sources with the store allow values',storeLevel['sm-upload'].content===userMasked&&storeLevel['sm-research'].content===researchText);
 const {archive:inputArchive,sourceMasking}=await archive.brandArchiveInput(owner,brand.id);
 check('the masking record stays outside the model input archive',!('sourceMasking' in inputArchive)&&recordOk(sourceMasking,inputArchive.confirmedSources,'brandArchive.confirmedSources'));
 const campaign={id:'sm-campaign',brandId:brand.id,title:'가상분식 오픈',goal:'첫 포장 주문',audience:'가상동 주민',channels:'Instagram',stores:'가상점',products:'떡볶이',budget:null,startDate:'',endDate:'',constraints:'할인 약속 금지.',sources:'',plan:{},status:'draft',version:1,createdAt:now,updatedAt:now};
 await put('campaign',campaign.id,campaign);
 const started=await (await role.executeRole(owner,{action:'start',campaignId:campaign.id,role:'cmo'})).json();
 assert.ok(started.id,`역할 시작 실패: ${JSON.stringify(started)}`);
 const roleBody=posts.at(-1),roleList=bodySources(roleBody),roleGot=byId(roleList);
 check('role submission masks confirmed user sources and keeps research sources',roleGot['sm-upload'].content===userMasked&&roleGot['sm-manual'].content===userMasked&&roleGot['sm-research'].content===researchText&&sentSourcesOk(roleGot));
 check('the role body carries no user-provided personal data and equals the stored submission',userLeaks(roleBody.replace(researchText,'')).length===0&&JSON.stringify(await stored(started.id))===roleBody);
 const contract=await server.readRecord(owner,'role_output_contract',started.id);
 check('role_output_contract.inputMasking records source masking (allow-listed detections as allowed:true) without values',recordOk(contract.inputMasking,roleList,'brandArchive.confirmedSources'));
 check('the role body does not carry the masking record',!JSON.parse(JSON.parse(roleBody).input).sourceMasking&&!roleBody.includes('sourceMasking'));

 // 회의: 시작 때 가린 자료와 가림 기록을 스냅샷에 두고, 단계마다 가림 기록에 합친다. 역할 작업이 진행 중인 캠페인과 다른 캠페인을 쓴다.
 await put('campaign','sm-meeting-campaign',{...campaign,id:'sm-meeting-campaign',title:'가상분식 회의'});
 const opened=await (await meeting.executeMeeting(owner,{action:'start',id:'sm-meeting',campaignId:'sm-meeting-campaign',campaignVersion:1,agenda:'합성 안건: 자료 검토'})).json();
 assert.equal(opened.status,'running',`회의 시작 실패: ${JSON.stringify(opened)}`);
 await meeting.executeMeeting(owner,{action:'advance',id:'sm-meeting'});
 const meetingBody=posts.at(-1),meetingList=bodySources(meetingBody),meetingRecord=await server.readRecord(owner,'team_meeting','sm-meeting');
 check('meeting step submission masks user sources and keeps research sources',sentSourcesOk(byId(meetingList)));
 check('the meeting body carries no user-provided personal data and equals the stored submission',userLeaks(meetingBody.replace(researchText,'')).length===0&&JSON.stringify(await stored('sm-meeting:discussion:cmo'))===meetingBody);
 check('team_meeting.steps[].inputMasking records source masking without values',recordOk(meetingRecord.steps[0].inputMasking,meetingList,'brandArchive.confirmedSources'));
 check('the meeting snapshot keeps the masking record outside the model input',Array.isArray(meetingRecord.snapshot.sourceMasking)&&!meetingBody.includes('sourceMasking'));

 // 전환 구간(DP3-B-02·SEC-3): 가림 이전에 시작한 회의(스냅샷에 가림 기록 없음, 원문 자료)는 다음 단계 제출 때 새 회의와 같은 규칙으로 가린다.
 // 레코드가 지워진 자료는 사용자 자료로 보고 스냅샷 값을 가린다.
 const rawSources=meetingRecord.snapshot.brandArchive.confirmedSources.map(c=>{const s=sources.find(x=>x.id===c.id);return {...c,title:s.title,url:s.url,scope:s.scope,content:s.content.slice(0,3500),excerpt:s.content.length>3500}});
 const deleted={id:'sm-deleted',title:`지운 자료 ${USER.phone}`,category:'customer',url:'',observedAt:now,scope:'사용자가 입력한 자료',content:`지운 메모 ${USER.email}`,excerpt:false,version:1};
 const legacySnapshot=Object.fromEntries(Object.entries(meetingRecord.snapshot).filter(([k])=>k!=='sourceMasking'));
 const legacy={...meetingRecord,id:'sm-legacy',status:'running',steps:meetingRecord.steps.map(({id,role:r,phase})=>({id:id.replace('sm-meeting','sm-legacy'),role:r,phase,status:'pending'})),snapshot:{...legacySnapshot,brandArchive:{...legacySnapshot.brandArchive,confirmedSources:[...rawSources,deleted]}}};
 await put('team_meeting','sm-legacy',legacy,'sm-meeting-campaign');
 check('the crafted legacy snapshot carries raw user source values',userLeaks(JSON.stringify(legacy.snapshot.brandArchive).replace(researchText,'')).length>0);
 await meeting.executeMeeting(owner,{action:'advance',id:'sm-legacy'});
 const legacyBody=posts.at(-1),legacyList=bodySources(legacyBody),legacyRecord=await server.readRecord(owner,'team_meeting','sm-legacy');
 check('a legacy meeting step masks user sources by record origin and keeps research sources',sentSourcesOk(byId(legacyList))&&byId(legacyList)['sm-deleted'].title==='지운 자료 [전화번호]'&&byId(legacyList)['sm-deleted'].content==='지운 메모 [이메일]');
 check('the legacy meeting body carries no user-provided personal data and equals the stored submission',userLeaks(legacyBody.replace(researchText,'')).length===0&&JSON.stringify(await stored('sm-legacy:discussion:cmo'))===legacyBody);
 check('the legacy snapshot is stored masked with its masking record',Array.isArray(legacyRecord.snapshot.sourceMasking)&&userLeaks(JSON.stringify(legacyRecord.snapshot.brandArchive).replace(researchText,'')).length===0&&recordOk(legacyRecord.steps[0].inputMasking,legacyList,'brandArchive.confirmedSources'));

 // 브리프: 제출 본문과 brief_draft.inputMasking.
 const drafted=await (await brief.executeBrief(owner,{action:'start',id:'sm-brief',data:{brandId:brand.id,title:'가상 초안',goal:'첫 포장 주문'}})).json();
 assert.equal(drafted.status,'queued',`브리프 제출 실패: ${JSON.stringify(drafted)}`);
 const briefBody=posts.at(-1),briefList=bodySources(briefBody),draft=await server.readRecord(owner,'brief_draft','sm-brief');
 check('brief submission masks user sources and keeps research sources',sentSourcesOk(byId(briefList)));
 check('the brief body carries no user-provided personal data and equals the stored submission',userLeaks(briefBody.replace(researchText,'')).length===0&&JSON.stringify(await stored('brief-sm-brief'))===briefBody);
 check('brief_draft.inputMasking records source masking without values',recordOk(draft.inputMasking,briefList,'brandArchive.confirmedSources'));
}

check('no detected value was written to the console',userLeaks(logged.join('\n')).length===0);
check('no external call was made',external.length===0&&posts.length===6);
console.log(JSON.stringify({passed}));
