// B5 맥락 정책 리플레이 라우트·로컬 스크립트 회귀(replay-api). 실제 SQLite(node:sqlite)·실제 라우트, 헤더(legacy)·세션(email) 인증, 합성 데이터. 외부 호출·모델 호출은 0이다(mocked: fetch 스텁).
// 권한(401·403), limit·kind·format 검증(400), 역할·회의·unknown 판별과 최근 N건, 응답·마크다운에 원문 조각 없음, owner 격리, 쓰기 없음, 마크다운 content-type·파일명,
// 스크립트 3모드(응답 JSON·로컬 D1 sqlite·잘못된 입력)와 네트워크·파일 쓰기 없음을 확인한다.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {testRuntime} from './helpers/runtime.mjs';

let fetchCalls=0;
const rt=testRuntime(async()=>{fetchCalls++;throw new Error('외부 호출 금지')});
const route=await rt.load('app/api/context-replay/route.ts'),rs=await rt.load('lib/context-replay-server.ts'),cr=await rt.load('lib/context-replay.ts');
let passed=0;const check=(name,ok)=>{assert.ok(ok,name);passed++};
const plain=value=>JSON.parse(JSON.stringify(value));

// 1) 합성 제출. 역할 입력은 저장된 캡처(buildRoleInput 결과)에 고유 문장을 넣어 쓰고, 회의 입력은 회의 맥락 모양(lib/meeting-execution.ts context)을 따른다.
const SECRET='리플레이누설검사고유문장칠큐',INSTR='지시문누설검사고유문장삼제트',KEY='collective-idem-누설';
const fixture=JSON.parse(readFileSync('tests/fixtures/role-submission-fc8eb5c.json','utf8')).cases;
const roleInput=name=>{const i=JSON.parse(fixture.find(c=>c.name===name).submission.input);return JSON.stringify({...i,campaign:{...i.campaign,goal:i.campaign.goal+' '+SECRET,draftMeta:{values:{goal:SECRET}}},previous:(i.previous||[]).map(p=>({...p,content:p.content+'\n\n## 추가 자료 요청\n'+SECRET}))})};
const artifact=(id,role)=>({ref:role+' v1',id,version:1,role,title:'작업물 '+id,content:`## 목표\n${SECRET}\n\n## 인계\n다음 담당에게 넘길 확인 사항`,excerpt:false});
const meetingInput=(phase,role)=>JSON.stringify({skillVersion:'sv1',channelPractice:[],agenda:'안건 '+SECRET,role,phase,allowedRespondsTo:[],brand:{id:'oda',name:'ODA Pizza',description:SECRET},
 evidence:{facts:{confirmed:[{key:'주소',value:SECRET,source:'합성 원장'}],prohibited:[],candidate:[]},directives:[]},
 brandArchive:{revision:1,observations:[],omittedObservations:0,confirmedSources:[{ref:'브랜드 자료 #1',id:'source-a',title:'합성 자료',category:'product',content:SECRET,excerpt:false,version:1}],omittedSources:0,confirmedDiagnosis:null,notice:'n'},
 campaign:{id:'c1',title:'합성 캠페인',goal:SECRET,status:'review',version:1,createdAt:'2026-09-01T00:00:00.000Z',updatedAt:'2026-09-01T00:00:00.000Z',draftMeta:{values:{goal:SECRET}}},trialLearning:[],recordedMetrics:[],
 originalArtifacts:[artifact('a1','strategy'),artifact('a2','content')],discussion:phase==='discussion'?[]:[{ref:'전략 의견',role:'strategy',summary:SECRET,respondsTo:[]}],task:phase==='revision'?{role,focus:SECRET}:undefined,
 ...(phase==='quality'?{candidateArtifacts:[artifact('a1','strategy')],invalidatedRoles:[]}:{})});
const body=(input,instructions=INSTR+' 지시')=>JSON.stringify({instructions,input,session_id:KEY,conversation_history:[]});
const O='cr-owner',X='cr-other',hash=c=>c.repeat(64);
let tick=Date.parse('2026-09-20T00:00:00Z');const at=()=>new Date(tick+=60000).toISOString();
const put=(owner,kind,id,data,parent='',updated=at())=>rt.sql.prepare('INSERT INTO records(id,owner,kind,parent_id,data,updated_at) VALUES(?,?,?,?,?,?)').run(`${owner}:${kind}:${id}`,owner,kind,parent,JSON.stringify(data),updated);
const submit=(owner,id,parent,stored)=>put(owner,'hermes_submission',id,{key:KEY,body:stored},parent);
const job=(owner,id,campaign,role)=>rt.sql.prepare('INSERT INTO jobs(id,owner,campaign_id,role,status,provider_id,model,campaign_version,created_at,updated_at,tokens) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(id,owner,campaign,role,'completed','run-'+role,'HERMES',1,at(),at(),0);
put(O,'campaign','c1',{id:'c1',brandId:'oda',title:'합성',goal:SECRET,version:1,status:'review'});
put(O,'brand','oda',{id:'oda',name:'ODA Pizza'});
put(X,'campaign','c9',{id:'c9',brandId:'oda',title:'남의 캠페인',goal:'x',version:1,status:'review'});
put(O,'team_meeting','m1',{id:'m1',campaignId:'c1',status:'completed',steps:[]},'c1');
put(X,'team_meeting','mx',{id:'mx',campaignId:'c9',status:'completed',steps:[]},'c9');
put(X,'team_meeting','m1',{id:'m1',campaignId:'c9',status:'completed',steps:[]},'c9');
// 오래된 순서로 넣는다(updated_at이 1분씩 늘어난다). 기대 순서는 최신순이다.
const roleStrategy=`${O}:c1:1:strategy:${hash('a')}`,roleQuality=`${O}:c1:1:quality:${hash('b')}`;
job(O,roleStrategy,'c1','strategy');job(O,roleQuality,'c1','quality');
submit(O,roleStrategy,'c1',body(roleInput('strategy')));
submit(O,'m1:discussion:strategy','c1',body(meetingInput('discussion','strategy')));
submit(O,'brief-b1','',body(JSON.stringify({brand:{},currentBrief:{goal:SECRET}})));
submit(O,'research-step-1','oda',body(JSON.stringify({brand:{},query:SECRET})));
submit(O,'m1:quality','c1',body(meetingInput('quality','quality')));
submit(O,'mx:discussion:cmo','c1',body(meetingInput('discussion','cmo')));
submit(O,'orphan-1','c1','손상된 본문 '+SECRET);
submit(O,'m1:revision:content:retry:1','c1',body(meetingInput('revision','content')));
submit(O,roleQuality,'c1',body(roleInput('quality')));
submit(X,`${X}:c9:1:cmo:${hash('c')}`,'c9',body(roleInput('cmo')));job(X,`${X}:c9:1:cmo:${hash('c')}`,'c9','cmo');
submit(X,'mx:synthesis','c9',body(meetingInput('synthesis','cmo')));
// 기대값: 최신순, 캠페인을 부모로 둔 제출만, 브리프·조사 제외. mx는 다른 소유자의 회의라 이 소유자에게는 unknown이다. 손상 본문은 unreadable로 센다.
const expected=[
 {kind:'role',role:'quality',stage:null,input:roleInput('quality')},
 {kind:'meeting',role:'content',stage:'revision',input:meetingInput('revision','content')},
 {kind:'unknown',role:null,stage:null,input:meetingInput('discussion','cmo')},
 {kind:'meeting',role:null,stage:'quality',input:meetingInput('quality','quality')},
 {kind:'meeting',role:'strategy',stage:'discussion',input:meetingInput('discussion','strategy')},
 {kind:'role',role:'strategy',stage:null,input:roleInput('strategy')},
];
// 비교에 넘기는 값(lib/context-policies.ts ReplaySubmission): 판별한 역할·회의만, 아는 역할·단계만 메타로 싣는다. unknown은 비교에서 빼고 수만 센다.
const toReplay=list=>list.filter(s=>s.kind!=='unknown').map(s=>({kind:s.kind,input:s.input,...(s.role?{role:s.role}:{}),...(s.stage?{stage:s.stage}:{})}));
const norm=text=>text.replace(/^- 생성: .*\n/m,'');

// 2) 판별(순수)과 조회
check('a jobs row makes a role submission',JSON.stringify(plain(rs.classifySubmission('any',"cmo",false)))==='{"kind":"role","role":"cmo","stage":null}');
check('meeting step ids give stage and role',JSON.stringify(plain(rs.classifySubmission('m1:revision:growth:retry:2',null,true)))==='{"kind":"meeting","role":"growth","stage":"revision"}'&&plain(rs.classifySubmission('m1:synthesis:retry:1',null,true)).stage==='synthesis');
check('a step id without its meeting record or with a foreign shape is unknown',plain(rs.classifySubmission('m1:discussion:cmo',null,false)).kind==='unknown'&&plain(rs.classifySubmission('m1:unknown',null,true)).kind==='unknown'&&plain(rs.classifySubmission('a:b:discussion',null,true)).kind==='unknown');
const q=(query='')=>rs.replayQuery(new URLSearchParams(query));
check('default query is the latest 50 of all kinds',JSON.stringify(plain(q()))==='{"limit":50,"kind":"all"}'&&plain(q('limit=200&kind=meeting')).limit===200);
const bad=fn=>{try{fn();return false}catch(e){return e.status===400}};
check('limit must be an integer from 1 to 200 and kind role|meeting|all',['limit=0','limit=201','limit=abc','limit=1.5','limit=-1','limit=1e2','limit=0050','kind=brief','kind=ROLE'].every(x=>bad(()=>q(x))));
const read=plain(await rs.readReplaySubmissions(O,q()));
const meta=s=>({kind:s.kind,role:s.role,stage:s.stage});
check('reads the latest campaign submissions newest first with kinds',JSON.stringify(read.submissions.map(meta))===JSON.stringify(expected.map(meta)));
check('passes the stored input unchanged',read.submissions.every((s,i)=>s.input===expected[i].input));
const savedAt=id=>rt.sql.prepare('SELECT updated_at FROM records WHERE id=?').get(`${O}:hermes_submission:${id}`).updated_at;
check('counts role, meeting, unknown and unreadable submissions and their saved time span',JSON.stringify(read.counts)===JSON.stringify({submissions:7,role:2,meeting:3,unknown:1,unreadable:1,overBudget:0,from:savedAt(roleStrategy),to:savedAt(roleQuality)}));
// 총 문자 예산: 최신순으로 input 길이를 누적해 예산을 넘는 제출부터는 본문을 옮기지 않고 overBudget으로 센다(Workers 메모리 보호).
check('the total input budget is 8,000,000 characters',rs.MAX_TOTAL_CHARS===8000000);
const readable=expected.map(s=>s.input.length),budget=readable[0]+readable[1];
const small=plain(await rs.readReplaySubmissions(O,q(),budget));
check('a small budget keeps the newest inputs and counts the rest as over budget',JSON.stringify(small.submissions.map(meta))===JSON.stringify(expected.slice(0,2).map(meta))&&small.submissions.every((s,i)=>s.input===expected[i].input)&&JSON.stringify(small.counts)===JSON.stringify({submissions:7,role:1,meeting:1,unknown:0,unreadable:1,overBudget:4,from:savedAt(roleStrategy),to:savedAt(roleQuality)}));
check('a budget of exactly the newest input keeps only that input',plain(await rs.readReplaySubmissions(O,q(),readable[0])).counts.overBudget===5);
check('kind filters use the same classification',plain(await rs.readReplaySubmissions(O,q('kind=role'))).submissions.map(s=>s.role).join()==='quality,strategy'&&plain(await rs.readReplaySubmissions(O,q('kind=meeting'))).submissions.map(s=>s.stage).join()==='revision,quality,discussion');
check('limit keeps the most recent submissions',JSON.stringify(plain(await rs.readReplaySubmissions(O,q('limit=2'))).submissions.map(s=>s.kind))==='["role","meeting"]');

// 3) 라우트(legacy 헤더): 응답 모양, 순수 replay와 같은 통계, 원문 없음, owner 격리, 쓰기 없음
const get=(query,headers)=>route.GET(new Request('https://agency.test/api/context-replay'+query,{headers}));
const as=who=>({'oai-authenticated-user-id':who});
const before=()=>JSON.stringify([rt.sql.prepare('SELECT COUNT(*) n,MAX(updated_at) m FROM records').get(),rt.sql.prepare('SELECT COUNT(*) n,MAX(updated_at) m FROM jobs').get(),rt.sql.prepare('SELECT COUNT(*) n FROM mutation_locks').get()]);
const snapshot=before();
let r=await get('',as(O)),json=await r.json();
check('owner gets the replay JSON',r.status===200&&r.headers.get('cache-control')==='no-store'&&['generatedAt','filter','read','replay','notice'].every(k=>k in json)&&!Number.isNaN(Date.parse(json.generatedAt)));
check('filter and read counts are reported',JSON.stringify(json.filter)==='{"limit":50,"kind":"all"}'&&json.read.submissions===7&&json.read.role===2&&json.read.meeting===3);
check('replay equals the pure replay over the classified stored inputs',JSON.stringify(json.replay)===JSON.stringify(plain(cr.replay(toReplay(expected)))));
check('unknown submissions are left out of the comparison',json.replay.total===5&&json.replay.skipped===0);
check('notice says no model call and not_run evaluation',/모델 호출 없이/.test(json.notice)&&/not_run/.test(json.notice));
const leaks=text=>[SECRET,INSTR,KEY,hash('a'),hash('b'),'orphan-1','손상된 본문','research-step','brief-b1','m1:discussion'].filter(s=>text.includes(s));
check('response carries no input, instructions, key or submission id text',leaks(JSON.stringify(json)).length===0);
r=await get('?format=markdown',as(O));const md=await r.text();
const today=new Date(Date.now()+9*3600000).toISOString().slice(0,10);
check('markdown is an attachment named by the KST date',r.status===200&&r.headers.get('content-type')==='text/markdown; charset=utf-8'&&r.headers.get('content-disposition')===`attachment; filename="collective-context-replay-${today}.md"`&&r.headers.get('cache-control')==='no-store');
const mdAt=(/^- 생성: (.*)$/m.exec(md)||[])[1];
check('markdown is the comparison table of the replay plus the read scope',md===cr.comparisonMarkdown(json.replay,{generatedAt:mdAt})+'\n## 조회 범위\n\n- 최근 제출 50건 이내 · 종류 역할·회의 · 캠페인을 부모로 둔 HERMES 제출만 읽었다(브리프·조사·학습 제출 제외).\n'+`- 제출 저장 시각(UTC): ${savedAt(roleStrategy)} ~ ${savedAt(roleQuality)}\n`+'- 읽은 제출 7건: 역할 2 · 회의 3 · 판별하지 못함 1 · 본문을 읽을 수 없음 1 · 문자 예산 초과 0. 판별하지 못한 제출, 읽을 수 없는 본문, 문자 예산(최신순 누적 input 8,000,000자)을 넘은 제출은 비교에서 뺐다.\n');
check('markdown equals the composer over the JSON payload',norm(md)===norm(rs.replayMarkdown(json)));
check('markdown carries no input, instructions, key or submission id text',leaks(md).length===0);
r=await get('?kind=role&limit=1',as(O));json=await r.json();
check('kind and limit reach the replay',r.status===200&&json.read.submissions===1&&json.read.role===1&&JSON.stringify(json.replay)===JSON.stringify(plain(cr.replay(toReplay(expected.slice(0,1))))));
r=await get('',as(X));json=await r.json();
check('another owner sees only their own submissions and meetings',r.status===200&&json.read.submissions===2&&json.read.role===1&&json.read.meeting===1&&json.read.unknown===0);
check('another owner response has no text of this owner',leaks(JSON.stringify(json)).length===0);
r=await get('',as('cr-empty'));json=await r.json();
check('an owner without submissions gets an empty replay',r.status===200&&json.read.submissions===0&&json.read.from===null&&json.read.to===null&&JSON.stringify(json.replay)===JSON.stringify(plain(cr.replay([]))));
for(const x of ['?limit=0','?limit=201','?limit=ten','?kind=brief','?format=csv','?format=markdown&limit=999'])check('invalid query is a 400: '+x,(await get(x,as(O))).status===400);
check('limit 200 is accepted',(await get('?limit=200',as(O))).status===200);
const binds=[];const prepare=rt.env.DB.prepare;rt.env.DB.prepare=query=>{const s=prepare(query),bind=s.bind.bind(s);s.bind=(...v)=>{binds.push(v.length);return bind(...v)};return s};
await get('?kind=meeting',as(O));await get('?format=markdown',as(O));rt.env.DB.prepare=prepare;
check('every query binds a small fixed number of values',binds.length>0&&Math.max(...binds)<=5);
// 조회 SQL은 본문(instructions 포함) 전체가 아니라 input만 옮긴다. 손상된 data·본문·input 형식은 쿼리 실패 없이 읽을 수 없음으로 센다.
const sqlSeen=[];rt.env.DB.prepare=query=>{sqlSeen.push(query);return prepare(query)};await rs.readReplaySubmissions(O,q());rt.env.DB.prepare=prepare;
check('the read query extracts the input only',sqlSeen.length===1&&/json_extract\(json_extract\(b\.data,'\$\.body'\),'\$\.input'\)/.test(sqlSeen[0])&&!/json_extract\(b\.data,'\$\.body'\) AS body/.test(sqlSeen[0])&&/json_valid\(b\.data\)/.test(sqlSeen[0]));
check('reading the replay writes nothing and takes no lock',before()===snapshot);
check('the route is GET only',!('POST' in route)&&!('PUT' in route)&&!('DELETE' in route)&&!('PATCH' in route));
// 큰 제출: 3,000,000자 input 3건(최신순 누적 9,000,000자 > 예산). 가장 오래된 1건은 본문을 옮기지 않고 overBudget으로 센다. 형식이 다른 본문도 쿼리를 깨지 않는다.
const B='cr-big',huge=n=>JSON.stringify({task:{role:'cmo'},campaign:{goal:'x'.repeat(n)}});
put(B,'campaign','cb',{id:'cb',brandId:'oda',title:'큰 합성',goal:'x',version:1,status:'review'});
for(const i of [1,2,3]){const id=`${B}:cb:1:cmo:${hash(String(i))}`;job(B,id,'cb','cmo');submit(B,id,'cb',body(huge(3000000)))}
submit(B,'bad-object','cb',{instructions:'i',input:'객체 본문'});submit(B,'bad-number','cb',body(5));
rt.sql.prepare('INSERT INTO records(id,owner,kind,parent_id,data,updated_at) VALUES(?,?,?,?,?,?)').run(`${B}:hermes_submission:bad-data`,B,'hermes_submission','cb','{손상된 data',at());
r=await get('',as(B));json=await r.json();
check('a heavy workspace still gets a 200 with the over-budget count',r.status===200&&JSON.stringify([json.read.submissions,json.read.role,json.read.unreadable,json.read.overBudget])==='[6,2,3,1]'&&json.replay.total===2);
r=await get('?format=markdown',as(B));
check('the markdown read scope reports the over-budget submissions',r.status===200&&(await r.text()).includes('· 문자 예산 초과 1.'));

// 4) 이메일 인증: 소유자·관리자 200, 직원 403, 비로그인 401
Object.assign(rt.env,{AUTH_MODE:'email',AUTH_ORIGIN:'https://agency.test'});
const sha=v=>createHash('sha256').update(v).digest('hex');
const signIn=(id,role,createdAt,ws)=>{const token=sha(id);rt.sql.prepare('INSERT INTO auth_users(id,email,workspace_owner,role,status,created_at) VALUES(?,?,?,?,?,?)').run(id,id+'@test.invalid',ws,role,'active',createdAt);rt.sql.prepare('INSERT INTO auth_sessions VALUES(?,?,?,?)').run(sha(token),id,Date.now()+60000,Date.now());return {cookie:'__Host-collective_session='+token}};
const ownerS=signIn('cr-first','admin',1000,O),adminS=signIn('cr-admin','admin',2000,O),memberS=signIn('cr-member','member',500,O),strangerS=signIn('cr-stranger','admin',1000,X);
const [anon,anonMd,owner,admin,member,memberMd,memberBad,stranger]=await Promise.all([get('',{}),get('?format=markdown',{}),get('',ownerS),get('',adminS),get('',memberS),get('?format=markdown',memberS),get('?limit=0',memberS),get('',strangerS)]);
check('unauthenticated is a 401 for JSON and markdown',anon.status===401&&anonMd.status===401);
check('workspace owner and admin read the replay',owner.status===200&&admin.status===200&&(await owner.json()).read.submissions===7);
check('member is a 403 for JSON, markdown and even invalid queries',member.status===403&&memberMd.status===403&&memberBad.status===403&&/소유자·관리자/.test((await member.json()).error));
check('another workspace admin reads only their own workspace',stranger.status===200&&(await stranger.json()).read.submissions===2);
Object.assign(rt.env,{AUTH_MODE:'legacy'});

// 5) 로컬 스크립트: 응답 JSON·로컬 D1 sqlite → 같은 비교표, 잘못된 입력 종료 코드 2, 네트워크·파일 쓰기 없음
const script='scripts/eval/context-replay.mjs',run=(...args)=>spawnSync(process.execPath,[script,...args],{encoding:'utf8',timeout:60000});
const dir=mkdtempSync(join(tmpdir(),'context-replay-route-'));
try{
 const full=await (await get('',as(O))).json(),apiMd=await (await get('?format=markdown',as(O))).text();
 const file=join(dir,'replay.json');writeFileSync(file,JSON.stringify(full));
 let out=run(file);
 check('script prints the markdown of the saved response JSON',out.status===0&&out.stdout===rs.replayMarkdown(full)&&norm(out.stdout)===norm(apiMd));
 const d1=join(dir,'local-d1.sqlite');rt.sql.exec(`VACUUM INTO '${d1.replace(/'/g,"''")}'`);
 out=run('--sqlite',d1,'--owner',O);
 check('script prints the API markdown from the local D1 file',out.status===0&&norm(out.stdout)===norm(apiMd)&&/^- 생성: /m.test(out.stdout));
 const roleMd=await (await get('?format=markdown&kind=role&limit=1',as(O))).text();out=run('--sqlite',d1,'--owner',O,'--kind','role','--limit','1');
 check('script applies --kind and --limit like the API',out.status===0&&norm(out.stdout)===norm(roleMd));
 check('script output carries no input text',leaks(run('--sqlite',d1,'--owner',O).stdout).length===0);
 out=run('--sqlite',d1);
 check('several workspaces in the local D1 need --owner',out.status===2&&out.stderr.includes('--owner')&&out.stdout==='');
 const badJson=join(dir,'bad.json'),noReplay=join(dir,'no-replay.json'),noRead=join(dir,'no-read.json'),badFilter=join(dir,'bad-filter.json');writeFileSync(badJson,'{not json');writeFileSync(noReplay,JSON.stringify({error:'x'}));
 writeFileSync(noRead,JSON.stringify({...full,read:{...full.read,unknown:'1'}}));writeFileSync(badFilter,JSON.stringify({...full,filter:{limit:999,kind:'all'}}));const badTime=join(dir,'bad-time.json');writeFileSync(badTime,JSON.stringify({...full,read:{...full.read,from:'어제'}}));
 const invalid=[[],[join(dir,'missing.json')],[badJson],[noReplay],[noRead],[badFilter],[badTime],[file,file],['--sqlite',join(dir,'missing.sqlite')],['--sqlite',d1,'--owner',O,'--limit','0'],['--sqlite',d1,'--owner',O,'--kind','brief'],['--sqlite'],['--bogus',file],[file,'--limit','5'],['--sqlite',d1,file]];
 const codes=invalid.map(a=>run(...a));
 check('invalid arguments and inputs exit 2 with no output',codes.every(o=>o.status===2&&o.stdout===''&&o.stderr.length>0));
}finally{rmSync(dir,{recursive:true,force:true})}
const source=readFileSync(script,'utf8');
check('script imports no network module and writes no file',!/node:(http|https|net|tls|dgram|dns|http2)|['"](http|https|net|tls)['"]|writeFile|appendFile|createWriteStream|fetch\(/.test(source)&&/globalThis\.fetch=\(\)=>\{throw/.test(source)&&/readOnly:true/.test(source));
check('no external call was made',fetchCalls===0);
console.log(JSON.stringify({passed}));
