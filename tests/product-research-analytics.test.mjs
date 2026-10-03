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
if(oneSource.total>=50)eq(oneSource.tier,'watch','≥50 watch even with low confidence');
const weak=SC.scoreCard({...input,sources:['naver_datalab_search'],demand:{...input.demand,monthlyVolume:100},trend:TR.analyzeTrend(mk(i=>1000*Math.exp(-0.03*Math.max(0,i-40))*wiggle(i))),rank:{current:40,previous:10,slope:null,evidence:[]},video:null,profit:null,feasibility:null,risk:R.assessRisk({regulatory:'food',temperature:'frozen',titles:['1+1']})},{computedAt:'x'});
ok(weak.total<50&&weak.confidence<0.4,'weak & thin');eq(weak.tier,'needs_data','low confidence → needs data');
const reordered=Object.fromEntries(Object.entries(input).reverse());eq(SC.scoreCard(reordered,{computedAt:'y'}).inputDigest,card.inputDigest,'digest stable under key order and computedAt');
ok(SC.scoreCard({...input,demand:{...input.demand,monthlyVolume:12301}},{computedAt:'x'}).inputDigest!==card.inputDigest,'digest changes with input');
assert.throws(()=>SC.scoreCard(input,{computedAt:'x',weightsVersion:'w9'}));passed++;
eq(SC.scoreCard({...input,feasibility:{moq:100,leadDays:7,needsCertification:false,temperature:'ambient'}},{computedAt:'x'}).subScores.find(s=>s.key==='feasibility').value-SC.scoreCard({...input,feasibility:{moq:100,leadDays:7,needsCertification:false,temperature:'frozen'}},{computedAt:'x'}).subScores.find(s=>s.key==='feasibility').value,40,'ambient bonus vs frozen (D1)');
console.log(JSON.stringify({passed,external:'not_called'}));
