import {actor,requireOwnerActor,secureMutation,body,json,failure,ApiError} from '@/lib/server';
import {listFeatureFlags,setFeatureFlag,resetFeatureFlag,withoutAuthor} from '@/lib/feature-flags';

// 서버 기능 스위치(F2a). 읽기는 로그인한 모든 역할, 쓰기는 워크스페이스 소유자만(관리자·직원 403, 비로그인 401).
// 변경자(updatedBy)는 소유자에게만 보낸다.
export async function GET(req:Request){
 try{
  const who=await actor(req),flags=await listFeatureFlags(who.owner);
  return json({flags:who.role==='owner'?flags:flags.map(withoutAuthor)});
 }catch(error){return failure(error)}
}
export async function POST(req:Request){
 try{
  const who=await requireOwnerActor(req);secureMutation(req);const input=await body(req);
  if(input.action==='set')return json({flag:await setFeatureFlag(who.owner,input,{id:who.id,email:who.email})});
  if(input.action==='reset')return json({flag:await resetFeatureFlag(who.owner,input)});
  throw new ApiError(400,'지원하지 않는 기능 스위치 작업입니다.');
 }catch(error){return failure(error)}
}
