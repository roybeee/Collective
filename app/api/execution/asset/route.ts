import {identity,readRecord,runtime,ApiError,failure,str} from '@/lib/server';
import type {ExecutionCreative} from '@/lib/execution';
import {codedPngObjectKey} from '@/lib/coded-png-server';
export async function GET(req:Request){try{
 const owner=await identity(req),params=new URL(req.url).searchParams;
 // A4-4: ?codedPng=<발행 id>는 그 발행에 연결한 코드 넣은 파생 PNG(비공개)를 돌려준다.
 if(params.has('codedPng')){const object=await runtime.BUCKET?.get(await codedPngObjectKey(owner,str(params.get('codedPng'),'발행',100,true)));if(!object)throw new ApiError(404,'파일을 찾을 수 없습니다.');return new Response(await object.arrayBuffer(),{headers:{'Content-Type':'image/png','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Content-Disposition':'inline; filename="coded.png"'}})}
 const id=str(params.get('id'),'소재',100,true),creative=await readRecord<ExecutionCreative>(owner,'execution_creative',id);
 await readRecord(owner,'campaign',creative.campaignId);
 const object=await runtime.BUCKET?.get(creative.objectKey);if(!object)throw new ApiError(404,'파일을 찾을 수 없습니다.');
 return new Response(await object.arrayBuffer(),{headers:{'Content-Type':'image/png','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Content-Disposition':`inline; filename="${creative.pngHash}.png"`}});
}catch(e){return failure(e)}}
