// security-ops-11: 조사 결과 처리 오류. ApiError 문구만 조사 기록에 저장·표시하고, 그 밖의 예외(TypeError 등)는 고정 문구로 바꾸며 로그에는 오류 이름·코드만 남긴다.
// A7 부분 구제 뒤 파서는 null 실험 과제를 TypeError 없이 항목 단위로 뺀다(tests/research-salvage.test.mjs). 그래서 비-ApiError는 파서 밖의 내부 예외로 만든다: 저장된 조사 단계의 sourceIds를 숫자로 망가뜨려
// 결과 처리 중 TypeError('… is not a function')가 나게 한다. 이 스위트는 그 원문이 조사 기록·응답·로그로 새지 않는지 본다.
// 근거: mocked(모의 HERMES fetch 스텁, 메모리 SQLite, 합성 브랜드). 외부 네트워크 호출은 0회다.
import assert from 'node:assert/strict';
import {testRuntime} from './helpers/runtime.mjs';

const HERMES='https://hermes.example.com',outputs=new Map(),external=[];let seq=0,nextOutput='';
const {sql,load}=testRuntime(async(url,options={})=>{
 url=String(url);if(!url.startsWith(HERMES+'/')){external.push(url);throw new Error('모의 주소만 호출합니다: '+url)}
 const path=url.slice(HERMES.length);
 if(path==='/v1/runs'&&options.method==='POST'){const id='run_'+ ++seq;outputs.set(id,nextOutput);return Response.json({run_id:id})}
 const id=/^\/v1\/runs\/([\w-]+)$/.exec(path)?.[1];if(!id||!outputs.has(id))return new Response('{}',{status:404});
 return Response.json({object:'hermes.run',run_id:id,status:'completed',output:outputs.get(id),usage:{total_tokens:10},model:'mock-model'});
});
const server=await load('lib/server.ts'),exec=await load('lib/research-execution.ts'),{researchPhases}=await load('lib/deep-research.ts');
let passed=0;const check=(name,condition)=>{assert.ok(condition,name);passed++};
const FIXED='조사 결과를 처리하지 못했습니다. 다시 시도해 주세요.';
const owner='research-errors-owner',now=new Date().toISOString();
sql.prepare('INSERT INTO settings(owner,secret,model,updated_at) VALUES(?,?,?,?)').run(owner,await server.encrypt(JSON.stringify({provider:'hermes',endpoint:HERMES,key:'mock-only'})),'HERMES',now);
// 합성 브랜드. 실제 고객·매장 정보가 아니다.
const brand={id:'re-brand',name:'가상분식',short:'GB',category:'SNACK BAR',color:'#224466',bg:'#eef2f6',description:'합성 소개(미확인).',audience:'가상동 주민(가설)',tone:'명료한',constraints:'가격은 확인 전 확정하지 않는다.',knowledge:'합성 메모.'};
await server.recordStatement(owner,'brand',brand.id,brand).run();
// 입력 자료 1건(합성). 결과 처리의 입력 자료 필터가 실제로 돌게 한다.
await server.recordStatement(owner,'brand_source','re-input',{id:'re-input',brandId:brand.id,title:'입력 자료',category:'market',origin:'manual',status:'confirmed',url:'https://brand.example.com/input',content:'입력 근거',observedAt:now,createdAt:now,version:1,scope:'원문'},brand.id).run();
const report=change=>{const x={sources:[{id:'s1',title:'공식 자료',category:'brand',url:'https://brand.example.com/a',content:'관찰한 근거',scope:'원문',observedAt:now}],phases:researchPhases.map(phase=>({phase,summary:'검토 내용'})),access:[{sourceId:'s1',method:'browser',tool:'test-browser',scope:'읽기'}],cases:[],customerSignals:[],competitors:[],review:{claims:[],followups:[],unresolved:[]},diagnosis:{summary:'진단',positioning:'p',audience:'a',needs:'n',strengths:'s',gaps:'g',limitations:'l',questions:[],sourceIds:['s1'],opportunities:[{title:'t',hypothesis:'h',action:'a',metric:'m',sourceIds:['s1']}]}};change(x);return JSON.stringify(x)};
// 대화형 심층 조사(단계 1개): start → advance(제출) → advance(완료 조회·결과 처리). corrupt: 제출 뒤 저장된 단계의 sourceIds를 숫자로 바꾼다(내부 예외 유발).
async function run(id,output,corrupt=false){
 nextOutput=output;
 await exec.executeResearch(owner,{action:'start',id,brandId:brand.id});
 await exec.executeResearch(owner,{action:'advance',id});
 if(corrupt)sql.prepare("UPDATE records SET data=json_set(data,'$.steps[0].sourceIds',5) WHERE id=? AND owner=? AND kind='brand_research'").run(`${owner}:brand_research:${id}`,owner);
 const response=await exec.executeResearch(owner,{action:'advance',id});
 return {body:await response.json(),saved:await server.readRecord(owner,'brand_research',id)};
}
const logged=[],original=console.error;console.error=(...args)=>{logged.push(args)};
const unexpected=()=>logged.filter(a=>a[0]==='research_result_unexpected_error');
try{
 let {body,saved}=await run('re-ok',report(()=>{}));
 check('a valid deep report still completes (setup sanity)',saved.status==='completed'&&!saved.error&&body.status==='completed');

 ({body,saved}=await run('re-type',report(()=>{}),true));
 check('a non-ApiError result failure fails the research and its step',saved.status==='failed'&&saved.steps[0].status==='failed');
 check('the stored error is the fixed phrase, not the internal exception text',saved.error===FIXED);
 check('the response shows the same fixed phrase',body.status==='failed'&&body.error===FIXED);
 check('internal exception text never reaches the record or the response',!/Cannot read|TypeError|reading '|is not a function/.test(JSON.stringify(saved)+JSON.stringify(body)));
 check('the raw HERMES result is still kept for review',saved.steps[0].rawResult===outputs.get('run_'+seq));
 check('the unexpected failure is logged once with the error name',unexpected().length===1&&unexpected()[0][1]==='TypeError'&&unexpected()[0][2]===null);
 check('logs carry only primitive values (no exception text or stack)',logged.every(a=>a.every(v=>v===null||['string','number'].includes(typeof v)))&&!/Cannot read|reading '|is not a function|\n\s+at /.test(JSON.stringify(logged)));

 ({body,saved}=await run('re-api',report(x=>{x.phases[0]=null})));
 check('an ApiError result failure keeps its user-facing message',saved.status==='failed'&&saved.error==='조사 단계 기록이 누락되거나 순서가 다릅니다.'&&body.error===saved.error);
 check('ApiError failures are not logged as unexpected',unexpected().length===1);
 check('no external destination was called',external.length===0);
}finally{console.error=original}

console.log(JSON.stringify({passed}));
