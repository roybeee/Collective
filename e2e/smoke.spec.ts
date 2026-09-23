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
  const mobile = !(await nav.isVisible());
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
