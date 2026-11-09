// G7 범위 역할 화면: 계정 관리의 범위 표시(app/account-context.tsx accessLabel)는 실제로 실행해 확인하고, 계정 관리 화면 연결은 원문 검사로 고정한다.
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {SourceTextModule,SyntheticModule,createContext} from 'node:vm';
import ts from 'typescript';
import * as React from 'react';
import * as jsxRuntime from 'react/jsx-runtime';

const context=createContext({console}),cache=new Map();
const packages={react:React,'react/jsx-runtime':jsxRuntime};
const synthetic=(name)=>{const ns=packages[name];if(!ns)throw new Error('unexpected import '+name);const keys=Object.keys(ns);return new SyntheticModule(keys,function(){for(const k of keys)this.setExport(k,ns[k])},{context,identifier:name})};
function moduleFor(path){
 if(cache.has(path))return cache.get(path);
 const m=packages[path]?synthetic(path):new SourceTextModule(ts.transpileModule(readFileSync(path,'utf8'),{fileName:path,compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText,{context,identifier:path});
 cache.set(path,m);return m;
}
const local=(spec,from)=>{const base=spec.startsWith('@/')?resolve(spec.slice(2)):resolve(dirname(from),spec);for(const ext of ['.ts','.tsx'])if(existsSync(base+ext))return base+ext;throw new Error('cannot resolve '+spec)};
async function load(path){const m=moduleFor(resolve(path));if(m.status==='unlinked')await m.link((spec,ref)=>moduleFor(packages[spec]?spec:local(spec,ref.identifier)));if(m.status!=='evaluated')await m.evaluate();return m.namespace}

let passed=0;
const check=(name,actual,expected)=>{assert.deepEqual(JSON.parse(JSON.stringify(actual)),expected,name);passed++};
const ok=(name,value)=>{assert.ok(value,name);passed++};
const source=file=>readFileSync(file,'utf8');

const a=await load('app/account-context.tsx');
const names={brands:[{id:'ofd',name:'Old Ferry Donut'},{id:'oda',name:'ODA Pizza'}],stores:[{id:'s1',name:'성수점'}]};
check('brand manager label lists brand names',a.accessLabel({role:'brand_manager',brandIds:['ofd','oda'],storeIds:[]},names),'브랜드 매니저(Old Ferry Donut·ODA Pizza)');
check('store manager label lists store names',a.accessLabel({role:'store_manager',brandIds:['ofd'],storeIds:['s1']},names),'점포 매니저(성수점)');
check('unknown ids fall back to the id and an empty scope is explicit',[a.accessLabel({role:'reviewer',brandIds:['ghost'],storeIds:[]},names),a.accessLabel({role:'reviewer',brandIds:[],storeIds:[]},names)],['검토자(ghost)','검토자(배정 없음)']);
const panel=source('app/account-panel.tsx');
ok('role select offers scoped roles only when the switch is on',panel.includes('scope?.enabled&&SCOPED_ROLES.map(r=><option key={r} value={r}>{scopedRoleLabels[r]}</option>)'));
ok('role descriptions are shown',panel.includes('scopedRoleDescriptions[role]')&&panel.includes('scopedRoleDescriptions[editing.role]'));
ok('scope pickers use the Checkbox primitive, no raw inputs',panel.includes('<Checkbox checked={chosen.includes(item.id)}')&&!/<input[\s>]/.test(panel));
ok('assignment and clearing call set_access',panel.includes("action:'set_access',userId:account.id,role:editing.role")&&panel.includes("{action:'set_access',role:'member',...target}"));
ok('recent scope changes are listed',panel.includes('aria-label="최근 범위 변경"'));
ok('scoped accounts do not get the admin promotion shortcut',panel.includes("account.status!=='disabled'&&!account.access)list.push([`${to} 권한 변경`"));
console.log(JSON.stringify({passed}));
