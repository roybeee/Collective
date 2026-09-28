// loop-2: 발행을 바이럴 실험의 한 안(arm)과 잇고, 게시된 Instagram 게시물 ID로 loop-1 자동 수집 대상을 등록한다.
// - 준비 때(save_publication experiment)·준비 뒤(link_experiment, 관리자) 연결, 다른 캠페인·채널 400, 진행 중 아님 409, 같은 안 중복 409, 모르는 안 400.
// - 게시물 ID 입력(link_media, 관리자): 게시 확인 전 409, 형식 오류 400, 다른 발행이 쓴 ID 409. 스위치가 꺼지면 수집 대상을 만들지 않는다.
// - 스위치 publication_auto_link: 꺼지면 워커 tick이 Buffer를 0회 부르고, 켜지면 예약 접수 발행을 확인해 게시 확인으로 바꾸고(30분 간격) 수집 대상을 한 번만 등록한다.
// - 등록된 대상은 loop-1 워커 수집(collectDueMeasurements)이 Instagram 게시물 ID로 가져온다.
// 근거: mocked(메모리 SQLite, Buffer GraphQL·Instagram Graph fetch 스텁, R2 대역, 주입한 시계, 로컬 인증 헤더·이메일 세션). 외부 네트워크 호출 0회.
import assert from 'node:assert/strict';
import {deflateSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {moduleRuntime} from '../scripts/eval/runtime.mjs';
import {testRuntime} from './helpers/runtime.mjs';

function crc32(bytes){let crc=0xffffffff;for(const byte of bytes){crc^=byte;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0)}return (crc^0xffffffff)>>>0}
function chunk(type,data){const name=Buffer.from(type),size=Buffer.alloc(4),crc=Buffer.alloc(4);size.writeUInt32BE(data.length);crc.writeUInt32BE(crc32(Buffer.concat([name,data])));return Buffer.concat([size,name,data,crc])}
const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(1080,0);ihdr.writeUInt32BE(1080,4);ihdr[8]=8;ihdr[9]=2;
function fixture(fill){const pixels=Buffer.alloc((1080*3+1)*1080,fill);for(let row=0;row<1080;row++)pixels[row*(1080*3+1)]=0;return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),chunk('IDAT',deflateSync(pixels)),chunk('IEND',Buffer.alloc(0))])}
const dataUrl=bytes=>'data:image/png;base64,'+bytes.toString('base64');

let now=Date.parse('2026-09-20T03:00:00.000Z');
class Clock extends Date{constructor(...a){super(...(a.length?a:[now]))}static now(){return now}}
const MIN=60000;
let bufferStatus='scheduled',posts=0;const inspects=[],graph=[];
const fakeFetch=async(url,init={})=>{
 if(String(url).startsWith('https://graph.facebook.com/')){
  graph.push(url);
  if(url.includes('/insights'))return Response.json({data:[{name:'reach',values:[{value:900}]},{name:'shares',values:[{value:45}]}]});
  if(url.includes('fields=username'))return Response.json({username:'oda-account'});
  return Response.json({timestamp:'2026-09-20T03:10:00+0000',media_type:'IMAGE'});
 }
 if(url!=='https://api.buffer.com')throw new Error('Unexpected destination: '+url);
 const {query,variables}=JSON.parse(init.body);
 if(query.includes('organizations'))return Response.json({data:{account:{organizations:[{id:'org',name:'ODA 조직'}]}}});
 if(query.includes('channels('))return Response.json({data:{channels:[{id:'channel-1',name:'ODA',service:'instagram',isQueuePaused:false}]}});
 if(query.includes('createPost')){posts++;return Response.json({data:{createPost:{__typename:'PostActionSuccess',post:{id:'post-'+posts,status:'scheduled'}}}})}
 inspects.push(variables.id);
 return Response.json({data:{post:{id:variables.id,status:bufferStatus,channelId:'channel-1'}}});
};
const rt=moduleRuntime(fakeFetch,{},{Date:Clock});
const objects=new Map();rt.env.BUCKET={put:async(k,v)=>objects.set(k,new Uint8Array(v)),get:async k=>objects.has(k)?{arrayBuffer:async()=>objects.get(k).slice().buffer,body:new Response(objects.get(k).slice()).body}:null,head:async k=>objects.has(k)?{size:objects.get(k).length}:null,delete:async k=>objects.delete(k)};
const server=await rt.load('lib/server.ts'),route=await rt.load('app/api/execution/route.ts'),channels=await rt.load('app/api/channels/route.ts');
const background=await rt.load('lib/background-execution.ts'),collector=await rt.load('lib/measurement-collection.ts'),flags=await rt.load('lib/feature-flags.ts'),links=await rt.load('lib/publication-link-server.ts');
const O='owner';
const put=(kind,id,value,parent='')=>server.recordStatement(O,kind,id,value,parent).run();
const rows=kind=>rt.sql.prepare('SELECT data FROM records WHERE owner=? AND kind=?').all(O,kind).map(r=>JSON.parse(r.data));
const checks=[];const check=(label,v)=>{assert.ok(v,label);checks.push(label)};
const fresh=()=>put('execution_rate','execution',{startedAt:Date.now(),count:0});
async function post(action,campaignId,data={}){
 await fresh();
 const response=await route.POST(new Request('https://app.test/api/execution',{method:'POST',headers:{'content-type':'application/json','oai-authenticated-user-id':O,origin:'https://app.test'},body:JSON.stringify({action,campaignId,...data})}));
 return {status:response.status,data:await response.json()};
}
const publication=id=>server.readRecord(O,'execution_publication',id);
const tick=()=>background.advanceBackgroundWork(O);
const setAutoLink=enabled=>flags.setFeatureFlag(O,{flag:'publication_auto_link',enabled},{id:O,email:null});
const campaign=(id,extra={})=>put('campaign',id,{id,brandId:'oda',title:id,version:1,status:'approved',startDate:'2026-01-01',endDate:'2026-12-31',budget:0,budgetConfirmedAt:'2026-09-01T00:00:00.000Z',...extra});
const experiment=(id,extra={})=>put('viral_experiment',id,{id,brandId:'oda',campaignId:'c1',title:'실험 '+id,channel:'Instagram',metric:'share_rate',status:'running',version:1,...extra},extra.campaignId??'c1');
const soon=minutes=>new Date(now+minutes*MIN).toISOString();

await server.seedBrands(O);
await put('brand_fact','fact',{id:'fact',brandId:'oda',key:'address',value:'휘경동 377 C107',status:'confirmed',source:'owner',verifiedAt:new Date(now).toISOString(),validUntil:'2099-01-01T00:00:00Z',version:1},'oda');
await campaign('c1');await campaign('c2');
assert.equal((await post('connect_buffer','c1',{token:'fixture-token',organizationId:'org',channelId:'channel-1'})).status,200);
assert.equal((await post('save_limits','c1',{maxPublications:5,maxPlannedCostKRW:0})).status,200);
const creatives=[];for(const fill of [1,2,3])creatives.push((await post('save_creative','c1',{campaignVersion:1,factRefs:[{id:'fact',version:1}],png:dataUrl(fixture(fill))})).data);
await experiment('e1');await experiment('e-draft',{status:'draft'});await experiment('e-other',{campaignId:'c2'});await experiment('e-yt',{channel:'YouTube'});await experiment('e-oda2',{brandId:'ofd'});
const prepare=(creative,minutes,experimentLink)=>post('save_publication','c1',{creativeId:creative.id,mediaUrl:'',scheduledAt:soon(minutes),plannedCostKRW:0,...(experimentLink!==undefined?{experiment:experimentLink}:{})});

// --- 1) 준비 때 연결과 실패 사례 ---------------------------------------------------------------
const count=()=>rows('execution_publication').length;
let before=count();
check('another campaign experiment is a 400 and no draft is made',(await prepare(creatives[0],30,{experimentId:'e-other',arm:'control'})).status===400&&count()===before);
check('an experiment of another brand is a 400',(await prepare(creatives[0],30,{experimentId:'e-oda2',arm:'control'})).status===400&&count()===before);
check('a non-Instagram experiment is a 400',(await prepare(creatives[0],30,{experimentId:'e-yt',arm:'control'})).status===400&&count()===before);
check('a draft experiment is a 409',(await prepare(creatives[0],30,{experimentId:'e-draft',arm:'control'})).status===409&&count()===before);
check('an unknown arm is a 400',(await prepare(creatives[0],30,{experimentId:'e1',arm:'both'})).status===400&&count()===before);
check('a missing experiment is a 404',(await prepare(creatives[0],30,{experimentId:'nope',arm:'control'})).status===404&&count()===before);
let r=await prepare(creatives[0],30,{experimentId:'e1',arm:'control'});
const p1=r.data;
check('prepare links the publication to the experiment arm',r.status===200&&p1.experimentId==='e1'&&p1.arm==='control'&&(await publication(p1.id)).experimentId==='e1'&&(await publication(p1.id)).version===1);
check('a second publication cannot take the same arm',(await prepare(creatives[1],40,{experimentId:'e1',arm:'control'})).status===409);
r=await prepare(creatives[1],40);const p2=r.data;
check('prepare without an experiment stays unlinked',r.status===200&&!('experimentId' in p2)&&!('arm' in p2));
r=await post('link_experiment','c1',{id:p2.id,version:p2.version,experiment:{experimentId:'e1',arm:'treatment'}});
check('an admin links a prepared publication to the other arm',r.status===200&&r.data.publication.arm==='treatment'&&r.data.publication.version===2&&r.data.measurementSource.status==='switch_off');
r=await post('link_experiment','c1',{id:p2.id,version:2,experiment:null});
check('an admin can unlink',r.status===200&&!('experimentId' in r.data.publication)&&!('experimentId' in await publication(p2.id)));
r=await post('link_experiment','c1',{id:p2.id,version:3,experiment:{experimentId:'e1',arm:'treatment'}});
check('relinking works after unlinking',r.status===200&&(await publication(p2.id)).arm==='treatment');
const state=await (await route.GET(new Request('https://app.test/api/execution?campaignId=c1',{headers:{'oai-authenticated-user-id':O}}))).json();
check('the execution state lists only running Instagram experiments of this campaign',JSON.stringify(state.experimentLinks)==='[{"id":"e1","title":"실험 e1"}]');

// --- 2) 승인·접수 → 예약 접수 --------------------------------------------------------------
const credential=await server.readRecord(O,'publisher_credential','oda'),limits=await server.readRecord(O,'execution_limits','c1');
const approveAndExecute=async p=>{const a=await post('approve','c1',{id:p.id,version:(await publication(p.id)).version,confirmed:true,rightsConfirmed:true,immutableMediaConfirmed:true,channelId:'channel-1',credentialVersion:credential.version,limitsVersion:limits.version});assert.equal(a.status,200,JSON.stringify(a.data));const e=await post('execute','c1',{id:p.id,version:a.data.version});assert.equal(e.status,200,JSON.stringify(e.data));return e.data};
let executed=await approveAndExecute(p1);
check('the linked publication is accepted by Buffer and keeps its link',executed.status==='accepted'&&executed.providerId==='post-1'&&executed.experimentId==='e1'&&executed.arm==='control');
check('media ID before publication is a 409',(await post('link_media','c1',{id:p1.id,version:executed.version,mediaId:'17900000000000001'})).status===409);

// --- 3) 스위치 꺼짐: 워커는 Buffer를 부르지 않는다 --------------------------------------------------
now+=25*MIN;bufferStatus='sent';
for(let i=0;i<3;i++)await tick();
check('switch off: worker ticks make zero Buffer checks and write nothing',inspects.length===0&&rows('publication_check').length===0&&(await publication(p1.id)).status==='accepted');
check('publication_auto_link is a known switch, off by default, after b3_playbook_signals',Object.keys(flags.FEATURE_FLAGS).indexOf('publication_auto_link')>Object.keys(flags.FEATURE_FLAGS).indexOf('b3_playbook_signals')&&flags.FEATURE_FLAGS.publication_auto_link.defaultEnabled===false);

// --- 4) 스위치 켜짐: 예약 접수 확인 → 게시 확인, 30분 간격 ------------------------------------------
await setAutoLink(true);
check('switch on: the worker checks the accepted publication',(await tick()).status==='processed'&&inspects.length===1&&inspects[0]==='post-1');
let current=await publication(p1.id);
check('Buffer sent becomes published with a version bump',current.status==='published'&&current.providerStatus==='sent'&&current.version===executed.version+1);
check('the check is recorded and no source is made without a media ID',rows('publication_check').length===1&&rows('publication_check')[0].registration==='not_ready'&&rows('measurement_source').length===0);
now+=10*MIN;await tick();await tick();
check('a publication is not checked again within 30 minutes',inspects.length===1);

// --- 5) 게시물 ID 입력 → 수집 대상 한 번 등록 --------------------------------------------------------
check('a non-numeric media ID is a 400',(await post('link_media','c1',{id:p1.id,version:current.version,mediaId:'abc'})).status===400);
check('a non-Instagram permalink is a 400',(await post('link_media','c1',{id:p1.id,version:current.version,mediaId:'17900000000000001',permalink:'https://evil.test/p/x'})).status===400);
r=await post('link_media','c1',{id:p1.id,version:current.version,mediaId:'17900000000000001',permalink:'https://instagram.com/p/AbC_1/'});
check('an admin records the media ID and the source is registered',r.status===200&&r.data.publication.media.mediaId==='17900000000000001'&&r.data.publication.media.permalink==='https://www.instagram.com/p/AbC_1/'&&r.data.publication.media.linkedBy===O&&r.data.measurementSource.status==='registered');
let sources=rows('measurement_source');
check('the source targets the media ID for the linked arm and waits for the first fetch',sources.length===1&&sources[0].id==='e1:control'&&sources[0].target==='17900000000000001'&&sources[0].channel==='instagram'&&sources[0].rolling===true&&sources[0].pending===true&&sources[0].publicationId===p1.id);
r=await post('link_media','c1',{id:p1.id,version:r.data.publication.version,mediaId:'17900000000000001'});
check('recording the same media again registers nothing new',r.status===200&&r.data.measurementSource.status==='exists'&&rows('measurement_source').length===1);
now+=40*MIN;const inspectsBefore=inspects.length;await tick();
check('the worker does not re-register or re-check a linked published publication',rows('measurement_source').length===1&&inspects.length===inspectsBefore);
// 다른 발행이 같은 게시물 ID를 쓰면 409다.
await put('execution_publication',p2.id,{...(await publication(p2.id)),status:'published'},'c1');
check('a media ID used by another publication is a 409',(await post('link_media','c1',{id:p2.id,version:(await publication(p2.id)).version,mediaId:'17900000000000001'})).status===409);

// --- 6) loop-1 워커 수집이 등록된 대상을 가져간다 ------------------------------------------------------
assert.equal((await channels.POST(new Request('https://app.test/api/channels',{method:'POST',headers:{'content-type':'application/json','oai-authenticated-user-id':O},body:JSON.stringify({action:'save_credential',channel:'instagram',data:{accessToken:'fixture-ig',userId:'17841400000000000'}})}))).status,200);
const graphBefore=graph.length;
check('the measurement worker collects the registered media',(await collector.collectDueMeasurements(O)).status==='processed'&&graph.slice(graphBefore).some(u=>u.includes('/17900000000000001/insights')));
const draft=await server.readRecord(O,'measurement_draft','e1'),source=await server.readRecord(O,'measurement_source','e1:control');
check('the draft carries the collected arm and the source is no longer pending',draft.arms.control.value.denominator===900&&draft.arms.control.value.numerator===45&&draft.comparable===false&&source.pending!==true&&source.lastError===null);

// --- 7) 스위치 꺼짐이면 게시물 ID를 적어도 대상을 만들지 않는다 ------------------------------------------
await setAutoLink(false);
r=await post('link_media','c1',{id:p2.id,version:(await publication(p2.id)).version,mediaId:'17900000000000002'});
check('switch off: the media ID is saved but no source is made',r.status===200&&r.data.measurementSource.status==='switch_off'&&!rows('measurement_source').some(s=>s.id==='e1:treatment'));
check('cancelled or failed publications cannot be linked',await (async()=>{await put('execution_publication',p2.id,{...(await publication(p2.id)),status:'cancelled'},'c1');return (await post('link_experiment','c1',{id:p2.id,version:(await publication(p2.id)).version,experiment:{experimentId:'e1',arm:'treatment'}})).status===409})());
// 끝난 실험의 게시물은 등록하지 않는다(순수 경로).
await experiment('e1',{status:'evaluated',version:2});
check('a finished experiment is never registered',(await links.registerSource(O,{...(await publication(p1.id)),arm:'treatment'})).status==='experiment_closed');

// --- 8) 직원은 준비 뒤 연결·게시물 ID 입력을 하지 못한다(이메일 세션) ---------------------------------------
const email=testRuntime(async url=>{throw new Error('외부 호출 금지: '+url)});Object.assign(email.env,{AUTH_MODE:'email',AUTH_ORIGIN:'https://app.test'});
const emailRoute=await email.load('app/api/execution/route.ts');
// 대표는 워크스페이스에서 가장 먼저 만든 관리자다(lib/auth-session.ts roleSql). 대표가 있어야 직원 세션이 풀린다.
email.sql.prepare('INSERT INTO auth_users(id,email,workspace_owner,role,status,created_at) VALUES(?,?,?,?,?,?)').run('admin','admin@test.invalid','workspace','admin','active',Date.now()-1000);
email.sql.prepare('INSERT INTO auth_users(id,email,workspace_owner,role,status,created_at) VALUES(?,?,?,?,?,?)').run('member','member@test.invalid','workspace','member','active',Date.now());
email.sql.prepare('INSERT INTO auth_sessions VALUES(?,?,?,?)').run(createHash('sha256').update('b'.repeat(64)).digest('hex'),'member',Date.now()+60000,Date.now());
const memberPost=async(action,data)=>{const res=await emailRoute.POST(new Request('https://app.test/api/execution',{method:'POST',headers:{'content-type':'application/json',origin:'https://app.test',cookie:'__Host-collective_session='+'b'.repeat(64)},body:JSON.stringify({action,campaignId:'c1',...data})}));return res.status};
check('a member cannot link an experiment after preparing (403)',await memberPost('link_experiment',{id:'x',version:1,experiment:null})===403);
check('a member cannot record a media ID (403)',await memberPost('link_media',{id:'x',version:1,mediaId:'1'})===403);

console.log(JSON.stringify({passed:checks.length,checks},null,2));
