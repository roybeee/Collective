'use client';
import {CheckInput} from '@/components/app/check';
import {NativeSelect} from '@/components/ui/native-select';
import {Input} from '@/components/ui/input';
import {Button} from '@/components/ui/button';
import {Note} from '@/components/app/note';
import {useEffect,useRef,useState} from 'react';
import {emptyAuthorityInput,type AuthorityInput} from '@/lib/growth-authority';
import styles from './growth-panel.module.css';
import {ScreenSkeleton} from '@/components/app/screen-skeleton';

type AuthorityRow={id:string;version:number;input:AuthorityInput};
type CommitmentRow={id:string;missionId:string;missionVersion:number};
type AuthorityView={authorities:AuthorityRow[];commitments:CommitmentRow[];canAuthorize:boolean;canReserve:boolean;campaignVersion:number};
type Mission={id:string;version:number;input:{title?:unknown};status?:string;readiness?:{missing:string[]}};
const capFields=[['totalCap','기간 총한도'],['dayCap','하루 한도'],['weekCap','한 주 한도'],['lossCap','탐색 손실 한도']] as const;
async function call(url:string,init:RequestInit):Promise<AuthorityView>{
 const r=await fetch(url,{...init,cache:'no-store'}),raw:unknown=await r.json();
 if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new Error('위임 응답 형식을 확인하세요.');
 const data=raw as Record<string,unknown>;
 if(!r.ok)throw new Error(typeof data.error==='string'?data.error:'위임 기록을 불러오지 못했습니다.');
 if(!Array.isArray(data.authorities)||!Array.isArray(data.commitments)||typeof data.canAuthorize!=='boolean')throw new Error('위임 응답 형식을 확인하세요.');
 return data as unknown as AuthorityView;
}
export function GrowthAuthorityPanel({campaignId,missions}:{campaignId:string;missions:Mission[]}){
 const [view,setView]=useState<AuthorityView|null>(null),[draft,setDraft]=useState<AuthorityInput>(()=>({...emptyAuthorityInput(),channel:'manual'}));
 const [identity,setIdentity]=useState({id:crypto.randomUUID() as string,version:0}),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
 const [sign,setSign]=useState(false),[missionId,setMissionId]=useState('');
 const request=useRef<AbortController|null>(null);
 useEffect(()=>{const c=new AbortController();request.current=c;void call(`/api/growth/authority?campaignId=${encodeURIComponent(campaignId)}`,{signal:c.signal}).then(v=>{if(!c.signal.aborted)setView(v)}).catch(e=>{if(!c.signal.aborted)setError(e.message)});return()=>{c.abort();request.current?.abort()};},[campaignId]);
 const selected=view?.authorities.find(r=>r.id===identity.id);
 const edit=!!view?.canAuthorize&&!busy;
 function choose(row?:AuthorityRow){setIdentity({id:row?.id??crypto.randomUUID(),version:row?.version??0});setDraft(row?{...row.input}:{...emptyAuthorityInput(),channel:'manual'});setSign(false);setError('');setMessage('');}
 function change(patch:Partial<AuthorityInput>){setDraft(v=>({...v,...patch}));setSign(false);setMessage('');}
 async function refresh(){
  request.current?.abort();const c=new AbortController();request.current=c;setBusy(true);setError('');
  try{const v=await call(`/api/growth/authority?campaignId=${encodeURIComponent(campaignId)}`,{signal:c.signal});if(!c.signal.aborted)setView(v)}catch(e){if(!c.signal.aborted)setError((e as Error).message)}finally{if(!c.signal.aborted)setBusy(false)}
 }
 async function post(action:string){
  if(busy||!view)return;
  const c=new AbortController();request.current=c;setBusy(true);setError('');setMessage('');
  try{
   const next=await call('/api/growth/authority',{method:'POST',headers:{'Content-Type':'application/json'},signal:c.signal,body:JSON.stringify({action,campaignId,campaignVersion:view.campaignVersion,id:identity.id,expectedVersion:identity.version,input:draft,sign,authorityId:identity.id,missionId,missionVersion:missions.find(m=>m.id===missionId)?.version})});
   if(c.signal.aborted)return;setView(next);const row=next.authorities.find(r=>r.id===identity.id);if(row){setIdentity({id:row.id,version:row.version});setDraft({...row.input})}setSign(false);setMessage(action==='reserve_mission'?'계획 예산을 예약했습니다. 외부 집행은 수행하지 않았습니다.':'위임 기록을 저장했습니다.');
  }catch(e){if(!c.signal.aborted)setError(`${(e as Error).message} 입력을 유지했습니다.`)}finally{if(!c.signal.aborted)setBusy(false)}
 }
 const stale=selected&&selected.version!==identity.version;
 const modified=!selected||JSON.stringify(selected.input)!==JSON.stringify(draft);
 return <section aria-label="판매 위임과 예산 한도" className={styles.business}><header className={styles.header}><div><h3>판매 위임과 예산 한도</h3><p>계정·기간·행동별 한도를 정하고, 준비된 미션의 계획 예산을 예약합니다.</p></div><Button variant="panel" size="fit" aria-label="위임 새로고침" type="button" onClick={()=>void refresh()} disabled={busy}>새로고침</Button></header><Note className={styles.note}>여기서 저장하는 위임·예약은 로컬 계획 기록입니다. 자동 게시·광고비 사용은 외부 채널의 실행 승인과 실제 지출을 연결한 뒤에만 일어납니다.</Note>{error&&<p role="alert" className={styles.error}>{error}</p>}{message&&<p role="status">{message}</p>}{!view?<ScreenSkeleton label="위임 기록을 불러오는 중입니다." rows={2}/>:<><div className={styles.actions}><Button variant="panel" size="fit" type="button" disabled={!edit} disabledReason={!edit?'위임 권한이 없거나 저장 중입니다.':undefined} onClick={()=>choose()}>새 판매 위임</Button>{view.authorities.map(r=><Button variant="panel" size="fit" type="button" key={r.id} disabled={busy} onClick={()=>choose(r)} aria-pressed={r.id===identity.id}>{r.input.accountId||'미확인 계정'} · {r.input.status==='active'?'유효':r.input.status==='revoked'?'철회':'초안'} · v{r.version}</Button>)}</div>{modified&&identity.version>0&&<p className={styles.note}>저장하지 않은 위임 변경이 있습니다. 저장 후 예산을 예약할 수 있습니다.</p>}{selected&&<p className={styles.note}>저장된 예약 범위: {selected.input.accountId} · {selected.input.channel} · 총한도 {selected.input.totalCap===null?'미확인':selected.input.totalCap.toLocaleString('ko-KR')+'원'}</p>}{stale&&<p role="alert">서버의 위임이 변경되었습니다. 목록에서 최신 위임을 선택해 비교하세요. 입력은 유지했습니다.</p>}<form onSubmit={e=>{e.preventDefault();void post('save_authority')}}><fieldset className={styles.form} disabled={!edit}><legend>위임 범위</legend><label>계정 식별자<Input value={draft.accountId} maxLength={100} onChange={e=>change({accountId:e.target.value})}/></label><label>위임 채널<NativeSelect value={draft.channel} onChange={e=>change({channel:e.target.value})}>{[['manual','수동 운영'],['storefront','자사몰'],['organic','자연 유입'],['meta','Meta 광고']].map(([v,n])=><option value={v} key={v}>{n}</option>)}</NativeSelect></label><label>위임 단계<NativeSelect value={draft.maxTier} onChange={e=>change({maxTier:e.target.value as AuthorityInput['maxTier']})}>{[['T0','읽기·분석'],['T1','초안 작성'],['T2','게시'],['T3','한도 내 지출']].map(([v,n])=><option value={v} key={v}>{n}</option>)}</NativeSelect></label><label>위임 상태<NativeSelect value={draft.status} onChange={e=>change({status:e.target.value as AuthorityInput['status']})}><option value="draft">초안</option><option value="active">소유자 서명 후 유효</option>{draft.status==='revoked'&&<option value="revoked">철회됨</option>}</NativeSelect></label>{[['startsAt','위임 시작'],['expiresAt','위임 만료'],['periodStart','예산 기간 시작'],['periodEnd','예산 기간 종료']].map(([k,n])=><label key={k}>{n} (ISO 시각)<Input placeholder="2026-10-01T00:00:00+09:00" value={String(draft[k as keyof AuthorityInput]??'')} onChange={e=>change({[k]:e.target.value})}/></label>)}{capFields.map(([k,n])=><label key={k}>{n} (원)<Input type="number" min={0} step={1} value={draft[k]??''} onChange={e=>change({[k]:e.target.value===''?null:Number(e.target.value)})}/></label>)}<fieldset><legend>허용할 행동</legend>{[['read','읽기'],['draft','초안'],['publish','게시'],['spend','지출']].map(([v,n])=><label key={v} className={styles.check}><CheckInput checked={draft.allowedActions.includes(v as AuthorityInput['allowedActions'][number])} onChange={e=>change({allowedActions:e.target.checked?[...draft.allowedActions,v as AuthorityInput['allowedActions'][number]]:draft.allowedActions.filter(x=>x!==v)})}/>{n}</label>)}</fieldset>{draft.status==='active'&&<label className={styles.check}><CheckInput checked={sign} onChange={e=>setSign(e.target.checked)}/>소유자로서 이 계정·기간·행동·금액의 위임을 확인합니다.</label>}</fieldset>{view.canAuthorize&&<div className={styles.actions}><Button variant="panel" size="fit" type="submit" disabled={busy||!!stale||(draft.status==='active'&&!sign)} disabledReason={stale?'다른 곳에서 먼저 바뀌었습니다. 최신 기록을 불러온 뒤 다시 하세요.':draft.status==='active'&&!sign?'활성 위임은 서명 확인을 먼저 체크하세요.':undefined}>판매 위임 저장</Button><Button variant="panel" size="fit" type="button" disabled={busy||!!stale||!selected||selected.input.status==='revoked'} disabledReason={!!stale?'다른 곳에서 먼저 바뀌었습니다. 최신 기록을 불러온 뒤 다시 하세요.':!selected?'먼저 대상을 고르세요.':(selected.input.status==='revoked')?'철회한 기록입니다.':undefined} onClick={()=>void post('revoke_authority')}>선택 위임 철회</Button></div>}</form>{view.canReserve&&selected&&<form onSubmit={e=>{e.preventDefault();void post('reserve_mission')}}><label>예산 예약할 미션<NativeSelect value={missionId} onChange={e=>setMissionId(e.target.value)}><option value="">준비된 미션 선택</option>{missions.filter(m=>m.status==='staged'&&!m.readiness?.missing.length).map(m=><option key={m.id} value={m.id}>{String(m.input.title??'판매 미션')}</option>)}</NativeSelect></label><Button variant="panel" size="fit" type="submit" disabled={busy||modified||!!stale||!missionId||selected.input.status!=='active'} disabledReason={modified?'다른 곳에서 먼저 바뀌었습니다. 최신 기록을 불러온 뒤 다시 하세요.':!!stale?'다른 곳에서 먼저 바뀌었습니다. 최신 기록을 불러온 뒤 다시 하세요.':!missionId?'미션을 먼저 고르세요.':(selected.input.status!=='active')?'활성 상태에서만 할 수 있습니다.':undefined}>미션 계획 예산 예약</Button></form>}<p className={styles.note}>예약 기록 {view.commitments.length}건. 이미 예약한 비용은 위임을 철회해도 남으니 대사에서 해제하세요.</p></>}</section>;
}
