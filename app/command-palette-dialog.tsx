'use client';
// 명령 팔레트 대화상자 본문. cmdk와 대화상자 부품은 처음 열 때만 내려받는다(app/command-palette.tsx, UX-PLAN-3 Q7).
import {CommandDialog,CommandEmpty,CommandGroup,CommandInput,CommandItem,CommandList,CommandShortcut} from '@/components/ui/command';
import {useEffect,useState} from 'react';
import type {RecordHit} from '@/lib/record-search-server';
import type {Campaign} from '@/lib/agency';
import {glossary} from '@/lib/glossary';
import {goKeys,type PaletteRecord,type PaletteView} from './command-palette';
const shortcutOf=(id:string)=>{const k=Object.entries(goKeys).find(([,v])=>v===id)?.[0];return k?`g ${k}`:''};
// 용어 도움말(lib/glossary.ts)은 ? 안내에서 모두 보이고, 바로 가기에서는 검색할 때만 보인다(빈 목록이 길어지지 않게).
export default function CommandPaletteDialog({open,setOpen,help=false,views,campaigns,brands=[],records=[],onView,onCampaign,onBrand,onRecord,onGrowthRecord,onNewCampaign}:{open:boolean;setOpen:(v:boolean)=>void;help?:boolean;views:PaletteView[];campaigns:Campaign[];brands?:PaletteView[];records?:PaletteRecord[];onView:(id:string)=>void;onCampaign:(id:string)=>void;onBrand?:(id:string)=>void;onRecord?:(campaignId:string)=>void;onGrowthRecord?:(hit:RecordHit)=>void;onNewCampaign:()=>void}){
 const [query,setQuery]=useState(''),[hits,setHits]=useState<RecordHit[]>([]);
 // 성장 기록(근거·상품·오퍼·미션·문의·확대 제안 등)은 2자 이상 입력하면 서버에서 찾는다(GET /api/search, 읽기 전용).
 const canSearch=!!onGrowthRecord;
 useEffect(()=>{const q=query.trim();if(!canSearch||q.length<2)return;const c=new AbortController(),t=setTimeout(()=>{fetch(`/api/search?q=${encodeURIComponent(q)}`,{cache:'no-store',signal:c.signal}).then(r=>r.ok?r.json() as Promise<{hits:RecordHit[]}>:{hits:[]}).then(d=>{if(!c.signal.aborted)setHits(Array.isArray(d.hits)?d.hits:[])}).catch(()=>{})},200);return()=>{clearTimeout(t);c.abort()}},[query,canSearch]);
 // 닫을 때 검색어를 비운다. 다시 열면(특히 ? 안내) 지난 검색어가 목록을 가리지 않는다.
 const close=(v:boolean)=>{setOpen(v);if(!v)setQuery('');};
 const run=(fn:()=>void)=>{close(false);fn();};
 return <CommandDialog open={open} onOpenChange={close} title="바로 가기" description="화면·캠페인·브랜드·작업물·성장 기록 이름이나 용어를 입력하세요. 단축키: / 또는 Ctrl·⌘+K 열기, ? 안내, g 다음 글자로 화면 이동.">
  <CommandInput placeholder="화면·캠페인·기록 검색" value={query} onValueChange={setQuery}/>
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
   {onBrand&&brands.length>0&&<CommandGroup heading="브랜드">
    {brands.map(b=><CommandItem key={b.id} value={`브랜드 ${b.name} ${b.id}`} onSelect={()=>run(()=>onBrand(b.id))}>{b.name}<CommandShortcut>브랜드 아카이브</CommandShortcut></CommandItem>)}
   </CommandGroup>}
   {/* 작업물(기록)은 검색할 때만 보인다(UX-PLAN-3 1차원 전역 검색). 고르면 그 캠페인의 작업물 탭을 연다. */}
   {onRecord&&records.length>0&&query.trim().length>0&&<CommandGroup heading="작업물">
    {records.slice(0,200).map(r=><CommandItem key={r.id} value={`작업물 ${r.name} ${r.campaign} ${r.id}`} onSelect={()=>run(()=>onRecord(r.campaignId))}>{r.name}<CommandShortcut>{r.campaign}</CommandShortcut></CommandItem>)}
   </CommandGroup>}
   {onGrowthRecord&&query.trim().length>=2&&hits.length>0&&<CommandGroup heading="성장 기록">
    {hits.map(h=><CommandItem key={h.id} value={`기록 ${h.label} ${h.title} ${h.campaignTitle} ${h.id}`} onSelect={()=>run(()=>onGrowthRecord(h))}>{h.label}: {h.title}<CommandShortcut>{h.campaignTitle}</CommandShortcut></CommandItem>)}
   </CommandGroup>}
   {(help||query.trim().length>0)&&<CommandGroup heading="용어 도움말">
    {glossary.map(g=><CommandItem key={g.term} value={`용어 ${g.term} ${g.definition}`} onSelect={()=>{}}><span className="glossary-item"><b>{g.term}</b><small>{g.definition}</small></span></CommandItem>)}
   </CommandGroup>}
  </CommandList>
 </CommandDialog>;
}
