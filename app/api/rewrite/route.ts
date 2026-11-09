import {actor,requireAdminActor,secureMutation,body,json,failure,ApiError} from '@/lib/server';
import {decideRewrite,pollRewrite,rewriteEnabled,startRewrite} from '@/lib/rewrite-request-server';

// X6 선택 다시 쓰기(스위치 selection_rewrite, 기본 꺼짐). 읽기(GET)는 스위치 상태와 요청 가능 여부만 돌려준다.
// 쓰기(POST start·poll·decide)는 소유자·관리자만 한다(직원 403). 꺼져 있으면 409다. HERMES 한 번 제출이며 결과는 제안으로만 남는다.
export async function GET(req:Request){
 try{
  const who=await actor(req);
  return json({enabled:await rewriteEnabled(who.owner),canRequest:who.role!=='member'});
 }catch(error){return failure(error)}
}
export async function POST(req:Request){
 try{
  const who=await requireAdminActor(req);secureMutation(req);const input=await body(req);
  if(input.action==='start')return json(await startRewrite(who.owner,who,input));
  if(input.action==='poll')return json(await pollRewrite(who.owner,input));
  if(input.action==='decide')return json(await decideRewrite(who.owner,input));
  throw new ApiError(400,'지원하지 않는 다시 쓰기 작업입니다.');
 }catch(error){return failure(error)}
}
