// 소재 예측 점수 서버·API 회귀(G2, docs/CREATIVE-SCORE.ko.md): 스위치 creative_score 꺼짐이면 저장 뒤 자동 계산 0회·기록 0행, 켜짐이면 온라인 채점 경로(gradeSavedArtifacts)에서
// creative_score 1행(id 작업물:버전, parent 캠페인), 같은 입력은 다시 쓰지 않음(멱등), 규칙 집합이 바뀌면 새로 씀, 조회·다시 계산·보정 API 권한(비로그인 401·직원 403·다른 소유자 404·스위치 꺼짐 409)과
// 입력 검증(400), 보정표 저장(creative_calibration, parent 브랜드)과 점수의 표본 표시, kind·스위치·기능표·삭제 문구 등록. 근거: mocked(메모리 SQLite, 로컬 인증 헤더·세션 주입). 모델·외부 네트워크 호출은 0회다.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {testRuntime} from './helpers/runtime.mjs';

let fetchCalls=0;
const errors=[];const originalError=console.error;console.error=(...args)=>{errors.push(args.join(' '))};
const {sql,env,load}=testRuntime(async()=>{fetchCalls++;throw new Error('외부 호출 금지')});
const server=await load('lib/server.ts'),flags=await load('lib/feature-flags.ts'),registry=await load('lib/record-kinds.ts'),status=await load('lib/feature-status.ts'),summary=await load('lib/deletion-summary.ts');
const css=await load('lib/creative-score-server.ts'),grading=await load('lib/online-grading.ts'),route=await load('app/api/creative-score/route.ts');
const passed=[];const check=(name,val)=>{assert.ok(val,name);passed.push(name)};
const plain=x=>JSON.parse(JSON.stringify(x));
const ORIGIN='https://agency.test',O='g2-owner',X='g2-other',now=new Date().toISOString(),ago=d=>new Date(Date.now()-d*86400000).toISOString();
const save=(owner,kind,id,data,parent='')=>server.recordStatement(owner,kind,id,data,parent).run();
const rows=(kind,owner=O)=>sql.prepare('SELECT id,parent_id,data FROM records WHERE owner=? AND kind=? ORDER BY rowid').all(owner,kind).map(r=>({...JSON.parse(r.data),rowId:r.id,parentId:r.parent_id}));

// ── 1) 합성 데이터(실제 고객·매장 아님) ──
await save(O,'brand','gb',{id:'gb',name:'가상분식',short:'GB'});
const campaign={id:'c1',brandId:'gb',title:'가상분식 오픈',goal:'첫 포장 주문',audience:'가상동 주민(가설)',channels:'Instagram, 매장 안내',stores:'가상동 12',products:'떡볶이',budget:null,startDate:'',endDate:'',constraints:'',sources:'',status:'review',version:1,createdAt:now,updatedAt:now};
await save(O,'campaign','c1',campaign);
const fact=(id,key,value,st)=>save(O,'brand_fact',id,{id,brandId:'gb',key,value,status:st,source:'합성 원장',verifiedAt:ago(1),validUntil:'2099-12-31T00:00:00.000Z',version:1,updatedAt:now},'gb');
await fact('f-price','가격','4,500원','confirmed');await fact('f-rank','판매 순위','동네 1위','rejected');
const rule=(id,guidance,extra={})=>save(O,'learning_rule',id,{id,brandId:'gb',channel:'Instagram',experimentId:'e1',experimentVersion:1,caseId:'k1',title:id,guidance,scope:'brand',status:'active',version:1,expiresAt:'2099-01-01T00:00:00.000Z',createdAt:now,updatedAt:now,direction:'test',...extra},'gb');
await rule('r-cut','첫 장면에 ‘단면’을 보여 주면 공유가 늘었다(관찰).');
await rule('r-other-brand','‘무관’',{brandId:'zz'});
await save(O,'brand_voice','gb',{id:'gb',brandId:'gb',version:1,status:'confirmed',tone:[],do:[],dont:[],preferTerms:['소스 가득'],avoidTerms:['최고'],samples:[],updatedBy:{id:O,role:'owner'},updatedAt:now,confirmedVoice:{version:1,status:'confirmed',tone:[],do:[],dont:[],preferTerms:['소스 가득'],avoidTerms:['최고'],samples:[],updatedBy:{id:O,role:'owner'},updatedAt:now},history:[]},'gb');
await save(O,'execution_publication','p1',{id:'p1',campaignId:'c1',creativeId:'cr1',creativeVersion:1,campaignVersion:1,pngHash:'h',factRefs:[],caption:'봄 신메뉴 안내. 매장에서 만나요. #가상분식 #신메뉴 #봄',mediaUrl:'',scheduledAt:now,plannedCostKRW:0,version:1,status:'published',createdAt:now},'c1');
const CONTENT='소스 가득한 단면을 먼저 보여 드립니다. 평일 오후 3시 떡볶이 4,500원.\n가상동 12 매장에서 포장 주문하세요.\n#가상분식 #평일간식 #포장';
const artifact={id:'a1',campaignId:'c1',campaignVersion:1,role:'content',title:'콘텐츠 · 가상분식',content:CONTENT,version:1,status:'review',origin:'ai',createdAt:now};
await save(O,'artifact','a1',artifact,'c1');
await save(X,'brand','gb',{id:'gb',name:'남의 브랜드'});

// ── 2) 스위치 꺼짐: 자동 계산 0회 ──
check('creative_score is a known flag that defaults to off',plain(flags.FEATURE_FLAGS).creative_score?.defaultEnabled===false&&await flags.isEnabled(O,'creative_score')===false);
await grading.gradeSavedArtifacts(O,campaign,[{artifact,source:'role'}]);
check('with the switch off the save hook writes no creative_score row',rows('creative_score').length===0);
check('scoreSavedArtifacts returns 0 with the switch off',await css.scoreSavedArtifacts(O,[{id:'a1',version:1}])===0);
let r=await css.artifactCreativeScore(O,'a1');
check('reading with no record gives enabled:false and score:null',r.enabled===false&&r.score===null&&r.artifactVersion===1);
await assert.rejects(()=>css.recomputeCreativeScore(O,'a1'),e=>e.status===409);passed.push('manual recompute is a 409 while the switch is off');

// ── 3) 스위치 켜짐: 저장 뒤 1행 ──
await flags.setFeatureFlag(O,{flag:'creative_score',enabled:true},{id:O,email:null});
check('the switch read before grading is the only gate: no rows yet',rows('creative_score').length===0);
await grading.gradeSavedArtifacts(O,campaign,[{artifact,source:'role'}]);
let saved=rows('creative_score');
check('the save hook writes exactly one creative_score row under the campaign',saved.length===1&&saved[0].rowId===`${O}:creative_score:a1:1`&&saved[0].parentId==='c1'&&saved[0].artifactId==='a1'&&saved[0].artifactVersion===1&&saved[0].campaignId==='c1'&&saved[0].brandId==='gb');
const first=saved[0];
check('the record carries score, band, 9 components, label and the primary channel',typeof first.score==='number'&&first.score>=0&&first.score<=100&&['낮음','보통','높음'].includes(first.band)&&first.components.length===9&&first.label==='추정 · 규칙 기반 · 성과 보장 아님'&&first.channel==='Instagram');
check('only applicable learning rules are used, in id order',JSON.stringify(first.ruleIds)==='["r-cut"]'&&first.components.find(c=>c.key==='learning_rules').evidence.some(e=>e.startsWith('r-cut 충족')));
check('confirmed facts, the brand voice and recent publications feed the components',first.components.find(c=>c.key==='specificity').evidence.some(e=>e.includes('확정 사실 인용: 가격'))&&first.components.find(c=>c.key==='brand_fit').evidence.some(e=>e.includes('선호 표현 사용: 소스 가득'))&&first.components.find(c=>c.key==='novelty').evidence[0].includes('발행 p1'));
check('an AI artifact without disclosure is flagged',first.flags.includes('AI 생성 표시 없음'));
check('the rules version pins the scorer, the compliance lexicon and the rule versions',/^creative-score-v1\|lexicon:/.test(first.rulesVersion)&&first.rulesVersion.includes('r-cut@1')&&first.rulesVersion.endsWith('cal:none'));
check('no grading row is written because online_grading stays off',rows('grading').length===0);

// ── 4) 멱등 ──
let again=await css.scoreArtifactVersion(O,artifact);
check('the same content and rule set is not written again',again.written===false&&again.record.computedAt===first.computedAt&&rows('creative_score').length===1);
const hookRun=await grading.gradeSavedArtifacts(O,campaign,[{artifact,source:'role'}]);
check('re-running the save hook keeps one row with the same hash',rows('creative_score').length===1&&rows('creative_score')[0].inputHash===first.inputHash&&hookRun===0);
const v2={...artifact,version:2,content:CONTENT+'\n이 게시물의 문구는 AI의 도움을 받아 작성하고 담당자가 확인했습니다.'};
await save(O,'artifact','a1',v2,'c1');
const second=await css.scoreArtifactVersion(O,v2);
check('a new version writes a second row with its own id and a different hash',second.written===true&&second.record.id==='a1:2'&&second.record.inputHash!==first.inputHash&&rows('creative_score').length===2);
check('disclosure in the new version removes the flag and raises the score',!second.record.flags.includes('AI 생성 표시 없음')&&second.record.score>first.score);
await rule('r-new','‘포장’ 안내가 반응이 좋았다.');
const third=await css.scoreArtifactVersion(O,v2);
check('a changed rule set recomputes the same version in place',third.written===true&&third.record.id==='a1:2'&&JSON.stringify(third.record.ruleIds)==='["r-cut","r-new"]'&&third.record.inputHash!==second.record.inputHash&&rows('creative_score').length===2);
check('an unknown target is swallowed and logged, not thrown',await css.scoreSavedArtifacts(O,[{id:'nope',version:1}])===0&&errors.includes('creative_score_error'));
check('a stale version target is skipped',await css.scoreSavedArtifacts(O,[{id:'a1',version:1}])===0);

// ── 5) API(헤더 인증) ──
const as=who=>({'oai-authenticated-user-id':who});
const call=async res=>({status:res.status,body:await res.json().catch(()=>null)});
const G=(q,h=as(O))=>route.GET(new Request(`${ORIGIN}/api/creative-score${q}`,{headers:h})).then(call);
const P=(input,h=as(O))=>route.POST(new Request(`${ORIGIN}/api/creative-score`,{method:'POST',headers:{'content-type':'application/json',origin:ORIGIN,...h},body:JSON.stringify(input)})).then(call);
r=await G('?artifactId=a1');
check('GET returns the current version score with the switch state',r.status===200&&r.body.enabled===true&&r.body.artifactVersion===2&&r.body.score.id==='a1:2'&&r.body.score.sample.n===0);
check('GET for another owner is a 404',(await G('?artifactId=a1',as(X))).status===404);
check('GET for an unknown artifact is a 404 and without params a 400',(await G('?artifactId=zzz')).status===404&&(await G('')).status===400);
check('GET without identity is a 401',(await G('?artifactId=a1',{})).status===401);
r=await P({action:'recompute',artifactId:'a1'});
check('POST recompute returns the record and does not rewrite an unchanged input',r.status===200&&r.body.written===false&&r.body.record.id==='a1:2');
check('cross-origin writes are 403',(await P({action:'recompute',artifactId:'a1'},{...as(O),origin:'https://evil.test'})).status===403);
check('an unknown action is a 400',(await P({action:'nope'})).status===400);
check('POST recompute as another owner whose switch is off is a 409 before any artifact read',(await P({action:'recompute',artifactId:'a1'},as(X))).status===409);
await flags.setFeatureFlag(X,{flag:'creative_score',enabled:true},{id:X,email:null});
check('POST recompute as another owner with the switch on is a 404',(await P({action:'recompute',artifactId:'a1'},as(X))).status===404&&rows('creative_score',X).length===0);

// ── 6) 보정표 ──
check('calibrate rejects an empty observation list',(await P({action:'calibrate',brandId:'gb',channel:'Instagram',observations:[]})).status===400);
check('calibrate rejects clicks above impressions',(await P({action:'calibrate',brandId:'gb',channel:'Instagram',observations:[{artifactId:'a1',publishedAt:ago(10),impressions:10,clicks:11}]})).status===400);
check('calibrate rejects a non-integer count and a bad date',(await P({action:'calibrate',brandId:'gb',channel:'Instagram',observations:[{artifactId:'a1',publishedAt:ago(10),impressions:1.5,clicks:1}]})).status===400&&(await P({action:'calibrate',brandId:'gb',channel:'Instagram',observations:[{artifactId:'a1',publishedAt:'어제',impressions:10,clicks:1}]})).status===400);
check('calibrate for an unknown brand is a 404',(await P({action:'calibrate',brandId:'zz',channel:'Instagram',observations:[{artifactId:'a1',publishedAt:ago(10),impressions:10,clicks:1}]})).status===404);
// 12개 합성 작업물을 점수화하고 관측을 넘긴다(점수가 높을수록 CTR이 높은 합성 분포).
const texts=i=>i%3===0?`소스 가득한 단면 ${i}번. 오후 ${i%12+1}시 ${4000+i}원. 가상동 12 매장에서 포장 주문하세요. #가상분식 #포장 #간식`:i%3===1?`떡볶이 ${i}번 안내입니다. 매장에서 포장 주문하세요.`:`저희 가게 ${i}번 소식입니다 많이 찾아주세요 그리고 또 와주세요 할인 증정 무료`;
const observations=[];
for(let i=0;i<12;i++){const a={...artifact,id:'cal'+i,version:1,content:texts(i),origin:'manual'};await save(O,'artifact',a.id,a,'c1');const {record}=await css.scoreArtifactVersion(O,a);observations.push({artifactId:a.id,publishedAt:ago(10+i),impressions:1000,clicks:Math.round(record.score*2)})}
observations.push({artifactId:'unknown-art',publishedAt:ago(10),impressions:1000,clicks:10});
r=await P({action:'calibrate',brandId:'gb',channel:'Instagram',observations});
check('calibrate writes a directional table for 12 observations and lists observations without a score',r.status===200&&r.body.table.status==='directional'&&r.body.table.n===12&&r.body.table.bins.length===3&&r.body.table.label==='방향성(표본 부족)'&&JSON.stringify(r.body.missing)==='["unknown-art"]');
const tables=rows('creative_calibration');
check('the table is stored once per brand and channel under the brand',tables.length===1&&tables[0].rowId===`${O}:creative_calibration:gb:Instagram`&&tables[0].parentId==='gb'&&tables[0].monotonic===true);
r=await G('?brandId=gb&channel=Instagram');
check('GET returns the stored table and null for a channel without one',r.status===200&&r.body.calibration.n===12&&(await G('?brandId=gb&channel=YouTube')).body.calibration===null);
check('GET calibration for another owner brand is a 404',(await G('?brandId=gb&channel=Instagram',as('nobody'))).status===404);
const calibrated=await css.scoreArtifactVersion(O,v2);
check('scores computed after a table exists carry n and period and pin the table in the rules version',calibrated.written===true&&calibrated.record.sample.n===12&&/\d{4}-\d{2}-\d{2}~\d{4}-\d{2}-\d{2}/.test(calibrated.record.sample.window)&&calibrated.record.flags.some(f=>f.includes('방향성(표본 부족)'))&&/cal:creative-calibration-v1@/.test(calibrated.record.rulesVersion));
check('a directional table does not change the rule band',calibrated.record.band===third.record.band);

// ── 7) 등록: kind·기능표·삭제 문구 ──
const kinds=plain(registry.recordKinds),score=kinds.find(k=>k.kind==='creative_score'),cal=kinds.find(k=>k.kind==='creative_calibration');
check('creative_score is deleted with its campaign and creative_calibration is brand scoped',score?.parent==='campaign'&&score.campaignDeletion==='delete'&&JSON.stringify(score.links)==='["parent"]'&&cal?.parent==='brand'&&cal.campaignDeletion==='not_campaign_scoped');
check('campaign deletion reaches creative_score rows',plain(registry.campaignScopes('delete',O,'c1')).some(s=>s.kinds.includes('creative_score')));
check('the deletion dialog names creative scores',summary.deletionSummary({campaignId:'c1',version:1,deletable:true,blockedReason:null,deleted:{campaign:1,creative_score:3},retained:{},jobs:0,totals:{deleted:4,retained:0}}).deleted.includes('소재 예측 점수 3건'));
const row=f=>plain(status.featureRows({flags:f})).find(x=>x.key==='creative-score');
check('the settings table shows the feature with its switch state',row(undefined).status==='blocked'&&row([{flag:'creative_score',enabled:false}]).reason[0]==='소재 예측 점수 스위치 꺼짐'&&row([{flag:'creative_score',enabled:true}]).status==='available'&&row([{flag:'creative_score',enabled:true}]).label==='소재 예측 점수(추정)');
check('the switch description says estimate and no model call',/추정/.test(plain(flags.FEATURE_FLAGS).creative_score.description)&&/모델 호출 없음/.test(plain(flags.FEATURE_FLAGS).creative_score.description));

// ── 8) 세션 인증: 비로그인 401, 직원 403, 관리자 200 ──
env.AUTH_MODE='email';env.AUTH_ORIGIN=ORIGIN;
const signIn=(id,role,createdAt,ws)=>{const token=createHash('sha256').update(id).digest('hex');sql.prepare('INSERT INTO auth_users(id,email,workspace_owner,role,status,created_at) VALUES(?,?,?,?,?,?)').run(id,id+'@test.invalid',ws,role,'active',createdAt);sql.prepare('INSERT INTO auth_sessions VALUES(?,?,?,?)').run(createHash('sha256').update(token).digest('hex'),id,Date.now()+60000,Date.now());return {cookie:'__Host-collective_session='+token,origin:ORIGIN}};
const adminS=signIn('ws-admin','admin',2000,O),memberS=signIn('ws-member','member',500,O);
check('an anonymous write is a 401',(await P({action:'recompute',artifactId:'a1'},{origin:ORIGIN})).status===401);
check('a member write is a 403 and a member read is a 200',(await P({action:'recompute',artifactId:'a1'},memberS)).status===403&&(await G('?artifactId=a1',memberS)).status===200);
check('an admin write is a 200',(await P({action:'recompute',artifactId:'a1'},adminS)).status===200);
check('no external network call happened',fetchCalls===0);
console.error=originalError;
console.log(JSON.stringify({passed:passed.length,checks:passed},null,2));
