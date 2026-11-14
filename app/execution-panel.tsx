'use client';
import {t} from '@/lib/i18n';
import {useT} from '@/lib/i18n-react';
import '@/lib/i18n/lazy';
import {EmptyLine} from '@/components/app/empty-line';
import {CheckInput} from '@/components/app/check';
import {NativeSelect} from '@/components/ui/native-select';
import {Input} from '@/components/ui/input';
import {Button} from '@/components/ui/button';
import {askConfirm} from '@/components/app/confirm-dialog';

import Image from 'next/image';
import {Suspense,lazy,useCallback,useEffect,useId,useRef,useState} from 'react';
import {budgetLabel,campaignBudget,type Brand,type Campaign} from '@/lib/agency';
import {effectiveBrandFacts,type BrandFact} from '@/lib/brand-facts';
import {anonymousReachable,approvalBlockers,approvalDrift,approvalRequest,autoRefreshDue,budgetIssues,campaignGateIssues,codeLabel,codedPngApproval,creativeLabel,executionTotals,publicationLabels,publishSteps,reviewStatuses,uncertainResolvable,CREATIVE_TITLE_MAX,type ExecutionState,type Publication} from '@/lib/execution';
import {renderCodedCard,renderFactCard} from '@/lib/creative-render';
import {AI_DISCLOSURE_LINE,disclosureLine} from '@/lib/ai-disclosure';
import {factLabel} from '@/lib/fact-catalog';
import {costDetailLine,factHeading,footnoteLines,franchiseFactUseIssue,FRANCHISE_FACT_MESSAGES,type VersionState} from '@/lib/franchise-facts';
import type {Store} from '@/lib/store-marketing';
import {BrandFactsPanel} from './brand-facts-panel';
import {adminRequestNote} from './auth-client';
import {AdminOnly,adminOnlyNote,canChange,useAccessCheck,useAccount} from './account-context';
import {reasonChoices} from '@/lib/review-decisions';
import {pushNav} from '@/lib/nav-state';
import {ExperimentLinkSelect,PublicationExperiment,experimentChoice,type ExperimentOption} from './publication-experiment';
import {ScreenSkeleton} from '@/components/app/screen-skeleton';
import {MetaLine} from '@/components/app/meta-line';
import {dateTime,metaText,money} from '@/lib/format';
import {Textarea} from '@/components/ui/textarea';
import {CaptionViews,ChannelPreview} from '@/components/app/channel-preview';
import {SelectionToolbar,readSelection,useRewriteAvailable,type TextRange} from '@/components/app/selection-toolbar';
import {previewChannelFor} from '@/lib/text-bytes';
import {mediaSetApproval} from '@/lib/execution-media-set';
// C3 후속: 캐러셀·릴스 묶음과 직접 게시 결과 미확인 대조는 지연 로딩한다(app/publication-media-set.tsx).
const PublicationMediaSet=lazy(()=>import('./publication-media-set').then(m=>({default:m.PublicationMediaSet})));

async function request<T=unknown>(path:string,input?:Record<string,unknown>):Promise<T>{
 const response=await fetch(path,input?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)}:undefined);
 const result=await response.json() as T & {error?:string};if(!response.ok)throw new Error(result.error||t('exec.failed'));return result;
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
function OrderLedgerLink({campaign,stores,error,onRetry}:{campaign:Campaign;stores:Store[]|null;error:string;onRetry:()=>void}){useT();
 const target=orderLedgerTarget(campaign,stores),[choice,setChoice]=useState('');
 if(target.kind==='store')return <Button type="button" variant="outline" size="fit" onClick={()=>pushNav(target.nav)}>{t('exec.ledger.open')}</Button>;
 if(target.kind==='archived')return <p role="note">{t('exec.ledger.archived')}</p>;
 if(error)return <p role="alert">{t('exec.stores.loadFailed')} {error} <Button type="button" variant="link" size="fit" className="min-h-0 p-0 underline" onClick={onRetry}>{t('exec.retry')}</Button></p>;
 if(target.kind==='loading')return <ScreenSkeleton label={t('exec.stores.loading')} rows={2}/>;
 if(target.kind==='none')return <p>{t('exec.stores.none')} <Button type="button" variant="link" size="fit" className="min-h-0 p-0 underline" onClick={()=>pushNav(target.nav)}>{t('exec.stores.openMarketing')}</Button></p>;
 const chosen=choice||(target.stores.length===1?target.stores[0].id:'');
 return <div className="flex flex-wrap gap-2 items-end"><label>{t('exec.ledger.store')}<NativeSelect className="block border rounded p-2" value={chosen} onChange={e=>setChoice(e.target.value)}><option value="">{t('exec.stores.pick')}</option>{target.stores.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</NativeSelect></label><Button type="button" variant="outline" size="fit" disabled={!chosen} disabledReason={!chosen?t('exec.pickTarget'):undefined} onClick={()=>pushNav(ledgerNav(campaign.brandId,chosen))}>{t('exec.ledger.open')}</Button></div>;
}
// X6 캡션 편집기: 이 화면에서만 글을 다듬고 채널 모양으로 본다(저장 없음). 스위치 selection_rewrite가 켜진 소유자·관리자에게는 글을 고르면 다시 쓰기 막대가 보인다.
function CaptionEditor({campaign,brand,channel,account,seed,imageUrl}:{campaign:Campaign;brand:Brand;channel:'instagram'|'threads';account:string;seed:string;imageUrl?:string}){useT();
 const [text,setText]=useState(seed),[range,setRange]=useState<TextRange|null>(null),rewrite=useRewriteAvailable(),inputId=useId();
 // 고른 범위는 선택 이벤트와 키·마우스·터치를 뗄 때 다시 읽는다(브라우저마다 선택 이벤트 시점이 달라서).
 const pick=(e:{currentTarget:HTMLTextAreaElement})=>setRange(readSelection(e.currentTarget));
 return <section aria-label={t('exec.caption.editor')} className="caption-editor space-y-2"><h4 className="font-semibold">{t('exec.caption.title')}</h4>
  <p className="text-sm">{t('exec.caption.lead')}{rewrite?t('exec.caption.rewriteHint'):''}</p>
  <label className="block" htmlFor={inputId}>{t('exec.caption.editor')}</label><Textarea id={inputId} rows={5} value={text} onChange={e=>{setText(e.target.value);setRange(null)}} onSelect={pick} onKeyUp={pick} onMouseUp={pick} onTouchEnd={pick}/>
  {rewrite&&<SelectionToolbar campaignId={campaign.id} channel={channel} text={text} range={range} where={metaText([brand.name,campaign.title,t('exec.caption.editorTitle')])} onApply={next=>{setText(next);setRange(null)}} onClear={()=>setRange(null)}/>}
  <CaptionViews label={t('exec.caption.views')} preview={<ChannelPreview channel={channel} account={account} body={text} imageUrl={imageUrl}/>} raw={<p className="whitespace-pre-wrap">{text}</p>}/>
 </section>;
}
export function ExecutionPanel({campaign,brand}:{campaign:Campaign;brand:Brand}){useT();
 const [state,setState]=useState<ExecutionState|null>(null),[facts,setFacts]=useState<BrandFact[]>([]),[selected,setSelected]=useState<string[]>([]),[franchise,setFranchise]=useState<FranchiseVersions|null>(null);
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[preview,setPreview]=useState('');
 const [rights,setRights]=useState<Record<string,boolean>>({}),[aiChecks,setAiChecks]=useState<Record<string,boolean>>({}),[codedChecks,setCodedChecks]=useState<Record<string,boolean>>({}),[buffer,setBuffer]=useState<BufferChoices|null>(null),[resolveIds,setResolveIds]=useState<Record<string,string>>({}),[cancelReasons,setCancelReasons]=useState<Record<string,string>>({});
 const [title,setTitle]=useState(''),[stores,setStores]=useState<Store[]|null>(null),[storesError,setStoresError]=useState(''),[storesTry,setStoresTry]=useState(0),[codeType,setCodeType]=useState('');
 // 관리자 전용 실행(app/api/execution/route.ts adminActions·코드 있는 발행 준비)은 직원에게 숨기고 안내한다. 판정은 서버가 한다.
 const canManage=canChange(useAccount()),autoChecked=useRef(false);
 // G7 범위 역할: 발행 승인·Buffer 접수(서버 publish 권한)는 배정 브랜드·지점이면 할 수 있다. 대표·관리자·직원은 canManage와 같다. 취소·한도·재확인은 그대로 관리자 전용이다.
 const access=useAccessCheck(),canPublish=access.check('publish',{brandId:campaign.brandId,storeId:campaign.storeId??null}),publishDenied=access.deny==='scope'?t('exec.denied.publish'):t('exec.denied.admin');
 const reload=useCallback(async()=>{
  const [next,ledger]=await Promise.all([request<ExecutionState>('/api/execution?campaignId='+encodeURIComponent(campaign.id)),request<{facts:BrandFact[];franchise?:FranchiseVersions}>('/api/brand-facts?brandId='+encodeURIComponent(campaign.brandId)+(campaign.storeId?'&storeId='+encodeURIComponent(campaign.storeId):''))]);
  setState(next);setFacts(effectiveBrandFacts(ledger.facts,campaign.brandId,campaign.storeId));setFranchise(ledger.franchise??null);setRights({});setAiChecks({});setCodedChecks({});
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
  if(!chosen.length||chosen.length>4)throw new Error(t('exec.card.pickFacts'));
  // PNG에도 내부 key 대신 표준 항목 라벨을 쓴다. 서버 캡션과 같은 규칙이다.
  const blocked=chosen.map(blockReason).find(Boolean);if(blocked)throw new Error(blocked);
  // 근거 있는 가맹 사실이 있으면 PNG에도 정보공개서 각주를 그린다(서버 캡션에는 서버가 붙인다).
  const footnote=footnoteLines(chosen,franchise?.versions||[]);if(footnote===null)throw new Error(FRANCHISE_FACT_MESSAGES.staleFact);
  const png=await renderFactCard(brand,chosen.map(cardFact),footnote);setPreview(png);
  // 소재 제목은 선택이다. 비우면 보내지 않는다(해시·캡션에 들어가지 않는다).
  const name=title.trim();
  await action('save_creative',{campaignVersion:campaign.version,factRefs:chosen.map(f=>({id:f.id,version:f.version})),png,...(name?{title:name}:{})});setTitle('');
 }
 function copyCode(code:string){setError('');void Promise.resolve().then(()=>navigator.clipboard.writeText(code)).then(()=>setNotice(t('exec.code.copied')+code),()=>setError(t('exec.code.copyFailed')))}
 // loop-2: 실험 연결·게시물 ID 저장. 응답의 자동 수집 대상 등록 결과 문구를 함께 알린다.
 const linkAction=(name:'link_experiment'|'link_media',data:Record<string,unknown>,message:string)=>void perform(()=>action<{measurementSource?:{message:string}}>(name,data),r=>[message,r?.measurementSource?.message].filter(Boolean).join(' '));
 const experimentOptions=(state as ExecutionState&{experimentLinks?:ExperimentOption[]}|null)?.experimentLinks??[];
 function publicationAction(name:string,p:Publication){void perform(async():Promise<ActionResult>=>{const reason=(name==='cancel'||name==='reconfirm')&&cancelReasons[p.id];const r=await action<ActionResult>(name,{id:p.id,version:p.version,...(reason?{reasonCodes:[reason]}:{}),...(name==='approve'?{...approvalRequest(p,state,!!aiChecks[p.id]),...codedPngApproval(p,!!codedChecks[p.id]),...mediaSetApproval(p)}:{})});return name==='approve'&&r?.mediaMode==='auto'&&r.mediaUrl&&!await anonymousReachable(r.mediaUrl,window.location.origin)?{...r,unreachable:true}:r},r=>r?.unreachable?t('exec.pub.notPublic'):r?.providerAudit?t('exec.pub.bufferResult',{id:r.providerAudit.providerId,message:r.providerAudit.message}):name==='execute'?t('exec.pub.checkResult'):name==='reconfirm'?t('exec.pub.revertedDraft'):t('exec.pub.refreshed'))}
 // 승인 카드 v2(GLOBAL-PLAN X4): 발행 승인·Buffer 접수 전에 무엇(소재·코드)·어디(브랜드·캠페인·계정)·언제(예약)·비용·되돌림을 한 카드로 확인한다. 확인 뒤 동작은 publicationAction과 같다.
 async function confirmedPublicationAction(name:'approve'|'execute',p:Publication){
  const creative=state?.creatives.find(c=>c.id===p.creativeId),account=p.channelId||state?.publisher.account||state?.publisher.channelId||t('exec.needConnection');
  const mediaLine=p.mediaSet?(await import('./publication-media-set')).mediaSetConfirmLine(p):'';
  const fields={what:metaText([creative?creativeLabel(creative):t('exec.creativePrefix')+p.creativeId.slice(0,8),p.trackingCode&&codeLabel(p.trackingCode),p.copy?.aiGenerated&&t('exec.aiCopy'),mediaLine]),where:metaText([brand.name,campaign.title,t('exec.account',{account})]),when:dateTime(p.scheduledAt),cost:money(p.plannedCostKRW),reversible:name==='approve'?t('exec.pub.cancelBefore'):t('exec.pub.cancelInBuffer')};
  const ok=await askConfirm(name==='approve'?{title:t('exec.pub.approveTitle'),fields,impact:t('exec.pub.approveImpact'),undo:t('exec.pub.approveUndo'),confirmLabel:t('exec.pub.approve')}:{title:t('exec.pub.submitTitle'),fields,impact:t('exec.pub.submitImpact'),undo:t('exec.pub.submitUndo'),confirmLabel:t('exec.pub.submit')});
  if(ok)publicationAction(name,p);
 }
 // A4-4: 저장된 원본 소재 PNG 위 빈 줄에 게시 코드 라벨만 그린 파생 PNG를 만들어 이 초안에 연결한다. 원본 소재·해시는 그대로다.
 function makeCodedPng(p:Publication){void perform(async()=>{
  const code=p.trackingCode;if(!code)throw new Error(t('exec.code.none'));
  const response=await fetch('/api/execution/asset?id='+encodeURIComponent(p.creativeId));if(!response.ok)throw new Error(t('exec.code.sourceFailed'));
  const png=await renderCodedCard(await response.blob(),codeLabel(code));
  await action('register_coded_png',{id:p.id,version:p.version,code:code.code,png});
 },t('exec.code.pngLinked'))}
 async function resolveMissing(p:Publication,restoreAttempt:boolean){
  if(!(await askConfirm({title:t('exec.pub.missingTitle'),impact:t('exec.pub.missingImpact',{action:restoreAttempt?t('exec.pub.restore'):t('exec.pub.keep')}),undo:t('exec.pub.missingUndo'),confirmLabel:t('exec.pub.closeFailed')})))return;
  void perform(()=>action('resolve_uncertain',{id:p.id,version:p.version,notFound:true,restoreAttempt}),t('exec.pub.closedFailed'));
 }
 const saveDefaultLimits=()=>void perform(()=>action('save_limits',{maxPublications:1,maxPlannedCostKRW:0}),t('exec.limit.defaultSaved'));
 const steps=state?publishSteps(state,facts.length):[],currentStep=steps.findIndex(s=>!s.done);
 // 브랜드 공통 캠페인은 운영 지점을 골라야 코드를 발급한다. 목록을 불러오는 중·실패·운영 지점 0개면 초안 저장을 막고 상황에 맞는 안내를 보인다.
 const storeName=(id:string)=>stores?.find(s=>s.id===id)?.name||id,codeStores=(stores||[]).filter(s=>s.status==='active'),noCodeStore=!!codeType&&!campaign.storeId&&!codeStores.length;
 // X6 미리보기 채널: 실제 선택된 발행 공급자(Instagram 직접, Threads, Buffer는 Instagram)를 따른다. 계정 이름의 공급자 꼬리(가운뎃점 뒤)는 뺀다.
 const previewChannel=previewChannelFor(state?.publisher.channelId),previewAccount=(state?.publisher.account||brand.name).replace(/\s·\s.*$/,'');
 const assetUrl=(id:string)=>'/api/execution/asset?id='+encodeURIComponent(id),seedCreative=state?.creatives.find(c=>c.current!==false);
 const reviews=state?.publications.filter(p=>p.needsReview&&reviewStatuses.includes(p.status))||[],submitted=state?.publications.filter(p=>['submitting','uncertain','accepted'].includes(p.status))||[];
 return <div className="execution-panel space-y-6">{!canManage&&!canPublish&&<p className="subtle-note admin-only-note" role="note">{t('exec.adminOnlyNote')}</p>}
  <div><h2 className="text-xl font-semibold">{t('exec.title')}</h2><p>{t('exec.flow')}</p></div>
  {state&&<ol aria-label={t('exec.firstSteps')} className="flex flex-wrap gap-2 text-sm">{steps.map((s,i)=><li key={s.label} aria-current={i===currentStep?'step':undefined} className={'rounded-full border px-3 py-1'+(i===currentStep?' font-semibold border-current':s.done?' opacity-70':'')}>{s.done?'✓ ':''}{s.label}</li>)}</ol>}
  {reviews.length>0&&<div role="alert" className="rounded-xl border p-4 space-y-2"><strong>{t('exec.review.title')} {reviews.length}{t('exec.review.unit')}</strong><ul className="space-y-1">{reviews.map(p=><li key={p.id}><MetaLine items={[t('exec.review.scheduled',{time:new Date(p.scheduledAt).toLocaleString()}),publicationLabels[p.status],p.providerId&&t('exec.postNumber')+p.providerId]}/><br/>{p.status==='approved'?t('exec.review.reapprove'):t('exec.review.cancelInBuffer')}<br/><small>{p.needsReview?.reason}</small></li>)}</ul></div>}
  <BrandFactsPanel campaign={campaign} onChanged={()=>{setPreview('');setSelected([]);void reload().catch(e=>setError(e.message))}}/>
  {error&&<p role="alert" className="form-error">{error}</p>}{notice&&<p role="status">{notice}</p>}
  {!state?<ScreenSkeleton label={t('exec.loading')} rows={2}/>:<>
   <section className="rounded-xl border p-4 space-y-3"><h3 className="font-semibold">{t('exec.card.step')}</h3>
    <p>{t('exec.card.lead')}</p>
    {facts.length?facts.map(f=>{const reason=blockReason(f);return <label key={f.id} className="flex gap-2 items-start"><CheckInput checked={selected.includes(f.id)} disabled={busy||(!!reason&&!selected.includes(f.id))} onChange={e=>setSelected(ids=>e.target.checked?[...ids,f.id]:ids.filter(id=>id!==f.id))}/><span>{factLabel(f.key)}: {f.value} <small>v{f.version}</small>{reason&&<small className="block">{t('exec.card.unusable')} {reason}</small>}</span></label>}):<p>{t('exec.card.confirmAbove')}</p>}
    {!!chosenNotes?.length&&<div role="note" className="text-sm"><p>{t('exec.card.disclosure')}</p>{chosenNotes.map(n=><p key={n}>{n}</p>)}<p>{franchise?.disclaimer}</p></div>}
    <label>{t('exec.card.titleLabel')}<Input className="block border rounded p-2 w-full" value={title} maxLength={CREATIVE_TITLE_MAX} placeholder={t('exec.card.titlePh')} disabled={busy} onChange={e=>setTitle(e.target.value)}/></label>
    <p className="text-sm">{t('exec.card.titleNote1')}{CREATIVE_TITLE_MAX}{t('exec.card.titleNote2')}</p>
    <Button variant="outline" size="fit" disabled={busy||!selected.length} disabledReason={!selected.length?t('exec.pickTarget'):undefined} onClick={()=>void perform(createCard,t('exec.card.saved'))}>{t('exec.card.make')}</Button>
    {preview&&<Image unoptimized width={1080} height={1080} src={preview} alt={t('exec.card.preview')} className="w-64 rounded border"/>}
    <div className="grid gap-3">{state.creatives.map(c=><div key={c.id} className="border rounded p-3"><strong className="block">{creativeLabel(c)}</strong><Image unoptimized width={1080} height={1080} src={'/api/execution/asset?id='+encodeURIComponent(c.id)} alt={t('exec.creative.saved')+c.id} loading="lazy" className="w-40 rounded"/><CaptionViews label={creativeLabel(c)+t('exec.creative.views')} preview={<ChannelPreview channel={previewChannel} account={previewAccount} body={c.caption} imageUrl={assetUrl(c.id)}/>} raw={<p className="whitespace-pre-wrap">{c.caption}</p>}/><small><MetaLine items={[t('exec.briefVersion',{version:c.campaignVersion}),t('exec.creative.id',{id:c.id}),c.current===false&&t('exec.creative.stale')]}/></small><p><a className="underline" href={'/api/execution/asset?id='+encodeURIComponent(c.id)} download={c.pngHash+'.png'}>{t('exec.creative.download')}</a></p><p className="break-all text-xs">{t('exec.creative.fileName')} {c.pngHash}.png</p></div>)}</div>
   </section>
   <section className="rounded-xl border p-4 space-y-3"><h3 className="font-semibold">{t('exec.channel.step')}</h3><p>{t('exec.channel.connection')} {state.publisher.connected?<MetaLine items={[state.publisher.account,state.publisher.channelId]}/>:t('exec.needConnection')}</p>
    <AdminOnly note={t('exec.channel.adminOnly')+adminRequestNote}>
     <form aria-label={t('exec.buffer.connect')} className="grid gap-2" onSubmit={e=>{e.preventDefault();const values=Object.fromEntries(new FormData(e.currentTarget));
      if(!buffer)void perform(async()=>{const token=String(values.token||'');setBuffer({token,...await action<Omit<BufferChoices,'token'>>('buffer_channels',{token})})},t('exec.buffer.loaded'));
      else void perform(async()=>{await action('connect_buffer',{token:buffer.token,organizationId:buffer.organizationId,channelId:values.channelId,version:state.publisher.version});setBuffer(null)},t('exec.buffer.connected'))}}>
      {!buffer?<><label>{t('exec.buffer.apiKey')}<Input className="block border rounded p-2 w-full" name="token" type="password" autoComplete="off" required/></label><Button variant="outline" size="fit" disabled={busy}>{t('exec.buffer.loadOrgs')}</Button></>:<>
       <label>{t('exec.buffer.org')}<NativeSelect className="block border rounded p-2 w-full" value={buffer.organizationId} disabled={busy} onChange={e=>{const organizationId=e.target.value;void perform(async()=>setBuffer({token:buffer.token,...await action<Omit<BufferChoices,'token'>>('buffer_channels',{token:buffer.token,organizationId})}),t('exec.buffer.channelsLoaded'))}}>{buffer.organizations.map(o=><option key={o.id} value={o.id}>{o.name}</option>)}</NativeSelect></label>
       {buffer.channels.length?<label>{t('exec.buffer.channel')}<NativeSelect className="block border rounded p-2 w-full" name="channelId" required defaultValue={buffer.channels.find(c=>!c.paused)?.id}>{buffer.channels.map(c=><option key={c.id} value={c.id} disabled={c.paused}>{metaText([c.name,c.paused&&t('exec.buffer.paused')])}</option>)}</NativeSelect></label>:<p>{t('exec.buffer.noChannel')}</p>}
       <div className="flex gap-2"><Button variant="outline" size="fit" disabled={busy||!buffer.channels.some(c=>!c.paused)} disabledReason={(!buffer.channels.some(c=>!c.paused))?t('exec.buffer.noActive'):undefined}>{t('exec.buffer.checkConnect')}</Button><Button type="button" variant="outline" size="fit" disabled={busy} onClick={()=>setBuffer(null)}>{t('exec.buffer.changeKey')}</Button></div>
      </>}
     </form>
     {state.publisher.connected&&<Button variant="outline" size="fit" disabled={busy} onClick={async()=>{if(await askConfirm({title:t('exec.buffer.disconnectTitle'),impact:t('exec.buffer.disconnectImpact'),undo:t('exec.buffer.disconnectUndo'),confirmLabel:t('exec.buffer.disconnect'),danger:true}))void perform(()=>action('disconnect_buffer',{version:state.publisher.version}),t('exec.buffer.disconnected'))}}>{t('exec.buffer.disconnectButton')}</Button>}
    </AdminOnly>
    <p>{t('exec.limit.attempts1')} {totals.attempts}{t('exec.limit.attempts2')}</p>
    {budget!==null&&<p>{t('exec.limit.budget')} {budgetLabel(campaign)}</p>}
    {!state.limits&&<p>{t('exec.limit.none')} <Button type="button" variant="outline" size="fit" disabled={busy||!canManage} disabledReason={canManage?undefined:adminOnlyNote()} onClick={saveDefaultLimits}>{t('exec.limit.saveDefault')}</Button></p>}
    {!canManage&&state.limits&&<ul aria-label={t('exec.limit.current')} className="text-sm list-disc pl-5"><li>{t('exec.limit.maxAttempts')} {state.limits.maxPublications}{t('exec.limit.times')}</li><li>{t('exec.limit.costCap')} {state.limits.maxPlannedCostKRW.toLocaleString()}{t('exec.limit.won')}</li></ul>}
    <AdminOnly><form key={state.limits?.version||0} className="grid gap-2" onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);void perform(()=>action('save_limits',{version:state.limits?.version,maxPublications:Number(f.get('maxPublications')),maxPlannedCostKRW:Number(f.get('maxPlannedCostKRW')),paused:f.get('paused')==='on'}),t('exec.limit.saved'))}}>
     <label>{t('exec.limit.maxAttemptsLabel')}<Input className="block border rounded p-2" name="maxPublications" type="number" min="0" max="100" step="1" defaultValue={state.limits?.maxPublications??1} required/></label>
     <details open={(state.limits?.maxPlannedCostKRW??0)>0}><summary>{t('exec.limit.costCapLabel')}</summary><div className="grid gap-2 pt-2">
      <p className="text-sm">{t('exec.limit.costCapNote')}</p>
      <label>{t('exec.limit.costCapField')}<Input className="block border rounded p-2" name="maxPlannedCostKRW" type="number" min="0" max={budget??0} step="1" defaultValue={state.limits?.maxPlannedCostKRW??0}/></label>
      <p className="text-sm"><MetaLine items={[t('exec.limit.plannedTotal',{n:totals.plannedCostKRW.toLocaleString()}),t('exec.limit.campaignBudget',{budget:budgetLabel(campaign)})]}/></p>
      <p className="text-sm">{budget===null?t('exec.limit.zeroBeforeBudget'):t('exec.limit.overBudget')}</p>
     </div></details>
     <label><CheckInput name="paused" defaultChecked={state.limits?.paused}/>  {t('exec.limit.pause')}</label><Button variant="outline" size="fit" disabled={busy}>{t('exec.limit.save')}</Button>
    </form></AdminOnly><p className="text-sm">{t('exec.limit.note')}</p>
    {state.limits?.paused&&<div role="status" className="rounded border p-3 space-y-1"><strong>{t('exec.paused.title')}</strong> <span>{t('exec.paused.note')}</span>{submitted.length?<ul aria-label={t('exec.paused.submitted')}>{submitted.map(p=><li key={p.id}><MetaLine items={[new Date(p.scheduledAt).toLocaleString(),publicationLabels[p.status],p.providerId&&t('exec.postNumber')+p.providerId]}/></li>)}</ul>:<EmptyLine next={t('exec.paused.emptyNext')}>{t('exec.paused.empty')}</EmptyLine>}</div>}
   </section>
   <section className="rounded-xl border p-4 space-y-3"><h3 className="font-semibold">{t('exec.prep.step')}</h3>
    {state.franchise&&<div role="note" className="text-sm space-y-1"><p>{state.franchise.scope==='recruitment'?t('exec.prep.recruitNote'):t('exec.prep.profileNote')}</p><p>{state.franchise.notice} {state.franchise.disclaimer}</p></div>}
    {state.franchise?.recruitmentWarning&&<p role="status" className="rounded border p-3 text-sm">{state.franchise.recruitmentWarning}</p>}
    <p>{t('exec.prep.publicNote')}</p>
    <CaptionEditor key={seedCreative?.id||'none'} campaign={campaign} brand={brand} channel={previewChannel} account={previewAccount} seed={seedCreative?.caption||''} imageUrl={seedCreative?assetUrl(seedCreative.id):undefined}/>
    <form className="grid gap-2" onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget),copy=String(f.get('copy')||''),trackingCode=codeType?{type:codeType,...(campaign.storeId?{}:{storeId:String(f.get('codeStoreId')||'')})}:null;void perform(async()=>{const r=await action<Publication>('save_publication',{creativeId:f.get('creativeId'),mediaUrl:String(f.get('mediaUrl')||''),scheduledAt:new Date(String(f.get('scheduledAt'))).toISOString(),plannedCostKRW:Number(f.get('plannedCostKRW')),...(copy?{copy:JSON.parse(copy)}:{}),...(trackingCode?{trackingCode}:{}),...(experimentChoice(String(f.get('experimentLink')||''))?{experiment:experimentChoice(String(f.get('experimentLink')))}:{})});setCodeType('');return r},r=>r?.trackingCode?t('exec.prep.savedWithCode',{code:r.trackingCode.code}):t('exec.prep.saved'))}}>
     <label>{t('exec.prep.creative')}<NativeSelect className="block border rounded p-2 w-full" name="creativeId" required><option value="">{t('exec.prep.pick')}</option>{state.creatives.filter(c=>c.current!==false).map(c=><option key={c.id} value={c.id}>{creativeLabel(c)}</option>)}</NativeSelect></label>
     <label>{t('exec.prep.copy')}<NativeSelect className="block border rounded p-2 w-full" name="copy"><option value="">{t('exec.prep.factsOnly')}</option>{state.copies.filter(c=>!c.issues.length).map(c=><option key={c.artifactId+':'+c.index} value={JSON.stringify({artifactId:c.artifactId,artifactVersion:c.artifactVersion,index:c.index})}>{c.aiGenerated?t('exec.prep.aiPrefix'):''}{c.text.slice(0,60)}</option>)}</NativeSelect></label>
     <p className="text-sm">{!state.copyCaptions?t('exec.prep.aiOff'):state.copies.length?t('exec.prep.copyNote'):t('exec.prep.noCopy')}</p>
     {/* 결정 17: AI 카피를 고르면 사실 문구 뒤·게시 코드 줄 앞에 표시 줄이 붙는다. 문구는 lib/ai-disclosure.ts 상수(대표·법률 검토 전 초안)다. */}
     {state.copies.some(c=>c.aiGenerated&&!c.issues.length)&&<p className="text-sm">{t('exec.prep.aiLabelNote1')}{AI_DISCLOSURE_LINE}{t('exec.prep.aiLabelNote2')}</p>}
     {state.copies.some(c=>c.issues.length)&&<details><summary>{t('exec.prep.blocked1')} {state.copies.filter(c=>c.issues.length).length}{t('exec.prep.blocked2')}</summary><ul className="text-sm space-y-1">{state.copies.filter(c=>c.issues.length).map(c=><li key={c.artifactId+':'+c.index}>{c.text.slice(0,80)} — {c.issues.join(', ')}</li>)}</ul></details>}
     {state.copies.some(c=>!c.issues.length&&c.warnings?.length)&&<details><summary>{t('exec.prep.warn1')} {state.copies.filter(c=>!c.issues.length&&c.warnings?.length).length}{t('exec.prep.warn2')}</summary><ul className="text-sm space-y-1">{state.copies.filter(c=>!c.issues.length&&c.warnings?.length).map(c=><li key={c.artifactId+':'+c.index}>{c.text.slice(0,80)} — {c.warnings!.join(', ')}</li>)}</ul></details>}
     <AdminOnly note={t('exec.code.adminOnly')+adminRequestNote}><fieldset className="grid gap-2 border rounded p-3"><legend>{t('exec.code.label')}</legend>
      <label>{t('exec.code.type')}<NativeSelect className="block border rounded p-2 w-full" name="codeType" value={codeType} disabled={busy} onChange={e=>setCodeType(e.target.value)}><option value="">{t('exec.code.noCode')}</option><option value="coupon">{t('exec.code.coupon')}</option><option value="pos_tag">{t('exec.code.pos')}</option></NativeSelect></label>
      {codeType&&(campaign.storeId?<p>{t('exec.code.store')} {storeName(campaign.storeId)}  {t('exec.code.campaignStore')}</p>:codeStores.length?<label>{t('exec.code.storeLabel')}<NativeSelect className="block border rounded p-2 w-full" name="codeStoreId" required defaultValue=""><option value="">{t('exec.stores.pick')}</option>{codeStores.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</NativeSelect></label>:storesError?<p role="alert">{t('exec.stores.loadFailed')} {storesError} <Button type="button" variant="link" size="fit" className="min-h-0 p-0 underline" disabled={busy} onClick={retryStores}>{t('exec.retry')}</Button></p>:stores===null?<ScreenSkeleton label={t('exec.stores.loading')} rows={2}/>:<p role="alert">{t('exec.code.noStores')}</p>)}
      <p className="text-sm">{t('exec.code.note1')} {state.pngCode?t('exec.code.pngNote'):t('exec.code.notInPng')}  {t('exec.code.note2')}</p>
     </fieldset></AdminOnly>
     <ExperimentLinkSelect options={experimentOptions} publications={state.publications}/>
     <label>{t('exec.prep.when')} {campaign.startDate&&campaign.endDate?campaign.startDate+'~'+campaign.endDate:t('exec.unconfirmed')})<Input className="block border rounded p-2" name="scheduledAt" type="datetime-local" required/></label>
     <details><summary>{t('exec.prep.cost')}</summary><div className="grid gap-2 pt-2"><p className="text-sm">{t('exec.prep.costNote')}</p><label>{t('exec.prep.costField')}<Input className="block border rounded p-2" name="plannedCostKRW" type="number" min="0" step="1" defaultValue="0"/></label></div></details>
     <details><summary>{t('exec.prep.advanced')}</summary><div className="grid gap-2 pt-2"><p className="text-sm">{t('exec.prep.advancedNote')}</p><label>{t('exec.prep.externalUrl')}<Input className="block border rounded p-2 w-full" name="mediaUrl" type="url" placeholder={t('exec.prep.externalPh')}/></label></div></details>
     <Button variant="outline" size="fit" disabled={busy||!state.creatives.some(c=>c.current!==false)||noCodeStore} disabledReason={(!state.creatives.some(c=>c.current!==false))?t('exec.prep.noCreative'):noCodeStore?t('exec.prep.noCodeStore'):undefined}>{t('exec.prep.save')}</Button>
    </form>
    {!state.publications.length&&<EmptyLine next={t('exec.history.emptyNext')}>{t('exec.history.empty')}</EmptyLine>}
    {state.publications.map(p=>{
     const creative=state.creatives.find(c=>c.id===p.creativeId),auto=p.mediaMode==='auto';
     const fr=franchiseOf(p),blockers=p.status==='draft'?approvalBlockers({campaign,publication:p,state,factCount:facts.length,rightsConfirmed:!!rights[p.id],aiDisclosureConfirmed:!!aiChecks[p.id],codedPngConfirmed:!!codedChecks[p.id],franchise:fr}):[];
     const drift=p.status==='approved'?[...approvalDrift(p,state.publisher.connected?state.publisher:null,state.limits),...(creative?.current===false?[t('exec.creativeInput')]:[])]:[],gate=p.status==='approved'?[...campaignGateIssues(campaign,p.scheduledAt),...budgetIssues(campaign,p.plannedCostKRW,state.limits),...(fr?.blockers||[])]:[];
     // 사용한 사실이나 소재 입력이 바뀌면 같은 소재로 다시 승인할 수 없다. 재확인 대신 취소 후 새 PNG로 안내한다.
     const restart=p.status==='approved'&&(!!p.needsReview||creative?.current===false);
     return <article key={p.id} className="border rounded p-4 space-y-2"><strong>{publicationLabels[p.status]}</strong>{p.copy?.aiGenerated&&<span className="ml-2 rounded-full border px-2 py-0.5 text-xs font-semibold">{t('exec.aiGenerated')}</span>}{p.codedPng?<div className="flex flex-wrap gap-2 items-start"><figure><Image unoptimized width={1080} height={1080} src={'/api/execution/asset?codedPng='+encodeURIComponent(p.id)+'&h='+p.codedPng.hash.slice(0,12)} alt={t('exec.pub.codePngAlt')} className="w-40"/><figcaption className="text-xs">{t('exec.pub.codePng')}</figcaption></figure><figure><Image unoptimized width={1080} height={1080} src={'/api/execution/asset?id='+encodeURIComponent(p.creativeId)} alt={t('exec.pub.sourcePngAlt')} className="w-40"/><figcaption className="text-xs">{t('exec.pub.sourcePng')}</figcaption></figure></div>:<Image unoptimized width={1080} height={1080} src={'/api/execution/asset?id='+encodeURIComponent(p.creativeId)} alt={t('exec.pub.pngAlt')} className="w-40"/>}<p className="text-sm">{t('exec.pub.creative')} {creative?creativeLabel(creative):p.creativeId.slice(0,8)}</p>{p.status==='draft'?<CaptionViews label={t('exec.pub.captionViews')} preview={<ChannelPreview channel={previewChannelFor(p.channelId||state.publisher.channelId)} account={previewAccount} body={p.caption} disclosure={disclosureLine(p.copy)} imageUrl={p.codedPng?'/api/execution/asset?codedPng='+encodeURIComponent(p.id)+'&h='+p.codedPng.hash.slice(0,12):assetUrl(p.creativeId)}/>} raw={<p className="whitespace-pre-wrap">{p.caption}</p>}/>:<p className="whitespace-pre-wrap">{p.caption}</p>}{p.copy?.aiGenerated&&<p className="text-sm">{t('exec.pub.aiLine')} {disclosureLine(p.copy)}{p.aiDisclosureConfirmedAt?t('exec.pub.aiConfirmed')+new Date(p.aiDisclosureConfirmedAt).toLocaleString()+')':''}</p>}{p.trackingCode&&<p>{t('exec.pub.code')} <MetaLine items={[<code key="code">{p.trackingCode.code}</code>,p.trackingCode.type==='coupon'?t('exec.code.coupon'):t('exec.code.pos'),storeName(p.trackingCode.storeId)]}/> <Button type="button" variant="outline" size="sm" onClick={()=>copyCode(p.trackingCode!.code)}>{t('exec.code.copy')}</Button></p>}<p><MetaLine items={[t('exec.pub.account',{account:p.channelId||state.publisher.channelId||t('exec.needConnection')}),t('exec.pub.scheduled',{time:new Date(p.scheduledAt).toLocaleString()}),t('exec.pub.plannedCost',{n:p.plannedCostKRW.toLocaleString()})]}/></p><p className="break-all text-xs">{p.mediaUrl||(auto?t('exec.pub.imageAddress'):'')}</p>{p.providerId&&<p><MetaLine items={[t('exec.pub.providerId',{id:p.providerId}),t('exec.pub.providerStatus',{status:String(p.providerStatus)})]}/></p>}{p.error&&<p role="alert">{p.error}</p>}<PublicationExperiment p={p} options={experimentOptions} canManage={canManage} busy={busy} onAct={linkAction}/>{(p.mediaSet||p.permalink||p.directReconcile||/^(instagram_direct|threads):/.test(p.channelId??''))&&<Suspense fallback={null}><PublicationMediaSet p={p} busy={busy} canManage={canManage} onAct={(name,data,message)=>void perform(()=>action(name,data),message)}/></Suspense>}{p.invalidatedReason&&p.status==='draft'&&<p className="text-sm">{t('exec.pub.previousEnded')} {p.invalidatedReason}</p>}
      {p.needsReview&&<p role="alert">{p.status==='approved'?t('exec.pub.factReapprove'):p.status==='published'?t('exec.pub.factPosted'):['cancelled','failed'].includes(p.status)?t('exec.pub.factRecord'):t('exec.pub.factCancel')}</p>}
      {!canPublish&&['draft','approved','submitting','uncertain'].includes(p.status)&&<p className="subtle-note">{access.deny==='scope'?t('exec.pub.requestScope',{denied:publishDenied}):<>{t('exec.pub.adminOnly')} {adminRequestNote}</>}</p>}{canPublish&&!canManage&&['draft','approved','submitting','uncertain'].includes(p.status)&&<p className="subtle-note">{t('exec.pub.memberCan')} {adminRequestNote}</p>}
      {canPublish&&p.status==='draft'&&<><label className="flex gap-2 items-start"><CheckInput checked={!!rights[p.id]} disabled={busy} onChange={e=>setRights(old=>({...old,[p.id]:e.target.checked}))}/><span>{auto?t('exec.pub.ackPublic'):t('exec.pub.ackExternal')}</span></label>
       {p.copy?.aiGenerated&&<label className="flex gap-2 items-start"><CheckInput checked={!!aiChecks[p.id]} disabled={busy} onChange={e=>setAiChecks(old=>({...old,[p.id]:e.target.checked}))}/><span>{t('exec.pub.ackAi1')}{disclosureLine(p.copy)}{t('exec.pub.ackAi2')}</span></label>}
       {p.codedPng&&<label className="flex gap-2 items-start"><CheckInput checked={!!codedChecks[p.id]} disabled={busy} onChange={e=>setCodedChecks(old=>({...old,[p.id]:e.target.checked}))}/><span>{t('exec.pub.ackCode1')}{p.trackingCode?codeLabel(p.trackingCode):p.codedPng.code}{t('exec.pub.ackCode2')}</span></label>}
       {canManage&&state.pngCode&&auto&&p.trackingCode&&<p className="text-sm"><Button type="button" variant="outline" size="fit" disabled={busy} onClick={()=>makeCodedPng(p)}>{p.codedPng?t('exec.code.remake'):t('exec.code.make')}</Button>  {t('exec.code.drawNote1')}{codeLabel(p.trackingCode)}{t('exec.code.drawNote2')}</p>}
       <div className="flex flex-wrap gap-2 items-start"><Button variant="outline" size="fit" disabled={busy||blockers.length>0} disabledReason={(blockers.length>0)?t('exec.pub.fixAbove'):undefined} onClick={()=>void confirmedPublicationAction('approve',p)}>{t('exec.pub.approveVersion')}</Button>{canManage&&!state.limits&&<Button type="button" variant="outline" size="fit" disabled={busy} onClick={saveDefaultLimits}>{t('exec.limit.saveDefault')}</Button>}</div>
       {blockers.length>0&&<ul aria-label={t('exec.pub.approveBlocked')} className="text-sm list-disc pl-5">{blockers.map(b=><li key={b}>{b}</li>)}</ul>}</>}
      {!!fr?.warnings.length&&['draft','approved'].includes(p.status)&&<div role="status" className="text-sm"><p>{t('exec.pub.franchiseCheck')}</p><ul className="list-disc pl-5">{fr.warnings.map(w=><li key={w}>{w}</li>)}</ul></div>}
      {canPublish&&p.status==='approved'&&<>{drift.length>0&&<p role="alert">{t('exec.pub.changedAfter')} {drift.join(', ')}. {restart?t('exec.pub.cancelRedo'):t('exec.pub.recheckRedo')}</p>}{gate.length>0&&<ul aria-label={t('exec.pub.submitBlocked')} className="text-sm list-disc pl-5">{gate.map(b=><li key={b}>{b}</li>)}</ul>}<div className="flex flex-wrap gap-2"><Button variant="outline" size="fit" disabled={busy||drift.length>0||gate.length>0} disabledReason={(drift.length>0)?t('exec.pub.checkSettings'):(gate.length>0)?t('exec.pub.fixAbove'):undefined} onClick={()=>void confirmedPublicationAction('execute',p)}>{t('exec.pub.submitApproved')}</Button>{canManage&&drift.length>0&&!restart&&<Button variant="outline" size="fit" disabled={busy} onClick={()=>publicationAction('reconfirm',p)}>{t('exec.pub.recheck')}</Button>}</div></>}
      {/* B1: 취소·재확인(초안으로 되돌리기) 사유는 선택이다. 고르면 발행 판정 로그에 사유 코드로 남는다. */}
      {canManage&&['draft','approved'].includes(p.status)&&<label className="block text-sm">{t('exec.pub.reasonLabel')}<NativeSelect aria-label={t('exec.pub.reasonAria')} className="block border rounded p-2" value={cancelReasons[p.id]||''} disabled={busy} onChange={e=>setCancelReasons(old=>({...old,[p.id]:e.target.value}))}><option value="">{t('exec.noChoice')}</option>{reasonChoices('publication').map(r=><option key={r.code} value={r.code}>{r.label}</option>)}</NativeSelect></label>}
      {canManage&&['draft','approved'].includes(p.status)&&<Button variant="outline" size="fit" className={'ml-2'+(restart?' font-semibold border-current':'')} disabled={busy} onClick={()=>publicationAction('cancel',p)}>{restart?t('exec.pub.cancelRedoButton'):t('exec.pub.cancel')}</Button>}
      {p.providerId&&<Button variant="outline" size="fit" disabled={busy} onClick={()=>publicationAction('refresh',p)}>{t('exec.pub.checkStatus')}</Button>}
      {['submitting','uncertain'].includes(p.status)&&<p>{t('exec.pub.checkInBuffer')}</p>}
      {canManage&&p.status==='submitting'&&!uncertainResolvable(p)&&<p className="text-sm">{t('exec.pub.processing')}</p>}
      {canManage&&uncertainResolvable(p)&&<div className="grid gap-2"><label>{t('exec.pub.bufferId')}<Input className="block border rounded p-2 w-full" value={resolveIds[p.id]||''} disabled={busy} onChange={e=>setResolveIds(old=>({...old,[p.id]:e.target.value}))}/></label>
       <div className="flex flex-wrap gap-2"><Button variant="outline" size="fit" disabled={busy||!resolveIds[p.id]?.trim()} disabledReason={(!resolveIds[p.id]?.trim())?t('exec.fillRequired'):undefined} onClick={()=>void perform(()=>action('resolve_uncertain',{id:p.id,version:p.version,providerId:resolveIds[p.id].trim()}),t('exec.pub.confirmed'))}>{t('exec.pub.confirmById')}</Button><Button variant="outline" size="fit" disabled={busy} onClick={()=>resolveMissing(p,true)}>{t('exec.pub.noneRestore')}</Button><Button variant="outline" size="fit" disabled={busy} onClick={()=>resolveMissing(p,false)}>{t('exec.pub.noneKeep')}</Button></div></div>}
     </article>})}
   </section>
   <section className="rounded-xl border p-4 space-y-3"><h3 className="font-semibold">{t('exec.ledger.step')}</h3>
    <p>{t('exec.ledger.lead1')} {campaign.storeId&&stores?.some(s=>s.id===campaign.storeId)?storeName(campaign.storeId)+' ':''}{t('exec.ledger.lead2')}</p>
    <OrderLedgerLink campaign={campaign} stores={stores} error={storesError} onRetry={retryStores}/>
   </section>
  </>}
 </div>;
}
