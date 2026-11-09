// 실행 타임라인(GLOBAL-PLAN X2)의 상태 어휘와 항목 변환(순수 모듈). 회의 단계와 역할 실행(jobs)을 같은 모양으로 그린다.
// 모르는 상태(이전 기록·새 공급자 값)는 '상태 미확인'으로 그려 화면이 비지 않게 한다. 색만으로 상태를 구분하지 않도록 글자 라벨을 늘 함께 낸다.
import type {MeetingPhase} from './meetings';
export type TimelineTone='idle'|'live'|'wait'|'done'|'fail'|'stop'|'unknown';
export type TimelineItem={id:string;title:string;subtitle?:string;status:string;phase?:MeetingPhase;activity?:string;startedAt?:string|null;finishedAt?:string|null;attempt?:number;tokens?:number|null;error?:string|null};
export type StatusView={label:string;tone:TimelineTone;live:boolean};
// '생각 중'은 단계가 실제로 하는 일(구체 동사)로 적는다. 역할 실행(phase 없음)은 근거 정리로 본다.
const thinkingVerbs:Record<MeetingPhase,string>={discussion:'근거 정리 중',synthesis:'합의안 정리 중',revision:'개선본 작성 중',quality:'검수 항목 대조 중'};
const fixed:Record<string,StatusView>={
 pending:{label:'대기',tone:'idle',live:false},
 starting:{label:'요청 준비 중',tone:'live',live:true},
 queued:{label:'접수 대기 중',tone:'live',live:true},
 running:{label:'실행 중',tone:'live',live:true},
 in_progress:{label:'실행 중',tone:'live',live:true},
 waiting_for_approval:{label:'승인 대기',tone:'wait',live:true},
 uncertain:{label:'접수 확인 필요',tone:'wait',live:false},
 completed:{label:'완료',tone:'done',live:false},
 failed:{label:'실패',tone:'fail',live:false},
 cancelled:{label:'취소',tone:'stop',live:false},
 incomplete:{label:'중단됨',tone:'stop',live:false},
};
export const knownStatuses=Object.keys(fixed).concat('thinking');
export function statusView(status:string,phase?:MeetingPhase):StatusView{
 if(status==='thinking')return {label:phase?thinkingVerbs[phase]:thinkingVerbs.discussion,tone:'live',live:true};
 return fixed[status]??{label:'상태 미확인',tone:'unknown',live:false};
}
const time=(s:string|null|undefined)=>{const t=s?Date.parse(s):NaN;return Number.isFinite(t)?t:null};
// 경과 시간: 끝났으면 시작→종료, 진행 중이면 시작→지금. 시작 시각을 모르면 null.
export function elapsedMs(item:Pick<TimelineItem,'startedAt'|'finishedAt'|'status'>,now=Date.now()):number|null{
 const start=time(item.startedAt);if(start===null)return null;
 const end=time(item.finishedAt)??(statusView(item.status).live?now:null);
 return end===null?null:Math.max(0,end-start);
}
export function formatElapsed(ms:number|null):string{
 if(ms===null)return '경과 미확인';
 const s=Math.floor(ms/1000);if(s<60)return `${s}초`;
 const m=Math.floor(s/60),rest=s%60;if(m<60)return `${m}분 ${String(rest).padStart(2,'0')}초`;
 return `${Math.floor(m/60)}시간 ${m%60}분`;
}
type StepLike={id:string;role:string;phase:MeetingPhase;status:string;activity?:string;startedAt?:string;completedAt?:string;attempt?:number;tokens?:number;error?:string};
type RoleName=(id:string)=>string;
// 회의 단계 → 타임라인. 대기 단계는 그대로 두어 남은 순서가 보인다.
export function meetingTimeline(steps:readonly StepLike[],roleName:RoleName,phaseName:(p:MeetingPhase)=>string):TimelineItem[]{
 return steps.map(s=>({id:s.id,title:roleName(s.role),subtitle:phaseName(s.phase),status:s.status,phase:s.phase,activity:s.activity,startedAt:s.startedAt??null,finishedAt:s.completedAt??null,attempt:(s.attempt??0)+1,tokens:typeof s.tokens==='number'?s.tokens:null,error:s.error??null}));
}
type RunLike={id:string;role:string;status:string;createdAt:string;startedAt?:string|null;finishedAt?:string|null;tokens?:number;error?:string|null};
// 역할 실행(jobs) → 타임라인. 시작 시각은 접수 시각(createdAt)이다. 종료 시각은 기록이 있을 때만 쓴다(없으면 경과를 꾸미지 않는다).
export function runTimeline(runs:readonly RunLike[],roleName:RoleName,limit=12):TimelineItem[]{
 return [...runs].sort((a,b)=>String(a.createdAt).localeCompare(String(b.createdAt))).slice(-limit)
  .map(r=>({id:r.id,title:roleName(r.role),status:r.status,startedAt:r.startedAt??r.createdAt,finishedAt:r.finishedAt??(statusView(r.status).live?null:undefined),tokens:typeof r.tokens==='number'&&r.tokens>0?r.tokens:null,error:r.error??null}));
}
// 진행 중 항목이 있으면 화면은 3초마다 조회하고 1초마다 경과를 다시 그린다.
export const POLL_RUNNING_MS=3000;
export const hasLive=(items:readonly Pick<TimelineItem,'status'>[])=>items.some(i=>statusView(i.status).live);
