import {identity,actor,secureMutation,body,str,json,failure,acquireLock,releaseLock} from '@/lib/server';
import {dataRequestAction,listDataRequests} from '@/lib/data-requests-server';
import {executionRate} from '@/lib/execution-rate';

// 자료 요청(A6-1). 조회는 워크스페이스 구성원 모두(?campaignId 또는 ?brandId). 쓰기는 기능 스위치 a6_data_requests가 켜져 있어야 한다(꺼짐 409).
// collect·create는 직원도, close(answered)·dismiss·reconcile은 대표·관리자만(직원 403). 쓰기는 소유자 변경 잠금 안에서 하고 수동 닫기는 version 비교(CAS)로 409를 낸다.
export async function GET(req:Request){
 try{
  const owner=await identity(req),params=new URL(req.url).searchParams;
  const campaignId=str(params.get('campaignId')??'','캠페인',100)||undefined,brandId=str(params.get('brandId')??'','브랜드',100)||undefined;
  return json(await listDataRequests(owner,{campaignId,brandId}));
 }catch(error){return failure(error)}
}

export async function POST(req:Request){
 let owner='',lock='';
 try{
  const who=await actor(req);owner=who.owner;secureMutation(req);
  const input=await body(req);
  lock=await acquireLock(owner);
  await executionRate(owner,'data_requests');
  return json(await dataRequestAction(owner,input,who));
 }catch(error){return failure(error)}finally{if(lock)await releaseLock(owner,lock)}
}
