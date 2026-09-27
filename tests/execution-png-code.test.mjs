import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {deflateSync} from 'node:zlib';
import {readFileSync} from 'node:fs';
import {testRuntime} from './helpers/runtime.mjs';

// A4-4: 게시 코드를 넣은 파생 PNG. 승인된 원본 소재 PNG(pngHash)는 그대로 두고, 발행 초안에 코드 넣은 파생 PNG를 연결해 그 해시로 공개한다.
// 스위치 a4_png_code(기본 꺼짐). 실제 SQLite, Buffer·R2는 모의 응답이다.
function crc32(bytes){let crc=0xffffffff;for(const byte of bytes){crc^=byte;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0)}return (crc^0xffffffff)>>>0}
function chunk(type,data){const name=Buffer.from(type),size=Buffer.alloc(4),crc=Buffer.alloc(4);size.writeUInt32BE(data.length);crc.writeUInt32BE(crc32(Buffer.concat([name,data])));return Buffer.concat([size,name,data,crc])}
const signature=Buffer.from([137,80,78,71,13,10,26,10]);
function fixture(fill=0,width=1080,height=1080){const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(width,0);ihdr.writeUInt32BE(height,4);ihdr[8]=8;ihdr[9]=2;const pixels=Buffer.alloc((width*3+1)*height,fill);for(let row=0;row<height;row++)pixels[row*(width*3+1)]=0;return Buffer.concat([signature,chunk('IHDR',ihdr),chunk('IDAT',deflateSync(pixels)),chunk('IEND',Buffer.alloc(0))])}
const png=fixture(),coded=fixture(7),recoded=fixture(9),dataUrl=bytes=>'data:image/png;base64,'+bytes.toString('base64');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
let calls=0,lastUrl='';
const rt=testRuntime(async(url,init={})=>{
 if(String(url).startsWith('https://res.cloudinary.com/'))return new Response(png,{headers:{'content-type':'image/png'}});
 const {query,variables}=JSON.parse(init.body);
 if(query.includes('organizations'))return Response.json({data:{account:{organizations:[{id:'org',name:'ODA 조직'}]}}});
 if(query.includes('channels('))return Response.json({data:{channels:[{id:'channel-1',name:'ODA',service:'instagram',isQueuePaused:false}]}});
 if(query.includes('createPost')){calls++;lastUrl=variables.input.assets[0].image.url;return Response.json({data:{createPost:{__typename:'PostActionSuccess',post:{id:'post-'+calls,status:'scheduled'}}}})}
 return Response.json({data:{post:{id:variables.id,status:'scheduled',channelId:'channel-1'}}});
});
const objects=new Map();rt.env.BUCKET={put:async(k,v)=>objects.set(k,new Uint8Array(v)),get:async k=>objects.has(k)?{arrayBuffer:async()=>objects.get(k).slice().buffer,body:new Response(objects.get(k).slice()).body}:null,head:async k=>objects.has(k)?{size:objects.get(k).length}:null,delete:async k=>objects.delete(k)};
const server=await rt.load('lib/server.ts'),route=await rt.load('app/api/execution/route.ts'),asset=await rt.load('app/api/execution/asset/route.ts'),media=await rt.load('app/media/[file]/route.ts'),exec=await rt.load('lib/execution.ts'),render=await rt.load('lib/creative-render.ts'),flags=await rt.load('lib/feature-flags.ts');
const put=(kind,id,value,parent='')=>server.recordStatement('owner',kind,id,value,parent).run();
const rows=kind=>rt.sql.prepare("SELECT data FROM records WHERE owner='owner' AND kind=?").all(kind).map(r=>JSON.parse(r.data));
let checks=0;const failures=[];function check(value,label){checks++;if(!value)failures.push(label)}
async function post(action,campaignId,data={}){
 const response=await route.POST(new Request('https://app.test/api/execution',{method:'POST',headers:{'content-type':'application/json','oai-authenticated-user-id':'owner',origin:'https://app.test'},body:JSON.stringify({action,campaignId,...data})}));
 return {status:response.status,data:await response.json()};
}
const getState=async id=>(await route.GET(new Request('https://app.test/api/execution?campaignId='+id,{headers:{'oai-authenticated-user-id':'owner'}}))).json();
const fresh=()=>put('execution_rate','execution',{startedAt:Date.now(),count:0});
const setFlag=enabled=>flags.setFeatureFlag('owner',{flag:'a4_png_code',enabled},{id:'owner',email:null});
const at=offset=>new Date(Date.UTC(2098,0,1,0,offset)).toISOString(),cloud=c=>'https://res.cloudinary.com/oda/image/upload/'+c.pngHash+'.png';
const campaignFixture=(id,extra={})=>({id,brandId:'oda',title:'ODA',version:1,status:'approved',startDate:'2098-01-01',endDate:'2098-12-31',budget:100000,budgetConfirmedAt:'2026-09-01T00:00:00.000Z',...extra});
const served=async hash=>(await media.GET(new Request('https://app.test/media/'+hash+'.png'),{params:Promise.resolve({file:hash+'.png'})})).status;
const assetOf=async query=>asset.GET(new Request('https://app.test/api/execution/asset?'+query,{headers:{'oai-authenticated-user-id':'owner'}}));

await server.seedBrands('owner');
const fact={id:'fact',brandId:'oda',key:'address',value:'휘경동 377 C107',status:'confirmed',source:'owner',verifiedAt:new Date().toISOString(),validUntil:'2099-01-01T00:00:00Z',version:1};
await put('brand_fact','fact',fact,'oda');
await put('brand_fact','fact-hours',{...fact,id:'fact-hours',key:'hours',value:'매일 11시~21시'},'oda');
await put('brand_fact','fact-ofd',{...fact,id:'fact-ofd',brandId:'ofd',value:'성수동 1'},'ofd');
await put('store','s-oda',{id:'s-oda',brandId:'oda',name:'ODA 휘경점',status:'active',version:1},'oda');
await put('store','s-oda-2',{id:'s-oda-2',brandId:'oda',name:'ODA 성수점',status:'active',version:1},'oda');
await put('store','s-ofd',{id:'s-ofd',brandId:'ofd',name:'OFD 지점',status:'active',version:1},'ofd');
for(const brand of ['oda','ofd']){await put('campaign','conn-'+brand,campaignFixture('conn-'+brand,{brandId:brand}));assert.equal((await post('connect_buffer','conn-'+brand,{token:'test-token-not-a-secret',organizationId:'org',channelId:'channel-1'})).status,200,'fixture publisher')}
async function setup(id,extra={},factRefs=[{id:'fact',version:1}]){
 await fresh();await put('campaign',id,campaignFixture(id,extra));
 assert.equal((await post('save_limits',id,{maxPublications:5,maxPlannedCostKRW:0})).status,200,'fixture limits');
 const card=await post('save_creative',id,{campaignVersion:1,factRefs,png:dataUrl(png)});assert.equal(card.status,200,'fixture creative '+JSON.stringify(card.data));
 return card.data;
}
async function approve(id,p,extra={}){
 const brand=(await server.readRecord('owner','campaign',id)).brandId,credential=await server.readRecord('owner','publisher_credential',brand),limits=await server.readRecord('owner','execution_limits',id);
 return post('approve',id,{id:p.id,version:p.version,confirmed:true,rightsConfirmed:true,immutableMediaConfirmed:true,channelId:'channel-1',credentialVersion:credential.version,limitsVersion:limits.version,...extra});
}
const draft=(id,creative,offset,trackingCode,mediaUrl='')=>post('save_publication',id,{creativeId:creative.id,mediaUrl,scheduledAt:at(offset),plannedCostKRW:0,...(trackingCode?{trackingCode}:{})});
const register=(id,p,png,code=p.trackingCode?.code)=>post('register_coded_png',id,{id:p.id,version:p.version,code,png:dataUrl(png)});

// 1) 순수 함수: 이미지 코드 라벨, 공개에 쓰는 해시, 승인 차단·요청·드리프트, 라벨 자리.
check(exec.codeLabel?.({type:'coupon',code:'CABCD2345'})==='쿠폰 코드 CABCD2345'&&exec.codeLabel({type:'pos_tag',code:'PABCD2345'})==='주문 코드 PABCD2345','image code label wording');
check(exec.mediaHash?.({pngHash:'a'.repeat(64)})==='a'.repeat(64)&&exec.mediaHash({pngHash:'a'.repeat(64),codedPng:{hash:'b'.repeat(64)}})==='b'.repeat(64),'the public media hash is the coded PNG hash when there is one');
const pureState={creatives:[{id:'c',current:true}],limits:{id:'x',version:1,maxPublications:1,maxPlannedCostKRW:0,paused:false},publisher:{connected:true,channelId:'channel-1',version:1}};
const pureCampaign={status:'approved',startDate:'2098-01-01',endDate:'2098-12-31',budget:0,budgetConfirmedAt:'2026-09-01T00:00:00.000Z'};
const purePub={scheduledAt:at(0),creativeId:'c',plannedCostKRW:0};
const blockers=p=>exec.approvalBlockers({campaign:pureCampaign,publication:p,state:pureState,factCount:1,rightsConfirmed:true,...p.extra});
check(blockers(purePub).length===0,'fixture: a plain draft has no blockers');
check(blockers({...purePub,codedPng:{hash:'b'.repeat(64)}}).some(b=>b.startsWith('코드 PNG 확인 필요')),'a coded PNG draft is blocked until the coded image is checked');
check(blockers({...purePub,codedPng:{hash:'b'.repeat(64)},extra:{codedPngConfirmed:true}}).length===0,'the coded image check clears the blocker');
check(JSON.stringify(exec.codedPngApproval?.({},true))==='{}','the approval body without a coded PNG gets nothing extra');
check(JSON.stringify(exec.codedPngApproval?.({codedPng:{hash:'b'.repeat(64)}},true))==='{"codedPngConfirmed":true}'&&JSON.stringify(exec.codedPngApproval({codedPng:{hash:'b'.repeat(64)}},false))==='{"codedPngConfirmed":false}','the approval body carries the coded image check only for coded PNG drafts');
const approvedPure={status:'approved',channelId:'channel-1',credentialVersion:1,limitsVersion:1,approvedLimits:{maxPublications:1,maxPlannedCostKRW:0}};
check(exec.approvalDrift(approvedPure,pureState.publisher,pureState.limits).length===0&&exec.approvalDrift({...approvedPure,codedPng:{hash:'b'.repeat(64)}},pureState.publisher,pureState.limits).includes('코드 PNG 확인')&&!exec.approvalDrift({...approvedPure,codedPng:{hash:'b'.repeat(64)},codedPngConfirmedAt:'2026-09-27T00:00:00Z'},pureState.publisher,pureState.limits).length,'a coded PNG approval without the check record drifts');
const box=render.codeBadgeBox?.(300);
check(!!box&&box.y>=208&&box.y+box.height<=250&&box.x+box.width<=1080-72&&box.x>=72,'the code badge sits in the empty band between the brand name and the fact boxes '+JSON.stringify(box));
check(render.codeBadgeBox?.(2000)===null,'a label wider than the band is refused');

// 2) 스위치 꺼짐(기본): 상태 응답·발행·승인·공개 해시가 이전과 같고 파생 PNG 등록은 409다.
const off=await setup('off');
const offState=await getState('off');
check(!('pngCode' in offState),'the execution state has no pngCode key while the switch is off');
const offDraft=await draft('off',off,0,{type:'coupon',storeId:'s-oda'});
check(offDraft.status===200&&!('codedPng' in offDraft.data)&&offDraft.data.pngHash===off.pngHash,'a coded publication keeps the creative PNG hash');
const offRegister=await register('off',offDraft.data,coded);
check(offRegister.status===409&&offRegister.data.error.includes('a4_png_code'),'coded PNG registration is 409 while the switch is off');
check(!rows('execution_coded_png').length&&![...objects.keys()].some(k=>k.startsWith('execution/')&&objects.get(k).length===coded.length&&sha(Buffer.from(objects.get(k)))===sha(coded)),'nothing is stored while the switch is off');
const offApproved=await approve('off',offDraft.data);
check(offApproved.status===200&&offApproved.data.mediaUrl==='https://app.test/media/'+off.pngHash+'.png'&&!('codedPngConfirmedAt' in offApproved.data),'approval without a coded PNG publishes the original hash as before');

// 3) 스위치 켜짐: 파생 PNG 등록 → 발행 레코드에 파생 해시·코드·원본 해시 연결.
await setFlag(true);
check((await getState('off')).pngCode===true,'the execution state says the coded PNG feature is on');
const on=await setup('on');
const onDraft=await draft('on',on,1,{type:'coupon',storeId:'s-oda'});
assert.equal(onDraft.status,200,'fixture coded draft');
const reg=await register('on',onDraft.data,coded);
check(reg.status===200&&reg.data.codedPng?.hash===sha(coded)&&reg.data.codedPng.sourceHash===on.pngHash&&reg.data.codedPng.code===onDraft.data.trackingCode.code&&reg.data.codedPng.codeId===onDraft.data.trackingCode.id&&reg.data.codedPng.registeredBy==='owner','registration links the coded hash, the code and the original hash '+JSON.stringify(reg.data));
check(reg.data.pngHash===on.pngHash&&reg.data.caption===onDraft.data.caption&&reg.data.status==='draft'&&reg.data.version===onDraft.data.version+1&&reg.data.mediaUrl==='','the original PNG hash, caption and draft state stay; the version moves on');
const record=rows('execution_coded_png').find(r=>r.publicationId===onDraft.data.id);
check(!!record&&record.pngHash===sha(coded)&&record.sourceHash===on.pngHash&&record.campaignId==='on'&&record.creativeId===on.id&&!!record.objectKey&&sha(Buffer.from(objects.get(record.objectKey)||[]))===sha(coded),'the coded PNG is stored privately with its record');
check((await server.readRecord('owner','execution_creative',on.id)).pngHash===on.pngHash,'the creative record is untouched');
const codedAsset=await assetOf('codedPng='+encodeURIComponent(onDraft.data.id));
check(codedAsset.status===200&&sha(Buffer.from(await codedAsset.arrayBuffer()))===sha(coded)&&codedAsset.headers.get('cache-control')==='private, no-store','the private asset route returns the coded PNG');
check((await assetOf('codedPng=missing')).status===404,'an unknown coded PNG is 404');
check(await served(sha(coded))===404,'the coded PNG is not public before approval');

// 4) 실패 사례
const other=await draft('on',on,2,{type:'coupon',storeId:'s-oda-2'});
check((await register('on',reg.data,coded,other.data.trackingCode.code)).status===400,'a code of another store publication is 400');
const ofd=await setup('ofd',{brandId:'ofd'},[{id:'fact-ofd',version:1}]);
const ofdDraft=await draft('ofd',ofd,3,{type:'coupon',storeId:'s-ofd'});
assert.equal(ofdDraft.status,200,'fixture other brand draft');
check((await register('on',reg.data,recoded,ofdDraft.data.trackingCode.code)).status===400,'a code of another brand publication is 400');
check((await register('on',reg.data,recoded,'')).status===400,'a missing code is 400');
check((await register('on',reg.data,fixture(7,1080,1079))).status===400,'a coded PNG of another size is 400');
check((await register('on',reg.data,fixture(7,540,540))).status===400,'a smaller coded PNG is 400');
const same=await register('on',reg.data,png);
check(same.status===400&&same.data.error.includes('원본'),'the original bytes are not a coded PNG (400)');
check((await register('on',onDraft.data,recoded)).status===409,'a stale publication version is 409');
const plain=await draft('on',on,4);
check((await register('on',plain.data,coded,'CABCD2345')).status===409,'a publication without a publication code is 409');
const external=await draft('on',on,5,{type:'pos_tag',storeId:'s-oda'},cloud(on));
check(external.status===200&&(await register('on',external.data,coded)).status===409,'an external-host publication is 409');
const stale=await setup('stale',{},[{id:'fact-hours',version:1}]);
const staleDraft=await draft('stale',stale,6,{type:'coupon',storeId:'s-oda'});
await put('brand_fact','fact-hours',{...fact,id:'fact-hours',key:'hours',value:'매일 10시~21시',version:2},'oda');
const staleReg=await register('stale',staleDraft.data,coded);
check(staleReg.status===409&&!rows('execution_coded_png').some(r=>r.publicationId===staleDraft.data.id),'a creative whose facts are no longer confirmed is 409 and stores nothing');
check(rows('execution_coded_png').length===1,'failed registrations leave no coded PNG record');
check((await server.readRecord('owner','execution_publication',onDraft.data.id)).codedPng?.hash===sha(coded),'failed registrations leave the registered coded PNG');

// 5) 다시 등록하면 파생 PNG를 바꾸고 이전 비공개 파일을 지운다.
const again=await register('on',reg.data,recoded);
const replaced=rows('execution_coded_png').find(r=>r.publicationId===onDraft.data.id);
check(again.status===200&&again.data.codedPng.hash===sha(recoded)&&replaced.pngHash===sha(recoded)&&!objects.has(record.objectKey)&&objects.has(replaced.objectKey),'re-registration replaces the coded PNG and drops the previous private file');

// 6) 승인: 파생 확인 체크가 없으면 409, 있으면 파생 해시를 공개 주소로 제공한다.
const unchecked=await approve('on',again.data);
check(unchecked.status===409&&unchecked.data.error.includes('코드 PNG')&&(await server.readRecord('owner','execution_publication',onDraft.data.id)).status==='draft','approval without the coded image check is 409');
const approved=await approve('on',again.data,{codedPngConfirmed:true});
check(approved.status===200&&approved.data.mediaUrl==='https://app.test/media/'+sha(recoded)+'.png'&&approved.data.codedPngConfirmedBy==='owner'&&!!approved.data.codedPngConfirmedAt&&approved.data.pngHash===on.pngHash,'approval serves the coded PNG at its own hash '+JSON.stringify(approved.data));
check(await served(sha(recoded))===200&&sha(Buffer.from(objects.get('public/'+sha(recoded)+'.png')))===sha(recoded),'the public address serves the coded bytes');
check(!(await server.readRecord('owner','public_media',on.pngHash)).publicationIds.includes(approved.data.id)&&(await server.readRecord('owner','public_media',sha(recoded))).publicationIds.includes(approved.data.id),'the coded approval references the coded hash, not the original PNG');

// 7) 재확인은 확인 기록을 지우고 공개를 멈춘다. 파생 PNG 연결은 남아 다시 체크하고 승인한다.
const back=await post('reconfirm','on',{id:approved.data.id,version:approved.data.version});
check(back.status===200&&back.data.status==='draft'&&back.data.codedPng?.hash===sha(recoded)&&!('codedPngConfirmedAt' in back.data)&&!('codedPngConfirmedBy' in back.data)&&back.data.mediaUrl==='','reconfirm keeps the coded PNG and clears its check');
check(await served(sha(recoded))===404&&!objects.has('public/'+sha(recoded)+'.png'),'reconfirm stops serving the coded PNG and removes its public copy');
const reapproved=await approve('on',back.data,{codedPngConfirmed:true});
check(reapproved.status===200&&reapproved.data.mediaUrl.endsWith(sha(recoded)+'.png'),'the returned draft re-approves with the check');

// 8) 접수: Buffer는 파생 PNG 주소를 받는다.
const sent=await post('execute','on',{id:reapproved.data.id,version:reapproved.data.version});
check(sent.status===200&&sent.data.status==='accepted'&&lastUrl==='https://app.test/media/'+sha(recoded)+'.png','Buffer receives the coded PNG address');
check((await register('on',sent.data,coded)).status===409,'a submitted publication cannot change its coded PNG');

// 9) 스위치를 끄면 파생 PNG가 연결된 초안은 승인하지 않는다(취소하고 다시 준비). 연결 없는 발행은 영향이 없다.
const late=await draft('on',on,7,{type:'pos_tag',storeId:'s-oda-2'});
const lateReg=await register('on',late.data,coded);
assert.equal(lateReg.status,200,'fixture late coded PNG');
await setFlag(false);
const lateApprove=await approve('on',lateReg.data,{codedPngConfirmed:true});
check(lateApprove.status===409&&lateApprove.data.error.includes('a4_png_code'),'a coded PNG draft is not approved while the switch is off');
const plainApprove=await approve('on',plain.data);
check(plainApprove.status===200&&plainApprove.data.mediaUrl.endsWith(on.pngHash+'.png'),'a publication without a coded PNG approves while the switch is off');
const cancelled=await post('cancel','on',{id:lateReg.data.id,version:lateReg.data.version});
check(cancelled.status===200&&cancelled.data.status==='cancelled','the coded draft can still be cancelled');

// 10) 문서와 화면
const panel=readFileSync('app/execution-panel.tsx','utf8'),loop=readFileSync('docs/EXECUTION-LOOP.ko.md','utf8'),store=readFileSync('docs/STORE-MEASUREMENT.ko.md','utf8');
check(panel.includes("'register_coded_png'")&&panel.includes('codedPngApproval(p,!!codedChecks[p.id])')&&panel.includes('codedPngConfirmed:!!codedChecks[p.id]')&&panel.includes('코드 넣은 PNG 만들기')&&panel.includes('codedPng=')&&panel.includes('코드 PNG 확인'),'the panel offers the coded PNG button, preview and check');
check(loop.includes('## PNG 게시 코드 (A4-4)')&&loop.includes('a4_png_code')&&loop.includes('픽셀')&&store.includes('A4-4'),'the execution loop and store measurement docs describe A4-4');
console.log(JSON.stringify({passed:checks-failures.length,failed:failures.length,failures,providerCalls:calls,evidence:'real SQLite; mocked Buffer and R2; genuine PNG fixtures'}));
assert.deepEqual(failures,[]);
