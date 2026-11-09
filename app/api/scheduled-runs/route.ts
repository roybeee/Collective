import {actor,requireAdminActor,secureMutation,body,json,failure,ApiError} from '@/lib/server';
import {removeSchedule,saveSchedule,scheduledRunsView,setScheduleEnabled} from '@/lib/scheduled-runs-server';

// G3 예약 실행. 읽기는 로그인한 모든 역할, 쓰기는 소유자·관리자만(직원 403, 비로그인 401, 다른 출처 403). 실행 자체는 워커 큐가 한다(여기서 run_now 없음).
export async function GET(req:Request){
 try{return json(await scheduledRunsView(await actor(req)))}catch(error){return failure(error)}
}
export async function POST(req:Request){
 try{
  const who=await requireAdminActor(req);secureMutation(req);const input=await body(req);
  if(input.action==='save')return json({schedule:await saveSchedule(who,input),...await scheduledRunsView(who)});
  if(input.action==='set_enabled')return json({schedule:await setScheduleEnabled(who,input),...await scheduledRunsView(who)});
  if(input.action==='remove')return json({...await removeSchedule(who,input),...await scheduledRunsView(who)});
  throw new ApiError(400,'지원하지 않는 예약 작업입니다.');
 }catch(error){return failure(error)}
}
