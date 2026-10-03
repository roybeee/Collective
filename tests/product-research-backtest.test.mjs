// 상품 리서치 백테스트·정답셋 검사(mocked: 합성 정답셋, 외부 호출 없음). tests/fixtures/product-research/analytics/synthetic.mjs가 정답(부류)을 갖고 있다.
// 확인: 키워드 묶음·상품 매칭 정밀도 ≥0.95(사람 정답 쌍), 보정 오차, 유행·계절 판별, 미래 정보 차단, 정밀도@k·스피어만 계산, w1이 기준선 셋을 이기는지.
import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {testRuntime} from './helpers/runtime.mjs';
import {makeFixture,weekEnd,weekStart,AS_OF_WEEK} from './fixtures/product-research/analytics/synthetic.mjs';
const {load,sql}=testRuntime(async()=>{throw Error('외부 호출 금지')});
const L=f=>load(`lib/product-research/analytics/${f}.ts`);
// 로더는 동시 링크에 안전하지 않아 차례로 올린다.
const N=await L('normalize'),M=await L('match'),S=await L('series'),C=await L('calibrate'),B=await L('backtest'),SC=await L('score');
let passed=0;const ok=(v,n)=>{assert.ok(v,n);passed++};const eq=(a,b,n)=>{assert.equal(a,b,n);passed++};const js=v=>JSON.stringify(v);
const near=(a,b,tol,n)=>{assert.ok(Math.abs(a-b)<=tol,`${n}: ${a} vs ${b}`);passed++};

// ── 정밀도@k·순위 상관: 손으로 계산한 작은 예
const items=[{id:'a',score:0.9,positive:true},{id:'b',score:0.8,positive:false},{id:'c',score:0.7,positive:true},{id:'d',score:0.6,positive:false},{id:'e',score:null,positive:true}];
eq(B.precisionAtK(items,2),0.5,'p@2');near(B.precisionAtK(items,3),2/3,1e-12,'p@3');eq(B.precisionAtK(items,5),0.6,'null scores last');eq(B.precisionAtK(items,6),null,'k > n → null');
eq(B.precisionAtK([{id:'z',score:1,positive:false},{id:'y',score:1,positive:true}],1),1,'ties broken by id');
eq(js(B.ranks([10,20,20,30])),js([1,2.5,2.5,4]),'average ranks');
eq(B.spearman([1,2,3,4,5],[2,4,6,8,10]),1,'monotone +1');eq(B.spearman([1,2,3,4,5],[5,4,3,2,1]),-1,'reversed -1');
near(B.spearman([1,2,3,4,5],[5,6,7,8,7]),8/Math.sqrt(95),1e-12,'ties: 8/√95');eq(B.spearman([1,2],[1,2]),null,'n<3 null');eq(B.spearman([1,1,1],[1,2,3]),null,'zero variance null');
eq(B.seededRandom('s','p1'),B.seededRandom('s','p1'),'seeded random stable');ok(B.seededRandom('s','p1')!==B.seededRandom('t','p1'),'seed changes value');

// ── 사람 정답 쌍: 키워드 묶음·상품 매칭 정밀도
const pairs=JSON.parse(readFileSync('tests/fixtures/product-research/analytics/labeled-pairs.json','utf8'));
const conf=(rows,pred)=>{let tp=0,fp=0,fn=0;for(const r of rows){const p=pred(r);if(p&&r.same)tp++;else if(p&&!r.same)fp++;else if(!p&&r.same)fn++}return {tp,fp,fn,precision:tp+fp?tp/(tp+fp):null,recall:tp+fn?tp/(tp+fn):null}};
const kwStats=conf(pairs.keywords,r=>{const g=N.groupKeywords([r.a,r.b]);return g.length===1});
ok(kwStats.precision>=0.95,`keyword grouping precision ${kwStats.precision}`);ok(kwStats.recall>=0.8,`keyword grouping recall ${kwStats.recall}`);
const li=x=>({type:'listing',sourceId:x.sourceId,externalId:x.externalId,title:x.title,brand:x.brand??null,price:null,url:null,categoryPath:null,barcode:x.barcode??null});
const lsStats=conf(pairs.listings,r=>M.scorePair(li(r.a),li(r.b)).decision==='merge');
ok(lsStats.precision>=0.95,`listing auto-merge precision ${lsStats.precision}`);ok(lsStats.tp>=8,`auto-merge finds most same pairs (${lsStats.tp})`);
// 다른 SKU는 자동 병합되지 않는다. 이름이 거의 같은 변형('비빔면2'·'초고추장')은 사람 확인 구간(0.8~0.95)으로 가는 것이 의도다.
const diffDecisions=pairs.listings.filter(r=>!r.same).map(r=>M.scorePair(li(r.a),li(r.b)).decision);eq(diffDecisions.filter(d=>d==='merge').length,0,'different SKUs never auto-merge');ok(diffDecisions.filter(d=>d==='confirm').length<=3,'few different SKUs need confirmation');

// ── 합성 세계 → 시계열·상품 묶음
const fx=makeFixture();const all=S.buildSeries(fx.snapshots);
ok(fx.products.length===40&&fx.snapshots.length>2000,'40 products, full snapshot set');
const catOf=new Map();for(const s of fx.snapshots)if(s.sourceId==='coupang_ranking_manual')for(const o of s.observations)catOf.set(S.subjectKey(o.subject),s.request.category);
const bundleOf=p=>{const kk=S.subjectKey({type:'keyword',text:p.keyword}),cls=M.classifyListing(p.titles[0]);
 return {productId:p.id,keywords:[p.keyword],keywordKeys:p.special==='rank_only'?[]:[kk],listingKeys:[`ls:coupang_ranking_manual:cp-${p.id}`],series:all.filter(s=>s.subjectKey===kk||catOf.get(s.subjectKey)===p.categoryId),
  profit:p.profit,feasibility:p.feasibility,risk:{regulatory:cls.regulatory,regulatorySure:cls.regulatorySure,temperature:cls.temperature,titles:p.titles},brandFit:p.brandFit}};
const bundles=fx.products.map(bundleOf),byId=new Map(fx.products.map(p=>[p.id,p]));

// ── 보정 오차(③ 5점 조건 ≤15%): 기준 시점까지의 기준점으로 배율을 잡고 앞선 기준점들로 잰다
const errs=[];for(const b of bundles){const k=b.keywordKeys[0];if(!k)continue;const rel=b.series.find(s=>s.subjectKey===k&&s.metric==='search_trend'),anc=b.series.find(s=>s.subjectKey===k&&s.metric==='search_volume_month');
 if(!rel||!anc){ok(byId.get(b.productId).special==='no_anchor','only the no-anchor product lacks anchors');continue}
 const cal=C.calibrateTrend(S.sliceAsOf(rel,fx.asOf).points,S.sliceAsOf(anc,fx.asOf).points);ok(cal&&cal.error,`calibration with error for ${b.productId}`);errs.push(cal.error.relative)}
const meanErr=errs.reduce((a,b)=>a+b,0)/errs.length;ok(meanErr<=0.15,`mean calibration error ${meanErr.toFixed(3)} ≤ 0.15`);ok(Math.max(...errs)<=0.25,`max calibration error ${Math.max(...errs).toFixed(3)}`);
eq(C.calibrateTrend(S.sliceAsOf(bundles[0].series.find(s=>s.metric==='search_trend'),fx.asOf).points,[]),null,'no anchor → null');

// ── 유행·계절 판별(기준 시점 기준). 기준 시점 뒤에 터진 유행(fad_later)은 아직 알 수 없으므로 유행으로 보면 안 된다
const run=B.runBacktest({candidates:bundles,asOf:fx.asOf,horizonWeeks:fx.horizonWeeks,computedAt:'2026-10-03T00:00:00Z'});
const dur=new Map(run.inputs.map(i=>[i.productId,i.trend?.durability??null]));
const truth=cls=>fx.products.filter(p=>p.cls===cls).map(p=>p.id);
const seasonalTruth=[...truth('seasonal_winter'),...truth('seasonal_summer')],fadTruth=[...truth('fad_old'),...truth('fad_now')];
for(const id of seasonalTruth)eq(dur.get(id),'seasonal',`seasonal detected ${id}`);
for(const id of fadTruth)eq(dur.get(id),'fad',`fad detected ${id}`);
ok([...dur].filter(([id,d])=>d==='seasonal'&&!seasonalTruth.includes(id)).length===0,'no false seasonal');
ok([...dur].filter(([id,d])=>d==='fad'&&!fadTruth.includes(id)).length===0,'no false fad (incl. fad after T)');
ok(truth('rising').filter(id=>byId.get(id).special!=='rank_only').every(id=>dur.get(id)==='rising'),'rising detected');
ok(truth('declining').every(id=>dur.get(id)!=='rising'),'declining never rising');
ok(run.inputs.find(i=>i.productId===truth('fad_now')[0]).trend.fad.ratio>=3,'fad ratio ≥3');

// ── 점수표: 결측·차단·물류
const card=id=>run.cards.find(c=>c.productId===id);
const hff=fx.products.find(p=>p.special==='hff').id,frozen=fx.products.find(p=>p.special==='frozen').id,noAnchor=fx.products.find(p=>p.special==='no_anchor').id,rankOnly=fx.products.find(p=>p.special==='rank_only').id;
eq(card(hff).tier,'reject','hff rejected');eq(card(hff).blocked.rule,'hff_review','hff blocked rule');
ok(run.inputs.find(i=>i.productId===frozen).risk.items.some(x=>x.rule==='logistics'),'frozen logistics risk');ok(card(frozen).subScores.find(s=>s.key==='risk').value===60,'frozen medium risk');
eq(card(noAnchor).subScores.find(s=>s.key==='demand').value,null,'no anchor → demand null');ok(card(noAnchor).total!==null,'momentum keeps total');ok(card(noAnchor).missing.includes('demand'),'demand missing');
eq(card(rankOnly).subScores.find(s=>s.key==='durability').value,null,'rank-only has no durability');ok(card(rankOnly).confidence<0.4,'rank-only low confidence');eq(run.rows.find(r=>r.productId===rankOnly).outcomeBasis,'rank','rank outcome fallback');
ok(run.cards.every(c=>c.subScores.every(s=>s.value===null||(s.value>=0&&s.value<=100))),'sub-scores within 0~100');
const snapIds=new Set(fx.snapshots.map(s=>s.id));ok(run.cards.every(c=>c.subScores.every(s=>s.evidence.every(e=>snapIds.has(e)))),'every evidence id is a real snapshot');

// ── 미래 정보 차단: 기준 시점 뒤 점을 바꿔도(값·결측·새 점) 고정 점수는 그대로, 기준 시점 이전 점을 바꾸면 달라진다
const mutateFuture=b=>({...b,series:b.series.map(s=>({...s,points:[...s.points.map(p=>Date.parse(p.at)>Date.parse(fx.asOf)?{...p,value:p.value===null?7:(Math.round(p.value*13)%3?p.value*10:null)}:p),{at:weekEnd(AS_OF_WEEK+20),value:1e9,snapshotId:'future'}]}))});
const frozenRun=B.runBacktest({candidates:bundles.map(mutateFuture),asOf:fx.asOf,horizonWeeks:fx.horizonWeeks,computedAt:'2026-10-03T00:00:00Z'});
eq(js(frozenRun.cards.map(c=>[c.id,c.total,c.inputDigest,c.tier])),js(run.cards.map(c=>[c.id,c.total,c.inputDigest,c.tier])),'future mutation leaves frozen scores identical');
ok(js(frozenRun.rows.map(r=>r.outcome))!==js(run.rows.map(r=>r.outcome)),'(sanity) outcomes do read the future');
const pastMut=bundles.map(b=>({...b,series:b.series.map(s=>({...s,points:s.points.map(p=>p.at===fx.asOf&&p.value!==null?{...p,value:p.value*3}:p)}))}));
ok(B.runBacktest({candidates:pastMut,asOf:fx.asOf,horizonWeeks:12,computedAt:'x'}).cards.some((c,i)=>c.inputDigest!==run.cards[i].inputDigest),'(sanity) changing an as-of point changes the digest');
eq(js(B.runBacktest({candidates:bundles,asOf:fx.asOf,horizonWeeks:12,computedAt:'2026-10-03T00:00:00Z'}).result),js(run.result),'deterministic');

// ── w1 vs 기준선(정답: 12주 뒤 검색량·순위 +30% 이상)
const r=run.result,pk=(arr,k)=>arr.find(x=>x.k===k).value,base=n=>r.baselines.find(b=>b.name===n).precisionAtK;
eq(r.candidates,40,'all candidates evaluated');eq(r.horizonWeeks,12,'horizon');ok(r.label.includes('30%'),'label states threshold');
const positives=run.rows.filter(x=>x.positive).length;ok(positives>=10&&positives<=25,`positives ${positives}`);
for(const n of ['current_top','momentum_only','random']){ok(pk(r.precisionAtK,20)>pk(base(n),20),`w1 p@20 ${pk(r.precisionAtK,20)} > ${n} ${pk(base(n),20)}`);ok(pk(r.precisionAtK,10)>=pk(base(n),10),`w1 p@10 ${pk(r.precisionAtK,10)} ≥ ${n} ${pk(base(n),10)}`)}
ok(r.spearman>0.3,`spearman ${r.spearman}`);
const strict=B.runBacktest({candidates:bundles,asOf:fx.asOf,horizonWeeks:12,threshold:0.6,computedAt:'x'});ok(strict.rows.filter(x=>x.positive).length<positives,'threshold is a parameter');
// ── 서버 파이프라인 백테스트(평가 1회차 H3): 후보·특징은 기준 시점 이전 관측만으로 만든다
const PL=await load('lib/product-research/server-pipeline.ts');
const AT='2026-10-03T00:00:00.000Z';
const e2e=PL.backtestFromSnapshots(fx.snapshots,12,0.3,AT);
eq(e2e.result.asOf.slice(0,10),fx.asOf,'pipeline as-of = last observation − 12 weeks');
ok(e2e.result.reason===null&&e2e.result.precisionAtK.every(p=>typeof p.value==='number')&&e2e.universe.products>0,'pipeline backtest produces numbers from as-of data');
// 기준 시점 뒤에만 나타난 목록(1위 신상)과 기준 시점 뒤의 엄청난 검색수는 후보·특징·기준선을 바꾸지 않는다
const lateListing={type:'listing',sourceId:'coupang_ranking_manual',externalId:'late-1',title:'신상 마라 젤리 100g',brand:null,price:3900,url:null,categoryPath:'food_snack'};
const late=[
 {id:'late-rank',sourceId:'coupang_ranking_manual',method:'manual',request:{category:'food_snack'},fetchedAt:new Date(Date.parse(weekEnd(70))+86400000).toISOString(),bodyDigest:'0',bodyBytes:1,status:'ok',limitations:[],importedBy:{id:'op',email:null,fileName:'late.csv'},
  observations:[{subject:lateListing,metric:'rank',value:1,period:{from:weekEnd(70),to:weekEnd(70)},scope:'쿠팡 food_snack 랭킹'}]},
 {id:'late-sa',sourceId:'naver_searchad_keyword',method:'api',request:{},fetchedAt:new Date(Date.parse(weekEnd(76))+86400000).toISOString(),bodyDigest:'0',bodyBytes:1,status:'ok',limitations:[],importedBy:null,
  observations:[{subject:{type:'keyword',text:'마라소스'},metric:'search_volume_month',value:99999999,period:{from:weekStart(72),to:weekEnd(76)}}]},
];
const withLate=PL.backtestFromSnapshots([...fx.snapshots,...late],12,0.3,AT);
ok(!withLate.candidates.some(b=>b.listingKeys.includes('ls:coupang_ranking_manual:late-1')),'a product that only appears after as-of is not a candidate');
eq(withLate.universe.excludedAfterAsOf,e2e.universe.excludedAfterAsOf+1,'excluded-after-as-of count includes the late listing');
eq(js(withLate.candidates.map(b=>b.productId)),js(e2e.candidates.map(b=>b.productId)),'future-only snapshots leave the candidate universe unchanged');
eq(js(withLate.rows.map(r=>[r.productId,r.score,r.baselines.current_top,r.baselines.momentum_only])),js(e2e.rows.map(r=>[r.productId,r.score,r.baselines.current_top,r.baselines.momentum_only])),'scores and current_top/momentum baselines come from as-of data only');
ok(!withLate.rows.some(r=>r.baselines.current_top===99999999),'current_top never sees the post-as-of search volume');
eq(js(withLate.result.precisionAtK),js(e2e.result.precisionAtK),'precision unchanged by future-only snapshots');
// 기준 시점 이전에 순위 관측이 있으면 후보가 된다(같은 목록을 앞당겨 넣으면 들어온다)
const early=PL.backtestFromSnapshots([...fx.snapshots,{...late[0],id:'early-rank',fetchedAt:new Date(Date.parse(weekEnd(40))+86400000).toISOString(),observations:[{...late[0].observations[0],period:{from:weekEnd(40),to:weekEnd(40)}}]}],12,0.3,AT);
ok(early.candidates.some(b=>b.listingKeys.includes('ls:coupang_ranking_manual:late-1')),'(sanity) the same listing observed before as-of is a candidate');
// 잘라 낸 스냅샷: 기준 시점 뒤 관측은 없다
ok(PL.truncateSnapshots(fx.snapshots,fx.asOf).every(s=>s.observations.every(o=>o.period.to<=fx.asOf)),'truncateSnapshots keeps only period ≤ as-of');
eq(PL.backtestFromSnapshots(fx.snapshots.filter(s=>s.sourceId!=='naver_datalab_search'&&s.sourceId!=='coupang_ranking_manual').slice(0,3),12,0.3,AT).result.reason!==null,true,'thin history → reason, no numbers');

// ── 조사 방향(M4)·소싱 견적(⑥)·상표(⑦)·브랜드 힌트(⑧)가 재계산에 들어간다
const f1=PL.settingsFilter({temperature:'frozen',priceBand:{min:25000,max:26000}},{temperatures:['ambient'],priceMax:20000});
ok(f1.temperature&&f1.priceMax&&f1.reasons.some(x=>x.includes('가격 상한 초과'))&&f1.reasons.some(x=>x.includes('냉동')),'settings filter flags temperature and price cap');
eq(PL.settingsFilter({temperature:'unknown',priceBand:{min:null,max:null}},{temperatures:['ambient'],priceMax:20000}),null,'unknown temperature/price is not filtered');
const day0='2026-09-28',lst0={type:'listing',sourceId:'coupang_ranking_manual',externalId:'A1',title:'오뚜기 마라소스 500g',brand:'오뚜기',price:3900,url:null,categoryPath:null};
const imp={id:'imp-1',sourceId:'coupang_ranking_manual',method:'manual',request:{},fetchedAt:day0+'T01:00:00.000Z',bodyDigest:'0',bodyBytes:1,status:'ok',limitations:[],importedBy:{id:'op',email:null,fileName:'c.csv'},
 observations:[{subject:lst0,metric:'rank',value:1,period:{from:day0,to:day0},scope:'쿠팡 소스'},{subject:lst0,metric:'price_min',value:3900,period:{from:day0,to:day0},scope:'쿠팡 소스'}]};
const m0=PL.material([imp]),first0=PL.computeProducts(m0,[],[],new Set(),AT).drafts[0].product;
const linked={...first0,sourcing:{campaignId:'camp1',candidateId:'cand1',candidateVersion:2}};
const cand={campaignId:'camp1',version:2,input:{unitCost:1500,moq:200,leadDays:10,shippingCost:20000,extraCost:0,taxBasis:'included',unit:'piece',validUntil:'2026-12-31'}};
const q=PL.quoteFrom(linked.sourcing,cand,new Date(AT));ok(q.ok,'matching campaign/version/validity → usable quote');
ok(!PL.quoteFrom(linked.sourcing,{...cand,version:3},new Date(AT)).ok&&/새 판/.test(PL.quoteFrom(linked.sourcing,{...cand,version:3},new Date(AT)).reason),'changed quote version → needs relinking');
ok(/유효기한/.test(PL.quoteFrom(linked.sourcing,{...cand,input:{...cand.input,validUntil:'2026-09-01'}},new Date(AT)).reason),'expired quote → reason');
const ctx={settings:{temperatures:['ambient'],priceMax:3000},sourcing:new Map([[first0.id,q]]),protectedBrands:['오뚜기','농심'],ownBrands:['매운집'],brands:[{id:'b1',name:'매운집'}],brandFacts:[{id:'f1',brandId:'b1',key:'주력',value:'마라 소스 요리'}]};
const d1=PL.computeProducts(m0,[linked],[],new Set(),AT,ctx).drafts[0];
eq(d1.product.id,first0.id,'product id kept across recompute');eq(js(d1.product.sourcing),js(linked.sourcing),'sourcing link survives recompute');
ok(d1.product.filtered&&d1.product.filtered.priceMax&&!d1.product.filtered.temperature,'price above the cap is flagged (not deleted)');
const sc1=SC.scoreCard(SC.buildScoreInput(d1.bundle,d1.asOf),{computedAt:AT}),sub1=k=>sc1.subScores.find(s=>s.key===k);
ok(sub1('profitability').value!==null&&/가정값/.test(sub1('profitability').reason),`linked quote → profitability computed with labelled assumptions: ${sub1('profitability').reason}`);
ok(/MOQ 200개/.test(sub1('feasibility').reason)&&/납기 10일/.test(sub1('feasibility').reason),'quote MOQ and lead time feed feasibility');
ok(sc1.needsReview&&sc1.review.terms.includes('오뚜기'),'protected brand in title → needsReview');
ok(sc1.brandFitHint&&sc1.brandFitHint.factIds.includes('f1')&&sub1('brand_fit').value===null,'brand fit hint from archive facts, human score untouched');
const d0=PL.computeProducts(m0,[first0],[],new Set(),AT,{settings:ctx.settings}).drafts[0],sc0=SC.scoreCard(SC.buildScoreInput(d0.bundle,d0.asOf),{computedAt:AT});
eq(sc0.subScores.find(s=>s.key==='profitability').reason,'수익성 미확인: 소싱 견적 연결 필요.','no link → profitability null with "소싱 견적 연결 필요"');
const bad=PL.computeProducts(m0,[linked],[],new Set(),AT,{sourcing:new Map([[first0.id,PL.quoteFrom(linked.sourcing,null,new Date(AT))]])}).drafts[0];
ok(/다시 연결/.test(SC.scoreCard(SC.buildScoreInput(bad.bundle,bad.asOf),{computedAt:AT}).subScores.find(s=>s.key==='profitability').reason),'missing quote record → reason, still null');
// 저장소 맥락 읽기: 조사 방향·브랜드·확정 사실·소싱 견적 레코드(kind·id 규칙)
{
 const put=(kind,id,data,parent='')=>sql.prepare('INSERT INTO records(id,owner,kind,parent_id,data,updated_at) VALUES(?,?,?,?,?,?)').run(`own1:${kind}:${id}`,'own1',kind,parent,JSON.stringify(data),AT);
 put('pr_settings','current',{categories:['food_sauce'],temperatures:['ambient'],priceMax:3000,question:'',version:1,updatedAt:AT});
 put('brand','b1',{id:'b1',name:'매운집'});
 put('brand_fact','f1',{id:'f1',brandId:'b1',key:'주력',value:'마라 소스 요리',status:'confirmed',source:'대표 인터뷰',verifiedAt:'2026-09-01T00:00:00.000Z',validUntil:'2027-09-01T00:00:00.000Z',version:1,updatedAt:AT},'b1');
 put('brand_fact','f2',{id:'f2',brandId:'b1',key:'후보',value:'마라 소스',status:'candidate',source:'',verifiedAt:'',validUntil:'',version:1,updatedAt:AT},'b1');
 put('growth_sourcing_candidate','cand1',{...cand,id:'cand1',brandId:'b1',campaignVersion:1,createdAt:AT,updatedAt:AT},'camp1');
 const lc=await PL.loadContext('own1',[linked],new Date(AT));
 ok(lc.settings.priceMax===3000&&lc.ownBrands.includes('매운집')&&lc.protectedBrands.includes('매운집')&&lc.protectedBrands.includes('오뚜기'),'context: settings + owner brands + default protected list');
 eq(js(lc.brandFacts.map(f=>f.id)),js(['f1']),'context: only confirmed, valid brand facts');
 ok(lc.sourcing.get(first0.id).ok&&lc.sourcing.get(first0.id).input.moq===200,'context: linked growth_sourcing_candidate is read by id');
}
console.log(JSON.stringify({pipelineBacktest:{w1:e2e.result.precisionAtK,spearman:e2e.result.spearman===null?null:Math.round(e2e.result.spearman*1000)/1000,baselines:e2e.result.baselines.map(b=>({name:b.name,p:b.precisionAtK})),candidates:e2e.result.candidates,universe:{products:e2e.universe.products,keywordGroups:e2e.universe.keywordGroups,excludedAfterAsOf:e2e.universe.excludedAfterAsOf},positives:e2e.rows.filter(r=>r.positive).length}}));
console.log(JSON.stringify({passed,external:'not_called',mocked:'synthetic fixture',backtest:{w1:r.precisionAtK,spearman:Math.round(r.spearman*1000)/1000,baselines:r.baselines.map(b=>({name:b.name,p:b.precisionAtK})),positives},calibration:{meanErr:Math.round(meanErr*1000)/1000,maxErr:Math.round(Math.max(...errs)*1000)/1000},keyword:kwStats,listing:lsStats}));
