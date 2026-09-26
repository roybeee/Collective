// 자료 요청 자동 수집(A6-3): 작업물 저장(역할 poll·회의 개선본)·점포 진단 보고서 저장·브리프 초안 완료 때 '자료 필요' 표지·질문을 결정론으로 모은다.
// 스위치 a6_data_requests가 꺼져 있으면 역할·회의 저장 작업물·응답이 바이트 동일하고, 켜져 있어도 작업물은 바뀌지 않는다. 수집 실패는 저장·job 완료를 막지 않는다.
// 재개 규칙: 철회·만료로 유효하지 않은 사실로 닫힌 요청(fact_confirmed)은 다음 수집 때 다시 연다. 수동으로 닫은 요청(answered·dismissed)은 다시 열지 않는다.
// 근거: mocked(모의 HERMES fetch 스텁, 메모리 SQLite, 로컬 인증 헤더, 합성 브랜드·지점·캠페인·문장). 수집은 모델·외부 호출 0회다.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {testRuntime} from './helpers/runtime.mjs';
import {roleFixture} from './helpers/role-fixture.mjs';

const HERMES='https://hermes.example.com';
const CRITERIA=['evidence','brand','execution','economics','measurement'];
// inject: 역할 작업물 첫 섹션 끝에 붙일 문장. qualityOut: 품질 검수 역할 응답. revisionExtra: 회의 개선본 끝 문장. storeQuestions·briefQuestions: 점포 진단·브리프 초안 질문.
let inject='',qualityOut=null,revisionExtra='',storeQuestions=[],briefQuestions=[];
function roleOutput(input){
 const task=JSON.parse(input).task;
 if(task?.role==='quality'&&qualityOut)return JSON.stringify(qualityOut);
 const out=roleFixture(input);
 if(!inject||!task||task.role==='quality')return out;
 const x=JSON.parse(out);return JSON.stringify({...x,sections:x.sections.map((s,i)=>i?s:{...s,content:s.content+'\n'+inject})});
}
// 회의 단계 모의 응답(tests/a2-runtime.test.mjs와 같은 형식의 합성 문장).
function meetingAnswer(x){
 if(x.phase==='discussion')return JSON.stringify({position:'실제 브리프를 검토했습니다. 평일 오후 고객은 가격보다 제품 단면과 구매 이유를 먼저 확인한다는 가설이 가장 중요합니다.',evidence:'주어진 브리프만 사용했고 고객 반응은 미측정입니다. 가격과 판매 메뉴는 [자료 필요]이며 매장 담당자가 확인합니다.',challenge:'앞선 제안의 공유 동기와 검증 기준을 보완해야 합니다. 확인되지 않은 인기 표현은 사용하지 않습니다.',proposal:'제품 단면을 먼저 보여주는 첫 장면과 기존 컷을 2주간 공유율로 대조하고, 콘텐츠 담당에게 대조안 두 개를 요청합니다.',respondsTo:x.allowedRespondsTo.length?[x.allowedRespondsTo.at(-1).ref]:[]});
 if(x.phase==='synthesis')return JSON.stringify({decisions:'공유 동기를 드러내는 콘텐츠 실험',disagreements:'기준 없는 할인 제안 보류',questions:'실제 제품 가격 확인',tasks:[{role:'growth',instruction:'배포 설계 개선',reason:'콘텐츠와 측정 연결',acceptance:'배포 조건 명시'},{role:'content',instruction:'완성된 카피와 대본 개선',reason:'첫 장면 반론 반영',acceptance:'대조안과 한 변수 구분'}]});
 if(x.phase==='revision')return JSON.stringify({title:x.role+' 개선본',content:'## 완성된 수정본\n첫 장면과 CTA를 구체화했습니다. 실적은 미측정입니다.\n첫 장면: 떡볶이 단면을 2초 안에 보여 주고 소스 양을 확대합니다. CTA: 평일 오후 포장 시간을 안내합니다.\n대조안: 기존 전체 컷과 단면 컷을 같은 시간대에 게시하고 공유율과 저장률만 비교합니다.\n게시 문안 A: 오늘 오후, 소스가 가득한 단면부터 확인하세요. 게시 문안 B: 퇴근길 포장으로 기다림 없이 받아 가세요.\n[자료 필요] 판매 가격과 포장 가능 시간은 매장 담당자가 게시 전 확인합니다.'+(revisionExtra?'\n'+revisionExtra:''),changes:'인사이트 담당의 반론과 총괄의 조건을 반영했습니다.'});
 return JSON.stringify({verdict:'revise',summary:'후속 측정 설계 필요',findings:'개선본은 작성됐으며 데이터 담당은 변경된 배포 조건에 맞춰 다시 설계해야 합니다.'});
}
const storeAnswer=x=>x.stage==='store_diagnosis'?JSON.stringify({summary:'지점 방문 장벽 진단(합성)',customer:'가상동 주민(가설)',bottleneck:'영업 정보 부족',actions:[],proposals:[],measurementPlan:'결제와 클릭 분리',questions:storeQuestions,limitations:'모의 공급자 응답·실측 없음',sourceIds:[]}):JSON.stringify({summary:'자료를 검토했습니다(합성).',limitations:'제공 자료만 확인',classifications:[],sources:[]});
const briefAnswer=()=>JSON.stringify({summary:'합성 요약: 첫 방문 고객의 재방문 동기를 한 가지로 좁혀 시험한다.',suggestions:['kpi','hypothesis','experiment','tracking','decision'].map(field=>({field,value:`합성 ${field}: 다음 메뉴 안내 카드 회수율을 주간 기록으로 본다.`,reason:'합성 근거'})),questions:briefQuestions,assumptions:['합성 가정: 고객 반응은 미측정이다.']});
// inserted: 작업물 id별로 저장 경로가 마지막으로 쓴 본문 바이트. failRequests: data_request 쓰기 실패 주입(훅은 run에만 걸린다).
const runs=new Map(),external=[],errors=[],inserted=new Map();let seq=0,failRequests=false;
const {sql,load}=testRuntime(async(url,options={})=>{
 url=String(url);const method=options.method||'GET';
 if(!url.startsWith(HERMES+'/')){external.push(url);throw new Error('모의 주소만 호출합니다: '+url)}
 const path=url.slice(HERMES.length);
 if(path==='/v1/runs'&&method==='POST'){const key=options.headers['Idempotency-Key'];if(!runs.has(key))runs.set(key,{id:'run_'+ ++seq,input:JSON.parse(options.body).input});return Response.json({run_id:runs.get(key).id})}
 const id=/^\/v1\/runs\/([\w-]+)$/.exec(path)?.[1],run=[...runs.values()].find(r=>r.id===id);
 if(!run)return new Response('{}',{status:404});
 const x=JSON.parse(run.input),output=x.phase?meetingAnswer(x):x.task?roleOutput(run.input):x.stage?storeAnswer(x):x.currentBrief?briefAnswer():roleOutput(run.input);
 return Response.json({object:'hermes.run',run_id:id,status:'completed',output,usage:{input_tokens:1200,output_tokens:800,total_tokens:2000},model:'reported-model-a'});
},{beforeRun(statement){
 if(/^INSERT/.test(statement.query)&&statement.values[2]==='artifact')inserted.set(statement.values[0],statement.values[4]);
 if(failRequests&&(statement.values.includes('data_request')||/data_request/.test(statement.query)))throw new Error('simulated data_request failure');
}});
const server=await load('lib/server.ts'),roleExec=await load('lib/role-execution.ts'),meetingExec=await load('lib/meeting-execution.ts'),briefExec=await load('lib/brief-execution.ts'),researchExec=await load('lib/research-execution.ts');
const flags=await load('lib/feature-flags.ts'),drs=await load('lib/data-requests-server.ts'),route=await load('app/api/data-requests/route.ts'),factsRoute=await load('app/api/brand-facts/route.ts');
const passed=[];const check=(name,value)=>{assert.ok(value,name);passed.push(name)};
const originalError=console.error;console.error=(...args)=>{errors.push(args.join(' '))};
const owner='dra-owner',brandId='dra-brand',storeId='dra-s1',now=new Date().toISOString(),day=86400000,iso=ms=>new Date(Date.now()+ms).toISOString();
const put=(kind,id,data,parent='')=>server.recordStatement(owner,kind,id,data,parent).run();
const key=id=>`${owner}:artifact:${id}`;
const rowOf=id=>sql.prepare("SELECT data FROM records WHERE owner=? AND kind='artifact' AND id=?").get(owner,key(id))?.data;
const requests=()=>sql.prepare("SELECT data FROM records WHERE owner=? AND kind='data_request'").all(owner).map(r=>JSON.parse(r.data));
const campaignRequests=campaignId=>requests().filter(r=>r.campaignId===campaignId);
const byKey=(campaignId,factKey)=>campaignRequests(campaignId).filter(r=>r.factKey===factKey);
const setFlag=enabled=>flags.setFeatureFlag(owner,{flag:'a6_data_requests',enabled},{id:owner,email:null});
const headers={'oai-authenticated-user-id':owner};
const post=async input=>{const r=await route.POST(new Request('https://agency.test/api/data-requests',{method:'POST',headers:{'content-type':'application/json',...headers},body:JSON.stringify(input)}));return {status:r.status,body:await r.json()}};
const factPost=async input=>{const r=await factsRoute.POST(new Request('https://agency.test/api/brand-facts',{method:'POST',headers:{'content-type':'application/json',...headers},body:JSON.stringify(input)}));return {status:r.status,body:await r.json()}};
const confirmFact=(factKey,value,extra={})=>factPost({action:'save_fact',confirmed:true,data:{brandId,key:factKey,value,status:'confirmed',source:'점주 확인(합성)',verifiedAt:iso(-day),validUntil:iso(30*day),...extra}});
sql.prepare('INSERT INTO settings(owner,secret,model,updated_at) VALUES(?,?,?,?)').run(owner,await server.encrypt(JSON.stringify({provider:'hermes',endpoint:HERMES,key:'mock-only'})),'HERMES',now);
await put('worker_credential','current',{hash:'synthetic-hash',createdAt:now});

// 합성 브랜드·지점. 실제 고객·매장 정보가 아니다.
await put('brand',brandId,{id:brandId,name:'가상분식',short:'GB',category:'SNACK BAR',color:'#224466',bg:'#eef2f6',description:'합성 소개(미확인).',audience:'가상동 주민(가설)',tone:'명료한',constraints:'가격은 확인 전 확정하지 않는다.',knowledge:'합성 메모.'});
const store={id:storeId,brandId,name:'가상 1호점',address:'가상동 12',tradeArea:'residential',customer:'주민(가설)',goal:'첫 방문',daypart:'평일 오후',menu:'떡볶이(가격 미확정)',hours:'',access:'',capacity:'',economics:'',competitors:'',status:'active',version:1,createdAt:now,updatedAt:now};
await put('store',storeId,store,brandId);
const campaign=async(id,extra={})=>{const c={id,brandId,title:'가상분식 '+id,goal:'오픈 전 인지와 첫 포장 주문을 만든다.',audience:'가상동 주민(가설)',channels:'Instagram',stores:'가상동 12',products:'떡볶이(가격 미확정)',budget:null,startDate:'',endDate:'',constraints:'할인 약속 금지.',sources:'',status:'draft',version:1,createdAt:now,updatedAt:now,...extra};await put('campaign',id,c);return c};
async function roleRun(campaignId,role='cmo'){
 const started=await (await roleExec.executeRole(owner,{action:'start',campaignId,role})).json();
 const polled=await roleExec.executeRole(owner,{action:'poll',id:started.id});
 const job=sql.prepare('SELECT id,status FROM jobs WHERE id=?').get(started.id);
 return {job,status:polled.status,text:await polled.text(),jobId:started.id,artifactId:await roleExec.roleArtifactId(started.id)};
}
async function meetingRun(id,campaignId){
 await meetingExec.executeMeeting(owner,{action:'start',id,campaignId,campaignVersion:1,agenda:'합성 안건: 서로의 제안을 검토하고 콘텐츠를 개선'});
 let m;for(let i=0;i<40;i++){m=await (await meetingExec.executeMeeting(owner,{action:'advance',id})).json();if(['completed','failed','cancelled'].includes(m.status))break}
 return m;
}
const roleName=id=>({cmo:'총괄 파트너',insight:'고객 인사이트',strategy:'브랜드 전략',creative:'크리에이티브',content:'콘텐츠 스튜디오',growth:'채널 & 그로스',data:'데이터 & 실험',quality:'독립 품질 검수'})[id];
const NEUTRAL='## 실행 초안\n현재 초안은 가설이며 담당자가 POS 기록과 현장 관찰로 검증합니다.';
const art=(campaignId,id,role,content=NEUTRAL,extra={})=>({id,campaignId,campaignVersion:1,role,title:`${roleName(role)} · ${id}`,content,version:1,status:'review',origin:'ai',createdAt:now,...extra});
const putArtifact=a=>put('artifact',a.id,a,a.campaignId);
// 작업물 비교: 캠페인마다 다른 id·제목·시각을 뺀 나머지 바이트.
const shape=raw=>JSON.stringify(JSON.parse(raw),(k,v)=>['id','campaignId','title','createdAt'].includes(k)?undefined:v);
const MARK='매장 안내 [자료 필요: 점주/영업시간]';

// ── A) 스위치 꺼짐(기본): 역할·회의 저장 작업물·응답 바이트 동일, 요청 0건 ──
check('a6_data_requests is off by default',(await flags.isEnabled(owner,'a6_data_requests'))===false);
await campaign('dra-off');inject=MARK;
const offRun=await roleRun('dra-off');
check('switch off: the role poll response is byte-identical ({id,status})',offRun.status===200&&offRun.text===JSON.stringify({id:offRun.jobId,status:'completed'})&&offRun.job.status==='completed');
check('switch off: the saved role artifact is byte-identical to what the save path wrote',rowOf(offRun.artifactId)===inserted.get(key(offRun.artifactId))&&rowOf(offRun.artifactId).includes('[자료 필요: 점주/영업시간]'));
await campaign('dra-meet-off');revisionExtra='[자료 필요: 점주/주차]';
const offMeeting=await meetingRun('dra-m-off','dra-meet-off');
check('switch off: the meeting completes and its saved artifacts are byte-identical',offMeeting.status==='completed'&&offMeeting.artifactIds.length===3&&offMeeting.artifactIds.every(id=>rowOf(id)===inserted.get(key(id))));
check('switch off: no data request is written by role or meeting saves',requests().length===0);

// ── B) 스위치 켬: 표지가 있는 작업물 저장이 요청을 1회만 연다(역할·회의 개선본) ──
await setFlag(true);await campaign('dra-on');
const runsBefore=seq,onRun=await roleRun('dra-on');
const hours=byKey('dra-on','hours');
check('switch on: the role poll response has the same bytes as with the switch off',onRun.status===200&&onRun.text===JSON.stringify({id:onRun.jobId,status:'completed'})&&onRun.job.status==='completed');
check('switch on: the saved role artifact is unchanged by collection and equals the switch-off shape',rowOf(onRun.artifactId)===inserted.get(key(onRun.artifactId))&&shape(rowOf(onRun.artifactId))===shape(rowOf(offRun.artifactId)));
check('switch on: saving a role artifact with a marker opens the request once',hours.length===1&&hours[0].status==='open'&&hours[0].version===1&&hours[0].origins.length===1&&hours[0].origins[0].kind==='artifact_marker'&&hours[0].origins[0].artifactId===onRun.artifactId&&hours[0].createdBy.role==='system');
check('switch on: the role run itself made exactly one provider run (collection adds none)',seq===runsBefore+1);
const snapshot=JSON.stringify(campaignRequests('dra-on'));
await roleExec.executeRole(owner,{action:'poll',id:onRun.jobId});
await drs.collectOnSave(owner,await server.readRecord(owner,'campaign','dra-on'),[onRun.artifactId]);
const manual=await post({action:'collect',campaignId:'dra-on'});
check('collection on save is idempotent: re-poll, direct re-collect and manual collect open nothing new',JSON.stringify(campaignRequests('dra-on'))===snapshot&&manual.status===200&&manual.body.created===0&&manual.body.merged===0&&manual.body.reopened===0);
await campaign('dra-meet-on');revisionExtra='[자료 필요: 점주/주차]';
const onMeeting=await meetingRun('dra-m-on','dra-meet-on');
const parking=byKey('dra-meet-on','parking');
check('switch on: the meeting still completes and its artifacts are byte-identical',onMeeting.status==='completed'&&onMeeting.artifactIds.every(id=>rowOf(id)===inserted.get(key(id))));
check('switch on: meeting revision saves open the request once with both revision artifacts as origins',parking.length===1&&parking[0].status==='open'&&parking[0].origins.filter(o=>o.kind==='artifact_marker').map(o=>o.artifactId).sort().join()===onMeeting.artifactIds.filter(id=>JSON.parse(rowOf(id)).role!=='quality').sort().join());
const meetingSnapshot=JSON.stringify(campaignRequests('dra-meet-on'));
await drs.collectOnSave(owner,await server.readRecord(owner,'campaign','dra-meet-on'),onMeeting.artifactIds);
check('meeting collection is idempotent',JSON.stringify(campaignRequests('dra-meet-on'))===meetingSnapshot);

// ── C) 수집 실패는 작업물 저장·job 완료·응답을 막지 않는다 ──
await campaign('dra-fail');failRequests=true;
const failRun=await roleRun('dra-fail');failRequests=false;
check('collection failure: the role run completes with the same response and the artifact is saved',failRun.text===JSON.stringify({id:failRun.jobId,status:'completed'})&&failRun.job.status==='completed'&&rowOf(failRun.artifactId)===inserted.get(key(failRun.artifactId)));
check('collection failure logs one fixed line and writes no request',errors.includes('data_request_auto_collect_failed')&&campaignRequests('dra-fail').length===0);
await campaign('dra-meet-fail');failRequests=true;
const failMeeting=await meetingRun('dra-m-fail','dra-meet-fail');failRequests=false;
check('collection failure: the meeting still completes and saves its artifacts',failMeeting.status==='completed'&&failMeeting.artifactIds.length===3&&failMeeting.artifactIds.every(id=>rowOf(id)===inserted.get(key(id)))&&campaignRequests('dra-meet-fail').length===0);
// 스위치 읽기 실패: 저장된 스위치 행을 잠시 JSON이 아닌 값으로 바꿔 isEnabled가 던지게 한다(읽기에는 실패 주입 훅이 없다).
const flagRow=()=>sql.prepare("SELECT id,data FROM records WHERE owner=? AND kind='feature_flag' AND data LIKE '%a6_data_requests%'").get(owner);
await campaign('dra-flagfail');const savedFlag=flagRow();sql.prepare('UPDATE records SET data=? WHERE id=?').run('{broken',savedFlag.id);
const flagRun=await roleRun('dra-flagfail');sql.prepare('UPDATE records SET data=? WHERE id=?').run(savedFlag.data,savedFlag.id);
check('an unreadable switch counts as off (role run completes, no request)',flagRun.job.status==='completed'&&errors.includes('a6_data_requests_flag_unreadable')&&campaignRequests('dra-flagfail').length===0);

// ── D) 실행기는 feature-flags를 직접 import하지 않는다(보조 모듈 한 줄 호출) ──
const src=p=>readFileSync(p,'utf8');
check('executors do not import feature-flags; they call the data-requests-server helpers',['lib/role-execution.ts','lib/meeting-execution.ts','lib/brief-execution.ts'].every(p=>!/feature-flags/.test(src(p)))&&/collectOnSave\(owner,c,\[aid\]\)/.test(src('lib/role-execution.ts'))&&/collectOnSave\(owner,c,m\.artifactIds\)/.test(src('lib/meeting-execution.ts'))&&/collectBriefOnSave\(owner,next\)/.test(src('lib/brief-execution.ts'))&&/collectStoreReportOnSave\(owner,r\.id\)/.test(src('lib/research-execution.ts')));

// ── E) 품질 검수 needs_data 지적은 항목 key 없는 요청이다(자동으로 닫히지 않는다) ──
await setFlag(true);await campaign('dra-q');
for(const role of ['cmo','insight','strategy','creative','content','growth','data'])await putArtifact(art('dra-q','dra-q-'+role,role));
const pass=criterion=>({criterion,status:'pass',location:'콘텐츠 스튜디오 v1 §1',finding:'브리프 목표와 게시 문안을 대조했습니다.',fix:'해당 없음'});
qualityOut={verdict:'needs_data',summary:'자료 확인 필요',findings:'운영 자료 없이 게시할 수 없습니다.',checks:CRITERIA.map(c=>c==='evidence'?{criterion:c,status:'needs_data',location:'콘텐츠 스튜디오 v1 §1',finding:'영업시간 근거가 없습니다.',fix:'영업시간'}:c==='execution'?{criterion:c,status:'needs_data',location:'채널 & 그로스 v1',finding:'배포 담당이 정해지지 않았습니다.',fix:'점포 배포 담당자 지정'}:pass(c)),taskChecks:[]};
const qRun=await roleRun('dra-q','quality');qualityOut=null;
const qReqs=campaignRequests('dra-q').filter(r=>r.origins.some(o=>o.kind==='quality_check'));
check('quality needs_data checks become open requests with quality_check origins',qRun.job.status==='completed'&&qReqs.length===2&&qReqs.every(r=>r.status==='open'&&r.origins.every(o=>o.kind==='quality_check'&&o.artifactId===qRun.artifactId&&o.artifactVersion===1)));
check('quality requests carry no fact key even when the text is a catalog label',qReqs.every(r=>r.factKey===null)&&qReqs.some(r=>r.label==='영업시간')&&qReqs.map(r=>r.origins[0].check).sort().join()==='evidence,execution');
const qFact=await confirmFact('영업시간','11:00-21:00');
const qReconcile=await post({action:'reconcile',campaignId:'dra-q'});
check('a confirmed matching fact does not close keyless quality requests',qFact.status===200&&qReconcile.body.closed===0&&campaignRequests('dra-q').filter(r=>r.origins.some(o=>o.kind==='quality_check')).every(r=>r.status==='open'));
// 뒤 절(G)이 영업시간을 지점 사실로 다시 확정하므로 이 브랜드 공통 사실은 거절로 돌려 둔다.
{const f=await server.readRecord(owner,'brand_fact',qFact.body.id);await put('brand_fact',f.id,{...f,status:'rejected',version:f.version+1,updatedAt:now},brandId)}
check('pass checks and fix text 해당 없음 do not become requests',!campaignRequests('dra-q').some(r=>/해당 없음|브리프 목표/.test(r.label+r.text)));

// ── F) 점포 진단 보고서 질문과 브리프 초안 질문도 요청이 된다 ──
storeQuestions=['휴무일','포장 용기 규격은 어떻게 되나요?'];
let research=await (await researchExec.executeResearch(owner,{action:'start',id:'dra-research',brandId,storeId})).json();
for(let i=0;i<12&&!['completed','failed','cancelled'].includes(research.status);i++)research=await (await researchExec.executeResearch(owner,{action:'advance',id:'dra-research'})).json();
const report=await server.readRecord(owner,'store_report','dra-research').catch(()=>null);
const storeReqs=requests().filter(r=>r.origins.some(o=>o.kind==='store_report'));
check('the store research completes and saves its report',research.status==='completed'&&report?.questions.length===2);
check('store report questions become store-scope requests without a campaign',storeReqs.length===2&&storeReqs.every(r=>r.storeId===storeId&&!r.campaignId&&r.status==='open'&&r.origins[0].reportId==='dra-research'&&r.origins[0].storeVersion===1)&&storeReqs.find(r=>r.factKey==='closed_days')&&storeReqs.find(r=>r.factKey===null));
const storeSnapshot=JSON.stringify(storeReqs);
await drs.collectStoreReportOnSave(owner,'dra-research');
check('store report collection is idempotent',JSON.stringify(requests().filter(r=>r.origins.some(o=>o.kind==='store_report')))===storeSnapshot);
await campaign('dra-brief',{storeId});briefQuestions=[{field:'operations',question:'주차 정보',why:'방문 안내'},{field:'budget',question:'예산 상한을 알려 주세요.',why:'집행 범위'}];
await briefExec.executeBrief(owner,{action:'start',id:'dra-b1',campaignId:'dra-brief',campaignVersion:1,data:{brandId,storeId,title:'합성 초안',goal:'합성 목표'}});
const polledBrief=await (await briefExec.executeBrief(owner,{action:'poll',id:'dra-b1'})).json();
const briefReqs=campaignRequests('dra-brief');
check('brief draft questions become campaign requests with brief_draft origins',polledBrief.status==='completed'&&briefReqs.length===2&&briefReqs.every(r=>r.storeId===storeId&&r.status==='open'&&r.origins[0].kind==='brief_draft'&&r.origins[0].draftId==='dra-b1')&&briefReqs.find(r=>r.factKey==='parking')&&briefReqs.find(r=>r.factKey===null)&&briefReqs.map(r=>r.origins[0].field).sort().join()==='budget,operations');
check('the brief draft response does not change (no data request key)',!('dataRequests' in polledBrief)&&polledBrief.result.questions.length===2);

// ── G) 재개 규칙: 철회·만료 사실로 닫힌 요청은 다음 수집 때 다시 연다. answered·dismissed는 그대로 ──
await campaign('dra-re',{storeId});
await putArtifact(art('dra-re','dra-re-content','content','## 게시 카피\n[자료 필요: 점주/영업시간, 주차, 좌석 수, 전화번호, 휴무일]'));
const first=await post({action:'collect',campaignId:'dra-re'});
const hoursFact=await confirmFact('영업시간','11:00-21:00',{storeId}),parkingFact=await confirmFact('주차','건물 뒤 2대',{storeId}),daysFact=await confirmFact('휴무일','매주 월요일',{storeId});
const seat=byKey('dra-re','seating')[0],phone=byKey('dra-re','phone')[0];
const answered=await post({action:'close',id:seat.id,version:seat.version,note:'점장 회신(합성)'}),dismissed=await post({action:'dismiss',id:phone.id,version:phone.version});
check('setup: five requests, three closed by facts and two closed manually',first.body.created===5&&[hoursFact,parkingFact,daysFact].every(f=>f.body.closedRequests>=1)&&answered.status===200&&dismissed.status===200&&campaignRequests('dra-re').every(r=>r.status==='closed'));
const storedFact=id=>server.readRecord(owner,'brand_fact',id);
const hf=await storedFact(hoursFact.body.id),pf=await storedFact(parkingFact.body.id);
await put('brand_fact',hf.id,{...hf,status:'rejected',version:hf.version+1,updatedAt:now},brandId);
await put('brand_fact',pf.id,{...pf,validUntil:iso(-1000),version:pf.version+1,updatedAt:now},brandId);
const beforeReopen=Object.fromEntries(campaignRequests('dra-re').map(r=>[r.factKey,r]));
await drs.collectOnSave(owner,await server.readRecord(owner,'campaign','dra-re'),['dra-re-content']);
const after=Object.fromEntries(campaignRequests('dra-re').map(r=>[r.factKey,r]));
check('a request closed by a revoked fact reopens on the next automatic collect with history',after.hours.status==='open'&&!('resolution' in after.hours)&&after.hours.previousResolution.kind==='fact_confirmed'&&after.hours.previousResolution.factId===hf.id&&typeof after.hours.reopenedAt==='string'&&after.hours.version===beforeReopen.hours.version+1);
check('a request closed by an expired fact reopens too',after.parking.status==='open'&&after.parking.previousResolution.factId===pf.id&&after.parking.version===beforeReopen.parking.version+1);
check('a request closed by a still-valid fact stays closed',JSON.stringify(after.closed_days)===JSON.stringify(beforeReopen.closed_days));
check('answered and dismissed requests stay closed',JSON.stringify(after.seating)===JSON.stringify(beforeReopen.seating)&&JSON.stringify(after.phone)===JSON.stringify(beforeReopen.phone)&&after.seating.resolution.kind==='answered'&&after.phone.resolution.kind==='dismissed');
const df=await storedFact(daysFact.body.id);
await put('brand_fact',df.id,{...df,status:'rejected',version:df.version+1,updatedAt:now},brandId);
const manualReopen=await post({action:'collect',campaignId:'dra-re'}),again=await post({action:'collect',campaignId:'dra-re'});
check('manual collect applies the same reopen rule and is idempotent',manualReopen.body.reopened===1&&byKey('dra-re','closed_days')[0].status==='open'&&byKey('dra-re','closed_days')[0].previousResolution.factId===df.id&&again.body.reopened===0&&again.body.created===0);
const reclose=await factPost({action:'save_fact',confirmed:true,id:hf.id,version:hf.version+1,data:{brandId,storeId,key:'영업시간',value:'10:00-20:00',status:'confirmed',source:'점주 재확인(합성)',verifiedAt:iso(-day),validUntil:iso(30*day)}}),closedAgain=byKey('dra-re','hours')[0];
check('a reopened request closes again on a new confirmed fact and keeps the reopen history',reclose.body.closedRequests===1&&closedAgain.status==='closed'&&closedAgain.resolution.factId===hf.id&&closedAgain.resolution.factVersion===hf.version+2&&closedAgain.previousResolution.factVersion===1);

// ── H) 모델·외부 호출 없음 ──
const runsNow=seq;
await drs.collectOnSave(owner,await server.readRecord(owner,'campaign','dra-on'),[onRun.artifactId]);await post({action:'collect',campaignId:'dra-re'});await drs.collectStoreReportOnSave(owner,'dra-research');
check('no model or external calls from collection',external.length===0&&seq===runsNow&&!/hermes|openai|fetch\(/.test(src('lib/data-requests.ts')+src('lib/data-requests-server.ts')));
console.error=originalError;
console.log(JSON.stringify({passed:passed.length,checks:passed},null,2));
