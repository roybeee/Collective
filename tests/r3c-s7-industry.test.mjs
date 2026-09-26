// R3c 선행 콘솔 키트(docs/observations/2026-09-26-lane-r-s7-industry.md): 운영 D1 합성 S7 케이스 8건의 기대 업종 ['fnb'] → ['franchise','fnb'].
// 문서의 스니펫을 그대로 꺼내 실제 /api/eval 라우트(app/api/eval/route.ts, 메모리 SQLite)에 대고 check·apply·rollback으로 돌린다(문서와 검사가 갈라지지 않게).
// 수용: check는 쓰기 0, apply는 S7 8건의 industry만 바꾸고 나머지는 바이트까지 그대로, 다시 apply는 쓰기 0, 전제가 하나라도 어긋나면 쓰기 0으로 멈춤,
// 중간 실패 뒤 다시 apply로 남은 건만 바꿈(4xx는 그 건이 그대로라고, 5xx·응답 없음·읽을 수 없는 응답은 바뀌었을 수도 있다고 알림), 처음 읽은 뒤 바뀐 케이스는 쓰지 않음,
// rollback은 가져온 원본 기대 판정으로 되돌림, 출력에 케이스 내용·소유자·서버 오류 본문과 = ? & % 없음, 오늘 채점기로는 두 업종 목록의 판정이 같음.
// 근거: mocked(메모리 SQLite, 로컬 인증 헤더 주입, fetch 심, 합성 스펙 syn-s7-franchise·syn-s2-bakery). 외부 네트워크 호출은 0회다.
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {testRuntime} from './helpers/runtime.mjs';
import {synthesizeCases,canonical} from '../scripts/eval/synthesize.mjs';

const passed=[];
const check=(name,fn)=>{fn();passed.push(name)};
const DOC='docs/observations/2026-09-26-lane-r-s7-industry.md';
const FROM=['fnb'],TO=['franchise','fnb'],MODE_LINE="const MODE='check';",S7_PREFIX='syn-s7-franchise:';
const clone=x=>JSON.parse(JSON.stringify(x));

// 0) 문서에서 스니펫과 예상 출력 예시를 꺼낸다.
check('the lane R observation doc exists',()=>assert.ok(existsSync(DOC),DOC));
const doc=readFileSync(DOC,'utf8');
const section=(name)=>{
 const start=`<!-- ${name}:start -->`,end=`<!-- ${name}:end -->`;
 assert.equal(doc.split(start).length,2,start);assert.equal(doc.split(end).length,2,end);
 const body=doc.slice(doc.indexOf(start)+start.length,doc.indexOf(end));assert.ok(body.length>0,name);
 return body;
};
const fenced=(body,lang)=>[...body.matchAll(new RegExp('```'+lang+'\\n([\\s\\S]*?)\\n```','g'))].map(m=>m[1]);
const snippets=fenced(section('s7-snippet'),'js');
check('the doc has exactly one js block between the snippet markers',()=>assert.equal(snippets.length,1));
const snippet=snippets[0];
check('the snippet has the MODE line set to check exactly once',()=>assert.equal(snippet.split('\n').filter(l=>l.trim()===MODE_LINE).length,1));
check('the snippet declares the fixed target constants',()=>{for(const line of ["const SPEC_ID='syn-s7-franchise';","const CAMPAIGN_ID='syn-s7-franchise-campaign';","const FROM=['fnb'];","const TO=['franchise','fnb'];",'const EXPECTED=8;'])assert.equal(snippet.split('\n').filter(l=>l.trim()===line).length,1,line)});
const withMode=mode=>snippet.split('\n').map(l=>l.trim()===MODE_LINE?l.replace(MODE_LINE,`const MODE='${mode}';`):l).join('\n');

// 1) 모의 런타임과 실제 합성 스펙 데이터. S7 8건과 S2 15건(구경꾼)을 가져온다.
let writes=0,unlockFail=false;
const external=[];
// unlockFail: 다음 잠금 해제(releaseLock의 DELETE)가 던진다(모의 D1 오류). 라우트는 이미 쓴 뒤 finally에서 던진다.
const {sql,load}=testRuntime(async url=>{external.push(String(url));throw new Error('모의 런타임은 외부 호출을 하지 않습니다: '+url)},{beforeRun:st=>{writes++;if(unlockFail&&/^DELETE FROM mutation_locks/.test(st.query)){unlockFail=false;throw new Error('모의 잠금 해제 실패')}}});
const server=await load('lib/server.ts'),evalServer=await load('lib/eval-server.ts'),route=await load('app/api/eval/route.ts');
const graders=await load('lib/graders/index.ts'),content=await load('lib/graders/content.ts'),industry=await load('lib/graders/industry.ts');
const owner='r3c-owner',by={id:owner,email:'owner-r3c@example.test'},ORIGIN='https://agency.test';
const generator={commit:'c'.repeat(40),tree:'d'.repeat(40)};
const s7Spec=JSON.parse(readFileSync('scripts/eval/specs/syn-s7-franchise.json','utf8')),s2Spec=JSON.parse(readFileSync('scripts/eval/specs/syn-s2-bakery.json','utf8'));
const s7=await synthesizeCases(clone(s7Spec),{generator}),s2=await synthesizeCases(clone(s2Spec),{generator});
check('the real S7 spec generates 8 role cases whose industry is fnb',()=>assert.ok(s7.cases.length===8&&s7.cases.every(c=>c.kind==='role'&&c.externalKey.startsWith(S7_PREFIX)&&canonical(c.expectations.industry)===canonical(FROM))));
const imported7=await evalServer.importCases(owner,clone(s7),by,generator.tree),imported2=await evalServer.importCases(owner,clone(s2),by,generator.tree);
check('S7 (8) and S2 (15) import as new synthetic cases',()=>assert.ok(imported7.created===8&&imported2.created===15));

const caseRows=()=>sql.prepare("SELECT id,data,updated_at FROM records WHERE owner=? AND kind='eval_case' ORDER BY id").all(owner).map(r=>({id:r.id,data:r.data,updated_at:r.updated_at}));
const parsed=rows=>rows.map(r=>JSON.parse(r.data));
const snapshot=()=>sql.prepare('SELECT * FROM records ORDER BY id').all().map(r=>({...r}));
const restore=rows=>{sql.exec('DELETE FROM records');sql.exec('DELETE FROM mutation_locks');const ins=sql.prepare('INSERT INTO records(id,owner,kind,parent_id,data,updated_at) VALUES(?,?,?,?,?,?)');for(const r of rows)ins.run(r.id,r.owner,r.kind,r.parent_id,r.data,r.updated_at)};
const fresh=snapshot(),freshCases=caseRows();
const original=Object.fromEntries(parsed(freshCases).map(c=>[c.id,c]));
const s7Ids=Object.values(original).filter(c=>c.externalKey.startsWith(S7_PREFIX)).map(c=>c.id).sort();
const s2Rows=rows=>rows.filter(r=>!s7Ids.includes(JSON.parse(r.data).id));
const changedIds=(before,after)=>after.filter(r=>before.find(b=>b.id===r.id)?.data!==r.data).map(r=>JSON.parse(r.data).id).sort();
check('the fixture has 8 S7 cases and 15 bystanders before any run',()=>assert.ok(s7Ids.length===8&&s2Rows(freshCases).length===15));

// 실제 라우트를 소유자로 직접 부르는 도우미(시나리오 준비용. 스니펫 호출과 따로 센다).
const routePost=async input=>{const res=await route.POST(new Request(ORIGIN+'/api/eval',{method:'POST',headers:{'oai-authenticated-user-id':owner,'content-type':'application/json',origin:ORIGIN},body:JSON.stringify(input)}));return {status:res.status,body:await res.json()}};
const setIndustry=async(id,value)=>{const r=await routePost({action:'update_case',id,expectations:{...original[id].expectations,industry:value}});assert.equal(r.status,200,JSON.stringify(r.body))};
const caseUrl=id=>`/api/eval?case=${encodeURIComponent(id)}`;
const addRun=async(status,caseIds)=>{const at=new Date().toISOString(),id='run-'+status+'-'+caseIds.length;await server.recordStatement(owner,'eval_run',id,{id,label:'준비용',variant:'active',set:'dev',caseIds,tokenBudget:1000,usedTokens:0,status,host:null,createdBy:by,createdAt:at,updatedAt:at,results:[]}).run()};

// 2) 스니펫이 부르는 fetch 심: 상대 경로 /api/eval만 실제 라우트로 넘긴다. auth: owner(소유자 헤더), none(헤더 없음 → 실제 401), forbidden(모의 403).
// failAt·failKind: failAt번째 POST에만 적용한다.
//  쓰기 전 거부: '409body'(라우트를 부르지 않는 모의 409, 오류 본문에 케이스 내용과 = ? & %), 'inuse'(그 케이스를 쓰는 queued run을 넣고 실제 라우트 → 실제 409).
//  쓰기 여부를 알 수 없음: '500'(라우트를 부르지 않는 모의 500), '502after'(라우트가 쓴 뒤 모의 프록시 502), 'unlock'(라우트가 쓴 뒤 releaseLock이 던짐 → Next.js처럼 500, 잠금 행이 남음),
//  'lost'(라우트가 쓴 뒤 응답을 잃고 던짐), 'truncated'(라우트가 쓴 뒤 200 본문이 잘림), 'shapeless'(라우트가 쓴 뒤 expectations가 없는 200 JSON).
//  응답 이상(모의 서버 이상): 'tamper'(응답의 금지 표현을 비움), 'tamperIndustry'(응답의 업종을 FROM으로).
// fx {id,nth,before,fn,status}: 이번 실행에서 그 케이스의 nth번째 GET에만 적용한다. before는 라우트보다 먼저 부른다(실제 동시 편집). fn은 응답 본문을 바꾸고(모의), status는 모의 오류 응답이다.
//  apply의 바꿀 케이스는 1=처음 읽기, 2=쓰기 직전 읽기, 3=쓴 뒤 다시 읽기다. 이미 목표 값인 케이스는 1=처음 읽기, 2=다시 읽기다.
// getFail {url,status,raw}: 이 경로의 GET을 모의 응답으로 돌려준다(목록 500, 케이스 404, raw면 그 본문 그대로).
const calls=[],printed=[];
const LEAK='가상분식머신 a=b?c&d% 모의 거부';
let auth='owner',failAt=0,failKind='',posts=0,fx=null,getFail=null,reads={};
const shim=async(url,options={})=>{
 const method=String(options.method||'GET').toUpperCase(),headers=new Headers(options.headers||{});
 calls.push({url:String(url),method,credentials:options.credentials,cache:options.cache,contentType:headers.get('content-type'),body:options.body});
 if(typeof url!=='string'||!url.startsWith('/api/eval')){external.push(String(url));throw new TypeError('상대 경로 /api/eval만 부른다')}
 if(auth==='forbidden')return Response.json({error:'소유자만 변경할 수 있습니다.'},{status:403});
 if(auth==='owner')headers.set('oai-authenticated-user-id',owner);
 if(method==='POST'){
  headers.set('origin',ORIGIN);posts++;
  const hit=posts===failAt;
  if(hit&&failKind==='500')return new Response('Internal Server Error',{status:500});
  if(hit&&failKind==='409body')return Response.json({error:LEAK},{status:409});
  if(hit&&failKind==='inuse')await addRun('queued',[JSON.parse(options.body).id]);
  if(hit&&failKind==='unlock')unlockFail=true;
  let res;
  try{res=await route.POST(new Request(ORIGIN+url,{method,headers,body:options.body}))}
  catch{return new Response('Internal Server Error',{status:500})}
  finally{unlockFail=false;if(hit&&failKind==='inuse')sql.prepare("DELETE FROM records WHERE owner=? AND kind='eval_run'").run(owner)}
  if(hit&&failKind==='lost')throw new TypeError('Failed to fetch');
  if(hit&&failKind==='502after')return new Response('Bad Gateway',{status:502});
  if(hit&&failKind==='shapeless'){await res.text();return Response.json({ok:true},{status:200})}
  if(hit&&failKind==='truncated'){const text=await res.text();return new Response(text.slice(0,Math.floor(text.length/2)),{status:200,headers:{'content-type':'application/json'}})}
  if(hit&&failKind==='tamper'){const body=await res.json();return Response.json({...body,expectations:{...body.expectations,prohibitedTerms:[]}},{status:res.status})}
  if(hit&&failKind==='tamperIndustry'){const body=await res.json();return Response.json({...body,expectations:{...body.expectations,industry:FROM}},{status:res.status})}
  return res;
 }
 if(getFail&&url===getFail.url)return getFail.raw!==undefined?new Response(getFail.raw,{status:getFail.status,headers:{'content-type':'application/json'}}):Response.json({error:'모의 실패'},{status:getFail.status});
 const n=reads[url]=(reads[url]||0)+1,hit=fx&&url===caseUrl(fx.id)&&n===fx.nth;
 if(hit&&fx.status)return Response.json({error:'모의 실패'},{status:fx.status});
 if(hit&&fx.before)await fx.before();
 const res=await route.GET(new Request(ORIGIN+url,{method,headers}));
 if(hit&&fx.fn){const body=await res.json();return Response.json(fx.fn(body),{status:res.status})}
 return res;
};
const runs=[];
const run=async(mode,{as='owner',fail=0,kind='',fx:effect=null,get=null}={})=>{
 auth=as;failAt=fail;failKind=kind;fx=effect;getFail=get;posts=0;writes=0;reads={};
 const start=calls.length,lines=[],other=[];
 const con={log:(...a)=>lines.push(a.map(String).join(' ')),info:(...a)=>other.push(a),warn:(...a)=>other.push(a),error:(...a)=>other.push(a),table:(...a)=>other.push(a),dir:(...a)=>other.push(a)};
 const returned=await runInNewContext(withMode(mode),{fetch:shim,console:con});
 const result={summary:clone(returned),returned:JSON.stringify(returned),lines,other,writes,posts,calls:calls.slice(start)};
 printed.push(...lines);runs.push(result);
 return result;
};
const quiet=r=>r.posts===0&&r.writes===0;

// a) check: 쓰기 0, 8건 바꿀 예정, POST 없음.
restore(fresh);
let r=await run('check');
check('check reports ok, 8 found and 8 to change',()=>assert.ok(r.summary.mode==='check'&&r.summary.ok===true&&r.summary.found===8&&r.summary.toChange===8&&r.summary.already===0&&r.summary.changed===0&&r.summary.verified===0&&!('reason' in r.summary),r.returned));
check('check lists the 8 S7 ids as pending and nothing as changed',()=>assert.ok(canonical([...r.summary.pendingIds].sort())===canonical(s7Ids)&&r.summary.changedIds.length===0&&r.summary.failed.length===0));
check('check sends no POST and writes nothing',()=>assert.ok(quiet(r)&&r.calls.every(c=>c.method==='GET')));
check('check leaves every eval_case row byte-identical',()=>assert.deepEqual(caseRows(),freshCases));
// 바꿀 순서(목록 순서). 쓰기 직전 읽기와 동시 편집 시나리오가 몇 번째 건에서 멈추는지 정한다.
const listOrder=[...r.summary.pendingIds];

// b) apply: S7 8건만 바뀐다. industry 밖 기대 판정·요청·키·해시·세트·이름·출처·생성기는 그대로.
r=await run('apply');
const applied=caseRows(),appliedCases=Object.fromEntries(parsed(applied).map(c=>[c.id,c]));
check('apply reports ok with 8 changed and 8 verified',()=>assert.ok(r.summary.mode==='apply'&&r.summary.ok===true&&r.summary.changed===8&&r.summary.already===0&&r.summary.verified===8&&r.summary.failed.length===0&&r.summary.pendingIds.length===0&&!('reason' in r.summary),r.returned));
check('apply sends exactly 8 POSTs',()=>assert.equal(r.posts,8));
check('apply changes exactly the 8 S7 rows',()=>assert.deepEqual(changedIds(freshCases,applied),s7Ids));
check('apply leaves the 15 S2 rows byte-identical',()=>assert.deepEqual(s2Rows(applied),s2Rows(freshCases)));
check('apply replaces only industry: expectations are the old bytes with industry swapped in place',()=>{for(const id of s7Ids)assert.equal(JSON.stringify(appliedCases[id].expectations),JSON.stringify({...original[id].expectations,industry:TO}),id)});
check('apply keeps every other expectations key canonically equal',()=>{const rest=e=>{const o={...e};delete o.industry;return canonical(o)};for(const id of s7Ids)assert.ok(rest(appliedCases[id].expectations)===rest(original[id].expectations)&&canonical(appliedCases[id].expectations.industry)===canonical(TO),id)});
check('apply keeps request, specHash, externalKey, set, label, source, generator and campaignId',()=>{for(const id of s7Ids)for(const f of ['request','specHash','externalKey','set','label','source','generator','campaignId','kind','role','createdAt'])assert.equal(canonical(appliedCases[id][f]),canonical(original[id][f]),id+' '+f)});
check('apply sets expectationsUpdatedAt on each S7 case',()=>assert.ok(s7Ids.every(id=>original[id].expectationsUpdatedAt===undefined&&typeof appliedCases[id].expectationsUpdatedAt==='string')));
check('apply POST bodies carry only action, id and expectations with industry TO and no facts',()=>{const bodies=r.calls.filter(c=>c.method==='POST').map(c=>JSON.parse(c.body));assert.ok(bodies.length===8&&bodies.every(b=>canonical(Object.keys(b).sort())===canonical(['action','expectations','id'])&&b.action==='update_case'&&canonical(b.expectations.industry)===canonical(TO)&&!('facts' in b.expectations)))});
const afterApply=snapshot();

// c) 다시 apply: 0건 변경, 8건 이미, 쓰기 0.
r=await run('apply');
check('a second apply changes 0, counts 8 already and verifies 8',()=>assert.ok(r.summary.ok===true&&r.summary.changed===0&&r.summary.already===8&&r.summary.toChange===0&&r.summary.verified===8,r.returned));
check('a second apply sends no POST and writes nothing',()=>assert.ok(quiet(r)));
check('a second apply leaves every row byte-identical',()=>assert.deepEqual(caseRows(),applied));
r=await run('check');
check('check after apply reports 0 to change and 8 already',()=>assert.ok(r.summary.ok===true&&r.summary.toChange===0&&r.summary.already===8&&r.summary.verified===8&&quiet(r),r.returned));

// d) 쓰기 0으로 멈추는 경우. 각 시나리오는 깨끗한 가져오기 상태에서 시작한다.
const aborts=async(name,mode,prepare,pattern,opts={},extra=()=>{})=>{
 restore(fresh);await prepare();const before=caseRows();
 const res=await run(mode,opts);
 check(`${name}: stops with ok false and a Korean reason`,()=>assert.ok(res.summary.ok===false&&pattern.test(res.summary.reason||'')&&/[가-힣]/.test(res.summary.reason),res.returned));
 check(`${name}: sends no POST, writes nothing and leaves rows byte-identical`,()=>{assert.ok(quiet(res),JSON.stringify({posts:res.posts,writes:res.writes}));assert.deepEqual(caseRows(),before)});
 extra(res);
 return res;
};
await aborts('a queued run that uses an S7 case','apply',()=>addRun('queued',[s7Ids[2]]),/진행 중.*평가 실행/);
await aborts('check while a queued run uses an S7 case','check',()=>addRun('queued',[s7Ids[0]]),/진행 중.*평가 실행/);
await aborts('a running run that uses an S7 case','apply',()=>addRun('running',[s2Rows(freshCases).map(x=>JSON.parse(x.data).id)[0],s7Ids[5]]),/진행 중.*평가 실행/);
await aborts('an S7 case whose industry is neither FROM nor TO','apply',()=>setIndustry(s7Ids[4],['education']),/기대 업종/,{},res=>check('the odd-industry stop still reports found 8',()=>assert.equal(res.summary.found,8)));
await aborts('an S7 case whose industry is the single string fnb','apply',()=>setIndustry(s7Ids[1],'fnb'),/기대 업종/);
// 업종은 [주 업종, ...허용 업종] 순서가 뜻을 가진다. 순서가 바뀐 목록과 fnb를 품은 다른 목록도 FROM·TO가 아니다.
await aborts('an S7 case whose industry is TO reordered (fnb first)','apply',()=>setIndustry(s7Ids[2],['fnb','franchise']),/기대 업종/);
await aborts('an S7 case whose industry contains fnb plus another industry','apply',()=>setIndustry(s7Ids[3],['fnb','education']),/기대 업종/);
await aborts('a missing S7 case (7 found)','apply',async()=>{assert.equal((await routePost({action:'delete_case',id:s7Ids[0]})).status,200)},/8건.*7건/,{},res=>check('the missing-case stop reports found 7',()=>assert.equal(res.summary.found,7)));
await aborts('an extra S7 case (9 found)','apply',async()=>{const extra=clone(s7);extra.cases=[{...extra.cases[0],externalKey:S7_PREFIX+'role:extra'}];assert.equal((await evalServer.importCases(owner,extra,by,generator.tree)).created,1)},/8건.*9건/,{},res=>check('the extra-case stop reports found 9',()=>assert.equal(res.summary.found,9)));
await aborts('GET /api/eval without a login (401)','apply',async()=>{},/로그인.*HTTP 401/,{as:'none'},res=>check('the 401 stop makes a single GET',()=>assert.ok(res.calls.length===1&&res.calls[0].method==='GET')));
await aborts('GET /api/eval as a non-owner (403, mocked)','apply',async()=>{},/소유자.*HTTP 403/,{as:'forbidden'});
await aborts('GET /api/eval failing with 500 (mocked)','apply',async()=>{},/목록.*HTTP 500/,{get:{url:'/api/eval',status:500}});
await aborts('a case read failing with 404 (mocked)','apply',async()=>{},/케이스를 읽지 못했습니다.*HTTP 404/,{get:{url:`/api/eval?case=${encodeURIComponent(s7Ids[5])}`,status:404}});
await aborts('an unknown MODE','Apply',async()=>{},/MODE/,{},res=>check('an unknown MODE makes no request at all',()=>assert.equal(res.calls.length,0)));
// 모의: 로그인 화면 같은 JSON이 아닌 200 본문. 브라우저 오류 문구는 본문 앞부분을 되풀이하므로 = ? & %와 케이스 내용을 앞에 둔다.
await aborts('a case read that returns a non-JSON 200 body (mocked)','apply',async()=>{},/예상하지 못한 오류/,{get:{url:caseUrl(s7Ids[1]),status:200,raw:LEAK}},res=>check('the unexpected-error stop prints one line without the body text or = ? & %',()=>assert.ok(res.lines.length===1&&!/[=?&%]/.test(res.lines[0])&&!res.lines[0].includes('가상분식머신')&&!res.lines[0].includes('모의 거부'),res.lines[0])));

// d-2) 전제에 걸리지 않는 것: 끝난 run, 같은 캠페인의 다른 키·수동 케이스는 무시하고 센다.
restore(fresh);await addRun('completed',s7Ids);
r=await run('check');
check('a completed run that used S7 cases does not block',()=>assert.ok(r.summary.ok===true&&r.summary.toChange===8,r.returned));
restore(fresh);await addRun('queued',s2Rows(freshCases).slice(0,2).map(x=>JSON.parse(x.data).id));
r=await run('apply');
check('a queued run that uses only other cases does not block apply',()=>assert.ok(r.summary.ok===true&&r.summary.changed===8&&r.summary.verified===8,r.returned));
restore(fresh);
{
 const v2=clone(s7);v2.cases=[{...v2.cases[0],externalKey:'syn-s7-franchise-v2:role:cmo'}];
 assert.equal((await evalServer.importCases(owner,v2,by,generator.tree)).created,1);
}
r=await run('check');
check('a same-campaign key that only shares the spec id prefix (syn-s7-franchise-v2:) is ignored',()=>assert.ok(r.summary.ok===true&&r.summary.found===8&&r.summary.ignored===1,r.returned));
restore(fresh);
{
 const copy=clone(s7);copy.cases=[{...copy.cases[0],externalKey:'syn-s7-copy:role:cmo'}];
 assert.equal((await evalServer.importCases(owner,copy,by,generator.tree)).created,1);
 const c0=s7.cases[0],manual=await routePost({action:'save_case',kind:'role',role:c0.role,request:c0.request,expectations:c0.expectations,set:'dev',label:'수동 준비용',externalKey:S7_PREFIX+'role:manual',specHash:'m'.repeat(32)});
 assert.equal(manual.status,200,JSON.stringify(manual.body));
 // 역할이 아닌 S7 키 행(모의: 저장 행을 직접 넣는다. 지금 S7 스펙에는 회의·브리프 케이스가 없다).
 const step={...original[s7Ids[0]],id:'s7-step-row',kind:'meeting_step',externalKey:S7_PREFIX+'meeting_step:quality'};
 await server.recordStatement(owner,'eval_case',step.id,step).run();
}
const withIgnored=caseRows();
r=await run('apply');
check('rows with the S7 campaign but another key, a manual source or a non-role kind are ignored and counted',()=>assert.ok(r.summary.ok===true&&r.summary.found===8&&r.summary.ignored===3&&r.summary.changed===8,r.returned));
check('ignored rows stay byte-identical while the 8 S7 rows change',()=>assert.deepEqual(changedIds(withIgnored,caseRows()),s7Ids));

// e) 섞인 상태(끊긴 apply 뒤 일부만 TO): 나머지만 바꾸고 8건 모두 확인한다.
restore(fresh);
for(const id of s7Ids.slice(0,3))await setIndustry(id,TO);
const mixed=caseRows();
r=await run('apply');
check('a mixed-state apply changes only the 5 remaining cases',()=>assert.ok(r.summary.ok===true&&r.summary.already===3&&r.summary.toChange===5&&r.summary.changed===5&&r.posts===5,r.returned));
check('a mixed-state apply ends with all 8 verified',()=>assert.equal(r.summary.verified,8));
check('a mixed-state apply leaves the 3 already-changed rows byte-identical',()=>assert.deepEqual(changedIds(mixed,caseRows()),s7Ids.slice(3)));
check('a mixed-state apply ends with the same expectations as a clean apply',()=>{const now=Object.fromEntries(parsed(caseRows()).map(c=>[c.id,c]));for(const id of s7Ids)assert.equal(JSON.stringify(now[id].expectations),JSON.stringify(appliedCases[id].expectations),id)});

// f) 중간 실패: 4번째 POST. 4xx는 서버가 쓰기 전에 거부했으니 그 건은 그대로다. 5xx·응답 없음·읽을 수 없는 응답은 서버가 이미 썼을 수 있어 '바뀌었을 수도'라고 알린다.
// 어느 쪽이든 그 자리에서 멈추고, 다시 apply하면 D1을 새로 읽어 쓴 건은 already로 세고 나머지를 끝낸다.
const REJECTED_RE=/거부.*바뀌지 않았습니다/,MAYBE_RE=/바뀌었을 수도/;
for(const [kind,status,written,pattern] of [
 ['inuse',409,3,REJECTED_RE],
 ['409body',409,3,REJECTED_RE],
 ['500',500,3,/서버 오류.*바뀌었을 수도/],
 ['502after',502,4,/서버 오류.*바뀌었을 수도/],
 ['unlock',500,4,/서버 오류.*바뀌었을 수도/],
 ['lost',0,4,/응답을 받지 못해.*바뀌었을 수도/],
 ['truncated',200,4,/응답을 읽지 못해.*바뀌었을 수도/],
 ['shapeless',200,4,/응답을 읽지 못해.*바뀌었을 수도/],
]){
 restore(fresh);
 const res=await run('apply',{fail:4,kind});
 const failedId=res.summary.failed[0]?.id;
 check(`a ${kind} failure on the 4th update stops with ok false and the matching reason`,()=>assert.ok(res.summary.ok===false&&pattern.test(res.summary.reason||'')&&res.posts===4,res.returned));
 check(`a ${kind} failure reports the failed id with status ${status} only`,()=>assert.ok(res.summary.failed.length===1&&canonical(Object.keys(res.summary.failed[0]).sort())===canonical(['id','status'])&&res.summary.failed[0].status===status&&s7Ids.includes(failedId)));
 check(`a ${kind} failure reports 3 changed ids and 5 pending ids`,()=>assert.ok(res.summary.changed===3&&res.summary.changedIds.length===3&&res.summary.pendingIds.length===5&&res.summary.pendingIds[0]===failedId&&canonical([...res.summary.changedIds,...res.summary.pendingIds].sort())===canonical(s7Ids)));
 check(`a ${kind} failure leaves ${written} S7 rows written and S2 untouched`,()=>{const now=caseRows();assert.equal(changedIds(freshCases,now).length,written);assert.deepEqual(s2Rows(now),s2Rows(freshCases))});
 check(`a ${kind} failure: the reason matches D1 for the failed id (${written===4?'written':'not written'})`,()=>{const row=parsed(caseRows()).find(c=>c.id===failedId);assert.equal(canonical(row.expectations.industry),canonical(written===4?TO:FROM));assert.ok(written===4?MAYBE_RE.test(res.summary.reason):true)});
 if(kind==='409body')check('a rejected update does not echo the server error body or = ? & %',()=>assert.ok(!res.lines[0].includes('가상분식머신')&&!res.lines[0].includes('모의 거부')&&!/[=?&%]/.test(res.lines[0]),res.lines[0]));
 if(kind==='unlock'){
  // 잠금 행이 남는다. 곧바로 다시 실행하면 첫 쓰기가 실제 409(잠금 충돌)로 거부된다(쓰기 전). 잠금이 만료되면(2분) 끝난다.
  check('an unlock failure leaves the lock row behind',()=>assert.equal(sql.prepare('SELECT count(*) AS n FROM mutation_locks WHERE owner=?').get(owner).n,1));
  const before=caseRows(),blocked=await run('apply');
  check('an immediate rerun after an unlock failure stops at a real 409 lock conflict without writing',()=>{assert.ok(blocked.summary.ok===false&&REJECTED_RE.test(blocked.summary.reason||'')&&blocked.summary.failed[0].status===409&&blocked.posts===1&&blocked.summary.already===4&&blocked.summary.changed===0,blocked.returned);assert.deepEqual(caseRows(),before)});
  sql.prepare('UPDATE mutation_locks SET expires_at=0').run();
 }
 const again=await run('apply');
 check(`after a ${kind} failure a second apply completes the rest`,()=>assert.ok(again.summary.ok===true&&again.summary.changed===8-written&&again.summary.already===written&&again.summary.verified===8,again.returned));
 check(`after a ${kind} failure the final rows equal a clean apply`,()=>{const now=Object.fromEntries(parsed(caseRows()).map(c=>[c.id,c]));for(const id of s7Ids)assert.equal(JSON.stringify(now[id].expectations),JSON.stringify(appliedCases[id].expectations),id)});
}

// f-2) 응답 확인(모의 서버 이상): 갱신 응답의 업종 밖 키가 달라지거나 업종이 목표 값이 아니면 그 자리에서 멈춘다.
restore(fresh);
r=await run('apply',{fail:4,kind:'tamper'});
check('a response whose other expectations keys differ stops the loop at that case',()=>assert.ok(r.summary.ok===false&&/예상과 달라/.test(r.summary.reason||'')&&r.posts===4&&r.summary.changed===3&&r.summary.failed.length===1&&r.summary.failed[0].status===200,r.returned));
r=await run('apply');
check('after a tampered response a second apply finds the stored row correct and completes',()=>assert.ok(r.summary.ok===true&&r.summary.already===4&&r.summary.changed===4&&r.summary.verified===8,r.returned));
restore(fresh);
r=await run('apply',{fail:4,kind:'tamperIndustry'});
check('a response whose industry is not the target stops the loop at that case',()=>assert.ok(r.summary.ok===false&&/예상과 달라/.test(r.summary.reason||'')&&r.posts===4&&r.summary.changed===3&&r.summary.failed.length===1&&r.summary.failed[0].status===200,r.returned));

// f-3) 쓰기 직전 다시 읽기: 처음 읽은 뒤 그 케이스가 바뀌었으면(다른 탭·세션) 그 건은 쓰지 않고 멈춘다. 이미 쓴 건은 그대로다.
// 실제 동시 편집: 두 번째 건을 쓰기 직전에 소유자가 실제 update_case로 금지 표현을 하나 더한다. 스니펫이 처음 읽은 값으로 덮어쓰면 안 된다.
restore(fresh);
{
 const target=listOrder[1],extraTerm='동시 편집 금지어',terms=[...original[target].expectations.prohibitedTerms,extraTerm];
 const edit=async()=>{const b=await routePost({action:'update_case',id:target,expectations:{...original[target].expectations,prohibitedTerms:terms}});assert.equal(b.status,200,JSON.stringify(b.body))};
 r=await run('apply',{fx:{id:target,nth:2,before:edit}});
 const stored=()=>parsed(caseRows()).find(c=>c.id===target).expectations;
 check('a concurrent edit before the pre-write read stops without writing that case',()=>assert.ok(r.summary.ok===false&&/처음 읽은 뒤/.test(r.summary.reason||'')&&r.posts===1&&r.summary.changed===1&&r.summary.changedIds[0]===listOrder[0]&&r.summary.pendingIds[0]===target&&r.summary.failed.length===0,r.returned));
 check('the concurrent edit survives: the extra prohibited term stays and industry is still FROM',()=>assert.ok(canonical(stored().prohibitedTerms)===canonical(terms)&&canonical(stored().industry)===canonical(FROM)));
 r=await run('apply');
 check('a rerun after a concurrent edit completes and keeps the edited prohibited terms',()=>assert.ok(r.summary.ok===true&&r.summary.already===1&&r.summary.changed===7&&r.summary.verified===8&&canonical(stored().prohibitedTerms)===canonical(terms)&&canonical(stored().industry)===canonical(TO),r.returned));
}
// 모의: 쓰기 직전 읽기가 처음 읽기와 다르거나(업종이 이미 목표 값, 해시, 금지 표현) 읽히지 않는다.
for(const [name,effect,pattern] of [
 ['industry already at TO',{fn:b=>({...b,expectations:{...b.expectations,industry:TO}})},/처음 읽은 뒤/],
 ['a different specHash',{fn:b=>({...b,specHash:'0'.repeat(32)})},/처음 읽은 뒤/],
 ['emptied prohibited terms',{fn:b=>({...b,expectations:{...b.expectations,prohibitedTerms:[]}})},/처음 읽은 뒤/],
 ['HTTP 404',{status:404},/쓰기 직전.*HTTP 404/],
]){
 restore(fresh);
 const target=listOrder[2],res=await run('apply',{fx:{id:target,nth:2,...effect}});
 check(`a pre-write read with ${name} stops before writing that case`,()=>{assert.ok(res.summary.ok===false&&pattern.test(res.summary.reason||'')&&res.posts===2&&res.summary.changed===2&&res.summary.pendingIds[0]===target&&res.summary.failed.length===0,res.returned);assert.equal(parsed(caseRows()).find(c=>c.id===target).updatedAt,original[target].updatedAt)});
}

// f-4) 쓴 뒤 다시 읽기(모의 서버 이상): 네 번째 S7 케이스의 세 번째 읽기(쓴 뒤)만 한 필드를 바꿔 돌려준다. 어느 필드든 ok false, 7건 확인으로 끝난다.
const reread={
 request:b=>({...b,request:{...b.request,changedAfterWrite:true}}),
 externalKey:b=>({...b,externalKey:b.externalKey+'-x'}),
 specHash:b=>({...b,specHash:'0'.repeat(32)}),
 set:b=>({...b,set:'sealed'}),
 label:b=>({...b,label:b.label+' 바뀜'}),
 source:b=>({...b,source:'capture'}),
 generator:b=>({...b,generator:{...b.generator,tree:'e'.repeat(40)}}),
 campaignId:b=>({...b,campaignId:'other-campaign'}),
 'expectations.industry':b=>({...b,expectations:{...b.expectations,industry:FROM}}),
 'expectations.prohibitedTerms':b=>({...b,expectations:{...b.expectations,prohibitedTerms:[]}}),
};
check('every re-read field exists on the imported S7 case',()=>{for(const f of ['request','externalKey','specHash','set','label','source','generator','campaignId'])assert.ok(original[s7Ids[3]][f]!==undefined&&original[s7Ids[3]][f]!==null,f)});
for(const [field,fn] of Object.entries(reread)){
 restore(fresh);
 const res=await run('apply',{fx:{id:s7Ids[3],nth:3,fn}});
 check(`a re-read whose ${field} differs ends with ok false, 8 changed and 7 verified`,()=>assert.ok(res.summary.ok===false&&/다시 읽은/.test(res.summary.reason||'')&&res.summary.changed===8&&res.summary.verified===7,res.returned));
}
// 쓰기 0인 두 번째 apply도 다시 읽기가 어긋나면 ok false다(확인 기준은 8건 고정).
restore(afterApply);
r=await run('apply',{fx:{id:s7Ids[3],nth:2,fn:reread.specHash}});
check('a no-op apply whose re-read does not match ends with ok false, 0 changed and 7 verified',()=>assert.ok(r.summary.ok===false&&/다시 읽은/.test(r.summary.reason||'')&&r.summary.changed===0&&r.summary.verified===7&&quiet(r),r.returned));

// g) rollback: TO → FROM. 되돌린 기대 판정은 가져온 원본과 같다. 전제는 apply의 거울이다.
restore(afterApply);
r=await run('rollback');
const rolled=Object.fromEntries(parsed(caseRows()).map(c=>[c.id,c]));
check('rollback reports ok with 8 changed and 8 verified',()=>assert.ok(r.summary.mode==='rollback'&&r.summary.ok===true&&r.summary.changed===8&&r.summary.verified===8,r.returned));
check('rollback restores the original imported expectations exactly (bytes and canonical)',()=>{for(const id of s7Ids){assert.equal(JSON.stringify(rolled[id].expectations),JSON.stringify(original[id].expectations),id);assert.equal(canonical(rolled[id].expectations),canonical(original[id].expectations),id)}});
check('rollback keeps request, keys and hashes and leaves S2 byte-identical',()=>{for(const id of s7Ids)for(const f of ['request','specHash','externalKey','set','label','source','generator'])assert.equal(canonical(rolled[id][f]),canonical(original[id][f]),id+' '+f);assert.deepEqual(s2Rows(caseRows()),s2Rows(freshCases))});
restore(fresh);
r=await run('rollback');
check('rollback on the imported state changes 0, counts 8 already and writes nothing',()=>assert.ok(r.summary.ok===true&&r.summary.changed===0&&r.summary.already===8&&r.summary.verified===8&&quiet(r)&&JSON.stringify(caseRows())===JSON.stringify(freshCases),r.returned));
await aborts('rollback with an S7 case outside FROM and TO','rollback',async()=>{restore(afterApply);await setIndustry(s7Ids[6],['education'])},/기대 업종/);
await aborts('rollback with an S7 case whose industry is TO reordered','rollback',async()=>{restore(afterApply);await setIndustry(s7Ids[2],['fnb','franchise'])},/기대 업종/);
await aborts('rollback while a queued run uses an S7 case','rollback',async()=>{restore(afterApply);await addRun('queued',[s7Ids[7]])},/진행 중.*평가 실행/);

// h) 출력: 실행마다 요약 JSON 한 줄만 찍고 돌려준다. 케이스 내용·금지 표현·사실 값·스펙 문자열·= ? & %가 없다.
check('every run prints exactly one line and nothing through other console methods',()=>assert.ok(runs.every(x=>x.lines.length===1&&x.other.length===0)));
check('the printed line is the returned summary JSON',()=>assert.ok(runs.every(x=>x.lines[0]===x.returned)));
check('printed output has none of the characters = ? & %',()=>assert.ok(printed.every(line=>!/[=?&%]/.test(line)),printed.find(line=>/[=?&%]/.test(line))));
const leaves=v=>typeof v==='string'?[v]:Array.isArray(v)?v.flatMap(leaves):v&&typeof v==='object'?Object.values(v).flatMap(leaves):[];
const content7=[...new Set([...leaves(s7Spec.records),...s7.cases.flatMap(c=>[...leaves(c.request),...leaves(c.expectations),c.externalKey,c.specHash,c.label]),s7Spec.label,s7Spec.id,s7Spec.campaignId])].filter(t=>t.length>=4);
check('the content list is not empty and includes the brand name and the prohibited terms',()=>assert.ok(content7.length>50&&content7.includes('가상분식머신')&&s7Spec.expectations.prohibitedTerms.every(t=>content7.includes(t))));
check('printed output contains no S7 case content, spec strings, fact values or prohibited terms',()=>{const all=printed.join('\n');assert.equal(content7.find(t=>all.includes(t)),undefined)});
check('printed output never names an industry value',()=>assert.ok(printed.every(line=>!/fnb|franchise|education/.test(line))));
check('printed output never names the owner id or email (createdBy)',()=>assert.ok(printed.every(line=>!line.includes(owner)&&!line.includes(by.email)&&!line.includes('@'))));
check('every snippet request is same-origin, no-store and relative to /api/eval',()=>assert.ok(calls.every(c=>c.credentials==='same-origin'&&c.cache==='no-store'&&c.url.startsWith('/api/eval'))));
check('every snippet POST is JSON update_case',()=>assert.ok(calls.filter(c=>c.method==='POST').every(c=>c.contentType==='application/json'&&JSON.parse(c.body).action==='update_case')));

// i) 채점기 동등성(mocked, 오늘의 lib/graders): franchise 사전이 없어 ['fnb']와 ['franchise','fnb']의 판정이 같다.
// R3c가 franchise 사전을 더하면 첫 검사가 의도대로 실패한다. 그때 R3c PR이 이 절을 '두 목록의 판정이 갈린다'로 바꾼다(그래서 D1 갱신이 먼저다).
check('today there is no franchise dictionary in INDUSTRY_TERMS',()=>assert.ok(!Object.hasOwn(industry.INDUSTRY_TERMS,'franchise')));
const item=text=>({id:'t',kind:'role',role:'content',text});
const outputs=[
 '가맹 상담 신청자에게 정보공개서 제공 일정을 먼저 안내한다. 쇼룸에서는 떡볶이·어묵 대표 메뉴 시식을 한다.',
 '가맹 설명회 수강료는 받지 않는다. 예상 매출은 정보공개서 기준 범위로만 쓴다.',
 '예비 가맹점주에게 정보공개서 열람 뒤 대기 기간을 안내하고, 체험 수업처럼 쇼룸 견학을 운영한다.',
 '가맹 모집 지표는 상담 신청 수, 정보공개서 제공 수, 현장 실사 방문 비율이다. 메뉴판 원산지 표시는 가맹 계약 뒤 본사가 안내한다.',
 '창업 커뮤니티 글에는 가맹 문의 경로와 정보공개서 확인 절차만 적고, 수익 문구는 쓰지 않는다.',
];
const leakOf=(text,ind)=>content.industryMetricLeak.grade(item(text),{industry:ind});
check('industry_metric_leak gives identical verdicts for fnb and franchise+fnb on S7-like outputs',()=>{for(const t of outputs)assert.equal(JSON.stringify(leakOf(t,TO)),JSON.stringify(leakOf(t,FROM)),t)});
check('the equivalence sample is not vacuous: it has both pass and fail verdicts',()=>{const s=outputs.map(t=>leakOf(t,FROM).status);assert.ok(s.includes('pass')&&s.includes('fail'),s.join())});
check('the full grader set gives identical results for both industry lists',()=>{for(const t of outputs)assert.equal(JSON.stringify(graders.runGraders(item(t),{industry:TO,prohibitedTerms:s7Spec.expectations.prohibitedTerms,localStore:false})),JSON.stringify(graders.runGraders(item(t),{industry:FROM,prohibitedTerms:s7Spec.expectations.prohibitedTerms,localStore:false})),t)});

// j) 문서의 예상 출력 모양이 스니펫 출력과 같다(키 순서와 값 종류).
const examples=fenced(section('s7-output'),'json').map(x=>JSON.parse(x));
const shape=o=>Object.entries(o).map(([k,v])=>k+':'+(Array.isArray(v)?'array':v===null?'null':typeof v)).join(',');
const okApply=runs.find(x=>x.summary.mode==='apply'&&x.summary.ok&&x.summary.changed===8),stopped=runs.find(x=>x.summary.failed.length&&x.summary.failed[0].status===500);
check('the doc shows two output examples (success and stop)',()=>assert.equal(examples.length,2));
check('the success example has the same keys and value kinds as a real apply summary',()=>assert.equal(shape(examples[0]),shape(okApply.summary)));
check('the stop example has the same keys and value kinds as a real stop summary',()=>assert.equal(shape(examples[1]),shape(stopped.summary)));
check('the stop example reason is the reason a real 500 stop prints',()=>assert.equal(examples[1].reason,stopped.summary.reason));
check('the doc key table names every summary key',()=>{const table=section('s7-keys');for(const k of new Set([...Object.keys(okApply.summary),...Object.keys(stopped.summary)]))assert.ok(table.includes('`'+k+'`'),k)});
check('the doc examples carry no real case id and none of = ? & %',()=>{const text=JSON.stringify(examples);assert.ok(!s7Ids.some(id=>text.includes(id))&&!/[=?&%]/.test(text))});

check('no external network call',()=>assert.deepEqual(external,[]));
console.log(JSON.stringify({passed:passed.length}));
