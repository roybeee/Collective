// 트랙 R R6d-2 모집 소재 실험 선별 경로 스위트(/api/franchise 작업 experiment_plan·experiment_result·experiment_cancel, GET 보기 experiments). 사례 번호 ER-*는 R6d-2 PR 본문과 같다.
// 확인: 역할·스위치(ER-A), 계획(기간 시작 전·자료 판 검사, ER-P), 결과(판 대조·기간·viral-stats 판정, ER-R), 취소(ER-C), 보기와 확인 층(ER-V), 감사·값 누출·외부 호출(ER-X).
// 근거: mocked(메모리 SQLite node:sqlite, 이메일 모드 세션 주입, 외부 fetch는 던지는 스텁, 시계 이동 Date). 운영 real 확인은 not_run(미게시).
import assert from 'node:assert/strict';
import {franchiseFixture,captureConsole,DISCLAIMER,sha64} from './helpers/franchise-fixture.mjs';

const logged=captureConsole();
const f=await franchiseFixture();
const {sql,env}=f;
env.AUTH_MODE='email';env.AUTH_ORIGIN='https://agency.test';
const passed=[];const check=(name,val)=>{assert.ok(val,name);passed.push(name)};
const setNow=ms=>f.clock.set(ms-Date.now());
setNow(Date.parse('2026-09-30T03:00:00Z')); // 2026-09-30 12:00 KST
const WS='er-owner';
const boss=f.signIn('er-boss','admin',1000,WS),member=f.signIn('er-member','member',3000,WS);
for(const b of ['fr-a','fr-b'])await f.brand(WS,b);
const post=(s,input)=>f.post(s,input),get=(s,q)=>f.get(s,q);
const audits=action=>sql.prepare("SELECT data FROM records WHERE kind='franchise_audit' AND json_extract(data,'$.action')=?").all(action).map(r=>JSON.parse(r.data));
const expRow=id=>{const r=sql.prepare("SELECT data FROM records WHERE kind='recruitment_experiment' AND json_extract(data,'$.id')=?").get(id);return r?JSON.parse(r.data):null};
const codesOf=r=>(r.body.reasons??[]).map(x=>x.code);
const HYP='질문형 헤드라인가상가설토큰이 클릭률을 높인다';

// ── 준비: 스위치·프로필(분기 A)·캠페인·승인 자료 판 2개(fr-a)·1개(fr-b)·자료 판 v2에 연결한 모집 코드 ──
check('setup: switch on',(await f.setFlag(boss,true)).status===200);
for(const b of ['fr-a','fr-b']){const r=await f.profile(boss,b,{storageLabels:['본사 문서함']},0);assert.equal(r.status,200,JSON.stringify(r.body))}
await f.server.recordStatement(WS,'campaign','ca-a',{id:'ca-a',brandId:'fr-a',title:'가상 모집 캠페인',status:'approved',objective:'franchise_recruitment',version:1,createdAt:'2026-09-01T00:00:00.000Z',updatedAt:'2026-09-01T00:00:00.000Z'},'fr-a').run();
const assetRow=(brand,id,version)=>{const body='가상자료본문 '+id+version;sql.prepare('INSERT INTO records(id,owner,kind,parent_id,data,updated_at) VALUES(?,?,?,?,?,?)').run(`${WS}:recruitment_asset:${id}:${version}`,WS,'recruitment_asset',brand,JSON.stringify({id,version,brandId:brand,campaignId:'ca-a',type:'portal_intro',body,bodyHash:sha64(body),factRefs:[],disclosureVersionId:null,status:'approved',approval:{by:'er-boss',role:'owner',at:'2026-09-20T00:00:00.000Z',bodyHash:sha64(body),checklist:{version:'c1',checked:[]}},placements:[],exports:[],review:{needed:false,reasons:[],at:null},createdAt:'2026-09-20T00:00:00.000Z',updatedAt:'2026-09-20T00:00:00.000Z'}),'2026-09-20T00:00:00.000Z')};
assetRow('fr-a','ra-1',1);assetRow('fr-a','ra-1',2);assetRow('fr-b','rb-1',1);
let r=await post(boss,{action:'code_issue',brandId:'fr-a',channel:'portal',label:'가상 포털 소개 B안',assetRef:{id:'ra-1',version:2},campaignId:'ca-a',validFrom:'2026-09-01'});
assert.equal(r.status,200,JSON.stringify(r.body));const CODE=r.body.result.code;
const PLAN={channel:'portal',metric:'ctr',variable:'헤드라인 첫 문장',hypothesis:HYP,control:{assetId:'ra-1',version:1},treatment:{assetId:'ra-1',version:2},minSample:100,minHours:72,minLift:10,period:{from:'2026-10-01',to:'2026-10-10'}};

// ════ ER-A 역할·스위치 ════
r=await post(member,{action:'experiment_plan',brandId:'fr-a',...PLAN});
check('ER-A1 members cannot plan an experiment (403)',r.status===403);
check('setup: switch off',(await f.setFlag(boss,false)).status===200);
r=await post(boss,{action:'experiment_plan',brandId:'fr-a',...PLAN});
check('ER-A2 planning needs the switch on (409)',r.status===409);
check('setup: switch on again',(await f.setFlag(boss,true)).status===200);

// ════ ER-P 계획 ════
r=await post(boss,{action:'experiment_plan',brandId:'fr-a',...PLAN,period:{from:'2026-09-29',to:'2026-10-10'}});
check('ER-P1 a period that already started is refused (409 period_started)',r.status===409&&JSON.stringify(codesOf(r))==='["period_started"]'&&r.body.disclaimer===DISCLAIMER);
r=await post(boss,{action:'experiment_plan',brandId:'fr-a',...PLAN,treatment:{assetId:'rb-1',version:1}});
check('ER-P2 an asset version from another brand is refused (400)',r.status===400&&codesOf(r).includes('asset_other_brand'));
r=await post(boss,{action:'experiment_plan',brandId:'fr-a',...PLAN,minSample:50});
check('ER-P3 a per-arm minimum below 100 is refused (400)',r.status===400&&codesOf(r).includes('plan_invalid'));
const RID='rq-er-plan-1';
r=await post(boss,{action:'experiment_plan',brandId:'fr-a',requestId:RID,...PLAN});
check('ER-P4 a valid plan is stored before the period starts',r.status===200&&typeof r.body.result.experimentId==='string'&&r.body.disclaimer===DISCLAIMER);
const EX=r.body.result.experimentId,row=expRow(EX);
check('ER-P4 the row keeps the plan, status planned, version 1 and no lead values',row.status==='planned'&&row.version===1&&row.plan.hypothesis===HYP&&row.plan.minSample===100&&row.looks.length===0);
r=await post(boss,{action:'experiment_plan',brandId:'fr-a',requestId:RID,...PLAN});
check('ER-P5 the same request replays the same experiment',r.status===200&&r.body.result.experimentId===EX&&Number(sql.prepare("SELECT COUNT(*) n FROM records WHERE kind='recruitment_experiment'").get().n)===1);
r=await post(boss,{action:'experiment_plan',brandId:'fr-a',requestId:RID,...PLAN,minLift:20});
check('ER-P6 the same request number with a different plan is refused (409)',r.status===409);

// ════ ER-R 결과 ════
const RESULT={control:{denominator:5000,numerator:100},treatment:{denominator:5000,numerator:150},comparable:true,observedUntil:'2026-10-01'};
r=await post(boss,{action:'experiment_result',brandId:'fr-a',experimentId:EX,version:1,...RESULT});
check('ER-R1 no result before the period starts',r.status===400||r.status===409);
setNow(Date.parse('2026-10-05T03:00:00Z')); // 10-05 12:00 KST: 기간 안
const coded=[],fixturePhones=[];
const createFixtureLead=extra=>{const phone=f.nextPhone();fixturePhones.push(phone);return f.createLead(boss,'fr-a',{...extra,contact:{name:'이테스트',phone}})};
for(let i=0;i<3;i++){const c=await createFixtureLead({codes:[CODE]});assert.equal(c.status,200,JSON.stringify(c.body));coded.push(c.body.result.leadId)}
// 적격 판정(대표 결정 35) 1건: 적격 기준을 저장하고 코드 귀속 리드 하나를 적격으로 기록한다.
r=await f.profile(boss,'fr-a',{storageLabels:['본사 문서함'],eligibility:{budgetBands:['100m_150m'],regions:['서울 강남구'],timingBands:['within_3m']}},1);
assert.equal(r.status,200,JSON.stringify(r.body));
r=await post(boss,{action:'qualify_lead',brandId:'fr-a',leadId:coded[0],version:f.leadRow(coded[0]).version,verdict:'qualified',reason:'criteria_met',criteriaVersion:1});
assert.equal(r.status,200,JSON.stringify(r.body));
await createFixtureLead({});
r=await post(boss,{action:'experiment_result',brandId:'fr-a',experimentId:EX,version:9,...RESULT,observedUntil:'2026-10-04'});
check('ER-R2 a stale version is refused (409)',r.status===409);
r=await post(member,{action:'experiment_result',brandId:'fr-a',experimentId:EX,version:1,...RESULT,observedUntil:'2026-10-04'});
check('ER-R3 members cannot enter results (403)',r.status===403);
r=await post(boss,{action:'experiment_result',brandId:'fr-a',experimentId:EX,version:1,...RESULT,observedUntil:'2026-10-06'});
check('ER-R4 an observed date after today is refused (400)',r.status===400&&codesOf(r).includes('observed_invalid'));
r=await post(boss,{action:'experiment_result',brandId:'fr-a',experimentId:EX,version:1,...RESULT,observedUntil:'2026-10-04'});
check('ER-R5 a complete result is judged with viral-stats and labelled platform-reported',r.status===200&&r.body.result.assessment==='promising'&&r.body.look.stats.recommendation==='adopt'&&r.body.note==='플랫폼 보고, 원장 리드 아님'&&r.body.disclaimer===DISCLAIMER);
check('ER-R5 the row moves to evaluated with one look',expRow(EX).status==='evaluated'&&expRow(EX).version===2&&expRow(EX).looks.length===1);
r=await post(boss,{action:'experiment_result',brandId:'fr-a',experimentId:EX,version:2,...RESULT,observedUntil:'2026-10-05'});
check('ER-R6 looking again warns about repeated looks and withholds adoption',r.status===200&&r.body.look.stats.warning.codes.includes('repeated_looks')&&r.body.look.stats.recommendation!=='adopt');
r=await post(boss,{action:'experiment_result',brandId:'fr-b',experimentId:EX,version:3,...RESULT,observedUntil:'2026-10-04'});
check('ER-R7 another brand cannot reach the experiment (404)',r.status===404);

// ════ ER-V 보기와 확인 층 ════
r=await get(member,'view=experiments&brandId=fr-a');
const v=r.body,e=v.experiments?.[0];
check('ER-V1 members can read experiments with the notes first and the disclaimer',r.status===200&&v.notes[0].includes('플랫폼 보고, 원장 리드 아님')&&v.disclaimer===DISCLAIMER&&v.minSample===100);
check('ER-V2 the latest look and plan are shown',e.id===EX&&e.status==='evaluated'&&e.looks===2&&e.latest.assessment.status==='promising'&&e.channelLabel==='창업 포털');
check('ER-V3 ledger confirm counts code-attributed leads per arm, rate hidden under 20',e.ledger.treatment.leads===3&&e.ledger.control.leads===0&&e.ledger.treatment.attendedPerLead===null&&e.ledger.treatment.qualified===1&&e.ledger.control.qualified===0&&e.ledger.treatment.qualifiedPerLead===null);
check('ER-V4 approved asset versions are offered for new plans',v.assets.length===2&&v.assets.every(a=>a.type==='portal_intro'));
const leadRows=f.rows('franchise_lead');
const hasLeadLeak=value=>{const text=JSON.stringify(value);return leadRows.some(l=>text.includes(l.id)||text.includes(l.systemCode))||text.includes('이테스트')||fixturePhones.some(phone=>text.includes(phone)||text.includes(phone.replaceAll('-','')))};
check('ER-V5 no lead id, system code, name or phone in the view',!hasLeadLeak(v));
check('ER-V5 a valid experiment UUID containing 010- is not a phone leak',!hasLeadLeak({...v,experiments:[{...e,id:'rx-12345010-1234-4123-8123-123456789abc'}]}));
check('ER-V5 actual fixture phone values are rejected with or without separators',fixturePhones.every(phone=>hasLeadLeak({...v,leakedPhone:phone})&&hasLeadLeak({...v,leakedPhone:phone.replaceAll('-','')})));
r=await get(member,'view=experiments&brandId=fr-b');
check('ER-V6 the other brand sees none of these experiments',r.status===200&&r.body.experiments.length===0);

// ════ ER-C 취소 ════
r=await post(boss,{action:'experiment_cancel',brandId:'fr-a',experimentId:EX,version:3});
check('ER-C1 an owner can cancel',r.status===200&&expRow(EX).status==='cancelled');
r=await post(boss,{action:'experiment_result',brandId:'fr-a',experimentId:EX,version:4,...RESULT,observedUntil:'2026-10-04'});
check('ER-C2 no result after cancel (409 experiment_closed)',r.status===409&&codesOf(r).includes('experiment_closed'));
r=await post(boss,{action:'experiment_cancel',brandId:'fr-a',experimentId:EX,version:4});
check('ER-C3 cancelling twice is refused (409)',r.status===409);
r=await post(boss,{action:'experiment_plan',brandId:'fr-a',...PLAN,period:{from:'2026-10-06',to:'2026-10-12'}});
assert.equal(r.status,200,JSON.stringify(r.body));const EX2=r.body.result.experimentId;
check('setup: switch off',(await f.setFlag(boss,false)).status===200);
r=await post(boss,{action:'experiment_cancel',brandId:'fr-a',experimentId:EX2,version:1});
check('ER-C4 cancel still works with the switch off (protective)',r.status===200);
r=await post(boss,{action:'experiment_result',brandId:'fr-a',experimentId:EX2,version:2,...RESULT,observedUntil:'2026-10-06'});
check('ER-C5 results need the switch on (409)',r.status===409);

// ════ ER-X 감사·값 누출·외부 호출 ════
const all=[...audits('experiment_plan'),...audits('experiment_result'),...audits('experiment_cancel')];
check('ER-X1 every action leaves an audit row with the experiment id',audits('experiment_plan').length===2&&audits('experiment_result').length===2&&audits('experiment_cancel').length===2&&all.every(a=>a.recordId&&a.recordId.startsWith('rx-')));
check('ER-X2 audit rows carry no hypothesis or numbers',all.every(a=>!JSON.stringify(a).includes('가상가설토큰')&&!JSON.stringify(a).includes('5000')));
check('ER-X3 no external or model call',f.calls.length===0);
check('ER-X4 no unexpected server error logged',!logged.some(l=>/franchise_request_failed/.test(l)));

console.log(JSON.stringify({passed:passed.length}));
