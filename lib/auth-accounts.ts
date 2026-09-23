import {AuthError} from './auth-errors';
import {authDb,hashToken,randomToken,roleSql,type Principal,type Role} from './auth-session';
import {normalizeEmail} from './auth-request';
type Account={id:string;email:string;role:Role;stored:'admin'|'member';status:string;accepted:number;workspace_owner:string;created_at:number};
const columns=`u.id,u.email,${roleSql('u')} AS role,u.role AS stored,u.status,u.password_hash IS NOT NULL AS accepted,u.workspace_owner,u.created_at`;
export async function listAccounts(user:Principal){const result=await authDb().prepare(`SELECT ${columns} FROM auth_users u WHERE u.workspace_owner=? ORDER BY u.created_at,u.email`).bind(user.owner).all<Account>();return result.results.map(row=>({id:row.id,email:row.email,role:row.role,status:row.status,disabled:row.status==='disabled',accepted:!!row.accepted,createdAt:new Date(row.created_at).toISOString()}))}
export async function listAccountEvents(user:Principal){if(user.role!=='owner')return [];const result=await authDb().prepare("SELECT data FROM records WHERE owner=? AND kind='account_event' ORDER BY updated_at DESC,rowid DESC LIMIT 20").bind(user.owner).all<{data:string}>();return result.results.map(row=>Object.fromEntries(Object.entries(JSON.parse(row.data) as Record<string,unknown>).filter(([key])=>key!=='tokenHash')))}
// 요청자가 지금도 활성 관리자(소유자 전용 작업이면 소유자)인지 쓰기 시점에 다시 확인한다.
const guard=(owner:boolean)=>`EXISTS(SELECT 1 FROM auth_users a WHERE a.id=? AND a.workspace_owner=? AND a.role='admin' AND a.status='active'${owner?` AND ${roleSql('a')}='owner'`:''})`;
// 소유자 계정은 본인만(본인에게 허용된 작업만), 관리자 계정은 소유자만, 직원 계정은 관리자와 소유자가 관리한다. 반환값은 소유자 확인이 필요한지다.
function ownerRequired(actor:Principal,target:Account,selfAllowed=false){
 if(actor.role==='member')throw new AuthError(403,'관리자 권한이 필요합니다.');
 if(selfAllowed&&target.id===actor.id)return false;
 if(target.role==='owner')throw new AuthError(403,'소유자 계정은 소유자 본인만 변경할 수 있습니다.');
 if(target.role==='admin'&&actor.role!=='owner')throw new AuthError(403,'관리자 계정은 소유자만 관리할 수 있습니다.');
 return target.role==='admin';
}
async function findTarget(actor:Principal,userId:unknown){const row=await authDb().prepare(`SELECT ${columns} FROM auth_users u WHERE u.id=? AND u.workspace_owner=?`).bind(typeof userId==='string'?userId:'',actor.owner).first<Account>();if(!row)throw new AuthError(404,'계정을 찾을 수 없습니다.');return row}
// 계정 변경 기록은 변경과 같은 batch에서 같은 조건으로 남겨, 실제로 반영된 변경만 기록된다. 토큰 원문은 남기지 않는다.
// 링크 발급 기록에는 토큰 해시(tokenHash)를 남겨, 발급한 관리자가 해제·강등되면 그 관리자가 발급한 미사용 링크를 폐기한다(목록 응답에서는 뺀다).
function eventInsert(actor:Principal,action:string,target:{id:string;email:string},role:string|null,condition:string,values:unknown[],extra:Record<string,string>={}){
 const id=crypto.randomUUID(),at=new Date().toISOString(),data={id,action,targetId:target.id,targetEmail:target.email,...(role?{role}:{}),actor:{id:actor.id,email:actor.email},...extra,createdAt:at};
 return authDb().prepare(`INSERT INTO records(id,owner,kind,parent_id,data,updated_at) SELECT ?,?,'account_event','',?,? WHERE ${condition}`).bind(`${actor.owner}:account_event:${id}`,actor.owner,JSON.stringify(data),at,...values);
}
export async function issueToken(actor:Principal,input:Record<string,unknown>){
 const db=authDb(),action=String(input.action),invite=action==='invite',reactivate=action==='reactivate';
 let target:{id:string;email:string;stored:string},ownerOnly:boolean;
 if(invite){
  const email=normalizeEmail(input.email);
  if(input.role!=='admin'&&input.role!=='member')throw new AuthError(400,'계정 권한을 확인해 주세요.');
  if(input.role==='admin'&&actor.role!=='owner')throw new AuthError(403,'관리자 초대는 소유자만 할 수 있습니다.');
  const existing=await db.prepare(`SELECT ${columns} FROM auth_users u WHERE u.email=?`).bind(email).first<Account>();
  if(existing&&(existing.workspace_owner!==actor.owner||existing.status!=='pending'||existing.stored!==input.role))throw new AuthError(409,'해당 이메일로 초대를 발급할 수 없습니다.');
  target=existing||{id:crypto.randomUUID(),email,stored:input.role};ownerOnly=existing?ownerRequired(actor,existing):input.role==='admin';
 }else{
  const existing=await findTarget(actor,input.userId);
  if(existing.status!==(reactivate?'disabled':'active'))throw reactivate?new AuthError(409,'접근이 해제된 계정만 복구할 수 있습니다.'):new AuthError(404,'계정을 찾을 수 없습니다.');
  target=existing;ownerOnly=ownerRequired(actor,existing,!reactivate);
 }
 const token=randomToken(),now=Date.now(),hash=await hashToken(token),check=guard(ownerOnly),by=[actor.id,actor.owner];
 const statements=[];
 if(invite)statements.push(db.prepare(`INSERT OR IGNORE INTO auth_users(id,email,workspace_owner,role,status,created_at) SELECT ?,?,?,?,'pending',? WHERE ${check}`).bind(target.id,target.email,actor.owner,target.stored,now,...by));
 // 접근 복구: 해제된 계정을 초대 대기로 되돌리고 재설정 링크로 새 비밀번호를 정하게 한다.
 if(reactivate)statements.push(db.prepare(`UPDATE auth_users SET status='pending' WHERE id=? AND workspace_owner=? AND role=? AND status='disabled' AND ${check}`).bind(target.id,actor.owner,target.stored,...by));
 statements.push(db.prepare(`UPDATE auth_tokens SET used='revoked' WHERE user_id=? AND used IS NULL AND ${check}`).bind(target.id,...by));
 statements.push(db.prepare(`INSERT INTO auth_tokens(token_hash,user_id,email,owner,role,kind,expires_at,created_at) SELECT ?,id,email,workspace_owner,role,?,?,? FROM auth_users WHERE id=? AND workspace_owner=? AND role=? AND status=? AND ${check}`).bind(hash,invite?'invite':'reset',now+86400000,now,target.id,actor.owner,target.stored,invite||reactivate?'pending':'active',...by));
 statements.push(eventInsert(actor,action,target,invite?target.stored:null,'EXISTS(SELECT 1 FROM auth_tokens WHERE token_hash=?)',[hash],{tokenHash:hash}));
 const result=await db.batch(statements);if(!result[result.length-2].meta.changes)throw new AuthError(409,'계정 정보가 변경됐습니다. 다시 시도해 주세요.');return {token};
}
// 대상 관리자가 발급한 아직 쓰지 않은 초대·재설정 링크를 폐기한다(발급 기록의 tokenHash로 찾는다). condition이 참일 때만 적용된다.
const revokeIssued=(actor:Principal,issuerId:string,condition:string,values:unknown[])=>authDb().prepare(`UPDATE auth_tokens SET used='revoked' WHERE used IS NULL AND token_hash IN (SELECT json_extract(data,'$.tokenHash') FROM records WHERE owner=? AND kind='account_event' AND json_extract(data,'$.actor.id')=?) AND ${condition}`).bind(actor.owner,issuerId,...values);
export async function disableAccount(actor:Principal,userId:unknown){
 if(typeof userId!=='string'||!userId||userId===actor.id)throw new AuthError(400,'본인 계정은 비활성화할 수 없습니다.');
 const db=authDb(),target=await findTarget(actor,userId);
 const where=`id=? AND workspace_owner=? AND role=? AND (role!='admin' OR status!='active' OR (SELECT COUNT(*) FROM auth_users WHERE workspace_owner=? AND role='admin' AND status='active')>1) AND ${guard(ownerRequired(actor,target))}`,values=[userId,actor.owner,target.stored,actor.owner,actor.id,actor.owner];
 const results=await db.batch([
  eventInsert(actor,'disable',target,null,`EXISTS(SELECT 1 FROM auth_users WHERE ${where})`,values),
  db.prepare(`UPDATE auth_users SET status='disabled' WHERE ${where}`).bind(...values),
  db.prepare("DELETE FROM auth_sessions WHERE user_id=? AND EXISTS(SELECT 1 FROM auth_users WHERE id=? AND status='disabled')").bind(userId,userId),
  db.prepare("UPDATE auth_tokens SET used='revoked' WHERE user_id=? AND EXISTS(SELECT 1 FROM auth_users WHERE id=? AND status='disabled')").bind(userId,userId),
  revokeIssued(actor,userId,"EXISTS(SELECT 1 FROM auth_users WHERE id=? AND status='disabled')",[userId]),
 ]);
 if(!results[1].meta.changes)throw new AuthError(409,'마지막 관리자 계정은 비활성화할 수 없습니다.');return {ok:true};
}
// 권한 변경은 소유자만 한다. 소유자 계정은 바꿀 수 없고, 활성 관리자가 한 명 이상 남아야 한다. 수락 전 링크는 역할이 달라져 폐기한다.
export async function setRole(actor:Principal,userId:unknown,role:unknown){
 if(role!=='admin'&&role!=='member')throw new AuthError(400,'계정 권한을 확인해 주세요.');
 if(actor.role!=='owner')throw new AuthError(403,'권한 변경은 소유자만 할 수 있습니다.');
 const db=authDb(),target=await findTarget(actor,userId);
 if(target.role==='owner')throw new AuthError(403,'소유자 계정의 권한은 바꿀 수 없습니다.');
 if(target.stored===role)throw new AuthError(409,'이미 같은 권한입니다.');
 const where=`id=? AND workspace_owner=? AND role=? AND (role!='admin' OR status!='active' OR (SELECT COUNT(*) FROM auth_users WHERE workspace_owner=? AND role='admin' AND status='active')>1) AND ${guard(true)}`,values=[target.id,actor.owner,target.stored,actor.owner,actor.id,actor.owner];
 const results=await db.batch([
  eventInsert(actor,'set_role',target,role,`EXISTS(SELECT 1 FROM auth_users WHERE ${where})`,values),
  db.prepare(`UPDATE auth_tokens SET used='revoked' WHERE user_id=? AND used IS NULL AND EXISTS(SELECT 1 FROM auth_users WHERE ${where})`).bind(target.id,...values),
  // 관리자에서 직원으로 바꾸면 그 사람이 관리자일 때 발급한 링크도 폐기한다.
  ...(role==='member'?[revokeIssued(actor,target.id,`EXISTS(SELECT 1 FROM auth_users WHERE ${where})`,values)]:[]),
  db.prepare(`UPDATE auth_users SET role=? WHERE ${where}`).bind(role,...values),
 ]);
 if(!results[results.length-1].meta.changes)throw new AuthError(409,'계정 정보가 변경됐습니다. 다시 시도해 주세요.');return {ok:true};
}
// 수락 전 초대(비밀번호 없음)는 행을 지워 같은 이메일을 다시 초대할 수 있게 한다.
export async function cancelInvite(actor:Principal,userId:unknown){
 const db=authDb(),target=await findTarget(actor,userId);
 if(target.status!=='pending'||target.accepted)throw new AuthError(409,'수락 전 초대만 취소할 수 있습니다.');
 const where=`id=? AND workspace_owner=? AND role=? AND status='pending' AND password_hash IS NULL AND ${guard(ownerRequired(actor,target))}`,values=[target.id,actor.owner,target.stored,actor.id,actor.owner];
 const results=await db.batch([
  eventInsert(actor,'cancel_invite',target,null,`EXISTS(SELECT 1 FROM auth_users WHERE ${where})`,values),
  db.prepare(`DELETE FROM auth_tokens WHERE user_id=? AND EXISTS(SELECT 1 FROM auth_users WHERE ${where})`).bind(target.id,...values),
  db.prepare(`DELETE FROM auth_users WHERE ${where}`).bind(...values),
 ]);
 if(!results[2].meta.changes)throw new AuthError(409,'계정 정보가 변경됐습니다. 다시 시도해 주세요.');return {ok:true};
}
// 계정은 그대로 두고 그 계정의 모든 로그인만 끝낸다. 소유자의 로그인은 소유자 본인만 끝낼 수 있다.
export async function revokeSessions(actor:Principal,userId:unknown){
 const db=authDb(),target=await findTarget(actor,userId);
 const where=`id=? AND workspace_owner=? AND role=? AND ${guard(ownerRequired(actor,target,true))}`,values=[target.id,actor.owner,target.stored,actor.id,actor.owner];
 const results=await db.batch([
  eventInsert(actor,'revoke_sessions',target,null,`EXISTS(SELECT 1 FROM auth_users WHERE ${where})`,values),
  db.prepare(`DELETE FROM auth_sessions WHERE user_id=? AND EXISTS(SELECT 1 FROM auth_users WHERE ${where})`).bind(target.id,...values),
 ]);
 if(!results[0].meta.changes)throw new AuthError(409,'계정 정보가 변경됐습니다. 다시 시도해 주세요.');return {ok:true,self:target.id===actor.id};
}
