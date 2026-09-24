import {identity,secureMutation,body,failure} from '@/lib/server';
import {executeBrief} from '@/lib/brief-execution';
import {assertCampaignNotArchived} from '@/lib/campaign-archive';

export async function POST(req:Request){
 try{
  const owner=await identity(req);
  secureMutation(req);
  const b=await body(req);
  // 보관 캠페인의 브리프를 HERMES로 다시 쓰는 초안 작성은 시작하지 않는다(409). 새 캠페인 초안(campaignId 없음)은 그대로다. 잠금 밖 사전 검사다.
  if(b.action==='start'&&b.campaignId)await assertCampaignNotArchived(owner,b.campaignId);
  return await executeBrief(owner,b);
 }catch(error){return failure(error)}
}
