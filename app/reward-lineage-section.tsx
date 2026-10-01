'use client';
import {askConfirm} from '@/components/app/confirm-dialog';
// B4-2c 학습 화면의 '보상 계보' 절(docs/REWARD-LINEAGE.ko.md 11절). 새 탭 없이 학습 규칙 탭 아래에 둔다. 읽기 전용 표와 개선 루프 대장이고, 닫기(수치 동결)는 대표만 한다.
// 대표·관리자만 보인다(직원에게는 절이 없다, 서버 GET 403과 같은 규칙). 스위치 b4_reward_lineage가 꺼져 있으면(409) 안내만 보인다.
// 고지: 결정 16 전 발행은 실게시가 아님(realPublish:false), 일부만 집계(partial.kinds), 귀속≠증분, 자동 판정 아님, 규칙별 표는 중복 배분이라 합산 금지.
import {useCallback,useEffect,useState} from 'react';
import {toast} from 'sonner';
import {Check,RefreshCw} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {api} from '@/lib/client';
import type {RewardLineageResponse} from '@/lib/reward-lineage-server';
import type {RewardTotals} from '@/lib/reward-lineage';
import type {ImprovementLoop,LoopSide,LoopStatus} from '@/lib/improvement-loops';
import {canChange,useAccount,type Account} from './account-context';

export type RewardLoad={state:'loading'}|{state:'off';message:string}|{state:'error';message:string}|{state:'ready';data:RewardLineageResponse};
const pct=(n:number|null)=>n===null?'표본 부족':(n*100).toFixed(1)+'%';
const won=(n:number|null)=>n===null?'원가 미상':n.toLocaleString('ko-KR')+'원';
const prob=(p:number|null)=>p===null?'—':p>=0.999?'99.9% 이상':p<=0.001?'0.1% 이하':(p*100).toFixed(1)+'%';
const loopStatus:Record<LoopStatus,string>={open:'관찰 중 · 14일 미경과',insufficient:'표본 부족 · 5건 미만',closable:'닫을 수 있음',closed:'닫음 · 수치 동결',rolled_back:'롤백됨 · 세지 않음'};
const human=(t:RewardTotals)=>`${t.human.approvedFirst}/${t.human.decidedFirst} · ${pct(t.human.firstPassRate)}`;

function Notices({data}:{data:RewardLineageResponse}){
 const partial=[...new Set([...data.partial.kinds,...data.loops.partial.kinds])];
 return <ul className="learning-meta" aria-label="보상 계보 고지">
  {!data.lineage.layers.publish.realPublish&&<li>realPublish:false · 결정 16 첫 실게시 전이라 발행(L1)은 앱 승인·접수 기록이며 실제 게시 증거가 아닙니다. 반응(L2)은 작업물 출처 실험만 줄여 셉니다.</li>}
  {partial.length>0&&<li>일부만 집계 · 행 상한을 넘어 최근 기록만 읽은 종류: {partial.join(', ')} (partial.kinds)</li>}
  <li>귀속≠증분 · 추적 코드로 귀속된 주문은 캠페인이 없었어도 생겼을 수 있습니다.</li>
  <li>자동 판정 아님 · 이 표로 프롬프트 버전·규칙을 자동으로 올리거나 내리지 않습니다. 비교 확률은 설명용이며 판단은 대표가 합니다.</li>
  <li>재방문(L4)은 A5 전이라 측정하지 않습니다(not_run).</li>
 </ul>;
}
function VersionTable({data}:{data:RewardLineageResponse}){
 const rows=data.lineage.byPromptVersion;
 if(!rows.length)return <p className="learning-meta">이 기간에 프롬프트 버전으로 이어진 보상 기록이 없습니다.</p>;
 return <div className="ledger-table-wrap"><table className="ledger-table"><caption className="sr-only">프롬프트 버전별 보상 L0~L4</caption>
  <thead><tr><th>프롬프트 버전 · 역할</th><th>L0 1차 승인</th><th>L1 발행(승인·접수)</th><th>L2 반응(축소)</th><th>L3 귀속 주문</th><th>L4 재방문</th></tr></thead>
  <tbody>{rows.map(r=><tr key={r.promptVersion+':'+(r.role??'')}><td><b>{r.promptVersion}</b><small>{r.role??'역할 미상'} · 작업물 {r.artifacts}</small></td><td>{human(r)}<small>수정 요청 {r.human.revisions}</small></td>
   <td>{r.publish.publications}건 · 승인 {r.publish.approved} · 접수 {r.publish.live}</td><td>실험 {r.engagement.experiments} · 채택 규칙 {r.engagement.adoptedRules}</td>
   <td>{r.order.attributedOrders}건 · {won(r.order.netRevenue)}<small>공헌이익 {won(r.order.contribution)}</small></td><td>not_run</td></tr>)}</tbody></table></div>;
}
function RuleTable({data}:{data:RewardLineageResponse}){
 const rows=data.lineage.byRule;
 return <>
  <p className="learning-note" role="note">규칙별 표는 중복 배분입니다. 한 작업물에 규칙이 여럿이면 규칙마다 같은 보상을 세므로 줄을 합산하지 마세요(합계가 전체보다 클 수 있습니다).</p>
  {rows.length?<div className="ledger-table-wrap"><table className="ledger-table"><caption className="sr-only">학습 규칙별 보상(중복 배분)</caption>
   <thead><tr><th>규칙 · 판</th><th>등급</th><th>L0 1차 승인</th><th>L1 발행</th><th>L3 귀속 주문</th></tr></thead>
   <tbody>{rows.map(r=><tr key={r.ruleRef}><td><b>{r.ruleRef}</b></td><td>{r.grade}</td><td>{human(r)}</td><td>{r.publish.publications}건</td><td>{r.order.attributedOrders}건</td></tr>)}</tbody></table></div>
  :<p className="learning-meta">이 기간에 규칙이 이어진 작업물이 없습니다.</p>}
 </>;
}
const side=(s:LoopSide)=>`${s.approvedFirst}/${s.decidedFirst} · ${pct(s.firstPassRate)} · 발행 ${s.publish.publications} · 귀속 주문 ${s.order.attributedOrders}`;
const loopTitle=(l:ImprovementLoop)=>l.source.kind==='prompt'?`${l.source.unit} ${l.source.action==='promote'?'승격':'활성화'} · ${l.source.from??'코드 상수'} → ${l.source.to}`:`운영자 선호 규칙 승인 · ${l.source.ruleId} v${l.source.ruleVersion}${l.source.role?' · '+l.source.role:''}`;
function LoopRow({loop,canClose,busy,onClose}:{loop:ImprovementLoop;canClose:boolean;busy:boolean;onClose:(l:ImprovementLoop)=>void}){
 const c=loop.comparison;
 return <tr><td><b>{loopTitle(loop)}</b><small>활성화 {loop.activatedDay} · 전 {loop.windows.before.from}~{loop.windows.before.to} · 후 {loop.windows.after.from}~{loop.windows.after.to}</small></td>
  <td>{side(c.before)}</td><td>{side(c.after)}</td><td>{prob(c.probTreatmentBetter)}<small>설명용</small></td>
  <td>{loopStatus[loop.status]}{loop.closed&&<small>{loop.closed.at.slice(0,10)} · 대표 · {loop.countsToExit?'종료 조건에 셈':'롤백돼 세지 않음'}</small>}
   {canClose&&loop.status==='closable'&&<Button size="sm" variant="outline" disabled={busy} onClick={()=>onClose(loop)}><Check/>닫기 · 수치 동결</Button>}</td></tr>;
}
function Loops({data,canClose,busy,onClose}:{data:RewardLineageResponse;canClose:boolean;busy:boolean;onClose:(l:ImprovementLoop)=>void}){
 const {loops,exit}=data.loops;
 return <section aria-label="개선 루프">
  <div className="learning-card-top"><b>개선 루프 · 닫힌 루프 {exit.counted}/{exit.target}건</b><span className="learning-tag">4단계 종료 조건</span></div>
  <p className="learning-note">평가 run과 대표 승인이 있는 프롬프트 활성화·승격과 운영자 선호 규칙 승인의 전후 14일 1차 승인율을 나란히 봅니다. 차이는 인과·증분이 아니며 자동 판정이 아닙니다. 14일이 지나고 전후 표본이 각각 5건 이상일 때 대표가 닫아 수치를 동결합니다. 롤백된 버전·중지된 규칙은 닫힌 루프로 세지 않습니다.{canClose?'':' 닫기는 대표만 할 수 있습니다.'}</p>
  {loops.length?<div className="ledger-table-wrap"><table className="ledger-table"><caption className="sr-only">개선 루프 목록</caption>
   <thead><tr><th>개선</th><th>전 14일(L0·L1·L3)</th><th>후 14일(L0·L1·L3)</th><th>후가 나을 확률</th><th>상태</th></tr></thead>
   <tbody>{loops.map(l=><LoopRow key={l.id} loop={l} canClose={canClose} busy={busy} onClose={onClose}/>)}</tbody></table></div>
  :<p className="learning-meta">평가 run과 승인이 있는 활성화·승격이나 운영자 선호 규칙 승인이 아직 없습니다.</p>}
 </section>;
}
// 보상 계보 절(표시 전용). 닫기 버튼은 canClose(대표)일 때 closable 루프에만 있다.
export function RewardLineageView({load,canClose,busy,onClose,onReload}:{load:RewardLoad;canClose:boolean;busy:boolean;onClose:(l:ImprovementLoop)=>void;onReload:()=>void}){
 const head=<div className="learning-card-top"><b>보상 계보 · 최근 28일</b><Button size="sm" variant="outline" disabled={busy||load.state==='loading'} onClick={onReload}><RefreshCw/>다시 계산</Button></div>;
 if(load.state==='off')return <section aria-label="보상 계보" style={{marginTop:32}}>{head}<p className="learning-note" role="note">{load.message}</p></section>;
 if(load.state!=='ready')return <section aria-label="보상 계보" style={{marginTop:32}}>{head}<p className={load.state==='error'?'form-error':'learning-meta'} role="status">{load.state==='error'?load.message:'보상 계보를 계산하고 있습니다.'}</p></section>;
 return <section aria-label="보상 계보" style={{marginTop:32}}>{head}
  <Notices data={load.data}/>
  <VersionTable data={load.data}/>
  <RuleTable data={load.data}/>
  <Loops data={load.data} canClose={canClose} busy={busy} onClose={onClose}/>
 </section>;
}
// 보기는 대표·관리자(서버 GET과 같은 규칙), 닫기는 대표만(서버 POST close 403과 같은 규칙). 계정을 모르면 막는다.
export const canSeeRewardLineage=(account:Account|null)=>canChange(account);
export const canCloseLoops=(account:Account|null)=>canChange(account,true);
// 브랜드 범위 GET의 결과를 화면 상태로 바꾼다(상태를 직접 바꾸지 않는다). 409는 스위치 꺼짐 안내다.
async function fetchLineage(brandId:string):Promise<RewardLoad>{
 try{
  const r=await fetch('/api/reward-lineage?brandId='+encodeURIComponent(brandId)),d=await r.json() as RewardLineageResponse&{error?:string};
  return r.status===409?{state:'off',message:d.error||'보상 계보 기능이 꺼져 있습니다.'}:r.ok?{state:'ready',data:d}:{state:'error',message:d.error||'보상 계보를 불러오지 못했습니다.'};
 }catch(e){return {state:'error',message:(e as Error).message}}
}
// 대표·관리자에게만 절을 그린다(직원은 null). 닫기는 본 수치(expected)와 판 번호(version)를 함께 보낸다.
export function RewardLineageSection({brandId}:{brandId:string}){
 const account=useAccount(),allowed=canSeeRewardLineage(account),[load,setLoad]=useState<RewardLoad>({state:'loading'}),[busy,setBusy]=useState(false);
 const reload=useCallback(()=>fetchLineage(brandId).then(setLoad),[brandId]);
 useEffect(()=>{let active=true;if(allowed&&brandId)void fetchLineage(brandId).then(next=>{if(active)setLoad(next)});return()=>{active=false}},[allowed,brandId]);
 if(!allowed)return null;
 async function close(l:ImprovementLoop){
  if(!(await askConfirm({title:'이 개선 루프를 닫고 지금 수치를 동결할까요?',undo:'닫은 루프는 되돌리지 않습니다.',confirmLabel:'닫고 동결',danger:true})))return;
  const c=l.comparison,expected={before:{decidedFirst:c.before.decidedFirst,approvedFirst:c.before.approvedFirst},after:{decidedFirst:c.after.decidedFirst,approvedFirst:c.after.approvedFirst}};
  setBusy(true);
  try{await api('close',{brandId,loopId:l.id,version:l.version,expected},'/api/reward-lineage');toast.success('개선 루프를 닫고 수치를 동결했습니다.');await reload()}catch(e){toast.error((e as Error).message)}finally{setBusy(false)}
 }
 return <RewardLineageView load={load} canClose={canCloseLoops(account)} busy={busy} onClose={l=>void close(l)} onReload={()=>void reload()}/>;
}
