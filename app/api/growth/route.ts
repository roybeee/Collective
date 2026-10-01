import type {Campaign} from '@/lib/agency';
import {GrowthCatalogError} from '@/lib/growth-catalog';
import {GrowthMarketError} from '@/lib/growth-market';
import {GrowthMissionError} from '@/lib/growth-mission';
import {growthView,saveGrowth} from '@/lib/growth-workspace-server';
import {growthSummary} from '@/lib/growth-summary-server';
import {readGrowthStop} from '@/lib/growth-stop-server';
import {ApiError,acquireLock,actor,body,failure,json,readRecord,releaseLock,requireAdminActor,secureMutation,str} from '@/lib/server';

// include=summary,stop(UX-PLAN-3 Q7): 성장·판매 탭이 요청 한 번으로 화면을 그리도록 패널 건수 요약(panelSummary)과 전역 중단 상태(stopState)를 함께 싣는다. 기존 summary 필드와 겹치지 않게 이름을 따로 쓴다. 없으면 이전과 같은 응답이다.
export async function GET(req:Request){try{const url=new URL(req.url),who=await actor(req),c=await readRecord<Campaign>(who.owner,'campaign',str(url.searchParams.get('campaignId'),'캠페인',100,true));const include=new Set((url.searchParams.get('include')||'').split(',').map(x=>x.trim()));const [view,summary,stop]=await Promise.all([growthView(who.owner,c,who.role!=='member'),include.has('summary')?growthSummary(who,c):undefined,include.has('stop')?readGrowthStop(who.owner):undefined]);return json(summary||stop?{...view,...(summary?{panelSummary:summary}:{}),...(stop?{stopState:{status:stop.status,reason:stop.reason}}:{})}:view)}catch(e){return failure(e)}}
export async function POST(req:Request){
 let owner='',lock='';
 try{const who=await requireAdminActor(req);secureMutation(req);const b=await body(req);owner=who.owner;lock=await acquireLock(owner);const c=await readRecord<Campaign>(owner,'campaign',str(b.campaignId,'캠페인',100,true));return json(await saveGrowth(who,c,b))}
 catch(e){return failure(e instanceof GrowthCatalogError||e instanceof GrowthMarketError||e instanceof GrowthMissionError?new ApiError(400,e.message):e)}
 finally{if(lock)await releaseLock(owner,lock)}
}
