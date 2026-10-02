'use client';
import {EmptyLine} from '@/components/app/empty-line';
import {useState} from 'react';
import {NativeSelect,NativeSelectOptGroup,NativeSelectOption} from '@/components/ui/native-select';
import type {Artifact} from '@/lib/agency';
import type {ArtifactVersion} from '@/lib/campaign-detail';
import {artifactPreview,defaultComparison,versionGroups} from '@/lib/history-labels';
// 선택 상자 글자는 짧은 형식(label), 상자 아래에는 고른 버전을 한 문장(sentence)으로 보인다.

export function CampaignHistory({artifacts,history}:{artifacts:Artifact[];history:ArtifactVersion[]}){
 const versions=[...artifacts,...history],groups=versionGroups(artifacts,history),options=groups.flatMap(g=>g.options),initial=defaultComparison(groups);
 const [leftId,setLeftId]=useState(''),[rightId,setRightId]=useState('');
 const left=versions.find(a=>a.id===leftId)||versions.find(a=>a.id===initial.left);
 const right=versions.find(a=>a.id===rightId)||versions.find(a=>a.id===initial.right);
 if(!versions.length)return <EmptyLine className="subtle-note" next="AI 팀이 작업물을 쓰면 버전이 쌓입니다.">아직 저장된 작업물 버전이 없습니다.</EmptyLine>;
 return <section className="form-stack"><h3>작업물 버전 비교</h3><p className="subtle-note">저장된 이전 본문과 현재 본문을 나란히 보는 보기 전용 비교입니다.</p><div className="form-two">
  {([{label:'이전 버전',selected:left,set:setLeftId},{label:'비교할 버전',selected:right,set:setRightId}]).map(({label,selected,set})=><div key={label}><label className="field"><span>{label}</span><NativeSelect aria-label={label} value={selected?.id||''} onChange={e=>set(e.target.value)}>{groups.map(g=><NativeSelectOptGroup key={g.role} label={g.label}>{g.options.map(o=><NativeSelectOption key={o.id} value={o.id} title={artifactPreview(versions.find(a=>a.id===o.id)?.content||'')}>{o.label}</NativeSelectOption>)}</NativeSelectOptGroup>)}</NativeSelect></label><p className="history-version-sentence">{options.find(o=>o.id===selected?.id)?.sentence}</p><pre className="history-pre">{selected?.content}</pre></div>)}
 </div></section>;
}
