'use client';
// X8 버전 비교(어절 단위, lib/word-diff.ts). 추가는 밑줄, 삭제는 취소선으로 그리고 화면 낭독기용 '추가'·'삭제' 글자를 붙인다(색만으로 구분하지 않는다).
// 한 줄 보기와 나란히 보기를 고를 수 있다. 바뀐 부분마다 '이 부분 받기'로 일부만 받아 합친 글을 만들고(onApply), '이 버전으로 되돌리기'(onRevert)는 부모가 새 버전으로 저장한다.
// compact: 짧은 비교(규정 수정 제안 미리보기 등)는 요약·보기 방식 띠 없이 한 줄 보기만 그린다.
// 이 부품은 저장하지 않는다. 합친 글·되돌리기는 모두 부모 콜백이 기존 저장 경로로 처리한다(이력은 바꾸지 않는다).
import {useMemo,useState} from 'react';
import {Button} from '@/components/ui/button';
import {Segmented} from './segmented';
import {applyChanges,wordDiff,type DiffSegment} from '@/lib/word-diff';

type Props={before:string;after:string;beforeLabel:string;afterLabel:string;
 onApply?:(merged:string)=>void|Promise<void>;applyLabel?:string;applyDisabledReason?:string;
 onAcceptAll?:()=>void|Promise<void>;acceptAllLabel?:string;
 onRevert?:()=>void|Promise<void>;revertLabel?:string;revertDisabledReason?:string;
 busy?:boolean;compact?:boolean};

const Removed=({text}:{text:string})=>text?<del className="vd-del"><span className="sr-only">삭제: </span>{text}</del>:null;
const Added=({text}:{text:string})=>text?<ins className="vd-ins"><span className="sr-only">추가: </span>{text}</ins>:null;
function Inline({segments}:{segments:readonly DiffSegment[]}){
 return <div className="vd-text">{segments.map((s,i)=>s.kind==='equal'?<span key={i}>{s.text}</span>:<span key={i} className="vd-change"><Removed text={s.removed}/><Added text={s.added}/></span>)}</div>;
}
function Side({segments,beforeLabel,afterLabel}:{segments:readonly DiffSegment[];beforeLabel:string;afterLabel:string}){
 return <div className="vd-side">
  <section aria-label={beforeLabel}><p className="vd-col-label">{beforeLabel}</p><div className="vd-text">{segments.map((s,i)=>s.kind==='equal'?<span key={i}>{s.text}</span>:<Removed key={i} text={s.removed}/>)}</div></section>
  <section aria-label={afterLabel}><p className="vd-col-label">{afterLabel}</p><div className="vd-text">{segments.map((s,i)=>s.kind==='equal'?<span key={i}>{s.text}</span>:<Added key={i} text={s.added}/>)}</div></section>
 </div>;
}
const short=(text:string)=>{const t=text.replace(/\s+/g,' ').trim();return t.length>60?t.slice(0,60)+'…':t};

export function VersionDiff({before,after,beforeLabel,afterLabel,onApply,applyLabel='고른 부분 적용',applyDisabledReason,onAcceptAll,acceptAllLabel='전부 받기',onRevert,revertLabel='이 버전으로 되돌리기',revertDisabledReason,busy=false,compact=false}:Props){
 const segments=useMemo(()=>wordDiff(before,after),[before,after]);
 const changes=segments.filter((s):s is Extract<DiffSegment,{kind:'change'}>=>s.kind==='change');
 const [view,setView]=useState<'inline'|'side'>('inline');
 const [accepted,setAccepted]=useState<readonly number[]>([]);
 const chosen=accepted.filter(id=>changes.some(c=>c.id===id));
 const merged=applyChanges(segments,chosen);
 const toggle=(id:number)=>setAccepted(list=>list.includes(id)?list.filter(x=>x!==id):[...list,id]);
 return <div className="version-diff">
  {!compact&&<div className="vd-toolbar"><p className="vd-summary">{changes.length?`바뀐 부분 ${changes.length}곳`:'두 버전의 본문이 같습니다.'}</p><Segmented label="비교 보기 방식" value={view} onChange={setView} options={[{value:'inline',label:'한 줄로 보기'},{value:'side',label:'나란히 보기'}]}/></div>}
  <div aria-label="버전 비교" role="group">{compact||view==='inline'?<Inline segments={segments}/>:<Side segments={segments} beforeLabel={beforeLabel} afterLabel={afterLabel}/>}</div>
  {onApply&&changes.length>0&&<ol className="vd-hunks" aria-label="바뀐 부분">{changes.map((c,i)=>{const on=chosen.includes(c.id);return <li key={c.id} data-accepted={on||undefined}>
   <span className="vd-hunk-text"><span className="vd-hunk-no">{i+1}</span>{c.removed.trim()&&<Removed text={short(c.removed)}/>} {c.added.trim()&&<Added text={short(c.added)}/>}</span>
   <Button type="button" variant="outline" size="sm" aria-pressed={on} disabled={busy} onClick={()=>toggle(c.id)}>{on?'받기 취소':'이 부분 받기'}</Button></li>})}</ol>}
  {onApply&&chosen.length>0&&<section className="vd-merged" aria-label="합친 글"><p className="vd-col-label">고른 {chosen.length}곳을 넣은 글</p><div className="vd-text">{merged}</div></section>}
  {(onApply||onAcceptAll||onRevert)&&<div className="vd-actions">
   {onApply&&changes.length>0&&<Button type="button" size="sm" disabled={busy||!chosen.length||!!applyDisabledReason} disabledReason={applyDisabledReason||(!chosen.length?'먼저 받을 부분을 고르세요.':undefined)} onClick={()=>void onApply(merged)}>{applyLabel}</Button>}
   {onAcceptAll&&<Button type="button" variant="outline" size="sm" disabled={busy} onClick={()=>void onAcceptAll()}>{acceptAllLabel}</Button>}
   {onRevert&&<Button type="button" variant="outline" size="sm" disabled={busy||!!revertDisabledReason} disabledReason={revertDisabledReason} onClick={()=>void onRevert()}>{revertLabel}</Button>}
  </div>}
 </div>;
}
