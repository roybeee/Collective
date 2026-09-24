import type {Campaign} from '@/lib/agency';
import {ApiError,acquireLock,actor,body,database,eventStatement,failure,identity,json,readRecord,recordStatement,releaseLock,secureMutation,str} from '@/lib/server';
import {attributionSnapshot,campaignAttribution} from '@/lib/campaign-attribution';

// 캠페인 성과 탭의 주문 장부 귀속 집계(lib/campaign-attribution.ts). 저장하지 않으므로 로그인한 모든 역할이 쓰기 잠금 없이 읽는다. 기간: from·to(기본 최근 8주, 최대 26주).
export async function GET(req:Request){try{const owner=await identity(req),p=new URL(req.url).searchParams,campaign=await readRecord<Campaign>(owner,'campaign',str(p.get('campaignId'),'캠페인',100,true));return json(await campaignAttribution(owner,campaign,{from:p.get('from')||undefined,to:p.get('to')||undefined}))}catch(e){return failure(e)}}
// action=snapshot: 확인한 집계를 schemaVersion 2 metric으로 저장한다. 권한과 순서는 기존 성과 입력(app/api/action/route.ts save_metric)과 같다:
// 로그인한 모든 역할, 같은 출처 요청(secureMutation), 워크스페이스 쓰기 잠금, metric과 캠페인 이벤트를 한 번에 저장.
export async function POST(req:Request){let owner='',lock='';try{
 const who=await actor(req);secureMutation(req);const b=await body(req);
 if(b.action!=='snapshot')throw new ApiError(400,'지원하지 않는 캠페인 귀속 작업입니다.');
 owner=who.owner;lock=await acquireLock(owner);
 const campaign=await readRecord<Campaign>(owner,'campaign',str(b.campaignId,'캠페인',100,true)),metric=await attributionSnapshot(owner,campaign,b);
 await database().batch([recordStatement(owner,'metric',metric.id,metric,campaign.id),eventStatement(owner,campaign.id,`${metric.period} 성과를 주문 장부 귀속 집계에서 스냅샷으로 저장했습니다.`,{id:who.id,email:who.email})]);
 return json({id:metric.id,metric});
}catch(e){return failure(e)}finally{if(lock)await releaseLock(owner,lock)}}
