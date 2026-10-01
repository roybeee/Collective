'use client';
// 패널 안내문(UX-PLAN P2 규칙: 처음에는 첫 문장만 보이고 나머지는 '자세히'). 문장은 한 요소에 그대로 두고 화면에서만 접는다.
// 그래서 화면 읽기 프로그램과 문장 검색은 전체 문장을 그대로 읽는다. 60자 이하는 접지 않는다.
import {useId,useState} from 'react';
import {t} from '@/lib/ui-copy';
export const NOTE_LIMIT=60;
export function Note({children,className}:{children:React.ReactNode;className?:string}){
 const [open,setOpen]=useState(false),id=useId();
 const long=typeof children==='string'&&children.trim().length>NOTE_LIMIT;
 if(!long)return <p className={className??'ui-note'}>{children}</p>;
 // 첫 문장은 늘 다 보이고(UX-PLAN-3 Q4 첫 문단 60자), 나머지는 '자세히'로 편다. 접힌 나머지도 화면 읽기 프로그램은 읽는다(sr-only).
 const text=(children as string).trim(),cut=text.search(/(?<=[.다요])\s/),first=cut>0?text.slice(0,cut):text,rest=cut>0?text.slice(cut+1):'';
 if(!rest)return <p className={className??'ui-note'}>{children}</p>;
 return <div className="ui-note-wrap"><p id={id} className={className??'ui-note'}>{first}<span className={open?undefined:'sr-only'}>{' '+rest}</span></p><button type="button" className="ui-note-toggle" aria-expanded={open} aria-controls={id} onClick={()=>setOpen(v=>!v)}>{open?'접기':t('more')}</button></div>;
}
