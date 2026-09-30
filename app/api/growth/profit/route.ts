import type {Campaign} from '@/lib/agency';
import {growthProfitView} from '@/lib/growth-profit-server';
import {actor,readRecord,str,json,failure} from '@/lib/server';
export async function GET(req:Request){try{const who=await actor(req),q=new URL(req.url).searchParams,c=await readRecord<Campaign>(who.owner,'campaign',str(q.get('campaignId'),'캠페인',100,true));return json(await growthProfitView(who,c,{from:q.get('from'),to:q.get('to')}))}catch(e){return failure(e)}}
