'use client';
import {EmptyLine} from '@/components/app/empty-line';
import {Button} from '@/components/ui/button';
import {MetaLine} from '@/components/app/meta-line';
import {dateTime,duration} from '@/lib/format';
import {useCallback,useEffect,useRef,useState} from 'react';
import type {GrowthDailyView} from '@/lib/growth-daily-server';
import styles from './growth-panel.module.css';
type View=GrowthDailyView;
const statusLabels={completed:'완료',partial:'일부 완료',failed:'실패(재시도 예정)'} as const;
export function GrowthDailyPanel({campaignId}:{campaignId:string}){return <Workspace key={campaignId} campaignId={campaignId}/>}
function Workspace({campaignId}:{campaignId:string}){
 const [view,setView]=useState<View|null>(null),[loading,setLoading]=useState(true),[running,setRunning]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
 const reading=useRef<AbortController|null>(null);
 const load=useCallback(async()=>{reading.current?.abort();const controller=new AbortController();reading.current=controller;setLoading(true);setError('');try{const r=await fetch(`/api/growth/daily?campaignId=${encodeURIComponent(campaignId)}`,{cache:'no-store',signal:controller.signal}),v:unknown=await r.json();if(!r.ok)throw new Error((v as {error?:string})?.error??'일일 루프를 조회하지 못했습니다.');if(!controller.signal.aborted)setView(v as View);}catch(e){if(!controller.signal.aborted)setError(e instanceof Error?e.message:'조회 실패');}finally{if(!controller.signal.aborted)setLoading(false);}},[campaignId]);
 useEffect(()=>{void Promise.resolve().then(()=>load());return()=>reading.current?.abort();},[load]);
 async function runNow(){if(running)return;setRunning(true);setError('');setMessage('');try{const r=await fetch('/api/growth/daily',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'run_now'})}),v=await r.json() as {status?:string;reason?:string;runStatus?:string;retryAt?:string;error?:string};if(!r.ok)throw new Error(v.error??'실행하지 못했습니다.');setMessage(v.status==='processed'?(v.runStatus==='partial'?'이번 안건을 저장했습니다. 남은 캠페인은 다음 실행에서 이어갑니다.':'오늘 안건을 만들었습니다.'):v.status==='retry'?'진행 상황을 저장했습니다. 집계 실패로 재시도를 기다립니다.':v.reason==='busy'?'다른 작업자가 일일 안건을 만들고 있습니다. 잠시 후 새로고침하세요.':v.reason==='retry_wait'?`재시도 대기 중입니다${v.retryAt?` (${dateTime(v.retryAt)})`:''}.`:'오늘의 모든 캠페인 집계가 끝났습니다.');await load();}catch(e){setError(e instanceof Error?e.message:'실행 실패');}finally{setRunning(false)}}
 const today=view?.runs.find(r=>r.day===view.today);
 return <section aria-label="일일 운영 루프" className={styles.panel}><header className={styles.header}><h3>일일 운영 루프와 오늘의 안건</h3><Button variant="panel" size="fit" aria-label="안건 새로고침" type="button" disabled={loading} onClick={()=>void load()}>새로고침</Button></header>
  {view&&<p className={styles.note}>{view.notice} 자동 실행은 기능 스위치 growth_daily_loop가 켜져 있을 때 조사 작업자가 KST 날짜별로 완료할 때까지 나누어 처리합니다. 현재 {view.enabled?'켜짐':'꺼짐'}.</p>}
  {error&&<p role="alert" className={styles.error}>{error}</p>}{message&&<p role="status" className={styles.success}>{message}</p>}{loading&&<p role="status">일일 루프를 조회하고 있습니다.</p>}
  {view&&<><Button variant="panel" size="fit" type="button" disabled={!view.canRun||running||loading} disabledReason={!view.canRun?'실행 권한이 없습니다. 관리자에게 요청하세요.':running?'진행 중인 작업이 끝나면 누를 수 있습니다.':undefined} onClick={()=>void runNow()}>오늘 안건 지금 만들기</Button>
   {!today&&<EmptyLine next="위 버튼으로 오늘 실행을 시작하세요.">오늘({view.today}) 실행 기록이 없습니다.</EmptyLine>}
   {today&&<><p><MetaLine items={[today.day,statusLabels[today.status],today.trigger==='worker'?'작업자':'운영자',duration(today.durationMs),`전역 ${today.stop==='stopped'?'중단 중':today.stop==='running'?'운영 중':'확인 불가'}`,today.skipped?`미처리 ${today.skipped}개 캠페인 다음 실행`:null]}/></p>
    {today.retryAt&&today.status!=='completed'&&<p>다음 재시도 가능 시각: {dateTime(today.retryAt)}. 실패했거나 남은 캠페인부터 이어서 처리합니다.</p>}
    {today.campaign?.error&&<p className={styles.error}>{today.campaign.error}</p>}
    {today.campaign&&!today.campaign.error&&<><p><MetaLine items={[`감지 ${today.campaign.detection?.detected??0}건`,`새 신호 ${today.campaign.detection?.created??0}건`,`고객 기회 검토 초안 ${today.campaign.drafts??0}건`,`실패 방법 검토 초안 ${today.campaign.failureDrafts??0}건`,`교훈 자동 근거 ${today.campaign.lessonCollected??0}건`,`오퍼 검토 초안 ${today.campaign.offerDrafts??0}건`,today.campaign.offerRemaining?'오퍼 근거 다음 실행에서 계속 회수':null,today.campaign.offerIntakeHeld?'신규 오퍼 초안 보관 한도로 회수 보류':null,today.campaign.offerSourceErrors?`오퍼 원천 조회 보류 ${today.campaign.offerSourceErrors}건`:null,today.campaign.lessonRemaining?'교훈 근거 다음 실행에서 계속 회수':null]}/></p>{today.campaign.agenda.length?<ul>{today.campaign.agenda.map(a=><li key={a.kind}>{a.action} ({a.count}건)</li>)}</ul>:<EmptyLine next="처리할 일이 생기면 여기에 나타납니다.">이 캠페인의 오늘 안건이 없습니다.</EmptyLine>}</>}
    {!today.campaign&&<p>이 캠페인은 오늘 실행 범위에 없었습니다(보관·지점 미연결·시간 예산).</p>}</>}
   <details><summary>오퍼 검토 초안과 현재 근거</summary><p className={styles.note}>현재 오퍼의 정확한 판과 관측 근거로 만든 검토 초안입니다. 가격과 승인 변경은 기존 오퍼 화면에서 검토합니다.</p>{!view.offerReviews?.rows.length?<EmptyLine next="일일 회수 뒤 최신 실험·게시 반응 근거가 있는지 확인하세요.">오퍼 검토 초안이 없습니다.</EmptyLine>:view.offerReviews.rows.map(row=><div key={row.id}><p><MetaLine items={[row.offer.id,`오퍼 v${row.offer.version}`,row.source.kind==='experiment'?'실험 분석':'게시 반응',row.source.reference,row.sourceStatus==='current'?'현재 근거':row.sourceStatus==='stale'?'근거 변경':'조회 보류']}/></p><p>{row.proposal}</p><p>{row.sourceReason}</p></div>)}{view.offerReviews?.hasMore&&<p>최신 50개 초안을 표시합니다. 이전 기록은 원장에 보존되어 있습니다.</p>}{view.offerReviews?.sourceUnavailable&&<p>일부 원천 조회가 지연되었습니다. 다음 조회에서 다시 확인합니다.</p>}</details>
   <details><summary>최근 실행</summary>{view.runs.map(r=><p key={r.day}><MetaLine items={[r.day,statusLabels[r.status],`캠페인 ${r.campaigns}개`,r.retryAt?`재시도 ${dateTime(r.retryAt)}`:null]}/></p>)}</details></>}
 </section>;
}
