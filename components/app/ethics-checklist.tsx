'use client';
// 사람 확인 체크리스트(스위치 ethics_review_checklist가 켜져 보기에 checklist가 있을 때만 규정 점검 패널이 내려받는 lazy 청크, lib/ethics-checklist.ts).
// 항목마다 질문·근거(법령 조문 링크·미확인·운영 기준)·추가된 이유·마지막 표시를 보이고, 승인 권한자가 확인·보류·해당 없음과 메모를 기록한다(POST /api/action mark_ethics_check).
// 기록은 추가 전용이고 승인 버튼과 연결하지 않는다(표시와 기록만).
import '@/lib/i18n/lazy-trust';
import {useId,useState} from 'react';
import {toast} from 'sonner';
import {Button} from '@/components/ui/button';
import {RadioGroup,RadioGroupItem} from '@/components/ui/radio-group';
import {Textarea} from '@/components/ui/textarea';
import {MetaLine} from './meta-line';
import {useT} from '@/lib/i18n-react';
import {kstText} from '@/lib/format';
import {useAccessCheck} from '@/app/account-context';
import {markEthicsCheck} from '@/lib/artifact-sources-client';
import {notifySaved,type Saved} from '@/lib/ui/notify';
import type {MessageKey} from '@/lib/i18n';
import type {EthicsChecklistItemView,EthicsChecklistView,EthicsMarkView} from '@/lib/artifact-sources';

type Status=EthicsMarkView['status'];
const STATUSES:readonly Status[]=['confirmed','held','not_applicable'];
const NOTE_MAX=300;
// 기록 결과는 부모(규정 점검 보기)로 올린다. 대화상자를 다시 열면 부모가 서버에서 다시 읽은 보기를 내려 준다.
type Props={artifactId:string;checklist:EthicsChecklistView;canManage:boolean;onChange:(checklist:EthicsChecklistView)=>void};

function Basis({basis}:{basis:EthicsChecklistItemView['basis']}){
 const t=useT();
 if(basis.kind!=='law')return <>{t(basis.kind==='operating'?'ethics.basis.operating':'ethics.basis.unverified')}</>;
 const text=t('ethics.basis.law',{law:basis.law??'',article:basis.article??''});
 return basis.url?<a className="citation-link" href={basis.url} target="_blank" rel="noopener noreferrer" aria-label={t('ethics.basis.lawLinkLabel',{law:basis.law??''})}>{text}</a>:<>{text}</>;
}

function ItemRow({item,mark,canMark,onRecord}:{item:EthicsChecklistItemView;mark:EthicsMarkView|undefined;canMark:boolean;onRecord:(status:Status,note:string)=>Promise<boolean>}){
 const t=useT(),id=useId(),question=t(`ethics.item.${item.id}` as MessageKey);
 const [status,setStatus]=useState<Status|''>(mark?.status??''),[note,setNote]=useState(''),[busy,setBusy]=useState(false);
 const why=item.triggers.length?item.triggers.map(s=>t(`ethics.trigger.${s}` as MessageKey)).join(', '):t('ethics.trigger.always');
 async function record(){if(!status)return;setBusy(true);try{if(await onRecord(status,note))setNote('')}finally{setBusy(false)}}
 const reason=!canMark?t('ethics.denied'):!status?t('ethics.pickFirst'):undefined;
 return <li className="ethics-item" data-item={item.id} data-status={mark?.status??'none'}>
  <p className="ethics-question" id={`${id}-q`}>{question}</p>
  <MetaLine items={[<Basis key="b" basis={item.basis}/>,why]}/>
  <p className="subtle-note" role="status">{mark?t('ethics.last',{status:t(`ethics.status.${mark.status}`),at:kstText(mark.createdAt,{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'})}):t('ethics.unmarked')}{mark?.note?t('ethics.lastNote',{note:mark.note}):''}</p>
  <RadioGroup className="ethics-choices" aria-labelledby={`${id}-q`} value={status} onValueChange={v=>setStatus(v as Status)} disabled={busy||!canMark}>
   {STATUSES.map(s=><label key={s} className="ethics-choice"><RadioGroupItem value={s} id={`${id}-${s}`}/>{t(`ethics.status.${s}`)}</label>)}
  </RadioGroup>
  <Textarea className="ethics-note" aria-label={t('ethics.noteLabel',{item:question})} placeholder={t('ethics.notePlaceholder')} maxLength={NOTE_MAX} value={note} disabled={busy||!canMark} onChange={e=>setNote(e.target.value)}/>
  <div className="fix-actions"><Button type="button" size="sm" variant="outline" disabled={busy||!!reason} disabledReason={reason} onClick={()=>void record()}>{busy?t('ethics.recording'):t('ethics.record')}</Button></div>
 </li>;
}

export default function EthicsChecklist({artifactId,checklist:view,canManage,onChange}:Props){
 const t=useT(),access=useAccessCheck();
 const canMark=canManage||access.check('approve_artifact',view.scope);
 const markOf=(itemId:string)=>view.marks.find(m=>m.itemId===itemId);
 async function record(itemId:string,status:Status,note:string){
  try{onChange(await markEthicsCheck({artifactId,version:view.artifactVersion,itemId,status,note}));notifySaved(t('ethics.done') as Saved);return true}
  catch(e){toast.error((e as Error).message);return false}
 }
 return <section className="ethics-checklist" aria-label={t('ethics.heading')}>
  <h5>{t('ethics.heading')}</h5>
  <MetaLine items={[t('ethics.count',{done:view.marks.length,total:view.items.length}),t('ethics.held',{n:view.marks.filter(m=>m.status==='held').length})]}/>
  <p className="subtle-note">{t('ethics.lead')}</p>
  <ul className="ethics-items">{view.items.map(item=><ItemRow key={item.id} item={item} mark={markOf(item.id)} canMark={canMark} onRecord={(s,n)=>record(item.id,s,n)}/>)}</ul>
  <p className="subtle-note">{t('ethics.notice')}</p>
 </section>;
}
