import {requireAdmin,ApiError,identity,secureMutation,body,json,failure,acquireLock,releaseLock} from '@/lib/server';
import {saveCredential,revokeCredential,channelStatus,credentialResolution,savePublisherCredential,verifyPublisherCredential,revokePublisherCredential,publisherCredentialStatus} from '@/lib/channel-credentials';
import {publisherFor,d1ContainerJournal} from '@/lib/execution-publisher-server';
import type {DirectPublisherCredential} from '@/lib/connectors/types';
// C3 직접 게시 연결 검증: 저장 전·검증 요청 때 공급자 /me를 부른다(비밀값 저장 없음, 게시 없음).
const verifyPublisher=(owner:string)=>(credential:DirectPublisherCredential)=>publisherFor({kind:credential.channel,credential,meta:{channel:credential.channel,brandId:'',account:'',userId:credential.userId,expiresAt:null,expiringSoon:false,version:0,updatedAt:''}},d1ContainerJournal(owner,'')).verify();
// 자격증명은 저장 전에 실제 API로 검증하고, 어떤 응답에도 비밀값을 담지 않는다.
// F5: brandId·storeId를 주면 그 브랜드·지점 단위로 저장·해제하고, GET은 그 단위의 수집이 쓸 자격증명(resolved)을 함께 준다. 없으면 워크스페이스 기본(기존 동작)이다.
export async function GET(req:Request){try{const owner=await identity(req),p=new URL(req.url).searchParams,status=await channelStatus(owner);
 // C3: brandId가 있으면 그 브랜드의 직접 게시 연결 상태(publishers, 비밀값 없음)도 함께 준다.
 return json(p.get('brandId')||p.get('storeId')?{...status,resolved:await credentialResolution(owner,{brandId:p.get('brandId'),storeId:p.get('storeId')}),...(p.get('brandId')?{publishers:await publisherCredentialStatus(owner,p.get('brandId'))}:{})}:status)}catch(e){return failure(e)}}
export async function POST(req:Request){let owner='',lock='';try{
 owner=await identity(req);secureMutation(req);await requireAdmin(req);const b=await body(req);lock=await acquireLock(owner);const scope={brandId:b.brandId,storeId:b.storeId};
 if(b.action==='save_credential')return json(await saveCredential(owner,b.channel,(b.data||{}) as Record<string,unknown>,scope));
 if(b.action==='revoke_credential')return json(await revokeCredential(owner,b.channel,scope));
 // C3 직접 게시 연결(브랜드 단위): 저장 전 /me 검증, 저장된 토큰 재검증, 해제. 연결만 하며 게시는 발행 승인·실행 경로에서만 일어난다.
 if(b.action==='connect_publisher')return json(await savePublisherCredential(owner,b.channel,b.brandId,(b.data||{}) as Record<string,unknown>,verifyPublisher(owner)));
 if(b.action==='verify_publisher')return json(await verifyPublisherCredential(owner,b.channel,b.brandId,verifyPublisher(owner)));
 if(b.action==='revoke_publisher')return json(await revokePublisherCredential(owner,b.channel,b.brandId));
 throw new ApiError(400,'지원하지 않는 연결 작업입니다.');
}catch(e){return failure(e)}finally{if(lock)await releaseLock(owner,lock)}}
