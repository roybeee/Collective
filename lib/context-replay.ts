import {BUDGET_LISTS,CONTEXT_POLICIES,MEETING_STAGES,SECTION_BUDGET,applyPolicy,parseInput,sectionHasBody,splitSections,submissionRole,submissionStage,type PolicyId,type ReplaySubmission} from './context-policies';
import {estimateInputTokens} from './token-budget';
import {INPUT_TOKEN_CAP} from './graders/ledger';
import {roles} from './agency';
import {phaseNames,artifactRef} from './meetings';

// B5 맥락 정책 리플레이 통계(계산만, 모델 호출 없음). 입력 텍스트 → 최상위 키별 문자 수·추정 토큰, 정책별 절약량·보존 지표, 비교표 마크다운(한국어).
// 원문 텍스트는 어떤 출력에도 넣지 않는다: 형식 검사를 통과한 키 이름, 인덱스를 지운 경로, 역할 id·단계 이름, 수치와 개수만 낸다.
// 토큰은 lib/token-budget.ts estimateInputTokens(과대 쪽 추정)로 input만 센다. 지시문(instructions)과 HERMES 에이전트 자체 지시·도구 호출은 넣지 않는다.
// 로더 주의: token-budget.ts가 ./server(cloudflare:workers)를 가져온다. vm으로 읽을 때는 'cloudflare:workers'를 빈 env로 바꾸고 TextEncoder를 넣는다(tests/helpers/runtime.mjs).
export type KeyStat={chars:number;tokens:number};
// archive: brandArchive 하위 키(confirmedSources·observations·storeMarketing 등)별 조각. brandArchive가 객체가 아니면 빈 객체다.
export type Breakdown={totalChars:number;estimatedTokens:number;byKey:Record<string,KeyStat>;archive:Record<string,KeyStat>;json:boolean};
export type Ratio={kept:number;total:number;rate:number|null};
export type OmittedPath={path:string;count:number;chars:number};
// n: 정책을 적용할 수 있는 제출 수. 절약량은 같은 제출끼리(P0 대비) 센다. 보존은 P0 입력의 식별자·섹션 제목이 남은 비율, missingSections는 본문이 사라진 섹션 수다.
// body: 작업물 content 문자 합(정책 뒤 ÷ P0). overCap: 정책 뒤 추정 토큰이 INPUT_TOKEN_CAP(grade 모드 input_budget 상한)을 넘는 제출 수.
export type PolicyStats={n:number;notApplicable:number;meanTokens:number|null;medianTokens:number|null;meanChars:number|null;baselineTokens:number;savedTokens:number;savingRate:number|null;facts:Ratio;sources:Ratio;sections:Ratio;missingSections:number;body:Ratio;overCap:number;omitted:OmittedPath[]};
// P2 절단 보정: P2를 적용한 제출 중 P2 대상 작업물이 이미 앞부분 절단(excerpt:true)된 제출 수, 잘린 문자 합(역할 previous originalLength 기준), 원래 길이를 모르는 작업물 수(회의 originalArtifacts).
// minSavedTokens: 운영 P2 절약의 추정 하한(P2 절약 − 잘린 문자, 잘린 문자 1자를 최대 1토큰으로 본다). 원래 길이를 모르는 작업물이 있으면 null.
export type P2Truncation={submissions:number;missingChars:number;unknownLength:number;minSavedTokens:number|null};
export type KeyShare={key:string;meanChars:number;meanTokens:number;share:number};
export type ReplayGroup={key:string;label:string;n:number;nonJson:number;truncatedArtifacts:number;keys:KeyShare[];archiveKeys:KeyShare[];p2Truncation:P2Truncation;policies:Record<PolicyId,PolicyStats>};
export type ReplaySummary={version:'context-replay-v1';modelCalls:0;total:number;skipped:number;nonJson:number;groups:ReplayGroup[]};

type Obj=Record<string,unknown>;
const isObj=(v:unknown):v is Obj=>!!v&&typeof v==='object'&&!Array.isArray(v);
const field=(v:unknown,...path:string[])=>path.reduce<unknown>((o,k)=>isObj(o)?o[k]:undefined,v);
const list=(v:unknown)=>Array.isArray(v)?v as unknown[]:[];
const sum=(xs:number[])=>xs.reduce((a,b)=>a+b,0);
const round1=(n:number)=>Math.round(n*10)/10,round4=(n:number)=>Math.round(n*1e4)/1e4;
const mean=(xs:number[])=>xs.length?round1(sum(xs)/xs.length):null;
const median=(xs:number[])=>{const s=[...xs].sort((a,b)=>a-b),m=s.length>>1;return s.length?round1(s.length%2?s[m]:(s[m-1]+s[m])/2):null};
const SAFE_KEY=/^[A-Za-z_$][A-Za-z0-9_$]{0,63}$/,OTHER_KEY='(기타 키)';
const ARTIFACT_LISTS=['previous','originalArtifacts','candidateArtifacts','completedRevisions'];
function parseObject(input:string):Obj|null{try{const x:unknown=JSON.parse(input);return isObj(x)?x:null}catch{return null}}

// 객체의 키별 `"키":값` 조각의 문자 수와 추정 토큰. 조각 합 + 쉼표 + 중괄호 = 객체 JSON 길이.
const parts=(o:Obj)=>Object.fromEntries(Object.entries(o).map(([k,v])=>{const part=JSON.stringify(k)+':'+JSON.stringify(v);return [k,{chars:part.length,tokens:estimateInputTokens(part)}]}));
// 최상위 키별 조각과 brandArchive 하위 키별 조각. 최상위 조각 합 + 쉼표 + 중괄호 = 입력 길이(정규 JSON일 때). JSON 객체가 아니면 키 없이 합계만.
export function breakdown(input:string):Breakdown{
 const x=parseObject(input),archive=field(x,'brandArchive');
 return {totalChars:input.length,estimatedTokens:estimateInputTokens(input),byKey:parts(x??{}),archive:isObj(archive)?parts(archive):{},json:!!x};
}

// 보존 지표의 대상 집합: 사실(evidence.facts 버킷·키·범위), 출처(brandArchive 확정 자료·채널 관찰 id), 작업물 섹션(ref#제목, 본문 유무), 작업물 content 문자 합.
// 섹션은 splitSections 경계(역할 계약 `## ` 제목 전부 포함) 기준이다. 제목 없는 섹션(머리말·제목 없는 작업물)은 ref#(머리말), 같은 작업물 안에서 반복되는 제목은 ref#제목#2처럼 센다.
type Identities={facts:Set<string>;sources:Set<string>;titles:Set<string>;bodies:Set<string>;chars:number};
const UNTITLED='(머리말)';
const refOf=(a:Obj)=>typeof a.ref==='string'?a.ref:artifactRef({role:String(a.role??''),version:typeof a.version==='number'?a.version:undefined});
function sectionKeys(ref:string,content:string){
 const sections=splitSections(content),name=(i:number)=>sections[i].title||UNTITLED;
 return sections.map((s,i)=>{const n=sections.slice(0,i).filter((_,j)=>name(j)===name(i)).length;return {key:`${ref}#${name(i)}${n?'#'+(n+1):''}`,body:sectionHasBody(s)}});
}
function identities(x:Obj|null):Identities{
 const facts=field(x,'evidence','facts'),archive=field(x,'brandArchive'),ids=(key:string)=>list(field(archive,key)).map(s=>field(s,'id')).filter((id):id is string=>typeof id==='string').map(id=>key+':'+id);
 const artifacts=ARTIFACT_LISTS.flatMap(k=>list(field(x,k))).filter(isObj).flatMap(a=>typeof a.content==='string'?[{ref:refOf(a),content:a.content}]:[]),sections=artifacts.flatMap(a=>sectionKeys(a.ref,a.content));
 return {facts:new Set(['confirmed','prohibited','candidate'].flatMap(b=>list(field(facts,b)).filter(isObj).map(f=>`${b}:${String(f.key)}:${String(f.scope??'')}`))),sources:new Set([...ids('confirmedSources'),...ids('observations')]),titles:new Set(sections.map(s=>s.key)),bodies:new Set(sections.filter(s=>s.body).map(s=>s.key)),chars:sum(artifacts.map(a=>a.content.length))};
}
const kept=(before:Set<string>,after:Set<string>)=>[...before].filter(k=>after.has(k)).length;
// P2 대상 목록(BUDGET_LISTS)에서 이미 앞부분이 잘린(excerpt:true) 작업물. 역할 previous는 originalLength로 잘린 문자 수를 알고, 회의 originalArtifacts는 모른다.
function truncation(x:Obj|null){
 const cut=BUDGET_LISTS.flatMap(k=>list(field(x,k))).filter(isObj).filter(a=>a.excerpt===true&&typeof a.content==='string');
 const known=cut.filter(a=>typeof a.originalLength==='number'&&a.originalLength>=String(a.content).length);
 return {truncated:cut.length>0,missing:sum(known.map(a=>Number(a.originalLength)-String(a.content).length)),unknown:cut.length-known.length};
}
type PolicyEval={applicable:boolean;tokens:number;chars:number;facts:[number,number];sources:[number,number];sections:[number,number];missing:number;body:[number,number];overCap:boolean;omitted:{path:string;chars:number}[]};
type SubmissionEval={group:string;baseTokens:number;breakdown:Breakdown;truncated:number;p2:ReturnType<typeof truncation>;policies:Record<PolicyId,PolicyEval>};
function groupOf(s:ReplaySubmission){
 if(s.kind==='meeting')return 'meeting:'+(submissionStage(s)??'unknown');
 const role=submissionRole(s);return 'role:'+(role&&roles.some(r=>r.id===role)?role:'unknown');
}
function evaluate(s:ReplaySubmission):SubmissionEval{
 const x=parseObject(s.input),before=identities(x),baseTokens=estimateInputTokens(s.input);
 const truncated=['previous','originalArtifacts','candidateArtifacts'].flatMap(k=>list(field(x,k))).filter(a=>field(a,'excerpt')===true).length;
 const policies=Object.fromEntries(CONTEXT_POLICIES.map(({id})=>{
  const r=applyPolicy(id,s),after=r.input===s.input?before:identities(parseInput(r.input)),pair=(k:'facts'|'sources'|'titles')=>[kept(before[k],after[k]),before[k].size] as [number,number];
  const tokens=r.input===s.input?baseTokens:estimateInputTokens(r.input);
  return [id,{applicable:r.applicable,tokens,chars:r.input.length,facts:pair('facts'),sources:pair('sources'),sections:pair('titles'),missing:before.bodies.size-kept(before.bodies,after.bodies),body:[after.chars,before.chars],overCap:tokens>INPUT_TOKEN_CAP,omitted:r.omitted.map(o=>({path:o.path.replace(/\[\d+\]/g,'[]'),chars:o.chars}))}];
 })) as Record<PolicyId,PolicyEval>;
 return {group:groupOf(s),baseTokens,breakdown:breakdown(s.input),truncated,p2:truncation(x),policies};
}
const ratio=(pairs:[number,number][]):Ratio=>{const k=sum(pairs.map(p=>p[0])),t=sum(pairs.map(p=>p[1]));return {kept:k,total:t,rate:t?round4(k/t):null}};
function omittedPaths(items:{path:string;chars:number}[]):OmittedPath[]{
 const paths=[...new Set(items.map(o=>o.path))];
 return paths.map(path=>{const hits=items.filter(o=>o.path===path);return {path,count:hits.length,chars:sum(hits.map(o=>o.chars))}}).sort((a,b)=>b.chars-a.chars||(a.path<b.path?-1:1));
}
function policyStats(items:SubmissionEval[],id:PolicyId):PolicyStats{
 const used=items.filter(e=>e.policies[id].applicable),p=used.map(e=>e.policies[id]),tokens=p.map(x=>x.tokens),baseline=sum(used.map(e=>e.baseTokens)),saved=baseline-sum(tokens);
 return {n:used.length,notApplicable:items.length-used.length,meanTokens:mean(tokens),medianTokens:median(tokens),meanChars:mean(p.map(x=>x.chars)),baselineTokens:baseline,savedTokens:saved,savingRate:baseline?round4(saved/baseline):null,facts:ratio(p.map(x=>x.facts)),sources:ratio(p.map(x=>x.sources)),sections:ratio(p.map(x=>x.sections)),missingSections:sum(p.map(x=>x.missing)),body:ratio(p.map(x=>x.body)),overCap:p.filter(x=>x.overCap).length,omitted:omittedPaths(p.flatMap(x=>x.omitted))};
}
function p2Truncation(items:SubmissionEval[],saved:number):P2Truncation{
 const used=items.filter(e=>e.policies.P2.applicable&&e.p2.truncated),missing=sum(used.map(e=>e.p2.missing)),unknown=sum(used.map(e=>e.p2.unknown));
 return {submissions:used.length,missingChars:missing,unknownLength:unknown,minSavedTokens:unknown?null:saved-missing};
}
// 키별 평균(JSON 입력 전체로 나눈다, 키가 없는 입력은 0)과 비중(묶음 입력 문자 합 대비). pick: 최상위 키 또는 brandArchive 하위 키.
function keyStats(items:SubmissionEval[],pick:(b:Breakdown)=>Record<string,KeyStat>=b=>b.byKey):KeyShare[]{
 const json=items.filter(e=>e.breakdown.json),total=sum(json.map(e=>e.breakdown.totalChars));
 const totals=json.flatMap(e=>Object.entries(pick(e.breakdown))).reduce<Record<string,KeyStat>>((acc,[k,v])=>{const key=SAFE_KEY.test(k)&&k!=='__proto__'?k:OTHER_KEY,cur=Object.hasOwn(acc,key)?acc[key]:{chars:0,tokens:0};return {...acc,[key]:{chars:cur.chars+v.chars,tokens:cur.tokens+v.tokens}}},{});
 return Object.entries(totals).map(([key,v])=>({key,meanChars:round1(v.chars/json.length),meanTokens:round1(v.tokens/json.length),share:total?round4(v.chars/total):0})).sort((a,b)=>b.meanChars-a.meanChars||(a.key<b.key?-1:1));
}
const GROUPS=['all','role',...roles.map(r=>'role:'+r.id),'role:unknown','meeting',...MEETING_STAGES.map(s=>'meeting:'+s),'meeting:unknown'];
function groupLabel(key:string){
 if(key==='all')return '전체';
 if(key==='role'||key==='meeting')return key==='role'?'역할 전체':'회의 전체';
 const [kind,id]=key.split(':'),role=roles.find(r=>r.id===id),stage=MEETING_STAGES.find(s=>s===id);
 return kind==='role'?(role?`역할 · ${role.name} (${role.id})`:'역할 · 미확인'):stage?`회의 · ${phaseNames[stage]}`:'회의 · 미확인 단계';
}
const inGroup=(key:string,e:SubmissionEval)=>key==='all'||e.group===key||e.group.startsWith(key+':');
// 제출 목록(역할·회의만, 그 밖의 종류는 skipped) → 묶음(전체·종류·역할별·회의 단계별)×정책 통계.
export function replay(submissions:readonly ReplaySubmission[]):ReplaySummary{
 const valid=submissions.filter(s=>(s.kind==='role'||s.kind==='meeting')&&typeof s.input==='string'),evals=valid.map(evaluate);
 const groups=GROUPS.map(key=>({key,items:evals.filter(e=>inGroup(key,e))})).filter(g=>g.items.length).map(({key,items})=>{
  const policies=Object.fromEntries(CONTEXT_POLICIES.map(({id})=>[id,policyStats(items,id)])) as Record<PolicyId,PolicyStats>;
  return {key,label:groupLabel(key),n:items.length,nonJson:items.filter(e=>!e.breakdown.json).length,truncatedArtifacts:sum(items.map(e=>e.truncated)),keys:keyStats(items),archiveKeys:keyStats(items,b=>b.archive),p2Truncation:p2Truncation(items,policies.P2.savedTokens),policies};
 });
 return {version:'context-replay-v1',modelCalls:0,total:valid.length,skipped:submissions.length-valid.length,nonJson:evals.filter(e=>!e.breakdown.json).length,groups};
}

const comma=(n:number)=>String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g,',');
const num=(n:number|null)=>n===null?'—':comma(n);
const pct=(r:number|null)=>r===null?'—':(r*100).toFixed(1)+'%';
const ratioCell=(r:Ratio)=>r.rate===null?'—':`${pct(r.rate)} (${r.kept}/${r.total})`;
const cell=(s:string)=>s.replace(/\|/g,'\\|');
const ISO=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
function policyRows(g:ReplayGroup){
 return CONTEXT_POLICIES.map(({id})=>{const s=g.policies[id];return `| ${g.label} | ${id} | ${s.n} | ${s.notApplicable} | ${num(s.meanTokens)} | ${num(s.medianTokens)} | ${comma(s.savedTokens)} | ${pct(s.savingRate)} | ${ratioCell(s.facts)} | ${ratioCell(s.sources)} | ${ratioCell(s.sections)} | ${s.missingSections} | ${pct(s.body.rate)} | ${s.overCap} |`});
}
function truncationRows(groups:ReplayGroup[]){
 const rows=groups.filter(g=>g.p2Truncation.submissions).map(g=>{const t=g.p2Truncation;return `| ${g.label} | ${t.submissions} | ${comma(t.missingChars)} | ${t.unknownLength} | ${comma(g.policies.P2.savedTokens)} | ${num(t.minSavedTokens)} |`});
 return rows.length?rows:['| — | 0 | 0 | 0 | — | — |'];
}
const TOTALS=['all','role','meeting'];
function archiveRows(groups:ReplayGroup[]){
 const rows=groups.filter(g=>TOTALS.includes(g.key)).flatMap(g=>g.archiveKeys.map(k=>`| ${g.label} | ${cell(k.key)} | ${comma(k.meanChars)} | ${comma(k.meanTokens)} | ${pct(k.share)} |`));
 return rows.length?rows:['| — | (없음) | 0 | 0 | — |'];
}
function omittedRows(all:ReplayGroup|undefined){
 const rows=all?CONTEXT_POLICIES.flatMap(({id})=>all.policies[id].omitted.slice(0,10).map(o=>`| ${id} | ${cell(o.path)} | ${o.count} | ${comma(o.chars)} |`)):[];
 return rows.length?rows:['| — | (없음) | 0 | 0 |'];
}
// 비교표(한국어 마크다운). generatedAt은 ISO 시각 형식일 때만 싣는다.
export function comparisonMarkdown(summary:ReplaySummary,{generatedAt}:{generatedAt?:string}={}):string{
 const all=summary.groups.find(g=>g.key==='all'),count=(key:string)=>summary.groups.find(g=>g.key===key)?.n??0,small=summary.groups.filter(g=>g.n<30).length;
 return [
  '# 맥락 정책 리플레이 비교표','',
  ...(generatedAt&&ISO.test(generatedAt)?[`- 생성: ${generatedAt}`]:[]),
  `- 표본: 제출 ${summary.total}건(역할 ${count('role')}건 · 회의 ${count('meeting')}건). JSON이 아닌 입력 ${summary.nonJson}건은 P0만 계산했다.${summary.skipped?` 역할·회의가 아닌 제출 ${summary.skipped}건은 뺐다.`:''}`,
  '- 근거: 저장된 제출의 input만 읽기 전용으로 다시 계산했다. 모델 호출 0회. 서버 평가(쌍 비교)는 not_run(대표 승인 필요).',
  '- 토큰: lib/token-budget.ts estimateInputTokens 추정치(과대 쪽). 지시문(instructions)과 HERMES 에이전트 자체 지시·도구 호출은 빠져 실제 사용량보다 작다.',
  '- 원문은 싣지 않는다. 키 이름·경로·수치·개수만 있다.','',
  '## 정책','','| 정책 | 이름 | 내용 |','|---|---|---|',...CONTEXT_POLICIES.map(p=>`| ${p.id} | ${p.label} | ${cell(p.description)} |`),'',
  '## 정책별 입력 토큰과 보존 지표','',
  '평균·중앙값 토큰은 그 정책을 적용할 수 있는 제출(n)만으로 계산한다. n이 P0와 다르면 평균끼리 비교하지 말고, 같은 제출끼리 P0 대비로 잰 절약 토큰(합)·절약률을 본다. 보존은 P0 입력의 식별자·제목이 정책 적용 뒤에도 남은 비율이다(사실: evidence.facts 키, 출처: brandArchive 자료·관찰 id, 섹션: 작업물 마크다운 섹션 제목, 제목 없는 머리말 포함). 빠진 섹션은 본문이 사라진 섹션 수, 본문 보존은 작업물 content 문자 합의 비율이다. 상한 초과는 정책 적용 뒤 추정 토큰이 grade 모드 input_budget 상한(lib/graders/ledger.ts INPUT_TOKEN_CAP)을 넘는 제출 수다.','',
  `| 묶음 | 정책 | n | 해당 없음 | 평균 토큰 | 중앙값 토큰 | 절약 토큰 | 절약률 | 사실 보존 | 출처 보존 | 섹션 제목 보존 | 빠진 섹션 | 본문 보존 | 상한 초과(>${comma(INPUT_TOKEN_CAP)}) |`,
  '|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|',
  ...summary.groups.flatMap(policyRows),'',
  '## P2 절단 입력 보정','',
  `저장 입력의 P2 대상 작업물(역할 previous, 회의 originalArtifacts)이 이미 앞부분 절단(excerpt: true)된 제출은 잘린 뒤쪽 섹션이 입력에 없어, 위 표의 P2 절약은 상한이다. 운영 P2는 원문 전체에서 모든 섹션을 섹션당 ${comma(SECTION_BUDGET)}자로 넣으므로 입력이 오히려 늘 수 있다. 하한은 잘린 문자(역할 previous의 originalLength − 저장 길이)를 1자당 최대 1토큰으로 더한 추정이다. 회의 originalArtifacts는 원래 길이를 몰라 하한을 낼 수 없다(—).`,'',
  '| 묶음 | 절단 입력 포함 제출 | 잘린 문자 | 원래 길이 모름 작업물 | P2 절약 토큰(상한) | 운영 P2 절약 추정 하한 |','|---|---:|---:|---:|---:|---:|',...truncationRows(summary.groups),'',
  '## 최상위 키별 분해 (P0 평균)','','전체 묶음은 모든 키, 나머지 묶음은 상위 5개 키만 싣는다. 비중은 묶음 입력 문자 합 대비다.','',
  '| 묶음 | 키 | 평균 문자 | 평균 토큰 | 비중 |','|---|---|---:|---:|---:|',
  ...summary.groups.flatMap(g=>(g.key==='all'?g.keys:g.keys.slice(0,5)).map(k=>`| ${g.label} | ${cell(k.key)} | ${comma(k.meanChars)} | ${comma(k.meanTokens)} | ${pct(k.share)} |`)),'',
  '## brandArchive 하위 키 분해 (P0 평균)','','아카이브(loop-10 대상) 비중을 하위 키로 나눈다. 전체·역할 전체·회의 전체 묶음만 싣는다. 비중은 묶음 입력 문자 합 대비다.','',
  '| 묶음 | 키 | 평균 문자 | 평균 토큰 | 비중 |','|---|---|---:|---:|---:|',...archiveRows(summary.groups),'',
  '## 정책별 생략 경로 (전체, 정책마다 문자 합 상위 10개)','','| 정책 | 경로 | 건수 | 문자 합계 |','|---|---|---:|---:|',...omittedRows(all),'',
  '## 해석 주의','',
  `- n<30인 묶음은 참고용이다(docs/EVAL.ko.md 비교 통계 규칙 3). 이번 표에서 n<30인 묶음: ${small}개.`,
  `- P2 절약은 상한이다. 앞부분이 이미 잘린 선행 작업물이 든 제출 ${all?.p2Truncation.submissions??0}건은 "P2 절단 입력 보정" 표의 추정 하한과 함께 본다. 잘린 뒤쪽 섹션을 P2가 얼마나 되살리는지는 PR 4b 조립 단계에서 원본 작업물로 잰다.`,
  '- 의견 교환 단계 P3는 요약(첫 본문 섹션)과 역할 계약의 인계 섹션만 본문을 남긴다. 인계 섹션이 없는 역할(strategy·creative·content·growth)과 자유 형식 작업물은 요약만 남는다. 합의·개선 단계는 P3 해당 없음이다.',
  '- 품질 재검토 단계 P3의 섹션 손실은 개선본으로 대체됐거나 무효가 된 원본 버전의 섹션이다(의도한 축소).',
  '- 상한 초과는 input만 센 추정 토큰 기준이라 실제 input_budget 판정(제공자 보고 입력 토큰, 지시문·에이전트 오버헤드 포함)보다 작게 나온다.',
  '- P4의 출처 보존 감소는 역할별로 뺀 카테고리 자료다. 뺀 자료가 판단에 필요했는지는 서버 평가로만 알 수 있다.',
  '- 보존 지표는 식별자·제목이 남았는지만 본다. 품질 영향은 서버 평가(F3b 쌍 평가 구조)로 판단하며 현재 not_run이다.',
 ].join('\n')+'\n';
}
