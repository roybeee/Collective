'use client';
// 명령 팔레트(UX-PLAN P7): Ctrl/⌘+K로 화면·캠페인·새 캠페인으로 바로 이동한다. 화면 이동만 하며 저장·실행은 하지 않는다.
import {useEffect,useState} from 'react';
import {CommandDialog,CommandEmpty,CommandGroup,CommandInput,CommandItem,CommandList} from '@/components/ui/command';
import type {Campaign} from '@/lib/agency';
export type PaletteView={id:string;name:string};
export function CommandPalette({views,campaigns,onView,onCampaign,onNewCampaign}:{views:PaletteView[];campaigns:Campaign[];onView:(id:string)=>void;onCampaign:(id:string)=>void;onNewCampaign:()=>void}){
 const [open,setOpen]=useState(false);
 useEffect(()=>{const key=(e:KeyboardEvent)=>{if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='k'){e.preventDefault();setOpen(v=>!v);}};window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);},[]);
 const run=(fn:()=>void)=>{setOpen(false);fn();};
 return <CommandDialog open={open} onOpenChange={setOpen} title="바로 가기" description="화면이나 캠페인 이름을 입력하세요.">
  <CommandInput placeholder="화면·캠페인 검색"/>
  <CommandList>
   <CommandEmpty>찾는 항목이 없습니다.</CommandEmpty>
   <CommandGroup heading="작업">
    <CommandItem onSelect={()=>run(onNewCampaign)}>새 캠페인 만들기</CommandItem>
   </CommandGroup>
   <CommandGroup heading="화면">
    {views.map(v=><CommandItem key={v.id} value={`화면 ${v.name}`} onSelect={()=>run(()=>onView(v.id))}>{v.name}</CommandItem>)}
   </CommandGroup>
   {campaigns.length>0&&<CommandGroup heading="캠페인">
    {campaigns.slice(0,50).map(c=><CommandItem key={c.id} value={`캠페인 ${c.title} ${c.id}`} onSelect={()=>run(()=>onCampaign(c.id))}>{c.title}</CommandItem>)}
   </CommandGroup>}
  </CommandList>
 </CommandDialog>;
}
