// G8 선불 크레딧 여정(docs/BILLING.ko.md): 스위치 꺼짐 요금표 → 대표가 credit_billing을 켬 → 사용량·비용 탭에서 요금제·잔액(Free 200크레딧)·부가세 포함 가격 확인
// → 충전 주문 만들기(실제 API, 테스트 형식 가짜 시크릿 키, 클라이언트 키 없음 → 결제창을 열지 않고 멈춤) → 결제창에서 돌아온 주소로 승인 확인(승인 API는 page.route 모의).
// 로컬 빌드(wrangler --local, 실제 D1 시뮬레이터)·실제 Chromium. 인증은 로그인 헤더(mocked auth), 토스 승인은 mocked. 실제 결제·외부 호출 없음.
import {test,expect} from '@playwright/test';

test('요금제·잔액 확인, 충전 주문은 결제창 직전에서 멈추고 승인은 모의 응답으로 확인',async({browser},testInfo)=>{
 const {baseURL,viewport}=testInfo.project.use;
 const context=await browser.newContext({baseURL,viewport,extraHTTPHeaders:{'oai-authenticated-user-id':`e2e-g8-${testInfo.project.name}-${Date.now()}`}});
 const page=await context.newPage();
 await page.request.get('/api/workspace');
 const off=await (await page.request.get('/api/billing')).json();
 expect(off.enabled).toBe(false);expect(off.balance).toBeNull();
 expect((await page.request.post('/api/feature-flags',{data:{action:'set',flag:'credit_billing',enabled:true}})).status()).toBe(200);

 await page.goto('/?view=settings&section=usage');
 const card=page.locator('section[aria-labelledby="settings-billing-title"]');
 await expect(card.getByRole('heading',{name:'요금제와 크레딧'})).toBeVisible();
 await expect(card.getByText('Free (현재 요금제)',{exact:true})).toBeVisible();
 await expect(card.getByText('잔액 200크레딧')).toBeVisible();
 await expect(card.getByText('자동 갱신·자동 결제는 없습니다',{exact:false})).toBeVisible();
 // 가격은 처음부터 부가세 포함 총액과 가격 미정 표시로 보인다.
 await expect(card.getByRole('list',{name:'충전 상품'})).toContainText('11,000원 (부가세 포함, 공급가 10,000원 + 부가세 1,000원)');
 await expect(card.getByRole('list',{name:'충전 상품'})).toContainText('가격 미정 — 대표 확정 필요');
 const buy=card.getByRole('button',{name:'크레딧 1,000 구매 (11,000원, 부가세 포함)'});
 await expect(buy).toBeVisible();
 await page.screenshot({path:`e2e/artifacts/${testInfo.project.name}-billing.png`,fullPage:true});

 const [response]=await Promise.all([page.waitForResponse(r=>r.url().endsWith('/api/billing/checkout')),buy.click()]);
 const checkout=await response.json();
 expect(response.status()).toBe(200);expect(checkout.order.amountKrw).toBe(11000);expect(checkout.clientKey).toBeNull();
 await expect(card.getByText('결제창을 열지 않았습니다',{exact:false})).toBeVisible();
 await expect(card.getByRole('list',{name:'결제 내역'})).toContainText('결제 대기');

 // 결제창에서 돌아온 것처럼 주소를 연다. 승인 API는 모의 응답이며 서버의 토스 호출은 일어나지 않는다.
 let confirmBody:Record<string,unknown>|null=null;
 await page.route('**/api/billing/confirm',async route=>{confirmBody=route.request().postDataJSON();await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({order:{...checkout.order,status:'paid'},duplicate:false})})});
 await page.goto(`/?view=settings&section=usage&billing=success&paymentKey=pk_e2e_mock&orderId=${checkout.order.orderId}&amount=11000`);
 await expect(card.getByText('결제를 확인했습니다',{exact:false})).toBeVisible();
 expect(confirmBody).toEqual({paymentKey:'pk_e2e_mock',orderId:checkout.order.orderId,amount:11000});
 expect(page.url()).not.toContain('paymentKey');
 await context.close();
});
