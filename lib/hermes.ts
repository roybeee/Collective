import {ApiError,recordStatement,readRecord,type Connection} from './server';

export function hermesEndpoint(value:string){
 let u:URL;try{u=new URL(value)}catch{throw new ApiError(400,'HERMES HTTPS 주소를 입력하세요.')}
 const h=u.hostname.toLowerCase();
 if(u.protocol!=='https:'||u.port&&u.port!=='443'||u.username||u.password||u.search||u.hash||!h.includes('.')||h.includes(':')||/^[\d.]+$/.test(h)||/(^|\.)(localhost|local|internal|lan|home|test|invalid)$/.test(h)||!/^\/(?:[a-zA-Z0-9_-]+\/?)*$/.test(u.pathname))throw new ApiError(400,'외부에서 접근 가능한 HERMES HTTPS 기본 주소가 필요합니다.');
 return u.href.replace(/\/+$/,'').replace(/\/v1$/,'');
}
export async function hermesRequest(cfg:Connection,path:string,init:RequestInit={}){
 let r:Response;try{r=await fetch(hermesEndpoint(cfg.endpoint!)+path,{...init,redirect:'manual',headers:{...init.headers,Authorization:`Bearer ${cfg.key}`,'Content-Type':'application/json'},signal:AbortSignal.timeout(30000)})}catch{throw new ApiError(502,'HERMES에 연결하지 못했습니다. gateway와 연결 주소를 확인하세요. OpenAI API로 전환하지 않았습니다.')}
 if(r.status>=300&&r.status<400)throw new ApiError(502,'HERMES 주소가 다른 주소로 이동합니다. 최종 HTTPS 주소를 등록하세요.');
 if(!r.ok)throw new ApiError(r.status===429?429:r.status>=500?502:400,r.status===401||r.status===403?'HERMES 연결 암호를 확인하세요.':`HERMES 요청을 처리하지 못했습니다 (${r.status}).`);
 try{return await r.json() as any}catch{throw new ApiError(502,'HERMES 응답 형식이 올바르지 않습니다.')}
}
export async function verifyHermes(cfg:Connection){
 const c=await hermesRequest(cfg,'/v1/capabilities');
 if(c.object!=='hermes.api_server.capabilities'||c.platform!=='hermes-agent'||!c.features?.run_submission||!c.features?.run_status||!c.features?.run_stop||c.features?.runs_idempotency?.durable!==true||c.features.runs_idempotency.enabled===false||c.features.runs_idempotency.supported===false)throw new ApiError(400,'실행·조회·중지 및 영구 중복 방지를 지원하는 최신 HERMES gateway가 필요합니다.');
 let unauth:Response;try{unauth=await fetch(cfg.endpoint+'/v1/capabilities',{redirect:'manual',signal:AbortSignal.timeout(30000)})}catch{throw new ApiError(502,'HERMES 인증 보호를 확인하지 못했습니다.')}
 if(![401,403].includes(unauth.status))throw new ApiError(400,'HERMES gateway의 연결 암호 보호를 설정하세요.');
 const m=await hermesRequest(cfg,'/v1/models');return 'HERMES · '+(typeof m.data?.[0]?.id==='string'?m.data[0].id.slice(0,100):'기본 모델');
}
type Submission={body:string;key:string};
export async function submitHermes(owner:string,id:string,cfg:Connection,input?:{input:string;instructions:string}){
 let saved:Submission;
 if(input){const key='collective-'+crypto.randomUUID();saved={key,body:JSON.stringify({...input,session_id:key,conversation_history:[]})};await recordStatement(owner,'hermes_submission',id,saved).run()}
 else saved=await readRecord<Submission>(owner,'hermes_submission',id);
 const r=await hermesRequest(cfg,'/v1/runs',{method:'POST',headers:{'Idempotency-Key':saved.key,'X-Hermes-Session-Key':saved.key},body:saved.body});
 if(typeof r.run_id!=='string'||!/^[a-zA-Z0-9_-]{1,160}$/.test(r.run_id))throw new ApiError(502,'HERMES 실행 번호를 확인하지 못했습니다. 기존 요청 확인으로 복구하세요.');return {id:r.run_id,status:'queued'};
}
export async function pollHermes(cfg:Connection,id:string,stop=false){
 if(!/^[a-zA-Z0-9_-]{1,160}$/.test(id))throw new ApiError(400,'HERMES 실행 번호가 올바르지 않습니다.');
 if(stop)await hermesRequest(cfg,'/v1/runs/'+id+'/stop',{method:'POST',body:'{}'});
 const r=await hermesRequest(cfg,'/v1/runs/'+id);
 if(r.run_id!==id||r.object!=='hermes.run')throw new ApiError(502,'HERMES 실행 결과가 일치하지 않습니다.');
 const status=r.status==='completed'?'completed':['cancelled','canceled','stopped','interrupted'].includes(r.status)?'cancelled':['failed','error'].includes(r.status)?'failed':['started','queued','running','stopping','waiting','waiting_approval','waiting_for_approval','pending'].includes(r.status)?'in_progress':null;
 if(!status)throw new ApiError(502,'HERMES 실행 상태를 확인하지 못했습니다.');
 if(status==='completed'&&(typeof r.output!=='string'||r.output.length>300000))throw new ApiError(502,'HERMES 작업물 형식이 올바르지 않습니다.');
 return {id,status,output:status==='completed'?[{content:[{type:'output_text',text:r.output}]}]:[],usage:{total_tokens:r.usage?.total_tokens||0}};
}
