// G3 일일 요약(순수 모듈). 기존 안건(lib/agenda-server.ts)·예약 실행 기록·사용량 장부에서 한 화면 분량의 한국어 문장을 만든다.
// 모델 호출·외부 전송 없음. 전송은 lib/digest-server.ts의 어댑터(mail 스텁, 알림톡은 뒤에 같은 계약으로)가 맡는다.
export type DigestAgendaCounts={overdue:number;decision:number;signal:number;upcoming:number};
export type DigestAgendaItem={title:string;campaignTitle:string;due:string|null};
export type DigestRun={title:string;status:'completed'|'skipped'|'failed';reason:string};
export type DigestCost={amount:number|null;currency:string|null;runs:number;unknownRuns:number};
export type DigestInput={day:string;agenda:{counts:DigestAgendaCounts;items:readonly DigestAgendaItem[];total:number};runs:readonly DigestRun[];cost:DigestCost};
export type Digest={subject:string;lines:string[];text:string};

const MAX_ITEMS=5,MAX_RUNS=5;
const count=(n:number)=>`${n.toLocaleString('ko-KR')}건`;
const runLabel:Record<DigestRun['status'],string>={completed:'완료',skipped:'건너뜀',failed:'실패'};
function costLine(cost:DigestCost){
 if(!cost.runs)return '비용: 오늘 기록된 AI 사용량이 없습니다.';
 const amount=cost.amount===null?'금액 미확인':`${Math.round(cost.amount).toLocaleString('ko-KR')}${cost.currency==='KRW'||!cost.currency?'원':` ${cost.currency}`}`;
 return `비용: ${amount} (사용 ${count(cost.runs)}${cost.unknownRuns?`, 금액 미확인 ${count(cost.unknownRuns)}`:''})`;
}
function dueLines(items:readonly DigestAgendaItem[]){
 const dated=items.filter(i=>i.due).slice(0,MAX_ITEMS);
 return dated.length?['기한:',...dated.map(i=>`- ${i.due!.slice(0,10)} ${i.title} (${i.campaignTitle})`)]:['기한: 기한이 있는 안건이 없습니다.'];
}
function runLines(runs:readonly DigestRun[]){
 if(!runs.length)return ['실행 결과: 오늘 예약 실행이 없습니다.'];
 const shown=runs.slice(0,MAX_RUNS).map(r=>`- ${runLabel[r.status]} ${r.title}${r.reason?` — ${r.reason}`:''}`);
 return [`실행 결과: ${count(runs.length)}`,...shown,...(runs.length>MAX_RUNS?[`- 외 ${count(runs.length-MAX_RUNS)}`]:[])];
}
export function buildDigest(input:DigestInput):Digest{
 const c=input.agenda.counts;
 const lines=[`${input.day} COLLECTIVE 일일 요약`,`오늘의 결정 대기: ${count(c.decision)} (기한 초과 ${count(c.overdue)}, 새 신호 ${count(c.signal)}, 다가오는 기한 ${count(c.upcoming)}, 전체 ${count(input.agenda.total)})`,
  ...dueLines(input.agenda.items),...runLines(input.runs),costLine(input.cost),'이 요약은 기록된 안건·실행·사용량을 규칙으로 센 것이며 자동 실행·발송을 하지 않습니다.'];
 return {subject:`[COLLECTIVE] ${input.day} 일일 요약 — 결정 대기 ${count(c.decision)}`,lines,text:lines.join('\n')};
}
