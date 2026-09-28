import type {Campaign} from '@/lib/agency';
import {metaLearningView,recordMetaLearning} from '@/lib/meta-learning-server';
import {MetaLearningInputError} from '@/lib/meta-learning';
import {ApiError,acquireLock,actor,body,failure,json,readRecord,releaseLock,requireAdminActor,secureMutation,str} from '@/lib/server';

export async function GET(req:Request){
 try{const who=await actor(req),c=await readRecord<Campaign>(who.owner,'campaign',str(new URL(req.url).searchParams.get('campaignId'),'캠페인',100,true));return json(await metaLearningView(who.owner,c,who.role!=='member'));}catch(e){return failure(e);}
}
export async function POST(req:Request){
 let owner='',lock='';
 try{const who=await requireAdminActor(req);secureMutation(req);const b=await body(req);owner=who.owner;lock=await acquireLock(owner);const c=await readRecord<Campaign>(owner,'campaign',str(b.campaignId,'캠페인',100,true));return json(await recordMetaLearning(owner,who.id,c,b));}catch(e){return failure(e instanceof MetaLearningInputError?new ApiError(400,e.message):e);}finally{if(lock)await releaseLock(owner,lock);}
}
