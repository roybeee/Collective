'use client';
// 채널 연결 탭의 카카오 비즈메시지 카드(X-F, docs/KAKAO-BIZMESSAGE.ko.md). GET /api/kakao?brandId=, POST connect·disconnect(소유자)·verify·consent_import·optout·check(소유자·관리자).
// 이 카드는 딜러 연결, 수신동의 원장(CSV 가져오기·수신거부), 문구 판정 미리보기까지만 한다. 전송 화면은 이 판의 범위 밖이다.
// 전화번호는 요청 본문으로만 서버에 가고 서버는 해시만 남긴다. 화면도 보낸 뒤 칸을 비운다.
import '@/lib/i18n/lazy-settings';
import {Suspense,lazy,useEffect,useState} from 'react';
import {CheckCircle2,Link2,LoaderCircle,RefreshCw,ShieldCheck,Unplug,XCircle} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Textarea} from '@/components/ui/textarea';
import {Segmented} from '@/components/app/segmented';
import {StatList} from '@/components/app/stat-list';
import {askConfirm} from '@/components/app/confirm-dialog';
import {notifySaved,type Saved} from '@/lib/ui/notify';
import {t} from '@/lib/i18n';
import {useT} from '@/lib/i18n-react';
import {toast} from 'sonner';
import {useAccount} from './account-context';
import {ChannelCard,FormField,RequestError,errorText,request} from './settings-channel-card';
import {csvDataRows,dealerIssue} from './settings-channel-state';
import type {SendRow} from './settings-kakao-send';
// 메시지 보내기(초안·판정·수신자 묶음·추정 비용·승인·전송·상태)는 열 때 내려받는다(C6 후속).
const KakaoSendPanel=lazy(()=>import('./settings-kakao-send').then(m=>({default:m.KakaoSendPanel})));

type Dealer={connected?:boolean;account?:string;updatedAt?:string|null};
type Consents={total:number;counts:{active:number;expired:number;revoked:number;invalid:number;none:number};optouts:number;reconsentDue:number};
type KakaoView={enabled?:boolean;dealer?:Dealer;consents?:Consents;sends?:SendRow[]};
type Reason={rule:string;message:string;basis?:string};
type Verdict={ok:boolean;classification:string;reasons:Reason[];warnings:Reason[];kst?:{date:string;time:string;night:boolean}};
type Load={state:'loading'}|{state:'ready';view:KakaoView}|{state:'denied';message:string}|{state:'error';message:string};
const blankDealer={baseUrl:'',apiKey:'',senderKey:'',senderName:'',optoutNumber:'',adminKey:''};
// 거절 이유는 그릴 때 사전에서 읽는다(모듈을 읽는 시점의 언어에 묶이지 않게).
const OWNER_REASON=()=>t('kakao.ownerOnly'),ADMIN_REASON=()=>t('kakao.adminOnly');

function DealerForm({brandId,busy,onSubmit}:{brandId:string;busy:boolean;onSubmit:(body:Record<string,unknown>)=>Promise<boolean>}){
 useT();const [form,setForm]=useState(blankDealer),[issue,setIssue]=useState('');
 const set=(k:keyof typeof blankDealer,v:string)=>{setForm(f=>({...f,[k]:v}));setIssue('')};
 return <form className="form-stack" noValidate aria-label={t('kakao.dealerForm')} onSubmit={e=>{e.preventDefault();const problem=dealerIssue(form);if(problem){setIssue(problem);return}void onSubmit({action:'connect',dealer:'generic',brandId,...form,adminKey:form.adminKey||undefined}).then(ok=>{if(ok)setForm(blankDealer);else setIssue(t('kakao.connectFailed'))})}}>
  <FormField label={t('kakao.baseUrl')} help={t('kakao.baseUrlHelp')}><Input type="url" value={form.baseUrl} placeholder="https://" onChange={e=>set('baseUrl',e.target.value)}/></FormField>
  <div className="form-two"><FormField label={t('kakao.apiKey')}><Input type="password" autoComplete="off" value={form.apiKey} onChange={e=>set('apiKey',e.target.value)}/></FormField><FormField label={t('kakao.senderKey')}><Input type="password" autoComplete="off" value={form.senderKey} onChange={e=>set('senderKey',e.target.value)}/></FormField></div>
  <div className="form-two"><FormField label={t('kakao.senderName')} help={t('kakao.senderNameHelp')}><Input value={form.senderName} onChange={e=>set('senderName',e.target.value)}/></FormField><FormField label={t('kakao.optoutNumber')}><Input inputMode="tel" value={form.optoutNumber} placeholder="080-000-0000" onChange={e=>set('optoutNumber',e.target.value)}/></FormField></div>
  <FormField label={t('kakao.adminKey')} help={t('kakao.adminKeyHelp')}><Input type="password" autoComplete="off" value={form.adminKey} onChange={e=>set('adminKey',e.target.value)}/></FormField>
  {issue&&<p className="form-error" role="alert">{issue}</p>}
  <div className="form-actions"><Button type="submit" size="sm" disabled={busy}>{busy?<LoaderCircle className="spin"/>:<Link2/>}{t('kakao.saveDealer')}</Button></div>
 </form>;
}

// 수신동의 CSV 가져오기와 수신거부 기록. 오류가 하나라도 있으면 서버는 아무것도 저장하지 않고 줄 번호를 돌려준다.
function ConsentLedger({brandId,consents,canEdit,busy,send}:{brandId:string;consents?:Consents;canEdit:boolean;busy:boolean;send:(body:Record<string,unknown>)=>Promise<Record<string,unknown>|null>}){
 useT();const [csv,setCsv]=useState(''),[errors,setErrors]=useState<string[]>([]),[phone,setPhone]=useState('');
 const rows=csvDataRows(csv);
 async function importCsv(){const r=await send({action:'consent_import',brandId,csv});if(!r)return;const errs=Array.isArray(r.errors)?r.errors.map(String):[];setErrors(errs);if(errs.length)return;setCsv('');notifySaved(t('kakao.imported') as Saved,{description:t('kakao.importedDetail',{v:Number(r.created)||0,v2:Number(r.renewed)||0,v3:Number(r.unchanged)||0})})}
 async function optout(){
  if(!phone.trim())return;
  if(!(await askConfirm({title:t('kakao.optoutTitle'),fields:{what:t('kakao.optoutWhat'),where:t('kakao.optoutWhere'),cost:t('kakao.noCost'),reversible:t('kakao.optoutReversible')},impact:t('kakao.optoutImpact'),undo:t('kakao.noUndo'),confirmLabel:t('kakao.optoutConfirm')})))return;
  const r=await send({action:'optout',brandId,phone:phone.trim()});if(!r)return;setPhone('');notifySaved(t('kakao.optoutDone') as Saved,{description:r.consentRevoked?t('kakao.consentRevoked'):undefined});
 }
 const editReason=!canEdit?ADMIN_REASON():undefined;
 return <details className="channel-card-more"><summary>{t('kakao.ledger')}</summary>
  {consents&&<StatList label={t('kakao.ledgerSummary')} items={[[t('kakao.active'),t('kakao.activeCount',{active:consents.counts.active})],[t('kakao.expired'),t('kakao.expiredCount',{expired:consents.counts.expired})],[t('kakao.revoked'),t('kakao.revokedCount',{revoked:consents.counts.revoked})],[t('kakao.optouts'),t('kakao.optoutsCount',{optouts:consents.optouts})],[t('kakao.reconsentDue'),t('kakao.reconsentDueCount',{reconsentDue:consents.reconsentDue})]]}/>}
  <FormField label={t('kakao.csv')} help={t('kakao.csvHelp')}><Textarea aria-label={t('kakao.csv')} value={csv} rows={4} placeholder={'phone,consentedAt\n010-0000-0000,2026-01-15'} onChange={e=>{setCsv(e.target.value);setErrors([])}}/></FormField>
  {errors.length>0&&<ul className="form-error" role="alert" aria-label={t('kakao.csvErrors')}>{errors.map(e=><li key={e}>{e}</li>)}</ul>}
  <div className="form-actions"><Button size="sm" variant="outline" disabled={busy||!canEdit||!rows} disabledReason={editReason??(!rows?t('kakao.csvEmpty'):undefined)} onClick={()=>void importCsv()}>{rows?t('kakao.importRows',{rows}):t('kakao.importCsv')}</Button></div>
  <FormField label={t('kakao.optoutPhone')} help={t('kakao.optoutPhoneHelp')}><Input type="tel" autoComplete="off" value={phone} onChange={e=>setPhone(e.target.value)}/></FormField>
  <div className="form-actions"><Button size="sm" variant="outline" disabled={busy||!canEdit||!phone.trim()} disabledReason={editReason??(!phone.trim()?t('kakao.phoneFirst'):undefined)} onClick={()=>void optout()}>{t('kakao.optoutConfirm')}</Button></div>
 </details>;
}

// 문구 판정 미리보기(check): 저장 없이 규칙(광고 표기·전송자·080·야간·동의·수신거부·하루 상한)을 돌려 통과·막힘 사유를 보인다.
function ComplianceDryRun({brandId,canEdit,busy,send}:{brandId:string;canEdit:boolean;busy:boolean;send:(body:Record<string,unknown>)=>Promise<Record<string,unknown>|null>}){
 useT();const [type,setType]=useState<'brand'|'alimtalk'>('brand'),[text,setText]=useState(''),[phone,setPhone]=useState(''),[template,setTemplate]=useState(''),[verdict,setVerdict]=useState<Verdict|null>(null);
 const missing=!text.trim()?t('kakao.bodyFirst'):!phone.trim()?t('kakao.phoneForCheck'):type==='alimtalk'&&!template.trim()?t('kakao.templateFirst'):undefined;
 async function check(){const r=await send({action:'check',brandId,type,text,phone:phone.trim(),...(type==='alimtalk'?{templateCode:template.trim()}:{})});if(r?.verdict)setVerdict(r.verdict as Verdict)}
 return <details className="channel-card-more"><summary>{t('kakao.dryRun')}</summary>
  <Segmented label={t('kakao.type')} value={type} onChange={v=>{setType(v);setVerdict(null)}} options={[{value:'brand' as const,label:t('kakao.typeBrand')},{value:'alimtalk' as const,label:t('kakao.typeAlimtalk')}]}/>
  <FormField label={t('kakao.body')}><Textarea aria-label={t('kakao.bodyLabel')} rows={4} value={text} placeholder={t('kakao.bodyPlaceholder')} onChange={e=>{setText(e.target.value);setVerdict(null)}}/></FormField>
  <div className="form-two"><FormField label={t('kakao.checkPhone')} help={t('kakao.checkPhoneHelp')}><Input type="tel" autoComplete="off" value={phone} onChange={e=>{setPhone(e.target.value);setVerdict(null)}}/></FormField>{type==='alimtalk'&&<FormField label={t('kakao.template')}><Input value={template} onChange={e=>setTemplate(e.target.value)}/></FormField>}</div>
  <div className="form-actions"><Button size="sm" variant="outline" disabled={busy||!canEdit||!!missing} disabledReason={!canEdit?ADMIN_REASON():missing} onClick={()=>void check()}><ShieldCheck/>{t('kakao.checkOnly')}</Button></div>
  {verdict&&<div role="status" aria-label={t('kakao.verdict')} className="channel-verdict" data-ok={verdict.ok}>
   <p><b>{verdict.ok?<><CheckCircle2/>{t('kakao.pass')}</>:<><XCircle/>{t('kakao.blocked')}</>}</b> {verdict.classification==='advertising'?t('kakao.classAd'):t('kakao.classInfo')}{verdict.kst?`, KST ${verdict.kst.date} ${verdict.kst.time}`:''}</p>
   {verdict.reasons.length>0&&<ul aria-label={t('kakao.reasons')}>{verdict.reasons.map(r=><li key={r.rule}>{r.message}</li>)}</ul>}
   {verdict.warnings.length>0&&<ul aria-label={t('kakao.warnings')}>{verdict.warnings.map(r=><li key={r.rule}>{r.message}</li>)}</ul>}
  </div>}
 </details>;
}

export function KakaoCard({brandId,brandName,switchOn,round}:{brandId:string;brandName:string;switchOn:boolean|null;round:number}){
 useT();const account=useAccount(),owner=!!account?.isOwner,admin=!!account?.isAdmin;
 const [load,setLoad]=useState<Load>({state:'loading'}),[again,setAgain]=useState(0),[open,setOpen]=useState(false),[busy,setBusy]=useState(false);
 useEffect(()=>{if(!brandId)return;let live=true;request<KakaoView>('/api/kakao?brandId='+encodeURIComponent(brandId)).then(view=>{if(live)setLoad({state:'ready',view})},e=>{if(live)setLoad(e instanceof RequestError&&e.status===403?{state:'denied',message:e.message}:{state:'error',message:errorText(e)})});return()=>{live=false}},[brandId,round,again]);
 async function send(body:Record<string,unknown>){setBusy(true);try{const r=await request<Record<string,unknown>>('/api/kakao',body);return r}catch(e){toast.error(errorText(e));return null}finally{setBusy(false)}}
 const view=load.state==='ready'?load.view:null,dealer=view?.dealer,connected=load.state==='ready'?dealer?.connected===true:null;
 async function connect(body:Record<string,unknown>){const r=await send(body);if(!r)return false;setOpen(false);notifySaved(t('kakao.connected') as Saved);setAgain(n=>n+1);return true}
 async function verify(){const r=await send({action:'verify',brandId});if(r){notifySaved(t('kakao.verified') as Saved);setAgain(n=>n+1)}}
 async function disconnect(){
  if(!(await askConfirm({title:t('kakao.disconnectTitle'),fields:{what:t('kakao.disconnectWhat'),where:t('kakao.disconnectWhere',{brandName}),cost:t('kakao.noCost'),reversible:t('kakao.disconnectReversible')},impact:t('kakao.disconnectImpact'),undo:t('kakao.disconnectUndo'),confirmLabel:t('kakao.disconnect'),danger:true})))return;
  if(await send({action:'disconnect',brandId})){notifySaved(t('kakao.disconnected') as Saved);setAgain(n=>n+1)}
 }
 const lead=t('kakao.lead');
 return <ChannelCard channel="kakao" title={t('kakao.title')} lead={lead} connected={connected} account={dealer?.account} switchOn={switchOn} switchNote={switchOn?t('kakao.switchOn'):t('kakao.switchOff')}>
  {load.state==='denied'&&<p className="subtle-note" role="note">{load.message}</p>}
  {load.state==='error'&&<p className="form-error" role="alert">{load.message} <Button variant="link" size="sm" className="h-auto p-0" onClick={()=>setAgain(n=>n+1)}><RefreshCw/>{t('kakao.retry')}</Button></p>}
  <div className="form-actions">
   <Button variant="outline" size="sm" aria-expanded={open} disabled={!owner||!brandId} disabledReason={!brandId?t('kakao.brandFirst'):OWNER_REASON()} onClick={()=>setOpen(v=>!v)}><Link2/>{dealer?.connected?t('kakao.reconnect'):t('kakao.connect')}</Button>
   {dealer?.connected&&<><Button variant="outline" size="sm" disabled={busy||!admin} disabledReason={!admin?ADMIN_REASON():undefined} onClick={()=>void verify()}><RefreshCw/>{t('kakao.verify')}</Button>
   <Button variant="ghost" size="sm" disabled={busy||!owner} disabledReason={!owner?OWNER_REASON():undefined} onClick={()=>void disconnect()}><Unplug/>{t('kakao.unplug')}</Button></>}
  </div>
  {open&&<DealerForm brandId={brandId} busy={busy} onSubmit={connect}/>}
  {load.state==='ready'&&<><ConsentLedger brandId={brandId} consents={view?.consents} canEdit={admin} busy={busy} send={async b=>{const r=await send(b);if(r&&b.action!=='check')setAgain(n=>n+1);return r}}/><ComplianceDryRun brandId={brandId} canEdit={admin} busy={busy} send={send}/><Suspense fallback={null}><KakaoSendPanel brandId={brandId} brandName={brandName} canEdit={admin} switchOn={switchOn} sends={view?.sends??[]} refresh={()=>setAgain(n=>n+1)}/></Suspense></>}
 </ChannelCard>;
}
