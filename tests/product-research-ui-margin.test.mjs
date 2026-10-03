// 상품 리서치 후보 상세 손익 시뮬레이터(lib/product-research/ui-margin.ts)의 산수와 결측 처리를 고정한다.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {SourceTextModule,createContext} from 'node:vm';
import ts from 'typescript';
const context=createContext({}),cache=new Map();
function moduleFor(path){path=resolve(path);if(cache.has(path))return cache.get(path);const m=new SourceTextModule(ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText,{context,identifier:path});cache.set(path,m);return m;}
const m=moduleFor('lib/product-research/ui-margin.ts');await m.link((s,r)=>moduleFor(resolve(dirname(r.identifier),s+'.ts')));await m.evaluate();
const {computeMargin,marginNumber,assumedFields,MARGIN_CHANNELS,MARGIN_DEFAULTS}=m.namespace;
const P=moduleFor('lib/product-research/analytics/profit.ts').namespace;
let passed=0;
function check(name,actual,expected){assert.deepEqual(JSON.parse(JSON.stringify(actual)),expected,name);passed++}

// 손익 계산은 analytics/profit.ts 하나다(평가 1회차 M5). 반품 상품은 다시 팔지 못한다고 보고(식품 보수 가정), 마진율은 판매가 대비다.
const base={price:20000,cost:8000,shipping:3000,packaging:500,feePct:10,adPerOrder:2000,returnPct:5};
// 순매출 19,000 = 20,000 × 0.95, 수수료 1,900, 원가 8,000, 배송 3,150(반품 회수), 포장 500 → 공헌이익 5,450, 광고비 뒤 3,450, 마진 3,450/20,000=17.3%, 손익분기 ROAS 20,000/5,450=3.67.
check('worked example',computeMargin(base),{netRevenue:19000,fee:1900,goods:8000,shipping:3150,contribution:5450,afterAds:3450,marginPct:17.3,breakevenRoas:3.67,assumptions:[],hasAssumptions:false});
check('no returns and no fee: contribution is price minus costs',computeMargin({...base,feePct:0,returnPct:0,adPerOrder:0}),{netRevenue:20000,fee:0,goods:8000,shipping:3000,contribution:8500,afterAds:8500,marginPct:42.5,breakevenRoas:2.35,assumptions:[],hasAssumptions:false});
check('ads larger than contribution give a negative margin',computeMargin({...base,adPerOrder:7000}).afterAds,-1550);
check('break-even ROAS is unknown when nothing is left before ads',computeMargin({...base,cost:19000}).breakevenRoas,null);
check('missing price gives no result',computeMargin({...base,price:null}),null);
check('zero price gives no result',computeMargin({...base,price:0}),null);
check('missing cost is not treated as zero',computeMargin({...base,cost:null}),null);
check('missing shipping is not treated as zero',computeMargin({...base,shipping:null}),null);
check('missing ad cost is not treated as zero',computeMargin({...base,adPerOrder:null}),null);
check('a 100% return rate has no kept sales',computeMargin({...base,returnPct:100}),null);
check('fee of 100% or more is rejected',computeMargin({...base,feePct:100}),null);
// 같은 입력 → 화면 감싸개와 분석 시뮬레이터가 같은 답(반올림 단위만 다름)
for(const x of [base,{...base,returnPct:0,adPerOrder:0},{...base,price:12900,cost:4100,shipping:2500,packaging:300,feePct:5.63,adPerOrder:800,returnPct:2},{...base,cost:19000}]){
 const ui=computeMargin(x),pr=P.simulateProfit({price:x.price,unitCost:x.cost,shipping:x.shipping,packaging:x.packaging,channel:'own_mall',feeRate:x.feePct/100,returnRate:x.returnPct/100,adCostPerOrder:x.adPerOrder});
 check(`parity ${x.price}/${x.cost}/${x.feePct}%`,[ui.netRevenue,ui.fee,ui.contribution,ui.afterAds,ui.marginPct,ui.breakevenRoas],[Math.round(pr.revenue),Math.round(pr.fee),Math.round(pr.contributionBeforeAds),Math.round(pr.contribution),pr.marginPct===null?null:Math.round(pr.marginPct*1000)/10,pr.breakevenRoas]);
}
check('channel fee presets come from the analytics fee table',MARGIN_CHANNELS.filter(c=>c.channel).map(c=>[c.id,c.feePct,c.assumption]),[['own_mall',3.3,true],['smartstore',5.63,true],['coupang',10.8,true],['musinsa',28,true],['oliveyoung',33,true]]);
// 가정값 표시: 미리 채운 기본값·채널 가정 수수료 그대로면 결과에 표시가 붙는다
const assumed=assumedFields({channel:'smartstore',feePct:5.63,shipping:MARGIN_DEFAULTS.shipping,returnPct:MARGIN_DEFAULTS.returnPct,adPerOrder:MARGIN_DEFAULTS.adPerOrder});
check('defaults and preset fee are flagged as assumptions',assumed,['feePct','shipping','returnPct','adPerOrder']);
const flagged=computeMargin({...base,feePct:5.63,shipping:3000,returnPct:3,adPerOrder:0},assumed);check('result carries the assumption flag',[flagged.hasAssumptions,flagged.assumptions],[true,['feePct','shipping','returnPct','adPerOrder']]);
check('operator-edited values are not assumptions',assumedFields({channel:'smartstore',feePct:4.5,shipping:2800,returnPct:1,adPerOrder:500}),[]);
check('analytics result lists defaulted inputs',P.simulateProfit({price:20000,unitCost:8000,shipping:3000,packaging:500,channel:'coupang'}).assumptions,['ad_cost','fee','return_rate']);
check('input parsing: commas',marginNumber('1,200'),1200);
check('input parsing: empty is unknown',marginNumber(''),null);
check('input parsing: text is unknown',marginNumber('abc'),null);
check('input parsing: negative is unknown',marginNumber('-5'),null);
check('input parsing: zero is a value',marginNumber('0'),0);
check('channel presets include a manual option without a rate',MARGIN_CHANNELS.find(c=>c.id==='custom').feePct,null);
console.log(JSON.stringify({passed}));
