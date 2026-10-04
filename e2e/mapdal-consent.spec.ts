import {expect, test} from '@playwright/test';
import {readFileSync} from 'node:fs';

const source = readFileSync('scripts/mapdal/consumer-consent-browser.js', 'utf8');

test('판매처 동의: 실제 DOM에서 독립 선택·철회·실패 후 재조회 (backend mocked)', async ({page}) => {
  const notice = '<img src=x onerror="window.consentXss=1"><script>window.consentXss=1</script> 운영자 고지';
  let state = {
    purposes: [
      {purpose: 'post_purchase', version: 'a'.repeat(64), text: notice, maxAgeSeconds: 3600, granted: true, expiresAt: '2099-01-01T00:00:00Z'},
      {purpose: 'marketing_reorder', version: 'b'.repeat(64), text: '재구매 목적의 별도 운영자 고지', maxAgeSeconds: 7200, granted: false, expiresAt: null as string | null},
    ],
  };
  const posts: {purpose: string; granted: boolean; version: string}[] = [];
  let reads = 0;
  let failNextPost = false;
  // No shop, authentication service, or production API is called.
  await page.route('https://mapdal.kr/**', async route => {
    if (new URL(route.request().url()).pathname !== '/collective/consumer-consents/') {
      await route.fulfill({status: 200, contentType: 'text/html', body: '<!doctype html><html><body></body></html>'});
      return;
    }
    expect(route.request().headers()['x-csrf-token']).toBe('synthetic-csrf-token-000000000');
    if (route.request().method() === 'POST') {
      const body = route.request().postDataJSON();
      posts.push(body);
      if (failNextPost) {
        failNextPost = false;
        await route.fulfill({status: 503, json: {error: 'mock_response_unavailable'}});
        return;
      }
      state = {...state, purposes: state.purposes.map(p => p.purpose === body.purpose
        ? {...p, granted: body.granted, expiresAt: body.granted ? '2099-01-01T00:00:00Z' : null}
        : p)};
    } else {
      expect(route.request().method()).toBe('GET');
      reads++;
    }
    await route.fulfill({status: 200, json: state});
  });
  await page.goto('https://mapdal.kr/collective-consent-e2e');
  await page.setContent('<main><div id="purpose-consent"></div></main>');
  await page.evaluate(async moduleSource => {
    const url = URL.createObjectURL(new Blob([moduleSource], {type: 'text/javascript'}));
    try {
      const {createConsumerConsent, mountConsumerConsent} = await import(url);
      const api = createConsumerConsent({csrfToken: 'synthetic-csrf-token-000000000'});
      mountConsumerConsent(document.querySelector('#purpose-consent'), api);
      await api.load();
    } finally {
      URL.revokeObjectURL(url);
    }
  }, source);

  const purchase = page.getByRole('group', {name: '구매 후 안내', exact: true});
  const marketing = page.getByRole('group', {name: '재구매 마케팅 알림', exact: true});
  await expect(purchase.getByText('현재 동의함', {exact: false})).toBeVisible();
  await expect(purchase.getByRole('checkbox')).not.toBeChecked();
  await expect(marketing.getByRole('checkbox')).not.toBeChecked();
  expect(posts).toEqual([]);
  expect(reads).toBe(1);
  await expect(purchase.getByText(notice, {exact: true})).toBeVisible();
  await expect(page.locator('#purpose-consent img, #purpose-consent script')).toHaveCount(0);
  expect(await page.evaluate(() => Object.hasOwn(window, 'consentXss'))).toBe(false);

  await marketing.getByRole('checkbox').check();
  await expect(purchase.getByRole('checkbox')).not.toBeChecked();
  await marketing.getByRole('button', {name: '선택 저장', exact: true}).click();
  await expect(page.getByRole('status')).toHaveText('선택을 저장했습니다.');
  expect(posts).toEqual([{purpose: 'marketing_reorder', granted: true, version: 'b'.repeat(64)}]);
  await expect(marketing.getByRole('checkbox')).not.toBeChecked();

  await marketing.getByRole('button', {name: '동의 철회', exact: true}).click();
  await expect(marketing.getByText('현재 동의하지 않음', {exact: true})).toBeVisible();
  expect(posts[1]).toEqual({purpose: 'marketing_reorder', granted: false, version: 'b'.repeat(64)});

  failNextPost = true;
  await purchase.getByRole('checkbox').check();
  await purchase.getByRole('button', {name: '선택 저장', exact: true}).click();
  await expect(page.getByRole('alert')).toContainText('저장 결과를 확인하지 못했습니다.');
  await expect(purchase.getByRole('button', {name: '선택 저장', exact: true})).toBeDisabled();
  await expect(marketing.getByRole('button', {name: '동의 철회', exact: true})).toBeDisabled();
  await expect(purchase.getByRole('checkbox')).toBeDisabled();
  expect(posts).toHaveLength(3);
  await page.getByRole('button', {name: '현재 상태 다시 조회', exact: true}).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(purchase.getByRole('checkbox')).toBeEnabled();
  await expect(purchase.getByRole('checkbox')).not.toBeChecked();
  expect(reads).toBe(2);
  expect(posts).toHaveLength(3);
  await purchase.getByRole('button', {name: '동의 철회', exact: true}).click();
  await expect(purchase.getByText('현재 동의하지 않음', {exact: true})).toBeVisible();
  expect(posts[3]).toEqual({purpose: 'post_purchase', granted: false, version: 'a'.repeat(64)});
});
