'use client';
// 첫 화면 아래쪽(통계·캠페인 표·브랜드·AI 팀)은 첫 그림 바로 다음 프레임에 그린다(UX-PLAN-3 ⑩ 4G LCP).
// 홈은 위쪽(안건·목표 입력)이 먼저 보여야 한다. 한 번에 다 그리면 느린 기기에서 첫 그림이 그만큼 늦어진다. 내용과 순서는 같다.
import {useEffect,useState} from 'react';
export function AfterPaint({children}:{children:React.ReactNode}){
 const [ready,setReady]=useState(false);
 useEffect(()=>{const id=requestAnimationFrame(()=>setReady(true));return()=>cancelAnimationFrame(id)},[]);
 return ready?<>{children}</>:null;
}
