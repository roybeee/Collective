// 주소(?view=&campaign=&brand=&store=)로 화면을 복원하는 여정과, 워크스페이스를 불러오지 못했을 때 거짓 빈 상태가 없는지 확인한다.
// 로컬 빌드(wrangler --local)에 dispatcher 로그인 헤더를 직접 붙인다(mocked auth, smoke.spec.ts와 같은 방식).
// 500 여정은 /api/workspace 응답만 모의한다(mocked). 나머지는 실제 로컬 D1을 쓴다.
import {test, expect, type Browser, type Page, type TestInfo} from '@playwright/test';

const IDENTITY_HEADER = 'oai-authenticated-user-id';

// browser.newContext()는 프로젝트의 use 설정을 물려받지 않으므로 주소와 화면 크기를 직접 넘긴다.
async function ownerPage(browser: Browser, testInfo: TestInfo, owner: string) {
  const {baseURL, viewport} = testInfo.project.use;
  const context = await browser.newContext({baseURL, viewport, extraHTTPHeaders: {[IDENTITY_HEADER]: owner}});
  return {context, page: await context.newPage()};
}

const isMobile = (page: Page) => (page.viewportSize()?.width ?? 1280) < 768;
const query = (page: Page) => new URL(page.url()).searchParams;
const historyLength = (page: Page) => page.evaluate(() => history.length);

// 주소 보정(replaceState)이 기록을 늘리지 않는지 보려면 보정 전 기록 길이가 필요하다.
// 워크스페이스 응답을 잠시 붙잡아(mocked 지연, 응답 내용은 실제) 길이를 잰 뒤 풀어 준다.
async function holdWorkspace(page: Page) {
  let release = () => {};
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/workspace', async route => { await gate; await route.continue(); });
  return release;
}

test('캠페인 상세는 새로고침 뒤에도 열려 있고 뒤로가기로 목록에 돌아온다', async ({browser}, testInfo) => {
  const owner = `e2e-nav-${testInfo.project.name}-${Date.now()}`;
  const {context, page} = await ownerPage(browser, testInfo, owner);
  await page.request.get('/api/workspace');
  const title = `주소 복원 ${testInfo.project.name}`;
  const created = await page.request.post('/api/action', {data: {action: 'save_campaign', data: {brandId: 'oda', title, goal: '새로고침과 뒤로가기 뒤에도 같은 화면을 연다', budget: 0}}});
  expect(created.status()).toBe(200);
  const {id} = await created.json() as {id: string};

  await page.goto('/?view=campaigns');
  await expect(page.getByRole('heading', {level: 1, name: '캠페인'})).toBeVisible();
  if (!isMobile(page)) {
    // 좁은 화면에서는 사이드바가 닫힌 시트라 메뉴를 확인하지 않는다.
    const menu = page.getByRole('navigation', {name: '주 메뉴'});
    await expect(menu.getByRole('button', {name: '캠페인', exact: true})).toHaveAttribute('aria-current', 'page');
    await expect(menu.getByRole('button', {name: '워크스페이스', exact: true})).not.toHaveAttribute('aria-current', 'page');
  }

  // 같은 문서 안의 뒤로가기(popstate)
  await page.getByRole('button', {name: title + ' 열기', exact: true}).click();
  await expect(page.getByRole('dialog', {name: title})).toBeVisible();
  expect(query(page).get('view')).toBe('campaigns');
  expect(query(page).get('campaign')).toBe(id);
  await page.goBack();
  await expect(page.getByRole('dialog', {name: title})).toHaveCount(0);
  await expect(page.getByRole('heading', {level: 1, name: '캠페인'})).toBeVisible();
  expect(query(page).get('campaign')).toBeNull();

  // 새로고침하면 같은 캠페인이 다시 열린다.
  await page.getByRole('button', {name: title + ' 열기', exact: true}).click();
  await expect(page.getByRole('dialog', {name: title})).toBeVisible();
  await page.reload();
  await expect(page.getByRole('dialog', {name: title})).toBeVisible();
  expect(query(page).get('campaign')).toBe(id);
  await page.screenshot({path: `e2e/artifacts/${testInfo.project.name}-nav-after-reload.png`, fullPage: true});
  await page.goBack();
  await expect(page.getByRole('dialog', {name: title})).toHaveCount(0);
  await expect(page.getByRole('button', {name: title + ' 열기', exact: true})).toBeVisible();
  expect(query(page).get('view')).toBe('campaigns');

  // 없는 캠페인 주소는 기록을 늘리지 않고 캠페인 목록으로 바뀐다.
  const release = await holdWorkspace(page);
  await page.goto('/?view=assets&campaign=missing-campaign-id');
  const length = await historyLength(page);
  release();
  await expect(page.getByRole('heading', {level: 1, name: '캠페인'})).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect.poll(() => page.url()).not.toContain('missing-campaign-id');
  expect(query(page).get('view')).toBe('campaigns');
  expect(await historyLength(page)).toBe(length);
  await page.unroute('**/api/workspace');
  await context.close();
});

test('브랜드 아카이브는 주소로 다시 열리고 없는 브랜드는 기록을 늘리지 않고 목록으로 바뀐다', async ({browser}, testInfo) => {
  const {context, page} = await ownerPage(browser, testInfo, `e2e-nav-brand-${testInfo.project.name}-${Date.now()}`);
  const archiveBack = page.getByRole('button', {name: '브랜드 목록', exact: true});
  await page.goto('/?view=brands&brand=oda');
  await expect(archiveBack).toBeVisible();
  await page.reload();
  await expect(archiveBack).toBeVisible();
  expect(query(page).get('brand')).toBe('oda');

  const release = await holdWorkspace(page);
  await page.goto('/?view=brands&brand=gone-brand');
  const length = await historyLength(page);
  release();
  await expect(page.getByRole('heading', {level: 1, name: '브랜드 아카이브'})).toBeVisible();
  await expect.poll(() => query(page).get('brand')).toBeNull();
  await expect(archiveBack).toHaveCount(0);
  expect(query(page).get('view')).toBe('brands');
  expect(await historyLength(page)).toBe(length);
  await page.unroute('**/api/workspace');
  await context.close();
});

test('상세 시트에서 브리프를 고치면 시트가 새 버전을 보여 주고 다시 고쳐도 저장된다', async ({browser}, testInfo) => {
  const {context, page} = await ownerPage(browser, testInfo, `e2e-nav-edit-${testInfo.project.name}-${Date.now()}`);
  await page.request.get('/api/workspace');
  const title = `상세 브리프 수정 ${testInfo.project.name}`;
  const created = await page.request.post('/api/action', {data: {action: 'save_campaign', data: {brandId: 'oda', title, goal: '처음 목표', budget: 0}}});
  expect(created.status()).toBe(200);
  const {id} = await created.json() as {id: string};
  await page.goto(`/?view=campaigns&campaign=${id}`);
  const sheet = page.getByRole('dialog', {name: title});
  await expect(sheet.getByText('BRIEF v1', {exact: true})).toBeVisible();

  // 두 번째 저장은 시트가 넘긴 버전으로 검사된다. 시트가 옛 버전을 들고 있으면 409(다른 화면에서 브리프가 변경됐습니다)가 난다.
  for (const [goal, version] of [['두 번째 목표', 2], ['세 번째 목표', 3]] as const) {
    await sheet.getByRole('button', {name: '브리프 수정', exact: true}).click();
    const dialog = page.getByRole('dialog', {name: '캠페인을 더 구체적으로'});
    await dialog.getByRole('textbox', {name: '브리프 목표'}).fill(goal);
    const saved = page.waitForResponse(r => new URL(r.url()).pathname === '/api/action' && r.request().method() === 'POST' && r.request().postDataJSON()?.action === 'save_campaign');
    await dialog.getByRole('button', {name: '브리프 수정 저장', exact: true}).click();
    expect((await saved).status()).toBe(200);
    await expect(dialog).toBeHidden();
    await expect(sheet.getByText(`BRIEF v${version}`, {exact: true})).toBeVisible();
    await expect(sheet.getByRole('heading', {level: 2, name: goal, exact: true})).toBeVisible();
  }
  await context.close();
});

test('작업 중인 캠페인 상세는 폴링 한 번에 상세 API를 한 번만 부른다', async ({browser}, testInfo) => {
  test.setTimeout(60_000);
  const {context, page} = await ownerPage(browser, testInfo, `e2e-nav-poll-${testInfo.project.name}-${Date.now()}`);
  await page.request.get('/api/workspace');
  const title = `폴링 요청 수 ${testInfo.project.name}`;
  const created = await page.request.post('/api/action', {data: {action: 'save_campaign', data: {brandId: 'oda', title, goal: '폴링 중 상세 요청 수를 센다', budget: 0}}});
  expect(created.status()).toBe(200);
  const {id} = await created.json() as {id: string};
  // 진행 중인 실행은 상세 응답에만 넣는다(mocked). 작업자가 온라인이면 상세 화면은 실행 조회(/api/run) 없이 5초마다 다시 불러오기만 한다.
  // route.fetch는 부하가 걸린 러너에서 응답을 돌려주지 않을 때가 있어(그러면 화면의 폴링이 끝나지 않은 reload에 막힌다),
  // 실제 응답을 한 번 받아 두고 route에서는 그 응답을 바로 돌려준다. 이 테스트는 요청 수만 센다.
  const workspace = await (await page.request.get('/api/workspace')).json();
  const detail = await (await page.request.get(`/api/campaigns/${id}`)).json();
  const run = {id: 'e2e-poll-run', campaignId: id, role: 'cmo', status: 'in_progress', error: null, createdAt: new Date().toISOString(), model: 'e2e', tokens: 0};
  await page.route('**/api/workspace', route => route.fulfill({json: {...workspace, worker: {registered: true, online: true, lastSeen: new Date().toISOString()}}}));
  await page.route(`**/api/campaigns/${id}`, route => route.fulfill({json: {...detail, runs: [run, ...detail.runs]}}));
  let workspaceRequests = 0, detailRequests = 0;
  page.on('request', request => {
    const path = new URL(request.url()).pathname;
    if (path === '/api/workspace') workspaceRequests++;
    if (path === `/api/campaigns/${id}`) detailRequests++;
  });
  await page.goto(`/?view=campaigns&campaign=${id}`);
  await expect(page.getByRole('dialog', {name: title}).getByText('BRIEF v1', {exact: true})).toBeVisible();
  const start = {workspace: workspaceRequests, detail: detailRequests};
  // tick마다 워크스페이스 1회·상세 1회. 부모 데이터가 바뀔 때마다 상세를 다시 읽으면 상세가 tick당 2회가 된다.
  // 5초 간격 폴링 두 주기. 부하가 걸린 러너에서도 두 번은 오도록 넉넉히 기다린다(간격 자체는 검사하지 않는다).
  await expect.poll(() => workspaceRequests - start.workspace, {timeout: 30000}).toBeGreaterThanOrEqual(2);
  await page.waitForTimeout(1500);
  expect(detailRequests - start.detail).toBe(workspaceRequests - start.workspace);
  await page.unrouteAll({behavior: 'wait'});
  await context.close();
});

test('점포 마케팅의 지점 선택은 주소에 남아 새로고침·뒤로가기로 복원된다', async ({browser}, testInfo) => {
  const {context, page} = await ownerPage(browser, testInfo, `e2e-nav-store-${testInfo.project.name}-${Date.now()}`);
  await page.request.get('/api/workspace');
  const names = ['주소 복원 A지점', '주소 복원 B지점'], ids: string[] = [];
  for (const name of names) {
    const saved = await page.request.post('/api/stores', {data: {action: 'save_store', brandId: 'oda', data: {name, address: '서울 성수동 테스트 주소', tradeArea: 'residential', goal: '평일 포장 주문 증가'}}});
    expect(saved.status()).toBe(200);
    ids.push((await saved.json() as {id: string}).id);
  }
  const storeHeading = (id: string) => page.getByRole('heading', {level: 2, name: names[ids.indexOf(id)], exact: true});
  const storeSelect = page.locator('.store-field').filter({has: page.getByText('지점', {exact: true})}).locator('select');

  // 첫 활성 지점을 자동으로 고르면 주소에 남기되 기록은 늘리지 않는다.
  const release = await holdWorkspace(page);
  await page.goto('/?view=stores&brand=oda');
  const length = await historyLength(page);
  release();
  await expect.poll(() => query(page).get('store')).not.toBeNull();
  const first = query(page).get('store')!, second = ids.find(id => id !== first)!;
  expect(ids).toContain(first);
  await expect(storeHeading(first)).toBeVisible();
  expect(await historyLength(page)).toBe(length);
  await page.unroute('**/api/workspace');

  // 사용자가 고른 지점은 기록에 남아 새로고침과 뒤로가기로 돌아온다.
  await storeSelect.selectOption(second);
  await expect(storeHeading(second)).toBeVisible();
  await expect.poll(() => query(page).get('store')).toBe(second);
  expect(query(page).get('brand')).toBe('oda');
  expect(await historyLength(page)).toBe(length + 1);
  await page.reload();
  await expect(storeHeading(second)).toBeVisible();
  expect(query(page).get('store')).toBe(second);
  await page.goBack();
  await expect(storeHeading(first)).toBeVisible();
  expect(query(page).get('store')).toBe(first);

  // 없는 지점 주소는 오류 없이 첫 활성 지점으로 바뀐다.
  await page.goto('/?view=stores&brand=oda&store=missing-store-id');
  await expect(storeHeading(first)).toBeVisible();
  await expect.poll(() => query(page).get('store')).toBe(first);
  await expect(page.getByRole('alert')).toHaveCount(0);
  await context.close();
});

test('목표에 다른 브랜드 이름이 있으면 경고하고 HERMES 초안을 자동으로 요청하지 않는다', async ({browser}, testInfo) => {
  const {context, page} = await ownerPage(browser, testInfo, `e2e-nav-brand-guard-${testInfo.project.name}-${Date.now()}`);
  await page.goto('/');
  await expect(page.getByRole('heading', {level: 2, name: '브랜드 포트폴리오'})).toBeVisible();
  await page.getByRole('combobox', {name: '캠페인 브랜드'}).selectOption('ofd');
  const goal = page.getByRole('textbox', {name: '캠페인 목표'});
  const dialog = page.getByRole('dialog', {name: '목표 하나에서, 실행할 수 있는 캠페인으로'});
  // 로컬 빌드는 HERMES에 연결돼 있지 않아 자동 요청이 일어나면 곧바로 이 안내가 뜬다(요청은 나가지 않는다).
  const autoStarted = dialog.getByText('HERMES 연결 후 목표에 맞는 초안을 작성할 수 있습니다.', {exact: false});

  await goal.fill('ODA 오픈 캠페인을 준비하고 싶어');
  await expect(page.getByRole('alert').filter({hasText: '목표에 다른 브랜드(ODA Pizza) 이름이 있습니다.'})).toBeVisible();
  await page.getByRole('button', {name: 'HERMES 초안 만들기'}).click();
  await expect(dialog.getByRole('textbox', {name: '브리프 목표'})).toHaveValue('ODA 오픈 캠페인을 준비하고 싶어');
  await expect(dialog.getByText('목표에 다른 브랜드(ODA Pizza) 이름이 있습니다.', {exact: false})).toBeVisible();
  await expect(autoStarted).toHaveCount(0);
  await dialog.getByRole('button', {name: '닫기', exact: true}).click();
  await expect(dialog).toBeHidden();

  // 선택한 브랜드의 목표는 그대로 자동으로 시작한다.
  await goal.fill('평일 오후 방문을 늘리는 캠페인');
  await expect(page.getByRole('alert').filter({hasText: '목표에 다른 브랜드'})).toHaveCount(0);
  await page.getByRole('button', {name: 'HERMES 초안 만들기'}).click();
  await expect(autoStarted).toBeVisible();
  await context.close();
});

test('워크스페이스를 불러오지 못하면 빈 상태 문구 없이 오류와 다시 시도만 보인다', async ({browser}, testInfo) => {
  const {context, page} = await ownerPage(browser, testInfo, `e2e-nav-error-${testInfo.project.name}-${Date.now()}`);
  const message = '처리하지 못했습니다. 입력한 내용을 유지한 채 다시 시도해 주세요.';
  await page.route('**/api/workspace', route => route.fulfill({status: 500, json: {error: message}}));
  const falseEmpty = ['다음 성장은 첫 브리프에서 시작됩니다', '아직 등록된 작업물이 없습니다', '먼저 캠페인 브리프를 만들어 주세요.', '첫 작업 대기', '성장은 실제 숫자로 확인합니다.'];
  for (const view of ['campaigns', 'assets', 'results', 'agents', 'overview']) {
    await page.goto(`/?view=${view}`);
    await expect(page.getByRole('alert')).toContainText(message);
    await expect(page.getByRole('button', {name: '다시 시도', exact: true})).toBeVisible();
    for (const text of falseEmpty) await expect(page.getByText(text, {exact: false})).toHaveCount(0);
    // 시드 브랜드를 실제 포트폴리오처럼 보여 주지 않는다.
    await expect(page.getByText('Old Ferry Donut', {exact: true})).toHaveCount(0);
    // 연결 상태도 불러오기 전 기본값('기획 모드')으로 단정하지 않는다.
    await expect(page.getByText('기획 모드', {exact: true})).toHaveCount(0);
    await expect(page.getByRole('button', {name: '연결 상태 확인 불가', exact: true})).toBeVisible();
  }
  await page.screenshot({path: `e2e/artifacts/${testInfo.project.name}-nav-load-error.png`, fullPage: true});

  // 서버가 돌아오면 다시 시도로 실제 데이터(시드 캠페인)가 보인다.
  await page.unroute('**/api/workspace');
  await page.getByRole('button', {name: '다시 시도', exact: true}).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByRole('heading', {level: 2, name: '브랜드 포트폴리오'})).toBeVisible();
  await context.close();
});
