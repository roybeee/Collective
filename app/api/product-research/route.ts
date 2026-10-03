// 상품 리서치 API. GET: 화면 응답(ResearchViewResponse, 스위치가 꺼져도 같은 모양·enabled:false). POST: {action, requestId, ...} 쓰기 12종(lib/product-research/api.ts).
// 쓰기는 출처 확인(secureMutation)·관리자 이상·소유자 잠금(acquireLock) 안에서 한다. 가져오기 파일(2MB)을 받으므로 본문 상한은 2.2MB다.
import {ApiError,acquireLock,failure,json,releaseLock,requireAdminActor,secureMutation} from '@/lib/server';
import {HttpBodyError,readBoundedJson} from '@/lib/http-limits';
import {researchAction,researchView,ResearchError} from '@/lib/product-research/server';

const MAX_BODY=2_200_000;
const fail=(e:unknown)=>e instanceof ResearchError?json({error:e.message,...e.extra},e.status):failure(e);

export async function GET(req:Request){try{return json(await researchView(await requireAdminActor(req)))}catch(e){return fail(e)}}

export async function POST(req:Request){
 let owner='',lock='';
 try{
  const who=await requireAdminActor(req);secureMutation(req);
  let b:Record<string,unknown>;
  try{b=await readBoundedJson<Record<string,unknown>>(req,MAX_BODY)}catch(e){if(e instanceof HttpBodyError)throw new ApiError(e.status,e.message);throw new ApiError(400,'입력 형식을 확인해 주세요.')}
  if(!b||typeof b!=='object'||Array.isArray(b))throw new ApiError(400,'입력 형식을 확인해 주세요.');
  owner=who.owner;lock=await acquireLock(owner);
  return json(await researchAction(who,b));
 }catch(e){return fail(e)}finally{if(lock)await releaseLock(owner,lock)}
}
