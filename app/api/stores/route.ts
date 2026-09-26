import {getStoreOperations} from '@/lib/store-operations-server';
import {ledgerChanged} from '@/lib/store-operations';
import {actor,identity,secureMutation,body,database,readRecord,listRecords,recordStatement,json,failure,str,uid,stamp,ApiError,acquireLock,releaseLock,eventStatement} from '@/lib/server';
import {storeInput,channelInput,checkedVersion,experimentInput,measurementInput,option,storeRulePromotion,ADOPT_NEEDS_MEASUREMENT,LEDGER_CHANGED} from '@/lib/store-server';
import {obj} from '@/lib/validate';
import {channelCatalog,decisions,storeFields,storeMetricFields,type Store,type StoreChannel,type StoreExperiment,type StoreMeasurement,type StoreReport,type StoreTask} from '@/lib/store-marketing';
import {publicResearch,researchActive,sourceSummary,type ArchiveSource,type BrandResearch} from '@/lib/archive';
import {isRecruitmentObjective,OBJECTIVE_MESSAGES,type Brand,type Campaign,type Artifact} from '@/lib/agency';
import {emptyPlan,storeBriefCopy,storeCopyFields,syncStoreCopy,type StoreCopyKey} from '@/lib/brief';
import {currentFactRefs} from '@/lib/ai-context';
import {sameEvidenceFactRefs} from '@/lib/brand-facts';
export async function GET(req:Request){try{
 const owner=await identity(req),p=new URL(req.url).searchParams,brandId=p.get('brandId'),storeId=p.get('storeId');
 if(brandId)await readRecord<Brand>(owner,'brand',brandId);
 const stores=await listRecords<Store>(owner,'store',brandId||undefined);
 if(!storeId)return json({stores,channels:[],experiments:[],measurements:[],reports:[],tasks:[],research:[],sources:[]});
 const store=await readRecord<Store>(owner,'store',storeId);if(brandId&&store.brandId!==brandId)throw new ApiError(404,'해당 브랜드의 지점이 아닙니다.');
 const [channels,experiments,measurements,reports,tasks,research]=await Promise.all([listRecords(owner,'store_channel',storeId),listRecords(owner,'store_experiment',storeId),listRecords(owner,'store_measurement',storeId),listRecords(owner,'store_report',storeId),listRecords(owner,'store_task',storeId),listRecords<BrandResearch>(owner,'brand_research',store.brandId)]);
 const sourceIds=new Set((reports as StoreReport[]).flatMap(r=>r.sourceIds));const sources=(await listRecords<ArchiveSource>(owner,'brand_source',store.brandId)).filter(s=>sourceIds.has(s.id)&&s.status!=='excluded').map(sourceSummary);
 return json({stores,channels,experiments,measurements,reports,tasks,sources,research:research.filter(r=>r.storeId===storeId).map(publicResearch)});
}catch(e){return failure(e)}}
// 조건부 확대 전에 장부에서 가져온 성과가 그 뒤 바뀌었는지 본다. 회고 저장과 미리보기가 같은 판정을 쓴다.
async function ledgerStale(owner:string,storeId:string,experimentId:string,measurements:StoreMeasurement[]){for(const m of measurements.filter(m=>m.ledgerSnapshot)){const ops=await getStoreOperations(owner,storeId,m.periodStart,m.periodEnd);if(ledgerChanged(m.ledgerSnapshot!,ops.orders.filter(o=>o.experimentId===experimentId),ops.spend.filter(s=>s.experimentId===experimentId)))return true}return false}
export async function POST(req:Request){let lock='',owner='';try{
 const who=await actor(req),by={id:who.id,email:who.email};owner=who.owner;secureMutation(req);const b=await body(req);
 // 회고 저장 전 승격 미리보기(loop-7). 읽기만 하므로 저장 잠금을 잡지 않는다. 입력 중 미리보기가 저장과 겹쳐 409를 내지 않게 한다.
 if(b.action==='preview_close'){
  const store=await readRecord<Store>(owner,'store',str(b.storeId,'지점',100,true)),experiment=await readRecord<StoreExperiment>(owner,'store_experiment',str(b.experimentId,'실험',100,true));if(experiment.storeId!==store.id)throw new ApiError(400,'다른 지점의 실험입니다.');
  const r=obj(b.review),review=b.review?{evidenceLevel:option(r.evidenceLevel,['observation','comparison','repeated'] as const,'근거 수준'),failureType:'none',confounders:'',nextAction:str(r.nextAction??'','다음 행동',2000),conditions:''}:undefined;
  const measurements=(await listRecords<StoreMeasurement>(owner,'store_measurement',store.id)).filter(m=>m.experimentId===experiment.id);
  const decision=option(b.decision,Object.keys(decisions) as (keyof typeof decisions)[],'회고 판단'),{rule,reasons,blocked}=storeRulePromotion(experiment,decision,'',review,measurements);
  // 저장이 409로 거절되는 경우(장부 변경·핵심 지표 기록 없는 조건부 확대)는 저장과 같은 순서·문구로 blocked에 담는다(R3).
  const stop=decision==='adopt'&&await ledgerStale(owner,store.id,experiment.id,measurements)?LEDGER_CHANGED:blocked;
  return json({promoted:!!rule&&!stop,reasons,...(stop?{blocked:stop}:{})});
 }
 lock=await acquireLock(owner);const db=database();
 if(b.action==='save_store'){
  const brandId=str(b.brandId,'브랜드',100,true);await readRecord<Brand>(owner,'brand',brandId);
  const old=b.id?await readRecord<Store>(owner,'store',str(b.id,'지점',100,true)):undefined;
  if(old){checkedVersion(old,b.version);if(old.brandId!==brandId)throw new ApiError(400,'지점의 브랜드를 변경할 수 없습니다.');if(old.status==='archived')throw new ApiError(409,'보관한 지점입니다.');}
  else if((await listRecords(owner,'store',brandId)).length>=100)throw new ApiError(400,'브랜드당 지점은 최대 100개입니다.');
  const store:Store={...storeInput(b.data||{}),id:old?.id||uid(),brandId,status:'active',version:(old?.version||0)+1,createdAt:old?.createdAt||stamp(),updatedAt:stamp()};
  const writes=[recordStatement(owner,'store',store.id,store,brandId)];
  // 지점 값이 실제로 바뀐 경우에만 연결 캠페인에 반영한다. 손대지 않은 복사 필드를 갱신하면 브리프 새 버전·작업물 재작성, 브리프가 그대로면 작업물에 변경 표시만 남긴다.
  const changed=!!old&&[...Object.keys(storeFields),'tradeArea'].some(k=>old[k as keyof Store]!==store[k as keyof Store]),labels=(keys:StoreCopyKey[])=>keys.map(k=>storeCopyFields[k]).join(', ');
  if(old&&changed){for(const c of (await listRecords<Campaign>(owner,'campaign')).filter(c=>c.storeId===old.id)){const active=await db.prepare("SELECT id FROM jobs WHERE owner=? AND campaign_id=? AND status IN ('starting','queued','in_progress','uncertain')").bind(owner,c.id).first();if(active)throw new ApiError(409,'해당 지점의 캠페인 AI 작업이 끝난 뒤 지점 정보를 변경하세요.');
   const sync=syncStoreCopy(c,old,store),artifacts=await listRecords<Artifact>(owner,'artifact',c.id);
   writes.push(eventStatement(owner,c.id,'지점 정보 변경 · '+(sync.updated.length?`브리프 자동 갱신: ${labels(sync.updated)}. `:'')+(sync.conflicts.length?`직접 수정해 갱신하지 않은 항목(충돌): ${labels(sync.conflicts)}. `:'')+(sync.updated.length?'브리프와 기존 작업물을 다시 검토하세요.':'브리프는 그대로 두었습니다. 기존 작업물이 지점 정보와 맞는지 검토하세요.'),by,{storeSync:{updated:sync.updated,conflicts:sync.conflicts}}));
   if(sync.updated.length){writes.push(recordStatement(owner,'campaign',c.id,{...sync.campaign,status:'draft',version:c.version+1,updatedAt:stamp()}));for(const a of artifacts)writes.push(recordStatement(owner,'artifact',a.id,{...a,status:'outdated'},c.id));}
   else for(const a of artifacts.filter(a=>a.status!=='outdated'))writes.push(recordStatement(owner,'artifact',a.id,{...a,brandChanged:true},c.id));}}
  await db.batch(writes);return json({id:store.id});
 }
 const store=await readRecord<Store>(owner,'store',str(b.storeId,'지점',100,true));if(store.status!=='active')throw new ApiError(409,'보관한 지점입니다.');
 if(b.action==='archive_store'){
  checkedVersion(store,b.version);const research=await listRecords<BrandResearch>(owner,'brand_research',store.brandId);const experiments=await listRecords<StoreExperiment>(owner,'store_experiment',store.id);
  if(research.some(r=>r.storeId===store.id&&researchActive(r))||experiments.some(e=>e.status==='running'))throw new ApiError(409,'진행 중인 지점 조사·실험을 종료한 뒤 보관하세요.');
  await recordStatement(owner,'store',store.id,{...store,status:'archived',version:store.version+1,updatedAt:stamp()},store.brandId).run();return json({id:store.id});
 }
 if(b.action==='link_store'){
  // 기존 캠페인을 같은 브랜드의 지점에 한 번만 연결한다. 연결 뒤 지점 사실·운영 정보가 AI 팀에 전달되므로 현재 작업물 모두에 검토 표시(brandChanged)를, 입력 사실이 달라진 작업물에는 사실 변경 표시를 남긴다.
  // 제작·발행 기록이 있으면 연결하지 않는다. 기존 소재는 지점 없이 만들어져 연결 뒤 접수할 수 없다(R4).
  const campaign=await readRecord<Campaign>(owner,'campaign',str(b.campaignId,'캠페인',100,true));if(campaign.brandId!==store.brandId)throw new ApiError(400,'브랜드와 지점이 일치하지 않습니다.');
  if(campaign.storeId)throw new ApiError(409,'이미 지점에 연결된 캠페인입니다. 연결한 지점은 바꿀 수 없습니다.');if(isRecruitmentObjective(campaign))throw new ApiError(400,OBJECTIVE_MESSAGES.withStore);checkedVersion(campaign,b.version);
  if(await db.prepare("SELECT id FROM jobs WHERE owner=? AND campaign_id=? AND status IN ('starting','queued','in_progress','uncertain')").bind(owner,campaign.id).first())throw new ApiError(409,'캠페인 AI 작업이 끝난 뒤 지점을 연결하세요.');
  if(await db.prepare("SELECT id FROM records WHERE owner=? AND parent_id=? AND kind IN ('execution_creative','execution_publication') LIMIT 1").bind(owner,campaign.id).first())throw new ApiError(409,'제작·발행 기록이 있는 캠페인은 지점에 연결할 수 없습니다. 기존 소재는 지점 정보 없이 만들어져 연결 뒤 발행할 수 없습니다. 지점 캠페인을 새로 만들어 제작하세요.');
  const linked:Campaign={...campaign,storeId:store.id,updatedAt:stamp()},refs=await currentFactRefs(db,owner,linked);
  const writes=[recordStatement(owner,'campaign',campaign.id,linked),eventStatement(owner,campaign.id,`지점 연결 · ${store.name}. 이 지점의 사실·운영 정보가 AI 팀에 전달됩니다. 기존 작업물이 지점 정보와 맞는지 검토하세요.`,by)];
  for(const a of await listRecords<Artifact>(owner,'artifact',campaign.id))if(a.status!=='outdated')writes.push(recordStatement(owner,'artifact',a.id,{...a,brandChanged:true,...(Array.isArray(a.factRefs)&&!sameEvidenceFactRefs(a.factRefs,refs)?{factsChanged:true}:{})},campaign.id));
  await db.batch(writes);return json({id:campaign.id,storeId:store.id});
 }
 if(b.action==='save_channel'){
  const old=(await listRecords<StoreChannel>(owner,'store_channel',store.id)).find(c=>c.key===b.data?.key);if(old)checkedVersion(old,b.version);else if(b.version)throw new ApiError(409,'채널 기록을 새로고침하세요.');
  const channel=channelInput(b.data,store.id,old);await recordStatement(owner,'store_channel',channel.id,channel,store.id).run();return json({id:channel.id});
 }
 if(b.action==='save_task'){
  const report=await readRecord<StoreReport>(owner,'store_report',str(b.reportId,'진단',100,true));if(report.storeId!==store.id)throw new ApiError(400,'다른 지점의 진단입니다.');
  if(!Number.isInteger(b.index)||!report.actions[b.index])throw new ApiError(400,'수정 과제를 선택하세요.');
  const id=report.id+'-'+b.index,old=(await listRecords<StoreTask>(owner,'store_task',store.id)).find(t=>t.id===id);if(old)checkedVersion(old,b.version);
  const status=option(b.status,['open','done'] as const,'처리 상태'),evidence=str(b.evidence??'','완료 근거',3000,status==='done');
  const task:StoreTask={id,storeId:store.id,reportId:report.id,title:report.actions[b.index].action,channel:report.actions[b.index].channel,status,evidence,version:(old?.version||0)+1,updatedAt:stamp()};await recordStatement(owner,'store_task',id,task,store.id).run();return json({id});
 }
 if(b.action==='save_experiment'){
  const old=b.id?await readRecord<StoreExperiment>(owner,'store_experiment',str(b.id,'실험',100,true)):undefined;
  if(old){if(old.storeId!==store.id)throw new ApiError(400,'다른 지점의 실험입니다.');checkedVersion(old,b.version);if(old.campaignId&&(await listRecords<Campaign>(owner,'campaign')).some(c=>c.id===old.campaignId))throw new ApiError(409,'캠페인에 연결한 설계는 보존됩니다. 후속 실험으로 변경하세요.');if(old.status!=='draft')throw new ApiError(409,'시작한 실험의 설계는 변경할 수 없습니다. 새 실험으로 기록하세요.');}
  let reportId: string|undefined;
  if(b.reportId){const report=await readRecord<StoreReport>(owner,'store_report',str(b.reportId,'진단',100,true));if(report.storeId!==store.id||report.storeVersion!==store.version)throw new ApiError(409,'현재 지점 정보와 일치하는 진단에서 실험을 만드세요.');const sourceIds=new Set((await listRecords<ArchiveSource>(owner,'brand_source',store.brandId)).filter(s=>s.status!=='excluded'&&(!s.storeId||s.storeId===store.id)).map(s=>s.id));if(report.sourceIds.some(id=>!sourceIds.has(id)))throw new ApiError(409,'진단 근거가 변경되었습니다. 다시 조사한 뒤 실험으로 연결하세요.');reportId=report.id;}
  let parentExperimentId=old?.parentExperimentId;
  if(b.parentExperimentId){const parent=await readRecord<StoreExperiment>(owner,'store_experiment',str(b.parentExperimentId,'이전 실험',100,true));if(parent.storeId!==store.id||parent.status!=='completed')throw new ApiError(400,'같은 지점의 회고 완료 실험에서 이어가세요.');parentExperimentId=parent.id;}
  const experiment:StoreExperiment={...old,parentExperimentId,...experimentInput(b.data||{}),id:old?.id||uid(),storeId:store.id,brandId:store.brandId,reportId:reportId||old?.reportId,status:'draft',version:(old?.version||0)+1,createdAt:old?.createdAt||stamp(),updatedAt:stamp()};
  await recordStatement(owner,'store_experiment',experiment.id,experiment,store.id).run();return json({id:experiment.id});
 }
 const experiment=await readRecord<StoreExperiment>(owner,'store_experiment',str(b.experimentId,'실험',100,true));if(experiment.storeId!==store.id)throw new ApiError(400,'다른 지점의 실험입니다.');
 if(b.action==='create_campaign'){
  if(experiment.campaignId){const known=(await listRecords<Campaign>(owner,'campaign')).find(c=>c.id===experiment.campaignId);if(known)return json({id:known.id});}
  if(experiment.status==='draft'&&(!experiment.startDate||!experiment.endDate||!experiment.control||!experiment.treatment||!experiment.measurement||!experiment.stopRule||experiment.budget===null||experiment.target===null))throw new ApiError(400,'캠페인 연결 전 실험의 기간·조건·측정·판단 기준·예산·목표값을 정하세요.');
  const copy=storeBriefCopy(store),plan={...emptyPlan(),behavior:copy.behavior,kpi:storeMetricFields[experiment.primaryMetric],target:experiment.target===null?'':String(experiment.target),hypothesis:experiment.hypothesis,experiment:'비교 조건: '+experiment.control+'\n변경 조건: '+experiment.treatment,tracking:experiment.measurement,decision:experiment.stopRule,operations:copy.operations,message:experiment.offer,learning:experiment.learning||''};
  const campaign:Campaign={id:uid(),storeId:store.id,storeExperimentId:experiment.id,brandId:store.brandId,title:store.name+' · '+experiment.title,goal:copy.goal,audience:copy.audience,channels:channelCatalog.find(c=>c.key===experiment.channel)!.name,stores:copy.stores,products:copy.products,budget:experiment.budget,...(experiment.budget===null?{}:{budgetConfirmedAt:stamp()}),startDate:experiment.startDate,endDate:experiment.endDate,constraints:copy.constraints,sources:'지점 정보 v'+store.version+' · 실험 설계 v'+experiment.version+' · 사용자 입력 및 미검증 가설',plan,status:'draft',version:1,createdAt:stamp(),updatedAt:stamp()};
  await db.batch([recordStatement(owner,'campaign',campaign.id,campaign),recordStatement(owner,'store_experiment',experiment.id,{...experiment,campaignId:campaign.id,version:experiment.version+1,updatedAt:stamp()},store.id),eventStatement(owner,campaign.id,'점포 실험에서 캠페인 브리프를 만들었습니다.',by)]);return json({id:campaign.id});
 }
 if(b.action==='start_experiment'){
  checkedVersion(experiment,b.version);if(experiment.status!=='draft')throw new ApiError(409,'설계 중인 실험만 시작할 수 있습니다.');
  if(!experiment.startDate||!experiment.endDate||!experiment.control||!experiment.treatment||!experiment.measurement||!experiment.stopRule||experiment.budget===null||experiment.target===null)throw new ApiError(400,'기간·비교 조건·변경 조건·측정 방법·판단 기준·예산·목표값을 먼저 정하세요.');
  await recordStatement(owner,'store_experiment',experiment.id,{...experiment,status:'running',version:experiment.version+1,updatedAt:stamp()},store.id).run();return json({id:experiment.id});
 }
 if(b.action==='save_measurement'){
  if(experiment.status!=='running')throw new ApiError(409,'실험을 시작한 뒤 성과를 기록하세요. 회고를 완료한 기록은 보존됩니다.');
  const old=b.id?await readRecord<StoreMeasurement>(owner,'store_measurement',str(b.id,'성과',100,true)):undefined;if(old){if(old.experimentId!==experiment.id)throw new ApiError(400,'다른 실험의 성과입니다.');checkedVersion(old,b.version);if(old.ledgerSnapshot)throw new ApiError(409,'장부 성과는 장부에서 다시 가져와 수정하세요.');}
  const measurement=measurementInput(b.data||{},experiment,old),all=await listRecords<StoreMeasurement>(owner,'store_measurement',store.id);
  if(all.some(m=>m.experimentId===experiment.id&&(m.scope??'experiment')===measurement.scope&&m.id!==measurement.id&&m.periodStart<=measurement.periodEnd&&m.periodEnd>=measurement.periodStart))throw new ApiError(409,'같은 실험에 겹치는 기간의 기록이 있습니다. 기존 기록을 수정하거나 기간을 나누세요.');
  await recordStatement(owner,'store_measurement',measurement.id,measurement,store.id).run();return json({id:measurement.id});
 }
 if(b.action==='close_experiment'){
  checkedVersion(experiment,b.version);if(experiment.status!=='running')throw new ApiError(409,'진행 중인 실험만 회고할 수 있습니다.');
  const decision=option(b.decision,Object.keys(decisions) as (keyof typeof decisions)[],'회고 판단'),learning=str(b.learning,'결과·혼란 요인·다음 실험',5000,true);
  const measurements=(await listRecords<StoreMeasurement>(owner,'store_measurement',store.id)).filter(m=>m.experimentId===experiment.id);
  const review=b.review?{evidenceLevel:option(b.review.evidenceLevel,['observation','comparison','repeated'] as const,'근거 수준'),failureType:option(b.review.failureType,['none','collection','execution','measurement','insufficient','economics','negative'] as const,'문제 구분'),confounders:str(b.review.confounders??'','다른 설명',2000),nextAction:str(b.review.nextAction,'다음 행동',2000,true),conditions:str(b.review.conditions??'','적용 조건',2000)}:undefined;
  if(decision==='adopt'&&await ledgerStale(owner,store.id,experiment.id,measurements))throw new ApiError(409,LEDGER_CHANGED);
  if(decision==='adopt'&&!measurements.some(m=>(m.scope??'experiment')==='experiment'&&m.values[experiment.primaryMetric]!==null))throw new ApiError(409,ADOPT_NEEDS_MEASUREMENT);
  const closed:StoreExperiment={...experiment,status:'completed',decision,learning,review,version:experiment.version+1,updatedAt:stamp()};
  // 회고를 학습 규칙으로 승격한다. 게이트를 통과하지 못하면 규칙 없이 회고만 저장된다.
  const {rule,reasons}=storeRulePromotion(closed,decision,learning,review,measurements);
  const writes=[recordStatement(owner,'store_experiment',experiment.id,closed,store.id)];
  if(rule){writes.push(recordStatement(owner,'learning_rule',rule.id,rule,rule.brandId));if(closed.campaignId)writes.push(eventStatement(owner,closed.campaignId,`「${closed.title}」 회고를 ${rule.direction==='test'?'시험 적용 규칙':'주의사항'}으로 승격했습니다. 30일 후 재검토합니다.`,by));}
  // 규칙이 되지 않았으면 그 사유를 함께 돌려준다. 화면은 ruleId 유무로 승격 여부를 알린다.
  await database().batch(writes);return json({id:experiment.id,ruleId:rule?.id,...(rule?{}:{reasons})});
 }
 throw new ApiError(400,'지원하지 않는 점포 작업입니다.');
}catch(e){return failure(e)}finally{if(lock)await releaseLock(owner,lock)}}
