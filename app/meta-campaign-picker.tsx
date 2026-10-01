'use client';
import {useState} from 'react';
import {Button} from '@/components/ui/button';
import type {MetaCampaignOption} from '@/lib/meta-insights-provider';
import s from './meta-insights-panel.module.css';
type Connection={accountId:string;version:number;updatedAt:string};
export function MetaCampaignPicker({campaignId,connection,disabled,onSelect}:{campaignId:string;connection:Connection;disabled:boolean;onSelect:(id:string)=>void}) {
 const [items,setItems]=useState<MetaCampaignOption[]>([]),[cursor,setCursor]=useState<string|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[loaded,setLoaded]=useState(false),[page,setPage]=useState(0);
 async function browse(after='') {
  setBusy(true);setError('');
  try {const r=await fetch('/api/meta-ads/campaigns',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'browse',campaignId,cursor:after,connectionVersion:connection.version,connectionUpdatedAt:connection.updatedAt})});const v=await r.json() as {accountId:string;items:MetaCampaignOption[];nextCursor:string|null;error?:string};if(!r.ok)throw new Error(v.error||'목록 조회 실패');if(v.accountId!==connection.accountId)throw new Error('광고 계정이 변경되었습니다. 다시 조회하세요.');setItems(v.items);setCursor(v.nextCursor);setLoaded(true);setPage(p=>after?p+1:1);}catch(e){setError(e instanceof Error?e.message:'목록 조회 실패');}finally{setBusy(false);}
 }
 const status=(value:string)=>({ACTIVE:'활성',PAUSED:'비활성',ARCHIVED:'보관',DELETED:'삭제'}[value]??value);
 return <div className={s.boundary} aria-label="연결 계정 캠페인 선택"><b>캠페인 ID를 모르시나요?</b><p className={s.help}>연결 계정 {connection.accountId}의 목록을 조회해 선택하세요. 선택은 조회 입력만 채우며 성과를 저장하거나 광고를 변경하지 않습니다.</p><Button type="button" variant="outline" disabled={disabled||busy} onClick={()=>void browse()}>{busy?'목록 조회 중…':loaded?'목록 처음부터 조회':'연결 계정의 캠페인 찾기'}</Button>{error&&<p className={s.error} role="alert">{error} 이전 목록은 선택할 수 없습니다.</p>}{loaded&&<><p className={s.help}>페이지 {page} · 최대 50개 · 전체 계정 목록의 일부일 수 있습니다.</p><div className="grid gap-2">{items.map(v=><div key={v.id} className="border-t border-border pt-2 min-w-0"><b className="wrap-anywhere">{v.name}</b><p className={s.help}>ID {v.id} · {status(v.effectiveStatus)} · {v.objective}</p><Button type="button" size="sm" variant="outline" disabled={disabled||busy||!!error} onClick={()=>onSelect(v.id)} aria-label={v.name+' 조회에 사용'}>조회에 사용</Button></div>)}</div>{!items.length&&<p className={s.help}>이 페이지에 반환된 캠페인이 없습니다.</p>}{cursor&&<Button type="button" variant="outline" disabled={disabled||busy||!!error} onClick={()=>void browse(cursor)}>다음 50개 조회</Button>}</>}</div>;
}
