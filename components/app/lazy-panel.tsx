'use client';
// 접힌 패널은 처음 열 때만 그린다(UX-PLAN P4). 성장·판매 탭을 열 때 패널 27개가 한꺼번에 서버를 부르던 문제(GET 31건)를 없앤다.
// 한 번 연 패널은 닫아도 그대로 두어 입력 중인 내용이 사라지지 않는다. 건수 배지는 data-badge로 두어 요약 문구(summary 텍스트)는 바뀌지 않는다.
// 연 패널은 주소의 # 뒤(#panel-<요약>)에 남아 새로고침·링크 공유 때 같은 패널이 열린다(UX-PLAN-3 Q1). 기록을 늘리지 않고 바꾼다.
import {useEffect,useRef,useState} from 'react';
export const panelHash=(summary:string)=>'#panel-'+encodeURIComponent(summary);
const setHash=(hash:string)=>history.replaceState(history.state,'',location.pathname+location.search+hash);
export function LazyPanel({summary,badge,attention,children,defaultOpen=false}:{summary:string;badge?:string;attention?:boolean;children:()=>React.ReactNode;defaultOpen?:boolean}){
 const linked=typeof window!=='undefined'&&location.hash===panelHash(summary);
 const [opened,setOpened]=useState(defaultOpen||linked),ref=useRef<HTMLDetailsElement>(null);
 useEffect(()=>{if(linked)ref.current?.scrollIntoView({block:'start'});},[linked]);
 return <details ref={ref} className="lazy-panel" open={defaultOpen||linked||undefined} data-attention={attention?'true':undefined} onToggle={e=>{const open=(e.currentTarget as HTMLDetailsElement).open;if(open){setOpened(true);setHash(panelHash(summary))}else if(location.hash===panelHash(summary))setHash('')}}><summary data-badge={badge||undefined}>{summary}</summary>{opened&&children()}</details>;
}
