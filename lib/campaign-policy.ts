import type {Campaign} from './agency';

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

export function campaignEvidencePolicy(c:Pick<Campaign,'goal'|'products'|'stores'|'channels'>){
 const service=[c.goal,c.products].join(' ');
 const specific=/물품보관함|락커|\blocker\b/i.test(service)
  ?'이번 서비스가 물품보관함인 경우에만 이용 완료와 사용 시간/가동 가능 시간을 분리해 측정하세요.'
  :'이번 제품·서비스의 실제 목표 행동만 측정하고 관련 없는 업종의 지표를 추가하지 마세요.';
 return specific;
}
