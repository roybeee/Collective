// 브랜드 아카이브 진행 표시(lib/archive-stage.ts)의 03 브랜드 진단 · 04 전략 준비 상태와 다음 행동을 고정한다.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {SourceTextModule,createContext} from 'node:vm';
import ts from 'typescript';
const context=createContext({console}),cache=new Map();
function moduleFor(path){path=resolve(path);if(cache.has(path))return cache.get(path);const m=new SourceTextModule(ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText,{context,identifier:path});cache.set(path,m);return m;}
const m=moduleFor('lib/archive-stage.ts');await m.link((s,r)=>moduleFor(resolve(dirname(r.identifier),s+'.ts')));await m.evaluate();
const {archiveStage}=m.namespace;
let passed=0;const check=(name,fn)=>{try{fn();passed++}catch(error){console.error('FAIL:',name);throw error}};
const plain=value=>JSON.parse(JSON.stringify(value));

// 브랜드 아카이브 진단 단계: 진단 없음 / 자료 추가·근거 변경(재진단) / 확정 대기 / 확정됨
const diagnosedAt='2026-09-20T00:00:00.000Z';
const source=(createdAt,status='confirmed',characters=100)=>({createdAt,status,characters});
const base={sources:[source('2026-09-19T00:00:00.000Z')],active:false,canManage:true};
const stage=input=>plain(archiveStage({...base,...input}));
check('no diagnosis asks to run classification or deep research',()=>{assert.deepEqual(stage({fresh:false}),{diagnosis:{done:false,text:'진단 없음',action:'classify'},strategy:{done:false,text:'진단 후 확정'}});assert.equal(stage({fresh:false,sources:[]}).diagnosis.action,'deep');assert.equal(stage({fresh:false,sources:[source(diagnosedAt,'excluded')]}).diagnosis.action,'deep')});
check('a running research is shown as running, not as ready',()=>assert.deepEqual(stage({fresh:false,active:true}).diagnosis,{done:false,text:'조사 진행 중'}));
check('sources added after the diagnosis require a new diagnosis',()=>{const s=stage({diagnosis:{status:'confirmed',createdAt:diagnosedAt,basis:'confirmed',included:false},fresh:false,sources:[source('2026-09-19T00:00:00.000Z'),source('2026-09-21T00:00:00.000Z','candidate'),source('2026-09-22T00:00:00.000Z'),source('2026-09-22T00:00:00.000Z','excluded')]});assert.deepEqual(s,{diagnosis:{done:false,text:'자료 2개 추가됨 · 재진단 필요',action:'classify'},strategy:{done:false,text:'재진단 후 확정'}})});
check('changed or empty evidence requires a new diagnosis',()=>{assert.equal(stage({diagnosis:{status:'candidate',createdAt:diagnosedAt,basis:'changed'},fresh:false}).diagnosis.text,'근거 자료 변경됨 · 재진단 필요');assert.equal(stage({diagnosis:{status:'candidate',createdAt:diagnosedAt,basis:'empty'},fresh:false}).diagnosis.text,'근거 자료 없음 · 재진단 필요')});
check('a confirmed diagnosis whose brand basis changed can be adopted again',()=>{assert.deepEqual(stage({diagnosis:{status:'confirmed',createdAt:diagnosedAt,basis:'confirmed',included:false},fresh:false}),{diagnosis:{done:true,text:'기록됨'},strategy:{done:false,text:'기준 변경 · 다시 채택 필요',action:'confirm'}});assert.deepEqual(stage({diagnosis:{status:'confirmed',createdAt:diagnosedAt,basis:'confirmed',included:false},fresh:false,canManage:false}).strategy,{done:false,text:'기준 변경 · 관리자 재채택 대기'})});
check('a fresh candidate waits for confirmation by an admin',()=>{const d={status:'candidate',createdAt:diagnosedAt,basis:'confirmed'};assert.deepEqual(stage({diagnosis:d,fresh:true}),{diagnosis:{done:true,text:'기록됨'},strategy:{done:false,text:'진단 확정 대기',action:'confirm'}});assert.deepEqual(stage({diagnosis:d,fresh:true,canManage:false}).strategy,{done:false,text:'진단 확정 대기 · 관리자 확정 필요'})});
check('pending evidence and thin research point to the blocking step',()=>{assert.deepEqual(stage({diagnosis:{status:'candidate',createdAt:diagnosedAt,basis:'pending'},fresh:true}).strategy,{done:false,text:'진단 확정 대기 · 근거 자료 검토 필요',action:'review'});assert.deepEqual(stage({diagnosis:{status:'candidate',createdAt:diagnosedAt,basis:'pending'},fresh:true,canManage:false}).strategy,{done:false,text:'진단 확정 대기 · 근거 자료 검토 필요'});assert.deepEqual(stage({diagnosis:{status:'candidate',createdAt:diagnosedAt,basis:'confirmed',researchQuality:{status:'needs_data'}},fresh:true}).strategy,{done:false,text:'진단 확정 대기 · 자료 보완 필요',action:'data'})});
check('a confirmed fresh diagnosis is done and leads to a campaign brief',()=>assert.deepEqual(stage({diagnosis:{status:'confirmed',createdAt:diagnosedAt,basis:'confirmed',included:true},fresh:true}),{diagnosis:{done:true,text:'기록됨'},strategy:{done:true,text:'확정됨',action:'campaign'}}));

console.log(JSON.stringify({passed},null,2));
