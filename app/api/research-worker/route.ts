import {runGrowthDaily} from '@/lib/growth-daily-server';
import {runStorefrontPulls} from '@/lib/storefront-pull-server';
import {failure,json} from '@/lib/server';
import {workerIdentity,workerTick} from '@/lib/research-worker';
import {executeResearch} from '@/lib/research-execution';
import {collectDueMeasurements} from '@/lib/measurement-collection';
import {advanceBackgroundWork} from '@/lib/background-execution';
import {runDigestQueue} from '@/lib/quality-digest-queue-server';
import {advanceMetaExecutionWork} from '@/lib/meta-execution-server';
import {advanceMetaConversionWork} from '@/lib/meta-capi-server';
import {productResearchQueue} from '@/lib/product-research/server-collect';
// Dedicated machine principal: never accepts a browser identity as worker authority.
export async function POST(req:Request){try{const principal=await workerIdentity(req);return json(await workerTick(principal,executeResearch,collectDueMeasurements,advanceBackgroundWork,owner=>runDigestQueue(owner),advanceMetaExecutionWork,async owner=>{const r=await advanceMetaConversionWork(owner);return {status:r.processed?'processed':'idle'};},owner=>runGrowthDaily(owner),owner=>runStorefrontPulls(owner),await productResearchQueue(principal.owner)))}catch(e){return failure(e)}}
