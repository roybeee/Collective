import {identity,requireAdminActor,secureMutation,readRecord,recordStatement,json,failure,str,stamp,ApiError,acquireLock,releaseLock,decrypt,type Actor} from '@/lib/server';
import {authEnv} from '@/lib/auth-session';
import type {Campaign} from '@/lib/agency';
import {providerPublicationStatus,type Publication} from '@/lib/execution';
import {getExecution,saveLimits,connectPublisher,disconnectPublisher,saveCreative,savePublication,publicationFor,approvePublication,reservePublication,saveProviderResult,cancelPublication,reconfirmPublication,resolveUncertain,retireMedia,externalMediaReview,type PublisherCredential} from '@/lib/execution-server';
import {submitBuffer,inspectBuffer,listBufferChannels} from '@/lib/publisher-buffer';
import {readBoundedJson,HttpBodyError} from '@/lib/http-limits';
import {executionRate} from '@/lib/execution-rate';

// 관리자 전용 실행. 승인·해제·확정한 실제 계정을 기록한다.
const adminActions=['connect_buffer','disconnect_buffer','buffer_channels','save_limits','approve','execute','cancel','reconfirm','resolve_uncertain'];
export async function GET(req:Request){try{const owner=await identity(req),id=str(new URL(req.url).searchParams.get('campaignId'),'캠페인',100,true),campaign=await readRecord<Campaign>(owner,'campaign',id);return json(await getExecution(owner,campaign))}catch(e){return failure(e)}}
export async function POST(req:Request){let owner='',lock='';try{
 owner=await identity(req);secureMutation(req);
 const input=await readBoundedJson<Record<string,unknown>>(req,800000);
 if(!input||typeof input!=='object'||Array.isArray(input))throw new ApiError(400,'입력 형식을 확인하세요.');
 // 게시 코드를 발급하는 발행 준비(A4-2)는 추적 코드 만들기(A4-1)처럼 관리자만 한다. 코드 없는 준비는 그대로다.
 const coded=input.action==='save_publication'&&input.trackingCode!==undefined&&input.trackingCode!==null;
 const who:Actor|null=adminActions.includes(String(input.action))||coded?await requireAdminActor(req):null;
 lock=await acquireLock(owner);
 await executionRate(owner,'execution');
 const campaign=await readRecord<Campaign>(owner,'campaign',str(input.campaignId,'캠페인',100,true));
 // Buffer가 가져갈 앱 공개 주소(/media/<sha256>.png)의 기준 origin. 운영은 AUTH_ORIGIN을 우선한다.
 const origin=authEnv.AUTH_ORIGIN||new URL(req.url).origin;
 if(input.action==='save_limits')return json(await saveLimits(owner,campaign,input));
 if(input.action==='connect_buffer')return json(await connectPublisher(owner,campaign,input));
 if(input.action==='buffer_channels')return json(await listBufferChannels(str(input.token,'Buffer API 키',5000,true),input.organizationId?str(input.organizationId,'Buffer 조직',100,true):undefined));
 if(input.action==='disconnect_buffer')return json(await disconnectPublisher(owner,campaign,input,who!));
 if(input.action==='save_creative')return json(await saveCreative(owner,campaign,input));
 if(input.action==='save_publication')return json(await savePublication(owner,campaign,input,origin,who));
 const p=await publicationFor(owner,campaign,input.id,input.version);
 if(input.action==='approve')return json(await approvePublication(owner,campaign,p,input,who!,origin));
 if(input.action==='cancel')return json(await cancelPublication(owner,campaign,p));
 if(input.action==='reconfirm')return json(await reconfirmPublication(owner,campaign,p,who!));
 if(input.action==='resolve_uncertain')return json(await resolveUncertain(owner,campaign,p,input,who!));
 if(input.action==='execute'){
  const {pending,token}=await reservePublication(owner,campaign,p,origin);
  await releaseLock(owner,lock);lock='';
  let result:Publication;
  try{const remote=await submitBuffer(token,{channelId:pending.channelId!,text:pending.caption,url:pending.mediaUrl,dueAt:pending.scheduledAt});result={...pending,status:providerPublicationStatus(remote.status),providerId:remote.id,providerStatus:remote.status}}
  catch{result={...pending,status:'uncertain',error:'접수 여부를 확인하지 못했습니다. Buffer에서 확인하고 자동 재전송하지 마세요.'}}
  return json(await saveProviderResult(owner,campaign,pending,result));
 }
 if(input.action==='refresh'){
  if(!p.providerId)throw new ApiError(409,'공급자 게시 번호가 없습니다. Buffer에서 접수 여부를 직접 확인하세요. 자동 재전송은 차단됩니다.');
  const credential=await readRecord<PublisherCredential>(owner,'publisher_credential',campaign.brandId);
  if(credential.channelId!==p.channelId)throw new ApiError(409,'원래 발행 계정으로 연결한 뒤 조회하세요.');
  const remote=await inspectBuffer(await decrypt(credential.secret),p.providerId);
  if(remote.channelId!==p.channelId)throw new ApiError(409,'공급자 게시 계정이 다릅니다.');
  const status=providerPublicationStatus(remote.status),review=await externalMediaReview(p,status,origin);
  const updated:Publication={...p,status,providerStatus:remote.status,...(review?{needsReview:review}:{}),version:p.version+1,updatedAt:stamp()};await recordStatement(owner,'execution_publication',p.id,updated,campaign.id).run();
  if(status==='failed')await retireMedia(owner,[p]);
  return json(updated);
 }
 throw new ApiError(400,'지원하지 않는 실행입니다.');
}catch(e){return failure(e instanceof HttpBodyError?new ApiError(e.status,e.message):e)}finally{if(lock)await releaseLock(owner,lock)}}
