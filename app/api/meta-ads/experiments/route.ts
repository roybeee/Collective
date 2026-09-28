import type {Campaign} from '@/lib/agency';
import {ExperimentInputError} from '@/lib/meta-experiment';
import {metaExperimentView,mutateMetaExperiment} from '@/lib/meta-experiment-server';
import {executionRate} from '@/lib/execution-rate';
import {ApiError,acquireLock,actor,body,failure,json,readRecord,releaseLock,requireOwnerActor,secureMutation,str} from '@/lib/server';
export async function GET(req:Request){try{const who=await actor(req),c=await readRecord<Campaign>(who.owner,'campaign',str(new URL(req.url).searchParams.get('campaignId'),'캠페인',100,true));return json(await metaExperimentView(who.owner,c,who.role==='owner'));}catch(e){return failure(e);}}
export async function POST(req:Request){let owner='',lock='';try{const who=await requireOwnerActor(req);secureMutation(req);const b=await body(req);owner=who.owner;lock=await acquireLock(owner);await executionRate(owner,'meta-experiment');const c=await readRecord<Campaign>(owner,'campaign',str(b.campaignId,'캠페인',100,true)),result=await mutateMetaExperiment(owner,who.id,c,b);return json({...await metaExperimentView(owner,c,true),...result});}catch(e){return failure(e instanceof ExperimentInputError?new ApiError(400,e.message):e);}finally{if(lock)await releaseLock(owner,lock);}}
