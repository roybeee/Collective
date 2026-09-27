// B2 3단계 사용량 화면 표(app/usage-quality-table.tsx): 실제 React(react-dom/server)로 역할×프롬프트 버전×보고 모델 표를 그려 표본 규칙(n=0 미측정·n<5 표본 부족),
// 모르는 값 '미측정'(0으로 적지 않음), 코드 상수·별칭 표시, 경보·보존 제안 목록, 집계 없음 안내(스위치 이름), 인과 표현 0, 사용량 화면 연결을 확인한다.
// 근거: mocked(서버 렌더, 효과·네트워크 없음). 실제 브라우저는 not_run(E2E 추가 없음).
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {createRequire} from 'node:module';
import {SourceTextModule,SyntheticModule,createContext} from 'node:vm';
import ts from 'typescript';

const require=createRequire(import.meta.url),React=require('react'),{renderToStaticMarkup}=require('react-dom/server'),jsxRuntime=require('react/jsx-runtime');
const context=createContext({console,URL,Date,Intl,fetch:()=>{throw new Error('렌더 중 네트워크 호출 금지')}}),cache=new Map();
const transpile=file=>ts.transpileModule(readFileSync(file,'utf8'),{fileName:file,compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText;
function importedNames(code){
 const names=new Map(),file=ts.createSourceFile('m.js',code,ts.ScriptTarget.ES2022,false,ts.ScriptKind.JS);
 for(const s of file.statements){if(!ts.isImportDeclaration(s))continue;const spec=s.moduleSpecifier.text,set=names.get(spec)||new Set(),bound=s.importClause?.namedBindings;if(bound&&ts.isNamedImports(bound))for(const e of bound.elements)set.add((e.propertyName||e.name).text);names.set(spec,set)}
 return names;
}
function moduleFor(file){file=resolve(file);if(cache.has(file))return cache.get(file);const code=transpile(file),m=new SourceTextModule(code,{context,identifier:file});m.imports=importedNames(code);cache.set(file,m);return m}
const synthetic=(names,value)=>new SyntheticModule([...names],function(){for(const n of names)this.setExport(n,value(n))},{context});
function link(spec,ref){
 if(spec==='react/jsx-runtime')return synthetic(ref.imports.get(spec)||new Set(),n=>jsxRuntime[n]);
 if(spec==='react')return synthetic(ref.imports.get(spec)||new Set(),n=>React[n]);
 if(spec.startsWith('@/lib/'))return moduleFor(resolve(spec.slice(2))+'.ts');
 if(spec.startsWith('.'))return moduleFor(resolve(dirname(ref.identifier),spec)+'.ts');
 throw new Error('예상하지 못한 import: '+spec);
}
async function load(file){const m=moduleFor(file);if(m.status==='unlinked')await m.link(link);if(m.status!=='evaluated')await m.evaluate();return m.namespace}
const ui=await load('app/usage-quality-table.tsx');
let passed=0;const check=(name,ok)=>{assert.ok(ok,name);passed++};
const html=table=>renderToStaticMarkup(React.createElement(ui.QualityTable,{table}));
const row=(over)=>({role:'cmo',promptVersion:null,reportedModel:'hermes-agent',artifacts:0,n:0,approvedFirst:0,firstPassRate:null,revisions:0,discardedTokens:0,unlinkedTokens:0,unknownTokenRuns:0,holds:0,...over});
const table={week:'2026-W39',range:{from:'2026-09-20T15:00:00.000Z',to:'2026-09-27T15:00:00.000Z'},generatedAt:'2026-09-28T00:00:00.000Z',durationMs:120,notice:'자동 판정이 아닙니다. 차이는 나란히 센 숫자일 뿐 그 이유를 말하지 않습니다.',
 totals:{},rows:[row({artifacts:2}),row({role:'content',promptVersion:'role.content@abcdef123456',reportedModel:null,artifacts:3,n:3,approvedFirst:2,discardedTokens:1500,unknownTokenRuns:2}),row({role:'strategy',reportedModel:'model-b',artifacts:5,n:5,approvedFirst:4,firstPassRate:0.8,revisions:1})],
 alarms:[{id:'model_change:hermes:1:aa',type:'model_change',detail:'hermes: hermes-agent → model-b'},{id:'invalid_rate:content:2026-W39',type:'invalid_rate',detail:'content: 이번 주 형식 오류 2/10(20.0%) · 직전 20건 2건(10.0%)'}],
 retention:{signals:2,expiringSoon:1,expiredNotPurged:0,nextExpiry:null,suggestions:['14일 안에 만료되는 비식별 평가 신호 1건이 있습니다.']}};
const out=html(table),text=out.replace(/<[^>]+>/g,' ');

check('no digest yet shows guidance naming the switch and no table',/아직 주간 품질 집계가 없습니다/.test(html(null))&&/b2_digest_queue/.test(html(null))&&!/<table/.test(html(null)));
check('the table has the role, prompt version and reported model columns',['역할','프롬프트 버전','보고 모델','1차 승인율','폐기 토큰'].every(h=>out.includes(`>${h}</th>`)));
check('the week and KST range head the table',/2026-W39/.test(text)&&/2026\. 9\. 21\./.test(text)&&/2026\. 9\. 27\./.test(text));
check('no first-pass decision is unmeasured, not 0%',/총괄 파트너/.test(text)&&/미측정/.test(out.split('총괄 파트너')[1].split('</tr>')[0])&&!/0\.0%/.test(out.split('총괄 파트너')[1].split('</tr>')[0]));
check('fewer than 5 decisions is a sample shortage with n',/표본 부족 \(n=3\)/.test(text));
check('5 or more decisions shows the rate with counts',/80\.0% \(4\/5\)/.test(text));
check('unknown model is unmeasured and the alias says the actual model is unconfirmed',/hermes-agent \(실제 모델 미확인\)/.test(text)&&/<td class="max-w-48 break-words p-3">미측정<\/td>/.test(out));
check('code-constant prompt and registry prompt versions are shown as such',/코드 상수/.test(text)&&/role\.content@abcdef123456/.test(text));
check('token counts with unreported runs say how many are unmeasured',/1,500 · 미측정 2건/.test(text));
check('alarms and the retention suggestion are listed with plain labels',/보고 모델 변경: hermes: hermes-agent → model-b/.test(text)&&/역할 형식 오류 비율/.test(text)&&/보존 정리 제안: 14일 안에/.test(text));
check('an empty week says so instead of drawing zero rows',/집계할 AI 작업물·판정·사용량이 없습니다/.test(html({...table,rows:[],alarms:[],retention:{...table.retention,suggestions:[]}})));
const CAUSAL=/때문|덕분|효과|개선됐|개선되|악화|원인|인해|초래|기여|향상/;
check('the screen uses no causal wording',!CAUSAL.test(text)&&!CAUSAL.test(html(null).replace(/<[^>]+>/g,' ')));
check('firstPassText follows the sample rule',ui.firstPassText({n:0,approvedFirst:0,firstPassRate:null})==='미측정'&&ui.firstPassText({n:4,approvedFirst:4,firstPassRate:null})==='표본 부족 (n=4)');
const panel=readFileSync('app/usage-panel.tsx','utf8');
check('the usage panel renders the table only for owners and admins and only when the response carries it',/\{canAdmin&&data\.qualityTable!==undefined&&<QualityTable table=\{data\.qualityTable\}\/>\}/.test(panel)&&/canAdmin=canChange\(useAccount\(\)\)/.test(panel)&&/qualityTable:data\.qualityTable===undefined\?undefined:/.test(panel));
const notice=readFileSync('lib/quality-digest-queue-server.ts','utf8').match(/DIGEST_NOTICE='([^']+)'/)[1];
check('the stored notice has no causal wording',!CAUSAL.test(notice)&&/자동 판정이 아니며/.test(notice));
console.log(JSON.stringify({passed}));
