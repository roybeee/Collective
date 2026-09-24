// lib/context-replay.ts(B5 맥락 정책 리플레이 통계·비교표) 회귀 테스트. 모델·네트워크 호출 없음(합성 fixture, passed · mocked).
// 원문 텍스트가 통계·비교표에 들어가지 않는지(키 이름·수치·개수만), 토큰 추정이 lib/token-budget.ts와 같은지 확인한다.
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {testRuntime} from './helpers/runtime.mjs';
let networkCalls=0;
const rt=testRuntime(async()=>{networkCalls++;throw new Error('network disabled')});
// vm 컨텍스트의 배열·객체는 프로토타입이 달라 deepStrictEqual이 실패하므로 JSON으로 옮겨 비교한다.
const plain=v=>JSON.parse(JSON.stringify(v)),replayModule=await rt.load('lib/context-replay.ts'),{comparisonMarkdown}=replayModule;
const breakdown=(...a)=>plain(replayModule.breakdown(...a)),replay=(...a)=>plain(replayModule.replay(...a));
const {estimateInputTokens}=await rt.load('lib/token-budget.ts'),{buildRoleInput}=await rt.load('lib/role-instruction.ts'),{artifactRef,discussionRef}=await rt.load('lib/meetings.ts'),agency=await rt.load('lib/agency.ts'),{aiBudget}=agency,roles=plain(agency.roles);
const {INPUT_TOKEN_CAP}=await rt.load('lib/graders/ledger.ts'),HANDOFF=plain((await rt.load('lib/context-policies.ts')).HANDOFF_SECTIONS??{}),{roleOutputContract}=await rt.load('lib/role-output.ts');
const passed=[];
const check=(name,fn)=>{fn();passed.push(name)};
const files=readdirSync('tests/fixtures').filter(f=>/^role-submission-[0-9a-f]{7}\.json$/.test(f));
const fixture=JSON.parse(readFileSync('tests/fixtures/'+files[0],'utf8'));
const byName=name=>fixture.cases.find(c=>c.name===name);

check('estimateInputTokens is reused from token-budget',()=>assert.match(readFileSync('lib/context-replay.ts','utf8'),/import \{[^}]*estimateInputTokens[^}]*\} from '\.\/token-budget'/));
// breakdown: 최상위 키별 `"키":값` 조각의 문자 수·추정 토큰. 조각 합 + 쉼표 + 중괄호 = 입력 길이.
const cmo=byName('cmo').submission.input,bd=breakdown(cmo),cx=JSON.parse(cmo);
check('breakdown totals match the token-budget estimate',()=>{assert.equal(bd.totalChars,cmo.length);assert.equal(bd.estimatedTokens,estimateInputTokens(cmo));assert.equal(bd.json,true)});
check('breakdown lists every top-level key in input order',()=>assert.deepEqual(Object.keys(bd.byKey),Object.keys(cx)));
check('breakdown key fragments are exact',()=>{for(const [k,v] of Object.entries(cx)){const f=JSON.stringify(k)+':'+JSON.stringify(v);assert.deepEqual(bd.byKey[k],{chars:f.length,tokens:estimateInputTokens(f)})}});
check('breakdown fragments plus separators equal the input length',()=>assert.equal(Object.values(bd.byKey).reduce((n,v)=>n+v.chars,0)+Object.keys(cx).length+1,cmo.length));
check('breakdown of non-JSON input has no keys',()=>assert.deepEqual(breakdown('평문 입력'),{totalChars:5,estimatedTokens:estimateInputTokens('평문 입력'),byKey:{},archive:{},json:false}));
// brandArchive 하위 키 분해(loop-10 대상인 아카이브 비중을 나눠 본다). 조각 합 + 쉼표 + 중괄호 = brandArchive 값의 길이.
check('breakdown splits brandArchive into its keys',()=>{
 const a=bd.archive,x=cx.brandArchive,part=k=>JSON.stringify(k)+':'+JSON.stringify(x[k]);
 assert.deepEqual(Object.keys(a),Object.keys(x));assert.equal(Object.values(a).reduce((n,v)=>n+v.chars,0)+Object.keys(x).length+1,JSON.stringify(x).length);
 for(const k of Object.keys(x))assert.deepEqual(a[k],{chars:part(k).length,tokens:estimateInputTokens(part(k))});
});

// 회의 단계 합성 입력(lib/meeting-execution.ts context()와 같은 키·순서, tests/context-policies.test.mjs가 키 집합·순서 드리프트를 검사한다).
const base=byName('quality').context,roleInput=JSON.parse(byName('quality').submission.input);
const revision={role:'content',title:'콘텐츠 개선본',content:'## 게시 카피 3종과 용도·CTA\n\n개선한 합성 카피 초안입니다. 자료 필요: 가격 확인.\n\n## 수정 요청 반영 위치\n\n첫 장면 반론을 반영했습니다.',changes:'첫 장면 반론 반영'};
const contribution=id=>({position:`합성 ${id} 입장입니다.`,evidence:'합성 근거입니다.',challenge:'합성 반론입니다.',proposal:'합성 제안입니다.',respondsTo:[]});
const synthesisOutput={decisions:'합성 결정입니다.',disagreements:'없음',questions:'없음',tasks:[{role:'content',instruction:'카피 개선',reason:'회의 근거',acceptance:'게시 카피 절에서 대조안 포함'}]};
const previousMeeting={id:'m0',agenda:'이전 합성 안건',decisions:synthesisOutput,quality:{verdict:'revise',summary:'합성 요약',findings:'합성 발견'},discussion:roles.slice(0,2).map(r=>({id:`m0:discussion:${r.id}`,role:r.id,output:contribution(r.id)}))};
function meetingInput(phase,role,{task}={}){
 const arts=base.previous,revised=phase==='quality'?[revision]:[],first=Math.min(...revised.map(r=>roles.findIndex(x=>x.id===r.role)));
 const candidates=[...arts.filter(a=>roles.findIndex(r=>r.id===a.role)<first),...revised.map(r=>({role:r.role,...r}))];
 const spoken=phase==='discussion'?roles.slice(0,roles.findIndex(r=>r.id===role)):roles;
 return JSON.stringify({skillVersion:roleInput.skillVersion,channelPractice:roleInput.channelPractice,agenda:'합성 안건: 약점을 검토한다.',role,phase,allowedRespondsTo:[],correction:undefined,brand:roleInput.brand,evidence:roleInput.evidence,brandArchive:roleInput.brandArchive,campaign:{...base.campaign,...aiBudget(base.campaign)},trialLearning:[],recordedMetrics:[],previousMeeting,
  originalArtifacts:arts.map(a=>({ref:artifactRef(a),...a,content:a.content.slice(0,8000),excerpt:a.content.length>8000})),discussion:spoken.map(r=>({ref:discussionRef(r.id),role:r.id,...contribution(r.id)})),synthesis:['revision','quality'].includes(phase)?synthesisOutput:undefined,completedRevisions:revised.map(r=>({role:r.role,...r})),task,
  ...(phase==='quality'?{candidateArtifacts:candidates.map(a=>({ref:artifactRef(a),...a})),invalidatedRoles:['growth','data']}:{})});
}
const meetings={discussion:meetingInput('discussion','insight'),synthesis:meetingInput('synthesis','cmo'),revision:meetingInput('revision','content',{task:{role:'content',instruction:'카피 개선',reason:'회의 근거',acceptance:'대조안 포함'}}),quality:meetingInput('quality','quality')};
const source=(id,category)=>({id,title:'합성 자료 '+id,category,url:'https://example.com/'+id,observedAt:'2026-01-01T00:00:00.000Z',scope:'브랜드',content:'합성 자료 본문 '+id,excerpt:false,version:1});
const observation=id=>({id,brandId:'synthetic-bunsik',channel:'instagram',account:'합성 계정',periodStart:'2026-01-01',periodEnd:'2026-01-07',observedAt:'2026-01-08T00:00:00.000Z',source:'합성',scope:'organic',method:'manual',definition:'합성 정의',values:{posts:3},version:1,createdAt:'2026-01-08T00:00:00.000Z'});
const archive={...byName('insight').context.archive,confirmedSources:[source('s-product','product'),source('s-channel','channel'),source('s-performance','performance'),source('s-customer','customer'),source('s-odd','unexpected')],observations:[observation('o-1'),observation('o-2')]};

const roleSubs=fixture.cases.map(c=>({kind:'role',role:c.role,input:c.submission.input}));
const meetingSubs=Object.entries(meetings).map(([stage,input])=>({kind:'meeting',role:JSON.parse(input).role,stage,input}));
const text={kind:'role',role:'cmo',input:'평문 입력입니다. 원문 조각이 표에 나오면 안 됩니다.'};
const insightP4={kind:'role',role:'insight',input:buildRoleInput({...byName('insight').context,archive})};
const all=[...roleSubs,...meetingSubs,text,insightP4,{kind:'brief',input:'{}'}];
const summary=replay(all),group=key=>summary.groups.find(g=>g.key===key);
const round1=n=>Math.round(n*10)/10,round4=n=>Math.round(n*1e4)/1e4,est=estimateInputTokens;

check('summary counts valid, skipped and non-JSON submissions',()=>{assert.equal(summary.version,'context-replay-v1');assert.equal(summary.modelCalls,0);assert.equal(summary.total,22);assert.equal(summary.skipped,1);assert.equal(summary.nonJson,1)});
check('groups are ordered by kind, role and meeting stage',()=>assert.deepEqual(summary.groups.map(g=>g.key),['all','role','role:cmo','role:insight','role:strategy','role:creative','role:content','role:growth','role:data','role:quality','meeting','meeting:discussion','meeting:synthesis','meeting:revision','meeting:quality']));
check('group sample sizes',()=>assert.deepEqual(['all','role','meeting','role:cmo','role:insight','role:quality','meeting:quality'].map(k=>group(k).n),[22,18,4,3,4,4,1]));
check('group labels use role and stage names',()=>{assert.equal(group('role:cmo').label,'역할 · 총괄 파트너 (cmo)');assert.equal(group('meeting:quality').label,'회의 · 품질 재검토');assert.equal(group('all').label,'전체')});
check('P0 keeps everything and saves nothing',()=>{const p=group('all').policies.P0;assert.deepEqual([p.n,p.notApplicable,p.savedTokens,p.savingRate,p.facts.rate,p.sources.rate,p.sections.rate,p.missingSections,p.body.rate,p.overCap],[22,0,0,0,1,1,1,0,1,0])});
check('P0 mean and median input tokens',()=>{const t=[cmo,byName('openai-cmo').submission.input,text.input].map(est),p=group('role:cmo').policies.P0,sorted=[...t].sort((a,b)=>a-b);assert.equal(p.meanTokens,round1(t.reduce((a,b)=>a+b)/3));assert.equal(p.medianTokens,sorted[1])});
check('median of an even sample is the midpoint',()=>{const t=['insight','insight-revision','openai-insight'].map(n=>est(byName(n).submission.input)).concat(est(insightP4.input)).sort((a,b)=>a-b);assert.equal(group('role:insight').policies.P0.medianTokens,round1((t[1]+t[2])/2))});
const strip=(input,keys)=>{const x=JSON.parse(input);return JSON.stringify({...x,campaign:Object.fromEntries(Object.entries(x.campaign).filter(([k])=>!keys.includes(k)))})};
check('P1 saving equals the independently stripped campaign',()=>{
 const inputs=[cmo,byName('openai-cmo').submission.input],p=group('role:cmo').policies.P1,baseline=inputs.reduce((n,i)=>n+est(i),0),after=inputs.reduce((n,i)=>n+est(strip(i,['status','createdAt','updatedAt'])),0);
 assert.deepEqual([p.n,p.notApplicable,p.baselineTokens,p.savedTokens,p.savingRate],[2,1,baseline,baseline-after,round4((baseline-after)/baseline)]);
});
check('P3 is not applicable to role submissions',()=>{const p=group('role').policies.P3;assert.deepEqual([p.n,p.notApplicable,p.meanTokens,p.medianTokens,p.savingRate],[0,18,null,null,null])});
const digestDropped=JSON.parse(meetings.discussion).originalArtifacts.reduce((n,a)=>n+roleOutputContract(a.role).sections.length-1-(HANDOFF[a.role]?1:0),0);
check('P3 discussion keeps every title and drops the bodies outside summary and handoff',()=>{const p=group('meeting:discussion').policies.P3;assert.equal(digestDropped,14);assert.deepEqual([p.n,p.sections.rate,p.missingSections],[1,1,digestDropped]);assert.ok(p.savedTokens>0&&p.body.rate<1)});
check('P3 is not applicable to the synthesis and revision stages',()=>{for(const k of ['meeting:synthesis','meeting:revision'])assert.deepEqual([group(k).policies.P3.n,group(k).policies.P3.notApplicable,group(k).policies.P3.savedTokens],[0,1,0])});
check('P3 quality drops superseded original sections only',()=>{const p=group('meeting:quality').policies.P3;assert.deepEqual([p.sections.kept,p.sections.total,p.missingSections],[14,26,12]);assert.equal(p.facts.rate,1)});
check('P4 source preservation counts dropped categories',()=>{const p=group('role:insight').policies.P4;assert.deepEqual([p.sources.kept,p.sources.total,p.sources.rate,p.facts.rate],[6,10,0.6,1])});
check('P2 budgets truncated prior artifacts without losing titles',()=>{const p=group('role:quality').policies.P2;assert.ok(p.savedTokens>0);assert.deepEqual([p.sections.rate,p.missingSections],[1,0])});
// P2 절단 보정: 저장 입력의 작업물이 이미 앞부분 절단(excerpt:true)됐으면 이 리플레이의 P2 절약은 상한이다. 역할 previous의 originalLength로 운영 P2 절약의 추정 하한을 낸다.
const missingOf=names=>names.reduce((n,name)=>n+JSON.parse(byName(name).submission.input).previous.filter(p=>p.excerpt).reduce((m,p)=>m+p.originalLength-p.content.length,0),0);
check('P2 on truncated inputs reports the saving as an upper bound',()=>{
 const g=group('role'),t=g.p2Truncation;
 assert.deepEqual([t.submissions,t.missingChars,t.unknownLength],[2,missingOf(['strategy-truncated','quality-truncated']),0]);assert.equal(t.minSavedTokens,g.policies.P2.savedTokens-t.missingChars);assert.ok(group("role:strategy").p2Truncation.minSavedTokens<0,"운영 P2는 입력을 늘릴 수 있다");
 assert.deepEqual(group('meeting').p2Truncation,{submissions:0,missingChars:0,unknownLength:0,minSavedTokens:group('meeting').policies.P2.savedTokens});
});
check('a truncated meeting original without its length leaves the lower bound unknown',()=>{
 const x=JSON.parse(meetings.discussion),input=JSON.stringify({...x,originalArtifacts:x.originalArtifacts.map((a,i)=>i?a:{...a,content:'## 합성 절\n\n'+'가'.repeat(7990),excerpt:true})});
 assert.deepEqual(replay([{kind:'meeting',stage:'discussion',input}]).groups[0].p2Truncation,{submissions:1,missingChars:0,unknownLength:1,minSavedTokens:null});
});
// 섹션 보존 지표: 제목 없는 작업물·머리말도 한 섹션으로 센다. 문서 제목 H1이 있어도 계약 제목을 모두 센다. 본문 보존은 작업물 content 문자 합의 비율이다.
const withPrevious=content=>{const x=JSON.parse(byName('insight').submission.input);return {kind:'role',role:'insight',input:JSON.stringify({...x,previous:x.previous.map((p,i)=>i?p:{...p,content,originalLength:content.length})})}};
const untitled='합성 제목 없는 본문 문장입니다. '.repeat(400),h1Doc='# 문서 제목\n\n'+['목표','작업표','추가 자료 요청'].map(t=>`## ${t}\n\n`+'합성 섹션 본문입니다. '.repeat(250)).join('\n\n');
check('an untitled prior artifact counts as one section and loses body under P2',()=>{const p=replay([withPrevious(untitled)]).groups[0].policies.P2;assert.deepEqual([p.sections.kept,p.sections.total,p.missingSections],[1,1,0]);assert.ok(p.body.rate<1&&p.savedTokens>0)});
check('every contract title under a document H1 is counted and kept by P2',()=>{const p=replay([withPrevious(h1Doc)]).groups[0].policies;assert.deepEqual([p.P0.sections.total,p.P2.sections.kept,p.P2.missingSections,p.P0.body.rate],[4,4,0,1]);assert.ok(p.P2.body.rate<1)});
// 입력 상한(loop-10): 정책 적용 뒤 추정 토큰이 grade 모드 input_budget 상한(lib/graders/ledger.ts INPUT_TOKEN_CAP)을 넘는 제출 수.
check('context replay reuses the grader input cap',()=>assert.match(readFileSync('lib/context-replay.ts','utf8'),/import \{[^}]*INPUT_TOKEN_CAP[^}]*\} from '\.\/graders\/ledger'/));
const big={kind:'role',role:'cmo',input:(()=>{const x=JSON.parse(cmo);return JSON.stringify({...x,campaign:{...x.campaign,goal:'합성 긴 목표 '.repeat(Math.ceil(INPUT_TOKEN_CAP/6)+10)}})})()};
check('submissions over the input token cap are counted per policy',()=>{const p=replay([big,{kind:'role',role:'cmo',input:cmo}]).groups[0].policies;assert.ok(est(big.input)>INPUT_TOKEN_CAP&&est(cmo)<INPUT_TOKEN_CAP);assert.deepEqual(['P0','P1','P2','P3','P4'].map(id=>p[id].overCap),[1,1,1,0,1])});
check('the fixture sample has no submission over the cap',()=>assert.ok(Object.values(group('all').policies).every(p=>p.overCap===0)));
check('groups carry the brandArchive key breakdown',()=>{const k=group('all').archiveKeys.map(x=>x.key);for(const key of ['confirmedSources','observations','storeMarketing','confirmedDiagnosis'])assert.ok(k.includes(key),key);assert.ok(group('all').archiveKeys.every(x=>x.share>0&&x.share<1))});
const excerpts=subs=>subs.reduce((n,s)=>{try{const x=JSON.parse(s.input);return n+['previous','originalArtifacts','candidateArtifacts'].flatMap(k=>Array.isArray(x[k])?x[k]:[]).filter(a=>a.excerpt===true).length}catch{return n}},0);
check('truncated prior artifacts are counted per group',()=>{assert.equal(group('all').truncatedArtifacts,excerpts(all.slice(0,-1)));assert.equal(group('role:strategy').truncatedArtifacts,excerpts(roleSubs.filter(s=>s.role==='strategy')))});
check('omitted paths are aggregated without indices',()=>{const o=group('all').policies.P1.omitted.find(x=>x.path==='campaign.status'),withStatus=all.slice(0,-1).filter(s=>{try{return JSON.parse(s.input).campaign?.status!==undefined}catch{return false}}).length;assert.equal(o.count,withStatus);assert.ok(group('all').policies.P1.omitted.some(x=>x.path==='originalArtifacts[].createdAt'))});
check('non-JSON input counts as not applicable beyond P0',()=>{const g=group('role:cmo');assert.equal(g.nonJson,1);for(const id of ['P1','P2','P4'])assert.equal(g.policies[id].notApplicable,1)});
check('top-level key breakdown per group',()=>{const k=group('meeting').keys.find(x=>x.key==='originalArtifacts');assert.ok(k.meanChars>0&&k.share>0&&k.share<1);assert.ok(group('all').keys.every((x,i,a)=>i===0||a[i-1].meanChars>=x.meanChars))});
check('replay is deterministic',()=>assert.deepEqual(replay(all),summary));

// 원문 미포함: 입력의 20자 이상 문자열 조각이 통계 JSON·비교표 어디에도 없다.
const generatedAt='2026-09-24T12:34:56.789Z',markdown=comparisonMarkdown(summary,{generatedAt});
const strings=[],walk=v=>{if(typeof v==='string'){if(v.length>=20)strings.push(v)}else if(v&&typeof v==='object')Object.values(v).forEach(walk)};
for(const s of all)try{walk(JSON.parse(s.input))}catch{strings.push(s.input)}
check('fixture has long text to look for',()=>assert.ok(strings.length>50));
check('no input text fragment reaches the summary or the table',()=>{for(const str of strings)for(const frag of [str.slice(0,20),str.slice(-20)])for(const out of [JSON.stringify(summary),markdown])assert.ok(!out.includes(frag),`원문 조각이 출력에 있습니다(${frag.length}자)`)});
const odd={kind:'role',role:'x|y 역할',input:JSON.stringify({'evil|키 텍스트':'값',task:{role:'cmo'}})},oddSummary=replay([odd]),oddMarkdown=comparisonMarkdown(oddSummary);
check('odd keys and roles are not echoed',()=>{for(const out of [JSON.stringify(oddSummary),oddMarkdown])assert.ok(!out.includes('evil')&&!out.includes('x|y'));assert.ok(oddMarkdown.includes('(기타 키)'));assert.deepEqual(oddSummary.groups.map(g=>g.key),['all','role','role:unknown'])});
check('an invalid generatedAt is not echoed',()=>assert.ok(!comparisonMarkdown(summary,{generatedAt:'<b>원문</b>'}).includes('<b>')));
check('markdown names every policy and group',()=>{for(const id of ['P0','P1','P2','P3','P4'])assert.ok(markdown.includes(`| ${id} |`));for(const g of summary.groups)assert.ok(markdown.includes(g.label));assert.ok(markdown.includes(generatedAt))});
check('markdown flags the P2 saving on truncated inputs as an upper bound',()=>{assert.match(markdown,/## P2 절단 입력 보정/);assert.match(markdown,/P2 절약은 상한/);assert.match(markdown,/\| 역할 전체 \| 2 \| /)});
check('markdown has the cap column and the brandArchive key table',()=>{assert.ok(markdown.includes(`상한 초과(>${INPUT_TOKEN_CAP.toLocaleString('en-US')})`));assert.match(markdown,/## brandArchive 하위 키 분해/)});

// 비교표 스냅샷: 역할 1건(cmo)·회의 발언 1건·비JSON 1건.
const small=replay([{kind:'role',role:'cmo',input:cmo},{kind:'meeting',role:'insight',stage:'discussion',input:meetings.discussion},text]);
const EXPECTED=readFileSync(new URL(import.meta.url),'utf8').split('/* SNAPSHOT\n')[1].split('\nSNAPSHOT */')[0];
check('comparison markdown snapshot',()=>assert.equal(comparisonMarkdown(small,{generatedAt:'2026-09-24T00:00:00.000Z'}),EXPECTED));
check('no network calls',()=>assert.equal(networkCalls,0));
console.log(JSON.stringify({passed:passed.length}));
/* SNAPSHOT
# 맥락 정책 리플레이 비교표

- 생성: 2026-09-24T00:00:00.000Z
- 표본: 제출 3건(역할 2건 · 회의 1건). JSON이 아닌 입력 1건은 P0만 계산했다.
- 근거: 저장된 제출의 input만 읽기 전용으로 다시 계산했다. 모델 호출 0회. 서버 평가(쌍 비교)는 not_run(대표 승인 필요).
- 토큰: lib/token-budget.ts estimateInputTokens 추정치(과대 쪽). 지시문(instructions)과 HERMES 에이전트 자체 지시·도구 호출은 빠져 실제 사용량보다 작다.
- 원문은 싣지 않는다. 키 이름·경로·수치·개수만 있다.

## 정책

| 정책 | 이름 | 내용 |
|---|---|---|
| P0 | 현행 | 저장된 입력 그대로(항등). 비교 기준이다. |
| P1 | 메타 제거 | campaign의 draftMeta·status·derivedStatus·statusReason·createdAt·updatedAt·budgetConfirmedAt·id와 회의 작업물의 campaignId·status·origin·createdAt·factRefs·outputContractVersion·skillVersion을 뺀다. |
| P2 | 섹션별 예산 | 지금 앞부분 절단을 받는 선행 작업물(역할 previous, 회의 originalArtifacts)을 앞부분 절단 대신 섹션당 2000자로 줄여 모든 섹션 제목을 남긴다. 품질 검수 대상(candidateArtifacts)과 개선본(completedRevisions)은 줄이지 않는다. |
| P3 | 회의 단계별 축소 | 의견 교환은 원본 작업물마다 요약(첫 본문 섹션, 1000자)과 역할 계약의 인계 섹션(1500자)만 본문을 남긴다. 품질 재검토는 candidateArtifacts 전문과 originalArtifacts의 id·버전·길이만 보낸다. 합의·개선 단계와 역할 제출은 해당 없음. |
| P4 | 아카이브 카테고리 선택 | 역할별로 필요한 카테고리의 확정 자료만 남기고, 채널·성과 카테고리가 없는 역할은 채널 관찰을 뺀다. 뺀 수는 omittedSources·omittedObservations에 더한다. |

## 정책별 입력 토큰과 보존 지표

평균·중앙값 토큰은 그 정책을 적용할 수 있는 제출(n)만으로 계산한다. n이 P0와 다르면 평균끼리 비교하지 말고, 같은 제출끼리 P0 대비로 잰 절약 토큰(합)·절약률을 본다. 보존은 P0 입력의 식별자·제목이 정책 적용 뒤에도 남은 비율이다(사실: evidence.facts 키, 출처: brandArchive 자료·관찰 id, 섹션: 작업물 마크다운 섹션 제목, 제목 없는 머리말 포함). 빠진 섹션은 본문이 사라진 섹션 수, 본문 보존은 작업물 content 문자 합의 비율이다. 상한 초과는 정책 적용 뒤 추정 토큰이 grade 모드 input_budget 상한(lib/graders/ledger.ts INPUT_TOKEN_CAP)을 넘는 제출 수다.

| 묶음 | 정책 | n | 해당 없음 | 평균 토큰 | 중앙값 토큰 | 절약 토큰 | 절약률 | 사실 보존 | 출처 보존 | 섹션 제목 보존 | 빠진 섹션 | 본문 보존 | 상한 초과(>32,000) |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 전체 | P0 | 3 | 0 | 2,265 | 1,590 | 0 | 0.0% | 100.0% (6/6) | 100.0% (2/2) | 100.0% (24/24) | 0 | 100.0% | 0 |
| 전체 | P1 | 2 | 1 | 3,004 | 3,004 | 765 | 11.3% | 100.0% (6/6) | 100.0% (2/2) | 100.0% (24/24) | 0 | 100.0% | 0 |
| 전체 | P2 | 2 | 1 | 3,386 | 3,386 | 0 | 0.0% | 100.0% (6/6) | 100.0% (2/2) | 100.0% (24/24) | 0 | 100.0% | 0 |
| 전체 | P3 | 1 | 2 | 4,133 | 4,133 | 1,049 | 20.2% | 100.0% (3/3) | 100.0% (1/1) | 100.0% (24/24) | 14 | 54.9% | 0 |
| 전체 | P4 | 2 | 1 | 3,386 | 3,386 | 0 | 0.0% | 100.0% (6/6) | 100.0% (2/2) | 100.0% (24/24) | 0 | 100.0% | 0 |
| 역할 전체 | P0 | 2 | 0 | 807 | 807 | 0 | 0.0% | 100.0% (3/3) | 100.0% (1/1) | — | 0 | — | 0 |
| 역할 전체 | P1 | 1 | 1 | 1,558 | 1,558 | 32 | 2.0% | 100.0% (3/3) | 100.0% (1/1) | — | 0 | — | 0 |
| 역할 전체 | P2 | 1 | 1 | 1,590 | 1,590 | 0 | 0.0% | 100.0% (3/3) | 100.0% (1/1) | — | 0 | — | 0 |
| 역할 전체 | P3 | 0 | 2 | — | — | 0 | — | — | — | — | 0 | — | 0 |
| 역할 전체 | P4 | 1 | 1 | 1,590 | 1,590 | 0 | 0.0% | 100.0% (3/3) | 100.0% (1/1) | — | 0 | — | 0 |
| 역할 · 총괄 파트너 (cmo) | P0 | 2 | 0 | 807 | 807 | 0 | 0.0% | 100.0% (3/3) | 100.0% (1/1) | — | 0 | — | 0 |
| 역할 · 총괄 파트너 (cmo) | P1 | 1 | 1 | 1,558 | 1,558 | 32 | 2.0% | 100.0% (3/3) | 100.0% (1/1) | — | 0 | — | 0 |
| 역할 · 총괄 파트너 (cmo) | P2 | 1 | 1 | 1,590 | 1,590 | 0 | 0.0% | 100.0% (3/3) | 100.0% (1/1) | — | 0 | — | 0 |
| 역할 · 총괄 파트너 (cmo) | P3 | 0 | 2 | — | — | 0 | — | — | — | — | 0 | — | 0 |
| 역할 · 총괄 파트너 (cmo) | P4 | 1 | 1 | 1,590 | 1,590 | 0 | 0.0% | 100.0% (3/3) | 100.0% (1/1) | — | 0 | — | 0 |
| 회의 전체 | P0 | 1 | 0 | 5,182 | 5,182 | 0 | 0.0% | 100.0% (3/3) | 100.0% (1/1) | 100.0% (24/24) | 0 | 100.0% | 0 |
| 회의 전체 | P1 | 1 | 0 | 4,449 | 4,449 | 733 | 14.1% | 100.0% (3/3) | 100.0% (1/1) | 100.0% (24/24) | 0 | 100.0% | 0 |
| 회의 전체 | P2 | 1 | 0 | 5,182 | 5,182 | 0 | 0.0% | 100.0% (3/3) | 100.0% (1/1) | 100.0% (24/24) | 0 | 100.0% | 0 |
| 회의 전체 | P3 | 1 | 0 | 4,133 | 4,133 | 1,049 | 20.2% | 100.0% (3/3) | 100.0% (1/1) | 100.0% (24/24) | 14 | 54.9% | 0 |
| 회의 전체 | P4 | 1 | 0 | 5,182 | 5,182 | 0 | 0.0% | 100.0% (3/3) | 100.0% (1/1) | 100.0% (24/24) | 0 | 100.0% | 0 |
| 회의 · 의견 교환 | P0 | 1 | 0 | 5,182 | 5,182 | 0 | 0.0% | 100.0% (3/3) | 100.0% (1/1) | 100.0% (24/24) | 0 | 100.0% | 0 |
| 회의 · 의견 교환 | P1 | 1 | 0 | 4,449 | 4,449 | 733 | 14.1% | 100.0% (3/3) | 100.0% (1/1) | 100.0% (24/24) | 0 | 100.0% | 0 |
| 회의 · 의견 교환 | P2 | 1 | 0 | 5,182 | 5,182 | 0 | 0.0% | 100.0% (3/3) | 100.0% (1/1) | 100.0% (24/24) | 0 | 100.0% | 0 |
| 회의 · 의견 교환 | P3 | 1 | 0 | 4,133 | 4,133 | 1,049 | 20.2% | 100.0% (3/3) | 100.0% (1/1) | 100.0% (24/24) | 14 | 54.9% | 0 |
| 회의 · 의견 교환 | P4 | 1 | 0 | 5,182 | 5,182 | 0 | 0.0% | 100.0% (3/3) | 100.0% (1/1) | 100.0% (24/24) | 0 | 100.0% | 0 |

## P2 절단 입력 보정

저장 입력의 P2 대상 작업물(역할 previous, 회의 originalArtifacts)이 이미 앞부분 절단(excerpt: true)된 제출은 잘린 뒤쪽 섹션이 입력에 없어, 위 표의 P2 절약은 상한이다. 운영 P2는 원문 전체에서 모든 섹션을 섹션당 2,000자로 넣으므로 입력이 오히려 늘 수 있다. 하한은 잘린 문자(역할 previous의 originalLength − 저장 길이)를 1자당 최대 1토큰으로 더한 추정이다. 회의 originalArtifacts는 원래 길이를 몰라 하한을 낼 수 없다(—).

| 묶음 | 절단 입력 포함 제출 | 잘린 문자 | 원래 길이 모름 작업물 | P2 절약 토큰(상한) | 운영 P2 절약 추정 하한 |
|---|---:|---:|---:|---:|---:|
| — | 0 | 0 | 0 | — | — |

## 최상위 키별 분해 (P0 평균)

전체 묶음은 모든 키, 나머지 묶음은 상위 5개 키만 싣는다. 비중은 묶음 입력 문자 합 대비다.

| 묶음 | 키 | 평균 문자 | 평균 토큰 | 비중 |
|---|---|---:|---:|---:|
| 전체 | originalArtifacts | 3,256 | 1,799 | 51.6% |
| 전체 | brandArchive | 524 | 262 | 8.3% |
| 전체 | campaign | 495 | 248 | 7.8% |
| 전체 | evidence | 475 | 238 | 7.5% |
| 전체 | channelPractice | 358 | 270 | 5.7% |
| 전체 | brand | 335 | 176 | 5.3% |
| 전체 | previousMeeting | 324 | 162 | 5.1% |
| 전체 | task | 247 | 140 | 3.9% |
| 전체 | factPolicy | 96 | 66 | 1.5% |
| 전체 | discussion | 77 | 39 | 1.2% |
| 전체 | skillVersion | 29 | 15 | 0.5% |
| 전체 | agenda | 14 | 9 | 0.2% |
| 전체 | completedRevisions | 12 | 6 | 0.2% |
| 전체 | allowedRespondsTo | 11 | 6 | 0.2% |
| 전체 | phase | 10 | 5 | 0.2% |
| 전체 | recordedMetrics | 10 | 5 | 0.2% |
| 전체 | trialLearning | 9 | 5 | 0.1% |
| 전체 | role | 8 | 4 | 0.1% |
| 전체 | learning | 7 | 4 | 0.1% |
| 전체 | previous | 7 | 4 | 0.1% |
| 역할 전체 | brandArchive | 524 | 262 | 17.9% |
| 역할 전체 | task | 494 | 279 | 16.8% |
| 역할 전체 | campaign | 489 | 245 | 16.7% |
| 역할 전체 | evidence | 475 | 238 | 16.2% |
| 역할 전체 | channelPractice | 358 | 270 | 12.2% |
| 역할 · 총괄 파트너 (cmo) | brandArchive | 524 | 262 | 17.9% |
| 역할 · 총괄 파트너 (cmo) | task | 494 | 279 | 16.8% |
| 역할 · 총괄 파트너 (cmo) | campaign | 489 | 245 | 16.7% |
| 역할 · 총괄 파트너 (cmo) | evidence | 475 | 238 | 16.2% |
| 역할 · 총괄 파트너 (cmo) | channelPractice | 358 | 270 | 12.2% |
| 회의 전체 | originalArtifacts | 6,512 | 3,598 | 67.2% |
| 회의 전체 | previousMeeting | 648 | 324 | 6.7% |
| 회의 전체 | brandArchive | 524 | 262 | 5.4% |
| 회의 전체 | campaign | 500 | 250 | 5.2% |
| 회의 전체 | evidence | 475 | 238 | 4.9% |
| 회의 · 의견 교환 | originalArtifacts | 6,512 | 3,598 | 67.2% |
| 회의 · 의견 교환 | previousMeeting | 648 | 324 | 6.7% |
| 회의 · 의견 교환 | brandArchive | 524 | 262 | 5.4% |
| 회의 · 의견 교환 | campaign | 500 | 250 | 5.2% |
| 회의 · 의견 교환 | evidence | 475 | 238 | 4.9% |

## brandArchive 하위 키 분해 (P0 평균)

아카이브(loop-10 대상) 비중을 하위 키로 나눈다. 전체·역할 전체·회의 전체 묶음만 싣는다. 비중은 묶음 입력 문자 합 대비다.

| 묶음 | 키 | 평균 문자 | 평균 토큰 | 비중 |
|---|---|---:|---:|---:|
| 전체 | confirmedSources | 269 | 135 | 4.3% |
| 전체 | notice | 115 | 91 | 1.8% |
| 전체 | confirmedDiagnosis | 25 | 13 | 0.4% |
| 전체 | omittedObservations | 23 | 12 | 0.4% |
| 전체 | storeMarketing | 21 | 11 | 0.3% |
| 전체 | omittedSources | 18 | 9 | 0.3% |
| 전체 | observations | 17 | 9 | 0.3% |
| 전체 | revision | 12 | 6 | 0.2% |
| 역할 전체 | confirmedSources | 269 | 135 | 9.2% |
| 역할 전체 | notice | 115 | 91 | 3.9% |
| 역할 전체 | confirmedDiagnosis | 25 | 13 | 0.9% |
| 역할 전체 | omittedObservations | 23 | 12 | 0.8% |
| 역할 전체 | storeMarketing | 21 | 11 | 0.7% |
| 역할 전체 | omittedSources | 18 | 9 | 0.6% |
| 역할 전체 | observations | 17 | 9 | 0.6% |
| 역할 전체 | revision | 12 | 6 | 0.4% |
| 회의 전체 | confirmedSources | 269 | 135 | 2.8% |
| 회의 전체 | notice | 115 | 91 | 1.2% |
| 회의 전체 | confirmedDiagnosis | 25 | 13 | 0.3% |
| 회의 전체 | omittedObservations | 23 | 12 | 0.2% |
| 회의 전체 | storeMarketing | 21 | 11 | 0.2% |
| 회의 전체 | omittedSources | 18 | 9 | 0.2% |
| 회의 전체 | observations | 17 | 9 | 0.2% |
| 회의 전체 | revision | 12 | 6 | 0.1% |

## 정책별 생략 경로 (전체, 정책마다 문자 합 상위 10개)

| 정책 | 경로 | 건수 | 문자 합계 |
|---|---|---:|---:|
| P1 | originalArtifacts[].factRefs | 7 | 854 |
| P1 | originalArtifacts[].outputContractVersion | 7 | 287 |
| P1 | originalArtifacts[].createdAt | 7 | 273 |
| P1 | originalArtifacts[].campaignId | 7 | 231 |
| P1 | originalArtifacts[].skillVersion | 7 | 210 |
| P1 | originalArtifacts[].status | 7 | 126 |
| P1 | originalArtifacts[].origin | 7 | 98 |
| P1 | campaign.createdAt | 2 | 78 |
| P1 | campaign.updatedAt | 2 | 78 |
| P1 | campaign.status | 2 | 35 |
| P3 | originalArtifacts[].content | 7 | 1,431 |

## 해석 주의

- n<30인 묶음은 참고용이다(docs/EVAL.ko.md 비교 통계 규칙 3). 이번 표에서 n<30인 묶음: 5개.
- P2 절약은 상한이다. 앞부분이 이미 잘린 선행 작업물이 든 제출 0건은 "P2 절단 입력 보정" 표의 추정 하한과 함께 본다. 잘린 뒤쪽 섹션을 P2가 얼마나 되살리는지는 PR 4b 조립 단계에서 원본 작업물로 잰다.
- 의견 교환 단계 P3는 요약(첫 본문 섹션)과 역할 계약의 인계 섹션만 본문을 남긴다. 인계 섹션이 없는 역할(strategy·creative·content·growth)과 자유 형식 작업물은 요약만 남는다. 합의·개선 단계는 P3 해당 없음이다.
- 품질 재검토 단계 P3의 섹션 손실은 개선본으로 대체됐거나 무효가 된 원본 버전의 섹션이다(의도한 축소).
- 상한 초과는 input만 센 추정 토큰 기준이라 실제 input_budget 판정(제공자 보고 입력 토큰, 지시문·에이전트 오버헤드 포함)보다 작게 나온다.
- P4의 출처 보존 감소는 역할별로 뺀 카테고리 자료다. 뺀 자료가 판단에 필요했는지는 서버 평가로만 알 수 있다.
- 보존 지표는 식별자·제목이 남았는지만 본다. 품질 영향은 서버 평가(F3b 쌍 평가 구조)로 판단하며 현재 not_run이다.

SNAPSHOT */
