import type {Campaign} from './agency';
import type {MetaPlan} from './meta-ads';
import type {StoreExperiment} from './store-marketing';
import type {ViralExperiment} from './learning';
import {factLabel} from './fact-catalog';
import {getBrandFacts} from './brand-facts-server';
import {scopedBrandFacts,sameFactRefs} from './brand-facts';
import {getExecution,optionalRecord} from './execution-server';
import {emptyMetaCreative,metaCreativeFields,metaCopyReview,type MetaCreativeInput,type MetaCreativeReview} from './meta-creative-review';
import {listRecords} from './server';
export async function metaCreativeContext(owner:string,c:Campaign){
 const [plan,saved,execution,rawFacts,store,viral]=await Promise.all([optionalRecord<MetaPlan>(owner,'meta_ads_plan',c.id),optionalRecord<MetaCreativeReview>(owner,'meta_ads_creative_review',c.id),getExecution(owner,c),getBrandFacts(owner,c.brandId,c.storeId),c.storeId?listRecords<StoreExperiment>(owner,'store_experiment',c.storeId):Promise.resolve([]),listRecords<ViralExperiment>(owner,'viral_experiment',c.id)]);
 const facts=scopedBrandFacts(rawFacts,c.brandId,c.storeId);
 const experiments=[...store.filter(e=>e.brandId===c.brandId&&(e.campaignId===c.id||c.storeExperimentId===e.id)).map(e=>({id:e.id,kind:'store' as const,title:e.title,version:e.version,status:e.status,hypothesis:e.hypothesis,control:e.control,treatment:e.treatment,measurement:e.measurement,stopRule:e.stopRule,metric:e.primaryMetric,target:e.target})),...viral.filter(e=>e.brandId===c.brandId&&e.campaignId===c.id).map(e=>({id:e.id,kind:'viral' as const,title:e.title,version:e.version,status:e.status,hypothesis:e.hypothesis,control:e.control,treatment:e.treatment,measurement:e.conditions,stopRule:'',metric:e.metric,target:e.minSample}))];
 return {plan,saved,facts,experiments,creatives:execution.creatives};
}
type Context=Awaited<ReturnType<typeof metaCreativeContext>>;
export function inspectMetaCreative(c:Campaign,x:Context,input:MetaCreativeInput){
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
export function viewMetaCreative(c:Campaign,x:Context,canEdit:boolean){const input=x.saved?.input??emptyMetaCreative(),review=inspectMetaCreative(c,x,input),refs=x.facts.confirmed.map(f=>({id:f.id,version:f.version}));const stale=!!x.saved&&(x.saved.campaignVersion!==c.version||x.saved.planVersion!==(x.plan?.version??0)||x.saved.creativeVersion!==(review.creative?.version??null)||x.saved.pngHash!==(review.creative?.pngHash??null)||x.saved.experimentVersion!==(review.experiment?.version??null)||!sameFactRefs(x.saved.factRefs,refs));return {saved:x.saved,input,canEdit,version:x.saved?.version??0,campaignVersion:c.version,planVersion:x.plan?.version??0,landingUrl:x.plan?.input.landingUrl??'',creatives:x.creatives.map(v=>({id:v.id,title:v.title??'확인 사실 소재',version:v.version,current:v.current,caption:v.caption,pngHash:v.pngHash})),experiments:x.experiments,facts:x.facts.confirmed.map(f=>({id:f.id,version:f.version,key:factLabel(f.key),value:f.value,source:f.source,validUntil:f.validUntil})),issues:review.issues,warnings:review.warnings,notice:review.notice,stale,reviewValid:x.saved?.status==='reviewed'&&!stale&&!review.issues.length,canActivate:false}}
