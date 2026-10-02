// loop-1 실험 카드 '자동 수집 성과'(app/measurement-collect.tsx): 실제 React(react-dom/server)로 카드 절을 그려 수집 실패 사유·재연결 필요·토큰 만료 경고·
// 수집 초안(비교 가능 미확정 안내)과 워크스페이스 알림을 확인하고, 수집 버튼 노출 조건(진행 중·대표·관리자·이 채널 연결)과 collect 요청 본문을 확인한다.
// 학습 화면 연결(카드에 붙임, 결과 입력 초안 채우기에서 comparable은 사람이 확정)과 워크스페이스 알림 연결은 원문 검사로 고정한다.
// 근거: mocked(화면 부품은 기본 HTML 요소 대역, 효과 없음 — 서버 렌더는 useEffect를 돌리지 않는다, fetch는 테스트 대역). 실제 브라우저 E2E는 not_run.
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {createRequire} from 'node:module';
import {SourceTextModule,SyntheticModule,createContext} from 'node:vm';
import ts from 'typescript';

const require=createRequire(import.meta.url),React=require('react'),{renderToStaticMarkup}=require('react-dom/server'),jsxRuntime=require('react/jsx-runtime');
let fetchImpl=()=>{throw new Error('렌더 중 네트워크 호출 금지')};
const context=createContext({console,URL,URLSearchParams,Date,Intl,TextEncoder,crypto:globalThis.crypto,setTimeout,clearTimeout,fetch:(...a)=>fetchImpl(...a)}),cache=new Map();
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
const externalLibs={clsx:await import('clsx'),'tailwind-merge':await import('tailwind-merge')};
function link(spec,ref){
 if(spec==='react')return synthetic(ref.imports.get(spec)||new Set(),n=>React[n]);
 if(spec==='react/jsx-runtime')return synthetic(ref.imports.get(spec)||new Set(),n=>jsxRuntime[n]);
 if(spec.startsWith('@/components/ui/'))return synthetic(ref.imports.get(spec)||new Set(),part);
 if(spec==='lucide-react')return synthetic(ref.imports.get(spec)||new Set(),()=>()=>null);
 if(spec==='sonner')return synthetic(ref.imports.get(spec)||new Set(),()=>({success(){},error(){}}));
 if(spec==='./auth-client')return synthetic(ref.imports.get(spec)||new Set(),n=>n==='useAuthState'?()=>authState:n==='AuthContext'?AuthContext:()=>null);
 if(spec==='./account-context')return moduleFor('app/account-context.tsx');
 // 한 줄 메타 정보는 실제 공용 MetaLine으로 그린다. 클래스 병합(cn)만 단순 결합 대역이다.
 if(spec==='@/components/app/meta-line')return moduleFor('components/app/meta-line.tsx');
 if(spec==='@/lib/utils')return synthetic(ref.imports.get(spec)||new Set(),()=>(...a)=>a.filter(Boolean).join(' '));
 // 첫 화면 알림은 app/home-alerts.tsx에 있고 measurement-collect가 다시 내보낸다(UX-PLAN-3 Q7).
 if(spec==='./home-alerts')return moduleFor('app/home-alerts.tsx');
 // 공용 한 줄 메타(MetaLine)는 실제 부품을 그린다. cn이 쓰는 외부 패키지는 실제 모듈을 그대로 넘긴다.
 if(spec==='@/components/app/meta-line')return moduleFor('components/app/meta-line.tsx');
 if(spec in externalLibs)return synthetic(ref.imports.get(spec)||new Set(),n=>externalLibs[spec][n]);
 if(spec.startsWith('@/lib/'))return moduleFor(resolve(spec.slice(2))+'.ts');
 if(spec.startsWith('.')&&ref.identifier.includes('/lib/')){const base=resolve(dirname(ref.identifier),spec);return moduleFor(existsSync(base+'.ts')?base+'.ts':base+'.tsx')}
 throw new Error('예상하지 못한 import: '+spec);
}
async function load(file){const m=moduleFor(file);if(m.status==='unlinked')await m.link(link);if(m.status!=='evaluated')await m.evaluate();return m.namespace}
const ui=await load('app/measurement-collect.tsx');
let passed=0;const check=(name,fn)=>{try{fn();passed++}catch(error){console.error('FAIL:',name);throw error}};
const render=(Component,props={})=>renderToStaticMarkup(React.createElement(Component,props));
const text=html=>html.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ');
const NOW=Date.parse('2026-09-20T03:00:00.000Z');
const reasons={reauth_required:'인증 실패 · 토큰이 무효하거나 만료됐습니다. 연결 및 설정에서 다시 연결하세요.',upstream_unavailable:'채널 응답 없음 · 채널 API가 응답하지 않았습니다. 다음 시도에 다시 가져옵니다.'};
const source=(over={})=>({id:'e1:control',arm:'control',channel:'naver_ads',target:'cmp-1',window:{from:'2026-09-01',to:'2026-09-07'},rolling:false,lastFetchedAt:'2026-09-20T00:00:00.000Z',failures:0,lastError:null,reauthRequired:false,stopped:false,stoppedReason:null,nextAttemptAt:'2026-09-20T06:00:00.000Z',...over});
const draft={arms:{control:{value:{denominator:4000,numerator:120,source:'네이버 검색광고'},window:{from:'2026-09-01',to:'2026-09-07'},definition:'노출 대비 클릭',limitations:[],fetchedAt:'2026-09-20T00:00:00.000Z',target:'cmp-1',credential:{level:'brand',brandId:'ofd'}}},limitations:['두 실험안을 서로 다른 연결로 수집했습니다.'],fetchedAt:'2026-09-20T00:00:00.000Z',updatedAt:'2026-09-20T00:00:00.000Z',comparable:false};
const view=(sources,d=draft)=>({experimentId:'e1',channel:'naver_ads',draft:d,sources});
const naverConn=(over={})=>({channel:'naver_ads',label:'네이버 검색광고',resolvedScope:{level:'brand',brandId:'ofd'},account:'1234567',expiresAt:null,...over});
const igConn=(over={})=>({channel:'instagram',label:'Instagram',resolvedScope:{level:'workspace'},account:'acct',expiresAt:null,...over});

// ── 1) 실패·재연결 필요·토큰 만료 경고 ──
check('a failing source shows the fixed reason, the count and reconnection',()=>{
 const html=render(ui.CollectStatus,{view:view([source({lastError:{code:'reauth_required',reason:reasons.reauth_required},failures:2,reauthRequired:true,nextAttemptAt:'2026-09-20T12:00:00.000Z'})]),now:NOW});
 assert.match(html,/role="alert"/);
 assert.match(text(html),/자동 수집 실패\(A\(대조안\)\): 인증 실패 · 토큰이 무효하거나 만료됐습니다\./);
 assert.match(text(html),/연속 2회 ?, 재연결 필요 ?, 다음 시도/);
});
check('a stopped source says collection stopped instead of a next attempt',()=>{
 const html=text(render(ui.CollectStatus,{view:view([source({lastError:{code:'reauth_required',reason:reasons.reauth_required},failures:3,reauthRequired:true,stopped:true,stoppedReason:'재연결 필요 · 인증 오류로 자동 수집을 멈췄습니다.',nextAttemptAt:null})]),now:NOW}));
 assert.match(html,/재연결 필요 ?, 자동 수집 멈춤/);assert.ok(!/다음 시도/.test(html));
});
check('a gateway failure is not called a reconnection',()=>{
 const html=text(render(ui.CollectStatus,{view:view([source({lastError:{code:'upstream_unavailable',reason:reasons.upstream_unavailable},failures:1})]),now:NOW}));
 assert.match(html,/채널 응답 없음/);assert.ok(!/재연결 필요/.test(html));
});
check('a healthy source shows the last fetch and the next run',()=>{
 const html=text(render(ui.CollectStatus,{view:view([source()]),now:NOW}));
 assert.match(html,/A\(대조안\) 자동 수집 ?, 대상 cmp-1 ?, 마지막 .* ?, 다음 /);assert.ok(!/자동 수집 실패/.test(html));
});
check('an expired or expiring token is warned on the card',()=>{
 assert.match(text(render(ui.CollectStatus,{connector:naverConn({expiresAt:'2026-09-19T00:00:00.000Z'}),now:NOW})),/토큰이 만료됐습니다\(브랜드 연결 ofd\)/);
 assert.match(text(render(ui.CollectStatus,{connector:igConn({expiresAt:'2026-09-23T00:00:00.000Z'}),now:NOW})),/Instagram 토큰이 .*에 만료됩니다\(워크스페이스 기본\)/);
 assert.equal(render(ui.CollectStatus,{connector:naverConn({expiresAt:'2026-12-01T00:00:00.000Z'}),now:NOW}),'');
 assert.equal(render(ui.CollectStatus,{connector:naverConn(),now:NOW}),'','만료일을 모르면 경고하지 않는다');
});
// ── 2) 수집 초안: arm 값·기간·연결과 비교 경고, 비교 가능 미확정 안내 ──
check('the draft shows each arm with window and credential and the comparison warnings',()=>{
 const html=text(render(ui.CollectStatus,{view:view([source()]),now:NOW}));
 assert.match(html,/A\(대조안\) ?, 120 \/ 4000 ?, 기간 2026-09-01~2026-09-07 ?, 수집 .* ?, 브랜드 연결 ofd/);
 assert.match(html,/두 실험안을 서로 다른 연결로 수집했습니다/);
 assert.match(html,/비교 가능으로 확정되지 않습니다/);
});
check('nothing is drawn without collection or token warnings',()=>assert.equal(render(ui.CollectStatus,{now:NOW}),''));

// ── 3) 수집 버튼 노출과 요청 본문 ──
check('only connectors for the experiment channel with a resolved credential are offered',()=>{
 assert.deepEqual(ui.collectConnectors({channel:'네이버 검색광고'},[naverConn(),igConn()]).map(c=>c.channel),['naver_ads']);
 assert.deepEqual(ui.collectConnectors({channel:'Instagram'},[naverConn(),igConn({resolvedScope:null})]),[]);
 assert.deepEqual(ui.collectConnectors({channel:'YouTube'},[naverConn(),igConn()]),[]);
});
check('the collect button needs a running experiment, an admin and a connection',()=>{
 const c=[naverConn()];
 assert.deepEqual([ui.canStartCollect({status:'running'},true,c),ui.canStartCollect({status:'running'},false,c),ui.canStartCollect({status:'draft'},true,c),ui.canStartCollect({status:'evaluated'},true,c),ui.canStartCollect({status:'running'},true,[])],[true,false,false,false,false]);
});
check('the collect form asks for arm, connector, target and window',()=>{
 const html=render(ui.CollectFields,{f:{arm:'treatment',channel:'naver_ads',target:'',from:'2026-09-01',to:'2026-09-19'},set:()=>{},connectors:[naverConn()]});
 assert.match(html,/B\(실험안\)/);assert.match(html,/네이버 검색광고, 1234567, 브랜드 연결 ofd/);assert.match(text(html),/광고 대상 ID \*/);assert.match(html,/type="date"/);
});
let sent;fetchImpl=async(url,init)=>{sent={url,init};return new Response(JSON.stringify({collected:{},draft:{comparable:false}}),{status:200,headers:{'content-type':'application/json'}})};
await ui.startCollect('e1',{arm:'control',channel:'naver_ads',target:' cmp-1 ',from:'2026-09-01',to:'2026-09-07'});
check('starting collection posts collect to /api/measurements with the experiment, arm, connector, target and window',()=>{
 assert.equal(sent.url,'/api/measurements');assert.equal(sent.init.method,'POST');
 assert.deepEqual(JSON.parse(sent.init.body),{action:'collect',experimentId:'e1',arm:'control',channel:'naver_ads',target:'cmp-1',from:'2026-09-01',to:'2026-09-07'});
});
fetchImpl=()=>{throw new Error('렌더 중 네트워크 호출 금지')};

// ── 4) 워크스페이스 알림 ──
check('the workspace alert counts reconnections and links to the first brand',()=>{
 const alerts=[{experimentId:'e1',brandId:'ofd',title:'첫 장면 실험',channel:'naver_ads',arm:'control',code:'reauth_required',reason:reasons.reauth_required},{experimentId:'e2',brandId:'oda',title:'두 번째',channel:'instagram',arm:'treatment',code:'not_connected',reason:'연결 없음'}];
 const html=render(ui.CollectAlertsView,{alerts,onOpen:()=>{}});
 assert.match(html,/aria-label="성과 자동 수집 재연결 필요"/);assert.match(text(html),/재연결 필요 2건\s*,\s*「첫 장면 실험」 A\(대조안\): 인증 실패 .* 외 1건/);assert.match(html,/<button[^>]*>실험 확인<\/button>/);
 assert.equal(render(ui.CollectAlertsView,{alerts:[],onOpen:()=>{}}),'');
});

// ── 5) 학습 화면·워크스페이스 연결(원문 검사) ──
const panel=readFileSync('app/learning-panel.tsx','utf8'),workspace=readFileSync('app/workspace.tsx','utf8');
check('experiment cards render the collection block after planning',()=>assert.match(panel,/\{e\.status!=='draft'&&<MeasurementCollect experiment=\{e\} view=\{measurementOf\(e\.id\)\}[\s\S]{0,120}canCollect=\{canCollect\}/));
check('collection is offered to owners and admins only',()=>assert.match(panel,/const canCollect=canChange\(useAccount\(\)\);/));
check('result entry is prefilled from the draft only when there is no result, and comparable comes only from a saved result',()=>{
 assert.match(panel,/const draft=e\.result\?null:resultPrefill\(measurementOf\(e\.id\)\)/);
 assert.match(panel,/comparable:e\.result\?\.comparable\|\|false,/);
 assert.match(panel,/modal==='result'&&f\.fromDraft&&/);
});
check('the workspace overview shows the collection alert',()=>assert.match(workspace,/<CollectAlertsNotice onOpen=\{brand=>navigate\(\{view:'learning',brand,tab:'experiments'\}\)\}\/>/));

console.log(JSON.stringify({passed},null,2));
