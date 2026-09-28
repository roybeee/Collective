import type {ArchiveSource,ArchiveCategory} from './archive';
import {industryQuestion,type InterviewIndustryId} from './brand-interview-industries';
export const interviewSections = [
 {
  "id": "story",
  "title": "브랜드의 시작과 약속",
  "category": "brand",
  "question": "광고에서 내세울 강점 1개를 고르면 무엇인가요? 경쟁 대안과 다른 실제 운영 방식과 이를 입증할 자료를 알려주세요.",
  "why": "막연한 자부심만으로는 고객이 구매할 이유나 믿을 근거를 만들 수 없습니다.",
  "decision": "핵심 광고 메시지 1개와 증거 소재를 선택합니다.",
  "fields": "강점 / 고객 이득 / 경쟁 대비 차이 / 증거 자료·사용 허락",
  "example": "주문 후 조리 / 따뜻하게 수령 / 조리 과정 촬영 가능, 소요 시간은 1주간 측정 필요",
  "followups": [
   "고객이 그 강점을 언급한 최근 후기나 상담 문장을 2개 찾아주세요. 언제, 어떤 상품에 대한 말인가요?",
   "그 강점이 적용되지 않는 상품·지점·시간·조건은 무엇인가요?",
   "창업 계기 중 지금의 제품·서비스 방식으로 이어진 선택 하나와 관련 사진·기록이 있나요?"
  ],
  "followupGuides": [
   {
    "question": "고객이 그 강점을 언급한 최근 후기나 상담 문장을 2개 찾아주세요. 언제, 어떤 상품에 대한 말인가요?",
    "why": "내부의 자랑과 고객의 실제 선택 이유가 일치하는지 확인합니다.",
    "decision": "광고 첫 문장과 후기 소재를 정합니다."
   },
   {
    "question": "그 강점이 적용되지 않는 상품·지점·시간·조건은 무엇인가요?",
    "why": "일부 사례를 전체 상품의 약속으로 확대하면 기대 불일치가 생깁니다.",
    "decision": "광고 문구의 적용 조건과 제외 범위를 정합니다."
   },
   {
    "question": "창업 계기 중 지금의 제품·서비스 방식으로 이어진 선택 하나와 관련 사진·기록이 있나요?",
    "why": "브랜드 이야기를 구매 이유와 연결하고 검증할 수 있어야 합니다.",
    "decision": "브랜드 소개 콘텐츠에 넣을 장면과 근거를 고릅니다."
   }
  ]
 },
 {
  "id": "product",
  "title": "상품·가격·선택 이유",
  "category": "product",
  "question": "이번에 팔 후보 상품 3개의 판매가, 최근 4주 판매량, 건당 변동비와 재고를 알려주세요. 할인 후 건당 얼마가 남나요?",
  "why": "많이 팔려도 광고비·할인·수수료를 빼면 손실일 수 있습니다.",
  "decision": "주력 상품, 묶음 구성, 할인 한도와 고객획득비의 상한을 정합니다.",
  "fields": "상품 / 가격 / 4주 판매량 / 원가·포장·수수료·배송 등 변동비 / 할인액 / 재고",
  "example": "A세트 15,000원 / 4주 120건 / 변동비 8,000원 / 할인 1,000원 → 광고비 전 6,000원, 고정비·목표 이익 별도",
  "followups": [
   "베스트셀러와 앞으로 더 팔고 싶은 상품은 각각 무엇이며, 판매량·건당 남는 금액은 어떻게 다른가요?",
   "최근 고객이 가격을 망설인 사례 3건에서 무엇과 비교했고 어떤 설명 뒤 구매했나요?",
   "추가 증정·묶음·무료배송 각각의 실제 추가 비용과 최대 제공 수량은 얼마인가요?"
  ],
  "followupGuides": [
   {
    "question": "베스트셀러와 앞으로 더 팔고 싶은 상품은 각각 무엇이며, 판매량·건당 남는 금액은 어떻게 다른가요?",
    "why": "판매량과 수익 기여가 다르면 광고 상품 선택도 달라져야 합니다.",
    "decision": "유입용 상품과 이익을 남길 후속 상품을 나눕니다."
   },
   {
    "question": "최근 고객이 가격을 망설인 사례 3건에서 무엇과 비교했고 어떤 설명 뒤 구매했나요?",
    "why": "가격 인하 없이 해결할 수 있는 구매 장벽을 찾습니다.",
    "decision": "비교 소재·가격 설명·상세페이지 내용을 정합니다."
   },
   {
    "question": "추가 증정·묶음·무료배송 각각의 실제 추가 비용과 최대 제공 수량은 얼마인가요?",
    "why": "혜택마다 비용과 운영 부담이 달라 지속 가능한 제안을 골라야 합니다.",
    "decision": "테스트할 혜택과 노출·수량 제한을 정합니다."
   }
  ]
 },
 {
  "id": "customer",
  "title": "고객과 구매 순간",
  "category": "customer",
  "question": "최근 4주 구매 고객을 큰 2개 집단으로 나누면 누구인가요? 각 집단의 구매 이유·시간·상품·객단가와 대략적인 비중을 알려주세요.",
  "why": "모두를 겨냥하면 상품·메시지·노출 시점을 구체적으로 정할 수 없습니다.",
  "decision": "첫 타깃 집단과 구매 상황, 광고 시간·메시지를 선택합니다.",
  "fields": "집단 / 구매 계기 / 시간·장소 / 구매 상품 / 객단가 / 비중·집계 근거",
  "example": "평일 점심 인근 직장인 / 빠른 식사 / 12~13시 / A세트 / 15,000원 / 비중은 POS 대조 필요",
  "followups": [
   "최근 구매하지 않은 상담·장바구니 이탈 5건의 이유는 무엇인가요? 실제 질문을 익명으로 적어주세요.",
   "최근 재구매 고객은 첫 구매 후 며칠 뒤 무엇을 다시 샀나요? 확인 가능한 주문 자료가 있나요?",
   "문의자는 누구이고 실제 결제·승인자는 누구인가요? 둘의 중요 조건은 어떻게 다른가요?"
  ],
  "followupGuides": [
   {
    "question": "최근 구매하지 않은 상담·장바구니 이탈 5건의 이유는 무엇인가요? 실제 질문을 익명으로 적어주세요.",
    "why": "구매를 막는 요소를 알아야 단순 노출 증가 대신 전환을 개선할 수 있습니다.",
    "decision": "광고·랜딩의 반론 해소와 FAQ 우선순위를 정합니다."
   },
   {
    "question": "최근 재구매 고객은 첫 구매 후 며칠 뒤 무엇을 다시 샀나요? 확인 가능한 주문 자료가 있나요?",
    "why": "반복 구매 시점을 모르면 후속 혜택을 너무 일찍 또는 늦게 제시합니다.",
    "decision": "재방문 제안 시점과 후속 상품을 정합니다."
   },
   {
    "question": "문의자는 누구이고 실제 결제·승인자는 누구인가요? 둘의 중요 조건은 어떻게 다른가요?",
    "why": "사용자와 결제 결정자가 다르면 같은 설명으로 설득하기 어렵습니다.",
    "decision": "대상별 광고와 상담 자료를 나눕니다."
   }
  ]
 },
 {
  "id": "market",
  "title": "상권·경쟁·대안",
  "category": "market",
  "question": "고객이 함께 비교한 대안 3곳의 가격·구성·접근성은 어떤가요? 최근 4주 유입 지역과 요일·시간대별 수요 자료도 알려주세요.",
  "why": "경쟁 범위와 수요가 확인되지 않으면 타깃 지역·시간과 비교 포인트를 추측하게 됩니다.",
  "decision": "노출 지역·시간, 경쟁 대비 구매 이유와 테스트 범위를 정합니다.",
  "fields": "비교 대안 / 가격·구성 / 확인 날짜·링크 / 유입 지역 / 요일·시간별 건수",
  "example": "도보권 A·B·C / 점심 세트 가격표 확보 / 평일 14~17시 판매 적음, 유입 지역은 설문 필요",
  "followups": [
   "매출이 낮은 시간대는 고객 자체가 없나요, 유입은 있지만 구매하지 않나요? 방문·문의·구매 수를 나눠주세요.",
   "향후 4주에 수요를 바꿀 행사·방학·급여일·경쟁사 행사가 있나요? 확정 날짜와 근거는요?",
   "서비스 불가·배송 불가·너무 멀어 구매가 어려운 지역은 어디인가요?"
  ],
  "followupGuides": [
   {
    "question": "매출이 낮은 시간대는 고객 자체가 없나요, 유입은 있지만 구매하지 않나요? 방문·문의·구매 수를 나눠주세요.",
    "why": "수요 부족과 전환 실패는 해결 방법이 다릅니다.",
    "decision": "신규 유입 광고와 제안·랜딩 개선 중 우선 작업을 정합니다."
   },
   {
    "question": "향후 4주에 수요를 바꿀 행사·방학·급여일·경쟁사 행사가 있나요? 확정 날짜와 근거는요?",
    "why": "수요 변동을 광고 성과로 잘못 해석하거나 실행 시점을 놓칠 수 있습니다.",
    "decision": "캠페인 일정과 비교 기간을 정합니다."
   },
   {
    "question": "서비스 불가·배송 불가·너무 멀어 구매가 어려운 지역은 어디인가요?",
    "why": "구매할 수 없는 사람에게 노출하면 예산이 낭비됩니다.",
    "decision": "타깃 제외 지역과 랜딩의 이용 조건을 정합니다."
   }
  ]
 },
 {
  "id": "channels",
  "title": "콘텐츠와 고객 접점",
  "category": "channel",
  "question": "최근 4주 채널별 비용·유입·문의·실제 구매 수를 같은 기간으로 알려주세요. 성과가 좋고 나빴던 콘텐츠 각 1개의 링크도 주세요.",
  "why": "조회수만으로는 어떤 접점이 구매에 기여했는지 판단할 수 없습니다.",
  "decision": "우선 채널, 유지·중단할 소재와 추적 보완 지점을 정합니다.",
  "fields": "채널 / 기간 / 비용 / 클릭·방문 / 문의 / 구매 / 측정 출처 / 콘텐츠 링크",
  "example": "지도 검색 / 최근 4주 / 비용 0 / 길찾기 80 / 방문 구매는 미측정 → 계산대 유입 경로 집계 필요",
  "followups": [
   "고객이 콘텐츠를 본 뒤 구매까지 가는 경로를 실제 링크로 보여주세요. 로그인·예약·결제 중 막히는 단계는요?",
   "이번 주 촬영 가능한 상품·인물·공간·고객 증거와 사용 허락, 촬영 가능 날짜를 적어주세요.",
   "전환 집계에는 어떤 주문번호·예약기록·쿠폰·추적 링크를 쓰나요? 채널 간 중복 구매는 구분되나요?"
  ],
  "followupGuides": [
   {
    "question": "고객이 콘텐츠를 본 뒤 구매까지 가는 경로를 실제 링크로 보여주세요. 로그인·예약·결제 중 막히는 단계는요?",
    "why": "광고 이후 경로가 끊기면 노출을 늘려도 구매가 늘지 않습니다.",
    "decision": "광고 목적지와 먼저 고칠 전환 단계를 정합니다."
   },
   {
    "question": "이번 주 촬영 가능한 상품·인물·공간·고객 증거와 사용 허락, 촬영 가능 날짜를 적어주세요.",
    "why": "좋은 아이디어도 확보할 수 없는 소재로는 실행하지 못합니다.",
    "decision": "촬영 목록·제작 일정·소재 우선순위를 정합니다."
   },
   {
    "question": "전환 집계에는 어떤 주문번호·예약기록·쿠폰·추적 링크를 쓰나요? 채널 간 중복 구매는 구분되나요?",
    "why": "플랫폼 수치를 그대로 더하면 같은 구매를 중복 계산할 수 있습니다.",
    "decision": "성과 측정 원장과 채널 기여 해석의 한계를 정합니다."
   }
  ]
 },
 {
  "id": "goals",
  "title": "목표·성과·예산",
  "category": "performance",
  "question": "앞으로 4주에 늘릴 행동 1개를 고르세요. 현재 주간 건수, 목표 건수, 마감일, 총 광고·제작비와 주간 중단 한도는 얼마인가요?",
  "why": "목표·현재값·비용 한도가 없으면 캠페인의 성공과 손실을 판정할 수 없습니다.",
  "decision": "핵심 성과지표, 테스트 예산, 점검일과 중단 기준을 정합니다.",
  "fields": "행동 / 기준 기간·현재값 / 목표 / 종료일 / 광고비·제작비 / 중단 조건 / 자료 출처",
  "example": "평일 포장 주문 주 40→55건 / 4주 / 광고 30만원·제작 10만원 / 주 7만원 소진 시 중간 검토",
  "followups": [
   "신규 고객 1건을 얻는 데 최대 얼마까지 쓸 수 있나요? 첫 구매 이익과 확인된 재구매 이익을 구분해 주세요.",
   "어떤 수치가 얼마 아래면 중단하고, 누가 어느 날짜에 판단하나요? 최소 관찰 기간은요?",
   "광고를 안 해도 발생하는 구매는 어떻게 비교하나요? 직전 같은 요일·지역·대조 집단 자료가 있나요?"
  ],
  "followupGuides": [
   {
    "question": "신규 고객 1건을 얻는 데 최대 얼마까지 쓸 수 있나요? 첫 구매 이익과 확인된 재구매 이익을 구분해 주세요.",
    "why": "검증되지 않은 재구매를 기대하고 획득비를 높이면 손실을 키울 수 있습니다.",
    "decision": "허용 고객획득비와 단기 손익 기준을 정합니다."
   },
   {
    "question": "어떤 수치가 얼마 아래면 중단하고, 누가 어느 날짜에 판단하나요? 최소 관찰 기간은요?",
    "why": "중간 판단 기준이 없으면 부진한 광고를 계속하거나 너무 빨리 끕니다.",
    "decision": "예산 점검·중단·수정 책임과 일정을 정합니다."
   },
   {
    "question": "광고를 안 해도 발생하는 구매는 어떻게 비교하나요? 직전 같은 요일·지역·대조 집단 자료가 있나요?",
    "why": "캠페인 기간의 모든 매출을 광고가 만든 매출로 볼 수 없습니다.",
    "decision": "성과 비교 기준과 증분 효과를 해석할 범위를 정합니다."
   }
  ]
 },
 {
  "id": "operations",
  "title": "운영 현실과 제약",
  "category": "operations",
  "question": "캠페인 기간에 하루 추가로 받을 수 있는 주문·예약 수와 가능한 시간대를 알려주세요. 재고·인력·응답 시간 중 가장 작은 한도는 무엇인가요?",
  "why": "수요만 늘리고 처리하지 못하면 품절·취소·불만으로 광고 효과가 사라집니다.",
  "decision": "하루 광고량·예약 슬롯·수량 제한과 일시중지 조건을 정합니다.",
  "fields": "날짜·시간 / 추가 수용량 / 재고 / 처리·응답 시간 / 담당 역할 / 중지 조건",
  "example": "평일 14~17시 추가 20건 / 준비 재고 80개 / 문의 당일 응답 / 잔여 10개면 소재 중지",
  "followups": [
   "문의·주문·불만은 누가 몇 시간 안에 처리하나요? 부재 시 대체 담당은 누구인가요?",
   "가격·할인·이미지·효과 표현 중 확인이 필요한 항목과 승인 담당 역할, 완료 날짜는요?",
   "품절·지연·날씨·행사 취소 시 고객에게 제시할 대안과 광고 중지 담당은요?"
  ],
  "followupGuides": [
   {
    "question": "문의·주문·불만은 누가 몇 시간 안에 처리하나요? 부재 시 대체 담당은 누구인가요?",
    "why": "문의가 생겨도 후속 응대가 늦으면 전환되지 않습니다.",
    "decision": "상담 인계와 응답 기한을 정합니다."
   },
   {
    "question": "가격·할인·이미지·효과 표현 중 확인이 필요한 항목과 승인 담당 역할, 완료 날짜는요?",
    "why": "승인되지 않은 조건으로 제작하면 재작업과 고객 오인이 생깁니다.",
    "decision": "제작 전 확인 목록과 승인 마감을 정합니다."
   },
   {
    "question": "품절·지연·날씨·행사 취소 시 고객에게 제시할 대안과 광고 중지 담당은요?",
    "why": "실행 중 변경을 제때 반영해야 불필요한 유입과 불만을 줄입니다.",
    "decision": "비상 대응과 대체 제안을 정합니다."
   }
  ]
 },
 {
  "id": "campaign",
  "title": "첫 캠페인의 방향",
  "category": "operations",
  "question": "첫 테스트를 한 문장으로 정해보세요. 누구에게, 어떤 상품·혜택을, 어느 채널에서 알리고, 어디서 어떤 행동을 하게 할까요?",
  "why": "모은 정보가 실제 실행안으로 좁혀지지 않으면 인터뷰 후에도 제작을 시작할 수 없습니다.",
  "decision": "첫 캠페인의 타깃·상품·제안·채널·목적지·측정안을 확정할 초안을 만듭니다.",
  "fields": "타깃 / 상품 / 혜택·조건 / 채널 / 구매·예약 링크 / 기간 / 성공·중단 기준 / 미확정 사항",
  "example": "인근 직장인 / A세트 / 평일 포장 혜택 / 지역 콘텐츠 / 주문 링크 / 2주 / 주간 주문 비교, 할인은 승인 필요",
  "followups": [
   "서로 비교할 두 제안에서 바꿀 요소는 무엇이고, 같은 조건으로 유지할 요소는 무엇인가요?",
   "공개할 가격·혜택 조건·마감일·구매 링크를 실제 고객처럼 확인했나요? 확인 담당과 날짜는요?",
   "아직 없는 자료 3개를 고르고 각각 누가 언제까지 확보할지 정해주세요."
  ],
  "followupGuides": [
   {
    "question": "서로 비교할 두 제안에서 바꿀 요소는 무엇이고, 같은 조건으로 유지할 요소는 무엇인가요?",
    "why": "타깃·상품·혜택을 동시에 바꾸면 무엇이 효과를 냈는지 알기 어렵습니다.",
    "decision": "첫 실험의 변수와 비교 조건을 정합니다."
   },
   {
    "question": "공개할 가격·혜택 조건·마감일·구매 링크를 실제 고객처럼 확인했나요? 확인 담당과 날짜는요?",
    "why": "광고와 실제 구매 조건이 다르면 전환 손실과 불만이 생깁니다.",
    "decision": "발행 전 최종 점검 목록을 만듭니다."
   },
   {
    "question": "아직 없는 자료 3개를 고르고 각각 누가 언제까지 확보할지 정해주세요.",
    "why": "모르는 정보를 추정으로 채우면 실행안 전체가 잘못될 수 있습니다.",
    "decision": "제작 시작 전 자료 요청과 담당·기한을 정합니다."
   }
  ]
 }
] as const;
export type InterviewSectionId=typeof interviewSections[number]['id'];
export type InterviewAnswers=Partial<Record<InterviewSectionId,string>>;
export type InterviewProposal={section:InterviewSectionId;answer:string;quote:string;sourceId:string};
export type InterviewJob={id:string;status:'queued'|'uncertain'|'completed'|'failed'|'cancelled';providerId?:string;endpoint:string;sourceIds:string[];evidence:Record<string,string>;error?:string;createdAt:string;updatedAt:string};
export type InterviewData={industry?:InterviewIndustryId;role:string;answers:InterviewAnswers;attachments:string[];proposals:InterviewProposal[];job?:InterviewJob;consentAt?:string};
export type InterviewSource=ArchiveSource&{interview:InterviewData};
export const interviewBusy=(d:InterviewData)=>!!d.job&&['queued','uncertain'].includes(d.job.status);
export function interviewContent(answers:InterviewAnswers){return interviewSections.filter(s=>answers[s.id]?.trim()).map(s=>`## ${s.title}\n${answers[s.id]!.trim()}`).join('\n\n')}
export function interviewProgress(answers:InterviewAnswers){return interviewSections.filter(s=>answers[s.id]?.trim()).length}
export function recommendedQuestions(answers:InterviewAnswers,industry:InterviewIndustryId='general'){const common= interviewSections.flatMap<{section:InterviewSectionId;question:string;reason:string}>(s=>!answers[s.id]?.trim()?[{section:s.id,question:s.question,reason:'필수 답변 미입력'}]:answers[s.id]!.trim().length<60?[{section:s.id,question:s.followups[0],reason:'구체적인 사례 보완'}]:[]).slice(0,5);const tailored=interviewSections.filter(s=>(answers[s.id]?.trim().length||0)<60).flatMap(s=>{const question=industryQuestion(industry,s.id);return question?[{section:s.id,question,reason:'업종 관점 보완'}]:[]}).slice(0,2);return [...common.slice(0,5-tailored.length),...tailored]}
export function parseInterviewProposals(output:string,evidence:Record<string,string>):InterviewProposal[]{
 const raw:unknown=JSON.parse(output.replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,''));
 if(!raw||typeof raw!=='object'||!('sections'in raw)||!Array.isArray(raw.sections)||raw.sections.length>24)throw new Error('인터뷰 정리 응답 형식이 올바르지 않습니다.');
 return raw.sections.map((p:unknown)=>{
  if(!p||typeof p!=='object')throw new Error('섹션 형식을 확인하세요.');
  const v=p as Record<string,unknown>;
  if(!interviewSections.some(s=>s.id===v.section)||typeof v.answer!=='string'||!v.answer.trim()||v.answer.length>5000||typeof v.quote!=='string'||v.quote.trim().length<4||v.quote.length>2000||typeof v.sourceId!=='string'||!Object.hasOwn(evidence,v.sourceId)||!evidence[v.sourceId].includes(v.quote))throw new Error('원문에서 확인할 수 없는 인용 또는 섹션입니다.');
  return {section:v.section as InterviewSectionId,answer:v.answer.trim(),quote:v.quote,sourceId:v.sourceId};
 });
}
export const audioFile=(name:string)=>/\.(mp3|wav|m4a|mp4|webm|ogg)$/i.test(name);
export function interviewAudioProblem(name:string,b:Uint8Array){
 const ascii=(s:string,at=0)=>[...s].every((c,i)=>b[at+i]===c.charCodeAt(0));
 const ext=name.split('.').pop()?.toLowerCase();
 const valid=ext==='wav'?ascii('RIFF')&&ascii('WAVE',8):ext==='mp3'?ascii('ID3')||(b[0]===255&&(b[1]&224)===224):ext==='m4a'||ext==='mp4'?ascii('ftyp',4):ext==='ogg'?ascii('OggS'):ext==='webm'?b[0]===26&&b[1]===69&&b[2]===223&&b[3]===163:false;
 return valid?'':'녹음 파일의 형식과 확장자가 다릅니다.';
}
export const interviewCategory=(id:InterviewSectionId):ArchiveCategory=>interviewSections.find(s=>s.id===id)!.category;
