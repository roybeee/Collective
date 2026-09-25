import {ApiError,str,readRecord,listRecords,recordStatement,stamp} from './server';
import {aiBrand,productionAllow} from './ai-context';
import {campaignBudget,type Campaign,type Brand} from './agency';
import {buildJudgePrompt,parseJudgeResponse,applicableCriteria,RUBRIC_VERSION,JudgePromptError,type JudgeRequest,type JudgeCriterionId,type JudgeInvalid} from './judge-rubric';
import {criterionStats,adoptCriterion,type CalibrationItem} from './judge-kappa';
import {bodyOf} from './graders/text';
import {maskText} from './pii-scan';
import type {EvalRun,EvalCase,EvalCaseResult} from './eval-server';
import type {JudgeLabel} from './judge-labels-server';
import type {RoleRequest} from './role-instruction';

// AI 심사 실행(J3, docs/JUDGE.ko.md '심사 실행'). eval_run의 variant 'judge'다. 월 예산 합산·연결 게이트·격리·멱등·중지·run 1개 제한은 평가 run과 같다(lib/eval-server.ts).
// 대상: 대표 보정 라벨(J2, measure·anchor)이 있는 출력만 심사한다(R4: 라벨을 저장한 출력만). 봉인·pair 출력은 라벨 대상이 아니라 여기에도 없다.
// 입력: J1 buildJudgePrompt(가림 렌더본, 브리프 요약·constraints 원문, 확정·거절 사실, aiBrand, 상류 발췌). 금지 값(denyTerms): 원 run이 보고한 모델, 평가 연결 모델, promptHash, variant 이름.
// 출력: 인용·이유는 judge_output(소유자 전용)에만 두고, run 결과에는 기준별 점수·판단 불가·유효 여부만 둔다. 목록 GET에는 인용이 없다.
export const JUDGE_CALL_TOKEN_RESERVE=25000,JUDGE_MAX_ITEMS=100;
export type JudgeScoreRow={id:JudgeCriterionId;score:number|null;uncertain:boolean;valid:boolean;invalid?:JudgeInvalid[]};
// length: 심사에 보낸(가린) 산출물 글자 수(보정 통계의 길이 편향). error: 응답이 JSON이 아니거나 모양이 틀림(모든 기준 무효로 센다).
export type JudgeResultInfo={itemId:string;sourceRunId:string;rubricVersion?:string;scores?:JudgeScoreRow[];length?:number;error?:string};
const text=(v:unknown)=>typeof v==='string'?v:'';

// 심사 대상: 첫 라벨(measure·anchor, 현재 루브릭 버전)이 있는 항목. 표시 id 순, 최대 limit개(기본·최대 100).
export async function judgeTargets(owner:string,limitValue:unknown){
 const limit=limitValue===undefined?JUDGE_MAX_ITEMS:Number(limitValue);
 if(!Number.isSafeInteger(limit)||limit<1||limit>JUDGE_MAX_ITEMS)throw new ApiError(400,`심사 항목 수(limit)는 1~${JUDGE_MAX_ITEMS} 사이 정수여야 합니다.`);
 const labels=(await listRecords<JudgeLabel>(owner,'judge_label')).filter(l=>l.use!=='relabel'&&l.rubricVersion===RUBRIC_VERSION).sort((a,b)=>a.itemId.localeCompare(b.itemId));
 if(!labels.length)throw new ApiError(400,'보정 라벨이 있는 항목이 없습니다. 품질 콘솔에서 라벨을 먼저 매기세요(심사는 라벨을 저장한 출력만 합니다).');
 const picked=labels.slice(0,limit);
 const results:EvalCaseResult[]=picked.map(l=>({caseId:l.caseId,label:`AI 심사 ${l.itemId}`,set:'dev',role:l.role,variant:'active',reserve:JUDGE_CALL_TOKEN_RESERVE,status:'pending',judge:{itemId:l.itemId,sourceRunId:l.runId}}));
 return {results,caseIds:[...new Set(picked.map(l=>l.caseId))]};
}

// 원 평가 출력과 동결 요청으로 심사 프롬프트를 만든다. 원 출력이 없거나 루브릭 입력 검사에 걸리면 ApiError/JudgePromptError다.
async function judgePrompt(owner:string,r:EvalCaseResult,kase:EvalCase,connModel:string|null){
 const j=r.judge!;
 const source=await readRecord<{output?:unknown;model?:unknown}>(owner,'eval_output',`${j.sourceRunId}:${r.caseId}`).catch(()=>null);
 if(typeof source?.output!=='string')throw new ApiError(409,'심사할 원 평가 출력이 없습니다.');
 const run=await readRecord<EvalRun>(owner,'eval_run',j.sourceRunId),origin=run.results.find(x=>x.caseId===r.caseId&&x.variant==='active');
 const req=kase.request as RoleRequest&{storeAllow?:string[]},c=req.campaign as Campaign&{plan?:Record<string,unknown>};
 const facts=req.evidence.facts as {confirmed:Record<string,unknown>[];prohibited:Record<string,unknown>[]};
 const request:JudgeRequest={kind:'role',role:r.role,renderedOutput:bodyOf({id:j.itemId,kind:'role',role:r.role,raw:source.output,contract:true}),
  brief:{goal:text(c.goal),audience:text(c.audience),kpi:text(c.plan?.kpi),channels:text(c.channels),constraints:text(c.constraints),budgetConfirmed:campaignBudget(c)!==null},
  confirmedFacts:facts.confirmed.map(f=>({key:text(f.key),value:text(f.value),source:text(f.source),verifiedAt:text(f.verifiedAt),validUntil:text(f.validUntil),scope:text(f.scope)})),
  rejectedFacts:facts.prohibited.map(f=>({key:text(f.key),value:text(f.value),scope:text(f.scope)})),
  brand:aiBrand(req.brand as Brand),upstreamExcerpt:(req.previous||[]).map(a=>`## ${text(a.title)}\n${text(a.content)}`).join('\n\n'),
  allow:productionAllow(req.evidence,req.archive,req.storeAllow||[])};
 const denyTerms=[source.model,connModel,origin?.model,origin?.promptHash,'active','candidate'].filter((t):t is string=>typeof t==='string'&&t.length>=3);
 return {...buildJudgePrompt(request,{denyTerms}),allow:request.allow||[]};
}
export async function judgeSubmission(owner:string,r:EvalCaseResult,kase:EvalCase,connModel:string|null){
 try{const {instructions,input}=await judgePrompt(owner,r,kase,connModel);return {instructions,input}}
 catch(e){if(e instanceof JudgePromptError)throw new ApiError(400,`심사 입력을 만들 수 없습니다(${e.code}). ${e.message}`);throw e}
}
// 응답 채점: 파서가 인용을 실제로 보낸 가림본과 대조한다. JSON이 아니거나 모양이 틀리면 적용 기준 모두 무효(bad_shape)로 센다.
export async function judgeGrade(owner:string,runId:string,r:EvalCaseResult,kase:EvalCase,output:string,model:string|null,connModel:string|null){
 const {sent,allow}=await judgePrompt(owner,r,kase,connModel),parsed=parseJudgeResponse(output,sent),criteria=applicableCriteria(r.role);
 const scores:JudgeScoreRow[]=parsed.ok?criteria.map(id=>{const a=parsed.criteria.find(x=>x.id===id);return a?{id,score:a.valid?a.score:null,uncertain:a.uncertain,valid:a.valid,...(a.invalid.length?{invalid:a.invalid}:{})}:{id,score:null,uncertain:false,valid:false,invalid:['score_missing']}})
  :criteria.map(id=>({id,score:null,uncertain:false,valid:false,invalid:['bad_shape']}));
 const judge:JudgeResultInfo={...r.judge!,rubricVersion:parsed.rubricVersion,scores,length:sent.output.length,...(parsed.ok?{}:{error:parsed.error})};
 // 판정 이유와 응답 원문은 모델이 쓴 자유 텍스트라 가리지 않은 값이 섞일 수 있어 저장 전에 가린다(JUDGE.ko.md 파서 무효 규칙, J3 수용 조건). 인용은 이미 가린 본문과 대조를 통과한 조각이다.
 const mask=(t:string)=>maskText(t,{allow}).text,stored=parsed.ok?{...parsed,criteria:parsed.criteria.map(c=>({...c,reason:mask(c.reason)}))}:parsed;
 const write=recordStatement(owner,'judge_output',`${runId}:${r.judge!.itemId}`,{runId,itemId:r.judge!.itemId,sourceRunId:r.judge!.sourceRunId,caseId:r.caseId,role:r.role,rubricVersion:parsed.rubricVersion,parse:stored,output:mask(output),model,createdAt:stamp()},runId);
 return {judge,write};
}

// GET ?judge=<run>: 항목별 점수(인용 없음)와 기준별 보정 통계·채택 판정(lib/judge-kappa.ts). 사람 점수는 그 항목의 첫 라벨(measure·anchor)이고 용도는 라벨을 따른다.
// GET ?judge=<run>&itemId=<표시 id>: 그 항목의 인용·이유(judge_output). 심사는 라벨이 있는 항목만 하므로 라벨 저장 전에 심사 점수가 보이는 경로는 없다.
export async function judgeRead(owner:string,params:URLSearchParams){
 const run=await readRecord<EvalRun>(owner,'eval_run',str(params.get('judge'),'심사 실행',100,true));
 if(run.variant!=='judge')throw new ApiError(400,'AI 심사(judge) 실행이 아닙니다.');
 if(params.has('itemId'))return readRecord(owner,'judge_output',`${run.id}:${str(params.get('itemId'),'라벨 항목',20,true)}`);
 const labels=new Map((await listRecords<JudgeLabel>(owner,'judge_label')).filter(l=>l.use!=='relabel').map(l=>[l.itemId,l]));
 const judged=run.results.filter(r=>r.status==='completed'&&r.judge?.scores);
 const items=judged.map(r=>({itemId:r.judge!.itemId,role:r.role,scores:r.judge!.scores,...(r.judge!.error?{error:r.judge!.error}:{})}));
 const byCriterion=new Map<string,CalibrationItem[]>();
 for(const r of judged){
  const label=labels.get(r.judge!.itemId);if(!label)continue;
  for(const s of r.judge!.scores!){
   if(!(s.id in label.scores))continue;
   const item:CalibrationItem={human:label.scores[s.id]??null,judge:s.valid&&!s.uncertain?s.score:null,uncertain:s.uncertain,...(s.invalid?{invalid:s.invalid}:{}),length:r.judge!.length??0,use:label.use==='anchor'?'anchor':'measure'};
   byCriterion.set(s.id,[...(byCriterion.get(s.id)||[]),item]);
  }
 }
 const calibration=[...byCriterion.entries()].map(([criterion,list])=>{const stats=criterionStats(criterion,list);return {stats,adoption:adoptCriterion(stats)}});
 return {id:run.id,status:run.status,rubricVersion:RUBRIC_VERSION,items,calibration};
}
