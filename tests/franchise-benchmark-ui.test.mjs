// 트랙 R R7a '벤치마크' 탭(계획 화면 V9 '경쟁 브랜드는 어떤가') 계약 검사: 실제 경로(/api/franchise, 메모리 D1)의 GET benchmark 보기를 그대로 화면(React SSR)에 넣어 그리고,
// 화면 도우미(loadInput)가 만든 요청을 같은 경로 핸들러로 보낸다. 사례 번호 BU-*는 R7a PR 본문과 같다.
// 근거: mocked(메모리 SQLite, 이메일 모드 세션 주입, 공공데이터포털 fetch 스텁, 화면은 react-dom/server). 실제 브라우저·로컬 D1은 e2e/franchise-recruit.spec.ts(R7a 여정, 외부 호출 없음).
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {createRequire} from 'node:module';
import {SourceTextModule,SyntheticModule,createContext} from 'node:vm';
import ts from 'typescript';
import {franchiseFixture,captureConsole,DISCLAIMER} from './helpers/franchise-fixture.mjs';

const logged=captureConsole();
let portal=async()=>{throw new Error('외부 호출 금지')};
const f=await franchiseFixture({fetch:(url,init)=>portal(url,init)}),{sql,env}=f;
env.AUTH_MODE='email';env.AUTH_ORIGIN='https://agency.test';
const passed=[];const check=(name,val)=>{assert.ok(val,name);passed.push(name)};

// ── 화면 링커(tests/franchise-report-ui.test.mjs와 같은 규칙) ──
const require=createRequire(import.meta.url),React=require('react'),{renderToStaticMarkup}=require('react-dom/server'),jsxRuntime=require('react/jsx-runtime');
let screenFetch=async()=>{throw new Error('화면 네트워크 호출이 준비되지 않았습니다.')};
const context=createContext({console,URL,URLSearchParams,Date:f.clock.ShiftDate,Intl,TextEncoder,TextDecoder,crypto:globalThis.crypto,setTimeout,clearTimeout,btoa,atob,fetch:(...a)=>screenFetch(...a)});
const transpile=file=>ts.transpileModule(readFileSync(file,'utf8'),{fileName:file,compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText;
function importedNames(code){
 const names=new Map(),file=ts.createSourceFile('m.js',code,ts.ScriptTarget.ES2022,false,ts.ScriptKind.JS);
 for(const s of file.statements){if(!ts.isImportDeclaration(s))continue;const spec=s.moduleSpecifier.text,set=names.get(spec)||new Set(),clause=s.importClause;if(clause?.name)set.add('default');const bound=clause?.namedBindings;if(bound&&ts.isNamedImports(bound))for(const e of bound.elements)set.add((e.propertyName||e.name).text);names.set(spec,set)}
 return names;
}
const TAGS={Button:'button',Input:'input',Textarea:'textarea',NativeSelect:'select',NativeSelectOption:'option'};
const part=name=>{function Part({children,variant,size,asChild,onOpenChange,onValueChange,...props}){void variant;void size;void asChild;void onOpenChange;void onValueChange;return React.createElement(TAGS[name]||'div',{...props,'data-part':name},children)}Part.displayName=name;return Part};
const REAL_APP=new Set(['./franchise-common']);
const cache=new Map(),synthetic=(names,value)=>new SyntheticModule([...names],function(){for(const n of names)this.setExport(n,value(n))},{context});
const moduleFor=file=>{file=resolve(file);if(cache.has(file))return cache.get(file);const code=transpile(file),m=new SourceTextModule(code,{context,identifier:file});m.imports=importedNames(code);cache.set(file,m);return m};
function link(spec,ref){
 if(spec==='react')return synthetic(ref.imports.get(spec)||new Set(),n=>React[n]);
 if(spec==='react/jsx-runtime')return synthetic(ref.imports.get(spec)||new Set(),n=>jsxRuntime[n]);
 if(spec.startsWith('@/components/ui/'))return synthetic(ref.imports.get(spec)||new Set(),part);
 if(spec==='lucide-react')return synthetic(ref.imports.get(spec)||new Set(),()=>()=>null);
 if(spec==='./account-context')return synthetic(ref.imports.get(spec)||new Set(),n=>n==='useAccount'?()=>null:()=>false);
 if(spec.startsWith('@/lib/'))return moduleFor(resolve(spec.slice(2))+'.ts');
 if(spec.startsWith('.')&&(ref.identifier.includes('/lib/')||REAL_APP.has(spec))){const base=resolve(dirname(ref.identifier),spec);return moduleFor(existsSync(base+'.ts')?base+'.ts':base+'.tsx')}
 throw new Error('예상하지 못한 import: '+spec);
}
const load=async file=>{const m=moduleFor(file);if(m.status==='unlinked')await m.link(link);if(m.status!=='evaluated')await m.evaluate();return m.namespace};
const ui=await load('app/franchise-benchmark-panel.tsx'),common=await load('app/franchise-common.tsx');
const render=(C,p)=>renderToStaticMarkup(React.createElement(C,p));
const asUser=session=>async(url,init={})=>{
 sql.prepare("DELETE FROM records WHERE kind='execution_rate'").run();
 const headers={...(init.headers||{}),cookie:session.cookie,origin:session.origin};
 return init.method==='POST'?f.route.POST(new Request('https://agency.test'+url,{...init,headers})):f.route.GET(new Request('https://agency.test'+url,{headers}));
};
const as=session=>{screenFetch=asUser(session)};
const view=async session=>{as(session);return common.franchiseGet({view:'benchmark',brandId:'fr-a'})};
const write=async(session,action,payload)=>{as(session);return common.franchisePost(action,{brandId:'fr-a',...payload})};
const reply=body=>new Response(JSON.stringify(body),{status:200,headers:{'content-type':'application/json'}});
const item=(o={})=>({yr:'2025',indutyLclasNm:'외식',indutyMlsfcNm:'제과제빵',brandNm:'가상도넛',rprsvNm:'홍가상',frcsCnt:'120',newFrcsRgsCnt:'15',ctrtEndCnt:'3',ctrtCncltnCnt:'2',nmChgCnt:'4',avrgSlsAmt:'350000',arUnitAvrgSlsAmt:'0',...o});
// 합성 키(실제 공공데이터 키 아님).
const KEY='ScreenSyntheticKey'.repeat(3)+'+/==';

// ── 준비 ──
const WS='bu-owner',boss=f.signIn('bu-boss','admin',1000,WS),member=f.signIn('bu-member','member',2000,WS);
await f.brand(WS,'fr-a');
check('owner turns the franchise switch on',(await f.setFlag(boss,true)).status===200);

// ════ BU-1 직원 화면(키 없음) ════
let v=await view(member),html=render(ui.FranchiseBenchmark,{brandId:'fr-a',admin:false,initial:v});
check('BU-1 the fixed notice comes before any number, with the heuristic disclaimer',html.indexOf('타 브랜드 공개 수치. 자사 예상매출 근거가 아님')>-1&&html.indexOf('타 브랜드 공개 수치. 자사 예상매출 근거가 아님')<html.indexOf(DISCLAIMER));
check('BU-2 members see the blocked reason and the manager-only note, but no key field or load button',html.includes('외부 호출 0')&&html.includes(ui.MEMBER_NOTE)&&!html.includes('type="password"')&&!html.includes('>적재</button>'));

// ════ BU-3 관리자 화면(키 없음) ════
v=await view(boss);html=render(ui.FranchiseBenchmark,{brandId:'fr-a',admin:true,initial:v});
check('BU-3 managers get a masked key field with autofill off and a disabled load button while the key is missing',/<input[^>]*type="password"[^>]*autoComplete="off"|<input[^>]*autoComplete="off"[^>]*type="password"/i.test(html.replace(/autocomplete/g,'autoComplete'))&&/<button[^>]*disabled=""[^>]*>적재<\/button>/.test(html)&&html.includes('저장 안 됨'));

// ════ BU-4 키 저장 → 적재(화면 도우미 요청) ════
let r=await write(boss,'benchmark_key_save',{apiKey:KEY});
check('BU-4 the key saves through the screen helper',r.status===200&&r.body.result.saved===true);
const input=ui.loadInput({year:'2025',brands:'가상도넛\n작은가게, 없는브랜드\n',industry:''});
check('BU-5 loadInput sends a number year and one brand per line or comma',JSON.stringify(input)==='{"year":2025,"brands":["가상도넛","작은가게","없는브랜드"],"industry":""}');
portal=async()=>reply({resultCode:'00',totalCount:2,items:[item(),item({brandNm:'작은가게',frcsCnt:'9',avrgSlsAmt:'0'})]});
r=await write(boss,'benchmark_load',input);
check('BU-6 the helper request loads successfully',r.status===200&&r.body.result.status==='success'&&r.body.result.rowCount===2);
check('BU-7 the result message says what was stored',ui.loadMessage(r.body.result).includes('2개')&&ui.loadMessage({status:'blocked',rowCount:0,failure:{message:'막힘 이유'}}).includes('막힘 이유'));
v=await view(member);html=render(ui.FranchiseBenchmark,{brandId:'fr-a',admin:false,initial:v});
check('BU-8 the table shows won and raw thousand-won values, unreported money, net change and the closure rate with numerator and denominator',html.includes('350,000,000원')&&html.includes('350,000천원')&&html.includes('미기재')&&html.includes('4.2% (5/120)')&&html.includes('>10<'));
check('BU-9 a denominator under 20 hides the rate as a small sample',html.includes('표본 부족 (분모 9개)'));
check('BU-10 formulas, years, unit note, reference and missing names are shown',html.includes('폐점률 = (계약 종료 + 계약 해지) ÷ 연말 가맹점 수')&&html.includes('순증감 = 신규 개점 − (계약 종료 + 계약 해지)')&&html.includes('기준년도 2025')&&html.includes('추정 실적년도 2024')&&html.includes(v.latest.ref)&&html.includes('없는브랜드'));
check('BU-11 the fetch history shows the status label, attempts and retries',html.includes('성공')&&/시도 1회 · 재시도 0회/.test(html));
check('BU-12 no personal field from the response reaches the screen',!html.includes('홍가상'));

// ════ BU-13 막힘 기록 ════
portal=async()=>new Response('<OpenAPI_ServiceResponse><cmmMsgHeader><returnAuthMsg>SERVICE_KEY_IS_NOT_REGISTERED_ERROR</returnAuthMsg></cmmMsgHeader></OpenAPI_ServiceResponse>',{status:200,headers:{'content-type':'text/xml'}});
r=await write(boss,'benchmark_load',input);
v=await view(boss);html=render(ui.FranchiseBenchmark,{brandId:'fr-a',admin:true,initial:v});
check('BU-13 a blocked load shows its cause in the history and keeps the last good table',r.body.result.status==='blocked'&&html.includes('막힘')&&html.includes('SERVICE_NOT_REGISTERED')&&html.includes('350,000,000원'));
check('BU-14 with a saved key the manager screen says so and never shows the key',html.includes('저장됨')&&!html.includes(KEY)&&/<button[^>]*>적재<\/button>/.test(html)&&!/<button[^>]*disabled=""[^>]*>적재<\/button>/.test(html));

// ════ BU-15 원문 검사 ════
const src=readFileSync('app/franchise-benchmark-panel.tsx','utf8');
check('BU-15 the screen never logs or keeps values in browser storage and fetches only its own API',!['console.','localStorage','sessionStorage','indexedDB','document.cookie'].some(b=>src.includes(b))&&!/\bfetch\s*\(/.test(src));
check('BU-16 clearing the key asks first',src.includes('window.confirm(KEY_CLEAR_CONFIRM)'));
check('BU-17 nothing was logged with the key',!logged.some(l=>l.includes(KEY)));
console.log(JSON.stringify({passed:passed.length}));
