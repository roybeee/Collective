// C4 네이버 검색광고 제안→승인→반영: 순수 규칙(고정 통계 → 기대 제안·등급), 상태 전이, 중복 제거, 14일 창,
// 서버·API(제안 생성(스위치 무관) → 스위치 꺼짐 승인 409 → 직원 403 → 자율성 never 403 → 승인 → 반영 → 읽기 대조 verified/mismatch → 타임아웃 unknown → 재전송 거부 → 대조로 판정).
// 근거: mocked(메모리 SQLite, 로컬 인증 헤더·세션 주입, 네이버 fetch 스텁). 외부 네트워크 0회.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {testRuntime} from './helpers/runtime.mjs';

const naver={adgroups:[{nccAdgroupId:'g1',name:'그룹1'}],keywords:{g1:[]},stats:{},keyword:{},fail:null,log:[]};
const route1=(url,init)=>{
 const u=new URL(url),path=u.pathname,method=init.method||'GET';naver.log.push({method,path,search:u.search,body:init.body?JSON.parse(init.body):undefined});
 if(naver.fail)return naver.fail(path,method);
 if(path==='/ncc/campaigns'&&method==='GET')return Response.json([{nccCampaignId:'cmp-1'}]);
 if(path==='/ncc/adgroups'&&method==='GET')return Response.json(naver.adgroups);
 if(path==='/ncc/keywords'&&method==='GET')return Response.json(naver.keywords[u.searchParams.get('nccAdgroupId')]||[]);
 if(path==='/stats')return Response.json(u.searchParams.getAll('ids').map(id=>({id,...(naver.stats[id]||{})})));
 if(path.startsWith('/ncc/keywords/')&&method==='GET')return Response.json(naver.keyword[path.slice('/ncc/keywords/'.length)]||{});
 if(path==='/ncc/keywords'&&method==='PUT'){const rows=JSON.parse(init.body);for(const r of rows)naver.keyword[r.nccKeywordId]={...(naver.keyword[r.nccKeywordId]||{}),nccKeywordId:r.nccKeywordId,...(r.bidAmt!==undefined?{bidAmt:r.bidAmt}:{}),...(r.userLock!==undefined?{userLock:r.userLock}:{})};return Response.json(rows.map(r=>naver.keyword[r.nccKeywordId]))}
 if(path==='/ncc/keywords'&&method==='POST'){const rows=JSON.parse(init.body).map((r,i)=>({nccKeywordId:'new-'+i,keyword:r.keyword}));naver.keywords[u.searchParams.get('nccAdgroupId')]=[...(naver.keywords[u.searchParams.get('nccAdgroupId')]||[]),...rows];return Response.json(rows)}
 return new Response('',{status:404});
};
const {sql,env,load}=testRuntime(async(url,init={})=>{if(!String(url).startsWith('https://api.searchad.naver.com/'))throw new Error('외부 호출 금지: '+url);return route1(String(url),init)});
const pure=await load('lib/ads-proposals.ts'),server=await load('lib/ads-proposals-server.ts'),flags=await load('lib/feature-flags.ts'),core=await load('lib/server.ts'),autonomy=await load('lib/autonomy-server.ts'),credentials=await load('lib/channel-credentials.ts'),route=await load('app/api/ads-proposals/route.ts'),kinds=await load('lib/record-kinds.ts'),status=await load('lib/feature-status.ts');
const passed=[];const check=(name,value)=>{assert.ok(value,name);passed.push(name)};
const plain=v=>JSON.parse(JSON.stringify(v));
const owner='ads-owner';

// 1) 순수 규칙: 고정 통계 → 기대 제안. 키워드마다 최대 1건, 우선순위 중지 > 인하 > 인상.
const window={from:'2026-10-26',to:'2026-11-08'};
const kw=(id,over)=>({keywordId:id,keyword:'kw-'+id,adgroupId:'g1',bidAmt:1000,userLock:false,impCnt:5000,clkCnt:50,salesAmt:30000,ccnt:5,convAmt:null,avgRnk:2.1,...over});
const fixture=[
 kw('k-zero',{clkCnt:0,salesAmt:0,ccnt:0}),                     // 노출 있고 클릭 0 → 중지(T2)
 kw('k-cpa',{salesAmt:90000,ccnt:5}),                           // CPA 18,000 > 목표 10,000×1.2 → 인하 10% (1000→900, T2)
 kw('k-rank',{avgRnk:4.5,clkCnt:20,salesAmt:20000,ccnt:4,convAmt:100000}),  // 순위 4.5, ROAS 5 ≥ 3 → 인상 10% (1000→1100, T2)
 kw('k-ok',{}),                                                  // 정상 → 없음
 kw('k-locked',{clkCnt:0,userLock:true}),                        // 이미 중지 → 없음
 kw('k-nobid',{bidAmt:null,salesAmt:90000,ccnt:5}),             // 입찰가 모름 → 없음
 kw('k-rank-bad',{avgRnk:4.5,clkCnt:20,salesAmt:90000,ccnt:5,convAmt:10000}),  // 순위 낮지만 비효율(CPA 18,000, ROAS 0.1) → CPA 규칙 인하
];
let seq=0;const ctx={now:'2026-11-09T00:00:00.000Z',by:'admin-1',id:()=>'p'+(++seq)};
const proposals=plain(pure.proposeFromStats({campaignId:'cmp-1',storeId:'s1',brandId:'ofd',window,keywords:fixture,targets:{targetCpa:10000,targetRoas:null}},ctx));
check('fixture stats produce exactly the expected proposals in input order',proposals.map(p=>`${p.target.ids[0]}:${p.kind}:${p.rationale.evidence.ruleId}`).join()==='k-zero:pause:zero_clicks_14d,k-cpa:bid:cpa_above_target,k-rank:bid:rank_low_efficient,k-rank-bad:bid:cpa_above_target');
check('bid proposals carry before/after diff, write operation and T2 for ±10%',proposals[1].diff.before.bidAmt===1000&&proposals[1].diff.after.bidAmt===900&&proposals[1].operation.op==='update_bid'&&proposals[1].operation.bidAmt===900&&proposals[1].riskTier==='T2'&&proposals[2].operation.bidAmt===1100&&proposals[2].riskTier==='T2');
check('pause proposal is a keyword userLock write at T2',proposals[0].operation.op==='set_user_lock'&&proposals[0].operation.userLock===true&&proposals[0].riskTier==='T2'&&proposals[0].diff.after.userLock===true);
check('every proposal is a draft labelled as estimated, rule based, no auto apply, with the stats window and metrics as evidence',proposals.every(p=>p.status==='draft'&&p.label==='추정·규칙 기반, 자동 적용 없음'&&/자동 적용 없음/.test(p.rationale.text)&&p.rationale.evidence.window.from==='2026-10-26'&&typeof p.rationale.evidence.metrics.cpa!=='undefined'&&Array.isArray(p.rationale.evidence.learningRuleIds)&&p.channel==='naver_ads'&&p.storeId==='s1'));
check('rationale cites the numbers in Korean',/18,000원.*10,000원.*120%/.test(proposals[1].rationale.text)&&/4\.5위.*ROAS 5\.00/.test(proposals[2].rationale.text)&&/노출 5,000회에 클릭 0회/.test(proposals[0].rationale.text));
check('without a CPA target the rank rule still fires on ROAS and the CPA rule stays silent',plain(pure.proposeFromStats({campaignId:'c',window,keywords:[kw('a',{salesAmt:90000}),kw('b',{avgRnk:5,clkCnt:30,convAmt:200000})],targets:{}},ctx)).map(p=>p.rationale.evidence.ruleId).join()==='rank_low_efficient');
check('risk tier: ≤20% bid change T2, >20% or new spend T3, pause T2',pure.riskTierFor('bid',1000,1200)==='T2'&&pure.riskTierFor('bid',1000,1210)==='T3'&&pure.riskTierFor('bid',1000,790)==='T3'&&pure.riskTierFor('create_keywords')==='T3'&&pure.riskTierFor('resume')==='T3'&&pure.riskTierFor('pause')==='T2'&&pure.riskTierFor('bid',null,900)==='T3');
check('roundBid snaps to 10 won inside 70~100,000',pure.roundBid(94.9)===90&&pure.roundBid(10)===70&&pure.roundBid(10**7)===100000&&pure.roundBid(1105)===1110);
// 상태 전이
const t=(p,to)=>pure.transitionProposal(p,to,'admin-1','2026-11-09T01:00:00.000Z');
const approved=t(proposals[1],'approved');
check('draft→approved records approver and history; proposals are not mutated',approved.status==='approved'&&approved.approvedBy==='admin-1'&&approved.history.length===2&&proposals[1].status==='draft');
check('allowed path approved→applied→verified and approved→unknown→failed',t(t(approved,'applied'),'verified').status==='verified'&&t(t(approved,'unknown'),'failed').status==='failed'&&t(t(approved,'unknown'),'applied').status==='applied');
const refuse=(p,to)=>{try{t(p,to);return null}catch(e){return e.message}};
check('illegal transitions are refused in Korean',/제안 상태에서는 반영됨/.test(refuse(proposals[1],'applied'))&&/승인됨 상태에서는 제안/.test(refuse(approved,'draft'))&&/반려 상태/.test(refuse(t(proposals[1],'rejected'),'approved'))&&/반영 확인 상태/.test(refuse(t(t(approved,'applied'),'verified'),'applied')));
check('dedupe skips the same target+rule while a proposal is open, not after it closed',pure.dedupeAgainst([approved],proposals).length===proposals.length-1&&pure.dedupeAgainst([t(proposals[1],'rejected')],proposals).length===proposals.length);
const nowMs=Date.UTC(2026,10,9,12,0,0),day=86400000;
check('the 14-day window ends yesterday (UTC) and starts 13 days earlier',JSON.stringify(pure.statsWindow(nowMs))===JSON.stringify({from:new Date(Date.UTC(2026,10,8)-13*day).toISOString().slice(0,10),to:new Date(Date.UTC(2026,10,8)).toISOString().slice(0,10)}));
check('manual proposal: create_keywords is T3 and kind/operation mismatch is refused',plain(pure.manualProposal({campaignId:'c',kind:'create_keywords',operation:{op:'create_keywords',adgroupId:'g1',keywords:[{keyword:'a'}]},rationale:'신메뉴'},ctx)).riskTier==='T3'&&(()=>{try{pure.manualProposal({campaignId:'c',kind:'create_campaign',operation:{op:'update_bid',keywordIds:['k'],bidAmt:100},rationale:'x'},ctx);return false}catch(e){return /맞지 않습니다/.test(e.message)}})());
check('record kind ads_proposal is store-scoped and outside campaign deletion; feature row exists',(()=>{const k=plain(kinds.recordKinds).find(k=>k.kind==='ads_proposal');const row=status.featureRows({flags:[{flag:'naver_ads_write',enabled:false}]}).find(r=>r.key==='naver-ads-write');return k&&k.parent==='store'&&k.campaignDeletion==='not_campaign_scoped'&&row&&row.status==='blocked'&&row.flag==='naver_ads_write'&&status.featureRows({flags:[{flag:'naver_ads_write',enabled:true}]}).find(r=>r.key==='naver-ads-write').status==='available'})());

// 2) 서버: 자격증명(지점 단위)·지점 준비. 제안 생성은 스위치와 무관하다.
await core.seedBrands(owner);
await core.recordStatement(owner,'store',{id:'s1'}.id,{id:'s1',brandId:'ofd',name:'휘경점',status:'active',version:1},'ofd').run();
await credentials.saveCredential(owner,'naver_ads',{apiKey:'api-key',secretKey:'secret-key',customerId:'777'},{brandId:'ofd',storeId:'s1'});
naver.keywords.g1=fixture.map(k=>({nccKeywordId:k.keywordId,keyword:k.keyword,bidAmt:k.bidAmt,userLock:k.userLock}));
for(const k of fixture){naver.stats[k.keywordId]={impCnt:k.impCnt,clkCnt:k.clkCnt,salesAmt:k.salesAmt,ccnt:k.ccnt,convAmt:k.convAmt,avgRnk:k.avgRnk};naver.keyword[k.keywordId]={nccKeywordId:k.keywordId,bidAmt:k.bidAmt,userLock:k.userLock}}
const who={owner,id:'owner-account',email:null,role:'owner'};
naver.log.length=0;
let gen=plain(await server.generateProposals(who,{campaignId:'cmp-1',storeId:'s1',targetCpa:10000},nowMs));
check('generate reads adgroups → keywords → stats(ids batch, 14-day window) and stores the rule proposals',gen.created.length===4&&gen.keywords===7&&gen.skipped===0&&naver.log.map(l=>l.method+' '+l.path).join()==='GET /ncc/adgroups,GET /ncc/keywords,GET /stats'&&naver.log[2].search.includes('ids=k-zero')&&decodeURIComponent(naver.log[2].search).includes('"since":"2026-10-26","until":"2026-11-08"')&&gen.window.to==='2026-11-08');
check('generate only used GET (no write while the switch is off)',naver.log.every(l=>l.method==='GET'));
gen=plain(await server.generateProposals(who,{campaignId:'cmp-1',storeId:'s1',targetCpa:10000},nowMs));
check('a second generate skips the open duplicates',gen.created.length===0&&gen.skipped===4);
let list=plain(await server.listProposals(owner,{campaignId:'cmp-1'}));
check('proposals are stored under the store with parent_id and listed by campaign',list.length===4&&sql.prepare("SELECT COUNT(*) AS n FROM records WHERE owner=? AND kind='ads_proposal' AND parent_id='s1'").get(owner).n===4);
check('a store of another brand is refused and an unknown store is 404',await server.generateProposals(who,{campaignId:'cmp-1',storeId:'s1',brandId:'oda'}).then(()=>false,e=>e.status===400)&&await server.generateProposals(who,{campaignId:'cmp-1',storeId:'nope'}).then(()=>false,e=>e.status===404));
check('a bad target is a 400',await server.generateProposals(who,{campaignId:'cmp-1',storeId:'s1',targetCpa:-1}).then(()=>false,e=>e.status===400));
const byKeyword=id=>list.find(p=>p.target.ids[0]===id);
const bidP=byKeyword('k-cpa'),pauseP=byKeyword('k-zero'),raiseP=byKeyword('k-rank'),otherP=byKeyword('k-rank-bad');

// 3) 스위치 꺼짐: 승인·반영은 409 '쓰기 스위치 꺼짐'. 반려·대조는 된다.
check('approve with the switch off is a 409 "쓰기 스위치 꺼짐"',await server.approveProposal(who,{id:bidP.id}).then(()=>false,e=>e.status===409&&/쓰기 스위치 꺼짐/.test(e.message)));
check('apply with the switch off is a 409',await server.applyProposal(who,{id:bidP.id}).then(()=>false,e=>e.status===409&&/쓰기 스위치 꺼짐/.test(e.message)));
check('reject works with the switch off',plain(await server.rejectProposal(who,{id:otherP.id,note:'비효율 키워드는 따로 본다'})).status==='rejected');
await flags.setFeatureFlag(owner,{flag:'naver_ads_write',enabled:true},{id:'owner-account',email:null});

// 4) 권한·자율성: 직원 403, budget_change never → 403, ask → 승인.
check('a member cannot approve (403)',await server.approveProposal({...who,role:'member'},{id:bidP.id}).then(()=>false,e=>e.status===403));
await flags.setFeatureFlag(owner,{flag:'autonomy_rules',enabled:true},{id:'owner-account',email:null});
await autonomy.saveAutonomySettings(who,{settings:{budget_change:'never'}});
check('budget_change never blocks approval with a Korean 403',await server.approveProposal(who,{id:bidP.id}).then(()=>false,e=>e.status===403&&/예산 변경.*금지되어/.test(e.message)));
await autonomy.saveAutonomySettings(who,{settings:{budget_change:'ask'}});
let a=plain(await server.approveProposal(who,{id:bidP.id}));
check('ask proceeds: approved with approver and autonomy mode ask',a.proposal.status==='approved'&&a.proposal.approvedBy==='owner-account'&&a.autonomy==='ask');
check('approving twice is refused (400 illegal transition)',await server.approveProposal(who,{id:bidP.id}).then(()=>false,e=>e.status===400&&/승인됨 상태에서는/.test(e.message)));
check('applying a draft is a 409',await server.applyProposal(who,{id:pauseP.id}).then(()=>false,e=>e.status===409&&/승인된 제안만/.test(e.message)));

// 5) 반영 → 읽기 대조 verified. 저널은 보내기 전에 sent로 저장된다.
naver.log.length=0;
const fast={now:()=>Date.now(),random:()=>0.5,sleep:async()=>undefined};
let applied=plain(await server.applyProposal(who,{id:bidP.id},fast));
check('apply sends one PUT /ncc/keywords?fields=bidAmt then reads the keyword back and marks verified',applied.status==='verified'&&applied.write.state==='done'&&applied.write.attempts===1&&applied.write.providerIds.join()==='k-cpa'&&applied.verification.status==='verified'&&naver.log.map(l=>l.method+' '+l.path).join()==='PUT /ncc/keywords,GET /ncc/keywords/k-cpa'&&naver.log[0].body[0].bidAmt===900&&naver.keyword['k-cpa'].bidAmt===900);
check('history records approved→applied→verified',applied.history.map(h=>h.to).join()==='draft,approved,applied,verified'&&applied.appliedAt);
check('applying an already sent proposal is refused (no resend)',await server.applyProposal(who,{id:bidP.id}).then(()=>false,e=>e.status===409));
// mismatch: 공급자가 200을 주지만 읽기 대조 값이 다르다.
await server.approveProposal(who,{id:raiseP.id});
const realRoute=route1;
naver.fail=(path,method)=>{if(path==='/ncc/keywords'&&method==='PUT')return Response.json([{nccKeywordId:'k-rank',bidAmt:1100}]);if(path==='/ncc/keywords/k-rank')return Response.json({nccKeywordId:'k-rank',bidAmt:1000});return null};
const failWrap=naver.fail;naver.fail=(p,m)=>failWrap(p,m)||realRoute(new URL('https://api.searchad.naver.com'+p).toString(),{method:m});
applied=plain(await server.applyProposal(who,{id:raiseP.id},fast));
naver.fail=null;
check('read-back that differs from the expected bid is a mismatch with details',applied.status==='mismatch'&&applied.write.state==='done'&&applied.verification.status==='mismatch'&&/1000 ≠ 기대 1100/.test(applied.verification.details[0]));

// 6) 타임아웃 → unknown(재시도 없음) → 재전송 거부 → 대조(reconcile)로 판정.
await server.approveProposal(who,{id:pauseP.id});
let sends=0;naver.fail=(path,method)=>{if(method==='PUT'){sends++;const e=new Error('t');e.name='TimeoutError';throw e}return null};
const wrap2=naver.fail;naver.fail=(p,m)=>wrap2(p,m)||realRoute('https://api.searchad.naver.com'+p,{method:m});
let unknown=plain(await server.applyProposal(who,{id:pauseP.id},fast));
naver.fail=null;
check('a timeout after sending leaves the proposal unknown after one send with the journal sent before',unknown.status==='unknown'&&unknown.write.state==='unknown'&&unknown.write.attempts===1&&sends===1&&/읽기 대조/.test(unknown.write.error));
check('unknown proposals are never resent',await server.applyProposal(who,{id:pauseP.id}).then(()=>false,e=>e.status===409&&/다시 보내지 않습니다/.test(e.message))&&sends===1);
// 대조: 공급자에 반영되지 않았다(userLock false) → failed.
let rec=plain(await server.reconcileProposal(who,{id:pauseP.id}));
check('reconcile reads back; a state that still matches "before" is failed (not applied)',rec.status==='failed'&&rec.write.state==='failed'&&rec.verification.status==='mismatch'&&/반영되지 않음/.test(rec.history.at(-1).note));
// 대조: 반영돼 있었다 → applied→verified. 다른 unknown 제안을 만들어 확인한다.
naver.stats['k-two']={impCnt:100,clkCnt:0,salesAmt:0,ccnt:0};naver.keywords.g1.push({nccKeywordId:'k-two',keyword:'kw-two',bidAmt:500,userLock:false});naver.keyword['k-two']={nccKeywordId:'k-two',bidAmt:500,userLock:false};
gen=plain(await server.generateProposals(who,{campaignId:'cmp-1',storeId:'s1',targetCpa:10000},nowMs));
const twoP=gen.created.find(p=>p.target.ids[0]==='k-two');
await server.approveProposal(who,{id:twoP.id});
naver.fail=(p,m)=>{if(m==='PUT'){naver.keyword['k-two'].userLock=true;const e=new Error('t');e.name='TimeoutError';throw e}return realRoute('https://api.searchad.naver.com'+p,{method:m})};
unknown=plain(await server.applyProposal(who,{id:twoP.id},fast));naver.fail=null;
rec=plain(await server.reconcileProposal(who,{id:twoP.id}));
check('reconcile that finds the expected state marks applied then verified without resending',unknown.status==='unknown'&&rec.status==='verified'&&rec.write.state==='done'&&rec.history.map(h=>h.to).join()==='draft,approved,unknown,applied,verified');
check('reconcile on a non-unknown proposal is a 409',await server.reconcileProposal(who,{id:bidP.id}).then(()=>false,e=>e.status===409));
// 스위치가 꺼져도 대조는 된다(미확인 결정은 읽기만).
await flags.setFeatureFlag(owner,{flag:'naver_ads_write',enabled:false},{id:'owner-account',email:null});
check('reconcile still refuses a verified proposal with 409 while the switch is off (read-only path is reachable)',await server.reconcileProposal(who,{id:twoP.id}).then(()=>false,e=>e.status===409&&!/스위치/.test(e.message)));
await flags.setFeatureFlag(owner,{flag:'naver_ads_write',enabled:true},{id:'owner-account',email:null});

// 7) 직접 작성 제안(create_keywords, T3): 검증은 반영과 같은 빌더를 지난다.
const manual=plain(await server.createManualProposal(who,{kind:'create_keywords',campaignId:'cmp-1',storeId:'s1',rationale:'신메뉴 키워드 추가',operation:{op:'create_keywords',adgroupId:'g1',keywords:[{keyword:'휘경동 신메뉴',bidAmt:200}]}}));
check('manual create_keywords proposal is a T3 draft with the keywords as target names',manual.riskTier==='T3'&&manual.status==='draft'&&manual.target.names.join()==='휘경동 신메뉴'&&manual.kind==='create_keywords');
check('manual proposal with an invalid bid is a 400 before saving',await server.createManualProposal(who,{kind:'create_keywords',campaignId:'cmp-1',storeId:'s1',rationale:'x',operation:{op:'create_keywords',adgroupId:'g1',keywords:[{keyword:'a',bidAmt:65}]}}).then(()=>false,e=>e.status===400&&/70~100,000/.test(e.message)));
check('manual proposal of an unsupported kind is a 400',await server.createManualProposal(who,{kind:'bid',campaignId:'cmp-1',rationale:'x',operation:{}}).then(()=>false,e=>e.status===400));
await server.approveProposal(who,{id:manual.id});
naver.log.length=0;
applied=plain(await server.applyProposal(who,{id:manual.id},fast));
check('applying create_keywords POSTs /ncc/keywords?nccAdgroupId= then verifies the keywords exist in the adgroup',applied.status==='verified'&&applied.write.providerIds.join()==='new-0'&&naver.log.map(l=>l.method+' '+l.path+l.search).join()==='POST /ncc/keywords?nccAdgroupId=g1,GET /ncc/keywords?nccAdgroupId=g1');

// 8) HTTP: 읽기·쓰기 모두 소유자·관리자. 직원 403, 비로그인 401, 다른 출처 403, 모르는 작업 400. 응답은 목록·스위치·안내를 싣는다.
const call=async res=>({status:res.status,body:await res.json()});
const legacy={'oai-authenticated-user-id':owner,origin:'https://agency.test'};
const get=(query,headers=legacy)=>route.GET(new Request('https://agency.test/api/ads-proposals'+query,{headers})).then(call);
const post=(input,headers=legacy)=>route.POST(new Request('https://agency.test/api/ads-proposals',{method:'POST',headers:{'content-type':'application/json',...headers},body:JSON.stringify(input)})).then(call);
let r=await get('?campaignId=cmp-1');
check('GET lists proposals for the campaign with the switch state, label and notice',r.status===200&&r.body.proposals.length>=6&&r.body.enabled===true&&r.body.canApprove===true&&r.body.label==='추정·규칙 기반, 자동 적용 없음'&&/자동 입찰은 없습니다/.test(r.body.notice));
check('GET by store filters',(await get('?storeId=s1')).body.proposals.every(p=>p.storeId==='s1')&&(await get('?storeId=none')).body.proposals.length===0);
r=await post({action:'generate',campaignId:'cmp-1',storeId:'s1',targetCpa:10000});
check('POST generate returns created/skipped and the refreshed list',r.status===200&&typeof r.body.skipped==='number'&&Array.isArray(r.body.proposals));
r=await post({action:'approve',id:'missing'});
check('approving a missing proposal is a 404',r.status===404);
r=await post({action:'dance'});
check('an unknown action is a 400',r.status===400&&/generate/.test(r.body.error));
r=await post({action:'generate',campaignId:'cmp-1'},{...legacy,origin:'https://evil.test'});
check('cross-origin write is a 403',r.status===403);
check('unauthenticated read is a 401',(await get('?campaignId=cmp-1',{})).status===401);
env.AUTH_MODE='email';env.AUTH_ORIGIN='https://agency.test';
const signIn=(id,role)=>{const token=createHash('sha256').update(id).digest('hex');sql.prepare('INSERT INTO auth_users(id,email,workspace_owner,role,status,created_at) VALUES(?,?,?,?,?,?)').run(id,id+'@test.invalid',owner,role,'active',1000);sql.prepare('INSERT INTO auth_sessions VALUES(?,?,?,?)').run(createHash('sha256').update(token).digest('hex'),id,Date.now()+60000,Date.now());return {cookie:'__Host-collective_session='+token,origin:'https://agency.test'}};
const adminS=signIn('ws-admin','admin'),memberS=signIn('ws-member','member');
check('member GET and POST are 403',(await get('?campaignId=cmp-1',memberS)).status===403&&(await post({action:'reject',id:pauseP.id},memberS)).status===403);
r=await get('?campaignId=cmp-1',adminS);
check('admin reads the list over HTTP',r.status===200&&r.body.canApprove===true);
await flags.setFeatureFlag(owner,{flag:'naver_ads_write',enabled:false},{id:'owner-account',email:null});
gen=plain(await server.generateProposals(who,{campaignId:'cmp-1',storeId:'s1',targetCpa:10000,targetRoas:null},nowMs));
r=await post({action:'approve',id:(await server.listProposals(owner,{campaignId:'cmp-1'})).find(p=>p.status==='draft').id},adminS);
check('admin approve over HTTP with the switch off is a 409 "쓰기 스위치 꺼짐"',r.status===409&&/쓰기 스위치 꺼짐/.test(r.body.error));
check('no secret ever reached a proposal record',!JSON.stringify(plain(await server.listProposals(owner))).includes('secret-key'));

console.log(JSON.stringify({passed:passed.length,checks:passed},null,2));
