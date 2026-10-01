'use client';
// 확인 대화상자 본문(components/app/confirm-dialog.tsx가 처음 물을 때 내려받는다).
import {AlertDialog,AlertDialogAction,AlertDialogCancel,AlertDialogContent,AlertDialogDescription,AlertDialogFooter,AlertDialogHeader,AlertDialogTitle} from '@/components/ui/alert-dialog';
import {useId,useRef,useState} from 'react';
import type {ConfirmAsk} from './confirm-dialog';
export default function ConfirmView({ask,onAnswer}:{ask:ConfirmAsk;onAnswer:(ok:boolean,value?:string)=>void}){
 const [value,setValue]=useState(''),inputId=useId();
 // 버튼 클릭과 닫힘 이벤트가 함께 오므로 한 번만 답한다.
 const answered=useRef(false),reply=(ok:boolean)=>{if(answered.current)return;answered.current=true;onAnswer(ok,ask.input?value.trim():undefined)};
 return <AlertDialog open onOpenChange={open=>{if(!open)reply(false)}}>
  <AlertDialogContent>
   <AlertDialogHeader>
    <AlertDialogTitle>{ask.title}</AlertDialogTitle>
    <AlertDialogDescription asChild><div className="confirm-lines">{ask.body&&<p>{ask.body}</p>}{ask.impact&&<p><b>영향</b> {ask.impact}</p>}{ask.undo&&<p><b>되돌리기</b> {ask.undo}</p>}</div></AlertDialogDescription>
    {ask.input&&<label className="confirm-input" htmlFor={inputId}><span>{ask.input.label}</span><input id={inputId} type={ask.input.type||'text'} inputMode={ask.input.type==='number'?'numeric':undefined} placeholder={ask.input.placeholder} value={value} onChange={e=>setValue(e.target.value)} autoFocus/></label>}
   </AlertDialogHeader>
   <AlertDialogFooter>
    <AlertDialogCancel onClick={()=>reply(false)}>취소</AlertDialogCancel>
    <AlertDialogAction className={ask.danger?'confirm-danger':undefined} disabled={!!ask.input&&!value.trim()} onClick={()=>reply(true)}>{ask.confirmLabel||'계속'}</AlertDialogAction>
   </AlertDialogFooter>
  </AlertDialogContent>
 </AlertDialog>;
}
