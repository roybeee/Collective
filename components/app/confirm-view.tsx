'use client';
// 확인 대화상자 본문(components/app/confirm-dialog.tsx가 처음 물을 때 내려받는다).
// 승인 카드 v2(GLOBAL-PLAN X4): fields는 공용 StatList(이름·값 정의 목록)로 영향·되돌리기 문장 위에 보이고, requestChanges가 있으면 '변경 요청' 버튼과 필수 메시지 칸이 생긴다.
import {AlertDialog,AlertDialogAction,AlertDialogCancel,AlertDialogContent,AlertDialogDescription,AlertDialogFooter,AlertDialogHeader,AlertDialogTitle} from '@/components/ui/alert-dialog';
import {useId,useRef,useState} from 'react';
import {Input} from '@/components/ui/input';
import {Textarea} from '@/components/ui/textarea';
import {Button} from '@/components/ui/button';
import {StatList} from './stat-list';
import {confirmFieldLabels,type ConfirmAsk,type ConfirmFields} from './confirm-dialog';
export default function ConfirmView({ask,onAnswer}:{ask:ConfirmAsk;onAnswer:(ok:boolean,value?:string,changes?:string)=>void}){
 const [value,setValue]=useState(''),[changes,setChanges]=useState(''),[asking,setAsking]=useState(false),inputId=useId(),changesId=useId();
 // 버튼 클릭과 닫힘 이벤트가 함께 오므로 한 번만 답한다.
 const answered=useRef(false),reply=(ok:boolean,message?:string)=>{if(answered.current)return;answered.current=true;onAnswer(ok,ask.input?value.trim():undefined,message)};
 const fields=(Object.keys(confirmFieldLabels) as (keyof ConfirmFields)[]).filter(k=>!!ask.fields?.[k]).map(k=>[confirmFieldLabels[k],ask.fields![k]] as const);
 const message=changes.trim(),rc=ask.requestChanges;
 return <AlertDialog open onOpenChange={open=>{if(!open)reply(false)}}>
  <AlertDialogContent>
   <AlertDialogHeader>
    <AlertDialogTitle>{ask.title}</AlertDialogTitle>
    {fields.length>0&&<StatList className="confirm-fields" label="확인 내용" items={fields}/>}
    <AlertDialogDescription asChild><div className="confirm-lines">{ask.body&&<p>{ask.body}</p>}{ask.impact&&<p><b>영향</b> {ask.impact}</p>}{ask.undo&&<p><b>되돌리기</b> {ask.undo}</p>}</div></AlertDialogDescription>
    {ask.input&&<label className="confirm-input" htmlFor={inputId}><span>{ask.input.label}</span><Input id={inputId} type={ask.input.type||'text'} inputMode={ask.input.type==='number'?'numeric':undefined} placeholder={ask.input.placeholder} value={value} onChange={e=>setValue(e.target.value)} autoFocus/></label>}
    {rc&&asking&&<label className="confirm-input" htmlFor={changesId}><span>{rc.fieldLabel||'변경 요청 내용 (필수)'}</span><Textarea id={changesId} rows={3} placeholder={rc.placeholder||'무엇을 어떻게 바꿔야 하는지 적어 주세요.'} value={changes} onChange={e=>setChanges(e.target.value)} autoFocus/></label>}
   </AlertDialogHeader>
   <AlertDialogFooter>
    <AlertDialogCancel onClick={()=>reply(false)}>취소</AlertDialogCancel>
    {rc&&!asking&&<Button type="button" variant="outline" onClick={()=>setAsking(true)}>{rc.label||'변경 요청'}</Button>}
    {rc&&asking&&<Button type="button" variant="outline" disabled={!message} disabledReason={!message?'변경 요청 내용을 먼저 적으세요.':undefined} onClick={()=>reply(false,message)}>{rc.label||'변경 요청'} 보내기</Button>}
    {!asking&&<AlertDialogAction className={ask.danger?'confirm-danger':undefined} disabled={!!ask.input&&!value.trim()} onClick={()=>reply(true)}>{ask.confirmLabel||'계속'}</AlertDialogAction>}
   </AlertDialogFooter>
  </AlertDialogContent>
 </AlertDialog>;
}
