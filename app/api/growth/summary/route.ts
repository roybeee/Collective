import type {Campaign} from '@/lib/agency';
import {growthSummary} from '@/lib/growth-summary-server';
import {actor,readRecord,str,json,failure} from '@/lib/server';
// 성장·판매 탭 요약(건수 배지·확인 필요 표시). 읽기 전용이며 모든 역할이 읽는다(성장 조회와 같은 권한).
export async function GET(req:Request){try{const who=await actor(req),c=await readRecord<Campaign>(who.owner,'campaign',str(new URL(req.url).searchParams.get('campaignId'),'캠페인',100,true));return json(await growthSummary(who,c))}catch(e){return failure(e)}}
