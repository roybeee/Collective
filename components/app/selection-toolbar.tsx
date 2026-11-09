'use client';
// X6 선택 막대: 글 입력칸에서 글을 고르면 다시 쓰기·줄이기·톤 바꾸기(친근하게·단정하게)를 보인다. 이번 판은 제작·발행 캡션 편집기에서만 쓴다.
// 누르면 확인 카드(무엇·어디·추정 비용·되돌림, lib/token-estimate.ts 추정식)를 거친 뒤에만 /api/rewrite로 HERMES 요청을 만든다(스위치 selection_rewrite).
// 결과는 제안으로만 돌아와 어절 비교(components/app/version-diff.tsx)로 보이고, 받기(전부·일부) 전까지 편집기 글은 그대로다. 받기·버리기 결정만 서버 요청 기록에 남는다.
import {useCallback,useEffect,useRef,useState} from 'react';
import {Button} from '@/components/ui/button';
import {askConfirm} from './confirm-dialog';
import {VersionDiff} from './version-diff';
import {estimateRewriteTokens,isActiveRewrite,rewriteLabel,spliceSelection,type RewriteChannel,type RewriteMode,type RewriteRequest,type RewriteTone} from '@/lib/rewrite-request';
import {formatTokens} from '@/lib/token-estimate';

export type TextRange={start:number;end:number;selection:string};
type Job=Omit<RewriteRequest,'providerId'>;
// 입력칸의 현재 선택. 비었거나 공백뿐이면 null이다.
export function readSelection(el:Pick<HTMLTextAreaElement,'value'|'selectionStart'|'selectionEnd'>):TextRange|null{
 const start=el.selectionStart??0,end=el.selectionEnd??0,selection=el.value.slice(start,end);
 return end>start&&selection.trim()?{start,end,selection}:null;
}
async function call<T>(input?:Record<string,unknown>):Promise<T>{
 const response=await fetch('/api/rewrite',input?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)}:undefined);
 const result=await response.json().catch(()=>({})) as T&{error?:string};
 if(!response.ok)throw new Error(result.error||'다시 쓰기 요청을 처리하지 못했습니다.');
 return result;
}
// 스위치 상태와 요청 가능 여부(소유자·관리자). 읽지 못하면 막대를 보이지 않는다.
export function useRewriteAvailable(){
 const [ok,setOk]=useState(false);
 useEffect(()=>{let active=true;void call<{enabled?:boolean;canRequest?:boolean}>().then(r=>{if(active)setOk(r.enabled===true&&r.canRequest===true)},()=>{if(active)setOk(false)});return ()=>{active=false}},[]);
 return ok;
}
const newId=()=>'rw-'+crypto.randomUUID().replace(/-/g,'').slice(0,20);
const POLL_MS=1500,POLL_LIMIT=80;
const ACTIONS:{mode:RewriteMode;tone?:RewriteTone}[]=[{mode:'rewrite'},{mode:'shorten'},{mode:'tone',tone:'friendly'},{mode:'tone',tone:'firm'}];

type Props={campaignId:string;channel:RewriteChannel;text:string;range:TextRange|null;where:string;onApply:(next:string)=>void;onClear:()=>void};
export function SelectionToolbar({campaignId,channel,text,range,where,onApply,onClear}:Props){
 const [job,setJob]=useState<Job|null>(null),[base,setBase]=useState<TextRange|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[tries,setTries]=useState(0);
 const timer=useRef<ReturnType<typeof setTimeout>|null>(null);
 const poll=useCallback(async(current:Job,mode?:'recover'|'cancel')=>{
  try{const next=await call<Job>({action:'poll',id:current.id,campaignId,...(mode?{mode}:{})});setJob(next);setError(next.status==='failed'?next.error||'다시 쓰기를 끝내지 못했습니다.':'')}
  catch(e){setError((e as Error).message)}
 },[campaignId]);
 useEffect(()=>{
  if(!job||!['queued','in_progress','starting'].includes(job.status)||tries>=POLL_LIMIT)return;
  timer.current=setTimeout(()=>{setTries(n=>n+1);void poll(job)},POLL_MS);
  return ()=>{if(timer.current)clearTimeout(timer.current)};
 },[job,tries,poll]);
 async function request(mode:RewriteMode,tone?:RewriteTone){
  if(!range)return;
  const context=text.slice(Math.max(0,range.start-400),range.start)+text.slice(range.end,range.end+400);
  const tokens=estimateRewriteTokens({mode,tone,channel,selection:range.selection,context});
  const ok=await askConfirm({title:`고른 글을 ${rewriteLabel(mode,tone)}할까요?`,fields:{what:`고른 ${Array.from(range.selection).length.toLocaleString('ko-KR')}자, ${rewriteLabel(mode,tone)}`,where,cost:`약 ${formatTokens(tokens)}(추정)`,reversible:'제안은 받기 전까지 편집기 글에 넣지 않습니다. 버리면 원문 그대로입니다.'},
   impact:'고른 글과 앞뒤 글 일부만 HERMES에 한 번 보내 제안을 받습니다. 토큰 예산 안에서만 보냅니다.',undo:'제안을 버리면 아무것도 바뀌지 않습니다.',confirmLabel:'요청 보내기'});
  if(!ok)return;
  setBusy(true);setError('');setTries(0);
  try{const started=await call<Job>({action:'start',id:newId(),campaignId,mode,...(tone?{tone}:{}),channel,selection:range.selection,context});setBase(range);setJob(started);if(started.status==='failed')setError(started.error||'요청을 보내지 못했습니다.')}
  catch(e){setError((e as Error).message)}finally{setBusy(false)}
 }
 const reset=()=>{setJob(null);setBase(null);setError('');setTries(0);onClear()};
 async function decide(decision:'accepted'|'discarded',merged?:string){
  if(!job||!base)return;
  if(decision==='accepted'){const next=spliceSelection(text,base,merged??job.suggestion??'');if(next===null){setError('제안을 요청한 뒤 편집기 글이 바뀌어 넣지 못했습니다. 다시 고른 뒤 요청하세요.');return}
   setBusy(true);try{await call({action:'decide',id:job.id,campaignId,decision});onApply(next);reset()}catch(e){setError((e as Error).message)}finally{setBusy(false)}return}
  setBusy(true);try{await call({action:'decide',id:job.id,campaignId,decision});reset()}catch(e){setError((e as Error).message)}finally{setBusy(false)}
 }
 const waiting=!!job&&isActiveRewrite(job);
 return <div className="selection-toolbar-host">
  {range&&!job&&<div role="toolbar" aria-label="고른 글 다시 쓰기" className="selection-toolbar">
   {ACTIONS.slice(0,2).map(a=><Button key={a.mode} type="button" variant="outline" size="sm" disabled={busy} onClick={()=>void request(a.mode)}>{rewriteLabel(a.mode)}</Button>)}
   <span className="selection-toolbar-label">톤 바꾸기</span>
   {ACTIONS.slice(2).map(a=><Button key={a.tone} type="button" variant="outline" size="sm" disabled={busy} aria-label={rewriteLabel(a.mode,a.tone)} onClick={()=>void request(a.mode,a.tone)}>{a.tone==='friendly'?'친근하게':'단정하게'}</Button>)}
  </div>}
  {waiting&&<div role="status" className="selection-toolbar-status"><p>{job!.status==='uncertain'?'접수 여부를 확인하지 못했습니다. 복구로 이어서 확인하세요.':tries>=POLL_LIMIT?'아직 끝나지 않았습니다. 잠시 뒤 다시 확인하세요.':`${rewriteLabel(job!.mode,job!.tone)} 제안을 기다리고 있습니다.`}</p>
   <div className="selection-toolbar">{job!.status==='uncertain'&&<Button type="button" variant="outline" size="sm" onClick={()=>void poll(job!,'recover')}>복구</Button>}{tries>=POLL_LIMIT&&<Button type="button" variant="outline" size="sm" onClick={()=>{setTries(0);void poll(job!)}}>다시 확인</Button>}<Button type="button" variant="ghost" size="sm" onClick={()=>void poll(job!,'cancel').then(reset)}>요청 중지</Button></div></div>}
  {job?.status==='completed'&&job.suggestion&&base&&<section aria-label="다시 쓰기 제안" className="selection-suggestion">
   <p className="selection-suggestion-title">{rewriteLabel(job.mode,job.tone)} 제안</p>
   <VersionDiff before={base.selection} after={job.suggestion} beforeLabel="고른 원문" afterLabel="제안" busy={busy} onApply={merged=>decide('accepted',merged)} applyLabel="고른 부분만 받기" onAcceptAll={()=>decide('accepted',job.suggestion!)} acceptAllLabel="제안 전체 받기"/>
   <div className="vd-actions"><Button type="button" variant="ghost" size="sm" disabled={busy} onClick={()=>void decide('discarded')}>제안 버리기</Button></div>
  </section>}
  {job&&['failed','cancelled'].includes(job.status)&&<div className="selection-toolbar"><Button type="button" variant="outline" size="sm" onClick={reset}>닫기</Button></div>}
  {error&&<p role="alert" className="form-error">{error}</p>}
 </div>;
}
