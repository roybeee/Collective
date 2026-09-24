// PR 4b-2 네이버 검색광고 수집 광고비 → 비용 장부(store_spend) 옮기기 회귀.
// 미리보기는 쓰기 0건, 확인 저장, 같은 광고 대상·겹치는 기간 409, null·음수·비숫자·당일 부분 집계 거절, 확인 뒤 바뀐 수집값 409,
// 권한(관리자만 저장, 미리보기는 로그인 사용자), 수집값 없는 실험 404·빈 후보, 라우트 연결(잠금 없는 읽기·잠금 쓰기), 기존 비용 입력 흐름 불변,
// 롤링 수집 창 확장의 갱신(한 건을 새 누적값으로, 이중 계상 없음·사람이 고친 기록은 덮지 않음), 브랜드 공통 표시, naver- id 예약, 옮긴 관리자 이벤트, 화면 관문.
// 근거: mocked(메모리 SQLite, 로컬 인증 헤더·세션 주입). 외부 네트워크 호출은 0회다.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {testRuntime} from './helpers/runtime.mjs';

const rt=testRuntime(async()=>{throw new Error('외부 호출 금지')});
const {sql,env}=rt;
const api=await rt.load('app/api/store-operations/route.ts'),server=await rt.load('lib/server.ts'),ops=await rt.load('lib/store-operations-server.ts');
const owner='spend-transfer-owner';
const passed=[];const check=(name,val)=>{assert.ok(val,name);passed.push(name)};
const save=(kind,id,data,parent='')=>server.recordStatement(owner,kind,id,data,parent).run();
const legacy=()=>({'Content-Type':'application/json','oai-authenticated-user-id':owner});
async function call(b,headers=legacy()){const r=await api.POST(new Request('https://agency.test/api/store-operations',{method:'POST',headers,body:JSON.stringify(b)}));return {status:r.status,body:await r.json()}}
const count=kind=>sql.prepare('SELECT COUNT(*) n FROM records WHERE owner=? AND kind=?').get(owner,kind).n;
const snapshot=()=>JSON.stringify(sql.prepare('SELECT id,data,updated_at FROM records ORDER BY id').all());

// 지점·캠페인: s1 전용 캠페인 c1, 브랜드 공통 cw, 다른 지점 c2, 다른 브랜드 cf.
for(const [id,brandId,status] of [['s1','oda','active'],['s2','oda','active'],['s9','xyz','active'],['old','oda','archived']])await save('store',id,{id,brandId,name:'지점 '+id,status,version:1},brandId);
for(const [id,brandId,storeId] of [['c1','oda','s1'],['cw','oda',undefined],['c2','oda','s2'],['cf','ofd',undefined]])await save('campaign',id,{id,brandId,...(storeId?{storeId}:{}),title:'캠페인 '+id},brandId);
const W={from:'2026-08-01',to:'2026-08-07'},AT='2026-08-08T01:00:00.000Z';
const arm=(target,adSpend,over={})=>({value:{denominator:4000,numerator:120,source:'네이버 검색광고 · 대상 '+target},window:W,definition:'노출 대비 클릭',limitations:['집계 지연'],fetchedAt:AT,target,storeValues:{adSpend,orders:9},...over});
const experiment=(id,campaignId,title,status='running')=>save('viral_experiment',id,{id,brandId:'oda',campaignId,title,channel:'네이버 검색광고',status,version:1},campaignId);
const draft=(id,campaignId,arms,over={})=>save('measurement_draft',id,{id,experimentId:id,channel:'naver_ads',arms,comparable:false,definition:'노출 대비 클릭',window:W,limitations:[],fetchedAt:AT,updatedAt:AT,...over},campaignId);
await experiment('v1','c1','검색 문구 실험');await draft('v1','c1',{control:arm('cmp-A',96000),treatment:arm('cmp-B',54000)},{storeValues:{adSpend:54000}});
await experiment('vw','cw','브랜드 공통 실험','evaluated');await draft('vw','cw',{control:arm('cmp-A',70000,{window:{from:'2026-08-05',to:'2026-08-11'},fetchedAt:'2026-08-12T01:00:00.000Z'}),treatment:arm('cmp-W',30000)});
await experiment('v2','c2','다른 지점 실험');await draft('v2','c2',{control:arm('cmp-C',1000)});
await experiment('vf','cf','다른 브랜드 실험');await draft('vf','cf',{control:arm('cmp-F',1000)});
await experiment('vig','c1','인스타그램 실험');await draft('vig','c1',{control:arm('media-1',null)},{channel:'instagram'});
await experiment('vnull','c1','광고비 미확인');await draft('vnull','c1',{control:arm('cmp-N',null)});
await experiment('vneg','c1','음수 광고비');await draft('vneg','c1',{control:arm('cmp-M',-5)});
await experiment('vstr','c1','문자 광고비');await draft('vstr','c1',{control:arm('cmp-S','96000')});
await experiment('vpart','c1','당일 부분 집계');await draft('vpart','c1',{control:arm('cmp-P',1000,{window:{from:'2026-08-01',to:'2026-08-08'}})});
// 이전 형식 초안: arm별 광고비·광고 대상이 없고 최상위 광고비는 마지막으로 수집한 arm의 것이다. 같은 배치로 쓴 수집 대상에서 arm·광고 대상을 찾는다.
await experiment('vlegacy','c1','이전 형식 초안');await draft('vlegacy','c1',{control:{value:{denominator:1000,numerator:30,source:'이전'},window:W,definition:'이전',limitations:[],fetchedAt:AT}},{storeValues:{adSpend:12000,orders:1}});
await save('measurement_source','vlegacy:control',{id:'vlegacy:control',experimentId:'vlegacy',channel:'naver_ads',arm:'control',target:'cmp-L',window:W,lastFetchedAt:AT,lastError:null},'vlegacy');
await experiment('vnone','c1','수집 전 실험');
// 점포 실험: 연결 검증(같은 지점·같은 채널·비용일이 실험 기간 안)은 기존 비용 입력(validateOrderExperiment)과 같다.
const storeExperiment=(id,channel,startDate,endDate)=>save('store_experiment',id,{id,storeId:'s1',brandId:'oda',title:'점포 실험 '+id,channel,status:'running',startDate,endDate,campaignId:'c1',version:1},'s1');
await storeExperiment('se1','naver_ads','2026-07-25','2026-08-31');await storeExperiment('se2','social','2026-07-25','2026-08-31');await storeExperiment('se3','naver_ads','2026-09-01','2026-09-10');

// 1) 라우트 연결: 미리보기는 저장하지 않는 읽기(잠금 없음), 옮기기는 잠금을 잡는 쓰기다(A4-1 라우트 연결 누락 교훈).
check('transfer actions are routed as store measurement actions',ops.isMeasurementAction({action:'transfer_preview'})&&ops.isMeasurementAction({action:'transfer_spend'})&&ops.isMeasurementRead({action:'transfer_preview'})&&!ops.isMeasurementRead({action:'transfer_spend'}));

// 2) 미리보기: arm별 수집 광고비·기간·수집 시각, 쓰기 0건
let before=snapshot();
let res=await call({action:'transfer_preview',storeId:'s1'});
let list=res.body.candidates||[];const find=(e,a)=>list.find(c=>c.experimentId===e&&c.arm===a);
check('the preview lists the collected naver ad spend per arm with its window and collection time',res.status===200&&find('v1','control')?.adSpend===96000&&find('v1','control').window.from===W.from&&find('v1','control').window.to===W.to&&find('v1','control').fetchedAt===AT&&find('v1','control').date===W.to&&find('v1','treatment')?.adSpend===54000&&find('v1','control').target==='cmp-A');
check('each candidate says whether its campaign is store-only or brand-wide',find('v1','control').scope==='store'&&find('vw','treatment').scope==='brand');
check('the preview includes brand-wide campaign experiments and excludes other stores, brands and channels',!!find('vw','treatment')&&!list.some(c=>['v2','vf','vig','vnone'].includes(c.experimentId)));
check('the source names naver_ads collection, the window and the experiment',find('v1','control').source.startsWith('naver_ads 수집')&&find('v1','control').source.includes('2026-08-01~2026-08-07')&&find('v1','control').source.includes('검색 문구 실험'));
check('the preview writes nothing',snapshot()===before&&count('store_spend')===0);
check('an unknown ad spend stays null and is blocked, not turned into zero',find('vnull','control')?.adSpend===null&&!!find('vnull','control').blocked&&!find('v1','control').blocked);
check('a partial-day collection is blocked in the preview',/당일 부분 집계/.test(find('vpart','control')?.blocked||''));
check('a legacy draft takes its arm and ad target from the collection source',find('vlegacy','control')?.adSpend===12000&&find('vlegacy','control').target==='cmp-L'&&!find('vlegacy','control').blocked);
res=await call({action:'transfer_preview',storeId:'s1',experimentId:'vnone'});
check('an experiment without collected values is a 404',res.status===404);
res=await call({action:'transfer_preview',storeId:'s1',experimentId:'v2'});
check('another store experiment is not reachable from this store',res.status===404);
res=await call({action:'transfer_preview',storeId:'s9'});
check('a store without collected naver values gets an empty list',res.status===200&&Array.isArray(res.body.candidates)&&res.body.candidates.length===0);
res=await call({action:'transfer_preview',storeId:'s1',experimentId:'v1'});
check('a preview can be narrowed to one experiment',res.status===200&&res.body.candidates.length===2&&res.body.candidates.every(c=>c.experimentId==='v1'));

// 3) 거절: 값이 null·음수·비숫자, 당일 부분 집계, 확인 뒤 바뀐 수집값, 맞지 않는 점포 실험 연결
const confirm=(c,over={})=>({action:'transfer_spend',storeId:'s1',experimentId:c.experimentId,arm:c.arm,adSpend:c.adSpend,from:c.window.from,to:c.window.to,fetchedAt:c.fetchedAt,...over});
res=await call(confirm(find('vnull','control')));
check('a null ad spend is refused',res.status===400&&count('store_spend')===0);
res=await call(confirm(find('vneg','control')));
check('a negative ad spend is refused',res.status===400&&count('store_spend')===0);
res=await call(confirm(find('vstr','control'),{adSpend:96000}));
check('a non-numeric ad spend is refused',res.status===400&&count('store_spend')===0);
res=await call(confirm(find('vpart','control')));
check('a partial-day collection is refused',res.status===400&&count('store_spend')===0);
res=await call(confirm(find('v1','control'),{adSpend:95000}));
check('a confirmation that no longer matches the collected amount is a 409',res.status===409&&count('store_spend')===0);
res=await call(confirm(find('v1','control'),{fetchedAt:'2026-08-07T01:00:00.000Z'}));
check('a confirmation of an earlier collection is a 409',res.status===409&&count('store_spend')===0);
res=await call(confirm(find('v1','control'),{arm:'both'}));
check('an unknown arm is a 404',res.status===404&&count('store_spend')===0);
res=await call(confirm(find('v1','control'),{storeExperimentId:'se2'}));
check('a store experiment of another channel cannot be linked',res.status===400&&count('store_spend')===0);
res=await call(confirm(find('v1','control'),{storeExperimentId:'se3'}));
check('a store experiment whose period misses the spend date cannot be linked',res.status===400&&count('store_spend')===0);
res=await call(confirm(find('v1','control'),{storeId:'old'}));
check('an archived store refuses the transfer',res.status===409&&count('store_spend')===0);

// 4) 확인 저장: 기간 종료일 한 건, 수집값 그대로, 출처 'naver_ads 수집', 점포 실험 연결
res=await call(confirm(find('v1','control'),{storeExperimentId:'se1'}));
const first=res.body.id,saved=res.status===200?await server.readRecord(owner,'store_spend',first):null;
check('a confirmed transfer writes one store_spend on the window end date with the collected amount',res.status===200&&count('store_spend')===1&&saved.storeId==='s1'&&saved.date===W.to&&saved.channel==='naver_ads'&&saved.adSpend===96000&&saved.productionCost===0&&saved.experimentId==='se1'&&saved.version===1);
check('the transferred spend names its source, window, collection time and experiment',saved.source.startsWith('naver_ads 수집')&&saved.source.includes('2026-08-01~2026-08-07')&&saved.source.includes('2026-08-08 10:00')&&saved.source.includes('검색 문구 실험')&&saved.source.length<=2000);
check('the transferred spend sits under the store',sql.prepare('SELECT parent_id p FROM records WHERE id=?').get(`${owner}:store_spend:${first}`).p==='s1');
res=await call(confirm(find('v1','control'),{storeExperimentId:'se1'}));
check('transferring the same experiment and window again is a 409',res.status===409&&count('store_spend')===1);
res=await call(confirm(find('vw','control')));
check('an overlapping window of the same ad target is a 409 even from another experiment',res.status===409&&/겹치는 기간/.test(res.body.error)&&count('store_spend')===1);
res=await call(confirm(find('v1','treatment')));
check('the other arm with its own ad target is transferred separately',res.status===200&&count('store_spend')===2);
res=await call({action:'transfer_preview',storeId:'s1'});list=res.body.candidates;
check('the preview marks transferred candidates and overlapping ones',find('v1','control').transferred?.id===first&&!!find('v1','treatment').transferred&&!!find('vw','control').transferred&&!find('vw','treatment').transferred);
check('a transfer writes no measurement draft or other kind',count('measurement_draft')===10&&count('metric')===0&&count('store_measurement')===0);
res=await call(confirm(find('vw','treatment')));
check('a brand-wide campaign spend is transferred into the chosen store',res.status===200&&(await server.readRecord(owner,'store_spend',res.body.id)).storeId==='s1');
res=await call({action:'transfer_preview',storeId:'s2'});
check('another store sees the brand-wide spend as already transferred',res.status===200&&!!res.body.candidates.find(c=>c.experimentId==='vw'&&c.arm==='treatment')?.transferred);
res=await call({...confirm(res.body.candidates.find(c=>c.experimentId==='vw'&&c.arm==='treatment')),storeId:'s2'});
check('the same brand-wide spend cannot be transferred into a second store',res.status===409&&count('store_spend')===3);
const ledger=await (await api.GET(new Request('https://agency.test/api/store-operations?storeId=s1&from=2026-08-01&to=2026-08-31',{headers:legacy()}))).json();
check('the ledger read returns the transferred spend for the cost table',ledger.spend.some(s=>s.id===first&&s.adSpend===96000)&&ledger.spend.length===3);

// 5) 기존 비용 입력 흐름 불변: 수기 비용 저장·옮긴 비용 수정은 기존 save_spend 그대로다.
res=await call({action:'save_spend',storeId:'s1',data:{id:'manual-1',date:'2026-08-03',channel:'naver_ads',experimentId:'',adSpend:5000,productionCost:1000,source:'세금계산서 8월분'}});
check('manual spend entry still saves as before',res.status===200&&(await server.readRecord(owner,'store_spend','manual-1')).adSpend===5000);
res=await call({action:'save_spend',storeId:'s1',version:1,data:{...saved,source:saved.source+' · 정산 확인'}});
check('a transferred spend can be edited through the existing cost form',res.status===200&&(await server.readRecord(owner,'store_spend',first)).version===2);
res=await call({action:'save_spend',storeId:'s1',data:{id:'manual-2',date:'2026-08-03',channel:'naver_ads',experimentId:'',adSpend:-1,productionCost:0,source:'x'}});
check('manual spend validation is unchanged',res.status===400);

// 5b) 롤링 수집(R1): 진행 중 실험은 시작일을 고정한 채 종료일만 늘려 다시 수집한다. 같은 광고 대상·같은 시작일의 늘어난 창은
// 이미 옮긴 한 건을 확인 뒤 새 누적 수집값·기간·출처로 바꾼다(version 증가). 기록이 늘지 않아 광고비가 두 번 들어가지 않는다.
const spendRows=()=>sql.prepare("SELECT data FROM records WHERE owner=? AND kind='store_spend'").all(owner).map(r=>JSON.parse(r.data));
const rollArm=(target,to,adSpend,fetchedAt)=>arm(target,adSpend,{window:{from:W.from,to},fetchedAt});
const rolled=async(experimentId,storeId='s1')=>(await call({action:'transfer_preview',storeId,experimentId})).body.candidates[0];
await experiment('vroll','c1','롤링 수집 실험');await draft('vroll','c1',{control:rollArm('cmp-R','2026-08-07',70000,AT)});
res=await call(confirm(await rolled('vroll')));
const rollId=res.body.id,firstRoll=res.status===200?await server.readRecord(owner,'store_spend',rollId):null;
check('the first rolling window is transferred as one record',res.status===200&&firstRoll.adSpend===70000&&firstRoll.date===W.to);
await draft('vroll','c1',{control:rollArm('cmp-R','2026-08-14',150000,'2026-08-15T01:00:00.000Z')});
let rc=await rolled('vroll');
check('a grown rolling window of the same ad target and start is offered as an update of the transferred record',!rc.transferred&&!rc.blocked&&rc.replaces?.id===rollId&&rc.replaces.from===W.from&&rc.replaces.to===W.to&&rc.replaces.adSpend===70000&&rc.replaces.version===1);
const rollCount=count('store_spend');
res=await call(confirm(rc));
check('an update without confirming the replaced record is a 409',res.status===409&&(await server.readRecord(owner,'store_spend',rollId)).adSpend===70000);
res=await call(confirm(rc,{replacesVersion:1}));
const grown=await server.readRecord(owner,'store_spend',rollId);
check('confirming the update replaces the one record with the new cumulative amount, window and source',res.status===200&&res.body.id===rollId&&count('store_spend')===rollCount&&grown.adSpend===150000&&grown.date==='2026-08-14'&&grown.version===2&&grown.createdAt===firstRoll.createdAt&&grown.source.includes('2026-08-01~2026-08-14')&&grown.source.includes('2026-08-15 10:00'));
check('the ledger holds the cumulative spend once, not both windows',spendRows().filter(s=>s.source.includes('광고 대상 cmp-R')).reduce((n,s)=>n+s.adSpend,0)===150000);
res=await call(confirm(await rolled('vroll'),{replacesVersion:1}));
check('transferring the same grown window again is a 409',res.status===409&&(await server.readRecord(owner,'store_spend',rollId)).version===2);
await draft('vroll','c1',{control:rollArm('cmp-R','2026-08-10',100000,'2026-08-16T01:00:00.000Z')});
rc=await rolled('vroll');
check('a shorter window inside the transferred one stays transferred',!!rc.transferred&&(await call(confirm(rc))).status===409&&(await server.readRecord(owner,'store_spend',rollId)).adSpend===150000);
res=await call({action:'save_spend',storeId:'s1',version:2,data:{...grown,adSpend:149000}});
await draft('vroll','c1',{control:rollArm('cmp-R','2026-08-21',220000,'2026-08-22T01:00:00.000Z')});
rc=await rolled('vroll');
check('a record corrected by hand is not overwritten by a later rolling window',res.status===200&&!!rc.transferred&&/직접/.test(rc.transferred.message)&&!rc.replaces&&(await call(confirm(rc,{replacesVersion:3}))).status===409&&(await server.readRecord(owner,'store_spend',rollId)).adSpend===149000);
await experiment('vwroll','cw','브랜드 공통 롤링');await draft('vwroll','cw',{control:rollArm('cmp-WR','2026-08-07',10000,AT)});
res=await call(confirm(await rolled('vwroll')));
await draft('vwroll','cw',{control:rollArm('cmp-WR','2026-08-14',25000,'2026-08-15T01:00:00.000Z')});
const fromOther=await rolled('vwroll','s2');
check('a grown brand-wide window is updated only from the store that holds the record',res.status===200&&/다른 지점/.test(fromOther.transferred?.message||'')&&(await call({...confirm(fromOther),storeId:'s2',replacesVersion:1})).status===409&&(await rolled('vwroll')).replaces?.version===1);

// 6) 권한: 옮기기는 관리자, 미리보기는 로그인 사용자. 다른 워크스페이스는 지점에 닿지 않는다.
env.AUTH_MODE='email';env.AUTH_ORIGIN='https://agency.test';
const signIn=(id,role,createdAt,ws=owner)=>{const token=createHash('sha256').update(id).digest('hex');sql.prepare('INSERT INTO auth_users(id,email,workspace_owner,role,status,created_at) VALUES(?,?,?,?,?,?)').run(id,id+'@test.invalid',ws,role,'active',createdAt);sql.prepare('INSERT INTO auth_sessions VALUES(?,?,?,?)').run(createHash('sha256').update(token).digest('hex'),id,Date.now()+60000,Date.now());return {'Content-Type':'application/json',cookie:'__Host-collective_session='+token,origin:'https://agency.test'}};
const member=signIn('st-member','member',500),admin=signIn('st-admin','admin',2000),foreign=signIn('st-foreign','admin',3000,'someone-else');
const legacyDraft=(await call({action:'transfer_preview',storeId:'s1',experimentId:'vlegacy'},member));
check('a member can preview the transfer',legacyDraft.status===200&&legacyDraft.body.candidates.length===1);
const spendBefore=count('store_spend');
res=await call(confirm(legacyDraft.body.candidates[0]),member);
check('a member cannot transfer collected spend',res.status===403&&count('store_spend')===spendBefore);
res=await call(confirm(legacyDraft.body.candidates[0]),foreign);
check('an admin of another workspace cannot reach the store',res.status===404&&count('store_spend')===spendBefore);
// SEC-4b2-1: naver- id는 옮기기 전용이다. 직원이 옮긴 표식을 위조해 관리자의 옮기기를 409로 막을 수 없다.
const forged='naver-'+createHash('sha256').update('naver_ads\u0000cmp-L').digest('hex').slice(0,24)+'-'+W.from;
res=await call({action:'save_spend',storeId:'s1',data:{id:forged,date:W.to,channel:'naver_ads',experimentId:'',adSpend:1,productionCost:0,source:'직원 입력'}},member);
check('a new cost with the reserved naver- id is refused',res.status===400&&count('store_spend')===spendBefore);
res=await call({action:'save_spend',storeId:'s1',data:{id:'manual-3',date:'2026-08-04',channel:'naver_ads',experimentId:'',adSpend:100,productionCost:0,source:'직원 입력'}},member);
check('a member can still record a cost by hand',res.status===200);
res=await call(confirm(legacyDraft.body.candidates[0]),admin);
check('an admin transfers the legacy draft spend',res.status===200&&(await server.readRecord(owner,'store_spend',res.body.id)).adSpend===12000&&count('store_spend')===spendBefore+2);
// SEC-4b2-2: 관리자 옮기기는 캠페인 이벤트에 행위자를 남긴다(비용 기록과 한 번에 저장).
const transferEvent=sql.prepare("SELECT data FROM records WHERE owner=? AND kind='event' AND parent_id='c1'").all(owner).map(r=>JSON.parse(r.data)).find(e=>e.actor?.id==='st-admin');
check('an admin transfer leaves a campaign event naming the admin, amount and window',!!transferEvent&&transferEvent.message.includes('12,000원')&&transferEvent.message.includes('2026-08-01~2026-08-07'));

// 7) 화면 관문(app/store-operations-panel.tsx): 확인 체크 전 저장 꺼짐, 막힌·이미 옮긴 후보는 버튼 없음, 직원 안내, 고른 점포 실험·바꿀 기록 버전 전송, 브랜드 공통 경고, 빈 목록 숨김
const panel=readFileSync('app/store-operations-panel.tsx','utf8');
check('the transfer dialog keeps the save button off until the check',panel.includes('disabled={busy||!checked}'));
check('blocked or transferred candidates have no transfer button and members see the admin note',panel.includes('!c.transferred&&!c.blocked&&(canManage?')&&panel.includes('관리자만 옮길 수 있습니다'));
check('the dialog sends the chosen store experiment and the version of the record it replaces',/post\('transfer_spend',\{[^}]*storeExperimentId:link[^}]*\}/.test(panel)&&panel.includes('replacesVersion:c.replaces?.version'));
check('a brand-wide candidate is marked and the dialog warns that the whole spend goes into this store',panel.includes("' · 브랜드 공통 캠페인'")&&panel.includes('이 지점 장부에만 들어갑니다')&&panel.includes('다른 지점에는 옮길 수 없습니다'));
check('a rolling update names the record it replaces',panel.includes('c.replaces.from')&&panel.includes('두 번 들어가지 않습니다'));
check('the collected spend list hides itself when there is nothing to show',panel.includes('if(!candidates.length&&!error)return null'));

console.log(JSON.stringify({passed:passed.length,checks:passed},null,2));
