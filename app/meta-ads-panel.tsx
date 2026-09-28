'use client';
import {useEffect,useState} from 'react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {metaChecks,metaMoneyFields,metaTextFields,type MetaPlanInput,type metaReadiness,type MetaPlan} from '@/lib/meta-ads';
type View={input:MetaPlanInput;plan:MetaPlan|null;version:number;campaignVersion:number;canEdit:boolean;readiness:ReturnType<typeof metaReadiness>;links:{storeId:string|null;storeExperimentId:string|null}};
const message=(e:unknown)=>e instanceof Error?e.message:'불러오지 못했습니다.';
export function MetaAdsPanel({campaignId}:{campaignId:string}){
 const [view,setView]=useState<View|null>(null),[input,setInput]=useState<MetaPlanInput|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[saved,setSaved]=useState(''),[dirty,setDirty]=useState(false),[retry,setRetry]=useState(0);
 useEffect(()=>{const controller=new AbortController();void fetch('/api/meta-ads?campaignId='+encodeURIComponent(campaignId),{signal:controller.signal}).then(async r=>{const v=await r.json() as View & {error?:string};if(!r.ok)throw new Error(v.error||'조회 실패');return v as View}).then(v=>{setView(v);setInput(v.input);setDirty(false);setError('')}).catch(e=>{if(!controller.signal.aborted)setError(message(e))});return()=>controller.abort()},[campaignId,retry]);
 async function save(){if(!view||!input)return;setBusy(true);setError('');setSaved('');try{const r=await fetch('/api/meta-ads',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'save_plan',campaignId,expectedVersion:view.version,campaignVersion:view.campaignVersion,input})});const v=await r.json() as View & {error?:string};if(!r.ok)throw new Error(v.error||'저장 실패');setView(v);setInput(v.input);setDirty(false);setSaved(`준비 계획 v${v.version}을 저장했습니다. 집행은 승인되지 않았습니다.`)}catch(e){setError(message(e))}finally{setBusy(false)}}
 function change<K extends keyof MetaPlanInput>(key:K,value:MetaPlanInput[K]){setInput(old=>old?{...old,[key]:value}:old);setDirty(true);setSaved('')}
 if(!view||!input)return <section aria-label="Meta 광고 준비">{error?<><p role="alert">{error}</p><Button onClick={()=>setRetry(n=>n+1)}>다시 불러오기</Button></>:<p>광고 준비 계획을 불러옵니다…</p>}</section>;
 return <section aria-label="Meta 광고 준비" className="space-y-5">
  <div><h2>Meta 광고 준비</h2><p>상품과 전환 경로를 정하고, 실제 구매와 남는 이익을 측정할 준비를 합니다. 현재는 계획 저장 단계이며 계정 연결·광고 집행은 지원하지 않습니다.</p></div>
  <p className="notice">모든 금액은 KRW 원 단위, 기간은 한국 시간입니다. 빈 금액은 미확인입니다. 입력은 운영자 확인 사항이며 외부 검증 결과가 아닙니다.</p>
  <form onSubmit={e=>{e.preventDefault();void save()}} className="space-y-4">
   <fieldset disabled={busy||!view.canEdit} className="grid gap-4 sm:grid-cols-2"><legend>판매 목표와 실행 범위</legend>
    <label>전환 경로<select value={input.path} onChange={e=>change('path',e.target.value as MetaPlanInput['path'])}><option value="storefront">자사몰 구매</option><option value="content">콘텐츠 기반</option></select></label>
    <label>목표<select value={input.goal} onChange={e=>change('goal',e.target.value as MetaPlanInput['goal'])}><option value="purchase">구매</option><option value="lead">문의·예약</option><option value="awareness">인지·참여</option></select></label>
    {(Object.keys(metaTextFields) as (keyof typeof metaTextFields)[]).map(k=><label key={k}>{metaTextFields[k]}<Input type={k.endsWith('At')?'datetime-local':k==='landingUrl'?'url':'text'} maxLength={500} value={k.endsWith('At')&&input[k]?new Date(Date.parse(input[k])+9*3600000).toISOString().slice(0,16):input[k]} onChange={e=>change(k,k.endsWith('At')&&e.target.value?e.target.value+':00+09:00':e.target.value)}/></label>)}
    {(Object.keys(metaMoneyFields) as (keyof typeof metaMoneyFields)[]).map(k=><label key={k}>{metaMoneyFields[k]} (원)<Input type="number" min={0} max={1e12} step={1} placeholder="미확인" value={input[k]??''} onChange={e=>change(k,e.target.value===''?null:Number(e.target.value))}/></label>)}
    <label>부가세 기준<select value={input.taxBasis} onChange={e=>change('taxBasis',e.target.value as MetaPlanInput['taxBasis'])}><option value="unknown">미확인</option><option value="included">포함</option><option value="excluded">제외</option></select></label>
   </fieldset>
   <fieldset disabled={busy||!view.canEdit} className="grid gap-3"><legend>운영자가 확인한 준비 사항</legend>{(Object.keys(metaChecks) as (keyof typeof metaChecks)[]).map(k=><label key={k}><input type="checkbox" checked={input.checks[k]} onChange={e=>change('checks',{...input.checks,[k]:e.target.checked})}/> {metaChecks[k]}</label>)}</fieldset>
   <p className="subtle-note">광고 계정은 별칭만 입력하세요. 토큰·비밀번호·고객 정보는 입력하지 마세요. 예산 계획은 청구 상한 보장이나 집행 승인이 아닙니다.</p>
   {error&&<p role="alert">{error}</p>}{saved&&<p role="status">{saved}</p>}
   <div className="flex gap-2"><Button type="submit" disabled={busy||!view.canEdit}>{busy?'저장 중…':'준비 계획 저장'}</Button><Button type="button" variant="outline" disabled={busy} onClick={()=>{if(!dirty||window.confirm('저장하지 않은 입력을 버리고 최신 계획을 불러올까요?'))setRetry(n=>n+1)}}>최신 계획 불러오기</Button></div>
   {!view.canEdit&&<p>계획 변경은 대표·관리자만 할 수 있습니다.</p>}
  </form>
  <div className="space-y-3"><h3>저장된 계획 준비도 · v{view.version}</h3>{dirty&&<p>편집 내용은 저장 후 준비도에 반영됩니다.</p>}
   <p>{view.readiness.planningComplete?'계획 입력 완료 · 외부 검증 대기':'추가 확인 필요'} · {view.readiness.salesEvidence}</p>
   {!!view.readiness.missing.length&&<ul>{view.readiness.missing.map(x=><li key={x}>{x}</li>)}</ul>}
   <p>건당 광고 전 기여이익: {view.readiness.unitContribution===null?'원가·변동비 미확인':view.readiness.unitContribution.toLocaleString()+'원'} (입력 기준, 광고·제작비 차감 전)</p>
   <p>주문 원장: {view.links.storeId?'캠페인의 기존 지점 장부 참조':'브랜드 캠페인 범위 · 지점 연결 필요'} · 실험: {view.links.storeExperimentId?'기존 점포 실험 참조':'미연결'}</p>
   <h3>집행 차단 사유</h3><ul>{view.readiness.blockers.map(x=><li key={x}>{x}</li>)}</ul><Button disabled>광고 집행 · 준비 중</Button>
  </div>
 </section>;
}
