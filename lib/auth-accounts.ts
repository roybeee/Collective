import {AuthError} from './auth-errors';
import {authDb,hashToken,randomToken,type Principal} from './auth-session';
import {normalizeEmail} from './auth-request';
export async function listAccounts(user:Principal){const result=await authDb().prepare('SELECT id,email,role,status,created_at FROM auth_users WHERE workspace_owner=? ORDER BY created_at,email').bind(user.owner).all<{id:string;email:string;role:string;status:string;created_at:number}>();return result.results.map(row=>({id:row.id,email:row.email,role:row.role,status:row.status,disabled:row.status==='disabled',createdAt:new Date(row.created_at).toISOString()}))}
export async function issueToken(admin:Principal,input:Record<string,unknown>){
 const db=authDb(),invite=input.action==='invite';
 const email=invite?normalizeEmail(input.email):'';
 if(invite&&input.role!=='admin'&&input.role!=='member')throw new AuthError(400,'계정 권한을 확인해 주세요.');
 const role=invite?input.role as string:'';
 const existing=invite?await db.prepare('SELECT id,email,role,status,workspace_owner FROM auth_users WHERE email=?').bind(email).first<{id:string;email:string;role:string;status:string;workspace_owner:string}>():await db.prepare('SELECT id,email,role,status,workspace_owner FROM auth_users WHERE id=? AND workspace_owner=?').bind(typeof input.userId==='string'?input.userId:'',admin.owner).first<{id:string;email:string;role:string;status:string;workspace_owner:string}>();
 if(invite&&existing&&(existing.workspace_owner!==admin.owner||existing.status!=='pending'||existing.role!==role))throw new AuthError(409,'해당 이메일로 초대를 발급할 수 없습니다.');
 if(!invite&&(!existing||existing.status!=='active'))throw new AuthError(404,'계정을 찾을 수 없습니다.');
 const target=existing||{id:crypto.randomUUID(),email,role},token=randomToken(),now=Date.now(),hash=await hashToken(token);
 const activeAdmin="EXISTS(SELECT 1 FROM auth_users WHERE id=? AND workspace_owner=? AND role='admin' AND status='active')";
 const statements=[];
 if(invite)statements.push(db.prepare(`INSERT OR IGNORE INTO auth_users(id,email,workspace_owner,role,status,created_at) SELECT ?,?,?,?,'pending',? WHERE ${activeAdmin}`).bind(target.id,target.email,admin.owner,target.role,now,admin.id,admin.owner));
 statements.push(db.prepare(`UPDATE auth_tokens SET used='revoked' WHERE user_id=? AND used IS NULL AND ${activeAdmin}`).bind(target.id,admin.id,admin.owner));
 statements.push(db.prepare(`INSERT INTO auth_tokens(token_hash,user_id,email,owner,role,kind,expires_at,created_at) SELECT ?,id,email,workspace_owner,role,?,?,? FROM auth_users WHERE id=? AND workspace_owner=? AND status=? AND ${activeAdmin}`).bind(hash,invite?'invite':'reset',now+86400000,now,target.id,admin.owner,invite?'pending':'active',admin.id,admin.owner));
 const result=await db.batch(statements);if(!result[result.length-1].meta.changes)throw new AuthError(409,'계정 정보가 변경됐습니다. 다시 시도해 주세요.');return {token};
}
export async function disableAccount(admin:Principal,userId:unknown){
 if(typeof userId!=='string'||!userId||userId===admin.id)throw new AuthError(400,'본인 계정은 비활성화할 수 없습니다.');
 const db=authDb();const target=await db.prepare('SELECT id FROM auth_users WHERE id=? AND workspace_owner=?').bind(userId,admin.owner).first();if(!target)throw new AuthError(404,'계정을 찾을 수 없습니다.');
 const results=await db.batch([
  db.prepare("UPDATE auth_users SET status='disabled' WHERE id=? AND workspace_owner=? AND (role!='admin' OR status!='active' OR (SELECT COUNT(*) FROM auth_users WHERE workspace_owner=? AND role='admin' AND status='active')>1) AND EXISTS(SELECT 1 FROM auth_users WHERE id=? AND role='admin' AND status='active')").bind(userId,admin.owner,admin.owner,admin.id),
  db.prepare("DELETE FROM auth_sessions WHERE user_id=? AND EXISTS(SELECT 1 FROM auth_users WHERE id=? AND status='disabled')").bind(userId,userId),
  db.prepare("UPDATE auth_tokens SET used='revoked' WHERE user_id=? AND EXISTS(SELECT 1 FROM auth_users WHERE id=? AND status='disabled')").bind(userId,userId),
 ]);
 if(!results[0].meta.changes)throw new AuthError(409,'마지막 관리자 계정은 비활성화할 수 없습니다.');return {ok:true};
}
