import {requireAdminActor,secureMutation,body,str,json,failure,acquireLock,releaseLock} from '@/lib/server';
import {listPlaceDrafts,placeDraftAction} from '@/lib/place-drafts-server';

// C5 플레이스 리뷰 답글·소식 초안. 읽기·쓰기 모두 대표·관리자(직원 403, 비로그인 401, 다른 출처 403). 스위치 place_drafts가 꺼지면 쓰기는 409(조회·취소·매핑 해제·장치 결과 확인은 계속).
// POST action: create·edit·approve·mark_submitted·mark_verified·cancel·create_device_task·sync_device·declare_mapping·revoke_mapping·submit_help. 쓰기는 소유자 변경 잠금 안에서 한다.
// 자동 제출은 없다(docs/PLACE-DRAFTS.ko.md).
export async function GET(req:Request){
 try{
  const who=await requireAdminActor(req),storeId=str(new URL(req.url).searchParams.get('storeId')??'','지점',100,true);
  return json(await listPlaceDrafts(who.owner,storeId));
 }catch(error){return failure(error)}
}
export async function POST(req:Request){
 let owner='',lock='';
 try{
  const who=await requireAdminActor(req);owner=who.owner;secureMutation(req);
  const input=await body(req);
  lock=await acquireLock(owner);
  return json(await placeDraftAction(who,input));
 }catch(error){return failure(error)}finally{if(lock)await releaseLock(owner,lock)}
}
