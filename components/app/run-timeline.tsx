'use client';
// 실행 타임라인(GLOBAL-PLAN X2). 회의 단계와 역할 실행을 같은 모양으로 그린다: 상태 아이콘+글자 라벨(색만으로 구분하지 않음), 시작 시각, 경과(진행 중은 1초마다), 시도 수, 토큰.
// 컨테이너는 role="log" aria-live="polite"로 새 항목·상태 변화를 화면 읽기 프로그램에 알린다. 모르는 상태는 '상태 미확인'으로 그린다(lib/run-timeline.ts).
import {useEffect,useState} from 'react';
import {Ban,CircleCheck,CircleQuestionMark,CircleX,Clock,Hand,LoaderCircle} from 'lucide-react';
import {MetaLine} from '@/components/app/meta-line';
import {cn} from '@/lib/utils';
import {elapsedMs,formatElapsed,hasLive,statusView,type TimelineItem,type TimelineTone} from '@/lib/run-timeline';

const icons:Record<TimelineTone,React.ComponentType<{size?:number;className?:string;'aria-hidden'?:boolean}>>={idle:Clock,live:LoaderCircle,wait:Hand,done:CircleCheck,fail:CircleX,stop:Ban,unknown:CircleQuestionMark};
const tones:Record<TimelineTone,string>={idle:'text-muted-foreground',live:'text-foreground',wait:'text-amber-700',done:'text-emerald-700',fail:'text-destructive',stop:'text-muted-foreground',unknown:'text-muted-foreground'};
const clock=(s:string|null|undefined)=>{const t=s?Date.parse(s):NaN;return Number.isFinite(t)?new Date(t).toLocaleTimeString('ko-KR',{timeZone:'Asia/Seoul',hour:'2-digit',minute:'2-digit',second:'2-digit'}):null};
// 진행 중 항목이 있으면 1초마다 다시 그려 경과를 살린다. now를 넘기면(테스트) 시계를 돌리지 않는다.
function useTicker(active:boolean,fixed?:number){
 const [now,setNow]=useState(()=>fixed??Date.now());
 useEffect(()=>{if(fixed!==undefined||!active)return;const t=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(t)},[active,fixed]);
 return fixed??now;
}
export function RunTimeline({items,label,now:fixedNow,className}:{items:readonly TimelineItem[];label:string;now?:number;className?:string}){
 const now=useTicker(hasLive(items),fixedNow);
 if(!items.length)return null;
 return <ol role="log" aria-live="polite" aria-label={label} className={cn('run-timeline grid gap-2 m-0 p-0 list-none',className)}>
  {items.map(item=>{
   const view=statusView(item.status,item.phase),Icon=icons[view.tone],elapsed=elapsedMs(item,now),started=clock(item.startedAt);
   return <li key={item.id} data-status={item.status} className="flex items-start gap-3 rounded-md border border-border bg-background px-3 py-2.5 min-h-11">
    <span className={cn('mt-0.5 shrink-0',tones[view.tone])}><Icon size={18} className={view.live&&view.tone==='live'?'spin':undefined} aria-hidden/></span>
    <div className="min-w-0 flex-1 text-sm leading-6">
     <div className="flex flex-wrap items-baseline gap-x-2"><b className={tones[view.tone]}>{view.label}</b><span>{item.title}</span>{item.subtitle&&<span className="text-muted-foreground text-[13px]">{item.subtitle}</span>}</div>
     <small className="block text-[13px] text-muted-foreground"><MetaLine items={[started&&'시작 '+started,elapsed!==null&&(view.live?'경과 '+formatElapsed(elapsed):'소요 '+formatElapsed(elapsed)),typeof item.attempt==='number'&&item.attempt>1&&`시도 ${item.attempt}회`,item.tokens!==null&&item.tokens!==undefined&&`토큰 ${item.tokens.toLocaleString('ko-KR')}`,item.activity&&view.tone==='live'&&'활동 '+item.activity]}/></small>
     {item.error&&<p className="form-error m-0 text-[13px]">{item.error}</p>}
    </div>
   </li>;
  })}
 </ol>;
}
