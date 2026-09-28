'use client';
// B3-2 Reflector 절(docs/PLAYBOOK.ko.md 'B3-2 Reflector'). 학습 규칙 탭의 운영자 선호 영역 아래에 둔다. 대표·관리자만 보인다(직원에게는 절이 없다, 서버 403과 같은 규칙).
// '규칙 초안 제안받기' → 미리보기 대화상자(보낼 본문·개인정보 탐지 결과·확인 체크) → 실행 → 결과 확인. 초안만 저장되고 승인은 운영자 선호 규칙 카드의 기존 승인 버튼(대표)이다.
// Reflector 전용 HERMES 연결 저장과 격리 확인은 대표만 한다. 스위치 b3_reflector가 꺼져 있으면 안내만 보인다.
import {useCallback,useEffect,useRef,useState} from 'react';
import {toast} from 'sonner';
import {Sparkles,RefreshCw,Send,ShieldCheck} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Checkbox} from '@/components/ui/checkbox';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription} from '@/components/ui/dialog';
import {roles} from '@/lib/agency';
import type {PiiFieldFinding} from '@/lib/pii-scan';
import {canChange,useAccount} from './account-context';

type Gate={ready:true}|{ready:false;blocked:string;reason:string};
type Cluster={role:string;corrections:number;eligible:boolean;window:{from:string;to:string}};
type Run={id:string;role:string;status:string;createdAt:string;ruleIds:string[];rejected:{index:number;reason:string}[];failure?:string;toolTrace?:boolean};
type Conn={configured:boolean;host?:string;status?:string;statusReason?:string|null;isolation:{confirmed:boolean;statement:string;confirmedAt?:string}};
type State={enabled:false}|{enabled:true;min:number;connection:Conn;gate:Gate;clusters:Cluster[];runs:Run[]};
type Preview={role:string;corrections:number;cited:number;previewHash:string;body:{instructions:string;input:string};findings:PiiFieldFinding[];blocked:boolean;gate:Gate};
const ACTIVE=['submitting','queued','in_progress'];
const roleName=(id:string)=>roles.find(r=>r.id===id)?.name??id;
const statusLabel:Record<string,string>={submitting:'전송 확인 중',queued:'접수',in_progress:'작성 중',completed:'완료',discarded:'폐기(도구 흔적)',failed:'실패',blocked:'막힘'};
const rejectLabel:Record<string,string>={over_limit:'5개 초과',text:'본문 검사',pii:'개인정보',quotes_source:'발췌 원문 인용',citations:'인용 2건 미만',citation_outside:'입력 밖 인용',duplicate:'중복'};
const kindLabel:Record<string,string>={phone:'전화번호',email:'이메일',address:'주소',payment:'결제정보',national_id:'고유식별번호',customer_id:'고객식별자'};
async function send<T=Run>(action:string,payload:Record<string,unknown>):Promise<T>{
 const r=await fetch('/api/reflector',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,...payload})}),d=await r.json() as T&{error?:string};
 if(!r.ok)throw new Error(d.error||'요청에 실패했습니다.');return d;
}
type Loaded={state:State}|{error:string};
async function fetchState(brandId:string):Promise<Loaded>{
 try{const r=await fetch('/api/reflector?brandId='+encodeURIComponent(brandId)),d=await r.json() as State&{error?:string};return r.ok?{state:d}:{error:d.error||'Reflector 상태를 불러오지 못했습니다.'}}
 catch{return {error:'Reflector 상태를 불러오지 못했습니다.'}}
}
function Connection({conn,busy,onSaved}:{conn:Conn;busy:boolean;onSaved:()=>void}){
 const[endpoint,setEndpoint]=useState(''),[key,setKey]=useState(''),[agree,setAgree]=useState(false);
 const save=async()=>{try{await send('reflector_save_connection',{endpoint,key});setKey('');toast.success('Reflector 연결을 저장했습니다. 격리 확인을 다시 해 주세요.');onSaved()}catch(e){toast.error((e as Error).message)}};
 const confirm=async()=>{try{await send('reflector_confirm_isolation',{confirmed:true});toast.success('격리 확인을 기록했습니다.');onSaved()}catch(e){toast.error((e as Error).message)}};
 return <details className="learning-frozen"><summary>Reflector 전용 HERMES 연결 · {conn.configured?`${conn.host} · ${conn.status==='ready'?'확인됨':'확인 실패'}`:'없음'} · 격리 확인 {conn.isolation.confirmed?'있음':'없음'}</summary>
  <p className="learning-meta">운영 HERMES와 다른 호스트의 격리 프로필만 등록할 수 있습니다. 키는 암호화해 저장합니다.</p>
  <div className="form-two"><Input placeholder="https://… (Reflector 프로필)" value={endpoint} onChange={e=>setEndpoint(e.target.value)} aria-label="Reflector HERMES 주소"/><Input type="password" placeholder="연결 키" value={key} onChange={e=>setKey(e.target.value)} aria-label="Reflector 연결 키"/></div>
  <div className="learning-actions"><Button size="sm" variant="outline" disabled={busy||!endpoint||!key} onClick={()=>void save()}>연결 저장</Button></div>
  {conn.configured&&!conn.isolation.confirmed&&<><label className="learning-check"><Checkbox checked={agree} onCheckedChange={v=>setAgree(v===true)}/><span>{conn.isolation.statement}</span></label><div className="learning-actions"><Button size="sm" disabled={busy||!agree} onClick={()=>void confirm()}><ShieldCheck/>격리 확인 기록</Button></div></>}
 </details>;
}
export function ReflectorSection({brandId,onDrafts}:{brandId:string;onDrafts:()=>void}){
 const account=useAccount(),allowed=canChange(account),isOwner=canChange(account,true);
 const[state,setState]=useState<State|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[preview,setPreview]=useState<Preview|null>(null),[checked,setChecked]=useState(false);
 const apply=useCallback((next:Loaded)=>{if('error' in next){setError(next.error)}else{setError('');setState(next.state)}},[]);
 const reload=useCallback(async()=>apply(await fetchState(brandId)),[brandId,apply]);
 useEffect(()=>{let active=true;if(allowed&&brandId)void fetchState(brandId).then(next=>{if(active)apply(next)});return()=>{active=false}},[allowed,brandId,apply]);
 const running=state?.enabled?state.runs.filter(r=>ACTIVE.includes(r.status)):[];
 // 진행 중 실행은 5초마다 결과를 확인한다. 완료되면 초안 목록(운영자 선호 규칙)을 다시 읽는다.
 const drafts=useRef(onDrafts);useEffect(()=>{drafts.current=onDrafts});
 const pending=running[0]?.id;
 useEffect(()=>{if(!pending)return;const t=setTimeout(async()=>{try{const x=await send('reflector_check',{id:pending});if(!ACTIVE.includes(x.status)&&x.ruleIds?.length){toast.success(`규칙 초안 ${x.ruleIds.length}건을 만들었습니다. 승인 전에는 전달하지 않습니다.`);drafts.current()}}catch(e){toast.error((e as Error).message)}await reload()},5000);return()=>clearTimeout(t)},[pending,state,reload]);
 if(!allowed)return null;
 const head=<div className="learning-card-top"><b><Sparkles size={16}/> Reflector · 규칙 초안 제안</b><Button size="sm" variant="ghost" disabled={busy} onClick={()=>void reload()}><RefreshCw/>새로고침</Button></div>;
 if(error)return <section aria-label="Reflector" style={{marginTop:32}}>{head}<p className="form-error" role="alert">{error}</p></section>;
 if(!state)return <section aria-label="Reflector" style={{marginTop:32}}>{head}<p className="learning-meta" role="status">불러오는 중입니다.</p></section>;
 if(!state.enabled)return <section aria-label="Reflector" style={{marginTop:32}}>{head}<p className="learning-note" role="note">Reflector 스위치(b3_reflector)가 꺼져 있습니다. 소유자가 설정에서 켜면 쓸 수 있습니다.</p></section>;
 const open=async(role:string)=>{setBusy(true);setChecked(false);try{setPreview(await send<Preview>('reflector_preview',{brandId,role}))}catch(e){toast.error((e as Error).message)}finally{setBusy(false)}};
 const run=async()=>{if(!preview)return;setBusy(true);try{await send('reflector_run',{brandId,role:preview.role,previewHash:preview.previewHash,confirmed:true});toast.success('Reflector에 보냈습니다. 결과를 확인하는 중입니다.');setPreview(null);await reload()}catch(e){toast.error((e as Error).message)}finally{setBusy(false)}};
 const reasonOf=(c:Cluster)=>!c.eligible?`교정 ${c.corrections}건 · ${state.min}건 이상 필요`:!state.gate.ready?state.gate.reason:running.some(r=>r.role===c.role)?'진행 중인 실행이 있습니다':'';
 return <section aria-label="Reflector" style={{marginTop:32}}>{head}
  <p className="learning-note" role="note">같은 브랜드·역할의 교정이 90일 안에 {state.min}건 이상이면 교정 사유와 바뀐 부분 발췌를 격리된 HERMES 프로필에 1회 보내 규칙 초안(최대 5개, 인용 필수)을 받습니다. 보내기 전에 본문을 확인하고, 개인정보로 보이는 값이 있으면 보내지 않습니다. 초안은 승인 전까지 전달되지 않습니다.</p>
  {isOwner?<Connection conn={state.connection} busy={busy} onSaved={()=>void reload()}/>:!state.gate.ready&&<p className="learning-meta">{state.gate.reason}</p>}
  {state.clusters.length?<ul className="learning-meta" aria-label="역할별 제안 조건">{state.clusters.map(c=>{const why=reasonOf(c);return <li key={c.role}><b>{roleName(c.role)}</b> · 교정 {c.corrections}건 <Button size="sm" variant="outline" disabled={busy||!!why} title={why||undefined} onClick={()=>void open(c.role)}><Sparkles/>규칙 초안 제안받기</Button>{why&&<small> {why}</small>}</li>})}</ul>:<p className="learning-meta">이 브랜드에는 90일 안 교정 기록이 없습니다.</p>}
  {state.runs.length>0&&<ul className="learning-meta" aria-label="Reflector 실행">{state.runs.map(r=><li key={r.id}>{new Date(r.createdAt).toLocaleString('ko-KR')} · {roleName(r.role)} · {statusLabel[r.status]??r.status} · 초안 {r.ruleIds.length}건{r.rejected.length?` · 거절 ${r.rejected.map(x=>rejectLabel[x.reason]??x.reason).join(', ')}`:''}{r.failure?` · ${r.failure}`:''}</li>)}</ul>}
  <Dialog open={!!preview} onOpenChange={v=>!v&&!busy&&setPreview(null)}><DialogContent className="learning-dialog"><DialogHeader><DialogTitle>보낼 본문 확인 · {preview&&roleName(preview.role)}</DialogTitle><DialogDescription>교정 {preview?.corrections}건 중 최근 {preview?.cited}건을 가명 라벨로 보냅니다. 검토 메모 원문·브랜드 메모·점포·주문·행위자 정보는 넣지 않습니다.</DialogDescription></DialogHeader>
   {preview&&<>
    {preview.blocked?<p className="form-error" role="alert">개인정보로 보이는 값이 있어 보낼 수 없습니다: {preview.findings.map(f=>`${f.field} ${kindLabel[f.kind]??f.kind} ${f.count}건`).join(', ')}. 원 작업물·브랜드 정보를 고친 뒤 다시 미리 보세요.</p>:<p className="learning-meta">개인정보 패턴 탐지 0건 · 사람 이름·민감정보는 패턴으로 다 잡지 못하니 본문을 직접 확인하세요.</p>}
    {!preview.gate.ready&&<p className="form-error" role="alert">{preview.gate.reason}</p>}
    <pre className="learning-text" style={{maxHeight:320,overflow:'auto',whiteSpace:'pre-wrap'}} aria-label="보낼 본문">{preview.body.instructions+'\n\n'+JSON.stringify(JSON.parse(preview.body.input),null,1)}</pre>
    <label className="learning-check"><Checkbox checked={checked} onCheckedChange={v=>setChecked(v===true)} disabled={preview.blocked}/><span>보낼 본문을 확인했고 개인정보가 없습니다.</span></label>
    <div className="learning-actions"><Button disabled={busy||!checked||preview.blocked||!preview.gate.ready} onClick={()=>void run()}><Send/>Reflector로 보내기</Button></div>
   </>}
  </DialogContent></Dialog>
 </section>;
}
