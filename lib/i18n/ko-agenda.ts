// 서버가 만든 홈 '오늘의 안건' 제목·설명의 한국어 원본(GLOBAL-PLAN G6 3단계, lib/agenda-sources.ts·lib/agenda-workspace-sources.ts·lib/agenda-server.ts의 titleKey·detailKey).
// 화면에 등록하지 않는다: 한국어 화면은 서버가 보낸 title·detail을 그대로 보이고(홈 첫 로딩 사전 ko.ts를 늘리지 않는다), 영어·일본어는 en-agenda.ts·ja-agenda.ts를 en.ts·ja.ts가 묶어 읽는다.
// 값은 서버 문장과 같아야 한다(tests/i18n-coverage.test.mjs가 출처 함수 결과와 대조한다).
export const koAgenda={
 // 결정 인박스 출처(lib/agenda-sources.ts)
 'agenda.t.artifact':'{role} 작업물 검토 대기','agenda.t.artifactAny':'작업물 작업물 검토 대기','agenda.t.publicationApproved':'승인한 발행 접수 대기','agenda.t.publication':'발행 승인 대기','agenda.t.meeting':'회의 진행 확인 대기','agenda.t.meetingQuestion':'회의에서 확인할 사실','agenda.t.sequence':'연속 실행 검수 확인 대기','agenda.t.dataRequest':'자료 요청 열림','agenda.t.briefQuestions':'브리프 확인 질문 {n}개',
 'agenda.d.meetingSteps':'확인할 단계 {n}개','agenda.d.fixes':'수정 요청 {n}건',
 // 워크스페이스·브랜드·지점 범위 출처(lib/agenda-workspace-sources.ts)
 'agenda.t.billing100':'크레딧 모두 사용','agenda.t.billing80':'크레딧 80% 사용','agenda.t.reconsent':'카카오 수신 재동의 확인','agenda.t.geoFailed':'AI 검색 노출 측정 실패','agenda.t.geoPartial':'AI 검색 노출 측정 일부 실패','agenda.t.geoDone':'AI 검색 노출 측정 완료','agenda.t.placeNews':'플레이스 소식 승인 대기','agenda.t.placeReply':'플레이스 리뷰 답글 승인 대기','agenda.t.adsDaangn':'당근 광고 제안 승인 대기','agenda.t.adsNaver':'네이버 검색광고 제안 승인 대기',
 'agenda.d.geo':'완료 {done}/{total}건','agenda.d.geoFailed':'완료 {done}/{total}건, 실패 {failed}건',
 // 성장 기록 출처(lib/agenda-server.ts)
 'agenda.t.csOverdue':'고객 문의 약속 기한 초과','agenda.t.csSoon':'고객 문의 약속 기한 임박','agenda.t.signal':'새 감지 신호','agenda.t.expansion':'확대 제안 승인 대기','agenda.t.landing':'상세페이지 수정안 승인 대기','agenda.t.landingApproved':'승인한 상세페이지 적용 확인 대기','agenda.t.collaboration':'협업 콘텐츠 승인 대기','agenda.t.missionOverdue':'판매 미션 기한 지남','agenda.t.missionSoon':'판매 미션 기한 3일 이내',
} as const;
