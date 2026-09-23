import assert from 'node:assert/strict';
import {deflateSync} from 'node:zlib';
import {readFileSync} from 'node:fs';
import {testRuntime} from './helpers/runtime.mjs';

// A4-2: 발행 캡션의 게시별 코드(쿠폰·POS 태그)와 소재 제목. 실제 SQLite, Buffer·R2는 모의 응답이다.
function crc32(bytes){let crc=0xffffffff;for(const byte of bytes){crc^=byte;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0)}return (crc^0xffffffff)>>>0}
function chunk(type,data){const name=Buffer.from(type),size=Buffer.alloc(4),crc=Buffer.alloc(4);size.writeUInt32BE(data.length);crc.writeUInt32BE(crc32(Buffer.concat([name,data])));return Buffer.concat([size,name,data,crc])}
const signature=Buffer.from([137,80,78,71,13,10,26,10]),ihdr=Buffer.alloc(13);
ihdr.writeUInt32BE(1080,0);ihdr.writeUInt32BE(1080,4);ihdr[8]=8;ihdr[9]=2;
function fixture(fill=0){const pixels=Buffer.alloc((1080*3+1)*1080,fill);for(let row=0;row<1080;row++)pixels[row*(1080*3+1)]=0;return Buffer.concat([signature,chunk('IHDR',ihdr),chunk('IDAT',deflateSync(pixels)),chunk('IEND',Buffer.alloc(0))])}
const png=fixture(),dataUrl=bytes=>'data:image/png;base64,'+bytes.toString('base64');
let calls=0,lastText='',beforeRun=null;
const rt=testRuntime(async(url,init={})=>{
 if(String(url).startsWith('https://res.cloudinary.com/'))return new Response(png,{headers:{'content-type':'image/png'}});
 const {query,variables}=JSON.parse(init.body);
 if(query.includes('organizations'))return Response.json({data:{account:{organizations:[{id:'org',name:'ODA 조직'}]}}});
 if(query.includes('channels('))return Response.json({data:{channels:[{id:'channel-1',name:'ODA',service:'instagram',isQueuePaused:false}]}});
 if(query.includes('createPost')){calls++;lastText=variables.input.text;return Response.json({data:{createPost:{__typename:'PostActionSuccess',post:{id:'post-'+calls,status:'scheduled'}}}})}
 return Response.json({data:{post:{id:variables.id,status:'scheduled',channelId:'channel-1'}}});
},{beforeRun:statement=>beforeRun?.(statement)});
const objects=new Map();rt.env.BUCKET={put:async(k,v)=>objects.set(k,new Uint8Array(v)),get:async k=>objects.has(k)?{arrayBuffer:async()=>objects.get(k).slice().buffer,body:new Response(objects.get(k).slice()).body}:null,head:async k=>objects.has(k)?{size:objects.get(k).length}:null,delete:async k=>objects.delete(k)};
const server=await rt.load('lib/server.ts'),route=await rt.load('app/api/execution/route.ts'),exec=await rt.load('lib/execution.ts');
const put=(kind,id,value,parent='')=>server.recordStatement('owner',kind,id,value,parent).run();
const rows=kind=>rt.sql.prepare("SELECT data FROM records WHERE owner='owner' AND kind=?").all(kind).map(r=>JSON.parse(r.data));
let checks=0;const failures=[];function check(value,label){checks++;if(!value)failures.push(label)}
async function post(action,campaignId,data={}){
 const response=await route.POST(new Request('https://app.test/api/execution',{method:'POST',headers:{'content-type':'application/json','oai-authenticated-user-id':'owner',origin:'https://app.test'},body:JSON.stringify({action,campaignId,...data})}));
 return {status:response.status,data:await response.json()};
}
const getState=async id=>(await route.GET(new Request('https://app.test/api/execution?campaignId='+id,{headers:{'oai-authenticated-user-id':'owner'}}))).json();
const fresh=()=>put('execution_rate','execution',{startedAt:Date.now(),count:0});
const at=offset=>new Date(Date.UTC(2098,0,1,0,offset)).toISOString(),cloud=c=>'https://res.cloudinary.com/oda/image/upload/'+c.pngHash+'.png';
const campaignFixture=(id,extra={})=>({id,brandId:'oda',title:'ODA',version:1,status:'approved',startDate:'2098-01-01',endDate:'2098-12-31',budget:100000,budgetConfirmedAt:'2026-09-01T00:00:00.000Z',...extra});
const codesOf=campaignId=>rows('tracking_code').filter(c=>c.campaignId===campaignId);

await server.seedBrands('owner');
const fact={id:'fact',brandId:'oda',key:'address',value:'휘경동 377 C107',status:'confirmed',source:'owner',verifiedAt:new Date().toISOString(),validUntil:'2099-01-01T00:00:00Z',version:1};
await put('brand_fact','fact',fact,'oda');
await put('store','s-oda',{id:'s-oda',brandId:'oda',name:'ODA 휘경점',status:'active',version:1},'oda');
await put('store','s-oda-2',{id:'s-oda-2',brandId:'oda',name:'ODA 성수점',status:'active',version:1},'oda');
await put('store','s-ofd',{id:'s-ofd',brandId:'ofd',name:'OFD 지점',status:'active',version:1},'ofd');
await put('campaign','conn',campaignFixture('conn'));
assert.equal((await post('connect_buffer','conn',{token:'test-token-not-a-secret',organizationId:'org',channelId:'channel-1'})).status,200,'fixture publisher');
async function setup(id,extra={},title,factRefs=[{id:'fact',version:1}]){
 await fresh();await put('campaign',id,campaignFixture(id,extra));
 const limits=await post('save_limits',id,{maxPublications:5,maxPlannedCostKRW:0});assert.equal(limits.status,200,'fixture limits');
 const card=await post('save_creative',id,{campaignVersion:1,factRefs,png:dataUrl(png),...(title===undefined?{}:{title})});
 return {id,card,creative:card.data};
}
async function approve(id,p){
 const credential=await server.readRecord('owner','publisher_credential','oda'),limits=await server.readRecord('owner','execution_limits',id);
 return post('approve',id,{id:p.id,version:p.version,confirmed:true,rightsConfirmed:true,immutableMediaConfirmed:true,channelId:'channel-1',credentialVersion:credential.version,limitsVersion:limits.version});
}

// 순수 함수: 코드 줄 문구, 코드가 없을 때 기존 캡션과 바이트 단위로 같음, 코드가 있을 때만 끝에 빈 줄+코드 줄.
check(exec.codeLine?.({type:'coupon',code:'CABCD2345'})==='주문할 때 쿠폰 코드 CABCD2345를 알려 주세요.','coupon code line wording');
check(exec.codeLine?.({type:'pos_tag',code:'PABCD2345'})==='주문할 때 코드 PABCD2345를 말씀해 주세요.','POS tag code line wording');
check(exec.codeLine?.({type:'coupon',code:'CABCD2347'})==='주문할 때 쿠폰 코드 CABCD2347을 알려 주세요.'&&exec.codeLine({type:'pos_tag',code:'PABCDEFGM'})==='주문할 때 코드 PABCDEFGM을 말씀해 주세요.','object particle follows how the last code character is read');
const factCaption='주소: 휘경동 377 C107';
check(exec.composeCaption(undefined,factCaption)===factCaption&&exec.composeCaption('카피 한 줄',factCaption)==='카피 한 줄\n\n'+factCaption,'caption without a code is byte-identical to the previous composition');
check(exec.composeCaption(undefined,factCaption,undefined)===factCaption&&exec.composeCaption('카피 한 줄',factCaption,undefined)==='카피 한 줄\n\n'+factCaption,'an explicit undefined code changes nothing');
check(exec.composeCaption('카피 한 줄',factCaption,{type:'coupon',code:'CABCD2345'})==='카피 한 줄\n\n'+factCaption+'\n\n주문할 때 쿠폰 코드 CABCD2345를 알려 주세요.','code line is appended last after a blank line');
check(exec.creativeLabel?.({id:'abcdef123456',title:'오픈 주소 안내 v1',caption:factCaption,createdAt:'2026-09-24T00:00:00.000Z'})==='오픈 주소 안내 v1','creative label shows the title');
check(exec.creativeLabel?.({id:'abcdef123456',caption:factCaption+'\n영업시간: 11시',createdAt:'2026-09-23T15:05:00.000Z'})==='소재 · 9월 24일 00:05 생성 · 주소: 휘경동 377 C107','untitled creative gets a readable Korean-time fallback with its first fact line');
check(exec.creativeLabel?.({id:'abcdef123456',caption:factCaption,createdAt:''})==='소재 · abcdef12 · 주소: 휘경동 377 C107','untitled creative without a date falls back to a short id');
check(exec.CREATIVE_TITLE_MAX===60,'creative title limit is 60 characters');

// (3) 소재 제목: 선택, 앞뒤 공백 제거, 1~60자. 비우면 저장하지 않는다. 해시·캡션에 넣지 않는다.
const plain=await setup('plain');
check(plain.card.status===200&&!('title' in plain.creative),'creative without a title keeps the previous shape');
const titled=await setup('titled',{},'  오픈 주소 안내 v1  ');
check(titled.card.status===200&&titled.creative.title==='오픈 주소 안내 v1','title stored trimmed');
check(titled.creative.materialHash===plain.creative.materialHash&&titled.creative.pngHash===plain.creative.pngHash&&titled.creative.caption===plain.creative.caption,'title changes neither material hash, PNG hash nor caption');
check((await server.readRecord('owner','execution_creative',titled.creative.id)).title==='오픈 주소 안내 v1','title persisted on the creative record');
const blankTitle=await setup('blank-title',{},'   ');
check(blankTitle.card.status===200&&!('title' in blankTitle.creative),'blank title is not stored');
const longTitle=await setup('long-title',{},'가'.repeat(61));
check(longTitle.card.status===400&&longTitle.card.data.error.includes('60자'),'title over 60 characters rejected with the limit');
const edgeTitle=await setup('edge-title',{},' '+'나'.repeat(60)+' ');
check(edgeTitle.card.status===200&&edgeTitle.creative.title==='나'.repeat(60),'60 characters after trimming accepted');
check((await setup('bad-title',{},42)).card.status===400,'non-string title rejected');
check((await getState('titled')).creatives[0]?.title==='오픈 주소 안내 v1','state returns the title for the screen');
// 같은 PNG·입력으로 다시 만들면 기존 소재를 돌려준다. 제목이 없던 소재에는 제목만 붙이고(버전 그대로), 다른 제목이 이미 있으면 409로 알린다.
await fresh();
const resave=title=>post('save_creative','plain',{campaignVersion:1,factRefs:[{id:'fact',version:1}],png:dataUrl(png),...(title===undefined?{}:{title})});
let re=await resave('  오픈 주소 안내 v2 ');
check(re.status===200&&re.data.id===plain.creative.id&&re.data.title==='오픈 주소 안내 v2'&&re.data.version===plain.creative.version&&re.data.objectKey==='','same PNG with a title names the untitled creative without a new version');
check((await server.readRecord('owner','execution_creative',plain.creative.id)).title==='오픈 주소 안내 v2'&&rows('execution_creative').filter(c=>c.campaignId==='plain').length===1,'the title is stored on the existing creative and no creative is added');
check((await server.readRecord('owner','execution_creative',plain.creative.id)).objectKey===rows('execution_creative').find(c=>c.id===plain.creative.id).objectKey&&!!rows('execution_creative').find(c=>c.id===plain.creative.id).objectKey,'naming keeps the stored PNG object key');
re=await resave('다른 제목');
check(re.status===409&&re.data.error?.includes('제목을 바꾸지 않았습니다')&&(await server.readRecord('owner','execution_creative',plain.creative.id)).title==='오픈 주소 안내 v2','a different title for the same creative is a 409 and keeps the stored title');
re=await resave('오픈 주소 안내 v2');
check(re.status===200&&re.data.id===plain.creative.id&&re.data.title==='오픈 주소 안내 v2','the same title again returns the creative');
re=await resave();
check(re.status===200&&re.data.id===plain.creative.id&&re.data.title==='오픈 주소 안내 v2','no title returns the creative with its title');

// 코드 없는 발행: 캡션·해시·승인·접수가 이전과 같다.
const nocode=await setup('nocode');
const nd=await post('save_publication','nocode',{creativeId:nocode.creative.id,mediaUrl:cloud(nocode.creative),scheduledAt:at(0),plannedCostKRW:0});
check(nd.status===200&&nd.data.caption===nocode.creative.caption&&!('trackingCode' in nd.data)&&nd.data.pngHash===nocode.creative.pngHash,'publication without a code keeps the fact caption and PNG hash');
check(!codesOf('nocode').length,'no tracking code issued without a code choice');
const na=await approve('nocode',nd.data);check(na.status===200,'publication without a code approves as before');
const ns=await post('execute','nocode',{id:nd.data.id,version:na.data.version});
check(ns.status===200&&ns.data.status==='accepted'&&lastText===nocode.creative.caption,'Buffer receives the unchanged caption without a code');

// 코드 있는 발행(브랜드 공통 캠페인): 같은 브랜드의 지점을 골라야 한다. 코드 줄이 캡션 끝에 붙고 발행에 코드가 저장된다.
const wide=await setup('wide');
const wideDraft=(offset,trackingCode)=>post('save_publication','wide',{creativeId:wide.creative.id,mediaUrl:cloud(wide.creative),scheduledAt:at(offset),plannedCostKRW:0,trackingCode});
const noStore=await wideDraft(1,{type:'coupon'});
check(noStore.status===400&&noStore.data.error.includes('지점'),'brand-wide campaign must choose a store for the code');
const otherBrand=await wideDraft(1,{type:'coupon',storeId:'s-ofd'});
check(otherBrand.status===409&&otherBrand.data.error.includes('브랜드'),'store of another brand rejected');
check((await wideDraft(1,{type:'coupon',storeId:'missing-store'})).status===409,'unknown store rejected');
check((await wideDraft(1,{type:'qr',storeId:'s-oda'})).status===400,'only coupon and POS tag codes go into captions');
check((await wideDraft(1,'coupon')).status===400,'malformed code choice rejected');
await put('store','s-oda-old',{id:'s-oda-old',brandId:'oda',name:'ODA 폐점',status:'archived',version:1},'oda');
check((await wideDraft(1,{type:'coupon',storeId:'s-oda-old'})).status===409,'archived store rejected');
check(!codesOf('wide').length,'rejected code choices issue nothing');
const wd=await wideDraft(1,{type:'coupon',storeId:'s-oda'});
const wideCode=wd.data.trackingCode;
check(wd.status===200&&wideCode?.type==='coupon'&&wideCode.storeId==='s-oda'&&typeof wideCode.code==='string'&&wideCode.code.startsWith('C')&&!!wideCode.id,'coupon code stored on the publication '+JSON.stringify(wd.data));
check(wd.data.caption===wide.creative.caption+'\n\n'+exec.codeLine?.({type:'coupon',code:wideCode?.code})&&/쿠폰 코드 C[A-Z0-9]+[을를] 알려 주세요\.$/.test(wd.data.caption),'code line is the last caption line');
check(wd.data.pngHash===wide.creative.pngHash,'code never changes the PNG hash');
const issued=codesOf('wide');
check(issued.length===1&&issued[0].code===wideCode?.code&&issued[0].publicationId===wd.data.id&&issued[0].creativeId===wide.creative.id&&issued[0].storeId==='s-oda','issued tracking code links the publication, creative and store');

// 승인·접수는 코드 포함 캡션으로 검사하고 Buffer에 코드 포함 캡션을 보낸다.
const wa=await approve('wide',wd.data);
check(wa.status===200&&wa.data.caption===wd.data.caption&&wa.data.trackingCode?.code===wideCode?.code,'coded publication approves with the code caption');
const ws=await post('execute','wide',{id:wd.data.id,version:wa.data.version});
check(ws.status===200&&ws.data.status==='accepted'&&lastText===wd.data.caption,'Buffer receives the caption with the code line');

// 캡션에서 코드 줄이 빠지면(저장 값 불일치) 승인하지 않는다.
const tampered=await wideDraft(2,{type:'pos_tag',storeId:'s-oda-2'});
check(tampered.status===200&&tampered.data.trackingCode?.type==='pos_tag'&&tampered.data.caption.endsWith('말씀해 주세요.'),'POS tag code line on another store of the same brand');
await put('execution_publication',tampered.data.id,{...tampered.data,caption:wide.creative.caption},'wide');
const mismatch=await approve('wide',tampered.data);
check(mismatch.status===409&&mismatch.data.error.includes('다시 준비'),'approval compares against the caption including the code line');

// 지점 캠페인: 기본 지점은 캠페인 지점이고, 다른 지점은 거절한다.
const local=await setup('local',{storeId:'s-oda'});
const ld=await post('save_publication','local',{creativeId:local.creative.id,mediaUrl:cloud(local.creative),scheduledAt:at(3),plannedCostKRW:0,trackingCode:{type:'pos_tag'}});
check(ld.status===200&&ld.data.trackingCode?.storeId==='s-oda'&&ld.data.trackingCode.code.startsWith('P'),'store campaign defaults the code to its store');
const elsewhere=await post('save_publication','local',{creativeId:local.creative.id,mediaUrl:cloud(local.creative),scheduledAt:at(4),plannedCostKRW:0,trackingCode:{type:'coupon',storeId:'s-oda-2'}});
check(elsewhere.status===409&&elsewhere.data.error.includes('지점'),'store campaign rejects another store');

// 재확인(초안 복귀)은 같은 코드와 코드 포함 캡션을 유지하고 다시 승인할 수 있다.
const la=await approve('local',ld.data);
await post('save_limits','local',{version:1,maxPublications:1,maxPlannedCostKRW:0});
const back=await post('reconfirm','local',{id:ld.data.id,version:la.data.version});
check(back.status===200&&back.data.status==='draft'&&back.data.trackingCode?.code===ld.data.trackingCode?.code&&back.data.caption===ld.data.caption,'reconfirm keeps the same code and caption');
const again=await approve('local',back.data);
check(again.status===200&&again.data.caption===ld.data.caption,'returned draft re-approves with the same code caption');
check(codesOf('local').length===1,'reconfirm issues no new code');

// 코드 발급 뒤 발행 저장이 실패하면, 같은 준비를 다시 할 때 그 코드를 그대로 쓴다(고아 코드가 늘지 않는다).
const retry=await setup('retry');
const retryDraft=()=>post('save_publication','retry',{creativeId:retry.creative.id,mediaUrl:cloud(retry.creative),scheduledAt:at(5),plannedCostKRW:0,trackingCode:{type:'coupon',storeId:'s-oda'}});
beforeRun=statement=>{if(statement.query.startsWith('INSERT INTO records')&&statement.values[2]==='execution_publication'){beforeRun=null;throw new Error('injected publication save failure')}};
const broken=await retryDraft();beforeRun=null;
check(broken.status>=500&&!rows('execution_publication').some(p=>p.campaignId==='retry'),'fixture: publication save failed after code issue');
const orphan=codesOf('retry');
const retried=await retryDraft();
check(retried.status===200&&orphan.length<=1&&codesOf('retry').length===1,'retry after a failed save leaves exactly one code');
check(!orphan.length||retried.data.trackingCode?.code===orphan[0].code&&retried.data.id===orphan[0].publicationId,'retry reuses the code issued before the failed save');
check(codesOf('retry')[0]?.publicationId===retried.data.id,'the code now points at the saved publication');
const second=await post('save_publication','retry',{creativeId:retry.creative.id,mediaUrl:cloud(retry.creative),scheduledAt:at(6),plannedCostKRW:0,trackingCode:{type:'coupon',storeId:'s-oda'}});
check(second.status===200&&second.data.trackingCode?.code!==retried.data.trackingCode?.code&&codesOf('retry').length===2,'another publication of the same creative gets its own code');

// Instagram 2,200자 한도는 코드 줄을 포함해 검사하고, 넘으면 코드를 발급하지 않는다.
// 카피 후보는 1,500자 이하라 긴 확인 사실(약 1,000자)로 캡션을 한도 가까이 채운다.
await put('brand_fact','long-fact',{...fact,id:'long-fact',key:'hours',value:'나'.repeat(1000)},'oda');
rt.env.AI_COPY_CAPTIONS='enabled';
const limit=await setup('limit',{},undefined,[{id:'long-fact',version:1}]);
const copyLength=2200-2-limit.creative.caption.length;
assert.ok(limit.card.status===200&&copyLength>=5&&copyLength<=1500,'fixture long caption '+copyLength);
await put('artifact','limit-copy',{id:'limit-copy',campaignId:'limit',campaignVersion:1,role:'content',title:'콘텐츠',content:'## 게시 카피\n\n'+'가'.repeat(copyLength-1)+'.',version:1,status:'approved',origin:'manual',createdAt:new Date().toISOString()},'limit');
const limitDraft=(offset,trackingCode)=>post('save_publication','limit',{creativeId:limit.creative.id,mediaUrl:cloud(limit.creative),scheduledAt:at(offset),plannedCostKRW:0,copy:{artifactId:'limit-copy',artifactVersion:1,index:0},...(trackingCode?{trackingCode}:{})});
const fits=await limitDraft(7);
check(fits.status===200&&fits.data.caption.length===2200,'caption of exactly 2,200 characters without a code is accepted');
const over=await limitDraft(8,{type:'coupon',storeId:'s-oda'});
check(over.status===400&&over.data.error.includes('2,200')&&over.data.error.includes('코드'),'code line counted in the Instagram 2,200 limit');
check(!codesOf('limit').length,'caption over the limit issues no code');
rt.env.AI_COPY_CAPTIONS=undefined;

// 결정 17 게이트는 그대로다: 기본값에서는 AI 카피 캡션이 꺼져 있고, 코드 줄만으로는 게이트와 무관하다.
check((await getState('wide')).copyCaptions===false,'AI copy caption gate stays off by default');
const gated=await post('save_publication','limit',{creativeId:limit.creative.id,mediaUrl:cloud(limit.creative),scheduledAt:at(9),plannedCostKRW:0,copy:{artifactId:'limit-copy',artifactVersion:1,index:0},trackingCode:{type:'coupon',storeId:'s-oda'}});
check(gated.status===409&&gated.data.error.includes('결정 17')&&!codesOf('limit').length,'gated copy still rejected before any code is issued');

// 화면: 소재 제목 입력, 코드 선택(유형·지점), 준비된 발행의 코드 표시·복사. 문서는 PNG 코드를 A4-3으로 넘긴 이유를 적는다.
const panel=readFileSync('app/execution-panel.tsx','utf8'),doc=readFileSync('docs/EXECUTION-LOOP.ko.md','utf8');
check(panel.includes('소재 제목')&&panel.includes('creativeLabel(')&&panel.includes('name="codeType"')&&panel.includes('name="codeStoreId"')&&panel.includes('코드 복사'),'panel offers title, code type/store selection and code copy');
check(panel.includes('지점 목록을 불러오고 있습니다.')&&panel.includes('지점 목록을 불러오지 못했습니다')&&panel.includes('onClick={retryStores}')&&!panel.includes('setStores([])'),'the code store list tells loading and failure apart from having no store and offers a retry');
check(doc.includes('게시 코드')&&doc.includes('A4-3')&&doc.includes('소재 제목'),'execution loop doc covers publication codes, titles and the A4-3 PNG split');
console.log(JSON.stringify({passed:checks-failures.length,failed:failures.length,failures,providerCalls:calls,evidence:'real SQLite; mocked Buffer and R2; genuine PNG fixture'}));
assert.deepEqual(failures,[]);
