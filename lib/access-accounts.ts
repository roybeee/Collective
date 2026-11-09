// G7 범위 역할 배정(계정 관리 API의 추가 동작). 계정의 저장 역할은 직원(member) 그대로 두고 멤버십 행(records kind 'membership')만 쓰거나 지운다.
// 배정·변경·해제는 같은 batch에서 감사 기록(records kind 'access_change')을 남기며, 요청자가 지금도 활성 관리자이고 대상이 아직 직원일 때만 반영된다.
// 새 범위 역할의 초대·배정은 기능 스위치 scoped_roles가 켜져야 한다(꺼짐 409). 범위 해제(직원으로 되돌림)는 스위치와 무관하다.
import {AuthError} from './auth-errors';
import {authDb,type Principal} from './auth-session';
import {issueToken} from './auth-accounts';
import {isEnabled} from './feature-flags';
import {cleanIds,isScopedRole,principalOfMembership,type ScopedRole} from './access';

type Scope={role:ScopedRole;brandIds:string[];storeIds:string[]};
type Snapshot={role:ScopedRole|'member';brandIds:string[];storeIds:string[]};
const activeAdmin="EXISTS(SELECT 1 FROM auth_users a WHERE a.id=? AND a.workspace_owner=? AND a.role='admin' AND a.status='active')";
const memberTarget="EXISTS(SELECT 1 FROM auth_users t WHERE t.id=? AND t.workspace_owner=? AND t.role='member' AND t.status!='disabled')";
const membershipKey=(owner:string,userId:string)=>`${owner}:membership:${userId}`;
const parse=(text:string):unknown=>{try{return JSON.parse(text)}catch{return null}};
const requireManager=(actor:Principal)=>{if(actor.role==='member')throw new AuthError(403,'관리자 권한이 필요합니다.')};
const flagOn=(owner:string)=>isEnabled(owner,'scoped_roles');
const OFF='범위 역할(scoped_roles) 스위치가 꺼져 있습니다. 소유자가 기능 스위치에서 켠 뒤 배정하세요.';

async function existing(owner:string,kind:'brand'|'store',ids:readonly string[]){
 const rows=await authDb().prepare(`SELECT json_extract(data,'$.id') AS id,json_extract(data,'$.brandId') AS brandId FROM records WHERE owner=? AND kind='${kind}' AND id IN (SELECT ?||':${kind}:'||value FROM json_each(?))`).bind(owner,owner,JSON.stringify(ids)).all<{id:string;brandId:string|null}>();
 return rows.results;
}
// 입력 범위를 확인한다. 점포 매니저의 브랜드는 고른 지점의 브랜드로 정한다(직접 받지 않는다).
export async function resolveScope(owner:string,role:ScopedRole,input:Record<string,unknown>):Promise<Scope>{
 const brandIds=cleanIds(input.brandIds),storeIds=cleanIds(input.storeIds);
 if(!brandIds||!storeIds)throw new AuthError(400,'브랜드·지점 선택을 확인해 주세요(최대 50개).');
 if(role==='store_manager'){
  if(!storeIds.length)throw new AuthError(400,'점포 매니저는 지점을 하나 이상 골라 주세요.');
  const stores=await existing(owner,'store',storeIds);
  if(stores.length!==storeIds.length)throw new AuthError(404,'지점을 찾을 수 없습니다.');
  return {role,storeIds,brandIds:[...new Set(stores.map(s=>s.brandId).filter((b):b is string=>typeof b==='string'&&!!b))]};
 }
 if(!brandIds.length)throw new AuthError(400,'브랜드를 하나 이상 골라 주세요.');
 if((await existing(owner,'brand',brandIds)).length!==brandIds.length)throw new AuthError(404,'브랜드를 찾을 수 없습니다.');
 return {role,brandIds,storeIds:[]};
}
function membershipUpsert(actor:Principal,userId:string,scope:Scope,condition:string,values:unknown[]){
 const at=new Date().toISOString(),data={userId,role:scope.role,brandIds:scope.brandIds,storeIds:scope.storeIds,updatedAt:at,updatedBy:{id:actor.id,email:actor.email}};
 return authDb().prepare(`INSERT INTO records(id,owner,kind,parent_id,data,updated_at) SELECT ?,?,'membership','',?,? WHERE ${condition} ON CONFLICT(id) DO UPDATE SET data=excluded.data,updated_at=excluded.updated_at WHERE records.owner=excluded.owner`).bind(membershipKey(actor.owner,userId),actor.owner,JSON.stringify(data),at,...values);
}
function changeInsert(actor:Principal,target:{id:string;email:string},before:Snapshot|null,after:Snapshot,condition:string,values:unknown[]){
 const id=crypto.randomUUID(),at=new Date().toISOString(),data={id,targetId:target.id,targetEmail:target.email,before,after,actor:{id:actor.id,email:actor.email},createdAt:at};
 return authDb().prepare(`INSERT INTO records(id,owner,kind,parent_id,data,updated_at) SELECT ?,?,'access_change','',?,? WHERE ${condition}`).bind(`${actor.owner}:access_change:${id}`,actor.owner,JSON.stringify(data),at,...values);
}
async function currentScope(owner:string,userId:string):Promise<Snapshot|null>{
 const row=await authDb().prepare("SELECT data FROM records WHERE id=? AND owner=? AND kind='membership'").bind(membershipKey(owner,userId),owner).first<{data:string}>();
 if(!row)return null;const p=principalOfMembership(parse(row.data));
 return {role:p.role as ScopedRole,brandIds:[...p.brandIds],storeIds:[...p.storeIds]};
}

// 범위 역할로 초대: 계정은 직원으로 초대하고 같은 batch에서 멤버십과 감사 기록을 쓴다(초대 링크가 실제로 만들어질 때만).
export async function inviteScoped(actor:Principal,input:Record<string,unknown>){
 requireManager(actor);
 const role=input.role;if(!isScopedRole(role))throw new AuthError(400,'계정 권한을 확인해 주세요.');
 if(!(await flagOn(actor.owner)))throw new AuthError(409,OFF);
 const scope=await resolveScope(actor.owner,role,input);
 return issueToken(actor,{action:'invite',email:input.email,role:'member'},(target,tokenHash)=>{
  const condition=`EXISTS(SELECT 1 FROM auth_tokens WHERE token_hash=?) AND ${memberTarget}`,values=[tokenHash,target.id,actor.owner];
  return [membershipUpsert(actor,target.id,scope,condition,values),changeInsert(actor,target,null,scope,condition,values)];
 });
}

// 기존 직원 계정의 범위 역할 배정·변경·해제(role 'member'면 해제).
export async function setAccess(actor:Principal,input:Record<string,unknown>){
 requireManager(actor);
 const role=input.role;if(role!=='member'&&!isScopedRole(role))throw new AuthError(400,'계정 권한을 확인해 주세요.');
 const db=authDb(),userId=typeof input.userId==='string'?input.userId:'';
 const target=await db.prepare('SELECT id,email,role,status FROM auth_users WHERE id=? AND workspace_owner=?').bind(userId,actor.owner).first<{id:string;email:string;role:string;status:string}>();
 if(!target)throw new AuthError(404,'계정을 찾을 수 없습니다.');
 if(target.role!=='member'||target.status==='disabled')throw new AuthError(409,'접근 중인 직원 계정에만 범위 역할을 줄 수 있습니다.');
 const before=await currentScope(actor.owner,target.id);
 const condition=`${activeAdmin} AND ${memberTarget}`,values=[actor.id,actor.owner,target.id,actor.owner];
 if(role==='member'){
  if(!before)throw new AuthError(409,'이미 같은 권한입니다.');
  const results=await db.batch([
   changeInsert(actor,target,before,{role:'member',brandIds:[],storeIds:[]},condition,values),
   db.prepare(`DELETE FROM records WHERE id=? AND owner=? AND kind='membership' AND ${condition}`).bind(membershipKey(actor.owner,target.id),actor.owner,...values),
  ]);
  if(!results[1].meta.changes)throw new AuthError(409,'계정 정보가 변경됐습니다. 다시 시도해 주세요.');
  return {ok:true};
 }
 if(!(await flagOn(actor.owner)))throw new AuthError(409,OFF);
 const scope=await resolveScope(actor.owner,role,input);
 if(before&&before.role===scope.role&&JSON.stringify(before.brandIds)===JSON.stringify(scope.brandIds)&&JSON.stringify(before.storeIds)===JSON.stringify(scope.storeIds))throw new AuthError(409,'이미 같은 권한입니다.');
 const results=await db.batch([changeInsert(actor,target,before,scope,condition,values),membershipUpsert(actor,target.id,scope,condition,values)]);
 if(!results[1].meta.changes)throw new AuthError(409,'계정 정보가 변경됐습니다. 다시 시도해 주세요.');
 return {ok:true};
}

// 계정 관리 화면용: 스위치 상태·멤버십·고를 수 있는 브랜드·지점·최근 범위 변경 20건. 스위치가 꺼져 있고 멤버십이 없으면 null(응답을 바꾸지 않는다).
export async function accessOverview(user:Principal){
 const db=authDb(),[enabled,rows]=await Promise.all([flagOn(user.owner),db.prepare("SELECT data FROM records WHERE owner=? AND kind='membership'").bind(user.owner).all<{data:string}>()]);
 if(!enabled&&!rows.results.length)return null;
 const memberships=Object.fromEntries(rows.results.map(r=>parse(r.data)).filter((d):d is Record<string,unknown>=>!!d&&typeof d==='object'&&typeof (d as Record<string,unknown>).userId==='string').map(d=>{const p=principalOfMembership(d);return [d.userId as string,{role:p.role,brandIds:[...p.brandIds],storeIds:[...p.storeIds]}]}));
 const [brands,stores,changes]=await Promise.all([
  db.prepare("SELECT json_extract(data,'$.id') AS id,json_extract(data,'$.name') AS name FROM records WHERE owner=? AND kind='brand' ORDER BY id").bind(user.owner).all<{id:string;name:string}>(),
  db.prepare("SELECT json_extract(data,'$.id') AS id,json_extract(data,'$.name') AS name,json_extract(data,'$.brandId') AS brandId FROM records WHERE owner=? AND kind='store' ORDER BY id").bind(user.owner).all<{id:string;name:string;brandId:string}>(),
  db.prepare("SELECT data FROM records WHERE owner=? AND kind='access_change' ORDER BY updated_at DESC,rowid DESC LIMIT 20").bind(user.owner).all<{data:string}>(),
 ]);
 return {enabled,memberships,brands:brands.results,stores:stores.results,changes:changes.results.map(r=>parse(r.data))};
}
