// 트랙 R R6d 워크스페이스 할 일(가맹 모집) 표시 정의. /api/workspace 응답의 franchiseTasks(브랜드 id와 건수만, 리드 없음)를 다음 할 일(NextTask)로 옮긴다.
// 첫 화면(app/workspace.tsx → lib/workspace-metrics.ts)이 불러오므로 import가 없다(판정 규칙 묶음을 첫 화면 번들에 싣지 않는다, tests/franchise-workspace.test.mjs WT-S1).
// 판정은 lib/franchise-workspace.ts, 읽기와 스위치(r_franchise)는 lib/franchise-workspace-server.ts가 한다. 판정은 COLLECTIVE 휴리스틱 · 법률 자문 아님(결정 20 보류).
// R15a-3(2026-09-28): event_followup — 시작 뒤 48시간 안의 설명회·견학·박람회(행사 뒤 연락·불참자 재안내는 사람이 한다).
export const FRANCHISE_TASKS=['unanswered','contract_soon','evidence_gap','registration_due','asset_review','event_followup'] as const;
export type FranchiseTaskKind=typeof FRANCHISE_TASKS[number];
// 계약 가능 시각이 지금 뒤 이 일수 안이면 할 일이다(계획 R6 '계약 가능일 3일 전').
export const CONTRACT_SOON_DAYS=3;
// 정보공개서 변경등록 기한이 이 일수 안이거나 지났으면 할 일이다(계획 R6 '변경등록 기한 30일 전').
export const REGISTRATION_DUE_DAYS=30;
// H10: 같은 승인 자료 판에 귀속된 가맹희망자가 H10_LIMIT(30명, 과징금 고시 '피해 30명 이상')에 이르기 전, H10_REVIEW_AT명부터 재검토 할 일을 띄운다.
export const H10_REVIEW_AT=20,H10_LIMIT=30;
// 행사 뒤 연락 창: 행사 시작부터 이 시간 안(계획 R15 '행사 뒤 48시간 안 사람 연락').
export const EVENT_FOLLOWUP_HOURS=48;
export type FranchiseTaskTab='leads'|'settings'|'assets'|'events';
export type FranchiseTaskItem={task:FranchiseTaskKind;count:number;brandId:string};
export type FranchiseWorkspaceTasks={items:FranchiseTaskItem[];ruleVersion:string;disclaimer:string};
export type FranchiseNextTask={kind:'franchise';task:FranchiseTaskKind;count:number;brandId:string;tab:FranchiseTaskTab;label:string;detail:string;disclaimer:string};
const DISCLAIMER_TEXT='COLLECTIVE 휴리스틱 · 법률 자문 아님';
export const FRANCHISE_TASK_TEXT:Readonly<Record<FranchiseTaskKind,{label:string;tab:FranchiseTaskTab;detail:(n:number)=>string}>>={
 unanswered:{label:'미응대 문의',tab:'leads',detail:n=>`첫 연락 기록이 없는 문의 ${n}건`},
 contract_soon:{label:`계약 가능일 ${CONTRACT_SOON_DAYS}일 전`,tab:'leads',detail:n=>`${CONTRACT_SOON_DAYS}일 안에 계약 가능 시각이 되는 리드 ${n}건`},
 evidence_gap:{label:'계약 증빙 결손',tab:'leads',detail:n=>`계약 기록이 있지만 지금 증빙으로 계약 게이트를 통과하지 못하는 리드 ${n}건`},
 registration_due:{label:`변경등록 기한 ${REGISTRATION_DUE_DAYS}일 전`,tab:'settings',detail:n=>`정보공개서 변경등록 기한이 ${REGISTRATION_DUE_DAYS}일 안이거나 지난 브랜드 ${n}곳`},
 asset_review:{label:'모집 자료 재검토(H10)',tab:'assets',detail:n=>`귀속 가맹희망자가 ${H10_REVIEW_AT}명 이상인 승인 자료 판 ${n}개(${H10_LIMIT}명 전에 재검토)`},
 event_followup:{label:`행사 뒤 ${EVENT_FOLLOWUP_HOURS}시간 연락`,tab:'events',detail:n=>`시작 뒤 ${EVENT_FOLLOWUP_HOURS}시간 안의 설명회·견학·박람회 ${n}건(참석자 연락·불참자 재안내)`},
};
const isTask=(v:unknown):v is FranchiseTaskKind=>typeof v==='string'&&(FRANCHISE_TASKS as readonly string[]).includes(v);
// 응답은 외부 입력으로 보고 모양을 확인한다. 알 수 없는 할 일·양의 정수가 아닌 건수·빈 브랜드 id는 버린다. 순서는 FRANCHISE_TASKS를 따른다.
export function franchiseNextTasks(payload:FranchiseWorkspaceTasks|null|undefined):FranchiseNextTask[]{
 const items=payload&&Array.isArray(payload.items)?payload.items:[],disclaimer=typeof payload?.disclaimer==='string'&&payload.disclaimer?payload.disclaimer:DISCLAIMER_TEXT;
 return FRANCHISE_TASKS.flatMap(task=>{
  const item=items.find(i=>!!i&&isTask(i.task)&&i.task===task&&Number.isSafeInteger(i.count)&&i.count>0&&typeof i.brandId==='string'&&i.brandId!=='');
  if(!item)return [];
  const text=FRANCHISE_TASK_TEXT[task];
  return [{kind:'franchise' as const,task,count:item.count,brandId:item.brandId,tab:text.tab,label:text.label,detail:text.detail(item.count),disclaimer}];
 });
}
