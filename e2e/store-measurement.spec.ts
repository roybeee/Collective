// A4 점포 실측 여정: 추적 코드 생성 → POS CSV 미리보기·확정 → 자동 귀속 스위치(a4_auto_attribution) 기본 꺼짐에서 미귀속
// → 주문 기록 창에 추적 코드를 직접 넣으면 스위치가 꺼져 있어도 귀속(A4-3) → 소유자가 켠 뒤 자동 귀속 → POS 주간 합계로 완전성 통과 → 귀속 보고의 '귀속은 증분이 아님' 경고
// → 캠페인 상세 성과 탭의 주문 장부 귀속 자동 집계와 확인 대화를 거친 metric 스냅샷 저장(PR 4b-2, 오늘 끝나는 기간 400·어제까지로 다시 조회·같은 기간 재저장 409).
// 로컬 빌드(wrangler --local, 실제 D1 시뮬레이터)에 로그인 헤더를 직접 붙인다(mocked auth). legacy 헤더 요청자는 소유자(관리자 권한 포함)라
// 관리자 전용 코드 생성·가져오기 확정·POS 합계와 소유자 전용 기능 스위치 API(POST /api/feature-flags)를 모두 쓸 수 있다.
// 외부 호출이 없고 요청 가로채기도 쓰지 않는다(docs/E2E.ko.md 규칙).
import {test, expect, type Browser, type Page, type Response, type TestInfo} from '@playwright/test';

const IDENTITY_HEADER = 'oai-authenticated-user-id';
const FLAG = 'a4_auto_attribution';

async function ownerPage(browser: Browser, testInfo: TestInfo, owner: string) {
  const {baseURL, viewport} = testInfo.project.use;
  const context = await browser.newContext({baseURL, viewport, extraHTTPHeaders: {[IDENTITY_HEADER]: owner}});
  return {context, page: await context.newPage()};
}
// 날짜는 한국시간 기준으로 코드에서 계산한다. 주는 월요일에 시작한다.
const koreaToday = () => new Date().toLocaleDateString('en-CA', {timeZone: 'Asia/Seoul'});
const addDays = (date: string, days: number) => new Date(Date.parse(date + 'T00:00:00Z') + days * 86400000).toISOString().slice(0, 10);
const mondayOf = (date: string) => addDays(date, -((new Date(date + 'T00:00:00Z').getUTCDay() + 6) % 7));

type Order = {orderNumber: string; campaignId?: string};
type Preview = {dryRun: boolean; ready: number; duplicates: number; autoAttribution: {enabled: boolean; attributed: number}};
async function orders(page: Page, storeId: string) {
  const response = await page.request.get('/api/store-operations?storeId=' + encodeURIComponent(storeId));
  expect(response.status()).toBe(200);
  return (await response.json() as {orders: Order[]}).orders.filter(o => o.orderNumber.startsWith('E2E-A4-'));
}
const storeAction = (action: string, dryRun?: boolean) => (r: Response) => {
  if (!r.url().endsWith('/api/store-operations') || r.request().method() !== 'POST') return false;
  const body = r.request().postDataJSON() as {action?: string; dryRun?: boolean} | null;
  return body?.action === action && (dryRun === undefined || body.dryRun === dryRun);
};

// 붙여넣기 → 자동 열 매핑 확인 → 미리보기(dryRun:true). 미리보기 응답을 돌려준다.
async function previewCsv(page: Page, csv: string) {
  await page.getByRole('tab', {name: '주문 가져오기', exact: true}).click();
  await page.getByLabel('CSV 붙여넣기', {exact: true}).fill(csv);
  await expect(page.getByRole('combobox', {name: '주문번호 · 필수', exact: true})).toHaveValue('주문번호');
  await expect(page.getByRole('combobox', {name: '쿠폰·추적 코드', exact: true})).toHaveValue('쿠폰코드');
  const previewed = page.waitForResponse(storeAction('import_orders', true));
  await page.getByRole('button', {name: '미리보기', exact: true}).click();
  const response = await previewed;
  expect(response.status()).toBe(200);
  await expect(page.getByRole('region', {name: '가져오기 미리보기'})).toBeVisible();
  return await response.json() as Preview;
}
// 확정(dryRun:false). 저장 뒤 화면은 주문·비용 탭으로 돌아간다.
async function confirmCsv(page: Page, ready: number) {
  const saved = page.waitForResponse(storeAction('import_orders', false));
  await page.getByRole('button', {name: `확정 · ${ready}건 저장`, exact: true}).click();
  const response = await saved;
  expect(response.status()).toBe(200);
  await expect(page.getByRole('tab', {name: '주문·비용', exact: true})).toHaveAttribute('aria-selected', 'true');
  return await response.json() as {created: number; attributed: number};
}

test('추적 코드로 가져온 주문은 자동 귀속 스위치를 켤 때만 캠페인에 귀속된다', async ({browser}, testInfo) => {
  test.setTimeout(90_000);
  const owner = `e2e-a4-${testInfo.project.name}-${Date.now()}`;
  const {context, page} = await ownerPage(browser, testInfo, owner);
  await page.request.get('/api/workspace');

  // 준비: 지점 1곳과 같은 브랜드 공통 캠페인 1개. 주문은 지난주 월요일 날짜로 넣어 그 주의 POS 합계와 대조한다.
  const store = await page.request.post('/api/stores', {data: {action: 'save_store', brandId: 'oda', data: {name: 'A4 실측 지점', address: '서울 성수동 테스트 주소', tradeArea: 'residential', goal: '평일 포장 주문 증가'}}});
  expect(store.status()).toBe(200);
  const {id: storeId} = await store.json() as {id: string};
  const campaign = await page.request.post('/api/action', {data: {action: 'save_campaign', data: {brandId: 'oda', title: `A4 실측 ${testInfo.project.name}`, goal: '추적 코드 주문 귀속 확인', budget: 0}}});
  expect(campaign.status()).toBe(200);
  const {id: campaignId} = await campaign.json() as {id: string};
  const week = addDays(mondayOf(koreaToday()), -7);
  // 스위치는 기본 꺼짐이다(새 소유자라 저장 행이 없다).
  const flags = await (await page.request.get('/api/feature-flags')).json() as {flags: {flag: string; enabled: boolean; source: string}[]};
  expect(flags.flags.find(f => f.flag === FLAG)).toMatchObject({enabled: false, source: 'default'});

  await page.goto(`/?view=stores&brand=oda&store=${encodeURIComponent(storeId)}`);
  await expect(page.getByRole('heading', {level: 2, name: 'A4 실측 지점', exact: true})).toBeVisible();
  await page.getByRole('tab', {name: '주문 장부', exact: true}).click();

  // 1) 관리자(legacy 소유자)가 쿠폰 추적 코드를 만든다.
  // <select>는 <label> 안에 있어 label 텍스트에 선택지 문구가 섞이므로 getByLabel(exact)로는 찾지 못한다. 접근성 이름으로 찾는다.
  await page.getByRole('tab', {name: '추적 코드', exact: true}).click();
  await expect(page.getByText('자동 귀속 꺼짐 — 소유자가 기능 스위치에서 켤 수 있음', {exact: true})).toBeVisible();
  const form = page.getByRole('form', {name: '추적 코드 만들기'});
  await form.getByRole('combobox', {name: '코드 종류', exact: true}).selectOption('coupon');
  await form.getByLabel('코드 이름', {exact: true}).fill('오픈 주 포장 쿠폰');
  await form.getByLabel('적용 시작일', {exact: true}).fill(week);
  await form.getByRole('combobox', {name: '귀속 캠페인', exact: true}).selectOption(campaignId);
  const created = page.waitForResponse(storeAction('create_tracking_code'));
  await form.getByRole('button', {name: '추적 코드 만들기', exact: true}).click();
  const createdResponse = await created;
  expect(createdResponse.status()).toBe(200);
  const {code: made} = await createdResponse.json() as {code: {code: string; campaignId: string; label: string}};
  expect(made).toMatchObject({campaignId, label: '오픈 주 포장 쿠폰'});
  const code = made.code;
  await expect(page.getByRole('button', {name: code + ' 복사', exact: true})).toBeVisible();
  const listed = await (await page.request.post('/api/store-operations', {data: {action: 'list', storeId}})).json() as {codes: {code: string}[]; autoAttribution: boolean};
  expect(listed.codes.map(c => c.code)).toEqual([code]);
  expect(listed.autoAttribution).toBe(false);

  // 2) 스위치 꺼짐(끄기 테스트): 코드가 맞는 주문도 미귀속으로 저장된다. 수동 귀속만 가능하다.
  const header = '주문번호,주문일시,결제금액,쿠폰코드';
  const off = await previewCsv(page, `${header}\nE2E-A4-1,${week},18000,${code}\nE2E-A4-2,${week},12000,\n`);
  expect(off).toMatchObject({dryRun: true, ready: 2, duplicates: 0, autoAttribution: {enabled: false, attributed: 0}});
  const shown = page.getByRole('region', {name: '가져오기 미리보기'});
  await expect(shown.locator('article').filter({hasText: '자동 귀속'})).toContainText('0건');
  await expect(shown.locator('article').filter({hasText: '미귀속'})).toContainText('2건');
  expect(await confirmCsv(page, 2)).toMatchObject({created: 2, attributed: 0});
  const beforeSwitch = await orders(page, storeId);
  expect(beforeSwitch.map(o => o.orderNumber).sort()).toEqual(['E2E-A4-1', 'E2E-A4-2']);
  expect(beforeSwitch.every(o => !o.campaignId)).toBe(true);
  // 같은 파일을 다시 가져오면 저장할 주문이 없다(중복 방지).
  const again = await previewCsv(page, `${header}\nE2E-A4-1,${week},18000,${code}\n`);
  expect(again).toMatchObject({ready: 0, duplicates: 1});
  await expect(page.getByRole('button', {name: '확정 · 0건 저장', exact: true})).toBeDisabled();

  // 2b) A4-3: 주문 기록 창의 '추적 코드' 칸에 코드를 넣으면 스위치가 꺼져 있어도 코드의 캠페인으로 귀속한다(사람이 넣은 명시적 귀속).
  // 소문자로 넣어도 정규화해 찾는다. 오늘 주문이라 아래 4)의 지난주 POS 합계 대조에는 들어가지 않는다.
  await page.getByRole('tab', {name: '주문·비용', exact: true}).click();
  await page.getByRole('button', {name: '주문 기록', exact: true}).click();
  const dialog = page.getByRole('dialog', {name: '주문 기록', exact: true});
  await dialog.getByLabel('출처의 주문번호', {exact: true}).fill('E2E-A4-M1');
  await dialog.getByLabel('할인 후 결제액 · 환불 전 (원)', {exact: true}).fill('9000');
  await dialog.getByLabel('추적 코드 · 선택', {exact: true}).fill(code.toLowerCase());
  const typed = page.waitForResponse(storeAction('save_order'));
  await dialog.getByRole('button', {name: '주문 저장', exact: true}).click();
  const typedResponse = await typed;
  expect(typedResponse.status()).toBe(200);
  expect((await typedResponse.json() as {attribution: {via: string; code: string}}).attribution).toMatchObject({via: 'code', code});
  await expect(dialog).toBeHidden();
  expect((await orders(page, storeId)).find(o => o.orderNumber === 'E2E-A4-M1')?.campaignId).toBe(campaignId);

  // 3) 소유자가 스위치를 켜면 코드가 맞는 새 주문이 캠페인에 자동 귀속된다.
  const switched = await page.request.post('/api/feature-flags', {data: {action: 'set', flag: FLAG, enabled: true}});
  expect(switched.status()).toBe(200);
  await page.getByRole('tab', {name: '추적 코드', exact: true}).click();
  await expect(page.getByText('자동 귀속 켜짐', {exact: false}).first()).toBeVisible();
  const on = await previewCsv(page, `${header}\nE2E-A4-3,${week},21000,${code}\n`);
  expect(on).toMatchObject({ready: 1, autoAttribution: {enabled: true, attributed: 1}});
  expect(await confirmCsv(page, 1)).toMatchObject({created: 1, attributed: 1});
  expect((await orders(page, storeId)).find(o => o.orderNumber === 'E2E-A4-3')?.campaignId).toBe(campaignId);

  // 4) 귀속 보고: 지난주 POS 합계를 넣으면 완전성 통과, '귀속은 증분이 아님' 경고는 항상 보인다.
  const reported = page.waitForResponse(storeAction('attribution_report'));
  await page.getByRole('tab', {name: '귀속 보고', exact: true}).click();
  expect((await reported).status()).toBe(200);
  await expect(page.getByText('귀속≠증분', {exact: false}).first()).toBeVisible();
  await expect(page.getByRole('heading', {name: '추적 코드별', exact: true})).toBeVisible();
  // A4-2: 게시별 표는 게시 코드로 귀속된 주문만 센다. 이 여정의 코드는 게시에 묶이지 않아 빈 표 안내가 보인다.
  await expect(page.getByRole('heading', {name: '게시별 귀속', exact: true})).toBeVisible();
  await expect(page.getByText('이 기간에 게시 코드로 귀속된 주문이 없습니다.', {exact: true})).toBeVisible();
  const pos = page.getByRole('form', {name: 'POS 주간 합계 입력'});
  await pos.getByRole('combobox', {name: '주', exact: true}).selectOption(week);
  await pos.getByLabel('POS 순매출 합계 (원)', {exact: true}).fill('51000');
  await pos.getByLabel('POS 주문 수 · 선택', {exact: true}).fill('3');
  await pos.getByLabel('합계 출처', {exact: true}).fill('POS 주간 매출 리포트');
  const posSaved = page.waitForResponse(storeAction('set_pos_total'));
  await pos.getByRole('button', {name: '저장', exact: true}).click();
  expect((await posSaved).status()).toBe(200);
  await expect(page.getByRole('row').filter({hasText: week})).toContainText('통과');
  await expect(page.getByRole('region', {name: 'north-star'})).toContainText('1건');
  await page.screenshot({path: `e2e/artifacts/${testInfo.project.name}-store-measurement.png`, fullPage: true});

  // 5) PR 4b-2: 캠페인 상세 '성과' 탭에 같은 주문이 자동 집계되고, 확인 대화를 거쳐 schemaVersion 2 metric 스냅샷으로 저장된다.
  // 이 캠페인은 브랜드 공통이라 같은 브랜드 지점 주문을 합친다. 귀속된 주문은 E2E-A4-M1(오늘, 9000원)과 E2E-A4-3(지난주 월요일, 21000원)이다. 원가를 적지 않아 공헌이익은 미확인이다.
  // 스냅샷은 끝난 날까지만 저장한다(오늘 끝나는 기간은 400). 카드의 '어제까지로 조회'로 기간을 바꾸면 E2E-A4-3만 남는다.
  const aggregated = await page.request.get('/api/campaign-attribution?campaignId=' + encodeURIComponent(campaignId));
  expect(aggregated.status()).toBe(200);
  const attribution = await aggregated.json() as {period: {from: string; to: string}; totals: {orders: number; netRevenue: number; contribution: number | null}};
  expect(attribution.totals).toMatchObject({orders: 2, netRevenue: 30000, contribution: null});
  await page.goto(`/?view=campaigns&campaign=${encodeURIComponent(campaignId)}`);
  await page.getByRole('tab', {name: '성과', exact: true}).click();
  const card = page.getByRole('region', {name: '주문 장부 귀속', exact: true});
  await expect(card.getByText('귀속≠증분', {exact: false}).first()).toBeVisible();
  await expect(card.locator('article').filter({hasText: '귀속 주문'})).toContainText('2건');
  await expect(card.locator('article').filter({hasText: '공헌이익'})).toContainText('미확인');
  await expect(card.getByRole('heading', {name: '주별 귀속', exact: true})).toBeVisible();
  const openDay = await page.request.post('/api/campaign-attribution', {data: {action: 'snapshot', campaignId, ...attribution.period, confirmed: true, expected: {orders: 2, netRevenue: 30000, contribution: null}}});
  expect(openDay.status()).toBe(400);
  await expect(card.getByRole('button', {name: '스냅샷으로 저장', exact: true})).toHaveCount(0);
  await card.getByRole('button', {name: '어제까지로 조회', exact: true}).click();
  await expect(card.locator('article').filter({hasText: '귀속 주문'}).locator('strong')).toHaveText('1건');
  await card.getByRole('button', {name: '스냅샷으로 저장', exact: true}).click();
  const confirm = page.getByRole('dialog', {name: '주문 장부 귀속 스냅샷 저장', exact: true});
  await expect(confirm).toContainText('주문 장부 귀속');
  const snapshotSaved = page.waitForResponse(r => r.url().endsWith('/api/campaign-attribution') && r.request().method() === 'POST');
  await confirm.getByRole('button', {name: '확인하고 저장', exact: true}).click();
  expect((await snapshotSaved).status()).toBe(200);
  await expect(confirm).toBeHidden();
  await expect(page.getByText('출처: 주문 장부 귀속', {exact: false})).toBeVisible();
  const detail = await (await page.request.get('/api/campaigns/' + encodeURIComponent(campaignId))).json() as {metrics: {source?: string}[]};
  expect(detail.metrics.find(m => m.source === '주문 장부 귀속')).toMatchObject({schemaVersion: 2, method: 'export', revenue: 21000, orders: 1, variableCosts: null, adSpend: null});
  // 같은 기간을 다시 저장하면 기간 겹침(409)이다.
  const closed = {from: attribution.period.from, to: addDays(koreaToday(), -1)};
  const overlapping = await page.request.post('/api/campaign-attribution', {data: {action: 'snapshot', campaignId, ...closed, confirmed: true, expected: {orders: 1, netRevenue: 21000, contribution: null}}});
  expect(overlapping.status()).toBe(409);
  await page.screenshot({path: `e2e/artifacts/${testInfo.project.name}-campaign-attribution.png`, fullPage: true});

  // 소유자 범위 기록이라 다른 테스트에 번지지 않지만 기본값으로 되돌려 둔다.
  expect((await page.request.post('/api/feature-flags', {data: {action: 'reset', flag: FLAG}})).status()).toBe(200);
  await context.close();
});
