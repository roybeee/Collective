// B3-2c 선호 쌍 평가 첨부 회귀: POST /api/learning playbook_attach_eval(대표만, 스위치 b3_playbook_signals)이 끝난 운영자 선호 쌍 평가 run을
// 그 run이 평가한 규칙 버전에 감사 기록(playbook_audit action attach_eval)으로만 붙인다. 규칙 버전·상태·만료는 바꾸지 않는다(ruleRef 계보 보존).
// 게이트는 기존 pairGate(lib/eval-stats.ts, GET /api/eval?pair=와 같은 판정)를 그대로 쓴다. performance_tested 부여는 여전히 409다(D6).
// 근거: mocked(메모리 SQLite, 이메일 세션, 합성 eval_run 레코드). 모델·외부 네트워크 호출은 0회다.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {testRuntime} from './helpers/runtime.mjs';

const external=[];
const rt=testRuntime(async url=>{external.push(String(url));throw new Error('이 스위트는 네트워크를 쓰지 않습니다: '+url)});
Object.assign(rt.env,{AUTH_MODE:'email',AUTH_ORIGIN:'https://app.test'});
const server=await rt.load('lib/server.ts'),route=await rt.load('app/api/learning/route.ts'),flags=await rt.load('lib/feature-flags.ts');
const loops=await rt.load('lib/improvement-loops.ts'),stats=await rt.load('lib/eval-stats.ts');
let passed=0;const check=(name,ok)=>{assert.ok(ok,name);passed++};
const DAY=86400000,ago=days=>new Date(Date.now()-days*DAY).toISOString();

// 1) 계정: 소유자(가장 먼저 만든 관리자)·관리자·직원 세션
const O='attach-ws',OWNER='a'.repeat(64),ADMIN='b'.repeat(64),MEMBER='c'.repeat(64);
[['att-owner','admin',OWNER],['att-admin','admin',ADMIN],['att-member','member',MEMBER]].forEach(([id,role,token],i)=>{
 rt.sql.prepare('INSERT INTO auth_users(id,email,workspace_owner,role,status,created_at) VALUES(?,?,?,?,?,?)').run(id,id+'@test.invalid',O,role,'active',Date.now()-100000+i);
 rt.sql.prepare('INSERT INTO auth_sessions VALUES(?,?,?,?)').run(createHash('sha256').update(token).digest('hex'),id,Date.now()+600000,Date.now());
});
const session=token=>({cookie:'__Host-collective_session='+token,origin:'https://app.test'});
const call=async(token,data)=>{const r=await route.POST(new Request('https://app.test/api/learning',{method:'POST',headers:{...session(token),'content-type':'application/json'},body:JSON.stringify(data)}));return {status:r.status,data:await r.json()}};
const get=async(token=OWNER)=>{const r=await route.GET(new Request('https://app.test/api/learning',{headers:session(token)}));return {status:r.status,data:await r.json()}};
const put=(kind,id,data,parent='')=>server.recordStatement(O,kind,id,data,parent).run();
const rule=id=>server.readRecord(O,'learning_rule',id);
const ruleRows=()=>JSON.stringify(rt.sql.prepare("SELECT id,data,updated_at FROM records WHERE owner=? AND kind='learning_rule' ORDER BY id").all(O));
const audits=()=>rt.sql.prepare("SELECT data FROM records WHERE owner=? AND kind='playbook_audit' ORDER BY rowid").all(O).map(r=>JSON.parse(r.data));
const attaches=()=>audits().filter(a=>a.action==='attach_eval');
const setSignals=enabled=>flags.setFeatureFlag(O,{flag:'b3_playbook_signals',enabled},{id:'att-owner',email:null});

// 2) 합성 데이터: oda 운영자 선호 규칙 R(초안 v1), ofd 규칙 F(초안 v1)
await server.seedBrands(O);
const R='playbook:att1',F='playbook:att2',G='playbook:att3';
const playbook=(id,brandId)=>({id,origin:'review',grade:'operator_preference',brandId,channel:'*',role:'content',experimentId:'',experimentVersion:0,caseId:'',title:'규칙 '+id,guidance:'첫 문장은 고객의 평일 상황으로 시작한다.',scope:'사람 판정 2건 인용',citations:['rd-1','rd-2'],feedback:{helpful:0,harmful:0},status:'draft',version:1,expiresAt:ago(-50),createdAt:ago(10),updatedAt:ago(10)});
await put('learning_rule',R,playbook(R,'oda'),'oda');
await put('learning_rule',F,playbook(F,'ofd'),'ofd');
await put('learning_rule',G,playbook(G,'oda'),'oda');
// 합성 쌍 평가 run: 케이스 3건(봉인 1건), 두 쪽 모두 completed·같은 모델·같은 게이트웨이. fail이면 봉인 케이스 on 쪽이 회귀한다.
const basis={operational:{hash:'op-hash'},eval:{hash:'eval-hash'}};
const results=fail=>['k1','k2','k3'].flatMap((caseId,i)=>['active','candidate'].map(variant=>({caseId,label:caseId,set:i===0?'sealed':'dev',role:'content',variant,status:'completed',model:'mock-eval-model',graders:[{id:'input_budget',status:'pass'},{id:'claims',status:fail&&variant==='candidate'&&i===0?'fail':'pass'}]})));
const preferencePair=(refs,brandId='oda')=>({kind:'operator_preferences',unit:'operator_preferences',brandId,activeVersionId:'off',candidateVersionId:refs.join('+'),rules:refs.map(ruleRef=>({ruleRef,role:'content',channel:'*',status:'draft'})),blockHash:'sha256:'+'0'.repeat(64),block:{note:'',rules:[]},skippedCases:0});
const evalRun=(id,{status='completed',variant='pair',pair=preferencePair([R+'@1']),fail=false,deleted}={})=>({id,label:'합성 '+id,variant,...(pair?{pair}:{}),set:null,caseIds:['k1','k2','k3'],tokenBudget:300000,usedTokens:9000,status,gatewaySnapshot:basis,gatewaySnapshotEnd:basis,createdBy:{id:'att-owner',email:null},createdAt:ago(1),updatedAt:ago(1),results:results(fail),...(deleted?{deleted}:{})});
const runs={
 pass1:evalRun('run-pass-v1-aaaaaaaa'),
 promptPair:evalRun('run-prompt-pair',{pair:{unit:'role.content',activeVersionId:'role.content@aaaaaaaaaaaa',candidateVersionId:'role.content@bbbbbbbbbbbb',activeSet:null,candidateSet:{instructions:'x'},skippedCases:0}}),
 running:evalRun('run-running',{status:'running'}),
 otherBrand:evalRun('run-other-brand',{pair:preferencePair([F+'@1'],'ofd')}),
 activeRun:evalRun('run-active',{variant:'active',pair:null}),
 deleted:evalRun('run-deleted',{deleted:{at:ago(0)}}),
 fail2:evalRun('run-fail-v2-bbbbbbbb',{pair:preferencePair([R+'@2']),fail:true}),
 pass2:evalRun('run-pass-v2-cccccccc',{pair:preferencePair([R+'@2',F+'@1'])}),
};
for(const r of Object.values(runs))await put('eval_run',r.id,r);
const attach=(token,runId,version,id=R)=>call(token,{action:'playbook_attach_eval',id,version,runId});

// 3) 스위치 꺼짐: 409, GET에 새 키 없음
const off=await attach(OWNER,runs.pass1.id,1);
check('switch off: playbook_attach_eval is 409',off.status===409&&/b3_playbook_signals/.test(off.data.error)&&attaches().length===0);
check('switch off: GET has no playbookEvals key',!('playbookEvals' in (await get()).data));
await setSignals(true);

// 4) 권한: 관리자·직원 403(스위치 켜짐)
check('admin and member 403',(await attach(ADMIN,runs.pass1.id,1)).status===403&&(await attach(MEMBER,runs.pass1.id,1)).status===403&&attaches().length===0);

// 5) 거절: 프롬프트 쌍 run·단독 run·진행 중·삭제·다른 브랜드·버전 불일치
const rulesBefore=ruleRows();
const rejected=async(runId,version,status,pattern)=>{const r=await attach(OWNER,runId,version);return r.status===status&&pattern.test(r.data.error)};
check('prompt pair runs are rejected (400)',await rejected(runs.promptPair.id,1,400,/프롬프트 쌍 평가/));
check('non-pair runs are rejected (400)',await rejected(runs.activeRun.id,1,400,/프롬프트 쌍 평가/));
check('running runs are rejected (409)',await rejected(runs.running.id,1,409,/끝나지 않/));
check('deleted runs are rejected (409)',await rejected(runs.deleted.id,1,409,/삭제/));
check('other brand runs are rejected (400)',await rejected(runs.otherBrand.id,1,400,/브랜드/));
check('a run that tested another version is rejected (409)',await rejected(runs.fail2.id,1,409,/v1/));
check('a stale rule version in the request is rejected (409)',(await attach(OWNER,runs.pass1.id,2)).status===409);
check('a run that did not test the rule is rejected (400)',(await attach(OWNER,runs.pass1.id,1,G)).status===400);
check('a rule of another brand cannot take the run (400)',await (async()=>{const r=await attach(OWNER,runs.pass1.id,1,F);return r.status===400&&/브랜드/.test(r.data.error)})());
check('rejections write nothing',attaches().length===0&&ruleRows()===rulesBefore);

// 6) 첨부: 대표가 끝난 선호 쌍 run을 그 run이 평가한 규칙 버전에 붙인다
const auditCount=audits().length;
const ok=await attach(OWNER,runs.pass1.id,1);
const expectedGate=stats.pairGate(runs.pass1);
check('owner attaches a completed preference pair run to the rule version it tested',ok.status===200&&ok.data.id===R&&ok.data.version===1&&ok.data.evalRunId===runs.pass1.id);
check('the attached gate is the existing pairGate verdict',ok.data.gate.passed===expectedGate.ok&&expectedGate.ok===true&&JSON.stringify(ok.data.gate.warnings)==='["small_sample"]'&&ok.data.gate.reasons.length===0&&ok.data.pairs===3&&ok.data.sealed===1);
const [a1]=attaches();
check('attach writes one audit',audits().length===auditCount+1&&attaches().length===1);
check('the audit records rule version, run id, gate, pair counts and actor only',a1.ruleId===R&&a1.brandId==='oda'&&a1.ruleVersion===1&&a1.evalRunId===runs.pass1.id&&JSON.stringify(a1.gate)==='{"passed":true,"reasons":[],"warnings":["small_sample"]}'&&a1.pairs===3&&a1.sealed===1&&JSON.stringify(a1.actor)==='{"id":"att-owner","role":"owner"}'&&a1.fromStatus==='draft'&&a1.toStatus==='draft'&&!/@test\.invalid|평일 상황/.test(JSON.stringify(a1)));
check('attach does not bump rule version or status',ruleRows()===rulesBefore&&(await rule(R)).version===1&&(await rule(R)).status==='draft');
check('attaching the same run to the same version twice is 409',(await attach(OWNER,runs.pass1.id,1)).status===409&&attaches().length===1);

// 7) 승인(v2) 뒤 v2를 평가한 run 두 건을 차례로 붙인다(실패 → 통과). 여러 규칙을 함께 평가한 run도 그 규칙 버전에 붙는다.
const act=await call(OWNER,{action:'playbook_activate',id:R,version:1});
check('activation still bumps the version as before',act.status===200&&(await rule(R)).version===2);
const fail=await attach(OWNER,runs.fail2.id,2);
check('a completed run with a failing gate is attached as a failure',fail.status===200&&fail.data.gate.passed===false&&fail.data.gate.reasons.includes('sealed_regression')&&fail.data.gate.reasons.includes('fewer_passes'));
const pass=await attach(OWNER,runs.pass2.id,2);
check('a run that tested several rules attaches to the requested rule version',pass.status===200&&pass.data.gate.passed===true);
check('the rule record is not touched by attaches',(await rule(R)).version===2&&(await rule(R)).status==='active');

// 8) GET: 대표·관리자에게 규칙 버전별 최신 게이트, 직원에게는 키 없음
const owner=await get(),admin=await get(ADMIN),member=await get(MEMBER);
const evals=owner.data.playbookEvals,v=n=>evals?.filter(e=>e.ruleId===R&&e.ruleVersion===n);
check('panel shows the latest gate per rule version',Array.isArray(evals)&&evals.length===2&&v(1).length===1&&v(1)[0].evalRunId===runs.pass1.id&&v(2).length===1&&v(2)[0].evalRunId===runs.pass2.id&&v(2)[0].passed===true);
check('each gate row carries run id, verdict, warnings and pair counts only',JSON.stringify(Object.keys(evals[0]))==='["ruleId","ruleVersion","evalRunId","passed","reasons","warnings","pairs","sealed","createdAt"]');
check('admin sees the gates, member does not',JSON.stringify(admin.data.playbookEvals)===JSON.stringify(evals)&&member.status===200&&!('playbookEvals' in member.data));
check('playbookEvals is appended after the B3-2a keys',JSON.stringify(Object.keys(owner.data).slice(-4))==='["correctionClusters","playbookFeedback","recurrence","playbookEvals"]');

// 9) 개선 루프: attach_eval 감사는 후보가 아니다(activate만)
const loopAudits=audits().map(a=>({id:a.id,ruleId:a.ruleId,brandId:a.brandId,action:a.action,ruleVersion:a.ruleVersion,createdAt:a.createdAt}));
const candidates=loops.loopCandidates({releaseEvents:[],playbookAudits:loopAudits,brandId:'oda',today:new Date().toISOString().slice(0,10)});
check('attach_eval audits are not improvement loop candidates',candidates.length===1&&candidates[0].source.auditId===audits().find(a=>a.action==='activate').id&&!candidates.some(c=>attaches().some(a=>c.source.auditId===a.id)));

// 10) performance_tested는 여전히 409(D6)
const graded=await call(OWNER,{action:'playbook_grade',id:R,version:2,grade:'performance_tested'});
const created=await call(OWNER,{action:'playbook_create',data:{brandId:'oda',text:'결론을 먼저 쓴다.',grade:'performance_tested',citations:['rd-1','rd-2']}});
check('performance_tested stays 409',graded.status===409&&created.status===409&&(await rule(R)).grade==='operator_preference');

// 11) 스위치를 다시 끄면 첨부 409, GET 키 없음(기록은 남는다)
await setSignals(false);
check('switch off again: attach 409 and no key',(await attach(OWNER,runs.pass2.id,2)).status===409&&!('playbookEvals' in (await get()).data)&&attaches().length===3);

// 12) 화면·문서(정적)
const src=p=>readFileSync(p,'utf8'),panel=src('app/learning-panel.tsx');
check('the panel lists the latest gate per rule version with run id prefix and warnings',panel.includes('playbookEvals')&&panel.includes('evalRunId.slice(0,8)')&&panel.includes('골든 on/off')&&panel.includes('비회귀'));
check('the panel has an owner-only attach button with a run id input',panel.includes("post('playbook_attach_eval'")&&panel.includes('평가 첨부')&&/modal==='playbookEval'/.test(panel));
const doc=src('docs/PLAYBOOK.ko.md'),security=src('docs/SECURITY-BOUNDARIES.ko.md');
check('docs describe B3-2c and the exit procedure',doc.includes('B3-2c')&&doc.includes('playbook_attach_eval')&&doc.includes('appliedRules'));
check('security boundaries list the attach permission',security.includes('playbook_attach_eval'));
check('no model call',external.length===0);
console.log(JSON.stringify({passed}));
