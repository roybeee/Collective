'use client';
// 실행 전 계획 카드(GLOBAL-PLAN X3). 비용이 드는 실행('AI 팀 이어서 실행'·'팀 회의 시작') 앞에 산출물·담당·예상 토큰(추정)·예상 소요·적용 규칙 수를 보여 주고,
// 카드의 주 버튼 하나를 눌러야 실행이 시작된다. 완료 뒤에는 같은 자리에 실제 토큰 대비 추정(outcome)을 보인다.
// 항목 제외 체크박스는 API가 부분 실행을 지원할 때만(onToggle이 있을 때만) 그린다.
import {useEffect,useId,useState} from 'react';
import {LoaderCircle,Play} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Checkbox} from '@/components/ui/checkbox';
import {StatList} from '@/components/app/stat-list';
import {MetaLine} from '@/components/app/meta-line';
import {ruleApplies,operatorRule,type LearningRule} from '@/lib/learning';
import {formatElapsed} from '@/lib/run-timeline';
import {compareTokens,formatTokens,type PlanEstimate,type PlanItem} from '@/lib/token-estimate';
import type {Campaign} from '@/lib/agency';
// 예상 비용 원화·크레딧 환산(QA D13): lib/billing.ts 자리 표시 가격(1크레딧=1,000토큰, 충전 단가)으로 추정한다. 가격은 대표 확정 전이라 '추정'과 안내를 함께 적는다.
import '@/lib/i18n/lazy';
import {useT} from '@/lib/i18n-react';
import {tokenCost} from '@/lib/usage-meter';

export const NO_DURATION_HISTORY='첫 실행이라 추정 불가';
export type PlanRules={learning:number|null;directives:number|null};
export type PlanOutcome={estimatedTokens:number;actualTokens:number|null;durationMs:number|null;title?:string};
type Props={title?:string;lead?:string;estimate:PlanEstimate;rules:PlanRules;excluded?:readonly string[];onToggle?:(id:string,included:boolean)=>void;primaryLabel:string;onApprove:()=>void;disabled?:boolean;disabledReason?:string;busy?:boolean;outcome?:PlanOutcome|null;children?:React.ReactNode};
const count=(n:number|null)=>n===null?'확인 중':`${n}건`;
export function PlanCard({title='실행 전 계획',lead='아래 내용을 확인하고 승인하면 시작합니다.',estimate,rules,excluded=[],onToggle,primaryLabel,onApprove,disabled,disabledReason,busy,outcome,children}:Props){
 const t=useT(),id=useId(),included=estimate.items.filter(i=>!excluded.includes(i.id)),total=included.reduce((n,i)=>n+i.estimatedTokens,0),cost=tokenCost(total);
 return <section className="plan-card notice flex-col items-stretch gap-3" aria-labelledby={id+'-title'} data-testid="plan-card">
  <div><h4 id={id+'-title'} className="m-0 text-[15px] font-semibold text-foreground">{title}</h4><p className="m-0 text-[13px]">{lead}</p></div>
  <StatList label="예상 비용과 적용 규칙" items={[['예상 토큰(추정)',formatTokens(total)],[t('plan.costLabel'),cost.krw===null?t('plan.costCredits',{credits:cost.credits.toLocaleString('ko-KR')}):t('plan.cost',{credits:cost.credits.toLocaleString('ko-KR'),krw:cost.krw.toLocaleString('ko-KR')})],['예상 소요',estimate.durationMs===null?NO_DURATION_HISTORY:'약 '+formatElapsed(estimate.durationMs)],['학습 규칙',count(rules.learning)],['상시 지시',count(rules.directives)]]}/>
  <ul className="m-0 grid list-none gap-1.5 p-0" aria-label="산출물과 담당">{estimate.items.map(item=><PlanRow key={item.id} item={item} included={!excluded.includes(item.id)} onToggle={onToggle}/>)}</ul>
  <small className="text-[12px] text-muted-foreground">토큰은 입력 길이와 최근 실행 평균으로 추정한 값이며 실제 사용량은 끝난 뒤 기록됩니다.{' '}{t('plan.costNote')}{estimate.samples>0?` 최근 실행 ${estimate.samples}건을 참고했습니다.`:''}</small>
  {children}
  <div className="flex flex-wrap items-center gap-2"><Button className="lime-button min-h-11" disabled={disabled||busy||!included.length} disabledReason={disabledReason??(!included.length?'실행할 항목을 하나 이상 남기세요.':undefined)} onClick={onApprove}>{busy?<LoaderCircle className="spin"/>:<Play/>}{primaryLabel}</Button></div>
  {outcome&&<PlanOutcomeLine outcome={outcome}/>}
 </section>;
}
function PlanRow({item,included,onToggle}:{item:PlanItem;included:boolean;onToggle?:(id:string,included:boolean)=>void}){
 const id=useId();
 return <li className="flex items-start gap-2 text-sm leading-6">
  {onToggle&&<Checkbox id={id} className="mt-1.5 size-5" checked={included} aria-label={item.name+' 포함'} onCheckedChange={v=>onToggle(item.id,v===true)}/>}
  <label htmlFor={onToggle?id:undefined} className="min-w-0 flex-1"><b>{item.name}</b><span className="block text-[13px] text-muted-foreground">{item.deliverable}</span><small className="block text-[12px] text-muted-foreground"><MetaLine items={[formatTokens(item.estimatedTokens)+' 추정',item.basis==='history'?'최근 평균 기준':'입력 길이 기준']}/></small></label>
 </li>;
}
// 완료 뒤 실제 토큰 대비 추정. 실제를 모르면 '미확인'으로 두고 0으로 바꾸지 않는다.
export function PlanOutcomeLine({outcome}:{outcome:PlanOutcome}){
 const c=compareTokens(outcome.estimatedTokens,outcome.actualTokens);
 return <div className="rounded-md border border-border bg-background px-3 py-2" role="status" data-testid="plan-outcome"><b className="text-[13px]">{outcome.title??'마지막 실행 결과'}</b>
  <StatList label="실제 토큰 대비 추정" items={[['실제 토큰',formatTokens(c.actual)],['추정',formatTokens(c.estimated)],['비율',c.ratio===null?'미확인':Math.round(c.ratio*100)+'%'],...(outcome.durationMs!==null?[['소요',formatElapsed(outcome.durationMs)] as const]:[])]}/>
  <small className="text-[12px] text-muted-foreground">{c.label}</small></div>;
}
type RulesSource={rules?:LearningRule[]};
// 적용되는 학습 규칙·상시 지시 수. 읽지 못하면 null로 두어 '확인 중'으로 보인다(숫자를 꾸미지 않는다).
export function usePlanRules(campaign:Pick<Campaign,'id'|'brandId'|'channels'|'storeId'>):PlanRules{
 const [rules,setRules]=useState<PlanRules>({learning:null,directives:null});
 useEffect(()=>{
  let live=true;
  const learning=fetch('/api/learning').then(async r=>{const d=await r.json() as RulesSource;if(!r.ok||!Array.isArray(d.rules))throw new Error('learning');return d.rules.filter(x=>operatorRule(x)?ruleApplies(x,campaign.brandId,campaign.channels,undefined,campaign.storeId,x.role):ruleApplies(x,campaign.brandId,campaign.channels,undefined,campaign.storeId)).length}).catch(()=>null);
  const directives=fetch('/api/directives?campaignId='+encodeURIComponent(campaign.id)).then(async r=>{const d=await r.json() as {directives?:unknown[]};if(!r.ok||!Array.isArray(d.directives))throw new Error('directives');return d.directives.length}).catch(()=>null);
  void Promise.all([learning,directives]).then(([l,d])=>{if(live)setRules({learning:l,directives:d})});
  return()=>{live=false};
 },[campaign.id,campaign.brandId,campaign.channels,campaign.storeId]);
 return rules;
}
