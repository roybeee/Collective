import {AuthError,invalidCredentials} from './auth-errors';
import {authDb,hashToken,randomToken,roleSql,sessionInsert,type Principal,type Role} from './auth-session';
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
// 셀프 가입(G8, 스위치 self_signup, docs/SELF-SIGNUP.ko.md). 새 계정은 자기 id를 workspace_owner로 갖는 새 워크스페이스의 첫 관리자(=소유자)다.
// 가입 대기 계정은 status 'pending'이고 이메일 확인 링크(auth_tokens kind 'verify', 24시간 일회용)로 활성화한다. 확인 전에는 로그인할 수 없다.
// 예시 브랜드·캠페인은 넣지 않는다(workspace_origin 행, lib/server.ts seedBrands). 동의 기록은 signup_consent 1행에 남긴다(비밀번호·토큰 원문 없음).
export const SIGNUP_TERMS_VERSION='terms-draft-2026-11',SIGNUP_PRIVACY_VERSION='privacy-draft-2026-11';
const VERIFY_KIND='verify',VERIFY_TTL=86400000;
const signupConflict=()=>new AuthError(409,'이 이메일로는 새로 가입할 수 없습니다. 이미 계정이 있으면 로그인해 주세요.');
export function signupConsents(input:Record<string,unknown>){
 if(input.termsAccepted!==true||input.privacyAccepted!==true)throw new AuthError(400,'이용약관과 개인정보 수집·이용에 동의해 주세요. 두 항목은 필수입니다.');
 if(input.marketingOptIn!==undefined&&typeof input.marketingOptIn!=='boolean')throw new AuthError(400,'마케팅 수신 동의 값을 확인해 주세요.');
 return {termsVersion:SIGNUP_TERMS_VERSION,privacyVersion:SIGNUP_PRIVACY_VERSION,marketingOptIn:input.marketingOptIn===true};
}
// 같은 이메일의 확인 전 셀프 가입은 새 비밀번호와 새 링크로 다시 시작한다(이전 링크 폐기). 초대·기존 계정 이메일은 409다.
export async function startSelfSignup(email:string,passwordHash:string,consents:ReturnType<typeof signupConsents>){
 const db=authDb(),existing=await db.prepare('SELECT id,workspace_owner,status FROM auth_users WHERE email=?').bind(email).first<{id:string;workspace_owner:string;status:string}>();
 if(existing&&(existing.status!=='pending'||existing.workspace_owner!==existing.id))throw signupConflict();
 const id=existing?.id??crypto.randomUUID(),token=randomToken(),hash=await hashToken(token),now=Date.now(),at=new Date(now).toISOString();
 const statements=[
  db.prepare("INSERT INTO auth_users(id,email,password_hash,workspace_owner,role,status,created_at) VALUES(?,?,?,?,'admin','pending',?) ON CONFLICT(id) DO UPDATE SET password_hash=excluded.password_hash WHERE auth_users.status='pending' AND auth_users.workspace_owner=auth_users.id").bind(id,email,passwordHash,id,now),
  db.prepare('UPDATE auth_tokens SET used=? WHERE user_id=? AND used IS NULL').bind('revoked',id),
  db.prepare("INSERT INTO auth_tokens(token_hash,user_id,email,owner,role,kind,expires_at,created_at) SELECT ?,id,email,workspace_owner,role,?,?,? FROM auth_users WHERE id=? AND email=? AND status='pending' AND workspace_owner=id AND password_hash=?").bind(hash,VERIFY_KIND,now+VERIFY_TTL,now,id,email,passwordHash),
  db.prepare('INSERT OR IGNORE INTO records(id,owner,kind,parent_id,data,updated_at) VALUES(?,?,?,?,?,?)').bind(`${id}:workspace_origin:current`,id,'workspace_origin','',JSON.stringify({selfSignup:true,createdAt:at}),at),
  db.prepare('INSERT INTO records(id,owner,kind,parent_id,data,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data,updated_at=excluded.updated_at').bind(`${id}:signup_consent:current`,id,'signup_consent','',JSON.stringify({...consents,consentedAt:at}),at),
 ];
 // 동시에 같은 새 이메일로 가입하면 이메일 고유 색인 충돌로 batch 전체가 되돌려진다. 이긴 쪽만 남고 진 쪽은 409다.
 let results:D1Result[];
 try{results=await db.batch(statements)}catch{throw signupConflict()}
 if(!results[2].meta.changes)throw new AuthError(409,'가입 정보가 변경됐습니다. 다시 시도해 주세요.');
 return {token};
}
// 이메일 확인: 링크 일회 소비·계정 활성화·로그인 세션 생성을 한 batch로 한다. 이메일이 링크와 다르거나 만료·사용된 링크는 401이다.
export async function verifySelfSignup(email:string,token:unknown){
 if(typeof token!=='string'||!/^[a-f0-9]{64}$/.test(token))throw invalidCredentials();
 const db=authDb(),hash=await hashToken(token),now=Date.now();
 const target=await db.prepare(`SELECT u.id,u.email,u.password_hash AS passwordHash,u.workspace_owner AS owner,${roleSql('u')} AS role FROM auth_tokens t JOIN auth_users u ON u.id=t.user_id WHERE t.token_hash=? AND t.email=? AND t.email=u.email AND t.kind=? AND t.used IS NULL AND t.expires_at>? AND u.status='pending' AND u.workspace_owner=u.id`).bind(hash,email,VERIFY_KIND,now).first<{id:string;email:string;passwordHash:string|null;owner:string;role:Role}>();
 if(!target?.passwordHash)throw invalidCredentials();
 const nonce=randomToken(),session=randomToken(),owned='EXISTS(SELECT 1 FROM auth_tokens WHERE token_hash=? AND used=?)';
 const results=await db.batch([
  db.prepare("UPDATE auth_tokens SET used=? WHERE token_hash=? AND used IS NULL AND expires_at>? AND EXISTS(SELECT 1 FROM auth_users WHERE id=auth_tokens.user_id AND status='pending')").bind(nonce,hash,now),
  db.prepare(`UPDATE auth_users SET status='active' WHERE id=? AND status='pending' AND ${owned}`).bind(target.id,hash,nonce),
  db.prepare(`UPDATE auth_tokens SET used='revoked' WHERE user_id=? AND used IS NULL AND ${owned}`).bind(target.id,hash,nonce),
  sessionInsert(await hashToken(session),target.id,target.passwordHash),
 ]);
 if(!results[0].meta.changes||!results[3].meta.changes)throw invalidCredentials();
 const user:Principal={id:target.id,email:target.email,role:target.role,owner:target.owner};
 return {user,token:session};
}
