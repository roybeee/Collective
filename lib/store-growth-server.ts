import {z} from 'zod';
import type {Campaign} from './agency';
import type {Store,StoreTask,StoreExperiment,StoreMeasurement} from './store-marketing';
import {ApiError,database,readRecord,listRecords,recordStatement,eventStatement,stamp,str,uid,type Actor} from './server';
import {requireGrowthRunning} from './growth-stop-server';
import {storefrontDigest} from './storefront-orders';
import {scanText} from './pii-scan';
import {catalogCandidates} from './store-growth-catalog';
import {prefillProfile,matchCandidate,economics,weeklyConclusions,candidateKey,type StoreGrowthProfile,type LocalPartnerCandidate,type ActivityTime} from './store-growth';
const kinds={candidate:'store_growth_candidate',comparison:'store_growth_comparison',link:'store_growth_link',time:'store_growth_time'} as const;

const safeText=(v:string)=>{let n=v.normalize('NFKC');for(let i=0;i<3;i++){try{const next=decodeURIComponent(n);if(next===n)break;n=next}catch{break}}n=n.replace(/[\u200B-\u200D\u2060\uFEFF]/g,'');return !scanText(n).length&&!/(?:bearer\s+\S+|(?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret)["']?\s*[:=]\s*\S+|\bsk-(?:proj-)?[\w-]{8,}|-----BEGIN [A-Z ]*PRIVATE KEY-----)/i.test(n)};
const text=z.string().trim().max(2000).refine(safeText),tags=z.array(z.string().trim().min(1).max(100).refine(safeText)).max(30);
const amount=z.number().finite().min(0).max(1e10).nullable();
const date=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v=>Number.isFinite(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v);
const publicUrl=z.string().max(2000).url().refine(v=>{try{const u=new URL(v);return u.protocol==='https:'&&!u.username&&!u.password&&!u.search&&!u.hash&&safeText(v)&&!/^(localhost|127\.|0\.|\[|10\.|192\.168\.|169\.254\.)/.test(u.hostname)}catch{return false}});
const profileSchema=z.object({concept:text,regions:tags,audiences:tags,dayparts:tags,averageOrderValue:amount,variableCostPerOrder:amount,spareOrdersPerDay:amount,ownerHourlyValue:amount,plannedOwnerMinutes:amount.default(null),monthlyBudget:amount,adCost:amount,productionCost:amount,benefitCost:amount,softwareCost:amount,days:z.number().int().min(1).max(365).nullable(),bottleneck:text.optional(),goal:text.optional(),constraints:text.optional(),categoryTags:tags.optional()});
const candidateSchema=z.object({name:z.string().trim().min(1).max(150).refine(safeText),kind:z.enum(['creator','media','platform','community','partner']),url:publicUrl,regions:tags,concepts:tags,audiences:tags,dayparts:tags,evidenceUrl:publicUrl,evidenceSummary:z.string().trim().min(1).max(2000).refine(safeText),checkedAt:date,expiresAt:date,localReach:amount,localReachEvidence:text,quote:amount,rights:z.enum(['unknown','confirmed','not_needed']),disclosure:z.enum(['unknown','confirmed']),tracking:z.enum(['unknown','confirmed']),status:z.enum(['research','shortlisted','rejected']).default('research'),publicBusinessEvidence:text.default(''),recentExamples:z.array(z.object({url:publicUrl,note:text,outcome:z.enum(['positive','negative','unknown'])})).max(10).default([]),quoteEvidenceUrl:z.union([publicUrl,z.literal('')]).default(''),rightsScope:text.default(''),rightsDays:z.number().int().min(1).max(3650).nullable().default(null),visitConditions:text.default(''),sponsoredRatio:z.number().min(0).max(1).nullable().default(null)});
const timeSchema=z.object({date,task:z.string().trim().min(1).max(500).refine(safeText),phase:z.enum(['setup','recurring']).default('recurring'),minutes:z.number().int().min(1).max(1440),baselineMinutes:z.number().int().min(0).max(1440).nullable(),source:z.enum(['measured','self_reported']),costIncludedElsewhere:z.boolean()});
const comparisonSchema=z.object({currentMeasurementId:z.string().min(1).max(100),baselineMeasurementId:z.string().min(1).max(100),baselineSoftwareCost:amount,currentSoftwareCost:amount,baselineTimeCost:amount,confirmed:z.literal(true),evidence:z.string().trim().min(10).max(2000).refine(safeText)});
type Comparison=z.infer<typeof comparisonSchema>&{id:string;storeId:string;version:number;updatedAt:string;currentVersion:number;baselineVersion:number;profileVersion:number;timeDigest:string};
function parse<T>(schema:z.ZodType<T>,value:unknown):T{const r=schema.safeParse(value);if(!r.success)throw new ApiError(400,'입력값을 확인하세요: '+r.error.issues.map(i=>i.path.join('.')).join(', '));return r.data}
const today=()=>new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Seoul'});
async function optional<T>(owner:string,kind:string,id:string){try{return await readRecord<T>(owner,kind,id)}catch(e){if(e instanceof ApiError&&e.status===404)return null;throw e}}
async function rows<T>(owner:string,kind:string,parent:string,limit=500){
 const r=await database().prepare('SELECT data FROM records WHERE owner=? AND kind=? AND parent_id=? ORDER BY updated_at DESC LIMIT ?').bind(owner,kind,parent,limit+1).all<{data:string}>();
 if(r.results.length>limit)throw new ApiError(409,'자료가 조회 한도를 넘었습니다. 기간을 나누어 대사해 주세요.');return r.results.map(x=>JSON.parse(x.data) as T);
}
function version(old:{version:number}|null,raw:unknown){if(raw!==(old?.version??0))throw new ApiError(409,'자료가 변경됐습니다. 새로고침 후 다시 저장하세요.')}
function canonical(raw:string){return candidateKey({url:raw})}
export type StoreGrowthLink={id:string;storeId:string;brandId:string;candidateId:string;candidateVersion:number;profileVersion:number;campaignId:string;campaignVersion:number;referenceVersions:Record<string,number>;experimentId:string;trackingCodeId:string;collaborationId:string;version:number;updatedAt:string;brief:string};
function brief(store:Store,p:StoreGrowthProfile,c:LocalPartnerCandidate){return `${store.name} / ${p.concept}\n목표: ${store.goal}\n고객: ${p.audiences.join(', ')}\n생활권: ${p.regions.join(', ')}\n시간대: ${p.dayparts.join(', ')}\n후보: ${c.name}\n출처: ${c.evidenceUrl}\n확인할 사항: ${matchCandidate(p,c,today()).blockers.join(', ')||'현재 근거 재확인'}\n실제 방문·구매를 추적하고 광고 표시·사용권·제공 원가를 확인합니다.`}
async function candidates(owner:string,s:Store){const saved=await rows<LocalPartnerCandidate>(owner,kinds.candidate,s.id);const urls=new Set(saved.map(c=>canonical(c.url)));return [...saved,...catalogCandidates(s.id,today()).filter(c=>!urls.has(canonical(c.url)))]}
async function resolveCandidate(owner:string,s:Store,id:unknown){const c=(await candidates(owner,s)).find(x=>x.id===id);if(!c)throw new ApiError(404,'현재 점포 후보가 아닙니다.');return c}
async function save(owner:string,kind:string,id:string,value:unknown,s:Store,who:Actor){await database().batch([recordStatement(owner,kind,id,value,s.id),eventStatement(owner,'','점포 성장 자료 저장',who,{storeId:s.id,kind,recordId:id})]);return value}

async function measuredWeekly(measurements:StoreMeasurement[],activities:ActivityTime[],p:StoreGrowthProfile,comparisons:Comparison[]){
 const current=measurements.filter(m=>m.scope!=='baseline'&&m.periodEnd<today()).sort((a,b)=>b.periodEnd.localeCompare(a.periodEnd))[0];
 const periodEnd=current?.periodEnd??today(),periodStart=current?.periodStart??new Date(Date.parse(periodEnd+'T00:00:00Z')-6*86400000).toISOString().slice(0,10);
 const recorded=comparisons.find(x=>x.currentMeasurementId===current?.id);
 const baseline=recorded?measurements.find(m=>m.id===recorded.baselineMeasurementId):undefined;
 const contribution=(m:StoreMeasurement|undefined)=>{const v=m?.values;return v&&[v.revenue,v.variableCosts,v.adSpend,v.productionCost].every(x=>typeof x==='number')?v.revenue!-v.variableCosts!-v.adSpend!-v.productionCost!:null};
 const v=current?.values;
 const periodActivities=activities.filter(a=>a.date>=periodStart&&a.date<=periodEnd);
 const comp=recorded&&recorded.currentVersion===current?.version&&recorded.baselineVersion===baseline?.version&&recorded.profileVersion===p.version&&recorded.timeDigest===await storefrontDigest(periodActivities)?recorded:undefined,base=contribution(baseline);
 const baselineContribution=comp&&base!==null&&comp.baselineSoftwareCost!==null&&comp.baselineTimeCost!==null?base-comp.baselineSoftwareCost-comp.baselineTimeCost:null;
 const result=weeklyConclusions({revenue:v?.revenue??null,variableCosts:v?.variableCosts??null,marketingCosts:v?.adSpend!==null&&v?.adSpend!==undefined&&v.productionCost!==null?v.adSpend+v.productionCost:null,softwareCost:comp?.currentSoftwareCost??null,ownerHourlyValue:p.ownerHourlyValue,baselineContribution,comparable:!!comp,activities:periodActivities});
 return {...result,reasons:[...result.reasons,...(!comp?['기준선과 현재 기간의 시간·도구 비용 대사가 없거나 변경되어 비교 판정을 보류합니다.']:[])],actualMinutes:result.minutes,estimatedSavedMinutes:result.savedMinutes,decision:result.recommendation,measurementId:current?.id??null,baselineId:baseline?.id??null,periodStart,periodEnd,causalStatus:'not_proven' as const,repeatStatus:current?.cohortMatured?'observed':'not_matured'};
}
export async function storeGrowthView(who:Actor,storeId:string){
 const s=await readRecord<Store>(who.owner,'store',storeId);
 const [saved,cs,timeEntries,links,tasks,measurements,experiments]=await Promise.all([optional<StoreGrowthProfile>(who.owner,'store_growth_profile',s.id),candidates(who.owner,s),rows<ActivityTime>(who.owner,'store_growth_time',s.id),rows<StoreGrowthLink>(who.owner,'store_growth_link',s.id),rows<StoreTask>(who.owner,'store_task',s.id),rows<StoreMeasurement>(who.owner,'store_measurement',s.id),rows<StoreExperiment>(who.owner,'store_experiment',s.id)]);
 const profile=saved??{...prefillProfile(s),version:0,storeVersion:s.version};
 const comparisons=await rows<Comparison>(who.owner,'store_growth_comparison',s.id);
 const campaigns=(await listRecords<Campaign>(who.owner,'campaign')).filter(c=>c.storeId===s.id&&c.brandId===s.brandId&&c.status!=='archived').map(c=>({id:c.id,title:c.title,version:c.version}));
 const assessment=economics({...profile,adCost:profile.adCost??null,productionCost:profile.productionCost??null,benefitCost:profile.benefitCost??null,softwareCost:profile.softwareCost??null,days:profile.days??null});
 const stale=profile.storeVersion!==s.version;
 const learning=experiments.filter(e=>e.status==='completed'&&e.learning).map(e=>({id:e.id,title:e.title,decision:e.decision??'inconclusive',learning:e.learning!,nextAction:e.review?.nextAction??'',evidenceLevel:e.review?.evidenceLevel??'observation'}));
 const recommendations=[...(stale?['점포 정보가 변경됐습니다. 기준을 다시 확인하세요.']:[]),...assessment.missing.map(x=>`${x} 확인`),...learning.filter(e=>e.decision==='stop').map(e=>`반복 중단 검토: ${e.title} — ${e.learning}`),...tasks.filter(t=>t.status==='open').map(t=>t.title)].slice(0,3);
 const checkedLinks=await Promise.all(links.map(async link=>{const campaign=await optional<Campaign>(who.owner,'campaign',link.campaignId),candidate=cs.find(c=>c.id===link.candidateId);const reasons:string[]=[];if(!campaign||campaign.version!==link.campaignVersion||campaign.status==='archived'||campaign.storeId!==s.id)reasons.push('캠페인이 변경되거나 보관됨');if(candidate?.version!==link.candidateVersion||candidate.status==='rejected'||profile.version!==link.profileVersion)reasons.push('후보 또는 점포 기준이 변경됨');for(const [field,kind] of [['experimentId','store_experiment'],['trackingCodeId','tracking_code'],['collaborationId','growth_collaboration']] as const){if(!link[field])continue;const r=await optional<{version:number;status?:string;stage?:string}>(who.owner,kind,link[field]);if(!r||r.version!==link.referenceVersions[field]||['cancelled','archived','inactive'].includes(r.status??r.stage??''))reasons.push(field+' 변경 또는 중단')}return {...link,sourceStatus:reasons.length?'held':'current',sourceReasons:reasons}}));
 const compared=cs.map(c=>{const m=matchCandidate(profile,c,today());return {...c,match:stale?{...m,ready:false,fit:m.fit==='exclude'?m.fit:'review' as const,blockers:[...m.blockers,'점포 정보가 변경됐습니다. 기준을 다시 확인하세요.']}:m,economics:economics({...profile,adCost:c.quote===null||profile.adCost===null?null:profile.adCost+c.quote}),brief:brief(s,profile,c)}});
 return {storeId:s.id,profile,campaigns,experiments,measurements,comparisons,candidates:compared,timeEntries,links:checkedLinks,tasks,learning,assessment:{...assessment,blockers:[...(stale?['점포 정보가 변경됐습니다. 기준을 다시 확인하세요.']:[]),...assessment.missing,...assessment.warnings],recommendations},weekly:await measuredWeekly(measurements,timeEntries,profile,comparisons),canEdit:who.role!=='member'&&s.status==='active',mayContact:false,mayPay:false,mayPublish:false};
}

async function saveProfile(who:Actor,s:Store,b:Record<string,unknown>){
 const old=await optional<StoreGrowthProfile>(who.owner,'store_growth_profile',s.id);version(old,b.version);
 const data=parse(profileSchema,b.profile),profile={...data,id:s.id,storeId:s.id,brandId:s.brandId,storeVersion:s.version,version:(old?.version??0)+1,updatedAt:stamp()} as StoreGrowthProfile;
 await save(who.owner,'store_growth_profile',s.id,profile,s,who);return {profile};
}
async function addCandidate(who:Actor,s:Store,b:Record<string,unknown>){
 const previous=b.action==='update_candidate'?await resolveCandidate(who.owner,s,b.id):null;
 const data=parse(candidateSchema,previous?{...(b.candidate as Record<string,unknown>),status:(b.candidate as Record<string,unknown>)?.status??previous.status}:b.candidate);
 if(data.checkedAt>today()||data.expiresAt<data.checkedAt)throw new ApiError(400,'확인일과 만료일을 확인하세요.');
 if(/(?:010[- ]?\d{4}|[\w.+-]+@[\w.-]+\.[a-z]{2,})/i.test([data.name,data.evidenceSummary,data.localReachEvidence].join(' ')))throw new ApiError(400,'개인 연락처는 수집하지 않습니다. 공개 사업 자료만 입력하세요.');
 const old=previous;
 if(old)version(old,b.version);
 if((await candidates(who.owner,s)).some(c=>c.id!==old?.id&&canonical(c.url)===canonical(data.url)))throw new ApiError(409,'같은 공식 주소의 후보가 이미 있습니다.');
 const candidate={...data,id:old?.id??uid(),storeId:s.id,version:(old?.version??0)+1};await save(who.owner,'store_growth_candidate',candidate.id,candidate,s,who);return {candidate};
}
async function selectCandidate(who:Actor,s:Store,b:Record<string,unknown>){
 const c=await resolveCandidate(who.owner,s,b.id);version(c,b.version);
 const status=parse(z.enum(['shortlisted','rejected','research']),b.status??'shortlisted');
 const candidate={...c,status,version:c.version+1};await save(who.owner,'store_growth_candidate',c.id,candidate,s,who);return {candidate};
}
async function addTime(who:Actor,s:Store,b:Record<string,unknown>){
 const data=parse(timeSchema,b.entry),requestId=str(b.requestId,'요청 ID',100,true),id=s.id+':'+requestId;
 if(data.date>today())throw new ApiError(400,'미래 작업 시간은 기록할 수 없습니다.');
 const entry={...data,id,storeId:s.id},old=await optional<ActivityTime>(who.owner,'store_growth_time',id);
 if(old){if(await storefrontDigest(old)!==await storefrontDigest(entry))throw new ApiError(409,'동일 요청 ID의 내용이 변경됐습니다.');return {entry:old,duplicate:true}}
 await save(who.owner,'store_growth_time',id,entry,s,who);return {entry,duplicate:false};
}
async function importCandidates(who:Actor,s:Store,b:Record<string,unknown>){
 const data=parse(z.array(candidateSchema).min(1).max(30),b.candidates),existing=await candidates(who.owner,s),keys=new Set(existing.map(c=>canonical(c.url))),fresh:LocalPartnerCandidate[]=[];
 for(const c of data){if(!c.publicBusinessEvidence||c.checkedAt>today()||c.expiresAt<c.checkedAt)throw new ApiError(400,'공개 사업 근거와 실제 확인일을 입력하세요.');const key=canonical(c.url);if(keys.has(key))throw new ApiError(409,'같은 후보 주소가 이미 있거나 일괄 자료에서 중복됐습니다.');keys.add(key);fresh.push({...c,id:uid(),storeId:s.id,version:1,status:'research'})}
 await database().batch([...fresh.map(c=>recordStatement(who.owner,'store_growth_candidate',c.id,c,s.id)),eventStatement(who.owner,'','공개 사업 후보 일괄 등록',who,{storeId:s.id,count:fresh.length})]);return {candidates:fresh};
}
async function createTask(who:Actor,s:Store,b:Record<string,unknown>){
 const c=await resolveCandidate(who.owner,s,b.candidateId),requestId=str(b.requestId,'요청 ID',100,true),id='growth:'+s.id+':'+requestId,title=str(b.task,'실행 과제',500,true);
 const old=await optional<StoreTask>(who.owner,'store_task',id);
 if(old){if(old.title!==title||old.evidence!==c.id)throw new ApiError(409,'동일 과제 요청 내용이 변경됐습니다.');return {task:old,duplicate:true}}
 if(!safeText(title))throw new ApiError(400,'과제에 개인정보·인증정보를 넣을 수 없습니다.');
 const task:StoreTask={id,storeId:s.id,reportId:'',title,channel:c.kind==='partner'?'partnership':'local_creator',status:'open',evidence:c.id,version:1,updatedAt:stamp()};
 await save(who.owner,'store_task',id,task,s,who);return {task,duplicate:false};
}
async function completeTask(who:Actor,s:Store,b:Record<string,unknown>){
 const task=await readRecord<StoreTask>(who.owner,'store_task',str(b.id,'점포 과제',300,true));
 if(task.storeId!==s.id||!task.id.startsWith('growth:'+s.id+':'))throw new ApiError(409,'현재 점포의 성장 과제가 아닙니다.');version(task,b.version);
 const evidence=parse(z.string().trim().min(1).max(2000).refine(safeText),b.evidence),next={...task,status:'done' as const,evidence,version:task.version+1,updatedAt:stamp()};await save(who.owner,'store_task',task.id,next,s,who);return {task:next};
}
async function linkExecution(who:Actor,s:Store,b:Record<string,unknown>){
 await requireGrowthRunning(who.owner);
 const p=await optional<StoreGrowthProfile>(who.owner,'store_growth_profile',s.id);if(!p||p.storeVersion!==s.version)throw new ApiError(409,'점포 정보가 변경됐거나 기준을 저장하지 않았습니다.');
 const c=await resolveCandidate(who.owner,s,b.candidateId);if(c.status!=='shortlisted')throw new ApiError(409,'검토 후보로 먼저 선택하세요.');
 const campaign=await readRecord<Campaign>(who.owner,'campaign',str(b.campaignId,'캠페인',100,true));
 if(campaign.storeId!==s.id||campaign.brandId!==s.brandId||campaign.status==='archived')throw new ApiError(409,'현재 점포·브랜드의 활성 캠페인이 아닙니다.');
 const id=s.id+':'+c.id+':'+campaign.id,old=await optional<StoreGrowthLink>(who.owner,'store_growth_link',id);version(old,b.version);
 const refs=[['experimentId','store_experiment'],['trackingCodeId','tracking_code'],['collaborationId','growth_collaboration']] as const;
 const referenceVersions:Record<string,number>={};
 for(const [field,kind] of refs){if(!b[field])continue;const r=await readRecord<{storeId?:string;brandId?:string;campaignId?:string;version:number;status?:string;stage?:string}>(who.owner,kind,str(b[field],field,100,true));if(r.campaignId!==campaign.id||(kind!=='growth_collaboration'&&r.storeId!==s.id)||(r.brandId&&r.brandId!==s.brandId)||['cancelled','archived','inactive'].includes(r.status??r.stage??''))throw new ApiError(409,'현재 점포·캠페인의 실행 기록이 아닙니다.');referenceVersions[field]=r.version}
 const link:StoreGrowthLink={id,storeId:s.id,brandId:s.brandId,candidateId:c.id,candidateVersion:c.version,profileVersion:p.version,campaignId:campaign.id,campaignVersion:campaign.version,referenceVersions,experimentId:str(b.experimentId??'','실험',100),trackingCodeId:str(b.trackingCodeId??'','추적',100),collaborationId:str(b.collaborationId??'','협업',100),version:(old?.version??0)+1,updatedAt:stamp(),brief:brief(s,p,c)};
 await save(who.owner,'store_growth_link',id,link,s,who);return {link,executionReady:matchCandidate(p,c,today()).ready,externalExecution:false};
}
async function saveComparison(who:Actor,s:Store,b:Record<string,unknown>){
 const data=parse(comparisonSchema,b.comparison);
 const [current,baseline]=await Promise.all([readRecord<StoreMeasurement>(who.owner,'store_measurement',data.currentMeasurementId),readRecord<StoreMeasurement>(who.owner,'store_measurement',data.baselineMeasurementId)]);
 if(current.storeId!==s.id||baseline.storeId!==s.id||current.scope==='baseline'||baseline.scope!=='baseline'||current.experimentId!==baseline.experimentId||current.periodStart<=baseline.periodEnd||current.periodEnd>=today()||current.definition!==baseline.definition||current.source!==baseline.source||Date.parse(current.periodEnd)-Date.parse(current.periodStart)!==Date.parse(baseline.periodEnd)-Date.parse(baseline.periodStart))throw new ApiError(409,'동일 점포·실험·집계 정의·길이의 완료된 비교 기간을 선택하세요.');
 if([data.baselineSoftwareCost,data.currentSoftwareCost,data.baselineTimeCost].some(x=>x===null))throw new ApiError(400,'두 기간의 시간·도구 비용 대사가 필요합니다.');
 const old=await optional<Comparison>(who.owner,'store_growth_comparison',current.id);version(old,b.version);
 const profile=await readRecord<StoreGrowthProfile>(who.owner,'store_growth_profile',s.id),time=(await rows<ActivityTime>(who.owner,'store_growth_time',s.id)).filter(a=>a.date>=current.periodStart&&a.date<=current.periodEnd);
 if(profile.storeVersion!==s.version||!time.length)throw new ApiError(409,'현재 점포 기준과 해당 기간의 실제 작업 시간을 먼저 확인하세요.');
 const comparison={...data,id:current.id,storeId:s.id,currentVersion:current.version,baselineVersion:baseline.version,profileVersion:profile.version,timeDigest:await storefrontDigest(time),version:(old?.version??0)+1,updatedAt:stamp()};await save(who.owner,'store_growth_comparison',comparison.id,comparison,s,who);return {comparison};
}
export async function storeGrowthAction(who:Actor,b:Record<string,unknown>){
 if(who.role==='member')throw new ApiError(403,'점포 성장 기준 변경은 관리자만 할 수 있습니다.');
 const s=await readRecord<Store>(who.owner,'store',str(b.storeId,'점포',100,true));if(s.status!=='active')throw new ApiError(409,'보관한 점포는 변경할 수 없습니다.');
 switch(b.action){case 'save_profile':return saveProfile(who,s,b);case 'add_candidate':case 'update_candidate':return addCandidate(who,s,b);case 'select_candidate':return selectCandidate(who,s,b);case 'add_time':return addTime(who,s,b);case 'create_task':return createTask(who,s,b);case 'complete_task':return completeTask(who,s,b);case 'link_execution':return linkExecution(who,s,b);case 'save_comparison':return saveComparison(who,s,b);case 'import_candidates':return importCandidates(who,s,b);default:throw new ApiError(400,'지원하지 않는 작업입니다.')}
}
