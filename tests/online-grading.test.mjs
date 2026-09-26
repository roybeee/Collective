// 비차단 온라인 채점(F2b): 스위치 꺼짐 0회, 켜짐이면 역할·회의 작업물 저장 직후 grading 기록, 채점 예외 격리, 조회 API·화면 연결, kind 등록.
// 근거: mocked(모의 HERMES fetch 스텁, 메모리 SQLite, 로컬 인증 헤더, 합성 브랜드·캠페인). 외부 네트워크 호출은 0회다.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {testRuntime} from './helpers/runtime.mjs';
import {roleFixture} from './helpers/role-fixture.mjs';

const HERMES='https://hermes.example.com';
// 회의 단계 모의 응답(tests/meetings.test.mjs와 같은 형식의 합성 문장).
function answer(x){
 if(x.phase==='discussion')return JSON.stringify({position:'실제 브리프를 검토했습니다. 평일 오후 고객은 가격보다 제품 단면과 구매 이유를 먼저 확인한다는 가설이 가장 중요합니다.',evidence:'주어진 브리프만 사용했고 고객 반응은 미측정입니다. 가격과 판매 메뉴는 [자료 필요]이며 매장 담당자가 확인합니다.',challenge:'앞선 제안의 공유 동기와 검증 기준을 보완해야 합니다. 확인되지 않은 인기 표현은 사용하지 않습니다.',proposal:'제품 단면을 먼저 보여주는 첫 장면과 기존 컷을 2주간 공유율로 대조하고, 콘텐츠 담당에게 대조안 두 개를 요청합니다.',respondsTo:x.allowedRespondsTo.length?[x.allowedRespondsTo.at(-1).ref]:[]});
 if(x.phase==='synthesis')return JSON.stringify({decisions:'공유 동기를 드러내는 콘텐츠 실험',disagreements:'기준 없는 할인 제안 보류',questions:'실제 제품 가격 확인',tasks:[{role:'growth',instruction:'배포 설계 개선',reason:'콘텐츠와 측정 연결',acceptance:'배포 조건 명시'},{role:'content',instruction:'완성된 카피와 대본 개선',reason:'첫 장면 반론 반영',acceptance:'대조안과 한 변수 구분'}]});
 if(x.phase==='revision')return JSON.stringify({title:x.role+' 개선본',content:'## 완성된 수정본\n첫 장면과 CTA를 구체화했습니다. 실적은 미측정입니다.\n첫 장면: 떡볶이 단면을 2초 안에 보여 주고 소스 양을 확대합니다. CTA: 평일 오후 포장 시간을 안내합니다.\n대조안: 기존 전체 컷과 단면 컷을 같은 시간대에 게시하고 공유율과 저장률만 비교합니다.\n게시 문안 A: 오늘 오후, 소스가 가득한 단면부터 확인하세요. 게시 문안 B: 퇴근길 포장으로 기다림 없이 받아 가세요.\n[자료 필요] 판매 가격과 포장 가능 시간은 매장 담당자가 게시 전 확인합니다.',changes:'인사이트 담당의 반론과 총괄의 조건을 반영했습니다.'});
 return JSON.stringify({verdict:'revise',summary:'후속 측정 설계 필요',findings:'개선본은 작성됐으며 데이터 담당은 변경된 배포 조건에 맞춰 다시 설계해야 합니다.'});
}
// lockAtGrading: grading 행을 쓰는 순간 이 소유자의 변경 잠금(mutation_locks) 행 수. 채점은 잠금을 푼 뒤라 늘 0이어야 한다.
const runs=new Map(),external=[],errors=[],lockAtGrading=[];let seq=0,failGradingWrite=null;
const {sql,load}=testRuntime(async(url,options={})=>{
 url=String(url);const method=options.method||'GET';
 if(!url.startsWith(HERMES+'/')){external.push(url);throw new Error('모의 주소만 호출합니다: '+url)}
 const path=url.slice(HERMES.length);
 if(path==='/v1/runs'&&method==='POST'){const key=options.headers['Idempotency-Key'];if(!runs.has(key))runs.set(key,{id:'run_'+ ++seq,input:JSON.parse(options.body).input});return Response.json({run_id:runs.get(key).id})}
 const id=/^\/v1\/runs\/([\w-]+)$/.exec(path)?.[1],run=[...runs.values()].find(r=>r.id===id);
 if(!run)return new Response('{}',{status:404});
 const x=JSON.parse(run.input);
 return Response.json({object:'hermes.run',run_id:id,status:'completed',output:x.phase?answer(x):roleFixture(run.input),usage:{input_tokens:1200,output_tokens:800,total_tokens:2000},model:'reported-model-a'});
},{beforeRun(statement){
 if(statement.values.includes('grading')&&/^INSERT/.test(statement.query))lockAtGrading.push(sql.prepare('SELECT COUNT(*) n FROM mutation_locks WHERE owner=?').get(owner).n);
 if(!failGradingWrite||!statement.values.includes('grading'))return;
 const data=statement.values.find(v=>typeof v==='string'&&v.startsWith('{'))||'';
 if(failGradingWrite==='all'||data.includes('"status":"graded"'))throw new Error('injected grading write failure');
}});
const server=await load('lib/server.ts'),roleExec=await load('lib/role-execution.ts'),meetingExec=await load('lib/meeting-execution.ts'),flags=await load('lib/feature-flags.ts');
const onlineGrading=await load('lib/online-grading.ts'),graders=await load('lib/graders/index.ts'),usageRoute=await load('app/api/usage/route.ts'),registry=await load('lib/record-kinds.ts');
const passed=[];const check=(name,value)=>{assert.ok(value,name);passed.push(name)};
const plain=v=>JSON.parse(JSON.stringify(v));
// 채점 실행 계수: 운영 코드가 쓰는 같은 GRADERS 배열의 채점기를 세는 래퍼로 바꾼다. throwOne이면 한 채점기만 예외를 던진다.
let graderCalls=0,throwOne=false;
graders.GRADERS.forEach((g,i)=>{graders.GRADERS[i]={...g,grade:(item,ctx)=>{graderCalls++;if(throwOne&&g.id==='internal_id_exposure')throw new Error('synthetic grader failure');return g.grade(item,ctx)}}});
const originalError=console.error;console.error=(...args)=>{errors.push(args.join(' '))};
const owner='og-owner',now=new Date().toISOString();
const put=(kind,id,data,parent='')=>server.recordStatement(owner,kind,id,data,parent).run();
const rows=(kind,parent)=>sql.prepare('SELECT data,parent_id FROM records WHERE owner=? AND kind=? AND parent_id=? ORDER BY rowid').all(owner,kind,parent).map(r=>({...JSON.parse(r.data),parentId:r.parent_id}));
sql.prepare('INSERT INTO settings(owner,secret,model,updated_at) VALUES(?,?,?,?)').run(owner,await server.encrypt(JSON.stringify({provider:'hermes',endpoint:HERMES,key:'mock-only'})),'HERMES',now);
await put('worker_credential','current',{hash:'synthetic-hash',createdAt:now});

// 합성 브랜드·지점·사실. 실제 고객·매장 정보가 아니다.
const brand={id:'og-brand',name:'가상분식',short:'GB',category:'SNACK BAR',color:'#224466',bg:'#eef2f6',description:'합성 소개(미확인).',audience:'가상동 주민(가설)',tone:'명료한',constraints:'가격은 확인 전 확정하지 않는다.',knowledge:'합성 메모.'};
const store={id:'og-store',brandId:brand.id,name:'가상점',address:'가상동 12',tradeArea:'residential',customer:'',goal:'',daypart:'',menu:'',hours:'',access:'',capacity:'',economics:'',competitors:'',status:'active',version:1,createdAt:now,updatedAt:now};
await put('brand',brand.id,brand);await put('store',store.id,store,brand.id);
const fact=(id,key,value,status)=>put('brand_fact',id,{id,brandId:brand.id,key,value,status,source:'합성 원장',verifiedAt:now,validUntil:'2099-12-31T00:00:00.000Z',version:1,updatedAt:now},brand.id);
await fact('og-address','주소','가상동 12','confirmed');await fact('og-rank','판매 순위','동네 판매 1위','rejected');
const campaign=(id,extra={})=>put('campaign',id,{id,brandId:brand.id,title:'가상분식 '+id,goal:'오픈 전 인지와 첫 포장 주문을 만든다.',audience:'가상동 주민(가설)',channels:'Instagram',stores:'가상동 12',products:'떡볶이(가격 미확정)',budget:null,startDate:'',endDate:'',constraints:'할인 약속 금지.',sources:'',status:'draft',version:1,createdAt:now,updatedAt:now,...extra});
async function roleRun(campaignId,role='cmo'){
 const started=await (await roleExec.executeRole(owner,{action:'start',campaignId,role})).json();
 const polled=await roleExec.executeRole(owner,{action:'poll',id:started.id});
 const job=sql.prepare('SELECT id,status,provider_id FROM jobs WHERE id=?').get(started.id);
 return {job,response:polled,body:await polled.json(),artifactId:await roleExec.roleArtifactId(started.id)};
}
async function meetingRun(id,campaignId){
 await meetingExec.executeMeeting(owner,{action:'start',id,campaignId,campaignVersion:1,agenda:'합성 안건: 서로의 제안을 검토하고 콘텐츠를 개선'});
 let m;for(let i=0;i<40;i++){m=await (await meetingExec.executeMeeting(owner,{action:'advance',id})).json();if(['completed','failed','cancelled'].includes(m.status))break}
 return m;
}
const usageOf=runId=>JSON.parse(sql.prepare("SELECT data FROM records WHERE owner=? AND kind='provider_usage' AND id=?").get(owner,`${owner}:provider_usage:hermes:${runId}`).data);
const artifactOf=id=>JSON.parse(sql.prepare("SELECT data FROM records WHERE owner=? AND kind='artifact' AND id=?").get(owner,`${owner}:artifact:${id}`).data);

// A) 스위치 꺼짐(기본): 역할·회의 작업물이 저장돼도 채점 실행 0회, grading 0건.
check('online grading is off by default',(await flags.isEnabled(owner,'online_grading'))===false);
await campaign('og-off');await campaign('og-meet-off');
let run=await roleRun('og-off');
check('role run completes with the switch off',run.body.status==='completed'&&run.job.status==='completed');
let meeting=await meetingRun('og-m-off','og-meet-off');
check('meeting completes with the switch off',meeting.status==='completed'&&meeting.artifactIds.length>=2);
check('switch off runs the graders zero times',graderCalls===0);
check('switch off writes no grading record',sql.prepare("SELECT COUNT(*) n FROM records WHERE owner=? AND kind='grading'").get(owner).n===0);

// B) 스위치 켜짐: 역할 작업물 저장 직후 채점 1건(산출물 id·버전 참조, 13종 판정, 규제 점검 요약, 소요 ms).
await flags.setFeatureFlag(owner,{flag:'online_grading',enabled:true},{id:owner,email:null});
await campaign('og-on',{storeId:store.id});
let lockMark=lockAtGrading.length;
run=await roleRun('og-on');
let grades=rows('grading','og-on');
const g=grades[0];
check('switch on grades the saved role artifact once',run.body.status==='completed'&&grades.length===1&&graderCalls>0);
check('grading references the artifact id and version',g.artifactId===run.artifactId&&g.artifactVersion===1&&g.id===`${run.artifactId}:1`&&g.campaignId==='og-on'&&g.campaignVersion===1&&g.parentId==='og-on');
check('grading records source, job and role',g.source==='role'&&g.jobId===run.job.id&&g.role==='cmo'&&g.meetingId===null);
check('grading has the fifteen grader verdicts and their summary',g.status==='graded'&&g.graders.length===15&&g.graders.every(x=>['pass','fail','not_applicable','grader_error'].includes(x.status))&&Object.values(g.summary).reduce((a,b)=>a+b,0)===15&&g.gradersVersion===graders.GRADERS_VERSION);
check('grading has a compliance summary without excerpts',typeof g.compliance.block==='number'&&typeof g.compliance.warn==='number'&&g.compliance.issues.every(i=>!('excerpt' in i))&&/^[\w.-]+$/.test(g.compliance.version));
check('grading records the time it took in ms',Number.isInteger(g.durationMs)&&g.durationMs>=0);
check('grading context uses current facts, store scope and reported input tokens',g.context.facts==='current'&&g.context.confirmedFacts===1&&g.context.prohibitedFacts===1&&g.context.localStore===true&&g.context.industry===null&&g.context.inputTokens===1200);
const artifact=artifactOf(run.artifactId);
check('the saved artifact is untouched by grading',artifact.status==='review'&&artifact.version===1&&!('grading' in artifact)&&!('graders' in artifact));
check('job status and usage outcome are unchanged',run.job.status==='completed'&&usageOf(run.job.provider_id).domainOutcome==='completed');
check('role grading is written after the owner mutation lock is released',lockAtGrading.length===lockMark+1&&lockAtGrading.slice(lockMark).every(n=>n===0));

// C) 회의 산출물: 회의가 저장한 작업물마다 채점(회의 스냅샷의 사실 원장).
await campaign('og-meet-on');
const before=graderCalls;lockMark=lockAtGrading.length;
meeting=await meetingRun('og-m-on','og-meet-on');
grades=rows('grading','og-meet-on');
check('meeting completes with grading on',meeting.status==='completed'&&graderCalls>before);
check('every artifact the meeting saved is graded once',grades.length===meeting.artifactIds.length&&meeting.artifactIds.every(id=>grades.some(x=>x.artifactId===id)));
check('meeting gradings point at the meeting and use its fact snapshot',grades.every(x=>x.source==='meeting'&&x.meetingId==='og-m-on'&&x.jobId===null&&x.context.facts==='snapshot'&&x.status==='graded'));
check('meeting gradings reference the stored artifact versions',grades.every(x=>artifactOf(x.artifactId).version===x.artifactVersion));
check('meeting gradings are written after the owner mutation lock is released',lockAtGrading.length===lockMark+meeting.artifactIds.length&&lockAtGrading.slice(lockMark).every(n=>n===0));

// D) 채점기 하나의 예외는 그 채점기의 grader_error 1줄로만 남는다.
throwOne=true;await campaign('og-one');
run=await roleRun('og-one');throwOne=false;
const one=rows('grading','og-one')[0];
check('one throwing grader becomes a single grader_error line',one.status==='graded'&&one.graders.filter(x=>x.status==='grader_error').length===1&&one.graders.find(x=>x.status==='grader_error').id==='internal_id_exposure'&&one.summary.grader_error===1);
check('a grader exception leaves the artifact, job and outcome as they were',run.body.status==='completed'&&artifactOf(run.artifactId).status==='review'&&usageOf(run.job.provider_id).domainOutcome==='completed');

// E) 채점 저장 예외: grader_error 기록 1건과 로그 1줄로만 남고 산출물 저장·job 상태·domainOutcome은 그대로.
failGradingWrite='graded';await campaign('og-error');let errorsBefore=errors.length;
run=await roleRun('og-error');failGradingWrite=null;
grades=rows('grading','og-error');
check('a grading failure keeps the role result',run.response.status===200&&run.body.status==='completed'&&run.job.status==='completed'&&artifactOf(run.artifactId).status==='review');
check('a grading failure keeps the usage outcome',usageOf(run.job.provider_id).domainOutcome==='completed');
check('a grading failure is one grader_error record',grades.length===1&&grades[0].status==='grader_error'&&grades[0].artifactId===run.artifactId&&grades[0].graders.length===0&&typeof grades[0].error==='string');
check('a grading failure is one log line',errors.slice(errorsBefore).filter(e=>/grader_error/.test(e)).length===1);
failGradingWrite='all';await campaign('og-lost');errorsBefore=errors.length;
run=await roleRun('og-lost');failGradingWrite=null;
check('when even the error record cannot be written the role still completes',run.body.status==='completed'&&rows('grading','og-lost').length===0&&artifactOf(run.artifactId).status==='review');
check('an unwritable grading still leaves one log line',errors.slice(errorsBefore).filter(e=>/grader_error/.test(e)).length===1);

// E2) 입력 상한: MAX_GRADED_LINES줄을 넘으면 채점기 0회, not_run(too_many_lines, 줄 수) 기록만. 한도 줄 수는 그대로 채점한다.
await campaign('og-long');
const longArtifact=(id,lines)=>({id,version:1,role:'content',content:Array.from({length:lines},(_,i)=>'줄 '+i).join('\n'),campaignId:'og-long',campaignVersion:1,outputContractVersion:null});
const longCampaign={id:'og-long',brandId:brand.id,version:1};
let callsBefore=graderCalls;
await onlineGrading.gradeSavedArtifacts(owner,longCampaign,[{artifact:longArtifact('og-long-over',onlineGrading.MAX_GRADED_LINES+1),source:'role'}]);
const over=rows('grading','og-long').find(x=>x.artifactId==='og-long-over');
check('an artifact over the line limit runs no grader and records not_run with the line count',graderCalls===callsBefore&&over?.status==='not_run'&&over.reason==='too_many_lines'&&over.lines===onlineGrading.MAX_GRADED_LINES+1&&over.graders.length===0&&over.summary===null&&over.parentId==='og-long');
await onlineGrading.gradeSavedArtifacts(owner,longCampaign,[{artifact:longArtifact('og-long-at',onlineGrading.MAX_GRADED_LINES),source:'role'}]);
check('an artifact at the line limit is graded',graderCalls>callsBefore&&rows('grading','og-long').find(x=>x.artifactId==='og-long-at')?.status==='graded');
const listed=(await (await usageRoute.GET(new Request('https://agency.test/api/usage?grading=og-long',{headers:{'oai-authenticated-user-id':owner}}))).json()).gradings.find(x=>x.artifactId==='og-long-over');
check('the not_run reason reaches the campaign view',listed?.status==='not_run'&&listed.reason==='too_many_lines'&&listed.lines===onlineGrading.MAX_GRADED_LINES+1&&/not_run/.test(readFileSync('app/online-grading.tsx','utf8')));
// 잠금 밖에서 채점하므로 그사이 캠페인이 지워졌으면 grading 행을 남기지 않는다.
callsBefore=graderCalls;errorsBefore=errors.length;
await onlineGrading.gradeSavedArtifacts(owner,{id:'og-gone',brandId:brand.id,version:1},[{artifact:{...longArtifact('og-gone-a',3),campaignId:'og-gone'},source:'role'}]);
check('a campaign deleted before the grading write leaves no grading row and no error',graderCalls>callsBefore&&rows('grading','og-gone').length===0&&errors.length===errorsBefore);

// F) 스위치를 다시 끄면 즉시 0회.
await flags.setFeatureFlag(owner,{flag:'online_grading',enabled:false},{id:owner,email:null});
await campaign('og-off-again');const offCalls=graderCalls;
run=await roleRun('og-off-again');
check('switching off stops grading on the next save',run.body.status==='completed'&&graderCalls===offCalls&&rows('grading','og-off-again').length===0);

// G) 조회: 캠페인 작업물 옆 표시용 API(GET /api/usage?grading=<캠페인>)와 화면 연결.
const get=(query,user=owner)=>usageRoute.GET(new Request('https://agency.test/api/usage'+query,{headers:{'oai-authenticated-user-id':user}}));
let res=await get('?grading=og-on');let data=await res.json();
check('campaign gradings are returned for the artifact list',res.status===200&&data.gradings.length===1&&data.gradings[0].artifactId===rows('grading','og-on')[0].artifactId&&data.gradings[0].summary.pass>=0);
res=await get('?grading=og-on','og-other-owner');
check('another owner cannot read the campaign gradings',res.status===404);
res=await get('?grading=');
check('an empty campaign id is rejected',res.status===400);
const detail=readFileSync('app/campaign-detail-panel.tsx','utf8'),view=readFileSync('app/online-grading.tsx','utf8');
check('campaign detail shows gradings beside the outputs',/OnlineGradingSlot/.test(detail)&&/\/api\/usage\?grading=/.test(view)&&/content-outputs/.test(view));

// H) kind 등록: grading은 캠페인과 함께 삭제된다(작업물 발췌가 든 판정 근거를 남기지 않는다).
const kinds=plain(registry.recordKinds),kind=kinds.find(k=>k.kind==='grading');
check('grading kind is registered as a campaign child deleted with the campaign',kind?.parent==='campaign'&&kind.campaignDeletion==='delete'&&kind.links.includes('parent'));
check('campaign deletion scope includes gradings',plain(registry.campaignScopes('delete','o','c')).find(s=>s.link==='parent').kinds.includes('grading'));
check('no external network call',external.length===0);
console.error=originalError;
console.log(JSON.stringify({passed:passed.length,checks:passed},null,2));
