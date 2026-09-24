import {requireAdmin,ApiError,identity,secureMutation,body,json,failure,acquireLock,releaseLock} from '@/lib/server';
import {saveCredential,revokeCredential,channelStatus,credentialResolution} from '@/lib/channel-credentials';
// 자격증명은 저장 전에 실제 API로 검증하고, 어떤 응답에도 비밀값을 담지 않는다.
// F5: brandId·storeId를 주면 그 브랜드·지점 단위로 저장·해제하고, GET은 그 단위의 수집이 쓸 자격증명(resolved)을 함께 준다. 없으면 워크스페이스 기본(기존 동작)이다.
export async function GET(req:Request){try{const owner=await identity(req),p=new URL(req.url).searchParams,status=await channelStatus(owner);
 return json(p.get('brandId')||p.get('storeId')?{...status,resolved:await credentialResolution(owner,{brandId:p.get('brandId'),storeId:p.get('storeId')})}:status)}catch(e){return failure(e)}}
export async function POST(req:Request){let owner='',lock='';try{
 owner=await identity(req);secureMutation(req);await requireAdmin(req);const b=await body(req);lock=await acquireLock(owner);const scope={brandId:b.brandId,storeId:b.storeId};
 if(b.action==='save_credential')return json(await saveCredential(owner,b.channel,(b.data||{}) as Record<string,unknown>,scope));
 if(b.action==='revoke_credential')return json(await revokeCredential(owner,b.channel,scope));
 throw new ApiError(400,'지원하지 않는 연결 작업입니다.');
}catch(e){return failure(e)}finally{if(lock)await releaseLock(owner,lock)}}
