// 상품 리서치 후보 상세 손익 시뮬레이터(lib/product-research/ui-margin.ts)의 산수와 결측 처리를 고정한다.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {SourceTextModule,createContext} from 'node:vm';
import ts from 'typescript';
const context=createContext({}),cache=new Map();
function moduleFor(path){path=resolve(path);if(cache.has(path))return cache.get(path);const m=new SourceTextModule(ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText,{context,identifier:path});cache.set(path,m);return m;}
const m=moduleFor('lib/product-research/ui-margin.ts');await m.link((s,r)=>moduleFor(resolve(dirname(r.identifier),s+'.ts')));await m.evaluate();
const {computeMargin,marginNumber,MARGIN_CHANNELS}=m.namespace;
let passed=0;
function check(name,actual,expected){assert.deepEqual(JSON.parse(JSON.stringify(actual)),expected,name);passed++}

const base={price:20000,cost:8000,shipping:3000,packaging:500,feePct:10,adPerOrder:2000,returnPct:5};
// 순매출 19,000 = 20,000 × 0.95, 수수료 1,900, 원가 7,600, 배송 3,150(반품 왕복), 포장 500 → 공헌이익 5,850, 광고비 뒤 3,850.
check('worked example',computeMargin(base),{netRevenue:19000,fee:1900,goods:7600,shipping:3150,contribution:5850,afterAds:3850,marginPct:20.3,breakevenRoas:3.25});
check('no returns and no fee: contribution is price minus costs',computeMargin({...base,feePct:0,returnPct:0,adPerOrder:0}),{netRevenue:20000,fee:0,goods:8000,shipping:3000,contribution:8500,afterAds:8500,marginPct:42.5,breakevenRoas:2.35});
check('ads larger than contribution give a negative margin',computeMargin({...base,adPerOrder:7000}).afterAds,-1150);
check('break-even ROAS is unknown when nothing is left before ads',computeMargin({...base,cost:19000}).breakevenRoas,null);
check('missing price gives no result',computeMargin({...base,price:null}),null);
check('zero price gives no result',computeMargin({...base,price:0}),null);
check('missing cost is not treated as zero',computeMargin({...base,cost:null}),null);
check('missing shipping is not treated as zero',computeMargin({...base,shipping:null}),null);
check('a 100% return rate has no kept sales',computeMargin({...base,returnPct:100}),null);
check('fee over 100% is rejected',computeMargin({...base,feePct:120}),null);
check('input parsing: commas',marginNumber('1,200'),1200);
check('input parsing: empty is unknown',marginNumber(''),null);
check('input parsing: text is unknown',marginNumber('abc'),null);
check('input parsing: negative is unknown',marginNumber('-5'),null);
check('input parsing: zero is a value',marginNumber('0'),0);
check('channel presets include a manual option without a rate',MARGIN_CHANNELS.find(c=>c.id==='custom').feePct,null);
check('channel preset rates are percentages',MARGIN_CHANNELS.filter(c=>c.feePct!==null).every(c=>c.feePct>0&&c.feePct<30),true);
console.log(JSON.stringify({passed}));
