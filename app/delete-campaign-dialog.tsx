'use client';
import {useEffect,useState} from 'react';
import {LoaderCircle,Trash2} from 'lucide-react';
import {toast} from 'sonner';
import {AlertDialog,AlertDialogAction,AlertDialogCancel,AlertDialogContent,AlertDialogDescription,AlertDialogFooter,AlertDialogHeader,AlertDialogTitle} from '@/components/ui/alert-dialog';
import type {Campaign} from '@/lib/agency';
import {api} from '@/lib/client';

export function DeleteCampaignDialog({campaign,onClose,onDeleted}:{campaign:Campaign|null;onClose:()=>void;onDeleted:(id:string)=>Promise<void>}){
 const[busy,setBusy]=useState(false);const[error,setError]=useState('');
 useEffect(()=>setError(''),[campaign?.id]);
 async function remove(){
  if(!campaign||busy)return;setBusy(true);setError('');
  try{await api('delete_campaign',{id:campaign.id,version:campaign.version,confirmed:true});await onDeleted(campaign.id);onClose();toast.success('캠페인을 삭제했습니다.');}
  catch(e){setError((e as Error).message)}finally{setBusy(false)}
 }
 return <AlertDialog open={!!campaign} onOpenChange={open=>{if(!open&&!busy)onClose()}}><AlertDialogContent onEscapeKeyDown={e=>{if(busy)e.preventDefault()}}><AlertDialogHeader><AlertDialogTitle>캠페인을 삭제할까요?</AlertDialogTitle><AlertDialogDescription>「{campaign?.title}」의 브리프, 작업물, 성과, 실행 이력과 연결된 실험·학습 규칙을 삭제합니다. 삭제 후 복구할 수 없습니다. 브랜드 지식과 수집한 바이럴 사례는 유지됩니다.</AlertDialogDescription></AlertDialogHeader>{error&&<p role="alert" className="form-error">{error}</p>}<AlertDialogFooter><AlertDialogCancel disabled={busy}>취소</AlertDialogCancel><AlertDialogAction variant="destructive" disabled={busy} onClick={e=>{e.preventDefault();void remove()}}>{busy?<LoaderCircle className="spin"/>:<Trash2/>}{busy?'삭제 중…':'캠페인 삭제'}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>;
}
