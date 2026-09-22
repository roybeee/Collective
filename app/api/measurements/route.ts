import {ApiError,identity,secureMutation,body,json,failure,acquireLock,releaseLock} from '@/lib/server';
import {collectForExperiment} from '@/lib/measurement-collection';
// 수집 결과는 초안으로만 저장된다. 비교 가능성 확정과 결과 반영은 사용자가 한다.
export async function POST(req:Request){let owner='',lock='';try{
 owner=identity(req);secureMutation(req);const b=await body(req);lock=await acquireLock(owner);
 if(b.action!=='collect')throw new ApiError(400,'지원하지 않는 측정 작업입니다.');
 return json(await collectForExperiment(owner,b));
}catch(e){return failure(e)}finally{if(lock)await releaseLock(owner,lock)}}
