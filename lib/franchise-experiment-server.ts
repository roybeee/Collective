// 트랙 R R6d-2 모집 소재 실험 선별 서버: D1 `recruitment_experiment`(실험마다 한 행, id rx-<uuid>, 브랜드 행) 저장, /api/franchise 작업 3개(experiment_plan·experiment_result·experiment_cancel,
// 대표·관리자)와 GET 보기 experiments(모든 역할). 판정은 순수 모듈 lib/franchise-experiment.ts가 하고(lib/viral-stats.ts 무수정 사용) 이 모듈은 문맥 읽기·쓰기·영수증만 한다.
// lib/franchise-server.ts가 잠금·요청 제한·영수증 재생·스위치·브랜드·역할을 먼저 보고 작업을 넘긴다. commit·영수증은 port로 받아 이 모듈은 franchise-server를 import하지 않는다.
// 수치는 사람이 입력한 플랫폼 보고 값이다(원장 리드 아님). 확인 층(코드 귀속 리드·설명회 참석)은 읽을 때 건수로만 계산한다. 감사 행에는 실험 id만 남긴다(가설·수치 없음).
// 모델 경계(DP-10): 모델 경로가 이 모듈에 닿지 않는다(tests/franchise-model-boundary.test.mjs FORBIDDEN). 외부·모델 호출이 없다(LLM 0). 결과는 COLLECTIVE 휴리스틱 · 법률 자문 아님.
import {ApiError,database,readRecord,listRecords,recordStatement,uid} from './server';
import {isEnabled} from './feature-flags';
import {toKstDate} from './franchise-rules';
import {GATE_DISCLAIMER} from './franchise-gates';
import {FRANCHISE_ERRORS,type FranchiseErrorKey,type AuditAction,type LeadRecord} from './franchise';
import {attributeLead,PLATFORM_REPORTED_NOTE,RECRUITMENT_CHANNEL_LABELS} from './franchise-recruitment';
import {codeBook,FranchiseRecruitmentError} from './franchise-recruitment-server';
import {reportLeadCodes} from './franchise-report';
import {EXPERIMENT_VERSION,EXPERIMENT_METRICS,EXPERIMENT_NOTES,EXPERIMENT_MIN_SAMPLE,EXPERIMENT_MESSAGES,EXPERIMENT_HISTORY,planDecision,resultDecision,cancelDecision,ledgerConfirm,
 type ExperimentDecision,type ExperimentPlan,type ExperimentLook,type ExperimentStatus,type AssetVersionLite,type LedgerLead,type LedgerEvent} from './franchise-experiment';

type Json=Record<string,unknown>;
type ActorLite={id:string;role:string};
export const EXPERIMENT_ACTIONS=['experiment_plan','experiment_result','experiment_cancel'] as const;
export type ExperimentAction=typeof EXPERIMENT_ACTIONS[number];
// 스위치가 꺼져도 되는 작업: 취소(보호 방향). 계획·결과는 켜져야 한다.
export const EXPERIMENT_OFF_EXEMPT:readonly string[]=['experiment_cancel'];
// 같은 요청 번호로 다른 계획을 보내면 옛 결과를 재생하지 않고 409다(대상이 null인 작업).
export const EXPERIMENT_INPUT_BOUND:readonly string[]=['experiment_plan'];
export type ExperimentAuditExtra={recordId?:string};
export type ExperimentPort={commit:(stmts:D1PreparedStatement[],stale:FranchiseErrorKey)=>Promise<unknown>;receipt:(action:AuditAction,result:Json,extra:ExperimentAuditExtra,target:string|null)=>D1PreparedStatement};
export type ExperimentArgs={owner:string;brandId:string;now:string;actor:ActorLite;input:Json;action:ExperimentAction;port:ExperimentPort};
type Outcome={result:Json;extra?:Json};
export type ExperimentRow={id:string;brandId:string;status:ExperimentStatus;plan:ExperimentPlan;looks:ExperimentLook[];cancelled:{at:string;by:ActorLite}|null;version:number;createdAt:string;createdBy:ActorLite;updatedAt:string;ruleVersion:string};
// franchise-server의 오류 응답(franchiseFailure)이 사유 코드·면책을 그대로 싣도록 모집 코드 오류 클래스를 잇는다.
export class FranchiseExperimentError extends FranchiseRecruitmentError{}

const ID_RE=/^[A-Za-z0-9._:-]{1,128}$/;
const idOk=(v:unknown):v is string=>typeof v==='string'&&ID_RE.test(v);
function fail(key:FranchiseErrorKey):never{const e=FRANCHISE_ERRORS[key];throw new FranchiseExperimentError(e.status,e.text)}
type Failure=Extract<ExperimentDecision<unknown>,{ok:false}>;
const decisionError=(d:Failure)=>new FranchiseExperimentError(d.status,d.message,{reasons:d.reasons.map(code=>({code,message:EXPERIMENT_MESSAGES[code]})),ruleVersion:d.ruleVersion,disclaimer:d.disclaimer});
const keyOf=(owner:string,id:string)=>`${owner}:recruitment_experiment:${id}`;
async function optionalRecord<T>(owner:string,kind:string,id:string):Promise<T|null>{try{return await readRecord<T>(owner,kind,id)}catch(e){if(e instanceof ApiError&&e.status===404)return null;throw e}}
function payload(input:Json,drop:readonly string[]):Json{const out:Json={};for(const k of Object.keys(input))if(!['action','brandId','requestId',...drop].includes(k))out[k]=input[k];return out}
// 판 대조 보호: 읽은 뒤 판이 바뀌었으면 같은 id 행을 다시 INSERT해 UNIQUE 실패로 batch 전체를 되돌린다(port.commit이 EXPERIMENT_STALE 409로 바꾼다).
const guard=(owner:string,key:string,version:number)=>database().prepare('INSERT INTO records(id,owner,kind,parent_id,data,updated_at) SELECT id,owner,kind,parent_id,data,updated_at FROM records WHERE id=? AND owner=? AND json_extract(data,\'$.version\') IS NOT ?').bind(key,owner,version);
const insertRow=(owner:string,row:ExperimentRow,now:string)=>database().prepare('INSERT INTO records(id,owner,kind,parent_id,data,updated_at) VALUES(?,?,?,?,?,?)').bind(keyOf(owner,row.id),owner,'recruitment_experiment',row.brandId,JSON.stringify(row),now);
async function assetsOf(owner:string,brandId:string):Promise<AssetVersionLite[]>{
 const rows=await listRecords<AssetVersionLite>(owner,'recruitment_asset',brandId);
 return rows.filter(a=>a.brandId===brandId).map(a=>({id:a.id,version:a.version,brandId:a.brandId,type:a.type,status:a.status,review:a.review?{needed:a.review.needed===true}:null}));
}
async function rowOf(owner:string,brandId:string,raw:unknown):Promise<ExperimentRow>{
 const row=idOk(raw)?await optionalRecord<ExperimentRow>(owner,'recruitment_experiment',raw):null;
 if(!row||row.brandId!==brandId)fail('EXPERIMENT_NOT_FOUND');
 return row;
}

// ── 작업 ──
export function runExperimentAction(x:ExperimentArgs):Promise<Outcome>{
 switch(x.action){
  case 'experiment_plan':return plan(x);
  case 'experiment_result':return result(x);
  case 'experiment_cancel':return cancel(x);
  default:return fail('UNKNOWN_ACTION');
 }
}
// 재생 대상(lib/franchise-server.ts targetOf): 계획은 null(입력 해시로 대조), 결과·취소는 실험 id.
export const experimentTargetOf=(action:string,input:Json):string|null=>action==='experiment_plan'?null:String(input.experimentId??'');
async function plan(x:ExperimentArgs):Promise<Outcome>{
 const d=planDecision(payload(x.input,[]),{brandId:x.brandId,today:toKstDate(x.now),assets:await assetsOf(x.owner,x.brandId)});
 if(!d.ok)throw decisionError(d);
 const row:ExperimentRow={id:'rx-'+uid(),brandId:x.brandId,status:'planned',plan:d.value,looks:[],cancelled:null,version:1,createdAt:x.now,createdBy:{id:x.actor.id,role:x.actor.role},updatedAt:x.now,ruleVersion:EXPERIMENT_VERSION};
 const res={experimentId:row.id,version:row.version};
 await x.port.commit([insertRow(x.owner,row,x.now),x.port.receipt('experiment_plan',res,{recordId:row.id},null)],'EXPERIMENT_STALE');
 return {result:res,extra:{ruleVersion:EXPERIMENT_VERSION,disclaimer:GATE_DISCLAIMER}};
}
async function result(x:ExperimentArgs):Promise<Outcome>{
 const row=await rowOf(x.owner,x.brandId,x.input.experimentId);
 if(x.input.version!==row.version)fail('EXPERIMENT_STALE');
 const d=resultDecision(row,payload(x.input,['experimentId','version']),{today:toKstDate(x.now),nowMs:Date.parse(x.now),recordedAt:x.now});
 if(!d.ok)throw decisionError(d);
 const next:ExperimentRow={...row,status:'evaluated',looks:[...row.looks,d.value].slice(-EXPERIMENT_HISTORY),version:row.version+1,updatedAt:x.now};
 const res={experimentId:row.id,version:next.version,assessment:d.value.assessment.status};
 await x.port.commit([guard(x.owner,keyOf(x.owner,row.id),row.version),recordStatement(x.owner,'recruitment_experiment',row.id,next,row.brandId),x.port.receipt('experiment_result',res,{recordId:row.id},row.id)],'EXPERIMENT_STALE');
 return {result:res,extra:{look:d.value,note:PLATFORM_REPORTED_NOTE,ruleVersion:EXPERIMENT_VERSION,disclaimer:GATE_DISCLAIMER}};
}
async function cancel(x:ExperimentArgs):Promise<Outcome>{
 const row=await rowOf(x.owner,x.brandId,x.input.experimentId);
 if(x.input.version!==row.version)fail('EXPERIMENT_STALE');
 const d=cancelDecision(row);
 if(!d.ok)throw decisionError(d);
 const next:ExperimentRow={...row,status:'cancelled',cancelled:{at:x.now,by:{id:x.actor.id,role:x.actor.role}},version:row.version+1,updatedAt:x.now};
 const res={experimentId:row.id,version:next.version};
 await x.port.commit([guard(x.owner,keyOf(x.owner,row.id),row.version),recordStatement(x.owner,'recruitment_experiment',row.id,next,row.brandId),x.port.receipt('experiment_cancel',res,{recordId:row.id},row.id)],'EXPERIMENT_STALE');
 return {result:res,extra:{ruleVersion:EXPERIMENT_VERSION,disclaimer:GATE_DISCLAIMER}};
}

// ── GET 보기 experiments(모든 역할, 스위치가 꺼져도 읽는다). 리드 값은 싣지 않는다(확인 층은 건수만) ──
type Viewer={owner:string;id:string;role:string};
type EventRow={brandId:string;startsAt:string;status:string;counts?:{attended?:number};assetRefs?:{id:string;version:number}[]};
export async function experimentsView(who:Viewer,brandId:string,now:string):Promise<Json>{
 const owner=who.owner;
 const [rows,assets,leadRows,events,enabled]=await Promise.all([listRecords<ExperimentRow>(owner,'recruitment_experiment',brandId),assetsOf(owner,brandId),listRecords<LeadRecord>(owner,'franchise_lead',brandId),
  listRecords<EventRow>(owner,'recruitment_event',brandId),isEnabled(owner,'r_franchise')]);
 const leads=leadRows.filter(l=>l.brandId===brandId),book=await codeBook(owner,leads.flatMap(l=>(l.codes??[]).map(c=>c.code)));
 const ledgerLeads:LedgerLead[]=leads.map(l=>{const codes=reportLeadCodes(l),a=attributeLead(codes,book,{asOf:now});
  return {assetRef:a.state==='attributed'&&a.basis==='code'&&a.assetRef?{assetId:a.assetRef.id,version:a.assetRef.version}:null,receivedDate:toKstDate(codes.receivedAt)}});
 const ledgerEvents:LedgerEvent[]=events.filter(e=>e.brandId===brandId).map(e=>({assetRefs:e.assetRefs??[],startsDate:toKstDate(e.startsAt),attended:e.counts?.attended??0,cancelled:e.status==='cancelled'}));
 const experiments=rows.filter(r=>r.brandId===brandId).sort((a,b)=>a.createdAt<b.createdAt?1:a.createdAt>b.createdAt?-1:a.id<b.id?1:-1).map(r=>({id:r.id,status:r.status,version:r.version,plan:r.plan,
  channelLabel:RECRUITMENT_CHANNEL_LABELS[r.plan.channel],metric:EXPERIMENT_METRICS[r.plan.metric],latest:r.looks.at(-1)??null,looks:r.looks.length,createdAt:r.createdAt,cancelled:r.cancelled?{at:r.cancelled.at}:null,
  ledger:ledgerConfirm(r.plan,ledgerLeads,ledgerEvents)}));
 return {enabled,role:who.role,experiments,assets:assets.filter(a=>a.status==='approved'&&!a.review?.needed).map(a=>({id:a.id,version:a.version,type:a.type})),
  notes:EXPERIMENT_NOTES,metrics:EXPERIMENT_METRICS,minSample:EXPERIMENT_MIN_SAMPLE,today:toKstDate(now),platformNote:PLATFORM_REPORTED_NOTE,ruleVersion:EXPERIMENT_VERSION,disclaimer:GATE_DISCLAIMER};
}
