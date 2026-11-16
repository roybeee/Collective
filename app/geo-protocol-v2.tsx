'use client';
// AI 검색 노출 관측 프로토콜 v2 화면 부분(스위치 geo_protocol_v2). app/geo-panel.tsx가 v2 조회일 때만 그린다(같은 lazy 청크).
// 묶음×엔진 'N회 중 k회'·판정어(기준값은 운영 기준)·인용 출처 4분류·답변 맥락·변경 기록과 +14·+42일 재관측 예약.
import '@/lib/i18n/lazy-geo';
import {useState} from 'react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {NativeSelect} from '@/components/ui/native-select';
import {Note} from '@/components/app/note';
import {MetaLine} from '@/components/app/meta-line';
import {EmptyLine} from '@/components/app/empty-line';
import {DataTable} from '@/components/app/data-table';
import {useT} from '@/lib/i18n-react';
import {GEO_ENGINE_PAGES,GEO_SOURCE_CLASSES,GEO_CONTEXT_TONES} from '@/lib/geo-observation';
import type {GeoChangeBasis,GeoChangeKind} from '@/lib/geo-change';
import type {GeoVerdictRow} from '@/lib/geo-verdict';
import type {GeoViewV2} from '@/lib/geo-run-server';
import styles from './growth-panel.module.css';

type Send=(body:Record<string,unknown>,done:string,after?:()=>void)=>Promise<void>;
type ChangeForm={kind:GeoChangeKind;summary:string;appliedOn:string;appliedBasis:GeoChangeBasis};
const todayKst=()=>new Date(Date.now()+9*3600000).toISOString().slice(0,10);
const emptyChange=():ChangeForm=>({kind:'entity_basics',summary:'',appliedOn:todayKst(),appliedBasis:'published'});

export function GeoProtocolV2({view,send,saving,canEdit,lockedReason}:{view:GeoViewV2;send:Send;saving:boolean;canEdit:boolean;lockedReason?:string}){
 const t=useT();
 const [form,setForm]=useState<ChangeForm>(emptyChange);
 const r=view.report,rules=r.rules;
 const shown=r.verdicts.filter(v=>v.n>0||v.verdict==='unobserved');
 const verdictText=(v:GeoVerdictRow)=>v.verdict==='defense_failed'&&v.level!=='unobserved'?`${t('geo.verdict.defense_failed')}(${t(`geo.verdict.${v.level}`)})`:t(`geo.verdict.${v.verdict}`);
 const blocked=!canEdit?lockedReason:!form.summary.trim()?t('geo.change.needSummary'):!form.appliedOn?t('geo.change.needDay'):undefined;
 return <div aria-label={t('geo.v2.title')} role="group">
  <h5>{t('geo.v2.title')}</h5>
  <Note className={styles.note}>{t('geo.v2.lead')}</Note>
  <p><small>{t('geo.v2.rule',{dominant:rules.dominant,contested:rules.contested,gap:rules.minGapDays,window:rules.windowDays})}</small></p>
  {'repeats' in view.plan?<p><small>{t('geo.v2.repeats',{n:view.plan.repeats})}</small></p>:null}

  <h5>{t('geo.v2.verdicts')}</h5>
  {shown.length?<DataTable rows={shown} rowKey={v=>v.group+':'+v.engine} caption={t('geo.v2.verdicts')} columns={[
   {label:t('geo.col.group'),cell:v=>t(`geo.group.${v.group}`),sort:v=>v.group},
   {label:t('geo.col.engine'),cell:v=>GEO_ENGINE_PAGES[v.engine].label,sort:v=>v.engine},
   {label:t('geo.col.count'),cell:v=>v.count,sort:v=>v.n},
   {label:t('geo.col.points'),cell:v=>t('geo.v2.points',{n:v.timePoints,days:v.spanDays})},
   {label:t('geo.col.verdict'),cell:v=><MetaLine items={[verdictText(v),v.rule]}/>,sort:v=>v.verdict},
   {label:t('geo.col.previous'),cell:v=>v.previous?t(`geo.verdict.${v.previous}`):t('geo.v2.none')},
  ]}/>:<EmptyLine next={t('geo.v2.lead')}>{t('geo.v2.noVerdicts')}</EmptyLine>}
  <p><MetaLine label={t('geo.v2.citations')} items={GEO_SOURCE_CLASSES.map(c=>`${t(`geo.source.${c}`)} ${r.citationMix[c]}`)}/></p>
  <p><MetaLine label={t('geo.v2.contexts')} items={GEO_CONTEXT_TONES.map(c=>`${t(`geo.tone.${c}`)} ${r.contextMix[c]}`)}/></p>

  <h5>{t('geo.change.title')}</h5>
  <small>{t('geo.change.lead')}</small>
  {view.rechecksDue.length>0&&<p role="status">{t('geo.change.due',{items:view.rechecksDue.map(d=>t('geo.change.dueItem',{offset:d.offset,day:d.dueOn})).join(', ')})}</p>}
  {view.changes.length?<ul>{view.changes.map(c=><li key={c.id}><MetaLine items={[c.appliedOn,t(`geo.kind.${c.kind}`),c.summary,...c.rechecks.map(x=>t('geo.change.recheck',{offset:x.offset,day:x.dueOn,status:t(`geo.recheck.${x.status}`)}))]}/></li>)}</ul>:<EmptyLine next={t('geo.change.lead')}>{t('geo.change.empty')}</EmptyLine>}
  <form onSubmit={e=>{e.preventDefault();void send({action:'save_change',input:{...form,questionIds:[]}},t('geo.change.saved'),()=>setForm(emptyChange()))}}><fieldset disabled={saving} className={styles.form}><legend>{t('geo.change.save')}</legend>
   <label>{t('geo.change.kind')}<NativeSelect value={form.kind} onChange={e=>setForm({...form,kind:e.target.value as GeoChangeKind})}>{view.changeKinds.map(k=><option key={k} value={k}>{t(`geo.kind.${k}`)}</option>)}</NativeSelect></label>
   <label className={styles.wide}>{t('geo.change.summary')}<Input maxLength={200} value={form.summary} onChange={e=>setForm({...form,summary:e.target.value})}/></label>
   <label>{t('geo.change.appliedOn')}<Input type="date" max={todayKst()} value={form.appliedOn} onChange={e=>setForm({...form,appliedOn:e.target.value})}/></label>
   <label>{t('geo.change.basis')}<NativeSelect value={form.appliedBasis} onChange={e=>setForm({...form,appliedBasis:e.target.value as GeoChangeBasis})}>{view.changeBases.map(b=><option key={b} value={b}>{t(`geo.basis.${b}`)}</option>)}</NativeSelect></label>
   <Button variant="panel" size="fit" type="submit" disabled={!!blocked} disabledReason={blocked}>{t('geo.change.save')}</Button>
  </fieldset></form>
 </div>;
}
