// 실패 유형 사전 v1 채점기의 공통 타입. 채점기는 순수 함수이며 상대 import만 쓴다(docs/EVAL.ko.md).
export type GraderStatus='pass'|'fail'|'not_applicable'|'grader_error';
export type GraderResult={id:string;status:GraderStatus;detail?:string};
export type Verdict={status:Exclude<GraderStatus,'grader_error'>;detail?:string};
// input: 사람이 쓴 입력(브리프 목표·회의 안건). brief: 브리프 초안. role: 역할 산출물(quality 포함). discussion: 회의 발언. call: 사용량 원장의 호출 1건.
export type EvalKind='input'|'brief'|'role'|'discussion'|'call';
export type EvalItem={
 id:string;
 kind:EvalKind;
 role?:string;
 // 사람이 읽는 본문. 역할 계약 실행이면 앱이 렌더한 '## 계약 제목' 본문이다.
 text?:string;
 // 원 JSON(role-output-v1). 있으면 계약 검사에 쓰고, text가 없으면 렌더해 본문으로 쓴다.
 raw?:string;
 // role-output-v1 계약으로 실행된 산출물인지. 아니면 계약 이전(legacy) 본문이다.
 contract?:boolean;
 // 회의 발언 JSON(position/evidence/challenge/proposal/respondsTo).
 fields?:Record<string,unknown>;
 // 같은 회의에서 이 발언보다 앞서 완료된 발언의 역할.
 priorRoles?:string[];
 meetingId?:string;
 inputTokens?:number|null;
};
export type FactLedger={confirmed:{key?:unknown;value?:unknown}[];prohibited:{key?:unknown;value?:unknown}[]};
export type GradeContext={
 // 골든 케이스에서 사람이 큐레이션한 금지 표현(브리프·안건의 '사용하지 않는다' 대상).
 prohibitedTerms?:string[];
 // 확정·거절 사실 원장. 없으면 fact_conflict는 not_applicable이다.
 facts?:FactLedger|null;
 // 캠페인 업종 ID(fnb, locker, kpop, beauty 등). 없으면 industry_metric_leak는 not_applicable이다.
 industry?:string|null;
 // F&B·점포 캠페인 여부(local_channel_coverage 대상).
 localStore?:boolean;
 inputTokenCap?:number;
};
export type Grader={id:string;content?:boolean;grade:(item:EvalItem,ctx:GradeContext)=>Verdict};
export const verdict=(status:Verdict['status'],detail?:string|string[]):Verdict=>{
 const text=Array.isArray(detail)?detail.join('; '):detail;
 return text?{status,detail:text.slice(0,500)}:{status};
};
