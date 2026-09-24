// B5 맥락 정책 리플레이 로컬 실행(비제품 경로, 설계 docs/CONTEXT-REPLAY.ko.md). 서버와 같은 모듈(lib/context-replay-server.ts replayMarkdown)로 한국어 비교표를 표준 출력에 낸다. 모델·HERMES 호출이 없다.
// 응답 JSON: 소유자가 받은 GET 응답의 통계만으로 API 마크다운과 같은 표를 낸다. --sqlite: 같은 조회·판별(readReplaySubmissions)을 로컬 D1 파일에 읽기 전용으로 적용한 뒤 같은 비교(replaySubmissions)를 한다.
// 네트워크를 쓰지 않는다: fetch를 막고, 네트워크 모듈을 가져오지 않으며, 모듈은 fetch 등 네트워크 전역이 없는 vm 컨텍스트에서 돈다. 파일을 쓰지 않는다.
// 사용:
//  node scripts/eval/context-replay.mjs <응답.json>                GET /api/context-replay 응답 {generatedAt,filter,read,replay,notice}
//  node scripts/eval/context-replay.mjs --sqlite <로컬 D1 .sqlite> [--owner <워크스페이스>] [--limit 1~200] [--kind role|meeting|all]
// 잘못된 인자·입력은 종료 코드 2다.
import vm from 'node:vm';
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

if(typeof vm.SourceTextModule!=='function'){
 const child=spawnSync(process.execPath,['--experimental-vm-modules','--no-warnings',fileURLToPath(import.meta.url),...process.argv.slice(2)],{stdio:'inherit'});
 process.exit(child.status??1);
}
globalThis.fetch=()=>{throw new Error('context-replay.mjs는 네트워크를 쓰지 않습니다.')};
const die=message=>{process.stderr.write(message+'\n');process.exit(2)};
const USAGE='사용법: node scripts/eval/context-replay.mjs <응답.json>\n       node scripts/eval/context-replay.mjs --sqlite <로컬 D1 .sqlite> [--owner <워크스페이스>] [--limit 1~200] [--kind role|meeting|all]';
const OPTIONS=['--sqlite','--owner','--limit','--kind'];
const args=process.argv.slice(2);
for(const a of args)if(a.startsWith('--')&&!OPTIONS.includes(a))die(`알 수 없는 옵션입니다: ${a}\n${USAGE}`);
const option=name=>{const i=args.indexOf(name);if(i<0)return undefined;const v=args[i+1];if(!v||v.startsWith('--'))die(`${name} 값이 없습니다.\n${USAGE}`);return v};
const sqlite=option('--sqlite'),owner=option('--owner'),limit=option('--limit'),kind=option('--kind');
const files=args.filter((a,i)=>!a.startsWith('--')&&!OPTIONS.includes(args[i-1]));
if(sqlite?files.length:files.length!==1)die(USAGE);
if(!sqlite&&(owner||limit||kind))die(`--owner·--limit·--kind는 --sqlite와 함께만 씁니다. 응답 JSON은 이미 그 조건으로 계산한 통계입니다.\n${USAGE}`);

// 저장소 TS 모듈을 테스트와 같은 방식(vm SourceTextModule + typescript transpile)으로 읽는다. cloudflare:workers는 로컬 D1 어댑터만 담은 env로 바꾼다.
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const {default:ts}=await import('typescript');
function loader(env){
 const context=vm.createContext({console,TextEncoder,TextDecoder,URL,URLSearchParams}),cache=new Map();
 const envModule=new vm.SyntheticModule(['env'],function(){this.setExport('env',env)},{context});
 const moduleFor=path=>{
  if(cache.has(path))return cache.get(path);
  const code=ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
  const m=new vm.SourceTextModule(code,{context,identifier:path});cache.set(path,m);return m;
 };
 const link=(spec,ref)=>{
  if(spec==='cloudflare:workers')return envModule;
  if(!spec.startsWith('@/')&&!/^\.\.?\//.test(spec))throw new Error(`저장소 밖 모듈은 가져오지 않습니다: ${spec}`);
  const path=spec.startsWith('@/')?resolve(root,spec.slice(2)):resolve(dirname(ref.identifier),spec);
  return moduleFor(path.endsWith('.ts')?path:path+'.ts');
 };
 return async rel=>{const m=moduleFor(resolve(root,rel));if(m.status==='unlinked')await m.link(link);if(m.status!=='evaluated')await m.evaluate();return m.namespace};
}
// node:sqlite 동기 API를 D1 모양(prepare·bind·first·all)으로 감싼다. 읽기 전용 연결이라 쓰기 문장은 실패한다.
const d1=db=>{const statement=(query,values=[])=>({bind:(...v)=>statement(query,v),first:async()=>db.prepare(query).get(...values)??null,all:async()=>({results:db.prepare(query).all(...values)})});return {prepare:query=>statement(query)}};

async function fromSqlite(path){
 const {DatabaseSync}=await import('node:sqlite');
 let db;try{db=new DatabaseSync(resolve(path),{readOnly:true})}catch{die(`sqlite 파일을 열 수 없습니다: ${path}`)}
 try{
  const owners=db.prepare("SELECT DISTINCT owner FROM records WHERE kind='hermes_submission' ORDER BY owner").all().map(r=>r.owner);
  const who=owner??(owners.length===1?owners[0]:die(owners.length?`워크스페이스가 여러 개입니다. --owner로 고르세요: ${owners.join(', ')}`:'리플레이할 HERMES 제출이 없습니다.'));
  const rs=await loader({DB:d1(db)})('lib/context-replay-server.ts');
  let filter;try{filter=rs.replayQuery(new URLSearchParams({...(limit?{limit}:{}),...(kind?{kind}:{})}))}catch(error){return die(error.message)}
  const read=await rs.readReplaySubmissions(who,filter);
  return rs.replayMarkdown({generatedAt:new Date().toISOString(),filter,read:read.counts,replay:rs.replaySubmissions(read.submissions)});
 }catch(error){return die(`로컬 D1을 읽지 못했습니다: ${error.message}`)}finally{db.close()}
}
const COUNTS=['submissions','role','meeting','unknown','unreadable','overBudget'];
async function fromFile(path){
 let body;try{body=JSON.parse(readFileSync(resolve(path),'utf8'))}catch{die(`입력 JSON 파일을 읽을 수 없습니다: ${path}`)}
 const ISO=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/,time=v=>v===null||(typeof v==='string'&&ISO.test(v));
 const shaped=body&&typeof body==='object'&&body.filter&&typeof body.filter==='object'&&body.read&&COUNTS.every(k=>Number.isInteger(body.read[k])&&body.read[k]>=0)&&time(body.read.from)&&time(body.read.to)&&body.replay&&Array.isArray(body.replay.groups);
 if(!shaped)die('입력 형식을 알 수 없습니다. GET /api/context-replay 응답 {generatedAt,filter,read,replay,notice}을 넣으세요.');
 const rs=await loader({})('lib/context-replay-server.ts');
 let filter;try{filter=rs.replayQuery(new URLSearchParams({limit:String(body.filter.limit),kind:String(body.filter.kind)}))}catch(error){return die(`응답 JSON의 filter가 올바르지 않습니다: ${error.message}`)}
 try{return rs.replayMarkdown({generatedAt:body.generatedAt,filter,read:body.read,replay:body.replay})}catch(error){return die(`응답 JSON의 replay를 표로 만들지 못했습니다: ${error.message}`)}
}
process.stdout.write(sqlite?await fromSqlite(sqlite):await fromFile(files[0]));
