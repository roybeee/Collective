# 2026-09-27 레인 A: A6 종료 조건 real

결론: 3단계 종료 조건 중 "점포 브랜드에서 자료 요청 1건 이상이 사실 확정으로 닫혔다(real)"를 채웠다. 운영(Sites 버전 40, tree `1ac4369`)에서 모델 호출 없이(토큰 0) 확인했다.

## 절차와 결과
| 단계 | 결과 | 근거 |
|---|---|---|
| 스위치 `a6_data_requests` 켜기(소유자) | passed · real | `POST /api/feature-flags` 200, enabled true |
| 지점 확인 | passed · real | ODA 브랜드 지점은 `ODA PIZZA 이문동점` 1곳. 대표 확인: 이문동점 = 외대점 = 휘경동 337 C동 107호 |
| 자료 요청 만들기(수동, 지점 범위) | passed · real | `POST /api/data-requests` create 200, `dr-f08c16186f08`, 항목 `hours`, open. 지점 연결 캠페인이 없어 수동 생성(절차의 0건 대체 경로) |
| 사실 확정 | passed · real | `POST /api/brand-facts` save_fact 200, confirmed 판 1, 근거 "점주 직접 확인(대표 전달)", 확인일 2026-09-26, 유효기한 2026-12-26. 응답 `closedRequests: 1` |
| 요청 닫힘 | passed · real | 요청 status closed, resolution `fact_confirmed`(사실 판 1, 대표 계정) |

- 확정 값은 대표가 채팅으로 전달한 값이다(2026-09-26). 개발 도구는 대표 확인 없이 사실을 확정하지 않았다.
- 조작: 소유자 세션 Chrome 확장으로 same-origin 요청(대표가 `/permissions`로 navigate·javascript_tool 허용). 유효기한 3개월은 개발 도구가 정한 기본값이다.
- 스위치 `a6_data_requests`는 켜진 상태로 둔다. 다른 A3·A6 스위치(`a3_copy_pack`, `a3_brand_voice`, `a6_place_check`)는 꺼져 있다.
