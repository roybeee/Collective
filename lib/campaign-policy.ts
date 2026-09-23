import type {Campaign} from './agency';

export const factDiscipline='브랜드 소개는 검증된 상품 사실이 아닙니다. 초기 브랜드 설명·이전 AI 작업물과 사용자가 확인한 사실·확인된 출처를 구분하세요. 미확정 조리 방식·가격·메뉴·오픈일은 광고 문구나 제작 전제로 승격하지 마세요. 주장을 [확인 사실: 입력 필드/출처]·[가설: 반증 방법]·[자료 필요: 확인 담당/항목]으로 표시하세요. 자료가 없다는 사실만으로 특정 고객 장벽이 최대 병목이라고 단정하지 마세요.';
export const measurementDiscipline='측정 정의: 30일 재방문율의 기준일은 각 고객의 첫 구매일입니다. 30일 관찰이 끝난 첫 구매 고객을 분모로, 같은 집단에서 첫 구매 후 30일 이내 두 번째 유료 구매한 고객을 분자로 계산하세요. 미성숙 고객 집단은 별도 표시하고, 고객 식별이 없으면 고객 수나 재방문율을 계산한 척하지 마세요. 테스트·환불·중복 제외 기준을 먼저 정하세요. 유입 경로 귀속은 광고의 순증 효과가 아니며, 조회·길찾기·QR 조회는 유료 주문과 구분하세요.';

export function campaignEvidencePolicy(c:Pick<Campaign,'goal'|'products'|'stores'|'channels'>){
 const service=[c.goal,c.products].join(' ');
 const specific=/물품보관함|락커|\blocker\b/i.test(service)
  ?'이번 서비스가 물품보관함인 경우에만 이용 완료와 사용 시간/가동 가능 시간을 분리해 측정하세요.'
  :'이번 제품·서비스의 실제 목표 행동만 측정하고 관련 없는 업종의 지표를 추가하지 마세요.';
 return specific;
}
