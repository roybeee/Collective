'use client';
// 팀 회의 뷰(벤치마크 P2) 부품: 참석자 열(에이전트 배지 + 상태 점 + 글자 상태)과 '결정' 카드 묶음(합의의 모든 결정·남은 이견·확인할 사실·담당 배정).
// 상태는 색 점만으로 구분하지 않고 글자(statusView 라벨)를 함께 쓴다. 사용자의 A/B 선택은 결정 카드와 뒤 단계 발언에 '사용자가 A안을 골랐습니다'로 보인다.
import '@/lib/i18n/lazy';
import {Check} from 'lucide-react';
import {useT} from '@/lib/i18n-react';
import {cn} from '@/lib/utils';
import {cssVars} from '@/lib/ui/css-vars';
import {statusView,type TimelineTone} from '@/lib/run-timeline';
import {hasDisagreement,type MeetingChoice,type PublicMeeting,type Synthesis} from '@/lib/meetings';
import {decisionItems} from '@/lib/meeting-decisions';

type Step=PublicMeeting['steps'][number];
type Role={id:string;name:string;initial:string;color:string};
const dots:Record<TimelineTone,string>={idle:'bg-muted-foreground',live:'bg-foreground',wait:'bg-(--yellow-35)',done:'bg-(--olive-42)',fail:'bg-destructive',stop:'bg-muted-foreground',unknown:'bg-muted-foreground',note:'bg-foreground'};
// 참석자 한 명의 상태: 지금 진행 중인 단계의 담당이면 그 단계 상태, 아니면 그 담당의 마지막 단계(대기 제외) 상태, 없으면 대기.
export function participantStatus(role:string,steps:readonly Step[],live:boolean){
 const current=steps.find(s=>s.status!=='completed');
 if(live&&current?.role===role&&current.status!=='pending')return {step:current,view:statusView(current.status,current.phase),speaking:true};
 const mine=steps.filter(s=>s.role===role&&s.status!=='pending'),last=mine.at(-1);
 return last?{step:last,view:statusView(last.status,last.phase),speaking:false}:{step:undefined,view:statusView('pending'),speaking:false};
}
export function MeetingParticipants({roles,steps,live,phaseName}:{roles:readonly Role[];steps:readonly Step[];live:boolean;phaseName:(s:Step)=>string}){
 const t=useT();
 return <section aria-label={t('meetingBoard.participants')} className="grid gap-2" data-testid="meeting-participants">
  <h4 className="m-0 text-[14px] font-semibold">{t('meetingBoard.participants')}</h4>
  <ul className="m-0 grid list-none grid-cols-2 gap-2 p-0 sm:grid-cols-4 xl:grid-cols-1">
   {roles.map(r=>{const p=participantStatus(r.id,steps,live);return <li key={r.id} data-role={r.id} data-tone={p.view.tone} className={cn('flex min-h-11 items-center gap-2 rounded-md border border-border bg-background px-2 py-1.5',p.speaking&&'ring-1 ring-(--olive-57)')}>
    <span className="role-avatar tint size-7 shrink-0 text-[12px]" ref={cssVars({'--tint':r.color})}>{p.view.tone==='done'?<Check size={14}/>:r.initial}</span>
    <div className="min-w-0 text-[13px] leading-5"><b className="block truncate">{r.name}</b><span className="inline-flex items-center gap-1 text-muted-foreground"><span aria-hidden className={cn('inline-block size-2 shrink-0 rounded-full',dots[p.view.tone])}/>{p.speaking?t('meetingBoard.speaking',{phase:p.step?phaseName(p.step):''}):p.view.label}</span></div>
    <span className="sr-only">{t('meetingBoard.agent')}</span>
   </li>})}
  </ul>
 </section>;
}
// 선택 결과 문장. hold는 두 안 보류다.
export function choiceSentence(t:ReturnType<typeof useT>,choice:MeetingChoice){return choice.choice==='A'?t('meetingBoard.choseA'):choice.choice==='B'?t('meetingBoard.choseB'):t('meetingBoard.choseHold')}
export function DecisionCards({synthesis,choice,roleName}:{synthesis?:Synthesis;choice?:MeetingChoice;roleName:(id:string)=>string}){
 const t=useT();
 if(!synthesis)return <section aria-label={t('meetingBoard.decisions')} className="grid gap-2" data-testid="decision-cards"><h4 className="m-0 text-[14px] font-semibold">{t('meetingBoard.decisions')}</h4><p className="subtle-note m-0">{t('meetingBoard.waiting')}</p></section>;
 const items=decisionItems(synthesis.decisions),disagree=hasDisagreement(synthesis),questions=synthesis.questions?.trim();
 const card='grid gap-1 rounded-md border border-border bg-background p-3 text-[13px] leading-6';
 return <section aria-label={t('meetingBoard.decisions')} className="grid gap-2" data-testid="decision-cards">
  <h4 className="m-0 text-[14px] font-semibold">{t('meetingBoard.decisions')}</h4>
  {items.map((text,i)=><article key={i} className={card} data-kind="decision"><b>{t('meetingBoard.decision',{n:i+1})}</b><p className="m-0 whitespace-pre-wrap">{text}</p><small className="text-muted-foreground">{choice?.choice==='B'?t('meetingBoard.decisionOverridden'):t('meetingBoard.decisionAdopted')}</small></article>)}
  {disagree&&<article className={cn(card,!choice&&'border-(--yellow-35)')} data-kind="disagreement"><b>{t('meetingBoard.disagreement')}</b><p className="m-0 whitespace-pre-wrap">{synthesis.disagreements}</p><small role="status" className={choice?'text-foreground':'text-muted-foreground'}>{choice?choiceSentence(t,choice):t('meetingBoard.needsChoice')}</small></article>}
  {questions&&<article className={card} data-kind="questions"><b>{t('meetingBoard.questions')}</b><p className="m-0 whitespace-pre-wrap">{questions}</p></article>}
  {synthesis.tasks.map(task=><article key={task.role} className={card} data-kind="task"><b>{t('meetingBoard.task',{role:roleName(task.role)})}</b><p className="m-0">{task.instruction}</p><small className="text-muted-foreground">{t('meetingBoard.acceptance',{text:task.acceptance})}</small></article>)}
 </section>;
}
