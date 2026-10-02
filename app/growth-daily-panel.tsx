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
 async function runNow(){if(running)return;setRunning(true);setError('');setMessage('');try{const r=await fetch('/api/growth/daily',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'run_now'})}),v=await r.json() as {status?:string;error?:string};if(!r.ok)throw new Error(v.error??'실행하지 못했습니다.');setMessage(v.status==='processed'?'오늘 안건을 만들었습니다.':'오늘은 이미 실행했습니다(하루 1회).');await load();}catch(e){setError(e instanceof Error?e.message:'실행 실패');}finally{setRunning(false)}}
 const today=view?.runs.find(r=>r.day===view.today);
 return <section aria-label="일일 운영 루프" className={styles.panel}><header className={styles.header}><h3>일일 운영 루프와 오늘의 안건</h3><Button variant="panel" size="fit" aria-label="안건 새로고침" type="button" disabled={loading} onClick={()=>void load()}>새로고침</Button></header>
  {view&&<p className={styles.note}>{view.notice} 자동 실행은 기능 스위치 growth_daily_loop가 켜져 있을 때 조사 작업자가 KST 하루 1회 합니다. 현재 {view.enabled?'켜짐':'꺼짐'}.</p>}
  {error&&<p role="alert" className={styles.error}>{error}</p>}{message&&<p role="status" className={styles.success}>{message}</p>}{loading&&<p role="status">일일 루프를 조회하고 있습니다.</p>}
  {view&&<><Button variant="panel" size="fit" type="button" disabled={!view.canRun||running||loading} disabledReason={!view.canRun?'실행 권한이 없습니다. 관리자에게 요청하세요.':running?'진행 중인 작업이 끝나면 누를 수 있습니다.':undefined} onClick={()=>void runNow()}>오늘 안건 지금 만들기</Button>
   {!today&&<EmptyLine next="위 버튼으로 오늘 실행을 시작하세요.">오늘({view.today}) 실행 기록이 없습니다.</EmptyLine>}
   {today&&<><p><MetaLine items={[today.day,statusLabels[today.status],today.trigger==='worker'?'작업자':'운영자',duration(today.durationMs),`전역 ${today.stop==='stopped'?'중단 중':today.stop==='running'?'운영 중':'확인 불가'}`,today.skipped?`시간 예산으로 ${today.skipped}개 캠페인 다음 실행`:null]}/></p>
    {today.campaign?.error&&<p className={styles.error}>{today.campaign.error}</p>}
    {today.campaign&&!today.campaign.error&&<><p><MetaLine items={[`감지 ${today.campaign.detection?.detected??0}건`,`새 신호 ${today.campaign.detection?.created??0}건`]}/></p>{today.campaign.agenda.length?<ul>{today.campaign.agenda.map(a=><li key={a.kind}>{a.action} ({a.count}건)</li>)}</ul>:<EmptyLine next="처리할 일이 생기면 여기에 나타납니다.">이 캠페인의 오늘 안건이 없습니다.</EmptyLine>}</>}
    {!today.campaign&&<p>이 캠페인은 오늘 실행 범위에 없었습니다(보관·지점 미연결·시간 예산).</p>}</>}
   <details><summary>최근 실행</summary>{view.runs.map(r=><p key={r.day}><MetaLine items={[r.day,statusLabels[r.status],`캠페인 ${r.campaigns}개`,r.retryAt?`재시도 ${dateTime(r.retryAt)}`:null]}/></p>)}</details></>}
 </section>;
}
