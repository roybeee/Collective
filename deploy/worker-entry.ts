// Cloudflare Workers 직접 배포 전용 Worker 진입점(DEPLOY_TARGET=workers, docs/INFRA-WORKERS.ko.md). Sites 빌드는 이 파일을 쓰지 않는다.
// fetch: vinext 기본 핸들러에 넘기기 전에 요청 경계를 지킨다(deploy/workers-runtime.mjs guardRequest).
// scheduled: INTERNAL_CRON=1일 때만, /api/research-worker tick이 쓰는 같은 큐 함수를 같은 인자로 부른다(app/api/research-worker/route.ts와 같은 연결).
import handler from 'vinext/server/fetch-handler';
import {acquireLock,releaseLock} from '@/lib/server';
import {runDigestQueue} from '@/lib/quality-digest-queue-server';
import {runGrowthDaily} from '@/lib/growth-daily-server';
import {runStorefrontPulls} from '@/lib/storefront-pull-server';
import {runPosPulls} from '@/lib/pos/server';
import {collectDueMeasurements} from '@/lib/measurement-collection';
import {scheduledRunsQueue} from '@/lib/scheduled-runs-server';
import {ACTIVE_OWNERS_SQL,cronEnabled,guardRequest,runInternalCron} from './workers-runtime.mjs';

type WorkerEnv={DB?:D1Database;AUTH_MODE?:string;INTERNAL_CRON?:string};
type Queue=(owner:string)=>Promise<{status:string}>;

async function queuesFor(owner:string):Promise<Record<string,Queue|undefined>>{
 return {
  scheduled_runs:await scheduledRunsQueue(owner),
  digest:current=>runDigestQueue(current),
  storefront_pull:current=>runStorefrontPulls(current),
  pos_pull:current=>runPosPulls(current),
  measurement:collectDueMeasurements,
  growth_daily:current=>runGrowthDaily(current),
 };
}

async function activeOwners(db:D1Database):Promise<string[]>{
 const rows=await db.prepare(ACTIVE_OWNERS_SQL).all<{owner:string}>();
 return (rows.results??[]).map(row=>row.owner).filter(owner=>typeof owner==='string'&&owner.length>0&&owner.length<=200);
}

async function scheduledTick(env:WorkerEnv){
 if(!cronEnabled(env)||env.AUTH_MODE!=='email'||!env.DB)return;
 const results=await runInternalCron({
  owners:await activeOwners(env.DB),queuesFor,acquire:acquireLock,release:releaseLock,
  onError:(queue,error)=>console.error('internal_cron_failed',queue,error instanceof Error?error.name:'unknown'),
 });
 console.info('internal_cron',JSON.stringify(results.map(r=>({status:r.status,queues:r.queues?.filter(q=>q.status!=='idle')}))));
}

const worker={
 fetch(request:Request,env:WorkerEnv,ctx:ExecutionContext){
  const guarded=guardRequest(request,env);
  return 'response' in guarded?guarded.response:handler.fetch(guarded.request,env,ctx);
 },
 scheduled(_controller:ScheduledController,env:WorkerEnv,ctx:ExecutionContext){
  ctx.waitUntil(scheduledTick(env));
 },
} satisfies ExportedHandler<WorkerEnv>;

export default worker;
