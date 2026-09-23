import {ApiError,database,recordStatement,readRecord,type Connection} from './server';
import {recordProviderUsage,type UsageContext} from './usage-ledger';
import {reserveTokenBudget,releaseTokenReservation,markTokenReservationRun,settleTokenReservation} from './token-budget';
import {readBoundedJson} from './http-limits';

export function hermesEndpoint(value:string){
 let u:URL;try{u=new URL(value)}catch{throw new ApiError(400,'HERMES HTTPS 주소를 입력하세요.')}
 const h=u.hostname.toLowerCase();
 if(u.protocol!=='https:'||u.port&&u.port!=='443'||u.username||u.password||u.search||u.hash||!h.includes('.')||h.includes(':')||/^[\d.]+$/.test(h)||/(^|\.)(localhost|local|internal|lan|home|test|invalid)$/.test(h)||!/^\/(?:[a-zA-Z0-9_-]+\/?)*$/.test(u.pathname))throw new ApiError(400,'외부에서 접근 가능한 HERMES HTTPS 기본 주소가 필요합니다.');
 return u.href.replace(/\/+$/,'').replace(/\/v1$/,'');
}
export async function hermesRequest(cfg:Connection,path:string,init:RequestInit={},timeoutMs=30000){
 let r:Response;try{r=await fetch(hermesEndpoint(cfg.endpoint!)+path,{...init,redirect:'manual',headers:{...init.headers,Authorization:`Bearer ${cfg.key}`,'Content-Type':'application/json'},signal:AbortSignal.timeout(timeoutMs)})}catch{throw new ApiError(502,'HERMES 응답 시간이 초과됐거나 연결이 끊겼습니다. gateway와 연결 주소를 확인하세요. OpenAI API로 전환하지 않았습니다.')}
 if(r.status>=300&&r.status<400)throw new ApiError(502,'HERMES 주소가 다른 주소로 이동합니다. 최종 HTTPS 주소를 등록하세요.');
 if(!r.ok)throw new ApiError(r.status===429?429:r.status>=500?502:400,r.status===401||r.status===403?'HERMES 연결 암호를 확인하세요.':`HERMES 요청을 처리하지 못했습니다 (${r.status}).`);
 try{return await readBoundedJson<any>(r,1000000)}catch{throw new ApiError(502,'HERMES 응답이 너무 크거나 형식이 올바르지 않습니다.')}
}
export async function verifyHermes(cfg:Connection){
 const c=await hermesRequest(cfg,'/v1/capabilities');
 if(c.object!=='hermes.api_server.capabilities'||c.platform!=='hermes-agent'||!c.features?.run_submission||!c.features?.run_status||!c.features?.run_stop||c.features?.runs_idempotency?.durable!==true||c.features.runs_idempotency.enabled===false||c.features.runs_idempotency.supported===false)throw new ApiError(400,'실행·조회·중지 및 영구 중복 방지를 지원하는 최신 HERMES gateway가 필요합니다.');
 let unauth:Response;try{unauth=await fetch(cfg.endpoint+'/v1/capabilities',{redirect:'manual',signal:AbortSignal.timeout(30000)})}catch{throw new ApiError(502,'HERMES 인증 보호를 확인하지 못했습니다.')}
 if(![401,403].includes(unauth.status))throw new ApiError(400,'HERMES gateway의 연결 암호 보호를 설정하세요.');
 const m=await hermesRequest(cfg,'/v1/models');return 'HERMES · '+(typeof m.data?.[0]?.id==='string'?m.data[0].id.slice(0,100):'기본 모델');
}
type Submission={body:string;key:string};
export function hermesSubmissionStatement(owner:string,id:string,input:{input:string;instructions:string},parentId=''){const key='collective-'+crypto.randomUUID();return recordStatement(owner,'hermes_submission',id,{key,body:JSON.stringify({...input,session_id:key,conversation_history:[]})},parentId)}

// 역할·회의·브리프·조사·학습의 모든 운영 HERMES 제출이 지나는 한 곳이다. 요청 전에 토큰 예산 가드(loop-4, lib/token-budget.ts)가 예약하고, 상한을 넘으면 409로 막아 요청을 보내지 않는다.
// 이번에 만든 예약만 확정 거절(4xx)에 푼다. 429(미접수·재시도 예정)·연결 오류·5xx(접수 불확실)와 같은 키의 복구 재전송(이미 접수됐을 수 있음)은 예약을 남긴다. budgetWarning: 상한 미설정 경고(막지 않음).
export async function submitHermes(owner:string,id:string,cfg:Connection,input?:{input:string;instructions:string},timeoutMs=30000){
 let saved:Submission;
 if(input){const key='collective-'+crypto.randomUUID();saved={key,body:JSON.stringify({...input,session_id:key,conversation_history:[]})};await recordStatement(owner,'hermes_submission',id,saved).run()}
 else saved=await readRecord<Submission>(owner,'hermes_submission',id);
 const budget=await reserveTokenBudget(database(),owner,id,saved);
 const r=await hermesRequest(cfg,'/v1/runs',{method:'POST',headers:{'Idempotency-Key':saved.key,'X-Hermes-Session-Key':saved.key},body:saved.body},timeoutMs).catch(async(error:unknown)=>{if(error instanceof ApiError&&error.status<500&&error.status!==429&&budget.created)await releaseTokenReservation(database(),owner,id);throw error});
 if(typeof r.run_id!=='string'||!/^[a-zA-Z0-9_-]{1,160}$/.test(r.run_id))throw new ApiError(502,'HERMES 실행 번호를 확인하지 못했습니다. 기존 요청 확인으로 복구하세요.');
 await markTokenReservationRun(database(),owner,id,r.run_id);
 return {id:r.run_id,status:'queued',...(budget.warning?{budgetWarning:budget.warning}:{})};
}
// usage: 사용량 원장 조인 키(F2a). 첫 기록 때만 쓰이며 HERMES로 보내는 본문과는 무관하다.
export async function pollHermes(cfg:Connection,id:string,stop=false,timeoutMs=30000,owner?:string,usage?:UsageContext){
 if(!/^[a-zA-Z0-9_-]{1,160}$/.test(id))throw new ApiError(400,'HERMES 실행 번호가 올바르지 않습니다.');
 if(stop){
  const stopped=await hermesRequest(cfg,'/v1/runs/'+id+'/stop',{method:'POST',body:'{}'},timeoutMs);
  if(owner&&stopped.object==='hermes.run'&&stopped.run_id===id)await recordProviderUsage(owner,'hermes',id,stopped,usage);
 }
 const r=await hermesRequest(cfg,'/v1/runs/'+id,{},timeoutMs);
 if(r.run_id!==id||r.object!=='hermes.run')throw new ApiError(502,'HERMES 실행 결과가 일치하지 않습니다.');
 const status=r.status==='completed'?'completed':['cancelled','canceled','stopped','interrupted'].includes(r.status)?'cancelled':['failed','error','incomplete'].includes(r.status)?'failed':['started','queued','running','stopping','waiting','waiting_approval','waiting_for_approval','pending'].includes(r.status)?'in_progress':null;
 if(!status)throw new ApiError(502,'HERMES 실행 상태를 확인하지 못했습니다.');
 if(owner&&status!=='in_progress'){await recordProviderUsage(owner,'hermes',id,r,usage);await settleTokenReservation(database(),owner,id,usage?.submissionId)}
 const invalidOutput=status==='completed'&&(typeof r.output!=='string'||r.output.length>300000);
 const activity=typeof r.last_event==='string'&&/^[a-z_.]{1,80}$/.test(r.last_event)?r.last_event:undefined;
 const activityAt=typeof r.updated_at==='number'&&Number.isFinite(r.updated_at)&&r.updated_at>0&&r.updated_at<1e11?new Date(r.updated_at*1000).toISOString():undefined;
 const failureText=typeof r.error==='string'?r.error:JSON.stringify(r.error||'');
 const failureReason=/auth|api.?key|credential|401|403/i.test(failureText)?'HERMES 모델 또는 도구의 인증에 실패했습니다.':/timeout|timed out|deadline/i.test(failureText)?'HERMES 내부 실행 시간이 초과됐습니다.':/restart|interrupt/i.test(failureText)?'HERMES 재시작 또는 실행 중단이 보고됐습니다.':/mcp|aside|browser|tool/i.test(failureText)?'HERMES 도구 실행 중 오류가 발생했습니다. 서버 실행 기록을 확인하세요.':undefined;
 return {id,status:invalidOutput?'failed':status,invalidOutput,activity,activityAt,failureReason:invalidOutput?'HERMES 작업물이 올바른 텍스트 형식이 아니어서 종료했습니다.':failureReason,needsApproval:['waiting_approval','waiting_for_approval'].includes(r.status),output:status==='completed'&&!invalidOutput?[{content:[{type:'output_text',text:r.output}]}]:[],usage:{total_tokens:r.usage?.total_tokens||0}};
}
