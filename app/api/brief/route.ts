import {identity,secureMutation,body,failure} from '@/lib/server';
import {executeBrief} from '@/lib/brief-execution';
import {assertCampaignNotArchived} from '@/lib/campaign-archive';
import {requireCampaignAction,requireExistingRecordAction,requireInputAction,requireRecordAction} from '@/lib/server-access';

export async function POST(req:Request){
 try{
  const owner=await identity(req);
  secureMutation(req);
  const b=await body(req);
  // 범위 가드: 초안 작성은 AI 실행(run_ai). 시작은 캠페인(있으면) 또는 입력 브랜드·지점과 같은 id의 기존 초안, 불러오기는 읽기, 진행·복구·중지는 저장된 초안의 범위로 본다.
  const data=(b.data&&typeof b.data==='object'&&!Array.isArray(b.data)?b.data:{}) as Record<string,unknown>;
  if(b.action==='start'){await (b.campaignId?requireCampaignAction(req,'run_ai',b.campaignId):requireInputAction(req,'run_ai',{storeId:data.storeId,brandId:data.brandId}));await requireExistingRecordAction(req,'run_ai','brief_draft',b.id)}
  else await requireRecordAction(req,b.action==='load'?'read_campaign':'run_ai','brief_draft',b.id);
  // 보관 캠페인의 브리프를 HERMES로 다시 쓰는 초안 작성은 시작하지 않는다(409). 새 캠페인 초안(campaignId 없음)은 그대로다. 잠금 밖 빠른 거절이다. 보관과 경합해 통과한 시작은 lib/brief-execution.ts start(campaignId)가 소유자 잠금 안에서 다시 검사해 409로 막는다(PR 4a-2).
  if(b.action==='start'&&b.campaignId)await assertCampaignNotArchived(owner,b.campaignId);
  return await executeBrief(owner,b);
 }catch(error){return failure(error)}
}
