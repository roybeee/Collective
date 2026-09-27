'use client';
import type {latestQualityTable} from '@/lib/quality-digest-queue-server';
import type {UsageTableRow} from '@/lib/quality-drift';
import {roles} from '@/lib/agency';
import {isModelAlias} from '@/lib/usage-summary';

// B2 2단계 사용량 화면 표: 마지막 주간 품질 집계(워커 digest 큐)의 역할 × 프롬프트 버전 × 보고 모델. 정의는 품질 콘솔과 같다(docs/QUALITY-CONSOLE.ko.md, data-truth-9 대응).
// 모르는 값은 0으로 적지 않는다: 1차 판정이 없으면 미측정, 1~4건이면 표본 부족, 모델을 모르면 미측정, 토큰 미보고 실행은 건수로 따로 적는다. 숫자를 나란히 보일 뿐 차이의 이유를 적지 않는다.
export type QualityTableView=NonNullable<Awaited<ReturnType<typeof latestQualityTable>>>;
const count=(n:number)=>n.toLocaleString('ko-KR');
const pct=(r:number)=>(Math.round(r*1000)/10).toFixed(1)+'%';
const roleName=(id:string)=>id?roles.find(r=>r.id===id)?.name??id:'미측정';
const modelName=(m:string|null)=>m===null?'미측정':isModelAlias('hermes',m)?`${m} (실제 모델 미확인)`:m;
export function firstPassText(r:Pick<UsageTableRow,'n'|'approvedFirst'|'firstPassRate'>){
 if(r.n===0)return '미측정';
 // 비율은 서버가 표본 5건 이상일 때만 낸다(lib/quality-drift.ts usageTable). 비율이 없으면 표본 부족이다.
 return r.firstPassRate===null?`표본 부족 (n=${r.n})`:`${pct(r.firstPassRate)} (${r.approvedFirst}/${r.n})`;
}
const tokenText=(n:number,unknown:number)=>unknown>0?`${count(n)} · 미측정 ${count(unknown)}건`:count(n);
const kst=(iso:string)=>new Date(iso).toLocaleDateString('ko-KR',{timeZone:'Asia/Seoul'});
const alarmNames:Record<string,string>={model_change:'보고 모델 변경',gateway_change:'게이트웨이 변경',invalid_rate:'역할 형식 오류 비율',golden_drop:'골든 스모크 통과 감소',token_budget:'토큰 예산 소진율'};
const HEAD=['역할','프롬프트 버전','보고 모델','AI 작업물','1차 승인율','수정 요청','폐기 토큰','미연결 토큰'];

function Rows({rows}:{rows:UsageTableRow[]}){
 return <div className="mt-3 overflow-x-auto"><table className="w-full text-left text-sm" style={{minWidth:860}}>
  <caption className="sr-only">지난주 역할·프롬프트 버전·보고 모델별 작업물·1차 승인율·토큰</caption>
  <thead><tr className="border-b">{HEAD.map(h=><th scope="col" key={h} className="p-3 font-medium">{h}</th>)}</tr></thead>
  <tbody>{rows.map(r=><tr key={JSON.stringify([r.role,r.promptVersion,r.reportedModel])} className="border-b align-top">
   <td className="p-3">{roleName(r.role)}</td><td className="max-w-56 break-all p-3 text-xs">{r.promptVersion??'코드 상수'}</td><td className="max-w-48 break-words p-3">{modelName(r.reportedModel)}</td>
   <td className="p-3 tabular-nums">{count(r.artifacts)}</td><td className="p-3 tabular-nums">{firstPassText(r)}</td><td className="p-3 tabular-nums">{count(r.revisions)}</td>
   <td className="p-3 tabular-nums">{tokenText(r.discardedTokens,r.unknownTokenRuns)}</td><td className="p-3 tabular-nums">{count(r.unlinkedTokens)}</td>
  </tr>)}</tbody>
 </table></div>;
}
function Alarms({table}:{table:QualityTableView}){
 if(!table.alarms.length&&!table.retention.suggestions.length)return <p className="subtle-note mt-2">이 주에 기록된 드리프트 경보가 없습니다.</p>;
 return <ul className="mt-2 space-y-1 text-sm" aria-label="주간 드리프트 경보와 보존 정리 제안">
  {table.alarms.map(a=><li key={a.id}>{alarmNames[a.type]??a.type}: {a.detail}</li>)}
  {table.retention.suggestions.map(s=><li key={s}>보존 정리 제안: {s}</li>)}
 </ul>;
}
export function QualityTable({table}:{table:QualityTableView|null}){
 if(!table)return <div className="notice mt-4" aria-label="주간 품질 표"><p className="font-medium">주간 품질 표 · 역할 × 프롬프트 버전 × 보고 모델</p>
  <p className="subtle-note">아직 주간 품질 집계가 없습니다. 소유자가 기능 스위치 b2_digest_queue를 켜면 조사 작업자가 주 1회 지난주 집계를 기록합니다.</p></div>;
 return <div className="notice mt-4" aria-label="주간 품질 표">
  <p className="font-medium">주간 품질 표 · {table.week} ({kst(table.range.from)} ~ {kst(new Date(Date.parse(table.range.to)-1).toISOString())}, 한국 시간)</p>
  <p className="text-xs">{table.notice}</p>
  {table.rows.length?<Rows rows={table.rows}/>:<p className="subtle-note mt-2">이 주에 집계할 AI 작업물·판정·사용량이 없습니다.</p>}
  <Alarms table={table}/>
 </div>;
}
