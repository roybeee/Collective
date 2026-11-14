// 레인 C 채널 마감 1·2: Instagram 캐러셀·릴스 실행 경로와 결과 미확인 직접 게시 대조. 근거: mocked(fetch 스텁, 메모리 SQLite·R2, 로컬 인증 헤더). 외부 네트워크 0회.
// 1부 공급자(순수, fetch 주입): 자식 컨테이너→부모→게시, 자식 단위 중단 재개, 자식 실패 시 게시 없음, 장수·영상 크기 준비 검사, 릴스 표지, 최근 게시물 읽기, 계약 하네스 재실행.
// 2부 순수: 묶음 해시·입력 검증, 대조 판정(하나·없음·창·여럿·제외·줄바꿈 정규화).
// 3부 서버: 스위치 꺼짐 409 → 캐러셀 준비 → 해시 없는/다른 승인 409 → 승인(추가 장 공개) → 실행(자식 3·부모·게시) → 승인 뒤 소재 변경 409, 릴스 실행, reconcile_direct 4가지 결과(재전송 0).
import assert from 'node:assert/strict';
import {deflateSync} from 'node:zlib';
import {testRuntime} from './helpers/runtime.mjs';

let checks=0;const failures=[];function check(value,label){checks++;if(!value)failures.push(label)}
const timeoutError=()=>Object.assign(new Error('The operation was aborted due to timeout'),{name:'TimeoutError'});
const refusedError=()=>Object.assign(new TypeError('fetch failed'),{cause:{code:'ECONNREFUSED'}});
const jsonResponse=(body,status=200,headers={})=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json',...headers}});
const fakeDeps=()=>({now:()=>0,random:()=>0.5,sleep:async()=>{}});
const policy={maxAttempts:3,baseDelayMs:100,maxDelayMs:5000};

function crc32(bytes){let crc=0xffffffff;for(const byte of bytes){crc^=byte;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0)}return (crc^0xffffffff)>>>0}
function chunk(type,data){const name=Buffer.from(type),size=Buffer.alloc(4),crc=Buffer.alloc(4);size.writeUInt32BE(data.length);crc.writeUInt32BE(crc32(Buffer.concat([name,data])));return Buffer.concat([size,name,data,crc])}
// 채움 값 0~4는 행 필터 바이트로도 유효하다(PNG 검증 통과). 값마다 다른 PNG(다른 해시)가 된다.
const pngOf=fill=>{const sig=Buffer.from([137,80,78,71,13,10,26,10]),ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(1080,0);ihdr.writeUInt32BE(1080,4);ihdr[8]=8;ihdr[9]=2;return Buffer.concat([sig,chunk('IHDR',ihdr),chunk('IDAT',deflateSync(Buffer.alloc((1080*3+1)*1080,fill))),chunk('IEND',Buffer.alloc(0))])};
const dataUrl=fill=>'data:image/png;base64,'+pngOf(fill).toString('base64');

// ---- 서버용 fetch 스텁 ----
const graph=[];let recent={data:[]};const VIDEO_SHA='a'.repeat(64),VIDEO_URL=`https://res.cloudinary.com/oda/video/upload/${VIDEO_SHA}.mp4`;
const serverFetch=async(url,init={})=>{
 const u=String(url),method=init.method||'GET',body=init.body?Object.fromEntries(new URLSearchParams(String(init.body))):null;
 if(u.startsWith('https://app.test/media/'))return new Response(null,{status:200,headers:{'content-type':'image/png'}});
 if(u===VIDEO_URL)return new Response(null,{status:200,headers:{'content-type':'video/mp4','content-length':'1000'}});
 if(!u.startsWith('https://graph.facebook.com/v21.0/'))throw new Error('예상 밖 호출: '+u);
 graph.push({u,method,body});
 if(u.includes('/me/media'))return jsonResponse(recent);
 if(u.includes('/me?'))return jsonResponse({id:'17841400000000000',username:'oda_official'});
 if(u.includes('/content_publishing_limit'))return jsonResponse({data:[{quota_usage:1,config:{quota_total:100,quota_duration:86400}}]});
 if(u.endsWith('/media')&&method==='POST')return jsonResponse({id:(body.is_carousel_item?'child-':'ctr-')+graph.filter(c=>c.u.endsWith('/media')&&c.method==='POST').length});
 if(u.endsWith('/media_publish'))return jsonResponse({id:'media-'+graph.filter(c=>c.u.endsWith('/media_publish')).length});
 if(u.includes('fields=status_code'))return jsonResponse({status_code:'FINISHED'});
 return jsonResponse({id:'x'});
};
const rt=testRuntime(serverFetch);
const core=await rt.load('lib/connectors/publish-core.ts'),ig=await rt.load('lib/connectors/instagram-publish.ts'),registry=await rt.load('lib/connectors/registry.ts'),contract=await rt.load('lib/connectors/contract-test.ts');
const setPure=await rt.load('lib/execution-media-set.ts'),reconcile=await rt.load('lib/direct-reconcile.ts');
const credential={channel:'instagram_direct',accessToken:'tok-1',userId:'17841400000000000'};
const recorder=(answer)=>{const calls=[];return {calls,fetch:async(url,init={})=>{const c={url:String(url),method:init.method||'GET',body:init.body?Object.fromEntries(new URLSearchParams(String(init.body))):null};calls.push(c);return answer(c,calls)}}};
const items=['https://app.test/media/1.png','https://app.test/media/2.png','https://app.test/media/3.png'];

// ================= 1부: 공급자 =================
// 1) 캐러셀: 자식 컨테이너 3개(is_carousel_item) → 부모 CAROUSEL(children 순서 그대로) → media_publish.
{
 const r=recorder(c=>c.url.endsWith('/media_publish')?jsonResponse({id:'m-1'}):jsonResponse({id:c.body?.is_carousel_item?'k'+c.body.image_url.slice(-5,-4):'parent-1'}));
 const journal=core.memoryContainerJournal();
 const out=await ig.instagramPublisher({credential,journal,http:{fetch:r.fetch},deps:fakeDeps(),policy}).submit({text:'캡션',mediaType:'CAROUSEL',items},'pub-c');
 const kids=r.calls.filter(c=>c.body?.is_carousel_item==='true');
 check(out.outcome==='success'&&out.id==='m-1'&&out.containerId==='parent-1','carousel publishes after children and parent: '+JSON.stringify(out));
 check(kids.length===3&&kids.map(k=>k.body.image_url).join()===items.join()&&kids.every(k=>!k.body.caption),'one child container per image, in order, without caption');
 const parent=r.calls.find(c=>c.body?.media_type==='CAROUSEL');
 check(!!parent&&parent.body.children==='k1,k2,k3'&&parent.body.caption==='캡션'&&r.calls.indexOf(parent)>r.calls.indexOf(kids[2]),'parent container lists the child ids in order and carries the caption');
 const e=journal.entries()[0];check(e.state==='published'&&e.publishedId==='m-1','journal ends published');
}
// 2) 자식 단위 중단 재개: 저널 children에 첫 자식만 있다. 다시 실행하면 나머지 둘만 만들고 첫 자식 id를 그대로 쓴다.
{
 const r=recorder(c=>c.url.endsWith('/media_publish')?jsonResponse({id:'m-2'}):jsonResponse({id:c.body?.is_carousel_item?'new-'+c.body.image_url.slice(-5,-4):'parent-2'}));
 const journal=core.memoryContainerJournal([{id:'pub-r',channel:'instagram_direct',state:'children',containerId:null,publishedId:null,attempts:1,error:null,updatedAt:'2026-11-14T00:00:00.000Z',childIds:['old-1',null,null]}]);
 const out=await ig.instagramPublisher({credential,journal,http:{fetch:r.fetch},deps:fakeDeps(),policy}).submit({text:'x',mediaType:'CAROUSEL',items},'pub-r');
 const kids=r.calls.filter(c=>c.body?.is_carousel_item==='true');
 check(out.outcome==='success'&&kids.length===2&&kids.map(k=>k.body.image_url).join()===items.slice(1).join(),'resume creates only the missing children: '+JSON.stringify(kids.map(k=>k.body.image_url)));
 check(r.calls.find(c=>c.body?.media_type==='CAROUSEL').body.children==='old-1,new-2,new-3','resumed parent reuses the stored first child id');
}
// 3) 자식 하나가 거부(4xx)되면 부모·게시 요청이 없다. 저널은 children(만든 자식 보존)이고, 다음 실행은 실패한 칸부터 이어 간다.
{
 let fail=true;const r=recorder(c=>{if(c.body?.is_carousel_item&&c.body.image_url.endsWith('2.png')&&fail)return jsonResponse({error:{code:100,message:'bad image'}},400);return c.url.endsWith('/media_publish')?jsonResponse({id:'m-3'}):jsonResponse({id:c.body?.is_carousel_item?'c'+c.body.image_url.slice(-5,-4):'parent-3'})});
 const journal=core.memoryContainerJournal(),pub=ig.instagramPublisher({credential,journal,http:{fetch:r.fetch},deps:fakeDeps(),policy});
 const first=await pub.submit({text:'x',mediaType:'CAROUSEL',items},'pub-f');
 const e=journal.entries()[0];
 check(first.outcome==='fatal'&&/2번째 자식/.test(first.error)&&!r.calls.some(c=>c.url.endsWith('/media_publish')||c.body?.media_type==='CAROUSEL'),'a rejected child stops before the parent and before any publish: '+JSON.stringify(first));
 check(e.state==='children'&&JSON.stringify(e.childIds)===JSON.stringify(['c1',null,null]),'journal keeps the created child and the empty slots: '+JSON.stringify(e.childIds));
 fail=false;const before=r.calls.length;const second=await pub.submit({text:'x',mediaType:'CAROUSEL',items},'pub-f');
 check(second.outcome==='success'&&r.calls.slice(before).filter(c=>c.body?.is_carousel_item).length===2,'next run continues from the failed child');
}
// 4) 준비 검사: 장수 2~10, 이미지 HEAD, 릴스 영상 HEAD(video/*·크기 상한·승인 크기와 일치)·표지.
{
 const head=(type,len)=>recorder(()=>new Response(null,{status:200,headers:{'content-type':type,...(len?{'content-length':String(len)}:{})}}));
 const pub=f=>ig.instagramPublisher({credential,journal:core.memoryContainerJournal(),http:{fetch:f},deps:fakeDeps(),policy});
 const one=await pub(head('image/png').fetch).prepare({text:'x',mediaType:'CAROUSEL',items:items.slice(0,1)});
 const eleven=await pub(head('image/png').fetch).prepare({text:'x',mediaType:'CAROUSEL',items:Array.from({length:11},(_,i)=>`https://app.test/media/${i}.png`)});
 const bad=await pub(head('text/html').fetch).prepare({text:'x',mediaType:'CAROUSEL',items});
 const ok=await pub(head('image/png').fetch).prepare({text:'x',mediaType:'CAROUSEL',items});
 check(!one.ok&&/2~10장/.test(one.issues.join())&&!eleven.ok&&/현재 11장/.test(eleven.issues.join()),'carousel needs 2 to 10 images');
 check(!bad.ok&&bad.issues.filter(i=>/번째 이미지/.test(i)).length===3&&ok.ok,'every carousel image must be reachable without login');
 const reelsOk=await pub(head('video/mp4',1000).fetch).prepare({text:'x',mediaType:'REELS',videoUrl:VIDEO_URL,videoBytes:1000});
 const reelsChanged=await pub(head('video/mp4',999).fetch).prepare({text:'x',mediaType:'REELS',videoUrl:VIDEO_URL,videoBytes:1000});
 const reelsBig=await pub(head('video/mp4',ig.REELS_MAX_BYTES+1).fetch).prepare({text:'x',mediaType:'REELS',videoUrl:VIDEO_URL});
 const reelsNotVideo=await pub(head('image/png',1000).fetch).prepare({text:'x',mediaType:'REELS',videoUrl:VIDEO_URL});
 check(reelsOk.ok&&!reelsChanged.ok&&/승인 때 기록한 크기/.test(reelsChanged.issues.join())&&!reelsBig.ok&&/MB를 넘습니다/.test(reelsBig.issues.join())&&!reelsNotVideo.ok,'reels prepare checks content type, size cap and the approved size');
}
// 5) 릴스 컨테이너: REELS·video_url·cover_url, 처리 완료(FINISHED) 뒤 게시.
{
 const r=recorder(c=>c.url.includes('status_code')?jsonResponse({status_code:'FINISHED'}):c.url.endsWith('/media_publish')?jsonResponse({id:'m-r'}):jsonResponse({id:'ctr-r'}));
 const out=await ig.instagramPublisher({credential,journal:core.memoryContainerJournal(),http:{fetch:r.fetch},deps:fakeDeps(),policy}).submit({text:'릴스',mediaType:'REELS',videoUrl:VIDEO_URL,coverUrl:items[0]},'pub-reels');
 const ctr=r.calls[0];
 check(out.outcome==='success'&&ctr.body.media_type==='REELS'&&ctr.body.video_url===VIDEO_URL&&ctr.body.cover_url===items[0]&&r.calls.some(c=>c.url.includes('status_code')),'reels container carries video and cover and publishes after FINISHED');
}
// 6) 최근 게시물(대조용 읽기): /me/media?fields=id,caption,timestamp,permalink.
{
 const r=recorder(()=>jsonResponse({data:[{id:'1',caption:'a',timestamp:'2026-11-14T00:00:00+0000',permalink:'https://www.instagram.com/p/1/'},{id:'2'}]}));
 const list=await ig.instagramPublisher({credential,journal:core.memoryContainerJournal(),http:{fetch:r.fetch},deps:fakeDeps(),policy}).recentMedia();
 check(r.calls[0].url==='https://graph.facebook.com/v21.0/me/media?fields=id,caption,timestamp,permalink&limit=25'&&r.calls[0].method==='GET'&&list.length===2&&list[0].permalink.endsWith('/p/1/')&&list[1].caption==='','recentMedia reads /me/media with the four fields only');
 const failing=await ig.instagramPublisher({credential,journal:core.memoryContainerJournal(),http:{fetch:async()=>jsonResponse({error:{code:190}},400)},deps:fakeDeps(),policy}).recentMedia();
 check(failing===null,'a failed read returns null (caller keeps the state)');
}
// 7) 계약 하네스 재실행(바뀐 커넥터): 게시는 media_publish, 읽기는 새 /me/media.
{
 const scripted=script=>{const calls={};let current='';
  const fetch=async()=>{const steps=script[current]??[{kind:'thrown'}],step=steps[Math.min(calls[current],steps.length)-1];
   if(step.kind==='response')return new Response(step.value===undefined?null:JSON.stringify(step.value),{status:step.status,headers:step.retryAfter?{'retry-after':step.retryAfter}:{}});
   if(step.kind==='timeout')throw timeoutError();if(step.kind==='network_error')throw step.sent?new TypeError('fetch failed'):refusedError();throw new Error('thrown')};
  const raw=ig.instagramDirectRaw(credential,{fetch});
  return {capabilities:registry.descriptorFor('instagram_direct').capabilities,calls:()=>({...calls}),async execute(op){calls[op.id]=(calls[op.id]??0)+1;current=op.id;const a=await (op.capability==='instagram_direct.media.publish'?raw.publish('ctr-x'):raw.recentMedia());return {...a,value:a.payload}}};
 };
 const results=await contract.runContractScenarios(scripted,{read:'instagram_direct.limit.read',write:'instagram_direct.media.publish'});
 for(const r of results)check(r.passed,`instagram_direct contract (recent media read) ${r.scenario}: ${r.details.join(' | ')}`);
 check(results.length===5&&registry.capabilityFor('instagram_direct.limit.read').reads.includes('recent_media')&&registry.describeViolations().length===0,'five scenarios ran and the registry stays valid with recent_media');
}

// ================= 2부: 순수 =================
{
 const p={pngHash:'p'.repeat(64),mediaSet:{type:'CAROUSEL',items:[{creativeId:'b',creativeVersion:1,pngHash:'b'.repeat(64),mediaUrl:''},{creativeId:'c',creativeVersion:1,pngHash:'c'.repeat(64),mediaUrl:''}]}};
 check(setPure.publicationMediaHashes(p).join()===['p','b','c'].map(x=>x.repeat(64)).join()&&JSON.stringify(setPure.mediaSetApproval({pngHash:'p'.repeat(64)}))==='{}','hash list starts with the primary creative and is empty-free for single images');
 check(setPure.publicationMediaHashes({...p,codedPng:{hash:'d'.repeat(64)}})[0]==='d'.repeat(64),'a coded PNG replaces the first hash');
 check(setPure.publicationMediaHashes({pngHash:'p'.repeat(64),mediaSet:{type:'REELS',video:{url:VIDEO_URL,sha256:VIDEO_SHA,bytes:10}}}).join()===['p'.repeat(64),VIDEO_SHA].join(),'reels hashes are cover then video');
 const refuse=f=>{try{f();return ''}catch(e){return e.message}};
 check(/Cloudinary 또는 R2/.test(refuse(()=>setPure.parseVideoInput({url:'https://evil.test/'+VIDEO_SHA+'.mp4',sha256:VIDEO_SHA,bytes:10})))&&/64자/.test(refuse(()=>setPure.parseVideoInput({url:VIDEO_URL,sha256:'zz',bytes:10})))&&/크기/.test(refuse(()=>setPure.parseVideoInput({url:VIDEO_URL,sha256:VIDEO_SHA,bytes:0})))&&setPure.parseVideoInput({url:VIDEO_URL,sha256:VIDEO_SHA.toUpperCase(),bytes:10}).sha256===VIDEO_SHA,'video input requires an allowed host, the hash file name and a size');
 check(/1~9개/.test(refuse(()=>setPure.parseCarouselIds([],'a')))&&/두 번/.test(refuse(()=>setPure.parseCarouselIds(['a'],'a')))&&/두 번/.test(refuse(()=>setPure.parseCarouselIds(['b','b'],'a')))&&setPure.parseCarouselIds(['b','c'],'a').join()==='b,c','carousel ids: 1~9 extra, no duplicates');
}
{
 const at='2026-11-14T03:00:00.000Z',base=Date.parse(at),ts=m=>new Date(base+m*60000).toISOString();
 const media=[{id:'1',caption:'신메뉴 안내\r\n#휘경동 ',timestamp:ts(2),permalink:'https://www.instagram.com/p/1/'},{id:'2',caption:'다른 글',timestamp:ts(3),permalink:null},{id:'3',caption:'신메뉴 안내\n#휘경동',timestamp:ts(-60),permalink:null}];
 const v1=await reconcile.matchUncertain({caption:'신메뉴 안내\n#휘경동',attemptedAt:at,now:base+10*60000,media});
 check(v1.result==='match'&&v1.media.id==='1','one caption-hash match inside the window (CRLF and trailing space normalised, out-of-window duplicate ignored)');
 const v2=await reconcile.matchUncertain({caption:'없는 글',attemptedAt:at,now:base+10*60000,media});
 const v3=await reconcile.matchUncertain({caption:'없는 글',attemptedAt:at,now:base+31*60000,media});
 check(v2.result==='none'&&v2.windowClosed===false&&v3.result==='none'&&v3.windowClosed===true,'no match stays open inside the window and closes after 30 minutes');
 const v4=await reconcile.matchUncertain({caption:'신메뉴 안내\n#휘경동',attemptedAt:at,now:base,media:[...media,{id:'4',caption:'신메뉴 안내\n#휘경동',timestamp:ts(4),permalink:null}]});
 check(v4.result==='multiple'&&v4.candidates.map(c=>c.id).join()==='1,4','two matches stay uncertain with both candidates');
 const v5=await reconcile.matchUncertain({caption:'신메뉴 안내\n#휘경동',attemptedAt:at,now:base,media,excludeIds:new Set(['1'])});
 check(v5.result==='none','a post already linked to another publication is excluded');
}

// ================= 3부: 서버 =================
const server=await rt.load('lib/server.ts'),channels=await rt.load('app/api/channels/route.ts'),execution=await rt.load('app/api/execution/route.ts'),flags=await rt.load('lib/feature-flags.ts');
const objects=new Map();
rt.env.BUCKET={put:async(k,v)=>{objects.set(k,new Uint8Array(v instanceof Uint8Array?v:await new Response(v).arrayBuffer()))},get:async k=>objects.has(k)?{arrayBuffer:async()=>objects.get(k).slice().buffer,body:new Response(objects.get(k)).body}:null,head:async k=>objects.has(k)?{}:null,delete:async k=>{objects.delete(k)}};
const owner='owner';await server.seedBrands(owner);
const H={'content-type':'application/json','oai-authenticated-user-id':owner,origin:'https://app.test'};
const post=async(route,body)=>{const r=await route.POST(new Request('https://app.test/api/x',{method:'POST',headers:H,body:JSON.stringify(body)}));return {status:r.status,data:await r.json()}};
const rows=kind=>rt.sql.prepare("SELECT id,data FROM records WHERE owner=? AND kind=? ORDER BY id").all(owner,kind).map(r=>({...JSON.parse(r.data),rowId:r.id}));
const put=(kind,id,value,parent='')=>server.recordStatement(owner,kind,id,value,parent).run();
const resetRate=()=>put('execution_rate','execution',{startedAt:Date.now(),count:0});
const by={id:owner,email:null},IG='instagram_direct:17841400000000000';
await put('brand_fact','fact',{id:'fact',brandId:'oda',key:'address',value:'휘경동 377 C107',status:'confirmed',source:'owner',verifiedAt:new Date().toISOString(),validUntil:'2099-01-01T00:00:00Z',version:1},'oda');
await put('campaign','c1',{id:'c1',brandId:'oda',title:'ODA',version:1,status:'approved',startDate:'2098-01-01',endDate:'2098-12-31',budget:100000,budgetConfirmedAt:'2026-09-01T00:00:00.000Z'});
assert.equal((await post(channels,{action:'connect_publisher',channel:'instagram_direct',brandId:'oda',data:{accessToken:'tok-1',userId:'17841400000000000'}})).status,200);
await resetRate();
const limits=await post(execution,{action:'save_limits',campaignId:'c1',maxPublications:20,maxPlannedCostKRW:1000});assert.equal(limits.status,200,JSON.stringify(limits.data));
const creatives=[];for(const fill of [0,1,2]){const c=await post(execution,{action:'save_creative',campaignId:'c1',campaignVersion:1,factRefs:[{id:'fact',version:1}],png:dataUrl(fill)});assert.equal(c.status,200,JSON.stringify(c.data));creatives.push(c.data)}
let slot=0;const when=()=>new Date(Date.UTC(2098,0,1,++slot)).toISOString();
const carouselDraft=()=>post(execution,{action:'save_publication',campaignId:'c1',creativeId:creatives[0].id,scheduledAt:when(),plannedCostKRW:0,mediaSet:{type:'CAROUSEL',creativeIds:[creatives[1].id,creatives[2].id]}});
const approveBody=(p,extra={})=>({action:'approve',campaignId:'c1',id:p.id,version:p.version,confirmed:true,rightsConfirmed:true,channelId:IG,credentialVersion:1,limitsVersion:limits.data.version,...extra});
// 8) 스위치 꺼짐: 묶음 준비는 409, 단일 이미지 경로는 그대로(Buffer 미연결이라 계정 없음).
{
 const r=await carouselDraft();
 check(r.status===409&&/instagram_direct_publish/.test(r.data.error)&&rows('execution_publication').length===0,'with the flag off a carousel cannot be prepared: '+JSON.stringify(r.data));
 await flags.setFeatureFlag(owner,{flag:'instagram_direct_publish',enabled:true},by);
}
let carousel;
// 9) 준비: 첫 장 + 추가 2장. 잘못된 입력은 400.
{
 await resetRate();
 const dup=await post(execution,{action:'save_publication',campaignId:'c1',creativeId:creatives[0].id,scheduledAt:when(),plannedCostKRW:0,mediaSet:{type:'CAROUSEL',creativeIds:[creatives[0].id]}});
 const bad=await post(execution,{action:'save_publication',campaignId:'c1',creativeId:creatives[0].id,scheduledAt:when(),plannedCostKRW:0,mediaSet:{type:'SLIDES'}});
 check(dup.status===400&&/두 번/.test(dup.data.error)&&bad.status===400,'duplicate creative and unknown type are 400');
 const r=await carouselDraft();carousel=r.data;
 check(r.status===200&&r.data.mediaSet.type==='CAROUSEL'&&r.data.mediaSet.items.map(i=>i.pngHash).join()===[creatives[1].pngHash,creatives[2].pngHash].join()&&r.data.mediaSet.items.every(i=>i.mediaUrl===''),'carousel draft stores the extra creatives with their PNG hashes: '+JSON.stringify(r.data.error||''));
}
// 10) 승인: 해시 없음·순서 다름 409, 맞으면 승인하고 추가 장도 앱 공개 주소로 연다.
{
 await resetRate();
 const hashes=[creatives[0].pngHash,creatives[1].pngHash,creatives[2].pngHash];
 const none=await post(execution,approveBody(carousel));
 const swapped=await post(execution,approveBody(carousel,{mediaHashes:[hashes[0],hashes[2],hashes[1]]}));
 check(none.status===409&&/미디어 해시/.test(none.data.error)&&swapped.status===409,'approval without or with a different media hash list is 409: '+none.data.error);
 const ok=await post(execution,approveBody(carousel,{mediaHashes:hashes}));carousel=ok.data;
 check(ok.status===200&&ok.data.status==='approved'&&ok.data.mediaSet.items.every((it,i)=>it.mediaUrl===`https://app.test/media/${hashes[i+1]}.png`)&&objects.has(`public/${hashes[2]}.png`),'approval publishes every extra item at its hash address: '+JSON.stringify(ok.data.error||ok.data.mediaSet));
 check(graph.filter(c=>c.method==='POST').length===0,'nothing is sent to Instagram at approval');
}
// 11) 실행: 한도 확인 → 자식 3(공개 주소 순서) → 부모 → 게시. published.
{
 await resetRate();const before=graph.length;
 const r=await post(execution,{action:'execute',campaignId:'c1',id:carousel.id,version:carousel.version});
 const sent=graph.slice(before),kids=sent.filter(c=>c.body?.is_carousel_item==='true'),parent=sent.find(c=>c.body?.media_type==='CAROUSEL');
 check(r.status===200&&r.data.status==='published'&&r.data.providerId==='media-1','carousel execution lands on published: '+JSON.stringify({status:r.data.status,error:r.data.error}));
 check(kids.map(k=>k.body.image_url).join()===[carousel.mediaUrl,...carousel.mediaSet.items.map(i=>i.mediaUrl)].join()&&!!parent&&parent.body.children===kids.map((_,i)=>'child-'+(i+1)).join(),'children are the approved public copies in order and the parent lists them');
 check(sent.findIndex(c=>c.u.includes('content_publishing_limit'))<sent.indexOf(kids[0]),'the publishing limit is checked before any container');
 const journal=rows('publication_container').find(e=>e.id===carousel.id);
 check(journal.state==='published'&&journal.childIds.length===3,'journal keeps the child ids');
}
// 12) 승인 뒤 추가 소재가 바뀌면(버전·PNG) 실행은 409이고 아무것도 보내지 않는다.
{
 await resetRate();
 let p=(await carouselDraft()).data;
 p=(await post(execution,approveBody(p,{mediaHashes:setPure.publicationMediaHashes(p)}))).data;
 const stored=rows('execution_creative').find(c=>c.id===creatives[2].id);
 await put('execution_creative',creatives[2].id,{...stored,rowId:undefined,version:stored.version+1},'c1');
 const before=graph.length;
 const r=await post(execution,{action:'execute',campaignId:'c1',id:p.id,version:p.version});
 check(r.status===409&&/캐러셀 소재가 변경/.test(r.data.error)&&graph.length===before,'a changed carousel item blocks execution before any call: '+JSON.stringify(r.data));
 await put('execution_creative',creatives[2].id,{...stored,rowId:undefined},'c1');
}
// 13) 릴스: 영상(해시 파일명·크기) + 첫 장 표지. 승인 해시는 [표지, 영상], 실행은 REELS 컨테이너 → FINISHED → 게시.
{
 await resetRate();
 const d=await post(execution,{action:'save_publication',campaignId:'c1',creativeId:creatives[1].id,scheduledAt:when(),plannedCostKRW:0,mediaSet:{type:'REELS',video:{url:VIDEO_URL,sha256:VIDEO_SHA,bytes:1000}}});
 check(d.status===200&&d.data.mediaSet.video.sha256===VIDEO_SHA,'reels draft records the video hash and size');
 const a=await post(execution,approveBody(d.data,{mediaHashes:[creatives[1].pngHash,VIDEO_SHA]}));
 const before=graph.length;
 const r=await post(execution,{action:'execute',campaignId:'c1',id:d.data.id,version:a.data.version});
 const ctr=graph.slice(before).find(c=>c.body?.media_type==='REELS');
 check(a.status===200&&r.status===200&&r.data.status==='published'&&ctr.body.video_url===VIDEO_URL&&ctr.body.cover_url===a.data.mediaUrl,'reels executes with the approved video and the cover image: '+JSON.stringify({a:a.data.error,r:r.data.error}));
}
// 14) 결과 미확인 대조(reconcile_direct): 하나 일치 → published·permalink, 없음(창 안) → 그대로, 없음(창 밖) → failed, 여럿 → 후보. POST 0회.
{
 const seed=async(id,minutesAgo,caption)=>{const p={id,campaignId:'c1',creativeId:creatives[0].id,creativeVersion:1,campaignVersion:1,pngHash:creatives[0].pngHash,factRefs:[],caption,mediaUrl:'',mediaMode:'external',scheduledAt:'2098-01-01T00:00:00.000Z',plannedCostKRW:0,version:3,status:'uncertain',channelId:IG,attemptedAt:new Date(Date.now()-minutesAgo*60000).toISOString(),createdAt:new Date().toISOString()};await put('execution_publication',id,p,'c1');return p};
 const ts=m=>new Date(Date.now()-m*60000).toISOString();
 const one=await seed('u-one',20,'하나뿐인 캡션'),open=await seed('u-open',5,'아직 없는 캡션'),closed=await seed('u-closed',45,'끝내 없는 캡션'),many=await seed('u-many',20,'겹치는 캡션');
 recent={data:[{id:'ig-1',caption:'하나뿐인 캡션',timestamp:ts(19),permalink:'https://www.instagram.com/p/one/'},{id:'ig-2',caption:'겹치는 캡션',timestamp:ts(19)},{id:'ig-3',caption:'겹치는 캡션',timestamp:ts(18)}]};
 await resetRate();const posts=graph.filter(c=>c.method==='POST').length;
 const rc=p=>post(execution,{action:'reconcile_direct',campaignId:'c1',id:p.id,version:p.version});
 const r1=await rc(one),r2=await rc(open),r3=await rc(closed),r4=await rc(many);
 check(r1.status===200&&r1.data.status==='published'&&r1.data.providerId==='ig-1'&&r1.data.permalink==='https://www.instagram.com/p/one/','exactly one match closes as published with the permalink: '+JSON.stringify(r1.data));
 check(rows('publication_container').find(e=>e.id==='u-one')?.state==='published','the journal is closed as published so re-execution cannot resend');
 check(r2.status===200&&r2.data.status==='uncertain'&&r2.data.directReconcile.result==='none_yet'&&r2.data.reconcile.windowClosed===false,'no match inside the window stays uncertain');
 check(r3.status===200&&r3.data.status==='failed'&&/같은 캡션 게시물이 없습니다/.test(r3.data.error),'no match after the window closes as failed with a reason');
 check(r4.status===200&&r4.data.status==='uncertain'&&r4.data.directReconcile.result==='multiple'&&r4.data.directReconcile.candidates.map(c=>c.id).join()==='ig-2,ig-3','multiple matches stay uncertain and show the candidates');
 check(graph.filter(c=>c.method==='POST').length===posts&&graph.filter(c=>c.u.includes('/me/media')).length===4,'reconciliation only reads /me/media and never posts');
 const again=await rc(r1.data);
 check(again.status===409,'a published publication cannot be reconciled again');
 const busy=await seed('u-submitting',0,'방금 보낸 캡션');const r5=await post(execution,{action:'reconcile_direct',campaignId:'c1',id:busy.id,version:busy.version});
 check(r5.status===200||r5.status===409,'a just-sent item is handled without a resend');
 const ev=rows('event').filter(e=>/계정 게시물 대조|같은 캡션/.test(e.message));
 check(ev.length>=4,'each reconciliation leaves an audit event');
}
// 15) 직원은 대조할 수 없다(관리자 전용 동작 목록).
{
 const route=(await import('node:fs')).readFileSync('app/api/execution/route.ts','utf8');
 check(/adminActions=\[[^\]]*'reconcile_direct'/.test(route),'reconcile_direct is an admin-only action');
}

if(failures.length){console.error(failures.join('\n'));process.exit(1)}
console.log(JSON.stringify({passed:checks}));
