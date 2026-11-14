'use client';
// 사용량 미터(벤치마크 P11). 이번 달(한국 시간) 토큰 누계를 월 상한 대비 막대·글자로 보인다. 80% 이상 주의, 100% 이상 상한 도달(lib/usage-meter.ts).
// 홈 첫 로딩에 싣지 않는다(tests/ux-budget.json homeJsGzKB): 캠페인 상세 머리(app/panels.tsx, lazy)와 설정 사용량·비용 탭 머리에만 둔다.
// 값은 GET /api/usage?budget(view_usage 권한)에서만 읽는다. 권한이 없거나 읽지 못하면 아무것도 그리지 않는다(숫자를 꾸미지 않는다).
import '@/lib/i18n/lazy-campaign';
import {useEffect,useState} from 'react';
import {Gauge} from 'lucide-react';
import {useT} from '@/lib/i18n-react';
import {cn} from '@/lib/utils';
import {cssVars} from '@/lib/ui/css-vars';
import {meterOf,meterWidth,tokenCost,type MeterLine,type MeterState} from '@/lib/usage-meter';

type Budget={month:string;workspace:MeterLine;campaigns:(MeterLine&{campaignId:string})[]};
const bar:Record<MeterState,string>={ok:'bg-(--olive-42)',warn:'bg-(--yellow-35)',over:'bg-destructive',unset:'bg-muted-foreground',unknown:'bg-muted-foreground'};
export function UsageMeter({campaignId,className,budget:given}:{campaignId?:string;className?:string;budget?:Budget}){
 const t=useT(),[loaded,setBudget]=useState<Budget|null>(null),budget=given??loaded;
 useEffect(()=>{if(given)return;const controller=new AbortController();
  void fetch('/api/usage?budget=1',{signal:controller.signal,cache:'no-store',credentials:'same-origin'}).then(async r=>{const d=await r.json().catch(()=>({})) as {budget?:Budget};if(!controller.signal.aborted&&r.ok&&d.budget?.workspace)setBudget(d.budget)}).catch(()=>{});
  return()=>controller.abort()},[campaignId,given]);
 if(!budget)return null;
 const campaign=campaignId?budget.campaigns?.find(c=>c.campaignId===campaignId):undefined,view=meterOf(campaign??budget.workspace),scope=campaign?t('meter.campaign'):t('meter.workspace');
 const cost=tokenCost(view.total),status=t(('meter.state.'+view.state) as 'meter.state.ok',{percent:view.percent??0});
 return <div className={cn('grid min-w-0 gap-1 rounded-md border border-border bg-background px-3 py-2 text-[13px]',className)} data-testid="usage-meter" data-state={view.state}>
  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5"><Gauge size={15} aria-hidden/><b>{t('meter.title',{scope,month:budget.month})}</b><span className={cn(view.state==='over'&&'text-destructive font-semibold',view.state==='warn'&&'font-semibold')}>{status}</span></div>
  <div role="meter" aria-label={t('meter.title',{scope,month:budget.month})} aria-valuemin={0} aria-valuemax={100} aria-valuenow={meterWidth(view)} aria-valuetext={status} className="h-2 w-full overflow-hidden rounded-full bg-muted"><div className={cn('h-full w-(--meter)',bar[view.state])} ref={cssVars({'--meter':meterWidth(view)+'%'})}/></div>
  <small className="text-muted-foreground">{view.limit===null?t('meter.usedNoLimit',{used:view.total.toLocaleString('ko-KR')}):t('meter.used',{used:view.total.toLocaleString('ko-KR'),limit:view.limit.toLocaleString('ko-KR')})} {cost.krw===null?null:t('meter.cost',{credits:cost.credits.toLocaleString('ko-KR'),krw:cost.krw.toLocaleString('ko-KR')})}</small>
 </div>;
}
