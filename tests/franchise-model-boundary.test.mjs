// 트랙 R 모델 입력 경계(DP-10): 가맹 리드 모듈은 HERMES·OpenAI 제출 경로에서 직간접으로 import되지 않고, 합성 리드를 심은 워크스페이스에서 역할·회의를 실행해도
// 제출 본문·제출 원문 행·콘솔에 리드 유래 문자열(이름·전화·이메일·메모·지역 토큰·시스템 코드·리드 id)이 0건이다.
// 근거: 검사 1(정적 import 그래프, 고정 8개 루트 + fetch·hermes를 쓰는 lib 모듈 전부) passed · 정적, 검사 2(모의 HERMES로 역할·회의 실행) passed · mocked.
// 브리프·조사·학습·평가 경로는 검사 1(정적)로만 확인한다(모의 실행 not_run: 이 스위트 범위 밖).
import assert from 'node:assert/strict';
import {readFileSync,readdirSync,existsSync,statSync} from 'node:fs';
import {join,resolve,dirname,relative} from 'node:path';
import {testRuntime} from './helpers/runtime.mjs';
import {seed,mockHermes,runRole,runMeeting,roleCampaign,meetingCampaign,brand} from './helpers/prompt-seed.mjs';
import {captureConsole,NAME,PHONE,PHONE_DIGITS,EMAIL,MEMO} from './helpers/franchise-fixture.mjs';

const passed=[];const check=(name,val)=>{assert.ok(val,name);passed.push(name)};
const ROOT=process.cwd();

// ── 1) 정적 import 그래프 ──
function specifiers(src){
 const out=new Set();
 for(const m of src.matchAll(/\b(?:import|export)\s+(?:type\s+)?(?:[^'";]*?\sfrom\s*)?['"]([^'"]+)['"]/g))out.add(m[1]);
 for(const m of src.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g))out.add(m[1]);
 return [...out];
}
function resolveSpec(from,spec){
 let base;
 if(spec.startsWith('@/'))base=join(ROOT,spec.slice(2));
 else if(spec.startsWith('.'))base=resolve(dirname(join(ROOT,from)),spec);
 else return null;
 for(const c of [base,base+'.ts',base+'.tsx',join(base,'index.ts'),join(base,'index.tsx')])if(existsSync(c)&&statSync(c).isFile())return relative(ROOT,c);
 return null;
}
// 루트에서 금지 파일까지 닿는 경로를 찾는다(BFS). 결과는 [루트, 금지 파일, 경로].
function reachable(graph,roots,forbidden){
 const found=[];
 for(const root of roots){
  const prev=new Map([[root,null]]),queue=[root];
  while(queue.length){const at=queue.shift();for(const next of graph.get(at)||[])if(!prev.has(next)){prev.set(next,at);queue.push(next)}}
  for(const bad of forbidden)if(prev.has(bad)){const path=[];for(let x=bad;x;x=prev.get(x))path.unshift(x);found.push([root,bad,path.join(' -> ')])}
 }
 return found;
}
const walk=d=>readdirSync(d,{withFileTypes:true}).flatMap(e=>{const p=join(d,e.name);return e.isDirectory()?(e.name==='node_modules'?[]:walk(p)):/\.tsx?$/.test(e.name)&&!e.name.endsWith('.d.ts')?[p]:[]});
const files=['app','lib','server'].filter(d=>existsSync(d)).flatMap(walk);
const graph=new Map(files.map(file=>[file,specifiers(readFileSync(file,'utf8')).map(s=>resolveSpec(file,s)).filter(Boolean)]));
const FIXED=['lib/role-execution.ts','lib/meeting-execution.ts','lib/brief-execution.ts','lib/research-execution.ts','lib/learning-execution.ts','lib/eval-server.ts','lib/ai-context.ts','lib/role-instruction.ts'];
check('the eight fixed model-path roots exist',FIXED.every(f=>existsSync(f)));
const dynamicRoots=files.filter(f=>f.startsWith('lib/')&&f!=='lib/client.ts'&&/\.ts$/.test(f)&&(/\bfetch\s*\(/.test(readFileSync(f,'utf8'))||specifiers(readFileSync(f,'utf8')).some(s=>s==='./hermes'||s==='@/lib/hermes'||s==='../hermes')));
check('dynamic roots cover the HERMES client and the connectors',['lib/hermes.ts','lib/execution.ts','lib/prompt-registry.ts'].every(f=>dynamicRoots.includes(f))&&dynamicRoots.some(f=>f.startsWith('lib/connectors/')));
const FORBIDDEN=['lib/franchise.ts','lib/franchise-server.ts','lib/franchise-crypto.ts','app/api/franchise/route.ts','app/franchise-panel.tsx','app/franchise-lead-detail.tsx','app/franchise-settings.tsx'];
const roots=[...new Set([...FIXED,...dynamicRoots])],hits=reachable(graph,roots,FORBIDDEN);
assert.deepEqual(hits,[],'모델 경로가 가맹 리드 모듈에 닿습니다: '+hits.map(h=>h[2]).join(' | '));passed.push(`no model-path root (${roots.length}) reaches a franchise lead module`);
check('the franchise modules are in the graph',['lib/franchise.ts','lib/franchise-server.ts','lib/franchise-crypto.ts','app/api/franchise/route.ts'].every(f=>graph.has(f))&&graph.get('app/api/franchise/route.ts').includes('lib/franchise-server.ts'));
// ── 2) 검사기 자체 확인 ──
const synthetic=new Map([['r.ts',['a.ts']],['a.ts',['b.ts']],['b.ts',['f.ts']],['c.ts',[]]]);
check('checker reports a transitive path to a forbidden file',JSON.stringify(reachable(synthetic,['r.ts'],['f.ts']))==='[["r.ts","f.ts","r.ts -> a.ts -> b.ts -> f.ts"]]'&&reachable(synthetic,['c.ts'],['f.ts']).length===0);
check('type-only, re-export, side-effect and dynamic imports are edges',JSON.stringify(specifiers("import type {X} from './f';\nexport {y} from '@/lib/g';\nimport './h';\nconst m=await import('./i');\nimport {\n a,\n b\n} from './j';"))==='["./f","@/lib/g","./h","./j","./i"]');
check('specifier resolution maps @/ and relative paths to files',resolveSpec('lib/role-execution.ts','./server')==='lib/server.ts'&&resolveSpec('app/api/franchise/route.ts','@/lib/franchise-server')==='lib/franchise-server.ts');
// ── 3) 가맹 모듈 자체 ──
const own=[...readdirSync('lib').filter(x=>/^franchise.*\.ts$/.test(x)&&!['franchise-rules.ts','franchise-gates.ts'].includes(x)).map(x=>'lib/'+x),'app/api/franchise/route.ts'];
check('franchise lib modules and the route make no fetch call',own.every(f=>!/\bfetch\s*\(/.test(readFileSync(f,'utf8'))));
const panels=readdirSync('app').filter(x=>/^franchise.*\.tsx$/.test(x)).map(x=>'app/'+x);
check('franchise screens fetch only their own API',panels.every(f=>[...readFileSync(f,'utf8').matchAll(/\bfetch\s*\(\s*([^,)]*)/g)].every(m=>/^[`'"]\/api\/franchise/.test(m[1].trim()))));
const MODEL=/(?:^|\/)(?:hermes|role-execution|meeting-execution|brief-execution|research-execution|learning-execution|eval-server|ai-context)$|^openai/;
check('no franchise module imports a model path or the OpenAI SDK',[...own,...panels].every(f=>specifiers(readFileSync(f,'utf8')).every(s=>!MODEL.test(s))));

// ── 4) 모의 HERMES 실행 ──
const logged=captureConsole(),posted=[];
const hermes=mockHermes(async(url,options)=>{if(url.endsWith('/v1/runs'))posted.push(String(options.body))});
const {sql,load}=testRuntime(hermes.fetch);
const server=await load('lib/server.ts'),execution=await load('lib/role-execution.ts'),meeting=await load('lib/meeting-execution.ts'),route=await load('app/api/franchise/route.ts'),flags=await load('lib/feature-flags.ts');
const owner='fb-owner',H={'oai-authenticated-user-id':owner};
await seed(server,sql,owner);
await flags.setFeatureFlag(owner,{flag:'r_franchise',enabled:true},{id:owner,email:null});
let n=0;
const post=async input=>{const res=await route.POST(new Request('https://agency.test/api/franchise',{method:'POST',headers:{'content-type':'application/json',...H},body:JSON.stringify({requestId:'fb-request-'+(++n),...input})}));return {status:res.status,body:await res.json()}};
check('synthetic workspace saves a branch A profile',(await post({action:'save_profile',brandId:brand.id,version:0,profile:{branch:'A',forecastInputs:{sme:true,storesAtFyEnd:3}}})).status===200);
const TOKEN='가상구역토큰',leads=[];
for(const [name,phone,email] of [[NAME,PHONE,EMAIL],['이테스트','010-0000-0120','lead.two@example.com']]){
 const r=await post({action:'create_lead',brandId:brand.id,contact:{name,phone,email},memo:MEMO,task:{region:TOKEN,budgetBand:'lt_50m',timingBand:'within_3m',sourceChannel:'expo'},basis:{type:'inquiry_response'}});
 assert.equal(r.status,200,JSON.stringify(r.body));leads.push(r.body.result);
}
check('two synthetic leads with contacts are stored',leads.length===2);
const role=await runRole(execution,server,owner,roleCampaign,'cmo');
const met=await runMeeting(meeting,server,owner,meetingCampaign,'fb-meeting');
check('role and meeting runs completed on the mock',role.status==='completed'&&met.meeting.status==='completed'&&posted.length>1);
const leadStrings=[NAME,PHONE,PHONE_DIGITS,EMAIL,'이테스트','010-0000-0120','01000000120','lead.two@example.com',MEMO,TOKEN,...leads.flatMap(l=>[l.systemCode,l.leadId])];
const submissions=sql.prepare("SELECT data FROM records WHERE kind='hermes_submission'").all().map(r=>r.data);
const leak=(texts,where)=>{const found=leadStrings.filter(s=>texts.some(t=>String(t).includes(s)));assert.deepEqual(found,[],`${where}에 리드 유래 문자열이 있습니다`)};
leak(posted,'HERMES 제출 본문');passed.push('no posted HERMES body contains a lead-derived string');
leak([...hermes.bodies.values()],'모의 HERMES 수신 본문');passed.push('no mock HERMES received body contains a lead-derived string');
leak(submissions,'hermes_submission 행');check('hermes_submission rows hold no lead-derived string',submissions.length>0);
leak(logged,'콘솔');passed.push('console output holds no lead-derived string');
check('no call left the mock host',hermes.external.length===0);

console.log(JSON.stringify({passed:passed.length}));
