'use client';
import {useEffect,useId,useState} from 'react';
import {LoaderCircle,RefreshCw,Trash2} from 'lucide-react';
import {toast} from 'sonner';
import {AlertDialog,AlertDialogAction,AlertDialogCancel,AlertDialogContent,AlertDialogDescription,AlertDialogFooter,AlertDialogHeader,AlertDialogTitle} from '@/components/ui/alert-dialog';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import type {Campaign} from '@/lib/agency';
import {api} from '@/lib/client';
import {ALREADY_DELETED,COUNTS_CHANGED,LOAD_FAILED,STALE_CAMPAIGN,canConfirmDeletion,deletionSummary,needsTitleConfirmation,previewFailure,readDeletionPreview,recheckDeletion,type DeletionPreview} from '@/lib/deletion-summary';

// 조회 404: 다른 탭 등에서 이미 삭제된 캠페인. 다시 시도해도 같으므로 목록 새로 고침을 권한다.
class CampaignGone extends Error{}
// 삭제 전 영향 조회(GET /api/campaigns/[id]/deletion). 삭제와 같은 판정으로 삭제 불가 사유와 kind별 삭제·보존 건수를 받는다.
async function loadPreview(id:string,signal?:AbortSignal){
 const response=await fetch('/api/campaigns/'+encodeURIComponent(id)+'/deletion',{signal});
 const result=await response.json().catch(()=>null) as {error?:string}|null;
 if(!response.ok){const failure=previewFailure(response.status,result?.error);throw failure.gone?new CampaignGone(failure.message):new Error(failure.message)}
 return readDeletionPreview(result);
}

export function DeleteCampaignDialog({campaign,onClose,onDeleted}:{campaign:Campaign|null;onClose:()=>void;onDeleted:(id:string)=>Promise<void>}){
 const[busy,setBusy]=useState(false);
 // 캠페인마다 본문을 새로 그려(key) 조회 결과·입력한 제목·오류가 다른 캠페인으로 넘어가지 않게 한다.
 return <AlertDialog open={!!campaign} onOpenChange={open=>{if(!open&&!busy)onClose()}}><AlertDialogContent className="delete-campaign-dialog" onEscapeKeyDown={e=>{if(busy)e.preventDefault()}}>{campaign&&<DeleteCampaignBody key={campaign.id} campaign={campaign} busy={busy} setBusy={setBusy} onClose={onClose} onDeleted={onDeleted}/>}</AlertDialogContent></AlertDialog>;
}

function DeleteCampaignBody({campaign,busy,setBusy,onClose,onDeleted}:{campaign:Campaign;busy:boolean;setBusy:(busy:boolean)=>void;onClose:()=>void;onDeleted:(id:string)=>Promise<void>}){
 const id=campaign.id,inputId=useId(),hintId=useId();
 const[preview,setPreview]=useState<DeletionPreview|null>(null);const[loadError,setLoadError]=useState('');const[gone,setGone]=useState(false);const[attempt,setAttempt]=useState(0);const[typed,setTyped]=useState('');const[error,setError]=useState('');
 useEffect(()=>{const controller=new AbortController();loadPreview(id,controller.signal).then(p=>{if(!controller.signal.aborted)setPreview(p)},e=>{if(controller.signal.aborted)return;if(e instanceof CampaignGone)setGone(true);else setLoadError(e instanceof Error&&e.message?e.message:LOAD_FAILED)});return()=>controller.abort()},[id,attempt]);
 function retry(){setPreview(null);setLoadError('');setAttempt(n=>n+1)}
 // 이미 삭제된 캠페인: 목록을 새로 고친 뒤 닫는다. 목록을 읽지 못하면 워크스페이스가 오류와 다시 시도를 보인다.
 function refreshGone(){void onDeleted(id).catch(()=>{}).finally(onClose)}
 // 목록의 캠페인이 조회한 캠페인보다 오래됐으면(다른 곳에서 브리프 수정) 제목 입력 전에 알리고 삭제를 막는다(서버도 409).
 const stale=!!preview&&preview.version!==campaign.version;
 const summary=preview&&!gone&&deletionSummary(preview),askTitle=!!preview?.deletable&&!stale&&!gone&&needsTitleConfirmation(preview),ready=!!preview&&!stale&&!gone&&canConfirmDeletion(preview,campaign.title,typed);
 async function remove(){
  if(!preview||busy||!ready)return;setBusy(true);setError('');
  try{
   // 삭제 직전에 다시 조회한다. 연 뒤에 기록이 늘거나 캠페인이 바뀌었으면 삭제하지 않고 새 결과로 다시 확인하게 한다(서버는 제목 확인을 강제하지 않는다).
   // 버전 변경·삭제 불가는 새 조회 결과로 본문에 보이므로 건수 변경만 오류로 알린다.
   const fresh=await loadPreview(id),changed=recheckDeletion(preview,fresh,campaign.version);
   if(changed){setPreview(fresh);setTyped('');setError(changed===COUNTS_CHANGED?changed:'');return}
   await api('delete_campaign',{id,version:fresh.version,confirmed:true});await onDeleted(id);onClose();toast.success('캠페인을 삭제했습니다.');
  }catch(e){if(e instanceof CampaignGone)setGone(true);else setError((e as Error).message)}finally{setBusy(false)}
 }
 return <><AlertDialogHeader><AlertDialogTitle>캠페인을 삭제할까요?</AlertDialogTitle><AlertDialogDescription>「{campaign.title}」 브리프와 아래 기록을 삭제합니다. 삭제 후 복구할 수 없습니다. 바이럴 출처 학습 규칙은 지우지 않고 종료 상태와 원 캠페인 삭제 표시로 남깁니다. 브랜드 지식, 수집한 바이럴 사례, 점포 실험은 유지됩니다.</AlertDialogDescription></AlertDialogHeader>
  <div className="deletion-impact" aria-live="polite">
   {!preview&&!loadError&&!gone&&<p className="loading-line"><LoaderCircle className="spin" size={15}/>삭제할 기록을 확인하고 있습니다.</p>}
   {loadError&&<div className="load-error" role="alert"><span>{loadError}</span><Button variant="outline" size="sm" onClick={retry}><RefreshCw/>다시 시도</Button></div>}
   {gone&&<div className="load-error" role="alert"><span>{ALREADY_DELETED}</span><Button variant="outline" size="sm" onClick={refreshGone}><RefreshCw/>목록 새로 고침</Button></div>}
   {stale&&!gone&&<p role="alert" className="form-error">{STALE_CAMPAIGN}</p>}
   {summary&&(summary.blockedReason?<p role="alert" className="form-error">{summary.blockedReason}</p>:<><p>{summary.deleted}</p>{summary.retained&&<p>{summary.retained}</p>}</>)}
   {askTitle&&<div className="field deletion-confirm"><label htmlFor={inputId}>캠페인 제목 확인</label><Input id={inputId} aria-describedby={hintId} value={typed} onChange={e=>setTyped(e.target.value)} placeholder={campaign.title} autoComplete="off" disabled={busy}/><small id={hintId}>작업물·실행·회의·성과 기록이 있어 캠페인 제목을 그대로 입력해야 삭제할 수 있습니다.</small></div>}
  </div>
  {error&&<p role="alert" className="form-error">{error}</p>}<AlertDialogFooter><AlertDialogCancel disabled={busy}>취소</AlertDialogCancel><AlertDialogAction variant="destructive" disabled={busy||!ready} onClick={e=>{e.preventDefault();void remove()}}>{busy?<LoaderCircle className="spin"/>:<Trash2/>}{busy?'삭제 중…':'캠페인 삭제'}</AlertDialogAction></AlertDialogFooter></>;
}
