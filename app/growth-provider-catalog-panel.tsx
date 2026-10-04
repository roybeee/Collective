'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {MetaLine} from '@/components/app/meta-line';
import {askConfirm} from '@/components/app/confirm-dialog';
import type {providerCatalogView} from '@/lib/growth-provider-catalog-server';
import styles from './growth-panel.module.css';
type View=Awaited<ReturnType<typeof providerCatalogView>>;
export function GrowthProviderCatalogPanel({campaignId}:{campaignId:string}){return <Workspace key={campaignId} campaignId={campaignId}/>;}
function Workspace({campaignId}:{campaignId:string}){
 const [view,setView]=useState<View|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[form,setForm]=useState({catalogId:'',catalogVersion:1,inventoryId:'',inventoryVersion:0,productId:'',expectedVersion:0});
 const request=useRef<{key:string;id:string}|null>(null),active=useRef<AbortController|null>(null),mounted=useRef(false);
 const refresh=useCallback(async()=>{const controller=new AbortController();active.current?.abort();active.current=controller;const r=await fetch(`/api/growth/provider-catalog?campaignId=${encodeURIComponent(campaignId)}`,{signal:controller.signal,cache:'no-store'});if(!r.ok)throw Error('상품 연결 조회를 다시 시도하세요.');const value=await r.json() as View;if(mounted.current&&!controller.signal.aborted)setView(value);},[campaignId]);
 useEffect(()=>{mounted.current=true;void refresh().catch(()=>{if(mounted.current)setError('상품 연결을 불러오지 못했습니다.');});return()=>{mounted.current=false;active.current?.abort();};},[refresh]);
 async function send(data:Record<string,unknown>){
  if(busy||!view)return;setBusy(true);setError('');
  const payload={campaignId,campaignVersion:view.campaignVersion,...data},key=JSON.stringify(payload);if(request.current?.key!==key)request.current={key,id:crypto.randomUUID()};
  try{const response=await fetch('/api/growth/provider-catalog',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({...payload,requestId:request.current.id})}),result=await response.json() as {error?:string};if(!response.ok)throw Error(result.error??'저장하지 못했습니다.');request.current=null;await refresh();}
  catch(e){if(mounted.current)setError(e instanceof Error?e.message:'저장 상태를 확인하세요.');}finally{if(mounted.current)setBusy(false);}
 }
 const reason=!view?.canManage?'소유자만 판매처 연결을 검토합니다.':!view.connectionReady?'상세 문구의 판매처 연결 설정과 설치 확인이 필요합니다.':undefined;
 return <section className={styles.panel} aria-label="판매처 상품·재고 연결"><header className={styles.header}><h3>판매처 상품·재고 연결</h3><Button variant="panel" size="fit" disabled={busy} onClick={()=>void refresh().catch(()=>setError('조회하지 못했습니다.'))}>새로고침</Button></header>
  <p className={styles.note}>판매처 상품을 한 건씩 읽고 검토합니다. 판매 가능 수량에서 로컬 미이행 예약 전체를 뺀 수량과 로컬 가용 수량 중 작은 값을 사용하며 물리 재고와 기존 예약은 보존합니다. 판매처에서 이미 차감한 예약도 보수적으로 중복 차감할 수 있습니다. 서명 오류·미확인·삭제·15분 경과 시 해당 SKU를 보류합니다. 입출고·실사·반품 변경 후에는 다시 조회하고 승인하세요. 판매처 연결은 상세 문구의 판매처 설정을 사용하며 catalog 읽기 어댑터 설치가 필요합니다.</p>
  {error&&<p role="alert" className={styles.error}>{error}</p>}{reason&&<p className={styles.note}>{reason}</p>}
  <form onSubmit={e=>{e.preventDefault();void send({action:'bind',...form});}}><fieldset disabled={busy||!!reason} className={styles.form}><legend>정확한 상품·재고 연결</legend>
   <label>로컬 상품 ID<Input value={form.catalogId} onChange={e=>setForm({...form,catalogId:e.target.value})}/></label><label>상품 판<Input type="number" min={1} value={form.catalogVersion} onChange={e=>setForm({...form,catalogVersion:Number(e.target.value)})}/></label>
   <label>공유 재고 ID<Input value={form.inventoryId} onChange={e=>setForm({...form,inventoryId:e.target.value})}/></label><label>재고 판<Input type="number" min={0} value={form.inventoryVersion} onChange={e=>setForm({...form,inventoryVersion:Number(e.target.value)})}/></label>
   <label>판매처 상품 ID<Input placeholder="mpd::123" value={form.productId} onChange={e=>setForm({...form,productId:e.target.value})}/></label><label>기존 연결 판 (신규 0)<Input type="number" min={0} value={form.expectedVersion} onChange={e=>setForm({...form,expectedVersion:Number(e.target.value)})}/></label>
   <Button variant="panel" size="fit" type="submit" disabled={busy||!!reason||!form.catalogId||!form.inventoryId||!form.productId} disabledReason={reason??(!form.catalogId||!form.inventoryId||!form.productId?'상품·재고 식별자를 입력하세요.':undefined)}>연결 저장</Button>
  </fieldset></form>
  <ul>{view?.rows.map(({binding:b,source:s})=><li key={b.id}><p><MetaLine items={[b.sku,b.productId,`연결 ${b.version}판`,s?.status==='failed'?'동기화 실패':s?.snapshot?.state??'조회 대기',s?.snapshot?.price!==null&&s?.snapshot?.price!==undefined?`${s.snapshot.price}원`:null,s?.snapshot?.sellable!==null&&s?.snapshot?.sellable!==undefined?`판매 가능 ${s.snapshot.sellable}개`:null,s?.checkedAt,b.approvedDigest&&b.approvedDigest===s?.digest?'근거 승인됨':'검토 필요']}/></p>
   <Button variant="panel" size="fit" disabled={busy||!!reason} disabledReason={reason} onClick={()=>void send({action:'pull',id:b.id,expectedVersion:b.version})}>{b.sku} 판매처 조회</Button>
   <Button variant="panel" size="fit" disabled={busy||!!reason||s?.status!=='ready'||s.snapshot?.state!=='active'} disabledReason={reason??(s?.status!=='ready'||s.snapshot?.state!=='active'?'현재 판매처 상품 근거를 먼저 확인하세요.':undefined)} onClick={async()=>{if(s&&await askConfirm({title:'상품 근거를 승인할까요?',impact:'정확한 SKU·가격·판매 가능 수량을 확인하고 로컬 재고의 상한으로 사용합니다. 기존 예약과 물리 재고는 보존합니다.',undo:'상품 근거가 바뀌면 재검토 상태가 됩니다.',confirmLabel:'근거 승인'}))void send({action:'review',id:b.id,expectedVersion:b.version,sourceVersion:s.version,sourceDigest:s.digest,confirmed:true});}}>{b.sku} 근거 승인</Button>
  </li>)}</ul>
 </section>;
}
