import type {Campaign} from '@/lib/agency';
import {MetaImageError,uploadMetaImage} from '@/lib/meta-image-upload';
import {metaImageSourceBytes,metaImageUploadContext,metaImageUploadJournal,prepareMetaImageUpload,viewMetaImageUpload,type MetaImageUpload} from '@/lib/meta-image-upload-server';
import {metaWriteToken} from '@/lib/meta-write-connection';
import {ApiError,acquireLock,actor,body,failure,json,readRecord,releaseLock,requireAdminActor,secureMutation,str} from '@/lib/server';
export async function GET(req:Request){try{const who=await actor(req),c=await readRecord<Campaign>(who.owner,'campaign',str(new URL(req.url).searchParams.get('campaignId'),'캠페인',100,true));return json(await viewMetaImageUpload(who.owner,c,who.role!=='member'))}catch(e){return failure(e)}}
export async function POST(req:Request){let owner='',lock='';try{
 const who=await requireAdminActor(req);secureMutation(req);const b=await body(req);
 if(!['prepare','upload'].includes(String(b.action))||Object.keys(b).some(k=>!['action','campaignId','campaignVersion','evidenceFingerprint','operationId','expectedVersion','confirmed'].includes(k)))throw new ApiError(400,'지원하지 않는 이미지 업로드 작업입니다.');
 owner=who.owner;lock=await acquireLock(owner);const c=await readRecord<Campaign>(owner,'campaign',str(b.campaignId,'캠페인',100,true)),x=await metaImageUploadContext(owner,c);
 if(!x.enabled||x.issues.length||b.campaignVersion!==c.version||b.evidenceFingerprint!==x.evidenceFingerprint)throw new ApiError(409,'이미지 업로드 기능과 현재 검수·계정을 확인하세요.');
 if(b.action==='prepare')await prepareMetaImageUpload(owner,c,who.id,x);
 else{
  const o=await readRecord<MetaImageUpload>(owner,'meta_ads_image_upload',str(b.operationId,'업로드 작업',100,true));
  if(o.campaignId!==c.id||o.brandId!==c.brandId||o.accountId!==x.writing!.accountId||o.evidenceFingerprint!==x.evidenceFingerprint||o.version!==b.expectedVersion||o.state!=='prepared')throw new ApiError(409,'현재 준비 작업만 한 번 전송할 수 있습니다.');
  if(b.confirmed!==true)throw new ApiError(400,'검수 원본 PNG를 Meta 계정에 업로드할지 확인하세요.');
  const bytes=await metaImageSourceBytes(owner,c,o);await uploadMetaImage(await metaWriteToken(owner,x.writing!),o,bytes,metaImageUploadJournal(owner,o.id,who.id),true);
 }
 return json(await viewMetaImageUpload(owner,c,true));
 }catch(e){return failure(e instanceof MetaImageError?new ApiError(e.code==='unknown'?502:409,e.message):e)}finally{if(lock)await releaseLock(owner,lock)}}
