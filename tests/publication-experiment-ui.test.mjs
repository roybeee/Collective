// loop-2 발행–실험 연결 화면(app/publication-experiment.tsx): 실제 React(react-dom/server)로 준비 폼 선택지(다른 발행이 연결된 안은 고를 수 없음)와
// 발행 카드의 연결·해제·게시물 ID 입력 칸(관리자·게시 확인만)을 그리고, 선택 값 해석과 실행 화면 연결(원문 검사)을 확인한다.
// 근거: mocked(화면 부품은 기본 HTML 요소 대역, 효과·네트워크 없음). 실제 브라우저 E2E는 not_run.
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
const ui=await load('app/publication-experiment.tsx');
let passed=0;const check=(name,fn)=>{try{fn();passed++}catch(error){console.error('FAIL:',name);throw error}};
const render=(Component,props={})=>renderToStaticMarkup(React.createElement(Component,props));
const text=html=>html.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ');
const buttons=html=>[...html.matchAll(/<button[^>]*>(.*?)<\/button>/g)].map(m=>text(m[1]).trim());
const options=[{id:'e1',title:'첫 장면 실험'}];
const pub=(over={})=>({id:'p1',campaignId:'c1',creativeId:'k',creativeVersion:1,campaignVersion:1,pngHash:'h',factRefs:[],caption:'',mediaUrl:'',scheduledAt:'2026-09-20T03:30:00.000Z',plannedCostKRW:0,version:3,status:'draft',createdAt:'2026-09-20T03:00:00.000Z',...over});
const noop=()=>{};

check('the select value becomes the experiment and arm',()=>{
 const plain=v=>JSON.parse(JSON.stringify(v));
 assert.deepEqual(plain(ui.experimentChoice('e1:control')),{experimentId:'e1',arm:'control'});
 assert.deepEqual(plain(ui.experimentChoice('exp:with:colon:treatment')),{experimentId:'exp:with:colon',arm:'treatment'});
 assert.equal(ui.experimentChoice(''),null);assert.equal(ui.experimentChoice('e1:both'),null);assert.equal(ui.experimentChoice(':control'),null);
});
check('the prepare form offers both arms and disables an arm another live publication holds',()=>{
 const html=render(ui.ExperimentLinkSelect,{options,publications:[pub({id:'other',experimentId:'e1',arm:'control',status:'accepted'}),pub({id:'gone',experimentId:'e1',arm:'treatment',status:'cancelled'})]});
 assert.match(html,/name="experimentLink"/);assert.match(html,/<option value="" selected="">연결하지 않음<\/option>/);
 assert.match(html,/<option value="e1:control" disabled="">첫 장면 실험 · A · 대조안 · 다른 발행이 연결됨<\/option>/);
 assert.match(html,/<option value="e1:treatment">첫 장면 실험 · B · 실험안<\/option>/);
});
check('no experiment select without running Instagram experiments',()=>assert.equal(render(ui.ExperimentLinkSelect,{options:[],publications:[]}),''));
check('an admin sees link controls on an open publication and media input only after publication',()=>{
 const draft=render(ui.PublicationExperiment,{p:pub(),options,canManage:true,busy:false,onAct:noop});
 assert.deepEqual(buttons(draft),['실험 연결']);assert.ok(!/게시물 ID/.test(text(draft)));
 const published=render(ui.PublicationExperiment,{p:pub({status:'published',experimentId:'e1',arm:'control',media:{mediaId:'17900000000000001',permalink:'https://www.instagram.com/p/AbC/',linkedBy:'u',linkedAt:'x'}}),options,canManage:true,busy:false,onAct:noop});
 assert.match(text(published),/콘텐츠 실험: 첫 장면 실험 · A · 대조안 · Instagram 게시물 17900000000000001/);
 assert.deepEqual(buttons(published),['실험 연결','연결 해제','게시물 ID 저장']);
 assert.match(published,/Buffer는 Instagram 게시물 ID를 알려 주지 않습니다/);
});
check('a member sees the link but no controls',()=>{
 const html=render(ui.PublicationExperiment,{p:pub({status:'published',experimentId:'e1',arm:'treatment'}),options,canManage:false,busy:false,onAct:noop});
 assert.match(text(html),/콘텐츠 실험: 첫 장면 실험 · B · 실험안/);assert.deepEqual(buttons(html),[]);
 assert.equal(render(ui.PublicationExperiment,{p:pub(),options,canManage:false,busy:false,onAct:noop}),'','연결 없고 권한 없으면 숨긴다');
});
check('a cancelled publication offers no link controls',()=>{
 assert.equal(render(ui.PublicationExperiment,{p:pub({status:'cancelled'}),options,canManage:true,busy:false,onAct:noop}),'');
 assert.deepEqual(buttons(render(ui.PublicationExperiment,{p:pub({status:'failed',experimentId:'e1',arm:'control'}),options,canManage:true,busy:false,onAct:noop})),[]);
});
const panel=readFileSync('app/execution-panel.tsx','utf8');
check('the execution panel sends the chosen arm when preparing and renders the card block',()=>{
 assert.match(panel,/<ExperimentLinkSelect options=\{experimentOptions\} publications=\{state\.publications\}\/>/);
 assert.match(panel,/experiment:experimentChoice\(String\(f\.get\('experimentLink'\)\)\)/);
 assert.match(panel,/<PublicationExperiment p=\{p\} options=\{experimentOptions\} canManage=\{canManage\} busy=\{busy\} onAct=\{linkAction\}\/>/);
});

console.log(JSON.stringify({passed},null,2));
