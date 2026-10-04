import {evalMonthBudget} from './eval-budget-server';
import {ApiError,database,recordStatement,readRecord,encrypt,decrypt,configuration,connection,stamp,uid,runtime,type Actor} from './server';
import {optionalRecord} from './growth-ledger-server';
import {readBoundedJson} from './http-limits';
import {costAssert,costInteger,costEndpoint,costDigest,costCanonical,verifyCostSignature,validateCostContract,validateCostQuote,validateCostReceipt,type CostRequest,type EvalCostContract,type EvalCostQuote,type EvalCostReceipt} from './eval-cost';
import type {EvalCase,EvalRun,EvalCaseResult} from './eval-server';
const kinds={connection:'eval_cost_connection',prepared:'eval_cost_prepared',month:'eval_cost_month',intent:'eval_cost_intent'} as const;
type Conn={id:string;version:number;endpoint:string;secret:string;host:string;isolationConfirmed:true};
type Month={id:string;capKrw:number;reservedKrw:number;settledKrw:number;version:number;reason:string;updatedAt:string};
export type FrozenEvaluation={variant:'active'|'pair';caseIds:string[];results:EvalCaseResult[];set:'dev'|'sealed'|null;pair?:EvalRun['pair'];cases:EvalCase[];requests:{caseId:string;variant:'active'|'candidate';request:CostRequest;maxOutputTokens:number}[]};
type Prepared={id:string;digest:string;frozen:FrozenEvaluation;contract:EvalCostContract;quotes:EvalCostQuote[];connection:Conn;totalMaxChargeKrw:number;totalMaxTokens:number;createdAt:string;runId:string|null;approvalDigest:string|null};
type Intent={id:string;runId:string;index:number;month:string;state:'reserved'|'unknown'|'final'|'cancelled';request:CostRequest;quote:EvalCostQuote;receipt:EvalCostReceipt|null;version:number;error?:string;receiptDigestBeforeOutputDeletion?:string;outputDeletedAt?:string};
export type BoundedCost={preparedId:string;preparedDigest:string;contractDigest:string;mode:'fixed_krw';capKrw:number;reservedKrw:number;settledKrw:number;intentIds:string[];month:string;enforceable:true;cancelRequested?:true};
const aad=(owner:string)=>`${owner}:eval_cost_connection:current`;
const monthId=()=>new Date().toISOString().slice(0,7);
const ownerOnly=(owner:string,a:Actor)=>costAssert(a.owner===owner&&a.role==='owner','소유자의 원화 비용 승인이 필요합니다.');
const guard=(owner:string,kind:string,id:string,old:unknown)=>database().prepare("SELECT json(CASE WHEN (SELECT data FROM records WHERE owner=? AND kind=? AND id=?) IS ? THEN 'null' ELSE 'stale_eval_cost' END)").bind(owner,kind,`${owner}:${kind}:${id}`,old==null?null:JSON.stringify(old));
async function batch(writes:D1PreparedStatement[]){try{await database().batch(writes)}catch(e){if(/malformed JSON/i.test(String(e)))throw new ApiError(409,'평가 비용 장부가 변경되었습니다. 현재 상태를 확인하세요.');throw e;}}
async function currentConnection(owner:string){const c=await readRecord<Conn>(owner,kinds.connection,'current');await isolated(owner,c.endpoint);return c;}
async function isolated(owner:string,endpoint:string){
 const host=new URL(costEndpoint(endpoint)).hostname,allowed=String((runtime as unknown as {EVAL_BOUNDED_ALLOWED_HOSTS?:string}).EVAL_BOUNDED_ALLOWED_HOSTS??'').split(',').map(s=>s.trim());costAssert(allowed.includes(host),'평가 전용 호스트를 서버 허용 목록에 등록하세요.');
 if((await configuration(owner))?.secret){const operational=await connection(owner);costAssert(!operational.endpoint||new URL(operational.endpoint).hostname.toLowerCase()!==host,'운영 연결과 격리된 평가 호스트가 필요합니다.');}
}
async function request(owner:string,c:Conn,path:string,body?:unknown){
 costAssert(/^\/v1\/eval-(?:contract|quotes|submissions(?:\/[a-zA-Z0-9_-]{1,160})?)$/.test(path));const auth=JSON.parse(await decrypt(c.secret,aad(owner))) as {key:string;trustKey:string},method=body===undefined?'GET':'POST';
 const response=await fetch(c.endpoint+path,{method,redirect:'error',headers:{Authorization:`Bearer ${auth.key}`,'Content-Type':'application/json','X-Collective-Owner':owner},...(body===undefined?{}:{body:costCanonical(body)}),signal:AbortSignal.timeout(10000)});
 costAssert(response.ok,'평가 공급자의 확정 영수증을 아직 확인하지 못했습니다.');const value=await readBoundedJson(response,1000000);await verifyCostSignature(value,auth.trustKey,method,path,owner);return value;
}
async function unresolved(owner:string){const r=await database().prepare("SELECT count(*) AS n FROM records WHERE owner=? AND kind='eval_cost_intent' AND json_extract(data,'$.state') IN ('reserved','unknown')").bind(owner).first<{n:number}>();return Number(r?.n)>0;}
export async function saveBoundedConnection(owner:string,input:Record<string,unknown>,actor:Actor){
 ownerOnly(owner,actor);costAssert(!await unresolved(owner),'미정산 평가 비용을 먼저 회수하세요.');const endpoint=costEndpoint(input.endpoint);await isolated(owner,endpoint);costAssert(input.isolationConfirmed===true&&typeof input.key==='string'&&input.key.length>=32&&input.key.length<=2000&&typeof input.trustKey==='string'&&input.trustKey.length>=32&&input.trustKey.length<=2000);
 const old=await optionalRecord<Conn>(owner,kinds.connection,'current'),c:Conn={id:'current',version:(old?.version??0)+1,endpoint,host:new URL(endpoint).hostname,isolationConfirmed:true,secret:await encrypt(JSON.stringify({key:input.key,trustKey:input.trustKey}),{aad:aad(owner)})};
 await validateCostContract(await request(owner,c,'/v1/eval-contract'));await batch([database().prepare("SELECT json(CASE WHEN NOT EXISTS(SELECT 1 FROM records WHERE owner=? AND kind='eval_cost_intent' AND json_extract(data,'$.state') IN ('reserved','unknown')) THEN 'null' ELSE 'stale_eval_cost' END)").bind(owner),guard(owner,kinds.connection,'current',old),recordStatement(owner,kinds.connection,'current',c)]);return {configured:true,host:c.host,version:c.version};
}
export async function setBoundedMonthCap(owner:string,input:Record<string,unknown>,actor:Actor){
 ownerOnly(owner,actor);const id=monthId();costAssert(input.month===undefined||input.month===id);costAssert(costInteger(input.capKrw)&&typeof input.reason==='string'&&input.reason.trim().length>0&&input.reason.length<=500);
 const old=await optionalRecord<Month>(owner,kinds.month,id);costAssert((old?.reservedKrw??0)+(old?.settledKrw??0)<=(input.capKrw as number));const next:Month={id,capKrw:input.capKrw as number,reservedKrw:old?.reservedKrw??0,settledKrw:old?.settledKrw??0,version:(old?.version??0)+1,reason:input.reason,updatedAt:stamp()};await batch([guard(owner,kinds.month,id,old),recordStatement(owner,kinds.month,id,next)]);return next;
}
export async function storeBoundedPreparation(owner:string,frozen:FrozenEvaluation){
 costAssert(frozen.requests.length>0&&frozen.requests.length<=100&&JSON.stringify(frozen).length<=700000);const c=await currentConnection(owner),contract=await validateCostContract(await request(owner,c,'/v1/eval-contract')),quotes:EvalCostQuote[]=[];
 for(const r of frozen.requests){costAssert(typeof r.request.instructions==='string'&&typeof r.request.input==='string'&&costInteger(r.maxOutputTokens,contract.limits.maxOutputTokens)&&r.maxOutputTokens>0);quotes.push(await validateCostQuote(await request(owner,c,'/v1/eval-quotes',{request:r.request,maxOutputTokens:r.maxOutputTokens,contractDigest:contract.digest}) as EvalCostQuote,contract,r.request,r.maxOutputTokens));}
 const id=uid(),digest=await costDigest({frozen,contractDigest:contract.digest,quotes,connectionVersion:c.version}),p:Prepared={id,digest,frozen,contract,quotes,connection:c,totalMaxChargeKrw:quotes.reduce((s,q)=>s+q.maxChargeKrw,0),totalMaxTokens:quotes.reduce((s,q)=>s+q.maxInputTokens+q.maxOutputTokens,0),createdAt:stamp(),runId:null,approvalDigest:null};
 costAssert(costInteger(p.totalMaxChargeKrw)&&costInteger(p.totalMaxTokens,10000000)&&JSON.stringify(p).length<=900000);await recordStatement(owner,kinds.prepared,id,p).run();return {preparedId:id,preparedDigest:digest,pairDigest:await costDigest(frozen.pair??null),caseDigest:await costDigest(frozen.cases),contract,quotes,totalMaxChargeKrw:p.totalMaxChargeKrw,requestCount:quotes.length,totalMaxTokens:p.totalMaxTokens};
}
const snapshot=()=>({operational:null,eval:{basis:'eval' as const,status:'blocked' as const,hash:null,blockedReason:'원화 상한 공급자 진단이며 운영 모델·지시문 실행 환경의 동일성은 검증되지 않았습니다.'}});
export async function startBoundedEvaluation(owner:string,input:Record<string,unknown>,actor:Actor){
 ownerOnly(owner,actor);costAssert(typeof input.preparedId==='string');const p=await readRecord<Prepared>(owner,kinds.prepared,input.preparedId),approvalDigest=await costDigest(input);costAssert(input.preparedDigest===p.digest);if(p.runId){costAssert(p.approvalDigest===approvalDigest,'같은 준비의 승인 내용이 다릅니다.');return readRecord<EvalRun>(owner,'eval_run',p.runId);}
 costAssert(p.digest===await costDigest({frozen:p.frozen,contractDigest:p.contract.digest,quotes:p.quotes,connectionVersion:p.connection.version}));const c=await currentConnection(owner);costAssert(c.version===p.connection.version);await validateCostContract(p.contract);
 for(let i=0;i<p.quotes.length;i++)await validateCostQuote(p.quotes[i],p.contract,p.frozen.requests[i].request,p.frozen.requests[i].maxOutputTokens);
 for(const kase of p.frozen.cases)costAssert(await costDigest(await readRecord(owner,'eval_case',kase.id))===await costDigest(kase),'평가 케이스가 준비 뒤 변경되었습니다.');
 costAssert(costInteger(input.krwBudget)&&Number(input.krwBudget)>=p.totalMaxChargeKrw&&Number(input.krwBudget)>0&&costInteger(input.tokenBudget,10000000)&&Number(input.tokenBudget)>=p.totalMaxTokens&&typeof input.label==='string'&&input.label.length<=200);
 const active=await database().prepare("SELECT count(*) n FROM records WHERE owner=? AND kind='eval_run' AND json_extract(data,'$.status') IN ('queued','running')").bind(owner).first<{n:number}>();costAssert(!active?.n,'진행 중인 평가 실행을 먼저 회수하세요.');
 const tokenMonth=monthId(),tokenApproval=await evalMonthBudget(owner,tokenMonth),tokenCap=tokenApproval.monthlyCap,tokenRows=await database().prepare("SELECT data FROM records WHERE owner=? AND kind='eval_run' AND substr(json_extract(data,'$.createdAt'),1,7)=?").bind(owner,tokenMonth).all<{data:string}>();
 const tokenCommitted=tokenRows.results.reduce((sum,row)=>{const r=JSON.parse(row.data) as EvalRun;return sum+(r.usedTokens||0)+(['queued','running'].includes(r.status)?Math.max(0,r.tokenBudget-r.usedTokens):0);},0);costAssert(tokenCommitted+Number(input.tokenBudget)<=tokenCap,'이번 달 평가 토큰 승인 상한이 부족합니다.');
 const month=await readRecord<Month>(owner,kinds.month,monthId());costAssert(month.reservedKrw+month.settledKrw+p.totalMaxChargeKrw<=month.capKrw,'이번 달 원화 평가 승인 상한이 부족합니다.');
 const id=uid(),at=stamp(),intents:Intent[]=p.frozen.requests.map((r,index)=>({id:uid(),runId:id,index,month:month.id,state:'reserved',request:r.request,quote:p.quotes[index],receipt:null,version:1}));
 const boundedCost:BoundedCost={preparedId:p.id,preparedDigest:p.digest,contractDigest:p.contract.digest,mode:'fixed_krw',capKrw:Number(input.krwBudget),reservedKrw:p.totalMaxChargeKrw,settledKrw:0,intentIds:intents.map(i=>i.id),month:month.id,enforceable:true};
 const sealed=p.frozen.cases.filter(k=>k.set==='sealed').length;
 const run:EvalRun={id,...(sealed?{sealedUsed:{by:{id:actor.id,email:actor.email},at,cases:sealed}}:{}),label:input.label,variant:p.frozen.variant,set:p.frozen.set,caseIds:p.frozen.caseIds,...(p.frozen.pair?{pair:p.frozen.pair}:{}),results:p.frozen.results,tokenBudget:Number(input.tokenBudget),usedTokens:0,status:'queued',host:c.host,createdBy:{id:actor.id,email:actor.email},createdAt:at,updatedAt:at,gatewaySnapshot:snapshot(),boundedCost};
 await batch([database().prepare("SELECT json(CASE WHEN NOT EXISTS(SELECT 1 FROM records WHERE owner=? AND kind='eval_run' AND json_extract(data,'$.status') IN ('queued','running')) THEN 'null' ELSE 'stale_eval_cost' END)").bind(owner),database().prepare("SELECT json(CASE WHEN COALESCE((SELECT SUM(CASE WHEN json_extract(data,'$.status') IN ('queued','running') THEN MAX(COALESCE(json_extract(data,'$.tokenBudget'),0),COALESCE(json_extract(data,'$.usedTokens'),0)) ELSE COALESCE(json_extract(data,'$.usedTokens'),0) END) FROM records WHERE owner=? AND kind='eval_run' AND substr(json_extract(data,'$.createdAt'),1,7)=?),0)+?<=? THEN 'null' ELSE 'stale_eval_cost' END)").bind(owner,tokenMonth,Number(input.tokenBudget),tokenCap),guard(owner,'eval_budget_approval',tokenMonth,tokenApproval.approval),guard(owner,kinds.prepared,p.id,p),guard(owner,kinds.month,month.id,month),guard(owner,kinds.connection,c.id,c),...p.frozen.cases.map(k=>guard(owner,'eval_case',k.id,k)),recordStatement(owner,kinds.month,month.id,{...month,reservedKrw:month.reservedKrw+p.totalMaxChargeKrw,version:month.version+1}),recordStatement(owner,kinds.prepared,p.id,{...p,runId:id,approvalDigest}),recordStatement(owner,'eval_run',id,run),...intents.map(i=>recordStatement(owner,kinds.intent,i.id,i,id))]);return run;
}
export async function readBoundedPreparation(owner:string,id:string){const p=await readRecord<Prepared>(owner,kinds.prepared,id);return {preparedId:p.id,preparedDigest:p.digest,pair:p.frozen.pair??null,cases:p.frozen.cases,requests:p.frozen.requests.map((r,i)=>({caseId:r.caseId,variant:r.variant,requestDigest:p.quotes[i].requestDigest,maxInputTokens:p.quotes[i].maxInputTokens,maxOutputTokens:r.maxOutputTokens})),contract:p.contract,totalMaxChargeKrw:p.totalMaxChargeKrw,totalMaxTokens:p.totalMaxTokens,runId:p.runId};}
export const boundedEvaluationSummary=(run:EvalRun)=>run.boundedCost?{...run.boundedCost,unresolvedRequests:run.results.filter(r=>['pending','submitted','blocked'].includes(r.status)).length}:null;
export async function boundedCostOverview(owner:string){const c=await optionalRecord<Conn>(owner,kinds.connection,'current');return {connection:c?{configured:true,host:c.host,version:c.version}:null,month:await optionalRecord<Month>(owner,kinds.month,monthId())};}
export async function advanceBoundedEvaluation(owner:string,runId:string,grade?:(k:EvalCase,output:string,inputTokens:number|null)=>{result:Partial<EvalCaseResult>;report:unknown}){
 let run=await readRecord<EvalRun>(owner,'eval_run',runId);costAssert(run.boundedCost);const cost=run.boundedCost;if(run.deleted||run.status==='completed')return run;
 const p=await readRecord<Prepared>(owner,kinds.prepared,cost.preparedId),all=await Promise.all(cost.intentIds.map(id=>readRecord<Intent>(owner,kinds.intent,id))),intent=all.find(i=>i.state==='unknown')??all.find(i=>i.state==='reserved');if(!intent)return run;
 let current=intent,receipt:EvalCostReceipt;
 if(intent.state==='reserved'){
  if(cost.cancelRequested)return run;
  if(!(Date.parse(intent.quote.expiresAt)>Date.now())||!(Date.parse(p.contract.validUntil)>Date.now()))return cancelBoundedEvaluation(owner,{...run,blockedReason:'미전송 견적 또는 계약이 만료되어 실행을 중단했습니다. 새 견적을 준비하세요.'},run);
  await isolated(owner,p.connection.endpoint);const activeConnection=await currentConnection(owner);costAssert(activeConnection.version===p.connection.version);await validateCostContract(p.contract);await validateCostQuote(intent.quote,p.contract,intent.request,intent.quote.maxOutputTokens);
  current={...intent,state:'unknown',version:intent.version+1};const next={...run,status:'running' as const,updatedAt:stamp(),results:run.results.map((r,i)=>i===intent.index?{...r,status:'submitted' as const,submittedAt:stamp()}:r)};
  await batch([guard(owner,kinds.intent,intent.id,intent),guard(owner,'eval_run',run.id,run),recordStatement(owner,kinds.intent,intent.id,current,run.id),recordStatement(owner,'eval_run',run.id,next)]);run=next;
 }
 try{receipt=validateCostReceipt(await request(owner,p.connection,'/v1/eval-submissions'+(intent.state==='unknown'?'/'+intent.id:''),intent.state==='unknown'?undefined:{requestId:intent.id,quoteId:intent.quote.quoteId,requestDigest:intent.quote.requestDigest,contractDigest:intent.quote.contractDigest,request:intent.request}) as EvalCostReceipt,intent.quote,intent.id);}catch{const blockedReason='서명된 최종 비용 영수증을 확인하지 못해 예약을 유지하고 조회로 복구합니다.';if(run.blockedReason!==blockedReason){const next={...run,blockedReason,updatedAt:stamp()};await batch([guard(owner,'eval_run',run.id,run),recordStatement(owner,'eval_run',run.id,next)]);return next;}return run;}
 if(receipt.settlement!=='final')return run;
 const month=await readRecord<Month>(owner,kinds.month,intent.month),charge=receipt.chargeKrw!;costAssert(month.reservedKrw>=intent.quote.maxChargeKrw);const requestCase=p.frozen.requests[intent.index],kase=p.frozen.cases.find(k=>k.id===requestCase.caseId)!;
 const grading=receipt.status==='completed'&&grade?grade(kase,receipt.output!,receipt.usage!.inputTokens):null,results=run.results.map((r,i)=>i===intent.index?{...r,...grading?.result,status:receipt.status==='completed'?'completed' as const:'failed' as const,model:receipt.model,providerRunId:receipt.providerRunId,tokens:receipt.usage?{input:receipt.usage.inputTokens,output:receipt.usage.outputTokens,total:receipt.usage.inputTokens+receipt.usage.outputTokens}:undefined,completedAt:stamp()}:r),done=all.every(i=>i.id===intent.id||['final','cancelled'].includes(i.state));
 let gatewaySnapshotEnd=run.gatewaySnapshotEnd;if(done){try{await validateCostContract(await request(owner,p.connection,'/v1/eval-contract'));gatewaySnapshotEnd=snapshot();}catch{gatewaySnapshotEnd={operational:null,eval:{basis:'eval',status:'blocked',hash:null,blockedReason:'종료 시점의 원화 계약을 확인하지 못했습니다.'}};}}
 const next:EvalRun={...run,blockedReason:undefined,status:done?(cost.cancelRequested?'cancelled':'completed'):'running',results,usedTokens:run.usedTokens+(receipt.usage?receipt.usage.inputTokens+receipt.usage.outputTokens:0),updatedAt:stamp(),boundedCost:{...cost,reservedKrw:cost.reservedKrw-intent.quote.maxChargeKrw,settledKrw:cost.settledKrw+charge},...(done?{gatewaySnapshotEnd}:{})};
 const writes=[guard(owner,kinds.intent,current.id,current),guard(owner,'eval_run',run.id,run),guard(owner,kinds.month,month.id,month),recordStatement(owner,kinds.intent,current.id,{...current,state:'final',receipt,version:current.version+1},run.id),recordStatement(owner,kinds.month,month.id,{...month,reservedKrw:month.reservedKrw-intent.quote.maxChargeKrw,settledKrw:month.settledKrw+charge,version:month.version+1}),recordStatement(owner,'eval_run',run.id,next)];
 if(receipt.status==='completed')writes.push(recordStatement(owner,'eval_output',run.pair?`${run.id}:${requestCase.caseId}:${requestCase.variant}`:`${run.id}:${requestCase.caseId}`,{runId:run.id,caseId:requestCase.caseId,variant:requestCase.variant,output:receipt.output,model:receipt.model,compliance:grading?.report??null,createdAt:stamp()},run.id));await batch(writes);return next;
}
export async function cancelBoundedEvaluation(owner:string,run:EvalRun,persistedRun:EvalRun=run){
 costAssert(run.boundedCost);const intents=await Promise.all(run.boundedCost.intentIds.map(id=>readRecord<Intent>(owner,kinds.intent,id))),unsent=intents.filter(i=>i.state==='reserved'),released=unsent.reduce((n,i)=>n+i.quote.maxChargeKrw,0),month=await readRecord<Month>(owner,kinds.month,run.boundedCost.month),pending=intents.some(i=>i.state==='unknown');
 const next:EvalRun={...run,status:pending?'running':'cancelled',boundedCost:{...run.boundedCost,cancelRequested:true,reservedKrw:run.boundedCost.reservedKrw-released},results:run.results.map((r,index)=>unsent.some(i=>i.index===index)?{...r,status:'not_run'}:r),updatedAt:stamp()};
 await batch([guard(owner,'eval_run',run.id,persistedRun),guard(owner,kinds.month,month.id,month),...unsent.map(i=>guard(owner,kinds.intent,i.id,i)),...unsent.map(i=>recordStatement(owner,kinds.intent,i.id,{...i,state:'cancelled',version:i.version+1},run.id)),recordStatement(owner,kinds.month,month.id,{...month,reservedKrw:month.reservedKrw-released,version:month.version+1}),recordStatement(owner,'eval_run',run.id,next)]);return next;
}

/** Local output erasure only: keep cost identity, signature and original receipt digest. */
export async function boundedOutputDeletionStatements(owner:string,run:EvalRun,at:string){
 if(!run.boundedCost)return [];
 costAssert(run.boundedCost.reservedKrw===0,'미정산 원화 평가 비용을 먼저 회수하세요.');
 const intents=await Promise.all(run.boundedCost.intentIds.map(id=>readRecord<Intent>(owner,kinds.intent,id)));
 costAssert(intents.every(i=>i.runId===run.id&&['final','cancelled'].includes(i.state)),'미정산 평가 요청을 먼저 회수하세요.');
 const writes:D1PreparedStatement[]=[guard(owner,'eval_run',run.id,run),...intents.map(i=>guard(owner,kinds.intent,i.id,i))];
 for(const intent of intents){
  if(intent.state!=='final'||!intent.receipt||!Object.hasOwn(intent.receipt,'output'))continue;
  const {output,...receipt}=intent.receipt;void output;
  writes.push(recordStatement(owner,kinds.intent,intent.id,{...intent,receipt,receiptDigestBeforeOutputDeletion:await costDigest(intent.receipt),outputDeletedAt:at,version:intent.version+1},run.id));
 }
 return writes;
}
