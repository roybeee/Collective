import {ApiError,acquireLock,database,releaseLock,type Actor} from '../server';
import {storefrontDigest} from '../storefront-orders';
import {launchOutcomes} from './server-ops';
import {parseValidationMutation,validationReadiness} from './validation';
import type {ValidationState,ValidationView} from './validation-types';
const kinds={state:'pr_validation',request:'pr_validation_request',audit:'pr_validation_audit'};
const {state:STATE,request:REQUEST,audit:AUDIT}=kinds;
const empty=():ValidationState=>({version:0,legal:[],groundTruth:[],blind:[],updatedAt:null,updatedBy:null,lastRequestId:null});
function ownerOnly(who:Actor):void{if(who.role!=='owner')throw new ApiError(403,'소유자만 실증 자료를 관리할 수 있습니다.')}
async function read<T>(owner:string,kind:string,id:string):Promise<T|null>{
 const row=await database().prepare('SELECT data FROM records WHERE owner=? AND kind=? AND id=?').bind(owner,kind,`${owner}:${kind}:${id}`).first<{data:string}>();
 return row?JSON.parse(row.data) as T:null;
}
async function view(owner:string,state:ValidationState,now:Date):Promise<ValidationView>{
 const outcomes=await launchOutcomes(owner,now);
 return {...state,readiness:validationReadiness(state,outcomes,now),launchOutcomes:outcomes,automaticPolicyRelease:false};
}
export async function validationView(who:Actor,now=new Date()):Promise<ValidationView>{ownerOnly(who);return view(who.owner,await read<ValidationState>(who.owner,STATE,'current')??empty(),now)}
type Receipt={digest:string;version:number};
function appendEvidence<T extends {id:string}>(existing:T[],incoming:T[]):T[]{
 const byId=new Map(existing.map(e=>[e.id,e]));
 for(const entry of incoming){const prior=byId.get(entry.id);if(prior&&JSON.stringify(prior)!==JSON.stringify(entry))throw new ApiError(409,'기존 증빙은 덮어쓸 수 없습니다. 정정 증빙을 새 ID로 등록해 주세요.')}
 const next=[...existing,...incoming.filter(e=>!byId.has(e.id))];
 if(next.length>500)throw new ApiError(400,'항목별 누적 증빙은 최대 500개입니다.');
 return next;
}
// All three writes are one D1 transaction. Every insert is conditional on the exact CAS winner.
function guardedInsert(owner:string,kind:string,id:string,data:unknown,version:number,requestId:string,at:string){
 return database().prepare("INSERT INTO records(id,owner,kind,parent_id,data,updated_at) SELECT ?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM records WHERE id=? AND owner=? AND kind=? AND json_extract(data,'$.version')=? AND json_extract(data,'$.lastRequestId')=?)")
  .bind(`${owner}:${kind}:${id}`,owner,kind,'',JSON.stringify(data),at,`${owner}:${STATE}:current`,owner,STATE,version,requestId);
}
export async function saveValidation(who:Actor,input:unknown,now=new Date()):Promise<ValidationView>{
 ownerOnly(who);const parsed=parseValidationMutation(input,now),digest=await storefrontDigest(parsed),lockKey=`${who.owner}:research-validation`,token=await acquireLock(lockKey);
 let result:ValidationState;
 try{
  const prior=await read<Receipt>(who.owner,REQUEST,parsed.requestId);
  if(prior){if(prior.digest!==digest)throw new ApiError(409,'같은 요청 번호에 다른 자료를 저장할 수 없습니다.');result=await read<ValidationState>(who.owner,STATE,'current')??empty();if(result.version<prior.version)throw new ApiError(409,'저장 이력과 현재 자료가 일치하지 않습니다.')}
  else{
   const old=await read<ValidationState>(who.owner,STATE,'current')??empty();
   if(old.version!==parsed.expectedVersion)throw new ApiError(409,'다른 변경이 있습니다. 최신 자료를 다시 불러오세요.');
   const count=await database().prepare('SELECT count(*) n FROM records WHERE owner=? AND kind=?').bind(who.owner,REQUEST).first<{n:number}>();
   if((count?.n??0)>=5000)throw new ApiError(409,'실증 자료 변경 이력 한도에 도달했습니다. 보존 정책 검토가 필요합니다.');
   const evidence=parsed.section==='legal'?{legal:appendEvidence(old.legal,parsed.entries)}:parsed.section==='groundTruth'?{groundTruth:appendEvidence(old.groundTruth,parsed.entries)}:{blind:appendEvidence(old.blind,parsed.entries)};
   const at=now.toISOString(),next:ValidationState={...old,...evidence,version:old.version+1,updatedAt:at,updatedBy:who.id,lastRequestId:parsed.requestId};
   const stateId=`${who.owner}:${STATE}:current`;
   const cas=old.version===0?database().prepare('INSERT OR IGNORE INTO records(id,owner,kind,parent_id,data,updated_at) VALUES(?,?,?,?,?,?)').bind(stateId,who.owner,STATE,'',JSON.stringify(next),at)
    :database().prepare("UPDATE records SET data=?,updated_at=? WHERE id=? AND owner=? AND kind=? AND json_extract(data,'$.version')=?").bind(JSON.stringify(next),at,stateId,who.owner,STATE,old.version);
   const audit={version:next.version,section:parsed.section,actorId:who.id,at,requestId:parsed.requestId,beforeDigest:await storefrontDigest(old),afterDigest:await storefrontDigest(next),entries:parsed.entries.length};
   const writes=await database().batch([cas,guardedInsert(who.owner,AUDIT,String(next.version),audit,next.version,parsed.requestId,at),guardedInsert(who.owner,REQUEST,parsed.requestId,{digest,version:next.version} satisfies Receipt,next.version,parsed.requestId,at)]);
   if(writes[0].meta.changes!==1)throw new ApiError(409,'동시 변경으로 저장되지 않았습니다. 최신 자료를 다시 불러오세요.');
   result=next;
  }
 }finally{await releaseLock(lockKey,token)}
 return view(who.owner,result,now);
}
