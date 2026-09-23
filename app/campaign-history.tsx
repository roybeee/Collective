'use client';
import {useState} from 'react';
import {NativeSelect,NativeSelectOptGroup,NativeSelectOption} from '@/components/ui/native-select';
import type {Artifact} from '@/lib/agency';
import type {ArtifactVersion} from '@/lib/campaign-detail';
import {artifactPreview,defaultComparison,versionGroups} from '@/lib/history-labels';

export function CampaignHistory({artifacts,history}:{artifacts:Artifact[];history:ArtifactVersion[]}){
 const versions=[...artifacts,...history],groups=versionGroups(artifacts,history),initial=defaultComparison(groups);
 const [leftId,setLeftId]=useState(''),[rightId,setRightId]=useState('');
 const left=versions.find(a=>a.id===leftId)||versions.find(a=>a.id===initial.left);
 const right=versions.find(a=>a.id===rightId)||versions.find(a=>a.id===initial.right);
 if(!versions.length)return <p className="subtle-note">아직 저장된 작업물 버전이 없습니다.</p>;
 return <section className="form-stack"><h3>작업물 버전 비교</h3><p className="subtle-note">이전 본문과 현재 본문을 함께 확인합니다. 비교는 저장된 원문을 표시하며 승인이나 복원을 수행하지 않습니다.</p><div className="form-two">
  {([{label:'이전 버전',selected:left,set:setLeftId},{label:'비교할 버전',selected:right,set:setRightId}]).map(({label,selected,set})=><div key={label}><label className="field"><span>{label}</span><NativeSelect aria-label={label} value={selected?.id||''} onChange={e=>set(e.target.value)}>{groups.map(g=><NativeSelectOptGroup key={g.role} label={g.label}>{g.options.map(o=><NativeSelectOption key={o.id} value={o.id} title={artifactPreview(versions.find(a=>a.id===o.id)?.content||'')}>{o.label}</NativeSelectOption>)}</NativeSelectOptGroup>)}</NativeSelect></label><pre style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere',maxHeight:'32rem',overflow:'auto',font:'inherit',padding:'1rem',border:'1px solid var(--border)',borderRadius:8}}>{selected?.content}</pre></div>)}
 </div></section>;
}
