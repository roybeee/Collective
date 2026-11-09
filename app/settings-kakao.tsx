'use client';
// 채널 연결 탭의 카카오 비즈메시지 카드(X-F, docs/KAKAO-BIZMESSAGE.ko.md). GET /api/kakao?brandId=, POST connect·disconnect(소유자)·verify·consent_import·optout·check(소유자·관리자).
// 이 카드는 딜러 연결, 수신동의 원장(CSV 가져오기·수신거부), 문구 판정 미리보기까지만 한다. 전송 화면은 이 판의 범위 밖이다.
// 전화번호는 요청 본문으로만 서버에 가고 서버는 해시만 남긴다. 화면도 보낸 뒤 칸을 비운다.
import {useEffect,useState} from 'react';
import {CheckCircle2,Link2,LoaderCircle,RefreshCw,ShieldCheck,Unplug,XCircle} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Textarea} from '@/components/ui/textarea';
import {Segmented} from '@/components/app/segmented';
import {StatList} from '@/components/app/stat-list';
import {askConfirm} from '@/components/app/confirm-dialog';
import {notifySaved} from '@/lib/ui/notify';
import {toast} from 'sonner';
import {useAccount} from './account-context';
import {ChannelCard,FormField,RequestError,errorText,request} from './settings-channel-card';
import {csvDataRows,dealerIssue} from './settings-channel-state';

type Dealer={connected?:boolean;account?:string;updatedAt?:string|null};
type Consents={total:number;counts:{active:number;expired:number;revoked:number;invalid:number;none:number};optouts:number;reconsentDue:number};
type KakaoView={enabled?:boolean;dealer?:Dealer;consents?:Consents};
type Reason={rule:string;message:string;basis?:string};
type Verdict={ok:boolean;classification:string;reasons:Reason[];warnings:Reason[];kst?:{date:string;time:string;night:boolean}};
type Load={state:'loading'}|{state:'ready';view:KakaoView}|{state:'denied';message:string}|{state:'error';message:string};
const blankDealer={baseUrl:'',apiKey:'',senderKey:'',senderName:'',optoutNumber:'',adminKey:''};
const OWNER_REASON='소유자만 딜러를 연결하거나 해제할 수 있습니다.',ADMIN_REASON='소유자·관리자만 바꿀 수 있습니다.';

function DealerForm({brandId,busy,onSubmit}:{brandId:string;busy:boolean;onSubmit:(body:Record<string,unknown>)=>Promise<boolean>}){
 const [form,setForm]=useState(blankDealer),[issue,setIssue]=useState('');
 const set=(k:keyof typeof blankDealer,v:string)=>{setForm(f=>({...f,[k]:v}));setIssue('')};
 return <form className="form-stack" noValidate aria-label="카카오 딜러 연결" onSubmit={e=>{e.preventDefault();const problem=dealerIssue(form);if(problem){setIssue(problem);return}void onSubmit({action:'connect',dealer:'generic',brandId,...form,adminKey:form.adminKey||undefined}).then(ok=>{if(ok)setForm(blankDealer);else setIssue('연결하지 못했습니다. 위 알림의 사유를 확인하세요.')})}}>
  <FormField label="딜러 API 주소" help="계약한 딜러사의 HTTPS 주소입니다."><Input type="url" value={form.baseUrl} placeholder="https://" onChange={e=>set('baseUrl',e.target.value)}/></FormField>
  <div className="form-two"><FormField label="딜러 API 키"><Input type="password" autoComplete="off" value={form.apiKey} onChange={e=>set('apiKey',e.target.value)}/></FormField><FormField label="발신프로필 키"><Input type="password" autoComplete="off" value={form.senderKey} onChange={e=>set('senderKey',e.target.value)}/></FormField></div>
  <div className="form-two"><FormField label="전송자 명칭" help="브랜드 메시지 본문에 들어갑니다."><Input value={form.senderName} onChange={e=>set('senderName',e.target.value)}/></FormField><FormField label="080 수신거부 번호"><Input inputMode="tel" value={form.optoutNumber} placeholder="080-000-0000" onChange={e=>set('optoutNumber',e.target.value)}/></FormField></div>
  <FormField label="카카오 Admin 키 (선택)" help="친구 관계 조회에만 씁니다."><Input type="password" autoComplete="off" value={form.adminKey} onChange={e=>set('adminKey',e.target.value)}/></FormField>
  {issue&&<p className="form-error" role="alert">{issue}</p>}
  <div className="form-actions"><Button type="submit" size="sm" disabled={busy}>{busy?<LoaderCircle className="spin"/>:<Link2/>}딜러 확인 후 저장</Button></div>
 </form>;
}

// 수신동의 CSV 가져오기와 수신거부 기록. 오류가 하나라도 있으면 서버는 아무것도 저장하지 않고 줄 번호를 돌려준다.
function ConsentLedger({brandId,consents,canEdit,busy,send}:{brandId:string;consents?:Consents;canEdit:boolean;busy:boolean;send:(body:Record<string,unknown>)=>Promise<Record<string,unknown>|null>}){
 const [csv,setCsv]=useState(''),[errors,setErrors]=useState<string[]>([]),[phone,setPhone]=useState('');
 const rows=csvDataRows(csv);
 async function importCsv(){const r=await send({action:'consent_import',brandId,csv});if(!r)return;const errs=Array.isArray(r.errors)?r.errors.map(String):[];setErrors(errs);if(errs.length)return;setCsv('');notifySaved('수신동의를 가져왔습니다.',{description:`새 동의 ${Number(r.created)||0}건, 갱신 ${Number(r.renewed)||0}건, 변화 없음 ${Number(r.unchanged)||0}건`})}
 async function optout(){
  if(!phone.trim())return;
  if(!(await askConfirm({title:'이 번호를 수신거부로 기록할까요?',fields:{what:'수신거부 기록과 동의 철회',where:'이 브랜드의 수신동의 원장',cost:'비용 변화 없음',reversible:'다시 동의를 받아 CSV로 가져와야 합니다'},impact:'이 번호에는 광고성 메시지를 보낼 수 없게 됩니다. 번호는 해시로만 남습니다.',undo:'되돌리기는 없습니다.',confirmLabel:'수신거부 기록'})))return;
  const r=await send({action:'optout',brandId,phone:phone.trim()});if(!r)return;setPhone('');notifySaved('수신거부를 기록했습니다.',{description:r.consentRevoked?'기존 동의를 철회로 바꿨습니다.':undefined});
 }
 const editReason=!canEdit?ADMIN_REASON:undefined;
 return <details className="channel-card-more"><summary>수신동의 원장</summary>
  {consents&&<StatList label="수신동의 요약" items={[['동의 유효',`${consents.counts.active}명`],['재동의 필요',`${consents.counts.expired}명`],['철회',`${consents.counts.revoked}명`],['수신거부',`${consents.optouts}명`],['곧 재동의(23개월)',`${consents.reconsentDue}명`]]}/>}
  <FormField label="수신동의 CSV" help="머리글 phone,consentedAt(선택: source,nightConsent). 5,000행까지. 번호는 서버에서 해시로만 남습니다."><Textarea aria-label="수신동의 CSV" value={csv} rows={4} placeholder={'phone,consentedAt\n010-0000-0000,2026-01-15'} onChange={e=>{setCsv(e.target.value);setErrors([])}}/></FormField>
  {errors.length>0&&<ul className="form-error" role="alert" aria-label="CSV 오류">{errors.map(e=><li key={e}>{e}</li>)}</ul>}
  <div className="form-actions"><Button size="sm" variant="outline" disabled={busy||!canEdit||!rows} disabledReason={editReason??(!rows?'CSV에 데이터 줄이 없습니다.':undefined)} onClick={()=>void importCsv()}>{rows?`${rows}행 가져와 저장`:'CSV 가져와 저장'}</Button></div>
  <FormField label="수신거부 번호" help="고객이 거부한 휴대전화 번호입니다. 저장 뒤 칸을 비웁니다."><Input type="tel" autoComplete="off" value={phone} onChange={e=>setPhone(e.target.value)}/></FormField>
  <div className="form-actions"><Button size="sm" variant="outline" disabled={busy||!canEdit||!phone.trim()} disabledReason={editReason??(!phone.trim()?'번호를 먼저 쓰세요.':undefined)} onClick={()=>void optout()}>수신거부 기록</Button></div>
 </details>;
}

// 문구 판정 미리보기(check): 저장 없이 규칙(광고 표기·전송자·080·야간·동의·수신거부·하루 상한)을 돌려 통과·막힘 사유를 보인다.
function ComplianceDryRun({brandId,canEdit,busy,send}:{brandId:string;canEdit:boolean;busy:boolean;send:(body:Record<string,unknown>)=>Promise<Record<string,unknown>|null>}){
 const [type,setType]=useState<'brand'|'alimtalk'>('brand'),[text,setText]=useState(''),[phone,setPhone]=useState(''),[template,setTemplate]=useState(''),[verdict,setVerdict]=useState<Verdict|null>(null);
 const missing=!text.trim()?'본문을 먼저 쓰세요.':!phone.trim()?'판정할 수신자 번호를 쓰세요.':type==='alimtalk'&&!template.trim()?'알림톡 템플릿 코드를 쓰세요.':undefined;
 async function check(){const r=await send({action:'check',brandId,type,text,phone:phone.trim(),...(type==='alimtalk'?{templateCode:template.trim()}:{})});if(r?.verdict)setVerdict(r.verdict as Verdict)}
 return <details className="channel-card-more"><summary>문구 판정 미리보기</summary>
  <Segmented label="메시지 종류" value={type} onChange={v=>{setType(v);setVerdict(null)}} options={[{value:'brand' as const,label:'브랜드 메시지(광고성)'},{value:'alimtalk' as const,label:'알림톡(정보성)'}]}/>
  <FormField label="메시지 본문"><Textarea aria-label="판정할 메시지 본문" rows={4} value={text} placeholder={'(광고) 전송자 명칭\n본문\n무료 수신거부 080-000-0000'} onChange={e=>{setText(e.target.value);setVerdict(null)}}/></FormField>
  <div className="form-two"><FormField label="수신자 번호(판정용)" help="동의·수신거부·하루 상한을 보려면 필요합니다. 판정에만 쓰고 버립니다."><Input type="tel" autoComplete="off" value={phone} onChange={e=>{setPhone(e.target.value);setVerdict(null)}}/></FormField>{type==='alimtalk'&&<FormField label="템플릿 코드"><Input value={template} onChange={e=>setTemplate(e.target.value)}/></FormField>}</div>
  <div className="form-actions"><Button size="sm" variant="outline" disabled={busy||!canEdit||!!missing} disabledReason={!canEdit?ADMIN_REASON:missing} onClick={()=>void check()}><ShieldCheck/>판정만 확인</Button></div>
  {verdict&&<div role="status" aria-label="판정 결과" className="channel-verdict" data-ok={verdict.ok}>
   <p><b>{verdict.ok?<><CheckCircle2/>통과</>:<><XCircle/>막힘</>}</b> {verdict.classification==='advertising'?'광고성으로 분류':'정보성으로 분류'}{verdict.kst?`, KST ${verdict.kst.date} ${verdict.kst.time}`:''}</p>
   {verdict.reasons.length>0&&<ul aria-label="막힌 사유">{verdict.reasons.map(r=><li key={r.rule}>{r.message}</li>)}</ul>}
   {verdict.warnings.length>0&&<ul aria-label="경고">{verdict.warnings.map(r=><li key={r.rule}>{r.message}</li>)}</ul>}
  </div>}
 </details>;
}

export function KakaoCard({brandId,brandName,switchOn,round}:{brandId:string;brandName:string;switchOn:boolean|null;round:number}){
 const account=useAccount(),owner=!!account?.isOwner,admin=!!account?.isAdmin;
 const [load,setLoad]=useState<Load>({state:'loading'}),[again,setAgain]=useState(0),[open,setOpen]=useState(false),[busy,setBusy]=useState(false);
 useEffect(()=>{if(!brandId)return;let live=true;request<KakaoView>('/api/kakao?brandId='+encodeURIComponent(brandId)).then(view=>{if(live)setLoad({state:'ready',view})},e=>{if(live)setLoad(e instanceof RequestError&&e.status===403?{state:'denied',message:e.message}:{state:'error',message:errorText(e)})});return()=>{live=false}},[brandId,round,again]);
 async function send(body:Record<string,unknown>){setBusy(true);try{const r=await request<Record<string,unknown>>('/api/kakao',body);return r}catch(e){toast.error(errorText(e));return null}finally{setBusy(false)}}
 const view=load.state==='ready'?load.view:null,dealer=view?.dealer,connected=load.state==='ready'?dealer?.connected===true:null;
 async function connect(body:Record<string,unknown>){const r=await send(body);if(!r)return false;setOpen(false);notifySaved('카카오 딜러 연결을 확인하고 저장했습니다.');setAgain(n=>n+1);return true}
 async function verify(){const r=await send({action:'verify',brandId});if(r){notifySaved('발신프로필을 다시 확인했습니다.');setAgain(n=>n+1)}}
 async function disconnect(){
  if(!(await askConfirm({title:'카카오 딜러 연결을 해제할까요?',fields:{what:'딜러 API 키와 발신프로필 키',where:`${brandName} 브랜드`,cost:'비용 변화 없음',reversible:'키를 다시 넣어 연결하면 됩니다'},impact:'해제하면 이 브랜드의 알림톡·브랜드 메시지를 보낼 수 없습니다. 수신동의 원장은 남습니다.',undo:'되돌리기는 없습니다. 다시 연결하세요.',confirmLabel:'연결 해제',danger:true})))return;
  if(await send({action:'disconnect',brandId})){notifySaved('카카오 딜러 연결을 해제했습니다.');setAgain(n=>n+1)}
 }
 const lead='공식 딜러사로 알림톡과 브랜드 메시지를 보냅니다.';
 return <ChannelCard channel="kakao" title="카카오 비즈메시지(딜러)" lead={lead} connected={connected} account={dealer?.account} switchOn={switchOn} switchNote={switchOn?'승인한 메시지만 전송':'꺼져 있으면 전송 막힘'}>
  {load.state==='denied'&&<p className="subtle-note" role="note">{load.message}</p>}
  {load.state==='error'&&<p className="form-error" role="alert">{load.message} <Button variant="link" size="sm" className="h-auto p-0" onClick={()=>setAgain(n=>n+1)}><RefreshCw/>다시 시도</Button></p>}
  <div className="form-actions">
   <Button variant="outline" size="sm" aria-expanded={open} disabled={!owner||!brandId} disabledReason={!brandId?'브랜드를 먼저 만드세요.':OWNER_REASON} onClick={()=>setOpen(v=>!v)}><Link2/>{dealer?.connected?'키 바꿔 다시 연결':'연결'}</Button>
   {dealer?.connected&&<><Button variant="outline" size="sm" disabled={busy||!admin} disabledReason={!admin?ADMIN_REASON:undefined} onClick={()=>void verify()}><RefreshCw/>확인</Button>
   <Button variant="ghost" size="sm" disabled={busy||!owner} disabledReason={!owner?OWNER_REASON:undefined} onClick={()=>void disconnect()}><Unplug/>해제</Button></>}
  </div>
  {open&&<DealerForm brandId={brandId} busy={busy} onSubmit={connect}/>}
  {load.state==='ready'&&<><ConsentLedger brandId={brandId} consents={view?.consents} canEdit={admin} busy={busy} send={async b=>{const r=await send(b);if(r&&b.action!=='check')setAgain(n=>n+1);return r}}/><ComplianceDryRun brandId={brandId} canEdit={admin} busy={busy} send={send}/></>}
 </ChannelCard>;
}
