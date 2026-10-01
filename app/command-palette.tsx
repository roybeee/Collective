'use client';
// 명령 팔레트(UX-PLAN P7): Ctrl/⌘+K로 화면·캠페인·새 캠페인으로 바로 이동한다. 화면 이동만 하며 저장·실행은 하지 않는다.
// 첫 로딩에는 단축키 감지만 싣고, 대화상자(cmdk)는 처음 열 때 내려받는다(UX-PLAN-3 Q7).
import {lazy,Suspense,useEffect,useState} from 'react';
import type {Campaign} from '@/lib/agency';
export type PaletteView={id:string;name:string};
const CommandPaletteDialog=lazy(()=>import('./command-palette-dialog'));
export function CommandPalette(props:{views:PaletteView[];campaigns:Campaign[];onView:(id:string)=>void;onCampaign:(id:string)=>void;onNewCampaign:()=>void}){
 const [open,setOpen]=useState(false),[loaded,setLoaded]=useState(false);
 useEffect(()=>{const key=(e:KeyboardEvent)=>{if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='k'){e.preventDefault();setLoaded(true);setOpen(v=>!v);}};window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);},[]);
 if(!loaded)return null;
 return <Suspense fallback={null}><CommandPaletteDialog open={open} setOpen={setOpen} {...props}/></Suspense>;
}
