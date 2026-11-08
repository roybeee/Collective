'use client';
// 회의 '남은 이견' A/B 선택 카드(GLOBAL-PLAN X2). A=채택한 방향, B=남은 이견. 사용자가 A·B·둘 다 보류 중 하나를 고르고 저장하면 기록(meeting_choice)으로 남아 다음 단계 입력에 들어간다.
// 색만으로 선택을 구분하지 않고 aria-pressed와 글자로 보인다. 버튼은 44px 이상이다.
import {useId,useState} from 'react';
import {Check,LoaderCircle} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {MetaLine} from '@/components/app/meta-line';
import {choiceLabels,type MeetingChoice,type MeetingChoiceValue} from '@/lib/meetings';

type Props={optionA:string;optionB:string;current?:MeetingChoice;waiting?:boolean;busy?:boolean;disabled?:boolean;disabledReason?:string;onChoose:(choice:MeetingChoiceValue)=>Promise<void>|void};
const when=(s:string)=>new Date(s).toLocaleString('ko-KR',{timeZone:'Asia/Seoul',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'});
export function ChoiceCard({optionA,optionB,current,waiting,busy,disabled,disabledReason,onChoose}:Props){
 const id=useId(),[picked,setPicked]=useState<MeetingChoiceValue|null>(null);
 const options:[MeetingChoiceValue,string,string][]=[['A','A안',optionA],['B','B안',optionB]];
 return <section className="choice-card notice flex-col items-stretch gap-3" aria-labelledby={id} data-testid="choice-card">
  <div><h5 id={id} className="m-0 text-[14px] font-semibold text-foreground">남은 이견 선택</h5><p className="m-0 text-[13px]">{waiting?'선택하면 다음 단계가 시작됩니다.':'선택은 다음 단계와 후속 회의 입력에 전달됩니다.'}</p></div>
  <div role="group" aria-label="이견 선택지" className="grid gap-2">
   {options.map(([value,label,text])=><div key={value} className="rounded-md border border-border bg-background p-3"><div className="flex items-center justify-between gap-2"><b className="text-sm">{label}{value==='A'?' 채택한 방향':' 남은 이견'}</b><Button type="button" size="sm" variant={picked===value?'default':'outline'} aria-pressed={picked===value} className="min-h-11" disabled={busy||disabled} onClick={()=>setPicked(value)}>{label} 고르기</Button></div><p className="m-0 mt-1 whitespace-pre-wrap text-[13px] leading-6">{text}</p></div>)}
   <Button type="button" variant={picked==='hold'?'default':'outline'} aria-pressed={picked==='hold'} className="min-h-11 justify-start" disabled={busy||disabled} onClick={()=>setPicked('hold')}>둘 다 보류</Button>
  </div>
  <div className="flex flex-wrap items-center gap-2">
   <Button type="button" className="min-h-11" disabled={busy||disabled||!picked} disabledReason={disabledReason??(!picked?'먼저 A안, B안, 둘 다 보류 중 하나를 고르세요.':undefined)} onClick={()=>{if(picked)void onChoose(picked)}}>{busy?<LoaderCircle className="spin"/>:<Check/>}선택 저장</Button>
   {current&&<small className="text-[13px] text-muted-foreground" role="status"><MetaLine items={['현재 선택 '+choiceLabels[current.choice],when(current.createdAt)]}/></small>}
  </div>
 </section>;
}
