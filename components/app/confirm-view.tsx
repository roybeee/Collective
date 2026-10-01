'use client';
// 확인 대화상자 본문(components/app/confirm-dialog.tsx가 처음 물을 때 내려받는다).
import {AlertDialog,AlertDialogAction,AlertDialogCancel,AlertDialogContent,AlertDialogDescription,AlertDialogFooter,AlertDialogHeader,AlertDialogTitle} from '@/components/ui/alert-dialog';
import {useRef} from 'react';
import type {ConfirmAsk} from './confirm-dialog';
export default function ConfirmView({ask,onAnswer}:{ask:ConfirmAsk;onAnswer:(ok:boolean)=>void}){
 // 버튼 클릭과 닫힘 이벤트가 함께 오므로 한 번만 답한다.
 const answered=useRef(false),reply=(ok:boolean)=>{if(answered.current)return;answered.current=true;onAnswer(ok)};
 return <AlertDialog open onOpenChange={open=>{if(!open)reply(false)}}>
  <AlertDialogContent>
   <AlertDialogHeader>
    <AlertDialogTitle>{ask.title}</AlertDialogTitle>
    <AlertDialogDescription asChild><div className="confirm-lines">{ask.body&&<p>{ask.body}</p>}{ask.impact&&<p><b>영향</b> {ask.impact}</p>}{ask.undo&&<p><b>되돌리기</b> {ask.undo}</p>}</div></AlertDialogDescription>
   </AlertDialogHeader>
   <AlertDialogFooter>
    <AlertDialogCancel onClick={()=>reply(false)}>취소</AlertDialogCancel>
    <AlertDialogAction className={ask.danger?'confirm-danger':undefined} onClick={()=>reply(true)}>{ask.confirmLabel||'계속'}</AlertDialogAction>
   </AlertDialogFooter>
  </AlertDialogContent>
 </AlertDialog>;
}
