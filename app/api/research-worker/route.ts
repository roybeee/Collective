import {failure,json} from '@/lib/server';
import {workerIdentity,workerTick} from '@/lib/research-worker';
import {executeResearch} from '@/lib/research-execution';
// Dedicated machine principal: never accepts a browser identity as worker authority.
export async function POST(req:Request){try{return json(await workerTick(await workerIdentity(req),executeResearch))}catch(e){return failure(e)}}
