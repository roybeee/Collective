'use client';
// 공용 확인 대화상자(UX-PLAN-3 Q2). 브라우저 기본 확인창(window.confirm) 대신 무엇이, 어디까지, 되돌릴 수 있는지를 한 문장씩 보여 준다.
// askConfirm()은 Promise<boolean>을 돌려준다. 화면에 ConfirmHost가 없으면(독립 화면·테스트) 같은 문장으로 기본 확인창을 쓴다.
// 대화상자 부품은 처음 물을 때 내려받는다(홈 첫 로딩 예산, tests/ux-budget.json).
import {lazy,Suspense,useEffect,useState} from 'react';
export type ConfirmAsk={title:string;body?:string;impact?:string;undo?:string;confirmLabel?:string;danger?:boolean};
type Pending=ConfirmAsk&{id:number;resolve:(ok:boolean)=>void};
let seq=0;
let enqueue:((ask:Omit<Pending,'id'>)=>void)|null=null;
export const confirmText=(a:ConfirmAsk)=>[a.title,a.body,a.impact,a.undo].filter(Boolean).join('\n');
export function askConfirm(ask:ConfirmAsk):Promise<boolean>{
 if(!enqueue)return Promise.resolve(typeof window!=='undefined'&&window.confirm(confirmText(ask)));
 return new Promise(resolve=>enqueue!({...ask,resolve}));
}
const ConfirmView=lazy(()=>import('./confirm-view'));
export function ConfirmHost(){
 const [queue,setQueue]=useState<Pending[]>([]);
 useEffect(()=>{enqueue=ask=>setQueue(q=>[...q,{...ask,id:++seq}]);return()=>{enqueue=null}},[]);
 const current=queue[0];
 if(!current)return null;
 const answer=(ok:boolean)=>{current.resolve(ok);setQueue(q=>q.slice(1))};
 return <Suspense fallback={null}><ConfirmView key={current.id} ask={current} onAnswer={answer}/></Suspense>;
}
