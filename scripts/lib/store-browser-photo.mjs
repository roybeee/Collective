import { createHash, randomBytes } from 'node:crypto';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
const LIMIT=10*1024*1024;
function metadata(photo) {
 if(!photo||!['image/png','image/jpeg','image/webp'].includes(photo.mime)||!/^[a-f0-9]{64}$/u.test(photo.sha256)||!Number.isSafeInteger(photo.size)||photo.size<1||photo.size>LIMIT||!photo.sourceId||!photo.rightsId||![photo.sourceVersion,photo.rightsVersion].every(x=>Number.isSafeInteger(x)&&x>0))throw Error('approved photo metadata required');
}
function signature(bytes,mime) {
 if(mime==='image/png')return bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
 if(mime==='image/jpeg')return bytes[0]===255&&bytes[1]===216&&bytes[2]===255;
 return bytes.subarray(0,4).toString()==='RIFF'&&bytes.subarray(8,12).toString()==='WEBP';
}
export async function preparePhotoAsset(origin,token,claim,request=fetch) {
 metadata(claim.job.photo);
 const url=new URL('/api/store-browser/worker/asset',origin);url.searchParams.set('jobId',claim.job.id);url.searchParams.set('attemptId',claim.attemptId);
 const response=await request(url.href,{redirect:'error',signal:AbortSignal.timeout(20000),headers:{Authorization:`Bearer ${token}`,'x-browser-lease-token':claim.leaseToken}});
 if(!response.ok||response.headers.get('content-type')?.split(';')[0]!==claim.job.photo.mime)throw Error('photo asset unavailable');
 const declared=Number(response.headers.get('content-length'));
 if(declared&&declared!==claim.job.photo.size)throw Error('photo size mismatch');
 if(!response.body)throw Error('photo body missing');
 const reader=response.body.getReader();let bytes=Buffer.alloc(0);
 while(true){const chunk=await reader.read();if(chunk.done)break;if(bytes.length+chunk.value.length>LIMIT){await reader.cancel();throw Error('photo limit exceeded');}bytes=Buffer.concat([bytes,Buffer.from(chunk.value)]);}
 if(bytes.length!==claim.job.photo.size||createHash('sha256').update(bytes).digest('hex')!==claim.job.photo.sha256||!signature(bytes,claim.job.photo.mime))throw Error('photo bytes or hash mismatch');
 const dir=await mkdtemp(join(tmpdir(),'collective-browser-photo-'));
 const name=`${claim.job.photo.sha256}.${{'image/png':'png','image/jpeg':'jpg','image/webp':'webp'}[claim.job.photo.mime]}`;
 const filename=join(dir,name);await writeFile(filename,bytes,{mode:0o600});
 const nonce=randomBytes(32).toString('hex');const expires=Date.now()+300000;
 const server=createServer(async(req,res)=>{
  if(req.method!=='GET'||req.url!==`/${nonce}`||Date.now()>expires){res.writeHead(404);res.end();return;}
  try{res.setHeader('Content-Type',claim.job.photo.mime);res.setHeader('Cache-Control','no-store');res.end(await readFile(filename));}catch{res.writeHead(503);res.end();}
 });
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 return {url:`http://127.0.0.1:${server.address().port}/${nonce}`,name,mime:claim.job.photo.mime,sha256:claim.job.photo.sha256,dispose:async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await rm(dir,{recursive:true,force:true});}};
}
