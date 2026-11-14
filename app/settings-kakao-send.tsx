'use client';
// 채널 연결 → 카카오 카드 안의 '메시지 보내기'(C6 후속, docs/KAKAO-BIZMESSAGE.ko.md 6절). app/settings-kakao.tsx가 지연 로딩한다.
// 순서: 초안(템플릿 코드 또는 브랜드 메시지 본문) → 판정 결과 → 수신자 묶음(수·해시만) → 추정 비용 → 승인(확인 카드) → 전송(번호 입력, 해시 대조) → 상태 목록.
// 쓰는 API: GET /api/kakao?brandId=&segment=(읽기), POST draft·approve·send·result(기존). 번호는 전송 요청 본문에만 있고 서버·화면에 남지 않는다.
import '@/lib/i18n/lazy';
import {useEffect,useState} from 'react';
import {Send,ShieldCheck} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Textarea} from '@/components/ui/textarea';
import {NativeSelect} from '@/components/ui/native-select';
import {Segmented} from '@/components/app/segmented';
import {askConfirm} from '@/components/app/confirm-dialog';
import {MetaLine} from '@/components/app/meta-line';
import {notifySaved,type Saved} from '@/lib/ui/notify';
import {useT} from '@/lib/i18n-react';
import {localMoney,t} from '@/lib/i18n';
import {SEGMENTS,estimateCost,type Segment} from '@/lib/kakao/segments';
import {FormField,errorText,request} from './settings-channel-card';

type Reason={rule:string;message:string};
type Verdict={ok:boolean;classification:string;reasons:Reason[];warnings:Reason[]};
export type SendRow={id:string;type:'alimtalk'|'brand';status:string;recipientHash:string;templateCode:string|null;text:string;compliance:Verdict;version:number;createdAt:string;send:{costKrw:number|null}|null;result:{status:string}|null};
type SegmentView={count:number;counts:Record<Segment,number>;recipients:string[]};
const short=(h:string)=>h.slice(0,8);
const segmentKey={active:'kakaoSend.segActive',night:'kakaoSend.segNight',renewal_due:'kakaoSend.segRenewal',informational:'kakaoSend.segInfo'} as const;
const statusKey={draft:'kakaoSend.stDraft',approved:'kakaoSend.stApproved',sending:'kakaoSend.stSending',sent:'kakaoSend.stSent',failed:'kakaoSend.stFailed',unknown:'kakaoSend.stUnknown'} as const;
const statusLabel=(s:string)=>s in statusKey?t(statusKey[s as keyof typeof statusKey]):s;

function SendRowItem({row,brandName,canEdit,switchOn,busy,run}:{row:SendRow;brandName:string;canEdit:boolean;switchOn:boolean|null;busy:boolean;run:(body:Record<string,unknown>,message:string)=>Promise<boolean>}){
 const tr=useT(),[phone,setPhone]=useState(''),cost=estimateCost(row.type,1);
 async function approve(){
  const ok=await askConfirm({title:t('kakaoSend.approveTitle'),fields:{what:row.type==='alimtalk'?t('kakaoSend.whatAlimtalk',{code:row.templateCode??''}):t('kakaoSend.whatBrand'),where:t('kakaoSend.where',{brand:brandName,hash:short(row.recipientHash)}),when:t('kakaoSend.when'),cost:t('kakaoSend.costOne',{won:localMoney(cost.unitKrw)}),reversible:t('kakaoSend.reversible')},impact:t('kakaoSend.approveImpact'),undo:t('kakaoSend.approveUndo'),confirmLabel:t('kakaoSend.approve')});
  if(ok)await run({action:'approve',id:row.id,version:row.version},t('kakaoSend.approved'));
 }
 async function send(){if(await run({action:'send',id:row.id,version:row.version,phone:phone.trim()},t('kakaoSend.sentNotice')))setPhone('')}
 return <li className="space-y-1" data-status={row.status}>
  <p className="text-sm"><b>{statusLabel(row.status)}</b> <MetaLine items={[row.type==='alimtalk'?tr('kakaoSend.typeAlimtalk'):tr('kakaoSend.typeBrand'),tr('kakaoSend.recipient',{hash:short(row.recipientHash)}),row.result?.status]}/></p>
  {!row.compliance.ok&&<ul aria-label={tr('kakaoSend.blocked')} className="text-sm list-disc pl-5">{row.compliance.reasons.map(r=><li key={r.rule}>{r.message}</li>)}</ul>}
  {row.status==='draft'&&<Button size="sm" variant="outline" disabled={busy||!canEdit||!row.compliance.ok} disabledReason={!canEdit?tr('kakaoSend.adminOnly'):!row.compliance.ok?tr('kakaoSend.fixFirst'):undefined} onClick={()=>void approve()}>{tr('kakaoSend.approve')}</Button>}
  {row.status==='approved'&&<div className="form-two"><FormField label={tr('kakaoSend.phone')} help={tr('kakaoSend.phoneHelp')}><Input type="tel" autoComplete="off" value={phone} onChange={e=>setPhone(e.target.value)}/></FormField><div className="form-actions"><Button size="sm" disabled={busy||!canEdit||!phone.trim()||switchOn!==true} disabledReason={switchOn!==true?tr('kakaoSend.switchOff'):!phone.trim()?tr('kakaoSend.phoneFirst'):undefined} onClick={()=>void send()}><Send/>{tr('kakaoSend.send')}</Button></div></div>}
  {(row.status==='sent'||row.status==='unknown')&&<Button size="sm" variant="ghost" disabled={busy||switchOn!==true} disabledReason={switchOn!==true?tr('kakaoSend.switchOff'):undefined} onClick={()=>void run({action:'result',id:row.id},t('kakaoSend.resultChecked'))}>{tr('kakaoSend.result')}</Button>}
 </li>;
}

export function KakaoSendPanel({brandId,brandName,canEdit,switchOn,sends,refresh}:{brandId:string;brandName:string;canEdit:boolean;switchOn:boolean|null;sends:SendRow[];refresh:()=>void}){
 const tr=useT();
 const [type,setType]=useState<'brand'|'alimtalk'>('brand'),[text,setText]=useState(''),[template,setTemplate]=useState(''),[segment,setSegment]=useState<Segment>('active');
 const [view,setView]=useState<SegmentView|null>(null),[recipient,setRecipient]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[draft,setDraft]=useState<SendRow|null>(null);
 useEffect(()=>{let live=true;request<SegmentView>(`/api/kakao?brandId=${encodeURIComponent(brandId)}&segment=${segment}`).then(v=>{if(live){setView(v);setRecipient(v.recipients[0]??'')}},e=>{if(live)setError(errorText(e))});return()=>{live=false}},[brandId,segment]);
 async function run(body:Record<string,unknown>,message:string){setBusy(true);setError('');try{await request('/api/kakao',{brandId,...body});notifySaved(message as Saved);refresh();return true}catch(e){setError(errorText(e));return false}finally{setBusy(false)}}
 async function saveDraft(){setBusy(true);setError('');try{const r=await request<SendRow>('/api/kakao',{action:'draft',brandId,type,text,recipientHash:recipient,...(type==='alimtalk'?{templateCode:template.trim()}:{})});setDraft(r);notifySaved(t('kakaoSend.drafted') as Saved);refresh()}catch(e){setError(errorText(e))}finally{setBusy(false)}}
 const missing=!text.trim()?tr('kakaoSend.textFirst'):type==='alimtalk'&&!template.trim()?tr('kakaoSend.templateFirst'):!recipient?tr('kakaoSend.recipientFirst'):undefined;
 const estimate=view?estimateCost(type,view.count):null;
 return <details className="channel-card-more" aria-label={tr('kakaoSend.title')}><summary>{tr('kakaoSend.title')}</summary>
  <Segmented label={tr('kakaoSend.type')} value={type} onChange={v=>{setType(v);setDraft(null)}} options={[{value:'brand' as const,label:tr('kakaoSend.typeBrand')},{value:'alimtalk' as const,label:tr('kakaoSend.typeAlimtalk')}]}/>
  {type==='alimtalk'&&<FormField label={tr('kakaoSend.template')} help={tr('kakaoSend.templateHelp')}><Input value={template} onChange={e=>setTemplate(e.target.value)}/></FormField>}
  <FormField label={tr('kakaoSend.body')}><Textarea aria-label={tr('kakaoSend.body')} rows={4} value={text} onChange={e=>{setText(e.target.value);setDraft(null)}}/></FormField>
  <div className="form-two">
   <FormField label={tr('kakaoSend.segment')} help={view?tr('kakaoSend.segmentCount',{n:String(view.count)}):undefined}><NativeSelect aria-label={tr('kakaoSend.segment')} value={segment} onChange={e=>setSegment(e.target.value as Segment)}>{SEGMENTS.map(s=><option key={s} value={s}>{tr(segmentKey[s])}{view?` (${view.counts[s]})`:''}</option>)}</NativeSelect></FormField>
   <FormField label={tr('kakaoSend.pick')} help={tr('kakaoSend.pickHelp')}><NativeSelect aria-label={tr('kakaoSend.pick')} value={recipient} onChange={e=>setRecipient(e.target.value)}>{(view?.recipients??[]).map(h=><option key={h} value={h}>{short(h)}</option>)}</NativeSelect></FormField>
  </div>
  {estimate&&<p className="text-sm" aria-label={tr('kakaoSend.estimateLabel')}>{tr('kakaoSend.estimate',{n:String(view?.count??0),unit:localMoney(estimate.unitKrw),total:localMoney(estimate.totalKrw)})}</p>}
  {error&&<p className="form-error" role="alert">{error}</p>}
  <div className="form-actions"><Button size="sm" variant="outline" disabled={busy||!canEdit||!!missing} disabledReason={!canEdit?tr('kakaoSend.adminOnly'):missing} onClick={()=>void saveDraft()}><ShieldCheck/>{tr('kakaoSend.draft')}</Button></div>
  {draft&&<div role="status" aria-label={tr('kakaoSend.verdict')} className="channel-verdict" data-ok={draft.compliance.ok}><p><b>{draft.compliance.ok?tr('kakaoSend.pass'):tr('kakaoSend.fail')}</b></p>{draft.compliance.reasons.length>0&&<ul>{draft.compliance.reasons.map(r=><li key={r.rule}>{r.message}</li>)}</ul>}{draft.compliance.warnings.length>0&&<ul>{draft.compliance.warnings.map(r=><li key={r.rule}>{r.message}</li>)}</ul>}</div>}
  <section aria-label={tr('kakaoSend.list')}><p className="text-sm font-semibold">{tr('kakaoSend.list')}</p>
   {!sends.length?<p className="subtle-note">{tr('kakaoSend.empty')}</p>:<ul className="space-y-2">{sends.slice(0,20).map(row=><SendRowItem key={row.id} row={row} brandName={brandName} canEdit={canEdit} switchOn={switchOn} busy={busy} run={run}/>)}</ul>}
  </section>
 </details>;
}
