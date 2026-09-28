import type {Campaign} from '@/lib/agency';
import {metaReadiness} from '@/lib/meta-ads';
import {metaCreativeContext,viewMetaCreative} from '@/lib/meta-creative-server';
import {metaBudgetEnvelope,META_BUDGET_REVIEW_PURPOSE,type MetaBudgetScope,type MetaBudgetReview} from '@/lib/meta-budget-review';
import {readMetaConnection,publicMetaConnection} from '@/lib/meta-read-connection';
import {storefrontDigest} from '@/lib/storefront-orders';
import {ApiError,acquireLock,actor,body,database,failure,json,readRecord,recordStatement,releaseLock,requireOwnerActor,secureMutation,stamp,str} from '@/lib/server';

async function history(owner:string,id:string) {
  const rows=await database().prepare("SELECT data FROM records WHERE owner=? AND kind='meta_ads_budget_review' AND parent_id=? ORDER BY CAST(json_extract(data,'$.version') AS INTEGER) DESC LIMIT 20").bind(owner,id).all<{data:string}>();
  return rows.results.map(r=>JSON.parse(r.data) as MetaBudgetReview);
}
async function view(owner:string,c:Campaign,canEdit:boolean) {
  const [x,connection,records]=await Promise.all([metaCreativeContext(owner,c),readMetaConnection(owner,c.brandId),history(owner,c.id)]);
  const review=viewMetaCreative(c,x,false),p=x.plan?.input,envelope=metaBudgetEnvelope(x.plan);
  const scope:MetaBudgetScope={accountId:connection?.accountId??null,product:p?.product??'',landingUrl:p?.landingUrl??'',startAt:p?.startAt??'',endAt:p?.endAt??'',currency:'KRW',timeZone:'Asia/Seoul',totalBudget:p?.totalBudget??null,dailyTarget:p?.dailyTarget??null,lossLimit:p?.lossLimit??null,safetyReserve:p?.safetyReserve??null,allocatable:envelope.allocatable,stopRule:p?.stopRule??'',creativeId:review.saved?.input.creativeId??null,creativeHash:review.saved?.pngHash??null};
  const issues=[...metaReadiness(x.plan,c.version).missing,...envelope.issues];
  if(!review.reviewValid)issues.push('현재 근거·소재·실험 검토를 먼저 마치세요.');
  if(!connection)issues.push('브랜드 광고 계정 읽기 연결을 먼저 확인하세요.');
  if(c.status==='archived')issues.push('보관된 캠페인은 새 검토를 기록할 수 없습니다.');
  const digest=await storefrontDigest({scope,campaignVersion:c.version,plan:x.plan,review:review.saved,connection:publicMetaConnection(connection)});
  const latest=records[0]??null,current=latest?.action==='review'&&latest.digest===digest&&!issues.length;
  return {scope,digest,issues:[...new Set(issues)],records,version:latest?.version??0,current,canEdit,maySpend:false as const,purpose:META_BUDGET_REVIEW_PURPOSE,
    status:!latest?'not_reviewed':latest.action==='revoke'?'revoked':current?'reviewed':'stale'};
}
export async function GET(req:Request) {
  try {const who=await actor(req),c=await readRecord<Campaign>(who.owner,'campaign',str(new URL(req.url).searchParams.get('campaignId'),'캠페인',100,true));return json(await view(who.owner,c,who.role==='owner'));}catch(e){return failure(e);}
}
export async function POST(req:Request) {
  let owner='',lock='';
  try {
    const who=await requireOwnerActor(req);secureMutation(req);const b=await body(req);
    if(!['review','revoke'].includes(String(b.action))||b.confirmed!==true)throw new ApiError(400,'검토 기록 또는 철회 내용을 명시적으로 확인하세요.');
    owner=who.owner;lock=await acquireLock(owner);
    const c=await readRecord<Campaign>(owner,'campaign',str(b.campaignId,'캠페인',100,true)),v=await view(owner,c,true);
    if(b.expectedVersion!==v.version)throw new ApiError(409,'검토 기록이 변경되었습니다. 다시 불러오세요.');
    if(b.action==='review'&&(b.expectedDigest!==v.digest||v.issues.length))throw new ApiError(409,'현재 계획·소재·계정·기간을 다시 확인하세요. '+v.issues.join(' '));
    if(b.action==='review'&&v.current)return json({...v,duplicate:true});
    const previous=v.records[0];
    if(b.action==='revoke'&&(!previous||previous.action!=='review'))throw new ApiError(409,'철회할 검토 기록이 없습니다.');
    const version=v.version+1,record:MetaBudgetReview={id:c.id+':'+version,campaignId:c.id,brandId:c.brandId,version,action:b.action as 'review'|'revoke',digest:b.action==='revoke'?previous.digest:v.digest,scope:b.action==='revoke'?previous.scope:v.scope,purpose:META_BUDGET_REVIEW_PURPOSE,maySpend:false,actorId:who.id,recordedAt:stamp(),note:str(b.note,'검토 메모',500,true)};
    await recordStatement(owner,'meta_ads_budget_review',record.id,record,c.id).run();
    return json(await view(owner,c,true));
  }catch(e){return failure(e);}finally{if(lock)await releaseLock(owner,lock);}
}
