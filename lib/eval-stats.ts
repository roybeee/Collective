// 평가 run 비교 통계(F1b-2). 같은 케이스의 두 run을 채점기별로 대응 비교하고 McNemar 정확 검정(양측 이항, p=0.5)으로 판정한다.
// import가 없는 순수 모듈이다. 서버(app/api/eval), 화면, 테스트가 그대로 쓴다. 규칙: docs/EVAL.ko.md '비교 통계 규칙'.
export class EvalStatsError extends Error{status=422;constructor(message:string){super(message);this.name='EvalStatsError'}}
// 대응 케이스 n이 이보다 작으면 개선·회귀를 주장하지 않는다. 유의 수준은 양측 0.05다.
export const MIN_PAIRS=30,ALPHA=0.05;
// Workers CPU 한도 안에서 끝나도록 불일치 쌍 수의 상한을 둔다. 평가 run 한 번의 케이스 수(100)보다 훨씬 크다.
const MAX_DISCORDANT=1e6;
export type ComparisonVerdict='improved'|'regressed'|'non_regression'|'inconclusive'|'insufficient';
export type CaseOutcome={caseId:string;status:string;graders?:readonly {id:string;status:string}[]};
export type RunOutcomes={id:string;results:readonly CaseOutcome[]};
export type GraderComparison={id:string;n:number;b:number;c:number;bothPass:number;bothFail:number;p:number;verdict:ComparisonVerdict};
export type RunComparison={baseline:string;candidate:string;sharedCases:number;onlyBaseline:number;onlyCandidate:number;sameCaseSet:boolean;minPairs:number;alpha:number;graders:GraderComparison[]};

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
const graderStatus=(r:CaseOutcome|undefined,id:string)=>r?.status==='completed'?r.graders?.find(g=>g.id===id)?.status:undefined;
function compareGrader(id:string,shared:string[],A:Map<string,CaseOutcome>,B:Map<string,CaseOutcome>):GraderComparison{
 const pairs=shared.map(caseId=>[graderStatus(A.get(caseId),id),graderStatus(B.get(caseId),id)]).filter(([x,y])=>(x==='pass'||x==='fail')&&(y==='pass'||y==='fail'));
 const tally=(x:string,y:string)=>pairs.filter(p=>p[0]===x&&p[1]===y).length;
 const b=tally('pass','fail'),c=tally('fail','pass'),p=mcnemarExact(b,c);
 return {id,n:pairs.length,b,c,bothPass:tally('pass','pass'),bothFail:tally('fail','fail'),p,verdict:comparisonVerdict(pairs.length,b,c,p)};
}
// baseline(기준, 예: active)과 candidate(후보)를 비교한다. 두 run 모두 completed인 케이스만 짝이 되고, 채점기 결과가 pass/fail이 아니면 그 짝은 뺀다.
export function compareRuns(baseline:RunOutcomes,candidate:RunOutcomes):RunComparison{
 const A=byCase(baseline),B=byCase(candidate),shared=[...A.keys()].filter(id=>B.has(id));
 const ids=[...new Set([...baseline.results,...candidate.results].flatMap(r=>(r.graders||[]).map(g=>g.id)))];
 return {baseline:baseline.id,candidate:candidate.id,sharedCases:shared.length,onlyBaseline:A.size-shared.length,onlyCandidate:B.size-shared.length,sameCaseSet:shared.length===A.size&&shared.length===B.size,minPairs:MIN_PAIRS,alpha:ALPHA,graders:ids.map(id=>compareGrader(id,shared,A,B))};
}
