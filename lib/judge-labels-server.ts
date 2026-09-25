import {ApiError,database,str,stamp,readRecord,listRecords,recordStatement} from './server';
import {roles} from './agency';
import {JUDGE_CRITERIA,JUDGE_KINDS,RUBRIC_VERSION,applicableCriteria,type JudgeCriterionId} from './judge-rubric';
import {bodyOf} from './graders/text';
import type {EvalRun,EvalCase,EvalCaseResult} from './eval-server';

// AI 심사 보정 라벨(J2, docs/JUDGE.ko.md '사람 라벨'). 대표가 끝난 평가 run의 역할 산출물 렌더본에 심사와 같은 루브릭(judge-rubric-v1)으로 1~5점 또는 해당없음을 매긴다.
// 저장: judge_label(부모 eval_run, 소유자 전용 /api/eval). 사람 판정 로그(review_decision)는 쓰지 않는다(1차 승인율 집계 오염 방지).
// 블라인드: 화면에 가는 항목은 표시 id(itemId, run·케이스·쪽의 해시 앞 10자)·역할·렌더본·적용 기준뿐이다. run id·케이스 id·variant·모델·채점 결과·기대 판정은 보내지 않는다.
//  항목 순서는 표시 id 순서(해시 순서)라 run·케이스 생성 순서와 무관하다. 심사 점수(J3)는 라벨을 저장하기 전에는 보내지 않는다(J3가 이 규칙을 지킨다).
// 대상: 삭제하지 않은 active run의 completed 결과 중 역할 kind(JUDGE_KINDS)·dev 세트·심사 기준이 있는 역할. 봉인 세트 출력은 보정 라벨에 쓰지 않는다.
export const LABEL_USES=['measure','anchor','relabel'] as const;
export type LabelUse=typeof LABEL_USES[number];
export type LabelScore=1|2|3|4|5|null;
// scores: 적용 기준마다 1~5 또는 null(해당없음). outputHash: 라벨을 매긴 렌더본의 SHA-256(재채점·정규화 변경으로 본문이 바뀌었는지 J3가 본다).
export type JudgeLabel={id:string;itemId:string;runId:string;caseId:string;variant:'active'|'candidate';role:string;rubricVersion:string;use:LabelUse;scores:Partial<Record<JudgeCriterionId,LabelScore>>;outputHash:string;note?:string;labeledBy:{id:string;email:string|null};labeledAt:string;createdAt:string};
type Who={id:string;email:string|null};
export const LABEL_QUEUE_DEFAULT=10,LABEL_QUEUE_MAX=50,LABEL_NOTE_MAX=500;
const hex=async(text:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)))).map(x=>x.toString(16).padStart(2,'0')).join('');
const labelItemId=async(runId:string,caseId:string,variant:string)=>'L'+(await hex(`judge-label:${runId}:${caseId}:${variant}`)).slice(0,10);
// 결과 행 → 라벨 대상 여부. 옛 결과(kind 없음)는 역할이다. 케이스 종류는 케이스 레코드에서 읽는다(결과 행에는 없다).
const eligibleResult=(r:EvalCaseResult)=>r.status==='completed'&&r.set==='dev'&&r.variant==='active'&&applicableCriteria(r.role).length>0;
type Item={itemId:string;run:EvalRun;result:EvalCaseResult};
async function labelItems(owner:string):Promise<Item[]>{
 const runs=(await listRecords<EvalRun>(owner,'eval_run')).filter(r=>!r.deleted&&r.variant==='active'&&!['queued','running'].includes(r.status));
 const kinds=new Map((await listRecords<EvalCase>(owner,'eval_case')).map(c=>[c.id,c.kind??'role']));
 const items:Item[]=[];
 for(const run of runs)for(const result of run.results.filter(eligibleResult)){
  const kind=kinds.get(result.caseId)??'role';
  if((JUDGE_KINDS as readonly string[]).includes(kind))items.push({itemId:await labelItemId(run.id,result.caseId,result.variant),run,result});
 }
 return items.sort((a,b)=>a.itemId.localeCompare(b.itemId));
}
async function renderedOutput(owner:string,item:Item){
 const stored=await readRecord<{output?:unknown}>(owner,'eval_output',`${item.run.id}:${item.result.caseId}`).catch(()=>null);
 if(typeof stored?.output!=='string')return null;
 return bodyOf({id:item.itemId,kind:'role',role:item.result.role,raw:stored.output,contract:true});
}
const criteriaView=(ids:readonly string[])=>JUDGE_CRITERIA.filter(c=>ids.includes(c.id)).map(c=>({id:c.id,label:c.label,definition:c.definition,anchors:c.anchors}));
const labelView=(l:JudgeLabel)=>({use:l.use,scores:l.scores,...(l.note?{note:l.note}:{}),labeledAt:l.labeledAt});
// 화면에 보내는 항목(블라인드 허용 목록). 이 함수 밖의 필드는 응답에 넣지 않는다.
async function itemView(owner:string,item:Item,labels:JudgeLabel[]){
 const output=await renderedOutput(owner,item),own=labels.filter(l=>l.itemId===item.itemId);
 return {itemId:item.itemId,role:item.result.role,roleName:roles.find(r=>r.id===item.result.role)?.name||item.result.role,criteria:applicableCriteria(item.result.role),output,labels:own.map(labelView)};
}

// GET /api/eval?labels=queue[&limit=N]: 라벨이 없는 항목을 표시 id 순으로 limit개(기본 10, 최대 50). ?labels=item&id=<표시 id>: 그 항목과 저장된 라벨(재라벨·수정용).
export async function labelRead(owner:string,params:URLSearchParams){
 const mode=params.get('labels'),[items,labels]=await Promise.all([labelItems(owner),listRecords<JudgeLabel>(owner,'judge_label')]);
 const rubric={rubricVersion:RUBRIC_VERSION,criteria:criteriaView(JUDGE_CRITERIA.map(c=>c.id))};
 const labeled=new Set(labels.filter(l=>l.use!=='relabel').map(l=>l.itemId));
 const counts={items:items.length,labeled:items.filter(i=>labeled.has(i.itemId)).length,byUse:Object.fromEntries(LABEL_USES.map(u=>[u,labels.filter(l=>l.use===u).length]))};
 if(mode==='item'){
  const id=str(params.get('id'),'라벨 항목',20,true),item=items.find(i=>i.itemId===id);
  if(!item)throw new ApiError(404,'라벨 항목을 찾을 수 없습니다.');
  return {...rubric,counts,item:await itemView(owner,item,labels)};
 }
 if(mode!=='queue')throw new ApiError(400,'labels는 queue 또는 item만 쓸 수 있습니다.');
 const limitValue=Number(params.get('limit')??LABEL_QUEUE_DEFAULT);
 if(!Number.isSafeInteger(limitValue)||limitValue<1||limitValue>LABEL_QUEUE_MAX)throw new ApiError(400,`limit은 1~${LABEL_QUEUE_MAX} 사이 정수여야 합니다.`);
 const next=items.filter(i=>!labeled.has(i.itemId)).slice(0,limitValue);
 return {...rubric,counts,items:await Promise.all(next.map(i=>itemView(owner,i,labels)))};
}

// POST /api/eval {action:'save_label', itemId, use, scores, note?}. 적용 기준마다 1~5 정수 또는 'na'(해당없음)를 빠짐없이 준다. 적용 밖 기준은 400.
// measure·anchor는 항목당 1행(다시 저장하면 바꾼다, 둘 사이 전환 가능), relabel은 첫 라벨이 있어야 하고 따로 1행이다(자기 일치도, κ 쌍에서 뺀다).
export async function saveLabel(owner:string,input:Record<string,unknown>,by:Who){
 const itemId=str(input.itemId,'라벨 항목',20,true),use=input.use??'measure';
 if(!(LABEL_USES as readonly unknown[]).includes(use))throw new ApiError(400,'라벨 용도(use)는 measure·anchor·relabel 중 하나입니다.');
 const item=(await labelItems(owner)).find(i=>i.itemId===itemId);
 if(!item)throw new ApiError(404,'라벨 항목을 찾을 수 없습니다.');
 const allowed=applicableCriteria(item.result.role),raw=input.scores&&typeof input.scores==='object'&&!Array.isArray(input.scores)?input.scores as Record<string,unknown>:null;
 if(!raw)throw new ApiError(400,'기준별 점수(scores)를 입력하세요.');
 const extra=Object.keys(raw).filter(k=>!allowed.includes(k as JudgeCriterionId)),missing=allowed.filter(k=>raw[k]===undefined);
 if(extra.length||missing.length)throw new ApiError(400,`이 역할의 적용 기준(${allowed.join(', ')})마다 점수를 하나씩 주세요.${extra.length?` 적용 밖: ${extra.join(', ')}.`:''}${missing.length?` 빠짐: ${missing.join(', ')}.`:''}`);
 const scores=Object.fromEntries(allowed.map(k=>{const v=raw[k];if(v==='na')return [k,null];if(typeof v!=='number'||!Number.isInteger(v)||v<1||v>5)throw new ApiError(400,`${k} 점수는 1~5 정수 또는 na(해당없음)여야 합니다.`);return [k,v]})) as JudgeLabel['scores'];
 const note=input.note===undefined?'':str(input.note,'라벨 메모',LABEL_NOTE_MAX);
 const labels=(await listRecords<JudgeLabel>(owner,'judge_label',item.run.id)).filter(l=>l.itemId===itemId);
 if(use==='relabel'&&!labels.some(l=>l.use!=='relabel'))throw new ApiError(409,'재라벨은 첫 라벨(measure·anchor)을 저장한 항목에만 할 수 있습니다.');
 const output=await renderedOutput(owner,item);
 if(output===null)throw new ApiError(409,'이 항목의 모델 출력이 없어 라벨을 저장할 수 없습니다.');
 const id=use==='relabel'?`${itemId}:relabel`:itemId,previous=labels.find(l=>l.id===id),at=stamp();
 const label:JudgeLabel={id,itemId,runId:item.run.id,caseId:item.result.caseId,variant:item.result.variant,role:item.result.role,rubricVersion:RUBRIC_VERSION,use:use as LabelUse,scores,outputHash:await hex(output),...(note?{note}:{}),labeledBy:{id:by.id,email:by.email},labeledAt:at,createdAt:previous?.createdAt??at};
 await recordStatement(owner,'judge_label',id,label,item.run.id).run();
 return {itemId,...labelView(label)};
}
// delete_run 거부 조건: 그 run에 라벨이 있으면 결과·출력을 지울 수 없다(라벨의 근거가 사라진다).
export async function runHasLabels(owner:string,runId:string){
 return !!await database().prepare("SELECT 1 FROM records WHERE owner=? AND kind='judge_label' AND parent_id=? LIMIT 1").bind(owner,runId).first();
}
