'use client';
import {Input} from '@/components/ui/input';
import {Button} from '@/components/ui/button';
import {Note} from '@/components/app/note';
import {useCallback,useEffect,useRef,useState} from 'react';
import type {GrowthProfitView} from '@/lib/growth-profit-server';
import styles from './growth-panel.module.css';
type View=GrowthProfitView;
const won=(n:number|null|undefined)=>n===null||n===undefined?'미확인':`${n.toLocaleString('ko-KR')}원`;
const sourceLabels={growth_commitment:'판매 예산 예약',collaboration:'크리에이터·파트너',meta_execution:'Meta 집행'} as const;
export function GrowthProfitPanel({campaignId}:{campaignId:string}){return <Workspace key={campaignId} campaignId={campaignId}/>}
function Workspace({campaignId}:{campaignId:string}){
 const [view,setView]=useState<View|null>(null),[range,setRange]=useState({from:'',to:''}),[loading,setLoading]=useState(true),[error,setError]=useState('');
 const reading=useRef<AbortController|null>(null);
 const load=useCallback(async(r:{from:string;to:string}={from:'',to:''})=>{reading.current?.abort();const controller=new AbortController();reading.current=controller;setLoading(true);setError('');try{const q=new URLSearchParams({campaignId,...(r.from?{from:r.from}:{}),...(r.to?{to:r.to}:{})});const res=await fetch(`/api/growth/profit?${q}`,{cache:'no-store',signal:controller.signal}),v:unknown=await res.json();if(!res.ok)throw new Error((v as {error?:string})?.error??'손익을 조회하지 못했습니다.');if(!controller.signal.aborted)setView(v as View);}catch(e){if(!controller.signal.aborted)setError(e instanceof Error?e.message:'조회 실패');}finally{if(!controller.signal.aborted)setLoading(false);}},[campaignId]);
 useEffect(()=>{void Promise.resolve().then(()=>load());return()=>reading.current?.abort();},[load]);
 return <section aria-label="마케팅 후 손익과 현금" className={styles.panel}><header className={styles.header}><h3>마케팅 후 손익·현금</h3><Button variant="panel" size="fit" aria-label="손익 새로고침" type="button" disabled={loading} onClick={()=>void load(range)}>새로고침</Button></header>
  <Note className={styles.note}>마케팅 지출을 뺀 캠페인 이익과 현금을 보여 줍니다. 캠페인 주문 장부의 순매출·마케팅 전 공헌이익에서 대사된 마케팅 지출(판매 예산 예약·협업 정산·Meta 정산)을 뺍니다. 대사되지 않은 지출이 하나라도 있으면 마케팅 후 이익을 확정하지 않습니다. 현금은 운영자 입금 증빙 기준이며, 원가 구매 현금이 연결되지 않아 순현금은 계산하지 않습니다. 인과 효과가 아닙니다.</Note>
  {error&&<p role="alert" className={styles.error}>{error}</p>}{loading&&<p role="status">손익을 조회하고 있습니다.</p>}
  <form className={styles.form} onSubmit={e=>{e.preventDefault();void load(range);}}><label>손익 시작일<Input type="date" value={range.from} onChange={e=>setRange({...range,from:e.target.value})}/></label><label>손익 종료일<Input type="date" value={range.to} onChange={e=>setRange({...range,to:e.target.value})}/></label><Button variant="panel" size="fit" type="submit" disabled={loading}>손익 기간 적용</Button></form>
  {view&&<><p>기간 {view.period.from}~{view.period.to} · 장부 {view.ledger.status==='ledger_only'?'연결됨':'미확인'}</p>
   <dl className={styles.form}><dt>순매출</dt><dd>{won(view.netRevenue)}</dd><dt>마케팅 전 공헌이익</dt><dd>{won(view.contributionBeforeMarketing)}</dd><dt>마케팅 지출</dt><dd>{won(view.marketing.total)}{view.marketing.unknownItems?` (확인 ${won(view.marketing.known)} · 미대사 ${view.marketing.unknownItems}건)`:''}</dd><dt>마케팅 후 공헌이익</dt><dd>{won(view.contributionAfterMarketing)}</dd><dt>입금 확인</dt><dd>{won(view.cash.received)}</dd><dt>정산 예정</dt><dd>{won(view.cash.expected)} · 미입금 {won(view.cash.pending)}</dd><dt>순현금</dt><dd>계산하지 않음</dd></dl>
   <ul>{view.marketing.bySource.map(s=><li key={s.source}>{sourceLabels[s.source]}: 확인 {won(s.known)}{s.unknown?` · 미대사 ${s.unknown}건`:''}</li>)}</ul>
   {view.reasons.map(x=><p key={x}>{x}</p>)}</>}
 </section>;
}
