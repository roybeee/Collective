import {test,expect} from '@playwright/test';
// Real local D1/API/Chromium. Orders come through the real store-operations API; no external data.
test('마케팅 후 손익·현금 요약과 순현금 비주장',async({browser},info)=>{
 const owner=`profit-${info.project.name}-${Date.now()}`,context=await browser.newContext({baseURL:info.project.use.baseURL,viewport:info.project.use.viewport,extraHTTPHeaders:{'oai-authenticated-user-id':owner}}),page=await context.newPage();
 try{
  const post=async(path:string,data:unknown)=>{const r=await page.request.post(path,{data});expect(r.status(),await r.text()).toBe(200);return r.json()};await page.request.get('/api/workspace');
  const {id:storeId}=await post('/api/stores',{action:'save_store',brandId:'ofd',data:{name:'손익 합성 지점',address:'합성 주소',tradeArea:'residential',goal:'손익'}});
  const title=`손익 ${info.project.name}`,{id:campaignId}=await post('/api/action',{action:'save_campaign',data:{brandId:'ofd',storeId,title,goal:'손익'}});
  await post('/api/store-operations',{action:'save_order',storeId,data:{source:'direct',orderNumber:'P-1',orderDate:new Date().toISOString().slice(0,10),mode:'delivery',status:'paid',paidAmount:20000,refundAmount:0,channel:'unknown',campaignId,attributionEvidence:'운영자 확인',costs:{foodCost:5000,packagingCost:0,fees:0,deliveryCost:0,benefitCost:0}}});
  await page.goto('/');if((page.viewportSize()?.width??1280)<768)await page.locator('[data-sidebar="trigger"]').first().click();await page.getByRole('button',{name:'캠페인',exact:true}).click();if((page.viewportSize()?.width??1280)<768)await page.keyboard.press('Escape');await page.getByRole('button',{name:title+' 열기',exact:true}).click();await page.getByRole('tab',{name:'성장·판매',exact:true}).click();
  await page.locator('summary').filter({hasText:/^마케팅 후 손익·현금$/}).click();const panel=page.getByRole('region',{name:'마케팅 후 손익과 현금',exact:true});await expect(panel).toBeVisible({timeout:5000});
  await expect(panel).toContainText('순매출20,000원');await expect(panel).toContainText('순현금계산하지 않음');await expect(panel).toContainText('인과 효과가 아닙니다');
  await panel.getByLabel('손익 시작일',{exact:true}).fill('2020-01-01');await panel.getByLabel('손익 종료일',{exact:true}).fill('2020-01-31');await panel.getByRole('button',{name:'손익 기간 적용',exact:true}).click();await expect(panel).toContainText('기간 2020-01-01~2020-01-31');await expect(panel).toContainText('순매출0원');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1)).toBe(true);
 }finally{await context.close()}
});
