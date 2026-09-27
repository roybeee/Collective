// 평가 run 비교 통계(F1b-2). 같은 케이스의 두 run을 채점기별로 대응 비교하고 McNemar 정확 검정(양측 이항, p=0.5)으로 판정한다.
// import가 없는 순수 모듈이다. 서버(app/api/eval), 화면, 테스트가 그대로 쓴다. 규칙: docs/EVAL.ko.md '비교 통계 규칙'.
export class EvalStatsError extends Error{status=422;constructor(message:string){super(message);this.name='EvalStatsError'}}
// 대응 케이스 n이 이보다 작으면 개선·회귀를 주장하지 않는다. 유의 수준은 양측 0.05다.
export const MIN_PAIRS=30,ALPHA=0.05;
// Workers CPU 한도 안에서 끝나도록 불일치 쌍 수의 상한을 둔다. 평가 run 한 번의 케이스 수(100)보다 훨씬 크다.
const MAX_DISCORDANT=1e6;
export type ComparisonVerdict='improved'|'regressed'|'non_regression'|'inconclusive'|'insufficient';
// prevention: 정규화 전 렌더본으로 다시 잰 판정(heading_nesting·internal_id_exposure), normalization: 정규화가 바꾼 건수. lib/eval-server.ts EvalCaseResult와 같다.
export type CaseOutcome={caseId:string;status:string;gradersVersion?:string;graders?:readonly {id:string;status:string}[];prevention?:readonly {id:string;status:string}[];normalization?:{schemaPaths?:number;headings?:number}|null};
export type RunOutcomes={id:string;results:readonly CaseOutcome[]};
export type GraderComparison={id:string;n:number;b:number;c:number;bothPass:number;bothFail:number;p:number;verdict:ComparisonVerdict};
export type NormalizationTally={recorded:number;normalized:number;schemaPaths:number;headings:number};
// graders: 사람이 보는 본문 기준 비교. prevention: 모델 원문(정규화 전) 기준 비교 — 지시문 예방 효과는 이것으로 읽는다. normalization: run별 정규화 건수 합계.
export type RunComparison={baseline:string;candidate:string;sharedCases:number;onlyBaseline:number;onlyCandidate:number;sameCaseSet:boolean;minPairs:number;alpha:number;gradersVersions:{baseline:string[];candidate:string[]};graders:GraderComparison[];prevention:GraderComparison[];normalization:{baseline:NormalizationTally;candidate:NormalizationTally}};

const count=(v:unknown,label:string)=>{if(typeof v!=='number'||!Number.isSafeInteger(v)||v<0)throw new EvalStatsError(`${label}은 0 이상의 정수여야 합니다.`);return v};
// 양측 p = min(1, 2·P(X≤min(b,c))), X~Binomial(b+c, 1/2). 2^-n이 0으로 내려가지 않도록 가장 큰 항(i=k) 기준 로그 공간에서 더한다.
export function mcnemarExact(b:number,c:number):number{
 const n=count(b,'불일치 쌍 b')+count(c,'불일치 쌍 c'),k=Math.min(b,c);
 if(n>MAX_DISCORDANT)throw new EvalStatsError(`불일치 쌍은 ${MAX_DISCORDANT}개 이하여야 합니다.`);
 if(n===0)return 1;
 const logs=[-n*Math.LN2];
 for(let i=0;i<k;i++)logs.push(logs[i]+Math.log((n-i)/(i+1)));
 const top=logs[k],sum=logs.reduce((s,l)=>s+Math.exp(l-top),0);
 return Math.min(1,2*Math.exp(top)*sum);
}
// 판정: n=0이거나 n<30이면 회귀 0일 때 비회귀만, 아니면 비교 불충분. n≥30에서 p<0.05면 방향으로 개선·회귀, 그 밖에는 회귀 0이면 비회귀, 아니면 판단 불가.
export function comparisonVerdict(n:number,b:number,c:number,p:number):ComparisonVerdict{
 if(n===0)return 'insufficient';
 if(n<MIN_PAIRS)return b===0?'non_regression':'insufficient';
 if(p<ALPHA&&c>b)return 'improved';
 if(p<ALPHA&&b>c)return 'regressed';
 return b===0?'non_regression':'inconclusive';
}
const byCase=(run:RunOutcomes)=>new Map(run.results.map(r=>[r.caseId,r]));
// 모델 원문 기준 판정: prevention이 있으면 그 판정, 없으면 graders. 정규화 도입 전 결과(gradersVersion 없음 = failure-types-v1)는 graders가 곧 정규화 전 렌더본 판정이다.
const modelStatus=(r:CaseOutcome|undefined,id:string)=>r?.prevention?.find(g=>g.id===id)?.status??r?.graders?.find(g=>g.id===id)?.status;
type Basis='shown'|'model';
const graderStatus=(r:CaseOutcome|undefined,id:string,basis:Basis)=>r?.status==='completed'?basis==='model'?modelStatus(r,id):r.graders?.find(g=>g.id===id)?.status:undefined;
function compareGrader(id:string,shared:string[],A:Map<string,CaseOutcome>,B:Map<string,CaseOutcome>,basis:Basis='shown'):GraderComparison{
 const pairs=shared.map(caseId=>[graderStatus(A.get(caseId),id,basis),graderStatus(B.get(caseId),id,basis)]).filter(([x,y])=>(x==='pass'||x==='fail')&&(y==='pass'||y==='fail'));
 const tally=(x:string,y:string)=>pairs.filter(p=>p[0]===x&&p[1]===y).length;
 const b=tally('pass','fail'),c=tally('fail','pass'),p=mcnemarExact(b,c);
 return {id,n:pairs.length,b,c,bothPass:tally('pass','pass'),bothFail:tally('fail','fail'),p,verdict:comparisonVerdict(pairs.length,b,c,p)};
}
const completedOf=(run:RunOutcomes)=>run.results.filter(r=>r.status==='completed');
const count0=(v:unknown)=>typeof v==='number'&&Number.isSafeInteger(v)&&v>0?v:0;
function normalizationTally(run:RunOutcomes):NormalizationTally{
 const rows=completedOf(run).flatMap(r=>r.normalization?[{schemaPaths:count0(r.normalization.schemaPaths),headings:count0(r.normalization.headings)}]:[]);
 return {recorded:rows.length,normalized:rows.filter(n=>n.schemaPaths+n.headings>0).length,schemaPaths:rows.reduce((a,n)=>a+n.schemaPaths,0),headings:rows.reduce((a,n)=>a+n.headings,0)};
}
// gradersVersion을 남기기 전 결과는 정규화 전 렌더본 채점(failure-types-v1)이다.
const versionsOf=(run:RunOutcomes)=>[...new Set(completedOf(run).map(r=>r.gradersVersion??'failure-types-v1'))];
// baseline(기준, 예: active)과 candidate(후보)를 비교한다. 두 run 모두 completed인 케이스만 짝이 되고, 채점기 결과가 pass/fail이 아니면 그 짝은 뺀다.
// prevention은 어느 한쪽에 예방 판정이 있는 채점기만 모델 원문 기준으로 비교한다(정규화 효과를 '개선'으로 세지 않는다).
export function compareRuns(baseline:RunOutcomes,candidate:RunOutcomes):RunComparison{
 const A=byCase(baseline),B=byCase(candidate),shared=[...A.keys()].filter(id=>B.has(id)),all=[...baseline.results,...candidate.results];
 const ids=[...new Set(all.flatMap(r=>(r.graders||[]).map(g=>g.id)))],preventionIds=[...new Set(all.flatMap(r=>(r.prevention||[]).map(g=>g.id)))];
 return {baseline:baseline.id,candidate:candidate.id,sharedCases:shared.length,onlyBaseline:A.size-shared.length,onlyCandidate:B.size-shared.length,sameCaseSet:shared.length===A.size&&shared.length===B.size,minPairs:MIN_PAIRS,alpha:ALPHA,
  gradersVersions:{baseline:versionsOf(baseline),candidate:versionsOf(candidate)},graders:ids.map(id=>compareGrader(id,shared,A,B)),prevention:preventionIds.map(id=>compareGrader(id,shared,A,B,'model')),normalization:{baseline:normalizationTally(baseline),candidate:normalizationTally(candidate)}};
}

// ── 쌍 평가 게이트(F3b, 대표 결정 2) ──
// pair run 하나에는 케이스마다 active(현재 적용 버전 또는 코드 상수)와 candidate(후보 버전) 결과가 하나씩 있다. 활성화 조건을 순수 함수로 판정한다.
// 규칙: docs/PROMPT-REGISTRY.ko.md '활성화 게이트'. 이 판정은 비교 통계(McNemar)와 별개인 비회귀 게이트이며 개선을 주장하지 않는다.
export type PairVariant='active'|'candidate';
export type PairCaseOutcome=CaseOutcome&{variant?:string;set?:string;model?:string|null};
type BasisHash={hash?:string|null}|null|undefined;
export type PairGatewayBasis={operational?:BasisHash;eval?:BasisHash}|null|undefined;
export type PairRunOutcomes={id:string;variant?:string;status?:string;deleted?:unknown;gatewaySnapshot?:PairGatewayBasis;gatewaySnapshotEnd?:PairGatewayBasis;results:readonly PairCaseOutcome[]};
export type PairGateCode='not_pair'|'not_completed'|'incomplete_cases'|'gateway_changed'|'model_changed'|'fewer_passes'|'sealed_missing'|'sealed_regression'|'input_budget'|'case_set_mismatch';
// warnings: 거부 사유가 아닌 참고 경고(small_sample: 대응 쌍이 MIN_PAIRS 미만). 최소 케이스 수는 강제하지 않는다(대표 결정 전).
export type PairGate={ok:boolean;reasons:{code:PairGateCode;message:string}[];warnings:{code:'small_sample';message:string}[];cases:number;sealedCases:number;passes:{pairs:number;active:number;candidate:number};sealedRegressions:{caseId:string;grader:string}[];inputBudget:{pass:number;total:number};models:Record<PairVariant,(string|null)[]>;gateway:{start:string|null;end:string|null}};

const sideOf=(run:PairRunOutcomes,variant:PairVariant):RunOutcomes=>({id:`${run.id}:${variant}`,results:run.results.filter(r=>r.variant===variant)});
// 두 쪽을 비교 통계(compareRuns)에 넣을 수 있게 나눈다. active가 기준(baseline), candidate가 비교 대상이다.
export const splitPair=(run:PairRunOutcomes)=>({active:sideOf(run,'active'),candidate:sideOf(run,'candidate')});
const PASS_FAIL=['pass','fail'];
// 후보 쪽 판정 보정(비회귀 게이트라 후보에 불리하게 센다): 후보가 재질문(question_only fail)해 not_applicable이 된 채점기와 후보 쪽 grader_error는 fail로 센다.
// 그래야 산출물을 내지 않은 후보가 같은 케이스 active의 내용 채점 합격을 셈에서 지우지 못한다. active 쪽 not_applicable·grader_error와 그 밖의 not_applicable은 뺀다.
function candidateStatus(r:PairCaseOutcome|undefined,id:string){
 const s=modelStatus(r,id)??'',reask=!!r?.graders?.some(g=>g.id==='question_only'&&g.status==='fail');
 return s==='grader_error'||(s==='not_applicable'&&reask)?'fail':s;
}
// 케이스·채점기 대응 짝: active가 pass/fail이고 보정한 후보가 pass/fail인 것만 쓴다. 게이트는 프롬프트를 재므로 두 쪽 모두 모델 원문 기준 판정(prevention 우선)을 쓴다.
// 그래야 후보 프롬프트가 일으킨 스키마 경로 노출·제목 중첩을 저장 정규화가 가려도 회귀로 잡는다.
function gradedPairs(caseIds:string[],A:Map<string,PairCaseOutcome>,B:Map<string,PairCaseOutcome>){
 return caseIds.flatMap(caseId=>(A.get(caseId)?.graders||[]).map(g=>({caseId,grader:g.id,sealed:A.get(caseId)?.set==='sealed',a:modelStatus(A.get(caseId),g.id)??'',b:candidateStatus(B.get(caseId),g.id)}))).filter(p=>PASS_FAIL.includes(p.a)&&PASS_FAIL.includes(p.b));
}
const modelsOf=(side:RunOutcomes)=>side.results.filter(r=>r.status==='completed').map(r=>(r as PairCaseOutcome).model??null);
const hashOf=(basis:PairGatewayBasis,key:'operational'|'eval')=>basis?.[key]?.hash??null;
function pairFacts(run:PairRunOutcomes){
 const {active,candidate}=splitPair(run),A=byCase(active) as Map<string,PairCaseOutcome>,B=byCase(candidate) as Map<string,PairCaseOutcome>,caseIds=[...new Set(run.results.map(r=>r.caseId))];
 const complete=caseIds.filter(id=>A.get(id)?.status==='completed'&&B.get(id)?.status==='completed'),pairs=gradedPairs(complete,A,B);
 const budget=caseIds.map(id=>B.get(id)?.graders?.find(g=>g.id==='input_budget')?.status);
 return {caseIds,complete,pairs,models:{active:modelsOf(active),candidate:modelsOf(candidate)},sealedCases:caseIds.filter(id=>A.get(id)?.set==='sealed').length,
  passes:{pairs:pairs.length,active:pairs.filter(p=>p.a==='pass').length,candidate:pairs.filter(p=>p.b==='pass').length},
  sealedRegressions:pairs.filter(p=>p.sealed&&p.a==='pass'&&p.b==='fail').map(({caseId,grader})=>({caseId,grader})),inputBudget:{pass:budget.filter(s=>s==='pass').length,total:caseIds.length}};
}
type Facts=ReturnType<typeof pairFacts>;
// 조건별 거부 사유. 사유 문구는 활성화 API의 409 응답에 그대로 쓴다.
function pairReasons(run:PairRunOutcomes,f:Facts,gateway:PairGate['gateway']):PairGate['reasons']{
 const allModels=[...f.models.active,...f.models.candidate],sameModel=allModels.length>0&&allModels.every(m=>m!==null&&m===allModels[0]);
 const sameGateway=!!gateway.start&&gateway.start===gateway.end&&hashOf(run.gatewaySnapshot,'operational')===hashOf(run.gatewaySnapshotEnd,'operational');
 const rules:[boolean,PairGateCode,string][]=[
  [run.variant!=='pair','not_pair','쌍 평가(pair) 실행이 아닙니다.'],
  [run.status!=='completed'||!!run.deleted,'not_completed',run.deleted?'삭제한 평가 실행입니다.':`평가 실행이 끝나지 않았습니다(상태 ${run.status??'미상'}).`],
  [!f.caseIds.length||f.complete.length<f.caseIds.length,'incomplete_cases',`두 쪽 모두 completed인 케이스가 ${f.complete.length}/${f.caseIds.length}건입니다. 모든 케이스가 두 쪽 모두 끝나야 합니다.`],
  [!sameGateway,'gateway_changed','게이트웨이 스냅샷 해시가 시작·종료 시점에 다르거나 확인되지 않았습니다.'],
  [!sameModel,'model_changed',`보고 모델이 두 쪽·전 구간에서 같지 않거나 보고되지 않았습니다(${[...new Set(allModels.map(m=>m??'미보고'))].join(', ')||'없음'}).`],
  [f.passes.candidate<f.passes.active,'fewer_passes',`코드 채점 합격 수가 후보 ${f.passes.candidate} < active ${f.passes.active}입니다(대응 ${f.passes.pairs}쌍).`],
  [!f.sealedCases,'sealed_missing','봉인(sealed) 케이스가 없습니다. 봉인 회귀 조건이 빈 조건이 되지 않게 봉인 세트 케이스를 1건 이상 넣어 쌍 평가하세요.'],
  [f.sealedRegressions.length>0,'sealed_regression',`봉인 세트 회귀 ${f.sealedRegressions.length}건(active pass → 후보 fail: ${f.sealedRegressions.slice(0,5).map(x=>x.grader).join(', ')}).`],
  [!f.inputBudget.total||f.inputBudget.pass<f.inputBudget.total,'input_budget',`input_budget 채점기 후보 합격이 ${f.inputBudget.pass}/${f.inputBudget.total}건입니다. 후보는 전부 pass여야 합니다.`],
 ];
 return rules.filter(([failed])=>failed).map(([,code,message])=>({code,message}));
}
// 활성화 게이트 판정. 모든 조건을 모아 한 번에 돌려준다(첫 사유에서 멈추지 않는다).
export function pairGate(run:PairRunOutcomes):PairGate{
 const f=pairFacts(run),gateway={start:hashOf(run.gatewaySnapshot,'eval'),end:hashOf(run.gatewaySnapshotEnd,'eval')},reasons=pairReasons(run,f,gateway);
 const warnings=f.passes.pairs<MIN_PAIRS?[{code:'small_sample' as const,message:`대응 ${f.passes.pairs}쌍(케이스 ${f.caseIds.length}건 · 봉인 ${f.sealedCases}건)으로 ${MIN_PAIRS}쌍 미만입니다. 최소 케이스 수는 강제하지 않으며(대표 결정 전) 이 게이트는 비회귀만 봅니다.`}]:[];
 return {ok:!reasons.length,reasons,warnings,cases:f.caseIds.length,sealedCases:f.sealedCases,passes:f.passes,sealedRegressions:f.sealedRegressions,inputBudget:f.inputBudget,models:f.models,gateway};
}
// ── 반복 쌍 평가 과반 게이트(대표 결정 2026-09-27 "v4 + 반복 채점") ──
// 같은 단위·후보·기준(호출자가 검사)으로 돌린 pair run 여러 개를 (케이스·채점기)마다 과반으로 판정한다. 모델 출력의 흔들림 한 번이 회귀로 잡히지 않게 하려는 것이다.
// 회귀: active가 과반 pass이고 후보가 과반 fail(동률은 후보에 불리하게 fail). input_budget: 후보가 케이스마다 과반 pass. 합격 수: 양쪽 과반 판정이 있는 대응 짝끼리 센다.
// 구조 조건(pair·완료·케이스 완료·게이트웨이·모델·봉인 포함)은 run마다 pairGate 그대로 보고, 보고 모델은 모든 run에서 같아야 하며 케이스 구성도 같아야 한다.
// run 하나면 pairGate와 같다(repeats 1).
const STRUCTURAL:readonly PairGateCode[]=['not_pair','not_completed','incomplete_cases','gateway_changed','model_changed','sealed_missing'];
type Votes={sealed:boolean;a:string[];b:string[]};
const votesOf=(xs:string[],v:string)=>xs.filter(x=>x===v).length;
function majorityVotes(runs:readonly PairRunOutcomes[]){
 const votes=new Map<string,Votes>();
 for(const run of runs){
  const f=pairFacts(run);
  for(const p of f.pairs){const k=`${p.caseId}\u0000${p.grader}`,v=votes.get(k)??{sealed:p.sealed,a:[],b:[]};votes.set(k,{sealed:v.sealed,a:[...v.a,p.a],b:[...v.b,p.b]})}
 }
 return votes;
}
export function pairGateMajority(runs:readonly PairRunOutcomes[]):PairGate&{repeats:number}{
 if(!runs.length)throw new Error('반복 쌍 평가 run이 없습니다.');
 if(runs.length===1)return {...pairGate(runs[0]),repeats:1};
 const k=runs.length,half=k/2,gates=runs.map(pairGate),facts=runs.map(pairFacts);
 const structural=STRUCTURAL.flatMap(code=>{const bad=runs.filter((_,i)=>gates[i].reasons.some(r=>r.code===code));return bad.length?[{code,message:`${gates[runs.indexOf(bad[0])].reasons.find(r=>r.code===code)!.message} (run ${bad.map(r=>r.id).join(', ')})`}]:[]});
 const caseKey=(f:Facts)=>[...f.caseIds].sort().join(','),sameCases=facts.every(f=>caseKey(f)===caseKey(facts[0]));
 const models=[...new Set(gates.flatMap(g=>[...g.models.active,...g.models.candidate]))],sameModel=models.length===1&&models[0]!==null;
 const votes=[...majorityVotes(runs)].map(([key,v])=>{const [caseId,grader]=key.split('\u0000');return {caseId,grader,...v}});
 const decided=votes.map(v=>({...v,aPass:votesOf(v.a,'pass')>half,aFail:votesOf(v.a,'fail')>half,bPass:votesOf(v.b,'pass')>half,bFail:votesOf(v.b,'pass')<=half}));
 const pairs=decided.filter(v=>(v.aPass||v.aFail));
 const passes={pairs:pairs.length,active:pairs.filter(v=>v.aPass).length,candidate:pairs.filter(v=>v.bPass).length};
 const sealedRegressions=decided.filter(v=>v.sealed&&v.aPass&&v.bFail).map(({caseId,grader})=>({caseId,grader}));
 const caseIds=facts[0].caseIds,budgetPass=caseIds.filter(id=>votesOf(runs.map(run=>splitPair(run).candidate.results.find(r=>r.caseId===id)?.graders?.find(g=>g.id==='input_budget')?.status??''),'pass')>half).length;
 const inputBudget={pass:budgetPass,total:caseIds.length};
 const rules:[boolean,PairGateCode,string][]=[
  [!sameCases,'case_set_mismatch',`반복 쌍 평가 run들의 케이스 구성이 다릅니다(${runs.map(r=>r.id).join(', ')}). 같은 케이스로 다시 평가하세요.`],
  [!sameModel&&!structural.some(r=>r.code==='model_changed'),'model_changed',`보고 모델이 반복 run 사이에 같지 않거나 보고되지 않았습니다(${models.map(m=>m??'미보고').join(', ')||'없음'}).`],
  [passes.candidate<passes.active,'fewer_passes',`과반 판정 코드 채점 합격 수가 후보 ${passes.candidate} < active ${passes.active}입니다(대응 ${passes.pairs}쌍, 반복 ${k}회).`],
  [sealedRegressions.length>0,'sealed_regression',`봉인 세트 과반 회귀 ${sealedRegressions.length}건(active 과반 pass → 후보 과반 fail, 반복 ${k}회: ${sealedRegressions.slice(0,5).map(x=>x.grader).join(', ')}).`],
  [!inputBudget.total||inputBudget.pass<inputBudget.total,'input_budget',`input_budget 후보 과반 합격이 ${inputBudget.pass}/${inputBudget.total}건입니다(반복 ${k}회). 후보는 케이스마다 과반 pass여야 합니다.`],
 ];
 const reasons=[...structural,...rules.filter(([failed])=>failed).map(([,code,message])=>({code,message}))];
 const sealedCases=facts[0].sealedCases;
 const warnings=passes.pairs<MIN_PAIRS?[{code:'small_sample' as const,message:`과반 판정 대응 ${passes.pairs}쌍(케이스 ${caseIds.length}건 · 봉인 ${sealedCases}건, 반복 ${k}회)으로 ${MIN_PAIRS}쌍 미만입니다. 최소 케이스 수는 강제하지 않으며(대표 결정 전) 이 게이트는 비회귀만 봅니다.`}]:[];
 return {ok:!reasons.length,reasons,warnings,cases:caseIds.length,sealedCases,passes,sealedRegressions,inputBudget,models:{active:gates.flatMap(g=>g.models.active),candidate:gates.flatMap(g=>g.models.candidate)},gateway:{start:gates[0].gateway.start,end:gates[k-1].gateway.end},repeats:k};
}
// GET /api/eval?pair=<run>: 두 쪽 비교 통계와 게이트 판정.
export const pairReport=(run:PairRunOutcomes)=>{const {active,candidate}=splitPair(run);return {comparison:compareRuns(active,candidate),gate:pairGate(run)}};
