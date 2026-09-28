import type {Campaign} from '@/lib/agency';
import {emptyMetaPlan,metaReadiness,parseMetaPlan,type MetaPlan} from '@/lib/meta-ads';
import {ApiError,acquireLock,actor,body,database,eventStatement,failure,json,readRecord,recordStatement,releaseLock,requireAdminActor,secureMutation,stamp,str} from '@/lib/server';
async function read(owner:string,id:string){try{return await readRecord<MetaPlan>(owner,'meta_ads_plan',id)}catch(e){if(e instanceof ApiError&&e.status===404)return null;throw e}}
function view(plan:MetaPlan|null,campaign:Campaign,canEdit:boolean){return {plan,input:plan?.input??emptyMetaPlan(),campaignVersion:campaign.version,version:plan?.version??0,canEdit,readiness:metaReadiness(plan,campaign.version),links:{brandId:campaign.brandId,campaignId:campaign.id,storeId:campaign.storeId??null,storeExperimentId:campaign.storeExperimentId??null,orderLedger:'store_order'}}}
export async function GET(req:Request){try{const who=await actor(req),id=str(new URL(req.url).searchParams.get('campaignId'),'캠페인',100,true),c=await readRecord<Campaign>(who.owner,'campaign',id);return json(view(await read(who.owner,id),c,who.role!=='member'))}catch(e){return failure(e)}}
export async function POST(req:Request){let owner='',lock='';try{
 const who=await requireAdminActor(req);secureMutation(req);const b=await body(req);
 if(b.action!=='save_plan')throw new ApiError(400,'현재는 광고 준비 계획 저장만 지원합니다. 집행 승인은 별도입니다.');
 const parsed=parseMetaPlan(b.input);if(parsed.errors.length)throw new ApiError(400,parsed.errors.join(' '));
 owner=who.owner;lock=await acquireLock(owner);
 const c=await readRecord<Campaign>(owner,'campaign',str(b.campaignId,'캠페인',100,true)),old=await read(owner,c.id);
 if(b.expectedVersion!==(old?.version??0)||b.campaignVersion!==c.version)throw new ApiError(409,'다른 변경이 있습니다. 최신 계획과 캠페인을 다시 불러온 뒤 저장하세요.');
 if(c.status==='archived')throw new ApiError(409,'보관한 캠페인은 광고 계획을 변경할 수 없습니다.');
 const plan:MetaPlan={id:c.id,campaignId:c.id,brandId:c.brandId,campaignVersion:c.version,version:(old?.version??0)+1,input:parsed.input,updatedAt:stamp(),updatedBy:{id:who.id,role:who.role}};
 await database().batch([recordStatement(owner,'meta_ads_plan',c.id,plan,c.id),eventStatement(owner,c.id,`Meta 광고 준비 계획 v${plan.version} 저장 · 집행 미승인`,{id:who.id,email:who.email})]);
 return json(view(plan,c,true));
 }catch(e){return failure(e)}finally{if(lock)await releaseLock(owner,lock)}}
