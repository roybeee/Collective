// B4-2c 학습 화면 '보상 계보' 절(app/reward-lineage-section.tsx, docs/REWARD-LINEAGE.ko.md 11절): 실제 React(react-dom/server)로 절을 그려 역할별 노출(직원에게 절 없음,
// 대표만 '닫기' 버튼, 관리자는 없음), 스위치 꺼짐 안내, 고지(realPublish:false·partial.kinds·귀속≠증분·자동 판정 아님·규칙별 합산 금지), 버전·규칙 표와 루프 목록을 확인한다.
// 계정 판정은 실제 app/account-context.tsx를 쓰고 로그인 상태(auth-client)만 대역이다. 학습 화면 연결(새 탭 없음)은 원문 검사로 고정한다.
// 근거: mocked(화면 부품은 같은 이름의 기본 HTML 요소 대역, 효과·네트워크 없음 — 서버 렌더는 useEffect를 돌리지 않는다). 실제 브라우저는 not_run(E2E 추가 없음).
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
 // 공용 확인 대화상자(UX-PLAN-3 Q2): 렌더 검사에서는 묻지 않고 승인으로 둔다.
 if(spec==='@/components/app/confirm-dialog')return synthetic(ref.imports.get(spec)||new Set(),n=>n==='askConfirm'?()=>Promise.resolve(true):()=>null);
 // 공용 메타 줄(UX-PLAN-3 7차원): 실제 부품으로 그린다(cn의 clsx·tailwind-merge는 실제 패키지).
 if(spec==='@/components/app/meta-line')return moduleFor('components/app/meta-line.tsx');
 if(spec==='clsx'||spec==='tailwind-merge')return synthetic(ref.imports.get(spec)||new Set(),n=>require(spec)[n]);
 if(spec.startsWith('@/lib/'))return moduleFor(resolve(spec.slice(2))+'.ts');
 if(spec.startsWith('.')&&ref.identifier.includes('/lib/')){const base=resolve(dirname(ref.identifier),spec);return moduleFor(existsSync(base+'.ts')?base+'.ts':base+'.tsx')}
 throw new Error('예상하지 못한 import: '+spec);
}
async function load(file){const m=moduleFor(file);if(m.status==='unlinked')await m.link(link);if(m.status!=='evaluated')await m.evaluate();return m.namespace}
const ui=await load('app/reward-lineage-section.tsx');
let passed=0;const check=(name,fn)=>{try{fn();passed++}catch(error){console.error('FAIL:',name);throw error}};
const render=(Component,props={})=>renderToStaticMarkup(React.createElement(Component,props));
const as=role=>{authState=role==='legacy'?{mode:'legacy',user:null}:role?{mode:'email',user:{id:'u-'+role,email:role+'@example.test',role}}:null};
const text=html=>html.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ');
const buttons=html=>[...html.matchAll(/<button[^>]*>(.*?)<\/button>/g)].map(m=>text(m[1]).trim());
const noop=()=>{};

// 합성 응답(집계 숫자만). 버전 줄 1개, 규칙 줄 2개, 루프 3개(closable·open·closed).
const totals=(decided,approved)=>({artifacts:decided,human:{decidedFirst:decided,approvedFirst:approved,editedFirst:0,revisions:1,firstPassRate:decided>=5?Math.round(approved/decided*10000)/10000:null,status:decided>=5?'measured':'insufficient',reasonCodes:{}},
 publish:{publications:2,approved:2,live:1,cancelled:0,failed:0},engagement:{experiments:1,evaluated:1,adoptedRules:0},order:{attributedOrders:3,netRevenue:45000,contribution:null,unknownCostOrders:1},revisit:null,lineage:{exact:5}});
const side=(d,a)=>({decidedFirst:d,approvedFirst:a,editedFirst:0,revisions:0,firstPassRate:d>=5?Math.round(a/d*10000)/10000:null,status:d>=5?'measured':'insufficient',publish:{publications:1,approved:1,live:0},order:{attributedOrders:0,netRevenue:0,contribution:0,unknownCostOrders:0}});
const windows={before:{from:'2026-08-18',to:'2026-08-31'},after:{from:'2026-09-01',to:'2026-09-14'}};
const loop=(id,status,over={})=>({id,source:{kind:'prompt',eventId:id,unit:'role.content',action:'activate',from:'role.content@aaaaaaaaaaaa',to:'role.content@bbbbbbbbbbbb',evalRunId:'run1'},activatedAt:'2026-09-01T03:00:00.000Z',activatedDay:'2026-09-01',windows,rolledBack:false,status,version:status==='closed'?1:0,
 comparison:{before:side(6,2),after:side(6,5),probTreatmentBetter:0.9612},inputDigest:'sha256:'+'a'.repeat(64),closed:status==='closed'?{at:'2026-09-20T00:00:00.000Z',by:{id:'u-owner',role:'owner'},scope:{brandId:'b1',storeId:null,campaignId:null}}:null,countsToExit:status==='closed',...over});
const data=(over={})=>({enabled:true,decision16:'not_run',partial:{kinds:['review_decision']},
 lineage:{schema:'collective.reward-lineage.v1',period:{from:'2026-08-31',to:'2026-09-27',timeZone:'Asia/Seoul'},scope:{brandId:'b1',storeId:null,campaignId:null},
  layers:{publish:{status:'measured',source:'app_record',liveSource:'connector',realPublish:false}},byPromptVersion:[{promptVersion:'role.content@bbbbbbbbbbbb',role:'content',...totals(6,5)}],byUnitVersion:[],
  byRule:[{ruleRef:'playbook:r1@2',grade:'operator_preference',...totals(5,4)},{ruleRef:'rule-2@1',grade:'performance_observed',...totals(3,1)}],comparisons:[],unallocated:{},notices:[],inputDigest:'sha256:'+'b'.repeat(64)},
 loops:{schema:'collective.improvement-loops.v1',today:'2026-09-27',loops:[loop('prompt:e1','closable'),loop('prompt:e4','open',{id:'prompt:e4'}),loop('prompt:e0','closed',{id:'prompt:e0'})],exit:{target:5,closed:1,counted:1},notices:[],partial:{kinds:[]}},...over});
const ready=(over={})=>({state:'ready',data:data(over)});
const view=(over={})=>({load:ready(),canClose:true,busy:false,onClose:noop,onReload:noop,...over});
const closeButtons=html=>buttons(html).filter(b=>/닫기/.test(b));

// ── 1) 역할: 직원에게 절이 없고, 대표에게만 닫기 버튼 ──
check('member sees no reward lineage section, owner and admin do',()=>{
 as('member');assert.equal(render(ui.RewardLineageSection,{brandId:'b1'}),'');
 as(null);assert.equal(render(ui.RewardLineageSection,{brandId:'b1'}),'','계정을 모르면 숨긴다');
 as('admin');assert.match(render(ui.RewardLineageSection,{brandId:'b1'}),/aria-label="보상 계보"/);
 as('owner');assert.match(render(ui.RewardLineageSection,{brandId:'b1'}),/aria-label="보상 계보"/);
 as('legacy');assert.match(render(ui.RewardLineageSection,{brandId:'b1'}),/aria-label="보상 계보"/);
});
check('only the owner may close loops',()=>{
 assert.deepEqual([['owner',true],['admin',false],['member',false]].map(([r])=>ui.canCloseLoops({id:'u',email:null,role:r,isAdmin:r!=='member',isOwner:r==='owner'})),[true,false,false]);
 assert.deepEqual([['owner',true],['admin',true],['member',false]].map(([r])=>ui.canSeeRewardLineage({id:'u',email:null,role:r,isAdmin:r!=='member',isOwner:r==='owner'})),[true,true,false]);
 assert.equal(ui.canCloseLoops(null),false);
});
check('owner view has a close button on the closable loop only; admin view has none',()=>{
 assert.deepEqual(closeButtons(render(ui.RewardLineageView,view({canClose:true}))),['닫기(수치 동결)']);
 assert.deepEqual(closeButtons(render(ui.RewardLineageView,view({canClose:false}))),[]);
 assert.match(text(render(ui.RewardLineageView,view({canClose:false}))),/닫기는 대표만 할 수 있습니다/);
 assert.ok(/<button[^>]*disabled=""[^>]*>닫기\(수치 동결\)<\/button>/.test(render(ui.RewardLineageView,view({busy:true}))),'바쁠 때는 누를 수 없다');
});

// ── 2) 스위치 꺼짐·불러오기 ──
check('switch off shows only the notice',()=>{
 const html=render(ui.RewardLineageView,view({load:{state:'off',message:'보상 계보 기능이 꺼져 있습니다. 소유자가 기능 스위치 b4_reward_lineage를 켜야 합니다.'}}));
 assert.match(html,/b4_reward_lineage/);assert.ok(!/<table/.test(html));assert.deepEqual(closeButtons(html),[]);
});
check('loading and error states have no tables',()=>{
 assert.match(text(render(ui.RewardLineageView,view({load:{state:'loading'}}))),/계산하고 있습니다/);
 const err=render(ui.RewardLineageView,view({load:{state:'error',message:'불러오지 못함'}}));assert.match(err,/불러오지 못함/);assert.ok(!/<table/.test(err));
});

// ── 3) 표와 고지 ──
check('the notices state realPublish:false, partial kinds, attribution is not incremental and no automatic verdict',()=>{
 const t=text(render(ui.RewardLineageView,view()));
 assert.match(t,/realPublish:false/);assert.match(t,/partial\.kinds/);assert.match(t,/review_decision/);assert.match(t,/귀속은 증분과 다릅니다/);assert.match(t,/자동 판정이 아닙니다/);assert.match(t,/not_run/);
 assert.ok(!/partial\.kinds/.test(text(render(ui.RewardLineageView,view({load:ready({partial:{kinds:[]}})})))),'일부 집계가 없으면 고지하지 않는다');
});
check('the version table shows L0 to L4 per prompt version',()=>{
 const t=text(render(ui.RewardLineageView,view()));
 assert.match(t,/role\.content@bbbbbbbbbbbb/);assert.match(t,/5\/6, 83\.3%/);assert.match(t,/2건\s*,\s*승인 2\s*,\s*접수 1/);assert.match(t,/3건\s*,\s*45,000원/);assert.match(t,/공헌이익 원가 미상/);
});
check('the rule table warns not to add rows up (duplicate allocation) and shows insufficient samples',()=>{
 const t=text(render(ui.RewardLineageView,view()));
 assert.match(t,/중복 배분/);assert.match(t,/합산하지 마세요/);assert.match(t,/playbook:r1@2/);assert.match(t,/1\/3, 표본 부족/);
});
check('the loop list shows before and after, the explanatory probability, the status and the exit count',()=>{
 const t=text(render(ui.RewardLineageView,view()));
 assert.match(t,/닫힌 루프 1\/5건/);assert.match(t,/2\/6, 33\.3%/);assert.match(t,/5\/6, 83\.3%/);assert.match(t,/96\.1%/);assert.match(t,/설명용/);
 assert.match(t,/닫을 수 있음/);assert.match(t,/관찰 중\(14일 미경과\)/);assert.match(t,/닫음\(수치 동결\)/);assert.match(t,/종료 조건에 셈/);
 assert.ok(!/권고|승격하세요|채택하세요/.test(t),'권고·판정 문구가 없다');
});

// ── 4) 학습 화면 연결: 새 탭 없이 학습 규칙 탭 안 ──
check('the learning panel renders the section inside the rules tab without a new tab',()=>{
 const src=readFileSync('app/learning-panel.tsx','utf8'),rules=src.slice(src.indexOf('<TabsContent value="rules">'),src.indexOf('<TabsContent value="jobs">'));
 assert.equal((src.match(/<TabsTrigger /g)||[]).length,4,'탭은 네 개 그대로');
 assert.match(rules,/<RewardLineageSection brandId=\{brandId\}\/>/);
 assert.match(src,/import \{RewardLineageSection\} from '\.\/reward-lineage-section';/);
 const section=readFileSync('app/reward-lineage-section.tsx','utf8');
 assert.ok(!/TabsTrigger|console\./.test(section));assert.match(section,/'\/api\/reward-lineage\?brandId='/);assert.match(section,/api\('close',\{brandId,loopId:l\.id,version:l\.version,expected\}/);
});

console.log(JSON.stringify({passed}));
