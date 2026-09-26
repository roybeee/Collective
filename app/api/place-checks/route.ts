import {identity,actor,secureMutation,body,str,json,failure,acquireLock,releaseLock} from '@/lib/server';
import {listPlaceChecks,placeCheckAction} from '@/lib/place-check-server';
import {placeCheckRequests} from '@/lib/data-requests-server';
import {executionRate} from '@/lib/execution-rate';

// 플레이스 정보 대조(A6-2). 조회는 워크스페이스 구성원 모두(?storeId). 쓰기는 기능 스위치 a6_place_check가 켜져 있어야 한다(꺼짐 409).
// save_snapshot은 대표·관리자만(직원 403), save_task(플레이스 할 일 처리)는 기존 점포 할 일처럼 구성원 모두. 쓰기는 소유자 변경 잠금 안에서 하고 version 비교(CAS)로 409를 낸다.
// 스냅샷의 fact_missing은 a6_data_requests가 켜져 있으면 지점 자료 요청(dataRequests)이 된다. URL을 열지 않고 모델도 부르지 않는다.
export async function GET(req:Request){
 try{
  const owner=await identity(req),storeId=str(new URL(req.url).searchParams.get('storeId')??'','지점',100,true);
  return json(await listPlaceChecks(owner,storeId));
 }catch(error){return failure(error)}
}

export async function POST(req:Request){
 let owner='',lock='';
 try{
  const who=await actor(req);owner=who.owner;secureMutation(req);
  const input=await body(req);
  lock=await acquireLock(owner);
  await executionRate(owner,'place_checks');
  const out=await placeCheckAction(owner,input,who);
  return json('snapshot' in out?{...out,...await placeCheckRequests(owner,out.snapshot,who)}:out);
 }catch(error){return failure(error)}finally{if(lock)await releaseLock(owner,lock)}
}
