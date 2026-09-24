// ux-2 권고 (2)(3)·ux-3: 실행 화면의 '주문 장부 열기'와 점포 주문 장부의 캠페인·소재 필터, 두 화면의 관리자 전용 동작 안내.
// 순수 계산(장부 이동 대상·필터 선택지·필터 일치)은 화면 모듈이 내보낸 함수를 불러 확인한다. 화면 부품·react 같은 의존은 이름만 있는 대역으로 바꾸고,
// 계산에 쓰는 lib 모듈(소재 이름 creativeLabel, 주소 규칙 nav-state)만 실제로 불러온다. 화면 연결은 원문 검사(tests/workspace-wiring.test.mjs와 같은 방식)로 본다.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {SourceTextModule,SyntheticModule,createContext} from 'node:vm';
import ts from 'typescript';

const context=createContext({console,URL,URLSearchParams,Date,Intl}),cache=new Map();
const real=new Set(['@/lib/store-attribution','@/lib/execution','@/lib/nav-state']);
const transpile=(file)=>ts.transpileModule(readFileSync(file,'utf8'),{fileName:file,compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText;
// 모듈이 가져가는 이름. 대역 모듈은 이 이름만 내보낸다(값은 쓰이지 않는다).
function importedNames(code){
 const names=new Map(),file=ts.createSourceFile('m.js',code,ts.ScriptTarget.ES2022,false,ts.ScriptKind.JS);
 for(const s of file.statements){if(!ts.isImportDeclaration(s))continue;const spec=s.moduleSpecifier.text,set=names.get(spec)||new Set(),clause=s.importClause;if(clause?.name)set.add('default');const bound=clause?.namedBindings;if(bound&&ts.isNamedImports(bound))for(const e of bound.elements)set.add((e.propertyName||e.name).text);names.set(spec,set)}
 return names;
}
function moduleFor(file){
 file=resolve(file);if(cache.has(file))return cache.get(file);
 const code=transpile(file),m=new SourceTextModule(code,{context,identifier:file});m.imports=importedNames(code);cache.set(file,m);return m;
}
const stub=(names)=>new SyntheticModule([...names],function(){for(const n of names)this.setExport(n,()=>null)},{context});
async function load(file){
 const m=moduleFor(file);
 if(m.status==='unlinked')await m.link((spec,ref)=>{
  const lib=spec.startsWith('@/lib/'),relative=spec.startsWith('.')&&ref.identifier.includes('/lib/');
  if(real.has(spec)||relative)return moduleFor(lib?resolve(spec.slice(2))+'.ts':resolve(dirname(ref.identifier),spec)+'.ts');
  return stub(ref.imports.get(spec)||new Set());
 });
 if(m.status!=='evaluated')await m.evaluate();return m.namespace;
}
const execution=await load('app/execution-panel.tsx'),operations=await load('app/store-operations-panel.tsx'),nav=await load('lib/nav-state.ts');
const source=file=>readFileSync(file,'utf8'),executionUi=source('app/execution-panel.tsx'),operationsUi=source('app/store-operations-panel.tsx');
let passed=0;const check=(name,fn)=>{try{fn();passed++}catch(error){console.error('FAIL:',name);throw error}};
const plain=value=>JSON.parse(JSON.stringify(value));

// --- 1) '주문 장부 열기' 이동 대상 (실행 화면) ---------------------------------------------------
const {orderLedgerTarget,ledgerNav}=execution;
const stores=[{id:'s-open',name:'성수점',brandId:'ofd',status:'active'},{id:'s-closed',name:'닫은 지점',brandId:'ofd',status:'archived'},{id:'s-other',name:'다른 브랜드 지점',brandId:'oda',status:'active'},{id:'s-two',name:'연남점',brandId:'ofd',status:'active'}];
check('a store campaign opens that store ledger at once, without waiting for the store list',()=>{
 assert.deepEqual(plain(orderLedgerTarget({brandId:'ofd',storeId:'s-open'},null)),{kind:'store',nav:{view:'stores',brand:'ofd',store:'s-open',tab:'ledger'}});
 assert.deepEqual(plain(orderLedgerTarget({brandId:'ofd',storeId:'s-open'},stores)),{kind:'store',nav:{view:'stores',brand:'ofd',store:'s-open',tab:'ledger'}});
});
check('a brand campaign waits for the store list',()=>assert.deepEqual(plain(orderLedgerTarget({brandId:'ofd'},null)),{kind:'loading'}));
check('a brand campaign chooses among the active stores of the same brand',()=>assert.deepEqual(plain(orderLedgerTarget({brandId:'ofd'},stores)),{kind:'choose',stores:[{id:'s-open',name:'성수점'},{id:'s-two',name:'연남점'}]}));
check('a brand without an active store is sent to its store marketing screen',()=>{
 assert.deepEqual(plain(orderLedgerTarget({brandId:'ofd'},stores.filter(s=>s.id==='s-closed'))),{kind:'none',nav:{view:'stores',brand:'ofd'}});
 assert.deepEqual(plain(orderLedgerTarget({brandId:'oda2'},[])),{kind:'none',nav:{view:'stores',brand:'oda2'}});
});
check('the chosen store gets the same ledger target',()=>assert.deepEqual(plain(ledgerNav('ofd','s-two')),{view:'stores',brand:'ofd',store:'s-two',tab:'ledger'}));
check('the ledger target survives the address rules (store marketing view, brand, store and the ledger tab kept)',()=>{
 const parsed=nav.parseNav(nav.serializeNav(ledgerNav('ofd','s-two')));
 assert.equal(parsed.view,'stores');assert.equal(parsed.brand,'ofd');assert.equal(parsed.store,'s-two');assert.equal(parsed.tab,'ledger');
});
// 점포 마케팅은 운영 중 지점만 연다. 캠페인 지점이 보관됐거나 목록에 없으면 다른 지점 장부로 넘어가지 않게 이동 버튼 대신 안내를 보인다(목록을 불러오는 중이면 바로 이동).
check('an archived or missing campaign store is not replaced by another store',()=>{
 assert.deepEqual(plain(orderLedgerTarget({brandId:'ofd',storeId:'s-closed'},stores)),{kind:'archived'});
 assert.deepEqual(plain(orderLedgerTarget({brandId:'ofd',storeId:'s-gone'},stores)),{kind:'archived'});
 assert.deepEqual(plain(orderLedgerTarget({brandId:'ofd',storeId:'s-closed'},null)),{kind:'store',nav:{view:'stores',brand:'ofd',store:'s-closed',tab:'ledger'}});
});

// --- 2) 주문 장부 필터: 캠페인·소재 선택지 (점포 화면) -----------------------------------------------
const {ledgerFilterOptions,ledgerFilterMatch,ledgerFilterValue}=operations;
const orders=[
 {id:'o1',channel:'instagram',campaignId:'c1',creativeId:'cr-titled',experimentId:''},
 {id:'o2',channel:'unknown',campaignId:'c1',experimentId:''},
 {id:'o3',channel:'unknown',experimentId:''},
 {id:'o4',channel:'naver_place',campaignId:'c-gone',creativeId:'cr-missing-record',experimentId:'e1'},
 {id:'o5',channel:'instagram',campaignId:'c1',creativeId:'cr-untitled',experimentId:''},
 {id:'o6',channel:'instagram',campaignId:'c1',creativeId:'cr-titled',experimentId:''},
];
const campaigns=[{id:'c1',title:'오픈 주 캠페인'},{id:'c2',title:'주문 없는 캠페인'}];
const creatives=[{id:'cr-titled',campaignId:'c1',title:'오픈 메뉴 안내 v1'},{id:'cr-untitled',campaignId:'c1',caption:'대표 메뉴: 떡볶이\n\n주문할 때 …',createdAt:'2026-09-23T05:05:00.000Z'},{id:'cr-not-ordered',campaignId:'c1',title:'주문 없는 소재'}];
const options=plain(ledgerFilterOptions(orders,campaigns,creatives));
check('campaign options list the store campaigns first, then campaigns left only on orders',()=>assert.deepEqual(options.campaigns,[
 {value:'campaign:c1',label:'오픈 주 캠페인'},{value:'campaign:c2',label:'주문 없는 캠페인'},{value:'campaign:c-gone',label:'기존 캠페인 · c-gone'}]));
check('creative options list only creatives on the ledger orders, named with creativeLabel and their campaign',()=>assert.deepEqual(options.creatives,[
 {value:'creative:cr-titled',label:'오픈 메뉴 안내 v1 · 오픈 주 캠페인'},
 {value:'creative:cr-missing-record',label:'소재 · cr-missi'},
 {value:'creative:cr-untitled',label:'소재 · 9월 23일 14:05 생성 · 대표 메뉴: 떡볶이 · 오픈 주 캠페인'}]));
check('no orders and no campaigns give no options',()=>assert.deepEqual(plain(ledgerFilterOptions([],[],[])),{campaigns:[],creatives:[]}));
const shown=filter=>orders.filter(o=>ledgerFilterMatch(o,filter)).map(o=>o.id);
check('all and unknown filters keep their meaning',()=>{assert.deepEqual(shown('all'),['o1','o2','o3','o4','o5','o6']);assert.deepEqual(shown('unknown'),['o3'])});
check('an experiment id still filters by experiment',()=>assert.deepEqual(shown('e1'),['o4']));
check('a campaign option filters by the order campaign',()=>{assert.deepEqual(shown('campaign:c1'),['o1','o2','o5','o6']);assert.deepEqual(shown('campaign:c2'),[]);assert.deepEqual(shown('campaign:c-gone'),['o4'])});
check('a creative option filters by the order creative',()=>{assert.deepEqual(shown('creative:cr-titled'),['o1','o6']);assert.deepEqual(shown('creative:cr-missing-record'),['o4'])});
check('a chosen option that is no longer offered falls back to all orders',()=>{
 const experiments=[{id:'e1'}];
 for(const kept of ['all','unknown','e1','campaign:c2','creative:cr-untitled'])assert.equal(ledgerFilterValue(kept,experiments,options),kept);
 for(const gone of ['e-deleted','campaign:c-other','creative:cr-not-ordered'])assert.equal(ledgerFilterValue(gone,experiments,options),'all');
});

// --- 3) 화면 연결 (원문 검사) ------------------------------------------------------------------
check('the execution screen replaces the order guidance with an open-ledger button',()=>{
 assert.ok(!executionUi.includes('주문·매출 화면에서'));
 assert.ok(executionUi.includes('>주문 장부 열기</button>'));
 assert.ok(executionUi.includes('orderLedgerTarget(campaign,stores)'));
 assert.ok(executionUi.includes("import {pushNav} from '@/lib/nav-state'"));
 assert.ok(executionUi.includes('pushNav(target.nav)')&&executionUi.includes('pushNav(ledgerNav(campaign.brandId,chosen))'));
 assert.ok(executionUi.includes('귀속 주문은 인과 효과를 증명하지 않으며, 증분 효과는 별도 비교 실험이 필요합니다.'));
});
check('a brand campaign names the store to open and tells loading, failure and no store apart',()=>{
 assert.ok(executionUi.includes('aria-label="주문 장부를 열 지점"')||executionUi.includes('>주문 장부를 열 지점<'));
 assert.ok(executionUi.includes('이 브랜드에 운영 중인 지점이 없습니다. 점포 마케팅에서 지점을 만든 뒤 주문을 기록하세요.'));
 assert.ok(executionUi.includes("target.kind==='archived'")&&executionUi.includes('보관한 지점에는 주문을 기록할 수 없습니다.'));
 assert.ok(!executionUi.includes('지점 탭을 받기 전까지는'));
});
// 주소의 지점 탭(?tab=ledger)을 점포 마케팅이 첫 탭으로 쓰고, 열린 화면에서 주소가 바뀌어도 지점 다음에 탭을 맞춘다. 고른 탭은 주소에 남긴다(replace).
const storesUi=source('app/store-marketing-panel.tsx'),workspaceUi=source('app/workspace.tsx'),executionE2e=source('e2e/execution.spec.ts');
check('the store panel opens and follows the address tab',()=>{
 assert.ok(workspaceUi.includes('initialStoreId={route.store} initialTab={route.tab}'));
 assert.ok(storesUi.includes("[tab,setTab]=useState(initialTab||'diagnosis')"));
 assert.match(storesUi,/if\(address\.store!==initialStoreId\|\|address\.tab!==initialTab\)\{/);
 assert.match(storesUi,/selectStore\(initialStoreId\);if\(initialTab\)setTab\(initialTab\)\}/);
 assert.ok(storesUi.includes('<Tabs value={tab} onValueChange={showTab}>'));
 assert.match(workspaceUi,/function setStoreScope\(brand:string,store:string,replace:boolean,tab\?:string\)\{const next=normalizeNav\(\{view:'stores',brand:brand==='all'\?null:brand,store:store\|\|null,tab\}\)/);
});
check('the execution E2E lands on the ledger tab without clicking it',()=>{
 assert.ok(!executionE2e.includes('지점 탭이 주소에 없으면 기본 탭으로 열린다'));
 assert.ok(!executionE2e.includes("page.getByRole('tab',{name:'주문 장부',exact:true}).click()"));
 assert.ok(executionE2e.includes("toHaveAttribute('aria-selected','true')"));
});
check('the ledger filter uses the option and match helpers with campaign and creative groups',()=>{
 assert.ok(operationsUi.includes('data.orders.filter(o=>ledgerFilterMatch(o,shownFilter))'));
 assert.ok(operationsUi.includes('<NativeSelectOptGroup label="캠페인">')&&operationsUi.includes('<NativeSelectOptGroup label="소재">'));
 assert.ok(operationsUi.includes("'/api/execution?campaignId='"));
});
check('members see why the admin-only store actions are missing',()=>{
 assert.ok(operationsUi.includes('추적 코드 만들기는 관리자만 할 수 있습니다.'));
 assert.ok(operationsUi.includes('POS 주간 합계 입력은 관리자만 할 수 있습니다.'));
 assert.ok(operationsUi.includes('POS CSV 가져오기는 관리자만 할 수 있습니다.'));
});
check('members read the current publishing limits instead of the form',()=>{
 assert.ok(executionUi.includes('aria-label="현재 발행 횟수 한도"'));
 assert.ok(executionUi.includes('!canManage&&state.limits&&'));
});
// ux-3: 두 화면의 역할 판정은 공용 계정 컨텍스트(app/account-context.tsx)에서 온다. 채널 연결·게시 코드는 AdminOnly로 감싸 직원에게 같은 모양의 안내를 보인다.
check('both screens decide admin-only actions from the shared account context',()=>{
 for(const ui of [executionUi,operationsUi]){assert.ok(ui.includes("from './account-context'"));assert.ok(ui.includes('canManage=canChange(useAccount())'));assert.ok(!ui.includes('useCanManage'))}
 assert.ok(executionUi.includes("<AdminOnly note={'채널 연결과 발행 횟수 한도는 관리자만 바꿀 수 있습니다. '+adminRequestNote}>"));
 assert.ok(executionUi.includes("<AdminOnly note={'게시 코드(쿠폰·POS 태그) 발급은 관리자만 할 수 있습니다. '+adminRequestNote}>"));
 assert.equal((operationsUi.match(/className="subtle-note admin-only-note" role="note"/g)||[]).length,3);
});

console.log(JSON.stringify({passed}));
