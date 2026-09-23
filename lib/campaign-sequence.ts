import {roles, type Campaign, type Artifact} from './agency';
import {ApiError, database, readRecord, listRecords, recordStatement, stamp} from './server';

export type CampaignSequence={
 campaignId:string;campaignVersion:number;status:'running'|'paused'|'completed'|'blocked';
 startedAt:string;updatedAt:string;error?:string;
};

// Called under the same owner mutation lock as role execution.
export async function sequenceAction(owner:string,input:Record<string,unknown>):Promise<{sequence:CampaignSequence}|{role:string;campaignId:string}> {
 const campaignId=typeof input.campaignId==='string'?input.campaignId:'';
 const campaign=await readRecord<Campaign>(owner,'campaign',campaignId);
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
  await readRecord(owner,'worker_credential','current').catch(()=>{throw new ApiError(409,'서버 작업자를 먼저 연결하세요.');});
  if(previous?.status==='running')return {sequence:previous};
  return save({campaignId,campaignVersion:campaign.version,status:'running',startedAt:stamp(),updatedAt:stamp()});
 }
 if(!previous||previous.status!=='running')throw new ApiError(409,'사용자가 시작한 연속 실행이 없습니다.');
 if(campaign.version!==previous.campaignVersion)return save({...previous,status:'blocked',updatedAt:stamp(),error:'브리프가 변경되어 멈췄습니다. 새 기준을 확인한 뒤 다시 시작하세요.'});
 const active=await database().prepare("SELECT id FROM jobs WHERE owner=? AND campaign_id=? AND status IN ('starting','queued','in_progress','uncertain') LIMIT 1").bind(owner,campaignId).first();
 if(active)return {sequence:previous};
 const failed=await database().prepare("SELECT id FROM jobs WHERE owner=? AND campaign_id=? AND status IN ('failed','cancelled','incomplete') AND updated_at>=? LIMIT 1").bind(owner,campaignId,previous.startedAt).first();
 if(failed)return save({...previous,status:'blocked',updatedAt:stamp(),error:'담당자 작업이 실패하거나 중단되어 연속 실행을 멈췄습니다. 결과를 확인한 뒤 다시 시작하세요.'});
 const artifacts=await listRecords<Artifact>(owner,'artifact',campaignId);
 const next=roles.find(role=>!artifacts.some(a=>a.role===role.id&&a.status!=='outdated'));
 if(!next)return save({...previous,status:'completed',updatedAt:stamp()});
 return {role:next.id,campaignId};
}
