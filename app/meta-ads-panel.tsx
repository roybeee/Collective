'use client';
import {Note} from '@/components/app/note';
import {metaSubGroup} from '@/lib/nav-state';
import {CardButton} from '@/components/app/card-button';
import {askConfirm} from '@/components/app/confirm-dialog';
import {lazy,Suspense,useEffect,useId,useRef,useState} from 'react';
import {ScreenSkeleton} from '@/components/app/screen-skeleton';
import {ArrowLeft,ArrowRight,Check,CheckCheck,CircleHelp,FileCheck2,ShoppingBag,Play,ShieldCheck} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Checkbox} from '@/components/ui/checkbox';
import {RadioGroup,RadioGroupItem} from '@/components/ui/radio-group';
import {NativeSelect} from '@/components/ui/native-select';
import {Tabs,TabsList,TabsTrigger,TabsContent} from '@/components/ui/tabs';
import {metaChecks,metaMoneyFields,metaTextFields,metaReadiness,parseMetaPlan,type MetaPlanInput,type MetaPlan} from '@/lib/meta-ads';
import s from './meta-ads-panel.module.css';
type View={input:MetaPlanInput;plan:MetaPlan|null;version:number;campaignVersion:number;canEdit:boolean;readiness:ReturnType<typeof metaReadiness>;links:{storeId:string|null;storeExperimentId:string|null}};
const steps=[{title:'판매 목표',hint:'어디에서 전환할까요?',fields:['landingUrl','storeStack']},{title:'상품과 수익',hint:'한 건을 팔면 얼마가 남나요?',fields:['product','price','unitCost','variableCost','taxBasis']},{title:'예산과 일정',hint:'어디까지 투자할까요?',fields:['totalBudget','dailyTarget','lossLimit','safetyReserve','startAt','endAt','stopRule']},{title:'준비 점검',hint:'운영과 측정을 확인하세요',fields:['accountLabel','attributionWindow',...Object.keys(metaChecks)]}] as const;
const labels:Record<string,string>={...metaTextFields,...metaMoneyFields,...metaChecks,taxBasis:'부가세 기준'};
const money=(n:number|null)=>n===null?'미입력':n.toLocaleString('ko-KR')+'원';
const message=(e:unknown)=>e instanceof Error?e.message:'불러오지 못했습니다.';
const checkHelp={inventory:'광고를 보고 구매할 고객에게 제공할 수 있는 수량입니다.',fulfillment:'배송 기간이나 예약 가능 시간, 담당자를 확인하세요.',refunds:'구매 전에 취소·환불 조건을 확인할 수 있어야 합니다.',rights:'사진, 영상, 음악과 상품의 사용 권한을 확인하세요.',measurement:'구매·문의 이후 결과를 확인할 위치를 정하세요.',consent:'고객의 동의와 데이터 처리 범위를 확인하세요.'};
// 하위 화면은 탭을 열 때 내려받는다(UX-PLAN-3 Q7). 첫 탭(실행 준비)은 이 파일에 있다.
const MetaExperimentPanel=lazy(()=>import('./meta-experiment-panel').then(m=>({default:m.MetaExperimentPanel})));
const MetaExecutionPanel=lazy(()=>import('./meta-execution-panel').then(m=>({default:m.MetaExecutionPanel})));
const MetaAdCreatePanel=lazy(()=>import('./meta-ad-create-panel').then(m=>({default:m.MetaAdCreatePanel})));
const MetaImageUploadPanel=lazy(()=>import('./meta-image-upload-panel').then(m=>({default:m.MetaImageUploadPanel})));
const MetaReservationPanel=lazy(()=>import('./meta-reservation-panel').then(m=>({default:m.MetaReservationPanel})));
const MetaAdBundlePanel=lazy(()=>import('./meta-ad-bundle-panel').then(m=>({default:m.MetaAdBundlePanel})));
const MetaBudgetPanel=lazy(()=>import('./meta-budget-panel').then(m=>({default:m.MetaBudgetPanel})));
const MetaConversionPanel=lazy(()=>import('./meta-conversion-panel').then(m=>({default:m.MetaConversionPanel})));
const MetaLearningPanel=lazy(()=>import('./meta-learning-panel').then(m=>({default:m.MetaLearningPanel})));
const MetaPausedPanel=lazy(()=>import('./meta-paused-panel').then(m=>({default:m.MetaPausedPanel})));
const MetaReportPanel=lazy(()=>import('./meta-report-panel').then(m=>({default:m.MetaReportPanel})));
const MetaInsightsPanel=lazy(()=>import('./meta-insights-panel').then(m=>({default:m.MetaInsightsPanel})));
const StorefrontOrdersPanel=lazy(()=>import('./storefront-orders-panel').then(m=>({default:m.StorefrontOrdersPanel})));
const MetaCreativePanel=lazy(()=>import('./meta-creative-panel').then(m=>({default:m.MetaCreativePanel})));
// 하위 탭은 주소(csub)에 남긴다(UX-PLAN-3 Q1, lib/nav-state.ts campaignSubs). 주소의 값은 처음 열 때만 쓴다.
export function MetaAdsPanel({campaignId,initialSub,onSubChange}:{campaignId:string;initialSub?:string;onSubChange?:(sub:string)=>void}){
 // 하위 탭 15개를 10개로 묶었다(UX-PLAN-3 1차원). 한 패널의 저장이 다른 패널을 다시 불러와야 하는 짝(집행↔예약, 실험 관측↔다음 실험)은 따로 둔다. 옛 주소 값(csub)은 묶인 탭으로 연다.
 const sub=metaSubGroup(initialSub)||'plan';
 return <Tabs defaultValue={sub} onValueChange={onSubChange} key={campaignId}><TabsList aria-label="Meta 작업" className="meta-tabs"><div role="none" className="meta-tab-group"><span className="meta-tab-step" aria-hidden="true">1 준비</span><TabsTrigger value="plan">실행 준비</TabsTrigger><TabsTrigger value="budget">예산·전환</TabsTrigger></div><div role="none" className="meta-tab-group"><span className="meta-tab-step" aria-hidden="true">2 소재·구성</span><TabsTrigger value="creative">소재·원본</TabsTrigger><TabsTrigger value="bundle">광고 구성·생성</TabsTrigger><TabsTrigger value="paused">비활성 초안</TabsTrigger></div><div role="none" className="meta-tab-group"><span className="meta-tab-step" aria-hidden="true">3 집행</span><TabsTrigger value="execution">집행·정지</TabsTrigger><TabsTrigger value="reservations">예산 예약</TabsTrigger></div><div role="none" className="meta-tab-group"><span className="meta-tab-step" aria-hidden="true">4 관측·학습</span><TabsTrigger value="insights">성과·대조</TabsTrigger><TabsTrigger value="experiments">실험 관측</TabsTrigger><TabsTrigger value="learning">다음 실험</TabsTrigger></div></TabsList><TabsContent value="plan"><MetaPlanPanel campaignId={campaignId}/></TabsContent><TabsContent value="budget" className="meta-stack"><Suspense fallback={<ScreenSkeleton/>}><MetaBudgetPanel campaignId={campaignId}/></Suspense><Suspense fallback={<ScreenSkeleton/>}><MetaConversionPanel campaignId={campaignId}/></Suspense></TabsContent><TabsContent value="creative" className="meta-stack"><Suspense fallback={<ScreenSkeleton/>}><MetaCreativePanel campaignId={campaignId}/></Suspense><Suspense fallback={<ScreenSkeleton/>}><MetaImageUploadPanel campaignId={campaignId}/></Suspense></TabsContent><TabsContent value="bundle" className="meta-stack"><Suspense fallback={<ScreenSkeleton/>}><MetaAdBundlePanel campaignId={campaignId}/></Suspense><Suspense fallback={<ScreenSkeleton/>}><MetaAdCreatePanel campaignId={campaignId}/></Suspense></TabsContent><TabsContent value="paused"><Suspense fallback={<ScreenSkeleton/>}><MetaPausedPanel campaignId={campaignId}/></Suspense></TabsContent><TabsContent value="execution"><Suspense fallback={<ScreenSkeleton/>}><MetaExecutionPanel campaignId={campaignId}/></Suspense></TabsContent><TabsContent value="reservations"><Suspense fallback={<ScreenSkeleton/>}><MetaReservationPanel campaignId={campaignId}/></Suspense></TabsContent><TabsContent value="insights" className="meta-stack"><Suspense fallback={<ScreenSkeleton/>}><MetaInsightsPanel campaignId={campaignId}/></Suspense><Suspense fallback={<ScreenSkeleton/>}><StorefrontOrdersPanel campaignId={campaignId}/></Suspense><Suspense fallback={<ScreenSkeleton/>}><MetaReportPanel campaignId={campaignId}/></Suspense></TabsContent><TabsContent value="experiments"><Suspense fallback={<ScreenSkeleton/>}><MetaExperimentPanel campaignId={campaignId}/></Suspense></TabsContent><TabsContent value="learning"><Suspense fallback={<ScreenSkeleton/>}><MetaLearningPanel campaignId={campaignId}/></Suspense></TabsContent></Tabs>;
}
function MetaPlanPanel({campaignId}:{campaignId:string}){
 const id=useId(),heading=useRef<HTMLHeadingElement>(null);
 const [view,setView]=useState<View|null>(null),[input,setInput]=useState<MetaPlanInput|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[loading,setLoading]=useState(true),[saved,setSaved]=useState(''),[dirty,setDirty]=useState(false),[retry,setRetry]=useState(0),[step,setStep]=useState(0);
 useEffect(()=>{const controller=new AbortController();void fetch('/api/meta-ads?campaignId='+encodeURIComponent(campaignId),{signal:controller.signal}).then(async r=>{const v=await r.json() as View & {error?:string};if(!r.ok)throw new Error(v.error||'조회 실패');return v as View}).then(v=>{setView(v);setInput(v.input);setDirty(false);setError('')}).catch(e=>{if(!controller.signal.aborted)setError(message(e))}).finally(()=>{if(!controller.signal.aborted)setLoading(false)});return()=>controller.abort()},[campaignId,retry]);
 async function save(){if(!view||!input)return;setBusy(true);setError('');setSaved('');try{const r=await fetch('/api/meta-ads',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'save_plan',campaignId,expectedVersion:view.version,campaignVersion:view.campaignVersion,input})});const v=await r.json() as View & {error?:string};if(!r.ok)throw new Error(v.error||'저장 실패');setView(v);setInput(v.input);setDirty(false);setSaved('준비 계획을 저장했습니다. 다음에 이어서 작성할 수 있습니다.')}catch(e){setError(message(e))}finally{setBusy(false)}}
 function change<K extends keyof MetaPlanInput>(key:K,value:MetaPlanInput[K]){setInput(old=>old?{...old,[key]:value}:old);setDirty(true);setSaved('');setError('')}
 function go(n:number){setStep(n);requestAnimationFrame(()=>heading.current?.focus())}
async  function reload(){if(!dirty||await askConfirm({title:'저장하지 않은 입력을 버리고 최신 계획을 불러올까요?',impact:'이 화면에서 저장하지 않은 입력이 사라지고 서버의 최신 계획으로 바뀝니다.',undo:'버린 입력은 되돌릴 수 없습니다.',confirmLabel:'버리고 불러오기'})){setLoading(true);setSaved('');setRetry(n=>n+1)}}
 if(!view||!input)return <section aria-label="Meta 광고 준비" className={s.root}><div className={s.empty}><FileCheck2 size={28}/>{error?<><p role="alert">{error}</p><Button onClick={reload}>다시 불러오기</Button></>:<ScreenSkeleton label="준비 계획을 불러오고 있습니다." rows={2}/>}</div></section>;
 const parsed=parseMetaPlan(input);
 const draft:MetaPlan={id:view.plan?.id??'',brandId:view.plan?.brandId??'',campaignId,campaignVersion:view.campaignVersion,version:view.version,input:parsed.input,updatedAt:'',updatedBy:{id:'',role:''}};
 const readiness=metaReadiness(draft,view.campaignVersion),invalid=parsed.errors;
 const missing=new Set(readiness.missing),counts=steps.map(x=>x.fields.filter(k=>!missing.has(labels[k])).length),total=steps.reduce((n,x)=>n+x.fields.length,0),done=counts.reduce((a,b)=>a+b,0);
 const next=counts.findIndex((n,i)=>n<steps[i].fields.length),disabled=busy||loading||!view.canEdit;
 const contribution=readiness.unitContribution,breakEven=contribution!==null&&contribution>0&&input.totalBudget!==null?Math.ceil(input.totalBudget/contribution):null;
 const textField=(key:keyof typeof metaTextFields,help:string,placeholder?:string)=>{const date=key.endsWith('At'),value=date&&input[key]&&Number.isFinite(Date.parse(input[key]))?new Date(Date.parse(input[key])+9*3600000).toISOString().slice(0,16):input[key];return <div className={s.field}><label htmlFor={`${id}-${key}`}>{metaTextFields[key]}</label><Input id={`${id}-${key}`} aria-describedby={`${id}-${key}-help`} type={date?'datetime-local':key==='landingUrl'?'url':'text'} maxLength={500} value={value} placeholder={placeholder} onChange={e=>change(key,date&&e.target.value?e.target.value+':00+09:00':e.target.value)}/><p id={`${id}-${key}-help`}>{help}</p></div>};
 const moneyField=(key:keyof typeof metaMoneyFields,help:string)=> <div className={s.field}><label htmlFor={`${id}-${key}`}>{metaMoneyFields[key]} <span>(원)</span></label><Input id={`${id}-${key}`} aria-describedby={`${id}-${key}-help`} type="number" inputMode="numeric" min={0} max={1e12} step={1} placeholder="금액 입력" value={input[key]??''} onChange={e=>change(key,e.target.value===''?null:Number(e.target.value))}/><p id={`${id}-${key}-help`}>{help}</p></div>;
 return <section aria-label="Meta 광고 준비" className={s.root} aria-busy={busy||loading}>
  <header className={s.header}><div><span className={s.eyebrow}>Meta 광고</span><h2>매출로 이어지는 광고 준비</h2><p>전환 경로부터 남는 이익까지, 실행 기준을 먼저 정하세요.</p></div><span className={s.badge}><FileCheck2 size={15}/>계획 단계</span></header>
  <nav aria-label="광고 준비 단계" className={s.steps}>{steps.map((x,i)=><CardButton key={x.title} type="button" aria-label={`${i+1}. ${x.title}`} aria-current={step===i?'step':undefined} onClick={()=>go(i)}><span className={s.stepNumber}>{counts[i]===x.fields.length?<Check size={16}/>:String(i+1).padStart(2,'0')}</span><span><b>{x.title}</b><small>{counts[i]} / {x.fields.length} 확인</small></span></CardButton>)}</nav>
  <form onSubmit={e=>{e.preventDefault();void save()}}>
   <div className={s.workspace}><div className={s.editor}>
    <div className={s.sectionHeading}><span>STEP {String(step+1).padStart(2,'0')}</span><h3 ref={heading} tabIndex={-1}>{steps[step].hint}</h3></div>
    <fieldset disabled={disabled} className={s.fields}><legend className={s.srOnly}>{steps[step].title} 입력</legend>
    {step===0&&<>
     <div className={s.field}><span id={`${id}-path-label`} className={s.label}>전환 경로</span><RadioGroup aria-labelledby={`${id}-path-label`} value={input.path} onValueChange={v=>change('path',v as MetaPlanInput['path'])} className={s.choices} disabled={disabled}>
      {[{value:'storefront',label:'자사몰 구매',description:'상품 페이지에서 구매로 연결',icon:ShoppingBag},{value:'content',label:'콘텐츠 기반',description:'콘텐츠에서 문의·구매로 연결',icon:Play}].map(x=><label key={x.value} className={s.choice} data-selected={input.path===x.value}><x.icon size={22}/><b>{x.label}</b><span>{x.description}</span><RadioGroupItem id={`${id}-${x.value}`} value={x.value} aria-label={x.label}/></label>)}
     </RadioGroup></div>
     <div className={s.field}><label htmlFor={`${id}-goal`}>목표</label><NativeSelect id={`${id}-goal`} value={input.goal} onChange={e=>change('goal',e.target.value as MetaPlanInput['goal'])}><option value="purchase">구매</option><option value="lead">문의·예약</option><option value="awareness">인지·참여</option></NativeSelect><p>{input.goal==='purchase'?'클릭 이후 실제 주문과 매출을 대조합니다.':'문의·조회·참여는 매출과 구분해서 평가합니다.'}</p></div>
     {textField('landingUrl','광고를 클릭한 고객이 도착할 공개 HTTPS 주소입니다. 추적 매개변수는 제외하세요.','https://your-store.com/product')}
     {textField('storeStack','구매 또는 문의 결과가 기록되는 곳입니다.','예: 카페24, 자사몰, 예약 페이지')}
    </>}
    {step===1&&<>
     {textField('product','이번 광고에서 제안할 상품과 혜택을 적으세요.','예: 첫 구매 고객을 위한 2인 세트')}
     <div className={s.twoColumns}>{moneyField('price','고객에게 받는 건당 판매 금액입니다.')}{moneyField('unitCost','상품 한 건의 원가입니다. 없으면 0을 입력하세요.')}{moneyField('variableCost','배송·결제 수수료 등 판매할 때 발생하는 비용입니다.')}<div className={s.field}><label htmlFor={`${id}-tax`}>부가세 기준</label><NativeSelect id={`${id}-tax`} value={input.taxBasis} onChange={e=>change('taxBasis',e.target.value as MetaPlanInput['taxBasis'])}><option value="unknown">아직 확인하지 않음</option><option value="included">포함</option><option value="excluded">제외</option></NativeSelect><p>판매가와 비용을 같은 기준으로 입력하세요.</p></div></div>
     <div className={s.insight}><CircleHelp size={18}/><p>광고비를 쓰기 전, 한 건을 팔아 남는 금액을 확인합니다. 환불·세금·제작비를 반영한 실제 순이익과는 다릅니다.</p></div>
    </>}
    {step===2&&<>
     <div className={s.twoColumns}>{moneyField('totalBudget','이번 실험 전체에 계획한 광고비입니다.')}{moneyField('dailyTarget','하루에 운영할 목표 금액입니다.')}{moneyField('lossLimit','이 금액의 손실에 도달하면 중단을 검토합니다.')}{moneyField('safetyReserve','집행 지연·추가 비용에 대비한 여유 금액입니다.')}{textField('startAt','한국 시간 (KST)')}{textField('endAt','한국 시간 (KST)')}</div>
     {textField('stopRule','지출·전환·손실을 기준으로 구체적으로 적으세요.','예: 3일간 구매가 없거나 손실 한도에 도달하면 중단')}
     <p className={s.note}>입력한 예산은 계획값입니다. 자동 중단이나 광고 계정의 청구 상한은 아직 설정되지 않습니다.</p>
    </>}
    {step===3&&<>
     {textField('accountLabel','구분할 수 있는 이름만 입력하세요. 비밀번호나 토큰은 입력하지 않습니다.','예: 브랜드 공식 광고 계정')}
     {textField('attributionWindow','광고를 본 뒤 얼마 동안 발생한 전환을 비교할지 정하세요.','예: 클릭 후 7일, 조회 후 1일')}
     <div className={s.checkList}>{(Object.keys(metaChecks) as (keyof typeof metaChecks)[]).map(k=><label key={k} className={s.checkRow}><Checkbox checked={input.checks[k]} onCheckedChange={v=>change('checks',{...input.checks,[k]:v===true})} aria-label={metaChecks[k]} disabled={disabled}/><span><b>{metaChecks[k]}</b><small>{checkHelp[k]}</small></span></label>)}</div>
     <p className={s.note}>체크는 운영자가 확인한 내용이며, 외부 서비스의 검증 결과는 아닙니다.</p>
    </>}
    </fieldset>
    <div className={s.stepFooter}><span>{step+1} / 4 단계</span><div>{step>0&&<Button type="button" variant="ghost" onClick={()=>go(step-1)}><ArrowLeft size={16}/>이전</Button>}{step<3&&<Button type="button" variant="outline" onClick={()=>go(step+1)}>다음 단계<ArrowRight size={16}/></Button>}</div></div>
   </div>
   <div role="group" className={s.summary} aria-label="계획 미리보기"><div className={s.summaryTitle}><h3>계획 미리보기</h3><span>{dirty?'저장 전 입력 기준':view.plan?'저장된 입력 기준':'입력 대기'}</span></div>
    <div className={s.progressHeading}><b>준비 항목</b><span>{done}<small> / {total}</small></span></div><progress value={done} max={total} aria-label="계획 입력 진행률"/>
    <div className={s.readinessGroups}>{steps.map((x,i)=><CardButton type="button" key={x.title} onClick={()=>go(i)}><span>{counts[i]===x.fields.length?<CheckCheck size={16}/>:<span className={s.groupNumber}>{i+1}</span>}{x.title}</span><b>{counts[i]===x.fields.length?'확인':`${x.fields.length-counts[i]}개 남음`}</b></CardButton>)}</div>
    <dl className={s.metrics}><div><dt>광고 전 건당 기여이익</dt><dd data-testid="meta-contribution">{money(contribution)}</dd></div><div><dt>총 광고 예산</dt><dd>{money(input.totalBudget)}</dd></div>{input.goal==='purchase'&&<div><dt>광고비 회수에 필요한 구매</dt><dd data-testid="meta-breakeven">{breakEven===null?'계산 대기':breakEven.toLocaleString()+'건'}</dd></div>}</dl>
    <p className={s.metricNote}>{input.goal==='purchase'?'판매가 − 원가 − 변동비 기준. 환불·세금·제작비 제외, 예상 계산이며 성과 보장이 아닙니다.':'매출 미검증 · 문의와 참여 수치를 실제 구매로 간주하지 않습니다.'}</p>
    {contribution!==null&&contribution<=0&&<p className={s.warning}>현재 입력으로는 판매 후 광고비를 감당할 여유가 없습니다. 가격과 비용을 다시 확인하세요.</p>}
    {next>=0?<CardButton type="button" className={s.nextAction} onClick={()=>go(next)}><span>다음 할 일<b>{steps[next].title} 채우기</b></span><ArrowRight size={18}/></CardButton>:<div className={s.complete}><Check size={18}/><span>{invalid.length||!readiness.planningComplete?'입력 내용을 다시 확인하세요':'계획 입력을 마쳤습니다'}<small>{invalid.length?invalid[0]:!readiness.planningComplete?readiness.missing.join(' · '):'저장 후 실행 준비를 이어갈 수 있습니다.'}</small></span></div>}
   </div></div>
   <footer className={s.saveBar}><div><b>{dirty?'저장하지 않은 변경사항이 있습니다':view.plan?'저장된 계획입니다':'작성 중에도 저장할 수 있습니다'}</b><span>{!view.canEdit?'계획 변경은 대표·관리자만 할 수 있습니다.':'빈 항목은 다음에 이어서 작성하세요.'}</span></div><div><Button type="button" variant="ghost" disabled={busy||loading} onClick={reload}>최신 계획 불러오기</Button><Button type="submit" disabled={disabled}>{busy?'저장 중…':loading?'불러오는 중…':'준비 계획 저장'}</Button></div></footer>
   {view.plan&&view.plan.campaignVersion!==view.campaignVersion&&<p className={s.warning}>캠페인이 변경되었습니다. 현재 브리프를 확인한 뒤 준비 계획을 다시 저장하세요.</p>}
   {error&&<p role="alert" className={s.error}>{error} 입력은 유지되었습니다. 충돌이 발생했다면 최신 계획을 불러와 확인하세요.</p>}{saved&&<p role="status" className={s.success}>{saved}</p>}
  </form>
  <div className={s.availability}><ShieldCheck size={20}/><div><h3>계획 저장으로 광고가 시작되지 않습니다</h3><Note className="">광고 성과 탭에서 계정을 읽기 연결하거나 성과 파일을 가져올 수 있습니다. 전환 전송·소재 검수·집행 승인은 별도 단계입니다.</Note></div></div>
 </section>;
}
