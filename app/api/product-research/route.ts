// 상품 리서치 API. GET: 화면 응답(ResearchViewResponse, 스위치가 꺼져도 같은 모양·enabled:false). POST: {action, requestId, ...} 쓰기 16종(lib/product-research/api.ts).
// 쓰기는 출처 확인(secureMutation)·관리자 이상 확인 뒤 researchAction이 상품 리서치 잠금(`${owner}:product-research`)을 잡고 한다. 작업자 수집도 같은 키라
// 화면 쓰기와 수집이 겹치지 않는다(겹치면 최대 3초 기다린 뒤 409). 성장 기록을 쓰는 넘기기(handoff)는 성장 화면 저장과 같은 소유자 잠금도 함께 잡는다.
// 가져오기 파일(2MB)을 받으므로 본문 상한은 2.2MB다.
import {ApiError,acquireLock,failure,json,releaseLock,requireAdminActor,secureMutation} from '@/lib/server';
import {HttpBodyError,readBoundedJson} from '@/lib/http-limits';
import {researchAction,researchView,ResearchError} from '@/lib/product-research/server';

import {researchRetentionInventory} from '@/lib/product-research/server-retention';

const MAX_BODY=2_200_000;
const fail=(e:unknown)=>e instanceof ResearchError?json({error:e.message,...e.extra},e.status):failure(e);
// 성장2 기록(growth_signal·growth_need·growth_history)을 쓰는 작업. 성장 화면(lib/growth-workspace-server.ts)이 소유자 잠금으로 판 번호를 직렬화한다.
const GROWTH_WRITES=new Set(['handoff']);

export async function GET(req:Request){try{
 const who=await requireAdminActor(req);
 if(new URL(req.url).searchParams.get('view')==='retention'){if(who.role!=='owner')throw new ApiError(403,'소유자만 보존 상태를 확인할 수 있습니다.');return json(await researchRetentionInventory(who.owner))}
 return json(await researchView(who));
}catch(e){return fail(e)}}

export async function POST(req:Request){
 let owner='',lock='';
 try{
  const who=await requireAdminActor(req);secureMutation(req);
  let b:Record<string,unknown>;
  try{b=await readBoundedJson<Record<string,unknown>>(req,MAX_BODY)}catch(e){if(e instanceof HttpBodyError)throw new ApiError(e.status,e.message);throw new ApiError(400,'입력 형식을 확인해 주세요.')}
  if(!b||typeof b!=='object'||Array.isArray(b))throw new ApiError(400,'입력 형식을 확인해 주세요.');
  owner=who.owner;
  if(GROWTH_WRITES.has(String(b.action)))lock=await acquireLock(owner);
  return json(await researchAction(who,b));
 }catch(e){return fail(e)}finally{if(lock)await releaseLock(owner,lock)}
}
