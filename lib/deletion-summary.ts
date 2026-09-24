// 캠페인 삭제 영향 조회(GET /api/campaigns/[id]/deletion, lib/server.ts campaignDeletionPreview)를 대화상자 문구로 바꾸는 순수 모듈.
// kind별 삭제·보존 정책은 lib/record-kinds.ts가 정한다. 여기서는 사람이 읽는 이름으로 묶고 0건은 뺀다.
// 결정 7: 바이럴 출처 학습 규칙은 지우지 않고 종료 상태와 원 캠페인 삭제 표시로 남긴다. 원천 실험은 원문을 뺀 요약만 동결한다.
// F4b-2: 평가 신호는 원문 없이 비식별로 90일 보관하고(archive), 소유자는 학습 자산까지 완전 삭제를 고를 수 있다(purge: 추가로 지우는 건수·만들지 않는 건수).
// archive·purge가 없는 응답(이전 서버)은 보관 줄과 완전 삭제 선택을 보이지 않는다. 완전 삭제를 고르면(deletionSummary(p,{purge:true})) 보존 줄에서 완전 삭제가 지우거나 만들지 않는 건수를 빼고 보관 줄을 없앤다.
export type DeletionPreview={campaignId:string;version:number;deletable:boolean;blockedReason:string|null;deleted:Record<string,number>;retained:Record<string,number>;jobs:number;totals:{deleted:number;retained:number};
 archive?:{signals:number;retentionDays:number};purge?:{deleted:Record<string,number>;skipped:Record<string,number>}};
type Group={label:string;kinds:readonly string[];note?:string};
// 실행은 records가 아닌 jobs 테이블 건수다. kind 이름([a-z_])과 겹치지 않는 키로 묶는다.
const JOBS='#jobs';
// 작업물·실행·회의·성과를 앞에 둔다. 이 넷 중 하나라도 있으면 캠페인 제목을 입력해야 삭제할 수 있다.
const WORK_KINDS=['artifact',JOBS,'team_meeting','metric'];
const deletedGroups:readonly Group[]=[
 {label:'작업물',kinds:['artifact']},{label:'실행',kinds:[JOBS]},{label:'회의',kinds:['team_meeting']},{label:'성과',kinds:['metric']},
 {label:'작업물 이전 버전',kinds:['history']},{label:'온라인 채점 결과',kinds:['grading']},{label:'바이럴 실험',kinds:['viral_experiment']},
 {label:'실험 정정·수집 기록',kinds:['experiment_revision','measurement_draft','measurement_source','learning_guidance']},
 {label:'브리프 초안',kinds:['brief_draft']},{label:'상시 지시',kinds:['campaign_directive']},{label:'캠페인 이력',kinds:['event']},
 {label:'AI 요청·응답 원문',kinds:['hermes_submission','openai_submission','learning_task','learning_job_output','role_output_contract','role_output_failure','learning_snapshot','campaign_prompt_pin']},
 {label:'연속 실행·발행 설정',kinds:['campaign_sequence','background_attempt','execution_limits']},{label:'캠페인 토큰 상한',kinds:['token_budget']},
];
// 제작·발행·주문 귀속 기록(blocksDeletion)이 있으면 삭제 자체가 거부되므로 대화상자는 사유만 보이고 보존 목록을 쓰지 않는다.
const retainedGroups:readonly Group[]=[
 {label:'학습 규칙',kinds:['learning_rule'],note:'종료 표시로 남김, 원 캠페인 삭제 표시'},
 {label:'실험 요약',kinds:['viral_experiment_summary'],note:'원문을 뺀 요약으로 동결'},
 {label:'점포 실험',kinds:['store_experiment']},
 {label:'사람 판정 로그',kinds:['review_decision'],note:'사유 코드·판정만, 검토 메모 원문 없음'},
 // 평가 골든셋(eval_case)은 동결한 역할 요청 원문을 담고 완전 삭제에서도 남는다(결정 6·7 취지). 소유자가 평가 화면에서 개별 삭제한다.
 {label:'평가 골든셋',kinds:['eval_case'],note:'동결한 역할 요청 원문 포함, 완전 삭제에도 남음, 평가 화면에서 개별 삭제'},
];
// 캠페인 브리프 자신은 대화상자 제목이 말하므로 목록에 넣지 않는다.
const SELF='campaign';
const positive=(n:unknown)=>typeof n==='number'&&Number.isFinite(n)&&n>0?n:0;
const sum=(counts:Record<string,number>,kinds:readonly string[])=>kinds.reduce((s,k)=>s+positive(counts[k]),0);
function items(groups:readonly Group[],counts:Record<string,number>){
 const known=new Set([SELF,...groups.flatMap(g=>g.kinds)]),other=sum(counts,Object.keys(counts).filter(k=>!known.has(k)));
 const named=groups.map(g=>({g,n:sum(counts,g.kinds)})).filter(x=>x.n>0).map(({g,n})=>`${g.label} ${n}건${g.note?`(${g.note})`:''}`);
 return other?[...named,`기타 기록 ${other}건`]:named;
}
// 완전 삭제를 고르면 기본 삭제보다 더 지우는 것과 새로 남기지 않는 것.
const purgeGroups:readonly Group[]=[
 {label:'학습 규칙',kinds:['learning_rule'],note:'종료 표시 대신 삭제'},{label:'사람 판정 로그',kinds:['review_decision']},
];
const skippedGroups:readonly Group[]=[{label:'실험 요약',kinds:['viral_experiment_summary']},{label:'비식별 평가 신호',kinds:['deidentified_signal']}];
function purgeLine(purge:NonNullable<DeletionPreview['purge']>){
 const deleted=items(purgeGroups,purge.deleted),skipped=items(skippedGroups,purge.skipped);
 if(!deleted.length&&!skipped.length)return '완전 삭제: 추가로 지우거나 남기지 않을 학습 자산이 없습니다.';
 return '완전 삭제: '+[deleted.length?deleted.join('·')+'을 함께 지웁니다':'',skipped.length?skipped.join('·')+'을 남기지 않습니다':''].filter(Boolean).join('. ')+'.';
}
const deletedCounts=(p:DeletionPreview)=>({...p.deleted,[JOBS]:p.jobs});
// 완전 삭제 때 남는 것: 보존 건수에서 완전 삭제가 지우는 건수(purge.deleted)와 만들지 않는 건수(purge.skipped)를 뺀다.
const retainedOnPurge=(p:DeletionPreview)=>p.purge?Object.fromEntries(Object.entries(p.retained).map(([k,n])=>[k,Math.max(0,positive(n)-positive(p.purge!.deleted[k])-positive(p.purge!.skipped[k]))])):p.retained;
const BLOCKED='이 캠페인은 지금 삭제할 수 없습니다.';
export function deletionSummary(p:DeletionPreview,{purge=false}:{purge?:boolean}={}){
 const deleted=items(deletedGroups,deletedCounts(p)),retained=items(retainedGroups,purge?retainedOnPurge(p):p.retained),signals=purge?0:positive(p.archive?.signals);
 return {
  deleted:deleted.length?'삭제: '+deleted.join('·'):'삭제: 캠페인 브리프만 지웁니다',
  retained:retained.length?'보존: '+retained.join('·'):null,
  archived:signals?`비식별 보관: 평가 신호 ${signals}건(작업물 본문·캠페인 이름·메모 없이 가명 키로 ${p.archive!.retentionDays}일 보관)`:null,
  purge:p.purge?purgeLine(p.purge):null,
  blockedReason:p.deletable?null:(p.blockedReason||BLOCKED),
 };
}
export const needsTitleConfirmation=(p:DeletionPreview)=>sum(deletedCounts(p),WORK_KINDS)>0;
// 삭제 가능하고, 작업물·실행·회의·성과가 있으면 입력한 제목이 캠페인 제목과 같을 때(앞뒤 공백 무시)만 삭제 버튼을 연다.
export const canConfirmDeletion=(p:DeletionPreview,title:string,typed:string)=>p.deletable&&(!needsTitleConfirmation(p)||typed.trim()===title.trim());
// 응답 모양을 확인한다. 어긋나면 건수를 0으로 단정하지 않고 오류로 본다.
const isCounts=(x:unknown):x is Record<string,number>=>!!x&&typeof x==='object'&&!Array.isArray(x)&&Object.values(x).every(n=>typeof n==='number');
export const LOAD_FAILED='삭제 영향을 확인하지 못했습니다. 다시 시도해 주세요.';
const badArchive=(a:unknown)=>a!==undefined&&(!a||typeof a!=='object'||typeof (a as {signals?:unknown}).signals!=='number'||typeof (a as {retentionDays?:unknown}).retentionDays!=='number');
const badPurge=(u:unknown)=>u!==undefined&&(!u||typeof u!=='object'||!isCounts((u as {deleted?:unknown}).deleted)||!isCounts((u as {skipped?:unknown}).skipped));
export function readDeletionPreview(x:unknown):DeletionPreview{
 const p=x as Partial<DeletionPreview>|null;
 if(!p||typeof p!=='object'||typeof p.deletable!=='boolean'||typeof p.version!=='number'||typeof p.jobs!=='number'||!isCounts(p.deleted)||!isCounts(p.retained)||(p.blockedReason!==null&&typeof p.blockedReason!=='string')||badArchive(p.archive)||badPurge(p.purge))throw new Error(LOAD_FAILED);
 return p as DeletionPreview;
}
// 조회 실패 판정. 404는 다른 탭 등에서 이미 삭제된 캠페인이다(삭제 요청도 tombstone을 보고 멱등하게 끝난다). 다시 시도해도 404이므로 목록 새로 고침을 권한다.
export const ALREADY_DELETED='이미 삭제된 캠페인입니다. 목록을 새로 고쳐 주세요.';
export const previewFailure=(status:number,error?:string|null)=>status===404?{gone:true,message:ALREADY_DELETED}:{gone:false,message:error||LOAD_FAILED};
// 삭제 직전에 다시 조회한 결과를 대화상자를 열 때 확인한 결과와 비교한다. 서버는 제목 확인을 강제하지 않으므로, 그 사이 기록이 늘거나 캠페인이 바뀌었으면 삭제하지 않고 다시 확인하게 한다.
export const STALE_CAMPAIGN='캠페인이 다른 곳에서 변경됐습니다. 창을 닫고 페이지를 새로 고친 뒤 다시 삭제해 주세요.';
export const COUNTS_CHANGED='삭제할 기록이 바뀌었습니다. 새 건수를 확인한 뒤 다시 삭제해 주세요.';
const countsDiffer=(a:Record<string,number>,b:Record<string,number>)=>[...new Set([...Object.keys(a),...Object.keys(b)])].some(k=>positive(a[k])!==positive(b[k]));
export function recheckDeletion(seen:DeletionPreview,fresh:DeletionPreview,campaignVersion:number):string|null{
 if(fresh.version!==campaignVersion)return STALE_CAMPAIGN;
 if(!fresh.deletable)return fresh.blockedReason||BLOCKED;
 return countsDiffer(deletedCounts(seen),deletedCounts(fresh))?COUNTS_CHANGED:null;
}
// 완전 삭제를 고른 경우 추가로 지울 건수(규칙·판정 로그)도 확인한 때와 같아야 한다.
export const recheckPurge=(seen:DeletionPreview,fresh:DeletionPreview)=>countsDiffer(seen.purge?.deleted||{},fresh.purge?.deleted||{})?COUNTS_CHANGED:null;
