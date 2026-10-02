'use client';

import {Textarea} from '@/components/ui/textarea';
import {Button} from '@/components/ui/button';
import {dateTime} from '@/lib/format';
import {Note} from '@/components/app/note';
import {useCallback,useEffect,useRef,useState} from 'react';
import styles from './growth-panel.module.css';
import {pushNav} from '@/lib/nav-state';

type StopState={id:'global';version:number;status:'running'|'stopped';reason:string;updatedAt:string|null;updatedBy:string|null};
type View={hasMoreHistory?:boolean;state:StopState;history:{id:string;version:number;status:'running'|'stopped';reason:string;actorId:string;recordedAt:string}[];canStop:boolean;canResume:boolean;externalCancellationConfirmed:false;notice:string};
const statusName=(status:StopState['status'])=>status==='stopped'?'신규 실행 중단':'중단 해제 상태';
async function request(init:RequestInit={}):Promise<View>{
 const response=await fetch('/api/growth/stop',{...init,cache:'no-store'}),raw:unknown=await response.json();
 if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new Error('전역 중단 응답을 확인하지 못했습니다.');
 const data=raw as Record<string,unknown>;
 if(!response.ok)throw new Error(typeof data.error==='string'?data.error:'전역 중단 요청에 실패했습니다.');
 const state=data.state as Partial<StopState>|undefined;
 if(!state||!Number.isInteger(state.version)||!['running','stopped'].includes(String(state.status))||!Array.isArray(data.history)||typeof data.canStop!=='boolean'||typeof data.canResume!=='boolean')throw new Error('전역 중단 응답을 확인하지 못했습니다.');
 return data as unknown as View;
}
export function GrowthStopPanel(){
 const [view,setView]=useState<View|null>(null),[basis,setBasis]=useState<number|null>(null),[reason,setReason]=useState('');
 const [loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
 const mounted=useRef(false),read=useRef<AbortController|null>(null),write=useRef<AbortController|null>(null),retry=useRef<{key:string;id:string}|null>(null);
 const load=useCallback(async(signal:AbortSignal)=>{setLoading(true);setError('');try{const next=await request({signal});if(!signal.aborted){setView(next);setBasis(previous=>previous??next.state.version);}}catch(e){if(!signal.aborted)setError(e instanceof Error?e.message:'중단 상태를 조회하지 못했습니다.');}finally{if(!signal.aborted)setLoading(false);}},[]);
 useEffect(()=>{mounted.current=true;const c=new AbortController();read.current=c;void Promise.resolve().then(()=>{if(!c.signal.aborted)void load(c.signal);});return()=>{mounted.current=false;read.current?.abort();write.current?.abort();};},[load]);
 function reload(){read.current?.abort();const c=new AbortController();read.current=c;void load(c.signal);}
 async function save(action:'stop'|'resume'){
  if(write.current||busy||basis===null)return;
  const payload={action,expectedVersion:basis,reason},key=JSON.stringify(payload),requestId=retry.current?.key===key?retry.current.id:crypto.randomUUID();retry.current={key,id:requestId};
  const c=new AbortController();write.current=c;read.current?.abort();setLoading(false);setBusy(true);setError('');setMessage('');
  try{const next=await request({method:'POST',headers:{'Content-Type':'application/json'},signal:c.signal,body:JSON.stringify({...payload,requestId})});if(!mounted.current||c.signal.aborted)return;setView(next);setBasis(next.state.version);retry.current=null;setMessage(`${action==='stop'?'중단':'재개'} 요청을 기록했습니다. 현재 상태: ${statusName(next.state.status)}.`);}
  catch(e){if(mounted.current&&!c.signal.aborted)setError(`${e instanceof Error?e.message:'요청을 저장하지 못했습니다.'} 입력은 보존했습니다. 응답 미확인 시 동일 입력으로 재시도하고, 충돌 시 상태를 새로고침해 최신 판을 검토하세요.`);}
  finally{write.current=null;if(mounted.current&&!c.signal.aborted)setBusy(false);}
 }
 const stale=!!view&&basis!==view.state.version,locked=loading||busy||stale,stateUnavailable=loading||busy||!!error;
 return <section aria-label="전역 실행 중단" className={styles.mission} style={{borderWidth:2,borderColor:view?.state.status==='stopped'?'#a34b32':stateUnavailable?'var(--border, #d7ddd7)':'#47715c'}}><header className={styles.header}><div><h2>전역 실행 중단</h2><strong aria-label="전역 중단 상태">{view&&!stateUnavailable?statusName(view.state.status):'최신 중단 상태 미확인'}</strong></div><Button variant="panel" size="fit" aria-label="중단 상태 새로고침" type="button" disabled={loading||busy} onClick={reload}>새로고침</Button></header>
 <p>같은 소유자의 모든 브랜드·캠페인에 적용합니다. 중단 시 신규 게시, 예산·재고 예약, Meta 활성화와 학습 승격을 차단합니다.</p><Note className={styles.note}>주문 수집·대사·정지와 복구 조회는 계속할 수 있습니다. 이미 전송한 요청의 취소 완료를 뜻하지 않으며, 재개해도 자동으로 재전송하지 않습니다. 중단 해제 상태에서도 기존 위임·권한 검사가 적용됩니다.</Note>
 {loading&&<p role="status">중단 상태를 확인하고 있습니다.</p>}{error&&<p role="alert" className={styles.error}>{error}</p>}{message&&<p role="status" className={styles.success}>{message}</p>}
 {view&&<>{stateUnavailable&&<p>마지막 조회 상태: {statusName(view.state.status)} · v{view.state.version}</p>}<dl><div><dt>마지막 조회 사유</dt><dd>{view.state.reason||'기록 없음'}</dd></div><div><dt>기록 담당 · 계정 내부 ID</dt><dd>{view.state.updatedBy??'기록 없음'}</dd></div><div><dt>기록 시각</dt><dd>{view.state.updatedAt??'기록 없음'} · v{view.state.version}</dd></div></dl>
 {stale&&<div className={styles.error}>중단 상태가 v{view.state.version}로 변경되었습니다. 위의 현재 상태와 사유를 확인하세요.<Button variant="panel" size="fit" type="button" disabled={loading||busy} onClick={()=>{setBasis(view.state.version);setError('');}}>현재 입력 유지 · 최신 중단 판 사용</Button></div>}
 {(view.canStop||view.canResume)&&<form onSubmit={event=>event.preventDefault()}><fieldset disabled={locked} className={styles.receipt}><legend>전역 중단·재개 기록</legend><label>중단·재개 사유<Textarea rows={2} maxLength={500} required value={reason} onChange={event=>{setReason(event.target.value);setMessage('');}}/></label><p className={styles.note}>개인정보·비밀값 없이 이유를 기록하세요. 관리자는 중단할 수 있고 소유자만 재개할 수 있습니다.</p><div className={styles.actions}>{view.canStop&&<Button variant="panel" size="fit" type="button" disabled={!reason.trim()} onClick={()=>void save('stop')}>모든 신규 실행 중단</Button>}{view.canResume&&<Button variant="panel" size="fit" type="button" disabled={!reason.trim()||view.state.status!=='stopped'} onClick={()=>void save('resume')}>소유자로서 실행 재개</Button>}</div></fieldset></form>}{!view.canStop&&!view.canResume&&<p>조회 전용입니다. 중단은 관리자, 재개는 소유자 권한이 필요합니다.</p>}{view.canStop&&!view.canResume&&<p>중단 상태의 재개는 소유자에게 요청하세요.</p>}
 <details><summary>전역 중단·재개 이력 ({view.hasMoreHistory?'최근 ':''}{view.history.length}건)</summary>{view.hasMoreHistory&&<p>더 오래된 기록이 있습니다. 이 화면에는 최근 100건을 표시합니다.</p>}{[...view.history].sort((a,b)=>b.version-a.version).map(row=><article key={row.id} className={styles.mission}><strong>{statusName(row.status)} · v{row.version}</strong><p>{row.reason}</p><p>기록 담당: {row.actorId}<br/>기록 시각: {dateTime(row.recordedAt)}</p></article>)}</details></>}
 </section>;
}
// 캠페인 성장·판매 탭의 중단 안내(UX-PLAN P4·결정 1). 전역 중단 조작은 연결 및 설정 > 운영 안전으로 옮겼고, 여기서는 중단 중일 때만 한 줄로 알린다.
// known: 성장 조회가 함께 실어 준 상태(GET /api/growth?include=stop). 있으면 따로 읽지 않는다(UX-PLAN-3 Q7).
export function GrowthStopBanner({known}:{known?:{status:'running'|'stopped';reason:string}|null}={}){
 const [fetched,setState]=useState<{status:'running'|'stopped';reason:string}|null>(null);
 const state=known!==undefined?known:fetched;
 useEffect(()=>{if(known!==undefined)return;const c=new AbortController();fetch('/api/growth/stop',{cache:'no-store',signal:c.signal}).then(r=>r.ok?r.json():null).then((v:unknown)=>{const s=(v as {state?:{status?:unknown;reason?:unknown}}|null)?.state;if(!c.signal.aborted&&s&&(s.status==='running'||s.status==='stopped'))setState({status:s.status,reason:typeof s.reason==='string'?s.reason:''});}).catch(()=>{});return()=>c.abort();},[known]);
 if(state?.status!=='stopped')return null;
 return <div role="status" aria-label="전역 실행 중단 안내" className={styles.warning}><b>전역 실행 중단 중</b> · 새 예약·게시·활성화가 막혀 있습니다.{state.reason?` 사유: ${state.reason}`:''} <Button variant="panel" size="fit" type="button" onClick={()=>pushNav({view:'settings'})}>운영 안전 설정 열기</Button></div>;
}
