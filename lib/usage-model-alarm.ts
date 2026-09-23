// 보고 모델 변경 경보(F2a). 대표 결정 10: HERMES 기반 모델은 고정하지 않고 별칭(hermes-agent)을 유지하므로, 공급자가 보고한 모델이 바뀌면 경보를 남긴다.
// 비교 기준은 usage_model_state 레코드 1행(공급자:실행 종류별 마지막 보고 모델)이다. provider_usage 전체를 읽지 않는다.
// 바뀌면 model_change 1건, 같은 값이 반복되면 0건. 처음 보고는 기준값만 남긴다. 모델을 보고하지 않은 실행은 비교하지 않는다.
// 별칭은 실제 모델이 아니다: actual=null('실제 모델 미확인')로 적는다. 별칭에 단가를 거는 경로는 usage-ledger가 막는다(validateUsagePricing·estimateUsageCost).
import {database} from './server';
import {isModelAlias,type ReportedModel} from './usage-summary';
import type {UsageKind,UsageProvider} from './usage-ledger';

export type ModelChange={id:string;key:string;provider:UsageProvider;kind:UsageKind|null;from:ReportedModel;to:ReportedModel;providerRunId:string;observedAt:string};
type KindState=ReportedModel&{seq:number;providerRunId:string;observedAt:string};
type ModelState={kinds:Record<string,KindState>};
export type ModelObservation={provider:UsageProvider;kind:UsageKind|null;model:string;providerRunId:string;observedAt:string};
const STATE_ID='current';
const stateKey=(owner:string)=>`${owner}:usage_model_state:${STATE_ID}`;
export const reportedModel=(provider:UsageProvider,model:string):ReportedModel=>({reported:model,actual:isModelAlias(provider,model)?null:model});
// 별칭끼리는 대소문자를 무시해 같은 값으로 본다. 실제 모델과 별칭은 서로 다른 값이다.
const identity=(m:ReportedModel)=>m.actual??'alias:'+m.reported.toLowerCase();
async function shortHash(value:string){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))).map(x=>x.toString(16).padStart(2,'0')).join('').slice(0,8)}
async function readState(owner:string):Promise<ModelState>{
 const row=await database().prepare("SELECT data FROM records WHERE id=? AND owner=? AND kind='usage_model_state'").bind(stateKey(owner),owner).first<{data:string}>();
 const state=row?JSON.parse(row.data) as Partial<ModelState>:{};
 return {kinds:state.kinds&&typeof state.kinds==='object'?state.kinds:{}};
}
// 한 종류의 기준값만 json_set으로 바꿔 다른 종류의 동시 기록을 덮지 않는다. 변경 id는 (종류, 순번, 새 값)으로 정해 동시 관측이 같은 변경을 두 번 쓰지 않는다.
export async function observeReportedModel(owner:string,o:ModelObservation):Promise<ModelChange|null>{
 const key=`${o.provider}:${o.kind??'unscoped'}`,previous=(await readState(owner)).kinds[key],next=reportedModel(o.provider,o.model);
 if(previous&&identity(previous)===identity(next))return null;
 const seq=(previous?.seq??0)+1,db=database();
 const change:ModelChange|null=previous?{id:`${key}:${seq}:${await shortHash(identity(next))}`,key,provider:o.provider,kind:o.kind,from:{reported:previous.reported,actual:previous.actual},to:next,providerRunId:o.providerRunId,observedAt:o.observedAt}:null;
 const kindState:KindState={...next,seq,providerRunId:o.providerRunId,observedAt:o.observedAt};
 await db.batch([
  db.prepare('INSERT OR IGNORE INTO records(id,owner,kind,parent_id,data,updated_at) VALUES(?,?,?,?,?,?)').bind(stateKey(owner),owner,'usage_model_state','',JSON.stringify({kinds:{}}),o.observedAt),
  db.prepare("UPDATE records SET data=json_set(data,?,json(?)),updated_at=? WHERE id=? AND owner=? AND kind='usage_model_state'").bind(`$.kinds."${key}"`,JSON.stringify(kindState),o.observedAt,stateKey(owner),owner),
  ...(change?[db.prepare('INSERT OR IGNORE INTO records(id,owner,kind,parent_id,data,updated_at) VALUES(?,?,?,?,?,?)').bind(`${owner}:model_change:${change.id}`,owner,'model_change','',JSON.stringify(change),o.observedAt)]:[]),
 ]);
 return change;
}
// 경보 기록 실패가 사용량 원장과 도메인 처리를 막지 않게 한다(usage-outcome과 같은 원칙).
export async function observeReportedModelSafely(owner:string,o:ModelObservation){
 try{return await observeReportedModel(owner,o)}
 catch{console.error('model_change_write_failed');return null}
}
export async function recentModelChanges(owner:string,limit=20){
 const rows=await database().prepare("SELECT data FROM records WHERE owner=? AND kind='model_change' ORDER BY updated_at DESC,rowid DESC LIMIT ?").bind(owner,Math.max(1,Math.min(100,limit))).all<{data:string}>();
 return rows.results.map(r=>JSON.parse(r.data) as ModelChange);
}
// 종류별 현재 보고 모델(상태 1행).
export async function reportedModels(owner:string){
 return Object.entries((await readState(owner)).kinds).map(([key,s])=>({key,reported:s.reported,actual:s.actual,observedAt:s.observedAt})).sort((a,b)=>a.key.localeCompare(b.key));
}
