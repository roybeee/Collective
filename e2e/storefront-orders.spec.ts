// Real local browser/D1; synthetic identity/orders, no store or Meta external calls.
import {test,expect} from '@playwright/test';
test('자사몰 주문 미리보기·부분 환불·중복 장부 반영',async({browser},info)=>{
 const owner=`storefront-e2e-${info.project.name}-${Date.now()}`,context=await browser.newContext({baseURL:info.project.use.baseURL,viewport:info.project.use.viewport,extraHTTPHeaders:{'oai-authenticated-user-id':owner}}),page=await context.newPage();
 await page.request.get('/api/workspace');
 const savedStore=await page.request.post('/api/stores',{data:{action:'save_store',brandId:'ofd',data:{name:'자사몰 테스트 지점',address:'합성 주소',tradeArea:'residential',goal:'실제 주문 대조'}}});expect(savedStore.status()).toBe(200);const {id:storeId}=await savedStore.json();
 const title='자사몰 주문 '+info.project.name,created=await page.request.post('/api/action',{data:{action:'save_campaign',data:{brandId:'ofd',storeId,title,goal:'주문 대조'}}});expect(created.status()).toBe(200);
 await page.goto('/');if((page.viewportSize()?.width??1280)<768)await page.locator('[data-sidebar="trigger"]').first().click();await page.getByRole('button',{name:'캠페인',exact:true}).click();if((page.viewportSize()?.width??1280)<768)await page.keyboard.press('Escape');await page.getByRole('button',{name:title+' 열기'}).click();await page.getByRole('tab',{name:'Meta 광고 준비',exact:true}).click();await page.getByRole('tab',{name:'주문 대조',exact:true}).click();
 const panel=page.getByRole('region',{name:'주문 대조'});await panel.getByLabel('조회 시작일',{exact:true}).fill('2026-09-01');await panel.getByLabel('조회 종료일',{exact:true}).fill('2026-09-02');await panel.getByLabel('몰 식별자',{exact:true}).fill('test-store');
 const upload=async(revision:number,refund:number)=>{await panel.getByLabel('자사몰 주문 CSV',{exact:true}).setInputFiles({name:'synthetic-orders.csv',mimeType:'text/csv',buffer:Buffer.from(`order_id,revision,order_date,status,paid_amount,refund_amount,mode\nORDER-E2E,${revision},2026-09-01,paid,10000,${refund},delivery\n`)});await panel.getByRole('button',{name:'장부에 반영할 내용 확인',exact:true}).click();await panel.getByRole('button',{name:'확인한 주문 장부에 반영',exact:true}).click()};
 await upload(1,0);await expect(panel.getByRole('status')).toContainText('새 주문 1건');await upload(2,3000);await expect(panel.getByRole('status')).toContainText('갱신 1건');await expect(panel).toContainText('7,000원');await upload(2,3000);await expect(panel.getByRole('status')).toContainText('중복 1건');
 await panel.getByRole('button',{name:'새로고침',exact:true}).click();await expect(panel).toContainText('7,000원');expect(await panel.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
 await panel.getByRole('heading',{name:'판매 이후까지 확인하세요',exact:true}).scrollIntoViewIfNeeded();
 await page.screenshot({path:`e2e/artifacts/storefront-orders-${info.project.name}.png`});await context.close();
});
