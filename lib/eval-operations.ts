import type {EvalCase,EvalRun} from './eval-server';
import {pairGate} from './eval-stats';

// 오류 원문에는 외부 응답·입력이 섞일 수 있으므로 정해진 분류만 보낸다.
function failureCategory(error:string|undefined){
 if(error==='동결한 요청으로 지시문을 만들지 못했습니다.')return '동결 요청 조립 실패';
 if(error==='평가 케이스가 삭제됐습니다.')return '평가 케이스 없음';
 if(error==='HERMES 실행 번호를 확인하지 못했습니다.')return 'HERMES 실행 번호 없음';
 const http=/^평가 HERMES 요청을 처리하지 못했습니다 \(([1-5]\d\d)\)\.$/.exec(error||'');
 if(http)return `평가 HERMES HTTP ${http[1]}`;
 if(error?.startsWith('HERMES 실행이 완료되지 않았습니다('))return 'HERMES 실행 실패';
 if(error?.startsWith('남은 토큰 예산이'))return '실행 토큰 예산 부족';
 if(error?.startsWith('이번 달 평가 토큰 월 상한'))return '월 토큰 상한';
 if(error?.startsWith('HERMES가 토큰 사용량을 보고하지 않아'))return '토큰 사용량 미보고';
 return '기타 실행 오류';
}

// 운영 화면에는 동결 요청·출력·기대 판정·케이스별 채점 근거를 보내지 않는다.
export function operationsSummary(cases:EvalCase[],runs:EvalRun[]){
 return {
  cases:cases.map(c=>({id:c.id,kind:c.kind??'role',role:c.role,set:c.set})),
  runs:runs.filter(r=>!r.deleted).map(r=>{
   const latest=r.regrades?.at(-1),gate=r.variant==='pair'?pairGate(r):null;
   return {id:r.id,label:r.label,status:r.status,variant:r.variant,usedTokens:r.usedTokens,createdAt:r.createdAt,
    completed:r.results.filter(x=>x.status==='completed').length,total:r.results.length,
    submitted:r.results.filter(x=>!!x.providerRunId).length,
    failures:r.results.filter(x=>['failed','blocked','not_run','cancelled'].includes(x.status)).reduce<Record<string,number>>((a,x)=>{const key=failureCategory(x.error);a[key]=(a[key]||0)+1;return a},{}),
    pair:r.pair?{unit:r.pair.unit,candidateVersionId:r.pair.candidateVersionId}:null,
    gate:gate?{ok:gate.ok,reasons:gate.reasons,warnings:gate.warnings,cases:gate.cases,sealedCases:gate.sealedCases,passes:gate.passes,inputBudget:gate.inputBudget}:null,
    regrade:latest?{id:latest.id,at:latest.at,gradersVersion:latest.gradersVersion,totals:latest.totals}:null};
  }),
 };
}
