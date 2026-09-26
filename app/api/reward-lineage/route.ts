import {actor,ApiError,failure,json} from '@/lib/server';
import {REWARD_LINEAGE_MESSAGES,rewardLineageReport} from '@/lib/reward-lineage-server';

// 보상 계보(B4-2b, docs/REWARD-LINEAGE.ko.md). 대표·관리자만(직원 403, 비로그인 401). 읽기 전용이고 저장·모델·커넥터 호출이 없다(토큰 0).
// GET ?from=&to=(한국 날짜, 기본 최근 28일, 최대 180일)&brandId=&storeId=&campaignId=: 범위 기록으로 계산한 collective.reward-lineage.v1과 partial.kinds. 스위치 b4_reward_lineage 꺼짐 409.
export async function GET(req:Request){
 try{
  const who=await actor(req);
  if(who.role==='member')throw new ApiError(403,REWARD_LINEAGE_MESSAGES.adminOnly);
  return json(await rewardLineageReport(who.owner,new URL(req.url).searchParams,who.role));
 }catch(error){return failure(error)}
}
