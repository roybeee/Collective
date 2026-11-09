import {requireAdminActor,secureMutation,body,str,json,failure,acquireLock,releaseLock,type Actor} from '@/lib/server';
import {listPlaceDrafts,placeDraftAction} from '@/lib/place-drafts-server';
import {isScoped} from '@/lib/access';
import {accessOf,requireAccess,placeDraftResource,storeResource} from '@/lib/server-access';

// C5 플레이스 리뷰 답글·소식 초안. 읽기·쓰기 모두 대표·관리자(직원 403, 비로그인 401, 다른 출처 403). 스위치 place_drafts가 꺼지면 쓰기는 409(조회·취소·매핑 해제·장치 결과 확인은 계속).
// POST action: create·edit·approve·mark_submitted·mark_verified·cancel·create_device_task·sync_device·declare_mapping·revoke_mapping·submit_help. 쓰기는 소유자 변경 잠금 안에서 한다.
// 자동 제출은 없다(docs/PLACE-DRAFTS.ko.md).
// G7: 범위 역할은 초안 작업에 publish 권한(배정 지점의 점포 매니저·배정 브랜드의 브랜드 매니저), 화면 매핑 선언·해제에 연결 관리 권한(범위 역할은 없음)이 있어야 한다.
// 범위 검사를 통과하면 그 지점의 이 요청에 한해 관리자 단계로 처리한다(lib/place-drafts-server.ts의 역할 검사는 그대로 둔다). 범위 없는 역할은 이전과 같은 경로다.
const mappingActions=new Set(['declare_mapping','revoke_mapping']);
const storeOf=(owner:string,input:Record<string,unknown>)=>()=>input.action==='create'||mappingActions.has(String(input.action))?storeResource(owner,input.storeId):placeDraftResource(owner,input.id);
export async function GET(req:Request){
 try{
  const access=await accessOf(req);
  if(isScoped(access.principal)){
   const owner=access.actor.owner,storeId=str(new URL(req.url).searchParams.get('storeId')??'','지점',100,true);
   await requireAccess(req,'publish',()=>storeResource(owner,storeId));
   return json(await listPlaceDrafts(owner,storeId));
  }
  const who=await requireAdminActor(req),storeId=str(new URL(req.url).searchParams.get('storeId')??'','지점',100,true);
  return json(await listPlaceDrafts(who.owner,storeId));
 }catch(error){return failure(error)}
}
export async function POST(req:Request){
 let owner='',lock='';
 try{
  const access=await accessOf(req);
  let who:Actor,input:Record<string,unknown>;
  if(isScoped(access.principal)){
   owner=access.actor.owner;secureMutation(req);input=await body(req);
   await requireAccess(req,mappingActions.has(String(input.action))?'manage_connections':'publish',storeOf(owner,input));
   who={...access.actor,role:'admin'};
  }else{
   who=await requireAdminActor(req);owner=who.owner;secureMutation(req);
   input=await body(req);
  }
  lock=await acquireLock(owner);
  return json(await placeDraftAction(who,input));
 }catch(error){return failure(error)}finally{if(lock)await releaseLock(owner,lock)}
}
