// 테스트 전용 고정물(test fixture). 브랜드 자동 학습 E2E(e2e/brand-autolearn.spec.ts)가 외부 네트워크 없이 같은 서버의 GET /api/brand-learn/sample을 읽게 한다.
// 서버 가져오기는 사설 주소(127.0.0.1 포함)를 막으므로(lib/brand-learn-server.ts), 같은 출처(origin)의 이 경로만 네트워크 없이 이 문자열로 바꿔 쓴다.
// 내용은 합성 브랜드('가상 분식 연구소')다. 실제 매장·실제 번호가 아니다. 운영 데이터와 무관하고 저장되지 않는다.
export const BRAND_LEARN_SAMPLE_PATH='/api/brand-learn/sample';
export const BRAND_LEARN_SAMPLE_HTML=`<!doctype html>
<html lang="ko"><head><meta charset="utf-8">
<title>가상 분식 연구소 | 매일 만드는 떡볶이</title>
<meta property="og:site_name" content="가상 분식 연구소">
<meta property="og:title" content="가상 분식 연구소 - 매일 만드는 떡볶이">
<meta property="og:description" content="합성 테스트 브랜드의 소개입니다. 실제 매장이 아닙니다.">
<meta name="description" content="매일 아침 반죽하는 가래떡과 직접 끓인 멸치 육수로 만드는 분식(테스트 고정물)">
<meta property="og:image" content="/images/sample-logo.png">
<meta name="theme-color" content="#c2410c">
<link rel="icon" href="/favicon.ico">
<style>
.hero{background:#c2410c;color:#fff7ed}.btn{background:#c2410c;border:1px solid #9a3412}.accent{color:#f59e0b}.muted{color:#78716c}.ok{color:#15803d}.bg{background:#fff}
</style></head>
<body>
<header class="hero"><h1>가상 분식 연구소</h1><p>오늘도 따끈하게 준비했어요!</p></header>
<section>
<h2>메뉴</h2>
<ul><li>연구소 떡볶이 4,500원</li><li>모둠 튀김 3,000원</li><li>순대 한 접시 4,000원</li></ul>
<p>국물은 매일 아침 새로 끓여요. 포장도 가능해요 🍢</p>
</section>
<section>
<h2>매장 안내</h2>
<p>주소: 서울특별시 가상구 가상로 123, 1층</p>
<p>전화: 02-000-0000</p>
<p>영업시간: 매일 11:00~21:00 (월요일 휴무)</p>
</section>
<footer><a href="https://www.instagram.com/example_bunsik_lab/?utm_source=site">인스타그램</a><a href="https://blog.naver.com/example_bunsik_lab">블로그</a><a href="/privacy">개인정보</a></footer>
</body></html>`;
