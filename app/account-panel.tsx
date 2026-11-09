'use client';
import {NativeSelect} from '@/components/ui/native-select';
import {Input} from '@/components/ui/input';
import {CardButton} from '@/components/app/card-button';
import {MetaLine} from '@/components/app/meta-line';
import {Button} from '@/components/ui/button';
import {askConfirm} from '@/components/app/confirm-dialog';
import {Checkbox} from '@/components/ui/checkbox';
import {SCOPED_ROLES,isScopedRole,scopedRoleDescriptions,scopedRoleLabels,type ScopedRole} from '@/lib/access';
import {accessLabel,type AccessView,type ScopeNames} from './account-context';
import {LocaleToggle} from '@/components/app/locale-toggle';

import {useCallback,useEffect,useState,type FormEvent} from 'react';
import {Dialog,DialogContent,DialogDescription,DialogHeader,DialogTitle} from '@/components/ui/dialog';
import {authRequest,roleLabel,type AccountUser} from './auth-client';

type ManagedAccount=AccountUser&{status:'pending'|'active'|'disabled';disabled:boolean;accepted:boolean;createdAt:string;access?:AccessView};
// G7 범위 역할: 서버가 스위치를 켰거나 멤버십이 있을 때만 scope를 보낸다(lib/access-accounts.ts accessOverview).
type ScopeInfo={enabled:boolean;brands:{id:string;name:string}[];stores:{id:string;name:string;brandId:string}[];changes:{id:string;targetEmail:string;before:AccessView|{role:'member'}|null;after:AccessView|{role:'member'};actor?:{email:string|null};createdAt:string}[]};
type InviteRole='member'|'admin'|ScopedRole;
type ScopeDraft={role:ScopedRole;brandIds:string[];storeIds:string[]};
const baseRoleNotes:Record<'member'|'admin',string>={member:'모든 브랜드를 보고 작성·AI 실행을 합니다. 최종 승인·발행·연결은 관리자가 합니다.',admin:'모든 브랜드의 승인·발행·연결과 직원 계정을 관리합니다.'};
const toggle=(list:readonly string[],id:string,on:boolean)=>on?[...new Set([...list,id])]:list.filter(x=>x!==id);
const changeLabel=(v:AccessView|{role:'member'}|null,names:ScopeNames)=>!v?'없음':v.role==='member'?'직원(범위 없음)':accessLabel(v as AccessView,names);
// 범위 선택: 브랜드 매니저·검토자는 브랜드, 점포 매니저는 지점을 고른다(점포 매니저의 브랜드는 서버가 지점으로 정한다).
function ScopeFields({scope,draft,onChange,disabled}:{scope:ScopeInfo;draft:ScopeDraft;onChange:(next:ScopeDraft)=>void;disabled:boolean}){
 const stores=draft.role==='store_manager';
 const items=stores?scope.stores.map(s=>({id:s.id,name:`${s.name}(${scope.brands.find(b=>b.id===s.brandId)?.name||s.brandId})`})):scope.brands;
 const chosen=stores?draft.storeIds:draft.brandIds;
 return <fieldset className="auth-scope-fields grid gap-2 rounded-lg border p-3" disabled={disabled}><legend className="px-1 text-sm font-semibold">{stores?'담당 지점':'담당 브랜드'}</legend>{items.length?items.map(item=><label key={item.id} className="flex items-center gap-2 text-sm"><Checkbox checked={chosen.includes(item.id)} onCheckedChange={v=>onChange(stores?{...draft,storeIds:toggle(draft.storeIds,item.id,v===true)}:{...draft,brandIds:toggle(draft.brandIds,item.id,v===true)})}/>{item.name}</label>):<small>{stores?'등록한 지점이 없습니다.':'등록한 브랜드가 없습니다.'}</small>}</fieldset>;
}
type AccountEvent={id:string;action:string;targetEmail:string;role?:'admin'|'member';actor?:{id:string;email:string|null};createdAt:string};
type AccountAction=[label:string,input:Record<string,unknown>,question?:string];
const eventLabels:Record<string,string>={invite:'초대 링크 발급',reset:'비밀번호 재설정 링크 발급',reactivate:'접근 복구',disable:'접근 해제',set_role:'권한 변경',cancel_invite:'초대 취소',revoke_sessions:'모든 로그인 종료',lockout:'로그인 실패 50회 초과, 시도 간격 늘림'};
// 계정 동작 확인창의 영향·되돌림 문장(공용 확인 대화상자 계약: 무엇·영향·되돌리기).
const confirmCopy:Record<string,{impact:string;undo:string}>={revoke_sessions:{impact:'그 계정의 모든 기기에서 로그인이 끝납니다. 계정과 권한은 그대로입니다.',undo:'다시 로그인하면 바로 쓸 수 있습니다.'},cancel_invite:{impact:'보낸 초대 링크가 더 이상 열리지 않습니다.',undo:'같은 이메일로 다시 초대할 수 있습니다.'},reactivate:{impact:'계정이 다시 로그인할 수 있고 새 비밀번호 재설정 링크가 만들어집니다.',undo:'접근 해제로 다시 막을 수 있습니다.'},disable:{impact:'이 계정은 로그인할 수 없고 기존 로그인도 끝납니다.',undo:'접근 복구로 되돌릴 수 있습니다.'}};
const notices:Record<string,string>={set_access:'범위 역할을 바꿨습니다. 그 계정의 다음 요청부터 적용됩니다.',disable:'계정 접근을 해제했습니다. 기존 로그인도 종료됩니다.',revoke_sessions:'해당 계정의 모든 로그인을 종료했습니다.',set_role:'권한을 변경했습니다. 초대 대기 계정은 초대 링크를 다시 발급하세요.',cancel_invite:'초대를 취소했습니다. 같은 이메일로 다시 초대할 수 있습니다.'};

export function AccountPanel({user,onClose,onSignedOut}:{user:AccountUser;onClose:()=>void;onSignedOut:()=>void}){
 const[accounts,setAccounts]=useState<ManagedAccount[]>([]);const[events,setEvents]=useState<AccountEvent[]>([]);const[email,setEmail]=useState('');const[role,setRole]=useState<InviteRole>('member');
 const[scope,setScope]=useState<ScopeInfo|null>(null);const[picked,setPicked]=useState<ScopeDraft>({role:'brand_manager',brandIds:[],storeIds:[]});const[editing,setEditing]=useState<(ScopeDraft&{userId:string})|null>(null);
 const[link,setLink]=useState('');const[pending,setPending]=useState(false);const[error,setError]=useState('');const[notice,setNotice]=useState('');
 const load=useCallback((signal?:AbortSignal)=>authRequest<{accounts:ManagedAccount[];events?:AccountEvent[];scope?:ScopeInfo}>('/api/accounts',undefined,signal).then(r=>{setAccounts(r.accounts);setEvents(r.events||[]);setScope(r.scope||null)}),[]);
 useEffect(()=>{const controller=new AbortController();load(controller.signal).catch(e=>{if(!controller.signal.aborted)setError(e.message)});return()=>controller.abort()},[load]);
 async function perform(input:Record<string,unknown>,question?:string){
  if(pending||(question&&!(await askConfirm({title:question,...(confirmCopy[String(input.action)]??{impact:'',undo:''})}))))return;setPending(true);setError('');setNotice('');setLink('');
  try{
   const result=await authRequest<{token?:string;self?:boolean}>('/api/accounts',input);
   if(result.self){onSignedOut();return;}
   if(result.token){setLink(`${location.origin}/#invite=${encodeURIComponent(result.token)}`);setNotice('링크를 복사해 해당 직원에게 직접 전달하세요. 이메일은 자동 발송되지 않습니다.');}
   else setNotice(notices[String(input.action)]||'변경했습니다.');
   if(input.action==='set_access')setEditing(null);
   await load();
  }catch(e){setError(e instanceof Error?e.message:'계정 요청을 처리하지 못했습니다.');}finally{setPending(false);}
 }
 async function copy(){try{await navigator.clipboard.writeText(link);setNotice('초대 링크를 복사했습니다. 해당 직원에게만 전달하세요.')}catch{setNotice('링크를 선택해 직접 복사하세요.')}}
 // 소유자 계정은 본인만, 관리자 계정은 소유자만, 직원 계정은 관리자와 소유자가 관리한다(서버도 같은 규칙으로 403을 낸다).
 function actions(account:ManagedAccount):AccountAction[]{
  const self=account.id===user.id,target={userId:account.id},other=account.role==='admin'?'member':'admin';
  if(self)return account.status==='active'?[['모든 로그인 종료',{action:'revoke_sessions',...target},'이 계정의 모든 기기에서 로그아웃할까요? 지금 화면도 로그아웃됩니다.']]:[];
  if(account.role==='owner'||(account.role==='admin'&&user.role!=='owner'))return [];
  const list:AccountAction[]=[];
  if(account.status==='active')list.push(['비밀번호 재설정 링크',{action:'reset',...target}],['모든 로그인 종료',{action:'revoke_sessions',...target},`${account.email} 계정의 모든 기기에서 로그아웃할까요?`]);
  if(account.status==='pending')list.push(['초대 링크 재발급',{action:'invite',email:account.email,role:account.role}]);
  if(account.status==='pending'&&!account.accepted)list.push(['초대 취소',{action:'cancel_invite',...target},`${account.email} 초대를 취소할까요?`]);
  if(account.status==='disabled')list.push(['접근 복구',{action:'reactivate',...target},`${account.email} 계정을 복구하고 비밀번호 재설정 링크를 만들까요?`]);
  const to=other==='admin'?'관리자로':'직원으로';
  if(user.role==='owner'&&account.status!=='disabled'&&!account.access)list.push([`${to} 권한 변경`,{action:'set_role',role:other,...target},`${account.email} 계정의 권한을 ${to} 바꿀까요?`]);
  if(account.access&&account.status!=='disabled')list.push(['범위 해제(직원으로)',{action:'set_access',role:'member',...target},`${account.email} 계정의 범위 역할을 해제할까요? 모든 브랜드를 보는 직원이 됩니다.`]);
  if(account.status==='active'||(account.status==='pending'&&account.accepted))list.push(['접근 해제',{action:'disable',...target},`${account.email} 계정의 접근을 해제할까요?`]);
  return list;
 }
 // 범위 역할 지정: 스위치가 켜졌고 접근 중인 직원 계정(본인 제외)만. 해제는 위 목록의 '범위 해제'로 스위치와 무관하게 할 수 있다.
 const canScope=(account:ManagedAccount)=>!!scope?.enabled&&account.role==='member'&&account.status!=='disabled'&&account.id!==user.id;
 return <Dialog open onOpenChange={open=>{if(!open)onClose()}}><DialogContent className="auth-dialog"><DialogHeader><DialogTitle>팀 계정 관리</DialogTitle><DialogDescription>초대한 직원은 이 워크스페이스의 업무 자료를 함께 사용합니다.{user.role==='owner'?'':' 관리자 계정의 초대·변경은 소유자만 할 수 있습니다.'}</DialogDescription></DialogHeader>
  {/* 화면 언어(G6 1단계). 머리 띠가 아니라 계정 메뉴에서 바꾼다(홈 첫 로딩 예산). 계정 메뉴가 없는 헤더 인증에서는 설정 > 팀·권한에 같은 선택이 있다. */}
  <LocaleToggle className="mb-2"/>
  <form className="auth-invite-form" onSubmit={e=>{e.preventDefault();const r=role==='admin'&&user.role!=='owner'?'member':role;void perform({action:'invite',email,...(isScopedRole(r)?{role:r,brandIds:picked.brandIds,storeIds:picked.storeIds}:{role:r})})}}>
   <label>초대할 이메일<Input type="email" required maxLength={254} value={email} onChange={e=>setEmail(e.target.value)} disabled={pending}/></label>
   {(user.role==='owner'||scope?.enabled)&&<label>계정 권한<NativeSelect value={role} onChange={e=>{const next=e.target.value as InviteRole;setRole(next);if(isScopedRole(next))setPicked({...picked,role:next})}} disabled={pending}><option value="member">직원</option>{user.role==='owner'&&<option value="admin">관리자</option>}{scope?.enabled&&SCOPED_ROLES.map(r=><option key={r} value={r}>{scopedRoleLabels[r]}</option>)}</NativeSelect><small className="auth-role-note block text-xs">{isScopedRole(role)?scopedRoleDescriptions[role]:baseRoleNotes[role]}</small></label>}
   {scope?.enabled&&isScopedRole(role)&&<ScopeFields scope={scope} draft={picked} onChange={setPicked} disabled={pending}/>}
   <Button className="auth-primary" disabled={pending}>초대 링크 만들기</Button>
  </form>
  {error&&<p className="auth-error" role="alert">{error}</p>}{notice&&<p className="auth-notice" role="status">{notice}</p>}
  {link&&<div className="auth-link"><label>초대·재설정 링크<Input readOnly value={link} onFocus={e=>e.target.select()}/></label><CardButton type="button" onClick={()=>void copy()}>링크 복사</CardButton><small>24시간 동안 한 번만 사용할 수 있습니다.</small></div>}
  <ul className="auth-accounts">{accounts.map(account=>{const list=actions(account);return <li key={account.id}><div><strong>{account.email}</strong><small><MetaLine items={[account.access&&scope?accessLabel(account.access,scope):roleLabel(account.role),account.disabled?'접근 해제됨':account.status==='pending'?'초대 대기':'',account.id===user.id&&'내 계정']}/></small></div>{(list.length>0||canScope(account))&&<div className="auth-account-actions">{list.map(([label,input,question])=><CardButton key={label} type="button" disabled={pending} onClick={()=>void perform(input,question)}>{label}</CardButton>)}{canScope(account)&&<CardButton type="button" disabled={pending} onClick={()=>setEditing({userId:account.id,role:account.access?.role??'brand_manager',brandIds:[...account.access?.brandIds??[]],storeIds:[...account.access?.storeIds??[]]})}>범위 역할 지정</CardButton>}</div>}
   {editing?.userId===account.id&&scope&&<div className="auth-scope-editor grid w-full gap-2"><label>범위 역할<NativeSelect value={editing.role} onChange={e=>setEditing({...editing,role:e.target.value as ScopedRole})} disabled={pending}>{SCOPED_ROLES.map(r=><option key={r} value={r}>{scopedRoleLabels[r]}</option>)}</NativeSelect><small className="auth-role-note block text-xs">{scopedRoleDescriptions[editing.role]}</small></label><ScopeFields scope={scope} draft={editing} onChange={next=>setEditing({...editing,...next})} disabled={pending}/><div className="auth-account-actions"><CardButton type="button" disabled={pending} onClick={()=>void perform({action:'set_access',userId:account.id,role:editing.role,brandIds:editing.brandIds,storeIds:editing.storeIds})}>범위 저장</CardButton><CardButton type="button" disabled={pending} onClick={()=>setEditing(null)}>닫기</CardButton></div></div>}</li>})}</ul>
  {scope&&scope.changes.length>0&&<section className="auth-events" aria-label="최근 범위 변경"><h3>최근 범위 변경</h3><ol>{scope.changes.map(c=><li key={c.id}><time dateTime={c.createdAt}>{new Date(c.createdAt).toLocaleString('ko-KR')}</time><MetaLine items={[c.actor?.email||'알 수 없음',c.targetEmail,`${changeLabel(c.before,scope)} → ${changeLabel(c.after,scope)}`]}/></li>)}</ol></section>}
  {user.role==='owner'&&<section className="auth-events" aria-label="최근 계정 변경"><h3>최근 계정 변경</h3>{events.length?<ol>{events.map(event=><li key={event.id}><time dateTime={event.createdAt}>{new Date(event.createdAt).toLocaleString('ko-KR')}</time><MetaLine items={[event.actor?event.actor.email||'알 수 없음':'시스템',`${eventLabels[event.action]||event.action}${event.role?`(${roleLabel(event.role)})`:''}`,event.targetEmail]}/></li>)}</ol>:<small>아직 기록이 없습니다.</small>}</section>}
 </DialogContent></Dialog>;
}

export function PasswordPanel({onClose,onChanged}:{onClose:()=>void;onChanged:()=>void}){
 const[currentPassword,setCurrentPassword]=useState('');const[password,setPassword]=useState('');const[confirmation,setConfirmation]=useState('');const[error,setError]=useState('');const[pending,setPending]=useState(false);
 async function submit(event:FormEvent){
  event.preventDefault();if(pending)return;setError('');if(password!==confirmation){setError('비밀번호가 일치하지 않습니다.');return;}setPending(true);
  try{await authRequest('/api/auth',{action:'change_password',currentPassword,password});onChanged();}catch(e){setError(e instanceof Error?e.message:'변경하지 못했습니다.');}finally{setPending(false);}
 }
 return <Dialog open onOpenChange={open=>{if(!open&&!pending)onClose()}}><DialogContent className="auth-dialog"><DialogHeader><DialogTitle>비밀번호 변경</DialogTitle><DialogDescription>다른 기기의 로그인도 종료됩니다.</DialogDescription></DialogHeader><form onSubmit={submit}>
  <label>현재 비밀번호<Input type="password" autoComplete="current-password" value={currentPassword} onChange={e=>setCurrentPassword(e.target.value)} required maxLength={128} disabled={pending}/></label>
  <label>새 비밀번호<Input type="password" autoComplete="new-password" value={password} onChange={e=>setPassword(e.target.value)} required minLength={12} maxLength={128} disabled={pending}/></label>
  <label>새 비밀번호 확인<Input type="password" autoComplete="new-password" value={confirmation} onChange={e=>setConfirmation(e.target.value)} required minLength={12} maxLength={128} disabled={pending}/></label>
  {error&&<p className="auth-error" role="alert">{error}</p>}<Button className="auth-primary" disabled={pending}>{pending?'변경 중…':'비밀번호 변경'}</Button>
 </form></DialogContent></Dialog>;
}
