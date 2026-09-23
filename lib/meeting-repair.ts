import type {Artifact,Brand,Campaign} from './agency';
import {invalidStepOutput,storedStepOutput,type Meeting,type MeetingStep} from './meetings';
import type {BriefDraft} from './brief';
import {ApiError,database,listRecords,readRecord,stamp} from './server';
import {evidenceContext,brandBasis} from './ai-context';

export const meetingSubmissionId=(s:MeetingStep)=>s.attempt?`${s.id}:retry:${s.attempt}`:s.id;
export async function requireMeetingWorker(owner:string){
 try{await readRecord(owner,'worker_credential','current')}
 catch(error){if(error instanceof ApiError&&error.status===404)throw new ApiError(409,'서버 작업자를 먼저 등록하세요. 회의 진행은 서버 작업자가 담당합니다.');throw error}
}
// 회의 기준 자료: 캠페인 버전, 현행 작업물, 브랜드 기본 정보, 사실 원장·상시 지시. 재시도 가능 여부와 화면의 stale 표시가 같은 판정을 쓴다.
// 브랜드 수정은 캠페인 version을 올리지 않으므로 브랜드를 따로 비교한다.
export async function meetingBasis(owner:string,campaignId:string){
 const campaign=await readRecord<Campaign>(owner,'campaign',campaignId);
 const artifacts=(await listRecords<Artifact>(owner,'artifact',campaignId)).filter(a=>a.status!=='outdated');
 return {campaign,artifacts,brand:await readRecord<Brand>(owner,'brand',campaign.brandId),evidence:await evidenceContext(database(),owner,campaign)};
}
export type MeetingBasis=Awaited<ReturnType<typeof meetingBasis>>;
const signature=(items:Artifact[])=>JSON.stringify(items.map(a=>[a.id,a.version,a.status,a.content]).sort((a,b)=>String(a[0]).localeCompare(String(b[0]))));
// AI가 받은 근거(사실·상시 지시)만 서명한다. 근거 없이 시작한 이전 회의는 근거를 쓰지 않았으므로 비교하지 않는다.
const evidenceSignature=(e:Pick<MeetingBasis['evidence'],'facts'|'directives'>)=>JSON.stringify([e.facts,e.directives]);
export function meetingStale(m:Meeting,basis:MeetingBasis){
 return basis.campaign.version!==m.campaignVersion||signature(basis.artifacts)!==signature(m.snapshot.artifacts)||brandBasis(basis.brand)!==brandBasis(m.snapshot.brand)||!!m.snapshot.evidence&&evidenceSignature(m.snapshot.evidence)!==evidenceSignature(basis.evidence);
}
export async function assertMeetingSnapshot(owner:string,m:Meeting){
 if(meetingStale(m,await meetingBasis(owner,m.campaignId)))throw new ApiError(409,'회의 기준 자료가 변경됐습니다. 최신 자료로 후속 회의를 시작하세요.');
}
// completed: 저장된 응답으로 완료한 단계. 호출자가 단계 후속 처리(과제 추가·작업물 저장)를 한다.
export async function retryFailedMeeting(owner:string,m:Meeting,input:Record<string,unknown>):Promise<{meeting:Meeting;completed?:MeetingStep}>{
 const s=m.steps.find(step=>step.status!=='completed');
 if(!s||input.stepId!==s.id||!Number.isInteger(input.expectedAttempt))throw new ApiError(409,'재시도할 단계와 시도를 다시 확인하세요.');
 // A lost HTTP acknowledgement can replay the same user action, but cannot spend another attempt.
 if(['running','uncertain'].includes(m.status)&&input.expectedAttempt===(s.attempt||0)-1)return {meeting:m};
 const stored=m.status==='failed'?storedStepOutput(m,s):null;
 if(m.status!=='failed'||m.stopRequested||input.expectedAttempt!==(s.attempt||0)||!stored&&!invalidStepOutput(m,s))throw new ApiError(409,'응답 검증에 실패한 현재 단계만 재시도할 수 있습니다.');
 if(!stored&&(s.attempt||0)>=2)throw new ApiError(409,'이 단계는 재시도 2회 한도에 도달했습니다. 기록을 확인하고 후속 회의를 시작하세요.');
 await requireMeetingWorker(owner);await assertMeetingSnapshot(owner,m);
 const busy=await database().prepare("SELECT id FROM jobs WHERE owner=? AND campaign_id=? AND status IN ('starting','queued','in_progress','uncertain')").bind(owner,m.campaignId).first();
 if(busy)throw new ApiError(409,'다른 작업이 진행 중입니다. 완료하거나 중지한 뒤 재시도하세요.');
 const drafts=await listRecords<BriefDraft>(owner,'brief_draft');
 if(drafts.some(d=>(d.campaignId===m.campaignId||d.savedCampaignId===m.campaignId)&&['starting','queued','in_progress','uncertain'].includes(d.status)))throw new ApiError(409,'캠페인 초안 작성이 진행 중입니다.');
 // 저장된 응답이 현재 파서로 통과하면 모델을 다시 부르지 않고 그 응답으로 완료한다(추가 사용량 없음).
 if(stored){const completed:MeetingStep={...s,status:'completed',output:stored.output,...(stored.warnings.length?{warnings:stored.warnings}:{}),error:undefined,failureKind:undefined,completedAt:stamp()};return {meeting:{...m,status:'running',error:undefined,updatedAt:stamp(),steps:m.steps.map(step=>step.id===s.id?completed:step)},completed}}
 const archived={attempt:s.attempt||0,status:'failed' as const,providerId:s.providerId,raw:s.raw,error:s.error||m.error||'응답 형식 검증 실패',tokens:s.tokens,startedAt:s.startedAt,completedAt:s.completedAt};
 const next:MeetingStep={...s,status:'pending',attempt:(s.attempt||0)+1,attempts:[...(s.attempts||[]),archived],correction:{error:archived.error},providerId:undefined,raw:undefined,output:undefined,error:undefined,tokens:undefined,startedAt:undefined,completedAt:undefined,failureKind:undefined};
 return {meeting:{...m,status:'running',error:undefined,updatedAt:stamp(),steps:m.steps.map(step=>step.id===s.id?next:step)}};
}
