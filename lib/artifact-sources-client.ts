// X7 신뢰 UI 화면 요청(작업물 상세·목록 전용, 캠페인 상세 lazy 청크에만 실린다). 서버는 app/api/artifact-sources·app/api/usage(regrade_artifact).
import type {ArtifactScoreSummary,ArtifactSources,ComplianceView} from './artifact-sources';
import type {ArtifactCardSummary} from './artifact-card-summary-server';

// 다시 점검 뒤 작업물 탭의 온라인 채점 요약(app/online-grading.tsx)이 다시 읽도록 알리는 이벤트 이름.
export const GRADING_UPDATED_EVENT='collective:grading-updated';
async function readJson<T>(response:Response,fallback:string):Promise<T>{
 const data=await response.json().catch(()=>({})) as T&{error?:string};
 if(!response.ok)throw new Error(data.error||fallback);
 return data;
}
export const loadArtifactSources=(artifactId:string,signal?:AbortSignal)=>
 fetch('/api/artifact-sources?'+new URLSearchParams({artifact:artifactId}),{signal,cache:'no-store',credentials:'same-origin'}).then(r=>readJson<ArtifactSources>(r,'근거 정보를 불러오지 못했습니다.'));
export const loadScoreSummaries=(campaignId:string,signal?:AbortSignal)=>
 fetch('/api/artifact-sources?'+new URLSearchParams({campaign:campaignId}),{signal,cache:'no-store',credentials:'same-origin'}).then(r=>readJson<{scores:ArtifactScoreSummary[]}>(r,'소재 예측 점수를 불러오지 못했습니다.')).then(d=>d.scores);
// 작업물 목록 카드의 진행 단계·규정 차단·주의 수(P5·P10).
export const loadArtifactCards=(campaignId:string,signal?:AbortSignal)=>
 fetch('/api/artifact-sources?'+new URLSearchParams({cards:campaignId}),{signal,cache:'no-store',credentials:'same-origin'}).then(r=>readJson<{cards:ArtifactCardSummary[]}>(r,'작업물 진행 단계를 불러오지 못했습니다.')).then(d=>d.cards);
export async function regradeArtifact(artifactId:string){
 const response=await fetch('/api/usage',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'regrade_artifact',artifactId})});
 const data=await readJson<{compliance:ComplianceView}>(response,'다시 점검하지 못했습니다.');
 window.dispatchEvent(new CustomEvent(GRADING_UPDATED_EVENT));
 return data.compliance;
}
// 규정 수정 제안 적용(POST /api/action apply_compliance_fixes). 고른 제안 id와 그 제안을 계산한 판만 보낸다(본문은 서버가 저장본으로 다시 계산한다).
export type AppliedFixes={id:string;version:number;applied:number;ruleIds:string[];compliance:ComplianceView};
export async function applyComplianceFixes(artifactId:string,version:number,fixIds:readonly string[]){
 const response=await fetch('/api/action',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'apply_compliance_fixes',artifactId,version,fixIds})});
 const data=await readJson<AppliedFixes>(response,'수정 제안을 적용하지 못했습니다.');
 window.dispatchEvent(new CustomEvent(GRADING_UPDATED_EVENT));
 return data;
}
