import {campaignBudget,type Campaign} from './agency';
// 목록 카드의 '실행 준비 미완' 표시: 예산 확정·시작일·종료일 중 빠진 항목. 저장된 캠페인의 확정 표시 없는 0은 미확정이다.
// 홈 캠페인 표가 쓰므로 브리프 지시문(lib/brief.ts) 없이 따로 둔다(홈 첫 로딩 JS 예산, UX-PLAN-3 ⑩). lib/brief.ts가 다시 내보내고 브리프 질문 칸 이름도 여기서 가져간다.
export const executionGapFields={budget:'예산 상한',startDate:'시작일',endDate:'종료일'} as const;
export function executionGaps(c:Pick<Campaign,'budget'|'budgetConfirmedAt'|'startDate'|'endDate'>){return (['budget','startDate','endDate'] as const).filter(k=>k==='budget'?campaignBudget(c)===null:!c[k])}
export function executionGapLabels(c:Pick<Campaign,'budget'|'budgetConfirmedAt'|'startDate'|'endDate'>){return executionGaps(c).map(k=>executionGapFields[k]).join(', ')}
