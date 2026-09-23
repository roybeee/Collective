'use client';
import {useCallback,useEffect,useState,type ReactNode} from 'react';
import {createPortal} from 'react-dom';
import {RefreshCw} from 'lucide-react';
import {Button} from '@/components/ui/button';
import type {Artifact} from '@/lib/agency';
import type {EvidenceSummary as Summary} from '@/lib/ai-context';

const diagnosisLabel={included:'진단 포함',stale:'진단 오래됨',none:'진단 없음'} as const;

// 캠페인 상세 'AI 팀' 탭(panels.tsx) 맨 위에 내용을 붙인다. 탭은 열릴 때만 존재하므로 DOM 변화를 보고 자리를 다시 찾는다.
export function AiTeamSlot({children}:{children:ReactNode}){
 const [host,setHost]=useState<HTMLElement|null>(null);
 useEffect(()=>{
  let slot:HTMLDivElement|null=null;
  const sync=()=>{
   const panel=document.querySelector<HTMLElement>('.campaign-sheet [role="tabpanel"][id$="-content-team"]');
   if(slot&&panel&&slot.parentElement===panel)return;
   slot?.remove();slot=null;
   if(panel){slot=document.createElement('div');slot.className='ai-team-evidence';panel.insertBefore(slot,panel.firstChild)}
   setHost(slot);
  };
  sync();
  const observer=new MutationObserver(sync);observer.observe(document.body,{childList:true,subtree:true});
  return()=>{observer.disconnect();slot?.remove()};
 },[]);
 return host?createPortal(children,host):null;
}

// 'AI 팀에 전달되는 근거' 요약: 확정 사실·금지 표현·확정 자료·제외 후보·진단 상태와 브랜드·사실 변경, 확인 전 표현이 있는 작업물 수.
export function EvidenceSummary({campaignId,artifacts}:{campaignId:string;artifacts:Artifact[]}){
 const [summary,setSummary]=useState<Summary|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const fetchSummary=useCallback(async()=>{
  const r=await fetch('/api/directives?campaignId='+encodeURIComponent(campaignId));const d=await r.json() as {evidence?:Summary;error?:string};
  if(!r.ok||!d.evidence)throw new Error(d.error||'근거 요약을 불러오지 못했습니다.');return d.evidence;
 },[campaignId]);
 useEffect(()=>{
  let live=true;
  void fetchSummary().then(s=>{if(live){setSummary(s);setError('')}}).catch(e=>{if(live)setError((e as Error).message)});
  return()=>{live=false};
 },[fetchSummary]);
 async function load(){setBusy(true);try{setSummary(await fetchSummary());setError('')}catch(e){setError((e as Error).message)}finally{setBusy(false)}}
 const current=artifacts.filter(a=>a.campaignId===campaignId&&a.status!=='outdated');
 const changed=current.filter(a=>a.factsChanged).length,brandChanged=current.filter(a=>a.brandChanged).length,claims=current.filter(a=>a.unverifiedClaims?.length).length;
 return <section className="notice" aria-live="polite" style={{marginBottom:16}}>
  <div style={{display:'flex',justifyContent:'space-between',gap:8,alignItems:'center'}}><b>AI 팀에 전달되는 근거</b><Button variant="ghost" size="sm" disabled={busy} onClick={()=>void load()}><RefreshCw/>다시 확인</Button></div>
  {summary?<p>확정 사실 {summary.confirmedFacts} · 금지 표현 {summary.prohibitedFacts} · 확정 자료 {summary.confirmedSources} · 제외 후보 {summary.excludedCandidates} · {diagnosisLabel[summary.diagnosis]}</p>:!error&&<p>불러오는 중…</p>}
  {summary&&<small>미확인 사실 후보 {summary.candidateFacts}건과 브랜드 소개 문구는 ‘미확인’으로 표시해 전달합니다. 제외 후보는 브랜드 아카이브에서 확인하면 반영됩니다.{summary.diagnosis==='stale'?' 채택한 진단의 근거나 브랜드 정보가 바뀌어 진단을 빼고 전달합니다.':''}</small>}
  {changed>0&&<p className="form-error">확정 사실이 바뀐 뒤의 작업물 {changed}건은 다시 검토해 주세요. 작업물은 그대로 유지됩니다.</p>}
  {brandChanged>0&&<p className="form-error">브랜드 정보가 바뀐 뒤의 작업물 {brandChanged}건은 새 기준과 맞는지 검토해 주세요. 승인하려면 변경 확인이 필요합니다.</p>}
  {claims>0&&<p className="form-error">확인 전 금지·미확인 광고 표현이 [확인 필요] 없이 쓰인 작업물 {claims}건이 있습니다. 작업물의 ‘확인 전 표현’ 표시를 확인해 주세요.</p>}
  {error&&<p className="form-error" role="alert">{error}</p>}
 </section>;
}
