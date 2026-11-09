// C3 Instagram Graph 직접 게시·Threads 게시. 근거: mocked(fetch 스텁, 메모리 SQLite, 로컬 인증 헤더). 외부 네트워크 호출 0회.
// 1부 공급자(순수, fetch 주입): 두 단계 게시·중단 재개·게시 뒤 타임아웃 unknown(재전송 없음)·429 Retry-After·한도 해석·준비 검사·Threads·댓글·검증·계약 하네스 5 시나리오.
// 2부 서버(D1 모의): 연결 저장(/me 검증)·상태·검증 액션, 스위치 꺼짐=Buffer 경로, 켜짐+연결=직접 경로(승인→실행→published, 캡션·이미지 주소 그대로 전송), 댓글 수집 기록.
import assert from 'node:assert/strict';
import {deflateSync} from 'node:zlib';
import {readFileSync} from 'node:fs';
import {testRuntime} from './helpers/runtime.mjs';

let checks=0;const failures=[];function check(value,label){checks++;if(!value)failures.push(label)}
const timeoutError=()=>Object.assign(new Error('The operation was aborted due to timeout'),{name:'TimeoutError'});
const refusedError=()=>Object.assign(new TypeError('fetch failed'),{cause:{code:'ECONNREFUSED'}});
const jsonResponse=(body,status=200,headers={})=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json',...headers}});
const fakeDeps=()=>{const waits=[];let t=0;return {deps:{now:()=>t,random:()=>0.5,sleep:async ms=>{waits.push(ms);t+=ms}},waits}};
const policy={maxAttempts:3,baseDelayMs:100,maxDelayMs:5000};

// ---- 2부용 서버 fetch 스텁(1부의 공급자는 http 옵션으로 자기 fetch를 받는다) ----
function crc32(bytes){let crc=0xffffffff;for(const byte of bytes){crc^=byte;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0)}return (crc^0xffffffff)>>>0}
function chunk(type,data){const name=Buffer.from(type),size=Buffer.alloc(4),crc=Buffer.alloc(4);size.writeUInt32BE(data.length);crc.writeUInt32BE(crc32(Buffer.concat([name,data])));return Buffer.concat([size,name,data,crc])}
const signature=Buffer.from([137,80,78,71,13,10,26,10]),ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(1080,0);ihdr.writeUInt32BE(1080,4);ihdr[8]=8;ihdr[9]=2;
const pixels=Buffer.alloc((1080*3+1)*1080,0);const png=Buffer.concat([signature,chunk('IHDR',ihdr),chunk('IDAT',deflateSync(pixels)),chunk('IEND',Buffer.alloc(0))]);
const dataUrl='data:image/png;base64,'+png.toString('base64');
const graph=[];let threadsCalls=[];
const serverFetch=async(url,init={})=>{
 const u=String(url),method=init.method||'GET',body=init.body?Object.fromEntries(new URLSearchParams(String(init.body))):null,auth=new Headers(init.headers).get('Authorization')||'';
 // (아래 분기들은 init의 method·body·headers만 읽는다)
 if(u.startsWith('https://res.cloudinary.com/'))return method==='HEAD'?new Response(null,{status:200,headers:{'content-type':'image/png'}}):new Response(png,{headers:{'content-type':'image/png'}});
 if(u.startsWith('https://api.buffer.com')){const {query}=JSON.parse(init.body);if(query.includes('channels('))return jsonResponse({data:{channels:[{id:'channel-1',name:'ODA',service:'instagram',isQueuePaused:false}]}});return jsonResponse({data:{}})}
 if(u.startsWith('https://graph.threads.net/')){threadsCalls.push({u,method,body});if(u.includes('/me?'))return jsonResponse({id:'900',username:'oda_threads'});return jsonResponse({id:'t-1'})}
 if(!u.startsWith('https://graph.facebook.com/v21.0/'))throw new Error('예상 밖 호출: '+u);
 graph.push({u,method,body,auth});
 if(u.includes('/me?'))return auth==='Bearer tok-bad'?jsonResponse({error:{code:190,message:'Invalid OAuth access token'}},400):jsonResponse({id:'17841400000000000',username:'oda_official'});
 if(u.includes('/content_publishing_limit'))return jsonResponse({data:[{quota_usage:3,config:{quota_total:100,quota_duration:86400}}]});
 if(u.endsWith('/media')&&method==='POST')return jsonResponse({id:'ctr-'+graph.filter(c=>c.u.endsWith('/media')&&c.method==='POST').length});
 if(u.endsWith('/media_publish'))return jsonResponse({id:'media-1'});
 if(u.includes('/comments'))return jsonResponse({data:[{id:'cm-1',text:'맛있어 보여요',username:'fan1',timestamp:'2026-11-09T01:00:00+0000',like_count:2},{id:'cm-2',text:'',username:'x'},{id:'cm-3',text:'가격이 얼마예요?',username:'fan2'}]});
 return jsonResponse({id:'media-1',permalink:'https://www.instagram.com/p/abc/',timestamp:'2026-11-09T00:00:00+0000'});
};
const rt=testRuntime(serverFetch);
const core=await rt.load('lib/connectors/publish-core.ts'),ig=await rt.load('lib/connectors/instagram-publish.ts'),th=await rt.load('lib/connectors/threads.ts'),registry=await rt.load('lib/connectors/registry.ts'),contract=await rt.load('lib/connectors/contract-test.ts'),exec=await rt.load('lib/execution.ts'),disclosure=await rt.load('lib/ai-disclosure.ts');
const credential={channel:'instagram_direct',accessToken:'tok-1',userId:'17841400000000000'};

// 1) 두 단계 성공: 컨테이너 → 게시. 캡션·이미지 주소는 그대로, 토큰은 헤더로만. 저널 published.
{
 const calls=[];const fetch=async(url,init)=>{calls.push({url:String(url),method:init.method,body:init.body?Object.fromEntries(new URLSearchParams(String(init.body))):null,auth:new Headers(init.headers).get('Authorization')});return String(url).endsWith('/media')?jsonResponse({id:'ctr-1'}):jsonResponse({id:'media-9'})};
 const journal=core.memoryContainerJournal(),{deps}=fakeDeps();
 const p=ig.instagramPublisher({credential,journal,http:{fetch},deps,policy});
 const r=await p.submit({text:'안녕 #a',imageUrl:'https://app.test/media/abc.png',mediaType:'IMAGE'},'pub-1');
 check(r.outcome==='success'&&r.id==='media-9'&&r.containerId==='ctr-1'&&r.attempts===2,'two-step publish succeeds with container and media id: '+JSON.stringify(r));
 check(calls.length===2&&calls[0].url==='https://graph.facebook.com/v21.0/17841400000000000/media'&&calls[0].body.image_url==='https://app.test/media/abc.png'&&calls[0].body.caption==='안녕 #a'&&calls[1].url.endsWith('/media_publish')&&calls[1].body.creation_id==='ctr-1','container then media_publish with caption and image url verbatim: '+JSON.stringify(calls));
 check(calls.every(c=>c.auth==='Bearer tok-1'&&!c.url.includes('tok-1')),'token travels in the Authorization header, never in the URL');
 const e=journal.entries()[0];check(e.state==='published'&&e.containerId==='ctr-1'&&e.publishedId==='media-9'&&e.id==='pub-1','journal ends published');
 const again=await p.submit({text:'안녕',imageUrl:'https://app.test/media/abc.png'},'pub-1');
 check(again.outcome==='cached'&&again.id==='media-9'&&calls.length===2,'same idempotency key returns the cached result without any call');
}
// 2) 중단 재개: 컨테이너를 만든 뒤 죽었다(저널 created). 다시 실행하면 컨테이너를 새로 만들지 않고 게시만 한다.
{
 const calls=[];const fetch=async(url)=>{calls.push(String(url));return jsonResponse({id:String(url).endsWith('/media')?'ctr-new':'media-2'})};
 const journal=core.memoryContainerJournal([{id:'pub-2',channel:'instagram_direct',state:'created',containerId:'ctr-old',publishedId:null,attempts:1,error:null,updatedAt:'2026-11-09T00:00:00.000Z'}]);
 const r=await ig.instagramPublisher({credential,journal,http:{fetch},deps:fakeDeps().deps,policy}).submit({text:'x',imageUrl:'https://app.test/m.png'},'pub-2');
 check(r.outcome==='success'&&r.containerId==='ctr-old'&&r.id==='media-2'&&calls.length===1&&calls[0].endsWith('/media_publish'),'resume after crash publishes the stored container without creating a new one: '+JSON.stringify(calls));
 check(journal.entries()[0].state==='published'&&journal.entries()[0].attempts===2,'journal attempts accumulate across the resume');
}
// 3) 게시 뒤 타임아웃: unknown, 재시도 없음, 저널 unknown. 다음 실행도 보내지 않는다(refuse). 컨테이너 생성 타임아웃은 보이는 쓰기가 아니라 재시도한다.
{
 const calls=[];const fetch=async(url)=>{calls.push(String(url));if(String(url).endsWith('/media_publish'))throw timeoutError();return jsonResponse({id:'ctr-3'})};
 const journal=core.memoryContainerJournal(),{deps,waits}=fakeDeps();
 const p=ig.instagramPublisher({credential,journal,http:{fetch},deps,policy});
 const r=await p.submit({text:'x',imageUrl:'https://app.test/m.png'},'pub-3');
 check(r.outcome==='unknown'&&r.containerId==='ctr-3'&&calls.filter(c=>c.endsWith('/media_publish')).length===1&&/자동 재전송하지 않습니다/.test(r.error),'publish timeout after send is unknown with exactly one publish call: '+JSON.stringify(r));
 check(journal.entries()[0].state==='unknown'&&waits.length===0,'journal is unknown and nothing was retried');
 const r2=await p.submit({text:'x',imageUrl:'https://app.test/m.png'},'pub-3');
 check(r2.outcome==='unknown'&&calls.length===2,'a second execute with the same key is refused without any call');
 let n=0;const flaky=async(url)=>{if(String(url).endsWith('/media')&&n++===0)throw timeoutError();return jsonResponse({id:String(url).endsWith('/media')?'ctr-4':'media-4'})};
 const j2=core.memoryContainerJournal(),d2=fakeDeps();
 const r3=await ig.instagramPublisher({credential,journal:j2,http:{fetch:flaky},deps:d2.deps,policy}).submit({text:'x',imageUrl:'https://app.test/m.png'},'pub-4');
 check(r3.outcome==='success'&&r3.attempts===3&&d2.waits.length===1,'a container-creation timeout (not visible) is retried once and then publishes: '+JSON.stringify(r3));
 // 보내기 전 연결 거부(ECONNREFUSED)는 게시 단계라도 재시도한다.
 let m=0;const refused=async(url)=>{if(String(url).endsWith('/media_publish')&&m++===0)throw refusedError();return jsonResponse({id:String(url).endsWith('/media')?'ctr-5':'media-5'})};
 const r4=await ig.instagramPublisher({credential,journal:core.memoryContainerJournal(),http:{fetch:refused},deps:fakeDeps().deps,policy}).submit({text:'x',imageUrl:'https://app.test/m.png'},'pub-5');
 check(r4.outcome==='success'&&r4.id==='media-5','a connection refused before sending is retried (bytes never left)');
}
// 4) 429 + Retry-After: 게시가 429(Retry-After 2)면 2초 뒤 다시 보내 성공. 세 번 연속 429면 rate_limited 실패(게시물 없음, 컨테이너 유지).
{
 let n=0;const fetch=async(url)=>{if(String(url).endsWith('/media_publish')&&n++===0)return jsonResponse({error:{code:4,message:'rate'}},429,{'retry-after':'2'});return jsonResponse({id:String(url).endsWith('/media')?'ctr-6':'media-6'})};
 const {deps,waits}=fakeDeps();
 const r=await ig.instagramPublisher({credential,journal:core.memoryContainerJournal(),http:{fetch},deps,policy}).submit({text:'x',imageUrl:'https://app.test/m.png'},'pub-6');
 check(r.outcome==='success'&&r.id==='media-6'&&JSON.stringify(waits)==='[2000]','429 waits Retry-After seconds then succeeds: '+JSON.stringify(waits));
 const always=async(url)=>String(url).endsWith('/media_publish')?jsonResponse({error:{code:4}},429):jsonResponse({id:'ctr-7'});
 const j=core.memoryContainerJournal(),d=fakeDeps();
 const r2=await ig.instagramPublisher({credential,journal:j,http:{fetch:always},deps:d.deps,policy}).submit({text:'x',imageUrl:'https://app.test/m.png'},'pub-7');
 check(r2.outcome==='rate_limited'&&r2.attempts===4&&j.entries()[0].state==='failed'&&/429/.test(r2.error)&&JSON.stringify(d.waits)==='[100,200]','persistent 429 ends rate_limited after maxAttempts with jittered backoff: '+JSON.stringify(r2)+' '+JSON.stringify(d.waits));
 const fatal=async(url)=>String(url).endsWith('/media_publish')?jsonResponse({error:{code:9,error_subcode:2207042,message:'limit'}},400):jsonResponse({id:'ctr-8'});
 const r3=await ig.instagramPublisher({credential,journal:core.memoryContainerJournal(),http:{fetch:fatal},deps:fakeDeps().deps,policy}).submit({text:'x',imageUrl:'https://app.test/m.png'},'pub-8');
 check(r3.outcome==='fatal'&&r3.attempts===2&&/code 9\/2207042/.test(r3.error),'4xx publish is fatal without retry and keeps the Graph error code: '+r3.error);
}
// 5) 한도 해석: content_publishing_limit 응답 → used/total/remaining. 없는 값은 null.
{
 const fetch=async()=>jsonResponse({data:[{quota_usage:3,config:{quota_total:100,quota_duration:86400}}]});
 const l=await ig.instagramPublisher({credential,journal:core.memoryContainerJournal(),http:{fetch},deps:fakeDeps().deps,policy}).limit();
 check(l.used===3&&l.total===100&&l.remaining===97&&l.durationSeconds===86400,'content_publishing_limit parses quota_usage and config: '+JSON.stringify({...l,raw:undefined}));
 const empty=core.parsePublishLimit({data:[]}),broken=core.parsePublishLimit({error:{}});
 check(empty.used===null&&empty.total===null&&empty.remaining===null&&broken.remaining===null,'missing quota values stay null (not 0)');
 const url=[];const l2=await ig.instagramPublisher({credential:{...credential,login:'instagram'},journal:core.memoryContainerJournal(),http:{fetch:async u=>{url.push(String(u));return jsonResponse({data:[{quota_usage:50,config:{quota_total:50}}]})}},deps:fakeDeps().deps,policy}).limit();
 check(l2.remaining===0&&url[0].startsWith('https://graph.instagram.com/v21.0/17841400000000000/content_publishing_limit'),'Instagram Login credentials use graph.instagram.com and an exhausted quota reads remaining 0');
}
// 6) 준비 검사: 캡션 2,200자·해시태그 30개·이미지 주소 HEAD(로그인 리디렉션·비이미지는 실패).
{
 const head=async(url,init)=>init.method==='HEAD'?(String(url).includes('private')?new Response(null,{status:302,headers:{location:'/login'}}):new Response(null,{status:200,headers:{'content-type':'image/png'}})):jsonResponse({});
 const p=ig.instagramPublisher({credential,journal:core.memoryContainerJournal(),http:{fetch:head},deps:fakeDeps().deps,policy});
 const ok=await p.prepare({text:'짧은 캡션 #하나',imageUrl:'https://app.test/media/a.png'});
 check(ok.ok&&ok.imageReachable===true&&!ok.issues.length,'a valid draft passes prepare: '+JSON.stringify(ok));
 const long=await p.prepare({text:'가'.repeat(2201),imageUrl:'https://app.test/media/a.png'});
 check(!long.ok&&long.issues.some(i=>/2,200자/.test(i)),'2,201-character caption is rejected: '+JSON.stringify(long.issues));
 const tags=await p.prepare({text:Array.from({length:31},(_,i)=>'#t'+i).join(' '),imageUrl:'https://app.test/media/a.png'});
 check(!tags.ok&&tags.issues.some(i=>/해시태그가 30개/.test(i)),'31 hashtags are rejected');
 const priv=await p.prepare({text:'x',imageUrl:'https://app.test/private/a.png'});
 check(!priv.ok&&priv.imageReachable===false&&priv.issues.some(i=>/HEAD/.test(i)),'an image behind a login redirect is not reachable');
 const none=await p.prepare({text:'x'});
 check(!none.ok&&none.issues.some(i=>/이미지 주소가 없습니다/.test(i)),'an image post without image url is rejected');
 const http=await p.prepare({text:'x',imageUrl:'http://app.test/media/a.png'});
 check(http.imageReachable===false,'plain http image urls are refused');
}
// 7) Threads: 텍스트만이면 TEXT, 이미지가 있으면 IMAGE. 두 단계·한도 250·본문 500자.
{
 const calls=[];const fetch=async(url,init)=>{calls.push({url:String(url),body:init.body?Object.fromEntries(new URLSearchParams(String(init.body))):null});if(String(url).includes('threads_publishing_limit'))return jsonResponse({data:[{quota_usage:10,config:{quota_total:250,quota_duration:86400}}]});return jsonResponse({id:String(url).endsWith('/threads')?'tc-1':'tp-1'})};
 const t={channel:'threads',accessToken:'tok-t',userId:'900'};
 const p=th.threadsPublisher({credential:t,journal:core.memoryContainerJournal(),http:{fetch},deps:fakeDeps().deps,policy});
 const r=await p.submit({text:'스레드 글'},'tpub-1');
 check(r.outcome==='success'&&r.id==='tp-1'&&calls[0].url==='https://graph.threads.net/v1.0/900/threads'&&calls[0].body.media_type==='TEXT'&&calls[0].body.text==='스레드 글'&&calls[1].url.endsWith('/threads_publish')&&calls[1].body.creation_id==='tc-1','Threads text post: TEXT container then threads_publish: '+JSON.stringify(calls));
 check(th.threadsContainerBody({text:'a',imageUrl:'https://app.test/m.png'}).media_type==='IMAGE'&&th.threadsContainerBody({text:'a',imageUrl:'https://app.test/m.png'}).image_url==='https://app.test/m.png','Threads image post uses IMAGE with image_url');
 const l=await p.limit();check(l.total===250&&l.used===10&&l.remaining===240,'threads_publishing_limit parses 250/24h quota');
 const long=await p.prepare({text:'가'.repeat(501)});check(!long.ok&&long.issues.some(i=>/500자/.test(i)),'Threads text over 500 characters is rejected');
 const okp=await p.prepare({text:'가'.repeat(500)});check(okp.ok,'500 characters pass');
 // 게시 뒤 타임아웃도 같은 규율(unknown, 재전송 없음).
 const tfetch=async(url)=>{if(String(url).endsWith('/threads_publish'))throw timeoutError();return jsonResponse({id:'tc-2'})};
 const j=core.memoryContainerJournal();
 const u=await th.threadsPublisher({credential:t,journal:j,http:{fetch:tfetch},deps:fakeDeps().deps,policy}).submit({text:'x'},'tpub-2');
 check(u.outcome==='unknown'&&j.entries()[0].state==='unknown','Threads publish timeout is unknown and journaled');
}
// 8) 댓글 수집 해석·검증(/me).
{
 const fetch=async(url)=>String(url).includes('/comments')?jsonResponse({data:[{id:'c1',text:'좋아요',username:'u1',timestamp:'2026-11-09T00:00:00+0000',like_count:3},{id:'c2',text:''},{id:'c3',text:'가격?'}]}):String(url).includes('/me?')?jsonResponse({id:'17841400000000000',username:'oda_official'}):jsonResponse({});
 const p=ig.instagramPublisher({credential,journal:core.memoryContainerJournal(),http:{fetch},deps:fakeDeps().deps,policy});
 const comments=await p.collectComments('media-1');
 check(comments.length===2&&comments[0].id==='c1'&&comments[0].likeCount===3&&comments[1].username===null&&comments[1].likeCount===null,'comments are normalised and empty bodies dropped: '+JSON.stringify(comments));
 const v=await p.verify();check(v.account==='oda_official','verify reads /me username');
 const other=ig.instagramPublisher({credential:{...credential,userId:'1'},journal:core.memoryContainerJournal(),http:{fetch},deps:fakeDeps().deps,policy});
 let err='';try{await other.verify()}catch(e){err=e.message}
 check(/다릅니다/.test(err),'verify rejects a token that belongs to another account: '+err);
 const bad=ig.instagramPublisher({credential,journal:core.memoryContainerJournal(),http:{fetch:async()=>jsonResponse({error:{code:190,message:'Invalid OAuth access token'}},400)},deps:fakeDeps().deps,policy});
 err='';try{await bad.verify()}catch(e){err=e.message}
 check(/확인하지 못했습니다/.test(err)&&/code 190/.test(err),'verify reports an invalid token with the Graph error code: '+err);
}
// 9) 캡션 조합: AI 카피·가상인물 선언이면 표시 줄 두 개가 들어가고, 직접 게시 초안의 text는 저장 캡션과 바이트 단위로 같다.
{
 const caption=exec.composeCaption({text:'AI 카피 본문',aiGenerated:true,virtualPerson:true},'사실 문구',{type:'coupon',code:'AB12'});
 check(caption.includes(disclosure.AI_DISCLOSURE_LINE)&&caption.includes(disclosure.VIRTUAL_PERSON_LINE)&&caption.indexOf(disclosure.AI_DISCLOSURE_LINE)<caption.indexOf(disclosure.VIRTUAL_PERSON_LINE)&&caption.endsWith('쿠폰 코드 AB12를 알려 주세요.'),'caption carries AI disclosure, virtual person line and code line in order');
 const pubServer=await rt.load('lib/execution-publisher-server.ts');
 const draft=pubServer.directDraftFor({caption,mediaUrl:'https://app.test/media/abc.png'});
 check(draft.text===caption&&draft.imageUrl==='https://app.test/media/abc.png'&&draft.mediaType==='IMAGE','direct draft sends the stored caption verbatim with the public media url');
 check(exec.composeCaption({text:'사람 카피',aiGenerated:false},'사실')==='사람 카피\n\n사실','human copy has no disclosure line');
}
// 10) 레지스트리: 두 공급자 서술자(T3 게시·T1 읽기, 브랜드 단위, 스위치)와 규칙 위반 0.
{
 check(registry.describeViolations().length===0,'registry has no violations with the new publishers: '+registry.describeViolations().join(' | '));
 const pub=registry.capabilityFor('instagram_direct.media.publish'),tp=registry.capabilityFor('threads.post.publish');
 check(pub?.riskTier==='T3'&&pub.flag==='instagram_direct_publish'&&pub.credentialScope==='brand'&&pub.defaultOff===true&&pub.rateLimit.perDay===100,'instagram_direct publish is T3, brand scoped, default off, behind its flag');
 check(tp?.riskTier==='T3'&&tp.flag==='threads_publish'&&tp.rateLimit.perDay===250&&registry.capabilityFor('threads.replies.read')?.riskTier==='T1'&&registry.capabilityFor('instagram_direct.comments.read')?.riskTier==='T1','threads publish is T3 with 250/day and reads are T1');
}
// 11) 계약 하네스 5 시나리오를 두 공급자의 원시 HTTP 호출(media_publish / limit, threads_publish / limit)로 돈다. 스크립트 결과를 fetch 응답·예외로 바꿔 실제 분류 코드를 지난다.
{
 const scripted=(rawFor,writeOp)=>script=>{
  const calls={};let current='';
  const fetch=async()=>{const steps=script[current]??[{kind:'thrown'}],step=steps[Math.min(calls[current],steps.length)-1];
   if(step.kind==='response')return new Response(step.value===undefined?null:JSON.stringify(step.value),{status:step.status,headers:step.retryAfter?{'retry-after':step.retryAfter}:{}});
   if(step.kind==='timeout')throw timeoutError();
   if(step.kind==='network_error')throw step.sent?new TypeError('fetch failed'):refusedError();
   throw new Error('thrown')};
  const raw=rawFor(fetch);
  return {capabilities:registry.descriptorFor(writeOp.split('.')[0]).capabilities,calls:()=>({...calls}),async execute(op){calls[op.id]=(calls[op.id]??0)+1;current=op.id;const a=await (op.capability===writeOp?raw.publish('ctr-x'):raw.limit());return {...a,value:a.payload}}};
 };
 const igResults=await contract.runContractScenarios(scripted(f=>ig.instagramDirectRaw(credential,{fetch:f}),'instagram_direct.media.publish'),{read:'instagram_direct.limit.read',write:'instagram_direct.media.publish'});
 for(const r of igResults)check(r.passed,`instagram_direct contract ${r.scenario}: ${r.details.join(' | ')}`);
 const thResults=await contract.runContractScenarios(scripted(f=>th.threadsRaw({channel:'threads',accessToken:'t',userId:'900'},{fetch:f}),'threads.post.publish'),{read:'threads.limit.read',write:'threads.post.publish'});
 for(const r of thResults)check(r.passed,`threads contract ${r.scenario}: ${r.details.join(' | ')}`);
 check(igResults.length===5&&thResults.length===5,'both providers ran all five contract scenarios');
}

// ================= 2부: 서버(D1 모의) =================
const server=await rt.load('lib/server.ts'),channels=await rt.load('app/api/channels/route.ts'),execution=await rt.load('app/api/execution/route.ts'),flags=await rt.load('lib/feature-flags.ts'),pubServer=await rt.load('lib/execution-publisher-server.ts'),credentials=await rt.load('lib/channel-credentials.ts');
rt.env.BUCKET={put:async()=>{},get:async()=>null,head:async()=>null,delete:async()=>{}};
const owner='owner';await server.seedBrands(owner);
const H={'content-type':'application/json','oai-authenticated-user-id':owner,origin:'https://app.test'};
const post=async(route,body)=>{const r=await route.POST(new Request('https://app.test/api/x',{method:'POST',headers:H,body:JSON.stringify(body)}));return {status:r.status,data:await r.json()}};
const get=async(route,query)=>{const r=await route.GET(new Request('https://app.test/api/x'+query,{headers:H}));return {status:r.status,data:await r.json()}};
const rows=kind=>rt.sql.prepare("SELECT id,data FROM records WHERE owner=? AND kind=? ORDER BY id").all(owner,kind).map(r=>({...JSON.parse(r.data),rowId:r.id}));
const by={id:owner,email:null};

// 12) 연결 저장: /me 검증 뒤 channel_credential 행(브랜드 단위, 암호문, version 1). 잘못된 토큰·브랜드 없음·지점 단위는 저장하지 않는다.
{
 let r=await post(channels,{action:'connect_publisher',channel:'instagram_direct',brandId:'oda',data:{accessToken:'tok-bad',userId:'17841400000000000'}});
 check(r.status===400&&/확인하지 못했습니다/.test(r.data.error)&&rows('channel_credential').length===0,'an invalid token (Graph 190) is not saved: '+JSON.stringify(r.data));
 r=await post(channels,{action:'connect_publisher',channel:'instagram_direct',brandId:'ghost',data:{accessToken:'tok-1',userId:'17841400000000000'}});
 check(r.status===404,'an unknown brand is a 404 before any Graph call');
 r=await post(channels,{action:'connect_publisher',channel:'instagram_direct',data:{accessToken:'tok-1',userId:'17841400000000000'}});
 check(r.status===400&&/브랜드/.test(r.data.error),'a publisher credential requires a brand');
 r=await post(channels,{action:'connect_publisher',channel:'instagram_direct',brandId:'oda',data:{accessToken:'tok-1',userId:'17841400000000000',expiresAt:'2027-01-08T00:00:00Z',login:'facebook'}});
 check(r.status===200&&r.data.account==='oda_official'&&r.data.version===1&&r.data.channel==='instagram_direct'&&r.data.expiresAt==='2027-01-08T00:00:00.000Z'&&!JSON.stringify(r.data).includes('tok-1'),'connect saves after /me verification and never returns the token: '+JSON.stringify(r.data));
 const stored=rows('channel_credential');
 check(stored.length===1&&stored[0].rowId===`${owner}:channel_credential:instagram_direct:oda`&&!JSON.stringify(stored[0]).includes('tok-1')&&stored[0].userId==='17841400000000000'&&stored[0].version===1&&stored[0].login==='facebook','stored row is brand scoped, encrypted and keeps the login kind: '+stored[0].rowId);
 r=await post(channels,{action:'connect_publisher',channel:'instagram_direct',brandId:'oda',data:{accessToken:'tok-2',userId:'17841400000000000'}});
 check(r.status===200&&r.data.version===2,'reconnecting bumps the version');
 r=await post(channels,{action:'verify_publisher',channel:'instagram_direct',brandId:'oda'});
 check(r.status===200&&r.data.verifiedAccount==='oda_official'&&r.data.version===2&&graph.at(-1).auth==='Bearer tok-2','verify_publisher calls /me with the stored token: '+JSON.stringify(r.data));
 r=await post(channels,{action:'verify_publisher',channel:'threads',brandId:'oda'});
 check(r.status===409,'verify without a connection is a 409');
 r=await get(channels,'?brandId=oda');
 check(r.status===200&&Array.isArray(r.data.publishers)&&r.data.publishers.find(p=>p.channel==='instagram_direct').connected===true&&r.data.publishers.find(p=>p.channel==='threads').connected===false&&!JSON.stringify(r.data).includes('tok-2'),'GET with brandId lists publisher connections without secrets');
 check(r.data.channels.length===2&&r.data.byBrand.every(b=>b.channel!=='instagram_direct'),'legacy channel status is unchanged by publisher rows');
 const loaded=await credentials.loadPublisherCredential(owner,'instagram_direct','oda');
 check(loaded.credential.accessToken==='tok-2'&&loaded.credential.channel==='instagram_direct'&&loaded.credential.login===undefined&&loaded.meta.version===2,'load decrypts the stored credential (reconnect without login resets it)');
}
// 13) 스위치 꺼짐: 직접 연결이 있어도 발행 계정은 Buffer 경로(연결 없음=미연결, Buffer 연결=Buffer 채널).
const campaign=(id,extra={})=>({id,brandId:'oda',title:'ODA',version:1,status:'approved',startDate:'2098-01-01',endDate:'2098-12-31',budget:100000,budgetConfirmedAt:'2026-09-01T00:00:00.000Z',...extra});
const put=(kind,id,value,parent='')=>server.recordStatement(owner,kind,id,value,parent).run();
await put('brand_fact','fact',{id:'fact',brandId:'oda',key:'address',value:'휘경동 377 C107',status:'confirmed',source:'owner',verifiedAt:new Date().toISOString(),validUntil:'2099-01-01T00:00:00Z',version:1},'oda');
await put('campaign','c1',campaign('c1'));
{
 check(await pubServer.selectDirectPublisher(owner,'oda')===null,'with the flag off no direct publisher is selected');
 let s=await get(execution,'?campaignId=c1');
 check(s.status===200&&s.data.publisher.connected===false,'flag off and no Buffer: publisher disconnected (Buffer path unchanged)');
 const b=await post(execution,{action:'connect_buffer',campaignId:'c1',token:'buf',organizationId:'org',channelId:'channel-1'});
 check(b.status===200,'Buffer connects as before');
 s=await get(execution,'?campaignId=c1');
 check(s.data.publisher.channelId==='channel-1'&&s.data.publisher.account==='ODA','flag off with Buffer connected: Buffer account is the publisher');
}
// 14) 스위치 켜짐 + 연결: 발행 계정이 직접 게시 계정으로 바뀐다. 승인→실행이 Graph API 두 단계로 가고 published가 된다. 캡션·이미지 주소는 저장값 그대로다.
{
 await flags.setFeatureFlag(owner,{flag:'instagram_direct_publish',enabled:true},by);
 const sel=await pubServer.selectDirectPublisher(owner,'oda');
 check(sel?.kind==='instagram_direct'&&sel.credential.accessToken==='tok-2','flag on selects the Instagram direct credential');
 let s=await get(execution,'?campaignId=c1');
 check(s.data.publisher.connected===true&&s.data.publisher.channelId==='instagram_direct:17841400000000000'&&s.data.publisher.version===2&&/oda_official/.test(s.data.publisher.account),'execution state shows the direct account as publisher: '+JSON.stringify(s.data.publisher));
 await put('execution_rate','execution',{startedAt:Date.now(),count:0});
 const limits=await post(execution,{action:'save_limits',campaignId:'c1',maxPublications:2,maxPlannedCostKRW:1000});assert.equal(limits.status,200,JSON.stringify(limits.data));
 const creative=await post(execution,{action:'save_creative',campaignId:'c1',campaignVersion:1,factRefs:[{id:'fact',version:1}],png:dataUrl});assert.equal(creative.status,200,JSON.stringify(creative.data));
 const mediaUrl='https://res.cloudinary.com/oda/image/upload/'+creative.data.pngHash+'.png';
 const draft=await post(execution,{action:'save_publication',campaignId:'c1',creativeId:creative.data.id,mediaUrl,scheduledAt:new Date(Date.UTC(2098,0,1,0,0)).toISOString(),plannedCostKRW:100});assert.equal(draft.status,200,JSON.stringify(draft.data));
 const stale=await post(execution,{action:'approve',campaignId:'c1',id:draft.data.id,version:draft.data.version,confirmed:true,rightsConfirmed:true,immutableMediaConfirmed:true,channelId:'channel-1',credentialVersion:1,limitsVersion:limits.data.version});
 check(stale.status===409&&/발행 계정/.test(stale.data.error),'approving with the Buffer account shown on screen is refused once the direct account is in effect');
 const approved=await post(execution,{action:'approve',campaignId:'c1',id:draft.data.id,version:draft.data.version,confirmed:true,rightsConfirmed:true,immutableMediaConfirmed:true,channelId:'instagram_direct:17841400000000000',credentialVersion:2,limitsVersion:limits.data.version});
 check(approved.status===200&&approved.data.status==='approved'&&approved.data.channelId==='instagram_direct:17841400000000000','approval records the direct account: '+JSON.stringify(approved.data.error||approved.data.status));
 check(graph.filter(c=>c.u.endsWith('/media')&&c.method==='POST').length===0,'nothing is sent to Instagram at approval');
 const before=graph.length;
 const executed=await post(execution,{action:'execute',campaignId:'c1',id:draft.data.id,version:approved.data.version});
 const sent=graph.slice(before);
 check(executed.status===200&&executed.data.status==='published'&&executed.data.providerId==='media-1'&&executed.data.providerStatus==='published','execute publishes directly and lands on published: '+JSON.stringify({status:executed.data.status,error:executed.data.error}));
 const container=sent.find(c=>c.u.endsWith('/media')&&c.method==='POST'),publish=sent.find(c=>c.u.endsWith('/media_publish'));
 check(!!container&&container.body.caption===approved.data.caption&&container.body.image_url===mediaUrl&&container.auth==='Bearer tok-2','container carries the stored caption and the approved public image url (same marked-PNG hash)');
 check(!!publish&&publish.body.creation_id==='ctr-1','media_publish uses the container id');
 const limitAt=sent.findIndex(c=>c.u.includes('/content_publishing_limit'));
 check(limitAt>=0&&limitAt<sent.indexOf(container),'the publishing limit is read before the container is created');
 const journal=rows('publication_container');
 check(journal.length===1&&journal[0].state==='published'&&journal[0].containerId==='ctr-1'&&journal[0].publishedId==='media-1','the two-step journal row is stored per publication');
 const again=await post(execution,{action:'execute',campaignId:'c1',id:draft.data.id,version:executed.data.version});
 check(again.status===409&&graph.length===before+sent.length,'re-executing a published item is refused and sends nothing');
 // 15) 댓글 수집: publication_comment 행(추가만), 빈 본문 제외, 자동 답글 없음.
 const comments=await post(execution,{action:'collect_comments',campaignId:'c1',id:draft.data.id,version:executed.data.version});
 check(comments.status===200&&comments.data.collected===2,'comments are collected for the published direct post: '+JSON.stringify(comments.data));
 const stored=rows('publication_comment');
 check(stored.length===2&&stored[0].rowId===`${owner}:publication_comment:${draft.data.id}:cm-1`&&stored[0].id==='cm-1'&&stored[0].publicationId===draft.data.id&&stored[0].text==='맛있어 보여요'&&stored[0].postId==='media-1'&&stored[0].channel==='instagram_direct','comment rows are keyed by publication and comment id');
 await post(execution,{action:'collect_comments',campaignId:'c1',id:draft.data.id,version:executed.data.version});
 check(rows('publication_comment').length===2&&!graph.some(c=>c.method==='POST'&&c.u.includes('/comments')),'re-collecting is idempotent and never posts replies');
 await flags.setFeatureFlag(owner,{flag:'instagram_direct_publish',enabled:false},by);
 s=await get(execution,'?campaignId=c1');
 check(s.data.publisher.channelId==='channel-1','turning the flag off returns the publisher to the Buffer account');
}
// 16) Threads 경로: instagram_direct 연결이 없는 브랜드(ofd)에 threads 연결 + threads_publish 스위치 → Threads 계정이 발행 계정.
{
 const r=await post(channels,{action:'connect_publisher',channel:'threads',brandId:'ofd',data:{accessToken:'tok-th',userId:'900'}});
 check(r.status===200&&r.data.account==='oda_threads'&&threadsCalls.some(c=>c.u.includes('/me?')),'Threads connect verifies /me on graph.threads.net');
 await put('campaign','c2',campaign('c2',{brandId:'ofd'}));
 let s=await get(execution,'?campaignId=c2');
 check(s.data.publisher.connected===false,'Threads flag off: no publisher');
 await flags.setFeatureFlag(owner,{flag:'threads_publish',enabled:true},by);
 s=await get(execution,'?campaignId=c2');
 check(s.data.publisher.channelId==='threads:900'&&/Threads/.test(s.data.publisher.account),'Threads flag on selects the Threads account: '+JSON.stringify(s.data.publisher));
 const rv=await post(channels,{action:'revoke_publisher',channel:'threads',brandId:'ofd'});
 check(rv.status===200&&rv.data.revoked===true&&(await get(execution,'?campaignId=c2')).data.publisher.connected===false,'revoking the Threads connection removes the publisher');
}
// 17) 문서: 소유자 설정 문서가 앱 검수 권한·토큰 갱신·한도·자동으로 하지 않는 일을 적는다.
{
 const doc=readFileSync('docs/INSTAGRAM-DIRECT.ko.md','utf8');
 check(['instagram_business_content_publish','threads_content_publish','content_publishing_limit','instagram_direct_publish','threads_publish','unknown','재전송','자동으로 하지 않'].every(w=>doc.includes(w)),'docs/INSTAGRAM-DIRECT.ko.md covers scopes, limits, flags, unknown rule and the never-automatic list');
}

if(failures.length){console.error(failures.join('\n'));process.exit(1)}
console.log(JSON.stringify({passed:checks}));
