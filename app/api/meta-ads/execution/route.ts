import type {Campaign} from '@/lib/agency';
import {actMetaExecution,viewMetaExecution} from '@/lib/meta-execution-server';
import {MetaExecutionError} from '@/lib/meta-execution-provider';
import {ApiError,actor,requireOwnerActor,secureMutation,body,readRecord,str,acquireLock,releaseLock,json,failure} from '@/lib/server';
import {assertAutonomy} from '@/lib/autonomy-server';
export async function GET(req:Request){try{const who=await actor(req),c=await readRecord<Campaign>(who.owner,'campaign',str(new URL(req.url).searchParams.get('campaignId'),'캠페인',100,true));return json(await viewMetaExecution(who.owner,c,who.role==='owner'))}catch(e){return failure(e)}}
export async function POST(req:Request){let owner='',lock='';try{const who=await requireOwnerActor(req);secureMutation(req);const b=await body(req);if(Object.keys(b).some(k=>!['action','campaignId','campaignVersion','id','expectedVersion','reservationId','reservationVersion','expectedScopeDigest','maxSpend','expiresAt','emergencyStopMandate','confirmed','settledSpend','billingFinalConfirmed'].includes(k))||!['approve','activate','stop','settle'].includes(String(b.action)))throw new ApiError(400,'지원하지 않는 실행 요청입니다.');owner=who.owner;
 // G3 자율성 규칙: 광고 활성화는 T3라 자동이 없고, 금지(never)면 잠금 전에 403으로 막는다(확인 후·꺼짐은 그대로).
 if(b.action==='activate')await assertAutonomy(owner,'ad_activate');
 lock=await acquireLock(owner);const c=await readRecord<Campaign>(owner,'campaign',str(b.campaignId,'캠페인',100,true));await actMetaExecution(owner,who.id,c,b);return json(await viewMetaExecution(owner,c,true))}catch(e){return failure(e instanceof MetaExecutionError?new ApiError(e.code==='unknown'?502:409,e.message):e)}finally{if(lock)await releaseLock(owner,lock)}}
