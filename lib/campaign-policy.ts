import {isRecruitmentObjective,type Campaign} from './agency';

export const factDiscipline='브랜드 소개는 검증된 상품 사실이 아닙니다. 초기 브랜드 설명·이전 AI 작업물과 사용자가 확인한 사실·확인된 출처를 구분하세요. 미확정 조리 방식·가격·메뉴·오픈일은 광고 문구나 제작 전제로 승격하지 마세요. 주장을 [확인 사실: 입력 항목 이름/출처]·[가설: 반증 방법]·[자료 필요: 확인 담당/항목]으로 표시하세요. 자료가 없다는 사실만으로 특정 고객 장벽이 최대 병목이라고 단정하지 마세요.';
// 대표가 매번 회의 안건에 손으로 쓰던 기본 가드레일. 역할·회의 지시에 상시 포함한다.
export const answerDiscipline='선택지를 제시하거나 사용자에게 되묻지 마세요. 자료가 부족하면 조건부 초안을 완성하고, 확인할 항목·담당·시점을 확인 계획으로 분리해 적으세요.';
// (a) 근거 없는 광고 표현은 [확인 필요]로 표기한다. (b) 관리자가 거절한 사실(prohibited)은 [확인 필요]를 붙여도 쓰지 않는다. 두 규칙을 한 문장에 섞지 않는다.
// 입력 경로는 '확정 사실(evidence.facts.confirmed)'처럼 라벨을 앞세운다. 모델이 경로 대신 라벨을 본문에 쓰게 한다(품질 기준선 v1 internal_id_exposure 11/11).
// [확인 필요]는 표현과 같은 문장에 둔다(unsupported_claim_term은 문장 단위로 본다). 기준선 결함 예: '가장 인기 있는', '지금 오픈 할인으로 구매하세요'.
export const claimPolicy='광고 표현 규칙: 인기·판매 1위·최초·유일·할인·무료·오픈 혜택 표현(가장 인기 있는·오픈 할인 같은 변형 포함)은 확정 사실(evidence.facts.confirmed)에 근거가 없으면 확정 문구로 쓰지 말고 그 표현이 있는 같은 문장에 [확인 필요]로 표기하세요. 카피·헤드라인·CTA·대본·자막·예시 문안과 수정 제안 문구에도 같은 규칙을 적용하고, 근거가 없으면 그 표현을 빼고 쓰는 쪽을 우선하세요. 후보 사실(candidate)은 근거가 아닙니다. 거절된 사실(evidence.facts.prohibited, 관리자가 거절한 사실)의 표현은 [확인 필요]를 붙여도 광고 문구·제작 지시·가설의 전제로 쓰지 마세요.';
// 추천·보증·광고 표시·AI 생성물·전자상거래 표시 규칙. 표시 문구는 규제 가드레일(lib/graders/compliance-lexicon.ts)이 해소로 보는 문구와 맞춘다(#광고, AI 생성 표시, 배송·교환·환불).
// 사실·규제 판단은 지어내지 않고 [확인 필요] 표시로 남긴다. 규칙을 되풀이해 적어도 차단 가드레일에 걸리지 않게 '빼다·생략' 같은 표기 누락 표현을 쓰지 않는다.
// 후기는 예시로도 만들지 않고 자리만 표시한다(표시만 붙인 지어낸 후기는 옮기는 중에 표시가 빠질 수 있다). 규제 가드레일 fake_testimonial은 인용된 후기 문장 자체는 잡지 않는다.
// 가격: price_missing(warn)은 구매 유도 문구 옆 [가격 확인 필요]를 해소로 보지 않는다. 그래서 가격 미확정이면 구매 유도 문구 대신 가격 표시가 필요 없는 행동 유도를 쓰고, 구매 문구는 확인 계획으로 미룬다.
// 정책 문장 자체도 구매 유도 문구(구매하기·주문하기 등)를 쓰지 않아, 모델이 규칙을 되풀이해도 가격·판매 조건 경고가 생기지 않는다.
export const copyCompliancePolicy='추천·광고 표시 규칙: 고객 후기·추천사·평점·별점·체험담은 확정 사실이나 실제로 수집한 자료가 없으면 예시로도 만들지 마세요. 후기가 들어갈 자리가 필요하면 후기 문장을 만들지 말고 [실제 고객 후기 수집 후 삽입 — 확인 필요]로 자리만 표시하세요. 직원·지인에게 고객 후기를 부탁하거나 후기 작성에 혜택을 거는 방식은 제안하지 마세요. 협찬·체험단·제품 제공·유료 게시처럼 대가가 있는 콘텐츠의 문안에는 #광고·#협찬·유료 광고 포함 같은 광고 표시 문구를, 문자·알림톡 같은 광고 메시지 문안에는 맨 앞에 (광고)를 같은 문안에 넣고, 광고임을 숨기는 연출은 제안하지 마세요. AI로 생성·합성한 이미지·영상·음성 소재를 제안하면 같은 곳에 AI 생성 표시를 넣는다고 적으세요. 구매·주문 유도 문구는 확정 사실에 가격이 있을 때만 그 가격을 같은 문안에 적어 쓰세요. 가격이 확정되지 않았으면 카피·CTA에 구매·주문 유도 문구를 쓰지 말고 상품 보기·자세히 보기처럼 가격 표시가 필요 없는 행동 유도를 쓰고, 구매 유도 문구는 가격 확정 뒤 넣을 항목으로 확인 계획에 [가격 확인 필요]와 함께 적으세요. 배송·교환·환불 같은 판매 조건이 확정되지 않았으면 [판매 조건(배송·교환·환불) 확인 필요]를 함께 적으세요.';
// 상시 지시는 직원도 남길 수 있으므로 사실 근거나 금지 해제 권한이 없다. 역할·회의·브리프 지시문에 같은 문장으로 들어간다.
export const directivePolicy='상시 지시(evidence.directives)는 캠페인 팀이 남긴 작업 지시입니다(author: 관리자/직원). 사실 확정·금지 표현 규칙을 바꾸지 않는 범위에서 모든 산출물에 적용하세요. 상시 지시는 사실 근거가 아닙니다. 사실을 확정하거나 거절된 사실(evidence.facts.prohibited)·광고 표현 규칙을 무효화하지 못하며, 사실 근거는 확정 사실(evidence.facts.confirmed)뿐입니다. 지시 속 사실 주장은 [확인 필요]로 다루세요.';
// 결정적 검사용 표현 목록. 거절 사실 값(prohibited)과, 확정 사실에 근거가 없는 광고 표현(unverified)을 나눈다.
export const claimTerms=['인기','판매 1위','최초','유일','할인','무료','오픈 혜택'];
export type ClaimGuard={prohibited:string[];unverified:string[]};
const compact=(s:string)=>s.replace(/\s+/g,'').toLowerCase();
const factText=(f:unknown)=>{const x=(f&&typeof f==='object'?f:{}) as {key?:unknown;value?:unknown};return [x.key,x.value].filter(v=>typeof v==='string').join(' ')};
export function claimGuard(facts:{confirmed:unknown[];prohibited:unknown[]}):ClaimGuard{
 const supported=compact(facts.confirmed.map(factText).join(' '));
 const rejected=facts.prohibited.map(f=>(f as {value?:unknown}|null)?.value).filter((v):v is string=>typeof v==='string'&&v.trim().length>=2&&v.trim().length<=40).map(v=>v.trim());
 return {prohibited:[...new Set(rejected)].filter(t=>!supported.includes(compact(t))),unverified:claimTerms.filter(t=>!supported.includes(compact(t)))};
}
// 저장 전 신호: 거절 사실 값이 쓰였거나 근거 없는 광고 표현이 [확인 필요] 없이 쓰인 줄. 금지·삭제를 말하는 줄은 제외한다. 품질 판정이 아니라 검토 신호다.
export function unverifiedClaims(content:string,guard:ClaimGuard):string[]{
 const lines=content.split('\n').filter(l=>!/(?:쓰지|사용하지|넣지|표기하지)\s?(?:않|말)|금지|제외|삭제/.test(l));
 const marked=(l:string)=>/확인\s?필요/.test(l);
 return [...guard.prohibited.filter(t=>lines.some(l=>compact(l).includes(compact(t)))),...guard.unverified.filter(t=>lines.some(l=>!marked(l)&&compact(l).includes(compact(t))))];
}
// 정의 예시는 revisit_cohort_definition 채점기(정의 문장 안에 관찰 완료·코호트 기준)를 통과하는 형태다(품질 기준선 v1 4/11 실패).
export const measurementDiscipline='측정 정의: 30일 재방문율의 기준일은 각 고객의 첫 구매일입니다. 30일 관찰이 끝난 첫 구매 고객을 분모로, 같은 집단에서 첫 구매 후 30일 이내 두 번째 유료 구매한 고객을 분자로 계산하세요. 재방문율·재구매율을 정의하는 문장·산식·표 칸에는 분모가 관찰이 끝난 코호트(예: 첫 구매 뒤 30일이 지난 고객)라는 조건을 같은 곳에 쓰세요. 정의 예: 30일 재방문율 = 첫 구매 후 30일 이내 두 번째 유료 구매 고객 수 ÷ 첫 구매 후 30일 관찰이 끝난 코호트의 고객 수. 관찰 기간이 끝나지 않은 고객은 분모에 넣지 마세요. 미성숙 고객 집단은 별도 표시하고, 고객 식별이 없으면 고객 수나 재방문율을 계산한 척하지 마세요. 테스트·환불·중복 제외 기준을 먼저 정하세요. 유입 경로 귀속은 광고의 순증 효과가 아니며, 조회·길찾기·QR 조회는 유료 주문과 구분하세요.';

// 가맹 모집 objective 캠페인(트랙 R R3)의 근거·측정 규율. 코드 소유(레지스트리 단위 아님)이고 역할·회의 입력 channelPractice와 브리프 지시문 끝에 들어간다.
// R3b부터 objective 캠페인의 역할·개선 회의 지시문은 소비자 30일 재방문율 정의(measurementDiscipline) 자리에 이 정책을 넣고(lib/practice.ts evidenceDisciplineFor), 브리프 지시문은 그 정의 줄을 뺀다(lib/brief.ts briefInstructionsFor).
// objective 없는 캠페인의 지시문에는 measurementDiscipline이 그대로 남는다(바이트 동일). 비개선 회의는 지시문에 근거 규율이 없으므로 이 정책의 '이 캠페인에 적용하지 마세요' 문장은 입력 쪽에 그대로 둔다.
// 모델이 되풀이해도 가맹 모집 판정(lib/franchise-compliance.ts)·checkCompliance 가맹 범주·광고 표현 검사·재방문율 정의 채점기에 걸리지 않게
// 금액·기간 수치와 '창업비용' 같은 주장 낱말을 쓰지 않는다(tests/franchise-objective.test.mjs). 수치는 확정 사실만 쓰게 하고 제공·대기 전 계약 유도를 막는다(결정 25, H1~H6).
// 사실 표시 '[사실: 항목 · 확정 사실]'은 가맹 판정 H8('[사실' 표지)과 채점기의 확정 표시(MARKED '확정')를 함께 만족한다. 후기 자리표시는 경제적 이해관계 문구를 함께 적어 추천·보증 표시 경고에 걸리지 않는다.
export const franchiseEvidencePolicy='가맹 모집 규칙: 이 캠페인의 목표 행동은 소비자 구매가 아니라 가맹 희망자의 문의와 상담입니다. 수익·매출을 보장하거나 예상하는 표현을 쓰지 마세요. 수익·매출에 관한 질문에는 정보공개서와 서면 절차로 답한다고만 적고 수치를 쓰지 마세요. 매장 수, 가맹 조건과 비용 항목의 수치는 정보공개서 버전과 기준일이 확정된 사실(확정 사실)에 있는 값만 쓰고, 그 문장에 [사실: 항목 · 확정 사실]을, 전망·장점 문장에는 [의견]을 붙이세요(기준일은 발행 캡션의 정보공개서 각주가 채우므로 날짜를 지어 쓰지 마세요). 정보공개서·계약서안을 제공하고 대기기간이 끝나기 전에는 계약 체결이나 가맹금 납부를 권하는 문구를 쓰지 마세요. 점주 후기는 실제 점주의 동의와 경제적 이해관계 표시가 있을 때만 쓰고, 없으면 후기 문장을 만들지 말고 [점주 후기 자리 — 동의·경제적 이해관계 표시 확인 필요]로 자리만 표시하세요. 모집 측정 정의: 소비자 30일 재방문율 정의는 이 캠페인에 적용하지 마세요. 모집 퍼널은 문의 → 첫 연락 → 상담 → 설명회 → 정보공개서 제공 → 대기기간 → 계약서안 제공 → 계약 → 개점 단계로 나누고 단계 전환은 문의 월 코호트로 보세요. CPL은 같은 채널의 모집 지출 ÷ 같은 채널의 문의 수, 계약당 비용은 기간 모집 지출 합계 ÷ 같은 문의 코호트의 계약 수입니다. 지출이나 분모를 모르면 계산한 척하지 말고 자료 필요로 남기고, 표본이 작으면 비율 대신 건수와 표본 부족을 적으세요. 유입 코드 귀속은 광고의 순증 효과가 아니며, 광고 플랫폼이 보고한 전환 수는 원장의 문의 수와 구분하세요.';

export function campaignEvidencePolicy(c:Pick<Campaign,'goal'|'products'|'stores'|'channels'|'objective'>){
 if(isRecruitmentObjective(c))return franchiseEvidencePolicy;
 const service=[c.goal,c.products].join(' ');
 const specific=/물품보관함|락커|\blocker\b/i.test(service)
  ?'이번 서비스가 물품보관함인 경우에만 이용 완료와 사용 시간/가동 가능 시간을 분리해 측정하세요.'
  :'이번 제품·서비스의 실제 목표 행동만 측정하고 관련 없는 업종의 지표를 추가하지 마세요.';
 return specific;
}
