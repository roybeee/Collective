# 브랜드 자동 학습·온보딩 (에픽 G1)

새 스위치 `brand_autolearn`(기본 꺼짐). 꺼진 상태에서는 기존 동작이 바뀌지 않는다: 홈 시작하기 카드의 버튼은 이유('브랜드 자동 학습 스위치가 꺼져 있습니다.')와 함께 비활성이고, 쓰기 API는 모두 409다. 실행 기록 조회(GET)는 계속된다.

목표: URL 한 줄 → 브랜드 초안(미확인 후보) → 첫 캠페인 템플릿 3개. 확정은 사람이 사실 원장에서 한다(기존 confirm 흐름 그대로). 모델 호출은 없다.

## 1. 흐름

| 단계 | 어디서 | 무엇을 | 저장 |
|---|---|---|---|
| ① 미리보기 | 홈 시작하기 카드 → '브랜드 초안 만들기' | 공개 페이지 1회 GET → 추출 | `brand_learn_run`(status `previewed`) |
| ② 후보 저장 | 같은 카드 → '후보로 저장' | 실행 기록의 후보를 사실 원장에 `candidate`로 | `brand_fact`(status `candidate`), 기록은 `saved` |
| ③ 색 적용(관리자) | 같은 카드 → '#… 색을 브랜드 색으로 적용' | 제안 색 중 하나를 브랜드 `color`로. 새 객체로 바꾸고 출처(`visualProvenance`)를 남긴다 | `brand`, 기록에 `appliedVisual` |
| ④ 템플릿 | 같은 카드 → 신메뉴 출시 / 비수기 프로모션 / 리뷰 이벤트 | 브랜드 이름·업종·지점 수로 브리프 입력을 만들어 **기존 `save_campaign` 경로**로 캠페인 초안 저장 | `campaign`(draft v1), `event` |

확정(`confirmed`)은 브랜드 아카이브 → 확인 사실 탭에서 관리자가 근거·확인 시점·유효 기한을 적고 누른다. 자동 학습은 확정하지 않는다. 로고는 브랜드에 칸이 없어 기록의 제안으로만 남는다.

## 2. 모듈

- `lib/brand-learn.ts` — 순수 추출기. HTML 문자열 → `BrandLearnResult`. 필드마다 `{value, source: og|meta|css|text|link, confidence: strong|weak}`.
  - 이름: `og:site_name`(strong) → `og:title`·`<title>`(weak, ' | 사이트명' 접미 제거).
  - 로고: `og:image`(strong) → `link rel=icon|apple-touch-icon`(weak). 상대 주소는 페이지 주소 기준으로 푼다.
  - 색: `meta theme-color`를 앞에 두고, `<style>`·`style=""` 안의 `#rgb/#rrggbb/rgb()`를 세어 상위 5개(흰·검정 제외).
  - 소개: `meta description`(strong) → `og:description`(weak).
  - 주소·전화·영업시간·가격 줄: 본문(script·style 제거, 블록 태그를 줄바꿈으로)에서 한국 형식 패턴. 전화는 `02-000-0000`형으로 정규화(0507 안심번호 포함).
  - 공식 계정: 알려진 공식 호스트(Instagram·YouTube·네이버 블로그/플레이스/스마트스토어·카카오 채널 등)의 앵커만, 조회 문자열·조각 제거.
  - 말투 신호: 문장 끝 `…요/…죠`(해요체) 대 `…니다/…니까`(합니다체) 비율, 이모지 밀도(100자당), 느낌표 문장 비율. 문장 3개 미만이면 `미확인`. 말투 원장(lib/brand-voice.ts)의 초안 참고용이며 확정 말투가 아니다.
  - 상한: HTML 2MB, 패턴 후보 각 20개, 색 5개, 공식 계정 10개. 같은 입력은 같은 결과.
- `lib/brand-learn-server.ts` — 가져오기·기록·후보 저장·색 적용.
  - 가져오기 안전: http(s)만, 계정 정보 든 주소 거부, `localhost`/`.local`/`.internal`/루프백/10./172.16–31./192.168./169.254./0./멀티캐스트/IPv6 사설(fc·fd·fe8–b·::1·::ffff:) 거부. `redirect:'manual'`로 최대 3번 따라가며 매번 같은 가드. `AbortSignal.timeout(10초)`, 본문 1MB(`lib/http-limits.ts readBoundedText`), HTML만. robots는 읽지 않는 단일 GET.
  - 후보 저장은 `lib/fact-import.ts planImport`로 같은 범위·같은 항목을 건너뛰고, 저장 한도 200개를 지킨다. 출처 문장: `브랜드 자동 학습 · <주소> · <어떻게> · 관측 <날짜> · 미확인 후보`.
  - 색 적용은 관리자(owner·admin)만, 기록이 제안한 색만 받는다. `brandWithVisual`은 입력을 바꾸지 않고 새 객체를 돌려준다.
  - 기록 상한: 브랜드마다 50개.
- `lib/campaign-templates.ts` — 템플릿 3개 → `BriefInput`. 가격·수치·효능·순위를 지어내지 않고 `[확인 필요]`로 자리만 둔다. 보호 항목(baseline·target·operations·owner·learning)·예산·날짜는 비운다. 실험은 '한 변수만', 일정은 1주 준비 → 2~3주 실행 → 4주 회고.
- `lib/brand-learn-sample.ts` + `GET /api/brand-learn/sample` — 테스트 전용 고정물(합성 브랜드 '가상 분식 연구소'). 서버는 **같은 출처**의 이 경로만 네트워크 없이 고정 HTML로 바꿔 읽는다(E2E가 자기 서버를 읽는 길). 사설 주소 가드는 그대로다.
- `components/app/onboarding-url-entry.tsx` — 홈 시작하기 카드의 진입 줄 'URL 한 줄로 브랜드 초안'(가벼운 CardButton). `app/workspace.tsx`는 이 줄만 정적으로 싣고, 무거운 도구는 줄을 누를 때 lazy로 내려받는다. 홈 JS 예산(`homeJsGzKB`)은 networkidle까지 받은 모든 JS를 세므로 홈이 그려질 때 바로 여는 lazy는 예산에 들어간다(1차 측정 195KB > 175KB라 누른 뒤 열기로 바꿨다).
- `components/app/onboarding-url-card.tsx` — 진입 줄을 누르면 열리는 섹션. 입력 'URL 또는 매장명'(매장명만으로는 아직 페이지를 찾지 못한다고 이유를 보인다), 후보 요약(이름·로고 주소·소개·찾은 사실 후보 수·말투 신호·색 칩 5개와 hex), '후보로 저장', 색 적용, 템플릿 3개.

## 3. API `/api/brand-learn`

- `GET ?brandId=` → `{enabled, offReason, runs(최근 10), templates}`. 로그인한 모든 역할.
- `POST {action:'preview', brandId, url}` → `{run}`. 가져오기는 잠금 밖, 기록은 소유자 잠금 안. 스위치 검사가 가져오기보다 먼저다(꺼짐이면 네트워크 호출 없음).
- `POST {action:'save_candidates', runId}` → `{run, imported, skipped[]}`. 멱등(이미 `saved`면 그대로).
- `POST {action:'apply_visual', runId, hex}` → `{brand, run}`. 관리자만(403), 제안에 없는 색 400.
- `POST {action:'create_from_template', brandId, template}` → `{id}`. 템플릿 입력만 만들고 `app/api/action` `save_campaign`에 같은 요청 헤더로 넘긴다(`validateCampaign`·브랜드 검사·이벤트·잠금을 그 경로가 한다).
- 실패: 스위치 꺼짐 409 · 사설 주소/비http/HTML 아님 400 · 1MB 초과 413 · 응답 실패/이동 과다/10초 초과 502 · 분당 60회 초과 429(`execution_rate` 범위 `brand_learn`).

## 4. 기록 종류·설정 기능표

- `lib/record-kinds.ts` `brand_learn_run`(parent brand, 캠페인과 무관). 원문 HTML은 담지 않는다. 캠페인 삭제와 무관해 `lib/deletion-summary.ts`에는 줄을 더하지 않았다.
- `lib/feature-status.ts` 행 `brand-autolearn` '브랜드 자동 학습(URL→후보)'. 꺼짐이면 조건 부족(소유자가 켭니다).

## 5. 검증

- `tests/brand-learn.test.mjs` — mocked. 고정 HTML 3종(한식 매장 사이트·네이버 플레이스형·Instagram형)의 후보·신뢰, 결정성, 2MB 절단, 엔티티·색 정규화, 템플릿 3개(자리표시·수치 없음·광고 표현 없음·보호 항목 비움).
- `tests/brand-learn-server.test.mjs` — mocked(메모리 SQLite, fetch 스텁). 사설 주소 15종 400, 사설로 가는 리다이렉트 차단, HTML 아님 400, 1MB 413, 꺼짐 409(네트워크 0회), 미리보기 → 기록, 후보 저장 → `candidate`만(기존 확정 사실 유지, 멱등), 색 적용(불변·출처·직원 403·제안 외 400), 템플릿 → `save_campaign` 경로의 draft v1과 이벤트, 고정물 경로.
- `e2e/brand-autolearn.spec.ts` — real(로컬 D1·Chromium), 인증 mocked. 모바일·데스크톱: 꺼짐 409 → 스위치 켜기 → 카드에서 고정물 주소 미리보기(이름·색 칩 5개·사실 후보 5건·해요체) → 후보 저장 → 브랜드 아카이브 확인 사실 탭에 '확인 후보'로 보임(확인 사실 아님) → 템플릿 '신메뉴 출시' → 캠페인 목표에 `[확인 필요]`.

## 6. 하지 않는 것

- 매장명 검색(네이버 플레이스 검색 결과 가져오기), 여러 페이지 크롤링, robots 해석, 로그인 페이지, 이미지 내려받기(로고는 주소만).
- 확정, 말투 확정, 브랜드 소개(description) 자동 갱신, 캠페인 실행.
