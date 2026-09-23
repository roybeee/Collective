import {identity,secureMutation,body,connection,json,failure,listRecords,ApiError} from '@/lib/server';
import {researchActive,type BrandResearch} from '@/lib/archive';
import {inspectResearchAccess} from '@/lib/deep-research-server';
import {executeResearch} from '@/lib/research-execution';
import {scheduleResearch} from '@/lib/research-background';
import {startResearchAccess,saveStartAccess} from '@/lib/research-tool-check';
export async function GET(req:Request){try{const owner=await identity(req);if(new URL(req.url).searchParams.get('jobs')==='active')return json((await listRecords<BrandResearch>(owner,'brand_research')).filter(researchActive).map(r=>({id:r.id,brandId:r.brandId,status:r.status,retryAt:r.retryAt,error:r.error})));const cfg=await connection(owner);if(cfg.provider!=='hermes')throw new ApiError(409,'HERMES 연결이 필요합니다.');return json(await inspectResearchAccess(cfg))}catch(e){return failure(e)}}
// 심층 조사 시작 때 최신 도구 점검(security-ops-1). RESEARCH_TOOL_POLICY=block이면 409로 막고, 새로 만든 조사(202)에는 점검 결과를 research.access로 남긴다.
export async function POST(req:Request){try{const owner=await identity(req);secureMutation(req);const b=await body(req);
 const cfg=b.action==='start'&&(b.storeId||b.mode!=='classify')?await connection(owner).catch(()=>null):null,access=cfg?.provider==='hermes'?await startResearchAccess(cfg):null;
 const result=await executeResearch(owner,b);if(access&&result.status===202)await saveStartAccess(owner,String(b.id),access);if(b.action==='start'&&result.ok)scheduleResearch(owner,b.id);return result}catch(e){return failure(e)}}
