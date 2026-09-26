'use client';

import Image from 'next/image';
import {useCallback,useEffect,useRef,useState} from 'react';
import {budgetLabel,campaignBudget,type Brand,type Campaign} from '@/lib/agency';
import {effectiveBrandFacts,type BrandFact} from '@/lib/brand-facts';
import {anonymousReachable,approvalBlockers,approvalDrift,approvalRequest,autoRefreshDue,budgetIssues,campaignGateIssues,creativeLabel,executionTotals,publicationLabels,publishSteps,reviewStatuses,uncertainResolvable,CREATIVE_TITLE_MAX,type ExecutionState,type Publication} from '@/lib/execution';
import {renderFactCard} from '@/lib/creative-render';
import {AI_DISCLOSURE_LINE,disclosureLine} from '@/lib/ai-disclosure';
import {factLabel} from '@/lib/fact-catalog';
import {costDetailLine,factHeading,footnoteLines,franchiseFactUseIssue,FRANCHISE_FACT_MESSAGES,type VersionState} from '@/lib/franchise-facts';
import type {Store} from '@/lib/store-marketing';
import {BrandFactsPanel} from './brand-facts-panel';
import {adminRequestNote} from './auth-client';
import {AdminOnly,canChange,useAccount} from './account-context';
import {reasonChoices} from '@/lib/review-decisions';
import {pushNav} from '@/lib/nav-state';

async function request<T=unknown>(path:string,input?:Record<string,unknown>):Promise<T>{
 const response=await fetch(path,input?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)}:undefined);
 const result=await response.json() as T & {error?:string};if(!response.ok)throw new Error(result.error||'처리하지 못했습니다.');return result;
}
type BufferChoices={token:string;organizations:{id:string;name:string}[];organizationId:string;channels:{id:string;name:string;paused:boolean}[]};
type ProviderAudit={providerAudit?:{providerId:string;message:string}};
type ActionResult=Partial<Publication>&ProviderAudit&{unreachable?:boolean};
// 트랙 R R1b: 가맹 브랜드의 정보공개서 버전 상태(GET /api/brand-facts franchise 블록). 카드 사실 선택의 비활성 사유와 각주 미리보기에 쓴다.
type FranchiseVersions={versions:{id:string;label:string;registeredAt:string|null;state:VersionState}[];disclaimer:string};
// PNG 항목·내용: 가맹 사실은 매장 유형·기준일을 항목에, 포함·불포함·면적을 내용 둘째 줄에 싣는다(서버 캡션 줄과 같은 규칙). 그 밖은 표준 라벨.
const cardFact=(f:BrandFact)=>f.sourceRef||f.cost?{...f,key:factHeading(f),value:f.cost?f.value+'\n'+costDetailLine(f.cost):f.value}:{...f,key:factLabel(f.key)};
// ux-2 권고 (3) '주문 장부 열기'의 이동 대상. 지점 캠페인은 목록을 기다리지 않고 그 지점의 주문 장부로 간다. 브랜드 공통 캠페인은 같은 브랜드의 운영 중 지점을 고른다
// (점포 마케팅은 운영 중 지점만 연다). 목록을 불러오는 중이면 loading, 운영 지점이 없으면 브랜드의 점포 마케팅으로 보낸다. 주소 이동은 pushNav(PR 5a)가 한다.
// tab:'ledger'는 지점 화면의 주문 장부 탭 값이다(lib/nav-state.ts storeTabs). 캠페인 지점이 보관됐거나 목록에 없으면 점포 마케팅이 다른 운영 지점을 대신 열므로
// 이동하지 않고 archived로 안내한다(서버도 보관 지점의 주문 기록을 409로 거절한다). 목록을 불러오는 중이면 기다리지 않고 이동한다.
export type LedgerNav={view:'stores';brand:string;store?:string;tab?:'ledger'};
export type LedgerTarget={kind:'store';nav:LedgerNav}|{kind:'archived'}|{kind:'choose';stores:{id:string;name:string}[]}|{kind:'loading'}|{kind:'none';nav:LedgerNav};
export const ledgerNav=(brand:string,store:string):LedgerNav=>({view:'stores',brand,store,tab:'ledger'});
export function orderLedgerTarget(campaign:Pick<Campaign,'brandId'|'storeId'>,stores:Pick<Store,'id'|'name'|'brandId'|'status'>[]|null):LedgerTarget{
 if(campaign.storeId)return !stores||stores.some(s=>s.id===campaign.storeId&&s.status==='active')?{kind:'store',nav:ledgerNav(campaign.brandId,campaign.storeId)}:{kind:'archived'};
 if(!stores)return {kind:'loading'};
 const open=stores.filter(s=>s.brandId===campaign.brandId&&s.status==='active').map(s=>({id:s.id,name:s.name}));
 return open.length?{kind:'choose',stores:open}:{kind:'none',nav:{view:'stores',brand:campaign.brandId}};
}
function OrderLedgerLink({campaign,stores,error,onRetry}:{campaign:Campaign;stores:Store[]|null;error:string;onRetry:()=>void}){
 const target=orderLedgerTarget(campaign,stores),[choice,setChoice]=useState('');
 if(target.kind==='store')return <button type="button" className="border rounded px-3 py-2" onClick={()=>pushNav(target.nav)}>주문 장부 열기</button>;
 if(target.kind==='archived')return <p role="note">이 캠페인의 지점은 보관됐거나 찾을 수 없어 주문 장부를 열 수 없습니다. 보관한 지점에는 주문을 기록할 수 없습니다.</p>;
 if(error)return <p role="alert">지점 목록을 불러오지 못했습니다: {error} <button type="button" className="underline" onClick={onRetry}>다시 시도</button></p>;
 if(target.kind==='loading')return <p role="status">지점 목록을 불러오고 있습니다.</p>;
 if(target.kind==='none')return <p>이 브랜드에 운영 중인 지점이 없습니다. 점포 마케팅에서 지점을 만든 뒤 주문을 기록하세요. <button type="button" className="underline" onClick={()=>pushNav(target.nav)}>점포 마케팅 열기</button></p>;
 const chosen=choice||(target.stores.length===1?target.stores[0].id:'');
 return <div className="flex flex-wrap gap-2 items-end"><label>주문 장부를 열 지점<select className="block border rounded p-2" value={chosen} onChange={e=>setChoice(e.target.value)}><option value="">지점을 선택하세요</option>{target.stores.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label><button type="button" className="border rounded px-3 py-2" disabled={!chosen} onClick={()=>pushNav(ledgerNav(campaign.brandId,chosen))}>주문 장부 열기</button></div>;
}
export function ExecutionPanel({campaign,brand}:{campaign:Campaign;brand:Brand}){
 const [state,setState]=useState<ExecutionState|null>(null),[facts,setFacts]=useState<BrandFact[]>([]),[selected,setSelected]=useState<string[]>([]),[franchise,setFranchise]=useState<FranchiseVersions|null>(null);
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[preview,setPreview]=useState('');
 const [rights,setRights]=useState<Record<string,boolean>>({}),[aiChecks,setAiChecks]=useState<Record<string,boolean>>({}),[buffer,setBuffer]=useState<BufferChoices|null>(null),[resolveIds,setResolveIds]=useState<Record<string,string>>({}),[cancelReasons,setCancelReasons]=useState<Record<string,string>>({});
 const [title,setTitle]=useState(''),[stores,setStores]=useState<Store[]|null>(null),[storesError,setStoresError]=useState(''),[storesTry,setStoresTry]=useState(0),[codeType,setCodeType]=useState('');
 // 관리자 전용 실행(app/api/execution/route.ts adminActions·코드 있는 발행 준비)은 직원에게 숨기고 안내한다. 판정은 서버가 한다.
 const canManage=canChange(useAccount()),autoChecked=useRef(false);
 const reload=useCallback(async()=>{
  const [next,ledger]=await Promise.all([request<ExecutionState>('/api/execution?campaignId='+encodeURIComponent(campaign.id)),request<{facts:BrandFact[];franchise?:FranchiseVersions}>('/api/brand-facts?brandId='+encodeURIComponent(campaign.brandId)+(campaign.storeId?'&storeId='+encodeURIComponent(campaign.storeId):''))]);
  setState(next);setFacts(effectiveBrandFacts(ledger.facts,campaign.brandId,campaign.storeId));setFranchise(ledger.franchise??null);setRights({});setAiChecks({});
 },[campaign.id,campaign.brandId,campaign.storeId]);
 useEffect(()=>{let active=true;void Promise.resolve().then(()=>{if(active)return reload()}).catch(e=>{if(active)setError(e.message)});return ()=>{active=false}},[reload]);
 // 게시 코드(A4-2)의 지점 선택·표시에 쓰는 같은 브랜드 지점 목록. null은 불러오는 중이다. 불러오지 못하면 오류와 다시 시도를 보이고, 지점 이름 대신 ID를 보인다.
 useEffect(()=>{let active=true;void request<{stores?:Store[]}>('/api/stores?brandId='+encodeURIComponent(campaign.brandId)).then(r=>{if(active){setStores(r.stores||[]);setStoresError('')}},e=>{if(active){setStores(null);setStoresError((e as Error).message)}});return ()=>{active=false}},[campaign.brandId,storesTry]);
 const retryStores=()=>{setStoresError('');setStoresTry(n=>n+1)};
 // 예약 시각 전후의 접수 건은 화면에 들어올 때 한 번 자동으로 상태를 다시 조회한다(최대 3건). 수동 조회 버튼은 그대로 둔다.
 useEffect(()=>{
  if(!state||autoChecked.current)return;autoChecked.current=true;
  const due=state.publications.filter(p=>autoRefreshDue(p)).slice(0,3);if(!due.length)return;
  void (async()=>{for(const p of due)await request('/api/execution',{action:'refresh',campaignId:campaign.id,id:p.id,version:p.version}).catch(()=>undefined);await reload()})().catch(e=>setError(e.message));
 },[state,campaign.id,reload]);
 async function perform<T>(work:()=>Promise<T>,message:string|((result:T)=>string)){
  setBusy(true);setError('');setNotice('');try{const result=await work();await reload();setNotice(typeof message==='function'?message(result):message)}catch(e){setError((e as Error).message)}finally{setBusy(false)}
 }
 const action=<T=unknown,>(name:string,data:Record<string,unknown>)=>request<T>('/api/execution',{action:name,campaignId:campaign.id,...data});
 const totals=executionTotals(state?.publications||[]),budget=campaignBudget(campaign);
 // 가맹 브랜드에서 카드에 쓸 수 없는 사실(H6 수익 항목·근거 없음·교체된 버전)의 사유. 서버도 같은 조건을 409로 막는다.
 const states=Object.fromEntries((franchise?.versions||[]).map(v=>[v.id,v.state])) as Record<string,VersionState>;
 // 서버가 계산한 사유(ExecutionState.franchise.blockedFacts, 트랙 R R2)를 먼저 쓰고, 없으면 버전 상태로 화면에서 계산한다.
 const serverBlocked=new Map((state?.franchise?.blockedFacts||[]).map(b=>[b.id,b.reason]));
 const blockReason=(f:BrandFact)=>{const known=serverBlocked.get(f.id);if(known)return known;if(!franchise)return '';const key=franchiseFactUseIssue(f,states);return key?FRANCHISE_FACT_MESSAGES[key]:''};
 // 가맹 규칙 판정(트랙 R R2·R3): 초안·승인 발행의 차단 사유와 경고. 판정 범위가 없는 캠페인(가맹 프로필 없는 브랜드의 소비자 캠페인)은 null이다.
 const franchiseOf=(p:Publication)=>state?.franchise?.publications[p.id]??null;
 const chosenNotes=franchise?footnoteLines(facts.filter(f=>selected.includes(f.id)),franchise.versions):[];
 async function createCard(){
  const chosen=facts.filter(f=>selected.includes(f.id));
  if(!chosen.length||chosen.length>4)throw new Error('유효한 확인 사실을 1~4개 선택하세요.');
  // PNG에도 내부 key 대신 표준 항목 라벨을 쓴다. 서버 캡션과 같은 규칙이다.
  const blocked=chosen.map(blockReason).find(Boolean);if(blocked)throw new Error(blocked);
  // 근거 있는 가맹 사실이 있으면 PNG에도 정보공개서 각주를 그린다(서버 캡션에는 서버가 붙인다).
  const footnote=footnoteLines(chosen,franchise?.versions||[]);if(footnote===null)throw new Error(FRANCHISE_FACT_MESSAGES.staleFact);
  const png=await renderFactCard(brand,chosen.map(cardFact),footnote);setPreview(png);
  // 소재 제목은 선택이다. 비우면 보내지 않는다(해시·캡션에 들어가지 않는다).
  const name=title.trim();
  await action('save_creative',{campaignVersion:campaign.version,factRefs:chosen.map(f=>({id:f.id,version:f.version})),png,...(name?{title:name}:{})});setTitle('');
 }
 function copyCode(code:string){setError('');void Promise.resolve().then(()=>navigator.clipboard.writeText(code)).then(()=>setNotice('게시 코드를 복사했습니다: '+code),()=>setError('복사하지 못했습니다. 코드를 직접 선택해 복사하세요.'))}
 function publicationAction(name:string,p:Publication){void perform(async():Promise<ActionResult>=>{const reason=(name==='cancel'||name==='reconfirm')&&cancelReasons[p.id];const r=await action<ActionResult>(name,{id:p.id,version:p.version,...(reason?{reasonCodes:[reason]}:{}),...(name==='approve'?approvalRequest(p,state,!!aiChecks[p.id]):{})});return name==='approve'&&r?.mediaMode==='auto'&&r.mediaUrl&&!await anonymousReachable(r.mediaUrl,window.location.origin)?{...r,unreachable:true}:r},r=>r?.unreachable?'승인했지만 공개 주소에 로그인 없이 접근할 수 없습니다. 이대로는 Buffer가 이미지를 가져가지 못합니다. 사이트 공개 설정을 확인하거나 고급: 외부 호스트를 쓰세요.':r?.providerAudit?`Buffer 게시 번호 ${r.providerAudit.providerId}: ${r.providerAudit.message}`:name==='execute'?'접수 결과를 확인하세요. 실제 게시 여부는 상태 조회로 확인합니다.':name==='reconfirm'?'초안으로 되돌렸습니다. 바뀐 항목을 확인하고 다시 승인하세요.':'상태를 갱신했습니다.')}
 function resolveMissing(p:Publication,restoreAttempt:boolean){
  if(!window.confirm(`Buffer에 이 예약이 없음을 확인했나요? 실패로 닫고 발행 시도 차감을 ${restoreAttempt?'되돌립니다':'유지합니다'}. 재전송하지 않습니다.`))return;
  void perform(()=>action('resolve_uncertain',{id:p.id,version:p.version,notFound:true,restoreAttempt}),'접수 여부를 실패로 확정했습니다.');
 }
 const saveDefaultLimits=()=>void perform(()=>action('save_limits',{maxPublications:1,maxPlannedCostKRW:0}),'기본 한도(발행 1회·0원)를 저장했습니다.');
 const steps=state?publishSteps(state,facts.length):[],currentStep=steps.findIndex(s=>!s.done);
 // 브랜드 공통 캠페인은 운영 지점을 골라야 코드를 발급한다. 목록을 불러오는 중·실패·운영 지점 0개면 초안 저장을 막고 상황에 맞는 안내를 보인다.
 const storeName=(id:string)=>stores?.find(s=>s.id===id)?.name||id,codeStores=(stores||[]).filter(s=>s.status==='active'),noCodeStore=!!codeType&&!campaign.storeId&&!codeStores.length;
 const reviews=state?.publications.filter(p=>p.needsReview&&reviewStatuses.includes(p.status))||[],submitted=state?.publications.filter(p=>['submitting','uncertain','accepted'].includes(p.status))||[];
 return <div className="execution-panel space-y-6">
  <div><h2 className="text-xl font-semibold">제작·발행</h2><p>확인된 브랜드 사실 → PNG 제작 → 승인 → Instagram 예약 접수 → 주문 귀속</p></div>
  {state&&<ol aria-label="첫 게시 단계" className="flex flex-wrap gap-2 text-sm">{steps.map((s,i)=><li key={s.label} aria-current={i===currentStep?'step':undefined} className={'rounded-full border px-3 py-1'+(i===currentStep?' font-semibold border-current':s.done?' opacity-70':'')}>{s.done?'✓ ':''}{s.label}</li>)}</ol>}
  {reviews.length>0&&<div role="alert" className="rounded-xl border p-4 space-y-2"><strong>사실 변경 확인 필요 {reviews.length}건</strong><ul className="space-y-1">{reviews.map(p=><li key={p.id}>{new Date(p.scheduledAt).toLocaleString()} 예약 · {publicationLabels[p.status]} · {p.status==='approved'?'같은 소재로 다시 승인할 수 없습니다. 이 발행을 취소하고 새 PNG로 새 초안을 만드세요.':'Buffer에서 취소 필요: 앱은 접수된 예약을 취소하지 않습니다.'}{p.providerId&&' · 게시 번호 '+p.providerId}<br/><small>{p.needsReview?.reason}</small></li>)}</ul></div>}
  <BrandFactsPanel campaign={campaign} onChanged={()=>{setPreview('');setSelected([]);void reload().catch(e=>setError(e.message))}}/>
  {error&&<p role="alert" className="form-error">{error}</p>}{notice&&<p role="status">{notice}</p>}
  {!state?<p>실행 상태를 불러오고 있습니다.</p>:<>
   <section className="rounded-xl border p-4 space-y-3"><h3 className="font-semibold">1. 안내 카드 만들기</h3>
    <p>현재 유효한 확인 사실만 사용합니다. 브랜드 이름·색이나 사용한 사실이 바뀌면 새 소재를 만들어야 합니다.</p>
    {facts.length?facts.map(f=>{const reason=blockReason(f);return <label key={f.id} className="flex gap-2 items-start"><input type="checkbox" checked={selected.includes(f.id)} disabled={busy||(!!reason&&!selected.includes(f.id))} onChange={e=>setSelected(ids=>e.target.checked?[...ids,f.id]:ids.filter(id=>id!==f.id))}/><span>{factLabel(f.key)}: {f.value} <small>v{f.version}</small>{reason&&<small className="block">카드에 쓸 수 없음 · {reason}</small>}</span></label>}):<p>위에서 근거와 유효기한이 있는 사실을 확정하세요.</p>}
    {!!chosenNotes?.length&&<div role="note" className="text-sm"><p>카드·캡션에 붙는 정보공개서 각주</p>{chosenNotes.map(n=><p key={n}>{n}</p>)}<p>{franchise?.disclaimer}</p></div>}
    <label>소재 제목 (선택)<input className="block border rounded p-2 w-full" value={title} maxLength={CREATIVE_TITLE_MAX} placeholder="예: 오픈 주소 안내 v1" disabled={busy} onChange={e=>setTitle(e.target.value)}/></label>
    <p className="text-sm">목록·발행 준비·주문 화면에서 소재를 구분하는 이름입니다({CREATIVE_TITLE_MAX}자 이하). PNG·캡션·해시에 들어가지 않습니다. 비우면 첫 사실 줄과 제작일로 표시합니다.</p>
    <button className="border rounded px-3 py-2" disabled={busy||!selected.length} onClick={()=>void perform(createCard,'1080×1080 PNG와 사실 버전을 저장했습니다.')}>PNG 제작·저장</button>
    {preview&&<Image unoptimized width={1080} height={1080} src={preview} alt="제작한 안내 카드 미리보기" className="w-64 rounded border"/>}
    <div className="grid gap-3">{state.creatives.map(c=><div key={c.id} className="border rounded p-3"><strong className="block">{creativeLabel(c)}</strong><Image unoptimized width={1080} height={1080} src={'/api/execution/asset?id='+encodeURIComponent(c.id)} alt={'저장된 소재 '+c.id} loading="lazy" className="w-40 rounded"/><p className="whitespace-pre-wrap">{c.caption}</p><small>브리프 v{c.campaignVersion} · 소재 {c.id}{c.current===false&&' · 입력이 바뀌어 발행에 쓸 수 없습니다'}</small><p><a className="underline" href={'/api/execution/asset?id='+encodeURIComponent(c.id)} download={c.pngHash+'.png'}>원본 PNG 내려받기</a></p><p className="break-all text-xs">공개 파일명: {c.pngHash}.png</p></div>)}</div>
   </section>
   <section className="rounded-xl border p-4 space-y-3"><h3 className="font-semibold">2. 채널 연결과 발행 횟수 한도</h3><p>발행 연결: {state.publisher.connected?state.publisher.account+' · '+state.publisher.channelId:'연결 필요'}</p>
    <AdminOnly note={'채널 연결과 발행 횟수 한도는 관리자만 바꿀 수 있습니다. '+adminRequestNote}>
     <form aria-label="Buffer 채널 연결" className="grid gap-2" onSubmit={e=>{e.preventDefault();const values=Object.fromEntries(new FormData(e.currentTarget));
      if(!buffer)void perform(async()=>{const token=String(values.token||'');setBuffer({token,...await action<Omit<BufferChoices,'token'>>('buffer_channels',{token})})},'조직과 Instagram 채널을 불러왔습니다. 연결할 채널을 고르세요.');
      else void perform(async()=>{await action('connect_buffer',{token:buffer.token,organizationId:buffer.organizationId,channelId:values.channelId,version:state.publisher.version});setBuffer(null)},'Instagram 채널을 확인해 연결했습니다. 기존 승인은 재확인해야 합니다.')}}>
      {!buffer?<><label>Buffer API 키<input className="block border rounded p-2 w-full" name="token" type="password" autoComplete="off" required/></label><button className="border rounded px-3 py-2" disabled={busy}>조직·채널 불러오기</button></>:<>
       <label>Buffer 조직<select className="block border rounded p-2 w-full" value={buffer.organizationId} disabled={busy} onChange={e=>{const organizationId=e.target.value;void perform(async()=>setBuffer({token:buffer.token,...await action<Omit<BufferChoices,'token'>>('buffer_channels',{token:buffer.token,organizationId})}),'조직의 Instagram 채널을 불러왔습니다.')}}>{buffer.organizations.map(o=><option key={o.id} value={o.id}>{o.name}</option>)}</select></label>
       {buffer.channels.length?<label>Instagram 채널<select className="block border rounded p-2 w-full" name="channelId" required defaultValue={buffer.channels.find(c=>!c.paused)?.id}>{buffer.channels.map(c=><option key={c.id} value={c.id} disabled={c.paused}>{c.name}{c.paused?' · Buffer에서 일시 중지됨':''}</option>)}</select></label>:<p>이 조직에는 연결된 Instagram 채널이 없습니다. Buffer에서 채널을 추가하거나 다른 조직을 고르세요.</p>}
       <div className="flex gap-2"><button className="border rounded px-3 py-2" disabled={busy||!buffer.channels.some(c=>!c.paused)}>채널 확인·연결</button><button type="button" className="border rounded px-3 py-2" disabled={busy} onClick={()=>setBuffer(null)}>API 키 다시 입력</button></div>
      </>}
     </form>
     {state.publisher.connected&&<button className="border rounded px-3 py-2" disabled={busy} onClick={()=>{if(window.confirm('Buffer 연결을 해제할까요? 저장된 API 키를 지우고, 이 브랜드의 승인된 발행은 초안으로 돌아갑니다. 이미 접수된 예약은 Buffer에서 따로 확인해야 합니다.'))void perform(()=>action('disconnect_buffer',{version:state.publisher.version}),'Buffer 연결을 해제했습니다. 승인된 발행은 초안으로 돌아갔습니다.')}}>Buffer 연결 해제</button>}
    </AdminOnly>
    <p>누적 발행 시도 {totals.attempts}회. 실패·접수 미확인 시도도 포함합니다(관리자가 미접수를 확인해 복원한 시도는 제외).</p>
    {budget!==null&&<p>캠페인 예산 {budgetLabel(campaign)}</p>}
    {!state.limits&&<p>발행 횟수 한도가 아직 없습니다. 한도가 없으면 발행을 승인할 수 없습니다.{canManage&&<> <button type="button" className="border rounded px-3 py-2" disabled={busy} onClick={saveDefaultLimits}>기본 한도(발행 1회·0원) 저장</button></>}</p>}
    {!canManage&&state.limits&&<ul aria-label="현재 발행 횟수 한도" className="text-sm list-disc pl-5"><li>캠페인 최대 발행 시도 {state.limits.maxPublications}회</li><li>누적 예정 비용 상한 {state.limits.maxPlannedCostKRW.toLocaleString()}원</li></ul>}
    {canManage&&<form key={state.limits?.version||0} className="grid gap-2" onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);void perform(()=>action('save_limits',{version:state.limits?.version,maxPublications:Number(f.get('maxPublications')),maxPlannedCostKRW:Number(f.get('maxPlannedCostKRW')),paused:f.get('paused')==='on'}),'한도를 저장했습니다. 한도를 낮추면 기존 승인은 재확인해야 합니다.')}}>
     <label>캠페인 최대 발행 시도<input className="block border rounded p-2" name="maxPublications" type="number" min="0" max="100" step="1" defaultValue={state.limits?.maxPublications??1} required/></label>
     <details open={(state.limits?.maxPlannedCostKRW??0)>0}><summary>예정 비용 상한 · 유료 부스트 연동 전까지 참고용</summary><div className="grid gap-2 pt-2">
      <p className="text-sm">Buffer 유기 게시는 건당 비용이 없어 이 상한이 막는 실제 비용은 없습니다. 입력한 예정 비용에만 적용됩니다.</p>
      <label>누적 예정 비용 상한 (원)<input className="block border rounded p-2" name="maxPlannedCostKRW" type="number" min="0" max={budget??0} step="1" defaultValue={state.limits?.maxPlannedCostKRW??0}/></label>
      <p className="text-sm">누적 예약 예정 비용 {totals.plannedCostKRW.toLocaleString()}원 · 캠페인 예산: {budgetLabel(campaign)}{budget===null?' · 예산을 확정하기 전에는 비용 상한을 0원으로만 저장할 수 있습니다.':' · 비용 상한은 예산을 넘을 수 없습니다.'}</p>
     </div></details>
     <label><input name="paused" type="checkbox" defaultChecked={state.limits?.paused}/> 새 발행 접수 중지</label><button className="border rounded px-3 py-2" disabled={busy}>한도 저장</button>
    </form>}<p className="text-sm">발행 횟수 한도는 아래 발행 시도에 적용됩니다. 예정 비용은 유료 부스트 연동 전까지 참고로 입력한 값에만 상한을 적용하며, AI 모델 요금·광고비의 실제 청구 상한이 아닙니다. 이미 Buffer에 접수한 예약은 Buffer에서 취소해야 합니다.</p>
    {state.limits?.paused&&<div role="status" className="rounded border p-3 space-y-1"><strong>새 발행 접수가 중지됐습니다.</strong> <span>이미 Buffer에 접수된 예약은 중지되지 않습니다. 아래 예약은 Buffer에서 취소 여부를 확인하세요.</span>{submitted.length?<ul aria-label="이미 접수된 예약">{submitted.map(p=><li key={p.id}>{new Date(p.scheduledAt).toLocaleString()} · {publicationLabels[p.status]}{p.providerId?' · 게시 번호 '+p.providerId:''}</li>)}</ul>:<p>이미 접수된 예약은 없습니다.</p>}</div>}
   </section>
   <section className="rounded-xl border p-4 space-y-3"><h3 className="font-semibold">3. 발행 준비·승인</h3>
    {state.franchise&&<div role="note" className="text-sm space-y-1"><p>{state.franchise.scope==='recruitment'?'가맹 모집 캠페인입니다. 캡션에 가맹 모집 규칙(모집 범위: 생산·판매 채널·직영 매장 인기 같은 표현 포함)을 적용합니다. 수익 보장·매출 수치 같은 해제 불가 표현은 대표 승인으로도 풀리지 않습니다.':'가맹 프로필이 있는 브랜드입니다. 캡션에 가맹 모집 규칙(소비자 캠페인 범위)을 적용합니다. 수익 보장·매출 수치 같은 해제 불가 표현은 대표 승인으로도 풀리지 않습니다.'}</p><p>{state.franchise.notice} {state.franchise.disclaimer}</p></div>}
    {state.franchise?.recruitmentWarning&&<p role="status" className="rounded border p-3 text-sm">{state.franchise.recruitmentWarning}</p>}
    <p>승인하면 앱이 이 PNG를 공개 주소(/media/해시.png)로 제공하고, Buffer는 그 주소에서 이미지를 가져갑니다. 앱 사이트가 공개(public) 상태일 때만 Buffer가 가져올 수 있어, 승인 직후 로그인 없이 접근되는지 확인합니다. 취소·실패하거나 초안으로 되돌리면 공개를 멈춥니다.</p>
    <form className="grid gap-2" onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget),copy=String(f.get('copy')||''),trackingCode=codeType?{type:codeType,...(campaign.storeId?{}:{storeId:String(f.get('codeStoreId')||'')})}:null;void perform(async()=>{const r=await action<Publication>('save_publication',{creativeId:f.get('creativeId'),mediaUrl:String(f.get('mediaUrl')||''),scheduledAt:new Date(String(f.get('scheduledAt'))).toISOString(),plannedCostKRW:Number(f.get('plannedCostKRW')),...(copy?{copy:JSON.parse(copy)}:{}),...(trackingCode?{trackingCode}:{})});setCodeType('');return r},r=>r?.trackingCode?`발행 초안을 저장했습니다. 게시 코드(${r.trackingCode.code})를 캡션 끝에 넣었습니다. 이미지와 계정·시각·비용을 확인해 승인하세요.`:'발행 초안을 저장했습니다. 이미지와 계정·시각·비용을 확인해 승인하세요.')}}>
     <label>발행할 소재<select className="block border rounded p-2 w-full" name="creativeId" required><option value="">선택하세요</option>{state.creatives.filter(c=>c.current!==false).map(c=><option key={c.id} value={c.id}>{creativeLabel(c)}</option>)}</select></label>
     <label>캡션 카피 (선택)<select className="block border rounded p-2 w-full" name="copy"><option value="">확인 사실 문구만 사용</option>{state.copies.filter(c=>!c.issues.length).map(c=><option key={c.artifactId+':'+c.index} value={JSON.stringify({artifactId:c.artifactId,artifactVersion:c.artifactVersion,index:c.index})}>{c.aiGenerated?'AI 생성물 · ':''}{c.text.slice(0,60)}</option>)}</select></label>
     <p className="text-sm">{!state.copyCaptions?'AI 작업물 카피를 캡션에 쓰는 기능은 대표가 AI 생성물 표시 문구(결정 17)를 확정할 때까지 꺼져 있습니다. 확인 사실 문구만 캡션으로 씁니다.':state.copies.length?'승인된 콘텐츠 작업물의 게시 카피를 확인 사실 문구 앞에 붙입니다. 금지·미확인 표현이 있는 카피는 고를 수 없습니다.':'승인된 콘텐츠 작업물의 게시 카피가 없어 확인 사실 문구만 캡션으로 씁니다.'}</p>
     {/* 결정 17: AI 카피를 고르면 사실 문구 뒤·게시 코드 줄 앞에 표시 줄이 붙는다. 문구는 lib/ai-disclosure.ts 상수(대표·법률 검토 전 초안)다. */}
     {state.copies.some(c=>c.aiGenerated&&!c.issues.length)&&<p className="text-sm">&apos;AI 생성물&apos; 카피를 고르면 캡션의 확인 사실 문구 뒤(게시 코드 줄 앞)에 다음 표시 줄을 붙입니다: &lsquo;{AI_DISCLOSURE_LINE}&rsquo; 승인할 때 &apos;AI 생성물 표시 확인&apos;을 체크해야 합니다.</p>}
     {state.copies.some(c=>c.issues.length)&&<details><summary>쓸 수 없는 카피 {state.copies.filter(c=>c.issues.length).length}개와 사유</summary><ul className="text-sm space-y-1">{state.copies.filter(c=>c.issues.length).map(c=><li key={c.artifactId+':'+c.index}>{c.text.slice(0,80)} — {c.issues.join(', ')}</li>)}</ul></details>}
     {state.copies.some(c=>!c.issues.length&&c.warnings?.length)&&<details><summary>확인이 필요한 카피 {state.copies.filter(c=>!c.issues.length&&c.warnings?.length).length}개(고를 수 있음)</summary><ul className="text-sm space-y-1">{state.copies.filter(c=>!c.issues.length&&c.warnings?.length).map(c=><li key={c.artifactId+':'+c.index}>{c.text.slice(0,80)} — {c.warnings!.join(', ')}</li>)}</ul></details>}
     <AdminOnly note={'게시 코드(쿠폰·POS 태그) 발급은 관리자만 할 수 있습니다. '+adminRequestNote}><fieldset className="grid gap-2 border rounded p-3"><legend>게시 코드 (선택)</legend>
      <label>코드 유형<select className="block border rounded p-2 w-full" name="codeType" value={codeType} disabled={busy} onChange={e=>setCodeType(e.target.value)}><option value="">코드 없이 준비</option><option value="coupon">쿠폰 코드</option><option value="pos_tag">POS 태그</option></select></label>
      {codeType&&(campaign.storeId?<p>코드 지점: {storeName(campaign.storeId)} (캠페인 지점)</p>:codeStores.length?<label>코드 지점<select className="block border rounded p-2 w-full" name="codeStoreId" required defaultValue=""><option value="">지점을 선택하세요</option>{codeStores.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label>:storesError?<p role="alert">지점 목록을 불러오지 못했습니다: {storesError} <button type="button" className="underline" disabled={busy} onClick={retryStores}>다시 시도</button></p>:stores===null?<p role="status">지점 목록을 불러오고 있습니다.</p>:<p role="alert">이 브랜드에 운영 중인 지점이 없습니다. 점포 마케팅에서 지점을 만든 뒤 코드를 쓰세요.</p>)}
      <p className="text-sm">코드를 고르면 이 발행에만 쓰는 추적 코드를 발급하고 캡션 끝에 &apos;주문할 때 …&apos; 안내 줄을 붙입니다. PNG에는 넣지 않습니다. 주문 장부에서 이 코드로 게시별 귀속 주문을 셉니다. 귀속 매출은 증분 효과가 아닙니다.</p>
     </fieldset></AdminOnly>
     <label>예약 시각 (이 기기의 현지 시각, 최소 5분 후, 캠페인 기간 {campaign.startDate&&campaign.endDate?campaign.startDate+'~'+campaign.endDate:'미확정'})<input className="block border rounded p-2" name="scheduledAt" type="datetime-local" required/></label>
     <details><summary>예정 비용 · 유료 부스트 연동 전까지 참고용</summary><div className="grid gap-2 pt-2"><p className="text-sm">Buffer 유기 게시는 건당 비용이 없어 0원 그대로 두면 됩니다. 유료 부스트를 따로 집행할 때만 참고로 입력하세요. 비워 두면 0원입니다. 0원보다 크게 입력하면 확정 예산과 예정 비용 상한 안에서만 승인·접수됩니다(기본 상한 0원).</p><label>이 발행의 예정 비용 (원)<input className="block border rounded p-2" name="plannedCostKRW" type="number" min="0" step="1" defaultValue="0"/></label></div></details>
     <details><summary>고급: 외부 호스트</summary><div className="grid gap-2 pt-2"><p className="text-sm">앱 공개 주소 대신 외부 호스트를 쓰려면 내려받은 PNG를 Cloudinary 또는 R2 공개 저장소에 해시 파일명 그대로 올리고 주소를 입력하세요. 승인과 실행 전에 원본과 같은 파일인지 확인합니다. 호스트의 파일을 덮어쓰거나 삭제하면 안 됩니다.</p><label>외부 공개 PNG 주소 (비우면 앱 공개 주소 사용)<input className="block border rounded p-2 w-full" name="mediaUrl" type="url" placeholder="https://…r2.dev/해시.png"/></label></div></details>
     <button className="border rounded px-3 py-2" disabled={busy||!state.creatives.some(c=>c.current!==false)||noCodeStore}>발행 초안 저장</button>
    </form>
    {!state.publications.length&&<p>아직 발행 이력이 없습니다.</p>}
    {state.publications.map(p=>{
     const creative=state.creatives.find(c=>c.id===p.creativeId),auto=p.mediaMode==='auto';
     const fr=franchiseOf(p),blockers=p.status==='draft'?approvalBlockers({campaign,publication:p,state,factCount:facts.length,rightsConfirmed:!!rights[p.id],aiDisclosureConfirmed:!!aiChecks[p.id],franchise:fr}):[];
     const drift=p.status==='approved'?[...approvalDrift(p,state.publisher.connected?state.publisher:null,state.limits),...(creative?.current===false?['소재 입력']:[])]:[],gate=p.status==='approved'?[...campaignGateIssues(campaign,p.scheduledAt),...budgetIssues(campaign,p.plannedCostKRW,state.limits),...(fr?.blockers||[])]:[];
     // 사용한 사실이나 소재 입력이 바뀌면 같은 소재로 다시 승인할 수 없다. 재확인 대신 취소 후 새 PNG로 안내한다.
     const restart=p.status==='approved'&&(!!p.needsReview||creative?.current===false);
     return <article key={p.id} className="border rounded p-4 space-y-2"><strong>{publicationLabels[p.status]}</strong>{p.copy?.aiGenerated&&<span className="ml-2 rounded-full border px-2 py-0.5 text-xs font-semibold">AI 생성물</span>}<Image unoptimized width={1080} height={1080} src={'/api/execution/asset?id='+encodeURIComponent(p.creativeId)} alt="승인 대상 PNG" className="w-40"/><p className="text-sm">소재: {creative?creativeLabel(creative):p.creativeId.slice(0,8)}</p><p className="whitespace-pre-wrap">{p.caption}</p>{p.copy?.aiGenerated&&<p className="text-sm">AI 생성물 표시 줄(캡션 끝, 게시 코드 줄 앞): {disclosureLine(p.copy)}{p.aiDisclosureConfirmedAt?' · 표시 확인 '+new Date(p.aiDisclosureConfirmedAt).toLocaleString():''}</p>}{p.trackingCode&&<p>게시 코드: <code>{p.trackingCode.code}</code> · {p.trackingCode.type==='coupon'?'쿠폰 코드':'POS 태그'} · {storeName(p.trackingCode.storeId)} <button type="button" className="border rounded px-2 py-1 text-sm" onClick={()=>copyCode(p.trackingCode!.code)}>코드 복사</button></p>}<p>계정: {p.channelId||state.publisher.channelId||'연결 필요'} · 예약: {new Date(p.scheduledAt).toLocaleString()} · 예정 비용: {p.plannedCostKRW.toLocaleString()}원</p><p className="break-all text-xs">{p.mediaUrl||(auto?'이미지 주소: 승인하면 앱 공개 주소가 채워집니다.':'')}</p>{p.providerId&&<p>공급자 게시 번호: {p.providerId} · 공급자 상태: {p.providerStatus}</p>}{p.error&&<p role="alert">{p.error}</p>}{p.invalidatedReason&&p.status==='draft'&&<p className="text-sm">이전 승인 종료: {p.invalidatedReason}</p>}
      {p.needsReview&&<p role="alert">{p.status==='approved'?'사실 변경 · 같은 소재로 다시 승인할 수 없습니다. 이 발행을 취소하고 새 PNG로 새 초안을 만드세요.':p.status==='published'?'사실 변경 · 이미 게시됐습니다. Instagram 게시물을 확인하세요.':['cancelled','failed'].includes(p.status)?'사실 변경 기록이 있습니다.':'사실 변경 · Buffer에서 취소 필요'}</p>}
      {!canManage&&['draft','approved','submitting','uncertain'].includes(p.status)&&<p className="subtle-note">발행 승인·Buffer 접수·취소·접수 확인은 관리자만 할 수 있습니다. {adminRequestNote}</p>}
      {canManage&&p.status==='draft'&&<><label className="flex gap-2 items-start"><input type="checkbox" checked={!!rights[p.id]} disabled={busy} onChange={e=>setRights(old=>({...old,[p.id]:e.target.checked}))}/><span>{auto?'PNG·문구·계정·예약 시각·비용 및 사용 권리를 확인했습니다. 승인하면 이 PNG를 앱 공개 주소로 제공합니다.':'PNG·문구·계정·예약 시각·비용 및 사용 권리를 확인했고, 공개 파일을 게시 완료까지 같은 내용으로 유지하겠습니다.'}</span></label>
       {p.copy?.aiGenerated&&<label className="flex gap-2 items-start"><input type="checkbox" checked={!!aiChecks[p.id]} disabled={busy} onChange={e=>setAiChecks(old=>({...old,[p.id]:e.target.checked}))}/><span>AI 생성물 표시 확인 · 이 캡션의 카피는 AI 작업물에서 왔으며, 캡션 끝에 &lsquo;{disclosureLine(p.copy)}&rsquo; 표시 줄이 붙는 것을 확인했습니다.</span></label>}
       <div className="flex flex-wrap gap-2 items-start"><button className="border rounded px-3 py-2" disabled={busy||blockers.length>0} onClick={()=>publicationAction('approve',p)}>이 버전 발행 승인</button>{!state.limits&&<button type="button" className="border rounded px-3 py-2" disabled={busy} onClick={saveDefaultLimits}>기본 한도(발행 1회·0원) 저장</button>}</div>
       {blockers.length>0&&<ul aria-label="승인 차단 사유" className="text-sm list-disc pl-5">{blockers.map(b=><li key={b}>{b}</li>)}</ul>}</>}
      {!!fr?.warnings.length&&['draft','approved'].includes(p.status)&&<div role="status" className="text-sm"><p>가맹 규칙 확인 (승인을 막지 않음)</p><ul className="list-disc pl-5">{fr.warnings.map(w=><li key={w}>{w}</li>)}</ul></div>}
      {canManage&&p.status==='approved'&&<>{drift.length>0&&<p role="alert">승인 뒤 바뀐 항목: {drift.join(', ')}. {restart?'이 발행을 취소하고 새 PNG로 새 초안을 만드세요.':'재확인으로 초안에 되돌린 뒤 다시 승인하세요.'}</p>}{gate.length>0&&<ul aria-label="접수 차단 사유" className="text-sm list-disc pl-5">{gate.map(b=><li key={b}>{b}</li>)}</ul>}<div className="flex flex-wrap gap-2"><button className="border rounded px-3 py-2" disabled={busy||drift.length>0||gate.length>0} onClick={()=>publicationAction('execute',p)}>승인된 예약을 Buffer에 접수</button>{drift.length>0&&!restart&&<button className="border rounded px-3 py-2" disabled={busy} onClick={()=>publicationAction('reconfirm',p)}>재확인 (초안으로 되돌리기)</button>}</div></>}
      {/* B1: 취소·재확인(초안으로 되돌리기) 사유는 선택이다. 고르면 발행 판정 로그에 사유 코드로 남는다. */}
      {canManage&&['draft','approved'].includes(p.status)&&<label className="block text-sm">취소·되돌림 사유 (선택)<select aria-label="취소·되돌림 사유" className="block border rounded p-2" value={cancelReasons[p.id]||''} disabled={busy} onChange={e=>setCancelReasons(old=>({...old,[p.id]:e.target.value}))}><option value="">선택 안 함</option>{reasonChoices('publication').map(r=><option key={r.code} value={r.code}>{r.label}</option>)}</select></label>}
      {canManage&&['draft','approved'].includes(p.status)&&<button className={'border rounded px-3 py-2 ml-2'+(restart?' font-semibold border-current':'')} disabled={busy} onClick={()=>publicationAction('cancel',p)}>{restart?'이 발행 취소 (새 PNG로 다시 준비)':'이 발행 취소'}</button>}
      {p.providerId&&<button className="border rounded px-3 py-2" disabled={busy} onClick={()=>publicationAction('refresh',p)}>실제 게시 상태 조회</button>}
      {['submitting','uncertain'].includes(p.status)&&<p>접수 여부를 Buffer에서 확인하세요. 중복 게시를 막기 위해 재전송을 차단했습니다.</p>}
      {canManage&&p.status==='submitting'&&!uncertainResolvable(p)&&<p className="text-sm">접수 처리 중입니다. Buffer 응답을 기다리는 중일 수 있어 접수 2분 뒤부터 확정할 수 있습니다. 잠시 후 새로고침하세요.</p>}
      {canManage&&uncertainResolvable(p)&&<div className="grid gap-2"><label>Buffer 게시 ID (Buffer에서 찾은 이 예약의 번호)<input className="block border rounded p-2 w-full" value={resolveIds[p.id]||''} disabled={busy} onChange={e=>setResolveIds(old=>({...old,[p.id]:e.target.value}))}/></label>
       <div className="flex flex-wrap gap-2"><button className="border rounded px-3 py-2" disabled={busy||!resolveIds[p.id]?.trim()} onClick={()=>void perform(()=>action('resolve_uncertain',{id:p.id,version:p.version,providerId:resolveIds[p.id].trim()}),'Buffer 게시와 채널을 확인해 상태를 확정했습니다.')}>게시 ID로 접수 확인</button><button className="border rounded px-3 py-2" disabled={busy} onClick={()=>resolveMissing(p,true)}>없음 확인 · 시도 차감 복원</button><button className="border rounded px-3 py-2" disabled={busy} onClick={()=>resolveMissing(p,false)}>없음 확인 · 시도 차감 유지</button></div></div>}
     </article>})}
   </section>
   <section className="rounded-xl border p-4 space-y-3"><h3 className="font-semibold">4. 주문 귀속</h3>
    <p>점포 마케팅의 {campaign.storeId&&stores?.some(s=>s.id===campaign.storeId)?storeName(campaign.storeId)+' ':''}주문 장부에서 주문에 이 캠페인과 소재를 선택하고 귀속 근거를 기록하세요. 귀속 주문은 인과 효과를 증명하지 않으며, 증분 효과는 별도 비교 실험이 필요합니다.</p>
    <OrderLedgerLink campaign={campaign} stores={stores} error={storesError} onRetry={retryStores}/>
   </section>
  </>}
 </div>;
}
