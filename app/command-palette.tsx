'use client';
// 명령 팔레트(UX-PLAN P7)와 키보드 단축키(UX-PLAN-3 Q6). 화면·캠페인·브랜드 이동과 용어 도움말만 하며 저장·실행은 하지 않는다.
// Ctrl/⌘+K 또는 / : 바로 가기 열기, ? : 단축키 안내, g 다음 h·c·b·m·l·s : 홈·캠페인·브랜드·점포·학습·설정.
// 입력란·편집 영역에서 누른 글자는 단축키로 보지 않는다. 첫 로딩에는 단축키 감지만 싣고 대화상자(cmdk)는 처음 열 때 내려받는다.
import {lazy,Suspense,useEffect,useRef,useState} from 'react';
import type {Campaign} from '@/lib/agency';
export type PaletteView={id:string;name:string};
export const goKeys:Record<string,string>={h:'overview',c:'campaigns',b:'brands',m:'stores',l:'learning',s:'settings'};
const CommandPaletteDialog=lazy(()=>import('./command-palette-dialog'));
const typing=(t:EventTarget|null)=>t instanceof HTMLElement&&(t.isContentEditable||/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)||!!t.closest('[role=dialog],[role=alertdialog]'));
export function CommandPalette(props:{views:PaletteView[];campaigns:Campaign[];brands?:PaletteView[];onView:(id:string)=>void;onCampaign:(id:string)=>void;onBrand?:(id:string)=>void;onNewCampaign:()=>void}){
 const [open,setOpen]=useState(false),[loaded,setLoaded]=useState(false),[help,setHelp]=useState(false);
 const onView=useRef(props.onView);useEffect(()=>{onView.current=props.onView},[props.onView]);
 useEffect(()=>{
  let pendingG=0;
  const key=(e:KeyboardEvent)=>{
   if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='k'){e.preventDefault();setLoaded(true);setHelp(false);setOpen(v=>!v);return}
   if(e.metaKey||e.ctrlKey||e.altKey||typing(e.target))return;
   if(e.key==='/'){e.preventDefault();setLoaded(true);setHelp(false);setOpen(true);return}
   if(e.key==='?'){e.preventDefault();setLoaded(true);setHelp(true);setOpen(true);return}
   if(e.key==='g'){pendingG=Date.now();return}
   if(pendingG&&Date.now()-pendingG<1500&&goKeys[e.key]){e.preventDefault();pendingG=0;onView.current(goKeys[e.key]);return}
   pendingG=0;
  };
  window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);
 },[]);
 if(!loaded)return null;
 return <Suspense fallback={null}><CommandPaletteDialog open={open} setOpen={setOpen} help={help} {...props}/></Suspense>;
}
