// 학습 규칙 카드의 표시 판정(app/learning-panel.tsx). 버튼은 서버(lib/learning-server.ts)가 받아 주는 경우에만 보인다.
import {ruleNeedsReview,type LearningRule} from './learning';
import type {FrozenExperimentSummary,SourceCampaignDeleted} from './record-kinds';
// 결정 7(b): 원 캠페인이 삭제된 바이럴 규칙은 종료 상태로만 남는다. assertSourceCampaign의 409 안내와 같은 문구다.
export const SOURCE_DELETED_NOTICE='원 캠페인이 삭제되어 이 규칙은 재검증·연장·상태 변경을 할 수 없습니다. 캠페인을 선택해 새 실험을 만들어 주세요.';
// renewBlocked: GET /api/learning이 붙이는 응답 필드. 측정 없이 한 번 연장했고 그 뒤 새 측정이 없어 서버가 연장을 거절한다(lib/learning-server.ts renewBlocked).
export type ShownRule=LearningRule&{sourceCampaignDeleted?:SourceCampaignDeleted|null;renewBlocked?:boolean};
export type RuleActions={retest:boolean;renew:boolean;retire:boolean;pause:boolean};
export type RuleState={label:string;sourceDeleted:boolean;deletedAt:string|null;notice:string;actions:RuleActions};
// 삭제 시각이 날짜로 읽히지 않으면 null로 둔다(화면은 '시각 미확인').
const readableAt=(at:unknown)=>typeof at==='string'&&Number.isFinite(Date.parse(at))?at:null;
export function ruleState(r:ShownRule,now=Date.now()):RuleState{
 if(r.sourceCampaignDeleted)return {label:'원 캠페인 삭제됨',sourceDeleted:true,deletedAt:readableAt(r.sourceCampaignDeleted.at),notice:SOURCE_DELETED_NOTICE,actions:{retest:false,renew:false,retire:false,pause:false}};
 const review=ruleNeedsReview(r,now),label=r.status==='retired'?'근거 정정 · 적용 종료':r.status==='paused'?'적용 중지':Date.parse(r.expiresAt)<now?'재검토 필요':'시험 적용 중';
 // 점포 출처 규칙의 후속 실험은 점포 마케팅 화면에서 만든다(서버도 retest_rule을 409로 거절한다).
 return {label,sourceDeleted:false,deletedAt:null,notice:'',actions:{retest:review&&r.origin!=='store',renew:review&&!r.renewBlocked,retire:review,pause:r.status==='active'}};
}
// 재검토 대상인데 서버가 연장을 거절해 연장 버튼을 끈 규칙의 안내. 무엇을 기록하면 다시 연장할 수 있는지 알린다.
export function renewNote(r:ShownRule,now=Date.now()){
 if(r.sourceCampaignDeleted||!r.renewBlocked||!ruleNeedsReview(r,now))return '';
 return `측정 없는 연장은 한 번까지입니다. ${r.origin==='store'?'점포 마케팅에서 후속 실험 성과':'재검증 실험 결과'}를 기록하면 연장할 수 있습니다.`;
}
// 만료 임박 알림 배너(loop-11). 이미 만료됐으면 주입 대상에서 빠졌다고 알리고, 아니면 남은 날을 올림으로 센다.
export function expiryNote(r:Pick<LearningRule,'expiresAt'>,now=Date.now()){const left=Date.parse(r.expiresAt)-now;return left<=0?'만료됨 · 새 AI 작업에 전달되지 않습니다':`만료까지 ${Math.ceil(left/86400000)}일`}
// 서버가 고른 expiringRules를 현재 브랜드 줄과 다른 브랜드 건수로 나눈다. 재검증 버튼은 규칙 카드와 같은 판정(ruleState)을 따른다.
export type ExpiringItem={rule:ShownRule;note:string;retest:boolean};
export function expiringBanner(rules:readonly ShownRule[],brandId:string,now=Date.now()):{items:ExpiringItem[];elsewhere:number}{
 const mine=rules.filter(r=>r.brandId===brandId);
 return {items:mine.map(r=>({rule:r,note:expiryNote(r,now),retest:ruleState(r,now).actions.retest})),elsewhere:rules.length-mine.length};
}
// 캠페인 상세의 만료 임박 알림(loop-11). 같은 브랜드의 규칙 중 지점 규칙은 같은 지점 캠페인에만 보인다(ruleApplies와 같은 지점 범위).
export function campaignExpiring(rules:readonly ShownRule[],campaign:{brandId:string;storeId?:string},now=Date.now()):ExpiringItem[]{
 return expiringBanner(rules.filter(r=>!r.storeId||r.storeId===campaign.storeId),campaign.brandId,now).items;
}
// 결정 7 후속: 원 캠페인이 삭제된 규칙은 캠페인 삭제 때 동결한 원천 실험 요약(원문 제외)을 곁에 보여 준다.
export function frozenSummaryFor(r:ShownRule,summaries:readonly FrozenExperimentSummary[]):FrozenExperimentSummary|null{
 if(!r.sourceCampaignDeleted)return null;
 return summaries.find(s=>s.experimentId===r.experimentId)??null;
}
const pct=(v:number)=>(v*100).toFixed(1)+'%';
const sample=(n:number|null)=>n===null?'n=미확인':'n='+n;
const day=(iso:string|null)=>iso&&Number.isFinite(Date.parse(iso))?new Date(iso).toISOString().slice(0,10):null;
// 가설 등 원문은 싣지 않는다. 제목·판정·비율·표본·기간만.
export function frozenSummaryLines(s:FrozenExperimentSummary):string[]{
 const lines=[`실험: ${s.title} (v${s.experimentVersion})`,`판정: ${s.assessment?.label||'기록 없음'}`];
 const a=s.assessment;
 if(a&&a.controlRate!==null&&a.treatmentRate!==null)lines.push(`대조 ${pct(a.controlRate)} (${sample(s.controlSample)}) · 실험 ${pct(a.treatmentRate)} (${sample(s.treatmentSample)})`+(a.lift===null?'':` · 차이 ${a.lift>=0?'+':''}${a.lift}%`));
 const from=day(s.startedAt),to=day(s.observedUntil);
 if(from&&to)lines.push(`관찰 기간: ${from} ~ ${to}`);
 return lines;
}
