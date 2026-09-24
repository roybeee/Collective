// 캠페인 파생 상태(data-truth-8). 저장된 campaign.status는 여러 경로가 마지막에 쓴 값이라 실제 진행과 어긋난다(실패 뒤 draft, 회의 실패 미반영,
// ready·measuring 미설정). 화면의 상태 배지·필터·대시보드 수치는 이 순수 함수가 작업물·AI 작업·회의·연속 실행·발행·성과에서 계산한 값을 쓴다.
// 저장 status와 그것을 쓰는 서버 로직(연속 실행·A2 CAS·실행 게이트·승인 흐름)은 바꾸지 않는다. 저장값은 쓰기 기록(캐시)으로 남는다.
// 상태 정의·우선순위·저장값과의 관계: docs/CAMPAIGN-STATUS.ko.md. 전이표: tests/campaign-status.test.mjs.
import {roles,statuses,type Artifact,type Campaign} from './agency';
import {executionGapLabels,executionGaps} from './brief';
import type {QualityReview} from './quality';
import {needsWorkArtifacts,reviewArtifacts,usableRoleCount} from './workspace-metrics';

// 우선순위 순(앞이 이긴다). 단, executing과 measuring은 서로 더 최근 기록이 정한다(발행 → 성과 기록 → 다음 발행).
// 보관(archivedAt, lib/campaign-archive.ts)은 진행 단계가 아니라 별도 표시라 여기에 없다. 보관 캠페인도 진행 단계를 그대로 계산한다(보관 중 도는 AI 작업이 가려지지 않게).
export const derivedStatuses=['running','blocked','executing','measuring','approved','revision','review','ready','draft'] as const;
export type DerivedStatus=typeof derivedStatuses[number];

export type StatusJob={role:string;status:string};
export type StatusMeeting={campaignVersion?:number|null;status:string;error?:string|null;createdAt?:string|null;updatedAt?:string|null};
export type StatusSequence={campaignVersion?:number|null;status:string;error?:string|null;updatedAt?:string|null};
export type StatusPublication={campaignVersion?:number|null;status:string;attemptedAt?:string|null;createdAt?:string|null;updatedAt?:string|null};
export type StatusMetric={period?:string;updatedAt?:string|null};
export type StatusCampaign=Pick<Campaign,'id'|'version'|'status'|'budget'|'budgetConfirmedAt'|'startDate'|'endDate'>;
// activeJobs: 캠페인의 AI 작업(역할·회의). 활성 상태가 아닌 항목은 무시한다. sequence·meetings·publications·metrics: 이 캠페인의 기록.
export type CampaignStatusInput={campaign:StatusCampaign;artifacts:readonly Artifact[];activeJobs:readonly StatusJob[];sequence?:StatusSequence|null;meetings:readonly StatusMeeting[];publications:readonly StatusPublication[];metrics:readonly StatusMetric[]};
export type CampaignStatusResult={status:DerivedStatus;reason:string};

const activeJobStatuses=['starting','queued','in_progress','uncertain'];
const liveMeetingStatuses=['running','uncertain'];
// 발행 접수 이후: Buffer가 예약을 받았거나(accepted) 게시를 확인했다(published). 접수 중·미확인·실패·취소·공급자 확인 필요는 아직 실행이 아니다.
const executedPublicationStatuses=['accepted','published'];

const latest=(values:readonly (string|null|undefined)[])=>values.reduce<string>((max,v)=>v&&v>max?v:max,'');
// 버전이 없는 이전 기록은 현재 브리프 버전의 기록으로 본다.
const currentVersion=(version:number|null|undefined,c:StatusCampaign)=>version==null||version===c.version;
const roleName=(role:string)=>role==='meeting'?'팀 회의':roles.find(r=>r.id===role)?.name||role;
const clip=(text:string)=>text.length>160?text.slice(0,159)+'…':text;

function runningStage({activeJobs,meetings}:CampaignStatusInput):CampaignStatusResult|null{
 const names=[...new Set([...activeJobs.filter(j=>activeJobStatuses.includes(j.status)).map(j=>roleName(j.role)),...(meetings.some(m=>liveMeetingStatuses.includes(m.status))?['팀 회의']:[])])];
 return names.length?{status:'running',reason:`${names.join('·')} AI 작업이 진행 중입니다.`}:null;
}
// 막힘: 현재 브리프 버전의 가장 최근 회의가 실패했거나 연속 실행이 막혔고, 그 뒤로 작업물이 새로 작성·판정되지 않았다.
function blockedStage({campaign,meetings,sequence}:CampaignStatusInput,lastWorkAt:string):CampaignStatusResult|null{
 const meeting=meetings.filter(m=>currentVersion(m.campaignVersion,campaign)).toSorted((a,b)=>(b.createdAt||'').localeCompare(a.createdAt||''))[0];
 if(meeting?.status==='failed'&&(meeting.updatedAt||meeting.createdAt||'')>lastWorkAt)return {status:'blocked',reason:`최근 팀 회의가 실패했습니다${meeting.error?`(${clip(meeting.error)})`:''}. 회의 기록을 확인한 뒤 다시 진행하세요.`};
 if(sequence?.status==='blocked'&&currentVersion(sequence.campaignVersion,campaign)&&(sequence.updatedAt||'')>lastWorkAt)return {status:'blocked',reason:`연속 실행이 멈췄습니다${sequence.error?' · '+clip(sequence.error):'.'}`};
 return null;
}
// 발행 진행·성과 기록: 작업물의 마지막 변화보다 뒤에 생긴 기록만 단계로 본다(새 작업물이 생기면 새 기획 주기). 둘 다면 더 최근 기록이 이긴다.
function executionStage({campaign,publications,metrics}:CampaignStatusInput,lastWorkAt:string):CampaignStatusResult|null{
 const executed=publications.filter(p=>executedPublicationStatuses.includes(p.status)&&currentVersion(p.campaignVersion,campaign));
 const executedAt=latest(executed.map(p=>p.attemptedAt||p.updatedAt||p.createdAt)),measuredAt=latest(metrics.map(m=>m.updatedAt));
 const executing=executed.length>0&&executedAt>=lastWorkAt,measuring=metrics.length>0&&measuredAt>=lastWorkAt;
 if(measuring&&(!executing||measuredAt>=executedAt)){
  const period=metrics.toSorted((a,b)=>(b.updatedAt||'').localeCompare(a.updatedAt||''))[0]?.period;
  return {status:'measuring',reason:`성과 기록 ${metrics.length}건${period?` · 최근 기간 ${period}`:''}.`};
 }
 if(!executing)return null;
 const accepted=executed.filter(p=>p.status==='accepted').length,published=executed.length-accepted;
 return {status:'executing',reason:`접수된 발행 ${executed.length}건(${[accepted&&`예약 접수 ${accepted}건`,published&&`게시 확인 ${published}건`].filter(Boolean).join('·')}). 성과가 나오면 기록하세요.`};
}
// 기획 단계: 작업물의 검토 판정(data-truth-9 정의: lib/workspace-metrics.ts reviewArtifacts·needsWorkArtifacts)과 브리프 빈칸으로 정한다.
function planStage(c:StatusCampaign,artifacts:readonly Artifact[]):CampaignStatusResult{
 if(artifacts.length&&artifacts.some(a=>a.role==='quality')&&artifacts.every(a=>a.status==='approved'))return {status:'approved',reason:`품질 검수를 포함한 작업물 ${artifacts.length}건이 모두 승인됐습니다.`};
 const scope=[{id:c.id,version:c.version}],needsWork=needsWorkArtifacts(artifacts,scope),review=reviewArtifacts(artifacts,scope);
 const qualityFix=review.some(a=>{const verdict=a.role==='quality'?(a as Artifact&{qualityReview?:QualityReview}).qualityReview?.verdict:undefined;return !!verdict&&verdict!=='ready_for_review'});
 const requested=needsWork.filter(a=>a.status==='revision').length,unusable=needsWork.length-requested;
 if(needsWork.length||qualityFix)return {status:'revision',reason:[requested&&`수정 요청 ${requested}건`,unusable&&`보완 필요(재질문·빈 본문·이전 브리프 버전) ${unusable}건`,qualityFix&&'독립 품질 검수가 수정·자료 확인을 요청했습니다'].filter(Boolean).join(' · ')+'.'};
 if(review.length)return {status:'review',reason:`검토할 작업물 ${review.length}건이 판정을 기다립니다.`};
 if(artifacts.length)return {status:'ready',reason:`검토할 작업물이 없습니다 · 사용 가능한 역할 ${usableRoleCount(c,artifacts)}/${roles.length}. 남은 담당자 실행이나 품질 검수를 이어가세요.`};
 return executionGaps(c).length?{status:'draft',reason:`브리프에 빠진 항목이 있습니다 · ${executionGapLabels(c)}.`}:{status:'ready',reason:'브리프가 준비됐습니다. AI 팀 실행을 시작할 수 있습니다.'};
}

// 저장 status와 다르면 사유 끝에 저장값을 남긴다. 입력은 바꾸지 않는다.
export function deriveCampaignStatus(input:CampaignStatusInput):CampaignStatusResult{
 const c=input.campaign,artifacts=input.artifacts.filter(a=>a.campaignId===c.id&&a.status!=='outdated');
 // 작업물의 마지막 변화(작성·검토 판정). 이보다 오래된 실패·발행·성과 기록은 새 작업에 밀린 것으로 본다.
 const lastWorkAt=latest(artifacts.flatMap(a=>[a.createdAt,(a as Artifact&{reviewedAt?:string}).reviewedAt]));
 const derived=runningStage(input)||blockedStage(input,lastWorkAt)||executionStage(input,lastWorkAt)||planStage(c,artifacts);
 return derived.status===c.status?derived:{...derived,reason:`${derived.reason} (저장값: ${statuses[c.status]||c.status||'없음'})`};
}

type Scoped={campaignId:string};
export type StatusSources={artifacts:readonly Artifact[];runs:readonly (StatusJob&Scoped)[];sequences:readonly (StatusSequence&Scoped)[];meetings:readonly (StatusMeeting&Scoped)[];publications:readonly (StatusPublication&Scoped)[];metrics:readonly (StatusMetric&Scoped)[]};
// 응답용: 저장 필드(status 포함)는 그대로 두고 derivedStatus·statusReason을 더한 새 객체를 만든다. 워크스페이스·캠페인 상세 응답이 같이 쓴다.
export function withDerivedStatus<C extends StatusCampaign>(campaigns:readonly C[],sources:StatusSources):(C&{derivedStatus:DerivedStatus;statusReason:string})[]{
 const of=<T extends Scoped>(list:readonly T[],id:string)=>list.filter(x=>x.campaignId===id);
 return campaigns.map(c=>{
  const {status,reason}=deriveCampaignStatus({campaign:c,artifacts:of(sources.artifacts,c.id),activeJobs:of(sources.runs,c.id),sequence:of(sources.sequences,c.id)[0],meetings:of(sources.meetings,c.id),publications:of(sources.publications,c.id),metrics:of(sources.metrics,c.id)});
  return {...c,derivedStatus:status,statusReason:reason};
 });
}

// 회의·발행은 records.data에서 파생에 필요한 필드만 읽는다(회의 스냅샷 같은 큰 본문을 풀지 않는다). 라우트가 database()로 bind(owner[,campaignId]) 실행한다.
const statusFields={team_meeting:['campaignId','campaignVersion','status','error','createdAt','updatedAt'],execution_publication:['campaignId','campaignVersion','status','attemptedAt','createdAt','updatedAt']} as const;
export function statusRecordsQuery(kind:keyof typeof statusFields,byCampaign=false){
 return `SELECT ${statusFields[kind].map(f=>`json_extract(data,'$.${f}') AS ${f}`).join(',')} FROM records WHERE owner=? AND kind='${kind}'${byCampaign?' AND parent_id=?':''}`;
}
