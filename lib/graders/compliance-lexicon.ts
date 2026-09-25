// 규제·플랫폼·업종 표시 가드레일(A2)의 어휘 사전. 판정 로직(compliance.ts)과 분리해 사전만 개정할 수 있게 둔다.
// 출처 URL은 국가법령정보센터 공식 페이지이며 2026-09-23에 법령 일련번호로 열리는 것을 확인했다. 이 사전은 법률 자문이 아니다.
// match: 문장 단위 정규식(바로 뒤 서술부가 부정·배제면 면제, negation.ts). context: 같은 문장(초안 라벨이면 뒤따르는 문단)에 있어야 적용.
// cleared: 같은 ###~###### 소제목 단락에 있으면 해소(표기·동의·권리 확인 등). 표기를 서술한 문장('해당 문안에 ‘#광고’를 표시한다')이면
// 같은 ## 섹션(렌더본의 #·## 제목과 구분선 사이) 안의 다른 소제목에 있어도 해소한다. also: 같은 문장에 함께 있어야 함. except: 문장이 맞으면 면제.
// held: 매치가 든 절(쉼표·연결 어미·줄표 사이)에서 매치 자리를 HELD_MARK로 바꾼 문자열이 맞으면 그 매치만 면제(같은 문장의 다른 문구 보류는 면제 사유가 아니다).
// ledgerKey: 확정 원장 항목 이름이 맞으면 해소. marked: [확인 필요]·미확정 표시 문장은 면제.
// 가맹 범주(franchise_recruit, 트랙 R R2)는 checkCompliance의 opts.franchise로만 켠다. 기본 호출(온라인 채점·평가)은 이 범주를 보지 않는다.
// scope 'recruitment': 모집 범위(objective 캠페인·내보내기)에서만 적용한다. 가맹 규칙의 id는 규칙 레지스트리(lib/franchise-rules.ts) id 그대로다.
export type ComplianceSeverity='block'|'warn'|'info';
export const COMPLIANCE_CATEGORIES=['platform_review','endorsement','ai_label','ad_message','food_claim','cosmetic_claim','ecommerce_terms','rights','franchise_recruit'] as const;
export type ComplianceCategory=typeof COMPLIANCE_CATEGORIES[number];
export type ComplianceRule={id:string;category:ComplianceCategory;severity:ComplianceSeverity;title:string;match:string;context?:string;cleared?:string;also?:string;except?:string;held?:string;ledgerKey?:string;marked?:boolean;scope?:'recruitment';sources:string[]};
export const HELD_MARK='⟪M⟫';
export type ComplianceSource={title:string;url:string};

const law=(name:string)=>'https://www.law.go.kr/법령/'+name;
// 전송 채널의 메시지 초안·발송만 본다. '핵심 메시지 초안' 같은 브랜드 메시지는 광고성 정보 전송이 아니다.
const MESSAGE='(?:문자|SMS|LMS|MMS|알림톡|친구톡|앱\\s?푸시|푸시|카카오톡\\s?(?:채널\\s?)?메시지|광고\\s?메시지)[^.\\n]{0,12}(?:초안|문안|내용|발송|전송|보내|보낸)|메시지[^.\\n]{0,6}(?:발송|전송|보내|보낸)';
const PROMOTION='오픈|할인|이벤트|쿠폰|혜택|무료|증정|방문하세요|주문하세요|신메뉴|특가|프로모션|드립니다';
// '온라인 판매·구매' 뒤에 조사·명사가 붙은 명사 용법('목표는 온라인 판매이며', '온라인 구매와의 관계', '온라인 판매 재고')은 구매 유도가 아니다(2026-09-25 MAPDAL 재채점).
const PURCHASE_CTA='구매하기|바로\\s?구매|지금\\s?구매|구매하세요|장바구니|결제하기|주문하기|스토어에서\\s?(?:구매|주문)|온라인\\s?(?:판매|구매)(?!\\s?(?:와|과|의|실적|재고|매출|비중|목표|데이터|채널|전환|경로|분석|량|액|이며|이다|입니다))';
// 발송을 미루거나 검토만 하는 계획 문장은 전송 문안이 아니다('수신 동의 고객이 생긴 뒤에 검토합니다').
const DEFERRAL='검토(?:합니다|한다|할\\s?예정|\\s?예정)|보류|(?:뒤|후|이후|다음)에?\\s?(?:검토|결정|판단|작성)';
// 버튼·링크 클릭 수 같은 측정 문장의 구매 버튼 언급은 구매 유도 문구가 아니다. 퍼널 단계('상품 상세→장바구니', '장바구니→결제 시작률', '단계별 이탈'),
// 분석 이벤트 이름(add_to_cart 같은 snake_case)·세션 ID·조회수, '유료 주문과 구분'도 측정 문장이다(2026-09-25 MAPDAL 재채점 실측). 카피 안의 화살표('혜택 확인 → 지금 구매')는 측정이 아니다.
// 퍼널 단계를 셋 이상 나열한 측정 문장('유효 세션·상품 조회·장바구니·결제 시작·결제 완료', '주문·조회·장바구니 자료')도 측정이다(R3 기준선 MAPDAL 회의 실측).
const FUNNEL_STAGE='(?:상품\\s?)?(?:조회|세션|장바구니|결제\\s?(?:시작|완료)|주문|취소|환불)';
const MEASUREMENT=`${FUNNEL_STAGE}(?:\\s?[·,]\\s?${FUNNEL_STAGE}){2,}|`+'(?:버튼|링크)[^.\\n]{0,8}(?:클릭|노출|전환)|측정|지표|전환율|이탈|퍼널|단계별|조회수|세션\\s?ID|\\b[a-z]+(?:_[a-z]+)+\\b|(?:장바구니|상품\\s?상세|결제\\s?시작)\\s?→|→\\s?(?:장바구니|결제\\s?시작|결제\\s?완료)|(?:시작|완료|진입)률|유료\\s?주문과\\s?구분';
// 구매 CTA 자체를 보류·미사용하거나 가격 확정 뒤 넣는·바꾸는 계획, 확인 계획에 적는다는 문장은 구매 유도 문구가 아니다(held: 매치가 든 절에서만 본다, M은 걸린 구매 문구 자리).
// '구매하기 CTA는 보류', '바로 구매 버튼은 가격 확정 후 추가', '가격 확정 후 CTA를 구매하기로 전환', '구매하기 문구 미사용', '(구매하기는 가격 확정 후)', '구매하기 CTA 사용 여부: 가격 확정 뒤 결정'.
// '헤드라인은 ‘지금 구매하세요’, 서브 문구는 보류', '장바구니 담기 CTA를 쓰고 할인 문구는 보류'처럼 다른 문구의 보류는 면제 사유가 아니다.
const M=HELD_MARK,AFTER_CONFIRM='(?:확정|확인|입력|등록)\\s?(?:뒤|후|이후|되면|된\\s?(?:뒤|후)|되는\\s?대로)';
const CTA_HELD=[`${M}[^.\\n]{0,12}(?:보류(?!\\s?없)|미사용)`,`${M}[^.\\n]{0,12}${AFTER_CONFIRM}[^.\\n]{0,12}(?:넣|추가|적|쓰|사용|노출|반영|바꾸|바꾼|바꿉|바꿔|교체|전환|변경)`,
 `${M}[^.\\n]{0,12}${AFTER_CONFIRM}에?\\s?(?:[)）|]|$)`,`${M}[^.\\n]{0,8}(?:사용|노출)\\s?여부[^.\\n]{0,16}(?:결정|판단|검토)`,
 `${AFTER_CONFIRM}[^.\\n]{0,20}${M}[^.\\n]{0,12}(?:으로|로)\\s?(?:바꾸|바꾼|바꿉|바꿔|교체|전환|변경|추가|넣)`,`${M}[^.\\n]{0,12}확인\\s?계획(?:에|으로)`,
 // 같은 절에서 구매 문구 앞에 확정·확인·작동 조건이 먼저 오는 계획('가격과 판매 조건이 확인된 경우 “구매하기”', '결제 페이지가 정상 작동한 뒤: “구매하기”').
 // '확정된 가격으로 지금 구매'처럼 조건이 아닌 수식은 면제하지 않는다. 조건 없이 [가격 확인 필요] 표시만 붙인 구매 문구는 경고를 남긴다(품질 수정 v1 결정).
 `(?:확정|확인|작동|등록|준비)(?:되면|되고|된\\s?(?:경우|뒤|후|때|다음)|한\\s?(?:뒤|후|다음))[^.\\n]{0,40}${M}`,
 // '…로 이동할 수 있을 때만 “구매하기”'처럼 '때만·경우에만'으로 한정한 조건. '필요할 때 지금 구매하세요'(한정 없음)는 면제하지 않는다.
 `(?:수\\s?있을|가능할|확인될|확정될)\\s?(?:때|경우)(?:만|에만)[^.\\n]{0,40}${M}`].join('|');
// 매체 광고비 집행(검색·SNS 광고 운영)은 협찬 게시물이 아니다. 이 문맥의 '유료 광고'는 협찬 표기 대상에서 빼되, 인플루언서·체험단 같은 게시자 문맥이면 그대로 본다.
// '유료 광고 게시물·포스팅·후기'처럼 게시물을 가리키는 합성어는 집행·예산 문맥이어도 협찬 표기 대상이다.
const PAID_MEDIA='집행|예산|입찰|매체|광고\\s?(?:세트|관리자|계정|그룹)|캠페인\\s?(?:운영|세팅|설정)|CPC|CPM|CPA|CPV|ROAS|클릭당|노출당|타[기게겟]팅|부스팅|키워드\\s?광고|검색\\s?광고|파워링크|돌리|돌린|돌려|운영|게재|검토|세팅|노출';
const CREATOR='인플루언서|크리에이터|블로거|유튜버|틱톡커|셀럽|체험단|리뷰어|서포터즈|앰배서더|원고';
const PAID_POST='유료\\s?광고\\s?(?:용\\s?)?(?:게시(?:물|글)?|포스팅|포스트|후기|리뷰|원고)';
// '유료 광고비'(광고 예산 칸, '유료 광고비 0원으로 우선 설계')는 광고 관계가 아니다. 광고비를 받는 대가는 '광고비…받' 규칙이 잡는다(R3 기준선 S2 실측).
const PAID_AD=`${PAID_POST}|유료\\s?광고(?!\\s?비)(?:(?<!(?:${PAID_MEDIA})[^.\\n]{0,30}유료\\s?광고)(?![^.\\n]{0,30}(?:${PAID_MEDIA}))|(?<=(?:${CREATOR})[^.\\n]{0,30}유료\\s?광고)|(?=[^.\\n]{0,30}(?:${CREATOR})))`;
// 가맹 모집(트랙 R R2). 출처 URL은 규칙 레지스트리(lib/franchise-rules.ts LAW·DEC_NOW·NOTICE_2019_8)와 같은 문자열이다(사전은 레지스트리를 import하지 않는다).
const FR_DRF='https://www.law.go.kr/DRF/lawService.do?OC=test';
// 소비자 문장과 겹치는 비용 낱말: '베이킹 클래스 교육비', '바리스타 기초반 교육비', '로열티 카드 적립', '로열티 스탬프', '로열티 고객 혜택'은 가맹 비용이 아니다.
const CLS='(?<!(?:클래스|수강|체험|원데이|아카데미|홈카페|바리스타|베이킹|만들기|강좌|기초반|심화반|수업|강습|워크숍|자격증)\\s?)',LOY='(?!\\s?(?:카드|멤버십|회원|포인트|프로그램|적립|클럽|고객|혜택|등급|VIP|스탬프|쿠폰))';
export const FR_EDU_LABEL=`${CLS}교육비`,FR_ROYALTY_LABEL=`로열티${LOY}`;
// 매장 수 주장(lib/graders/ledger.ts가 같은 정규식으로 값과 비교 방식을 뽑는다). 브랜드 전체 규모를 말하는 문장만 주장이다:
// 앞머리(전국·총·누적·현재·벌써 …)가 붙은 수, 운영·성업·돌파 서술, 가맹점·직영점·가맹 매장 수, '매장 수' 표기('매장 수: 20개', '가맹점은 20곳입니다'), N호점 돌파, 성업 중 N개.
// 일부 매장의 사정('벌써 5개 매장 완판', '현재 12개 매장에서 사용 가능', '3개 매장이 영업을 쉽니다', '신규 2개 매장 오픈 기념 할인', '가맹점 2곳 임시 휴무', '전국 5개 매장에서 한정 판매')은 주장이 아니다.
// 비율·법정 규칙('슈퍼바이저 1명이 가맹점 10곳을 담당', '가장 가까운 가맹점 10개를 적습니다', '직영점 1곳 이상을 1년 넘게 운영한 브랜드만')도 주장이 아니다. '2호점 오픈 기념'·'한정 12개'도 아니다.
// 'N여 개'·'N개 이상'·'N호점 돌파'는 비교 방식이 다르다(ledger). '오픈 예정 N개'는 원장 항목이 없어 모집 범위에서 근거 없음이다(소비자 범위의 오픈 예고는 판정기가 건너뛴다).
const CNT='\\d[\\d,]*(?:\\s?여)?',UNIT=`${CNT}\\s?(?:개|곳)(?:\\s?(?:이상|넘게|넘는|초과|이\\s?넘|을\\s?넘|이나))?`;
const STORE_NOUN='(?:가맹\\s?(?:매장|점포)|직영\\s?(?:매장|점포)|매장|점포|가맹점|직영점|지점)';
const RUNNING='(?:성업|운영\\s?(?:중|하고|합니다|해요|하며|되고|되는)|운영(?!\\s?(?:시간|방식|방침|정책|일|안내))|영업\\s?(?:중(?!단)|하고)|돌파|달성|보유|오픈(?!\\s?(?:기념|소식|이벤트|행사|시간|런|예정|준비|\\d)))';
const SUBSET_BEFORE='(?<!(?:참여|이벤트|행사|해당|대상|판매|취급|예약|픽업|배달|시범|한정|신규|추가|인근|근처|주변|일부|휴무|공사|리뉴얼|임시|가까운|예정|이번\\s?주|이번\\s?달|이달|금주|오늘)\\s?)';
// 전국·국내·누적 같은 전체 앞머리는 한 메뉴를 파는 매장('전국 5개 매장에서 한정 판매')만 일부로 본다('전국 150개 매장에서 동시 진행'은 전체 주장이다).
const AVAIL='(?![^.,\\n]{0,10}(?:한정|에서만|먼저|시범|테스트|선보|만\\s?판매))';
const SUBSET_AFTER=`(?!\\s?(?:이|가|에서만|에서도|에서|을|를|은|는|의|도|만)?\\s?(?:(?!${RUNNING})[가-힣]{1,4}\\s)?(?:한정|에서만|먼저|시범|테스트|선보|만\\s?판매|사용|주문|예약|배달|픽업|포장|완판|품절|매진|휴무|쉽|쉬어|휴점|영업\\s?(?:중단|종료|시간|을)|운영\\s?시간|오픈\\s?(?:시간|기념|이벤트|행사|소식|런|\\d)|기념|이벤트|행사|진행|공사|리뉴얼|임시|변경|앞당|연장|단축|재고|판매|선착순|참여|함께|순차))`;
const NOT_RATIO='(?<!(?:명이|명당|명이서|당|마다|가장\\s?가까운|인근|근처|최근접|반경)\\s?)',NOT_OBJECT='(?!\\s?(?:이상|이하|넘게|넘는)?\\s?(?:을|를|씩|당|마다)(?!\\s?(?:운영|보유)))';
export const FR_STORE_COUNT=[
 `(?:전국|국내|누적|어느덧|무려|드디어)(?:에서|에|의)?\\s?${UNIT}\\s?(?:의\\s?)?${STORE_NOUN}${AVAIL}`,
 `(?:총|현재|벌써|이미)(?:에서|에|의)?\\s?${UNIT}\\s?(?:의\\s?)?${STORE_NOUN}${SUBSET_AFTER}`,
 `(?:전국|국내|총|누적)\\s?(?:의\\s?)?${STORE_NOUN}\\s?(?:수\\s?)?(?:[은는이가]\\s?|[:：]\\s?)?${UNIT}${SUBSET_AFTER}`,
 `${SUBSET_BEFORE}${UNIT}\\s?(?:의\\s?)?${STORE_NOUN}(?:이|가|에서|을|를)?\\s?${RUNNING}`,
 `${SUBSET_BEFORE}${NOT_RATIO}(?:가맹\\s?(?:매장|점포)|직영\\s?(?:매장|점포)|가맹점|직영점)(?:\\s?[과와·]\\s?(?:직영점|가맹점))?\\s?(?:수\\s?|합계\\s?|총\\s?|전체\\s?)?(?:[은는이가]\\s?|[:：]\\s?)?${UNIT}${SUBSET_AFTER}${NOT_OBJECT}`,
 `${SUBSET_BEFORE}(?:매장|점포|지점)\\s?(?:수\\s?)?(?:[은는이가]\\s?)?${UNIT}\\s?(?:이|가)?\\s?${RUNNING}`,
 `${SUBSET_BEFORE}(?:매장|점포|지점)\\s?수\\s?(?:[은는이가]\\s?|[:：]\\s?)?(?:${UNIT}|\\d[\\d,]*\\s?\\+)`,
 `${SUBSET_BEFORE}(?:매장|점포|지점)(?:이|은|는)\\s?${CNT}\\s?(?:개|곳)\\s?(?:이나|이\\s?넘|을\\s?넘|이상|넘게|넘는)`,
 `성업\\s?중(?:인)?\\s?${STORE_NOUN}?\\s?${UNIT}`,
 `${CNT}\\s?호점\\s?(?:돌파|달성|시대|눈앞|넘)|(?:벌써|어느덧|무려|드디어|전국|누적)\\s?${CNT}\\s?호점`,
 `오픈\\s?예정\\s?(?:매장|점포)?\\s?${CNT}\\s?(?:개|곳)`,
].join('|');
// 가맹 비용 주장. 가맹비·가맹 가입비·가맹(계약 이행) 보증금은 가맹 비용이다. 교육비·로열티·인테리어 비는 소비자 문장과 겹치므로
// 같은 문장에 가맹 문맥(가맹·창업·개설·점주·계약)이 있거나 라벨 바로 뒤 금액이 100만원 이상일 때만 가맹 비용이다('로열티 고객 10% 할인', '리뉴얼 인테리어 비포 애프터', '베이킹 교육비 30,000원'은 소비자 문장).
// '본사'는 소비자 문장에도 흔해('본사 아카데미', '본사 홈페이지') 가맹 문맥이 아니고, '창업 30주년'·'창업자'의 창업도 가맹 문맥이 아니다. 우리 매장에 들인 금액('인테리어 비용 1억 원 들인 리뉴얼')은 가맹 비용이 아니다.
// 월 정액·매출 비율 로열티('로열티 월 30만원', '로열티: 매출의 3%')는 가맹 비용이다('로열티 월 1회 무료 음료'는 아니다). 모집 범위는 가맹 문맥이 이미 있어 판정기가 라벨만으로 본다(FR_SHARED_COST).
export const FR_CONTEXT='(?:가맹|창업(?!\\s?(?:\\d+\\s?(?:주년|년)|이래|이후|기념|자|주년))|개설|점주|계약(?!직))';
const BIG_KRW='(?:(?:[1-9]\\d{2,}|[1-9]\\d{0,2}(?:,\\d{3})+)\\s?만|\\d[\\d,.]*\\s?(?:억|천\\s?만)|[1-9]\\d{0,2}(?:,\\d{3}){2,}\\s?원|[1-9]\\d{6,}\\s?원)';
const SHARED_COST=`${FR_EDU_LABEL}|${FR_ROYALTY_LABEL}|인테리어\\s?(?:비(?!포)|비용|공사비)`;
export const FR_SHARED_COST=SHARED_COST;
export const FR_SPENT='(?![^.\\n]{0,8}(?:들인|들여|들였|투자한|투자해|쏟|썼|사용한))';
export const FR_ROYALTY_FORM='로열티\\s?:?\\s?(?:(?:월|매월)\\s?\\d[\\d,.]*\\s?(?:만\\s?원|원|%)|매출(?:액)?의?\\s?\\d)';
const FR_COST_CLAIM=[`(?:가맹비|가맹\\s?가입비|(?:가맹|계약\\s?이행)\\s?보증금|가맹\\s?교육비)\\s?[^.\\n]{0,8}?\\d`,`(?<=${FR_CONTEXT}[^.\\n]{0,20})(?:${SHARED_COST})\\s?[^.\\n]{0,8}?\\d`,
 `(?:${SHARED_COST})(?=[^.\\n]{0,30}${FR_CONTEXT})\\s?[^.\\n]{0,8}?\\d`,`(?:${SHARED_COST})\\s?:?\\s?(?:월\\s?|매월\\s?)?${BIG_KRW}${FR_SPENT}`,FR_ROYALTY_FORM].join('|');
// 창업비용 라벨(ledger STARTUP_COST_LABEL과 같다): '창업비는', '초기 투자금', 'startup cost'. 금액이 먼저 오는 '4,000만원으로 창업 가능'도 창업비용 주장이다.
export const FR_STARTUP_LABEL='(?:총\\s?)?창업\\s?(?:비용|자금|금액)|창업\\s?비(?![가-힣])|창업비(?=[은는이가도을를])|총\\s?투자\\s?(?:비용|비|금)?|초기\\s?(?:투자\\s?)?(?:금|비용|자금|투자비)|소자본\\s?창업|개설\\s?비용|[Ss]tart[-\\s]?up\\s+costs?|[Ii]nitial\\s+(?:investment|costs?)|[Tt]otal\\s+investment';
export const FR_STARTUP_AMOUNT_FIRST='\\d[\\d,.]*\\s?(?:만|억|천\\s?만)\\s?원?\\s?(?:으로|이면|만\\s?있으면|로)\\s?(?:창업|가맹점?\\s?(?:개설|오픈)|점포\\s?개설)';
// 수익·매출 보장: 보장·보증·개런티·확정·약속·책임지는 대상이 수익 명사 자신이어야 한다(사이에는 조사·기간·금액·비율·부사, 가맹본부 주어만). '매출 1위 메뉴, 맛은 보장합니다', '품질 보장 수입 버터',
// '판매 수익 일부를 기부하고 끝까지 책임지겠습니다', '우리 매장 매출을 책임지는 효자 메뉴'(본사가 주어가 아닌 '책임지는'), '매출 확정 후 정산'은 수익 보장이 아니다.
// '최저·최소 수익'은 보장·약속·확정과 함께일 때만이다('최소 매출 기준 미달 시 계약 해지'는 부담 고지). 적자·매출 미달을 본사가 보전·보상하는 표현, '월 1000만원 보장', '보장된 수익', 영어 'guaranteed profit'도 보장이다.
// 연봉·월급 보장은 채용 공고와 겹쳐 창업·가맹·점주 문맥이 같은 문장에 있을 때만 본다.
const REV_NOUN='(?:순?수익(?:금)?(?!률)|매출(?!\\s?\\d+\\s?위)|순이익|순익|(?<!\\d)(?:월|연)\\s?수입|(?:고정|안정)\\s?수입|소득|이익금|투자\\s?수익|수익률|ROI|투자\\s?원금|(?<![가-힣])원금|투자금)';
const REV_ADV='(?:월|연|매월|매달|최소|최저|평균|확실히|확실하게|반드시|꼭|무조건|100\\s?%|전액|완벽(?:히|하게)|철저히)';
const REV_AMOUNT='(?:\\d[\\d,.]*\\s?(?:만|천|억|원|%|퍼센트|배)+)';
const REV_GAP=`\\s?(?:[을를이가은는도]\\s?)?(?:${REV_ADV}\\s?)?(?:${REV_AMOUNT}\\s?(?:[을를이가은는도]|까지|이상)?\\s?)?(?:${REV_ADV}\\s?)?(?:,?\\s?(?:본사|본부|가맹\\s?본부|저희|회사)(?:가|에서|이|는)?\\s?(?:${REV_ADV}\\s?)?)?`;
const REV_VERB='(?:보장|보증(?!\\s?(?:금|보험))|개런티|확정\\s?지급|확정(?=\\s?(?:$|[!.,~?]|드립|해\\s?드|됩니다|입니다|이에요|합니다|이다|된다|적인|적으로|보장|창업|가맹|브랜드|시스템))|책임(?:집|져|지겠|진다|질|지고|지며)|(?<=(?:본사|본부|저희)[^.,\\n]{0,15})책임지는|책임지는(?=\\s?(?:창업|가맹|브랜드|본사|본부|시스템|프랜차이즈|구조|사업|아이템|점포))|약속(?:합|드|해|하겠|하는|된|함))';
const REV_EN='[Gg]uarantee[ds]?\\s+(?:your\\s+|monthly\\s+|minimum\\s+|fixed\\s+)?(?:profits?|income|revenues?|returns?|sales|earnings|ROI)|(?:[Pp]rofits?|[Ii]ncome|[Rr]evenues?|[Rr]eturns?|[Ss]ales|[Ee]arnings|ROI)\\s+(?:is\\s+|are\\s+)?(?:100\\s?%\\s+)?guaranteed|[Mm]inimum\\s+(?:income|profit|revenue)\\s+guarantee';
// 소득으로서의 '수입'은 보장·보증과 바로 붙을 때만 본다('수입 보장'). '원두 수입 확정 소식'은 수입품이다.
const REV_GUARANTEE=[`${REV_NOUN}${REV_GAP}${REV_VERB}`,'(?<![가-힣])수입(?:을|이)?\\s?(?:100\\s?%\\s?)?(?:보장|보증(?!\\s?(?:금|보험)))',`(?:최저|최소)\\s?(?:수익|매출|수입|소득)[^.,\\n]{0,20}?(?:보장|약속|확정|보증)`,
 `(?:보장|확정|보증|약속)(?:된|되는|하는|해\\s?(?:주는|드리는)|받는)?\\s?(?:순?수익(?:금)?(?!률)|매출(?!\\s?\\d+\\s?위)|수입(?=\\s?(?:[은는이가을를도으]|\\d|$|[,.!]))|소득|순이익|ROI)`,
 `(?<![\\d가-힣])(?:월|연|매월|매달|한\\s?달|월평균|연평균|하루)\\s?${REV_AMOUNT}\\s?(?:[을를이가은는도]|이상|까지)?\\s?(?:보장|확정|보증|약속)`,
 `(?:적자|영업\\s?손실|매출\\s?(?:미달|부족|감소|하락)|수익\\s?(?:미달|부족|감소)|목표\\s?(?:매출|수익)?\\s?미달)[^.\\n]{0,20}?(?:(?:본사|본부|가맹\\s?본부|저희)[^.\\n]{0,10}?)?(?:보전|보상|보충|메워|메꿔|채워\\s?드|책임(?:집|져|지겠))`,
 `(?:연봉|월급)${REV_GAP}${REV_VERB}(?=[^.\\n]{0,20}(?:창업|가맹|점주|사장|오너))|(?<=(?:창업|가맹|점주|사장|오너)[^.\\n]{0,20})(?:연봉|월급)${REV_GAP}${REV_VERB}`,REV_EN].join('|');
// 조건 병기: 실제 요건을 적은 경우만('조건: …', '선착순', '… 한정', '12월 31일까지'). '조건 없이', '아무 조건 없이', '오픈까지 책임집니다'는 조건이 아니다.
const SUPPORT_CONDITION='(?<!무|아무\\s?|가맹\\s?|계약\\s?|창업\\s?)조건(?!\\s?(?:없|無|0))|요건|대상자|대상\\s?[:：]|지원\\s?대상|대상은|대상으로|심사|선착순|\\d+\\s?월\\s?(?:\\d+\\s?일)?\\s?까지|\\d{4}\\s?[-.년]\\s?\\d{1,2}\\s?[-.월]?\\s?(?:\\d{1,2}\\s?일?)?\\s?까지|한정|클래스|수강|원데이';
// 가맹점사업자가 받는 지원이 아닌 문장(사회공헌·기부·직원 복지·채용: '지역아동센터에 장비 지원', '직원 복지: 교육비 전액 지원', '유니폼·장비 지원, 식대 제공')은 조건부 지원 표현이 아니다.
const SUPPORT_NOT_FRANCHISEE='직원|임직원|크루|알바|아르바이트|파트\\s?타이머|4대\\s?보험|식대|채용|봉사|기부|후원|캠페인|나눔|사회\\s?공헌|아동|보육원|복지관|공부방|장학|복지';
// 가맹금 보험 표지: 다른 수혜자의 보험('소비자피해보상보험', '파손 피해보상보험', '구매안전서비스(채무지급보증)')과 대비('피해보상보험 대신 가맹금 예치')는 가맹본부의 표지가 아니다.
// 보증보험도 표지다('보증보험 가입 가맹본부'). 가맹점사업자가 내는 이행보증보험 증권('가맹 보증금은 이행보증보험 증권으로 대체')은 아니다.
const INSURANCE_NOT='(?!\\s?(?:[에을를]\\s?)?(?:가입하는\\s?)?대신)';
const INSURANCE_OTHER='(?<!(?:소비자|고객|구매|파손|배송|택배|운송|여행|상품|이행|전세|하자|임대)\\s?)';
const INSURANCE_MARK=`${INSURANCE_OTHER}피해\\s?보상\\s?보험${INSURANCE_NOT}|(?<!구매\\s?안전\\s?(?:서비스)?\\s?\\(?\\s?)채무\\s?지급\\s?보증${INSURANCE_NOT}|공제\\s?(?:조합\\s?(?:가입|계약)|계약)|${INSURANCE_OTHER}보증\\s?보험(?!\\s?증권)${INSURANCE_NOT}`;
// 가맹점사업자단체(협의회·연합회·노조 포함) 가입·활동을 가맹 계약·거래의 조건이나 불이익으로 거는 표현. '점주 협의회 참여 바자회는 사전 신청 시에만 입장'처럼 계약과 무관한 조건은 아니다.
const ASSOC_ORG='(?:가맹점\\s?(?:사업자\\s?)?|가맹\\s?점주\\s?|점주\\s?)(?:단체|협의회|연합회|협회|모임|노조|노동\\s?조합|조합)';
const ASSOCIATION_CONDITION=`${ASSOC_ORG}[^.\\n]{0,20}?(?:(?:가입|탈퇴|참여|활동)(?:을|를)?\\s?(?:해야|하셔야|하여야|할\\s?것)|(?:가입|미가입|탈퇴|참여|활동|결성)[^.\\n]{0,15}?(?:(?:계약|재계약|가맹|거래|공급|지원|혜택)[^.\\n]{0,8}?(?:조건|불가|제한|해지|해제|거절|종료|중단|불이익|박탈|취소|제외)|조건|불이익|페널티|패널티|제재))`;

export const COMPLIANCE_LEXICON:{version:string;checkedAt:string;platformPolicy:string;sources:Record<string,ComplianceSource>;rules:ComplianceRule[]}={
 version:'compliance-lexicon-2026-09-25.11',
 checkedAt:'2026-09-23',
 platformPolicy:'플랫폼별 리뷰 운영정책(예: 지도·예약 플랫폼) 공식 URL은 아직 확인하지 않았다. 게시 전 해당 플랫폼 공식 정책 페이지에서 확인하고, 확인되면 사전 버전을 올려 출처를 추가한다.',
 sources:{
  fair_labeling:{title:'표시·광고의 공정화에 관한 법률',url:law('표시ㆍ광고의공정화에관한법률')},
  endorsement_guideline:{title:'추천·보증 등에 관한 표시·광고 심사지침(공정거래위원회 고시)',url:'https://www.law.go.kr/행정규칙/추천ㆍ보증등에관한표시ㆍ광고심사지침'},
  ecommerce_act:{title:'전자상거래 등에서의 소비자보호에 관한 법률',url:law('전자상거래등에서의소비자보호에관한법률')},
  ai_basic_act:{title:'인공지능 발전과 신뢰 기반 조성 등에 관한 기본법',url:law('인공지능발전과신뢰기반조성등에관한기본법')},
  network_act:{title:'정보통신망 이용촉진 및 정보보호 등에 관한 법률 제50조(영리목적의 광고성 정보 전송 제한)',url:law('정보통신망이용촉진및정보보호등에관한법률')},
  food_labeling_act:{title:'식품 등의 표시·광고에 관한 법률',url:law('식품등의표시ㆍ광고에관한법률')},
  origin_act:{title:'농수산물의 원산지 표시 등에 관한 법률',url:law('농수산물의원산지표시등에관한법률')},
  cosmetics_act:{title:'화장품법',url:law('화장품법')},
  copyright_act:{title:'저작권법',url:law('저작권법')},
  unfair_competition_act:{title:'부정경쟁방지 및 영업비밀보호에 관한 법률(유명인 성명·초상 등 무단 사용)',url:law('부정경쟁방지및영업비밀보호에관한법률')},
  trademark_act:{title:'상표법',url:law('상표법')},
  franchise_act:{title:'가맹사업거래의 공정화에 관한 법률(법률 제20712호)',url:`${FR_DRF}&target=law&type=XML&MST=268283`},
  franchise_decree:{title:'가맹사업거래의 공정화에 관한 법률 시행령(대통령령 제36561호, 2026-08-04 시행)',url:`${FR_DRF}&target=eflaw&type=XML&MST=288453&efYd=20260804`},
  franchise_false_info_notice:{title:'가맹사업거래 상 허위·과장 정보제공행위 등의 유형 지정고시(공정거래위원회고시 제2019-8호, 2019-11-20 시행)',url:`${FR_DRF}&target=admrul&type=XML&ID=2100000183885`},
 },
 rules:[
  // ① 플랫폼 리뷰: 보상 조건부 리뷰 요청, 영수증 리뷰 이벤트, 체험단 대량 리뷰.
  {id:'review_reward',category:'platform_review',severity:'block',title:'보상을 조건으로 리뷰·별점을 요청',match:'(?:리뷰|후기|별점|평점)[^.\\n]{0,30}(?:작성\\s?시|남기(?:면|시면)|남겨\\s?주시면|작성하(?:면|시면)|인증\\s?시|인증하(?:면|시면)|써\\s?주시면|올려\\s?주시면|쓰(?:면|시면)|주시면|작성\\s?(?:고객|하신\\s?분)|참여\\s?(?:고객|하신\\s?분))[^.\\n]{0,30}(?:증정|드립니다|드려요|드려|제공|할인|쿠폰|적립|서비스|무료|지급|선물|사은품)',sources:['fair_labeling','endorsement_guideline']},
  {id:'receipt_review_event',category:'platform_review',severity:'block',title:'영수증·리뷰 이벤트',match:'영수증\\s?리뷰[^.\\n]{0,20}(?:이벤트|증정|혜택|적립)|리뷰\\s?이벤트',sources:['fair_labeling','endorsement_guideline']},
  {id:'bulk_review',category:'platform_review',severity:'block',title:'체험단·대량 리뷰 확보',match:'(?:체험단|리뷰어|서포터즈)[^.\\n]{0,20}\\d{2,}\\s?(?:명|건)|리뷰\\s?\\d{2,}\\s?건[^.\\n]{0,15}(?:확보|모집|작업|구매|대행)|(?:확보|모집|작업|구매|대행)[^.\\n]{0,15}리뷰\\s?\\d{2,}\\s?건|리뷰\\s?(?:대행|작업|구매)|(?:대량|다수)[^.\\n]{0,6}(?:리뷰|후기)',except:'^(?!.*(?:체험단|서포터즈|리뷰어|모집|대행|작업|구매)).*(?:목표|지표|KPI|측정)',sources:['fair_labeling','endorsement_guideline']},
  // ② 공정위 추천·보증: 가짜 체험담, 협찬·광고 표기 누락, 가상인물 미표시.
  {id:'fake_testimonial',category:'endorsement',severity:'block',title:'가짜·위장 체험담',match:'(?:고객|손님|소비자|구매자)[^.\\n]{0,6}(?:인\\s?척|처럼\\s?(?:꾸며|위장|작성))|가짜\\s?(?:후기|리뷰|체험담|계정)|위장\\s?(?:후기|리뷰)|(?:직원|지인|가족)[^.\\n]{0,12}(?:후기|리뷰)[^.\\n]{0,10}(?:작성|남기|올리)|(?:후기|리뷰)를?\\s?(?:대신|대리)\\s?(?:작성|써)',sources:['fair_labeling','endorsement_guideline']},
  {id:'sponsorship_undisclosed',category:'endorsement',severity:'block',title:'협찬·광고 관계 표기 누락',match:'협찬|체험단|원고료|제품을?\\s?(?:무상\\s?)?제공(?:받|하고|해)|무상\\s?제공|유료\\s?(?:게시|포스팅)|'+PAID_AD+'|광고비[^.\\n]{0,10}(?:지급|받)|대가를?\\s?(?:지급|받)',cleared:'\\[광고\\]|\\(광고\\)|#광고|#협찬|#유료광고|유료\\s?광고\\s?포함|소정의\\s?원고료|(?:광고|협찬)[^.\\n]{0,20}(?:표기|표시|문구)(?:를|을)?[^.\\n]{0,10}?(?:포함|넣|명시|붙|달|추가)(?!지\\s?(?:않|말|마)|하지\\s?(?:않|말|마))|경제적\\s?(?:대가|이해관계)[^.\\n]{0,12}(?:표시|표기|밝|명시|공개)|제공받아\\s?작성',sources:['fair_labeling','endorsement_guideline']},
  {id:'disclosure_omitted',category:'endorsement',severity:'block',title:'광고·협찬 표기를 빼라는 지시',match:'(?:광고|협찬|유료|AI)\\s?(?:표기|표시|문구|해시태그|고지)[^.\\n]{0,8}(?:빼|생략|없이|숨기|지우|제거)',sources:['fair_labeling','endorsement_guideline']},
  {id:'virtual_person_undisclosed',category:'endorsement',severity:'block',title:'가상인물 추천·보증 표시 누락',match:'가상\\s?(?:인물|인간|모델|인플루언서)|버추얼\\s?(?:인플루언서|모델|휴먼)|AI\\s?(?:인플루언서|모델|아바타)|디지털\\s?휴먼',cleared:'가상\\s?인물(?:임|입니다|이라는|로\\s?표시|\\s?표시)|가상\\s?인간(?:임|입니다)|실제\\s?인물이\\s?아닙|#가상인간|#가상인물|#버추얼|AI\\s?(?:생성|합성)\\s?인물(?:임|입니다|\\s?표시)',sources:['endorsement_guideline','fair_labeling']},
  // ③ AI 기본법: 생성형 AI 결과물 표시 필요 플래그.
  {id:'ai_generated_unlabeled',category:'ai_label',severity:'warn',title:'AI 생성 소재 표시 필요',match:'(?:AI|인공지능|생성형)[^.\\n]{0,20}(?:이미지|영상|음성|목소리|사진|일러스트|캐릭터|배경|소재)|딥페이크|합성\\s?(?:음성|얼굴)',cleared:'AI\\s?(?:생성|활용|제작)[^.\\n]{0,12}(?:표시|표기|고지|워터마크|라벨)|AI\\s?소재\\s?[·,/]\\s?(?:광고\\s?)?(?:표시|표기)|인공지능[^.\\n]{0,12}(?:표시|표기|고지)|#AI\\s?생성|AI로\\s?(?:생성|제작)(?:됨|되었습니다)',sources:['ai_basic_act']},
  // ④ 정보통신망법: 광고 메시지의 (광고) 표기·야간 전송·수신 동의·수신거부 안내.
  {id:'ad_label_missing',category:'ad_message',severity:'block',title:'광고 메시지 (광고) 표기 누락',match:MESSAGE,context:PROMOTION,except:DEFERRAL,cleared:'\\(광고\\)|\\[광고\\]|（광고）',sources:['network_act']},
  {id:'consent_missing',category:'ad_message',severity:'warn',title:'광고 메시지 수신 동의 전제 누락',match:MESSAGE,context:PROMOTION,except:DEFERRAL,cleared:'수신\\s?(?:에\\s?)?동의|마케팅\\s?(?:정보\\s?)?수신|옵트인|opt-?in',sources:['network_act']},
  {id:'optout_missing',category:'ad_message',severity:'warn',title:'무료 수신거부 방법 안내 누락',match:MESSAGE,context:PROMOTION,except:DEFERRAL,cleared:'수신\\s?거부|무료\\s?거부|수신\\s?철회|080-?\\d',sources:['network_act']},
  {id:'night_send',category:'ad_message',severity:'warn',title:'야간(21시~08시) 광고 전송은 별도 동의 필요',match:'(?:밤|저녁|오후)\\s?(?:9|10|11)\\s?시|(?:새벽|오전)\\s?[0-7]\\s?시|(?<!\\d)(?:21|22|23|24)\\s?시(?!간)|(?<![\\d:])(?:21|22|23|0[0-7])\\s?:\\s?[0-5]\\d|자정|심야|야간',also:'발송|전송|보내|보낸|푸시',cleared:'야간[^.\\n]{0,10}동의|별도\\s?(?:야간\\s?)?(?:수신\\s?)?동의',sources:['network_act']},
  // ⑤ 식품 표시·광고: 질병 예방·치료 효능 오인, 원산지 주장(국내산·OO산·한우 등) 시 원장 미확정 경고. 확인 목록의 '원산지' 낱말은 주장이 아니다.
  {id:'disease_claim',category:'food_claim',severity:'block',title:'식품의 질병 예방·치료 효능 표현',match:'(?:당뇨|고혈압|혈압|혈당|비만|면역력?|질병|질환|감기|변비|치매|숙취)[^.\\n]{0,10}(?:예방|치료|개선|완화|낮춰|낮춘|낮추|강화|회복|효과|효능|높여|높인|줄여|줄인|해소|에\\s?좋은)|다이어트\\s?(?:효과|효능)|(?<![가-힣])암\\s?(?:예방|치료|억제)|항암|해독\\s?(?:효과|작용)',sources:['food_labeling_act']},
  {id:'origin_unconfirmed',category:'food_claim',severity:'warn',title:'원산지 주장(원장에 원산지 확정값 없음)',match:'(?:국내|국|수입|미국|호주|중국|칠레|브라질|스페인|캐나다|뉴질랜드|베트남|태국|일본|이탈리아|독일|노르웨이|러시아)산(?![가-힣]*업)|한우|한돈',ledgerKey:'원산지|산지',marked:true,sources:['origin_act','food_labeling_act']},
  // ⑥ 화장품: 의약품 오인, 미인증 기능성 표현.
  {id:'drug_claim',category:'cosmetic_claim',severity:'block',title:'화장품의 의약품 오인 표현',match:'(?:여드름|아토피|피부염|습진|건선|탈모|흉터|상처|염증|무좀|기미)[^.\\n]{0,12}(?:치료|완치|치유|재생|없애|없앤|사라지|사라진|낫)|(?:세포|피부|모발)\\s?재생|의약품\\s?(?:수준|급|효과)|약처럼|처방\\s?(?:없이|받은)',sources:['cosmetics_act']},
  {id:'functional_unverified',category:'cosmetic_claim',severity:'warn',title:'기능성 인증 근거 없는 기능성 표현',match:'미백|주름\\s?(?:개선|완화)|자외선\\s?차단|탈모\\s?(?:증상\\s?)?(?:완화|방지)|여드름성\\s?피부\\s?완화|피부\\s?장벽\\s?(?:강화|개선)|SPF\\s?\\d+|PA\\+',cleared:'기능성\\s?(?:화장품|인증|심사|보고)|식약처\\s?(?:심사|보고|인증)',ledgerKey:'기능성',sources:['cosmetics_act']},
  // ⑦ 전자상거래: 판매 조건·가격 표시 누락.
  {id:'price_missing',category:'ecommerce_terms',severity:'warn',title:'구매 유도 문구에 가격 표시 누락',match:PURCHASE_CTA,except:MEASUREMENT,held:CTA_HELD,cleared:'\\d{1,3}(?:,\\d{3})+\\s?원|\\d+\\s?원|가격[^.\\n]{0,6}\\d|\\[(?:확정\\s?)?(?:가격|판매가|판매\\s?가격|정가)(?![^\\]]*(?:확인|문의|미정|필요|협의))[^\\]]{0,8}\\]',sources:['ecommerce_act']},
  {id:'terms_missing',category:'ecommerce_terms',severity:'warn',title:'구매 유도 문구에 판매 조건(배송·교환·환불 등) 누락',match:PURCHASE_CTA,except:MEASUREMENT,held:CTA_HELD,cleared:'배송|교환|환불|반품|청약\\s?철회|판매\\s?(?:기간|조건)|픽업|수령',sources:['ecommerce_act']},
  {id:'discount_basis_missing',category:'ecommerce_terms',severity:'warn',title:'할인 표시에 기준 가격 누락',match:'\\d{1,2}\\s?%\\s?(?:할인|OFF|off|세일)|할인가|특가|반값|[\\d,]+\\s?원\\s?할인',cleared:'정가|정상가|기존\\s?가|할인\\s?전|원래\\s?가격|소비자가',marked:true,sources:['ecommerce_act','fair_labeling']},
  // ⑧ 권리: 아티스트 이름·사진·로고 사용 시 권리 확인 미기재.
  {id:'artist_rights_unconfirmed',category:'rights',severity:'warn',title:'아티스트·유명인 이름·사진·로고 권리 확인 미기재',match:'(?:아티스트|아이돌|멤버(?!십|\\s?전용|\\s?혜택|\\s?등급)|가수|배우|셀럽|연예인|유명인|포토\\s?카드|앨범\\s?(?:재킷|자켓|커버|이미지)|팬아트|초상|타사\\s?로고|방송\\s?(?:캡처|화면)|캐릭터\\s?IP)[^.\\n]{0,20}(?:사용|활용|게시|삽입|노출|넣|합성|인쇄|배치|배경)(?!\\s?(?:시간|시각|일정|일|빈도|주기|채널|위치|순서|횟수))',cleared:'권리\\s?(?:확인|처리|확보)|초상권|저작권|퍼블리시티|사용\\s?(?:허락|승인|허가|계약)|라이선스|라이센스|소속사[^.\\n]{0,10}(?:승인|확인|허락|협의)',sources:['copyright_act','unfair_competition_act','trademark_act']},
  // ⑨ 가맹 모집(트랙 R R2, opts.franchise로만 켠다). hard_block(해제 불가)은 등급이 아니라 lib/franchise-rules.ts FRANCHISE_HARD_BLOCK_IDS다. 여기서는 block·warn만 쓴다.
  // 게이트 판정기(lib/franchise-compliance.ts)는 match·also·except·cleared만 쓰고 ledgerKey·marked·인용 강등은 쓰지 않는다. ledgerKey·marked는 이 사전을 옵트인한 A2 경로용이다.
  {id:'kr.fr.revenue_guarantee',category:'franchise_recruit',severity:'block',title:'수익·매출 보장 표현',match:REV_GUARANTEE,sources:['franchise_act','franchise_decree','franchise_false_info_notice']},
  // 조문(제15조의2⑤⑥)은 보험·채무지급보증·공제 계약 표지다. '가맹금 안전·안심·보호·100%' 문구를 유사 표지로 보는 확장은 휴리스틱이라 lib/franchise-rules.ts FRANCHISE_OFFICIAL_EXTENSIONS에 둔다.
  {id:'kr.fr.insurance_mark',category:'franchise_recruit',severity:'block',title:'보험 계약 사실 없는 가맹금 보호 표지',match:INSURANCE_MARK,sources:['franchise_act']},
  {id:'kr.fr.association_condition',category:'franchise_recruit',severity:'block',title:'가맹점사업자단체 가입·미가입 조건',match:ASSOCIATION_CONDITION,except:'관계\\s?없이|무관하게|상관\\s?없이|자유',sources:['franchise_act']},
  {id:'kr.fr.store_count_claims',category:'franchise_recruit',severity:'block',title:'매장 수 주장',match:FR_STORE_COUNT,ledgerKey:'^(?:franchise_store_count|direct_store_count)$',marked:true,sources:['franchise_false_info_notice','fair_labeling']},
  {id:'kr.fr.startup_cost_claims',category:'franchise_recruit',severity:'block',title:'창업비용 표현',match:`${FR_STARTUP_LABEL}|${FR_STARTUP_AMOUNT_FIRST}|${FR_COST_CLAIM}`,ledgerKey:'^(?:startup_cost_total|franchise_fee|education_fee|franchise_deposit|interior_cost|royalty_fee)$',marked:true,sources:['franchise_decree','franchise_false_info_notice']},
  {id:'kr.fr.ip_claims',category:'franchise_recruit',severity:'block',title:'특허·상표 등록 표현',match:'특허\\s?(?:받은|등록|기술|출원|인증|보유)|특허\\s?제?\\s?\\d|상표\\s?(?:권\\s?)?등록|디자인\\s?(?:권\\s?)?등록(?!\\s?(?:하|해|후|시|이벤트|기회))|디자인권|등록\\s?(?:상표|디자인)|실용\\s?신안|[Pp]atent(?:ed|s)?(?![a-z])',ledgerKey:'^ip_registration$',marked:true,sources:['franchise_decree','franchise_false_info_notice']},
  {id:'kr.fr.conditional_support',category:'franchise_recruit',severity:'block',title:'조건 없는 지원처럼 보이는 표현',match:`(?:인테리어\\s?(?:비용|비|공사비)?|가맹비|${CLS}교육비|로열티|창업\\s?(?:자금|비용)|장비|집기|간판|오픈\\s?(?:비용|자금|물품)|개설\\s?비용|초기\\s?(?:비용|자금))\\s?(?:무상\\s?|전액\\s?)?지원|정부\\s?창업\\s?지원|정부\\s?지원\\s?(?:창업|자금|대출)|창업\\s?대출\\s?(?:연계|알선|지원)|무조건\\s?지원|(?:인테리어|오픈|개설|창업|초기|장비|간판|교육)\\s?(?:비용|비|자금|물품)?[^.\\n]{0,6}?(?:전액\\s?)?(?:본사|본부)\\s?(?:가\\s?)?(?:전액\\s?)?부담`,except:`${SUPPORT_CONDITION}|${SUPPORT_NOT_FRANCHISEE}`,marked:true,sources:['franchise_decree','franchise_false_info_notice']},
  {id:'kr.fr.superlative_claims',category:'franchise_recruit',severity:'block',title:'업계 최저·1위·최초·유일 표현',match:'업계\\s?(?:최저|최고|최초|1\\s?위|유일)|(?:국내|전국)\\s?(?:1\\s?위|최초|유일|최대)|No\\.?\\s?1(?!\\d)(?![^\\n]{0,60}No\\.?\\s?[2-9](?!\\d))|넘버\\s?원',ledgerKey:'^claim_basis$',marked:true,sources:['franchise_false_info_notice','fair_labeling']},
  {id:'kr.fr.trade_area_claims',category:'franchise_recruit',severity:'block',title:'상권 분석·유동인구·경쟁 점포 주장',match:'(?<!(?:골목|동네|지역|전통\\s?시장)\\s?)상권\\s?(?:분석(?!\\s?(?:은|는|을|를)\\s?[^.,\\n]{0,25}?(?:함께|같이|현장|직접|도와|확인합니다|진행합니다|안내합니다))|보장|보호|검증)|유동\\s?인구\\s?(?:하루\\s?|일\\s?)?\\d|경쟁\\s?(?:점포|매장|업체|업소|가게|브랜드|점)\\s?(?:이\\s?|가\\s?)?(?:없|0|제로)',ledgerKey:'^trade_area_source$',marked:true,sources:['franchise_decree','franchise_false_info_notice']},
  {id:'kr.fr.production_claims',category:'franchise_recruit',severity:'block',scope:'recruitment',title:'자체 공장·직접 생산 표현',match:'자체\\s?(?:공장|생산|제조)|직영\\s?공장|본사\\s?(?:직접\\s?)?(?:공장|생산|제조)|직접\\s?(?:생산|제조|굽|구운|구워|만든|만들)',ledgerKey:'^production_method$',marked:true,sources:['franchise_false_info_notice','franchise_decree']},
  {id:'kr.fr.exclusive_channel_claims',category:'franchise_recruit',severity:'block',scope:'recruitment',title:'가맹점 전용 판매 표현',match:'가맹점\\s?(?:전용|에서만|한정|만(?=\\s?(?:판매|취급|구매|공급|주문|파는|살\\s?수|의)))|오직\\s?가맹점',ledgerKey:'^sales_channels$',marked:true,sources:['franchise_false_info_notice']},
  {id:'kr.fr.territory_claims',category:'franchise_recruit',severity:'warn',title:'독점 상권·영업지역 보장 표현',match:'독점\\s?(?:상권|영업\\s?(?:지역|권))|영업\\s?지역\\s?(?:보장|보호)|상권\\s?독점',ledgerKey:'^territory_clause$',sources:['franchise_act']},
  {id:'kr.ad.endorsement_disclosure',category:'franchise_recruit',severity:'warn',title:'경제적 이해관계 표시 없는 점주 후기',match:'(?:가맹\\s?)?점주\\s?(?:님\\s?)?(?:후기|인터뷰|추천|이야기|증언)',cleared:'광고|협찬|경제적\\s?(?:대가|이해관계)|대가를?\\s?받',sources:['endorsement_guideline','fair_labeling']},
  {id:'kr.ad.virtual_human_label',category:'franchise_recruit',severity:'warn',title:'가상인물 표시 없는 AI 가상인물',match:'(?:AI|가상)\\s?(?:점주|인물|모델|아바타(?!\\s?(?:포토\\s?존|만들기|꾸미기|필터|스티커|체험|게임))|인플루언서)',cleared:'가상\\s?인물(?:임|입니다|\\s?표시)|AI\\s?생성\\s?인물',sources:['endorsement_guideline','fair_labeling']},
 ],
};
