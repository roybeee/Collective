import {actor,secureMutation,body,failure} from '@/lib/server';
import {executeRole} from '@/lib/role-execution';
import {assertCampaignNotArchived} from '@/lib/campaign-archive';

export async function POST(req:Request){
 try{
  const who=await actor(req);
  secureMutation(req);
  const b=await body(req);
  // 보관 캠페인에는 새 역할 실행을 시작하지 않는다(409). 연속 실행 시작·진행은 lib/campaign-sequence.ts가 잠금 안에서 막는다.
  // 역할 start 검사는 잠금 밖 빠른 거절이다. 보관과 경합해 통과한 시작은 lib/role-execution.ts start가 소유자 잠금 안에서 캠페인을 읽은 직후 다시 검사해 409로 막는다(PR 4a-2).
  if(b.action==='start')await assertCampaignNotArchived(who.owner,b.campaignId);
  return await executeRole(who.owner,b,{id:who.id,email:who.email});
 }catch(error){return failure(error)}
}
