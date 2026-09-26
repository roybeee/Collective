// A3-3a 작업물 제안 실험 회귀. 승인된 콘텐츠 작업물의 카피 팩 제안 실험(copyPack.experiments[index])을 바이럴 실험 초안으로 옮기는
// create_experiment_from_artifact 경로의 조건(승인·현재 브리프·팩 판·팩 오류·index)·멱등·사례 없는 실험의 결과 판정·규칙 채택·캠페인 삭제 동결을 확인한다.
// 근거: mocked(메모리 SQLite, 헤더 세션, 합성 데이터). 모델·외부 호출 0회(fetch는 호출되면 실패한다).
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {testRuntime} from './helpers/runtime.mjs';

const external=[];
const rt=testRuntime(async url=>{external.push(String(url));throw new Error('외부 호출 금지: '+url)});
Object.assign(rt.env,{AUTH_MODE:'email',AUTH_ORIGIN:'https://app.test'});
const server=await rt.load('lib/server.ts'),route=await rt.load('app/api/learning/route.ts'),action=await rt.load('app/api/action/route.ts'),view=await rt.load('lib/artifact-experiment.ts');
const plain=value=>JSON.parse(JSON.stringify(value));
let passed=0;const check=(name,ok)=>{assert.ok(ok,name);passed++};

// 1) 계정: 소유자(가장 먼저 만든 관리자)·직원 세션
const O='workspace',OWNER='c'.repeat(64),MEMBER='b'.repeat(64);
[['owner-user','admin',OWNER],['member-user','member',MEMBER]].forEach(([id,role,token],i)=>{
 rt.sql.prepare('INSERT INTO auth_users(id,email,workspace_owner,role,status,created_at) VALUES(?,?,?,?,?,?)').run(id,id+'@test.invalid',O,role,'active',Date.now()-100000+i);
 rt.sql.prepare('INSERT INTO auth_sessions VALUES(?,?,?,?)').run(createHash('sha256').update(token).digest('hex'),id,Date.now()+600000,Date.now());
});
const post=async(mod,data,token=OWNER)=>{const r=await mod.POST(new Request('https://app.test/api/x',{method:'POST',headers:{cookie:'__Host-collective_session='+token,origin:'https://app.test','content-type':'application/json'},body:JSON.stringify(data)}));return {status:r.status,data:await r.json()}};
const learn=(data,token)=>post(route,data,token);
const get=async()=>{const r=await route.GET(new Request('https://app.test/api/learning',{headers:{cookie:'__Host-collective_session='+OWNER}}));return {status:r.status,data:await r.json()}};
const rows=kind=>rt.sql.prepare('SELECT data FROM records WHERE owner=? AND kind=? ORDER BY rowid').all(O,kind).map(r=>JSON.parse(r.data));
const put=(kind,id,data,parent='')=>server.recordStatement(O,kind,id,data,parent).run();
const read=(kind,id)=>{const row=rt.sql.prepare('SELECT data FROM records WHERE id=?').get(`${O}:${kind}:${id}`);return row?JSON.parse(row.data):null};

// 2) 합성 브랜드·캠페인·작업물. 실제 고객·매장 정보가 아니다. 카피 문안에는 표지 문자열(HOOK-/BODY-/CTA-)을 넣어 동결 요약에 남는지 본다.
const now=new Date().toISOString();
await server.seedBrands(O);
const campaign=(id,brandId,version=1)=>({id,brandId,title:'합성 캠페인 '+id,goal:'평일 방문을 늘린다.',audience:'가상 주민(가설)',channels:'Instagram',stores:'',products:'',budget:null,startDate:'',endDate:'',constraints:'',sources:'',status:'draft',version,createdAt:now,updatedAt:now});
for(const [id,brand,version] of [['c-oda','oda',1],['c-new','oda',2],['c-del','oda',1]])await put('campaign',id,campaign(id,brand,version));
const variant=(id,hook,body)=>({id,angle:`각도 ${id}`,hook,body,cta:`CTA-${id} 네이버 플레이스에서 길찾기`,...(id==='B'?{needsCheck:['가격']}:{})});
const pack={version:'copy-pack-v2',channels:[{channel:'Instagram 피드',purpose:'첫 방문 유도',destination:'네이버 플레이스',variants:[variant('A','HOOK-A 퇴근길 20분, 포장 떡볶이 한 컵','BODY-A 가상동 12에서 바로 포장해 가세요.'),variant('B','HOOK-B 오늘 저녁은 떡볶이 한 컵으로','BODY-B 매장 앞 픽업 선반에서 이름만 확인하고 가져가면 됩니다.'),variant('C','HOOK-C 동네 분식이 새로 문을 열었어요','BODY-C 가상동 주민분들께 먼저 인사드립니다.')]}],shortform:null,
 experiments:[{title:'훅 비교',channel:'Instagram 피드',hypothesis:'시간 절약 훅이 클릭을 늘린다',variable:'훅',control:'A',treatment:'B',fixed:'본문·CTA·게시 시각',metric:'click_rate'},{title:'본문 비교',channel:'Instagram 피드',hypothesis:'인사형 본문이 공유를 늘린다',variable:'본문',control:'A',treatment:'C',fixed:'',metric:'share_rate'}]};
const artifact=(id,campaignId,over={})=>({id,campaignId,campaignVersion:1,role:'content',title:'콘텐츠 작업물 '+id,content:'## 채널별 카피 안\n\n본문이 있는 작업물입니다.',status:'approved',version:1,origin:'ai',createdAt:now,copyPack:pack,copyPackArtifactVersion:1,...over});
const seeds=[
 ['ai-good','c-oda',{}],
 ['ai-review','c-oda',{status:'review'}],
 ['ai-oldbrief','c-new',{campaignVersion:1}],
 ['ai-stale','c-oda',{version:2}],
 ['ai-errors','c-oda',{copyPackIssues:[{level:'error',code:'variants_too_few',message:'안이 모자랍니다.'}]}],
 ['ai-warn','c-oda',{copyPackIssues:[{level:'warn',code:'brief_channel_missing',message:'브리프 채널 누락'}]}],
 ['ai-nopack','c-oda',{copyPack:undefined,copyPackArtifactVersion:undefined}],
 ['ai-growth','c-oda',{role:'growth'}],
 ['ai-del','c-del',{}],
];
for(const [id,cid,over] of seeds)await put('artifact',id,plain(artifact(id,cid,over)),cid);
const plan={minSample:200,minHours:72,minLift:10,verifyChannel:'Instagram'};
const fromArtifact=(artifactId,over={},token)=>learn({action:'create_experiment_from_artifact',campaignId:read('artifact',artifactId).campaignId,artifactId,artifactVersion:read('artifact',artifactId).version,index:0,data:plan,...over},token);

// 3) 조건이 모두 맞으면 draft 바이럴 실험이 생긴다(source 기록, 사례 없음, 실제 문안, 팩 지표).
let r=await fromArtifact('ai-good');
check('experiment from approved copy pack creates a draft viral experiment with artifact source',r.status===200&&!!r.data.id);
const exp=read('viral_experiment',r.data.id);
check('the draft keeps source kind/artifact/version/index and empty case and analysis ids',exp.status==='draft'&&JSON.stringify(exp.source)===JSON.stringify({kind:'artifact',artifactId:'ai-good',artifactVersion:1,index:0})&&exp.caseId===''&&exp.analysisId===''&&!('caseChannel' in exp));
check('control and treatment carry the actual copy (hook, body, CTA) of the pack arms, not bare ids',exp.control.includes('HOOK-A')&&exp.control.includes('BODY-A')&&exp.control.includes('CTA-A')&&exp.treatment.includes('HOOK-B')&&exp.treatment.includes('BODY-B')&&exp.treatment.includes('CTA-B')&&exp.control!=='A'&&exp.treatment!=='B');
check('needsCheck items are shown with the arm copy',exp.treatment.includes('가격')&&!exp.control.includes('확인 필요'));
check('metric, hypothesis, variable and title come from the pack; fixed becomes the conditions',exp.metric==='click_rate'&&exp.hypothesis==='시간 절약 훅이 클릭을 늘린다'&&exp.variable==='훅'&&exp.title==='훅 비교'&&exp.conditions.includes('본문·CTA·게시 시각'));
check('plan fields follow the request and the campaign/brand come from the artifact',exp.minSample===200&&exp.minHours===72&&exp.minLift===10&&exp.channel==='Instagram'&&exp.campaignId==='c-oda'&&exp.brandId==='oda'&&exp.version===1);
check('an event records the new experiment on the campaign',rows('event').some(e=>e.campaignId==='c-oda'&&e.message?.includes('훅 비교')||JSON.stringify(e).includes('훅 비교')));

// 4) 멱등: 같은 작업물·버전·index 재요청은 기존 실험을 돌려준다.
const before=rows('viral_experiment').length;
r=await fromArtifact('ai-good');
check('same artifact/version/index is idempotent',r.status===200&&r.data.id===exp.id&&r.data.duplicate===true&&rows('viral_experiment').length===before);
r=await fromArtifact('ai-good',{index:1,data:{...plan,title:'직접 붙인 이름',conditions:''}});
const second=read('viral_experiment',r.data.id);
check('another index makes another experiment with an optional title and default conditions',r.status===200&&r.data.id!==exp.id&&second.title==='직접 붙인 이름'&&second.metric==='share_rate'&&second.treatment.includes('HOOK-C')&&second.conditions.length>0);
check('verify channel defaults to the pack channel resolved to a learning channel',(await fromArtifact('ai-warn',{data:{minSample:100,minHours:1,minLift:5}})).status===200&&rows('viral_experiment').at(-1).channel==='Instagram');
check('warn-only pack issues do not block',rows('viral_experiment').at(-1).source.artifactId==='ai-warn');

// 5) 거절: 미승인·낡은 브리프·낡은 팩·팩 오류·팩 없음·index 범위 밖은 409, 새 실험 없음.
const count=()=>rows('viral_experiment').length,n=count();
const refused=async(label,res,status=409)=>check(label,res.status===status&&count()===n);
await refused('unapproved artifact is 409',await fromArtifact('ai-review'));
await refused('outdated brief (artifact of an older campaign version) is 409',await fromArtifact('ai-oldbrief'));
await refused('stale pack (copyPackArtifactVersion differs from the artifact version) is 409',await fromArtifact('ai-stale'));
await refused('pack with error issues is 409',await fromArtifact('ai-errors'));
await refused('missing pack is 409',await fromArtifact('ai-nopack'));
await refused('index out of range is 409',await fromArtifact('ai-good',{index:2}));
await refused('non-content artifact is 409',await fromArtifact('ai-growth'));
await refused('requested artifact version differing from the stored one is 409',await fromArtifact('ai-good',{artifactVersion:2}));
await refused('negative or fractional index is 400',await fromArtifact('ai-good',{index:-1}),400);
await refused('campaign that does not own the artifact is 400',await learn({action:'create_experiment_from_artifact',campaignId:'c-new',artifactId:'ai-good',artifactVersion:1,index:0,data:plan}),400);
await refused('unknown artifact is 404',await learn({action:'create_experiment_from_artifact',campaignId:'c-oda',artifactId:'ai-missing',artifactVersion:1,index:0,data:plan}),404);
await refused('existing plan validation is reused (min sample below 100 is 400)',await fromArtifact('ai-warn',{index:1,data:{...plan,minSample:50}}),400);
await refused('existing plan validation is reused (observation over 2160 hours is 400)',await fromArtifact('ai-warn',{index:1,data:{...plan,minHours:3000}}),400);
await refused('existing plan validation is reused (non-positive lift is 400)',await fromArtifact('ai-warn',{index:1,data:{...plan,minLift:0}}),400);
await refused('verify channel must be a learning channel',await fromArtifact('ai-warn',{index:1,data:{...plan,verifyChannel:'예약 · 포장 · 배달'}}),400);
// 직원 권한 규칙은 사례 기반 create_experiment와 같다(직원도 실험 초안을 만든다).
r=await fromArtifact('ai-warn',{index:1},MEMBER);
check('staff can create an artifact experiment like create_experiment',r.status===200&&read('viral_experiment',r.data.id).source.index===1);
check('no model or external call was made',external.length===0);

// 6) 사례 없는 실험: 화면 목록(GET)·시작·결과 판정·규칙 채택(caseId '')·30일 시험 규칙.
let g=await get();
check('experiment without case renders in GET /api/learning',g.status===200&&g.data.experiments.some(e=>e.id===exp.id&&e.source?.kind==='artifact'));
check('origin label reads as an artifact-suggested experiment and case experiments get none',view.experimentOrigin(exp).includes('작업물 제안 실험')&&view.experimentOrigin(exp).includes('v1')&&view.experimentOrigin(exp).includes('제안 1')&&view.experimentOrigin({...exp,source:undefined})==='');
check('start works for an experiment without a case',(await learn({action:'start_experiment',id:exp.id,version:1})).status===200);
rt.sql.prepare("UPDATE records SET data=json_set(data,'$.startedAt',?) WHERE id=?").run(new Date(Date.now()-80*3600000).toISOString(),`${O}:viral_experiment:${exp.id}`);
r=await learn({action:'save_results',id:exp.id,version:2,data:{observedUntil:new Date().toISOString(),control:{denominator:2000,numerator:20,source:'합성 대조 조회'},treatment:{denominator:2000,numerator:40,source:'합성 실험 조회'},comparable:true,notes:'합성 측정'}});
check('results are judged for an experiment without a case',r.status===200&&r.data.assessment.status==='promising'&&!!r.data.stats);
r=await learn({action:'adopt_rule',id:exp.id,version:3,guidance:'시간 절약 훅을 시험 적용한다(관찰 결과).'});
const rule=read('learning_rule',r.data.id);
check('experiment without case adopts a rule (adopt_rule with caseId empty)',r.status===200&&rule.caseId===''&&rule.experimentId===exp.id&&rule.origin==='viral'&&rule.channel==='Instagram'&&rule.caseChannel==='Instagram');
check('the adopted rule is a 30-day trial rule',Math.abs(Date.parse(rule.expiresAt)-Date.now()-30*86400000)<60000&&rule.status==='active'&&rule.sourceAssessment.lift===100);
g=await get();
check('GET still renders with the caseless rule and experiment',g.status===200&&g.data.rules.some(x=>x.id===rule.id)&&g.data.experiments.find(e=>e.id===exp.id).stats);

// 7) 캠페인 삭제: 사례 없는 실험의 규칙은 retired 보존, 동결 요약에는 source.kind만 남고 카피 본문은 없다.
r=await fromArtifact('ai-del');const delExp=r.data.id;
await learn({action:'start_experiment',id:delExp,version:1});
rt.sql.prepare("UPDATE records SET data=json_set(data,'$.startedAt',?) WHERE id=?").run(new Date(Date.now()-80*3600000).toISOString(),`${O}:viral_experiment:${delExp}`);
await learn({action:'save_results',id:delExp,version:2,data:{observedUntil:new Date().toISOString(),control:{denominator:1000,numerator:10,source:'합성'},treatment:{denominator:1000,numerator:20,source:'합성'},comparable:true,notes:'합성'}});
const delRule=(await learn({action:'adopt_rule',id:delExp,version:3,guidance:'삭제 확인용 합성 규칙'})).data.id;
r=await post(action,{action:'delete_campaign',id:'c-del',version:1,confirmed:true});
const summary=read('viral_experiment_summary',delExp),kept=read('learning_rule',delRule);
check('campaign with an artifact experiment rule can be deleted',r.status===200&&!read('campaign','c-del')&&!read('viral_experiment',delExp));
check('campaign deletion freezes source kind without copy text',!!summary&&JSON.stringify(summary.source)===JSON.stringify({kind:'artifact'})&&!/HOOK-|BODY-|CTA-/.test(JSON.stringify(summary))&&!('artifactId' in summary)&&!('control' in summary)&&!('treatment' in summary));
check('the retained rule is retired with the deletion mark and no copy text',kept.status==='retired'&&!!kept.sourceCampaignDeleted&&!/HOOK-|BODY-|CTA-/.test(JSON.stringify(kept)));

// 8) 기존 사례 기반 실험 경로는 그대로다(저장 키와 순서, source 없음).
await put('viral_case','case-1',{id:'case-1',brandId:'oda',channel:'YouTube'},'oda');await put('viral_analysis','an-1',{id:'an-1',brandId:'oda',caseId:'case-1'},'case-1');
r=await learn({action:'create_experiment',analysisId:'an-1',campaignId:'c-oda',data:{title:'사례 실험',hypothesis:'가설',variable:'첫 장면',control:'대조',treatment:'실험',metric:'share_rate',minSample:100,minHours:1,minLift:10,conditions:'같은 조건'}});
const caseExp=read('viral_experiment',r.data.id);
check('existing case-based experiment path unchanged',r.status===200&&Object.keys(caseExp).join()==='id,brandId,campaignId,caseId,analysisId,title,channel,caseChannel,hypothesis,variable,control,treatment,metric,minSample,minHours,minLift,conditions,version,status,startedAt,createdAt,updatedAt,result,assessment'&&caseExp.caseId==='case-1'&&caseExp.channel==='Instagram'&&caseExp.caseChannel==='YouTube');
check('case-based plan validation is unchanged',(await learn({action:'create_experiment',analysisId:'an-1',campaignId:'c-oda',data:{title:'x',hypothesis:'h',variable:'v',control:'c',treatment:'t',metric:'share_rate',minSample:99,minHours:1,minLift:10,conditions:'c'}})).status===400);

// 9) 화면: 작업물 제안 실험 목록과 만들기 버튼이 같은 판정·action을 쓴다.
const options=view.artifactExperimentOptions(rows('artifact'),rows('campaign'),'oda');
check('options list content pack experiments of the brand with the server problem text',options.some(o=>o.artifactId==='ai-good'&&o.index===0&&o.problem===null&&o.experimentId===exp.id)&&options.some(o=>o.artifactId==='ai-stale'&&o.problem)&&!options.some(o=>o.artifactId==='ai-growth'||o.artifactId==='ai-nopack'));
const panel=readFileSync('app/learning-panel.tsx','utf8');
check('learning panel lists artifact experiments and posts create_experiment_from_artifact',panel.includes('artifactExperimentOptions')&&panel.includes("'create_experiment_from_artifact'")&&panel.includes('experimentOrigin'));

console.log(JSON.stringify({passed}));
