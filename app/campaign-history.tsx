'use client';
import {useState} from 'react';
import {NativeSelect,NativeSelectOption} from '@/components/ui/native-select';
import type {Artifact} from '@/lib/agency';
import type {ArtifactVersion} from '@/lib/campaign-detail';

export function CampaignHistory({artifacts,history}:{artifacts:Artifact[];history:ArtifactVersion[]}){
 const versions=[...artifacts,...history].toSorted((a,b)=>a.role.localeCompare(b.role)||b.version-a.version);
 const [leftId,setLeftId]=useState(''),[rightId,setRightId]=useState('');
 const left=versions.find(a=>a.id===leftId)||history[0]||versions[0];
 const right=versions.find(a=>a.id===rightId)||artifacts.find(a=>a.id===(left as ArtifactVersion)?.originalId)||artifacts.find(a=>a.role===left?.role)||versions[0];
 if(!versions.length)return <p className="subtle-note">아직 저장된 작업물 버전이 없습니다.</p>;
 return <section className="form-stack"><h3>작업물 버전 비교</h3><p className="subtle-note">이전 본문과 현재 본문을 함께 확인합니다. 비교는 저장된 원문을 표시하며 승인이나 복원을 수행하지 않습니다.</p><div className="form-two">
  {([{label:'이전 버전',selected:left,set:setLeftId},{label:'비교할 버전',selected:right,set:setRightId}]).map(({label,selected,set})=><div key={label}><label className="field"><span>{label}</span><NativeSelect aria-label={label} value={selected?.id||''} onChange={e=>set(e.target.value)}>{versions.map(a=><NativeSelectOption key={a.id} value={a.id}>{a.title} · v{a.version} · {a.status} · {a.id.slice(-6)}</NativeSelectOption>)}</NativeSelect></label><pre style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere',maxHeight:'32rem',overflow:'auto',font:'inherit',padding:'1rem',border:'1px solid var(--border)',borderRadius:8}}>{selected?.content}</pre></div>)}
 </div></section>;
}
