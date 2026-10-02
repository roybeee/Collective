import {test,expect} from '@playwright/test';
// Real local D1/API/Chromium. Orders are created through the real store-operations API; no model or external call.
test('자사 장부 감지·재실행 멱등·담당 지정',async({browser},info)=>{
 const owner=`detect-${info.project.name}-${Date.now()}`,context=await browser.newContext({baseURL:info.project.use.baseURL,viewport:info.project.use.viewport,extraHTTPHeaders:{'oai-authenticated-user-id':owner}}),page=await context.newPage();
 try{
  const post=async(path:string,data:unknown)=>{const r=await page.request.post(path,{data});expect(r.status(),await r.text()).toBe(200);return r.json()};await page.request.get('/api/workspace');
  const {id:storeId}=await post('/api/stores',{action:'save_store',brandId:'ofd',data:{name:'감지 합성 지점',address:'합성 주소',tradeArea:'residential',goal:'감지'}});
  const title=`감지 ${info.project.name}`,{id:campaignId}=await post('/api/action',{action:'save_campaign',data:{brandId:'ofd',storeId,title,goal:'감지'}});
  const day=(n:number)=>new Date(Date.now()-n*86400000).toISOString().slice(0,10);
  const order=(n:number,no:string)=>post('/api/store-operations',{action:'save_order',storeId,data:{source:'direct',orderNumber:no,orderDate:day(n),mode:'delivery',status:'paid',paidAmount:10000,refundAmount:0,channel:'unknown',campaignId,attributionEvidence:'운영자 확인'}});
  for(let i=0;i<14;i++)await order(i%7,'R'+i);for(let i=0;i<21;i++)await order(7+i,'B'+i);
  await page.goto('/');if((page.viewportSize()?.width??1280)<768)await page.locator('[data-sidebar="trigger"]').first().click();await page.getByRole('button',{name:'캠페인',exact:true}).click();if((page.viewportSize()?.width??1280)<768)await page.keyboard.press('Escape');await page.getByRole('button',{name:title+' 열기',exact:true}).click();await page.getByRole('tab',{name:'성장·판매',exact:true}).click();
  await page.locator('summary').filter({hasText:/^자사 장부 감지 신호$/}).click();const panel=page.getByRole('region',{name:'자사 장부 감지 신호',exact:true});await expect(panel).toBeVisible({timeout:5000});
  await panel.getByRole('button',{name:'지금 감지',exact:true}).click();await expect(panel.getByRole('status').filter({hasText:'지금 감지했습니다'})).toBeVisible();await expect(panel).toContainText('최근 7일 유료 주문 증가');
  await panel.getByRole('button',{name:'지금 감지',exact:true}).click();await expect(panel.getByRole('status').filter({hasText:'새 신호 0건'})).toBeVisible();
  await panel.getByRole('button',{name:'최근 7일 유료 주문 증가 검토',exact:true}).click();await panel.getByRole('textbox',{name:'담당',exact:true}).fill('판매 담당');await panel.getByRole('textbox',{name:'다음 행동',exact:true}).fill('재고와 오퍼 수량 확인');await panel.getByLabel('검토 기한',{exact:true}).fill('2099-01-01');
  await panel.getByRole('button',{name:'담당 지정',exact:true}).click();await expect(panel).toContainText('담당 판매 담당, 재고와 오퍼 수량 확인, 기한 2099-01-01');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1)).toBe(true);
 }finally{await context.close()}
});
