import {requireGrowthRunning} from './growth-stop-server';
import type {Campaign} from './agency';
import {evaluateAuthority,parseAuthorityInput,type AuthorityInput,type AuthorityAction,type AuthorityCommitment} from './growth-authority';
import {growthView,type GrowthRecord} from './growth-workspace-server';
import type {MissionInput} from './growth-mission';
import {ApiError,database,readRecord,recordStatement,stamp,str,uid,type Actor} from './server';

export type GrowthAuthorityRecord={id:string;brandId:string;campaignId:string;campaignVersion:number;version:number;input:AuthorityInput;updatedAt:string;updatedBy:string;revokedAt?:string;revokedBy?:string};
export type GrowthCommitmentRecord={id:string;brandId:string;campaignId:string;version?:number;authorityId:string;authorityVersion:number;authorityApprovalId:string;authoritySnapshot:AuthorityInput;missionId:string;missionVersion:number;commitment:AuthorityCommitment;createdAt:string;createdBy:string};
const AUTHORITY_LIMIT=100,COMMITMENT_LIMIT=1000,OWNER_LEDGER_LIMIT=10000;
function recordId(value:unknown,label:string){const id=str(value,label,100,true);if(!/^[A-Za-z0-9_-]+$/.test(id))throw new ApiError(400,`${label} 형식을 확인하세요.`);return id;}
async function rows<T>(owner:string,kind:string,limit:number,campaignId?:string):Promise<T[]>{
 const query=campaignId?'SELECT data FROM records WHERE owner=? AND kind=? AND parent_id=? ORDER BY updated_at DESC LIMIT ?':'SELECT data FROM records WHERE owner=? AND kind=? ORDER BY updated_at DESC LIMIT ?';
 const values=campaignId?[owner,kind,campaignId,limit+1]:[owner,kind,limit+1];
 const result=await database().prepare(query).bind(...values).all<{data:string}>();
 if(result.results.length>limit)throw new ApiError(409,'위임·예약 기록 한도를 넘었습니다. 전체 원장을 확인하기 전 새 예약을 중단합니다.');
 return result.results.map(row=>JSON.parse(row.data) as T);
}
async function optional<T>(owner:string,kind:string,id:string){try{return await readRecord<T>(owner,kind,id);}catch(e){if(e instanceof ApiError&&e.status===404)return null;throw e;}}
function scoped<T extends {campaignId:string;brandId:string}>(row:T|null,c:Campaign){
 if(row&&(row.campaignId!==c.id||row.brandId!==c.brandId))throw new ApiError(404,'이 캠페인의 기록을 찾지 못했습니다.');
 return row;
}
function ownerOnly(who:Actor){if(who.role!=='owner')throw new ApiError(403,'소유자만 위임 범위를 승인하거나 철회할 수 있습니다.');}
export async function growthAuthorityView(who:Actor,c:Campaign){
 const [authorities,commitments]=await Promise.all([rows<GrowthAuthorityRecord>(who.owner,'growth_authority',AUTHORITY_LIMIT,c.id),rows<GrowthCommitmentRecord>(who.owner,'growth_commitment',COMMITMENT_LIMIT,c.id)]);
 for(const row of [...authorities,...commitments])scoped(row,c);
 return {authorities,commitments,campaignVersion:c.version,canAuthorize:who.role==='owner'&&c.status!=='archived',canReserve:who.role!=='member'&&c.status!=='archived',mayExecute:false as const};
}
type CommitmentMission={id:string;version:number;input:Pick<MissionInput,'channel'|'budget'|'lossLimit'>};
function actionFor(input:AuthorityInput,c:Campaign,mission:CommitmentMission):AuthorityAction{
 return {id:mission.id,operationKey:`${mission.id}:v${mission.version}`,brandId:c.brandId,campaignId:c.id,accountId:input.accountId,channel:mission.input.channel,operation:mission.input.budget!==null&&mission.input.budget>0?'spend':'publish',amount:mission.input.budget,loss:mission.input.lossLimit,budget:'exploration',previousBudget:null,nextBudget:null,evidence:null};
}
function validateActiveGrant(input:AuthorityInput){
 const now=Date.now(),tier={read:0,draft:1,publish:2,spend:3,scale:3,reconcile:0,stop:0,policy_change:4};
 if(!input.accountId||!input.channel||!input.ownerApprovalId||!input.ownerSignedAt||Date.parse(input.ownerSignedAt)>now)throw new ApiError(400,'활성 위임의 계정·채널·소유자 서명을 확인하세요.');
 if(!input.startsAt||!input.expiresAt||Date.parse(input.startsAt)>now||Date.parse(input.expiresAt)<=now||!input.periodStart||!input.periodEnd||Date.parse(input.periodStart)>now||Date.parse(input.periodEnd)<=now)throw new ApiError(400,'활성 위임의 유효기간·예산 기간을 확인하세요.');
 if([input.totalCap,input.dayCap,input.weekCap,input.lossCap].some(cap=>cap===null))throw new ApiError(400,'활성 위임은 총·일·주·손실 한도를 모두 명시해야 합니다.');
 if(!input.allowedActions.length||input.allowedActions.some(action=>tier[action]>Number(input.maxTier.slice(1))))throw new ApiError(400,'모든 허용 행동은 위임 등급 안에 있어야 합니다.');
 if(input.allowedActions.some(action=>action==='scale'||action==='policy_change'))throw new ApiError(400,'정책 변경과 자동 확대 위임은 지원하지 않습니다.');
}
function activeInput(value:unknown,c:Campaign,id:string,sign:unknown):AuthorityInput{
 if(!value||typeof value!=='object'||Array.isArray(value))throw new ApiError(400,'위임 입력을 확인하세요.');
 const raw=value as Record<string,unknown>;
 if(raw.status==='revoked')throw new ApiError(400,'위임 철회 작업을 사용하세요.');
 const active=raw.status==='active';
 if(active&&sign!==true)throw new ApiError(400,'활성 위임은 소유자의 명시적 승인이 필요합니다.');
 const input=parseAuthorityInput({...raw,id,brandId:c.brandId,campaignId:c.id,ownerApprovalId:active?uid():'',ownerSignedAt:active?stamp():''});
 if(active)validateActiveGrant(input);
 return input;
}
async function saveAuthority(who:Actor,c:Campaign,b:Record<string,unknown>){
 ownerOnly(who);
 const id=recordId(b.id,'위임 ID'),old=scoped(await optional<GrowthAuthorityRecord>(who.owner,'growth_authority',id),c);
 if(b.expectedVersion!==(old?.version??0))throw new ApiError(409,'위임이 변경되었습니다. 최신 버전을 확인하세요.');
 if(old?.input.status==='revoked')throw new ApiError(409,'철회한 위임은 다시 활성화할 수 없습니다. 새 위임을 승인하세요.');
 const input=activeInput(b.input,c,id,b.sign);
 const [authorities,commitments]=await Promise.all([rows<GrowthAuthorityRecord>(who.owner,'growth_authority',AUTHORITY_LIMIT,c.id),rows<GrowthCommitmentRecord>(who.owner,'growth_commitment',COMMITMENT_LIMIT,c.id)]);
 if(!old&&authorities.length>=AUTHORITY_LIMIT)throw new ApiError(409,'캠페인별 위임은 100개까지 저장할 수 있습니다.');
 if(old&&commitments.some(row=>row.authorityId===id)&&(input.accountId!==old.input.accountId||input.channel!==old.input.channel))throw new ApiError(409,'예약 이력이 있는 위임의 계정·채널은 변경할 수 없습니다.');
 const record:GrowthAuthorityRecord={id,campaignId:c.id,brandId:c.brandId,campaignVersion:c.version,version:(old?.version??0)+1,input,updatedAt:stamp(),updatedBy:who.id};
 await recordStatement(who.owner,'growth_authority',id,record,c.id).run();
 return {...await growthAuthorityView(who,c),duplicate:false};
}
async function revokeAuthority(who:Actor,c:Campaign,b:Record<string,unknown>){
 ownerOnly(who);
 const id=recordId(b.id,'위임 ID'),old=scoped(await readRecord<GrowthAuthorityRecord>(who.owner,'growth_authority',id),c)!;
 if(b.expectedVersion!==old.version)throw new ApiError(409,'위임이 변경되었습니다. 최신 버전을 확인하세요.');
 if(old.input.status==='revoked')return {...await growthAuthorityView(who,c),duplicate:true};
 const now=stamp(),next:GrowthAuthorityRecord={...old,input:{...old.input,status:'revoked'},version:old.version+1,updatedAt:now,updatedBy:who.id,revokedAt:now,revokedBy:who.id};
 await recordStatement(who.owner,'growth_authority',id,next,c.id).run();
 return {...await growthAuthorityView(who,c),duplicate:false};
}
export async function prepareMissionCommitment(who:Actor,c:Campaign,b:Record<string,unknown>){
 await requireGrowthRunning(who.owner);
 if(who.role==='member')throw new ApiError(403,'관리자만 준비 미션의 예산을 예약할 수 있습니다.');
 const authorityId=recordId(b.authorityId,'위임 ID'),missionId=recordId(b.missionId,'미션 ID');
 const authority=scoped(await readRecord<GrowthAuthorityRecord>(who.owner,'growth_authority',authorityId),c)!;
 if(b.expectedVersion!==authority.version)throw new ApiError(409,'위임이 변경되었습니다. 계정·범위와 최신 버전을 다시 확인하세요.');
 const mission=scoped(await readRecord<GrowthRecord<MissionInput>>(who.owner,'growth_mission',missionId),c)!;
 if(mission.version!==b.missionVersion)throw new ApiError(409,'판매 미션이 변경되었습니다. 최신 버전을 확인하세요.');
 if(authority.campaignVersion!==c.version)throw new ApiError(409,'캠페인 변경 후 위임을 다시 승인하세요.');
 if(mission.status!=='staged')throw new ApiError(409,'준비 요청한 미션만 예약할 수 있습니다.');
 const current=(await growthView(who.owner,c,true)).missions.find(row=>row.id===mission.id);
 if(!current||current.readiness.missing.length)throw new ApiError(409,'판매 미션의 상품·오퍼·근거 준비 상태를 다시 확인하세요.');
 const prepared=await prepareScopedMissionCommitment(who,c,mission,authorityId,authority.version);return {...prepared,mission};
}
/** Caller validates the concrete single-SKU or bundle mission readiness under the same owner lock. */
export async function prepareScopedMissionCommitment(who:Actor,c:Campaign,mission:CommitmentMission,authorityId:string,authorityVersion:number){
 await requireGrowthRunning(who.owner);if(who.role==='member'||c.status==='archived')throw new ApiError(409,'현재 관리자·캠페인 준비 범위를 확인하세요.');
 const authority=scoped(await readRecord<GrowthAuthorityRecord>(who.owner,'growth_authority',recordId(authorityId,'위임 ID')),c)!;
 if(authority.version!==authorityVersion||authority.campaignVersion!==c.version)throw new ApiError(409,'위임·캠페인의 최신 판을 확인하세요.');
 const missionId=recordId(mission.id,'미션 ID');
 const ledger=await rows<GrowthCommitmentRecord>(who.owner,'growth_commitment',OWNER_LEDGER_LIMIT);
 const action=actionFor(authority.input,c,mission),decision=evaluateAuthority(authority.input,action,ledger.map(row=>row.commitment));
 if(!decision.allowed)throw new ApiError(409,`예약을 막았습니다: ${decision.reasons.join(' ')}`);
 if(decision.duplicate){
  const existing=ledger.find(row=>row.id===`${mission.id}:v${mission.version}`);
  if(!existing||existing.authorityVersion!==authority.version||existing.authorityApprovalId!==authority.input.ownerApprovalId)throw new ApiError(409,'기존 예산 예약의 승인 판을 대사하세요.');
  return {duplicate:true,writes:[],record:existing,mission,authority};
 }
 if(ledger.filter(row=>row.campaignId===c.id).length>=COMMITMENT_LIMIT||ledger.length>=OWNER_LEDGER_LIMIT)throw new ApiError(409,'예약 원장 한도에 도달했습니다. 새 예약을 저장하지 않았습니다.');
 // The caller holds the workspace owner lock across validation, aggregate evaluation and this write.
 // A unique operation-derived row can only be inserted once; no settlement/release is inferred.
 const at=stamp(),id=`${mission.id}:v${mission.version}`;
 const record:GrowthCommitmentRecord={id,campaignId:c.id,brandId:c.brandId,authorityId,authorityVersion:authority.version,authorityApprovalId:authority.input.ownerApprovalId,authoritySnapshot:{...authority.input,allowedActions:[...authority.input.allowedActions]},missionId,missionVersion:mission.version,commitment:{authorityId,action,status:'reserved',at,reservedAmount:action.amount,reservedLoss:action.loss,actualAmount:null,actualLoss:null},createdAt:at,createdBy:who.id};
 const write=database().prepare('INSERT INTO records(id,owner,kind,parent_id,data,updated_at) VALUES(?,?,?,?,?,?)').bind(`${who.owner}:growth_commitment:${id}`,who.owner,'growth_commitment',c.id,JSON.stringify(record),at);
 return {duplicate:false,writes:[write],record,mission,authority};
}
async function reserveMission(who:Actor,c:Campaign,b:Record<string,unknown>){
 const prepared=await prepareMissionCommitment(who,c,b);
 if(!prepared.duplicate)await database().batch(prepared.writes);
 return {...await growthAuthorityView(who,c),duplicate:prepared.duplicate};
}
export async function saveGrowthAuthority(who:Actor,c:Campaign,b:Record<string,unknown>){
 if(c.status==='archived')throw new ApiError(409,'보관한 캠페인은 변경할 수 없습니다.');
 if(b.campaignVersion!==c.version)throw new ApiError(409,'캠페인이 변경되었습니다. 다시 불러오세요.');
 if(b.action==='save_authority')return saveAuthority(who,c,b);
 if(b.action==='revoke_authority')return revokeAuthority(who,c,b);
 if(b.action==='reserve_mission')return reserveMission(who,c,b);
 throw new ApiError(400,'지원하지 않는 위임 작업입니다.');
}
