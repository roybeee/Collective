// 플레이스 정보 대조(A6-2): 관리자가 지점별 네이버 플레이스 정보(주소·영업시간·휴무·전화·메뉴 가격)를 수동 스냅샷으로 입력하면 확정 사실과 결정론으로 대조한다.
// conflict·place_missing은 점포 할 일(open), fact_missing은 a6_data_requests가 켜져 있을 때 지점 data_request(origin place_check)다. 다시 대조해 일치하면 할 일을 닫는다.
// 기능 스위치 a6_place_check(기본 꺼짐)가 꺼져 있으면 쓰기 409이고 /api/stores GET·기존 보고서 할 일·/api/brand-facts POST 응답은 바이트 동일하다.
// 근거: mocked(메모리 SQLite, 합성 브랜드·지점·사실, 로컬 세션 쿠키 주입, fetch 스텁). 모델·외부 호출은 0회다. URL은 fetch하지 않는다.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {testRuntime} from './helpers/runtime.mjs';

const external=[];
const {sql,env,load}=testRuntime(async url=>{external.push(String(url));throw new Error('외부 호출 금지: '+url)});
const server=await load('lib/server.ts'),pc=await load('lib/place-check.ts'),flags=await load('lib/feature-flags.ts'),registry=await load('lib/record-kinds.ts'),status=await load('lib/feature-status.ts');
const route=await load('app/api/place-checks/route.ts'),storesRoute=await load('app/api/stores/route.ts'),factsRoute=await load('app/api/brand-facts/route.ts');
const passed=[];
const check=(name,fn)=>{fn();passed.push(name)};
const plain=v=>JSON.parse(JSON.stringify(v));
const owner='pc-owner',brandId='pc-brand',storeId='pc-s1',archivedId='pc-s2',now=new Date().toISOString();
const iso=ms=>new Date(Date.now()+ms).toISOString(),day=86400000;
const today=new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Seoul'});
const tomorrow=new Date(Date.now()+2*day).toLocaleDateString('en-CA',{timeZone:'Asia/Seoul'});

// 합성 데이터. 실제 고객·매장 정보가 아니다.
const put=(kind,id,data,parent='')=>server.recordStatement(owner,kind,id,data,parent).run();
const store=(id,extra={})=>({id,brandId,name:'가상 '+id,address:'서울 동대문구 휘경로 12',tradeArea:'residential',customer:'',goal:'첫 방문',daypart:'',menu:'',hours:'',access:'',capacity:'',economics:'',competitors:'',status:'active',version:1,createdAt:now,updatedAt:now,...extra});
await put('brand',brandId,{id:brandId,name:'가상분식',short:'GB',category:'SNACK',color:'#224466',bg:'#eef2f6',description:'합성',audience:'',tone:'',constraints:'',knowledge:''});
await put('store',storeId,store(storeId),brandId);
await put('store',archivedId,store(archivedId,{status:'archived'}),brandId);
await put('store_report','pc-r1',{id:'pc-r1',storeId,brandId,storeVersion:1,status:'candidate',summary:'s',customer:'c',bottleneck:'b',measurementPlan:'m',limitations:'l',questions:[],sourceIds:[],actions:[{channel:'naver_place',priority:'first',action:'대표 사진 교체',reason:'r',sourceIds:[]}],proposals:[],createdAt:now},storeId);

const headers={'oai-authenticated-user-id':owner};
const call=async r=>{const text=await r.text();return {status:r.status,text,body:JSON.parse(text)}};
const post=async(input,h=headers)=>call(await route.POST(new Request('https://agency.test/api/place-checks',{method:'POST',headers:{'content-type':'application/json',...h},body:JSON.stringify(input)})));
const get=async(query,h=headers)=>call(await route.GET(new Request('https://agency.test/api/place-checks?'+query,{headers:h})));
const storesGet=async()=>call(await storesRoute.GET(new Request(`https://agency.test/api/stores?brandId=${brandId}&storeId=${storeId}`,{headers})));
const storesPost=async input=>call(await storesRoute.POST(new Request('https://agency.test/api/stores',{method:'POST',headers:{'content-type':'application/json',...headers},body:JSON.stringify(input)})));
const factPost=async(input,h=headers)=>call(await factsRoute.POST(new Request('https://agency.test/api/brand-facts',{method:'POST',headers:{'content-type':'application/json',...h},body:JSON.stringify(input)})));
const confirmFact=(key,value,extra={},over={})=>factPost({action:'save_fact',confirmed:true,...over,data:{brandId,key,value,status:'confirmed',source:'점주 확인(합성)',verifiedAt:iso(-day),validUntil:iso(30*day),...extra}});
const setFlag=(flag,enabled)=>flags.setFeatureFlag(owner,{flag,enabled},{id:owner,email:null});
const rows=kind=>sql.prepare('SELECT data FROM records WHERE owner=? AND kind=?').all(owner,kind).map(r=>JSON.parse(r.data));
const placeTasks=()=>rows('store_task').filter(t=>t.id.startsWith('place:'));
const taskOf=field=>rows('store_task').find(t=>t.id===`place:${storeId}:naver_place:${field}`);
const URL_OK='https://map.naver.com/p/entry/place/1234567';
const FIELDS={address:'',hours:'매일 11:00-22:00',closed_days:'화',phone:'02-000-0000',menu_price:'떡볶이 5,000원'};
const snapshot=(extra={},fields={})=>({action:'save_snapshot',storeId,platform:'naver_place',url:URL_OK,checkedAt:today,fields:{...FIELDS,...fields},...extra});

// ── 1) 영업시간: 구분자·요일 표기와 관계없이 시간 구간 집합 ──
check('hours ranges match regardless of separators and day words',()=>{
 assert.equal(pc.sameHours('매일 11:00-21:00','11시~21시 (연중무휴)'),true);
 assert.equal(pc.sameHours('월-금 11:00 ~ 21:00 / 토 12:00-20:00','평일 11시-21시, 토요일 12:00~20:00'),true);
 assert.equal(pc.sameHours('11:00-21:00','오전 11시 ~ 오후 9시'),true);
 assert.equal(pc.sameHours('11:30-21:00','11시 30분부터 21시까지'),true);
 assert.equal(pc.sameHours('11:00-21:00','11:00-22:00'),false);
 assert.equal(pc.sameHours('11:00-21:00','11:00-21:00, 토 12:00-20:00'),false);
 assert.deepEqual(plain(pc.hoursRanges('매일 11:00-21:00 · 브레이크 15:00~16:30')),['11:00-21:00','15:00-16:30']);
});
// ── 휴무: 요일 집합 ──
check('closed days compare weekday sets',()=>{
 assert.equal(pc.sameClosedDays('월','매주 월요일'),true);
 assert.equal(pc.sameClosedDays('월, 화','월요일'),false);
 assert.equal(pc.sameClosedDays('연중무휴','휴무 없음'),true);
 assert.equal(pc.sameClosedDays('매월 첫째 월요일, 공휴일','월'),true);
 assert.equal(pc.sameClosedDays('토·일','주말'),true);
});
// ── 2) 전화: 숫자만 ──
check('phone compares digits only',()=>{
 assert.equal(pc.samePhone('02-000-0000','(02) 000 0000'),true);
 assert.equal(pc.samePhone('+82 2-000-0000','02-000-0000'),true);
 assert.equal(pc.samePhone('02-000-0000','02-000-0001'),false);
});
// ── 3) 주소: 정규화 뒤 포함 관계 ──
check('address containment',()=>{
 assert.equal(pc.sameAddress('서울 동대문구 휘경로 12','서울특별시 동대문구 휘경로 12 (휘경동)'),true);
 assert.equal(pc.sameAddress('서울특별시 동대문구 휘경로 12, 1층','서울 동대문구 휘경로 12'),true);
 assert.equal(pc.sameAddress('서울 동대문구 휘경로 14','서울특별시 동대문구 휘경로 12'),false);
 assert.equal(pc.sameAddress('서울 동대문구','서울특별시 동대문구 휘경로 12'),false);
});
// ── 4) 메뉴 가격: 플레이스 금액 집합 ⊆ 확정 금액 ──
check('menu prices must be a subset of confirmed amounts',()=>{
 assert.equal(pc.pricesWithin('떡볶이 5,000원',['떡볶이 5,000원, 순대 4,000원']),true);
 assert.equal(pc.pricesWithin('떡볶이 5천원 · 순대 4,000원',['떡볶이 5,000원','순대 4,000원']),true);
 assert.equal(pc.pricesWithin('떡볶이 5,500원',['떡볶이 5,000원, 순대 4,000원']),false);
 assert.equal(pc.pricesWithin('떡볶이 5,000원, 튀김 3,000원',['떡볶이 5,000원']),false);
});
// 순수 대조: 다섯 항목 모두 결과가 있고 순서가 고정이다.
const fact=(key,value,over={})=>({id:'f-'+key,brandId,storeId,key,value,status:'confirmed',source:'점주',verifiedAt:iso(-day),validUntil:iso(day),version:1,updatedAt:now,...over});
check('compare returns one fixed-order result per field with fact refs',()=>{
 const result=plain(pc.compareSnapshot({brandId,storeId,fields:{...FIELDS,address:''},facts:[fact('address','서울 동대문구 휘경로 12'),fact('hours','11:00-21:00',{version:2}),fact('영업시간','9:00-10:00',{storeId:undefined,id:'f-brand-hours'}),fact('closed_days','월'),fact('menu_price','떡볶이 5,000원',{storeId:undefined})]}));
 assert.deepEqual(result.map(r=>[r.field,r.state]),[['address','place_missing'],['hours','conflict'],['closed_days','conflict'],['phone','fact_missing'],['menu_price','match']]);
 assert.deepEqual(result[1],{field:'hours',state:'conflict',placeValue:'매일 11:00-22:00',factId:'f-hours',factVersion:2,factValue:'11:00-21:00'});
 assert.deepEqual(result[3],{field:'phone',state:'fact_missing'});
 assert.deepEqual(plain(pc.compareSnapshot({brandId,storeId,fields:{},facts:[]})).map(r=>r.state),['both_missing','both_missing','both_missing','both_missing','both_missing']);
});

// 합성 확정 사실(지점: 주소·영업시간·휴무, 브랜드 공통: 메뉴 가격). 전화 사실은 없다.
const addressFact=await confirmFact('주소','서울특별시 동대문구 휘경로 12 (휘경동)',{storeId});
const hoursFact=await confirmFact('영업시간','11:00-21:00',{storeId});
const closedFact=await confirmFact('휴무일','매주 월요일',{storeId});
const menuFact=await confirmFact('메뉴 가격','떡볶이 5,000원, 순대 4,000원');

// ── 9) 스위치 꺼짐: 새 쓰기 409, 기존 보고서 할 일과 /api/stores GET·사실 저장 응답은 바이트 동일 ──
const reportTask=await storesPost({action:'save_task',storeId,reportId:'pc-r1',index:0,status:'done',evidence:'사진 교체 완료(합성)'});
const storesBefore=await storesGet();
const offWrites=[await post(snapshot()),await post({action:'save_task',storeId,id:`place:${storeId}:naver_place:hours`,version:1,status:'done',evidence:'x'})];
const offGet=await get('storeId='+storeId);
const offFact=await confirmFact('좌석','20석',{storeId});
const offSaved=await server.readRecord(owner,'brand_fact',offFact.body.id);
const storesAfterOff=await storesGet();
check('existing report tasks and stores GET are byte-identical when switch off',()=>{
 assert.ok([addressFact,hoursFact,closedFact,menuFact].every(r=>r.status===200));
 assert.equal(reportTask.status,200);
 assert.deepEqual(offWrites.map(r=>r.status),[409,409]);
 assert.ok(/a6_place_check/.test(offWrites[0].body.error));
 assert.equal(storesAfterOff.text,storesBefore.text);
 assert.equal(placeTasks().length,0);
 assert.equal(rows('place_snapshot').length,0);
 assert.ok(offGet.status===200&&offGet.body.enabled===false&&offGet.body.snapshots.length===0&&offGet.body.tasks.length===0);
 assert.equal(offFact.text,JSON.stringify({id:offSaved.id,version:1,fact:offSaved,warnings:[],reviewPublications:0}));
});

// ── 5) 충돌: 항목마다 열린 할 일 하나, id 고정 ──
await setFlag('a6_place_check',true);
const reportTaskBefore=JSON.stringify(rows('store_task').find(t=>t.id==='pc-r1-0'));
const first=await post(snapshot());
const firstTasks=placeTasks();
const again=await post(snapshot({version:1}));
check('conflict creates one open store task per field with a stable id',()=>{
 assert.equal(first.status,200,first.text);
 const s=first.body.snapshot;
 assert.ok(s.id===`${storeId}:naver_place`&&s.storeId===storeId&&s.brandId===brandId&&s.platform==='naver_place'&&s.url===URL_OK&&s.checkedAt===today&&s.version===1&&s.checkedBy.id===owner&&s.checkedBy.role==='owner'&&Array.isArray(s.history)&&s.history.length===0);
 assert.deepEqual(s.result.map(r=>[r.field,r.state]),[['address','place_missing'],['hours','conflict'],['closed_days','conflict'],['phone','fact_missing'],['menu_price','match']]);
 assert.deepEqual(firstTasks.map(t=>t.id).sort(),['address','closed_days','hours'].map(f=>`place:${storeId}:naver_place:${f}`));
 const hours=firstTasks.find(t=>t.id.endsWith(':hours'));
 assert.deepEqual(hours,{id:`place:${storeId}:naver_place:hours`,storeId,reportId:'',title:'네이버 플레이스 영업시간이 확정 사실과 다릅니다',channel:'naver_place',status:'open',evidence:'',
  source:{kind:'place_check',platform:'naver_place',field:'hours',snapshotVersion:1,factId:hoursFact.body.id,factVersion:1,placeValue:'매일 11:00-22:00',factValue:'11:00-21:00'},version:1,updatedAt:hours.updatedAt});
 assert.equal(firstTasks.find(t=>t.id.endsWith(':address')).title,'네이버 플레이스에 주소 정보가 비어 있습니다');
 assert.equal(again.status,200,again.text);
 assert.equal(placeTasks().length,3);
 assert.ok(placeTasks().every(t=>t.status==='open'&&t.version===2&&t.source.snapshotVersion===2));
 assert.ok(again.body.snapshot.version===2&&again.body.snapshot.history.length===1&&again.body.snapshot.history[0].version===1&&!('history' in again.body.snapshot.history[0]));
 assert.equal(JSON.stringify(rows('store_task').find(t=>t.id==='pc-r1-0')),reportTaskBefore);
});

// ── 6) 확정 사실 없음: a6_data_requests가 켜져 있을 때만 지점 자료 요청(origin place_check), 할 일은 만들지 않는다 ──
const offRequests=rows('data_request').length;
await setFlag('a6_data_requests',true);
const withRequests=await post(snapshot({version:2}));
const phoneRequest=rows('data_request').find(r=>r.factKey==='phone');
const repeat=await post(snapshot({version:3}));
check('missing confirmed fact creates a place_check data request (when a6_data_requests on), not a task',()=>{
 assert.ok(offRequests===0&&!('dataRequests' in first.body)&&!('dataRequests' in again.body));
 assert.ok(withRequests.status===200&&withRequests.body.dataRequests===1,withRequests.text);
 assert.ok(phoneRequest&&phoneRequest.status==='open'&&phoneRequest.storeId===storeId&&!phoneRequest.campaignId&&phoneRequest.label==='전화번호'&&phoneRequest.createdBy.role==='owner',JSON.stringify(phoneRequest));
 assert.deepEqual(phoneRequest.origins,[{kind:'place_check',snapshotId:`${storeId}:naver_place`,snapshotVersion:3,platform:'naver_place',field:'phone'}]);
 assert.equal(phoneRequest.id,'dr-'+createHash('sha256').update(`|${storeId}|phone`).digest('hex').slice(0,12));
 assert.ok(!taskOf('phone'));
 assert.ok(repeat.status===200&&repeat.body.dataRequests===0&&rows('data_request').length===1&&rows('data_request')[0].origins.length===2);
});

// ── 7) 다시 입력한 스냅샷이 일치하면 할 일을 닫고 근거를 남긴다 ──
const fixed=await post(snapshot({version:4},{address:'서울 동대문구 휘경로 12',hours:'11시~21시 (매일)'}));
check('a matching re-snapshot closes the task with recheck evidence',()=>{
 assert.equal(fixed.status,200,fixed.text);
 for(const field of ['address','hours']){const t=taskOf(field);assert.ok(t.status==='done'&&t.evidence==='재대조 일치(스냅샷 v5)'&&t.source.snapshotVersion===5,JSON.stringify(t))}
 assert.equal(taskOf('closed_days').status,'open');
 assert.equal(fixed.body.snapshot.history.length,4);
});

// ── 8) 사실을 고치면 사실 저장 뒤 재대조가 할 일을 닫는다 ──
const corrected=await confirmFact('휴무일','매주 화요일',{storeId},{id:closedFact.body.id,version:1});
const phoneFact=await confirmFact('전화','(02) 000-0000',{storeId});
check('a fact correction closes the task on the fact-save recheck',()=>{
 assert.equal(corrected.status,200,corrected.text);
 assert.equal(corrected.body.closedPlaceTasks,1);
 const t=taskOf('closed_days');
 assert.ok(t.status==='done'&&t.evidence.startsWith('재대조 일치(스냅샷 v5)')&&t.evidence.includes(closedFact.body.id),JSON.stringify(t));
 assert.deepEqual(Object.keys(corrected.body).slice(-2),['closedRequests','closedPlaceTasks']);
 // 전화 사실 확정은 A6-1 경로가 place_check 자료 요청을 닫는다.
 assert.ok(phoneFact.status===200&&phoneFact.body.closedRequests===1&&phoneFact.body.closedPlaceTasks===0&&rows('data_request')[0].status==='closed');
});

// ── 10) 거절 경로: 보관 지점 409, 미래 확인일 400, 플레이스가 아닌 URL 400, 직원 스냅샷 403, 오래된 판 409 ──
const archived=await post(snapshot({storeId:archivedId}));
const future=await post(snapshot({version:5,checkedAt:tomorrow}));
const badUrls=[];for(const url of ['https://example.com/place/1','http://map.naver.com/p/entry/place/1','https://map.naver.com.evil.test/x','javascript:alert(1)'])badUrls.push(await post(snapshot({version:5,url})));
const tooLong=await post(snapshot({version:5},{hours:'1'.repeat(1000)})),unknownField=await post(snapshot({version:5},{parking:'2대'}));
const stale=await post(snapshot({version:2})),missingVersion=await post(snapshot());
env.AUTH_MODE='email';env.AUTH_ORIGIN='https://agency.test';
const signIn=(id,role,createdAt)=>{const token=createHash('sha256').update(id).digest('hex');sql.prepare('INSERT INTO auth_users(id,email,workspace_owner,role,status,created_at) VALUES(?,?,?,?,?,?)').run(id,id+'@test.invalid',owner,role,'active',createdAt);sql.prepare('INSERT INTO auth_sessions VALUES(?,?,?,?)').run(createHash('sha256').update(token).digest('hex'),id,Date.now()+60000,Date.now());return {cookie:'__Host-collective_session='+token,origin:'https://agency.test'}};
signIn('pc-first-admin','admin',100);
const adminS=signIn('pc-admin','admin',1000),memberS=signIn('pc-member','member',500);
const staffSnapshot=await post(snapshot({version:5}),memberS);
const memberGet=await get('storeId='+storeId,memberS);
const menuConflict=await post(snapshot({version:5},{address:'서울 동대문구 휘경로 12',hours:'11:00-21:00',closed_days:'화',menu_price:'떡볶이 6,000원'}),adminS);
const menuTask=taskOf('menu_price');
const memberStale=await post({action:'save_task',storeId,id:menuTask.id,version:menuTask.version+3,status:'done',evidence:'플레이스 가격 수정'},memberS);
const memberNoEvidence=await post({action:'save_task',storeId,id:menuTask.id,version:menuTask.version,status:'done',evidence:''},memberS);
const memberDone=await post({action:'save_task',storeId,id:menuTask.id,version:menuTask.version,status:'done',evidence:'플레이스 가격을 5,000원으로 수정(합성)'},memberS);
const reportIdTask=await post({action:'save_task',storeId,id:'pc-r1-0',version:1,status:'open',evidence:''},memberS);
const cross=await post(snapshot({version:6}),{...adminS,origin:'https://evil.test'});
env.AUTH_MODE='legacy';
check('archived store 409, future checkedAt 400, non-place URL 400, staff snapshot 403, stale version 409',()=>{
 assert.equal(archived.status,409);
 assert.equal(future.status,400);
 assert.deepEqual(badUrls.map(r=>r.status),[400,400,400,400]);
 assert.deepEqual([tooLong.status,unknownField.status],[400,400]);
 assert.deepEqual([stale.status,missingVersion.status],[409,409]);
 assert.equal(staffSnapshot.status,403);
 assert.ok(memberGet.status===200&&memberGet.body.enabled===true&&memberGet.body.snapshots.length===1&&memberGet.body.tasks.every(t=>t.id.startsWith('place:')));
 assert.ok(!JSON.stringify(memberGet.body).includes('@test.invalid'));
 assert.ok(menuConflict.status===200&&menuConflict.body.snapshot.checkedBy.role==='admin'&&menuTask.status==='open',menuConflict.text);
 assert.deepEqual([memberStale.status,memberNoEvidence.status,memberDone.status,reportIdTask.status,cross.status],[409,400,200,400,403]);
 assert.ok(memberDone.body.task.status==='done'&&memberDone.body.task.evidence==='플레이스 가격을 5,000원으로 수정(합성)'&&taskOf('menu_price').version===menuTask.version+1);
 assert.equal(rows('place_snapshot')[0].version,6);
 assert.equal(rows('place_snapshot')[0].history.length,5);
});

// 사실 저장 뒤 재대조는 닫기만 한다. 직원이 끝낸 가격 할 일(플레이스는 여전히 6,000원)을 다시 열거나 새 할 일을 만들지 않는다.
const menuDoneBefore=JSON.stringify(taskOf('menu_price'));
const unrelated=await confirmFact('대표 메뉴','떡볶이');
check('the fact-save recheck only closes tasks and never reopens or creates them',()=>{
 assert.ok(unrelated.status===200&&unrelated.body.closedPlaceTasks===0,unrelated.text);
 assert.equal(JSON.stringify(taskOf('menu_price')),menuDoneBefore);
 assert.equal(placeTasks().length,4);
});

// ── 12) kind·스위치·기능표·화면 등록 ──
const kinds=plain(registry.recordKinds),kind=kinds.find(k=>k.kind==='place_snapshot');
check('place_snapshot, the a6_place_check switch and the feature row are registered',()=>{
 assert.ok(kind&&kind.parent==='store'&&kind.campaignDeletion==='not_campaign_scoped'&&!kind.links&&!kind.purge,JSON.stringify(kind));
 assert.equal(kinds.indexOf(kind),kinds.findIndex(k=>k.kind==='data_request')+1);
 assert.equal(kinds.indexOf(kind),kinds.findIndex(k=>k.kind==='brand_voice')-1);
 const names=Object.keys(flags.FEATURE_FLAGS);
 assert.ok(flags.FEATURE_FLAGS.a6_place_check.defaultEnabled===false&&names.indexOf('a6_place_check')===names.indexOf('a6_data_requests')+1);
 const row=f=>plain(status.featureRows({flags:f})).find(r=>r.key==='place-check');
 assert.deepEqual([row([{flag:'a6_place_check',enabled:true}]).status,row([{flag:'a6_place_check',enabled:false}]).status,row(null).status],['available','blocked','blocked']);
 assert.ok(readFileSync('app/store-marketing-panel.tsx','utf8').includes('<PlaceCheckPanel '));
 assert.ok(!/feature-flags/.test(readFileSync('app/api/brand-facts/route.ts','utf8')+readFileSync('app/api/place-checks/route.ts','utf8')+readFileSync('lib/place-check.ts','utf8')));
 assert.deepEqual([...pc.PLACE_PLATFORMS.naver_place.hosts],['place.naver.com','map.naver.com']);
 const officialHosts=readFileSync('lib/archive-research.ts','utf8');
 assert.ok(pc.PLACE_PLATFORMS.naver_place.hosts.every(h=>officialHosts.includes(`'${h}'`)));
});

// ── 11) 모델·외부 호출 없음 ──
check('no external fetch',()=>{
 assert.equal(external.length,0);
 assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM records WHERE kind IN ('hermes_submission','openai_submission','provider_usage')").get().n,0);
 assert.ok(!/hermes|openai|fetch\(/.test(readFileSync('lib/place-check.ts','utf8')+readFileSync('lib/place-check-server.ts','utf8')+readFileSync('app/api/place-checks/route.ts','utf8')));
});
console.log(JSON.stringify({passed:passed.length,checks:passed},null,2));
