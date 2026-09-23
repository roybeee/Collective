'use client';

import Image from 'next/image';
import {useCallback,useEffect,useState} from 'react';
import type {Brand,Campaign} from '@/lib/agency';
import {effectiveBrandFacts,type BrandFact} from '@/lib/brand-facts';
import {executionTotals,publicationLabels,type ExecutionState,type Publication} from '@/lib/execution';
import {renderFactCard} from '@/lib/creative-render';
import {BrandFactsPanel} from './brand-facts-panel';
import {adminRequestNote,useCanManage} from './auth-client';

async function request<T=unknown>(path:string,input?:Record<string,unknown>):Promise<T>{
 const response=await fetch(path,input?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)}:undefined);
 const result=await response.json() as T & {error?:string};if(!response.ok)throw new Error(result.error||'처리하지 못했습니다.');return result;
}
export function ExecutionPanel({campaign,brand}:{campaign:Campaign;brand:Brand}){
 const [state,setState]=useState<ExecutionState|null>(null),[facts,setFacts]=useState<BrandFact[]>([]),[selected,setSelected]=useState<string[]>([]);
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[preview,setPreview]=useState('');
 const [rights,setRights]=useState<Record<string,boolean>>({});
 const canManage=useCanManage();
 const reload=useCallback(async()=>{
  const [next,ledger]=await Promise.all([request<ExecutionState>('/api/execution?campaignId='+encodeURIComponent(campaign.id)),request<{facts:BrandFact[]}>('/api/brand-facts?brandId='+encodeURIComponent(campaign.brandId)+(campaign.storeId?'&storeId='+encodeURIComponent(campaign.storeId):''))]);
  setState(next);setFacts(effectiveBrandFacts(ledger.facts,campaign.brandId,campaign.storeId));setRights({});
 },[campaign.id,campaign.brandId,campaign.storeId]);
 useEffect(()=>{let active=true;void Promise.resolve().then(()=>{if(active)return reload()}).catch(e=>{if(active)setError(e.message)});return ()=>{active=false}},[reload]);
 async function perform(work:()=>Promise<unknown>,message:string){
  setBusy(true);setError('');setNotice('');try{await work();await reload();setNotice(message)}catch(e){setError((e as Error).message)}finally{setBusy(false)}
 }
 const action=(name:string,data:Record<string,unknown>)=>request('/api/execution',{action:name,campaignId:campaign.id,...data});
 const totals=executionTotals(state?.publications||[]);
 async function createCard(){
  const chosen=facts.filter(f=>selected.includes(f.id));
  if(!chosen.length||chosen.length>4)throw new Error('유효한 확인 사실을 1~4개 선택하세요.');
  const png=await renderFactCard(brand,chosen);setPreview(png);
  await action('save_creative',{campaignVersion:campaign.version,factRefs:chosen.map(f=>({id:f.id,version:f.version})),png});
 }
 function publicationAction(name:string,p:Publication){void perform(()=>action(name,{id:p.id,version:p.version,...(name==='approve'?{confirmed:true,rightsConfirmed:true,immutableMediaConfirmed:true,channelId:state?.publisher.channelId,credentialVersion:state?.publisher.version,limitsVersion:state?.limits?.version}:{})}),name==='execute'?'접수 결과를 확인하세요. 실제 게시 여부는 상태 조회로 확인합니다.':'상태를 갱신했습니다.')}
 return <div className="execution-panel space-y-6">
  <div><h2 className="text-xl font-semibold">제작·발행</h2><p>확인된 브랜드 사실 → PNG 제작 → 승인 → Instagram 예약 접수 → 주문 귀속</p></div>
  <BrandFactsPanel campaign={campaign} onChanged={()=>{setPreview('');setSelected([]);void reload().catch(e=>setError(e.message))}}/>
  {error&&<p role="alert" className="form-error">{error}</p>}{notice&&<p role="status">{notice}</p>}
  {!state?<p>실행 상태를 불러오고 있습니다.</p>:<>
   <section className="rounded-xl border p-4 space-y-3"><h3 className="font-semibold">1. 안내 카드 만들기</h3>
    <p>현재 유효한 확인 사실만 사용합니다. 사실이나 브리프가 바뀌면 새 소재를 만들어야 합니다.</p>
    {facts.length?facts.map(f=><label key={f.id} className="flex gap-2 items-start"><input type="checkbox" checked={selected.includes(f.id)} disabled={busy} onChange={e=>setSelected(ids=>e.target.checked?[...ids,f.id]:ids.filter(id=>id!==f.id))}/><span>{f.key}: {f.value} <small>v{f.version}</small></span></label>):<p>위에서 근거와 유효기한이 있는 사실을 확정하세요.</p>}
    <button className="border rounded px-3 py-2" disabled={busy||!selected.length} onClick={()=>void perform(createCard,'1080×1080 PNG와 사실 버전을 저장했습니다.')}>PNG 제작·저장</button>
    {preview&&<Image unoptimized width={1080} height={1080} src={preview} alt="제작한 안내 카드 미리보기" className="w-64 rounded border"/>}
    <div className="grid gap-3">{state.creatives.map(c=><div key={c.id} className="border rounded p-3"><Image unoptimized width={1080} height={1080} src={'/api/execution/asset?id='+encodeURIComponent(c.id)} alt={'저장된 소재 '+c.id} loading="lazy" className="w-40 rounded"/><p className="whitespace-pre-wrap">{c.caption}</p><small>브리프 v{c.campaignVersion} · 소재 {c.id}</small><p><a className="underline" href={'/api/execution/asset?id='+encodeURIComponent(c.id)} download={c.pngHash+'.png'}>원본 PNG 내려받기</a></p><p className="break-all text-xs">공개 파일명: {c.pngHash}.png</p></div>)}</div>
   </section>
   <section className="rounded-xl border p-4 space-y-3"><h3 className="font-semibold">2. 채널 연결과 실행 한도</h3><p>발행 연결: {state.publisher.connected?state.publisher.account+' · '+state.publisher.channelId:'연결 필요'}</p>
    {canManage?<><form className="grid gap-2" onSubmit={e=>{e.preventDefault();const form=e.currentTarget,values=new FormData(form);void perform(async()=>{await action('connect_buffer',Object.fromEntries(values));form.reset()},'Instagram 채널을 확인해 연결했습니다. 기존 승인은 다시 받아야 합니다.')}}>
     <label>Buffer API 키<input className="block border rounded p-2 w-full" name="token" type="password" autoComplete="off" required/></label>
     <label>Buffer 조직 ID<input className="block border rounded p-2 w-full" name="organizationId" required/></label>
     <label>Instagram 채널 ID<input className="block border rounded p-2 w-full" name="channelId" required/></label>
     <button className="border rounded px-3 py-2" disabled={busy}>채널 확인·연결</button>
    </form></>:<p className="subtle-note">채널 연결과 실행 한도는 관리자만 바꿀 수 있습니다. {adminRequestNote}</p>}
    <p>누적 발행 시도 {totals.attempts}회 · 예약한 예정 비용 {totals.plannedCostKRW.toLocaleString()}원. 실패·접수 미확인 시도도 포함합니다.</p>
    {canManage&&<form key={state.limits?.version||0} className="grid gap-2" onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);void perform(()=>action('save_limits',{version:state.limits?.version,maxPublications:Number(f.get('maxPublications')),maxPlannedCostKRW:Number(f.get('maxPlannedCostKRW')),paused:f.get('paused')==='on'}),'한도를 저장했습니다. 이전 승인은 새 한도로 다시 준비해야 합니다.')}}>
     <label>캠페인 최대 발행 시도<input className="block border rounded p-2" name="maxPublications" type="number" min="0" max="100" step="1" defaultValue={state.limits?.maxPublications??1} required/></label>
     <label>누적 예정 비용 상한 (원)<input className="block border rounded p-2" name="maxPlannedCostKRW" type="number" min="0" step="1" defaultValue={state.limits?.maxPlannedCostKRW??0} required/></label>
     <label><input name="paused" type="checkbox" defaultChecked={state.limits?.paused}/> 새 발행 접수 중지</label><button className="border rounded px-3 py-2" disabled={busy}>한도 저장</button>
    </form>}<p className="text-sm">이 한도는 아래 발행 시도와 입력한 예정 비용에 적용됩니다. AI 모델 요금·광고비의 실제 청구 상한은 아닙니다. 이미 Buffer에 접수한 예약은 Buffer에서 취소해야 합니다.</p>
   </section>
   <section className="rounded-xl border p-4 space-y-3"><h3 className="font-semibold">3. 발행 준비·승인</h3>
    <p>내려받은 PNG를 Cloudinary 또는 R2 공개 저장소에 해시 파일명 그대로 올려 주세요. 승인과 실행 전에 원본과 같은 파일인지 확인합니다. 호스트의 파일을 덮어쓰거나 삭제하면 안 됩니다.</p>
    <form className="grid gap-2" onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);void perform(()=>action('save_publication',{creativeId:f.get('creativeId'),mediaUrl:f.get('mediaUrl'),scheduledAt:new Date(String(f.get('scheduledAt'))).toISOString(),plannedCostKRW:Number(f.get('plannedCostKRW'))}),'발행 초안을 저장했습니다. 이미지와 계정·시각·비용을 확인해 승인하세요.')}}>
     <label>발행할 소재<select className="block border rounded p-2 w-full" name="creativeId" required><option value="">선택하세요</option>{state.creatives.filter(c=>c.campaignVersion===campaign.version).map(c=><option key={c.id} value={c.id}>{c.caption.slice(0,60)} · {c.id.slice(0,8)}</option>)}</select></label>
     <label>공개 PNG 주소<input className="block border rounded p-2 w-full" name="mediaUrl" type="url" placeholder="https://…r2.dev/해시.png" required/></label>
     <label>예약 시각 (이 기기의 현지 시각, 최소 5분 후)<input className="block border rounded p-2" name="scheduledAt" type="datetime-local" required/></label>
     <label>이 발행의 예정 비용 (원)<input className="block border rounded p-2" name="plannedCostKRW" type="number" min="0" step="1" defaultValue="0" required/></label>
     <button className="border rounded px-3 py-2" disabled={busy||!state.creatives.length}>발행 초안 저장</button>
    </form>
    {!state.publications.length&&<p>아직 발행 이력이 없습니다.</p>}
    {state.publications.map(p=><article key={p.id} className="border rounded p-4 space-y-2"><strong>{publicationLabels[p.status]}</strong><Image unoptimized width={1080} height={1080} src={'/api/execution/asset?id='+encodeURIComponent(p.creativeId)} alt="승인 대상 PNG" className="w-40"/><p className="whitespace-pre-wrap">{p.caption}</p><p>계정: {p.channelId||state.publisher.channelId||'연결 필요'} · 예약: {new Date(p.scheduledAt).toLocaleString()} · 예정 비용: {p.plannedCostKRW.toLocaleString()}원</p><p className="break-all text-xs">{p.mediaUrl}</p>{p.providerId&&<p>공급자 게시 번호: {p.providerId} · 공급자 상태: {p.providerStatus}</p>}{p.error&&<p role="alert">{p.error}</p>}
     {!canManage&&['draft','approved'].includes(p.status)&&<p className="subtle-note">발행 승인·Buffer 접수·취소는 관리자만 할 수 있습니다. {adminRequestNote}</p>}
     {canManage&&p.status==='draft'&&<><label className="flex gap-2 items-start"><input type="checkbox" checked={!!rights[p.id]} disabled={busy} onChange={e=>setRights(old=>({...old,[p.id]:e.target.checked}))}/><span>PNG·문구·계정·예약 시각·비용 및 사용 권리를 확인했고, 공개 파일을 게시 완료까지 같은 내용으로 유지하겠습니다.</span></label><button className="border rounded px-3 py-2" disabled={busy||!rights[p.id]||!state.publisher.connected||!state.limits} onClick={()=>publicationAction('approve',p)}>이 버전 발행 승인</button></>}
     {canManage&&p.status==='approved'&&<button className="border rounded px-3 py-2" disabled={busy} onClick={()=>publicationAction('execute',p)}>승인된 예약을 Buffer에 접수</button>}
     {canManage&&['draft','approved'].includes(p.status)&&<button className="border rounded px-3 py-2 ml-2" disabled={busy} onClick={()=>publicationAction('cancel',p)}>이 발행 취소</button>}
     {p.providerId&&<button className="border rounded px-3 py-2" disabled={busy} onClick={()=>publicationAction('refresh',p)}>실제 게시 상태 조회</button>}
     {['submitting','uncertain'].includes(p.status)&&<p>접수 여부를 Buffer에서 확인하세요. 중복 게시를 막기 위해 재전송을 차단했습니다.</p>}
    </article>)}
   </section>
   <p>주문·매출 화면에서 주문에 이 캠페인과 소재를 선택하고 귀속 근거를 기록하세요. 귀속 주문은 인과 효과를 증명하지 않으며, 증분 효과는 별도 비교 실험이 필요합니다.</p>
  </>}
 </div>;
}
