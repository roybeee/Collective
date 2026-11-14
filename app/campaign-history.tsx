'use client';
import {t} from '@/lib/i18n';
import {useT} from '@/lib/i18n-react';
import '@/lib/i18n/lazy';
import {EmptyLine} from '@/components/app/empty-line';
import {useState} from 'react';
import {NativeSelect,NativeSelectOptGroup,NativeSelectOption} from '@/components/ui/native-select';
import {VersionDiff} from '@/components/app/version-diff';
import {askConfirm} from '@/components/app/confirm-dialog';
import type {Artifact} from '@/lib/agency';
import type {ArtifactVersion,CampaignDetail} from '@/lib/campaign-detail';
import {artifactPreview,defaultComparison,versionGroups} from '@/lib/history-labels';
import {notifySaved,type Saved} from '@/lib/ui/notify';
// 선택 상자 글자는 짧은 형식(label), 상자 아래에는 고른 버전을 한 문장(sentence)으로 보인다.
// X8: 두 버전을 어절 단위로 비교한다(components/app/version-diff.tsx). 부분 수락·되돌리기는 기존 작업물 저장(save_artifact)으로 현재 작업물의 새 버전을 만들고 이력은 바꾸지 않는다.
// 저장 뒤 이 탭은 캠페인 상세를 다시 읽어 새 버전을 보인다(부모 새로고침을 기다리지 않는다). 부모가 새 목록을 넘기면 그 목록이 이긴다.

type Versions={artifacts:Artifact[];history:ArtifactVersion[]};
async function saveVersion(target:Artifact,content:string){
 const response=await fetch('/api/action',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'save_artifact',id:target.id,version:target.version,campaignId:target.campaignId,role:target.role,title:target.title,content})});
 const result=await response.json().catch(()=>({})) as {error?:string};
 if(!response.ok)throw new Error(result.error||t('history.saveFailed'));
}
async function readVersions(campaignId:string):Promise<Versions>{
 const response=await fetch('/api/campaigns/'+encodeURIComponent(campaignId));
 const result=await response.json().catch(()=>({})) as Partial<CampaignDetail>&{error?:string};
 if(!response.ok||!result.artifacts)throw new Error(result.error||t('history.loadFailed'));
 return {artifacts:result.artifacts,history:result.history||[]};
}
// 되돌리기·부분 수락을 저장할 현재 작업물: 고른 이전 버전의 원래 작업물, 없으면 같은 담당의 현재 작업물.
function targetOf(artifacts:Artifact[],version:ArtifactVersion|undefined){
 if(!version)return undefined;
 const live=artifacts.filter(a=>a.status!=='outdated');
 return live.find(a=>a.id===(version.originalId||version.id))||live.find(a=>a.role===version.role);
}

export function CampaignHistory({artifacts:givenArtifacts,history:givenHistory}:{artifacts:Artifact[];history:ArtifactVersion[]}){useT();
 const [fresh,setFresh]=useState<{base:Artifact[];data:Versions}|null>(null);
 const {artifacts,history}=fresh&&fresh.base===givenArtifacts?fresh.data:{artifacts:givenArtifacts,history:givenHistory};
 const versions=[...artifacts,...history],groups=versionGroups(artifacts,history),options=groups.flatMap(g=>g.options),initial=defaultComparison(groups);
 const [leftId,setLeftId]=useState(''),[rightId,setRightId]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const left=versions.find(a=>a.id===leftId)||versions.find(a=>a.id===initial.left);
 const right=versions.find(a=>a.id===rightId)||versions.find(a=>a.id===initial.right);
 if(!versions.length)return <EmptyLine className="subtle-note" next={t('history.emptyNext')}>{t('history.empty')}</EmptyLine>;
 const target=targetOf(artifacts,left),sentence=(v:ArtifactVersion|undefined)=>options.find(o=>o.id===v?.id)?.sentence||'';
 const noTarget=!target?t('history.noTarget'):undefined;
 const blocked=noTarget||(left&&target&&left.id===target.id&&left.version===target.version?t('history.alreadyCurrent'):undefined);
 async function save(content:string,what:'revert'|'merge'){
  if(!target||(what==='revert'&&blocked))return;
  const ok=await askConfirm({title:what==='revert'?t('history.revertTitle'):t('history.mergeTitle'),body:sentence(left),
   impact:t('history.saveImpact',{next:target.version+1}),
   undo:t('history.saveUndo',{version:target.version}),confirmLabel:what==='revert'?t('history.revertConfirm'):t('history.saveConfirm')});
  if(!ok)return;
  setBusy(true);setError('');
  try{await saveVersion(target,content);const data=await readVersions(target.campaignId);setFresh({base:givenArtifacts,data});setLeftId('');setRightId('');notifySaved((what==='revert'?t('history.reverted'):t('history.merged')) as Saved,{description:t('history.keptNote')})}
  catch(e){setError((e as Error).message)}finally{setBusy(false)}
 }
 return <section className="form-stack"><h3>{t('history.title')}</h3><p className="subtle-note">{t('history.lead')}</p><div className="form-two">
  {([{label:t('history.before'),selected:left,set:setLeftId},{label:t('history.after'),selected:right,set:setRightId}]).map(({label,selected,set})=><div key={label}><label className="field"><span>{label}</span><NativeSelect aria-label={label} value={selected?.id||''} onChange={e=>set(e.target.value)}>{groups.map(g=><NativeSelectOptGroup key={g.role} label={g.label}>{g.options.map(o=><NativeSelectOption key={o.id} value={o.id} title={artifactPreview(versions.find(a=>a.id===o.id)?.content||'')}>{o.label}</NativeSelectOption>)}</NativeSelectOptGroup>)}</NativeSelect></label><p className="history-version-sentence">{sentence(selected)}</p></div>)}
 </div>
 {left&&right&&<VersionDiff key={left.id+':'+right.id} before={left.content} after={right.content} beforeLabel={t('history.beforeV')+left.version} afterLabel={t('history.afterV')+right.version} busy={busy}
  onApply={merged=>save(merged,'merge')} applyLabel={t('history.apply')} applyDisabledReason={noTarget} onRevert={()=>save(left.content,'revert')} revertLabel={t('history.revert')} revertDisabledReason={blocked}/>}
 {error&&<p role="alert" className="form-error">{error}</p>}
 </section>;
}
