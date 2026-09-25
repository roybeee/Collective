// 규제·플랫폼·업종 표시 가드레일(A2) 순수 함수. 합성 위반 예시는 전부 검출하고 정상 예시 오탐은 0건이어야 한다. 법률 자문이 아니다.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {SourceTextModule,createContext} from 'node:vm';
import ts from 'typescript';
const context=createContext({console}),cache=new Map();
function moduleFor(path){path=resolve(path);if(cache.has(path))return cache.get(path);const m=new SourceTextModule(ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText,{context,identifier:path});cache.set(path,m);return m;}
async function load(path){const m=moduleFor(path);if(m.status==='unlinked')await m.link((s,r)=>moduleFor(resolve(dirname(r.identifier),s+'.ts')));if(m.status!=='evaluated')await m.evaluate();return m.namespace}
const {checkCompliance,downgradeVerdict,COMPLIANCE_LEXICON,COMPLIANCE_NOTICE,COMPLIANCE_CATEGORIES}=await load('lib/graders/compliance.ts');
const {qualityCriteria,qualityScopeNotice}=await load('lib/quality.ts');
const passed=[];
const check=(name,fn)=>{fn();passed.push(name)};
const categoriesOf=(text,opts)=>[...new Set(checkCompliance(text,opts).issues.map(i=>i.category))];

// 합성 위반 예시: [범주, 문장]. 범주마다 2건 이상.
const violations=[
 ['platform_review','영수증 리뷰 작성 시 음료 1잔을 증정합니다.'],
 ['platform_review','별점 5점 리뷰를 남겨 주시면 다음 방문 때 쓸 쿠폰을 드려요.'],
 ['platform_review','블로그 체험단 30명을 모집해 오픈 첫 주에 리뷰 100건을 확보한다.'],
 ['platform_review','영수증리뷰 작성시 김밥 증정 이벤트'],
 ['endorsement','직원들이 실제 고객인 척 후기를 작성해 올린다.'],
 ['endorsement','인플루언서에게 제품을 무상 제공하고 후기 게시를 요청한다.'],
 ['endorsement','협찬 게시물로 올리되 광고 표기는 빼 주세요.'],
 ['endorsement','가상 인플루언서 루나가 매장을 소개하는 릴스를 게시한다.'],
 ['ai_label','생성형 AI로 만든 매장 이미지를 메인 배너에 쓴다.'],
 ['ai_label','AI 음성으로 내레이션한 15초 영상을 게시한다.'],
 ['ad_message','오픈 알림 문자 초안: 가상분식 오픈! 첫 주문 고객께 김밥을 드립니다. 지금 방문하세요.'],
 ['ad_message','카카오톡 채널 메시지는 밤 10시에 발송해 퇴근 후 주문을 유도한다. (광고) 표기와 무료 수신거부 안내를 넣고 수신 동의 고객에게만 보낸다.'],
 ['ad_message','앱 푸시 문안: 오늘만 김밥 무료! 지금 주문하세요'],
 ['food_claim','매일 먹으면 면역력 강화와 다이어트 효과가 있는 떡볶이입니다.'],
 ['food_claim','혈당을 낮춰 주는 건강 김밥'],
 ['food_claim','국내산 돼지고기로 만든 순대입니다.'],
 ['food_claim','고춧가루는 100% 국산만 씁니다.'],
 ['cosmetic_claim','이 미스트가 여드름을 치료하고 피부 재생을 돕습니다.'],
 ['cosmetic_claim','아토피가 사라지는 진정 미스트'],
 ['cosmetic_claim','한 번만 뿌려도 미백·주름 개선 효과'],
 ['ecommerce_terms','지금 구매하기 버튼으로 스토어에 연결합니다. 한정 수량!'],
 ['ecommerce_terms','오늘만 30% 할인 특가, 바로 구매하세요.'],
 ['rights','아티스트 사진을 매장 포스터에 넣어 팬 방문을 유도한다.'],
 ['rights','앨범 재킷 이미지를 카드뉴스 배경으로 사용한다.'],
 // 조건 주석 괄호·권유형 어미가 붙은 변형: 문장 안 부정어가 위반 전체를 면제하면 안 된다.
 ['platform_review','영수증 리뷰 이벤트: 참여 고객께 음료 증정(주류 제외).'],
 ['platform_review','리뷰 작성 시 음료 증정 (1인 1회, 중복 참여 금지)'],
 ['ad_message','문자 발송 문안: 오픈 기념 20% 할인 쿠폰 드립니다(배달 주문 제외).'],
 ['food_claim','면역력 강화에 좋은 떡볶이, 오늘만 특가(포장 제외)!'],
 ['endorsement','체험단 30명 모집, 제품 무상 제공 (중복 신청 불가, 대리 작성 금지)'],
 ['food_claim','감기 예방 효과 뛰어난 국물, 잊지 말고 챙기세요.'],
 // 조건형·대상형 보상 리뷰 요청과 효능형 표현 변형.
 ['platform_review','후기 쓰면 음료 서비스!'],
 ['platform_review','영수증 인증하고 리뷰 쓰면 쿠폰 지급'],
 ['platform_review','별점 5점 주시면 사이드 무료'],
 ['platform_review','리뷰 작성 고객께 음료 증정'],
 ['platform_review','리뷰 작성하신 분께 음료를 드립니다'],
 ['food_claim','면역력을 높여주는 김밥.'],
 ['food_claim','혈당 스파이크를 줄여주는 메뉴.'],
 ['food_claim','당뇨에 좋은 음식입니다.'],
 ['food_claim','숙취해소에 좋은 해장 떡볶이.'],
 // 표현 부재 부정(수용 기준 '… 표현이 없다')은 꾸밈말이 붙은 광고 수사를 면제하지 않는다(2026-09-25 파일럿 1).
 ['food_claim','혈당을 낮춰 당뇨 개선, 더 이상의 표현이 없습니다.'],
 ['food_claim','면역력 강화 김밥, 이보다 좋은 문구가 없다.'],
 // 품질 측정 v2: 부정·중단 조건·보류·매체 집행 면제와 ## 섹션 해소 범위가 진짜 위반을 놓치지 않는다.
 ['endorsement','체험단 모집 게시물을 올린다.'],
 ['endorsement','직원이 후기를 작성해 올린다.'],
 ['endorsement','인플루언서 유료 광고 게시물을 예산 50만 원으로 올린다.'],
 ['endorsement','협찬 게시물 3건을 광고 세트로 부스팅한다.'],
 ['endorsement','체험단 게시물은 보류 없이 이번 주에 올린다.'],
 ['endorsement','광고 표기가 빠진 채로 협찬 게시물을 올린다.'],
 ['endorsement','직원이 후기를 작성해 올리고 광고 표시가 누락될 때 수정한다.'],
 ['endorsement','## 채널 실행\n### 인플루언서 A\n제품을 제공받아 작성한 후기입니다. #광고\n\n### 블로그 체험단\n제품을 무상 제공하고 후기를 받는다.'],
 ['endorsement','## 표시 규칙\n협찬·체험단을 쓸 경우 해당 문안에 ‘#광고’를 표시한다.\n\n## 채널 실행\n### 블로그\n체험단 모집 게시물을 올린다.'],
 ['endorsement','### 표시 규칙\n협찬·체험단을 쓸 경우 해당 문안에 ‘#광고’를 표시한다.\n---\n### 블로그\n체험단 모집 게시물을 올린다.'],
 ['ecommerce_terms','지금 구매하세요!'],
 ['ecommerce_terms','‘주문하기’ 버튼 문안: 지금 주문하기'],
 ['ecommerce_terms','오픈 이벤트는 보류하고 지금 구매하세요 버튼을 메인에 둔다.'],
 // 측정 v2 리뷰 재현(HEAD 443fff4에서 검출, v2 초안에서 미검출): 뒤쪽 다른 대상의 '보류'·'쓰지 않는다'는 앞 위반을 면제하지 않는다.
 ['endorsement','가짜 후기 3건을 올려 초기 평점을 만든다, 이벤트는 보류.'],
 ['endorsement','지인 리뷰 작성을 부탁해 첫 주 평점을 올리는 방안, 외부 광고는 보류'],
 ['endorsement','지인에게 리뷰를 부탁해 남기게 하고, 유료 광고 집행은 보류한다.'],
 ['endorsement','체험단 모집 게시물을 올리는 계획, 유료 광고 집행은 보류'],
 ['endorsement','제품을 무상 제공하고 블로거 후기를 받는다, 할인 표기는 보류'],
 ['platform_review','영수증 리뷰 작성 시 음료 1잔을 증정하는 오픈 이벤트를 매장 포스터와 계산대 안내로 알리며, 할인 표현은 쓰지 않는다.'],
 ['endorsement','체험단 30명을 모집해 오픈 첫 주 리뷰 100건을 확보하는 일정에서 할인 문구는 쓰지 않는다.'],
 // 따옴표 초안에 붙인 표기·초안 본문의 표기·가격, 부정·생략한 표기 문장은 다른 ### 초안을 해소하지 않는다.
 ['endorsement','## 채널별 카피\n### 인스타 협찬 게시물\n“오늘 새로 입고된 앨범을 소개합니다 #광고”\n\n### 블로그 체험단 게시물\n“체험단으로 받은 앨범 후기를 남깁니다.”'],
 ['endorsement','## 채널별 카피\n### 인스타 협찬 게시물\n“#광고 오늘 새로 입고된 앨범을 소개합니다”\n\n### 블로그 체험단 게시물\n“체험단으로 받은 앨범 후기를 남깁니다.”'],
 ['endorsement','## 채널 실행\n### 블로그 A\n소정의 원고료를 받아 작성한 글입니다.\n\n### 블로그 체험단\n제품을 무상 제공하고 후기를 받는다.'],
 ['endorsement','## 실행\n### 콘텐츠\n인플루언서 협찬 게시물 2건을 올린다.\n\n### 표시\n협찬 게시물에는 ‘#광고’를 표시하지 않는다.'],
 ['endorsement','## 실행\n### 콘텐츠\n인플루언서 협찬 게시물 2건을 올린다.\n\n### 표시\n‘#광고’ 표기는 생략한다.'],
 ['endorsement','## 실행\n### 콘텐츠\n인플루언서 협찬 게시물 2건을 올린다.\n\n### 표시\n#광고 태그는 붙이지 않는다.'],
 // 금지어가 들어 있기만 한 소제목('보류 해제', '삭제 요청', '할인 제외', '보류 여부')은 금지 목록이 아니다.
 ['endorsement','### 보류 해제 후 실행\n체험단 모집 게시물을 올린다.'],
 ['endorsement','### 보류 없이 바로 진행\n체험단 모집 게시물을 올린다.'],
 ['endorsement','### 삭제 후 재게시 계획\n체험단 모집 게시물을 올린다.'],
 ['platform_review','## 실행 계획\n### 체험단 모집 문안 (보류 해제)\n체험단 20명을 모집해 후기를 올려 주시면 쿠폰을 드립니다.'],
 ['endorsement','### 수정 문안 (근거 없는 표현 삭제)\n직원들이 실제 고객인 척 후기를 작성해 올린다.'],
 ['endorsement','### 보류 여부\n직원들이 실제 고객인 척 후기를 작성해 올린다.'],
 ['endorsement','### 보류 해제 후 실행안\n직원 5명이 고객인 척 후기를 작성해 올립니다.'],
 ['platform_review','### 체험단 운영 (보류 해제 후)\n체험단 30명을 모집해 후기를 올리게 합니다.'],
 ['endorsement','### 삭제 요청 대응 뒤 게시할 후기 이벤트\n가짜 후기 10건을 올립니다.'],
 ['ecommerce_terms','### 할인 제외 상품 홍보 문안\n지금 바로 구매하세요!'],
 // 표기 누락 조건만 있고 결과가 시정 조치가 아닌 문장은 중단 조건이 아니다.
 ['endorsement','광고 표기가 없는 경우 협찬 게시물을 올린다.'],
 ['endorsement','광고 표시가 누락될 때에는 직원이 후기를 작성해 올린다.'],
 ['endorsement','체험단 게시물은 광고 표시가 없으면 반응이 더 좋으니 표시 없이 올립니다.'],
 ['endorsement','협찬 게시물은 광고 표기가 없으면 더 자연스러워 보입니다.'],
 ['endorsement','인플루언서 협찬 게시물에 표기가 빠지면 진정성이 올라갑니다.'],
 ['endorsement','체험단 후기는 광고 표기가 없는 경우 신뢰도가 높아 그대로 게시합니다.'],
 // 게시물을 가리키는 유료 광고와 게시자 문맥의 유료 광고는 매체 집행 문맥이어도 협찬 표기 대상이다.
 ['endorsement','예산 50만 원으로 블로그 유료 광고 게시물을 올린다.'],
 ['endorsement','유료 광고 포스팅을 월 예산 안에서 3건 올린다.'],
 ['endorsement','인플루언서와 함께 유료 광고를 돌린다.'],
 // 같은 문장의 다른 문구·버튼 보류는 실제 구매 CTA를 면제하지 않는다.
 ['ecommerce_terms','헤드라인은 ‘지금 구매하세요’, 서브 문구는 보류한다.'],
 ['ecommerce_terms','메인 CTA ‘지금 구매하기’, 서브 CTA 보류'],
 ['ecommerce_terms','CTA는 ‘바로 구매’로 하고 보조 버튼은 보류한다.'],
 ['ecommerce_terms','장바구니 담기 CTA를 쓰고 할인 문구는 보류한다.'],
 ['ecommerce_terms','카피 A: 지금 주문하기 — 쿠폰 문구는 확인 계획에 적는다.'],
 ['ecommerce_terms','결제하기 버튼으로 연결하고 배송 안내 문구는 확정 후 추가한다.'],
 // '온라인 판매' 명사 제외·'…할 수 있을 때만' 조건·인용 나열 쉼표 병합이 진짜 구매 유도를 놓치지 않는다(2026-09-25 64e51e8 재채점 뒤).
 ['ecommerce_terms','온라인 판매 시작! 링크에서 만나보세요.'],
 ['ecommerce_terms','필요할 때 지금 구매하세요.'],
 ['ecommerce_terms','살 수 있을 때 지금 구매하세요.'],
 // 확정 뒤 승인으로 미룬 규칙은 면제하되, 다른 절의 미룸은 구매 유도를 면제하지 않는다(R3 기준선).
 ['ecommerce_terms','지금 구매하세요, 가격은 확정된 뒤 별도 승인합니다.'],
 // '유료 광고비'(광고 예산) 제외가 협찬 대가·크리에이터 유료 광고를 놓치지 않는다(R3 기준선).
 ['endorsement','유료 광고비를 받고 후기를 쓴다.'],
 ['endorsement','인플루언서 유료 광고 게시물을 올린다.'],
 // 중단 조건 리드 아래 목록 제외가 목록 뒤 문장·중단이 아닌 리드의 목록을 면제하지 않는다.
 ['endorsement','다음 상황에서는 소재를 중단한다.\n- 품질 문제가 확인된다.\n\n오픈 주간에는 가짜 후기 3건을 올린다.'],
 ['ecommerce_terms','아래 문안을 게시한다.\n- 지금 구매하세요'],
 // 확정 가격 자리·퍼널 단계 나열 면제가 가격 문의 표시나 단계 두 개만 적은 구매 유도를 면제하지 않는다(R3 기준선).
 ['ecommerce_terms','[가격 문의] 지금 구매하세요.'],
 ['ecommerce_terms','상품 조회·장바구니 다음 단계로 지금 구매하세요.'],
 ['ecommerce_terms','[가격 협의] 배송·교환·환불 안내 포함, 지금 구매하세요.'],
 // 'AI 소재·광고 표시' 점검 항목 면제가 AI 소재 사용을 면제하지 않는다(R3 기준선).
 ['ai_label','AI 소재 이미지로 메인 배너를 만든다.'],
 // 광고 표시 계획 인정 범위를 넓혀도 '광고 표시는 넣지 않는다'는 표기 누락이다(R3 기준선).
 ['endorsement','체험단 협찬 게시물을 올리고 광고 표시는 넣지 않는다.'],
 // '게시 시간' 같은 명사 제외가 인물 사진 게시를 놓치지 않는다(R3 기준선).
 ['rights','아이돌 사진을 게시 시간에 맞춰 게시한다.'],
 // '장바구니' 명사 제외·'온라인 판매 KPI'·확인 뒤 검토·결정 CTA 면제가 진짜 구매 유도를 놓치지 않는다(R3 재채점 뒤).
 ['ecommerce_terms','장바구니에 담고 바로 결제하세요.'],
 ['ecommerce_terms','온라인 판매 KPI를 위해 지금 구매하세요 버튼을 둔다.'],
 ['ecommerce_terms','가격 확인 후 할인 쿠폰과 함께 지금 구매하세요.'],
 // 판매처·'주문하기 어려움'·지적 문장·확인 뒤 삽입 면제가 진짜 구매 유도를 놓치지 않는다(fa9da73 재채점 뒤).
 ['ecommerce_terms','지금 주문하기, 쉽고 빠르게!'],
 ['ecommerce_terms','온라인 판매 시작, 공식 판매처에서 지금 구매하세요.'],
 ['ecommerce_terms','가격 확인 후 ‘구매하기’를 크게 넣고 바로 게시한다.'],
 ['ecommerce_terms','‘구매하기’ 문구가 들어 있는 배너를 오늘 게시한다.'],
 // 확인 뒤 추가 면제는 그 CTA 목록의 것만이다: 앞 절에서 넣은 CTA, CTA 옆 다른 문구의 보류는 계속 잡는다.
 ['ecommerce_terms','“지금 구매하세요”, “주문하기” 같은 문구는 오늘 배너에 넣고, 할인 표현은 가격 확인 뒤 추가한다.'],
 ['ecommerce_terms','“지금 구매” 버튼 옆 할인 문구는 가격 확인 뒤 추가한다.'],
 // '사용 여부' 확인 항목 면제가 AI 소재 사용을 면제하지 않는다.
 ['ai_label','AI 생성·합성 소재 사용으로 배너를 만든다.'],
 ['ecommerce_terms','헤드라인 “오픈 기념”, “지금 구매하세요” 두 줄로 간다.'],
 ['ecommerce_terms','온라인 판매 실적을 늘리려면 지금 구매하세요 버튼을 키운다.'],
 ['ecommerce_terms','상품 보기 버튼은 보류하고 지금 구매하세요 문구를 메인에 둔다.'],
 ['ecommerce_terms','오픈 쿠폰 문구는 보류하고 지금 구매하세요 버튼을 메인에 둔다.'],
 ['ecommerce_terms','지금 구매하세요 버튼을 메인에 두고, 할인 문구는 가격 확정 후 넣는다.'],
 // 제안 동사의 긍정 사용과 실패 기준이 아닌 열의 위반은 계속 잡는다.
 ['endorsement','## 실행\n오픈 첫 주에 직원·지인에게 고객 후기 작성을 요청해 초기 평점을 만든다.'],
 ['endorsement','## 실행표\n| 단계 | 실행 내용 | 실패 기준 |\n|---|---|---|\n| 1주차 | 가족이 고객인 척 리뷰를 올려 평점을 채운다 | 평점 4.0 미만 |'],
 // 합성 라벨(판정어를 가운뎃점·빗금으로 잇고 '기준'을 한 번 쓴 칸)은 모든 판정어가 실패·곁말일 때만 규칙 칸이다. 합격이 섞이거나 곁말('수정 기준')만 있으면 계속 잡는다.
 ['endorsement','## 운영표\n| 항목 | 합격·수정 기준 |\n|---|---|\n| 후기 | 가족이 고객인 척 리뷰를 올린다 |'],
 ['endorsement','## 운영표\n| 항목 | 수정 기준 |\n|---|---|\n| 후기 | 가족이 고객인 척 리뷰를 올린다 |'],
 // 측정·조건 면제를 넓혀도 실제 구매 유도는 계속 잡는다: 카피 안의 화살표, 이벤트 문구, 블로그, 다른 문장의 조건, '확정된 가격으로'(조건이 아닌 수식).
 ['ecommerce_terms','## 게시 카피\n혜택 확인 → 지금 구매하세요!'],
 ['ecommerce_terms','## 게시 카피\n오픈 이벤트! 지금 구매하세요.'],
 ['ecommerce_terms','## 게시 카피\n블로그에서 소개한 신보, 지금 구매하세요.'],
 ['ecommerce_terms','## 게시 카피\n가격은 매장에서 확인된 뒤 안내합니다. 지금 구매하세요!'],
 ['ecommerce_terms','## 게시 카피\n확정된 가격으로 지금 구매하세요.'],
];
// 합성 정상 예시: [설명, 문장, 옵션]. 추천·보증 표기를 갖춘 협찬 게시물을 포함한다.
const normals=[
 // 실측(2026-09-24 ODA 전략 재평가) 합성 재현: 추천 조작을 '제안하지 않는다'는 규칙 문장, 평가표의 '실패 기준' 열(규칙 목록)
 ['testimonial practices not proposed (proposal verb negated)','## 콘텐츠 규칙\n지역 커뮤니티 게시물은 브랜드와의 관계를 공개합니다. 위장 후기, 직원·지인에게 고객 후기 작성 요청, 추천 조작, 대량 홍보는 제안하지 않습니다.'],
 // 실측(2026-09-25 파일럿 1 합의 단계) 합성 재현: 수용 기준의 표현 부재 서술.
 ['acceptance criterion states the claim wording is absent','## 수용 기준\n완성본에는 당뇨 개선·면역력 강화 표현이 없고, 후기·추천사 예시도 없다.'],
 ['failure-criteria column lists fake reviews as a rule','## 평가 기준\n| 기준 | 통과 조건 | 실패 기준 |\n|---|---|---|\n| 표현 안전성 | 인기·할인·후기·추천을 근거 없이 쓰지 않음 | 과장, 가짜 후기, 숨은 광고 포함 |'],
 // 실측(2026-09-25 ODA 전략 같은 저울 재채점) 합성 재현: 합성 라벨 '탈락·수정 기준' 열(규칙 목록)과 빗금 라벨 '실패/중단 조건' 열.
 ['compound failure column (탈락·수정 기준) lists fake reviews as a rule','### 크리에이티브 평가 기준\n\n| 평가 항목 | 합격 기준 | 탈락·수정 기준 |\n|---|---|---|\n| 표현 안전성 | 인기·할인·무료·후기·추천·건강 효능을 근거 없이 쓰지 않음 | 과장, 가짜 후기, 숨은 광고, 확인 전 가격·메뉴 포함 |'],
 ['slash compound failure column (실패/중단 조건) lists fake reviews','## 운영 기준\n| 항목 | 실패/중단 조건 |\n|---|---|\n| 후기 | 직원이 가짜 후기를 올림 |'],
 // 실측(2026-09-25 MAPDAL 같은 저울 재채점) 합성 재현: 퍼널·이벤트 측정 문장의 '장바구니', 조건을 앞에 둔 CTA, [가격 확인 필요] 표시 CTA는 구매 유도 문구가 아니다.
 ['funnel stages with cart','## 측정\n| 상품 상세→장바구니, 장바구니→결제 시작, 결제 시작→완료 단계별 이탈 및 짧은 사용자 피드백 확인 | [가설: 브리프 v1 고객의 이용 장애물·인사이트] |'],
 ['cart separated from paid orders','## 측정\n조회수, QR 조회, 광고 클릭, 길찾기, 장바구니는 유료 주문과 구분한다.'],
 ['analytics event add_to_cart','## 이벤트\n| add_to_cart | 상품 ID, 옵션, 수량, 세션 ID | 장바구니 담기. |'],
 ['analytics event begin_checkout','## 이벤트\n| begin_checkout | 세션 ID, 장바구니 ID, 상품 ID, 금액·통화, 국가, 실험군 | 결제 페이지 진입 로그와 대조 |'],
 ['cart to checkout rate','## 지표\n- 장바구니→결제 시작률.'],
 ['CTA planned after confirmation and marked','## CTA\n가격과 결제 조건이 확정되고 실제 결제 페이지가 정상 작동한 뒤: “구매하기” [가격 확인 필요]'],
 ['CTA conditioned on confirmed price','## CTA\nCTA: 가격과 판매 조건이 확인된 경우 “상품 선택하기” 또는 “구매하기”.'],
 // 실측(2026-09-25 64e51e8 같은 저울 재채점, MAPDAL 수정 v1 뒤 남은 warn 4건) 합성 재현: 목표·표 머리·재고의 '온라인 판매/구매' 명사, 한정 조건 CTA, 확인 뒤 고르는 CTA 선택지 나열.
 ['online sales goal statement','## 목표\n이번 목표는 mapdal.kr 온라인 판매이며 오프라인 매장·자판기 판매를 합산하지 않는다.'],
 ['online purchase relation table header','## 오프라인 접점\n| 접점 | 식별자 예시 | 기록할 것 | 온라인 구매와의 관계 |\n|---|---|---|---|\n| 매장 | 영수증 번호 | 방문일 | 없음 |'],
 ['online sales inventory row','## 운영\n| 오프라인 접점 | 매장·자판기 재고와 온라인 재고 분리 여부 | 온라인 판매 재고와 중복 판매 방지 | 자료 필요 / 운영 |'],
 ['CTA only when checkout is reachable','## CTA\n확인 완료 후 상품 선택이 필요하면 “상품 선택하기”, 바로 결제 단계로 이동할 수 있을 때만 “구매하기”.'],
 // 실측(2026-09-25 R3 기준선 MAPDAL 전략) 합성 재현: 구매·혜택 유도 문구 목록을 '확정된 뒤 별도 승인'으로 미룬 규칙.
 // 실측(2026-09-25 R3 기준선 S2 그로스) 합성 재현: 오가닉 채널 행의 예산 칸 '유료 광고비 0원'은 광고 관계 표기 대상이 아니다.
 // 실측(2026-09-25 ODA cmo 기준선 v1, 제목이 없을 때) 합성 재현: '다음 상황에서는 … 중단한다' 아래 목록은 중단 조건이지 문안이 아니다.
 ['stop-condition list under a lead sentence without a heading','[제안] 다음 상황에서는 해당 소재·채널·집행을 중단한다.\n\n- 승인되지 않은 메뉴, 가격, 영업시간이 노출된다.\n- 가격·영업정보 불일치, 개인정보 관리 문제, 허위 후기·위장 후기·추천 조작이 확인된다.'],
 // 실측(2026-09-25 R3 기준선 MAPDAL 회의) 합성 재현: 확정 가격 자리가 든 카피 구성의 CTA, 퍼널 단계를 나열한 측정 질문·선정 기준.
 ['CTA planned in copy that carries a confirmed price slot','## 카피 방향\n1안: 카피는 ‘[확정 상품명], MAPDAL.kr에서 확인하세요’와 ‘[확정 가격] · [배송 가능 지역] · 해외배송비 별도’로 구성하고 CTA는 ‘구매하기’로 둡니다.'],
 ['CTA in a template with a price and currency slot','## 상세 페이지 구성\n[확인된 구성 또는 옵션]\n[가격·통화]\n[배송 가능 지역·배송비 확인 경로]\n[결제·취소·반품 안내]\nCTA: 구매하기 또는 상품 선택하기'],
 // 실측(2026-09-25 R3 기준선 S7 데이터) 합성 재현: 검수 책임표의 'AI 소재·광고 표시' 점검 항목.
 ['AI asset and ad label review row','## 검수 책임\n| 점검 항목 | 담당 | 시점 | 목적 |\n|---|---|---|---|\n| 광고 표현·AI 소재·광고 표시 | 콘텐츠·법무 담당 | 소재 승인 전 | 미확인 주장·광고 표시 위반 방지 |'],
 // 실측(2026-09-25 R3 기준선 S7 콘텐츠) 합성 재현: 협찬·제품 제공 시 광고 표시를 추가한다는 계획과 표시 여부 체크리스트.
 ['conditional disclosure plan that adds the ad label','### 게시 전 확인\n유료 집행·협찬·제품 제공이 발생하면 게시 문안에 해당 광고 표시를 추가합니다.'],
 ['conditional disclosure plan and checklist','### 게시 전 확인\n유료 집행·협찬·제품 제공이 발생하면 게시 문안에 해당 광고 표시를 추가합니다.\n- [ ] 광고·협찬·유료 게시라면 해당 표시를 문안에 넣었는가'],
 // 실측(2026-09-25 R3 기준선 S8 크리에이티브) 합성 재현: 실험에서 고정할 변수 나열의 '배우 … 게시 시간'.
 ['fixed experiment variables list an actor and posting time','## 실험 조건\n이후 증명 장면, 길이, 배우, 조명, CTA, 랜딩 페이지, 게시 시간은 고정한다.'],
 // 실측(2026-09-25 R3 121791b 재채점 뒤 MAPDAL 남은 warn) 합성 재현: 퍼널 단계 명사 '장바구니', 온라인 판매 KPI 범위, 확인 뒤 검토·결정하는 CTA.
 // 실측(2026-09-25 R3 fa9da73 재채점 뒤 남은 warn) 합성 재현: 판매처 명사, '주문하기 어려움', 검수의 지적 문장과 확인 뒤 삽입.
 ['online sales outlets as alternatives','## 대안\n| 대안 | 내용 |\n|---|---|\n| 다른 온라인 판매처 | 공식 또는 비공식 유통처, 구매를 보류하거나 비교 검색하는 선택지가 있을 수 있음. |'],
 // 실측(2026-09-25 fa9da73 로컬 채널 재실행 S2 총괄) 합성 재현: 확인 항목의 'AI 생성·합성 소재 사용 여부'.
 // 실측(2026-09-25 fa9da73 로컬 채널 재실행 S6 전략): 인용 나열 뒤 '같은 … 문구는 … 확인 뒤 추가한다'는 확인 뒤로 미룬 CTA다.
 ['quoted CTA list added after confirmation','### 메시지 구조\n- 가격 미확정 상태이므로 “지금 구매”, “예약하기”, “이용하세요”, “저렴하게 맡기기” 같은 구매·주문 유도 문구는 가격 및 판매 조건 확인 뒤 추가한다.'],
 ...[['같은','문구는','넣는다'],['등의','표현을','추가한다'],['등','CTA를','적는다'],['같은','문구를','쓰기로 한다'],['같은','표현은','사용한다'],['등의','문구는','노출한다'],['같은','CTA는','반영한다']].map(([a,b,c])=>[`quoted CTA list ${a} ${b} ${c}`,`“바로 구매”, “주문하기” ${a} ${b} 가격 확정 후 ${c}.`]),
 ['AI asset use as a question to check','## 확인할 것\n- 콘텐츠 촬영 장소·소재의 실제 여부와 AI 생성·합성 소재 사용 여부.'],
 ['hard to buy as a customer inquiry','## 고객 문의\n가격을 몰라 구매하기 어렵다는 문의가 많다.'],
 ['hard to order as a customer barrier','## 고객 장벽\n| 고객 | 장벽 |\n|---|---|\n| 처음 방문 고객 | 메뉴·가격·포장 구성이 없어 비교·주문하기 어려움 |'],
 ['quality review points at a leftover CTA and inserts it after confirmation','## 검수 의견\n메시지의 ‘구매하기’ 제안이 가격 확인 전 단계에 남아 있어 혼동될 수 있습니다. 가격이 확정되기 전 CTA는 ‘상품 보기’로 제한하고, 상품명·가격·배송 조건 확인 후에만 ‘구매하기’를 삽입합니다.'],
 ['cart as a funnel stage in a scenario','## 고객 상황\n구매 직전 고객이 장바구니와 결제 단계에서 주문을 완료하려는 상황.'],
 ['cart in a checkout flow test','## 확인 계획\nmapdal.kr에서 상품 상세·장바구니·결제·주문 확인 흐름을 테스트 주문으로 검증합니다.'],
 ['online sales KPI scope','## 범위\n매장·자판기 수용량은 이번 온라인 판매 KPI에 포함하지 않으며, 관련 운영 자료가 들어와도 별도 사업으로 분리합니다.'],
 ['CTA decided after a price check','## CTA\n상품 선택이 필요 없는 단일 상품이면 CTA를 ‘자세히 보기’ 또는 가격 확인 후 ‘구매하기’로 결정합니다.'],
 ['CTA reviewed only after confirmation','## CTA 기준\n| 기준 | 내용 |\n|---|---|\n| 구매 CTA | 가격·재고·배송 조건 확인 후에만 “구매하기”를 검토 |'],
 ['placeholder for a CTA after confirmation','## 전환 문안\n가격 확인 후 전환 문안: [가격 확정 후 검토 — 구매하기]'],
 ['funnel stage list in a data question','## 확인 질문\n4) 비교할 기준 기간의 유효 세션·상품 조회·장바구니·결제 시작·결제 완료·취소·환불 원자료와 현재 추적 도구·주문 DB 구조는 무엇인가'],
 ['funnel stage list as selection data','## 선정 기준\n상품×국가 선정은 기존 주문·조회·장바구니 자료가 있으면 그 출처와 기간을 명시하고, 없으면 운영 가능성에 따른 임시 선정임을 기록한다.'],
 ['paid ad budget of zero in an organic channel row','## 채널 계획\n| 채널 | 소재 | 예산 배분 | 목적지 |\n|---|---|---|---|\n| Instagram 오가닉 숏폼 | CTA: “자세히 보기” | 제작비의 25%, 유료 광고비 0원으로 우선 설계 | 프로필 링크의 안내 페이지 |'],
 ['purchase prompts deferred until confirmed and approved','## 조건부 핵심 메시지\n문안 상태: [제안]. “지금 구매하세요”, “주문하기”, “할인받기”와 같은 구매·혜택 유도 표현은 가격과 해당 조건이 확정된 뒤 별도 승인합니다.'],
 ['CTA options chosen after checking the next step','## 하단 CTA\n- 하단에는 실제 사이트에서 다음 단계가 상품 선택인지 결제인지 확인한 뒤 “상품 자세히 보기”, “상품 선택하기”, “구매하기” 중 하나만 사용한다.'],
 ['disclosed sponsored post','[광고] 가상분식에서 제품을 제공받아 작성한 후기입니다. 떡볶이 소스가 달지 않고 매콤해 퇴근길 포장 메뉴로 괜찮았습니다. #광고 #협찬'],
 ['compliant ad message','(광고) 가상분식 오픈 안내 문자입니다. 오전 11시에 마케팅 정보 수신에 동의한 고객에게만 발송합니다. 무료 수신거부 080-000-0000'],
 ['origin confirmed in ledger','국내산 돼지고기로 만든 순대입니다.',{facts:{confirmed:[{key:'원산지',value:'돼지고기 국내산'}],prohibited:[]}}],
 ['certified functional cosmetic','식약처 기능성 화장품 심사를 받은 미백 미스트입니다. 사용 후 피부 상태는 개인마다 다릅니다.'],
 ['full sales terms','정가 12,000원, 할인가 9,000원(판매 기간 10월 1일~7일). 배송비 3,000원, 교환·환불은 수령 후 7일 이내 가능합니다. 지금 구매하기'],
 ['rights confirmed','아티스트 사진은 소속사 사용 승인과 초상권 확인 후 게시합니다.'],
 ['AI output labelled','AI로 생성한 이미지에는 "AI 생성" 표시를 붙여 게시합니다.'],
 ['review policy stated','방문 고객에게 리뷰를 강요하거나 보상을 조건으로 요청하지 않습니다.'],
 ['plain local plan','오픈 전에는 네이버 플레이스에 주소와 영업시간을 먼저 등록하고 입구 사진을 올립니다.'],
 ['negated prohibited list','가짜 리뷰·위장 후기·대량 후기 작업은 모두 하지 않습니다.'],
 ['virtual person disclosed','가상 인플루언서 루나(가상 인물입니다)가 메뉴를 소개합니다.'],
 ['health wording excluded','건강 효능 표현은 확인 전까지 쓰지 않습니다.'],
 // 실데이터 재채점에서 찾은 오탐의 합성 회귀 예시: 브랜드 핵심 메시지 초안은 전송 메시지가 아니고, 확인 목록의 '원산지' 낱말은 원산지 주장이 아니다.
 ['brand key message draft','핵심 메시지 초안: 가상동에 새로 여는 분식집, 오픈 소식을 먼저 알립니다.'],
 ['origin in a confirmation list','| 확인 항목: 메뉴명·판매가·원산지 | 게시 전 점장 확인 |'],
 // 계획·KPI 문장과 부정·회피 문장은 위반이 아니다.
 ['review count KPI','측정 지표: 오픈 4주 안에 네이버 플레이스 방문자 리뷰 30건을 목표로 둡니다.'],
 ['deferred message plan','오픈 준비 체크리스트입니다. 카카오톡 채널 메시지 발송은 수신 동의 고객이 생긴 뒤에 검토합니다.'],
 ['message replaced by a notice','오픈 주간에는 알림톡 발송 대신 매장 안내문을 씁니다.'],
 ['no review event (없이)','리뷰 이벤트 없이 진행합니다.'],
 ['no review event (안 합니다)','리뷰 이벤트는 진행 안 합니다.'],
 ['no review event (안 됩니다)','리뷰 이벤트를 하면 안 됩니다.'],
 ['no review event (피해야)','리뷰 이벤트는 피해야 합니다.'],
 ['no review event (불가)','리뷰 이벤트 불가.'],
 ['no receipt review event (금물)','영수증 리뷰 이벤트는 절대 금물입니다.'],
 ['no sponsorship (없이)','협찬 없이 자연 유입만 본다.'],
 ['membership coupon','멤버 전용 쿠폰을 사용할 수 있는 날을 안내합니다.'],
 ['order button measurement','네이버 주문하기 버튼 클릭 수를 측정합니다.'],
 // 품질 측정 v2(2026-09-24 재평가 실측 합성): 띄어쓴 항목의 부정 나열·중단 조건·보류·매체 광고 집행·같은 ## 섹션의 표기 문장·구매 CTA 보류 계획은 위반이 아니다.
 ['negated list with spaced items','| 채널 운영 원칙 | 정보 제공 중심, 브랜드 관계 공개, 위장 후기·대량 홍보·추천 조작 없음 |'],
 ['no fake review (rule)','가짜 후기를 만들지 않는다.'],
 ['stop condition: missing disclosure','### 중단 조건\n- 광고·협찬 콘텐츠에 필요한 표시가 누락될 때.'],
 ['stop condition: missing disclosure (면)','협찬 게시물에 광고 표기가 빠지면 즉시 게시를 내린다.'],
 ['stop condition before the match','광고 표시가 누락될 때 협찬 게시물을 내린다.'],
 ['paid ads not confirmed','목표는 유료 광고나 외부 게시를 확정하지 않고 첫 주 반응을 확인하는 것이다.'],
 ['paid media held','| 결제수단·언어·취소·환불 조건 확인 | 유료 광고 집행 보류 |'],
 ['paid media run','둘째 주부터 인스타그램 유료 광고 집행을 시작한다.'],
 ['paid media budget','유료 광고 예산은 하루 3만 원, CPC 기준으로 운영한다.'],
 ['sponsored content held','협찬 게시물은 표시 기준이 정해질 때까지 보류한다.'],
 ['disclosure rule in another ### of the same ## section','## 실행 계획\n### 콘텐츠\n인플루언서 협찬 게시물 2건을 올린다.\n\n### 표시 규칙\n협찬·체험단·제품 제공·유료 게시를 사용할 경우 해당 문안에 ‘#광고’, ‘#협찬’ 또는 ‘유료 광고 포함’을 표시한다.'],
 ['prohibited or held expressions table','### 금지 또는 보류 표현\n| 유형 | 표현 | 조치 |\n|---|---|---|\n| 추천·보증 | ‘체험단 후기’, ‘협찬 리뷰’ | 표기 확인 전 보류 |'],
 // 아래 세 문장은 구매 유도 문구 사전(PURCHASE_CTA)에 걸리지 않아 HEAD에서도 통과한다(사전을 넓힐 때의 회귀 가드).
 ['purchase CTA held','구매·주문 CTA 보류, 가격 없는 상품 정보 탐색 CTA만 사용'],
 ['purchase CTA after price','가격 확정 전에는 구매 CTA를 쓰지 않는다.'],
 ['purchase copy plan','구매 문구는 확인 계획에 적는다.'],
 // 구매 CTA 자체를 보류·미사용하거나 가격 확정 뒤 넣는·바꾸는 계획(구매하기·주문하기가 든 문장, HEAD에서 price·terms warn).
 ['purchase CTA held (구매하기)','구매하기·주문하기 CTA는 보류하고 상품 보기 CTA만 쓴다.'],
 ['purchase button after price','| CTA | 상품 보기 (바로 구매 버튼은 가격 확정 후 추가) |'],
 ['purchase copy in the check plan','구매 유도 문구(지금 구매하기)는 가격 확정 뒤 넣을 항목으로 확인 계획에 적는다.'],
 ['purchase CTA switched after price','가격 확정 후 CTA를 구매하기로 전환한다.'],
 ['purchase CTA renamed after price','가격이 확정되면 CTA를 ‘구매하기’로 바꾼다.'],
 ['purchase CTA replaced after price','가격 확정 뒤 ‘지금 구매하기’ CTA로 교체한다.'],
 ['purchase copy unused','가격 미확정: 구매하기 문구 미사용'],
 ['purchase CTA after price (cell)','| CTA | 상품 보기 (구매하기는 가격 확정 후) |'],
 ['purchase CTA decided after price','구매하기 CTA 사용 여부: 가격 확정 뒤 결정'],
 // 매체 광고 운영 표현('돌린다', '검토한다')은 협찬 게시물이 아니다.
 ['paid media run (돌린다)','둘째 주부터 유료 광고를 돌린다.'],
 ['paid media considered','유료 광고는 2주차부터 검토한다.'],
 ['paid search budget','유료 광고는 검색 광고 예산 안에서 집행한다.'],
 // 규칙 문장: 보류 절 뒤의 다른 계획, 관형절이 꾸미는 주제어의 끝 부정.
 ['sponsored posts held, organic posts only','협찬 게시물은 광고 표시 기준이 확정될 때까지 보류하고, 자연 유입 게시물만 올린다.'],
 ['fake review method never used','직원 5명이 고객인 척 후기를 작성해 평점을 높이는 방식은 이번 캠페인뿐 아니라 이후 어떤 운영 계획에서도 절대 쓰지 않는다.'],
];

check('lexicon has a version and eight categories',()=>{assert.match(COMPLIANCE_LEXICON.version,/^compliance-lexicon-\d{4}-\d{2}-\d{2}\.\d+$/);assert.deepEqual([...COMPLIANCE_CATEGORIES],['platform_review','endorsement','ai_label','ad_message','food_claim','cosmetic_claim','ecommerce_terms','rights']);for(const c of COMPLIANCE_CATEGORIES)assert.ok(COMPLIANCE_LEXICON.rules.some(r=>r.category===c),c)});
check('every rule cites official source links',()=>{for(const r of COMPLIANCE_LEXICON.rules){assert.ok(r.sources.length>0,r.id);for(const s of r.sources){const src=COMPLIANCE_LEXICON.sources[s];assert.ok(src,s);assert.match(src.url,/^https:\/\/www\.law\.go\.kr\//,s)}}});
check('rules use block, warn or info severities',()=>assert.ok(COMPLIANCE_LEXICON.rules.every(r=>['block','warn','info'].includes(r.severity))));
check('notice states this is not legal advice',()=>{assert.match(COMPLIANCE_NOTICE,/법률 자문이 아닙니다/);assert.equal(checkCompliance('가상 문장').notice,COMPLIANCE_NOTICE)});
check('at least two synthetic violations per category (16+)',()=>{assert.ok(violations.length>=16);for(const c of COMPLIANCE_CATEGORIES)assert.ok(violations.filter(v=>v[0]===c).length>=2,c)});
let detected=0;
for(const [category,text] of violations)check(`detects ${category}: ${text.slice(0,16)}`,()=>{assert.ok(categoriesOf(text).includes(category),JSON.stringify(checkCompliance(text).issues));detected++});
let falsePositives=0;
for(const [name,text,opts] of normals)check(`no false positive: ${name}`,()=>{const issues=checkCompliance(text,opts).issues;falsePositives+=issues.length?1:0;assert.deepEqual([...issues],[])});
check('fake testimonials and missing ad labels are blocking',()=>{assert.ok(checkCompliance(violations[4][1]).issues.some(i=>i.severity==='block'));assert.ok(checkCompliance(violations[10][1]).issues.some(i=>i.ruleId==='ad_label_missing'&&i.severity==='block'))});
check('unconfirmed origin is a warning, not a block',()=>assert.deepEqual([...checkCompliance('국내산 돼지고기로 만든 순대입니다.').issues.map(i=>i.severity)],['warn']));
check('issues carry sources and a short excerpt',()=>{const i=checkCompliance(violations[0][1]).issues[0];assert.ok(i.sources.length&&i.excerpt.length<=60&&i.title)});
check('issues are reported once per rule',()=>{const ids=checkCompliance(violations[0][1]+' '+violations[0][1]).issues.map(i=>i.ruleId);assert.equal(new Set(ids).size,ids.length)});
// 판정은 하향만 한다: 위반이 없어도 올리지 않고, 차단은 사용자 검토 준비를 수정 필요로 내린다.
const rank={ready_for_review:0,revise:1,needs_data:2};
const block=checkCompliance(violations[4][1]).issues,warn=checkCompliance('국내산 돼지고기로 만든 순대입니다.').issues;
check('compliance never upgrades a verdict',()=>{for(const v of Object.keys(rank))for(const issues of [[],warn,block])assert.ok(rank[downgradeVerdict(v,issues)]>=rank[v],v)});
check('blocking issue downgrades ready_for_review to revise',()=>assert.equal(downgradeVerdict('ready_for_review',block),'revise'));
check('warnings alone keep the verdict',()=>assert.equal(downgradeVerdict('ready_for_review',warn),'ready_for_review'));
check('needs_data stays needs_data',()=>assert.equal(downgradeVerdict('needs_data',block),'needs_data'));
check('model quality checks keep the five criteria',()=>assert.deepEqual(Object.keys(qualityCriteria),['evidence','brand','execution','economics','measurement']));
check('quality scope notice still excludes legal review',()=>assert.match(qualityScopeNotice,/법적 검토는 포함하지 않습니다/));
check('input text is not mutated',()=>{const opts={facts:{confirmed:[],prohibited:[]}},before=JSON.stringify(opts);checkCompliance(violations[0][1],opts);assert.equal(JSON.stringify(opts),before)});
check('compliance finishes quickly on 40,000-character inputs',()=>{for(const text of ['가'.repeat(40000),('리뷰 '+'가'.repeat(28)).repeat(1200),'AI'+' 가'.repeat(20000)]){const t=Date.now();checkCompliance(text);assert.ok(Date.now()-t<1000,text.slice(0,6))}});
// 해소 표기는 같은 섹션(초안)에만 적용한다. 한 초안의 (광고)·#광고가 다른 초안의 누락을 덮지 않는다.
const multiDraft='## 문자 초안 A\n(광고) 가상분식 오픈 안내입니다. 수신 동의 고객에게만 보냅니다. 무료 수신거부 080-000-0000\n\n## 문자 초안 B\n알림톡 발송 문안: 오픈 기념 쿠폰 드립니다.';
check('a disclosure in one draft does not clear another draft',()=>{const ids=checkCompliance(multiDraft).issues.map(i=>i.ruleId);for(const id of ['ad_label_missing','consent_missing','optout_missing'])assert.ok(ids.includes(id),id)});
check('a fully disclosed draft alone stays clean',()=>assert.deepEqual([...checkCompliance(multiDraft.split('\n\n')[0]).issues],[]));
const multiPost='## 인플루언서 A\n제품을 제공받아 작성한 후기입니다. #광고\n\n## 블로그 체험단\n제품을 무상 제공하고 후기를 받는다.';
check('a #광고 tag in one post does not clear another post',()=>assert.ok(checkCompliance(multiPost).issues.some(i=>i.ruleId==='sponsorship_undisclosed')));
// 해소 범위는 렌더본의 ## 계약 섹션이다. 그 안의 다른 ### 소제목에 있는 표기 문장('해당 문안에 ‘#광고’를 표시한다')은 해소하지만,
// 초안에 그냥 붙인 표기(#광고, (광고))는 그 소제목 단락만 해소하고 ## 제목·구분선을 넘지 않는다.
const ids=text=>[...checkCompliance(text).issues.map(i=>i.ruleId)];
const statedRule='협찬·체험단·제품 제공·유료 게시를 사용할 경우 해당 문안에 ‘#광고’, ‘#협찬’ 또는 ‘유료 광고 포함’을 표시한다.';
check('a disclosure statement clears another ### post in the same ## section',()=>assert.ok(!ids('## 실행 계획\n### 콘텐츠\n체험단 모집 게시물을 올린다.\n\n### 표시 규칙\n'+statedRule).includes('sponsorship_undisclosed')));
check('a disclosure statement does not cross a ## heading',()=>assert.ok(ids('## 표시 규칙\n'+statedRule+'\n\n## 실행 계획\n### 콘텐츠\n체험단 모집 게시물을 올린다.').includes('sponsorship_undisclosed')));
check('a disclosure statement does not cross a separator',()=>assert.ok(ids('### 표시 규칙\n'+statedRule+'\n\n---\n\n### 콘텐츠\n체험단 모집 게시물을 올린다.').includes('sponsorship_undisclosed')));
check('a bare #광고 in one ### post does not clear another ### post',()=>assert.ok(ids(multiPost.replace(/^## /gm,'### ').replace(/^/,'## 채널 실행\n')).includes('sponsorship_undisclosed')));
check('a (광고) label in one ### message draft does not clear another ### draft',()=>{const got=ids(multiDraft.replace(/^## /gm,'### ').replace(/^/,'## 채널별 카피\n'));for(const id of ['ad_label_missing','optout_missing'])assert.ok(got.includes(id),id)});
// 매체 광고비 집행('유료 광고 집행·예산·CPC')은 협찬 게시물이 아니다. 인플루언서·체험단 문맥의 유료 광고와 협찬·체험단 자체는 그대로 대상이다.
check('paid media spend is not a sponsorship, a paid influencer post is',()=>{assert.ok(!ids('유료 광고 예산은 하루 3만 원, CPC 기준으로 운영한다.').includes('sponsorship_undisclosed'));assert.ok(ids('인플루언서 유료 광고 게시물을 예산 50만 원으로 올린다.').includes('sponsorship_undisclosed'));assert.ok(ids('체험단 게시물 예산은 CPC 기준으로 잡는다.').includes('sponsorship_undisclosed'))});
// 구매 CTA를 가격 확정 뒤로 미루는 계획 문장은 면제하지만, 실제 구매 CTA는 가격·판매 조건 경고가 그대로 남는다.
check('a real purchase CTA still warns price and terms',()=>{for(const text of ['지금 구매하세요!','‘주문하기’ 버튼 문안: 지금 주문하기'])assert.deepEqual(ids(text),['price_missing','terms_missing'],text)});
// 초안 본문의 가격('12,000원과 음료')은 그 소제목 단락만 해소한다. 다른 ### 초안의 가격 없는 구매 CTA는 그대로 경고한다.
check('a price inside one ### draft does not clear another draft',()=>assert.ok(ids('## 판매 카피\n### 카피 A\n떡볶이 세트 12,000원과 음료, 지금 구매하세요. 픽업으로 받으세요.\n\n### 카피 B\n신메뉴 로제 떡볶이, 지금 구매하세요!').includes('price_missing')));
check('a quoted-token disclosure statement still clears another ### post',()=>assert.ok(!ids('## 실행 계획\n### 콘텐츠\n체험단 모집 게시물을 올린다.\n\n### 표시 규칙\n협찬 게시물에는 ‘#광고’를 붙인다.').includes('sponsorship_undisclosed')));
check('compliance stays fast when one sentence repeats held CTAs and stop conditions',()=>{for(const text of ['가격 확정 후 CTA를 구매하기로 전환하며 '.repeat(2000),'광고 표시가 누락될 때 협찬 게시물을 내리고 '.repeat(1500)]){const t=Date.now();checkCompliance(text);assert.ok(Date.now()-t<1000,text.slice(0,12))}});
check('the lexicon version is bumped past the v1 dictionary',()=>assert.ok(COMPLIANCE_LEXICON.version>'compliance-lexicon-2026-09-23.2',COMPLIANCE_LEXICON.version));
check('a draft label carries promotion words from the following paragraph',()=>assert.ok(checkCompliance('문자 초안\n가상분식 첫 주 쿠폰을 드립니다.').issues.some(i=>i.ruleId==='ad_label_missing')));
// 따옴표로 인용한 경쟁점 사례는 info로만 남고 판정을 내리지 않는다.
const cited='경쟁점 사례: "리뷰 작성 시 음료 증정". 이는 정책 위반 소지가 있어 우리는 쓰지 않는다.';
check('a quoted competitor example is info, not block',()=>{const issues=checkCompliance(cited).issues;assert.ok(issues.length>0&&issues.every(i=>i.severity==='info'));assert.equal(downgradeVerdict('ready_for_review',issues),'ready_for_review')});
check('the same wording outside a cited quote stays blocking',()=>assert.ok(checkCompliance('매장 안내: 리뷰 작성 시 음료 증정.').issues.some(i=>i.severity==='block')));
check('detection rate is 100% and false positive rate is 0%',()=>{assert.equal(detected,violations.length);assert.equal(falsePositives,0)});
console.log(JSON.stringify({passed:passed.length,violations:violations.length,detected,normals:normals.length,falsePositives}));
