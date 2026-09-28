import type {Campaign} from '@/lib/agency';
import {createMetaChild,reconcileMetaChild,metaCreateStepNames,MetaCreateError,type MetaCreateStep} from '@/lib/meta-ad-create';
import {metaCreateContext,metaCreateJournal,prepareMetaCreate,viewMetaCreate} from '@/lib/meta-ad-create-server';
import {metaWriteToken} from '@/lib/meta-write-connection';
import {MetaAdBundleError} from '@/lib/meta-ad-bundle';
import {MetaInsightError} from '@/lib/meta-insights';
import {ApiError,acquireLock,actor,body,failure,json,readRecord,releaseLock,requireOwnerActor,secureMutation,str} from '@/lib/server';
export async function GET(req:Request){try{const who=await actor(req),c=await readRecord<Campaign>(who.owner,'campaign',str(new URL(req.url).searchParams.get('campaignId'),'캠페인',100,true));return json(await viewMetaCreate(who.owner,c,who.role==='owner'))}catch(e){return failure(e)}}
export async function POST(req:Request){let owner='',lock='';try{
 const who=await requireOwnerActor(req);secureMutation(req);const b=await body(req);
 if(!['prepare','create','reconcile'].includes(String(b.action))||Object.keys(b).some(k=>!['action','campaignId','campaignVersion','expectedVersion','evidenceFingerprint','input','step','confirmed'].includes(k)))throw new ApiError(400,'지원하지 않는 하위 광고 작업입니다.');
 owner=who.owner;lock=await acquireLock(owner);const c=await readRecord<Campaign>(owner,'campaign',str(b.campaignId,'캠페인',100,true)),x=await metaCreateContext(owner,c);
 if(b.expectedVersion!==(x.saved?.version??0))throw new ApiError(409,'작업 판이 변경되었습니다.');
 if(b.action!=='reconcile'&&(!x.enabled||x.issues.length||b.campaignVersion!==c.version||b.evidenceFingerprint!==x.evidenceFingerprint))throw new ApiError(409,'현재 검수·계정·기능 설정·작업 판을 확인하세요.');
 if(b.action==='prepare')await prepareMetaCreate(owner,c,b.input,who.id,x);
 else{
  if(!x.saved||x.saved.brandId!==c.brandId||b.action!=='reconcile'&&x.saved.evidenceFingerprint!==x.evidenceFingerprint||!metaCreateStepNames.includes(b.step as MetaCreateStep))throw new ApiError(409,'고정된 준비 작업과 단계를 확인하세요.');
  if(!x.image.writing||x.image.writing.brandId!==c.brandId||x.image.writing.accountId!==x.saved.scope.bundle.accountId||x.image.writing.permission!=='ads_management')throw new ApiError(409,'저장된 범위와 같은 브랜드·계정의 쓰기 연결을 확인하세요.');
  if(b.confirmed!==true)throw new ApiError(400,'이 비활성 객체의 생성 또는 조회를 확인하세요.');
  const token=await metaWriteToken(owner,x.image.writing!),journal=metaCreateJournal(owner,c.id,who.id),step=b.step as MetaCreateStep;
  if(b.action==='create')await createMetaChild(token,x.saved.scope,step,x.saved.steps,journal,true);else await reconcileMetaChild(token,x.saved.scope,step,x.saved.steps,journal);
 }
 return json(await viewMetaCreate(owner,c,true));
 }catch(e){return failure(e instanceof MetaCreateError?new ApiError(e.code==='unknown'?502:409,e.message):e instanceof MetaAdBundleError||e instanceof MetaInsightError?new ApiError(400,e.message):e)}finally{if(lock)await releaseLock(owner,lock)}}
