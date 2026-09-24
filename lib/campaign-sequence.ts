import {artifactUsable} from './role-output';
import {roles, type Campaign, type Artifact} from './agency';
import {qualityFixes, type QualityFix, type QualityReview} from './quality';
import {ApiError, database, readRecord, listRecords, recordStatement, stamp} from './server';
import {ARCHIVED_CAMPAIGN, assertNotArchived, isArchived, type CampaignArchive} from './campaign-archive';

export type CampaignSequence={
 campaignId:string;campaignVersion:number;status:'running'|'paused'|'completed'|'blocked'|'needs_review';
 startedAt:string;updatedAt:string;error?:string;fixes?:QualityFix[];
 // fixes를 만든 품질 검수 작업물. 회의 안건 초안은 이 작업물이 아직 현재일 때만 fixes를 쓴다.
 source?:{id:string;version:number};
};

// Called under the same owner mutation lock as role execution.
export async function sequenceAction(owner:string,input:Record<string,unknown>):Promise<{sequence:CampaignSequence}|{role:string;campaignId:string}> {
 const campaignId=typeof input.campaignId==='string'?input.campaignId:'';
 const campaign=await readRecord<Campaign&CampaignArchive>(owner,'campaign',campaignId);
 let previous:CampaignSequence|undefined;
 try{previous=await readRecord<CampaignSequence>(owner,'campaign_sequence',campaignId)}
 catch(error){if(!(error instanceof ApiError&&error.status===404))throw error}
 const save=async(sequence:CampaignSequence)=>{
  await recordStatement(owner,'campaign_sequence',campaignId,sequence,campaignId).run();
  return {sequence};
 };
 if(input.action==='stop_sequence'){
  if(!previous)throw new ApiError(404,'연속 실행 기록이 없습니다.');
  return save({...previous,status:'paused',updatedAt:stamp(),error:undefined});
 }
 if(input.action==='start_sequence'){
  assertNotArchived(campaign);
  await readRecord(owner,'worker_credential','current').catch(()=>{throw new ApiError(409,'서버 작업자를 먼저 연결하세요.');});
  if(previous?.status==='running')return {sequence:previous};
  return save({campaignId,campaignVersion:campaign.version,status:'running',startedAt:stamp(),updatedAt:stamp()});
 }
 if(!previous||previous.status!=='running')throw new ApiError(409,'사용자가 시작한 연속 실행이 없습니다.');
 // 보관 캠페인: 연속 실행 중에는 보관이 거절되므로 경합으로만 생긴다. 다음 역할을 시작하지 않고 막힘으로 기록해 백그라운드가 409를 반복 재시도하지 않게 한다.
 if(isArchived(campaign))return save({...previous,status:'blocked',updatedAt:stamp(),error:ARCHIVED_CAMPAIGN});
 if(campaign.version!==previous.campaignVersion)return save({...previous,status:'blocked',updatedAt:stamp(),error:'브리프가 변경되어 멈췄습니다. 새 기준을 확인한 뒤 다시 시작하세요.'});
 const active=await database().prepare("SELECT id FROM jobs WHERE owner=? AND campaign_id=? AND status IN ('starting','queued','in_progress','uncertain') LIMIT 1").bind(owner,campaignId).first();
 if(active)return {sequence:previous};
 const failed=await database().prepare("SELECT id FROM jobs WHERE owner=? AND campaign_id=? AND status IN ('failed','cancelled','incomplete') AND updated_at>=? LIMIT 1").bind(owner,campaignId,previous.startedAt).first();
 if(failed)return save({...previous,status:'blocked',updatedAt:stamp(),error:'담당자 작업이 실패하거나 중단되어 연속 실행을 멈췄습니다. 결과를 확인한 뒤 다시 시작하세요.'});
 const artifacts=await listRecords<Artifact>(owner,'artifact',campaignId);
 const next=roles.find(role=>!artifacts.some(a=>a.role===role.id&&artifactUsable(a,campaign.version)));
 if(next&&artifacts.some(a=>a.role===next.id&&a.status!=='outdated'))return save({...previous,status:'blocked',updatedAt:stamp(),error:'작업물에 수정 요청 또는 불충분한 응답이 있습니다. 해당 담당자의 작업물을 보완한 뒤 다시 시작하세요.'});
 // 품질 판정이 사용자 검토 준비가 아니면 완료가 아니다. 지적 사항을 담당 역할과 함께 남긴다.
 const quality=artifacts.find(a=>a.role==='quality'&&artifactUsable(a,campaign.version)) as (Artifact&{qualityReview?:QualityReview})|undefined,review=quality?.qualityReview;
 if(!next&&quality&&review&&review.verdict!=='ready_for_review')return save({...previous,status:'needs_review',updatedAt:stamp(),error:'독립 품질 검수에서 수정 또는 자료 확인이 필요합니다. 수정 목록을 담당 역할별로 확인해 회의 안건이나 작업물 보완으로 이어가세요.',fixes:qualityFixes(review),source:{id:quality.id,version:quality.version}});
 if(!next)return save({...previous,status:'completed',updatedAt:stamp()});
 return {role:next.id,campaignId};
}
