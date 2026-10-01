'use client';
// 패널 안내문(UX-PLAN P2 규칙: 처음에는 한 줄만 보이고 나머지는 '자세히'). 문장은 한 요소에 그대로 두고 화면에서만 접는다.
// 그래서 화면 읽기 프로그램과 문장 검색은 전체 문장을 그대로 읽는다. 60자 이하는 접지 않는다.
import {useId,useState} from 'react';
import {t} from '@/lib/ui-copy';
export const NOTE_LIMIT=60;
export function Note({children,className}:{children:React.ReactNode;className?:string}){
 const [open,setOpen]=useState(false),id=useId();
 const long=typeof children==='string'&&children.trim().length>NOTE_LIMIT;
 if(!long)return <p className={className??'ui-note'}>{children}</p>;
 return <div className="ui-note-wrap"><p id={id} className={className??'ui-note'} data-clamp={open?undefined:'true'}>{children}</p><button type="button" className="ui-note-toggle" aria-expanded={open} aria-controls={id} onClick={()=>setOpen(v=>!v)}>{open?'접기':t('more')}</button></div>;
}
