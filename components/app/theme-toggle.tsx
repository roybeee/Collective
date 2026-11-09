'use client';
// 화면 테마 전환(GLOBAL-PLAN X5): 시스템 → 라이트 → 다크 순으로 돌아가는 버튼 하나. 값은 lib/ui/theme.ts가 localStorage에 남기고 html.dark 클래스로 적용한다.
// 서버 렌더 시점에는 저장된 값을 알 수 없어 첫 그림은 '시스템'으로 두고, 마운트 뒤 실제 값으로 바꾼다(hydration 불일치 방지).
import {useSyncExternalStore} from 'react';
import {readTheme,setTheme,subscribeTheme} from '@/lib/ui/theme';
import {Monitor,Moon,Sun} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {useT} from '@/lib/i18n-react';
import type {MessageKey} from '@/lib/i18n';

const order=['system','light','dark'] as const;
type Mode=(typeof order)[number];
const labels:Record<Mode,MessageKey>={system:'theme.system',light:'theme.light',dark:'theme.dark'};
const icons:Record<Mode,typeof Monitor>={system:Monitor,light:Sun,dark:Moon};

export function ThemeToggle({className}:{className?:string}){
 const t=useT(),current:Mode=useSyncExternalStore(subscribeTheme,readTheme,()=>'system');
 const next=order[(order.indexOf(current)+1)%order.length];
 const Icon=icons[current];
 const label=t('theme.label',{current:t(labels[current]),next:t(labels[next])});
 return <Button type="button" variant="ghost" size="icon" className={className} aria-label={label} title={label} data-theme-mode={current} onClick={()=>setTheme(next)}><Icon aria-hidden/></Button>;
}
