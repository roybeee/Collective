'use client';
// 규정 수정 제안 목록(스위치 compliance_fixes가 켜졌을 때만 규정 점검 패널이 내려받는 lazy 청크). 걸린 규칙마다 제안(어절 비교·근거·확인 필요)을 보이고,
// 제안이 없는 규칙은 '직접 고쳐야 합니다'로 둔다. 고른 제안은 확인 카드(무엇·어디·되돌림)를 거쳐 POST /api/action apply_compliance_fixes로 보낸다.
// 서버가 저장 본문으로 제안을 다시 계산하고 새 버전을 저장한 뒤 다시 점검한 결과를 돌려준다. 이 부품은 글을 직접 바꾸지 않는다.
import '@/lib/i18n/lazy-trust';
import {useState} from 'react';
import {toast} from 'sonner';
import {Button} from '@/components/ui/button';
import {Checkbox} from '@/components/ui/checkbox';
import {VersionDiff} from './version-diff';
import {askConfirm} from './confirm-dialog';
import {MetaLine} from './meta-line';
import {useT} from '@/lib/i18n-react';
import {useAccessCheck} from '@/app/account-context';
import {applyComplianceFixes,type AppliedFixes} from '@/lib/artifact-sources-client';
import {notifySaved,type Saved} from '@/lib/ui/notify';
import type {ComplianceFixView,ComplianceView} from '@/lib/artifact-sources';

type Props={artifactId:string;compliance:ComplianceView;canManage:boolean;onApplied:(result:AppliedFixes)=>void};
// 같은 자리를 건드리는 제안 쌍(서버와 같은 판정은 서버가 400으로 다시 막는다). 화면은 고른 제안의 미리보기 줄이 같은지로만 미리 알린다.
const sameLine=(a:ComplianceFixView,b:ComplianceFixView)=>a.kind==='remove'&&b.kind!=='remove'&&a.preview.before.includes(b.preview.before)||b.kind==='remove'&&a.kind!=='remove'&&b.preview.before.includes(a.preview.before);

export default function ComplianceFixes({artifactId,compliance,canManage,onApplied}:Props){
 const t=useT(),access=useAccessCheck(),fixes=compliance.fixes!;
 const [picked,setPicked]=useState<readonly string[]>([]),[busy,setBusy]=useState(false);
 const canApply=canManage||access.scoped&&access.check('edit_campaign',fixes.scope);
 const chosen=fixes.items.filter(f=>picked.includes(f.id));
 const overlap=chosen.some((a,i)=>chosen.slice(i+1).some(b=>sameLine(a,b)));
 const toggle=(id:string,on:boolean)=>setPicked(list=>on?[...list.filter(x=>x!==id),id]:list.filter(x=>x!==id));
 const titleOf=(ruleId:string)=>compliance.issues.find(i=>i.ruleId===ruleId)?.title??ruleId;
 async function apply(){
  const n=chosen.length,rules=[...new Set(chosen.map(f=>titleOf(f.ruleId)))].join(', ');
  const ok=await askConfirm({title:t('fixes.confirmTitle',{n}),fields:{what:t('fixes.what',{n,rules}),where:t('fixes.where',{from:fixes.version,to:fixes.version+1}),reversible:t('fixes.reversible')},
   impact:t('fixes.impact'),undo:t('fixes.undo'),confirmLabel:t('fixes.confirm')});
  if(!ok)return;
  setBusy(true);
  try{
   const result=await applyComplianceFixes(artifactId,fixes.version,chosen.map(f=>f.id));
   setPicked([]);onApplied(result);
   notifySaved(t('fixes.done',{n:result.applied,version:result.version}) as Saved);
  }catch(e){toast.error((e as Error).message)}finally{setBusy(false)}
 }
 const reason=!canApply?t('fixes.denied'):!chosen.length?t('fixes.pickFirst'):overlap?t('fixes.overlap'):undefined;
 return <section className="compliance-fixes" aria-label={t('fixes.heading')}>
  <h5>{t('fixes.heading')}</h5>
  <p className="subtle-note">{t('fixes.lead')}</p>
  <ul className="compliance-fixes">{compliance.issues.map(issue=>{
   const items=fixes.items.filter(f=>f.ruleId===issue.ruleId);
   return <li key={issue.ruleId} data-rule={issue.ruleId}>
    <MetaLine items={[<b key="t">{issue.title}</b>,items.length?t('fixes.selected',{n:items.filter(f=>picked.includes(f.id)).length}):null]}/>
    {!items.length&&<p className="subtle-note">{t('fixes.manual')}</p>}
    {items.map(f=><div key={f.id} className="compliance-fix" data-fix={f.id}>
     <label className="fix-pick"><Checkbox checked={picked.includes(f.id)} disabled={busy||!canApply} onCheckedChange={v=>toggle(f.id,v===true)} aria-label={t('fixes.pick',{rule:issue.title})}/>
      <MetaLine items={[t(`fixes.kind.${f.kind}`),f.needsCheck?t('fixes.needsCheck'):null]}/></label>
     <VersionDiff compact before={f.preview.before} after={f.preview.after} beforeLabel={issue.excerpt} afterLabel={t(`fixes.kind.${f.kind}`)}/>
     <p className="fix-rationale">{f.rationale}</p>
    </div>)}
   </li>})}</ul>
  <div className="fix-actions">
   <Button type="button" size="sm" disabled={busy||!!reason} disabledReason={reason} onClick={()=>void apply()}>{busy?t('fixes.applying'):t('fixes.apply')}</Button>
   <p className="subtle-note">{fixes.notice}</p>
  </div>
 </section>;
}
