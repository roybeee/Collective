// B2 주간 다이제스트(lib/quality-digest.ts)와 로컬 스크립트(scripts/quality-digest.mjs) 회귀. 합성 레코드만 쓰고 LLM·네트워크 호출은 0이다(mocked: fetch 스텁).
// 고정 입력의 한국어 마크다운 스냅샷, '자동 판정 아님' 고지, 전주 대비, 표본 부족, 사람 메모 원문·이메일·계정 id 없음, 스크립트의 세 입력(응답 JSON·레코드 JSON·로컬 D1 sqlite)이 같은 마크다운을 내는지 확인한다.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,readFileSync,readdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {testRuntime} from './helpers/runtime.mjs';

let fetchCalls=0;
const rt=testRuntime(async()=>{fetchCalls++;throw new Error('외부 호출 금지')});
const qc=await rt.load('lib/quality-console.ts'),qk=await rt.load('lib/quality-kappa.ts'),qd=await rt.load('lib/quality-digest.ts');
const plain=v=>JSON.parse(JSON.stringify(v));
let passed=0;
const check=(name,ok)=>{assert.ok(ok,name);passed++};
const same=(name,actual,expected)=>{assert.equal(actual,expected,name);passed++};

const t=(day,hh='03')=>`2026-09-${String(day).padStart(2,'0')}T${hh}:00:00.000Z`;
const SECRET='고객 메모 원문 비밀 owner@example.com';
const art=(id,extra={})=>({id,campaignId:'c1',campaignVersion:1,role:'cmo',title:'전략 '+id,content:`## 목표\n평일 방문 초안 ${SECRET}`,status:'approved',version:1,origin:'ai',createdAt:t(22),skillVersion:'sv1',...extra});
let seq=0;
const dec=(targetId,decision,extra={})=>({id:'d'+String(++seq).padStart(2,'0'),targetKind:'artifact',targetId,version:1,role:'cmo',decision,reasonCodes:[],noteLength:SECRET.length,actor:{id:'actor-secret-1',role:'owner'},promptVersion:'sv1:aaaaaaaaaaaa',skillVersion:'sv1',outputContractVersion:null,campaignId:'c1',brandId:null,origin:'ai',reasonsVersion:'review-reasons-v1',createdAt:t(22),...extra});
const ledger=(id,extra={})=>({id:'hermes:'+id,provider:'hermes',providerRunId:id,model:'hermes-agent',inputTokens:null,outputTokens:null,totalTokens:1000,status:'completed',terminalReason:'completed',observedAt:t(22),domainOutcome:'completed',kind:'role',role:'cmo',jobId:'j-'+id,promptVersion:'sv1:aaaaaaaaaaaa',...extra});
const meeting=(id,status,createdAt)=>({id,campaignId:'c1',campaignVersion:1,agenda:SECRET,status,steps:[],createdAt,updatedAt:createdAt,model:'hermes-agent',stopRequested:false,artifactIds:[],invalidatedRoles:[],snapshot:{}});
const graded=(artifactId,status,graders,extra={})=>({id:artifactId+':1',artifactId,artifactVersion:1,campaignId:'c1',campaignVersion:1,role:'cmo',source:'role',jobId:'j-run-'+artifactId,meetingId:null,status,gradersVersion:'g1',graders,summary:null,compliance:null,context:{},durationMs:1,gradedAt:t(22),...extra});
const P=['p1','p2','p3','p4','p5'];
const input={
 artifacts:[art('a1'),art('a2'),art('a3',{complianceHold:{version:'v1',block:1,issues:[],checkedAt:t(23),notice:'법률 자문 아님'}}),art('a4',{status:'revision'}),art('a5',{status:'outdated'}),
  art('a6',{origin:'ai_edited',version:2,skillVersion:undefined,aiSource:{id:'a6',version:1,skillVersion:'sv1',outputContractVersion:null}}),art('c1',{role:'content'}),
  ...P.map(id=>art(id,{createdAt:t(15),...(id==='p5'?{status:'outdated'}:{})}))],
 decisions:[
  ...P.map(id=>dec(id,'approved',{createdAt:t(15)})),
  dec('qa1','revision',{role:'quality',criteria:[{criterion:'evidence',human:'revise',ai:'needs_data'}],createdAt:t(10)}),
  dec('a1','approved'),dec('a2','approved'),dec('a3','approved'),dec('a4','revision',{reasonCodes:['evidence','fact_error']}),dec('a5','revision',{reasonCodes:['evidence']}),
  dec('a6','approved',{version:2,origin:'ai_edited'}),dec('c1','approved',{role:'content'}),
  dec('brief-1','edited',{targetKind:'brief_suggestion',role:null,section:'kpi',reasonCodes:['economics'],origin:undefined,skillVersion:null}),
  dec('src-1','excluded',{targetKind:'source',role:null,reasonCodes:['brand'],campaignId:null,brandId:'oda',origin:undefined,skillVersion:null}),
  dec('qa1','approved',{role:'quality',version:2,criteria:[{criterion:'evidence',human:'pass',ai:'pass'}],createdAt:t(29)}),
 ],
 usage:[
  ...['a1','a2','a3','a4','a5','a6'].map(id=>ledger('run-'+id,{artifactId:id})),
  ledger('run-inv',{totalTokens:300,domainOutcome:'invalid_output'}),
  ledger('run-miss',{artifactId:'ai-gone',totalTokens:200}),
  ledger('resp-c1',{provider:'openai',model:'gpt-x',artifactId:'c1',role:'content',totalTokens:800}),
  ledger('run-brief',{kind:'brief',role:null,promptVersion:'inline:0123456789ab',totalTokens:5000}),
  ...P.map(id=>ledger('run-'+id,{artifactId:id,observedAt:t(15)})),
 ],
 meetings:[meeting('m1','completed',t(22)),meeting('m2','completed',t(22)),meeting('m3','failed',t(23)),...P.map(id=>meeting('n'+id,'completed',t(15)))],
 gradings:[graded('a1','graded',[{id:'fact_conflict',status:'fail',detail:SECRET}]),graded('a2','graded',[{id:'thin_section',status:'fail'},{id:'fact_conflict',status:'fail'}]),graded('c1','not_run',[],{role:'content',reason:'too_many_lines',lines:2400})],
 jobs:[],
};
const unit=(criterion,human,ai,i)=>({criterion,human,ai,artifactId:`${criterion}-${i}`,version:1,decisionId:'u'+i,actorId:'actor-secret-1',createdAt:t(22)});
const units=[...[['pass','pass',12],['revise','revise',6],['pass','revise',2],['revise','pass',2]].flatMap(([h,a,n],k)=>Array.from({length:n},(_,i)=>unit('evidence',h,a,`${k}-${i}`))),...[0,1,2].map(i=>unit('brand','pass','pass',i))];

const W39=qc.weekRange('2026-W39'),W38=qc.weekRange('2026-W38');
const summary=qc.consoleSummary(input,W39),previous=qc.consoleSummary(input,W38),kappa=qk.criterionKappa(units);
const expected=`# 품질 주간 다이제스트 · 2026-W39

- 기간: 2026-09-21 ~ 2026-09-27 (한국 시간)
- 비교: 전주 2026-W38 (2026-09-14 ~ 2026-09-20)
- 집계: quality-console-v1 · 사유 코드 review-reasons-v1

> **자동 판정 아님.** 기록된 사람 판정·사용량·채점 결과를 LLM 없이 센 숫자입니다. 작업물을 자동으로 합격·불합격 처리하지 않으며 최종 판단은 사람이 합니다.
> 표본 규칙: 비율은 표본 5건 미만이면 '표본 부족', κ는 기준별 사람 라벨 20건 미만이면 '보정 불가(표본 부족)'로 적습니다.

## 한눈에 보기

| 지표 | 이번 주 | 전주 | 변화 |
|---|---|---|---|
| AI 작업물(이전 버전 포함) | 7 | 5 | +2 |
| 1차 승인율 | 57.1% (4/7) | 100.0% (5/5) | -42.9%p |
| 수정 요청 | 2 | 0 | +2 |
| 폐기 토큰 | 2,300 | 1,000 | +1,300 |
| 미연결 토큰 | 200 | 0 | +200 |
| 회의 완주율 | 표본 부족 (n=3) | 100.0% (5/5) | 비교 불가 |
| 규제 보류 | 1 | 0 | +1 |
| 실패 채점기 | 3 | 0 | +3 |
| 채점 오류 | 0 | 0 | 0 |
| 채점 미실행 | 1 | 0 | +1 |

## 역할 × 스킬·프롬프트 버전 × 보고 모델

| 역할 | 스킬 버전 | 프롬프트 버전 | 보고 모델 | 작업물 | 1차 승인율 | 수정 요청 | 주요 사유 | 폐기 토큰 | 미연결 토큰 | 채점 완료·오류·미실행 | 실패 채점기 | 규제 보류 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 총괄 파트너 | sv1 | 코드 상수 | hermes-agent (실제 모델 미확인) | 6 | 50.0% (3/6) | 2 | 근거 2 · 사실 오류 1 | 2,300 | 200 | 2·0·0 | 3 | 1 |
| 콘텐츠 스튜디오 | sv1 | 코드 상수 | gpt-x | 1 | 표본 부족 (n=1) | 0 | — | 0 | 0 | 0·0·1 | 0 | 0 |

## 사람 판정 사유

판정 9건: 작업물 7 · 브리프 제안 1 · 자료 1 · 발행 0

| 사유 | 작업물 | 브리프 제안 | 자료 | 발행 | 합계 |
|---|---|---|---|---|---|
| 근거 | 2 | 0 | 0 | 0 | 2 |
| 브랜드·상품 | 0 | 0 | 1 | 0 | 1 |
| 예산·운영 | 0 | 1 | 0 | 0 | 1 |
| 사실 오류 | 1 | 0 | 0 | 0 | 1 |

## 폐기 토큰

쓰이지 않은 AI 작업물의 사용량입니다. 작업물·회의와 잇지 못한 사용량은 '미연결'로 따로 셉니다.

| 구분 | 이번 주 | 전주 |
|---|---|---|
| 재질문만 남김 | 0 | 0 |
| 수정 요청으로 대체 | 2,000 | 0 |
| 이전 버전(outdated) | 0 | 1,000 |
| 형식 오류(invalid_output) | 300 | 0 |
| 폐기 합계 | 2,300 | 1,000 |
| 미연결 | 200 | 0 |
| 토큰 미보고 실행(건) | 0 | 0 |
| 다른 실행 종류(브리프·조사·학습) | 5,000 | 0 |

## 회의 완주율

- 시작 3건 · 완료 2 · 실패 1 · 취소 0 · 진행 중 0
- 완주율(완료/시작): 표본 부족 (n=3)

## 판정 보정 κ (주 끝까지 누적한 사람 라벨)

사람의 기준별 판정(통과·수정)과 AI 품질 검수 checks 상태(통과·수정·자료 필요)의 일치도입니다. AI의 '자료 필요'는 사람 라벨에 없어 불일치로 셉니다. '묶은 κ'는 '자료 필요'를 '수정'으로 묶은 보조 값입니다. κ는 보정 참고값이며 자동 판정 기준이 아닙니다.

| 기준 | 라벨 n | 일치율 | κ | 해석 | 묶은 κ |
|---|---|---|---|---|---|
| 근거 | 22 | 81.8% | 0.61 | 상당한 일치 | 0.61 |
| 브랜드·상품 | 3 | 표본 부족 (n=3) | 보정 불가(표본 부족, 17건 더 필요) | — | — |
| 제작·실행 | 0 | 라벨 없음 | 보정 불가(라벨 없음, 20건 더 필요) | — | — |
| 예산·운영 | 0 | 라벨 없음 | 보정 불가(라벨 없음, 20건 더 필요) | — | — |
| 측정·실험 | 0 | 라벨 없음 | 보정 불가(라벨 없음, 20건 더 필요) | — | — |

## 자주 실패한 채점기

- fact_conflict 2 · thin_section 1

---

이 다이제스트는 작업물 본문·검토 메모 원문·이메일·계정 id를 담지 않습니다.
`;

// 1) 스냅샷(고정 입력)
const md=qd.weeklyDigest(summary,kappa,{week:'2026-W39',previous});
same('weekly digest markdown snapshot',md,expected);
check('the not-an-automatic-verdict notice is present',md.includes('**자동 판정 아님.**'));
check('no memo text, content, grader detail, agenda, email or actor id in the digest',!md.includes('비밀')&&!md.includes('@')&&!md.includes('actor-secret')&&!md.includes('평일 방문'));

// 2) 전주 없음·빈 주·표시 규칙
const alone=qd.weeklyDigest(summary,kappa,{week:'2026-W39'});
check('without a previous week the comparison line says so and tables have one value column',alone.includes('- 비교: 전주 자료 없음')&&alone.includes('| 지표 | 이번 주 |\n|---|---|\n| AI 작업물(이전 버전 포함) | 7 |')&&alone.includes('| 구분 | 이번 주 |\n|---|---|\n| 재질문만 남김 | 0 |'));
const empty=qc.consoleSummary({artifacts:[],decisions:[],usage:[],meetings:[],gradings:[]},W39);
const emptyMd=qd.weeklyDigest(empty,qk.criterionKappa([]),{week:'2026-W39',previous:empty});
check('an empty week says there is nothing to aggregate',emptyMd.includes('이번 주 집계할 AI 작업물·판정·사용량이 없습니다.')&&emptyMd.includes('이번 주 사유 코드가 붙은 판정이 없습니다.')&&emptyMd.includes('- 이번 주 실패한 채점기가 없습니다.'));
check('an empty week shows insufficient samples and no comparison',emptyMd.includes('| 1차 승인율 | 표본 부족 (n=0) | 표본 부족 (n=0) | 비교 불가 |')&&emptyMd.includes('| AI 작업물(이전 버전 포함) | 0 | 0 | 0 |'));
const piped=qc.consoleSummary({...input,usage:input.usage.map(u=>u.providerRunId==='run-a1'?{...u,model:'m|x\ny'}:u)},W39);
check('table cells escape pipes and newlines',qd.weeklyDigest(piped,kappa,{week:'2026-W39'}).includes('| m\\|x y |'));
const single=qk.criterionKappa(Array.from({length:20},(_,i)=>unit('execution','pass','pass',i)));
check('a single-category criterion is shown as undefined kappa',qd.weeklyDigest(summary,single,{week:'2026-W39'}).includes('| 제작·실행 | 20 | 100.0% | κ 정의 불가(한 범주만 있음) | — | — |'));
const missing=qk.criterionKappa([unit('evidence','pass',null,'n1'),unit('evidence','pass',null,'n2')]);
check('labels without an AI status are reported as excluded',qd.weeklyDigest(summary,missing,{week:'2026-W39'}).includes('- AI 검수 상태가 없던 라벨 2건은 빼고 셉니다.'));
// 원 범주 κ(2×3)가 기본이고 '자료 필요'를 '수정'으로 묶은 값은 보조 열이다(lib/quality-kappa.ts).
const withNd=qk.criterionKappa([...Array.from({length:10},(_,i)=>unit('execution','revise','revise',i)),...Array.from({length:10},(_,i)=>unit('execution','revise','needs_data',10+i))]);
check('raw kappa and the collapsed kappa are both shown with the needs-data count',qd.weeklyDigest(summary,withNd,{week:'2026-W39'}).includes('| 제작·실행 | 20 | 50.0% | 0.00 | 미미한 일치 | — |')&&qd.weeklyDigest(summary,withNd,{week:'2026-W39'}).includes("- AI가 '자료 필요'로 둔 라벨 10건이 있습니다."));
// 프롬프트 레지스트리(F3a) 실행 행은 프롬프트 버전으로 묶여 스킬 버전 칸이 비고, 코드 상수 행은 '코드 상수'다.
const REG='role.cmo@aaaaaaaaaaaa+channel.search@cccccccccccc';
const regSummary=qc.consoleSummary({...input,artifacts:[...input.artifacts,art('g1',{promptVersion:REG})],usage:[...input.usage,ledger('run-g1',{artifactId:'g1',model:'gpt-x',promptVersion:REG})]},W39);
check('a registry row shows its prompt version and no skill version',qd.weeklyDigest(regSummary,kappa,{week:'2026-W39'}).includes(`| 총괄 파트너 | — | ${REG} | gpt-x | 1 |`));
check('digest file name',qd.digestFileName('2026-W39')==='collective-quality-digest-2026-W39.md');

// 3) 주 단위 묶음(서버·스크립트 공용): 이번 주·전주 요약과 주 끝까지 누적한 κ
const payload=qd.weeklyPayload(input,'2026-W39');
check('payload summaries are the week and the previous week',JSON.stringify(payload.summary)===JSON.stringify(summary)&&JSON.stringify(payload.previous)===JSON.stringify(previous)&&payload.week==='2026-W39');
check('payload kappa counts labels up to the end of the week only (W37 yes, W40 no)',plain(payload.kappa).find(r=>r.criterion==='evidence').n===1);
check('digestMarkdown renders a payload the same way',qd.digestMarkdown(payload)===qd.weeklyDigest(payload.summary,payload.kappa,{week:'2026-W39',previous:payload.previous}));
check('an invalid week is rejected',(()=>{try{qd.weeklyPayload(input,'2026-W60');return false}catch(e){return /주/.test(e.message)}})());
// 서버는 기간 밖 판정을 읽지 않으므로 누적 κ 단위(B1 criterionUnits)를 따로 넘길 수 있다. 주 끝 이후 라벨은 여전히 뺀다.
const injected=qd.weeklyPayload(input,'2026-W39',[...units,{...unit('measurement','pass','pass','late'),createdAt:t(29)}]);
check('injected cumulative units are used instead of the loaded decisions, cut at the week end',plain(injected.kappa).find(r=>r.criterion==='evidence').n===22&&plain(injected.kappa).find(r=>r.criterion==='measurement').n===0);
// 캠페인 범위와 상한으로 잘린 조회는 머리말에 밝힌다.
const scoped=qd.weeklyDigest(summary,kappa,{week:'2026-W39',previous,campaignId:'c1',partial:{kinds:['usage','decisions'],limit:5000}});
check('campaign scope and a partial read are disclosed in the header',scoped.includes('- 범위: 캠페인 c1만')&&scoped.includes('> **일부만 집계.** 기록 종류 usage, decisions가 상한 5,000건을 넘어 일부만 셌습니다. 실제 숫자는 더 클 수 있습니다.'));
check('a payload carries scope and partial through digestMarkdown',qd.digestMarkdown({...payload,campaignId:'c1',partial:{kinds:['usage'],limit:5000}}).includes('- 범위: 캠페인 c1만'));

// 4) 로컬 스크립트: 응답 JSON·레코드 JSON·로컬 D1 sqlite → 같은 마크다운(표준 출력), 네트워크 없음
const dir=mkdtempSync(join(tmpdir(),'quality-digest-'));
const run=(...args)=>spawnSync(process.execPath,['scripts/quality-digest.mjs',...args],{encoding:'utf8',timeout:60000});
try{
 const responseFile=join(dir,'response.json');writeFileSync(responseFile,JSON.stringify({week:'2026-W39',summary,previous,kappa}));
 let r=run(responseFile);
 same('response JSON gives the snapshot on stdout',r.stdout,expected);
 check('response JSON run exits 0 without stderr',r.status===0&&r.stderr==='');
 // 응답 JSON은 이미 그 주로 계산한 요약이라 머리말의 주도 응답의 week를 쓴다. --week가 다르면 잘못 붙인 다이제스트가 되므로 멈춘다.
 r=run(responseFile,'--week','2026-W30');
 check('a --week different from the response JSON week is refused with exit 2',r.status===2&&r.stdout===''&&r.stderr.includes('2026-W30')&&r.stderr.includes('2026-W39')&&/다릅니다/.test(r.stderr));
 r=run(responseFile,'--week','2026-W39');
 same('a --week equal to the response JSON week prints the same digest',r.stdout,expected);
 const scopedFile=join(dir,'scoped.json');writeFileSync(scopedFile,JSON.stringify({week:'2026-W39',summary,previous,kappa,campaignId:'c1',partial:{kinds:['usage'],limit:5000},notice:'무시되는 안내'}));
 r=run(scopedFile);
 same('response JSON with campaign scope and a partial read keeps both in the header',r.stdout,qd.digestMarkdown({week:'2026-W39',summary,previous,kappa,campaignId:'c1',partial:{kinds:['usage'],limit:5000}}));
 const recordsFile=join(dir,'records.json');writeFileSync(recordsFile,JSON.stringify(input));
 const fromRecords=qd.digestMarkdown(payload);
 r=run(recordsFile,'--week','2026-W39');
 same('record JSON with --week gives the same markdown as the server payload',r.stdout,fromRecords);
 // 로컬 D1: 실제 마이그레이션으로 만든 sqlite 파일. 다른 워크스페이스 행은 섞이지 않아야 한다.
 const dbFile=join(dir,'local.sqlite'),db=new DatabaseSync(dbFile);
 for(const f of readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())db.exec(readFileSync('drizzle/'+f,'utf8'));
 const put=(owner,kind,id,data)=>db.prepare('INSERT INTO records(id,owner,kind,parent_id,data,updated_at) VALUES(?,?,?,?,?,?)').run(`${owner}:${kind}:${id}`,owner,kind,'',JSON.stringify(data),t(22));
 for(const owner of ['ws1','ws2']){
  for(const a of input.artifacts)put(owner,'artifact',a.id,a);
  for(const d of owner==='ws1'?input.decisions:input.decisions.slice(0,3))put(owner,'review_decision',d.id,d);
  for(const u of input.usage)put(owner,'provider_usage',u.id,owner==='ws1'?u:{...u,totalTokens:999999});
  for(const m of input.meetings)put(owner,'team_meeting',m.id,m);
  for(const g of input.gradings)put(owner,'grading',g.id,g);
 }
 db.prepare("INSERT INTO jobs(id,owner,campaign_id,role,status,provider_id,model,campaign_version,created_at,updated_at) VALUES('job-x','ws2','c1','cmo','completed','run-x','m',1,?,?)").run(t(22),t(22));
 db.close();
 r=run('--sqlite',dbFile,'--owner','ws1','--week','2026-W39');
 same('local D1 sqlite gives the same markdown for the chosen workspace only',r.stdout,fromRecords);
 r=run('--sqlite',dbFile,'--week','2026-W39');
 check('several workspaces without --owner is refused with exit 2',r.status===2&&/--owner/.test(r.stderr)&&r.stdout==='');
 r=run(recordsFile,'--week','2026-W99');
 check('an invalid week is refused with exit 2',r.status===2&&/주/.test(r.stderr));
 r=run(join(dir,'none.json'));
 check('a missing input file is refused with exit 2',r.status===2&&r.stdout==='');
 writeFileSync(join(dir,'bad.json'),JSON.stringify({hello:1}));
 r=run(join(dir,'bad.json'));
 check('an unknown JSON shape is refused with exit 2',r.status===2&&/형식/.test(r.stderr));
 r=run();
 check('no arguments prints usage with exit 2',r.status===2&&/사용법/.test(r.stderr));
}finally{rmSync(dir,{recursive:true,force:true})}
const source=readFileSync('scripts/quality-digest.mjs','utf8');
check('the script imports no network module and blocks fetch',!/from 'node:(?:https?|net|tls|dgram)'/.test(source)&&/globalThis\.fetch=/.test(source));
check('no external calls',fetchCalls===0);

console.log(JSON.stringify({passed}));
