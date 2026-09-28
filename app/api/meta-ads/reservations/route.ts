import type {Campaign} from '@/lib/agency';
import {metaReservationView,reserveMetaBudget,releaseMetaBudget} from '@/lib/meta-reservation-server';
import {ApiError,acquireLock,actor,body,failure,json,readRecord,releaseLock,requireOwnerActor,secureMutation,str} from '@/lib/server';
export async function GET(req:Request){try{const who=await actor(req),c=await readRecord<Campaign>(who.owner,'campaign',str(new URL(req.url).searchParams.get('campaignId'),'캠페인',100,true));return json(await metaReservationView(who.owner,c,who.role==='owner'));}catch(e){return failure(e);}}
export async function POST(req:Request){
 let owner='',lock='';
 try{const who=await requireOwnerActor(req);secureMutation(req);const b=await body(req);if(!['reserve','release'].includes(String(b.action))||b.confirmed!==true)throw new ApiError(400,'로컬 예약 또는 해제 내용을 확인하세요.');owner=who.owner;lock=await acquireLock(owner);const c=await readRecord<Campaign>(owner,'campaign',str(b.campaignId,'캠페인',100,true));return json(await (b.action==='reserve'?reserveMetaBudget:releaseMetaBudget)(owner,who.id,c,b));}catch(e){return failure(e);}finally{if(lock)await releaseLock(owner,lock);}
}
