'use client';
// 명령 팔레트 대화상자 본문. cmdk와 대화상자 부품은 처음 열 때만 내려받는다(app/command-palette.tsx, UX-PLAN-3 Q7).
import {CommandDialog,CommandEmpty,CommandGroup,CommandInput,CommandItem,CommandList,CommandShortcut} from '@/components/ui/command';
import type {Campaign} from '@/lib/agency';
import {goKeys,type PaletteView} from './command-palette';
const shortcutOf=(id:string)=>{const k=Object.entries(goKeys).find(([,v])=>v===id)?.[0];return k?`g ${k}`:''};
export default function CommandPaletteDialog({open,setOpen,help=false,views,campaigns,onView,onCampaign,onNewCampaign}:{open:boolean;setOpen:(v:boolean)=>void;help?:boolean;views:PaletteView[];campaigns:Campaign[];onView:(id:string)=>void;onCampaign:(id:string)=>void;onNewCampaign:()=>void}){
 const run=(fn:()=>void)=>{setOpen(false);fn();};
 return <CommandDialog open={open} onOpenChange={setOpen} title="바로 가기" description="화면이나 캠페인 이름을 입력하세요. 단축키: / 또는 Ctrl·⌘+K 열기, ? 안내, g 다음 글자로 화면 이동.">
  <CommandInput placeholder="화면·캠페인 검색"/>
  <CommandList>
   <CommandEmpty>찾는 항목이 없습니다.</CommandEmpty>
   <CommandGroup heading="작업">
    <CommandItem onSelect={()=>run(onNewCampaign)}>새 캠페인 만들기</CommandItem>
   </CommandGroup>
   {help&&<CommandGroup heading="단축키">
    <CommandItem value="단축키 바로 가기 열기" onSelect={()=>setOpen(true)}>바로 가기 열기<CommandShortcut>/ 또는 Ctrl+K</CommandShortcut></CommandItem>
    <CommandItem value="단축키 안내" onSelect={()=>setOpen(true)}>단축키 안내<CommandShortcut>?</CommandShortcut></CommandItem>
   </CommandGroup>}
   <CommandGroup heading="화면">
    {views.map(v=><CommandItem key={v.id} value={`화면 ${v.name}`} onSelect={()=>run(()=>onView(v.id))}>{v.name}{shortcutOf(v.id)&&<CommandShortcut>{shortcutOf(v.id)}</CommandShortcut>}</CommandItem>)}
   </CommandGroup>
   {campaigns.length>0&&<CommandGroup heading="캠페인">
    {campaigns.slice(0,50).map(c=><CommandItem key={c.id} value={`캠페인 ${c.title} ${c.id}`} onSelect={()=>run(()=>onCampaign(c.id))}>{c.title}</CommandItem>)}
   </CommandGroup>}
  </CommandList>
 </CommandDialog>;
}
