import assert from 'node:assert/strict';
import {deflateSync} from 'node:zlib';
import {readFileSync} from 'node:fs';
import {testRuntime} from './helpers/runtime.mjs';

// C2 AI 생성 이미지 표시(AI 기본법 31조). 순수 PNG 함수(iTXt 왕복·CRC·청크 배열), 스위치 꺼짐 바이트 불변, 출처 불명 경고 기록, AI 출처 표시+감사 기록,
// 반출 감사(앱 공개 사본), 가상인물 캡션 줄과 규제 규칙 해소, 화면 가시 표시 자리를 실제 SQLite로 검증한다. Buffer·R2는 모의 응답이다(mocked).
function crc32(bytes){let crc=0xffffffff;for(const byte of bytes){crc^=byte;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0)}return (crc^0xffffffff)>>>0}
function chunk(type,data){const name=Buffer.from(type),size=Buffer.alloc(4),crc=Buffer.alloc(4);size.writeUInt32BE(data.length);crc.writeUInt32BE(crc32(Buffer.concat([name,data])));return Buffer.concat([size,name,data,crc])}
const signature=Buffer.from([137,80,78,71,13,10,26,10]);
function ihdr(size){const b=Buffer.alloc(13);b.writeUInt32BE(size,0);b.writeUInt32BE(size,4);b[8]=8;b[9]=2;return b}
function fixture(size,fill=0){const pixels=Buffer.alloc((size*3+1)*size,fill);for(let row=0;row<size;row++)pixels[row*(size*3+1)]=0;return Buffer.concat([signature,chunk('IHDR',ihdr(size)),chunk('IDAT',deflateSync(pixels)),chunk('IEND',Buffer.alloc(0))])}
const tiny=new Uint8Array(fixture(1)),card=fixture(1080),dataUrl=bytes=>'data:image/png;base64,'+Buffer.from(bytes).toString('base64');

let checks=0;const failures=[];function check(value,label){checks++;if(!value)failures.push(label)}
const rt=testRuntime(async(url,init={})=>{
 if(String(url).startsWith('https://res.cloudinary.com/'))return new Response(card,{headers:{'content-type':'image/png'}});
 const {query,variables}=JSON.parse(init.body);
 if(query.includes('organizations'))return Response.json({data:{account:{organizations:[{id:'org',name:'ODA 조직'}]}}});
 if(query.includes('channels('))return Response.json({data:{channels:[{id:'channel-1',name:'ODA',service:'instagram',isQueuePaused:false}]}});
 if(query.includes('createPost'))return Response.json({data:{createPost:{__typename:'PostActionSuccess',post:{id:'post-1',status:'scheduled'}}}});
 return Response.json({data:{post:{id:variables.id,status:'scheduled',channelId:'channel-1'}}});
});
const objects=new Map();rt.env.BUCKET={put:async(k,v)=>objects.set(k,new Uint8Array(v)),get:async k=>objects.has(k)?{size:objects.get(k).length,arrayBuffer:async()=>objects.get(k).slice().buffer,body:new Response(objects.get(k).slice()).body}:null,head:async k=>objects.has(k)?{size:objects.get(k).length}:null,delete:async k=>objects.delete(k)};
const image=await rt.load('lib/ai-disclosure-image.ts'),text=await rt.load('lib/ai-disclosure.ts'),render=await rt.load('lib/creative-render.ts'),compliance=await rt.load('lib/graders/compliance.ts');
const server=await rt.load('lib/server.ts'),route=await rt.load('app/api/execution/route.ts'),flags=await rt.load('lib/feature-flags.ts'),exec=await rt.load('lib/execution.ts'),status=await rt.load('lib/feature-status.ts'),kinds=await rt.load('lib/record-kinds.ts');
const put=(kind,id,value,parent='')=>server.recordStatement('owner',kind,id,value,parent).run();
const rows=kind=>rt.sql.prepare("SELECT data FROM records WHERE owner='owner' AND kind=?").all(kind).map(r=>JSON.parse(r.data));
async function post(action,campaignId,data={}){
 const response=await route.POST(new Request('https://app.test/api/execution',{method:'POST',headers:{'content-type':'application/json','oai-authenticated-user-id':'owner',origin:'https://app.test'},body:JSON.stringify({action,campaignId,...data})}));
 return {status:response.status,data:await response.json()};
}
const setFlag=enabled=>flags.setFeatureFlag('owner',{flag:'ai_image_disclosure',enabled},{id:'owner',email:null});
const fresh=()=>put('execution_rate','execution',{startedAt:Date.now(),count:0});
const at=offset=>new Date(Date.UTC(2098,0,1,0,offset)).toISOString();
const campaignFixture=(id,extra={})=>({id,brandId:'oda',title:'ODA',version:1,status:'approved',startDate:'2098-01-01',endDate:'2098-12-31',budget:100000,budgetConfirmedAt:'2026-09-01T00:00:00.000Z',...extra});

// 1) 순수 PNG 함수: 1×1 PNG에 표시 청크를 넣으면 IEND 앞에 iTXt가 하나 생기고, CRC가 맞고, 다시 읽으면 같은 payload다. 픽셀 청크는 그대로다.
const payload=image.disclosurePayload({origin:'ai',model:'test-model',createdAt:'2026-11-09T00:00:00.000Z',virtualPerson:true});
const marked=image.addDisclosureChunk(tiny,payload);
check(image.readDisclosureChunk(tiny)===null,'an unmarked PNG reads as null');
check(marked!==tiny&&tiny.length===fixture(1).length&&image.readDisclosureChunk(tiny)===null,'the input bytes are not mutated');
const layout=image.pngChunks(marked);
check(layout.map(c=>c.type).join(',')==='IHDR,IDAT,iTXt,IEND','the disclosure iTXt sits right before IEND: '+layout.map(c=>c.type).join(','));
check(layout.every(c=>crc32(marked.subarray(c.offset+4,c.offset+12+c.length-4))===new DataView(marked.buffer,marked.byteOffset).getUint32(c.offset+8+c.length)),'every chunk CRC (including the new one) verifies with an independent CRC32');
check(Buffer.compare(Buffer.from(layout[1].data),Buffer.from(image.pngChunks(tiny)[1].data))===0,'IDAT bytes are untouched');
const back=image.readDisclosureChunk(marked);
check(JSON.stringify(back)===JSON.stringify({origin:'ai',generator:'COLLECTIVE',model:'test-model',createdAt:'2026-11-09T00:00:00.000Z',policy:'KR-AI-Basic-Act-31',virtualPerson:true}),'the chunk round-trips the disclosure JSON: '+JSON.stringify(back));
check(image.decodeITXt(layout[2].data).keyword==='ai-disclosure'&&layout[2].data[layout[2].data.indexOf(0)+1]===0,'keyword is ai-disclosure and the text is uncompressed');
const twice=image.addDisclosureChunk(marked,{...payload,virtualPerson:false});
check(image.pngChunks(twice).filter(c=>c.type==='iTXt').length===1&&image.readDisclosureChunk(twice).virtualPerson===false,'re-marking replaces the previous disclosure chunk instead of adding a second one');
check(Buffer.compare(Buffer.from(image.addDisclosureChunk(tiny,payload)),Buffer.from(marked))===0,'same bytes and same payload give identical output (deterministic hash)');
let broken=null;try{image.pngChunks(new Uint8Array([1,2,3]))}catch(e){broken=e.message}
check(broken!==null,'non-PNG input throws instead of being marked');
const corrupt=Uint8Array.from(marked);corrupt[corrupt.length-5]^=1;let corruptError=null;try{image.pngChunks(corrupt)}catch(e){corruptError=e.message}
check(/CRC/.test(corruptError||''),'a wrong CRC is detected: '+corruptError);
check(image.imageDisclosurePlan('ai',false)==='off'&&image.imageDisclosurePlan('ai',true)==='mark'&&image.imageDisclosurePlan('ai_edited',true)==='mark'&&image.imageDisclosurePlan('manual',true)==='skip_manual'&&image.imageDisclosurePlan('unknown',true)==='warn_unknown','plan: off / mark ai·ai_edited / skip manual / warn unknown');
check(image.normalizeImageOrigin('AI')==='unknown'&&image.normalizeImageOrigin(undefined)==='unknown'&&image.normalizeImageOrigin('manual')==='manual','origins outside ai·ai_edited·manual are unknown');

// 2) 텍스트 표시: 가상인물 줄은 심사지침 문구이고 AI 줄 뒤에 붙는다. 둘 다 없으면 null(이전 캡션 바이트 불변).
const LINE='이 게시물의 문구는 AI의 도움을 받아 작성하고 담당자가 확인했습니다.',VP='AI를 기반으로 생성된 가상인물이 포함된 게시물입니다.';
check(text.VIRTUAL_PERSON_LINE===VP,'virtual person sentence is the single exported constant');
check(text.disclosureLine({aiGenerated:true,virtualPerson:true})===LINE+'\n'+VP&&text.disclosureLine({aiGenerated:false,virtualPerson:true})===VP&&text.disclosureLine({aiGenerated:true})===LINE&&text.disclosureLine({virtualPerson:false})===null,'disclosure lines: AI, virtual person, both, none');
check(JSON.stringify(text.copyDisclosure({origin:'ai',virtualPerson:true}))==='{"aiGenerated":true,"virtualPerson":true}'&&JSON.stringify(text.copyDisclosure({origin:'ai'}))==='{"aiGenerated":true}'&&JSON.stringify(text.copyDisclosure({origin:'manual',virtualPerson:false}))==='{"aiGenerated":false}','copyDisclosure keeps the stored copy shape when nothing is declared');
const vpCaption=exec.composeCaption({text:'버추얼 인플루언서 소라와 함께한 신메뉴 소개',aiGenerated:true,virtualPerson:true},'주소: 휘경동 377');
check(vpCaption==='버추얼 인플루언서 소라와 함께한 신메뉴 소개\n\n주소: 휘경동 377\n\n'+LINE+'\n'+VP,'composed caption ends with AI line then the virtual person line: '+JSON.stringify(vpCaption));
const undisclosed=compliance.checkCompliance('버추얼 인플루언서 소라와 함께한 신메뉴 소개\n\n주소: 휘경동 377').issues.filter(i=>i.ruleId==='virtual_person_undisclosed');
const disclosed=compliance.checkCompliance(vpCaption).issues.filter(i=>i.ruleId==='virtual_person_undisclosed');
check(undisclosed.length===1&&undisclosed[0].severity==='block','a virtual influencer caption without the line is blocked by virtual_person_undisclosed');
check(disclosed.length===0,'the virtual person line resolves virtual_person_undisclosed: '+JSON.stringify(disclosed));

// 3) 화면 가시 표시 자리(순수): 왼쪽 정렬, 코드 라벨과 겹치면 null, 라벨 문구에 가상인물 덧붙임.
check(JSON.stringify(render.disclosureBadgeBox(200))==='{"x":72,"y":212,"width":228,"height":34}','badge box is left aligned on the empty row');
check(render.disclosureBadgeBox(200,{x:320})!==null&&render.disclosureBadgeBox(200,{x:300})===null&&render.disclosureBadgeBox(0)===null,'badge box refuses to overlap the code badge or an empty label');
check(render.disclosureBadgeLabel(image.AI_IMAGE_VISIBLE_LABEL,image.VIRTUAL_PERSON_IMAGE_LABEL,true)==='AI 생성 · COLLECTIVE · 가상인물'&&render.disclosureBadgeLabel(image.AI_IMAGE_VISIBLE_LABEL,image.VIRTUAL_PERSON_IMAGE_LABEL,false)==='AI 생성 · COLLECTIVE','visible label wording');

// 4) 스위치·기능표·kind 레지스트리.
check(flags.FEATURE_FLAGS.ai_image_disclosure?.defaultEnabled===false&&/31조/.test(flags.FEATURE_FLAGS.ai_image_disclosure.description),'flag ai_image_disclosure exists, default off, Korean description');
const row=status.featureRows({flags:[{flag:'ai_image_disclosure',enabled:false}]}).find(r=>r.key==='ai-image-disclosure');
check(row?.flag==='ai_image_disclosure'&&row.status==='blocked'&&row.reason[0]==='기능 꺼짐'&&status.featureRows({flags:[{flag:'ai_image_disclosure',enabled:true}]}).find(r=>r.key==='ai-image-disclosure').reason.length===3,'feature-status row reads the flag');
check(kinds.recordKinds.some(k=>k.kind==='ai_image_disclosure'&&k.campaignDeletion==='retain'&&k.purge==='keep'),'record kind ai_image_disclosure is registered as retained audit');

// 5) 서버: 스위치 꺼짐이면 저장 바이트가 그대로다(해시 동일, 기록 없음). 켜면 출처 불명은 그대로 저장 + 경고 기록, AI 출처는 표시 + 기록, 같은 입력은 같은 소재로 중복 판정된다.
await server.seedBrands('owner');
const fact={id:'fact',brandId:'oda',key:'address',value:'휘경동 377 C107',status:'confirmed',source:'owner',verifiedAt:new Date().toISOString(),validUntil:'2099-01-01T00:00:00Z',version:1};
await put('brand_fact','fact',fact,'oda');
await put('campaign','conn-oda',campaignFixture('conn-oda'));assert.equal((await post('connect_buffer','conn-oda',{token:'test-token-not-a-secret',organizationId:'org',channelId:'channel-1'})).status,200,'fixture publisher');
async function setup(id){await fresh();await put('campaign',id,campaignFixture(id));assert.equal((await post('save_limits',id,{maxPublications:5,maxPlannedCostKRW:0})).status,200,'fixture limits')}
const save=(id,extra={})=>post('save_creative',id,{campaignVersion:1,factRefs:[{id:'fact',version:1}],png:dataUrl(card),...extra});
const rawHash=await image.sha256Hex(new Uint8Array(card));
await setup('off');
const off=await save('off',{image:{origin:'ai'}});
check(off.status===200&&off.data.pngHash===rawHash&&rows('ai_image_disclosure').length===0,'flag off: AI-origin bytes are stored unchanged and nothing is logged');
check(image.readDisclosureChunk(objects.get(rows('execution_creative').find(c=>c.pngHash===rawHash).objectKey))===null,'flag off: stored object has no disclosure chunk');
await setFlag(true);
await setup('unk');
const unknown=await save('unk');
const warnings=rows('ai_image_disclosure').filter(r=>r.action==='unknown_origin');
check(unknown.status===200&&unknown.data.pngHash===rawHash&&warnings.length===1&&warnings[0].campaignId==='unk'&&warnings[0].origin==='unknown'&&warnings[0].hashBefore===rawHash&&warnings[0].marked===false,'unknown origin: not marked, not blocked, one warning record');
const bogus=await save('unk',{image:{origin:'robot'}});
check(bogus.status===200&&rows('ai_image_disclosure').filter(r=>r.action==='unknown_origin').length===2,'an unrecognised origin value is treated as unknown');
check((await save('unk',{image:{origin:'ai',virtualPerson:'yes'}})).status===400,'virtualPerson must be boolean');
await setup('manual');
const manual=await save('manual',{image:{origin:'manual'}});
check(manual.status===200&&manual.data.pngHash===rawHash&&rows('ai_image_disclosure').filter(r=>r.campaignId==='manual').length===0,'manual origin: unchanged, no record');
await setup('ai');
const ai=await save('ai',{image:{origin:'ai_edited',model:'img-gen-1',virtualPerson:true}});
const aiCreative=rows('execution_creative').find(c=>c.campaignId==='ai');
const stored=objects.get(aiCreative.objectKey),chunkOf=image.readDisclosureChunk(stored);
check(ai.status===200&&ai.data.pngHash!==rawHash&&ai.data.pngHash===await image.sha256Hex(stored),'AI origin: stored bytes differ from the upload and the creative hash is the marked hash');
check(chunkOf?.origin==='ai_edited'&&chunkOf.model==='img-gen-1'&&chunkOf.virtualPerson===true&&chunkOf.policy==='KR-AI-Basic-Act-31'&&chunkOf.generator==='COLLECTIVE','stored object carries the disclosure chunk');
const markedRecords=rows('ai_image_disclosure').filter(r=>r.action==='marked');
check(markedRecords.length===1&&markedRecords[0].id===ai.data.pngHash&&markedRecords[0].hashBefore===rawHash&&markedRecords[0].hashAfter===ai.data.pngHash&&markedRecords[0].policy==='KR-AI-Basic-Act-31'&&markedRecords[0].campaignId==='ai'&&markedRecords[0].virtualPerson===true,'marked audit record: hash before/after, policy, campaign');
const again=await save('ai',{image:{origin:'ai_edited',model:'img-gen-1',virtualPerson:true}});
check(again.status===200&&again.data.id===ai.data.id&&rows('execution_creative').filter(c=>c.campaignId==='ai').length===1&&rows('ai_image_disclosure').filter(r=>r.action==='marked').length===1,'the same AI upload reuses the first payload and dedupes to the same creative');
const other=await save('ai',{image:{origin:'ai',model:'img-gen-1',virtualPerson:true}});
check(other.status===200&&other.data.id!==ai.data.id&&rows('ai_image_disclosure').filter(r=>r.action==='marked').length===2,'a different origin makes a different marked PNG and record');
// 소재 다운로드(/api/execution/asset)는 저장 바이트를 그대로 내보내므로 표시 청크가 함께 나간다.
const asset=await rt.load('app/api/execution/asset/route.ts');
const download=await asset.GET(new Request('https://app.test/api/execution/asset?id='+ai.data.id,{headers:{'oai-authenticated-user-id':'owner'}}));
check(download.status===200&&image.readDisclosureChunk(new Uint8Array(await download.arrayBuffer()))?.origin==='ai_edited','the asset download carries the disclosure chunk');

// 6) 반출 감사: 승인 때 앱 공개 사본을 만들면 export 기록(표시 유무)이 남고 공개 바이트에 표시 청크가 있다. 스위치가 꺼지면 반출 기록이 늘지 않는다.
const draft=await post('save_publication','ai',{creativeId:ai.data.id,mediaUrl:'',scheduledAt:at(5),plannedCostKRW:0});assert.equal(draft.status,200,JSON.stringify(draft.data));
const credential=await server.readRecord('owner','publisher_credential','oda'),limits=await server.readRecord('owner','execution_limits','ai');
const approved=await post('approve','ai',{id:draft.data.id,version:draft.data.version,confirmed:true,rightsConfirmed:true,channelId:'channel-1',credentialVersion:credential.version,limitsVersion:limits.version});
const exportsNow=rows('ai_image_disclosure').filter(r=>r.action==='export');
check(approved.status===200&&exportsNow.length===1&&exportsNow[0].channel==='public_media'&&exportsNow[0].marked===true&&exportsNow[0].artifactId===ai.data.id&&exportsNow[0].publicationId===draft.data.id&&exportsNow[0].hashBefore===ai.data.pngHash,'approving logs a public_media export audit with the marked chunk: '+JSON.stringify(approved.data).slice(0,120));
check(image.readDisclosureChunk(objects.get('public/'+ai.data.pngHash+'.png'))?.origin==='ai_edited','the public copy keeps the disclosure chunk');
await setFlag(false);
await setup('off2');
const plain=await save('off2',{image:{origin:'ai'}});
const draft2=await post('save_publication','off2',{creativeId:plain.data.id,mediaUrl:'',scheduledAt:at(6),plannedCostKRW:0});
const limits2=await server.readRecord('owner','execution_limits','off2');
const approved2=await post('approve','off2',{id:draft2.data.id,version:draft2.data.version,confirmed:true,rightsConfirmed:true,channelId:'channel-1',credentialVersion:credential.version,limitsVersion:limits2.version});
check(approved2.status===200&&rows('ai_image_disclosure').filter(r=>r.action==='export').length===1,'flag off: approval publishes without new export records');

// 7) 가상인물 선언 작업물의 카피: 캡션 줄에 가상인물 문구가 붙고 기록(copy.virtualPerson)이 남는다. 선언이 바뀌면 승인이 409다.
rt.env.AI_COPY_CAPTIONS='enabled';
await setup('vp');
const vpCreative=await save('vp',{image:{origin:'manual'}});
await put('artifact','vp-art',{id:'vp-art',campaignId:'vp',campaignVersion:1,role:'content',title:'콘텐츠 스튜디오 · ODA',content:'## 게시 카피\n\n버추얼 인플루언서 소라와 함께한 신메뉴 소개',version:1,status:'approved',origin:'ai',virtualPerson:true,createdAt:new Date().toISOString()},'vp');
const vpDraft=await post('save_publication','vp',{creativeId:vpCreative.data.id,mediaUrl:'',scheduledAt:at(7),plannedCostKRW:0,copy:{artifactId:'vp-art',artifactVersion:1,index:0}});
check(vpDraft.status===200&&vpDraft.data.copy.aiGenerated===true&&vpDraft.data.copy.virtualPerson===true&&vpDraft.data.caption.endsWith(LINE+'\n'+VP),'a virtual-person artifact copy records virtualPerson and the caption ends with both lines: '+JSON.stringify(vpDraft.data.caption));
await put('artifact','vp-art',{...(await server.readRecord('owner','artifact','vp-art')),virtualPerson:false},'vp');
const limitsVp=await server.readRecord('owner','execution_limits','vp');
const vpApprove=await post('approve','vp',{id:vpDraft.data.id,version:vpDraft.data.version,confirmed:true,rightsConfirmed:true,aiDisclosureConfirmed:true,channelId:'channel-1',credentialVersion:credential.version,limitsVersion:limitsVp.version});
check(vpApprove.status===409&&/가상인물/.test(vpApprove.data.error||JSON.stringify(vpApprove.data)),'removing the declaration after preparing blocks approval with 409: '+JSON.stringify(vpApprove.data).slice(0,120));
rt.env.AI_COPY_CAPTIONS=undefined;

// 8) 문서: 범위·검증 방법·스위치 이름·미해결이 적혀 있다.
const doc=readFileSync('docs/AI-DISCLOSURE.ko.md','utf8');
check(doc.includes('readDisclosureChunk')&&doc.includes('ai_image_disclosure')&&doc.includes('C2PA')&&doc.includes(VP)&&doc.includes('ai-disclosure'),'docs/AI-DISCLOSURE.ko.md covers verification, flag, virtual person line and unresolved C2PA');

if(failures.length){console.error(failures.join('\n'));process.exit(1)}
console.log(JSON.stringify({passed:checks}));
