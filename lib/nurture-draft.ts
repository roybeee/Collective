// 트랙 R R9a-2 너처링 템플릿 초안 작성(HERMES 1회). 브리프 초안(lib/brief-execution.ts)과 같은 복구 경로를 쓴다: 시작 → 접수(queued) → 조회(poll)·복구(recover)·중지(cancel).
// 제출 본문은 lib/franchise-nurture.ts nurtureSubmission이 허용 입력(목적·분류·매체·브랜드 이름·업종·소개·말투·확정 사실 줄)으로만 조립한다. 리드·이벤트·연락처·가명 코드·시스템 코드를 읽지 않는다.
// 모델 경계(DP-10): 이 모듈은 HERMES를 쓰므로 모델 경로의 루트다. 가맹 리드 모듈(lib/franchise.ts·lib/franchise-server.ts 등 FORBIDDEN)을 import하지 않는다(tests/franchise-model-boundary.test.mjs).
// 완료 출력은 JSON을 읽고 템플릿 검사(자리표시·개인정보·광고성 고정 요소·R2)를 통과할 때만 결과를 저장한다. 실패·형식 오류·막힘은 본문 없이 사유 코드만 남긴다(부분 본문 없음).
// 초안은 저장만 하고 보내지 않는다. 사람이 고쳐 템플릿으로 저장한다(lib/franchise-nurture-server.ts). 결과는 COLLECTIVE 휴리스틱 · 법률 자문 아님.
import {ApiError,readRecord,listRecords,recordStatement,connection,stamp,database} from './server';
import {submitHermes,pollHermes,hermesSubmissionStatement} from './hermes';
import {markUsageOutcomeSafely} from './usage-outcome';
import type {UsageContext} from './usage-ledger';
import {loadFranchiseContext} from './franchise-facts-server';
import {factLine,versionStates,type VersionLite} from './franchise-facts';
import {franchiseItem} from './fact-catalog';
import {isInstant,parseInstant} from './franchise-rules';
import {draftRequest,nurtureSubmission,parseNurtureOutput,templateDecision,PURPOSE_KEYS,MEDIA,type Purpose,type Medium,type NurtureCode} from './franchise-nurture';
import type {Brand} from './agency';
import type {BrandFact} from './brand-facts';

export type DraftStatus='starting'|'queued'|'in_progress'|'uncertain'|'completed'|'failed'|'cancelled';
// 초안 기록(brand 행). result는 검사를 통과한 완료 출력뿐이다. 실패면 reasons(사유 코드)와 고정 문구만 있다.
export type NurtureDraft={id:string;brandId:string;purpose:Purpose;medium:Medium;status:DraftStatus;providerId?:string;result:{subject:string|null;body:string}|null;reasons:NurtureCode[];error?:string;
 model:string;factCount:number;createdAt:string;updatedAt:string;by:{id:string;role:string}};
const ACTIVE:readonly DraftStatus[]=['starting','queued','in_progress','uncertain'];
export const isActiveDraft=(d:{status:string})=>(ACTIVE as readonly string[]).includes(d.status);
export const DRAFT_ID=/^nd-[A-Za-z0-9_-]{6,60}$/;
const submissionId=(id:string)=>'nurture-'+id;
const usage=(d:NurtureDraft):UsageContext=>({kind:'nurture',submissionId:submissionId(d.id),jobId:d.id,brandId:d.brandId,campaignId:null});
const save=(owner:string,d:NurtureDraft)=>recordStatement(owner,'franchise_nurture_draft',d.id,d,d.brandId);
const MESSAGES={
 busy:'이 브랜드에 작성 중인 너처링 초안이 있습니다. 끝나거나 중지한 뒤 다시 요청하세요.',
 hermes:'너처링 초안은 HERMES 연결로만 작성합니다. 연결 및 설정에서 HERMES를 선택해 주세요.',
 uncertain:'접수 여부를 확인하지 못했습니다. 같은 초안에서 복구를 눌러 이어서 확인하세요.',
 failed:'HERMES가 초안을 끝내지 못했습니다. 다시 요청할 수 있습니다.',
 invalid:'HERMES 출력이 정해진 형식(JSON)이 아니어서 저장하지 않았습니다.',
 blocked:'HERMES 초안이 템플릿 검사에서 막혀 저장하지 않았습니다(사유 코드만 남김).',
 input:'목적·매체·초안 번호를 확인하세요. 광고성 목적은 알림톡으로 만들 수 없습니다.',
} as const;

// 모델에 보낼 확정 사실 줄: 이 브랜드의 확정·유효 사실, 지점 사실·수익 항목(광고 사용 불가) 제외, 정보공개서 근거가 있으면 현재 버전만. 사실 id 순.
export function draftFactLines(facts:readonly BrandFact[],versions:readonly VersionLite[],brandId:string,now:string):string[]{
 if(!isInstant(now))return [];
 const t=parseInstant(now),states=versionStates(versions,now);
 return facts.filter(f=>f.brandId===brandId&&!f.storeId&&f.status==='confirmed'&&typeof f.source==='string'&&!!f.source.trim()&&isInstant(f.verifiedAt)&&isInstant(f.validUntil)&&parseInstant(f.verifiedAt)<=t&&t<parseInstant(f.validUntil)
  &&franchiseItem(f.key)?.adUse!==false&&(!f.sourceRef||states[f.sourceRef.disclosureVersionId]==='current'))
  .sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0).map(f=>factLine(f));
}
async function brandContext(owner:string,brandId:string,now:string){
 const [brand,facts,fr]=await Promise.all([readRecord<Brand>(owner,'brand',brandId),listRecords<BrandFact>(owner,'brand_fact',brandId),loadFranchiseContext(owner,brandId)]);
 return {brand,facts,versions:fr.versions,lines:draftFactLines(facts,fr.versions,brandId,now)};
}

// 시작: 같은 id가 있으면 그대로 돌려준다(멱등). 브랜드마다 작성 중 초안은 하나. 제출 원문(hermes_submission 'nurture-<id>')과 초안 행을 먼저 저장하고 보낸다.
export async function startNurtureDraft(owner:string,brandId:string,who:{id:string;role:string},input:Record<string,unknown>):Promise<NurtureDraft>{
 const id=input.draftId,purpose=input.purpose,medium=input.medium;
 if(typeof id!=='string'||!DRAFT_ID.test(id)||!(PURPOSE_KEYS as readonly unknown[]).includes(purpose)||!(MEDIA as readonly unknown[]).includes(medium))throw new ApiError(400,MESSAGES.input);
 const all=await listRecords<NurtureDraft>(owner,'franchise_nurture_draft',brandId),existing=all.find(d=>d.id===id);
 if(existing)return existing;
 if(all.some(isActiveDraft))throw new ApiError(409,MESSAGES.busy);
 const cfg=await connection(owner);
 if(cfg.provider!=='hermes')throw new ApiError(409,MESSAGES.hermes);
 const now=stamp(),ctx=await brandContext(owner,brandId,now),req=draftRequest(purpose,medium,ctx.brand,ctx.lines);
 if(!req)throw new ApiError(400,MESSAGES.input);
 const built=nurtureSubmission(req);
 let draft:NurtureDraft={id,brandId,purpose:req.purpose,medium:req.medium,status:'starting',result:null,reasons:[],model:cfg.model,factCount:req.factLines.length,createdAt:now,updatedAt:now,by:{id:who.id,role:who.role}};
 await database().batch([save(owner,draft),hermesSubmissionStatement(owner,submissionId(id),built)]);
 try{
  const r=await submitHermes(owner,submissionId(id),cfg);
  draft={...draft,providerId:r.id,status:'queued',updatedAt:stamp()};
 }catch(e){
  const uncertain=!(e instanceof ApiError)||e.status>=500||e.status===429;
  draft={...draft,status:uncertain?'uncertain':'failed',error:uncertain?MESSAGES.uncertain:(e as Error).message,updatedAt:stamp()};
 }
 await save(owner,draft).run();
 return draft;
}
// 조회·복구·중지. 접수 번호가 없으면(응답 유실) 저장한 제출 원문과 같은 멱등 키로 다시 보낸다(복구). 끝난 초안은 그대로 돌려준다.
export async function pollNurtureDraft(owner:string,brandId:string,input:Record<string,unknown>):Promise<NurtureDraft>{
 const id=input.draftId,mode=input.mode==='cancel'?'cancel':input.mode==='recover'?'recover':'poll';
 if(typeof id!=='string'||!DRAFT_ID.test(id))throw new ApiError(400,MESSAGES.input);
 const draft=await readRecord<NurtureDraft>(owner,'franchise_nurture_draft',id);
 if(draft.brandId!==brandId)throw new ApiError(404,'초안을 찾지 못했습니다.');
 if(!isActiveDraft(draft))return draft;
 const cfg=await connection(owner);
 if(cfg.provider!=='hermes')throw new ApiError(409,MESSAGES.hermes);
 let next:NurtureDraft={...draft};
 if(!next.providerId){
  if(mode!=='recover'){next={...next,status:'uncertain',error:MESSAGES.uncertain,updatedAt:stamp()};await save(owner,next).run();return next}
  const r=await submitHermes(owner,submissionId(id),cfg);
  next={...next,providerId:r.id,status:'queued',error:undefined};
  await save(owner,next).run();
 }
 const r=await pollHermes(cfg,next.providerId!,mode==='cancel',30000,owner,usage(next));
 next={...next,status:r.status as DraftStatus,error:undefined,updatedAt:stamp()};
 let outcome:'completed'|'cancelled'|'invalid_output'|'provider_failed'|null=null;
 if(r.status==='completed'){
  const parsed=parseNurtureOutput(r.output[0]?.content[0]?.text,next.medium);
  if(!parsed){next={...next,status:'failed',error:MESSAGES.invalid,reasons:[]};outcome='invalid_output'}
  else{
   const ctx=await brandContext(owner,brandId,next.updatedAt);
   const d=templateDecision({purpose:next.purpose,medium:next.medium,subject:parsed.subject,body:parsed.body},{enabled:true,brandId,now:next.updatedAt,facts:ctx.facts,versions:ctx.versions});
   if(d.ok){next={...next,result:{subject:parsed.subject,body:d.value.body}};outcome='completed'}
   else{next={...next,status:'failed',error:MESSAGES.blocked,reasons:d.reasons};outcome='invalid_output'}
  }
 }else if(r.status==='failed'){next={...next,error:MESSAGES.failed};outcome=r.invalidOutput?'invalid_output':'provider_failed'}
 else if(r.status==='cancelled')outcome='cancelled';
 await save(owner,next).run();
 if(outcome)await markUsageOutcomeSafely(owner,'hermes',next.providerId!,outcome);
 return next;
}
// 화면용: 초안 행 그대로(제출 원문·접수 번호 없음).
export function publicDraft(d:NurtureDraft):Omit<NurtureDraft,'providerId'>{const out={...d};delete out.providerId;return out}
