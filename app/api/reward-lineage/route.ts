import {actor,acquireLock,ApiError,body,failure,json,releaseLock,secureMutation} from '@/lib/server';
import {executionRate} from '@/lib/execution-rate';
import {REWARD_LINEAGE_MESSAGES,rewardLineageAction,rewardLineageReport} from '@/lib/reward-lineage-server';

// 보상 계보(B4-2b·B4-2c, docs/REWARD-LINEAGE.ko.md). 보기는 대표·관리자(직원 403, 비로그인 401), 개선 루프 닫기는 대표만. 모델·커넥터 호출이 없다(토큰 0).
// GET ?from=&to=(한국 날짜, 기본 최근 28일, 최대 180일)&brandId=&storeId=&campaignId=: 범위 기록으로 계산한 collective.reward-lineage.v1과 partial.kinds, 개선 루프 대장(loops). 스위치 b4_reward_lineage 꺼짐 409.
// POST {action:'close',loopId,version,expected:{before,after},brandId|storeId|campaignId}: 루프 수치를 improvement_loop 행에 동결한다. 같은 출처 요청, 소유자 변경 잠금, 빈도 제한.
export async function GET(req:Request){
 try{
  const who=await actor(req);
  if(who.role==='member')throw new ApiError(403,REWARD_LINEAGE_MESSAGES.adminOnly);
  return json(await rewardLineageReport(who.owner,new URL(req.url).searchParams,who.role));
 }catch(error){return failure(error)}
}

export async function POST(req:Request){
 let owner='',lock='';
 try{
  const who=await actor(req);owner=who.owner;secureMutation(req);
  if(who.role!=='owner')throw new ApiError(403,REWARD_LINEAGE_MESSAGES.ownerOnly);
  const input=await body(req);
  lock=await acquireLock(owner);
  await executionRate(owner,'reward_lineage');
  return json(await rewardLineageAction(owner,input,{id:who.id,role:who.role}));
 }catch(error){return failure(error)}finally{if(lock)await releaseLock(owner,lock)}
}
