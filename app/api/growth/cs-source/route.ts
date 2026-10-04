import type {Campaign} from '@/lib/agency';
import {after} from 'next/server';
import {csSourceView,pullCsSources} from '@/lib/growth-cs-source-server';
import {drainConsumerCancellations} from '@/lib/growth-consumer-delivery-drain';
import {ApiError,requireAdminActor,secureMutation,body,readRecord,str,json,failure,acquireLock,releaseLock} from '@/lib/server';
export async function GET(req:Request){try{const who=await requireAdminActor(req),c=await readRecord<Campaign>(who.owner,'campaign',str(new URL(req.url).searchParams.get('campaignId'),'캠페인',100,true));return json(await csSourceView(who,c))}catch(e){return failure(e)}}
export async function POST(req:Request){let owner='',lock='',recover=false;try{const who=await requireAdminActor(req);secureMutation(req);const b=await body(req);if(Object.keys(b).some(k=>!['campaignId','campaignVersion','requestId','cursor'].includes(k)))throw new ApiError(400,'지원하지 않는 접수 필드입니다.');owner=who.owner;lock=await acquireLock(owner);const c=await readRecord<Campaign>(owner,'campaign',str(b.campaignId,'캠페인',100,true)),result=await pullCsSources(who,c,b);recover=true;return json(result)}catch(e){return failure(e)}finally{if(lock)await releaseLock(owner,lock);if(recover)after(async()=>{try{await drainConsumerCancellations(owner)}catch{/* durable recovery queue retries */}})}}
