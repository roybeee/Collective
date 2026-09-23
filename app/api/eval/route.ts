import {requireOwnerActor,secureMutation,acquireLock,releaseLock,json,failure,ApiError} from '@/lib/server';
import {HttpBodyError,readBoundedJson} from '@/lib/http-limits';
import {evalAction,evalRead,EVAL_BODY_LIMIT} from '@/lib/eval-server';

// 서버 평가(F1b-2). 읽기·쓰기 모두 워크스페이스 소유자만 한다: 비로그인 401, 관리자·직원 403, 다른 소유자의 항목은 404(소유자 범위 records).
export async function GET(req:Request){
 try{const who=await requireOwnerActor(req);return json(await evalRead(who.owner,new URL(req.url).searchParams))}catch(error){return failure(error)}
}
// 동결 요청을 직접 저장(save_case)할 수 있어 공용 body()(200KB)보다 큰 한도를 같은 http-limits 방식으로 읽는다.
async function evalBody(req:Request){
 try{
  const value=await readBoundedJson<Record<string,unknown>>(req,EVAL_BODY_LIMIT);
  if(!value||typeof value!=='object'||Array.isArray(value))throw new ApiError(400,'입력 형식을 확인해 주세요.');
  return value;
 }catch(error){if(error instanceof HttpBodyError)throw new ApiError(error.status,error.message);throw error}
}
export async function POST(req:Request){
 let owner='',lock='';
 try{
  const who=await requireOwnerActor(req);owner=who.owner;secureMutation(req);
  const input=await evalBody(req);
  lock=await acquireLock(owner);
  return await evalAction(owner,input,who);
 }catch(error){return failure(error)}finally{if(lock)await releaseLock(owner,lock)}
}
