// 실패 유형 사전 v1 채점기의 공통 타입. 채점기는 순수 함수이며 상대 import만 쓴다(docs/EVAL.ko.md).
export type GraderStatus='pass'|'fail'|'not_applicable'|'grader_error';
export type GraderResult={id:string;status:GraderStatus;detail?:string};
export type Verdict={status:Exclude<GraderStatus,'grader_error'>;detail?:string};
// input: 사람이 쓴 입력(브리프 목표·회의 안건). brief: 브리프 초안. role: 역할 산출물(quality 포함). discussion: 회의 발언.
// meeting_step: 회의의 합의·개선본·품질 재검토 단계(G3). call: 사용량 원장의 호출 1건.
export type EvalKind='input'|'brief'|'role'|'discussion'|'meeting_step'|'call';
export type EvalItem={
 id:string;
 kind:EvalKind;
 role?:string;
 // 사람이 읽는 본문. 역할 계약 실행이면 앱이 렌더한 '## 계약 제목' 본문이다.
 text?:string;
 // 원 JSON(role-output-v1). 있으면 계약 검사에 쓰고, text가 없으면 렌더해 본문으로 쓴다.
 raw?:string;
 // role-output-v1 계약으로 실행된 산출물인지. 아니면 계약 이전(legacy) 본문이다. 회의 품질 재검토면 실무 스킬 회의(skillVersion)의 checks·taskChecks 계약 적용 여부다.
 contract?:boolean;
 // 회의 발언 JSON(position/evidence/challenge/proposal/respondsTo). 회의 단계·브리프는 raw가 없을 때 쓰는 단계 출력·초안 JSON이다.
 fields?:Record<string,unknown>;
 // 같은 회의에서 이 발언보다 앞서 완료된 발언의 역할.
 priorRoles?:string[];
 meetingId?:string;
 inputTokens?:number|null;
 // 회의 단계(meeting_step)의 종류: synthesis 합의, revision 개선본, quality 품질 재검토. 회의 단계 채점기는 raw(모델 원문 JSON) 또는 fields를 읽는다.
 phase?:'synthesis'|'revision'|'quality';
 // 개선본이 고치는 원 작업물 본문(모델이 받은 발췌). revision_repeat가 대조한다.
 original?:string;
 // 품질 재검토가 taskChecks로 대조할 합의 과제 담당 역할(합의 단계 tasks의 role).
 taskRoles?:string[];
};
// 평가 케이스 expectations.seededDefects의 한 건: 상류 산출물에 일부러 심은 결함.
// role: 결함을 심은 작업물 역할(개선본은 같은 역할만 판정). marker: 심은 결함 문구 원문(개선본이 부정·배제 없이 다시 쓰면 미수정).
// keywords: 품질 재검토가 결함을 지적했다고 볼 고유 표현(marker와 함께 하나라도 나오면 지적). id는 보고용이다.
export type SeededDefect={id:string;role?:string;marker?:string;keywords?:string[]};
export type FactLedger={confirmed:{key?:unknown;value?:unknown}[];prohibited:{key?:unknown;value?:unknown}[]};
export type GradeContext={
 // 골든 케이스에서 사람이 큐레이션한 금지 표현(브리프·안건의 '사용하지 않는다' 대상).
 prohibitedTerms?:string[];
 // 확정·거절 사실 원장. 없으면 fact_conflict는 not_applicable이다.
 facts?:FactLedger|null;
 // 캠페인 업종 ID(fnb, locker, kpop, beauty, education, popup, retail 등). 배열이면 [주 업종, ...허용 업종]. 없거나 비면 industry_metric_leak는 not_applicable이다.
 industry?:string|string[]|null;
 // F&B·점포 캠페인 여부(local_channel_coverage 대상).
 localStore?:boolean;
 inputTokenCap?:number;
 // 심은 결함. 없으면 seeded_defect_detection은 not_applicable이다.
 seededDefects?:SeededDefect[];
 // 미확인 브랜드 소개 원문(brand.brandIntro)과 브랜드 이름(소개문 대조에서 뺀다). 소개가 없으면 brand_intro_as_fact는 not_applicable이다.
 brandIntro?:string;
 brandName?:string;
 // 브리프 초안 요청의 사용자 입력 원문(현재 브리프 필드·시작/종료일·기준일). 여기 적힌 가격·날짜는 사용자가 준 값이라 단정으로 보지 않는다.
 briefInput?:string;
};
export type Grader={id:string;content?:boolean;grade:(item:EvalItem,ctx:GradeContext)=>Verdict};
export const verdict=(status:Verdict['status'],detail?:string|string[]):Verdict=>{
 const text=Array.isArray(detail)?detail.join('; '):detail;
 return text?{status,detail:text.slice(0,500)}:{status};
};
// 회의 단계·브리프 항목의 출력 JSON 객체: fields가 있으면 그것, 없으면 raw를 코드펜스를 벗겨 읽는다. 객체가 아니면 null.
export function outputObject(item:EvalItem):Record<string,unknown>|null{
 if(item.fields)return item.fields;
 try{const x=JSON.parse((item.raw||'').trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,''));return x&&typeof x==='object'&&!Array.isArray(x)?x:null}
 catch{return null}
}
// 출력 JSON 원문: raw가 있으면 그대로, 없으면 fields를 직렬화한다. 둘 다 없으면 undefined.
export const outputText=(item:EvalItem)=>item.raw??(item.fields?JSON.stringify(item.fields):undefined);
// 출력 JSON의 사람이 읽는 문자열 값. 판정·역할·참조·제안 키 같은 코드 필드(lib/meetings.ts codeKeys와 brief 제안 field)는 뺀다.
const CODE_KEYS=new Set(['respondsTo','role','verdict','reportedVerdict','status','criterion','field']);
export function proseValues(value:unknown,key=''):string[]{
 if(CODE_KEYS.has(key))return [];
 if(typeof value==='string')return [value];
 if(Array.isArray(value))return value.flatMap(v=>proseValues(v));
 return value&&typeof value==='object'?Object.entries(value).flatMap(([k,v])=>proseValues(v,k)):[];
}
// 브리프 초안에서 캠페인 계획이 되는 본문: summary와 제안 값. 사용자에게 되묻는 questions와 참고 목록(assumptions·contextUsed·factCandidates)은 뺀다.
export const briefPlanValues=(x:Record<string,unknown>)=>[x.summary,...(Array.isArray(x.suggestions)?x.suggestions:[]).map(s=>(s as {value?:unknown}|null)?.value)].filter((v):v is string=>typeof v==='string');
