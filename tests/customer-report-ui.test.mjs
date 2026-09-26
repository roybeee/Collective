// A8-3 고객 보고서 화면(app/customer-report-panel.tsx, docs/CUSTOMER-REPORT.ko.md 5·11절): 실제 React(react-dom/server)로 탭·보고서 화면·동결 대화상자·사실 팩 버튼을 그려
// 역할별 노출(직원 탭 없음, 대표만 '검토 완료'), 스위치 꺼짐의 동결본 목록 전용 화면, 동결 대화상자가 보낼 확인 값(expected)을 그대로 보이는지 확인한다.
// 계정 판정은 실제 app/account-context.tsx를 쓰고 로그인 상태(auth-client)만 대역이다. 연결 줄(점포 마케팅 탭·사실 탭 버튼)과 E2E 가로채기 규칙은 원문 검사로 고정한다.
// 근거: mocked(화면 부품은 같은 이름의 기본 HTML 요소 대역, 효과·네트워크 없음 — 서버 렌더는 useEffect를 돌리지 않는다). 실제 브라우저는 e2e/customer-report.spec.ts.
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {createRequire} from 'node:module';
import {SourceTextModule,SyntheticModule,createContext} from 'node:vm';
import ts from 'typescript';

const require=createRequire(import.meta.url),React=require('react'),{renderToStaticMarkup}=require('react-dom/server'),jsxRuntime=require('react/jsx-runtime');
const context=createContext({console,URL,URLSearchParams,Date,Intl,TextEncoder,crypto:globalThis.crypto,setTimeout,clearTimeout,fetch:()=>{throw new Error('렌더 중 네트워크 호출 금지')}}),cache=new Map();
const transpile=file=>ts.transpileModule(readFileSync(file,'utf8'),{fileName:file,compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText;
function importedNames(code){
 const names=new Map(),file=ts.createSourceFile('m.js',code,ts.ScriptTarget.ES2022,false,ts.ScriptKind.JS);
 for(const s of file.statements){if(!ts.isImportDeclaration(s))continue;const spec=s.moduleSpecifier.text,set=names.get(spec)||new Set(),clause=s.importClause;if(clause?.name)set.add('default');const bound=clause?.namedBindings;if(bound&&ts.isNamedImports(bound))for(const e of bound.elements)set.add((e.propertyName||e.name).text);names.set(spec,set)}
 return names;
}
function moduleFor(file){file=resolve(file);if(cache.has(file))return cache.get(file);const code=transpile(file),m=new SourceTextModule(code,{context,identifier:file});m.imports=importedNames(code);cache.set(file,m);return m}
const synthetic=(names,value)=>new SyntheticModule([...names],function(){for(const n of names)this.setExport(n,value(n))},{context});
// 화면 부품 대역: 이름에 맞는 기본 HTML 요소로 children과 속성을 그대로 그린다(부품 전용 속성은 버린다).
const TAGS={Button:'button',Input:'input',NativeSelect:'select',NativeSelectOption:'option',DialogTitle:'h2',DialogDescription:'p'};
const part=name=>{function Part({children,variant,size,asChild,onOpenChange,onValueChange,...props}){void variant;void size;void asChild;void onOpenChange;void onValueChange;return React.createElement(TAGS[name]||'div',{...props,'data-part':name},children)}Part.displayName=name;return Part};
// 로그인 상태 대역: 테스트가 역할을 바꾼다. 계정 판정(accountOf·canChange)은 실제 account-context다.
let authState=null;
const AuthContext=React.createContext(null);
function link(spec,ref){
 if(spec==='react')return synthetic(ref.imports.get(spec)||new Set(),n=>React[n]);
 if(spec==='react/jsx-runtime')return synthetic(ref.imports.get(spec)||new Set(),n=>jsxRuntime[n]);
 if(spec.startsWith('@/components/ui/'))return synthetic(ref.imports.get(spec)||new Set(),part);
 if(spec==='lucide-react')return synthetic(ref.imports.get(spec)||new Set(),()=>()=>null);
 if(spec==='sonner')return synthetic(ref.imports.get(spec)||new Set(),()=>({success(){},error(){}}));
 if(spec==='./auth-client')return synthetic(ref.imports.get(spec)||new Set(),n=>n==='useAuthState'?()=>authState:n==='AuthContext'?AuthContext:()=>null);
 if(spec==='./account-context')return moduleFor('app/account-context.tsx');
 if(spec.startsWith('@/lib/'))return moduleFor(resolve(spec.slice(2))+'.ts');
 if(spec.startsWith('.')&&ref.identifier.includes('/lib/')){const base=resolve(dirname(ref.identifier),spec);return moduleFor(existsSync(base+'.ts')?base+'.ts':base+'.tsx')}
 throw new Error('예상하지 못한 import: '+spec);
}
async function load(file){const m=moduleFor(file);if(m.status==='unlinked')await m.link(link);if(m.status!=='evaluated')await m.evaluate();return m.namespace}
const ui=await load('app/customer-report-panel.tsx');
let passed=0;const check=(name,fn)=>{try{fn();passed++}catch(error){console.error('FAIL:',name);throw error}};
const render=(Component,props={})=>renderToStaticMarkup(React.createElement(Component,props));
const as=role=>{authState=role==='legacy'?{mode:'legacy',user:null}:role?{mode:'email',user:{id:'u-'+role,email:role+'@example.test',role}}:null};
const text=html=>html.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ');
const buttons=html=>[...html.matchAll(/<button[^>]*>(.*?)<\/button>/g)].map(m=>text(m[1]).trim());
const noop=()=>{},plain=v=>JSON.parse(JSON.stringify(v));

// 합성 데이터(집계만). 동결본 1건(검토 전)과 미리보기 1건.
const WEEKS=['2026-W38','2026-W37','2026-W36'];
const entry=(over={})=>({id:'store:s1:2026-W38',scope:{type:'store',id:'s1',brandId:'oda'},week:'2026-W38',version:2,frozenAt:'2026-09-21T01:02:03.000Z',frozenBy:{id:'u-owner',role:'owner'},review:null,stale:false,
 versions:[{version:2,frozenAt:'2026-09-21T01:02:03.000Z',review:null},{version:1,frozenAt:'2026-09-20T01:02:03.000Z',review:{status:'reviewed',reportVersion:1,by:{id:'u-owner',role:'owner'},at:'2026-09-20T02:00:00.000Z'}}],...over});
const ledger={records:13,orders:12,cancelled:1,refunded:0,netRevenue:345000,contribution:null,unknownCostOrders:2,newCustomers:4,attributedOrders:5,adSpend:50000,productionCost:0,spendTotal:50000};
const preview={enabled:true,id:'store:s1:2026-W38',closed:true,bytes:4000,maxBytes:200000,tooLarge:false,confirm:{orders:12,netRevenue:345000,posStatus:'pass'},frozen:[],
 preview:{schema:'collective.customer-report.v1',scope:{type:'store',id:'s1',brandId:'oda',name:'성수점',address:null,businessPhone:null},period:{week:'2026-W38',from:'2026-09-14',to:'2026-09-20',timeZone:'Asia/Seoul',previousWeek:'2026-W37'},
  ledger:{current:ledger,previous:{...ledger,orders:9,netRevenue:280000}},completeness:[{week:'2026-W38',weekStart:'2026-09-14',weekEnd:'2026-09-20',status:'pass',reason:'',ledgerNet:345000,ledgerOrders:12,posNet:346000,posOrders:12,diffRate:0.003,attributedOrders:5,attributedContribution:null}],
  northStar:{measured:true,weeks:['2026-W35','2026-W36','2026-W37','2026-W38'],passedWeeks:1,excludedWeeks:3,northStarOrders:5,northStarContribution:null},channels:[],spendWarnings:[],connectors:[],publications:{total:0,byStatus:[]},todos:{dataRequests:[],placeMismatches:[]},facts:null,
  notices:['귀속은 증분이 아닙니다.','자동 판정 아님: 합성 고지'],masking:[]}};
const view=(over={})=>({owner:true,enabled:true,weeks:WEEKS,week:'2026-W38',onWeek:noop,preview,frozen:[entry()],busy:false,loading:false,error:'',onFreeze:noop,onReview:noop,onDownload:noop,...over});

// ── 1) 주: 끝난 KST ISO 주만(최근 주부터) ──
check('closed weeks start at the last finished Monday-Sunday week',()=>{
 assert.deepEqual(plain(ui.closedWeeks('2026-09-27',3)),['2026-W38','2026-W37','2026-W36']);
 assert.deepEqual(plain(ui.closedWeeks('2026-09-28',2)),['2026-W39','2026-W38']);
 assert.deepEqual(plain(ui.closedWeeks('2026-01-05',2)),['2026-W01','2025-W52'],'연도를 넘는 주');
});

// ── 2) 스위치 꺼짐: 동결본 목록만 ──
check('report tab shows only frozen list when flag is off',()=>{
 const off=render(ui.ReportView,view({enabled:false,preview:null})),on=render(ui.ReportView,view());
 assert.match(off,/a8_customer_report/);
 assert.match(text(off),/2026-W38 · v2/);
 assert.deepEqual(buttons(off),['MD 받기','CSV 받기','JSON 받기','MD 받기','CSV 받기','JSON 받기'],'꺼짐에는 다운로드만(현재 판·이전 판)');
 for(const hidden of ['<select','미리보기','동결하기','검토 완료'])assert.ok(!off.includes(hidden),`꺼짐 화면에 ${hidden}이(가) 보이면 안 됩니다`);
 assert.match(on,/<select/);assert.ok(buttons(on).includes('동결하기'));assert.match(text(on),/미리보기/);
});
check('the preview shows ledger values with the previous week and the POS status',()=>{
 const html=text(render(ui.ReportView,view()));
 assert.match(html,/주문 수 12건 \(전주 9건\)/);assert.match(html,/순매출 345,000원 \(전주 280,000원\)/);assert.match(html,/공헌이익 미확인/);
 assert.match(html,/POS 대조 통과/);assert.match(html,/귀속은 증분이 아닙니다/);assert.match(html,/자동 판정 아님/);
});
check('a stale frozen report is marked',()=>{
 assert.match(text(render(ui.ReportView,view({frozen:[entry({stale:true})]}))),/장부 변경됨/);
 assert.ok(!text(render(ui.ReportView,view())).includes('장부 변경됨'));
});
check('freeze is disabled while busy or when the report is too large',()=>{
 const disabled=html=>/<button[^>]*disabled=""[^>]*>동결하기<\/button>/.test(html);
 assert.ok(!disabled(render(ui.ReportView,view())));
 assert.ok(disabled(render(ui.ReportView,view({busy:true}))));
 assert.ok(disabled(render(ui.ReportView,view({preview:{...preview,tooLarge:true}}))));
});

// ── 3) 역할: 대표만 검토, 직원은 탭 없음 ──
check('owner sees 검토 완료, admin does not; member sees no report tab',()=>{
 assert.ok(buttons(render(ui.ReportView,view({owner:true}))).includes('검토 완료'));
 assert.ok(!buttons(render(ui.ReportView,view({owner:false}))).includes('검토 완료'));
 assert.ok(!buttons(render(ui.ReportView,view({owner:true,frozen:[entry({review:{status:'reviewed',reportVersion:2,by:{id:'u-owner',role:'owner'},at:'2026-09-22T00:00:00.000Z'}})]}))).includes('검토 완료'),'검토한 판에는 버튼이 없다');
 as('owner');assert.match(render(ui.ReportTabTrigger),/data-part="TabsTrigger"[^>]*>고객 보고서</);
 as('admin');assert.match(render(ui.ReportTabTrigger),/고객 보고서/);assert.match(render(ui.ReportTabContent,{store:{id:'s1',brandId:'oda',name:'성수점'}}),/data-part="TabsContent"/);
 as('member');assert.equal(render(ui.ReportTabTrigger),'');assert.equal(render(ui.ReportTabContent,{store:{id:'s1',brandId:'oda',name:'성수점'}}),'');
 as(null);assert.equal(render(ui.ReportTabTrigger),'','계정을 모르면 숨긴다');
 as('legacy');assert.match(render(ui.ReportTabTrigger),/고객 보고서/);
 assert.deepEqual([['owner',true],['admin',false],['member',false]].map(([r])=>{as(r);return ui.canReview({id:'u',email:null,role:r,isAdmin:r!=='member',isOwner:r==='owner'})}),[true,false,false]);
});

// ── 4) 동결 대화상자: 보낼 확인 값을 그대로 ──
check('freeze dialog shows the expected values it will send',()=>{
 const confirm={orders:12,netRevenue:345000,posStatus:'pass'},html=text(render(ui.FreezeDialog,{week:'2026-W38',confirm,busy:false,onConfirm:noop,onClose:noop}));
 assert.match(html,/2026-W38/);assert.match(html,/주문 수 12건/);assert.match(html,/순매출 345,000원/);assert.match(html,/POS 대조 통과 \(pass\)/);
 const body=ui.freezeBody('s1','2026-W38',{...confirm,extra:'무시'});
 assert.deepEqual(plain(body),{action:'freeze',storeId:'s1',week:'2026-W38',confirmed:true,expected:confirm});
 const missing=text(render(ui.FreezeDialog,{week:'2026-W37',confirm:{orders:0,netRevenue:0,posStatus:null},busy:false,onConfirm:noop,onClose:noop}));
 assert.match(missing,/주문 수 0건/);assert.match(missing,/순매출 0원/);assert.match(missing,/POS 대조 없음/);
 assert.deepEqual(plain(ui.freezeBody('s1','2026-W37',{orders:0,netRevenue:0,posStatus:null}).expected),{orders:0,netRevenue:0,posStatus:null});
});

// ── 5) 사실 팩 받기: 대표·관리자만 ──
check('fact pack download is for owner and admin only',()=>{
 as('owner');assert.ok(buttons(render(ui.FactPackDownload,{brandId:'oda'})).includes('사실 팩 받기'));
 as('admin');assert.ok(buttons(render(ui.FactPackDownload,{brandId:'oda',storeId:'s1'})).includes('사실 팩 받기'));
 as('member');assert.equal(render(ui.FactPackDownload,{brandId:'oda'}),'');
 assert.equal(ui.factPackUrl('oda',undefined,'md'),'/api/customer-reports?type=fact_pack&brandId=oda&format=md');
 assert.equal(ui.factPackUrl('oda','s 1','csv'),'/api/customer-reports?type=fact_pack&brandId=oda&storeId=s+1&format=csv');
 assert.equal(ui.reportFileUrl('store:s1:2026-W38','md'),'/api/customer-reports?id=store%3As1%3A2026-W38&format=md');
 assert.equal(ui.reportFileUrl('store:s1:2026-W38','json',1),'/api/customer-reports?id=store%3As1%3A2026-W38&format=json&version=1');
});

// ── 6) 연결 줄과 규칙(원문) ──
const panelSource=readFileSync('app/customer-report-panel.tsx','utf8'),storeSource=readFileSync('app/store-marketing-panel.tsx','utf8'),factsSource=readFileSync('app/brand-facts-panel.tsx','utf8'),spec=readFileSync('e2e/customer-report.spec.ts','utf8');
check('the store marketing tab list carries the report tab and its content',()=>{
 assert.match(storeSource,/<TabsTrigger value="research">조사 기록<\/TabsTrigger><ReportTabTrigger\/><\/TabsList>/);
 assert.match(storeSource,/<ReportTabContent store=\{store\}\/>/);
});
check('the brand facts tab offers the fact pack outside campaigns only',()=>assert.match(factsSource,/\{!campaign&&<FactPackDownload brandId=\{brand\} storeId=\{storeId\}\/>\}/));
check('the panel talks only to the customer report API and keeps no browser storage or console output',()=>{
 const urls=[...panelSource.matchAll(/'\/api\/[a-z-]+/g)].map(m=>m[0]);assert.ok(urls.length>0);assert.ok(urls.every(u=>u==="'/api/customer-reports"),urls.join(','));
 assert.doesNotMatch(panelSource,/console\.|localStorage|sessionStorage|indexedDB/);
 assert.match(panelSource,/freezeBody\(store\.id,week,/,'동결 요청은 대화상자에 보인 값(preview.confirm)으로 만든다');
});
check('the E2E spec answers with route.fulfill only',()=>{assert.match(spec,/route\.fulfill\(/);assert.doesNotMatch(spec,/route\.fetch\(/)});

console.log(JSON.stringify({passed},null,2));
