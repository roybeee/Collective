// 캠페인 보관(ux-9 권고 2). 보관은 캠페인 레코드의 archivedAt·archivedBy 두 필드만 쓴다. 새 kind를 만들지 않고 브리프 버전·저장 status·updatedAt은 그대로다.
// 보관 캠페인은 워크스페이스 목록·대시보드에서 숨기고(캠페인 목록 '보관함' 필터로만 보임), 새 AI 실행·연속 실행·발행 승인·접수를 409로 막는다.
// 진행 중 작업이 있으면 보관을 거절한다(409). 삭제 정책(lib/server.ts deleteCampaign, lib/record-kinds.ts)은 바꾸지 않는다. 호출자는 소유자 잠금을 잡는다.
import type {Campaign} from './agency';
import type {BriefDraft} from './brief';
import type {CampaignSequence} from './campaign-sequence';
import type {Publication} from './execution';
import {meetingActive,type Meeting} from './meetings';
import {campaignJobs} from './record-kinds';
import {ApiError,database,eventStatement,listRecords,readRecord,stamp,type EventActor} from './server';

export type CampaignArchive={archivedAt?:string;archivedBy?:{id:string;email:string|null}};
export const ARCHIVED_CAMPAIGN='보관된 캠페인입니다. 보관 해제 후 다시 시도하세요.';
type Archivable={id:string}&CampaignArchive;
export const isArchived=(campaign:Archivable)=>typeof campaign.archivedAt==='string'&&campaign.archivedAt!=='';
export function assertNotArchived(campaign:Archivable){if(isArchived(campaign))throw new ApiError(409,ARCHIVED_CAMPAIGN)}
// 라우트의 빠른 거절(app/api/run·meetings·brief의 start, 회의 retry_failed, 잠금 밖)과 회의 retry_failed의 잠금 안 재검사(lib/meeting-execution.ts)에서 쓴다. 없는 캠페인은 원래 실행 경로가 404로 답하게 둔다.
// 실행 경로(str)처럼 앞뒤 공백을 떼고 읽는다. 공백을 붙인 id로 검사를 건너뛰고 실행만 보관 캠페인을 읽는 일을 막는다.
// 경합 해소(PR 4a-2): 라우트 사전 검사는 잠금 밖이라 보관과 동시에 들어온 시작이 통과할 수 있다. 그래서 실행 lib(역할·회의·캠페인 초안 start, 회의 retry_failed)가 소유자 잠금을 잡고 캠페인을 읽은 직후 다시 검사한다.
// 보관도 같은 소유자 잠금 안에서 기록하므로 시작과 보관 중 먼저 잠금을 잡은 쪽만 반영된다(docs/CAMPAIGN-STATUS.ko.md).
export async function assertCampaignNotArchived(owner:string,campaignId:unknown){
 const id=typeof campaignId==='string'?campaignId.trim():'';
 if(!id)return;
 let campaign:Archivable;
 try{campaign=await readRecord<Campaign&CampaignArchive>(owner,'campaign',id)}catch(e){if(e instanceof ApiError&&e.status===404)return;throw e}
 assertNotArchived(campaign);
}
// 실패 회의 재시도(retry_failed)는 회의 번호만 받으므로 회의 기록의 캠페인으로 검사한다. 없는 회의는 원래 경로가 404로 답한다.
export async function assertMeetingCampaignNotArchived(owner:string,meetingId:unknown){
 const id=typeof meetingId==='string'?meetingId.trim():'';
 if(!id)return;
 let meeting:Pick<Meeting,'campaignId'>;
 try{meeting=await readRecord<Meeting>(owner,'team_meeting',id)}catch(e){if(e instanceof ApiError&&e.status===404)return;throw e}
 await assertCampaignNotArchived(owner,meeting.campaignId);
}

const ACTIVE=['starting','queued','in_progress','uncertain'];
// 보관을 막는 진행 중 작업(없으면 null): 활성 AI 작업, 진행 중 회의, 연속 실행, Buffer 접수 중·예약 대기 발행, 이 캠페인의 HERMES 초안 작성.
async function archiveBlock(owner:string,id:string){
 const running=await database().prepare(`SELECT id FROM jobs WHERE owner=? AND ${campaignJobs.where} AND status IN ('starting','queued','in_progress','uncertain') LIMIT 1`).bind(owner,...campaignJobs.binds(owner,id)).first();
 if(running)return '진행 중인 AI 작업이 있습니다. 캠페인의 AI 팀에서 작업을 완료하거나 취소한 뒤 보관해 주세요.';
 const [meetings,sequences,publications,drafts]=await Promise.all([listRecords<Meeting>(owner,'team_meeting',id),listRecords<CampaignSequence>(owner,'campaign_sequence',id),listRecords<Publication>(owner,'execution_publication',id),listRecords<BriefDraft>(owner,'brief_draft')]);
 if(meetings.some(meetingActive))return '팀 회의가 진행 중입니다. 회의를 마치거나 중지한 뒤 보관해 주세요.';
 if(sequences.some(s=>s.status==='running'))return '연속 실행이 진행 중입니다. 연속 실행을 멈춘 뒤 보관해 주세요.';
 if(publications.some(p=>p.status==='submitting'))return 'Buffer에 발행을 접수하는 중입니다. 접수 결과를 확인한 뒤 보관해 주세요.';
 // Buffer가 받은 예약(accepted, 예약 시각 전)은 보관 뒤에도 외부에서 게시되므로 보관하지 않는다. 예약 시각이 지나면 막지 않는다.
 if(publications.some(p=>p.status==='accepted'&&Date.parse(p.scheduledAt)>Date.now()))return '예약된 발행이 있습니다. 예약 게시가 끝난 뒤 보관하거나, 게시하지 않으려면 Buffer에서 예약을 취소하고 발행 상태를 새로 고친 뒤 보관해 주세요.';
 if(drafts.some(d=>(d.campaignId===id||d.savedCampaignId===id)&&ACTIVE.includes(d.status)))return '이 캠페인의 HERMES 초안을 작성 중입니다. 초안을 완료하거나 중지한 뒤 보관해 주세요.';
 return null;
}
// 두 필드만 SQL에서 바꾼다. 읽은 뒤 전체를 다시 쓰지 않아 다른 필드(버전·status·updatedAt)를 덮지 않는다.
const campaignUpdate=(owner:string,id:string,expression:string,binds:unknown[])=>database().prepare(`UPDATE records SET data=${expression},updated_at=? WHERE id=? AND owner=? AND kind='campaign'`).bind(...binds,stamp(),`${owner}:campaign:${id}`,owner);

export async function archiveCampaign(owner:string,campaignId:string,who:EventActor){
 const campaign=await readRecord<Campaign&CampaignArchive>(owner,'campaign',campaignId);
 if(isArchived(campaign))return {id:campaign.id,archivedAt:campaign.archivedAt!,archivedBy:campaign.archivedBy??null};
 const blocked=await archiveBlock(owner,campaign.id);
 if(blocked)throw new ApiError(409,blocked);
 const archivedAt=stamp(),archivedBy={id:who.id,email:who.email};
 await database().batch([
  campaignUpdate(owner,campaign.id,"json_set(data,'$.archivedAt',?,'$.archivedBy',json(?))",[archivedAt,JSON.stringify(archivedBy)]),
  eventStatement(owner,campaign.id,'캠페인을 보관했습니다. 목록·대시보드에서 숨기고 새 AI 실행·연속 실행·발행 승인을 막습니다.',who),
 ]);
 return {id:campaign.id,archivedAt,archivedBy};
}

export async function unarchiveCampaign(owner:string,campaignId:string,who:EventActor){
 const campaign=await readRecord<Campaign&CampaignArchive>(owner,'campaign',campaignId);
 if(!isArchived(campaign))return {id:campaign.id,archivedAt:null};
 await database().batch([
  campaignUpdate(owner,campaign.id,"json_remove(data,'$.archivedAt','$.archivedBy')",[]),
  eventStatement(owner,campaign.id,'캠페인 보관을 해제했습니다.',who),
 ]);
 return {id:campaign.id,archivedAt:null};
}
