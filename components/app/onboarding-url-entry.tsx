'use client';
import {lazy,Suspense,useState,type ComponentProps} from 'react';
import {ChevronRight} from 'lucide-react';
import {CardButton} from './card-button';
// 홈 시작하기 카드의 '브랜드 초안 만들기' 진입 줄(G1). 무거운 카드(components/app/onboarding-url-card.tsx: 추출기·템플릿·알림)는 이 줄을 누를 때만 내려받는다.
// 홈 첫 로딩 JS 예산(tests/ux-budget.json homeJsGzKB)은 networkidle까지 받은 모든 JS를 세므로, 홈이 그려질 때 lazy를 바로 열면 예산에 들어간다. 그래서 사용자가 누른 뒤에 연다.
// 이 줄 자체도 홈 묶음에 실리므로 아이콘·글을 최소로 둔다(홈은 예산 한계에 있다).
const OnboardingUrlCard=lazy(()=>import('./onboarding-url-card').then(m=>({default:m.OnboardingUrlCard})));
export function OnboardingUrlEntry(props:ComponentProps<typeof OnboardingUrlCard>){
 const [open,setOpen]=useState(false);
 return <>
  <CardButton className="setup-item" aria-expanded={open} onClick={()=>setOpen(o=>!o)}><span className="step">+</span><div><b>URL 한 줄로 브랜드 초안</b><p>공개 주소에서 이름·색·사실 후보를 뽑습니다.</p></div><ChevronRight size={17}/></CardButton>
  {open&&<Suspense fallback={<p className="loading-line">불러오고 있습니다.</p>}><OnboardingUrlCard {...props}/></Suspense>}
 </>;
}
