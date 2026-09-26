import {aiBudget,isRecruitmentObjective} from './agency';
import {campaignPractice} from './practice';
import {meetingInstructions,candidateArtifacts,respondsToHandles,discussionRef,artifactRef,meetingCopyPack,withoutCopyPack,type Meeting,type MeetingStep,type Contribution} from './meetings';
import {labelArchive} from './role-output';
import {aiBrand,withoutPlanOwner,withoutAssignees,productionAllow,inputMaskingRecord,BRAND_MASK_PATHS,DIRECTIVE_MASK_PATHS,FACT_MASK_PATHS,STORE_MASK_PATHS,campaignMaskPaths,metricMaskPaths,type InputMasking} from './ai-context';
import {maskFields} from './pii-scan';

// 회의 단계 제출(지시문·입력·가림 기록) 조립을 서버 의존 없이 만드는 순수 함수(G1). lib/meeting-execution.ts advance 분기가 이 출력을 그대로 저장·전송하고,
// 평가는 대상 단계 직전까지의 회의 기록으로 같은 요청을 재현한다. tests/assembly-export.test.mjs가 운영 제출 본문과 바이트 동일한지 본다.
// 회의 입력 작업물 허용 목록(DP-1 ①, 코드 상수). 사람 수정 표시(origin·aiSource·aiSourceId)·편집 통계(editStats)·검토 메모(reviewNote·reviewedAt)·준수 보류(complianceHold)·
// 실행 메타(promptVersion·promptFallback·promptRecheck·skillVersion 등)·캠페인 id는 보내지 않는다. content 키 자리는 원 레코드 순서를 따른다. 평가 동결(lib/eval-freeze.ts)도 이 목록으로 작업물을 줄여 저장한다.
export const MEETING_ARTIFACT_FIELDS=['id','role','title','content','version','status','createdAt','factsChanged','brandChanged','unverifiedClaims','qualityReview'] as const;
const CANDIDATE_FIELDS=[...MEETING_ARTIFACT_FIELDS,'changes'];
// 품질 단계 후보 본문 상한: 역할 경로 upstreamContext의 품질 담당 상한과 같다(lib/role-output.ts). 원 작업물 발췌 상한 8,000자는 그대로다.
const CANDIDATE_CONTENT_LIMIT=24000;
const pick=(a:object,keys:readonly string[])=>Object.fromEntries(Object.entries(a).filter(([k])=>keys.includes(k)));
// 가림 경로(③). 모델 출력(발언·합의·개선 과제)은 가리지 않는다. 개선본은 candidateArtifacts와 completedRevisions 두 곳으로 가므로 둘 다 제목·본문을 가린다.
// 확정 사실 값은 허용 값이라 경로에 없다. 후보·금지 사실 값과 점포 맥락의 지점 자유 텍스트는 가린다.
export const MEETING_MASK_PATHS=['agenda',...BRAND_MASK_PATHS,...DIRECTIVE_MASK_PATHS,...FACT_MASK_PATHS,...STORE_MASK_PATHS,...campaignMaskPaths('campaign'),...metricMaskPaths('recordedMetrics'),'previousMeeting.agenda','previousMeeting.decisions.decisions','previousMeeting.decisions.questions','originalArtifacts.*.title','originalArtifacts.*.content','completedRevisions.*.title','completedRevisions.*.content','candidateArtifacts.*.title','candidateArtifacts.*.content'];
// 교정 재시도(correction이 있는 단계)의 지시문 끝 문장. 입력에는 correction 필드로 직전 실패 사유가 들어간다.
const CORRECTION='\n이전 응답은 검증에 실패했습니다. correction.error를 고치고, respondsTo에는 allowedRespondsTo의 ref만 사용하세요. 요청 선택지를 묻지 말고 이 단계의 완성된 결과를 반환하세요.';
// 단계 입력(가린 값)과 입력 가림 기록. storeAllow: 브랜드 단위 회의의 지점 허용 값(lib/store-allow-server.ts). 가림 허용 목록에만 쓴다.
export function meetingContext(m:Meeting,s:MeetingStep,storeAllow:readonly string[]):{value:object;findings:InputMasking[]}{
 const snapshot=m.snapshot,ref=(id:string)=>discussionRef(m.steps.find(t=>t.id===id)?.role||'');
 const raw={skillVersion:m.skillVersion,channelPractice:campaignPractice(snapshot.campaign,snapshot.prompts?.set?.channels),agenda:m.agenda,role:s.role,phase:s.phase,allowedRespondsTo:respondsToHandles(s,m.steps),correction:s.correction,brand:aiBrand(snapshot.brand),...(snapshot.evidence?{evidence:{facts:snapshot.evidence.facts,directives:snapshot.evidence.directives}}:{}),brandArchive:snapshot.brandArchive&&withoutAssignees(labelArchive(snapshot.brandArchive)),campaign:withoutPlanOwner({...snapshot.campaign,...aiBudget(snapshot.campaign)}),trialLearning:snapshot.learning,recordedMetrics:snapshot.metrics,previousMeeting:snapshot.previous,
  originalArtifacts:snapshot.artifacts.map(a=>({ref:artifactRef(a),...pick(a,MEETING_ARTIFACT_FIELDS),content:a.content.slice(0,8000),excerpt:a.content.length>8000})),
  discussion:m.steps.filter(t=>t.phase==='discussion'&&t.status==='completed').map(t=>{const o=t.output as Contribution;return {ref:discussionRef(t.role),role:t.role,...o,respondsTo:o.respondsTo.map(ref)}}),
  synthesis:m.steps.find(t=>t.phase==='synthesis')?.output,
  // 카피 팩 개선본(A3-4)은 팩 렌더본이 content에 있으므로 팩 필드(copyPack·copyPackIssues)는 싣지 않는다. 팩이 없으면 이전과 같다.
  completedRevisions:m.steps.filter(t=>t.phase==='revision'&&t.status==='completed').map(t=>({role:t.role,...(t.output&&withoutCopyPack(t.output))})),
  task:s.task,...(s.phase==='quality'?{candidateArtifacts:candidateArtifacts(m).artifacts.map(a=>({ref:artifactRef(a),...pick(a,CANDIDATE_FIELDS),content:a.content.slice(0,CANDIDATE_CONTENT_LIMIT),excerpt:a.content.length>CANDIDATE_CONTENT_LIMIT})),invalidatedRoles:candidateArtifacts(m).invalidatedRoles}:{})};
 const masked=maskFields(raw,MEETING_MASK_PATHS,{allow:productionAllow(snapshot.evidence,snapshot.brandArchive,storeAllow)});
 return {value:masked.value,findings:inputMaskingRecord(masked)};
}
// 한 단계의 제출: m은 대상 단계 직전까지의 회의 기록(대상 단계는 아직 완료 전, 뒤 단계는 대기이거나 없음)이다. 완료된 회의 기록을 그대로 넣으면 뒤 단계 발언이 섞인다.
// 가맹 모집 objective 판정은 회의 시작 때 고정한 스냅샷 캠페인으로 한다(R3b: 개선 회의 지시문의 30일 정의 자리에 가맹 모집 규칙).
// maskingRecord는 단계 기록(team_meeting.steps[].inputMasking)에 남는 값이다: 입력 가림 기록 뒤에 브랜드 자료 가림 기록(snapshot.sourceMasking)을 합친다(값 없음, 모델 입력에 싣지 않음).
// Meeting 기록을 평가 요청으로 그대로 저장하지 않는다: 가림 전 스냅샷(snapshot.brand 원 레코드·intake 포함)과 단계 실행 메타(providerId·오류 문구)가 들어 있다.
// 평가 동결(G2)은 meetingContext가 읽는 필드만 남기고 저장 전에 가린다(두 번 가린 결과 = 한 번 가린 결과).
export function buildMeetingSubmission(m:Meeting,stepId:string,storeAllow:readonly string[]):{instructions:string;input:string;maskingRecord:InputMasking[]}{
 const s=m.steps.find(t=>t.id===stepId);if(!s)throw new Error('회의 단계를 찾을 수 없습니다.');
 const built=meetingContext(m,s,storeAllow);
 return {instructions:meetingInstructions(s,!!m.skillVersion,m.snapshot.prompts?.set,meetingCopyPack(m,s),isRecruitmentObjective(m.snapshot.campaign))+(s.correction?CORRECTION:''),input:JSON.stringify(built.value),maskingRecord:[...built.findings,...(m.snapshot.sourceMasking||[])]};
}
