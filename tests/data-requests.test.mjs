// 자료 요청(A6-1): 저장된 작업물의 '자료 필요' 표지를 결정론으로 뽑아 data_request(열림)로 만들고, 관리자가 같은 항목의 사실을 확정해 유효 사실이 되면 자동으로 닫는다.
// 기능 스위치 a6_data_requests(기본 꺼짐)가 꺼져 있으면 새 쓰기는 409이고 /api/brand-facts POST 응답은 바이트 동일하다(closedRequests 키 없음).
// 근거: mocked(메모리 SQLite, 합성 브랜드·지점·캠페인·작업물, 로컬 세션 쿠키 주입, fetch 스텁). 모델·외부 호출은 0회다.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {testRuntime} from './helpers/runtime.mjs';

const external=[];let failDataRequestWrites=false;
const {sql,env,load}=testRuntime(async url=>{external.push(String(url));throw new Error('외부 호출 금지: '+url)},{
 // 사실 저장 뒤 요청 닫기 실패를 흉내 낸다(data_request 쓰기만 실패).
 beforeRun(statement){if(failDataRequestWrites&&statement.values[2]==='data_request')throw new Error('simulated data_request write failure')},
});
const server=await load('lib/server.ts'),dr=await load('lib/data-requests.ts'),flags=await load('lib/feature-flags.ts'),registry=await load('lib/record-kinds.ts');
const route=await load('app/api/data-requests/route.ts'),factsRoute=await load('app/api/brand-facts/route.ts'),summary=await load('lib/deletion-summary.ts'),status=await load('lib/feature-status.ts');
const passed=[];
const check=(name,fn)=>{fn();passed.push(name)};
const plain=v=>JSON.parse(JSON.stringify(v));
const owner='dr-owner',brandId='dr-brand',storeId='dr-s1',now=new Date().toISOString();
const iso=ms=>new Date(Date.now()+ms).toISOString(),day=86400000;

// 합성 데이터. 실제 고객·매장 정보가 아니다.
const MARKED=['## 게시 카피','퇴근길 떡볶이 한 컵 [가격 확인 필요]','오픈 할인 [확인 필요]로 알린다.','대표 메뉴는 인기 1위라고 쓰지 않는다 [자료 필요: 점주/대표 메뉴]',
 '영업 안내 [자료 필요: 점주/영업시간] [자료 필요: 점장/주차, 휴무일]','자료 필요: 매장 담당/전화번호','주장 표시는 [자료 필요: 확인 담당/항목] 형식이다.','[가설: 평일 오후 수요 확인 필요]',
 '[판매 조건(배송·교환·환불) 확인 필요]','## 자료 필요','- 좌석 수: 점장 확인','- 실제 고객 후기','## 다음 단계','- 섹션 밖 목록'].join('\n');
const pack=(needs)=>({version:'copy-pack-v2',channels:[{channel:'Instagram 피드',purpose:'첫 방문',destination:'플레이스',variants:[{id:'A',angle:'a',hook:'h',body:'b',cta:'c',needsCheck:needs},{id:'B',angle:'b',hook:'h2',body:'b2',cta:'c2'}]}],shortform:null,experiments:[]});
const artifact=(id,campaignId,over={})=>({id,campaignId,role:'content',title:'콘텐츠',content:'## 게시 카피\n본문',status:'review',version:1,origin:'ai',createdAt:now,campaignVersion:1,...over});
const put=(kind,id,data,parent='')=>server.recordStatement(owner,kind,id,data,parent).run();
const campaign=(id,extra={})=>({id,brandId,title:'가상분식 '+id,goal:'첫 방문',audience:'주민(가설)',channels:'Instagram',stores:'',products:'떡볶이',budget:null,startDate:'',endDate:'',constraints:'',sources:'',status:'draft',version:1,createdAt:now,updatedAt:now,...extra});
await put('brand',brandId,{id:brandId,name:'가상분식',short:'GB',category:'SNACK',color:'#224466',bg:'#eef2f6',description:'합성',audience:'',tone:'',constraints:'',knowledge:''});
await put('store',storeId,{id:storeId,brandId,name:'가상 1호점',status:'active',version:1},brandId);
await put('campaign','dr-c1',campaign('dr-c1',{storeId}));
await put('campaign','dr-c2',campaign('dr-c2'));
await put('artifact','a-marked',artifact('a-marked','dr-c1',{content:MARKED,version:2,copyPack:pack(['가격','배달 여부']),copyPackArtifactVersion:2}),'dr-c1');
await put('artifact','a-oldpack',artifact('a-oldpack','dr-c1',{version:3,copyPack:pack(['공식 계정']),copyPackArtifactVersion:1}),'dr-c1');
await put('artifact','a-outdated',artifact('a-outdated','dr-c1',{status:'outdated',content:'[자료 필요: 점주/오픈일]'}),'dr-c1');
await put('artifact','a-oldbrief',artifact('a-oldbrief','dr-c1',{campaignVersion:0.5,content:'[자료 필요: 점주/조리 방식]'}),'dr-c1');
await put('artifact','a-c2',artifact('a-c2','dr-c2',{content:'[자료 필요: 점주/휴무일]\n[자료 필요: 본사/프로모션]\n[자료 필요: 본사/대표 메뉴]'}),'dr-c2');

const headers={'oai-authenticated-user-id':owner};
const post=async(input,h=headers)=>{const r=await route.POST(new Request('https://agency.test/api/data-requests',{method:'POST',headers:{'content-type':'application/json',...h},body:JSON.stringify(input)}));return {status:r.status,body:await r.json()}};
const get=async(query,h=headers)=>{const r=await route.GET(new Request('https://agency.test/api/data-requests?'+query,{headers:h}));return {status:r.status,body:await r.json()}};
const factPost=async(input,h=headers)=>{const r=await factsRoute.POST(new Request('https://agency.test/api/brand-facts',{method:'POST',headers:{'content-type':'application/json',...h},body:JSON.stringify(input)}));const text=await r.text();return {status:r.status,text,body:JSON.parse(text)}};
const confirmFact=(key,value,extra={},h=headers)=>factPost({action:'save_fact',confirmed:true,data:{brandId,key,value,status:'confirmed',source:'점주 확인(합성)',verifiedAt:iso(-day),validUntil:iso(30*day),...extra}},h);
const setFlag=enabled=>flags.setFeatureFlag(owner,{flag:'a6_data_requests',enabled},{id:owner,email:null});
const requests=()=>sql.prepare("SELECT data FROM records WHERE owner=? AND kind='data_request'").all(owner).map(r=>JSON.parse(r.data));
const byKey=(campaignId,key)=>requests().find(r=>r.campaignId===campaignId&&r.factKey===key);

// ── 1) 표지 추출과 항목 매핑 ──
const markers=plain(dr.extractMarkers(MARKED));
const mapped=markers.map(m=>[m.item,dr.factKeyOf(m.item),m.assignee??null]);
check('extracts itemized [자료 필요: 담당/항목] markers and maps catalog labels to fact keys',()=>{
 assert.deepEqual(mapped,[['가격','menu_price',null],['영업시간','hours','점주'],['주차','parking','점장'],['휴무일','closed_days','점장'],['전화번호','phone','매장 담당'],['판매 조건(배송·교환·환불)',null,null],['좌석 수','seating',null],['실제 고객 후기',null,null]]);
 assert.equal(dr.requestLabel('좌석 수','seating'),'좌석');assert.equal(dr.factKeyOf('매장 영업시간 확인'),'hours');assert.equal(dr.factKeyOf('주소 전화번호'),null);assert.equal(dr.factKeyOf('포장 용기 규격'),null);
});
// ── 2) 카피 팩 needsCheck ──
check('reads copyPack needsCheck only when copyPackArtifactVersion equals the artifact version',()=>{
 const same=plain(dr.extractCopyPackNeeds({version:2,copyPack:pack(['가격','배달 여부']),copyPackArtifactVersion:2}));
 assert.deepEqual(same.map(n=>[n.item,dr.factKeyOf(n.item),n.channel,n.variantId]),[['가격','menu_price','Instagram 피드','A'],['배달 여부','delivery','Instagram 피드','A']]);
 assert.deepEqual(plain(dr.extractCopyPackNeeds({version:3,copyPack:pack(['공식 계정']),copyPackArtifactVersion:1})),[]);
 assert.deepEqual(plain(dr.extractCopyPackNeeds({version:1,copyPack:{channels:'x'},copyPackArtifactVersion:1})),[]);
 assert.deepEqual(plain(dr.extractCopyPackNeeds({version:1})),[]);
});
// ── 3) 맨 [확인 필요]·금지 문장·지시 틀은 뽑지 않는다 ──
check('ignores bare [확인 필요] claim flags and prohibition lines',()=>{
 const items=markers.map(m=>m.item);
 assert.ok(!items.includes('대표 메뉴')&&!items.includes('항목')&&!items.some(i=>/가설|할인|섹션 밖/.test(i)),JSON.stringify(items));
 assert.deepEqual(plain(dr.extractMarkers('오픈 할인 [확인 필요]\n[확인 필요] 인기 메뉴\n[가격 확인 필요]는 쓰지 않는다')),[]);
});

// ── 10a) 스위치 꺼짐: 쓰기 409, 사실 저장 응답은 바이트 동일 ──
const offWrites=[];for(const i of [{action:'collect',campaignId:'dr-c1'},{action:'create',campaignId:'dr-c1',text:'영업시간'},{action:'close',id:'dr-x',version:1},{action:'dismiss',id:'dr-x',version:1},{action:'reconcile',brandId}])offWrites.push(await post(i));
const offFact=await confirmFact('signature_menu','떡볶이');
const offSaved=await server.readRecord(owner,'brand_fact',offFact.body.id);
check('switch off: writes 409 and brand-facts POST response is byte-identical (no closedRequests key)',()=>{
 assert.deepEqual(offWrites.map(r=>r.status),[409,409,409,409,409]);
 assert.ok(/a6_data_requests/.test(offWrites[0].body.error));
 assert.equal(offFact.status,200);
 assert.equal(offFact.text,JSON.stringify({id:offSaved.id,version:1,fact:offSaved,warnings:[],reviewPublications:0}));
 assert.ok(!('closedRequests' in offFact.body));
 assert.equal(requests().length,0);
});
const offGet=await get('campaignId=dr-c1');

// ── 4)·5) 수집: outdated 제외, 캠페인·지점·항목 단위 멱등 ──
await setFlag(true);
const first=await post({action:'collect',campaignId:'dr-c1'});
const keys1=first.body.requests.map(r=>r.factKey);
check('outdated artifacts are not collected',()=>{
 assert.equal(first.status,200,JSON.stringify(first.body));
 assert.equal(first.body.artifacts,2);
 assert.ok(!keys1.includes('opening_date')&&!keys1.includes('cooking_method')&&!keys1.includes('official_account'),JSON.stringify(keys1));
 assert.ok(offGet.status===200&&offGet.body.enabled===false&&offGet.body.requests.length===0);
});
const second=await post({action:'collect',campaignId:'dr-c1'});
const menu=byKey('dr-c1','menu_price'),seed=`dr-c1|${storeId}|menu_price`;
await put('artifact','a-more',artifact('a-more','dr-c1',{content:'매장 안내 [자료 필요: 점주/영업시간]'}),'dr-c1');
const third=await post({action:'collect',campaignId:'dr-c1'});
check('collect is idempotent per campaign, store and key',()=>{
 assert.deepEqual([first.body.created,second.body.created,second.body.merged],[9,0,0]);
 assert.equal(requests().filter(r=>r.campaignId==='dr-c1').length,9);
 assert.equal(menu.id,'dr-'+createHash('sha256').update(seed).digest('hex').slice(0,12));
 assert.deepEqual(menu.origins.map(o=>o.kind).sort(),['artifact_marker','copy_pack']);
 assert.ok(menu.storeId===storeId&&menu.status==='open'&&menu.version===1&&menu.label==='메뉴 가격'&&menu.createdBy.id===owner);
 const hours=byKey('dr-c1','hours');
 assert.ok(third.body.created===0&&third.body.merged===1&&hours.origins.length===2&&hours.version===2&&hours.assignee==='점주');
 assert.ok(requests().filter(r=>r.campaignId==='dr-c1').every(r=>r.origins.length<=10&&r.origins.every(o=>(o.excerpt??'').length<=200)));
});

// ── 6) 지점 사실 확정 → 지점 요청 닫힘(fact id·판) ──
const hoursFact=await confirmFact('영업시간','11:00-21:00',{storeId});
const hoursReq=byKey('dr-c1','hours');
check('confirming a matching store fact closes the open store request with fact id and version',()=>{
 assert.equal(hoursFact.status,200);assert.equal(hoursFact.body.closedRequests,1);
 assert.ok(hoursReq.status==='closed'&&hoursReq.resolution.kind==='fact_confirmed'&&hoursReq.resolution.factId===hoursFact.body.id&&hoursReq.resolution.factVersion===1&&hoursReq.resolution.by.id===owner&&hoursReq.version===3,JSON.stringify(hoursReq));
 assert.ok(Object.keys(hoursFact.body).at(-1)==='closedRequests');
});

// ── 7) 브랜드 공통 사실은 지점 요청을 닫고, 지점 사실은 브랜드 범위 요청을 닫지 않는다 ──
const c2=await post({action:'collect',campaignId:'dr-c2'});
const parkingFact=await confirmFact('주차','건물 뒤 2대');
const closedStoreFact=await confirmFact('휴무일','매주 월요일',{storeId});
const recollect=await post({action:'collect',campaignId:'dr-c1'});
check('a brand-common fact closes a store request; a store fact does not close a brand-scope request',()=>{
 assert.ok(parkingFact.body.closedRequests===1&&byKey('dr-c1','parking').status==='closed'&&byKey('dr-c1','parking').resolution.factId===parkingFact.body.id);
 const brandScope=byKey('dr-c2','closed_days');
 assert.ok(c2.body.created===2&&c2.body.skipped.confirmed===1&&!byKey('dr-c2','signature_menu')&&!brandScope.storeId&&brandScope.scopeWarning==='store_link_needed'&&!byKey('dr-c2','promotion').scopeWarning);
 assert.ok(closedStoreFact.body.closedRequests===1&&byKey('dr-c1','closed_days').status==='closed'&&brandScope.status==='open');
 assert.equal(byKey('dr-c2','closed_days').status,'open');
 // 닫힌 요청은 다시 모아도 열리지 않고 판도 그대로다.
 assert.ok(recollect.body.skipped.closed===3&&recollect.body.created===0&&byKey('dr-c1','hours').status==='closed'&&byKey('dr-c1','hours').version===3,JSON.stringify(recollect.body.skipped));
});

// ── 8) 후보·거절·만료·미래 확인일 사실로는 닫히지 않는다 ──
const phoneCandidate=await factPost({action:'save_fact',data:{brandId,storeId,key:'전화',value:'02-000-0000',status:'candidate',source:'',verifiedAt:'',validUntil:''}});
const fact=over=>({id:'f-'+Math.random(),brandId,storeId,key:'phone',value:'02-000-0000',status:'confirmed',source:'점주',verifiedAt:iso(-day),validUntil:iso(day),version:1,updatedAt:now,...over});
const phoneReq=byKey('dr-c1','phone');
check('candidate, rejected, expired or future-verified facts do not close requests',()=>{
 assert.ok(phoneCandidate.status===200&&phoneCandidate.body.closedRequests===0&&byKey('dr-c1','phone').status==='open');
 for(const f of [fact({status:'candidate'}),fact({status:'rejected'}),fact({validUntil:iso(-1000)}),fact({verifiedAt:iso(day)}),fact({source:' '}),fact({storeId:'other-store'})])assert.equal(dr.closingFact(phoneReq,[f]),null,JSON.stringify(f));
 assert.ok(dr.closingFact(phoneReq,[fact()])!==null);
 assert.equal(dr.closingFact({...phoneReq,factKey:null},[fact()]),null);
 assert.equal(dr.closingFact({...phoneReq,storeId:undefined},[fact()]),null);
});

// ── 9) 권한: 직원은 모으기·만들기·조회, 수동 닫기·필요 없음·대조는 403 ──
env.AUTH_MODE='email';env.AUTH_ORIGIN='https://agency.test';
const signIn=(id,role,createdAt)=>{const token=createHash('sha256').update(id).digest('hex');sql.prepare('INSERT INTO auth_users(id,email,workspace_owner,role,status,created_at) VALUES(?,?,?,?,?,?)').run(id,id+'@test.invalid',owner,role,'active',createdAt);sql.prepare('INSERT INTO auth_sessions VALUES(?,?,?,?)').run(createHash('sha256').update(token).digest('hex'),id,Date.now()+60000,Date.now());return {cookie:'__Host-collective_session='+token,origin:'https://agency.test'}};
const ownerS=signIn('dr-first-admin','admin',1000),adminS=signIn('dr-admin','admin',2000),memberS=signIn('dr-member','member',500);
const memberGet=await get('campaignId=dr-c1',memberS),memberCollect=await post({action:'collect',campaignId:'dr-c1'},memberS),memberCreate=await post({action:'create',campaignId:'dr-c1',text:'포장 용기 규격',assignee:'점장'},memberS);
const target=byKey('dr-c1','seating');
const memberClose=await post({action:'close',id:target.id,version:target.version},memberS),memberDismiss=await post({action:'dismiss',id:target.id,version:target.version},memberS),memberReconcile=await post({action:'reconcile',brandId},memberS);
const staleClose=await post({action:'close',id:target.id,version:target.version+5},adminS),adminClose=await post({action:'close',id:target.id,version:target.version,note:'점장이 좌석 20석 회신'},adminS),again=await post({action:'dismiss',id:target.id,version:target.version+1},ownerS);
const duplicate=await post({action:'create',campaignId:'dr-c1',text:'포장 용기 규격'},memberS),cross=await post({action:'collect',campaignId:'dr-c1'},{...adminS,origin:'https://evil.test'});
check('member can collect and create but manual close/dismiss is 403',()=>{
 assert.ok(memberGet.status===200&&memberGet.body.enabled===true&&memberGet.body.requests.length>=9);
 assert.ok(memberCollect.status===200&&memberCreate.status===200,JSON.stringify(memberCreate.body));
 assert.ok(memberCreate.body.request.createdBy.role==='member'&&memberCreate.body.request.factKey===null&&memberCreate.body.request.origins.length===0&&memberCreate.body.request.assignee==='점장');
 assert.deepEqual([memberClose.status,memberDismiss.status,memberReconcile.status],[403,403,403]);
 assert.ok(staleClose.status===409&&adminClose.status===200&&adminClose.body.request.resolution.kind==='answered'&&adminClose.body.request.resolution.by.role==='admin'&&again.status===409);
 assert.ok(duplicate.status===409&&cross.status===403);
 assert.ok(!JSON.stringify(requests()).includes('@test.invalid'));
});
env.AUTH_MODE='legacy';

// ── 11) 사실 저장 뒤 닫기 실패: 사실은 남고 closedRequests:null, reconcile이 나중에 닫는다 ──
failDataRequestWrites=true;
const menuFact=await confirmFact('메뉴 가격','떡볶이 4,500원');
failDataRequestWrites=false;
const menuStored=await server.readRecord(owner,'brand_fact',menuFact.body.id);
const openBefore=byKey('dr-c1','menu_price').status;
const reconciled=await post({action:'reconcile',campaignId:'dr-c1'}),reconciledAgain=await post({action:'reconcile',brandId});
check('closure failure after fact save keeps the fact and returns closedRequests:null; reconcile closes later',()=>{
 assert.ok(menuFact.status===200&&menuFact.body.closedRequests===null&&menuStored.status==='confirmed');
 assert.equal(openBefore,'open');
 assert.ok(reconciled.status===200&&reconciled.body.closed===1&&byKey('dr-c1','menu_price').resolution.factId===menuFact.body.id);
 assert.ok(reconciledAgain.status===200&&reconciledAgain.body.closed===0);
});

// ── 12) 캠페인 삭제는 캠페인 요청을 지우고 대화상자는 '자료 요청'으로 센다 ──
const manual=await post({action:'create',brandId,text:'브랜드 로고 원본'});
const preview=plain(await server.campaignDeletionPreview(owner,'dr-c2'));
const lines=summary.deletionSummary(preview);
await server.deleteCampaign(owner,{id:'dr-c2',version:1,confirmed:true});
check('campaign deletion removes its data requests and the dialog labels them',()=>{
 assert.ok(manual.status===200&&!manual.body.request.campaignId);
 assert.equal(preview.deleted.data_request,2);
 assert.ok(lines.deleted.includes('자료 요청 2건')&&!lines.deleted.includes('기타 기록'),lines.deleted);
 assert.ok(!requests().some(r=>r.campaignId==='dr-c2'));
 assert.ok(requests().some(r=>r.id===manual.body.request.id)&&requests().some(r=>r.campaignId==='dr-c1'));
});

// ── 13) kind·스위치·기능표 등록 ──
const kinds=plain(registry.recordKinds),kind=kinds.find(k=>k.kind==='data_request');
check('data_request is registered in the kind registry',()=>{
 assert.ok(kind&&kind.parent==='brand'&&kind.campaignDeletion==='delete'&&JSON.stringify(kind.links)==='["data_campaign"]'&&!kind.purge&&!kind.blocksDeletion,JSON.stringify(kind));
 assert.equal(kinds.indexOf(kind),kinds.findIndex(k=>k.kind==='place_snapshot')-1);
 const names=Object.keys(flags.FEATURE_FLAGS);
 assert.ok(flags.FEATURE_FLAGS.a6_data_requests.defaultEnabled===false&&names.indexOf('a6_data_requests')===names.indexOf('a3_brand_voice')+1);
 const row=f=>plain(status.featureRows({flags:f})).find(r=>r.key==='data-requests');
 assert.deepEqual([row([{flag:'a6_data_requests',enabled:true}]).status,row([{flag:'a6_data_requests',enabled:false}]).status,row(null).status],['available','blocked','blocked']);
 const panel=readFileSync('app/campaign-detail-panel.tsx','utf8');
 assert.ok(panel.includes('<DataRequestsSlot campaignId={detail.campaign.id} artifacts={detail.artifacts}/>'));
 assert.ok(readFileSync('app/data-requests-panel.tsx','utf8').includes("action:'save_fact'"));
 assert.ok(!/feature-flags/.test(readFileSync('app/api/brand-facts/route.ts','utf8')));
});

// ── 14) 모델·외부 호출 없음 ──
check('no model or external calls',()=>{
 assert.equal(external.length,0);
 assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM records WHERE kind IN ('hermes_submission','openai_submission','provider_usage')").get().n,0);
 assert.ok(!/hermes|openai|fetch\(/.test(readFileSync('lib/data-requests.ts','utf8')+readFileSync('lib/data-requests-server.ts','utf8')));
});
console.log(JSON.stringify({passed:passed.length,checks:passed},null,2));
