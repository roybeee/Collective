import assert from 'node:assert/strict';
import {deflateSync} from 'node:zlib';
import {testRuntime} from './helpers/runtime.mjs';

function crc32(bytes){let crc=0xffffffff;for(const byte of bytes){crc^=byte;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0)}return (crc^0xffffffff)>>>0}
function chunk(type,data){const name=Buffer.from(type),size=Buffer.alloc(4),crc=Buffer.alloc(4);size.writeUInt32BE(data.length);crc.writeUInt32BE(crc32(Buffer.concat([name,data])));return Buffer.concat([size,name,data,crc])}
const signature=Buffer.from([137,80,78,71,13,10,26,10]),ihdr=Buffer.alloc(13);
ihdr.writeUInt32BE(1080,0);ihdr.writeUInt32BE(1080,4);ihdr[8]=8;ihdr[9]=2;
function fixture(fill=0){const pixels=Buffer.alloc((1080*3+1)*1080,fill);for(let row=0;row<1080;row++)pixels[row*(1080*3+1)]=0;return Buffer.concat([signature,chunk('IHDR',ihdr),chunk('IDAT',deflateSync(pixels)),chunk('IEND',Buffer.alloc(0))])}
const png=fixture(),dataUrl=bytes=>'data:image/png;base64,'+bytes.toString('base64');
let calls=0,mode='ok';const media=png,providerStatus='sent',inspectChannel='channel-1';
let server,beforeRun=null;
const rt=testRuntime(async(url,init={})=>{
 if(String(url).startsWith('https://res.cloudinary.com/'))return new Response(media,{headers:{'content-type':'image/png'}});
 if(String(url).startsWith('https://app.test/')){return new Response('not found',{status:404})}
 const {query,variables}=JSON.parse(init.body);
 if(query.includes('organizations'))return Response.json({data:{account:{organizations:[{id:'org',name:'ODA 조직'},{id:'org-2',name:'두 번째 조직'}]}}});
 if(query.includes('channels('))return Response.json({data:{channels:variables.organizationId==='org-2'?[{id:'channel-2',name:'ODA 2',service:'instagram',isQueuePaused:false}]:[{id:'channel-1',name:'ODA',service:'instagram',isQueuePaused:false},{id:'fb-1',name:'ODA FB',service:'facebook',isQueuePaused:false}]}});
 if(query.includes('createPost')){
  calls++;
  if(mode==='stop-in-flight')await server.recordStatement('owner','growth_stop','global',{id:'global',version:1,status:'stopped',reason:'진행 중 중단',updatedAt:new Date().toISOString(),updatedBy:'owner'}).run();
  return Response.json({data:{createPost:{__typename:'PostActionSuccess',post:{id:'post-'+calls,status:'scheduled'}}}});
 }
 return Response.json({data:{post:{id:variables.id,status:providerStatus,channelId:inspectChannel}}});
},{beforeRun:statement=>beforeRun?.(statement)});
const objects=new Map();rt.env.BUCKET={put:async(k,v)=>objects.set(k,new Uint8Array(v)),get:async k=>objects.has(k)?{arrayBuffer:async()=>objects.get(k).slice().buffer,body:new Response(objects.get(k).slice()).body}:null,head:async k=>objects.has(k)?{size:objects.get(k).length}:null,delete:async k=>objects.delete(k)};
server=await rt.load('lib/server.ts');
const route=await rt.load('app/api/execution/route.ts');
const put=(kind,id,value,parent='')=>server.recordStatement('owner',kind,id,value,parent).run();
const rows=kind=>rt.sql.prepare("SELECT data FROM records WHERE owner='owner' AND kind=?").all(kind).map(r=>JSON.parse(r.data));
const fresh=()=>put('execution_rate','execution',{startedAt:Date.now(),count:0});
await server.seedBrands('owner');
const fact={id:'fact',brandId:'oda',key:'address',value:'휘경동 377 C107',status:'confirmed',source:'owner',verifiedAt:new Date().toISOString(),validUntil:'2099-01-01T00:00:00Z',version:1};
await put('brand_fact','fact',fact,'oda');
// 발행 승인에는 기획 승인과 확정된 캠페인 기간이 필요하다. 모든 예약(2098-01-01 KST)이 기간 안에 들어가게 둔다.
// 비용 상한은 확정 예산 안에서만 정할 수 있으므로(data-truth-4 a) 기본 픽스처는 10만 원 확정 예산을 둔다.
const campaignFixture=(id,extra={})=>({id,brandId:'oda',title:'ODA',version:1,status:'approved',startDate:'2098-01-01',endDate:'2098-12-31',budget:100000,budgetConfirmedAt:'2026-09-01T00:00:00.000Z',...extra});
async function post(action,campaignId,data={},owner='owner',origin='https://app.test'){
 const response=await route.POST(new Request('https://app.test/api/execution',{method:'POST',headers:{'content-type':'application/json','oai-authenticated-user-id':owner,origin},body:JSON.stringify({action,campaignId,...data})}));
 return {status:response.status,data:await response.json()};
}
const getState=async id=>(await route.GET(new Request('https://app.test/api/execution?campaignId='+id,{headers:{'oai-authenticated-user-id':'owner'}}))).json();
let checks=0;const failures=[];function check(value,label){checks++;if(!value)failures.push(label)}
async function setup(id,maxPublications=1,maxPlannedCostKRW=1000,extra={},bytes=png){
 // Each independent scenario starts a fresh rate window; the boundary is tested separately below.
 await fresh();
 await put('campaign',id,campaignFixture(id,extra));
 const limits=await post('save_limits',id,{maxPublications,maxPlannedCostKRW});assert.equal(limits.status,200,'fixture limits');
 const card=await post('save_creative',id,{campaignVersion:1,factRefs:[{id:'fact',version:1}],png:dataUrl(bytes)});assert.equal(card.status,200,'real PNG fixture stored: '+JSON.stringify(card.data));
 return {id,creative:card.data,limits:limits.data};
}
const cloud=s=>'https://res.cloudinary.com/oda/image/upload/'+s.creative.pngHash+'.png',at=offset=>new Date(Date.UTC(2098,0,1,0,offset)).toISOString();
async function draft(s,offset=0,cost=100){
 const r=await post('save_publication',s.id,{creativeId:s.creative.id,mediaUrl:cloud(s),scheduledAt:at(offset),plannedCostKRW:cost});
 assert.equal(r.status,200,'fixture draft '+JSON.stringify(r.data));return r.data;
}
async function approve(s,p,extra={}){
 const credential=await server.readRecord('owner','publisher_credential','oda');
 const limits=await server.readRecord('owner','execution_limits',s.id).catch(()=>null);
 return post('approve',s.id,{id:p.id,version:p.version,confirmed:true,rightsConfirmed:true,immutableMediaConfirmed:true,channelId:'channel-1',credentialVersion:credential.version,limitsVersion:limits?.version,...extra});
}
check((await post('connect_buffer','missing',{token:'test-token-not-a-secret',organizationId:'org',channelId:'channel-1'})).status===404,'campaign required');
await put('campaign','connection',{id:'connection',brandId:'oda',version:1});
const channelList=await post('buffer_channels','connection',{token:'test-token-not-a-secret'});
check(channelList.status===200&&channelList.data.organizations?.length===2&&channelList.data.organizationId==='org'&&JSON.stringify(channelList.data.channels?.map(c=>c.id))==='["channel-1"]','API key loads organizations and Instagram channels only');
check((await post('buffer_channels','connection',{token:'test-token-not-a-secret',organizationId:'org-2'})).data.channels?.[0]?.id==='channel-2','organization choice reloads its channels');
check((await post('buffer_channels','connection',{token:'test-token-not-a-secret',organizationId:'unknown-org'})).status===400,'unknown organization rejected');
check(!JSON.stringify(rows('publisher_credential')).includes('channel'),'channel listing stores nothing');
check((await post('connect_buffer','connection',{token:'test-token-not-a-secret',organizationId:'org',channelId:'channel-1'})).status===200,'verified publisher');
check((await post('connect_buffer','connection',{token:'test-token-not-a-secret',organizationId:'org',channelId:'channel-1'})).status===409,'reconnect without displayed credential version rejected (CAS)');
check((await post('connect_buffer','connection',{token:'test-token-not-a-secret',organizationId:'org',channelId:'channel-1',version:1})).data.version===2,'reconnect with current credential version succeeds');

const blocked=await setup('stop-before-send'),drafted=await draft(blocked),approved=(await approve(blocked,drafted)).data;
beforeRun=statement=>{if(statement.query.startsWith('DELETE FROM mutation_locks')&&rows('execution_publication').some(p=>p.id===approved.id&&p.status==='submitting')){beforeRun=null;rt.sql.prepare('INSERT INTO records(id,owner,kind,parent_id,data,updated_at) VALUES(?,?,?,?,?,?)').run('owner:growth_stop:global','owner','growth_stop','',JSON.stringify({id:'global',version:1,status:'stopped',reason:'전송 전 중단',updatedAt:new Date().toISOString(),updatedBy:'owner'}),new Date().toISOString())}};
let result=await post('execute',blocked.id,{id:approved.id,version:approved.version});assert.equal(result.status,200);assert.equal(result.data.status,'failed');assert.equal(calls,0);assert.match(result.data.error,/보내지 않았습니다/);
rt.sql.prepare("DELETE FROM records WHERE kind='growth_stop'").run();
const inflight=await setup('stop-in-flight'),drafted2=await draft(inflight),approved2=(await approve(inflight,drafted2)).data;mode='stop-in-flight';result=await post('execute',inflight.id,{id:approved2.id,version:approved2.version});assert.equal(result.status,200);assert.equal(result.data.status,'accepted');assert.equal(calls,1);assert.equal(rows('growth_stop')[0].status,'stopped');
assert.equal((await post('execute',blocked.id,{id:approved.id,version:result.data.version})).status,409);assert.equal(calls,1);
assert.deepEqual(failures,[]);console.log(JSON.stringify({passed:checks+9,provider:'mocked Buffer',external:0}));
