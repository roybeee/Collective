import type {Campaign} from '@/lib/agency';
import {providerCatalogView,saveProviderCatalog} from '@/lib/growth-provider-catalog-server';
import {actor,requireAdminActor,secureMutation,body,readRecord,str,json,failure,acquireLock,releaseLock} from '@/lib/server';
export async function GET(req:Request){try{const who=await actor(req),c=await readRecord<Campaign>(who.owner,'campaign',str(new URL(req.url).searchParams.get('campaignId'),'캠페인',100,true));return json(await providerCatalogView(who,c));}catch(e){return failure(e);}}
export async function POST(req:Request){let owner='',lock='';try{const who=await requireAdminActor(req);secureMutation(req);const b=await body(req);owner=who.owner;lock=await acquireLock(owner);const c=await readRecord<Campaign>(owner,'campaign',str(b.campaignId,'캠페인',100,true));return json(await saveProviderCatalog(who,c,b,{leaseToken:lock}));}catch(e){return failure(e);}finally{if(lock)await releaseLock(owner,lock);}}
