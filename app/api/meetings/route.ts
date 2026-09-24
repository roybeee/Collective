import {actor,secureMutation,body,failure} from '@/lib/server';
import {executeMeeting} from '@/lib/meeting-execution';
import {assertCampaignNotArchived,assertMeetingCampaignNotArchived} from '@/lib/campaign-archive';
export {GET} from '@/lib/meeting-execution';

export async function POST(req:Request){
 try{
  const who=await actor(req);
  secureMutation(req);
  const b=await body(req);
  // 보관 캠페인에는 새 팀 회의·실패 회의 재시도를 시작하지 않는다(409). 잠금 밖 빠른 거절이다. 보관과 경합해 통과한 요청은 lib/meeting-execution.ts start·retry_failed가 소유자 잠금 안에서 다시 검사해 409로 막는다(PR 4a-2).
  if(b.action==='start')await assertCampaignNotArchived(who.owner,b.campaignId);
  if(b.action==='retry_failed')await assertMeetingCampaignNotArchived(who.owner,b.id);
  return await executeMeeting(who.owner,b,{id:who.id,email:who.email});
 }catch(error){return failure(error)}
}
