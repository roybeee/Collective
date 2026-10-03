// 상품 리서치 저장 kind(records 표). lib/record-kinds.ts에 같은 이름으로 등록돼 있다.
// 이름은 tests/record-kinds.test.mjs 스캐너가 읽는 kinds 객체 형태를 따른다.
const kinds={
 credential:'pr_credential',
 snapshot:'pr_snapshot',
 keywordGroup:'pr_keyword_group',
 product:'pr_product',
 score:'pr_score',
 brief:'pr_brief',
 decision:'pr_decision',
 backtest:'pr_backtest',
 quota:'pr_quota',
 collectState:'pr_collect_state',
 settings:'pr_settings',
 request:'pr_request',
 riskReview:'pr_risk_review',
 quarantine:'pr_quarantine',
 scoreIndex:'pr_score_index',
} as const;
export const PR_KINDS=kinds;
export type PrKind=typeof PR_KINDS[keyof typeof PR_KINDS];
