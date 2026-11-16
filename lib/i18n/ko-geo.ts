// 열 때 내려받는 화면 구역 'geo'의 한국어 원본: AI 검색 노출 관측 프로토콜 v2 화면(app/geo-protocol-v2.tsx, 스위치 geo_protocol_v2).
// 이 구역을 쓰는 화면은 lib/i18n/lazy-geo.ts를 가져와 등록한다(그 화면 청크에만 실린다). 영어·일본어는 en-geo.ts·ja-geo.ts(키가 같아야 한다, tests/i18n-coverage.test.mjs).
export const koGeo={
 'geo.v2.title':'관측 프로토콜 v2','geo.v2.lead':'같은 질문을 같은 엔진에 여러 번, 여러 날 물어 본 기록으로만 판정합니다. 숫자는 관찰 기록이며 노출 보장이 아닙니다.',
 'geo.v2.rule':'판정 기준(운영 기준): 장악 {dominant} 이상 · 경합 {contested} 이상 · 열세 0 초과 · 부재 0회 · 미관측은 측정 없음. 서로 {gap}일 이상 떨어진 두 시점이 없으면 판정 보류입니다. 최근 {window}일 판정이 그 앞 {window}일보다 내려가면 방어 실패입니다.',
 'geo.v2.repeats':'질문×엔진마다 {n}회 반복 측정합니다. 위 예상 토큰에 반복이 들어 있습니다.',
 'geo.v2.verdicts':'묶음×엔진 판정','geo.v2.noVerdicts':'판정할 관찰이 아직 없습니다.','geo.v2.points':'{n}개 시점 · {days}일 간격','geo.v2.none':'없음',
 'geo.col.group':'묶음','geo.col.engine':'엔진','geo.col.count':'관측','geo.col.points':'시점','geo.col.verdict':'판정','geo.col.previous':'이전 판정',
 'geo.group.category':'카테고리 추천(지역 포함)','geo.group.comparison':'비교','geo.group.brand':'브랜드 직접',
 'geo.verdict.dominant':'장악','geo.verdict.contested':'경합','geo.verdict.behind':'열세','geo.verdict.absent':'부재','geo.verdict.defense_failed':'방어 실패','geo.verdict.unobserved':'미관측','geo.verdict.pending':'판정 보류',
 'geo.v2.citations':'인용 출처(v2 관찰)','geo.source.official':'공식','geo.source.platform':'편집 플랫폼','geo.source.third_party':'제3자','geo.source.unclassified':'미분류',
 'geo.v2.contexts':'답변 맥락(v2 관찰)','geo.tone.positive':'긍정','geo.tone.neutral':'중립','geo.tone.negative':'부정',
 'geo.change.title':'변경 기록과 재관측','geo.change.lead':'변경을 기록하면 반영일부터 +14일·+42일에 같은 조건으로 다시 측정하도록 예약합니다. 조사 실행이 자동일 때만 저절로 돌고, 아니면 예정일이 지난 뒤 여기에 표시됩니다.',
 'geo.change.kind':'변경 종류','geo.change.summary':'변경 요약','geo.change.appliedOn':'반영일(게시·색인 확인일)','geo.change.basis':'반영 근거','geo.change.save':'변경 기록','geo.change.saved':'변경을 기록하고 재관측을 예약했습니다.','geo.change.needSummary':'변경 요약을 먼저 쓰세요.','geo.change.needDay':'반영일을 고르세요.','geo.change.empty':'기록한 변경이 없습니다.',
 'geo.change.recheck':'+{offset}일 {day} {status}','geo.change.due':'재관측 예정일이 지났습니다: {items}. 지금 측정으로 직접 실행할 수 있습니다.','geo.change.dueItem':'+{offset}일({day})',
 'geo.recheck.scheduled':'예약','geo.recheck.started':'측정 시작','geo.recheck.skipped':'건너뜀(캠페인 보관·삭제)',
 'geo.kind.entity_basics':'처방 0 묶음(공식 정보 페이지·지도 등록 정보·표기 통일)','geo.kind.faq':'자주 묻는 질문 추가·수정','geo.kind.page':'공식 페이지 본문 수정','geo.kind.listing':'플랫폼 등록 정보 수정','geo.kind.other':'기타',
 'geo.basis.published':'게시 확인','geo.basis.indexed':'색인 확인',
} as const;
