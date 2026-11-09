import {ApiError,actor,secureMutation,body,json,failure,acquireLock,releaseLock} from '@/lib/server';
import {collectForExperiment} from '@/lib/measurement-collection';
import {computeCampaignIncrementality,readIncrementality} from '@/lib/incrementality-server';
import {requireCampaignRead} from '@/lib/server-access';
// 수집 결과는 초안으로만 저장된다. 비교 가능성 확정과 결과 반영은 사용자가 한다.
// 수집은 관리자가 연결한 채널 자격증명으로 외부 API를 부르고 워커가 6시간마다 반복할 대상을 등록하므로 대표·관리자만 한다(직원 403, loop-1).
// incrementality(C7, 추가): 캠페인 기간·대상·대조 매장으로 장부 증분을 계산해 캠페인당 1행으로 저장한다(외부 호출 없음). GET ?campaignId=는 저장된 결과를 돌려준다.
export async function GET(req:Request){try{const who=await actor(req),campaignId=new URL(req.url).searchParams.get('campaignId');await requireCampaignRead(req,campaignId);return json({incrementality:await readIncrementality(who.owner,campaignId)})}catch(e){return failure(e)}}
export async function POST(req:Request){let owner='',lock='';try{
 const who=await actor(req);owner=who.owner;secureMutation(req);if(who.role==='member')throw new ApiError(403,'성과 수집은 대표·관리자만 시작할 수 있습니다.');const b=await body(req);lock=await acquireLock(owner);
 if(b.action==='incrementality')return json({recorded:true,incrementality:await computeCampaignIncrementality(who,b)});
 if(b.action!=='collect')throw new ApiError(400,'지원하지 않는 측정 작업입니다.');
 return json(await collectForExperiment(owner,b));
}catch(e){return failure(e)}finally{if(lock)await releaseLock(owner,lock)}}
