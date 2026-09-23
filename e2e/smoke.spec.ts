// 로컬 빌드(wrangler --local, 실제 D1/R2 시뮬레이터)에 대한 스모크 여정.
// 운영에서는 Sites 디스패처가 로그인한 사용자의 oai-authenticated-user-id 헤더를 붙인다.
// 로컬에는 그 디스패처가 없으므로 이 헤더를 직접 붙여 "로그인한 소유자"를 재현한다(mocked auth).
// 앱 코드의 인증 경로는 건드리지 않는다. 헤더가 없으면 운영과 같이 401이 나야 한다.
import {test, expect, type Browser, type Page, type TestInfo} from '@playwright/test';

const IDENTITY_HEADER = 'oai-authenticated-user-id';

// 스크린샷은 커밋하지 않는다(e2e/artifacts/는 .gitignore 대상).
function shot(page: Page, testInfo: TestInfo, name: string) {
  return page.screenshot({path: `e2e/artifacts/${testInfo.project.name}-${name}.png`, fullPage: true});
}

// browser.newContext()는 프로젝트의 use 설정을 물려받지 않으므로 주소와 화면 크기를 직접 넘긴다.
async function ownerPage(browser: Browser, testInfo: TestInfo, owner: string) {
  const {baseURL, viewport} = testInfo.project.use;
  const context = await browser.newContext({baseURL, viewport, extraHTTPHeaders: {[IDENTITY_HEADER]: owner}});
  return {context, page: await context.newPage()};
}

// 좁은 화면에서는 사이드바가 시트로 접혀 있어 트리거로 연다. 메뉴를 눌러도 시트가
// 스스로 닫히지 않으므로(2026-09-23 관측) Escape로 닫는다.
async function openBrands(page: Page) {
  const nav = page.getByRole('button', {name: '브랜드 아카이브', exact: true});
  const mobile = (page.viewportSize()?.width ?? 1280) < 768;
  if (mobile) await page.locator('[data-sidebar="trigger"]').first().click();
  await nav.click();
  if (mobile) await page.keyboard.press('Escape');
  await expect(page.getByRole('heading', {level: 1, name: '브랜드 아카이브'})).toBeVisible();
}

test('등록한 브랜드는 새로고침 뒤에도 남고 다른 소유자에게는 보이지 않는다', async ({browser}, testInfo) => {
  const owner = `e2e-${testInfo.project.name}-${Date.now()}`;
  const brandName = `E2E 브랜드 ${testInfo.project.name} ${Date.now()}`;
  const {context, page} = await ownerPage(browser, testInfo, owner);

  await page.goto('/');
  await openBrands(page);
  await page.getByRole('button', {name: '브랜드 등록'}).first().click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('브랜드 이름').fill(brandName);
  await dialog.getByLabel('업종').fill('베이커리');
  const created = page.waitForResponse(r => r.url().endsWith('/api/archive') && r.request().method() === 'POST');
  await dialog.getByRole('button', {name: '브랜드 등록'}).click();
  const response = await created;
  expect(response.status()).toBe(200);
  const {id: brandId} = await response.json() as {id: string};
  await expect(dialog).toBeHidden();
  await shot(page, testInfo, 'created');

  await page.reload();
  await openBrands(page);
  await expect(page.getByRole('heading', {level: 2, name: brandName})).toBeVisible();
  await shot(page, testInfo, 'after-reload');

  const other = await ownerPage(browser, testInfo, `${owner}-other`);
  await other.page.goto('/');
  await openBrands(other.page);
  await expect(other.page.getByRole('heading', {level: 2, name: brandName})).toHaveCount(0);
  const foreign = await other.page.request.get(`/api/archive?brandId=${encodeURIComponent(brandId)}`);
  expect(foreign.status()).toBe(404);

  await other.context.close();
  await context.close();
});

test('로그인 헤더가 없으면 워크스페이스를 불러오지 않는다', async ({page}, testInfo) => {
  await page.goto('/');
  await expect(page.getByRole('alert')).toContainText('로그인이 필요합니다');
  expect((await page.request.get('/api/workspace')).status()).toBe(401);
  await shot(page, testInfo, 'unauthenticated');
});

test('이전 작업물 원문을 비교하고 미확인 비용을 그대로 저장한다', async ({browser}, testInfo) => {
  test.setTimeout(30_000);
  const owner = `e2e-history-${testInfo.project.name}-${Date.now()}`;
  const {context, page} = await ownerPage(browser, testInfo, owner);
  await page.request.get('/api/workspace');
  const title = `버전 검증 ${testInfo.project.name}`;
  const create = await page.request.post('/api/action', {data: {action: 'save_campaign', data: {brandId: 'ofd', title, goal: '저장된 원문과 비용 미확인 보존', budget: 0}}});
  expect(create.status()).toBe(200);
  const {id} = await create.json();
  const first = await page.request.post('/api/action', {data: {action: 'save_artifact', campaignId: id, role: 'cmo', title: '검증 작업물', content: '이전 원문: 할인 없이 방문 이유를 제안한다.'}});
  expect(first.status()).toBe(200);
  const artifact = await first.json();
  const changed = await page.request.post('/api/action', {data: {action: 'save_artifact', id: artifact.id, campaignId: id, version: 1, role: 'cmo', title: '검증 작업물', content: '현재 원문: 오후 방문 동기를 실험한다.'}});
  expect(changed.status()).toBe(200);
  await page.goto('/');
  await page.getByRole('button', {name: title + ' 열기', exact: true}).click();
  await page.getByRole('tab', {name: '이력', exact: true}).click();
  await expect(page.getByText('이전 원문: 할인 없이 방문 이유를 제안한다.', {exact: true})).toBeVisible();
  await expect(page.getByText('현재 원문: 오후 방문 동기를 실험한다.', {exact: true})).toBeVisible();
  await shot(page, testInfo, 'version-comparison');
  await page.getByRole('tab', {name: '성과', exact: true}).click();
  await page.getByRole('button', {name: '성과 입력', exact: true}).click();
  const dialog = page.getByRole('dialog').last();
  await dialog.getByLabel('측정 시작일').fill('2026-09-01');
  await dialog.getByLabel('측정 종료일').fill('2026-09-02');
  await dialog.getByLabel('비교 범위 (매장·계정·대상)').fill('테스트 매장');
  await dialog.getByLabel('자료 출처').fill('E2E 검증용 장부');
  await dialog.getByLabel('집계 정의 (시간대·환불·부가세·고객군)').fill('KST, 환불 차감 순매출');
  await dialog.getByLabel('순매출 (원)', {exact: true}).fill('100000');
  await dialog.getByLabel('주문 수', {exact: true}).fill('10');
  await dialog.getByRole('button', {name: '성과 저장', exact: true}).click();
  await expect(page.getByRole('heading', {name: '실제 성과 입력', exact: true})).toHaveCount(0);
  await expect(page.getByText('출처: E2E 검증용 장부', {exact: false})).toBeVisible();
  const detail = await (await page.request.get('/api/campaigns/' + id)).json();
  expect(detail.metrics[0].variableCosts).toBeNull();
  expect(detail.metrics[0].adSpend).toBeNull();
  await page.getByRole('button', {name: '기록 수정', exact: true}).click();
  const edit = page.getByRole('dialog').last();
  await edit.getByLabel('측정 방법과 메모').fill('내 편집 내용을 보존');
  const concurrent = await page.request.post('/api/action', {data: {...detail.metrics[0], action: 'save_metric', notes: '다른 창에서 수정'}});
  expect(concurrent.status()).toBe(200);
  await edit.getByRole('button', {name: '성과 저장', exact: true}).click();
  await expect(edit.getByRole('alert')).toContainText('성과가 변경됐습니다');
  await expect(edit.getByLabel('측정 방법과 메모')).toHaveValue('내 편집 내용을 보존');
  await page.keyboard.press('Escape');
  await shot(page, testInfo, 'unknown-cost');
  await context.close();
});

test('사용량 단가 설정을 저장하고 API 기록을 확인한다', async ({browser}, testInfo) => {
  test.setTimeout(30_000);
  const {context, page} = await ownerPage(browser, testInfo, `e2e-usage-${testInfo.project.name}-${Date.now()}`);
  await page.goto('/');
  const nav = page.getByRole('button', {name: '연결 및 설정', exact: true});
  const mobile = (page.viewportSize()?.width ?? 1280) < 768;
  if (mobile) await page.locator('[data-sidebar="trigger"]').first().click();
  await nav.click();
  if (mobile) await page.keyboard.press('Escape');
  await expect(page.getByRole('heading', {name: 'AI 사용량과 비용', exact: true})).toBeVisible();
  await page.getByText('모델별 단가 설정', {exact: true}).click();
  await page.getByLabel('실제 모델 ID', {exact: true}).fill('e2e-test-model');
  await page.getByLabel('단가 버전', {exact: true}).fill('fixture-v1');
  await page.getByLabel('입력 단가 · 백만 토큰당', {exact: true}).fill('1');
  await page.getByLabel('출력 단가 · 백만 토큰당', {exact: true}).fill('2');
  await page.getByLabel('단가 출처 · HTTPS 주소', {exact: true}).fill('https://example.com/test-pricing');
  await page.getByRole('button', {name: '이 단가 저장', exact: true}).click();
  await expect(page.getByRole('status').filter({hasText: '단가를 저장했습니다'})).toBeVisible();
  const saved = await (await page.request.get('/api/usage')).json();
  expect(saved.pricing[0].priceVersion).toBe('fixture-v1');
  expect(saved.entries).toHaveLength(0);
  await shot(page, testInfo, 'usage-pricing');
  await context.close();
});
