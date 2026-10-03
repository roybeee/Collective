// MD 선정 메모·인용 채점기 검사(mocked: 합성 정답셋, 외부 호출 없음). 채점기는 나중에 모델이 쓴 메모도 채점하므로 실패 사례를 넉넉히 둔다.
import assert from 'node:assert/strict';import {testRuntime} from './helpers/runtime.mjs';
import {makeFixture,weekEnd,WEEKS} from './fixtures/product-research/analytics/synthetic.mjs';
const {load}=testRuntime(async()=>{throw Error('외부 호출 금지')});
const L=f=>load(`lib/product-research/analytics/${f}.ts`);
const N=await L('normalize'),M=await L('match'),S=await L('series'),SC=await L('score'),BR=await L('brief'),CC=await L('citation-check');
let passed=0;const ok=(v,n)=>{assert.ok(v,n);passed++};const eq=(a,b,n)=>{assert.equal(a,b,n);passed++};

// ── 채점기 단위 사례
const kw=text=>({type:'keyword',text});
const snap=(id,sourceId,observations,status='ok',fetchedAt='2026-09-05T01:00:00Z')=>({id,sourceId,method:'api',request:{},fetchedAt,bodyDigest:'0'.repeat(64),bodyBytes:1,status,limitations:[],importedBy:null,observations});
const A=snap('A','naver_searchad_keyword',[{subject:kw('마라소스'),metric:'search_volume_month',value:12300,period:{from:'2026-08-06',to:'2026-09-04'}},{subject:kw('마라소스'),metric:'ad_competition',value:0.85,period:{from:'2026-09-04',to:'2026-09-04'}}]);
const Bs=snap('B','naver_shop_search',[{subject:kw('마라소스'),metric:'seller_count',value:312,period:{from:'2026-09-04',to:'2026-09-04'}},{subject:kw('마라소스'),metric:'price_min',value:15950,period:{from:'2026-09-04',to:'2026-09-04'}}]);
const Cf=snap('C','naver_shop_search',[{subject:kw('마라소스'),metric:'seller_count',value:777,period:{from:'2026-09-04',to:'2026-09-04'}}],'failed');
const Rk=snap('R','coupang_ranking_manual',[{subject:{type:'listing',sourceId:'coupang_ranking_manual',externalId:'x',title:'오뚜기 마라소스',brand:'오뚜기',price:null,url:null,categoryPath:null},metric:'rank',value:3,period:{from:'2026-09-04',to:'2026-09-04'},scope:'쿠팡 소스'}]);
const snaps=[A,Bs,Cf,Rk];
const check=(text,citations,opts)=>CC.checkCitations([{text,citations}],snaps,opts);
const pass=(text,citations,n,opts)=>{const r=check(text,citations,opts);assert.ok(r.passed,`${n}: ${r.unsupported.join(' / ')}`);passed++};
const fail=(text,citations,n,re,opts)=>{const r=check(text,citations,opts);assert.ok(!r.passed,`${n} should fail`);if(re)assert.ok(r.unsupported.some(u=>re.test(u)),`${n}: ${r.unsupported.join(' / ')}`);passed++};
pass("'마라소스' 월 12,300회",['A'],'exact count');pass('월간 검색수 12300회',['A'],'no commas');pass('월 1.23만회',['A'],'만 unit exact');
fail('월 1.2만회',['A'],'rounded count is not exact',/1\.2만/);fail('월 12,400회',['A'],'wrong number',/12,400/);
pass('광고 경쟁 지수 0.85',['A'],'ratio value');pass('광고 경쟁 85%',['A'],'ratio as percent');fail('광고 경쟁 90%',['A'],'wrong percent');
fail('판매처 312곳',['A'],'number only in an uncited snapshot',/인용하지 않은/);pass('판매처 312곳',['A','B'],'cite both');
fail('판매처 313곳',['B'],'counts are exact even within 1%');pass('최저가 15,900원',['B'],'price within 1%');pass('최저가 15,951원',['B'],'price within 1% up');fail('최저가 16,500원',['B'],'price beyond 1%');
fail('월 12,300회',[],'no citation',/인용이 없습니다/);fail('월 12,300회',['ZZZ'],'unknown snapshot',/없는 스냅샷/);fail('판매처 777곳',['C'],'failed snapshot cannot support',/실패한 스냅샷/);
pass('쿠팡 소스 3위',['R'],'rank exact');fail('쿠팡 소스 2위',['R'],'rank wrong');
pass('2026-09-04 기준 월 12,300회',['A'],'date matches period');fail('2026-09-07 기준 월 12,300회',['A'],'date mismatch',/날짜/);pass('2026년 9월 4일 기준',['A'],'korean date');pass('2026-09-05 수집',['A'],'fetch date');
fail('오뚜기 마라소스 500g 월 12,300회',['A'],'size in name is a number',/500/);pass('오뚜기 마라소스 500g 월 12,300회',['A'],'allowed name term',{allowedTerms:['오뚜기 마라소스 500g']});
pass('검색 수요가 꾸준합니다',['A'],'no numbers, valid citation');fail('검색 수요가 꾸준합니다',['C'],'only failed citation');
let r=CC.checkCitations([{text:'월 12,300회',citations:['A']},{text:'판매처 999곳',citations:['B']}],snaps);eq(r.passed,false,'one bad claim fails the brief');eq(r.unsupported.length,1,'only the bad claim listed');ok(r.unsupported[0].startsWith('주장 2'),'claim index in message');
const fx0=CC.extractFigures('1.23만 3천 2억 45% 1,234.5 2026-09-04');eq(JSON.stringify(fx0.numbers.map(n=>n.value)),JSON.stringify([12300,3000,200000000,45,1234.5]),'figures');eq(fx0.dates[0].prefix,'2026-09-04','date token');

// ── 합성 세계에서 결정형 메모 만들기(현재 시점 = 마지막 주)
const fx=makeFixture();const all=S.buildSeries(fx.snapshots),now=weekEnd(WEEKS-1);
const clusters=N.groupKeywords(fx.products.map(p=>p.keyword)),groups=clusters.map(c=>N.toKeywordGroup(c,'2026-10-03T00:00:00Z'));
const catOf=new Map();for(const s of fx.snapshots)if(s.sourceId==='coupang_ranking_manual')for(const o of s.observations)catOf.set(S.subjectKey(o.subject),s.request.category);
const products=[],cards=[];
for(const p of fx.products){
 const kk=S.subjectKey({type:'keyword',text:p.keyword}),cls=M.classifyListing(p.titles[0],null,clusters),cluster=N.clusterOf(clusters,p.keyword);
 products.push({id:p.id,name:p.name,brand:p.brand,categoryId:cls.categoryId,temperature:cls.temperature,regulatory:cls.regulatory,priceBand:{min:p.price,max:p.price},listings:[{sourceId:'coupang_ranking_manual',externalId:`cp-${p.id}`,title:p.titles[0],url:null}],
  keywordGroupIds:cluster?[cluster.id]:[],match:{method:'brand_name_size',confidence:1,confirmedBy:null},createdAt:now,updatedAt:now});
 cards.push(SC.scoreBundle({productId:p.id,keywords:[p.keyword],keywordKeys:p.special==='rank_only'?[]:[kk],listingKeys:[`ls:coupang_ranking_manual:cp-${p.id}`],series:all.filter(s=>s.subjectKey===kk||catOf.get(s.subjectKey)===p.categoryId),
  profit:p.profit,feasibility:p.feasibility,risk:{regulatory:cls.regulatory,regulatorySure:cls.regulatorySure,temperature:cls.temperature,titles:p.titles},brandFit:p.brandFit},now,{computedAt:'2026-10-03T00:00:00Z'}));
}
const brief=BR.buildBrief({question:'가을 상온 식품, 2만 원대 이하',products,cards,snapshots:fx.snapshots,keywordGroups:groups,createdAt:'2026-10-03T00:00:00Z',maxProducts:40});
ok(brief.citationCheck.passed,`template brief passes strict check: ${brief.citationCheck.unsupported.slice(0,3).join(' / ')}`);eq(brief.author.kind,'template','template author');
ok(brief.claims.length>=40,`claims ${brief.claims.length}`);const ids=new Set(fx.snapshots.map(s=>s.id));ok(brief.claims.every(c=>c.citations.length>=1&&c.citations.every(id=>ids.has(id))),'every claim cites a real snapshot');
ok(brief.claims.every(c=>!c.text.includes('경쟁상품')),'competitor rows never become claims');
const evidence=new Set(cards.flatMap(c=>c.subScores.flatMap(s=>s.evidence)));ok(brief.claims.every(c=>c.citations.every(id=>evidence.has(id))),'citations come from score evidence');
const tierRank={adopt:0,watch:1,needs_data:2,reject:3},ordered=brief.productIds.map(id=>cards.find(c=>c.productId===id).tier);ok(ordered.every((t,i)=>i===0||tierRank[ordered[i-1]]<=tierRank[t]),'products ordered by tier');
eq(brief.recommendation,cards.some(c=>c.tier==='adopt')?'adopt':cards.some(c=>c.tier==='watch')?'watch':'reject','recommendation from tiers');ok(brief.summary.includes('가을 상온 식품'),'summary carries the question');
const hff=fx.products.find(p=>p.special==='hff');ok(brief.risks.some(x=>x.includes(hff.name)&&x.includes('선정 금지')),'blocked product listed in risks');
ok(brief.risks.some(x=>x.includes('0으로 계산하지 않음')),'missing data disclosed');
eq(JSON.stringify(BR.buildBrief({question:'가을 상온 식품, 2만 원대 이하',products,cards,snapshots:fx.snapshots,keywordGroups:groups,createdAt:'2026-10-03T00:00:00Z',maxProducts:40})),JSON.stringify(brief),'deterministic brief');
const md=BR.briefMarkdown(brief);ok(md.startsWith('# MD 선정 메모')&&md.includes('인용 검사: 통과')&&md.split('\n').filter(l=>l.startsWith('- [')).length>=brief.claims.length,'markdown');
// 모델이 쓴 메모처럼 바꿔 넣으면 채점기가 잡는다
const terms=[...products.map(p=>p.name),...fx.products.map(p=>p.keyword),...brief.claims.map(c=>(/'([^']+)'/.exec(c.text)||[])[1]).filter(Boolean)];
const first=brief.claims.find(c=>/월간 검색수/.test(c.text));
const bump=first.text.replace(/월간 검색수 ([\d,]+)회/,(m,n)=>`월간 검색수 ${(Number(n.replace(/,/g,''))+1).toLocaleString('en-US')}회`);
eq(CC.checkCitations([{...first,text:bump}],fx.snapshots,{allowedTerms:terms}).passed,false,'tampered number fails');
eq(CC.checkCitations([{...first,citations:[]}],fx.snapshots,{allowedTerms:terms}).passed,false,'stripped citation fails');
const other=brief.claims.find(c=>c.citations[0]!==first.citations[0]&&!/월간 검색수/.test(c.text));eq(CC.checkCitations([{...first,citations:other.citations}],fx.snapshots,{allowedTerms:terms}).passed,false,'wrong snapshot fails');
eq(CC.checkCitations([{...first,text:first.text+' 전년 대비 +35%'}],fx.snapshots,{allowedTerms:terms}).passed,false,'derived growth number not in snapshot fails');
eq(CC.checkCitations(brief.claims,fx.snapshots,{allowedTerms:terms}).passed,true,'untampered brief passes with caller terms');
console.log(JSON.stringify({passed,external:'not_called',mocked:'synthetic fixture',briefClaims:brief.claims.length}));
