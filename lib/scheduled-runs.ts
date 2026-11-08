// G3 예약 실행(순수 모듈). 소유자가 KST 요일+시각으로 정한 예약이 워커 큐 'scheduled_runs'에서 돈다(lib/scheduled-runs-server.ts).
// 행동은 두 가지뿐이다: create_meeting_draft(최근 7일 성과 요약을 담은 회의 안건 초안 기록, HERMES 호출 없음)과 create_agenda_item(오늘의 안건에 보이는 감지 신호 기록).
// 멱등 키는 (예약 id, 기간)이고 기간은 KST 날짜다. 같은 날 두 번째 tick은 실행 기록을 읽고 끝난다.
import type {Metric} from './agency';

export const SCHEDULE_KINDS=['weekly_performance_summary','daily_signal_review'] as const;
export type ScheduleKind=typeof SCHEDULE_KINDS[number];
export const SCHEDULE_ACTIONS=['create_meeting_draft','create_agenda_item'] as const;
export type ScheduleAction=typeof SCHEDULE_ACTIONS[number];
export const SCHEDULE_KIND_LABELS:Record<ScheduleKind,string>={weekly_performance_summary:'주간 성과 요약',daily_signal_review:'일일 신호 검토'};
export const SCHEDULE_ACTION_LABELS:Record<ScheduleAction,string>={create_meeting_draft:'회의 안건 초안 만들기',create_agenda_item:'오늘의 안건에 올리기'};
export const WEEKDAY_LABELS=['일','월','화','수','목','금','토'] as const;
export type ScheduleSpec={weekdays:number[];hour:number};
export type ScheduleInput={kind:ScheduleKind;action:ScheduleAction;brandId:string;campaignId:string;spec:ScheduleSpec;title:string};
export type Schedule=ScheduleInput&{id:string;version:number;enabled:boolean;createdAt:string;updatedAt:string;createdBy:string};
export type ScheduledRunStatus='completed'|'skipped'|'failed';
export type ScheduledRun={id:string;scheduleId:string;period:string;kind:ScheduleKind;action:ScheduleAction;brandId:string;campaignId:string;status:ScheduledRunStatus;reason:string;outputId:string|null;generatedAt:string;durationMs:number};

export class ScheduledRunError extends Error{constructor(message:string){super(message);this.name='ScheduledRunError'}}
const KST=9*3600000,DAY=86400000,ID=/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/;

function identifier(value:unknown,label:string):string{
 if(typeof value!=='string'||!value||value.length>160||!ID.test(value))throw new ScheduledRunError(`${label} 식별자를 확인하세요.`);
 return value;
}
function enumeration<T extends string>(value:unknown,values:readonly T[],label:string):T{
 if(!values.includes(value as T))throw new ScheduledRunError(`${label} 값을 확인하세요.`);
 return value as T;
}
export function parseScheduleSpec(value:unknown):ScheduleSpec{
 if(!value||typeof value!=='object'||Array.isArray(value))throw new ScheduledRunError('실행 시각(요일·시) 객체가 필요합니다.');
 const input=value as Record<string,unknown>,days=input.weekdays;
 if(!Array.isArray(days)||!days.length||days.length>7||days.some(d=>!Number.isInteger(d)||Number(d)<0||Number(d)>6))throw new ScheduledRunError('요일은 0(일)~6(토) 사이 정수 1개 이상이어야 합니다.');
 if(!Number.isInteger(input.hour)||Number(input.hour)<0||Number(input.hour)>23)throw new ScheduledRunError('시각은 0~23 사이 정수(KST)여야 합니다.');
 return {weekdays:[...new Set(days.map(Number))].sort((a,b)=>a-b),hour:Number(input.hour)};
}
export function parseScheduleInput(value:unknown):ScheduleInput{
 if(!value||typeof value!=='object'||Array.isArray(value))throw new ScheduledRunError('예약 입력 객체가 필요합니다.');
 const input=value as Record<string,unknown>;
 const title=input.title===undefined?'':input.title;
 if(typeof title!=='string'||title.length>120||/[\x00-\x1f\x7f]/.test(title))throw new ScheduledRunError('예약 이름은 120자 이하 한 줄이어야 합니다.');
 return {kind:enumeration(input.kind,SCHEDULE_KINDS,'예약 종류'),action:enumeration(input.action,SCHEDULE_ACTIONS,'예약 행동'),
  brandId:identifier(input.brandId,'브랜드'),campaignId:identifier(input.campaignId,'캠페인'),spec:parseScheduleSpec(input.spec),title:title.trim()};
}
export function kstParts(now:number){
 const local=new Date(now+KST);
 return {day:local.toISOString().slice(0,10),weekday:local.getUTCDay(),hour:local.getUTCHours()};
}
// 오늘(KST) 이 예약이 돌 차례인지. 요일이 맞고 정한 시각이 지났으면 그 날짜가 기간이다. 하루에 한 번만 돈다.
export function periodFor(schedule:Pick<Schedule,'spec'|'enabled'>,now:number):string|null{
 if(!schedule.enabled)return null;
 const {day,weekday,hour}=kstParts(now);
 return schedule.spec.weekdays.includes(weekday)&&hour>=schedule.spec.hour?day:null;
}
export const scheduledRunId=(scheduleId:string,period:string)=>`${scheduleId}:${period}`;
export const scheduleTitle=(s:Pick<Schedule,'title'|'kind'>)=>s.title||SCHEDULE_KIND_LABELS[s.kind];
export const describeSpec=(spec:ScheduleSpec)=>`매주 ${spec.weekdays.map(d=>WEEKDAY_LABELS[d]).join('·')} ${String(spec.hour).padStart(2,'0')}:00(KST)`;

type MetricLike=Pick<Metric,'period'|'periodStart'|'periodEnd'|'revenue'|'adSpend'|'orders'|'variableCosts'>;
const inWindow=(m:MetricLike,from:string,to:string)=>{const end=m.periodEnd||m.period||'',start=m.periodStart||m.period||'';return !!end&&end>=from&&start<=to};
const sum=(values:(number|null|undefined)[])=>{const known=values.filter((v):v is number=>typeof v==='number'&&Number.isFinite(v));return known.length?known.reduce((a,b)=>a+b,0):null};
const won=(v:number|null)=>v===null?'미확인':`${Math.round(v).toLocaleString('ko-KR')}원`;
// 최근 7일(KST 날짜 기준) 성과 기록을 규칙으로 요약한다. 숫자가 없으면 미확인으로 쓴다(추정하지 않는다).
export function summarizeMetrics(metrics:readonly MetricLike[],now:number){
 const to=kstParts(now).day,from=kstParts(now-6*DAY).day,rows=metrics.filter(m=>inWindow(m,from,to));
 const revenue=sum(rows.map(m=>m.revenue)),adSpend=sum(rows.map(m=>m.adSpend)),orders=sum(rows.map(m=>m.orders)),costs=sum(rows.map(m=>m.variableCosts));
 const lines=[`기간: ${from} ~ ${to} (성과 기록 ${rows.length}건)`,`매출: ${won(revenue)}`,`광고비: ${won(adSpend)}`,`변동비: ${won(costs)}`,`주문: ${orders===null?'미확인':`${orders.toLocaleString('ko-KR')}건`}`];
 if(!rows.length)lines.push('이 기간의 성과 기록이 없습니다. 실측 입력 뒤 다시 검토하세요.');
 return {from,to,count:rows.length,revenue,adSpend,orders,costs,text:lines.join('\n')};
}
export function meetingDraftAgenda(schedule:Pick<Schedule,'title'|'kind'>,summary:ReturnType<typeof summarizeMetrics>){
 return [`[예약 실행] ${scheduleTitle(schedule)}`,summary.text,'논의: 지난 7일 성과에서 유지할 것·바꿀 것·다음 주 실험 1개를 정합니다.','이 안건은 기록된 성과를 규칙으로 요약한 초안이며 모델 호출 없이 만들어졌습니다. 회의 시작은 담당자가 확인한 뒤 누릅니다.'].join('\n\n');
}
export function agendaSignalText(schedule:Pick<Schedule,'title'|'kind'>,period:string){
 return {title:`${scheduleTitle(schedule)} 검토`,detail:`${period} 예약 실행이 올린 검토 항목입니다. 지난 기간 신호·성과를 확인하고 담당·기한을 정하세요.`};
}
