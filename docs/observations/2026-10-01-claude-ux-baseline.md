# 2026-10-01 UX 2차 계측 기준선 (Claude 세션)

- 대상: 로컬 빌드 = 운영 Sites 82(main `aea167d`, tree `035d3b1`). real local D1/Chromium, 인증 mocked, 합성 데이터(지점·캠페인·상품·오퍼·미션 각 1). 외부 호출 0.
- 도구: `scripts/ux-audit.mjs`(axe-core 4.11, WCAG 2.0/2.1/2.2 A·AA + best-practice). 수치 해석과 계획은 [UX 계획](../UX-PLAN.ko.md).
- 대비 실패는 자체 계측(텍스트 노드 4.5:1, 큰 글자 3:1)이고 axe의 color-contrast와 기준이 조금 다르다. 터치 타깃은 44px 미만 상호작용 요소 수/전체.

## 화면별 수치

| 뷰포트 | 화면 | axe 노드(critical/serious/moderate/minor) | 대비 실패 | 44px 미만 타깃 | 글자 수 | 접힘 패널 | 높이(px) |
|---|---|---|---|---|---|---|---|
| desktop | 01-overview | 60 (0/56/3/1) | 64/132 | 25/42 | 1304 | 0 | 1737 |
| desktop | 02-campaigns | 28 (0/24/3/1) | 27/59 | 24/25 | 566 | 0 | 800 |
| desktop | 03-brand-archive | 65 (0/61/4/0) | 65/160 | 40/41 | 1795 | 4 | 2635 |
| desktop | 04-stores | 17 (0/14/3/0) | 18/104 | 34/35 | 1230 | 0 | 2041 |
| desktop | 05-learning | 17 (0/14/3/0) | 17/55 | 19/24 | 745 | 0 | 1103 |
| desktop | 06-agents | 47 (0/44/3/0) | 46/90 | 16/25 | 876 | 0 | 1107 |
| desktop | 07-settings | 100 (2/95/3/0) | 98/185 | 68/69 | 4586 | 2 | 5757 |
| desktop | 10-campaign-brief | 44 (0/44/0/0) | 58/116 | 29/39 | 1329 | 0 | 1358 |
| desktop | 11-growth-top | 38 (0/37/1/0) | 40/644 | 261/383 | 2256 | 43 | 3366 |
| desktop | 12-growth-scroll1 | 25 (0/24/1/0) | 40/798 | 306/482 | 2350 | 45 | 3571 |
| desktop | 13-growth-scroll2 | 25 (0/24/1/0) | 40/798 | 306/482 | 2350 | 45 | 3571 |
| desktop | 14-growth-cs-open | 25 (0/24/1/0) | 40/798 | 306/482 | 2679 | 45 | 4215 |
| desktop | 15-growth-experiment-open | 25 (0/24/1/0) | 40/798 | 306/482 | 2887 | 45 | 4457 |
| desktop | 20-meta | 55 (0/54/1/0) | 63/156 | 54/72 | 1541 | 0 | 1571 |
| desktop | 21-execution | 42 (0/42/0/0) | 47/138 | 52/62 | 2338 | 4 | 2391 |
| desktop | 22-results | 44 (0/44/0/0) | 48/91 | 32/42 | 1251 | 0 | 1094 |
| desktop | 23-meeting | 44 (0/44/0/0) | 48/93 | 31/42 | 1219 | 0 | 1083 |
| desktop | 24-team | 47 (0/47/0/0) | 68/133 | 40/51 | 1573 | 0 | 1673 |
| mobile | 01-overview | 38 (0/37/0/1) | 44/87 | 11/25 | 845 | 0 | 2136 |
| mobile | 02-campaigns | 16 (0/15/0/1) | 20/31 | 10/11 | 363 | 0 | 844 |
| mobile | 03-brand-archive | 57 (0/56/1/0) | 58/132 | 27/27 | 1592 | 4 | 3915 |
| mobile | 04-stores | 9 (0/9/0/0) | 11/76 | 21/21 | 1027 | 0 | 3219 |
| mobile | 05-learning | 9 (0/9/0/0) | 10/27 | 6/10 | 542 | 0 | 1366 |
| mobile | 06-agents | 39 (0/39/0/0) | 40/62 | 3/11 | 673 | 0 | 1691 |
| mobile | 07-settings | 92 (2/90/0/0) | 91/157 | 55/55 | 4383 | 2 | 7328 |
| mobile | 10-campaign-brief | 31 (0/31/0/0) | 51/88 | 18/25 | 1126 | 0 | 1700 |
| mobile | 11-growth-top | 25 (0/24/1/0) | 33/642 | 260/388 | 2053 | 43 | 4278 |
| mobile | 12-growth-scroll1 | 16 (0/15/1/0) | 33/770 | 299/468 | 2147 | 45 | 4565 |
| mobile | 13-growth-scroll2 | 16 (0/15/1/0) | 33/770 | 299/468 | 2147 | 45 | 4565 |
| mobile | 14-growth-cs-open | 16 (0/15/1/0) | 33/770 | 299/468 | 2476 | 45 | 5560 |
| mobile | 15-growth-experiment-open | 16 (0/15/1/0) | 33/770 | 299/468 | 2684 | 45 | 5874 |
| mobile | 20-meta | 41 (0/40/1/0) | 56/128 | 41/58 | 1338 | 0 | 2479 |
| mobile | 21-execution | 30 (0/30/0/0) | 40/110 | 39/48 | 2135 | 4 | 3171 |
| mobile | 22-results | 29 (0/29/0/0) | 41/63 | 21/28 | 1048 | 0 | 1359 |
| mobile | 23-meeting | 30 (0/30/0/0) | 41/65 | 20/28 | 1016 | 0 | 1376 |
| mobile | 24-team | 34 (0/34/0/0) | 53/97 | 29/37 | 1346 | 0 | 1870 |

## 첫 로드

- desktop: JS 2077KB · CSS 252KB · 파일 11개 · 로컬 DCL 126ms(네트워크 미반영)
- mobile: JS 2077KB · CSS 252KB · 파일 11개 · 로컬 DCL 109ms(네트워크 미반영)
- gzip: `workspace-*.js` 1,452KB → 388KB, `index-*.js` 245KB → 60KB, `framework-*.js` 190KB → 59KB, `index.css` 232KB → 38KB.

## 성장·판매 탭 열기 요청

- 서버 로그(`e2e/artifacts/server-default.log`) 기준 `/api/growth` 뒤 4초 안 distinct GET 30 + 직전 `/api/growth/stop` 1 = **31건**. 탭을 다시 열 때마다 반복(`cache:'no-store'`, 비활성 탭 언마운트).

## axe 규칙별 합계(46캡처)

| 규칙 | 영향 | 노드 |
|---|---|---|
| color-contrast | serious | 1249 |
| region | moderate | 21 |
| landmark-complementary-is-top-level | moderate | 14 |
| empty-table-header | minor | 4 |
| aria-valid-attr-value | critical | 4 |
