'use client';
import {useEffect,useState,type ReactNode} from 'react';
import {createPortal} from 'react-dom';
import type {Artifact} from '@/lib/agency';
import {roles} from '@/lib/agency';

// 온라인 채점(F2b) 요약. 기능 스위치 online_grading이 켜졌을 때 저장 직후 채점한 결과만 있다. 자동 점검이며 승인·품질 판정이 아니다.
type GradingRow={id:string;artifactId:string;artifactVersion:number;role:string;status:'graded'|'grader_error';summary:{pass:number;fail:number;not_applicable:number;grader_error:number}|null;compliance:{block:number;warn:number;info:number}|null;durationMs:number|null;failed:string[]};

// 캠페인 상세 '작업물' 탭(panels.tsx) 끝에 붙인다. 탭은 열릴 때만 있으므로 DOM 변화를 보고 자리를 다시 찾는다(evidence-summary.tsx AiTeamSlot과 같은 방식).
function OutputsSlot({children}:{children:ReactNode}){
 const [host,setHost]=useState<HTMLElement|null>(null);
 useEffect(()=>{
  let slot:HTMLDivElement|null=null;
  const sync=()=>{
   const panel=document.querySelector<HTMLElement>('.campaign-sheet [role="tabpanel"][id$="-content-outputs"]');
   if(slot&&panel&&slot.parentElement===panel)return;
   slot?.remove();slot=null;
   if(panel){slot=document.createElement('div');slot.className='online-grading';panel.appendChild(slot)}
   setHost(slot);
  };
  sync();
  const observer=new MutationObserver(sync);observer.observe(document.body,{childList:true,subtree:true});
  return()=>{observer.disconnect();slot?.remove()};
 },[]);
 return host?createPortal(children,host):null;
}
const line=(g:GradingRow)=>g.status==='grader_error'||!g.summary?'채점 오류(작업물·실행 상태는 그대로)':`통과 ${g.summary.pass} · 실패 ${g.summary.fail} · 해당 없음 ${g.summary.not_applicable}${g.summary.grader_error?` · 채점기 오류 ${g.summary.grader_error}`:''}${g.compliance?` · 규제 점검 차단 ${g.compliance.block}·경고 ${g.compliance.warn}`:''}${g.durationMs!==null?` · ${g.durationMs}ms`:''}`;

// 현재 작업물(같은 id·버전)의 채점만 작업물 이름과 함께 작게 보여 준다. 채점이 없으면 아무것도 그리지 않는다.
export function OnlineGradingSlot({campaignId,artifacts}:{campaignId:string;artifacts:Artifact[]}){
 const [rows,setRows]=useState<GradingRow[]>([]);
 const signature=artifacts.map(a=>`${a.id}:${a.version}`).join('|');
 useEffect(()=>{
  const controller=new AbortController();
  void fetch('/api/usage?grading='+encodeURIComponent(campaignId),{signal:controller.signal,cache:'no-store'})
   .then(async r=>{const d=await r.json() as {gradings?:GradingRow[]};return r.ok&&Array.isArray(d.gradings)?d.gradings:[]})
   .then(list=>{if(!controller.signal.aborted)setRows(list)})
   .catch(()=>{if(!controller.signal.aborted)setRows([])});
  return()=>controller.abort();
 },[campaignId,signature]);
 const current=artifacts.flatMap(a=>{const g=rows.find(r=>r.artifactId===a.id&&r.artifactVersion===a.version);return g?[{a,g}]:[]});
 if(!current.length)return null;
 return <OutputsSlot><section className="subtle-note" aria-label="작업물 온라인 채점"><p>자동 점검(채점기 13종·규제 표현) · 승인이나 품질 판정이 아닙니다.</p><ul>{current.map(({a,g})=><li key={g.id} title={g.failed.length?`실패·오류 채점기: ${g.failed.join(', ')}`:undefined}>{a.title} ({roles.find(r=>r.id===a.role)?.name||a.role} v{a.version}): {line(g)}</li>)}</ul></section></OutputsSlot>;
}
