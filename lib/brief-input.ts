import {campaignEvidencePolicy} from './campaign-policy';
import {aiBrand,withoutPlanOwner,withoutAssignees,productionAllow,inputMaskingRecord,BRAND_MASK_PATHS,DIRECTIVE_MASK_PATHS,FACT_MASK_PATHS,STORE_MASK_PATHS,campaignMaskPaths,metricMaskPaths,type EvidenceContext,type InputMasking} from './ai-context';
import {maskFields} from './pii-scan';
import {briefInstructions,type BriefInput} from './brief';
import {isRecruitmentObjective,type Brand,type Campaign,type Artifact,type Metric} from './agency';

// 브리프 초안 제출(지시문·입력·가림 기록) 조립을 서버 의존 없이 만드는 순수 함수(G1). lib/brief-execution.ts start 분기는 DB에서 읽은 원자료와 stamp() 기준일을 넘기고
// 이 출력을 그대로 저장·전송한다. 평가는 JSON으로 동결한 요청(briefRequestFor)과 고정 기준일로 같은 본문을 재현한다(tests/assembly-export.test.mjs).
// 가림 경로(③)와 담당자 자리표시(④). 확정 사실 값은 허용 값이라 경로에 없고, 후보·금지 사실 값과 점포 맥락의 지점 자유 텍스트는 가린다. 사실 후보 출처 확인(parseBrief)은 저장한 원 입력으로 한다.
export const BRIEF_MASK_PATHS=[...BRAND_MASK_PATHS,...DIRECTIVE_MASK_PATHS,...FACT_MASK_PATHS,...STORE_MASK_PATHS,...campaignMaskPaths('currentBrief'),'previousCampaigns.*.title','previousCampaigns.*.goal','previousCampaigns.*.plan.*',...metricMaskPaths('recordedMetrics'),'approvedLearnings.*.title','approvedLearnings.*.content'];
type Archive=Awaited<ReturnType<typeof import('./archive-server').brandArchiveContext>>;
type PreviousCampaign=Pick<Campaign,'id'|'title'|'goal'|'plan'|'status'|'updatedAt'>;
// 원자료(DB 읽기 결과). campaignId: 캠페인 브리프면 그 캠페인(이전 캠페인에서 뺀다). campaigns·metrics·artifacts는 소유자 전체 목록(최근 순)이다.
// sourceMasking: 브랜드 자료 가림 기록(brandArchiveInput, 값 없음). contextDate: 기준일(YYYY-MM-DD). storeAllow: 지점 허용 값(가림 허용 목록에만 쓴다).
export type BriefSources={campaignId?:string;input:BriefInput;brand:Brand;evidence:Pick<EvidenceContext,'facts'|'directives'>;archive:Archive;sourceMasking:InputMasking[];trialLearning:unknown;campaigns:Campaign[];metrics:Metric[];artifacts:Artifact[];contextDate:string;storeAllow:readonly string[]};
// 요청의 브랜드: aiBrand가 읽는 필드와 id만 담는다. 의뢰 정보(intake)·bg는 모델에 가지 않으므로 요청에도 담지 않는다.
type BriefBrand=Pick<Brand,'id'|'name'|'short'|'category'|'color'|'tone'|'audience'|'constraints'|'description'|'knowledge'>;
// 동결 단위 요청: 입력·고른 참고 자료·기준일·허용 값. JSON으로 저장했다 읽어도 같은 본문이 나온다. 모델에 가지 않는 원자료(브랜드 의뢰 정보·bg)는 담지 않고,
// 담당자 실명(plan.owner, 진단 assignee)은 조립과 같은 자리표시로 바꿔 담는다(두 번 적용해도 같아 조립 바이트는 그대로다). 연락처 등 자유 텍스트는 가림 전 값이므로 저장 전 가림이 필요하다(G2).
export type BriefRequest={input:BriefInput;context:{brand:BriefBrand;evidence:Pick<EvidenceContext,'facts'|'directives'>;archive:Archive;sourceMasking:InputMasking[];trialLearning:unknown;previousCampaigns:PreviousCampaign[];recordedMetrics:Metric[];approvedLearnings:{campaignId:string;title:string;content:string}[]};contextDate:string;storeAllow:readonly string[]};
// 같은 브랜드(지점 브리프면 같은 지점)의 다른 캠페인 3건, 그 성과 6건, 승인된 data·quality·insight 작업물 4건(본문 2,500자)을 고른다.
// 가맹 모집 캠페인(R3)과 소비자 캠페인은 서로의 이전 캠페인으로 섞지 않는다(목적이 같은 캠페인만).
export function briefRequestFor({campaignId,input,brand,evidence,archive,sourceMasking,trialLearning,campaigns,metrics,artifacts,contextDate,storeAllow}:BriefSources):BriefRequest{
 const previous=campaigns.filter(c=>c.brandId===brand.id&&c.id!==campaignId&&(!input.storeId||c.storeId===input.storeId)&&isRecruitmentObjective(c)===isRecruitmentObjective(input)).slice(0,3);
 const relevantIds=new Set(previous.map(c=>c.id));
 const {id,name,short,category,color,tone,audience,constraints,description,knowledge}=brand;
 return {input:withoutPlanOwner(input),context:{brand:{id,name,short,category,color,tone,audience,constraints,description,knowledge},evidence:{facts:evidence.facts,directives:evidence.directives},archive:withoutAssignees(archive),sourceMasking,trialLearning,previousCampaigns:previous.map(c=>withoutPlanOwner({id:c.id,title:c.title,goal:c.goal,plan:c.plan,status:c.status,updatedAt:c.updatedAt})),
  recordedMetrics:metrics.filter(m=>relevantIds.has(m.campaignId)).slice(0,6),
  approvedLearnings:artifacts.filter(a=>relevantIds.has(a.campaignId)&&a.status==='approved'&&['data','quality','insight'].includes(a.role)).slice(0,4).map(a=>({campaignId:a.campaignId,title:a.title,content:a.content.slice(0,2500)}))},contextDate,storeAllow};
}
// maskingRecord는 초안 기록(brief_draft.inputMasking)에 남는 값이다: 입력 가림 기록 뒤에 브랜드 자료 가림 기록을 합친다(값 없음, 모델 입력에 싣지 않음).
export function buildBriefSubmission({input,context:c,contextDate,storeAllow}:BriefRequest):{instructions:string;input:string;maskingRecord:InputMasking[]}{
 const masked=maskFields({brand:aiBrand(c.brand),evidence:{facts:c.evidence.facts,directives:c.evidence.directives},brandArchive:withoutAssignees(c.archive),currentBrief:withoutPlanOwner(input),trialLearning:c.trialLearning,previousCampaigns:c.previousCampaigns.map(p=>withoutPlanOwner(p)),recordedMetrics:c.recordedMetrics,approvedLearnings:c.approvedLearnings,contextDate},BRIEF_MASK_PATHS,{allow:productionAllow(c.evidence,c.archive,storeAllow)});
 return {instructions:briefInstructions+'\n'+campaignEvidencePolicy(input),input:JSON.stringify(masked.value),maskingRecord:[...inputMaskingRecord(masked),...c.sourceMasking]};
}
