import {actor,secureMutation,body,failure} from '@/lib/server';
import {executeMeeting} from '@/lib/meeting-execution';
import {assertCampaignNotArchived,assertMeetingCampaignNotArchived} from '@/lib/campaign-archive';
export {GET} from '@/lib/meeting-execution';

export async function POST(req:Request){
 try{
  const who=await actor(req);
  secureMutation(req);
  const b=await body(req);
  // 보관 캠페인에는 새 팀 회의·실패 회의 재시도를 시작하지 않는다(409). 잠금 밖 사전 검사라 보관과 동시에 들어온 시작 1건은 통과할 수 있다.
  if(b.action==='start')await assertCampaignNotArchived(who.owner,b.campaignId);
  if(b.action==='retry_failed')await assertMeetingCampaignNotArchived(who.owner,b.id);
  return await executeMeeting(who.owner,b,{id:who.id,email:who.email});
 }catch(error){return failure(error)}
}
