import {identity,requireAdmin,database,secureMutation,readRecord,recordStatement,json,failure,str,stamp,ApiError,acquireLock,releaseLock,decrypt} from '@/lib/server';
import {authPrincipal} from '@/lib/auth-session';
import type {Campaign} from '@/lib/agency';
import {providerPublicationStatus,type Publication} from '@/lib/execution';
import {getExecution,saveLimits,connectPublisher,saveCreative,savePublication,publicationFor,approvePublication,reservePublication,type PublisherCredential} from '@/lib/execution-server';
import {submitBuffer,inspectBuffer} from '@/lib/publisher-buffer';
import {readBoundedJson,HttpBodyError} from '@/lib/http-limits';
import {executionRate} from '@/lib/execution-rate';

export async function GET(req:Request){try{const owner=await identity(req),id=str(new URL(req.url).searchParams.get('campaignId'),'캠페인',100,true),campaign=await readRecord<Campaign>(owner,'campaign',id);return json(await getExecution(owner,campaign))}catch(e){return failure(e)}}
export async function POST(req:Request){let owner='',lock='';try{
 owner=await identity(req);secureMutation(req);
 const input=await readBoundedJson<Record<string,unknown>>(req,800000);
 if(!input||typeof input!=='object'||Array.isArray(input))throw new ApiError(400,'입력 형식을 확인하세요.');
 if(['connect_buffer','save_limits','approve','execute','cancel'].includes(String(input.action)))await requireAdmin(req);
 lock=await acquireLock(owner);
 await executionRate(owner,'execution');
 const campaign=await readRecord<Campaign>(owner,'campaign',str(input.campaignId,'캠페인',100,true));
 if(input.action==='save_limits')return json(await saveLimits(owner,campaign,input));
 if(input.action==='connect_buffer')return json(await connectPublisher(owner,campaign,input));
 if(input.action==='save_creative')return json(await saveCreative(owner,campaign,input));
 if(input.action==='save_publication')return json(await savePublication(owner,campaign,input));
 const p=await publicationFor(owner,campaign,input.id,input.version);
 if(input.action==='approve')return json(await approvePublication(owner,campaign,p,input,(await authPrincipal(req))?.id||owner));
 if(input.action==='cancel'){
  if(p.status!=='draft'&&p.status!=='approved')throw new ApiError(409,'이미 접수한 항목은 Buffer에서 예약 상태와 취소 여부를 확인하세요.');
  const cancelled:Publication={...p,status:'cancelled',version:p.version+1,updatedAt:stamp()};await recordStatement(owner,'execution_publication',p.id,cancelled,campaign.id).run();return json(cancelled);
 }
 if(input.action==='execute'){
  const {pending,token}=await reservePublication(owner,campaign,p);
  await releaseLock(owner,lock);lock='';
  let result:Publication;
  try{const remote=await submitBuffer(token,{channelId:pending.channelId!,text:pending.caption,url:pending.mediaUrl,dueAt:pending.scheduledAt});result={...pending,status:providerPublicationStatus(remote.status),providerId:remote.id,providerStatus:remote.status}}
  catch{result={...pending,status:'uncertain',error:'접수 여부를 확인하지 못했습니다. Buffer에서 확인하고 자동 재전송하지 마세요.'}}
  const saved={...result,version:pending.version+1,updatedAt:stamp()};
  await database().prepare("UPDATE records SET data=?,updated_at=? WHERE owner=? AND kind='execution_publication' AND id=? AND json_extract(data,'$.version')=? AND json_extract(data,'$.status')='submitting'").bind(JSON.stringify(saved),stamp(),owner,`${owner}:execution_publication:${p.id}`,pending.version).run();
  return json(await readRecord<Publication>(owner,'execution_publication',p.id));
 }
 if(input.action==='refresh'){
  if(!p.providerId)throw new ApiError(409,'공급자 게시 번호가 없습니다. Buffer에서 접수 여부를 직접 확인하세요. 자동 재전송은 차단됩니다.');
  const credential=await readRecord<PublisherCredential>(owner,'publisher_credential',campaign.brandId);
  if(credential.channelId!==p.channelId)throw new ApiError(409,'원래 발행 계정으로 연결한 뒤 조회하세요.');
  const remote=await inspectBuffer(await decrypt(credential.secret),p.providerId);
  if(remote.channelId!==p.channelId)throw new ApiError(409,'공급자 게시 계정이 다릅니다.');
  const status=providerPublicationStatus(remote.status);
  const updated:Publication={...p,status,providerStatus:remote.status,version:p.version+1,updatedAt:stamp()};await recordStatement(owner,'execution_publication',p.id,updated,campaign.id).run();return json(updated);
 }
 throw new ApiError(400,'지원하지 않는 실행입니다.');
}catch(e){return failure(e instanceof HttpBodyError?new ApiError(e.status,e.message):e)}finally{if(lock)await releaseLock(owner,lock)}}
