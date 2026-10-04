import {test,expect} from '@playwright/test';
// Real local D1/API/Chromium. Orders come through the real store-operations API; no external data.
test('마케팅 후 손익·실제 지급·기간 확인·정정과 무효 이력',async({browser},info)=>{
 const owner=`profit-${info.project.name}-${Date.now()}`,context=await browser.newContext({baseURL:info.project.use.baseURL,viewport:info.project.use.viewport,extraHTTPHeaders:{'oai-authenticated-user-id':owner}}),page=await context.newPage();
 try{
  const post=async(path:string,data:unknown)=>{const r=await page.request.post(path,{data});expect(r.status(),await r.text()).toBe(200);return r.json()};await page.request.get('/api/workspace');
  const {id:storeId}=await post('/api/stores',{action:'save_store',brandId:'ofd',data:{name:'손익 합성 지점',address:'합성 주소',tradeArea:'residential',goal:'손익'}});
  const title=`손익 ${info.project.name}`,{id:campaignId}=await post('/api/action',{action:'save_campaign',data:{brandId:'ofd',storeId,title,goal:'손익'}});
  await post('/api/store-operations',{action:'save_order',storeId,data:{source:'direct',orderNumber:'P-1',orderDate:new Date().toISOString().slice(0,10),mode:'delivery',status:'paid',paidAmount:20000,refundAmount:0,channel:'unknown',campaignId,attributionEvidence:'운영자 확인',costs:{foodCost:5000,packagingCost:0,fees:0,deliveryCost:0,benefitCost:0}}});
  await page.goto('/');if((page.viewportSize()?.width??1280)<768)await page.locator('[data-sidebar="trigger"]').first().click();await page.getByRole('button',{name:'캠페인',exact:true}).click();if((page.viewportSize()?.width??1280)<768)await page.keyboard.press('Escape');await page.getByRole('button',{name:title+' 열기',exact:true}).click();await page.getByRole('tab',{name:'성장·판매',exact:true}).click();
  await page.locator('summary').filter({hasText:/^마케팅 후 손익·현금$/}).click();const panel=page.getByRole('region',{name:'마케팅 후 손익과 현금',exact:true});await expect(panel).toBeVisible({timeout:5000});
  await expect(panel).toContainText('순매출20,000원');await expect(panel).toContainText('순현금미확인');await expect(panel).toContainText('인과 효과가 아닙니다');
  const cash=panel.getByRole('region',{name:'실제 입출금 원장',exact:true});
  await expect(cash).toBeVisible();
  for(const [name,value] of [['계정 참조','e2e-bank'],['은행 거래 참조','e2e-paid'],['실제 금액(원, 미확인은 비워둠)','3000'],['입출금 증빙 참조','e2e-bank-export'],['기록·정정 사유','실제 매입 지급 확인']])await cash.getByLabel(name,{exact:true}).fill(value);
  await cash.getByRole('button',{name:'실제 현금 기록',exact:true}).click();
  await expect(cash.getByRole('status')).toContainText('저장했습니다');
  const read=async()=>{const response=await page.request.get(`/api/growth/cash?campaignId=${campaignId}`);expect(response.status()).toBe(200);return response.json()};
  expect((await read()).summary.netCashFlow).toBeNull();
  await cash.getByLabel('기간 대사 증빙 참조',{exact:true}).fill('e2e-full-bank-export');
  await cash.getByRole('checkbox').check();
  await cash.getByRole('button',{name:'기간 완전성 확인 기록',exact:true}).click();
  await expect.poll(async()=>(await read()).summary.netCashFlow).toBe(-3000);
  await expect(panel).toContainText('순현금-3,000원');
  await cash.getByRole('button',{name:'정정',exact:true}).click();
  await cash.getByLabel('실제 금액(원, 미확인은 비워둠)',{exact:true}).fill('2500');
  await cash.getByLabel('기록·정정 사유',{exact:true}).fill('실제 이체액 정정 증빙 확인');
  await cash.getByRole('button',{name:'현금 기록 정정',exact:true}).click();
  await expect.poll(async()=>(await read()).entries[0].version).toBe(2);
  expect((await read()).summary.netCashFlow).toBeNull();
  await cash.getByRole('button',{name:'무효 처리',exact:true}).click();
  await page.getByRole('alertdialog').getByRole('button',{name:'무효 기록',exact:true}).click();
  await expect.poll(async()=>(await read()).entries[0].status).toBe('void');
  expect((await read()).history).toHaveLength(3);
  await panel.getByLabel('손익 시작일',{exact:true}).fill('2020-01-01');await panel.getByLabel('손익 종료일',{exact:true}).fill('2020-01-31');await panel.getByRole('button',{name:'손익 기간 적용',exact:true}).click();await expect(panel).toContainText('기간 2020-01-01~2020-01-31');await expect(panel).toContainText('순매출0원');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1)).toBe(true);
 }finally{await context.close()}
});
