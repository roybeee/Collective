'use client';
// 네이버 검색광고 제안 카드(X-F, docs/NAVER-ADS-WRITE.ko.md). GET /api/ads-proposals[?storeId=], POST generate·approve·reject·apply·reconcile(소유자·관리자).
// 제안은 규칙이 읽기(GET)만으로 만들고 '추정·규칙 기반, 자동 적용 없음'으로 표시한다. 승인·반영은 사람이 누르고, 쓰기 스위치가 꺼져 있으면 서버가 409로 막는다.
// 스위치가 꺼진 상태는 승인·반영 버튼의 비활성 이유로 보인다. 결과 미확인(unknown)은 다시 보내지 않고 '결과 대조'(읽기)로만 닫는다.
import {useCallback,useEffect,useState} from 'react';
import {Check,LoaderCircle,RefreshCw,Send,Sparkles,X} from 'lucide-react';
import {Badge} from '@/components/ui/badge';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {MetaLine} from '@/components/app/meta-line';
import {EmptyLine} from '@/components/app/empty-line';
import {StatList} from '@/components/app/stat-list';
import {SafetyScope} from '@/components/app/safety-scope';
import {askConfirm,askInput,type ConfirmFields} from '@/components/app/confirm-dialog';
import {dateTime} from '@/lib/format';
import {notifySaved} from '@/lib/ui/notify';
import {toast} from 'sonner';
import type {AdsProposal,ProposalKind,ProposalStatus} from '@/lib/ads-proposals';
import {FormField,RequestError,errorText,request} from './settings-channel-card';
import {bidDelta,diffLines} from './settings-channel-state';

type View={proposals:AdsProposal[];enabled:boolean;canApprove:boolean;notice?:string;label?:string};
type Load={state:'loading'}|{state:'ready';view:View}|{state:'denied'|'error';message:string};
const LABEL='추정·규칙 기반, 자동 적용 없음';
const SWITCH_OFF='쓰기 스위치 꺼짐: 소유자가 기능표에서 네이버 검색광고 쓰기를 켜야 승인과 반영을 할 수 있습니다.';
const kindLabels:Record<ProposalKind,string>={bid:'입찰가 변경',pause:'중지',resume:'다시 켜기',create_keywords:'키워드 추가',create_campaign:'캠페인 만들기',budget:'일 예산 변경',create_adgroup:'광고그룹 만들기',create_creative:'소재 만들기',update_creative:'소재 고치기'};
const statusLabels:Record<ProposalStatus,string>={draft:'제안',approved:'승인됨',rejected:'반려',applied:'반영됨(대조 전)',failed:'반영 실패',unknown:'결과 미확인',verified:'반영 확인',mismatch:'대조 불일치'};
const riskLabels={T2:'위험 T2(되돌리기 쉬움)',T3:'위험 T3(새 지출·큰 변경)'} as const;
// 확인 대화상자의 무엇·어디·비용·되돌림. 비용은 입찰가 차이(클릭당)나 지출 방향만 적는다(실제 지출은 클릭 수에 따른다).
function proposalFields(p:AdsProposal):ConfirmFields{
 const delta=bidDelta(p.diff),target=p.target.names.length?p.target.names.join(', '):p.target.ids.join(', ')||'대상 미상';
 const cost=delta!==null?`클릭당 입찰가 ${delta>0?'+':''}${delta.toLocaleString('ko-KR')}원`:p.kind==='pause'?'지출 줄어듦(키워드 중지)':'새 지출이 생길 수 있음';
 return {what:`${kindLabels[p.kind]}: ${target}`,where:`네이버 검색광고 캠페인 ${p.campaignId}${p.storeId?', 지점 연결':', 워크스페이스 기본 연결'}`,cost,reversible:p.kind==='bid'||p.kind==='pause'||p.kind==='resume'?'반대 제안을 만들어 승인하면 되돌립니다. 자동 되돌림은 없습니다':'만든 항목은 광고시스템에서 직접 지워야 합니다'};
}

function ProposalItem({p,busy,switchReason,onAct}:{p:AdsProposal;busy:boolean;switchReason?:string;onAct:(p:AdsProposal,action:'approve'|'reject'|'apply'|'reconcile')=>void}){
 const lines=diffLines(p.diff),stuck=p.status==='approved'&&p.write?.state==='sent',metrics=Object.entries(p.rationale.evidence.metrics??{}).filter(([,v])=>v!==null);
 return <li className="proposal-item" data-status={p.status} data-proposal={p.id}>
  <header className="channel-card-head"><b>{kindLabels[p.kind]}</b><span className="proposal-badges"><Badge variant={p.riskTier==='T3'?'destructive':'outline'}>{riskLabels[p.riskTier]}</Badge><Badge variant="secondary">{statusLabels[p.status]}</Badge></span></header>
  <p className="subtle-note"><MetaLine items={[p.label||LABEL,p.target.names.join(', ')||p.target.ids.join(', '),'만든 시각 '+dateTime(p.createdAt)]}/></p>
  {lines.length>0&&<ul className="proposal-diff" aria-label="바뀌는 값">{lines.map(l=><li key={l.key}><span>{l.label}</span> <s>{l.before}</s> → <b>{l.after}</b></li>)}</ul>}
  <p>{p.rationale.text}</p>
  {metrics.length>0&&<StatList label="근거 지표" items={metrics.map(([k,v])=>[k,String(v)] as const)}/>}
  {p.verification&&<p className="subtle-note">대조 {p.verification.status==='verified'?'일치':'불일치'}{p.verification.details.length?`: ${p.verification.details.join(' ')}`:''}</p>}
  {p.write?.error&&<p className="form-error">{p.write.error}</p>}
  <div className="form-actions">
   {p.status==='draft'&&<><Button size="sm" disabled={busy||!!switchReason} disabledReason={switchReason} onClick={()=>onAct(p,'approve')}><Check/>승인</Button><Button size="sm" variant="ghost" disabled={busy} onClick={()=>onAct(p,'reject')}><X/>반려</Button></>}
   {p.status==='approved'&&!p.write&&<Button size="sm" disabled={busy||!!switchReason} disabledReason={switchReason} onClick={()=>onAct(p,'apply')}><Send/>반영</Button>}
   {(p.status==='unknown'||stuck)&&<Button size="sm" variant="outline" disabled={busy} onClick={()=>onAct(p,'reconcile')}><RefreshCw/>결과 대조</Button>}
  </div>
 </li>;
}

const blankForm={campaignId:'',targetCpa:'',targetRoas:''};
export function AdsProposalsCard({storeId,brandId}:{storeId?:string|null;brandId?:string|null}){
 const [load,setLoad]=useState<Load>({state:'loading'}),[busy,setBusy]=useState(false),[form,setForm]=useState(blankForm),[blocked,setBlocked]=useState('');
 const query=storeId?'?storeId='+encodeURIComponent(storeId):'';
 const refresh=useCallback(()=>request<View>('/api/ads-proposals'+query).then(view=>setLoad({state:'ready',view}),e=>setLoad({state:e instanceof RequestError&&e.status===403?'denied':'error',message:errorText(e)})),[query]);
 useEffect(()=>{void Promise.resolve().then(refresh)},[refresh]);
 const view=load.state==='ready'?load.view:null;
 const switchReason=!view?undefined:!view.canApprove?'소유자·관리자만 승인할 수 있습니다.':!view.enabled?SWITCH_OFF:blocked||undefined;
 async function post(body:Record<string,unknown>,saved:`${string}습니다.`){
  setBusy(true);
  try{const r=await request<View>('/api/ads-proposals',{...body,...(storeId?{storeId}:{}),...(brandId?{brandId}:{})});setLoad({state:'ready',view:{proposals:r.proposals,enabled:r.enabled,canApprove:r.canApprove,notice:r.notice,label:r.label}});notifySaved(saved);return true}
  catch(e){if(e instanceof RequestError&&e.status===409&&e.message.startsWith('쓰기 스위치 꺼짐'))setBlocked(e.message);toast.error(errorText(e));return false}
  finally{setBusy(false)}
 }
 async function act(p:AdsProposal,action:'approve'|'reject'|'apply'|'reconcile'){
  if(action==='reject'){const note=await askInput({title:'이 제안을 반려할까요?',fields:proposalFields(p),impact:'반려한 제안은 반영할 수 없습니다. 같은 조건이면 다음 제안 만들기에서 다시 나옵니다.',undo:'되돌리기는 없습니다.',confirmLabel:'반려',input:{label:'반려 사유(선택)'}});if(note===null)return;await post({action:'reject',id:p.id,...(note.trim()?{note:note.trim()}:{})},'제안을 반려했습니다.');return}
  if(action==='reconcile'){await post({action:'reconcile',id:p.id},'광고 계정에서 다시 읽어 대조했습니다.');return}
  const apply=action==='apply';
  if(!(await askConfirm({title:apply?'이 제안을 네이버 검색광고에 반영할까요?':'이 제안을 승인할까요?',fields:proposalFields(p),impact:apply?'승인된 제안 하나를 광고 계정에 한 번 씁니다. 반영 뒤 다시 읽어 일치 여부를 확인합니다.':'승인해도 바로 반영되지 않습니다. 반영은 따로 누릅니다.',undo:apply?'자동 되돌림은 없습니다. 반대 제안을 만들어 되돌립니다.':'반영 전이면 반려할 수 있습니다.',confirmLabel:apply?'반영':'승인',danger:apply})))return;
  await post({action,id:p.id},apply?'제안을 반영하고 대조했습니다.':'제안을 승인했습니다.');
 }
 async function generate(){if(await post({action:'generate',campaignId:form.campaignId.trim(),...(form.targetCpa?{targetCpa:Number(form.targetCpa)}:{}),...(form.targetRoas?{targetRoas:Number(form.targetRoas)}:{})},'제안을 만들었습니다.'))setForm(blankForm)}
 const missing=!form.campaignId.trim()?'네이버 캠페인 ID를 먼저 쓰세요.':undefined;
 return <section className="metric-card ads-proposals" aria-label="네이버 검색광고 제안">
  <div className="section-heading"><h3>네이버 검색광고 제안</h3><span className="mode-pill">{view?.label||LABEL}</span></div>
  <SafetyScope>제안은 읽기만으로 만들고, 승인한 제안 하나만 사람이 눌러 반영합니다.</SafetyScope>
  {load.state==='loading'&&<p className="subtle-note" role="status">제안을 불러오고 있습니다.</p>}
  {(load.state==='denied'||load.state==='error')&&<p className="subtle-note" role="note">{load.message}{load.state==='error'&&<> <Button variant="link" size="sm" className="h-auto p-0" onClick={()=>void refresh()}>다시 시도</Button></>}</p>}
  {view&&<>
   {!view.enabled&&<p className="subtle-note" role="note">{SWITCH_OFF}</p>}
   <form className="form-two" noValidate aria-label="제안 만들기" onSubmit={e=>{e.preventDefault();if(!missing)void generate()}}>
    <FormField label="네이버 캠페인 ID" help="광고시스템의 캠페인 ID(nccCampaignId)입니다."><Input value={form.campaignId} onChange={e=>setForm(f=>({...f,campaignId:e.target.value}))}/></FormField>
    <FormField label="목표 CPA(원, 선택)"><Input type="number" min={0} value={form.targetCpa} onChange={e=>setForm(f=>({...f,targetCpa:e.target.value}))}/></FormField>
    <FormField label="목표 ROAS(배, 선택)" help="비우면 3배로 봅니다."><Input type="number" min={0} step="any" value={form.targetRoas} onChange={e=>setForm(f=>({...f,targetRoas:e.target.value}))}/></FormField>
    <div className="form-actions"><Button type="submit" size="sm" variant="outline" disabled={busy||!view.canApprove||!!missing} disabledReason={!view.canApprove?'소유자·관리자만 만들 수 있습니다.':missing}>{busy?<LoaderCircle className="spin"/>:<Sparkles/>}제안 만들기</Button></div>
   </form>
   {view.proposals.length?<ul className="proposal-list" aria-label="제안 목록">{view.proposals.map(p=><ProposalItem key={p.id} p={p} busy={busy} switchReason={switchReason} onAct={(x,a)=>void act(x,a)}/>)}</ul>:<EmptyLine next="네이버 캠페인 ID를 넣고 제안 만들기를 누르세요. 최근 14일 통계로 규칙이 제안합니다.">아직 광고 제안이 없습니다.</EmptyLine>}
  </>}
 </section>;
}
