'use client';

import {Input} from '@/components/ui/input';
import {Button} from '@/components/ui/button';
import {Note} from '@/components/app/note';
import {useCallback,useEffect,useRef,useState} from 'react';
import styles from './growth-panel.module.css';
import type {GrowthPublicationObservationView} from '@/lib/growth-publication-observation-server';

type View=GrowthPublicationObservationView;
type Row=View['rows'][number];
type Period={from:string;to:string};
const number=(value:number|null|undefined)=>value==null?'미확인':value.toLocaleString('ko-KR');
const publications:Record<string,string>={draft:'승인 전',approved:'승인 · 미전송',submitting:'접수 확인 중',uncertain:'접수 여부 미확인',accepted:'접수·예약 확인 · 발행 전',published:'발행 확인',failed:'발행 실패',cancelled:'취소 기록',blocked:'공급자 확인 필요'};
function Reasons({reasons}:{reasons:string[]}){return reasons.length?<ul>{reasons.map((reason,index)=><li key={index}>{reason}</li>)}</ul>:null}
function Observation({row,period}:{row:Row;period:Period}){
 const m=row.measurement,a=row.attribution,source=m.source;
 return <article className={styles.mission} aria-label={`발행 관측 ${row.publicationId}`}><h4>발행 {row.publicationId}</h4><p>미션 실행 {row.intentId} · {publications[row.publicationStatus]??'발행 상태 미확인'}</p><Reasons reasons={row.reasons}/>
 <section aria-label="저장된 측정 관측"><h5>{m.status==='observed'?'저장된 측정 관측':m.status==='historical'?'수집 종료 · 과거 성공 관측':'측정 보류 · 현재 수치 미확인'}</h5><p>측정 기간: {m.window?`${m.window.from} ~ ${m.window.to}`:'미확인'} · 수집 시각: {m.fetchedAt||'미확인'}</p>{row.experiment&&<p>연결 실험 {row.experiment.id} · {row.experiment.arm==='control'?'대조안':'실험안'} · {row.experiment.channel}</p>}
 {source?<><p>수집 상태: {source.pending?'첫 수집 대기':source.lastError?'수집 실패':source.stopped?'수집 종료':'저장된 수집 기록'} · 마지막 수집 시도 {source.lastFetchedAt||'미확인'}</p>{source.lastError&&<p className={styles.error}>{source.lastError.reason}</p>}</>:<p>연결된 수집 기록이 없습니다.</p>}
 <p>분모 관측값: {number(m.value?.denominator)} · 분자 관측값: {number(m.value?.numerator)}</p><p>측정 정의: {m.definition||'미확인'}</p><Reasons reasons={m.limitations}/><Reasons reasons={m.reasons}/><Note className={styles.note}>Instagram 수치는 저장된 누적 관측입니다. 주문 조회 기간과 동일한 기간의 수치라고 간주하지 않습니다.</Note></section>
 <section aria-label="발행 귀속 주문 장부"><h5>발행 귀속 주문 장부</h5><p>주문 조회 기간: {period.from} ~ {period.to}</p>{a.status==='held'?<p>귀속 조회 보류 · 주문 수치 미확인</p>:a.status==='no_rows'?<p>해당 기간에 이 발행으로 귀속된 주문 기록이 없습니다. 전체 판매 0을 뜻하지 않습니다.</p>:<p>정확한 발행 ID로 귀속된 장부 기록입니다.</p>}<p>장부 기록: {number(a.value?.records)} · 주문: {number(a.value?.orders)} · 신규 고객: {number(a.value?.newCustomers)}</p><p>순매출(장부 관측): {number(a.value?.netRevenue)}원 · 공헌이익(장부 기준): {number(a.value?.contribution)}원 · 비용 미확인 주문: {number(a.value?.unknownCostOrders)}</p><Reasons reasons={a.reasons}/><p className={styles.note}>광고·제작비 배분과 POS 대사는 별도 확인이 필요합니다.</p></section></article>;
}
export function GrowthPublicationObservationPanel({campaignId,onExecution,onResults}:{campaignId:string;onExecution?:()=>void;onResults?:()=>void}){
 const [view,setView]=useState<View|null>(null),[draft,setDraft]=useState<Period>({from:'',to:''}),[loading,setLoading]=useState(true),[error,setError]=useState('');const pending=useRef<AbortController|null>(null);
 const load=useCallback(async(period?:Period)=>{pending.current?.abort();const controller=new AbortController();pending.current=controller;setLoading(true);setError('');try{const params=new URLSearchParams({campaignId,...period}),response=await fetch(`/api/growth/publication-observation?${params}`,{cache:'no-store',signal:controller.signal}),raw:unknown=await response.json();if(!response.ok)throw new Error('관측을 조회하지 못했습니다. 기간과 접근 권한을 확인한 뒤 다시 조회하세요.');if(!raw||typeof raw!=='object'||!Array.isArray((raw as View).rows)||!(raw as View).period?.from||!(raw as View).period?.to)throw new Error('관측 응답을 확인하지 못했습니다.');if(controller.signal.aborted)return;const next=raw as View;setView(next);if(!period)setDraft(next.period);}catch(e){if(!controller.signal.aborted)setError(e instanceof Error?e.message:'관측을 조회하지 못했습니다.');}finally{if(!controller.signal.aborted)setLoading(false);}},[campaignId]);
 useEffect(()=>{let active=true;void Promise.resolve().then(()=>{if(active)void load();});return()=>{active=false;pending.current?.abort();};},[load]);
 const changed=!!view&&(draft.from!==view.period.from||draft.to!==view.period.to);
 return <section className={styles.panel} aria-label="발행 이후 관측"><h3>발행 이후 관측</h3><Note className={styles.note}>저장된 수집 자료와 정확한 발행 귀속 주문만 조회합니다. 접수·예약, 발행, 도달·반응, 주문은 서로 다른 관측입니다. 귀속은 증분 효과의 증명이 아니며 외부 수집·전송을 실행하지 않습니다.</Note>
 <form onSubmit={event=>{event.preventDefault();void load(draft);}}><fieldset className={styles.form} disabled={loading}><legend>주문 장부 조회 기간</legend><label>주문 조회 시작일<Input type="date" required value={draft.from} onChange={event=>setDraft(previous=>({...previous,from:event.target.value}))}/></label><label>주문 조회 종료일<Input type="date" required min={draft.from||undefined} value={draft.to} onChange={event=>setDraft(previous=>({...previous,to:event.target.value}))}/></label><Button variant="panel" size="fit" type="submit">저장된 관측 조회</Button></fieldset></form>
 {loading&&<p role="status">저장된 관측을 조회하고 있습니다.</p>}{error&&<p role="alert" className={styles.error}>{error} 입력은 보존했습니다.{view?' 아래는 이전 조회 결과입니다.':''}</p>}{changed&&<p className={styles.note}>입력한 기간은 아직 적용되지 않았습니다. 아래 결과의 조회 기간을 확인하세요.</p>}{view&&<><p>주문 조회 기간: {view.period.from} ~ {view.period.to}</p>{!view.rows.length?<p>연결된 발행이 없습니다.</p>:view.rows.map(row=><Observation key={row.linkId} row={row} period={view.period}/>)}</>}
 <div className={styles.actions}>{onExecution&&<Button variant="panel" size="fit" type="button" onClick={onExecution}>제작·발행 열기</Button>}{onResults&&<Button variant="panel" size="fit" type="button" onClick={onResults}>성과 열기</Button>}</div><Note className={styles.note}>자세한 근거는 다른 화면에서 확인합니다. 수집 상태와 연결 실험은 학습 화면에서, 원본 주문과 귀속 근거는 연결된 지점의 주문·비용 및 귀속 보고에서 확인하세요. 측정·주문 기간과 정의를 확인하기 전 수치를 결합하지 않습니다.</Note></section>;
}
