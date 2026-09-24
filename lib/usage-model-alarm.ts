// 보고 모델 변경 경보(F2a). 대표 결정 10: HERMES 기반 모델은 고정하지 않고 별칭(hermes-agent)을 유지하므로, 공급자가 보고한 모델이 바뀌면 경보를 남긴다.
// 비교 기준은 usage_model_state 레코드 1행(공급자별 마지막 보고 모델)이다. provider_usage 전체를 읽지 않는다.
// HERMES 5개 경로(역할·회의·브리프·조사·학습)는 같은 연결(connection(owner))을 쓰므로 기반 모델 1회 변경은 실행 종류와 무관하게 1건이다. 실행 종류는 처음 관측한 실행의 참고 정보(kind)로만 남긴다.
// 바뀌면 model_change 1건, 같은 값이 반복되면 0건. 처음 보고는 기준값만 남긴다. 모델을 보고하지 않은 실행은 비교하지 않는다.
// 늦게 끝난 이전 실행: 기준값을 만든 실행보다 먼저 제출된 실행이 다른 모델을 보고하면 비교하지 않는다(모델 전환 중 B→A, A→B 반복 경보 방지). 어느 한쪽의 제출 시각을 모르면 비교한다.
// 별칭은 실제 모델이 아니다: actual=null('실제 모델 미확인')로 적는다. 별칭에 단가를 거는 경로는 usage-ledger가 막는다(validateUsagePricing·estimateUsageCost).
import {database,recordStatement} from './server';
import {isModelAlias,type ReportedModel} from './usage-summary';
import type {UsageKind,UsageProvider} from './usage-ledger';

export type ModelChange={id:string;key:string;provider:UsageProvider;kind:UsageKind|null;from:ReportedModel;to:ReportedModel;providerRunId:string;observedAt:string};
type ProviderState=ReportedModel&{seq:number;kind:UsageKind|null;providerRunId:string;submittedAt:string|null;observedAt:string};
type ModelState={providers:Record<string,ProviderState>};
// submittedAt: 이 실행의 제출 원문 저장 시각(모르면 null). 늦게 끝난 이전 실행을 가르는 데만 쓴다.
export type ModelObservation={provider:UsageProvider;kind:UsageKind|null;model:string;providerRunId:string;submittedAt?:string|null;observedAt:string};
const STATE_ID='current';
const stateKey=(owner:string)=>`${owner}:usage_model_state:${STATE_ID}`;
export const reportedModel=(provider:UsageProvider,model:string):ReportedModel=>({reported:model,actual:isModelAlias(provider,model)?null:model});
// 별칭끼리는 대소문자를 무시해 같은 값으로 본다. 실제 모델과 별칭은 서로 다른 값이다.
const identity=(m:ReportedModel)=>m.actual??'alias:'+m.reported.toLowerCase();
const submittedBefore=(o:ModelObservation,baseline:ProviderState)=>!!(o.submittedAt&&baseline.submittedAt&&o.submittedAt<baseline.submittedAt);
async function shortHash(value:string){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))).map(x=>x.toString(16).padStart(2,'0')).join('').slice(0,8)}
async function readState(owner:string):Promise<ModelState>{
 const row=await database().prepare("SELECT data FROM records WHERE id=? AND owner=? AND kind='usage_model_state'").bind(stateKey(owner),owner).first<{data:string}>();
 const state=row?JSON.parse(row.data) as Partial<ModelState>:{};
 return {providers:state.providers&&typeof state.providers==='object'?state.providers:{}};
}
// 한 공급자의 기준값만 json_set으로 바꿔 다른 공급자의 동시 기록을 덮지 않는다. 변경 id는 (공급자, 순번, 새 값)으로 정해 여러 실행 종류가 동시에 관측해도 같은 변경을 두 번 쓰지 않는다.
export async function observeReportedModel(owner:string,o:ModelObservation):Promise<ModelChange|null>{
 const key=o.provider,previous=(await readState(owner)).providers[key],next=reportedModel(o.provider,o.model);
 if(previous&&(identity(previous)===identity(next)||submittedBefore(o,previous)))return null;
 const seq=(previous?.seq??0)+1,db=database();
 const change:ModelChange|null=previous?{id:`${key}:${seq}:${await shortHash(identity(next))}`,key,provider:o.provider,kind:o.kind,from:{reported:previous.reported,actual:previous.actual},to:next,providerRunId:o.providerRunId,observedAt:o.observedAt}:null;
 const providerState:ProviderState={...next,seq,kind:o.kind,providerRunId:o.providerRunId,submittedAt:o.submittedAt??null,observedAt:o.observedAt};
 await db.batch([
  db.prepare('INSERT OR IGNORE INTO records(id,owner,kind,parent_id,data,updated_at) VALUES(?,?,?,?,?,?)').bind(stateKey(owner),owner,'usage_model_state','',JSON.stringify({providers:{}}),o.observedAt),
  db.prepare("UPDATE records SET data=json_set(data,?,json(?)),updated_at=? WHERE id=? AND owner=? AND kind='usage_model_state'").bind(`$.providers."${key}"`,JSON.stringify(providerState),o.observedAt,stateKey(owner),owner),
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
// 공급자별 현재 보고 모델(상태 1행). kind는 기준값을 만든 실행의 종류다.
export async function reportedModels(owner:string){
 return Object.entries((await readState(owner)).providers).map(([key,s])=>({key,kind:s.kind??null,reported:s.reported,actual:s.actual,observedAt:s.observedAt})).sort((a,b)=>a.key.localeCompare(b.key));
}

// 경보 동결(F3b, 결정 10): 모델 변경(model_change)·게이트웨이 변경(gateway_change, lib/gateway-snapshot.ts) 경보는 소유자가 확인(prompt_alarm_ack)할 때까지 열려 있다.
// 열린 경보가 있으면 프롬프트 activate·stage·promote를 막는다(lib/prompt-registry.ts). 확인 기록은 확인한 경보 id 목록을 남기므로 그 뒤에 생긴 경보는 다시 열린 상태다.
export type AlarmKind='model_change'|'gateway_change';
export type OpenAlarm={kind:AlarmKind;id:string;at:string;detail:string};
export type AlarmAck={id:string;alarms:{kind:AlarmKind;id:string}[];reason:string;evalRunId:string|null;by:{id:string;email:string|null};at:string};
type AlarmRow={kind:string;data:string;updated_at:string};
// 경보 요약: 모델은 보고값 전후, 게이트웨이는 해시 앞 12자와 바뀐 섹션 이름. 주소·키·원문은 경보 기록에 없다.
function openAlarm(row:AlarmRow):OpenAlarm{
 const d=JSON.parse(row.data) as Partial<ModelChange>&{fromHash?:string;toHash?:string;sections?:{section:string}[]};
 const detail=row.kind==='model_change'?`${d.provider}: ${d.from?.reported} → ${d.to?.reported}`:`${String(d.fromHash).slice(0,12)} → ${String(d.toHash).slice(0,12)} (${(d.sections||[]).map(s=>s.section).join(', ')||'섹션 미상'})`;
 return {kind:row.kind as AlarmKind,id:String(d.id),at:row.updated_at,detail};
}
export async function alarmState(owner:string){
 const rows=(await database().prepare("SELECT kind,data,updated_at FROM records WHERE owner=? AND kind IN ('model_change','gateway_change','prompt_alarm_ack') ORDER BY updated_at,rowid").bind(owner).all<AlarmRow>()).results;
 const acks=rows.filter(r=>r.kind==='prompt_alarm_ack').map(r=>JSON.parse(r.data) as AlarmAck),acked=new Set(acks.flatMap(a=>a.alarms.map(x=>`${x.kind}:${x.id}`)));
 const open=rows.filter(r=>r.kind!=='prompt_alarm_ack').map(openAlarm).filter(a=>!acked.has(`${a.kind}:${a.id}`));
 return {open,lastAck:acks.at(-1)??null};
}
export const alarmAckStatement=(owner:string,ack:AlarmAck)=>recordStatement(owner,'prompt_alarm_ack',ack.id,ack);
