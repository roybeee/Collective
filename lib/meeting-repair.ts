import type {Artifact,Campaign} from './agency';
import {invalidStepOutput,type Meeting,type MeetingStep} from './meetings';
import type {BriefDraft} from './brief';
import {ApiError,database,listRecords,readRecord,stamp} from './server';

export const meetingSubmissionId=(s:MeetingStep)=>s.attempt?`${s.id}:retry:${s.attempt}`:s.id;
export async function requireMeetingWorker(owner:string){
 try{await readRecord(owner,'worker_credential','current')}
 catch(error){if(error instanceof ApiError&&error.status===404)throw new ApiError(409,'서버 작업자를 먼저 등록하세요. 회의 진행은 서버 작업자가 담당합니다.');throw error}
}
export async function assertMeetingSnapshot(owner:string,m:Meeting){
 const c=await readRecord<Campaign>(owner,'campaign',m.campaignId);
 const current=(await listRecords<Artifact>(owner,'artifact',m.campaignId)).filter(a=>a.status!=='outdated');
 const signature=(items:Artifact[])=>JSON.stringify(items.map(a=>[a.id,a.version,a.status,a.content]).sort((a,b)=>String(a[0]).localeCompare(String(b[0]))));
 if(c.version!==m.campaignVersion||signature(current)!==signature(m.snapshot.artifacts))throw new ApiError(409,'회의 기준 자료가 변경됐습니다. 최신 자료로 후속 회의를 시작하세요.');
}
export async function retryFailedMeeting(owner:string,m:Meeting,input:Record<string,unknown>):Promise<Meeting>{
 const s=m.steps.find(step=>step.status!=='completed');
 if(!s||input.stepId!==s.id||!Number.isInteger(input.expectedAttempt))throw new ApiError(409,'재시도할 단계와 시도를 다시 확인하세요.');
 // A lost HTTP acknowledgement can replay the same user action, but cannot spend another attempt.
 if(['running','uncertain'].includes(m.status)&&input.expectedAttempt===(s.attempt||0)-1)return m;
 if(m.status!=='failed'||m.stopRequested||input.expectedAttempt!==(s.attempt||0)||!invalidStepOutput(m,s))throw new ApiError(409,'응답 검증에 실패한 현재 단계만 재시도할 수 있습니다.');
 if((s.attempt||0)>=2)throw new ApiError(409,'이 단계는 재시도 2회 한도에 도달했습니다. 기록을 확인하고 후속 회의를 시작하세요.');
 await requireMeetingWorker(owner);await assertMeetingSnapshot(owner,m);
 const busy=await database().prepare("SELECT id FROM jobs WHERE owner=? AND campaign_id=? AND status IN ('starting','queued','in_progress','uncertain')").bind(owner,m.campaignId).first();
 if(busy)throw new ApiError(409,'다른 작업이 진행 중입니다. 완료하거나 중지한 뒤 재시도하세요.');
 const drafts=await listRecords<BriefDraft>(owner,'brief_draft');
 if(drafts.some(d=>(d.campaignId===m.campaignId||d.savedCampaignId===m.campaignId)&&['starting','queued','in_progress','uncertain'].includes(d.status)))throw new ApiError(409,'캠페인 초안 작성이 진행 중입니다.');
 const archived={attempt:s.attempt||0,status:'failed' as const,providerId:s.providerId,raw:s.raw,error:s.error||m.error||'응답 형식 검증 실패',tokens:s.tokens,startedAt:s.startedAt,completedAt:s.completedAt};
 const next:MeetingStep={...s,status:'pending',attempt:(s.attempt||0)+1,attempts:[...(s.attempts||[]),archived],correction:{error:archived.error},providerId:undefined,raw:undefined,output:undefined,error:undefined,tokens:undefined,startedAt:undefined,completedAt:undefined,failureKind:undefined};
 return {...m,status:'running',error:undefined,updatedAt:stamp(),steps:m.steps.map(step=>step.id===s.id?next:step)};
}
