'use client';
// 네이버 검색광고 제안 카드(X-F, docs/NAVER-ADS-WRITE.ko.md). GET /api/ads-proposals[?storeId=], POST generate·approve·reject·apply·reconcile(소유자·관리자).
// 제안은 규칙이 읽기(GET)만으로 만들고 '추정·규칙 기반, 자동 적용 없음'으로 표시한다. 승인·반영은 사람이 누르고, 쓰기 스위치가 꺼져 있으면 서버가 409로 막는다.
// 스위치가 꺼진 상태는 승인·반영 버튼의 비활성 이유로 보인다. 결과 미확인(unknown)은 다시 보내지 않고 '결과 대조'(읽기)로만 닫는다.
// 레인 X-G: 채널 선택(네이버·당근, docs/DAANGN-ADS.ko.md)은 같은 API의 channel 값만 바꾼다. 당근 스위치(daangn_ads)가 꺼져 있으면 제안 만들기·승인·반영이 막힌다.
// 승인(publish)·반영(spend) 버튼은 범위 역할 판정(app/account-context.tsx useCan)도 함께 본다. 대표·관리자 화면은 이전과 같다.
import '@/lib/i18n/lazy-cards';
import {currentLocale,t,type MessageKey} from '@/lib/i18n';
import {useT} from '@/lib/i18n-react';
import {useCallback,useEffect,useState} from 'react';
import {Check,LoaderCircle,RefreshCw,Send,Sparkles,X} from 'lucide-react';
import {Badge} from '@/components/ui/badge';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Segmented} from '@/components/app/segmented';
import {useCan} from './account-context';
import {MetaLine} from '@/components/app/meta-line';
import {EmptyLine} from '@/components/app/empty-line';
import {StatList} from '@/components/app/stat-list';
import {SafetyScope} from '@/components/app/safety-scope';
import {askConfirm,askInput,type ConfirmFields} from '@/components/app/confirm-dialog';
import {dateTime} from '@/lib/format';
import {notifySaved,type Saved} from '@/lib/ui/notify';
import {toast} from 'sonner';
import type {AnyAdsProposal as AdsProposal,ProposalChannel,ProposalKind,ProposalStatus} from '@/lib/ads-proposals';
import {FormField,RequestError,errorText,request} from './settings-channel-card';
import {bidDelta,diffLines} from './settings-channel-state';

type View={proposals:AdsProposal[];enabled:boolean;enabledByChannel?:Partial<Record<ProposalChannel,boolean>>;canApprove:boolean;notice?:string;label?:string};
type Load={state:'loading'}|{state:'ready';view:View}|{state:'denied'|'error';message:string};
// 문구 표는 그릴 때 사전에서 읽는다(모듈을 읽는 시점의 언어에 묶이지 않게).
const LABEL=()=>t('ads.label');
// 서버가 보낸 표식(label)과 diff 줄(app/settings-channel-state.ts diffLines, 한국어)은 한국어 화면에서 그대로 쓰고, 영어·일본어일 때만 사전으로 바꾼다. 모르는 항목은 서버 글자 그대로다.
const serverLabel=(label:string|undefined)=>currentLocale()==='ko'&&label?label:LABEL();
const said=(key:string,fallback:string)=>{if(currentLocale()==='ko')return fallback;const text=t(key as MessageKey);return text===key?fallback:text};
const diffValues:Record<string,string>={'예':'ads.diff.yes','아니요':'ads.diff.no','없음':'ads.diff.none'};
const diffValue=(v:string)=>v in diffValues?said(diffValues[v],v):v;
// 근거 문장 끝의 '(표식)'은 서버가 붙인 화면 표식이라 영어·일본어에서는 사전 표식으로 바꾼다. 앞의 근거 문장(규칙·입력)은 그대로다.
const rationaleText=(text:string,label:string|undefined)=>currentLocale()!=='ko'&&label&&text.endsWith(` (${label})`)?`${text.slice(0,-(label.length+3))} (${LABEL()})`:text;
const SWITCH_OFF=()=>t('ads.switchOffNaver');
const DAANGN_OFF=()=>t('ads.switchOffDaangn');
const channels=():{value:ProposalChannel;label:string;title:string;idLabel:string;idHelp:string}[]=>[
 {value:'naver_ads',label:t('ads.naver'),title:t('ads.naverTitle'),idLabel:t('ads.naverId'),idHelp:t('ads.naverIdHelp')},
 {value:'daangn_ads',label:t('ads.daangn'),title:t('ads.daangnTitle'),idLabel:t('ads.daangnId'),idHelp:t('ads.daangnIdHelp')},
];
const kindLabels=():Record<ProposalKind,string>=>({bid:t('ads.kind.bid'),pause:t('ads.kind.pause'),resume:t('ads.kind.resume'),create_keywords:t('ads.kind.create_keywords'),create_campaign:t('ads.kind.create_campaign'),budget:t('ads.kind.budget'),create_adgroup:t('ads.kind.create_adgroup'),create_creative:t('ads.kind.create_creative'),update_creative:t('ads.kind.update_creative')});
const statusLabels=():Record<ProposalStatus,string>=>({draft:t('ads.status.draft'),approved:t('ads.status.approved'),rejected:t('ads.status.rejected'),applied:t('ads.status.applied'),failed:t('ads.status.failed'),unknown:t('ads.status.unknown'),verified:t('ads.status.verified'),mismatch:t('ads.status.mismatch')});
const riskLabels=()=>({T2:t('ads.riskT2'),T3:t('ads.riskT3')} as const);
// 확인 대화상자의 무엇·어디·비용·되돌림. 비용은 입찰가 차이(클릭당)나 지출 방향만 적는다(실제 지출은 클릭 수에 따른다).
function proposalFields(p:AdsProposal):ConfirmFields{
 const delta=bidDelta(p.diff),target=p.target.names.length?p.target.names.join(', '):p.target.ids.join(', ')||t('ads.unknownTarget');
 const cost=delta!==null?t('ads.bidDelta',{v:delta>0?'+':'',v2:delta.toLocaleString('ko-KR')}):p.kind==='pause'?t('ads.spendDown'):t('ads.spendNew');
 return {what:`${kindLabels()[p.kind]}: ${target}`,where:t('ads.where',{v:p.channel==='daangn_ads'?t('ads.daangnAds'):t('ads.naverAds'),campaignId:p.campaignId,v2:p.storeId?t('ads.storeLink'):t('ads.workspaceLink')}),cost,reversible:p.kind==='bid'||p.kind==='pause'||p.kind==='resume'?t('ads.undoCounter'):t('ads.undoCreated')};
}

function ProposalItem({p,busy,switchReason,applyReason,onAct}:{p:AdsProposal;busy:boolean;switchReason?:string;applyReason?:string;onAct:(p:AdsProposal,action:'approve'|'reject'|'apply'|'reconcile')=>void}){
 useT();const lines=diffLines(p.diff),stuck=p.status==='approved'&&p.write?.state==='sent',metrics=Object.entries(p.rationale.evidence.metrics??{}).filter(([,v])=>v!==null);
 return <li className="proposal-item" data-status={p.status} data-proposal={p.id}>
  <header className="channel-card-head"><b>{kindLabels()[p.kind]}</b><span className="proposal-badges"><Badge variant={p.riskTier==='T3'?'destructive':'outline'}>{riskLabels()[p.riskTier]}</Badge><Badge variant="secondary">{statusLabels()[p.status]}</Badge></span></header>
  <p className="subtle-note"><MetaLine items={[serverLabel(p.label),p.target.names.join(', ')||p.target.ids.join(', '),t('ads.createdAt')+dateTime(p.createdAt)]}/></p>
  {lines.length>0&&<ul className="proposal-diff" aria-label={t('ads.changes')}>{lines.map(l=><li key={l.key}><span>{said(`ads.diff.${l.key}`,l.label)}</span> <s>{diffValue(l.before)}</s> → <b>{diffValue(l.after)}</b></li>)}</ul>}
  <p>{rationaleText(p.rationale.text,p.label)}</p>
  {metrics.length>0&&<StatList label={t('ads.evidence')} items={metrics.map(([k,v])=>[k,String(v)] as const)}/>}
  {p.verification&&<p className="subtle-note">{t('ads.reconcile')} {p.verification.status==='verified'?t('ads.match'):t('ads.mismatch')}{p.verification.details.length?`: ${p.verification.details.join(' ')}`:''}</p>}
  {p.write?.error&&<p className="form-error">{p.write.error}</p>}
  <div className="form-actions">
   {p.status==='draft'&&<><Button size="sm" disabled={busy||!!switchReason} disabledReason={switchReason} onClick={()=>onAct(p,'approve')}><Check/>{t('ads.approve')}</Button><Button size="sm" variant="ghost" disabled={busy} onClick={()=>onAct(p,'reject')}><X/>{t('ads.reject')}</Button></>}
   {p.status==='approved'&&!p.write&&<Button size="sm" disabled={busy||!!applyReason} disabledReason={applyReason} onClick={()=>onAct(p,'apply')}><Send/>{t('ads.apply')}</Button>}
   {(p.status==='unknown'||stuck)&&<Button size="sm" variant="outline" disabled={busy} onClick={()=>onAct(p,'reconcile')}><RefreshCw/>{t('ads.reconcileResult')}</Button>}
  </div>
 </li>;
}

const blankForm={campaignId:'',targetCpa:'',targetRoas:''};
export function AdsProposalsCard({storeId,brandId}:{storeId?:string|null;brandId?:string|null}){
 useT();const [load,setLoad]=useState<Load>({state:'loading'}),[busy,setBusy]=useState(false),[form,setForm]=useState(blankForm),[blocked,setBlocked]=useState(''),[channel,setChannel]=useState<ProposalChannel>('naver_ads');
 const scope={brandId:brandId??null,storeId:storeId??null},canPublish=useCan('publish',scope),canSpend=useCan('spend',scope),meta=channels().find(c=>c.value===channel)!;
 // 네이버는 이전처럼 channel 없이 읽고(채널 필드가 없던 이전 제안 포함) 당근 제안만 화면에서 뺀다. 당근은 channel=daangn_ads로 읽는다.
 const daangn=channel==='daangn_ads',params=new URLSearchParams({...(daangn?{channel}:{}),...(storeId?{storeId}:{})}).toString(),query=params?'?'+params:'';
 const refresh=useCallback(()=>request<View>('/api/ads-proposals'+query).then(view=>setLoad({state:'ready',view}),e=>setLoad({state:e instanceof RequestError&&e.status===403?'denied':'error',message:errorText(e)})),[query]);
 useEffect(()=>{void Promise.resolve().then(refresh)},[refresh]);
 const view=load.state==='ready'?load.view:null;
 const enabled=!view?false:view.enabledByChannel?.[channel]??view.enabled,offText=channel==='daangn_ads'?DAANGN_OFF():SWITCH_OFF();
 const switchReason=!view?undefined:!view.canApprove||!canPublish?t('ads.approveDenied'):!enabled?offText:blocked||undefined;
 const applyReason=!view?undefined:!canSpend?t('ads.applyDenied'):switchReason;
 async function post(body:Record<string,unknown>,saved:`${string}습니다.`){
  setBusy(true);
  try{const r=await request<View>('/api/ads-proposals',{...body,...(daangn?{channel}:{}),...(storeId?{storeId}:{}),...(brandId?{brandId}:{})});setLoad({state:'ready',view:{proposals:r.proposals,enabled:r.enabled,enabledByChannel:r.enabledByChannel,canApprove:r.canApprove,notice:r.notice,label:r.label}});notifySaved(saved);return true}
  catch(e){if(e instanceof RequestError&&e.status===409&&(e.message.startsWith(t('ads.switchOffNaverShort'))||e.message.startsWith(t('ads.switchOffDaangnShort'))))setBlocked(e.message);toast.error(errorText(e));return false}
  finally{setBusy(false)}
 }
 async function act(p:AdsProposal,action:'approve'|'reject'|'apply'|'reconcile'){
  if(action==='reject'){const note=await askInput({title:t('ads.rejectTitle'),fields:proposalFields(p),impact:t('ads.rejectImpact'),undo:t('ads.noUndo'),confirmLabel:t('ads.reject'),input:{label:t('ads.rejectReason')}});if(note===null)return;await post({action:'reject',id:p.id,...(note.trim()?{note:note.trim()}:{})},(t('ads.rejected') as Saved));return}
  if(action==='reconcile'){await post({action:'reconcile',id:p.id},(t('ads.reconciled') as Saved));return}
  const apply=action==='apply';
  if(!(await askConfirm({title:apply?t('ads.applyTitle',{v:channel==='daangn_ads'?t('ads.daangnAds'):t('ads.naverAds')}):t('ads.approveTitle'),fields:proposalFields(p),impact:apply?t('ads.applyImpact'):t('ads.approveImpact'),undo:apply?t('ads.applyUndo'):t('ads.approveUndo'),confirmLabel:apply?t('ads.apply'):t('ads.approve'),danger:apply})))return;
  await post({action,id:p.id},apply?(t('ads.applied') as Saved):(t('ads.approved') as Saved));
 }
 async function generate(){if(await post({action:'generate',campaignId:form.campaignId.trim(),...(form.targetCpa?{targetCpa:Number(form.targetCpa)}:{}),...(form.targetRoas?{targetRoas:Number(form.targetRoas)}:{})},(t('ads.created') as Saved)))setForm(blankForm)}
 const missing=!form.campaignId.trim()?t('ads.idFirst',{idLabel:meta.idLabel}):undefined,generateReason=!view?.canApprove?t('ads.createDenied'):channel==='daangn_ads'&&!enabled?DAANGN_OFF():missing;
 const shown=view?view.proposals.filter(p=>daangn?p.channel==='daangn_ads':p.channel!=='daangn_ads'):[];
 function pick(next:ProposalChannel){if(next===channel)return;setChannel(next);setBlocked('');setForm(blankForm);setLoad({state:'loading'})}
 return <section className="metric-card ads-proposals" aria-label={meta.title} data-channel={channel}>
  <div className="section-heading"><h3>{meta.title}</h3><span className="mode-pill">{serverLabel(view?.label)}</span></div>
  <Segmented label={t('ads.channel')} value={channel} disabled={busy} onChange={pick} options={channels().map(c=>({value:c.value,label:c.label}))}/>
  <SafetyScope>{t('ads.lead')}</SafetyScope>
  {load.state==='loading'&&<p className="subtle-note" role="status">{t('ads.loading')}</p>}
  {(load.state==='denied'||load.state==='error')&&<p className="subtle-note" role="note">{load.message}{load.state==='error'&&<> <Button variant="link" size="sm" className="h-auto p-0" onClick={()=>void refresh()}>{t('ads.retry')}</Button></>}</p>}
  {view&&<>
   {!enabled&&<p className="subtle-note" role="note">{offText}</p>}
   <form className="form-two" noValidate aria-label={t('ads.create')} onSubmit={e=>{e.preventDefault();if(!missing)void generate()}}>
    <FormField label={meta.idLabel} help={meta.idHelp}><Input value={form.campaignId} onChange={e=>setForm(f=>({...f,campaignId:e.target.value}))}/></FormField>
    <FormField label={t('ads.targetCpa')}><Input type="number" min={0} value={form.targetCpa} onChange={e=>setForm(f=>({...f,targetCpa:e.target.value}))}/></FormField>
    <FormField label={t('ads.targetRoas')} help={t('ads.targetRoasHelp')}><Input type="number" min={0} step="any" value={form.targetRoas} onChange={e=>setForm(f=>({...f,targetRoas:e.target.value}))}/></FormField>
    <div className="form-actions"><Button type="submit" size="sm" variant="outline" disabled={busy||!!generateReason} disabledReason={generateReason}>{busy?<LoaderCircle className="spin"/>:<Sparkles/>}{t('ads.create')}</Button></div>
   </form>
   {shown.length?<ul className="proposal-list" aria-label={t('ads.list')}>{shown.map(p=><ProposalItem key={p.id} p={p} busy={busy} switchReason={switchReason} applyReason={applyReason} onAct={(x,a)=>void act(x,a)}/>)}</ul>:<EmptyLine next={t('ads.emptyNext',{idLabel:meta.idLabel})}>{t('ads.empty')}</EmptyLine>}
  </>}
 </section>;
}
