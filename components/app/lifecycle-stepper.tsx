'use client';
// 작업물 상태 머신 단계 표시(벤치마크 P5). 초안(AI 작성) → 검토 중 → 수정 요청 ↔ 검토 중 → 승인 → 발행 예약 → 발행됨을 한 줄로 보인다.
// 단계 판정은 lib/artifact-lifecycle.ts(읽기 전용). 색만으로 구분하지 않도록 아이콘과 글자(현재 단계는 굵게, aria-current="step")를 함께 쓴다.
import '@/lib/i18n/lazy-campaign';
import {Check,Circle,CircleDot,Minus} from 'lucide-react';
import {useT} from '@/lib/i18n-react';
import {cn} from '@/lib/utils';
import {artifactLifecycle,type LifecycleState,type PublicationMark} from '@/lib/artifact-lifecycle';

const icons:Record<LifecycleState,typeof Check>={done:Check,current:CircleDot,todo:Circle,skipped:Minus};
export function LifecycleStepper({status,origin,publication=null,compact=false,className}:{status:string;origin?:string;publication?:PublicationMark;compact?:boolean;className?:string}){
 const t=useT(),{stages}=artifactLifecycle(status,publication);
 const label=(id:string)=>id==='draft'&&origin==='manual'?t('lifecycle.draftManual'):t(('lifecycle.'+id) as 'lifecycle.draft');
 return <ol aria-label={t('lifecycle.label')} data-testid="lifecycle-stepper" className={cn('m-0 flex list-none flex-wrap items-center gap-x-1.5 gap-y-1 p-0 text-muted-foreground',compact?'text-[12px]':'text-[13px]',className)}>
  {stages.map((s,i)=>{const Icon=icons[s.state];return <li key={s.id} data-stage={s.id} data-state={s.state} aria-current={s.state==='current'?'step':undefined} className={cn('inline-flex items-center gap-1',s.state==='current'&&'font-semibold text-foreground',s.state==='skipped'&&'opacity-70')}>
   {i>0&&<span aria-hidden className="text-muted-foreground">{s.id==='review'||s.id==='approved'?'→':s.id==='revision'?'↔':'→'}</span>}
   <Icon size={compact?12:14} aria-hidden/><span>{label(s.id)}</span><span className="sr-only">{t(('lifecycle.state.'+s.state) as 'lifecycle.state.done')}</span>
  </li>})}
 </ol>;
}
