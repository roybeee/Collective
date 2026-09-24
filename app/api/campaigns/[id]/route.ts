import {campaignDetail,type CampaignSequence} from '@/lib/campaign-detail';
import {statusRecordsQuery,withDerivedStatus,type StatusMeeting,type StatusPublication} from '@/lib/campaign-status';
import {database,failure,identity,json,listRecords,str} from '@/lib/server';

export async function GET(req:Request,context:{params:Promise<{id:string}>}){
 try{
  const owner=await identity(req),{id}=await context.params,campaignId=str(id,'캠페인',100,true);
  const [detail,sequences,meetings,publications]=await Promise.all([
   campaignDetail(owner,campaignId),listRecords<CampaignSequence>(owner,'campaign_sequence',campaignId),
   database().prepare(statusRecordsQuery('team_meeting',true)).bind(owner,campaignId).all<StatusMeeting&{campaignId:string}>(),
   database().prepare(statusRecordsQuery('execution_publication',true)).bind(owner,campaignId).all<StatusPublication&{campaignId:string}>(),
  ]);
  // campaign.status는 저장값 그대로 두고 워크스페이스 응답과 같은 파생 상태(derivedStatus·statusReason)를 더한다.
  const [campaign]=withDerivedStatus([detail.campaign],{artifacts:detail.artifacts,runs:detail.runs,sequences,meetings:meetings.results,publications:publications.results,metrics:detail.metrics});
  return json({...detail,campaign});
 }catch(e){return failure(e)}
}
