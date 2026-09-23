import {campaignDeletionPreview,failure,json,requireAdminActor,str} from '@/lib/server';

// 캠페인 삭제 전 영향 조회: kind별 삭제·보존 건수와 삭제 가능 여부. 아무것도 쓰지 않는다.
// 권한은 삭제(/api/action delete_campaign)와 같다. 직원 403, 다른 소유자의 캠페인은 404.
export async function GET(req:Request,context:{params:Promise<{id:string}>}){
 try{
  const who=await requireAdminActor(req),{id}=await context.params;
  return json(await campaignDeletionPreview(who.owner,str(id,'캠페인',100,true)));
 }catch(e){return failure(e)}
}
