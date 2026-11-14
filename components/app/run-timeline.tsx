'use client';
// 실행 타임라인(GLOBAL-PLAN X2). 회의 단계와 역할 실행을 같은 모양으로 그린다: 상태 아이콘+글자 라벨(색만으로 구분하지 않음), 시작 시각, 경과(진행 중은 1초마다), 시도 수, 토큰.
// 컨테이너(div)는 role="log" aria-live="polite"로 새 항목·상태 변화를 화면 읽기 프로그램에 알리고, 그 안의 목록은 일반 ol이다(ol에 role을 주면 li가 목록 부모를 잃는다, QA D5). 모르는 상태는 '상태 미확인'으로 그린다(lib/run-timeline.ts).
import {useEffect,useState} from 'react';
import {Ban,CircleCheck,CircleQuestionMark,CircleX,Clock,Hand,LoaderCircle,MessageSquarePlus} from 'lucide-react';
import {MetaLine} from '@/components/app/meta-line';
import {cn} from '@/lib/utils';
import {elapsedMs,formatElapsed,hasLive,statusView,type TimelineItem,type TimelineTone} from '@/lib/run-timeline';
import {t} from '@/lib/i18n';
import {useT} from '@/lib/i18n-react';
import '@/lib/i18n/lazy';

const icons:Record<TimelineTone,React.ComponentType<{size?:number;className?:string;'aria-hidden'?:boolean}>>={idle:Clock,live:LoaderCircle,wait:Hand,done:CircleCheck,fail:CircleX,stop:Ban,unknown:CircleQuestionMark,note:MessageSquarePlus};
// 대기·완료 색은 라이트·다크 토큰(globals.css --yellow-35·--olive-42, 상태 배지와 같은 값)이다. 고정 Tailwind 색(emerald-700)은 다크에서 대비가 모자랐다(QA D6).
const tones:Record<TimelineTone,string>={idle:'text-muted-foreground',live:'text-foreground',wait:'text-(--yellow-35)',done:'text-(--olive-42)',fail:'text-destructive',stop:'text-muted-foreground',unknown:'text-muted-foreground',note:'text-foreground'};
const clock=(s:string|null|undefined)=>{const t=s?Date.parse(s):NaN;return Number.isFinite(t)?new Date(t).toLocaleTimeString('ko-KR',{timeZone:'Asia/Seoul',hour:'2-digit',minute:'2-digit',second:'2-digit'}):null};
// 진행 중 항목이 있으면 1초마다 다시 그려 경과를 살린다. now를 넘기면(테스트) 시계를 돌리지 않는다.
function useTicker(active:boolean,fixed?:number){
 const [now,setNow]=useState(()=>fixed??Date.now());
 useEffect(()=>{if(fixed!==undefined||!active)return;const t=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(t)},[active,fixed]);
 return fixed??now;
}
export function RunTimeline({items,label,now:fixedNow,className}:{items:readonly TimelineItem[];label:string;now?:number;className?:string}){useT();
 const now=useTicker(hasLive(items),fixedNow);
 if(!items.length)return null;
 return <div role="log" aria-live="polite" aria-label={label} className={cn('run-timeline',className)}><ol className="grid gap-2 m-0 p-0 list-none">
  {items.map(item=>{
   const view=statusView(item.status,item.phase),Icon=icons[view.tone],elapsed=view.tone==='note'?null:elapsedMs(item,now),started=clock(item.startedAt);
   return <li key={item.id} data-status={item.status} className="flex items-start gap-3 rounded-md border border-border bg-background px-3 py-2.5 min-h-11">
    <span className={cn('mt-0.5 shrink-0',tones[view.tone])}><Icon size={18} className={view.live&&view.tone==='live'?'spin':undefined} aria-hidden/></span>
    <div className="min-w-0 flex-1 text-sm leading-6">
     <div className="flex flex-wrap items-baseline gap-x-2"><b className={tones[view.tone]}>{view.label}</b><span>{item.title}</span>{item.subtitle&&<span className="text-muted-foreground text-[13px]">{item.subtitle}</span>}</div>
     <small className="block text-[13px] text-muted-foreground"><MetaLine items={[started&&(view.tone==='note'?t('timeline.added'):t('timeline.started'))+started,elapsed!==null&&(view.live?t('timeline.elapsed')+formatElapsed(elapsed):t('timeline.took')+formatElapsed(elapsed)),typeof item.attempt==='number'&&item.attempt>1&&t('timeline.attempts',{n:item.attempt}),item.tokens!==null&&item.tokens!==undefined&&t('timeline.tokens',{n:item.tokens.toLocaleString('ko-KR')}),item.activity&&view.tone==='live'&&t('timeline.activity')+item.activity]}/></small>
     {item.note&&<p className="m-0 whitespace-pre-wrap text-[13px]">{item.note}</p>}
     {item.error&&<p className="form-error m-0 text-[13px]">{item.error}</p>}
    </div>
   </li>;
  })}
 </ol></div>;
}
