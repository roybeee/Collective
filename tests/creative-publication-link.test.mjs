// 소재 예측 점수 자동 보정 회귀(G2, docs/CREATIVE-SCORE.ko.md 4절): 작업물 판 ↔ 발행 연결(artifact_publication_link)·외부 게시물 ID·관측 붙이기·
// 연결 관측으로 브랜드×채널 보정표 다시 계산(멱등·7일 간격)·백필·Meta 광고 연결·API 권한. 근거: mocked(메모리 SQLite, Instagram Graph fetch 스텁, 로컬 인증 헤더).
import assert from 'node:assert/strict';
import {testRuntime} from './helpers/runtime.mjs';

let graphCalls=0;
const {sql,load}=testRuntime(async url=>{graphCalls++;if(!String(url).startsWith('https://graph.facebook.com/'))throw Error('unexpected destination');return Response.json(String(url).includes('/insights')?{data:[{name:'reach',values:[{value:400}]},{name:'shares',values:[{value:12}]}]}:String(url).includes('fields=username')?{username:'fixture'}:{timestamp:'2026-09-01T00:00:00Z',media_type:'IMAGE'})});
const errors=[];const originalError=console.error;console.error=(...a)=>{errors.push(a.join(' '))};
const server=await load('lib/server.ts'),flags=await load('lib/feature-flags.ts'),pure=await load('lib/creative-publication-link.ts'),links=await load('lib/creative-publication-link-server.ts');
const creds=await load('lib/channel-credentials.ts'),collector=await load('lib/measurement-collection.ts'),route=await load('app/api/creative-score/route.ts'),registry=await load('lib/record-kinds.ts'),summary=await load('lib/deletion-summary.ts');
const passed=[];const check=(name,val)=>{assert.ok(val,name);passed.push(name)};
const plain=x=>JSON.parse(JSON.stringify(x));
const ORIGIN='https://agency.test',O='g2-link-owner',X='g2-link-other',now=new Date().toISOString(),ago=d=>new Date(Date.now()-d*86400000).toISOString();
const SCHEDULED=ago(10);
const save=(owner,kind,id,data,parent='')=>server.recordStatement(owner,kind,id,data,parent).run();
const rows=(kind,owner=O)=>sql.prepare('SELECT id,parent_id,data FROM records WHERE owner=? AND kind=? ORDER BY id').all(owner,kind).map(r=>({...JSON.parse(r.data),rowId:r.id,parentId:r.parent_id}));
const on=owner=>flags.setFeatureFlag(owner,{flag:'creative_score',enabled:true},{id:owner,email:null});

// ── 1) 순수 함수 ──
const pub=(id,extra={})=>({id,campaignId:'c1',creativeId:'cr',creativeVersion:1,campaignVersion:1,pngHash:'h',factRefs:[],caption:'캡션 '+id,mediaUrl:'',scheduledAt:SCHEDULED,plannedCostKRW:0,version:1,status:'draft',createdAt:ago(11),copy:{artifactId:'a-'+id,artifactVersion:1,index:0,text:'카피'},...extra});
check('a Buffer channel id maps to buffer and direct ids to their publisher',pure.linkChannelOf({channelId:'buf-123'})==='buffer'&&pure.linkChannelOf({channelId:'instagram_direct:17841'})==='instagram_direct'&&pure.linkChannelOf({channelId:'threads:99'})==='threads');
check('a Buffer post number is not an external id; the linked Instagram media id is',pure.externalIdOf({channelId:'buf',providerId:'buffer-post',status:'published'})===null&&pure.externalIdOf({channelId:'buf',providerId:'buffer-post',status:'published',media:{mediaId:'555'}})==='555');
check('a direct publication exposes its provider id only once published',pure.externalIdOf({channelId:'instagram_direct:1',providerId:'777',status:'uncertain'})===null&&pure.externalIdOf({channelId:'instagram_direct:1',providerId:'777',status:'published'})==='777');
check('a publication without artifact copy is not linked',pure.linkFromPublication({...pub('p0'),copy:undefined},'gb',now)===null);
const l1=pure.linkFromPublication(pub('p1'),'gb',now),l1b=pure.linkFromPublication(pub('p1'),'gb',ago(-1),l1);
check('re-deriving the same publication is the same link (only updatedAt differs)',pure.sameLink(l1,l1b)&&l1b.createdAt===l1.createdAt);
const withM=pure.withMetrics({...l1,externalId:'9'},{impressions:100,clicks:3,source:'measurement',definition:'d',observedAt:now},now);
check('metrics survive a re-derive with the same external id and are dropped when it changes',pure.linkFromPublication(pub('p1',{media:{mediaId:'9'}}),'gb',now,withM).metrics?.impressions===100&&pure.linkFromPublication(pub('p1',{media:{mediaId:'10'}}),'gb',now,withM).metrics===null);
check('an arm with clicks above impressions or a missing value is not an observation',pure.metricsFromArm({denominator:5,numerator:9},'d',now)===null&&pure.metricsFromArm({denominator:null,numerator:1},'d',now)===null&&pure.metricsFromArm({denominator:50,numerator:2},'d',now)?.clicks===2);
check('meta rows are summed per ad id',plain(pure.metricsFromMetaRows([{adId:'1',impressions:10,clicks:1},{adId:'1',impressions:30,clicks:2},{adId:'2',impressions:99,clicks:9}],'1',now)).impressions===40);

// ── 2) 합성 데이터 ──
await save(O,'brand','gb',{id:'gb',name:'가상분식',short:'GB'});
const campaign={id:'c1',brandId:'gb',title:'가상분식 오픈',goal:'첫 포장 주문',audience:'가상동',channels:'Instagram',stores:'',products:'떡볶이',budget:null,startDate:'',endDate:'',constraints:'',sources:'',status:'review',version:1,createdAt:now,updatedAt:now};
await save(O,'campaign','c1',campaign);
const comps=p=>[{key:'hook',label:'훅',points:p,max:20,evidence:[]},{key:'clarity',label:'명확',points:10,max:15,evidence:[]}];
const N=12;
for(let i=0;i<N;i++){
 const score=30+i*5;
 await save(O,'artifact','a-q'+i,{id:'a-q'+i,campaignId:'c1',campaignVersion:1,role:'content',title:'t',content:'본문 '+i,version:1,status:'approved',origin:'manual',createdAt:now},'c1');
 await save(O,'creative_score','a-q'+i+':1',{version:'v',score,band:score>=70?'높음':score>=40?'보통':'낮음',components:comps(Math.min(20,i*2)),flags:[],sample:{n:0,window:null},label:'',id:'a-q'+i+':1',artifactId:'a-q'+i,artifactVersion:1,campaignId:'c1',brandId:'gb',channel:'Instagram',inputHash:'x',rulesVersion:'r',ruleIds:[],computedAt:now},'c1');
}

// ── 3) 스위치 꺼짐: 연결 0행 ──
check('creative_score defaults to off',await flags.isEnabled(O,'creative_score')===false);
check('with the switch off the publication hook writes nothing',await links.recordPublicationLink(O,pub('q0',{copy:{artifactId:'a-q0',artifactVersion:1,index:0,text:'x'}}))==='skipped'&&rows('artifact_publication_link').length===0);
check('with the switch off measurement attachment is a no-op',await links.attachMeasurement(O,{connector:'instagram',target:'1',arm:{denominator:50,numerator:1},definition:'d',fetchedAt:now})===0);
check('with the switch off maintenance reads nothing else and is idle',(await links.runCreativeCalibrationMaintenance(O)).reason==='switch_off'&&rows('creative_calibration_run').length===0);

// ── 4) 스위치 켜짐: 연결 기록 ──
await on(O);
const qpub=(i,extra={})=>pub('q'+i,{copy:{artifactId:'a-q'+i,artifactVersion:1,index:0,text:'카피'},...extra});
check('the publication hook writes one link under the campaign',await links.recordPublicationLink(O,qpub(0))==='linked'&&rows('artifact_publication_link').length===1&&rows('artifact_publication_link')[0].parentId==='c1'&&rows('artifact_publication_link')[0].artifactId==='a-q0');
check('the same publication again writes nothing',await links.recordPublicationLink(O,qpub(0))==='same');
const wr=await links.recordPublicationLink(O,{publication:qpub(0,{status:'published',media:{mediaId:'9000'}})});check('a response wrapper {publication} is unwrapped (link_media shape)',wr==='linked'&&rows('artifact_publication_link')[0].externalId==='9000'&&!!rows('artifact_publication_link')[0].publishedAt);
check('a publication of an unknown campaign is swallowed and logged',await links.recordPublicationLink(O,{...qpub(0),id:'zz',campaignId:'nope'})==='error'&&errors.includes('creative_link_error'));

// ── 5) 측정 수집 훅: 실제 collectForExperiment(Instagram fetch 스텁) ──
await server.seedBrands?.(O);
await save(O,'viral_experiment','e1',{id:'e1',campaignId:'c1',brandId:'gb',channel:'Instagram',metric:'share_rate',status:'running'},'c1');
await creds.saveCredential(O,'instagram',{accessToken:'synthetic-fixture',userId:'17841400000000000'},{brandId:'gb'});
await collector.collectForExperiment(O,{experimentId:'e1',arm:'control',channel:'instagram',target:'9000',from:'2026-09-01',to:'2026-09-02'});
let link0=rows('artifact_publication_link').find(l=>l.id==='q0');
check('a measurement collected for the linked media id attaches reach/shares to the link',graphCalls>0&&link0.metrics?.impressions===400&&link0.metrics.clicks===12&&link0.metrics.source==='measurement');
const before=link0.updatedAt;
check('re-attaching the same values changes nothing',await links.attachMeasurement(O,{connector:'instagram',target:'9000',arm:{denominator:400,numerator:12},definition:link0.metrics.definition,fetchedAt:now})===0&&rows('artifact_publication_link').find(l=>l.id==='q0').updatedAt===before);
check('a different connector does not attach to an Instagram link',await links.attachMeasurement(O,{connector:'naver_ads',target:'9000',arm:{denominator:9,numerator:1},definition:'d',fetchedAt:now})===0);

// ── 6) 백필: 기존 발행(게시물 ID 있음) → 연결, 저장된 측정 초안으로 관측 ──
for(let i=1;i<N;i++){
 await save(O,'execution_publication','q'+i,qpub(i,{status:'published',media:{mediaId:String(9000+i)}}),'c1');
 await save(O,'measurement_draft','m'+i,{id:'m'+i,experimentId:'m'+i,channel:'instagram',arms:{control:{value:{denominator:100,numerator:1+i,source:'s'},window:{from:'2026-09-01',to:'2026-09-02'},definition:'도달 대비 공유',limitations:[],fetchedAt:now,target:String(9000+i)}},comparable:false,definition:'',window:{from:'2026-09-01',to:'2026-09-02'},limitations:[],fetchedAt:now,updatedAt:now},'c1');
}
await save(O,'execution_publication','q0',qpub(0,{status:'published',media:{mediaId:'9000'}}),'c1');
await save(O,'execution_publication','plain',{...pub('plain'),copy:undefined},'c1');
const bf=await links.backfillPublicationLinks(O);
check('backfill links every publication with artifact copy and skips plain captions',bf.scanned===N&&bf.linked===N-1&&rows('artifact_publication_link').length===N&&!rows('artifact_publication_link').some(l=>l.id==='plain'));
check('backfill attaches stored measurement drafts by external id',bf.metrics===N-1&&rows('artifact_publication_link').every(l=>l.metrics));
const bf2=await links.backfillPublicationLinks(O);
check('a second backfill writes nothing (idempotent)',bf2.linked===0&&bf2.metrics===0&&bf2.same===N);

// ── 7) 보정표: 연결 관측 12건 → 방향성(표본 부족), 멱등, 7일 간격 ──
const first=await links.runCreativeCalibrationMaintenance(O);
let tables=rows('creative_calibration');
check('the weekly run writes one linked table per brand and score channel',first.status==='processed'&&first.written===1&&tables.length===1&&tables[0].rowId===`${O}:creative_calibration:gb:Instagram`&&tables[0].parentId==='gb'&&tables[0].source==='linked');
check('12 linked observations are directional with a sample window',tables[0].status==='directional'&&tables[0].n===N&&!!tables[0].window);
const computed=tables[0].computedAt;
check('a run within 7 days is not due and touches nothing',(await links.runCreativeCalibrationMaintenance(O)).reason==='not_due'&&rows('creative_calibration')[0].computedAt===computed);
const later=await links.runCreativeCalibrationMaintenance(O,Date.now()+8*86400000);
check('the next week recomputes but writes nothing when the table is unchanged',later.status==='processed'&&later.written===0&&rows('creative_calibration')[0].computedAt===computed);
const direct=await links.recomputeLinkedCalibrations(O);
check('recompute is idempotent',direct.written===0&&direct.groups===1);
// 관측이 바뀌면 다시 쓴다.
await links.attachMeasurement(O,{connector:'instagram',target:'9001',arm:{denominator:100,numerator:90},definition:'도달 대비 공유',fetchedAt:now});
check('a changed observation rewrites the table',(await links.recomputeLinkedCalibrations(O)).written===1);

// 사람이 만든 표는 연결 관측이 부족하면 덮지 않는다.
await save(O,'brand','gb2',{id:'gb2',name:'둘째'});
await save(O,'campaign','c2',{...campaign,id:'c2',brandId:'gb2'});
await save(O,'creative_calibration','gb2:Instagram',{version:'creative-calibration-v1',brandId:'gb2',channel:'Instagram',status:'usable',label:'관측 기반 보정표',n:30,window:null,excluded:{tooRecent:0,tooFewImpressions:0,invalid:0},bins:[],monotonic:true,agreement:null,components:[],limits:[],computedAt:'2026-01-01T00:00:00.000Z'},'gb2');
await save(O,'creative_score','a-z:1',{score:50,band:'보통',components:comps(5),artifactId:'a-z',artifactVersion:1,campaignId:'c2',brandId:'gb2',channel:'Instagram'},'c2');
await save(O,'artifact_publication_link','z1',{id:'z1',artifactId:'a-z',artifactVersion:1,publicationId:'z1',campaignId:'c2',brandId:'gb2',channel:'buffer',externalId:'1',publishedAt:ago(9),metrics:{impressions:100,clicks:1,source:'measurement',definition:'d',observedAt:now},createdAt:now,updatedAt:now},'c2');
await links.recomputeLinkedCalibrations(O);
check('a manual table is not replaced by an insufficient linked table',rows('creative_calibration').find(t=>t.brandId==='gb2').computedAt==='2026-01-01T00:00:00.000Z');

// ── 8) Meta 광고 연결 ──
await save(O,'meta_ads_insights','c1',{id:'c1',campaignId:'c1',brandId:'gb',rows:[{date:'2026-09-01',accountId:'1',externalCampaignId:'2',adId:'4242',spendMinor:100,impressions:500,clicks:20,purchases:null,purchaseValueMinor:null}],collectedAt:now},'c1');
const meta=await links.linkMetaAd(O,{artifactId:'a-q3',adId:'4242',publishedAt:ago(10)});
check('a meta ad link picks up stored insights for that ad id',meta.written===true&&meta.link.channel==='meta'&&meta.link.id==='meta:4242'&&meta.link.metrics?.impressions===500&&meta.link.metrics.source==='meta_insights');
await assert.rejects(()=>links.linkMetaAd(O,{artifactId:'a-q3',adId:'abc',publishedAt:now}),e=>e.status===400);passed.push('a non-numeric meta ad id is a 400');
await assert.rejects(()=>links.linkMetaAd(O,{artifactId:'missing',adId:'1',publishedAt:now}),e=>e.status===404);passed.push('an unknown artifact is a 404');
check('linking the same meta ad again writes nothing',(await links.linkMetaAd(O,{artifactId:'a-q3',adId:'4242',publishedAt:meta.link.publishedAt})).written===false);

// ── 9) API 권한 ──
const as=who=>({'oai-authenticated-user-id':who});
const P=(input,headers)=>route.POST(new Request(`${ORIGIN}/api/creative-score`,{method:'POST',headers:{'content-type':'application/json',origin:ORIGIN,...headers},body:JSON.stringify(input)}));
const linked=await P({action:'calibrate_linked'},as(O));const lb=await linked.json();
check('POST calibrate_linked returns the linked tables',linked.status===200&&lb.groups>=1&&Array.isArray(lb.tables));
check('POST calibrate_linked with the switch off is a 409',(await P({action:'calibrate_linked'},as(X))).status===409);
check('POST backfill_links with the switch off is a 409',(await P({action:'backfill_links'},as(X))).status===409);
check('POST link_meta_ad with the switch off is a 409',(await P({action:'link_meta_ad',artifactId:'a',adId:'1',publishedAt:now},as(X))).status===409);
check('another owner sees none of these links',rows('artifact_publication_link',X).length===0);

// ── 10) 등록 ──
const kinds=plain(registry.recordKinds),k=kinds.find(x=>x.kind==='artifact_publication_link'),run=kinds.find(x=>x.kind==='creative_calibration_run');
check('links are deleted with their campaign and the run state is workspace scoped',k?.parent==='campaign'&&k.campaignDeletion==='delete'&&run?.parent==='none'&&run.campaignDeletion==='not_campaign_scoped');
check('the deletion dialog names linked observations',summary.deletionSummary({campaignId:'c1',version:1,deletable:true,blockedReason:null,deleted:{campaign:1,artifact_publication_link:4},retained:{},jobs:0,totals:{deleted:5,retained:0}}).deleted.includes('소재 점수 보정 연결 4건'));

console.error=originalError;
console.log(JSON.stringify({passed:passed.length,checks:passed,sqlite:'real',auth:'mocked',external:'mocked instagram graph'},null,1));
