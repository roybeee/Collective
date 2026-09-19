import {getStoreOperations} from '@/lib/store-operations-server';
import {ledgerChanged} from '@/lib/store-operations';
import {identity,secureMutation,body,database,readRecord,listRecords,recordStatement,json,failure,str,uid,stamp,ApiError,acquireLock,releaseLock,eventStatement} from '@/lib/server';
import {storeInput,channelInput,checkedVersion,experimentInput,measurementInput,option} from '@/lib/store-server';
import {channelCatalog,decisions,storeMetricFields,type Store,type StoreChannel,type StoreExperiment,type StoreMeasurement,type StoreReport,type StoreTask} from '@/lib/store-marketing';
import {publicResearch,researchActive,sourceSummary,type ArchiveSource,type BrandResearch} from '@/lib/archive';
import type {Brand,Campaign,Artifact} from '@/lib/agency';
import {emptyPlan} from '@/lib/brief';
export async function GET(req:Request){try{
 const owner=identity(req),p=new URL(req.url).searchParams,brandId=p.get('brandId'),storeId=p.get('storeId');
 if(brandId)await readRecord<Brand>(owner,'brand',brandId);
 const stores=await listRecords<Store>(owner,'store',brandId||undefined);
 if(!storeId)return json({stores,channels:[],experiments:[],measurements:[],reports:[],tasks:[],research:[],sources:[]});
 const store=await readRecord<Store>(owner,'store',storeId);if(brandId&&store.brandId!==brandId)throw new ApiError(404,'해당 브랜드의 지점이 아닙니다.');
 const [channels,experiments,measurements,reports,tasks,research]=await Promise.all([listRecords(owner,'store_channel',storeId),listRecords(owner,'store_experiment',storeId),listRecords(owner,'store_measurement',storeId),listRecords(owner,'store_report',storeId),listRecords(owner,'store_task',storeId),listRecords<BrandResearch>(owner,'brand_research',store.brandId)]);
 const sourceIds=new Set((reports as StoreReport[]).flatMap(r=>r.sourceIds));const sources=(await listRecords<ArchiveSource>(owner,'brand_source',store.brandId)).filter(s=>sourceIds.has(s.id)&&s.status!=='excluded').map(sourceSummary);
 return json({stores,channels,experiments,measurements,reports,tasks,sources,research:research.filter(r=>r.storeId===storeId).map(publicResearch)});
}catch(e){return failure(e)}}
export async function POST(req:Request){let lock='',owner='';try{
 owner=identity(req);secureMutation(req);const b=await body(req);lock=await acquireLock(owner);const db=database();
 if(b.action==='save_store'){
  const brandId=str(b.brandId,'브랜드',100,true);await readRecord<Brand>(owner,'brand',brandId);
  const old=b.id?await readRecord<Store>(owner,'store',str(b.id,'지점',100,true)):undefined;
  if(old){checkedVersion(old,b.version);if(old.brandId!==brandId)throw new ApiError(400,'지점의 브랜드를 변경할 수 없습니다.');if(old.status==='archived')throw new ApiError(409,'보관한 지점입니다.');}
  else if((await listRecords(owner,'store',brandId)).length>=100)throw new ApiError(400,'브랜드당 지점은 최대 100개입니다.');
  const store:Store={...storeInput(b.data||{}),id:old?.id||uid(),brandId,status:'active',version:(old?.version||0)+1,createdAt:old?.createdAt||stamp(),updatedAt:stamp()};
  const writes=[recordStatement(owner,'store',store.id,store,brandId)];
  if(old){for(const c of (await listRecords<Campaign>(owner,'campaign')).filter(c=>c.storeId===old.id)){const active=await db.prepare("SELECT id FROM jobs WHERE owner=? AND campaign_id=? AND status IN ('starting','queued','in_progress','uncertain')").bind(owner,c.id).first();if(active)throw new ApiError(409,'해당 지점의 캠페인 AI 작업이 끝난 뒤 지점 정보를 변경하세요.');writes.push(recordStatement(owner,'campaign',c.id,{...c,status:'draft',version:c.version+1,updatedAt:stamp()}),eventStatement(owner,c.id,'지점 정보 변경 · 브리프의 메뉴·운영 조건과 기존 작업물을 다시 검토하세요.'));for(const a of await listRecords<Artifact>(owner,'artifact',c.id))writes.push(recordStatement(owner,'artifact',a.id,{...a,status:'outdated'},c.id));}}
  await db.batch(writes);return json({id:store.id});
 }
 const store=await readRecord<Store>(owner,'store',str(b.storeId,'지점',100,true));if(store.status!=='active')throw new ApiError(409,'보관한 지점입니다.');
 if(b.action==='archive_store'){
  checkedVersion(store,b.version);const research=await listRecords<BrandResearch>(owner,'brand_research',store.brandId);const experiments=await listRecords<StoreExperiment>(owner,'store_experiment',store.id);
  if(research.some(r=>r.storeId===store.id&&researchActive(r))||experiments.some(e=>e.status==='running'))throw new ApiError(409,'진행 중인 지점 조사·실험을 종료한 뒤 보관하세요.');
  await recordStatement(owner,'store',store.id,{...store,status:'archived',version:store.version+1,updatedAt:stamp()},store.brandId).run();return json({id:store.id});
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
  const plan={...emptyPlan(),behavior:store.goal,kpi:storeMetricFields[experiment.primaryMetric],target:experiment.target===null?'':String(experiment.target),hypothesis:experiment.hypothesis,experiment:'비교 조건: '+experiment.control+'\n변경 조건: '+experiment.treatment,tracking:experiment.measurement,decision:experiment.stopRule,operations:[store.menu,store.hours,store.access,store.capacity,store.economics].filter(Boolean).join('\n'),message:experiment.offer,learning:experiment.learning||''};
  const campaign:Campaign={id:uid(),storeId:store.id,storeExperimentId:experiment.id,brandId:store.brandId,title:store.name+' · '+experiment.title,goal:store.goal,audience:store.customer,channels:channelCatalog.find(c=>c.key===experiment.channel)!.name,stores:store.name+' · '+store.address,products:store.menu,budget:experiment.budget??0,startDate:experiment.startDate,endDate:experiment.endDate,constraints:store.economics,sources:'지점 정보 v'+store.version+' · 실험 설계 v'+experiment.version+' · 사용자 입력 및 미검증 가설',plan,status:'draft',version:1,createdAt:stamp(),updatedAt:stamp()};
  await db.batch([recordStatement(owner,'campaign',campaign.id,campaign),recordStatement(owner,'store_experiment',experiment.id,{...experiment,campaignId:campaign.id,version:experiment.version+1,updatedAt:stamp()},store.id),eventStatement(owner,campaign.id,'점포 실험에서 캠페인 브리프를 만들었습니다.')]);return json({id:campaign.id});
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
  if(all.some(m=>m.experimentId===experiment.id&&m.id!==measurement.id&&m.periodStart<=measurement.periodEnd&&m.periodEnd>=measurement.periodStart))throw new ApiError(409,'같은 실험에 겹치는 기간의 기록이 있습니다. 기존 기록을 수정하거나 기간을 나누세요.');
  await recordStatement(owner,'store_measurement',measurement.id,measurement,store.id).run();return json({id:measurement.id});
 }
 if(b.action==='close_experiment'){
  checkedVersion(experiment,b.version);if(experiment.status!=='running')throw new ApiError(409,'진행 중인 실험만 회고할 수 있습니다.');
  const decision=option(b.decision,Object.keys(decisions) as (keyof typeof decisions)[],'회고 판단'),learning=str(b.learning,'결과·혼란 요인·다음 실험',5000,true);
  const measurements=(await listRecords<StoreMeasurement>(owner,'store_measurement',store.id)).filter(m=>m.experimentId===experiment.id);
  const review=b.review?{evidenceLevel:option(b.review.evidenceLevel,['observation','comparison','repeated'] as const,'근거 수준'),failureType:option(b.review.failureType,['none','collection','execution','measurement','insufficient','economics','negative'] as const,'문제 구분'),confounders:str(b.review.confounders??'','다른 설명',2000),nextAction:str(b.review.nextAction,'다음 행동',2000,true),conditions:str(b.review.conditions??'','적용 조건',2000)}:undefined;
  if(decision==='adopt')for(const m of measurements.filter(m=>m.ledgerSnapshot)){const ops=await getStoreOperations(owner,store.id,m.periodStart,m.periodEnd);if(ledgerChanged(m.ledgerSnapshot!,ops.orders.filter(o=>o.experimentId===experiment.id),ops.spend.filter(s=>s.experimentId===experiment.id)))throw new ApiError(409,'성과를 가져온 뒤 장부가 변경되었습니다. 장부 성과를 다시 가져와 검토하세요.');}
  if(decision==='adopt'&&!measurements.some(m=>m.values[experiment.primaryMetric]!==null))throw new ApiError(409,'조건부 확대에는 핵심 지표의 실제 기록이 필요합니다.');
  await recordStatement(owner,'store_experiment',experiment.id,{...experiment,status:'completed',decision,learning,review,version:experiment.version+1,updatedAt:stamp()},store.id).run();return json({id:experiment.id});
 }
 throw new ApiError(400,'지원하지 않는 점포 작업입니다.');
}catch(e){return failure(e)}finally{if(lock)await releaseLock(owner,lock)}}
