import {test,expect} from '@playwright/test';
test('Meta 보고에서 판단 기록 후 다시 확인',async({browser},info)=>{
 const context=await browser.newContext({baseURL:info.project.use.baseURL,viewport:info.project.use.viewport,extraHTTPHeaders:{'oai-authenticated-user-id':`meta-learning-${info.project.name}-${Date.now()}`}}),page=await context.newPage();
 await page.request.get('/api/workspace');const title='다음 실험 '+info.project.name;
 const created=await page.request.post('/api/action',{data:{action:'save_campaign',data:{brandId:'ofd',title,goal:'합성 보고 판단'}}});expect(created.status()).toBe(200);const {id}=await created.json();
 const report=await page.request.get('/api/meta-ads/report?campaignId='+id+'&since=2026-09-01&until=2026-09-02');const v=await report.json();
 const frozen=await page.request.post('/api/meta-ads/report',{data:{action:'freeze',campaignId:id,since:'2026-09-01',until:'2026-09-02',expectedVersion:v.version,expectedDigest:v.report.basisDigest,confirmed:true}});expect(frozen.status()).toBe(200);
 await page.goto('/');if((page.viewportSize()?.width??1280)<768)await page.locator('[data-sidebar="trigger"]').first().click();await page.getByRole('button',{name:'캠페인',exact:true}).click();if((page.viewportSize()?.width??1280)<768)await page.keyboard.press('Escape');await page.getByRole('button',{name:title+' 열기'}).click();await page.getByRole('tab',{name:'Meta 광고 준비',exact:true}).click();await page.getByRole('tab',{name:'다음 실험',exact:true}).click();
 const p=page.getByRole('region',{name:'Meta 다음 실험'});await expect(p.getByLabel('판단 근거')).toBeEnabled();await p.getByLabel('판단 근거').fill('실제 주문을 확인한 뒤 판단');await p.getByRole('checkbox').check();await p.getByRole('button',{name:'판단 기록',exact:true}).click();await expect(p.getByRole('status')).toContainText('기록했습니다');await p.getByRole('button',{name:'다시 불러오기'}).click();await expect(p.getByRole('heading',{name:'보류 · 보고 v1'})).toBeVisible();expect(await p.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
 await page.getByRole('tab',{name:'예산 예약',exact:true}).click();await expect(page.getByRole('region',{name:'Meta 예산 예약'}).getByRole('button',{name:'계획 예산 예약',exact:true})).toBeDisabled();await context.close();
});
