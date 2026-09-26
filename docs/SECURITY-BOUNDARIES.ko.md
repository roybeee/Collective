# 보안 경계와 검증 범위

운영은 `AUTH_MODE=email`이고 Sites 접근은 public이다(2026-09-23 전환, [게시 기록](releases/2026-09-23-1ecd72e.md)). 앱은 자체 세션 쿠키로 사용자를 확인하고 그 계정의 `workspace_owner`를 소유자로 쓰며, `oai-authenticated-user-id` 헤더는 인증에 쓰지 않는다. 이 헤더를 신뢰하는 legacy 모드는 로컬 개발·E2E용이다. 운영에서는 Sites 접근을 owner-only로 되돌린 뒤의 복구 절차([EMAIL-AUTH.ko.md 복구](EMAIL-AUTH.ko.md))에서만 쓰며, Sites public 상태에서는 절대 쓰지 않는다. PR 1(`auth-2`)부터 운영 빌드는 `AUTH_MODE`가 비어 있을 때 legacy로 열리지 않는다(fail-closed, `lib/auth-session.ts` `authMode`). legacy를 쓰려면 `AUTH_MODE=legacy`를 명시해야 한다. 환경 revision 변경·복구·재게시 뒤에는 `/api/auth`가 mode=email을 반환하는지, 위조 헤더 요청이 401인지 먼저 확인한다. 역할별 권한은 아래 표를 따르고, 설치 파일 허용 목록은 PR 1부터 개인 사용자 단위로 판정한다. 입력 길이 검사나 로컬 모의 인증 테스트는 운영 인증 경계를 증명하지 않는다.

## 역할별 권한 (이메일 모드)

마지막 갱신: 2026-09-27 KST (B4-2b: `/api/reward-lineage` 보상 계보 보기 행. A8-2: `/api/customer-reports` 고객 보고서 미리보기·목록·다운로드·사실 팩·동결·검토 행. 트랙 R R15a-2a: 모집 자료·행사 행. A6-2: `/api/place-checks` 플레이스 대조 보기·스냅샷 입력·할 일 처리 행. A6-1: `/api/data-requests` 자료 요청 보기·모으기·닫기 행. 트랙 R R3a: 캠페인 가맹 모집 목적 지정·해제 행, 발행 승인 행의 판정 범위. 트랙 R R2: 발행 승인 행에 가맹 모집 규칙 해제 불가 409, 직원도 보는 정보공개서 버전 요약 행. 트랙 R R1b: 가맹 사실 저장 조건과 `rebase_facts` 행. 이전: 트랙 R R1a·R4b: `/api/franchise` 가맹 설정·리드 원장·연락처 열람·정보주체 요청 행 추가, 대표 결정 22. 검토 반영: 설정 정정·다시 사용 행, 출처 고지 `record_source_notice` 행. 이전: F4a 캠페인 삭제 영향 조회 행·결정 7 규칙 보존, F5 채널 연결 브랜드·지점 단위, PR 6c 아카이브 원본 파일 삭제 행)

같은 워크스페이스의 계정은 대표(owner)·관리자(admin)·직원(member) 중 하나다. 대표는 DB에 따로 저장하지 않고 같은 워크스페이스에서 가장 먼저 만든 관리자 계정으로 계산한다(`lib/auth-session.ts` `roleSql`). 판정은 서버 API가 하며, 화면에서 버튼을 숨기는 것은 보조 수단이다. 직원이 관리자 전용 작업을 요청하면 403이다. legacy 모드(로컬 개발·E2E)의 헤더 사용자는 모든 권한을 가진다.

| 작업 | API | 대표 | 관리자 | 직원 |
|---|---|---|---|---|
| 캠페인 작성·브리프 수정 | `/api/action` `save_campaign` | 허용 | 허용 | 허용 |
| 캠페인 가맹 모집 목적(objective) 지정·해제(값 `franchise_recruitment`만, 그 밖 값 400. 지점과 함께·지점 캠페인·브랜드 변경·해제와 지점 연결을 한 요청에 400, 제작·발행 기록이 있으면 지정 409, 목적이 바뀐 저장에 그 전 목적의 캠페인 초안 409. `r_franchise` 꺼짐이면 지정 409, 해제는 스위치와 무관. 브리프 초안은 저장값만 이어받는다) | `/api/action` `save_campaign` (`data.objective`) | 허용(캠페인 이벤트 `objectiveChange`) | 허용(캠페인 이벤트) | 403(값을 바꾸지 않는 저장은 허용) |
| AI 실행·브리프 초안 | `/api/run`, `/api/brief`, `/api/meetings` | 허용 | 허용 | 허용 |
| 작업물 등록·수정 | `/api/action` `save_artifact` | 허용 | 허용 | 허용 |
| 작업물 수정 요청 | `/api/action` `review_artifact` (`revision`) | 허용 | 허용 | 허용 |
| 작업물 최종 승인 | `/api/action` `review_artifact` (`approved`) | 허용 | 허용 | 403 |
| 성과 기록 | `/api/action` `save_metric` | 허용 | 허용 | 허용 |
| 캠페인 삭제 | `/api/action` `delete_campaign` | 허용 | 허용 | 403 |
| 캠페인 삭제 영향 조회(kind별 삭제·보존 건수) | `/api/campaigns/[id]/deletion` GET | 허용 | 허용 | 403 |
| 브랜드 지식 수정 | `/api/action` `save_brand` | 허용 | 허용 | 403 |
| 브랜드 사실 후보 제안·후보 수정(가맹 항목은 `r_franchise` 꺼짐 409, 정보공개서 근거를 주면 같은 브랜드 현재 버전만) | `/api/brand-facts` `save_fact` (`candidate`) | 허용 | 허용 | 허용 |
| 브랜드 사실 확정·거절, 확정·거절된 사실 수정(가맹 항목 확정은 정보공개서 근거 필수·`r_franchise` 꺼짐 409, 사용 거절은 스위치와 무관) | `/api/brand-facts` `save_fact` | 허용 | 허용 | 403 |
| 가맹 사실을 새 정보공개서 버전으로 옮기기 | `/api/brand-facts` `rebase_facts` | 허용 | 허용 | 403 |
| 가맹 브랜드의 정보공개서 버전 요약 보기(버전 id·라벨·등록일·상태, 현재 버전, 사업연도 종료일, 기능 스위치 상태, 분기) | `/api/brand-facts` GET `franchise`, `/api/execution` GET `franchise` | 포함 | 포함 | 포함(후보 사실의 근거 입력과 발행 화면 차단 사유용. 파일 해시·보관 위치·감사 기록은 없고, 가맹 설정 GET `settings`는 403) |
| 브랜드 말투 보기(현재 판·상태·모델에 가는 확정본, 작성·확정한 사람은 id·역할만) | `/api/brand-voice` GET | 허용 | 허용 | 허용 |
| 브랜드 말투 초안 저장·확정·철회(A3-2. 오래된 `version`은 409. 확정본만 스위치 `a3_brand_voice`가 켜진 크리에이티브·콘텐츠 입력에 실리고, 전화·이메일 등은 브랜드 정체성과 같은 방식으로 가린다) | `/api/brand-voice` `save_draft`·`confirm`·`revoke` | 허용 | 허용 | 403 |
| 운영 소스 트리 확인(`build`·`tree`만. 소유자 정보·`promptManifest`는 없음, 저장소가 공개라 새로 드러나는 것은 운영 트리뿐) | `/api/version/public` GET | 로그인 없이 허용 | 로그인 없이 허용 | 로그인 없이 허용 |
| 자료 요청 보기(캠페인·브랜드 범위, 만든·닫은 사람은 id·역할만) | `/api/data-requests` GET | 허용 | 허용 | 허용 |
| 자료 요청 모으기·만들기(A6-1. 작업물의 자료 필요 표지를 결정론으로 모음, 모델 호출 없음. `a6_data_requests` 꺼짐 409, 같은 항목이 열려 있으면 409) | `/api/data-requests` `collect`·`create` | 허용 | 허용 | 허용 |
| 자료 요청 수동 닫기·필요 없음·확정 사실과 다시 대조(오래된 `version`·이미 닫힘 409, `a6_data_requests` 꺼짐 409. 사실 확정 때의 자동 닫기는 `save_fact` 권한을 따른다) | `/api/data-requests` `close`·`dismiss`·`reconcile` | 허용 | 허용 | 403 |
| 플레이스 대조 보기(지점 스냅샷·대조 결과·플레이스 할 일, 입력한 사람은 id·역할만) | `/api/place-checks` GET `?storeId=` | 허용 | 허용 | 허용 |
| 플레이스 스냅샷 입력(A6-2. 관리자가 옮겨 적은 값을 확정 사실과 결정론으로 대조, URL은 `place.naver.com`·`map.naver.com` https만 받고 열지 않음. `a6_place_check` 꺼짐 409, 보관 지점 409, 미래 확인일·다른 호스트·모르는 항목 400, 오래된 `version` 409) | `/api/place-checks` `save_snapshot` | 허용 | 허용 | 403 |
| 플레이스 할 일 처리(기존 점포 할 일 `save_task`와 같은 권한. 완료는 근거 필수, 보고서 할 일 400, 오래된 `version` 409, `a6_place_check` 꺼짐 409. 사실 저장 뒤 자동 완료는 `save_fact` 권한을 따른다) | `/api/place-checks` `save_task` | 허용 | 허용 | 허용 |
| 고객 보고서 미리보기(A8-2. 요청할 때 계산하고 저장하지 않음, 진행 중 주 가능·미래 주 400, 모델 호출 없음. `a8_customer_report` 꺼짐 409, 다른 워크스페이스의 지점·브랜드 404) | `/api/customer-reports` GET `?storeId=&week=`·`?brandId=&week=` | 허용 | 허용 | 403 |
| 고객 보고서 동결본 목록(stale 포함, 동결·검토한 사람은 id·역할만, 최대 26주)·다운로드(JSON·Markdown·CSV 첨부, `no-store`·`nosniff`). 스위치가 꺼져도 읽는다. 외부 공유 링크 없음(D1) | `/api/customer-reports` GET `?brandId=&from=&to=`·`?id=&format=` | 허용 | 허용 | 403 |
| 사실 팩 받기(확정 사실만, 가맹 항목 제외, 확정한 사람 없음. `a8_customer_report` 꺼짐 409) | `/api/customer-reports` GET `?type=fact_pack` | 허용 | 허용 | 403 |
| 고객 보고서 동결(끝난 주만, 진행 중·미래 주 400, `confirmed:true`와 확인 값 필수·불일치 409, 200KB 초과 413, 다시 동결하면 판+1. `a8_customer_report` 꺼짐 409, 소유자 잠금·빈도 제한) | `/api/customer-reports` `freeze` | 허용 | 허용 | 403 |
| 고객 보고서 검토(지금 판에만, 옛 판·모르는 판 409. `a8_customer_report` 꺼짐 409) | `/api/customer-reports` `review` | 허용 | 403 | 403 |
| 보상 계보 보기(B4-2b. 요청할 때 계산하고 저장하지 않음, 모델·커넥터 호출 없음. 기간 기본 28일·최대 180일, 종류별 5,000행 상한을 넘으면 `partial.kinds`. `b4_reward_lineage` 꺼짐 409, 다른 워크스페이스·서로 맞지 않는 브랜드·지점·캠페인 404. 판정자·주문번호·메모·캡션·규칙 본문 없음) | `/api/reward-lineage` GET `?from=&to=&brandId=&storeId=&campaignId=` | 허용 | 허용 | 403 |
| 아카이브 자료 추가·후보로 되돌리기 | `/api/archive` `add_source`, `review_source`·`review_sources` (모든 항목이 `candidate`) | 허용 | 허용 | 허용 |
| 아카이브 자료 확정·사용 제외(일괄 포함), 진단 채택, 의뢰 정보 수정 | `/api/archive` `review_source`·`review_sources` (`confirmed`·`excluded`가 하나라도 있으면), `confirm_diagnosis`, `save_intake` | 허용 | 허용 | 403 |
| 아카이브 원본 파일 삭제(레코드는 남김, 되돌릴 수 없음) | `/api/archive` `delete_source_file` | 허용 | 허용 | 403 |
| 캠페인 상시 지시 추가 | `/api/directives` `add` | 허용 | 허용 | 허용 |
| 캠페인 상시 지시 삭제 | `/api/directives` `remove` | 허용 | 허용 | 본인 역할(직원)이 남긴 지시만. 관리자·대표가 남긴 지시는 403 |
| HERMES·OpenAI 연결 저장·해제 | `/api/action` `save_hermes`·`save_connection`·`disconnect` | 허용 | 허용 | 403 |
| HERMES 연결 주소 조회 | `/api/workspace` `connection.endpoint` | 포함 | 포함 | 응답에서 제외 |
| 채널 연결 변경(워크스페이스 기본·브랜드·지점 단위) | `/api/channels` POST `save_credential`·`revoke_credential` (`brandId`·`storeId` 선택) | 허용 | 허용 | 403 |
| 사용량 단가 변경 | `/api/usage` POST | 허용 | 허용 | 403 |
| 발행 설정·승인·실행·취소(가맹 모집 목적(objective) 캠페인은 가맹 프로필과 무관하게 모집 범위, 그 밖 가맹 프로필 브랜드 캠페인은 소비자 범위로 가맹 모집 규칙 판정. 해제 불가 표현은 대표·관리자 승인으로도 409, 결정 25. 판정은 기능 스위치를 읽지 않는다) | `/api/execution` `connect_buffer`·`save_limits`·`approve`·`execute`·`cancel` | 허용 | 허용 | 403 |
| 가맹 설정(프로필·정보공개서 버전·계약서안 템플릿·개인정보 안내문 등록·사용 중지·다시 사용, 버전 등록일·유효 기간과 템플릿 확인 항목 정정), 설정·감사 기록 조회 | `/api/franchise` `save_profile`·`register_*`·`retire_*`·`amend_disclosure_version`·`amend_contract_template`, GET `settings`·`audit` | 허용(정정은 사유·감사) | 허용(정정은 사유·감사) | 403 |
| 가맹 리드 등록·문의 조건 수정·연락처 수정(메모 덧붙이기 포함)·출처 고지 기록·일반 단계 이동·일반 단계에서 종결 | `/api/franchise` `create_lead`·`update_task`·`update_contact`·`record_source_notice`·`move_stage` | 허용 | 허용 | 본인 담당만(등록하면 본인 담당). 담당 없는 리드는 먼저 가져온다. 기능 스위치가 꺼지면 409(대표·관리자는 연락처 수정·출처 고지·종결을 계속한다) |
| 증빙·계약 단계에서 종결, 다시 열기, 개점 | `/api/franchise` `move_stage`(`closed`·`opened`)·`reopen_lead` | 허용 | 허용 | 403 |
| 가맹 리드 담당 가져오기 / 재배정 | `/api/franchise` `claim_lead` / `assign_lead` | 허용 / 허용 | 허용 / 허용 | 허용(담당 없는 리드만) / 403 |
| 가맹 리드 연락처 원문 보기 | `/api/franchise` `reveal_contact` | 허용(감사) | 허용(감사) | 본인 담당만(감사). 담당 없는 리드·다른 직원 리드는 403 |
| 연락처로 가맹 리드 찾기 | `/api/franchise` `find_contact` | 허용(감사) | 허용(감사) | 허용(감사, 보이는 리드만 id) |
| 가맹 리드 내보내기(CSV) | `/api/franchise` `export_leads` | 허용(감사) | 허용(감사) | 403 |
| 제공·자문·산정서·계약·가맹금·약정 증빙 기록, 기록 시각보다 이른 증빙 시각 | `/api/franchise` `record_*` | 허용(사유·감사) | 허용(사유·감사) | 403 |
| 다른 리드에 잘못 적은 증빙 무효화 | `/api/franchise` `void_evidence` | 허용(사유·감사) | 허용(사유·감사) | 403 |
| 연락처 파기 실행·정보주체 삭제 실행(그 리드의 접수된 삭제 요청을 완료로 기록)·정보주체 요청 처리(연결 리드 없는 요청의 리드 연결 1회 포함) | `/api/franchise` `purge`·`erase_lead`·`update_subject_request` | 허용 | 허용 | 403 |
| 정보주체 요청 등록·광고성 정보 수신 철회 | `/api/franchise` `add_subject_request`·`set_marketing_consent`(`withdrawn`) | 허용 | 허용 | 허용(보이는 리드) |
| 광고성 정보 수신 동의 기록 | `/api/franchise` `set_marketing_consent`(`given`) | 허용 | 허용 | 403 |
| 모집 자료 초안 저장(새 판), 자료·행사 보기 | `/api/franchise` `asset_save`, GET `assets`·`asset`·`events` | 허용 | 허용 | 허용. 기능 스위치가 꺼지면 저장은 409 |
| 모집 자료 승인·내보내기(복사·내려받기)·게시 위치 기록 / 폐기 | `/api/franchise` `asset_approve`·`asset_export`·`asset_place` / `asset_retire` | 허용(감사) | 허용(감사) | 403. 해제 불가 표현·승인 없음·재검토 필요·분기 A 아님은 대표·관리자도 409(결정 25). 승인·내보내기는 최신 판만. 폐기는 스위치가 꺼져도 된다 |
| 설명회·견학·박람회 등록·변경 / 취소 | `/api/franchise` `event_save` / `event_cancel` | 허용(감사) | 허용(감사) | 403. 등록·변경은 분기 A만. 취소는 스위치가 꺼져도 된다 |
| 행사 신청·참석 기록(가명 코드와 건수만) | `/api/franchise` `event_register`·`event_attendance` | 허용 | 허용 | 허용. 이름·연락처 칸 없음. 스위치 꺼짐 409 |
| 가맹 모집 기능 스위치 `r_franchise` | `/api/feature-flags` | 허용 | 403 | 403 |
| 서버 설치 파일 발급 | `/api/research-worker/setup` `download` | 아래 목록 판정 | 아래 목록 판정 | 403 |
| 서버 작업자 연결 해제 | `/api/research-worker/setup` `revoke` | 허용 | 허용 | 403 |

가맹 행(트랙 R, 대표 결정 22)은 `lib/franchise.ts`의 역할 판정(`canSeeLead`·`canReveal`·`canClose` 등)을 서버와 화면이 함께 쓴다. 직원은 본인 담당과 담당 없는 리드만 보고, 목록의 연락처는 언제나 가린 값이다. 원문 보기·찾기·내보내기는 값 없이 행위자 id·역할·리드 id·필드 이름·목적을 감사 기록(kind `franchise_audit`)에 남긴다. 직원 403은 mocked 테스트(`tests/franchise-pipeline.test.mjs`, `tests/franchise-contacts.test.mjs`)로 확인했고, 운영 real 확인은 직원 계정을 만든 뒤다. 기능 스위치가 꺼져도 조회·연락처 보기·내보내기·찾기·파기·정보주체 요청·광고성 정보 철회는 되고, 대표·관리자는 정보주체 요청 처리(정정·출처 고지·종결)도 한다. 게이트 결과와 기한은 COLLECTIVE 휴리스틱이며 법률 자문이 아니다(결정 20 보류). 모집 자료·행사 행(R15a-2a)의 감사 기록은 원문·게시 위치 라벨·장소 라벨·가명 코드 없이 id·판·해시·사유 코드만 남기고, 쓰기는 가맹 잠금과 조건부 쓰기(판·순번 대조, 어긋나면 409)로 막는다. 직원 403·스위치 409는 경로 테스트로 확인했다(mocked).

계정 초대·역할 변경·세션 종료 권한은 [EMAIL-AUTH.ko.md](EMAIL-AUTH.ko.md)를 따른다. 표에 없는 업무 API(아카이브의 위 세 줄 밖 작업·조사·지점·주문·학습 등)는 같은 워크스페이스의 로그인 사용자면 역할과 관계없이 허용한다. 확정 자료와 채택 진단은 AI 제작 맥락에 '확인된 근거'로 들어가므로(`lib/archive-server.ts` `brandArchiveContext`) 브랜드 사실과 같은 등급으로 관리자 전용이다. 상시 지시는 직원도 남길 수 있으므로 '확인된 근거'가 아니다. 저장할 때 작성자 역할(`createdBy.role`)을 남기고, AI 입력에는 `{text, author: 관리자|직원}`으로 전달하며, 역할·회의·브리프 지시문은 상시 지시가 사실을 확정하거나 거절 사실(`evidence.facts.prohibited`)·광고 표현 규칙을 무효화하지 못한다고 명시한다(`lib/campaign-policy.ts` `directivePolicy`). 앱 화면은 직원에게 관리자 전용 버튼을 그리지 않고 '관리자에게 요청하세요'를 안내한다(`useCanManage`). 사이드바 프로필은 로그인 계정을 보여 주지만 상단 계정 바(이메일·팀 계정 관리·비밀번호 변경·로그아웃)와 하나로 합치는 일은 이번 범위에서 뺐다.

행위자 기록: `/api/action`이 남기는 캠페인 이력 이벤트에는 요청한 사용자(`id`, `email`)를 함께 저장한다. 브랜드 사실을 확정·거절하면 `confirmedBy`(`id`, `email`)와 `confirmedAt`을 저장하고 사실 화면에 표시한다. 이 필드가 생기기 전에 저장된 사실에는 값이 없으며, 없는 사실도 기존처럼 제작 맥락에 쓰인다. 캠페인 삭제 기록(tombstone)에는 `deletedBy`(`id`, `email`)를 남긴다. 대표 결정 7(b)에 따라 캠페인 삭제는 바이럴 출처 학습 규칙을 지우지 않고 `status: retired`와 `sourceCampaignDeleted`(`at`, `by`)로 남기며, 원천 바이럴 실험은 원문(대조안·실험안·조건·메모·수치 출처)을 뺀 요약(kind `viral_experiment_summary`)만 동결한다. 남는 규칙에서도 원천 실험에서 복사된 원문(적용 범위 `scope`, `sourceAssessment`의 유지 조건·결과 메모·판정 사유)은 비우고, 규칙 제목·문구(`guidance`)·연장 기록·수치 판정만 둔다(`lib/record-kinds.ts` `retireRuleOfDeletedCampaign`). 다른 캠페인이 실행 시점에 받은 학습 규칙 사본(kind `learning_snapshot`)은 그 캠페인의 기록이라 원문을 포함한 채 남는다. 점포 출처 규칙·점포 실험은 그대로 둔다. kind별 삭제 정책은 `lib/record-kinds.ts`가 정본이다. 서버 설치 파일 발급·작업자 연결 해제는 같은 batch에서 `records`(kind `worker_event`)에 작업·행위자·시각을 남기고, 설정 화면은 대표·관리자에게 마지막 발급자와 해제자를 보여 준다. 학습·지점·AI 실행·회의 요청이 남기는 이벤트의 행위자 범위는 [EMAIL-AUTH.ko.md](EMAIL-AUTH.ko.md)의 '업무 이벤트'를 따른다.

## 설치 파일 배포 권한

`RESEARCH_WORKER_ADMIN_IDS`에 설치 파일을 받을 수 있는 사용자를 쉼표로 구분해 설정한다. 이메일, 표시 이름, 접두어, 와일드카드는 사용하지 않는다. 판정 단위는 **개인 사용자**다(`app/api/research-worker/setup/route.ts`).

| 요청자 (이메일 모드) | 허용 조건 |
|---|---|
| 대표(owner) | 목록에 본인 사용자 ID(`auth_users.id`) 또는 워크스페이스 owner ID가 있을 때. 워크스페이스 owner ID는 기존 운영 설정과의 호환용이다. |
| 관리자(admin) | 목록에 본인 사용자 ID가 있을 때만. 워크스페이스 owner ID가 목록에 있어도 같은 워크스페이스의 다른 관리자는 403이다. |
| 직원(member) | 목록과 관계없이 403. |

legacy 모드에서는 헤더의 사용자 ID가 곧 워크스페이스 owner이므로 기존처럼 그 ID가 목록에 있어야 한다. 목록이 없거나 조건에 맞지 않으면 설치 파일 다운로드는 403으로 거부되고 `canInstall`은 false다.

이 판정은 의도적으로 fail-closed다. 기존 운영 설정(워크스페이스 owner ID)은 대표 계정에만 계속 통한다. 다른 관리자에게 설치를 맡기려면 운영 담당자가 그 사람의 사용자 ID를 배포 환경변수에 추가해야 한다. 이 문서나 소스 변경은 운영 환경변수를 바꾸지 않는다. 기존 작업자 heartbeat는 관리자 목록과 무관하게 계속 동작한다. 작업자 연결 해제(`revoke`) API는 목록과 무관하게 대표·관리자에게 허용한다(상태 응답의 `canRevoke`). 설치 담당자가 없거나 설치 환경(`RESEARCH_WORKER_GATE_TOKEN`·`RESEARCH_WORKER_SITE_ORIGIN`)이 빠져 `canInstall`이 모두 false일 때도 가동 중인 작업자를 멈추는 수단이다.

설정 화면은 `canInstall`이 false인 사용자에게 설치 명령과 설치 파일 받기·다시 발급 버튼을 렌더링하지 않는다. 작업자 연결 해제 버튼은 `canRevoke`(대표·관리자)일 때 보인다. 연결 상태·마지막 응답 같은 상태 표시는 모든 로그인 사용자에게 보인다. 설치 명령의 접속 대상은 선택 환경변수 `RESEARCH_WORKER_SSH_TARGET`(`사용자@호스트`, 예: `deploy@research.example.com`)에서 읽어 `canInstall` 사용자에게만 내려준다. 값이 없거나 형식이 맞지 않으면 화면과 [README](../server/research-worker/README.md)는 `<서버 접속 주소>` 자리표시자를 보여 준다. 명령은 root 직접 로그인이 아니라 sudo 권한이 있는 계정으로 접속해 `sudo python3`로 설치 파일을 실행하는 기준이다. 실제 서버 주소는 저장소에 적지 않는다. 관측 기록의 HERMES 연결 주소도 `<HERMES 연결 주소>` 자리표시자로 바꿨다. `tests/security-boundaries.test.mjs`는 루트 문서와 app·lib·server·scripts·docs·e2e 파일에서 점 표기 IPv4(루프백과 RFC 5737 예시 대역 제외), 대시 표기 sslip.io·nip.io 호스트명, root 계정 접속 표기(`root` 뒤에 `@`)를 찾으면 실패한다. gitleaks에 IPv4 규칙을 추가하는 일은 이번 범위에서 뺐다. gitleaks 규칙은 경고가 아니라 커밋 차단이라 테스트 코드의 예시 IP까지 막기 때문이다. 과거 git 이력의 노출은 지울 수 없다. 서버의 root SSH 로그인 차단·키 인증·방화벽 허용목록은 저장소 밖 설정이며 이 PR에서 확인하지 않았다(not_run). 후속 운영 확인 항목으로 유지한다.

설치 파일에는 owner 전용 토큰 외에 **사이트 공통 gate 비밀값이 여전히 포함**된다. 지정 관리자는 이 공통 비밀값을 취급하는 신뢰 주체다. 관리자 제한은 일반 사용자에게 공통 비밀값이 배포되는 것을 막으며, gate 자체를 owner 전용 자격증명으로 바꾸지는 않는다. 파일은 no-store 첨부로 반환된다. 설치가 성공하면 설치기가 서버 사본을 스스로 지우고(PR 6, 지우지 못하면 경고), Mac 사본은 직접 지워야 한다. 장기 개선은 기계 접근 프록시에서 공통 gate를 보관하고 owner·경로·만료가 제한된 자격증명만 설치 파일로 전달하는 것이다([개선 계획](IMPROVEMENT-PLAN.ko.md) PR 6).

## 작업자 자격증명 만료·회전과 앱 gate 확인 (PR 6 앱 측)

마지막 갱신: 2026-09-24 KST (security-ops-4·security-ops-7 앱 측). 근거는 `tests/research-worker-rotation.test.mjs`(mocked: 메모리 SQLite, 로컬 요청, HERMES fetch 스텁), `tests/security-boundaries.test.mjs`(mocked: 소스 검사·모의 workerStatus)와 `python3 tests/research_worker_test.py`(로컬 HTTP 서버, 대기 시간 주입)다. 운영 게시·관측은 아직 하지 않았다(not_run).

**만료(기본 꺼짐).** 토큰 만료와 자동 교체는 배포 환경변수 `RESEARCH_WORKER_TOKEN_EXPIRY=enforce`일 때만 켜진다. 기본(없음 또는 `enforce` 외의 값)은 이 변경 전과 같다. 새로 발급한 토큰에도 만료가 없고, 저장된 `expiresAt`도 검사하지 않으며, 교체를 제안하지 않는다. 아래 전제(설정 폴더 쓰기)가 현재 설치기에서 성립하지 않아, 기본으로 켜면 재설치한 워커가 90일째에 조사·execution·measurement 큐와 함께 멈추기 때문이다. 켜면 새로 발급한 토큰은 90일 뒤 만료된다(`worker_credential.expiresAt`). 만료된 토큰은 기존 앱 문구('작업자 연결이 해제됐거나 인증이 만료됐습니다.')의 401이다. 켜기 전에 발급한 자격증명(`expiresAt` 없음)은 계속 만료 없이 받는다. 설정 화면(대표·관리자)은 '토큰 만료·자동 교체: 꺼짐', '만료를 켜기 전에 발급', 만료 시각과 남은 일수를 구분해 보여 준다.

**자동 교체(온라인 회전, 만료를 켰을 때만).** 만료 14일 전부터, 워커가 새 토큰을 저장할 수 있다고 알린 tick의 응답 `rotation`(`token`, `expiresAt`)에만 다음 토큰을 싣는다. 워커(`server/research-worker/worker.py`)는 설정 폴더에 쓸 수 있을 때만 `X-Collective-Rotation: ready` 헤더를 보낸다. 원문은 그 응답에만 있고 앱은 해시만 저장한다(`worker_credential.next`). 워커는 `worker.json`을 같은 폴더의 임시 파일(0600)에 쓰고 fsync한 뒤 `os.replace`로 한 번에 바꾸고 폴더도 fsync하며, 저장에 성공한 뒤에만 다음 tick부터 새 토큰을 쓴다. 폴더 fsync만 실패하면 파일은 이미 새 토큰이므로 경고(`worker_rotation_folder_sync_failed`)만 남기고 새 토큰을 쓴다. 새 토큰으로 tick이 성공하면 앱이 새 토큰을 현재 토큰으로 올리고 이전 토큰을 지운다. 두 토큰은 이 겹치는 동안(승격 전, 이전 토큰 만료 전)만 함께 유효하다. 워커가 응답을 받지 못했거나 저장하지 못해 이전 토큰으로 다시 오면, 앱은 마지막 제안 10분 뒤에 새 토큰을 다시 만들어 보낸다(마지막으로 보낸 것만 유효). 그 10분 동안의 tick은 자격증명 쓰기와 토큰 재전송이 없고, 이미 저장한 워커는 유지된 다음 토큰 해시로 승격된다. 저장 실패는 워커 로그 `worker_rotation_failed`(토큰 원문 없음)로 남는다. 설정 화면은 워커가 교체 가능을 알렸을 때만 '자동 교체'를 약속하고, 알리지 않았으면 만료 전에 다시 발급하라고 안내하며, 교체가 1시간 넘게 끝나지 않으면 경고한다.

전제와 켜는 순서: 워커 서비스가 설정 폴더(`/etc/collective-research`)에 쓸 수 있어야 한다. 이 변경부터 설치기의 워커 유닛(`server/research-worker/install.py` `worker_unit`)은 `ProtectSystem=strict`를 유지하면서 `ReadWritePaths=/etc/collective-research` 한 곳만 쓰기를 연다(폴더는 워커 계정 소유 0700이라 hermes·브라우저 계정은 여전히 읽지 못한다). 이 변경 전 설치기로 설치한 서버는 이 폴더가 읽기 전용이라 저장할 수 없다. 그런 워커는 시작할 때 `worker_rotation_unavailable` 경고를 남기고 `X-Collective-Rotation`을 보내지 않는다.

1. 이 변경을 게시하고 새 설치 파일로 워커를 재설치한다(공유 서버 재설치는 대표 승인 대상).
2. 대표·관리자로 설정 화면에서 '작업자는 새 토큰을 저장할 수 있다고 알렸습니다'를 확인한다. 이 문구가 없으면 켜지 않는다.
3. 배포 환경변수 `RESEARCH_WORKER_TOKEN_EXPIRY=enforce`를 추가하고 게시한 뒤, 설치 파일을 다시 발급해 재설치한다(만료는 새 발급에만 붙는다).
4. 되돌리기: 환경변수를 지우고 다시 게시한다. 저장된 만료도 바로 검사하지 않으므로 워커는 재설치 없이 계속 동작한다.

**다시 발급할 때 10분 유예.** 설정 화면에서 설치 파일을 다시 발급할 때 3분 안에 응답한 워커가 있으면 그 워커가 쓰는 토큰(그리고 이미 받았을 수 있는 다음 토큰)을 10분 동안 함께 받는다(`worker_credential.previous`). 화면은 '가동 중 워커는 10분 안에 새 설치가 필요합니다' 확인을 받고 유예 마감 시각을 보여 준다. 유예 중 이전 토큰의 tick은 큐를 처리하지만 상태는 '설치 파일 발급됨 · 서버 설치 대기'로 보이며, '서버 작업자 연결됨'은 새 설치의 tick부터다. 유예가 끝나면 이전 토큰은 401이다. 토큰 유출이 의심돼 바로 막아야 하면 먼저 '작업자 연결 해제'(자격증명 삭제, 유예 없음)를 누른 뒤 발급한다.

**거부 기록(`worker_rejected`).** 거부된 워커는 앱에 신호를 보낼 수 없으므로 앱이 소유자별 인증 실패를 `worker_rejection`에 사유별 마지막 시각(`expired`·`grace_ended`·`unknown_token`·`gate`)으로 남기고 설정 화면에 '최근 거부된 작업자 요청'으로 보여 준다. 자격증명이 있는 소유자만, 사유마다 1분에 한 번만 쓰며 토큰·헤더 값은 저장하지 않는다. 형식이 틀린 토큰과 자격증명이 없는 owner는 기록하지 않는다. 조회는 자격증명 유무와 무관하게 해서 owner별 등록 여부가 응답 시간에 덜 드러나게 한다(분당 한 번의 쓰기 차이는 남는다). owner 헤더는 요청자가 정하므로 `unknown_token` 기록은 실제 워커가 아닌 요청일 수도 있다. 그래서 화면은 구체적인 사유(`expired`·`grace_ended`·`gate`) 중 가장 최근 것을 먼저 보여 주고, 없을 때만 `unknown_token`을 보여 준다. 가짜 토큰 요청이 만료·유예 종료라는 실제 원인을 덮지 못한다. 화면은 그 뒤 정상 응답이 있었는지 함께 보여 준다. 기록은 재발급·연결 해제 때 지운다. 워커 쪽 401/403 처리(30분에서 6시간까지 늘어나는 재시도, 로그 `worker_rejected`)는 PR 6 서버 측 그대로다.

**공개 범위.** `workerStatus`는 기본으로 공개 필드(`registered`·`activated`·`online`·`lastSeen`·`lastStatus`·`blocked`)만 준다. 만료·교체·유예·거부·gate 필드(`expiryEnforced`·`issuedAt`·`expiresAt`·`rotationOfferedAt`·`rotationReady`·`graceUntil`·`lastRejected*`·`gate`·`gateEnforced`)는 설정 상태 조회(GET `/api/research-worker/setup`)에서 대표·관리자(`canRevoke`)에게만 준다. workspace 응답의 `worker`는 공개 필드만이다.

**중단 알림(권고 4, 앱 측).** 조사 진행 중 브랜드 아카이브 배너(`ResearchWorkerNotice`)는 대표·관리자에게 다음을 기존 '서버 작업자 응답 없음' 문구 아래에 사유와 '연결 및 설정에서 설치 파일을 다시 발급하세요' 안내로 보여 준다. 마지막 정상 응답 뒤의 거부(작업자가 온라인이 아닐 때, 사유 포함), 만료된 토큰, 1시간 넘게 끝나지 않은 자동 교체다. 일반 멤버는 사유 없이 기존 문구만 본다(위 공개 범위). 이메일·Slack 알림은 없다. 이 앱에는 알림 발송 기반이 없어 미구현 후속 항목이다([개선 계획](IMPROVEMENT-PLAN.ko.md) PR 6 '중단 알림'의 남은 일, 담당 레인 미정).

**앱 gate 확인(security-ops-7).** 앱이 워커 요청의 `OAI-Sites-Authorization` 헤더를 `Bearer <RESEARCH_WORKER_GATE_TOKEN>`과 SHA-256 해시끼리 상수시간으로 비교한다. 토큰 확인 뒤에 하므로 가짜 토큰은 gate와 무관하게 기존 앱 문구의 401이고, 위 운영 점검(`COLLECTIVE_PROBE_WORKER=1`)의 `rejectedBy` 판정은 바뀌지 않는다. 결과(`ok`·`missing`·`mismatch`·`unset`)는 성공한 tick마다 `worker_state.gate`에 남고 설정 화면(대표·관리자)에 보인다. 헤더 값은 저장하지 않는다.

- 기본(환경변수 없음 또는 `enforce` 외의 값): 기록만 하고 막지 않는다. Sites 디스패처가 이 헤더를 앱까지 넘기는지 확인되지 않았기 때문이다. 넘기지 않는데 막으면 모든 워커가 멈춘다.
- `RESEARCH_WORKER_APP_GATE=enforce`: 결과가 `ok`가 아니면 403('작업자 요청의 사이트 gate 확인에 실패했습니다.')으로 막고 거부 사유 `gate`를 기록한다. 앱에 `RESEARCH_WORKER_GATE_TOKEN`이 없으면 막는다(fail-closed).

enforce를 켜기 전 확인 절차:

1. 이 변경을 게시한 뒤 워커가 몇 번 tick하게 둔다(설정 화면 '마지막 응답' 갱신).
2. 대표·관리자로 설정 화면의 gate 표시를 본다. '앱에서도 확인했습니다'(`ok`)여야 한다. '헤더 없이 도착'(`missing`)이면 디스패처가 헤더를 앱까지 넘기지 않는 것이므로 enforce를 켜지 않는다. '앱 설정과 다릅니다'(`mismatch`)면 설치 파일의 gate와 앱 값이 다르므로 먼저 다시 발급·재설치한다.
3. `ok`를 확인한 뒤 배포 환경변수 `RESEARCH_WORKER_APP_GATE=enforce`를 추가하고 게시한다. 게시 직후 '마지막 응답'이 계속 갱신되고 최근 거부 사유에 gate가 없는지 확인한다.
4. 되돌리기: 환경변수를 지우고 다시 게시한다. 워커는 403을 받으면 30분부터 재시도 간격을 늘리므로, 복구 뒤 첫 tick까지 그만큼 걸릴 수 있다.

enforce 상태에서 공통 gate를 교체하면 설치된 워커는 모두 403으로 거부된다(재시도는 계속하므로 영구 정지는 아니다). 교체 전에 enforce를 끄거나, 교체 뒤 설치 파일을 다시 발급해 재설치한다.

## 조사 도구 위험 등급과 조사 시작 점검 (PR 6 앱 측, security-ops-1)

마지막 갱신: 2026-09-24 KST. 근거는 `tests/research-tools.test.mjs`(mocked: HERMES `/v1/capabilities`·`/v1/toolsets` fetch 스텁, 메모리 SQLite, 로컬 요청으로 두 시작 라우트 호출)다. 운영 게시·관측은 하지 않았다(not_run).

- **등급표**(`lib/research-tools.ts`): 도구 이름만 보고 read(`browser_navigate`·`browser_snapshot`·`browser_get_images`·`browser_vision`·`browser_back`·`web_search`·`web_extract` 등), interact(`browser_click`·`browser_type`·`browser_press`·`browser_scroll`), dangerous(`browser_cdp`·`browser_dialog`·`browser_console`·`browser_exec`·`terminal`·파일 읽기/쓰기·코드 실행·`computer_use`·`delegate_task`·`cronjob_manage`·`send_message` 등)로 나눈다. 표에 없는 이름은 이름 조각으로 올려 잡는다(예: exec·script·python·sql·ssh·http·fetch·run·create·write·send는 dangerous, click·type·fill은 interact). 그래도 모르면 unknown이다. unknown은 읽기로 추측하지 않고 화면에 '상호작용 이상으로 취급'으로 표시한다. 도구가 풀리지 않은 도구셋(`tools`가 빈 배열)은 도구셋 이름으로 등급을 매기되 `unresolved`에도 남기고, 형식 밖 도구 이름은 버리지 않고 `invalid`로 센다.
- **화면**: 조사 패널의 '조사 도구 확인'은 긍정 문구 대신 등급별 개수(미확인 도구셋·형식 밖 이름 포함)를 보여 주고, dangerous가 있으면 빨간 경고('서버 훅으로 차단하도록 설치했는지 확인 필요 — 운영 확인 항목')를 띄운다.
- **`RESEARCH_TOOL_POLICY`**: 기본 `warn`(없음 또는 `block` 외의 값)은 막지 않고, 점검 결과와 경고 메모를 `research.access`에 남긴다. `block`이면 dangerous 도구가 목록에 있거나, 목록을 읽지 못했거나(도구 목록 조회 미제공·오류), `unresolved` 도구셋이나 `invalid` 이름이 있거나, 점검 자체가 실패하면 조사 시작을 409로 막는다(fail-closed).
- **block을 켜는 조건**: 위험 도구를 끈 HERMES에서만 켠다. 현재 운영 목록에는 설치기가 `pre_tool_call` 훅으로 호출을 막은 `browser_cdp`·`browser_dialog`도 계속 보이므로(아래 '조사 서버 브라우저 격리' 절), 지금 운영에서 block을 켜면 모든 심층 조사 시작이 409로 멈춘다. 켜기 전에 조사 패널의 '조사 도구 확인'에서 위험 0, 미확인 도구셋 0, 형식 밖 이름 0을 확인한다. 되돌리기는 환경변수 삭제 뒤 게시다.
- **한계**: unknown은 block도 막지 않는다. Aside 같은 동적 MCP 도구가 모두 unknown이라 막으면 조사가 멈추고, 의미를 모르는 이름을 read로 등록하는 것도 추측이기 때문이다. 이름 판정이므로 이름이 무해해 보이는 위험 도구는 놓칠 수 있다. 실제 호출 차단은 서버 훅과 격리(아래 절)가 맡고, 이 등급은 목록 판정일 뿐이다.
- **시작 경로 연결 상태**:
  - 대화형 시작(POST `/api/archive/research` `start`, 분류 `classify` 제외): 라우트가 `executeResearch` 전에 `startResearchAccess`(`lib/research-tool-check.ts`)로 최신 점검을 한다. 시작 응답을 기다리게 하므로 HERMES 요청마다 8초(`START_CHECK_TIMEOUT_MS`)로 제한하고, 넘으면 점검 실패로 본다(warn은 미확인으로 시작, block은 409). block에 걸리면 409이고 조사를 만들지 않는다. 통과하면(warn 포함) 새로 만든 조사(202)의 단계가 모두 접수 전일 때 같은 조사 잠금 안에서 `research.access`를 점검 결과로 바꿔 쓴다. 잠금을 못 잡았거나(워커가 먼저 접수 중) 이미 접수가 시작됐으면 점검 결과를 남기지 못하고 조사는 그대로 진행된다(첫 HERMES 입력의 access가 unverified일 수 있다). 시작 응답 본문은 저장 전 값(unverified)이고, 다음 새로고침부터 점검 결과가 보인다.
  - 브랜드 등록 자동 조사(POST `/api/archive` `create_brand`, `autoResearch`): 기본(warn)은 점검하지 않고 `research.access`는 unverified다. 등록을 네트워크로 늦추지 않는다는 기존 계약('등록은 바로 완료', `tests/archive.test.mjs` 'registration atomically saves brand and queued research without network wait') 때문이다. block이면 등록 전에 점검한다. 막히면 브랜드만 만들고 조사는 만들지 않으며 응답 `researchBlocked`로 사유를 돌려주고 화면이 오류 알림으로 보여 준다. 통과하면 점검 결과를 `research.access`로 저장한다.
  - 넘길 일: `lib/research-execution.ts` 시작 경로의 `access:unverifiedResearchAccess()`를 `startResearchAccess`로 바꿔 한 곳에서 점검·저장하는 배선은 그 파일을 소유한 레인(병합 순서 PR 4a → A7)에서 한다. 그때 위 라우트의 사후 저장(`saveStartAccess`)은 지운다.
- **권고 4 미해결**: HERMES run 이벤트에서 실제 호출된 도구를 원장에 남기는 일은 `lib/hermes.ts`·`lib/usage-ledger.ts`를 고쳐야 해서 이 레인에서 하지 않았다. 두 파일의 병합 순서(F2 → PR 4a)에 따라 PR 4a가 넘겨받는다.

## 성과 수집 채널 자격증명 단위 (F5)

마지막 갱신: 2026-09-24 KST (F5, 대표 결정 16: 자격증명 단위는 브랜드). 근거는 `tests/channel-credentials-brand.test.mjs`(mocked: 메모리 SQLite, 로컬 요청·이메일 세션, Instagram fetch 스텁이 받은 Authorization 헤더)와 `tests/measurements.test.mjs`(mocked)다. 운영 게시·관측은 하지 않았다(not_run).

성과 커넥터(Instagram·네이버 검색광고) 자격증명은 `(brandId[, storeId], channel)` 단위로 저장한다. kind는 그대로 `channel_credential`이고 새 kind는 없다.

- **식별 규칙.** 레코드 id는 `<owner>:channel_credential:<channel>`(워크스페이스 기본, 기존 소유자 단위 레코드), `<owner>:channel_credential:<channel>:<brandId>`(브랜드 단위), `<owner>:channel_credential:<channel>:<brandId>:<storeId>`(지점 단위)다. 브랜드·지점 단위 레코드는 본문에 `brandId`·`storeId`를 함께 적고, parent_id는 기존처럼 비운다(`lib/record-kinds.ts` parent `none`). id가 겹치지 않도록 `:`가 든 브랜드·지점 id는 400으로 거절한다.
- **저장·해제 검증.** `/api/channels` POST는 기존처럼 관리자만(직원 403) 한다. `brandId`는 이 워크스페이스의 브랜드여야 하고(없거나 다른 워크스페이스의 브랜드면 404), `storeId`는 그 브랜드의 지점이어야 한다(없는 지점·다른 브랜드의 지점 404, 보관한 지점에 새로 연결하면 409, `brandId` 없이 `storeId`만 주면 400). 단위 검증이 먼저라 잘못된 단위로는 외부 API 검증 호출도 하지 않는다. 해제는 요청한 단위의 레코드 하나만 지운다. 브랜드를 해제해도 그 지점 단위와 워크스페이스 기본은 남고, 보관한 지점의 자격증명도 해제할 수 있다. 설정 채널 카드는 이 채널에 저장된 자격증명이 있는 보관 지점을 지점 선택지에 '(보관됨)'으로 남기고, 그 지점을 고르면 저장 버튼을 막고 해제만 허용한다.
- **조회 우선순위.** 수집은 지점 단위 > 브랜드 단위 > 워크스페이스 기본 순으로 찾고, 셋 다 없으면 기존 '연결 전' 409('… 연결이 필요합니다')다. 브랜드는 실험의 `brandId`, 지점은 실험 캠페인의 `storeId`(캠페인이 같은 브랜드일 때만)에서 정한다. 수집 요청 본문의 값으로는 단위를 고를 수 없다. 수동 수집과 워커 재수집(`collectDueMeasurements`)이 같은 경로를 쓴다.
- **격리 보장.** 조회 후보는 그 실험 브랜드의 지점·브랜드 레코드와 워크스페이스 기본뿐이라 다른 브랜드의 자격증명은 어떤 경우에도 쓰지 않는다. 브랜드 A 실험은 브랜드 B만 연결돼 있으면 워크스페이스 기본(있을 때)이나 '연결 전'으로 끝난다. 수집 초안의 arm 기록(`measurement_draft.arms.<arm>.credential`)에 실제로 쓴 단위(`level`·`brandId`·`storeId`)를 남기고, 두 arm이나 같은 arm의 이전 수집과 단위가 다르면 초안 한계에 비교 금지 경고를 붙인다([신뢰성](RELIABILITY.ko.md#성과-수집-자격증명-선택-f5)).
- **상태 응답.** GET `/api/channels`의 `channels`는 워크스페이스 기본만 보여 준다(기존 필드 그대로). `byBrand`는 브랜드마다 채널별 브랜드 단위 상태와 저장된 지점 단위 상태를 주고, 만료가 7일 안이거나 지난 토큰에는 `warning`을 붙인다. `?brandId=`(`&storeId=`)를 주면 그 단위의 수집이 쓸 자격증명(`resolved[].resolvedScope`)을 함께 준다. 어느 응답에도 비밀값은 없다. 조회는 기존처럼 같은 워크스페이스의 로그인 사용자면 역할과 관계없이 허용한다.
- **마이그레이션 없음.** 기존 소유자 단위 레코드는 옮기거나 다시 쓰지 않고 워크스페이스 기본으로 계속 읽는다. 범위 없이 부르는 저장·조회·해제는 이전과 같은 id·필드·응답이다.
- **발행용 Buffer 자격증명과 대조.** `publisher_credential`은 처음부터 브랜드 단위(id `<owner>:publisher_credential:<brandId>`, parent 브랜드)이고 워크스페이스 기본이나 지점 단위가 없다. 성과 수집 자격증명은 브랜드 단위를 같은 규칙(다른 브랜드 것은 쓰지 않음)으로 따르되, 호환을 위해 워크스페이스 기본을 마지막 후보로 둔다. Buffer 규칙은 이번에 바꾸지 않았다.
- **남은 일.** 브랜드는 삭제 경로가 없고 지점은 보관만 하므로 브랜드·지점 단위 자격증명의 삭제 연쇄는 두지 않았다. 지점을 보관해도 그 지점 자격증명은 자동으로 해제되지 않고 그 지점 캠페인의 수집에 계속 쓰인다(보관 시 자동 해제는 동작 변경이라 별도 결정). 캠페인 삭제는 `channel_credential`을 건드리지 않는다(`not_campaign_scoped`). 암호화 키 회전(security-ops-6)·수집 실패 표시(security-ops-5)·loop-1은 PR 4b 잔여다.
- **loop-1은 open이다.** F5는 loop-1의 선행 작업(브랜드 단위 자격증명)만 한다. loop-1 본체(실행 중인 실험 카드의 `/api/measurements` collect 버튼, `/api/learning` GET의 `measurement_draft`·`measurement_source`(`lastFetchedAt`·`lastError`·`stopped`), 결과 입력 모달의 초안 값 미리 채우기, 수집 실패·토큰 만료 경고)는 PR 4b에서 한다. 그때 실험 카드의 만료 판정은 GET `/api/channels?brandId=&storeId=`의 `resolved[].resolvedScope`·`expiresAt`을 재사용한다.

## 입력과 공급자 응답

`lib/http-limits.ts`는 Content-Length뿐 아니라 **수신 중 실제 바이트**를 세고 한도 초과 시 스트림을 취소한다. JSON 요청은 200,000 UTF-8 바이트와 객체 루트만 허용한다. 기존 문자 수 제한과 달라 한글 등 멀티바이트 대형 요청은 더 일찍 거부된다. 파일 업로드에는 기존 별도의 8MB 파일/10MB 전송 제한이 유지된다.

### 업로드 원본과 추출 텍스트 (PR 6c, security-ops-12)

업로더는 텍스트 자료를 직접 추가할 수도 있는 워크스페이스 사용자라 보안 영향은 낮다. 아래 규칙은 '텍스트 추출 완료'로 표시된 자료가 실제 파일과 같은지(근거 추적성)를 지키기 위한 것이다.

- **형식 판정**: 확장자와 매직 바이트를 함께 본다(`lib/file-signature.ts` `fileSignatureProblem`). 원본은 `application/octet-stream`으로 저장하고 다운로드는 `attachment`·`nosniff`·CSP `sandbox`로만 준다.
- **텍스트 형식(TXT·MD·CSV·JSON)은 서버가 다시 추출한다**(`lib/archive-upload-server.ts` `serverExtract`). 업로드 바이트를 `TextDecoder('utf-8',{fatal:true})`로 읽어 content를 만들고(앞 바이트가 UTF-16 BOM `FF FE`·`FE FF`이면 UTF-16으로 읽는다), 브라우저가 보낸 `content`·`extraction`·`extractionScope`는 쓰지 않는다. 상한은 기존과 같은 80,000자이고, 넘으면 '앞부분 80,000자 추출'·'뒷부분 미포함'으로 적는다. 추출 상태는 '서버 추출 · …'이다.
- **그 밖의 인코딩(한국어 엑셀 기본 CSV의 CP949, BOM 없는 UTF-16 등)은 거부하지 않는다.** 텍스트 확장자의 인코딩을 제한하지 않는 기존 정책(`lib/file-signature.ts`)대로 원본을 보관하되, 본문은 비우고(브라우저가 보낸 깨진 글자일 수 있는 본문은 쓰지 않는다. 사용자 메모만 붙는다) 추출 상태를 '서버 추출 불가 · UTF-8 아님 · 원본만 보관', 범위를 '인코딩 미지원 · 원문 확인 필요'로 적는다. 본문이 없으면 확정할 수 없으므로, 'CSV UTF-8'로 다시 저장해 추가하도록 안내한다.
- **JSON 구문 확인**: `JSON.parse`가 실패해도 거부하지 않고 보관하되 추출 상태에 'JSON 구문 오류 · 형식 확인 필요'를 붙인다(확장자만 json인 NDJSON 같은 원문도 근거 원문이기 때문). 구문 확인은 1MB 이하 파일만 한다. 작은 객체가 많은 JSON은 파싱 결과가 입력의 수십 배(로컬 측정: 1MB `[{},…]`에 힙 약 23MB)로 불어나 Workers 메모리 한도(128MB)에 닿을 수 있어, 1MB를 넘으면 파싱하지 않고 'JSON 구문 확인 생략(1MB 초과) · 형식 확인 필요'로 적는다.
- **잠금 전에 검증한다**: 확장자·시그니처 검사와 본문 추출은 입력만 보므로 워크스페이스 잠금(`acquireLock`) 전에 한다. 파일이 잘못됐거나 추출이 느려도 잠금을 잡고 있지 않는다.
- **PDF·DOCX·이미지는 서버가 해석하지 않는다.** 브라우저 추출값(`lib/archive-upload.ts` `extractArchiveFile`)을 쓰되 추출 상태 앞에 '브라우저 추출(서버 미검증) · '을 붙인다. 브라우저가 '서버 추출'이라고 보내도 이 표시가 앞에 붙는다. 확정은 관리자가 원문과 대조한 뒤 한다.
- **추출 출처는 서버만 쓰는 `extractedBy`(`server`·`browser`)로 판정한다**(`brand_source` JSON 필드, migration 없음). 화면 표시(`uploadExtractionLabel`)는 추출 상태 문자열의 접두어를 믿지 않는다. 이 필드가 생기기 전 업로드는 추출 상태를 브라우저가 보낸 그대로 저장했으므로, 내용이 '서버 추출 · '로 시작해도 모두 '브라우저 추출(서버 미검증) · '을 붙여 보여 준다. 이 표시는 자료 상세의 '추출 출처', 자료 목록 행, 후보 일괄 검토 대화상자에 모두 보인다(일괄 확정으로 서버 미검증 추출이 표시 없이 '확인된 근거'가 되지 않게).
- 사용자 메모(`note`)와 자료 범위(`scope`)는 추출값과 따로 받아 서버가 '[사용자 메모]' 아래와 범위 뒤에 붙인다. 배포 전에 열린 탭(이전 번들)은 `note`·`extractionScope` 없이 메모를 `content` 끝 '[사용자 메모]' 아래에 합쳐 보내므로, 서버 추출 형식에서는 그 메모를 되살리고 범위 앞의 '업로드 원문 텍스트' 중복을 뺀다.

**R2 원본 정리**

- 사용 제외(`excluded`)는 되돌릴 수 있으므로 원본을 지우지 않는다.
- 관리자 전용 `delete_source_file`(`lib/archive-server.ts` `deleteSourceFile`)은 자료 레코드·추출 텍스트·검토 상태·B1 `review_decision`을 그대로 두고 원본만 지운다. `objectKey`를 지우고 `fileDeletedAt`·`fileDeletedBy`(`id`, `email`)를 남기며 자료 `version`만 올린다. AI 입력(content)은 바뀌지 않으므로 archive revision은 올리지 않는다. 원본 다운로드는 404 '원본 파일이 삭제됐습니다'이다.
- 순서는 레코드 저장(키를 `fileCleanupKey`에 보관) → R2 삭제 → 성공하면 `fileCleanupKey` 제거다. R2 삭제가 실패하면 `archive_object_cleanup_failed`와 오류 이름만 로그에 남기고(키·메시지 없음) 응답은 성공(`cleanupPending: true`)이다. `fileCleanupKey`가 남은 자료가 재시도 목록이며, 같은 요청을 다시 보내면(자료 상세의 '저장소 정리 다시 시도') R2 삭제만 재시도한다. 목록 조회: `SELECT id FROM records WHERE kind='brand_source' AND json_extract(data,'$.fileCleanupKey') IS NOT NULL`. API 응답에는 키 대신 `fileCleanupPending`만 내보낸다. 자료 요약(`lib/archive.ts` `sourceSummary`)이 키를 빼므로 아카이브 목록과 지점 API(`/api/stores`)가 같은 규칙을 따르고, 자료 상세는 `withoutCleanupKey`로 뺀다. 다운로드는 레코드의 `objectKey`로만 하므로 키만으로 원본을 받을 수는 없다.
- **키 형식 확인**: 같은 버킷에 다른 워크스페이스의 원본과 발행 공개 미디어가 섞여 있으므로, `removeArchiveObject`는 업로드 라우트가 만든 `archive/<uuid>/<자료 id>` 형식만 지우고 원본 파일 삭제에서는 키가 그 자료 id로 끝나는지도 본다. 맞지 않으면 R2를 호출하지 않고 `archive_object_cleanup_failed`·`InvalidKey`만 남기며 `fileCleanupKey`는 정리 대기로 남는다(운영자 확인 대상).
- **업로드 롤백**: 원본을 올린 뒤 레코드 batch가 실패하면 방금 올린 객체를 `removeArchiveObject`로 지운다. 이 삭제도 실패하면 같은 로그(`archive_object_cleanup_failed`와 오류 이름)만 남는다. 레코드가 없는 고아라서 재시도 목록에 들어가지 않으며, 아래의 `archive/` 접두 목록과 `brand_source` 대조 방식으로 정리한다.
- 자료 영구 삭제와 브랜드 삭제 경로는 아직 없다. 만들 때는 지울 `brand_source`의 `objectKey`·`fileCleanupKey`를 batch 전에 모으고, 레코드 삭제 batch가 성공한 뒤 `removeArchiveObject`로 지운다. 실패한 키는 레코드가 없으므로, R2 `archive/` 접두 목록과 남은 `brand_source`의 `objectKey`·`fileCleanupKey`를 대조해 참조 없는 객체를 지우는 방식으로 재시도한다(이 PR에는 그 스크립트가 없다).

외부 공급자 응답을 읽는 코드는 명시적 응답 바이트 한도와 fetch timeout을 함께 사용해야 한다. 크기 제한은 공급자 응답의 스키마 검증, 과금 예산 제한, 도구 실행 권한 제한을 대신하지 않는다.

## 운영 디스패처 읽기 전용 점검

명시적으로 승인받은 운영 origin에만 실행한다. 아래 명령은 기본으로 GET `/api/channels`만 요청하며, 리다이렉트를 따라가지 않고 응답 본문이나 비밀값을 출력하지 않는다. 별도 승인 뒤 `COLLECTIVE_PROBE_WORKER=1`을 함께 주면 gate 헤더 없이 형식만 맞는 가짜 작업자 토큰으로 POST `/api/research-worker`를 한 번 보내고, 거부한 쪽(`rejectedBy`)을 기록한다. 응답 모양만으로는 구분하지 않는다. 앱이 이 요청에 돌려주는 고정 문구(`lib/research-worker.ts`의 '작업자 연결이 해제됐거나 인증이 만료됐습니다.' 또는 '작업자 인증이 필요합니다.')와 앱 응답 헤더(`Cache-Control: no-store`, `X-Content-Type-Options: nosniff`)가 모두 맞아야 `app`(디스패처가 gate를 강제하지 않음)이다. 문구나 헤더 한쪽만 맞으면 `unknown`(status `blocked`, 수동 확인)이고, 그 밖의 401/403과 로그인 리다이렉트는 `dispatcher`, 200·500 등은 `failed`다. 본문은 비교만 하고 출력하지 않는다. 앱의 gate 확인은 토큰 확인 뒤에 하므로 이 판정은 `RESEARCH_WORKER_APP_GATE` 값과 무관하다([아래](#작업자-자격증명-만료회전과-앱-gate-확인-pr-6-앱-측)). 판정은 `tests/security-boundaries.test.mjs`가 모의 응답으로 검사한다(mocked). 이 작업자 경로 점검은 아직 운영에서 실행하지 않았다(not_run). `COLLECTIVE_PROBE_DIRECT_ORIGIN`은 운영 담당자가 알려준 실제 Worker 직접 접근 주소가 있을 때만 지정한다.

```sh
COLLECTIVE_PROBE_ORIGIN=https://your-authorized-site.example \
COLLECTIVE_PROBE_DIRECT_ORIGIN=https://your-authorized-worker.example \
node scripts/probe-dispatcher-auth.mjs
```

검사 대상은 익명 요청, 위조 사용자 헤더, 중복 사용자 헤더다. 401/403 또는 같은 origin의 명시적 로그인 경로로 가는 리다이렉트만 거부 성공으로 인정한다. 200 HTML 인증 화면이나 다른 리다이렉트는 수동 확인 전 성공으로 판정하지 않는다. 실제 디스패처의 로그인 경로가 다르면 도메인과 경로를 확인한 뒤 검사 조건을 조정한다.

출력의 `passed`는 해당 익명 요청이 거부됐다는 뜻이다. 다음 항목까지 통과한 것은 아니다.

- 정상 로그인한 사용자 A가 B의 헤더를 보냈을 때 A로 강제되는지 또는 거부되는지.
- 두 사용자에 서로 다른 채널/파일 fixture가 있을 때 다른 사용자 자료를 읽을 수 없는지.
- 사이트 공통 gate를 가진 기계 요청이 브라우저 identity를 주장할 수 없는지.
- 공개 도메인 외의 origin이나 대체 라우트가 차단되는지.

이 네 항목은 별도의 승인된 세션·fixture와 디스패처 운영 설정으로 확인해야 한다. 로그에는 cookie, bearer, 실제 계정 자료를 남기지 않는다. 운영본이 검토 브랜치와 다른 경우 검사 결과는 그때 실행 중인 운영본에만 해당한다. `/api/version`의 tree와 검토 tree를 별도로 기록해야 한다.

### 운영 관측 기록

2026-09-23 검증 담당자가 `COLLECTIVE_PROBE_ORIGIN=https://mealzip-agency.hflameb.chatgpt.site node scripts/probe-dispatcher-auth.mjs`를 실행했다. 익명·위조 identity·중복 identity 세 요청은 모두 **passed · real — HTTP 401**이었다. 응답 본문은 기록하지 않았다. 기록 시각은 시스템 시계 기준 2026-09-23 13:08:57 KST다.

2026-09-24 14:15 UTC 대표가 운영 조사 서버에 CDP 점검 설치기(#76 코드를 이미 받은 설치 파일에 적용)로 재설치했다(sudo 없는 ssh 계정이라 `su -`로 root 실행). **passed · real**: `격리 확인` 줄 — 다른 로컬 계정의 CDP 점검 포트 접속(collective-npm) 거부, 브라우저 계정의 file:// 열기 거부(직후 data: 재확인 통과), 브라우저 계정의 루프백 접속 거부, 다른 로컬 계정의 CDP 포트 접속(collective-npm) 거부, 브라우저 계정의 서버 자신의 주소 접속 거부(IPv4·IPv6 각 한 줄), HERMES의 browser_cdp·browser_dialog 호출 차단(pre_tool_call 훅, fail_closed), 브라우저 계정의 작업자 자격증명·HERMES 설정·HERMES 비밀 읽기 거부, hermes 계정의 작업자 자격증명 읽기 거부. `Real browser check passed: Example Domain`, `브라우저 계정: collective-browser (Chromium 샌드박스 유지)`. 서버 사본 설치 파일은 설치기가 지웠다. 앱 `/api/research-worker/setup`: online, blocked 0, rotationReady true, gate `missing`(디스패처가 gate 헤더를 앱까지 넘기지 않음 → `RESEARCH_WORKER_APP_GATE=enforce` 켜지 않음). 서버 주소는 기록하지 않는다. 실제 run에서 `browser_cdp` 호출이 막히는지(차단 사유 문구)는 not_run이다.

Worker 직접 origin 및 로그인된 사용자 간 격리는 **not_run**이다. 이 관측은 당시 운영본에 대한 것이며, 아직 게시하지 않은 작업 브랜치의 배포·런타임 검증을 뜻하지 않는다.

## 조사 서버 브라우저 격리 (PR 6)

마지막 갱신: 2026-09-24. 바뀐 것은 저장소의 설치기(`server/research-worker/install.py`)뿐이다. 공유 서버 재설치는 대표 확인 뒤에 한다. 2026-09-24 첫 실행은 3/6단계 샌드박스 점검에서 멈췄고(아래 샌드박스 행), CDP 점검으로 고친 설치기로 같은 날 14:15 UTC 재설치를 마쳤다(위 운영 관측 기록). 설치기의 순수 함수는 `python3 tests/research_install_test.py`로 검사하고 CI verify 잡도 이 명령을 실행한다(mocked, root·네트워크 없음). 서버에서의 실제 차단 효과는 설치기가 설치 중에 스스로 점검한다(아래 '설치 점검' 열).

| 경계 | 설치기가 하는 일 | 설치 점검(실패하면 설치 중단) |
|---|---|---|
| 계정 분리 | Chromium은 전용 시스템 계정 `collective-browser`(로그인 셸 없음, 홈 `/var/lib/collective-browser` 0700)로 `collective-browser.service`에서만 실행한다. 큐 워커는 전용 계정 `collective-worker`로 실행하고 `/etc/collective-research`(0700)·`worker.json`(0600)도 이 계정 소유다. 워커는 `worker.json`과 HTTPS만 쓰므로 `~hermes/.hermes`가 필요 없다. 전용 계정이 root·hermes와 UID나 그룹을 공유하면 멈춘다. `~hermes/.hermes`의 기타 사용자 권한 비트를 지운다. 브라우저 유닛은 `ProtectHome=true`·`ProtectSystem=strict`·`PrivateTmp=true`다. | 작업자 설치 뒤 브라우저 계정으로 `worker.json`·`config.yaml`·`.env` 읽기, hermes 계정으로 `worker.json` 읽기가 실패해야 한다. `collective-worker`의 `worker.json` 읽기는 성공해야 한다(양성 대조군). |
| 샌드박스 | `--no-sandbox`를 쓰지 않는다. `kernel.apparmor_restrict_unprivileged_userns=1`(Ubuntu 24.04 기본)이면 AppArmor 프로필 `collective-chromium`을 적용해 `/opt/collective-browser/chromium/chrome`에만 `userns`를 허용한다. 이 폴더는 `root:collective-browser` 0750이라 다른 계정은 이 실행 파일로 `userns` 예외를 얻지 못한다. 프로필 적용이나 샌드박스 시작이 실패하면 이유를 출력하고 멈춘다. 예외는 명시 옵션 `--allow-no-sandbox`뿐이다. | 브라우저 계정이 샌드박스를 켠 채 점검용 Chromium을 임시 루프백 점검 포트(9334)로 띄우고, root가 CDP `/json/new`로 연 `data:` 페이지의 제목 토큰이 `/json/list`에 보여야 한다. 점검 포트를 LISTEN하는 소켓은 띄우기 전에는 없고 띄운 뒤에는 모두 브라우저 계정 소유여야 한다. 끝나면 점검 브라우저를 프로세스 그룹째 끝낸다. 설치기가 SIGHUP(ssh 연결 끊김)·SIGTERM으로 끝나도 점검 브라우저를 끝내고, 다음 실행은 남은 점검 브라우저(점검 프로필)를 먼저 끝낸 뒤 포트 선점을 확인한다. 2026-09-24 운영 서버 첫 설치에서 Chrome for Testing 154의 `--dump-dom`이 끝나지 않아 이전 점검이 오판으로 멈췄고, 진단으로 샌드박스·AppArmor·방화벽이 정상임을 확인해 CDP 방식으로 바꿨다. |
| 내부망 | `collective-browser-firewall.service`가 nftables `inet collective_browser` 테이블만 교체한다. 브라우저 계정 소켓의 새 연결 중 0/8·10/8·100.64/10·127/8·169.254/16·172.16/12·192.168/16, IPv6 `::`·`::1`·`fc00::/7`·`fe80::/10`, 그리고 `fib daddr type { local, broadcast, multicast }`(서버 자신의 공인 주소 포함)를 거부한다. 자기 공인 주소로 가는 트래픽은 lo로 전달돼 ufw의 lo 허용 규칙과 클라우드 방화벽을 거치지 않기 때문이다. 예외는 이미 성립된 연결(HERMES가 연 CDP 연결의 응답)과 `/etc/resolv.conf`의 네임서버가 차단 대역 안일 때 그 주소의 53번 포트뿐이다. 브라우저 유닛은 방화벽 유닛을 `BindsTo=`로 묶는다. 방화벽 유닛은 `After=`·`PartOf=`·`ReloadPropagatedFrom=nftables.service`와 `ExecReload`로 nftables를 다시 읽거나 재시작할 때(`flush ruleset`) 테이블을 다시 넣는다. | root로 CDP 포트가 열린 것을 확인한 뒤(양성 대조군) 브라우저 계정의 127.0.0.1 CDP 포트 접속이 실패해야 한다. root가 서버 기본 경로의 출발 주소(`ip route get`)에 임시 포트를 열어 root 접속은 성공하고(양성 대조군) 브라우저 계정 접속은 실패해야 한다. |
| CDP 포트 | CDP(루프백 9333, 인증 없음)로의 새 연결은 root와 hermes 계정만 허용한다(모든 계정에 적용되는 output 규칙). 설치 점검 때만 여는 CDP 점검 포트(루프백 9334, 인증 없음)로의 새 연결은 root만 허용한다(hermes 포함 다른 계정 거부). | `/json/version`이 알려 준 주소가 `ws://127.0.0.1:9333/devtools/browser/`로 시작해야 하고, 9333을 LISTEN하는 소켓이 모두 브라우저 계정 소유여야 한다(포트 선점 확인). `collective-npm` 계정의 CDP 포트 접속이 실패해야 한다. 점검 브라우저가 9334를 연 뒤(root의 `/json/version`이 양성 대조군) `collective-npm` 계정의 점검 포트 접속도 실패해야 한다. |
| 로컬 파일·내부 페이지 | Chrome 정책 `URLBlocklist`로 `file://*`·`chrome://*`(about: 별칭 포함)·`chrome-untrusted://*`를 막는다. `about:blank`·`data:`·`blob:`은 새 탭과 일반 웹이 쓰므로 둔다. 정책 파일은 서버의 Chrome for Testing·Chromium·Chrome 모두에 적용된다. | root가 점검 브라우저(샌드박스 행)에 CDP `/json/new`로 브라우저 계정이 파일 권한상 읽을 수 있는 `file://` 페이지(root 소유 폴더의 0644 파일, 제목 토큰)를 열었을 때 `/json/list`에 그 제목이 보이지 않고, 직후 새 토큰의 `data:` 페이지 제목은 보여야 한다(시간 초과·비정상 종료를 차단으로 오인하지 않음). `file://` 페이지를 여는 `/json/new` 요청 자체가 실패하면(HTTP 오류·시간 초과) 차단 증거로 보지 않고 멈춘다. |
| HERMES 연결 | HERMES는 브라우저를 띄우지 않고 루프백 CDP(`browser.cdp_url`, `BROWSER_CDP_URL`, 포트 9333)로 붙는다. `AGENT_BROWSER_ARGS`를 채워 HERMES가 userns 제한 환경에서 `--no-sandbox`를 스스로 넣는 경로를 막는다. 이전 설치의 `AGENT_BROWSER_EXECUTABLE_PATH`(hermes 소유 Chromium)는 dotenv에서 비우고 게이트웨이 드롭인에서 지운다. 설치된 HERMES 브라우저 소스에 `cdp_url`·`BROWSER_CDP_URL`이 없으면 설정을 바꾸기 전에 멈춘다. | hermes 계정의 agent-browser가 HERMES와 같게 `--cdp`만 넘겨(`--session`을 함께 쓰면 `--cdp`를 무시하고 로컬 브라우저를 띄움) `https://example.com` 제목을 읽고, 그 페이지가 root가 읽는 격리 브라우저의 `/json/list`에 있어야 한다. |
| 원시 브라우저 도구 | CDP 연결로 켜지는 `browser_cdp`·`browser_dialog`를 HERMES `pre_tool_call` 셸 훅으로 막는다. root 소유 0755 스크립트 `/opt/collective-browser/hooks/deny-raw-browser.sh`(stderr에 사유, exit 2)를 `hooks.pre_tool_call`에 `matcher: '^(browser_cdp|browser_dialog)$'`, `timeout: 5`, `fail_closed: true`로 등록한다. `hooks_auto_accept`는 켜지 않고 `shell-hooks-allowlist.json`의 `approvals`에 이 훅의 `{event, command}`만 넣는다. 설치된 HERMES 소스에 셸 훅(`pre_tool_call`·`fail_closed`·승인 목록)과 게이트웨이 등록이 없으면 설정을 바꾸기 전에 멈춘다. | 게이트웨이를 다시 띄운 뒤 hermes 계정으로 `hermes hooks list`에 승인 표시가 있고, `hermes hooks test pre_tool_call --for-tool browser_cdp`가 차단을 돌려주고, `--for-tool browser_navigate`에는 이 훅이 걸리지 않아야 한다. 어긋나면 HERMES 설정을 되돌린다. |
| 공급망 | root는 apt·계정 생성·root 소유 경로로 복사·AppArmor·nftables·Chrome 정책·systemd·HERMES 설정·격리 점검에만 쓴다. agent-browser는 전용 계정 `collective-npm`이 integrity를 고정한 lockfile로 `npm ci --ignore-scripts`해 설치하고, Chromium 내려받기도 같은 계정이 한다. 결과는 root 소유 `/opt/collective-browser`(그룹·기타 쓰기 없음)로 복사한다. Chromium 라이브러리는 `agent-browser install --with-deps`를 root로 돌리지 않고 설치기가 apt로 직접 설치한다. | `tests/research_install_test.py`(mocked). lockfile은 로컬 npm 캐시로 `npm ci --offline --ignore-scripts` 설치를 확인했다(2026-09-23). |
| root 파일 작업 | 비특권 계정이 바꿀 수 있는 경로에서 root가 심볼릭 링크를 따라가지 않는다. 설치기가 쓰는 파일은 임시 파일의 파일 기술자로 소유자·권한을 바꾼 뒤 이름을 바꾼다(`fchown`·`fchmod`). `collective-npm`의 남은 프로세스는 시작 전과 다운로드 뒤에 모두 끝낸다(`pkill -KILL -u`). `stage`는 매번 링크 자체를 지운 뒤 root가 새로 만든다. 복사 원본(`stage/node_modules`, Chromium 폴더)은 계정 홈부터 어느 단계도 링크가 아니어야 하고, 실행 권한을 줄 agent-browser 실행 파일과 `chrome`은 복사본에서 일반 파일이어야 한다. `file://` 점검 페이지는 브라우저 계정 홈이 아니라 root 소유 폴더에 쓴다. | `tests/research_install_test.py`(mocked: 링크 `stage` 교체, 링크 원본 거부, 링크 실행 파일 거부, 파일 기술자 권한 변경, 남은 프로세스 종료). |
| 설치 파일 | 성공하면 서버 사본을 `os.unlink`로 지운다. 지우지 못하면 경고만 내고 설치 결과는 유지한다. Mac 사본은 직접 지운다. | `tests/research_install_test.py`(mocked). |

실패 처리: 격리 점검(샌드박스·Chrome 정책·방화벽과 CDP 음성 테스트·포트 선점·파일 격리)이 실패하면 격리 브라우저 서비스를 항상 끄고 비활성화한다. 기능 점검(실제 브라우저, 게이트웨이 재시작, 훅 확인 등)이 실패하면 브라우저 서비스는 설치 전 상태(켜져 있었으면 유지, 아니면 끔)로 두고 그 상태를 출력한다. HERMES 설정 뒤 실패면 어느 경우든 HERMES 설정·dotenv·드롭인·승인 목록을 되돌리고 작업자 서비스를 끄고 비활성화한다.

이 절이 막지 않는 것:

- `browser_cdp`·`browser_dialog`는 도구 목록(`GET /v1/toolsets`, 앱의 조사 권한 점검)에는 계속 보이고 호출만 훅이 막는다. 도구 목록으로 위험 도구를 판정하는 앱 쪽 작업(PR 6 앱 측, [조사 도구 위험 등급](#조사-도구-위험-등급과-조사-시작-점검-pr-6-앱-측-security-ops-1))은 이 점을 전제로 한다. `browser_console`의 `expression`(페이지 안 JavaScript 실행)과 클릭·입력 같은 상호작용 도구는 막지 않는다. 그 영향은 위 표의 브라우저 계정 권한·방화벽·Chrome 정책 안으로 제한된다.
- CDP 포트 소유 확인은 설치 때 한 번이다. 이후 브라우저가 재시작되는 사이(`RestartSec=5`)에 다른 로컬 계정이 9333을 먼저 LISTEN하면 HERMES가 그 가짜 CDP에 붙을 수 있다. 방화벽 규칙은 연결을 막을 뿐 포트 선점은 막지 않는다.
- 방화벽 테이블은 nftables 재시작·다시 읽기 때 다시 들어가지만, 관리자가 `nft flush ruleset`을 직접 실행해 지운 경우는 감지하지 못한다. 그때는 `sudo systemctl restart collective-browser-firewall.service`로 다시 넣는다(브라우저도 함께 재시작된다).
- 공인 인터넷과 DNS 조회는 막지 않는다(조사에 필요하다). 유닉스 소켓은 nftables 대상이 아니어서 파일 권한과 `ProtectHome`에 기댄다.
- 브라우저 프로필(`/var/lib/collective-browser/profile`)은 재시작 뒤에도 남고, HERMES의 여러 조사 세션이 한 Chromium을 공유한다. 서버 브라우저에 SNS 로그인을 붙이면 모든 조사 세션이 그 로그인을 공유한다.
- root가 hermes 소유 폴더(`~hermes/.hermes`, 게이트웨이 드롭인 폴더)의 중간 경로 링크까지 막지는 않는다. 파일 소유자·권한 변경은 파일 기술자로 하고 드롭인 폴더 소유자 변경은 링크를 따라가지 않지만, hermes 계정이 폴더 자체를 링크로 바꿔 두면 root가 그 대상 폴더에 설정 파일을 쓸 수 있다.

### 원시 브라우저 도구 차단 확인 (재설치 뒤)

참고로 개발 Mac의 hermes-agent 사본(운영 서버 버전과 다를 수 있다)에서 두 도구는 `browser-cdp` 도구셋으로 등록되면서 `browser` 도구셋 목록에도 들어 있고, CDP 주소(`BROWSER_CDP_URL`·`browser.cdp_url`)가 있을 때만 켜진다. `agent.disabled_toolsets`는 도구 해석 끝에 항상 빼는 단계가 있지만 api_server 경로는 이 값을 에이전트에 넘기지 않아 적용되지 않는다. 그래서 도구셋 설정이 아니라 셸 훅으로 막는다. 셸 훅은 게이트웨이 시작 때 등록되고 CLI·게이트웨이 모두에서 호출 직전에 실행된다.

1. 설치 출력에 `격리 확인: HERMES가 browser_cdp·browser_dialog 호출을 막음`이 있는지 본다.
2. hermes 계정으로 `hermes hooks list`를 실행해 `/opt/collective-browser/hooks/deny-raw-browser.sh`가 승인(allowed)으로 보이는지 확인한다.
3. 조사 작업이 없는 시간에 실제 run 1건에서 `browser_cdp` 호출이 막히는지(차단 사유 문구) 확인하고, 결과를 이 문서의 운영 관측 기록에 남긴다.

### 운영 적용 절차 (재설치는 대표 확인 후)

대표가 직접 실행할 순서와 Claude에게 넘길 출력은 [조사 서버 재설치 절차서](RESEARCH-SERVER-REINSTALL.ko.md)에 있다.

1. 대표에게 재설치 시각과 영향을 알리고 확인을 받는다. 영향은 게이트웨이 재시작, 진행 중 AI 작업 중단 필요, 브라우저 실행 방식 변경(CDP 연결), 원시 브라우저 도구 차단, 워커 실행 계정 변경(`collective-worker`)이다.
2. 진행 중인 AI 작업을 끝내거나 취소한다.
3. 설정 화면에서 설치 파일을 다시 발급하고 [README](../server/research-worker/README.md) 절차대로 sudo 계정으로 `sudo python3 ~/install-collective-server.py`를 실행한다. 다시 발급하면 이전 작업자 자격증명은 무효가 된다. 3분 안에 응답한 워커가 있으면 10분 유예 뒤 무효다(위 '작업자 자격증명 만료·회전' 절).
4. 출력에서 `격리 확인` 줄을 모두 확인해 운영 관측 기록에 남긴다. CDP 점검 포트 접속(collective-npm 계정), file://(직후 data: 재확인), 루프백 접속, CDP 포트 접속(collective-npm 계정), 서버 자신의 주소 접속(주소별 한 줄), 원시 브라우저 도구 차단, 작업자 자격증명·HERMES 설정·HERMES 비밀(브라우저 계정), 작업자 자격증명(hermes 계정)이다. `Real browser check passed`, `Chromium 샌드박스 유지`도 확인한다. 비밀값과 서버 주소는 적지 않는다.
5. 설정 화면의 작업자 heartbeat와 새 브랜드 조사 1건으로 실제 조사를 확인한다.
6. 서버 사본이 지워졌는지 확인하고 Mac 사본을 지운다.

롤백: [README 롤백](../server/research-worker/README.md#롤백) 절차를 따른다. 브라우저·방화벽 서비스를 끄고, HERMES 설정·dotenv·게이트웨이 드롭인을 설치기가 남긴 `before` 백업으로 되돌린 뒤 게이트웨이를 재시작한다. 이전 방식(hermes 계정, 샌드박스 없음)으로 돌아가므로 임시 조치로만 쓴다.

## 에이전트 권한의 남은 경계

게시·메시지·결제 금지 프롬프트와 capabilities 조회는 기술적 read-only enforcement가 아니다. HERMES gateway의 실제 도구 allowlist와 중요 행동 승인 정책을 별도로 검증해야 한다. 격리된 브라우저 사용자·sandbox·내부망 차단은 PR 6 설치기에 들어갔지만 운영 서버 재설치 전까지는 적용되지 않는다(위 절). 공개 형태 hostname 검사는 여전히 앱 수준의 DNS/IP SSRF 차단을 증명하지 않는다. 설치기의 nftables 규칙은 서버 브라우저 계정에만 적용된다. 공통 gate의 경로별 권한은 저장소 밖 운영 경계다.
