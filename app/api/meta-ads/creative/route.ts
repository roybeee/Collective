import type {Campaign} from '@/lib/agency';
import type {MetaPlan} from '@/lib/meta-ads';
import type {StoreExperiment} from '@/lib/store-marketing';
import type {ViralExperiment} from '@/lib/learning';
import {factLabel} from '@/lib/fact-catalog';
import {getBrandFacts} from '@/lib/brand-facts-server';
import {scopedBrandFacts,sameFactRefs} from '@/lib/brand-facts';
import {getExecution,optionalRecord} from '@/lib/execution-server';
import {emptyMetaCreative,metaCreativeFields,metaCopyReview,parseMetaCreative,MetaCreativeError,type MetaCreativeInput,type MetaCreativeReview} from '@/lib/meta-creative-review';
import {ApiError,acquireLock,actor,body,database,eventStatement,failure,json,listRecords,readRecord,recordStatement,releaseLock,requireAdminActor,secureMutation,stamp,str} from '@/lib/server';
async function context(owner:string,c:Campaign){
 const [plan,saved,execution,rawFacts,store,viral]=await Promise.all([optionalRecord<MetaPlan>(owner,'meta_ads_plan',c.id),optionalRecord<MetaCreativeReview>(owner,'meta_ads_creative_review',c.id),getExecution(owner,c),getBrandFacts(owner,c.brandId,c.storeId),c.storeId?listRecords<StoreExperiment>(owner,'store_experiment',c.storeId):Promise.resolve([]),listRecords<ViralExperiment>(owner,'viral_experiment',c.id)]);
 const facts=scopedBrandFacts(rawFacts,c.brandId,c.storeId);
 const experiments=[...store.filter(e=>e.brandId===c.brandId&&(e.campaignId===c.id||c.storeExperimentId===e.id)).map(e=>({id:e.id,kind:'store' as const,title:e.title,version:e.version,status:e.status,hypothesis:e.hypothesis,control:e.control,treatment:e.treatment,measurement:e.measurement,stopRule:e.stopRule,metric:e.primaryMetric,target:e.target})),...viral.filter(e=>e.brandId===c.brandId&&e.campaignId===c.id).map(e=>({id:e.id,kind:'viral' as const,title:e.title,version:e.version,status:e.status,hypothesis:e.hypothesis,control:e.control,treatment:e.treatment,measurement:e.conditions,stopRule:'',metric:e.metric,target:e.minSample}))];
 return {plan,saved,facts,experiments,creatives:execution.creatives};
}
type Context=Awaited<ReturnType<typeof context>>;
function inspect(c:Campaign,x:Context,input:MetaCreativeInput){
 const copy=metaCopyReview(input,x.facts),issues=[...copy.issues],creative=x.creatives.find(v=>v.id===input.creativeId),experiment=x.experiments.find(v=>v.id===input.experimentId&&v.kind===input.experimentKind);
 for(const key of ['title','hook','body','cta','rightsEvidence','reviewNote'] as const)if(!input[key])issues.push('필수 검토 내용이 비어 있습니다: '+metaCreativeFields[key]);
 if(!x.plan||x.plan.campaignVersion!==c.version)issues.push('현재 캠페인 기준의 광고 준비 계획을 저장하세요.');
 if(!x.plan?.input.landingUrl)issues.push('준비 계획에 랜딩 주소를 입력하세요.');
 if(c.status==='archived')issues.push('보관된 캠페인입니다.');
 if(!creative||creative.current!==true)issues.push('현재 유효한 근거와 연결된 소재를 선택하세요.');
 if(creative&&x.plan?.input.endAt&&creative.factRefs.some(r=>{const f=x.facts.confirmed.find(f=>f.id===r.id&&f.version===r.version);return !f||Date.parse(f.validUntil)<Date.parse(x.plan!.input.endAt)}))issues.push('소재 근거의 유효기간이 광고 종료일까지 유지되지 않습니다.');
 if(!experiment||experiment.status!=='draft')issues.push('같은 캠페인에 연결된 시작 전 실험을 선택하세요.');
 if(experiment&&(!experiment.hypothesis||!experiment.control||!experiment.treatment||!experiment.measurement||experiment.target===null||experiment.target<=0))issues.push('실험의 가설·대조안·처치안·측정 방법·표본/목표를 먼저 채우세요.');
 if(!input.rightsConfirmed)issues.push('파일·음원·출연자 사용권을 확인하세요.');if(!input.landingConfirmed)issues.push('문구와 랜딩의 상품·가격·판매 조건을 대조하세요.');
 return {...copy,issues:[...new Set(issues)],creative,experiment};
}
function view(c:Campaign,x:Context,canEdit:boolean){const input=x.saved?.input??emptyMetaCreative(),review=inspect(c,x,input),refs=x.facts.confirmed.map(f=>({id:f.id,version:f.version}));const stale=!!x.saved&&(x.saved.campaignVersion!==c.version||x.saved.planVersion!==(x.plan?.version??0)||x.saved.creativeVersion!==(review.creative?.version??null)||x.saved.pngHash!==(review.creative?.pngHash??null)||x.saved.experimentVersion!==(review.experiment?.version??null)||!sameFactRefs(x.saved.factRefs,refs));return {saved:x.saved,input,canEdit,version:x.saved?.version??0,campaignVersion:c.version,planVersion:x.plan?.version??0,landingUrl:x.plan?.input.landingUrl??'',creatives:x.creatives.map(v=>({id:v.id,title:v.title??'확인 사실 소재',version:v.version,current:v.current,caption:v.caption,pngHash:v.pngHash})),experiments:x.experiments,facts:x.facts.confirmed.map(f=>({id:f.id,version:f.version,key:factLabel(f.key),value:f.value,source:f.source,validUntil:f.validUntil})),issues:review.issues,warnings:review.warnings,notice:review.notice,stale,reviewValid:x.saved?.status==='reviewed'&&!stale&&!review.issues.length,canActivate:false}}
export async function GET(req:Request){try{const who=await actor(req),c=await readRecord<Campaign>(who.owner,'campaign',str(new URL(req.url).searchParams.get('campaignId'),'캠페인',100,true));return json(view(c,await context(who.owner,c),who.role!=='member'))}catch(e){return failure(e)}}
export async function POST(req:Request){let owner='',lock='';try{const who=await requireAdminActor(req);secureMutation(req);const b=await body(req);if(b.action!=='save'&&b.action!=='review')throw new ApiError(400,'지원하지 않는 검토 작업입니다.');const input=parseMetaCreative(b.input);owner=who.owner;lock=await acquireLock(owner);const c=await readRecord<Campaign>(owner,'campaign',str(b.campaignId,'캠페인',100,true)),x=await context(owner,c);
 if(c.status==='archived'||b.campaignVersion!==c.version||b.expectedVersion!==(x.saved?.version??0)||b.planVersion!==(x.plan?.version??0))throw new ApiError(409,'계획이나 캠페인이 변경되었습니다. 최신 내용을 다시 확인하세요.');
 if(input.creativeId&&!x.creatives.some(v=>v.id===input.creativeId))throw new ApiError(404,'이 캠페인의 소재가 아닙니다.');if(input.experimentId&&!x.experiments.some(v=>v.id===input.experimentId&&v.kind===input.experimentKind))throw new ApiError(404,'이 캠페인의 실험이 아닙니다.');
 const checked=inspect(c,x,input);if(b.action==='review'&&(checked.issues.length||b.warningsAcknowledged!==true))throw new ApiError(409,checked.issues.length?checked.issues.join(' '):'자동 점검의 경고와 한계를 확인하세요.');
 const now=stamp(),saved:MetaCreativeReview={id:c.id,campaignId:c.id,brandId:c.brandId,campaignVersion:c.version,planVersion:x.plan?.version??0,version:(x.saved?.version??0)+1,input,status:b.action==='review'?'reviewed':'draft',factRefs:x.facts.confirmed.map(f=>({id:f.id,version:f.version})),creativeVersion:checked.creative?.version??null,pngHash:checked.creative?.pngHash??null,experimentVersion:checked.experiment?.version??null,reviewedAt:b.action==='review'?now:null,reviewedBy:b.action==='review'?who.id:null,updatedAt:now,updatedBy:who.id};
 await database().batch([recordStatement(owner,'meta_ads_creative_review',c.id,saved,c.id),eventStatement(owner,c.id,`Meta 소재안 v${saved.version} ${saved.status==='reviewed'?'검토 기록':'초안 저장'} · 광고 집행 미승인`,{id:who.id,email:who.email})]);return json(view(c,{...x,saved},true));
 }catch(e){return failure(e instanceof MetaCreativeError?new ApiError(400,e.message):e)}finally{if(lock)await releaseLock(owner,lock)}}
