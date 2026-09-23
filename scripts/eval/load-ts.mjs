// 순수 lib 모듈(상대 import만)을 테스트와 같은 방식(vm SourceTextModule + typescript transpile)으로 읽는다.
// vm 컨텍스트에는 console만 있다. fetch 등 네트워크 전역이 없어 채점 코드가 외부를 호출하면 ReferenceError로 실패한다.
import {readFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {SourceTextModule,createContext} from 'node:vm';
import ts from 'typescript';

export function pureLoader(root){
 const context=createContext({console}),cache=new Map();
 const moduleFor=path=>{
  if(cache.has(path))return cache.get(path);
  const code=ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
  const m=new SourceTextModule(code,{context,identifier:path});cache.set(path,m);return m;
 };
 return async rel=>{
  const m=moduleFor(resolve(root,rel));
  if(m.status==='unlinked')await m.link((spec,ref)=>{
   if(!/^\.\.?\//.test(spec))throw new Error(`순수 채점 모듈은 상대 경로만 가져올 수 있습니다: ${spec}`);
   return moduleFor(resolve(dirname(ref.identifier),spec+'.ts'));
  });
  if(m.status!=='evaluated')await m.evaluate();
  return m.namespace;
 };
}
