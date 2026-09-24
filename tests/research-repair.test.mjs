// A7 수리 턴(기능 스위치 a7_repair_turn, 기본 꺼짐)과 부분 구제 저장 연결.
// 심층 조사 결과가 뼈대 오류(DeepReportShapeError·JSON 아님)로 버려질 때만 같은 조사에 수리 요청을 1회 보낸다. 제출 id는 '<단계 id>:repair'로 고정이고 submitHermes(토큰 예산 가드)를 지난다.
// 근거: mocked(모의 HERMES fetch 스텁, 메모리 SQLite, 합성 브랜드). 외부 네트워크·유료 모델 호출은 0회다.
import assert from 'node:assert/strict';
import {testRuntime} from './helpers/runtime.mjs';

const HERMES='https://hermes.example.com',runs=new Map(),byKey=new Map(),posts=[],external=[];
let seq=0,postMode='ok',nextOutput='',repairOutput='';
const {sql,load}=testRuntime(async(url,options={})=>{
 url=String(url);if(!url.startsWith(HERMES+'/')){external.push(url);throw new Error('모의 주소만 호출합니다: '+url)}
 const path=url.slice(HERMES.length);
 if(path==='/v1/runs'&&options.method==='POST'){
  const key=options.headers['Idempotency-Key'],body=JSON.parse(options.body),repair='original' in JSON.parse(body.input);
  posts.push({key,repair,body});
  if(postMode==='reject')return new Response('{}',{status:400});
  // HERMES처럼 같은 멱등 키는 같은 실행 번호를 돌려준다. lost: 접수는 됐지만 응답이 사라졌다(502).
  let id=byKey.get(key);if(!id){id='run_'+ ++seq;byKey.set(key,id);runs.set(id,repair?repairOutput:nextOutput)}
  if(postMode==='lost')return new Response('{}',{status:502});
  return Response.json({run_id:id});
 }
 const id=/^\/v1\/runs\/([\w-]+)$/.exec(path)?.[1];if(!id||!runs.has(id))return new Response('{}',{status:404});
 return Response.json({object:'hermes.run',run_id:id,status:'completed',output:runs.get(id),usage:{total_tokens:10},model:'mock-model'});
});
const server=await load('lib/server.ts'),exec=await load('lib/research-execution.ts'),usageExport=await load('lib/usage-export.ts'),flags=await load('lib/feature-flags.ts'),budget=await load('lib/token-budget.ts'),{researchPhases}=await load('lib/deep-research.ts');
let passed=0;const check=(name,condition)=>{assert.ok(condition,name);passed++};
const now=new Date().toISOString(),SHAPE='조사 단계 기록이 누락되거나 순서가 다릅니다.',NOT_JSON='조사 응답 형식을 확인하지 못했습니다. 기록을 유지했으며 새 조사로 이어갈 수 있습니다.';
// 합성 브랜드. 실제 고객·매장 정보가 아니다.
const brand={id:'rp-brand',name:'가상분식',short:'GB',category:'SNACK BAR',color:'#224466',bg:'#eef2f6',description:'합성 소개(미확인).',audience:'가상동 주민(가설)',tone:'명료한',constraints:'가격은 확인 전 확정하지 않는다.',knowledge:'합성 메모.'};
async function setup(owner,repairTurn){
 sql.prepare('INSERT INTO settings(owner,secret,model,updated_at) VALUES(?,?,?,?)').run(owner,await server.encrypt(JSON.stringify({provider:'hermes',endpoint:HERMES,key:'mock-only'})),'HERMES',now);
 await server.recordStatement(owner,'brand',brand.id,brand).run();
 if(repairTurn)await flags.setFeatureFlag(owner,{flag:'a7_repair_turn',enabled:true},{id:owner,email:null});
}
const report=change=>{const x={sources:[{id:'s1',title:'공식 자료',category:'brand',url:'https://brand.example.com/a',content:'관찰한 근거',scope:'원문',observedAt:now}],phases:researchPhases.map(phase=>({phase,summary:'검토 내용'})),access:[{sourceId:'s1',method:'browser',tool:'test-browser',scope:'읽기'}],cases:[],customerSignals:[],competitors:[],review:{claims:[],followups:[],unresolved:[]},diagnosis:{summary:'진단',positioning:'p',audience:'a',needs:'n',strengths:'s',gaps:'g',limitations:'l',questions:[],sourceIds:['s1'],opportunities:[{title:'t',hypothesis:'h',action:'a',metric:'m',sourceIds:['s1']}]}};change(x);return JSON.stringify(x)};
const valid=report(()=>{}),shapeBroken=report(x=>{x.phases[0]=null}),twoShapes=report(x=>{x.phases[0]=null;x.diagnosis.summary=''});
// 대화형 심층 조사(단계 1개 'investigation'): start → advance(제출). 다음 advance가 완료 조회·결과 처리다.
async function start(owner,id,output){nextOutput=output;await exec.executeResearch(owner,{action:'start',id,brandId:brand.id});await exec.executeResearch(owner,{action:'advance',id})}
async function step(owner,id,action='advance'){const res=await exec.executeResearch(owner,{action,id});return {status:res.status,body:await res.json(),saved:await server.readRecord(owner,'brand_research',id)}}
const row=(owner,kind,id)=>{const r=sql.prepare('SELECT data,parent_id FROM records WHERE id=? AND owner=? AND kind=?').get(`${owner}:${kind}:${id}`,owner,kind);return r?{...JSON.parse(r.data),parent:r.parent_id}:undefined};
const usageOf=(owner,runId)=>row(owner,'provider_usage','hermes:'+runId);
const repairPosts=()=>posts.filter(p=>p.repair).length;
const count=(owner,kind)=>sql.prepare('SELECT COUNT(*) n FROM records WHERE owner=? AND kind=?').get(owner,kind).n;

// 1) 스위치 꺼짐(기본): 뼈대 오류는 기존 실패 경로·문구 그대로다. 수리 제출 0회, 수리 표시 없음.
{
 const owner='rp-off',id='rp-off-1',stepId=id+'-investigation';await setup(owner,false);
 await start(owner,id,shapeBroken);const before=posts.length,run=(await server.readRecord(owner,'brand_research',id)).steps[0].providerId;
 const {body,saved}=await step(owner,id);
 check('switch off: a shape error fails the research as before',saved.status==='failed'&&saved.steps[0].status==='failed'&&saved.error===SHAPE&&body.error===SHAPE);
 check('switch off: no repair submission is sent or stored',posts.length===before&&!row(owner,'hermes_submission',stepId+':repair')&&!('repair' in saved.steps[0]));
 check('switch off: the raw result is kept and the run is marked invalid output',saved.steps[0].rawResult===shapeBroken&&usageOf(owner,run).domainOutcome==='invalid_output');
}

// 2) 켬 + 뼈대 오류 → 수리 제출 1회(고정 id, 예산 가드 경유). 수리 결과가 유효하면 구제 포함 같은 파서로 저장한다.
{
 const owner='rp-on',id='rp-on-1',stepId=id+'-investigation';await setup(owner,true);
 await start(owner,id,twoShapes);repairOutput=valid;
 const originalRun=(await server.readRecord(owner,'brand_research',id)).steps[0].providerId,before=posts.length,repairsBefore=repairPosts();
 let {body,saved}=await step(owner,id);
 const sub=row(owner,'hermes_submission',stepId+':repair');
 check('switch on: the repair request is stored under the fixed submission id',!!sub);
 const input=JSON.parse(JSON.parse(sub.body).input);
 check('switch on: a shape error sends exactly one repair request',posts.length===before+1&&repairPosts()===repairsBefore+1);
 check('the repair submission has the brand as parent (research kind) and was the one sent',sub.parent===brand.id&&posts.at(-1).key===sub.key);
 check('the repair carries every independent validation error and the original response',JSON.stringify(input.errors)===JSON.stringify([SHAPE,'진단 요약 입력을 확인해 주세요.'])&&input.original===twoShapes&&Array.isArray(input.allowedSourceIds));
 check('the repair tells the model to fix only the format without new research or sources',/새 조사/.test(JSON.parse(sub.body).instructions)&&/새 출처/.test(JSON.parse(sub.body).instructions));
 check('the repair keeps the read-only security rules of the research prompt',['게시','댓글','메시지','결제','계정/보안 설정 변경','인증정보 노출'].every(w=>JSON.parse(sub.body).instructions.includes(w)));
 const reservation=row(owner,'token_reservation',stepId+':repair');
 check('the repair passed the token budget guard (reservation under the repair id)',!!reservation&&reservation.kind==='research'&&reservation.submissionId===stepId+':repair');
 check('while repairing the research stays running with a repair note',saved.status==='running'&&saved.steps[0].status==='running'&&saved.steps[0].repair?.status==='sent'&&/수리/.test(saved.error)&&body.error===saved.error);
 check('the original run is recorded as invalid output',usageOf(owner,originalRun).domainOutcome==='invalid_output');
 check('the provider run id stays private while repairing',!('providerId' in body.steps[0]));
 ({body,saved}=await step(owner,id));
 const repairRun=byKey.get(sub.key),usage=usageOf(owner,repairRun);
 check('a valid repair completes the research through the same parser',saved.status==='completed'&&saved.steps[0].status==='completed'&&!saved.error&&!!saved.report);
 check('repaired sources are stored as candidates only',sql.prepare("SELECT COUNT(*) n FROM records WHERE owner=? AND kind='brand_source' AND json_extract(data,'$.status')='candidate'").get(owner).n===1&&count(owner,'brand_source')===1&&row(owner,'brand_diagnostic',id).status==='candidate');
 check('no raw result is kept after a successful repair',saved.steps[0].rawResult===undefined);
 check('repair usage is in the ledger with the research join keys and a repair role',usage.kind==='research'&&usage.role==='investigation_repair'&&usage.jobId===`${owner}:brand-research:${id}`&&usage.brandId===brand.id&&usage.domainOutcome==='completed');
 check('the repair role passes the usage export filter (kind=research&role=investigation_repair)',usageExport.usageFilter(new URLSearchParams({kind:'research',role:usage.role})).role==='investigation_repair');
 check('the repair reservation is settled by the reported usage',!row(owner,'token_reservation',stepId+':repair'));
 check('research tokens add up both runs',saved.tokens===20);
 check('no further submission after completion',posts.length===before+1);
}

// 3) JSON이 아닌 결과도 뼈대 오류로 수리한다. 수리 결과도 뼈대 실패면 기존 실패 문구로 끝나고 두 번째 수리는 없다.
{
 const owner='rp-twice',id='rp-twice-1';await setup(owner,true);
 await start(owner,id,'조사 결과를 정리하지 못했습니다');repairOutput=shapeBroken;
 const before=repairPosts();
 let {saved}=await step(owner,id);
 check('a non-JSON result is repaired too',repairPosts()===before+1&&saved.steps[0].repair?.status==='sent'&&saved.status==='running');
 check('the non-JSON repair carries the JSON validation error',JSON.parse(JSON.parse(row(owner,'hermes_submission',id+'-investigation:repair').body).input).errors.includes(NOT_JSON));
 const repairStart=posts.length;
 ({saved}=await step(owner,id));
 check('a second shape failure ends with the existing failure wording',saved.status==='failed'&&saved.steps[0].status==='failed'&&saved.error===SHAPE);
 check('the failed repair output is kept as the raw result',saved.steps[0].rawResult===shapeBroken);
 await step(owner,id,'recover');await step(owner,id);
 check('only one repair per research (no second repair)',repairPosts()===before+1&&posts.length===repairStart);
}

// 4) 입력 상한: 추정 입력 토큰이 60k를 넘으면 수리하지 않고 기존 실패 문구 그대로다.
{
 const owner='rp-large',id='rp-large-1';await setup(owner,true);
 const large=report(x=>{x.phases[0]=null;x.notes='가'.repeat(62000)});
 await start(owner,id,large);const before=posts.length;
 const {saved}=await step(owner,id);
 check('over the input cap no repair is sent',posts.length===before&&!row(owner,'hermes_submission',id+'-investigation:repair'));
 check('over the input cap the existing failure and wording stay',saved.status==='failed'&&saved.error===SHAPE&&saved.steps[0].rawResult===large);
 check('the skipped repair is recorded with the estimate',saved.steps[0].repair?.status==='skipped'&&saved.steps[0].repair.estimatedInputTokens>60000);
}

// 5) 예산 가드 409: 수리 없이 기존 실패 + 사유.
{
 const owner='rp-budget',id='rp-budget-1';await setup(owner,true);
 await start(owner,id,shapeBroken);
 await budget.setTokenBudget(server.database(),owner,{scope:'workspace',monthlyTokens:1},{id:owner,email:null});
 const before=posts.length,originalRun=(await server.readRecord(owner,'brand_research',id)).steps[0].providerId;
 const {body,saved}=await step(owner,id);
 check('a budget-blocked repair sends nothing',posts.length===before&&!row(owner,'token_reservation',id+'-investigation:repair'));
 check('a budget-blocked repair fails with the existing wording plus the reason',saved.status==='failed'&&saved.steps[0].status==='failed'&&saved.error.startsWith(SHAPE)&&/토큰 예산 초과/.test(saved.error)&&body.error===saved.error);
 check('the blocked repair is recorded and the original raw result is kept',saved.steps[0].repair?.status==='blocked'&&/토큰 예산 초과/.test(saved.steps[0].repair.reason)&&saved.steps[0].rawResult===shapeBroken);
 check('the original run stays linked and marked invalid output',saved.steps[0].providerId===originalRun&&usageOf(owner,originalRun).domainOutcome==='invalid_output');
}

// 6) HERMES가 수리 요청을 확정 거절(4xx): 수리 없이 기존 실패 + 사유.
{
 const owner='rp-reject',id='rp-reject-1';await setup(owner,true);
 await start(owner,id,shapeBroken);postMode='reject';
 const {saved}=await step(owner,id);postMode='ok';
 check('a rejected repair fails with the existing wording plus the reason',saved.status==='failed'&&saved.error.startsWith(SHAPE)&&/\(400\)/.test(saved.error)&&saved.steps[0].repair?.status==='blocked');
 check('a rejected repair releases its reservation',!row(owner,'token_reservation',id+'-investigation:repair'));
}

// 7) 접수 응답 유실 → 확인 지연(uncertain). 복구는 같은 제출 id·같은 멱등 키로 다시 보내고, 실행과 예약은 하나다.
{
 const owner='rp-recover',id='rp-recover-1',stepId=id+'-investigation';await setup(owner,true);
 await start(owner,id,shapeBroken);repairOutput=valid;postMode='lost';
 const runsBefore=runs.size;
 let {saved}=await step(owner,id);postMode='ok';
 const sub=row(owner,'hermes_submission',stepId+':repair'),first=posts.at(-1);
 check('a lost repair acceptance leaves the research uncertain with a retry',saved.status==='uncertain'&&saved.steps[0].status==='uncertain'&&!!saved.retryAt&&/수리/.test(saved.error)&&!saved.steps[0].providerId);
 const before=posts.length;
 ({saved}=await step(owner,id));
 check('advance before the retry time sends nothing',posts.length===before&&saved.status==='uncertain');
 ({saved}=await step(owner,id,'recover'));
 check('recover resends the same repair with the same idempotency key',posts.length===before+1&&first.key===sub.key&&posts.at(-1).key===sub.key&&posts.at(-1).repair);
 check('recover creates no second repair run',runs.size===runsBefore+1&&saved.steps[0].providerId===byKey.get(sub.key)&&saved.status==='running');
 check('the reservation is not duplicated on recovery',sql.prepare("SELECT COUNT(*) n FROM records WHERE owner=? AND kind='token_reservation' AND id LIKE ?").get(owner,`%${stepId}:repair`).n===1);
 ({saved}=await step(owner,id,'recover'));
 check('recovering an accepted repair only polls it',posts.length===before+1&&saved.status==='completed');
 check('only one repair submission record exists',count(owner,'hermes_submission')===2);
}

// 8) 항목 오류만(뼈대 정상): 수리 없이 구제 저장. 뺀 항목과 사유가 조사 기록에 남는다.
{
 const owner='rp-salvage',id='rp-salvage-1';await setup(owner,true);
 await start(owner,id,report(x=>{x.customerSignals=[{sourceId:'s1',kind:'motivation',observation:'관찰',implication:'함의'},{sourceId:'missing',kind:'motivation',observation:'관찰',implication:'함의'}]}));
 const before=posts.length;
 const {body,saved}=await step(owner,id);
 check('item errors alone do not trigger a repair',posts.length===before&&!row(owner,'hermes_submission',id+'-investigation:repair')&&!('repair' in saved.steps[0]));
 check('item errors alone complete with salvage',saved.status==='completed'&&saved.report.customerSignals.length===1&&count(owner,'brand_source')===1);
 check('the salvage is stored on the research record in the spec shape and returned',Array.isArray(saved.salvage?.dropped)&&saved.salvage.dropped.length===1&&JSON.stringify(saved.salvage.dropped[0])===JSON.stringify({section:'customerSignals',index:1,reason:'실제 조사 자료와 일치하지 않는 근거입니다.'})&&saved.salvage.kept.sources===1&&body.salvage?.dropped?.length===1);
}

// 9) 수리 응답이 원래 응답에 없던 URL의 출처를 만들면 그 출처와 인용을 뺀다(새 출처 금지를 서버에서 확인). 원래 응답의 URL은 그대로 저장된다.
{
 const owner='rp-invent',id='rp-invent-1';await setup(owner,true);
 await start(owner,id,shapeBroken);
 repairOutput=report(x=>{x.sources.push({id:'s2',title:'새 자료',category:'market',url:'https://fabricated.example.org/x',content:'지어낸 근거',scope:'원문',observedAt:now});x.access.push({sourceId:'s2',method:'browser',tool:'test-browser',scope:'읽기'});x.customerSignals=[{sourceId:'s2',kind:'motivation',observation:'지어낸 관찰',implication:'함의'}]});
 await step(owner,id);const {saved}=await step(owner,id);
 const urls=sql.prepare("SELECT json_extract(data,'$.url') u FROM records WHERE owner=? AND kind='brand_source'").all(owner).map(r=>r.u);
 check('a repair cannot add a source whose URL was not in the original response',saved.status==='completed'&&JSON.stringify(urls)===JSON.stringify(['https://brand.example.com/a']));
 check('the invented source and what cites it are recorded as salvage drops',saved.salvage.dropped.some(d=>d.section==='sources'&&d.index===1&&d.id==='s2'&&d.reason==='수리 응답에 원래 없던 출처라 뺐습니다.')&&saved.salvage.dropped.some(d=>d.section==='customerSignals'&&d.reason==='근거 출처가 빠져 함께 뺐습니다.')&&!saved.report.customerSignals.length&&!saved.report.access.some(a=>a.method==='browser'&&a.sourceId!==saved.report.access[0].sourceId));
}
check('no external destination was called',external.length===0);

console.log(JSON.stringify({passed}));
