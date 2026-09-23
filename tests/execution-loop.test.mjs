import assert from 'node:assert/strict';
import {deflateSync} from 'node:zlib';
import {testRuntime} from './helpers/runtime.mjs';

function crc32(bytes){let crc=0xffffffff;for(const byte of bytes){crc^=byte;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0)}return (crc^0xffffffff)>>>0}
function chunk(type,data){const name=Buffer.from(type),size=Buffer.alloc(4),crc=Buffer.alloc(4);size.writeUInt32BE(data.length);crc.writeUInt32BE(crc32(Buffer.concat([name,data])));return Buffer.concat([size,name,data,crc])}
const signature=Buffer.from([137,80,78,71,13,10,26,10]),ihdr=Buffer.alloc(13);
ihdr.writeUInt32BE(1080,0);ihdr.writeUInt32BE(1080,4);ihdr[8]=8;ihdr[9]=2;
function fixture(fill=0){const pixels=Buffer.alloc((1080*3+1)*1080,fill);for(let row=0;row<1080;row++)pixels[row*(1080*3+1)]=0;return Buffer.concat([signature,chunk('IHDR',ihdr),chunk('IDAT',deflateSync(pixels)),chunk('IEND',Buffer.alloc(0))])}
const png=fixture(),differentPng=fixture(255),dataUrl=bytes=>'data:image/png;base64,'+bytes.toString('base64');
let calls=0,mode='ok',media=png,providerStatus='sent',foreignLock='';
let server;
const rt=testRuntime(async(url,init={})=>{
 if(String(url).startsWith('https://res.cloudinary.com/'))return new Response(media,{headers:{'content-type':'image/png'}});
 const {query,variables}=JSON.parse(init.body);
 if(query.includes('channels('))return Response.json({data:{channels:[{id:'channel-1',name:'ODA',service:'instagram',isQueuePaused:false}]}});
 if(query.includes('createPost')){
  calls++;
  if(mode==='lost')throw new Error('network timeout after submission');
  if(mode==='lock')foreignLock=await server.acquireLock('owner');
  return Response.json({data:{createPost:{__typename:'PostActionSuccess',post:{id:'post-'+calls,status:mode==='draft'?'needs_approval':'scheduled'}}}});
 }
 return Response.json({data:{post:{id:variables.id,status:providerStatus,channelId:'channel-1'}}});
});
const objects=new Map();rt.env.BUCKET={put:async(k,v)=>objects.set(k,new Uint8Array(v)),get:async k=>objects.has(k)?{arrayBuffer:async()=>objects.get(k).buffer}:null};
server=await rt.load('lib/server.ts');
const route=await rt.load('app/api/execution/route.ts'),actionRoute=await rt.load('app/api/action/route.ts');
const put=(kind,id,value,parent='')=>server.recordStatement('owner',kind,id,value,parent).run();
await server.seedBrands('owner');
const fact={id:'fact',brandId:'oda',key:'address',value:'휘경동 377 C107',status:'confirmed',source:'owner',verifiedAt:new Date().toISOString(),validUntil:'2099-01-01T00:00:00Z',version:1};
await put('brand_fact','fact',fact,'oda');
async function post(action,campaignId,data={},owner='owner',origin='https://app.test'){
 const response=await route.POST(new Request('https://app.test/api/execution',{method:'POST',headers:{'content-type':'application/json','oai-authenticated-user-id':owner,origin},body:JSON.stringify({action,campaignId,...data})}));
 return {status:response.status,data:await response.json()};
}
let checks=0;const failures=[];function check(value,label){checks++;if(!value)failures.push(label)}
async function setup(id,maxPublications=1,maxPlannedCostKRW=1000){
 // Each independent scenario starts a fresh rate window; the boundary is tested separately below.
 await put('execution_rate','execution',{startedAt:Date.now(),count:0});
 await put('campaign',id,{id,brandId:'oda',title:'ODA',version:1});
 const limits=await post('save_limits',id,{maxPublications,maxPlannedCostKRW});assert.equal(limits.status,200,'fixture limits');
 const card=await post('save_creative',id,{campaignVersion:1,factRefs:[{id:'fact',version:1}],png:dataUrl(png)});assert.equal(card.status,200,'real PNG fixture stored: '+JSON.stringify(card.data));
 return {id,creative:card.data,limits:limits.data};
}
async function draft(s,offset=0,cost=100){
 const r=await post('save_publication',s.id,{creativeId:s.creative.id,mediaUrl:'https://res.cloudinary.com/oda/image/upload/'+s.creative.pngHash+'.png',scheduledAt:new Date(Date.UTC(2098,0,1,0,offset)).toISOString(),plannedCostKRW:cost});
 assert.equal(r.status,200,'fixture draft '+JSON.stringify(r.data));return r.data;
}
async function approve(s,p,extra={}){
 const credential=await server.readRecord('owner','publisher_credential','oda');
 const limits=await server.readRecord('owner','execution_limits',s.id);
 return post('approve',s.id,{id:p.id,version:p.version,confirmed:true,rightsConfirmed:true,immutableMediaConfirmed:true,channelId:'channel-1',credentialVersion:credential.version,limitsVersion:limits.version,...extra});
}
check((await post('connect_buffer','missing',{token:'test-token-not-a-secret',organizationId:'org',channelId:'channel-1'})).status===404,'campaign required');
await put('campaign','connection',{id:'connection',brandId:'oda',version:1});
check((await post('connect_buffer','connection',{token:'test-token-not-a-secret',organizationId:'org',channelId:'channel-1'})).status===200,'verified publisher');
const s=await setup('happy');
check(objects.size===1,'real PNG stored in mocked R2');
check((await post('save_limits',s.id,{version:1,maxPublications:-1,maxPlannedCostKRW:1000})).status===400,'negative limits rejected');
check((await post('save_limits',s.id,{maxPublications:1,maxPlannedCostKRW:1000},'stranger')).status===404,'owner isolated');
check((await post('save_limits',s.id,{maxPublications:1,maxPlannedCostKRW:1000},'owner','https://evil.test')).status===403,'CSRF rejected');
const badCrc=Buffer.from(png);badCrc[badCrc.length-1]^=1;
check((await post('save_creative',s.id,{campaignVersion:1,factRefs:[{id:'fact',version:1}],png:dataUrl(badCrc)})).status===400,'bad PNG CRC rejected');
check((await post('save_creative',s.id,{campaignVersion:1,factRefs:[{id:'fact',version:1}],png:dataUrl(Buffer.concat([signature,chunk('IHDR',ihdr),chunk('IEND',Buffer.alloc(0))]))})).status===400,'missing IDAT rejected');
check((await post('save_creative',s.id,{campaignVersion:1,factRefs:[{id:'fact',version:1}],png:dataUrl(png.subarray(0,png.length-12))})).status===400,'missing IEND rejected');
check((await post('save_publication',s.id,{creativeId:s.creative.id,mediaUrl:'https://example.com/a.png',scheduledAt:'2098-01-01T00:00:00Z',plannedCostKRW:100})).status===400,'untrusted media origin rejected');
check((await post('save_publication',s.id,{creativeId:s.creative.id,mediaUrl:'https://res.cloudinary.com/oda/image/upload/'+s.creative.pngHash+'.png',scheduledAt:fact.validUntil,plannedCostKRW:100})).status===409,'fact expiry equality rejected for schedule');
const p=await draft(s);
check((await post('save_publication',s.id,{creativeId:s.creative.id,mediaUrl:p.mediaUrl,scheduledAt:p.scheduledAt,plannedCostKRW:100})).status===409,'same creative schedule draft duplicate rejected');
check((await approve(s,p,{rightsConfirmed:false})).status===400,'rights explicitly required');
check((await approve(s,p,{immutableMediaConfirmed:false})).status===400,'immutable public media commitment required');
check((await approve(s,p,{channelId:'different-channel'})).status===409,'displayed account mismatch rejected');
check((await approve(s,p,{credentialVersion:0})).status===409,'old displayed credential version rejected');
check((await approve(s,p,{limitsVersion:0})).status===409,'old displayed limits version rejected');
check(calls===0,'displayed approval conflicts never invoke publisher');
media=differentPng;
check((await approve(s,p)).status===409,'raw media hash mismatch rejected');
media=png;
check(calls===0,'no publish call before approval');
const approved=await approve(s,p);check(approved.status===200&&approved.data.status==='approved','approve happy flow');
media=differentPng;
check((await post('execute',s.id,{id:p.id,version:approved.data.version})).status===409,'execute rechecks external media hash after approval');
check(calls===0,'changed public media never reaches publisher');
media=png;
const sent=await post('execute',s.id,{id:p.id,version:approved.data.version});
check(sent.status===200&&sent.data.status==='accepted'&&!!sent.data.providerId,'execute happy flow');
check(calls===1,'exactly one provider submit');
const refreshed=await post('refresh',s.id,{id:p.id,version:sent.data.version});
check(refreshed.status===200&&refreshed.data.status==='published','refresh sent confirms published');
const p2=await draft(s,1);const a2=await approve(s,p2);
check((await post('execute',s.id,{id:p2.id,version:a2.data.version})).status===409,'one attempt quota enforced');
check(calls===1,'quota does not call provider');
const budget=await setup('budget',2,50),bp=await draft(budget,0,100),ba=await approve(budget,bp);
check((await post('execute',budget.id,{id:bp.id,version:ba.data.version})).status===409,'budget cap enforced');
const stale=await setup('stale'),sp=await draft(stale),sa=await approve(stale,sp);
await put('brand_fact','fact',{...fact,version:2},'oda');
check((await post('execute',stale.id,{id:sp.id,version:sa.data.version})).status===409,'changed facts block');
await put('brand_fact','fact',fact,'oda');
await post('save_limits',stale.id,{version:1,maxPublications:2,maxPlannedCostKRW:1000});
check((await post('execute',stale.id,{id:sp.id,version:sa.data.version})).status===409,'changed limits block');
const loss=await setup('lost'),lp=await draft(loss),la=await approve(loss,lp);mode='lost';
const beforeLost=calls,lr=await post('execute',loss.id,{id:lp.id,version:la.data.version});mode='ok';
check(lr.status===200&&lr.data.status==='uncertain','timeout becomes uncertain');
check(calls===beforeLost+1,'uncertain attempted only once');
check((await post('execute',loss.id,{id:lp.id,version:lr.data.version})).status===409,'uncertain no retransmission');
check((await post('refresh',loss.id,{id:lp.id,version:lr.data.version})).status===409,'uncertain without provider ID cannot claim refresh');
check(calls===beforeLost+1,'uncertain retry makes no external call');
const locked=await setup('locked'),kp=await draft(locked),ka=await approve(locked,kp);mode='lock';
const kr=await post('execute',locked.id,{id:kp.id,version:ka.data.version});mode='ok';
check(kr.status===200&&kr.data.providerId&&kr.data.status==='accepted','provider acknowledgement CAS survives another owner mutation lock');
await server.releaseLock('owner',foreignLock);
const persisted=await server.readRecord('owner','execution_publication',kp.id);
check(!!persisted.providerId&&persisted.status==='accepted','provider ID durably stored despite lock contention');
const blocked=await setup('blocked'),dp=await draft(blocked),da=await approve(blocked,dp);mode='draft';
const dr=await post('execute',blocked.id,{id:dp.id,version:da.data.version});mode='ok';
check(dr.status===200&&dr.data.status==='blocked'&&!!dr.data.providerId,'provider needs approval is blocked not scheduled');
providerStatus='needs_approval';
const br=await post('refresh',blocked.id,{id:dp.id,version:dr.data.version});providerStatus='sent';
check(br.status===200&&br.data.status==='blocked','refresh draft needs approval remains blocked');
const audit=await setup('audit');
const deletion=await actionRoute.POST(new Request('https://app.test/api/action',{method:'POST',headers:{'content-type':'application/json','oai-authenticated-user-id':'owner',origin:'https://app.test'},body:JSON.stringify({action:'delete_campaign',id:audit.id,version:1,confirmed:true})}));
check(deletion.status===409,'campaign with creative execution records cannot be deleted');
const get=await route.GET(new Request('https://app.test/api/execution?campaignId=happy',{headers:{'oai-authenticated-user-id':'owner'}})),state=await get.json();
const foreignGet=await route.GET(new Request('https://app.test/api/execution?campaignId=happy',{headers:{'oai-authenticated-user-id':'stranger'}}));
check(foreignGet.status===404,'other owner cannot read execution history');
check(!JSON.stringify(state).includes('test-token-not-a-secret'),'secret never returned');
check(state.publications.length>=2,'state preserves execution history');
check(state.creatives.every(c=>!c.objectKey),'internal R2 object keys hidden');
await put('execution_rate','execution',{startedAt:Date.now(),count:59});
const boundaryInput={version:1,maxPublications:1,maxPlannedCostKRW:1000};
check((await post('save_limits',audit.id,boundaryInput)).status===200,'60th execution request allowed');
check((await server.readRecord('owner','execution_rate','execution')).count===60,'rate boundary records 60 requests');
const callsBeforeRate=calls;
check((await post('save_limits',audit.id,{...boundaryInput,version:2})).status===429,'61st execution request rejected');
check(calls===callsBeforeRate,'rate limit performs no provider mutation');
console.log(JSON.stringify({passed:checks-failures.length,failed:failures.length,failures,providerCalls:calls,evidence:'real SQLite; mocked Buffer, media HTTP and R2; genuine PNG fixture'}));
assert.deepEqual(failures,[]);
