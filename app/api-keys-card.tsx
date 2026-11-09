'use client';
import {useEffect,useState,type FormEvent} from 'react';
import {toast} from 'sonner';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {NativeSelect,NativeSelectOption} from '@/components/ui/native-select';
import {EmptyLine} from '@/components/app/empty-line';
import {MetaLine} from '@/components/app/meta-line';
import {askConfirm} from '@/components/app/confirm-dialog';
import {notifySaved} from '@/lib/ui/notify';
import {API_KEY_DAY_CHOICES,API_KEY_DEFAULT_DAYS,API_KEY_LABEL_MAX,API_KEY_SCOPE_LABELS,API_KEY_SCOPES,API_KEY_STATE_LABELS,maskedKey,type ApiKeyEntry,type ApiKeyScope} from '@/lib/api-keys';

// API 키 카드(G9, docs/MCP-SERVER.ko.md): 외부 AI 도구(Claude·ChatGPT)가 MCP 엔드포인트에 쓰는 키의 목록, 만들기, 취소. 서버(/api/api-keys)가 판정하고 화면은 받은 값을 그대로 보인다.
// 키 원문은 만든 직후 응답에만 있어 이 카드 안에서만 한 번 보인다. 새로고침하면 다시 볼 수 없다(취소 뒤 새로 만든다).
// 연결 및 설정 화면에 붙이는 일은 설정 화면 담당 레인이 한다(docs/MCP-SERVER.ko.md '화면 연결'). 이 파일은 내보내기만 한다.
const API='/api/api-keys';
type ListResponse={enabled:boolean;keys:ApiKeyEntry[]};
type Created=ApiKeyEntry&{token:string};
const kst=(iso:string)=>new Date(iso).toLocaleString('ko-KR',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'});
async function readJson<T>(response:Response,fallback:string):Promise<T>{
 const data=await response.json().catch(()=>({})) as T&{error?:string};
 if(!response.ok)throw new Error(data.error||fallback);
 return data;
}
const getKeys=(signal?:AbortSignal)=>fetch(API,{signal,cache:'no-store',credentials:'same-origin'}).then(r=>readJson<ListResponse>(r,'API 키를 불러오지 못했습니다.'));
const postKey=<T,>(body:Record<string,unknown>)=>fetch(API,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}).then(r=>readJson<T>(r,'요청을 처리하지 못했습니다.'));
export const mcpEndpoint=(origin:string)=>`${origin}/api/mcp`;

export function ApiKeysCard({canManage}:{canManage:boolean}){
 const [list,setList]=useState<ListResponse|null>(null),[round,setRound]=useState(0),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const [label,setLabel]=useState(''),[scope,setScope]=useState<ApiKeyScope>('read'),[days,setDays]=useState(String(API_KEY_DEFAULT_DAYS)),[created,setCreated]=useState<Created|null>(null);
 useEffect(()=>{
  if(!canManage)return;
  const controller=new AbortController();
  void getKeys(controller.signal).then(d=>{if(!controller.signal.aborted){setList(d);setError('')}}).catch(e=>{if(!controller.signal.aborted)setError((e as Error).message)});
  return()=>controller.abort();
 },[round,canManage]);
 async function run(task:()=>Promise<void>){
  setBusy(true);
  try{await task();setError('')}catch(e){setError((e as Error).message)}finally{setBusy(false);setRound(n=>n+1)}
 }
 function create(e:FormEvent){
  e.preventDefault();
  void run(async()=>{
   const key=await postKey<Created>({action:'create',label:label.trim(),scope,days:Number(days)});
   setCreated(key);setLabel('');
   notifySaved('API 키를 만들었습니다.',{description:'키는 지금만 보입니다. 복사해 AI 도구에 넣으세요.'});
  });
 }
 async function revoke(entry:ApiKeyEntry){
  const ok=await askConfirm({title:`「${entry.label}」 API 키를 취소할까요?`,fields:{what:`${maskedKey(entry)}, ${API_KEY_SCOPE_LABELS[entry.scope]} 범위`,reversible:'되돌릴 수 없습니다. 필요하면 새 키를 만듭니다.'},impact:'이 키를 쓰는 AI 도구는 다음 요청부터 연결이 끊깁니다.',undo:'취소한 키는 다시 켤 수 없습니다.',confirmLabel:'키 취소',danger:true});
  if(!ok)return;
  await run(async()=>{await postKey({action:'revoke',id:entry.id});if(created?.id===entry.id)setCreated(null);notifySaved('API 키를 취소했습니다.')});
 }
 async function copy(value:string){
  try{await navigator.clipboard.writeText(value);notifySaved('API 키를 복사했습니다.')}catch{toast.error('복사하지 못했습니다. 키를 직접 선택해 복사하세요.')}
 }
 if(!canManage)return <section className="form-stack" aria-label="API 키"><h5>API 키</h5><p className="subtle-note">대표·관리자만 API 키를 보고 만들 수 있습니다.</p></section>;
 if(!list)return error?<p className="form-error" role="alert">{error}</p>:<p className="loading-line" role="status">API 키를 불러오고 있습니다.</p>;
 const reason=list.enabled?'':'MCP 서버 기능이 꺼져 있습니다. 소유자가 켭니다.';
 return <section className="form-stack" aria-label="API 키">
  <h5>API 키</h5>
  <p className="subtle-note">Claude·ChatGPT 같은 AI 도구가 이 워크스페이스를 읽고 초안을 저장할 때 쓰는 키입니다. 승인·발행·지출·고객 발송은 키로 할 수 없습니다.</p>
  <form className="form-two" onSubmit={create}>
   <label className="store-field"><span>키 이름</span><Input value={label} maxLength={API_KEY_LABEL_MAX} required disabled={busy||!list.enabled} onChange={e=>setLabel(e.target.value)} placeholder="예: Claude Desktop"/></label>
   <label className="store-field"><span>범위</span><NativeSelect value={scope} disabled={busy||!list.enabled} onChange={e=>setScope(e.target.value as ApiKeyScope)}>{API_KEY_SCOPES.map(s=><NativeSelectOption key={s} value={s}>{API_KEY_SCOPE_LABELS[s]}</NativeSelectOption>)}</NativeSelect></label>
   <label className="store-field"><span>유효 기간</span><NativeSelect value={days} disabled={busy||!list.enabled} onChange={e=>setDays(e.target.value)}>{API_KEY_DAY_CHOICES.map(d=><NativeSelectOption key={d} value={String(d)}>{`${d}일`}</NativeSelectOption>)}</NativeSelect></label>
   <div className="form-actions"><Button type="submit" size="sm" disabled={busy||!list.enabled} disabledReason={reason}>API 키 만들기</Button></div>
  </form>
  {created&&<div className="notice" role="status" aria-label="새 API 키">
   <p><b>{created.label}</b> 키입니다. 지금만 보입니다. 연결 주소는 {mcpEndpoint(typeof window==='undefined'?'':window.location.origin)}입니다.</p>
   <Input readOnly aria-label="API 키" value={created.token} onFocus={e=>e.currentTarget.select()}/>
   <div className="form-actions"><Button type="button" size="sm" variant="outline" onClick={()=>void copy(created.token)}>키 복사</Button></div>
  </div>}
  {error&&<p className="form-error" role="alert">{error}</p>}
  {!list.keys.length&&<EmptyLine className="subtle-note" next="키 이름과 범위를 고르고 API 키 만들기를 누르세요.">아직 만든 API 키가 없습니다.</EmptyLine>}
  {!!list.keys.length&&<ul className="artifact-list" aria-label="API 키 목록">{list.keys.map(k=><li key={k.id}>
   <MetaLine items={[<b key="label">{k.label}</b>,maskedKey(k),API_KEY_SCOPE_LABELS[k.scope],API_KEY_STATE_LABELS[k.state],`만료 ${kst(k.expiresAt)}`,k.lastUsedAt?`마지막 사용 ${kst(k.lastUsedAt)}`:'사용 전']}/>
   {k.state==='active'&&<Button size="xs" variant="outline" disabled={busy} onClick={()=>void revoke(k)}>{`${k.label} 키 취소`}</Button>}
  </li>)}</ul>}
 </section>;
}
