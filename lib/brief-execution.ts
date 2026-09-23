import {campaignEvidencePolicy} from './campaign-policy';
import {markUsageOutcomeSafely as markUsageOutcome} from './usage-outcome';
import {brandArchiveContext} from '@/lib/archive-server';
import {evidenceContext,aiBrand} from '@/lib/ai-context';
import {submitHermes,pollHermes,hermesSubmissionStatement} from '@/lib/hermes';
import type {UsageContext} from '@/lib/usage-ledger';
import {learningContext} from '@/lib/learning-server';
import {briefInstructions,parseBrief,emptyPlan,type BriefDraft,type BriefInput} from '@/lib/brief';
import type {Brand,Campaign,Artifact,Metric} from '@/lib/agency';
import {ApiError,str,json,failure,database,recordStatement,readRecord,listRecords,connection,stamp,acquireLock,releaseLock,validateCampaign} from '@/lib/server';
type StoredDraft=BriefDraft&{providerId?:string};
const active=(d:BriefDraft)=>['starting','queued','in_progress','uncertain'].includes(d.status);
const publicDraft=({providerId:_,...draft}:StoredDraft)=>draft;
// 사용량 조인 키(F2a). 브리프 초안은 jobs 행이 없어 초안 id를 실행 단위로 쓴다. 인라인 지시라 스킬 버전은 없다.
const briefUsage=(id:string,d:StoredDraft):UsageContext=>({kind:'brief',submissionId:'brief-'+id,jobId:id,campaignId:d.campaignId??null,campaignVersion:d.campaignVersion??null,brandId:d.input?.brandId||null,storeId:d.input?.storeId||null});
export async function executeBrief(owner:string,b:Record<string,unknown>){let lock='',pending:StoredDraft|undefined;
 try{
 const id=str(b.id,'초안',100,true);if(!/^[a-zA-Z0-9_-]{1,100}$/.test(id))throw new ApiError(400,'초안 번호가 올바르지 않습니다.');
  if(b.action==='load')return json(publicDraft(await readRecord<StoredDraft>(owner,'brief_draft',id)));
  lock=await acquireLock(owner);
  if(b.action==='start'){
   const existing=(await listRecords<StoredDraft>(owner,'brief_draft')).find(d=>d.id===id);if(existing)return json(publicDraft(existing));
   const cfg=await connection(owner);if(cfg.provider!=='hermes')throw new ApiError(409,'캠페인 초안 작성은 HERMES 연결을 사용합니다. 연결 및 설정에서 HERMES를 선택해 주세요.');
   const busy=(await listRecords<BriefDraft>(owner,'brief_draft')).find(active);if(busy)throw new ApiError(409,'이미 작성 중인 HERMES 초안이 있습니다. 대시보드에서 이어서 확인해 주세요.');
   const raw=b.data&&typeof b.data==='object'&&!Array.isArray(b.data)?b.data as Record<string,unknown>:{};const input=validateCampaign({...raw,title:raw.title||'캠페인 초안'}) as BriefInput;input.title=typeof raw.title==='string'?raw.title.trim():'';input.plan={...emptyPlan(),...input.plan};
   let campaignId:string|undefined,campaignVersion:number|undefined;
   if(b.campaignId){const c=await readRecord<Campaign>(owner,'campaign',str(b.campaignId,'캠페인',100,true));if(c.brandId!==input.brandId||c.version!==b.campaignVersion)throw new ApiError(409,'캠페인이 변경됐습니다. 최신 브리프에서 다시 요청하세요.');if(c.storeId){if(input.storeId&&input.storeId!==c.storeId)throw new ApiError(400,'캠페인의 지점이 일치하지 않습니다.');input.storeId=c.storeId;}campaignId=c.id;campaignVersion=c.version}
   if(campaignId){const meeting=await database().prepare("SELECT id FROM jobs WHERE owner=? AND campaign_id=? AND role='meeting' AND status IN ('starting','queued','in_progress','uncertain')").bind(owner,campaignId).first();if(meeting)throw new ApiError(409,'팀 회의가 진행 중입니다. 회의를 완료하거나 중지한 뒤 초안을 작성하세요.');}
   const brand=await readRecord<Brand>(owner,'brand',input.brandId);
   const trialLearning=await learningContext(owner,input);const archive=await brandArchiveContext(owner,brand.id,input.storeId);const evidence=await evidenceContext(database(),owner,{id:campaignId||'',brandId:brand.id,storeId:input.storeId});
   const previous=(await listRecords<Campaign>(owner,'campaign')).filter(c=>c.brandId===brand.id&&c.id!==campaignId&&(!input.storeId||c.storeId===input.storeId)).slice(0,3);
   const relevantIds=new Set(previous.map(c=>c.id));
   const metrics=(await listRecords<Metric>(owner,'metric')).filter(m=>relevantIds.has(m.campaignId)).slice(0,6);
   const artifacts=(await listRecords<Artifact>(owner,'artifact')).filter(a=>relevantIds.has(a.campaignId)&&a.status==='approved'&&['data','quality','insight'].includes(a.role)).slice(0,4).map(a=>({campaignId:a.campaignId,title:a.title,content:a.content.slice(0,2500)}));
   const prepared:StoredDraft={id,input,status:'starting',campaignId,campaignVersion,model:cfg.model,createdAt:stamp(),updatedAt:stamp()};
   await database().batch([recordStatement(owner,'brief_draft',id,prepared),hermesSubmissionStatement(owner,'brief-'+id,{instructions:briefInstructions+'\n'+campaignEvidencePolicy(input),input:JSON.stringify({brand:aiBrand(brand),evidence:{facts:evidence.facts,directives:evidence.directives},brandArchive:archive,currentBrief:input,trialLearning,previousCampaigns:previous.map(c=>({id:c.id,title:c.title,goal:c.goal,plan:c.plan,status:c.status,updatedAt:c.updatedAt})),recordedMetrics:metrics,approvedLearnings:artifacts,contextDate:stamp().slice(0,10)})})]);
   pending=prepared;
   const result=await submitHermes(owner,'brief-'+id,cfg);
   pending={...pending,providerId:result.id,status:'queued',updatedAt:stamp()};await recordStatement(owner,'brief_draft',id,pending).run();return json(publicDraft(pending));
  }
  const draft=await readRecord<StoredDraft>(owner,'brief_draft',id);
  if(!['poll','recover','cancel'].includes(String(b.action)))throw new ApiError(400,'지원하지 않는 초안 작업입니다.');
  if(!active(draft))return json(publicDraft(draft));
  const cfg=await connection(owner);if(cfg.provider!=='hermes')throw new ApiError(409,'이 초안을 작성한 HERMES 연결이 필요합니다.');
  let next={...draft};
  if(!next.providerId){
   if(b.action==='poll'){next.status='uncertain';next.error='HERMES 접수 상태를 다시 확인해 주세요.';await recordStatement(owner,'brief_draft',id,next).run();return json(publicDraft(next))}
   // Reuse the persisted submission and its durable idempotency key, even after an acknowledgement loss.
   const r=await submitHermes(owner,'brief-'+id,cfg);next={...next,providerId:r.id,status:'queued',error:undefined};await recordStatement(owner,'brief_draft',id,next).run();
  }
  const r=await pollHermes(cfg,next.providerId!,b.action==='cancel',30000,owner,briefUsage(id,next));
  next.updatedAt=stamp();next.status=r.status as BriefDraft['status'];next.error=undefined;
  if(r.status==='completed'){
   try{next.result=parseBrief(r.output[0].content[0].text,next.input)}catch(e){next.status='failed';next.error=(e as Error).message}
  }else if(r.status==='failed')next.error='HERMES가 초안 작성을 완료하지 못했습니다. 입력을 유지한 채 다시 요청할 수 있습니다.';
  await recordStatement(owner,'brief_draft',id,next).run();if(['completed','failed','cancelled'].includes(next.status))await markUsageOutcome(owner,'hermes',next.providerId!,next.status==='completed'?'completed':next.status==='cancelled'?'cancelled':r.invalidOutput||r.status==='completed'?'invalid_output':'provider_failed');return json(publicDraft(next));
 }catch(e){
  if(pending){const uncertain=!(e instanceof ApiError)||e.status>=500;pending={...pending,status:uncertain?'uncertain':'failed',error:uncertain?'접수 여부를 확인하지 못했습니다. 같은 요청 확인으로 이어서 복구하세요.':(e as Error).message,updatedAt:stamp()};await recordStatement(owner,'brief_draft',pending.id,pending).run();return json(publicDraft(pending));}
  return failure(e);
 }finally{if(lock)await releaseLock(owner,lock)}
}
