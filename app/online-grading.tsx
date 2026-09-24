'use client';
import {useEffect,useState,type ReactNode} from 'react';
import {createPortal} from 'react-dom';
import type {Artifact} from '@/lib/agency';
import {roles} from '@/lib/agency';
import {COMPLIANCE_LEXICON} from '@/lib/graders/compliance-lexicon';

// 온라인 채점(F2b) 요약. 기능 스위치 online_grading이 켜졌을 때 저장 직후 채점한 결과만 있다. 자동 점검이며 승인·품질 판정이 아니다.
// not_run: 줄 수가 채점 한도를 넘어 채점기를 돌리지 않았다(lines에 줄 수).
// A2 런타임 하향(a2_downgrade)이 작업물에 남긴 규제 점검 차단(lib/online-grading.ts ComplianceHold와 같은 형태). 자동 점검이며 법률 자문이 아니다.
type ComplianceHold={version:string;block:number;issues:{category:string;ruleId:string;title:string;excerpt:string}[];checkedAt:string;notice:string};
type GradingRow={id:string;artifactId:string;artifactVersion:number;role:string;status:'graded'|'grader_error'|'not_run';reason?:string;lines?:number;summary:{pass:number;fail:number;not_applicable:number;grader_error:number}|null;compliance:{block:number;warn:number;info:number}|null;durationMs:number|null;failed:string[]};

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
const line=(g:GradingRow)=>g.status==='not_run'?`채점 안 함(${g.lines??'?'}줄, 채점 한도 초과 · 작업물은 그대로)`:g.status==='grader_error'||!g.summary?'채점 오류(작업물·실행 상태는 그대로)':`통과 ${g.summary.pass} · 실패 ${g.summary.fail} · 해당 없음 ${g.summary.not_applicable}${g.summary.grader_error?` · 채점기 오류 ${g.summary.grader_error}`:''}${g.compliance?` · 규제 점검 차단 ${g.compliance.block}·경고 ${g.compliance.warn}`:''}${g.durationMs!==null?` · ${g.durationMs}ms`:''}`;

// 출처 수는 현재 사전의 규칙 출처(국가법령정보센터 링크) 개수다. 사전에서 사라진 규칙이면 표시하지 않는다.
const sourceCount=(ruleId:string)=>COMPLIANCE_LEXICON.rules.find(r=>r.id===ruleId)?.sources.length??0;

// 현재 작업물(같은 id·버전)의 채점만 작업물 이름과 함께 작게 보여 준다. 채점이 없으면 아무것도 그리지 않는다.
// 규제 점검 차단은 outdated가 아닌 작업물의 complianceHold만 보여 준다. hold가 없으면 그 부분을 그리지 않는다.
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
 const held=artifacts.flatMap(a=>{const h=(a as Artifact&{complianceHold?:ComplianceHold}).complianceHold;return h&&a.status!=='outdated'?[{a,h}]:[]});
 if(!current.length&&!held.length)return null;
 return <OutputsSlot>
  {current.length?<section className="subtle-note" aria-label="작업물 온라인 채점"><p>자동 점검(채점기 13종·규제 표현) · 승인이나 품질 판정이 아닙니다.</p><ul>{current.map(({a,g})=><li key={g.id} title={g.failed.length?`실패·오류 채점기: ${g.failed.join(', ')}`:undefined}>{a.title} ({roles.find(r=>r.id===a.role)?.name||a.role} v{a.version}): {line(g)}</li>)}</ul></section>:null}
  {held.length?<section className="subtle-note" aria-label="규제 점검 차단"><ul>{held.map(({a,h})=><li key={a.id}>{a.title} ({roles.find(r=>r.id===a.role)?.name||a.role} v{a.version}): 규제 점검 차단 {h.block}건 — 게시 전 담당자 확인 필요<ul>{h.issues.map(i=><li key={i.ruleId}>{i.title} · “{i.excerpt}”{sourceCount(i.ruleId)?` · 출처 ${sourceCount(i.ruleId)}건`:''}</li>)}</ul></li>)}</ul>{[...new Set(held.map(({h})=>h.notice))].map(notice=><p key={notice}>{notice}</p>)}</section>:null}
 </OutputsSlot>;
}
