import {identity,secureMutation,body,connection,json,failure,listRecords,ApiError} from '@/lib/server';
import {researchActive,type BrandResearch} from '@/lib/archive';
import {inspectResearchAccess} from '@/lib/deep-research-server';
import {executeResearch} from '@/lib/research-execution';
import {scheduleResearch} from '@/lib/research-background';
import {startResearchAccess,saveStartAccess} from '@/lib/research-tool-check';
import {scopedPrincipal,scopeByBrandStore,requireInputAction,requireRecordAction} from '@/lib/server-access';
export async function GET(req:Request){try{const owner=await identity(req);if(new URL(req.url).searchParams.get('jobs')==='active'){const scoped=await scopedPrincipal(req),rows=(await listRecords<BrandResearch>(owner,'brand_research')).filter(researchActive);return json((scoped?scopeByBrandStore(scoped,rows):rows).map(r=>({id:r.id,brandId:r.brandId,status:r.status,retryAt:r.retryAt,error:r.error})));}const cfg=await connection(owner);if(cfg.provider!=='hermes')throw new ApiError(409,'HERMES 연결이 필요합니다.');return json(await inspectResearchAccess(cfg))}catch(e){return failure(e)}}
// 심층 조사 시작 때 최신 도구 점검(security-ops-1). RESEARCH_TOOL_POLICY=block이면 409로 막고, 새로 만든 조사(202)에는 점검 결과를 research.access로 남긴다.
export async function POST(req:Request){try{const owner=await identity(req);secureMutation(req);const b=await body(req);
 // 범위 가드: 조사는 AI 실행(run_ai)이다. 시작은 요청한 브랜드·지점, 진행·복구·중지는 저장된 조사의 브랜드·지점으로 본다.
 if(b.action==='start')await requireInputAction(req,'run_ai',{storeId:b.storeId,brandId:b.brandId});else await requireRecordAction(req,'run_ai','brand_research',b.id);
 const cfg=b.action==='start'&&(b.storeId||b.mode!=='classify')?await connection(owner).catch(()=>null):null,access=cfg?.provider==='hermes'?await startResearchAccess(cfg):null;
 const result=await executeResearch(owner,b);if(access&&result.status===202)await saveStartAccess(owner,String(b.id),access);if(b.action==='start'&&result.ok)scheduleResearch(owner,b.id);return result}catch(e){return failure(e)}}
