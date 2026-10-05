// 실 SQLite·순수 계산, 공급자 API mocked. 외부 네트워크 호출 없음.
import assert from 'node:assert/strict';
import {testRuntime} from './helpers/runtime.mjs';
const {load,sql}=testRuntime(async()=>new Response(JSON.stringify({keywordList:[
 {relKeyword:'누락',monthlyMobileQcCnt:100},
 {relKeyword:'소량',monthlyPcQcCnt:'< 10',monthlyMobileQcCnt:100},
]}),{status:200,headers:{'content-type':'application/json'}}));
const C=await load('lib/product-research/analytics/calibrate.ts');
const S=await load('lib/product-research/analytics/series.ts');
const N=await load('lib/product-research/collectors/naver-searchad.ts');
const O=await load('lib/product-research/server-ops.ts');
const point=value=>[{at:'2026-09-01',snapshotId:'S',value}];
let passed=0;const check=(v,m)=>{assert.ok(v,m);passed++};
const missing=C.groupAnchors([{key:'a',month:point(null),pc:point(N.parseQcCnt(undefined)),mobile:point(100)}]);
check(missing.points.length===0&&missing.missing.includes('a'),'missing count must not become an under-ten estimate');
let providerCalls=0;
await assert.rejects(()=>N.collectSearchadKeywords({apiKey:'fixture',secretKey:'fixture',customerId:'fixture'},['누락','소량'],{fetch:async()=>{providerCalls++;throw new Error('forbidden')},now:()=>new Date('2026-09-02T00:00:00Z')}),e=>e.code==='not_allowed');passed++;
check(providerCalls===0,'SearchAd collection denied before fetch');
// 기존 수치 커널 회귀: 이미 저장된 합성 partial 행을 직접 검사한다. MD 재사용이나 수집 허용이 아니다.
const snapshot={id:'S',sourceId:'naver_searchad_keyword',status:'partial',request:{},bodyDigest:'0'.repeat(64),bodyBytes:1,fetchedAt:'2026-09-02T00:00:00Z',importedBy:null,observations:['누락','소량'].flatMap(text=>[
 {subject:{type:'keyword',text},metric:'search_volume_month',value:null,period:{from:'2026-08-02',to:'2026-09-01'}},
 {subject:{type:'keyword',text},metric:'search_volume_pc',value:N.parseQcCnt(text==='누락'?undefined:'< 10'),...(text==='소량'?{underTen:true}:{}),period:{from:'2026-08-02',to:'2026-09-01'}},
 {subject:{type:'keyword',text},metric:'search_volume_mobile',value:100,period:{from:'2026-08-02',to:'2026-09-01'}},
])};
check(snapshot.status==='partial','missing supplier counts mark a partial collection');
const series=S.buildSeries([snapshot]);
const anchors=key=>C.groupAnchors([{key,month:series.find(s=>s.subjectKey===`kw:${key}`&&s.metric==='search_volume_month')?.points,pc:series.find(s=>s.subjectKey===`kw:${key}`&&s.metric==='search_volume_pc')?.points,mobile:series.find(s=>s.subjectKey===`kw:${key}`&&s.metric==='search_volume_mobile')?.points}]);
check(anchors('누락').points.length===0,'collector missing values remain missing through series');
check(anchors('소량').points[0]?.value===105&&anchors('소량').bounded.length===1,'explicit under-ten evidence survives collector and series');
const owner='recalibration-regression';
const put=(kind,id,data)=>sql.prepare('INSERT INTO records(id,owner,kind,parent_id,data,updated_at) VALUES(?,?,?,?,?,?)').run(`${owner}:${kind}:${id}`,owner,kind,'',JSON.stringify(data),'2026-09-01T00:00:00Z');
put('pr_snapshot','allowed-evidence',{id:'allowed-evidence',sourceId:'own_sales',fetchedAt:'2026-09-01T00:00:00Z'});
const outcomes=Array.from({length:8},(_,i)=>{
 const p=i<4?0:1,id=`d${i}`,scoreCardId=`s${i}`;
 put('pr_decision',id,{id,productId:`p${p}`,scoreCardId});
 put('pr_score',scoreCardId,{id:scoreCardId,productId:`p${p}`,weightsVersion:'w1',subScores:[{key:'momentum',value:p?90:10,evidence:['allowed-evidence']}]});
 return {decisionId:id,productId:`p${p}`,sku:`SKU${p}`,handedOffAt:'2026-07-01T00:00:00Z',windows:[{weeks:8,complete:true,revenue:p?200:100}]};
});
const proposal=await O.weightsCandidate(owner,outcomes,new Date('2026-10-03T00:00:00Z'));
check(proposal.n===2&&proposal.proposed===null,'repeated approvals of two products are two independent samples, not eight');
console.log(JSON.stringify({passed,external:'not_called',database:'real SQLite',provider:'mocked'}));
