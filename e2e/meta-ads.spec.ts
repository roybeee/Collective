// Real Chromium/local D1, mocked owner identity; no Meta calls or ad spend.
import {test,expect} from '@playwright/test';
test('Meta 준비 계획 저장·재조회와 집행 차단',async({browser},info)=>{
 const owner=`meta-e2e-${info.project.name}-${Date.now()}`;
 const context=await browser.newContext({baseURL:info.project.use.baseURL,viewport:info.project.use.viewport,extraHTTPHeaders:{'oai-authenticated-user-id':owner}});
 const page=await context.newPage();await page.request.get('/api/workspace');
 const title='Meta 준비 '+info.project.name;
 const created=await page.request.post('/api/action',{data:{action:'save_campaign',data:{brandId:'ofd',title,goal:'구매 전환 준비',budget:0}}});expect(created.status()).toBe(200);
 await page.goto('/');
 if((page.viewportSize()?.width??1280)<768)await page.locator('[data-sidebar="trigger"]').first().click();
 await page.getByRole('button',{name:'캠페인',exact:true}).click();
 if((page.viewportSize()?.width??1280)<768)await page.keyboard.press('Escape');
 await page.getByRole('button',{name:title+' 열기'}).click();
 await page.getByRole('tab',{name:'Meta 광고 준비',exact:true}).click();
 const panel=page.getByRole('region',{name:'Meta 광고 준비'});
 await expect(panel.getByRole('button',{name:'광고 집행 · 준비 중'})).toBeDisabled();
 await panel.getByLabel('상품·오퍼',{exact:true}).fill('합성 상품 1개');
 await panel.getByLabel('판매가 (원)',{exact:true}).fill('12000');
 await panel.getByLabel('전환 경로',{exact:true}).selectOption('content');
 await panel.getByLabel('목표',{exact:true}).selectOption('lead');
 await panel.getByRole('button',{name:'준비 계획 저장',exact:true}).click();
 await expect(panel.getByRole('status')).toContainText('v1');
 await expect(panel).toContainText('매출 미검증');
 await panel.getByRole('button',{name:'최신 계획 불러오기'}).click();
 await expect(panel.getByLabel('상품·오퍼',{exact:true})).toHaveValue('합성 상품 1개');
 await expect(panel.getByLabel('판매가 (원)',{exact:true})).toHaveValue('12000');
 await expect(panel.getByRole('button',{name:'광고 집행 · 준비 중'})).toBeDisabled();
 await context.close();
});
