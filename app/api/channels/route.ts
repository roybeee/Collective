import {ApiError,identity,secureMutation,body,json,failure,acquireLock,releaseLock} from '@/lib/server';
import {saveCredential,revokeCredential,channelStatus} from '@/lib/channel-credentials';
// 자격증명은 저장 전에 실제 API로 검증하고, 어떤 응답에도 비밀값을 담지 않는다.
export async function GET(req:Request){try{return json(await channelStatus(identity(req)))}catch(e){return failure(e)}}
export async function POST(req:Request){let owner='',lock='';try{
 owner=identity(req);secureMutation(req);const b=await body(req);lock=await acquireLock(owner);
 if(b.action==='save_credential')return json(await saveCredential(owner,b.channel,(b.data||{}) as Record<string,unknown>));
 if(b.action==='revoke_credential')return json(await revokeCredential(owner,b.channel));
 throw new ApiError(400,'지원하지 않는 연결 작업입니다.');
}catch(e){return failure(e)}finally{if(lock)await releaseLock(owner,lock)}}
