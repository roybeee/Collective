// 상품 리서치 분석 계층(lib/product-research/analytics/*) 단위 검사. 순수 함수만 부르고 외부 호출은 없다(fetch 스텁은 던진다).
import assert from 'node:assert/strict';import {createHash} from 'node:crypto';import {testRuntime} from './helpers/runtime.mjs';
const {load}=testRuntime(async()=>{throw Error('외부 호출 금지')});
const L=f=>load(`lib/product-research/analytics/${f}.ts`);
// 로더는 동시 링크에 안전하지 않아 차례로 올린다.
const mods=[];for(const f of ['hash','normalize','match','series','calibrate','trend','competition','profit','risk','score'])mods.push(await L(f));
const [HASH,N,M,S,C,TR,CO,P,R,SC]=mods;
let passed=0;const ok=(v,n)=>{assert.ok(v,n);passed++};const eq=(a,b,n)=>{assert.equal(a,b,n);passed++};const js=v=>JSON.stringify(v);
const near=(a,b,tol,n)=>{assert.ok(Math.abs(a-b)<=tol,`${n}: ${a} vs ${b}`);passed++};
const snap=(id,sourceId,observations,x={})=>({id,sourceId,method:'api',request:{},fetchedAt:x.fetchedAt??'2026-09-01T00:00:00Z',bodyDigest:'0'.repeat(64),bodyBytes:1,status:x.status??'ok',limitations:[],importedBy:null,observations});
const kw=text=>({type:'keyword',text});const day=(d,n)=>new Date(Date.parse(d+'T00:00:00Z')+n*86400000).toISOString().slice(0,10);
const weekly=(vals,start='2025-01-05',sid='s')=>vals.map((v,i)=>({at:day(start,7*i),value:v,snapshotId:`${sid}${i}`}));

// ── hash: 동기 SHA-256이 node:crypto와 같고, 키 순서와 무관한 다이제스트
for(const s of ['','abc','마라소스 500g','a'.repeat(1000),'😀'.repeat(33)])eq(HASH.sha256Hex(s),createHash('sha256').update(s).digest('hex'),'sha256 '+s.slice(0,8));
eq(HASH.stableJson({b:1,a:[2,{d:null,c:undefined}]}),'{"a":[2,{"d":null}],"b":1}','stable json');
eq(HASH.digestOf({a:1,b:2}),HASH.digestOf({b:2,a:1}),'digest order independent');ok(HASH.shortId('kg','마라소스').startsWith('kg_'),'short id prefix');

// ── normalize
eq(N.normalizeKeyword('마라 쏘스 1kg'),'마라소스','space+variant+unit');eq(N.normalizeKeyword('Kombucha!! 30개입'),'kombucha','latin lower+count');
eq(N.normalizeKeyword('약과 1+1'),'약과','1+1 noise');eq(N.normalizeKeyword('마라소스 500g x2'),'마라소스','multiplier noise');eq(N.normalizeKeyword('떡뽁이 소스'),'떡볶이소스','variant');
eq(N.normalizeKeyword('ＡＢＣ'.normalize('NFKC')),'abc','nfkc input');eq(N.normalizeKeyword('가'),'가','NFC composes jamo');
ok(N.sameDemand('마라소스','마라소스추천')===false&&N.sameDemand('마라소스','마라소스맛')===true&&N.sameDemand('두바이초콜릿','두바이초콜릿맛')===true,'0.8 containment ratio');
const g1=N.groupKeywords(['마라 소스','마라소스','마라쏘스 1kg','유자차','유자 차 500g','마라탕','마라소스추천']),g2=N.groupKeywords(['마라소스추천','유자 차 500g','마라탕','마라쏘스 1kg','유자차','마라소스','마라 소스']);
eq(js(g1),js(g2),'grouping order independent');eq(g1.length,4,'four clusters');
const mara=g1.find(c=>c.normalized==='마라소스');eq(js(mara.keywords),js(['마라 소스','마라소스','마라쏘스 1kg']),'mara members');eq(mara.id,HASH.shortId('kg','마라소스'),'id = hash of normalized label');
eq(mara.categoryId,'food_sauce','seed category');eq(g1.find(c=>c.normalized==='유자차').categoryId,'food_tea_drink','tea category');
eq(N.seedCategoryOf('김부각'),'food_snack','longest seed wins');eq(N.seedCategoryOf('김치'),'food_chilled','김치 not 김');eq(N.seedCategoryOf('김'),'food_dried','one-char exact');eq(N.seedCategoryOf('야채튀김'),null,'one-char seed not substring');
eq(N.seedCategoryOf('정체불명'),null,'unknown stays null');
const grp=N.toKeywordGroup(mara,'2026-10-03T00:00:00Z');eq(grp.label,mara.label,'group label');eq(N.clusterOf(g1,'마라 쏘스').id,mara.id,'cluster lookup');

// ── match
eq(js(M.parseSize('햇반 210g x 12개')),js({amount:210,unit:'g',count:12,countStated:true}),'size parse');eq(M.parseSize('유자차 1kg').amount,1000,'kg');eq(M.parseSize('식혜 1.5L').unit,'ml','liter');
eq(M.sizeAgreement(M.parseSize('500g'),M.parseSize('1kg')),'conflict','size conflict');eq(M.sizeAgreement(M.parseSize('1kg'),M.parseSize('1000g')),'agree','size agree');eq(M.sizeAgreement(M.parseSize('마라소스'),M.parseSize('500g')),'unknown','size unknown');
const li=(id,title,brand=null,x={})=>({type:'listing',sourceId:x.sourceId??'naver_shop_search',externalId:id,title,brand,price:x.price??null,url:null,categoryPath:null,barcode:x.barcode??null});
let p=M.scorePair(li('a','오뚜기 마라소스 500g','오뚜기'),li('b','[오뚜기] 마라 소스 500g 무료배송',null,{sourceId:'coupang_partners'}));eq(p.decision,'merge','same sku merges');eq(p.detail.brand,'agree','bracket brand');
p=M.scorePair(li('a','오뚜기 마라소스 500g','오뚜기'),li('b','오뚜기 마라소스 1kg','오뚜기'));eq(p.decision,'separate','size veto');
p=M.scorePair(li('a','삼양 불닭소스 200g','삼양'),li('b','청정원 불닭소스 200g','청정원'));eq(p.decision,'separate','brand veto');
p=M.scorePair(li('a','마라소스 500g'),li('b','마라소스 500g'));eq(p.decision,'confirm','unknown brand needs confirmation');near(p.confidence,0.93,1e-9,'unknown brand factor');
p=M.scorePair(li('a','오뚜기 들기름 160ml','오뚜기',{barcode:'8801045000001'}),li('b','완전히 다른 이름','x',{barcode:'8801045000001'}));eq(p.method,'barcode','barcode first');eq(p.confidence,1,'barcode exact');
p=M.scorePair(li('a','오뚜기 들기름 160ml','오뚜기',{barcode:'8801045000001'}),li('b','오뚜기 들기름 160ml','오뚜기',{barcode:'8801045000018'}));eq(p.decision,'separate','different barcode separate');
eq(M.decide(0.95),'merge','0.95 merge');eq(M.decide(0.9499),'confirm','below .95 confirm');eq(M.decide(0.8),'confirm','.8 confirm');eq(M.decide(0.7999),'separate','below .8 separate');
const mr=M.matchListings([li('a','오뚜기 마라소스 500g','오뚜기',{price:4900}),li('b','[오뚜기] 마라 소스 500g',null,{sourceId:'coupang_partners',price:5200}),li('c','마라소스 500g',null,{sourceId:'licensed_ranking'}),li('d','담터 유자차 1kg','담터')]);
eq(mr.products.length,3,'a+b merged, c pending, d separate');const ab=mr.products.find(x=>x.listings.length===2);eq(ab.method,'brand_name_size','merge method');ok(ab.confidence>=0.95,'merged confidence');
eq(js(ab.priceBand),js({min:4900,max:5200}),'price band');ok(ab.pendingWith.length===1,'pending link to unbranded listing');eq(ab.classification.categoryId,'food_sauce','category');eq(ab.classification.temperature,'ambient','ambient from category');
const rp=M.toResearchProduct(ab,'2026-10-03T00:00:00Z',[mara.id]);eq(rp.match.confirmedBy,null,'not confirmed');eq(rp.listings.length,2,'listings carried');eq(rp.regulatory,'food','regulatory');
eq(js(M.matchListings([...mr.products.flatMap(x=>x.listings)].reverse()).products.map(x=>x.key)),js(mr.products.map(x=>x.key)),'match order independent');
let cl=M.classifyListing('비비고 왕교자 냉동만두 1.05kg');eq(cl.temperature,'frozen','frozen hint');eq(cl.categoryId,'food_frozen','frozen category');
cl=M.classifyListing('담터 아이스 유자차');eq(cl.temperature,'chilled','아이스 hint');cl=M.classifyListing('립톤 아이스티 복숭아 분말');ok(cl.temperature!=='chilled','아이스티 is powder');
cl=M.classifyListing('락토핏 유산균 젤리 30포');eq(cl.regulatory,'health_functional_food','hff');cl=M.classifyListing('정체불명 신상품');eq(cl.categoryId,null,'unknown category');eq(cl.temperature,'unknown','unknown temp');eq(cl.regulatorySure,false,'regulatory unsure');
cl=M.classifyListing('신상 매운 소스','식품>소스>마라소스');eq(cl.categoryId,'food_sauce','category path fallback');

// ── series
const s1=snap('s1','naver_searchad_keyword',[{subject:kw('마라 소스'),metric:'search_volume_month',value:100,period:{from:'2026-08-01',to:'2026-08-30'}}],{fetchedAt:'2026-08-31T00:00:00Z'});
const s2=snap('s2','naver_searchad_keyword',[{subject:kw('마라소스'),metric:'search_volume_month',value:120,period:{from:'2026-08-01',to:'2026-08-30'}},{subject:kw('마라소스'),metric:'search_volume_month',value:130,period:{from:'2026-08-31',to:'2026-09-29'}}],{fetchedAt:'2026-09-30T00:00:00Z'});
const s3=snap('s3','naver_searchad_keyword',[{subject:kw('마라소스'),metric:'search_volume_month',value:null,period:{from:'2026-08-31',to:'2026-09-29'}}],{fetchedAt:'2026-10-01T00:00:00Z'});
const s4=snap('s4','naver_searchad_keyword',[{subject:kw('마라소스'),metric:'search_volume_month',value:999,period:{from:'2026-08-31',to:'2026-09-29'}}],{fetchedAt:'2026-10-02T00:00:00Z',status:'failed'});
const built=S.buildSeries([s3,s1,s4,s2]);eq(built.length,1,'one series (keyword normalized)');eq(built[0].subjectKey,'kw:마라소스','subject key');
eq(js(built[0].points),js([{at:'2026-08-30',value:120,snapshotId:'s2'},{at:'2026-09-29',value:130,snapshotId:'s2'}]),'later fetch wins, null never overrides, failed dropped');
eq(S.sliceAsOf(built[0],'2026-09-28').points.length,1,'slice as of');eq(S.latestValue(built[0].points).value,130,'latest value');
const views=[{at:'2026-09-01',value:1000,snapshotId:'v1'},{at:'2026-09-03',value:1600,snapshotId:'v2'},{at:'2026-09-03',value:null,snapshotId:'vx'},{at:'2026-09-08',value:1500,snapshotId:'v3'},{at:'2026-09-10',value:2500,snapshotId:'v4'}];
eq(js(S.videoViewVelocity(views)),js([{at:'2026-09-03',value:300,snapshotId:'v2'},{at:'2026-09-08',value:null,snapshotId:'v3'},{at:'2026-09-10',value:500,snapshotId:'v4'}]),'velocity per day, drop = unknown');
eq(S.velocitySeries({subjectKey:'kw:x',metric:'video_views',sourceId:'youtube_data',points:views}).metric,'video_view_velocity','velocity metric');
const wk=S.toWeekly([{at:'2026-09-07',value:10,snapshotId:'a'},{at:'2026-09-09',value:20,snapshotId:'b'},{at:'2026-09-14',value:5,snapshotId:'c'}]);eq(js(wk),js([{at:'2026-09-09',value:15,snapshotId:'b'},{at:'2026-09-14',value:5,snapshotId:'c'}]),'weekly buckets never move forward in time');

// ── calibrate: 상대값 50(30일 창) + 실측 10,000 → 배율 200. 이전 기준점 9,000(상대 40) → 예측 8,000, 오차 11.1%
const rel=weekly([40,40,40,40,40,50,50,50,50,50],'2026-06-07','dl');const anchors=[{at:'2026-07-04',value:9000,snapshotId:'sa1'},{at:'2026-08-09',value:10000,snapshotId:'sa2'}];
const cal=C.calibrateTrend(rel,anchors);eq(cal.anchor.snapshotId,'sa2','latest anchor');near(cal.scale,200,1e-9,'scale');near(cal.error.relative,1000/9000,1e-12,'relative error');eq(cal.error.checks.length,1,'one check');
eq(cal.points[9].value,10000,'calibrated point');ok(cal.evidence.includes('sa2')&&cal.evidence.includes('dl9'),'evidence ids');near(C.currentVolume(cal),10000,1e-9,'current volume');
eq(C.calibrateTrend(rel,[]),null,'no anchor → null');eq(C.calibrateTrend(rel,[{at:'2020-01-01',value:5,snapshotId:'old'}]),null,'anchor outside relative window → null');
eq(C.calibrateTrend(rel,[anchors[1]]).error,null,'one anchor no error');eq(C.currentVolume(null),null,'current volume null');
ok(cal.monthly.every(m=>m.volume>0)&&cal.monthly[0].complete===false,'monthly series, edge month incomplete');

// ── trend
const ts=TR.theilSen([0,1,2,3,4,5],[0,1,2,3,40,5]);near(ts.slope,1,1e-9,'theil-sen ignores outlier');
const mk=f=>weekly(Array.from({length:70},(_,i)=>f(i)));const wiggle=i=>1+0.04*Math.sin(i*1.7);
let t=TR.analyzeTrend(mk(i=>1000*Math.exp(0.04*Math.max(0,i-50))*wiggle(i)));eq(t.durability,'rising','rising');near(t.slope12,0.04,0.006,'slope ≈ 4%/wk');
t=TR.analyzeTrend(mk(i=>1000*wiggle(i)));eq(t.durability,'steady','steady');near(t.yoy,1,0.1,'yoy ~1');
t=TR.analyzeTrend(mk(i=>1000*Math.exp(-0.03*Math.max(0,i-40))*wiggle(i)));eq(t.durability,'declining','declining (monotone, not seasonal)');
t=TR.analyzeTrend(mk(i=>1000*(1+0.6*Math.cos(2*Math.PI*(i-40)/52))*wiggle(i)));eq(t.durability,'seasonal','seasonal');ok(t.seasonalCorr>0.8&&t.seasonalOutlook!==null,'seasonal stats');
t=TR.analyzeTrend(mk(i=>1000*(i>=40?1+6*Math.exp(-(i-40)/1.2):1)*wiggle(i)));eq(t.durability,'fad','old fad');ok(t.fad.halfLifeWeeks<=4&&t.fad.ratio>=3,'half-life ≤4 and ≥3x');
t=TR.analyzeTrend(mk(i=>1000*(i===69?6:1)*wiggle(i)));eq(t.durability,'fad','spiking now');eq(t.spiking,true,'spiking flag');ok(t.preSpikeSlope!==null&&Math.abs(t.preSpikeSlope)<0.01,'pre-spike slope excludes spike');
t=TR.analyzeTrend(mk(i=>1000*(i>=60?3.5:1)*wiggle(i)));ok(t.durability!=='fad','sustained step is not a fad');
t=TR.analyzeTrend(weekly([1,2,3]));eq(t.durability,null,'<4 weeks null');eq(t.slope12,null,'slope null not 0');
t=TR.analyzeTrend(weekly(Array.from({length:20},(_,i)=>100+i)));eq(t.seasonalOutlook,null,'no seasonality under 1y');ok(t.reasons.some(r=>r.includes('1년 미만')),'reason says short history');
eq(TR.pearson([1,2,3],[2,4,6]),1,'pearson');

// ── competition
const lst=(n,f)=>Array.from({length:n},(_,i)=>({key:'l'+i,rank:i+1,reviewCount:f(i),price:10000+i*500,firstSeenAt:'2026-01-01'}));
near(CO.top10Hhi(lst(10,()=>100)),0.1,1e-12,'equal shares hhi .1');near(CO.top10Hhi(lst(10,i=>i===0?1000:0)),1,1e-12,'monopoly hhi 1');eq(CO.top10Hhi(lst(2,()=>5)),null,'too few');
near(CO.priceDispersion(lst(5,()=>1)),(11500-10500)/11000,1e-12,'IQR/median');
eq(CO.newEntrantShare({asOf:'2026-03-01',historyStart:'2026-02-01',listings:lst(10,()=>1)}),null,'short history → null');
eq(CO.newEntrantShare({asOf:'2026-09-01',historyStart:'2026-01-01',listings:lst(10,()=>1).map((l,i)=>i<3?{...l,firstSeenAt:'2026-08-20'}:l)}),0.3,'new entrant share');
const base={asOf:'2026-09-01',sellerCount:null,productCount:null,adCompetition:null,listings:[],historyStart:null,evidence:[]};
eq(CO.assessCompetition(base).score,null,'no data → null');
const lo=CO.assessCompetition({...base,sellerCount:20,adCompetition:0.2}),hi=CO.assessCompetition({...base,sellerCount:5000,adCompetition:0.9});ok(hi.score>lo.score,'more sellers+ads harder');ok(lo.reasons.length>=2,'reasons');
const cs=S.buildSeries([snap('n1','naver_shop_search',[{subject:kw('마라소스'),metric:'seller_count',value:300,period:{from:'2026-08-01',to:'2026-08-01'}}]),snap('n2','naver_shop_search',[{subject:kw('마라소스'),metric:'seller_count',value:999,period:{from:'2026-12-01',to:'2026-12-01'}}])]);
const ci=CO.competitionInputFromSeries(cs,'kw:마라소스','2026-09-01');eq(ci.sellerCount,300,'future seller count ignored');eq(js(ci.evidence),js(['n1']),'evidence');
// 평가 2회차 M2: 순위가 없으면 '상위 20'을 정할 수 없어 신규 진입은 null(이름 순으로 고르지 않는다)
eq(CO.newEntrantShare({asOf:'2026-09-01',historyStart:'2026-01-01',listings:lst(10,()=>1).map(l=>({...l,rank:null,firstSeenAt:'2026-08-20'}))}),null,'no ranks → new entrant share null');
// 평가 2회차 M2: 관측 이력 시작은 목록 시계열에서만. 데이터랩 이력이 길어도 목록을 본 지 8주가 안 되면 신규 진입은 미확인(모두 신규로 보지 않는다).
{
 const dl=Array.from({length:30},(_,i)=>({subject:kw('마라소스'),metric:'search_trend',value:50,period:{from:day('2026-02-01',7*i),to:day('2026-02-01',7*i)}}));
 const lsObs=(d)=>Array.from({length:6},(_,i)=>({subject:{type:'listing',sourceId:'coupang_ranking_manual',externalId:'cp'+i,title:'상품'+i,brand:null,price:null,url:null,categoryPath:null},metric:'rank',value:i+1,period:{from:d,to:d}}));
 const ser=S.buildSeries([snap('dl','naver_datalab_search',dl),snap('l1','coupang_ranking_manual',lsObs('2026-08-20')),snap('l2','coupang_ranking_manual',lsObs('2026-08-27'))]);
 const cin=CO.competitionInputFromSeries(ser,'kw:마라소스','2026-09-01');
 eq(cin.historyStart,'2026-08-20','history start from listing series only (not DataLab)');eq(cin.listings.length,6,'six ranked listings');
 eq(CO.assessCompetition(cin).newEntrantShare,null,'short listing history → new entrant share null, not 100%');
 const longer=S.buildSeries([snap('dl','naver_datalab_search',dl),snap('l0','coupang_ranking_manual',lsObs('2026-05-01')),snap('l1','coupang_ranking_manual',lsObs('2026-08-20'))]);
 eq(CO.assessCompetition(CO.competitionInputFromSeries(longer,'kw:마라소스','2026-09-01')).newEntrantShare,0,'listing history ≥8 weeks → computed (all seen before the cut)');
}
eq(CO.competitionFromSnapshots([snap('n1','naver_shop_search',[{subject:kw('마라 소스'),metric:'seller_count',value:300,period:{from:'2026-08-01',to:'2026-08-01'}}])],'마라소스','2026-09-01').sellerCount,300,'from snapshots');

// ── profit: 판매가 20,000·원가 8,000·배송 3,000·포장 500·스마트스토어 5.63%·반품 2%·광고 2,000
let pr=P.simulateProfit({price:20000,unitCost:8000,shipping:3000,packaging:500,channel:'naver_smartstore',returnRate:0.02,adCostPerOrder:2000});
const rev=19600,fee=rev*0.0563,cba=rev-fee-8000-3000-500-0.02*3000;near(pr.revenue,rev,0.01,'revenue');near(pr.contributionBeforeAds,cba,0.01,'cba');near(pr.contribution,cba-2000,0.01,'contribution');
near(pr.marginPct,(cba-2000)/20000,1e-4,'margin');near(pr.breakevenRoas,20000/cba,0.01,'breakeven roas');eq(pr.feeAssumption,true,'fee marked assumption');ok(pr.notes.some(n=>n.includes('가정')),'assumption note');
pr=P.simulateProfit({price:20000,unitCost:null,shipping:3000,packaging:500,channel:'coupang'});eq(pr.contribution,null,'null cost propagates');eq(pr.marginPct,null,'null margin');ok(pr.missing.includes('단위 원가'),'missing listed');
pr=P.simulateProfit({price:20000,unitCost:8000,shipping:3000,packaging:500,channel:'coupang',adCostPerOrder:null});eq(pr.contribution,null,'unknown ad → contribution null');ok(pr.contributionBeforeAds>0,'but pre-ad known');
pr=P.simulateProfit({price:5000,unitCost:4000,shipping:3000,packaging:500,channel:'own_mall'});eq(pr.breakevenRoas,null,'negative cba → no roas');
pr=P.simulateProfit({price:20000,unitCost:8000,shipping:3000,packaging:500,channel:'oliveyoung',feeRate:0.25});eq(pr.feeRate,0.25,'fee override');eq(pr.feeAssumption,false,'override not assumption');
ok(Object.values(P.CHANNEL_FEES).every(f=>f.assumption===true&&f.verifiedAt===null),'all fee rows flagged unverified');
let pi=P.profitInputFromCandidate({unitCost:5000,moq:100,shippingCost:50000,extraCost:10000,taxBasis:'excluded',unit:'piece'},{price:20000,channel:'coupang',shippingPerOrder:3000,packaging:400});
near(pi.input.unitCost,(5000+600)*1.1,0.01,'landed cost amortized over MOQ + VAT');pi=P.profitInputFromCandidate({unitCost:5000,moq:null,shippingCost:50000,extraCost:0,taxBasis:'included',unit:'piece'},{price:20000,channel:'coupang',shippingPerOrder:3000,packaging:400});
eq(pi.input.unitCost,null,'cannot amortize without MOQ');pi=P.profitInputFromCandidate({unitCost:5000,moq:10,shippingCost:1000,extraCost:0,taxBasis:'included',unit:'piece'},{price:20000,channel:'coupang',shippingPerOrder:3000,packaging:400,orderQuantity:100});eq(pi.input.unitCost,5010,'order qty above MOQ');

// ── risk
let rk=R.assessRisk({regulatory:'food',temperature:'ambient',titles:['오뚜기 마라소스 500g']});eq(rk.level,'low','plain food low');eq(rk.items.filter(i=>i.rule.startsWith('food_')).length,5,'food checklist');eq(rk.blocked,null,'not blocked');
rk=R.assessRisk({regulatory:'health_functional_food',temperature:'ambient',titles:['유산균']});eq(rk.level,'blocked','hff blocked');eq(rk.blocked.rule,'hff_review','hff rule');
eq(R.assessRisk({regulatory:'health_functional_food',temperature:'ambient',titles:[],certified:{hffAdReview:true}}).level,'high','hff reviewed high');
eq(R.assessRisk({regulatory:'kc_electrical',temperature:'ambient',titles:[]}).level,'blocked','kc blocked');eq(R.assessRisk({regulatory:'kc_children',temperature:'ambient',titles:[],certified:{kc:true}}).level,'medium','kc certified medium');
eq(R.assessRisk({regulatory:'functional_cosmetics',temperature:'ambient',titles:[]}).level,'high','functional cosmetics high');eq(R.assessRisk({regulatory:'cosmetics',temperature:'ambient',titles:[]}).level,'medium','cosmetics medium');
rk=R.assessRisk({regulatory:'food',temperature:'frozen',titles:[]});eq(rk.level,'medium','frozen medium');ok(rk.items.some(i=>i.rule==='logistics'&&i.reason.includes('D1')),'logistics item D1');
eq(R.assessRisk({regulatory:'general',regulatorySure:false,temperature:'unknown',titles:[]}).level,'medium','unknown regulatory medium');
for(const [title,rule,level] of [['명품 st 지갑 정품 아님','counterfeit','blocked'],['레플리카 가방','counterfeit','blocked'],['당뇨 치료 효과 차','medical_claim','high'],['먹으면 살빠지는 차','diet_claim','high'],['3kg 감량 보장 쉐이크','diet_claim','high'],['마라소스 1+1','bundle_exaggeration','medium'],['샤넬st 립밤','trademark_style','medium']]){
 const x=R.assessRisk({regulatory:'general',temperature:'ambient',titles:[title]});ok(x.items.some(i=>i.rule===rule)&&R.maxLevel(x.level,level)===x.level,`text flag ${rule}: ${title}`);}
ok(!R.assessRisk({regulatory:'food',temperature:'ambient',titles:['베스트 마라소스']}).items.some(i=>i.rule==='trademark_style'),'best is not st');
eq(R.assessRisk({regulatory:'food',temperature:'ambient',titles:['불닭소스 맛 소스'],protectedBrands:['불닭']}).level,'high','protected brand high');
eq(R.assessRisk({regulatory:'food',temperature:'ambient',titles:['불닭소스'],protectedBrands:['불닭'],ownBrands:['불닭']}).level,'low','own brand ok');

// ── score: 결측 ≠ 0, 총점 null 조건, 분류, 신뢰도, 다이제스트
const W=SC.WEIGHT_SETS.w1;near(Object.values(W).reduce((a,b)=>a+b,0),1,1e-9,'weights sum 1');
const trendRising=TR.analyzeTrend(mk(i=>1000*Math.exp(0.04*Math.max(0,i-50))*wiggle(i)));
const input={productId:'p1',asOf:'2026-07-05',demand:{monthlyVolume:12300,keywords:['마라소스'],evidence:['sa-1']},trend:trendRising,rank:{current:5,previous:10,slope:null,evidence:['r1','r0']},
 video:{velocity:3000,previousVelocity:1000,videoCount:120,evidence:['y1']},competition:CO.assessCompetition({...base,sellerCount:300,adCompetition:0.5,evidence:['n1']}),
 profit:P.simulateProfit({price:20000,unitCost:8000,shipping:3000,packaging:500,channel:'coupang'}),feasibility:{moq:100,leadDays:7,needsCertification:false,temperature:'ambient'},brandFit:null,
 risk:R.assessRisk({regulatory:'food',temperature:'ambient',titles:['오뚜기 마라소스']}),sources:['naver_searchad_keyword','naver_datalab_search','youtube_data','naver_shop_search','coupang_ranking_manual']};
const card=SC.scoreCard(input,{computedAt:'2026-10-03T00:00:00Z'});
eq(card.weightsVersion,'w1','version');eq(card.subScores.length,9,'nine sub-scores');eq(js(card.missing),js(['brand_fit']),'only brand fit missing');
const manual=card.subScores.filter(s=>s.value!==null).reduce((a,s)=>a+s.value*W[s.key],0)/card.subScores.filter(s=>s.value!==null).reduce((a,s)=>a+W[s.key],0);near(card.total,manual,0.051,'total = weighted mean over non-null');
ok(card.subScores.every(s=>typeof s.reason==='string'&&/[가-힣]/.test(s.reason)&&Array.isArray(s.evidence)),'korean reasons + evidence arrays');
ok(card.subScores.find(s=>s.key==='demand').evidence.includes('sa-1')&&card.subScores.find(s=>s.key==='momentum').evidence.includes('r1'),'evidence ids flow');
near(card.confidence,(1-W.brand_fit)*1,1e-3,'confidence = coverage × diversity');
const noProfit=SC.scoreCard({...input,profit:null},{computedAt:'x'}),zeroProfit=SC.scoreCard({...input,profit:{...input.profit,marginPct:-0.05}},{computedAt:'x'});
eq(noProfit.subScores.find(s=>s.key==='profitability').value,null,'missing profit is null');ok(noProfit.missing.includes('profitability'),'listed missing');eq(zeroProfit.subScores.find(s=>s.key==='profitability').value,0,'margin -5% is a real 0');
ok(noProfit.total>zeroProfit.total,'missing ≠ 0: null drops out of the mean, a real 0 pulls it down');ok(noProfit.confidence<card.confidence,'missing lowers confidence');
const core=SC.scoreCard({...input,demand:null,trend:null,rank:null,video:null},{computedAt:'x'});eq(core.total,null,'no demand+momentum → total null');eq(core.tier,'needs_data','null total → needs data');
ok(SC.scoreCard({...input,demand:null},{computedAt:'x'}).total!==null,'momentum alone keeps total');
const blocked=SC.scoreCard({...input,risk:R.assessRisk({regulatory:'health_functional_food',temperature:'ambient',titles:[]})},{computedAt:'x'});eq(blocked.tier,'reject','blocked → reject');eq(blocked.blocked.rule,'hff_review','blocked rule');ok(blocked.total!==null,'blocked keeps total separately');
eq(card.tier,card.total>=70&&card.confidence>=0.6?'adopt':'watch','tier rule');
const oneSource=SC.scoreCard({...input,sources:['naver_datalab_search']},{computedAt:'x'});near(oneSource.confidence,card.confidence/3,1e-3,'single source → diversity 1/3');
// 평가 2회차 M7: 신뢰도 하한(0.4)은 '관찰'에도 걸린다. 총점 50 이상이어도 출처 하나뿐(신뢰도 낮음)이면 자료 보강.
ok(oneSource.total>=50&&oneSource.confidence<SC.TIER_RULES.needsDataConfidence,`one-source card is ≥50 with low confidence (${oneSource.total}, ${oneSource.confidence})`);eq(oneSource.tier,'needs_data','≥50 but confidence below the floor → needs data, not watch');
const twoSources=SC.scoreCard({...input,profit:null,sources:['naver_datalab_search','naver_searchad_keyword']},{computedAt:'x'});ok(twoSources.confidence>=0.4&&twoSources.confidence<0.6,`two sources: mid confidence (${twoSources.confidence})`);eq(twoSources.tier,twoSources.total>=50?'watch':'reject','mid confidence keeps watch');
const thin=SC.scoreCard({...input,demand:{...input.demand,monthlyVolume:300000},trend:null,rank:null,video:null,competition:null,profit:null,brandFit:null,sources:['naver_searchad_keyword','naver_shop_search']},{computedAt:'x'});
ok(thin.total>=50&&thin.confidence<0.4,`thin card: only demand+feasibility+risk (${thin.total}, ${thin.confidence})`);eq(thin.tier,'needs_data','thin data is not inflated to watch by risk/feasibility');
const weak=SC.scoreCard({...input,sources:['naver_datalab_search'],demand:{...input.demand,monthlyVolume:100},trend:TR.analyzeTrend(mk(i=>1000*Math.exp(-0.03*Math.max(0,i-40))*wiggle(i))),rank:{current:40,previous:10,slope:null,evidence:[]},video:null,profit:null,feasibility:null,risk:R.assessRisk({regulatory:'food',temperature:'frozen',titles:['1+1']})},{computedAt:'x'});
ok(weak.total<50&&weak.confidence<0.4,'weak & thin');eq(weak.tier,'needs_data','low confidence → needs data');
const reordered=Object.fromEntries(Object.entries(input).reverse());eq(SC.scoreCard(reordered,{computedAt:'y'}).inputDigest,card.inputDigest,'digest stable under key order and computedAt');
ok(SC.scoreCard({...input,demand:{...input.demand,monthlyVolume:12301}},{computedAt:'x'}).inputDigest!==card.inputDigest,'digest changes with input');
assert.throws(()=>SC.scoreCard(input,{computedAt:'x',weightsVersion:'w9'}));passed++;
eq(SC.scoreCard({...input,feasibility:{moq:100,leadDays:7,needsCertification:false,temperature:'ambient'}},{computedAt:'x'}).subScores.find(s=>s.key==='feasibility').value-SC.scoreCard({...input,feasibility:{moq:100,leadDays:7,needsCertification:false,temperature:'frozen'}},{computedAt:'x'}).subScores.find(s=>s.key==='feasibility').value,40,'ambient bonus vs frozen (D1)');
// ── 평가 1회차 반영 ──
// M3 보정 오차: 매일 겹치는 30일 기준점은 같은 값을 두 번 재는 셈이라 달력 월마다 하나, 창이 겹치지 않는 것만 쓴다
{
 const relC=weekly(Array.from({length:20},(_,i)=>40+i),'2026-04-05','dlc');
 const daily=(from,n)=>Array.from({length:n},(_,i)=>{const at=day(from,i),w=C.calibrateTrend(relC,[{at,value:1,snapshotId:'x'}]);return {at,value:Math.round(200*w.anchor.relativeMean*(1+0.05*Math.sin(i))),snapshotId:'sa'+i}});
 const many=daily('2026-06-01',40),calM=C.calibrateTrend(relC,many);
 ok(calM.error&&calM.error.checks.length<=2,`overlapping daily anchors collapse to ≤2 checks (${calM.error?.checks.length})`);
 const ats=[calM.anchor.at,...calM.error.checks.map(c=>c.anchorAt)].map(a=>Date.parse(a+'T00:00:00Z')).sort((a,b)=>b-a);
 ok(ats.every((t,i)=>i===0||ats[i-1]-t>=30*86400000),'checked anchor windows never overlap');
 ok(new Set(calM.error.checks.map(c=>c.month)).size===calM.error.checks.length&&!calM.error.checks.some(c=>c.month===calM.anchor.at.slice(0,7)),'one anchor per calendar month, not the scale month');
 ok(calM.error.skipped>=30,`overlapping anchors are counted as skipped (${calM.error.skipped})`);
 eq(C.calibrateTrend(relC,daily('2026-06-01',25)).error,null,'fewer than 2 non-overlapping anchors → error null');
}
// M6 반짝 유행의 바탕 추세가 없으면 모멘텀은 50(보합)이 아니라 미확인
{
 const fadNoBase={...trendRising,durability:'fad',spiking:true,preSpikeSlope:null};
 const c1=SC.scoreCard({...input,trend:fadNoBase,rank:null,video:null},{computedAt:'x'});
 eq(c1.subScores.find(s=>s.key==='momentum').value,null,'fad without pre-spike baseline → momentum null (not 50)');ok(c1.missing.includes('momentum'),'momentum listed missing');
 const c2=SC.scoreCard({...input,trend:{...fadNoBase,preSpikeSlope:0},rank:null,video:null},{computedAt:'x'});eq(c2.subScores.find(s=>s.key==='momentum').value,50,'a real flat baseline is 50');
}
// ⑤ 경쟁 설명: 가격 사분위·비어 있는 가격대
{
 const prices=[3000,3200,3500,3800,4000,9000,9500,10000,12000,12500],ls=prices.map((p,i)=>({key:'g'+i,rank:i+1,reviewCount:10+i,price:p,firstSeenAt:'2026-01-01'}));
 const slot=CO.emptyPriceSlot(ls);ok(slot&&slot.includes('4,900~6,800원')&&slot.includes('10개 중 0개'),`empty price band sentence: ${slot}`);
 eq(CO.emptyPriceSlot(lst(10,()=>1)),null,'evenly spread prices → no empty slot');eq(CO.emptyPriceSlot(ls.slice(0,5)),null,'too few listings → null');
 eq(js(CO.priceQuartiles(ls)),js({p25:3575,p50:6500,p75:9875}),'price quartiles');
 const cmp=CO.assessCompetition({...base,sellerCount:300,adCompetition:0.5,listings:ls,historyStart:'2026-01-01',evidence:['n1']});
 const cc=SC.scoreCard({...input,competition:cmp},{computedAt:'x'}).subScores.find(s=>s.key==='competition');
 ok(cc.detail&&cc.detail.sellerCount===300&&cc.detail.productCount===null&&cc.detail.priceBand.p50===6500&&cc.detail.emptySlot===slot&&'top10Hhi' in cc.detail&&'newEntrantShare' in cc.detail,'competition sub-score carries structured detail');
 ok(cc.reason.includes('비어 있는 자리'),'reason states the empty slot');
 eq(SC.scoreCard({...input,competition:null},{computedAt:'x'}).subScores.find(s=>s.key==='competition').detail,undefined,'no competition data → no detail');
}
// ⑦ 상표 보호 목록·'높음' 확인 표시·승인 사유
{
 const PB=await L('protected-brands');
 const list=PB.protectedBrandList(['올드페리도넛','x']);ok(list.includes('오뚜기')&&list.includes('올드페리도넛')&&!list.includes('x'),'protected list = editable defaults + owner brands (≥2 chars)');eq(PB.BRAND_LIST_REVIEWED_AT,null,'default list marked unreviewed');
 const tm=R.assessRisk({regulatory:'food',temperature:'ambient',titles:['오뚜기 마라소스 500g'],protectedBrands:list,ownBrands:['올드페리도넛']});eq(tm.level,'high','other company brand in title → high');
 eq(R.assessRisk({regulatory:'food',temperature:'ambient',titles:['올드페리도넛 시그니처'],protectedBrands:list,ownBrands:['올드페리도넛']}).level,'low','own brand is not a trademark risk');
 const hc=SC.scoreCard({...input,risk:tm},{computedAt:'x'});
 ok(hc.needsReview===true&&hc.blocked===null&&hc.review.rules.includes('trademark_use')&&hc.review.terms.includes('상표')&&hc.review.terms.includes('오뚜기'),'high risk → needsReview with rules and terms');
 ok(SC.reviewApprovalError(hc,'검색 수요가 커서 승인합니다.',true),'approval reason must mention the risk');
 ok(SC.reviewApprovalError(hc,'오뚜기 상표 권리자와 재판매 조건을 확인했습니다.',false),'acknowledgement flag required');
 eq(SC.reviewApprovalError(hc,'오뚜기 상표 권리자와 재판매 조건을 확인했습니다.',true),null,'acknowledged + risk named → allowed');
 eq(card.needsReview,false,'low risk → no review needed');eq(SC.reviewApprovalError(card,'좋습니다',false),null,'no gate for low risk');
 const both=SC.scoreCard({...input,risk:R.assessRisk({regulatory:'food',temperature:'ambient',titles:['오뚜기 살빠지는 차'],protectedBrands:list})},{computedAt:'x'});
 const dietMsg=SC.reviewApprovalError(both,'오뚜기 상표 확인했습니다.',true);ok(dietMsg?.includes('다이어트 효능 표현'),'every high rule must be addressed (Korean label)');ok(!/diet_claim|trademark_use/.test(dietMsg),`no internal rule codes in the message: ${dietMsg}`);
 ok(!/trademark_use/.test(SC.reviewApprovalError(hc,'검색 수요가 커서 승인합니다.',true))&&SC.reviewApprovalError(hc,'검색 수요가 커서 승인합니다.',true).includes('타사 상표'),'trademark rule shown as a Korean label');eq(SC.reviewApprovalError(both,'오뚜기 상표와 다이어트 표현을 고쳐 판매합니다.',true),null,'all rules addressed');
}
// ⑧ 브랜드 적합성 힌트: 확정 사실과 상품 말의 겹침, 사실 ID 인용, 사람 판정은 그대로
{
 const BF=await L('brand-fit');
 const facts=[{id:'f1',brandId:'b1',key:'주력 메뉴',value:'마라 소스와 매운 볶음 요리'},{id:'f2',brandId:'b1',key:'고객',value:'20대 직장인'},{id:'f9',brandId:'b2',key:'주력',value:'도넛'}];
 const h=BF.brandFitHint({brands:[{id:'b1',name:'매운집'},{id:'b2',name:'도넛가게'}],facts,productName:'오뚜기 마라소스 500g',categoryLabel:'소스·양념(상온)',keywords:['마라소스','마라 소스']});
 ok(h.score===50&&js(h.factIds)===js(['f1'])&&h.memo.includes('매운집')&&h.memo.includes('f1')&&h.memo.includes('대신하지 않습니다'),`hint cites fact ids: ${JSON.stringify(h)}`);
 eq(BF.brandFitHint({brands:[{id:'b1',name:'매운집'}],facts:[],productName:'x',categoryLabel:null,keywords:['마라소스']}).score,null,'no confirmed facts → null');
 const z=BF.brandFitHint({brands:[{id:'b2',name:'도넛가게'}],facts:facts.filter(f=>f.brandId==='b2'),productName:'오뚜기 마라소스',categoryLabel:'소스·양념(상온)',keywords:['마라소스']});ok(z.score===0&&z.factIds.length===0&&z.memo.includes('근거가 없다'),'no overlap → 0 with an explicit memo');
 const hc=SC.scoreCard({...input,brandFitHint:h},{computedAt:'x'});ok(hc.brandFitHint.score===50&&hc.subScores.find(s=>s.key==='brand_fit').value===null,'hint is on the card but never sets the human brand_fit score');
 ok(hc.inputDigest!==card.inputDigest,'hint is part of the score input (changes the version when facts change)');
}
// ⑥ 수익성 미확인 까닭
eq(SC.scoreCard({...input,profit:null,profitReason:'소싱 견적 연결 필요'},{computedAt:'x'}).subScores.find(s=>s.key==='profitability').reason,'수익성 미확인: 소싱 견적 연결 필요.','profitability reason names the missing sourcing link');
ok(SC.scoreCard({...input,profit:P.simulateProfit({price:20000,unitCost:8000,shipping:3000,packaging:500,channel:'coupang'},['shipping'])},{computedAt:'x'}).subScores.find(s=>s.key==='profitability').reason.includes('가정값'),'assumed profit inputs are labelled');
console.log(JSON.stringify({passed,external:'not_called'}));
