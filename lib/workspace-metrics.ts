// 대시보드·사이드바 숫자의 정의. 화면마다 따로 세지 않도록 여기서만 센다(tests/workspace-metrics.test.mjs로 고정).
import {roles,statuses,type Artifact,type Campaign,type Run} from './agency';
import {artifactUsable} from './role-output';

// 캠페인 상태(lib/agency.ts statuses): draft 브리프 작성 · ready 실행 준비 · running AI 작업 중 · review 검토 대기 · approved 기획 승인 · revision 수정 요청 · measuring 성과 기록.
// 진행 중 = draft가 아니고 종료 상태도 아닌 캠페인. 종료 = approved(기획 승인)와 그 뒤 단계인 measuring(성과 기록).
// statuses에 없는 상태는 작업을 숨기지 않도록 진행 중으로 센다.
export const closedCampaignStatuses=['approved','measuring'];
// 진행 중 카드 설명. 제외하는 상태 이름을 위 정의에서 만든다(draft는 화면에서 '초안'이라 부른다).
export const activeCampaignNote='초안·'+closedCampaignStatuses.map(s=>statuses[s]).join('·')+' 제외';
export function isActiveCampaign(c:Pick<Campaign,'status'>){return c.status!=='draft'&&!closedCampaignStatuses.includes(c.status)}
export function activeCampaigns<T extends Pick<Campaign,'status'>>(campaigns:readonly T[]){return campaigns.filter(isActiveCampaign)}

type Versioned=Pick<Campaign,'id'|'version'>;
const versionOf=(campaigns:readonly Versioned[],id:string)=>campaigns.find(c=>c.id===id)?.version;
// 검토 필요 = status review이고 캠페인 현재 버전 기준으로 쓸 수 있는 작업물(artifactUsable: 본문 있음·재질문 아님·브리프 버전 일치). 캠페인이 없는 작업물은 세지 않는다.
export function reviewArtifacts(artifacts:readonly Artifact[],campaigns:readonly Versioned[]){
 return artifacts.filter(a=>{const version=versionOf(campaigns,a.campaignId);return a.status==='review'&&version!==undefined&&artifactUsable(a,version)});
}
// 보완 필요 = review 중 쓸 수 없는 것(재질문·빈 본문·이전 브리프 버전) + revision(수정 요청).
export function needsWorkArtifacts(artifacts:readonly Artifact[],campaigns:readonly Versioned[]){
 return artifacts.filter(a=>{const version=versionOf(campaigns,a.campaignId);return version!==undefined&&(a.status==='revision'||a.status==='review'&&!artifactUsable(a,version))});
}
// 샘플 캠페인: lib/server.ts seedBrands가 새 워크스페이스에 자동으로 만드는 예시(같은 id). 사용자가 손대기 전(v1·브리프 작성)까지만
// 전체 수·상태별 수에서 빼고 '샘플'로 따로 보인다. 브리프를 고치거나 실행을 시작하면 실제 캠페인으로 센다.
export const sampleCampaignIds=['ofd-pilot-01'];
export function isSampleCampaign(c:Pick<Campaign,'id'|'status'|'version'>){return sampleCampaignIds.includes(c.id)&&c.status==='draft'&&c.version===1}
export function workspaceMetrics(data:{campaigns:readonly Campaign[];artifacts:readonly Artifact[]}){
 const samples=data.campaigns.filter(isSampleCampaign).length;
 return {totalCampaigns:data.campaigns.length-samples,sampleCampaigns:samples,activeCampaigns:activeCampaigns(data.campaigns).length,review:reviewArtifacts(data.artifacts,data.campaigns).length,needsWork:needsWorkArtifacts(data.artifacts,data.campaigns).length,roles:roles.length};
}

// updatedAt 내림차순. 입력 배열은 바꾸지 않는다.
export function recentCampaigns<T extends Pick<Campaign,'updatedAt'>>(campaigns:readonly T[]){return campaigns.toSorted((a,b)=>(b.updatedAt||'').localeCompare(a.updatedAt||''))}
// 상태별 캠페인 수. lib/agency.ts statuses 순서, 모르는 상태는 원문 그대로 뒤에 붙인다. 0건 상태와 샘플 캠페인은 뺀다.
export function campaignStatusCounts(all:readonly Pick<Campaign,'id'|'status'|'version'>[]){
 const campaigns=all.filter(c=>!isSampleCampaign(c)),order=[...Object.keys(statuses),...new Set(campaigns.map(c=>c.status).filter(s=>!(s in statuses)))];
 return order.map(status=>({status,label:statuses[status]||status,count:campaigns.filter(c=>c.status===status).length})).filter(x=>x.count>0);
}

// 역할 진행(캠페인 목록 진행 막대) = 캠페인 현재 버전 기준으로 쓸 수 있는 작업물(artifactUsable)이 있는 역할 수. 같은 역할의 여러 작업물·재질문·
// 이전 브리프 버전·outdated·수정 요청은 더 세지 않는다. 막대는 이 값 / roles.length.
export function usableRoleCount(c:Pick<Campaign,'id'|'version'>,artifacts:readonly Artifact[]){
 return new Set(artifacts.filter(a=>a.campaignId===c.id&&roles.some(r=>r.id===a.role)&&artifactUsable(a,c.version)).map(a=>a.role)).size;
}

// 실패한 실행 = 캠페인·담당별 가장 최근 실행이 failed인 것(다시 실행해 완료했으면 제외). 최근 순.
export function failedRuns(runs:readonly Run[],campaigns:readonly Pick<Campaign,'id'>[]){
 const latest=runs.filter(r=>campaigns.some(c=>c.id===r.campaignId)).toSorted((a,b)=>b.createdAt.localeCompare(a.createdAt));
 return latest.filter((r,i)=>r.status==='failed'&&latest.findIndex(x=>x.campaignId===r.campaignId&&x.role===r.role)===i);
}
// 온보딩 완료 = 브랜드·AI 연결·첫 캠페인 세 항목.
export function onboardingComplete(data:{brands:readonly unknown[];campaigns:readonly unknown[];connection:{configured:boolean}}){return data.brands.length>0&&data.connection.configured&&data.campaigns.length>0}
// 다음 할 일: workspace 응답에 있는 정보(실행·작업물)로만 만든다. campaignId는 가장 최근 항목의 캠페인.
export type NextTask={kind:'failed-run'|'needs-work';count:number;campaignId:string};
export function nextTasks(data:{campaigns:readonly Campaign[];artifacts:readonly Artifact[];runs:readonly Run[]}):NextTask[]{
 const failed=failedRuns(data.runs,data.campaigns),work=needsWorkArtifacts(data.artifacts,data.campaigns).toSorted((a,b)=>b.createdAt.localeCompare(a.createdAt));
 return [...(failed.length?[{kind:'failed-run' as const,count:failed.length,campaignId:failed[0].campaignId}]:[]),...(work.length?[{kind:'needs-work' as const,count:work.length,campaignId:work[0].campaignId}]:[])];
}
