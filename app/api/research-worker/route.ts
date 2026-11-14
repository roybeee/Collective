import {runProviderCatalogWorker} from '@/lib/growth-provider-catalog-worker';
import {advanceConsumerDeliveryWork} from '@/lib/growth-consumer-execution-worker';
import {drainConsumerCancellations} from '@/lib/growth-consumer-delivery-drain';
import {runGrowthDaily} from '@/lib/growth-daily-server';
import {runStorefrontPulls} from '@/lib/storefront-pull-server';
import {runPosPulls} from '@/lib/pos/server';
import {failure,json} from '@/lib/server';
import {workerIdentity,workerTick} from '@/lib/research-worker';
import {executeResearch} from '@/lib/research-execution';
import {collectDueMeasurements} from '@/lib/measurement-collection';
import {advanceBackgroundWork} from '@/lib/background-execution';
import {runDigestQueue} from '@/lib/quality-digest-queue-server';
import {advanceMetaExecutionWork} from '@/lib/meta-execution-server';
import {advanceMetaConversionWork} from '@/lib/meta-capi-server';
import {productResearchMaintenanceQueue as productResearchQueue} from '@/lib/product-research/server-maintenance';
import {scheduledRunsQueue} from '@/lib/scheduled-runs-server';
import {daangnConversionQueue} from '@/lib/daangn-conversions-server';
import {adsProposalAutoQueue} from '@/lib/ads-proposals-auto-server';
// Dedicated machine principal: never accepts a browser identity as worker authority.
export async function POST(req:Request){try{const principal=await workerIdentity(req);return json(await workerTick(principal,executeResearch,collectDueMeasurements,advanceBackgroundWork,owner=>runDigestQueue(owner),advanceMetaExecutionWork,async owner=>{const r=await advanceMetaConversionWork(owner);return {status:r.processed?'processed':'idle'};},owner=>runGrowthDaily(owner),owner=>runStorefrontPulls(owner),await productResearchQueue(principal.owner),async owner=>{const r=await drainConsumerCancellations(owner,1);return r.attempted?{status:'processed'}:advanceConsumerDeliveryWork(owner);},owner=>runProviderCatalogWorker(owner),owner=>runPosPulls(owner),await scheduledRunsQueue(principal.owner),await daangnConversionQueue(principal.owner),await adsProposalAutoQueue(principal.owner)))}catch(e){return failure(e)}}
