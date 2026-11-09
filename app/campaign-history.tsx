'use client';
import {EmptyLine} from '@/components/app/empty-line';
import {useState} from 'react';
import {NativeSelect,NativeSelectOptGroup,NativeSelectOption} from '@/components/ui/native-select';
import {VersionDiff} from '@/components/app/version-diff';
import {askConfirm} from '@/components/app/confirm-dialog';
import type {Artifact} from '@/lib/agency';
import type {ArtifactVersion,CampaignDetail} from '@/lib/campaign-detail';
import {artifactPreview,defaultComparison,versionGroups} from '@/lib/history-labels';
import {notifySaved} from '@/lib/ui/notify';
// 선택 상자 글자는 짧은 형식(label), 상자 아래에는 고른 버전을 한 문장(sentence)으로 보인다.
// X8: 두 버전을 어절 단위로 비교한다(components/app/version-diff.tsx). 부분 수락·되돌리기는 기존 작업물 저장(save_artifact)으로 현재 작업물의 새 버전을 만들고 이력은 바꾸지 않는다.
// 저장 뒤 이 탭은 캠페인 상세를 다시 읽어 새 버전을 보인다(부모 새로고침을 기다리지 않는다). 부모가 새 목록을 넘기면 그 목록이 이긴다.

type Versions={artifacts:Artifact[];history:ArtifactVersion[]};
async function saveVersion(target:Artifact,content:string){
 const response=await fetch('/api/action',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'save_artifact',id:target.id,version:target.version,campaignId:target.campaignId,role:target.role,title:target.title,content})});
 const result=await response.json().catch(()=>({})) as {error?:string};
 if(!response.ok)throw new Error(result.error||'새 버전을 저장하지 못했습니다.');
}
async function readVersions(campaignId:string):Promise<Versions>{
 const response=await fetch('/api/campaigns/'+encodeURIComponent(campaignId));
 const result=await response.json().catch(()=>({})) as Partial<CampaignDetail>&{error?:string};
 if(!response.ok||!result.artifacts)throw new Error(result.error||'새 버전 목록을 불러오지 못했습니다.');
 return {artifacts:result.artifacts,history:result.history||[]};
}
// 되돌리기·부분 수락을 저장할 현재 작업물: 고른 이전 버전의 원래 작업물, 없으면 같은 담당의 현재 작업물.
function targetOf(artifacts:Artifact[],version:ArtifactVersion|undefined){
 if(!version)return undefined;
 const live=artifacts.filter(a=>a.status!=='outdated');
 return live.find(a=>a.id===(version.originalId||version.id))||live.find(a=>a.role===version.role);
}

export function CampaignHistory({artifacts:givenArtifacts,history:givenHistory}:{artifacts:Artifact[];history:ArtifactVersion[]}){
 const [fresh,setFresh]=useState<{base:Artifact[];data:Versions}|null>(null);
 const {artifacts,history}=fresh&&fresh.base===givenArtifacts?fresh.data:{artifacts:givenArtifacts,history:givenHistory};
 const versions=[...artifacts,...history],groups=versionGroups(artifacts,history),options=groups.flatMap(g=>g.options),initial=defaultComparison(groups);
 const [leftId,setLeftId]=useState(''),[rightId,setRightId]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const left=versions.find(a=>a.id===leftId)||versions.find(a=>a.id===initial.left);
 const right=versions.find(a=>a.id===rightId)||versions.find(a=>a.id===initial.right);
 if(!versions.length)return <EmptyLine className="subtle-note" next="AI 팀이 작업물을 쓰면 버전이 쌓입니다.">아직 저장된 작업물 버전이 없습니다.</EmptyLine>;
 const target=targetOf(artifacts,left),sentence=(v:ArtifactVersion|undefined)=>options.find(o=>o.id===v?.id)?.sentence||'';
 const noTarget=!target?'이 담당의 현재 작업물이 없어 새 버전으로 저장할 수 없습니다.':undefined;
 const blocked=noTarget||(left&&target&&left.id===target.id&&left.version===target.version?'고른 이전 버전이 이미 현재 버전입니다.':undefined);
 async function save(content:string,what:'revert'|'merge'){
  if(!target||(what==='revert'&&blocked))return;
  const ok=await askConfirm({title:what==='revert'?'이 버전으로 되돌릴까요?':'고른 부분을 넣어 새 버전으로 저장할까요?',body:sentence(left),
   impact:`현재 작업물의 새 버전 v${target.version+1}로 저장하고 검토 대기로 돌립니다. 같은 담당 이후 단계의 작업물은 이전 버전으로 표시됩니다.`,
   undo:`지금 버전 v${target.version}은 이력에 그대로 남습니다. 이력에서 다시 골라 되돌릴 수 있습니다.`,confirmLabel:what==='revert'?'새 버전으로 되돌리기':'새 버전으로 저장'});
  if(!ok)return;
  setBusy(true);setError('');
  try{await saveVersion(target,content);const data=await readVersions(target.campaignId);setFresh({base:givenArtifacts,data});setLeftId('');setRightId('');notifySaved(what==='revert'?'이전 버전 내용으로 새 버전을 저장했습니다.':'고른 부분을 넣은 새 버전을 저장했습니다.',{description:'이전 버전은 이력에 그대로 남아 있습니다.'})}
  catch(e){setError((e as Error).message)}finally{setBusy(false)}
 }
 return <section className="form-stack"><h3>작업물 버전 비교</h3><p className="subtle-note">두 버전을 어절 단위로 비교합니다. 되돌리기는 새 버전으로 저장합니다.</p><div className="form-two">
  {([{label:'이전 버전',selected:left,set:setLeftId},{label:'비교할 버전',selected:right,set:setRightId}]).map(({label,selected,set})=><div key={label}><label className="field"><span>{label}</span><NativeSelect aria-label={label} value={selected?.id||''} onChange={e=>set(e.target.value)}>{groups.map(g=><NativeSelectOptGroup key={g.role} label={g.label}>{g.options.map(o=><NativeSelectOption key={o.id} value={o.id} title={artifactPreview(versions.find(a=>a.id===o.id)?.content||'')}>{o.label}</NativeSelectOption>)}</NativeSelectOptGroup>)}</NativeSelect></label><p className="history-version-sentence">{sentence(selected)}</p></div>)}
 </div>
 {left&&right&&<VersionDiff key={left.id+':'+right.id} before={left.content} after={right.content} beforeLabel={'이전 버전 v'+left.version} afterLabel={'비교할 버전 v'+right.version} busy={busy}
  onApply={merged=>save(merged,'merge')} applyLabel="고른 부분 넣어 새 버전 저장" applyDisabledReason={noTarget} onRevert={()=>save(left.content,'revert')} revertLabel="이 버전으로 되돌리기" revertDisabledReason={blocked}/>}
 {error&&<p role="alert" className="form-error">{error}</p>}
 </section>;
}
