'use client';
// 결정 인박스 행(GLOBAL-PLAN X1, app/agenda-panel.tsx가 그린다). 무엇·어디(캠페인·브랜드·지점·계정)·기한·비용을 한 행에, 행 안 동작(승인·수정 요청·미루기·열기)은 버튼으로 둔다.
// 급함은 색이 아니라 종류 글자('기한 초과')로 읽힌다. 좁은 화면에서는 버튼이 본문 아래로 내려와 엄지 범위에 온다(globals.css .agenda-list>li flex-wrap). 버튼 높이는 44px 이상이다.
// Tab 정지는 행마다 본문 버튼(과 바로 처리 버튼)만이다. 선택·승인·수정 요청·미루기는 tabIndex -1로 두고 본문 버튼에서 ←/→로 옮긴다(WAI-ARIA toolbar 패턴, A/R/H 자판도 같다).
// 그래야 행이 늘어도 다음 행까지 Tab 수가 늘지 않는다(e2e/ux-keyboard-tasks 과업 1·3). 보조 동작 이름은 '승인'·'수정 요청'·'미루기' 하나씩이고 제목은 aria-describedby로 읽힌다(본문 버튼과 이름이 겹치지 않는다).
import {forwardRef,useId,useState} from 'react';
import {ArrowRight} from 'lucide-react';
import {CardButton} from './card-button';
import {CheckInput} from './check';
import {MetaLine} from './meta-line';
import {Button} from '@/components/ui/button';
import {Textarea} from '@/components/ui/textarea';
import {date,dateTime} from '@/lib/format';
import type {AgendaItem,AgendaKind} from '@/lib/agenda-types';
import {approvable,moveIndex} from '@/lib/agenda-client';
import {localMoney,type MessageKey} from '@/lib/i18n';
import {useT} from '@/lib/i18n-react';
// 종류 이름은 화면 언어(lib/i18n.ts)를 따른다. 키 순서가 안건 요약 순서다.
export const kindLabels:Record<AgendaKind,MessageKey>={overdue:'inbox.kind.overdue',decision:'inbox.kind.decision',question:'inbox.kind.question',signal:'inbox.kind.signal',upcoming:'inbox.kind.upcoming'};
const dueText=(due:string|null)=>!due?'':/^\d{4}-\d{2}-\d{2}$/.test(due)?date(due):dateTime(due);
export type InboxRowProps={item:AgendaItem;canAct:boolean;busy:boolean;selected:boolean;changesOpen:boolean;disabledReason?:string;
 onOpen:(item:AgendaItem)=>void;onApprove:(item:AgendaItem)=>void;onToggleChanges:(item:AgendaItem,open:boolean)=>void;onRequestChanges:(item:AgendaItem,message:string)=>void;onSnooze:(item:AgendaItem)=>void;onSelect:(item:AgendaItem,selected:boolean)=>void;
 quick?:React.ReactNode};
// 행 안 ←/→: data-row-control을 단 조작(선택·본문·바로 처리·승인·수정 요청·미루기) 사이를 옮긴다. 입력 칸 안이나 수정 요청 폼의 버튼에서는 건드리지 않는다.
function onRowKey(e:React.KeyboardEvent<HTMLLIElement>){
 if(e.key!=='ArrowRight'&&e.key!=='ArrowLeft')return;
 const target=e.target as HTMLElement;if(!target.hasAttribute('data-row-control'))return;
 const controls=[...e.currentTarget.querySelectorAll<HTMLElement>('[data-row-control]')].filter(el=>!(el as HTMLButtonElement).disabled),index=controls.indexOf(target);
 if(index<0)return;e.preventDefault();controls[moveIndex(index,e.key==='ArrowRight'?1:-1,controls.length)]?.focus();
}
// ref는 행의 본문 버튼(J/K 이동 때 초점을 둔다).
export const InboxRow=forwardRef<HTMLButtonElement,InboxRowProps>(function InboxRow({item,canAct,busy,selected,changesOpen,disabledReason,onOpen,onApprove,onToggleChanges,onRequestChanges,onSnooze,onSelect,quick},ref){
 const t=useT(),[message,setMessage]=useState(''),textId=useId(),titleId=useId(),canApprove=approvable(item),canChanges=item.action?.type==='review_artifact',reason=!canAct?disabledReason:undefined;
 return <li data-kind={item.kind} data-inbox-row={item.id} data-selected={selected||undefined} onKeyDown={onRowKey}>
  {canApprove&&<label className="agenda-select self-center px-1"><CheckInput data-row-control tabIndex={-1} checked={selected} disabled={busy||!canAct} aria-label={t('inbox.select',{title:item.title})} onChange={e=>onSelect(item,e.target.checked)}/></label>}
  <CardButton ref={ref} type="button" className="agenda-row-main" data-row-control data-prefetch="detail growth" onClick={()=>onOpen(item)}><span className="agenda-kind">{t(kindLabels[item.kind])}</span><span className="agenda-main"><b id={titleId}>{item.title}</b><small><MetaLine items={[item.campaignTitle,...(item.where??[]),item.detail]}/></small></span>{(item.due||!!item.cost)&&<span className="agenda-due"><MetaLine items={[item.due&&dueText(item.due),!!item.cost&&t('inbox.cost',{amount:localMoney(item.cost)})]}/></span>}<ArrowRight size={16} aria-hidden="true"/></CardButton>
  {quick}
  {canApprove&&<Button type="button" data-row-control tabIndex={-1} size="fit" className="agenda-quick min-h-11" disabled={busy||!canAct} disabledReason={reason} aria-describedby={titleId} onClick={()=>onApprove(item)}>{t('inbox.approve')}</Button>}
  {canChanges&&<Button type="button" data-row-control tabIndex={-1} variant="outline" size="fit" className="agenda-quick min-h-11" disabled={busy||!canAct} disabledReason={reason} aria-expanded={changesOpen} aria-controls={textId} aria-describedby={titleId} onClick={()=>onToggleChanges(item,!changesOpen)}>{t('inbox.requestChanges')}</Button>}
  <Button type="button" data-row-control tabIndex={-1} variant="outline" size="fit" className="agenda-quick min-h-11" disabled={busy} aria-describedby={titleId} onClick={()=>onSnooze(item)}>{t('inbox.snooze')}</Button>
  {canChanges&&changesOpen&&<div className="basis-full grid gap-2 pt-1"><label className="grid gap-1 text-sm" htmlFor={textId}>{t('inbox.changesField')}<Textarea id={textId} rows={3} value={message} disabled={busy} placeholder={t('confirm.changesPlaceholder')} autoFocus onChange={e=>setMessage(e.target.value)}/></label>
   <div className="flex flex-wrap gap-2"><Button type="button" size="fit" className="min-h-11" disabled={busy||!message.trim()} disabledReason={!message.trim()?t('inbox.writeFirst'):undefined} onClick={()=>onRequestChanges(item,message.trim())}>{t('inbox.send')}</Button><Button type="button" variant="outline" size="fit" className="min-h-11" disabled={busy} onClick={()=>onToggleChanges(item,false)}>{t('inbox.close')}</Button></div></div>}
 </li>;
});
