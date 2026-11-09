import type {Campaign} from '@/lib/agency';
import {ApiError,requireAdminActor,secureMutation,body,readRecord,str,json,failure,acquireLock,releaseLock} from '@/lib/server';
import {addGeoStarters,cancelGeoRun,geoView,pollGeoRun,saveGeoQuestion,saveGeoSite,startGeoRun} from '@/lib/geo-run-server';

// G5 AI 검색 노출 자동 추적(스위치 geo_tracking, 기본 꺼짐). 읽기·쓰기 모두 대표·관리자만 하고(직원 403), 꺼져 있으면 409다.
// 질문·사이트 점검 저장은 GEO 질문 잠금 안에서 하고, 측정 시작·진행·중지는 lib/geo-run-server.ts가 자기 잠금을 잡는다(HERMES 호출 동안 다른 성장 저장을 막지 않는다).
const campaignOf=(owner:string,id:unknown)=>readRecord<Campaign>(owner,'campaign',str(id,'캠페인',100,true));
export async function GET(req:Request){
 try{const who=await requireAdminActor(req),c=await campaignOf(who.owner,new URL(req.url).searchParams.get('campaignId'));return json(await geoView(who,c))}catch(e){return failure(e)}
}
export async function POST(req:Request){
 let owner='',lock='';
 try{
  const who=await requireAdminActor(req);secureMutation(req);const b=await body(req);owner=who.owner;
  const c=await campaignOf(owner,b.campaignId),action=String(b.action??'');
  if(action==='start_run')return json(await startGeoRun(who,c,b));
  if(action==='advance'||action==='cancel_run'){
   const id=str(b.runId,'측정 번호',100,true);
   const run=await (action==='advance'?pollGeoRun(owner,id,c.brandId):cancelGeoRun(owner,id,c.brandId));
   return json(run);
  }
  lock=await acquireLock(owner+':geo-questions');
  if(action==='save_question')return json(await saveGeoQuestion(who,c,b));
  if(action==='add_starters')return json(await addGeoStarters(who,c,b));
  if(action==='save_site')return json(await saveGeoSite(who,c,b));
  throw new ApiError(400,'지원하지 않는 작업입니다.');
 }catch(e){return failure(e)}finally{if(lock)await releaseLock(owner+':geo-questions',lock)}
}
