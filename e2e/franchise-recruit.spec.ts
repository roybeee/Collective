// 트랙 R 가맹 모집 여정(로컬 빌드 · 로컬 D1). 운영 사이트·운영 D1에는 연결하지 않는다.
// 1) #186 결정 34: 모집 자료의 대기기간·계약·가맹금·정보공개서 후보 문장이 원문 보기와 승인 단계에서 <mark>로 강조되고, 확인란을 체크하기 전에는 승인·복사·내려받기 버튼이 잠긴다.
//    서버에 확인 없이 보내면 409 wait_review_missing이고, 체크한 뒤 승인·내려받기·복사가 성공한다.
// 2) #188 R5c 유입·비용 탭: 모집 코드 발급 → 사용 중지, 모집 비용 기록 → 무효화, 행사에 비용 연결, 리드 CSV 가져오기(검사·미리보기·확정).
// 3) R6c 성과 탭: 읽는 법 문구·면책이 숫자보다 먼저, 작은 표본 표기, 진행 중인 주 확정 불가, 지난주 확정·Markdown 내려받기, 리드 상세 증빙 묶음(연락처 원문 없음).
// 4) 대표 결정 35 적격 판정: 적격 기준 저장 → 리드 상세에서 판정·사유 코드 선택 → 기록(기준 버전 표시) → 판정 변경이 이력으로 남음 → 보드 '적격 판정' 필터·열 → 성과 탭 코호트 적격 표.
// 5) R6d 워크스페이스 할 일: 미응대 문의 건수와 면책이 첫 화면 '다음 할 일'에 보이고(리드 이름·연락처 없음), 누르면 가맹 모집 리드 탭으로 간다.
//    '다음 할 일'은 AI 연결을 마친 워크스페이스에만 보이므로, 실제 /api/workspace 응답을 미리 받아 연결 상태(configured)만 참으로 바꿔 돌려준다(mocked 연결, real 할 일).
// 6) R6d-2 소재 실험 선별(유입·비용 탭): '플랫폼 보고, 원장 리드 아님'이 첫 줄, 계획(오늘 시작) → 결과(판정·중간 확인 경고) → 확인 층 표본 부족 → 취소.
// 7) R7a 공공 벤치마크 탭: 고정 문구, 키 없음 막힘(적재 409, 외부 호출 0), 가상 키 저장 → 적재 버튼 열림(누르지 않음) → 키 지우기. 공공데이터포털은 호출하지 않는다.
// 8) R15b-2 모집 카드 묶음: 템플릿 → 저장 → 승인 → PNG 내려받기(1080×1350·1080×1920, 카드 수만큼), 쓸 수 없는 코드 400.
// 9) R9a 너처링: 탭 안내·AI 초안 409(연결 없음)·정보성·광고성 템플릿 저장·정보 요청 → 보낸 뒤 기록(요청당 1회)·광고성 기록 막힘·외부 요청 0.
// 10) R15b-3 인터뷰 영상 완성본: 승인된 15초 대본 판에서 파일의 SHA-256만 기록(파일 업로드 없음).
// 직원 역할 화면(비용·가져오기 영역 없음)은 legacy 헤더 요청자가 늘 소유자라 여기서 재현할 수 없다. 실제 이메일 세션 직원으로 e2e/email-auth.spec.ts에서 본다.
// 근거: real Chromium·빌드 결과·로컬 D1(wrangler --local) / mocked 인증(legacy 로그인 헤더). 요청 가로채기는 쓰지 않는다(docs/E2E.ko.md 규칙).
// 모든 값은 가상이다(브랜드는 시드 브랜드 ofd, 이름 김가상·이테스트, 전화 010-0000-12xx, 이메일 *@example.com). 결과는 COLLECTIVE 휴리스틱 · 법률 자문 아님.
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';
import {test, expect, type Browser, type Download, type Page, type Response, type TestInfo} from '@playwright/test';

const IDENTITY_HEADER = 'oai-authenticated-user-id';
const BRAND = 'ofd';
const STORAGE_LABEL = '가상 본사 문서함';

// 날짜는 한국시간 기준으로 코드에서 계산한다.
const koreaToday = () => new Date().toLocaleDateString('en-CA', {timeZone: 'Asia/Seoul'});
const addDays = (date: string, days: number) => new Date(Date.parse(date + 'T00:00:00Z') + days * 86400000).toISOString().slice(0, 10);
const shot = (page: Page, testInfo: TestInfo, step: string) => page.screenshot({path: `e2e/artifacts/franchise-${step}-${testInfo.project.name}.png`, fullPage: true});
let seq = 0;
const requestId = (tag: string) => `e2e-${tag}-${Date.now()}-${++seq}`;

async function ownerPage(browser: Browser, testInfo: TestInfo, owner: string) {
  const {baseURL, viewport} = testInfo.project.use;
  const context = await browser.newContext({baseURL, viewport, extraHTTPHeaders: {[IDENTITY_HEADER]: owner}, permissions: ['clipboard-read', 'clipboard-write']});
  return {context, page: await context.newPage()};
}
async function franchise(page: Page, action: string, payload: Record<string, unknown>) {
  const response = await page.request.post('/api/franchise', {data: {action, requestId: requestId(action), brandId: BRAND, ...payload}});
  return {status: response.status(), body: await response.json() as Record<string, unknown>};
}
const franchiseAction = (action: string) => (r: Response) => {
  if (!r.url().endsWith('/api/franchise') || r.request().method() !== 'POST') return false;
  return (r.request().postDataJSON() as {action?: string} | null)?.action === action;
};
const reasonCodes = (body: Record<string, unknown>) => ((body.reasons ?? []) as {code: string}[]).map(r => r.code);

// 준비(API): 가맹 기능 스위치, 가맹 프로필(분기 A·보관 위치 라벨), 현재 정보공개서 등록 버전, 가맹 모집 목적 캠페인.
async function prepareFranchise(page: Page, title: string) {
  await page.request.get('/api/workspace');
  const flag = await page.request.post('/api/feature-flags', {data: {action: 'set', flag: 'r_franchise', enabled: true}});
  expect(flag.status()).toBe(200);
  const profile = await franchise(page, 'save_profile', {version: 0, profile: {branch: 'A', forecastInputs: {sme: true, storesAtFyEnd: 3, fiscalYearEnd: null}, holidays: null, storageLabels: [STORAGE_LABEL], eligibility: null}});
  expect(profile.status, JSON.stringify(profile.body)).toBe(200);
  const today = koreaToday();
  const version = await franchise(page, 'register_disclosure_version', {label: '가상 정보공개서 E2E', sha256: createHash('sha256').update('e2e 가상 정보공개서').digest('hex'), storageLabel: STORAGE_LABEL,
    registeredAt: `${addDays(today, -30)}T10:00:00+09:00`, validFrom: addDays(today, -30), validUntil: addDays(today, 300)});
  expect(version.status, JSON.stringify(version.body)).toBe(200);
  const campaign = await page.request.post('/api/action', {data: {action: 'save_campaign', data: {brandId: BRAND, title, goal: '가상 가맹 모집 여정 확인', objective: 'franchise_recruitment'}}});
  expect(campaign.status()).toBe(200);
  return (await campaign.json() as {id: string}).id;
}

// 강조 후보 2문장(정보공개서·가맹금/계약)과 후보가 아닌 1문장. 포털 소개문은 절 구조·사실 참조가 없어 게이트가 200이다.
const PLAIN_LINE = '가상 브랜드 가맹 상담을 받습니다.';
const DISCLOSURE_LINE = '정보공개서는 상담 때 서면으로 드립니다.';
const FEE_LINE = '가맹금은 계약 체결 때 안내합니다.';
const ASSET_BODY = [PLAIN_LINE, DISCLOSURE_LINE, FEE_LINE].join('\n');

test('#186 결정 34: 강조한 후보 문장을 확인해야 모집 자료를 승인·내보낸다', async ({browser}, testInfo) => {
  test.setTimeout(120_000);
  const owner = `e2e-fr186-${testInfo.project.name}-${Date.now()}`;
  const {context, page} = await ownerPage(browser, testInfo, owner);
  const campaignId = await prepareFranchise(page, `가상 가맹 모집 186 ${testInfo.project.name}`);

  // 1) 모집 자료 탭에서 포털 소개문 초안을 만든다.
  await page.goto(`/?view=franchise&brand=${BRAND}&tab=assets`);
  await page.getByRole('button', {name: '새 모집 자료', exact: true}).click();
  const sheet = page.getByRole('dialog');
  await sheet.getByRole('combobox', {name: '자료 유형', exact: true}).selectOption('portal_intro');
  await sheet.getByRole('combobox', {name: /모집 캠페인/}).selectOption(campaignId);
  await sheet.getByRole('textbox', {name: '원문', exact: true}).fill(ASSET_BODY);
  const saved = page.waitForResponse(franchiseAction('asset_save'));
  await sheet.getByRole('button', {name: '초안 저장', exact: true}).click();
  const savedResponse = await saved;
  expect(savedResponse.status()).toBe(200);
  const asset = (await savedResponse.json() as {result: {assetId: string; version: number; bodyHash: string}}).result;
  await expect(sheet.getByText('v1 초안을 저장했습니다.', {exact: true})).toBeVisible();

  // 2) 원문 보기: 후보 문장 2개만 형광 강조(<mark>)되고, 조각을 이으면 원문 그대로다.
  const view = await (await page.request.get(`/api/franchise?view=asset&brandId=${BRAND}&assetId=${asset.assetId}`)).json() as {waitReview: {version: string; candidates: unknown[]}; checklist: {version: string; items: {id: string}[]}};
  expect(view.waitReview.candidates).toHaveLength(2);
  const bodyView = sheet.locator('pre[aria-label="원문"]');
  await expect(bodyView.locator('mark')).toHaveText([DISCLOSURE_LINE, FEE_LINE]);
  await expect(bodyView).toHaveText(ASSET_BODY);
  await shot(page, testInfo, '186-1-view-highlight');

  // 3) 승인 단계: 승인할 원문에도 같은 강조. 체크리스트를 모두 체크해도 대기기간 확인란 전에는 승인 버튼이 잠겨 있다.
  await sheet.getByRole('button', {name: '승인하기', exact: true}).click();
  const step = sheet.getByRole('region', {name: '승인 확인'});
  await expect(step.locator('pre[aria-label="승인할 원문"] mark')).toHaveText([DISCLOSURE_LINE, FEE_LINE]);
  const checklist = step.getByRole('group', {name: /승인 체크리스트/});
  const items = checklist.getByRole('checkbox');
  await expect(items).toHaveCount(view.checklist.items.length);
  for (let i = 0; i < view.checklist.items.length; i++) await items.nth(i).check();
  const approveButton = step.getByRole('button', {name: '승인', exact: true});
  const waitConfirm = step.getByRole('checkbox', {name: /문장 2개를 읽었고/});
  await expect(waitConfirm).not.toBeChecked();
  await expect(approveButton).toBeDisabled();
  await shot(page, testInfo, '186-2-approve-locked');

  // 4) 서버: 대기기간 확인 없이 승인하면 409 wait_review_missing이고 초안은 그대로다.
  const checklistInput = {version: view.checklist.version, checked: view.checklist.items.map(i => i.id)};
  const unconfirmed = await franchise(page, 'asset_approve', {assetId: asset.assetId, version: asset.version, bodyHash: asset.bodyHash, checklist: checklistInput});
  expect(unconfirmed.status).toBe(409);
  expect(reasonCodes(unconfirmed.body)).toEqual(['wait_review_missing']);

  // 5) 확인란을 체크하면 승인 버튼이 열리고 승인이 성공한다.
  await waitConfirm.check();
  await expect(approveButton).toBeEnabled();
  const approved = page.waitForResponse(franchiseAction('asset_approve'));
  await approveButton.click();
  const approvedResponse = await approved;
  expect(approvedResponse.status()).toBe(200);
  expect((approvedResponse.request().postDataJSON() as {waitReview?: unknown}).waitReview).toEqual({version: view.waitReview.version, confirmed: true, candidates: 2});
  await expect(sheet.getByText('v1을 승인했습니다.', {exact: true})).toBeVisible();
  await shot(page, testInfo, '186-3-approved');

  // 6) 내보내기: 확인란 전에는 복사·내려받기가 잠기고, 서버에 확인 없이 보내면 409다.
  const copyButton = sheet.getByRole('button', {name: '복사', exact: true});
  const downloadButton = sheet.getByRole('button', {name: '내려받기(.txt)', exact: true});
  await expect(copyButton).toBeDisabled();
  await expect(downloadButton).toBeDisabled();
  const exportUnconfirmed = await franchise(page, 'asset_export', {assetId: asset.assetId, version: asset.version, mode: 'download'});
  expect(exportUnconfirmed.status).toBe(409);
  expect(reasonCodes(exportUnconfirmed.body)).toEqual(['wait_review_missing']);
  await shot(page, testInfo, '186-4-export-locked');

  // 7) 확인 뒤 내려받기(파일 원문 = 승인 원문)와 복사(클립보드 원문 = 승인 원문)가 성공하고 내보내기 기록이 2건이다.
  await sheet.getByRole('checkbox', {name: /문장 2개를 읽었고/}).check();
  await expect(downloadButton).toBeEnabled();
  const download = page.waitForEvent('download');
  const exported = page.waitForResponse(franchiseAction('asset_export'));
  await downloadButton.click();
  expect((await exported).status()).toBe(200);
  expect(readFileSync(await (await download).path(), 'utf8')).toBe(ASSET_BODY);
  await expect(sheet.getByText('내려받았습니다. 내보내기 기록 1건을 남겼습니다.', {exact: true})).toBeVisible();
  await expect(copyButton).toBeEnabled();
  const copied = page.waitForResponse(franchiseAction('asset_export'));
  await copyButton.click();
  expect((await copied).status()).toBe(200);
  await expect(sheet.getByText('복사했습니다. 내보내기 기록 1건을 남겼습니다.', {exact: true})).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(ASSET_BODY);
  await expect(sheet.getByText('내보내기 2회', {exact: true})).toBeVisible();
  await shot(page, testInfo, '186-5-exported');
  await context.close();
});

test('#188 R5c 유입·비용: 모집 코드 중지·비용 무효화·행사 비용 연결·리드 CSV 가져오기', async ({browser}, testInfo) => {
  test.setTimeout(150_000);
  const owner = `e2e-fr188-${testInfo.project.name}-${Date.now()}`;
  const {context, page} = await ownerPage(browser, testInfo, owner);
  const campaignId = await prepareFranchise(page, `가상 가맹 모집 188 ${testInfo.project.name}`);
  const today = koreaToday();

  await page.goto(`/?view=franchise&brand=${BRAND}&tab=inflow`);
  await expect(page.getByRole('heading', {name: '모집 코드', exact: true})).toBeVisible();

  // 1) 모집 코드 1개 발급 → 사용 중지.
  const codeForm = page.locator('form').filter({has: page.locator('legend', {hasText: '새 모집 코드'})});
  await codeForm.getByRole('combobox', {name: /모집 채널/}).selectOption('expo');
  await codeForm.getByRole('textbox', {name: /라벨/}).fill('가상 박람회 부스 QR');
  const issued = page.waitForResponse(franchiseAction('code_issue'));
  await codeForm.getByRole('button', {name: '모집 코드 발급', exact: true}).click();
  const issuedResponse = await issued;
  expect(issuedResponse.status()).toBe(200);
  const code = (await issuedResponse.json() as {result: {code: string}}).result.code;
  expect(code).toMatch(/^R[0-9A-Z]{7}$/);
  const codeRow = page.getByRole('table', {name: '모집 코드 목록'}).getByRole('row').filter({hasText: code});
  await expect(codeRow).toContainText('사용 중');
  await shot(page, testInfo, '188-1-code-issued');
  page.once('dialog', dialog => void dialog.accept());
  const retired = page.waitForResponse(franchiseAction('code_retire'));
  await page.getByRole('button', {name: `${code} 사용 중지`, exact: true}).click();
  expect((await retired).status()).toBe(200);
  await expect(codeRow).toContainText(`중지 ${today}`);
  await expect(page.getByRole('button', {name: `${code} 사용 중지`, exact: true})).toHaveCount(0);
  await shot(page, testInfo, '188-2-code-retired');

  // 2) 모집 비용 1건 기록 → 무효화(입력 오류). 두 번째 비용은 행사에 연결할 유효 비용이다.
  const spendForm = page.locator('form').filter({has: page.locator('legend', {hasText: '모집 비용 기록'})});
  async function recordSpend(date: string, amount: string, evidence: string) {
    await spendForm.getByRole('combobox', {name: /모집 채널/}).selectOption('expo');
    await spendForm.getByLabel('비용 날짜').fill(date);
    await spendForm.getByRole('textbox', {name: '금액 (원)', exact: true}).fill(amount);
    await spendForm.getByRole('radio', {name: '부가세 제외', exact: true}).check();
    await spendForm.getByRole('textbox', {name: /금액 근거/}).fill(evidence);
    const recorded = page.waitForResponse(franchiseAction('spend_record'));
    await spendForm.getByRole('button', {name: '비용 기록', exact: true}).click();
    const response = await recorded;
    expect(response.status(), JSON.stringify(await response.json())).toBe(200);
    await expect(page.getByText('모집 비용을 기록했습니다.', {exact: true})).toBeVisible();
  }
  await recordSpend(addDays(today, -3), '300,000', '가상 박람회 부스 계산서');
  const spendTable = page.getByRole('table', {name: '모집 비용 목록'});
  const firstSpend = spendTable.getByRole('row').filter({hasText: '300,000원'});
  await expect(firstSpend).toContainText('유효');
  await shot(page, testInfo, '188-3-spend-recorded');
  await firstSpend.getByRole('combobox', {name: '무효화 사유', exact: true}).selectOption('entry_error');
  const voided = page.waitForResponse(franchiseAction('spend_void'));
  await firstSpend.getByRole('button', {name: '무효화', exact: true}).click();
  expect((await voided).status()).toBe(200);
  await expect(firstSpend).toContainText('무효화 (입력 오류)');
  await shot(page, testInfo, '188-4-spend-voided');
  await recordSpend(addDays(today, -2), '500,000', '가상 박람회 참가비 계산서');
  const spendView = await (await page.request.get(`/api/franchise?view=spend&brandId=${BRAND}`)).json() as {spend: {id: string; amount: number; status: string}[]};
  expect(spendView.spend.map(s => [s.amount, s.status]).sort()).toEqual([[300000, 'voided'], [500000, 'active']]);
  const activeSpend = spendView.spend.find(s => s.status === 'active')!;

  // 3) 행사 탭에서 새 행사를 등록하며 유효 비용을 연결한다(무효화한 비용은 선택지에 없다).
  await page.getByRole('tab', {name: '행사', exact: true}).click();
  await page.getByRole('button', {name: '새 행사', exact: true}).click();
  const eventDialog = page.getByRole('dialog');
  await eventDialog.getByRole('combobox', {name: /모집 캠페인/}).selectOption(campaignId);
  await eventDialog.getByLabel('시작 시각 · 한국시간', {exact: true}).fill(`${addDays(today, 5)}T14:00`);
  await eventDialog.getByRole('textbox', {name: /장소/}).fill('가상 직영점 2층');
  await eventDialog.getByRole('spinbutton', {name: /정원/}).fill('20');
  const spendSelect = eventDialog.getByRole('combobox', {name: /모집 비용 연결/});
  await expect(spendSelect.locator('option')).toHaveCount(2);
  await spendSelect.selectOption(activeSpend.id);
  await shot(page, testInfo, '188-5-event-spend-link');
  const eventSaved = page.waitForResponse(franchiseAction('event_save'));
  await eventDialog.getByRole('button', {name: '행사 저장', exact: true}).click();
  const eventResponse = await eventSaved;
  expect(eventResponse.status(), JSON.stringify(await eventResponse.json())).toBe(200);
  expect((eventResponse.request().postDataJSON() as {spendRef?: string}).spendRef).toBe(activeSpend.id);
  await expect(page.getByText('행사를 저장했습니다.', {exact: true})).toBeVisible();
  const events = await (await page.request.get(`/api/franchise?view=events&brandId=${BRAND}`)).json() as {events: {spendRef?: string | null; placeLabel: string}[]};
  expect(events.events.map(e => [e.placeLabel, e.spendRef])).toEqual([['가상 직영점 2층', activeSpend.id]]);
  await shot(page, testInfo, '188-6-event-saved');

  // 4) 리드 CSV 가져오기(가상 2행): 기기·서버 검사 → 미리보기 → 확정 대화 → 가져오기 기록.
  await page.getByRole('tab', {name: '유입·비용', exact: true}).click();
  const received = (days: number, time: string) => `${addDays(today, days)} ${time}`;
  const csv = ['접수일시,희망지역,창업예산,희망시기,이름,휴대폰,이메일',
    `${received(-3, '10:00')},서울 강남구,5천만~1억원,3개월 안,김가상,010-0000-1201,kim.e2e@example.com`,
    `${received(-2, '11:30')},경기 성남시,1억~2억원,6개월 안,이테스트,010-0000-1202,lee.e2e@example.com`].join('\n') + '\n';
  const inspected = page.waitForResponse(franchiseAction('lead_import_inspect'));
  await page.getByLabel('가져올 CSV 파일', {exact: true}).setInputFiles({name: 'e2e-leads.csv', mimeType: 'text/csv', buffer: Buffer.from(csv, 'utf8')});
  expect((await inspected).status()).toBe(200);
  const importForm = page.locator('form').filter({has: page.locator('legend', {hasText: '파일 2행 · 열 7개'})});
  await expect(importForm).toBeVisible();
  await importForm.getByRole('combobox', {name: /모집 채널/}).selectOption('lead_ad');
  await importForm.getByRole('combobox', {name: /제공처/}).fill('가상리드광고');
  await importForm.getByLabel('제공일', {exact: true}).fill(today);
  await importForm.getByLabel('내보내기 기간 시작', {exact: true}).fill(addDays(today, -7));
  await importForm.getByLabel('내보내기 기간 끝', {exact: true}).fill(addDays(today, -1));
  await expect(importForm.getByRole('radio', {name: /위탁 수집/})).toBeChecked();
  await shot(page, testInfo, '188-7-import-inspected');
  const previewed = page.waitForResponse(franchiseAction('lead_import_preview'));
  await importForm.getByRole('button', {name: '미리보기', exact: true}).click();
  const previewResponse = await previewed;
  expect(previewResponse.status(), JSON.stringify(await previewResponse.json())).toBe(200);
  const plan = page.getByRole('region', {name: '가져오기 미리보기'});
  await expect(plan).toContainText('만들 리드 2건');
  // 미리보기 화면에는 연락처 원문이 없다(합쳐진 건수·행 번호만).
  await expect(plan).not.toContainText('김가상');
  await expect(plan).not.toContainText('010-0000-1201');
  await shot(page, testInfo, '188-8-import-preview');
  await plan.getByRole('button', {name: '가져오기 확정', exact: true}).click();
  const confirmDialog = page.getByRole('dialog');
  await expect(confirmDialog.getByRole('heading', {name: /리드 2건 가져오기/})).toBeVisible();
  const confirmed = page.waitForResponse(franchiseAction('lead_import_confirm'));
  await confirmDialog.getByRole('button', {name: '가져오기 확정', exact: true}).click();
  const confirmResponse = await confirmed;
  expect(confirmResponse.status(), JSON.stringify(await confirmResponse.json())).toBe(200);
  await expect(page.getByText('리드 2건을 가져왔습니다.', {exact: true})).toBeVisible();
  await expect(page.getByRole('list', {name: '리드 가져오기 기록'})).toContainText('메타 리드광고 · 가상리드광고');
  const board = await (await page.request.get(`/api/franchise?view=board&brandId=${BRAND}`)).json() as {total: number};
  expect(board.total).toBe(2);
  await shot(page, testInfo, '188-9-import-confirmed');
  await context.close();
});

// ISO 주(YYYY-Www, 월~일)를 한국 날짜 문자열에서 코드로 계산한다.
function isoWeek(date: string) {
  const t = Date.parse(date + 'T00:00:00Z'), monday = (d: number) => (new Date(d).getUTCDay() + 6) % 7;
  const thursday = t + (3 - monday(t)) * 86400000, year = new Date(thursday).getUTCFullYear(), jan4 = Date.UTC(year, 0, 4);
  return `${year}-W${String(Math.floor((thursday - (jan4 - monday(jan4) * 86400000)) / (7 * 86400000)) + 1).padStart(2, '0')}`;
}

test('R6c 성과 탭: 문구·면책이 숫자보다 먼저, 작은 표본 표기, 지난주 확정·내려받기, 리드 증빙 묶음', async ({browser}, testInfo) => {
  test.setTimeout(150_000);
  const owner = `e2e-fr-r6-${testInfo.project.name}-${Date.now()}`;
  const {context, page} = await ownerPage(browser, testInfo, owner);
  await prepareFranchise(page, `가상 가맹 모집 R6 ${testInfo.project.name}`);
  const today = koreaToday();

  // 준비(API): 모집 코드 1개, 오늘 비용 1건, 코드를 넣은 가상 리드 6건.
  const issued = await franchise(page, 'code_issue', {channel: 'portal', label: '가상 포털 소개', validFrom: addDays(today, -30)});
  expect(issued.status, JSON.stringify(issued.body)).toBe(200);
  const code = (issued.body.result as {code: string}).code;
  const spent = await franchise(page, 'spend_record', {channel: 'portal', date: today, amount: 1234567, vat: 'excluded', funding: 'hq_budget', evidence: '가상 포털 관리 화면 소진'});
  expect(spent.status, JSON.stringify(spent.body)).toBe(200);
  for (let i = 0; i < 6; i++) {
    const lead = await franchise(page, 'create_lead', {contact: {name: '김가상', phone: `010-0000-13${String(i).padStart(2, '0')}`}, task: {region: '', budgetBand: 'unknown', timingBand: 'unknown', sourceChannel: 'walk_in'}, basis: {type: 'inquiry_response'}, codes: [code]});
    expect(lead.status, JSON.stringify(lead.body)).toBe(200);
  }

  // 1) 이번 주: 읽는 법 문구와 면책이 표보다 먼저, 리드 6건, CPL은 '표본 부족', 진행 중인 주라 확정 버튼 없음.
  await page.goto(`/?view=franchise&brand=${BRAND}&tab=report`);
  const notes = page.getByRole('list', {name: '보고 읽는 법'});
  await expect(notes).toContainText('귀속≠증분');
  await expect(notes).toContainText('모델 호출은 0건');
  const inflow = page.getByRole('table', {name: '유입 건수'});
  await expect(inflow.getByRole('row').filter({hasText: '전체'})).toContainText('6');
  const order = await page.evaluate(() => {
    const text = document.body.innerText;
    return {note: text.indexOf('귀속≠증분'), disclaimer: text.lastIndexOf('COLLECTIVE 휴리스틱 · 법률 자문 아님'), table: text.indexOf('수기 등록')};
  });
  expect(order.note).toBeGreaterThan(-1);
  expect(order.note).toBeLessThan(order.table);
  expect(order.disclaimer).toBeLessThan(order.table);
  const costs = page.getByRole('table', {name: '채널별 비용과 CPL'});
  await expect(costs).toContainText('표본 부족(n<20)');
  await expect(costs).toContainText('1,234,567원');
  await expect(page.getByText('진행 중인 주입니다.', {exact: false})).toBeVisible();
  await expect(page.getByRole('button', {name: '이 주 보고 확정', exact: true})).toHaveCount(0);
  await shot(page, testInfo, 'r6-1-report-open-week');

  // 2) 지난주(끝난 주)를 골라 확정 → 판 1 → Markdown 내려받기.
  const lastWeek = isoWeek(addDays(today, -7));
  await page.getByLabel('보고 주', {exact: true}).fill(lastWeek);
  await page.getByRole('button', {name: '보기', exact: true}).click();
  await expect(page.getByRole('heading', {name: new RegExp(`^${lastWeek} `)})).toBeVisible();
  page.once('dialog', dialog => void dialog.accept());
  const frozen = page.waitForResponse(franchiseAction('report_freeze'));
  await page.getByRole('button', {name: '이 주 보고 확정', exact: true}).click();
  const frozenResponse = await frozen;
  expect(frozenResponse.status(), JSON.stringify(await frozenResponse.json())).toBe(200);
  await expect(page.getByText('확정 판 1', {exact: false})).toBeVisible();
  await shot(page, testInfo, 'r6-2-report-frozen');
  const exported = page.waitForResponse(franchiseAction('report_export'));
  const download = page.waitForEvent('download');
  await page.getByRole('button', {name: 'Markdown 내려받기', exact: true}).click();
  expect((await exported).status()).toBe(200);
  expect((await download).suggestedFilename()).toBe(`recruitment-report-${BRAND}-${lastWeek}.md`);

  // 3) 리드 상세에서 증빙 묶음(JSON) 내려받기: 연락처 원문 없음.
  await page.getByRole('tab', {name: '리드', exact: true}).click();
  const board = await (await page.request.get(`/api/franchise?view=board&brandId=${BRAND}`)).json() as {leads: {systemCode: string}[]};
  await page.getByRole('button', {name: `리드 ${board.leads[0].systemCode} 열기`, exact: true}).click();
  const sheet = page.getByRole('dialog');
  const bundled = page.waitForResponse(franchiseAction('evidence_export'));
  const bundleDownload = page.waitForEvent('download');
  await sheet.getByRole('button', {name: '증빙 묶음 내려받기', exact: true}).click();
  const bundleResponse = await bundled;
  expect(bundleResponse.status()).toBe(200);
  const bundle = await bundleResponse.json() as {body: string};
  expect(bundle.body).not.toContain('김가상');
  expect(bundle.body).not.toContain('010-0000-13');
  expect((JSON.parse(bundle.body) as {lead: {systemCode: string}}).lead.systemCode).toBe(board.leads[0].systemCode);
  expect((await bundleDownload).suggestedFilename()).toMatch(/^recruitment-evidence-ofd-lead-.+\.json$/);
  await expect(sheet.getByText('증빙 묶음을 내려받았습니다', {exact: false})).toBeVisible();
  await shot(page, testInfo, 'r6-3-evidence-bundle');
  await context.close();
});

test('결정 35 적격 판정: 리드 상세 판정·이력, 보드 필터·열, 성과 탭 코호트 적격 표', async ({browser}, testInfo) => {
  test.setTimeout(120_000);
  const owner = `e2e-fr-q-${testInfo.project.name}-${Date.now()}`;
  const {context, page} = await ownerPage(browser, testInfo, owner);
  await prepareFranchise(page, `가상 가맹 모집 적격 ${testInfo.project.name}`);

  // 준비(API): 적격 기준 버전 1, 가상 리드 2건.
  const criteria = await franchise(page, 'save_profile', {version: 1, profile: {branch: 'A', forecastInputs: {sme: true, storesAtFyEnd: 3, fiscalYearEnd: null}, holidays: null, storageLabels: [STORAGE_LABEL],
    eligibility: {budgetBands: ['100m_150m'], regions: ['서울 강남구'], timingBands: ['within_3m']}}});
  expect(criteria.status, JSON.stringify(criteria.body)).toBe(200);
  for (let i = 0; i < 2; i++) {
    const lead = await franchise(page, 'create_lead', {contact: {name: '이테스트', phone: `010-0000-14${String(i).padStart(2, '0')}`}, task: {region: '서울 강남구', budgetBand: '100m_150m', timingBand: 'within_3m', sourceChannel: 'walk_in'}, basis: {type: 'inquiry_response'}});
    expect(lead.status, JSON.stringify(lead.body)).toBe(200);
  }

  // 1) 리드 상세: 판정·사유를 골라 기록 → 현재 판정과 이력. 자유 문구 칸은 없다.
  await page.goto(`/?view=franchise&brand=${BRAND}`);
  const board = await (await page.request.get(`/api/franchise?view=board&brandId=${BRAND}`)).json() as {leads: {systemCode: string}[]};
  const target = board.leads[0].systemCode;
  await page.getByRole('button', {name: `리드 ${target} 열기`, exact: true}).click();
  const sheet = page.getByRole('dialog');
  const form = sheet.getByRole('form', {name: '적격 판정 기록'});
  await expect(form.getByRole('textbox')).toHaveCount(0);
  await form.getByRole('combobox', {name: '판정', exact: true}).selectOption('qualified');
  await form.getByRole('combobox', {name: '사유', exact: true}).selectOption('criteria_met');
  const judged = page.waitForResponse(franchiseAction('qualify_lead'));
  await form.getByRole('button', {name: '판정 기록 (기준 v1)', exact: true}).click();
  const judgedResponse = await judged;
  expect(judgedResponse.status(), JSON.stringify(await judgedResponse.json())).toBe(200);
  expect((judgedResponse.request().postDataJSON() as Record<string, unknown>)).toMatchObject({verdict: 'qualified', reason: 'criteria_met', criteriaVersion: 1});
  await expect(sheet.getByText('적격 판정을 기록했습니다.', {exact: false})).toBeVisible();
  await expect(sheet.getByText('적격 · 적격 기준 충족 · 기준 v1', {exact: true}).first()).toBeVisible();

  // 2) 판정을 보류로 바꾼다: 이전 판정은 이력에 남는다.
  await form.getByRole('combobox', {name: '판정', exact: true}).selectOption('hold');
  await form.getByRole('combobox', {name: '사유', exact: true}).selectOption('awaiting_reply');
  const changed = page.waitForResponse(franchiseAction('qualify_lead'));
  await form.getByRole('button', {name: '판정 기록 (기준 v1)', exact: true}).click();
  expect((await changed).status()).toBe(200);
  const history = sheet.getByRole('list', {name: '적격 판정 이력'});
  await expect(history.getByRole('listitem')).toHaveCount(2);
  await expect(history.getByRole('listitem').first()).toContainText('보류 · 답변 대기 · 기준 v1');
  await expect(history.getByRole('listitem').nth(1)).toContainText('적격 · 적격 기준 충족 · 기준 v1');
  await shot(page, testInfo, 'q-1-lead-judgment');
  await page.keyboard.press('Escape');
  await expect(sheet).toHaveCount(0);

  // 3) 보드: '적격 판정' 필터로 보류만, 판정 열에 '보류'.
  const filtered = page.waitForResponse(r => r.url().includes('/api/franchise?') && r.url().includes('qualification=hold'));
  await page.getByRole('combobox', {name: '적격 판정', exact: true}).selectOption('hold');
  expect((await filtered).status()).toBe(200);
  const rows = page.getByRole('table', {name: '가맹 리드 목록'}).getByRole('row');
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(1)).toContainText(target);
  await expect(rows.nth(1)).toContainText('보류');
  await shot(page, testInfo, 'q-2-board-filter');

  // 4) 성과 탭: 코호트 적격 표(작은 칸 억제, 적격 리드당 비용 칸).
  await page.goto(`/?view=franchise&brand=${BRAND}&tab=report`);
  const table = page.getByRole('table', {name: '코호트 적격 판정'});
  await expect(table).toContainText('적격 리드당 비용');
  await expect(table.getByRole('row').filter({hasText: koreaToday().slice(0, 7)})).toContainText('5건 미만');
  await shot(page, testInfo, 'q-3-report-cohort');
  await context.close();
});

test('R6d 워크스페이스 할 일: 미응대 문의 건수·면책이 다음 할 일에 보이고 가맹 리드 탭으로 간다', async ({browser}, testInfo) => {
  test.setTimeout(120_000);
  const owner = `e2e-fr-r6d-${testInfo.project.name}-${Date.now()}`;
  const {context, page} = await ownerPage(browser, testInfo, owner);
  await prepareFranchise(page, `가상 가맹 모집 R6d ${testInfo.project.name}`);
  // 준비(API): 첫 연락이 없는 가상 문의 2건.
  for (let i = 0; i < 2; i++) {
    const lead = await franchise(page, 'create_lead', {contact: {name: '김가상', phone: `010-0000-14${String(i).padStart(2, '0')}`}, task: {region: '', budgetBand: 'unknown', timingBand: 'unknown', sourceChannel: 'walk_in'}, basis: {type: 'inquiry_response'}});
    expect(lead.status, JSON.stringify(lead.body)).toBe(200);
  }
  // 실제 응답(real): 가맹 할 일은 브랜드 id·건수만 있다.
  const workspace = await (await page.request.get('/api/workspace')).json() as {connection: Record<string, unknown>; franchiseTasks?: {items: {task: string; count: number; brandId: string}[]; disclaimer: string}};
  expect(workspace.franchiseTasks?.items).toEqual([{task: 'unanswered', count: 2, brandId: BRAND}]);
  expect(workspace.franchiseTasks?.disclaimer).toBe('COLLECTIVE 휴리스틱 · 법률 자문 아님');
  expect(JSON.stringify(workspace.franchiseTasks)).not.toContain('김가상');
  // 연결 상태만 참으로 바꾼 같은 응답을 돌려준다(docs/E2E.ko.md 가로채기 규칙: 미리 받은 응답을 fulfill).
  await page.route('**/api/workspace', route => route.fulfill({json: {...workspace, connection: {...workspace.connection, configured: true}}}));
  await page.goto('/');
  const next = page.locator('section.next-tasks');
  const item = next.locator('[data-franchise-task="unanswered"]');
  await expect(item).toContainText('미응대 문의');
  await expect(item).toContainText('첫 연락 기록이 없는 문의 2건');
  await expect(item).toContainText('COLLECTIVE 휴리스틱 · 법률 자문 아님');
  await expect(next).not.toContainText('김가상');
  await expect(next).not.toContainText('010-0000-14');
  await shot(page, testInfo, 'r6d-1-next-tasks');
  await item.click();
  await expect(page).toHaveURL(/view=franchise/);
  await expect(page).toHaveURL(/tab=leads/);
  await expect(page).toHaveURL(new RegExp(`brand=${BRAND}`));
  await expect(page.getByRole('tab', {name: '리드', exact: true})).toHaveAttribute('aria-selected', 'true');
  await shot(page, testInfo, 'r6d-2-franchise-leads');
  await context.close();
});

// 준비(API): 같은 유형(포털 소개문)의 승인 자료 판. 체크리스트와 대기기간 확인(결정 34)을 함께 보낸다.
async function approvedAsset(page: Page, campaignId: string, body: string) {
  const saved = await franchise(page, 'asset_save', {campaignId, type: 'portal_intro', body, factRefs: []});
  expect(saved.status, JSON.stringify(saved.body)).toBe(200);
  const asset = saved.body.result as {assetId: string; version: number; bodyHash: string};
  const view = await (await page.request.get(`/api/franchise?view=asset&brandId=${BRAND}&assetId=${asset.assetId}`)).json() as {checklist: {version: string; items: {id: string}[]}; waitReview: {version: string; candidates: unknown[]}};
  const approved = await franchise(page, 'asset_approve', {assetId: asset.assetId, version: asset.version, bodyHash: asset.bodyHash, checklist: {version: view.checklist.version, checked: view.checklist.items.map(i => i.id)},
    waitReview: {version: view.waitReview.version, confirmed: true, candidates: view.waitReview.candidates.length}});
  expect(approved.status, JSON.stringify(approved.body)).toBe(200);
  return asset;
}

test('R6d-2 소재 실험 선별: 문구가 먼저, 계획 → 결과(viral-stats 판정·중간 확인 경고) → 확인 층 표본 부족 → 취소', async ({browser}, testInfo) => {
  test.setTimeout(120_000);
  const owner = `e2e-fr-r6d2-${testInfo.project.name}-${Date.now()}`;
  const {context, page} = await ownerPage(browser, testInfo, owner);
  const campaignId = await prepareFranchise(page, `가상 가맹 모집 R6d-2 ${testInfo.project.name}`);
  await approvedAsset(page, campaignId, '가상 브랜드 가맹 상담을 받습니다.');
  await approvedAsset(page, campaignId, '가상 브랜드 가맹 상담을 지금 받습니다.');
  const today = koreaToday();

  // 1) 유입·비용 탭의 소재 실험 선별: '플랫폼 보고, 원장 리드 아님'이 첫 줄이다.
  await page.goto(`/?view=franchise&brand=${BRAND}&tab=inflow`);
  const notes = page.getByRole('list', {name: '소재 실험 읽는 법'});
  await expect(notes.getByRole('listitem').first()).toContainText('플랫폼 보고, 원장 리드 아님');
  // 2) 계획: 오늘 시작(시작 전 기록), 최소 관찰 24시간.
  const form = page.getByRole('form', {name: '소재 실험 계획'});
  await form.getByLabel('바꾼 변수', {exact: true}).fill('상담 문장의 "지금"');
  await form.getByLabel('가설', {exact: true}).fill('즉시성을 더하면 클릭률이 오른다');
  await form.getByLabel('최소 관찰 시간(시간)', {exact: true}).fill('24');
  await form.getByLabel('기간 시작', {exact: true}).fill(today);
  const planned = page.waitForResponse(franchiseAction('experiment_plan'));
  await form.getByRole('button', {name: '실험 계획 적기', exact: true}).click();
  expect((await planned).status()).toBe(200);
  const card = page.getByRole('article', {name: '소재 실험 상담 문장의 "지금"'});
  await expect(card).toContainText('계획됨');
  await shot(page, testInfo, 'r6d2-1-planned');

  // 3) 결과: 플랫폼 보고 수치 입력 → 판정·권고와 중간 확인 경고(관찰 시간이 아직 지나지 않음).
  const result = card.getByRole('form', {name: '소재 실험 결과 입력'});
  await result.getByLabel('대조안 노출', {exact: true}).fill('5000');
  await result.getByLabel('대조안 클릭', {exact: true}).fill('100');
  await result.getByLabel('실험안 노출', {exact: true}).fill('5000');
  await result.getByLabel('실험안 클릭', {exact: true}).fill('150');
  await result.getByRole('checkbox', {name: /비교 가능합니다/}).check();
  const entered = page.waitForResponse(franchiseAction('experiment_result'));
  await result.getByRole('button', {name: '결과 입력', exact: true}).click();
  expect((await entered).status()).toBe(200);
  const latest = card.getByLabel('최근 결과');
  await expect(latest).toContainText('플랫폼 보고, 원장 리드 아님');
  await expect(latest).toContainText('관찰상 개선');
  await expect(latest).toContainText('중간 확인 경고');
  await expect(card.getByRole('table', {name: '확인 층(원장)'})).toContainText('표본 부족(n<20)');
  await shot(page, testInfo, 'r6d2-2-result');

  // 4) 취소: 확인 대화 → 취소됨.
  page.once('dialog', dialog => void dialog.accept());
  const cancelled = page.waitForResponse(franchiseAction('experiment_cancel'));
  await card.getByRole('button', {name: '실험 취소', exact: true}).click();
  expect((await cancelled).status()).toBe(200);
  await expect(card).toContainText('취소됨');
  await context.close();
});

test('R7a 공공 벤치마크: 고정 문구가 먼저, 키 없음 막힘(외부 호출 0) → 가상 키 저장 → 적재 버튼 열림 → 키 지우기', async ({browser}, testInfo) => {
  test.setTimeout(120_000);
  const owner = `e2e-fr-r7a-${testInfo.project.name}-${Date.now()}`;
  const {context, page} = await ownerPage(browser, testInfo, owner);
  await prepareFranchise(page, `가상 가맹 모집 R7a ${testInfo.project.name}`);
  // 외부(공공데이터포털) 호출은 하지 않는다: 화면의 적재 버튼은 누르지 않고, API 적재는 키가 없을 때만 보낸다(409, 외부 호출 0).
  const noKey = await franchise(page, 'benchmark_load', {year: 2025, brands: ['가상도넛'], industry: ''});
  expect(noKey.status).toBe(409);

  // 1) 벤치마크 탭: 고정 문구와 면책, 키 없음 막힘, 적재 버튼 잠김.
  await page.goto(`/?view=franchise&brand=${BRAND}&tab=benchmark`);
  await expect(page.getByText('타 브랜드 공개 수치. 자사 예상매출 근거가 아님', {exact: true})).toBeVisible();
  await expect(page.getByRole('status').filter({hasText: '외부 호출 0'})).toBeVisible();
  await expect(page.getByText('저장 안 됨', {exact: true})).toBeVisible();
  await expect(page.getByRole('button', {name: '적재', exact: true})).toBeDisabled();
  await shot(page, testInfo, 'r7a-1-no-key');

  // 2) 가상 키(테스트 전용 합성 값, 실제 공공데이터 키 아님)를 저장하면 저장됨으로 바뀌고 적재 버튼이 열린다. 키는 화면에 다시 보이지 않는다.
  const syntheticKey = 'E2eSyntheticKeyNotReal0000000000';
  await page.getByLabel('공공데이터 일반 인증키', {exact: true}).fill(syntheticKey);
  const saved = page.waitForResponse(franchiseAction('benchmark_key_save'));
  await page.getByRole('button', {name: '키 저장', exact: true}).click();
  expect((await saved).status()).toBe(200);
  await expect(page.getByText(/^저장됨/)).toBeVisible();
  await expect(page.getByRole('button', {name: '적재', exact: true})).toBeEnabled();
  expect(await page.content()).not.toContain(syntheticKey);
  await shot(page, testInfo, 'r7a-2-key-saved');

  // 3) 키 지우기: 확인 대화 → 저장 안 됨, 적재 버튼 다시 잠김.
  page.once('dialog', dialog => void dialog.accept());
  const cleared = page.waitForResponse(franchiseAction('benchmark_key_clear'));
  await page.getByRole('button', {name: '키 지우기', exact: true}).click();
  expect((await cleared).status()).toBe(200);
  await expect(page.getByText('저장 안 됨', {exact: true})).toBeVisible();
  await expect(page.getByRole('button', {name: '적재', exact: true})).toBeDisabled();
  await context.close();
});

// 8) R15b-2 모집 카드 묶음: 템플릿 넣기 → 카드 4장 원문 저장(게이트 200) → 승인 → 대기기간 확인 뒤 'PNG 내려받기'가 규격별로 카드 수만큼 PNG를 내려받는다.
//    PNG는 서명·IHDR 크기(1080×1350, 1080×1920)를 본다. 브라우저 BarcodeDetector가 있으면 QR 카드를 읽어 링크가 원문과 같은지도 본다(없으면 건너뛴 사실을 주석으로 남긴다).
//    쓸 수 없는 코드(발급하지 않은 코드)의 카드 묶음은 승인이 400 card_qr_invalid다.
const pngSize = (bytes: Buffer) => ({signature: bytes.subarray(0, 8).toString('hex'), width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20)});
test('R15b-2 모집 카드 묶음: 템플릿 → 승인 → PNG 내려받기(두 규격), 쓸 수 없는 코드 400', async ({browser}, testInfo) => {
  test.setTimeout(150_000);
  const owner = `e2e-fr-r15b-${testInfo.project.name}-${Date.now()}`;
  const {context, page} = await ownerPage(browser, testInfo, owner);
  const campaignId = await prepareFranchise(page, `가상 가맹 모집 R15b ${testInfo.project.name}`);
  const issued = await franchise(page, 'code_issue', {channel: 'expo', label: '가상 박람회 카드'});
  expect(issued.status, JSON.stringify(issued.body)).toBe(200);
  const code = (issued.body.result as {code: string}).code;
  const link = `https://ofd.example.kr/franchise?utm_content=${code}`;
  const cardBody = ['■ 1장 [의견]', '매장에서 매일 굽는 우유 도넛 브랜드입니다.', '', '■ 2장', '가맹 절차와 지원 내용은 상담에서 서면으로 안내합니다.', '', '■ 3장', '정보공개서를 먼저 받고 충분히 검토하세요.', '', '■ 4장', '가맹 문의', `QR ${link}`].join('\n');

  // 1) 모집 자료 탭: 유형 '모집 카드 묶음(PNG)'을 고르면 안내 문구가 보이고, 템플릿 넣기로 카드 4장 뼈대가 들어간다.
  await page.goto(`/?view=franchise&brand=${BRAND}&tab=assets`);
  await page.getByRole('button', {name: '새 모집 자료', exact: true}).click();
  const sheet = page.getByRole('dialog');
  await sheet.getByRole('combobox', {name: /모집 캠페인/}).selectOption(campaignId);
  await sheet.getByRole('combobox', {name: '자료 유형', exact: true}).selectOption('card_bundle');
  await expect(sheet.getByText(/카드 묶음: '■ 1장'부터 차례로 3~5장/)).toBeVisible();
  const bodyBox = sheet.getByRole('textbox', {name: '원문', exact: true});
  await expect(bodyBox).toHaveValue(/■ 4장\n가맹 문의\nQR https:\/\//);
  await shot(page, testInfo, 'r15b-1-template');

  // 2) 원문을 채워 저장하면 v1 초안이 되고, 게이트는 막는 사유가 없다.
  await bodyBox.fill(cardBody);
  const saved = page.waitForResponse(franchiseAction('asset_save'));
  await sheet.getByRole('button', {name: '초안 저장', exact: true}).click();
  const savedResponse = await saved;
  expect(savedResponse.status()).toBe(200);
  const asset = (await savedResponse.json() as {result: {assetId: string; version: number; bodyHash: string}}).result;
  await expect(sheet.getByText('v1 초안을 저장했습니다.', {exact: true})).toBeVisible();
  await expect(sheet.getByText('현재 사실 기준으로 막는 사유가 없습니다.', {exact: true})).toBeVisible();

  // 3) 승인(API, 승인 화면 자체는 #186 여정이 본다).
  const view = await (await page.request.get(`/api/franchise?view=asset&brandId=${BRAND}&assetId=${asset.assetId}`)).json() as {waitReview: {version: string; candidates: unknown[]}; checklist: {version: string; items: {id: string}[]}};
  const checklistInput = {version: view.checklist.version, checked: view.checklist.items.map(i => i.id)};
  const approved = await franchise(page, 'asset_approve', {assetId: asset.assetId, version: asset.version, bodyHash: asset.bodyHash, checklist: checklistInput,
    waitReview: {version: view.waitReview.version, confirmed: true, candidates: view.waitReview.candidates.length}});
  expect(approved.status, JSON.stringify(approved.body)).toBe(200);
  await page.reload();
  await page.getByRole('button', {name: /모집 카드 묶음\(PNG\) v1 열기/}).click();

  // 4) 확인란 전에는 PNG 버튼이 잠기고, 확인 뒤 피드 규격 PNG 4장을 내려받는다.
  const feedButton = sheet.getByRole('button', {name: 'PNG 내려받기(1080×1350 피드)', exact: true});
  const storyButton = sheet.getByRole('button', {name: 'PNG 내려받기(1080×1920 스토리)', exact: true});
  await expect(feedButton).toBeDisabled();
  await sheet.getByRole('checkbox', {name: /문장 \d+개를 읽었고/}).check();
  await expect(feedButton).toBeEnabled();
  const downloads: Download[] = [];
  page.on('download', d => downloads.push(d));
  const exported = page.waitForResponse(franchiseAction('asset_export'));
  await feedButton.click();
  expect((await exported).status()).toBe(200);
  await expect(sheet.getByText('PNG 4장(1080×1350 피드)을 내려받았습니다. 내보내기 기록 1건을 남겼습니다.', {exact: true})).toBeVisible();
  await expect.poll(() => downloads.length).toBe(4);
  const feed = await Promise.all(downloads.map(async d => ({name: d.suggestedFilename(), bytes: readFileSync(await d.path())})));
  expect(feed.map(x => x.name)).toEqual([1, 2, 3, 4].map(i => `${asset.assetId}-v1-feed-${i}.png`));
  for (const x of feed) expect(pngSize(x.bytes)).toEqual({signature: '89504e470d0a1a0a', width: 1080, height: 1350});
  feed.forEach((x, i) => writeFileSync(`e2e/artifacts/franchise-r15b-card-${i + 1}-${testInfo.project.name}.png`, x.bytes));
  await shot(page, testInfo, 'r15b-2-feed');

  // 5) 스토리 규격도 4장, 1080×1920.
  downloads.length = 0;
  const exported2 = page.waitForResponse(franchiseAction('asset_export'));
  await storyButton.click();
  expect((await exported2).status()).toBe(200);
  await expect.poll(() => downloads.length).toBe(4);
  for (const d of downloads) expect(pngSize(readFileSync(await d.path()))).toEqual({signature: '89504e470d0a1a0a', width: 1080, height: 1920});
  await expect(sheet.getByText('내보내기 2회', {exact: true})).toBeVisible();

  // 6) QR 카드(4장)를 브라우저 판독기로 읽는다(있을 때만).
  const decoded = await page.evaluate(async b64 => {
    const Detector = (globalThis as unknown as {BarcodeDetector?: new (o: {formats: string[]}) => {detect: (s: ImageBitmap) => Promise<{rawValue: string}[]>}}).BarcodeDetector;
    if (!Detector) return null;
    const blob = await (await fetch(`data:image/png;base64,${b64}`)).blob();
    const found = await new Detector({formats: ['qr_code']}).detect(await createImageBitmap(blob));
    return found.map(x => x.rawValue);
  }, feed[3].bytes.toString('base64'));
  if (decoded === null) testInfo.annotations.push({type: 'not_run', description: 'BarcodeDetector 없음: QR 판독은 PR 작성 때 OpenCV로 따로 확인'});
  else expect(decoded).toEqual([link]);

  // 7) 발급하지 않은 코드의 카드 묶음은 승인이 400 card_qr_invalid다.
  const bad = await franchise(page, 'asset_save', {campaignId, type: 'card_bundle', factRefs: [], body: cardBody.replace(code, 'RZZZZZZZ')});
  expect(bad.status, JSON.stringify(bad.body)).toBe(200);
  const badAsset = bad.body.result as {assetId: string; version: number; bodyHash: string};
  const badView = await (await page.request.get(`/api/franchise?view=asset&brandId=${BRAND}&assetId=${badAsset.assetId}`)).json() as {waitReview: {version: string; candidates: unknown[]}};
  const refused = await franchise(page, 'asset_approve', {assetId: badAsset.assetId, version: badAsset.version, bodyHash: badAsset.bodyHash, checklist: checklistInput,
    waitReview: {version: badView.waitReview.version, confirmed: true, candidates: badView.waitReview.candidates.length}});
  expect(refused.status).toBe(400);
  expect(reasonCodes(refused.body)).toEqual(['card_qr_invalid']);
  await context.close();
});
// 9) R9a 너처링: '너처링' 탭 첫 줄이 '앱은 보내지 않음', HERMES 연결이 없으면 AI 초안은 409 안내(모의 연결 없음), 정보성 템플릿 저장 → 리드 상세에서 정보 요청 기록 → 템플릿으로 보낸 뒤 기록 → 같은 요청은 다시 고를 수 없음.
//    광고성 템플릿은 저장되지만 리드 상세의 발송 기록 선택지에서 막혀 있다(R9b 전). 앱의 외부 발송은 없다(요청은 /api/franchise뿐).
test('R9a 너처링: 템플릿 저장 → 정보 요청 → 보낸 뒤 기록(요청당 1회), 광고성 기록 막힘', async ({browser}, testInfo) => {
  test.setTimeout(120_000);
  const owner = `e2e-fr-r9a-${testInfo.project.name}-${Date.now()}`;
  const {context, page} = await ownerPage(browser, testInfo, owner);
  await prepareFranchise(page, `가상 가맹 모집 R9a ${testInfo.project.name}`);
  const lead = await franchise(page, 'create_lead', {contact: {name: '김가상', phone: '010-0000-1501'}, task: {region: '', budgetBand: 'unknown', timingBand: 'unknown', sourceChannel: 'walk_in'}, basis: {type: 'inquiry_response'}});
  expect(lead.status, JSON.stringify(lead.body)).toBe(200);
  const outbound: string[] = [];
  page.on('request', r => {if (!r.url().includes('127.0.0.1') && !r.url().includes('localhost')) outbound.push(r.url())});

  // 1) 너처링 탭: 첫 줄 안내, AI 초안은 HERMES 연결이 없어 409 안내.
  await page.goto(`/?view=franchise&brand=${BRAND}&tab=nurture`);
  await expect(page.getByText('앱은 메시지를 보내지 않습니다.', {exact: false}).first()).toBeVisible();
  await page.getByRole('combobox', {name: '너처링 목적', exact: true}).selectOption('process_guide');
  await page.getByRole('combobox', {name: '너처링 매체', exact: true}).selectOption('email');
  const drafted = page.waitForResponse(franchiseAction('nurture_draft_start'));
  await page.getByRole('button', {name: 'AI 초안 만들기', exact: true}).click();
  expect((await drafted).status()).toBe(409);
  await expect(page.getByText(/HERMES/).first()).toBeVisible();

  // 2) 정보성 템플릿을 직접 써서 저장한다.
  await page.getByRole('textbox', {name: '템플릿 제목', exact: true}).fill('{브랜드} 가맹 절차 안내');
  await page.getByRole('textbox', {name: '템플릿 본문', exact: true}).fill('{이름}님, 요청하신 가맹 절차를 안내합니다.\n정보공개서를 먼저 받고 충분히 검토하신 뒤 상담해 주세요.\n문의: {담당자} {문의처}');
  const saved = page.waitForResponse(franchiseAction('nurture_template_save'));
  await page.getByRole('button', {name: '템플릿 저장', exact: true}).click();
  expect((await saved).status()).toBe(200);
  await expect(page.getByText('템플릿을 저장했습니다(v1).', {exact: true})).toBeVisible();
  await expect(page.getByRole('list', {name: '너처링 템플릿 목록'}).getByRole('listitem')).toHaveCount(1);

  // 3) 광고성 템플릿(고정 요소 포함, 문자)도 저장한다.
  await page.getByRole('combobox', {name: '너처링 목적', exact: true}).selectOption('briefing_invite');
  await page.getByRole('combobox', {name: '너처링 매체', exact: true}).selectOption('sms');
  await page.getByRole('textbox', {name: '템플릿 본문', exact: true}).fill('(광고) {브랜드}\n{이름}님, 이번 달 창업 설명회에 초대합니다.\n무료 수신거부: {수신거부}');
  const savedAd = page.waitForResponse(franchiseAction('nurture_template_save'));
  await page.getByRole('button', {name: '템플릿 저장', exact: true}).click();
  expect((await savedAd).status()).toBe(200);
  await expect(page.getByRole('list', {name: '너처링 템플릿 목록'}).getByRole('listitem')).toHaveCount(2);
  await shot(page, testInfo, 'r9a-1-templates');

  // 4) 리드 상세: 정보 요청 기록 → 보낸 템플릿·요청을 골라 기록. 광고성 템플릿 선택지는 막혀 있다.
  await page.goto(`/?view=franchise&brand=${BRAND}`);
  const board = await (await page.request.get(`/api/franchise?view=board&brandId=${BRAND}`)).json() as {leads: {systemCode: string}[]};
  await page.getByRole('button', {name: `리드 ${board.leads[0].systemCode} 열기`, exact: true}).click();
  const sheet = page.getByRole('dialog');
  const requestForm = sheet.getByRole('form', {name: '정보 요청 기록'});
  await requestForm.getByRole('combobox', {name: '요청한 정보', exact: true}).selectOption('process_guide');
  const requested = page.waitForResponse(franchiseAction('add_info_request'));
  await requestForm.getByRole('button', {name: '정보 요청 기록', exact: true}).click();
  expect((await requested).status()).toBe(200);
  await expect(sheet.getByText('정보 요청을 기록했습니다.', {exact: false})).toBeVisible();
  const logForm = sheet.getByRole('form', {name: '발송 기록'});
  const templateSelect = logForm.getByRole('combobox', {name: '보낸 템플릿', exact: true});
  await expect(templateSelect.locator('option', {hasText: '광고성: R9b 전 기록 불가'})).toBeDisabled();
  await templateSelect.selectOption({label: '가맹 절차 안내 · 이메일 · v1'});
  const requestSelect = logForm.getByRole('combobox', {name: '답한 정보 요청', exact: true});
  await requestSelect.selectOption({index: 1});
  const logged = page.waitForResponse(franchiseAction('log_lead_message'));
  await logForm.getByRole('button', {name: '보낸 뒤 기록', exact: true}).click();
  const loggedResponse = await logged;
  expect(loggedResponse.status()).toBe(200);
  expect(loggedResponse.request().postDataJSON() as Record<string, unknown>).toMatchObject({medium: 'email', templateVersion: 1});
  await expect(sheet.getByText('발송 기록을 남겼습니다.', {exact: false})).toBeVisible();
  await expect(sheet.getByRole('list', {name: '발송 기록'}).getByRole('listitem')).toHaveCount(1);
  // 5) 답한 요청은 다시 고를 수 없다(요청당 1회).
  await expect(logForm.getByRole('combobox', {name: '답한 정보 요청', exact: true}).locator('option')).toHaveCount(1);
  await shot(page, testInfo, 'r9a-2-logged');
  expect(outbound).toEqual([]);
  await context.close();
});

// 10) R15b-3 인터뷰 영상 완성본: 승인된 15초 대본 판에서 파일을 고르면 브라우저가 SHA-256만 계산해 기록한다(파일은 올리지 않음, 요청 본문에 해시·크기·촬영일·라벨만).
test('R15b-3 인터뷰 영상 완성본: 파일을 올리지 않고 SHA-256만 기록', async ({browser}, testInfo) => {
  test.setTimeout(120_000);
  const owner = `e2e-fr-r15b3-${testInfo.project.name}-${Date.now()}`;
  const {context, page} = await ownerPage(browser, testInfo, owner);
  const campaignId = await prepareFranchise(page, `가상 가맹 모집 R15b-3 ${testInfo.project.name}`);
  const script = '[인터뷰] 매일 아침 반죽을 직접 치댑니다. 손님이 웃을 때 가장 보람을 느낍니다.';
  const saved = await franchise(page, 'asset_save', {campaignId, type: 'interview_video', factRefs: [], body: script});
  expect(saved.status, JSON.stringify(saved.body)).toBe(200);
  const asset = saved.body.result as {assetId: string; version: number; bodyHash: string};
  const view = await (await page.request.get(`/api/franchise?view=asset&brandId=${BRAND}&assetId=${asset.assetId}`)).json() as {waitReview: {version: string; candidates: unknown[]}; checklist: {version: string; items: {id: string}[]}};
  const approved = await franchise(page, 'asset_approve', {assetId: asset.assetId, version: 1, bodyHash: asset.bodyHash, checklist: {version: view.checklist.version, checked: view.checklist.items.map(i => i.id)},
    waitReview: {version: view.waitReview.version, confirmed: true, candidates: view.waitReview.candidates.length}});
  expect(approved.status, JSON.stringify(approved.body)).toBe(200);

  await page.goto(`/?view=franchise&brand=${BRAND}&tab=assets`);
  await page.getByRole('button', {name: /인터뷰 영상 대본\(15초\)·완성본 v1 열기/}).click();
  const sheet = page.getByRole('dialog');
  const form = sheet.getByRole('form', {name: '완성본 해시 기록'});
  const video = Buffer.from('가상 인터뷰 영상 바이트 e2e');
  await form.getByLabel('완성본 파일').setInputFiles({name: 'interview-final.mp4', mimeType: 'video/mp4', buffer: video});
  await form.getByPlaceholder('예: 대표 인터뷰 15초 최종본').fill('대표 인터뷰 15초 최종본');
  const recorded = page.waitForResponse(franchiseAction('asset_media'));
  await form.getByRole('button', {name: '해시 기록', exact: true}).click();
  const response = await recorded;
  expect(response.status()).toBe(200);
  const sent = response.request().postDataJSON() as Record<string, unknown>;
  const expected = createHash('sha256').update(video).digest('hex');
  expect(sent).toMatchObject({sha256: expected, bytes: video.length, label: '대표 인터뷰 15초 최종본'});
  expect(Object.keys(sent).sort()).toEqual(['action', 'assetId', 'brandId', 'bytes', 'filmedOn', 'label', 'requestId', 'sha256', 'version']);
  await expect(sheet.getByRole('list', {name: '완성본 해시 기록'}).getByRole('listitem')).toHaveCount(1);
  await expect(sheet.getByText(`SHA-256 ${expected.slice(0, 16)}…`, {exact: false})).toBeVisible();
  await shot(page, testInfo, 'r15b3-media');
  await context.close();
});
