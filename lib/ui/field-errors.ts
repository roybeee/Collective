'use client';
import {useEffect} from 'react';
// 서버 검증 오류를 칸에 붙이는 연결(components/app/field-error-bridge.tsx)을 첫 누름·키 입력 때 내려받아 설치한다. 홈 첫 로딩 JS에 넣지 않는다(UX-PLAN-3 Q7).
export function useDeferredFieldErrors(){
 useEffect(()=>{
  let dispose:(()=>void)|null=null,cancelled=false;
  const start=(e:Event)=>{document.removeEventListener('pointerdown',start,true);document.removeEventListener('keydown',start,true);void import('@/components/app/field-error-bridge').then(m=>{if(!cancelled)dispose=m.installFieldErrorBridge(e)}).catch(()=>{})};
  document.addEventListener('pointerdown',start,true);document.addEventListener('keydown',start,true);
  return()=>{cancelled=true;document.removeEventListener('pointerdown',start,true);document.removeEventListener('keydown',start,true);dispose?.()};
 },[]);
}
