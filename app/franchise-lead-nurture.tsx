'use client';
// 리드 상세의 '정보 요청·발송 기록'(트랙 R R9a): 가맹희망자가 요청한 정보(목적 코드)를 기록하고, 담당자가 템플릿으로 직접 보낸 뒤 발송 기록(템플릿 판·매체·요청)을 남긴다.
// 앱은 보내지 않는다. '요청받은 1회 정보'는 이 리드의 요청 기록 하나에 한 번만 기록된다. 광고성 발송 기록은 R9b 전에는 막힌다(서버 409). 판정은 서버가 한다.
import {useEffect,useState} from 'react';
import {Button} from '@/components/ui/button';
import {NativeSelect,NativeSelectOption} from '@/components/ui/native-select';
import {franchiseGet,Section,kst,actorLabel,type Json,type PostResult,type Assignee} from './franchise-common';

type Purpose={key:string;label:string;classification:string};
type Template={templateId:string;version:number;purpose:string;classification:string;medium:string;status:string};
type NurtureLite={templates:Template[];purposes:Purpose[];media:{key:string;label:string}[]};
export type InfoRequestView={id:string;purpose:string;at:string;by:{id:string;role:string};used:boolean};
export type MessageLogView={id:string;templateId:string;templateVersion:number;classification:string;medium:string;requestId:string|null;at:string;by:{id:string;role:string}};
type Act=(action:string,payload:Json,done?:string|((result:Json)=>string),noVersion?:boolean)=>Promise<PostResult|null>;
export const LOG_NOTE='메시지는 담당자가 직접 보냅니다. 보낸 뒤 여기서 기록만 남깁니다(앱은 보내지 않음). 요청받은 1회 정보는 요청 하나에 한 번만 기록됩니다.';
export const logReady=(t:Template|undefined,requestId:string)=>!!t&&t.status==='active'&&t.classification==='info_requested'&&!!requestId;

export function LeadNurture({brandId,lead,act,busy,assignees,allowed}:{brandId:string;lead:{infoRequests?:InfoRequestView[];messageLogs?:MessageLogView[]};act:Act;busy:boolean;assignees:readonly Assignee[];allowed:readonly string[]}){
 const [data,setData]=useState<NurtureLite|null>(null),[purpose,setPurpose]=useState(''),[template,setTemplate]=useState(''),[requestId,setRequestId]=useState('');
 useEffect(()=>{const c=new AbortController();void franchiseGet<NurtureLite>({view:'nurture',brandId},c.signal).then(d=>{if(!c.signal.aborted)setData(d)}).catch(()=>{});return ()=>c.abort()},[brandId]);
 const requests=lead.infoRequests??[],logs=lead.messageLogs??[],open=requests.filter(r=>!r.used);
 const infoPurposes=(data?.purposes??[]).filter(p=>p.classification==='info_requested'),active=(data?.templates??[]).filter(t=>t.status==='active');
 const label=(key:string)=>data?.purposes.find(p=>p.key===key)?.label??key,medium=(key:string)=>data?.media.find(m=>m.key===key)?.label??key;
 const picked=active.find(t=>`${t.templateId}:${t.version}`===template);
 async function addRequest(){if(!purpose)return;if(await act('add_info_request',{purpose},'정보 요청을 기록했습니다.'))setPurpose('')}
 async function log(){if(!picked||!logReady(picked,requestId))return;if(await act('log_lead_message',{templateId:picked.templateId,templateVersion:picked.version,medium:picked.medium,infoRequestId:requestId},'발송 기록을 남겼습니다.')){setTemplate('');setRequestId('')}}
 return <Section title="정보 요청·발송 기록" note={LOG_NOTE}>
  {allowed.includes('add_info_request')&&<form className="franchise-bar" aria-label="정보 요청 기록" onSubmit={e=>{e.preventDefault();void addRequest()}}>
   <NativeSelect aria-label="요청한 정보" value={purpose} onChange={e=>setPurpose(e.target.value)}><NativeSelectOption value="">요청한 정보 선택</NativeSelectOption>{infoPurposes.map(p=><NativeSelectOption key={p.key} value={p.key}>{p.label}</NativeSelectOption>)}</NativeSelect>
   <Button type="submit" variant="outline" disabled={busy||!purpose}>정보 요청 기록</Button>
  </form>}
  {allowed.includes('log_lead_message')&&<form className="franchise-bar" aria-label="발송 기록" onSubmit={e=>{e.preventDefault();void log()}}>
   <NativeSelect aria-label="보낸 템플릿" value={template} onChange={e=>setTemplate(e.target.value)}><NativeSelectOption value="">보낸 템플릿 선택</NativeSelectOption>
    {active.map(t=><NativeSelectOption key={t.templateId} value={`${t.templateId}:${t.version}`} disabled={t.classification!=='info_requested'}>{`${label(t.purpose)} · ${medium(t.medium)} · v${t.version}${t.classification!=='info_requested'?' (광고성: R9b 전 기록 불가)':''}`}</NativeSelectOption>)}</NativeSelect>
   <NativeSelect aria-label="답한 정보 요청" value={requestId} onChange={e=>setRequestId(e.target.value)}><NativeSelectOption value="">답한 정보 요청 선택</NativeSelectOption>{open.map(r=><NativeSelectOption key={r.id} value={r.id}>{`${label(r.purpose)} · ${kst(r.at)}`}</NativeSelectOption>)}</NativeSelect>
   <Button type="submit" variant="outline" disabled={busy||!logReady(picked,requestId)}>보낸 뒤 기록</Button>
  </form>}
  {requests.length?<ul className="franchise-list" aria-label="정보 요청 기록">{requests.map(r=><li key={r.id}>{label(r.purpose)} <small className="subtle-note">{kst(r.at)} · {actorLabel(r.by,assignees)}{r.used?' · 답함':''}</small></li>)}</ul>:<p className="subtle-note">정보 요청 기록이 없습니다.</p>}
  {logs.length>0&&<ul className="franchise-list" aria-label="발송 기록">{logs.map(l=><li key={l.id}>{`${medium(l.medium)} · 템플릿 v${l.templateVersion} · ${l.classification==='info_requested'?'요청받은 1회 정보':'광고성'}`} <small className="subtle-note">{kst(l.at)} · {actorLabel(l.by,assignees)}</small></li>)}</ul>}
 </Section>;
}
