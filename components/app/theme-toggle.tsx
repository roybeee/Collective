'use client';
// 화면 테마 전환(GLOBAL-PLAN X5): 시스템 → 라이트 → 다크 순으로 돌아가는 버튼 하나. 값은 next-themes가 localStorage에 남기고 html.dark 클래스로 적용한다.
// 서버 렌더 시점에는 저장된 값을 알 수 없어 첫 그림은 '시스템'으로 두고, 마운트 뒤 실제 값으로 바꾼다(hydration 불일치 방지).
import {useSyncExternalStore} from 'react';
import {useTheme} from 'next-themes';
import {Monitor,Moon,Sun} from 'lucide-react';
import {Button} from '@/components/ui/button';

const order=['system','light','dark'] as const;
type Mode=(typeof order)[number];
const labels:Record<Mode,string>={system:'시스템',light:'라이트',dark:'다크'};
const icons:Record<Mode,typeof Monitor>={system:Monitor,light:Sun,dark:Moon};
const subscribeNoop=()=>()=>{};
const asMode=(value:string|undefined):Mode=>(order as readonly string[]).includes(value||'')?(value as Mode):'system';

export function ThemeToggle({className}:{className?:string}){
 const {theme,setTheme}=useTheme();
 const mounted=useSyncExternalStore(subscribeNoop,()=>true,()=>false);
 const current:Mode=mounted?asMode(theme):'system';
 const next=order[(order.indexOf(current)+1)%order.length];
 const Icon=icons[current];
 const label=`화면 테마: ${labels[current]}. 누르면 ${labels[next]}`;
 return <Button type="button" variant="ghost" size="icon" className={className} aria-label={label} title={label} data-theme-mode={current} onClick={()=>setTheme(next)}><Icon aria-hidden/></Button>;
}
