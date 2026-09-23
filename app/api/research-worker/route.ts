import {failure,json} from '@/lib/server';
import {workerIdentity,workerTick} from '@/lib/research-worker';
import {executeResearch} from '@/lib/research-execution';
import {collectDueMeasurements} from '@/lib/measurement-collection';
import {advanceBackgroundWork} from '@/lib/background-execution';
// Dedicated machine principal: never accepts a browser identity as worker authority.
export async function POST(req:Request){try{return json(await workerTick(await workerIdentity(req),executeResearch,collectDueMeasurements,advanceBackgroundWork))}catch(e){return failure(e)}}
