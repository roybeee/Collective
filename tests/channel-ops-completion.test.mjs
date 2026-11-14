// 레인 C 채널 마감 3·4·5: 카카오 수신자 묶음 읽기(수·해시만)·추정 비용, 주문 장부 → 당근 전환 이벤트(대기열·사람 전송·멱등·unknown 비재전송·자율성),
// 광고 제안 주간 자동 생성(scheduled_runs+채널 스위치, 초안만, 읽기만, 주 1회), 워커 순환(스위치 켜질 때만 새 큐). 근거: mocked(메모리 SQLite, 로컬 인증 헤더, 당근·네이버 fetch 스텁). 외부 네트워크 0회.
import {readFileSync} from 'node:fs';
import {testRuntime} from './helpers/runtime.mjs';

let checks=0;const failures=[];function check(value,label){checks++;if(!value)failures.push(label)}
const DAANGN='https://ads-openapi.kr.karrotmarket.com',ACCT='acct1',base=`/v1/ad-accounts/${ACCT}`;
const log=[];let eventsFail=null;
const campaigns=[{id:'c1',name:'휘경 당근 캠페인',status:'ACTIVE',dailyBudget:50000},{id:'c2',name:'다른 캠페인',status:'ACTIVE',dailyBudget:30000}];
const adgroups=[{id:'g1',campaignId:'c1',name:'클릭 없는 그룹',status:'ACTIVE',dailyBudget:20000}];
const perf={c1:[{impressions:6000,clicks:60,spend:25000,conversions:1}],c2:[{impressions:100,clicks:5,spend:1000,conversions:0}],g1:[{impressions:2000,clicks:0,spend:0,conversions:0}]};
const stub=async(url,init={})=>{
 const u=new URL(String(url)),path=u.pathname,method=init.method||'GET',body=init.body?JSON.parse(init.body):undefined;
 log.push({host:u.origin,method,path,search:u.search,body});
 if(u.origin==='https://api.searchad.naver.com'){if(path==='/ncc/campaigns')return Response.json([{nccCampaignId:'cmp-1'}]);if(path==='/ncc/adgroups')return Response.json([]);return Response.json([])}
 if(u.origin!==DAANGN)throw new Error('외부 호출 금지: '+url);
 const list=rows=>Response.json({data:rows});
 if(path===`${base}/campaigns`)return list(campaigns);
 if(path===`${base}/ad-groups`)return list(adgroups.filter(g=>g.campaignId===u.searchParams.get('campaignId')));
 if(path===`${base}/reports/performance`){const ids=u.searchParams.get('ids').split(',');return list(ids.flatMap(id=>(perf[id]||[]).map(r=>({date:'2026-11-01',[u.searchParams.get('level')==='CAMPAIGN'?'campaignId':'adGroupId']:id,...r}))))}
 if(path===`${base}/conversion-events`){if(eventsFail)return eventsFail();return Response.json({accepted:body.events.length})}
 return new Response('{}',{status:404});
};
const {load}=testRuntime(stub);
const conv=await load('lib/daangn-conversions.ts'),convServer=await load('lib/daangn-conversions-server.ts'),daangn=await load('lib/connectors/daangn-ads.ts'),registry=await load('lib/connectors/registry.ts'),contract=await load('lib/connectors/contract-test.ts');
const core=await load('lib/server.ts'),flags=await load('lib/feature-flags.ts'),credentials=await load('lib/channel-credentials.ts'),autonomy=await load('lib/autonomy-server.ts'),auto=await load('lib/ads-proposals-auto-server.ts'),worker=await load('lib/research-worker.ts');
const segments=await load('lib/kakao/segments.ts'),kakaoRoute=await load('app/api/kakao/route.ts'),daangnRoute=await load('app/api/daangn-ads/route.ts'),agendaRoute=await load('app/api/agenda/route.ts');
const plain=v=>JSON.parse(JSON.stringify(v));
const owner='ops-owner',by={id:owner,email:null},who={owner,id:owner,email:null,role:'owner'};
const H={'content-type':'application/json','oai-authenticated-user-id':owner,origin:'https://app.test'};
const call=async(route,body)=>{const r=await route.POST(new Request('https://app.test/api/x',{method:'POST',headers:H,body:JSON.stringify(body)}));return {status:r.status,data:await r.json()}};
const read=async(route,query)=>{const r=await route.GET(new Request('https://app.test/api/x'+query,{headers:H}));return {status:r.status,data:await r.json()}};
const put=(kind,id,value,parent='')=>core.recordStatement(owner,kind,id,value,parent).run();
const kstToday=new Date(Date.now()+9*3600000).toISOString().slice(0,10),daysAgo=n=>new Date(Date.now()+9*3600000-n*86400000).toISOString().slice(0,10);

// ================= 1) 순수: 당근 전환 대상·이벤트 =================
{
 const o=(over)=>({id:'o',channel:'daangn',status:'paid',paidAmount:10000,refundAmount:0,orderDate:kstToday,...over});
 check(conv.conversionEligible(o({}),kstToday)&&!conv.conversionEligible(o({channel:'naver_place'}),kstToday)&&!conv.conversionEligible(o({status:'refunded',refundAmount:10000}),kstToday)&&!conv.conversionEligible(o({orderDate:daysAgo(40)}),kstToday)&&!conv.conversionEligible(o({paidAmount:1000,refundAmount:1000}),kstToday),'only paid Daangn-attributed orders with net revenue inside 30 days are eligible');
 const e=conv.conversionEvent(o({id:'ord-1',paidAmount:12000,refundAmount:2000,orderDate:'2026-11-10'}));
 check(e.eventId==='collective-order-ord-1'&&e.eventName==='purchase'&&e.value===10000&&e.currency==='KRW'&&e.eventTime==='2026-11-09T15:00:00.000Z'&&!('hashedUserId' in e)&&!('clickId' in e),'event: stable id from the order, net value, KST order date, no click id or user id');
 check(conv.sendable({status:'queued'})&&['sending','sent','failed','unknown'].every(s=>!conv.sendable({status:s})),'only queued rows can be sent');
}
// ================= 2) 계약 하네스 재실행: 당근 전환 이벤트(T4) =================
{
 const caps=registry.descriptorFor('daangn_ads').capabilities,events=[conv.conversionEvent({id:'k1',orderDate:'2026-11-10',paidAmount:1000,refundAmount:0})],requests=[];
 const factory=script=>{const calls={};const transport=async(request,op)=>{requests.push({id:op.id,...request});calls[op.id]=(calls[op.id]??0)+1;const steps=script[op.id]??[{kind:'thrown'}];return steps[Math.min(calls[op.id],steps.length)-1]};
  const inner=daangn.daangnContractConnector(caps,ACCT,transport);return {...inner,calls:()=>({...calls}),execute:(op,attempt)=>inner.execute({...op,payload:op.capability==='daangn_ads.conversion.send'?events:op.payload},attempt)}};
 const results=await contract.runContractScenarios(factory,{read:'daangn_ads.management.read',write:'daangn_ads.conversion.send'});
 for(const r of results)check(r.passed,`daangn conversion contract ${r.scenario}: ${r.details.join(' | ')}`);
 check(results.length===5&&requests.filter(q=>q.id.startsWith('w-')).every(q=>q.method==='POST'&&q.path===`${base}/conversion-events`&&q.body.events[0].eventId==='collective-order-k1'),'conversion writes went through the real events builder');
 check(registry.capabilityFor('daangn_ads.conversion.send').riskTier==='T4','conversion send stays T4 in the registry');
}
// ================= 3) 서버: 대기열·전송 =================
await core.seedBrands(owner);
await put('store','s1',{id:'s1',brandId:'ofd',name:'휘경점',status:'active',version:1},'ofd');
const order=(id,over)=>put('store_order',id,{id,storeId:'s1',source:'direct',orderNumber:id,orderDate:kstToday,mode:'hall',status:'paid',paidAmount:10000,refundAmount:0,costs:{},channel:'daangn',experimentId:'',attributionEvidence:'당근 쿠폰',note:'',version:1,createdAt:'2026-11-14T00:00:00.000Z',updatedAt:'2026-11-14T00:00:00.000Z',...over},'s1');
await order('o1',{});await order('o2',{paidAmount:5000,refundAmount:1000});await order('o3',{status:'refunded',refundAmount:10000});await order('o4',{channel:'naver_place'});await order('o5',{orderDate:daysAgo(40)});
const rows=()=>core.listRecords(owner,'daangn_conversion','s1').then(plain);
{
 check(await convServer.daangnConversionQueue(owner)===undefined,'flag off: no conversion queue for the worker');
 check(plain(await convServer.queueDaangnConversions(owner)).queued===0&&(await rows()).length===0,'flag off: queueing does nothing');
 await flags.setFeatureFlag(owner,{flag:'daangn_ads',enabled:true},by);
 const q=await convServer.daangnConversionQueue(owner);
 check(typeof q==='function'&&(await q(owner)).status==='idle'&&(await rows()).length===0,'flag on but no Daangn connection: idle, nothing queued');
 await credentials.saveExternalCredential(owner,'daangn_ads',{channel:'daangn_ads',apiKey:'dg-secret',adAccountId:ACCT,authHeader:'x-api-key'},ACCT,{brandId:'ofd',storeId:'s1'});
 const ran=await q(owner),list=await rows();
 check(ran.status==='processed'&&list.length===2&&list.map(r=>r.orderId).sort().join()==='o1,o2'&&list.every(r=>r.status==='queued'&&r.clickId===null),'eligible ledger orders are queued once per order');
 check(list.find(r=>r.orderId==='o2').event.value===4000&&!log.some(l=>l.path.endsWith('/conversion-events')),'queued events carry net value and nothing was sent by the worker');
 check((await q(owner)).status==='idle'&&(await rows()).length===2,'queueing again is idempotent');
}
{
 await flags.setFeatureFlag(owner,{flag:'autonomy_rules',enabled:true},by);
 check(plain(await autonomy.autonomyView(who)).actions.some(a=>a.action==='conversion_send'&&a.allowedModes.join()==='ask,never'),'with daangn_ads on the autonomy view lists conversion_send as ask/never only');
 await autonomy.saveAutonomySettings(who,{settings:{conversion_send:'never'}});
 let r=await call(daangnRoute,{action:'send_conversions',storeId:'s1'});
 check(r.status===403&&(await rows()).every(x=>x.status==='queued')&&!log.some(l=>l.path.endsWith('/conversion-events')),'autonomy never blocks sending with 403 and nothing leaves');
 const autoTry=await (async()=>{try{await autonomy.saveAutonomySettings(who,{settings:{conversion_send:'auto'}});return 'saved'}catch(e){return e.message}})();
 check(/자동으로 실행할 수 없습니다/.test(autoTry),'conversion_send cannot be set to auto (T4)');
 await autonomy.saveAutonomySettings(who,{settings:{conversion_send:'ask'}});
 r=await call(daangnRoute,{action:'send_conversions',storeId:'s1'});
 const sent=log.filter(l=>l.path.endsWith('/conversion-events'));
 check(r.status===200&&r.data.sent===2&&r.data.status==='sent'&&sent.length===1&&sent[0].body.events.length===2&&sent[0].body.events.every(e=>e.eventName==='purchase'&&!e.hashedUserId),'a person sends the queued rows as one batch: '+JSON.stringify(r.data));
 check((await rows()).every(x=>x.status==='sent'&&x.send.by===owner),'rows are marked sent with the sender');
 r=await call(daangnRoute,{action:'send_conversions',storeId:'s1'});
 check(r.status===200&&r.data.status==='nothing_queued'&&log.filter(l=>l.path.endsWith('/conversion-events')).length===1,'sending again sends nothing (idempotent per order)');
 // 결과 미확인: 5xx → unknown, 다시 보내지 않음, 사람이 확인으로 닫는다.
 await order('o6',{paidAmount:7000});await convServer.queueDaangnConversions(owner);
 eventsFail=()=>new Response('{}',{status:503});
 r=await call(daangnRoute,{action:'send_conversions',storeId:'s1'});
 const o6=(await rows()).find(x=>x.orderId==='o6');
 check(r.status===200&&r.data.status==='unknown'&&o6.status==='unknown','a 5xx after sending leaves the row unknown: '+JSON.stringify(r.data));
 const calls=log.filter(l=>l.path.endsWith('/conversion-events')).length;eventsFail=null;
 r=await call(daangnRoute,{action:'send_conversions',storeId:'s1'});
 check(r.data.status==='nothing_queued'&&log.filter(l=>l.path.endsWith('/conversion-events')).length===calls,'an unknown row is never resent');
 r=await call(daangnRoute,{action:'resolve_conversion',storeId:'s1',id:'o6',outcome:'sent'});
 check(r.status===200&&r.data.status==='sent','an unknown row is closed by a person after checking Daangn');
 const g=await read(daangnRoute,'?storeId=s1');
 check(g.status===200&&g.data.conversions.counts.sent===3&&g.data.conversions.clickId==='not_captured'&&!JSON.stringify(g.data).includes('dg-secret'),'GET shows conversion counts, the click id gap and no secret');
 await flags.setFeatureFlag(owner,{flag:'daangn_ads',enabled:false},by);
 r=await call(daangnRoute,{action:'send_conversions',storeId:'s1'});
 check(r.status===409,'flag off: sending is 409');
 await flags.setFeatureFlag(owner,{flag:'daangn_ads',enabled:true},by);
}
// ================= 4) 광고 제안 주간 자동 생성 =================
{
 check(auto.kstWeek(Date.UTC(2026,10,18,3))==='2026-11-16'&&auto.kstWeek(Date.UTC(2026,10,15,16))==='2026-11-16'&&auto.kstWeek(Date.UTC(2026,10,15,14))==='2026-11-09','KST week key is the Monday');
 check(await auto.adsProposalAutoQueue(owner)===undefined,'scheduled_runs off: no auto proposal queue even with daangn_ads on');
 await flags.setFeatureFlag(owner,{flag:'scheduled_runs',enabled:true},by);
 const q=await auto.adsProposalAutoQueue(owner);
 check(typeof q==='function'&&plain(await auto.autoChannels(owner)).join()==='daangn_ads','scheduled_runs + daangn_ads: the daangn channel is scheduled');
 const writesBefore=log.filter(l=>l.method!=='GET').length;
 const r=plain(await auto.runAdsProposalAuto(owner));
 const proposals=plain(await core.listRecords(owner,'ads_proposal'));
 check(r.status==='processed'&&r.runs.length===1&&r.runs[0].campaigns.join()==='c1,c2'&&r.runs[0].created===proposals.length&&proposals.length>0,'one run per connected account generates drafts for its campaigns: '+JSON.stringify(r.runs[0]));
 check(proposals.every(p=>p.status==='draft'&&p.channel==='daangn_ads'&&p.createdBy!==undefined?true:p.status==='draft')&&log.filter(l=>l.method!=='GET').length===writesBefore,'only drafts are created and only GET requests were made (no approve, no apply)');
 const again=plain(await auto.runAdsProposalAuto(owner));
 check(again.status==='idle'&&plain(await core.listRecords(owner,'ads_proposal')).length===proposals.length,'the same week does not run twice');
 const nextWeek=plain(await auto.runAdsProposalAuto(owner,Date.now()+7*86400000));
 check(nextWeek.runs.length===1&&nextWeek.runs[0].created===0,'the next week runs again and open proposals are not duplicated');
 const ag=await read(agendaRoute,'');
 const items=JSON.stringify(ag.data);
 check(ag.status===200&&/ads_proposal:/.test(items)&&/당근 광고 제안 승인 대기/.test(items),'draft proposals appear as decision items on the agenda');
 // 네이버: 스위치 naver_ads_write를 켜면 같은 큐가 네이버 계정도 돈다(캠페인 목록 GET).
 await credentials.saveCredential(owner,'naver_ads',{apiKey:'api-key',secretKey:'secret-key',customerId:'777'},{brandId:'ofd',storeId:'s1'});
 await flags.setFeatureFlag(owner,{flag:'naver_ads_write',enabled:true},by);
 const n=plain(await auto.runAdsProposalAuto(owner,Date.now()+14*86400000));
 const naverRun=n.runs.find(x=>x.channel==='naver_ads');
 check(!!naverRun&&naverRun.campaigns.join()==='cmp-1'&&log.some(l=>l.host==='https://api.searchad.naver.com'&&l.path==='/ncc/campaigns')&&!log.some(l=>l.host==='https://api.searchad.naver.com'&&l.method!=='GET'),'naver accounts run too, with reads only: '+JSON.stringify(n.runs));
 check(plain(await core.listRecords(owner,'ads_proposal_auto_run')).length===4,'each (channel, unit, week) leaves one run record');
}
// ================= 5) 워커 순환: 스위치가 켜졌을 때만 새 큐 =================
{
 const token=await worker.registerWorker(owner),principal={owner,hash:await worker.workerHash(token)};
 const idle=async()=>({status:'idle'});let conversions=0,proposals=0;
 const conversionQ=async()=>{conversions++;return {status:'processed'}},proposalQ=async()=>{proposals++;return {status:'processed'}};
 const tick=(c,p)=>worker.workerTick(principal,async()=>{throw Error('research forbidden')},idle,idle,undefined,undefined,undefined,undefined,undefined,undefined,undefined,undefined,undefined,undefined,c,p);
 const seen=new Set();for(let i=0;i<4;i++)seen.add((await tick(conversionQ,proposalQ)).queue);
 check(seen.has('daangn_conversion')&&seen.has('ads_proposal_auto')&&conversions>0&&proposals>0,'both new queues rotate when the route passes them: '+[...seen].join());
 const off=await tick(undefined,undefined);
 check(off.status==='idle'&&off.queue===undefined,'without them the rotation has no new queue names');
 await flags.setFeatureFlag(owner,{flag:'daangn_ads',enabled:false},by);await flags.setFeatureFlag(owner,{flag:'naver_ads_write',enabled:false},by);
 check(await convServer.daangnConversionQueue(owner)===undefined&&await auto.adsProposalAutoQueue(owner)===undefined,'with the flags off the route passes neither queue');
 const src=readFileSync('app/api/research-worker/route.ts','utf8');
 check(/daangnConversionQueue\(principal\.owner\)/.test(src)&&/adsProposalAutoQueue\(principal\.owner\)/.test(src),'the worker route builds both queues from the owner flags');
}
// ================= 6) 카카오 수신자 묶음(수·해시만)·추정 비용 =================
{
 const A='010-1111-2222',B='010-3333-4444',C='010-5555-6666',D='010-7777-8888',E='010-9999-0000';
 const csv=`phone,consentedAt,source,nightConsent\n${A},2026-10-01,form,false\n${B},2026-10-01,form,true\n${C},${new Date(Date.now()-23.5*30.44*86400000).toISOString().slice(0,10)},pos,false\n${D},2024-01-01,pos,false\n${E},2026-10-01,form,false`;
 let r=await call(kakaoRoute,{action:'consent_import',brandId:'oda',csv});
 check(r.status===200&&r.data.created===5,'consents imported: '+JSON.stringify(r.data));
 r=await call(kakaoRoute,{action:'optout',brandId:'oda',phone:E});
 const seg=async s=>(await read(kakaoRoute,`?brandId=oda&segment=${s}`));
 const active=await seg('active'),night=await seg('night'),renewal=await seg('renewal_due'),info=await seg('informational');
 check(active.status===200&&active.data.count===3&&active.data.counts.night===1&&night.data.count===1&&renewal.data.count===1&&info.data.count===4,'segments: active 3, night 1, renewal 1, informational 4 (opt-out excluded): '+JSON.stringify(active.data.counts));
 check(active.data.recipients.every(h=>/^[a-f0-9]{64}$/.test(h))&&!/0101111|1111-2222|01011112222/.test(JSON.stringify([active.data,night.data,info.data])),'segment responses carry hashes only, never numbers');
 check(active.data.unitKrw.brand===segments.ESTIMATED_UNIT_KRW.brand&&segments.estimateCost('brand',3).totalKrw===3*segments.ESTIMATED_UNIT_KRW.brand&&segments.estimateCost('alimtalk',2).assumed===true,'cost estimate uses the assumed unit price table');
 const bad=await seg('everyone');
 check(bad.status===400,'unknown segment is 400');
 const draft=await call(kakaoRoute,{action:'draft',brandId:'oda',type:'brand',text:'(광고) ODA\n신메뉴\n무료 수신거부 080-123-4567',senderName:'ODA',recipientHash:active.data.recipients[0]});
 check(draft.status===200&&draft.data.status==='draft'&&draft.data.recipientHash===active.data.recipients[0],'a draft can target a recipient picked by hash from a segment');
}
// 7) 문서: 하지 않는 일·가정이 적혀 있다.
{
 const dg=readFileSync('docs/DAANGN-ADS.ko.md','utf8'),kk=readFileSync('docs/KAKAO-BIZMESSAGE.ko.md','utf8'),ig=readFileSync('docs/INSTAGRAM-DIRECT.ko.md','utf8');
 check(/클릭 id/.test(dg)&&/conversion_send/.test(dg)&&/send_conversions/.test(dg),'DAANGN-ADS documents the click id gap, autonomy action and the send action');
 check(/segment=/.test(kk)&&/가정 단가/.test(kk),'KAKAO-BIZMESSAGE documents the segment read and assumed unit price');
 check(/reconcile_direct/.test(ig)&&/캐러셀/.test(ig)&&/mediaHashes/.test(ig),'INSTAGRAM-DIRECT documents carousel, reels and reconciliation');
}

if(failures.length){console.error(failures.join('\n'));process.exit(1)}
console.log(JSON.stringify({passed:checks}));
