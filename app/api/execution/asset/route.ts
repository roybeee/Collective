import {identity,readRecord,runtime,ApiError,failure,str} from '@/lib/server';
import type {ExecutionCreative} from '@/lib/execution';
export async function GET(req:Request){try{
 const owner=await identity(req),id=str(new URL(req.url).searchParams.get('id'),'소재',100,true),creative=await readRecord<ExecutionCreative>(owner,'execution_creative',id);
 await readRecord(owner,'campaign',creative.campaignId);
 const object=await runtime.BUCKET?.get(creative.objectKey);if(!object)throw new ApiError(404,'파일을 찾을 수 없습니다.');
 return new Response(await object.arrayBuffer(),{headers:{'Content-Type':'image/png','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Content-Disposition':`inline; filename="${creative.pngHash}.png"`}});
}catch(e){return failure(e)}}
