'use client';
// 접힌 패널은 처음 열 때만 그린다(UX-PLAN P4). 성장·판매 탭을 열 때 패널 27개가 한꺼번에 서버를 부르던 문제(GET 31건)를 없앤다.
// 한 번 연 패널은 닫아도 그대로 두어 입력 중인 내용이 사라지지 않는다. 건수 배지는 data-badge로 두어 요약 문구(summary 텍스트)는 바뀌지 않는다.
import {useState} from 'react';
export function LazyPanel({summary,badge,attention,children,defaultOpen=false}:{summary:string;badge?:string;attention?:boolean;children:()=>React.ReactNode;defaultOpen?:boolean}){
 const [opened,setOpened]=useState(defaultOpen);
 return <details className="lazy-panel" open={defaultOpen||undefined} data-attention={attention?'true':undefined} onToggle={e=>{if((e.currentTarget as HTMLDetailsElement).open)setOpened(true);}}><summary data-badge={badge||undefined}>{summary}</summary>{opened&&children()}</details>;
}
