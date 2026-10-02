'use client';
import {EmptyLine} from '@/components/app/empty-line';
import {Input} from '@/components/ui/input';
import {Button} from '@/components/ui/button';
import {dateTime} from '@/lib/format';
import {Note} from '@/components/app/note';
import {LockedNote} from '@/components/app/locked-note';
import {readOnlyReason} from '@/lib/ui/read-only';
import {useCallback,useEffect,useRef,useState} from 'react';
import type {StorefrontPull} from '@/lib/storefront-pull-server';
import styles from './growth-panel.module.css';
type Connection=Omit<StorefrontPull,'secret'>;
type View={storeId:string|null;connections:Connection[];enabled:boolean;canEdit:boolean};
const errorLabels:Record<string,string>={unauthorized:'인증 거부(토큰 확인)',network:'연결 실패·시간 초과',too_large:'응답이 너무 큼',invalid_response:'응답 형식 거부(고객 정보·추가 필드 포함)',rejected_orders:'주문 행 거부',import_failed:'장부 저장 실패',store_inactive:'지점 비활성'};
export function StorefrontPullPanel({campaignId}:{campaignId:string}){return <Workspace key={campaignId} campaignId={campaignId}/>}
function Workspace({campaignId}:{campaignId:string}){
 const [view,setView]=useState<View|null>(null),[input,setInput]=useState({sourceKey:'',baseUrl:'',token:'',intervalMinutes:30}),[loading,setLoading]=useState(true),[saving,setSaving]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
 const reading=useRef<AbortController|null>(null);
 const load=useCallback(async()=>{reading.current?.abort();const controller=new AbortController();reading.current=controller;setLoading(true);setError('');try{const r=await fetch(`/api/storefront-pulls?campaignId=${encodeURIComponent(campaignId)}`,{cache:'no-store',signal:controller.signal}),v:unknown=await r.json();if(!r.ok)throw new Error((v as {error?:string})?.error??'조회하지 못했습니다.');if(!controller.signal.aborted)setView(v as View);}catch(e){if(!controller.signal.aborted)setError(e instanceof Error?e.message:'조회 실패');}finally{if(!controller.signal.aborted)setLoading(false);}},[campaignId]);
 useEffect(()=>{void Promise.resolve().then(()=>load());return()=>reading.current?.abort();},[load]);
 async function send(body:Record<string,unknown>,done:string){if(saving)return;setSaving(true);setError('');setMessage('');try{const r=await fetch('/api/storefront-pulls',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}),v=await r.json() as {error?:string};if(!r.ok)throw new Error(v.error??'저장하지 못했습니다.');setMessage(done);if(body.action==='create')setInput({sourceKey:'',baseUrl:'',token:'',intervalMinutes:30});await load();}catch(e){setError(e instanceof Error?e.message:'저장 실패');}finally{setSaving(false)}}
 const storeId=view?.storeId??'',mine=view?.connections.filter(c=>c.storeId===storeId)??[];
 return <section aria-label="판매처 주문 조회" className={styles.panel}><header className={styles.header}><h3>판매처 주문 조회 연결</h3><Button variant="panel" size="fit" aria-label="연결 새로고침" type="button" disabled={loading} onClick={()=>void load()}>새로고침</Button></header>
  <Note className={styles.note}>판매처가 제공하는 주문 조회 주소를 커서로 한 페이지(100건)씩 읽어 기존 주문 장부에 반영합니다. 서명 웹훅과 같은 7개 필드만 받으며 고객 정보가 섞이면 거부합니다. 토큰은 암호화해 저장하고 다시 보여주지 않습니다. 커서는 저장과 같은 묶음에서만 전진하고, 실패하면 간격을 늘려 재시도합니다. 판매처에 쓰기 요청은 하지 않습니다.</Note>
  {error&&<p role="alert" className={styles.error}>{error}</p>}{message&&<p role="status" className={styles.success}>{message}</p>}{loading&&<p role="status">연결을 조회하고 있습니다.</p>}
  {view&&<><p>자동 조회 스위치 storefront_pull: {view.enabled?'켜짐':'꺼짐'}</p>
   {!storeId&&<p>캠페인에 지점을 먼저 연결하세요.</p>}{view.canEdit&&storeId&&<form onSubmit={e=>{e.preventDefault();void send({action:'create',input:{storeId,...input}},'연결을 만들었습니다. 켜기 전에는 조회하지 않습니다.');}}><fieldset disabled={saving} className={styles.form}><legend>새 조회 연결</legend>
    <label>판매처 키<Input required pattern="[A-Za-z0-9_-]+" value={input.sourceKey} onChange={e=>setInput({...input,sourceKey:e.target.value})}/></label>
    <label className={styles.wide}>주문 조회 URL(HTTPS)<Input required value={input.baseUrl} onChange={e=>setInput({...input,baseUrl:e.target.value})}/></label>
    <label>조회 토큰<Input required type="password" autoComplete="off" value={input.token} onChange={e=>setInput({...input,token:e.target.value})}/></label>
    <label>조회 간격(분)<Input type="number" min={15} max={1440} value={input.intervalMinutes} onChange={e=>setInput({...input,intervalMinutes:Number(e.target.value)})}/></label>
    <Button variant="panel" size="fit" type="submit">연결 만들기</Button></fieldset></form>}
   {!mine.length&&<EmptyLine next="위 ‘새 조회 연결’ 버튼으로 시작하세요.">이 지점의 조회 연결이 없습니다.</EmptyLine>}
   <ul>{mine.map(c=><li key={c.id} className="wrap-anywhere"><p><strong>{c.sourceKey}</strong> · {c.baseUrl} · {c.enabled?'켜짐':'꺼짐'} · {c.intervalMinutes}분 · 커서 {c.cursor?'있음':'처음부터'}</p>
    <p>마지막 성공 {dateTime(c.lastSuccessAt,'없음')}{c.lastResult?` · 받음 ${c.lastResult.fetched} · 새 ${c.lastResult.created} · 갱신 ${c.lastResult.updated} · 중복 ${c.lastResult.duplicates}`:''}{c.lastError?` · 오류 ${errorLabels[c.lastError]??c.lastError}(연속 ${c.failures}회, 다음 ${dateTime(c.nextAttemptAt)})`:''}</p>
    {view.canEdit?<><Button variant="panel" size="fit" type="button" disabled={saving} onClick={()=>void send({action:c.enabled?'disable':'enable',id:c.id,expectedVersion:c.version},c.enabled?'연결을 껐습니다.':'연결을 켰습니다.')}>{c.sourceKey} {c.enabled?'끄기':'켜기'}</Button>{c.enabled&&<Button variant="panel" size="fit" type="button" disabled={saving} onClick={()=>void send({action:'pull_now',id:c.id},'1페이지를 조회했습니다.')}>{c.sourceKey} 지금 조회</Button>}<Button variant="panel" size="fit" type="button" disabled={saving} onClick={()=>void send({action:'reset_cursor',id:c.id,expectedVersion:c.version},'커서를 처음으로 되돌렸습니다. 중복 주문은 장부에서 한 번만 셉니다.')}>{c.sourceKey} 커서 초기화</Button></>:<LockedNote action={`${c.sourceKey} 연결 바꾸기`} reason={readOnlyReason}/>}
   </li>)}</ul></>}
 </section>;
}
