// 작업물 상태 머신(벤치마크 P5) 순수 모듈. 작업물 상태와 그 작업물 카피를 쓴 발행 기록(lib/execution.ts)에서 단계를 읽기만 한다(쓰기 없음).
// 흐름: 초안(AI 작성) → 검토 중 → 수정 요청 ↔ 검토 중 → 승인 → 발행 예약 → 발행됨. 수정 요청은 되돌이 단계라 지나간 뒤에는 '지나감'이 아니라 '건너뜀/거침'으로 둔다.
// 발행 단계는 발행 기록(copy.artifactId·artifactVersion이 이 판)만 본다. 다른 판의 발행, 초안·실패·취소·공급자 확인 필요 발행은 단계를 올리지 않는다.
import type {PublicationStatus} from './execution';

export type LifecycleStageId='draft'|'review'|'revision'|'approved'|'scheduled'|'published';
export type LifecycleState='done'|'current'|'todo'|'skipped';
export type LifecycleStage={id:LifecycleStageId;state:LifecycleState};
export type PublicationMark='scheduled'|'published'|null;
export const LIFECYCLE_ORDER:readonly LifecycleStageId[]=['draft','review','revision','approved','scheduled','published'];
// 예약으로 보는 발행 상태: 실행 승인(예약 시각 있음)·접수 중·접수 여부 미확인·예약 접수. 게시 확인(published)은 발행됨이다.
export const SCHEDULED_PUBLICATION:readonly PublicationStatus[]=['approved','submitting','uncertain','accepted'];
type PublicationLike={status:string;copy?:{artifactId:string;artifactVersion:number}};
// 한 작업물 판의 발행 표시. 같은 판의 발행 중 가장 앞선 단계(발행됨 > 예약)를 고른다.
export function publicationMark(artifact:{id:string;version:number},publications:readonly PublicationLike[]):PublicationMark{
 const mine=publications.filter(p=>p.copy?.artifactId===artifact.id&&p.copy.artifactVersion===artifact.version);
 if(mine.some(p=>p.status==='published'))return 'published';
 return mine.some(p=>(SCHEDULED_PUBLICATION as readonly string[]).includes(p.status))?'scheduled':null;
}
// 현재 단계: 발행 표시가 있으면 그것, 아니면 작업물 상태(approved·revision·review). 그 밖(초안·이전 기록·모르는 값)은 초안이다.
export function currentStage(status:string,mark:PublicationMark):LifecycleStageId{
 if(mark)return mark;
 if(status==='approved')return 'approved';
 if(status==='revision')return 'revision';
 return status==='review'?'review':'draft';
}
// 단계 목록. 수정 요청은 지금 그 단계일 때만 current이고, 그 뒤 단계로 갔으면 거쳤는지 알 수 없으므로 skipped(선택 단계)로 둔다.
export function artifactLifecycle(status:string,mark:PublicationMark=null):{current:LifecycleStageId;stages:LifecycleStage[]}{
 const current=currentStage(status,mark),at=LIFECYCLE_ORDER.indexOf(current);
 const stages=LIFECYCLE_ORDER.map((id,i):LifecycleStage=>{
  if(id===current)return {id,state:'current'};
  if(id==='revision')return {id,state:i<at?'skipped':'todo'};
  // 수정 요청 중이면 검토 중은 지나간 단계다(수정 요청 ↔ 검토 중).
  return {id,state:i<at?'done':'todo'};
 });
 return {current,stages};
}
