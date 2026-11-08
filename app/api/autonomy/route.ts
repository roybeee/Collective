import {actor,requireAdminActor,secureMutation,body,json,failure} from '@/lib/server';
import {autonomyView,saveAutonomySettings} from '@/lib/autonomy-server';

// G3 자율성 규칙. 읽기는 로그인한 모든 역할(변경자는 소유자·관리자에게만), 쓰기(PUT)는 소유자·관리자만(직원 403, 비로그인 401, 다른 출처 403).
// 스위치 autonomy_rules와 무관하게 읽고 쓴다. 적용 여부(enabled)는 응답에 함께 싣는다.
export async function GET(req:Request){
 try{return json(await autonomyView(await actor(req)))}catch(error){return failure(error)}
}
export async function PUT(req:Request){
 try{
  const who=await requireAdminActor(req);secureMutation(req);const input=await body(req);
  return json(await saveAutonomySettings(who,input));
 }catch(error){return failure(error)}
}
