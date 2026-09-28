import type {Campaign} from '@/lib/agency';
import {MetaAdBundleError,parseMetaAdBundle,verifyMetaAdBundle} from '@/lib/meta-ad-bundle';
import {metaAdBundleContext,metaAdBundleScope,viewMetaAdBundle,type MetaAdBundle} from '@/lib/meta-ad-bundle-server';
import {metaReadToken} from '@/lib/meta-read-connection';
import {MetaInsightError} from '@/lib/meta-insights';
import {storefrontDigest} from '@/lib/storefront-orders';
import {ApiError,acquireLock,actor,body,database,failure,json,readRecord,recordStatement,releaseLock,requireOwnerActor,secureMutation,stamp,str} from '@/lib/server';
export async function GET(req:Request){try{const who=await actor(req),c=await readRecord<Campaign>(who.owner,'campaign',str(new URL(req.url).searchParams.get('campaignId'),'캠페인',100,true));return json(await viewMetaAdBundle(who.owner,c,who.role==='owner'))}catch(e){return failure(e)}}
async function save(owner:string,old:MetaAdBundle|null,next:MetaAdBundle){
 if(!old){await recordStatement(owner,'meta_ads_bundle',next.id,next,next.campaignId).run();return}
 const r=await database().prepare("UPDATE records SET data=?,updated_at=? WHERE owner=? AND kind='meta_ads_bundle' AND id=? AND data=?").bind(JSON.stringify(next),next.updatedAt,owner,`${owner}:meta_ads_bundle:${next.id}`,JSON.stringify(old)).run();if(!r.meta.changes)throw new ApiError(409,'패키지가 변경되었습니다. 다시 조회하세요.');
}
export async function POST(req:Request){let owner='',lock='';try{
 const who=await requireOwnerActor(req);secureMutation(req);const b=await body(req);
 if(!['prepare','review','verify'].includes(String(b.action)))throw new ApiError(400,'지원하지 않는 패키지 작업입니다.');
 const allowed=['action','campaignId','campaignVersion','expectedVersion','evidenceFingerprint','input','confirmed'];if(Object.keys(b).some(k=>!allowed.includes(k)))throw new ApiError(400,'지원하지 않는 패키지 설정입니다.');
 owner=who.owner;lock=await acquireLock(owner);const c=await readRecord<Campaign>(owner,'campaign',str(b.campaignId,'캠페인',100,true)),x=await metaAdBundleContext(owner,c);
 if(!x.enabled)throw new ApiError(409,'실행 패키지 기능이 꺼져 있습니다.');
 if(b.campaignVersion!==c.version||b.expectedVersion!==(x.saved?.version??0)||b.evidenceFingerprint!==x.evidenceFingerprint||x.issues.length)throw new ApiError(409,'현재 계획·검수·계정·패키지 판을 다시 확인하세요.');
 const now=stamp();
 if(b.action==='prepare'){
  const input=parseMetaAdBundle(b.input);metaAdBundleScope(c,x,input);
  await save(owner,x.saved,{id:c.id,campaignId:c.id,brandId:c.brandId,campaignVersion:c.version,version:(x.saved?.version??0)+1,input,evidenceFingerprint:x.evidenceFingerprint,status:'prepared',verifiedScope:null,reviewedBy:null,reviewedAt:null,updatedAt:now,updatedBy:who.id});
 }else{
  const old=x.saved;if(!old||old.brandId!==c.brandId||old.campaignId!==c.id||old.evidenceFingerprint!==x.evidenceFingerprint)throw new ApiError(409,'현재 근거로 패키지를 다시 준비하세요.');
  if(b.confirmed!==true)throw new ApiError(400,'소재 화면·계보·타깃·예산 단위를 대조한 뒤 확인하세요.');
  const scope=metaAdBundleScope(c,x,old.input),next={...old,version:old.version+1,updatedAt:now,updatedBy:who.id,verifiedScope:null};
  if(b.action==='review')await save(owner,old,{...next,status:'reviewed',reviewedBy:who.id,reviewedAt:now});
  else{
   if(!['reviewed','verified','unknown'].includes(old.status)||!old.reviewedAt)throw new ApiError(409,'패키지를 먼저 검토하세요.');
   // Invalidate earlier read-back before I/O. A timeout/crash cannot leave a usable old verification.
   const pending:MetaAdBundle={...next,status:'unknown'};await save(owner,old,pending);
   const verified=await verifyMetaAdBundle(await metaReadToken(owner,x.connection!),scope),fresh=await metaAdBundleContext(owner,await readRecord<Campaign>(owner,'campaign',c.id));
   if(fresh.evidenceFingerprint!==x.evidenceFingerprint||fresh.issues.length||!fresh.enabled)throw new ApiError(409,'조회 중 근거·계정·기능 설정이 변경되었습니다. 다시 준비하세요.');
   await save(owner,pending,{...pending,version:pending.version+1,status:'verified',verifiedScope:{...verified,scopeDigest:await storefrontDigest({scope,evidenceFingerprint:x.evidenceFingerprint})}});
  }
 }
 return json(await viewMetaAdBundle(owner,c,true));
 }catch(e){return failure(e instanceof MetaAdBundleError?new ApiError(e.code==='invalid'?400:e.code==='unknown'?502:409,e.message):e instanceof MetaInsightError?new ApiError(400,e.message):e)}finally{if(lock)await releaseLock(owner,lock)}}
