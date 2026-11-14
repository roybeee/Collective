'use client';
// AI 팀 탭의 실행 타임라인 + 연속 실행 중 지시 추가(벤치마크 P14). 연속 실행이 진행 중일 때만 '지시 추가'를 그리고,
// 저장한 지시는 남길 때 진행 중이던 실행 바로 뒤에 '지시 추가 · 다음 단계부터 반영'으로 끼운다(lib/run-timeline.ts withInstructions). 지시 목록을 읽지 못하면 실행 항목만 그린다.
import '@/lib/i18n/lazy-campaign';
import {useEffect,useState} from 'react';
import {RunTimeline} from '@/components/app/run-timeline';
import {AddInstruction} from '@/components/app/add-instruction';
import {api} from '@/lib/client';
import {useT} from '@/lib/i18n-react';
import {runTimeline,withInstructions,type InstructionLike} from '@/lib/run-timeline';
import {notifySaved} from '@/lib/ui/notify';

type RunLike=Parameters<typeof runTimeline>[0][number];
export function SequenceTimeline({campaignId,runs,running,roleName}:{campaignId:string;runs:readonly RunLike[];running:boolean;roleName:(id:string)=>string}){
 const t=useT(),[instructions,setInstructions]=useState<InstructionLike[]>([]);
 useEffect(()=>{const controller=new AbortController();
  void fetch('/api/run?'+new URLSearchParams({instructions:campaignId}),{signal:controller.signal,cache:'no-store'}).then(async r=>{const d=await r.json().catch(()=>({})) as {instructions?:unknown};if(!controller.signal.aborted&&r.ok&&Array.isArray(d.instructions))setInstructions(d.instructions as InstructionLike[])}).catch(()=>{});
  return()=>controller.abort()},[campaignId,running,runs.length]);
 async function add(text:string){
  const d=await api('add_instruction',{campaignId,text},'/api/run') as unknown as {instructions?:InstructionLike[]};
  if(Array.isArray(d.instructions))setInstructions(d.instructions);
  notifySaved('연속 실행에 지시를 추가했습니다.',{description:t('instruction.next')});
 }
 const items=withInstructions(runTimeline(runs,roleName),instructions,{title:t('instruction.timelineTitle'),subtitle:t('instruction.timelineNext')});
 return <>
  {running&&<AddInstruction onAdd={add}/>}
  <RunTimeline items={items} label="실행 타임라인" className="mt-4"/>
 </>;
}
