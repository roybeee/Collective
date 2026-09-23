import assert from 'node:assert/strict';
import {deflateSync} from 'node:zlib';
import {readFileSync} from 'node:fs';
import {testRuntime} from './helpers/runtime.mjs';

function crc32(bytes){let crc=0xffffffff;for(const byte of bytes){crc^=byte;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0)}return (crc^0xffffffff)>>>0}
function chunk(type,data){const name=Buffer.from(type),size=Buffer.alloc(4),crc=Buffer.alloc(4);size.writeUInt32BE(data.length);crc.writeUInt32BE(crc32(Buffer.concat([name,data])));return Buffer.concat([size,name,data,crc])}
const signature=Buffer.from([137,80,78,71,13,10,26,10]),ihdr=Buffer.alloc(13);
ihdr.writeUInt32BE(1080,0);ihdr.writeUInt32BE(1080,4);ihdr[8]=8;ihdr[9]=2;
function fixture(fill=0){const pixels=Buffer.alloc((1080*3+1)*1080,fill);for(let row=0;row<1080;row++)pixels[row*(1080*3+1)]=0;return Buffer.concat([signature,chunk('IHDR',ihdr),chunk('IDAT',deflateSync(pixels)),chunk('IEND',Buffer.alloc(0))])}
const png=fixture(),differentPng=fixture(255),dataUrl=bytes=>'data:image/png;base64,'+bytes.toString('base64');
let calls=0,mode='ok',media=png,providerStatus='sent',foreignLock='',inspectChannel='channel-1',ownMediaFetches=0,lastSubmittedUrl='',flaggedDuringSubmit=-1;
let server,execServer,beforeRun=null;
const rt=testRuntime(async(url,init={})=>{
 if(String(url).startsWith('https://res.cloudinary.com/'))return new Response(media,{headers:{'content-type':'image/png'}});
 if(String(url).startsWith('https://app.test/')){ownMediaFetches++;return new Response('not found',{status:404})}
 const {query,variables}=JSON.parse(init.body);
 if(query.includes('organizations'))return Response.json({data:{account:{organizations:[{id:'org',name:'ODA 조직'},{id:'org-2',name:'두 번째 조직'}]}}});
 if(query.includes('channels('))return Response.json({data:{channels:variables.organizationId==='org-2'?[{id:'channel-2',name:'ODA 2',service:'instagram',isQueuePaused:false}]:[{id:'channel-1',name:'ODA',service:'instagram',isQueuePaused:false},{id:'fb-1',name:'ODA FB',service:'facebook',isQueuePaused:false}]}});
 if(query.includes('createPost')){
  calls++;lastSubmittedUrl=variables.input.assets[0].image.url;
  if(mode==='lost')throw new Error('network timeout after submission');
  if(mode==='lock'||mode==='lockerror')foreignLock=await server.acquireLock('owner');
  if(mode==='steal')rt.sql.prepare("UPDATE records SET data=json_set(data,'$.version',999) WHERE owner='owner' AND kind='execution_publication' AND json_extract(data,'$.status')='submitting'").run();
  if(mode==='flag')flaggedDuringSubmit=await execServer.flagPublicationsForFactChange(rt.env.DB,'owner',['fact']);
  return Response.json({data:{createPost:{__typename:'PostActionSuccess',post:{id:'post-'+calls,status:mode==='draft'?'needs_approval':mode==='error'||mode==='lockerror'?'error':'scheduled'}}}});
 }
 return Response.json({data:{post:{id:variables.id,status:providerStatus,channelId:inspectChannel}}});
},{beforeRun:statement=>beforeRun?.(statement)});
const objects=new Map();rt.env.BUCKET={put:async(k,v)=>objects.set(k,new Uint8Array(v)),get:async k=>objects.has(k)?{arrayBuffer:async()=>objects.get(k).slice().buffer,body:new Response(objects.get(k).slice()).body}:null,head:async k=>objects.has(k)?{size:objects.get(k).length}:null,delete:async k=>objects.delete(k)};
server=await rt.load('lib/server.ts');
const route=await rt.load('app/api/execution/route.ts'),actionRoute=await rt.load('app/api/action/route.ts'),mediaRoute=await rt.load('app/media/[file]/route.ts');
execServer=await rt.load('lib/execution-server.ts');
const mediaModule=await rt.load('lib/execution-media.ts'),exec=await rt.load('lib/execution.ts'),catalog=await rt.load('lib/fact-catalog.ts').catch(()=>null);
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
const s=await setup('happy');
check(objects.size===1,'real PNG stored in mocked R2');
check(!!catalog&&s.creative.caption===catalog.factLabel('address')+': '+fact.value&&!s.creative.caption.startsWith('address:'),'caption shows catalog label instead of internal key');
check((await post('save_limits',s.id,{version:1,maxPublications:-1,maxPlannedCostKRW:1000})).status===400,'negative limits rejected');
check((await post('save_limits',s.id,{maxPublications:1,maxPlannedCostKRW:1000},'stranger')).status===404,'owner isolated');
check((await post('save_limits',s.id,{maxPublications:1,maxPlannedCostKRW:1000},'owner','https://evil.test')).status===403,'CSRF rejected');
const badCrc=Buffer.from(png);badCrc[badCrc.length-1]^=1;
check((await post('save_creative',s.id,{campaignVersion:1,factRefs:[{id:'fact',version:1}],png:dataUrl(badCrc)})).status===400,'bad PNG CRC rejected');
check((await post('save_creative',s.id,{campaignVersion:1,factRefs:[{id:'fact',version:1}],png:dataUrl(Buffer.concat([signature,chunk('IHDR',ihdr),chunk('IEND',Buffer.alloc(0))]))})).status===400,'missing IDAT rejected');
check((await post('save_creative',s.id,{campaignVersion:1,factRefs:[{id:'fact',version:1}],png:dataUrl(png.subarray(0,png.length-12))})).status===400,'missing IEND rejected');
check((await post('save_publication',s.id,{creativeId:s.creative.id,mediaUrl:'https://example.com/a.png',scheduledAt:'2098-01-01T00:00:00Z',plannedCostKRW:100})).status===400,'untrusted media origin rejected');
check((await post('save_publication',s.id,{creativeId:s.creative.id,mediaUrl:cloud(s),scheduledAt:fact.validUntil,plannedCostKRW:100})).status===409,'fact expiry equality rejected for schedule');
const p=await draft(s);
check(p.mediaMode==='external','pasted Cloudinary URL keeps the advanced external-host mode');
check((await post('save_publication',s.id,{creativeId:s.creative.id,mediaUrl:p.mediaUrl,scheduledAt:p.scheduledAt,plannedCostKRW:100})).status===409,'same creative schedule draft duplicate rejected');
check((await approve(s,p,{rightsConfirmed:false})).status===400,'rights explicitly required');
check((await approve(s,p,{immutableMediaConfirmed:false})).status===400,'immutable public media commitment required');
check((await approve(s,p,{channelId:'different-channel'})).status===409,'displayed account mismatch rejected');
const oldCredential=await approve(s,p,{credentialVersion:0});
check(oldCredential.status===409&&oldCredential.data.error.includes('발행 계정'),'old displayed credential version rejected and named');
const oldLimits=await approve(s,p,{limitsVersion:0});
check(oldLimits.status===409&&oldLimits.data.error.includes('실행 한도'),'old displayed limits version rejected and named');
check(calls===0,'displayed approval conflicts never invoke publisher');
media=differentPng;
check((await approve(s,p)).status===409,'raw media hash mismatch rejected');
media=png;
check(calls===0,'no publish call before approval');
const approved=await approve(s,p);check(approved.status===200&&approved.data.status==='approved'&&approved.data.approvedBy==='owner','approve happy flow records actor');
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
await post('save_limits',stale.id,{version:1,maxPublications:1,maxPlannedCostKRW:500});
const lowered=await post('execute',stale.id,{id:sp.id,version:sa.data.version});
check(lowered.status===409&&lowered.data.error.includes('실행 한도'),'lowered limits block and name the changed item');
const loss=await setup('lost'),lp=await draft(loss),la=await approve(loss,lp);mode='lost';
const beforeLost=calls,lr=await post('execute',loss.id,{id:lp.id,version:la.data.version});mode='ok';
check(lr.status===200&&lr.data.status==='uncertain','timeout becomes uncertain');
check(calls===beforeLost+1,'uncertain attempted only once');
check((await post('execute',loss.id,{id:lp.id,version:lr.data.version})).status===409,'uncertain no retransmission');
check((await post('refresh',loss.id,{id:lp.id,version:lr.data.version})).status===409,'uncertain without provider ID cannot claim refresh');
check(calls===beforeLost+1,'uncertain retry makes no external call');
check((await post('resolve_uncertain',loss.id,{id:lp.id,version:lr.data.version,notFound:true})).status===400,'not-found resolution requires an explicit attempt-restore choice');
inspectChannel='channel-x';
check((await post('resolve_uncertain',loss.id,{id:lp.id,version:lr.data.version,providerId:'post-77'})).status===409,'provider post from another channel cannot resolve');
inspectChannel='channel-1';providerStatus='scheduled';
const resolved=await post('resolve_uncertain',loss.id,{id:lp.id,version:lr.data.version,providerId:'post-77'});providerStatus='sent';
check(resolved.status===200&&resolved.data.status==='accepted'&&resolved.data.providerId==='post-77'&&resolved.data.resolvedBy==='owner','uncertain resolved with verified Buffer post ID and actor');
check(calls===beforeLost+1,'resolution never resubmits');
check(rows('event').some(e=>e.campaignId===loss.id&&e.actor?.id==='owner'),'resolution leaves actor event');
const loss2=await setup('lost2'),l2p=await draft(loss2),l2a=await approve(loss2,l2p);mode='lost';
const l2r=await post('execute',loss2.id,{id:l2p.id,version:l2a.data.version});mode='ok';
const restored=await post('resolve_uncertain',loss2.id,{id:l2p.id,version:l2r.data.version,notFound:true,restoreAttempt:true});
check(restored.status===200&&restored.data.status==='failed'&&restored.data.attemptRestored===true,'confirmed missing post closes as failed with attempt restored');
const retry=await draft(loss2,5),retryApproved=await approve(loss2,retry);
check((await post('execute',loss2.id,{id:retry.id,version:retryApproved.data.version})).data.status==='accepted','restored attempt allows a new submission within quota');
const loss3=await setup('lost3'),l3p=await draft(loss3),l3a=await approve(loss3,l3p);mode='lost';
const l3r=await post('execute',loss3.id,{id:l3p.id,version:l3a.data.version});mode='ok';
const kept=await post('resolve_uncertain',loss3.id,{id:l3p.id,version:l3r.data.version,notFound:true,restoreAttempt:false});
check(kept.status===200&&kept.data.status==='failed'&&!kept.data.attemptRestored,'missing post can close while keeping attempt deduction');
const noRetry=await draft(loss3,5),noRetryApproved=await approve(loss3,noRetry);
check((await post('execute',loss3.id,{id:noRetry.id,version:noRetryApproved.data.version})).status===409,'kept deduction still enforces quota');
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
// security-ops-10: 외부 호스트 발행은 게시 전(accepted·blocked) 상태 조회 때 공개 파일 해시를 다시 확인한다.
check(!br.data.needsReview,'unchanged external media leaves no review flag');
media=differentPng;providerStatus='needs_approval';
const swapped=await post('refresh',blocked.id,{id:dp.id,version:br.data.version});providerStatus='sent';media=png;
check(swapped.status===200&&swapped.data.status==='blocked'&&!!swapped.data.needsReview?.reason?.includes('외부 이미지'),'refresh flags an external image that no longer matches the approved PNG');
const audit=await setup('audit');
const deletion=await actionRoute.POST(new Request('https://app.test/api/action',{method:'POST',headers:{'content-type':'application/json','oai-authenticated-user-id':'owner',origin:'https://app.test'},body:JSON.stringify({action:'delete_campaign',id:audit.id,version:1,confirmed:true})}));
check(deletion.status===409,'campaign with creative execution records cannot be deleted');
const state=await getState('happy');
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

// data-truth-4 (a): 비용 상한은 확정 예산 안에서만 정한다. 미확정(null·확정 표시 없는 이전 0)이면 0원 상한만 허용한다. 확정된 0원은 무예산이다.
await fresh();
await put('campaign','budgeted',campaignFixture('budgeted',{budget:500}));
check((await post('save_limits','budgeted',{maxPublications:1,maxPlannedCostKRW:1000})).status===409,'planned cost cap above confirmed budget rejected');
check((await post('save_limits','budgeted',{maxPublications:1,maxPlannedCostKRW:500})).status===200,'planned cost cap within confirmed budget saved');
await put('campaign','unbudgeted',campaignFixture('unbudgeted',{budget:null,budgetConfirmedAt:undefined}));
const unbudgetedLimits=await post('save_limits','unbudgeted',{maxPublications:1,maxPlannedCostKRW:1000});
check(unbudgetedLimits.status===409&&unbudgetedLimits.data.error.includes('예산을 확정'),'unconfirmed (null) budget rejects a paid cost cap with reason');
check((await post('save_limits','unbudgeted',{maxPublications:1,maxPlannedCostKRW:0})).status===200,'unconfirmed budget still allows the 0-won default limits');
await put('campaign','zero-budget',campaignFixture('zero-budget',{budget:0,budgetConfirmedAt:new Date().toISOString()}));
check((await post('save_limits','zero-budget',{maxPublications:1,maxPlannedCostKRW:1})).status===409,'confirmed zero budget keeps planned cost at 0');
check((await post('save_limits','zero-budget',{maxPublications:1,maxPlannedCostKRW:0})).status===200,'organic 0-won limits allowed under zero budget');
await put('campaign','legacy-zero',campaignFixture('legacy-zero',{budget:0,budgetConfirmedAt:undefined}));
check((await post('save_limits','legacy-zero',{maxPublications:1,maxPlannedCostKRW:1000})).status===409,'legacy 0 without confirmation reads as unconfirmed and rejects a paid cost cap');
// 한도를 저장한 뒤 예산을 낮추거나 미확정으로 되돌리면 승인·접수가 '예산' 사유로 막힌다.
const rebudget=await setup('rebudget',2),rbDraft=await draft(rebudget,0,100),rbApproved=await approve(rebudget,rbDraft),rbCalls=calls;
await put('campaign','rebudget',campaignFixture('rebudget',{budget:500}));
const overBudget=await post('execute','rebudget',{id:rbDraft.id,version:rbApproved.data.version});
check(overBudget.status===409&&overBudget.data.error.includes('예산 초과')&&calls===rbCalls,'lowered budget below the cost cap blocks submission before any provider call');
const rbSecond=await draft(rebudget,1,100),overApproval=await approve(rebudget,rbSecond);
check(overApproval.status===409&&overApproval.data.error.includes('예산 초과'),'lowered budget below the cost cap blocks approval');
await put('campaign','rebudget',campaignFixture('rebudget',{budget:null,budgetConfirmedAt:undefined}));
const unconfirmedApproval=await approve(rebudget,rbSecond);
check(unconfirmedApproval.status===409&&unconfirmedApproval.data.error.includes('예산 미확정'),'unconfirmed budget blocks approving a paid publication');
await put('campaign','rebudget',campaignFixture('rebudget'));

// exec-loop-7 (3)(4): 기획 승인·기간 확정·예약 시각이 기간 안일 때만 발행을 승인한다.
const gate=await setup('gate'),gp=await draft(gate),gateCalls=calls;
await put('campaign','gate',campaignFixture('gate',{status:'review'}));
const unapproved=await approve(gate,gp);check(unapproved.status===409&&unapproved.data.error.includes('기획'),'unapproved plan blocks publication approval with reason');
await put('campaign','gate',campaignFixture('gate',{startDate:'',endDate:''}));
const undated=await approve(gate,gp);check(undated.status===409&&undated.data.error.includes('시작일'),'unconfirmed campaign dates block approval with reason');
await put('campaign','gate',campaignFixture('gate',{startDate:'2098-02-01'}));
const outside=await approve(gate,gp);check(outside.status===409&&outside.data.error.includes('기간'),'schedule outside campaign period blocks approval with reason');
await put('campaign','gate',campaignFixture('gate'));
const gateApproved=await approve(gate,gp);check(gateApproved.status===200&&calls===gateCalls,'approved plan inside the period can be approved without provider calls');
await put('campaign','gate',campaignFixture('gate',{status:'review'}));
const reviewing=await post('execute',gate.id,{id:gp.id,version:gateApproved.data.version});
check(reviewing.status===409&&reviewing.data.error.includes('기획')&&calls===gateCalls,'submission rechecks plan approval before any provider call');
await put('campaign','gate',campaignFixture('gate'));

// exec-loop-6: 한도가 없으면 일반 404가 아니라 차단 사유를 돌려준다.
await fresh();await put('campaign','nolimits',campaignFixture('nolimits'));
const noLimitCard=await post('save_creative','nolimits',{campaignVersion:1,factRefs:[{id:'fact',version:1}],png:dataUrl(png)});
const noLimitDraft=await draft({id:'nolimits',creative:noLimitCard.data});
const noLimit=await approve({id:'nolimits'},noLimitDraft);
check(noLimit.status===409&&noLimit.data.error.includes('한도'),'missing limits explained instead of generic 404');

// exec-loop-2: 외부 주소 없이 초안을 만들면 승인 시 앱 자체 공개 주소를 채운다.
const auto=await setup('auto');
const autoDraft=await post('save_publication',auto.id,{creativeId:auto.creative.id,scheduledAt:at(10),plannedCostKRW:0});
check(autoDraft.status===200&&autoDraft.data.mediaMode==='auto'&&!autoDraft.data.mediaUrl,'draft without external URL uses app public media');
const autoApproved=await approve(auto,autoDraft.data,{immutableMediaConfirmed:false});
check(autoApproved.status===200&&mediaModule.isOwnMediaUrl(autoApproved.data.mediaUrl,'https://app.test')&&autoApproved.data.mediaUrl.endsWith('/'+auto.creative.pngHash+'.png'),'approval fills the app public media URL');
check(objects.has('public/'+auto.creative.pngHash+'.png')&&(await server.readRecord('owner','public_media',auto.creative.pngHash)).publicationIds.includes(autoDraft.data.id),'approved publication references the public object');
const autoSent=await post('execute',auto.id,{id:autoDraft.data.id,version:autoApproved.data.version});
check(autoSent.status===200&&autoSent.data.status==='accepted'&&lastSubmittedUrl===autoApproved.data.mediaUrl,'Buffer receives the app public media URL');
check(ownMediaFetches===0,'own media verified without self-fetch');
const ownPasted=await post('save_publication',auto.id,{creativeId:auto.creative.id,mediaUrl:autoApproved.data.mediaUrl,scheduledAt:at(11),plannedCostKRW:0});
check(ownPasted.status===200&&ownPasted.data.mediaMode==='auto','pasted own media URL is treated as app public media');
const cancelAuto=await setup('auto-cancel');
const cancelDraft=await post('save_publication',cancelAuto.id,{creativeId:cancelAuto.creative.id,scheduledAt:at(12),plannedCostKRW:0});
const cancelApproved=await approve(cancelAuto,cancelDraft.data);
const cancelled=await post('cancel',cancelAuto.id,{id:cancelDraft.data.id,version:cancelApproved.data.version});
check(cancelled.status===200&&cancelled.data.status==='cancelled'&&!(await server.readRecord('owner','public_media',cancelAuto.creative.pngHash)).publicationIds.includes(cancelDraft.data.id),'cancel retires the public media reference');

// exec-loop-8: 소재 유효성은 브리프 버전이 아니라 소재 입력(브랜드 이름·색·사실·캡션) 해시로 판정한다.
const material=await setup('material');
await put('campaign','material',campaignFixture('material',{version:2}));
check((await post('save_publication','material',{creativeId:material.creative.id,mediaUrl:cloud(material),scheduledAt:at(20),plannedCostKRW:0})).status===200,'brief version change alone keeps the creative valid');
check((await getState('material')).creatives.every(c=>c.current===true),'state marks unchanged material as current');
const oda=await server.readRecord('owner','brand','oda');
await put('brand','oda',{...oda,color:'#000000'});
const recolored=await post('save_publication','material',{creativeId:material.creative.id,mediaUrl:cloud(material),scheduledAt:at(21),plannedCostKRW:0});
check(recolored.status===409&&recolored.data.error.includes('브랜드'),'brand color change invalidates creative material and names it');
check((await getState('material')).creatives.every(c=>c.current===false),'state marks changed material as not current');
await put('brand','oda',oda);

// exec-loop-8: 한도를 올리면 승인이 유지되고, 낮추면 무효화되며 reconfirm으로 새 초안 버전이 된다.
const raise=await setup('raise',2),rp=await draft(raise),ra=await approve(raise,rp);
await post('save_limits',raise.id,{version:1,maxPublications:3,maxPlannedCostKRW:2000});
const raised=await post('execute',raise.id,{id:rp.id,version:ra.data.version});
check(raised.status===200&&raised.data.status==='accepted','raising limits keeps existing approval');
const lower=await setup('lower',2),lowerDraft=await draft(lower),lowerApproved=await approve(lower,lowerDraft);
await post('save_limits',lower.id,{version:1,maxPublications:1,maxPlannedCostKRW:1000});
check((await post('execute',lower.id,{id:lowerDraft.id,version:lowerApproved.data.version})).status===409,'lowering limits invalidates approval');
const back=await post('reconfirm',lower.id,{id:lowerDraft.id,version:lowerApproved.data.version});
check(back.status===200&&back.data.status==='draft'&&back.data.version===lowerApproved.data.version+1&&!back.data.approvedAt&&back.data.reconfirmedBy==='owner','reconfirm returns an invalidated approval to a new draft version');
check((await post('reconfirm',lower.id,{id:lowerDraft.id,version:back.data.version})).status===409,'reconfirm only applies to approved publications');
const again=await approve(lower,back.data);
check(again.status===200&&(await post('execute',lower.id,{id:lowerDraft.id,version:again.data.version})).data.status==='accepted','re-approved draft executes under the new limits');

// exec-loop-9 (2): 공급자 결과 저장이 반영되지 않으면(changes=0) Buffer 게시 번호를 감사 기록과 응답에 남긴다.
const steal=await setup('steal'),stealDraft=await draft(steal),stealApproved=await approve(steal,stealDraft);mode='steal';
const stolen=await post('execute',steal.id,{id:stealDraft.id,version:stealApproved.data.version});mode='ok';
check(stolen.status===200&&stolen.data.providerAudit?.providerId==='post-'+calls,'unsaved provider ID returned in the response');
check(rows('execution_provider_audit').some(a=>a.providerId==='post-'+calls&&a.publicationId===stealDraft.id),'unsaved provider ID stored in a separate audit record');

// exec-loop-7 (1): 승인된 콘텐츠 작업물 카피는 금지·미확인 표현 검사를 통과할 때만 캡션에 적용한다.
await put('brand_fact','rejected-fact',{id:'rejected-fact',brandId:'oda',key:'delivery',value:'무료 배달',status:'rejected',source:'owner',verifiedAt:new Date().toISOString(),validUntil:'2099-01-01T00:00:00Z',version:1},'oda');
await put('brand_fact','candidate-fact',{id:'candidate-fact',brandId:'oda',key:'cooking_method',value:'화덕 조리',status:'candidate',source:'',verifiedAt:'',validUntil:'',version:1},'oda');
const copy=await setup('copy');
const blocks=['휘경동 ODA 피자에서 따뜻한 한 판을 만나 보세요.','지금 인기 메뉴를 할인합니다!','무료 배달 이벤트 진행 중','화덕 조리로 구운 피자를 만나 보세요.'];
await put('artifact','copy-art',{id:'copy-art',campaignId:'copy',campaignVersion:1,role:'content',title:'콘텐츠 스튜디오 · ODA',content:'## 게시 카피 3종과 용도·CTA\n\n'+blocks.join('\n\n')+'\n\n## 총 15초 구간별 화면/대사/자막/소리/편집표\n\n0–3초: 매장 외관',version:2,status:'approved',origin:'manual',createdAt:new Date().toISOString()},'copy');
await put('artifact','review-art',{id:'review-art',campaignId:'copy',campaignVersion:1,role:'content',title:'검토 전',content:'## 게시 카피 3종과 용도·CTA\n\n검토 전 카피입니다.',version:1,status:'review',origin:'manual',createdAt:new Date().toISOString()},'copy');
// 결정 17 게이트: 기본값에서는 AI 카피 캡션 후보를 내주지 않고, 카피를 붙인 발행 준비는 409로 막는다.
const gatedState=await getState('copy');
check(gatedState.copyCaptions===false&&Array.isArray(gatedState.copies)&&gatedState.copies.length===0,'AI copy captions off by default (decision 17)');
const gatedCopy=await post('save_publication','copy',{creativeId:copy.creative.id,mediaUrl:cloud(copy),scheduledAt:at(29),plannedCostKRW:0,copy:{artifactId:'copy-art',artifactVersion:2,index:0}});
check(gatedCopy.status===409&&gatedCopy.data.error.includes('결정 17'),'copy caption rejected while decision 17 gate is off');
rt.env.AI_COPY_CAPTIONS='enabled';
const copyState=await getState('copy');
check(copyState.copyCaptions===true,'gate reports enabled');
check(copyState.copies?.length===4&&copyState.copies[0].text===blocks[0]&&!copyState.copies[0].issues.length,'approved content copy offered as caption candidate');
check(!copyState.copies?.some(c=>c.artifactId==='review-art'),'unapproved content copy not offered');
check(copyState.copies?.[1]?.issues.some(i=>i.includes('인기'))&&copyState.copies[2].issues.some(i=>i.includes('무료 배달'))&&copyState.copies[3].issues.some(i=>i.includes('화덕 조리')),'claim guard, prohibited and candidate facts block copy with reasons');
const badCopy=await post('save_publication','copy',{creativeId:copy.creative.id,mediaUrl:cloud(copy),scheduledAt:at(30),plannedCostKRW:0,copy:{artifactId:'copy-art',artifactVersion:2,index:1}});
check(badCopy.status===409&&badCopy.data.error.includes('인기'),'unsafe copy rejected on draft with reason');
const goodCopy=await post('save_publication','copy',{creativeId:copy.creative.id,mediaUrl:cloud(copy),scheduledAt:at(31),plannedCostKRW:0,copy:{artifactId:'copy-art',artifactVersion:2,index:0}});
check(goodCopy.status===200&&goodCopy.data.caption===blocks[0]+'\n\n'+copy.creative.caption&&goodCopy.data.copy?.text===blocks[0],'safe approved copy composed with the fact caption');
const copyApproved=await approve(copy,goodCopy.data);check(copyApproved.status===200,'publication with approved copy can be approved');
await put('artifact','copy-art',{...(await server.readRecord('owner','artifact','copy-art')),status:'outdated'},'copy');
check((await post('execute','copy',{id:goodCopy.data.id,version:copyApproved.data.version})).status===409,'copy artifact no longer approved blocks submission');

// exec-loop-3: 사실 변경은 그 사실을 쓴 승인·접수·접수 중 발행에 needsReview를 남긴다.
const flag=await setup('flag'),flagDraft=await draft(flag),flagApproved=await approve(flag,flagDraft);
const expected=rows('execution_publication').filter(x=>['approved','accepted','submitting','uncertain','blocked'].includes(x.status)&&x.factRefs.some(r=>r.id==='fact')).length;
check(await execServer.flagPublicationsForFactChange?.(rt.env.DB,'owner',['fact'])===expected&&expected>=2,'fact change flags every live publication using it');
const flaggedRecord=await server.readRecord('owner','execution_publication',flagDraft.id);
check(!!flaggedRecord.needsReview?.reason&&!!flaggedRecord.needsReview.at&&flaggedRecord.version===flagApproved.data.version+1,'flag stores needsReview reason and time');
// 사실 버전이 바뀌면 같은 소재로 다시 승인할 수 없으므로 재확인 대신 취소 후 새 PNG를 안내한다.
check(flaggedRecord.needsReview.reason.includes('새 PNG')&&!flaggedRecord.needsReview.reason.includes('재확인하고'),'fact change tells approved publications to start over with a new PNG');
check(!!(await server.readRecord('owner','execution_publication',kp.id)).needsReview,'accepted reservation is flagged for Buffer cancellation');
check(await execServer.flagPublicationsForFactChange?.(rt.env.DB,'owner',['unrelated'])===0,'unrelated fact flags nothing');
// R2: 접수 여부 미확인(uncertain)·공급자 확인 필요(blocked)도 Buffer에 예약이 있을 수 있어 표시한다. 접수 중(submitting)만 버전을 올리지 않는다.
const liveStatuses=['approved','accepted','submitting','uncertain','blocked'];
for(const [i,status] of [...liveStatuses,'draft','published','failed','cancelled'].entries())await put('execution_publication','five-'+status,{id:'five-'+status,campaignId:'flag',status,version:3,factRefs:[{id:'five-fact',version:1}],scheduledAt:at(60+i)},'flag');
check(await execServer.flagPublicationsForFactChange(rt.env.DB,'owner',['five-fact'])===5,'fact change flags approved, accepted, submitting, uncertain and blocked publications');
const five=Object.fromEntries(await Promise.all([...liveStatuses,'draft','published'].map(async x=>[x,await server.readRecord('owner','execution_publication','five-'+x)])));
check(liveStatuses.every(x=>!!five[x].needsReview?.reason)&&!five.draft.needsReview&&!five.published.needsReview,'only live reservations carry the review flag');
check(five.submitting.version===3&&['approved','accepted','uncertain','blocked'].every(x=>five[x].version===4),'submitting keeps its version while other flagged publications get a new version');
// R8: 표시는 읽어 둔 스냅샷을 덮어쓰지 않고 현재 행에 더한다. 그 사이 공급자 결과가 저장돼도 결과와 표시가 모두 남는다.
await put('execution_publication','race-pub',{id:'race-pub',campaignId:'flag',status:'submitting',version:7,factRefs:[{id:'race-fact',version:1}],scheduledAt:at(70)},'flag');
beforeRun=statement=>{if(statement.query.includes('needsReview')&&statement.values.includes('owner:execution_publication:race-pub')){beforeRun=null;rt.sql.prepare("UPDATE records SET data=json_set(data,'$.status','accepted','$.providerId','post-race','$.version',8) WHERE id='owner:execution_publication:race-pub'").run()}};
const raced=await execServer.flagPublicationsForFactChange(rt.env.DB,'owner',['race-fact']);beforeRun=null;
const raceRecord=await server.readRecord('owner','execution_publication','race-pub');
check(raced===1&&raceRecord.status==='accepted'&&raceRecord.providerId==='post-race'&&!!raceRecord.needsReview?.reason,'provider result saved between read and flag keeps both the result and the review flag');
const flaggedExecute=await post('execute',flag.id,{id:flagDraft.id,version:flaggedRecord.version});
check(flaggedExecute.status===409&&flaggedExecute.data.error.includes('새 PNG'),'flagged approval cannot be submitted and points to a new PNG');
const reviewed=await post('reconfirm',flag.id,{id:flagDraft.id,version:flaggedRecord.version});
check(reviewed.status===200&&!reviewed.data.needsReview,'reconfirm clears the review flag');
const flight=await setup('flight'),flightDraft=await draft(flight),flightApproved=await approve(flight,flightDraft);mode='flag';
const flown=await post('execute',flight.id,{id:flightDraft.id,version:flightApproved.data.version});mode='ok';
check(flaggedDuringSubmit>=1&&flown.status===200&&flown.data.status==='accepted'&&!!flown.data.needsReview?.reason&&!flown.data.providerAudit,'fact change during submission keeps provider result and review flag');

// exec-loop-9: 방금 접수 중(submitting)이 된 발행은 Buffer 응답 대기(최대 15초) 중일 수 있어 확정하지 않는다. 2분이 지나면 확정할 수 있다.
const settle=await setup('settle'),settleBase={campaignId:'settle',creativeId:settle.creative.id,creativeVersion:1,campaignVersion:1,pngHash:settle.creative.pngHash,factRefs:[{id:'fact',version:1}],caption:settle.creative.caption,mediaMode:'external',mediaUrl:cloud(settle),status:'submitting',plannedCostKRW:0,version:2,createdAt:new Date().toISOString()};
await put('execution_publication','settle-fresh',{...settleBase,id:'settle-fresh',attemptedAt:new Date().toISOString(),scheduledAt:at(80)},'settle');
await put('execution_publication','settle-old',{...settleBase,id:'settle-old',attemptedAt:new Date(Date.now()-130000).toISOString(),scheduledAt:at(81)},'settle');
const early=await post('resolve_uncertain','settle',{id:'settle-fresh',version:2,notFound:true,restoreAttempt:true});
check(early.status===409&&early.data.error.includes('접수 처리 중')&&(await server.readRecord('owner','execution_publication','settle-fresh')).status==='submitting','fresh submitting publication cannot be closed while the provider call may still succeed');
check((await post('resolve_uncertain','settle',{id:'settle-old',version:2,notFound:true,restoreAttempt:true})).data?.status==='failed','submitting publication past the provider timeout can be closed');
const settleNow=Date.now(),settleAt=new Date(settleNow).toISOString();
check(exec.uncertainResolvable?.({status:'submitting',attemptedAt:settleAt},settleNow+1000)===false&&exec.uncertainResolvable({status:'submitting',attemptedAt:settleAt},settleNow+120000)===true&&exec.uncertainResolvable({status:'uncertain',attemptedAt:settleAt},settleNow)===true,'screen hides resolve buttons for fresh submitting publications');

// R4: 지점 연결 전에 만든 소재(지점 없음)는 연결 뒤 현재 소재가 아니다. 서버 접수 판정(currentCreative)과 같은 기준이다.
await setup('storeless');
await put('store','s-link',{id:'s-link',brandId:'oda',status:'active'},'oda');
await put('campaign','storeless',campaignFixture('storeless',{storeId:'s-link'}));
check((await getState('storeless')).creatives.every(c=>c.current===false),'creative made before a store link is not offered as current');

// R12: 자동 공개 발행은 초안 복귀·실패로 끝나는 모든 경로에서 그 발행의 공개 참조를 해제한다.
const refsOf=async hash=>(await server.readRecord('owner','public_media',hash).catch(()=>({publicationIds:[]}))).publicationIds;
const mediaGet=p=>mediaRoute.GET(new Request(p.mediaUrl),{params:Promise.resolve({file:p.pngHash+'.png'})});
async function approvedAuto(id,offset,bytes=png){
 const s=await setup(id,2,1000,{},bytes),d=await post('save_publication',id,{creativeId:s.creative.id,scheduledAt:at(offset),plannedCostKRW:0}),a=await approve(s,d.data);
 assert.equal(a.status,200,'auto fixture approval '+JSON.stringify(a.data));return {s,p:a.data};
}
const rc=await approvedAuto('retire-reconfirm',90);
check((await refsOf(rc.p.pngHash)).includes(rc.p.id)&&(await post('reconfirm',rc.s.id,{id:rc.p.id,version:rc.p.version})).status===200&&!(await refsOf(rc.p.pngHash)).includes(rc.p.id),'reconfirm retires the public media reference');
const ee=await approvedAuto('retire-execute',91);mode='error';
const eeSent=await post('execute',ee.s.id,{id:ee.p.id,version:ee.p.version});mode='ok';
check(eeSent.data.status==='failed'&&!(await refsOf(ee.p.pngHash)).includes(ee.p.id),'provider error on submission retires the public media reference');
const re=await approvedAuto('retire-refresh',92);
const reSent=await post('execute',re.s.id,{id:re.p.id,version:re.p.version});providerStatus='error';
const reFailed=await post('refresh',re.s.id,{id:re.p.id,version:reSent.data.version});providerStatus='sent';
check(reSent.data.status==='accepted'&&(await refsOf(re.p.pngHash)).length>0&&reFailed.data.status==='failed'&&!(await refsOf(re.p.pngHash)).includes(re.p.id),'refresh ending in provider error retires the public media reference');
const rn=await approvedAuto('retire-missing',93);mode='lost';
const rnSent=await post('execute',rn.s.id,{id:rn.p.id,version:rn.p.version});mode='ok';
check(rnSent.data.status==='uncertain'&&(await refsOf(rn.p.pngHash)).includes(rn.p.id),'uncertain submission keeps the public media reference');
check((await post('resolve_uncertain',rn.s.id,{id:rn.p.id,version:rnSent.data.version,notFound:true,restoreAttempt:false})).data.status==='failed'&&!(await refsOf(rn.p.pngHash)).includes(rn.p.id),'confirmed missing post retires the public media reference');
// SEC-1: 참조 해제가 잠금 경합으로 건너뛰어져도 실패한 발행의 PNG는 제공하지 않는다(발행 상태로 판정).
const le=await approvedAuto('retire-locked',94,fixture(77));
check((await mediaGet(le.p)).status===200,'approved auto publication serves its public media');
mode='lockerror';const leSent=await post('execute',le.s.id,{id:le.p.id,version:le.p.version});mode='ok';
check(leSent.data.status==='failed'&&(await refsOf(le.p.pngHash)).includes(le.p.id)&&(await mediaGet(le.p)).status===404,'failed publication stops public media even when the lock blocked reference cleanup');
await server.releaseLock('owner',foreignLock);

// exec-loop-11 (2): 연결 해제는 자격증명을 지우고 승인을 초안으로 되돌리며 감사 이벤트를 남긴다.
const disc=await setup('disc'),discDraft=await draft(disc),discApproved=await approve(disc,discDraft);
const discAuto=await post('save_publication',disc.id,{creativeId:disc.creative.id,scheduledAt:at(40),plannedCostKRW:0}),discAutoApproved=await approve(disc,discAuto.data);
const credential=await server.readRecord('owner','publisher_credential','oda');
check((await post('disconnect_buffer',disc.id,{version:credential.version-1})).status===409,'disconnect requires the displayed credential version');
const off=await post('disconnect_buffer',disc.id,{version:credential.version});
check(off.status===200&&off.data.connected===false&&off.data.invalidated>=1,'disconnect reports invalidated approvals');
check(!rows('publisher_credential').length,'credential record deleted');
const invalidated=await server.readRecord('owner','execution_publication',discDraft.id);
check(invalidated.status==='draft'&&!invalidated.approvedAt&&invalidated.version===discApproved.data.version+1,'approved publication returned to draft on disconnect');
check(rows('event').some(e=>e.message.includes('Buffer 연결 해제')&&e.actor?.id==='owner'),'disconnect audit event records actor');
check((await getState(disc.id)).publisher.connected===false,'state shows disconnected publisher');
check(discAutoApproved.status===200&&!(await refsOf(discAutoApproved.data.pngHash)).includes(discAutoApproved.data.id),'disconnect retires public media references of returned approvals');

// 화면 규칙(순수 함수): 승인 차단 사유, 단계 체크리스트, 예약 전후 자동 재조회.
const now=Date.parse('2098-01-01T00:00:00Z');
const emptyState={creatives:[{id:'c',current:false}],publications:[],limits:null,publisher:{connected:false},copies:[]};
const blockers=exec.approvalBlockers?.({campaign:{status:'review',startDate:'',endDate:''},publication:{status:'draft',scheduledAt:'2098-01-01T00:00:00Z',creativeId:'c',factRefs:[]},state:emptyState,factCount:0,rightsConfirmed:false})||[];
for(const label of ['한도 미설정','채널 미연결','사실 없음','기획 미승인','기간 밖','권리 확인 필요','사실 변경'])check(blockers.some(b=>b.startsWith(label)),'approval blocker '+label);
check(exec.approvalBlockers?.({campaign:campaignFixture('x'),publication:{status:'draft',scheduledAt:'2098-01-01T00:00:00Z',creativeId:'c',factRefs:[]},state:{...emptyState,creatives:[{id:'c',current:true}],limits:{version:1},publisher:{connected:true}},factCount:1,rightsConfirmed:true}).length===0,'no blockers when every condition holds');
// data-truth-4 (a): 예산 사유도 승인 버튼 옆에 보인다.
const readyState={...emptyState,creatives:[{id:'c',current:true}],publisher:{connected:true}},paidDraft={status:'draft',scheduledAt:'2098-01-01T00:00:00Z',creativeId:'c',factRefs:[],plannedCostKRW:100};
const unconfirmedBlockers=exec.approvalBlockers({campaign:campaignFixture('x',{budget:null,budgetConfirmedAt:undefined}),publication:paidDraft,state:{...readyState,limits:{version:1,maxPlannedCostKRW:0}},factCount:1,rightsConfirmed:true});
check(unconfirmedBlockers.length===1&&unconfirmedBlockers[0].startsWith('예산 미확정'),'paid publication under an unconfirmed budget shows its blocker');
check(exec.approvalBlockers({campaign:campaignFixture('x',{budget:500}),publication:{...paidDraft,plannedCostKRW:0},state:{...readyState,limits:{version:1,maxPlannedCostKRW:1000}},factCount:1,rightsConfirmed:true}).some(b=>b.startsWith('예산 초과')),'cost cap above the confirmed budget shows its blocker');
const steps=exec.publishSteps?.({...emptyState,creatives:[]},1)||[];
check(steps.map(x=>x.label).join('→')==='사실 확정→PNG→채널→한도→초안→승인→접수'&&steps.findIndex(x=>!x.done)===1,'publish checklist marks the current step');
check(JSON.stringify(exec.copyBlocks('## 게시 카피 3종과 용도·CTA\n\n### 안 1: 방문\n**훅**: 휘경동 한 판\n- 지금 들러 주세요\n\n### 안 2\n1. 포장도 됩니다\n## 총 15초 편집표\n0–3초 매장'))===JSON.stringify(['훅: 휘경동 한 판\n지금 들러 주세요','포장도 됩니다'])&&!exec.copyBlocks('## 전략\n\n게시 카피 아님').length,'copy candidates keep sub-headed copy variants and ignore other sections');
check(exec.autoRefreshDue?.({status:'accepted',providerId:'x',scheduledAt:new Date(now+30*60000).toISOString()},now)&&!exec.autoRefreshDue({status:'accepted',providerId:'x',scheduledAt:new Date(now+3*86400000).toISOString()},now)&&!exec.autoRefreshDue({status:'approved',providerId:'x',scheduledAt:new Date(now).toISOString()},now),'auto refresh only for accepted posts near the schedule');
// exec-loop-2: 승인 직후 화면이 공개 주소를 로그인 정보 없이 HEAD로 확인한다. 로그인 리디렉션·HTML·네트워크 오류는 접근 불가다.
let probeInit=null;
const probe=(response,url='https://app.test/media/x.png')=>exec.anonymousReachable?.(url,'https://app.test',async(_u,init)=>{probeInit=init;if(response instanceof Error)throw response;return response});
check(await probe(new Response(null,{headers:{'content-type':'image/png'}}))===true&&probeInit?.credentials==='omit'&&probeInit.method==='HEAD'&&probeInit.redirect==='manual','anonymous HEAD without credentials reaches public media');
check(await probe(new Response(null,{status:302,headers:{location:'/login'}}))===false&&await probe(new Response('<html>',{headers:{'content-type':'text/html'}}))===false&&await probe(new Error('offline'))===false,'login redirect, HTML page or network failure counts as unreachable');
probeInit=null;
check(await probe(new Error('not called'),'https://other.test/media/x.png')===true&&probeInit===null,'other-origin media is not probed from the browser');
// exec-loop-6 (4): 설정의 기능 표는 PNG 카드 제작과 Buffer 예약을 실제 상태로 안내한다.
const panelsSource=readFileSync('app/panels.tsx','utf8');
check(panelsSource.includes("['PNG 안내 카드','사용 가능']")&&panelsSource.includes("['Instagram 예약(Buffer)','Buffer 연결 시']")&&!panelsSource.includes("['광고 집행 · SNS 게시','연결 전']")&&!panelsSource.includes("['이미지 · 영상 렌더링','연결 전']"),'settings capability table reflects PNG cards and Buffer scheduling');
console.log(JSON.stringify({passed:checks-failures.length,failed:failures.length,failures,providerCalls:calls,evidence:'real SQLite; mocked Buffer, media HTTP and R2; genuine PNG fixture'}));
assert.deepEqual(failures,[]);
