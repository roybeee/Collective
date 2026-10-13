import assert from 'node:assert/strict';
import { mkdtemp, writeFile, chmod, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { preparePhotoAsset } from '../scripts/lib/store-browser-photo.mjs';
import { createHash } from 'node:crypto';
import { canonicalSchedule, validateConfig } from '../scripts/lib/store-browser-config.mjs';
import { main, runJob } from '../scripts/store-browser-worker.mjs';
import { acquireSingleton, classifyWorkerError, readPrivateEnv, watchLoop } from '../scripts/lib/store-browser-service.mjs';
let passed=0;
const days=['mon','tue','wed','thu','fri','sat','sun'];
const schedule=Object.fromEntries(days.map(d=>[d,{state:'open',intervals:[{start:'09:00',end:'18:00',endsNextDay:false}]}]));
assert.equal(JSON.parse(canonicalSchedule(schedule)).mon.intervals[0].start,'09:00');passed++;
assert.throws(()=>canonicalSchedule({...schedule,mon:{state:'open',intervals:[{start:'19:00',end:'01:00',endsNextDay:false}]}}));passed++;
const binding={managerUrl:'https://new.smartplace.naver.com/a',managerBusinessId:'1',naverPlaceId:'2',storeName:'Store'};
const evidence={...binding,hours:canonicalSchedule(schedule),schedule,source:'mocked',capturedAt:new Date().toISOString()};
const after={...schedule,mon:{state:'open',intervals:[{start:'19:00',end:'01:00',endsNextDay:true}]}};
const claim={job:{id:'j',type:'change_hours',beforeHours:evidence.hours,afterHours:canonicalSchedule(after),beforeSchedule:schedule,afterSchedule:after},binding,executionMode:'write'};
let saves=0;const events=[];
const adapter={observe:async()=>({...evidence,schedule:{...schedule,tue:{state:'closed',intervals:[]}}}),saveHours:async()=>{saves++;},verify:async()=>({...evidence,schedule:after,hours:claim.job.afterHours})};
assert.equal((await runJob(claim,adapter,async action=>{events.push(action);return{permitSubmit:true};})).state,'handoff');assert.equal(saves,0);passed++;
assert.equal(classifyWorkerError({status:409,code:'NO_JOB'}),'idle');assert.equal(classifyWorkerError({status:409,code:'VERSION_CONFLICT'}),'fault');assert.equal(classifyWorkerError({status:401}),'stop');passed++;


const locators=Object.fromEntries(['managerBusinessId','naverPlaceId','storeName','save'].map(k=>[k,{css:`#${k}`} ]));
const config={version:2,host:'local',account:'u0',locators,weekly:Object.fromEntries(days.map(d=>[d,{state:{css:`#${d}-state`},values:{open:'o',closed:'c',unknown:'u'},intervals:[{start:{css:`#${d}-start`},end:{css:`#${d}-end`},endsNextDay:{css:`#${d}-next`}}]}]))};
validateConfig(config);assert.throws(()=>validateConfig({...config,weekly:{...config.weekly,sun:undefined}}));passed++;
const temp=await mkdtemp(join(tmpdir(),'browser-service-test-'));
try {
 const path=join(temp,'singleton');const release=await acquireSingleton(path);
 await assert.rejects(promisify(execFile)(process.execPath,['--input-type=module','-e',`import {acquireSingleton} from ${JSON.stringify(new URL('../scripts/lib/store-browser-service.mjs',import.meta.url).href)};await acquireSingleton(process.argv[1]);`,path]),error=>error.stderr.includes('worker already running'));await release();const again=await acquireSingleton(path);await again();passed++;
 const envPath=join(temp,'env.json');await writeFile(envPath,JSON.stringify({STORE_BROWSER_API_ORIGIN:'https://app.test',STORE_BROWSER_WORKER_TOKEN:'not-real-fixture'}),{mode:0o600});assert.equal((await readPrivateEnv(envPath)).STORE_BROWSER_API_ORIGIN,'https://app.test');await chmod(envPath,0o644);await assert.rejects(readPrivateEnv(envPath),/private/);passed++;
}finally{await rm(temp,{recursive:true,force:true});}
let ticks=0;const health=[];
await watchLoop(async()=>{ticks++;if(ticks===1)throw {status:409,code:'NO_JOB'};if(ticks===2)throw {status:409,code:'DEVICE_BUSY'};return {state:'verified'};},{maxTicks:3,sleep:async()=>{},onHealth:x=>health.push(x.state)});assert.deepEqual(health,['idle','fault','verified']);passed++;
ticks=0;await assert.rejects(watchLoop(async()=>{ticks++;throw {status:401};},{sleep:async()=>{}}),/revoked/);assert.equal(ticks,1);passed++;
ticks=0;await assert.rejects(watchLoop(async()=>{ticks++;throw {status:503};},{sleep:async()=>{}}),/retry limit/);assert.equal(ticks,8);passed++;
const png=Buffer.from([137,80,78,71,13,10,26,10]);const sha=createHash('sha256').update(png).digest('hex');
const photo={sourceId:'asset',sourceVersion:1,rightsId:'rights',rightsVersion:1,mime:'image/png',size:png.length,sha256:sha};const photoClaim={...claim,job:{id:'p',type:'upload_photo',photo},attemptId:'a',leaseToken:'lease'};
await assert.rejects(preparePhotoAsset('https://app.test','fixture',{...photoClaim,job:{...photoClaim.job,photo:{...photo,rightsVersion:0}}},async()=>{throw Error('must not fetch');}),/metadata/);passed++;
await assert.rejects(preparePhotoAsset('https://app.test','fixture',{...photoClaim,job:{...photoClaim.job,photo:{...photo,sha256:'0'.repeat(64)}}},async()=>new Response(png,{headers:{'Content-Type':'image/png'}})),/hash/);passed++;
let photoWrites=0;const photoEvents=[];const photoAdapter={observe:async()=>evidence,prepare:async()=>{},preparePhotoAsset:async()=>({dispose:async()=>{}}),uploadPhoto:async()=>{photoWrites++;},verifyPhoto:async()=>({...evidence,photoId:'',photoSha256:sha})};
assert.equal((await runJob(photoClaim,photoAdapter,async action=>{photoEvents.push(action);return{permitSubmit:true};})).state,'unknown');assert.equal(photoWrites,1);assert.ok(photoEvents.includes('unknown'));passed++;
assert.equal((await runJob({...photoClaim,executionMode:'reconcile'},photoAdapter,async()=>({}))).state,'unknown');assert.equal(photoWrites,1);passed++;
let publicWrites=0;const publicEvents=[];
assert.equal((await runJob({...claim,binding:{...binding,publicUrl:'https://map.naver.com/x'},executionMode:'reconcile'},{verify:async()=>({...evidence,hours:claim.job.afterHours,schedule:after}),saveHours:async()=>{publicWrites++;},publicReadback:async()=>({publicUrl:'https://map.naver.com/x',naverPlaceId:'wrong',hours:'old',source:'mocked',capturedAt:new Date().toISOString()})},async(action,details)=>{publicEvents.push([action,details]);return {};})).state,'verified');assert.equal(publicWrites,0);assert.equal(publicEvents[1][0],'public_readback');passed++;


const serviceTemp=await mkdtemp(join(tmpdir(),'browser-watch-cli-'));
try {
 const path=join(serviceTemp,'config.json');await writeFile(path,JSON.stringify(config));
 const apiEnv={STORE_BROWSER_API_ORIGIN:'http://127.0.0.1:8787',STORE_BROWSER_WORKER_TOKEN:'sb.device.abcdefghijklmnopqrstuv'};
 const actions=[];
 await main(['--config',path,'--watch','--allow-local-fixture'],apiEnv,{maxTicks:2,sleep:async()=>{},probeBrowser:async()=> 'ready',fetch:async(url,init)=>{const payload=JSON.parse(init.body);actions.push(payload.action);return payload.action==='claim'?Response.json({code:'NO_JOB'},{status:409}):Response.json({device:{}});}});
 assert.deepEqual(actions,['report_health','claim','report_health','claim']);const lock=await acquireSingleton(path+'.worker.lock');await lock();passed++;
 let revokedRequests=0;await assert.rejects(main(['--config',path,'--watch','--allow-local-fixture'],apiEnv,{sleep:async()=>{},probeBrowser:async()=>'ready',fetch:async()=>{revokedRequests++;return Response.json({},{status:401});}}),/revoked/);assert.equal(revokedRequests,1);passed++;
}finally{await rm(serviceTemp,{recursive:true,force:true});}


let forbiddenPermits=0;assert.equal((await runJob(claim,{...adapter,observe:async()=>evidence,supportsWrite:false},async action=>{if(action==='begin_submit')forbiddenPermits++;return{};})).state,'handoff');assert.equal(forbiddenPermits,0);passed++;
await assert.rejects(preparePhotoAsset('https://app.test','fixture',{...photoClaim,job:{...photoClaim.job,photo:{...photo,size:10*1024*1024+1}}},async()=>{throw Error('must not fetch');}),/metadata/);passed++;
console.log(JSON.stringify({passed,failed:0,mode:'mocked; singleton actual second Node process'}));
