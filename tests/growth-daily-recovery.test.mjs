import assert from 'node:assert/strict';
import {moduleRuntime} from '../scripts/eval/runtime.mjs';
import {testRuntime} from './helpers/runtime.mjs';
let failedCampaign='',checkpointFailure=false,revokeOwner='';
const {load,sql}=testRuntime(async()=>{throw Error('external forbidden')},{beforeRun(s){
 if(s.query.startsWith('INSERT INTO records')&&s.query.includes("'growth_daily_run'")&&revokeOwner===s.values[1]){sql.prepare('UPDATE mutation_locks SET expires_at=0 WHERE owner=?').run(revokeOwner+':growth-daily');revokeOwner=''}
 if(s.query.startsWith('INSERT INTO records')&&s.query.includes("'growth_daily_run'")&&checkpointFailure){checkpointFailure=false;throw Error('checkpoint unavailable')}
 if(s.query.startsWith('INSERT INTO records')&&s.values[2]==='growth_detected_signal'&&JSON.parse(s.values[4]).campaignId===failedCampaign)throw Error('campaign unavailable');
}});
const server=await load('lib/server.ts'),daily=await load('lib/growth-daily-server.ts'),flags=await load('lib/feature-flags.ts');
let passed=0;const check=(v,n)=>{assert.ok(v,n);passed++},now=Date.parse(new Date(Date.now()+9*3600000).toISOString().slice(0,10)+'T00:00:00+09:00'),D=86400000;
const row=(owner,t=now)=>JSON.parse(sql.prepare('SELECT data FROM records WHERE id=?').get(`${owner}:growth_daily_run:${daily.kstDay(t)}`).data);
async function seed(owner,n){await flags.setFeatureFlag(owner,{flag:'growth_daily_loop',enabled:true},{id:owner,email:null});for(let i=0;i<n;i++){const id=`c${String(i).padStart(2,'0')}`;await server.recordStatement(owner,'campaign',id,{id,brandId:'b',storeId:'s',version:1,status:'active',title:id}).run()}await server.recordStatement(owner,'store','s',{id:'s',brandId:'b'},'b').run()}
await seed('many',23);
await daily.runGrowthDaily('many','worker',now);
check(row('many').status==='partial'&&row('many').skipped===3,'first chunk reports unvisited campaigns');
await daily.runGrowthDaily('many','worker',now+1);
check(row('many').status==='completed'&&row('many').campaigns.length===23,'same-day continuation reaches every campaign beyond first 20');
check(row('many').campaigns.every(c=>c.attempts===1),'successful campaigns are not repeated by continuation');
check((await daily.runGrowthDaily('many','operator',now+2)).reason==='completed','completed day remains idempotent');
await seed('nextday',23);await daily.runGrowthDaily('nextday','worker',now);await daily.runGrowthDaily('nextday','worker',now+D);
check(['c20','c21','c22'].every(id=>row('nextday',now+D).campaigns.some(c=>c.campaignId===id)),'previous-day unvisited campaigns get priority after day rollover');
await seed('fair',23);
await server.recordStatement('fair','growth_daily_run',daily.kstDay(now),{id:daily.kstDay(now),day:daily.kstDay(now),status:'partial',pendingIds:['c20','c21','c22'],campaigns:Array.from({length:20},(_,i)=>({campaignId:`c${String(i).padStart(2,'0')}`,title:'failed',detection:null,agenda:[],error:'unavailable'}))}).run();
await daily.runGrowthDaily('fair','worker',now+D);
check(['c20','c21','c22'].every(id=>row('fair',now+D).campaigns.some(c=>c.campaignId===id)),'unvisited campaigns take priority over yesterday persistent failures');
await seed('fortyone',41);const visited=new Set();
for(let offset=0;offset<3;offset++){await daily.runGrowthDaily('fortyone','worker',now+offset*D);for(const entry of row('fortyone',now+offset*D).campaigns)visited.add(entry.campaignId)}
check(visited.size===41,'41 campaigns with one tick daily all receive service within three days');
await seed('failure',2);
const costs={foodCost:0,packagingCost:0,fees:0,deliveryCost:0,benefitCost:0};
for(let i=0;i<35;i++)await server.recordStatement('failure','store_order',String(i),{id:String(i),storeId:'s',campaignId:'c00',orderDate:new Date(now-(i<14?i%7:7+i-14)*D).toISOString().slice(0,10),status:'paid',paidAmount:1,refundAmount:0,costs},'s').run();
failedCampaign='c00';await daily.runGrowthDaily('failure','worker',now);
check(row('failure').status==='partial'&&row('failure').campaigns.find(c=>c.campaignId==='c00').error,'campaign error is recorded independently');
check((await daily.runGrowthDaily('failure','operator',now+1)).reason==='retry_wait','manual retry observes failure backoff');
let retryTime=now;
for(let i=0;i<4;i++){const error=row('failure').campaigns.find(c=>c.campaignId==='c00');retryTime=Date.parse(error.retryAt);await daily.runGrowthDaily('failure','worker',retryTime);check(Date.parse(row('failure',retryTime).campaigns.find(c=>c.campaignId==='c00').retryAt)-retryTime<=daily.DAILY_MAX_RETRY_MS,'error backoff remains bounded at six hours')}
failedCampaign='';retryTime=Date.parse(row('failure',retryTime).campaigns.find(c=>c.campaignId==='c00').retryAt);await daily.runGrowthDaily('failure','worker',retryTime);
check(row('failure').status==='completed','failed campaign recovers after backoff');
check(row('failure').campaigns.find(c=>c.campaignId==='c01').attempts===1&&row('failure').campaigns.find(c=>c.campaignId==='c00').attempts===6,'retry reprocesses only failed campaign');
await seed('concurrent',2);const results=await Promise.all([daily.runGrowthDaily('concurrent','worker',now),daily.runGrowthDaily('concurrent','operator',now)]);
check(results.filter(r=>r.status==='processed').length===1&&results.some(r=>r.reason==='busy'),'worker and manual runs share one owner lease');
check(sql.prepare("SELECT COUNT(*) n FROM mutation_locks WHERE owner='concurrent:growth-daily'").get().n===0,'lease is released after run');
await seed('checkpoint',2);checkpointFailure=true;await daily.runGrowthDaily('checkpoint','worker',now);
check(row('checkpoint').status==='failed'&&row('checkpoint').campaigns.length===1,'overall checkpoint failure preserves completed in-memory progress');
await daily.runGrowthDaily('checkpoint','worker',now+daily.DAILY_RETRY_MS);
check(row('checkpoint').status==='completed'&&row('checkpoint').campaigns[0].attempts===1,'checkpoint retry resumes remaining work without repeating saved success');
check(sql.prepare("SELECT COUNT(*) n FROM records WHERE kind IN ('execution_publication','growth_action_intent','meta_ads_execution','prompt_release')").get().n===0,'recovery never executes external actions');
await seed('expired',1);revokeOwner='expired';
await assert.rejects(()=>daily.runGrowthDaily('expired','worker',now),/잠금이 만료/);passed++;
check(sql.prepare("SELECT COUNT(*) n FROM records WHERE owner='expired' AND kind='growth_daily_run'").get().n===0,'expired lease cannot publish stale progress');
await seed('route',1);const route=await load('app/api/growth/daily/route.ts');
const response=await route.POST(new Request('https://agency.test/api/growth/daily',{method:'POST',headers:{'oai-authenticated-user-id':'route',origin:'https://agency.test','content-type':'application/json'},body:JSON.stringify({action:'run_now'})}));
check(response.status===200&&(await response.json()).status==='processed','manual API does not reacquire the shared lease');
let wall=now,advance=true;
class Clock extends Date{constructor(...args){super(...(args.length?args:[wall]))}static now(){return wall}}
const timed=moduleRuntime(async()=>{throw Error('external forbidden')},{beforeRun(s){if(advance&&s.query.startsWith('INSERT INTO records')&&s.query.includes("'growth_daily_run'")){wall+=daily.DAILY_TIME_BUDGET_MS;advance=false}}},{Date:Clock});
const timedServer=await timed.load('lib/server.ts'),timedDaily=await timed.load('lib/growth-daily-server.ts');
for(const id of ['a','b'])await timedServer.recordStatement('timed','campaign',id,{id,brandId:'b',storeId:'s',version:1,status:'active',title:id}).run();
await timedServer.recordStatement('timed','store','s',{id:'s',brandId:'b'},'b').run();
const bounded=await timedDaily.runGrowthDaily('timed','operator',now);
check(bounded.campaigns===1&&bounded.skipped===1,'time budget stops before starting the next campaign');
const continued=await timedDaily.runGrowthDaily('timed','operator',wall);
check(continued.campaigns===1&&continued.runStatus==='completed','time-budget continuation processes only the remaining campaign');
console.log(JSON.stringify({passed}));
