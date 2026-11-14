'use client';
// 실행 중 '지시 추가'(벤치마크 P14, Figma Make 메시지 큐처럼). 진행 중 회의·연속 실행에서 다음 단계 입력부터 반영할 지시를 남긴다.
// 지금 실행 중인 단계는 바뀌지 않는다는 것을 버튼 옆에 늘 적는다. 저장된 지시는 실행 타임라인에 '지시 추가 · 다음 단계부터 반영'으로 보인다.
import '@/lib/i18n/lazy';
import {useId,useState} from 'react';
import {LoaderCircle,MessageSquarePlus} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Textarea} from '@/components/ui/textarea';
import {Label} from '@/components/ui/label';
import {useT} from '@/lib/i18n-react';
import {INSTRUCTION_MAX_CHARS} from '@/lib/meeting-instructions';

export function AddInstruction({onAdd,disabled,disabledReason}:{onAdd:(text:string)=>Promise<void>;disabled?:boolean;disabledReason?:string}){
 const t=useT(),id=useId(),[text,setText]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 async function submit(){
  const value=text.trim();if(!value||busy)return;
  setBusy(true);setError('');
  try{await onAdd(value);setText('')}catch(e){setError((e as Error).message)}finally{setBusy(false)}
 }
 return <form className="grid gap-2 rounded-md border border-border bg-background p-3" data-testid="add-instruction" onSubmit={e=>{e.preventDefault();void submit()}}>
  <Label htmlFor={id}>{t('instruction.label')}</Label>
  <Textarea id={id} value={text} rows={2} maxLength={INSTRUCTION_MAX_CHARS} placeholder={t('instruction.placeholder')} onChange={e=>setText(e.target.value)}/>
  <div className="flex flex-wrap items-center gap-2">
   <Button type="submit" variant="outline" className="min-h-11" disabled={disabled||busy||!text.trim()} disabledReason={disabledReason??(!text.trim()?t('instruction.empty'):undefined)}>{busy?<LoaderCircle className="spin"/>:<MessageSquarePlus/>}{t('instruction.add')}</Button>
   <small className="text-[13px] text-muted-foreground">{t('instruction.next')}</small>
  </div>
  {error&&<p className="form-error m-0" role="alert">{error}</p>}
 </form>;
}
