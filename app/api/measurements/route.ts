import {ApiError,actor,secureMutation,body,json,failure,acquireLock,releaseLock} from '@/lib/server';
import {collectForExperiment} from '@/lib/measurement-collection';
// 수집 결과는 초안으로만 저장된다. 비교 가능성 확정과 결과 반영은 사용자가 한다.
// 수집은 관리자가 연결한 채널 자격증명으로 외부 API를 부르고 워커가 6시간마다 반복할 대상을 등록하므로 대표·관리자만 한다(직원 403, loop-1).
export async function POST(req:Request){let owner='',lock='';try{
 const who=await actor(req);owner=who.owner;secureMutation(req);if(who.role==='member')throw new ApiError(403,'성과 수집은 대표·관리자만 시작할 수 있습니다.');const b=await body(req);lock=await acquireLock(owner);
 if(b.action!=='collect')throw new ApiError(400,'지원하지 않는 측정 작업입니다.');
 return json(await collectForExperiment(owner,b));
}catch(e){return failure(e)}finally{if(lock)await releaseLock(owner,lock)}}
