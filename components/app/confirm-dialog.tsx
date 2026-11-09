'use client';
// 공용 확인 대화상자(UX-PLAN-3 Q2). 브라우저 기본 확인창(window.confirm) 대신 무엇이, 어디까지, 되돌릴 수 있는지를 한 문장씩 보여 준다.
// askConfirm()은 Promise<boolean>을 돌려준다. 화면에 ConfirmHost가 없으면(독립 화면·테스트) 같은 문장으로 기본 확인창을 쓴다.
// 승인 카드 v2(GLOBAL-PLAN X4): fields(무엇·어디·언제·비용·되돌림)를 정의 목록으로 영향·되돌리기 문장 위에 보이고, requestChanges를 주면 '변경 요청'(메시지 필수) 선택지가 생긴다.
// 기존 호출(fields·requestChanges 없음)은 그대로다. 대화상자 부품은 처음 물을 때 내려받는다(홈 첫 로딩 예산, tests/ux-budget.json).
import {lazy,Suspense,useEffect,useState} from 'react';
import {t,type MessageKey} from '@/lib/i18n';
export type ConfirmFields={what?:string;where?:string;when?:string;cost?:string;reversible?:string};
// 이름은 화면 언어(lib/i18n.ts)를 따른다. 한국어는 무엇·어디·언제·비용·되돌림이다.
export const confirmFieldKeys:Record<keyof ConfirmFields,MessageKey>={what:'confirm.what',where:'confirm.where',when:'confirm.when',cost:'confirm.cost',reversible:'confirm.reversible'};
export const confirmFieldLabel=(k:keyof ConfirmFields)=>t(confirmFieldKeys[k]);
export type ConfirmAsk={title:string;body?:string;impact:string;undo:string;confirmLabel?:string;danger?:boolean;input?:{label:string;type?:'text'|'number';placeholder?:string};fields?:ConfirmFields;requestChanges?:{label?:string;fieldLabel?:string;placeholder?:string}};
export type ConfirmDecision={decision:'confirm'}|{decision:'changes';message:string};
type Pending=ConfirmAsk&{id:number;resolve:(ok:boolean,value?:string,changes?:string)=>void};
let seq=0;
let enqueue:((ask:Omit<Pending,'id'>)=>void)|null=null;
export const confirmFieldLines=(f:ConfirmFields|undefined)=>(Object.keys(confirmFieldKeys) as (keyof ConfirmFields)[]).filter(k=>!!f?.[k]).map(k=>`${confirmFieldLabel(k)}: ${f![k]}`);
export const confirmText=(a:ConfirmAsk)=>[a.title,a.body,...confirmFieldLines(a.fields),a.impact,a.undo].filter(Boolean).join('\n');
export function askConfirm(ask:ConfirmAsk):Promise<boolean>{
 if(!enqueue)return Promise.resolve(typeof window!=='undefined'&&window.confirm(confirmText(ask)));
 return new Promise(resolve=>enqueue!({...ask,resolve:ok=>resolve(ok)}));
}
// 값 하나를 받아 확인까지 한 번에 묻는다(입력창+확인창 두 단계를 하나로). 취소하면 null.
export function askInput(ask:ConfirmAsk&{input:NonNullable<ConfirmAsk['input']>}):Promise<string|null>{
 if(!enqueue)return Promise.resolve(typeof window!=='undefined'?window.prompt(confirmText(ask)):null);
 return new Promise(resolve=>enqueue!({...ask,resolve:(ok,value)=>resolve(ok&&value!==undefined?value:null)}));
}
// 승인 또는 변경 요청(메시지 포함)을 하나의 대화상자에서 고른다. 취소하면 null. 호스트가 없으면 기본 확인창으로 승인만 묻는다.
export function askDecision(ask:ConfirmAsk):Promise<ConfirmDecision|null>{
 if(!enqueue)return Promise.resolve(typeof window!=='undefined'&&window.confirm(confirmText(ask))?{decision:'confirm'}:null);
 return new Promise(resolve=>enqueue!({...ask,resolve:(ok,_value,changes)=>resolve(changes!==undefined?{decision:'changes',message:changes}:ok?{decision:'confirm'}:null)}));
}
const ConfirmView=lazy(()=>import('./confirm-view'));
export function ConfirmHost(){
 const [queue,setQueue]=useState<Pending[]>([]);
 useEffect(()=>{enqueue=ask=>setQueue(q=>[...q,{...ask,id:++seq}]);return()=>{enqueue=null}},[]);
 const current=queue[0];
 if(!current)return null;
 const answer=(ok:boolean,value?:string,changes?:string)=>{current.resolve(ok,value,changes);setQueue(q=>q.slice(1))};
 return <Suspense fallback={null}><ConfirmView key={current.id} ask={current} onAnswer={answer}/></Suspense>;
}
