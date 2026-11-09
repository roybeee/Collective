// X6 선택 다시 쓰기 요청(서버). 스위치 selection_rewrite(기본 꺼짐)가 켜진 소유자만 쓴다. 꺼져 있으면 시작·조회·결정 모두 409다.
// 경로: 브리프 초안·너처링 초안(lib/brief-execution.ts, lib/nurture-draft.ts)과 같은 HERMES 한 번 제출 → 조회(poll)·복구(recover)·중지(cancel).
// 제출 원문은 hermes_submission 'rewrite-<id>'(부모 없음)이고 lib/hermes.ts submitHermes가 요청 전에 토큰 예산(lib/token-budget.ts)을 예약한다. 상한을 넘으면 409로 막고 보내지 않는다.
// 자율성 규칙: 역할 실행(role_run)이 금지(never)면 403. 시작은 확인 카드를 거친 사람의 요청뿐이다(자동 실행 없음).
// 제안은 요청 기록(kind rewrite_request, 부모 캠페인)에만 남고 캡션·작업물·발행에는 쓰지 않는다. 받기·버리기 결정만 같은 기록에 더한다.
import {ApiError,readRecord,listRecords,recordStatement,connection,stamp,database,type Actor} from './server';
import {submitHermes,pollHermes,hermesSubmissionStatement} from './hermes';
import {markUsageOutcomeSafely} from './usage-outcome';
import type {UsageContext} from './usage-ledger';
import {isEnabled} from './feature-flags';
import {assertAutonomy} from './autonomy-server';
import {assertNotArchived} from './campaign-archive';
import type {Campaign} from './agency';
import {isActiveRewrite,parseRewriteInput,parseRewriteOutput,publicRewrite,rewriteSubmission,RewriteInputError,REWRITE_ID,type RewriteRequest,type RewriteStatus} from './rewrite-request';

export const REWRITE_MESSAGES={
 off:'선택 다시 쓰기 스위치가 꺼져 있습니다. 소유자가 기능 스위치에서 켜야 쓸 수 있습니다.',
 hermes:'선택 다시 쓰기는 HERMES 연결로만 요청합니다. 연결 및 설정에서 HERMES를 선택해 주세요.',
 busy:'이 캠페인에 처리 중인 다시 쓰기 요청이 있습니다. 끝나거나 중지한 뒤 다시 요청하세요.',
 uncertain:'접수 여부를 확인하지 못했습니다. 같은 요청에서 복구를 눌러 이어서 확인하세요.',
 failed:'HERMES가 다시 쓰기를 끝내지 못했습니다. 다시 요청할 수 있습니다.',
 invalid:'HERMES 출력이 비었거나 너무 길어 제안으로 저장하지 않았습니다.',
 notReady:'완료된 제안만 받거나 버릴 수 있습니다.',
 decided:'이미 받거나 버린 제안입니다.',
 missing:'다시 쓰기 요청을 찾지 못했습니다.',
} as const;
const submissionId=(id:string)=>'rewrite-'+id;
// 사용량 원장 조인 키. 원장 종류(UsageKind)에 다시 쓰기 전용 값이 없어 콘텐츠 역할(role content)로 기록하고 jobId에 요청 번호를 둔다.
const usage=(r:RewriteRequest):UsageContext=>({kind:'role',role:'content',submissionId:submissionId(r.id),jobId:r.id,campaignId:r.campaignId});
const save=(owner:string,r:RewriteRequest)=>recordStatement(owner,'rewrite_request',r.id,r,r.campaignId);

export async function rewriteEnabled(owner:string){try{return await isEnabled(owner,'selection_rewrite')}catch{return false}}
async function requireSwitch(owner:string){if(!await rewriteEnabled(owner))throw new ApiError(409,REWRITE_MESSAGES.off)}
async function readRequest(owner:string,id:unknown,campaignId:unknown){
 if(typeof id!=='string'||!REWRITE_ID.test(id))throw new ApiError(400,'요청 번호 형식이 올바르지 않습니다.');
 const r=await readRecord<RewriteRequest>(owner,'rewrite_request',id).catch((e:unknown)=>{if(e instanceof ApiError&&e.status===404)throw new ApiError(404,REWRITE_MESSAGES.missing);throw e});
 if(r.campaignId!==campaignId)throw new ApiError(404,REWRITE_MESSAGES.missing);
 return r;
}

// 시작: 같은 번호가 있으면 그대로 돌려준다(멱등). 캠페인마다 처리 중 요청은 하나. 요청 기록과 제출 원문을 먼저 저장하고 보낸다.
// 확정 거절(예산 초과 409 등 4xx, 429 제외)은 실패로 기록한 뒤 같은 상태 코드로 돌려준다. 연결 오류·5xx·429는 확인 불가(uncertain)로 남겨 복구한다.
export async function startRewrite(owner:string,who:Pick<Actor,'id'|'role'>,body:Record<string,unknown>){
 await requireSwitch(owner);
 let input;try{input=parseRewriteInput(body)}catch(e){if(e instanceof RewriteInputError)throw new ApiError(400,e.message);throw e}
 await assertAutonomy(owner,'role_run');
 const campaign=await readRecord<Campaign>(owner,'campaign',input.campaignId);assertNotArchived(campaign);
 const all=await listRecords<RewriteRequest>(owner,'rewrite_request',campaign.id),existing=all.find(r=>r.id===input.id);
 if(existing)return publicRewrite(existing);
 if(all.some(isActiveRewrite))throw new ApiError(409,REWRITE_MESSAGES.busy);
 const cfg=await connection(owner);
 if(cfg.provider!=='hermes')throw new ApiError(409,REWRITE_MESSAGES.hermes);
 const now=stamp();
 const prepared:RewriteRequest={id:input.id,campaignId:campaign.id,mode:input.mode,...(input.tone?{tone:input.tone}:{}),channel:input.channel,selection:input.selection,status:'starting',suggestion:null,model:cfg.model,createdAt:now,updatedAt:now,by:{id:who.id,role:who.role}};
 await database().batch([save(owner,prepared),hermesSubmissionStatement(owner,submissionId(input.id),rewriteSubmission(input))]);
 try{
  const r=await submitHermes(owner,submissionId(input.id),cfg);
  const queued:RewriteRequest={...prepared,providerId:r.id,status:'queued',updatedAt:stamp()};
  await save(owner,queued).run();
  return publicRewrite(queued);
 }catch(e){
  const definitive=e instanceof ApiError&&e.status<500&&e.status!==429;
  const next:RewriteRequest={...prepared,status:definitive?'failed':'uncertain',error:definitive?(e as Error).message:REWRITE_MESSAGES.uncertain,updatedAt:stamp()};
  await save(owner,next).run();
  if(definitive)throw e;
  return publicRewrite(next);
 }
}

type Outcome='completed'|'cancelled'|'invalid_output'|'provider_failed';
function settle(prev:RewriteRequest,status:RewriteStatus,text:unknown,invalidOutput:boolean):{next:RewriteRequest;outcome:Outcome|null}{
 const base={...prev,status,error:undefined,updatedAt:stamp()};
 if(status==='completed'){const suggestion=parseRewriteOutput(text);return suggestion?{next:{...base,suggestion},outcome:'completed'}:{next:{...base,status:'failed',error:REWRITE_MESSAGES.invalid},outcome:'invalid_output'}}
 if(status==='failed')return {next:{...base,error:REWRITE_MESSAGES.failed},outcome:invalidOutput?'invalid_output':'provider_failed'};
 return {next:base,outcome:status==='cancelled'?'cancelled':null};
}
// 조회·복구·중지. 접수 번호가 없으면(응답 유실) 저장한 제출 원문과 같은 멱등 키로 다시 보낸다(복구). 끝난 요청은 그대로 돌려준다.
export async function pollRewrite(owner:string,body:Record<string,unknown>){
 await requireSwitch(owner);
 const r=await readRequest(owner,body.id,body.campaignId),mode=body.mode==='cancel'?'cancel':body.mode==='recover'?'recover':'poll';
 if(!isActiveRewrite(r))return publicRewrite(r);
 const cfg=await connection(owner);
 if(cfg.provider!=='hermes')throw new ApiError(409,REWRITE_MESSAGES.hermes);
 let current:RewriteRequest={...r};
 if(!current.providerId){
  if(mode!=='recover'){const next={...current,status:'uncertain' as const,error:REWRITE_MESSAGES.uncertain,updatedAt:stamp()};await save(owner,next).run();return publicRewrite(next)}
  const sent=await submitHermes(owner,submissionId(r.id),cfg);
  current={...current,providerId:sent.id,status:'queued',error:undefined};
  await save(owner,current).run();
 }
 const polled=await pollHermes(cfg,current.providerId!,mode==='cancel',30000,owner,usage(current));
 const {next,outcome}=settle(current,polled.status as RewriteStatus,polled.output[0]?.content[0]?.text,!!polled.invalidOutput);
 await save(owner,next).run();
 if(outcome)await markUsageOutcomeSafely(owner,'hermes',current.providerId!,outcome);
 return publicRewrite(next);
}
// 받기·버리기: 완료된 제안에 한 번만 기록한다. 편집기 글 반영은 화면이 하고, 서버는 결정만 남긴다(캡션·발행은 바꾸지 않는다).
export async function decideRewrite(owner:string,body:Record<string,unknown>){
 await requireSwitch(owner);
 if(body.decision!=='accepted'&&body.decision!=='discarded')throw new ApiError(400,'받기(accepted) 또는 버리기(discarded)를 고르세요.');
 const r=await readRequest(owner,body.id,body.campaignId);
 if(r.status!=='completed'||!r.suggestion)throw new ApiError(409,REWRITE_MESSAGES.notReady);
 if(r.decision)throw new ApiError(409,REWRITE_MESSAGES.decided);
 const next:RewriteRequest={...r,decision:body.decision,decidedAt:stamp(),updatedAt:stamp()};
 await save(owner,next).run();
 return publicRewrite(next);
}
