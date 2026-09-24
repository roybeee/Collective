import {archiveCampaign,unarchiveCampaign} from '@/lib/campaign-archive';
import {ApiError,acquireLock,body,failure,json,releaseLock,requireAdminActor,secureMutation,str} from '@/lib/server';

// 캠페인 보관·보관 해제(ux-9 권고 2). 권한은 캠페인 삭제(/api/action delete_campaign)와 같다. 직원 403, 다른 소유자의 캠페인은 404.
// 삭제·브리프 수정·AI 실행과 같은 소유자 잠금 안에서 진행 중 작업을 확인하고 쓴다.
export async function POST(req:Request){let owner='',lock='';try{
 const who=await requireAdminActor(req);secureMutation(req);const b=await body(req);
 if(b.action!=='archive_campaign'&&b.action!=='unarchive_campaign')throw new ApiError(400,'지원하지 않는 작업입니다.');
 const id=str(b.id,'캠페인',100,true),by={id:who.id,email:who.email};
 owner=who.owner;lock=await acquireLock(owner);
 return json(b.action==='archive_campaign'?await archiveCampaign(owner,id,by):await unarchiveCampaign(owner,id,by));
}catch(e){return failure(e)}finally{if(lock)await releaseLock(owner,lock)}}
