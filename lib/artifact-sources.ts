// X7 신뢰 UI의 응답 형식(화면·서버 공용 타입과 표시 이름). 계산은 lib/artifact-sources-server.ts, 화면은 components/app/citation-pill.tsx 등.
import type {RefKind} from './citation-refs';

// 인용 출처 한 건. observedAt: 자료 관측일·사실 확인일. validUntil: 사실 유효기한. brandId가 있으면 브랜드 아카이브로 연다. url은 http(s)만 싣는다.
export type CitationSource={kind:RefKind;label:string;title:string;observedAt:string|null;validUntil:string|null;url:string|null;brandId:string|null;value:string|null;found:boolean};
// AI 출처 배지 팝오버. 모두 저장된 작업물·실행 기록에서 읽는다(없으면 null).
export type OriginInfo={origin:string;originLabel:string;role:string;roleName:string;via:'role'|'meeting'|'manual'|'unknown';model:string|null;generatedAt:string|null;editedAt:string|null;briefVersion:number|null;learningRules:number|null;disclosure:{applies:boolean;line:string|null;virtualPersonLine:string|null}};
export type ComplianceIssueView={category:string;ruleId:string;severity:'block'|'warn';title:string;excerpt:string;sources:{title:string;url:string}[]};
export type ComplianceCategoryView={category:string;label:string;pass:number;warn:number;block:number};
// status not_run: 줄 수가 채점 한도(lib/online-grading.ts MAX_GRADED_LINES)를 넘어 점검하지 않았다.
export type ComplianceView={status:'checked'|'not_run';lines:number;checkedAt:string;gradedAt:string|null;notice:string;categories:ComplianceCategoryView[];issues:ComplianceIssueView[]};
export type ArtifactSources={artifactId:string;version:number;brandId:string;refs:Record<string,CitationSource>;factKeys:string[];origin:OriginInfo;compliance:ComplianceView};
export type ArtifactScoreSummary={artifactId:string;artifactVersion:number;score:number;band:string};

export const SOURCE_KIND_LABELS:Record<RefKind,string>={archive:'내 브랜드 자료',observation:'내 브랜드 자료',diagnosis:'내 브랜드 자료',brief:'캠페인 기록',artifact:'캠페인 기록',fact:'확정 사실',external:'외부 출처'};
export const COMPLIANCE_CATEGORY_LABELS:Record<string,string>={platform_review:'플랫폼 리뷰',endorsement:'추천·보증',ai_label:'AI 생성물 표시',ad_message:'광고성 메시지',food_claim:'식품 표시',cosmetic_claim:'화장품 표시',ecommerce_terms:'전자상거래',rights:'권리 확인',franchise_recruit:'가맹 모집'};
export const SEVERITY_LABELS={block:'차단',warn:'주의'} as const;
