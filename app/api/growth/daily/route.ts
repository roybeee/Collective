import type {Campaign} from '@/lib/agency';
import {growthDailyView,runGrowthDaily} from '@/lib/growth-daily-server';
import {ApiError,requireAdminActor,secureMutation,body,readRecord,str,json,failure} from '@/lib/server';
export async function GET(req:Request){try{const who=await requireAdminActor(req),c=await readRecord<Campaign>(who.owner,'campaign',str(new URL(req.url).searchParams.get('campaignId'),'캠페인',100,true));return json(await growthDailyView(who,c))}catch(e){return failure(e)}}
export async function POST(req:Request){try{const who=await requireAdminActor(req);secureMutation(req);const b=await body(req);if(b.action!=='run_now')throw new ApiError(400,'지원하지 않는 일일 루프 작업입니다.');const result=await runGrowthDaily(who.owner,'operator');return json({recorded:result.status==='processed',...result,mayExecute:false})}catch(e){return failure(e)}}
