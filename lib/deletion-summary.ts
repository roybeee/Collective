// 캠페인 삭제 영향 조회(GET /api/campaigns/[id]/deletion, lib/server.ts campaignDeletionPreview)를 대화상자 문구로 바꾸는 순수 모듈.
// kind별 삭제·보존 정책은 lib/record-kinds.ts가 정한다. 여기서는 사람이 읽는 이름으로 묶고 0건은 뺀다.
// 결정 7: 바이럴 출처 학습 규칙은 지우지 않고 종료 상태와 원 캠페인 삭제 표시로 남긴다. 원천 실험은 원문을 뺀 요약만 동결한다.
export type DeletionPreview={campaignId:string;version:number;deletable:boolean;blockedReason:string|null;deleted:Record<string,number>;retained:Record<string,number>;jobs:number;totals:{deleted:number;retained:number}};
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
 {label:'AI 요청·응답 원문',kinds:['hermes_submission','openai_submission','learning_task','learning_job_output','role_output_contract','role_output_failure','learning_snapshot']},
 {label:'연속 실행·발행 설정',kinds:['campaign_sequence','background_attempt','execution_limits']},{label:'캠페인 토큰 상한',kinds:['token_budget']},
];
// 제작·발행·주문 귀속 기록(blocksDeletion)이 있으면 삭제 자체가 거부되므로 대화상자는 사유만 보이고 보존 목록을 쓰지 않는다.
const retainedGroups:readonly Group[]=[
 {label:'학습 규칙',kinds:['learning_rule'],note:'종료 표시로 남김, 원 캠페인 삭제 표시'},
 {label:'실험 요약',kinds:['viral_experiment_summary'],note:'원문을 뺀 요약으로 동결'},
 {label:'점포 실험',kinds:['store_experiment']},
 {label:'사람 판정 로그',kinds:['review_decision'],note:'사유 코드·판정만, 검토 메모 원문 없음'},
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
const deletedCounts=(p:DeletionPreview)=>({...p.deleted,[JOBS]:p.jobs});
const BLOCKED='이 캠페인은 지금 삭제할 수 없습니다.';
export function deletionSummary(p:DeletionPreview){
 const deleted=items(deletedGroups,deletedCounts(p)),retained=items(retainedGroups,p.retained);
 return {
  deleted:deleted.length?'삭제: '+deleted.join('·'):'삭제: 캠페인 브리프만 지웁니다',
  retained:retained.length?'보존: '+retained.join('·'):null,
  blockedReason:p.deletable?null:(p.blockedReason||BLOCKED),
 };
}
export const needsTitleConfirmation=(p:DeletionPreview)=>sum(deletedCounts(p),WORK_KINDS)>0;
// 삭제 가능하고, 작업물·실행·회의·성과가 있으면 입력한 제목이 캠페인 제목과 같을 때(앞뒤 공백 무시)만 삭제 버튼을 연다.
export const canConfirmDeletion=(p:DeletionPreview,title:string,typed:string)=>p.deletable&&(!needsTitleConfirmation(p)||typed.trim()===title.trim());
// 응답 모양을 확인한다. 어긋나면 건수를 0으로 단정하지 않고 오류로 본다.
const isCounts=(x:unknown):x is Record<string,number>=>!!x&&typeof x==='object'&&!Array.isArray(x)&&Object.values(x).every(n=>typeof n==='number');
export const LOAD_FAILED='삭제 영향을 확인하지 못했습니다. 다시 시도해 주세요.';
export function readDeletionPreview(x:unknown):DeletionPreview{
 const p=x as Partial<DeletionPreview>|null;
 if(!p||typeof p!=='object'||typeof p.deletable!=='boolean'||typeof p.version!=='number'||typeof p.jobs!=='number'||!isCounts(p.deleted)||!isCounts(p.retained)||(p.blockedReason!==null&&typeof p.blockedReason!=='string'))throw new Error(LOAD_FAILED);
 return p as DeletionPreview;
}
// 조회 실패 판정. 404는 다른 탭 등에서 이미 삭제된 캠페인이다(삭제 요청도 tombstone을 보고 멱등하게 끝난다). 다시 시도해도 404이므로 목록 새로 고침을 권한다.
export const ALREADY_DELETED='이미 삭제된 캠페인입니다. 목록을 새로 고쳐 주세요.';
export const previewFailure=(status:number,error?:string|null)=>status===404?{gone:true,message:ALREADY_DELETED}:{gone:false,message:error||LOAD_FAILED};
// 삭제 직전에 다시 조회한 결과를 대화상자를 열 때 확인한 결과와 비교한다. 서버는 제목 확인을 강제하지 않으므로, 그 사이 기록이 늘거나 캠페인이 바뀌었으면 삭제하지 않고 다시 확인하게 한다.
export const STALE_CAMPAIGN='캠페인이 다른 곳에서 변경됐습니다. 창을 닫고 페이지를 새로 고친 뒤 다시 삭제해 주세요.';
export const COUNTS_CHANGED='삭제할 기록이 바뀌었습니다. 새 건수를 확인한 뒤 다시 삭제해 주세요.';
export function recheckDeletion(seen:DeletionPreview,fresh:DeletionPreview,campaignVersion:number):string|null{
 if(fresh.version!==campaignVersion)return STALE_CAMPAIGN;
 if(!fresh.deletable)return fresh.blockedReason||BLOCKED;
 const a:Record<string,number>=deletedCounts(seen),b:Record<string,number>=deletedCounts(fresh);
 return [...new Set([...Object.keys(a),...Object.keys(b)])].some(k=>positive(a[k])!==positive(b[k]))?COUNTS_CHANGED:null;
}
