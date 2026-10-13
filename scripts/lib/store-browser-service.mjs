import { open, readFile, unlink, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
export function classifyWorkerError(error) {
 if(error.status===401||error.status===403) return 'stop';
 if(error.status===409&&error.code==='NO_JOB') return 'idle';
 return 'fault';
}
export async function acquireSingleton(path) {
 const filename=resolve(path);
 const handle=await open(filename,'wx',0o600).catch(async error=>{
  if(error.code!=='EEXIST')throw error;
  const owner=JSON.parse(await readFile(filename,'utf8'));
  if(!Number.isSafeInteger(owner.pid)||owner.pid<1) throw Error('invalid singleton lock; operator required');
  try {process.kill(owner.pid,0);throw Error('worker already running');} catch(fault){if(fault.code!=='ESRCH')throw fault;}
  await unlink(filename);return open(filename,'wx',0o600);
 });
 await handle.writeFile(JSON.stringify({pid:process.pid})); await handle.close();
 return async()=>{const owner=JSON.parse(await readFile(filename,'utf8'));if(owner.pid===process.pid)await unlink(filename);};
}
export async function readPrivateEnv(filename) {
 const info=await stat(filename);if(!info.isFile()||(info.mode&0o777)!==0o600||info.uid!==process.getuid?.())throw Error('env file must be owned private 0600');
 const data=JSON.parse(await readFile(filename,'utf8'));
 if(!data||typeof data!=='object'||Array.isArray(data)||Object.keys(data).some(k=>!['STORE_BROWSER_API_ORIGIN','STORE_BROWSER_WORKER_TOKEN'].includes(k))||!Object.values(data).every(x=>typeof x==='string'))throw Error('invalid private env schema');
 return data;
}
export async function watchLoop(tick,{signal,maxTicks=Infinity,sleep=delay,onHealth=()=>{}}={}) {
 let failures=0;
 for(let count=0;count<maxTicks&&!signal?.aborted;count++) {
  try {const result=await tick();failures=0;onHealth({process:'ready',state:result?.state||'idle'});}
  catch(error) {const kind=classifyWorkerError(error);if(kind==='stop'){onHealth({process:'error',state:'auth_revoked'});throw Error('worker authentication revoked');}if(kind==='fault')failures++;if(failures>=8)throw Error('worker fault retry limit reached');onHealth({process:kind==='idle'?'ready':'error',state:kind});}
  if(count+1<maxTicks&&!signal?.aborted)try{await sleep(Math.min(60000,5000*2**Math.min(failures,4)),undefined,{signal});}catch(error){if(!signal?.aborted)throw error;}
 }
}
