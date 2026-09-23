import {identity,secureMutation,body,connection,json,failure,listRecords,ApiError} from '@/lib/server';
import {researchActive,type BrandResearch} from '@/lib/archive';
import {inspectResearchAccess} from '@/lib/deep-research-server';
import {executeResearch} from '@/lib/research-execution';
import {scheduleResearch} from '@/lib/research-background';
export async function GET(req:Request){try{const owner=await identity(req);if(new URL(req.url).searchParams.get('jobs')==='active')return json((await listRecords<BrandResearch>(owner,'brand_research')).filter(researchActive).map(r=>({id:r.id,brandId:r.brandId,status:r.status,retryAt:r.retryAt,error:r.error})));const cfg=await connection(owner);if(cfg.provider!=='hermes')throw new ApiError(409,'HERMES 연결이 필요합니다.');return json(await inspectResearchAccess(cfg))}catch(e){return failure(e)}}
export async function POST(req:Request){try{const owner=await identity(req);secureMutation(req);const b=await body(req);const result=await executeResearch(owner,b);if(b.action==='start'&&result.ok)scheduleResearch(owner,b.id);return result}catch(e){return failure(e)}}
