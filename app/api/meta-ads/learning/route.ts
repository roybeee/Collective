import type {Campaign} from '@/lib/agency';
import {metaLearningView,recordMetaLearning,preregisterMetaLearning} from '@/lib/meta-learning-server';
import {MetaLearningInputError} from '@/lib/meta-learning';
import {ApiError,acquireLock,actor,body,failure,json,readRecord,releaseLock,requireAdminActor,secureMutation,str} from '@/lib/server';

export async function GET(req:Request){
 try{const who=await actor(req),c=await readRecord<Campaign>(who.owner,'campaign',str(new URL(req.url).searchParams.get('campaignId'),'캠페인',100,true));return json(await metaLearningView(who.owner,c,who.role!=='member',who.role==='owner'));}catch(e){return failure(e);}
}
export async function POST(req:Request){
 let owner='',lock='';
 try{const who=await requireAdminActor(req);secureMutation(req);const b=await body(req);if(b.action==='preregister'&&who.role!=='owner')throw new ApiError(403,'사전등록은 워크스페이스 소유자만 할 수 있습니다.');owner=who.owner;lock=await acquireLock(owner);const c=await readRecord<Campaign>(owner,'campaign',str(b.campaignId,'캠페인',100,true));const result=await (b.action==='preregister'?preregisterMetaLearning:recordMetaLearning)(owner,who.id,c,b);return json({...result,canPreregister:who.role==='owner'&&c.status!=='archived'});}catch(e){return failure(e instanceof MetaLearningInputError?new ApiError(400,e.message):e);}finally{if(lock)await releaseLock(owner,lock);}
}
