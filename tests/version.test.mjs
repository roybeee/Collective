// 배포 검증의 신원 규칙. 거짓 신원을 통과시키면 "새 코드가 서빙된다"는 확인이 무의미해진다.
import assert from 'node:assert/strict';
import {SourceTextModule,createContext} from 'node:vm';
import {readFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import ts from 'typescript';
const context=createContext({console});const cache=new Map();
async function load(path){path=resolve(path);if(cache.has(path))return cache.get(path);const m=new SourceTextModule(ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText,{context,identifier:path});cache.set(path,m);await m.link((s,r)=>load(resolve(dirname(r.identifier),s+'.ts')));return m;}
const mod=await load('lib/app-version.ts');await mod.evaluate();
const {sourceTree,APP_BUILD,APP_TREE}=mod.namespace;

const checks=[];const check=(label,v)=>{assert.ok(v,label);checks.push(label)};
const tree='1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d';

check('a committed tree hash passes through',sourceTree(tree)===tree);
check('a dirty working tree never claims an identity',sourceTree('dirty')==='unknown');
check('a build without git never claims an identity',sourceTree('unknown')==='unknown');
check('a short hash is rejected',sourceTree(tree.slice(0,39))==='unknown');
check('uppercase is rejected so comparison stays byte-exact',sourceTree(tree.toUpperCase())==='unknown');
check('a commit sha-shaped non-hex value is rejected',sourceTree('z'.repeat(40))==='unknown');
check('non-strings are rejected',sourceTree(undefined)==='unknown'&&sourceTree(null)==='unknown'&&sourceTree(40)==='unknown');
check('an uninjected build reports development, not a fake identity',APP_BUILD==='development');
check('an uninjected tree reports unknown',APP_TREE==='unknown');

console.log(JSON.stringify({passed:checks.length,checks},null,2));
