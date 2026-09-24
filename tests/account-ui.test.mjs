// ux-3·eng-hygiene-7 ③: 화면이 로그인 계정·역할을 알고 그에 맞게 보인다(app/account-context.tsx). 판정은 서버가 한다(lib/server.ts).
// 계정 계산·안내 문구·AdminOnly·사이드바 프로필은 실제 React로 렌더해 확인하고, 화면 연결과 CampaignTable 위치는 원문(AST) 검사로 고정한다.
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {SourceTextModule,SyntheticModule,createContext} from 'node:vm';
import ts from 'typescript';
import * as React from 'react';
import * as jsxRuntime from 'react/jsx-runtime';
import {renderToStaticMarkup} from 'react-dom/server';

const context=createContext({console}),cache=new Map();
const packages={react:React,'react/jsx-runtime':jsxRuntime};
const synthetic=(name)=>{const ns=packages[name];if(!ns)throw new Error('unexpected import '+name);const keys=Object.keys(ns);return new SyntheticModule(keys,function(){for(const k of keys)this.setExport(k,ns[k])},{context,identifier:name})};
function moduleFor(path){
 if(cache.has(path))return cache.get(path);
 const m=packages[path]?synthetic(path):new SourceTextModule(ts.transpileModule(readFileSync(path,'utf8'),{fileName:path,compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText,{context,identifier:path});
 cache.set(path,m);return m;
}
const local=(spec,from)=>{const base=resolve(dirname(from),spec);for(const ext of ['.ts','.tsx'])if(existsSync(base+ext))return base+ext;throw new Error('cannot resolve '+spec)};
async function load(path){const m=moduleFor(resolve(path));if(m.status==='unlinked')await m.link((spec,ref)=>moduleFor(packages[spec]?spec:local(spec,ref.identifier)));if(m.status!=='evaluated')await m.evaluate();return m.namespace}

let passed=0;
const check=(name,actual,expected)=>{assert.deepEqual(JSON.parse(JSON.stringify(actual)),expected,name);passed++};
const ok=(name,value)=>{assert.ok(value,name);passed++};
const source=file=>readFileSync(file,'utf8');

const a=await load('app/account-context.tsx'),client=await load('app/auth-client.ts');
const h=React.createElement,html=node=>renderToStaticMarkup(node);
const legacy={mode:'legacy',user:null},email=role=>({mode:'email',user:{id:'u-'+role,email:role+'@example.test',role}});
const within=(state,node)=>html(h(a.AccountProvider,{state},node));

// --- 계정 계산: legacy는 소유자(서버 actor()와 같음), 이메일 모드는 세션 역할 -------------------------------
check('legacy mode is the workspace owner like the server actor',a.accountOf(legacy),{id:'legacy',email:null,role:'owner',isAdmin:true,isOwner:true});
check('an email owner is admin and owner',a.accountOf(email('owner')),{id:'u-owner',email:'owner@example.test',role:'owner',isAdmin:true,isOwner:true});
check('an email admin is admin but not owner',a.accountOf(email('admin')),{id:'u-admin',email:'admin@example.test',role:'admin',isAdmin:true,isOwner:false});
check('an email member is neither',a.accountOf(email('member')),{id:'u-member',email:'member@example.test',role:'member',isAdmin:false,isOwner:false});
check('no signed-in user or no gate state has no account',[a.accountOf({mode:'email',user:null}),a.accountOf(null),a.accountOf(undefined)],[null,null,null]);
check('an unknown role reads as a member',a.accountOf({mode:'email',user:{id:'x',email:'x@example.test',role:'guest'}}).role,'member');

// --- 변경 권한: 관리자 이상 / 소유자 전용. 계정을 모르면 막는다 -----------------------------------------------------
const can=state=>[a.canChange(a.accountOf(state)),a.canChange(a.accountOf(state),true)];
check('owner and legacy can change admin and owner settings',[can(email('owner')),can(legacy)],[[true,true],[true,true]]);
check('admin changes admin settings but not owner-only ones',can(email('admin')),[true,false]);
check('member changes neither',can(email('member')),[false,false]);
check('an unknown account changes nothing',[a.canChange(null),a.canChange(null,true)],[false,false]);
const server=source('lib/server.ts');
check('notes are the admin and owner wording',[a.adminOnlyNote(),a.adminOnlyNote(true)],['관리자만 변경할 수 있습니다.','소유자만 변경할 수 있습니다.']);
ok('notes match the server 403 messages',server.includes(`'${a.adminOnlyNote()}'`)&&server.includes(`'${a.adminOnlyNote(true)}'`));

// --- 프로필 라벨: 실제 이메일과 역할(대표·관리자·직원) ---------------------------------------------------------
check('role labels',a.accountRoleLabels,{owner:'대표',admin:'관리자',member:'직원'});
check('an email account shows its email, label and badge',a.accountProfile(a.accountOf(email('member'))),{initial:'M',name:'member@example.test',hasEmail:true,label:'직원',badge:'MEMBER'});
check('an admin shows the admin label',[a.accountProfile(a.accountOf(email('admin'))).label,a.accountProfile(a.accountOf(email('admin'))).badge],['관리자','ADMIN']);
check('legacy shows the workspace owner as 대표',a.accountProfile(a.accountOf(legacy)),{initial:'W',name:'워크스페이스 소유자',hasEmail:false,label:'대표',badge:'OWNER'});
check('an unknown account claims no role',a.accountProfile(null),{initial:'?',name:'계정 확인 전',hasEmail:false,label:'',badge:''});

// --- 렌더: AdminOnly와 사이드바 프로필 ------------------------------------------------------------------------
const save=h('button',null,'저장');
check('a member sees the admin note instead of the button',within(email('member'),h(a.AdminOnly,null,save)),'<p class="subtle-note admin-only-note" role="note">관리자만 변경할 수 있습니다.</p>');
check('an admin sees the button',within(email('admin'),h(a.AdminOnly,null,save)),'<button>저장</button>');
check('an admin sees the owner note on owner-only settings',within(email('admin'),h(a.AdminOnly,{owner:true},save)),'<p class="subtle-note admin-only-note" role="note">소유자만 변경할 수 있습니다.</p>');
check('the owner and legacy see owner-only buttons',[within(email('owner'),h(a.AdminOnly,{owner:true},save)),within(legacy,h(a.AdminOnly,{owner:true},save))],['<button>저장</button>','<button>저장</button>']);
check('read-only fallback stays visible above the note',within(email('member'),h(a.AdminOnly,{fallback:h('span',null,'현재 값 10')},save)),'<span>현재 값 10</span><p class="subtle-note admin-only-note" role="note">관리자만 변경할 수 있습니다.</p>');
check('a view-only screen can replace the note',within(email('member'),h(a.AdminOnly,{note:'품질 콘솔은 소유자·관리자만 볼 수 있습니다.'},save)),'<p class="subtle-note admin-only-note" role="note">품질 콘솔은 소유자·관리자만 볼 수 있습니다.</p>');
ok('outside the account provider nothing is changeable',html(h(a.AdminOnly,null,save)).includes('관리자만 변경할 수 있습니다.'));
const Probe=()=>h('i',null,String(client.useCanManage()));
check('the provider feeds the existing useCanManage too',[within(email('member'),h(Probe)),within(email('admin'),h(Probe))],['<i>false</i>','<i>true</i>']);
const member=within(email('member'),h(a.WorkspaceProfile));
ok('the member profile shows the email, 직원 and MEMBER in a labelled group',member.includes('role="group" aria-label="로그인 계정"')&&member.includes('>member@example.test</b>')&&member.includes('<small>직원</small>')&&member.includes('>MEMBER</span>'));
const owner=within(legacy,h(a.WorkspaceProfile));
ok('the legacy profile shows the workspace owner as 대표',owner.includes('<b>워크스페이스 소유자</b>')&&owner.includes('<small>대표</small>')&&owner.includes('>OWNER</span>'));

// --- AuthGate: 두 모드 모두 AccountProvider로 감싼다. 프로필은 계정 컨텍스트에 있다 ---------------------------------
const gate=source('app/auth-gate.tsx');
ok('AuthGate wraps legacy and email modes in AccountProvider',(gate.match(/<AccountProvider state=\{state\}>/g)||[]).length===2&&!gate.includes('AuthContext.Provider'));
ok('the profile moved to the account context',!gate.includes('function WorkspaceProfile'));

// --- 사이드바 프로필: 고정 문구가 아니라 계정 컨텍스트의 프로필 ---------------------------------------------------------
const workspace=source('app/workspace.tsx');
ok('the sidebar renders the account profile',workspace.includes("import {WorkspaceProfile,canChange,useAccount} from './account-context';")&&workspace.includes('<WorkspaceProfile/></SidebarFooter>'));
ok('no hardcoded profile name or role',!/황인범|Founder & Owner/.test(workspace));

// --- eng-hygiene-7 ③: CampaignTable은 Workspace 밖 최상위 컴포넌트다(렌더마다 재마운트되지 않음) ---------------------------
const file=ts.createSourceFile('workspace.tsx',workspace,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const named=[];(function walk(node,depth){if((ts.isFunctionDeclaration(node)||ts.isVariableDeclaration(node))&&node.name?.getText()==='CampaignTable')named.push(depth);ts.forEachChild(node,child=>walk(child,ts.isFunctionLike(node)?depth+1:depth))})(file,0);
check('CampaignTable is declared once at module level, not inside Workspace',named,[0]);
ok('CampaignTable is declared before Workspace',workspace.indexOf('function CampaignTable(')<workspace.indexOf('export default function Workspace('));
// 표가 쓰는 워크스페이스 값·동작은 props로 받는다(감사 권고 ③). 숨은 컨텍스트 의존이 없어 Provider 밖에서도 그대로 그려진다.
ok('CampaignTable takes the workspace values as props',workspace.includes('function CampaignTable({items,rowMenu=false,data,loaded,search,filter,canManage,setSelectedId,setDeleteTarget,unarchive,newCampaign}:CampaignTableProps)'));
ok('both call sites pass the workspace values',workspace.includes('<CampaignTable items={recent.slice(0,3)} {...tableProps}/>')&&workspace.includes('<CampaignTable items={campaigns} rowMenu {...tableProps}/>')&&workspace.includes('const tableProps={data,loaded,search,filter,canManage,setSelectedId,setDeleteTarget,unarchive,newCampaign};'));
ok('no table context is left in the workspace',!/createContext|useContext|CampaignTableScope/.test(workspace));
ok('table labels are unchanged',workspace.includes('<TableHead>캠페인</TableHead><TableHead>브랜드</TableHead><TableHead>진행 상태</TableHead><TableHead>역할 진행</TableHead><TableHead className="text-right">예산 상한</TableHead>')&&workspace.includes("title={search||filter!=='all'?'조건에 맞는 캠페인이 없습니다':'다음 성장은 첫 브리프에서 시작됩니다'}"));

// --- 사용량 화면: 단가(관리자)·예산 상한과 별칭 단가(소유자)는 읽기 전용+안내, 내보내기는 소유자만 ---------------------------
const usage=source('app/usage-panel.tsx'),part=(text,from,to)=>text.slice(text.indexOf(from),to?text.indexOf(to):undefined);
ok('usage panel uses the account context',usage.includes("from './account-context'")&&!usage.includes('useIsOwner')&&!usage.includes('useCanManage'));
ok('model pricing form is admin-only with the note',/<AdminOnly><form className="form-stack mt-4" onSubmit=\{submit\}>/.test(part(usage,'function PricingForm','// 별칭 단가 선언')));
// 토큰 예산 폼 줄은 PR 4a-2가 고친 안내문 바로 아래라 원래 모양({isOwner?<form …}:소유자 안내)을 두고 판정만 계정 컨텍스트로 바꾼다(병합 충돌 방지).
ok('token budget form is owner-only with the owner note',part(usage,'function TokenBudget','function roleOptions').includes('const isOwner=canChange(useAccount(),true);')&&/\{isOwner\?<form className="form-stack mt-3" onSubmit=\{submit\}>/.test(part(usage,'function TokenBudget','function roleOptions'))&&part(usage,'function TokenBudget','function roleOptions').includes('</form>:<p className="subtle-note">토큰 상한 설정은 워크스페이스 소유자만 할 수 있습니다.</p>}'));
ok('alias pricing form is owner-only with the note',/<AdminOnly owner><form className="form-stack mt-4" onSubmit=\{submit\}>/.test(part(usage,'function AliasPricingForm','export function UsagePanel')));
ok('saved prices and budgets stay visible to everyone',part(usage,'function PricingForm','// 별칭 단가 선언').indexOf('saved.map(')<part(usage,'function PricingForm','// 별칭 단가 선언').indexOf('<AdminOnly>')&&part(usage,'function TokenBudget','function roleOptions').indexOf('<BudgetLineText line={budget.workspace}/>')<part(usage,'function TokenBudget','function roleOptions').indexOf('{isOwner?<form'));
ok('CSV export is shown to the owner only',part(usage,'export function UsagePanel').includes('canOwn=canChange(useAccount(),true)')&&part(usage,'export function UsagePanel').includes('{canOwn&&<p><a '));

// --- 작업자 화면: 직원에게는 설치·연결 해제 대신 관리자 안내. 설치 자격(지정 관리자)은 서버 값(canInstall)을 따른다 -------------
const worker=source('app/research-worker-panel.tsx');
ok('worker panel shows members the admin note',worker.includes("import {AdminOnly} from './account-context';")&&/:state&&<AdminOnly><p className="subtle-note">서버 작업자 설치·다시 발급은 지정된 관리자만 할 수 있습니다\./.test(worker));

// --- 이메일 인증 E2E: 직원 프로필 역할과 관리자 폼 안내 ------------------------------------------------------------------
const e2e=source('e2e/email-auth.spec.ts');
ok('email auth E2E checks the member profile and the admin form note',e2e.includes("member.getByRole('group',{name:'로그인 계정'})")&&e2e.includes("toContainText('직원')")&&e2e.includes("getByText('관리자만 변경할 수 있습니다.',{exact:true})")&&e2e.includes("member.getByLabel('실제 모델 ID',{exact:true})).toHaveCount(0)"));

console.log(JSON.stringify({passed},null,1));
