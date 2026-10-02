'use client';
import {EmptyLine} from '@/components/app/empty-line';
import {useEffect,useId,useState} from 'react';
import {RefreshCw,ShieldCheck,Wallet} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Checkbox} from '@/components/ui/checkbox';
import type {MetaBudgetScope,MetaBudgetReview} from '@/lib/meta-budget-review';
import s from './meta-insights-panel.module.css';
import {ScreenSkeleton} from '@/components/app/screen-skeleton';
type View={scope:MetaBudgetScope;digest:string;issues:string[];records:MetaBudgetReview[];version:number;current:boolean;canEdit:boolean;maySpend:false;status:string};
const money=(v:number|null)=>v===null?'미입력':v.toLocaleString('ko-KR')+'원';
const date=(v:string)=>v&&Number.isFinite(Date.parse(v))?new Date(v).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'}):'미입력';
const message=(e:unknown)=>e instanceof Error?e.message:'처리하지 못했습니다.';
export function MetaBudgetPanel({campaignId}:{campaignId:string}) {
 const id=useId(),[view,setView]=useState<View|null>(null),[busy,setBusy]=useState(true),[error,setError]=useState(''),[success,setSuccess]=useState(''),[note,setNote]=useState(''),[ack,setAck]=useState(false),[retry,setRetry]=useState(0);
 useEffect(()=>{const a=new AbortController();void fetch('/api/meta-ads/budget?campaignId='+encodeURIComponent(campaignId),{signal:a.signal}).then(async r=>{const v=await r.json() as View&{error?:string};if(!r.ok)throw new Error(v.error||'조회 실패');if(a.signal.aborted)return;setView(v);setAck(false);setError('');}).catch(e=>{if(!a.signal.aborted)setError(message(e));}).finally(()=>{if(!a.signal.aborted)setBusy(false);});return()=>a.abort();},[campaignId,retry]);
 async function record(action:'review'|'revoke') {
  if(!view)return;setBusy(true);setError('');setSuccess('');
  try {const r=await fetch('/api/meta-ads/budget',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({campaignId,action,expectedVersion:view.version,expectedDigest:view.digest,note,confirmed:ack})});const v=await r.json() as View&{error?:string;duplicate?:boolean};if(!r.ok)throw new Error(v.error||'기록 실패');setView(v);setAck(false);setNote('');setSuccess(action==='revoke'?'예산 검토를 철회했습니다. 외부 광고 상태는 변경되지 않습니다.':v.duplicate?'현재 기준의 검토가 이미 기록되어 있습니다.':'예산 범위 검토를 기록했습니다. 광고는 시작되지 않습니다.');}catch(e){setError(message(e));}finally{setBusy(false);}
 }
 const p=view?.scope,disabled=busy||!view?.canEdit,latest=view?.records[0];
 return <section className={s.root} aria-label="광고 예산 범위 검토" aria-busy={busy}>
  <header className={s.header}><div><span className={s.eyebrow}>COLLECTIVE / BUDGET</span><h2>얼마까지, 언제까지 투자할까요?</h2><p>저장된 계획과 소재를 기준으로 이번 실험의 예산 범위를 검토합니다.</p></div><Button variant="outline" disabled={busy} onClick={()=>{setBusy(true);setSuccess('');setRetry(n=>n+1);}}><RefreshCw size={16}/>다시 불러오기</Button></header>
  <div className={s.boundary}><ShieldCheck size={20}/><div><b>예산 검토 기록 · 광고 시작 전 단계</b><p>이 기록은 지출 승인이 아닙니다. 광고세트·광고·전환 경로와 외부 예산 단위, 한도·중단 기능을 확인한 뒤 실제 집행을 별도로 승인해야 합니다.</p></div></div>
  {error&&<p role="alert" className={s.error}>{error} 입력한 메모는 유지됩니다.</p>}{success&&<p role="status" className={s.success}>{success}</p>}
  {p&&view?<>
   <div className={s.metrics}><div><span>총 광고 예산</span><strong>{money(p.totalBudget)}</strong></div><div><span>안전 여유</span><strong>{money(p.safetyReserve)}</strong></div><div><span>안전 여유를 제외한 금액</span><strong>{money(p.allocatable)}</strong></div><div><span>손실 한도</span><strong>{money(p.lossLimit)}</strong></div></div>
   <div className={s.workspace}><div className={s.card}><div className={s.title}><Wallet size={20}/><h3>이번 검토에 고정되는 범위</h3></div><dl><dt>상품·오퍼</dt><dd>{p.product||'미입력'}</dd><dt>광고 계정</dt><dd>{p.accountId||'읽기 연결 필요'}</dd><dt>기간 · 한국 시간</dt><dd>{date(p.startAt)} — {date(p.endAt)}</dd><dt>일별 운영 목표</dt><dd>{money(p.dailyTarget)}</dd><dt>중단 기준</dt><dd>{p.stopRule||'미입력'}</dd><dt>랜딩 주소</dt><dd className="wrap-anywhere">{p.landingUrl||'미입력'}</dd></dl><p className={s.help}>금액은 원 단위 계획값입니다. Meta의 청구 상한이나 자동 중단은 설정되지 않으며, 일별 목표도 절대 상한이 아닙니다.</p></div>
   <div className={s.card}><h3>{view.current?'현재 기준 검토 기록 있음':view.status==='stale'?'기준 변경 · 다시 검토하세요':view.status==='revoked'?'검토 철회됨':'검토 전 확인할 항목'}</h3>{view.issues.length?<ul>{view.issues.map(v=><li key={v}>{v}</li>)}</ul>:<p>저장된 계획·소재 검토와 연결 계정이 준비되어 있습니다. 금액과 기간을 확인하고 메모를 남기세요.</p>}<p className={s.help}>실행 준비에서 값을 고치면 이 화면을 다시 불러오세요. 계획·소재·근거·계정이 바뀌거나 시작 시각이 지나면 이전 검토는 현재 기준에 사용할 수 없습니다.</p></div></div>
   <div className={s.card}><h3>검토 또는 철회 기록</h3><label htmlFor={id+'note'}>검토 메모<Input id={id+'note'} value={note} maxLength={500} disabled={disabled} placeholder="금액을 정한 이유와 확인한 조건" onChange={e=>{setNote(e.target.value);setAck(false);}}/></label><label className={s.fields}><Checkbox disabled={disabled} checked={ack} onCheckedChange={v=>setAck(v===true)}/>범위와 한계를 확인했으며, 이 기록으로 광고가 시작되지 않음을 이해했습니다</label><div className={s.columns}><Button disabled={disabled||!ack||!note.trim()||!!view.issues.length||view.current} disabledReason={!ack?'확인 칸을 먼저 체크하세요.':(!note.trim())?'필수 칸을 먼저 채우세요.':!!view.issues.length?'위에 표시된 문제를 먼저 해결하세요.':undefined} onClick={()=>void record('review')}>현재 예산 검토 기록</Button><Button variant="outline" disabled={disabled||!ack||!note.trim()||latest?.action!=='review'} disabledReason={!ack?'확인 칸을 먼저 체크하세요.':(!note.trim())?'필수 칸을 먼저 채우세요.':(latest?.action!=='review')?'검토 단계에서만 할 수 있습니다.':undefined} onClick={()=>void record('revoke')}>이전 검토 철회</Button></div>{!view.canEdit&&<p className={s.help}>검토·철회는 워크스페이스 소유자만 할 수 있습니다.</p>}</div>
   <div className={s.card}><h3>검토 이력</h3><p className={s.caption}>최근 20개 · 이전 금액과 판단을 보존합니다.</p>{view.records.map(v=><article key={v.id} className={s.boundary}><div><b>v{v.version} · {v.action==='review'?'예산 검토':'검토 철회'}</b><p>{date(v.recordedAt)} KST · 총 {money(v.scope.totalBudget)} · 안전 여유 {money(v.scope.safetyReserve)}</p><p>{v.note}</p><p className={s.help}>{v.scope.product} · {date(v.scope.startAt)} — {date(v.scope.endAt)}</p></div></article>)}{!view.records.length&&<EmptyLine className={s.empty} next="예산 검토를 기록하면 여기에 쌓입니다.">아직 기록한 예산 검토가 없습니다.</EmptyLine>}</div>
  </>:!error&&<ScreenSkeleton label="예산과 현재 검토 근거를 불러오고 있습니다." rows={2}/>}
 </section>;
}
