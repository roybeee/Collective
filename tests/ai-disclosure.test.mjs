import assert from 'node:assert/strict';
import {deflateSync} from 'node:zlib';
import {readFileSync,existsSync,readdirSync} from 'node:fs';
import {testRuntime} from './helpers/runtime.mjs';

// 결정 17: AI 생성물 표시. 판정(origin 파생)·표시 줄 위치·한도·승인 게이트·일치 검사·재준비·제출을 실제 SQLite로 검증한다. Buffer·R2는 모의 응답이다.
function crc32(bytes){let crc=0xffffffff;for(const byte of bytes){crc^=byte;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0)}return (crc^0xffffffff)>>>0}
function chunk(type,data){const name=Buffer.from(type),size=Buffer.alloc(4),crc=Buffer.alloc(4);size.writeUInt32BE(data.length);crc.writeUInt32BE(crc32(Buffer.concat([name,data])));return Buffer.concat([size,name,data,crc])}
const signature=Buffer.from([137,80,78,71,13,10,26,10]),ihdr=Buffer.alloc(13);
ihdr.writeUInt32BE(1080,0);ihdr.writeUInt32BE(1080,4);ihdr[8]=8;ihdr[9]=2;
function fixture(fill=0){const pixels=Buffer.alloc((1080*3+1)*1080,fill);for(let row=0;row<1080;row++)pixels[row*(1080*3+1)]=0;return Buffer.concat([signature,chunk('IHDR',ihdr),chunk('IDAT',deflateSync(pixels)),chunk('IEND',Buffer.alloc(0))])}
const png=fixture(),dataUrl=bytes=>'data:image/png;base64,'+bytes.toString('base64');
let calls=0,lastText='';
const rt=testRuntime(async(url,init={})=>{
 if(String(url).startsWith('https://res.cloudinary.com/'))return new Response(png,{headers:{'content-type':'image/png'}});
 const {query,variables}=JSON.parse(init.body);
 if(query.includes('organizations'))return Response.json({data:{account:{organizations:[{id:'org',name:'ODA 조직'}]}}});
 if(query.includes('channels('))return Response.json({data:{channels:[{id:'channel-1',name:'ODA',service:'instagram',isQueuePaused:false}]}});
 if(query.includes('createPost')){calls++;lastText=variables.input.text;return Response.json({data:{createPost:{__typename:'PostActionSuccess',post:{id:'post-'+calls,status:'scheduled'}}}})}
 return Response.json({data:{post:{id:variables.id,status:'scheduled',channelId:'channel-1'}}});
});
const objects=new Map();rt.env.BUCKET={put:async(k,v)=>objects.set(k,new Uint8Array(v)),get:async k=>objects.has(k)?{arrayBuffer:async()=>objects.get(k).slice().buffer,body:new Response(objects.get(k).slice()).body}:null,head:async k=>objects.has(k)?{size:objects.get(k).length}:null,delete:async k=>objects.delete(k)};
const server=await rt.load('lib/server.ts'),route=await rt.load('app/api/execution/route.ts'),exec=await rt.load('lib/execution.ts');
const disclosure=existsSync('lib/ai-disclosure.ts')?await rt.load('lib/ai-disclosure.ts'):{};
const put=(kind,id,value,parent='')=>server.recordStatement('owner',kind,id,value,parent).run();
let checks=0;const failures=[];function check(value,label){checks++;if(!value)failures.push(label)}
async function post(action,campaignId,data={}){
 const response=await route.POST(new Request('https://app.test/api/execution',{method:'POST',headers:{'content-type':'application/json','oai-authenticated-user-id':'owner',origin:'https://app.test'},body:JSON.stringify({action,campaignId,...data})}));
 return {status:response.status,data:await response.json()};
}
const getState=async id=>(await route.GET(new Request('https://app.test/api/execution?campaignId='+id,{headers:{'oai-authenticated-user-id':'owner'}}))).json();
const fresh=()=>put('execution_rate','execution',{startedAt:Date.now(),count:0});
const at=offset=>new Date(Date.UTC(2098,0,1,0,offset)).toISOString(),cloud=c=>'https://res.cloudinary.com/oda/image/upload/'+c.pngHash+'.png';
const campaignFixture=id=>({id,brandId:'oda',title:'ODA',version:1,status:'approved',startDate:'2098-01-01',endDate:'2098-12-31',budget:100000,budgetConfirmedAt:'2026-09-01T00:00:00.000Z'});
const LINE='이 게시물의 문구는 AI의 도움을 받아 작성하고 담당자가 확인했습니다.';

// 1) 순수 함수: 판정 규칙(origin 파생), 표시 문구 상수 한 곳, 표시 줄 위치.
check(disclosure.AI_DISCLOSURE_LINE===LINE,'disclosure draft line is the single exported constant');
check(disclosure.isAiGenerated?.({origin:'ai'})===true&&disclosure.isAiGenerated({origin:'ai_edited'})===true,'ai and ai_edited artifacts are AI-generated');
check(disclosure.isAiGenerated?.({origin:'manual'})===false&&disclosure.isAiGenerated({})===false&&disclosure.isAiGenerated({origin:'human'})===false&&disclosure.isAiGenerated({origin:'AI'})===false&&disclosure.isAiGenerated({origin:''})===false,'human-written, missing and unknown origins are not AI-generated');
check(disclosure.disclosureLine?.({aiGenerated:true})===LINE&&disclosure.disclosureLine({aiGenerated:false})===null&&disclosure.disclosureLine({})===null&&disclosure.disclosureLine(undefined)===null&&disclosure.disclosureLine()===null,'disclosure line only for AI copy');
const fact='주소: 휘경동 377 C107',code={type:'coupon',code:'CABCD2345'},codeLine=exec.codeLine(code);
check(exec.composeCaption({text:'카피 한 줄',aiGenerated:true},fact)==='카피 한 줄\n\n'+fact+'\n\n'+LINE,'AI copy puts the disclosure line after the fact caption');
check(exec.composeCaption({text:'카피 한 줄',aiGenerated:true},fact,code)==='카피 한 줄\n\n'+fact+'\n\n'+LINE+'\n\n'+codeLine,'disclosure line comes before the A4-2 code line');
check(exec.composeCaption({text:'카피 한 줄',aiGenerated:false},fact,code)===exec.composeCaption('카피 한 줄',fact,code)&&exec.composeCaption({text:'카피 한 줄',aiGenerated:false},fact)==='카피 한 줄\n\n'+fact,'human copy caption is byte-identical to the previous composition');
check(exec.composeCaption({text:'카피 한 줄'},fact)==='카피 한 줄\n\n'+fact&&exec.composeCaption(undefined,fact)===fact&&exec.composeCaption(undefined,fact,code)===fact+'\n\n'+codeLine&&exec.composeCaption('카피 한 줄',fact)==='카피 한 줄\n\n'+fact,'no copy, string copy and records without aiGenerated keep the previous bytes');
const blockerState={creatives:[],limits:{id:'x',version:1,maxPublications:1,maxPlannedCostKRW:0,paused:false},publisher:{connected:true}},blockerCampaign=campaignFixture('x'),aiPub={scheduledAt:at(0),creativeId:'c',copy:{artifactId:'a',artifactVersion:1,index:0,text:'카피',aiGenerated:true}};
const blocked=exec.approvalBlockers({campaign:blockerCampaign,publication:aiPub,state:blockerState,factCount:1,rightsConfirmed:true});
check(blocked.some(b=>b.includes('AI 생성물 표시')),'screen blocks approving AI copy until the disclosure check is ticked');
check(!exec.approvalBlockers({campaign:blockerCampaign,publication:aiPub,state:blockerState,factCount:1,rightsConfirmed:true,aiDisclosureConfirmed:true}).some(b=>b.includes('AI 생성물')),'ticked disclosure check clears the blocker');
check(!exec.approvalBlockers({campaign:blockerCampaign,publication:{...aiPub,copy:{...aiPub.copy,aiGenerated:false}},state:blockerState,factCount:1,rightsConfirmed:true}).some(b=>b.includes('AI 생성물'))&&!exec.approvalBlockers({campaign:blockerCampaign,publication:{scheduledAt:at(0),creativeId:'c'},state:blockerState,factCount:1,rightsConfirmed:true}).some(b=>b.includes('AI 생성물')),'publications without AI copy never need the disclosure check');
// 표시 확인 기록이 없는 AI 카피 승인은 '승인 뒤 바뀐 항목'이다. 화면은 접수 버튼을 막고 재확인 버튼을 보인다.
const driftCred={channelId:'channel-1',version:1},driftLimits={id:'x',version:1,maxPublications:1,maxPlannedCostKRW:0,paused:false},approvedAi={...aiPub,status:'approved',channelId:'channel-1',credentialVersion:1,limitsVersion:1,approvedLimits:{maxPublications:1,maxPlannedCostKRW:0}};
check(exec.approvalDrift(approvedAi,driftCred,driftLimits).includes('AI 생성물 표시 확인'),'approved AI copy without a disclosure record is drift so the screen offers reconfirm');
check(exec.approvalDrift({...approvedAi,aiDisclosureConfirmedBy:'owner',aiDisclosureConfirmedAt:'2098-01-01T00:00:00.000Z'},driftCred,driftLimits).length===0&&exec.approvalDrift({...approvedAi,copy:{...aiPub.copy,aiGenerated:false}},driftCred,driftLimits).length===0,'confirmed AI copy and human copy approvals carry no disclosure drift');
// 화면의 승인 요청 본문(approvalRequest)은 AI 카피에만 표시 확인 값을 싣는다. 사람 카피·카피 없음은 이전 본문과 같다.
const panelState={publisher:{connected:true,channelId:'channel-1',version:3},limits:{...driftLimits,version:4}};
const aiBody=exec.approvalRequest?.(aiPub,panelState,true),humanBody=exec.approvalRequest?.({...aiPub,copy:{...aiPub.copy,aiGenerated:false}},panelState,true),plainBody=exec.approvalRequest?.({scheduledAt:at(0),creativeId:'c'},panelState,true);
check(aiBody?.aiDisclosureConfirmed===true&&exec.approvalRequest(aiPub,panelState,false).aiDisclosureConfirmed===false&&aiBody.confirmed===true&&aiBody.rightsConfirmed===true&&aiBody.immutableMediaConfirmed===true&&aiBody.channelId==='channel-1'&&aiBody.credentialVersion===3&&aiBody.limitsVersion===4,'approval request carries the disclosure tick for AI copy with the screen versions');
check(!!humanBody&&!('aiDisclosureConfirmed' in humanBody)&&JSON.stringify(humanBody)===JSON.stringify(plainBody)&&JSON.stringify(plainBody)===JSON.stringify({confirmed:true,rightsConfirmed:true,immutableMediaConfirmed:true,channelId:'channel-1',credentialVersion:3,limitsVersion:4}),'approval request for human copy or no copy is the previous body without a disclosure field');
// 출처가 없거나 알 수 없는 작업물은 AI 생성물 여부를 판정할 수 없어 캡션에 쓰지 않는다(표시 누락 방지).
check(disclosure.hasKnownOrigin?.({origin:'ai'})===true&&disclosure.hasKnownOrigin({origin:'ai_edited'})===true&&disclosure.hasKnownOrigin({origin:'manual'})===true,'ai, ai_edited and manual origins are known');
check(disclosure.hasKnownOrigin?.({})===false&&disclosure.hasKnownOrigin({origin:'human'})===false&&disclosure.hasKnownOrigin({origin:''})===false&&disclosure.hasKnownOrigin({origin:'AI'})===false,'missing and unknown origins are not known');

// 2) 실제 흐름 픽스처: 브랜드 사실, Buffer 연결, 긴 사실(한도 검사용), AI·사람 작업물.
await server.seedBrands('owner');
await put('brand_fact','fact',{id:'fact',brandId:'oda',key:'address',value:'휘경동 377 C107',status:'confirmed',source:'owner',verifiedAt:new Date().toISOString(),validUntil:'2099-01-01T00:00:00Z',version:1},'oda');
await put('brand_fact','long-fact',{id:'long-fact',brandId:'oda',key:'hours',value:'나'.repeat(1000),status:'confirmed',source:'owner',verifiedAt:new Date().toISOString(),validUntil:'2099-01-01T00:00:00Z',version:1},'oda');
await put('store','s-oda',{id:'s-oda',brandId:'oda',name:'ODA 휘경점',status:'active',version:1},'oda');
await put('campaign','conn',campaignFixture('conn'));
assert.equal((await post('connect_buffer','conn',{token:'test-token-not-a-secret',organizationId:'org',channelId:'channel-1'})).status,200,'fixture publisher');
async function setup(id,factRefs=[{id:'fact',version:1}],maxPublications=10){
 await fresh();await put('campaign',id,campaignFixture(id));
 assert.equal((await post('save_limits',id,{maxPublications,maxPlannedCostKRW:0})).status,200,'fixture limits');
 const card=await post('save_creative',id,{campaignVersion:1,factRefs,png:dataUrl(png)});assert.equal(card.status,200,'fixture creative '+JSON.stringify(card.data));
 return card.data;
}
const artifact=(id,campaignId,origin,content)=>put('artifact',id,{id,campaignId,campaignVersion:1,role:'content',title:'콘텐츠 스튜디오 · ODA',content,version:1,status:'approved',origin,createdAt:new Date().toISOString()},campaignId);
async function approve(id,p,extra={}){
 const credential=await server.readRecord('owner','publisher_credential','oda'),limits=await server.readRecord('owner','execution_limits',id);
 return post('approve',id,{id:p.id,version:p.version,confirmed:true,rightsConfirmed:true,immutableMediaConfirmed:true,channelId:'channel-1',credentialVersion:credential.version,limitsVersion:limits.version,...extra});
}
const creative=await setup('aid');
const aiCopy='휘경동 ODA 피자에서 따뜻한 한 판을 만나 보세요.',editedCopy='오늘 저녁은 휘경동 ODA 피자 어떠세요.',humanCopy='직접 쓴 카피로 ODA를 알립니다.';
await artifact('ai-art','aid','ai','## 게시 카피\n\n'+aiCopy);
await artifact('edited-art','aid','ai_edited','## 게시 카피\n\n'+editedCopy);
await artifact('human-art','aid','manual','## 게시 카피\n\n'+humanCopy);
await artifact('legacy-art','aid',undefined,'## 게시 카피\n\n출처 기록이 없는 카피입니다.');
await artifact('odd-art','aid','human','## 게시 카피\n\n출처 값이 낯선 카피입니다.');
const draft=(offset,copy,extra={})=>post('save_publication','aid',{creativeId:creative.id,mediaUrl:cloud(creative),scheduledAt:at(offset),plannedCostKRW:0,...(copy?{copy}:{}),...extra});

// 3) 스위치가 꺼져 있으면 AI 카피 자체가 불가능하다(기존 동작 유지).
check((await getState('aid')).copyCaptions===false&&(await getState('aid')).copies.length===0,'switch off offers no copy candidates');
const off=await draft(1,{artifactId:'ai-art',artifactVersion:1,index:0});
check(off.status===409&&off.data.error.includes('결정 17'),'switch off still rejects AI copy captions');
const offReason='대표가 AI 생성물 표시 문구(결정 17)를 확정할 때까지 꺼져 있습니다',panelSource=readFileSync('app/execution-panel.tsx','utf8');
check(off.data.error.includes(offReason)&&panelSource.includes(offReason)&&!panelSource.includes('AI 생성물 표시 기준이 정해질 때까지'),'switch-off note on the screen gives the same reason as the server');

rt.env.AI_COPY_CAPTIONS='enabled';
const state=await getState('aid');
check(state.copies.find(c=>c.artifactId==='ai-art')?.aiGenerated===true&&state.copies.find(c=>c.artifactId==='edited-art')?.aiGenerated===true&&state.copies.find(c=>c.artifactId==='human-art')?.aiGenerated===false,'caption candidates carry the AI determination for the screen');
check(['legacy-art','odd-art'].every(id=>state.copies.find(c=>c.artifactId===id)?.issues.some(i=>i.includes('출처'))),'copies from artifacts with no or unknown origin are listed as unusable');

// 4) 발행 준비: AI 카피는 aiGenerated를 기록하고 사실 뒤에 표시 줄을 붙인다. 사람 카피·카피 없음은 바이트 불변.
await fresh();
const aiDraft=await draft(2,{artifactId:'ai-art',artifactVersion:1,index:0});
check(aiDraft.status===200&&aiDraft.data.copy?.aiGenerated===true&&aiDraft.data.caption===aiCopy+'\n\n'+creative.caption+'\n\n'+LINE,'AI copy publication records aiGenerated and ends with the disclosure line '+JSON.stringify(aiDraft.data));
const editedDraft=await draft(3,{artifactId:'edited-art',artifactVersion:1,index:0});
check(editedDraft.status===200&&editedDraft.data.copy?.aiGenerated===true&&editedDraft.data.caption.endsWith('\n\n'+LINE),'human-edited AI copy (ai_edited) is still disclosed');
const humanDraft=await draft(4,{artifactId:'human-art',artifactVersion:1,index:0});
check(humanDraft.status===200&&humanDraft.data.copy?.aiGenerated===false&&humanDraft.data.caption===humanCopy+'\n\n'+creative.caption&&!humanDraft.data.caption.includes(LINE),'human copy is recorded as not AI and its caption is unchanged');
const plainDraft=await draft(5);
check(plainDraft.status===200&&plainDraft.data.caption===creative.caption&&!('copy' in plainDraft.data),'fact card and fact caption alone are not AI-generated and stay byte-identical');
const codedPlain=await draft(6,undefined,{trackingCode:{type:'coupon',storeId:'s-oda'}});
check(codedPlain.status===200&&codedPlain.data.caption===creative.caption+'\n\n'+exec.codeLine(codedPlain.data.trackingCode)&&!codedPlain.data.caption.includes(LINE),'code line alone carries no disclosure line');
const codedAi=await draft(7,{artifactId:'ai-art',artifactVersion:1,index:0},{trackingCode:{type:'pos_tag',storeId:'s-oda'}});
check(codedAi.status===200&&codedAi.data.caption===aiCopy+'\n\n'+creative.caption+'\n\n'+LINE+'\n\n'+exec.codeLine(codedAi.data.trackingCode),'AI copy with a code: disclosure line sits between the fact caption and the code line');
const legacyOrigin=await draft(8,{artifactId:'legacy-art',artifactVersion:1,index:0}),oddOrigin=await draft(9,{artifactId:'odd-art',artifactVersion:1,index:0});
check(legacyOrigin.status===409&&legacyOrigin.data.error.includes('출처')&&oddOrigin.status===409&&oddOrigin.data.error.includes('출처'),'a copy whose artifact has no or unknown origin cannot be prepared (no undisclosed AI copy) '+JSON.stringify([legacyOrigin,oddOrigin].map(r=>r.status)));

// 5) 승인 게이트: AI 카피 발행은 aiDisclosureConfirmed:true가 없으면 409, 있으면 승인하고 확인자·시각을 남긴다.
await fresh();
const missing=await approve('aid',aiDraft.data);
check(missing.status===409&&missing.data.error.includes('AI 생성물 표시를 확인하세요'),'approval without the disclosure check is a 409');
const falsy=await approve('aid',aiDraft.data,{aiDisclosureConfirmed:'true'});
check(falsy.status===409&&(await server.readRecord('owner','execution_publication',aiDraft.data.id)).status==='draft','only a literal true confirms the disclosure and the draft is untouched');
const aiApproved=await approve('aid',aiDraft.data,{aiDisclosureConfirmed:true});
check(aiApproved.status===200&&aiApproved.data.status==='approved'&&aiApproved.data.aiDisclosureConfirmedBy==='owner'&&!!aiApproved.data.aiDisclosureConfirmedAt&&aiApproved.data.approvedBy==='owner','approval with the disclosure check records who confirmed it and when');
const storedApproval=await server.readRecord('owner','execution_publication',aiDraft.data.id);
check(storedApproval.aiDisclosureConfirmedBy==='owner'&&Number.isFinite(Date.parse(storedApproval.aiDisclosureConfirmedAt)),'confirmation is persisted on the approval record');
const humanApproved=await approve('aid',humanDraft.data);
check(humanApproved.status===200&&!('aiDisclosureConfirmedBy' in humanApproved.data)&&!('aiDisclosureConfirmedAt' in humanApproved.data),'human copy approves as before without a disclosure check');
const plainApproved=await approve('aid',plainDraft.data);
check(plainApproved.status===200&&!('aiDisclosureConfirmedBy' in (await server.readRecord('owner','execution_publication',plainDraft.data.id))),'fact-only publication approves as before');

// 6) 제출: Buffer에 표시 줄을 포함한 캡션을 보낸다. 사람 카피는 그대로 보낸다.
const sent=await post('execute','aid',{id:aiDraft.data.id,version:aiApproved.data.version});
check(sent.status===200&&sent.data.status==='accepted'&&lastText===aiDraft.data.caption&&lastText.endsWith(LINE),'Buffer receives the caption with the disclosure line');
const humanSent=await post('execute','aid',{id:humanDraft.data.id,version:humanApproved.data.version});
check(humanSent.status===200&&lastText===humanCopy+'\n\n'+creative.caption,'Buffer receives the unchanged human-copy caption');

// 7) 일치 검사: 저장된 캡션에서 표시 줄이 빠지면 승인하지 않는다. 표시 판정이 없는 이전 기록(AI 작업물)도 다시 준비하게 한다.
await fresh();
await put('execution_publication',editedDraft.data.id,{...editedDraft.data,caption:editedCopy+'\n\n'+creative.caption},'aid');
const stripped=await approve('aid',editedDraft.data,{aiDisclosureConfirmed:true});
check(stripped.status===409&&stripped.data.error.includes('다시 준비'),'approval compares against the caption including the disclosure line');
// 스위치를 켠 뒤 문구 상수가 바뀌면 남은 초안·승인의 캡션에는 이전 표시 줄이 있다. 소재 변경이 아니라 표시 문구 변경으로 알리고 취소·재준비를 안내한다.
await put('execution_publication',editedDraft.data.id,{...editedDraft.data,caption:editedCopy+'\n\n'+creative.caption+'\n\n이전 표시 문구 초안입니다.'},'aid');
const reworded=await approve('aid',editedDraft.data,{aiDisclosureConfirmed:true});
check(reworded.status===409&&reworded.data.error.includes('AI 생성물 표시 문구')&&reworded.data.error.includes('취소하고 다시 준비'),'a caption with an outdated disclosure line is refused with cancel-and-prepare guidance '+JSON.stringify(reworded.data));
const legacyCopy={...codedAi.data.copy};delete legacyCopy.aiGenerated;
await put('execution_publication',codedAi.data.id,{...codedAi.data,copy:legacyCopy,caption:aiCopy+'\n\n'+creative.caption+'\n\n'+exec.codeLine(codedAi.data.trackingCode)},'aid');
const legacy=await approve('aid',codedAi.data,{aiDisclosureConfirmed:true});
check(legacy.status===409&&legacy.data.error.includes('AI 생성물'),'a copy record without the AI determination cannot be approved without re-preparing');

// 8) 재준비(재확인): 승인이 초안이 되면 표시 확인 기록도 비우고, 다시 승인할 때 다시 확인해야 한다.
const re=await setup('re');
await artifact('re-art','re','ai','## 게시 카피\n\n'+aiCopy);
const reDraft=await post('save_publication','re',{creativeId:re.id,mediaUrl:cloud(re),scheduledAt:at(10),plannedCostKRW:0,copy:{artifactId:'re-art',artifactVersion:1,index:0}});
const reApproved=await approve('re',reDraft.data,{aiDisclosureConfirmed:true});
await post('save_limits','re',{version:1,maxPublications:1,maxPlannedCostKRW:0});
const back=await post('reconfirm','re',{id:reDraft.data.id,version:reApproved.data.version});
check(back.status===200&&back.data.status==='draft'&&!back.data.aiDisclosureConfirmedBy&&!back.data.aiDisclosureConfirmedAt&&back.data.caption===reDraft.data.caption&&back.data.copy?.aiGenerated===true,'reconfirm clears the disclosure confirmation and keeps the disclosed caption');
const storedBack=await server.readRecord('owner','execution_publication',reDraft.data.id);
check(!('aiDisclosureConfirmedBy' in storedBack)&&!('aiDisclosureConfirmedAt' in storedBack),'the returned draft record carries no disclosure confirmation');
check((await approve('re',back.data)).status===409,'re-approval requires the disclosure check again');
// 화면이 보내는 승인 본문(approvalRequest)으로 승인한다: 체크하지 않으면 409, 체크하면 승인.
const panelView=await getState('re');
check((await post('approve','re',{id:back.data.id,version:back.data.version,...exec.approvalRequest?.(back.data,panelView,false)})).status===409,'the screen approval body without the tick is refused');
const reAgain=await post('approve','re',{id:back.data.id,version:back.data.version,...exec.approvalRequest?.(back.data,panelView,true)});
check(reAgain.status===200&&!!reAgain.data.aiDisclosureConfirmedAt,'re-approval with the disclosure check (screen approval body) succeeds');
// 승인 기록에서 표시 확인이 사라진 AI 카피 발행은 접수하지 않는다.
await put('execution_publication',reDraft.data.id,{...reAgain.data,aiDisclosureConfirmedBy:undefined,aiDisclosureConfirmedAt:undefined},'re');
const unconfirmed=await post('execute','re',{id:reDraft.data.id,version:reAgain.data.version});
check(unconfirmed.status===409&&unconfirmed.data.error.includes('승인 뒤 바뀐 항목')&&unconfirmed.data.error.includes('AI 생성물 표시 확인')&&unconfirmed.data.error.includes('재확인'),'submission refuses an AI-copy approval without a disclosure confirmation as drift (reconfirm is offered) '+JSON.stringify(unconfirmed.data));
await put('execution_publication',reDraft.data.id,reAgain.data,'re');
// 승인 뒤 스위치를 끄면 AI 카피 발행은 접수되지 않는다(기존 동작).
rt.env.AI_COPY_CAPTIONS=undefined;
const switchedOff=await post('execute','re',{id:reDraft.data.id,version:reAgain.data.version});
check(switchedOff.status===409&&switchedOff.data.error.includes('결정 17'),'turning the switch off blocks submitting approved AI copy');
rt.env.AI_COPY_CAPTIONS='enabled';
// Buffer 연결 해제로 초안이 되면 표시 확인 기록도 지운다. 다시 연결한 뒤에도 다시 체크해야 승인된다.
await fresh();
const unplugged=await post('disconnect_buffer','re',{version:(await server.readRecord('owner','publisher_credential','oda')).version});
const unpluggedDraft=await server.readRecord('owner','execution_publication',reDraft.data.id);
check(unplugged.status===200&&unpluggedDraft.status==='draft'&&!('aiDisclosureConfirmedBy' in unpluggedDraft)&&!('aiDisclosureConfirmedAt' in unpluggedDraft)&&unpluggedDraft.caption===reDraft.data.caption&&unpluggedDraft.copy?.aiGenerated===true,'disconnecting Buffer clears the disclosure confirmation and keeps the disclosed caption');
assert.equal((await post('connect_buffer','re',{token:'test-token-not-a-secret',organizationId:'org',channelId:'channel-1'})).status,200,'fixture reconnect');
const replugged=await approve('re',unpluggedDraft);
check(replugged.status===409&&replugged.data.error.includes('AI 생성물 표시를 확인하세요'),'after reconnecting, approval requires the disclosure check again');
const repluggedOk=await approve('re',unpluggedDraft,{aiDisclosureConfirmed:true});
check(repluggedOk.status===200&&repluggedOk.data.aiDisclosureConfirmedBy==='owner'&&!!repluggedOk.data.aiDisclosureConfirmedAt,'after reconnecting, approval with the disclosure check records the confirmation again');

// 9) Instagram 2,200자 한도는 표시 줄을 포함해 검사한다.
const limit=await setup('limit',[{id:'long-fact',version:1}]);
const exact=2200-2-limit.caption.length,withLine=exact-2-LINE.length;
assert.ok(withLine>=5&&exact<=1500,'fixture long caption '+exact);
await artifact('limit-over','limit','ai','## 게시 카피\n\n'+'가'.repeat(exact-1)+'.');
await artifact('limit-fit','limit','ai','## 게시 카피\n\n'+'가'.repeat(withLine-1)+'.');
await artifact('limit-human','limit','manual','## 게시 카피\n\n'+'가'.repeat(exact-1)+'.');
const limitDraft=(offset,artifactId,extra={})=>post('save_publication','limit',{creativeId:limit.id,mediaUrl:cloud(limit),scheduledAt:at(offset),plannedCostKRW:0,copy:{artifactId,artifactVersion:1,index:0},...extra});
const over=await limitDraft(20,'limit-over');
check(over.status===400&&over.data.error.includes('2,200')&&over.data.error.includes('AI 생성물 표시'),'disclosure line counted in the Instagram 2,200 limit');
const fit=await limitDraft(21,'limit-fit');
check(fit.status===200&&fit.data.caption.length===2200&&fit.data.caption.endsWith(LINE),'AI caption of exactly 2,200 characters with the disclosure line is accepted');
const humanFit=await limitDraft(22,'limit-human');
check(humanFit.status===200&&humanFit.data.caption.length===2200,'human copy of the same length still fits (no disclosure line)');
const coded=await limitDraft(23,'limit-fit',{trackingCode:{type:'coupon',storeId:'s-oda'}});
check(coded.status===400&&coded.data.error.includes('AI 생성물 표시')&&coded.data.error.includes('게시 코드')&&!(await server.listRecords('owner','tracking_code','s-oda')).some(c=>c.campaignId==='limit'),'disclosure and code lines both counted before any code is issued');
rt.env.AI_COPY_CAPTIONS=undefined;

// 10) 문구는 상수 한 곳에만 있다. 화면·문서.
const literalFiles=['lib','app'].flatMap(dir=>readdirSync(dir,{recursive:true}).filter(f=>/\.(ts|tsx)$/.test(f)).map(f=>dir+'/'+f)).filter(f=>readFileSync(f,'utf8').includes(LINE));
check(JSON.stringify(literalFiles)==='["lib/ai-disclosure.ts"]','the disclosure wording lives in one constant '+JSON.stringify(literalFiles));
check(existsSync('lib/ai-disclosure.ts')&&readFileSync('lib/ai-disclosure.ts','utf8').includes('초안'),'code comment marks the wording as a draft pending review');
const panel=readFileSync('app/execution-panel.tsx','utf8');
check(panel.includes('AI 생성물 표시 확인')&&panel.includes('aiDisclosureConfirmed')&&panel.includes('>AI 생성물<')&&panel.includes('disclosureLine(')&&panel.includes('AI_DISCLOSURE_LINE'),'panel shows the AI badge, the disclosure preview and the required check');
// 체크 상태는 발행 id로 저장하고, 같은 키로 승인 본문과 차단 사유를 만든다.
check(panel.includes('setAiChecks(old=>({...old,[p.id]:e.target.checked}))')&&panel.includes('approvalRequest(p,state,!!aiChecks[p.id])')&&panel.includes('aiDisclosureConfirmed:!!aiChecks[p.id]'),'panel keys the disclosure tick by publication id for the checkbox, the approval body and the blockers');
const doc=existsSync('docs/AI-DISCLOSURE.ko.md')?readFileSync('docs/AI-DISCLOSURE.ko.md','utf8'):'',loop=readFileSync('docs/EXECUTION-LOOP.ko.md','utf8');
check(doc.includes(LINE)&&doc.includes('초안')&&doc.includes('대표 본인')&&doc.includes('AI_COPY_CAPTIONS')&&doc.includes('체크리스트')&&doc.includes('사실 카드')&&doc.includes('코드 줄'),'AI disclosure doc covers target, draft wording, position, reviewer and the switch checklist');
check(loop.includes('AI-DISCLOSURE.ko.md')&&loop.includes('aiDisclosureConfirmed'),'execution loop doc links the disclosure section');
// 문구 변경 절차: 상수·이 문서 2절 인용·테스트 기대값을 같은 PR에서 바꾼다. 켠 뒤 바꾸면 남은 AI 카피 초안·승인은 취소하고 다시 준비한다.
check(doc.includes('2절 인용문')&&doc.includes('기대값 `LINE`')&&!doc.includes('상수와 테스트 기대값만')&&!doc.includes('이 상수만 고치는'),'doc wording-change procedure names the constant, the quoted draft and the test expectation');
check(doc.includes('켠 뒤 문구를 바꾸면')&&doc.includes('취소하고 다시 준비')&&loop.includes('켠 뒤 문구를 바꾸면'),'docs warn that changing the wording after the switch is on needs cancel and re-prepare');
check(doc.includes('출처 불명')&&loop.includes('출처 불명'),'docs say copies with no or unknown origin are not usable as captions');
console.log(JSON.stringify({passed:checks-failures.length,failed:failures.length,failures,providerCalls:calls,evidence:'real SQLite; mocked Buffer and R2; genuine PNG fixture'}));
assert.deepEqual(failures,[]);
