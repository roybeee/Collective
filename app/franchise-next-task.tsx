'use client';
// 트랙 R R6d 워크스페이스 '다음 할 일'의 가맹 모집 항목(lib/franchise-tasks.ts). 누르면 가맹 모집 화면의 그 브랜드·탭(리드·설정·모집 자료)으로 간다.
// 건수와 브랜드 이름만 보이고 리드는 보이지 않는다. 판정은 COLLECTIVE 휴리스틱 · 법률 자문 아님이라 문구를 항목마다 붙인다.
import {ArrowUpRight} from 'lucide-react';
import type {FranchiseNextTask} from '@/lib/franchise-tasks';

export function FranchiseNextTaskItem({task,brandName,onOpen}:{task:FranchiseNextTask;brandName?:string;onOpen:(next:{view:string;brand:string;tab:string})=>void}){
 return <button className="setup-item" data-franchise-task={task.task} onClick={()=>onOpen({view:'franchise',brand:task.brandId,tab:task.tab})}>
  <span className="step">{task.count}</span>
  <div><b>{task.label}</b><p>{task.detail}{brandName?` · ${brandName}`:''} · {task.disclaimer}</p></div>
  <ArrowUpRight size={17}/>
 </button>;
}
